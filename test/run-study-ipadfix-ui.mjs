/* Study iPad Fix UI test in the REAL app bundle with Playwright emulating iPad.
 * Tests:
 * 1. Zoom window opens ONLY on tool click, never on pen strokes; stays closed during drawing; zoom z unchanged.
 * 2. PDF annotation: text layer (.st-tl) does not block ink overlay (.st-ov); elementFromPoint returns .st-ov; strokes save and draw.
 * 3. Lag: 300 pointermove events; handler avg time < 2 ms; full canvas redraws === 0.
 * 4. Apple Pencil / palm rejection: pen draws; touch doesn't draw after pen seen; palm touch (large width/height) ignored; pencilDoubleTap toggles pen ↔ eraser ↔ previous tool; keyboard shortcuts.
 * 6. Back / Exit in every state: back button always returns to #stLib from doc, zoom window, open sheets, doc tabs, and presentation mode.
 *
 * USAGE: node test/run-study-ipadfix-ui.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || await freePort();
const BASE = (process.env.BASE || "http://localhost:" + PORT + "/").replace(/\/?$/, "/");

let serveProc = null;
try {
  await fetch(BASE);
} catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE); break; } catch { await sleep(200); }
  }
}

function makePdf(pages = ["Cardiology text layer page 1", "Cardiology text layer page 2"]) {
  const objs = [], n = pages.length, font = 3 + 2 * n;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => {
    const po = 3 + 2 * k, stream = `BT /F1 12 Tf 30 750 Td (${t}) Tj ET`;
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}
const PDF = makePdf();

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

// iPad 11-inch viewport: 820 x 1180 (or 1024 x 1366 iPad Pro)
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 1366 },
  deviceScaleFactor: 2,
  hasTouch: true
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => {
  console.error("[pageerror]", e);
  errors.push(e.message);
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("[console.error]", msg.text());
});

await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
await page.addInitScript(() => {
  window.SMD_PREP_SETUP = false;
  window.SMD_PREP_ONBOARD = false;
  window.confirm = () => true;
  window.prompt = (m, d) => d || "Clinical Notes";
});

async function boot(q) {
  await page.goto(BASE + "?" + q, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => {
    ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => {
      const e = document.getElementById(k);
      if (e) e.remove();
    });
    PREP.open();
  });
  await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row, .pnv-tab", { timeout: 30000 });
}

console.log("\n=== Starting Study iPad Fix UI Verification ===");

// 1. Boot app and open Study Library
await boot("prep=1&study=1");
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase("study");
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector("#stLib", { timeout: 15000 });
ok(true, "Booted app and entered Study Library");

// 2. Import PDF fixture
await page.setInputFiles("#stFile", { name: "Cardiology-iPad.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForSelector(".st-doc", { timeout: 20000 });
ok(true, "Imported PDF fixture into library");

// 3. Open PDF in editor
await page.locator(".st-open").first().click();
await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 20000 });
await page.waitForFunction(() => !document.querySelector(".pn-ghost"), { timeout: 5000 }).catch(() => {});
await sleep(300);
ok(true, "Opened PDF in Study Viewer");

// Select pen tool
await page.click('[data-act="st-tool"][data-v="pen"]');
await sleep(100);

/* =========================================================================
 * ISSUE 1: Zoom window must stay closed during pen strokes
 * ========================================================================= */
console.log("\n--- Testing Issue 1: Zoom window behavior ---");
const isZoomWinHidden = await page.evaluate(() => {
  const zw = document.getElementById("stP3ZoomWindow");
  if (!zw) return true;
  return zw.hidden || zw.style.display === "none" || getComputedStyle(zw).display === "none";
});
ok(isZoomWinHidden, "Issue 1: Zoom window is closed by default upon opening doc");

const zBefore = await page.evaluate(() => STUDY._state().z);

