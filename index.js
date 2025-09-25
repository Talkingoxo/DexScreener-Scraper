const express = require('express');
const http2 = require('http2');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
  next();
});

const apiKeys = ['00a5af9578784f0d9c96e4fccd458b4b','800b76f2e1bb4e8faea57d2add88601f','a180661526ac40eeaafe5d1a90d11b52','ae5ce549f49c4b17ab69b4e2f34fcc2e','cd8dfbb8ab4745eab854614cca70a5d8','34499358b9fd46a1a059cfd96d79db42','7992bcd991df4f639e8941c68186c7fc','fdd914f432d748889371e0307691c835','41f5cebd207042dd8a8acac2329ddb32','f6d87ae9284543e3b2d14f11a36e1dcd'];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

const tokens = new Map();

class KeyManager {
  constructor() {
    this.queue = [];
    this.workers = {};
    this.processing = new Set();
    this.completed = new Set();
    this.timeouts = [];
    this.winners = [];
    this.hedging = new Map();
    
    apiKeys.forEach(key => {
      this.workers[key] = {session: null, busy: false};
    });
    console.log(`[KEYMANAGER] Initialized with ${apiKeys.length} API keys`);
  }
  
  getSession(key) {
    const worker = this.workers[key];
    if (!worker.session || worker.session.destroyed || worker.session.closed) {
      console.log(`[SESSION] Creating new HTTP/2 session for key ${key.slice(-8)}`);
      worker.session = http2.connect('https://api.scrapingant.com');
      worker.session.on('error', (err) => {
        console.log(`[SESSION-ERROR] Key ${key.slice(-8)}: ${err.message}`);
        worker.session = null; 
        worker.busy = false;
      });
      worker.session.on('close', () => {
        console.log(`[SESSION-CLOSE] Key ${key.slice(-8)} session closed`);
        worker.session = null; 
        worker.busy = false;
      });
      worker.session.on('goaway', () => {
        console.log(`[SESSION-GOAWAY] Key ${key.slice(-8)} received GOAWAY`);
        worker.session = null; 
        worker.busy = false;
      });
    }
    return worker.session;
  }
  
  add(task) {
    console.log(`[QUEUE] Adding task ${task.id} to queue. Current queue size: ${this.queue.length}`);
    this.queue.push(task);
    this.process();
  }
  
  process() {
    const key = Object.keys(this.workers).find(k => !this.workers[k].busy);
    if (!key) {
      console.log(`[PROCESS] No available keys. Busy keys: ${Object.keys(this.workers).filter(k => this.workers[k].busy).length}`);
      return;
    }
    if (!this.queue.length) {
      console.log(`[PROCESS] Queue empty. Available key: ${key.slice(-8)}`);
      return;
    }
    
    console.log(`[PROCESS] Available key: ${key.slice(-8)}, Queue size: ${this.queue.length}, Processing: ${this.processing.size}`);
    
    for (let i = 0; i < this.queue.length; i++) {
      if (!this.processing.has(this.queue[i].id)) {
        const task = this.queue.splice(i, 1)[0];
        console.log(`[PROCESS] Selected task ${task.id} from position ${i}`);
        this.processing.add(task.id);
        this.workers[key].busy = true;
        this.execute(key, task);
        return;
      }
    }
    console.log(`[PROCESS] All queued tasks already in processing`);
  }
  
  selectCountry(task) {
    if (task.retries) {
      const tried = task.triedCountries || [];
      const available = countries.filter(c => !tried.includes(c));
      console.log(`[COUNTRY-SELECT] Task ${task.id} retry ${task.retries}. Tried: [${tried.join(',')}], Available: ${available.length}`);
      if (available.length === 0) {
        const country = countries[Math.floor(Math.random() * countries.length)];
        console.log(`[COUNTRY-SELECT] All countries tried, using random: ${country}`);
        return country;
      }
      const winners = this.winners.filter(c => available.includes(c));
      const selected = winners.length > 0 ? winners[0] : available[0];
      console.log(`[COUNTRY-SELECT] Selected ${selected} (${winners.length > 0 ? 'winner' : 'next available'})`);
      return selected;
    }
    const country = countries[task.id % 23];
    console.log(`[COUNTRY-SELECT] Task ${task.id} first attempt, using: ${country}`);
    return country;
  }
  
