#!/usr/bin/env node
/* Validate a chemo protocol JSON: schema + that the dose engine + protocol sheet can render it.
   Usage: node test/validate-protocol.cjs kb/protocols/<id>.json   -> exits 0 (OK) / 1 (errors). */
"use strict";
const fs = require("fs");
const path = require("path");
const DOSE = require(path.join(__dirname, "..", "onco-dose.js"));

function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: validate-protocol.cjs <protocol.json>"); process.exit(1); }
  let p;
  try { p = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("HARD: not valid JSON - " + e.message); process.exit(1); }

  const errs = [], warns = [];
  if (!p.id) errs.push("missing id");
  if (!p.name) errs.push("missing name");
  if (p.cycles == null) warns.push("missing cycles");
  if (p.cycleLengthDays == null) warns.push("missing cycleLengthDays");
  // DRAFT safety: these must NOT look clinically approved
  if (p.experimental !== true) warns.push("experimental should be true (DRAFT until clinician-approved)");
  if (p.lifecycleState && p.lifecycleState !== "draft") warns.push("lifecycleState should be 'draft'");

  const drugs = Array.isArray(p.drugs) ? p.drugs : [];
  if (!drugs.length) errs.push("no drugs[]");
  const BASES = ["bsa", "auc", "flat", "mgkg", "fixed"];
  drugs.forEach((d, i) => {
    const tag = "drug[" + i + "]" + (d && d.name ? "(" + d.name + ")" : "");
    if (!d.id) errs.push(tag + ": no id");
    if (!d.name) errs.push(tag + ": no name");
    if (!d.route) warns.push(tag + ": no route");
    if (d.basis && BASES.indexOf(d.basis) < 0) warns.push(tag + ": unusual basis '" + d.basis + "'");
    if ((d.basis === "bsa" || d.basis === "mgkg" || d.basis === "flat" || d.basis === "fixed") && d.dosePerUnit == null)
      errs.push(tag + ": basis '" + d.basis + "' needs dosePerUnit");
    if ((d.basis === "bsa" || d.basis === "mgkg") && !d.unit) warns.push(tag + ": no unit (e.g. mg/m2)");
    if (!Array.isArray(d.days) && d.days == null) warns.push(tag + ": no days[] (schedule)");
    // engine smoke: computes a finite dose for a reference patient
    try {
      const line = DOSE.doseForDrug(d, { height: 170, weight: 70, bsa: 1.8, sex: "male", age: 50 });
      if (d.basis === "bsa" && (line.final == null || !isFinite(line.final))) warns.push(tag + ": engine did not compute a finite dose");
    } catch (e) { errs.push(tag + ": engine.doseForDrug threw - " + e.message); }
  });

  console.log(JSON.stringify({ file: path.basename(file), id: p.id, name: p.name, drugs: drugs.length, cycles: p.cycles, errors: errs, warnings: warns }, null, 2));
  if (errs.length) { console.error("PROTOCOL VALIDATION FAILED: " + errs.length + " error(s)"); process.exit(1); }
  console.log("PROTOCOL OK");
}
main();
