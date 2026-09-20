/* functions/_wardsynq/fhir-version.js - R4B and R5 at the boundary (D9). PURE.
 *
 * The canonical record is not FHIR, and R4 is a rendering of it (fhir.js). R4B and R5 are further
 * renderings of that R4, chosen per request by the MIME parameter FHIR defines for exactly this:
 *
 *   Accept: application/fhir+json; fhirVersion=4.3     R4B
 *   Accept: application/fhir+json; fhirVersion=5.0     R5
 *   no fhirVersion                                     R4 (4.0), as before
 *
 * Any other fhirVersion is a 406 naming the versions served. No version appears in a URL.
 *
 * R4B. The published R4-to-R4B structural diff changes nothing this server emits (it retypes
 * Element.id, adds datatypes and adds reference targets), so R4B is the R4 resource, re-validated
 * against the R4B tables. A type with no validator table (CodeSystem, ValueSet, AuditEvent, Group, the IPS
 * Composition) is not declared or served as R4B either. Bulk export, Subscription $status (the R4B backport
 * answers a SubscriptionStatus resource, not Parameters) and every write stay R4 only.
 *
 * R5. A real transform, for the resources partners ask for first: Patient, Encounter, Observation,
 * Condition, AllergyIntolerance, MedicationRequest, Immunization, and the Bundle and OperationOutcome
 * around them. Every element this server emits that the R5 diff renamed, retyped or moved is moved here;
 * see TO_R5 for each. Anything else asked for as R5 is a 406 OperationOutcome that names the type,
 * never a resource shaped like R4 wearing an R5 label.
 *
 * VALIDATE BEFORE ANSWERING. Every rendered resource is checked against that version's tables
 * (fhir-validate.js) before it leaves. One that does not validate is not sent: the answer is a 406 naming
 * what could not be rendered, because a wrongly shaped resource is believed by whoever parses it.
 *
 * WHAT R5 LOSES, SAID HERE AND IN THE CAPABILITYSTATEMENT. Immunization.recorded does not exist in R5
 * and is not carried (meta.lastUpdated still says when this server learned the fact). A Condition with no
 * recorded clinical status is sent as clinicalStatus "unknown", the R5 code for exactly that, because R5
 * makes the element required and "unknown" is the only true value.
 */

import { validateResource, TABLES } from "./fhir-validate.js";

const str = (v) => (v == null ? "" : String(v).trim());
const VERSIONS = Object.freeze({ "4.0": "4.0.1", "4.3": "4.3.0", "5.0": "5.0.0" });
const R5_TYPES = Object.freeze(["Patient", "Encounter", "Observation", "Condition", "AllergyIntolerance", "MedicationRequest", "Immunization"]);
const R5_CARRIERS = Object.freeze(["Bundle", "OperationOutcome"]);
/** PURE. Whether `type` is rendered in `version`: it has that version's validator table (and, for R5, is one of the R5 set). */
const rendered = (version, type) => !!(TABLES[version] && TABLES[version].RESOURCES[type]) && (version !== "5.0" || R5_TYPES.includes(type) || R5_CARRIERS.includes(type));
const clone = (o) => JSON.parse(JSON.stringify(o));
const oo = (code, detail) => ({ resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: detail }] });

/**
 * PURE. The FHIR version one media-type header asks for. `header` is an Accept (a list with q values)
 * or a Content-Type (one type). Returns { version } or { error }.
 */
