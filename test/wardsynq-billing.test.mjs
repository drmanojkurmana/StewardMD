/* test/wardsynq-billing.test.mjs — money pulling on the clinical record.
 *
 * The tests are all about one boundary: billing reads the chart and never writes to it, and no
 * financial state ever reaches a clinical decision. A record bent for a claim lies to whoever reads
 * it next, and that patient may be unconscious at the time.
 *
 * node --test test/wardsynq-billing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_STATE, PREAUTH_STATE, SUPPORT, BillingError,
  mayProceedClinically, supportFor, codeClaim, detectUpcoding,
  submit, deny, resubmit, recordAdjudication, preAuthorisation, upcodingWatchlist,
} from "../wardsynq/wardsynq-billing.js";

const NOW = "2026-09-04T12:00:00.000Z";

const record = (over) => ({
  conditions: [{ code: "E11.9" }],                       // type 2 diabetes, documented
  observations: [{ code: "2345-7", supportsCodes: ["E11.65"] }],  // hyperglycaemia, suggestive only
  medications: [{ drug: "insulin glargine", supportsCodes: ["E11.9"] }],
  severityEvidence: { "J18.9": "moderate" },
  ...over,
});

const claimFor = (codes, over) => codeClaim({
  encounterId: "enc-1", patientId: "pat-1", record: record(), codes, codedBy: "coder-3", now: NOW, ...over,
});

/* ------------------------------------------------------------------ ADVERSARIAL: the boundary */

test("ADVERSARIAL: financial state NEVER gates clinical care, and there is no path that says otherwise", () => {
  const r = mayProceedClinically();
  assert.equal(r.allowed, true);
  assert.match(r.reason, /has no code path that returns false/);
  // The function takes no arguments at all, so there is nothing to pass that could change the answer.
  assert.equal(mayProceedClinically.length, 0);
  assert.equal(mayProceedClinically({ inArrears: true, unpaidBalance: 999999 }).allowed, true);
});

test("ADVERSARIAL: a code with nothing behind it in the record is REFUSED, not queried", () => {
  assert.throws(() => claimFor(["I21.9"]), (e) => e instanceof BillingError && e.code === "UNSUPPORTED_CODE");
  try {
    claimFor(["I21.9"]);
  } catch (e) {
    assert.match(e.message, /A charge cannot create its own justification/);
    assert.match(e.message, /a clinician documents it on clinical grounds through the clinical path/);
  }
});

test("a queried code would sit in a work list until somebody made it go away, which is why it is refused", () => {
  // The whole reason UNSUPPORTED throws rather than producing a "needs review" flag.
  const c = claimFor(["E11.9"]);
  assert.equal(c.state, CLAIM_STATE.CODED);
  assert.equal(c.codes[0].support, SUPPORT.DOCUMENTED);
});

/* ------------------------------------------------------------------ support */

test("a documented diagnosis is supported; an inferred one is a question for a clinician", () => {
  assert.equal(supportFor("E11.9", record()).support, SUPPORT.DOCUMENTED);

  const inferred = supportFor("E11.65", record());
  assert.equal(inferred.support, SUPPORT.INFERRED);
  assert.deepEqual(inferred.evidence, ["observation 2345-7"]);
  assert.match(inferred.note, /Do NOT add it to support the claim/);

  assert.equal(supportFor("I21.9", record()).support, SUPPORT.UNSUPPORTED);
});

test("ADVERSARIAL: an inferred code is coded but surfaced as a question, never silently accepted", () => {
  const c = claimFor(["E11.9", "E11.65"]);
  assert.deepEqual(c.inferredCodes, ["E11.65"]);
  assert.equal(c.queries.length, 1);
  assert.match(c.queries[0].question, /this claim will not add it/);
});

test("a medication can support a code, because an order is a clinical act", () => {
  const s = supportFor("E11.9", { medications: [{ drug: "insulin glargine", supportsCodes: ["E11.9"] }] });
  assert.equal(s.support, SUPPORT.INFERRED);
  assert.match(s.evidence[0], /medication insulin glargine/);
});

test("coding requires an encounter, a coder and at least one code", () => {
  assert.throws(() => codeClaim({ patientId: "p", codes: ["E11.9"], codedBy: "c" }), (e) => e.code === "NO_ENCOUNTER");
  assert.throws(() => codeClaim({ encounterId: "e", patientId: "p", codes: ["E11.9"] }), (e) => e.code === "NO_ACTOR");
  assert.throws(() => codeClaim({ encounterId: "e", patientId: "p", codedBy: "c", codes: [] }), (e) => e.code === "NO_CODES");
});

/* ------------------------------------------------------------------ ADVERSARIAL: upcoding */

