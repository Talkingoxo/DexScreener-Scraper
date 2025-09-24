const express = require('express');
const http2 = require('http2');
const app = express();
app.use(express.json());

const apiKeys = ['00a5af9578784f0d9c96e4fccd458b4b','800b76f2e1bb4e8faea57d2add88601f','a180661526ac40eeaafe5d1a90d11b52','ae5ce549f49c4b17ab69b4e2f34fcc2e','cd8dfbb8ab4745eab854614cca70a5d8','34499358b9fd46a1a059cfd96d79db42','7992bcd991df4f639e8941c68186c7fc','fdd914f432d748889371e0307691c835','41f5cebd207042dd8a8acac2329ddb32','f6d87ae9284543e3b2d14f11a36e1dcd'];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

const tokens = new Map();
let gateAccessCounter = 0;
let tokenCreatedCounter = 0;

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
  }
  
  getSession(key) {
    const worker = this.workers[key];
    if (!worker.session || worker.session.destroyed || worker.session.closed) {
      console.log(`[SESSION] Creating new HTTP2 session for key=${key.slice(-8)}`);
      worker.session = http2.connect('https://api.scrapingant.com');
      worker.session.on('error', (err) => {console.log(`[SESSION ERROR] key=${key.slice(-8)}: ${err.message}`); worker.session = null; worker.busy = false;});
      worker.session.on('close', () => {console.log(`[SESSION CLOSE] key=${key.slice(-8)}`); worker.session = null; worker.busy = false;});
      worker.session.on('goaway', () => {console.log(`[SESSION GOAWAY] key=${key.slice(-8)}`); worker.session = null; worker.busy = false;});
    }
    return worker.session;
  }
  
  add(task) {
    console.log(`[QUEUE ADD] Task ${task.id} added, token=${task.token}, queue size=${this.queue.length + 1}`);
    this.queue.push(task);
    this.process();
  }
  
  process() {
    const key = Object.keys(this.workers).find(k => !this.workers[k].busy);
    if (!key) {
      console.log(`[QUEUE PROCESS] No available workers, queue=${this.queue.length}`);
      return;
    }
    if (!this.queue.length) {
      console.log(`[QUEUE PROCESS] Empty queue, available workers=${Object.keys(this.workers).filter(k => !this.workers[k].busy).length}`);
      return;
    }
    
    for (let i = 0; i < this.queue.length; i++) {
      if (!this.processing.has(this.queue[i].id)) {
        const task = this.queue.splice(i, 1)[0];
        console.log(`[QUEUE PROCESS] Starting task ${task.id}, token=${task.token}, remaining queue=${this.queue.length}`);
        this.processing.add(task.id);
        this.workers[key].busy = true;
        this.execute(key, task);
        return;
      }
    }
    console.log(`[QUEUE PROCESS] All ${this.queue.length} tasks already processing`);
  }
  
  selectCountry(task) {
    if (task.retries) {
      const tried = task.triedCountries || [];
      const available = countries.filter(c => !tried.includes(c));
      if (available.length === 0) {
        const selected = countries[Math.floor(Math.random() * countries.length)];
        console.log(`[COUNTRY] Task ${task.id} retry ${task.retries}: all countries tried, random=${selected}`);
        return selected;
      }
      const winners = this.winners.filter(c => available.includes(c));
      const selected = winners.length > 0 ? winners[0] : available[0];
      console.log(`[COUNTRY] Task ${task.id} retry ${task.retries}: tried=${tried.join(',')}, selected=${selected}`);
      return selected;
    }
    const selected = countries[task.id % 23];
    console.log(`[COUNTRY] Task ${task.id}: initial country=${selected}`);
    return selected;
  }
  
  execute(key, task) {
    const country = this.selectCountry(task);
    task.triedCountries = task.triedCountries || [];
    if (!task.triedCountries.includes(country)) task.triedCountries.push(country);
    
    console.log(`[EXECUTE START] Task ${task.id}: key=${key.slice(-8)}, country=${country}, token=${task.token}, retry=${task.retries || 0}`);
    console.log(`[TOKEN CHECK] Task ${task.id}: token exists=${tokens.has(task.token)}, token data=${JSON.stringify(tokens.get(task.token))}`);
    
    let stream;
    try {
      const session = this.getSession(key);
      const path = `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${country}&proxy_type=datacenter&browser=false`;
      console.log(`[HTTP2 REQUEST] Task ${task.id}: POST ${path.slice(0,50)}...`);
      stream = session.request({':method': 'POST', ':path': path, 'content-type': 'application/json'});
    } catch (err) {
      console.log(`[HTTP2 ERROR] Task ${task.id}: ${err.code} - ${err.message}`);
      if (err.code === 'ERR_HTTP2_INVALID_SESSION') {
        this.workers[key].session = null;
        this.workers[key].busy = false;
        this.processing.delete(task.id);
        const delay = 200 + Math.random() * 300;
        console.log(`[RETRY SCHEDULE] Task ${task.id}: invalid session, retry in ${delay.toFixed(0)}ms`);
        const timeout = setTimeout(() => {this.queue.push(task); this.process();}, delay);
        this.timeouts.push(timeout);
        return;
      }
      throw err;
    }
    
    console.log(`REQUEST ${task.id}: Key=${key.slice(-8)}, Country=${country}${task.retries ? `, Retry=${task.retries}` : ''}`);
    
    let status = null;
    let done = false;
    let dataReceived = 0;
    
    const finish = (code) => {
      console.log(`[FINISH CALLED] Task ${task.id}: done=${done}, completed=${this.completed.has(task.id)}, code=${code}`);
      if (done || this.completed.has(task.id)) {
        console.log(`[FINISH SKIP] Task ${task.id}: already finished`);
        return;
      }
      done = true;
      this.completed.add(task.id);
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      if (this.hedging.has(task.id)) {
        console.log(`[HEDGE CLEAR] Task ${task.id}: clearing hedge timeout`);
        clearTimeout(this.hedging.get(task.id));
        this.hedging.delete(task.id);
      }
      stream.close();
      if (code >= 200 && code < 300 && !this.winners.includes(country)) {
        console.log(`[WINNER] Adding country ${country} to winners`);
        this.winners.push(country);
      }
      console.log(`[TOKEN DELETE WARNING] Task ${task.id}: WOULD delete token ${task.token} but SKIPPED for debugging`);
      // tokens.delete(task.token); // REMOVED FOR DEBUGGING
      console.log(`[CALLBACK] Task ${task.id}: calling callback with status ${code}`);
      task.callback(code);
      this.process();
    };
    
    const retry = () => {
      console.log(`[RETRY CALLED] Task ${task.id}: done=${done}`);
      if (done) {
        console.log(`[RETRY SKIP] Task ${task.id}: already done`);
        return;
      }
      done = true;
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      stream.close();
      task.retries = (task.retries || 0) + 1;
      console.log(`[RETRY CHECK] Task ${task.id}: token exists=${tokens.has(task.token)}`);
      if (!tokens.has(task.token)) {
        console.log(`[RETRY ABORT] Task ${task.id}: token deleted, finishing with 500`);
        finish(500);
        return;
      }
      const delay = 200 + Math.random() * 300;
      console.log(`[RETRY SCHEDULE] Task ${task.id}: retry #${task.retries} in ${delay.toFixed(0)}ms`);
      const timeout = setTimeout(() => {this.queue.push(task); this.process();}, delay);
      this.timeouts.push(timeout);
      this.process();
    };
    
    const timeout = setTimeout(() => {
      console.log(`TIMEOUT ${task.id}: Key=${key.slice(-8)}`);
      console.log(`[TIMEOUT DELETE WARNING] Task ${task.id}: WOULD delete token ${task.token} but SKIPPED for debugging`);
      // tokens.delete(task.token); // REMOVED FOR DEBUGGING
      retry();
    }, 5000);
    this.timeouts.push(timeout);
    
    const hedgeTimeout = setTimeout(() => {
      if (!done && !this.hedging.has(task.id)) {
        console.log(`[HEDGE START] Task ${task.id}: creating hedge request after 3s`);
        this.hedging.set(task.id, hedgeTimeout);
        this.queue.unshift({...task, isHedge: true});
        this.process();
      }
    }, 3000);
    this.timeouts.push(hedgeTimeout);
    
    stream.on('response', headers => {
      status = headers[':status'];
      console.log(`RESPONSE ${task.id}: Status=${status}, Key=${key.slice(-8)}`);
      console.log(`[HEADERS] Task ${task.id}: ${JSON.stringify(headers)}`);
    });
    
    stream.on('end', () => {
      clearTimeout(timeout);
      clearTimeout(hedgeTimeout);
      console.log(`COMPLETED ${task.id}: Status=${status}, Key=${key.slice(-8)}, Data=${dataReceived} bytes`);
      if (status >= 200 && status < 300) {
        console.log(`[SUCCESS] Task ${task.id}: finishing with status ${status}`);
        finish(status);
      } else {
        console.log(`[FAILURE] Task ${task.id}: retrying due to status ${status}`);
        retry();
      }
    });
    
    stream.on('error', err => {
      clearTimeout(timeout);
      clearTimeout(hedgeTimeout);
      console.log(`ERROR ${task.id}: ${err.message}, Key=${key.slice(-8)}`);
      console.log(`[ERROR DETAIL] Task ${task.id}: code=${err.code}, stack=${err.stack?.slice(0,200)}`);
      retry();
    });
    
    stream.on('data', chunk => {
      dataReceived += chunk.length;
      console.log(`[DATA] Task ${task.id}: received ${chunk.length} bytes, total=${dataReceived}`);
    });
    
    const payload = `{"worker-id":${task.id}}`;
    console.log(`[SEND] Task ${task.id}: sending payload=${payload}`);
    stream.write(payload);
    stream.end();
  }
  
  destroy() {
    console.log(`[DESTROY] Clearing ${this.timeouts.length} timeouts`);
    this.timeouts.forEach(clearTimeout);
    Object.entries(this.workers).forEach(([key, w]) => {
      if (w.session && !w.session.destroyed) {
        console.log(`[DESTROY] Destroying session for key=${key.slice(-8)}`);
        w.session.destroy();
      }
    });
  }
}

