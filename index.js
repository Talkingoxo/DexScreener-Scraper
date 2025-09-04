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
  const baseUrl = url.slice(0, slashIndex + 1);
  const session = http2.connect(baseUrl);
  let completed = 0;
  for (let i = 0; i < count; i++) {
    const stream = session.request({':method': 'POST', ':path': '/', 'content-type': 'application/json'});
    stream.write(`{"worker-id":${i}}`);
    stream.end();
    stream.on('close', () => { if (++completed === count) session.destroy(); });
  }
});
app.listen(port, () => console.log(`Service running on port ${port}`));
