const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// Nuclear approach: Use curl with full browser simulation
const curlFetch = (url) => {
  return new Promise((resolve, reject) => {
    const curlCmd = `curl -s -L -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" -H "Accept-Language: en-US,en;q=0.9" -H "Accept-Encoding: gzip, deflate, br" -H "DNT: 1" -H "Connection: keep-alive" -H "Upgrade-Insecure-Requests: 1" -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" -H "Sec-Fetch-Site: none" -H "Sec-Fetch-User: ?1" -H "Cache-Control: max-age=0" --compressed "${url}"`;
    
    exec(curlCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        status: 200,
        text: () => Promise.resolve(stdout)
      });
    });
  });
};

const q=(html,s)=>{const c=s.replace(/\./g,'');const patterns={'ds-dex-table-row-col-market-cap':/>(\$<!--\s*-->[\d.,KMB]+)/,'ds-dex-table-row-col-fdv':/>(\$<!--\s*-->[\d.,KMB]+)/,'ds-dex-table-row-col-price':/>(\$<!--\s*-->[\d.,]+)/,'ds-dex-table-row-col-price-change-m5':/<span[^>]*class="[^"]*ds-change-perc[^"]*"[^>]*>([^<]+)<\/span>/,'ds-dex-table-row-col-price-change-h1':/<span[^>]*class="[^"]*ds-change-perc[^"]*"[^>]*>([^<]+)<\/span>/,'ds-dex-table-row-col-price-change-h6':/<span[^>]*class="[^"]*ds-change-perc[^"]*"[^>]*>([^<]+)<\/span>/,'ds-dex-table-row-col-price-change-h24':/<span[^>]*class="[^"]*ds-change-perc[^"]*"[^>]*>([^<]+)<\/span>/,'ds-dex-table-row-col-volume':/>(\$<!--\s*-->[\d.,KMB]+)/,'ds-dex-table-row-col-liquidity':/>(\$<!--\s*-->[\d.,KMB]+)/};const pattern=patterns[c];if(pattern){const m=html.match(new RegExp(`class="[^"]*${c}[^"]*"[^>]*[\\s\\S]*?${pattern.source}`));return m?.[1]?.replace(/<!--\s*-->/g,'')?.trim()}const m=html.match(new RegExp(`class="[^"]*${c}[^"]*"[^>]*>([^<]*)`));return m?.[1]?.trim()};

const p=v=>{if(!v||v==='-')return 0;const n=parseFloat(v.replace(/[,$]/g,'')),m=v.toLowerCase();return n*(m.includes('k')?1e3:m.includes('m')?1e6:m.includes('b')?1e9:1)};

