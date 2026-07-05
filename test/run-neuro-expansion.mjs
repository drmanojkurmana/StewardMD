/* StewardMD — Acute Neurology & Toxidrome differential expansion test.
 *
 * Guards the additive DDX_NI candidates (hypertensive encephalopathy/PRES, post-ictal,
 * convulsive status epilepticus, NCSE, CVT, uraemic encephalopathy, alcohol withdrawal,
 * carbamate) that were added to the IM engine (candidate content + candidate-specific
 * find-maps only — the global scorer is unchanged).
 *
 * Asserts, against the REAL engine (DX._differential, KB-driven DX._ni):
 *  1) All 8 new candidates are REGISTERED in DX._ni.
 *  2) Index case (altered sensorium + focal + seizure + HTN, no meningism): acute
 *     neurological emergencies lead the non-infective column and out-rank meningitis
 *     — meningitis must NOT be the overall lead (acceptance criterion).
 *  3) Meningitis regression guard: with fever + neck stiffness + photophobia,
 *     MENINGITIS is still the clear infective lead (score 100).
 *  4) Each new candidate leads / surfaces on its own discriminating finding-set.
 *
 * USAGE: node test/run-neuro-expansion.mjs        (exit 0 = pass, 1 = fail)
 * Requires the local static server (auto-spawned) + Chromium/Chrome.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8793/";
const CHROME = process.env.CHROME_BIN
  || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => existsSync(p))
  || "google-chrome";
const PORT = 9368;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/neuro-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8793";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(150); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--no-sandbox"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

function diff(findings) {
  return `
    if(!window.DX||!window.DX._differential) return '__ERR__engine-not-loaded';
    DX._state.f = {};
    ${JSON.stringify(findings)}.forEach(function(k){ DX._state.f[k]=true; });
    var d = DX._differential();
    function m(a){ return (a||[]).map(function(r){ return {id:r.id, score:r.score}; }); }
    return JSON.stringify({ inf: m(d.inf), ni: m(d.ni) });
  `;
}

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) { if (cond) { PASS++; console.log("✅ " + name); } else { FAIL++; console.log("❌ " + name + (extra ? "  — " + extra : "")); } }
const rank = (list, id) => { const i = list.findIndex(x => x.id === id); return i < 0 ? Infinity : i; };
const score = (list, id) => { const x = list.find(y => y.id === id); return x ? x.score : -1; };

const NEW8 = ["hypertensive_enceph", "post_ictal", "status_epilepticus", "ncse", "cvt", "uraemic_enceph", "alcohol_withdrawal", "carbamate"];

try {
  let ver;
  for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 50; i++) { await sleep(400); const r = await ev(`return !!(window.DX && window.DX._differential && window.SYNDROMES && window.DX._ni);`); if (r === true) { ready = true; break; } }
  if (!ready) throw new Error("reasoning engine not loaded");
  await ev(`try{ if(DX.open){DX.open();} }catch(e){}; return 1;`); await sleep(400);

  // 1) registration
  const regRaw = await ev(`var ids=(window.DX._ni||[]).map(function(d){return d.id;}); return JSON.stringify(${JSON.stringify(NEW8)}.filter(function(x){return ids.indexOf(x)<0;}));`);
  const missing = JSON.parse(regRaw);
  ok("all 8 acute-neuro/toxidrome candidates registered in DX._ni", missing.length === 0, "missing: " + missing.join(","));

  async function get(findings) { const raw = await ev(diff(findings)); if (typeof raw === "string" && raw.startsWith("__ERR__")) throw new Error(raw); return JSON.parse(raw); }

  // 2) index acceptance case
  let d = await get(["alteredSensorium", "diabetesHx", "seizure", "focalNeuroDeficit", "hypertensionHx"]);
  const leadNiScore = d.ni[0] ? d.ni[0].score : 0;
  const meningInf = score(d.inf, "MENINGITIS");
  ok("index: non-infective lead out-ranks the infective meningitis soft-match",
    leadNiScore > meningInf, `leadNI=${d.ni[0] && d.ni[0].id}(${leadNiScore}) meningitis=${meningInf}`);
  const neuroEmerg = ["ich", "ischemic_stroke", "status_epilepticus", "hypertensive_enceph", "post_ictal"];
  const topNi = d.ni.slice(0, 6).map(x => x.id);
  ok("index: acute neurological emergencies surface in the top of the differential",
    neuroEmerg.filter(id => topNi.indexOf(id) >= 0).length >= 3, "topNI: " + topNi.join(","));

  // 3) meningitis regression guard
  d = await get(["fever", "neckStiffness", "alteredSensorium", "photophobia", "headache"]);
  ok("meningitis regression: MENINGITIS still the infective lead at 100 when meningism present",
    score(d.inf, "MENINGITIS") === 100 && d.inf[0].id === "MENINGITIS", `inf lead=${d.inf[0] && d.inf[0].id}(${score(d.inf, "MENINGITIS")})`);

  // 4) each new candidate on its discriminating finding-set
  const CASES = [
    { name: "hypertensive encephalopathy leads on AMS+HTN+headache+visual (no focal/fever)", f: ["alteredSensorium", "hypertensionHx", "headache", "visualDisturbance"], lead: "hypertensive_enceph" },
    { name: "post-ictal leads on seizure + recovering AMS", f: ["seizure", "alteredSensorium", "clinicallyImproving"], lead: "post_ictal" },
    { name: "uraemic encephalopathy leads on AMS + renal impairment + asterixis", f: ["alteredSensorium", "renalImpairment", "asterixis", "oliguria"], lead: "uraemic_enceph" },
    { name: "alcohol withdrawal leads on seizure + alcohol excess + tachycardia", f: ["seizure", "alcoholExcess", "tachycardia", "alteredSensorium"], lead: "alcohol_withdrawal" },
    { name: "status epilepticus top-2 on unrecovered AMS + seizure", f: ["alteredSensorium", "seizure"], surface: "status_epilepticus", within: 2 },
    { name: "NCSE surfaces on prolonged unexplained AMS + seizure", f: ["alteredSensorium", "seizure"], surface: "ncse", within: 5 },
    { name: "CVT surfaces on headache + seizure + focal + papilloedema", f: ["headache", "seizure", "focalNeuroDeficit", "papilledema"], surface: "cvt", within: 3 },
    { name: "carbamate surfaces alongside organophosphate on cholinergic toxidrome", f: ["miosisSecretions", "bradycardia", "diarrhea", "drugOverdose"], surface: "carbamate", within: 3 },
  ];
  for (const c of CASES) {
    d = await get(c.f);
    if (c.lead) ok(c.name, d.ni[0] && d.ni[0].id === c.lead, "NI lead: " + (d.ni[0] ? d.ni[0].id + "(" + d.ni[0].score + ")" : "none"));
    else ok(c.name, rank(d.ni, c.surface) < c.within, "rank of " + c.surface + " = " + (rank(d.ni, c.surface) === Infinity ? "absent" : rank(d.ni, c.surface)) + " (need <" + c.within + ")");
  }

  console.log(`\n${FAIL === 0 ? "ALL GREEN — acute-neuro/toxidrome expansion (" + PASS + " checks)" : FAIL + " FAILED, " + PASS + " passed"}`);
  if (FAIL > 0) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
