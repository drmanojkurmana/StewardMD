/* test/wardsynq-fhir-inbound.test.mjs — another system's FHIR into this record, without guessing. Pure.
 *
 * node --test test/wardsynq-fhir-inbound.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REASON, RESOLUTION, INBOUND_TYPES, inboundEnabled, bodySourceOf, splitBundle, evaluateIfNoneExist, markTerminology,
  reconcileIdentity, rebind, partitionConflicts, ExchangeException, ExchangeIdentityDecision, priorDecision, EXCEPTION_TYPE, DECISION_TYPE,
  GRANT_TYPE, SourceSystemGrant, grantIdFor, authorizedSourceSystem,
} from "../functions/_wardsynq/fhir-inbound.js";
import { RESOURCE_TYPES, NATIVE_SYSTEM } from "../functions/_wardsynq/service.js";
import { normalizeFhir } from "../functions/_connect/connectors/fhir-r4/normalize.js";
import { validateBundle } from "../functions/_connect/canonical/validate.js";
import { mapSccmBundle } from "../wardsynq/adapters/wardsynq-sccm-adapter.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/fhir-inbound.js", import.meta.url), "utf8");

test("SCCM 1.1: administrations, service requests and consents travel through the SAME normaliser and adapter, honestly bounded", () => {
  const raw = {
    patient: { id: "P1", name: [{ text: "A" }] },
    resources: [
      { resourceType: "MedicationRequest", id: "RX1", status: "active", intent: "order", medicationCodeableConcept: { text: "Metformin" }, subject: { reference: "Patient/P1" } },
      { resourceType: "MedicationAdministration", id: "MA1", status: "completed", medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "6809", display: "Metformin" }] }, subject: { reference: "Patient/P1" }, effectiveDateTime: "2026-08-02T08:00:00Z", performer: [{ actor: { display: "Nurse Elsewhere" } }], request: { reference: "MedicationRequest/RX1" }, dosage: { text: "500 mg", dose: { value: 500, unit: "mg" }, route: { text: "oral" } } },
      { resourceType: "MedicationAdministration", id: "MA2", status: "in-progress", medicationCodeableConcept: { text: "Insulin" }, subject: { reference: "Patient/P1" }, effectiveDateTime: "2026-08-02T09:00:00Z" },
      { resourceType: "MedicationAdministration", id: "MA3", status: "not-done", medicationCodeableConcept: { text: "Aspirin" }, subject: { reference: "Patient/P1" }, effectiveDateTime: "2026-08-02T10:00:00Z", statusReason: [{ text: "Patient refused" }] },
      { resourceType: "ServiceRequest", id: "SR1", status: "active", intent: "order", code: { text: "Chest X-ray" }, category: [{ coding: [{ code: "363679005", display: "Imaging" }] }], priority: "asap", subject: { reference: "Patient/P1" }, authoredOn: "2026-08-01T09:00:00Z", requester: { display: "Dr Elsewhere" } },
      { resourceType: "DiagnosticReport", id: "DR1", status: "final", code: { text: "Chest X-ray report" }, subject: { reference: "Patient/P1" }, basedOn: [{ reference: "ServiceRequest/SR1" }], conclusion: "Clear." },
      { resourceType: "Consent", id: "C1", status: "active", scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "treatment" }] }, category: [{ text: "General consent" }], patient: { reference: "Patient/P1" }, dateTime: "2026-08-01T08:00:00Z", performer: [{ display: "The patient" }], provision: { type: "permit" } },
      { resourceType: "Consent", id: "C2", status: "rejected", scope: { coding: [{ code: "patient-privacy" }], text: "Sharing with the registry" }, category: [{ text: "Data sharing" }], patient: { reference: "Patient/P1" } },
      { resourceType: "Consent", id: "C3", status: "proposed", scope: { text: "research" }, category: [{ text: "Research" }], patient: { reference: "Patient/P1" } },
    ],
  };
  const sccm = normalizeFhir({ tenant: { id: "t" }, now: () => new Date("2026-09-08T00:00:00Z") }, raw);
  assert.equal(sccm.sccmVersion, "1.1");
  assert.equal(sccm.administrations.length, 3);
  assert.deepEqual(sccm.administrations[0].request, { type: "MedicationStatement", id: "RX1" });
  assert.equal(sccm.administrations[0].performer, "Nurse Elsewhere");
  assert.equal(sccm.serviceRequests.length, 1);
  assert.deepEqual(sccm.diagnosticReports[0].basedOn, { type: "ServiceRequest", id: "SR1" });
  assert.deepEqual(sccm.consents.map((c) => c.decision), ["permit", "deny", null], "permit, deny, and undecided is null - never guessed");
  assert.equal(validateBundle(sccm).ok, true, JSON.stringify(validateBundle(sccm).errors));

  sccm.meta.sourceConnector = "fhir-his";
  const m = mapSccmBundle(sccm);
  const by = (t) => m.entities.filter((e) => e.resourceType === t);
  const mars = by("MedicationAdministration");
  assert.equal(mars.length, 2, "completed and not-done are dose events; in-progress is not and is named");
  assert.ok(m.issues.some((i) => i.code === "SCCM_ADMIN_STATE" && /MA2/.test(i.message)));
  const given = mars.find((x) => x.id === "fhir-his-mar-ma1");
  assert.equal(given.status, "administered");
  assert.equal(given.orderId, "fhir-his-rx-rx1", "the source's OWN order, under its own id");
  assert.equal(given.administeredBy, "external:fhir-his:Nurse Elsewhere", "never a clinician here");
  assert.equal(given.drugCodeSystem, "http://www.nlm.nih.gov/research/umls/rxnorm");
  assert.deepEqual(given.dose, { value: 500, unit: "mg" });
  assert.equal(given.meta.source.system, "fhir-his");
  const refused = mars.find((x) => x.id === "fhir-his-mar-ma3");
  assert.equal(refused.status, "cancelled");
  assert.equal(refused.orderId, "external:fhir-his:unreferenced", "no order is invented to hang a dose on");
  assert.equal(refused.holdReason, "Patient refused");
  const sr = by("ServiceRequest")[0];
  assert.equal(sr.id, "fhir-his-sr-sr1");
  assert.equal(sr.status, "draft", "never active: nothing here collects or bills from another hospital's order");
  assert.equal(sr.requesterId, "external:fhir-his");
  assert.equal(sr.category, "imaging");
  assert.equal(sr.priority, "urgent", "asap has no home in the closed list and becomes urgent, not stat");
  assert.equal(sr.externalStatus, "active");
  assert.equal(by("DiagnosticReport")[0].serviceRequestId, "fhir-his-sr-sr1", "the report answers the source's order");
  assert.equal(by("PatientConsent").length, 0, "consent is a governance record: the adapter does not build it, fhir-inbound.js does");
});

test("TRANSACTION AND BATCH: the entry's request is carried, only POST and PUT are done, If-None-Exist is a search with three answers", () => {
  const b = { resourceType: "Bundle", type: "transaction", entry: [
    { resource: { resourceType: "Patient", id: "p1" }, request: { method: "POST", url: "Patient", ifNoneExist: "identifier=urn:his:mrn|M1" } },
    { resource: { resourceType: "Observation", id: "o1" }, request: { method: "PUT", url: "Observation/o1", ifMatch: 'W/"2"' } },
    { resource: { resourceType: "Observation", id: "o2" }, request: { method: "DELETE", url: "Observation/o2" } },
  ] };
  const s = splitBundle(b);
  assert.equal(s.bundleType, "transaction"); assert.equal(s.atomic, true);
  assert.deepEqual(s.requests.get("Patient/p1"), { method: "POST", ifNoneExist: "identifier=urn:his:mrn|M1", ifMatch: null, url: "Patient" });
  assert.equal(s.requests.get("Observation/o1").ifMatch, 'W/"2"');
  assert.ok(s.problems.some((p) => p.reason === REASON.INVALID && /DELETE is not supported/.test(p.detail)), "a delete is named, never done as the nearest thing");
  assert.equal(splitBundle({ ...b, type: "batch" }).atomic, false);
  assert.equal(splitBundle({ ...b, type: "collection" }).atomic, false, "a collection is processed entry by entry, as before");

  const rows = [
    { resourceType: "Observation", id: "a", meta: { versionId: "1", lastUpdated: "2026-08-02T00:00:00Z" }, code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, effectiveDateTime: "2026-08-02T06:00:00Z" },
    { resourceType: "Observation", id: "b", meta: { versionId: "1", lastUpdated: "2026-08-02T00:00:00Z" }, code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, effectiveDateTime: "2026-08-03T06:00:00Z" },
  ];
  assert.equal(evaluateIfNoneExist("Observation", "code=http://loinc.org|2160-0&date=2026-08-02", rows).outcome, "exists");
  assert.equal(evaluateIfNoneExist("Observation", "code=http://loinc.org|2160-0", rows).outcome, "ambiguous");
  assert.equal(evaluateIfNoneExist("Observation", "code=http://loinc.org|2345-7", rows).outcome, "create");
  assert.equal(evaluateIfNoneExist("Observation", "bogus=1", rows).outcome, "invalid", "an unknown parameter is not silently dropped from a precondition either");
});

test("OFF UNLESS THE HOSPITAL TURNS IT ON, and a feed must name itself", () => {
  assert.equal(inboundEnabled(null), false);
  assert.equal(inboundEnabled({ inbound: {} }), false);
  assert.equal(inboundEnabled({ inbound: { enabled: "true" } }), false, "only a real true");
  assert.equal(inboundEnabled({ inbound: { enabled: true } }), true);

  // bodySourceOf is BUNDLE-LEVEL ONLY (TASK 7 STEP 1): a single resource's own meta.source/
  // identifier describe THAT RESOURCE, not who is sending the request - reading them as a sender
  // claim would refuse a legitimate update-conflict PUT that echoes back our own "wardsynq-native"
  // resource. Only a Bundle's top-level fields are a self-declaration.
  assert.equal(bodySourceOf({ resourceType: "Bundle", meta: { source: "urn:stewardmd:source:ghis" } }), "ghis");
  assert.equal(bodySourceOf({ resourceType: "Bundle", identifier: { system: "http://partner.example/bundles" } }), "http-partner-example-bundles");
  assert.equal(bodySourceOf({ resourceType: "Bundle" }), "", "no name: refused upstream, never defaulted");
  assert.equal(bodySourceOf({ resourceType: "Observation", meta: { source: "urn:stewardmd:source:ghis" } }), "", "a single resource's own meta is NOT a sender claim");
});

test("SOURCE-SYSTEM AUTHORIZATION: header/body must agree, a claim is required, and only a GRANTED actor is trusted - never the caller's own say-so", async () => {
  const grants = [SourceSystemGrant({ id: grantIdFor("cfa:doc1", "epic"), actorId: "cfa:doc1", sourceSystem: "epic", active: true, grantedBy: "cfa:admin", grantedAt: "2026-01-01T00:00:00.000Z" })];
  const svc = { list: async () => grants };
  const doc1 = { actor: { id: "cfa:doc1" } };
  const doc2 = { actor: { id: "cfa:doc2" } };

  // 1. a granted actor claiming its own granted system succeeds.
  const ok = await authorizedSourceSystem(svc, doc1, "epic", "");
  assert.equal(ok.system, "epic");
  // 2. the SAME actor claiming a DIFFERENT (unregistered) system is refused, not silently allowed
  //    because it already holds SOME grant.
  const other = await authorizedSourceSystem(svc, doc1, "oracle-health", "");
  assert.equal(other.error.code, "source_unauthorized");
  // 3. a DIFFERENT actor - even authenticated, even in the same tenant - claiming a system it was
  //    never granted is refused. This is the exact vulnerability: an authenticated session with no
  //    grant of its own must never be trusted on its say-so.
  const impersonator = await authorizedSourceSystem(svc, doc2, "epic", "");
  assert.equal(impersonator.error.code, "source_unauthorized");
  assert.match(impersonator.error.detail, /cfa:doc2 is not registered to push data as "epic"/);
  // 4. header and body disagreeing is refused before any grant is even consulted.
  const mismatch = await authorizedSourceSystem(svc, doc1, "epic", "oracle-health");
  assert.equal(mismatch.error.code, "source_mismatch");
  // 5. no claim at all is refused.
  const none = await authorizedSourceSystem(svc, doc1, "", "");
  assert.equal(none.error.code, "source_required");
  // 6. claiming to be this hospital's own name is refused, even with an (impossible) grant for it.
  const native = await authorizedSourceSystem(svc, doc1, "wardsynq-native", "");
  assert.equal(native.error.code, "source_native");
});

test("A BUNDLE IS SPLIT, AND AN UNSUPPORTED TYPE IS A NAMED PROBLEM, never a silent omission", () => {
  const b = { resourceType: "Bundle", entry: [
    { resource: { resourceType: "Patient", id: "p1" } },
    { resource: { resourceType: "Observation", id: "o1" } },
    { resource: { resourceType: "Procedure", id: "x1" } },
    { resource: { resourceType: "Observation" } },
  ] };
  const s = splitBundle(b);
  assert.equal(s.patient.id, "p1");
  assert.deepEqual(s.resources.map((r) => r.id), ["o1"]);
  /* A sender that pushed a Procedure and received 200 believes it landed. */
  assert.ok(s.problems.some((p) => p.reason === REASON.UNSUPPORTED && /Procedure/.test(p.detail)));
  // An id-less resource cannot be attributed or replayed safely, and that is fatal.
  assert.ok(s.problems.some((p) => p.reason === REASON.INVALID && /has no id/.test(p.detail)));

  assert.equal(splitBundle({ resourceType: "Condition", id: "c1" }).resources.length, 1, "a single resource is accepted");
  assert.ok(splitBundle({}).problems.some((p) => p.reason === REASON.INVALID));
  const two = splitBundle({ resourceType: "Bundle", entry: [{ resource: { resourceType: "Patient", id: "a" } }, { resource: { resourceType: "Patient", id: "b" } }] });
  assert.ok(two.problems.some((p) => /more than one Patient/.test(p.detail)));
  assert.ok(!INBOUND_TYPES.includes("Procedure"));
});

