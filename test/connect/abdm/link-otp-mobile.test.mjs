// The link OTP had no number to send to: findTicketMobile was bound to null in the composition root, so
// resolvePatientMobile always returned null and link/init always reported delivered:false - even for a
// patient whose OPD ticket carried a mobile all along. This covers the real lookup.
//
// The engine is the Firestore I/O layer, so q_tickets is mocked (the same in-memory pattern as
// queue-timeline-token.test.mjs). What is being tested is the part that is NOT Firestore: the org
// resolution, the CROSS-TENANT filter, and picking the newest ticket that actually has a number.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const canMock = typeof mock.module === "function";
const skip = canMock ? false : "needs --experimental-test-module-mocks";
let engine = null, bridge = null, queried = [];
const TICKETS = [];

if (canMock) {
  mock.module(new URL("../../../functions/_fbfirestore.js", import.meta.url).href, { namedExports: {
    async fsQuery(env, coll, opts) {
      queried.push({ coll, opts });
      return TICKETS.filter((t) => t.fields[opts.where.field] === opts.where.value)
        .map((t) => ({ id: t.id, fields: { ...t.fields } }));
    },
    async fsGet() { return null; },
    wCreate: (e, p, o) => ({ p, o }), wUpdate: (e, p, o) => ({ p, o }), wDelete: () => ({}),
    async fsCommit() {},
  }});
  // decPHI is the queue's own sealing; a fake keeps this test about the lookup, not the crypto.
  mock.module(new URL("../../../functions/_queue.js", import.meta.url).href, { namedExports: {
    async encPHI(env, v) { return "enc:" + v; },
    async decPHI(env, v) { return String(v || "").startsWith("enc:") ? String(v).slice(4) : ""; },
    async mintTicketToken() { return "t"; }, async verifyTicketToken() { return { ok: true }; },
    ticketIdFromToken: () => "",
  }});
  engine = await import("../../../functions/_queue_engine.js");
  bridge = await import("../../../functions/_connect/abdm/opd-bridge.js");
}

const ticket = (id, hospitalId, ghisPatientId, mobile, registeredAt) =>
  ({ id, fields: { hospitalId, ghisPatientId, encMobile: mobile ? "enc:" + mobile : "", registeredAt } });

test("returns the mobile from the patient's MOST RECENT ticket", { skip }, async () => {
  TICKETS.length = 0;
  TICKETS.push(ticket("t1", "gimsr", "MR-1", "9000000001", 1000));
  TICKETS.push(ticket("t3", "gimsr", "MR-1", "9000000003", 3000));   // newest
  TICKETS.push(ticket("t2", "gimsr", "MR-1", "9000000002", 2000));
  assert.equal(await engine.findMobileByPatientId({}, "gimsr", "MR-1"), "9000000003");
});

test("a colliding MR# at ANOTHER hospital is never returned", { skip }, async () => {
  // fsQuery takes one field filter, so the org filter is applied in JS. If it ever stops being applied,
  // this returns a stranger's phone number - which is why the test exists.
  TICKETS.length = 0;
  TICKETS.push(ticket("other", "another-hospital", "MR-1", "9999999999", 9000));   // newer, wrong org
  TICKETS.push(ticket("mine", "gimsr", "MR-1", "9000000001", 1000));
  assert.equal(await engine.findMobileByPatientId({}, "gimsr", "MR-1"), "9000000001");

  TICKETS.length = 0;
  TICKETS.push(ticket("other", "another-hospital", "MR-1", "9999999999", 9000));
  assert.equal(await engine.findMobileByPatientId({}, "gimsr", "MR-1"), null, "no ticket of OURS -> null");
});

test("skips a ticket with no number rather than returning empty", { skip }, async () => {
  TICKETS.length = 0;
  TICKETS.push(ticket("new", "gimsr", "MR-1", "", 9000));            // newest, but no mobile on it
  TICKETS.push(ticket("old", "gimsr", "MR-1", "9000000001", 1000));
  assert.equal(await engine.findMobileByPatientId({}, "gimsr", "MR-1"), "9000000001");
});

test("missing arguments never turn into an unscoped query", { skip }, async () => {
  queried.length = 0;
  assert.equal(await engine.findMobileByPatientId({}, "", "MR-1"), null);
  assert.equal(await engine.findMobileByPatientId({}, "gimsr", ""), null);
  assert.equal(queried.length, 0, "a query with no org or no patient must not be issued at all");
});

test("findTicketMobile resolves the OPD org for the tenant", { skip }, async () => {
  TICKETS.length = 0;
  TICKETS.push(ticket("t1", "opd-org-9", "MR-7", "9000000007", 1000));
  // The tenant's Connect id and its OPD org id differ, which is what ABDM_OPD_HOSPITAL_ID exists for.
  const env = { ABDM_OPD_HOSPITAL_ID: JSON.stringify({ "tenant-a": "opd-org-9" }) };
  assert.equal(await bridge.findTicketMobile(env, { tenantId: "tenant-a", patientRef: "MR-7" }), "9000000007");
  // Same ticket, a tenant that maps elsewhere -> nothing.
  assert.equal(await bridge.findTicketMobile({}, { tenantId: "tenant-b", patientRef: "MR-7" }), null);
  assert.equal(await bridge.findTicketMobile(env, { tenantId: "tenant-a" }), null);
});

test("resolvePatientMobile now completes the chain: pseudonym -> local ref -> ticket mobile", { skip }, async () => {
  TICKETS.length = 0;
  TICKETS.push(ticket("t1", "gimsr", "MR-42", "9000000042", 1000));
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ patient_ref: "MR-42" }) }) }) };
  const got = await bridge.resolvePatientMobile({}, { db, findTicketMobile: bridge.findTicketMobile },
    { tenantId: "gimsr", patientRef: "pseudonym-of-abha" });
  assert.equal(got, "9000000042");
});
