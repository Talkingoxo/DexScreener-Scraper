const express = require('express');
const app = express();
const port = process.env.PORT || 10000;
app.use(express.json());
app.use((req, res, next) => {console.log(`Hey i am Log - ${req.method} ${req.url} from ${req.get('User-Agent')} IP: ${req.ip}`);next();});
app.get('/', (req, res) => {console.log('GET / hit');res.send('Hello World!');});
app.post('/trigger', (req, res) => {console.log('POST /trigger hit');res.send('triggered');});
app.use('*', (req, res) => {console.log(`Catch all: ${req.method} ${req.originalUrl}`);res.send('caught');});
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