test("TERMINOLOGY ON THE WAY IN: recognised systems normalise, unknown ones are kept verbatim and marked, nothing is translated", () => {
  const loinc = markTerminology({ resourceType: "Observation", code: "2160-0", codeSystem: "http://loinc.org", display: "Creatinine" });
  assert.equal(loinc.codeSystem, "http://loinc.org");
  assert.equal(loinc.terminologyStatus, "verified");
  assert.equal(loinc.sourceCoding, undefined);

  const snomed = markTerminology({ resourceType: "Condition", code: "44054006", codeSystem: "http://snomed.info/sct", display: "Type 2 diabetes" });
  assert.equal(snomed.terminologyStatus, "recognised", "a real system, a code nobody here verified");
  assert.equal(snomed.code, "44054006", "and the code is untouched");

  const local = markTerminology({ resourceType: "Observation", code: "K-PLUS", codeSystem: "http://his.example/codes", display: "Potassium" });
  assert.equal(local.codeSystem, "unmapped");
  assert.equal(local.terminologyStatus, "unmapped");
  assert.deepEqual(local.sourceCoding, { system: "http://his.example/codes", code: "K-PLUS", display: "Potassium" });
  assert.equal(local.code, "K-PLUS", "the sender's code stays the record's code");

  // A medication uses different field names and the same rule.
  const rx = markTerminology({ resourceType: "MedicationOrder", drug: "Metformin", drugCode: "6809", drugCodeSystem: "rxnorm" });
  assert.equal(rx.drugCodeSystem, "http://www.nlm.nih.gov/research/umls/rxnorm");
  // No system at all is left exactly as the adapter wrote it: there is nothing to mark.
  const bare = markTerminology({ resourceType: "Condition", code: "Pneumonia", codeSystem: "unspecified", display: "Pneumonia" });
  assert.equal(bare.codeSystem, "unspecified");
  assert.equal(bare.terminologyStatus, undefined);
  // A type with no code is untouched.
  assert.deepEqual(markTerminology({ resourceType: "Encounter", id: "e" }), { resourceType: "Encounter", id: "e" });
});

