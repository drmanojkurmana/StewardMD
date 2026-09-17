/* test/wardsynq-claims-ops.test.mjs - rcm-claims-ops: the claim checklist, payer queries and enhancements, denial reasons,
 * receivables ageing, the desk's lists, coding candidates and the evidence pack. PURE, then through the real routes
 * (/ward/claim-state, /ward/claim-checks, /ward/preauth-event, /ward/claim-evidence, /ward/rcm-worklists, /ward/cashless-stays,
 * /org/rcm-settings) with negative authorization on each, then the screens rendered in a sandbox.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-claims-ops.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* Imported after the Firestore and deps mocks below: claims-ops.js reaches the org store. */
let scrubClaim, codingCandidates, ageingOf, buildWorklists, validateRcmSettings, rcmSettings, recordPayerQuery, requestEnhancement, decideEnhancement, classifyDenial, mrnOf, evidencePack, cashlessWorklist, payersFromConnectors, BillingError;

/* ---- HARNESS (as test/wardsynq-tpa-payers.test.mjs) -------------------------------------------------------- */

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
      claimsFn: async (request) => (String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase() === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
({ scrubClaim, codingCandidates, ageingOf, buildWorklists, validateRcmSettings, rcmSettings, recordPayerQuery, requestEnhancement, decideEnhancement, classifyDenial, mrnOf, evidencePack, cashlessWorklist } = await import("../functions/_wardsynq/claims-ops.js"));
({ payersFromConnectors } = await import("../functions/_wardsynq/payer-connectors.js"));
({ BillingError } = await import("../wardsynq/wardsynq-billing.js"));

/* ---- PURE ------------------------------------------------------------------------------------------------------- */

const PAYER = { id: "star", name: "Star TPA", rules: { claimDocuments: ["Discharge summary", "Final bill"], preauthRequiredAbove: 10000, requireSignedDischargeSummary: "yes", requireIcd10Codes: "yes" } };
const CLAIM = { id: "c1", patientId: "opd-pat-smd-1", encounterId: "e1", payerId: "star", state: "coded", codes: [{ code: "I10" }], history: [] };
const FACTS = {
  conditions: [{ code: "I10", codeSystem: "icd-10", verificationStatus: "confirmed", clinicalStatus: "active", encounterId: "e1", display: "Essential hypertension" }],
  preAuths: [{ id: "pa1", payerId: "star", state: "approved", treatment: "Admission", authorizedAmount: 20000, validUntil: "2026-09-30" }],
  packageAssignment: null, encounter: { id: "e1", periodStart: "2026-09-10T06:00:00Z", class: "IPD" }, dischargeSummary: { signedBy: "dr" }, invoice: null,
};
const complete = { ...CLAIM, documents: [{ name: "discharge summary" }, { name: "Final bill" }] };

test("scrub: a claim missing a configured document is refused with the document named; marked documents clear it (case-insensitive)", () => {
  const r = scrubClaim(CLAIM, FACTS, { payer: PAYER, submittedAmount: 15000 });
  assert.equal(r.clean, false);
  assert.deepEqual(r.blocking.filter((f) => f.code === "document_missing").map((f) => f.document), ["Discharge summary", "Final bill"]);
  assert.match(r.blocking[0].text, /Discharge summary/);
  assert.equal(scrubClaim(complete, FACTS, { payer: PAYER, submittedAmount: 15000 }).clean, true);
});

test("scrub: an expired pre-authorisation blocks; a missing one blocks when the payer's amount needs it; a package adds its documents", () => {
  const expired = { ...FACTS, preAuths: [{ ...FACTS.preAuths[0], validUntil: "2026-09-01" }] };
  const r = scrubClaim(complete, expired, { payer: PAYER, submittedAmount: 15000 });
  assert.deepEqual(r.blocking.map((f) => f.code), ["preauth_expired"]);
  assert.match(r.blocking[0].text, /valid until 2026-09-01, before the admission on 2026-09-10/);
  const stateExpired = scrubClaim(complete, { ...FACTS, preAuths: [{ ...FACTS.preAuths[0], state: "expired", validUntil: null }] }, { payer: PAYER, submittedAmount: 15000 });
  assert.deepEqual(stateExpired.blocking.map((f) => f.code), ["preauth_expired"]);
  const none = scrubClaim(complete, { ...FACTS, preAuths: [] }, { payer: PAYER, submittedAmount: 15000 });
  assert.deepEqual(none.blocking.map((f) => f.code), ["preauth_missing"]);
  assert.equal(scrubClaim(complete, { ...FACTS, preAuths: [] }, { payer: PAYER, submittedAmount: 5000 }).clean, true, "below the payer's amount no pre-authorisation is needed");
  const pkg = { status: "active", preAuthId: null, package: { code: "PKG1", preAuthRequired: false, claimDocuments: ["Implant sticker"] } };
  assert.deepEqual(scrubClaim(complete, { ...FACTS, packageAssignment: pkg }, { payer: PAYER, submittedAmount: 5000 }).blocking.map((f) => f.document), ["Implant sticker"]);
  assert.equal(scrubClaim(complete, FACTS, { payer: PAYER, submittedAmount: 25000 }).warnings.some((w) => w.code === "preauth_amount_exceeded"), true);
});

test("scrub: an unreadable fact the payer's rule needs blocks as unchecked, never as fine; unsigned summary, non-ICD-10 code and a claim above its bill block", () => {
  const unread = scrubClaim(complete, { ...FACTS, dischargeSummary: undefined, conditions: undefined, preAuths: undefined }, { payer: PAYER, submittedAmount: 15000 });
  assert.deepEqual(unread.blocking.map((f) => f.code).sort(), ["coding_unchecked", "discharge_summary_unchecked", "preauth_unchecked"]);
  assert.deepEqual(scrubClaim(complete, { ...FACTS, dischargeSummary: { signedBy: null } }, { payer: PAYER, submittedAmount: 5000 }).blocking.map((f) => f.code), ["discharge_summary_unsigned"]);
  assert.deepEqual(scrubClaim(complete, { ...FACTS, conditions: [{ ...FACTS.conditions[0], codeSystem: "unspecified" }] }, { payer: PAYER, submittedAmount: 5000 }).blocking.map((f) => f.code), ["code_not_icd10"]);
  const inv = { id: "inv1", lines: [{ line: 4000 }], events: [{ kind: "raised", amount: 0, at: "2026-09-12T00:00:00Z" }], void: false };
  assert.deepEqual(scrubClaim({ ...complete, invoiceId: "inv1" }, { ...FACTS, invoice: inv }, { payer: PAYER, submittedAmount: 5000 }).blocking.map((f) => f.code), ["submitted_above_invoice"]);
  assert.deepEqual(scrubClaim({ ...complete, invoiceId: "inv1" }, { ...FACTS, invoice: { ...inv, void: true } }, { payer: PAYER, submittedAmount: 3000 }).blocking.map((f) => f.code), ["invoice_void"]);
  // No payer: nothing configured, so nothing blocks and it is said.
  const bare = scrubClaim({ ...CLAIM, payerId: null }, FACTS, { payer: null });
  assert.equal(bare.clean, true);
  assert.equal(bare.warnings[0].code, "no_payer");
});

test("coding candidates never contain a code absent from the chart, nor a differential or refuted one; completeness warns on a stay's coded condition left off", () => {
  const conds = [
    { code: "I10", codeSystem: "icd-10", verificationStatus: "confirmed", clinicalStatus: "active", encounterId: "e1" },
    { code: "E11.9", codeSystem: "icd-10", verificationStatus: "differential", encounterId: "e1" },
    { code: "J18.9", codeSystem: "icd-10", verificationStatus: "refuted", encounterId: "e1" },
    { code: "chest pain", codeSystem: "text", verificationStatus: "provisional" },
    { code: "N18.3", codeSystem: "icd-10", verificationStatus: "confirmed", clinicalStatus: "active", encounterId: "e1" },
  ];
  const c = codingCandidates(conds, "e1");
  assert.deepEqual(c.map((x) => x.code).sort(), ["I10", "N18.3"]);
  const chart = new Set(conds.map((x) => x.code));
  for (const x of c) assert.ok(chart.has(x.code));
  const w = scrubClaim(complete, { ...FACTS, conditions: conds }, { payer: PAYER, submittedAmount: 5000 }).warnings;
  assert.deepEqual(w.filter((x) => x.code === "chart_condition_not_on_claim").map((x) => x.conditionCode), ["N18.3"]);
});

test("ageing: totals reconcile to the bills' balances, bands are the hospital's, a void bill is out, credit is held apart", () => {
  const day = 86400000, now = Date.parse("2026-09-17T00:00:00Z");
  const bill = (id, lines, daysAgo, parties, extra) => ({ id, lines: lines.map((l) => ({ line: l })), events: [{ kind: "raised", amount: 0, at: new Date(now - daysAgo * day).toISOString() }, ...(extra || [])], void: false, parties });
  const star = { selfPay: false, payer: { ref: "star", name: "Star TPA" } };
  const invoices = [
    bill("a", [10000], 10, star), bill("b", [5000], 45, star), bill("c", [3000], 100, star),
    bill("d", [2000], 5, { selfPay: true }), bill("e", [1000], 70, null),
    { ...bill("f", [9999], 3, star), void: true },
    bill("g", [500], 2, star, [{ kind: "payment", amount: 800, at: new Date(now).toISOString() }]),
  ];
  const a = ageingOf(invoices, { payers: [PAYER], bands: [30, 60], nowMs: now });
  assert.deepEqual(a.labels, ["0-30", "31-60", "over 60"]);
  const s = a.payers.find((p) => p.payerRef === "star");
  assert.deepEqual(s.buckets, [10000, 5000, 3000]);
  assert.equal(a.totals.outstanding, 21000);
  assert.equal(a.totals.credit, 300);
  assert.equal(a.netOutstanding, 20700);
  const balances = invoices.filter((i) => !i.void).reduce((n, i) => n + i.lines.reduce((x, l) => x + l.line, 0) - (i.events.filter((e) => e.kind === "payment").reduce((x, e) => x + e.amount, 0)), 0);
  assert.equal(a.netOutstanding, balances);
  assert.equal(a.reconciles, true);
  const nob = ageingOf(invoices, { payers: [PAYER], bands: [], nowMs: now });
  assert.equal(nob.bandsConfigured, false);
  assert.equal(nob.totals.outstanding, 21000);
});

test("worklists: a list that could not be read is null with the reason, never an empty list; DNFB, unsubmitted, clocks and denials", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");
  const rows = {
    Encounter: [{ id: "e1", patientId: "opd-pat-m1", class: "IPD", status: "finished", periodEnd: "2026-09-10T00:00:00Z" }, { id: "e2", patientId: "opd-pat-m2", class: "IPD", status: "finished", periodEnd: "2026-09-12T00:00:00Z" }],
    Invoice: [{ id: "i2", encounterId: "e2", lines: [{ line: 100 }], events: [{ kind: "raised", at: "2026-09-12T00:00:00Z" }], void: false }],
    StayPayer: [{ encounterId: "e2", payerRef: "star" }],
    Claim: [{ id: "c9", patientId: "opd-pat-m2", encounterId: "e9", state: "denied", payerId: "star", deniedAmount: 700, denialReason: "no summary",
      history: [{ event: "denied", at: "2026-09-15T00:00:00Z" }], denialClassification: { code: "DOC", label: "Documents", rootCause: "summary late" },
      payerQueries: [{ id: "q-1", text: "send ECG", receivedAt: "2026-09-01T00:00:00Z", dueBy: "2026-09-08T00:00:00Z", answeredAt: null }] }],
    PreAuthorisation: [], PackageAssignment: [],
  };
  const w = buildWorklists({ rows, unreadable: {}, payers: [PAYER], rcm: { ageingBands: [30] }, nowMs: now });
  assert.deepEqual(w.dnfb.map((x) => x.encounterId), ["e1"]);
  assert.equal(w.dnfb[0].mrn, "M1");
  assert.deepEqual(w.unsubmitted.map((x) => [x.kind, x.encounterId]), [["no_claim", "e2"]]);
  assert.equal(w.queries[0].overdue, true);
  assert.equal(w.denials.byReason[0].key, "DOC");
  assert.equal(w.denials.byPayer[0].amount, 700);
  const failed = buildWorklists({ rows: { ...rows, Invoice: [], Claim: [] }, unreadable: { Invoice: "could not be read", Claim: "not readable with this role" }, payers: [], rcm: {}, nowMs: now });
  assert.equal(failed.dnfb, null); assert.equal(failed.ageing, null); assert.equal(failed.denials, null); assert.equal(failed.queries, null);
  assert.match(failed.unreadable.ageing, /Invoice: could not be read/);
});