// Draw 5 strokes with pen pointer events
for (let s = 0; s < 5; s++) {
  const y = 0.2 + s * 0.1;
  await page.evaluate((y) => {
    const ov = document.querySelector('.st-ov[data-n="1"]');
    const r = ov.getBoundingClientRect();
    const fire = (t, x, yy, p) => ov.dispatchEvent(new PointerEvent(t, {
      pointerId: 10 + Math.floor(y * 10),
      pointerType: "pen",
      isPrimary: true,
      pressure: p,
      clientX: r.left + x * r.width,
      clientY: r.top + yy * r.height,
      bubbles: true,
      cancelable: true,
      buttons: t === "pointerup" ? 0 : 1
    }));
    fire("pointerdown", 0.15, y, 0.4);
    fire("pointermove", 0.35, y + 0.02, 0.6);
    fire("pointermove", 0.55, y, 0.5);
    fire("pointerup", 0.55, y, 0);
  }, y);
  await sleep(50);
}

const strokeCount = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
ok(strokeCount === 5, "5 pen strokes drawn and recorded: count is " + strokeCount);

const isZoomStillHidden = await page.evaluate(() => {
  const zw = document.getElementById("stP3ZoomWindow");
  if (!zw) return true;
  return zw.hidden || zw.style.display === "none" || getComputedStyle(zw).display === "none";
});
ok(isZoomStillHidden, "Issue 1: Zoom window remained closed after 5 pen strokes");

const zAfter = await page.evaluate(() => STUDY._state().z);
ok(zBefore === zAfter, `Issue 1: Page zoom z remained unchanged (${zBefore} === ${zAfter})`);

// Tap zoom-window tool button in toolbar
const hasZoomBtn = await page.locator('[data-act="st-zoom-window"]').count();
ok(hasZoomBtn > 0, "Issue 1: Toolbar has dedicated [data-act='st-zoom-window'] tool button");
await page.click('[data-act="st-zoom-window"]');
await sleep(150);

const isZoomOpenAfterClick = await page.evaluate(() => {
  const zw = document.getElementById("stP3ZoomWindow");
  return zw && !zw.hidden && getComputedStyle(zw).display !== "none";
});
ok(isZoomOpenAfterClick, "Issue 1: Zoom window opens when user taps [data-act='st-zoom-window']");

// Close via zoom Done/Close button
await page.click('[data-act="st-zoom-close"]');
await sleep(150);
const isZoomClosedAfterBtn = await page.evaluate(() => {
  const zw = document.getElementById("stP3ZoomWindow");
  return !zw || zw.hidden || getComputedStyle(zw).display === "none";
});
ok(isZoomClosedAfterBtn, "Issue 1: Zoom window closes when tapping Done button");

// Open again and close via Escape
await page.click('[data-act="st-zoom-window"]');
await sleep(150);
await page.keyboard.press("Escape");
await sleep(150);
const isZoomClosedAfterEsc = await page.evaluate(() => {
  const zw = document.getElementById("stP3ZoomWindow");
  return !zw || zw.hidden || getComputedStyle(zw).display === "none";
});
ok(isZoomClosedAfterEsc, "Issue 1: Zoom window closes when pressing Escape");


/* =========================================================================
 * ISSUE 2: Annotate uploaded PDF - text layer layering and pointer events
 * ========================================================================= */
console.log("\n--- Testing Issue 2: PDF annotation & layering ---");
console.log("DOM check before Issue 2:", await page.evaluate(() => ({
  hasPages: !!document.querySelector('#stPages'),
  ovCount: document.querySelectorAll('.st-ov').length,
  pgCount: document.querySelectorAll('.st-pg').length,
  hasLib: !!document.querySelector('#stLib')
})));
const hitElement = await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]');
  const r = ov.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.2);
  return {
    tag: el ? el.tagName.toLowerCase() : null,
    className: el ? el.className : null,
    isOverlay: el === ov
  };
});
ok(hitElement.isOverlay, `Issue 2: elementFromPoint at PDF coordinates hits canvas.st-ov (tag=${hitElement.tag}, class=${hitElement.className})`);

const tlPointerEvents = await page.evaluate(() => {
  const tl = document.querySelector('.st-pg[data-n="1"] .st-tl');
  return tl ? getComputedStyle(tl).pointerEvents : "none";
});
ok(tlPointerEvents === "none", `Issue 2: .st-tl pointer-events is "${tlPointerEvents}" in ink mode`);

// Draw an additional stroke directly using page.mouse / elementFromPoint coords
const preStrokes = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]');
  const r = ov.getBoundingClientRect();
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, {
    pointerId: 25,
    pointerType: "pen",
    isPrimary: true,
    pressure: 0.5,
    clientX: r.left + x * r.width,
    clientY: r.top + yy * r.height,
    bubbles: true
  }));
  fire("pointerdown", 0.4, 0.75);
  fire("pointermove", 0.6, 0.77);
  fire("pointerup", 0.6, 0.77);
});
await sleep(100);
const postStrokes = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
ok(postStrokes === preStrokes + 1, "Issue 2: Stroke successfully saved on uploaded PDF");