test("IDENTITY: one identifier match links, two is ambiguous, a look-alike is held, a stranger is new", () => {
  const locals = [
    { id: "L1", mrn: "MRN-100", name: "Ramesh Kumar", dob: "1980-04-12", sex: "male", identifiers: [{ system: "ABHA", value: "12-3456-7890-1234" }] },
    { id: "L2", mrn: "MRN-200", name: "Suresh Patel", dob: "1972-01-03", sex: "male", identifiers: [] },
    { id: "L3", mrn: "MRN-300", name: "Ramesh Kumar", dob: "1980-04-12", sex: "male", identifiers: [] },
  ];
  // Same MRN, supplied by the sender: link.
  assert.deepEqual(reconcileIdentity({ id: "X", mrn: "mrn-100", name: "R Kumar", dob: "1980-04-12", identifiers: [] }, locals, true), { decision: "link", localId: "L1", by: "identifier" });
  // Same ABHA under a different MRN: link, by the identifier.
  assert.equal(reconcileIdentity({ id: "X", mrn: "OTHER", name: "R", dob: "1980-04-12", identifiers: [{ system: "abha", value: "1234567890 1234" }] }, locals, true).localId, "L1");

  /* THE SOURCE-ID-AS-MRN GUARD. When the sender supplied no MRN, the adapter puts its own source id
   * in the mrn slot. A source id that happens to equal a local MRN must never link two strangers. */
  assert.equal(reconcileIdentity({ id: "X", mrn: "MRN-200", name: "Nobody Here", dob: "2001-01-01", identifiers: [] }, locals, false).decision, "new");

  // Two locals sharing an identifier is ambiguous, whatever the names say.
  const dup = [...locals, { id: "L4", mrn: "MRN-100", name: "Different Person", dob: "1999-09-09", identifiers: [] }];
  const amb = reconcileIdentity({ id: "X", mrn: "MRN-100", name: "R Kumar", dob: "1980-04-12", identifiers: [] }, dup, true);
  assert.equal(amb.decision, "ambiguous");
  assert.deepEqual(amb.candidates.map((c) => c.id), ["L1", "L4"]);

  // No identifier agreement but a strong resemblance: PROBABLE, held for a person. Never linked.
  const prob = reconcileIdentity({ id: "X", mrn: "", name: "Ramesh Kumar", dob: "1980-04-12", sex: "male", identifiers: [] }, locals, false);
  assert.equal(prob.decision, "probable");
  assert.ok(prob.candidates.length >= 1);
  assert.ok(prob.candidates.every((c) => ["L1", "L3"].includes(c.id)));

  // Nobody here resembles this person: new.
  assert.equal(reconcileIdentity({ id: "X", mrn: "", name: "Zubeida Noor", dob: "1955-06-30", sex: "female", identifiers: [] }, locals, false).decision, "new");
  // The unknown-dob sentinel is not evidence of anything.
  assert.equal(reconcileIdentity({ id: "X", mrn: "", name: "Unknown Male", dob: "0000-00-00", identifiers: [] }, [{ id: "T", mrn: "T", name: "Unknown Male", dob: "0000-00-00", identifiers: [] }], false).decision, "probable", "same name still warrants a look, but by name, not by the non-date");
});

