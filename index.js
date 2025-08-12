const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/', async (req, res) => {
  res.status(200).send('ok');
  const { url } = req.body;
  if (url) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        timeout: 30000
      });
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