/* =========================================================================
 * ISSUE 3 & 7: Lag benchmark - 300 pointermove events
 * ========================================================================= */
console.log("\n--- Testing Issue 3: Lag benchmark (300 pointermove events) ---");
const benchResult = await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]');
  const r = ov.getBoundingClientRect();

  // Track full-canvas redraws by checking clearRect calls on the overlay context
  const ctx = ov.getContext("2d");
  let clearRectCalls = 0;
  const origClearRect = ctx.clearRect;
  ctx.clearRect = function(x, y, w, h) {
    // If clearing full canvas (or near full canvas), count as redraw
    if (w >= ov.width * 0.9 && h >= ov.height * 0.9) {
      clearRectCalls++;
    }
    return origClearRect.apply(this, arguments);
  };

  // Start stroke
  ov.dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 99,
    pointerType: "pen",
    isPrimary: true,
    pressure: 0.5,
    clientX: r.left + 0.1 * r.width,
    clientY: r.top + 0.5 * r.height,
    bubbles: true
  }));

  const redrawsAtStart = clearRectCalls;
  const times = [];
  const N = 300;
  for (let i = 1; i <= N; i++) {
    const frac = i / N;
    const cx = r.left + (0.1 + 0.8 * frac) * r.width;
    const cy = r.top + (0.5 + 0.05 * Math.sin(frac * 10)) * r.height;

    const t0 = performance.now();
    ov.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 99,
      pointerType: "pen",
      isPrimary: true,
      pressure: 0.5 + 0.3 * Math.sin(frac * 5),
      clientX: cx,
      clientY: cy,
      bubbles: true
    }));
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  const redrawsDuringMoves = clearRectCalls - redrawsAtStart;

  // End stroke
  ov.dispatchEvent(new PointerEvent("pointerup", {
    pointerId: 99,
    pointerType: "pen",
    isPrimary: true,
    pressure: 0,
    clientX: r.left + 0.9 * r.width,
    clientY: r.top + 0.5 * r.height,
    bubbles: true
  }));

  // Restore clearRect
  ctx.clearRect = origClearRect;

  const totalTime = times.reduce((a, b) => a + b, 0);
  const avgTime = totalTime / times.length;
  const maxTime = Math.max(...times);

  return {
    sampleCount: times.length,
    avgMs: avgTime,
    maxMs: maxTime,
    totalMs: totalTime,
    fullCanvasRedrawsDuringMoves: redrawsDuringMoves,
    fullCanvasRedrawsTotal: clearRectCalls
  };
});

console.log(`Lag benchmark results for ${benchResult.sampleCount} pointermove events:`);
console.log(`  Average time per move: ${benchResult.avgMs.toFixed(3)} ms (target < 2.0 ms)`);
console.log(`  Max time: ${benchResult.maxMs.toFixed(3)} ms`);
console.log(`  Total handler time: ${benchResult.totalMs.toFixed(2)} ms`);
console.log(`  Full canvas redraws during pointermove: ${benchResult.fullCanvasRedrawsDuringMoves} (target 0)`);
console.log(`  Full canvas redraws total (including pen-up commit): ${benchResult.fullCanvasRedrawsTotal}`);

ok(benchResult.avgMs < 2.0, `Issue 3: Average pointermove handler time is ${benchResult.avgMs.toFixed(3)} ms (< 2.0 ms target)`);
ok(benchResult.fullCanvasRedrawsDuringMoves === 0, `Issue 3: Zero full-canvas redraws during 300 pointermoves (count = ${benchResult.fullCanvasRedrawsDuringMoves})`);


/* =========================================================================
 * ISSUE 4: Apple Pencil / Palm rejection & pencilDoubleTap
 * ========================================================================= */
console.log("\n--- Testing Issue 4: Apple Pencil & Palm Rejection ---");

