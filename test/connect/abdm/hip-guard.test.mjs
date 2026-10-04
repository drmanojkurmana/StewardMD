// test/connect/abdm/hip-guard.test.mjs — Stage-5 Task-5: the R5 cross-patient OVER-SHARE guardrail.
//
// assertServeAllowed is the last line of defence before StewardMD seals-and-pushes a record to an HIU. The
// DUAL-ADVERSARIAL fix binds it to D1-AUTHORITATIVE state: it takes ONLY a `consentId`, RELOADS the consent row
// FRESH from D1 (getConsentReqByConsentId — the same pattern hiu.js#requestHealthInformation uses), and reads
// status + persisted scope + patient_abha_hash from THAT row. Nothing is trusted from the caller, and there is
// NO hmacPseudonym(rawABHA) recompute. It refuses the WHOLE transfer (never drop-and-serve-the-rest) on ANY miss:
//   (iv) revalidateForRequest against the RELOADED row (since-REVOKED/EXPIRED/out-of-dateRange/scope-widened);
//   (i)  EVERY loaded record's patientAbhaHash EQUALS the reloaded row's patient_abha_hash (subject bind);
//   (d)  EVERY served careContext is REGISTERED to the row's patient (getServableCareContexts) — a careContext
//        whose registration belongs to a DIFFERENT patient is refused;
//   (ii) each served careContextReference is EXPLICITLY in the reloaded row's persisted careContexts;
//   (iii) each record's hiType is a subset of the reloaded row's hiTypes.
// A single miss -> OverShareError, `hip.denied` audited (metadata only; NEVER a raw ABHA). A secret op going
// unavailable mid-guard (SecretsUnavailable) STILL audits hip.denied (fail-closed AND audited). Uses the REAL
// hmacPseudonym (a genuine per-tenant HMAC) to build the persisted hashes, and the REAL mock D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertServeAllowed, OverShareError, filterRecordByDateRange } from "../../../functions/_connect/abdm/hip.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";
import { SecretsUnavailable } from "../../../functions/_connect/secrets.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";

const TENANT = "t-hip";
const SALT = Buffer.from("connect-hip-test-hmac-salt-value").toString("base64");
const NOW = () => new Date("2026-07-21T00:00:00Z");
const envOf = (over = {}) => ({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, CONNECT_HIP_PUSH_HOSTS: "hiu.example.org", ...over });

function makeAudit() { const events = []; return { fn: async (e) => { events.push(e); }, events }; }

// Seed the ONE authoritative D1 consent_req row (exactly what Task-5 persistGranted writes: consent_id, status,
// patient_abha_hash + the persisted JSON scope) PLUS the connect_abdm_carecontext registration rows the guard
// binds served care-contexts against. `ccRows` overrides the default (one row per careContext, all under the
// consent's patient) so a test can register a careContext under a DIFFERENT patient.
function seedDb({
  consentId = "consent-1", tenantId = TENANT, patientAbhaHash, status = "GRANTED",
  careContexts = ["cc-A-1", "cc-A-2"], hiTypes = ["DischargeSummary", "OPConsultation"],
  purpose = { code: "CAREMGT", text: "Care Management" },
  dateRange = { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" },
  expiresAt = "2026-12-31T23:59:59Z", ccRows,
} = {}) {
  const carecontext = ccRows || careContexts.map((ref) => ({
    id: ref, tenant_id: tenantId, patient_abha_hash: patientAbhaHash, source: "followcare",
    ref, hi_type: "DischargeSummary", display: "cc " + ref, linked_at: "2026-01-01T00:00:00Z",
  }));
  return makeAbdmDb({
    connect_abdm_consent_req: [{
      request_id: consentId, consent_id: consentId, tenant_id: tenantId, actor: null,
      patient_abha_hash: patientAbhaHash, status, hi_types: JSON.stringify(hiTypes),
      care_contexts: JSON.stringify(careContexts), purpose: JSON.stringify(purpose), date_range: JSON.stringify(dateRange),
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", expires_at: expiresAt,
    }],
    connect_abdm_carecontext: carecontext,
  });
}
const rec = (careContextRef, patientAbhaHash, hiType = "DischargeSummary") => ({ careContextRef, patientAbhaHash, hiType });

// Every rejection must audit hip.denied and NEVER leak a raw ABHA.
async function expectRefuse(env, deps, args, auditBag) {
  await assert.rejects(() => assertServeAllowed(env, deps, args), OverShareError);
  assert.ok(auditBag.events.some((e) => e.action === "hip.denied"), "a refusal must audit hip.denied");
  assert.equal(JSON.stringify(auditBag.events).includes("@sbx"), false, "no raw ABHA may appear in the audit");
}

test("all-match happy path -> allows (returns, no denial audited)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A });
  const audit = makeAudit();
  await assertServeAllowed(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1",
    careContexts: ["cc-A-1", "cc-A-2"],
    records: [rec("cc-A-1", HASH_A, "DischargeSummary"), rec("cc-A-2", HASH_A, "OPConsultation")],
    tenantId: TENANT,
  });
  assert.equal(audit.events.length, 0, "an allowed transfer audits no denial");
});

