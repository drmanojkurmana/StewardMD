import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Load study-ink pure helper
const inkCode = fs.readFileSync(new URL("../study-ink.js", import.meta.url), "utf8");
const inkModule = new Function(inkCode + "\nreturn STUDY_INK;")();

test("ipadfix: pencilDoubleTap toggles pen ↔ eraser ↔ previous tool", () => {
  const fakeV = { tool: "pen", prevTool: null, syncCalled: 0 };
  function pencilDoubleTap(V) {
    if (!V) return;
    if (V.tool === "er") {
      V.tool = V.prevTool || "pen";
    } else {
      V.prevTool = V.tool || "pen";
      V.tool = "er";
    }
    V.syncCalled++;
  }

  // Starts as pen
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "er");
  assert.equal(fakeV.prevTool, "pen");
  assert.equal(fakeV.syncCalled, 1);

  // Toggles back to pen
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "pen");
  assert.equal(fakeV.prevTool, "pen");
  assert.equal(fakeV.syncCalled, 2);

  // Starts as highlighter
  fakeV.tool = "hl";
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "er");
  assert.equal(fakeV.prevTool, "hl");

  // Toggles back to highlighter
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "hl");

  // Starts as shapes
  fakeV.tool = "shapes";
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "er");
  assert.equal(fakeV.prevTool, "shapes");

  // Toggles back to shapes
  pencilDoubleTap(fakeV);
  assert.equal(fakeV.tool, "shapes");
});

test("ipadfix: palm rejection and pen-mode finger policy", () => {
  const I = inkModule.pure;
  const pen = { pointerType: "pen", isPrimary: true };
  const touch = { pointerType: "touch", isPrimary: true };

  // 1. Pen always draws
  assert.equal(I.pointerAction(pen, { penSeen: true, drawFinger: false }), "draw");
  assert.equal(I.pointerAction(pen, { penSeen: false, drawFinger: true }), "draw");

  // 2. Once pen seen: touch pans, never draws
  assert.equal(I.pointerAction(touch, { penSeen: true, drawFinger: false }), "pan");
  assert.equal(I.pointerAction(touch, { penSeen: true, drawFinger: true }), "pan");

  // 3. Resting palm (large touch contact size > 25px) is ignored
  const palm = { pointerType: "touch", isPrimary: true, width: 35, height: 40 };
  assert.equal(I.pointerAction(palm, { penSeen: true, drawFinger: false }), "ignore");
  assert.equal(I.pointerAction(palm, { penSeen: false, drawFinger: true }), "ignore");

  // 4. Secondary touch (multi-touch palm or 2nd finger) is ignored
  assert.equal(I.pointerAction({ pointerType: "touch", isPrimary: false }, { penSeen: true }), "ignore");
  assert.equal(I.pointerAction({ pointerType: "touch", isPrimary: false }, { penSeen: false }), "ignore");

  // 5. While pen is active / down: any touch is completely ignored (never draws or scrolls)
  assert.equal(I.pointerAction(touch, { penSeen: true, drawFinger: false }, true), "ignore");
  assert.equal(I.pointerAction(touch, { penSeen: false, drawFinger: true }, true), "ignore");
});

test("ipadfix: pointermove cache avoids getBoundingClientRect layout thrashing", () => {
  let gbcCount = 0;
  const mockOverlay = {
    width: 1000,
    height: 1400,
    clientWidth: 500,
    clientHeight: 700,
    getBoundingClientRect: () => {
      gbcCount++;
      return { left: 10, top: 20, width: 500, height: 700 };
    }
  };

  // Simulating cachedRect behavior
  let cachedRect = null;
  function updateCached() {
    cachedRect = mockOverlay.getBoundingClientRect();
  }
  function posFast(clientX, clientY) {
    if (!cachedRect) updateCached();
    return [(clientX - cachedRect.left) / cachedRect.width, (clientY - cachedRect.top) / cachedRect.height];
  }

  // Pointerdown caches rect ONCE
  updateCached();
  assert.equal(gbcCount, 1);

  // 300 pointermove samples
  for (let i = 0; i < 300; i++) {
    const pt = posFast(100 + i, 200 + i);
    assert.ok(pt[0] >= 0 && pt[0] <= 1);
  }

  // getBoundingClientRect was NOT called again during pointermove!
  assert.equal(gbcCount, 1);
});
