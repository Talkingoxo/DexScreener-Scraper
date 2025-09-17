const express = require('express');
const app = express();
const port = process.env.PORT || 10000;
console.log("Hey i am Log");
app.get('/', (req, res) => res.send('Hello World!'));
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
