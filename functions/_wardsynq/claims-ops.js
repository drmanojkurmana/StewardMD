/* functions/_wardsynq/claims-ops.js - the claims desk: a claim cannot leave incomplete, and every denial and every
 * rupee outstanding is visible by payer and reason (rcm-claims-ops, 2026-09-17; audit gaps 1, 2, 13 and 14).
 *
 * THE CHECKLIST IS THE HOSPITAL'S. scrubClaim() is PURE and ships no payer rule of its own: the documents a payer wants,
 * how many days it gives to answer a query, whether it needs a signed discharge summary or ICD-10 codes and the amount
 * above which it wants a pre-authorisation are all settings on that payer's contract (payer-connectors.js, Admin >
 * Integrations > Payers), and a package adds the documents its scheme lists (packages.js). A BLOCKING finding refuses
 * submission (billing.js claimAction) until it is fixed or a person overrides it with a reason, which is kept on the
 * claim with who, when and the findings overridden. A WARNING never blocks. A fact that could not be read is never
 * taken as fine: where a rule needs it the finding says it could not be checked, and it blocks like a failed check.
 *
 * BILLING STILL NEVER WRITES THE CHART. Coding candidates come only from the problem list as it stands (conditions the
 * clinician coded from the hospital's loaded ICD-10 set, never a differential or a refuted one), so no candidate can be
 * a code the chart does not hold. Nothing here is AI: the evidence pack is assembled from records, word for word, and a
 * person edits and saves it as a version on the claim.
 *
 * NOTHING HERE SENDS ANYTHING. A payer query, an enhancement or a denial is a fact arriving, recorded by a person; live
 * transport stays behind the payer adapters (wardsynq-tpa-adapter.js, NHCX owner decision: checks and worklists only).
 *
 * THE DESK'S LISTS (rcmWorklists) are tenant-wide reads, capped and said to be capped: discharged but not billed, claims
 * not submitted, open payer queries and enhancements with their clocks, receivables ageing by payer in the hospital's own
 * day bands, and denials by payer, scheme, service and reason. A list that could not be read is null with the reason,
 * never an empty list.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-claims-ops.test.mjs
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { BillingError, CLAIM_STATE, PREAUTH_STATE } from "../../wardsynq/wardsynq-billing.js";
import { payerById } from "../../wardsynq/wardsynq-tpa-adapter.js";
import { reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";
import { assignmentIdFor, packageFlags } from "./packages.js";

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (s) => str(s).toUpperCase();
const DAY = 86400000, HOUR = 3600000;
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const dayOf = (t) => { const v = ms(t); return v == null ? null : new Date(v).toISOString().slice(0, 10); };
const NOT_EVIDENCE = Object.freeze(["refuted", "differential"]);
const READ_LIMIT = 2000;
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const F = (code, text, extra) => ({ code, text, ...(extra || {}) });

/** PURE. The hospital MRN a patient id carries (opd-pat-<mrn>, the id every ward flow derives from an MRN), else null. */
function mrnOf(patientId) {
  const p = str(patientId);
  return /^opd-pat-/.test(p) && !/^opd-pat-(tmp|newborn)-/.test(p) ? p.slice(8).toUpperCase() : null;
}

/* ---- the hospital's claims settings (org config wardsynq.rcm, Admin > Price list > Claims settings) ------------------ */

/** PURE. wardsynq.rcm as the desk reads it: the denial reasons and the ageing day bands, each unusable entry dropped. */
function rcmSettings(wsqCfg) {
  const r = wsqCfg && wsqCfg.rcm && typeof wsqCfg.rcm === "object" ? wsqCfg.rcm : {};
  return validateRcmSettings({ denialReasons: Array.isArray(r.denialReasons) ? r.denialReasons : [], ageingBands: Array.isArray(r.ageingBands) ? r.ageingBands : [] }, { lenient: true }).value;
}

/** PURE. { value, errors }. denialReasons: [{ code, label }], ageingBands: whole days, rising (e.g. 30, 60, 90). */
function validateRcmSettings(input, opts) {
  const lenient = !!(opts && opts.lenient);
  const errors = {};
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!i) return { value: null, errors: { settings: "Send the settings as an object." } };
  const reasons = [];
  for (const x of Array.isArray(i.denialReasons) ? i.denialReasons : []) {
    const code = str(x && x.code), label = str(x && x.label);
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(code) || !label || label.length > 200) { if (!lenient) errors.denialReasons = "Each denial reason has a code (letters, digits, dot, dash or underscore, up to 40) and a label (up to 200 characters)."; continue; }
    if (reasons.some((y) => up(y.code) === up(code))) { if (!lenient) errors.denialReasons = `The denial reason code ${code} is listed twice.`; continue; }
    reasons.push({ code, label });
  }
  if (reasons.length > 100) errors.denialReasons = "At most 100 denial reasons.";
  if (i.denialReasons !== undefined && !Array.isArray(i.denialReasons) && !lenient) errors.denialReasons = "Denial reasons are a list.";
  let bands = [];
  const rawBands = Array.isArray(i.ageingBands) ? i.ageingBands : [];
  for (const b of rawBands) {
    const n = Number(b);
    if (!Number.isInteger(n) || n < 1 || n > 3650) { if (!lenient) errors.ageingBands = "Each ageing band is a whole number of days from 1 to 3650."; continue; }
    bands.push(n);
  }
  if (bands.some((n, k) => k > 0 && n <= bands[k - 1])) { if (lenient) bands = [...new Set(bands)].sort((a, b) => a - b); else errors.ageingBands = "Ageing bands rise, like 30, 60, 90."; }
  if (bands.length > 8) { if (lenient) bands = bands.slice(0, 8); else errors.ageingBands = "At most 8 ageing bands."; }
  return { value: { denialReasons: reasons, ageingBands: bands }, errors };
}

/* ---- a payer's checklist ---------------------------------------------------------------------------------------- */

