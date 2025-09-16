const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = +lastPart || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
  console.log(`🚀 STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`);
  let completed = 0;
  console.log(`⏰ SCHEDULING ${count} requests with 2s intervals`);
  for (let i = 0; i < count; i++) {
    const delay = i * 2000;
    console.log(`📅 SCHEDULED REQUEST ${i+1}/${count} for ${delay/1000}s delay`);
    setTimeout(() => {
      const country = countries[i % 24];
      const postData = `{"worker-id":${i}}`;
      const options = {
        hostname: 'api.scrapingant.com',
        port: 443,
        path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=2a33de63f0054f1cb33f5857a3fe00c5&proxy_country=${country}&proxy_type=datacenter&browser=false`,
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': postData.length}
      };
      console.log(`🔄 EXECUTING REQUEST ${i+1}/${count}: Country=${country} at ${new Date().toISOString()}`);
      const req = https.request(options, (res) => {
        console.log(`📥 RESPONSE ${i+1}: Status=${res.statusCode} at ${new Date().toISOString()}`);
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          completed++;
          console.log(`✅ REQUEST ${i+1} COMPLETED. Total: ${completed}/${count}. Body length: ${responseBody.length}`);
          if (res.statusCode !== 200) {
            console.log(`⚠️ NON-200 RESPONSE ${i+1}: ${responseBody.substring(0, 200)}`);
          }
        });
      });
      req.on('error', (err) => {
        console.log(`💥 REQUEST ${i+1} ERROR at ${new Date().toISOString()}:`, err.message);
        completed++;
        console.log(`❌ REQUEST ${i+1} FAILED. Total completed: ${completed}/${count}`);
      });
      req.on('timeout', () => {
        console.log(`⏱️ REQUEST ${i+1} TIMEOUT at ${new Date().toISOString()}`);
        req.abort();
      });
      req.setTimeout(30000);
      req.write(postData);
      req.end();
      console.log(`📤 REQUEST ${i+1} SENT`);
    }, delay);
  }
  console.log(`🎯 ALL ${count} REQUESTS SCHEDULED SUCCESSFULLY`);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
