/* test/wardsynq-fhir-validate.test.mjs - R4 conformance validation, and the terminology service. Pure.
 *
 * node --test test/wardsynq-fhir-validate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResource, validationOutcome, RESOURCES, VALIDATED_TYPES, PRIMITIVES } from "../functions/_wardsynq/fhir-validate.js";
import { toFhir, fhirProvenance, capabilityStatement, FHIR_TYPE, validateFully } from "../functions/_wardsynq/fhir.js";
import { validateCode, validateCodeParameters, resetTxCache, HL7, coverage, systemUri } from "../functions/_wardsynq/terminology.js";
import { markTerminologyWithService } from "../functions/_wardsynq/fhir-inbound.js";
import { fhirId, hashedId, provenanceId, parseProvenanceId, sha256Hex } from "../functions/_wardsynq/fhir-id.js";

/** A fake terminology server: answers for what it is told, 500s for what it is not. */
function txServer(answers, log) {
  return async (url) => {
    const u = new URL(url);
    if (log) log.push(u.href);
    const key = `${u.searchParams.get("url")}|${u.searchParams.get("code")}`;
    if (!(key in answers)) return new Response("boom", { status: 500 });
    const a = answers[key];
    return new Response(JSON.stringify({ resourceType: "Parameters", parameter: [{ name: "result", valueBoolean: a.result }, ...(a.display ? [{ name: "display", valueString: a.display }] : []), ...(a.message ? [{ name: "message", valueString: a.message }] : [])] }), { status: 200, headers: { "Content-Type": "application/fhir+json" } });
  };
}

const codesOf = (r) => r.issues.map((i) => `${i.severity}:${i.code}@${i.expression[0]}`);
const errors = (r) => r.issues.filter((i) => i.severity === "error" || i.severity === "fatal");

test("a conformant Observation is valid, and every coding with a system is handed back for terminology", () => {
  const r = validateResource({ resourceType: "Observation", status: "final", code: { coding: [{ system: "http://loinc.org", code: "2160-0" }], text: "Creatinine" }, subject: { reference: "Patient/p1" }, valueQuantity: { value: 88, unit: "umol/L", system: "http://unitsofmeasure.org", code: "umol/L" } });
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.codings, [{ path: "Observation.code.coding[0]", system: "http://loinc.org", code: "2160-0", display: null }]);
  assert.equal(validationOutcome(r).issue[0].diagnostics, "All OK");
});

test("STRUCTURE: unknown elements, wrong cardinality, nulls, empty arrays and bad primitives are each named at their path", () => {
  const r = validateResource({
    resourceType: "Observation", status: "done", code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, subject: { reference: "Group/x" },
    valueQuantiy: { value: 88 }, valueString: "x", valueQuantity: { value: "88" }, dataAbsentReason: { text: "x" }, effectiveDateTime: "2026-13-01",
    category: [], note: null, performer: { reference: "Practitioner/x" },
  });
  assert.equal(r.valid, false);
  const c = codesOf(r);
  assert.ok(c.includes("error:code-invalid@Observation.status"), "status outside the REQUIRED value set");
  assert.ok(c.includes("error:structure@Observation.valueQuantiy"), "the typo is an unknown element, not a silent drop");
  assert.ok(c.includes("error:structure@Observation.value[x]"), "two value forms");
  assert.ok(c.includes("error:value@Observation.valueQuantity.value"), "a decimal is a number");
  assert.ok(c.includes("error:invariant@Observation.dataAbsentReason"), "obs-6");
  assert.ok(c.includes("error:value@Observation.effectiveDateTime"), "month 13");
  assert.ok(c.includes("error:structure@Observation.category"), "ele-1: empty array");
  assert.ok(c.includes("error:structure@Observation.note"), "null");
  assert.ok(c.includes("error:structure@Observation.performer"), "a list element given as an object");
  assert.ok(!c.some((x) => x.endsWith("@Observation.subject.reference")), "Group is an allowed subject of an Observation");
});

