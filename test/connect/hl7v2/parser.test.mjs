// test/connect/hl7v2/parser.test.mjs — Task 2 (DUAL-ADVERSARIAL): hand-written HL7 v2 parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHl7, seg, segs, field, comp, decodeEsc } from "../../../functions/_connect/connectors/hl7v2/parser.js";

const ORU = ["MSH|^~\\&|LAB|HOSP|EHR|HOSP|20260801120000||ORU^R01|MSG00001|P|2.5",
  "PID|1||MRN123^^^HOSP^MR||Doe^Jane||19800101|F",
  "OBR|1||ORD9|CBC^Complete Blood Count^L|||20260801",
  "OBX|1|NM|718-7^Hemoglobin^LN||9.2|g/dL|13-17|L|||F",
  "OBX|2|ST|NOTE^Comment^L||looks fine|||||F"].join("\r");

test("discovers encoding + addresses MSH-9/10 correctly despite MSH-1 being a value", () => {
  const m = parseHl7(ORU);
  assert.equal(m.encoding.field, "|"); assert.equal(m.encoding.comp, "^");
  const msh = seg(m, "MSH");
  assert.equal(comp(msh, 9, 0, m.encoding), "ORU");           // MSH-9.1
  assert.equal(comp(msh, 9, 1, m.encoding), "R01");
  assert.equal(field(msh, 10), "MSG00001");                   // MSH-10 control id
  assert.equal(field(seg(m, "PID"), 3), "MRN123^^^HOSP^MR");
  assert.equal(segs(m, "OBX").length, 2);
  assert.equal(comp(segs(m, "OBX")[0], 3, 1, m.encoding), "Hemoglobin");
});

test("no MSH prefix -> warns, does not throw", () => {
  const m = parseHl7("PID|1||X");
  assert.ok(m.warnings.some((w) => w.includes("MSH")));
  assert.equal(Array.isArray(m.segments), true);
});

test("truncated mid-segment + malformed header -> warns, no throw", () => {
  assert.doesNotThrow(() => parseHl7("MSH|^~\\&|LAB\rOB"));
  const m = parseHl7("MSH|^~\\&|LAB\r\x01\x02\x03|junk");
  assert.ok(m.warnings.some((w) => w.includes("malformed segment")));
});

test("accessors return null for missing indices (never throw)", () => {
  const m = parseHl7(ORU);
  assert.equal(field(seg(m, "PID"), 99), null);
  assert.equal(comp(seg(m, "OBX"), 3, 9, m.encoding), null);
  assert.equal(field(seg(m, "ZZZ"), 1), null);                // missing segment
});

test("decodeEsc: separators, .br, hex, and unterminated pass-through", () => {
  const e = { field: "|", comp: "^", rep: "~", esc: "\\", sub: "&" };
  assert.equal(decodeEsc("a\\F\\b", e), "a|b");
  assert.equal(decodeEsc("a\\S\\b", e), "a^b");
  assert.equal(decodeEsc("line1\\.br\\line2", e), "line1\nline2");
  assert.equal(decodeEsc("\\X41\\", e), "A");
  assert.equal(decodeEsc("a\\unterminated", e), "a\\unterminated");
});

test("segment flood is bounded (no hang)", () => {
  const flood = "MSH|^~\\&|X\r" + Array.from({ length: 20000 }, () => "NTE|1|note").join("\r");
  const m = parseHl7(flood, { budget: { maxSegments: 500 } });
  assert.ok(m.segments.length <= 501);
  assert.ok(m.warnings.some((w) => w.includes("flood")));
});
