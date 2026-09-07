/* test/wardsynq-infusion.test.mjs — the drip, and the volume nobody watched. Pure.
 *
 * node --test test/wardsynq-infusion.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, STALE_AFTER_HOURS, InfusionRate, rateIdFor, isRunning, volumeSoFar } from "../functions/_wardsynq/infusion.js";

const r = (over) => InfusionRate({ id: "i1", orderId: "rx-1", patientId: "pat", event: "started", ratePerHour: 100, at: "2026-09-07T00:00:00.000Z", ...(over || {}) });
const NOW = Date.parse("2026-09-07T04:00:00.000Z");

test("THE VOLUME IS AN ASSUMPTION, and every total says so", () => {
  const v = volumeSoFar([r()], { nowMs: NOW });
  assert.equal(v.ml, 400, "100 mL/h for four hours");
  assert.equal(v.running, true);
  assert.equal(v.hoursSinceLastCharted, 4);
  /* Nobody watches a pump continuously. If it occluded at 02:00 and nobody noticed until 06:00, this
   * total is four hours too high - and the fluid balance, and then the resuscitation decision, is
   * built on it. */
  assert.match(v.assumption, /assumes the pump has run at 100 mL\/h for the 4 hours/);
  assert.match(v.assumption, /Nobody watches a pump continuously/);
});

test("A LONG SILENCE IS FLAGGED, not smoothed over", () => {
  const long = volumeSoFar([r()], { nowMs: Date.parse("2026-09-07T12:00:00.000Z") });
  assert.equal(long.stale, true);
  assert.match(long.staleDetail, /Check the pump before relying on this volume/);
  assert.ok(STALE_AFTER_HOURS > 0 && 12 > STALE_AFTER_HOURS);
  // Inside the window it is not flagged - a flag on every infusion is a flag nobody reads.
  assert.equal(volumeSoFar([r()], { nowMs: Date.parse("2026-09-07T02:00:00.000Z") }).stale, undefined);
});

test("A STOPPED INFUSION STOPS COUNTING, and only an explicit stop stops it", () => {
  const history = [r(), r({ id: "i2", event: "stopped", at: "2026-09-07T02:00:00.000Z" })];
  const v = volumeSoFar(history, { nowMs: NOW });
  assert.equal(v.ml, 200, "two hours at 100, then nothing");
  assert.equal(v.running, false);
  // A stopped infusion is not extrapolating, so there is no assumption to declare.
  assert.equal(v.assumption, null);
  assert.equal(isRunning(history), false);

  /* AN INFUSION THAT STOPS BEING CHARTED IS UNCHARTED, NOT STOPPED. Nothing stops it by time, by a
   * bag running out, or by a shift ending - those mean opposite things about the patient. */
  assert.equal(isRunning([r()]), true);
  assert.equal(isRunning([]), false);
});

test("a rate change is integrated across segments, and pausing is zero without being a rate", () => {
  const v = volumeSoFar([
    r(),                                                                        // 100 for 1h
    r({ id: "i2", event: "rate-changed", ratePerHour: 50, at: "2026-09-07T01:00:00.000Z" }),  // 50 for 1h
    r({ id: "i3", event: "paused", at: "2026-09-07T02:00:00.000Z" }),           // 0 for 2h
  ], { nowMs: NOW });
  assert.equal(v.ml, 150);
  assert.equal(v.segments.length, 3);
  // A pause is its own event and its rate is forced to zero: a paused drip charted at 100 would keep
  // counting volume into a patient who is not receiving any.
  assert.equal(r({ event: "paused", ratePerHour: 100 }).ratePerHour, 0);
  assert.equal(r({ event: "stopped", ratePerHour: 100 }).ratePerHour, 0);
  assert.deepEqual(EVENTS, ["started", "rate-changed", "paused", "resumed", "stopped"]);
});

test("nothing has been charted is not a volume of zero going in", () => {
  const v = volumeSoFar([], {});
  assert.equal(v.ml, 0);
  assert.equal(v.complete, false);
  assert.match(v.reason, /nothing has been charted/);

  // One entry per order and instant: re-charting the same change is the same entry.
  const id = rateIdFor("rx-1", "2026-09-07T00:00:00.000Z");
  assert.equal(id, rateIdFor("RX/1", "2026-09-07T00:00:00.000Z"));
  assert.notEqual(id, rateIdFor("rx-1", "2026-09-07T01:00:00.000Z"));
  assert.equal(rateIdFor("", "t"), null);
});
