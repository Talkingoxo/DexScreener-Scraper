const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Disable keep-alive globally
app.use((req, res, next) => {
  res.setHeader('Connection', 'close');
  next();
});

app.use(express.json({ limit: '1kb' }));
const https = require('https');

// Clear any timers/intervals that might accumulate
const clearAllTimers = () => {
  const highestTimeoutId = setTimeout(';');
  for (let i = highestTimeoutId; i >= 0; i--) {
    clearTimeout(i);
  }
  const highestIntervalId = setInterval(';');
  for (let i = highestIntervalId; i >= 0; i--) {
    clearInterval(i);
  }
};

app.post('/', async (req, res) => {
  // Immediately respond and close connection
  res.status(200).send('ok');
  res.end();
  
  const { url } = req.body;
  
  if (url) {
    // Force aggressive cleanup before starting
    if (global.gc) global.gc();
    clearAllTimers();
    
    // Use setImmediate to prevent blocking and accumulation
    setImmediate(async () => {
      try {
        // Send all 76 requests in batches to prevent accumulation
        for (let batch = 0; batch < 4; batch++) {
          const batchPromises = [];
          const batchSize = batch === 3 ? 4 : 24; // Last batch has 4, others have 24
          
          for (let i = 0; i < batchSize; i++) {
            const agent = new https.Agent({
              keepAlive: false,
              maxSockets: 1,
              maxFreeSockets: 0,
              timeout: 5000,
              freeSocketTimeout: 0
            });
            
            const promise = fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Connection': 'close',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              },
              body: JSON.stringify({}),
              timeout: 5000,
              agent: agent
            })
            .then(async (response) => {
              const text = await response.text();
              response = null; // Explicit nullification
              agent.destroy();
              return null;
            })
            .catch((error) => {
              agent.destroy();
              return null;
            });
            
            batchPromises.push(promise);
          }
          
          await Promise.all(batchPromises);
          
          // Aggressive cleanup after each batch
          batchPromises.length = 0;
          if (global.gc) global.gc();
          
          // Small delay between batches to prevent accumulation
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Final cleanup
        clearAllTimers();
        if (global.gc) global.gc();
        
      } catch (error) {
        console.error('Batch processing error:', error.message);
        clearAllTimers();
        if (global.gc) global.gc();
      }
    });
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Ping pong service running on port ${port}`);
});
