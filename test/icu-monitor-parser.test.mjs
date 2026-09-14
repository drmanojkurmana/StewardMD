/* test/icu-monitor-parser.test.mjs — parser v2 on the REAL Apple Vision observations of the owner's
 * Philips IntelliVue MP40 photo (test/fixtures/mp40-vision-*.json), plus synthetic geometry cases for
 * the safety rules. Colour tests use bench/icu-monitor/pixsource.mjs (PIL) and skip when unavailable. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const M = require("../icu-monitor-parser.js");
const fx = (n) => { const j = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8")); return j.obs.map((o) => ({ text: o.text, conf: o.conf, x: o.x, y: o.y, w: o.w, h: o.h })); };
const AT900 = fx("mp40-vision-900px"), AT1800 = fx("mp40-vision-1800px"), AT2700 = fx("mp40-vision-2700px"), AT900C = fx("mp40-vision-900px-corrected");
let havePIL = false; try { execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" }); havePIL = true; } catch {}
const IMG900 = new URL("../bench/icu-monitor/fixtures/real/philips-mp40-owner-900px.jpg", import.meta.url).pathname;
const IMG1800 = new URL("../bench/icu-monitor/fixtures/real/philips-mp40-owner-1800px.jpg", import.meta.url).pathname;
async function px(path) { if (!havePIL || !existsSync(path)) return null; const { pixelSource } = await import("../bench/icu-monitor/pixsource.mjs"); return pixelSource(path); }

test("MANDATORY REGRESSION (no colour): HR 105 with label, pressure 149/66, MAP 98 at 1800px, Pulse never inferred", () => {
  const r = M.parseMonitor(AT1800);
  assert.equal(r.fields.hr.status, "AUTO_ACCEPTED"); assert.equal(r.fields.hr.value, 105);
  assert.equal(r.fields.sbp.value, 149); assert.equal(r.fields.dbp.value, 66); assert.equal(r.fields.map.value, 98);
  assert.equal(r.fields.pulse.value, null, "Pulse label was never read: must stay null");
  assert.notEqual(r.fields.pulse.status, "AUTO_ACCEPTED");
  assert.equal(r.layout.profile, "philips-intellivue");
});

test("without colour, an UNLABELED row is NEEDS_REVIEW with the suggestion, never auto-filled", () => {
  const r = M.parseMonitor(AT1800);   // no SpO2 label box exists at this scale
  assert.equal(r.fields.spo2.status, "NEEDS_REVIEW"); assert.equal(r.fields.spo2.value, null); assert.equal(r.fields.spo2.suggested, 100);
  assert.equal(r.fields.rr.status, "NEEDS_REVIEW"); assert.equal(r.fields.rr.suggested, 22);
});

test("MAP is NOT_FOUND (never computed) where Vision did not read '(98)'", () => {
  for (const o of [AT900, AT2700]) { const r = M.parseMonitor(o); assert.equal(r.fields.map.status, "NOT_FOUND"); assert.equal(r.fields.map.value, null); }
});

test("the alarm limit loses to the value even when both read cleanly, and appears as a scored alternative", () => {
  const obs = [
    { text: "HR",  x: 0.568, y: 0.452, w: 0.021, h: 0.0087 },
    { text: "120", x: 0.574, y: 0.462, w: 0.034, h: 0.0116 },
    { text: "50",  x: 0.574, y: 0.474, w: 0.024, h: 0.0116 },
    { text: "105", x: 0.581, y: 0.464, w: 0.129, h: 0.0363 },
    { text: "149/66", x: 0.603, y: 0.546, w: 0.152, h: 0.0484 }
  ];
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.hr.value, 105);
  const alt = r.fields.hr.candidates.find((c) => c.value === 120);
  assert.ok(alt, "120 retained as a candidate"); assert.equal(alt.role, "limit"); assert.ok(alt.score < r.fields.hr.candidates.find((c) => c.value === 105).score);
});

test("two close primary candidates → NEEDS_REVIEW, not a coin flip", () => {
  const obs = [
    { text: "HR",  x: 0.568, y: 0.452, w: 0.021, h: 0.0087 },
    { text: "105", x: 0.581, y: 0.464, w: 0.060, h: 0.0363 },
    { text: "108", x: 0.650, y: 0.464, w: 0.060, h: 0.0363 },
    { text: "149/66", x: 0.603, y: 0.546, w: 0.152, h: 0.0484 }
  ];
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.hr.status, "NEEDS_REVIEW"); assert.equal(r.fields.hr.value, null);
  assert.match(r.fields.hr.reason, /too close/);
});

test("two pressures of similar size (ART vs NIBP) → primary NEEDS_REVIEW, both named sub-fields reported", () => {
  const obs = [
    { text: "ART",    x: 0.560, y: 0.540, w: 0.03, h: 0.0080 },
    { text: "119/66", x: 0.600, y: 0.546, w: 0.15, h: 0.0400 },
    { text: "NIBP",   x: 0.560, y: 0.600, w: 0.04, h: 0.0080 },
    { text: "121/79", x: 0.600, y: 0.606, w: 0.15, h: 0.0380 }
  ];
  const r = M.parseMonitor(obs);
  assert.equal(r.fields.sbp.status, "NEEDS_REVIEW"); assert.equal(r.fields.sbp.value, null);
  assert.deepEqual(r.fields.art.suggested, { s: 119, d: 66 }); assert.deepEqual(r.fields.nibp.suggested, { s: 121, d: 79 });
});

test("the clock is never RR, the banner is never a label, SpO2 > 100 is rejected", () => {
  const obs = [
    { text: "20: 38", x: 0.52, y: 0.42, w: 0.05, h: 0.010 },
    { text: "** RR",  x: 0.38, y: 0.43, w: 0.06, h: 0.010 },
    { text: "HIGH",   x: 0.49, y: 0.43, w: 0.05, h: 0.013 },
    { text: "SpO2",   x: 0.56, y: 0.50, w: 0.04, h: 0.012 },
    { text: "108",    x: 0.58, y: 0.51, w: 0.12, h: 0.035 }
  ];
  const r = M.parseMonitor(obs);
  assert.notEqual(r.fields.rr.value, 20); assert.notEqual(r.fields.rr.value, 38);
  assert.equal(r.fields.spo2.value, null);
});

test("MANDATORY 2x REGRESSION, relaxed policy: 6/6 with colour (HR 105, SpO2 100, 149/66, MAP 98, RR 22), Pulse null", { skip: !havePIL || !existsSync(IMG1800) }, async () => {
  const r = M.parseMonitor(AT1800, { px: await px(IMG1800), unlabeledAuto: true });
  assert.deepEqual({ hr: r.values.hr, spo2: r.values.spo2, sbp: r.values.sbp, dbp: r.values.dbp, map: r.values.map, rr: r.values.rr }, { hr: 105, spo2: 100, sbp: 149, dbp: 66, map: 98, rr: 22 });
  assert.equal(r.fields.pulse.value, null);
  assert.ok(r.fields.rr.confidence >= 0.8);
});

test("STRICT default at 2x: the two rows whose labels Vision dropped are NEEDS_REVIEW with the right suggestion and the evidence spelled out", { skip: !havePIL || !existsSync(IMG1800) }, async () => {
  const r = M.parseMonitor(AT1800, { px: await px(IMG1800) });
  assert.deepEqual({ hr: r.values.hr, sbp: r.values.sbp, dbp: r.values.dbp, map: r.values.map }, { hr: 105, sbp: 149, dbp: 66, map: 98 });
  for (const k of ["spo2", "rr"]) {
    assert.equal(r.fields[k].status, "NEEDS_REVIEW", k); assert.equal(r.fields[k].value, null, k);
    assert.match(r.fields[k].reason, /label not read \(slot and colour agree\)/, k);
  }
  assert.equal(r.fields.spo2.suggested, 100); assert.equal(r.fields.rr.suggested, 22);
});

test("with colour (real photo, 900px, strict): HR/SpO2 (label 'Sp0z' read)/pressure auto, RR suggested, MAP honestly missing", { skip: !havePIL || !existsSync(IMG900) }, async () => {
  const r = M.parseMonitor(AT900, { px: await px(IMG900) });
  assert.deepEqual({ hr: r.values.hr, spo2: r.values.spo2, sbp: r.values.sbp, dbp: r.values.dbp }, { hr: 105, spo2: 100, sbp: 149, dbp: 66 });
  assert.equal(r.fields.rr.status, "NEEDS_REVIEW"); assert.equal(r.fields.rr.suggested, 22);
  assert.equal(r.fields.map.status, "NOT_FOUND");
});

test("explain() and overlaySVG() render without throwing and mention the selected value", () => {
  const r = M.parseMonitor(AT1800);
  const txt = M.explain(r, AT1800); assert.match(txt, /Field: HR/); assert.match(txt, /Selected: 105/);
  const svg = M.overlaySVG(r, AT1800, 1800, 3200); assert.match(svg, /<svg/); assert.match(svg, /HR/);
});
