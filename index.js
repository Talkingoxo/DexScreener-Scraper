const apiKeys=[
  "00a5af9578784f0d9c96e4fccd458b4b",
  "800b76f2e1bb4e8faea57d2add88601f",
  "a180661526ac40eeaafe5d1a90d11b52",
  "ae5ce549f49c4b17ab69b4e2f34fcc2e",
  "cd8dfbb8ab4745eab854614cca70a5d8",
  "34499358b9fd46a1a059cfd96d79db42",
  "7992bcd991df4f639e8941c68186c7fc",
  "fdd914f432d748889371e0307691c835",
  "41f5cebd207042dd8a8acac2329ddb32",
  "f6d87ae9284543e3b2d14f11a36e1dcd"
];

const DEFAULT_COUNTRIES=["BR","CA","CN","CZ","FR","DE","HK","IN","ID","IT","IL","RU","SA","SG","ES","PL","NL","VN","GB","KR","JP","AE","US"];

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const now=()=>new Date().toISOString();
const clampInt=(v,min,max)=>{if(v==null)return null;const n=Number(v);if(!Number.isFinite(n))return null;return Math.min(max,Math.max(min,Math.trunc(n)));};
const splitList=(s)=>!s?[]:Array.from(new Set(s.split(",").map(x=>x.trim()).filter(Boolean)));
const pathCountOrNull=(p)=>{const m=p.match(/^\/(\d+)(?:\/|$)/);return m?parseInt(m[1],10):null;};
const sameOrigin=(a,b)=>{try{return new URL(a).origin===new URL(b).origin;}catch{return false;}};
const truncate=(s,n)=>!s?"":(s.length>n?s.slice(0,n-1)+"…":s);
const randInt=(a,b)=>Math.floor(a+Math.random()*(b-a+1));

async function checkH3Support(target){
  let altSvc="";let supportsH3=false;let ok=false;let status=0;
  try{
    const r=await fetch(target,{method:"HEAD",redirect:"manual",cf:{cacheTtl:0}});
    status=r.status;altSvc=r.headers.get("alt-svc")||"";
    supportsH3=/\bh3\b/i.test(altSvc);
    ok=true;
  }catch(e){}
  return {ok,status,altSvc,supportsH3};
}

async function doRequest(idx,target,method,body,key,country,timeoutMs,attempt,retries,userHeaders){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort("timeout"),timeoutMs);
  const headers=new Headers(userHeaders||{});
  if(!headers.has("authorization"))headers.set("authorization","Bearer "+key);
  if(!headers.has("x-api-key"))headers.set("x-api-key",key);
  if(!headers.has("X-Api-Key"))headers.set("X-Api-Key",key);
  headers.set("CF-IPCountry",country);
  const opts={method,body,signal:controller.signal,headers,redirect:"follow",cf:{cacheTtl:0,fetchTTL:0}};
  let status=0,ok=false;
  try{
    const res=await fetch(target,opts);
    status=res.status;ok=res.ok;
    console.log(`${now()} H2 RES ${idx}: ${status}, Key=${key.slice(-8)}`);
    console.log(`${now()} H2 END ${idx}: ${status}, Key=${key.slice(-8)}`);
    if(status===409&&attempt<=retries){
      const wait=1500+randInt(0,2000);
      console.log(`${now()} COOLDOWN Key=${key.slice(-8)} for ~${wait}ms (status 409, attempt ${attempt})`);
      await sleep(wait);
      return {retry:true};
    }
    if(!ok&&attempt<=retries){
      const wait=300+randInt(0,500);
      console.log(`${now()} RETRY ${idx} (attempt ${attempt}) after ${wait}ms`);
      await sleep(wait);
      return {retry:true};
    }
    return {ok};
  }catch(e){
    if(e==="timeout"||e?.name==="TimeoutError"||e?.name==="AbortError"){
      console.log(`${now()} H2 TIMEOUT ${idx}: Key=${key.slice(-8)}`);
      console.log(`${now()} H2 END ${idx}: 0, Key=${key.slice(-8)}`);
      if(attempt<=retries){
        const wait=300+randInt(0,500);
        console.log(`${now()} RETRY ${idx} (attempt ${attempt}) after ${wait}ms`);
        await sleep(wait);
        return {retry:true};
      }
      return {ok:false};
    }
    console.log(`${now()} H2 ERR ${idx}: ${String(e)}`);
    return {ok:false};
  }finally{clearTimeout(t);}
}

