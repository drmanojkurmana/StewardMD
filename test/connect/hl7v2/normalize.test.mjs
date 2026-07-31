// test/connect/hl7v2/normalize.test.mjs — Task 3: HL7 v2 (ORU/ADT/MDM) -> SCCM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHl7 } from "../../../functions/_connect/connectors/hl7v2/parser.js";
import { normalizeHl7 } from "../../../functions/_connect/connectors/hl7v2/normalize.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { buildMaikContext } from "../../../functions/_connect/maik-context.js";

const ctx = { tenant: { id: "t1" }, now: () => new Date(0) };
const norm = (s) => normalizeHl7(ctx, parseHl7(s));

test("ORU -> valid SCCM with typed OBX values and resolving report refs", () => {
  const b = norm(["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M1|P|2.5", "PID|1||MRN1^^^H^MR||Doe^Jane||19800101|F",
    "OBR|1||ORD9|CBC^Complete Blood Count^L|||20260801", "OBX|1|NM|718-7^Hemoglobin^LN||9.2|g/dL|13-17|L|||F", "OBX|2|ST|NOTE^Comment^L||looks fine|||||F"].join("\r"));
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.patient.gender, "female");
  assert.equal(b.observations[0].value.value, 9.2);
  assert.equal(b.observations[0].value.unit, "g/dL");
  assert.equal(b.observations[1].value.text, "looks fine");
  assert.equal(b.diagnosticReports[0].results.length, 2);
  assert.equal(b.diagnosticReports[0].results[0].id, b.observations[0].id);   // ref resolves in-bundle
  assert.ok(buildMaikContext(b).labs.some((l) => l.label === "Hemoglobin"));
});

test("ADT -> Encounter (class/period/status)", () => {
  const b = norm(["MSH|^~\\&|ADT|H|E|H|20260801||ADT^A01|M2|P|2.5", "PID|1||MRN9^^^H^MR||Smith^John||19700101|M",
    "PV1|1|I|WARD^101^A|||||||||||||||||||||||||||||||||||||||||20260801080000"].join("\r"));
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.encounters.length, 1);
  assert.equal(b.encounters[0].class, "I");
  assert.equal(b.patient.gender, "male");
});

test("MDM -> narrative DocumentReference (no binary)", () => {
  const b = norm(["MSH|^~\\&|MDM|H|E|H|20260801||MDM^T02|M3|P|2.5", "PID|1||M1||A^B", "TXA|1|DS^Discharge Summary^L||||||||||DOCID||||AU",
    "OBX|1|TX|||Discharge narrative line 1", "OBX|2|TX|||line 2"].join("\r"));
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.documents.length, 1);
  assert.match(b.documents[0].text, /line 1\nline 2/);
});

test("a Z-segment-only / unsupported message -> warnings, no crash, still a patient bundle", () => {
  const b = norm(["MSH|^~\\&|X|H|E|H|20260801||ZZZ^Z01|M4|P|2.5", "PID|1||M1||A^B", "ZID|1|custom"].join("\r"));
  assert.equal(validateBundle(b).ok, true);
  assert.ok(b.meta.warnings.some((w) => w.includes("unsupported message type")));
});

test("OBX correction (status C) adds a warning (no silent merge)", () => {
  const b = norm(["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M5|P|2.5", "PID|1||M1||A^B", "OBR|1||O1|G^Glucose^L", "OBX|1|NM|G^Glucose^L||110|mg/dL|70-99|H|||C"].join("\r"));
  assert.ok(b.meta.warnings.some((w) => w.includes("correction")));
});
