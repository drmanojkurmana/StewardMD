/* OPD "Send for Tests" lab flow: the at_diagnostics state between consultation and return.
 * A patient sent for tests leaves the room (not queued, so the doctor can call next) but stays on the
 * room board with a Tests Done action; returning flags them priority 1 (Results Ready).
 * node --test test/opd-lab-flow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS, canTransition, isQueued, orderQueue, orderRoomView, opdPulse } from "../functions/_queue_eta.js";

test("at_diagnostics is a real ticket status", () => {
  assert.ok(STATUS.indexOf("at_diagnostics") > -1);
});

test("Send for Tests: an active consultation can move out to diagnostics", () => {
  assert.equal(canTransition("in_consultation", "at_diagnostics"), true);
});

test("Tests Done: a lab ticket returns to waiting, or straight back into the room", () => {
  assert.equal(canTransition("at_diagnostics", "waiting"), true);
  assert.equal(canTransition("at_diagnostics", "called"), true);
  assert.equal(canTransition("at_diagnostics", "in_consultation"), true);
});

test("a lab ticket cannot skip the queue or finish from the lab", () => {
  assert.equal(canTransition("at_diagnostics", "completed"), false);
  assert.equal(canTransition("waiting", "at_diagnostics"), false, "only an active consultation sends for tests");
  assert.equal(canTransition("registered", "at_diagnostics"), false);
});

test("a patient at diagnostics is out of the calling queue, so the doctor can call next", () => {
  assert.equal(isQueued("at_diagnostics"), false);
  const q = orderQueue([
    { id: "lab", status: "at_diagnostics", priority: 0, registeredAt: 10 },
    { id: "wait", status: "waiting", priority: 0, registeredAt: 20 },
  ]);
  assert.deepEqual(q.map((t) => t.id), ["wait"]);
});

test("the room board still shows the lab patient (with Tests Done), after the queue", () => {
  const v = orderRoomView([
    { id: "wait", status: "waiting", priority: 0, registeredAt: 20 },
    { id: "lab", status: "at_diagnostics", priority: 0, registeredAt: 10 },
    { id: "cur", status: "in_consultation", priority: 0, registeredAt: 5 },
  ]);
  assert.deepEqual(v.map((t) => t.id), ["cur", "wait", "lab"]);
});

test("the OPD pulse counts lab patients as held work, not as the waiting hall", () => {
  const p = opdPulse([{ id: "lab", status: "at_diagnostics", registeredAt: Date.now() - 60000 }], Date.now());
  assert.equal(p.held, 1);
  assert.equal(p.waiting, 0);
});
