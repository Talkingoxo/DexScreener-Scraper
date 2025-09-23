const express = require('express');
const http2 = require('http2');
const app = express();
app.use(express.json());

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
  }
  
  getSession(key) {
    const worker = this.workers[key];
    if (!worker.session || worker.session.destroyed || worker.session.closed) {
      worker.session = http2.connect('https://api.scrapingant.com');
      worker.session.on('error', () => {worker.session = null; worker.busy = false;});
      worker.session.on('close', () => {worker.session = null; worker.busy = false;});
      worker.session.on('goaway', () => {worker.session = null; worker.busy = false;});
    }
    return worker.session;
  }
  
  add(task) {
    this.queue.push(task);
    this.process();
  }
  
  process() {
    const key = Object.keys(this.workers).find(k => !this.workers[k].busy);
    if (!key || !this.queue.length) return;
    
    for (let i = 0; i < this.queue.length; i++) {
      if (!this.processing.has(this.queue[i].id)) {
        const task = this.queue.splice(i, 1)[0];
        this.processing.add(task.id);
        this.workers[key].busy = true;
        this.execute(key, task);
        return;
      }
    }
  }
  
  selectCountry(task) {
    if (task.retries) {
      const tried = task.triedCountries || [];
      const available = countries.filter(c => !tried.includes(c));
      if (available.length === 0) return countries[Math.floor(Math.random() * countries.length)];
      const winners = this.winners.filter(c => available.includes(c));
      return winners.length > 0 ? winners[0] : available[0];
    }
    return countries[task.id % 23];
  }
  
  execute(key, task) {
    const country = this.selectCountry(task);
    task.triedCountries = task.triedCountries || [];
    if (!task.triedCountries.includes(country)) task.triedCountries.push(country);
    
    let stream;
    try {
      const session = this.getSession(key);
      stream = session.request({':method': 'POST', ':path': `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${country}&proxy_type=datacenter&browser=false`, 'content-type': 'application/json'});
    } catch (err) {
      if (err.code === 'ERR_HTTP2_INVALID_SESSION') {
        this.workers[key].session = null;
        this.workers[key].busy = false;
        this.processing.delete(task.id);
        const timeout = setTimeout(() => {this.queue.push(task); this.process();}, 200 + Math.random() * 300);
        this.timeouts.push(timeout);
        return;
      }
      throw err;
    }
    
    console.log(`REQUEST ${task.id}: Key=${key.slice(-8)}, Country=${country}${task.retries ? `, Retry=${task.retries}` : ''}`);
    
    let status = null;
    let done = false;
    
    const finish = (code) => {
      if (done || this.completed.has(task.id)) return;
      done = true;
      this.completed.add(task.id);
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      if (this.hedging.has(task.id)) {clearTimeout(this.hedging.get(task.id)); this.hedging.delete(task.id);}
      stream.close();
      if (code >= 200 && code < 300 && !this.winners.includes(country)) this.winners.push(country);
      tokens.delete(task.token);
      task.callback(code);
      this.process();
    };
    
    const retry = () => {
      if (done) return;
      done = true;
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      stream.close();
      task.retries = (task.retries || 0) + 1;
      const timeout = setTimeout(() => {this.queue.push(task); this.process();}, 200 + Math.random() * 300);
      this.timeouts.push(timeout);
      this.process();
    };
    
    const timeout = setTimeout(() => {console.log(`TIMEOUT ${task.id}: Key=${key.slice(-8)}`); tokens.delete(task.token); retry();}, 5000);
    this.timeouts.push(timeout);
    
    const hedgeTimeout = setTimeout(() => {
      if (!done && !this.hedging.has(task.id)) {
        this.hedging.set(task.id, true);
        this.queue.unshift({...task, isHedge: true});
        this.process();
      }
    }, 3000);
    this.timeouts.push(hedgeTimeout);
    
    stream.on('response', headers => {status = headers[':status']; console.log(`RESPONSE ${task.id}: Status=${status}, Key=${key.slice(-8)}`);});
    stream.on('end', () => {clearTimeout(timeout); clearTimeout(hedgeTimeout); console.log(`COMPLETED ${task.id}: Status=${status}, Key=${key.slice(-8)}`); if (status >= 200 && status < 300) {finish(status);} else {retry();}});
    stream.on('error', err => {clearTimeout(timeout); clearTimeout(hedgeTimeout); console.log(`ERROR ${task.id}: ${err.message}, Key=${key.slice(-8)}`); retry();});
    stream.on('data', () => {});
    
    stream.write(`{"worker-id":${task.id}}`);
    stream.end();
  }
  
  destroy() {
    this.timeouts.forEach(clearTimeout);
    Object.values(this.workers).forEach(w => {if (w.session && !w.session.destroyed) w.session.destroy();});
  }
}

let manager = new KeyManager();

app.get('/gate', (req, res) => {
  const {token, target} = req.query;
  
  if (!token || !target) {
    res.status(400).end('Missing token or target');
    return;
  }
  
  const tokenData = tokens.get(token);
  if (!tokenData) {
    res.status(410).end('Token expired or invalid');
    return;
  }
  
  if (Date.now() - tokenData.created > 5000) {
    tokens.delete(token);
    res.status(410).end('Token expired');
    return;
  }
  
  res.redirect(302, target);
});

app.post('/', (req, res) => {
  res.end();
  const {url, target} = req.body;
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const count = +url.slice(slashIndex + 1) || 1;
  const realTarget = target || url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: COUNT=${count}, TARGET=${realTarget}`);
  
  let completed = 0, success = 0;
  const start = Date.now();
  
  for (let i = 0; i < count; i++) {
    const token = Date.now().toString(36) + Math.random().toString(36).substr(2);
    tokens.set(token, {created: Date.now(), target: realTarget});
    
    const gateUrl = `${req.protocol}://${req.get('host')}/gate?token=${token}&target=${encodeURIComponent(realTarget)}`;
    
    manager.add({
      id: i,
      url: gateUrl,
      token: token,
      callback: (status) => {
        completed++;
        if (status >= 200 && status < 300) success++;
        if (completed === count) {
          console.log(`FINISHED: ${success}/${count} success (${(success/count*100).toFixed(1)}%) in ${((Date.now()-start)/1000).toFixed(1)}s`);
          manager.destroy();
          manager = new KeyManager();
        }
      }
    });
  }
  
  setTimeout(() => {
    tokens.forEach((value, key) => {
      if (Date.now() - value.created > 10000) tokens.delete(key);
    });
  }, 11000);
});

app.listen(process.env.PORT || 3000, () => console.log('Service running'));