/** PURE. A payer's claim checklist from its rules. Nothing a payer has not been given a setting for applies. */
function checklistOf(payer) {
  const r = payer && payer.rules && typeof payer.rules === "object" ? payer.rules : {};
  const docs = (Array.isArray(r.claimDocuments) ? r.claimDocuments : str(r.claimDocuments).split(/[;\n]/)).map(str).filter(Boolean);
  return {
    documents: docs.filter((d, k) => docs.findIndex((x) => up(x) === up(d)) === k),
    preauthRequiredAbove: num(r.preauthRequiredAbove),
    queryResponseDays: num(r.queryResponseDays),
    requireSignedDischargeSummary: r.requireSignedDischargeSummary === "yes" || r.requireSignedDischargeSummary === true,
    requireIcd10Codes: r.requireIcd10Codes === "yes" || r.requireIcd10Codes === true,
  };
}

/**
 * PURE. The pre-submission check of one claim.
 * facts: each value is the record, null when there is none, or undefined when it could not be read:
 *   { conditions: Condition[], preAuths: PreAuthorisation[], packageAssignment, encounter, dischargeSummary, invoice }
 * opts: { payer (registry entry or null), submittedAmount?, now? }
 * Returns { blocking: [{code, text, ...}], warnings: [...], clean }.
 */
function scrubClaim(claim, facts, opts) {
  const c = claim || {}, f = facts || {}, o = opts || {};
  const blocking = [], warnings = [];
  const payer = o.payer || null;
  const rules = payer ? checklistOf(payer) : null;
  const nowMs = ms(o.now) || Date.now();
  if (!payer) {
    warnings.push(str(c.payerId) ? F("payer_not_configured", `Payer "${str(c.payerId)}" is not in this hospital's payer list, so its checklist was not checked.`)
      : F("no_payer", "No payer is recorded on this claim, so no payer checklist applies."));
  }
  const pa = f.packageAssignment;
  const pkg = pa && pa.status === "active" && pa.package ? pa.package : null;
  if (pa === undefined) warnings.push(F("package_unreadable", "Whether this stay is on a package could not be read, so the package's documents and pre-authorisation were not checked."));

  /* Documents: the payer's list and the package's claim documents, each marked obtained on the claim by a person. */
  const required = [...(rules ? rules.documents : []), ...(pkg ? (pkg.claimDocuments || []).map(str).filter(Boolean) : [])]
    .filter((d, k, all) => all.findIndex((x) => up(x) === up(d)) === k);
  const have = new Set((Array.isArray(c.documents) ? c.documents : []).map((d) => up(d && d.name)));
  for (const d of required) if (!have.has(up(d))) blocking.push(F("document_missing", `Required document not marked as obtained: ${d}.`, { document: d }));

  /* Pre-authorisation: present, approved, valid on the day of admission, and the amount against the claim. */
  const amount = num(o.submittedAmount) != null ? num(o.submittedAmount) : num(c.submittedAmount);
  const threshold = rules ? rules.preauthRequiredAbove : null;
  const why = pkg && pkg.preAuthRequired ? `the package ${pkg.code} requires one` : threshold != null && amount != null && amount > threshold ? `${str(payer.name) || str(payer.id)} requires one above ${threshold} and this claim is ${amount}` : null;
  const enc = f.encounter;
  const admittedDay = enc ? dayOf(enc.periodStart) : null;
  if (f.preAuths === undefined) {
    if (why) blocking.push(F("preauth_unchecked", `A pre-authorisation is needed (${why}) and the pre-authorisations could not be read, so it could not be checked.`));
  } else {
    const mine = (f.preAuths || []).filter((a) => a && (str(a.id) === str(pa && pa.preAuthId) || !str(c.payerId) || !str(a.payerId) || str(a.payerId) === str(c.payerId)));
    const approved = mine.filter((a) => a.state === PREAUTH_STATE.APPROVED);
    const expiredOn = (a) => (str(a.validUntil) && admittedDay && admittedDay > str(a.validUntil) ? str(a.validUntil) : null);
    const valid = approved.filter((a) => !expiredOn(a));
    if (approved.length && !valid.length) {
      const a = approved[0];
      blocking.push(F("preauth_expired", `The approved pre-authorisation for ${str(a.treatment)} was valid until ${expiredOn(a)}, before the admission on ${admittedDay}.`, { preAuthId: a.id || null }));
    } else if (why && !valid.length) {
      const exp = mine.find((a) => a.state === PREAUTH_STATE.EXPIRED);
      blocking.push(exp ? F("preauth_expired", `The pre-authorisation for ${str(exp.treatment)} has expired, and ${why}.`, { preAuthId: exp.id || null })
        : F("preauth_missing", `No approved pre-authorisation is recorded, and ${why}.`));
    }
    if (valid.length && !admittedDay && valid.some((a) => str(a.validUntil))) warnings.push(F("preauth_validity_unchecked", "The admission date could not be read, so the pre-authorisation's validity was not checked against it."));
    const authorised = valid.map((a) => num(a.authorizedAmount)).filter((x) => x != null);
    if (amount != null && authorised.length && amount > Math.max(...authorised)) {
      warnings.push(F("preauth_amount_exceeded", `This claim is ${amount} and the authorised amount is ${Math.max(...authorised)}. Ask the payer for an enhancement, or record why the difference is claimed.`));
    }
  }
  if (pkg && enc) {
    const flags = packageFlags(pa, enc, null, nowMs);
    if (flags.losExceeded) warnings.push(F("package_los_exceeded", `The stay (${flags.stayDays} days) is longer than the package's expected ${flags.expectedLosDays} days.`));
  }

  /* The signed discharge summary, where the payer asks for it. */
  if (rules && rules.requireSignedDischargeSummary && str(c.encounterId)) {
    const ds = f.dischargeSummary;
    if (ds === undefined) blocking.push(F("discharge_summary_unchecked", "This payer needs a signed discharge summary, and whether it is signed could not be read with this role. A person who can read the chart checks it, or the submission is overridden with a reason."));
    else if (!ds || !str(ds.signedBy)) blocking.push(F("discharge_summary_unsigned", ds ? "The discharge summary for this stay is not signed yet." : "No discharge summary has been written for this stay."));
  }

  /* Coding against the chart: codes from the loaded ICD-10 set, and coded chart conditions of the stay left off. */
  const codes = (Array.isArray(c.codes) ? c.codes : []).map((x) => up(x && x.code)).filter(Boolean);
  if (f.conditions === undefined) {
    if (rules && rules.requireIcd10Codes) blocking.push(F("coding_unchecked", "This payer needs ICD-10 codes, and the problem list could not be read, so the codes could not be checked."));
    else warnings.push(F("coding_unreadable", "The problem list could not be read, so the coding was not checked for completeness."));
  } else {
    const usable = (f.conditions || []).filter((x) => x && !NOT_EVIDENCE.includes(str(x.verificationStatus)));
    if (rules && rules.requireIcd10Codes) {
      for (const code of codes) {
        const hit = usable.find((x) => up(x.code) === code);
        if (!hit || str(hit.codeSystem) !== "icd-10") blocking.push(F("code_not_icd10", `${code} is not on the problem list as an ICD-10 code from this hospital's loaded code set.`, { claimCode: code }));
      }
    }
    for (const x of usable) {
      if (str(x.codeSystem) !== "icd-10" || x.clinicalStatus !== "active" || !str(c.encounterId) || str(x.encounterId) !== str(c.encounterId) || codes.includes(up(x.code))) continue;
      warnings.push(F("chart_condition_not_on_claim", `${up(x.code)} (${str(x.display) || up(x.code)}) is coded on the chart for this stay and is not on the claim.`, { conditionCode: up(x.code) }));
    }
  }

  /* The bill the claim reconciles against. */
  if (str(c.invoiceId)) {
    const inv = f.invoice;
    if (inv === undefined) warnings.push(F("invoice_unreadable", "The bill this claim names could not be read, so the claimed amount was not checked against it."));
    else if (!inv) warnings.push(F("invoice_not_found", `The bill ${str(c.invoiceId)} this claim names was not found.`));
    else if (inv.void) blocking.push(F("invoice_void", `The bill ${str(c.invoiceId)} this claim names has been cancelled.`));
    else {
      const charged = reconciliationOf(inv).charged;
      if (amount != null && amount > charged + 0.005) blocking.push(F("submitted_above_invoice", `The claimed ${amount} is more than the ${charged} charged on bill ${str(c.invoiceId)}.`));
    }
  }
  return { blocking, warnings, clean: !blocking.length };
}