test("queries, enhancements and denial reasons: clocks, amounts and refusals", () => {
  const rec = { history: [] };
  const q = recordPayerQuery(rec, { text: "send ECG", receivedAt: "2026-09-10T00:00:00Z", responseDays: 7, by: "u", now: "2026-09-11T00:00:00Z" });
  assert.equal(q.dueBy, "2026-09-17T00:00:00.000Z");
  assert.throws(() => recordPayerQuery(rec, { text: "x", receivedAt: "2026-09-20T00:00:00Z", by: "u", now: "2026-09-11T00:00:00Z" }), (e) => e.code === "FUTURE_DATE");
  const auth = { state: "approved", authorizedAmount: 20000 };
  assert.throws(() => requestEnhancement(auth, { requestedAmount: 15000, reason: "x", by: "u" }), (e) => e.code === "NOT_MORE");
  const e = requestEnhancement(auth, { requestedAmount: 30000, reason: "ICU days", by: "u", now: "2026-09-11T00:00:00Z" });
  assert.throws(() => requestEnhancement(auth, { requestedAmount: 40000, reason: "again", by: "u" }), (x) => x.code === "ALREADY_OPEN");
  decideEnhancement(auth, { enhancementId: e.id, state: "approved", approvedAmount: 28000, by: "u", now: "2026-09-12T00:00:00Z" });
  assert.equal(auth.authorizedAmount, 28000);
  assert.equal(auth.enhancements[0].previousAuthorizedAmount, 20000);
  const rcm = validateRcmSettings({ denialReasons: [{ code: "DOC", label: "Documents missing" }], ageingBands: [30, 60] }).value;
  const claim = { state: "coded", history: [] };
  assert.throws(() => classifyDenial(claim, { denialCode: "DOC", rootCause: "x", rcm, by: "u" }), (x) => x instanceof BillingError && x.code === "NOT_DENIED");
  claim.state = "denied";
  assert.throws(() => classifyDenial(claim, { denialCode: "NOPE", rootCause: "x", rcm, by: "u" }), (x) => x.code === "UNKNOWN_REASON");
  assert.throws(() => classifyDenial(claim, { denialCode: "DOC", rootCause: "x", rcm: { denialReasons: [] }, by: "u" }), (x) => x.code === "NO_TAXONOMY");
  classifyDenial(claim, { denialCode: "doc", rootCause: "summary not signed at discharge", rcm, by: "u" });
  assert.equal(claim.denialClassification.label, "Documents missing");
  assert.deepEqual(validateRcmSettings({ ageingBands: [60, 30] }).errors.ageingBands, "Ageing bands rise, like 30, 60, 90.");
  assert.deepEqual(rcmSettings({ rcm: { ageingBands: [60, 30, "x"], denialReasons: [{ code: "bad code!", label: "x" }] } }), { denialReasons: [], ageingBands: [30, 60] });
  assert.equal(mrnOf("opd-pat-smd-6teqzm-00025"), "SMD-6TEQZM-00025");
  assert.equal(mrnOf("opd-pat-tmp-000001"), null);
});

