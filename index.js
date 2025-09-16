const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
https.globalAgent.maxSockets = Infinity;
const agent = new https.Agent({ keepAlive: false, maxSockets: Infinity });
const log = (m, ...a) => process.stdout.write(`${new Date().toISOString()} ${m} ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}
`);
process.on('uncaughtException', e => log('UNCAUGHT', e && e.stack || String(e)));
process.on('unhandledRejection', e => log('UNHANDLED', e && e.stack || String(e)));
app.post('/', (req, res) => {
  const u = req.body && req.body.url;
  log('INCOMING', u || '');
  res.end();
  if (!u) return;
  let count = 1, target;
  try {
    const p = new URL(u);
    const segs = p.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1] || '';
    count = parseInt(last, 10) || 1;
    segs.pop();
    p.pathname = '/' + segs.join('/') + (segs.length ? '/' : '');
    p.search = '';
    target = encodeURIComponent(p.toString());
  } catch (e) { log('PARSE_ERROR', String(e)); return; }
  log('PARSED', 'count', String(count), 'targetUrl', target);
  let done = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const body = JSON.stringify({ 'worker-id': i });
    const reqOpts = {
      hostname: 'api.scrapingant.com',
      port: 443,
      method: 'POST',
      agent,
      path: `/v2/general?x-api-key=${apiKey}&url=${target}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = https.request(reqOpts, resp => {
      let bytes = 0;
      resp.on('data', c => { bytes += c.length; });
      resp.on('end', () => { log('RESP_END', String(i), 'status', String(resp.statusCode || ''), 'country', country, 'bytes', String(bytes)); if (++done === count) log('DONE', String(done)); });
    });
    r.on('error', e => { log('REQ_ERROR', String(i), String(e && e.message || e)); if (++done === count) log('DONE', String(done)); });
    r.setTimeout(20000, () => { log('REQ_TIMEOUT', String(i)); r.destroy(new Error('timeout')); });
    log('REQ_START', String(i), 'country', country);
    r.end(body);
  }
});
app.listen(port, () => log('LISTENING', String(port)));
