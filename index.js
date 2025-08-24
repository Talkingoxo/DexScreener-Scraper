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
    const agent = new https.Agent({ keepAlive: false });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({}),
        timeout: 8000,
        agent: agent
      });
      await response.text();
      agent.destroy();
    } catch (error) {
      console.error('Fetch error:', error);
      agent.destroy();
    }
  }
});

app.get('/', async (req, res) => {
  const referrer = req.get('Referer');
  res.status(200).send('ok');
  
  if (referrer) {
    const match = referrer.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const baseUrl = referrer.replace(/\/\d+$/, '');
    
    for (let i = 0; i < count; i++) {
      const agent = new https.Agent({ keepAlive: false });
      fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({}),
        timeout: 8000,
        agent: agent
      }).then(() => agent.destroy()).catch(() => agent.destroy());
    }
  }
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
