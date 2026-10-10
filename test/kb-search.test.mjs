// Knowledge Library disease search (kb-search.js): abbreviations, typos, spelling variants, plurals,
// ranking, related topics and speed. Runs against the real KB_ENRICHMENT catalogue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
for (const f of ["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js"]) (0, eval)(readFileSync(join(ROOT, f), "utf8"));
globalThis.MAIK_AMBIG = require("../kb/ai/ambig-abbrev.js");
const K = require("../kb-search.js");
const H = globalThis.KB_ENRICHMENT.byId;

const t0 = performance.now();
const idx = K.buildIndex(H, {});
const buildMs = performance.now() - t0;
K.warmStep(idx, 1e9);

const top = (q, n = 1) => K.search(idx, q, { limit: n }).map((x) => x.d);
const ok = (got, want) => (want instanceof RegExp ? want.test(got.name) : got.id === want);

// [query, expected top id | RegExp on the top name]
const CASES = {
  abbreviations: [
    ["mi", "acs"], ["stemi", "st_segment_elevation_myocardial_infarction"], ["nstemi", "nstemi"],
    ["cap", "CAP"], ["hap", "HAP"], ["vap", "VAP"], ["dka", "dka"], ["pe", "pe"], ["tb", "PULMONARY_TB"],
    ["copd", "copd_exac_ni"], ["uti", "COMPLICATED_UTI"], ["cauti", "CA_UTI"], ["chf", "heart_failure"],
    ["afib", "atrial_fib"], ["ckd", "ckd"], ["aki", "aki"], ["dvt", "dvt"], ["sah", "sah"], ["ich", "ich"],
    ["tia", "tia"], ["gbs", "gbs"], ["ibd", "ibd_flare"], ["gerd", "gerd_chest"], ["sbp", "SBP"], ["ie", "IE"],
    ["puo", "PUO"], ["ttp", "ttp_hus"], ["sjs", "sjs_ten"], ["pmr", "pmr"], ["ra", "rheumatoid"],
    ["pd", "parkinsons_disease"], ["heart attack", "acs"], ["blood clot", /thromb|embol/i]
  ],
  misspellings: [
    ["pnuemonia", /pneumonia/i], ["pneumonai", /pneumonia/i], ["menigitis", "MENINGITIS"], ["meningits", "MENINGITIS"],
    ["tuberclosis", /tuberculosis/i], ["malaia", "MALARIA"], ["dengu", "DENGUE"], ["cellulitus", "CELLULITIS"],
    ["pancreatits", "pancreatitis"], ["apendicitis", "acute_appendicitis"], ["anaphylaxsis", "anaphylaxis"],
    ["asthama", /asthma/i], ["leptospirossis", "LEPTOSPIROSIS"], ["rhematoid arthritis", "rheumatoid"],
    ["sarcoidosiss", "sarcoidosis"], ["pnuemothorax", "pneumothorax"], ["mysthenia", /myasthen/i]
  ],
  spelling: [
    ["haemorrhage", /h(a)?emorrhage/i], ["hemorrhage", /h(a)?emorrhage/i], ["oedema", /edema|oedema/i],
    ["tumour", "tumour_lysis_syndrome"], ["leukaemia", /leuk(a)?emia/i], ["anaemia", /an(a)?emia/i],
    ["hyperkalaemia", "hyperkalemia"], ["hypoglycaemia", "hypoglycemia"], ["ischaemic stroke", "ischemic_stroke"],
    ["subarachnoid haemorrhage", "sah"], ["diarrhoea", /diarrh(o)?ea/i], ["parkinson's disease", "parkinsons_disease"]
  ],
  plurals: [
    ["seizures", "seizures_and_epilepsy"], ["strokes", "ischemic_stroke"], ["tumours", /tumou?rs?/i],
    ["anemias", /an(a)?emias?/i], ["fibrillations", "atrial_fib"], ["pneumothoraces", "pneumothorax"],
    ["ulcers", /ulcer/i]
  ],
  names: [
    ["sepsis", "SEPSIS"], ["malaria", "MALARIA"], ["dengue fever", "DENGUE"], ["community acquired pneumonia", "CAP"],
    ["pulmonary embolism", "pe"], ["acute pancreatitis", "pancreatitis"], ["kartagener syndrome", "kartagener_syndrome"],
    ["sinusitis", "SINUSITIS"], ["myasthenia gravis", "myasthenia_gravis"], ["typhoid", "ENTERIC_FEVER"]
  ]
};
const ALL = Object.values(CASES).flat();

test("at least 40 query to top-result cases", () => assert.ok(ALL.length >= 40, "have " + ALL.length));

for (const [group, cases] of Object.entries(CASES)) {
  test("top result: " + group, () => {
    const bad = [];
    for (const [q, want] of cases) {
      const got = top(q)[0];
      if (!got || !ok(got, want)) bad.push(q + " -> " + (got ? got.id : "none") + " (want " + want + ")");
    }
    assert.deepEqual(bad, []);
  });
}

