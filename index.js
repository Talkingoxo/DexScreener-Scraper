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
  const { url } = req.body || {};
  log('INCOMING', url);
  res.end();
  if (!url) { log('NO_URL'); return; }
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = parseInt(lastPart, 10) || 1;
  const targetUrl = encodeURIComponent(url.slice(0, slashIndex + 1));
  log('PARSED', 'count', count, 'targetUrl', targetUrl);
  let enqueued = 0;
  for (let i = 0; i < count; i++) {
    const country = countries[i % countries.length];
    const body = JSON.stringify({ 'worker-id': i });
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?x-api-key=${apiKey}&url=${targetUrl}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'POST',
      agent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = https.request(options, (resp) => {
      let bytes = 0;
      resp.on('data', c => { bytes += c.length; });
      resp.on('end', () => {
        log('RESP_END', i, 'status', resp.statusCode, 'country', country, 'bytes', bytes, 'headers', JSON.stringify(resp.headers));
      });
    });
    r.on('socket', (socket) => {
      log('SOCKET', i, 'assigned', 'reused', socket.reusedSocket === true);
      socket.on('secureConnect', () => {
        log('TLS', i, 'secureConnect', 'local', socket.localAddress + ':' + socket.localPort, 'remote', socket.remoteAddress + ':' + socket.remotePort);
      });
      socket.on('close', (hadError) => { log('SOCKET_CLOSE', i, 'hadError', hadError); });
      socket.on('timeout', () => { log('SOCKET_TIMEOUT', i); });
      socket.on('error', (e) => { log('SOCKET_ERROR', i, e && e.message || e); });
    });
    r.on('finish', () => { log('REQ_FINISH', i); });
    r.on('close', () => { log('REQ_CLOSE', i); });
    r.on('timeout', () => { log('REQ_TIMEOUT', i); r.destroy(new Error('timeout')); });
    r.on('error', (e) => { log('REQ_ERROR', i, e && e.message || e); });
    r.setTimeout(20000);
    log('REQ_START', i, 'country', country, 'path', options.path, 'len', Buffer.byteLength(body));
    r.end(body);
    enqueued++;
  }
  const socketsCount = Object.values(agent.sockets).reduce((n, arr) => n + arr.length, 0);
  const requestsQueued = Object.values(agent.requests).reduce((n, arr) => n + arr.length, 0);
  log('ENQUEUED', enqueued, 'ACTIVE_SOCKETS', socketsCount, 'QUEUED_REQUESTS', requestsQueued);
});
app.listen(port, () => log('LISTENING', port));
