// test/connect/abdm/hip-guard.test.mjs — Stage-5 Task-5: the R5 cross-patient OVER-SHARE guardrail.
//
// assertServeAllowed is the last line of defence before StewardMD seals-and-pushes a record to an HIU. It
// enforces R5 in FULL and refuses the WHOLE transfer (never drop-and-serve-the-rest) on ANY miss:
//   (i)   hmacPseudonym(env, tenantId, consent.patientAbha) == patient_abha_hash on EVERY served record subject;
//   (ii)  each served careContextReference is EXPLICITLY in the FRESHLY-verified artifact's careContexts;
//   (iii) each record's hiType is a subset of consent.hiTypes;
//   (iv)  the consent is bound FRESH (revalidateForRequest) so a since-REVOKED/EXPIRED/out-of-dateRange grant
//         is refused even if it verified cleanly at fetch time.
// A single miss -> OverShareError, `hip.denied` audited (metadata only; NEVER a raw ABHA). No cross-patient
// bytes ever reach the Task-3 seal. Uses the REAL hmacPseudonym (a genuine per-tenant HMAC, not a stub).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertServeAllowed, OverShareError } from "../../../functions/_connect/abdm/hip.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";

const TENANT = "t-hip";
const SALT = Buffer.from("connect-hip-test-hmac-salt-value").toString("base64");
const NOW = () => new Date("2026-07-21T00:00:00Z");
const envOf = (over = {}) => ({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, CONNECT_HIP_PUSH_HOSTS: "hiu.example.org", ...over });

function makeAudit() { const events = []; return { fn: async (e) => { events.push(e); }, events }; }
const consentFor = (abha, over = {}) => ({
  consentId: "consent-1",
  patientAbha: abha,
  status: "GRANTED",
  careContexts: ["cc-A-1", "cc-A-2"],
  hiTypes: ["DischargeSummary", "OPConsultation"],
  purpose: { code: "CAREMGT", text: "Care Management" },
  permission: { dateRange: { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" } },
  expiry: "2026-12-31T23:59:59Z",
  ...over,
});
const rec = (careContextRef, patientAbhaHash, hiType = "DischargeSummary") => ({ careContextRef, patientAbhaHash, hiType });

// Every rejection must audit hip.denied and NEVER leak the raw ABHA.
async function expectRefuse(env, deps, args, auditBag) {
  await assert.rejects(() => assertServeAllowed(env, deps, args), OverShareError);
  assert.ok(auditBag.events.some((e) => e.action === "hip.denied"), "a refusal must audit hip.denied");
  assert.equal(JSON.stringify(auditBag.events).includes("@sbx"), false, "no raw ABHA may appear in the audit");
}

test("all-match happy path -> allows (returns, no denial audited)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const audit = makeAudit();
  await assertServeAllowed(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx"),
    careContexts: ["cc-A-1", "cc-A-2"],
    records: [rec("cc-A-1", HASH_A, "DischargeSummary"), rec("cc-A-2", HASH_A, "OPConsultation")],
    tenantId: TENANT,
  });
  assert.equal(audit.events.length, 0, "an allowed transfer audits no denial");
});

test("(i) cross-patient: consent for A + a record whose subject is B -> OverShareError, WHOLE transfer refused", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_B = await hmacPseudonym(env, TENANT, "B@sbx");
  const audit = makeAudit();
  // one in-scope A record + one B record in the SAME transfer -> the whole transfer is refused (never serve the A one).
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx", { careContexts: ["cc-A-1", "cc-B-1"] }), // even a (buggy) artifact naming B's cc is caught by the subject check
    careContexts: ["cc-A-1", "cc-B-1"],
    records: [rec("cc-A-1", HASH_A), rec("cc-B-1", HASH_B)],
    tenantId: TENANT,
  }, audit);
});

test("(ii) a careContext NOT in the freshly-verified artifact -> refuse (no registration-implied membership)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const audit = makeAudit();
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx"), // artifact careContexts = [cc-A-1, cc-A-2]; cc-A-9 is NOT in it
    careContexts: ["cc-A-9"],
    records: [rec("cc-A-9", HASH_A, "DischargeSummary")],
    tenantId: TENANT,
  }, audit);
});

test("(iii) a record hiType outside consent.hiTypes -> refuse (subset check)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const audit = makeAudit();
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx", { hiTypes: ["DischargeSummary"] }),
    careContexts: ["cc-A-1"],
    records: [rec("cc-A-1", HASH_A, "DiagnosticReport")], // DiagnosticReport is NOT granted
    tenantId: TENANT,
  }, audit);
});

test("(iv) a since-REVOKED consent -> refuse even with a clean subject/scope", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const audit = makeAudit();
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx", { status: "REVOKED" }),
    careContexts: ["cc-A-1"],
    records: [rec("cc-A-1", HASH_A)],
    tenantId: TENANT,
  }, audit);
});

test("(iv) an EXPIRED / out-of-dateRange consent -> refuse", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const audit = makeAudit();
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx", { expiry: "2020-01-01T00:00:00Z" }),
    careContexts: ["cc-A-1"],
    records: [rec("cc-A-1", HASH_A)],
    tenantId: TENANT,
  }, audit);
});

test("canonicalization: A@sbx (consent) vs a@sbx (record subject) must NOT falsely match -> refuse", async () => {
  const env = envOf();
  const HASH_lower = await hmacPseudonym(env, TENANT, "a@sbx"); // record subject hashed from the lower-case form
  const audit = makeAudit();
  // consent.patientAbha is "A@sbx"; its HMAC differs from HMAC("a@sbx"), so the case-variant record is refused.
  await expectRefuse(env, { now: NOW, audit: audit.fn }, {
    consent: consentFor("A@sbx"),
    careContexts: ["cc-A-1"],
    records: [rec("cc-A-1", HASH_lower)],
    tenantId: TENANT,
  }, audit);
  // sanity: the SAME casing DOES match (no over-refusal).
  const HASH_upper = await hmacPseudonym(env, TENANT, "A@sbx");
  const ok = makeAudit();
  await assertServeAllowed(env, { now: NOW, audit: ok.fn }, {
    consent: consentFor("A@sbx"), careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_upper)], tenantId: TENANT,
  });
  assert.equal(ok.events.length, 0);
});

test("a missing patientAbha / missing record subject -> refuse (fail-closed, never null==null)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const a1 = makeAudit();
  await expectRefuse(env, { now: NOW, audit: a1.fn }, {
    consent: consentFor("A@sbx", { patientAbha: null }), careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, a1);
  const a2 = makeAudit();
  await expectRefuse(env, { now: NOW, audit: a2.fn }, {
    consent: consentFor("A@sbx"), careContexts: ["cc-A-1"], records: [rec("cc-A-1", null)], tenantId: TENANT,
  }, a2);
});
