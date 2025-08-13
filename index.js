const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  if (url) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({}),
        timeout: 10000,
        agent: false
      });
      await response.text();
      console.log('Successfully triggered:', url);
    } catch (error) {
      console.error('Fetch error to', url, ':', error.message);
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
