const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');
const express = require('express');

console.log('Starting DexScreener scraper...');

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const q = (r, s) => {
    try {
        return r.querySelector(s)?.textContent;
    } catch (e) {
        return null;
    }
};

const p = v => {
    if (!v || v === '-') return 0;
    const n = parseFloat(v.replace(/[,$]/g, ''));
    const m = v.toLowerCase();
    return n * (m.includes('k') ? 1e3 : m.includes('m') ? 1e6 : m.includes('b') ? 1e9 : 1);
};

const fm = n => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

const f = t => {
    if (p(t.mcap) < 1e5) return 0;
    const c = [t.change5m, t.change1h, t.change6h, t.change24h].map(x => x && x !== '-' ? Math.abs(parseFloat(x)) : null).filter(x => x !== null);
    return c.length > 2 && new Set(c).size === c.length;
};

async function sendToSheet(d) {
    try {
        console.log(`Sending ${d.length} tokens to sheet...`);
        
        const b64url = str => Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const n = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
        const payload = b64url(JSON.stringify({
            iss: "tokens@formal-fragment-440604-p0.iam.gserviceaccount.com",
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            aud: 'https://oauth2.googleapis.com/token',
            exp: n + 3600,
            iat: n
        }));
        
        const privateKey = `-----BEGIN PRIVATE KEY-----\n${PRIVATE_KEY}\n-----END PRIVATE KEY-----`;
        const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
        const signatureB64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${signatureB64}`
        });
        
        const tokenData = await tokenResponse.json();
        console.log('Token response:', tokenData.access_token ? 'Success' : 'Failed');
        
        const { access_token } = tokenData;
        
        const sheetResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets/1MLTE4yIA5Sk-n2TdyvWy7BBTF3EF2an0mSdFHupCeU0/values:batchUpdate', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: [{
                    range: 'A1:AG1',
                    values: [['url', 'address', 'symbol', 'name', 'mcap', 'fdv', 'price', 'change5m', 'change1h', 'change6h', 'change24h', 'volume_m5', 'volume_h1', 'volume_h6', 'volume_h24', 'liquidity', 'txns_m5_buys', 'txns_m5_sells', 'txns_h1_buys', 'txns_h1_sells', 'txns_h6_buys', 'txns_h6_sells', 'txns_h24_buys', 'txns_h24_sells', 'makers', 'age', 'chain', 'timestamp', 'priceNative', 'boosts', 'social_website', 'social_twitter', 'social_telegram']]
                }, {
                    range: `A2:AG${d.length + 1}`,
                    values: d.map(i => [i.url, i.address, i.symbol, i.name, i.mcap, i.fdv, i.price, i.change5m, i.change1h, i.change6h, i.change24h, i.volume.m5, i.volume.h1, i.volume.h6, i.volume.h24, i.liquidity, i.txns.m5?.buys, i.txns.m5?.sells, i.txns.h1?.buys, i.txns.h1?.sells, i.txns.h6?.buys, i.txns.h6?.sells, i.txns.h24?.buys, i.txns.h24?.sells, i.makers, i.age, i.chain, i.timestamp, i.priceNative, i.boosts || 0, i.social?.website || '', i.social?.twitter || '', i.social?.telegram || ''])
                }],
                valueInputOption: 'RAW'
            })
        });
        
        const sheetData = await sheetResponse.json();
        console.log('Sheet update:', sheetResponse.ok ? 'Success' : 'Failed', sheetData);
        
    } catch (error) {
        console.error('sendToSheet error:', error);
        throw error;
    }
}

const dexAPI = {
    rq: [],
    async ft(u) {
        for (let i = 0; i < 3; i++) {
            try {
                const x = await fetch(u);
                if (x.ok) return await x.json();
            } catch (e) {
                console.error(`Fetch attempt ${i + 1} failed:`, e.message);
            }
        }
        return null;
    },
    async getTokensHTML(c = 'solana', pg = 1) {
        try {
            const url = pg > 1 ? `https://dexscreener.com/${c}/page-${pg}` : `https://dexscreener.com/${c}`;
            console.log(`Scraping page ${pg}...`);
            
            const response = await fetch(url);
            const html = await response.text();
            const dom = new JSDOM(html);
            const document = dom.window.document;
            
            const tokens = [...document.querySelectorAll('a.ds-dex-table-row')].map(r => {
                const h = r.getAttribute('href');
                const s = q(r, '.ds-dex-table-row-base-token-symbol');
                const a = r.querySelector('.ds-dex-table-row-token-icon-img')?.src?.match(/\/tokens\/solana\/([^.]+)/)?.[1];
                return h && s && a ? {
                    url: `https://dexscreener.com${h}`,
                    address: a,
                    symbol: s,
                    name: q(r, '.ds-dex-table-row-base-token-name'),
                    mcap: q(r, '.ds-dex-table-row-col-market-cap'),
                    fdv: q(r, '.ds-dex-table-row-col-fdv'),
                    price: q(r, '.ds-dex-table-row-col-price'),
                    change5m: q(r, '.ds-dex-table-row-col-price-change-m5 .ds-change-perc'),
                    change1h: q(r, '.ds-dex-table-row-col-price-change-h1 .ds-change-perc'),
                    change6h: q(r, '.ds-dex-table-row-col-price-change-h6 .ds-change-perc'),
                    change24h: q(r, '.ds-dex-table-row-col-price-change-h24 .ds-change-perc'),
                    volume: q(r, '.ds-dex-table-row-col-volume'),
                    liquidity: q(r, '.ds-dex-table-row-col-liquidity'),
                    txns: q(r, '.ds-dex-table-row-col-txns'),
                    makers: q(r, '.ds-dex-table-row-col-makers'),
                    age: q(r, '.ds-dex-table-row-col-pair-age'),
                    chain: c,
                    timestamp: new Date().toISOString()
                } : null;
            }).filter(t => t && f(t));
            
            console.log(`Page ${pg}: Found ${tokens.length} tokens`);
            return tokens;
            
        } catch (error) {
            console.error(`Error scraping page ${pg}:`, error);
            return [];
        }
    },
    rl() {
        const n = Date.now();
        const o = this.rq.filter(t => n - t < 60000);
        this.rq = o;
        return o.length < 60;
    },
    async ba(ts, c = 'solana') {
        const rs = [], fl = [], bs = 30, pc = 3;
        console.log(`Batch processing ${ts.length} tokens...`);
        
        for (let i = 0; i < ts.length; i += bs * pc) {
            const bt = [];
            for (let j = 0; j < pc && i + j * bs < ts.length; j++) {
                bt.push(ts.slice(i + j * bs, i + (j + 1) * bs));
            }
            const pr = bt.map(async b => {
                if (!this.rl()) await new Promise(r => setTimeout(r, 1000));
                this.rq.push(Date.now());
                const ads = b.map(t => t.address).join(',');
                const d = await this.ft(`https://api.dexscreener.com/tokens/v1/${c}/${ads}`);
                if (d) {
                    b.forEach(tk => {
                        const ad = d.find(x => x.baseToken?.address.toLowerCase() === tk.address.toLowerCase());
                        if (ad) {
                            const so = {};
                            ad.info?.websites?.forEach(w => so[w.label.toLowerCase()] = w.url);
                            ad.info?.socials?.forEach(x => so[x.type] = x.url);
                            rs.push({
                                ...tk,
                                fdv: fm(ad.fdv || 0),
                                priceNative: ad.priceNative,
                                volume: {
                                    m5: fm(ad.volume?.m5 || 0),
                                    h1: fm(ad.volume?.h1 || 0),
                                    h6: fm(ad.volume?.h6 || 0),
                                    h24: fm(ad.volume?.h24 || 0)
                                },
                                txns: {
                                    m5: ad.txns?.m5,
                                    h1: ad.txns?.h1,
                                    h6: ad.txns?.h6,
                                    h24: ad.txns?.h24
                                },
                                boosts: ad.boosts?.active || 0,
                                social: Object.keys(so).length ? so : null
                            });
                        } else fl.push(tk);
                    });
                } else fl.push(...b);
            });
            await Promise.all(pr);
            console.log(`Processed batch ${Math.floor(i/(bs*pc))+1}/${Math.ceil(ts.length/(bs*pc))}`);
        }
        if (fl.length) {
            console.log(`Retrying ${fl.length} failed tokens...`);
            const rt = await this.ba(fl, c);
            rs.push(...rt);
        }
        return rs;
    },
    async getAllTokens(c = 'solana') {
        const a = [], b = 40;
        let pg = 1, h = 1;
        while (h) {
            const r = await Promise.all([...Array(b)].map((_, i) => this.getTokensHTML(c, pg + i)));
            h = r.reduce((s, t) => (a.push(...t), s + t.length), 0);
            pg += b;
            if (h) await new Promise(r => setTimeout(r, 50));
            console.log(`Total tokens scraped: ${a.length}`);
        }
        console.log(`Scraping complete. Processing ${a.length} tokens...`);
        return await this.ba(a, c);
    }
};

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('DexScreener scraper is running');
});

app.get('/run', async (req, res) => {
    try {
        console.log('Manual scraper run triggered...');
        const tokens = await dexAPI.getAllTokens('solana');
        await sendToSheet(tokens);
        res.json({ success: true, message: `Processed ${tokens.length} tokens` });
    } catch (error) {
        console.error('Manual run error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

(async () => {
    try {
        console.log('Starting automatic scraper run...');
        const tokens = await dexAPI.getAllTokens('solana');
        await sendToSheet(tokens);
        console.log('Scraper completed successfully');
    } catch (error) {
        console.error('Scraper failed:', error);
    }
})();
