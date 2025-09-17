const express = require('express');
const app = express();
const port = process.env.PORT || 10000;
app.use(express.json());
app.use((req, res, next) => {console.log(`Hey i am Log - ${req.method} ${req.url} from ${req.get('User-Agent')}`);next();});
app.get('/', (req, res) => res.send('Hello World!'));
app.post('/trigger', (req, res) => res.send('triggered'));
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