test("payer connector rules: the checklist settings reach the registry typed; numbers stay numbers", () => {
  const [p] = payersFromConnectors([{ kind: "payer", provider: "manual", active: true, name: "Star", settings: { ref: "star", timelyFilingDays: "30", claimDocuments: "Discharge summary; Final bill ;", requireSignedDischargeSummary: "yes", queryResponseDays: "7" } }]);
  assert.deepEqual(p.rules, { timelyFilingDays: 30, queryResponseDays: 7, claimDocuments: ["Discharge summary", "Final bill"], requireSignedDischargeSummary: "yes" });
});

test("evidence pack: assembled from records, says what it could not read, invents nothing", () => {
  const pack = evidencePack({ claim: { ...complete, submittedAmount: 15000, denialReason: "summary missing" }, payer: PAYER, preAuths: FACTS.preAuths, conditions: FACTS.conditions,
    reports: [{ display: "ECG", status: "final", reportedAt: "2026-09-11T00:00:00Z" }], encounter: FACTS.encounter, dischargeSummary: undefined, packageAssignment: null, invoice: null });
  assert.match(pack.text, /I10 Essential hypertension \(icd-10, confirmed\)/);
  assert.match(pack.text, /ECG: final, 2026-09-11/);
  assert.match(pack.text, /Discharge summary\n- Not readable with this role\./);
  assert.match(pack.text, /valid until 2026-09-30/);
});

