/* StewardMD - on-device case log (smd_case_log, default ON since 2026-09-28; "0" opts out), real browser.
 *   off: selecting a diagnosis records nothing
 *   on : one record per selection, with the tapped finding keys (true only), denied keys, the chosen diagnosis, the
 *        engine's top five, the gate and the month; no note text, no numeric values, no identifiers
 *   export returns the JSON; clear empties it
 * USAGE: BASE=http://localhost:8804/ CHROME=<chrome> node test/run-case-log.mjs
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
const PORT = Number(process.env.CDP_PORT || 9491);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/case-log-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
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

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  ok(await load(BASE), "app + KB load");
  await ev(`localStorage.setItem("smd_case_log","0"); DX.caseLogClear(); DX.findingCatalog(); return 1`);
  const pick = `var S=DX._state; S.f={fever:true, rigors:true, travelEndemicArea:true, age:34}; S.neg={cough:true}; DX._selectDx("MALARIA"); return JSON.stringify(DX.caseLog());`;
  ok(await ev(`return DX._caseLogOn()`) === false, "opt-out · \"0\" turns the case log off");
  ok(JSON.parse(await ev(pick)).length === 0, "off · selecting a diagnosis records nothing");
  ok(await load(BASE), "reload");
  await ev(`localStorage.removeItem("smd_case_log"); DX.findingCatalog(); return 1`);
  ok(await ev(`return DX._caseLogOn()`) === true, "default · the case log is on");
  const log = JSON.parse(await ev(pick));
  ok(log.length === 1, `on  · one record per selection (${log.length})`);
  const r = log[0] || {};
  ok(r.chosen === "MALARIA" && /^\d{4}-\d{2}$/.test(r.month || ""), `on  · chosen diagnosis and month only (${r.chosen}, ${r.month})`);
  ok(JSON.stringify(r.findings) === JSON.stringify(["fever", "rigors", "travelEndemicArea"]), `on  · finding keys true only, no numeric value (${r.findings})`);
  ok(JSON.stringify(r.denied) === JSON.stringify(["cough"]), `on  · denied keys kept (${r.denied})`);
  ok(Array.isArray(r.top5) && r.top5.length > 0 && r.top5.length <= 5, `on  · the engine's top five (${r.top5})`);
  ok(!/"age"|34|text|note|name/.test(JSON.stringify(r)), "on  · no age value, text or identifier in the record");
  const exp = await ev(`return DX.caseLogExport()`);
  ok(typeof exp === "string" && JSON.parse(exp).cases.length === 1, "export returns the JSON");
  await ev(`DX.caseLogClear(); localStorage.removeItem("smd_case_log"); return 1`);
  ok(JSON.parse(await ev(`return JSON.stringify(DX.caseLog())`)).length === 0, "clear empties the log");
  console.log(fails === 0 ? "\nALL GREEN: case log" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
