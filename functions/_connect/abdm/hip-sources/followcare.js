// functions/_connect/abdm/hip-sources/followcare.js — Stage-5 Task-1: HipSource interface + FollowCare adapter.
//
// The HIP SERVE side. A HipSource projects data StewardMD ALREADY HOLDS into an SCCM-shaped record; the ABDM
// serializer (Task 2) then turns that into an NDHM-FHIR document and the crypto/serve path (Tasks 3-4) seals
// it. This file wires ONE source end-to-end — FollowCare discharge/recovery episodes — and scaffolds the rest.
//
// ADR-2G (the FollowCare invariant): the source is a PURE READ PROJECTION. It NEVER diagnoses, prescribes, or
// alters anything — it only re-shapes existing episode data. It emits ONLY records whose subject is the
// requested patient (scoped by the HMAC `patientAbhaHash`); an unknown/empty patient yields an EMPTY list,
// never a throw. NO raw ABHA is read or returned — the source works exclusively from the pseudonym, and the
// SCCM patient carries FollowCare's internal id, never an ABHA. The FollowCare episode reader is INJECTED
// (`deps.followcare`) so there is no direct coupling to _followcare.js and the projection is unit-testable.
//
// HipSource shape (every source, wired or scaffolded, honours it):
//   { id, hiTypes,
//     listCareContexts(env, deps, { tenantId, patientAbhaHash }) -> careContext[],
//     loadRecord(env, deps, { tenantId, careContextRef }) -> { record, patientAbhaHash, hiType, recordType } }
//   deps = { db, now, followcare }.  `record` is a Phase-0 SCCM `bundle()`; `now` is the injected clock.
import { coding, codeable, quantity, provenance } from "../../canonical/coding.js";
import { bundle, patient, condition, medicationStatement, observation, documentReference } from "../../canonical/model.js";

// Scaffolded-but-not-wired sources fail loudly with this — never a silent empty projection (spec §7).
export class NotImplemented extends Error {
  constructor(id) { super("HipSource '" + id + "' is scaffolded but not wired (NotImplemented)"); this.name = "NotImplemented"; }
}

