import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { decodeHeader, decodeSignal, toPhysical, extractFeatures, renderTraceSvg, stripQuality } from "../tools/tokos-ctg-prep.mjs";

const SAMPLE_HEADER = `1001 2 4 19200
1001.dat 16 100(0)/bpm 12 0 15050 20101 0 FHR
1001.dat 16 100/nd 12 0 700 378 0 UC

#----- Additional parameters for record 1001

#-- Outcome measures
#pH           7.14
#BDecf        8.14
#pCO2         7.7
#BE           -10.5
#Apgar1       6
#Apgar5       8

#-- Fetus/Neonate descriptors
#Gest. weeks  37
`;

test("decodeHeader reads record shape, both signal specs and clinical comments", () => {
  const h = decodeHeader(SAMPLE_HEADER);
  assert.equal(h.record, "1001");
  assert.equal(h.nsig, 2);
  assert.equal(h.fs, 4);
  assert.equal(h.nsamp, 19200);
  assert.equal(h.signals[0].description, "FHR");
  assert.equal(h.signals[0].gain, 100);
  assert.equal(h.signals[0].baseline, 0);
  assert.equal(h.signals[0].initval, 15050);
  assert.equal(h.signals[1].description, "UC");
  assert.equal(h.clinical["pH"], 7.14);
  assert.equal(h.clinical["BE"], -10.5);
  assert.equal(h.clinical["Gest. weeks"], 37);
});

test("decodeSignal matches the header's stated initial value and yields a plausible FHR baseline", { skip: !existsSync("/tmp/tokos-ctg/1001.dat") }, () => {
  const h = decodeHeader(readFileSync("/tmp/tokos-ctg/1001.hea", "utf8"));
  const buf = readFileSync("/tmp/tokos-ctg/1001.dat");
  const raw = decodeSignal(buf, h);
  const fhr = toPhysical(raw[0], h.signals[0]);
  assert.ok(fhr[0] > 100 && fhr[0] < 200, "first FHR sample should be a plausible bpm value, got " + fhr[0]);
});

test("extractFeatures ignores a dropout segment instead of corrupting the baseline", () => {
  const fs = 4;
  const good = new Float64Array(600).fill(140); // 150s of clean 140bpm
  const dropout = new Float64Array(200).fill(0); // 50s of zero (sensor dropout)
  const fhr = Float64Array.from([...good, ...dropout, ...good]);
  const f = extractFeatures(fhr, fs);
  assert.equal(f.baseline, 140, "dropout zeros must not pull the baseline down");
});

test("extractFeatures counts a sustained deceleration but not a brief dip", () => {
  const fs = 4;
  const base = new Array(240).fill(140);
  const briefDip = [...base.slice(0, 100), ...new Array(20).fill(120), ...base.slice(100)]; // 5s dip, too short
  const f1 = extractFeatures(Float64Array.from(briefDip), fs);
  assert.equal(f1.decelCount, 0);
  const sustainedDip = [...base.slice(0, 100), ...new Array(80).fill(120), ...base.slice(100)]; // 20s dip
  const f2 = extractFeatures(Float64Array.from(sustainedDip), fs);
  assert.equal(f2.decelCount, 1);
});

test("renderTraceSvg produces a well-formed SVG that skips dropout instead of drawing a false flat line", () => {
  const fhr = Float64Array.from([140, 141, 0, 0, 142, 143]); // dropout in the middle
  const uc = Float64Array.from([10, 12, 14, 16, 18, 20]);
  const svg = renderTraceSvg(fhr, uc, 4);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.includes('role="img"'));
  assert.equal((svg.match(/<path/g) || []).length, 2);
});

import {
  CFG, signalQuality, twoPassBaseline, baselineClass, detectContractions, detectDecels,
  minuteVariability, decelSubtype, acidosisClass, extractFIGOFeatures,
} from "../tools/tokos-ctg-prep.mjs";

const FS = 4;
// n minutes of FHR: 140 bpm with a 12 bpm peak-to-trough wave (normal variability) or flat (reduced).
function fhrMinutes(spec) {
  const out = [];
  spec.forEach(([mins, kind]) => {
    for (let i = 0; i < mins * 60 * FS; i++) out.push(kind === "flat" ? 140 : 140 + 6 * Math.sin((2 * Math.PI * i) / (FS * 20)));
  });
  return Float64Array.from(out);
}
const restUc = (mins) => new Float64Array(mins * 60 * FS).fill(10);

test("signalQuality reports percent loss and flags over 30%", () => {
  const f = Float64Array.from([...new Array(60).fill(140), ...new Array(40).fill(0)]);
  assert.deepEqual(signalQuality(f), { lossPct: 40, suboptimal: true });
  assert.equal(signalQuality(new Float64Array(100).fill(140)).suboptimal, false);
});

