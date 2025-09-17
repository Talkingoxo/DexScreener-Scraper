const express = require('express');
const http2 = require('http2');
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
  const lastPart = url.slice(slashIndex + 1);
  const count = +lastPart || 1;
  const baseUrl = url.slice(0, slashIndex + 1);
  const targetUrl = encodeURIComponent(baseUrl);
  const session = http2.connect('https://api.scrapingant.com');
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const path = `/v2/general?x-api-key=${apiKey}&url=${targetUrl}&proxy_country=${country}&proxy_type=datacenter&browser=false`;
    const stream = session.request({ ':method': 'POST', ':path': path, 'content-type': 'application/json' });
    stream.on('response', () => {
      stream.on('data', () => {});
      stream.on('end', () => { if (++completed === count) session.close(); });
    });
    stream.on('error', () => { if (++completed === count) session.close(); });
    stream.end(`{"worker-id":${i}}`);
  }
});
app.listen(port, () => console.log(`Service running on port ${port}`));
