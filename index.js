const express = require('express');
const http2 = require('http2');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/', (req, res) => {
  const { url } = req.body;
  res.send('ok');

  if (!url) return;

  const u = new URL(url);
  const client = http2.connect(u.origin);

  client.on('error', () => client.close());

  client.once('connect', () => {
    for (let i = 0; i < 76; i++) {
      const stream = client.request({
        ':method': 'POST',
        ':path': u.pathname,
        'content-type': 'application/json'
      });
      stream.write('{}');
      stream.end();
    }
    client.close(); // ✅ close so no half-dead session remains
  });
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