  execute(key, task) {
    const country = this.selectCountry(task);
    task.triedCountries = task.triedCountries || [];
    if (!task.triedCountries.includes(country)) task.triedCountries.push(country);
    
    console.log(`[EXECUTE] Starting task ${task.id} with key ${key.slice(-8)}, country ${country}`);
    console.log(`[TOKEN-CHECK] Task ${task.id} token exists: ${tokens.has(task.token)}`);
    
    let stream;
    try {
      const session = this.getSession(key);
      const requestPath = `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${country}&proxy_type=datacenter&browser=true&return_page_source=true`;
      console.log(`[HTTP2-REQUEST] Task ${task.id} requesting: ${requestPath.substring(0, 100)}...`);
      stream = session.request({':method': 'POST', ':path': requestPath, 'content-type': 'application/json'});
    } catch (err) {
      console.log(`[HTTP2-ERROR] Task ${task.id} session request failed: ${err.message} (${err.code})`);
      if (err.code === 'ERR_HTTP2_INVALID_SESSION') {
        this.workers[key].session = null;
        this.workers[key].busy = false;
        this.processing.delete(task.id);
        console.log(`[HTTP2-RETRY] Task ${task.id} requeuing due to invalid session`);
        const timeout = setTimeout(() => {this.queue.push(task); this.process();}, 200 + Math.random() * 300);
        this.timeouts.push(timeout);
        return;
      }
      throw err;
    }
    
    console.log(`REQUEST ${task.id}: Key=${key.slice(-8)}, Country=${country}${task.retries ? `, Retry=${task.retries}` : ''}`);
    
    let status = null;
    let done = false;
    let responseHeaders = {};
    
    const finish = (code) => {
      if (done || this.completed.has(task.id)) {
        console.log(`[FINISH-SKIP] Task ${task.id} already done/completed`);
        return;
      }
      done = true;
      console.log(`[FINISH] Task ${task.id} finishing with code ${code}`);
      this.completed.add(task.id);
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      if (this.hedging.has(task.id)) {
        clearTimeout(this.hedging.get(task.id)); 
        this.hedging.delete(task.id);
        console.log(`[HEDGING] Cleared hedge timeout for task ${task.id}`);
      }
      stream.close();
      if (code >= 200 && code < 300 && !this.winners.includes(country)) {
        this.winners.push(country);
        console.log(`[WINNER] Added ${country} to winners list. Total winners: ${this.winners.length}`);
      }
      const tokenExists = tokens.has(task.token);
      console.log(`[TOKEN-CLEANUP] Task ${task.id} token exists before cleanup: ${tokenExists}`);
      if (tokenExists) tokens.delete(task.token);
      task.callback(code);
      console.log(`[STATS] Processing: ${this.processing.size}, Queue: ${this.queue.length}, Completed: ${this.completed.size}`);
      this.process();
    };
    
    const retry = () => {
      if (done) {
        console.log(`[RETRY-SKIP] Task ${task.id} already done`);
        return;
      }
      done = true;
      console.log(`[RETRY] Task ${task.id} initiating retry ${(task.retries || 0) + 1}`);
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      stream.close();
      task.retries = (task.retries || 0) + 1;
      const tokenExists = tokens.has(task.token);
      console.log(`[RETRY-TOKEN-CHECK] Task ${task.id} token exists: ${tokenExists}`);
      if (!tokenExists) {
        console.log(`[RETRY-ABORT] Task ${task.id} token deleted, aborting retries`);
        finish(500);
        return;
      }
      const jitter = 200 + Math.random() * 300;
      console.log(`[RETRY-DELAY] Task ${task.id} requeuing with ${jitter.toFixed(0)}ms jitter`);
      const timeout = setTimeout(() => {this.queue.push(task); this.process();}, jitter);
      this.timeouts.push(timeout);
      this.process();
    };
    
    const timeout = setTimeout(() => {
      console.log(`TIMEOUT ${task.id}: Key=${key.slice(-8)} after 5 seconds`);
      console.log(`[TIMEOUT-TOKEN] Task ${task.id} deleting token due to timeout`);
      tokens.delete(task.token); 
      retry();
    }, 5000);
    this.timeouts.push(timeout);
    
    const hedgeTimeout = setTimeout(() => {
      if (!done && !this.hedging.has(task.id)) {
        console.log(`[HEDGING] Task ${task.id} creating hedge request after 3 seconds`);
        this.hedging.set(task.id, hedgeTimeout);
        this.queue.unshift({...task, isHedge: true});
        this.process();
      }
    }, 3000);
    this.timeouts.push(hedgeTimeout);
    
    stream.on('response', headers => {
      status = headers[':status'];
      responseHeaders = headers;
      console.log(`RESPONSE ${task.id}: Status=${status}, Key=${key.slice(-8)}`);
      console.log(`[RESPONSE-HEADERS] Task ${task.id}: ${Object.keys(headers).filter(h => h.startsWith('ant-')).map(h => `${h}=${headers[h]}`).join(', ')}`);
    });
    
    let responseData = '';
    stream.on('data', chunk => {
      responseData += chunk;
      if (responseData.length < 200) {
        console.log(`[DATA-CHUNK] Task ${task.id} received ${chunk.length} bytes: ${chunk.toString().substring(0, 100)}...`);
      }
    });
    
    stream.on('end', () => {
      clearTimeout(timeout); 
      clearTimeout(hedgeTimeout); 
      console.log(`COMPLETED ${task.id}: Status=${status}, Key=${key.slice(-8)}, Data length: ${responseData.length}`);
      console.log(`[RESPONSE-SAMPLE] Task ${task.id}: ${responseData.substring(0, 200)}...`);
      if (status >= 200 && status < 300) {
        console.log(`[SUCCESS] Task ${task.id} successful with status ${status}`);
        finish(status);
      } else {
        console.log(`[NON-2XX] Task ${task.id} got status ${status}, will retry`);
        retry();
      }
    });
    
    stream.on('error', err => {
      clearTimeout(timeout); 
      clearTimeout(hedgeTimeout); 
      console.log(`ERROR ${task.id}: ${err.message}, Key=${key.slice(-8)}, Code: ${err.code}`);
      retry();
    });
    
    const payload = `{"worker-id":${task.id}}`;
    console.log(`[PAYLOAD] Task ${task.id} sending: ${payload}`);
    stream.write(payload);
    stream.end();
  }
  
