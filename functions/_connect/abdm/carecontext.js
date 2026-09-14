// functions/_connect/abdm/carecontext.js — the care-context model (M2, D5). PURE, no I/O.
//
// A care context is the unit ABDM links to an ABHA address, and it is deliberately tiny: a reference the
// HIP can resolve, and a display string for the patient. ABDM recommends ONE per outpatient visit and ONE
// per inpatient admission, which maps exactly onto StewardMD's own units of work.
//
// THE HIE-CM IS DATA-BLIND. The display is shown to the patient in their PHR app and is visible to the
// consent manager, so it may name the KINDS of record in the visit and the date, and nothing else. ABDM's
// own sanctioned example is "OPD records (XRay, Prescription) from 3rd March 2023" - note that it names
// record types, never a finding, a value, a diagnosis or a drug. `assertDataBlind` enforces that, because
// a leak here is a privacy breach that no consent covers.
//
// WHERE THE RECORDS ACTUALLY LIVE depends on how StewardMD is deployed, and the two modes serve very
// differently (see docs/queue/opd-platform-architecture.md §8 "data ownership"):
//
//   connected  the hospital's own EMR is authoritative. StewardMD holds only a minimal shadow, so a
//              care context resolves by FETCHING through the EMR Connect connector at request time.
//   native     the clinic has no EMR, so StewardMD OPD is authoritative for the encounter timeline and
//              the record is projected straight out of our own store.
//
// A third situation exists and CANNOT serve: the Shared/Personal Clinic EMR is local-first and
// end-to-end encrypted to the doctor's devices ("StewardMD never stores it"), so no server-side process
// can build a bundle for it. See sourceModeFor().

export class CareContextError extends Error {}

/** The eight HI types. All are mandatory for an HMIS integrator (FAQ Q2). */
export const HI_TYPES = Object.freeze([
  "Prescription", "DiagnosticReport", "OPConsultation", "DischargeSummary",
  "ImmunizationRecord", "HealthDocumentRecord", "WellnessRecord", "Invoice",
]);

/** How a tenant's records can be reached. */
export const SOURCE_MODE = Object.freeze({
  CONNECTED: "connected",   // fetch on demand through the EMR connector
  NATIVE: "native",         // project from StewardMD's own server-side store
  LOCAL_ONLY: "local-only", // client-encrypted clinic EMR - cannot be served server-side
});

/**
 * Decide how a tenant's records can be served.
 * `tenant` carries the Connect config: a connector id when an EMR is wired, and the clinic mode flag.
 */
export function sourceModeFor(tenant) {
  const t = tenant || {};
  if (t.connectorId && t.connectorId !== "none") return SOURCE_MODE.CONNECTED;
  if (t.clinicMode === "shared" || t.clinicMode === "personal") return SOURCE_MODE.LOCAL_ONLY;
  return SOURCE_MODE.NATIVE;
}

/** True when this tenant can act as a HIP at all. Local-only clinics cannot, by construction. */
export const canServeAsHip = (tenant) => sourceModeFor(tenant) !== SOURCE_MODE.LOCAL_ONLY;

// ── references ──────────────────────────────────────────────────────────────────────────────────────
// The reference is OUR handle for the visit. It must be stable and resolvable forever, because a linked
// care context can NEVER be unlinked (FAQ Q33) - a reference we cannot resolve later is a permanent
// broken record in the patient's PHR.
const KINDS = { opd: "OPD", ipd: "IPD", followcare: "FC" };

export function careContextRef({ kind, id }) {
  const k = KINDS[String(kind || "").toLowerCase()];
  if (!k) throw new CareContextError("unknown care-context kind: " + kind);
  const clean = String(id || "").trim();
  if (!clean) throw new CareContextError("a care context needs a stable id");
  // Keep it URL/CSV-safe: it travels in JSON and lands in a D1 column.
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(clean)) throw new CareContextError("care-context id has unsafe characters");
  return k + ":" + clean;
}

export function parseCareContextRef(ref) {
  const m = /^(OPD|IPD|FC):(.+)$/.exec(String(ref || ""));
  if (!m) return null;
  const kind = Object.keys(KINDS).find((k) => KINDS[k] === m[1]);
  return { kind, id: m[2] };
}

// ── the data-blind display ──────────────────────────────────────────────────────────────────────────
const RECORD_LABEL = {
  Prescription: "Prescription", DiagnosticReport: "Lab report", OPConsultation: "Consultation",
  DischargeSummary: "Discharge summary", ImmunizationRecord: "Immunisation",
  HealthDocumentRecord: "Document", WellnessRecord: "Vitals", Invoice: "Invoice",
};