test("REBIND points every row at the local chart and writes no Patient; local demographics are authoritative", () => {
  const out = rebind([
    { resourceType: "Patient", id: "fhir-x-pat-1", name: "Feed Name" },
    { resourceType: "Observation", id: "o", patientId: "fhir-x-pat-1" },
    { resourceType: "Encounter", id: "e", patientId: "fhir-x-pat-1" },
  ], "fhir-x-pat-1", "L1");
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.patientId === "L1"));
  assert.ok(!out.some((e) => e.resourceType === "Patient"));
});

test("OWNERSHIP: a feed updates its own rows, never this hospital's and never another feed's", () => {
  const cur = {
    "Observation/a": { id: "a", resourceType: "Observation", version: 2, meta: { source: { system: "fhir-his" } } },
    "Observation/b": { id: "b", resourceType: "Observation", version: 1, meta: { source: { system: NATIVE_SYSTEM } } },
    "Observation/c": { id: "c", resourceType: "Observation", version: 1, meta: { source: { system: "ghis" } } },
    "Observation/d": { id: "d", resourceType: "Observation", version: 3, meta: {} },
  };
  const { writable, conflicts } = partitionConflicts([
    { resourceType: "Observation", id: "a" }, { resourceType: "Observation", id: "b" },
    { resourceType: "Observation", id: "c" }, { resourceType: "Observation", id: "d" }, { resourceType: "Observation", id: "new" },
  ], (e) => cur[`${e.resourceType}/${e.id}`] || null, "fhir-his");
  assert.deepEqual(writable.map((w) => w.id), ["a", "new"]);
  assert.equal(writable[0]._currentVersion, 2, "its own row, version carried so the write is an update");
  assert.deepEqual(conflicts.map((c) => [c.entity.id, c.reason]), [
    ["b", REASON.CONFLICT_LOCAL_AUTHORITATIVE], ["c", REASON.CONFLICT_OTHER_SOURCE], ["d", REASON.CONFLICT_LOCAL_AUTHORITATIVE],
  ], "a row with no source is this hospital's");
  assert.equal(conflicts[0].current.version, 1);

  /* A feed re-sending ITS OWN id for a different patient is not an update: it is a clinical fact
   * moving from one person's chart to another's. Held, even though the feed owns the row. */
  const moved = partitionConflicts(
    [{ resourceType: "Observation", id: "a", patientId: "P-OTHER" }],
    () => ({ id: "a", resourceType: "Observation", version: 2, patientId: "P-ORIG", meta: { source: { system: "fhir-his" } } }), "fhir-his");
  assert.equal(moved.writable.length, 0);
  assert.equal(moved.conflicts[0].reason, REASON.PATIENT_MISMATCH);
  assert.equal(moved.conflicts[0].current.patientId, "P-ORIG");
});

