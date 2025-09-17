const express = require('express');
const https = require('https');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use((err, req, res, next) => { fs.writeSync(2, `JSON_ERROR ${err && err.message ? err.message : String(err)}
`); res.status(400).end(); });
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
function out(s){ fs.writeSync(1, s + '
'); }
function err(s){ fs.writeSync(2, s + '
'); }
app.get('/__ping', (req, res) => { out('PING'); res.type('text').send('ok'); });
app.post('/', (req, res) => {
  const { url } = req.body || {};
  out(`INCOMING ${url || ''}`);
  res.end();
  if (!url) { err('NO_URL'); return; }
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = parseInt(lastPart, 10) || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  out(`START ${count}`);
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const postData = `{"worker-id":${i}}`;
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    out(`REQ ${i+1}/${count} ${country}`);
    const r = https.request(options, (resp) => {
      resp.on('data', () => {});
      resp.on('end', () => { completed++; out(`RESP ${i+1} ${resp.statusCode} ${country} ${completed}/${count}`); });
    });
    r.on('error', (e) => err(`ERR ${i+1} ${country} ${e && e.message || String(e)}`));
    r.setTimeout(20000, () => { err(`TIMEOUT ${i+1} ${country}`); r.destroy(new Error('timeout')); });
    r.end(postData);
  }
  out(`ENQUEUED ${count}`);
});
app.listen(port, () => out(`BOOT ${port}`));
