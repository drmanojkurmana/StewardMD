/* functions/_wardsynq/migrate-discharge.js — closing an inpatient stay, and the discharge summary.
 *
 * Admission without discharge means every ward stay stays open forever and the ward list only grows.
 * This closes the loop: the Encounter goes to "finished" with a real periodEnd, and the stay gets a
 * discharge summary that a clinician signs.
 *
 * THE AUTO MAKER IS AN ASSEMBLER, NOT A WRITER. `assembleDischargeSummary` is PURE and every line it
 * produces is copied from a resource already in the record: the admission Encounter, the recorded
 * Observations, the MedicationOrders and the MedicationAdministrations that actually happened, the
 * documented allergies, the investigations requested, the notes written. It does not summarise, it
 * does not infer, and it does not phrase anything a clinician did not record.
 *
 * That is deliberate and it is the whole safety argument for having an auto maker at all. A
 * generated NARRATIVE - "the patient improved and was discharged in stable condition" - is a
 * clinical claim, and a discharge summary is the document the next doctor reads when this admission
 * is the only history they have. An assembler can be wrong only by omission, which is visible; a
 * generator can be wrong by invention, which is not. Where a section has no data it says so in
 * words rather than disappearing, so a reader can tell "nothing was recorded" from "nothing
 * happened".
 *
 * AI IS NOT WIRED IN HERE, and that is a decision rather than an omission. WardSynQ already has the
 * path for it (an AI origin writes as an `ai:` actor capped at DRAFT, `aiDrafted: true`, never the
 * signer) so a model-written narrative could be added later without weakening anything. It is not
 * added today because nothing in this file may produce a clinical sentence no human recorded.
 *
 * SIGNING IS SEPARATE, as it is for the OPD assessment: the draft is written unsigned, and a
 * clinician with a credential signs it as its own version. An unsigned summary is a draft, and the
 * record says so.
 */

import { Encounter, ClinicalNote } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VITAL_CODES } from "./migrate-vitals.js";
import { problemsForSummary } from "./migrate-problem.js";
import { reconciliationIdFor, reconciliationForSummary } from "./med-reconciliation.js";

const str = (v) => (v == null ? "" : String(v).trim());
const NOT_RECORDED = "Not recorded.";

/** Builds the governed service, or a shaped refusal. Never throws. */
async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

