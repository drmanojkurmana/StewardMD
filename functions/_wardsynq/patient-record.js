/* functions/_wardsynq/patient-record.js - the patient's own copy, handed over by a named clinician.
 *
 * Domain 19 of the benchmark is "patient portal", and this is deliberately NOT one. A portal is a
 * place a patient logs in to. THERE IS NO PATIENT IDENTITY IN THIS BUILD: `Patient` carries a name,
 * an MRN, a date of birth and a wristband barcode, and no contact detail of any kind. Inventing
 * patient authentication - who may enrol, what happens when the number in the record is wrong, what
 * happens when a family shares one phone - is a security decision with real weight and it belongs to
 * the owner, not to this file. It is recorded as such in vault/WardSynQ-Progress.md.
 *
 * What IS buildable, and is the half that actually carries the safety, is this: a clinician-mediated
 * handout. A named clinician asks for the patient's copy, sees exactly what the patient will see,
 * and hands it over. Every hazard below is a hazard of the portal too, and solving them here means
 * the portal inherits them solved rather than starting from nothing.
 *
 * A PATIENT MUST NOT LEARN A CRITICAL RESULT FROM A PRINTOUT. The oldest failure in this area is a
 * potassium of 7.2 reaching a patient before it reached a clinician. A DiagnosticReport with an OPEN
 * critical-result loop - one no named human has yet acknowledged - is withheld, and it is withheld
 * BECAUSE the loop is open, not because somebody remembered to. Acknowledging the loop is what
 * releases it, which is the same act that was always required.
 *
 * A PRELIMINARY RESULT IS NOT A RESULT YET. Only `final` and `corrected` reports go out. A
 * preliminary one may be superseded, and a patient holding a superseded number they were handed on
 * paper has no way to know it changed.
 *
 * A DIFFERENTIAL IS NOT A DIAGNOSIS, and handing a patient the list of things it might be, printed
 * under the heading "your diagnoses", is worse than handing them nothing. Differential and refuted
 * conditions are excluded. A provisional one goes out LABELLED as a working diagnosis, because that
 * is what it is and because leaving it out entirely would be its own kind of lie.
 *
 * NOTHING IS WITHHELD SILENTLY. An omitted result reads as "no test was done", which is a different
 * and more reassuring statement than "your result is not ready". Every withholding is counted and
 * its reason named on the document itself.
 *
 * THE ALLERGIES ARE NEVER WITHHELD. Nothing in this file can filter them. They are the one part of
 * the record whose whole value is that the patient carries it to the next hospital.
 *
 * SENSITIVITY IS ORG CONFIGURATION AND THERE IS NO DEFAULT LIST. Some results should not be handed
 * over at a counter, and which ones is a local decision - the record carries no sensitivity flag and
 * this file will not invent one from a code list it made up. `wardsynq.neverRelease` holds the
 * codes; when it is unset the document says so, in the same way news2-view.js says its escalation
 * policy is unapproved. An empty list is a configuration gap, not a clearance.
 *
 * IT IS A HANDOUT AND NOT THE LEGAL RECORD. Clinical notes are not included. A patient's right of
 * access to their complete record is a formal request with its own process, its own identity checks
 * and its own timescale, and this does not replace it or stand in for it - it says so on the
 * document rather than letting the omission imply the record is thinner than it is.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const RELEASE_TYPE = "PatientRecordRelease";

/** Only a settled result leaves the building. A preliminary one may still be superseded. */
const RELEASABLE_STATUS = Object.freeze(["final", "corrected"]);

/* Not a diagnosis and never printed as one. `differential` is the list of things it might be;
 * `refuted` is the thing it turned out not to be. */
const NOT_A_DIAGNOSIS = Object.freeze(["differential", "refuted", "entered-in-error"]);

/** PURE. The report ids a patient must not be handed yet, because nobody has acknowledged them. */
function openCriticalReportIds(loops) {
  const out = new Set();
  for (const l of loops || []) {
    /* `open` is the only unacknowledged state. `acknowledged` and `closed` both mean a named human
     * has seen it, which is the condition this rule is actually about - not whether the paperwork
     * was finished afterwards. */
    if (l && str(l.state) === "open" && str(l.reportId)) out.add(str(l.reportId));
  }
  return out;
}

/**
 * PURE. Whether one report may be handed over, and if not, why.
 *
 * The reason is returned rather than a bare false: it is printed on the document, because a result
 * that simply vanishes reads as a test nobody did.
 */
