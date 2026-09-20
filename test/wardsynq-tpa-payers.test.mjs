/* test/wardsynq-tpa-payers.test.mjs - P1.5: the FHIR Claim adapter, the payer registry, settlement
 * and pre-admission cost estimates, PURE + through the real routes with a mocked payer transport.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-tpa-payers.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { buildFhirClaim, mapClaimResponse, FhirClaimAdapter } from "../wardsynq/wardsynq-fhir-claim-adapter.js";
import { adapterForPayer, payerRuleWarnings } from "../wardsynq/wardsynq-tpa-adapter.js";
import { settle, moveBalanceToPatient, BillingError } from "../wardsynq/wardsynq-billing.js";

/* ---------------------------------------------------------------------------------------------
 * PURE
 * ------------------------------------------------------------------------------------------- */

test("buildFhirClaim: a claim, use 'claim', diagnosis codes carried, no patient name anywhere", () => {
  const c = buildFhirClaim({ id: "c1", patientId: "pat1", submittedAmount: 15000, codes: [{ code: "E11.9" }] }, { use: "claim", payer: { name: "NHCX Test" } });
  assert.equal(c.use, "claim");
  assert.equal(c.patient.reference, "Patient/pat1");
  assert.equal(c.diagnosis[0].diagnosisCodeableConcept.coding[0].code, "E11.9");
  assert.ok(!JSON.stringify(c).match(/[A-Z][a-z]+ [A-Z][a-z]+/), "no name-shaped string anywhere in the resource");
});

test("buildFhirClaim: use 'preauthorization' totals the requested amount", () => {
  const c = buildFhirClaim({ id: "p1", patientId: "pat1", treatment: "Insulin pump therapy", requestedAmount: 50000 }, { use: "preauthorization" });
  assert.equal(c.use, "preauthorization");
  assert.equal(c.total.value, 50000);
});

test("mapClaimResponse: a non-2xx is failed", () => {
  const r = mapClaimResponse(500, null);
  assert.equal(r.state, "failed");
});

test("mapClaimResponse: a 2xx with no ClaimResponse body is sent, not acknowledged", () => {
  const r = mapClaimResponse(200, { resourceType: "OperationOutcome" });
  assert.equal(r.state, "sent");
});

test("mapClaimResponse: outcome error is failed", () => {
  const r = mapClaimResponse(200, { resourceType: "ClaimResponse", outcome: "error", error: [{ code: { text: "bad claim" } }] });
  assert.equal(r.state, "failed");
  assert.match(r.note, /bad claim/);
});

test("mapClaimResponse: outcome complete is acknowledged with totals and adjudication reasons", () => {
  const r = mapClaimResponse(200, {
    resourceType: "ClaimResponse", outcome: "complete", id: "CR-1",
    total: [{ category: { coding: [{ code: "submitted" }] }, amount: { value: 15000 } }, { category: { coding: [{ code: "benefit" }] }, amount: { value: 12000 } }],
    item: [{ itemSequence: 1, adjudication: [{ reason: { text: "non-payable consumables" }, amount: { value: 3000 } }] }],
  });
  assert.equal(r.state, "acknowledged");
  assert.equal(r.payerReference, "CR-1");
  assert.equal(r.adjudication.submitted, 15000);
  assert.equal(r.adjudication.approved, 12000);
  assert.equal(r.disallowances[0].reason, "non-payable consumables");
});

test("FhirClaimAdapter: a payer requiring auth with no credentials is not_configured, and fetch is never called", async () => {
  let called = false;
  const adapter = FhirClaimAdapter({ id: "nhcx", endpoint: "https://payer.example.test/Claim", auth: { type: "bearer" } },
    { fetch: async () => { called = true; }, authorize: async () => null });
  const r = await adapter.submit({ id: "c1", patientId: "p1", submittedAmount: 1000 });
  assert.equal(r.state, "not_configured");
  assert.match(r.note, /credentials missing/);
  assert.equal(called, false);
});

test("FhirClaimAdapter: a non-https endpoint is not_configured, nothing sent", async () => {
  let called = false;
  const adapter = FhirClaimAdapter({ id: "x", endpoint: "http://payer.example.test/Claim" }, { fetch: async () => { called = true; } });
  const r = await adapter.submit({ id: "c1", patientId: "p1" });
  assert.equal(r.state, "not_configured");
  assert.equal(called, false);
});