/* ---- ROUTES ---- */

const ORG = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", CASHIER = "cashier@example.test", PHARMACY = "pharmacy@example.test", ADMIN = "admin@example.test", OUTSIDER = "outsider@example.test";

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: {
    id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: {
      payers: [{ id: "star", name: "Star TPA", adapter: "manual", rules: { claimDocuments: ["Discharge summary", "Final bill"], queryResponseDays: 7 } }],
      rcm: { denialReasons: [{ code: "DOC", label: "Documents missing" }], ageingBands: [30, 60] },
    },
  }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-WARD02", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [CASHIER, "cashier"], [PHARMACY, "pharmacy"], [ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OUTSIDER))}`, { fields: { orgId: OTHER, identity: idFor(OUTSIDER), role: "cashier", active: true }, updateTime: "t1" });
}
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;
async function admitWithProblem() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Claims Desk Testcase " + n, mobile: "98765390" + String(n).padStart(2, "0"), gender: "female", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(n) });
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
  return adm;
}
const claimOf = async (patientId, claimId) => ((await as(CASHIER, `/ward/claims?orgId=${ORG}&patientId=${encodeURIComponent(patientId)}`)).claims || []).find((c) => c.id === claimId);

test("/ward/claim-state: a missing document refuses submission and nothing changes; documents obtained, then sent; a query, the answer by resubmission, a denial classified", async () => {
  seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star" });
  assert.equal(claim.__status, 200, JSON.stringify(claim));

  const blocked = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 9000 });
  assert.equal(blocked.__status, 422, JSON.stringify(blocked));
  assert.equal(blocked.error, "claim_checklist_blocked");
  assert.deepEqual(blocked.findings.map((f) => f.document), ["Discharge summary", "Final bill"]);
  assert.equal((await claimOf(adm.patientId, claim.claimId)).state, "coded", "a refused submission changes nothing");

  const checks = await as(CASHIER, `/ward/claim-checks?orgId=${ORG}&patientId=${encodeURIComponent(adm.patientId)}&encounterId=${encodeURIComponent(adm.encounterId)}`);
  assert.equal(checks.__status, 200, JSON.stringify(checks));
  assert.equal(checks.checks[claim.claimId].blocking.length, 2);
  assert.deepEqual(checks.candidates, [], "I10 was recorded with no code system, so it is not a coded candidate");
  assert.deepEqual(checks.denialReasons, [{ code: "DOC", label: "Documents missing" }]);

  const docsR = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "documents", documents: ["Discharge summary", "Final bill"] });
  assert.equal(docsR.__status, 200, JSON.stringify(docsR));
  const sent = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 9000 });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  assert.equal(sent.claim.adapter.state, "queued", "a manual payer is queued, never sent");
  assert.deepEqual(sent.claim.checklist.blocking, []);

  const q = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "query", text: "Send the ECG report" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  assert.equal(q.claim.state, "queried");
  assert.ok(q.claim.payerQueries[0].dueBy, "the payer's response days set the clock");

  const desk = await as(CASHIER, `/ward/rcm-worklists?orgId=${ORG}`);
  assert.equal(desk.__status, 200, JSON.stringify(desk));
  assert.equal(desk.queries.length, 1);
  assert.equal(desk.queries[0].mrn, adm.patientId.slice(8).toUpperCase());

  const re = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "resubmit", reason: "ECG report sent" });
  assert.equal(re.__status, 200, JSON.stringify(re));
  assert.equal(re.claim.payerQueries[0].answer, "ECG report sent");

  const denied = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "deny", reason: "Summary not signed", deniedAmount: 9000 });
  assert.equal(denied.__status, 200, JSON.stringify(denied));
  const badCode = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "classify-denial", denialCode: "NOPE", rootCause: "x" });
  assert.equal(badCode.__status, 422);
  const cls = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "classify-denial", denialCode: "DOC", rootCause: "Summary signed after the claim went" });
  assert.equal(cls.__status, 200, JSON.stringify(cls));
  const desk2 = await as(CASHIER, `/ward/rcm-worklists?orgId=${ORG}`);
  assert.equal(desk2.denials.byReason[0].key, "DOC");
  assert.equal(desk2.denials.byPayer[0].amount, 9000);
  assert.equal(desk2.queries.length, 0, "an answered query leaves the list");
});