test("(a) CLEAN artifact (only A's careContexts) + a record whose subject hash is B's -> OverShareError", async () => {
  // The reloaded row's scope is entirely A's (cc-A-1 registered to A); the ONLY defect is a record whose actual
  // subject pseudonym is B's. Binding to the row's patient_abha_hash (not a caller-recomputed hash) catches it.
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_B = await hmacPseudonym(env, TENANT, "B@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_B)], tenantId: TENANT,
  }, audit);
});

test("(b) D1 row REVOKED (caller cannot supply a status) -> refuse even with a clean subject/scope", async () => {
  // The guard NEVER accepts a caller `consent` object, so a cached GRANTED is structurally un-passable — status
  // comes ONLY from the fresh D1 row, which is REVOKED here.
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A, status: "REVOKED" });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, audit);
});

test("(c) caller serves WIDER careContexts / hiTypes than the D1 row -> refuse (D1 authoritative)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  // D1 grants careContexts [cc-A-1, cc-A-2] and hiTypes [DischargeSummary]; the caller cannot widen either.
  const dbWide = seedDb({ patientAbhaHash: HASH_A, hiTypes: ["DischargeSummary"] });
  const a1 = makeAudit();
  await expectRefuse(env, { db: dbWide, now: NOW, audit: a1.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1", "cc-A-9"],           // cc-A-9 is NOT in the D1 scope
    records: [rec("cc-A-1", HASH_A), rec("cc-A-9", HASH_A)], tenantId: TENANT,
  }, a1);
  const a2 = makeAudit();
  const dbNarrow = seedDb({ patientAbhaHash: HASH_A, hiTypes: ["DischargeSummary"] });
  await expectRefuse(env, { db: dbNarrow, now: NOW, audit: a2.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"],
    records: [rec("cc-A-1", HASH_A, "DiagnosticReport")], tenantId: TENANT,  // DiagnosticReport is NOT granted
  }, a2);
});

test("(d) a served careContext whose registered row belongs to a DIFFERENT patient -> refuse", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_B = await hmacPseudonym(env, TENANT, "B@sbx");
  // The consent row (patient A) even NAMES cc-shared in its scope and the record claims subject A — but the
  // AUTHORITATIVE registration for cc-shared is under patient B, so getServableCareContexts(A) never returns it.
  const db = seedDb({
    patientAbhaHash: HASH_A, careContexts: ["cc-A-1", "cc-shared"],
    ccRows: [
      { id: "cc-A-1", tenant_id: TENANT, patient_abha_hash: HASH_A, source: "followcare", ref: "cc-A-1", hi_type: "DischargeSummary", display: "A", linked_at: "2026-01-01T00:00:00Z" },
      { id: "cc-shared", tenant_id: TENANT, patient_abha_hash: HASH_B, source: "followcare", ref: "cc-shared", hi_type: "DischargeSummary", display: "B", linked_at: "2026-01-01T00:00:00Z" },
    ],
  });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-shared"], records: [rec("cc-shared", HASH_A)], tenantId: TENANT,
  }, audit);
});

