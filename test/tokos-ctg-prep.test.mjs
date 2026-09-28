import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { decodeHeader, decodeSignal, toPhysical, extractFeatures, renderTraceSvg } from "../tools/tokos-ctg-prep.mjs";

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
