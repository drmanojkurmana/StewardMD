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
 * exact signed version. A later correction is not shown until it is released in its turn. A patient
 * copy release sends only the patient-facing sections: the admission, the medicines and the plan (care
 * instructions). Investigations and the assessment go out only in a full release, and even then not
 * past #940's withholding of results with an open critical loop and of differentials (below).
 *
 * A PROXY SEES ONLY ITS GRANT. The sections a family member may see are written onto the grant at
 * enrolment, with who consented and how, and every read and write takes them FROM THE GRANT. A
 * section not granted is not read at all. A proxy can never withdraw a consent: that decision is the
 * patient's own.
 *
 * P2 GAPS, three more sections, each on the same rules:
 *
 * QUEUE STATUS ("status"). Today's OPD tickets for this patient in this hospital, linked the way the
 * queue itself files a ticket under a patient (opd-identity.js patientIdForTicket, from the MRN). A
 * link two different MRN spellings could both produce is not a link: nothing is shown and the patient
 * is told to ask at the desk. Another patient in the same queue is only ever a count.
 *
 * RELEASED DOCUMENTS ("documents"). A document reaches the portal only when a clinician's
 * PatientRecordRelease named that exact document version. The bytes come through the same encrypted
 * store and integrity check the staff link uses, and never while the document is withdrawn, purged or
 * past retention. No object-store key or address is ever returned.
 *
 * FULL DISCHARGE SUMMARY ("discharge-full"). A release says "patient-copy" (the three sections above)
 * or "full". Even a full release withholds what #940 withholds, computed from the SAME assembled copy
 * the page already reads: free text cannot be checked result by result, so while any result is
 * withheld the sections that can quote one stay withheld, and while any entry is only a possibility
 * the diagnosis section does.
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
import { TYPE as DOC_TYPE, docKey, decryptBytes } from "./documents.js";
import { sha256Hex } from "./object-store.js";
import { patientIdForTicket } from "./opd-identity.js";
import { orderQueue, isQueued } from "../_queue_eta.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RELEASE_TYPE = "PatientRecordRelease";

/** Everything the portal can show. A patient's own grant sees all of it; a proxy sees what it names. */
const SECTIONS = Object.freeze(["status", "appointments", "medicines", "results", "diagnoses", "discharge", "discharge-full", "documents", "bills", "consents", "messages"]);
/** How a discharge summary was released. Absent means patient copy: every release before P2 was one. */
const DISCHARGE_SCOPES = Object.freeze(["patient-copy", "full"]);
/** The signed summary's sections, in reading order. `provenance` is a note to the signing clinician. */
const FULL_SECTIONS = Object.freeze(["admission", "diagnoses", "allergies", "vitals", "investigations", "medications", "homeMedicines", "assessment", "plan"]);
/* Free text that can quote a result (the requests and their state, the clinician's assessment), and
 * the section that can name a possibility as a diagnosis. */
const RESULT_TEXT = Object.freeze(["investigations", "assessment"]);
const WITHHELD_SAY = "Withheld until your care team discusses it with you.";
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
function portalReader(grant) { return readerActor(readerId(grant)); }
function readerActor(id) {
  return makeActor({
    id, kind: KIND.HUMAN, tier: TIER.READ,
    scope: { read: ["Patient", "ClinicalNote", RELEASE_TYPE, "Invoice", CONSENT_TYPE, DOC_TYPE], write: [] },
  });
}

function serviceFor(ctx, actor) {
  return new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: { id: ctx.migration.tenantId }, actor, role: "patient-portal", roleSource: "wardsynq-patient-access",
  });
}

/**
 * PURE. Signed discharge summaries whose EXACT version a clinician's handover named.
 *
 * opts: { patientCopy, full } - which of the two views this grant may see - and { withheldResults,
 * excludedDiagnoses }, the counts from #940's assembled copy. Without opts it is the patient copy.
 * A version released both ways is full: that handover happened.
 */