test("(e) a secret op unavailable mid-guard (SecretsUnavailable) -> STILL audits hip.denied (fail-closed AND audited)", async () => {
  // Simulate an at-rest secret going unavailable during the D1 reload: the store throws SecretsUnavailable. The
  // guard must NOT crash unaudited (the adversary's blind-spot) — it wraps, audits hip.denied, and fails closed.
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const throwingDb = { prepare: () => ({ bind: () => ({ first: async () => { throw new SecretsUnavailable("CONNECT_HMAC_SALT missing"); }, all: async () => { throw new SecretsUnavailable("CONNECT_HMAC_SALT missing"); } }) }) };
  const audit = makeAudit();
  await assert.rejects(() => assertServeAllowed(env, { db: throwingDb, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }), OverShareError);
  const denied = audit.events.find((e) => e.action === "hip.denied");
  assert.ok(denied, "a SecretsUnavailable during the guard STILL audits hip.denied");
  assert.equal(denied.scope.reason, "secrets-unavailable");
});

test("(i) cross-patient: consent for A + a record whose subject is B -> WHOLE transfer refused", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_B = await hmacPseudonym(env, TENANT, "B@sbx");
  // The D1 scope even (buggily) names B's cc AND registers it under B; one in-scope A record + one B record in
  // the SAME transfer -> the whole transfer is refused (never serve the A one).
  const db = seedDb({
    patientAbhaHash: HASH_A, careContexts: ["cc-A-1", "cc-B-1"],
    ccRows: [
      { id: "cc-A-1", tenant_id: TENANT, patient_abha_hash: HASH_A, source: "followcare", ref: "cc-A-1", hi_type: "DischargeSummary", display: "A", linked_at: "x" },
      { id: "cc-B-1", tenant_id: TENANT, patient_abha_hash: HASH_B, source: "followcare", ref: "cc-B-1", hi_type: "DischargeSummary", display: "B", linked_at: "x" },
    ],
  });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1", "cc-B-1"],
    records: [rec("cc-A-1", HASH_A), rec("cc-B-1", HASH_B)], tenantId: TENANT,
  }, audit);
});

test("(ii) a careContext NOT in the reloaded row's scope -> refuse (no registration-implied membership)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A });   // D1 scope = [cc-A-1, cc-A-2]; cc-A-9 is NOT in it
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-9"], records: [rec("cc-A-9", HASH_A, "DischargeSummary")], tenantId: TENANT,
  }, audit);
});

test("(iii) a record hiType outside the reloaded row's hiTypes -> refuse (subset check)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A, hiTypes: ["DischargeSummary"] });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A, "DiagnosticReport")], tenantId: TENANT,
  }, audit);
});

test("(iv) an EXPIRED / out-of-dateRange consent -> refuse", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A, expiresAt: "2020-01-01T00:00:00Z" });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, audit);
});

test("a missing D1 consent row -> refuse (fail-closed, status null)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "no-such-consent", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, audit);
});

test("a missing record subject -> refuse (fail-closed, never null==null)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", null)], tenantId: TENANT,
  }, audit);
});

test("canonicalization: a case-variant record subject hash must NOT falsely match -> refuse", async () => {
  const env = envOf();
  const HASH_upper = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_lower = await hmacPseudonym(env, TENANT, "a@sbx"); // a distinct HMAC — must not match the A@sbx row
  const db = seedDb({ patientAbhaHash: HASH_upper });
  const audit = makeAudit();
  await expectRefuse(env, { db, now: NOW, audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_lower)], tenantId: TENANT,
  }, audit);
  // sanity: the SAME casing DOES match (no over-refusal).
  const ok = makeAudit();
  await assertServeAllowed(env, { db, now: NOW, audit: ok.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_upper)], tenantId: TENANT,
  });
  assert.equal(ok.events.length, 0);
});


