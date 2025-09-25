const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const CONCURRENCY_PER_HOST = Number(process.env.CONCURRENCY_PER_HOST || 8);
const REQUEST_METHOD = (process.env.REQUEST_METHOD || "GET").toUpperCase();
const REQUEST_PATH_TEMPLATE = process.env.REQUEST_PATH_TEMPLATE || "/{workerId}";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const PUMP_INTERVAL_MS = Number(process.env.PUMP_INTERVAL_MS || 10);
const TARGET_BASE = process.env.TARGET_BASE || null;

const now = () => new Date().toISOString();

const gates = new Map();
function gateForHost(host) {
  let g = gates.get(host);
  if (!g) {
    const keyId = crypto.createHash("md5").update(host).digest("hex").slice(0, 8);
    g = { active: 0, limit: CONCURRENCY_PER_HOST, keyId };
    gates.set(host, g);
  }
  return g;
}
function tokensAvailable(host) {
  const g = gateForHost(host);
  return Math.max(0, g.limit - g.active);
}
function acquireToken(host) {
  const g = gateForHost(host);
  g.active += 1;
  return g.keyId;
}
function releaseToken(host) {
  const g = gateForHost(host);
  g.active = Math.max(0, g.active - 1);
}

const runs = new Map();

function buildTaskUrl(base, workerId) {
  const u = new URL(base);
  const path = REQUEST_PATH_TEMPLATE.replace("{workerId}", String(workerId));
  u.pathname = (u.pathname.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "")).replace(/\/{2,}/g, "/");
  return u.toString();
}

async function dispatch(run, idx) {
  const host = run.host;
  const gateKey = acquireToken(host);
  const url = buildTaskUrl(run.targetBase, idx);
  console.log(`${now()} [DISPATCH] run=${run.runId} worker=${idx} gate=${gateKey} -> ${url}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const init = { method: REQUEST_METHOD, signal: controller.signal, headers: { "x-run-id": run.runId, "x-worker-id": String(idx) } };
    if (REQUEST_METHOD === "POST" && run.bodyTemplate) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify({ ...run.bodyTemplate, workerId: idx, runId: run.runId });
    }
    const resp = await fetch(url, init);
    clearTimeout(timeout);
    console.log(`${now()} [RESULT] run=${run.runId} worker=${idx} status=${resp.status} ok=${resp.ok}`);
    run.doneCount += 1;
  } catch (err) {
    const tries = run.retryCounts.get(idx) ?? 0;
    const next = tries + 1;
    run.retryCounts.set(idx, next);
    console.log(`${now()} [ERROR]  run=${run.runId} worker=${idx} err=${(err && err.message) || err} tries=${next}`);
    if (next <= MAX_RETRIES) {
      run.pending.push(idx);
    } else {
      console.log(`${now()} [GIVEUP] run=${run.runId} worker=${idx}`);
      run.doneCount += 1;
    }
  } finally {
    releaseToken(host);
    setImmediate(() => pump(run));
  }
}

function fillSlots(run) {
  const g = gateForHost(run.host);
  console.log(`${now()} [TOKENS] Current token count: ${g.active}`);
  let started = 0;
  let slots = tokensAvailable(run.host);
  while (slots > 0) {
    let idx = -1;
    if (run.nextIndex < run.total) {
      idx = run.nextIndex++;
    } else if (run.pending.length > 0) {
      idx = run.pending.shift();
    } else {
      break;
    }
    if (idx >= 0) {
      started += 1;
      dispatch(run, idx);
    }
    slots = tokensAvailable(run.host);
  }
  const qlen = run.total - run.doneCount;
  console.log(`${now()} [PROCESS] Available key: ${g.keyId}, Queue size: ${qlen}, Processing: ${g.active}, Active: ${g.active}`);
  if (started === 0 && run.doneCount < run.total) {
    console.log(`${now()} [PROCESS] No candidate; queue=${qlen} inFlight=${g.active} done=${run.doneCount}/${run.total}`);
  }
}

function pump(run) {
  if (!runs.has(run.runId)) return;
  if (run.loopActive) return;
  run.loopActive = true;
  const loop = () => {
    try {
      if (run.doneCount >= run.total) {
        console.log(`${now()} [DONE] run=${run.runId} completed=${run.doneCount}/${run.total}`);
        run.loopActive = false;
        return;
      }
      fillSlots(run);
      setTimeout(loop, PUMP_INTERVAL_MS);
    } catch (e) {
      console.log(`${now()} [SCHEDULER-ERR] run=${run.runId} err=${(e && e.message) || e}`);
      run.loopActive = false;
      setTimeout(() => pump(run), 50);
    }
  };
  loop();
}

app.post("/:count", (req, res) => {
  const count = Math.max(0, Math.min(1_000_000, parseInt(req.params.count, 10) || 0));
  const runId = crypto.randomUUID();
  const targetBase = (req.body && req.body.target) || TARGET_BASE;
  if (!targetBase) return res.status(400).json({ error: "missing target base" });

  const host = new URL(targetBase).host;

  console.log(`${now()} [MAIN-REQUEST] POST from ${req.ip}: ${JSON.stringify({ url: req.originalUrl })}`);
  console.log(`${now()} STARTING: COUNT=${count}, TARGET=${targetBase}`);
  console.log(`${now()} [ENV] building gate for host=${host}`);

  const run = {
    runId,
    host,
    targetBase,
    total: count,
    nextIndex: 0,
    pending: [],
    doneCount: 0,
    retryCounts: new Map(),
    loopActive: false,
    bodyTemplate: req.body && typeof req.body.body === "object" ? { ...req.body.body } : null,
  };

  for (let i = 0; i < count; i++) {
    console.log(`${now()} [QUEUE] Adding task ${i} to queue. Current queue size: ${i + 1}`);
  }

  runs.set(runId, run);
  const g = gateForHost(run.host);
  console.log(`${now()} [TOKENS-AFTER] Token count after task generation: ${g.active}`);
  pump(run);

  res.json({ runId, target: targetBase, enqueued: count, concurrencyPerHost: g.limit });
});

app.get("/status/:runId", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  const g = gateForHost(run.host);
  res.json({
    runId: run.runId,
    target: run.targetBase,
    totals: { total: run.total, completed: run.doneCount, inFlight: g.active, pending: Math.max(0, run.total - run.doneCount - g.active) },
    gate: { active: g.active, limit: g.limit, keyId: g.keyId }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`${now()} listening on :${PORT}`);
});
