const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');

app.get('/', async (req, res) => {
  const referrer = req.get('Referer') || req.get('Referrer');
  res.status(200).send('ok');
  
  if (referrer) {
    const match = referrer.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    
    for (let i = 0; i < count; i++) {
      const agent = new https.Agent({ keepAlive: false });
      try {
        const response = await fetch(referrer, {
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
  }
});

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  if (url) {
    const match = url.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    for (let i = 0; i < count; i++) {
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
  }
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
