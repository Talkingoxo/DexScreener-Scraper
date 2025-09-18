const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

const apiKeys = ['00a5af9578784f0d9c96e4fccd458b4b','800b76f2e1bb4e8faea57d2add88601f','a180661526ac40eeaafe5d1a90d11b52','ae5ce549f49c4b17ab69b4e2f34fcc2e','cd8dfbb8ab4745eab854614cca70a5d8','34499358b9fd46a1a059cfd96d79db42','7992bcd991df4f639e8941c68186c7fc','fdd914f432d748889371e0307691c835','41f5cebd207042dd8a8acac2329ddb32','f6d87ae9284543e3b2d14f11a36e1dcd'];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

class KeyManager {
  constructor() {
    this.queues = {};
    this.busy = {};
    this.session = null;
    this.setupHTTP2();
    apiKeys.forEach(key => {
      this.queues[key] = [];
      this.busy[key] = false;
    });
  }
  
  setupHTTP2() {
    this.session = http2.connect('https://api.scrapingant.com');
    this.session.on('error', err => console.log('SESSION ERROR:', err.message));
  }
  
  add(keyIndex, data) {
    const key = apiKeys[keyIndex];
    this.queues[key].push(data);
    this.process(key);
  }
  
  process(key) {
    if (this.busy[key] || !this.queues[key].length) return;
    
    this.busy[key] = true;
    const data = this.queues[key].shift();
    
    const stream = this.session.request({
      ':method': 'POST',
      ':path': `/v2/general?url=${encodeURIComponent(data.url)}&x-api-key=${key}&proxy_country=${countries[data.id % 23]}&proxy_type=datacenter&browser=false`,
      'content-type': 'application/json'
    });
    
    console.log(`REQUEST ${data.id}: Key=${key.slice(-8)}, Country=${countries[data.id % 23]}`);
    
    let status = null;
    
    stream.on('response', headers => {
      status = headers[':status'];
      console.log(`RESPONSE ${data.id}: Status=${status}, Key=${key.slice(-8)}`);
    });
    
    stream.on('data', () => {});
    
    stream.on('end', () => {
      console.log(`COMPLETED ${data.id}: Status=${status}, Key=${key.slice(-8)}`);
      data.callback(status);
      this.busy[key] = false;
      this.process(key);
    });
    
    stream.on('error', err => {
      console.log(`ERROR ${data.id}: ${err.message}, Key=${key.slice(-8)}`);
      data.callback(500);
      this.busy[key] = false;
      this.process(key);
    });
    
    stream.write(`{"worker-id":${data.id}}`);
    stream.end();
  }
  
  destroy() {
    if (this.session) {
      this.session.destroy();
    }
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
    manager.add(i % apiKeys.length, {
      id: i,
      url: targetUrl,
      callback: (status) => {
        completed++;
        if (status === 200) success++;
        
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
