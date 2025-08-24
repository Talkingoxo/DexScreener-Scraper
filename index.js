const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');

  if (url) {
    const match = url.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const baseUrl = url.replace(/\/\d+$/, '');

    for (let i = 0; i < count; i++) {
      const agent = new https.Agent({ keepAlive: false });
      fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({ hit: i + 1 }),
        timeout: 8000,
        agent: agent
      }).then(r => r.text())
        .finally(() => agent.destroy())
        .catch(() => {});
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