test("/ward/claim-state: an override records who and why, with the findings it went over", async () => {
  seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star" });
  const sent = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG, claimId: claim.claimId, action: "submit", submittedAmount: 9000, overrideReason: "Final bill to follow by courier" });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  const o = sent.claim.checklistOverrides[0];
  assert.equal(o.by, sent.actor);
  assert.equal(o.reason, "Final bill to follow by courier");
  assert.deepEqual(o.findings.map((f) => f.code), ["document_missing", "document_missing"]);
  assert.ok(sent.claim.history.some((h) => h.event === "sent-over-checklist-findings"));
});

test("/ward/preauth-event: validity, enhancement asked and decided, query and answer; wrong role writes nothing", async () => {
  seedHospital();
  const adm = await admitWithProblem();
  const bad = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG, patientId: adm.patientId, treatment: "Admission", state: "requested", validUntil: "2026-09-30" });
  assert.equal(bad.__status, 422, "a validity date belongs to an approval");
  const pa = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG, patientId: adm.patientId, treatment: "Admission", state: "approved", authorizedAmount: 20000, validUntil: "2026-09-30", payerId: "star" });
  assert.equal(pa.__status, 200, JSON.stringify(pa));
  assert.equal(pa.preAuth.validUntil, "2026-09-30");
  const id = pa.preAuthId;

  const noSession = await as(null, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "enhancement", requestedAmount: 30000, reason: "ICU" });
  assert.equal(noSession.__status, 401);
  const wrongRole = await as(PHARMACY, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "enhancement", requestedAmount: 30000, reason: "ICU" });
  assert.equal(wrongRole.__status, 403);
  const outsider = await as(OUTSIDER, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "enhancement", requestedAmount: 30000, reason: "ICU" });
  assert.ok([403, 404].includes(outsider.__status), JSON.stringify(outsider));
  const claims0 = await as(CASHIER, `/ward/claims?orgId=${ORG}&patientId=${encodeURIComponent(adm.patientId)}`);
  assert.equal((claims0.preAuthorisations[0].enhancements || []).length, 0, "nothing was written by a refused request");

  const enh = await as(CASHIER, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "enhancement", requestedAmount: 30000, reason: "Two ICU days added" });
  assert.equal(enh.__status, 200, JSON.stringify(enh));
  const dec = await as(CASHIER, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "enhancement-decision", enhancementId: enh.preAuth.enhancements[0].id, state: "approved", approvedAmount: 28000 });
  assert.equal(dec.__status, 200, JSON.stringify(dec));
  assert.equal(dec.preAuth.authorizedAmount, 28000);
  const q = await as(CASHIER, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "query", text: "Send the ICU notes" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const ans = await as(CASHIER, "/ward/preauth-event", "POST", { orgId: ORG, preAuthId: id, action: "answer-query", answer: "ICU notes sent" });
  assert.equal(ans.__status, 200, JSON.stringify(ans));
  assert.equal(ans.preAuth.payerQueries[0].answeredAt != null, true);
});