test("FhirClaimAdapter: fetch throwing is failed, never upgraded", async () => {
  const adapter = FhirClaimAdapter({ id: "x", endpoint: "https://payer.example.test/Claim", auth: "none" },
    { fetch: async () => { throw new Error("network down"); } });
  const r = await adapter.submit({ id: "c1", patientId: "p1" });
  assert.equal(r.state, "failed");
  assert.match(r.note, /delivery is unknown/i);
});

test("adapterForPayer: no id, unknown id, or unknown kind all resolve to the NullAdapter", () => {
  const payers = [{ id: "paper", name: "Paper", adapter: "manual" }, { id: "weird", name: "Weird", adapter: "carrier-pigeon" }];
  assert.equal(adapterForPayer(payers, null, {}).adapter.id, "null");
  assert.equal(adapterForPayer(payers, "ghost", {}).adapter.id, "null");
  assert.equal(adapterForPayer(payers, "weird", {}).adapter.id, "null");
});

test("adapterForPayer: 'manual' adapter is queued when submitted", async () => {
  const payers = [{ id: "paper", name: "Paper", adapter: "manual" }];
  const { adapter } = adapterForPayer(payers, "paper", {});
  const r = await adapter.submit({});
  assert.equal(r.state, "queued");
});

test("payerRuleWarnings: preauth required above threshold and none approved", () => {
  const warnings = payerRuleWarnings({ id: "c1", submittedAmount: 50000 }, { id: "nhcx", name: "NHCX", rules: { preauthRequiredAbove: 10000 } }, { preAuths: [] });
  assert.ok(warnings.some((w) => /pre-authorisation/.test(w)));
});

test("payerRuleWarnings: timely filing counts from discharge", () => {
  const warnings = payerRuleWarnings({ id: "c1", submittedAmount: 1000, dischargedAt: "2026-01-01T00:00:00.000Z" },
    { id: "nhcx", name: "NHCX", rules: { timelyFilingDays: 30 } }, { now: "2026-03-01T00:00:00.000Z" });
  assert.ok(warnings.some((w) => /timely filing/i.test(w) && /has passed/.test(w)));
});

test("settle: a short payment against approval needs a reason", () => {
  const claim = { state: "submitted", history: [], submittedAmount: 15000, approvedAmount: 12000 };
  assert.throws(() => settle(claim, { paidAmount: 10000, by: "cashier" }), (e) => e instanceof BillingError && e.code === "NO_SHORT_REASON");
});

test("settle: a disallowance between submitted and approved needs reasons", () => {
  const claim = { state: "submitted", history: [], submittedAmount: 15000, approvedAmount: 12000 };
  assert.throws(() => settle(claim, { paidAmount: 12000, by: "cashier" }), (e) => e instanceof BillingError && e.code === "NO_DISALLOWANCE_REASON");
});

test("settle: balance stays 'unassigned' until a person moves it", () => {
  const claim = { state: "submitted", history: [], submittedAmount: 15000, approvedAmount: 12000 };
  const out = settle(claim, { paidAmount: 11000, by: "cashier", shortPaymentReason: "package cap", disallowances: [{ reason: "non-payable consumables", amount: 3000 }] });
  assert.equal(out.settlement.balanceWith, "unassigned");
  assert.equal(out.state, "paid");
});

test("moveBalanceToPatient: needs a reason", () => {
  const claim = { settlement: { outstandingAmount: 4000, balanceWith: "unassigned" }, history: [] };
  assert.throws(() => moveBalanceToPatient(claim, { amount: 1000, by: "cashier" }), (e) => e instanceof BillingError && e.code === "NO_REASON");
});

test("moveBalanceToPatient: cannot exceed the outstanding amount", () => {
  const claim = { settlement: { outstandingAmount: 4000, balanceWith: "unassigned" }, history: [] };
  assert.throws(() => moveBalanceToPatient(claim, { amount: 5000, reason: "co-pay", by: "cashier" }), (e) => e instanceof BillingError && e.code === "OVER_BALANCE");
});

