/* PrepNucleus floating glass tab bar (prep-nav.js + prep-nav.css) in the REAL app, in Playwright Chromium AND WebKit
 * (iPhone-sized, touch), against the fixture bank in test/fixtures/prep.
 * What must hold, in both engines:
 *  - home shows one nav landmark (aria-label PrepNucleus) inside the #smdPrep dialog, with Home, Learn, Tests and You,
 *    Home marked aria-current="page"; every tab is at least 44 x 44 CSS px; the bar floats inside the window, at most
 *    420 px wide and centred; the home bar's Menu button steps aside while the bar shows;
 *  - the last thing on home (and on the You and Tests screens) ends above the bar when scrolled to the bottom;
 *  - Tests opens the mock exams (aria-current moves), You opens the menu, Learn lists the subjects with lessons and a
 *    subject's lessons list keeps the bar with Learn current; back from a tab root goes home;
 *  - deep state: a subject opened from home keeps Home current; tapping Home returns to home (stack of one);
 *  - each tab keeps its scroll position (home scrolled, then Tests, then Home again);
 *  - the bar slides away (class pnv-off, inert, aria-hidden) in the question runner, in the practice setup sheet and
 *    while an input inside PrepNucleus has focus (the on-screen keyboard), and comes back after;
 *  - keyboard: Tab reaches the tabs after the screen's content; arrow keys move between them; Enter switches tab and
 *    keeps focus on the new current tab;
 *  - reduced motion: the pill and the bar have no transform transition; reduced transparency (Chromium, CDP media
 *    feature): the bar is solid (no backdrop filter);
 *  - Chromium gets the SVG lens (backdrop-filter with url(#pnvLens) and a lens map); WebKit never gets url() (the
 *    frosted layer only) and its backdrop filter is a real blur;
 *  - no uncaught PrepNucleus error.
 * SHOTS=<dir>: screenshots (both engines; 390x844, 430x932, 820x1180, 1180x820; light and dark; home at the top, the
 * middle and the bottom, and the other tabs). REAL=1 serves the real taxonomy and bank indexes and proxies
 * /api/prep/bank/ to stewardmd.in (read-only GETs) so screenshots show real content; assertions use the fixtures.
 * USAGE: node test/run-prep-nav-ui.mjs   (CHROME=<path> for Chromium; PLAYWRIGHT_CORE=<path>; ENGINES=chromium,webkit)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";
const REAL = !!process.env.REAL;
const ENGINES = (process.env.ENGINES || "chromium,webkit").split(",").map((s) => s.trim()).filter(Boolean);

async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(HERE, "..", "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) tries.push(join(npx, d, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.webkit.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed WebKit (set PLAYWRIGHT_CORE)"); process.exit(0); }

const ORIGIN = "https://prep.test", BASE = ORIGIN + "/", ROOT = join(HERE, "..");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
function moduleFile() {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ id: "bp-" + i, q: "A " + (20 + i) + "-year-old man has weakness of the arm after a fall. Which nerve is injured?", o: ["Axillary", "Radial", "Ulnar", "Median"], a: i % 4, exp: "Fixture explanation " + i + ".", t: "ana-brachial-plexus", d: (i % 3) + 1, prov: "LIC" });
  return { topic: "ana-brachial-plexus", items };
}
// A lessons index for the fixture subjects (Learn needs lessons whose module is in a fixture subject).
const LESSONS_IX = { v: 1, modules: { "ana-brachial-plexus": { title: "Brachial plexus in five steps", minutes: 5, steps: 5, gen: "hand" }, "ana-placenta": { title: "The placenta", minutes: 4, steps: 4, gen: "hand" }, "scd-hfref": { title: "Heart failure with reduced ejection fraction", minutes: 6, steps: 5, gen: "hand" } } };

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function session(engine, opts) {
  const type = pw[engine];
  const launch = engine === "chromium" && process.env.CHROME ? { executablePath: process.env.CHROME } : {};
  const browser = await type.launch(launch);
  const vp = opts.vp || { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: opts.dpr || 2, isMobile: engine !== "firefox" && vp.width < 700, hasTouch: true, serviceWorkers: "block", reducedMotion: opts.reduced ? "reduce" : "no-preference", colorScheme: opts.dark ? "dark" : "light",
    userAgent: engine === "webkit" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  // NONAV=1: prep-nav.js/css answer 404 (as on a build without them), for "before" screenshots.
  if (process.env.NONAV) await page.route(/\/prep-nav\.(js|css)/, (r) => r.fulfill({ status: 404, body: "" }));
  if (REAL) {
    await page.route(/^https:\/\/prep\.test\/api\//, async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() === "GET" && u.pathname.startsWith("/api/prep/bank/")) { try { const res = await fetch("https://stewardmd.in" + u.pathname + u.search); const b = Buffer.from(await res.arrayBuffer()); return r.fulfill({ status: res.status, contentType: res.headers.get("content-type") || "application/json", body: b }); } catch { return r.fulfill({ status: 404, body: "" }); } }
      return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
  } else {
    await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.route(/ana-brachial-plexus\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFile()) }));
    await page.route(/\/prep\/lessons\/v1\/index\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LESSONS_IX) }));
  }
  const fixGlobals = REAL ? `window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json";` : `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_LESSONS_BASE="/prep/lessons/";`;
  await page.addInitScript(`${fixGlobals} window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
    try{ localStorage.setItem("smd_prep","1"); if (!sessionStorage.getItem("pnnav")) { sessionStorage.setItem("pnnav","1"); localStorage.removeItem("smd_prep_v1"); } }catch(e){}`);
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate((dark) => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); document.body.classList.toggle("dark", !!dark); }, !!opts.dark);
  return { browser, ctx, page, errors };
}
const until = async (page, fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const settle = (page) => page.evaluate(() => new Promise((r) => { document.getAnimations().forEach((a) => { try { const t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); setTimeout(r, 700); }));
const navState = (page) => page.evaluate(() => {
  const n = document.querySelector("#smdPrep > nav.pnv"), cur = n && n.querySelector('[aria-current="page"]');
  const b = document.querySelector("#smdPrep > .pn-body");
  return { has: !!n, off: !n || n.classList.contains("pnv-off"), inert: !!(n && n.inert), hid: n && n.getAttribute("aria-hidden"), cur: cur && cur.getAttribute("data-tab"), depth: PREP._st.stack.length, body: b ? b.className + "#" + b.id : "" };
});
const tab = (page, id) => page.evaluate((i) => { document.querySelector('#smdPrep > nav.pnv .pnv-tab[data-tab="' + i + '"]').click(); }, id);
// The last thing in the scrolling body, scrolled to the bottom, ends above the bar's top.
const clearOfBar = (page) => page.evaluate(() => new Promise((res) => {
  const b = document.querySelector("#smdPrep > .pn-body"), n = document.querySelector("#smdPrep > nav.pnv");
  b.scrollTop = b.scrollHeight;
  setTimeout(() => {
    const kids = [].slice.call(b.children).filter((k) => k.getBoundingClientRect().height > 0 && getComputedStyle(k).display !== "none");
    const last = kids[kids.length - 1], lb = last.getBoundingClientRect().bottom, nt = n.getBoundingClientRect().top;
    res({ ok: lb <= nt + 0.5, lb: Math.round(lb), nt: Math.round(nt), last: last.className });
  }, 200);
}));

async function assertions(engine) {
  const { browser, page, errors } = await session(engine, {});
  try {
    const E = engine + ": ";
    await page.evaluate(() => PREP.open());
    ok(await until(page, () => !!document.querySelector("#pnHome") && !!document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)"), 20000), E + "home opens with the tab bar showing");
    let s = await navState(page);
    const meta = await page.evaluate(() => {
      const n = document.querySelector("#smdPrep > nav.pnv"), r = n.getBoundingClientRect();
      const tabs = [].slice.call(n.querySelectorAll(".pnv-tab")).map((t) => { const b = t.getBoundingClientRect(); return { id: t.getAttribute("data-tab"), w: b.width, h: b.height, label: t.textContent.trim() }; });
      const menu = document.querySelector("#smdPrep .pn-bar-brand [data-act=menu]");
      return { tag: n.tagName, label: n.getAttribute("aria-label"), inDialog: !!n.closest('[role="dialog"]#smdPrep'), navs: document.querySelectorAll("nav.pnv").length, tabs, w: r.width, l: r.left, rr: innerWidth - r.right, b: innerHeight - r.bottom,
        menuVis: menu ? getComputedStyle(menu).visibility : "none", pad: getComputedStyle(document.querySelector("#smdPrep > .pn-body")).paddingBottom };
    });
    ok(meta.tag === "NAV" && meta.label === "PrepNucleus" && meta.inDialog && meta.navs === 1, E + "one nav landmark labelled PrepNucleus inside the #smdPrep dialog");
    ok(meta.tabs.map((t) => t.label).join(",") === "Home,Learn,Tests,You" && s.cur === "home", E + "tabs Home, Learn, Tests, You; Home is aria-current (" + meta.tabs.map((t) => t.label).join(",") + ")");
    ok(meta.tabs.every((t) => t.w >= 44 && t.h >= 44), E + "every tab >= 44 x 44 (" + meta.tabs.map((t) => Math.round(t.w) + "x" + Math.round(t.h)).join(", ") + ")");
    ok(meta.w <= 420.5 && Math.abs(meta.l - meta.rr) < 1.5 && meta.b >= 11.5, E + "the bar is centred, " + Math.round(meta.w) + " px wide, " + Math.round(meta.b) + " px above the bottom");
    ok(meta.menuVis === "hidden", E + "the home bar's Menu button steps aside while the bar shows (" + meta.menuVis + "), body padding-bottom " + meta.pad);
    let c = await clearOfBar(page);
    ok(c.ok, E + "home scrolled to the bottom: the last block (" + c.last + ") ends at " + c.lb + ", above the bar at " + c.nt);
    const lensInfo = await page.evaluate(() => { const n = document.querySelector("#smdPrep > nav.pnv"), cs = getComputedStyle(n); const f = cs.backdropFilter || cs.webkitBackdropFilter || ""; const im = n.querySelector("#pnvMap"); return { lens: n.classList.contains("pnv-lens"), f, wf: cs.webkitBackdropFilter || "", map: !!(im && /^data:image\/svg/.test(im.getAttribute("href") || "")) }; });
    if (engine === "chromium") ok(lensInfo.lens && /url\(/.test(lensInfo.f) && /blur/.test(lensInfo.f) && lensInfo.map, E + "Chromium gets the SVG lens and its map (" + lensInfo.f.slice(0, 60) + ")");
    else ok(!lensInfo.lens && !/url\(/.test(lensInfo.f + lensInfo.wf) && /blur\(16px\)/.test(lensInfo.f + lensInfo.wf), E + "WebKit gets the frosted layer only, never url() (" + (lensInfo.wf || lensInfo.f) + ")");

    // ---- per-tab scroll: home at 300, Tests, back to Home
    await page.evaluate(() => { document.querySelector("#smdPrep > .pn-body").scrollTop = 300; });
    await sleep(100);
    const y0 = await page.evaluate(() => document.querySelector("#smdPrep > .pn-body").scrollTop);
    await tab(page, "tests");
    ok(await until(page, () => !!document.querySelector("#smdPrep > .pn-body.pn-mocks"), 5000), E + "Tests opens the mock exams");
    s = await navState(page);
    ok(s.cur === "tests" && !s.off && s.depth === 2, E + "Tests is current, the bar shows, the stack is [home, mocks]");
    c = await clearOfBar(page);
    ok(c.ok, E + "Tests scrolled to the bottom ends above the bar (" + c.lb + " <= " + c.nt + ")");
    await tab(page, "home");
    ok(await until(page, () => !!document.querySelector("#pnHome"), 5000), E + "Home returns to home");
    await sleep(250);
    const y1 = await page.evaluate(() => document.querySelector("#smdPrep > .pn-body").scrollTop);
    ok(Math.abs(y1 - y0) <= 2 && y0 > 0, E + "home keeps its scroll position across tabs (" + y0 + " -> " + y1 + ")");

    // ---- You, back
    await tab(page, "you");
    ok(await until(page, () => !!document.querySelector("#smdPrep > .pn-body.pn-menu"), 5000) && (await navState(page)).cur === "you", E + "You opens the menu and is current");
    c = await clearOfBar(page);
    ok(c.ok, E + "You scrolled to the bottom ends above the bar (" + c.lb + " <= " + c.nt + ")");
    await page.evaluate(() => PREP.back());
    ok(await until(page, () => !!document.querySelector("#pnHome"), 5000) && (await navState(page)).cur === "home", E + "back from a tab root goes home, Home current");

    // ---- Learn and a subject's lessons
    await tab(page, "learn");
    ok(await until(page, () => !!document.querySelector("#pnLearn [data-act=l-subject]"), 8000), E + "Learn lists subjects with lessons");
    const learn = await page.evaluate(() => [].slice.call(document.querySelectorAll("#pnLearn [data-act=l-subject]")).map((b) => b.getAttribute("data-s") + ":" + b.querySelector("small").textContent));
    ok(learn.length === 1 && learn[0] === "anatomy:2 lessons", E + "Learn counts lessons per subject (" + learn.join(" | ") + ")");
    await page.evaluate(() => document.querySelector("#pnLearn [data-act=l-subject][data-s=anatomy]").click());
    ok(await until(page, () => !!document.querySelector("#smdPrep > .pn-body.pn-lsn-all"), 8000), E + "a Learn subject opens its lessons");
    s = await navState(page);
    ok(s.cur === "learn" && !s.off, E + "the lessons list keeps the bar with Learn current (" + s.cur + ")");
    await tab(page, "learn");
    ok(await until(page, () => !!document.querySelector("#pnLearn"), 5000) && (await navState(page)).depth === 2, E + "tapping Learn again pops to the Learn root");

    // ---- deep state: a subject from home, then Home
    await tab(page, "home");
    await until(page, () => !!document.querySelector("#pnHome [data-act=subject][data-s=anatomy]"), 8000);
    await page.evaluate(() => document.querySelector("#pnHome [data-act=subject][data-s=anatomy]").click());
    ok(await until(page, () => !!document.querySelector("#pnSub"), 8000), E + "a subject opens from home");
    s = await navState(page);
    ok(s.cur === "home" && !s.off, E + "the subject keeps the bar with Home current");
    await until(page, () => !!document.querySelector("#pnSub [data-act=module][data-m=ana-brachial-plexus]"), 8000);
    await page.evaluate(() => document.querySelector("#pnSub [data-act=module][data-m=ana-brachial-plexus]").click());
    ok(await until(page, () => !!document.querySelector("#pnModPanel"), 8000) && !(await navState(page)).off, E + "the module screen keeps the bar");
    // ---- hidden in the setup sheet and the runner
    await page.evaluate(() => document.querySelector("#smdPrep [data-act=start][data-k=study]").click());
    const sheetUp = await until(page, () => !!document.querySelector("#smdPrep > .pn-sheet-wrap"), 8000);
    s = await navState(page);
    ok(sheetUp && s.off && s.inert && s.hid === "true", E + "the practice setup sheet hides the bar (inert, aria-hidden)");
    const rs = await page.evaluate(() => { const r = document.getElementById("smdPrep"); r.scrollTop = 200; return { y: r.scrollTop, o: getComputedStyle(r).overflowY }; });
    ok(rs.y === 0 && rs.o === "clip", E + "the hidden bar below the screen never makes the overlay scrollable (overflow " + rs.o + ", scrollTop " + rs.y + ")");
    if (sheetUp) { await until(page, () => { const g = document.querySelector("#suGo"); return !!g && !g.disabled; }, 8000); await page.evaluate(() => { const g = document.querySelector("#suGo"); if (g) g.click(); }); }
    else await page.evaluate(() => PREP._host.run(PREP._host.pool([]), "study", "x"));
    const inRun = await until(page, () => !!document.querySelector("#smdPrep .pn-run, #smdPrep .pn-qw") && !document.querySelector("#smdPrep > .pn-sheet-wrap"), 10000);
    if (!inRun) console.log("DBG", JSON.stringify(await navState(page)), await page.evaluate(() => (document.querySelector("#smdPrep") || {}).innerText.slice(0, 300)));
    s = await navState(page);
    ok(inRun && s.off && s.inert, E + "the question runner hides the bar");
    await page.evaluate(() => { const o = document.querySelector("#smdPrep [data-act=answer]"); if (o) o.click(); });
    await sleep(300);
    ok((await navState(page)).off, E + "feedback after an answer keeps it hidden");
    // back out to the module
    for (let i = 0; i < 3 && !(await page.evaluate(() => !!document.querySelector("#pnModPanel"))); i++) { await page.evaluate(() => PREP.back()); await sleep(250); }
    ok(await until(page, () => !!document.querySelector("#pnModPanel") && !document.querySelector("#smdPrep > nav.pnv.pnv-off"), 5000), E + "leaving the runner brings the bar back on the module");
    await tab(page, "home");
    ok(await until(page, () => !!document.querySelector("#pnHome"), 5000) && (await navState(page)).depth === 1, E + "Home from deep state (subject, module) returns to home, stack of one");

    // ---- keyboard open: an input inside PrepNucleus focused
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "pnTestInput"; document.querySelector("#pnHome").prepend(i); i.focus(); });
    await sleep(80);
    ok((await navState(page)).off, E + "a focused input (on-screen keyboard) hides the bar");
    await page.evaluate(() => { const i = document.getElementById("pnTestInput"); i.blur(); i.remove(); });
    await sleep(80);
    ok(!(await navState(page)).off, E + "blur brings it back");

    // ---- keyboard focus order and arrows
    const order = await page.evaluate(() => {
      const f = [].slice.call(document.querySelectorAll('#smdPrep button, #smdPrep [href], #smdPrep input, #smdPrep [tabindex]:not([tabindex="-1"])')).filter((e) => !e.disabled && e.offsetParent !== null && !e.closest("[inert]") && getComputedStyle(e).visibility !== "hidden");
      const firstTab = f.findIndex((e) => e.classList.contains("pnv-tab")), lastBody = f.reduce((m, e, i) => (e.closest(".pn-body") ? i : m), -1);
      return { firstTab, lastBody, n: f.length };
    });
    ok(order.firstTab > order.lastBody && order.lastBody >= 0, E + "in focus order the tabs come after the screen's content (" + order.lastBody + " < " + order.firstTab + ")");
    await page.evaluate(() => document.querySelector('#smdPrep .pnv-tab[data-tab="home"]').focus());
    await page.keyboard.press("ArrowRight");
    const f1 = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-tab"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    ok(await until(page, () => !!document.querySelector("#smdPrep > .pn-body.pn-mocks"), 5000), E + "arrows move between tabs (" + f1 + "), Enter opens Tests");
    await sleep(100);
    const f2 = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-tab"));
    ok(f2 === "tests", E + "focus stays on the new current tab after the switch (" + f2 + ")");
    await tab(page, "home");
    await until(page, () => !!document.querySelector("#pnHome"), 5000);

    // ---- close and reopen: one bar
    await page.evaluate(() => PREP.close());
    ok(await page.evaluate(() => !document.querySelector("nav.pnv")), E + "closing PrepNucleus removes the bar");
    await page.evaluate(() => PREP.open());
    ok(await until(page, () => !!document.querySelector("#pnHome") && document.querySelectorAll("nav.pnv").length === 1 && !document.querySelector("nav.pnv.pnv-off"), 10000), E + "reopening shows one bar again");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  } finally { await browser.close(); }
}

async function mediaChecks(engine) {
  const { browser, page, errors } = await session(engine, { reduced: true });
  try {
    const E = engine + " (reduced motion): ";
    await page.evaluate(() => PREP.open());
    await until(page, () => !!document.querySelector("#pnHome") && !!document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)"), 20000);
    const t = await page.evaluate(() => { const n = document.querySelector("#smdPrep > nav.pnv"); return { bar: getComputedStyle(n).transitionProperty, pill: getComputedStyle(n.querySelector(".pnv-pill")).transitionDuration }; });
    ok(!/transform/.test(t.bar) && parseFloat(t.pill) < 0.01, E + "no transform transition on the bar (" + t.bar + "), pill duration " + t.pill);
    if (engine === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      await sleep(100);
      const f = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector("#smdPrep > nav.pnv")); return { f: cs.backdropFilter, bg: cs.backgroundColor }; });
      ok((f.f === "none" || !f.f) && /rgb\(255, 255, 255\)/.test(f.bg), "chromium (reduced transparency): the bar is solid (" + f.f + ", " + f.bg + ")");
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
      await sleep(100);
      const g = await page.evaluate(() => getComputedStyle(document.querySelector("#smdPrep > nav.pnv")).backdropFilter);
      ok(g === "none", "chromium (more contrast): no blur (" + g + ")");
    }
    ok(errors.length === 0, E + "no uncaught PrepNucleus error");
  } finally { await browser.close(); }
}

// Screenshots: every size, light and dark, home at three scroll places, then Learn, Tests and You.
async function shots(engine) {
  const sizes = engine === "chromium" ? [[390, 844], [430, 932], [820, 1180], [1180, 820]] : [[390, 844], [820, 1180]];
  for (const [w, h] of sizes) for (const dark of [false, true]) {
    const { browser, page } = await session(engine, { vp: { width: w, height: h }, dark, dpr: w < 700 ? 2 : 1 });
    try {
      const tag = engine + "-" + w + "x" + h + "-" + (dark ? "dark" : "light");
      await page.evaluate(() => PREP.open());
      await until(page, (nn) => !!document.querySelector("#pnHome #pnGrid .pn-tile") && (nn || !!document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)")), 20000, !!process.env.NONAV);
      await sleep(REAL ? 2500 : 600); await settle(page);
      for (const [name, f] of [["home-top", 0], ["home-mid", 0.45], ["home-bottom", 1]]) {
        await page.evaluate((f) => { const b = document.querySelector("#smdPrep > .pn-body"); b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) * f); }, f);
        await sleep(450);
        await page.screenshot({ path: join(SHOTS, tag + "-" + name + ".png") });
      }
      for (const id of (process.env.NONAV ? [] : ["learn", "tests", "you"])) {
        await page.click('#smdPrep > nav.pnv .pnv-tab[data-tab="' + id + '"]');
        await sleep(REAL ? 1800 : 700); await settle(page);
        await page.screenshot({ path: join(SHOTS, tag + "-" + id + ".png") });
      }
    } finally { await browser.close(); }
  }
}

try {
  for (const e of ENGINES) {
    if (!REAL) { await assertions(e); await mediaChecks(e); }
    if (SHOTS) await shots(e);
  }
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
