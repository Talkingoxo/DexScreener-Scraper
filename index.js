const express = require('express');
const http2 = require('http2');
const app = express();
app.use(express.json());

const apiKeys = ['00a5af9578784f0d9c96e4fccd458b4b','800b76f2e1bb4e8faea57d2add88601f','a180661526ac40eeaafe5d1a90d11b52','ae5ce549f49c4b17ab69b4e2f34fcc2e','cd8dfbb8ab4745eab854614cca70a5d8','34499358b9fd46a1a059cfd96d79db42','7992bcd991df4f639e8941c68186c7fc','fdd914f432d748889371e0307691c835','41f5cebd207042dd8a8acac2329ddb32','f6d87ae9284543e3b2d14f11a36e1dcd'];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

class KeyManager {
  constructor() {
    this.queue = [];
    this.workers = {};
    this.processing = new Set();
    this.completed = new Set();
    this.timeouts = [];
    
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
  
  execute(key, task) {
    const countryIndex = task.retries ? (task.id + task.retries) % 23 : task.id % 23;
    
    let stream;
    try {
      const session = this.getSession(key);
      stream = session.request({':method': 'POST', ':path': `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${countries[countryIndex]}&proxy_type=datacenter&browser=false`, 'content-type': 'application/json'});
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
    
    console.log(`REQUEST ${task.id}: Key=${key.slice(-8)}, Country=${countries[countryIndex]}${task.retries ? `, Retry=${task.retries}` : ''}`);
    
    let status = null;
    let done = false;
    
    const finish = (code) => {
      if (done || this.completed.has(task.id)) return;
      done = true;
      this.completed.add(task.id);
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      stream.close();
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
      if (task.retries < 3) {
        const timeout = setTimeout(() => {this.queue.push(task); this.process();}, 200 + Math.random() * 300);
        this.timeouts.push(timeout);
      } else {
        finish(500);
      }
      this.process();
    };
    
    const timeout = setTimeout(() => {console.log(`TIMEOUT ${task.id}: Key=${key.slice(-8)}`); retry();}, 8000);
    this.timeouts.push(timeout);
    
    stream.on('response', headers => {status = headers[':status']; console.log(`RESPONSE ${task.id}: Status=${status}, Key=${key.slice(-8)}`);});
    stream.on('end', () => {clearTimeout(timeout); console.log(`COMPLETED ${task.id}: Status=${status}, Key=${key.slice(-8)}`); if (status === 409 && (!task.retries409 || task.retries409 < 1)) {task.retries409 = 1; retry();} else {finish(status);}});
    stream.on('error', err => {clearTimeout(timeout); console.log(`ERROR ${task.id}: ${err.message}, Key=${key.slice(-8)}`); retry();});
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

app.post('/', (req, res) => {
  res.end();
  const {url} = req.body;
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const count = +url.slice(slashIndex + 1) || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: COUNT=${count}, TARGET=${targetUrl}`);
  
  let completed = 0, success = 0;
  const start = Date.now();
  
  for (let i = 0; i < count; i++) {
    manager.add({
      id: i,
      url: targetUrl,
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
});

app.listen(process.env.PORT || 3000, () => console.log('Service running'));
