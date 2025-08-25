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
const promises = [];
for (let i = 0; i < 76; i++) {
promises.push((async () => {
const agent = new https.Agent({ keepAlive: false });
try {
const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connection': 'close' }, body: JSON.stringify({}), timeout: 8000, agent });
await response.text();
agent.destroy();
} catch (error) {
agent.destroy();
}
})());
}
await Promise.all(promises);
}
});
app.get('/', (req, res) => {
res.status(200).send('ok');
});
app.listen(port, () => {
console.log(`Ping pong service running on port ${port}`);
});
