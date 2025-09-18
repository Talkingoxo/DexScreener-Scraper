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

let testResults = {};
let testPhase = 0;

function makeRequest(targetUrl, keyIndex, requestId, callback) {
  const apiKey = apiKeys[keyIndex];
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
      callback(res.statusCode);
    });
  });
  
  req.on('error', (err) => {
    console.log(`REQUEST ${requestId} ERROR: ${err.message}, Key=${apiKey.slice(-8)}`);
    callback(500);
  });
  
  req.write(postData);
  req.end();
}

// Phase 1: Test each key with 5 rapid requests
function phase1Test(targetUrl) {
  console.log('PHASE 1: Testing 5 rapid requests per key');
  testResults.phase1 = {};
  
  apiKeys.forEach((key, keyIndex) => {
    testResults.phase1[key.slice(-8)] = [];
    
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        makeRequest(targetUrl, keyIndex, keyIndex * 5 + i, (status) => {
          testResults.phase1[key.slice(-8)].push(status);
          
          if (testResults.phase1[key.slice(-8)].length === 5) {
            const successCount = testResults.phase1[key.slice(-8)].filter(s => s === 200).length;
            console.log(`KEY ${key.slice(-8)}: ${successCount}/5 successful requests`);
            
            const allKeysComplete = Object.values(testResults.phase1).every(arr => arr.length === 5);
            if (allKeysComplete) {
              console.log('PHASE 1 COMPLETE. Waiting 60 seconds...');
              setTimeout(() => phase2Test(targetUrl), 60000);
            }
          }
        });
      }, i * 200);
    }
  });
}

// Phase 2: Test with calculated delays (12 seconds between requests per key)
function phase2Test(targetUrl) {
  console.log('PHASE 2: Testing with 12-second delays per key');
  testResults.phase2 = {};
  const delayBetweenRequests = 12000; // 60s / 5 requests = 12s
  
  apiKeys.forEach((key, keyIndex) => {
    testResults.phase2[key.slice(-8)] = [];
    
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        makeRequest(targetUrl, keyIndex, keyIndex * 5 + i + 50, (status) => {
          testResults.phase2[key.slice(-8)].push(status);
          
          if (testResults.phase2[key.slice(-8)].length === 5) {
            const successCount = testResults.phase2[key.slice(-8)].filter(s => s === 200).length;
            console.log(`KEY ${key.slice(-8)}: ${successCount}/5 successful with 12s delay`);
            
            const allKeysComplete = Object.values(testResults.phase2).every(arr => arr.length === 5);
            if (allKeysComplete) {
              console.log('PHASE 2 COMPLETE. Waiting 60 seconds...');
              setTimeout(() => phase3Test(targetUrl), 60000);
            }
          }
        });
      }, keyIndex * 1200 + i * delayBetweenRequests);
    }
  });
}

// Phase 3: Advanced testing - round robin with optimal spacing
function phase3Test(targetUrl) {
  console.log('PHASE 3: Round-robin testing with 6-second intervals');
  testResults.phase3 = {};
  
  apiKeys.forEach(key => {
    testResults.phase3[key.slice(-8)] = [];
  });
  
  let requestCounter = 0;
  const totalRequests = 50; // 5 per key
  const intervalBetweenRequests = 6000; // 6 seconds
  
  const interval = setInterval(() => {
    if (requestCounter >= totalRequests) {
      clearInterval(interval);
      console.log('PHASE 3 COMPLETE');
      analyzeResults();
      return;
    }
    
    const keyIndex = requestCounter % 10;
    makeRequest(targetUrl, keyIndex, requestCounter + 100, (status) => {
      const keyId = apiKeys[keyIndex].slice(-8);
      testResults.phase3[keyId].push(status);
      
      if (status === 200) {
        console.log(`SUCCESS: Key ${keyId} - Request ${requestCounter + 1}`);
      } else {
        console.log(`FAILED: Key ${keyId} - Request ${requestCounter + 1} - Status ${status}`);
      }
    });
    
    requestCounter++;
  }, intervalBetweenRequests);
}

function analyzeResults() {
  console.log('\n=== FINAL ANALYSIS ===');
  
  apiKeys.forEach(key => {
    const keyId = key.slice(-8);
    const phase1Success = testResults.phase1[keyId]?.filter(s => s === 200).length || 0;
    const phase2Success = testResults.phase2[keyId]?.filter(s => s === 200).length || 0;
    const phase3Success = testResults.phase3[keyId]?.filter(s => s === 200).length || 0;
    
    console.log(`KEY ${keyId}: Phase1=${phase1Success}/5, Phase2=${phase2Success}/5, Phase3=${phase3Success}/5`);
  });
  
  const totalPhase1 = Object.values(testResults.phase1).flat().filter(s => s === 200).length;
  const totalPhase2 = Object.values(testResults.phase2).flat().filter(s => s === 200).length;
  const totalPhase3 = Object.values(testResults.phase3).flat().filter(s => s === 200).length;
  
  console.log(`\nTOTAL SUCCESS RATES:`);
  console.log(`Phase 1 (Rapid): ${totalPhase1}/50 (${(totalPhase1/50*100).toFixed(1)}%)`);
  console.log(`Phase 2 (12s delay): ${totalPhase2}/50 (${(totalPhase2/50*100).toFixed(1)}%)`);
  console.log(`Phase 3 (Round-robin): ${totalPhase3}/50 (${(totalPhase3/50*100).toFixed(1)}%)`);
  
  const bestPhase = totalPhase3 > totalPhase2 && totalPhase3 > totalPhase1 ? 'Phase 3' : 
                   totalPhase2 > totalPhase1 ? 'Phase 2' : 'Phase 1';
  console.log(`OPTIMAL STRATEGY: ${bestPhase}`);
}

app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  
  const slashIndex = url.lastIndexOf('/');
  const targetUrl = url.slice(0, slashIndex + 1);
  
  console.log(`STARTING COMPREHENSIVE API KEY TESTING: TARGET=${targetUrl}`);
  phase1Test(targetUrl);
});

app.listen(port, () => console.log(`Service running on port ${port}`));