let manager = new KeyManager();

app.get('/gate', (req, res) => {
  const accessId = ++gateAccessCounter;
  const {token} = req.query;
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  console.log(`\n[GATE ACCESS #${accessId}] token=${token}, IP=${ip}, UA=${userAgent?.slice(0,50)}`);
  
  if (!token) {
    console.log(`[GATE #${accessId}] NO TOKEN - returning 400`);
    res.status(400).end('Missing token');
    return;
  }
  
  const tokenData = tokens.get(token);
  console.log(`[GATE #${accessId}] Token lookup: exists=${!!tokenData}, data=${JSON.stringify(tokenData)}`);
  
  if (!tokenData) {
    console.log(`[GATE #${accessId}] TOKEN NOT FOUND - returning 410`);
    res.status(410).end('Token expired or invalid');
    return;
  }
  
  const age = Date.now() - tokenData.created;
  console.log(`[GATE #${accessId}] Token age=${age}ms, limit=5000ms`);
  
  if (age > 5000) {
    console.log(`[GATE #${accessId}] TOKEN EXPIRED - deleting and returning 410`);
    tokens.delete(token);
    console.log(`[GATE #${accessId}] Tokens remaining=${tokens.size}`);
    res.status(410).end('Token expired');
    return;
  }
  
  console.log(`[GATE #${accessId}] TOKEN VALID - redirecting to ${tokenData.target}`);
  console.log(`[GATE #${accessId}] NOT DELETING TOKEN - keeping for full 5s window`);
  
  tokenData.accesses = (tokenData.accesses || 0) + 1;
  tokenData.lastAccess = Date.now();
  console.log(`[GATE #${accessId}] Token accesses=${tokenData.accesses}, last=${tokenData.lastAccess}`);
  
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(302, tokenData.target);
  console.log(`[GATE #${accessId}] 302 REDIRECT sent\n`);
});