test("REQUIRED elements, required choice, and reference target types", () => {
  const rx = validateResource({ resourceType: "MedicationRequest", subject: { reference: "Device/d1" } });
  const c = codesOf(rx);
  assert.ok(c.includes("error:required@MedicationRequest.status"));
  assert.ok(c.includes("error:required@MedicationRequest.intent"));
  assert.ok(c.includes("error:required@MedicationRequest.medication[x]"));
  assert.ok(c.includes("error:invalid@MedicationRequest.subject.reference"), "a MedicationRequest is for a Patient or Group, not a Device");

  const adm = validateResource({ resourceType: "MedicationAdministration", status: "completed", medicationCodeableConcept: { text: "x" }, subject: { reference: "Patient/1" } });
  assert.ok(codesOf(adm).includes("error:required@MedicationAdministration.effective[x]"), "an administration must say when");

  const ok = validateResource({ resourceType: "MedicationAdministration", status: "completed", medicationCodeableConcept: { text: "x" }, subject: { reference: "Patient/1" }, effectiveDateTime: "2026-09-08T10:00:00+05:30", performer: [{ actor: { display: "Nurse" } }], request: { reference: "MedicationRequest/r1" } });
  assert.equal(ok.valid, true, JSON.stringify(ok.issues));
  // A reference must be something: an empty Reference is a structure error.
  assert.ok(codesOf(validateResource({ resourceType: "Condition", subject: {} })).includes("error:structure@Condition.subject"));
  assert.ok(codesOf(validateResource({ resourceType: "Condition", subject: { reference: "not a ref" } })).includes("error:value@Condition.subject.reference"));
  assert.equal(validateResource({ resourceType: "Condition", subject: { reference: "urn:uuid:123e4567-e89b-12d3-a456-426614174000" } }).valid, true, "a urn:uuid reference inside a transaction");
});

test("REQUIRED BINDINGS on CodeableConcepts: Condition.clinicalStatus needs the HL7 system and one of its codes", () => {
  const bad = validateResource({ resourceType: "Condition", subject: { reference: "Patient/1" }, clinicalStatus: { coding: [{ code: "active" }] } });
  assert.ok(codesOf(bad).includes("error:code-invalid@Condition.clinicalStatus"), "a bare code without the system does not satisfy a required binding");
  const good = validateResource({ resourceType: "Condition", subject: { reference: "Patient/1" }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] }, verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "provisional" }] } });
  assert.equal(good.valid, true, JSON.stringify(good.issues));
  const wrongCode = validateResource({ resourceType: "AllergyIntolerance", patient: { reference: "Patient/1" }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "ongoing" }] }, criticality: "very-high", reaction: [{ manifestation: [{ text: "rash" }], severity: "bad" }] });
  const c = codesOf(wrongCode);
  assert.ok(c.includes("error:code-invalid@AllergyIntolerance.clinicalStatus"));
  assert.ok(c.includes("error:code-invalid@AllergyIntolerance.criticality"));
  assert.ok(c.includes("error:code-invalid@AllergyIntolerance.reaction[0].severity"));
});

