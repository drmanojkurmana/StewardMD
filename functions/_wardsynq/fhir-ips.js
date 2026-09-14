/* functions/_wardsynq/fhir-ips.js - Patient/{id}/$summary: an International Patient Summary document.
 *
 * $everything hands a receiver the whole compartment and leaves them to decide what matters. A
 * patient arriving at another hospital's emergency department needs one page: what they have, what
 * they react to, what they take, and their recent results. This is that page, as a FHIR document
 * Bundle with a Composition whose sections are the IPS ones.
 *
 * NOTHING NEW IS SAID HERE. Every entry is the SAME resource the read API serves (fhir.js toFhir),
 * read through the same governed service, fenced to the same patient for a SMART patient/ token. So
 * $summary is authorised exactly like a compartment read, on both doors, and cannot show a reader
 * anything $everything would not.
 *
 * AN EMPTY SECTION AND AN UNREADABLE SECTION ARE DIFFERENT FACTS, and the difference is the whole
 * clinical safety case of this file:
 *
 *   NONE RECORDED. The source was read and held nothing current. The section stays, with emptyReason
 *   as TEXT ONLY. Not "nilknown": a record with no allergy rows is not a clinician's judgement that
 *   there are none (migrate-allergy.js writes nothing for "NKDA"), and not "notasked": we do not know
 *   whether anybody asked. The words say exactly that.
 *
 *   COULD NOT BE READ. The read failed or this reader may not see that type. The section stays with
 *   emptyReason `unavailable` (or `withheld` for a permission refusal) and NO entries, even when a
 *   second source for the same section was readable: a half list that looks whole is the harm.
 *
 * A required section (problems, allergies, medications) is never omitted. Results appear when there
 * are any, or when they could not be read. Immunizations (G6, immunization.js) are always present too:
 * "no vaccines recorded here" and "the vaccine history could not be read" are the same two different
 * facts as for allergies, and a receiving clinic deciding whether to give a dose needs to tell them
 * apart. A withdrawn (entered-in-error) entry is left out; a dose recorded as not given stays, marked.
 *
 * Not claimed: conformance to the IPS implementation guide's profiles. No meta.profile is set,
 * because nothing here validates against them.
 */