app.post('/', (req, res) => {
  res.end();
  const {url, target} = req.body;
  if (!url) {
    console.log(`[POST /] No URL provided, ignoring`);
    return;
  }
  
  const slashIndex = url.lastIndexOf('/');
  const count = +url.slice(slashIndex + 1) || 1;
  const realTarget = target || url.slice(0, slashIndex + 1);
  
  console.log(`\n[============ NEW BATCH ============]`);
  console.log(`STARTING: COUNT=${count}, TARGET=${realTarget}`);
  console.log(`[TOKENS BEFORE] Map size=${tokens.size}`);
  
  let completed = 0, success = 0;
  const start = Date.now();
  
  for (let i = 0; i < count; i++) {
    const tokenId = ++tokenCreatedCounter;
    const token = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const tokenData = {created: Date.now(), target: realTarget, id: tokenId};
    tokens.set(token, tokenData);
    console.log(`[TOKEN CREATE #${tokenId}] token=${token}, data=${JSON.stringify(tokenData)}`);
    
    const gateUrl = `${req.protocol}://${req.get('host')}/gate?token=${token}`;
    console.log(`[GATE URL ${i}] ${gateUrl}`);
    
    manager.add({
      id: i,
      url: gateUrl,
      token: token,
      callback: (status) => {
        completed++;
        console.log(`[COMPLETE] ${completed}/${count}, status=${status}`);
        if (status >= 200 && status < 300) success++;
        if (completed === count) {
          console.log(`\n[============ BATCH COMPLETE ============]`);
          console.log(`FINISHED: ${success}/${count} success (${(success/count*100).toFixed(1)}%) in ${((Date.now()-start)/1000).toFixed(1)}s`);
          console.log(`[TOKENS AFTER] Map size=${tokens.size}`);
          console.log(`[CLEANUP] Destroying manager`);
          manager.destroy();
          manager = new KeyManager();
        }
      }
    });
  }
  
  setTimeout(() => {
    console.log(`[CLEANUP] Running token cleanup after 11s`);
    let deleted = 0;
    tokens.forEach((value, key) => {
      if (Date.now() - value.created > 10000) {
        tokens.delete(key);
        deleted++;
      }
    });
    console.log(`[CLEANUP] Deleted ${deleted} old tokens, remaining=${tokens.size}`);
  }, 11000);
});

app.listen(process.env.PORT || 3000, () => console.log('Service running - ULTRA DEBUG MODE'));
