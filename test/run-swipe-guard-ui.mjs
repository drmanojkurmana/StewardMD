/* Left-edge swipe rules (owner 2026-11-19): "swipe left to right should bring the sidebar only on the homepage, nowhere
 * else; it was coming up behind PrepNucleus and locking its scroll. Everywhere else it goes back. The user can turn it
 * off in preferences. Accidental swipes must not count."
 * Real app in headless Chromium posing as the native app (touch events over CDP), PrepNucleus on the lesson fixtures.
 * USAGE: node test/run-swipe-guard-ui.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = await freePort(), BASE = `http://localhost:${PORT}/`;
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.addInitScript(`window.Capacitor={isNativePlatform:function(){return true},getPlatform:function(){return "ios"},Plugins:{}}; window.SMD_PREP_SETUP=false; window.SMD_PREP_ONBOARD=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API="/test/fixtures/prep-lessons/api/"; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json";`);
  await p.goto(BASE + "?prep=1");
  await p.waitForFunction(() => !!(window.SMD_SWIPE_BACK && window.PREP && window.SB), null, { timeout: 60000 });
  await p.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); localStorage.setItem("smd_prep", "1"); localStorage.removeItem("smd_swipe_back"); });
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (x0, x1, y0 = 420, y1 = y0, steps = 8) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(900);
  };
  const st = () => p.evaluate(() => ({ drawer: !!(document.getElementById("sbDrawer") || {}).classList?.contains("open"), prep: !!(PREP.isOpen && PREP.isOpen()), stack: (PREP._st && PREP._st.stack.length) || 0 }));
  const closeDrawer = () => p.evaluate(() => { try { SB.close(); } catch (e) {} });
  const jc = async (sel) => { await p.waitForSelector(sel, { state: "attached", timeout: 10000 }); await p.evaluate((s) => document.querySelector(s).click(), sel); await sleep(800); };

  // inside PrepNucleus: back, never the menu, even if the home test is fooled
  await p.evaluate(() => PREP.open({ subject: "surgery" })); await sleep(1500);
  await jc("#smdPrep .pn-mod[data-m=sur-breast-cancer]");
  const s0 = await st();
  ok(await p.evaluate(() => SMD_SWIPE_BACK.moduleOpen() && SMD_SWIPE_BACK.openMenuAtHome() === false && !document.getElementById("sbDrawer").classList.contains("open")),
    "with PrepNucleus open the menu can never open (moduleOpen guard)");
  await swipe(8, 260); const s1 = await st();
  ok(s1.prep && s1.stack === s0.stack - 1 && !s1.drawer, "a swipe in PrepNucleus goes back one screen, no menu: " + JSON.stringify([s0.stack, s1.stack]));
  // accidental swipes
  await swipe(8, 34, 420, 420, 2); let s2 = await st();
  ok(s2.stack === s1.stack && !s2.drawer, "a short brush at the edge does nothing");
  await swipe(8, 120, 300, 520, 8); s2 = await st();
  ok(s2.stack === s1.stack && !s2.drawer, "a diagonal drag (mostly a scroll) does nothing");
  await swipe(120, 380); s2 = await st();
  ok(s2.stack === s1.stack && !s2.drawer, "a drag that starts away from the edge does nothing");
  // the swipe that closes PrepNucleus lands on home: it must not also open the menu
  while ((await st()).prep) await swipe(8, 260);
  ok(!(await st()).drawer, "the swipe that leaves PrepNucleus does not open the menu behind it");
  await sleep(1000);
  await swipe(8, 260);
  ok((await st()).drawer, "on the home screen the swipe opens the menu");
  await closeDrawer(); await sleep(1200);
  // owner 2026-11-20 recording: a small floating layer over home (a chip at the centre, a full-width bar) made the old home
  // test say "not home", so the swipe dragged the home screen off over a blank white page and no menu opened.
  await p.evaluate(() => {
    const mk = (css) => { const d = document.createElement("div"); d.className = "sg-float"; d.style.cssText = "position:fixed;z-index:99999;background:#0a7;" + css; document.body.appendChild(d); };
    mk("left:calc(50% - 90px);top:calc(50% - 45px);width:180px;height:90px;"); mk("left:0;right:0;bottom:0;height:110px;");
  });
  const moved = [];
  const watch = await p.evaluate(() => { window.__homeMoved = 0; const h = document.getElementById("homeV2"); new MutationObserver(() => { if (/translateX\(\s*[1-9]/.test(h.style.transform || "")) window.__homeMoved++; }).observe(h, { attributes: true, attributeFilter: ["style"] }); return 1; });
  await swipe(8, 260);
  const fl = await p.evaluate(() => ({ drawer: document.getElementById("sbDrawer").classList.contains("open"), moved: window.__homeMoved, handle: (document.getElementById("smdTopBack") || { style: {} }).style.visibility }));
  ok(fl.drawer && fl.moved === 0, "with small layers floating over home the swipe still opens the menu and never slides home away: " + JSON.stringify(fl));
  await p.evaluate(() => document.querySelectorAll(".sg-float").forEach((e) => e.remove()));
  await closeDrawer(); await sleep(600);
  // Preferences switch
  await p.evaluate(() => localStorage.setItem("smd_swipe_back", "0"));
  await swipe(8, 260);
  ok(!(await st()).drawer, "switched off in Preferences: the swipe does nothing on home");
  await p.evaluate(() => PREP.open({ subject: "surgery" })); await sleep(1500);
  await jc("#smdPrep .pn-mod[data-m=sur-breast-cancer]");
  const o0 = await st(); await swipe(8, 260); const o1 = await st();
  ok(o1.stack === o0.stack && !o1.drawer, "switched off: no back-swipe inside modules either");
  await p.evaluate(() => { localStorage.removeItem("smd_swipe_back"); PREP.close && PREP.close(); });
  await sleep(400);
  /* Owner recording 2026-11-20: Settings opened from the sidebar, a left-edge swipe slid it off, found no Back button
     (off-screen by then), opened the menu instead, and Settings slid back over it with the menu's scroll lock. */
  const openFromMenu = async (label) => {
    await p.evaluate(() => { try { SB.open(); } catch (e) {} }); await sleep(700);
    const hit = await p.evaluate((l) => { const r = [...document.querySelectorAll("#sbDrawer .sbr-row")].find((e) => e.textContent.trim() === l); if (!r) return false; r.click(); return true; }, label);
    await sleep(1200); return hit;
  };
  ok(await openFromMenu("Settings") && await p.evaluate(() => !!document.getElementById("sbrSettings") && !document.getElementById("sbDrawer").classList.contains("open")), "Settings opened from the menu (the menu closes)");
  await swipe(8, 300);
  ok(await p.evaluate(() => !document.getElementById("sbrSettings") && !document.getElementById("sbDrawer").classList.contains("open") && !document.body.classList.contains("sbr-set-open")),
    "a swipe on Settings goes back: Settings closes, the menu does NOT open behind it, no scroll lock left");
  for (const label of ["AI Usage", "Mail", "Help & support"]) {
    if (!(await openFromMenu(label))) { await p.evaluate(() => { try { SB.close(); } catch (e) {} }); continue; }
    const before = await p.evaluate(() => document.getElementById("sbDrawer").classList.contains("open"));
    await swipe(8, 300);
    ok(before || !(await p.evaluate(() => document.getElementById("sbDrawer").classList.contains("open"))), label + " from the menu: a swipe never opens the menu behind it");
    await p.evaluate(() => { try { SB.close(); } catch (e) {} for (let i = 0; i < 3; i++) SMD_SWIPE_BACK.goBack(); }); await sleep(600);
  }
  const src = await (await fetch(BASE + "sidebar-redesign.js")).text();
  ok(/id: "swipeback", key: "smd_swipe_back", def: true, title: "Swipe from the left edge"/.test(src), "Settings > Preferences carries the on/off switch (on by default)");
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
await browser.close(); serve.kill();
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
