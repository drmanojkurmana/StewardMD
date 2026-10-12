import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../dynamic-notify.js");

test("spring converges to target and overshoots once (underdamped)", () => {
  let x = 0, v = 0, peak = 0, steps = 0;
  while (!D.settled(x, v, 100) && steps < 2400) { const r = D.springStep(x, v, 100, 1 / 240); x = r.x; v = r.v; peak = Math.max(peak, x); steps++; }
  assert.ok(D.settled(x, v, 100), "settles");
  assert.ok(steps < 240 * 1.2, "settles within ~1.2s, took " + steps);
  assert.ok(peak > 100 && peak < 106, "small overshoot, peak " + peak.toFixed(2));
});

test("initial velocity carries: a flick moves further before returning", () => {
  const run = (v0) => { let x = 0, v = v0, max = 0; for (let i = 0; i < 120; i++) { const r = D.springStep(x, v, 0, 1 / 240); x = r.x; v = r.v; max = Math.min(max, x); } return max; };
  assert.ok(run(-1500) < run(-300));
});

test("splitText: newline, em-dash push fallback, single line", () => {
  assert.deepEqual(D.splitText("New lab\nK 6.1 for Bed 4"), { title: "New lab", message: "K 6.1 for Bed 4" });
  assert.deepEqual(D.splitText("New lab — K 6.1"), { title: "New lab", message: "K 6.1" });
  assert.deepEqual(D.splitText("Copied"), { title: "Copied", message: "" });
});

test("kindOf picks an icon from the text", () => {
  assert.equal(D.kindOf("Saved to your notes"), "success");
  assert.equal(D.kindOf("Could not reach the server"), "error");
  assert.equal(D.kindOf("Couldn't save"), "error");
  assert.equal(D.kindOf("Token expires soon"), "warning");
  assert.equal(D.kindOf("Ward list refreshed"), "info");
});

test("swipe up dismisses by distance or flick; down never does", () => {
  assert.equal(D.swipeDismiss(-40, 0), true);
  assert.equal(D.swipeDismiss(-10, -900), true);
  assert.equal(D.swipeDismiss(-10, -100), false);
  assert.equal(D.swipeDismiss(80, 2000), false);
  assert.equal(D.dampen(-30), -30);
  assert.ok(D.dampen(100) < 100 && D.dampen(100) > 0);
});

test("geometry: sits on the real island, floats elsewhere, card fits the phone", () => {
  assert.equal(D.pillTop(59), 11);          // iPhone with Dynamic Island
  assert.equal(D.pillTop(0), 8);
  assert.equal(D.cardWidth(390), 366);
  assert.equal(D.cardWidth(1024), 420);
  assert.equal(D.durationFor("hi", ""), 2600);
  assert.equal(D.durationFor("x".repeat(400), ""), 6500);
});
