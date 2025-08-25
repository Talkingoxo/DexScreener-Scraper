const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  
  if (url) {
    let completed = 0;
    const target = 76;
    
    while (completed < target) {
      const remaining = target - completed;
      const batchSize = Math.min(remaining, 20);
      
      const results = await Promise.allSettled(
        Array(batchSize).fill().map(() => 
          fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}),
            timeout: 15000
          })
        )
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      completed += successful;
      
      if (completed < target && successful < batchSize) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