// ── OPS-02/F2: assertServeAllowed requires a real, parseable consent dateRange ─────────────────────
// An ABDM consent artefact ALWAYS carries permission.dateRange (signed into the JWS payload); a
// reloaded row with none, or one that does not parse, is corrupt or was never properly persisted -
// refused WHOLE (fail-closed). Caught by revalidateForRequest's own dateRange parse (reval.ok check,
// (iv) above) before assertServeAllowed's own per-resource date step is ever reached - the reason is
// prefixed "consent:" because it travels through that existing gate, not a duplicate check here.
test("OPS-02/F2: a consent row with a missing/unparseable dateRange is refused, whole transfer", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const missing = seedDb({ patientAbhaHash: HASH_A, careContexts: ["cc-A-1"], dateRange: {} });
  const auditMissing = makeAudit();
  await expectRefuse(env, { db: missing, now: NOW, audit: auditMissing.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, auditMissing);
  assert.ok(auditMissing.events.some((e) => e.scope && e.scope.reason === "consent:bad-daterange"));

  const garbled = seedDb({ patientAbhaHash: HASH_A, careContexts: ["cc-A-1"], dateRange: { from: "not-a-date", to: "also-not" } });
  const auditGarbled = makeAudit();
  await expectRefuse(env, { db: garbled, now: NOW, audit: auditGarbled.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  }, auditGarbled);
  assert.ok(auditGarbled.events.some((e) => e.scope && e.scope.reason === "consent:bad-daterange"));
});

test("OPS-02/F2: a valid dateRange passes assertServeAllowed and its bounds (ms since epoch) are returned", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const db = seedDb({ patientAbhaHash: HASH_A, careContexts: ["cc-A-1"], dateRange: { from: "2024-01-01T00:00:00Z", to: "2024-01-31T23:59:59Z" } });
  const audit = makeAudit();
  // `now` must itself fall inside the granted dateRange - revalidateForRequest's own (unchanged)
  // now-vs-dateRange check, not this test's concern.
  const range = await assertServeAllowed(env, { db, now: () => new Date("2024-01-15T00:00:00Z"), audit: audit.fn }, {
    consentId: "consent-1", careContexts: ["cc-A-1"], records: [rec("cc-A-1", HASH_A)], tenantId: TENANT,
  });
  assert.equal(audit.events.length, 0);
  assert.deepEqual(range, { from: Date.parse("2024-01-01T00:00:00Z"), to: Date.parse("2024-01-31T23:59:59Z") });
});

// ── OPS-02/F2 round 2: filterRecordByDateRange - PER-RESOURCE date filtering, not whole-record refusal ──
// The old fix compared only the record's FIRST dated item to the window and refused (or served) the
// WHOLE record on that one date. Round 2: every dated resource (encounter/diagnosticReport/
// observation/immunization) is checked and filtered INDIVIDUALLY, so a care-context whose first item
// is in range can no longer smuggle out-of-range items in behind it.
const FROM = Date.parse("2024-01-01T00:00:00Z"), TO = Date.parse("2024-01-31T23:59:59Z");
const enc = (id, date) => ({ id, period: { start: date, end: date } });
const dr = (id, date) => ({ id, effectiveDateTime: date });

test("OPS-02/F2 round 2: a mixed in/out bundle serves ONLY the in-range resources", async () => {
  const record = {
    encounters: [enc("e-in", "2024-01-10T00:00:00Z"), enc("e-out", "2019-05-01T00:00:00Z")],
    diagnosticReports: [dr("d-in", "2024-01-15T00:00:00Z"), dr("d-out", "2024-02-01T00:00:00Z")],
  };
  const { record: filtered, hadDated, anyKept } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(hadDated, true);
  assert.equal(anyKept, true);
  assert.deepEqual(filtered.encounters.map((e) => e.id), ["e-in"]);
  assert.deepEqual(filtered.diagnosticReports.map((d) => d.id), ["d-in"]);
});