function releasedDischargeSummaries(notes, releases, opts) {
  const o = opts || { patientCopy: true };
  const named = new Map();
  for (const r of releases || []) for (const d of (r && r.dischargeSummaries) || []) {
    const key = `${str(d && d.id)}|${Number(d && d.version)}`;
    if (named.get(key) !== "full") named.set(key, str(d && d.scope) === "full" ? "full" : "patient-copy");
  }
  return (notes || []).filter((n) => n && n.noteType === "discharge-summary" && n.signedBy && named.has(`${str(n.id)}|${Number(n.version)}`))
    .map((n) => {
      const s = n.sections || {};
      if (named.get(`${str(n.id)}|${Number(n.version)}`) === "full" && o.full) {
        const hideResults = Number(o.withheldResults) > 0, hideDx = Number(o.excludedDiagnoses) > 0;
        return { id: n.id, scope: "full", sections: FULL_SECTIONS.filter((k) => str(s[k])).map((k) =>
          (hideResults && RESULT_TEXT.includes(k)) || (hideDx && k === "diagnoses") ? { key: k, withheld: true, say: WITHHELD_SAY } : { key: k, text: s[k] }) };
      }
      if (!o.patientCopy) return null;
      return { id: n.id, scope: "patient-copy", admission: s.admission || null, medicines: s.medications || null, careInstructions: s.plan || null };
    }).filter(Boolean);
}

/** PURE. The released versions a set of releases names, as "id|version". */
function releasedDocumentKeys(releases) {
  const out = new Set();
  for (const r of releases || []) for (const d of (r && r.documents) || []) out.add(`${str(d && d.id)}|${Number(d && d.version)}`);
  return out;
}

/**
 * PURE. Why a released document version cannot be handed out now, or null when it can.
 * Judged on the document's LATEST version: a withdrawal or purge after release is a later version.
 */
function documentUnavailable(latest, nowMs) {
  const l = latest || {};
  if (l.status === "entered-in-error") return { reason: "withdrawn", say: "This document was withdrawn by the hospital." };
  if (l.status !== "current") return { reason: "unavailable", say: "This document is no longer available." };
  const until = Date.parse(str(l.retainUntil));
  /* Unreadable retention fails closed, like every other date the portal cannot establish. */
  if (!Number.isFinite(until) || until <= nowMs) return { reason: "retention_ended", say: "This document is no longer available." };
  return null;
}

/**
 * PURE. The portal's document list. histories: { [documentId]: versions oldest first }.
 * A withdrawn document keeps its row but loses its title: the title of a document filed against the
 * wrong patient is itself somebody else's information.
 */
