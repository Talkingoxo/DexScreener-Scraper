const express = require('express');
const http2 = require('http2');
const app = express();
app.use(express.json());
app.set('trust proxy', true);

const apiKeys = ['00a5af9578784f0d9c96e4fccd458b4b','800b76f2e1bb4e8faea57d2add88601f','a180661526ac40eeaafe5d1a90d11b52','ae5ce549f49c4b17ab69b4e2f34fcc2e','cd8dfbb8ab4745eab854614cca70a5d8','34499358b9fd46a1a059cfd96d79db42','7992bcd991df4f639e8941c68186c7fc','fdd914f432d748889371e0307691c835','41f5cebd207042dd8a8acac2329ddb32','f6d87ae9284543e3b2d14f11a36e1dcd'];
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];

const tokens = new Map();

class KeyManager {
  constructor() {
    this.queue = [];
    this.workers = {};
    this.processing = new Set();
    this.winners = [];
    apiKeys.forEach(k => { this.workers[k] = { session: null, busy: false }; });
  }
  getSession(key) {
    const w = this.workers[key];
    if (!w.session || w.session.destroyed || w.session.closed) {
      w.session = http2.connect('https://api.scrapingant.com');
      w.session.on('error', () => { w.session = null; w.busy = false; });
      w.session.on('close', () => { w.session = null; w.busy = false; });
      w.session.on('goaway', () => { w.session = null; w.busy = false; });
    }
    return w.session;
  }
  add(task) { this.queue.push(task); this.process(); }
  process() {
    const key = Object.keys(this.workers).find(k => !this.workers[k].busy);
    if (!key || !this.queue.length) return;
    for (let i = 0; i < this.queue.length; i++) {
      const t = this.queue[i];
      if (t.isHedge || !this.processing.has(t.id)) {
        const task = this.queue.splice(i,1)[0];
        this.processing.add(task.id);
        this.workers[key].busy = true;
        this.execute(key, task);
        return;
      }
    }
  }
  selectCountry(task) {
    if (task.retries) {
      const tried = task.triedCountries || [];
      const avail = countries.filter(c => !tried.includes(c));
      if (avail.length === 0) return countries[Math.floor(Math.random()*countries.length)];
      const wins = this.winners.filter(c => avail.includes(c));
      return wins.length ? wins[0] : avail[0];
    }
    return countries[task.id % countries.length];
  }
  execute(key, task) {
    const country = this.selectCountry(task);
    task.triedCountries = task.triedCountries || [];
    if (!task.triedCountries.includes(country)) task.triedCountries.push(country);
    let stream;
    let done = false;
    let wrap = null;
    let page = null;
    try {
      const session = this.getSession(key);
      const path = `/v2/general?url=${encodeURIComponent(task.url)}&x-api-key=${key}&proxy_country=${country}&proxy_type=datacenter&browser=false`;
      stream = session.request({ ':method':'POST', ':path': path, 'content-type':'application/json' });
    } catch(e) {
      this.workers[key].session = null;
      this.workers[key].busy = false;
      this.processing.delete(task.id);
      setTimeout(() => { this.queue.push(task); this.process(); }, 250);
      return;
    }
    const finish = (code) => {
      if (done) return;
      done = true;
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      try { stream.close(); } catch(e){}
      if (code >=200 && code<400 && !this.winners.includes(country)) this.winners.push(country);
      if (task.callback) task.callback(code, {wrap, page});
      this.process();
    };
    const retry = () => {
      if (done) return;
      done = true;
      this.processing.delete(task.id);
      this.workers[key].busy = false;
      try { stream.close(); } catch(e){}
      task.retries = (task.retries||0)+1;
      if (Date.now() - task.createdAt > 5000) { finish(504); return; }
      setTimeout(() => { this.queue.push(task); this.process(); }, 250);
    };
    const tmo = setTimeout(() => { retry(); }, 5000);
    stream.on('response', h => {
      wrap = h[':status'];
      page = parseInt(h['ant-page-status-code'] || h['ant-page-status'] || '0',10) || null;
    });
    stream.on('end', () => {
      clearTimeout(tmo);
      const code = page || wrap || 0;
      if (code >=200 && code < 400) finish(code); else retry();
    });
    stream.on('error', () => { clearTimeout(tmo); retry(); });
    if (!task.createdAt) task.createdAt = Date.now();
    stream.write(`{"worker":${task.id}}`);
    stream.end();
  }
}

let manager = new KeyManager();

app.get('/gate', (req,res) => {
  const token = req.query.token;
  res.set('Cache-Control','no-store');
  res.set('Referrer-Policy','no-referrer');
  if (!token) return res.status(400).end('Missing token');
  const data = tokens.get(token);
  if (!data) return res.status(410).end('Token expired or invalid');
  if (!data.firstAccess) data.firstAccess = Date.now();
  const now = Date.now();
  if (now - data.created > 5000 || now - data.firstAccess > 2000) { tokens.delete(token); return res.status(410).end('Token expired'); }
  return res.redirect(302, data.target);
});

app.post('/', (req,res) => {
  res.status(200).end();
  const url = req.body && req.body.url;
  const target = req.body && req.body.target;
  if (!url) return;
  const slash = url.lastIndexOf('/');
  const count = +url.slice(slash+1) || 1;
  const realTarget = target || url.slice(0, slash+1);
  let completed = 0;
  const start = Date.now();
  for (let i=0;i<count;i++){
    const token = Date.now().toString(36)+Math.random().toString(36).slice(2);
    tokens.set(token, {created: Date.now(), target: realTarget});
    const gateUrl = `${req.protocol}://${req.get('host')}/gate?token=${token}`;
    manager.add({ id:i, url: gateUrl, createdAt: Date.now(), callback: ()=>{ completed++; if (completed===count) { manager = new KeyManager(); } } });
  }
  setTimeout(()=>{ tokens.forEach((v,k)=>{ if (Date.now()-v.created>10000) tokens.delete(k); }); },11000);
});

app.get('/', (req,res)=> res.status(200).send('ok'));

process.on('uncaughtException', e=> console.error('uncaughtException', e && e.stack || e));
process.on('unhandledRejection', e=> console.error('unhandledRejection', e && e.stack || e));

app.listen(process.env.PORT || 3000, ()=> console.log('Service running'));
