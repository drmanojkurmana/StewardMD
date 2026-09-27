/* StewardMD - prevalence prior (smd_prior_v1) real-browser test.
 *   1. flag OFF: classic order; a tie between equally scored diagnoses falls to the alphabet.
 *   2. flag ON: rank moves by exactly the tier bonus (+6 very common, +3 common, -4 rare, -8 very
 *      rare), confidence and the gate class never move, and a time-critical diagnosis is never
 *      pushed down for being rare.
 *   3. a hospital's aggregate diagnosis counts replace the tiers they cover.
 * The gold set is balanced across diagnoses, so it cannot show whether the prior helps; this test
 * only proves the mechanism. Population numbers: FLAGS=smd_prior_v1=1 node test/run-dx-audit.mjs
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-prior.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// data -> a JS literal safe to splice into code evaluated in the page (CodeQL js/bad-code-sanitization):
// JSON.stringify leaves <, >, U+2028 and U+2029 raw, so escape them (the pattern CodeQL documents)
const LIT_ESC = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => LIT_ESC[c]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9490);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/prior-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE);`);
    if (r === true) return true;
  }
  return false;
}
// every candidate's rank + confidence, the gate, and the leader, for a finding set
const q = async (keys) => JSON.parse(await ev(`var f={}; ${lit(keys)}.forEach(function(k){f[k]=true;}); var a=SMD_REASON.assess(f);
  var all=[].concat(a.infectious,a.nonInfectious), m={};
  all.forEach(function(x){ m[x.id]={r:x.rank, c:x.confidence}; });
  all.sort(function(x,y){return (y.rank-x.rank)||(y.confidence-x.confidence)||x.name.localeCompare(y.name);});
  return JSON.stringify({m:m, gate:a.gate.cls, ab:a.gate.ab, lead:all[0]&&all[0].id});`));

const SETS = [["fever", "rash"], ["fever", "cough"], ["headache"], ["fever", "soreThroat"], ["chestPain"], ["fever", "hypotension"], ["fever", "neckStiffness"]];
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. OFF --------------------------------------------------------------------------------
  ok(await load(BASE + "?prior=0"), "app + KB load with ?prior=0");
  await ev(`localStorage.removeItem("smd_prior_counts"); return 1`);
  ok((await ev(`return DX._prior()`)) === false, "off · DX._prior() is false");
  const off = {}; for (const s of SETS) off[s.join("+")] = await q(s);
  const fr0 = off["fever+rash"];
  ok(fr0.m.DENGUE.c === fr0.m.CHIKUNGUNYA.c && fr0.lead === "CHIKUNGUNYA", `off · fever + rash: dengue and chikungunya tie at ${fr0.m.DENGUE.c}, the alphabet picks ${fr0.lead}`);

  // ---- 2. ON ---------------------------------------------------------------------------------
  ok(await load(BASE + "?prior=1"), "app + KB load with ?prior=1");
  ok((await ev(`return DX._prior()`)) === true, "on  · DX._prior() is true (OPD Ask MaiK then orders by the engine rank)");
  const on = {}; for (const s of SETS) on[s.join("+")] = await q(s);
  ok(on["fever+rash"].lead === "DENGUE", `on  · fever + rash: the more common diagnosis leads (${on["fever+rash"].lead})`);
  const EXPECT = { DENGUE: 6, CAP: 6, migraine: 6, PHARYNGITIS: 6, CHIKUNGUNYA: 3, SCRUB_TYPHUS: 3, acs: 3, sarcoidosis: -4, vasculitis: -4,
    // time-critical: listed rare, never pushed down
    HLH: 0, serotonin_nms: 0, thyroid_storm: 0, MENINGITIS: 0, aortic_dissection: 0, SEPSIS: 3 };
  const seen = {};
  let drift = [], confMoved = [], gateMoved = [];
  for (const k of Object.keys(off)) {
    const a = off[k], b = on[k];
    if (a.gate !== b.gate || a.ab !== b.ab) gateMoved.push(k);
    for (const id of Object.keys(a.m)) {
      if (!b.m[id]) continue;
      if (a.m[id].c !== b.m[id].c) confMoved.push(`${k}:${id}`);
      if (EXPECT[id] != null) { const d = Math.round((b.m[id].r - a.m[id].r) * 1000) / 1000; seen[id] = d; if (d !== EXPECT[id]) drift.push(`${id} ${d} (want ${EXPECT[id]})`); }
    }
  }
  ok(!drift.length && Object.keys(seen).length >= 10, `on  · rank moves by exactly the tier bonus (${Object.entries(seen).map(([i, d]) => `${i} ${d > 0 ? "+" : ""}${d}`).join(", ")})${drift.length ? " DRIFT: " + drift.join("; ") : ""}`);
  ok(!confMoved.length, `on  · confidence never moves${confMoved.length ? " (" + confMoved.slice(0, 5).join(", ") + ")" : ""}`);
  ok(!gateMoved.length, `on  · the gate class and antibiotic call never move (${Object.keys(off).length} sets)${gateMoved.length ? " MOVED: " + gateMoved.join(", ") : ""}`);
  ok(seen.HLH === 0 && seen.thyroid_storm === 0, "on  · very rare but time-critical (HLH, thyroid storm) is not pushed down");

  // ---- 3. hospital counts --------------------------------------------------------------------
  await ev(`localStorage.setItem("smd_prior_counts", JSON.stringify({CHIKUNGUNYA: 900, SCRUB_TYPHUS: 100, DENGUE: 10, sah: 1})); return 1`);
  const hc = await q(["fever", "rash"]);
  ok(hc.lead === "CHIKUNGUNYA", `counts · this hospital sees chikungunya 90x more than dengue: it leads fever + rash (${hc.lead})`);
  const d = Math.round((hc.m.DENGUE.r - off["fever+rash"].m.DENGUE.r) * 100) / 100, c = Math.round((hc.m.CHIKUNGUNYA.r - off["fever+rash"].m.CHIKUNGUNYA.r) * 100) / 100;
  ok(d < 0 && d >= -8 && c > 0 && c <= 8, `counts · bounded at +/-8 (chikungunya ${c > 0 ? "+" : ""}${c}, dengue ${d})`);
  const hs = await q(["headache"]);
  ok(Math.round(hs.m.sah.r - off.headache.m.sah.r) === 0 && Math.round(hs.m.migraine.r - off.headache.m.migraine.r) === 6,
    "counts · a rare count never pushes SAH down; diagnoses without a count keep their tier (migraine +6)");
  await ev(`localStorage.setItem("smd_prior_counts", "not json"); return 1`);
  const bad = await q(["fever", "rash"]);
  ok(bad.lead === "DENGUE", "counts · malformed counts fall back to the tiers");
  await ev(`localStorage.removeItem("smd_prior_counts"); return 1`);

  // ---- the doctor's own switch (owner, 2026-09-27: "prevalence based order should be optional") ----
  await ev(`localStorage.removeItem("smd_prior_v1"); return 1`);
  ok(await load(BASE), "switch · app loads without ?prior");
  ok((await ev(`return DX._prior()`)) === false, "switch · off by default");
  const sw = async () => JSON.parse(await ev(`try{DX.openWorkspace();}catch(e){} DX.reset&&DX.reset(); DX.addFindings(["fever","rash","myalgiaArthralgia"]);
    var s=document.querySelector('#dxPriorSw'), l=s&&s.closest('label'), ids=[].map.call(document.querySelectorAll('.dx-row-head[data-id]'),function(h){return h.getAttribute('data-id');});
    return JSON.stringify({has:!!s, on:!!(s&&s.checked), text:l?l.innerText:'', ids:ids, wide:(function(){var b=document.querySelector('#dxOverlay .dx-body');return !b||b.scrollWidth<=b.clientWidth+1;})()});`));
  let st = await sw();
  ok(st.has && !st.on && /common diagnoses first/i.test(st.text) && !/\u2014/.test(st.text), `switch · shown under "All possibilities", unticked, plain wording ("${st.text.replace(/\s+/g, " ").slice(0, 60)}...")`);
  ok(st.wide, "switch · no horizontal overflow at phone width");
  await ev(`var s=document.querySelector('#dxPriorSw'); s.checked=true; s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  st = await sw();
  ok(st.on && (await ev(`return localStorage.getItem("smd_prior_v1")`)) === "1" && (await ev(`return DX._prior()`)) === true, "switch · ticking it turns the prior on and remembers it on this device");
  ok(st.ids.indexOf("DENGUE") >= 0 && st.ids.indexOf("DENGUE") < st.ids.indexOf("CHIKUNGUNYA"), `switch · on: the commoner dengue sits above chikungunya (${st.ids.slice(0, 4).join(", ")})`);
  await ev(`var s=document.querySelector('#dxPriorSw'); s.checked=false; s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  ok((await ev(`return localStorage.getItem("smd_prior_v1")`)) === "0" && (await ev(`return DX._prior()`)) === false, "switch · unticking turns it off again");
  await ev(`localStorage.removeItem("smd_prior_v1"); return 1`);

  console.log(fails === 0 ? "\nALL GREEN: prevalence prior" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
