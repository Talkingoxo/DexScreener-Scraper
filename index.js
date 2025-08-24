const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  const referrer = req.get('Referer');
  res.status(200).send('triggered');
  
  if (referrer) {
    const match = referrer.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const baseUrl = referrer.replace(/\/\d+$/, '');
    
    for (let i = 0; i < count; i++) {
      fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hit: i + 1 }),
        timeout: 5000
      }).catch(() => {});
    }
  }
});

app.listen(port, () => {
  console.log(`Cronjob running on port ${port}`);
});
