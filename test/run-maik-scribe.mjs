/* MaiK Scribe inline-mic test (behavior; flag smd_maik_inline_mic default ON).
 * Boots the real app, injects a MOCK SMD_VOICE (no device mic needed), opens MaiK,
 * and drives the composer mic. Verifies:
 *   1. tap → mic goes .live (red) + transcript lands in THIS composer box (no dialog)
 *   2. tap again → stop → final transcript kept, .live cleared
 *   3. first run (no engine pref) + clinical available → Fast/Clinical chooser opens
 *   4. the "Dictate" home tile (SMD_dictateMaik) opens MaiK and auto-starts recording
 *   5. ?scribeinline=0 falls back to the old modal dialog (openDialog), never inline
 * USAGE: node test/run-maik-scribe.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9384, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-scribe-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8991"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// The mock voice engine — mirrors SMD_VOICE's contract (listen/stop/available/openDialog).
const MOCK = `
  window.__v = { listens: 0, engine: null, stops: 0, dialogs: 0 };
  var _cb = null;
  window.SMD_VOICE = {
    available: function () { return { native:false, webspeech:false, aistt:true, whisper: window.__whisper === true }; },
    listen: function (opts) { window.__v.listens++; window.__v.engine = opts.engine || "fast"; _cb = opts;
      setTimeout(function(){ if(opts.onState) opts.onState("listening"); if(opts.onPartial) opts.onPartial("patient with fever and cough"); }, 10);
      return { stop: function(){ window.__v.stops++; if(_cb && _cb.onFinal) _cb.onFinal("patient with fever and cough for three days"); } }; },
    stop: function () { window.__v.stops++; if(_cb && _cb.onFinal) _cb.onFinal("patient with fever and cough for three days"); },
    openDialog: function () { window.__v.dialogs++; }
  };
  return 1;`;

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return typeof window.SMD_askMaik === "function"`) === true) return true; }
  return false;
}
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const booted = await attach(BASE);
  ok(booted, "app booted (window.SMD_askMaik ready)");
  if (!booted) throw new Error("boot failed");

  const micLive = () => ev(`var m=document.getElementById("maikMic"); return !!(m && m.classList.contains("live"));`);
  const micPresent = () => ev(`return !!document.getElementById("maikMic");`);
  const boxVal = () => ev(`var t=document.querySelector("#maikSheet .maik-ta"); return t? t.value : null;`);
  const tapMic = () => ev(`var m=document.getElementById("maikMic"); if(m) m.click(); return 1;`);
  const openMaik = async () => { await ev(`window.SMD_askMaik("")`); await sleep(500); };

  // ── 1 & 2: record → inline text → stop ───────────────────────────────────
  await ev(MOCK);
  await ev(`try{localStorage.setItem("smd_maik_inline_mic","1");localStorage.setItem("smd_maik_scribe_engine","fast");}catch(e){}; return 1;`);
  await openMaik();
  ok(await micPresent(), "MaiK opened with composer mic");
  await tapMic(); await sleep(250);
  ok(await micLive() === true, "tap → mic goes .live (red recording)");
  ok((await boxVal() || "").indexOf("fever and cough") >= 0, "transcript injected into the composer box (no dialog)");
  ok(await ev(`return window.__v.dialogs`) === 0, "no modal dialog opened (inline path)");
  await tapMic(); await sleep(250);
  ok(await micLive() === false, "tap again → recording stops (.live cleared)");
  ok((await boxVal() || "").indexOf("three days") >= 0, "final transcript kept in the box");

  // ── 3: first-run + clinical available → chooser opens ─────────────────────
  await ev(`try{localStorage.removeItem("smd_maik_scribe_engine");}catch(e){}; window.__whisper=true; return 1;`);
  await openMaik();
  await tapMic(); await sleep(200);
  ok(await ev(`return !!document.getElementById("maikEng");`) === true, "first run + clinical available → Fast/Clinical chooser opens (no recording yet)");
  ok(await micLive() === false, "chooser shown, mic not yet recording");
  ok(await ev(`return !!document.querySelector('#maikEng [data-eng="clinical"]:not([disabled])');`) === true, "Clinical option enabled when available");

  // ── 4: Dictate home tile → open MaiK + auto-start recording ───────────────
  await ev(`try{localStorage.setItem("smd_maik_scribe_engine","fast");}catch(e){}; return 1;`);
  await ev(`window.__v.listens=0; window.SMD_dictateMaik(); return 1;`); await sleep(900);
  ok(await micLive() === true, "Dictate tile → MaiK opens and mic auto-starts recording");
  ok((await boxVal() || "").indexOf("fever and cough") >= 0, "auto-dictation transcript lands in the box");
  await tapMic(); await sleep(150); // stop cleanly

  // ── 6: sending during dictation stops recording + keeps the box cleared ───
  await ev(`try{localStorage.setItem("smd_maik_scribe_engine","fast");}catch(e){}; return 1;`);
  await openMaik();
  await tapMic(); await sleep(220);
  ok(await micLive() === true, "recording active before send");
  await ev(`var s=document.getElementById("maikSend"); if(s) s.click(); return 1;`); await sleep(350);
  ok((await boxVal() || "") === "", "send clears the composer box");
  ok(await micLive() === false, "send stops recording (red off)");
  ok(await ev(`return !!document.querySelector('#maikBody .maik-b.you')`) === true, "the dictated text was sent as a question");

  // ── 7: export-conversation menu (Copy / Text / PDF) ───────────────────────
  await ev(`var e=document.getElementById("maikExport"); if(e) e.click(); return 1;`); await sleep(150);
  ok(await ev(`return !!document.getElementById("maikExpMenu")`) === true, "export menu opens when a conversation exists");
  ok(await ev(`return document.querySelectorAll('#maikExpMenu button[data-x]').length`) === 3, "export offers Copy / Text / PDF");
  await ev(`var p=document.getElementById("maikExpMenu"); if(p) p.remove(); return 1;`);

  // ── 8: mk2 + Motion One springs — sheet still opens cleanly ───────────────
  await ev(`document.body.classList.add('mk2'); if(!window.Motion && !document.getElementById('mk-motion-js')){var s=document.createElement('script');s.id='mk-motion-js';s.src='/vendor/motion/motion.js';document.head.appendChild(s);} return 1;`);
  let motionOk = false; for (let i = 0; i < 25; i++) { await sleep(200); if (await ev(`return !!(window.Motion && window.Motion.animate)`) === true) { motionOk = true; break; } }
  ok(motionOk, "Motion One lib loads (vendor/motion/motion.js)");
  await openMaik();
  ok(await micPresent() === true, "MaiK sheet opens cleanly with mk2 Motion springs (no break)");

  // ── 9: kill-switch ?scribeinline=0 → legacy dialog, never inline ──────────
  await ev(`try{localStorage.setItem("smd_maik_inline_mic","0");}catch(e){}; window.__v.dialogs=0; return 1;`);
  await openMaik();
  await tapMic(); await sleep(200);
  ok(await ev(`return window.__v.dialogs`) === 1, "?scribeinline=0 → tap opens the legacy modal dialog");
  ok(await micLive() === false, "kill-switch: inline recording not used");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL SCRIBE CHECKS PASSED");
} catch (e) { console.error("ERROR:", e && e.message || e); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails ? 1 : 0); }