const fm=n=>n>=1e9?`$${(n/1e9).toFixed(1)}B`:n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${n.toFixed(0)}`;

const f=t=>{if(p(t.mcap)<1e5)return 0;if(p(t.liquidity)<2e4)return 0;const c=[t.change5m,t.change1h,t.change6h,t.change24h].map(x=>x&&x!=='-'?Math.abs(parseFloat(x)):null).filter(x=>x!==null);return c.length>2&&new Set(c).size===c.length};

const rq=[];

const ft=async u=>{for(let i=0;i<3;i++){try{const x=await curlFetch(u);if(x.status===200){const text=await x.text();return JSON.parse(text)}}catch{}}return null};

const rl=()=>{const n=Date.now(),o=rq.filter(t=>n-t<60000);rq.length=0;rq.push(...o);return o.length<60};

const getTokensHTML=async(c='solana',pg=1)=>{
  console.log(`Fetching page ${pg} with curl...`);
  
  // Random delay
  await new Promise(r => setTimeout(r, Math.random() * 3000 + 2000));
  
  try {
    const url = pg>1?`https://dexscreener.com/${c}/page-${pg}`:`https://dexscreener.com/${c}`;
    const response = await curlFetch(url);
    
    const html = await response.text();
    console.log(`Page ${pg} HTML length: ${html.length}`);
    
    // Check for various blocking patterns
    const isBlocked = html.includes('Just a moment') || 
                     html.includes('Checking your browser') || 
                     html.includes('cf-browser-verification') ||
                     html.includes('Access denied') ||
                     html.includes('Forbidden') ||
                     html.length < 10000; // Suspiciously small response
    
    console.log(`Page ${pg} blocked: ${isBlocked}`);
    
    if(isBlocked) {
      console.log('Page blocked - trying alternative method...');
      
      // Try with wget as backup
      const wgetCmd = `wget -q -O - --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --header="Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" "${url}"`;
      
      try {
        const wgetResult = await new Promise((resolve, reject) => {
          exec(wgetCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout);
          });
        });
        
        console.log(`Page ${pg} wget HTML length: ${wgetResult.length}`);
        if(wgetResult.length > 50000) {
          // Use wget result
          html = wgetResult;
        } else {
          return [];
        }
      } catch {
        return [];
      }
    }
    
    const tableRowMatches = html.match(/<a[^>]*class="[^"]*ds-dex-table-row[^"]*"/g) || [];
    console.log(`Page ${pg} found ${tableRowMatches.length} table rows`);
    
    if (tableRowMatches.length === 0) {
      // Debug: save HTML to file to inspect
      fs.writeFileSync(`debug-page-${pg}.html`, html);
      console.log(`Saved debug HTML to debug-page-${pg}.html`);
      return [];
    }
    
    const rows = html.match(/<a[^>]*class="[^"]*ds-dex-table-row[^"]*"[^>]*>([\s\S]*?)<\/a>/g) || [];
    console.log(`Page ${pg} extracted ${rows.length} full rows`);
    
    const tokens = rows.map(r => {
      const h = r.match(/href="([^"]*)"/)?.[1];
      const s = q(r,'ds-dex-table-row-base-token-symbol');
      const a = r.match(/\/tokens\/solana\/([^.]+)/)?.[1];
      return h && s && a ? {
        url: `https://dexscreener.com${h}`,
        address: a,
        symbol: s,
        name: q(r,'ds-dex-table-row-base-token-name'),
        mcap: q(r,'ds-dex-table-row-col-market-cap'),
        fdv: q(r,'ds-dex-table-row-col-fdv'),
        price: q(r,'ds-dex-table-row-col-price'),
        change5m: q(r,'ds-dex-table-row-col-price-change-m5'),
        change1h: q(r,'ds-dex-table-row-col-price-change-h1'),
        change6h: q(r,'ds-dex-table-row-col-price-change-h6'),
        change24h: q(r,'ds-dex-table-row-col-price-change-h24'),
        volume: q(r,'ds-dex-table-row-col-volume'),
        liquidity: q(r,'ds-dex-table-row-col-liquidity'),
        txns: q(r,'ds-dex-table-row-col-txns'),
        makers: q(r,'ds-dex-table-row-col-makers'),
        age: q(r,'ds-dex-table-row-col-pair-age'),
        chain: c,
        timestamp: new Date().toISOString()
      } : null;
    }).filter(Boolean);
    
    console.log(`Page ${pg} parsed ${tokens.length} valid tokens`);
    const filtered = tokens.filter(f);
    console.log(`Page ${pg} after filtering: ${filtered.length} tokens`);
    
    if(tokens.length > 0) {
      console.log(`Sample token from page ${pg}:`, JSON.stringify(tokens[0], null, 2));
    }
    
    return filtered;
  } catch (e) {
    console.log(`Page ${pg} error: ${e.message}`);
    return [];
  }
};

const ba=async(ts,c='solana')=>{const rs=[],fl=[],bs=30,pc=3;for(let i=0;i<ts.length;i+=bs*pc){const bt=[];for(let j=0;j<pc&&i+j*bs<ts.length;j++){bt.push(ts.slice(i+j*bs,i+(j+1)*bs))}const pr=bt.map(async b=>{if(!rl())await new Promise(r=>setTimeout(r,1000));rq.push(Date.now());const ads=b.map(t=>t.address).join(','),d=await ft(`https://api.dexscreener.com/tokens/v1/${c}/${ads}`);if(d){b.forEach(tk=>{const ad=d.find(x=>x.baseToken?.address.toLowerCase()===tk.address.toLowerCase());if(ad){const so={};ad.info?.websites?.forEach(w=>so[w.label.toLowerCase()]=w.url);ad.info?.socials?.forEach(x=>so[x.type]=x.url);rs.push({...tk,fdv:fm(ad.fdv||0),priceNative:ad.priceNative,volume:{m5:fm(ad.volume?.m5||0),h1:fm(ad.volume?.h1||0),h6:fm(ad.volume?.h6||0),h24:fm(ad.volume?.h24||0)},txns:{m5:ad.txns?.m5,h1:ad.txns?.h1,h6:ad.txns?.h6,h24:ad.txns?.h24},boosts:ad.boosts?.active||0,social:Object.keys(so).length?so:null})}else fl.push(tk)})}else fl.push(...b)});await Promise.all(pr)}if(fl.length){const rt=await ba(fl,c);rs.push(...rt)}return rs};

const getAllTokens=async(c='solana')=>{const a=[],seen=new Set();let pg=1,h=1;while(h){const tokens=await getTokensHTML(c,pg);h=0;tokens.forEach(t=>{if(!seen.has(t.address)){seen.add(t.address);a.push(t);h++}});pg++;await new Promise(r=>setTimeout(r,5000));console.log(`Scraped ${a.length} tokens so far...`);if(pg>10||a.length===0&&pg>3)break}return await ba(a,c)};

console.log('Nuclear approach: Using curl and wget for requests');
console.log('Make sure curl and wget are installed on your system');

(async()=>{
  try{
    console.log('Starting DexScreener scraping...');
    const data = await getAllTokens('solana');
    const filename = `dexscreener-tokens-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`Scraped ${data.length} tokens and saved to ${filename}`);
  }catch(e){
    console.error('Error:', e.message);
  }
})();
