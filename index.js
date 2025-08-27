const express = require('express');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// 🛠 Agents tuned: no dead connections kept
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 0,   // important: don't keep dead ones around
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 0,
});

// helper fetch with retry on ECONNRESET
async function safeFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (err.code === 'ECONNRESET') {
      console.log('⚠️ ECONNRESET, retrying with fresh agent');
      // retry with a one-off agent (no keepAlive)
      const freshAgent = url.startsWith('https://')
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
      return fetch(url, { ...options, agent: freshAgent });
    }
    throw err;
  }
}

app.post('/', async (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');

  if (url) {
    const agent = url.startsWith('https://') ? httpsAgent : httpAgent;
    for (let i = 0; i < 76; i++) {
      safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        agent,
      }).catch(() => {});
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
