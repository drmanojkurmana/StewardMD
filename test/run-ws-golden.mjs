/* StewardMD — Specialty Workspaces GOLDEN-CASE regression harness.
 *
 * WHY: the specialty engines (ws-*.js) are living clinical content. This freezes
 * the deterministic assess() output of EVERY syndrome over a fixed set of
 * selection profiles, so any future edit that changes management advice shows up
 * as an explicit, reviewable diff (a clinician must intend the change) instead of
 * drifting silently. Sibling of test/run-golden.mjs (the IM engine net).
 *
 * USAGE:
 *   CHROME_BIN=... node test/run-ws-golden.mjs --update   # capture/refresh baseline
 *   CHROME_BIN=... node test/run-ws-golden.mjs            # compare vs baseline (regression)
 * Baseline: test/golden/workspaces-baseline.json. NOT shipped to users.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8799/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9363;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/wsgold-chrome-prof";
const UPDATE = process.argv.includes("--update");
const GOLDEN = join(HERE, "golden", "workspaces-baseline.json");

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8799";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

// Capture assess() output for every syndrome over 4 fixed profiles: none / all-q / all-danger / all.
const CAPTURE = `
  var out={};
  Object.keys(SMD_WS_ENGINES||{}).sort().forEach(function(eid){
    var eng=SMD_WS_ENGINES[eid];
    (eng.syndromes||[]).forEach(function(syn){
      var q=(syn.q||[]).map(function(x){return x.id;}), d=(syn.danger||[]).map(function(x){return x.id;});
      var profiles={none:[], q:q, danger:d, all:q.concat(d)};
      Object.keys(profiles).forEach(function(pk){
        var set=new Set(profiles[pk]); set.has=Set.prototype.has.bind(set);
        var r; try{ r=syn.assess(set)||{}; }catch(e){ r={__throw:e.message}; }
        out[eid+'|'+syn.id+'|'+pk]={emergency:r.emergency,ladder:r.ladder,catg:r.catg,sc:r.sc,ref:r.ref,mgmt:r.mgmt,shared:r.shared||false,throw:r.__throw||null};
      });
    });
  });
  return JSON.stringify(out);
`;

function diffKeys(a, b) {
  const out = [], keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  for (const k of keys) {
    const x = JSON.stringify(a ? a[k] : undefined), y = JSON.stringify(b ? b[k] : undefined);
    if (x !== y) out.push("    " + k + ":\n      base: " + String(x).slice(0, 160) + "\n      now : " + String(y).slice(0, 160));
  }
  return out;
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE + "?workspaces=1" });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(400); if ((await ev(`return !!(window.SMD_WS_ENGINES && Object.keys(window.SMD_WS_ENGINES).length>=7);`)) === true) { ready = true; break; } }
  if (!ready) throw new Error("SMD_WS_ENGINES not loaded within timeout");

  const raw = await ev(CAPTURE);
  if (typeof raw === "string" && raw.startsWith("__ERR__")) throw new Error(raw);
  const now = JSON.parse(raw);
  const nCases = Object.keys(now).length;

  if (UPDATE) {
    mkdirSync(join(HERE, "golden"), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify({ _meta: { note: "frozen assess() output per syndrome × {none,q,danger,all} profile", cases: nCases }, cases: now }, null, 2));
    console.log(`✅ workspaces baseline written: ${GOLDEN}\n   ${nCases} snapshot cases across ${new Set(Object.keys(now).map(k => k.split("|")[0])).size} engines`);
  } else {
    if (!existsSync(GOLDEN)) throw new Error("no workspaces-baseline.json — run with --update first");
    const base = JSON.parse(readFileSync(GOLDEN, "utf8")).cases;
    const d = diffKeys(base, now);
    if (d.length) { console.log(`❌ specialty-engine output CHANGED (${d.length} case(s)) — review + re-baseline if intended:`); d.slice(0, 40).forEach(l => console.log(l)); process.exitCode = 1; }
    else console.log(`ALL GREEN — specialty-engine output unchanged (${nCases} snapshot cases)`);
  }
  ws.close();
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
  if (serveProc) serveProc.kill("SIGKILL");
}
