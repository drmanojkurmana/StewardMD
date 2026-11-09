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
const sb = new Function(pure + "; return { swipeCommit: swipeCommit, settleMs: settleMs, settleTransition: settleTransition };")();

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

test("swipe-back depth-off settle keeps the old .18s ease, even for a slow release", () => {
  assert.equal(sb.settleTransition(false, sb.settleMs(100, 0.2)), ".18s ease"); // slow release: settleMs says 300, depth-off ignores it
  assert.equal(sb.settleTransition(false), ".18s ease");
  assert.equal(sb.settleTransition(true, 150), "0.15s cubic-bezier(0.32,0.72,0,1)");
  assert.equal(sb.settleTransition(true), "0.26s cubic-bezier(0.32,0.72,0,1)");
});

// A fake SMD_SPRING.animate with the real contract: stop() kills the frame, no onDone.
function fakeSpring() {
  const live = [];
  function animate(o) {
    const s = { o, x: o.from, v: o.velocity || 0, dead: false };
    s.stop = () => { s.dead = true; };
    live.push(s);
    return s.stop;
  }
  function run(ms) {
    const frames = Math.round(ms / (1000 / 60));
    for (let f = 0; f < frames; f++) for (const s of live) {
      if (s.dead) continue;
      for (let i = 0; i < 4; i++) { const r = spring.step(s.x, s.v, s.o.to, 1 / 240, s.o.stiffness || 420, s.o.damping || 34); s.x = r.x; s.v = r.v; }
      if (spring.settled(s.x, s.v, s.o.to)) { s.dead = true; s.o.onUpdate(s.o.to); s.o.onDone(); } else s.o.onUpdate(s.x);
    }
  }
  return { animate, run };
}
function settling() {
  const fs = fakeSpring(), ctl = spring.makeSettle(fs.animate), log = { done: 0, last: null };
  ctl.start({ from: 0, to: 100, velocity: 0, stiffness: 420, damping: 34, onUpdate: (x) => { log.last = x; }, onDone: () => { log.done++; } });
  fs.run(50); // mid-flight
  return { fs, ctl, log };
}

test("settle catch: a touch elsewhere does nothing, the settle finishes, completion once", () => {
  const { fs, ctl, log } = settling();
  assert.equal(ctl.touch(false), "ignore");
  fs.run(3000);
  assert.equal(log.done, 1);
  assert.equal(log.last, 100); // reached its target: nothing left partway
});

test("settle catch: a tap on the element holds it, then resumes to the original target", () => {
  const { fs, ctl, log } = settling();
  assert.equal(ctl.touch(true), "hold");
  const held = ctl.heldPos();
  assert.ok(held > 0 && held < 100, "held mid-flight, not snapped anywhere: " + held);
  fs.run(500); // time passes while the finger is down: nothing moves, nothing completes
  assert.equal(log.last, held);
  assert.equal(log.done, 0);
  assert.equal(ctl.resume(), true);
  fs.run(3000);
  assert.equal(log.done, 1); // original completion, exactly once
  assert.equal(log.last, 100);
  assert.equal(ctl.resume(), false);
  assert.equal(log.done, 1);
});

test("settle catch: catch then drag supersedes; the drag's settle completes, the old one never does", () => {
  const { fs, ctl, log } = settling();
  assert.equal(ctl.touch(true), "hold");
  const held = ctl.heldPos();
  ctl.supersede();
  assert.equal(ctl.resume(), false, "a superseded settle must not resume");
  const log2 = { done: 0, last: null };
  ctl.start({ from: held, to: 0, velocity: 0, stiffness: 420, damping: 34, onUpdate: (x) => { log2.last = x; }, onDone: () => { log2.done++; } });
  fs.run(3000);
  assert.equal(log.done, 0);
  assert.equal(log2.done, 1);
  assert.equal(log2.last, 0);
});

test("settle catch: a new settle supersedes one in flight; only the new completion runs", () => {
  const { fs, ctl, log } = settling();
  const log2 = { done: 0, last: null };
  ctl.start({ from: log.last, to: 0, velocity: 0, stiffness: 420, damping: 34, onUpdate: (x) => { log2.last = x; }, onDone: () => { log2.done++; } });
  fs.run(3000);
  assert.equal(log.done, 0);
  assert.equal(log2.done, 1);
  assert.equal(log2.last, 0);
});

test("settle catch: reduced motion completes synchronously, so there is nothing to catch", () => {
  const sync = (o) => { o.onUpdate(o.to); o.onDone(); return () => {}; };
  const ctl = spring.makeSettle(sync);
  let done = 0, last = null;
  ctl.start({ from: 0, to: 100, velocity: 0, onUpdate: (x) => { last = x; }, onDone: () => { done++; } });
  assert.equal(done, 1);
  assert.equal(last, 100);
  assert.equal(ctl.flying(), false);
  assert.equal(ctl.touch(true), "none");
});

test("prep sheet: the dismiss flight is only caught on the sheet, and cancel never blocks close", () => {
  const src = fs.readFileSync(new URL("../prep.js", import.meta.url), "utf8");
  assert.ok(src.includes("fsh.contains(e.target)"), "pointerdown elsewhere must not cancel the flight");
  assert.ok(!src.includes("once.done = 1; }; G.setTimeout"), "oncancel must not suppress the deferred close");
  assert.ok(src.includes("resumeHeld(h)"), "a tap on a caught sheet resumes the original settle");
});

test("hit targets: visuals stay small, touch areas grow invisibly", () => {
  const az = fs.readFileSync(new URL("../az-scrubber.js", import.meta.url), "utf8");
  assert.ok(az.includes("width:22px;touch-action:none"), "az strip visible width back to 22px");
  assert.ok(az.includes("#smdAzStrip::before") && az.includes("left:-11px;right:-11px"), "az strip has a 44px invisible hitbox");
  const back = fs.readFileSync(new URL("../swipe-back.js", import.meta.url), "utf8");
  assert.ok(back.includes("width:38px;height:38px"), "back button visible size back to 38px");
  assert.ok(back.includes("#smdTopBack::after") && back.includes("inset:-3px"), "back button has a 44px invisible hitbox");
});

test("spring simulate settles at target with seeded velocity", () => {
  const sim = spring.simulate(0, 100, 500, 420, 34);
  assert.ok(sim.steps > 0 && sim.path.length > 0);
  assert.ok(Math.abs(sim.path[sim.path.length - 1] - 100) < 1);
});
