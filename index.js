const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');
  
  if (url) {
    // Send 76 requests to the URL
    const requests = [];
    
    for (let i = 0; i < 76; i++) {
      const agent = new https.Agent({ keepAlive: false });
      
      const requestPromise = fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({}),
        timeout: 8000,
        agent: agent
      })
      .then(async (response) => {
        await response.text();
        agent.destroy();
      })
      .catch((error) => {
        console.error(`Fetch error for request ${i + 1}:`, error);
        agent.destroy();
      });
      
      requests.push(requestPromise);
    }
    
    // Wait for all requests to complete
    try {
      await Promise.all(requests);
      console.log('All 76 requests completed');
    } catch (error) {
      console.error('Error completing requests:', error);
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
