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
  const session = http2.connect(u.origin);
  for (let i = 0; i < 76; i++) {
    const stream = session.request({':method': 'POST', ':path': u.pathname, 'content-type': 'application/json'});
    stream.write(JSON.stringify({}));
    stream.end();
  }
  setTimeout(() => session.destroy(), 1000);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