test("A PERSON'S IDENTITY DECISION IS DURABLE: the latest one for a source patient wins, and a reject is not a link", () => {
  const decisions = [
    { source: "fhir-his", sourcePatientId: "HIS-1", decision: RESOLUTION.LINK, patientId: "L1", decidedAt: "2026-09-01T00:00:00.000Z" },
    { source: "fhir-his", sourcePatientId: "HIS-1", decision: RESOLUTION.LINK, patientId: "L9", decidedAt: "2026-09-05T00:00:00.000Z" },
    { source: "fhir-other", sourcePatientId: "HIS-1", decision: RESOLUTION.LINK, patientId: "L2", decidedAt: "2026-09-06T00:00:00.000Z" },
    { source: "fhir-his", sourcePatientId: "HIS-2", decision: RESOLUTION.REJECT, patientId: null, decidedAt: "2026-09-02T00:00:00.000Z" },
  ];
  assert.equal(priorDecision(decisions, "fhir-his", "HIS-1").patientId, "L9", "the most recent decision, for THIS source");
  assert.equal(priorDecision(decisions, "fhir-other", "HIS-1").patientId, "L2", "the same source id in another system is a different patient");
  assert.equal(priorDecision(decisions, "fhir-his", "HIS-2").decision, RESOLUTION.REJECT);
  assert.equal(priorDecision(decisions, "fhir-his", "HIS-3"), null);
  assert.equal(priorDecision(decisions, "", "HIS-1"), null);

  const d = ExchangeIdentityDecision({ id: "x", source: "fhir-his", sourcePatientId: "HIS-1", decision: RESOLUTION.CREATE, createdPatientId: "fhir-his-pat-his-1", decidedBy: "fb:dr", decidedAt: "2026-09-08T00:00:00.000Z", reason: "new to us" });
  assert.equal(d.resourceType, DECISION_TYPE);
  assert.equal(d.patientId, null, "create links to nobody existing; the created id is recorded separately");
  assert.equal(d.createdPatientId, "fhir-his-pat-his-1");
  assert.equal(d.decidedBy, "fb:dr");
  assert.ok(RESOURCE_TYPES.includes(DECISION_TYPE), "append-only: a wrong decision stays visible");
  assert.deepEqual(Object.values(RESOLUTION).sort(), ["accept-feed", "create", "keep-local", "link", "reject"]);
});

