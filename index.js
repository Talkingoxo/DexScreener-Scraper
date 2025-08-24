const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');
app.post('/', async (req, res) => {
 const { url } = req.body;
 const referrer = req.get('Referer');
 res.status(200).send('ok');
 
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
 } else if (url) {
   const agent = new https.Agent({ keepAlive: false });
   try {
     const response = await fetch(url, {
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
     agent.destroy();
   } catch (error) {
     console.error('Fetch error:', error);
     agent.destroy();
   }
 }
});
app.get('/', (req, res) => {
 res.status(200).send('ok');
});
app.listen(port, () => {
 console.log(`Ping pong service running on port ${port}`);
});
