const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');

console.log('Server starting...');

app.post('/', async (req, res) => {
  const { url } = req.body;
  console.log('POST received with URL:', url);
  res.status(200).send('ok');
  if (url) {
    const match = url.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const baseUrl = match ? url.replace(/\/\d+$/, '') : url;
    
    console.log('Match found:', !!match, 'Count:', count, 'Base URL:', baseUrl);
    
    for (let i = 0; i < count; i++) {
      console.log('Sending request', i + 1, 'of', count, 'to:', baseUrl);
      const agent = new https.Agent({ keepAlive: false });
      try {
        const response = await fetch(baseUrl, {
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
        console.log('Request', i + 1, 'completed');
        agent.destroy();
      } catch (error) {
        console.error('Fetch error for request', i + 1, ':', error);
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
