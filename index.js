const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
const apiKey = '2a33de63f0054f1cb33f5857a3fe00c5';
const agent = new https.Agent({ keepAlive: true, maxSockets: 1024 });
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
  let sent = 0;
  function sendNext(i) {
    if (i >= count) { log('DONE', 'sent', sent); return; }
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
      let bytes = 0;
      resp.on('data', c => { bytes += c.length; });
      resp.on('end', () => { log('RESP_END', i, 'status', resp.statusCode, 'country', country, 'bytes', bytes); sent++; sendNext(i + 1); });
    });
    r.on('socket', s => {
      log('SOCKET', i, s.reusedSocket === true ? 'reused' : 'new');
      s.on('secureConnect', () => { log('TLS', i, 'local', s.localAddress + ':' + s.localPort, 'remote', s.remoteAddress + ':' + s.remotePort); });
      s.on('close', h => { log('SOCKET_CLOSE', i, h); });
      s.on('timeout', () => { log('SOCKET_TIMEOUT', i); });
      s.on('error', e => { log('SOCKET_ERROR', i, e && e.message || e); });
    });
    r.on('finish', () => log('REQ_FINISH', i));
    r.on('close', () => log('REQ_CLOSE', i));
    r.on('timeout', () => { log('REQ_TIMEOUT', i); r.destroy(new Error('timeout')); sendNext(i + 1); });
    r.on('error', e => { log('REQ_ERROR', i, e && e.message || e); sendNext(i + 1); });
    r.setTimeout(20000);
    log('REQ_START', i, 'country', country);
    r.end(body);
  }
  sendNext(0);
});
app.listen(port, () => log('LISTENING', port));
