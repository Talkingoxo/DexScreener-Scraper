const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.post('/', (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  if (!url) return;
  const u = new URL(url);
  const path = u.pathname;
  const lastSlash = path.lastIndexOf('/');
  const lastPart = path.slice(lastSlash + 1);
  const count = +lastPart || 1;
  const targetPath = count === 1 ? path : path.slice(0, lastSlash + 1);
  const session = http2.connect(u.origin);
  for (let i = 0; i < count; i++) {
    const stream = session.request({':method': 'POST', ':path': targetPath, 'content-type': 'application/json'});
    stream.write(JSON.stringify({}));
    stream.end();
  }
  setTimeout(() => session.destroy(), 1000);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
