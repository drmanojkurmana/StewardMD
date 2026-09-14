/* functions/_wardsynq/portal-view.js - the parts of the patient portal beyond #940's copy, and WHO may
 * see WHICH part.
 *
 * #948 opened a read-only door onto the patient's own copy. P2.9 adds the rest of what a patient is
 * owed - a discharge summary, the bills, the consents on file - and a second kind of door: a family
 * member or carer the patient has agreed may look. Three rules, each enforced here on the server and
 * never by what the page chooses to draw:
 *
 * ONLY WHAT WAS RELEASED. A discharge summary is a clinician's document written for the next doctor.
 * It reaches the portal only when a clinician's recorded handover (PatientRecordRelease) named that
 * exact signed version. A later correction is not shown until it is released in its turn. Only the
 * patient-facing sections go out: the admission, the medicines and the plan (care instructions).
 * Investigations and the assessment stay off, because they would bypass #940's withholding of
 * results with an open critical loop and of differentials.
 *
 * A PROXY SEES ONLY ITS GRANT. The sections a family member may see are written onto the grant at
 * enrolment, with who consented and how, and every read and write takes them FROM THE GRANT. A
 * section not granted is not read at all. A proxy can never withdraw a consent: that decision is the
 * patient's own.
 *
 * A PATIENT MAY WITHDRAW ONLY DATA-USE CONSENTS HERE. Sharing, registry, research and photography are
 * choices about the record, and withdrawing one online harms nobody. Consent to treatment, to a
 * procedure or to blood products is withdrawn by talking to the team who will act on it; a portal
 * click that silently cancelled consent for tomorrow's operation is the failure mode.
 */

import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { RecordService, isExternalRecord } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { PatientConsent, SCOPES, statusOf as consentStatusOf, TYPE as CONSENT_TYPE } from "./consent.js";
import { reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RELEASE_TYPE = "PatientRecordRelease";

/** Everything the portal can show. A patient's own grant sees all of it; a proxy sees what it names. */
const SECTIONS = Object.freeze(["appointments", "medicines", "results", "diagnoses", "discharge", "bills", "consents", "messages"]);
/** Consents a patient may withdraw from the portal. Data use only - see the header. */
const PATIENT_WITHDRAWABLE = Object.freeze(["share-external", "share-registry", "research", "photography"]);
/** Who may agree to a proxy. The patient, or the person legally deciding for them. Never the proxy. */
const PROXY_CONSENT_FROM = Object.freeze(["patient", "legal-guardian", "power-of-attorney"]);
const PROXY_CONSENT_METHOD = Object.freeze(["in-person-verbal", "in-person-written"]);

/** PURE. The sections this grant may see. A proxy with no sections sees nothing, never everything. */
function grantSections(grant) {
  const g = grant || {};
  if (!g.proxy) return SECTIONS.slice();
  const want = Array.isArray(g.proxy.sections) ? g.proxy.sections.map(str) : [];
  return SECTIONS.filter((s) => want.includes(s));
}

/** PURE. The audit identity of a portal reader. A proxy is never recorded as the patient. */
function readerId(grant) {
  const g = grant || {};
  return g.proxy ? `proxy:${str(g.proxy.relatedPersonId)}:for:${str(g.patientId)}` : `patient:${str(g.patientId)}`;
}

/** PURE. Validates a proxy request at enrolment. Returns { proxy } or { error, detail }. */
function proxyFrom(input) {
  const i = input || {};
  const relatedPersonId = str(i.relatedPersonId);
  if (!relatedPersonId) return { error: "related_person_required", detail: "a proxy is a contact already on the patient's record; add them first" };
  const sections = [...new Set((Array.isArray(i.sections) ? i.sections : []).map(str))];
  if (sections.some((s) => !SECTIONS.includes(s))) return { error: "unknown_section", detail: `sections must be from ${SECTIONS.join(", ")}` };
  if (!sections.length) return { error: "sections_required", detail: "name what this person may see; a proxy is never given everything by default" };
  const consentFrom = str(i.consentFrom), consentMethod = str(i.consentMethod);
  if (!PROXY_CONSENT_FROM.includes(consentFrom)) return { error: "consent_from_required", detail: `record who agreed: ${PROXY_CONSENT_FROM.join(", ")}` };
  if (!PROXY_CONSENT_METHOD.includes(consentMethod)) return { error: "consent_method_required", detail: `record how they agreed: ${PROXY_CONSENT_METHOD.join(", ")}` };
  return { proxy: { relatedPersonId, sections, consentFrom, consentMethod, consentNote: str(i.consentNote) || null } };
}

/** The reader for the portal-only record types. Separate from patientActor, which stays the handout's reader. */
function portalReader(grant) {
  return makeActor({
    id: readerId(grant), kind: KIND.HUMAN, tier: TIER.READ,
    scope: { read: ["ClinicalNote", RELEASE_TYPE, "Invoice", CONSENT_TYPE], write: [] },
  });
}

function serviceFor(ctx, actor) {
  return new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: { id: ctx.migration.tenantId }, actor, role: "patient-portal", roleSource: "wardsynq-patient-access",
  });
}

/** PURE. Signed discharge summaries whose EXACT version a clinician's handover named. */
function releasedDischargeSummaries(notes, releases) {
  const named = new Set();
  for (const r of releases || []) for (const d of (r && r.dischargeSummaries) || []) named.add(`${str(d && d.id)}|${Number(d && d.version)}`);
  return (notes || []).filter((n) => n && n.noteType === "discharge-summary" && n.signedBy && named.has(`${str(n.id)}|${Number(n.version)}`))
    .map((n) => {
      const s = n.sections || {};
      return { id: n.id, admission: s.admission || null, medicines: s.medications || null, careInstructions: s.plan || null };
    });
}

