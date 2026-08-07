// test/queue-notify.test.mjs — pure notification tier logic (monotonic, idempotent, no back-sends).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingEvent } from "../functions/_queue_notify.js";

test("fires the right tier by position", () => {
  assert.equal(pendingEvent({ position: 1 }), "next");
  assert.equal(pendingEvent({ position: 2 }), "ahead2");
  assert.equal(pendingEvent({ position: 5 }), "ahead5");
  assert.equal(pendingEvent({ position: 9 }), "");        // beyond the early threshold
  assert.equal(pendingEvent({ position: 0 }), "");        // not queued (in consult / terminal)
});

test("monotonic stage: a patient added at position 2 sends ahead2 and NEVER back-sends ahead5", () => {
  assert.equal(pendingEvent({ position: 2, n_stage: 0 }), "ahead2");
  assert.equal(pendingEvent({ position: 2, n_stage: 2 }), "");   // ahead2 already sent → nothing (no ahead5!)
});

test("idempotent as the patient advances 5 -> 2 -> 1", () => {
  assert.equal(pendingEvent({ position: 5, n_stage: 0 }), "ahead5");
  assert.equal(pendingEvent({ position: 5, n_stage: 1 }), "");   // ahead5 sent, still at 5
  assert.equal(pendingEvent({ position: 2, n_stage: 1 }), "ahead2");
  assert.equal(pendingEvent({ position: 2, n_stage: 2 }), "");
  assert.equal(pendingEvent({ position: 1, n_stage: 2 }), "next");
  assert.equal(pendingEvent({ position: 1, n_stage: 3 }), "");   // fully notified
});

test("custom thresholds", () => {
  assert.equal(pendingEvent({ position: 3, n_stage: 0 }, { early: 3, prep: 1 }), "ahead5");
  assert.equal(pendingEvent({ position: 4, n_stage: 0 }, { early: 3, prep: 1 }), "");
});
