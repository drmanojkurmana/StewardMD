/* BUG-MU2PKIS3-4WMU: the Ward round's ward selector (select#wRosterWardFilter) closed the moment it was
 * opened. Two causes, both in ward.js: the delegated click handler dispatched the select's data-w-act on
 * the click that OPENS it (re-rendering the roster and swapping the select), and any paint() that landed
 * while the list was open (the ward's loads arrive one after another) replaced it too.
 *
 * Real headless Chrome, real ward.js and ward.css, a real mouse press on the select. Proves: the press
 * does not replace the select; a repaint while it is open keeps the SAME element and value; choosing a
 * ward applies the filter; and once closed, repaints run again (nothing is held forever).
 *
 *   node test/run-ward-roster-select-open.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-roster-select-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-maik-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR " + x}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const waitFor = async (e) => { for (let i = 0; i < 50; i++) { if (await ev(e)) return true; await sleep(100); } return false; };
const press = async (x, y) => {
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready === true;`), "real ward.js loaded");
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.getElementById("wRosterWardFilter");`), "the Ward round roster shows select#wRosterWardFilter");
  await sleep(600); // let the ward's follow-up loads land

  // 1. A real mouse press on the select (the press that opens its list).
  const box = JSON.parse(await ev(`var s = document.getElementById("wRosterWardFilter"); s.scrollIntoView({ block: "center" }); window.__sel = s;
    var r = s.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });`));
  await press(box.x, box.y);
  await sleep(150);
  ok(await ev(`return document.getElementById("wRosterWardFilter") === window.__sel;`), "the press that opens the select does not replace it");

  // 2. A repaint lands while the list is open: same element, same value.
  await ev(`window.__val = window.__sel.value; window.WARD._dispatch("dismiss"); return true;`);
  await sleep(100);
  ok(await ev(`var s = document.getElementById("wRosterWardFilter"); return s === window.__sel && s.value === window.__val;`),
    "a repaint while the select is open keeps the SAME element and value");

  // 3. Choosing a ward applies the filter.
  await ev(`window.__sel.value = "Ward A"; window.__sel.dispatchEvent(new Event("change", { bubbles: true })); return true;`);
  ok(await waitFor(`return window.WARD._st.rosterFilters && window.WARD._st.rosterFilters.ward === "Ward A" && document.getElementById("wRosterWardFilter").value === "Ward A";`),
    "choosing a ward applies the filter and the select shows it");

  // 4. Closed again, a repaint really repaints (nothing is held for ever), and the choice survives it.
  await ev(`window.__sel2 = document.getElementById("wRosterWardFilter"); return true;`);
  await press(5, 5); // a press elsewhere
  await ev(`window.WARD._dispatch("dismiss"); return true;`);
  ok(await waitFor(`var s = document.getElementById("wRosterWardFilter"); return !!s && s !== window.__sel2 && s.value === "Ward A";`),
    "after the select closes a repaint runs, and the chosen ward is still selected");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
