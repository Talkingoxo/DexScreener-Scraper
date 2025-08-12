const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/', async (req, res) => {
  res.status(200).send('ok');
  const { url } = req.body;
  if (url) {
    await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'}
    });
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
