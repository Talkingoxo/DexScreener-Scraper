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
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Send 76 requests without keeping references
    const sendRequest = async (index) => {
      const agent = new https.Agent({ 
        keepAlive: false,
        maxSockets: 1,
        timeout: 8000
      });
      
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
        
        // Don't store response, just consume and discard
        await response.text();
        agent.destroy();
      } catch (error) {
        console.error(`Request ${index + 1} error:`, error.message);
        agent.destroy();
      }
    };
    
    // Create and execute requests without storing promises
    const promises = Array.from({ length: 76 }, (_, i) => sendRequest(i));
    
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Batch error:', error.message);
    }
    
    // Clear any remaining references and force cleanup
    promises.length = 0;
    if (global.gc) {
      global.gc();
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
