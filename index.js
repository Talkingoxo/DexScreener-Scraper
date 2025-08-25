const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const https = require('https');
app.post('/', (req, res) => {
const { url } = req.body;
res.status(200).send('ok');
if (url) {
for (let i = 0; i < 76; i++) {
const agent = new https.Agent({ keepAlive: false });
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connection': 'close' }, body: JSON.stringify({}), timeout: 8000, agent }).then(response => response.text()).then(() => agent.destroy()).catch(() => agent.destroy());
}
}
});
app.get('/', (req, res) => {
res.status(200).send('ok');
});
app.listen(port, () => {
console.log(`Ping pong service running on port ${port}`);
});
