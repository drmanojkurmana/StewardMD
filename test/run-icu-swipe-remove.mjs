/* ICU/Ward board: WhatsApp-style swipe-to-remove on a patient card.
 *
 * Asserts the whole gesture chain in a real browser: swipe the card left → the red Remove action is
 * revealed → tapping it opens the chooser (Discharge · Clear patient · Cancel) → "Clear patient"
 * removes the patient from the board. A vertical drag must NOT open the row (the board still scrolls).
 * Removing a patient is irreversible, so the "chooser appears before anything is deleted" assertion
 * is the safety-critical one here. Deterministic, synthetic patient, no PHI.
 * USAGE: node test/run-icu-swipe-remove.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9431, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-swipe-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// Touch-gesture helper injected into the page: drag `el` from (x,y) by (dx,dy) in 6 steps.
const SWIPE_FN = `
  window.__swipe = function (el, dx, dy) {
    var r = el.getBoundingClientRect(), x = r.left + r.width - 20, y = r.top + r.height / 2;
    var mk = function (t, cx, cy) {
      var to = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
      el.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true, touches: t === "touchend" ? [] : [to], changedTouches: [to] }));
    };
    mk("touchstart", x, y);
    for (var i = 1; i <= 6; i++) mk("touchmove", x + dx * i / 6, y + dy * i / 6);
    mk("touchend", x + dx, y + dy);
  };`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.ingestFromWard)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(SWIPE_FN + " return 1;");

  // Seed one synthetic patient and land on the unit board.
  const setup = await J(`
    try { localStorage.setItem("smd_icu_groups", "0"); } catch (e) {}   // solo board (group mode needs a live unit)
    ICU.reset();
    ICU.ingestFromWard({ patient:{ name:"Test-Swipe", age:70, sex:"F", bed:"7" }, patientId:"WARD-S1", source:"Ward Sync" });
    ICU.open();
    var cards = document.querySelectorAll("#icuRoot .icu-v2-swipe > .icu-v2-card");
    return JSON.stringify({ cards: cards.length, acts: document.querySelectorAll("#icuRoot .icu-v2-swipe-act").length, name: (ICU.state().patient||{}).name });
  `);
  ok(setup.cards === 1 && setup.acts === 1, `board shows 1 swipeable card with a hidden Remove action (${JSON.stringify(setup)})`);

  // A vertical drag must not open the row (the board must still scroll).
  const vert = await J(`
    var c = document.querySelector("#icuRoot .icu-v2-swipe > .icu-v2-card");
    window.__swipe(c, -6, -120);
    return JSON.stringify({ tf: c.style.transform || "" });
  `);
  ok(!vert.tf, `vertical drag does NOT open the row (transform="${vert.tf}")`);

  // Horizontal swipe left → the row opens and stays open.
  const swiped = await J(`
    var c = document.querySelector("#icuRoot .icu-v2-swipe > .icu-v2-card");
    window.__swipe(c, -140, 0);
    return JSON.stringify({ tf: c.style.transform || "", modal: !!document.querySelector("#icuModal.on") });
  `);
  ok(/translateX\(-10[0-9]px\)/.test(swiped.tf), `swipe left reveals the Remove action (transform="${swiped.tf}")`);
  ok(swiped.modal === false, `the swipe alone deletes nothing and opens no dialog`);

  await sleep(450);   // let the post-swipe click guard expire, as a real thumb would

  // Tap the revealed action → the chooser must offer Discharge / Clear / Cancel, and still delete nothing.
  const sheet = await J(`
    document.querySelector("#icuRoot .icu-v2-swipe-act").click();
    var m = document.querySelector("#icuModal");
    var b = m ? [].map.call(m.querySelectorAll("[data-icu-act]"), function (x) { return x.getAttribute("data-icu-act").split(":")[0]; }) : [];
    return JSON.stringify({ on: !!(m && m.classList.contains("on")), acts: b, txt: m ? m.textContent.slice(0, 200) : "", stillThere: !!(ICU.state().patient||{}).name });
  `);
  ok(sheet.on === true, `tapping Remove opens the confirmation chooser`);
  ok(sheet.acts.indexOf("ptswdis") > -1 && sheet.acts.indexOf("ptswrm") > -1 && sheet.acts.indexOf("closeform") > -1,
    `chooser offers Discharge + Clear patient + Cancel (${JSON.stringify(sheet.acts)})`);
  ok(sheet.stillThere === true, `nothing is removed until the user chooses`);

  // Cancel leaves the patient alone.
  const cancelled = await J(`
    document.querySelector('#icuModal [data-icu-act="closeform"]').click();
    return JSON.stringify({ on: !!document.querySelector("#icuModal.on"), name: (ICU.state().patient||{}).name || "", cards: document.querySelectorAll("#icuRoot .icu-v2-card").length });
  `);
  ok(cancelled.on === false && cancelled.name === "Test-Swipe" && cancelled.cards === 1, `Cancel closes the sheet and keeps the patient (${JSON.stringify(cancelled)})`);

  // Swipe again → Clear patient → the patient is gone from the board and the live buffer.
  const cleared = await J(`
    var c = document.querySelector("#icuRoot .icu-v2-swipe > .icu-v2-card");
    window.__swipe(c, -140, 0);
    document.querySelector("#icuRoot .icu-v2-swipe-act").click();
    document.querySelector('#icuModal [data-icu-act^="ptswrm"]').click();
    return JSON.stringify({ name: (ICU.state().patient||{}).name || "", cards: document.querySelectorAll("#icuRoot .icu-v2-card").length, empty: !!document.querySelector("#icuRoot .icu-v2-empty") });
  `);
  ok(cleared.name === "" && cleared.cards === 0 && cleared.empty === true, `"Clear patient" removes the patient from the board (${JSON.stringify(cleared)})`);

  console.log(fails === 0 ? "\nALL GREEN — ICU board swipe-to-remove test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
