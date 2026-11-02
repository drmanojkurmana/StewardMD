import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TRUST = require("../kardia-calc-trust.js");
const VIEWS = require("../kardia/views.json");

const VIEW_IDS = [
  "tte_plax", "tte_psax_av", "tte_psax_mv", "tte_psax_papillary",
  "tte_a4c", "tte_a2c", "tte_a3c", "tte_a5c",
  "tte_subcostal_4c", "tte_subcostal_ivc"
];
const CALC_IDS = [
  "as-continuity", "lv-ef", "lap-ee", "rvsp", "rv-function",
  "lv-mass", "la-size", "pa-pressure", "mitral-pht", "ar-continuity"
];
const GUIDELINES = new Set([
  "ASE complete transthoracic examination 2019",
  "BSE minimum dataset for a standard adult transthoracic study",
  "ASE/EACVI chamber quantification 2015",
  "ASE diastolic function 2016",
  "ASE right heart 2010",
  "ASE/EACVI regurgitation 2017",
  "ESC/EACTS valvular heart disease 2021"
]);

function checkProv(item, prov, id) {
  assert.ok(prov && typeof prov === "object", id + " provenance missing");
  assert.ok(GUIDELINES.has(prov.guideline), id + " unknown guideline " + prov.guideline);
  assert.equal(prov.author, "Kardia team (AI drafted)", id + " author");
  assert.equal(prov.reviewer, "Awaiting review", id + " reviewer");
  assert.equal(prov.date, "2026-11-01", id + " date");
  assert.ok(!/—|–/.test(prov.guideline), id + " no em/en dash");
}

test("all 10 core views carry provenance and stay ai_drafted", () => {
  assert.equal(VIEWS.review.status, "ai_drafted", "catalogue stays ai_drafted");
  for (const id of VIEW_IDS) {
    const v = VIEWS.views.find(function (x) { return x.id === id; });
    assert.ok(v, "view missing " + id);
    checkProv(v, v.provenance, id);
  }
});

test("all 10 calculators carry provenance and stay Draft, awaiting review", () => {
  for (const id of CALC_IDS) {
    const t = TRUST[id];
    assert.ok(t, "trust entry missing " + id);
    checkProv(t, t.provenance, id);
    assert.equal(t.status, "Draft, awaiting review", id + " status");
    assert.equal(t.ref.length > 0, true, id + " ref stays");
  }
});

test("render paths print the source line", () => {
  const calc = readFileSync("kardia-calc.js", "utf8");
  assert.ok(calc.includes("kcalc-trust-src"), "trust block has a source line class");
  assert.ok(calc.includes("provenance"), "trust render reads provenance");
  assert.ok(calc.includes("Kardia team (AI drafted)"), "trust render prints the author");
  assert.ok(calc.includes("Awaiting review"), "trust render prints the reviewer");
  const host = readFileSync("kardia.js", "utf8");
  assert.ok(host.includes("echoProvHtml(cur)"), "view detail calls the provenance line");
  assert.ok(host.includes("krd-src"), "view detail has a source line class");
  assert.ok(host.includes("2026-11-01"), "view detail prints the change date");
  const code = calc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/=>|\bconst\s|\blet\s/.test(code), "calc UI stays ES5");
  assert.ok(!/—|–/.test(calc), "no em/en dashes in calc UI");
  const css = readFileSync("kardia-calc.css", "utf8");
  assert.ok(css.includes("kcalc-trust-src"), "source line reuses the trust tokens");
  assert.ok(!/gradient|glow|box-shadow/.test(css), "no new depth effects");
});