test("the exception is a record that keeps the payload, and the pipeline is the record's own", () => {
  const x = ExchangeException({ id: "x1", source: "fhir-his", reason: REASON.IDENTITY_AMBIGUOUS, raisedAt: "2026-09-08T00:00:00.000Z", payload: { resourceType: "Bundle" }, candidates: [{ id: "L1" }] });
  assert.equal(x.status, "open");
  assert.equal(x.resolvedBy, null);
  assert.deepEqual(x.payload, { resourceType: "Bundle" });
  assert.ok(RESOURCE_TYPES.includes(EXCEPTION_TYPE), "append-only, like everything in the store");

  /* No third model: the SAME normaliser Connect uses and the SAME adapter the ingest door uses,
   * writing through governedForIngest. Nothing here constructs a canonical entity by hand. */
  assert.ok(/normalizeFhir\(/.test(SRC));
  assert.ok(/sccmAdapter\(\)/.test(SRC));
  assert.ok(/governedForIngest\(/.test(SRC));
  assert.ok(!/\bPatient\(\{|\bObservation\(\{|\bCondition\(\{/.test(SRC), "no canonical constructor is called directly");
  // The adapter actor names the feed and the human it acted for - never the human as author.
  assert.ok(/kind: KIND\.ADAPTER, tier: TIER\.DRAFT/.test(SRC));
  assert.ok(/onBehalfOf: resolved\.actor\.id/.test(SRC));
  // Nothing merges.
  assert.ok(!/\bmerge\s*\(/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")));
});
