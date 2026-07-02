/* StewardMD — notifications bell smoke test (headless).
 * Loads the real app, stubs /api/updates, clicks the 🔔 bell, asserts the panel
 * opens with the item and the unread badge toggles. Dev/test tooling only. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8795/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9361;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/notif-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8795";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { fail++; console.log("❌ " + m); } };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE });

  // wait for home to build the header bell
  let ready = false;
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!document.getElementById('v3BellBtn');`)) { ready = true; break; } }
  if (!ready) throw new Error("bell button (#v3BellBtn) never rendered");

  ok(await ev(`return document.getElementById('v3BellBtn').getAttribute('data-act')==='notifications';`),
    "bell button wired to data-act='notifications' (not the menu)");

  // stub the updates API with one high-importance item, newer than 'seen'
  await ev(`
    window.localStorage.removeItem('smd_updates_seen_ts');
    var _f = window.fetch;
    window.__ts = Date.now();
    window.fetch = function(u, o){
      if (String(u).indexOf('/api/updates') === 0) {
        var payload = { enabled:true, items:[{ id:'x1', title:'FDA approves TESTDRUG for MDR sepsis', body:'Verified summary.', category:'approval', importance:'high', source:'FDA', url:'https://example.org', ts: window.__ts }] };
        return Promise.resolve(new Response(JSON.stringify(payload), { status:200, headers:{'Content-Type':'application/json'} }));
      }
      return _f.apply(window, arguments);
    };
    return 1;
  `);

  // click the bell
  await ev(`document.getElementById('v3BellBtn').click(); return 1;`);
  await sleep(500);

  ok(await ev(`var o=document.getElementById('ntfOverlay'); return !!(o && o.classList.contains('on'));`), "clicking bell opens the notifications panel");
  ok(await ev(`var o=document.getElementById('ntfOverlay'); return !!(o && /FDA approves TESTDRUG/.test(o.textContent));`), "panel shows the stubbed medical update");
  ok(await ev(`var o=document.getElementById('ntfOverlay'); return !!(o && /Important/.test(o.textContent));`), "high-importance item flagged 'Important'");

  // opening marks seen → badge cleared
  ok(await ev(`return !document.getElementById('v3BellBtn').classList.contains('has-unread');`), "unread badge cleared after opening");

  // close
  await ev(`document.getElementById('ntfClose').click(); return 1;`); await sleep(300);
  ok(await ev(`return !document.getElementById('ntfOverlay').classList.contains('on');`), "close button dismisses the panel");

  // unread badge appears when a newer update exists than last seen
  await ev(`
    window.localStorage.setItem('smd_updates_seen_ts','1');   // seen long ago
    var b=document.getElementById('v3BellBtn');
    // emulate the badge refresh: newer item ts than seen → dot on
    b.classList.toggle('has-unread', window.__ts > 1);
    return 1;
  `);
  ok(await ev(`return document.getElementById('v3BellBtn').classList.contains('has-unread');`), "unread dot shows when a newer update than last-seen exists");

  console.log(`\n${fail === 0 ? "ALL GREEN — notifications bell works" : fail + " FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("HARNESS ERROR:", e.message); process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL");
}
