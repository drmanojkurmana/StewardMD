/* test/wardsynq-fhir-provenance.test.mjs — Provenance, Consent, identifiers and terminology on the
 * way out. Pure.
 *
 * node --test test/wardsynq-fhir-provenance.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codeable, identifier, toFhir, fhirProvenance, fhirConsent, parseProvenanceId, capabilityStatement,
  EXT_TERMINOLOGY_STATUS, FHIR_TYPE, CANONICAL_TYPE,
} from "../functions/_wardsynq/fhir.js";
import { systemUri, isKnown, classifyCoding, unmappedCoding, coverage, IDENTIFIER_SYSTEMS, UNMAPPED } from "../functions/_wardsynq/terminology.js";
import { parseSearch, declaredSearch } from "../functions/_wardsynq/fhir-search.js";

test("TERMINOLOGY: a system is recognised by its published URI; a code is known only when a human verified it", () => {
  assert.equal(systemUri("loinc"), "http://loinc.org");
  assert.equal(systemUri("ICD-10"), "http://hl7.org/fhir/sid/icd-10");
  assert.equal(systemUri("http://snomed.info/sct"), "http://snomed.info/sct");
  assert.equal(systemUri("unspecified"), null);
  assert.equal(systemUri("hospital-local"), null, "a local name is not a vocabulary");
  assert.equal(systemUri(""), null);

  // Verified means "somebody put it in a seed with its display" - and nothing more.
  assert.equal(isKnown("loinc", "8867-4"), true, "heart rate, from the vitals table");
  assert.equal(isKnown("loinc", "2160-0"), true, "creatinine, from the laboratory seed");
  assert.equal(isKnown("loinc", "99999-9"), false, "a plausible-looking LOINC code nobody verified");
  assert.equal(isKnown("snomed", "22298006"), false, "SNOMED is recognised as a system; no code in it is verified");
  assert.ok(coverage()["http://loinc.org"] >= 30);

  assert.equal(classifyCoding("loinc", "8867-4").status, "verified");
  assert.equal(classifyCoding("snomed", "22298006").status, "recognised");
  assert.equal(classifyCoding("hospital-local", "K").status, UNMAPPED);
});

test("UNMAPPED IS A STATE, NOT AN ABSENCE: the sender's coding is kept verbatim and marked", () => {
  const u = unmappedCoding("http://his.example/codes", "K-PLUS", "Potassium (HIS)");
  assert.equal(u.codeSystem, UNMAPPED);
  assert.equal(u.terminologyStatus, UNMAPPED);
  assert.deepEqual(u.sourceCoding, { system: "http://his.example/codes", code: "K-PLUS", display: "Potassium (HIS)" });
  assert.equal(u.code, "K-PLUS", "the record's own code is the sender's, so a search by it still works");

  /* On export it goes out under the SENDER'S system, so the receiver sees exactly what was said,
   * with our extension so they can also see we did not vouch for it. */
  const cc = codeable(u.code, u.codeSystem, u.display, u.sourceCoding);
  assert.equal(cc.coding.length, 1);
  assert.equal(cc.coding[0].system, "http://his.example/codes");
  assert.equal(cc.coding[0].code, "K-PLUS");
  assert.deepEqual(cc.coding[0].extension, [{ url: EXT_TERMINOLOGY_STATUS, valueCode: "unmapped" }]);
  assert.equal(cc.text, "Potassium (HIS)");

  // A source system that is not a URI cannot be a FHIR coding at all, and stays in the text.
  const local = codeable("K", UNMAPPED, "Potassium", { system: "LABSYS", code: "K", display: "Potassium" });
  assert.equal(local.coding, undefined);
  assert.equal(local.text, "Potassium");

  // A verified coding AND a preserved source coding travel together, ours first, theirs marked.
  const both = codeable("2160-0", "loinc", "Creatinine", { system: "http://his.example/codes", code: "CREA" });
  assert.equal(both.coding[0].system, "http://loinc.org");
  assert.equal(both.coding[0].extension, undefined, "ours is not marked unmapped");
  assert.equal(both.coding[1].system, "http://his.example/codes");
  assert.equal(both.coding[1].extension[0].valueCode, "unmapped");
});

