const express = require('express')
const https = require('https')
const http2 = require('http2')
const { execFile } = require('child_process')
const app = express()
const port = process.env.PORT || 3000
app.use(express.json())
const apiKeys = [
  '00a5af9578784f0d9c96e4fccd458b4b',
  '800b76f2e1bb4e8faea57d2add88601f',
  'a180661526ac40eeaafe5d1a90d11b52',
  'ae5ce549f49c4b17ab69b4e2f34fcc2e',
  'cd8dfbb8ab4745eab854614cca70a5d8',
  '34499358b9fd46a1a059cfd96d79db42',
  '7992bcd991df4f639e8941c68186c7fc',
  'fdd914f432d748889371e0307691c835',
  '41f5cebd207042dd8a8acac2329ddb32',
  'f6d87ae9284543e3b2d14f11a36e1dcd'
]
const countries = ['BR','CA','CN','CZ','FR','DE','HK','IN','ID','IT','IL','JP','NL','PL','RU','SA','SG','KR','ES','GB','AE','US','VN']
class OptimizedAPIManager {
  constructor() {
    this.keyQueues = {}
    this.keyInFlight = {}
    this.http2Session = null
    this.httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 50, maxFreeSockets: 10 })
    this.useHTTP2 = false
    this.useHTTP3 = false
    apiKeys.forEach(k => { this.keyQueues[k] = []; this.keyInFlight[k] = false })
    this.initHTTP2()
    this.probeHTTP3()
  }
  initHTTP2() {
    try {
      const s = http2.connect('https://api.scrapingant.com')
      s.on('connect', () => { this.useHTTP2 = true; console.log('HTTP/2: ENABLED') })
      s.on('error', () => { if (this.http2Session === s) this.useHTTP2 = false })
      s.on('close', () => { if (this.http2Session === s) { this.useHTTP2 = false; this.http2Session = null; setTimeout(() => this.initHTTP2(), 300) } })
      s.on('goaway', () => { if (this.http2Session === s) { this.useHTTP2 = false; this.http2Session = null; setTimeout(() => this.initHTTP2(), 300) } })
      this.http2Session = s
    } catch (_) {
      this.useHTTP2 = false
      this.http2Session = null
    }
  }
  probeHTTP3() {
    execFile('curl', ['-sS','-o','/dev/null','-w','%{http_version}','--http3','https://api.scrapingant.com'], { timeout: 5000 }, (err, out) => {
      if (err) { console.log('HTTP/3: CHECK FAILED'); this.useHTTP3 = false; return }
      this.useHTTP3 = String(out || '').toUpperCase().startsWith('HTTP/3')
      console.log(this.useHTTP3 ? 'HTTP/3: SUPPORTED' : 'HTTP/3: NOT SUPPORTED')
    })
  }
  addRequest(keyIndex, requestData) {
    const key = apiKeys[keyIndex]
    this.keyQueues[key].push(requestData)
    this.processQueue(key)
  }
  processQueue(key) {
    if (this.keyInFlight[key] || this.keyQueues[key].length === 0) return
    this.keyInFlight[key] = true
    const rd = this.keyQueues[key].shift()
    this.executeRequest(key, rd, () => { this.keyInFlight[key] = false; this.processQueue(key) })
  }
  executeRequest(apiKey, requestData, onComplete) {
    if (this.useHTTP2 && this.http2Session) { this.executeHTTP2Request(apiKey, requestData, onComplete); return }
    this.executeHTTPSRequest(apiKey, requestData, onComplete)
  }
  executeHTTP2Request(apiKey, requestData, onComplete) {
    const { targetUrl, requestId, onResponse } = requestData
    const country = countries[requestId % countries.length]
    const headers = {
      ':method': 'GET',
      ':path': `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      'accept-encoding': 'gzip, deflate, br'
    }
    console.log(`H2 REQ ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`)
    let statusCode = 0
    try {
      const stream = this.http2Session.request(headers)
      stream.setTimeout(10000)
      stream.on('response', h => { statusCode = h[':status'] || 0; console.log(`H2 RES ${requestId}: ${statusCode}, Key=${apiKey.slice(-8)}`) })
      stream.on('data', () => {})
      stream.on('end', () => { console.log(`H2 END ${requestId}: ${statusCode}, Key=${apiKey.slice(-8)}`); if (statusCode >= 500) this.retryRequest(apiKey, requestData, onComplete, 1); else { onResponse(statusCode); onComplete() } })
      stream.on('timeout', () => { console.log(`H2 TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`); stream.destroy(new Error('timeout')) })
      stream.on('error', () => { this.retryRequest(apiKey, requestData, onComplete, 1) })
      stream.end()
    } catch (_) {
      this.retryRequest(apiKey, requestData, onComplete, 1)
    }
  }
  executeHTTPSRequest(apiKey, requestData, onComplete) {
    const { targetUrl, requestId, onResponse } = requestData
    const country = countries[requestId % countries.length]
    const options = {
      hostname: 'api.scrapingant.com',
      port: 443,
      path: `/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${apiKey}&proxy_country=${country}&proxy_type=datacenter&browser=false`,
      method: 'GET',
      headers: { 'accept-encoding': 'gzip, deflate, br' },
      agent: this.httpsAgent
    }
    console.log(`H1 REQ ${requestId}: Key=${apiKey.slice(-8)}, Country=${country}`)
    const req = https.request(options, res => {
      const sc = res.statusCode || 0
      console.log(`H1 RES ${requestId}: ${sc}, Key=${apiKey.slice(-8)}`)
      res.on('data', () => {})
      res.on('end', () => { console.log(`H1 END ${requestId}: ${sc}, Key=${apiKey.slice(-8)}`); if (sc >= 500) this.retryRequest(apiKey, requestData, onComplete, 1); else { onResponse(sc); onComplete() } })
    })
    req.setTimeout(10000, () => { console.log(`H1 TIMEOUT ${requestId}: Key=${apiKey.slice(-8)}`); req.destroy(new Error('timeout')) })
    req.on('error', () => { this.retryRequest(apiKey, requestData, onComplete, 1) })
    req.end()
  }
  retryRequest(apiKey, requestData, onComplete, attempt) {
    if (attempt > 2) { requestData.onResponse(500); onComplete(); return }
    const d = Math.min(250 * attempt + Math.random() * 100, 1000)
    setTimeout(() => { this.executeRequest(apiKey, requestData, onComplete) }, Math.round(d))
  }
}
const apiManager = new OptimizedAPIManager()
app.post('/', (req, res) => {
  const { url } = req.body
  res.end()
  if (!url) return
  const slashIndex = url.lastIndexOf('/')
  const lastPart = url.slice(slashIndex + 1)
  const count = +lastPart || 1
  const targetUrl = url.slice(0, slashIndex + 1)
  console.log(`STARTING: URL=${url}, COUNT=${count}, TARGET=${targetUrl}`)
  console.log(`PROTOCOL: ${apiManager.useHTTP2 ? 'HTTP/2' : 'HTTPS'}`)
  console.log(`DISTRIBUTING ${count} requests across ${apiKeys.length} API keys`)
  let completed = 0
  let success = 0
  for (let i = 0; i < count; i++) {
    const keyIndex = i % apiKeys.length
    const requestData = {
      targetUrl,
      requestId: i,
      onResponse: sc => {
        completed++
        if (sc === 200) success++
        if (completed === count) {
          const pct = ((success / count) * 100).toFixed(1)
          console.log(`ALL COMPLETE: ${success}/${count} (${pct}%)`)
        }
      }
    }
    apiManager.addRequest(keyIndex, requestData)
  }
})
app.listen(port, () => console.log(`Service running on port ${port}`))
