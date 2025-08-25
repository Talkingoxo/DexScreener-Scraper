const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  
  if (url) {
    const requests = Array(76).fill().map(() => 
      fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
        timeout: 30000
      }).catch(() => {})
    );
    
    Promise.all(requests);
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