test("OPS-02/F2 round 2: an undated item (of a dated kind) is dropped, even alongside in-range items", async () => {
  const record = { observations: [{ id: "o-in", effectiveDateTime: "2024-01-10T00:00:00Z" }, { id: "o-undated" }] };
  const { record: filtered, hadDated, anyKept } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(hadDated, true);
  assert.equal(anyKept, true);
  assert.deepEqual(filtered.observations.map((o) => o.id), ["o-in"]);
});

test("OPS-02/F2 round 2: nothing in range -> anyKept false, the whole careContext is refused", async () => {
  const record = { encounters: [enc("e-out", "2019-05-01T00:00:00Z")] };
  const { hadDated, anyKept } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(hadDated, true);
  assert.equal(anyKept, false);
});

test("OPS-02/F2 round 2: a record with NO dated resource kind at all -> hadDated false, refused (fail-closed, not 'unaffected')", async () => {
  const record = { conditions: [{ id: "c1" }], allergies: [{ id: "a1" }] };
  const { hadDated } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(hadDated, false, "conditions/allergies carry no date this filter checks; nothing left to determine a date from");
});

test("OPS-02/F2 round 2: dateRange bounds are INCLUSIVE - exactly `from` and exactly `to` are kept", async () => {
  const record = { encounters: [enc("e-from", "2024-01-01T00:00:00Z"), enc("e-to", "2024-01-31T23:59:59Z"), enc("e-after", "2024-02-01T00:00:00.001Z")] };
  const { record: filtered, anyKept } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(anyKept, true);
  assert.deepEqual(filtered.encounters.map((e) => e.id), ["e-from", "e-to"]);
});

// ── documents and medications are dated too (clinical date set by the record builders) ──
const doc = (id, date, extra = {}) => ({ id, date, ...extra });
const med = (id, authoredOn, effectivePeriod) => ({ id, ...(authoredOn ? { authoredOn } : {}), ...(effectivePeriod ? { effectivePeriod } : {}) });

test("documents: in-range kept, out-of-range dropped, undated dropped (fail closed)", async () => {
  const record = { documents: [doc("d-in", "2024-01-10T00:00:00Z"), doc("d-before", "2023-12-31T23:59:59Z"), doc("d-after", "2024-02-01T00:00:00Z"), doc("d-undated", null), doc("d-junk", "not a date")] };
  const { record: filtered, hadDated, anyKept } = filterRecordByDateRange(record, FROM, TO);
  assert.equal(hadDated, true);
  assert.equal(anyKept, true);
  assert.deepEqual(filtered.documents.map((d) => d.id), ["d-in"]);
});

test("medications (owner decision 2026-10-04): kept when the ACTIVE PERIOD overlaps the window, not by start date alone", async () => {
  const record = { medications: [
    med("m-auth-in", "2024-01-05T00:00:00Z"),                                                // started inside, no end
    med("m-auth-out", "2024-03-01T00:00:00Z"),                                               // starts after the window
    med("m-per-in", null, { start: "2024-01-20T00:00:00Z" }),                                // started inside (effectivePeriod)
    med("m-long-term", null, { start: "2023-06-01T00:00:00Z" }),                             // started before, still taken: SHARED
    med("m-long-term-auth", "2022-02-01T00:00:00Z"),                                         // ordered years before, no end: SHARED
    med("m-stopped-inside", null, { start: "2023-06-01T00:00:00Z", end: "2024-01-15T00:00:00Z" }),  // started before, stopped inside: SHARED
    med("m-stopped-before", null, { start: "2023-06-01T00:00:00Z", end: "2023-12-15T00:00:00Z" }),  // stopped before `from`: dropped
    med("m-spans", null, { start: "2023-12-01T00:00:00Z", end: "2024-03-01T00:00:00Z" }),     // covers the whole window: SHARED
    med("m-per-end-only", null, { end: "2024-01-21T00:00:00Z" }),                            // no start: dropped (fail closed)
    med("m-bad-end", null, { start: "2023-06-01T00:00:00Z", end: "not a date" }),             // unparseable end: dropped
    med("m-undated"), med("m-empty-period", null, { start: null, end: null }),
  ] };
  const { record: filtered } = filterRecordByDateRange(record, FROM, TO);
  assert.deepEqual(filtered.medications.map((m) => m.id), ["m-auth-in", "m-per-in", "m-long-term", "m-long-term-auth", "m-stopped-inside", "m-spans"]);
});

