// functions/_connect/connectors/abdm/serialize.js — SCCM record -> NDHM-FHIR R4 document Bundle (the ABDM HIP serve map).
// The MIRROR/INVERSE of connectors/abdm/normalize.js: same RECORD_PROFILES, the inverse of its cc() text-fallback
// helper (ccInv), and its output round-trips back through normalizeNdhm to the SAME SCCM resource counts.
// R11: a StewardMD summary is emitted Composition-FIRST with author=StewardMD device + custodian=tenant org, so
// it is ingested as a decision-support document, NOT a hospital's legal medical record. R12: never throw on a
// partial record (validateNdhmDoc reports the shape errors instead). ZERO binary: attachment/Binary bytes are
// never emitted; documents are carried by-reference / narrative text only.

// The Composition-level "record" kinds (identical set + order to normalize.js RECORD_PROFILES).
const RECORD_PROFILES = ["DiagnosticReportRecord", "PrescriptionRecord", "OPConsultRecord", "DischargeSummaryRecord", "WellnessRecord", "ImmunizationRecord", "HealthDocumentRecord", "InvoiceRecord"];
const PROFILE = (name) => "https://nrces.in/ndhm/fhir/r4/StructureDefinition/" + name;

// Provenance stamp: source:"StewardMD" on every emitted resource (R11/R12).
const SOURCE_URI = "https://stewardmd.in";
const SOURCE_TAG = { system: "https://stewardmd.in/CodeSystem/provenance-source", code: "StewardMD", display: "StewardMD" };
function stampMeta(res, extra) {
  res.meta = Object.assign({ tag: [SOURCE_TAG], source: SOURCE_URI }, res.meta || {}, extra || {});
  return res;
}

