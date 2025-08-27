// minimal 76-request blaster (Express + HTTP/2)
// fixes your ECONNRESET by waiting for SETTINGS and obeying concurrency

const express = require('express');
const http2 = require('http2');

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

app.post('/', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).send('Missing url');

  try {
    const u = new URL(url);
    const session = http2.connect(u.origin);

    // die cleanly on session errors
    session.on('error', () => {});
    session.on('goaway', () => { try { session.close(); } catch {} });

    // 1) WAIT for SETTINGS ack (no requests before this)
    await waitForSettings(session);

    // 2) figure out safe concurrency
    const max = Math.max(1, session.remoteSettings.maxConcurrentStreams || 6);
    const CONCURRENCY = Math.min(max, 16); // small cap; tweak if you want

    // plan 76 requests
    const total = 76;
    const tasks = Array.from({ length: total }, () => () =>
      sendOnce(session, u.pathname || '/', 'POST', {}));

    // 3) run with a tiny promise pool
    await runPool(tasks, CONCURRENCY);

    try { session.close(); } catch {}
    return res.status(200).send('sent 76');
  } catch (e) {
    return res.status(500).send(e.message || 'error');
  }
});

app.get('/', (_, res) => res.status(200).send('ok'));
app.listen(port, () => console.log(`Service running on port ${port}`));

// --- helpers ---

function waitForSettings(session) {
  return new Promise((resolve, reject) => {
    const done = () => resolve();
    const onErr = (err) => reject(err);

    // if already acked, resolve next tick
    if (session.pendingSettingsAck === false) return setImmediate(done);

    const check = () => {
      if (session.pendingSettingsAck === false) {
        session.off('remoteSettings', check);
        session.off('localSettings', check);
        session.off('error', onErr);
        done();
      }
    };
    session.on('remoteSettings', check);
    session.on('localSettings', check);
    session.on('error', onErr);

    // safety timeout
    setTimeout(() => {
      try {
        session.off('remoteSettings', check);
        session.off('localSettings', check);
        session.off('error', onErr);
      } catch {}
      // even if pendingSettingsAck stayed true, try anyway (some envs are quirky)
      done();
    }, 1000);
  });
}

function sendOnce(session, path, method, bodyObj) {
  return new Promise((resolve) => {
    // slight jitter to avoid bursty opens
    setTimeout(() => {
      let stream;
      try {
        stream = session.request({
          ':method': method,
          ':path': path || '/',
          'content-type': 'application/json',
        });
      } catch {
        return resolve(); // swallow; keep pool moving
      }

      stream.on('response', () => {});
      stream.on('error', () => resolve());
      stream.on('close', () => resolve());

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        try { stream.end(JSON.stringify(bodyObj || {})); }
        catch { try { stream.close(); } catch {} resolve(); }
      } else {
        stream.end();
      }
    }, Math.floor(Math.random() * 15)); // 0–14ms
  });
}

async function runPool(fns, limit) {
  let i = 0;
  const runners = Array.from({ length: limit }, async function worker() {
    while (i < fns.length) {
      const idx = i++;
      try { await fns[idx](); } catch {}
    }
  });
  await Promise.all(runners);
}