test("ADVERSARIAL: a severity the record does not support is caught at coding time", () => {
  const rec = record({ conditions: [{ code: "J18.9" }] });
  const claim = codeClaim({
    encounterId: "enc-2", patientId: "pat-1", record: rec,
    codes: [{ code: "J18.9", severity: "critical" }], codedBy: "coder-3", now: NOW,
  });
  const d = detectUpcoding(claim, rec);
  assert.equal(d.clean, false);
  assert.equal(d.findings[0].claimed, "critical");
  assert.equal(d.findings[0].supported, "moderate");
  assert.match(d.reading, /a question now and an audit finding later/);
});

test("a severity within what the record supports is clean", () => {
  const rec = record({ conditions: [{ code: "J18.9" }] });
  const claim = codeClaim({
    encounterId: "enc-2", patientId: "pat-1", record: rec,
    codes: [{ code: "J18.9", severity: "mild" }], codedBy: "coder-3", now: NOW,
  });
  assert.equal(detectUpcoding(claim, rec).clean, true);
});

test("a severity claimed where the record has no severity evidence at all is flagged", () => {
  const rec = record();
  const claim = codeClaim({
    encounterId: "enc-3", patientId: "pat-1", record: rec,
    codes: [{ code: "E11.9", severity: "severe" }], codedBy: "coder-3", now: NOW,
  });
  const d = detectUpcoding(claim, rec);
  assert.equal(d.clean, false);
  assert.match(d.findings[0].reason, /carries no severity evidence/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: resubmission */

test("ADVERSARIAL: coding that changes after a denial is flagged PERMANENTLY", () => {
  const rec = record({ conditions: [{ code: "E11.9" }, { code: "N17.9" }] });
  let claim = codeClaim({ encounterId: "enc-4", patientId: "pat-1", record: rec, codes: ["E11.9"], codedBy: "coder-3", now: NOW });
  claim = submit(claim, { by: "coder-3", now: NOW });
  claim = deny(claim, { reason: "insufficient complexity for the package claimed", now: NOW });

  // The move: after the denial, a second diagnosis appears on the claim.
  claim = resubmit(claim, { codes: ["E11.9", "N17.9"], record: rec, by: "coder-3", reason: "acute kidney injury also treated", now: NOW });

  assert.equal(claim.clinicalContentChangedAfterDenial, true);
  assert.match(claim.upcodingFlag.reason, /commonest shape of real upcoding/);
  assert.match(claim.upcodingFlag.reason, /it must never be invisible/);
  assert.ok(claim.history.some((h) => h.event === "clinical-content-changed-after-denial"));
});

test("the flag does not BLOCK the resubmission, because a genuine correction happens too", () => {
  const rec = record({ conditions: [{ code: "E11.9" }, { code: "N17.9" }] });
  let claim = submit(codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW }), { by: "c", now: NOW });
  claim = deny(claim, { reason: "coding error", now: NOW });
  claim = resubmit(claim, { codes: ["E11.9", "N17.9"], record: rec, by: "c", reason: "AKI omitted in error", now: NOW });
  assert.equal(claim.state, CLAIM_STATE.SUBMITTED, "blocking it would just push the correction off-system");
});

test("an administrative resubmission with unchanged coding raises no flag", () => {
  const rec = record();
  let claim = submit(claimFor(["E11.9"]), { by: "c", now: NOW });
  claim = deny(claim, { reason: "wrong payer id", now: NOW });
  claim = resubmit(claim, { by: "c", reason: "corrected the payer id", now: NOW });
  assert.equal(claim.clinicalContentChangedAfterDenial, undefined);
  assert.equal(claim.state, CLAIM_STATE.SUBMITTED);
});

test("a resubmission still cannot introduce an unsupported code", () => {
  const rec = record();
  let claim = submit(claimFor(["E11.9"]), { by: "c", now: NOW });
  claim = deny(claim, { reason: "low value", now: NOW });
  assert.throws(() => resubmit(claim, { codes: ["E11.9", "I21.9"], record: rec, by: "c", reason: "adding MI", now: NOW }),
    (e) => e.code === "UNSUPPORTED_CODE");
});

test("only a denied or queried claim can be resubmitted, and it names who and why", () => {
  const claim = claimFor(["E11.9"]);
  assert.throws(() => resubmit(claim, { by: "c", reason: "x" }), (e) => e.code === "NOT_DENIED");
  const denied = deny(submit(claimFor(["E11.9"]), { by: "c", now: NOW }), { reason: "r", now: NOW });
  assert.throws(() => resubmit(denied, { by: "c" }), (e) => e.code === "NO_REASON");
});

test("the watchlist is the monthly read for somebody not paid on collections", () => {
  const rec = record({ conditions: [{ code: "E11.9" }, { code: "N17.9" }] });
  let a = submit(codeClaim({ encounterId: "e1", patientId: "p1", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW }), { by: "c", now: NOW });
  a = resubmit(deny(a, { reason: "d", now: NOW }), { codes: ["E11.9", "N17.9"], record: rec, by: "c", reason: "r", now: NOW });
  const b = claimFor(["E11.9"]);

  const w = upcodingWatchlist([a, b]);
  assert.equal(w.count, 1);
  assert.match(w.reading, /by somebody who is not paid on collections/);
  assert.equal(upcodingWatchlist([b]).count, 0);
});

/* ------------------------------------------------------------------ ADVERSARIAL: pre-authorisation */

test("ADVERSARIAL: a refused pre-auth is a funding decision and says so", () => {
  const p = preAuthorisation({
    patientId: "pat-1", scheme: "Ayushman Bharat", treatment: "primary PCI",
    state: PREAUTH_STATE.REFUSED, reason: "package not covered at this facility", decidedAt: NOW,
  });
  assert.equal(p.isClinicalDecision, false);
  assert.match(p.note, /does not mean the treatment is not indicated/);
  assert.match(p.note, /If it is indicated it should be provided/);
});

test("an approved pre-auth still does not carry a clinical opinion", () => {
  const p = preAuthorisation({ patientId: "p", treatment: "PCI", state: PREAUTH_STATE.APPROVED, decidedAt: NOW });
  assert.equal(p.isClinicalDecision, false);
  assert.match(p.note, /Clinical indication is decided independently/);
});

test("a pre-auth needs a treatment and a state", () => {
  assert.throws(() => preAuthorisation({ patientId: "p", state: PREAUTH_STATE.APPROVED }), (e) => e.code === "NO_TREATMENT");
  assert.throws(() => preAuthorisation({ patientId: "p", treatment: "t", state: "maybe" }), (e) => e.code === "NO_STATE");
});

/* ------------------------------------------------------------------ TASK 4.8: TPA / claims fields */

test("TASK 4.8: a claim carries the invoice it reconciles against, when the hospital raised one - a plain reference, never a computed match", () => {
  const rec = record();
  const withInvoice = codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW, invoiceId: "wsq-invoice-p-1" });
  assert.equal(withInvoice.invoiceId, "wsq-invoice-p-1");
  const withoutInvoice = codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW });
  assert.equal(withoutInvoice.invoiceId, null, "a claim raised before any invoice exists is not forced to have one");
});