test("moveBalanceToPatient: cannot be done twice", () => {
  const claim = { settlement: { outstandingAmount: 4000, balanceWith: "unassigned" }, history: [] };
  moveBalanceToPatient(claim, { amount: 4000, reason: "co-pay", by: "cashier" });
  assert.throws(() => moveBalanceToPatient(claim, { amount: 1, reason: "again", by: "cashier" }), (e) => e instanceof BillingError && e.code === "ALREADY_MOVED");
});

/* ---------------------------------------------------------------------------------------------
 * ROUTE TESTS - the harness copied from test/wardsynq-billing-tpa-bridge.test.mjs
 * ------------------------------------------------------------------------------------------- */

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const { makeSecrets } = await import("../functions/_connect/secrets.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", CASHIER = "cashier@example.test", BILLING = "billing@example.test";
const CONNECT_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");

let tpaCalls;
const WSQ_TPA_FETCH = async (url, init) => {
  tpaCalls.push({ url, init });
  return {
    status: 200,
    headers: { get: () => null },
    json: async () => ({ resourceType: "ClaimResponse", outcome: "complete", id: "CR-1",
      total: [{ category: { coding: [{ code: "submitted" }] }, amount: { value: 15000 } }, { category: { coding: [{ code: "benefit" }] }, amount: { value: 12000 } }] }),
  };
};

async function sealedNhcxRef() {
  return "sealed:" + await makeSecrets({ CONNECT_MASTER_KEY }).seal("tok123");
}

async function seedHospital() {
  docs.clear(); clock = 1; tpaCalls = [];
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: {
    id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: {
      payers: [
        { id: "nhcx", name: "NHCX Test", adapter: "fhir-claim", endpoint: "https://payer.example.test/Claim", auth: { type: "bearer", credentialRef: await sealedNhcxRef() }, rules: { preauthRequiredAbove: 10000, timelyFilingDays: 30 } },
        { id: "nokey", name: "No Key", adapter: "fhir-claim", endpoint: "https://payer2.example.test/Claim", auth: { type: "bearer" } },
        { id: "paper", name: "Paper", adapter: "manual" },
      ],
      tariff: { CONSULT: { amount: 500, currency: "INR" }, BED: { amount: 2000, currency: "INR" } },
    },
  }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [CASHIER, "cashier"], [BILLING, "billing"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, CONNECT_MASTER_KEY, WSQ_TPA_FETCH } });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;

async function admitWithProblem() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "TPA Payer Testcase " + n, mobile: "98765290" + String(n).padStart(2, "0"), gender: "male", ageYears: 60 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(n) });
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
  return adm;
}

test("a payer with a sealed credential is authenticated, sends a real FHIR Claim, and the acknowledged figures land on the claim", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "nhcx" });
  assert.equal(claim.__status, 200, JSON.stringify(claim));

  /* rcm-claims-ops: the payer's pre-authorisation amount is now a blocking checklist finding (claims-ops.js), not only a
   * warning. Nothing is sent until a person records why it goes anyway. */
  const blocked = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
  assert.equal(blocked.__status, 422, JSON.stringify(blocked));
  assert.equal(blocked.error, "claim_checklist_blocked");
  assert.equal(tpaCalls.length, 0, "a blocked claim is never sent");
  const submitted = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 15000, overrideReason: "emergency admission, pre-authorisation applied for" });
  assert.equal(submitted.__status, 200, JSON.stringify(submitted));
  assert.equal(submitted.claim.adapter.state, "acknowledged", JSON.stringify(submitted.claim.adapter));
  assert.equal(submitted.claim.adapter.payerReference, "CR-1");
  assert.equal(submitted.claim.approvedAmount, 12000);

  assert.equal(tpaCalls.length, 1);
  assert.equal(tpaCalls[0].init.headers.authorization, "Bearer tok123");
  const sentBody = JSON.parse(tpaCalls[0].init.body);
  assert.equal(sentBody.resourceType, "Claim");
  assert.equal(sentBody.use, "claim");
});

test("a payer with no credential configured is not_configured, the mock is never called, and the claim never reaches 'acknowledged'", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "nokey" });
  const submitted = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
  assert.equal(submitted.__status, 200, JSON.stringify(submitted));
  assert.equal(submitted.claim.adapter.state, "not_configured");
  assert.match(submitted.claim.adapter.note, /credentials missing/);
  assert.equal(tpaCalls.length, 0, "the payer transport was never called");
  assert.equal(submitted.claim.state, "submitted", "the LOCAL claim state moved");
  assert.notEqual(submitted.claim.state, "acknowledged");
});

