/* test/fda-label-match.test.mjs - the FDA-label monograph builder must never attach the wrong product.
 * A homeopathic remedy, a veterinary label, or a combination product must not be shown as the monograph of a
 * single molecule. Also checks that the app's slug() matches the builder's slug() exactly (the app fetches
 * data/fda-labels/<slug>.json by the same rule the builder used to write it).
 * node --test test/fda-label-match.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "build-fda-monographs.py");
function py(code) {
  return execFileSync("python3", ["-I", "-c", `import importlib.util,json\nspec=importlib.util.spec_from_file_location('b',${JSON.stringify(SCRIPT)})\nb=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(b)\n${code}`], { encoding: "utf8" }).trim();
}

test("a single-ingredient product of the molecule matches", () => {
  const cases = [["ALECENSA (ALECTINIB HYDROCHLORIDE) CAPSULE [GENENTECH, INC.]", "alectinib"], ["WELIREG (BELZUTIFAN) TABLET [MERCK SHARP & DOHME LLC]", "belzutifan"], ["WARFARIN SODIUM (WARFARIN) TABLET [A-S MEDICATION SOLUTIONS]", "warfarin"]];
  for (const [t, n] of cases) assert.equal(py(`print(b.ingredient_match(${JSON.stringify(t)}, ${JSON.stringify(n)}))`), "True", t);
});

test("homeopathic, veterinary and combination products are refused", () => {
  const cases = [
    ["ACETYLCHOLINE CHLORIDE 1502 (ACETYLCHOLINE CHLORIDE) LIQUID [PROFESSIONAL COMPLEMENTARY HEALTH FORMULAS]", "acetylcholine"],
    ["GUNA-PROSTATE (ALDESLEUKIN - BARIUM CARBONATE - CHASTE TREE) SOLUTION/ DROPS [GUNA SPA]", "aldesleukin"],
    ["THYRO-TABS CANINE (LEVOTHYROXINE SODIUM) TABLET [MWI/VETONE]", "levothyroxine"],
    ["AUGMENTIN ES-600 (AMOXICILLIN AND CLAVULANATE POTASSIUM) FOR SUSPENSION [USANTIBIOTICS, LLC]", "amoxicillin"],
    ["ATOVAQUONE AND PROGUANIL HCL (ATOVAQUONE AND PROGUANIL HYDROCHLORIDE) TABLET [PRASCO]", "atovaquone"],
    ["Some product with no ingredient list [ACME]", "belzutifan"],
  ];
  for (const [t, n] of cases) assert.equal(py(`print(b.ingredient_match(${JSON.stringify(t)}, ${JSON.stringify(n)}))`), "False", t);
});

test("the label must actually name the molecule", () => {
  assert.equal(py(`print(b.label_is_about({'34067-9':'Indicated for ALK-positive NSCLC.'}, 'alectinib'))`), "False");
  assert.equal(py(`print(b.label_is_about({'34067-9':'Indicated for alectinib-treated patients.'}, 'alectinib'))`), "True");
});

test("app slugFor() matches the builder's slug() for every name the builder can write", () => {
  const src = readFileSync(join(ROOT, "offline-clinical.js"), "utf8");
  const m = src.match(/function slugFor\(name\) \{[\s\S]*?\n  \}/);
  assert.ok(m, "slugFor is in offline-clinical.js");
  const slugFor = new Function(m[0].replace("function slugFor", "return function"))();
  const names = ["Alectinib", "Caspofungin acetate", "Amoxicillin/clavulanate", "Vitamin D (ergocalciferol)", "Sodium chloride 0.9%", "Co-trimoxazole", "Levothyroxine sodium"];
  const py_slugs = JSON.parse(py(`import json as j\nprint(j.dumps([b.slug(b.re.sub(r"[^A-Za-z0-9 ._-]", "", n).strip()) for n in ${JSON.stringify(names)}]))`));
  names.forEach((n, i) => assert.equal(slugFor(n), py_slugs[i], n));
});

/* 2026-11-27: the first DailyMed hit for dinoprost was LUTALYSE (cattle) and for moxidectin CYDECTIN
 * (pour-on); neither title says "veterinary". The SPL document type is the reliable signal. */
test("an animal drug label is refused by its SPL document type, whatever the title says", () => {
  const spl = (code) => `<document xmlns="urn:hl7-org:v3"><code code="${code}"/></document>`;
  for (const c of ["50577-6", "50578-4"]) assert.equal(py(`print(b.doc_type(${JSON.stringify(spl(c))}) in b.HUMAN_DOC_TYPES)`), "False", c);
  for (const c of ["34391-3", "34390-5", "60683-0"]) assert.equal(py(`print(b.doc_type(${JSON.stringify(spl(c))}) in b.HUMAN_DOC_TYPES)`), "True", c);
});

test("an older label with uncoded sections is read by its section titles", () => {
  const xml = `<document xmlns="urn:hl7-org:v3"><code code="34391-3"/><component><structuredBody><component><section><code code="42229-5"/><title>INDICATIONS AND USAGE</title><text><paragraph>Indicated for metastatic islet cell carcinoma.</paragraph></text></section></component></structuredBody></component></document>`;
  assert.equal(py(`print(list(b.parse_label(${JSON.stringify(xml)}).keys()))`), "['34067-9']");
});

test("salt words cover lysine and meglumine (LIVDELZI, DOTAREM)", () => {
  assert.equal(py(`print(b.ingredient_match("LIVDELZI (SELADELPAR LYSINE) CAPSULE [GILEAD]", "seladelpar"))`), "True");
  assert.equal(py(`print(b.ingredient_match("DOTAREM (GADOTERATE MEGLUMINE) INJECTION [GUERBET LLC]", "gadoterate"))`), "True");
});
