/* test/maik-replay-latency.test.mjs — don't make a slow answer slower with a cosmetic animation.
 *
 * REPORTED 2026-08-24 (screenshot): MaiK Cloud, "first token 10.5s · full answer 13.9s".
 *
 * That label was misleading. On NATIVE there is no live stream at all - reasoning.js
 * explainGroundedStream() does `if (isNative) return fallback();`, which fetches the WHOLE answer and
 * then types it out with replay(). So "first token 10.5s" was really "the server finished at 10.5s",
 * and the 3.4s after it was a typewriter animation over text the app already had in hand.
 *
 * replay() capped itself at a flat ~260 frames (~4.3s @60fps) regardless of how long the clinician had
 * already waited. The reveal is cosmetic, so it is now budgeted against the wait.
 *
 * node --test test/maik-replay-latency.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REASONING = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");

// Lift replay() out and drive it with a fake rAF so the pacing is measurable without a browser.
function makeReplay() {
  const i = REASONING.indexOf("function replay(res, waitedMs)");
  assert.ok(i > -1, "replay must take the wait");
  const body = REASONING.slice(i, REASONING.indexOf("\n      }\n", i) + 9);
  let frames = 0;
  const win = { requestAnimationFrame: (f) => { frames++; setTimeout(f, 0); } };
  const fn = new Function("window", "onDelta", body + "\nreturn replay;");
  return {
    run: (text, waited) => {
      frames = 0;
      const replay = fn(win, () => {});
      return replay({ text }, waited).then(() => frames);
    },
    framesOf: () => frames
  };
}
const R = makeReplay();
const LONG = Array.from({ length: 800 }, (_, i) => "word" + i).join(" ");

test("REGRESSION: the flat ~260-frame ceiling is gone", () => {
  const i = REASONING.indexOf("function replay(res, waitedMs)");
  const blk = REASONING.slice(i, i + 1800);
  assert.equal(/words\.length \/ 260/.test(blk), false, "the fixed ceiling must be gone");
  assert.match(blk, /frames = w > 6000/, "the budget must depend on the wait");
});

test("after a long server wait the answer appears almost immediately", async () => {
  const frames = await R.run(LONG, 10500);   // the reported case
  assert.ok(frames <= 32, "expected ~30 frames (~0.5s), got " + frames);
});

test("a fast answer still types out - the feel is kept where it costs nothing", async () => {
  const frames = await R.run(LONG, 400);
  assert.ok(frames > 100, "a quick answer should still reveal progressively, got " + frames);
  assert.ok(frames <= 155, "but never more than the ~2.5s budget, got " + frames);
});

test("the animation scales monotonically with how long the user waited", async () => {
  const fast = await R.run(LONG, 500);
  const mid = await R.run(LONG, 4000);
  const slow = await R.run(LONG, 9000);
  assert.ok(fast > mid && mid > slow, `expected fast>mid>slow, got ${fast} ${mid} ${slow}`);
});

test("the full text is still delivered exactly, never truncated to save time", async () => {
  const i = REASONING.indexOf("function replay(res, waitedMs)");
  const body = REASONING.slice(i, REASONING.indexOf("\n      }\n", i) + 9);
  let last = "";
  const win = { requestAnimationFrame: (f) => setTimeout(f, 0) };
  const replay = new Function("window", "onDelta", body + "\nreturn replay;")(win, (acc) => { last = acc; });
  await replay({ text: LONG }, 10000);
  assert.equal(last, LONG, "every word must still arrive - this is a pacing change, not a truncation");
});

test("a short answer is not padded out", async () => {
  const frames = await R.run("Paracetamol 650 mg orally every 6 hours.", 200);
  assert.ok(frames <= 12, "a one-line answer must not be animated for seconds, got " + frames);
});

/* ---------------------------------------------------------------- honest instrumentation */
test("the response is flagged as replayed, so nothing can call it a stream", () => {
  const i = REASONING.indexOf("function replay(res, waitedMs)");
  assert.match(REASONING.slice(i, i + 600), /res\.replayed = true/);
});

test("REGRESSION: the timing label no longer says 'first token' when nothing streamed", () => {
  assert.match(HOME, /_replayed \? "answer " : "first token "/,
    "a replayed answer must not be labelled first-token");
  assert.match(HOME, /_replayed \? "shown " : "full answer "/,
    "and the total must read as display time, not generation time");
});
