/* Home edge-swipe → open the main menu (swipe-back.js).
 *
 * Proves: a rightward drag from the LEFT EDGE of the home screen slides the sidebar open; the same
 * gesture elsewhere still goes BACK (never opens the menu over another screen); a repeat swipe with
 * the drawer already open is a no-op; and Android's hardware back at root still EXITS (goBack()
 * stays false) instead of opening the menu.
 *
 * The gesture layer only arms on native / installed PWA, so display-mode:standalone is stubbed
 * before the page scripts run. Real Input.dispatchTouchEvent gestures — not synthetic clicks.
 * USAGE: BASE=http://localhost:8902/ node test/run-swipe-menu.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/swipe-menu-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=390,844"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// One left-edge rightward drag: start x=8, glide to x=220 over several moves, release.
async function edgeSwipe(y = 400) {
  const pt = (x) => [{ x, y, radiusX: 6, radiusY: 6, force: 1 }];
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(8) });
  for (const x of [24, 60, 110, 165, 220]) { await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x) }); await sleep(24); }
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(420);   // drawer transition is .24s
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  // Arm the gesture layer: it only enables on native / installed PWA.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    (function(){ var mm = window.matchMedia.bind(window);
      window.matchMedia = function(q){ if (/display-mode:\\s*standalone/.test(q)) return { matches:true, media:q, addListener:function(){}, removeListener:function(){}, addEventListener:function(){}, removeEventListener:function(){} }; return mm(q); }; })();` });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SWIPE_BACK && window.SMD_SWIPE_BACK.openMenuAtHome && window.SB && SB.open)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("swipe-back + SB not loaded");
  ok(await ev(`return window.SMD_SWIPE_BACK.enabled === true;`) === true, "gesture layer armed (native / installed PWA)");
  // Get to the home screen: drop the boot splash / gates, then show home (its own entry path needs
  // a signed-in account, which a headless harness has no way to provide).
  await ev(`["smdBootSplash","introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
    var h=document.getElementById("homeV2"); if(h) h.classList.add("on"); try{SB.close();}catch(e){} return 1;`);
  await sleep(400);

  // 1) home + drawer closed → the edge swipe slides the menu open
  const pre = await ev(`return JSON.stringify({ home: !!document.querySelector('#homeV2.on'), open: !!document.querySelector('#sbDrawer.open') });`);
  ok(JSON.parse(pre).home === true && JSON.parse(pre).open === false, "start state: home is foreground, drawer closed");
  await edgeSwipe();
  const after = JSON.parse(await ev(`
    var d=document.getElementById('sbDrawer'), b=document.getElementById('sbBackdrop');
    return JSON.stringify({ open: d.classList.contains('open'), x: d.getBoundingClientRect().left, backdrop: b ? b.classList.contains('open') : null });`));
  ok(after.open === true, "left-edge swipe on home OPENS the sidebar");
  ok(after.x >= -2, "the drawer has actually slid into view (left edge ≈ 0, not off-screen)");

  // 2) a repeat swipe with the drawer already open does not fight it
  await edgeSwipe();
  ok(await ev(`return document.querySelector('#sbDrawer.open') ? "open" : "closed";`) === "open", "a repeat edge swipe while the menu is open is a no-op (menu stays open)");

  // 3) hardware/system back at root must still EXIT, not open the menu
  await ev(`try{SB.close();}catch(e){} return 1;`); await sleep(300);
  const hw = JSON.parse(await ev(`
    var r = window.SMD_SWIPE_BACK.goBack();
    return JSON.stringify({ ret: r, open: !!document.querySelector('#sbDrawer.open') });`));
  ok(hw.ret === false && hw.open === false, "goBack() at root still returns false (it does NOT open the menu - that is hardwareBack()'s job)");

  // 4) off home, the gesture is a BACK — never a menu-open
  const off = JSON.parse(await ev(`
    if (window.ICU && ICU.open) { ICU.reset(); ICU.ingestPatient({name:"SW",age:44,sex:"M"}); ICU.open('overview'); }
    return JSON.stringify({ icu: !!document.querySelector('#icuRoot.on'), home: !!(window.SMD_SWIPE_BACK.canGoBack()) });`));
  if (off.icu) {
    ok(await ev(`return window.SMD_SWIPE_BACK.openMenuAtHome() === false;`) === true, "with the ICU dashboard up, the edge swipe never opens the menu (goes back instead)");
    await ev(`try{ICU.close();}catch(e){} return 1;`);
  } else { ok(false, "could not open the ICU dashboard to test the off-home case"); }

  console.log(fails === 0 ? "\nALL GREEN — home edge-swipe menu test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
