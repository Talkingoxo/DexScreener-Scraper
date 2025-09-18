const express = require('express');
const https = require('https');
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
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

class OptimizedAPIManager {
  constructor() {
    this.keyQueues = {};
    this.keyInFlight = {};
    this.http2Session = null;
    this.httpsAgent = null;
    this.useHTTP2 = false;
    this.initializeConnections();
    
    apiKeys.forEach(key => {
      this.keyQueues[key] = [];
      this.keyInFlight[key] = false;
    });
  }
  
  async initializeConnections() {
    try {
      console.log('Testing HTTP/2 support for api.scrapingant.com...');
      this.http2Session = http2.connect('https://api.scrapingant.com');
      
      this.http2Session.on('connect', () => {
        console.log('HTTP/2 connection established');
        this.useHTTP2 = true;
      });
      
      this.http2Session.on('error', (err) => {
        console.log('HTTP/2 failed, falling back to HTTPS:', err.message);
        this.useHTTP2 = false;
        this.setupHTTPSAgent();
      });
      
      setTimeout(() => {
        if (!this.useHTTP2) {
          console.log('HTTP/2 timeout, using HTTPS with keep-alive');
          this.setupHTTPSAgent();
        }
      }, 2000);
      
    } catch (err) {
      console.log('HTTP/2 not supported, using HTTPS:', err.message);
      this.setupHTTPSAgent();
    }
  }
  
  setupHTTPSAgent() {
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10
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
      this.processQueue(key);
    });
  }
  
  executeRequest(apiKey, requestData, onComplete) {
    const { targetUrl, requestId, onResponse } = requestData;
    const country = countries[requestId % 23];
    const postData = `{"worker-id":${requestId}}`;
    
    if (this.useHTTP2 && this.http2Session) {
      this.executeHTTP2Request(apiKey, requestData, onComplete);
    } else {
      this.executeHTTPSRequest(apiKey, requestData, onComplete);
    }
  }
  
  executeHTTP2Request(apiKey, requestData, onComplete) {
    const { targetUrl, requestId } = requestData;
    const country = countries[requestId % 23];
    const postData = `{"worker-id":${requestId}}`;
    
    console.log(`HTTP/2 REQUEST ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`);
    
    const stream = this.http2Session.request({
      ':method': 'POST',
      ':path': `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      'content-type': 'application/json',
      'content-length': postData.length
    }, { timeout: 10000 });
    
    let statusCode = null;
    
    stream.on('response', (headers) => {
      statusCode = headers[':status'];
      console.log(`HTTP/2 RESPONSE ${requestId}: Status=${statusCode}, Key=${apiKey.slice(-8)}`);
    });
    
    stream.on('data', () => {});
    
    stream.on('end', () => {
      console.log(`HTTP/2 COMPLETED ${requestId}: Status=${statusCode}, Key=${apiKey.slice(-8)}`);
      
      if (statusCode >= 500) {
        this.retryRequest(apiKey, requestData, onComplete, 1);
      } else {
        requestData.onResponse(statusCode);
        onComplete();
      }
    });
    
    stream.on('error', (err) => {
      console.log(`HTTP/2 ERROR ${requestId}: ${err.message}, Key=${apiKey.slice(-8)}`);
      this.retryRequest(apiKey, requestData, onComplete, 1);
    });
    
    stream.on('timeout', () => {
      console.log(`HTTP/2 TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`);
      stream.destroy();
      this.retryRequest(apiKey, requestData, onComplete, 1);
    });
    
    stream.write(postData);
    stream.end();
  }
  
  executeHTTPSRequest(apiKey, requestData, onComplete) {
    const { targetUrl, requestId } = requestData;
    const country = countries[requestId % 23];
    const postData = `{"worker-id":${requestId}}`;
    
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': postData.length},
      agent: this.httpsAgent,
      timeout: 10000
    };
    
    console.log(`HTTPS REQUEST ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`);
    
    const req = https.request(options, (res) => {
      console.log(`HTTPS RESPONSE ${requestId}: Status=${res.statusCode}, Key=${apiKey.slice(-8)}`);
      
      res.on('data', () => {});
      res.on('end', () => {
        console.log(`HTTPS COMPLETED ${requestId}: Status=${res.statusCode}, Key=${apiKey.slice(-8)}`);
        
        if (res.statusCode >= 500) {
          this.retryRequest(apiKey, requestData, onComplete, 1);
        } else {
          requestData.onResponse(res.statusCode);
          onComplete();
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`HTTPS ERROR ${requestId}: ${err.message}, Key=${apiKey.slice(-8)}`);
      this.retryRequest(apiKey, requestData, onComplete, 1);
    });
    
    req.on('timeout', () => {
      console.log(`HTTPS TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`);
      req.destroy();
      this.retryRequest(apiKey, requestData, onComplete, 1);
    });
    
    req.write(postData);
    req.end();
  }
  
  retryRequest(apiKey, requestData, onComplete, attempt) {
    if (attempt > 2) {
      console.log(`MAX RETRIES REACHED ${requestData.requestId}: Key=${apiKey.slice(-8)}`);
      requestData.onResponse(500);
      onComplete();
      return;
    }
    
    const backoffDelay = Math.min(250 * attempt + Math.random() * 100, 1000);
    console.log(`RETRY ${requestData.requestId} (attempt ${attempt + 1}): Key=${apiKey.slice(-8)}, delay=${Math.round(backoffDelay)}ms`);
    
    setTimeout(() => {
      this.executeRequest(apiKey, requestData, onComplete);
    }, backoffDelay);
  }
}

const apiManager = new OptimizedAPIManager();

app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = +lastPart || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  
  console.log(`STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`);
  console.log(`PROTOCOL: ${apiManager.useHTTP2 ? 'HTTP/2' : 'HTTPS Keep-Alive'}`);
  console.log(`DISTRIBUTING ${count} requests across ${apiKeys.length} API keys`);
  
  let completed = 0;
  const results = { success: 0, failed: 0 };
  const startTime = Date.now();
  
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
          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(1);
          const successRate = (results.success / count * 100).toFixed(1);
          console.log(`ALL REQUESTS COMPLETE: ${results.success}/${count} successful (${successRate}%) in ${duration}s`);
        }
      }
    };
    
    apiManager.addRequest(keyIndex, requestData);
  }
});

app.listen(port, () => console.log(`Service running on port ${port}`));