test("twoPassBaseline ignores recurrent deep decelerations", () => {
  const f = fhrMinutes([[30, "wave"]]);
  for (let k = 0; k < 10; k++) for (let i = 0; i < 40 * FS; i++) f[k * 180 * FS + i] = 90; // ten 40 s drops to 90
  assert.equal(twoPassBaseline(f), 140);
});

test("baselineClass uses FIGO bands", () => {
  assert.equal(baselineClass(95), "severe_bradycardia");
  assert.equal(baselineClass(105), "bradycardia");
  assert.equal(baselineClass(140), "normal");
  assert.equal(baselineClass(165), "tachycardia");
});

test("reduced variability for 55 of 60 min is pathological; 20 of 60 is not", () => {
  const a = extractFIGOFeatures(fhrMinutes([[55, "flat"], [5, "wave"]]), restUc(60), FS);
  assert.equal(a.variability.reducedMin, 55);
  assert.equal(a.figoSuggested, "pathological");
  const b = extractFIGOFeatures(fhrMinutes([[20, "flat"], [40, "wave"]]), restUc(60), FS);
  assert.equal(b.variability.reducedMin, 20);
  assert.notEqual(b.figoSuggested, "pathological");
});

test("a single artifact spike does not flip a minute's variability band", () => {
  const f = fhrMinutes([[10, "wave"]]);
  for (let m = 0; m < 10; m++) f[m * 60 * FS + 30] = 205; // one spike per minute, still inside 50-210
  assert.equal(minuteVariability(f, FS, []).band, "normal");
});

test("a single deceleration over 5 min is pathological; 3 to 5 min is suspicious", () => {
  const long = fhrMinutes([[60, "wave"]]);
  for (let i = 20 * 60 * FS; i < 20 * 60 * FS + 320 * FS; i++) long[i] = 90;
  assert.equal(extractFIGOFeatures(long, restUc(60), FS).figoSuggested, "pathological");
  const mid = fhrMinutes([[60, "wave"]]);
  for (let i = 20 * 60 * FS; i < 20 * 60 * FS + 200 * FS; i++) mid[i] = 90;
  assert.equal(extractFIGOFeatures(mid, restUc(60), FS).figoSuggested, "suspicious");
});

test("tachysystole is a separate flag, not an FHR category driver", () => {
  const uc = restUc(60);
  for (let s = 0; s < 3600; s += 100) for (let i = s * FS; i < (s + 60) * FS; i++) uc[i] = 60; // 6 per 10 min
  const f = extractFIGOFeatures(fhrMinutes([[60, "wave"]]), uc, FS);
  assert.equal(f.contractions.tachysystole, true);
  assert.equal(f.figoSuggested, "normal");
});

test("detectContractions measures above resting tone, so drift does not create contractions", () => {
  const uc = new Float64Array(600 * FS);
  for (let i = 0; i < uc.length; i++) uc[i] = 10 + (i / uc.length) * 12; // slow drift of 12 units, no contraction
  assert.equal(detectContractions(uc, FS).length, 0);
  for (let i = 100 * FS; i < 160 * FS; i++) uc[i] += 30; // one 60 s contraction
  assert.equal(detectContractions(uc, FS).length, 1);
});

test("decelSubtype: late when the nadir lags the contraction peak by over 20 s", () => {
  const c = [{ start: 0, end: 60 * FS, peak: 30 * FS }];
  assert.equal(decelSubtype({ start: 20 * FS, end: 90 * FS, nadir: 60 * FS, durationSec: 70 }, c, FS), "late");
  assert.equal(decelSubtype({ start: 0, end: 60 * FS, nadir: 32 * FS, durationSec: 60 }, c, FS), "early");
  assert.equal(decelSubtype({ start: 25 * FS, end: 50 * FS, nadir: 35 * FS, durationSec: 25 }, c, FS), "variable");
  assert.equal(decelSubtype({ start: 0, end: 200 * FS, nadir: 60 * FS, durationSec: 200 }, c, FS), "prolonged");
});

test("acidosisClass follows the Low criteria and never invents a missing value", () => {
  assert.equal(acidosisClass({ pH: 7.0, BDecf: 14 }), "metabolic");
  assert.equal(acidosisClass({ pH: 7.15, BDecf: 6 }), "acidaemia_not_metabolic");
  assert.equal(acidosisClass({ pH: 7.1 }), "acidaemia_unspecified");
  assert.equal(acidosisClass({ pH: 7.25, BDecf: 3 }), "normal");
  assert.equal(acidosisClass({}), "unknown");
});

import { renderCalibratedTraceSvg, yForBpm } from "../tools/tokos-ctg-prep.mjs";