test("/ward/claim-evidence: assembled, saved as versions with a stale version refused; negative authorization", async () => {
  seedHospital();
  const adm = await admitWithProblem();
  const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star" });
  const path = `/ward/claim-evidence?orgId=${ORG}&claimId=${encodeURIComponent(claim.claimId)}`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(PHARMACY, path)).__status, 403);
  assert.ok([403, 404].includes((await as(OUTSIDER, path)).__status));
  const got = await as(CASHIER, path);
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.match(got.pack.text, /I10 Essential hypertension/);
  assert.match(got.pack.text, /Discharge summary\n- Not readable with this role\./, "the cashier cannot read the chart note, and the pack says so");

  const wrong = await as(PHARMACY, "/ward/claim-evidence", "POST", { orgId: ORG, claimId: claim.claimId, text: "x", expectedVersion: got.recordVersion });
  assert.equal(wrong.__status, 403);
  const saved = await as(CASHIER, "/ward/claim-evidence", "POST", { orgId: ORG, claimId: claim.claimId, text: got.pack.text + "\n\nEdited by the desk.", expectedVersion: got.recordVersion });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.packVersion, 1);
  const stale = await as(CASHIER, "/ward/claim-evidence", "POST", { orgId: ORG, claimId: claim.claimId, text: "again", expectedVersion: got.recordVersion });
  assert.equal(stale.__status, 409);
  const again = await as(CASHIER, path);
  assert.equal(again.versions.length, 1);
  assert.match(again.versions[0].text, /Edited by the desk\./);
});

test("/ward/rcm-worklists and /ward/claim-checks: 401 without a session, 403 for a role without billing, another hospital refused", async () => {
  seedHospital();
  for (const path of [`/ward/rcm-worklists?orgId=${ORG}`, `/ward/claim-checks?orgId=${ORG}&patientId=opd-pat-x`]) {
    assert.equal((await as(null, path)).__status, 401, path);
    assert.equal((await as(PHARMACY, path)).__status, 403, path);
    assert.ok([403, 404].includes((await as(OUTSIDER, path)).__status), path);
  }
  const ok = await as(CASHIER, `/ward/rcm-worklists?orgId=${ORG}`);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.dnfb, []);
  assert.equal(ok.ageing.bandsConfigured, true);
});

/* ---- R3-5 the cashless desk ---- */

test("cashless worklist: expired, awaiting, below the bill, before the expected discharge and none are found with their inputs; covered, self-pay and corporate stays are not listed", () => {
  const now = Date.parse("2026-09-17T06:00:00Z"), today = "2026-09-17";
  const payers = [{ id: "star", name: "Star Health", contract: { payerKind: "insurer" } }, { id: "mdi", name: "MD India", contract: { payerKind: "tpa", insurerRef: "star" } },
    { id: "acme", name: "Acme Ltd", contract: { payerKind: "corporate" } }, { id: "pmjay", name: "PM-JAY", contract: { payerKind: "government_scheme" } }];
  const stay = (id, pid) => ({ id, patientId: pid, class: "IPD", status: "in-progress", periodStart: "2026-09-10T06:00:00Z", location: { ward: "Medical A" } });
  const rows = {
    Encounter: [stay("e1", "opd-pat-a1"), stay("e2", "opd-pat-a2"), stay("e3", "opd-pat-a3"), stay("e4", "opd-pat-a4"), stay("e5", "opd-pat-a5"), stay("e6", "opd-pat-a6"), stay("e7", "opd-pat-a7"), stay("e8", "opd-pat-a8"),
      { id: "e0", patientId: "opd-pat-a1", class: "IPD", status: "finished", periodStart: "2026-08-01T00:00:00Z", periodEnd: "2026-08-05T00:00:00Z" }],
    StayPayer: [{ encounterId: "e1", payerRef: "star" }, { encounterId: "e2", payerRef: "mdi" }, { encounterId: "e3", payerRef: "star" }, { encounterId: "e4", payerRef: "pmjay" },
      { encounterId: "e5", payerRef: null }, { encounterId: "e6", payerRef: "acme" }, { encounterId: "e7", payerRef: "star" }, { encounterId: "e8", payerRef: "star" }],
    PreAuthorisation: [
      { id: "old", patientId: "opd-pat-a1", payerId: "star", state: "approved", authorizedAmount: 99999, validUntil: "2026-12-31", decidedAt: "2026-08-02T00:00:00Z" },
      { id: "p1", patientId: "opd-pat-a1", payerId: "star", state: "approved", authorizedAmount: 50000, validUntil: "2026-09-15", decidedAt: "2026-09-10T08:00:00Z", treatment: "Admission" },
      { id: "p2", patientId: "opd-pat-a2", payerId: "star", state: "requested", decidedAt: "2026-09-16T06:00:00Z", treatment: "Admission" },
      { id: "p3", patientId: "opd-pat-a3", payerId: "star", state: "approved", authorizedAmount: 20000, validUntil: "2026-09-30", decidedAt: "2026-09-10T08:00:00Z",
        payerQueries: [{ id: "q1", text: "send notes", answeredAt: null }] },
      { id: "p7", patientId: "opd-pat-a7", payerId: "star", state: "approved", authorizedAmount: 90000, validUntil: "2026-09-30", decidedAt: "2026-09-10T08:00:00Z" },
      { id: "p8", patientId: "opd-pat-a8", payerId: "star", state: "approved", authorizedAmount: 90000, validUntil: "2026-09-20", decidedAt: "2026-09-10T08:00:00Z" },
    ],
    PackageAssignment: [], ExpectedDischarge: [{ encounterId: "e8", expectedDate: "2026-09-22" }],
    Invoice: [{ id: "i3", encounterId: "e3", lines: [{ line: 30000 }], events: [{ kind: "raised", at: "2026-09-12T00:00:00Z" }], void: false }],
  };
  const bills = new Map([["e1", { total: 1000, unpriced: 0 }], ["e2", { total: 1000, unpriced: 0 }], ["e4", { total: 1000, unpriced: 0 }], ["e7", { total: 40000, unpriced: 2 }], ["e8", { total: 100, unpriced: 0 }]]);
  const w = cashlessWorklist({ rows, unreadable: {}, payers, nowMs: now, today, bills });
  const by = Object.fromEntries(w.stays.map((s) => [s.encounterId, s]));
  assert.deepEqual(Object.keys(by).sort(), ["e1", "e2", "e3", "e4", "e8"], "covered (e7), self-pay (e5) and corporate (e6) stays are not listed");
  assert.deepEqual(by.e1.issues, [{ code: "expired", validUntil: "2026-09-15" }], "the previous stay's approval is not this stay's");
  assert.equal(by.e1.preAuth.id, "p1");
  assert.deepEqual(by.e2.issues, [{ code: "awaiting_decision", recordedAt: "2026-09-16T06:00:00Z", ageHours: 24 }], "a TPA's stay matches its insurer's pre-authorisation");
  assert.deepEqual(by.e3.issues, [{ code: "below_bill", authorizedAmount: 20000, bill: 30000, source: "invoice" }, { code: "payer_query_open", count: 1 }]);
  assert.deepEqual(by.e3.bill, { source: "invoice", amount: 30000, invoices: 1 });
  assert.deepEqual(by.e4.issues, [{ code: "no_preauth" }]);
  assert.deepEqual(by.e8.issues, [{ code: "expires_before_discharge", validUntil: "2026-09-20", expectedDischarge: "2026-09-22" }]);
  assert.equal(by.e8.mrn, "A8");

  /* An input that could not be read is said, never taken as covered. */
  const noBill = cashlessWorklist({ rows, unreadable: { Invoice: "could not be read", ExpectedDischarge: "not readable with this role" }, payers, nowMs: now, today, bills });
  const nb = Object.fromEntries(noBill.stays.map((s) => [s.encounterId, s]));
  assert.ok(nb.e7, "a stay whose bill could not be read is listed");
  assert.deepEqual(nb.e7.issues.map((x) => x.code), ["discharge_date_unreadable", "bill_unreadable"]);
  assert.equal(nb.e7.expectedDischarge, false);
  const unread = cashlessWorklist({ rows: { ...rows, PreAuthorisation: [] }, unreadable: { PreAuthorisation: "could not be read" }, payers, nowMs: now, today, bills });
  assert.equal(unread.stays, null, "an unreadable pre-authorisation read is not an empty list");
  assert.equal(unread.unreadable, "PreAuthorisation: could not be read");
});

