const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/', async (req, res) => {
 const { url } = req.body;
 res.status(200).send('ok');
 
 if (url) {
   const batchSize = 40;
   for (let i = 0; i < 76; i += batchSize) {
     const batch = [];
     for (let j = 0; j < batchSize && i + j < 76; j++) {
       batch.push(fetch(url, {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({}),
         timeout: 5000
       }).catch(() => {}));
     }
     await Promise.allSettled(batch);
     if (i + batchSize < 76) {
       await new Promise(resolve => setTimeout(resolve, 5));
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