/** PURE. The codes a coder may choose from: coded, non-differential, non-refuted conditions on the chart, and nothing else. */
function codingCandidates(conditions, encounterId) {
  return (conditions || []).filter((x) => x && str(x.code) && !NOT_EVIDENCE.includes(str(x.verificationStatus)) && ["icd-10", "snomed"].includes(str(x.codeSystem)))
    .map((x) => ({ code: str(x.code), display: str(x.display) || str(x.code), codeSystem: str(x.codeSystem), clinicalStatus: x.clinicalStatus || null,
      verificationStatus: x.verificationStatus || null, thisStay: !!(str(encounterId) && str(x.encounterId) === str(encounterId)) }))
    .sort((a, b) => Number(b.thisStay) - Number(a.thisStay) || (a.codeSystem === "icd-10" ? -1 : 1) - (b.codeSystem === "icd-10" ? -1 : 1) || a.code.localeCompare(b.code));
}

/* ---- payer queries, enhancements, documents and denial classification (records arriving, written by a person) ------ */

const qid = (rec, prefix) => `${prefix}-${(rec.payerQueries || []).length + (rec.enhancements || []).length + 1}`;

/** PURE-ish (mutates the copy it is given). A payer's query on a claim or a pre-authorisation, with its clock. */
function recordPayerQuery(rec, { text, receivedAt, responseDays, by, now }) {
  const t = str(text).slice(0, 2000);
  if (!t) throw new BillingError("a payer query records what the payer asked", "NO_TEXT");
  const at = str(now) || new Date().toISOString();
  const rcv = str(receivedAt) ? ms(receivedAt) : ms(at);
  if (rcv == null) throw new BillingError("the date the query was received is a date", "BAD_DATE");
  if (rcv > ms(at) + 60000) throw new BillingError("a query cannot be received in the future", "FUTURE_DATE");
  const days = num(responseDays);
  const q = { id: qid(rec, "q"), text: t, receivedAt: new Date(rcv).toISOString(), recordedAt: at, recordedBy: by,
    dueBy: days != null && days > 0 ? new Date(rcv + days * DAY).toISOString() : null, answeredAt: null, answeredBy: null, answer: null };
  rec.payerQueries = (rec.payerQueries || []).concat([q]);
  if (rec.history) rec.history.push({ at, event: "payer-query", by, detail: t.slice(0, 200) });
  return q;
}

/** PURE-ish. Closes the open queries with the answer. Returns how many were closed. */
function answerOpenQueries(rec, { answer, by, now, queryId }) {
  const a = str(answer).slice(0, 4000);
  if (!a) throw new BillingError("an answer to a payer query says what was sent back", "NO_ANSWER");
  const at = str(now) || new Date().toISOString();
  let n = 0;
  rec.payerQueries = (rec.payerQueries || []).map((q) => {
    if (q.answeredAt || (str(queryId) && q.id !== str(queryId))) return q;
    n += 1;
    return { ...q, answeredAt: at, answeredBy: by, answer: a };
  });
  if (str(queryId) && !n) throw new BillingError("that query is not open on this record", "NO_OPEN_QUERY");
  return n;
}

/** PURE-ish. An enhancement request on an approved pre-authorisation. */
function requestEnhancement(auth, { requestedAmount, reason, by, now }) {
  if (auth.state !== PREAUTH_STATE.APPROVED) throw new BillingError("an enhancement is asked for on an approved pre-authorisation", "NOT_APPROVED");
  const amt = num(requestedAmount);
  if (amt == null || amt <= 0) throw new BillingError("an enhancement names the new total amount asked for", "NO_AMOUNT");
  if (num(auth.authorizedAmount) != null && amt <= num(auth.authorizedAmount)) throw new BillingError(`an enhancement asks for more than the ${auth.authorizedAmount} already authorised`, "NOT_MORE");
  if ((auth.enhancements || []).some((e) => e.state === "requested")) throw new BillingError("an enhancement is already waiting for the payer's decision", "ALREADY_OPEN");
  const r = str(reason).slice(0, 1000);
  if (!r) throw new BillingError("an enhancement says why more is needed", "NO_REASON");
  const at = str(now) || new Date().toISOString();
  const e = { id: qid(auth, "enh"), requestedAmount: amt, reason: r, requestedAt: at, requestedBy: by, previousAuthorizedAmount: num(auth.authorizedAmount), state: "requested", decidedAt: null, decidedBy: null, approvedAmount: null, note: null };
  auth.enhancements = (auth.enhancements || []).concat([e]);
  return e;
}