  destroy() {
    console.log(`[DESTROY] Cleaning up ${this.timeouts.length} timeouts and ${Object.keys(this.workers).length} sessions`);
    this.timeouts.forEach(clearTimeout);
    Object.values(this.workers).forEach(w => {if (w.session && !w.session.destroyed) w.session.destroy();});
  }
}

let manager = new KeyManager();

app.get('/gate', (req, res) => {
  const {token} = req.query;
  const clientIP = req.ip || req.connection.remoteAddress;
  
  console.log(`[GATE] Request from ${clientIP} with token: ${token ? token.substring(0, 10) + '...' : 'MISSING'}`);
  
  if (!token) {
    console.log(`[GATE-ERROR] Missing token from ${clientIP}`);
    res.status(400).end('Missing token');
    return;
  }
  
  const tokenData = tokens.get(token);
  console.log(`[GATE-TOKEN] Token lookup result: ${tokenData ? 'FOUND' : 'NOT_FOUND'}`);
  
  if (!tokenData) {
    console.log(`[GATE-410] Token not found or expired for ${clientIP}`);
    res.status(410).end('Token expired or invalid');
    return;
  }
  
  const age = Date.now() - tokenData.created;
  console.log(`[GATE-AGE] Token age: ${age}ms (limit: 5000ms)`);
  
  if (age > 5000) {
    tokens.delete(token);
    console.log(`[GATE-EXPIRED] Token too old (${age}ms), deleted`);
    res.status(410).end('Token expired');
    return;
  }
  
  console.log(`[GATE-REDIRECT] Redirecting ${clientIP} to: ${tokenData.target}`);
  tokens.delete(token);
  console.log(`[GATE-TOKEN-DELETE] Token consumed and deleted`);
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(303, tokenData.target);
});

app.post('/', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  console.log(`[MAIN-REQUEST] POST from ${clientIP}: ${JSON.stringify(req.body)}`);
  
  res.end();
  const {url, target} = req.body;
  if (!url) {
    console.log(`[MAIN-ERROR] Missing URL in request from ${clientIP}`);
    return;
  }
  
  const slashIndex = url.lastIndexOf('/');
  const count = +url.slice(slashIndex + 1) || 1;
  const realTarget = target || url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: COUNT=${count}, TARGET=${realTarget}`);
  console.log(`[TOKENS] Current token count: ${tokens.size}`);
  
  let completed = 0, success = 0;
  const start = Date.now();
  
  for (let i = 0; i < count; i++) {
    const token = Date.now().toString(36) + Math.random().toString(36).substr(2);
    tokens.set(token, {created: Date.now(), target: realTarget});
    
    const gateUrl = `https://${req.get('host')}/gate?token=${token}`;
    console.log(`[GATE-URL] Task ${i}: ${gateUrl}`);
    
    manager.add({
      id: i,
      url: gateUrl,
      token: token,
      callback: (status) => {
        completed++;
        console.log(`[CALLBACK] Task ${i} completed with status ${status}. Total completed: ${completed}/${count}`);
        if (status >= 200 && status < 300) success++;
        if (completed === count) {
          const duration = ((Date.now() - start) / 1000).toFixed(1);
          const rate = (success / count * 100).toFixed(1);
          console.log(`FINISHED: ${success}/${count} success (${rate}%) in ${duration}s`);
          console.log(`[CLEANUP] Destroying manager and creating new one`);
          manager.destroy();
          manager = new KeyManager();
        }
      }
    });
  }
  
  console.log(`[TOKENS-AFTER] Token count after generation: ${tokens.size}`);
  
  setTimeout(() => {
    const beforeCleanup = tokens.size;
    tokens.forEach((value, key) => {
      if (Date.now() - value.created > 10000) tokens.delete(key);
    });
    const afterCleanup = tokens.size;
    if (beforeCleanup !== afterCleanup) {
      console.log(`[TOKEN-CLEANUP] Cleaned ${beforeCleanup - afterCleanup} old tokens. Remaining: ${afterCleanup}`);
    }
  }, 11000);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`[SERVER] Service running on port ${process.env.PORT || 3000}`);
  console.log(`[INIT] API Keys: ${apiKeys.length}, Countries: ${countries.length}`);
});