const dischargeSummaryIdFor = (encounterId) =>
  `wsq-dcs-${String(encounterId || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Whole days between two ISO instants, or null when either is missing/unparseable. */
function lengthOfStayDays(fromIso, toIso) {
  const a = Date.parse(str(fromIso)), b = Date.parse(str(toIso));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** A vitals set as one readable line, from Observations recorded at the same instant. */
function vitalsLine(observations) {
  const byCode = new Map();
  for (const key of Object.keys(VITAL_CODES)) byCode.set(VITAL_CODES[key].code, { key, spec: VITAL_CODES[key] });
  const parts = [];
  for (const o of observations) {
    const hit = byCode.get(o.code);
    if (!hit) continue;
    parts.push(`${hit.spec.display} ${o.value}${o.unit ? " " + o.unit : ""}`);
  }
  return parts.join(", ");
}

/**
 * PURE. The discharge summary, assembled from the record.
 *
 * @param {{encounter, patient, observations, orders, administrations, allergies, serviceRequests,
 *   notes, problems, dischargedAt}} r everything already read from the record
 */
function assembleDischargeSummary(r) {
  const enc = r.encounter || {};
  const loc = enc.location || {};
  const los = lengthOfStayDays(enc.periodStart, r.dischargedAt || enc.periodEnd);

  const admission = [
    `Ward: ${str(loc.ward) || "not recorded"}${loc.bed ? `, bed ${loc.bed}` : ""}.`,
    `Admitted: ${str(enc.periodStart) || "not recorded"}.`,
    `Discharged: ${str(r.dischargedAt || enc.periodEnd) || "not recorded"}.`,
    los === null ? "Length of stay: not calculable." : `Length of stay: ${los} day${los === 1 ? "" : "s"}.`,
    enc.reason ? `Reason for admission: ${enc.reason}` : null,
  ].filter(Boolean).join("\n");

  // Vitals: the FIRST and LAST recorded sets only. A discharge summary is not a flowsheet, and
  // pasting every reading in would bury the two a reader actually wants.
  const obs = [...(r.observations || [])].sort((a, b) =>
    String((a.meta && a.meta.effectiveAt) || "").localeCompare(String((b.meta && b.meta.effectiveAt) || "")));
  const at = (o) => String((o.meta && o.meta.effectiveAt) || "");
  const firstAt = obs.length ? at(obs[0]) : null;
  const lastAt = obs.length ? at(obs[obs.length - 1]) : null;
  const firstLine = firstAt ? vitalsLine(obs.filter((o) => at(o) === firstAt)) : "";
  const lastLine = lastAt && lastAt !== firstAt ? vitalsLine(obs.filter((o) => at(o) === lastAt)) : "";
  const vitals = !obs.length ? NOT_RECORDED
    : [`On admission (${firstAt}): ${firstLine || "no numeric values"}`,
       lastLine ? `Latest (${lastAt}): ${lastLine}` : null].filter(Boolean).join("\n");

  // Medicines: what was ORDERED, and separately what was actually GIVEN. Those are different facts
  // and a summary that conflates them is how a dose nobody gave becomes part of the history.
  const orders = r.orders || [];
  const given = (r.administrations || []).filter((a) => a && a.status === "administered");
  const givenByOrder = new Map();
  for (const a of given) givenByOrder.set(a.orderId, (givenByOrder.get(a.orderId) || 0) + 1);
  const medsOrdered = orders.length
    ? orders.map((o) => {
        const d = o.dose ? `${o.dose.value} ${o.dose.unit}` : "no dose recorded";
        const n = givenByOrder.get(o.id) || 0;
        return `${o.drug} - ${d}${o.route ? ", " + o.route : ""}${o.frequency ? ", " + o.frequency : ""} (${o.status}); doses administered on this admission: ${n}`;
      }).join("\n")
    : NOT_RECORDED;

  const allergies = (r.allergies || []).length
    ? r.allergies.map((a) => `${a.substance}${a.reportedText ? ` (reported as: ${a.reportedText})` : ""} - severity ${a.severity || "unknown"}, ${a.verifiedBy ? "verified" : "unverified"}`).join("\n")
    : "None documented on this admission.";

  const investigations = (r.serviceRequests || []).length
    ? r.serviceRequests.map((s) => `${s.display || s.code} (${s.status})`).join("\n")
    : NOT_RECORDED;

  // Assessment/plan are COPIED from what a clinician actually wrote, never composed.
  const clinical = [...(r.notes || [])]
    .filter((n) => n && n.noteType !== "discharge-summary" && n.sections)
    .sort((a, b) => String((b.meta && b.meta.recordedAt) || "").localeCompare(String((a.meta && a.meta.recordedAt) || "")))[0];
  // Diagnoses come from the PROBLEM LIST, not from prose. Before the problem list existed this
  // section could only ever be whatever a clinician happened to type into an assessment note.
  const diagnoses = problemsForSummary(r.problems) || NOT_RECORDED;
  const assessment = clinical && str(clinical.sections.assessment) ? str(clinical.sections.assessment) : NOT_RECORDED;
  const plan = clinical && str(clinical.sections.plan) ? str(clinical.sections.plan) : NOT_RECORDED;

  return {
    admission,
    diagnoses,
    allergies,
    vitals,
    investigations,
    medications: medsOrdered,
    /* What the patient was taking BEFORE they came in, and what was decided about each. A discharge
     * summary that lists only the inpatient orders tells the GP what we started and nothing about
     * what we stopped - which is exactly how a home anticoagulant disappears at the boundary
     * between two teams. Undecided medicines are named outright rather than omitted: a summary that
     * showed only the decided ones would read as a completed reconciliation. */
    homeMedicines: reconciliationForSummary(r.reconciliation) || NOT_RECORDED,
    assessment,
    plan,
    // Stated on the document itself, because a reader has to know what they are holding.
    provenance:
      "Assembled automatically from this admission's clinical record: the admission encounter, "
      + "recorded observations, medication orders and administrations, documented allergies, "
      + "investigation requests and clinician notes. Nothing here is generated or inferred; a section "
      + "reading \"Not recorded.\" means no such entry exists in the record. Review and sign before use.",
  };
}

/**
 * Reads the stay and writes an UNSIGNED discharge-summary note.
 * ctx: { migration, encounterId, patientId, dischargedAt?, sections?, actorDeps, recordDeps }
 * `sections` (optional) overrides assembled sections field-by-field, so a clinician can correct the
 * draft without losing the parts they did not touch.
 */
async function draftDischargeSummary(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter, patient, observations, orders, administrations, allergies, serviceRequests, notes, problems, reconciliation;
  try {
    encounter = await svc.get("Encounter", encounterId);
    if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId };
    const patientId = str(ctx.patientId) || encounter.patientId;
    [patient, observations, orders, administrations, allergies, serviceRequests, notes, problems, reconciliation] = await Promise.all([
      svc.get("Patient", patientId).catch(() => null),
      svc.byPatient("Observation", patientId).catch(() => []),
      svc.byPatient("MedicationOrder", patientId).catch(() => []),
      svc.byPatient("MedicationAdministration", patientId).catch(() => []),
      svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
      svc.byPatient("ServiceRequest", patientId).catch(() => []),
      svc.byPatient("ClinicalNote", patientId).catch(() => []),
      svc.byPatient("Condition", patientId).catch(() => []),
      svc.get("MedicationReconciliation", reconciliationIdFor(encounterId, "admission")).catch(() => null),
    ]);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }

  // Only this admission's activity belongs in this admission's summary, and only native records
  // (a fed-in external Medication* / ServiceRequest record must never appear as ours).
  const native = (rows) => (rows || []).filter((r) => r && !isExternalRecord(r));
  orders = native(orders);
  administrations = native(administrations);
  serviceRequests = native(serviceRequests);
  const mine = (rows) => (rows || []).filter((x) => x && (x.encounterId === encounterId || x.id === encounterId));
  const assembled = assembleDischargeSummary({
    encounter, patient,
    observations: mine(observations),
    orders: mine(orders),
    administrations: (administrations || []).filter((a) => mine(orders).some((o) => o.id === a.orderId)),
    allergies: allergies || [],
    serviceRequests: mine(serviceRequests),
    notes: mine(notes),
    // The problem list is the PATIENT's, not this admission's: a chronic diagnosis carried in from
    // before the stay belongs on the summary too.
    problems: problems || [],
    reconciliation,
    dischargedAt: ctx.dischargedAt || encounter.periodEnd || null,
  });

  const id = dischargeSummaryIdFor(encounterId);
  let current;
  try { current = await svc.get("ClinicalNote", id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (current && current.signedBy) {
    return { ...base, ok: false, status: 409, error: "already_signed", detail: "this discharge summary is signed; a correction is a new signed version, not a redraft", noteId: id, version: current.version };
  }

  const { sections, editedSections } = mergeSections(assembled, current, ctx.sections);
  const candidate = ClinicalNote({
    id, patientId: encounter.patientId, encounterId,
    noteType: "discharge-summary",
    sections,
    authorId: resolved.actor.id,
    aiDrafted: false,          // assembled from the record, not generated
    signedBy: null,            // a draft until a clinician signs it
    source: { system: "wardsynq-native", sourceId: `discharge-summary:${id}` },
  });
  // Which sections a human wrote. Bolted on, the convention every sibling migration uses for a field
  // the canonical model has no slot for. Without it nothing can tell a clinician's words apart from
  // assembled text, and the summary would have to either claim everything is sourced or claim
  // nothing is.
  candidate.editedSections = editedSections;

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteId: id, patientId: encounter.patientId, encounterId, sections, editedSections, assembled, signed: false, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * PURE. The sections to store, and which of them a clinician wrote.
 *
 * THE ASSEMBLER RE-READS THE RECORD ON EVERY DRAFT, so an untouched section refreshes - that is the
 * point of it. A CORRECTED one must NOT: before this, a re-draft silently reverted a clinician's
 * words to the assembled text, which meant the screen merely loading the summary would undo them. A
 * correction a refresh can quietly undo is not a correction.
 *
 * A clinician can also take a correction BACK, by submitting text that matches the assembled value
 * again. That drops the section out of `editedSections` and returns it to tracking the record,
 * rather than freezing it forever at a value that happens to agree today.
 */
function mergeSections(assembled, current, incoming) {
  const prior = Array.isArray(current && current.editedSections) ? current.editedSections : [];
  const priorSections = (current && current.sections) || {};
  const given = incoming && typeof incoming === "object" ? incoming : {};

  const sections = { ...assembled };
  const edited = new Set();
  // Corrections already on the record stay, unless this call replaces them.
  for (const k of prior) if (Object.prototype.hasOwnProperty.call(priorSections, k)) { sections[k] = priorSections[k]; edited.add(k); }
  for (const k of Object.keys(given)) {
    const v = given[k];
    if (v == null) continue;
    sections[k] = v;
    // Text that matches what the record assembles is not an override; it is agreement.
    if (str(v) === str(assembled[k])) { edited.delete(k); sections[k] = assembled[k]; }
    else edited.add(k);
  }
  return { sections, editedSections: [...edited].sort() };
}

/** Signs the discharge summary. Requires a credential, exactly as the OPD assessment sign-off does. */
async function signDischargeSummary(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = dischargeSummaryIdFor(str(ctx.encounterId));
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("ClinicalNote", id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "no_draft", detail: "draft the discharge summary before signing it", noteId: id };

  const signed = ClinicalNote({
    id: current.id, patientId: current.patientId, encounterId: current.encounterId,
    noteType: current.noteType, sections: current.sections, authorId: current.authorId,
    aiDrafted: !!current.aiDrafted, signedBy: resolved.actor.id,
    source: { system: "wardsynq-native", sourceId: `discharge-summary:${current.id}` },
  });
  // Carried onto the signed version. Signing must not erase the record of which words were the
  // clinician's own: that provenance is part of what is being signed.
  if (Array.isArray(current.editedSections)) signed.editedSections = current.editedSections;
  try {
    const out = await svc.put(signed, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteId: id, signed: true, signedBy: resolved.actor.id, editedSections: signed.editedSections || [], version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Closes the stay. ctx: { migration, encounterId, dischargedAt?, disposition?, actorDeps, recordDeps }
 *
 * Reports doses still in flight rather than refusing on them: whether an unfinished dose should stop
 * a discharge is a hospital's policy, not this file's to invent. It is surfaced so the decision is
 * an informed one.
 */
async function dischargePatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId };
  if (current.class !== "IPD") return { ...base, ok: false, status: 409, error: "not_an_admission", detail: "only an inpatient stay is discharged here", encounterId };
  if (current.status === "finished") {
    return { ...base, ok: true, written: 0, skipped: "already_discharged", encounterId, dischargedAt: current.periodEnd, version: current.version };
  }

  // Doses that were started and never finished. Reported, not blocked — see the docstring.
  let inFlight = [];
  try {
    const orders = (await svc.byPatient("MedicationOrder", current.patientId).catch(() => []))
      .filter((o) => o && !isExternalRecord(o) && o.encounterId === encounterId);
    const admins = (await svc.byPatient("MedicationAdministration", current.patientId).catch(() => []))
      .filter((a) => a && !isExternalRecord(a));
    inFlight = (admins || [])
      .filter((a) => a && orders.some((o) => o.id === a.orderId))
      .filter((a) => ["ordered", "verified", "dispensed", "scanned", "held"].includes(a.status))
      .map((a) => ({ administrationId: a.id, orderId: a.orderId, status: a.status }));
  } catch { inFlight = []; }

  const dischargedAt = str(ctx.dischargedAt) || new Date().toISOString();
  const candidate = Encounter({
    id: current.id, patientId: current.patientId, class: current.class, status: "finished",
    identifiers: current.identifiers, location: current.location,
    periodStart: current.periodStart, periodEnd: dischargedAt,
    source: { system: "wardsynq-native", sourceId: `inpatient-discharge:${current.id}` },
  });
  if (current.attendingId) candidate.attendingId = current.attendingId;
  if (current.reason) candidate.reason = current.reason;
  const disposition = str(ctx.disposition);
  if (disposition) candidate.disposition = disposition;

  try {
    const out = await svc.put(candidate, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId, patientId: current.patientId, status: "finished", dischargedAt, dosesInFlight: inFlight, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * PURE. What is still outstanding on this stay, and would leave with the patient unresolved.
 *
 * A discharge summary that says nothing about a dose still in flight or a test still open reads as
 * a complete account of the stay when it is not. None of this blocks a discharge - a ward has real
 * reasons to send a patient home with a result pending - but it must be SHOWN, and shown before the
 * clinician signs rather than discovered afterwards.
 */
function pendingItems(r) {
  const orders = r.orders || [];
  const doses = (r.administrations || [])
    .filter((a) => a && ["ordered", "verified", "dispensed", "scanned", "held"].includes(a.status))
    .map((a) => ({ kind: "dose", id: a.id, orderId: a.orderId, status: a.status, drug: a.drug || (orders.find((o) => o.id === a.orderId) || {}).drug || null }));
  const investigations = (r.serviceRequests || [])
    .filter((s) => s && s.status !== "completed" && s.status !== "cancelled" && s.status !== "revoked")
    .map((s) => ({ kind: "investigation", id: s.id, status: s.status || "unknown", display: s.display || s.code || null }));
  // An active medication order on a discharged patient is not itself wrong - it may be the
  // discharge prescription - but it is a decision somebody has to have made deliberately.
  const meds = orders.filter((o) => o && o.status === "active")
    .map((o) => ({ kind: "medication", id: o.id, status: o.status, drug: o.drug, dose: o.dose || null, frequency: o.frequency || null }));
  const problems = (r.problems || [])
    .filter((c) => c && c.clinicalStatus === "active" && c.verificationStatus !== "confirmed")
    .map((c) => ({ kind: "problem", id: c.id, status: c.verificationStatus, display: c.display }));
  return [...doses, ...investigations, ...meds, ...problems];
}

/**
 * READS the discharge summary. Writes nothing.
 *
 * Returns the STORED note (if one exists) and, beside it, what the assembler says the record
 * contains RIGHT NOW. Both, deliberately: that pairing is the only honest way for a screen to show
 * a clinician's own words apart from the record's, and to show when a correction has since drifted
 * from what the chart says. A screen that could only read one of them would have to guess.
 *
 * ctx: { migration, encounterId, patientId?, actorDeps, recordDeps }
 */
async function readDischargeSummary(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", stored: null, assembled: null };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required" };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  let encounter, patient, observations, orders, administrations, allergies, serviceRequests, notes, problems, reconciliation, stored;
  try {
    encounter = await svc.get("Encounter", encounterId);
    if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId };
    const patientId = str(ctx.patientId) || encounter.patientId;
    [patient, observations, orders, administrations, allergies, serviceRequests, notes, problems, reconciliation, stored] = await Promise.all([
      svc.get("Patient", patientId).catch(() => null),
      svc.byPatient("Observation", patientId).catch(() => []),
      svc.byPatient("MedicationOrder", patientId).catch(() => []),
      svc.byPatient("MedicationAdministration", patientId).catch(() => []),
      svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
      svc.byPatient("ServiceRequest", patientId).catch(() => []),
      svc.byPatient("ClinicalNote", patientId).catch(() => []),
      svc.byPatient("Condition", patientId).catch(() => []),
      svc.get("MedicationReconciliation", reconciliationIdFor(encounterId, "admission")).catch(() => null),
      svc.get("ClinicalNote", dischargeSummaryIdFor(encounterId)).catch(() => null),
    ]);
    orders = (orders || []).filter((r) => r && !isExternalRecord(r));
    administrations = (administrations || []).filter((r) => r && !isExternalRecord(r));
    serviceRequests = (serviceRequests || []).filter((r) => r && !isExternalRecord(r));
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
  }

  const mine = (rows) => (rows || []).filter((x) => x && (x.encounterId === encounterId || x.id === encounterId));
  const myOrders = mine(orders);
  const myAdmins = (administrations || []).filter((a) => myOrders.some((o) => o.id === a.orderId));
  const assembled = assembleDischargeSummary({
    encounter, patient,
    observations: mine(observations), orders: myOrders, administrations: myAdmins,
    allergies: allergies || [], serviceRequests: mine(serviceRequests), notes: mine(notes),
    problems: problems || [],
    reconciliation,
    dischargedAt: encounter.periodEnd || null,
  });

  return {
    ...base, ok: true, encounterId, patientId: encounter.patientId,
    /* Who this document is about. A discharge summary that cannot name its patient is not one, and
     * the assembled prose deliberately does not carry identity - it describes the stay. `provisional`
     * is carried through because an unmerged trauma record must never be mistaken for a confirmed
     * identity on a document that leaves the hospital. */
    patient: patient ? {
      name: patient.name || null, mrn: patient.mrn || null, sex: patient.sex || null,
      dob: patient.dob || null, provisional: !!patient.provisional,
    } : null,
    encounter: {
      status: encounter.status, class: encounter.class,
      ward: (encounter.location && encounter.location.ward) || null,
      bed: (encounter.location && encounter.location.bed) || null,
      admittedAt: encounter.periodStart || null, dischargedAt: encounter.periodEnd || null,
      disposition: encounter.disposition || null, attendingId: encounter.attendingId || null,
    },
    assembled,
    stored: stored ? {
      noteId: stored.id, sections: stored.sections || {},
      editedSections: Array.isArray(stored.editedSections) ? stored.editedSections : [],
      signed: !!stored.signedBy, signedBy: stored.signedBy || null,
      authorId: stored.authorId || null, version: stored.version,
      recordedAt: (stored.meta && stored.meta.recordedAt) || null,
    } : null,
    pending: pendingItems({ orders: myOrders, administrations: myAdmins, serviceRequests: mine(serviceRequests), problems: problems || [] }),
  };
}

export {
  NOT_RECORDED, dischargeSummaryIdFor, lengthOfStayDays, assembleDischargeSummary,
  mergeSections, pendingItems, readDischargeSummary,
  draftDischargeSummary, signDischargeSummary, dischargePatient,
};