function releasableReport(report, openIds, neverRelease) {
  const r = report || {};
  if (!RELEASABLE_STATUS.includes(str(r.status))) {
    return { ok: false, reason: "not_final", say: "This result is still being checked and is not ready to be given out yet." };
  }
  if (openIds && openIds.has(str(r.id))) {
    return { ok: false, reason: "critical_unacknowledged", say: "Your care team is reviewing this result and will discuss it with you." };
  }
  /* Matched on the report's own `code` - the panel, which is what a hospital would actually name in
   * a policy ("HIV serology"), and the only code a DiagnosticReport carries: it holds
   * `resultObservationIds` and not the observation codes themselves. A per-analyte list would need
   * a second read of every observation and would still not be a sensitivity FLAG, which is what the
   * record genuinely lacks. */
  const code = str(r.code).toUpperCase();
  const blocked = (neverRelease || []).map((c) => str(c).toUpperCase()).filter(Boolean);
  if (code && blocked.includes(code)) {
    return { ok: false, reason: "sensitive", say: "This result is given out by your care team in person." };
  }
  return { ok: true };
}

/** PURE. One diagnosis as a patient should read it, or null when it is not a diagnosis at all. */
function diagnosisFor(condition) {
  const c = condition || {};
  const verification = str(c.verificationStatus);
  if (NOT_A_DIAGNOSIS.includes(verification)) return null;
  if (!str(c.code) && !str(c.display)) return null;
  return {
    code: c.code || null,
    display: c.display || c.code,
    status: c.clinicalStatus || null,
    /* Said in words, not left as a status code the patient has to decode. A working diagnosis that
     * looks settled on a printout is how a patient stops asking the question that would correct it. */
    ...(verification === "provisional"
      ? { note: "This is a working diagnosis. Your team is still confirming it." }
      : {}),
  };
}

async function open_(request, env, ctx, need) {
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

/** Reads every part of the handout. Writes nothing. */
async function assemble(svc, patientId, neverRelease) {
  const [patient, conditions, allergies, meds, reports, loops, appointments] = await Promise.all([
    svc.get("Patient", patientId).catch(() => null),
    svc.byPatient("Condition", patientId).catch(() => []),
    svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
    svc.byPatient("MedicationOrder", patientId).catch(() => []),
    svc.byPatient("DiagnosticReport", patientId).catch(() => []),
    svc.byPatient("CriticalResultLoop", patientId).catch(() => []),
    svc.byPatient("Appointment", patientId).catch(() => []),
  ]);

  const openIds = openCriticalReportIds(loops);
  const withheld = [];
  const released = [];
  for (const r of (reports || []).filter(Boolean)) {
    const verdict = releasableReport(r, openIds, neverRelease);
    if (verdict.ok) released.push({ id: r.id, name: r.panel || r.display || r.code || "Test result", reportedAt: r.reportedAt || null, status: r.status, conclusion: r.conclusion || null });
    else withheld.push({ reason: verdict.reason, say: verdict.say, reportedAt: r.reportedAt || null });
  }

  const diagnoses = (conditions || []).map(diagnosisFor).filter(Boolean);
  /* Counted, because "we left three things out" and "there was nothing else" are different
   * statements and only one of them is true here. */
  const excludedDiagnoses = (conditions || []).filter(Boolean).length - diagnoses.length;

  return {
    patient: patient ? { id: patient.id, name: patient.name, mrn: patient.mrn, dob: patient.dob } : null,
    diagnoses, excludedDiagnoses,
    /* Never filtered by anything in this file. The value of an allergy list is that the patient
     * carries it to the next hospital, and one this file could trim would not be worth carrying. */
    allergies: (allergies || []).filter(Boolean).map((a) => ({ substance: a.substance, reaction: a.reaction || null, severity: a.severity || null, criticality: a.criticality || null })),
    medicines: (meds || []).filter(Boolean).filter((m) => str(m.status) !== "stopped" && str(m.status) !== "cancelled")
      .map((m) => ({ drug: m.drug || m.drugCode, dose: m.dose || null, route: m.route || null, frequency: m.frequency || null, note: m.note || null })),
    results: released, withheldResults: withheld,
    appointments: (appointments || []).filter(Boolean).map((a) => ({ at: a.startsAt || a.at || null, with: a.clinicianName || a.clinicianId || null, kind: a.kind || null })),
  };
}

/**
 * PURE. The sentences that must appear on the document however it is rendered.
 *
 * ADDRESSED TO THE PATIENT, all of them. A warning meant for the clinician is returned separately by
 * `clinicianWarnings` and never mixed in here: this array is what gets printed and handed over, and
 * a sentence beginning "CLINICIAN NOTE, NOT FOR THE PATIENT" printed on the patient's copy would be
 * the single most careless line on the page.
 */
function statements(doc) {
  const out = [];
  if (doc.withheldResults.length) {
    /* Named, never silently absent: a missing result reads as a test nobody did, which is more
     * reassuring than the truth and in the wrong direction. */
    out.push(`${doc.withheldResults.length} result${doc.withheldResults.length === 1 ? " is" : "s are"} not included here. Your care team will discuss ${doc.withheldResults.length === 1 ? "it" : "them"} with you.`);
  }
  if (doc.excludedDiagnoses > 0) {
    out.push("Some entries on your record are possibilities your team was still considering, or have been ruled out. Those are not listed here because they are not diagnoses.");
  }
  out.push("This is a summary your care team has given you. It is not your complete medical record - you can ask the hospital for that separately.");
  return out;
}

/** PURE. What the clinician must read BEFORE handing the page over. Never printed on it. */
function clinicianWarnings(neverReleaseConfigured) {
  if (neverReleaseConfigured) return [];
  return ["This hospital has not configured wardsynq.neverRelease, so no result is withheld from this page on grounds of sensitivity. Read it before you hand it over."];
}

/** ctx: { migration, patientId, neverRelease? } - what the patient would be given. Writes nothing. */
async function patientCopy(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", document: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", document: null };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, document: null };

  const neverRelease = Array.isArray(ctx.neverRelease) ? ctx.neverRelease : [];
  let doc;
  try { doc = await assemble(svc, patientId, neverRelease); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), document: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), document: null };
  }

  return {
    ...base, ok: true, patientId, document: doc,
    statements: statements(doc),
    clinicianWarnings: clinicianWarnings(neverRelease.length > 0),
    sensitivityConfigured: neverRelease.length > 0,
    /* Said on the preview, which is the moment a clinician can still act on it. */
    preview: "Nothing has been given to the patient. Recording the handover is a separate, deliberate act.",
  };
}

