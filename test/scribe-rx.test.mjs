import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import { buildRxLines } from "../rx-build.mjs";
const RX = require("../scribe-rx.js");

/* The app injects window.SMD_RX._parseVoiceRx. prescription.js is a browser IIFE that
 * cannot be required from node, so the parser is mirrored here VERBATIM from
 * prescription.js:2422 (parseVoiceRx) minus its window.MEDDRUGS lookup — scribe-rx does
 * the generic resolution itself from the injected list. */
const RX_FREQ = { od: "OD", "once daily": "OD", "once a day": "OD", bd: "BD", "twice daily": "BD", "twice a day": "BD", "two times": "BD", tds: "TDS", tid: "TDS", thrice: "TDS", "three times": "TDS", qid: "QID", "four times": "QID", hs: "HS", "at night": "HS", "bed time": "HS", bedtime: "HS", sos: "SOS", "as needed": "SOS", prn: "SOS", stat: "STAT" };
function parseVoiceRx(text) {
  var t = String(text || "").trim(); if (!t) return null;
  var lower = t.toLowerCase();
  var freq = ""; Object.keys(RX_FREQ).forEach(function (k) { if (!freq && new RegExp("\\b" + k.replace(/ /g, "\\s+") + "\\b", "i").test(lower)) freq = RX_FREQ[k]; });
  var dm = lower.match(/(\d+)\s*(days?|weeks?|months?)/); var duration = dm ? (dm[1] + " " + dm[2]) : "";
  var doseM = t.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)?/i); var dose = doseM ? (doseM[1] + (doseM[2] ? (" " + doseM[2]) : "")) : "";
  var drugM = t.match(/^([a-z][a-z\s\-]*?)(?=\s*\d|\s+(?:od|bd|tds|tid|qid|hs|sos|prn|stat)\b|$)/i);
  var drugRaw = (drugM ? drugM[1] : t.split(/\s+/)[0] || "").trim();
  return { drug: drugRaw, dose: dose, freq: freq, duration: duration };
}

const DRUGS = [
  { generic: "Pantoprazole", brands: ["pan", "pantop", "ppi"], dose: "40 mg IV/PO once daily." },
  { generic: "Paracetamol", brands: ["crocin", "dolo", "calpol", "pcm"], dose: "650 mg-1 g PO every 6 h." },
  { generic: "Ondansetron", brands: ["emeset", "ondem"], dose: "4-8 mg IV/PO every 8 h." }
];
const O = { parseLine: parseVoiceRx, drugs: DRUGS };

test("tablet line: brand resolved, strength and dose kept apart, duration not eaten as a dose", () => {
  const { rows, unparsed } = RX.parse("tab pan 40 one before food for 5 days", O);
  assert.deepEqual(unparsed, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].drug, "pan");
  assert.equal(rows[0].generic, "Pantoprazole");
  assert.equal(rows[0].matched, true);
  assert.equal(rows[0].strength, "40");
  assert.equal(rows[0].dose, "one");
  assert.equal(rows[0].duration, "5 days");
  assert.equal(rows[0].verbatim, "tab pan 40 one before food for 5 days");
});

test("syrup line: volume is the dose, frequency and duration parsed", () => {
  const { rows } = RX.parse("syp calpol 5 ml TDS x 3 days", O);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generic, "Paracetamol");
  assert.equal(rows[0].strength, "");
  assert.equal(rows[0].dose, "5 ml");
  assert.equal(rows[0].freq, "TDS");
  assert.equal(rows[0].duration, "3 days");
});

test("one row per medicine across lines and across inline form markers", () => {
  const a = RX.parse("tab pan 40 OD\nsyp calpol 5 ml TDS x 3 days", O);
  assert.deepEqual(a.rows.map((r) => r.generic), ["Pantoprazole", "Paracetamol"]);
  const b = RX.parse("tab pan 40 OD inj emeset 4 mg IV stat", O);
  assert.deepEqual(b.rows.map((r) => r.generic), ["Pantoprazole", "Ondansetron"]);
  assert.equal(b.rows[1].strength, "4 mg");
  assert.equal(b.rows[1].route, "IV");
  assert.equal(b.rows[1].freq, "STAT");
});

