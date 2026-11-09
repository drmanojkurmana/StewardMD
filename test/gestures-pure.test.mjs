import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const sheet = require("../sheet-drag.js");
const swipe = require("../swipe-actions.js");
const pull = require("../pull-refresh.js");
const toast = require("../toast.js");
const spring = require("../smd-spring.js");

// Extract swipe-back's @pure block (the file itself needs a browser window).
const sbSrc = fs.readFileSync(new URL("../swipe-back.js", import.meta.url), "utf8");
const pure = sbSrc.match(/\/\* @pure-begin \*\/([\s\S]*?)\/\* @pure-end \*\//)[1];
const sb = new Function(pure + "; return { swipeCommit: swipeCommit, settleMs: settleMs };")();

test("sheet dismiss: distance threshold OR fast flick", () => {
  assert.equal(sheet.shouldDismiss(200, 0, 400), true); // >28% of 400
  assert.equal(sheet.shouldDismiss(50, 0, 400), false); // short + slow
  assert.equal(sheet.shouldDismiss(30, 800, 400), true); // flick >700px/s
  assert.equal(sheet.shouldDismiss(5, 900, 400), false); // flick needs >12px travel
});

test("sheet rubber-band: 1:1 downward, resisted upward", () => {
  assert.equal(sheet.rubber(50), 50);
  assert.ok(Math.abs(sheet.rubber(-100) + Math.sqrt(100) * 2.6) < 1e-9);
  assert.ok(Math.abs(sheet.rubber(-25)) < 25, "past the edge moves less than the finger");
});

test("swipe-actions lock: 40% distance OR flick", () => {
  assert.equal(swipe.shouldLock(-100, 0, 200), true);
  assert.equal(swipe.shouldLock(-30, 0, 200), false);
  assert.equal(swipe.shouldLock(-30, -500, 200), true);
  assert.equal(swipe.offset(10, 200), 0, "rightward never reveals");
  assert.ok(Math.abs(swipe.offset(-300, 200)) < 300, "past tray width rubber-bands");
});

test("pull-refresh resistance saturates and triggers at 72px of pull", () => {
  assert.equal(pull.resist(0), 0);
  assert.ok(pull.resist(40) > 0 && pull.resist(40) < 40);
  assert.ok(pull.resist(10000) <= pull.MAX);
  assert.equal(pull.triggered(pull.TRIGGER), true);
  assert.equal(pull.triggered(pull.TRIGGER - 1), false);
});

test("toast exit duration is seeded with swipe speed", () => {
  assert.equal(toast.exitMs(100, 100), 90); // 1 px/ms flick
  assert.equal(toast.exitMs(30, 100), 120); // 0.3 px/ms
  assert.equal(toast.exitMs(10, 100), 150); // slow drag keeps default
});

test("swipe-back commit: distance OR flick, back-flick cancels", () => {
  assert.equal(sb.swipeCommit(200, 900, 0, 400, true), true);
  assert.equal(sb.swipeCommit(50, 900, 0, 400, true), false);
  assert.equal(sb.swipeCommit(30, 300, 0.5, 400, true), true);
  assert.equal(sb.swipeCommit(200, 300, -0.5, 400, true), false);
});

test("swipe-back settle duration follows release velocity", () => {
  assert.equal(sb.settleMs(300, 0), 260); // no velocity: old timing
  assert.equal(sb.settleMs(100, 1), 110); // fast flick clamps to min
  assert.equal(sb.settleMs(100, 0.2), 300); // slow clamps to max
  assert.equal(sb.settleMs(150, 1), 150); // distance / speed
});

test("spring simulate settles at target with seeded velocity", () => {
  const sim = spring.simulate(0, 100, 500, 420, 34);
  assert.ok(sim.steps > 0 && sim.path.length > 0);
  assert.ok(Math.abs(sim.path[sim.path.length - 1] - 100) < 1);
});
