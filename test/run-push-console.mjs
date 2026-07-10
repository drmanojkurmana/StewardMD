/* Admin Push Console test — the page served by functions/pushnotification.js.
 *
 * Renders the console HTML (imported from the Pages Function), stubs fetch + confirm, and proves:
 *   • Send with NO token → refuses, makes no request;
 *   • Send WITH token → POST /api/push/send, header X-Admin-Token=<token>, JSON body {title,body,url};
 *   • result shows native/web sent/total; "Check status" → GET /api/push/status;
 *   • the token persists to sessionStorage only when "remember" is ticked.
 * Deterministic (no network — fetch is stubbed).  USAGE: node test/run-push-console.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { _html } from "../functions/pushnotification.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp/pushconsole";
mkdirSync(DIR, { recursive: true });
writeFileSync(join(DIR, "pushconsole.html"), _html);

const PORT = 9412, DBG = 9413, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pushconsole-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = `http://localhost:${PORT}/`;
const serveProc = spawn("node", [join(HERE, "serve.mjs"), DIR, String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(150); } }
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "pushconsole.html" });
  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(200); if (await ev(`return !!document.getElementById("send")`) === true) { ready = true; break; } }
  if (!ready) throw new Error("console page not loaded");

  // Stub network + confirm so nothing leaves the page and dialogs don't block.
  const stub = `
    window.__calls = [];
    window.fetch = function(u, o){ window.__calls.push({ url:String(u), method:(o&&o.method)||"GET", token:(o&&o.headers&&(o.headers["X-Admin-Token"]||o.headers["x-admin-token"]))||null, body:(o&&o.body)||null });
      return Promise.resolve({ status:200, json:function(){ return Promise.resolve({ enabled:true, native:{sent:3,total:4}, web:{sent:1,total:2} }); } }); };
    window.confirm = function(){ return true; };
    return "ok";`;

  // 1) Send with NO token → refuses, no request.
  await ev(stub);
  const noTok = await J(`document.getElementById("tok").value=""; document.getElementById("send").click(); return JSON.stringify({ out: document.getElementById("out").textContent, calls: window.__calls.length });`);
  ok(/enter the admin token/i.test(noTok.out) && noTok.calls === 0, "Send with no token → refuses, makes no request");

  // 2) Send WITH token → POST /api/push/send, X-Admin-Token header, JSON body.
  await ev(stub);
  await ev(`document.getElementById("tok").value="SECRET123"; document.getElementById("title").value="Test title"; document.getElementById("bodytxt").value="Hello ICU"; document.getElementById("url").value="/x"; document.getElementById("send").click(); return "clicked";`);
  await sleep(150);
  const sent = await J(`var c=(window.__calls||[]).filter(function(x){return x.url.indexOf("/api/push/send")>=0;})[0]||null; var b=null; try{b=c&&JSON.parse(c.body);}catch(e){} return JSON.stringify({ call:c, body:b, out:document.getElementById("out").textContent });`);
  ok(sent.call && sent.call.method === "POST" && /\/api\/push\/send$/.test(sent.call.url), "Send → POST /api/push/send");
  ok(sent.call && sent.call.token === "SECRET123", "Send includes X-Admin-Token header from the pasted token");
  ok(sent.body && sent.body.title === "Test title" && sent.body.body === "Hello ICU" && sent.body.url === "/x", "Send body carries {title, body, url}");
  ok(/native.*3 \/ 4/i.test(sent.out) && /web.*1 \/ 2/i.test(sent.out), "result shows native + web sent/total: " + JSON.stringify(sent.out).slice(0, 70));

  // 3) Check status → GET /api/push/status (no token needed).
  await ev(stub);
  await ev(`document.getElementById("status").click(); return "c";`); await sleep(120);
  const st = await J(`var c=(window.__calls||[]).filter(function(x){return x.url.indexOf("/api/push/status")>=0;})[0]||null; return JSON.stringify({ call:c });`);
  ok(st.call && st.call.method === "GET", "Check status → GET /api/push/status");

  // 4) token persists to sessionStorage only when 'remember' is ticked.
  //    (Space the two sends: the button is disabled during a send and re-enabled async.)
  await ev(stub);
  await ev(`document.getElementById("tok").value="TKN"; document.getElementById("remember").checked=true; document.getElementById("send").click(); return "1";`);
  await sleep(150);
  const withRemember = await ev(`return sessionStorage.getItem("smd_push_console_token");`);
  await ev(`document.getElementById("remember").checked=false; document.getElementById("send").click(); return "2";`);
  await sleep(150);
  const without = await ev(`return sessionStorage.getItem("smd_push_console_token");`);
  ok(withRemember === "TKN" && without === null, "token saved to sessionStorage only when 'remember' is ticked, cleared when not — got " + JSON.stringify(withRemember) + " / " + JSON.stringify(without));

  console.log(fails === 0 ? "\nALL GREEN — Push Console test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
