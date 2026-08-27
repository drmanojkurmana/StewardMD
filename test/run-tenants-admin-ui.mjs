/* Admin console — "Medical colleges" pane, real-browser smoke test.
 *
 * The whole admin script is ONE IIFE (see the gotcha in vault/modules/OTA Updates.md): nothing it
 * declares reaches `window`, so a syntax error in an added handler is INVISIBLE from the outside —
 * the page still renders, the markup is all there, and every button is simply dead. That is the
 * failure this catches: it fails the run on any uncaught exception during load, and then checks the
 * pane's controls really exist.
 *
 * It deliberately does NOT fake a Firebase sign-in (that needs the network-blocking dance the OTA
 * admin test does). Panes are only revealed when signed in, but their DOM exists regardless, and the
 * server route has its own suite in test/tenant-provision.test.mjs.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-tenants-admin-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PAGE = BASE + "admin/index.html";
const PORT = 9403;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tenants-admin-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8991"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); const errors = []; let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const has = (sel) => ev(`return !!document.querySelector(${JSON.stringify(sel)})`);

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        if (m.method === "Runtime.exceptionThrown") {
          const d = m.params && m.params.exceptionDetails;
          errors.push((d && (d.exception && d.exception.description || d.text)) || "unknown");
        }
      };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: PAGE });
  for (let i = 0; i < 40; i++) { await sleep(300); if (await ev(`return document.readyState`) === "complete") break; }
  await sleep(800);

  // THE load-bearing check: one IIFE, so a syntax error kills every handler silently.
  const real = errors.filter((e) => !/net::|Failed to (load|fetch)|ERR_/i.test(e));
  ok(real.length === 0, real.length ? `uncaught exception on load: ${real[0].slice(0, 160)}` : "admin script loaded with no uncaught exceptions");

  ok(await has("#pane-tenants") === true, "the Medical colleges pane exists");
  ok(await has('[data-p="tenants"]') === true, "it has a nav entry");
  for (const id of ["#tnName", "#tnEmail", "#tnPwd", "#tnCreateBtn", "#tnList", "#tnBox", "#tnMsg"]) {
    ok(await has(id) === true, `control present: ${id}`);
  }
  ok(await ev(`return document.querySelector("#tnBox").style.display === "none"`) === true,
     "the credential box starts hidden — a password is only ever shown after one is issued");

  // The console tells the operator the thing that would otherwise be discovered the hard way.
  const paneText = String(await ev(`return document.querySelector("#pane-tenants").innerText`));
  ok(/signed in to StewardMD at least once/i.test(paneText),
     "explains that the admin must already have an account");
  ok(/Google/.test(paneText) && /eLOGBook/i.test(paneText),
     "states that Google sign-in is what reaches the logbook console");
  ok(/OPD|queue/i.test(paneText), "states that the generated password is for the OPD/queue surfaces only");
  ok(/owner/i.test(paneText), "states that the admin becomes the owner of their college");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
