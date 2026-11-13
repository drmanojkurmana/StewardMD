/* Settings pushes its pages like iOS Settings (owner 2026-11-13, with a screen recording of iOS Settings).
 * A row slides its page in from the right, opaque, while Settings slides a third left and dims. A round
 * Back and a centred title head the page. Back, or a drag from the left edge, reverses it; a short drag
 * springs back. The bug this guards: Profile arrived with its rows fading in from 0 over a fully visible
 * Settings, so the two pages showed through each other.
 * USAGE: node test/run-settings-push-ui.mjs  (Playwright; serves the repo on :8996 itself). */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8996"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const browser = await pw.chromium.launch();
try {
  for (const dark of [true, false]) {
    const T = dark ? "[dark] " : "[light] ";
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: dark ? "dark" : "light", hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(BASE, { waitUntil: "load" });
    await p.waitForFunction(() => window.SMD_openSettings && window.SMD_openProfile, null, { timeout: 30000 });
    await sleep(600);
    await p.evaluate(d => {
      ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "ghisPanel"].forEach(k => { const n = document.getElementById(k); if (n) n.remove(); });
      document.querySelectorAll(".smdonb").forEach(e => e.remove());
      document.body.classList.toggle("dark", d);
      localStorage.setItem("stewardmd_account", JSON.stringify({ type: "google", name: "Dr Test", email: "someone@hospital.org" }));
      SMD_openSettings();
    }, dark);
    await sleep(500);

    await p.evaluate(() => document.querySelector('#sbrSettings [data-sbr-act="profile"]').click());
    await sleep(120);
    const mid = await p.evaluate(() => { const r = document.getElementById("hvSheet").getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; });
    ok(mid.top === 0 && mid.left > 0, T + "mid-push the page enters from the right edge, not from below " + JSON.stringify(mid));
    await sleep(600);
    const st = await p.evaluate(() => {
      const sh = document.getElementById("hvSheet"), set = document.getElementById("sbrSettings");
      const m = new DOMMatrix(getComputedStyle(set).transform);
      return {
        on: sh.classList.contains("on"), x: Math.round(sh.getBoundingClientRect().left), bg: getComputedStyle(sh).backgroundColor, setBg: getComputedStyle(set).backgroundColor,
        under: set.classList.contains("sbr-under"), setX: Math.round(m.m41), w: set.offsetWidth,
        dim: +getComputedStyle(document.getElementById("sbrDim")).opacity,
        rowsOpacity: [...sh.querySelectorAll(".hv-sheet-wrap>*")].filter(k => getComputedStyle(k).display !== "none").map(k => +getComputedStyle(k).opacity),
        title: (sh.querySelector(".sbr-nav .sbr-nav-t") || {}).textContent, back: !!sh.querySelector(".sbr-nav .sbr-round-back[aria-label]"),
        oldTitleHidden: [...sh.querySelectorAll(".hv-sheet-wrap>.hv-sh-t")].every(t => getComputedStyle(t).display === "none"),
      };
    });
    ok(st.on && st.x === 0, T + "Profile is pushed fully on screen");
    ok(st.bg === st.setBg && !/rgba\(.*,\s*0(\.\d+)?\)$/.test(st.bg), T + "the page is opaque and wears Settings' own background (" + st.bg + ")");
    ok(st.rowsOpacity.length > 0 && st.rowsOpacity.every(o => o === 1), T + "every row is fully opaque: nothing fades in over Settings");
    ok(st.under && Math.abs(st.setX + st.w * 0.3) <= 2, T + "Settings slides a third to the left underneath (" + st.setX + "px)");
    ok(st.dim > 0.99, T + "and is dimmed");
    ok(st.title === "Profile" && st.back, T + "a round Back and a centred 'Profile' title head the page");
    ok(st.oldTitleHidden, T + "the page's own title row is not shown twice");

    // A short edge drag springs back; a long one pops back to Settings.
    const cdp = await ctx.newCDPSession(p);
    const drag = async (x1) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 8, y: 420 }] });
      for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 8 + (x1 - 8) * i / 8, y: 420 }] }); await sleep(16); }
      await sleep(150);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await drag(110); await sleep(700);
    const short = await p.evaluate(() => ({ on: document.getElementById("hvSheet").classList.contains("on"), x: Math.round(document.getElementById("hvSheet").getBoundingClientRect().left) }));
    ok(short.on && short.x === 0, T + "a short edge drag springs the page back");
    await drag(260); await sleep(800);
    const popped = await p.evaluate(() => { const set = document.getElementById("sbrSettings"); return { on: document.getElementById("hvSheet").classList.contains("on"), settings: !!set, under: set && set.classList.contains("sbr-under"), setTf: set && getComputedStyle(set).transform }; });
    ok(!popped.on && popped.settings && !popped.under && popped.setTf === "none", T + "a long edge drag pops back to Settings, in place");

    // Back button
    await p.evaluate(() => document.querySelector('#sbrSettings [data-sbr-act="appearance"]').click()); await sleep(700);
    const ap = await p.evaluate(() => ({ title: (document.querySelector("#hvSheet .sbr-nav-t") || {}).textContent, done: [...document.querySelectorAll("#hvSheet .settings-done")].some(d => getComputedStyle(d).display !== "none") }));
    ok(!!ap.title && !ap.done, T + "Appearance pushes the same way, with Back instead of Done (" + ap.title + ")");
    await p.evaluate(() => document.querySelector("#hvSheet .sbr-nav .sbr-round-back").click()); await sleep(750);
    const bk = await p.evaluate(() => ({ on: document.getElementById("hvSheet").classList.contains("on"), pushed: document.getElementById("hvSheet").classList.contains("sbr-pushed"), under: document.getElementById("sbrSettings").classList.contains("sbr-under") }));
    ok(!bk.on && !bk.pushed && !bk.under, T + "Back returns to Settings and clears the push");

    // Experimental is a pushed page too.
    await p.evaluate(() => document.querySelector('#sbrSettings [data-sbr-act="experimental"]').click()); await sleep(700);
    const ex = await p.evaluate(() => { const e = document.getElementById("sbrExperimental"); return { x: e && Math.round(e.getBoundingClientRect().left), under: document.getElementById("sbrSettings").classList.contains("sbr-under"), back: !!(e && e.querySelector(".sbr-round-back")) }; });
    ok(ex.x === 0 && ex.under && ex.back, T + "Experimental pushes over Settings with the round Back");
    await p.evaluate(() => document.querySelector("#sbrExperimental [data-sexp=close]").click()); await sleep(700);
    ok(await p.evaluate(() => !document.getElementById("sbrExperimental") && !document.getElementById("sbrSettings").classList.contains("sbr-under")), T + "and Back pops it");

    // Closing Settings leaves nothing behind.
    await p.evaluate(() => document.querySelector("#sbrSettings [data-sset=close]").click()); await sleep(300);
    ok(await p.evaluate(() => !document.getElementById("sbrDim") && !document.getElementById("sbrSettings")), T + "closing Settings removes the dim layer");
    ok(errs.length === 0, T + "no page errors " + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
} finally {
  await browser.close();
  if (serve) serve.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
