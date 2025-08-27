const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Session cache
const sessions = {};

function getSession(u) {
  const key = `${u.protocol}//${u.host}`;

  const s = sessions[key];
  if (s && !s.destroyed && !s.closed && s.socket && !s.socket.destroyed) {
    return s;
  }

  console.log('⚡ Creating new session for', key);
  const session = http2.connect(u.origin);

  sessions[key] = session;

  session.on('error', (err) => {
    console.log('Session error:', err.code, err.message);
    delete sessions[key];
  });

  session.on('close', () => {
    console.log('Session closed for', key);
    delete sessions[key];
  });

  return session;
}

app.post('/', (req, res) => {
  const { url } = req.body;
  res.status(200).send('ok');

  if (!url) return;

  const u = new URL(url);
  const session = getSession(u);

  for (let i = 0; i < 76; i++) {
    try {
      const stream = session.request({
        ':method': 'POST',
        ':path': u.pathname,
        'content-type': 'application/json',
      });

      stream.write(JSON.stringify({}));
      stream.end();

      stream.on('response', (headers) => {
        console.log(`Stream ${i + 1} response:`, headers[':status']);
      });

      stream.on('error', (err) => {
        console.log(`Stream ${i + 1} error:`, err.code, err.message);
      });

      stream.on('close', () => {
        // optional debug
      });
    } catch (err) {
      console.log(`Stream ${i + 1} creation failed:`, err.message);
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