test("TASK 4.8: submitted/approved/denied amounts are plain caller-supplied numbers, never computed here", () => {
  const rec = record();
  const claim = codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW });
  submit(claim, { by: "coder-1", now: NOW, submittedAmount: 15000 });
  assert.equal(claim.submittedAmount, 15000);

  const claim2 = codeClaim({ encounterId: "e2", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW });
  submit(claim2, { by: "coder-1", now: NOW });
  deny(claim2, { reason: "package exceeded", by: "payer", now: NOW, deniedAmount: 15000 });
  assert.equal(claim2.deniedAmount, 15000);
  assert.equal(claim2.denialReason, "package exceeded");
});

test("TASK 4.8: recordAdjudication - what the payer said it will pay, never a state transition of its own", () => {
  const rec = record();
  const claim = codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9"], codedBy: "c", now: NOW });
  submit(claim, { by: "coder-1", now: NOW, submittedAmount: 15000 });
  assert.throws(() => recordAdjudication(claim, { by: "payer-1", now: NOW }), (e) => e.code === "NO_AMOUNT");
  assert.throws(() => recordAdjudication(claim, { approvedAmount: 12000, now: NOW }), (e) => e.code === "NO_ACTOR");

  const before = claim.state;
  recordAdjudication(claim, { approvedAmount: 12000, deniedAmount: 3000, by: "payer-1", now: NOW, reason: "package cap applied" });
  assert.equal(claim.approvedAmount, 12000);
  assert.equal(claim.deniedAmount, 3000);
  assert.equal(claim.state, before, "adjudication records an amount - it never moves the claim's own workflow state");
  assert.match(claim.history[claim.history.length - 1].detail, /approved 12000/);
  assert.match(claim.history[claim.history.length - 1].detail, /denied 3000/);
});

test("TASK 4.8: a pre-authorisation carries the invoice it reconciles against and the authorized amount, both plain caller-supplied data", () => {
  const p = preAuthorisation({ patientId: "p", treatment: "PCI", state: PREAUTH_STATE.APPROVED, decidedAt: NOW, invoiceId: "wsq-invoice-p-1", authorizedAmount: 250000 });
  assert.equal(p.invoiceId, "wsq-invoice-p-1");
  assert.equal(p.authorizedAmount, 250000);
  const bare = preAuthorisation({ patientId: "p", treatment: "PCI", state: PREAUTH_STATE.REQUESTED, decidedAt: NOW });
  assert.equal(bare.invoiceId, null);
  assert.equal(bare.authorizedAmount, null, "no amount authorized yet is null, never zero - zero would read as a payer decision that happened");
});

/* ------------------------------------------------------------------ the module writes nothing */

test("ADVERSARIAL: nothing in this module mutates the clinical record it was given", () => {
  const rec = record();
  const before = JSON.stringify(rec);
  const claim = codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["E11.9", "E11.65"], codedBy: "c", now: NOW });
  detectUpcoding(claim, rec);
  supportFor("E11.65", rec);
  assert.equal(JSON.stringify(rec), before, "billing reads the chart and never writes to it");
});
