const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
const agent = new https.Agent({ keepAlive: true, maxSockets: Number.POSITIVE_INFINITY });
function log() { console.log(new Date().toISOString(), ...arguments); }
process.on('uncaughtException', e => log('UNCAUGHT', e && e.stack || e));
process.on('unhandledRejection', e => log('UNHANDLED', e && e.stack || e));
app.post('/', (req, res) => {
  const bodyUrl = req.body && req.body.url;
  log('INCOMING', bodyUrl);
  res.end();
  if (!bodyUrl) { log('NO_URL'); return; }
  const si = bodyUrl.lastIndexOf('/');
  const last = bodyUrl.slice(si + 1);
  const count = parseInt(last, 10) || 1;
  const targetUrl = encodeURIComponent(bodyUrl.slice(0, si + 1));
  log('PARSED', 'count', count, 'targetUrl', targetUrl);
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const body = JSON.stringify({ 'worker-id': i });
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      method: 'POST',
      agent,
      path: `/v2/general?x-api-key=${apiKey}&url=${targetUrl}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = https.request(options, resp => {
      resp.resume();
      resp.on('end', () => {
        log('RESP_END', i, 'status', resp.statusCode, 'country', country);
        if (++completed === count) log('DONE', 'sent', completed);
      });
    });
    r.on('error', e => {
      log('REQ_ERROR', i, e && e.message || e);
      if (++completed === count) log('DONE', 'sent', completed);
    });
    r.setTimeout(20000, () => { log('REQ_TIMEOUT', i); r.destroy(new Error('timeout')); });
    log('REQ_START', i, 'country', country);
    r.end(body);
  }
});
app.listen(port, () => log('LISTENING', port));
