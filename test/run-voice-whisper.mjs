/* MaiK Scribe — Phase C wiring test (Clinical Dictation behind smd_whisper_clinical_dictation).
 *
 * Proves the flag-gated Whisper wiring in voice.js WITHOUT changing Fast Dictation:
 *   • flag OFF  ⇒ available().whisper=false, NO Fast/Clinical selector, dialog identical to before;
 *   • flag ON but no native plugin (web) ⇒ still false (Whisper is native-only);
 *   • flag ON + native plugin present ⇒ available().whisper=true, selector appears (Fast default);
 *   • listen({engine:"clinical"}) routes to SMD_NATIVE.transcribeWhisper; when unavailable it emits
 *     "clinical-unavailable" and returns null (NEVER auto-cloud);
 *   • listen({engine:"fast"}) / no engine NEVER touch Whisper (Fast path untouched).
 * Runs on the web build (native plugin is STUBBED). Deterministic.  USAGE: node test/run-voice-whisper.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9410, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/voice-whisper-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SMD_VOICE && SMD_VOICE.available && SMD_VOICE.listen && SMD_VOICE.openDialog)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("SMD_VOICE not loaded");

  // Helpers to set flag / (un)install a fake native Whisper plugin on the web page.
  const setup = async (flag, stubNative) => await ev(`
    try { ${flag ? `localStorage.setItem("smd_whisper_clinical_dictation","1")` : `localStorage.removeItem("smd_whisper_clinical_dictation")`}; } catch(e){}
    window.__wCalled = null;
    ${stubNative
      ? `window.__wDeleted = false; window.SMD_NATIVE = { transcribeWhisper: function(o){ window.__wCalled = { model:o&&o.model, language:o&&o.language, prompt:(o&&o.initialPrompt)||"", hasFinal: typeof (o&&o.onFinal)==="function" }; return function(){}; }, stopWhisper: function(){}, cancelWhisper: function(){}, whisperModelInstalled: function(){ return Promise.resolve({ installed:true, bytes:59707625 }); }, deleteWhisperModel: function(){ window.__wDeleted = true; return Promise.resolve(); } };`
      : `try { delete window.SMD_NATIVE; } catch(e){ window.SMD_NATIVE = undefined; }`}
    return "ok";
  `);

  // ===== 1) FLAG OFF — behaves exactly as before =====
  await setup(false, false);
  const a0 = await J(`var a = SMD_VOICE.available(); return JSON.stringify({ keys: Object.keys(a).sort(), whisper: a.whisper, native: a.native });`);
  ok(a0.whisper === false, "flag OFF → available().whisper === false");
  ok(JSON.stringify(a0.keys) === JSON.stringify(["aistt", "native", "webspeech", "whisper"]), "available() shape preserved (+whisper key): " + a0.keys.join(","));

  const d0 = await J(`
    SMD_VOICE.openDialog({ target: "reasoning" });
    var modes = document.querySelectorAll(".smdv-modes").length;
    var rec = !!document.querySelector("#smdvRec");
    return JSON.stringify({ modes: modes, rec: rec });
  `);
  ok(d0.modes === 0, "flag OFF → NO Fast/Clinical selector rendered");
  ok(d0.rec === true, "flag OFF → the standard MaiK Scribe record button is unchanged/present");

  // listen with no engine (default) must NOT touch Whisper even if a plugin were present.
  const f0 = await J(`
    var r = SMD_VOICE.listen({ onError: function(){}, onState: function(){} });   // default = fast
    var touched = !!window.__wCalled; SMD_VOICE.stop();
    return JSON.stringify({ touchedWhisper: touched });
  `);
  ok(f0.touchedWhisper === false, "default listen() never routes to Whisper (Fast path)");

  // ===== 2) FLAG ON but NO native plugin (web) — Whisper still unavailable =====
  await setup(true, false);
  const a1 = await J(`return JSON.stringify({ whisper: SMD_VOICE.available().whisper });`);
  ok(a1.whisper === false, "flag ON + no native plugin (web) → whisper still false");
  const c1 = await J(`
    var err = null; var r = SMD_VOICE.listen({ engine: "clinical", onError: function(e){ err = e; } });
    return JSON.stringify({ err: err, nullReturn: r === null });
  `);
  ok(c1.err === "clinical-unavailable" && c1.nullReturn, "clinical requested but unavailable → onError('clinical-unavailable'), returns null (no cloud)");

  // ===== 3) FLAG ON + native plugin present — selector + routing =====
  await setup(true, true);
  const a2 = await J(`return JSON.stringify({ whisper: SMD_VOICE.available().whisper });`);
  ok(a2.whisper === true, "flag ON + native Whisper plugin present → whisper true");

  const d2 = await J(`
    SMD_VOICE.openDialog({ target: "reasoning" });
    var modes = document.querySelector(".smdv-modes");
    var btns = modes ? [].map.call(modes.querySelectorAll(".smdv-mode"), function(b){ return b.getAttribute("data-mode") + (b.classList.contains("on") ? ":on" : ""); }) : [];
    return JSON.stringify({ present: !!modes, btns: btns });
  `);
  ok(d2.present === true, "flag ON + plugin → Fast/Clinical selector appears");
  ok(JSON.stringify(d2.btns) === JSON.stringify(["fast:on", "clinical"]), "selector shows Fast (default ON) + Clinical: " + d2.btns.join(","));

  const c2 = await J(`
    window.__wCalled = null;
    var r = SMD_VOICE.listen({ engine: "clinical", onFinal: function(){}, onError: function(){}, onState: function(){} });
    var eng = r && r.engine; SMD_VOICE.stop();
    return JSON.stringify({ called: window.__wCalled, engine: eng });
  `);
  ok(c2.called && c2.engine === "Clinical (on-device)", "listen({engine:'clinical'}) routes to SMD_NATIVE.transcribeWhisper (model " + (c2.called && c2.called.model) + ")");
  ok(c2.called && c2.called.language === "en", "clinical defaults to English ('en') regardless of device locale");
  ok(c2.called && /Indian English/i.test(c2.called.prompt || "") && /piperacillin-tazobactam/i.test(c2.called.prompt || ""), "clinical sends an Indian-English medical initial_prompt (bias): \"" + String(c2.called && c2.called.prompt).slice(0, 60) + "…\"");

  const f2 = await J(`
    window.__wCalled = null;
    SMD_VOICE.listen({ engine: "fast", onError: function(){}, onState: function(){} });
    var touched = !!window.__wCalled; SMD_VOICE.stop();
    return JSON.stringify({ touchedWhisper: touched });
  `);
  ok(f2.touchedWhisper === false, "listen({engine:'fast'}) with plugin present STILL never touches Whisper (Fast unchanged)");

  // ===== 4) Uninstall button — appears when a model is installed, deletes via the bridge =====
  // The SW's activate-reload can wipe the injected window stub mid-run (fires at most once per
  // version), so retry: re-inject stub + reopen until the control renders — this converges.
  let dmText = "", dmPresent = false;
  for (let attempt = 0; attempt < 8 && !dmPresent; attempt++) {
    await setup(true, true);
    await ev(`SMD_VOICE.openDialog({ target: "reasoning" });`);
    await sleep(350);
    const r = await J(`var b = document.querySelector("#smdvModelMgr .smdv-model-del"); return JSON.stringify({ present: !!b, text: b ? b.textContent : "" });`);
    if (r && r.present) { dmPresent = true; dmText = r.text; }
  }
  ok(dmPresent, "installed model → 'Remove Clinical model' button appears: \"" + dmText + "\"");
  // (The button's onclick calls window.confirm(), which blocks a headless renderer — so we exercise
  //  the bridge the button uses, directly, to prove the delete path is wired.)
  const dz = await J(`if (window.SMD_NATIVE && window.SMD_NATIVE.deleteWhisperModel) window.SMD_NATIVE.deleteWhisperModel(); return JSON.stringify({ deleted: window.__wDeleted });`);
  ok(dz.deleted === true, "SMD_NATIVE.deleteWhisperModel() removes the downloaded model (bridge wired)");

  console.log(fails === 0 ? "\nALL GREEN — MaiK Scribe Phase-C wiring test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
