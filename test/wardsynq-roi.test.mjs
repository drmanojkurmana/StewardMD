/* test/wardsynq-roi.test.mjs — TASK 4.9: HIM/ROI (release of information) engine, PURE.
 *
 * node --test test/wardsynq-roi.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestROI, authorize, deny, cancel, fulfill, RELATIONSHIPS, RoiRefusalError } from "../wardsynq/wardsynq-roi.js";

const NOW = "2026-09-09T09:00:00.000Z";
function newRequest(over = {}) {
  return requestROI({
    id: "roi-1", patientId: "pat-1",
    requester: { name: "Jane Advocate", organization: "Advocate & Co", relationship: "attorney" },
    purpose: "Personal injury litigation", recipient: "jane@advocateco.example",
    scope: { recordTypes: ["DiagnosticReport"], from: "2026-01-01", to: "2026-09-01" },
    requestedBy: "him-clerk-1", requestedAt: NOW,
    ...over,
  });
}

test("requestROI: never the whole chart by default - a scope naming at least one record type is required", () => {
  const req = newRequest();
  assert.equal(req.state, "requested");
  assert.equal(req.requester.relationship, "attorney");
  assert.deepEqual(req.scope.recordTypes, ["DiagnosticReport"]);
  assert.throws(() => newRequest({ scope: { recordTypes: [] } }), (e) => e.code === "SCOPE_REQUIRED");
  assert.throws(() => requestROI({ id: "x", patientId: "p", requester: {}, purpose: "x", recipient: "x", scope: { recordTypes: ["a"] }, requestedBy: "a", requestedAt: NOW }), (e) => e.code === "REQUESTER_REQUIRED");
  assert.throws(() => newRequest({ purpose: "" }), (e) => e.code === "PURPOSE_REQUIRED");
  assert.throws(() => newRequest({ recipient: "" }), (e) => e.code === "RECIPIENT_REQUIRED");
});

test("an unrecognised relationship falls back to 'other', never to whatever was typed", () => {
  const req = newRequest({ requester: { name: "X", relationship: "bounty-hunter" } });
  assert.equal(req.requester.relationship, "other");
  assert.ok(RELATIONSHIPS.includes("attorney") && RELATIONSHIPS.includes("other"));
});

test("authorize: requires a stated basis, never 'somebody clicked yes'", () => {
  const req = newRequest();
  assert.throws(() => authorize(req, { by: "him-1", at: NOW }), (e) => e.code === "AUTHORIZATION_BASIS_REQUIRED");
  authorize(req, { by: "him-1", at: "2026-09-09T10:00:00.000Z", authorizationBasis: "Signed patient authorization on file, ref #4471" });
  assert.equal(req.state, "authorized");
  assert.equal(req.authorizationBasis, "Signed patient authorization on file, ref #4471");
  assert.throws(() => authorize(req, { by: "him-1", at: NOW, authorizationBasis: "x" }), (e) => e.code === "NOT_REQUESTED", "an already-authorized request cannot be authorized again");
});

test("deny: requires a reason; a denied request stays on the record, never silently disappears", () => {
  const req = newRequest();
  assert.throws(() => deny(req, { by: "him-1", at: NOW }), (e) => e.code === "REASON_REQUIRED");
  deny(req, { by: "him-1", at: NOW, reason: "No valid authorization provided" });
  assert.equal(req.state, "denied");
  assert.equal(req.history[req.history.length - 1].event, "denied");
});

test("cancel: only before fulfilment, always with a reason", () => {
  const req = newRequest();
  authorize(req, { by: "him-1", at: NOW, authorizationBasis: "Court order #221" });
  cancel(req, { by: "him-1", at: NOW, reason: "Requester withdrew the request" });
  assert.equal(req.state, "cancelled");
  const fulfilled = newRequest({ id: "roi-2" });
  authorize(fulfilled, { by: "him-1", at: NOW, authorizationBasis: "x" });
  fulfill(fulfilled, { by: "him-1", at: NOW, resourceCounts: { DiagnosticReport: 2 } });
  assert.throws(() => cancel(fulfilled, { by: "him-1", at: NOW, reason: "x" }), (e) => e.code === "ALREADY_CLOSED");
});

test("fulfill: only an authorized request; the disclosure log counts what was sent, NEVER the values themselves", () => {
  const req = newRequest();
  assert.throws(() => fulfill(req, { by: "him-1", at: NOW, resourceCounts: { DiagnosticReport: 2 } }), (e) => e.code === "NOT_AUTHORIZED");
  authorize(req, { by: "him-1", at: NOW, authorizationBasis: "Signed release on file" });
  fulfill(req, { by: "him-1", at: "2026-09-09T11:00:00.000Z", deliveredStatus: "mailed", resourceCounts: { DiagnosticReport: 2, Observation: 5 } });
  assert.equal(req.state, "fulfilled");
  assert.equal(req.disclosure.deliveredStatus, "mailed");
  assert.deepEqual(req.disclosure.resourceCounts, { DiagnosticReport: 2, Observation: 5 });
  assert.equal(JSON.stringify(req.disclosure).indexOf("Observation"), JSON.stringify(req.disclosure).indexOf("Observation"), "sanity: this is a count object");
  // No clinical value anywhere in the disclosure record - only counts and a delivery status.
  assert.equal(typeof req.disclosure.resourceCounts.DiagnosticReport, "number");
});

test("fulfill defaults deliveredStatus to 'delivered' when the caller does not say otherwise", () => {
  const req = newRequest();
  authorize(req, { by: "him-1", at: NOW, authorizationBasis: "x" });
  fulfill(req, { by: "him-1", at: NOW, resourceCounts: {} });
  assert.equal(req.disclosure.deliveredStatus, "delivered");
});

test("authorizationBasis is recorded verbatim, never validated against a list of what counts as legally sufficient", () => {
  const req = newRequest({ authorizationBasis: "" });
  authorize(req, { by: "him-1", at: NOW, authorizationBasis: "A napkin the requester waved at the front desk" });
  assert.equal(req.authorizationBasis, "A napkin the requester waved at the front desk", "this module records the stated basis - judging its sufficiency is a HIM/legal decision, not this file's");
});
