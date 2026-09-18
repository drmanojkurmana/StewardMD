/* functions/_wardsynq/labels.js - what a printed label says about a patient, read from the record.
 *
 * ward-labels.js draws the wristband, the tube label, the pharmacy label and the ID slip; this is the one
 * read they all start from, so a label never prints a name, MRN or allergy the screen happened to have in
 * memory from some other list. READ ONLY: printing a label writes nothing.
 *
 * THE BAND VALUE is what the bedside checks will compare a scan against. The eMAR five rights, specimen
 * collection and transfusion compare with the patient's wristbandBarcode, else the MRN (wardsynq-meds.js,
 * specimen.js); the Wristband screen's check compares with the ACTIVE wristband tag's code (identity-tag.js).
 * The QR carries the active tag's code when there is one, else the bedside value, and `matchesBedside` says
 * whether one printed code satisfies both - the screen warns when it does not, rather than printing a band
 * the medication round will refuse without saying why.
 *
 * ALLERGIES THAT COULD NOT BE READ ARE NOT "NONE". allergies is null then, and ward.js refuses to print a
 * wristband: a band that says "none recorded" because a read failed would be worn for the whole stay.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const normalise = (v) => str(v).toUpperCase().replace(/\s+/g, "");

/* The label kinds and what a hospital that set nothing prints on. Same values as ward-labels.js DEFAULT_SIZES. */
const LABEL_KINDS = Object.freeze(["wristband", "specimen", "pharmacy", "slip"]);
const DEFAULT_LABEL_SIZES = Object.freeze({
  wristband: { widthMm: 75, heightMm: 25 }, specimen: { widthMm: 50, heightMm: 25 },
  pharmacy: { widthMm: 75, heightMm: 50 }, slip: { widthMm: 80, heightMm: 60 },
});
const MIN_MM = 15, MAX_MM = 300;

/** PURE. The hospital's label sizes (wardsynq.labelSizes, Admin > Hospital), each kind bounded, a missing or
 * unusable one falling back to the default for that kind only. */
function labelSizesOf(cfg) {
  const out = {};
  for (const k of LABEL_KINDS) {
    const s = cfg && typeof cfg === "object" ? cfg[k] : null;
    const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= MIN_MM && v <= MAX_MM;
    out[k] = s && ok(s.widthMm) && ok(s.heightMm) ? { widthMm: s.widthMm, heightMm: s.heightMm } : { ...DEFAULT_LABEL_SIZES[k] };
  }
  return out;
}

/** PURE. Whole years from an ISO date of birth to now, or null when the date is not one. */
function ageYearsAt(dob, nowMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(dob));
  if (!m) return null;
  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  let age = now.getUTCFullYear() - Number(m[1]);
  if (now.getUTCMonth() + 1 < Number(m[2]) || (now.getUTCMonth() + 1 === Number(m[2]) && now.getUTCDate() < Number(m[3]))) age--;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * GET /ward/label-data. ctx: { migration, patientId, actorDeps, recordDeps, now? }. The router adds the label settings.
 */
async function labelData(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", patient: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", patient: null };

  let svc;
  try {
    const resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message), patient: null };
  }

  let patient;
  try { patient = await svc.get("Patient", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), patient: null }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", patient: null };

  const [allergyRows, tags] = await Promise.all([
    svc.byPatient("AllergyIntolerance", patientId).then((r) => r || [], () => null),
    svc.byPatient("PatientTag", patientId).then((r) => r || [], () => null),
  ]);
  const activeBand = (tags || []).filter((t) => t && t.tagType === "wristband" && t.status === "active")
    .sort((a, b) => str(b.assignedAt).localeCompare(str(a.assignedAt)))[0] || null;
  const bedsideValue = str(patient.wristbandBarcode) || str(patient.mrn) || null;
  const value = activeBand ? str(activeBand.code) : bedsideValue;

  return {
    ...base, ok: true,
    patient: {
      /* A date of birth derived from a typed age (approxDob, migrate-registration.js) is not printed as one: a band
       * reading "DOB 1974-01-01" would be checked against a birthday nobody gave. The age is printed instead. */
      patientId, name: str(patient.name) || null, mrn: str(patient.mrn) || null, dob: patient.approxDob ? null : (str(patient.dob) || null),
      dobApproximate: !!patient.approxDob, ageYears: ageYearsAt(patient.dob, ctx.now), sex: str(patient.sex) || null,
    },
    // null = could not be read (never an empty list); [] = none recorded.
    allergies: allergyRows === null ? null : allergyRows.filter(Boolean).map((a) => str(a.substance || a.code) || "unnamed substance"),
    band: {
      value, from: activeBand ? "tag" : "record", bedsideValue,
      // The tag list could not be read: the band value is the record's, and the screen is told so.
      tagsUnread: tags === null,
      matchesBedside: !!value && !!bedsideValue && normalise(value) === normalise(bedsideValue),
    },
  };
}

export { LABEL_KINDS, DEFAULT_LABEL_SIZES, labelSizesOf, ageYearsAt, labelData };