function versionFromHeader(header) {
  const h = str(header);
  if (!h) return { version: "4.0" };
  const asked = [];
  for (const part of h.split(",")) {
    const bits = part.split(";").map(str);
    const params = Object.fromEntries(bits.slice(1).map((b) => { const i = b.indexOf("="); return i < 0 ? [b.toLowerCase(), ""] : [b.slice(0, i).trim().toLowerCase(), b.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
    if (params.fhirversion === undefined) continue;
    const q = params.q === undefined ? 1 : Number(params.q);
    asked.push({ raw: params.fhirversion, q: Number.isFinite(q) ? q : 0 });
  }
  if (!asked.length) return { version: "4.0" };
  const norm = (v) => { const m = /^(\d+\.\d+)(\.\d+)?$/.exec(v); return m && VERSIONS[m[1]] && (!m[2] || VERSIONS[m[1]] === v) ? m[1] : null; };
  const served = asked.filter((a) => a.q > 0 && norm(a.raw)).sort((a, b) => b.q - a.q);
  if (served.length) return { version: norm(served[0].raw) };
  return { error: `fhirVersion ${asked.map((a) => a.raw).join(", ")} is not served here; this server answers fhirVersion=4.0 (the default), 4.3 or 5.0` };
}

/** PURE. The Content-Type a response in `version` carries. */
const contentTypeFor = (version) => (version && version !== "4.0" ? `application/fhir+json; fhirVersion=${version}; charset=utf-8` : "application/fhir+json; charset=utf-8");

/* ---- R4 to R5, per resource ------------------------------------------------------------------------ */

const toConcept = (cc) => ({ concept: cc });
const R5_ENCOUNTER_STATUS = Object.freeze({ planned: "planned", arrived: "in-progress", triaged: "in-progress", "in-progress": "in-progress", onleave: "on-hold", finished: "completed", cancelled: "cancelled", "entered-in-error": "entered-in-error", unknown: "unknown" });

const TO_R5 = Object.freeze({
  Patient: (r) => r,
  Observation: (r) => r,
  /* status: finished became completed (arrived and triaged are in-progress, onleave is on-hold).
   * class: one Coding became a list of CodeableConcept. period: renamed actualPeriod. reasonCode: became
   * reason[].value[] CodeableReference. hospitalization: renamed admission, three of its elements moved up. */
  Encounter: (r) => {
    const o = { ...r };
    o.status = R5_ENCOUNTER_STATUS[str(r.status)] || "unknown";
    if (r.class) o.class = [{ coding: [r.class] }];
    if (r.period) { o.actualPeriod = r.period; delete o.period; }
    if (r.reasonCode || r.reasonReference) {
      o.reason = [{ value: [...(r.reasonCode || []).map(toConcept), ...(r.reasonReference || []).map((ref) => ({ reference: ref }))] }];
      delete o.reasonCode; delete o.reasonReference;
    }
    if (r.hospitalization) {
      const { dietPreference, specialArrangement, specialCourtesy, ...admission } = r.hospitalization;
      if (dietPreference) o.dietPreference = dietPreference;
      if (specialArrangement) o.specialArrangement = specialArrangement;
      if (specialCourtesy) o.specialCourtesy = specialCourtesy;
      if (Object.keys(admission).length) o.admission = admission;
      delete o.hospitalization;
    }
    if (Array.isArray(r.participant)) o.participant = r.participant.map(({ individual, ...p }) => (individual ? { ...p, actor: individual } : p));
    if (Array.isArray(r.location)) o.location = r.location.map(({ physicalType, ...l }) => (physicalType ? { ...l, form: physicalType } : l));
    return o;
  },
  /* clinicalStatus is required in R5: absent is sent as "unknown". evidence and recorder/asserter are not emitted. */
  Condition: (r) => (r.clinicalStatus ? r : { ...r, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "unknown" }] } }),
  /* reaction.manifestation: CodeableConcept became CodeableReference. */
  AllergyIntolerance: (r) => (Array.isArray(r.reaction) ? { ...r, reaction: r.reaction.map((x) => (Array.isArray(x.manifestation) ? { ...x, manifestation: x.manifestation.map(toConcept) } : x)) } : r),
  /* medication[x] became medication (CodeableReference); reported[x] became reported (boolean). */
  MedicationRequest: (r) => {
    const o = { ...r };
    if (r.medicationCodeableConcept || r.medicationReference) {
      o.medication = r.medicationCodeableConcept ? { concept: r.medicationCodeableConcept } : { reference: r.medicationReference };
      delete o.medicationCodeableConcept; delete o.medicationReference;
    }
    if (r.reportedBoolean !== undefined) { o.reported = r.reportedBoolean; delete o.reportedBoolean; }
    if (r.reasonCode || r.reasonReference) {
      o.reason = [...(r.reasonCode || []).map(toConcept), ...(r.reasonReference || []).map((ref) => ({ reference: ref }))];
      delete o.reasonCode; delete o.reasonReference;
    }
    return o;
  },
  /* protocolApplied.doseNumber[x] became doseNumber (string); recorded was removed; reasonCode became reason. */
  Immunization: (r) => {
    const o = { ...r };
    delete o.recorded;
    if (r.reasonCode || r.reasonReference) {
      o.reason = [...(r.reasonCode || []).map(toConcept), ...(r.reasonReference || []).map((ref) => ({ reference: ref }))];
      delete o.reasonCode; delete o.reasonReference;
    }
    if (Array.isArray(r.protocolApplied)) {
      o.protocolApplied = r.protocolApplied.map(({ doseNumberPositiveInt, doseNumberString, seriesDosesPositiveInt, seriesDosesString, ...p }) => ({
        ...p,
        doseNumber: doseNumberString !== undefined ? doseNumberString : String(doseNumberPositiveInt),
        ...(seriesDosesPositiveInt !== undefined || seriesDosesString !== undefined ? { seriesDoses: seriesDosesString !== undefined ? seriesDosesString : String(seriesDosesPositiveInt) } : {}),
      }));
    }
    return o;
  },
  OperationOutcome: (r) => r,
});

/**
 * PURE. One R4 resource (a Bundle with its entries) rendered in `version`, validated. Returns
 * { resource } or { unsupported: [types], invalid: [diagnostics] }.
 */
function renderResource(resource, version) {
  if (!resource || version === "4.0") return { resource };
  const unsupported = new Set(), invalid = [];
  const one = (r) => {
    if (!r || typeof r !== "object") return r;
    if (!rendered(version, r.resourceType)) { unsupported.add(r.resourceType); return r; }
    /* An empty entry array is not valid JSON FHIR in any version (ele-1); the R4 search Bundle still emits one, so a rendering omits it. */
    if (r.resourceType === "Bundle") { const { entry, ...b } = r; return Array.isArray(entry) && entry.length ? { ...b, entry: entry.map((e) => (e && e.resource ? { ...e, resource: one(e.resource) } : e)) } : b; }
    return version === "5.0" ? TO_R5[r.resourceType](clone(r)) : r;
  };
  const out = one(resource);
  if (unsupported.size) return { unsupported: [...unsupported].sort() };
  const v = validateResource(out, { version });
  for (const i of v.issues) if (i.severity === "error" || i.severity === "fatal") invalid.push(`${(i.expression || [])[0] || out.resourceType}: ${i.diagnostics}`);
  return invalid.length ? { unsupported: [], invalid } : { resource: out };
}

/**
 * PURE. A read's answer in the requested version: the same status, or a 406 OperationOutcome naming what
 * is not rendered. `parts` are the path segments after the FHIR root.
 */
function answerInVersion(obj, status, version, parts) {
  if (version === "4.0" || !obj) return { obj, status };
  const p = parts || [];
  if (obj.resourceType === "CapabilityStatement") return { obj: capabilityFor(obj, version), status };
  if (p[0] === "Subscription" && p[2] === "$status") return { obj: oo("not-supported", `Subscription $status is served as R4 (the Subscriptions Backport) only; ask without fhirVersion=${version}`), status: 406 };
  /* A type asked for by path that R5 does not render is refused even when the answer would be empty: an empty
   * R5 searchset for a type this server cannot render would read as "none". */
  const asked = /^[A-Z][A-Za-z]+$/.test(p[0] || "") ? p[0] : null;
  if (asked && status < 400 && !rendered(version, asked)) return { obj: oo("not-supported", `not rendered in FHIR ${VERSIONS[version]}: ${asked}.${version === "5.0" ? ` R5 is served for ${R5_TYPES.join(", ")}.` : ""} Ask without fhirVersion for R4.`), status: 406 };
  const r = renderResource(obj, version);
  if (r.resource) return { obj: r.resource, status };
  if (r.unsupported.length) return { obj: oo("not-supported", `not rendered in FHIR ${VERSIONS[version]}: ${r.unsupported.join(", ")}. ${version === "5.0" ? `R5 is served for ${R5_TYPES.join(", ")}.` : ""} Ask without fhirVersion for R4.`.replace(/\s+/g, " ").trim()), status: 406 };
  return { obj: oo("not-supported", `this answer could not be rendered as valid FHIR ${VERSIONS[version]}, so it was not sent: ${r.invalid.slice(0, 5).join("; ")}`), status: 406 };
}

/**
 * PURE. The CapabilityStatement for `version`, from the R4 one the tables generate. It removes what is
 * R4 only rather than describing it: writes, bulk export and Subscription create and $status in R4B; in
 * R5 everything but the R5 types' read, vread, history and search, and $validate.
 */
function capabilityFor(cs, version) {
  if (version === "4.0") return cs;
  const c = clone(cs);
  c.fhirVersion = VERSIONS[version];
  const rest = c.rest[0];
  delete rest.interaction;
  const readOnly = (r) => ({ ...r, interaction: r.interaction.filter((i) => !["create", "update", "delete", "patch"].includes(i.code)), updateCreate: undefined, conditionalCreate: undefined, conditionalUpdate: undefined, conditionalDelete: undefined });
  const strip = (o) => JSON.parse(JSON.stringify(o));
  if (version === "4.3") {
    rest.resource = rest.resource.filter((r) => rendered("4.3", r.type)).map((r) => { const ops = (r.operation || []).filter((o) => !["export", "status"].includes(o.name)); return strip({ ...readOnly(r), operation: ops.length ? ops : undefined }); });
    rest.operation = rest.operation.filter((o) => ["everything", "validate"].includes(o.name));
    const notR4b = cs.rest[0].resource.map((r) => r.type).filter((t) => !rendered("4.3", t));
    c.implementation.description = `FHIR R4B (4.3.0), asked for with fhirVersion=4.3: the same resources as R4, checked against the R4B base definitions before they are sent. Not served as R4B, because this server holds no R4B definition to check them against: ${notR4b.join(", ")}, and the IPS $summary document. Bulk export, Subscription create and $status, and every write are R4 only. ` + c.implementation.description;
    return c;
  }
  rest.resource = rest.resource.filter((r) => R5_TYPES.includes(r.type)).map((r) => strip({ ...readOnly(r), searchInclude: undefined, searchRevInclude: undefined, operation: undefined }));
  rest.operation = rest.operation.filter((o) => o.name === "validate").map((o) => ({ ...o, documentation: `POST {Type}/$validate or $validate with Content-Type application/fhir+json; fhirVersion=5.0 checks the body against the R5 base definitions of ${R5_TYPES.join(", ")}, Bundle and OperationOutcome.` }));
  if (rest.security && rest.security.service) rest.security.service = rest.security.service.map((s) => ({ ...s, coding: (s.coding || []).map((x) => ({ ...x, system: "http://hl7.org/fhir/restful-security-service" })) }));
  c.implementation.description = `FHIR R5 (5.0.0), asked for with fhirVersion=5.0, for ${R5_TYPES.join(", ")} only; any other type is a 406 naming it. Each is transformed from this server's R4 rendering and checked against the R5 base definitions before it is sent. Immunization.recorded has no R5 element and is not carried; a Condition with no recorded clinical status is sent as clinicalStatus unknown. ` + c.implementation.description;
  return c;
}

export { VERSIONS, R5_TYPES, versionFromHeader, contentTypeFor, renderResource, answerInVersion, capabilityFor, TO_R5 };
