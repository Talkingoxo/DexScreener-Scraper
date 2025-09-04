const express = require('express');
const http2 = require('http2');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

function rid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function now() { return new Date().toISOString(); }

app.post('/', (req, res) => {
  const reqId = rid();
  const t0 = process.hrtime.bigint();
  const log = (event, data) => {
    try { process.stdout.write(JSON.stringify({ ts: now(), t: Number((process.hrtime.bigint() - t0) / 1000000n), event, reqId, ...data }) + '\n'); } catch (e) {}
  };

  const body = req.body || {};
  log('inbound.received', { bodyType: typeof body });
  const { url } = body;
  res.status(200).send('ok');
  if (!url) { log('inbound.no_url', {}); return; }

  let u;
  try { u = new URL(url); } catch (e) { log('parse.error', { url }); return; }

  const path = u.pathname;
  const lastSlash = path.lastIndexOf('/');
  const lastPart = path.slice(lastSlash + 1);
  const count = +lastPart || 1;
  const targetPath = count === 1 ? path : path.slice(0, lastSlash + 1);
  log('outbound.plan', { origin: u.origin, protocol: u.protocol, authority: u.host, path, targetPath, count });

  const session = http2.connect(u.origin);
  const streams = new Map();
  let connected = false;

  session.on('connect', () => {
    connected = true;
    const s = session.socket;
    log('h2.connect', { alpn: s.alpnProtocol, localAddress: s.localAddress, localPort: s.localPort, remoteAddress: s.remoteAddress, remotePort: s.remotePort, servername: s.servername });
    log('h2.settings', { local: session.localSettings, remote: session.remoteSettings });
  });

  session.on('goaway', (code, lastStreamID, opaque) => { log('h2.goaway', { code, lastStreamID, opaque: opaque ? opaque.toString('hex') : '' }); });
  session.on('origin', (origins) => { log('h2.origin', { origins }); });
  session.on('altsvc', (alt, origin, streamId) => { log('h2.altsvc', { alt, origin, streamId }); });
  session.on('frameError', (type, code, id) => { log('h2.frameError', { type, code, id }); });
  session.on('error', (err) => { log('h2.error', { message: err && err.message ? err.message : String(err) }); });
  session.on('close', () => { log('h2.close', { outstanding: streams.size }); });

  for (let i = 0; i < count; i++) {
    const sid = rid();
    const headers = { ':method': 'POST', ':path': targetPath, 'content-type': 'application/json' };
    const stream = session.request(headers);
    streams.set(sid, stream);
    log('stream.request', { sid, i, headers });

    stream.setEncoding('utf8');
    let bytes = 0;
    let chunks = 0;
    let status = null;

    stream.on('response', (h, flags) => {
      status = h[':status'] || null;
      log('stream.response', { sid, status, flags, headers: h });
    });

    stream.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); chunks++; });
    stream.on('end', () => { log('stream.end', { sid, status, bytes, chunks }); streams.delete(sid); });
    stream.on('error', (err) => { log('stream.error', { sid, message: err && err.message ? err.message : String(err) }); });
    stream.on('close', () => { log('stream.close', { sid }); });

    try { stream.write(JSON.stringify({})); } catch (e) { log('stream.write.error', { sid, message: e && e.message ? e.message : String(e) }); }
    try { stream.end(); } catch (e) { log('stream.end.error', { sid, message: e && e.message ? e.message : String(e) }); }
  }

  setTimeout(() => { log('h2.destroy.timer', { connected, outstanding: streams.size }); session.destroy(); }, 1000);
});

process.on('uncaughtException', (e) => { process.stdout.write(JSON.stringify({ ts: now(), event: 'process.uncaughtException', message: e && e.message ? e.message : String(e) }) + '\n'); });
process.on('unhandledRejection', (e) => { process.stdout.write(JSON.stringify({ ts: now(), event: 'process.unhandledRejection', message: e && e.message ? e.message : String(e) }) + '\n'); });

app.listen(port, () => process.stdout.write(JSON.stringify({ ts: now(), event: 'startup', port }) + '\n'));