/**
 * Records that a named clinician gave this to the patient.
 * ctx: { migration, patientId, givenTo?, neverRelease?, at?, idempotencyKey? }
 */
async function releaseToPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const neverRelease = Array.isArray(ctx.neverRelease) ? ctx.neverRelease : [];
  let doc;
  try { doc = await assemble(svc, patientId, neverRelease); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-release-${slug(patientId)}-${slug(at)}`;

  /* A RECEIPT, NOT A COPY. It records WHICH results and how many diagnoses were handed over, and
   * none of their values: a second copy of the clinical data, frozen at a moment and never
   * corrected, is a liability rather than a record. What was released is reconstructable from the
   * ids plus the versioned record they point at, which is the whole reason the store is versioned. */
  const record = {
    resourceType: RELEASE_TYPE, id, patientId, at,
    releasedBy: resolved.actor.id,
    /* Who it was physically handed to. A patient's record given to a relative is a different event
     * from one given to the patient, and a form that cannot tell them apart records neither. */
    givenTo: str(ctx.givenTo) || "patient",
    resultIds: doc.results.map((r) => r.id),
    diagnosisCount: doc.diagnoses.length,
    medicineCount: doc.medicines.length,
    allergyCount: doc.allergies.length,
    withheldCount: doc.withheldResults.length,
    withheldReasons: [...new Set(doc.withheldResults.map((w) => w.reason))],
    sensitivityConfigured: neverRelease.length > 0,
    source: { system: "wardsynq-native", sourceId: `release:${id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, releaseId: id, at, recordVersion: out.record.version,
      document: doc, statements: statements(doc),
      clinicianWarnings: clinicianWarnings(neverRelease.length > 0),
      release: record, actor: resolved.actor.id,
      note: "Recorded so it is answerable later what this patient was given and when. Nothing was sent anywhere; handing it over is a human act.",
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), releaseId: id, written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), releaseId: id, written: 0 };
  }
}

export {
  RELEASE_TYPE, RELEASABLE_STATUS, NOT_A_DIAGNOSIS,
  openCriticalReportIds, releasableReport, diagnosisFor, statements, clinicianWarnings, assemble,
  patientCopy, releaseToPatient,
};
