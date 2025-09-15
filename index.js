const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  const slashIndex = url.lastIndexOf('/');
  const count = parseInt(url.slice(slashIndex + 1), 10) || 1;
  const targetUrl = encodeURIComponent(url.slice(0, slashIndex + 1));
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const body = JSON.stringify({ 'worker-id': i });
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?x-api-key=${apiKey}&url=${targetUrl}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = https.request(options);
    r.on('error', () => {});
    r.end(body);
  }
});
app.listen(port);
