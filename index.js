const express = require('express');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.post('/', (req, res) => {
  const { url } = req.body;
  res.end();
  if (!url) return;
  const slashIndex = url.lastIndexOf('/');
  const lastPart = url.slice(slashIndex + 1);
  const count = +lastPart || 1;
  const targetUrl = url.slice(0, slashIndex + 1);
  const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN'];
  console.log(`STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`);
  let completed = 0;
  const agents = [];
  for (let i = 0; i < 5; i++) {
    agents.push(new https.Agent({ keepAlive: true, maxSockets: 10 }));
  }
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const country = countries[i % 23];
      const agent = agents[i % 5];
      const postData = `{"worker-id":${i}}`;
      const options = {
        hostname: 'api.scrapingant.com',
        port: 443,
        path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=2a33de63f0054f1cb33f5857a3fe00c5&proxy_country=${country}&proxy_type=datacenter&browser=false`,
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': postData.length},
        agent: agent
      };
      console.log(`REQUEST ${i+1}/${count}: Country=${country}, Agent=${i % 5}`);
      const req = https.request(options, (res) => {
        console.log(`RESPONSE ${i+1}: Status=${res.statusCode}`);
        res.on('data', () => {});
        res.on('end', () => {
          completed++;
          console.log(`REQUEST ${i+1} COMPLETED. Total: ${completed}/${count}`);
        });
      });
      req.on('error', (err) => console.log(`REQUEST ${i+1} ERROR:`, err.message));
      req.write(postData);
      req.end();
    }, i * 5000);
  }
  console.log(`LOOP COMPLETED: Created ${count} requests with ${agents.length} agents`);
});
app.listen(port, () => console.log(`Service running on port ${port}`));
