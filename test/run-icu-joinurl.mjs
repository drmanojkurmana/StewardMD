/* ICU deep-link join hook test (ICU.handleJoinUrl).
 * A Universal/App Link opening the native app delivers the invite URL natively; native-bridge.js
 * forwards it to ICU.handleJoinUrl, which parses ?icujoin= (or /i/<code>), enables group mode, and
 * runs the confirm-then-join flow. This tests the parse + flag + no-throw (the full join needs
 * Firestore, exercised on-device).
 * USAGE: BASE=http://localhost:8970/ node test/run-icu-joinurl.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8970/").replace(/\/?$/, "/");
const PORT = 9381, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-joinurl-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8970"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.handleJoinUrl)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.removeItem("smd_icu_groups");}catch(e){} return 1;`);

  ok(await ev(`return ICU.handleJoinUrl("https://stewardmd.in/?icujoin=abc123.TOKENXYZ")===true;`) === true, "query invite URL (?icujoin=) is recognised → true");
  ok(await ev(`return localStorage.getItem("smd_icu_groups")==="1";`) === true, "handling an invite enables Group mode");
  ok(await ev(`return ICU.handleJoinUrl("https://stewardmd.in/i/def456.TOKENQRS")===true;`) === true, "path invite URL (/i/<code>) is recognised → true");
  ok(await ev(`return ICU.handleJoinUrl("https://stewardmd.in/")===false;`) === true, "a plain URL (no invite) → false");
  ok(await ev(`ICU.handleJoinUrl("https://stewardmd.in/?icujoin=x.y"); return "ok";`) === "ok", "handling an invite never throws (signed-out stash path)");

  console.log(fails === 0 ? "\nALL GREEN — ICU deep-link join hook test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