/** PURE-ish. The payer's decision on the open enhancement. An approval sets the new authorised amount; history stays. */
function decideEnhancement(auth, { enhancementId, state, approvedAmount, note, decidedAt, by, now }) {
  const at = str(now) || new Date().toISOString();
  const e = (auth.enhancements || []).find((x) => x.id === str(enhancementId) && x.state === "requested");
  if (!e) throw new BillingError("that enhancement is not waiting for a decision", "NO_OPEN_ENHANCEMENT");
  if (!["approved", "refused"].includes(str(state))) throw new BillingError("the decision is approved or refused", "BAD_STATE");
  const dAt = str(decidedAt) ? ms(decidedAt) : ms(at);
  if (dAt == null || dAt < ms(e.requestedAt) || dAt > ms(at) + 60000) throw new BillingError("the decision date is between the request and now", "BAD_DATE");
  const amt = num(approvedAmount);
  if (state === "approved" && (amt == null || amt <= 0)) throw new BillingError("an approved enhancement names the new authorised amount", "NO_AMOUNT");
  if (state === "refused" && !str(note)) throw new BillingError("a refused enhancement records the payer's reason", "NO_REASON");
  auth.enhancements = auth.enhancements.map((x) => (x === e ? { ...x, state, decidedAt: new Date(dAt).toISOString(), decidedBy: by, approvedAmount: state === "approved" ? amt : null, note: str(note).slice(0, 1000) || null } : x));
  if (state === "approved") auth.authorizedAmount = amt;
}

/** PURE-ish. Marks documents obtained for the claim, by name. Re-marking a document already marked changes nothing. */
function markDocuments(claim, { documents, by, now }) {
  const names = (Array.isArray(documents) ? documents : []).map((d) => str(typeof d === "string" ? d : d && d.name).slice(0, 200)).filter(Boolean);
  if (!names.length) throw new BillingError("name at least one document", "NO_DOCUMENTS");
  const at = str(now) || new Date().toISOString();
  const cur = Array.isArray(claim.documents) ? claim.documents : [];
  const added = names.filter((n, k) => names.findIndex((x) => up(x) === up(n)) === k && !cur.some((d) => up(d.name) === up(n)));
  claim.documents = cur.concat(added.map((name) => ({ name, markedBy: by, markedAt: at })));
  if (added.length && claim.history) claim.history.push({ at, event: "documents-obtained", by, detail: added.join("; ").slice(0, 300) });
  return added.length;
}

/** PURE-ish. The hospital's reason code and the root cause, on a claim the payer denied. The payer's own words stay. */
function classifyDenial(claim, { denialCode, rootCause, rcm, by, now }) {
  const denied = claim.state === CLAIM_STATE.DENIED || (claim.history || []).some((h) => h && h.event === "denied");
  if (!denied) throw new BillingError("only a claim the payer denied is classified", "NOT_DENIED");
  const reasons = (rcm && rcm.denialReasons) || [];
  if (!reasons.length) throw new BillingError("no denial reasons are set for this hospital (Admin, Price list, Claims settings)", "NO_TAXONOMY");
  const hit = reasons.find((r) => up(r.code) === up(denialCode));
  if (!hit) throw new BillingError("choose one of this hospital's denial reasons", "UNKNOWN_REASON");
  const cause = str(rootCause).slice(0, 1000);
  if (!cause) throw new BillingError("say what caused the denial", "NO_ROOT_CAUSE");
  const at = str(now) || new Date().toISOString();
  claim.denialClassification = { code: hit.code, label: hit.label, rootCause: cause, by, at };
  if (claim.history) claim.history.push({ at, event: "denial-classified", by, detail: `${hit.code}: ${cause.slice(0, 200)}` });
}

/* ---- facts for a claim ------------------------------------------------------------------------------------------ */

const readOr = async (fn) => { try { return await fn(); } catch { return undefined; } };

/** The facts scrubClaim reads, through the actor's own grants. A read the grant refuses is undefined, said as unchecked. */
async function claimFacts(svc, claim, shared) {
  const s = shared || {};
  const enc = str(claim.encounterId), pid = str(claim.patientId);
  const [conditions, preAuths, packageAssignment, encounter, dischargeSummary, invoice] = await Promise.all([
    "conditions" in s ? s.conditions : readOr(() => svc.byPatient("Condition", pid)),
    "preAuths" in s ? s.preAuths : readOr(() => svc.byPatient("PreAuthorisation", pid)),
    enc ? readOr(() => svc.get("PackageAssignment", assignmentIdFor(enc))) : null,
    enc ? readOr(() => svc.get("Encounter", enc)) : null,
    enc ? readOr(() => svc.get("ClinicalNote", dischargeSummaryIdFor(enc))) : null,
    str(claim.invoiceId) ? readOr(() => svc.get("Invoice", str(claim.invoiceId))) : null,
  ]);
  return { conditions, preAuths, packageAssignment, encounter, dischargeSummary, invoice };
}

/* ---- routes ----------------------------------------------------------------------------------------------------- */

async function open(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const resolved = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ...baseOf(mig), ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error" } };
  }
}
function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", message: "This record changed since it was opened. Reload and try again; nothing was saved.", written: 0 };
  return { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made.", written: 0 };
}
const readFailure = (e) => (e instanceof GovernanceError ? { ok: false, status: 403, error: "permission" } : { ok: false, status: 502, error: "record_read_failed", message: "The records could not be read." });
const stripMeta = (r) => { const { meta, version, ...rest } = r; return { rec: rest, version }; };
const OPEN_CLAIM_STATES = [CLAIM_STATE.CODED, CLAIM_STATE.SUBMITTED, CLAIM_STATE.QUERIED, CLAIM_STATE.DENIED];

/**
 * GET /ward/claim-checks. A patient's claims checked before they go: the checklist findings for each open claim and the
 * coding candidates from the chart. ctx: { migration, patientId, payers }
 */
