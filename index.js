const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.post('/', (req, res) => {
  const reqId = Date.now();
  console.log(`[${reqId}] POST received:`, JSON.stringify(req.body));
  const { url } = req.body;
  res.status(200).send('ok');
  console.log(`[${reqId}] Response sent: ok`);
  if (!url) {
    console.log(`[${reqId}] No URL provided, exiting`);
    return;
  }
  console.log(`[${reqId}] Processing URL:`, url);
  const u = new URL(url);
  console.log(`[${reqId}] Parsed URL - origin:`, u.origin, 'pathname:', u.pathname);
  const path = u.pathname;
  const lastSlash = path.lastIndexOf('/');
  const lastPart = path.slice(lastSlash + 1);
  console.log(`[${reqId}] Last path part:`, lastPart);
  const count = +lastPart || 1;
  console.log(`[${reqId}] Extracted count:`, count);
  const targetPath = count === 1 ? path : path.slice(0, lastSlash + 1);
  console.log(`[${reqId}] Target path:`, targetPath);
  console.log(`[${reqId}] Creating HTTP/2 session to:`, u.origin);
  const session = http2.connect(u.origin);
  console.log(`[${reqId}] Session created, starting ${count} requests`);
  for (let i = 0; i < count; i++) {
    console.log(`[${reqId}] Creating stream ${i + 1}/${count}`);
    const stream = session.request({':method': 'POST', ':path': targetPath, 'content-type': 'application/json'});
    stream.write(JSON.stringify({}));
    stream.end();
    stream.on('response', (headers) => console.log(`[${reqId}] Stream ${i + 1} response:`, headers[':status']));
    stream.on('error', (err) => console.log(`[${reqId}] Stream ${i + 1} error:`, err.code));
  }
  console.log(`[${reqId}] All streams created, destroying session`);
  session.destroy();
  console.log(`[${reqId}] Session destroyed`);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
