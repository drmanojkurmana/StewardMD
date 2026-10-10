/* PrepNucleus feels native in WebKit (owner bug 2026-10-09, iPhone screen recording after OTA v244): the "Set up practice"
 * sheet jumped to the top on every chip tap, showed a scroll bar, and opened on an empty choice ("Incorrect before (0)",
 * Start disabled). Headless Chrome never showed it, so this suite runs the REAL app in Playwright WebKit with an
 * iPhone 15 profile (touch, mobile, 3x) and taps with real touch events (page.touchscreen.tap).
 * What must hold:
 *  - the setup sheet opens on choices that have questions: a remembered empty choice falls back to All, every option
 *    with 0 questions is disabled, Start is enabled;
 *  - the sheet has ONE scroll container (.su-body); scrolled down to the Timer, each chip tap (Whole set, Per question,
 *    Timed test, Practice, a seconds preset, the stepper, Difficulty) keeps scrollTop on every frame after the tap and
 *    keeps the tapped chip where the finger is (no layout jump); the sheet and its chips are patched, not rebuilt;
 *  - no visible scroll bars (scrollbar-width none; offsetWidth equals clientWidth), nothing wider than the window;
 *  - the page behind never moves (its body scrollTop and the document scroll stay put), the scrim covers it;
 *  - the sheet's scroller is not masked (a mask makes WebKit paint the scroll on the main thread) and the root has no
 *    non-passive touchmove (a sheet registers its own), checked through the app's own markers;
 *  - drag the handle down: the sheet leaves;
 *  - screens: a tap that repaints in place (a subject filter chip, an answer) keeps the screen body's scroll and every
 *    inner horizontal scroller's scrollLeft, and patches the DOM (the body node survives);
 *  - no uncaught PrepNucleus error.
 * FRAMES=<dir> saves a frame strip (PNG per step + strip.png via ffmpeg when available).
 * USAGE: node test/run-prep-webkit-ui.mjs   (PLAYWRIGHT_CORE=<path to playwright-core>; FRAMES=<dir>)
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = "/test/fixtures/prep/";
const FRAMES = process.env.FRAMES || "";

// playwright-core is not a dependency of the app: PLAYWRIGHT_CORE, then node_modules, then the npx cache.
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

// index.html's CSP upgrades insecure requests, and WebKit (unlike Chrome) upgrades http://localhost too, so the repo is
// served from disk through a route on an https test origin (a secure context, as capacitor://localhost is on the phone).
const ORIGIN = "https://prep.test";
const BASE = ORIGIN + "/";
const ROOT = join(HERE, "..");
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
  for (let i = 0; i < 40; i++) {
    const x = { id: "bp-" + i, q: "Which root forms nerve " + i + "?", o: ["C5", "C6", "C7", "C8"], a: i % 4, exp: "Fixture explanation " + i + ".", t: "ana-brachial-plexus", d: (i % 3) + 1, prov: "LIC" };
    if (i % 5 === 0) Object.assign(x, { q: "The radiograph shown is of a shoulder after a fall. Which nerve is at risk?", img: ["fx-2025-r1-2-1.webp"], imgPlace: "stem" });
    else if (i % 2) x.q = "A " + (20 + i) + "-year-old man presents with weakness of the arm after a fall. Which nerve is injured?";
    items.push(x);
  }
  return { topic: "ana-brachial-plexus", items };
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const errors = [];
let browser;
let frameN = 0; const frameFiles = [];
try {
  browser = await pw.webkit.launch();
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"], hasTouch: true, isMobile: true, deviceScaleFactor: 3, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (process.env.DBG) { page.on("pageerror", (e) => console.log("pageerror", String(e.message).slice(0, 200))); page.on("requestfailed", (r) => console.log("reqfail", r.url().slice(0, 100))); page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 160)); }); }
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  await page.route(/ana-brachial-plexus\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFile()) }));
  await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  // The owner's phone remembered "Incorrect before" for the custom module, with nothing answered wrong yet.
  const remembered = JSON.stringify({ custom: { type: "all", seen: "wrong", d: "mix", n: 20, mode: "study", timer: "q", qs: 90, mins: 0, t: 1 } });
  await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
    try{ localStorage.setItem("smd_prep","1"); if (!sessionStorage.getItem("pnwk")) { sessionStorage.setItem("pnwk","1"); localStorage.removeItem("smd_prep_v1"); localStorage.setItem("smd_prep_setup", ${JSON.stringify(remembered)}); } }catch(e){}`);
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const center = async (sel) => { const r = await ev((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.top]; }, sel); return r; };
  const frame = async (name) => {
    if (!FRAMES) return;
    fs.mkdirSync(FRAMES, { recursive: true });
    const f = join(FRAMES, String(++frameN).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: f, scale: "css" }); frameFiles.push(f);
  };
  // Tap with a real touch, then sample a scroller's scrollTop and the tapped chip's top on every frame for ms.
  const tapAndWatch = async (sel, scroller, ms = 450) => {
    await ev(({ sc, ms }) => {
      window.__pnw = { lo: 1e9, hi: -1, n: 0 };
      const t0 = performance.now();
      (function f() { const b = document.querySelector(sc); if (b) { window.__pnw.lo = Math.min(window.__pnw.lo, b.scrollTop); window.__pnw.hi = Math.max(window.__pnw.hi, b.scrollTop); window.__pnw.n++; } if (performance.now() - t0 < ms + 200) requestAnimationFrame(f); })();
    }, { sc: scroller, ms });
    const c = await center(sel);
    if (!c) return { missing: true };
    await page.touchscreen.tap(c[0], c[1]);
    await sleep(ms);
    const after = await center(sel);
    const w = await ev(() => window.__pnw);
    return { lo: w.lo, hi: w.hi, frames: w.n, dy: after ? Math.round((after[2] - c[2]) * 10) / 10 : null };
  };

  // ---------- open the custom module's setup sheet ----------
  await ev(() => PREP.open());
  ok(await until(() => !!document.querySelector("#smdPrep [data-act=custom]") && !!window.PREP_SETUP, 20000), "PrepNucleus opens in WebKit; prep-setup.js is loaded");
  if (process.env.DBG) console.log(await ev(() => ({ t: (document.getElementById("smdPrep") || {}).innerText, l: window.PREP_LOADER && PREP_LOADER.V, s: !!window.PREP_SETUP })));
  await ev(() => document.querySelector("#smdPrep [data-act=custom]").click());
  await until(() => !!document.querySelector("#smdPrep [data-act=cmsub][data-v=anatomy]"), 5000);
  await ev(() => document.querySelector("#smdPrep [data-act=cmsub][data-v=anatomy]").click());
  await ev(() => document.querySelector("#smdPrep [data-act=cmstart]").click());
  ok(await until(() => !!document.querySelector("#pnSetup .su-sheet .su-chip") && !document.querySelector("#pnSetup .pn-load"), 10000), "the custom module opens the setup sheet");
  await sleep(450);
  await frame("sheet-open");

  // ---------- defaults never pick an empty option ----------
  const def = await ev(() => {
    const on = (row) => { const b = document.querySelector('#pnSetup [data-act="su-' + row + '"][aria-checked="true"]'); return b ? b.getAttribute("data-v") : null; };
    const zeros = [].slice.call(document.querySelectorAll("#pnSetup .su-chip")).filter((b) => { const n = b.querySelector(".su-n"); return n && +n.textContent.replace(/\D/g, "") === 0; });
    return { seen: on("seen"), type: on("type"), go: !document.querySelector("#suGo").disabled, status: document.querySelector("#suStatus").textContent, empty: document.querySelector("#suStatus").classList.contains("empty"),
      zeros: zeros.length, zerosOff: zeros.filter((b) => b.disabled || b.getAttribute("aria-disabled") === "true").length, zeroOn: zeros.filter((b) => b.getAttribute("aria-checked") === "true").length };
  });
  ok(def.seen !== "wrong" && def.go && !def.empty && /^\s*\d+\s*questions?/.test(def.status), "a remembered empty choice (Incorrect before, 0) falls back: New or repeat = " + def.seen + ", Start enabled, status \"" + def.status.trim() + "\"");
  ok(def.zeros > 0 && def.zerosOff === def.zeros && def.zeroOn === 0, "every option with 0 questions is disabled and none is chosen (" + def.zerosOff + " of " + def.zeros + ")");
  const zeroTap = await ev(() => { const b = [].slice.call(document.querySelectorAll("#pnSetup .su-chip")).find((x) => x.disabled || x.getAttribute("aria-disabled") === "true"); if (!b) return "none"; const st = document.querySelector("#suStatus").textContent; b.click(); return document.querySelector("#suStatus").textContent === st && b.getAttribute("aria-checked") !== "true"; });
  ok(zeroTap === true, "tapping an empty option does nothing");

  // ---------- one scroll container, no scroll bars, no mask ----------
  const shape = await ev(() => {
    const sh = document.querySelector("#pnSetup .su-sheet"), body = sh.querySelector(".su-body"), cs = getComputedStyle(body), scs = getComputedStyle(sh);
    const scrollers = [sh].concat([].slice.call(sh.querySelectorAll("*"))).filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; });
    return { scrollers: scrollers.map((e) => e.className), sbw: cs.scrollbarWidth || "", gutter: body.offsetWidth - body.clientWidth, mask: cs.webkitMaskImage || cs.maskImage || "none", osb: cs.overscrollBehaviorY || cs.overscrollBehavior, sheetOverflow: scs.overflowY };
  });
  ok(shape.scrollers.length === 1 && /su-body/.test(shape.scrollers[0]), "the sheet has one scroll container (" + shape.scrollers.join(", ") + ")");
  ok(shape.gutter === 0 && (shape.sbw === "" || shape.sbw === "none"), "no visible scroll bar (gutter " + shape.gutter + ", scrollbar-width " + (shape.sbw || "unsupported") + ")");
  ok(/none/.test(shape.mask), "the scroller is not masked (mask " + shape.mask + ")");
  ok(shape.osb === "contain", "overscroll stays in the sheet (overscroll-behavior " + shape.osb + ")");
  const passive = await ev(() => ({ root: !!(document.querySelector("#smdPrep") || {}).__pnTouchRoot, sheet: !!(document.querySelector("#pnSetup") || {}).__pnTouch }));
  ok(!passive.root && passive.sheet, "the drag's non-passive touchmove lives on the sheet, not the whole app (root " + passive.root + ", sheet " + passive.sheet + ")");

  // ---------- scroll to the Timer with the wheel (native scroll), then tap chips ----------
  const behind0 = await ev(() => ({ body: document.querySelector("#smdPrep > .pn-body").scrollTop, doc: document.scrollingElement.scrollTop }));
  // Mobile WebKit in Playwright has no wheel and no touch drag: the sheet is scrolled in steps, as a finger would leave it.
  // Steps of 60 px until the Difficulty row reaches the top of the scroller (prep60: the mode cards and the timer box
  // are at the top of the sheet now, the filters below them).
  for (let i = 0; i < 30; i++) {
    const more = await ev(() => { const b = document.querySelector("#pnSetup .su-body"), m = document.querySelector("#pnSetup .su-g-d"); const d = m.getBoundingClientRect().top - b.getBoundingClientRect().top - 8; if (d <= 1) return false; b.scrollBy(0, Math.min(60, d)); return b.scrollTop + b.clientHeight < b.scrollHeight - 1; });
    if (!more) break; await sleep(30);
  }
  await sleep(300);
  const y0 = await ev(() => document.querySelector("#pnSetup .su-body").scrollTop);
  ok(y0 > 100, "the sheet scrolls (scrollTop " + y0 + ")");
  await ev(() => { document.querySelector("#pnSetup .su-body").__keep = 1; document.querySelector("#pnSetup .su-sheet").__keep = 1; });
  await frame("scrolled-to-timer");
  const taps = [
    ['#pnSetup [data-act="su-timer"][data-v="set"]', "Timer: Whole set"],
    ['#pnSetup [data-act="su-timer"][data-v="q"]', "Timer: Each question"],
    ['#pnSetup [data-act="su-qdec"]', "seconds stepper -"],
    ['#pnSetup [data-act="su-qinc"]', "seconds stepper +"],
    ['#pnSetup [data-act="su-mode"][data-v="exam"]', "Mode: Test Mode"],
    ['#pnSetup [data-act="su-mode"][data-v="study"]', "Mode: Learning Mode"],
    ['#pnSetup [data-act="su-n"][data-v="10"]', "Number: 10"],
    ['#pnSetup [data-act="su-d"][data-v="2"]', "Difficulty: Moderate"],
    ['#pnSetup [data-act="su-timer"][data-v="set"]', "Timer: Whole set again"]
  ];
  for (const [sel, label] of taps) {
    // A chip above or below the visible part is scrolled into view first (as the finger would), then tapped.
    await ev((s) => { const b = document.querySelector("#pnSetup .su-body"), c = document.querySelector(s); if (!b || !c) return; const br = b.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (cr.top < br.top + 16 || cr.bottom > br.bottom - 16) b.scrollTop += cr.top - br.top - b.clientHeight / 3; }, sel);
    await sleep(120);
    const before = await ev(() => document.querySelector("#pnSetup .su-body").scrollTop);
    const r = await tapAndWatch(sel, "#pnSetup .su-body");
    if (r.missing) { ok(false, label + ": the chip is on screen"); continue; }
    const chosen = await ev((s) => { const b = document.querySelector(s); return !!b && (b.getAttribute("aria-checked") === "true" || !b.hasAttribute("aria-checked")); }, sel);
    ok(chosen && r.lo >= before - 1 && r.hi <= before + 1 && Math.abs(r.dy) <= 1, label + ": chosen; the sheet keeps its place on every frame (scrollTop " + r.lo + ".." + r.hi + " of " + before + ", " + r.frames + " frames), the chip stays under the finger (moved " + r.dy + " px)");
    await frame(label.replace(/\W+/g, "-").toLowerCase());
  }
  ok(await ev(() => document.querySelector("#pnSetup .su-body").__keep === 1 && document.querySelector("#pnSetup .su-sheet").__keep === 1) === true, "the sheet and its scroller are patched in place, never rebuilt");
  const behind1 = await ev(() => ({ body: document.querySelector("#smdPrep > .pn-body").scrollTop, doc: document.scrollingElement.scrollTop }));
  ok(behind1.body === behind0.body && behind1.doc === 0 && behind0.doc === 0, "the page behind never moved (body " + behind0.body + " -> " + behind1.body + ", document " + behind1.doc + ")");
  const wide = await ev(() => { const o = []; if (document.scrollingElement.scrollWidth > innerWidth) o.push("document"); document.querySelectorAll("#pnSetup *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1) o.push(e.className || e.tagName); }); return o.slice(0, 4).join("|"); });
  ok(wide === "", "nothing in the sheet is wider than the window" + (wide ? ": " + wide : ""));
  const callout = await ev(() => { const s = getComputedStyle(document.querySelector("#pnSetup .su-chip")); return [s.webkitUserSelect || s.userSelect, s.touchAction, s.webkitTouchCallout || "", s.webkitTapHighlightColor].join(" "); });
  ok(/none/.test(callout.split(" ")[0]) && /manipulation/.test(callout), "chips: no text selection, no double-tap delay (" + callout + ")");
  const foot = await ev(() => { const a = document.querySelector("#pnSetup .su-act"), r = a.getBoundingClientRect(); return { bottom: Math.round(r.bottom), h: innerHeight, pad: getComputedStyle(a).paddingBottom }; });
  ok(Math.abs(foot.bottom - foot.h) <= 1, "the action bar sits on the bottom edge (" + foot.bottom + " of " + foot.h + ", padding-bottom " + foot.pad + " with the safe area)");

  // ---------- drag the handle down: the sheet leaves ----------
  const g = await center("#pnSetup .pn-grab");
  await ev(({ x, y }) => {
    const sh = document.querySelector("#pnSetup .pn-grab");
    const fire = (type, yy) => sh.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: yy }));
    fire("pointerdown", y);
    for (let k = 1; k <= 10; k++) fire("pointermove", y + k * 30);
    fire("pointerup", y + 300);
  }, { x: g[0], y: g[1] });
  ok(await until(() => !document.querySelector("#pnSetup"), 2000), "dragging the handle down dismisses the sheet");

  // ---------- screens: an in-place repaint keeps every scroller and patches the DOM ----------
  await ev(() => PREP.back());
  await until(() => !!document.querySelector("#smdPrep [data-act=y-home]") || !!document.querySelector("#smdPrep [data-act=custom]"), 4000);
  await ev(() => document.querySelector("#smdPrep [data-act=subject][data-s=anatomy]").click());
  await until(() => !!document.querySelector("#smdPrep .pn-filters [data-act=filter]") && !!document.querySelector("#pnSub .pn-mod"), 8000);
  const fl = await ev(() => { const f = document.querySelector("#smdPrep .pn-filters"); f.scrollLeft = 60; const b = document.querySelector("#smdPrep > .pn-body"); b.__keep = 1; return { left: f.scrollLeft, room: f.scrollWidth - f.clientWidth }; });
  const fr = await tapAndWatch('#smdPrep .pn-filters [data-act=filter][data-v="paused"]', "#smdPrep > .pn-body");
  const fl2 = await ev(() => ({ left: document.querySelector("#smdPrep .pn-filters").scrollLeft, kept: document.querySelector("#smdPrep > .pn-body").__keep === 1, on: document.querySelector('#smdPrep [data-act=filter][data-v="paused"]').classList.contains("on") }));
  ok(fl2.on && (fl.room < 2 || Math.abs(fl2.left - fl.left) <= 1), "subject: a filter tap keeps the filter row's sideways scroll (" + fl.left + " -> " + fl2.left + ", room " + fl.room + ")");
  ok(fl2.kept, "subject: a filter tap patches the screen (the body node survives)");
  await ev(() => document.querySelector('#smdPrep [data-act=filter][data-v="all"]').click());

  // ---------- runner: answering keeps the place ----------
  await until(() => !!document.querySelector("#smdPrep .pn-mod[data-m=ana-brachial-plexus]"), 5000);
  await ev(() => { window.SMD_PREP_SETUP = false; document.querySelector("#smdPrep .pn-mod[data-m=ana-brachial-plexus]").click(); });
  await until(() => !!document.querySelector("#smdPrep [data-act=start][data-k=study]"), 6000);
  await ev(() => document.querySelector("#smdPrep [data-act=start][data-k=study]").click());
  ok(await until(() => !!document.querySelector("#smdPrep [data-act=answer]"), 6000), "a practice set runs");
  await frame("runner");
  const r0 = await ev(() => document.querySelector("#smdPrep > .pn-body").scrollTop);
  const rr = await tapAndWatch('#smdPrep [data-act=answer][data-k="1"]', "#smdPrep > .pn-body", 700);
  // The page may glide down just far enough to show the verdict (prep.js revealFeedback); it never jumps up or to the top.
  const fbIn = await ev(() => { const f = document.querySelector("#smdPrep .pn-fb"), b = document.querySelector("#smdPrep > .pn-body"); if (!f) return false; return f.getBoundingClientRect().top < b.getBoundingClientRect().bottom; });
  ok(!rr.missing && rr.lo >= r0 - 1 && fbIn, "runner: answering never jumps up (scrollTop " + r0 + " -> " + rr.lo + ".." + rr.hi + "), the verdict is in view");
  ok(await ev(() => !!document.querySelector("#smdPrep .pn-fb")), "the answer is marked");
  await frame("answered");
  const side = await ev(() => { const d = document.scrollingElement, o = []; if (d.scrollWidth > d.clientWidth) o.push("document"); document.querySelectorAll("#smdPrep .pn-body").forEach((b) => { if (b.scrollWidth > b.clientWidth + 1) o.push("body"); }); return o.join(","); });
  ok(side === "", "runner: nothing scrolls sideways");
  const gutters = await ev(() => [].slice.call(document.querySelectorAll("#smdPrep *")).filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight && e.offsetWidth - e.clientWidth > 0; }).map((e) => e.className).join(","));
  ok(gutters === "", "no scroller in the app shows a scroll bar gutter" + (gutters ? ": " + gutters : ""));

  // ---------- every surface: press states, no scroll bars, nothing sideways ----------
  // A control with no :active rule gives no feedback under the finger (a web page tell). Collected from the app's own
  // stylesheets: a control passes when any :active selector (with :active taken out) matches it.
  const audit = (name) => ev((name) => {
    if (!window.__pnAct) {
      const sels = [];
      const walk = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && r.selectorText.indexOf(":active") >= 0) r.selectorText.split(",").forEach((x) => { if (x.indexOf(":active") >= 0) sels.push(x.replace(/:active/g, "").trim()); }); } };
      for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
      window.__pnAct = sels;
    }
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== "hidden"; };
    const ctl = [].slice.call(document.querySelectorAll("#smdPrep button, #smdPrep [role=button], #smdPrep a[href], #smdPrep [data-act]")).filter((e) => vis(e) && !e.disabled && e.getAttribute("aria-disabled") !== "true" && !e.closest("[inert]") && !e.classList.contains("pn-scrim"));
    const noActive = ctl.filter((e) => !window.__pnAct.some((s) => { try { return e.matches(s); } catch (x) { return false; } })).map((e) => (e.getAttribute("data-act") || e.className || e.tagName).toString().slice(0, 40));
    const gut = [].slice.call(document.querySelectorAll("#smdPrep *")).filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY + s.overflowX) && (e.offsetWidth - e.clientWidth > 0 || e.offsetHeight - e.clientHeight > 0) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth); }).map((e) => e.className);
    const d = document.scrollingElement, wide = [];
    if (d.scrollWidth > d.clientWidth) wide.push("document");
    document.querySelectorAll("#smdPrep .pn-body").forEach((b) => { if (b.scrollWidth > b.clientWidth + 1) wide.push("body"); });
    return { name, n: ctl.length, noActive: Array.from(new Set(noActive)), gut, wide };
  }, name);
  const report = async (name) => {
    await sleep(350);
    const a = await audit(name);
    ok(a.noActive.length === 0, name + ": every control on screen has a press state (" + a.n + " controls)" + (a.noActive.length ? ": missing on " + a.noActive.join(", ") : ""));
    ok(a.gut.length === 0 && a.wide.length === 0, name + ": no scroll bar gutter, nothing sideways" + (a.gut.length || a.wide.length ? ": " + a.gut.concat(a.wide).join(", ") : ""));
    await frame("audit-" + name);
  };
  await report("runner");
  const clickAct = (sel) => ev((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
  // finish the set: answer and go on until the result screen
  for (let i = 0; i < 45; i++) {
    const st = await ev(() => document.querySelector("#smdPrep .pn-score") ? "done" : document.querySelector("#smdPrep [data-act=answer]:not([disabled])") ? "q" : document.querySelector("#smdPrep [data-act=next]") ? "n" : "?");
    if (st === "done") break;
    if (st === "q") await clickAct("#smdPrep [data-act=answer]");
    await clickAct("#smdPrep [data-act=next]");
    await sleep(30);
  }
  ok(await until(() => !!document.querySelector("#smdPrep .pn-score"), 6000), "the set finishes on the result screen");
  await report("results");
  const rvf = await ev(() => { const f = document.querySelector("#smdPrep .pn-rvf"); if (!f) return null; f.scrollLeft = 40; document.querySelector("#smdPrep > .pn-body").scrollTop = 300; return { left: f.scrollLeft, top: document.querySelector("#smdPrep > .pn-body").scrollTop }; });
  if (rvf) {
    await page.waitForTimeout(100);
    const b2 = await ev(() => { const x = [].slice.call(document.querySelectorAll("#smdPrep .pn-rvf [data-act]")).filter((b) => !b.classList.contains("on"))[0]; if (!x) return null; x.click(); const f = document.querySelector("#smdPrep .pn-rvf"); return { left: f.scrollLeft, top: document.querySelector("#smdPrep > .pn-body").scrollTop }; });
    ok(b2 && Math.abs(b2.left - rvf.left) <= 1 && Math.abs(b2.top - rvf.top) <= 1, "review filter: the filter row and the page keep their place (" + JSON.stringify(rvf) + " -> " + JSON.stringify(b2) + ")");
  }
  await ev(() => { window.SMD_PREP_SETUP = true; });
  const goHome = async () => { for (let i = 0; i < 6 && !(await ev(() => !!document.querySelector("#smdPrep [data-act=custom]"))); i++) { await ev(() => PREP.back()); await sleep(250); } };
  await clickAct("#smdPrep [data-act=donerun]"); await goHome();
  await report("home");
  await clickAct("#smdPrep [data-act=subject][data-s=anatomy]");
  await until(() => !!document.querySelector("#pnSub .pn-mod"), 6000);
  await report("subject");
  await clickAct("#smdPrep .pn-mod[data-m=ana-brachial-plexus]");
  await until(() => !!document.querySelector("#smdPrep [data-act=start]"), 6000);
  await report("module");
  await goHome();
  if (await clickAct("#smdPrep [data-act=c-home]")) { await sleep(600); await report("decks"); await goHome(); }
  if (await clickAct("#smdPrep [data-act=a-stats]")) { await sleep(600); await report("stats"); await goHome(); }
  if (await clickAct("#smdPrep [data-act=p-settings]")) {
    await until(() => !!document.querySelector("#pnPlanSheet .pl-setbody"), 4000);
    await report("settings");
    const ps = await ev(() => { const b = document.querySelector("#pnPlanSheet .pl-sheet"); b.__keep = 1; document.querySelector("#pnPlanSheet .pl-setbody").__keepB = 1; b.scrollTop = 120; return b.scrollTop; });
    const pm = await ev(() => { const x = [].slice.call(document.querySelectorAll("#pnPlanSheet [data-act=p-f-min]")).filter((b) => b.getAttribute("aria-checked") !== "true" && b.getAttribute("aria-pressed") !== "true")[0]; if (!x) return null; x.click(); const b = document.querySelector("#pnPlanSheet .pl-sheet"); return { top: b.scrollTop, kept: b.__keep === 1 && !!document.querySelector("#pnPlanSheet .pl-setbody").__keepB }; });
    ok(ps > 60 && !!pm && pm.kept && Math.abs(pm.top - ps) <= 1, "settings: a choice keeps the sheet's place and patches it (" + ps + " -> " + JSON.stringify(pm) + ")");
    await ev(() => PREP.back());
  }
  if (await ev(() => !!document.querySelector("#smdPrep [data-act=l-subject], #smdPrep [data-act=l-open]"))) { await clickAct("#smdPrep [data-act=l-open], #smdPrep [data-act=l-subject]"); await sleep(800); await report("lessons"); await goHome(); }

  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) {
  ok(false, "the run completed: " + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (FRAMES && frameFiles.length > 1) {
    const list = frameFiles.map((f) => ["-i", f]).flat();
    const n = frameFiles.length, cols = Math.min(6, n), rows = Math.ceil(n / cols);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...list, "-filter_complex", frameFiles.map((_, i) => `[${i}:v]scale=300:-1[v${i}]`).join(";") + ";" + frameFiles.map((_, i) => `[v${i}]`).join("") + `xstack=inputs=${n}:layout=` + frameFiles.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => "w0").join("+") : "0"}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => "h0").join("+") : "0"}`).join("|") + `:fill=white${rows * cols > n ? "" : ""}`, join(FRAMES, "strip.png")], { stdio: "inherit" });
    if (r.status === 0) console.log("frame strip: " + join(FRAMES, "strip.png"));
  }
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
