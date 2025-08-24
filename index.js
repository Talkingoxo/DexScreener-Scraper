app.get('/', async (req, res) => {
  const referrer = req.get('Referer');
  res.status(200).send('ok');
  
  if (referrer && referrer.includes('/')) {
    const match = referrer.match(/\/(\d+)$/);
    if (match) {
      const count = parseInt(match[1], 10);
      const baseUrl = referrer.replace(/\/\d+$/, '');
      
      for (let i = 0; i < count; i++) {
        const agent = new https.Agent({ keepAlive: false });
        try {
          const response = await fetch(baseUrl, {
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
    }
  }
});
