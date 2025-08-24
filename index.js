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
    let count = 1;
    let targetUrl = url;
    
    if (match) {
      count = parseInt(match[1]);
      targetUrl = url.replace(/\/\d+$/, '');
    }
    
    for (let i = 0; i < count; i++) {
      const agent = new https.Agent({ keepAlive: false });
      try {
        const response = await fetch(targetUrl, {
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
app.get('/', (req, res) => {
  res.status(200).send('ok');
});
app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