test("IDENTIFIERS carry a system a receiver can match on, and a type they can filter by", () => {
  const mrn = identifier("mrn", "MRN-001", { use: "usual" });
  assert.equal(mrn.system, IDENTIFIER_SYSTEMS.mrn.uri);
  assert.equal(mrn.type.coding[0].code, "MR");
  assert.equal(mrn.use, "usual");
  const abha = identifier("ABHA", "12-3456-7890-1234");
  assert.equal(abha.system, "https://healthid.ndhm.gov.in");
  assert.equal(abha.type.coding[0].code, "NI");
  // An unknown system that is already a URI is passed through; one that is not becomes a typed value.
  assert.equal(identifier("http://other.example/id", "x").system, "http://other.example/id");
  assert.deepEqual(identifier("hospital-card", "x"), { type: { text: "hospital-card" }, value: "x" });
  assert.equal(identifier("mrn", ""), undefined);

  const p = toFhir({ resourceType: "Patient", id: "p1", version: 1, mrn: "MRN-001", name: "T", dob: "1980-01-01", identifiers: [{ system: "ABHA", value: "1" }], meta: {}, writtenBy: { at: "2026-09-08T00:00:00.000Z" } });
  assert.equal(p.identifier.length, 3, "MRN, ABHA, and the canonical record id");
  assert.equal(p.identifier[0].type.coding[0].code, "MR");
  assert.equal(p.identifier[1].type.coding[0].code, "NI");
  assert.deepEqual(p.identifier[2], { system: "urn:stewardmd:record-id", value: "p1" });
});

test("PROVENANCE is derived from the stamp on every version and never makes an AI look like its clinician", () => {
  const human = { resourceType: "Observation", id: "o1", version: 1, patientId: "p", meta: { recordedAt: "2026-09-08T10:00:00.000Z", source: { system: "wardsynq-native" } }, writtenBy: { id: "fb:dr-a", kind: "human", tier: "execute", at: "2026-09-08T10:00:00.500Z" } };
  const pr = fhirProvenance(human);
  assert.equal(pr.resourceType, "Provenance");
  assert.equal(pr.id, "ob-o1-v1", "a type code, so a Provenance id fits R4's 64 characters on top of any resource id");
  assert.deepEqual(pr.target, [{ reference: "Observation/o1/_history/1" }], "a VERSIONED reference: provenance is per version");
  assert.equal(pr.recorded, "2026-09-08T10:00:00.500Z");
  assert.equal(pr.activity.coding[0].code, "CREATE");
  assert.equal(pr.agent[0].type.coding[0].code, "author");
  assert.equal(pr.agent[0].who.display, "fb:dr-a");
  assert.equal(pr.agent[0].onBehalfOf, undefined);
  assert.equal(pr.entity, undefined, "a native record has no source entity");

  const ai = { ...human, version: 2, writtenBy: { id: "ai:maik", kind: "ai", tier: "draft", at: "2026-09-08T11:00:00.000Z", onBehalfOf: "fb:dr-a" } };
  const pa = fhirProvenance(ai);
  assert.equal(pa.activity.coding[0].code, "UPDATE");
  assert.equal(pa.agent[0].type.coding[0].code, "assembler", "an AI ASSEMBLED it; it did not author it");
  assert.equal(pa.agent[0].who.display, "ai:maik");
  assert.deepEqual(pa.agent[0].onBehalfOf, { display: "fb:dr-a" }, "the human is the party acted for, never the author");

  const imported = { ...human, meta: { recordedAt: "2026-09-08T10:00:00.000Z", source: { system: "ghis", sourceId: "lab-77" } }, writtenBy: { id: "adapter:ghis", kind: "adapter", at: "2026-09-08T10:00:00.000Z" } };
  const pi = fhirProvenance(imported);
  assert.equal(pi.agent[0].type.coding[0].code, "assembler");
  assert.equal(pi.entity[0].role, "source");
  assert.equal(pi.entity[0].what.identifier.system, "urn:stewardmd:source:ghis");
  assert.equal(pi.entity[0].what.identifier.value, "lab-77");

  // The id round-trips, and one for a type we do not export is nothing.
  assert.deepEqual(parseProvenanceId("ob-o1-v1"), { fhirType: "Observation", fhirId: "o1", version: 1 });
  assert.deepEqual(parseProvenanceId("mr-wsq-rx-1-v3"), { fhirType: "MedicationRequest", fhirId: "wsq-rx-1", version: 3 });
  assert.equal(parseProvenanceId("zz-x-v1"), null);
  assert.equal(parseProvenanceId("Observation-o1-v1"), null, "the old long form is gone: it could not fit in 64 characters");
  assert.equal(fhirProvenance({ resourceType: "Claim", id: "c" }), null);
});

