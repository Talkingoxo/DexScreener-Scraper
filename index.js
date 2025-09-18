// server.js
const express = require('express');
const https = require('https');
const http2 = require('http2');
const { execFile } = require('child_process');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

// ---------- CONFIG ----------
const apiKeys = [
  '00a5af9578784f0d9c96e4fccd458b4b',
  '800b76f2e1bb4e8faea57d2add88601f',
  'a180661526ac40eeaafe5d1a90d11b52',
  'ae5ce549f49c4b17ab69b4e2f34fcc2e',
  'cd8dfbb8ab4745eab854614cca70a5d8',
  '34499358b9fd46a1a059cfd96d79db42',
  '7992bcd991df4f639e8941c68186c7fc',
  'fdd914f432d748889371e0307691c835',
  '41f5cebd207042dd8a8acac2329ddb32',
  'f6d87ae9284543e3b2d14f11a36e1dcd'
];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

// backoff/limits
const MAX_ATTEMPTS = 3;               // per request
const H2_STREAM_TIMEOUT_MS = 10000;
const HTTPS_TIMEOUT_MS = 10000;
const ON_409_BASE_COOLDOWN_MS = 1500; // per-key cooldown when busy
const GLOBAL_JOB_TTL_MS = 10 * 60 * 1000;

// ---------- GLOBAL JOB GUARD ----------
let activeJob = null; // { id, startedAt, count, completed, results }
const dedupe = new Map(); // runId -> { startedAt }

function jobIsActive() {
  if (!activeJob) return false;
  if (Date.now() - activeJob.startedAt > GLOBAL_JOB_TTL_MS) {
    activeJob = null;
    return false;
  }
  return true;
}

// ---------- HTTP/2 & HTTPS CLIENTS ----------
class OptimizedAPIManager {
  constructor() {
    this.keyQueues = {};
    this.keyInFlight = {};
    this.keyCooldownUntil = {};
    this.http2Session = null;
    this.httpsAgent = null;
    this.useHTTP2 = false;
    this.closed = false;

    apiKeys.forEach(k => {
      this.keyQueues[k] = [];
      this.keyInFlight[k] = false;
      this.keyCooldownUntil[k] = 0;
    });

    this.initTransports();
  }

  initTransports() {
    // HTTP/2 session (single connection, many streams)
    try {
      console.log('Probing HTTP/2: https://api.scrapingant.com');
      const s = http2.connect('https://api.scrapingant.com');
      this.http2Session = s;

      s.on('connect', () => {
        this.useHTTP2 = true;
        console.log('HTTP/2 connected');
      });

      s.on('error', (e) => {
        console.log('HTTP/2 error -> fallback HTTPS:', e.message);
        this.useHTTP2 = false;
        this.setupHTTPSAgent();
      });

      s.on('goaway', () => {
        console.log('HTTP/2 GOAWAY -> fallback HTTPS');
        this.useHTTP2 = false;
        this.setupHTTPSAgent();
      });

      s.on('close', () => {
        if (!this.closed) {
          console.log('HTTP/2 closed -> fallback HTTPS');
          this.useHTTP2 = false;
          this.setupHTTPSAgent();
        }
      });

      // Safety fallback timer
      setTimeout(() => {
        if (!this.useHTTP2) {
          console.log('HTTP/2 not ready -> use HTTPS keep-alive');
          this.setupHTTPSAgent();
        }
      }, 2000);

    } catch (e) {
      console.log('HTTP/2 init failed -> HTTPS:', e.message);
      this.setupHTTPSAgent();
    }
  }