/** PURE. The patient's bills. Amounts and state only: who took a payment is not the patient's page. */
function billView(invoices) {
  return (invoices || []).filter(Boolean).filter((i) => !isExternalRecord(i)).map((inv) => {
    const r = reconciliationOf(inv);
    return {
      invoiceId: inv.id, currency: r.currency, charged: r.charged, discounted: r.discounted, paid: r.paidIn,
      refunded: r.refundedOut, balance: r.balance, status: r.status,
      lines: (inv.lines || []).map((l) => ({ item: l.display || l.code, quantity: l.quantity, amount: l.line })),
    };
  }).sort((a, b) => String(b.invoiceId).localeCompare(String(a.invoiceId)));
}

/** PURE. Consents on file, and which of them this reader may withdraw here. */
function consentView(consents, ownAccess, nowMs) {
  return (consents || []).filter(Boolean).map((c) => {
    const status = consentStatusOf(c, nowMs);
    return {
      consentId: c.id, scope: c.scope, scopeLabel: SCOPES[c.scope] || c.scope, status, detail: c.detail || null,
      recordedAt: c.recordedAt || null, validUntil: c.validUntil || null, withdrawnAt: c.withdrawnAt || null,
      canWithdraw: !!ownAccess && status === "granted" && PATIENT_WITHDRAWABLE.includes(c.scope),
    };
  });
}

/**
 * The portal-only sections, each read only if the grant allows it.
 * A failed read is reported as failed for that section, never as an empty one.
 */
async function portalExtras(ctx, grant) {
  const sections = grantSections(grant);
  const patientId = str(grant.patientId);
  const svc = serviceFor(ctx, portalReader(grant));
  const out = { failed: [] };
  const read = async (type) => { try { return (await svc.byPatient(type, patientId)) || []; } catch (_) { return null; } };
  if (sections.includes("discharge")) {
    const [notes, releases] = await Promise.all([read("ClinicalNote"), read(RELEASE_TYPE)]);
    if (notes === null || releases === null) out.failed.push("discharge");
    else out.dischargeSummaries = releasedDischargeSummaries(notes, releases);
  }
  if (sections.includes("bills")) {
    const rows = await read("Invoice");
    if (rows === null) out.failed.push("bills"); else out.bills = billView(rows);
  }
  if (sections.includes("consents")) {
    const rows = await read(CONSENT_TYPE);
    if (rows === null) out.failed.push("consents"); else out.consents = consentView(rows, !grant.proxy, Date.now());
  }
  return out;
}

/** PURE. Removes what a grant does not allow from #940's document. The server does this, not the page. */
function scopeDocument(doc, sections) {
  if (!doc) return doc;
  if (SECTIONS.every((x) => sections.includes(x))) return doc;
  const has = (s) => sections.includes(s);
  return {
    patient: doc.patient ? { name: doc.patient.name || null } : null,
    ...(has("diagnoses") ? { diagnoses: doc.diagnoses, excludedDiagnoses: doc.excludedDiagnoses, allergies: doc.allergies } : {}),
    ...(has("medicines") ? { medicines: doc.medicines } : {}),
    ...(has("results") ? { results: doc.results, withheldResults: doc.withheldResults } : {}),
    ...(has("appointments") ? { appointments: doc.appointments } : {}),
  };
}

/**
 * The patient withdraws one of their own data-use consents.
 * session: the verified result of sessionPatient() - the patient id comes from there and nowhere else.
 * ctx: { migration, recordDeps, consentId, reason }
 */
async function withdrawOwnConsent(ctx, session) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid", written: 0 };
  if (session.proxy) return { ...base, ok: false, status: 403, error: "patient_only", detail: "Only the patient can withdraw their consent.", written: 0 };
  const consentId = str(ctx.consentId);
  if (!consentId) return { ...base, ok: false, status: 422, error: "consent_required", written: 0 };
  const patientId = str(session.patientId);
  const actor = makeActor({ id: `patient:${patientId}`, kind: KIND.HUMAN, tier: TIER.DRAFT, scope: { read: [CONSENT_TYPE], write: [CONSENT_TYPE] } });
  const svc = serviceFor(ctx, actor);
  let current;
  try { current = await svc.get(CONSENT_TYPE, consentId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  /* Another patient's consent and a missing one answer the same: not found. */
  if (!current || str(current.patientId) !== patientId) return { ...base, ok: false, status: 404, error: "consent_not_found", written: 0 };
  if (!PATIENT_WITHDRAWABLE.includes(current.scope)) {
    return { ...base, ok: false, status: 409, error: "withdraw_in_person", written: 0,
      detail: "This consent is about your treatment. To withdraw it, speak to your care team so they can act on it straight away." };
  }
  if (consentStatusOf(current) !== "granted") return { ...base, ok: true, written: 0, skipped: "not_granted", consentId };
  const { meta, version, ...rest } = current;
  const now = new Date().toISOString();
  const next = PatientConsent({ ...rest, decision: "withdrawn", withdrawnBy: `patient:${patientId}`, withdrawnAt: now,
    withdrawalReason: str(ctx.reason) || "Withdrawn by the patient in the portal." });
  try {
    await svc.put(next, { expectedVersion: version });
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", written: 0 };
  }
  return { ...base, ok: true, written: 1, consentId, status: "withdrawn", withdrawnAt: now,
    note: "Your consent is withdrawn from now. Your care team can see this on your record." };
}

export {
  SECTIONS, PATIENT_WITHDRAWABLE, PROXY_CONSENT_FROM, PROXY_CONSENT_METHOD,
  grantSections, readerId, proxyFrom, portalReader, releasedDischargeSummaries, billView, consentView,
  portalExtras, scopeDocument, withdrawOwnConsent,
};