test("SAFETY: a dose that was not spoken is left empty, never invented", () => {
  const { rows } = RX.parse("tab pan OD", O);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].strength, "");
  assert.equal(rows[0].dose, "");
  assert.equal(rows[0].freq, "OD");
  // and the regimen it produces carries NO dose, so the Drug Index supplies its own.
  const reg = RX.toRegimen(rows);
  assert.equal("dose" in reg[0], false);
  assert.equal("source" in reg[0], false);
});

test("SAFETY: an unknown drug is matched:false with no generic and no borrowed dose", () => {
  const { rows } = RX.parse("tab zyxqwil BD for 3 days", O);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matched, false);
  assert.equal(rows[0].generic, "");
  assert.equal(rows[0].strength, "");
  assert.equal(rows[0].dose, "");
  assert.equal(RX.toRegimen(rows)[0].name, "zyxqwil");
});

test("SAFETY: route is only set when a route was actually spoken (a form word is not a route)", () => {
  assert.equal(RX.parse("inj emeset 4 mg stat", O).rows[0].route, "");
  assert.equal(RX.parse("inj emeset 4 mg IV stat", O).rows[0].route, "IV");
  assert.equal(RX.parse("tab pan 40 orally OD", O).rows[0].route, "PO");
});

test("toRegimen produces the shape rx-build.buildRxLines consumes", () => {
  const { rows } = RX.parse("tab pan 40 one before food for 5 days", O);
  assert.deepEqual(RX.toRegimen(rows), [
    { name: "Pantoprazole", dose: "40, one", source: "ai", duration: "5 days" }
  ]);
  // source:"ai" is the only value buildRxLines maps to unverified:true — a dictated dose
  // must be confirmed before signing.
  assert.equal(RX.toRegimen(rows)[0].source, "ai");
});

test("toRegimen output feeds the REAL rx-build.buildRxLines the pad uses", () => {
  const spoken = RX.toRegimen(RX.parse("tab pan 40 one before food for 5 days", O).rows);
  const [line] = buildRxLines(spoken, DRUGS);
  assert.equal(line.drug, "Pantoprazole");
  assert.equal(line.dose, "40, one");
  assert.equal(line.duration, "5 days");
  assert.equal(line.unverified, true, "a dictated dose must reach the pad flagged for confirmation");

  // No dose spoken -> the Drug Index supplies its own verified adult dose instead.
  const silent = RX.toRegimen(RX.parse("tab pan OD", O).rows);
  const [l2] = buildRxLines(silent, DRUGS);
  assert.equal(l2.dose, "40 mg IV/PO once daily.");
  assert.equal(l2.unverified, false);

  // Unknown drug, no dose spoken -> no dose invented anywhere in the chain.
  const [l3] = buildRxLines(RX.toRegimen(RX.parse("tab zyxqwil BD", O).rows), DRUGS);
  assert.equal(l3.dose, null);
  assert.equal(l3.unverified, true);
});

test("no parser injected: nothing is guessed, every line is reported unparsed", () => {
  const r = RX.parse("tab pan 40 OD", { drugs: DRUGS });
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.unparsed, ["tab pan 40 OD"]);
});

test("a parser that throws does not take the module down", () => {
  const r = RX.parse("tab pan 40 OD", { drugs: DRUGS, parseLine: () => { throw new Error("boom"); } });
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.unparsed, ["tab pan 40 OD"]);
});

test("empty and junk input", () => {
  assert.deepEqual(RX.parse("", O), { rows: [], unparsed: [] });
  assert.deepEqual(RX.parse(null, O), { rows: [], unparsed: [] });
  assert.deepEqual(RX.parse("   ", O), { rows: [], unparsed: [] });
  assert.deepEqual(RX.parse("tab", O), { rows: [], unparsed: [] });
  assert.deepEqual(RX.toRegimen(null), []);
  assert.deepEqual(RX.toRegimen([]), []);
});

test("a line with no drug name at all is reported unparsed, not dropped silently", () => {
  const r = RX.parse("500 mg BD", O);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.unparsed, ["500 mg BD"]);
});
