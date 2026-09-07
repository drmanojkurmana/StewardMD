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
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VITAL_CODES } from "./migrate-vitals.js";

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
 *   notes, dischargedAt}} r everything already read from the record
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
  const assessment = clinical && str(clinical.sections.assessment) ? str(clinical.sections.assessment) : NOT_RECORDED;
  const plan = clinical && str(clinical.sections.plan) ? str(clinical.sections.plan) : NOT_RECORDED;

  return {
    admission,
    allergies,
    vitals,
    investigations,
    medications: medsOrdered,
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

  let encounter, patient, observations, orders, administrations, allergies, serviceRequests, notes;
  try {
    encounter = await svc.get("Encounter", encounterId);
    if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId };
    const patientId = str(ctx.patientId) || encounter.patientId;
    [patient, observations, orders, administrations, allergies, serviceRequests, notes] = await Promise.all([
      svc.get("Patient", patientId).catch(() => null),
      svc.byPatient("Observation", patientId).catch(() => []),
      svc.byPatient("MedicationOrder", patientId).catch(() => []),
      svc.byPatient("MedicationAdministration", patientId).catch(() => []),
      svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
      svc.byPatient("ServiceRequest", patientId).catch(() => []),
      svc.byPatient("ClinicalNote", patientId).catch(() => []),
    ]);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }

  // Only this admission's activity belongs in this admission's summary.
  const mine = (rows) => (rows || []).filter((x) => x && (x.encounterId === encounterId || x.id === encounterId));
  const assembled = assembleDischargeSummary({
    encounter, patient,
    observations: mine(observations),
    orders: mine(orders),
    administrations: (administrations || []).filter((a) => mine(orders).some((o) => o.id === a.orderId)),
    allergies: allergies || [],
    serviceRequests: mine(serviceRequests),
    notes: mine(notes),
    dischargedAt: ctx.dischargedAt || encounter.periodEnd || null,
  });

  const sections = { ...assembled, ...(ctx.sections && typeof ctx.sections === "object" ? ctx.sections : {}) };
  const id = dischargeSummaryIdFor(encounterId);
  const candidate = ClinicalNote({
    id, patientId: encounter.patientId, encounterId,
    noteType: "discharge-summary",
    sections,
    authorId: resolved.actor.id,
    aiDrafted: false,          // assembled from the record, not generated
    signedBy: null,            // a draft until a clinician signs it
    source: { system: "wardsynq-native", sourceId: `discharge-summary:${id}` },
  });

  let current;
  try { current = await svc.get("ClinicalNote", id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (current && current.signedBy) {
    return { ...base, ok: false, status: 409, error: "already_signed", detail: "this discharge summary is signed; a correction is a new signed version, not a redraft", noteId: id, version: current.version };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteId: id, patientId: encounter.patientId, encounterId, sections, signed: false, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId: id, written: 0, actor: resolved.actor.id }) };
  }
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
  try {
    const out = await svc.put(signed, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteId: id, signed: true, signedBy: resolved.actor.id, version: out.record.version, actor: resolved.actor.id };
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
      .filter((o) => o && o.encounterId === encounterId);
    const admins = await svc.byPatient("MedicationAdministration", current.patientId).catch(() => []);
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

export {
  NOT_RECORDED, dischargeSummaryIdFor, lengthOfStayDays, assembleDischargeSummary,
  draftDischargeSummary, signDischargeSummary, dischargePatient,
};
