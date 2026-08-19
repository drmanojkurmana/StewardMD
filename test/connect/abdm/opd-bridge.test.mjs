// test/connect/abdm/opd-bridge.test.mjs — scan-and-share -> the OPD queue token.
// The token number a patient is shown by the ABHA app has to be the SAME number the display board shows,
// so this pins the ordering rule rather than the implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { opdOrgFor, tokenNumberFor } from "../../../functions/_connect/abdm/opd-bridge.js";

const t = (id, status, registeredAt) => ({ id, status, registeredAt });

test("the token number is the patient's 1-based place among the waiting, in arrival order", () => {
  const tickets = [t("c", "registered", 300), t("a", "registered", 100), t("b", "registered", 200)];
  assert.equal(tokenNumberFor(tickets, "a"), 1);
  assert.equal(tokenNumberFor(tickets, "b"), 2);
  assert.equal(tokenNumberFor(tickets, "c"), 3);
});

test("finished and cancelled patients do not hold a place in the queue", () => {
  const tickets = [t("done", "complete", 50), t("gone", "cancelled", 60), t("a", "registered", 100), t("b", "registered", 200)];
  assert.equal(tokenNumberFor(tickets, "a"), 1, "a completed consult must not push the next patient's token up");
  assert.equal(tokenNumberFor(tickets, "b"), 2);
});

test("a patient already called or in consultation still holds their place", () => {
  const tickets = [t("a", "in_consultation", 100), t("b", "called", 200), t("c", "registered", 300)];
  assert.equal(tokenNumberFor(tickets, "c"), 3);
});

test("a ticket missing from the listing falls back to the queue length, never to zero", () => {
  // A read-after-write lag must not hand the patient token 0, which the board would render as blank.
  assert.equal(tokenNumberFor([t("a", "registered", 1)], "not-listed"), 1);
  assert.equal(tokenNumberFor([], "not-listed"), 1);
  assert.equal(tokenNumberFor(null, "x"), 1);
});

test("the OPD org defaults to the Connect tenant, and ABDM_OPD_HOSPITAL_ID can remap it", () => {
  assert.equal(opdOrgFor({}, "t1").id, "t1");
  assert.equal(opdOrgFor({ ABDM_OPD_HOSPITAL_ID: '{"t1":"GIMSR"}' }, "t1").id, "GIMSR");
  assert.equal(opdOrgFor({ ABDM_OPD_HOSPITAL_ID: '{"*":"MAIN"}' }, "t9").id, "MAIN");
  // Malformed config must not silently drop the tenant and register into a blank org.
  assert.equal(opdOrgFor({ ABDM_OPD_HOSPITAL_ID: "not json" }, "t1").id, "t1");
});
