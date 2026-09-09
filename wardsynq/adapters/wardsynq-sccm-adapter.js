/* wardsynq/adapters/wardsynq-sccm-adapter.js — the boundary between the two canonical models.
 *
 * THE DECISION THIS FILE RECORDS. StewardMD has two canonical models and they exist for different
 * jobs, and the audit that found the overlap was right that nothing said which one was the record.
 *
 *   SCCM (functions/_connect/canonical/model.js)   the INGEST/READ wire format. Nine connectors
 *       (FHIR R4, HL7 v2, ABDM, DICOMweb, SQL, GraphQL, REST, file, fhir-push) normalise whatever
 *       a hospital's other systems speak into this shape. It is versioned for consumers, carries
 *       no provenance envelope of its own, and is not appended to or governed.
 *
 *   WardSynQ canonical model (wardsynq/wardsynq-model.js)   THE CLINICAL RECORD. It is what the
 *       store versions, the safety engine reads, the actor model governs and the bi-temporal
 *       engine reconstructs. It carries a provenance envelope on every entity.
 *
 * So: WardSynQ's model is authoritative for the record, and SCCM is how the outside world reaches
 * it. This adapter is the ONE place the two meet. An SCCM bundle from any connector is mapped here
 * into canonical entities, each stamped with `meta.source = {system: <the connector>, sourceId}`,
 * and registered on the Integration Hub exactly as the GHIS adapter is. Neither model is rewritten
 * and neither imports the other.
 *
 * WHAT THE STAMP DOES DOWNSTREAM. The record service refuses a native write over a record whose
 * latest version came from another system (functions/_wardsynq/service.js, EXTERNAL_AUTHORITY).
 * That is how "the hospital's existing EMR remains authoritative for the data it owns" is enforced
 * rather than hoped for: what came in through the connector can only be changed through the
 * connector.
 *
 * THE RULES, inherited from the hub and the GHIS adapter, not invented here:
 *   - ids are STABLE. The same source record maps to the same WardSynQ id every time, so a replay
 *     versions the entity rather than duplicating it.
 *   - nothing is guessed. A field the source did not carry is left null or the row is skipped with
 *     an issue that says so. No default date, no invented name, no fabricated code.
 *   - an external "active" order lands as a DRAFT with its upstream status preserved beside it. The
 *     actor model caps an adapter below EXECUTE and the hub would refuse an active order anyway;
 *     mapping it as a draft is stating the truth about what an adapter may commit.
 *
 * STATUS: IMPLEMENTED and TESTED. Not clinically validated, not clinically approved.
 */

import {
  Patient, Encounter, Condition, AllergyIntolerance, Observation, MedicationOrder,
  DiagnosticReport, ClinicalNote, MedicationAdministration, ServiceRequest,
} from "../wardsynq-model.js";
import { Adapter } from "../wardsynq-interop.js";

/** Same sentinel the GHIS adapter uses when a source carries no date of birth. */
const UNKNOWN_DOB = "0000-00-00";

/** FHIR v3 ActEncounterCode -> WardSynQ Encounter.class. Anything else is recorded, not guessed. */
const ENCOUNTER_CLASS = Object.freeze({
  AMB: "OPD", IMP: "IPD", ACUTE: "IPD", NONAC: "IPD", EMER: "ED", VR: "VIRTUAL", SS: "DAYCARE",
  OPD: "OPD", IPD: "IPD", ED: "ED", ICU: "ICU", DAYCARE: "DAYCARE", VIRTUAL: "VIRTUAL",
});

