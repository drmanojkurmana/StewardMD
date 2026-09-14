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

// ── resolving the mobile for a link OTP ─────────────────────────────────────────────────────────────
// ABDM sends a pseudonymous patient reference, never a phone number, so the number is ours to find. A
// null must mean "no number on file" and NOT be mistaken for a send.
import { resolvePatientMobile } from "../../../functions/_connect/abdm/opd-bridge.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";

const linkDb = (rows) => makeAbdmDb({ connect_abha_link: rows });
const LINK = [{ tenant_id: "t1", patient_abha_hash: "PSEUDO-1", patient_ref: "P-1",
                created_at: "2026-08-19T00:00:00.000Z", updated_at: "2026-08-19T00:00:00.000Z" }];

test("the pseudonym resolves through the ABHA link to the tenant's own patient, then to a number", async () => {
  const asked = [];
  const mobile = await resolvePatientMobile({}, {
    db: linkDb(LINK),
    findTicketMobile: async (env, a) => { asked.push(a); return "9876543210"; },
  }, { tenantId: "t1", patientRef: "PSEUDO-1" });
  assert.equal(mobile, "9876543210");
  assert.deepEqual(asked, [{ tenantId: "t1", patientRef: "P-1" }], "the OPD store is asked by LOCAL ref");
});

test("no ABHA link, no number - and no attempt to look one up", async () => {
  let asked = 0;
  const mobile = await resolvePatientMobile({}, {
    db: linkDb(LINK), findTicketMobile: async () => { asked++; return "9876543210"; },
  }, { tenantId: "t1", patientRef: "NEVER-ISSUED" });
  assert.equal(mobile, null);
  assert.equal(asked, 0);
});

test("another tenant's link cannot be used to find our patient's number", async () => {
  const mobile = await resolvePatientMobile({}, {
    db: linkDb(LINK), findTicketMobile: async () => "9876543210",
  }, { tenantId: "t2", patientRef: "PSEUDO-1" });
  assert.equal(mobile, null, "the link lookup is tenant-scoped in the WHERE");
});

test("an unbound OPD lookup, a throwing one, or a missing input all yield null rather than throwing", async () => {
  assert.equal(await resolvePatientMobile({}, { db: linkDb(LINK) }, { tenantId: "t1", patientRef: "PSEUDO-1" }), null);
  assert.equal(await resolvePatientMobile({}, {
    db: linkDb(LINK), findTicketMobile: async () => { throw new Error("firestore down"); },
  }, { tenantId: "t1", patientRef: "PSEUDO-1" }), null, "losing the callback would be worse than no OTP");
  assert.equal(await resolvePatientMobile({}, { db: null }, { tenantId: "t1", patientRef: "PSEUDO-1" }), null);
  assert.equal(await resolvePatientMobile({}, { db: linkDb(LINK) }, {}), null);
});
