/* Topic-diverse module sessions in the REAL app (headless Chromium over raw CDP). What must hold: a real
 * 30-question study session on a 200-item module holding 40 concepts covers 30 distinct concepts (old random draw
 * averaged ~22), with no two consecutive questions sharing a concept and no uncaught error.
 *
 * USAGE: node test/run-diverse-session.mjs   (CHROME, CHROME_PORT, BASE)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8999) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 19311);
const userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/diverse-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8999"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}

/* 200 items, 40 concepts x 5 paraphrases: same answer entity + same rare stem word per concept. */
function moduleFile() {
  const items = [];
  for (let c = 0; c < 40; c++) for (let i = 0; i < 5; i++) {
    items.push({
      id: "div-" + c + "-" + i,
      q: "Rareword" + c + " case " + i + ": a stem with shared filler words about illness and care plan " + i,
      o: ["Remedy" + c + " cure", "Wrong one here", "Another wrong option", "Fourth wrong choice"],
      a: 0, exp: "Fixture explanation.", t: "ana-brachial-plexus", d: 1 + ((c + i) % 3), prov: "LIC",
    });
  }
  return { topic: "ana-brachial-plexus", items };
}

await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = "";
chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const sheetOpen = `return !!document.querySelector("#pnSetup .su-sheet") && !document.querySelector("#pnSetup .pn-load");`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-600));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url;
      let status = 404, body = { error: "not-found" };
      if (/ana-brachial-plexus\.json/.test(url)) { status = 200; body = moduleFile(); }
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*ana-brachial-plexus.json*", requestStage: "Request" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1");}catch(e){}` });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{["smd_prep_v1","smd_prep_setup","smd_prep_c_caps"].forEach(function(k){localStorage.removeItem(k);});}catch(e){} indexedDB.deleteDatabase("prep-gen"); indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await ev(`PREP.open({ subject: "anatomy" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');`, 20000), "subject lists the module");
  await click('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');
  ok(await until(sheetOpen, 8000), "opening the module shows the mode sheet");
  await click("#pnSetup .su-x");
  ok(await until(`return !document.getElementById("pnSetup") && !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000), "closed: the module screen");
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(sheetOpen, 8000), "Practise opens the setup sheet");
  await click('#pnSetup [data-act=su-n][data-v="30"]');
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && !document.getElementById("pnSetup");`, 8000), "Start begins the 30-question session");
  const n = await ev(`return PREP._st.run ? PREP._st.run.items.length : -1;`);
  ok(n === 30, "session holds 30 questions, got " + n);
  // Pool-context keys (same pattern as the unit tests): refetch the module pool, map ids, count the session.
  const stats = await ev(`return fetch(${JSON.stringify(FIX + "api/v1/anatomy/mcq/ana-brachial-plexus.json")}).then(function(r){return r.json();}).then(function(f){
    var P = PREP._pure, ks = P.conceptKeys(f.items), m = {};
    f.items.forEach(function(it, i){ m[it.id] = ks[i]; });
    var ids = PREP._st.run.items.map(function(x){ return x.id; });
    var seen = {}, d = 0, adj = 0;
    ids.forEach(function(id, i){ if(!seen[m[id]]){ seen[m[id]] = 1; d++; } if(i && m[id] === m[ids[i-1]]) adj++; });
    return JSON.stringify({ n: ids.length, distinct: d, adjacent: adj, concepts: Object.keys(seen).length });
  }).catch(function(x){ return "FETCH-ERR:" + String(x && x.message || x); });`);
  console.log("   session stats: " + stats);
  const s = JSON.parse(stats);
  ok(s.n === 30 && s.distinct >= 30, `30-question session covers ${s.distinct} distinct concepts (needed >= 30 of 40)`);
  ok(s.adjacent === 0, `no consecutive questions share a concept (adjacent repeats: ${s.adjacent})`);
  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "no uncaught prep errors");
} catch (x) {
  console.log("FAIL threw: " + (x && x.stack || x));
  fails++;
}
try { await call("Target.closeTarget", { targetId: undefined }); } catch {}
chrome.kill();
if (serveProc) serveProc.kill();
console.log(fails ? `DIVERSE-SESSION BROWSER: ${fails} FAILURES` : "DIVERSE-SESSION BROWSER: ALL PASS");
process.exit(fails ? 1 : 0);
