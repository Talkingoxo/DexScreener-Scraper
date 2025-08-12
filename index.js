const express = require('express');
const app = express();
const q = (s, c) => {
const patterns = {
'ds-dex-table-row-base-token-symbol': />([^<]+)</span>/,
'ds-dex-table-row-base-token-name': />([^<]+)</span>/,
'ds-dex-table-row-col-market-cap': />($[\d.,KMB]+)/,
'ds-dex-table-row-col-fdv': />($[\d.,KMB]+)/,
'ds-dex-table-row-col-price': />($[\d.,]+)/,
'ds-dex-table-row-col-volume': />($[\d.,KMB]+)/,
'ds-dex-table-row-col-liquidity': />($[\d.,KMB]+)/,
'ds-dex-table-row-col-pair-age': /([^<]+)</span>/,
'ds-change-perc': />([^<]+)</span>/
};
const p = patterns[c] || />[^<]*/;
const m = s.match(new RegExp(class="[^"]*${c}[^"]*"[^>]*[\\s\\S]*?${p.source}));
return m?.[1]?.replace(//g, '')?.trim();
};
const parseValue = v => !v || v === '-' ? 0 : parseFloat(v.replace(/[,$]/g, '')) * (v.toLowerCase().includes('k') ? 1e3 : v.toLowerCase().includes('m') ? 1e6 : v.toLowerCase().includes('b') ? 1e9 : 1);
const filterToken = t => parseValue(t.mcap) >= 1e5 && parseValue(t.liquidity) >= 2e4;
const rq = [];
const canRequest = () => {
const n = Date.now();
rq.splice(0);
rq.push(...rq.filter(t => n - t < 6e4));
return rq.length < 60;
};
const apiCall = async u => {
for (let i = 0; i < 3; i++) {
try {
const x = await fetch(u);
if (x.ok) return x.json();
} catch {}
}
};
const getTokens = async (c, g) => {
const h = await (await fetch(g > 1 ? https://dexscreener.com/${c}/page-${g} : https://dexscreener.com/${c}, {
headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
})).text();
return (h.match(/<a[^>]class="[^"]ds-dex-table-row[^"]"[^>]>([\s\S]*?)</a>/g) || []).map(x => {
const a = x.match(//tokens/solana/([^.]+)/)?.[1];
const s = q(x, 'ds-dex-table-row-base-token-symbol');
return a && s ? {
url: https://dexscreener.com${x.match(/href="([^"]*)"/)?.[1]},
address: a,
symbol: s,
name: q(x, 'ds-dex-table-row-base-token-name') || s,
mcap: q(x, 'ds-dex-table-row-col-market-cap') || '0',
fdv: q(x, 'ds-dex-table-row-col-fdv') || '0',
price: q(x, 'ds-dex-table-row-col-price') || '0',
change5m: q(x, 'ds-change-perc'),
change1h: '0',
change6h: '0',
change24h: '0',
volume: q(x, 'ds-dex-table-row-col-volume') || '0',
liquidity: q(x, 'ds-dex-table-row-col-liquidity') || '0',
txns: q(x, 'ds-dex-table-row-col-txns') || '0',
makers: q(x, 'ds-dex-table-row-col-makers') || '0',
age: q(x, 'ds-dex-table-row-col-pair-age') || '0',
chain: c,
timestamp: new Date().toISOString()
} : null;
}).filter(t => t && filterToken(t));
};
const enrich = async ts => {
const rs = [];
for (let i = 0; i < ts.length; i += 30) {
if (!canRequest()) await new Promise(x => setTimeout(x, 1000));
rq.push(Date.now());
const d = await apiCall(https://api.dexscreener.com/tokens/v1/solana/${ts.slice(i, i + 30).map(t => t.address).join(',')});
if (d) ts.slice(i, i + 30).forEach(t => {
const a = d.find(x => x.baseToken?.address.toLowerCase() === t.address.toLowerCase());
if (a) {
const s = {};
a.info?.websites?.forEach(w => s[w.label.toLowerCase()] = w.url);
a.info?.socials?.forEach(x => s[x.type] = x.url);
rs.push({
...t,
fdv: a.fdv >= 1e9 ? $${(a.fdv / 1e9).toFixed(1)}B : a.fdv >= 1e6 ? $${(a.fdv / 1e6).toFixed(1)}M : $${(a.fdv / 1e3).toFixed(1)}K,
priceNative: a.priceNative,
volume: { m5: a.volume?.m5 || 0, h1: a.volume?.h1 || 0, h6: a.volume?.h6 || 0, h24: a.volume?.h24 || 0 },
txns: { m5: a.txns?.m5 || 0, h1: a.txns?.h1 || 0, h6: a.txns?.h6 || 0, h24: a.txns?.h24 || 0 },
boosts: a.boosts?.active || 0,
social: Object.keys(s).length ? s : null
});
} else rs.push(t);
});
}
return rs;
};
app.get('/', async (req, res) => {
try {
const a = [], s = new Set();
let page = 1;
while (true) {
const tokens = await getTokens('solana', page);
if (tokens.length === 0) break;
tokens.forEach(t => {
if (!s.has(t.address)) {
s.add(t.address);
a.push(t);
}
});
page++;
await new Promise(x => setTimeout(x, 50));
}
const data = await enrich(a);
res.json(data);
} catch (e) {
res.json({ error: e.message });
}
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(Listening on port ${port}));