async function claimChecks(request, env, ctx) {
  const base = baseOf(ctx.migration);
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required" };
  const o = await open(request, env, ctx, "record:read");
  if (o.error) return o.error;
  let claims;
  try { claims = (await o.svc.byPatient("Claim", patientId)) || []; } catch (e) { return { ...base, ...readFailure(e) }; }
  const conditions = await readOr(() => o.svc.byPatient("Condition", patientId));
  const preAuths = await readOr(() => o.svc.byPatient("PreAuthorisation", patientId));
  const now = new Date().toISOString();
  const checks = {};
  for (const c of claims.filter((x) => x && OPEN_CLAIM_STATES.includes(x.state))) {
    const facts = await claimFacts(o.svc, c, { conditions, preAuths });
    checks[c.id] = scrubClaim(c, facts, { payer: payerById(ctx.payers, c.payerId), now });
  }
  return { ...base, ok: true, patientId, checks, denialReasons: (ctx.rcm && ctx.rcm.denialReasons) || [], candidates: conditions === undefined ? null : codingCandidates(conditions, ctx.encounterId),
    ...(conditions === undefined ? { candidatesUnreadable: "The problem list is not readable with this role, so no coding candidates are shown." } : {}) };
}

const PREAUTH_ACTIONS = Object.freeze(["query", "answer-query", "enhancement", "enhancement-decision"]);

/** POST /ward/preauth-event. ctx: { migration, preAuthId, action, text?, receivedAt?, answer?, queryId?, requestedAmount?, reason?,
 *  enhancementId?, state?, approvedAmount?, note?, decidedAt?, payers } */