test("medications: an ENDED status with no end date is not treated as still running; only a start inside the window keeps it", async () => {
  const record = { medications: [
    { ...med("m-stopped-old", "2023-06-01T00:00:00Z"), status: "stopped" },                  // ended at an unknown time: dropped
    { ...med("m-completed-old", "2023-06-01T00:00:00Z"), status: "completed" },
    { ...med("m-completed-in", "2024-01-10T00:00:00Z"), status: "completed" },               // its start is in the window: kept
    { ...med("m-active-old", "2023-06-01T00:00:00Z"), status: "active" },                    // still active: kept
    { ...med("m-stopped-dated", null, { start: "2023-06-01T00:00:00Z", end: "2024-01-02T00:00:00Z" }), status: "stopped" },   // known end inside: kept
  ] };
  const { record: filtered } = filterRecordByDateRange(record, FROM, TO);
  assert.deepEqual(filtered.medications.map((m) => m.id), ["m-completed-in", "m-active-old", "m-stopped-dated"]);
});

test("document and medication boundaries are INCLUSIVE at exactly from and to", async () => {
  const record = { documents: [doc("d-from", "2024-01-01T00:00:00Z"), doc("d-to", "2024-01-31T23:59:59Z"), doc("d-after", "2024-01-31T23:59:59.001Z")],
    medications: [med("m-from", "2024-01-01T00:00:00Z"), med("m-to", "2024-01-31T23:59:59Z"), med("m-after", "2024-01-31T23:59:59.001Z"),
      med("m-ends-at-from", null, { start: "2023-01-01T00:00:00Z", end: "2024-01-01T00:00:00Z" }),
      med("m-ends-just-before", null, { start: "2023-01-01T00:00:00Z", end: "2023-12-31T23:59:59.999Z" })] };
  const { record: filtered } = filterRecordByDateRange(record, FROM, TO);
  assert.deepEqual(filtered.documents.map((d) => d.id), ["d-from", "d-to"]);
  assert.deepEqual(filtered.medications.map((m) => m.id), ["m-from", "m-to", "m-ends-at-from"]);
});

test("a multi-item narrative (coversDates) is dropped when ANY line it states is outside the window", async () => {
  const record = { documents: [
    doc("n-all-in", "2024-01-20T00:00:00Z", { coversDates: ["2024-01-10T00:00:00Z", "2024-01-20T00:00:00Z"] }),
    doc("n-one-out", "2024-01-20T00:00:00Z", { coversDates: ["2023-11-10T00:00:00Z", "2024-01-20T00:00:00Z"] }),
    doc("n-one-undated", "2024-01-20T00:00:00Z", { coversDates: [null, "2024-01-20T00:00:00Z"] }),
    doc("n-empty-covers", "2024-01-20T00:00:00Z", { coversDates: [] }),
  ] };
  const { record: filtered } = filterRecordByDateRange(record, FROM, TO);
  assert.deepEqual(filtered.documents.map((d) => d.id), ["n-all-in", "n-empty-covers"]);
});

test("a care context whose only dated items are an undated or out-of-range document/medication is not servable (anyKept false)", async () => {
  const { anyKept, hadDated, record } = filterRecordByDateRange({ documents: [doc("d", null)], medications: [med("m", null, { start: "2019-01-01T00:00:00Z", end: "2019-02-01T00:00:00Z" })] }, FROM, TO);
  assert.equal(hadDated, true);
  assert.equal(anyKept, false);
  assert.deepEqual([record.documents, record.medications], [[], []]);
});