test("/ward/cashless-stays: 401 without a session, 403 for a role without billing, another hospital refused; an expired approval is listed with its date, a self-pay stay is not, an unreadable read says why", async () => {
  seedHospital();
  const path = `/ward/cashless-stays?orgId=${ORG}`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(PHARMACY, path)).__status, 403);
  assert.ok([403, 404].includes((await as(OUTSIDER, path)).__status));

  const cash = await admitWithProblem();
  const self = await admitWithProblem();
  const sp = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG, patientId: cash.patientId, encounterId: cash.encounterId, payerRef: "star", policyNumber: "POL-1" });
  assert.equal(sp.__status, 200, JSON.stringify(sp));
  const selfSp = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG, patientId: self.patientId, encounterId: self.encounterId, payerRef: "" });
  assert.equal(selfSp.__status, 200, JSON.stringify(selfSp));
  const pa = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG, patientId: cash.patientId, treatment: "Admission", state: "approved", payerId: "star", authorizedAmount: 50000, validUntil: "2026-01-31" });
  assert.equal(pa.__status, 200, JSON.stringify(pa));

  const r = await as(CASHIER, path);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.stays.map((s) => s.encounterId), [cash.encounterId], "the self-pay stay is not listed");
  assert.deepEqual(r.stays[0].issues.find((x) => x.code === "expired"), { code: "expired", validUntil: "2026-01-31" });
  assert.equal(r.stays[0].payerName, "Star TPA");

  // R4-2: the desk reads every record through the paged whole-type read (pageByType).
  const orig = RECORD.pageByType.bind(RECORD);
  RECORD.pageByType = async (tenant, type, opts) => { if (type === "PreAuthorisation") throw new Error("store down"); return orig(tenant, type, opts); };
  try {
    const bad = await as(CASHIER, path);
    assert.equal(bad.__status, 200, JSON.stringify(bad));
    assert.equal(bad.stays, null);
    assert.equal(bad.unreadable, "PreAuthorisation: could not be read");
  } finally { RECORD.pageByType = orig; }
});

