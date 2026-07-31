// test/connect/abdm/serialize-ndhm.test.mjs — Stage-5 Task-2: SCCM record -> NDHM-FHIR document Bundle.
// The MIRROR/INVERSE of normalize-ndhm.test.mjs: Composition-first, globally-unique identifier, author+custodian,
// every CodeableConcept carries a text fallback, ZERO binary — and the output must round-trip back through
// normalizeNdhm to the SAME SCCM resource counts (the inverse-correctness proof). Never throws on a partial record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import { dischargeRecord, localOnlyRecord } from "./fixtures/sccm-records.mjs";

const ser = (r) => serializeNdhm(makeCtx(), r);

// Walk the whole bundle: every object that is a CodeableConcept (has a coding[] array) must carry a non-empty text.
function everyCodeableHasText(node) {
  if (Array.isArray(node)) return node.every(everyCodeableHasText);
  if (!node || typeof node !== "object") return true;
  if (Array.isArray(node.coding) && (typeof node.text !== "string" || !node.text.trim())) return false;
  return Object.keys(node).every((k) => everyCodeableHasText(node[k]));
}

test("discharge record -> Bundle.type=document, Composition FIRST with author+custodian+subject + fresh urn:uuid identifier", () => {
  const doc = ser(dischargeRecord);
  assert.equal(doc.type, "document");
  assert.equal(doc.identifier.system, "urn:ietf:rfc:3986");
  assert.match(doc.identifier.value, /^urn:uuid:[0-9a-f-]{36}$/);
  const first = doc.entry[0].resource;
  assert.equal(first.resourceType, "Composition");
  assert.ok(first.subject && first.subject.reference === "Patient/pat-1");
  assert.ok(Array.isArray(first.author) && first.author.length >= 1);
  assert.ok(first.custodian && first.custodian.reference);
  // Composition.type is the record profile; author Device + custodian Organization are StewardMD-tagged.
  assert.match(first.meta.profile[0], /DischargeSummaryRecord$/);
  const author = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Device");
  const custodian = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Organization");
  assert.equal(author.id, first.author[0].reference.split("/")[1]);
  assert.equal(custodian.id, first.custodian.reference.split("/")[1]);
});

test("every CodeableConcept carries a non-empty text fallback (inverse of cc(), R12)", () => {
  assert.equal(everyCodeableHasText(ser(dischargeRecord)), true);
  assert.equal(everyCodeableHasText(ser(localOnlyRecord)), true);
});

test("provenance source:StewardMD tagged on every emitted resource", () => {
  const doc = ser(dischargeRecord);
  assert.equal(doc.meta.source, "https://stewardmd.in");
  for (const e of doc.entry) {
    assert.equal(e.resource.meta.source, "https://stewardmd.in", e.resource.resourceType + " missing StewardMD source");
    assert.ok((e.resource.meta.tag || []).some((t) => t.code === "StewardMD"), e.resource.resourceType + " missing StewardMD tag");
  }
});

test("ZERO binary: no attachment bytes / Binary resource / data: URI anywhere in the bundle", () => {
  const doc = ser(dischargeRecord);
  const json = JSON.stringify(doc);
  assert.equal(/"resourceType"\s*:\s*"Binary"/.test(json), false);
  assert.equal(/"data"\s*:\s*"[^"]+"/.test(json), false);      // no inline attachment/Binary bytes
  assert.equal(/data:[^"]*base64/i.test(json), false);          // no data: URI bytes
});

test("validateNdhmDoc -> ok:true for a well-formed serialized document", () => {
  const v = validateNdhmDoc(ser(dischargeRecord));
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.deepEqual(v.errors, []);
});

test("ROUND-TRIP: serializeNdhm -> normalizeNdhm yields matching SCCM resource counts (inverse-correctness)", () => {
  const back = normalizeNdhm(makeCtx(), ser(dischargeRecord));
  assert.equal(back.conditions.length, dischargeRecord.conditions.length);
  assert.equal(back.medications.length, dischargeRecord.medications.length);
  assert.equal(back.allergies.length, dischargeRecord.allergies.length);
  assert.equal(back.observations.length, dischargeRecord.observations.length);
  assert.equal(back.diagnosticReports.length, dischargeRecord.diagnosticReports.length);
  assert.equal(back.documents.length, dischargeRecord.documents.length);
  // medication origin (order|statement) survives the round-trip too.
  assert.deepEqual(back.medications.map((m) => m.origin).sort(), ["order", "statement"]);
});

test("a StewardMD-local code stays local + preserves its text (local coding not upgraded to standard)", () => {
  const doc = ser(localOnlyRecord);
  const cond = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Condition");
  assert.equal(cond.code.coding[0].system, "urn:hospital:dx");
  assert.equal(cond.code.coding[0].code, "LX1");
  assert.equal(cond.code.text, "Local hospital diagnosis label");
  // and it re-derives to kind:"local" on the inverse.
  const back = normalizeNdhm(makeCtx(), doc);
  assert.equal(back.conditions[0].code.coding[0].kind, "local");
  assert.equal(back.conditions[0].code.text, "Local hospital diagnosis label");
});

test("two serializations of the SAME record produce two DIFFERENT Bundle.identifiers (global uniqueness)", () => {
  const a = ser(dischargeRecord), b = ser(dischargeRecord);
  assert.notEqual(a.identifier.value, b.identifier.value);
  assert.match(a.identifier.value, /^urn:uuid:/);
  assert.match(b.identifier.value, /^urn:uuid:/);
});

test("empty / missing record -> validateNdhmDoc reports errors, serializeNdhm never throws", () => {
  let d1, d2;
  assert.doesNotThrow(() => { d1 = serializeNdhm(makeCtx(), null); });
  assert.doesNotThrow(() => { d2 = serializeNdhm(makeCtx(), {}); });
  // no patient -> Composition has no subject -> structural error (not a throw).
  assert.equal(validateNdhmDoc(d1).ok, false);
  assert.match(validateNdhmDoc(d1).errors.join(" | "), /subject/i);
  assert.equal(validateNdhmDoc(d2).ok, false);
  // and a garbage bundle is rejected without throwing.
  assert.equal(validateNdhmDoc(null).ok, false);
  assert.equal(validateNdhmDoc({ type: "collection", entry: [] }).ok, false);
});

test("validateNdhmDoc catches a smuggled Binary / attachment bytes (structural gate)", () => {
  const doc = ser(dischargeRecord);
  doc.entry.push({ resource: { resourceType: "Binary", id: "b1", contentType: "application/pdf", data: "QUJD", meta: {} } });
  const v = validateNdhmDoc(doc);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" | "), /Binary|bytes/i);
});