// Pen pointerType has already been seen in the previous tests.
// Now, a finger touch (pointerType "touch") must NOT draw any strokes!
const strokesBeforeTouch = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]');
  const r = ov.getBoundingClientRect();
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, {
    pointerId: 44,
    pointerType: "touch",
    isPrimary: true,
    clientX: r.left + x * r.width,
    clientY: r.top + yy * r.height,
    bubbles: true
  }));
  fire("pointerdown", 0.3, 0.4);
  fire("pointermove", 0.5, 0.45);
  fire("pointerup", 0.5, 0.45);
});
await sleep(100);
const strokesAfterTouch = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
ok(strokesBeforeTouch === strokesAfterTouch, "Issue 4: Finger touch after pen does not draw any ink (strokes unchanged)");

// A large touch (palm contact: width 35, height 40) must also be ignored
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]');
  const r = ov.getBoundingClientRect();
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, {
    pointerId: 55,
    pointerType: "touch",
    width: 35,
    height: 40,
    isPrimary: true,
    clientX: r.left + x * r.width,
    clientY: r.top + yy * r.height,
    bubbles: true
  }));
  fire("pointerdown", 0.2, 0.6);
  fire("pointermove", 0.3, 0.65);
  fire("pointerup", 0.3, 0.65);
});
await sleep(100);
const strokesAfterPalm = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
ok(strokesBeforeTouch === strokesAfterPalm, "Issue 4: Resting palm touch is ignored (strokes unchanged)");

// Test pencilDoubleTap API
const initialTool = await page.evaluate(() => STUDY._state().tool);
ok(initialTool === "pen", `Current active tool is "${initialTool}"`);

// Call STUDY.pencilDoubleTap()
await page.evaluate(() => STUDY.pencilDoubleTap());
await sleep(100);
const toolAfterTap1 = await page.evaluate(() => STUDY._state().tool);
ok(toolAfterTap1 === "er", `pencilDoubleTap switched from pen to "${toolAfterTap1}" (eraser)`);

// Call STUDY.pencilDoubleTap() again
await page.evaluate(() => STUDY.pencilDoubleTap());
await sleep(100);
const toolAfterTap2 = await page.evaluate(() => STUDY._state().tool);
ok(toolAfterTap2 === "pen", `pencilDoubleTap switched back to previous tool "${toolAfterTap2}"`);

// Test keyboard shortcut 'd'
await page.keyboard.press("KeyD");
await sleep(100);
const toolAfterKeyD = await page.evaluate(() => STUDY._state().tool);
ok(toolAfterKeyD === "er", `Key 'd' toggled tool to "${toolAfterKeyD}"`);

await page.keyboard.press("KeyD");
await sleep(100);
const toolAfterKeyD2 = await page.evaluate(() => STUDY._state().tool);
ok(toolAfterKeyD2 === "pen", `Key 'd' toggled tool back to "${toolAfterKeyD2}"`);


/* =========================================================================
 * ISSUE 6: Back / Exit in EVERY editor state
 * ========================================================================= */
console.log("\n--- Testing Issue 6: Back/Exit in EVERY editor state ---");

// 1. Back button returns to library #stLib
const backBtnCount = await page.locator('#stP3Top [data-act="st-p3-back"]').count();
ok(backBtnCount > 0, "Issue 6: Top bar has visible back button [data-act='st-p3-back']");
await page.click('#stP3Top [data-act="st-p3-back"]');
await page.waitForSelector("#stLib", { timeout: 10000 });
ok(true, "Issue 6: Back button returned directly to Library #stLib");

// 2. Re-open doc, test with open sheets
await page.locator(".st-open").first().click();
await page.waitForSelector("#stPages", { timeout: 15000 });
await sleep(200);

// Open Add Sheet
if (await page.locator('[data-act="st-p3-add"]').count()) {
  await page.click('[data-act="st-p3-add"]');
  await page.waitForSelector("#stP3AddSheet", { timeout: 5000 });
  ok(true, "Issue 6: Opened Add Page sheet");
  // Close via Escape
  await page.keyboard.press("Escape");
  await sleep(150);
  const isSheetGone = await page.locator("#stP3AddSheet").count() === 0;
  ok(isSheetGone, "Issue 6: Add Page sheet closed on Escape");
}