test("/org/rcm-settings: staff.admin reads and saves with a reason; others refused and nothing saved", async () => {
  seedHospital();
  const path = `/org/rcm-settings?orgId=${ORG}`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(CASHIER, path)).__status, 403);
  assert.equal((await as(OUTSIDER, `/org/rcm-settings?orgId=${ORG}`)).__status, 403);
  const body = { orgId: ORG, settings: { denialReasons: [{ code: "DOC", label: "Documents missing" }, { code: "TARIFF", label: "Tariff dispute" }], ageingBands: [30, 60, 90] }, reason: "TPA desk review" };
  assert.equal((await as(CASHIER, "/org/rcm-settings", "POST", body)).__status, 403);
  assert.equal((await as(ADMIN, path)).settings.denialReasons.length, 1, "nothing saved by a refused request");
  assert.equal((await as(ADMIN, "/org/rcm-settings", "POST", { ...body, reason: "" })).__status, 422);
  assert.equal((await as(ADMIN, "/org/rcm-settings", "POST", { ...body, settings: { ageingBands: [90, 30] } })).__status, 422);
  const saved = await as(ADMIN, "/org/rcm-settings", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.changed, ["denialReasons", "ageingBands"]);
  assert.deepEqual(saved.settings.ageingBands, [30, 60, 90]);
});

/* ---- SCREENS ---------------------------------------------------------------------------------------------------- */

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}

test("claims desk screen: loading, failed and each unreadable list are said, never shown as none; reconciled ageing renders by payer", () => {
  const W = loadWard();
  const desk = (d) => W._render({ ...W._st, view: "claimsdesk", desk: d });
  assert.match(desk(null), /Loading/);
  assert.match(desk({ failed: true }), /could not be loaded. Do not read this as nothing outstanding/);
  const unread = desk({ ok: true, dnfb: null, unsubmitted: [], queries: [], ageing: null, denials: null, unreadable: { dnfb: "Encounter: not readable with this role", ageing: "Invoice: could not be read", denials: "Claim: could not be read" } });
  assert.match(unread, /Could not be read, so this is not a list of none: <span lang="en">Encounter: not readable with this role|Could not be read, so this is not a list of none: Encounter: not readable with this role/);
  assert.ok(!/Every discharged stay read has a bill/.test(unread));
  assert.ok(!/No bill read has a balance outstanding/.test(unread));
  const full = desk({ ok: true, denialReasonsConfigured: true, dnfb: [{ patientId: "opd-pat-m1", mrn: "M1", encounterId: "e1", dischargedAt: "2026-09-10T00:00:00Z", days: 7 }], unsubmitted: [], queries: [],
    ageing: { bandsConfigured: true, labels: ["0-30", "over 30"], payers: [{ kind: "payer", payerRef: "star", payerName: "Star TPA", buckets: [100, 50], total: 150, invoices: 2 }], totals: { buckets: [100, 50], outstanding: 150, credit: 0, invoices: 2 }, netOutstanding: 150, reconciles: true },
    denials: { count: 0, byPayer: [], byScheme: [], byService: [], byReason: [], claims: [], disallowances: [] }, unreadable: {} });
  assert.match(full, /<b>M1<\/b>/);
  assert.match(full, /data-w-act="deskopen:opd-pat-m1\|e1"/);
  assert.match(full, /Star TPA<\/td><td>100<\/td><td>50<\/td><td><b>150<\/b>/);
  assert.ok(!/do not reconcile/.test(full));
});

test("TPA screen: checklist loading, failed and blocking are three different things; candidates and the enhancement button render", () => {
  const W = loadWard();
  const t = { payers: [], preAuthorisations: [{ id: "pa1", state: "approved", treatment: "Admission", validUntil: "2026-09-30", enhancements: [] }], estimates: [],
    claims: [{ id: "c1", state: "coded", codes: [{ code: "I10" }], history: [] }] };
  const tpa = (checks) => W._render({ ...W._st, view: "tpa", sel: { patientId: "p1", encounterId: "e1" }, tpa: t, tpaChecks: checks });
  assert.match(tpa(null), /Checking this claim/);
  const failed = tpa(false);
  assert.match(failed, /The claim checklist could not be loaded. Do not read this as complete/);
  assert.ok(!/Checklist complete/.test(failed));
  const blocking = tpa({ checks: { c1: { blocking: [{ code: "document_missing", text: "Required document not marked as obtained: Final bill." }], warnings: [] } }, candidates: [{ code: "I10", display: "Essential hypertension", thisStay: true }], denialReasons: [] });
  assert.match(blocking, /Fix before sending, or send with a recorded reason:<\/b> Required document not marked as obtained: Final bill\./);
  assert.match(blocking, /data-w-act="claimcodepick:I10"/);
  assert.match(blocking, /data-w-act="paenh:pa1"/);
  assert.match(blocking, /valid until 2026-09-30/);
  assert.match(tpa({ checks: { c1: { blocking: [], warnings: [] } }, candidates: null }), /Checklist complete\.[\s\S]*Coding candidates need the problem list/);
});
