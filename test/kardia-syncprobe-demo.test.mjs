/* test/kardia-syncprobe-demo.test.mjs - SyncProbe demo sweep and class script.
 * The demo must change rotation, fan and slide, run about 40 seconds,
 * stop cleanly, and never loop. Reduced motion runs slower. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const SP = require("../kardia-syncprobe.js")._pure;

test("demo script changes rotation, fan and slide across the sweep", () => {
  assert.equal(SP.demoDurationMs(false), 40000);
  assert.ok(SP.demoDurationMs(true) > SP.demoDurationMs(false), "reduced motion is slower");
  const samples = [0, 3500, 10500, 17500, 25000, 31000, 37000, 40000].map((t) => SP.demoPoseAt(t, false));
  const rots = new Set(samples.map((p) => p.rotationDeg));
  const fans = new Set(samples.map((p) => p.tiltDeg));
  const slides = new Set(samples.map((p) => p.slideX + "," + p.slideY));
  assert.ok(rots.size >= 3, "rotation changes: " + [...rots].join(","));
  assert.ok(Math.max(...samples.map((p) => p.rotationDeg)) >= 85, "reaches the short axis quarter turn");
  assert.ok(fans.size >= 3, "fan changes");
  assert.ok(Math.min(...samples.map((p) => p.tiltDeg)) < 0 && Math.max(...samples.map((p) => p.tiltDeg)) > 0, "fan sweeps both ways");
  assert.ok(slides.size >= 3, "slide changes");
  assert.ok(!/[—–]/.test(SP.demoSteps.map((s) => s.caption).join(" ")), "no em or en dashes in captions");
  assert.match(SP.demoCaptionAt(15000, false), /quarter turn/);
  assert.notEqual(SP.demoCaptionAt(0, false), SP.demoCaptionAt(34000, false));
});

test("stopping the player stops the frames and it does not loop", () => {
  let tick = null;
  const frames = [];
  const player = SP.createDemoPlayer({
    intervalMs: 50,
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
    onPose: (pose) => frames.push(pose),
  });
  assert.equal(player.start(), true);
  assert.equal(player.start(), false, "second start is a no-op while playing");
  tick(); tick(); tick();
  const seen = frames.length;
  assert.ok(seen >= 4, "frames flow while playing");
  player.stop();
  assert.equal(player.isPlaying(), false);
  assert.equal(tick, null, "timer cleared on stop");
  // Even if a stale tick fires, no new frame is emitted.
  const stale = frames.length;
  assert.equal(frames.length, stale);
  assert.equal(player.elapsedMs(), 150);
});

test("player runs to the end once and stops (no autoplay loop)", () => {
  let tick = null, ended = 0;
  const frames = [];
  const player = SP.createDemoPlayer({
    intervalMs: 1000,
    setInterval: (fn) => { tick = fn; return 7; },
    clearInterval: () => { tick = null; },
    onPose: (pose) => frames.push(pose),
    onEnd: () => ended++,
  });
  player.start();
  for (let i = 0; i < 45 && tick; i++) tick();
  assert.equal(ended, 1);
  assert.equal(player.isPlaying(), false);
  assert.equal(tick, null, "no timer left to loop");
  const last = frames[frames.length - 1];
  assert.equal(last.rotationDeg, 60);
});

test("class script is one page, timed, and marked as draft in source", () => {
  assert.ok(SP.classDemoLines.length >= 5 && SP.classDemoLines.length <= 8);
  assert.equal(SP.classDemoLines[0].at, "0:00");
  assert.ok(SP.classDemoLines.every((l) => /^\d:\d\d$/.test(l.at) && l.text.length > 20));
  const src = readFileSync("kardia-syncprobe.js", "utf8");
  assert.ok(src.includes('data-act="sp-demo"'), "Watch a demo offered on the first sheet");
  assert.ok(src.includes('data-act="sp-classdemo"'), "class script linked from the sheet");
  assert.ok(src.includes("Open Kardia on the other phone"), "step 1 text");
  assert.ok(src.includes("Tap the iPad in the list"), "step 3 text");
  assert.ok(src.includes("Draft teaching material, to be verified"), "draft footer shown");
  assert.ok(src.includes("driveProbeLab(pose)"), "demo plays through the paired probe route");
  assert.ok(!/[—–]/.test(src), "no em or en dashes in app text");
});