// Open More Sheet
if (await page.locator('[data-act="st-p3-more"]').count()) {
  await page.click('[data-act="st-p3-more"]');
  await page.waitForSelector("#stP3MoreSheet", { timeout: 5000 });
  ok(true, "Issue 6: Opened More menu sheet");
  // Close via outside tap / Escape
  await page.keyboard.press("Escape");
  await sleep(150);
  const isMoreGone = await page.locator("#stP3MoreSheet").count() === 0;
  ok(isMoreGone, "Issue 6: More sheet closed on Escape");
}

// Open Navigator Sheet
if (await page.locator('[data-act="st-p3-grid"]').count()) {
  await page.click('[data-act="st-p3-grid"]');
  await page.waitForSelector("#stP3NavSheet", { timeout: 5000 });
  ok(true, "Issue 6: Opened Navigator sheet");
  await page.keyboard.press("Escape");
  await sleep(150);
  const isNavGone = await page.locator("#stP3NavSheet").count() === 0;
  ok(isNavGone, "Issue 6: Navigator sheet closed on Escape");
}

// Open zoom window, then click back button directly
await page.click('[data-act="st-zoom-window"]');
await page.waitForSelector("#stP3ZoomWindow", { timeout: 5000 });
ok(true, "Issue 6: Opened Zoom Window");
await page.click('#stP3Top [data-act="st-p3-back"]');
await page.waitForSelector("#stLib", { timeout: 10000 });
ok(true, "Issue 6: Back button exits cleanly to #stLib even while Zoom Window is open");

// 3. Test document tab switching and back button
// Create a second document in library so we have multiple tabs
await page.setInputFiles("#stFile", { name: "Cardiology-iPad-2.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForFunction(() => document.querySelectorAll(".st-doc, .st5a-card.st-doc").length >= 2, null, { timeout: 20000 });
// Open second document
await page.locator(".st-open, [data-act='st-open'], [data-act='st5a-open']").first().click();
await page.waitForSelector("#stPages", { timeout: 15000 });
await sleep(300);

// Check if document tabs are present
const docTabCount = await page.locator("#stDocTabs .st-dt, #stDocTabs button").count();
console.log(`Document tabs found: ${docTabCount}`);
ok(docTabCount > 0, "Issue 6: Document tabs (#stDocTabs) rendered when multiple docs are open");

// Switch tab if multiple tabs exist
const tabButtons = page.locator("#stDocTabs [data-act='st5a-dt-open'], #stDocTabs [data-act='st-dt-open']");
if (await tabButtons.count() > 1) {
  await tabButtons.nth(1).click();
  await sleep(300);
  ok(true, "Issue 6: Switched to second document tab");
}

// Top bar back button should still be present and working
await page.click('#stP3Top [data-act="st-p3-back"]');
await page.waitForSelector("#stLib", { timeout: 10000 });
ok(true, "Issue 6: Back button works after viewing doc tabs, returns to #stLib");

// 4. Test presentation mode Exit button
await page.locator(".st-open, [data-act='st-open'], [data-act='st5a-open']").first().click();
await page.waitForSelector("#stPages", { timeout: 15000 });
await sleep(200);

if (await page.locator('[data-act="st-p3-more"]').count()) {
  await page.click('[data-act="st-p3-more"]');
  await page.waitForSelector("#stP3MoreSheet", { timeout: 5000 });
  if (await page.locator('[data-act="st-present"]').count()) {
    await page.click('[data-act="st-present"]');
    await page.waitForSelector("#st5bPresent", { timeout: 5000 });
    ok(true, "Issue 6: Entered presentation mode (#st5bPresent rendered)");

    // Verify exit button exists
    const exitBtn = page.locator('#st5bPresent [data-act="st-present-exit"]');
    ok(await exitBtn.count() > 0, "Issue 6: Visible Exit button in presentation mode");
    await exitBtn.first().click();
    await page.waitForSelector("#st5bPresent", { state: "detached", timeout: 5000 });
    ok(true, "Issue 6: Exited presentation mode via Exit button");
  }
}

// Exit back to library
await page.click('#stP3Top [data-act="st-p3-back"]');
await page.waitForSelector("#stLib", { timeout: 10000 });
ok(true, "Issue 6: Back button returns to library successfully");

await browser.close();
if (serveProc) serveProc.kill();

console.log(`\n========================================`);
console.log(`Summary: ${fails === 0 ? "ALL PASSED" : fails + " FAILURES"}`);
console.log(`========================================\n`);

process.exit(fails > 0 ? 1 : 0);
