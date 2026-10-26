import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const K = require("../kardia-calc-data.js");
const views = JSON.parse(readFileSync("kardia/views.json", "utf8"));
const viewIds = new Set(views.views.map(v => v.id));
function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}±${tol}`); }

test("catalogue covers 70+ topics with source, example, ranges, valid Scan Lab view", () => {
  assert.ok(K.calcs.length >= 70, K.calcs.length);
  const ids = new Set();
  for (const c of K.calcs) {
    assert.ok(!ids.has(c.id), "dup " + c.id); ids.add(c.id);
    assert.ok(c.name && c.source && c.how && c.limits && c.out, c.id);
    assert.ok(viewIds.has(c.view), c.id + " view " + c.view);
    assert.ok(c.inputs.length >= 1, c.id);
    for (const i of c.inputs) { assert.ok(i.lo < i.d && i.d < i.hi || i.lo <= i.d && i.d <= i.hi, c.id + ":" + i.k); assert.equal(typeof c.example[i.k], "number", c.id + " example " + i.k); }
    const r = K.compute(c.id, c.example);
    assert.ok(r && isFinite(r.v) && r.g && r.g.grade, c.id + " compute");
  }
  for (const need of ["bsa","lv-mass","lv-ef","diastolic-sinus","diastolic-af","as-continuity","mr-pisa","mitral-pht","aortic-prosthesis","rap","rvsp","pvr","qpqs","effusion-size","doppler-equation","bernoulli","poiseuille","pulse-repetition","wmsi","pathway-diastology","pathway-as"]) assert.ok(ids.has(need), "missing " + need);
});

test("formula worked examples match guideline arithmetic", () => {
  close(K.compute("bsa", { h: 170, w: 70 }).v, 1.81, 0.02, "BSA Mosteller");
  close(K.compute("lv-ef", { edv: 120, esv: 50 }).v, 58, 1, "LVEF");
  close(K.compute("as-continuity", { lvotd: 2.0, lvotvti: 22, avvti: 95, peakv: 4.2, meanG: 42 }).v, 0.73, 0.02, "AVA continuity");
  close(K.compute("mitral-pht", { pht: 220 }).v, 1.0, 0.01, "MVA 220/PHT");
  close(K.compute("rvsp", { trv: 3.0, rap: 8 }).v, 44, 0.5, "RVSP 4v2+RAP");
  close(K.compute("bernoulli", { v2: 4, v1: 1 }).v, 64, 0.5, "Bernoulli");
  close(K.compute("qpqs", { rvotd: 2.4, rvotvti: 18, lvotd: 2.0, lvotvti: 22 }).v, 1.18, 0.03, "QpQs");
  const mr = K.compute("mr-pisa", { r: 0.8, va: 35, peakv: 5.0, vti: 150 });
  close(mr.v, 0.28, 0.02, "MR EROA"); assert.match(mr.extra, /42|43/, "MR volume ~42mL: " + mr.extra);
  close(K.compute("doppler-equation", { f0: 3, v: 1.5, theta: 0, c: 1540 }).v, 5.8, 0.2, "Doppler shift kHz");
});

test("grading threshold boundaries", () => {
  // LAVI 34 normal, 35 mild
  assert.match(K.compute("la-size", { lavi: 34, lad: 3.8 }).g.grade, /Normal/);
  assert.match(K.compute("la-size", { lavi: 35, lad: 3.8 }).g.grade, /Mildly/);
  // LVEF: edv100 esv48 =52 normal; esv49=51 mildly reduced
  assert.match(K.compute("lv-ef", { edv: 100, esv: 48 }).g.grade, /Normal/);
  assert.match(K.compute("lv-ef", { edv: 100, esv: 49 }).g.grade, /Mildly/);
  // RAP scheme corners
  assert.equal(K.compute("rap", { ivcd: 21, collapse: 51 }).v, 3);
  assert.equal(K.compute("rap", { ivcd: 22, collapse: 49 }).v, 15);
  assert.equal(K.compute("rap", { ivcd: 22, collapse: 60 }).v, 8);
  // severe AS all-agree vs discordant
  assert.match(K.compute("as-continuity", { lvotd: 2, lvotvti: 20, avvti: 80, peakv: 4.5, meanG: 50 }).g.grade, /Severe/);
  // effusion 10 boundary
  assert.match(K.compute("effusion-size", { dias: 9 }).g.grade, /Small/);
  assert.match(K.compute("effusion-size", { dias: 10 }).g.grade, /Moderate/);
  // MPI boundary via tco/et: 0.43
  assert.match(K.compute("mpi", { tco: 400, et: 280 }).g.grade, /Normal|Raised/);
  assert.ok(K.compute("mpi", { tco: 430, et: 300 }).v <= 0.44);
  // integrated AS pathway: classical LF-LG
  assert.match(K.compute("pathway-as", { peakv: 3.2, meanG: 28, ava: 0.8, svi: 30, lvef: 40 }).g.grade, /Classical low flow/);
  assert.match(K.compute("pathway-as", { peakv: 4.5, meanG: 50, ava: 0.8, svi: 40, lvef: 60 }).g.grade, /High gradient severe/);
});

test("UI wiring: stable ids, loader registration, ES5, British text hygiene", () => {
  const ui = readFileSync("kardia-calc.js", "utf8");
  for (const s of ["kcalc-search", "kcalc-item-", "kcalc-input-", "kcalc-result-", "kcalc-fav", "Worked example", "Measure this in Scan Lab", "Sources and limitations", "Where to measure"]) assert.ok(ui.includes(s), s);
  const loader = readFileSync("kardia-loader.js", "utf8");
  assert.ok(loader.includes('"kardia-calc.css"') && loader.includes('"kardia-calc-data.js"') && loader.includes('"kardia-calc.js"'), "loader lists calc files");
  assert.ok(loader.indexOf('"kardia-calc-data.js"') < loader.indexOf('"kardia-calc.js"'), "data before UI");
  const host = readFileSync("kardia.js", "utf8");
  assert.ok(host.includes('"calc"') && host.includes("KARDIA_CALC"), "host calc tab");
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/=>|=>|\bconst\s|\blet\s/.test(code), "ES5 only");
  assert.ok(!/—|–/.test(ui.replace(/\/\*[\s\S]*?\*\//g, "")), "no em/en dashes in UI file");
  assert.ok(!/\bweb app\b|\bbrowser\b/i.test(code), "no web/browser wording");
  const css = readFileSync("kardia-calc.css", "utf8");
  assert.ok(css.includes("min-height:44px") || css.includes("min-height: 44px") || css.includes("min-height:52px"), "44px targets");
  assert.ok(css.includes("prefers-reduced-motion"), "reduced motion");
  assert.ok(css.includes("font-size:16px"), "16px inputs");
});
