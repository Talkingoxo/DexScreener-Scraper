const express = require('express');
const https = require('https');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
function out(s){ fs.writeSync(1, s + '
'); }
function err(s){ fs.writeSync(2, s + '
'); }
app.use((req,res,next)=>{ out(`HIT ${req.method} ${req.originalUrl}`); next(); });
function run(url,count){
  out(`START URL=${url} COUNT=${count}`);
  const targetUrl = url.endsWith('/') ? url : url + '/';
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const body = `{"worker-id":${i}}`;
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    out(`REQ ${i+1}/${count} ${country}`);
    const r = https.request(options, (resp) => {
      resp.on('data',()=>{});
      resp.on('end',()=>{ completed++; out(`RESP ${i+1} ${resp.statusCode} ${country} ${completed}/${count}`); });
    });
    r.on('error',(e)=>err(`ERR ${i+1} ${country} ${e && e.message || String(e)}`));
    r.end(body);
  }
  out(`ENQUEUED ${count}`);
}
app.get('/__ping',(req,res)=>{ out('PING'); res.type('text').send('ok'); });
app.get('/:n',(req,res)=>{ const n=parseInt(req.params.n,10)||1; const ref=req.query.url||'https://example.com/x/'; run(ref,n); res.send('ok'); });
app.post('/', (req, res) => {
  out('POST');
  const { url } = req.body || {};
  res.end();
  if (!url) { err('NO_URL'); return; }
  const si = url.lastIndexOf('/');
  const last = url.slice(si + 1);
  const count = parseInt(last, 10) || 1;
  const base = url.slice(0, si + 1);
  run(base,count);
});
app.listen(port, () => out(`BOOT ${port}`));
