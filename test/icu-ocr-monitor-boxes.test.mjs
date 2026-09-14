/* test/icu-ocr-monitor-boxes.test.mjs — the on-device monitor parser against REAL Apple Vision
 * output. Fixtures are the raw VNRecognizeTextRequest observations (text, confidence, normalized
 * top-left box) for the owner's Philips IntelliVue MP40 photo (2026-09-14), captured on macOS
 * Vision at the 900px size the app used to feed it, and at 2x / 3x. Ground truth read off the
 * screen: HR 105, SpO2 100, Pulse 105, ART 149/66 (98), RR 22, PVC 0.
 *
 * parseFieldsOnDevice lives inside reasoning.js's IIFE; it is self-contained (no DOM, no window
 * reads), so the two functions are sliced out of the source and evaluated here. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const start = SRC.indexOf("  function parseMonitorBoxes(boxes) {");
const end = SRC.indexOf("  window.SMD_parseFields = parseFieldsOnDevice;");
assert.ok(start > 0 && end > start, "parser functions must be locatable in reasoning.js");
const parse = new Function(SRC.slice(start, end) + "\n return parseFieldsOnDevice;")();

function fixture(name) {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  return { boxes: j.obs, text: j.obs.map((o) => o.text).join("\n") };
}
const AT_900 = fixture("mp40-vision-900px");
const AT_900_CORRECTED = fixture("mp40-vision-900px-corrected");
const AT_1800 = fixture("mp40-vision-1800px");
const AT_2700 = fixture("mp40-vision-2700px");

test("ACCEPTANCE (900px, the size the app used to OCR at): HR, SpO2, ART, RR from boxes", () => {
  const f = parse(AT_900.text, "monitor", AT_900.boxes);
  assert.equal(f.hr, 105, "HR: the tall '*105', not the small '1ZO' alarm limit");
  assert.equal(f.spo2, 100, "SpO2 from '2° 100' under the 'Sp0z' label");
  assert.equal(f.sbp, 149); assert.equal(f.dbp, 66);
  assert.equal(f.rr, 22, "RR: the unclaimed value-size integer below the pressure");
  // "(98)" was NOT recognized at 900px in any configuration — it must stay absent, never be
  // computed from SBP/DBP (that would be 94, a fabricated number on a clinical screen).
  assert.equal(f.map, undefined, "MAP must not be invented when Vision did not read it");
});

test("ACCEPTANCE (1800px): MAP 98 appears once Vision can read '(98)', and nothing regresses", () => {
  // At this scale Vision emitted NO SpO2 label box (only the value); SpO2 comes from the column
  // rule (between the HR value and the pressure, sole value-size integer in 50-100).
  assert.equal(AT_1800.boxes.some((b) => /sp\s*[o0]/i.test(b.text)), false, "fixture has no SpO2 label");
  const f = parse(AT_1800.text, "monitor", AT_1800.boxes);
  assert.deepEqual({ hr: f.hr, spo2: f.spo2, sbp: f.sbp, dbp: f.dbp, map: f.map, rr: f.rr },
    { hr: 105, spo2: 100, sbp: 149, dbp: 66, map: 98, rr: 22 });
});

test("2700px: the same five, with '22' at confidence 1.0 (SpO2 label also absent here)", () => {
  assert.equal(AT_2700.boxes.some((b) => /sp\s*[o0]/i.test(b.text)), false, "fixture has no SpO2 label");
  const f = parse(AT_2700.text, "monitor", AT_2700.boxes);
  assert.equal(f.hr, 105); assert.equal(f.spo2, 100); assert.equal(f.sbp, 149); assert.equal(f.dbp, 66); assert.equal(f.rr, 22);
});

test("REGRESSION (documented): the shipped text-only path reads the alarm limit as HR and the clock as RR", () => {
  const f = parse(AT_1800.text, "monitor");
  assert.equal(f.hr, 120, "first in-range number after 'HR' in reading order is the upper alarm limit");
  assert.equal(f.rr, 20, "'** RR' banner followed by the clock '20: 38'");
});

test("column rule refuses to pick when two candidates exist", () => {
  const boxes = [
    { text: "HR",     x: 0.568, y: 0.452, w: 0.021, h: 0.0087 },
    { text: "105",    x: 0.581, y: 0.464, w: 0.129, h: 0.0363 },
    { text: "100",    x: 0.581, y: 0.510, w: 0.129, h: 0.0351 },
    { text: "98",     x: 0.581, y: 0.530, w: 0.129, h: 0.0351 },   // a second value-size integer in range
    { text: "149/66", x: 0.603, y: 0.546, w: 0.152, h: 0.0484 }
  ];
  const f = parse(boxes.map((b) => b.text).join("\n"), "monitor", boxes);
  assert.equal(f.hr, 105); assert.equal(f.sbp, 149);
  assert.equal(f.spo2, undefined, "ambiguous column: leave SpO2 for the clinician rather than guess");
});

test("the shipped plugin settings (language correction ON) also parse once boxes are used", () => {
  const f = parse(AT_900_CORRECTED.text, "monitor", AT_900_CORRECTED.boxes);
  assert.equal(f.hr, 105); assert.equal(f.spo2, 100); assert.equal(f.sbp, 149); assert.equal(f.dbp, 66); assert.equal(f.rr, 22);
});

test("REGRESSION: the text-only path (no boxes) is what the app shipped with, and it mis-assigns", () => {
  // Documented failure mode, not a target: flattened reading order takes the first in-range number
  // after "HR", which on this screen is the "*105" only because the limit read as "1ZO". The point of
  // the boxes path is that it does not depend on that luck. Whatever this returns, it must not throw
  // and must not set MAP.
  const f = parse(AT_900.text, "monitor");
  assert.equal(typeof f, "object");
  assert.equal(f.map, undefined);
});

test("no PVC/ST leakage into vitals keys, and Pulse stays unset when its label was never read", () => {
  const f = parse(AT_900.text, "monitor", AT_900.boxes);
  assert.equal(f.pulse, undefined, "'105' at right is Pulse, but the label was not recognized; do not guess");
  assert.equal(f.temp, undefined); assert.equal(f.cvp, undefined); assert.equal(f.etco2, undefined);
});

test("'all' (the ICU Monitor step) routes boxes into the vitals section", () => {
  const s = parse(AT_1800.text, "all", AT_1800.boxes);
  assert.ok(s.vitals, "vitals section present");
  assert.equal(s.vitals.hr, 105); assert.equal(s.vitals.map, 98); assert.equal(s.vitals.rr, 22);
});

test("alarm limits lose to the value even when the limit is a clean number", () => {
  // Synthetic: same geometry as the MP40 HR block, but the limits read correctly as "120" / "50".
  const boxes = [
    { text: "HR",  x: 0.568, y: 0.452, w: 0.021, h: 0.0087 },
    { text: "120", x: 0.574, y: 0.462, w: 0.034, h: 0.0116 },
    { text: "50",  x: 0.574, y: 0.474, w: 0.024, h: 0.0116 },
    { text: "105", x: 0.581, y: 0.464, w: 0.129, h: 0.0363 }
  ];
  const f = parse(boxes.map((b) => b.text).join("\n"), "monitor", boxes);
  assert.equal(f.hr, 105);
});
