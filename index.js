const express = require('express');
const https = require('https');
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
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

class APIKeyManager {
  constructor() {
    this.keyQueues = {};
    this.keyInFlight = {};
    
    apiKeys.forEach(key => {
      this.keyQueues[key] = [];
      this.keyInFlight[key] = false;
    });
  }
  
  addRequest(keyIndex, requestData) {
    const key = apiKeys[keyIndex];
    this.keyQueues[key].push(requestData);
    this.processQueue(key);
  }
  
  processQueue(key) {
    if (this.keyInFlight[key] || this.keyQueues[key].length === 0) {
      return;
    }
    
    this.keyInFlight[key] = true;
    const requestData = this.keyQueues[key].shift();
    
    this.executeRequest(key, requestData, () => {
      this.keyInFlight[key] = false;
      setTimeout(() => this.processQueue(key), 100);
    });
  }
  
  executeRequest(apiKey, requestData, onComplete) {
    const { targetUrl, requestId, onResponse } = requestData;
    const country = countries[requestId % 23];
    const postData = `{"worker-id":${requestId}}`;
    
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': postData.length}
    };
    
    console.log(`REQUEST ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`);
    
    const req = https.request(options, (res) => {
      console.log(`RESPONSE ${requestId}: Status=${res.statusCode}, Key=${apiKey.slice(-8)}`);
      
      res.on('data', () => {});
      res.on('end', () => {
        console.log(`REQUEST ${requestId} COMPLETED: Status=${res.statusCode}, Key=${apiKey.slice(-8)}`);
        onResponse(res.statusCode);
        onComplete();
      });
    });
    
    req.on('error', (err) => {
      console.log(`REQUEST ${requestId} ERROR: ${err.message}, Key=${apiKey.slice(-8)}`);
      onResponse(500);
      onComplete();
    });
    
    req.write(postData);
    req.end();
  }
}

const keyManager = new APIKeyManager();

app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = +lastPart || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`);
  console.log(`DISTRIBUTING ${count} requests across ${apiKeys.length} API keys`);
  
  let completed = 0;
  const results = { success: 0, failed: 0 };
  
  for (let i = 0; i < count; i++) {
    const keyIndex = i % apiKeys.length;
    
    const requestData = {
      targetUrl,
      requestId: i,
      onResponse: (statusCode) => {
        completed++;
        if (statusCode === 200) {
          results.success++;
        } else {
          results.failed++;
        }
        
        if (completed === count) {
          const successRate = (results.success / count * 100).toFixed(1);
          console.log(`ALL REQUESTS COMPLETE: ${results.success}/${count} successful (${successRate}%)`);
          console.log(`Failed: ${results.failed}, Success: ${results.success}`);
        }
      }
    };
    
    keyManager.addRequest(keyIndex, requestData);
  }
});

app.listen(port, () => console.log(`Service running on port ${port}`));