test("calibrated renderer: 110/160 band, amber 100 line, one major line per minute, no <style>", () => {
  const fhr = new Float64Array(30 * 60 * 4).fill(140), uc = new Float64Array(30 * 60 * 4).fill(10);
  const { svg, layout } = renderCalibratedTraceSvg(fhr, uc, 4);
  assert.ok(!/<style/i.test(svg), "inline SVG must not carry a <style> element");
  assert.ok(svg.includes('class="tk-band"'));
  assert.equal((svg.match(/class="tk-line-normal"/g) || []).length, 2);
  assert.equal((svg.match(/class="tk-line-100"/g) || []).length, 1);
  assert.equal((svg.match(/class="tk-grid-major-t"/g) || []).length, 31);
  assert.equal(layout.durationSec, 1800);
  assert.ok(svg.includes('y1="' + yForBpm(layout, 110).toFixed(1) + '"'));
});

test("calibrated renderer breaks the FHR path on dropout and on values over 210", () => {
  const fhr = Float64Array.from([140, 141, 0, 0, 142, 143, 250, 144, 145]);
  const { svg } = renderCalibratedTraceSvg(fhr, new Float64Array(9).fill(10), 4);
  const d = /class="tk-fhr" d="([^"]*)"/.exec(svg)[1];
  assert.equal((d.match(/M/g) || []).length, 3);
});

test("v1 renderTraceSvg emits 1 M and 5 L on a clean trace, 2 M on a dropout", () => {
  const uc = new Float64Array(6).fill(10);
  const d1 = /<path d="([^"]*)"[^>]*#ff6b6b/.exec(renderTraceSvg(Float64Array.from([140, 141, 142, 143, 144, 145]), uc, 4))[1];
  assert.equal((d1.match(/M/g) || []).length, 1);
  assert.equal((d1.match(/L/g) || []).length, 5);
  const d2 = /<path d="([^"]*)"[^>]*#ff6b6b/.exec(renderTraceSvg(Float64Array.from([140, 141, 0, 143, 144, 145]), uc, 4))[1];
  assert.equal((d2.match(/M/g) || []).length, 2);
});

test("calibrated renderer breaks the path when decimation would skip a dropout sample", () => {
  const fhr = Float64Array.from([140, 140, 140, 0, 140, 140, 140, 140]);
  const { svg } = renderCalibratedTraceSvg(fhr, new Float64Array(8).fill(10), 4);
  const d = /class="tk-fhr" d="([^"]*)"/.exec(svg)[1];
  assert.equal((d.match(/M/g) || []).length, 2);
});

test("signalQuality of empty input is total loss, not NaN", () => {
  assert.deepEqual(signalQuality(new Float64Array(0)), { lossPct: 100, suboptimal: true });
});

test("stripQuality: FHR loss counts out-of-range samples, UC present counts finite samples above 0", () => {
  const fhr = [140, 0, 140, 300, 140, 140, 140, 140, 140, 140];
  const uc = [0, 0, 5, 10, NaN, 20, 0, 0, 0, 0];
  assert.deepEqual(stripQuality(fhr, uc), { fhrLossPct: 20, ucPresentPct: 30 });
  assert.deepEqual(stripQuality([], []), { fhrLossPct: 100, ucPresentPct: 0 });
});

import { reviewQueueMd, HAND_MARK } from "../tools/tokos-ctg-prep.mjs";
test("review queue: documents every review field the app reads, lists the content to review, keeps the hand-maintained section", () => {
  const deck = JSON.parse(readFileSync("tokos/decks/ctg.json", "utf8"));
  const hand = HAND_MARK + "\n## Pipeline check\n- kept note\n";
  const md = reviewQueueMd(deck.cases, deck.cases.map(() => "q"), ["a.b", "c.d"], hand);
  assert.ok(md.includes("`date`"));
  for (const f of ["by", "uc", "baselineClass", "variability", "decels", "decelType", "figo", "complete"]) assert.ok(md.includes("- `" + f + "`"), f);
  assert.ok(md.includes("## Content to review") && md.includes("all 2 teaching points") && md.includes("tokos-calipers.js") && md.includes("L10N.en.opts"));
  assert.ok(md.endsWith(hand), "hand-maintained section kept verbatim at the end");
  assert.ok(reviewQueueMd(deck.cases, deck.cases.map(() => "q"), [], null).endsWith(HAND_MARK + "\n"), "a fresh queue gets an empty hand-maintained section");
  const committed = readFileSync("docs/tokos/review-queue.md", "utf8");
  assert.ok(committed.includes(HAND_MARK) && committed.includes("## How a review is recorded") && committed.includes("Review Desk"), "committed queue carries the generated header and the marker");
});