  setupHTTPSAgent() {
    if (this.httpsAgent) return;
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10
    });
  }

  shutdown() {
    this.closed = true;
    try { this.http2Session?.close(); } catch {}
  }

  addRequest(keyIndex, requestData) {
    const key = apiKeys[keyIndex];
    this.keyQueues[key].push({ ...requestData, attempt: 0 });
    this.processQueue(key);
  }

  processQueue(key) {
    if (this.keyInFlight[key]) return;

    // respect per-key cooldown (eg, after a 409/429)
    const wait = this.keyCooldownUntil[key] - Date.now();
    if (wait > 0) {
      setTimeout(() => this.processQueue(key), wait);
      return;
    }

    const next = this.keyQueues[key].shift();
    if (!next) return;

    this.keyInFlight[key] = true;
    this.executeRequest(key, next, () => {
      this.keyInFlight[key] = false;
      // process next ASAP
      setImmediate(() => this.processQueue(key));
    });
  }

  executeRequest(apiKey, requestData, onComplete) {
    if (this.useHTTP2 && this.http2Session && !this.http2Session.destroyed) {
      this.executeHTTP2(apiKey, requestData, onComplete);
    } else {
      this.executeHTTPS(apiKey, requestData, onComplete);
    }
  }

  executeHTTP2(apiKey, requestData, onComplete) {
    const { targetUrl, requestId } = requestData;
    const country = countries[requestId % countries.length];
    const postData = `{"worker-id":${requestId}}`;

    console.log(`H2 REQ ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`);

    let statusCode = 0;
    const stream = this.http2Session.request({
      ':method': 'POST',
      ':path': `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(postData)
    });

    // time out the stream
    stream.setTimeout(H2_STREAM_TIMEOUT_MS, () => {
      console.log(`H2 TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`);
      stream.close();
    });

    stream.on('response', (headers) => {
      statusCode = headers[':status'] || 0;
      console.log(`H2 RES ${requestId}: ${statusCode}, Key=${apiKey.slice(-8)}`);
    });

    stream.on('data', () => {});
    stream.on('end', () => {
      console.log(`H2 END ${requestId}: ${statusCode}, Key=${apiKey.slice(-8)}`);
      this.handleOutcome(apiKey, requestData, statusCode, onComplete);
    });
    stream.on('error', (err) => {
      console.log(`H2 ERR ${requestId}: ${err.message}, Key=${apiKey.slice(-8)}`);
      this.handleOutcome(apiKey, requestData, 599, onComplete);
    });

    stream.end(postData);
  }

  executeHTTPS(apiKey, requestData, onComplete) {
    const { targetUrl, requestId } = requestData;
    const country = countries[requestId % countries.length];
    const postData = `{"worker-id":${requestId}}`;

    console.log(`HTTPS REQ ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`);

    const req = https.request({
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      agent: this.httpsAgent,
      timeout: HTTPS_TIMEOUT_MS
    }, (res) => {
      const code = res.statusCode || 0;
      console.log(`HTTPS RES ${requestId}: ${code}, Key=${apiKey.slice(-8)}`);
      res.on('data', () => {});
      res.on('end', () => {
        console.log(`HTTPS END ${requestId}: ${code}, Key=${apiKey.slice(-8)}`);
        this.handleOutcome(apiKey, requestData, code, onComplete);
      });
    });

    req.on('timeout', () => {
      console.log(`HTTPS TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`);
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      console.log(`HTTPS ERR ${requestId}: ${err.message}, Key=${apiKey.slice(-8)}`);
      this.handleOutcome(apiKey, requestData, 599, onComplete);
    });

    req.end(postData);
  }

  handleOutcome(apiKey, reqData, code, onComplete) {
    // Success
    if (code === 200) {
      reqData.onResponse(200);
      onComplete();
      return;
    }

    // Client-side hard failures that we should NOT retry.
    if (code === 404 || (code >= 400 && code < 500 && code !== 409 && code !== 429)) {
      reqData.onResponse(code);
      onComplete();
      return;
    }

    // Busy / rate-limited -> set per-key cooldown and retry
    if (code === 409 || code === 429) {
      const attempt = (reqData.attempt ?? 0) + 1;
      if (attempt > MAX_ATTEMPTS) {
        reqData.onResponse(code);
        onComplete();
        return;
      }
      reqData.attempt = attempt;
      const jitter = Math.floor(Math.random() * 400);
      const cooldown = ON_409_BASE_COOLDOWN_MS * attempt + jitter;
      this.keyCooldownUntil[apiKey] = Date.now() + cooldown;
      console.log(`COOLDOWN Key=${apiKey.slice(-8)} for ~${cooldown}ms (status ${code}, attempt ${attempt})`);
      // requeue same request
      this.keyQueues[apiKey].unshift(reqData);
      onComplete();
      return;
    }

    // 5xx / network -> backoff and retry
    if (code >= 500 || code === 599 || code === 0) {
      const attempt = (reqData.attempt ?? 0) + 1;
      if (attempt > MAX_ATTEMPTS) {
        reqData.onResponse(code || 500);
        onComplete();
        return;
      }
      reqData.attempt = attempt;
      const delay = Math.min(250 * attempt + Math.floor(Math.random() * 250), 1000);
      console.log(`RETRY ${reqData.requestId} (attempt ${attempt}) after ${delay}ms`);
      setTimeout(() => {
        // re-issue via same key queue
        this.keyQueues[apiKey].unshift(reqData);
        onComplete();
      }, delay);
      return;
    }

    // Fallback: count as failure
    reqData.onResponse(code);
    onComplete();
  }
}

// ---------- HTTP/3 one-time probe (external) ----------
function probeHTTP3Once() {
  execFile('curl', ['-sS', '--http3', '-I', 'https://api.scrapingant.com/'],
    { timeout: 8000 },
    (err, stdout, stderr) => {
      if (err) {
        console.log(`HTTP/3 probe: not available (${err.message})`);
        return;
      }
      // If the server negotiated h3, curl prints HTTP/3 in the status line or alt-svc
      const out = (stdout || stderr || '').toString();
      if (/HTTP\/3/i.test(out) || /alt-svc:.*h3/i.test(out)) {
        console.log('HTTP/3 probe: server supports h3 (curl).');
      } else {
        console.log('HTTP/3 probe: no h3 in response headers (curl).');
      }
    }
  );
}

// ---------- ROUTE ----------
const apiManager = new OptimizedAPIManager();
probeHTTP3Once(); // harmless, one-time, external to your endpoint

app.post('/', (req, res) => {
  try {
    // Basic input
    const { url, runId: runIdRaw, allowSelf = false } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing "url"' });

    // Parse /{count} at end if present
    const u = new URL(url);
    const segments = u.pathname.replace(/\/+$/, '').split('/');
    const last = segments[segments.length - 1];
    const count = /^\d+$/.test(last) ? Math.max(1, Math.min(1000, parseInt(last, 10))) : 1;
    // If trailing number present, target is the parent path (ending with '/'), else use given URL
    const targetUrl = /^\d+$/.test(last)
      ? `${u.origin}${segments.slice(0, -1).join('/') || ''}/`
      : url;

    // Self-crawl protection (prevents loops)
    const ourHost = req.headers['host'];
    const targetHost = new URL(targetUrl).host;
    if (!allowSelf && targetHost === ourHost) {
      return res.status(400).json({
        error: 'Refusing to crawl self URL (would cause recursion). Pass {"allowSelf": true} ONLY if you know what you are doing.',
        targetUrl
      });
    }

    // Dedupe / single-job guard
    const runId = (runIdRaw && String(runIdRaw)) || crypto.randomUUID();
    // If a job is currently active, reject new ones unless it’s the same runId (idempotency)
    if (jobIsActive() && activeJob.id !== runId) {
      return res.status(409).json({ error: 'A job is already running. Reuse the same runId for idempotency or try later.' });
    }
    if (dedupe.has(runId) && jobIsActive()) {
      return res.status(202).json({ status: 'duplicate_ignored', runId });
    }

    // Start job
    activeJob = {
      id: runId,
      startedAt: Date.now(),
      count,
      completed: 0,
      results: { success: 0, failed: 0 }
    };
    dedupe.set(runId, { startedAt: activeJob.startedAt });

    console.log(`STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`);
    console.log(`PROTOCOL: ${apiManager.useHTTP2 ? 'HTTP/2' : 'HTTPS Keep-Alive'}`);
    console.log(`DISTRIBUTING ${count} requests across ${apiKeys.length} API keys`);

    // Fire and respond immediately to the client (no waiting on all results)
    res.json({ runId, accepted: true, count, targetUrl, protocol: apiManager.useHTTP2 ? 'h2' : 'https/1.1' });

    const startTime = Date.now();
    for (let i = 0; i < count; i++) {
      const keyIndex = i % apiKeys.length;
      const requestData = {
        targetUrl,
        requestId: i,
        onResponse: (statusCode) => {
          if (!activeJob || activeJob.id !== runId) return;
          activeJob.completed++;
          if (statusCode === 200) activeJob.results.success++;
          else activeJob.results.failed++;

          if (activeJob.completed === activeJob.count) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const successRate = (activeJob.results.success / activeJob.count * 100).toFixed(1);
            console.log(`ALL COMPLETE: ${activeJob.results.success}/${activeJob.count} (${successRate}%) in ${duration}s`);
            // clear active job
            activeJob = null;
          }
        }
      };

      apiManager.addRequest(keyIndex, requestData);
    }
  } catch (e) {
    console.error('Handler error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(port, () => console.log(`Service running on port ${port}`));
process.on('SIGTERM', () => { apiManager.shutdown(); process.exit(0); });
process.on('SIGINT', () => { apiManager.shutdown(); process.exit(0); });
