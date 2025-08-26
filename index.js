const express = require('express');
const http2 = require('http2');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const sessions = {};

app.post('/', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send('missing url');

  const u = new URL(url);
  const key = `${u.protocol}//${u.host}`;

  const fire = (session) => {
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
      } catch (err) {
        console.log(`Stream ${i + 1} creation failed:`, err.message);
      }
    }
  };

  const createSession = () => {
    console.log('⚡ Creating new session for', key);
    const session = http2.connect(u.origin);

    sessions[key] = session;

    session.on('error', (err) => {
      console.log('Session error:', err.code, err.message);
      delete sessions[key];
    });

    session.on('close', () => {
      console.log('Session closed');
      delete sessions[key];
    });

    session.once('connect', () => {
      console.log('✅ Session connected');
      fire(session);
    });

    return session;
  };

  // ✅ Only reuse if session is clearly alive
  const s = sessions[key];
  if (
    !s ||
    s.destroyed ||
    s.closed ||
    !s.socket ||
    s.socket.destroyed
  ) {
    createSession();
  } else {
    console.log('♻️ Using existing session');
    fire(s);
  }

  res.send('ok');
});

app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});
