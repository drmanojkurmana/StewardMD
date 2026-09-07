/* The Subscription tap after a mid-session verification — real-browser test.
 *
 * paywall-resync.test.mjs proves the decision logic in a sandbox. This proves it on a real page
 * with the real pro-notice.js and pro-paywall.js: a doctor whose cached verdict still says
 * "unverified" but whose server verdict is Pro must get the PAYWALL, not the verify explainer, and
 * a still-unverified doctor must get the explainer exactly once with no loop.
 *
 * USAGE: BASE=http://localhost:8993/ CHROME=<chrome binary> node test/run-paywall-resync-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PAGE = BASE + "test/fixtures/paywall-resync.html";
const PORT = 9397;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/paywall-resync-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

const notice = () => ev(`var n=document.getElementById("smdProNotice"); return n ? n.innerText : null;`);
const paywall = () => ev(`return !!document.getElementById("proPay");`);
const reset = () => ev(`try{SMD_PRO_NOTICE.close();}catch(e){} var p=document.getElementById("proPay"); if(p){ var c=p.querySelector('[data-pp="close"]'); if(c) c.click(); } window.__syncs=0; window.__opened=null; return 1;`);

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: PAGE });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`return !!(window.SMD_PRO_NOTICE && window.SMD_PRO && typeof SMD_PRO.openPaywall === "function")`) === true) { ready = true; break; } }
  ok(ready, "pro-notice.js + pro-paywall.js loaded and attached on a real page");
  if (!ready) throw new Error("modules never loaded");

  // ── THE REPORTED CASE: verified this session, cache still says unverified ──
  await reset();
  await ev(`window.__pro=false; window.__state={pro:false, reason:"unverified", verified:false};
            window.__server={pro:true, source:"verified-free-week", verified:true, trial:true}; return 1;`);
  await ev(`SMD_PRO.openPaywall("menu"); return 1;`);
  await sleep(400);
  ok(await ev(`return window.__syncs`) === 1, "one fresh /billing/status round trip before deciding");
  ok(await notice() === null, "the verify explainer does NOT appear for a doctor the server says is Pro");
  ok(await paywall() === true, "the real paywall opens instead");

  // ── still unverified after the fresh check: the explainer, exactly once, no loop ──
  await reset();
  await ev(`window.__pro=false; window.__state={pro:false, reason:"unverified", verified:false};
            window.__server={pro:false, reason:"unverified", verified:false}; return 1;`);
  await ev(`SMD_PRO.openPaywall("menu"); return 1;`);
  await sleep(400);
  const t = String(await notice());
  ok(/verified registration/i.test(t), `an unverified doctor is still sent to verification (got: ${JSON.stringify(t.slice(0, 60))})`);
  ok(await paywall() === false, "and is shown no price");
  ok(await ev(`return window.__syncs`) === 1, "re-synced exactly once: no loop between paywall and explainer");
  await ev(`document.querySelector("#smdProNotice .pn-go").click(); return 1;`);
  ok(await ev(`return window.__opened`) === "verify", "the explainer's button reaches verification");

  // ── cache already Pro: straight to the paywall, no round trip ──
  await reset();
  await ev(`window.__pro=true; window.__state={pro:true, verified:true}; return 1;`);
  await ev(`SMD_PRO.openPaywall("menu"); return 1;`);
  await sleep(300);
  ok(await ev(`return window.__syncs`) === 0, "a known-Pro account is not re-checked");
  ok(await paywall() === true && await notice() === null, "paywall opens directly");

  console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN — the Subscription tap decides on a fresh verdict");
  process.exitCode = fails ? 1 : 0;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
