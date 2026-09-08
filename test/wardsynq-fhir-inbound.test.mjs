/* test/wardsynq-fhir-inbound.test.mjs — another system's FHIR into this record, without guessing. Pure.
 *
 * node --test test/wardsynq-fhir-inbound.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REASON, INBOUND_TYPES, inboundEnabled, sourceSystemOf, splitBundle, markTerminology,
  reconcileIdentity, rebind, partitionConflicts, ExchangeException, EXCEPTION_TYPE,
} from "../functions/_wardsynq/fhir-inbound.js";
import { RESOURCE_TYPES, NATIVE_SYSTEM } from "../functions/_wardsynq/service.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/fhir-inbound.js", import.meta.url), "utf8");

test("OFF UNLESS THE HOSPITAL TURNS IT ON, and a feed must name itself", () => {
  assert.equal(inboundEnabled(null), false);
  assert.equal(inboundEnabled({ inbound: {} }), false);
  assert.equal(inboundEnabled({ inbound: { enabled: "true" } }), false, "only a real true");
  assert.equal(inboundEnabled({ inbound: { enabled: true } }), true);

  assert.equal(sourceSystemOf("His Hospital HIS", {}), "his-hospital-his", "the header wins and is slugged");
  assert.equal(sourceSystemOf("", { meta: { source: "urn:stewardmd:source:ghis" } }), "ghis");
  assert.equal(sourceSystemOf("", { identifier: { system: "http://partner.example/bundles" } }), "http-partner-example-bundles");
  assert.equal(sourceSystemOf("", {}), "", "no name: refused upstream, never defaulted");
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