// Anything that smells like a finding rather than a record type. Deliberately blunt: a false positive
// costs a slightly duller display string, a false negative leaks diagnosis to the consent manager.
const CLINICAL_HINT = new RegExp([
  "\\d+\\s*(?:mg|ml|mcg|g|iu|units?)\\b",        // a dose, e.g. "500mg" - note \\bmg\\b would MISS that
  "\\d+\\s*/\\s*\\d+",                          // a reading, e.g. BP 140/90
  "\\b(?:mg|ml|mcg|bp|hb|hba1c|spo2)\\b",
  "\\bdiagnos\\w*", "\\bpositive\\b", "\\bnegative\\b", "\\bnormal\\b", "\\babnormal\\b",
  "\\belevated\\b", "\\bdeficien\\w*", "\\bfever\\b",
  "\\bcancer\\b", "\\bcarcinoma\\b", "\\btumou?r\\b", "\\bhiv\\b", "\\btb\\b",
  "\\bdiabet\\w*", "\\bhypertens\\w*", "\\bpregnan\\w*", "\\babortion\\b",
  "\\bpsychiatr\\w*", "\\bdepress\\w*",
].join("|"), "i");

/**
 * Build the patient-facing label. `types` are HI types present in the visit - never findings.
 * e.g. { kind:"opd", date:"2026-03-03", types:["DiagnosticReport","Prescription"] }
 *      -> "OPD records (Lab report, Prescription) from 3 March 2026"
 */
export function careContextDisplay({ kind, date, types = [], facility }) {
  const head = String(kind || "").toLowerCase() === "ipd" ? "IPD records" : "OPD records";
  const labels = [...new Set(types.map((t) => RECORD_LABEL[t]).filter(Boolean))];
  const what = labels.length ? " (" + labels.join(", ") + ")" : "";
  const when = date ? " from " + humanDate(date) : "";
  const where = facility ? " at " + facility : "";
  const out = head + what + when + where;
  assertDataBlind(out);
  return out;
}

/** Throws if a display string carries anything clinical. Call it on ANY display before it leaves us. */
export function assertDataBlind(display) {
  const s = String(display || "");
  if (!s.trim()) throw new CareContextError("care-context display cannot be empty");
  if (s.length > 200) throw new CareContextError("care-context display is too long");
  const m = CLINICAL_HINT.exec(s);
  if (m) throw new CareContextError("care-context display must not carry clinical detail: found '" + m[0] + "'");
  return s;
}

function humanDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) throw new CareContextError("care-context date is not a date");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return dt.getUTCDate() + " " + MONTHS[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
}

// ── visit -> care context ───────────────────────────────────────────────────────────────────────────
/**
 * Which HI types a visit can actually produce. Only what is PRESENT - never the full list, or the
 * patient sees a context promising records we cannot serve.
 */
export function hiTypesForVisit(visit) {
  const v = visit || {};
  const out = [];
  if (v.hasConsultation || v.notes || v.assessment) out.push("OPConsultation");
  if (v.hasPrescription || (v.medications && v.medications.length)) out.push("Prescription");
  if (v.hasLabs || (v.investigations && v.investigations.length) || (v.imaging && v.imaging.length)) out.push("DiagnosticReport");
  if (v.hasDischargeSummary || v.dischargeSummary) out.push("DischargeSummary");
  if (v.immunisations && v.immunisations.length) out.push("ImmunizationRecord");
  if (v.vitals) out.push("WellnessRecord");
  if (v.documents && v.documents.length) out.push("HealthDocumentRecord");
  if (v.invoice || v.bill) out.push("Invoice");
  return out.filter((t) => HI_TYPES.includes(t));
}

/**
 * Project one StewardMD visit into the ABDM care-context shape.
 * Returns null when the visit carries nothing servable - linking an empty context is irreversible noise
 * in the patient's PHR.
 */
export function careContextForVisit(visit) {
  const v = visit || {};
  const types = hiTypesForVisit(v);
  if (!types.length) return null;
  return {
    referenceNumber: careContextRef({ kind: v.kind || "opd", id: v.id }),
    display: careContextDisplay({ kind: v.kind, date: v.date, types, facility: v.facility }),
    hiTypes: types,
  };
}

/** ABDM's patient block wraps the contexts. `patientRef` is OUR id for them, never an ABHA. */
export function patientCareContexts({ patientRef, display, visits = [] }) {
  const careContexts = visits.map(careContextForVisit).filter(Boolean);
  return {
    referenceNumber: String(patientRef || ""),
    display: assertDataBlind(display || "Records"),
    careContexts: careContexts.map(({ referenceNumber, display: d }) => ({ referenceNumber, display: d })),
    // the union of everything on offer, which is what the discovery response advertises
    hiType: [...new Set(careContexts.flatMap((c) => c.hiTypes))],
    count: careContexts.length,
  };
}