async function runBurst({request,url}){
  const target=url.searchParams.get("target");
  if(!target)return new Response("Missing ?target",{status:400});
  if(sameOrigin(target,request.url))return new Response("Refusing to target myself.",{status:400});
  const pathCount=pathCountOrNull(url.pathname);
  const count=clampInt(url.searchParams.get("count"),1,10000)??pathCount??25;
  const concurrency=clampInt(url.searchParams.get("concurrency"),1,500)??Math.min(count,apiKeys.length||10);
  const retries=clampInt(url.searchParams.get("retries"),0,10)??2;
  const timeoutMs=clampInt(url.searchParams.get("timeout"),100,60000)??10000;
  const method=(url.searchParams.get("method")||"GET").toUpperCase();
  const bodyParam=url.searchParams.get("body");
  const body=bodyParam==null?undefined:bodyParam;
  const countries=splitList(url.searchParams.get("countries"));
  const countryList=countries.length?countries:DEFAULT_COUNTRIES;
  const wantH3Check=(url.searchParams.get("h3check")||"true").toLowerCase()==="true";
  const userHeadersInput=url.searchParams.get("headers");
  let userHeaders={};
  if(userHeadersInput){
    try{userHeaders=JSON.parse(userHeadersInput);}catch{}
  }
  const inboundProto=request.cf?.httpProtocol||"unknown";
  console.log(`${now()} STARTING: URL=${request.url}, COUNT=${count}, TARGET=${new URL(target).origin}`);
  console.log(`${now()} PROTOCOL: ${inboundProto}`);
  console.log(`${now()} DISTRIBUTING ${count} requests across ${apiKeys.length} API keys`);
  if(wantH3Check){
    try{
      const h3=await checkH3Support(target);
      console.log(`${now()} H3 CHECK: advertises_h3=${h3.supportsH3}, alt-svc="${truncate(h3.altSvc,256)}"`);
    }catch(e){
      console.log(`${now()} H3 CHECK: error=${String(e)}`);
    }
  }
  const jobs=new Array(count).fill(0).map((_,i)=>({
    idx:i,
    key:apiKeys[i%apiKeys.length],
    country:countryList[i%countryList.length]
  }));
  let okCount=0;
  const start=Date.now();
  let next=0;
  const workers=Math.min(concurrency,jobs.length||1);
  const runWorker=async()=>{
    while(true){
      const j=next++;
      if(j>=jobs.length)break;
      const {idx,key,country}=jobs[j];
      console.log(`${now()} H2 REQ ${idx}: Key=${key.slice(-8)}, Country=${country}`);
      let attempt=1;
      while(true){
        const r=await doRequest(idx,target,method,body,key,country,timeoutMs,attempt,retries,userHeaders);
        if(r.ok){okCount++;break;}
        if(r.retry){attempt++;continue;}
        break;
      }
    }
  };
  await Promise.all(new Array(workers).fill(0).map(runWorker));
  const elapsed=(Date.now()-start)/1000;
  const pct=((okCount/count)*100).toFixed(1);
  console.log(`${now()} ALL COMPLETE: ${okCount}/${count} (${pct}%) in ${elapsed.toFixed(1)}s`);
  const resBody=JSON.stringify({ok:okCount, total:count, pct:parseFloat(pct), elapsed,inboundProtocol:inboundProto},{});
  return new Response(resBody,{headers:{"content-type":"application/json"}});
}

export default{
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==="/health")return new Response("ok");
    if(url.pathname==="/proto"){const p=request.cf?.httpProtocol||"unknown";return new Response(JSON.stringify({inboundProtocol:p},null,2),{headers:{"content-type":"application/json"}});}
    return runBurst({request,url});
  }
};