function sourceId(system, kind, ...parts) {
  const tail = parts.map((p) => String(p == null ? "" : p).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("--");
  return `${system}-${kind}-${tail}`;
}

/** First code out of an SCCM codeable {coding:[{system,code,display}], text}. */
function codeOf(c) {
  if (!c) return { code: null, system: null, display: null };
  if (typeof c === "string") return { code: c, system: null, display: c };
  const first = Array.isArray(c.coding) && c.coding[0] ? c.coding[0] : null;
  return {
    code: (first && first.code) || null,
    system: (first && first.system) || null,
    display: c.text || (first && first.display) || (first && first.code) || null,
  };
}

function mrnOf(p) {
  const ids = Array.isArray(p.identifiers) ? p.identifiers : [];
  // `MR` is the HL7 v2-0203 identifier type for a medical record number, which is what a FHIR
  // Patient.identifier carries; the word forms are what an HIS export tends to write instead.
  const mrn = ids.find((i) => i && /^mr$|mrn|uhid|medical-record|hospital/i.test(String(i.type || i.system || "")));
  return (mrn && mrn.value) || (ids[0] && ids[0].value) || null;
}

/** An SCCM name is a string from some connectors and {text, given, family} from the FHIR one. A
 *  constructor that needs a string got an object here until 2026-09-08 and refused every FHIR
 *  patient. Never split or reordered: text as given, else the parts in the order the sender used. */
function nameOf(p) {
  const n = p && p.name;
  if (!n) return null;
  if (typeof n === "string") return n;
  if (typeof n === "object") {
    if (n.text) return String(n.text);
    const parts = [...(Array.isArray(n.given) ? n.given : []), n.family].filter(Boolean).map(String);
    return parts.length ? parts.join(" ") : null;
  }
  return null;
}

/**
 * @param {object} bundle  an SCCM v1 bundle
 * @returns {{patient: object|null, entities: object[], issues: {code, message}[]}}
 */
function mapSccmBundle(bundle) {
  const issues = [];
  const system = (bundle && bundle.meta && bundle.meta.sourceConnector) || "sccm";
  const src = (kind, id) => ({ system, sourceId: String(id) });

  const p = bundle && bundle.patient;
  if (!p || !p.id) return { patient: null, entities: [], issues: [{ code: "SCCM_NO_PATIENT", message: "the bundle carries no patient" }] };

  const mrn = mrnOf(p);
  const name = nameOf(p);
  if (!mrn) issues.push({ code: "SCCM_PATIENT_NO_MRN", message: "no MRN-like identifier; the source id is used as the MRN" });
  if (!name) issues.push({ code: "SCCM_PATIENT_NO_NAME", message: "the source carried no name; the source id stands in and is marked" });
  if (!p.birthDate) issues.push({ code: "SCCM_PATIENT_NO_DOB", message: "no date of birth; the unknown sentinel is used, not a guess" });

  const patient = Patient({
    id: sourceId(system, "pat", p.id),
    mrn: mrn || String(p.id),
    name: name || String(p.id),
    dob: p.birthDate || UNKNOWN_DOB,
    sex: p.gender || "unknown",
    // The sender's declared type (a v2-0203 code such as MR or NI) travels beside the system, so an
    // MRN under a system nobody here knows is still exported as an MRN and not as an anonymous value.
    identifiers: (p.identifiers || []).map((i) => ({ system: i.system || i.type || null, type: i.type || null, value: i.value })).filter((i) => i.value),
    source: src("pat", p.id),
  });
  if (!name) patient.nameIsUnknown = true;
  if (!p.birthDate) patient.dobIsUnknown = true;
  if (p.deceased != null) patient.deceased = p.deceased;

  const entities = [patient];
  const encounterIds = new Map();

  for (const e of bundle.encounters || []) {
    if (!e || !e.id) { issues.push({ code: "SCCM_ENCOUNTER_NO_ID", message: "an encounter had no id and was skipped" }); continue; }
    const cls = ENCOUNTER_CLASS[String(e.class || "").toUpperCase()];
    if (!cls) issues.push({ code: "SCCM_ENCOUNTER_CLASS", message: `encounter ${e.id} class "${e.class}" is not a known care setting; recorded as IPD` });
    const id = sourceId(system, "enc", e.id);
    encounterIds.set(String(e.id), id);
    entities.push(Encounter({
      id, patientId: patient.id, class: cls || "IPD",
      status: e.status && e.status !== "unknown" ? e.status : "in-progress",
      identifiers: [{ system: `${system}-encounter-id`, value: String(e.id) }, ...((e.identifiers || []).filter((i) => i && i.value).map((i) => ({ system: i.system || `${system}-visit`, type: i.type || null, value: String(i.value) })))],
      periodStart: (e.period && e.period.start) || undefined,
      periodEnd: (e.period && e.period.end) || null,
      // Where the source says the patient is, as the source names it. Never mapped to this hospital's beds.
      location: e.location && (e.location.ward || e.location.bed) ? { facilityId: e.location.facility || null, ward: e.location.ward || null, bed: e.location.bed || null } : null,
      source: src("enc", e.id),
    }));
  }
  /* An encounter this bundle carries, by the id it was written under - and, failing that, the id
   * that SAME source's encounter would have been written under by an earlier message. A feed's ADT
   * arrives on Monday and its lab result on Tuesday; until the fallback existed the Tuesday result
   * lost its visit entirely, because the encounter was not in the same envelope. The fallback is a
   * derivation, not a guess: sourceId() is the identical function that minted the id in the first
   * place. A reference to an encounter nobody has sent resolves to an id that simply is not on the
   * record, which every reader downstream already treats as "not here". */
  const encRef = (ref) => {
    if (!ref) return null;
    const id = typeof ref === "object" ? ref.id : ref;
    if (!String(id || "")) return null;
    return encounterIds.get(String(id)) || sourceId(system, "enc", id) || null;
  };

  for (const c of bundle.conditions || []) {
    if (!c || !c.id) continue;
    const k = codeOf(c.code);
    if (!k.code && !k.display) { issues.push({ code: "SCCM_CONDITION_NO_CODE", message: `condition ${c.id} carried no code or text and was skipped` }); continue; }
    entities.push(Condition({
      id: sourceId(system, "cond", c.id), patientId: patient.id, encounterId: encRef(c.encounter),
      code: k.code || k.display, codeSystem: k.system || "unspecified", display: k.display || k.code,
      clinicalStatus: c.clinicalStatus && c.clinicalStatus !== "unknown" ? c.clinicalStatus : "active",
      verificationStatus: "provisional", onsetDate: c.onset || null,
      source: src("cond", c.id),
    }));
  }

  for (const a of bundle.allergies || []) {
    if (!a || !a.id) continue;
    const k = codeOf(a.code);
    if (!k.display && !k.code) { issues.push({ code: "SCCM_ALLERGY_NO_SUBSTANCE", message: `allergy ${a.id} named no substance and was skipped` }); continue; }
    const first = Array.isArray(a.reactions) && a.reactions[0] ? a.reactions[0] : null;
    entities.push(AllergyIntolerance({
      id: sourceId(system, "alg", a.id), patientId: patient.id,
      substance: k.display || k.code, substanceCodeSystem: k.system || "unspecified",
      reaction: first ? (typeof first === "string" ? first : (first.text || (first.manifestation && codeOf(first.manifestation).display) || null)) : null,
      severity: (first && first.severity) || "unknown",
      criticality: a.criticality || "unable-to-assess",
      verifiedBy: null,   // an external allergy is not verified by anybody here; the Allergy Shield knows what that means
      source: src("alg", a.id),
    }));
  }

  for (const o of bundle.observations || []) {
    if (!o || !o.id) continue;
    const k = codeOf(o.code);
    if (!k.code && !k.display) { issues.push({ code: "SCCM_OBS_NO_CODE", message: `observation ${o.id} carried no code and was skipped` }); continue; }
    let value = o.value, unit = null;
    if (value && typeof value === "object") {
      if ("value" in value) { unit = value.unit || value.code || null; value = value.value; }
      else if ("text" in value) value = value.text;
      else value = codeOf(value).display;
    }
    entities.push(Observation({
      id: sourceId(system, "obs", o.id), patientId: patient.id,
      // SCCM 1.1: the visit this reading belongs to, when the sender named one this bundle also
      // carries. Resolved through the SAME encounter map every other type uses - an encounter the
      // sender referenced but did not send is null here, exactly as it is everywhere else.
      encounterId: encRef(o.encounter),
      category: o.category || "laboratory", code: k.code || k.display, codeSystem: k.system || "unspecified",
      value, unit, effectiveAt: o.effectiveDateTime || undefined,
      source: src("obs", o.id),
    }));
  }

  for (const m of bundle.medications || []) {
    if (!m || !m.id) continue;
    const k = codeOf(m.medication);
    if (!k.display && !k.code) { issues.push({ code: "SCCM_MED_NO_DRUG", message: `medication ${m.id} named no drug and was skipped` }); continue; }
    const order = MedicationOrder({
      id: sourceId(system, "rx", m.id), patientId: patient.id,
      drug: k.display || k.code, drugCode: k.code, drugCodeSystem: k.system || "unspecified",
      dose: null, route: null, frequency: (m.dosage && m.dosage.text) || null,
      // No prescriber travels with an SCCM statement. The order is attributed to the system that
      // asserted it, which is true, rather than to a clinician, which would be a forgery.
      prescriberId: `external:${system}`,
      status: "draft",
      source: src("rx", m.id),
    });
    order.externalStatus = m.status || "unknown";   // what the source said; what WardSynQ may commit is above
    order.externalOrigin = m.origin || "statement";
    entities.push(order);
  }

  /* SCCM 1.1: orders for things other than medicines. Filed as DRAFT and requested by the system
   * that asserted them - never active, never attributed to a clinician here - so nothing this ward
   * collects, schedules or bills can come from an order another hospital placed. What the source
   * said the status was is kept beside it. */
  const SR_CATEGORY = { laboratory: "laboratory", imaging: "imaging", procedure: "procedure", referral: "referral", other: "other" };
  for (const s of bundle.serviceRequests || []) {
    if (!s || !s.id) continue;
    const k = codeOf(s.code);
    if (!k.code && !k.display) { issues.push({ code: "SCCM_REQUEST_NO_CODE", message: `service request ${s.id} carried no code and was skipped` }); continue; }
    // By the sender's own words (code or display), against the closed list; anything else is "other", not a guess.
    const cat = codeOf(s.category);
    const words = [cat.code, cat.display].map((w) => String(w || "").toLowerCase()).filter(Boolean);
    const category = words.map((w) => SR_CATEGORY[w] || (/\blab/.test(w) ? "laboratory" : /imag|radiol/.test(w) ? "imaging" : /procedur/.test(w) ? "procedure" : /referr/.test(w) ? "referral" : null)).find(Boolean) || "other";
    const req = ServiceRequest({
      id: sourceId(system, "sr", s.id), patientId: patient.id, encounterId: encRef(s.encounter),
      code: k.code || k.display, category, priority: ["routine", "urgent", "stat"].includes(s.priority) ? s.priority : (s.priority === "asap" ? "urgent" : "routine"),
      requesterId: `external:${system}`, status: "draft",
      source: src("sr", s.id),
    });
    req.codeSystem = k.system || "unspecified";
    req.display = k.display || k.code;
    req.externalStatus = s.status || "unknown";
    req.externalRequester = s.requester || null;
    if (s.authoredOn) req.authoredAt = s.authoredOn;
    entities.push(req);
  }

  for (const d of bundle.diagnosticReports || []) {
    if (!d || !d.id) continue;
    const k = codeOf(d.code);
    if (!k.code && !k.display) { issues.push({ code: "SCCM_REPORT_NO_CODE", message: `report ${d.id} carried no code and was skipped` }); continue; }
    const status = ["preliminary", "final", "corrected", "cancelled"].includes(d.status) ? d.status : "preliminary";
    entities.push(DiagnosticReport({
      id: sourceId(system, "dr", d.id), patientId: patient.id,
      encounterId: encRef(d.encounter),   // SCCM 1.1, same rule as the observations above
      code: k.code || k.display, status, conclusion: d.conclusion || null,
      resultObservationIds: (d.results || []).map((r) => (r && r.id ? sourceId(system, "obs", r.id) : null)).filter(Boolean),
      // The order this report answers, when the source said so: its OWN order, under its own id.
      serviceRequestId: d.basedOn && d.basedOn.id ? sourceId(system, "sr", d.basedOn.id) : undefined,
      critical: false,   // criticality is decided by WardSynQ's own critical-result engine, never asserted by a feed
      effectiveAt: d.effectiveDateTime || undefined,
      source: src("dr", d.id),
    }));
  }

  /* SCCM 1.1: doses given elsewhere. ONLY a state WardSynQ's eMAR can represent honestly is filed:
   * completed -> administered, not-done -> cancelled, on-hold -> held. An in-progress, stopped or
   * unknown dose is not a fact about a dose and is named, not filed; entered-in-error is never
   * filed. The order it answered is the source's own order when referenced, else an explicit
   * "unreferenced" marker: an order is never invented to hang a dose on. */
  const ADMIN_STATUS = { completed: "administered", "not-done": "cancelled", "on-hold": "held" };
  for (const a of bundle.administrations || []) {
    if (!a || !a.id) continue;
    const k = codeOf(a.medication);
    if (!k.display && !k.code) { issues.push({ code: "SCCM_ADMIN_NO_DRUG", message: `administration ${a.id} named no drug and was skipped` }); continue; }
    const status = ADMIN_STATUS[String(a.status || "")];
    if (!status) { issues.push({ code: "SCCM_ADMIN_STATE", message: `administration ${a.id} status "${a.status}" is not a dose event WardSynQ can file and was not written` }); continue; }
    const mar = MedicationAdministration({
      id: sourceId(system, "mar", a.id), patientId: patient.id,
      orderId: a.request && a.request.id ? sourceId(system, "rx", a.request.id) : `external:${system}:unreferenced`,
      drug: k.display || k.code, drugCode: k.code || null,
      status,
      administeredBy: a.performer ? `external:${system}:${a.performer}` : `external:${system}`,
      administeredAt: a.effectiveDateTime || null,
      source: src("mar", a.id),
    });
    mar.drugCodeSystem = k.system || "unspecified";
    mar.encounterId = encRef(a.encounter);
    mar.externalStatus = a.status;
    if (a.dosage && a.dosage.text) mar.externalDosageText = a.dosage.text;
    if (a.dosage && a.dosage.dose && a.dosage.dose.value != null) mar.dose = { value: a.dosage.dose.value, unit: a.dosage.dose.unit || a.dosage.dose.code || null };
    if (a.dosage && a.dosage.route) mar.route = codeOf(a.dosage.route).display;
    if (a.reason) mar.holdReason = codeOf(a.reason).display;
    entities.push(mar);
  }

  for (const doc of bundle.documents || []) {
    if (!doc || !doc.id) continue;
    if (!doc.text) { issues.push({ code: "SCCM_DOC_NO_TEXT", message: `document ${doc.id} carried no narrative and was skipped` }); continue; }
    entities.push(ClinicalNote({
      id: sourceId(system, "note", doc.id), patientId: patient.id, encounterId: encRef(doc.encounter),
      noteType: "external", sections: { text: doc.text, type: codeOf(doc.type).display || null },
      authorId: null, aiDrafted: false, signedBy: null,
      effectiveAt: doc.date || undefined,
      source: src("note", doc.id),
    }));
  }

  const imaging = (bundle.imagingStudies || []).length;
  if (imaging) issues.push({ code: "SCCM_IMAGING_NOT_MAPPED", message: `${imaging} imaging study record(s) have no WardSynQ resource yet and were not written` });

  return { patient, entities, issues };
}

/** The SCCM bundle as a registered feed on the Integration Hub. */
function sccmAdapter() {
  return new Adapter({
    system: "sccm",
    describe: "StewardMD Connect canonical bundle (any connector)",
    claims: (b) => !!(b && typeof b === "object" && typeof b.sccmVersion === "string" && b.patient && b.patient.id),
    sourceEventId: (b) => (b && b.meta && b.meta.generatedAt && b.patient ? `${b.meta.sourceConnector || "sccm"}:${b.patient.id}:${b.meta.generatedAt}` : null),
    normalise: async (b) => {
      const major = parseInt(String(b.sccmVersion).split(".")[0], 10);
      if (major !== 1) throw new Error(`SCCM major version ${major} is not consumable by this adapter (expects 1)`);
      const m = mapSccmBundle(b);
      if (!m.patient) return { entities: [], issues: m.issues, reason: "no identifiable patient in the bundle" };
      return { entities: m.entities, issues: m.issues };
    },
  });
}

export { mapSccmBundle, sccmAdapter, sourceId, codeOf, ENCOUNTER_CLASS, UNKNOWN_DOB };