async function preAuthEvent(request, env, ctx) {
  const base = baseOf(ctx.migration);
  const id = str(ctx.preAuthId), action = str(ctx.action);
  if (!id) return { ...base, ok: false, status: 422, error: "preauth_required", written: 0 };
  if (!PREAUTH_ACTIONS.includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", detail: `action must be one of ${PREAUTH_ACTIONS.join(", ")}`, written: 0 };
  const o = await open(request, env, ctx, "record:write");
  if (o.error) return { ...o.error, written: 0 };
  let cur;
  try { cur = await o.svc.get("PreAuthorisation", id); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "preauth_not_found", written: 0 };
  const { rec, version } = stripMeta(cur);
  const by = o.resolved.actor.id, now = new Date().toISOString();
  try {
    if (action === "query") {
      if (![PREAUTH_STATE.REQUESTED, PREAUTH_STATE.APPROVED].includes(rec.state)) throw new BillingError("a payer query is recorded on a requested or approved pre-authorisation", "NOT_OPEN");
      recordPayerQuery(rec, { text: ctx.text, receivedAt: ctx.receivedAt, responseDays: checklistOf(payerById(ctx.payers, rec.payerId)).queryResponseDays, by, now });
    } else if (action === "answer-query") answerOpenQueries(rec, { answer: ctx.answer, queryId: ctx.queryId, by, now });
    else if (action === "enhancement") requestEnhancement(rec, { requestedAmount: ctx.requestedAmount, reason: ctx.reason, by, now });
    else decideEnhancement(rec, { enhancementId: ctx.enhancementId, state: ctx.state, approvedAmount: ctx.approvedAmount, note: ctx.note, decidedAt: ctx.decidedAt, by, now });
  } catch (e) {
    if (e instanceof BillingError) return { ...base, ok: false, status: 422, error: "preauth_refused", code: e.code, detail: e.message, written: 0 };
    throw e;
  }
  try {
    const out = await o.svc.put({ ...rec, resourceType: "PreAuthorisation" }, { expectedVersion: version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, preAuthId: id, action, preAuth: rec, recordVersion: out.record.version, actor: by };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** PURE. The deterministic evidence pack for a payer query or an appeal: facts from the records, and what is not known. */
function evidencePack({ claim, payer, preAuths, conditions, reports, encounter, dischargeSummary, packageAssignment, invoice }) {
  const c = claim;
  const unknown = "Not readable with this role.";
  const line = (label, value) => `${label}: ${value == null || value === "" ? "Not recorded." : value}`;
  const sections = [];
  sections.push({ title: "Claim", lines: [
    line("Claim", c.id), line("Hospital MRN", mrnOf(c.patientId) || c.patientId), line("Payer", payer ? `${str(payer.name) || str(payer.id)}` : str(c.payerId) || null),
    line("Policy number", c.policyNumber), line("Payer reference", c.payerReference), line("State", c.state),
    line("Submitted amount", c.submittedAmount), line("Approved amount", c.approvedAmount), line("Denied amount", c.deniedAmount),
    ...(c.denialReason ? [line("Payer's denial reason", c.denialReason)] : []),
    ...(c.denialClassification ? [line("Hospital's denial reason", `${c.denialClassification.code} ${c.denialClassification.label}`)] : []),
    ...(c.payerQueries || []).map((q) => line(`Payer query received ${dayOf(q.receivedAt)}`, q.text)),
  ] });
  sections.push({ title: "Stay", lines: encounter === undefined ? [unknown] : !encounter ? ["No stay is linked to this claim."]
    : [line("Admitted", encounter.periodStart), line("Discharged", encounter.periodEnd), line("Type of stay", encounter.class), line("Ward", encounter.location && encounter.location.ward)] });
  sections.push({ title: "Diagnoses on the claim and the chart", lines: conditions === undefined ? [unknown]
    : (c.codes || []).map((x) => { const hit = (conditions || []).find((y) => y && up(y.code) === up(x.code)); return `${up(x.code)} ${hit ? `${str(hit.display)} (${str(hit.codeSystem)}, ${str(hit.verificationStatus) || "status not recorded"})` : "(not on the problem list)"}`; }) });
  sections.push({ title: "Pre-authorisations", lines: preAuths === undefined ? [unknown] : !(preAuths || []).length ? ["None recorded."]
    : preAuths.map((a) => `${str(a.treatment)}: ${str(a.state)}${num(a.authorizedAmount) != null ? `, authorised ${a.authorizedAmount}` : ""}${str(a.validUntil) ? `, valid until ${a.validUntil}` : ""}${str(a.payerReference) ? `, payer reference ${a.payerReference}` : ""}`
      + (a.enhancements || []).map((e) => `; enhancement to ${e.requestedAmount} ${e.state}${e.approvedAmount != null ? ` (${e.approvedAmount})` : ""}`).join("")) });
  sections.push({ title: "Investigations reported", lines: reports === undefined ? [unknown] : !(reports || []).length ? ["None reported."]
    : reports.filter((r) => r && ["final", "corrected", "amended"].includes(str(r.status))).map((r) => `${str(r.display) || str(r.code) || "Report"}: ${str(r.status)}, ${dayOf(r.reportedAt || r.issued) || "date not recorded"}`) });
  sections.push({ title: "Discharge summary", lines: [dischargeSummary === undefined ? unknown : !dischargeSummary ? "No discharge summary has been written for this stay."
    : dischargeSummary.signedBy ? "Signed. Attach the signed discharge summary." : "Written and not signed yet."] });
  const pkg = packageAssignment && packageAssignment.status === "active" ? packageAssignment.package : null;
  sections.push({ title: "Package and bill", lines: [
    packageAssignment === undefined ? `Package: ${unknown}` : line("Package", pkg ? `${pkg.code} ${pkg.name}, rate ${pkg.rate}` : "none"),
    invoice === undefined ? `Bill: ${unknown}` : !invoice ? line("Bill", c.invoiceId ? `${c.invoiceId} not found` : null)
      : (() => { const r = reconciliationOf(invoice); return `Bill ${invoice.id}: charged ${r.charged}, balance ${r.balance}${invoice.void ? ", cancelled" : ""}`; })(),
  ] });
  const text = sections.map((s) => `${s.title}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  return { sections, text, note: "Assembled from the records as they stand. Nothing here is written by AI. Edit it before sending; the saved version is kept on the claim." };
}

/** GET /ward/claim-evidence. ctx: { migration, claimId, payers } */
async function claimEvidence(request, env, ctx) {
  const base = baseOf(ctx.migration);
  const claimId = str(ctx.claimId);
  if (!claimId) return { ...base, ok: false, status: 422, error: "claim_required" };
  const o = await open(request, env, ctx, "record:read");
  if (o.error) return o.error;
  let claim;
  try { claim = await o.svc.get("Claim", claimId); } catch (e) { return { ...base, ...readFailure(e) }; }
  if (!claim) return { ...base, ok: false, status: 404, error: "claim_not_found" };
  const facts = await claimFacts(o.svc, claim);
  const reports = await readOr(() => o.svc.byPatient("DiagnosticReport", claim.patientId));
  const { rec, version } = stripMeta(claim);
  return { ...base, ok: true, claimId, recordVersion: version, versions: rec.evidencePacks || [],
    pack: evidencePack({ claim: rec, payer: payerById(ctx.payers, rec.payerId), reports: reports && reports.filter((r) => !str(rec.encounterId) || !str(r.encounterId) || str(r.encounterId) === str(rec.encounterId)), ...facts }) };
}

/** POST /ward/claim-evidence. Saves the edited pack as the next version on the claim. ctx: { migration, claimId, text, expectedVersion } */
async function saveClaimEvidence(request, env, ctx) {
  const base = baseOf(ctx.migration);
  const claimId = str(ctx.claimId), text = String(ctx.text == null ? "" : ctx.text).replace(/\r\n/g, "\n").trim();
  if (!claimId) return { ...base, ok: false, status: 422, error: "claim_required", written: 0 };
  if (!text) return { ...base, ok: false, status: 422, error: "text_required", message: "The pack is empty. Nothing was saved.", written: 0 };
  if (text.length > 20000) return { ...base, ok: false, status: 422, error: "text_too_long", message: "The pack is at most 20000 characters. Nothing was saved.", written: 0 };
  const o = await open(request, env, ctx, "record:write");
  if (o.error) return { ...o.error, written: 0 };
  let cur;
  try { cur = await o.svc.get("Claim", claimId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "claim_not_found", written: 0 };
  const { rec, version } = stripMeta(cur);
  if (Number(ctx.expectedVersion) !== version) return { ...base, ok: false, status: 409, error: "version_conflict", message: "This claim changed since the pack was opened. Reload and try again; nothing was saved.", written: 0 };
  const at = new Date().toISOString(), by = o.resolved.actor.id;
  const n = (rec.evidencePacks || []).length + 1;
  rec.evidencePacks = (rec.evidencePacks || []).concat([{ n, at, by, text }]);
  rec.history = (rec.history || []).concat([{ at, event: "evidence-pack-saved", by, detail: `version ${n}` }]);
  try {
    const out = await o.svc.put({ ...rec, resourceType: "Claim" }, { expectedVersion: version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, claimId, packVersion: n, recordVersion: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/* ---- the desk's lists (PURE over rows) ---------------------------------------------------------------------------- */

const payerLabel = (payers, ref) => { const p = payerById(payers, ref); return p ? str(p.name) || str(p.id) : str(ref) || null; };

/** PURE. Whether a live bill covers a stay: raised for it, or carrying its package line or its bed days. */
function stayBilled(invoices, encounterId) {
  const e = str(encounterId);
  return (invoices || []).some((i) => i && !i.void && (str(i.encounterId) === e
    || (i.lines || []).some((l) => l && ((l.sourceType === "Encounter" && str(l.sourceId).startsWith(e + ":")) || (l.sourceType === "PackageAssignment" && str(l.sourceId) === assignmentIdFor(e))))));
}

/** PURE. Receivables ageing: each live bill's balance by payer in the hospital's day bands, from the day it was raised. */
function ageingOf(invoices, { payers, bands, nowMs }) {
  const b = Array.isArray(bands) ? bands : [];
  const labels = b.length ? b.map((d, k) => (k === 0 ? `0-${d}` : `${b[k - 1] + 1}-${d}`)).concat([`over ${b[b.length - 1]}`]) : [];
  const rows = new Map();
  const totals = { buckets: labels.map(() => 0), outstanding: 0, credit: 0, invoices: 0 };
  let balanceSum = 0;
  for (const inv of (invoices || []).filter((i) => i && !i.void && !isExternalRecord(i))) {
    const r = reconciliationOf(inv);
    balanceSum += r.balance;
    if (r.balance <= 0) { totals.credit = round2(totals.credit + r.creditBalance); continue; }
    const p = inv.parties;
    const key = !p ? "not_recorded" : p.selfPay ? "self_pay" : str(p.payer && p.payer.ref) || "not_recorded";
    const row = rows.get(key) || { payerRef: ["not_recorded", "self_pay"].includes(key) ? null : key, kind: ["not_recorded", "self_pay"].includes(key) ? key : "payer",
      payerName: ["not_recorded", "self_pay"].includes(key) ? null : payerLabel(payers, key) || (p.payer && p.payer.name) || key, buckets: labels.map(() => 0), total: 0, invoices: 0, oldestDays: 0 };
    const raised = ms((inv.events || [])[0] && inv.events[0].at);
    const days = raised == null ? null : Math.max(0, Math.floor((nowMs - raised) / DAY));
    if (labels.length) {
      const k = days == null ? labels.length - 1 : b.findIndex((d) => days <= d);
      const idx = k < 0 ? labels.length - 1 : k;
      row.buckets[idx] = round2(row.buckets[idx] + r.balance);
      totals.buckets[idx] = round2(totals.buckets[idx] + r.balance);
    }
    row.total = round2(row.total + r.balance); row.invoices += 1; row.oldestDays = Math.max(row.oldestDays, days || 0);
    totals.outstanding = round2(totals.outstanding + r.balance); totals.invoices += 1;
    rows.set(key, row);
  }
  return {
    bandsConfigured: labels.length > 0, labels,
    payers: [...rows.values()].sort((x, y) => y.total - x.total),
    totals,
    /* The reconciliation the desk can trust: the aged amounts, less credit balances, are the balances of every live bill. */
    netOutstanding: round2(totals.outstanding - totals.credit),
    reconciles: round2(totals.outstanding - totals.credit) === round2(balanceSum) && (!labels.length || round2(totals.buckets.reduce((a, x) => a + x, 0)) === totals.outstanding),
  };
}

/** PURE. Denials by payer, scheme, service and reason, for denials recorded in the period; partial disallowances beside them. */
function denialAnalytics(claims, { payers, assignments, encounters, fromMs, toMs }) {
  const inP = (t) => { const v = ms(t); return v != null && (fromMs == null || v >= fromMs) && (toMs == null || v <= toMs); };
  const group = () => new Map();
  const by = { payer: group(), scheme: group(), service: group(), reason: group() };
  const add = (m, key, label, amount) => { const g = m.get(key) || { key, label, count: 0, amount: 0, amountNotRecorded: 0 }; g.count += 1; if (amount == null) g.amountNotRecorded += 1; else g.amount = round2(g.amount + amount); m.set(key, g); };
  const list = [];
  const disallowed = group();
  for (const c of (claims || []).filter(Boolean)) {
    const denial = (c.history || []).filter((h) => h && h.event === "denied" && inP(h.at)).pop();
    const pa = assignments === undefined ? undefined : (assignments || []).find((a) => a && a.status === "active" && str(a.encounterId) === str(c.encounterId));
    const enc = encounters === undefined ? undefined : (encounters || []).find((e) => e && str(e.id) === str(c.encounterId));
    const payer = payerById(payers, c.payerId);
    const scheme = pa === undefined ? ["unreadable", "Not readable"] : pa ? [pa.package.scheme, pa.package.scheme] : payer && payer.contract && payer.contract.payerKind ? [payer.contract.payerKind, payer.contract.payerKind] : ["not_recorded", "Not recorded"];
    const service = enc === undefined ? ["unreadable", "Not readable"] : enc ? [str(enc.class) || "not_recorded", str(enc.class) || "Not recorded"] : ["not_recorded", "Not recorded"];
    if (denial) {
      const amount = num(c.deniedAmount) != null ? num(c.deniedAmount) : num(c.submittedAmount);
      const cls = c.denialClassification;
      add(by.payer, str(c.payerId) || "none", payerLabel(payers, c.payerId) || "No payer", amount);
      add(by.scheme, scheme[0], scheme[1], amount);
      add(by.service, service[0], service[1], amount);
      add(by.reason, cls ? cls.code : "unclassified", cls ? cls.label : "Not classified", amount);
      list.push({ claimId: c.id, patientId: c.patientId, mrn: mrnOf(c.patientId), payerName: payerLabel(payers, c.payerId), deniedAt: denial.at, payerReason: c.denialReason || denial.detail || null,
        code: cls ? cls.code : null, label: cls ? cls.label : null, rootCause: cls ? cls.rootCause : null, amount, state: c.state });
    }
    const st = c.settlement;
    if (st && inP(st.at)) for (const d of st.disallowances || []) {
      const key = `${str(c.payerId) || "none"}|${up(d.reason)}`;
      const g = disallowed.get(key) || { payerName: payerLabel(payers, c.payerId) || "No payer", reason: d.reason, count: 0, amount: 0 };
      g.count += 1; g.amount = round2(g.amount + (num(d.amount) || 0)); disallowed.set(key, g);
    }
  }
  const out = (m) => [...m.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
  return { count: list.length, byPayer: out(by.payer), byScheme: out(by.scheme), byService: out(by.service), byReason: out(by.reason),
    claims: list.sort((a, b) => str(b.deniedAt).localeCompare(str(a.deniedAt))), disallowances: [...disallowed.values()].sort((a, b) => b.amount - a.amount) };
}

/** PURE. Every desk list from the rows read; a type that could not be read makes the lists needing it null, with the reason. */
function buildWorklists({ rows, unreadable, payers, rcm, nowMs, fromMs, toMs }) {
  const R = rows || {}, U = unreadable || {};
  const bad = (...types) => types.filter((t) => U[t]).map((t) => `${t}: ${U[t]}`).join("; ") || null;
  const days = (t) => { const v = ms(t); return v == null ? null : Math.max(0, Math.floor((nowMs - v) / DAY)); };
  const out = { unreadable: {} };

  const stays = (R.Encounter || []).filter((e) => e && !isExternalRecord(e) && ADMISSION_CLASSES.includes(e.class) && e.status === "finished" && str(e.periodEnd));
  const payerOf = new Map((R.StayPayer || []).filter(Boolean).map((s) => [str(s.encounterId), s]));
  const why1 = bad("Encounter", "Invoice");
  if (why1) { out.dnfb = null; out.unreadable.dnfb = why1; }
  else out.dnfb = stays.filter((e) => !stayBilled(R.Invoice, e.id)).map((e) => {
    const sp = payerOf.get(str(e.id));
    return { patientId: e.patientId, mrn: mrnOf(e.patientId), encounterId: e.id, class: e.class, ward: (e.location && e.location.ward) || null, dischargedAt: e.periodEnd, days: days(e.periodEnd),
      payerRef: sp ? sp.payerRef || null : null, payerName: sp && sp.payerRef ? payerLabel(payers, sp.payerRef) : null };
  }).sort((a, b) => (b.days || 0) - (a.days || 0));

  const why2 = bad("Claim", "Encounter", "StayPayer");
  if (why2) { out.unsubmitted = null; out.unreadable.unsubmitted = why2; }
  else {
    const claims = (R.Claim || []).filter(Boolean);
    const coded = claims.filter((c) => c.state === CLAIM_STATE.CODED).map((c) => {
      const payer = payerById(payers, c.payerId);
      const enc = stays.find((e) => str(e.id) === str(c.encounterId));
      const tf = num(payer && payer.rules && payer.rules.timelyFilingDays);
      const from = enc ? enc.periodEnd : c.at;
      return { kind: "coded_not_submitted", claimId: c.id, patientId: c.patientId, mrn: mrnOf(c.patientId), encounterId: c.encounterId, payerId: c.payerId || null, payerName: payerLabel(payers, c.payerId),
        since: from, days: days(from), filingDaysLeft: tf != null && days(from) != null ? tf - days(from) : null };
    });
    const noClaim = stays.filter((e) => { const sp = payerOf.get(str(e.id)); return sp && sp.payerRef && !claims.some((c) => str(c.encounterId) === str(e.id)); }).map((e) => {
      const sp = payerOf.get(str(e.id));
      return { kind: "no_claim", claimId: null, patientId: e.patientId, mrn: mrnOf(e.patientId), encounterId: e.id, payerId: sp.payerRef, payerName: payerLabel(payers, sp.payerRef), since: e.periodEnd, days: days(e.periodEnd), filingDaysLeft: null };
    });
    out.unsubmitted = coded.concat(noClaim).sort((a, b) => (b.days || 0) - (a.days || 0));
  }

  const why3 = bad("Claim", "PreAuthorisation");
  if (why3) { out.queries = null; out.unreadable.queries = why3; }
  else {
    const q = [];
    const clock = (x) => { const due = ms(x.dueBy); return { ageHours: Math.floor((nowMs - (ms(x.receivedAt || x.requestedAt) || nowMs)) / HOUR), dueBy: x.dueBy || null, overdue: due != null && due < nowMs }; };
    for (const [subject, list] of [["claim", R.Claim], ["preauth", R.PreAuthorisation]]) {
      for (const r of (list || []).filter(Boolean)) {
        for (const x of (r.payerQueries || []).filter((y) => !y.answeredAt)) q.push({ subject, kind: "query", recordId: r.id, patientId: r.patientId, mrn: mrnOf(r.patientId), payerName: payerLabel(payers, r.payerId), text: x.text, queryId: x.id, receivedAt: x.receivedAt, ...clock(x) });
        for (const x of (r.enhancements || []).filter((y) => y.state === "requested")) q.push({ subject, kind: "enhancement", recordId: r.id, patientId: r.patientId, mrn: mrnOf(r.patientId), payerName: payerLabel(payers, r.payerId), requestedAmount: x.requestedAmount, enhancementId: x.id, receivedAt: x.requestedAt, ...clock(x) });
      }
    }
    out.queries = q.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.ageHours - a.ageHours);
  }

  const why4 = bad("Invoice");
  if (why4) { out.ageing = null; out.unreadable.ageing = why4; }
  else out.ageing = ageingOf(R.Invoice, { payers, bands: rcm && rcm.ageingBands, nowMs });

  const why5 = bad("Claim");
  if (why5) { out.denials = null; out.unreadable.denials = why5; }
  else out.denials = denialAnalytics(R.Claim, { payers, assignments: U.PackageAssignment ? undefined : R.PackageAssignment, encounters: U.Encounter ? undefined : R.Encounter, fromMs, toMs });
  return out;
}

/** GET /ward/rcm-worklists. ctx: { migration, payers, rcm, from?, to? } */
async function rcmWorklists(request, env, ctx) {
  const base = baseOf(ctx.migration);
  const o = await open(request, env, ctx, "record:read");
  if (o.error) return o.error;
  const types = ["Claim", "PreAuthorisation", "Invoice", "Encounter", "StayPayer", "PackageAssignment"];
  const rows = {}, unreadable = {};
  let truncated = false;
  await Promise.all(types.map(async (t) => {
    try { rows[t] = ((await o.svc.list(t, READ_LIMIT)) || []).filter(Boolean); if (rows[t].length >= READ_LIMIT) truncated = true; }
    catch (e) { unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : "could not be read"; rows[t] = []; }
  }));
  const nowMs = Date.now();
  const fromMs = ms(ctx.from), toMs = ms(ctx.to);
  return { ...base, ok: true, generatedAt: new Date(nowMs).toISOString(), truncated, readLimit: READ_LIMIT,
    denialReasonsConfigured: !!(ctx.rcm && ctx.rcm.denialReasons.length), denialReasons: (ctx.rcm && ctx.rcm.denialReasons) || [],
    period: { from: fromMs == null ? null : new Date(fromMs).toISOString(), to: toMs == null ? null : new Date(toMs).toISOString() },
    ...buildWorklists({ rows, unreadable, payers: ctx.payers, rcm: ctx.rcm, nowMs, fromMs, toMs }) };
}

export {
  mrnOf, rcmSettings, validateRcmSettings, checklistOf, scrubClaim, codingCandidates,
  recordPayerQuery, answerOpenQueries, requestEnhancement, decideEnhancement, markDocuments, classifyDenial,
  claimFacts, evidencePack, stayBilled, ageingOf, denialAnalytics, buildWorklists,
  claimChecks, preAuthEvent, claimEvidence, saveClaimEvidence, rcmWorklists,
};
