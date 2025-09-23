const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

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

const countries = [
  'BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT',
  'IL','JP','NL','PL','RU','SA','SG','KR','ES','GB',
  'AE','US','VN'
];

class KeyManager {
  constructor() {
    this.globalQueue = [];
    this.workers = {};
    this.inFlight = new Set();
    this.completedTasks = new Set();
    this.pendingTimeouts = [];
    this.destroyed = false;
    
    apiKeys.forEach(key => {
      const session = http2.connect('https://api.scrapingant.com');
      session.on('error', err => console.log(`SESSION ERROR ${key.slice(-8)}: ${err.message}`));
      this.workers[key] = { session, busy: false };
    });
  }
  
  add(task) {
    if (this.destroyed) return;
    this.globalQueue.push(task);
    this.processNext();
  }
  
  processNext() {
    if (this.destroyed) return;
    const availableKey = Object.keys(this.workers).find(k => !this.workers[k].busy);
    if (!availableKey || !this.globalQueue.length) return;
    
    const task = this.globalQueue.shift();
    if (this.inFlight.has(task.id)) return this.processNext();
    
    this.inFlight.add(task.id);
    this.workers[availableKey].busy = true;
    this.executeTask(availableKey, task);
  }
  
  executeTask(key, task) {
    if (this.destroyed) return;
    
    const countryIndex = task.retries 
      ? (task.originalCountry + task.retries) % 23 
      : task.id % 23;
    
    const stream = this.workers[key].session.request({
      ':method': 'POST',
      ':path': `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${countries[countryIndex]}&proxy_type=datacenter&browser=false`,
      'content-type': 'application/json'
    });
    
    console.log(`REQUEST ${task.id}: Key=${key.slice(-8)}, Country=${countries[countryIndex]}${task.retries ? `, Retry=${task.retries}` : ''}`);
    
    let status = null;
    let isDone = false;
    
    const cleanup = () => {
      isDone = true;
      stream.removeAllListeners();
      stream.close(http2.constants.NGHTTP2_CANCEL);
      this.inFlight.delete(task.id);
      this.workers[key].busy = false;
    };
    
    const handleComplete = (finalStatus) => {
      if (isDone || this.completedTasks.has(task.id) || this.destroyed) return;
      
      this.completedTasks.add(task.id);
      task.callback(finalStatus);
    };
    
    const timeout = setTimeout(() => {
      if (isDone || this.destroyed) return;
      
      console.log(`TIMEOUT ${task.id}: Key=${key.slice(-8)}`);
      cleanup();
      
      task.retries = (task.retries || 0) + 1;
      task.originalCountry = task.originalCountry || task.id % 23;
      
      if (task.retries < 3) {
        const jitter = 300 + Math.random() * 500;
        const retryTimeout = setTimeout(() => {
          if (!this.destroyed) {
            this.globalQueue.unshift(task);
            this.processNext();
          }
        }, jitter);
        this.pendingTimeouts.push(retryTimeout);
      } else {
        handleComplete(500);
      }
      
      this.processNext();
    }, 5000);
    
    this.pendingTimeouts.push(timeout);
    
    stream.on('response', headers => {
      if (isDone || this.destroyed) return;
      status = headers[':status'];
      console.log(`RESPONSE ${task.id}: Status=${status}, Key=${key.slice(-8)}`);
    });
    
    stream.on('data', () => {});
    
    stream.on('end', () => {
      if (isDone || this.destroyed) return;
      clearTimeout(timeout);
      
      console.log(`COMPLETED ${task.id}: Status=${status}, Key=${key.slice(-8)}`);
      
      if (status === 409 && (!task.retries409 || task.retries409 < 1)) {
        cleanup();
        task.retries409 = (task.retries409 || 0) + 1;
        
        const jitter = 300 + Math.random() * 500;
        const retryTimeout = setTimeout(() => {
          if (!this.destroyed) {
            this.globalQueue.unshift(task);
            this.processNext();
          }
        }, jitter);
        this.pendingTimeouts.push(retryTimeout);
      } else {
        cleanup();
        handleComplete(status);
      }
      
      this.processNext();
    });
    
    stream.on('error', err => {
      if (isDone || this.destroyed) return;
      clearTimeout(timeout);
      
      console.log(`ERROR ${task.id}: ${err.message}, Key=${key.slice(-8)}`);
      cleanup();
      handleComplete(500);
      this.processNext();
    });
    
    stream.write(`{"worker-id":${task.id}}`);
    stream.end();
  }
  
  destroy() {
    this.destroyed = true;
    this.pendingTimeouts.forEach(t => clearTimeout(t));
    this.pendingTimeouts = [];
    Object.values(this.workers).forEach(w => w.session.destroy());
  }
}

let manager = new KeyManager();

app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const count = +url.slice(slashIndex + 1) || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: COUNT=${count}, TARGET=${targetUrl}`);
  
  let completed = 0;
  let success = 0;
  const start = Date.now();
  
  for (let i = 0; i < count; i++) {
    manager.add({
      id: i,
      url: targetUrl,
      callback: (status) => {
        completed++;
        if (status >= 200 && status < 300) success++;
        
        if (completed === count) {
          const duration = ((Date.now() - start) / 1000).toFixed(1);
          const rate = (success / count * 100).toFixed(1);
          console.log(`FINISHED: ${success}/${count} success (${rate}%) in ${duration}s`);
          
          manager.destroy();
          manager = new KeyManager();
        }
      }
    });
  }
});

app.listen(port, () => console.log(`Service running on port ${port}`));
