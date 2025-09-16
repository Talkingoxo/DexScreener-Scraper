const express = require('express');
const http2 = require('http2');
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
  const session = http2.connect('https://api.scrapingant.com');
  console.log(`📡 SESSION CREATED for ${count} requests`);
  let completed = 0;
  session.on('error', (err) => console.log(`❌ SESSION ERROR:`, err.message));
  session.on('connect', () => console.log(`✅ SESSION CONNECTED`));
  for (let i = 0; i < count; i++) {
    const country = countries[i % 24];
    const apiPath = `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=2a33de63f0054f1cb33f5857a3fe00c5&proxy_country=${country}&proxy_type=datacenter&browser=false`;
    console.log(`🔄 REQUEST ${i+1}/${count}: Country=${country}`);
    const stream = session.request({':method': 'POST', ':path': apiPath, 'content-type': 'application/json'});
    stream.write(`{"worker-id":${i}}`);
    stream.end();
    stream.on('response', (headers) => console.log(`📥 RESPONSE ${i+1}: Status=${headers[':status']}`));
    stream.on('error', (err) => console.log(`💥 STREAM ${i+1} ERROR:`, err.message));
    stream.on('close', () => { 
      completed++;
      console.log(`✅ STREAM ${i+1} CLOSED. Completed: ${completed}/${count}`);
      if (completed === count) {
        console.log(`🏁 ALL REQUESTS COMPLETE. Destroying session.`);
        session.destroy();
      }
    });
  }
  console.log(`🎯 LOOP COMPLETED: Created ${count} streams`);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
