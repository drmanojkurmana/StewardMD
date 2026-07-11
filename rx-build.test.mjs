// Safety core: regimen → Rx lines, DB-first dosing with gap-flagging.
// Run: node rx-build.test.mjs
import { buildRxLines, pickBrand } from "./rx-build.mjs";

const DB = [
  { generic: "Lactulose", cls: "Osmotic laxative", brands: ["duphalac", "looz", "laxative"], dose: "15–30 mL PO BD–TDS" },
  { generic: "Pantoprazole", cls: "Proton pump inhibitor (PPI)", brands: ["pan", "pantop", "ppi"], dose: "40 mg PO OD" },
  { generic: "Psyllium husk", cls: "Bulk-forming laxative", brands: ["isabgol", "naturolax", "laxative"], dose: "1 tbsp in water OD–BD" }
];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ FAIL:", n); } };

// brand pick excludes class-abbrev tokens
ok("pickBrand skips class token", pickBrand(DB[0]) === "duphalac");
ok("pickBrand skips ppi", pickBrand(DB[1]) === "pan");

const lines = buildRxLines([
  { name: "Lifestyle modification", isAdvice: true },
  { name: "Lactulose" },                       // DB match, no regimen dose → trusted DB dose+brand
  { name: "Lubiprostone", dose: "8 mcg BD" },  // NOT in DB, regimen dose, no provenance → AI/unverified
  { name: "Pantoprazole", dose: "40 mg OD", source: "kb" }, // DB match + KB dose → trusted
  { name: "Domperidone" }                      // NOT in DB, no dose → null dose, flagged
], DB);

const L = (drug) => lines.find(x => x.drug === drug || x.drug === drug + "");
ok("advice line passthrough", lines[0].isAdvice === true && lines[0].dose == null && lines[0].source === "advice" && lines[0].unverified === false);
ok("DB drug: trusted dose", L("Lactulose").dose === "15–30 mL PO BD–TDS" && L("Lactulose").source === "db" && L("Lactulose").unverified === false);
ok("DB drug: brand from index", L("Lactulose").brand === "duphalac");
ok("non-DB + regimen dose → unverified", L("Lubiprostone").dose === "8 mcg BD" && L("Lubiprostone").unverified === true && L("Lubiprostone").brand == null);
ok("KB-sourced dose trusted", L("Pantoprazole").dose === "40 mg OD" && L("Pantoprazole").unverified === false);
ok("non-DB no dose → null + flagged", L("Domperidone").dose == null && L("Domperidone").unverified === true);
ok("never silently invents a dose", lines.every(l => l.isAdvice || l.dose != null || l.unverified === true));

// normalization: brand-name input + case/space resolves to the DB generic
const norm = buildRxLines([{ name: "  PANTOP  " }], DB);
ok("brand/case input resolves to generic", norm[0].drug === "Pantoprazole" && norm[0].source === "db");

// garbage-safe
ok("empty regimen → []", JSON.stringify(buildRxLines([], DB)) === "[]");
ok("null args safe", Array.isArray(buildRxLines(null, null)));

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
