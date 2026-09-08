/* home.js: the "Inpatient Ward" v4 tile (flag smd_wardsynq, data-act="wardsynq"), driven in real
 * headless Chrome over CDP.
 *
 * Proves: (1) with the flag on, the tile renders from the REAL homeV4Markup()/tileV4() path; (2)
 * clicking it goes through home.js's REAL delegated `root.addEventListener("click", ...)` handler,
 * which reads data-act and calls ACT.wardsynq() -> WARD.open() (stubbed here, unmodified home.js
 * code decides to call it); (3) with the flag off, the tile is absent - proving the flag actually
 * gates the tile, not just that the tile can render.
 *
 *   node test/run-home-wardsynq-tile.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/home-wardsynq-tile-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const urlFor = (q) => "file://" + join(HERE, "home-wardsynq-tile-harness.html") + (q ? "?" + q : "");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function attachFreshTarget() {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ---- 1. Flag ON: real home.js boots, the real tile renders, the real click reaches WARD.open() ----
  await attachFreshTarget();
  await call("Page.navigate", { url: urlFor("") });

  let ready = null;
  for (let i = 0; i < 80; i++) { await sleep(150); ready = await ev(`return window.__ready && window.__ready();`); if (ready === true) break; }
  ok(ready === true, `real home.js booted (#homeV2 built) with the flag on (${ready})`);

  let tilePresent = null;
  for (let i = 0; i < 40; i++) { await sleep(150); tilePresent = await ev(`return !!document.querySelector('[data-act="wardsynq"]');`); if (tilePresent) break; }
  ok(tilePresent === true, 'the "Inpatient Ward" tile rendered from the real homeV4Markup()/tileV4() path');
  ok(await ev(`return document.querySelector('[data-act="wardsynq"]').textContent.indexOf("Inpatient Ward") >= 0;`), 'the tile shows the "Inpatient Ward" label');
  ok(await ev(`return window.__wardOpened === undefined;`), "WARD.open() has not fired yet");

  await ev(`document.querySelector('[data-act="wardsynq"]').click(); return true;`);
  let opened = null;
  for (let i = 0; i < 30; i++) { await sleep(100); opened = await ev(`return window.__wardOpened;`); if (opened !== undefined && opened !== null) break; }
  ok(opened !== undefined && opened !== null, "clicking the tile reached the real delegated handler -> ACT.wardsynq() -> WARD.open() (window.__wardOpened=" + JSON.stringify(opened) + ")");

  // ---- 2. Flag OFF: same real home.js, tile must be absent ----
  await attachFreshTarget();
  await call("Page.navigate", { url: urlFor("off=1") });

  ready = null;
  for (let i = 0; i < 80; i++) { await sleep(150); ready = await ev(`return window.__ready && window.__ready();`); if (ready === true) break; }
  ok(ready === true, "real home.js also booted with the flag off");
  await sleep(500); // give the (flag-gated, absent) tile every chance to appear if the gate were broken
  ok(await ev(`return !document.querySelector('[data-act="wardsynq"]');`), "the tile is ABSENT with smd_wardsynq unset - the flag actually gates it");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