test("CONSENT: a refusal is rejected with a deny provision, never an active consent whose fine print says no", () => {
  const base = { resourceType: "PatientConsent", id: "c1", version: 1, patientId: "p", scope: "share-external", givenBy: "patient", giverName: "T", recordedAt: "2026-09-08T09:00:00.000Z", validFrom: "2026-09-08", meta: {}, writtenBy: { at: "2026-09-08T09:00:00.000Z" } };
  const granted = fhirConsent({ ...base, decision: "granted" });
  assert.equal(granted.resourceType, "Consent");
  assert.equal(granted.status, "active");
  assert.equal(granted.provision.type, "permit");
  assert.equal(granted.scope.coding[0].code, "patient-privacy", "share-external is a privacy scope in FHIR's vocabulary");
  assert.deepEqual(granted.category, [{ text: "share-external" }], "our own scope word goes out as text, not dressed as a standard category");
  assert.equal(granted.provision.period.start, "2026-09-08");

  const refused = fhirConsent({ ...base, decision: "refused" });
  assert.equal(refused.status, "rejected");
  assert.equal(refused.provision.type, "deny");
  const withdrawn = fhirConsent({ ...base, decision: "withdrawn" });
  assert.equal(withdrawn.status, "inactive");

  assert.equal(fhirConsent({ ...base, decision: "granted", scope: "research" }).scope.coding[0].code, "research");
  assert.equal(fhirConsent({ ...base, decision: "granted", scope: "treatment" }).scope.coding[0].code, "treatment");
  // Capacity is a recorded judgement or an honest absence; it is never asserted from a signature.
  assert.equal(fhirConsent({ ...base, decision: "granted" }).extension, undefined);
  assert.equal(fhirConsent({ ...base, decision: "granted", capacity: false }).extension[0].valueBoolean, false);

  // Consent is a first-class export type with meta, and the reverse map knows it.
  assert.equal(FHIR_TYPE.PatientConsent, "Consent");
  assert.equal(CANONICAL_TYPE.Consent, "PatientConsent");
  assert.equal(toFhir({ ...base, decision: "granted" }).meta.versionId, "1");
});

test("the CapabilityStatement declares Provenance and Consent exactly as implemented, and states the vocabulary coverage", () => {
  const cs = capabilityStatement({ date: "2026-09-08" });
  const prov = cs.rest[0].resource.find((r) => r.type === "Provenance");
  assert.deepEqual(prov.interaction.map((i) => i.code), ["read", "search-type"], "no history of its own: it IS the history");
  assert.ok(prov.searchParam.some((p) => p.name === "target"));
  const consent = cs.rest[0].resource.find((r) => r.type === "Consent");
  assert.ok(consent, "Consent is advertised");
  assert.ok(consent.searchParam.some((p) => p.name === "date"));
  assert.ok(cs.rest[0].resource.find((r) => r.type === "Observation").searchRevInclude.includes("Provenance:target"));
  assert.match(cs.implementation.description, /Verified codes carried by this build: \d+ in http:\/\/loinc\.org/);
  assert.match(cs.implementation.description, /terminology-status/);

  // The parser agrees with the declaration.
  assert.equal(parseSearch("Provenance", "target=Encounter/e1").problems.length, 0);
  assert.deepEqual(parseSearch("Provenance", "target=Encounter/e1").query.target, { type: "Encounter", id: "e1" });
  assert.equal(parseSearch("Provenance", "target=nonsense").problems[0].reason, "target must be Type/id");
  assert.match(parseSearch("Observation", "target=Encounter/e1").problems[0].reason, /not a search parameter/);
  assert.deepEqual(parseSearch("Observation", "_revinclude=Provenance:target").query.revInclude.map((r) => r.key), ["Provenance:target"]);
  assert.equal(parseSearch("Provenance", "_revinclude=Provenance:target").problems.length, 1, "not on itself");
  assert.ok(declaredSearch("Consent").params.some((p) => p.name === "patient"));
});