test("Bundle invariants: transaction entries need a request, fullUrl is unique, total only on a searchset", () => {
  const b = validateResource({ resourceType: "Bundle", type: "transaction", total: 1, entry: [
    { fullUrl: "urn:uuid:123e4567-e89b-12d3-a456-426614174000", resource: { resourceType: "Patient", id: "x" } },
    { fullUrl: "urn:uuid:123e4567-e89b-12d3-a456-426614174000", resource: { resourceType: "Patient", id: "y" }, request: { method: "POST", url: "Patient" } },
  ] });
  const c = codesOf(b);
  assert.ok(c.includes("error:invariant@Bundle.entry[0]"), "bdl-3");
  assert.ok(c.includes("error:invariant@Bundle.entry[1].fullUrl"), "bdl-7");
  assert.ok(c.includes("error:invariant@Bundle.total"), "bdl-1");
  assert.ok(c.includes("error:code-invalid@Bundle.entry[1].request.method") === false, "POST is a verb");
  const bad = validateResource({ resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Observation", status: "final" } }] });
  assert.ok(codesOf(bad).includes("error:required@Bundle.entry[0].resource.code"), "entries are validated in place, at their path");
});

test("Dosage and Timing are modelled in depth; a datatype this file does not model is accepted as an object and never rejected", () => {
  const rx = validateResource({ resourceType: "MedicationRequest", status: "active", intent: "order", subject: { reference: "Patient/1" }, medicationCodeableConcept: { text: "Metformin" },
    dosageInstruction: [{ text: "500 mg bd", route: { text: "oral" }, doseAndRate: [{ doseQuantity: { value: 500, unit: "mg" } }], timing: { repeat: { frequency: 2, period: 1, periodUnit: "d" } } }] });
  assert.equal(rx.valid, true, JSON.stringify(rx.issues));
  const badUnit = validateResource({ resourceType: "MedicationRequest", status: "active", intent: "order", subject: { reference: "Patient/1" }, medicationCodeableConcept: { text: "x" }, dosageInstruction: [{ timing: { repeat: { periodUnit: "day" } } }] });
  assert.ok(codesOf(badUnit).includes("error:code-invalid@MedicationRequest.dosageInstruction[0].timing.repeat.periodUnit"));
  const sampled = validateResource({ resourceType: "Observation", status: "final", code: { text: "ECG" }, valueSampledData: { origin: { value: 0 }, period: 1, dimensions: 1, data: "1 2 3" } });
  assert.equal(sampled.valid, true, "SampledData is accepted as an object");
  assert.ok(codesOf(validateResource({ resourceType: "Observation", status: "final", code: { text: "ECG" }, valueSampledData: "1 2 3" })).includes("error:structure@Observation.valueSampledData"));
});

test("extensions: ext-1, primitive companions, and a nested extension", () => {
  const ok = validateResource({ resourceType: "Patient", extension: [{ url: "http://x/e", valueString: "v" }, { url: "http://x/n", extension: [{ url: "a", valueBoolean: true }] }], _birthDate: { extension: [{ url: "http://x/approx", valueBoolean: true }] }, birthDate: "1975" });
  assert.equal(ok.valid, true, JSON.stringify(ok.issues));
  const both = validateResource({ resourceType: "Patient", extension: [{ url: "http://x/e", valueString: "v", extension: [{ url: "a", valueBoolean: true }] }] });
  assert.ok(codesOf(both).includes("error:structure@Patient.extension[0]"), "ext-1: value or children");
  const neither = validateResource({ resourceType: "Patient", extension: [{ url: "http://x/e" }] });
  assert.ok(codesOf(neither).includes("error:structure@Patient.extension[0]"));
  assert.ok(codesOf(validateResource({ resourceType: "Patient", _name: {} })).includes("error:structure@Patient._name"), "a companion only for a primitive");
});

test("PROFILES: a declared profile the hospital loaded is applied; one it did not is an information issue, never a pass", () => {
  const profiles = { "http://x/p": { Patient: { identifier: { min: 1 }, gender: { min: 1, binding: { codes: ["male", "female"] } }, "name.family": { min: 1 }, active: { fixed: true } } } };
  const r = validateResource({ resourceType: "Patient", meta: { profile: ["http://x/p"] }, name: [{ text: "x" }], gender: "other", active: false }, { profiles });
  const c = codesOf(r);
  assert.ok(c.includes("error:required@Patient.identifier"));
  assert.ok(c.includes("error:code-invalid@Patient.gender"));
  assert.ok(c.includes("error:required@Patient.name.family"));
  assert.ok(c.includes("error:value@Patient.active"));
  const ok = validateResource({ resourceType: "Patient", meta: { profile: ["http://x/p"] }, identifier: [{ value: "1" }], name: [{ family: "Rao" }], gender: "female", active: true }, { profiles });
  assert.equal(ok.valid, true, JSON.stringify(ok.issues));
  const unknown = validateResource({ resourceType: "Patient", meta: { profile: ["http://y/p"] } });
  assert.equal(unknown.valid, true);
  assert.equal(unknown.issues[0].severity, "information");
  assert.match(unknown.issues[0].diagnostics, /not held by this server and was not evaluated/);
});

test("EVERYTHING THIS SERVER EXPORTS VALIDATES: each mapper's output, its Provenance, and the CapabilityStatement", () => {
  const meta = { recordedAt: "2026-09-08T10:00:00.000Z", effectiveAt: "2026-09-08T09:00:00.000Z", source: { system: "wardsynq-native", sourceId: null } };
  const by = { id: "fb:dr", kind: "human", at: "2026-09-08T10:00:01.000Z" };
  const records = [
    { resourceType: "Patient", id: "p1", version: 1, mrn: "MRN-1", name: "Asha Rao", sex: "female", dob: "1975-03-09", identifiers: [{ system: "abha", value: "91-1" }, { system: "urn:his:mrn", value: "H1", type: "MR" }], meta, writtenBy: by },
    { resourceType: "Encounter", id: "e1", version: 2, patientId: "p1", status: "in-progress", class: "IPD", periodStart: "2026-09-01T08:00:00.000Z", reason: "chest pain", location: { ward: "Medical A", bed: "12" }, meta, writtenBy: by },
    { resourceType: "Condition", id: "c1", version: 1, patientId: "p1", encounterId: "e1", code: "E11.9", codeSystem: "icd-10", display: "T2DM", clinicalStatus: "active", verificationStatus: "provisional", onsetDate: "2020", note: "x", meta, writtenBy: by },
    { resourceType: "Condition", id: "c2", version: 1, patientId: "p1", code: "HBA1C-X", codeSystem: "unmapped", display: "local", terminologyStatus: "unmapped", sourceCoding: { system: "http://his.example/codes", code: "HBA1C-X", display: "local" }, meta, writtenBy: by },
    { resourceType: "AllergyIntolerance", id: "a1", version: 1, patientId: "p1", substance: "Penicillin", criticality: "high", reaction: "Anaphylaxis", severity: "severe", reportedText: "pen", meta, writtenBy: by },
    { resourceType: "Observation", id: "o1", version: 3, patientId: "p1", encounterId: "e1", code: "2160-0", codeSystem: "loinc", display: "Creatinine", value: 88, unit: "umol/L", category: "laboratory", meta, writtenBy: by },
    { resourceType: "Observation", id: "o2", version: 1, patientId: "p1", code: "note", codeSystem: "text", display: "Pain score", value: "7/10", category: "vital-signs", meta, writtenBy: by },
    { resourceType: "MedicationOrder", id: "m1", version: 1, patientId: "p1", encounterId: "e1", drug: "Metformin", drugCode: "6809", drugCodeSystem: "rxnorm", status: "active", prescriberId: "fb:dr", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "bd", meta, writtenBy: by },
    { resourceType: "MedicationAdministration", id: "ma1", version: 1, patientId: "p1", encounterId: "e1", orderId: "m1", drug: "Metformin", status: "administered", administeredAt: "2026-09-08T08:00:00.000Z", administeredBy: "fb:nurse", meta, writtenBy: by },
    { resourceType: "ServiceRequest", id: "s1", version: 1, patientId: "p1", encounterId: "e1", code: "Renal profile", codeSystem: "text", status: "active", requesterId: "fb:dr", meta, writtenBy: by },
    { resourceType: "DiagnosticReport", id: "d1", version: 1, patientId: "p1", encounterId: "e1", serviceRequestId: "s1", code: "Renal profile", codeSystem: "text", status: "final", reportedAt: "2026-09-08T09:30:00.000Z", conclusion: "ok", resultObservationIds: ["o1"], meta, writtenBy: by },
    { resourceType: "ClinicalNote", id: "n1", version: 1, patientId: "p1", encounterId: "e1", noteType: "ward-round", sections: { impression: "stable", plan: "continue" }, authorId: "fb:dr", signedBy: "fb:dr", meta, writtenBy: by },
    { resourceType: "ClinicalNote", id: "n2", version: 1, patientId: "p1", noteType: "draft", sections: {}, authorId: "fb:dr", meta, writtenBy: by },
    { resourceType: "PatientConsent", id: "k1", version: 1, patientId: "p1", scope: "share-external", decision: "refused", recordedAt: "2026-09-08T10:00:00.000Z", giverName: "Asha Rao", capacity: true, validFrom: "2026-09-08", meta, writtenBy: by },
  ];
  for (const rec of records) {
    const f = toFhir(rec);
    assert.ok(f, rec.resourceType);
    const r = validateResource(f);
    assert.equal(r.valid, true, `${rec.resourceType}/${rec.id}: ${JSON.stringify(errors(r))}`);
    const p = validateResource(fhirProvenance(rec));
    assert.equal(p.valid, true, `Provenance of ${rec.resourceType}/${rec.id}: ${JSON.stringify(errors(p))}`);
  }
  const cs = capabilityStatement({ date: "2026-09-08T00:00:00Z", smart: { authorize: "https://h/a", token: "https://h/t" } });
  assert.ok(!("CapabilityStatement" in RESOURCES), "the validator has no CapabilityStatement definition, and says so rather than passing it");
  assert.equal(validateResource(cs).issues[0].code, "not-supported");
  for (const t of Object.values(FHIR_TYPE)) assert.ok(VALIDATED_TYPES.includes(t), `${t} has a definition`);
  assert.ok(VALIDATED_TYPES.includes("Provenance") && VALIDATED_TYPES.includes("Bundle") && VALIDATED_TYPES.includes("OperationOutcome") && VALIDATED_TYPES.includes("Parameters"));
});

test("TERMINOLOGY SERVICE: seed, then the hospital's lists, then its server; each answer says which; nothing is guessed", async () => {
  resetTxCache();
  // Seed: a LOINC code somebody here verified, and HL7's own code systems from the specification.
  const seed = await validateCode({ system: "http://loinc.org", code: "2160-0" }, {});
  assert.equal(seed.status, "verified"); assert.equal(seed.source, "seed"); assert.equal(seed.display, "Creatinine");
  assert.equal((await validateCode({ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }, {})).status, "verified");
  assert.equal((await validateCode({ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "ongoing" }, {})).status, "recognised", "a real HL7 system, a code that is not in it: recognised, not invalid, because only a server may say invalid");
  assert.ok(Object.keys(HL7).every((u) => systemUri(u) === u));
  assert.ok(coverage()["http://loinc.org"] >= 30 && coverage()["http://hl7.org/fhir/observation-status"] === 8);
  // A real system, an unverified code: recognised. An unknown system: unmapped. No code: unmapped.
  const sct = await validateCode({ system: "http://snomed.info/sct", code: "44054006" }, {});
  assert.equal(sct.status, "recognised"); assert.equal(sct.result, null);
  assert.equal((await validateCode({ system: "http://his.example/codes", code: "X" }, {})).status, "unmapped");
  assert.equal((await validateCode({ system: "loinc", code: "" }, {})).status, "unmapped");
  // The hospital's own list, under an alias or a URI, verifies with source "org".
  const config = { codeSystems: { snomed: { 44054006: "Type 2 diabetes mellitus" }, "http://loinc.org": { "4548-4": "HbA1c" } } };
  const org = await validateCode({ system: "http://snomed.info/sct", code: "44054006" }, { config });
  assert.equal(org.status, "verified"); assert.equal(org.source, "org"); assert.equal(org.display, "Type 2 diabetes mellitus");
  assert.equal((await validateCode({ system: "loinc", code: "4548-4" }, { config })).source, "org");

  // The server: verified with source "server", invalid when it says no, and recognised (never invalid) when unreachable.
  const log = [];
  const fetchImpl = txServer({ "http://snomed.info/sct|22298006": { result: true, display: "Myocardial infarction" }, "http://snomed.info/sct|999999": { result: false, message: "Unknown code" } }, log);
  const deps = { config: { server: { url: "https://tx.example/fhir", systems: ["snomed"] } }, fetchImpl };
  const ok = await validateCode({ system: "http://snomed.info/sct", code: "22298006" }, deps);
  assert.equal(ok.status, "verified"); assert.equal(ok.source, "server"); assert.equal(ok.display, "Myocardial infarction");
  assert.match(log[0], /^https:\/\/tx\.example\/fhir\/CodeSystem\/\$validate-code\?url=http%3A%2F%2Fsnomed\.info%2Fsct&code=22298006$/);
  const bad = await validateCode({ system: "http://snomed.info/sct", code: "999999" }, deps);
  assert.equal(bad.status, "invalid"); assert.equal(bad.result, false); assert.match(bad.note, /Unknown code/);
  const down = await validateCode({ system: "http://snomed.info/sct", code: "123" }, deps);
  assert.equal(down.status, "recognised", "an outage is not an answer"); assert.match(down.note, /answered 500/);
  assert.equal((await validateCode({ system: "http://www.whocc.no/atc", code: "A10BA02" }, deps)).status, "recognised", "a system the server is not configured for is not asked");
  assert.equal(log.length, 3, "and was not asked");
  // Answers are cached; outages are not.
  await validateCode({ system: "http://snomed.info/sct", code: "22298006" }, deps);
  await validateCode({ system: "http://snomed.info/sct", code: "123" }, deps);
  assert.equal(log.length, 4, "the verified answer came from cache, the outage was retried");
  const p = validateCodeParameters(bad);
  assert.equal(p.resourceType, "Parameters");
  assert.equal(p.parameter.find((x) => x.name === "result").valueBoolean, false);
  assert.equal(p.parameter.find((x) => x.name === "x-wardsynq-status").valueCode, "invalid");
  // A thrown fetch (SSRF refusal, DNS, timeout) is the same as an outage.
  const thrown = await validateCode({ system: "http://snomed.info/sct", code: "555" }, { ...deps, fetchImpl: async () => { throw new Error("blocked"); } });
  assert.equal(thrown.status, "recognised"); assert.match(thrown.note, /unreachable: blocked/);
});

test("INBOUND MARKING with the service: verified is promoted with its source, INVALID is kept verbatim and exported as such, never dropped", async () => {
  resetTxCache();
  const fetchImpl = txServer({ "http://snomed.info/sct|22298006": { result: true }, "http://snomed.info/sct|999999": { result: false, message: "Unknown code" } });
  const deps = { config: { server: { url: "https://tx.example/fhir" } }, fetchImpl };
  const good = await markTerminologyWithService({ resourceType: "Condition", id: "c", patientId: "p", code: "22298006", codeSystem: "http://snomed.info/sct", display: "MI" }, deps);
  assert.equal(good.terminologyStatus, "verified"); assert.equal(good.terminologySource, "server"); assert.equal(good.codeSystem, "http://snomed.info/sct");
  const bad = await markTerminologyWithService({ resourceType: "Condition", id: "c2", patientId: "p", code: "999999", codeSystem: "http://snomed.info/sct", display: "Nonsense" }, deps);
  assert.equal(bad.terminologyStatus, "invalid");
  assert.equal(bad.code, "999999", "the sender's code stays on the record");
  assert.equal(bad.codeSystem, "invalid", "and no system is vouched for");
  assert.deepEqual(bad.sourceCoding, { system: "http://snomed.info/sct", code: "999999", display: "Nonsense" });
  const f = toFhir({ ...bad, version: 1, meta: { recordedAt: "2026-09-08T10:00:00.000Z", source: { system: "his" } }, writtenBy: { id: "adapter:fhir-his", kind: "adapter", at: "2026-09-08T10:00:00.000Z" } });
  assert.equal(f.code.coding.length, 1);
  assert.equal(f.code.coding[0].system, "http://snomed.info/sct");
  assert.equal(f.code.coding[0].code, "999999");
  assert.equal(f.code.coding[0].extension[0].valueCode, "invalid", "the receiver sees exactly what the sender said, and that it is known to be wrong");
  assert.equal(validateResource(f).valid, true, "and the export is still conformant");
  // A LOINC seed code never consults the server; an unmapped system never does either.
  const seedOnly = await markTerminologyWithService({ resourceType: "Observation", id: "o", patientId: "p", code: "2160-0", codeSystem: "loinc", display: "Cr" }, { ...deps, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(seedOnly.terminologyStatus, "verified");
  const unmapped = await markTerminologyWithService({ resourceType: "Observation", id: "o", patientId: "p", code: "K", codeSystem: "http://his.example/x", display: "K" }, { ...deps, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(unmapped.terminologyStatus, "unmapped");
});

test("$validate consults the service: an invalid code is an error, an unverified one is information, a display mismatch is a warning", async () => {
  resetTxCache();
  const fetchImpl = txServer({ "http://snomed.info/sct|999999": { result: false, message: "Unknown code" } });
  const ctx = { terminology: { server: { url: "https://tx.example/fhir" } }, fetchImpl };
  const v = await validateFully({ resourceType: "Condition", subject: { reference: "Patient/1" }, code: { coding: [{ system: "http://snomed.info/sct", code: "999999" }, { system: "http://loinc.org", code: "2160-0", display: "Kreatinin" }, { system: "http://www.whocc.no/atc", code: "A10BA02" }] } }, {}, ctx);
  assert.equal(v.valid, false);
  assert.ok(v.issues.some((i) => i.severity === "error" && i.code === "code-invalid" && i.expression[0] === "Condition.code.coding[0]"));
  assert.ok(v.issues.some((i) => i.severity === "warning" && /differs from the verified display "Creatinine"/.test(i.diagnostics)));
  assert.ok(v.issues.some((i) => i.severity === "information" && i.expression[0] === "Condition.code.coding[2]"));
});

test("FHIR IDS: R4's 64 characters are honoured by hashing what does not fit, deterministically, with the canonical id kept as an identifier", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "FIPS 180-4 test vector");
  assert.equal(fhirId("wsq-adm-smd-ward01-00001-2026-09-07t08-00-00-000z"), "wsq-adm-smd-ward01-00001-2026-09-07t08-00-00-000z", "fits: verbatim");
  const long = "wsq-dr-wsq-sr-wsq-adm-smd-ward01-00001-2026-09-07t08-00-00-000z-renal-profile-2160-0";
  assert.ok(long.length > 64);
  assert.match(fhirId(long), /^wsq-[0-9a-f]{48}$/);
  assert.equal(fhirId(long), fhirId(long), "deterministic");
  assert.equal(fhirId(long), hashedId(long));
  assert.notEqual(fhirId(long), fhirId(long + "x"));
  assert.match(fhirId("has spaces"), /^wsq-[0-9a-f]{48}$/, "a character R4 forbids is hashed too");
  assert.ok(provenanceId("MedicationAdministration", long, 12).length <= 64);
  assert.equal(provenanceId("Observation", "o1", 1), "ob-o1-v1");
  const p = provenanceId("Encounter", "wsq-adm-smd-ward01-00001-2026-09-07t08-00-00-000z", 2);
  assert.equal(p.length, 55);
  assert.deepEqual(parseProvenanceId(p), { fhirType: "Encounter", fhirId: "wsq-adm-smd-ward01-00001-2026-09-07t08-00-00-000z", version: 2 });
  const sixty = "a".repeat(60);
  assert.equal(fhirId(sixty), sixty, "a 60-character id is a fine resource id");
  assert.match(provenanceId("Observation", sixty, 1), /^ob-wsq-[0-9a-f]{48}-v1$/, "but its Provenance id would not fit, so that one is hashed");
  const rec = { resourceType: "Observation", id: long, version: 1, patientId: "p1", code: "2160-0", codeSystem: "loinc", value: 1, meta: { recordedAt: "2026-09-08T10:00:00.000Z" }, writtenBy: { id: "x", kind: "human", at: "2026-09-08T10:00:00.000Z" } };
  const f = toFhir(rec);
  assert.equal(f.id, fhirId(long));
  assert.deepEqual(f.identifier, [{ system: "urn:stewardmd:record-id", value: long }]);
  assert.equal(validateResource(f).valid, true);
});

test("primitive formats are R4's, not JavaScript's", () => {
  assert.equal(PRIMITIVES.date("2026-02-30"), true, "R4's date regex does not know February; that is the spec's choice and this follows it");
  assert.equal(PRIMITIVES.date("2026-2-3"), false);
  assert.equal(PRIMITIVES.dateTime("2026-09-08T10:00:00"), false, "a time without a zone is not a dateTime");
  assert.equal(PRIMITIVES.dateTime("2026-09-08T10:00:00+05:30"), true);
  assert.equal(PRIMITIVES.instant("2026-09-08"), false, "an instant has a time");
  assert.equal(PRIMITIVES.id("a".repeat(65)), false);
  assert.equal(PRIMITIVES.id("wsq-pat-1.2"), true);
  assert.equal(PRIMITIVES.code(" x"), false);
  assert.equal(PRIMITIVES.code("x y"), true);
  assert.equal(PRIMITIVES.decimal("1"), false);
  assert.equal(PRIMITIVES.integer(1.5), false);
  assert.equal(PRIMITIVES.base64Binary("aGVsbG8="), true);
  assert.equal(PRIMITIVES.xhtml("<div xmlns=\"http://www.w3.org/1999/xhtml\">x</div>"), true);
  assert.equal(PRIMITIVES.xhtml("x"), false);
});