// Standard terminologies (same set as the ABDM normalizer). Anything else is a StewardMD-local/proprietary code.
const STD = ["http://loinc.org", "http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-11", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://www.whocc.no/atc"];

// Coded-field builder — the mirror of the normalizer's cc(): ALWAYS emits a non-empty text fallback (R12).
// `src` is a flat FollowCare code { system?, code?, display?, text? } (or a bare string, or null).
function cc(src, fallback) {
  if (src == null) return codeable({ text: fallback || "unknown" });
  if (typeof src === "string") return codeable({ text: src.trim() || fallback || "unknown" });
  const codes = [];
  if (src.system || src.code || src.display) {
    codes.push(coding({ system: src.system || null, code: src.code || null, display: src.display || null, kind: STD.includes(src.system) ? "standard" : "local" }));
  }
  const text = (src.text && String(src.text).trim()) || src.display || fallback || "unknown";
  return codeable({ coding: codes, text });
}

// Observation value: a numeric reading -> Quantity; anything else -> a plain { text } (never dropped).
function obsValue(o) {
  if (typeof o.value === "number") return quantity({ value: o.value, unit: o.unit || null, code: o.unit || null });
  if (o.value != null) return { text: String(o.value) };
  if (o.text) return { text: String(o.text) };
  return null;
}

// Injected clock -> ISO string. Never touches Date.now / the wall clock (deterministic epoch-0 fallback only).
function isoOf(now) {
  const d = typeof now === "function" ? now() : now;
  if (d && typeof d.toISOString === "function") return d.toISOString();
  if (typeof d === "number") return new Date(d).toISOString();
  if (typeof d === "string" && d) return d;
  return new Date(0).toISOString();
}

// A FollowCare discharge episode -> an SCCM `bundle()`. Pure: no I/O, no mutation of the episode, no clinical
// judgement — just a re-shape of fields FollowCare already holds. Binary is NEVER produced (narrative text only).
function projectDischargeEpisode(episode, { tenantId, now }) {
  const generatedAt = isoOf(now);
  const ref = episode.careContextRef;
  const P = episode.patient || {};

  const patientRes = patient({ id: P.id || ref, gender: P.gender || "unknown", birthDate: P.birthDate || null, name: P.name || null });

  const conditions = (episode.diagnoses || []).map((d, i) => condition({
    id: (d && d.id) || ref + "-cond-" + i,
    code: cc(d, "diagnosis"),
    clinicalStatus: (d && d.clinicalStatus) || "active",
    recordedDate: episode.dischargeDate || generatedAt,
  }));

  // Discharge medications are prescriptions the patient leaves with -> origin:"order" (a MedicationRequest on
  // the way back through the serializer). An episode may override per-med via `origin`.
  const medications = (episode.medications || []).map((m, i) => medicationStatement({
    id: (m && m.id) || ref + "-med-" + i,
    medication: cc(m, "medication"),
    origin: (m && m.origin) || "order",
    status: (m && m.status) || "active",
    dosage: m && m.dosage ? { text: String(m.dosage) } : null,
  }));

  const observations = (episode.observations || []).map((o, i) => observation({
    id: (o && o.id) || ref + "-obs-" + i,
    category: (o && o.category) || "vital-signs",
    code: cc(o, "observation"),
    value: obsValue(o || {}),
    effectiveDateTime: (o && o.effectiveDateTime) || episode.dischargeDate || generatedAt,
    status: (o && o.status) || "final",
  }));

  // The discharge summary itself -> ONE documentReference carrying narrative text ONLY. NO binary/attachment.
  const summary = episode.summary || {};
  const narrative = (summary.text && String(summary.text).trim()) || summary.title || "Discharge summary";
  const documents = [documentReference({
    id: ref + "-summary",
    type: cc({ system: "http://snomed.info/sct", code: "373942005", display: "Discharge summary", text: summary.title || "Discharge summary" }, "Discharge summary"),
    category: "DischargeSummaryRecord",
    status: "current",
    date: episode.dischargeDate || generatedAt,
    text: narrative,
  })];

  const record = bundle({
    tenantId, sourceConnector: "followcare", generatedAt,
    patient: patientRes, conditions, medications, observations, documents,
    scope: ["Patient", "Condition", "MedicationRequest", "Observation", "DocumentReference"],
    provenance: [provenance({ resource: "Composition", sourceConnector: "followcare", sourceId: ref })],
    warnings: [],
  });
  // Self-describing profile for the ABDM serializer (Task 2). Additive; the SCCM validator ignores extra keys.
  record.recordType = "DischargeSummaryRecord";
  return record;
}

// hiType -> NDHM record profile. FollowCare wires the discharge episode end-to-end; the map is future-proofing.
const HITYPE_TO_RECORD = { DischargeSummary: "DischargeSummaryRecord", OPConsultation: "OPConsultRecord", Prescription: "PrescriptionRecord" };

export const followcareSource = {
  id: "followcare",
  hiTypes: ["DischargeSummary", "OPConsultation", "Prescription"],

  // ADR-2G: list ONLY care contexts whose subject is the requested patient. An unknown/empty patient, a
  // missing pseudonym, or a missing reader all degrade to [] — never a throw.
  async listCareContexts(env, deps, { tenantId, patientAbhaHash } = {}) {
    const reader = deps && deps.followcare;
    if (!patientAbhaHash || !reader || typeof reader.listEpisodes !== "function") return [];
    const episodes = (await reader.listEpisodes(env, { tenantId, patientAbhaHash })) || [];
    if (!Array.isArray(episodes)) return [];
    return episodes
      .filter((ep) => ep && ep.patientAbhaHash === patientAbhaHash)   // subject guard: only THIS patient (defence-in-depth)
      .map((ep) => ({
        referenceNumber: ep.careContextRef,
        display: ep.display || ("Discharge summary" + (ep.dischargeDate ? " (" + ep.dischargeDate + ")" : "")),
        hiType: ep.hiType || "DischargeSummary",
      }));
  },

  // Load ONE care context and project it into an SCCM record. The returned patientAbhaHash is the episode's own
  // pseudonym (never a raw ABHA), so the caller can bind the record to the requesting patient.
  async loadRecord(env, deps, { tenantId, careContextRef } = {}) {
    const reader = deps && deps.followcare;
    if (!reader || typeof reader.getEpisode !== "function") throw new Error("FollowCare reader not injected");
    const episode = await reader.getEpisode(env, { tenantId, careContextRef });
    if (!episode) throw new Error("care context not found: " + careContextRef);
    const record = projectDischargeEpisode(episode, { tenantId, now: deps.now });
    return {
      record,
      patientAbhaHash: episode.patientAbhaHash || null,
      hiType: episode.hiType || "DischargeSummary",
      recordType: HITYPE_TO_RECORD[episode.hiType] || "DischargeSummaryRecord",
    };
  },
};

// Other StewardMD data holdings are declared behind the SAME HipSource shape but NOT wired yet (spec §7):
// they throw NotImplemented so a caller can enumerate them without ever silently serving an empty projection.
function scaffoldSource(id, hiTypes) {
  return {
    id, hiTypes,
    async listCareContexts() { throw new NotImplemented(id); },
    async loadRecord() { throw new NotImplemented(id); },
  };
}
export const icuSource = scaffoldSource("icu", ["OPConsultation", "DiagnosticReport"]);
export const casesSource = scaffoldSource("cases", ["OPConsultation", "DiagnosticReport"]);

// native-opd is the "StewardMD EMR" source (clinics with no EMR of their own). It lives in its own file
// because it reads a different store with a different retention profile - see native-opd.js.
export { nativeOpdSource } from "./native-opd.js";
export const hipSources = { followcare: followcareSource, icu: icuSource, cases: casesSource };

// Registry lookup — an unknown source id is NotImplemented, not a null-deref.
export function getHipSource(id) {
  const s = hipSources[id];
  if (!s) throw new NotImplemented(id);
  return s;
}