function releasedDocuments(histories, releases, patientId, nowMs) {
  const out = [];
  for (const key of releasedDocumentKeys(releases)) {
    const [id, v] = key.split("|");
    const versions = (histories && histories[id]) || [];
    const rec = versions.find((x) => Number(x.version) === Number(v));
    const latest = versions[versions.length - 1];
    if (!rec || str(rec.patientId) !== str(patientId)) continue;
    const gone = documentUnavailable(latest, nowMs);
    out.push(gone ? { documentId: id, version: rec.version, unavailable: gone.reason, say: gone.say }
      : { documentId: id, version: rec.version, title: rec.title || null, docType: rec.docType || null, uploadedAt: rec.uploadedAt || null });
  }
  return out.sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
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
 * doc: #940's assembled copy, for its withholding counts.
 */
async function portalExtras(ctx, grant, doc) {
  const sections = grantSections(grant);
  const patientId = str(grant.patientId);
  const svc = serviceFor(ctx, portalReader(grant));
  const out = { failed: [] };
  const read = async (type) => { try { return (await svc.byPatient(type, patientId)) || []; } catch (_) { return null; } };
  const wantDischarge = sections.includes("discharge") || sections.includes("discharge-full");
  const releases = wantDischarge || sections.includes("documents") ? await read(RELEASE_TYPE) : [];
  if (wantDischarge) {
    const notes = await read("ClinicalNote");
    if (notes === null || releases === null) out.failed.push("discharge");
    else out.dischargeSummaries = releasedDischargeSummaries(notes, releases, {
      patientCopy: sections.includes("discharge"), full: sections.includes("discharge-full"),
      /* No assembled copy means the withholding cannot be established, so everything it guards stays withheld. */
      withheldResults: doc ? (doc.withheldResults || []).length : 1, excludedDiagnoses: doc ? doc.excludedDiagnoses : 1,
    });
  }
  if (sections.includes("documents")) {
    try {
      if (releases === null) throw new Error("releases");
      const histories = {};
      for (const key of releasedDocumentKeys(releases)) {
        const id = key.split("|")[0];
        if (!histories[id]) histories[id] = (await svc.history(DOC_TYPE, id)) || [];
      }
      out.documents = releasedDocuments(histories, releases, patientId, Date.now());
    } catch (_) { out.failed.push("documents"); }
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

/**
 * The bytes of one released document version, for the patient's own session.
 * session: the verified result of sessionPatient(). ctx: { migration, recordDeps, store, env, documentId, version }
 *
 * Not released, another patient's, and missing all answer the same 404, so a document id is not an
 * oracle. Every download is audited, and a download whose audit row cannot be written is refused.
 */
async function portalDocumentFile(ctx, session) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid" };
  if (!session.sections.includes("documents")) return { ...base, ok: false, status: 403, error: "not_in_grant", detail: "This access does not include that." };
  const patientId = str(session.patientId), documentId = str(ctx.documentId), version = Number(ctx.version);
  const notFound = { ...base, ok: false, status: 404, error: "document_not_found", detail: "That document has not been shared with you." };
  if (!documentId || !Number.isInteger(version) || version < 1) return notFound;
  const svc = serviceFor(ctx, readerActor(session.readerId));
  let versions;
  try {
    const releases = (await svc.byPatient(RELEASE_TYPE, patientId)) || [];
    if (!releasedDocumentKeys(releases).has(`${documentId}|${version}`)) return notFound;
    versions = (await svc.history(DOC_TYPE, documentId)) || [];
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
  const rec = versions.find((x) => Number(x.version) === version);
  if (!rec || str(rec.patientId) !== patientId) return notFound;
  const gone = documentUnavailable(versions[versions.length - 1], Date.now());
  if (gone) return { ...base, ok: false, status: 410, error: gone.reason, detail: gone.say };
  const cannot = { ...base, ok: false, status: 503, detail: "Documents cannot be opened here at the moment." };
  if (!ctx.store) return { ...cannot, error: "document_storage_not_configured" };
  const key = await docKey(ctx.env);
  if (!key) return { ...cannot, error: "document_key_not_configured" };
  let bytes;
  try {
    const obj = await ctx.store.get(rec.objectKey);
    if (!obj) return { ...base, ok: false, status: 502, error: "document_file_missing", detail: "This document could not be opened. Ask your care team." };
    bytes = await decryptBytes(key, obj.bytes);
  } catch (e) { return { ...base, ok: false, status: 502, error: "document_store_failed", detail: "This document could not be opened. Try again later." }; }
  if ((await sha256Hex(bytes)) !== rec.sha256) return { ...base, ok: false, status: 502, error: "document_integrity_failed", detail: "This document could not be opened. Ask your care team." };
  try {
    await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, {
      ts: new Date().toISOString(), actor: session.readerId, connectorId: "wardsynq", action: "document.download",
      resourceCounts: { [DOC_TYPE]: 1 }, scope: { resourceType: DOC_TYPE, id: documentId, version, via: "patient-portal" },
      patientRefHash: ctx.recordDeps.pseudonym ? await ctx.recordDeps.pseudonym(patientId) : null, outcome: "ok",
    });
  } catch (e) { return { ...base, ok: false, status: 502, error: "audit_failed", detail: "This document could not be opened. Try again later." }; }
  const slug = str(rec.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return { ...base, ok: true, bytes, contentType: rec.contentType, filename: `${slug || "document"}-v${rec.version}` };
}

/* ---- queue status ------------------------------------------------------------------------------- */
const TICKET_STATE = { registered: "waiting", waiting: "waiting", called: "called", in_consultation: "in-consultation",
  investigation: "investigation", followup: "done", completed: "done", cancelled: "cancelled", no_show: "missed" };
const mrnKey = (v) => str(v).toUpperCase();

/**
 * PURE. This patient's tickets today, and nothing about anybody else's but a count.
 * sessions: today's sessions; ticketsBySession: { [sessionId]: tickets }; rooms: the hospital's rooms;
 * patientMrn: the MRN on the patient's record, when there is one.
 *
 * The token is the one the queue allocated with the ticket (_queue_engine.js allocateToken), the number
 * called out in the waiting hall. A ticket registered before tokens existed has none, and none is made
 * up here: an invented number would be read as the one being called.
 */
function queueStatusFor(patientId, patientMrn, sessions, ticketsBySession, rooms, nowMs) {
  const mine = [];
  for (const s of sessions || []) for (const t of (ticketsBySession && ticketsBySession[s.id]) || []) {
    if (t && patientIdForTicket(t) === str(patientId)) mine.push({ s, t });
  }
  /* Two MRN spellings that file under one patient id ("AB-12", "AB 12") are two people as far as
   * anyone can prove. Showing either ticket would risk showing somebody else's place in the queue. */
  const spellings = new Set(mine.map((x) => mrnKey(x.t.ghisPatientId)));
  if (mine.length && str(patientMrn)) spellings.add(mrnKey(patientMrn));
  if (spellings.size > 1) return { ambiguous: true, tickets: [] };
  const roomById = new Map((rooms || []).map((r) => [str(r && r.id), r]));
  return {
    ambiguous: false,
    tickets: mine.map(({ s, t }) => {
      const room = roomById.get(str(t.roomId || s.roomId));
      const label = room ? [room.name, room.number].map(str).filter(Boolean).join(" ") : str(t.department || s.department);
      const queued = isQueued(t.status);
      const idx = queued ? orderQueue(ticketsBySession[s.id]).findIndex((x) => x.id === t.id) : -1;
      /* Only the ETA the queue's own model (_queue_eta.js computeEtas, stored on the ticket) produced,
       * and only while it is still ahead of now. A past estimate is not an estimate. */
      const eta = queued && Number(t.etaStart) > nowMs ? new Date(Number(t.etaStart)).toISOString() : null;
      return { label: label || null, desk: !room && s.doctorUid === "__pool__", state: TICKET_STATE[t.status] || "waiting", token: str(t.token) || null, ahead: idx >= 0 ? idx : null, eta };
    }),
  };
}

/**
 * The patient's queue status. session: the verified result of sessionPatient().
 * ctx: { migration, recordDeps, queue: { enabled, date, listSessions(date), listTickets(sessionId), listRooms() } }
 */
async function queueStatus(ctx, session) {
  const base = { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null };
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid" };
  if (!session.sections.includes("status")) return { ...base, ok: false, status: 403, error: "not_in_grant", detail: "This access does not include that." };
  const q = ctx.queue || {};
  if (!q.enabled) return { ...base, ok: true, available: false, tickets: [] };
  const patientId = str(session.patientId);
  let status;
  try {
    const patient = await serviceFor(ctx, readerActor(session.readerId)).get("Patient", patientId);
    const sessions = (await q.listSessions(q.date)) || [];
    const ticketsBySession = {};
    for (const s of sessions) ticketsBySession[s.id] = (await q.listTickets(s.id)) || [];
    const rooms = (await q.listRooms()) || [];
    status = queueStatusFor(patientId, patient && patient.mrn, sessions, ticketsBySession, rooms, Date.now());
    /* The queue lives outside the record store, so its read is audited here, under the reader. */
    await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, {
      ts: new Date().toISOString(), actor: session.readerId, connectorId: "wardsynq", action: "record.read",
      resourceCounts: { QueueTicket: status.tickets.length }, scope: { resourceType: "QueueTicket", byPatient: true, via: "patient-portal" },
      patientRefHash: ctx.recordDeps.pseudonym ? await ctx.recordDeps.pseudonym(patientId) : null, outcome: "ok",
    });
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "queue_read_failed", detail: "Your queue status could not be loaded." };
  }
  return { ...base, ok: true, available: true, ...status };
}

export {
  SECTIONS, DISCHARGE_SCOPES, FULL_SECTIONS, WITHHELD_SAY, PATIENT_WITHDRAWABLE, PROXY_CONSENT_FROM, PROXY_CONSENT_METHOD,
  grantSections, readerId, proxyFrom, portalReader, releasedDischargeSummaries, releasedDocumentKeys, documentUnavailable, releasedDocuments,
  billView, consentView, portalExtras, scopeDocument, withdrawOwnConsent, portalDocumentFile, queueStatusFor, queueStatus,
};

