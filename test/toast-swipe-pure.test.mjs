import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../toast.js");

test("toast duration clamp 2.4-6.5s", () => {
  assert.equal(T.duration("hi"), 2400);
  assert.equal(T.duration("x".repeat(500)), 6500);
  assert.equal(T.duration("x".repeat(60)), 3300);
});

test("timer pauses while hidden and resumes with the remaining time", () => {
  let s = { remaining: 3000, t0: 0, running: false };
  s = T.step(s, true, 1000);
  assert.equal(s.running, true);
  s = T.step(s, false, 2200);                      // hidden after 1200ms
  assert.deepEqual(s, { remaining: 1800, t0: 0, running: false });
  assert.equal(T.step(s, false, 9000), s);         // stays paused, nothing banked
  const r = T.step(s, true, 9000);                 // resume
  assert.equal(r.remaining, 1800);
  assert.equal(r.running, true);
  assert.equal(T.step(r, true, 9500), r);          // no-op while running
});

test("stack slots: newest in front, 3 visible, rest queued", () => {
  const k = [0, 1, 2, 3, 7].map(T.slot);
  assert.equal(k[0].s, 1);
  assert.equal(k[0].o, 1);
  assert.ok(k[1].s < k[0].s && k[2].s < k[1].s, "older scaled down");
  assert.ok(k[1].y < k[0].y && k[2].y < k[1].y, "older offset up");
  assert.deepEqual(k.map((x) => x.vis), [true, true, true, false, false]);
  assert.equal(k[3].o, 0);
});

test("swipe dismiss: distance, flick velocity, wrong direction, damping", () => {
  assert.equal(T.swipeDismiss(60, 1000, 40), true);     // far enough
  assert.equal(T.swipeDismiss(20, 1000, 40), false);    // short and slow
  assert.equal(T.swipeDismiss(20, 100, 40), true);      // 0.2 px/ms flick, short distance
  assert.equal(T.swipeDismiss(-80, 50, 40), false);     // against the entry edge never dismisses
  assert.equal(T.dampen(50), 50);
  assert.ok(Math.abs(T.dampen(-100)) < 50, "damped upward drag");
});

// swipe-back.js: the commit rule is delimited so it can be tested without a DOM.
const src = fs.readFileSync(new URL("../swipe-back.js", import.meta.url), "utf8");
const m = src.match(/@pure-begin \*\/([\s\S]*?)\/\* @pure-end/);
const swipeCommit = new Function(m[1] + "; return swipeCommit;")();

test("edge swipe commit: velocity and distance, legacy rule when depth is off", () => {
  const w = 400;
  assert.equal(swipeCommit(30, 120, 0.5, w, true), true);    // quick flick, short
  assert.equal(swipeCommit(30, 900, 0.05, w, true), false);  // slow short drag
  assert.equal(swipeCommit(200, 900, 0.1, w, true), true);   // past 40% width
  assert.equal(swipeCommit(300, 500, -0.6, w, true), false); // flicked back toward the edge
  assert.equal(swipeCommit(80, 300, 0.1, w, true), true);    // 70px/800ms rule kept
  assert.equal(swipeCommit(30, 120, 0.5, w, false), false);  // old rule ignores velocity
  assert.equal(swipeCommit(130, 900, 0, w, false), true);    // 32% width
});
