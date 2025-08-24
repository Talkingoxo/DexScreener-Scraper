app.get('/', async (req, res) => {
  const referrer = req.get('Referer') || req.get('Referrer');
  res.status(200).send('ok');
  
  if (referrer) {
    const match = referrer.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const targetUrl = match ? referrer.slice(0, -match[0].length) : referrer;
    
    for (let i = 0; i < count; i++) {
      const agent = new https.Agent({ keepAlive: false });
      try {
        const response = await fetch(targetUrl, {
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
});
