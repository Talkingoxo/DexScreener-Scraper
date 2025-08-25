const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
let processing = false;
app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  if (url && !processing) {
    processing = true;
    const match = url.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const baseUrl = match ? url.replace(/\/\d+$/, '') : url;
    for (let i = 0; i < count; i++) {
      await fetch(baseUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({})}).catch(() => {});
    }
    processing = false;
  }
});
app.get('/', (req, res) => {res.status(200).send('ok');});
app.listen(port, () => {console.log(`Ping pong service running on port ${port}`);});
