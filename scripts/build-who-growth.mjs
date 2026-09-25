#!/usr/bin/env node
/* StewardMD - build kb/growth/who-growth.json (WHO growth standard LMS parameters) for the
 * paediatric growth tool in specialty-kits.js.
 *
 *   node scripts/build-who-growth.mjs <anthro-repo-dir> <anthroplus-repo-dir>
 *
 * Inputs are WHO's own published tables, as shipped in WHO's official R packages
 * (github.com/WorldHealthOrganization/anthro, .../anthroplus, data-raw/growthstandards/*.txt):
 *   0 to 5 years  WHO Child Growth Standards (2006), LMS by DAY of age, and by 0.1 cm for
 *                 weight-for-length (45 to 110 cm) / weight-for-height (65 to 120 cm).
 *   5 to 19 years WHO Reference 2007, LMS by MONTH of age.
 * The same values are published on who.int as the "expanded tables"; test/specialty-kits.test.mjs
 * checks the output against WHO's published z-score tables and WHO's reference survey results.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [anthro, anthroplus] = process.argv.slice(2);
if (!anthro || !anthroplus) { console.error("usage: node scripts/build-who-growth.mjs <anthro-dir> <anthroplus-dir>"); process.exit(2); }

function table(file, keyCol) {
  const rows = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const head = rows.shift().split("\t");
  const iSex = head.indexOf("sex"), iKey = head.indexOf(keyCol), iL = head.indexOf("l"), iM = head.indexOf("m"), iS = head.indexOf("s");
  const out = { "1": { start: null, l: [], m: [], s: [] }, "2": { start: null, l: [], m: [], s: [] } };
  let prev = { "1": null, "2": null };
  rows.forEach((r) => {
    const c = r.split("\t"), sex = c[iSex], key = Number(c[iKey]);
    const t = out[sex]; if (!t) throw new Error("bad sex in " + file);
    if (t.start == null) t.start = key;
    // Rows must be contiguous (days/months step 1, lengths step 0.1) so index = (key - start) / step.
    if (prev[sex] != null) { const step = Math.round((key - prev[sex]) * 10) / 10; if (step !== 1 && step !== 0.1) throw new Error(`gap in ${file} at ${sex}/${key}`); }
    prev[sex] = key;
    t.l.push(Number(c[iL])); t.m.push(Number(c[iM])); t.s.push(Number(c[iS]));
  });
  return out;
}
const gs = (f) => join(anthro, "data-raw/growthstandards", f);
const gp = (f) => join(anthroplus, "data-raw/growthstandards", f);
const out = {
  schema: 1,
  source: {
    standards: { org: "WHO", title: "WHO Child Growth Standards (2006): length/height, weight, BMI, head and arm circumference for age; weight for length/height", url: "https://www.who.int/tools/child-growth-standards" },
    reference: { org: "WHO", title: "WHO Growth Reference 2007 for 5 to 19 years: height, weight and BMI for age", url: "https://www.who.int/tools/growth-reference-data-for-5to19-years" },
    method: "LMS z-scores with WHO's restricted application beyond +/-3 SD for weight-based indicators, as implemented in WHO's anthro / anthroplus packages",
    obtained: "WHO official R packages anthro and anthroplus (data-raw/growthstandards), values identical to the who.int expanded tables"
  },
  // unit: "day" (age in days), "cm" (length/height, step 0.1), "month" (age in months)
  wfa: { unit: "day", ...table(gs("weianthro.txt"), "age") },
  lhfa: { unit: "day", ...table(gs("lenanthro.txt"), "age") },
  hcfa: { unit: "day", ...table(gs("hcanthro.txt"), "age") },
  bfa: { unit: "day", ...table(gs("bmianthro.txt"), "age") },
  acfa: { unit: "day", ...table(gs("acanthro.txt"), "age") },
  wfl: { unit: "cm", ...table(gs("wflanthro.txt"), "length") },
  wfh: { unit: "cm", ...table(gs("wfhanthro.txt"), "height") },
  hfa07: { unit: "month", ...table(gp("hfawho2007.txt"), "age") },
  wfa07: { unit: "month", ...table(gp("wfawho2007.txt"), "age") },
  bfa07: { unit: "month", ...table(gp("bfawho2007.txt"), "age") }
};
mkdirSync(join(ROOT, "kb/growth"), { recursive: true });
const file = join(ROOT, "kb/growth/who-growth.json");
writeFileSync(file, JSON.stringify(out) + "\n");
const sizes = Object.keys(out).filter((k) => out[k].unit).map((k) => `${k}:${out[k]["1"].l.length}/${out[k]["2"].l.length}`);
console.log("Wrote kb/growth/who-growth.json", sizes.join(" "));
