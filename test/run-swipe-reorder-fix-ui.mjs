/* Headless Chrome (CDP) test verifying commit 644e34ae:
 * 1. swipe-back.js: inHScroll() fix (scrollLeft === 0 does NOT block; scrollLeft > 0 blocks)
 * 2. home.js: drag-to-reorder (Customize sheet rows + Home grid long-press tiles)
 *
 * USAGE: node test/run-swipe-reorder-fix-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 8991;
const DBG = 9399;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/swipe-reorder-chrome-" + Date.now();
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

let serveProc = null;
let chrome = null;
let ws = null;
let sessionId = null;
let msgId = 1;
const pending = new Map();

const call = (m, p) => {
  const i = msgId++;
  const payload = { id: i, method: m, params: p || {} };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise(r => {
    pending.set(i, r);
    ws.send(JSON.stringify(payload));
  });
};

const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true,
    awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};

const J = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

try {
  // 1. Start static server
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(BASE);
      break;
    } catch {
      await sleep(200);
    }
  }

  // 2. Launch headless Chrome
  chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--disable-gpu",
    "--mute-audio",
    "--window-size=1100,900"
  ], { stdio: "ignore" });

  let ver, t = 0;
  while (t++ < 60) {
    try {
      ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!ver || !ver.webSocketDebuggerUrl) {
    throw new Error("Failed to connect to Chrome remote debugging port " + DBG);
  }

  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const tRes = await call("Target.createTarget", { url: "about:blank" });
  if (!tRes.result) throw new Error("Target.createTarget failed: " + JSON.stringify(tRes));
  const targetId = tRes.result.targetId;
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;

  await call("Runtime.enable", {});
  await call("Page.navigate", { url: BASE + "index.html" });

  // Wait for app load
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SB;`) === true) {
      ready = true;
      break;
    }
  }
  ok(ready, "index.html boots in headless Chrome (ui-v2 class, window.SB initialized)");

  // Dismiss intro gates if present
  await ev(`
    ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){
      var e = document.getElementById(k);
      if (e) e.remove();
    });
    if (window.SMD_showHome) SMD_showHome();
    return true;
  `);
  await sleep(600);

  // =========================================================================
  // Fix 1: swipe-back.js - inHScroll() fix
  // =========================================================================
  console.log("\n--- Checking Fix 1: swipe-back.js - inHScroll() ---");

  // Read the current swipe-back.js source to extract inHScroll exactly as defined
  const swipeBackSrc = readFileSync(join(ROOT, "swipe-back.js"), "utf8");
  const inHScrollMatch = swipeBackSrc.match(/function inHScroll\([\s\S]*?\n  \}/);
  ok(!!inHScrollMatch, "swipe-back.js contains inHScroll function definition");

  // Check window.SMD_SWIPE_BACK
  const hasSwipeBack = await ev(`return !!window.SMD_SWIPE_BACK;`);
  ok(hasSwipeBack === true, "window.SMD_SWIPE_BACK exists on window");

  const swipeBackExports = await J(`
    return JSON.stringify(Object.keys(window.SMD_SWIPE_BACK || {}));
  `);
  ok(Array.isArray(swipeBackExports) && !swipeBackExports.includes("inHScroll"),
    "inHScroll is not exported on window.SMD_SWIPE_BACK (internal closure function in swipe-back.js IIFE)");

  // Inject inHScroll into the page context from the actual current source of swipe-back.js
  await ev(`
    window.__inHScroll = ${inHScrollMatch[0]};
    return typeof window.__inHScroll === "function";
  `);

  // Build a real DOM element matching the dosage table shape (.gd-tw):
  // width: 100%, overflow-x: auto, wide inner child (table / div), inset near edge
  const domSetup = await J(`
    var wrap = document.createElement("div");
    wrap.id = "testHScrollWrap";
    wrap.style.cssText = "position:fixed;left:14px;top:100px;width:250px;overflow-x:auto;z-index:99999;background:#fff;";
    var inner = document.createElement("div");
    inner.id = "testHScrollInner";
    inner.style.cssText = "width:800px;height:40px;";
    inner.innerHTML = "<span>Dosage table cell at edge</span>";
    wrap.appendChild(inner);
    document.body.appendChild(wrap);

    var cs = window.getComputedStyle(wrap);
    return JSON.stringify({
      overflowX: cs.overflowX,
      scrollWidth: wrap.scrollWidth,
      clientWidth: wrap.clientWidth,
      isOverflowing: wrap.scrollWidth > wrap.clientWidth + 4
    });
  `);

  ok(domSetup.overflowX === "auto", `synthetic dosage container has computed overflow-x: auto (got ${domSetup.overflowX})`);
  ok(domSetup.isOverflowing === true, `synthetic dosage container scrollWidth (${domSetup.scrollWidth}) > clientWidth (${domSetup.clientWidth}) + 4`);

  // Assert 1a: with scrollLeft = 0, inHScroll must return false (must NOT block gesture)
  const atZero = await J(`
    var wrap = document.getElementById("testHScrollWrap");
    var inner = document.getElementById("testHScrollInner");
    wrap.scrollLeft = 0;
    var res = window.__inHScroll(inner);
    return JSON.stringify({ scrollLeft: wrap.scrollLeft, blocked: res });
  `);
  ok(atZero.scrollLeft === 0 && atZero.blocked === false,
    `Fix 1 branch 1: with scrollLeft=0, inHScroll() returns false (does NOT block back-swipe)`);

  // Assert 1b: with scrollLeft > 0, inHScroll must return true (MUST block gesture)
  const atScrolled = await J(`
    var wrap = document.getElementById("testHScrollWrap");
    var inner = document.getElementById("testHScrollInner");
    wrap.scrollLeft = 30;
    var res = window.__inHScroll(inner);
    return JSON.stringify({ scrollLeft: wrap.scrollLeft, blocked: res });
  `);
  ok(atScrolled.scrollLeft > 0 && atScrolled.blocked === true,
    `Fix 1 branch 2: with scrollLeft>0 (${atScrolled.scrollLeft}px), inHScroll() returns true (MUST block back-swipe)`);

  // Assert 1c: verify with non-overflowing element (scrollWidth <= clientWidth + 4)
  const nonOverflowing = await J(`
    var nonWrap = document.createElement("div");
    nonWrap.style.cssText = "width:250px;overflow-x:auto;";
    var nonInner = document.createElement("div");
    nonInner.style.cssText = "width:100px;height:40px;";
    nonWrap.appendChild(nonInner);
    document.body.appendChild(nonWrap);
    var res = window.__inHScroll(nonInner);
    nonWrap.remove();
    return JSON.stringify({ blocked: res });
  `);
  ok(nonOverflowing.blocked === false,
    `Fix 1 guard: non-overflowing element within scroll container returns false`);

  // Cleanup synthetic wrap
  await ev(`var w = document.getElementById("testHScrollWrap"); if(w) w.remove(); return true;`);

  // Also test with real MEDDB overlay
  const medDbCheck = await J(`
    if (!window.MEDDB || typeof window.MEDDB.openList !== "function") {
      return JSON.stringify({ available: false });
    }
    window.MEDDB.openList();
    var overlay = document.getElementById("dbOverlay");
    return JSON.stringify({ available: true, overlayShown: !!(overlay && overlay.classList.contains("on")) });
  `);
  if (medDbCheck.available && medDbCheck.overlayShown) {
    ok(true, "MEDDB.openList() opens the Drugs Database (#dbOverlay.on)");
    await ev(`window.MEDDB.close(); return true;`);
  }

  // =========================================================================
  // Fix 2: home.js - drag-to-reorder
  // =========================================================================
  console.log("\n--- Checking Fix 2: home.js - drag-to-reorder ---");

  // Ensure clean state for smd_home_tools_order
  await ev(`localStorage.removeItem("smd_home_tools_order"); return true;`);

  // Step 2a: Open the app to Home, open Customize-tools sheet (data-act="customizetools")
  const openSheetRes = await J(`
    var btn = document.querySelector('[data-act="customizetools"]');
    if (!btn) return JSON.stringify({ err: "no [data-act='customizetools'] found" });
    btn.click();
    var sh = document.getElementById("hvSheet");
    return JSON.stringify({
      clicked: true,
      sheetOn: !!(sh && sh.classList.contains("on"))
    });
  `);
  await sleep(400);
  ok(openSheetRes.sheetOn === true, "2a: clicking [data-act='customizetools'] opens Customize-tools sheet (#hvSheet.on)");

  // Step 2b: Confirm each row has a ".hv-drag" handle
  const rowCheck = await J(`
    var sh = document.getElementById("hvSheet");
    if (!sh) return JSON.stringify({ err: "no sheet" });
    var rows = [].slice.call(sh.querySelectorAll(".hv-tool-tog"));
    var handles = [].slice.call(sh.querySelectorAll(".hv-tool-tog .hv-drag"));
    var tools = rows.map(function(r) { return r.getAttribute("data-tool"); });
    return JSON.stringify({
      rowCount: rows.length,
      handleCount: handles.length,
      allRowsHaveDrag: rows.length > 0 && rows.length === handles.length,
      tools: tools
    });
  `);
  ok(rowCheck.allRowsHaveDrag === true, `2b: each row in Customize-tools sheet has a .hv-drag handle (${rowCheck.handleCount}/${rowCheck.rowCount} rows)`);

  // Inspect DOM hierarchy: #hvSheet parent vs #homeV2
  const hierarchy = await J(`
    var root = document.getElementById("homeV2");
    var sh = document.getElementById("hvSheet");
    return JSON.stringify({
      shParent: sh && sh.parentElement ? sh.parentElement.tagName : null,
      rootId: root ? root.id : null,
      shInsideRoot: !!(root && sh && root.contains(sh))
    });
  `);
  console.log(`DOM hierarchy: #hvSheet parent is <${hierarchy.shParent}>; is inside #homeV2? ${hierarchy.shInsideRoot}`);

  // Step 2c: Simulate drag on Customize-tools sheet row 0 below row 1
  const dragSimResult = await J(`
    var sh = document.getElementById("hvSheet");
    var rows = [].slice.call(sh.querySelectorAll(".hv-tool-tog"));
    if (rows.length < 2) return JSON.stringify({ err: "fewer than 2 rows" });

    var firstRow = rows[0];
    var secondRow = rows[1];
    var handle = firstRow.querySelector(".hv-drag");
    var initialOrder = rows.map(function(r) { return r.getAttribute("data-tool"); });

    var rect1 = firstRow.getBoundingClientRect();
    var rect2 = secondRow.getBoundingClientRect();

    // Dispatch pointerdown on handle
    var pd = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: rect1.left + 10,
      clientY: rect1.top + rect1.height / 2
    });
    handle.dispatchEvent(pd);

    var isDraggingAfterDown = firstRow.classList.contains("dragging");

    // Move pointer below second row
    var pm = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: rect2.left + 10,
      clientY: rect2.bottom + 10
    });
    document.dispatchEvent(pm);

    // Pointer up
    var pu = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: rect2.left + 10,
      clientY: rect2.bottom + 10
    });
    document.dispatchEvent(pu);

    var rowsAfter = [].slice.call(sh.querySelectorAll(".hv-tool-tog"));
    var newOrder = rowsAfter.map(function(r) { return r.getAttribute("data-tool"); });
    var savedOrder = localStorage.getItem("smd_home_tools_order");

    return JSON.stringify({
      isDraggingAfterDown: isDraggingAfterDown,
      initialOrder: initialOrder,
      newOrder: newOrder,
      domChanged: initialOrder[0] !== newOrder[0],
      savedOrder: savedOrder
    });
  `);

  // Step 2c assertion: DOM order of .hv-tool-tog rows changed
  ok(dragSimResult.domChanged === true,
    "2c: DOM order of .hv-tool-tog rows changed accordingly after drag on .hv-drag handle");
  if (!dragSimResult.domChanged) {
    console.log("   -> EXPLANATION: wireHomeDragReorder(root) was attached to #homeV2 in home.js (line 1959).");
    console.log("      #hvSheet is appended to document.body (line 1983), NOT inside #homeV2.");
    console.log("      Pointer events on #hvSheet .hv-drag bubble to document.body and never reach #homeV2,");
    console.log("      so the pointerdown listener never executes (isDraggingAfterDown: " + dragSimResult.isDraggingAfterDown + ").");
  }

  // Step 2d assertion: localStorage["smd_home_tools_order"] updated
  ok(!!dragSimResult.savedOrder,
    "2d: localStorage['smd_home_tools_order'] was updated to reflect the new order from sheet drag");

  // Close sheet to test home grid
  await ev(`
    var scrim = document.getElementById("hvScrim");
    if (scrim) scrim.click();
    var sh = document.getElementById("hvSheet");
    if (sh) sh.classList.remove("on");
    return true;
  `);
  await sleep(400);

  // Step 2f: Home grid long-press and drag-to-reorder
  const gridTilesBefore = await J(`
    var grid = document.getElementById("rnavToolsGrid");
    if (!grid) return JSON.stringify({ err: "no rnavToolsGrid" });
    var tiles = [].slice.call(grid.querySelectorAll(".rnav-tile:not(.addtool)"));
    return JSON.stringify({
      count: tiles.length,
      order: tiles.map(function(t) { return t.getAttribute("data-act"); })
    });
  `);
  ok(gridTilesBefore.count >= 2, `2f: home grid has ${gridTilesBefore.count} tiles`);

  // Simulate long-press (pointerdown on tile 0, wait > 500ms)
  await ev(`
    var grid = document.getElementById("rnavToolsGrid");
    var tile0 = grid.querySelectorAll(".rnav-tile:not(.addtool)")[0];
    var r = tile0.getBoundingClientRect();
    var pd = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2
    });
    tile0.dispatchEvent(pd);
    return true;
  `);

  // Wait 550ms using real sleep (not fake timers)
  await sleep(550);

  const gridReorderingState = await J(`
    var grid = document.getElementById("rnavToolsGrid");
    var tile0 = grid.querySelectorAll(".rnav-tile:not(.addtool)")[0];
    return JSON.stringify({
      gridHasReorderingClass: grid.classList.contains("reordering"),
      tileHasDraggingClass: tile0.classList.contains("dragging")
    });
  `);
  ok(gridReorderingState.gridHasReorderingClass === true,
    "2f: long-press (>500ms) arms reordering mode: home grid gains class 'reordering'");
  ok(gridReorderingState.tileHasDraggingClass === true,
    "2f: long-press (>500ms) arms drag: pressed tile gains class 'dragging'");

  // Drag tile 0 over tile 1 and pointerup
  const gridDragResult = await J(`
    var grid = document.getElementById("rnavToolsGrid");
    var tiles = [].slice.call(grid.querySelectorAll(".rnav-tile:not(.addtool)"));
    var tile0 = tiles[0];
    var tile1 = tiles[1];
    var r1 = tile1.getBoundingClientRect();

    // Drag tile 0 over tile 1
    var pm = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: r1.left + r1.width / 2,
      clientY: r1.top + r1.height / 2
    });
    document.dispatchEvent(pm);

    // Release pointer
    var pu = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: r1.left + r1.width / 2,
      clientY: r1.top + r1.height / 2
    });
    document.dispatchEvent(pu);

    var tilesAfter = [].slice.call(grid.querySelectorAll(".rnav-tile:not(.addtool)"));
    var newOrder = tilesAfter.map(function(t) { return t.getAttribute("data-act"); });
    var savedOrder = localStorage.getItem("smd_home_tools_order");

    return JSON.stringify({
      initialFirst: tiles[0].getAttribute("data-act"),
      newFirst: tilesAfter[0].getAttribute("data-act"),
      initialOrder: tiles.map(function(t) { return t.getAttribute("data-act"); }),
      newOrder: newOrder,
      savedOrder: savedOrder
    });
  `);

  ok(gridDragResult.initialFirst !== gridDragResult.newFirst,
    `2f: tile order changed in home grid (was '${gridDragResult.initialFirst}', now '${gridDragResult.newFirst}')`);
  ok(!!gridDragResult.savedOrder,
    `2f: localStorage['smd_home_tools_order'] was updated by grid reorder (${gridDragResult.savedOrder})`);

  // Exit reorder mode via tap-anywhere on an element with [data-act] (home.js line 1961/1965: tap while in reorder mode exits it instead of navigating)
  const exitReorder = await J(`
    var grid = document.getElementById("rnavToolsGrid");
    var tile = grid ? grid.querySelector(".rnav-tile:not(.addtool)") : null;
    if (tile) tile.click();
    return JSON.stringify({
      reorderingAfterClick: grid ? grid.classList.contains("reordering") : false
    });
  `);
  ok(exitReorder.reorderingAfterClick === false,
    "2f tap-to-exit: tap exits reorder mode and clears 'reordering' class from grid");

  // Step 2e: Verify persistence across reopen / re-render
  // Now that reorder mode is exited, clicking Customize tools will invoke openToolsCustomize()
  const persistCheck = await J(`
    // Reopen Customize tools sheet
    var btn = document.querySelector('[data-act="customizetools"]');
    if (btn) btn.click();
    var sh = document.getElementById("hvSheet");
    var rows = sh ? [].slice.call(sh.querySelectorAll(".hv-tool-tog")) : [];
    var rowTools = rows.map(function(r) { return r.getAttribute("data-tool"); });

    // Also check grid tiles
    var grid = document.getElementById("rnavToolsGrid");
    var gridTiles = grid ? [].slice.call(grid.querySelectorAll(".rnav-tile:not(.addtool)")) : [];
    var gridTools = gridTiles.map(function(t) { return t.getAttribute("data-act"); });

    var savedOrder = JSON.parse(localStorage.getItem("smd_home_tools_order") || "[]");

    // The saved first tool ('pglog') should match the first row in Customize sheet and first tile in grid
    var sheetMatchesSaved = savedOrder.length > 0 && rowTools[0] === savedOrder[0];
    var gridMatchesSaved = savedOrder.length > 0 && gridTools[0] === savedOrder[0];

    return JSON.stringify({
      savedFirst: savedOrder[0],
      sheetFirst: rowTools[0],
      gridFirst: gridTools[0],
      sheetMatchesSaved: sheetMatchesSaved,
      gridMatchesSaved: gridMatchesSaved
    });
  `);

  ok(persistCheck.sheetMatchesSaved === true,
    `2e: reopened Customize sheet renders rows in saved order via orderedHomeTools() (first row '${persistCheck.sheetFirst}')`);
  ok(persistCheck.gridMatchesSaved === true,
    `2e: home grid tiles render in saved order via orderedHomeTools() (first tile '${persistCheck.gridFirst}')`);

  console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS");
} catch (e) {
  console.error("FAIL test harness execution error:", e);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
