#!/usr/bin/env node
// scripts/gen-vaccines.mjs — regenerate functions/_vaccines.js from the NDHM IG's own value set.
//
// A vaccine code that reaches a patient's national health record is a clinical claim, so none of them is
// typed by hand: they are copied out of ndhm.in's ValueSet-ndhm-vaccine-codes.json. The India schedule is
// an ORDERING over that list, and every code in it is asserted present here - a typo fails this script
// rather than shipping a wrong vaccine. (It already caught one: HPV is ...103, not ...109.)
//
// Usage: node scripts/gen-vaccines.mjs [path-to-ValueSet-ndhm-vaccine-codes.json]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const DEFAULT = homedir() + "/.fhir/packages/ndhm.in#6.5.0/package/ValueSet-ndhm-vaccine-codes.json";
const src = process.argv[2] || DEFAULT;
const vs = JSON.parse(readFileSync(src, "utf8"));
const inc = vs.compose.include[0];
const system = inc.system;
const concepts = inc.concept.map((c) => [c.code, c.display]);
const byCode = new Map(concepts);

// India's National Immunization Schedule, in schedule order. `label` is what a clinician actually says;
// the DISPLAY always comes from the IG.
const SCHEDULE = [
  ["1861000221106", "BCG"],
  ["1051000221104", "OPV (bivalent, oral)"],
  ["871740006", "IPV"],
  ["871822003", "Hepatitis B"],
  ["871886002", "Pentavalent (DPT-HepB-Hib)"],
  ["871761004", "Rotavirus"],
  ["1119254000", "PCV 13"],
  ["871817003", "Measles-Rubella (MR)"],
  ["871724008", "Japanese encephalitis"],
  ["871875004", "DPT booster"],
  ["871827009", "Td"],
  ["2021000221101", "Tetanus toxoid (TT)"],
  ["911000221103", "HPV"],
  ["1131000221109", "Rabies (inactivated)"],
  ["871755002", "Typhoid (Vi polysaccharide)"],
  ["1181000221105", "Influenza"],
];
const missing = SCHEDULE.map(([c]) => c).filter((c) => !byCode.has(c));
if (missing.length) { console.error("schedule codes absent from the IG value set: " + missing.join(", ")); process.exit(1); }

const q = JSON.stringify;
const out = [];
out.push(`// functions/_vaccines.js — the vaccine catalogue behind OPD immunisation capture.
//
// GENERATED, NOT HAND-WRITTEN — run scripts/gen-vaccines.mjs to refresh. Every code below is copied
// verbatim out of the NDHM IG's own value set (ndhm.in ValueSet-ndhm-vaccine-codes,
// ${concepts.length} SNOMED CT concepts).
//
// WHY IT IS GENERATED. A vaccine code in a patient's national health record is a clinical claim. Typing
// SNOMED from memory is how a wrong one ships, and a wrong vaccine code is worse than no record at all.
// So the catalogue is derived from the IG, and the server REFUSES any code that is not in it. The client
// picker is a view over this list, never the source of truth.
//
// SCHEDULE is India's National Immunization Schedule surfaced first in the picker. It is an ORDERING over
// the same list - not a second catalogue - and the generator asserts every entry exists.`);
out.push("");
out.push(`export const VACCINE_SYSTEM = ${q(system)};`);
out.push("");
out.push("/** The IG value set, verbatim: code -> display. */");
out.push("export const VACCINES = Object.freeze({");
for (const [code, disp] of [...concepts].sort((a, b) => a[1].toLowerCase().localeCompare(b[1].toLowerCase()))) {
  out.push(`  ${q(code)}: ${q(disp)},`);
}
out.push("});");
out.push("");
out.push("/** India's NIS, in schedule order. `label` is the name a clinician actually says. */");
out.push("export const SCHEDULE = Object.freeze([");
for (const [code, label] of SCHEDULE) out.push(`  { code: ${q(code)}, label: ${q(label)} },`);
out.push("]);");
out.push(`
/** A vaccine code is valid ONLY if the IG has it. Anything else is refused, never stored as free text. */
export function isVaccineCode(code) { return Object.prototype.hasOwnProperty.call(VACCINES, String(code || "")); }

/** The full coding for a code, or null. The display comes from the IG, NEVER from the caller. */
export function vaccineCoding(code) {
  const c = String(code || "");
  return isVaccineCode(c) ? { system: VACCINE_SYSTEM, code: c, display: VACCINES[c] } : null;
}

/** Picker payload: the schedule first (with clinician labels), then everything else alphabetically. */
export function vaccineCatalogue() {
  const inSchedule = new Set(SCHEDULE.map((s) => s.code));
  return {
    system: VACCINE_SYSTEM,
    schedule: SCHEDULE.map((s) => ({ code: s.code, label: s.label, display: VACCINES[s.code] })),
    others: Object.keys(VACCINES).filter((c) => !inSchedule.has(c))
      .map((c) => ({ code: c, display: VACCINES[c] }))
      .sort((a, b) => a.display.localeCompare(b.display)),
  };
}`);
writeFileSync("functions/_vaccines.js", out.join("\n") + "\n");
console.log(`wrote functions/_vaccines.js — ${concepts.length} concepts, ${SCHEDULE.length} in the India schedule`);
