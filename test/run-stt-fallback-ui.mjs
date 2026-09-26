/* Cloud STT fallback credit, client side (owner 2026-09-26). Real index.html + reasoning.js + voice.js
 * in headless Chrome; the mic, MediaRecorder and the network are stubbed:
 *   - SMD_AI.transcribe sends durationMs and maps 402 stt-fallback-exhausted to its own error code
 *     (not the generic Pro upsell);
 *   - a plain 402 without that code still maps to { error:"quota", needsPro:true };
 *   - SMD_VOICE.listen's cloud recorder path reports "stt-fallback-exhausted" to onError and sent a
 *     measured recording duration.
 * USAGE: node test/run-stt-fallback-ui.mjs   (CHROME=/path/to/chrome, BASE=http://localhost:8902/) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9431, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/stt-fallback-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
const waitFor = async (e, n) => { for (let i = 0; i < (n || 50); i++) { const v = await ev(e); if (v != null && v !== false) return v; await sleep(100); } return null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// fetch stub: /transcribe answers with `window.__sttReply` ({status, body}) and records the request body.
const STUB = `
  window.__sttSent = null;
  if (!window.__realFetch) window.__realFetch = window.fetch;
  window.fetch = function (u, init) {
    if (String(u).indexOf("/transcribe") >= 0) {
      try { window.__sttSent = JSON.parse(init.body); } catch (e) {}
      var r = window.__sttReply || { status: 200, body: { transcript: "ok" } };
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } }));
    }
    return window.__realFetch.apply(this, arguments);
  };
  return "ok";`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SMD_VOICE && SMD_VOICE.listen && window.SMD_AI && SMD_AI.transcribe)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("SMD_VOICE / SMD_AI not loaded");
  // localhost makes aiBase() "" (dev = no cloud). Point it at a path the stub answers.
  await ev(`window.AI_PROXY = "/api/ai"; return 1;`);
  await ev(STUB);

  // 1) SMD_AI.transcribe: exhausted wallet -> its own code, durationMs sent.
  await ev(`window.__sttReply = { status: 402, body: { error: "stt-fallback-exhausted", allowanceInr: 10 } }; window.__x = null; SMD_AI.transcribe("data:audio/webm;base64,AAAA", { durationMs: 4321 }).then(function (r) { window.__x = JSON.stringify(r); }); return 1;`);
  const r1 = JSON.parse(await waitFor(`return window.__x`) || "null");
  ok(r1 && r1.error === "stt-fallback-exhausted", "exhausted wallet maps to stt-fallback-exhausted: " + JSON.stringify(r1));
  const sent1 = await J(`return JSON.stringify(window.__sttSent)`);
  ok(sent1 && sent1.durationMs === 4321, "durationMs is sent to the server: " + (sent1 && sent1.durationMs));

  // 2) A plain 402 still means Pro upsell.
  await ev(`window.__sttReply = { status: 402, body: { error: "quota", needsPro: true } }; window.__x = null; SMD_AI.transcribe("data:audio/webm;base64,AAAA").then(function (r) { window.__x = JSON.stringify(r); }); return 1;`);
  const r2 = JSON.parse(await waitFor(`return window.__x`) || "null");
  ok(r2 && r2.error === "quota" && r2.needsPro === true, "a plain 402 keeps the Pro-quota meaning: " + JSON.stringify(r2));

  // 3) Success is untouched.
  await ev(`window.__sttReply = { status: 200, body: { transcript: "bp 120 by 80", mode: "ai" } }; window.__x = null; SMD_AI.transcribe("data:audio/webm;base64,AAAA", { durationMs: 10 }).then(function (r) { window.__x = JSON.stringify(r); }); return 1;`);
  const r3 = JSON.parse(await waitFor(`return window.__x`) || "null");
  ok(r3 && r3.transcript === "bp 120 by 80", "success still returns the transcript");

  // 4) voice.js cloud recorder path end to end: no native STT, no Web Speech, stubbed mic.
  await ev(`
    try { delete window.SMD_NATIVE; } catch (e) { window.SMD_NATIVE = undefined; }
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    navigator.mediaDevices.getUserMedia = function () { return Promise.resolve({ getTracks: function () { return [{ stop: function () {} }]; } }); };
    window.MediaRecorder = function () { var self = this; this.state = "inactive"; this.mimeType = "audio/webm";
      this.start = function () { self.state = "recording"; };
      this.stop = function () { self.state = "inactive"; self.ondataavailable({ data: new Blob([new Uint8Array(64)], { type: "audio/webm" }) }); self.onstop(); }; };
    window.__sttReply = { status: 402, body: { error: "stt-fallback-exhausted" } };
    window.__err = null;
    window.__h = SMD_VOICE.listen({ onError: function (c) { window.__err = c; }, onFinal: function () {}, onState: function () {} });
    return window.__h ? window.__h.mode : "none";`);
  await sleep(300);
  await ev(`window.__h && window.__h.stop(); return 1;`);
  const err = await waitFor(`return window.__err`);
  ok(err === "stt-fallback-exhausted", "voice.js cloud path reports stt-fallback-exhausted: " + err);
  const sent4 = await J(`return JSON.stringify(window.__sttSent)`);
  ok(sent4 && sent4.durationMs >= 200, "voice.js sent the measured recording duration: " + (sent4 && sent4.durationMs));
} catch (e) { console.log("FAIL harness: " + (e && e.message || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
