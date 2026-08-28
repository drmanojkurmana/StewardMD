/* Second WhatsApp bug batch (2026-08-23) — the "More" sheet, end to end in a real browser:
 *  - the 5 removed rows are actually gone from the rendered DOM, the kept rows still render.
 *  - .hv-sheet actually resolves to dark colors when body.dark is set (not just present in CSS
 *    source - getComputedStyle is the only way to know a rule actually WINS the cascade).
 * USAGE: node test/run-more-sheet.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8925/").replace(/\/?$/, "/");
const PORT = 9460, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/more-sheet-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8925"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  // This headless Chrome defaults to prefers-color-scheme: dark, which would otherwise contaminate
  // the "light" baseline below (the app has its own dark-mode CSS keyed off system preference too,
  // independent of the body.dark class) - force light explicitly so the two captured states are
  // deterministic and only the class toggle is under test.
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return document.body.classList.contains("ui-v2") && !!document.querySelector('[data-act="more"]');`) === true) { ready = true; break; } }
  ok(ready, "app boots (home.js loaded, a More entry point present)");

  await ev(`document.querySelector('[data-act="more"]').click(); return 1;`);
  await sleep(300);
  const rows = await J(`
    var s = document.getElementById("hvSheet");
    var labels = Array.prototype.map.call(s.querySelectorAll(".hv-mi .ml"), function(el){ return el.textContent.replace(/\\s+/g," ").trim(); });
    return JSON.stringify({ open: s.classList.contains("on"), labels: labels });
  `);
  ok(rows.open === true, "the More sheet actually opens");
  const joined = rows.labels.join(" | ");
  ok(!/New design/.test(joined), `the old-UI switch-back row is gone from the real DOM (${joined.slice(0, 200)})`);
  ok(!rows.labels.some((l) => l.startsWith("About StewardMD")), "About StewardMD row is gone");
  ok(!rows.labels.some((l) => l.startsWith("Acknowledgements")), "Acknowledgements row is gone");
  ok(!rows.labels.some((l) => l.startsWith("Guidelines")), "Guidelines & References row is gone");
  ok(!rows.labels.some((l) => l.startsWith("Calculators")), "Calculators row is gone");
  ok(rows.labels.some((l) => l.startsWith("Open shared case")), "Open shared case (not duplicated elsewhere) is still there");
  ok(rows.labels.some((l) => l.startsWith("Notification preferences")), "Notification preferences (not duplicated elsewhere) is still there");
  ok(rows.labels.some((l) => l.startsWith("Profile")), "Profile (not duplicated elsewhere) is still there");

  // Dark mode: .hv-sheet must actually resolve dark colors, not just have a rule sitting unused.
  const light = await J(`
    var s = document.getElementById("hvSheet");
    var cs = getComputedStyle(s);
    return JSON.stringify({ bg: cs.backgroundColor, color: cs.color });
  `);
  await ev(`document.body.classList.add("dark"); return 1;`);
  await sleep(100);
  const dark = await J(`
    var s = document.getElementById("hvSheet");
    var cs = getComputedStyle(s);
    return JSON.stringify({ bg: cs.backgroundColor, color: cs.color });
  `);
  ok(dark.bg !== light.bg, `body.dark actually changes the sheet's resolved background (light: ${light.bg}, dark: ${dark.bg})`);
  ok(dark.bg === "rgb(17, 27, 46)", `resolves to the intended dark panel color #111B2E (got ${dark.bg})`);

  console.log(fails === 0 ? "\nALL GREEN — More sheet cleanup + dark-mode theming verified end to end" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
