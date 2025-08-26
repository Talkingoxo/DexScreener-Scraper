const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/', (req, res) => {
const { url } = req.body;
if (url) {
for (let i = 0; i < 76; i++) {
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), timeout: 8000 }).catch(() => {});
}
res.status(200).send('ok');
} else {
res.status(400).send('no url');
}
});

app.get('/', (req, res) => {
res.status(200).send('ok');
});

app.listen(port, () => {
console.log(`Ping pong service running on port ${port}`);
});
