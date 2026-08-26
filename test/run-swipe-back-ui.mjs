/* Left-edge swipe: menu at home, BACK everywhere else (real headless browser).
 *
 * The rule the app promises:
 *   - on home / the landing screen, a left-edge rightward swipe opens the main menu
 *   - on EVERY other screen it goes back one step (dismiss the dialog/sheet, or step back a page)
 *     and must NEVER open the menu
 *
 * swipe-back.js decided "am I at home?" by asking elementFromPoint() about ONE pixel, the centre of
 * the viewport. Any overlay that does not cover that pixel - a short bottom sheet, a small dialog,
 * a top-anchored panel - left home looking like the foreground, so the swipe opened the sidebar
 * instead of dismissing what was on top. And home's own sheet system (#hvSheet) ships no back
 * control, so the generic scan clicked a stray match on the home screen underneath and left the
 * sheet open.
 *
 * The touch listeners only arm on native/standalone, so this drives the exported decision -
 * SMD_SWIPE_BACK.edgeSwipeAction() - which is what those listeners call on release.
 *
 * USAGE: node test/run-swipe-back-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9395, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/swipe-back-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const DRAWER_OPEN = `var d=document.getElementById("sbDrawer"); return !!(d && d.classList.contains("open"));`;
const RESET_DRAWER = `var d=document.getElementById("sbDrawer"); if(d) d.classList.remove("open"); var b=document.getElementById("sbBackdrop"); if(b) b.classList.remove("open"); return 1;`;
const swipe = async () => { await ev(RESET_DRAWER); const r = await ev(`return SMD_SWIPE_BACK.edgeSwipeAction();`); await sleep(500); return r; };
const shown = (sel) => `var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var cs=getComputedStyle(e); if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity||"1")<0.05) return false; var r=e.getBoundingClientRect(); return r.width>4 && r.height>4 && r.top<innerHeight && r.bottom>0 && r.left<innerWidth && r.right>0;`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "?kardiox=1&kardioxbackend=0&mlab=0&clinix=1" });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SWIPE_BACK && window.SMD_showHome)`) === true) { ready = true; break; } }
  ok(ready, "app loads with the swipe controller and home available");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_showHome(); return 1;`); await sleep(900);

  // ── HOME: the one place the menu is allowed to open ──
  ok(await ev(`return SMD_SWIPE_BACK.canGoBack();`) === false, "at home there is nothing to go back to");
  await swipe();
  ok(await ev(DRAWER_OPEN) === true, "HOME: the swipe opens the main menu");

  // With the menu already open the swipe is a no-op (it closes by swiping left / backdrop / hardware back).
  const again = await ev(`return SMD_SWIPE_BACK.edgeSwipeAction();`);
  ok(again === true && await ev(DRAWER_OPEN) === true, "menu already open: a further right-swipe is a no-op");
  await ev(RESET_DRAWER);

  /* ── home's own bottom sheet: a SHORT overlay that does not cover the viewport centre. This is
   * the case the single-pixel test missed, and the sheet has no back control of its own. ── */
  await ev(`var b=document.querySelector('[data-act="more"]'); if(b) b.click(); return 1;`);
  await sleep(1100);
  ok(await ev(shown("#hvSheet")) === true, "the More sheet is open");
  await swipe();
  ok(await ev(DRAWER_OPEN) === false, "SHEET: the swipe does NOT open the menu");
  ok(await ev(shown("#hvSheet")) === false, "SHEET: the swipe dismisses the sheet (goes back)");

  // ── a full-screen module: must step back, never open the menu ──
  await ev(`SMD_showHome(); KARDIOX.open(); return 1;`); await sleep(900);
  await ev(`SMD_KARDIOX_ROUTER.nav("library"); return 1;`); await sleep(900);
  ok(await ev(shown("#kardioxRoot")) === true, "KardiQ is open on the library screen");
  await swipe();
  ok(await ev(DRAWER_OPEN) === false, "MODULE: the swipe does NOT open the menu");
  await ev(`try{KARDIOX.close();}catch(e){} return 1;`); await sleep(400);

  await ev(`SMD_showHome(); if(window.CLINIX&&CLINIX.open) CLINIX.open(); return 1;`); await sleep(1400);
  if (await ev(shown("#clinixRoot")) === true) {
    await swipe();
    ok(await ev(DRAWER_OPEN) === false, "CliniX: the swipe does NOT open the menu");
  } else { ok(true, "CliniX not reachable in this build (skipped)"); }
  await ev(`var r=document.getElementById("clinixRoot"); if(r) r.classList.remove("on"); return 1;`); await sleep(300);

  // ── a bottom sheet from a module (MaiK Ask): same rule ──
  await ev(`SMD_showHome(); return 1;`); await sleep(400);
  await ev(`if(window.SMD_askMaik) SMD_askMaik(""); return 1;`); await sleep(1400);
  await swipe();
  ok(await ev(DRAWER_OPEN) === false, "MaiK sheet: the swipe does NOT open the menu");

  // ── and back at home the menu still works (the fix must not disable the home gesture) ──
  await ev(`document.querySelectorAll('.maik-close,[data-act="close"]').forEach(function(b){try{b.click();}catch(e){}}); return 1;`);
  await sleep(500);
  await ev(`SMD_showHome(); return 1;`); await sleep(900);
  await swipe();
  ok(await ev(DRAWER_OPEN) === true, "back at HOME: the menu opens again");

  console.log(fails === 0 ? "\nALL GREEN — menu at home only; back everywhere else" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