const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("x" + Date.now().toString(16) + Math.random().toString(16).slice(2));
const safeIso = (d) => (d && typeof d.toISOString === "function") ? d.toISOString() : new Date().toISOString();
const humanize = (p) => String(p).replace(/Record$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Health Document";
const escapeHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// FHIR document-bundle references must RESOLVE inside the bundle, so `fullUrl` and every `reference` to
// that resource have to be the SAME string. They were not: fullUrl was "urn:uuid:composition-<id>" while
// the reference was "Composition/<id>", so a validator resolving the document found nothing - and
// "urn:uuid:composition-<id>" is not a well-formed urn:uuid either (it must be an actual UUID).
// ABDM FAQ Q37/Q46 settles the style: use urn:uuid. One UUID is minted per resource on first mention and
// reused for both sides. The WeakMap is keyed by the resource OBJECT and every serializeNdhm call builds
// fresh objects, so ids never collide across calls and entries are collected when the bundle is.
const URNS = new WeakMap();
const urnFor = (res) => {
  let u = URNS.get(res);
  if (!u) { u = "urn:uuid:" + uuid(); URNS.set(res, u); }
  return u;
};
const refOf = (res) => ({ reference: urnFor(res) });
const entryOf = (res) => ({ fullUrl: urnFor(res), resource: res });

// INVERSE of normalize.js cc(): SCCM codeable {coding:[{system,code,display,kind}],text} -> FHIR CodeableConcept
// {coding:[{system,code,display}],text}. The `kind` is dropped (FHIR has none); normalizeNdhm re-derives it from
// its STD set — so preserving `system` verbatim keeps a local code local and a standard system standard. ALWAYS a
// non-empty `text` (the R12 fallback).
function ccInv(sccmCc, fallback) {
  const text = (sccmCc && typeof sccmCc.text === "string" && sccmCc.text.trim()) ? sccmCc.text.trim() : (fallback || "unknown");
  const coding = ((sccmCc && sccmCc.coding) || [])
    .map((c) => { const o = {}; if (c.system) o.system = c.system; if (c.code) o.code = c.code; if (c.display) o.display = c.display; return o; })
    .filter((c) => c.system || c.code || c.display);
  return { coding, text };
}
// A status/category coding that still carries the mandatory text fallback (so validateNdhmDoc sees a text).
const codedText = (code, text) => ({ coding: code ? [{ code }] : [], text: String(text || code || "unknown") });

function pickProfile(r) {
  const p = r && r.profile;
  if (typeof p === "string" && RECORD_PROFILES.includes(p)) return p;
  return "DischargeSummaryRecord"; // StewardMD decision-support summaries default to a discharge-summary record
}

function buildPatient(p) {
  const res = { resourceType: "Patient", id: p.id, gender: p.gender || "unknown" };
  if (p.birthDate) res.birthDate = p.birthDate;
  if (p.name) { const n = {}; if (p.name.text) n.text = p.name.text; if (p.name.family) n.family = p.name.family; if (p.name.given) n.given = p.name.given; res.name = [n]; }
  return stampMeta(res);
}
function buildAuthorDevice() {
  // StewardMD Device = the software author of the summary (Device.type omitted: a CodeableConcept must carry text).
  return stampMeta({ resourceType: "Device", id: "stewardmd-cds", status: "active", manufacturer: "StewardMD", deviceName: [{ name: "StewardMD Clinical Decision Support", type: "user-friendly-name" }] });
}
function buildCustodianOrg(tenantId) {
  const t = String(tenantId || "stewardmd").replace(/[^A-Za-z0-9_-]/g, "-");
  return stampMeta({ resourceType: "Organization", id: "stewardmd-org-" + t, name: "StewardMD (tenant " + (tenantId || "stewardmd") + ")" });
}
// The HFR facility this document was produced at. ABDM's Main Envelope requires
// Composition.attester.party to be an Organization whose identifier.value is the HIP id, with the facility
// registry as the system - that is how the HIE-CM attributes a record to a real facility.
const FACILITY_SYSTEM = { sandbox: "https://facilitysbx.ndhm.gov.in", production: "https://facility.ndhm.gov.in" };
export function facilitySystemFor(envName) {
  return FACILITY_SYSTEM[String(envName || "sandbox").toLowerCase()] || FACILITY_SYSTEM.sandbox;
}
function buildHipOrg(hipId, system) {
  const safe = String(hipId).replace(/[^A-Za-z0-9_-]/g, "-");
  return stampMeta({
    resourceType: "Organization", id: "hip-" + safe, name: "StewardMD HIP " + hipId,
    identifier: [{ system, value: String(hipId) }],
  });
}
function buildCondition(c) {
  return stampMeta({ resourceType: "Condition", id: c.id, code: ccInv(c.code, "condition"), clinicalStatus: codedText(c.clinicalStatus || "unknown") });
}
function buildMedication(m) {
  const rt = m.origin === "order" ? "MedicationRequest" : "MedicationStatement";
  const res = { resourceType: rt, id: m.id, status: m.status || "unknown", medicationCodeableConcept: ccInv(m.medication, "medication") };
  if (rt === "MedicationRequest") res.intent = "order";
  if (m.dosage && m.dosage.text) { if (rt === "MedicationRequest") res.dosageInstruction = [{ text: m.dosage.text }]; else res.dosage = [{ text: m.dosage.text }]; }
  return stampMeta(res);
}
function buildAllergy(a) {
  return stampMeta({ resourceType: "AllergyIntolerance", id: a.id, criticality: a.criticality || "unable-to-assess", code: ccInv(a.code, "allergen") });
}
function buildObservation(o) {
  const res = { resourceType: "Observation", id: o.id, status: o.status || "unknown", category: [codedText(o.category, o.category || "observation")], code: ccInv(o.code, "observation") };
  const v = o.value;
  if (v != null) {
    if (typeof v.text === "string" && v.value == null && v.unit == null) res.valueString = v.text;
    else { const q = {}; if (v.value != null) q.value = v.value; if (v.unit) q.unit = v.unit; if (v.system) q.system = v.system; if (v.code) q.code = v.code; res.valueQuantity = q; }
  }
  if (o.effectiveDateTime) res.effectiveDateTime = o.effectiveDateTime;
  return stampMeta(res);
}
function buildDiagnosticReport(d) {
  const res = { resourceType: "DiagnosticReport", id: d.id, status: d.status || "unknown", code: ccInv(d.code, "report") };
  if (d.conclusion) res.conclusion = d.conclusion;
  if (d.effectiveDateTime) res.effectiveDateTime = d.effectiveDateTime;
  const result = (d.results || []).filter((rr) => rr && rr.type === "Observation" && rr.id).map((rr) => ({ reference: "Observation/" + rr.id }));
  if (result.length) res.result = result;
  return stampMeta(res);
}
function buildDocumentReference(d) {
  // By-reference metadata only — NO attachment.data / Binary bytes are ever emitted.
  return stampMeta({ resourceType: "DocumentReference", id: d.id, status: d.status || "unknown", type: ccInv(d.type, "document"), content: [{ attachment: { title: d.text || undefined } }] });
}

// Group section entries by title, preserving insertion order (matches how normalizeNdhm walks flattened sections).
function sectionPusher() {
  const byTitle = new Map(); const list = [];
  return { list, add(title, ref) { let s = byTitle.get(title); if (!s) { s = { title, entry: [] }; byTitle.set(title, s); list.push(s); } s.entry.push(ref); } };
}

export function serializeNdhm(ctx, record) {
  const identifier = { system: "urn:ietf:rfc:3986", value: "urn:uuid:" + uuid() }; // globally-unique, FRESH per call
  const generatedAt = (ctx && typeof ctx.now === "function") ? safeIso(ctx.now()) : new Date().toISOString();
  const meta = { tag: [SOURCE_TAG], source: SOURCE_URI };
  try {
    const r = record || {};
    const tenantId = (r.tenantId) || (ctx && ctx.tenant && ctx.tenant.id) || "stewardmd";
    const profile = pickProfile(r);

    const patientRes = (r.patient && r.patient.id) ? buildPatient(r.patient) : null;
    const author = buildAuthorDevice();
    const custodian = buildCustodianOrg(tenantId);

    const clinical = [];              // {fullUrl, resource} entries referenced by the Composition sections
    const sec = sectionPusher();
    const add = (res, title) => { clinical.push(entryOf(res)); sec.add(title, refOf(res)); };

    for (const c of (r.conditions || [])) if (c && c.id) add(buildCondition(c), "Diagnosis");
    for (const m of (r.medications || [])) if (m && m.id) add(buildMedication(m), "Medications");
    for (const a of (r.allergies || [])) if (a && a.id) add(buildAllergy(a), "Allergies");
    for (const o of (r.observations || [])) if (o && o.id) add(buildObservation(o), "Observations");
    for (const d of (r.diagnosticReports || [])) if (d && d.id) add(buildDiagnosticReport(d), "Investigations");

    // documents[0] IS the summary itself -> it becomes the Composition narrative (normalizeNdhm always re-captures
    // the Composition as one documentReference). documents[1..] become by-reference DocumentReference resources.
    // This keeps the round-trip document count exact.
    const docs = r.documents || [];
    const primaryDoc = docs[0] || null;
    for (let i = 1; i < docs.length; i++) if (docs[i] && docs[i].id) add(buildDocumentReference(docs[i]), "Documents");

    // The attesting facility. Present only when a HIP id is configured - an unattested bundle is still a
    // valid document, but an attester pointing at a blank facility id would be worse than none.
    const hipId = (ctx && ctx.hipId) || null;
    const hipOrg = hipId ? buildHipOrg(hipId, (ctx && ctx.facilitySystem) || facilitySystemFor(ctx && ctx.envName)) : null;
    const comp = buildComposition({ profile, primaryDoc, patientRes, author, custodian, hipOrg, generatedAt, sections: sec.list });

    const entry = [entryOf(comp)]; // Composition FIRST
    if (patientRes) entry.push(entryOf(patientRes));
    entry.push(entryOf(author), entryOf(custodian));
    if (hipOrg) entry.push(entryOf(hipOrg));
    for (const e of clinical) entry.push(e);

    return { resourceType: "Bundle", type: "document", identifier, timestamp: generatedAt, meta, entry };
  } catch (e) {
    // R12: never throw on a partial/malformed record — return a shell bundle that validateNdhmDoc will reject.
    return { resourceType: "Bundle", type: "document", identifier, timestamp: generatedAt, meta: Object.assign({}, meta, { warning: "serializeNdhm degraded: " + (e && e.message) }), entry: [] };
  }
}

function buildComposition({ profile, primaryDoc, patientRes, author, custodian, hipOrg, generatedAt, sections }) {
  const id = (primaryDoc && primaryDoc.id) || ("comp-" + uuid());
  const typeCc = (primaryDoc && primaryDoc.type) ? ccInv(primaryDoc.type, humanize(profile)) : ccInv(null, humanize(profile));
  const narrative = (primaryDoc && primaryDoc.text) ? primaryDoc.text : (humanize(profile) + " generated by StewardMD clinical decision support");
  const comp = {
    resourceType: "Composition", id, status: "final",
    meta: { profile: [PROFILE(profile)], tag: [SOURCE_TAG], source: SOURCE_URI },
    type: typeCc, title: humanize(profile), date: generatedAt,
    text: { status: "generated", div: '<div xmlns="http://www.w3.org/1999/xhtml">' + escapeHtml(narrative) + "</div>" },
    section: sections,
  };
  if (patientRes) comp.subject = refOf(patientRes);
  comp.author = [refOf(author)];       // StewardMD Device
  comp.custodian = refOf(custodian);   // StewardMD tenant Organization
  // Main Envelope: attester.party = the HFR facility Organization carrying our HIP id.
  if (hipOrg) comp.attester = [{ mode: "official", time: generatedAt, party: refOf(hipOrg) }];
  return comp;
}

// Structural NDHM-document shape checker (mirror of what the HIU normalizer expects). NOT full profile conformance.
// VERIFY: validate the emitted bundle against the live NRCES/FHIR validator (R11) — this is the structural gate, not full profile conformance.
export function validateNdhmDoc(docBundle) {
  const errors = [];
  const b = docBundle;
  if (!b || typeof b !== "object") return { ok: false, errors: ["bundle missing or not an object"] };
  if (b.type !== "document") errors.push('Bundle.type must be "document"');
  const id = b.identifier;
  if (!id || typeof id.value !== "string" || !id.value.trim()) errors.push("Bundle.identifier.value missing (a globally-unique non-empty urn is required)");
  const entries = Array.isArray(b.entry) ? b.entry : [];
  const first = entries[0] && entries[0].resource;
  if (!first || first.resourceType !== "Composition") errors.push("first entry must be a Composition (Composition-first, R11)");
  else {
    if (!first.subject) errors.push("Composition.subject (Patient) missing");
    if (!first.author || (Array.isArray(first.author) ? first.author.length === 0 : !first.author)) errors.push("Composition.author (StewardMD device/organization) missing");
    if (!first.custodian) errors.push("Composition.custodian (StewardMD tenant organization) missing");
  }
  walkDoc(b, errors, "Bundle"); // every CodeableConcept carries a non-empty text; and NO binary/attachment bytes.
  return { ok: errors.length === 0, errors };
}

function walkDoc(node, errors, path) {
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) walkDoc(node[i], errors, path + "[" + i + "]"); return; }
  if (!node || typeof node !== "object") return;
  if (node.resourceType === "Binary") errors.push(path + ": Binary resource (raw bytes) is not permitted in a decision-support document");
  if (Array.isArray(node.coding) && (typeof node.text !== "string" || !node.text.trim())) errors.push(path + ": CodeableConcept missing a non-empty text fallback");
  if (typeof node.data === "string" && node.data.trim()) errors.push(path + ".data: inline attachment/Binary bytes are not permitted (metadata / narrative only)");
  if (typeof node.url === "string" && /^data:/i.test(node.url)) errors.push(path + ".url: data: URI bytes are not permitted");
  for (const k of Object.keys(node)) { if (k === "meta") continue; walkDoc(node[k], errors, path + "." + k); }
}