import { toFhir, open, resolveId, operationOutcome } from "./fhir.js";
import { fhirOrganization } from "./fhir-identity.js";
import { PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";

const str = (v) => (v == null ? "" : String(v).trim());
const code0 = (cc) => str(cc && cc.coding && cc.coding[0] && cc.coding[0].code);
const LOINC = "http://loinc.org";
const EMPTY_REASON = "http://terminology.hl7.org/CodeSystem/list-empty-reason";
/** ponytail: the newest results only, said in the section text when it bites; $everything has the rest. */
const MAX_RESULTS = 100;

/* The IPS section codes are LOINC's, published by the IPS guide; `keep` is what counts as current. */
const SECTIONS = Object.freeze([
  { key: "problems", title: "Active problems", code: "11450-4", display: "Problem list - Reported", types: ["Condition"], required: true,
    keep: (r) => !["resolved", "inactive", "remission"].includes(code0(r.clinicalStatus)) && code0(r.verificationStatus) !== "refuted" },
  { key: "allergies", title: "Allergies and intolerances", code: "48765-2", display: "Allergies and adverse reactions Document", types: ["AllergyIntolerance"], required: true,
    keep: (r) => code0(r.clinicalStatus) !== "inactive" },
  { key: "medications", title: "Medication summary", code: "10160-0", display: "History of Medication use Narrative", types: ["MedicationOrder"], required: true,
    keep: (r) => ["active", "on-hold"].includes(str(r.status)) },
  { key: "immunizations", title: "Immunizations", code: "11369-6", display: "History of Immunization Narrative", types: ["Immunization"], required: true,
    keep: (r) => str(r.status) !== "entered-in-error" },
  { key: "results", title: "Results", code: "30954-2", display: "Relevant diagnostic tests/laboratory data Narrative", types: ["DiagnosticReport", "Observation"], required: false,
    keep: (r) => r.resourceType === "DiagnosticReport" || (r.category || []).some((c) => code0(c) === "laboratory") },
]);

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const div = (inner) => ({ status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` });

/** PURE. One line a reader can scan: the concept's own text, and a value where there is one. */
function labelOf(r) {
  const cc = r.code || r.medicationCodeableConcept || r.vaccineCode || {};
  const name = str(cc.text) || str(cc.coding && cc.coding[0] && (cc.coding[0].display || cc.coding[0].code)) || r.resourceType;
  const q = r.valueQuantity;
  const value = q ? ` ${q.value}${q.unit ? " " + q.unit : ""}` : r.valueString ? ` ${r.valueString}`
    : r.resourceType === "Immunization" && r.status === "not-done" ? ` - not given${r.statusReason && r.statusReason.text ? ": " + r.statusReason.text : ""}` : "";
  const when = str(r.effectiveDateTime || r.authoredOn || r.recordedDate || r.onsetDateTime || r.occurrenceDateTime);
  return `${name}${value}${when ? ` (${when.slice(0, 10)})` : ""}`;
}

/**
 * PURE. One Composition section from what its sources gave. `sources` is [{ type, rows }] for a read
 * that worked and [{ type, error }] for one that did not.
 */
function sectionOf(def, sources) {
  const failed = sources.filter((s) => s.error);
  const base = { title: def.title, code: { coding: [{ system: LOINC, code: def.code, display: def.display }] } };
  if (failed.length) {
    const refused = failed.every((s) => s.error instanceof PermissionError || s.error instanceof GovernanceError);
    const why = refused ? "you may not see" : "could not be read";
    return { section: { ...base, text: div(`${esc(def.title)}: ${esc(failed.map((s) => s.type).join(", "))} ${why}. This is not a statement that there are none.`),
      emptyReason: { coding: [{ system: EMPTY_REASON, code: refused ? "withheld" : "unavailable" }], text: `Not available: ${why}` } }, entries: [] };
  }
  let entries = sources.flatMap((s) => s.rows).filter(def.keep);
  entries.sort((a, b) => str(b.meta && b.meta.lastUpdated).localeCompare(str(a.meta && a.meta.lastUpdated)));
  const cut = def.key === "results" && entries.length > MAX_RESULTS ? entries.length : 0;
  if (cut) entries = entries.slice(0, MAX_RESULTS);
  if (!entries.length) {
    if (!def.required) return null;
    return { section: { ...base, text: div(`${esc(def.title)}: none recorded.`),
      emptyReason: { text: "None recorded in this record. This is not a clinical statement that there are none." } }, entries: [] };
  }
  const list = `<ul>${entries.map((r) => `<li>${esc(labelOf(r))}</li>`).join("")}</ul>`;
  return { section: { ...base, text: div(list + (cut ? `<p>The newest ${MAX_RESULTS} of ${cut} results.</p>` : "")), entry: entries.map((r) => ({ reference: `${r.resourceType}/${r.id}` })) }, entries };
}

/**
 * GET Patient/{id}/$summary. ctx: { migration, patientId, base, org?, hospitalName?, actorDeps, recordDeps, actorOverride? }
 */
async function patientSummary(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const requestedId = str(ctx.patientId);
  if (!requestedId) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "patient is required") };

  const { svc, resolved, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  const patientId = await resolveId(svc, "Patient", requestedId);
  if (resolved && resolved.patientId && resolved.compartmentTypes !== null && resolved.compartmentTypes !== undefined && patientId !== str(resolved.patientId)) {
    return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", "outside the token's patient context") };
  }
  let patient = null;
  try { const p = await svc.get("Patient", patientId); patient = p ? toFhir(p) : null; }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!patient) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such patient") };

  const read = new Map();
  for (const t of [...new Set(SECTIONS.flatMap((s) => s.types))]) {
    try { read.set(t, { type: t, rows: ((await svc.byPatient(t, patientId)) || []).map(toFhir).filter(Boolean) }); }
    catch (e) { read.set(t, { type: t, error: e }); }
  }

  const sections = [], included = new Map();
  for (const def of SECTIONS) {
    const s = sectionOf(def, def.types.map((t) => read.get(t)));
    if (!s) continue;
    sections.push(s.section);
    for (const r of s.entries) included.set(`${r.resourceType}/${r.id}`, r);
  }

  const now = new Date().toISOString();
  const org = fhirOrganization(ctx.org);
  const composition = {
    resourceType: "Composition", id: crypto.randomUUID(),
    status: "final",
    type: { coding: [{ system: LOINC, code: "60591-5", display: "Patient summary Document" }] },
    subject: { reference: `Patient/${patient.id}` },
    date: now,
    author: [org ? { reference: `Organization/${org.id}`, display: org.name } : { display: str(ctx.hospitalName) || "WardSynQ" }],
    title: "International Patient Summary",
    ...(org ? { custodian: { reference: `Organization/${org.id}` } } : {}),
    section: sections,
  };
  const base = str(ctx.base);
  const entry = (r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r });
  return {
    ok: true, status: 200,
    bundle: {
      resourceType: "Bundle",
      identifier: { system: "urn:ietf:rfc:3986", value: `urn:uuid:${crypto.randomUUID()}` },
      type: "document", timestamp: now,
      entry: [{ fullUrl: `${base}/Composition/${composition.id}`, resource: composition }, entry(patient), ...(org ? [entry(org)] : []), ...[...included.values()].map(entry)],
    },
  };
}

export { SECTIONS, MAX_RESULTS, sectionOf, labelOf, patientSummary };
