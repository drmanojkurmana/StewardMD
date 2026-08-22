/* Home "Customize tools" sheet — swipe-down-to-close (WhatsApp bug report, 2026-08-22).
 * BUG-19's drag-to-dismiss only engaged when the sheet's OWN scrollTop was 0, and that gate applied
 * to the dedicated "-" grab handle (touch-action:none) too - so once the 10+ row toggle list was
 * scrolled down even slightly (exactly what the report's screenshot shows), dragging the handle
 * stopped closing the sheet. The handle must always start a drag; a touch elsewhere in the
 * scrollable body still needs the scrollTop==0 guard so it doesn't fight inner scrolling.
 * USAGE: node test/run-home-sheet-drag-handle.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8917/").replace(/\/?$/, "/");
const PORT = 9447, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/home-draghandle-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8917"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// Simulates dragging DOWN from `sel` by `dy` px, entirely inside the page (real Touch objects
// bubbling touchmove/touchend to the sheet, matching how the app's own listeners are bound).
const dragDown = (sel, dy, forcedScrollTop) => J(`
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return JSON.stringify({ err: "no element for " + ${JSON.stringify(sel)} });
  var sh = document.getElementById("hvSheet");
  if (${forcedScrollTop !== undefined} && sh) Object.defineProperty(sh, "scrollTop", { configurable: true, get: function () { return ${forcedScrollTop || 0}; } });
  var t0 = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
  el.dispatchEvent(new TouchEvent("touchstart", { touches: [t0], targetTouches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
  var t1 = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 + ${dy} });
  el.dispatchEvent(new TouchEvent("touchmove", { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
  el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t1], bubbles: true, cancelable: true }));
  return JSON.stringify({ ok: true });
`);
const sheetOn = () => ev(`var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on"));`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SB;`) === true) { ready = true; break; } }
  ok(ready, "app boots (home.js loaded, window.SB present)");

  // Open the sheet via the real "Add Tool" tile — same path a user taps.
  const opened = await J(`
    var b = document.querySelector('[data-act="customizetools"]');
    if (!b) return JSON.stringify({ err: "no Add Tool tile" });
    b.click();
    return JSON.stringify({ ok: true });
  `);
  await sleep(400);
  ok(opened.ok === true, "the 'Add Tool' tile opens the Customize tools sheet");
  ok(await sheetOn() === true, "sheet is open (#hvSheet.on)");

  // Case 1 (THE BUG): sheet scrolled down, drag from the DEDICATED grab handle → must still close.
  await dragDown(".hv-grab", 150, 40);
  await sleep(50);
  ok(await sheetOn() === false, "scrolled down + drag from the grab handle closes the sheet (was broken: handle was gated behind scrollTop==0)");

  // Reopen, re-verify still open before the next case.
  await ev(`document.querySelector('[data-act="customizetools"]').click();`); await sleep(400);
  ok(await sheetOn() === true, "sheet reopens for the next case");

  // Case 2 (regression guard): sheet scrolled down, drag from the CONTENT area (a toggle row) →
  // must NOT close — the "don't fight inner scrolling" protection must still hold there.
  await dragDown(".hv-tool-tog", 150, 40);
  await sleep(50);
  ok(await sheetOn() === true, "scrolled down + drag from the content area does NOT close (still protects inner scrolling)");

  // Case 3 (regression guard): sheet at the TOP (scrollTop 0), drag from the content area → still closes,
  // exactly like before this fix.
  await dragDown(".hv-tool-tog", 150, 0);
  await sleep(50);
  ok(await sheetOn() === false, "at scrollTop 0, drag from the content area still closes (unchanged behaviour)");

  console.log(fails === 0 ? "\nALL GREEN — Customize tools swipe-to-close fixed for the grab handle" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