test("a manual payer queues, and an unknown payer is not_configured", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const paperClaim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper" });
  const paperSubmit = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: paperClaim.claimId, action: "submit", submittedAmount: 5000 });
  assert.equal(paperSubmit.claim.adapter.state, "queued");

  const ghostClaim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "ghost" });
  const ghostSubmit = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: ghostClaim.claimId, action: "submit", submittedAmount: 5000 });
  assert.equal(ghostSubmit.claim.adapter.state, "not_configured");
});

test("settle and balance-to-patient through /ward/claim-state, and acknowledge with a payer reference", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "nhcx" });
  await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 15000, overrideReason: "pre-authorisation applied for" });

  const noReason = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "settle", paidAmount: 11000 });
  assert.equal(noReason.__status, 422, JSON.stringify(noReason));

  const settled = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "settle", paidAmount: 11000, shortPaymentReason: "short paid", disallowances: [{ reason: "non-payable consumables", amount: 3000 }] });
  assert.equal(settled.__status, 200, JSON.stringify(settled));
  assert.equal(settled.claim.state, "paid");
  assert.equal(settled.claim.settlement.balanceWith, "unassigned");

  const noReasonBalance = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "balance-to-patient", amount: 4000 });
  assert.equal(noReasonBalance.__status, 422, JSON.stringify(noReasonBalance));

  const moved = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "balance-to-patient", amount: 4000, reason: "co-pay" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  assert.equal(moved.claim.settlement.balanceWith, "patient");

  const ack = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "acknowledge", payerReference: "REF-9" });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.claim.payerReference, "REF-9");
});

test("preauth requested with a payer sends a FHIR preauthorization and lands acknowledged", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const preauth = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG, patientId: adm.patientId, treatment: "Cardiac catheterisation", state: "requested", payerId: "nhcx", requestedAmount: 50000 });
  assert.equal(preauth.__status, 200, JSON.stringify(preauth));
  assert.equal(preauth.preAuth.adapter.state, "acknowledged", JSON.stringify(preauth.preAuth.adapter));
  const sentBody = JSON.parse(tpaCalls[tpaCalls.length - 1].init.body);
  assert.equal(sentBody.use, "preauthorization");
});

test("claim-estimate priced from tariff, and claims lists estimates/payers/warnings with no secrets leaked", async () => {
  await seedHospital();
  const adm = await admitWithProblem();
  const est = await as(CASHIER, "/ward/claim-estimate", "POST", { orgId: ORG, patientId: adm.patientId, lines: [{ code: "BED", quantity: 3 }, { code: "XRAY" }] });
  assert.equal(est.__status, 200, JSON.stringify(est));
  assert.equal(est.estimate.estimatedAmount, 6000);
  assert.equal(est.estimate.isEstimate, true);
  assert.ok(est.estimate.unpriced.some((u) => u.code === "XRAY"));

  const claims = await as(CASHIER, `/ward/claims?orgId=${ORG}&patientId=${adm.patientId}`, "GET");
  assert.equal(claims.__status, 200, JSON.stringify(claims));
  assert.ok(claims.estimates.length >= 1);
  assert.ok(claims.payers.some((p) => p.id === "nhcx"));
  const raw = JSON.stringify(claims);
  assert.ok(!raw.includes("payer.example.test"), "no payer endpoint leaks to the screen");
  assert.ok(!raw.includes("tok123") && !raw.includes("sealed:"), "no credential reference leaks to the screen");
  assert.ok(claims.payerWarnings, "per-claim payer warnings are present");

  // NEGATIVE: a doctor has no billing capability.
  const asDoctor = await as(DOCTOR, "/ward/claim-estimate", "POST", { orgId: ORG, patientId: adm.patientId, lines: [{ code: "BED" }] });
  assert.equal(asDoctor.__status, 403, JSON.stringify(asDoctor));

  // NEGATIVE: a "billing" role (BILLING_VIEW only) cannot settle a claim.
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper" });
  await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 1000 });
  const asBilling = await as(BILLING, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "settle", paidAmount: 1000 });
  assert.equal(asBilling.__status, 403, JSON.stringify(asBilling));
});