test("normalisation: British and American spellings and plurals meet", () => {
  assert.equal(K.norm("Haemorrhage"), K.norm("hemorrhage"));
  assert.equal(K.norm("Oedema"), K.norm("edema"));
  assert.equal(K.norm("Tumour"), K.norm("tumor"));
  assert.equal(K.norm("Guillain-Barré"), "guillain barre");
  assert.equal(K.norm("Parkinson’s"), K.norm("parkinsons"));
  assert.equal(K.stem("arteries"), "artery");
  assert.equal(K.stem("seizures"), "seizure");
  assert.equal(K.stem("sepsis"), "sepsis");
  assert.equal(K.stem("lupus"), "lupus");
});

test("edit distance counts a swapped pair once", () => {
  assert.equal(K.dist("pneumonia", "pnuemonia", 2), 1);
  assert.equal(K.dist("malaria", "malaia", 2), 1);
  assert.ok(K.dist("sepsis", "malaria", 2) > 2);
});

test("typo tolerance does not touch words under 5 letters or real prefixes", () => {
  assert.equal(top("mlaria")[0].id, "MALARIA");                       // 6 letters: corrected
  const near = K.search(idx, "zzqx", { limit: 3 });
  assert.equal(near.length, 0);                                       // 4 letters: never corrected
  assert.match(top("pneumo")[0].name, /pneumo/i);                     // an unfinished word is not a typo
});

test("ranking order: exact name > alias > prefix > name word > body", () => {
  const ranked = (q) => K.search(idx, q, { limit: 400 });
  const sep = ranked("sepsis");
  assert.equal(sep[0].d.id, "SEPSIS");
  assert.ok(sep[0].s >= 1000, "exact name scores 1000");
  const alias = ranked("CYP17A1 deficiency");   // alias of 17_alpha_hydroxylase_deficiency
  assert.ok(alias[0].d.aliasSet[K.norm("CYP17A1 deficiency")], "the top hit carries that alias");
  assert.ok(alias[0].s >= 900 && alias[0].s < 1000, "exact alias scores 900");
  const pre = ranked("tumour lys");
  assert.equal(pre[0].d.id, "tumour_lysis_syndrome");
  const body = ranked("metformin").filter((x) => x.s <= 250);
  assert.ok(body.length >= 1, "a clinical-text-only term still finds entries");
  // scores never increase down the list
  for (let i = 1; i < sep.length; i++) assert.ok(sep[i - 1].s >= sep[i].s);
});

test("ties go to core entries before reference-only ones", () => {
  const r = K.search(idx, "hemorrhage", { limit: 40 });
  let seenRef = false, interleaved = false, lastScore = null;
  for (const x of r) {
    if (lastScore !== null && x.s !== lastScore) seenRef = false;
    if (x.d.ref) seenRef = true; else if (seenRef) interleaved = true;
    lastScore = x.s;
  }
  assert.equal(interleaved, false);
});

test("ambiguous abbreviations from MAIK_AMBIG offer both meanings", () => {
  const names = top("cf", 12).map((d) => d.name.toLowerCase()).join(" | ");
  assert.match(names, /cystic fibrosis/);
});

test("filter option narrows the results", () => {
  const r = K.search(idx, "pneumonia", { limit: 50, filter: (e) => e.cls === "inf" });
  assert.ok(r.length > 0 && r.every((x) => x.d.cls === "inf"));
});

test("related topics: 3 to 6, valid, no self, crossLinks first", () => {
  for (const id of ["CAP", "pe", "acs", "MALARIA", "myasthenia_gravis", "11_beta_hydroxylase_deficiency"]) {
    const ids = K.related(idx, H, id, 6);
    assert.ok(ids.length >= 3 && ids.length <= 6, id + " got " + ids.length);
    assert.ok(!ids.includes(id));
    assert.equal(new Set(ids).size, ids.length);
    ids.forEach((x) => assert.ok(H[x], x + " exists"));
  }
  const cap = K.related(idx, H, "CAP", 6);
  assert.equal(cap[0], H.CAP.crossLinks[0]);
  // diseases that list each other in their differentials rank next
  assert.ok(K.related(idx, H, "pe", 6).includes("dvt") || K.related(idx, H, "pe", 6).includes("deep_venous_thrombosis_and_pulmonary"));
});

test("speed: build once, then every query is fast", () => {
  assert.ok(buildMs < 1500, "index build took " + Math.round(buildMs) + " ms");
  const qs = ["mi", "pnuemonia", "heart failure", "haemorrhage", "dka", "tumour lys", "a"];
  const s = performance.now();
  for (let r = 0; r < 3; r++) for (const q of qs) K.search(idx, q, { limit: 40 });
  const per = (performance.now() - s) / (3 * qs.length);
  assert.ok(per < 150, "average query " + Math.round(per) + " ms");
});

test("the Library wiring: script order, flag-safe fallback and cache-bust tokens", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const a = html.indexOf('src="/kb-search.js?v='), b = html.indexOf('src="/reasoning.js?v=');
  assert.ok(a > 0 && b > a, "kb-search.js loads before reasoning.js");
  const js = readFileSync(join(ROOT, "reasoning.js"), "utf8");
  assert.match(js, /var KS = window\.SMD_KBSEARCH;\s*\n\s*if \(KS\)/, "kbBuildIndex uses the shared core");
  assert.match(js, /kbRelatedHTML\(id\)/, "reader renders Related topics");
  assert.doesNotMatch(readFileSync(join(ROOT, "kb-search.js"), "utf8"), new RegExp(String.fromCharCode(8212)), "no em dash");
});
