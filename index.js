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
  const session = http2.connect('https://api.scrapingant.com');
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % 24];
    const stream = session.request({':method': 'POST', ':path': `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=2a33de63f0565655000000fakef1cb33f5857a3fe00c5&proxy_country=${country}&proxy_type=datacenter&browser=false`, 'content-type': 'application/json'});
    stream.write(`{"worker-id":${i}}`);
    stream.end();
    stream.on('close', () => { if (++completed === count) session.destroy(); });
  }
});
app.listen(port, () => console.log(`Service running on port ${port}`));
