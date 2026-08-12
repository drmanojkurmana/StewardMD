/* REAL ambient capture-loop test (headless Chrome, CDP). Loads the REAL voice-ambient.js capture
 * loop over the REAL deterministic layer, mocking ONLY SMD_VOICE.listen (the ASR seam a device
 * supplies). This is the end-to-end that unit + stubbed-SMD_AMBIENT tests never exercised.
 * Proves:
 *   A) Whisper UNAVAILABLE (Android / iOS model not downloaded): start() does NOT stack-overflow,
 *      the loop falls back to the device's built-in STT (engine "fast", noCloud), and a spoken
 *      "BP 100/60 pulse 88" autofills bpSys/bpDia/pulse via onUpdate.
 *   B) Whisper AVAILABLE: a record-mode onFinal window autofills bpSys/tenderness via onUpdate.
 * USAGE: node test/run-ambient-capture-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8799, DBG = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ambient-cap-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const fields = async () => JSON.parse(await ev(`var m={}; window.__updates.forEach(function(u){(u.updates||[]).forEach(function(x){m[x.field]=x.value;})}); return JSON.stringify(m);`));

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/ambient-capture-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real voice-ambient.js + deterministic layer loaded (SMD_AMBIENT/SMD_VVITALS/SMD_EMRMAP present)");

  // ---- A) Whisper UNAVAILABLE -> must not crash, must fall back to device STT, must autofill ----
  const started = await ev(`window.__mock.whisperOK=false; window.__calls=[]; window.__updates=[]; window.__states=[]; window.__errors=[];
    window.__amb = window.SMD_AMBIENT.start({ chunkMs:60000, onUpdate:function(r){window.__updates.push(r);}, onState:function(s){window.__states.push(s);}, onError:function(e){window.__errors.push(e);} });
    return "started-ok";`);
  ok(started === "started-ok", "start() returns without throwing when Whisper is unavailable (no synchronous stack-overflow recursion)");
  ok((await ev(`return window.__calls.length && window.__calls[0].engine;`)) === "clinical", "loop attempts clinical (on-device Whisper) first");
  ok((await ev(`return window.__states.indexOf("fallback")>=0;`)) === true, "loop signals 'fallback' when clinical is unavailable (instead of dying)");
  ok((await ev(`return window.__errors.indexOf("clinical-unavailable")<0;`)) === true, "clinical-unavailable is NOT surfaced as a terminal error (it is recovered)");

  await sleep(500); // let the deferred re-arm fire
  ok((await ev(`return window.__calls.some(function(c){return c.engine==="fast";});`)) === true, "loop re-arms on the device's built-in STT (engine 'fast')");
  ok((await ev(`return window.__calls.filter(function(c){return c.engine==="fast";}).every(function(c){return c.noCloud===true;});`)) === true, "SAFETY: fallback STT is on-device only (noCloud) - consultation audio never goes to the cloud");

  await ev(`if(window.__last&&window.__last.onPartial) window.__last.onPartial("BP 100/60, pulse 88 regular"); return 1;`);
  await sleep(80);
  const fa = await fields();
  ok(fa.bpSys === 100 && fa.bpDia === 60 && fa.pulse === 88, "AUTOFILL via fallback STT: 'BP 100/60 pulse 88' -> bpSys=100, bpDia=60, pulse=88 (got " + JSON.stringify(fa) + ")");
  await ev(`try{window.__amb.stop();}catch(x){} return 1;`);

  // ---- B) Whisper AVAILABLE -> record-mode onFinal window autofills ----
  await ev(`window.__mock.whisperOK=true; window.__calls=[]; window.__updates=[]; window.__states=[]; window.__errors=[];
    window.__amb2 = window.SMD_AMBIENT.start({ chunkMs:60000, onUpdate:function(r){window.__updates.push(r);} });
    return 1;`);
  ok((await ev(`return window.__calls.length && window.__calls[0].engine;`)) === "clinical", "with Whisper available the loop uses clinical (no fallback)");
  await ev(`if(window.__last&&window.__last.onFinal) window.__last.onFinal("BP 120/80, pulse 72 regular. per abdomen soft non-tender"); return 1;`);
  await sleep(80);
  const fb = await fields();
  ok(fb.bpSys === 120 && fb.tenderness === "No", "AUTOFILL via clinical Whisper: onFinal window -> bpSys=120, tenderness=No (got " + JSON.stringify(fb) + ")");
  await ev(`try{window.__amb2.stop();}catch(x){} return 1;`);

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll ambient capture-loop checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
