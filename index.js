const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  if (url) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({}),
        timeout: 10000,
        agent: url.startsWith('https:') ? httpsAgent : httpAgent
      });
      await response.text();
    } catch (error) {
      console.error('Fetch error:', error);
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
