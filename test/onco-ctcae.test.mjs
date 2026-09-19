/* Phase 8 P2 unit tests: the CTCAE grading ENGINE (onco-ctcae.js) is a structured, versioned reader
 * over kb/onco/ctcae/catalog.json that NEVER emits fabricated grading content. It returns an honest
 * marked-gap for the un-seeded v4.03 edition and for un-seeded adverse events, the version toggle
 * resolves correctly, and its fabrication auditor FAILS CLOSED on any seeded value that is unflagged,
 * un-cited or present-but-empty. The real catalog.json is loaded from disk and checked for accuracy of
 * shape (curated set, every grade a string or an honest null, every AE cited to CTCAE v5.0).
 * node --test test/onco-ctcae.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

global.window = global;
if (!global.document) global.document = { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; }, body: { appendChild() {} } };

const ENG = require(join(ROOT, "onco-ctcae.js"));
const catalog = JSON.parse(readFileSync(join(ROOT, "kb", "onco", "ctcae", "catalog.json"), "utf8"));

const EXPECTED_AES = [
  "neutrophil_count_decreased", "anemia", "platelet_count_decreased", "febrile_neutropenia",
  "nausea", "vomiting", "diarrhea", "mucositis_oral", "fatigue", "peripheral_sensory_neuropathy",
  "alt_increased", "ast_increased", "creatinine_increased", "rash_maculopapular"
];

test("gap message is a fixed string, shared by the engine and the catalog", () => {
  assert.equal(ENG.GAP_MESSAGE, "Consult the full NCI CTCAE v5.0. This adverse event (or grade) is not seeded in StewardMD.");
  assert.equal(catalog.gapMessage, ENG.GAP_MESSAGE);
});

test("resolve(): seeded v5.0 and v4.03 -> seeded; unknown/null -> gap", () => {
  assert.equal(ENG.resolve(catalog, "CTCAE v5.0").status, "seeded");
  assert.equal(ENG.resolve(catalog, "CTCAE v4.03").status, "seeded");
  assert.equal(ENG.resolve(catalog, "CTCAE v9.9").status, "gap");
  assert.equal(ENG.resolve(null, "CTCAE v5.0").status, "gap");
  assert.equal(ENG.resolve({}, "CTCAE v5.0").status, "gap");
});

test("version toggle: both v5.0 and v4.03 are seeded with official NCI provenance", () => {
  assert.ok(catalog.versions.length >= 2);
  const seeded = catalog.versions.filter((v) => v.seeded);
  assert.ok(seeded.some((v) => v.version === "CTCAE v5.0"));
  assert.ok(seeded.some((v) => v.version === "CTCAE v4.03"));
  assert.equal(ENG.resolveVersion(catalog, "CTCAE v5.0").version, "CTCAE v5.0");
  assert.equal(ENG.resolveVersion(catalog, "CTCAE v4.03").version, "CTCAE v4.03");
  assert.equal(ENG.resolveVersion(catalog, "nope"), null);
});

test("the seeded catalog PASSES the fabrication auditor (every AE R1-flagged + CTCAE-cited)", () => {
  const res = ENG.auditFabricationSafe(catalog);
  assert.ok(res.ok, "catalog failed the audit: " + JSON.stringify(res.problems));
});

test("the seeded set covers comprehensive common chemo/IO/targeted therapy AEs", () => {
  const ids = catalog.aes.map((a) => a.id);
  assert.ok(ids.length >= 35, "expected expanded comprehensive AE catalog: " + ids.length);
  EXPECTED_AES.forEach((id) => {
    assert.ok(ids.includes(id), "must include core AE: " + id);
  });
});

test("every seeded grade is EITHER a non-empty string OR an honest null (never invented, never empty)", () => {
  catalog.aes.forEach((ae) => {
    assert.equal(ae.requiresR1Verification, true, ae.id + " must be R1-flagged");
    assert.match(ae.source, /CTCAE v(4\.03|5\.0)/, ae.id + " must cite CTCAE");
    ["1", "2", "3", "4", "5"].forEach((k) => {
      assert.ok(Object.prototype.hasOwnProperty.call(ae.grades, k), ae.id + " missing grade " + k);
      const v = ae.grades[k];
      assert.ok(v === null || (typeof v === "string" && v.trim().length > 0), ae.id + " grade " + k + " must be a non-empty string or null");
    });
    if (ae.grades_v4) {
      ["1", "2", "3", "4", "5"].forEach((k) => {
        assert.ok(Object.prototype.hasOwnProperty.call(ae.grades_v4, k), ae.id + " missing v4 grade " + k);
        const v4 = ae.grades_v4[k];
        assert.ok(v4 === null || (typeof v4 === "string" && v4.trim().length > 0), ae.id + " v4 grade " + k + " must be a non-empty string or null");
      });
    }
  });
});

test("findAE returns the AE; null grades (CTCAE 'not defined at this grade') are permitted, not a gap", () => {
  const fat = ENG.findAE(catalog, "fatigue");
  assert.ok(fat && fat.grades["1"] && fat.grades["4"] === null && fat.grades["5"] === null);
  const fn = ENG.findAE(catalog, "febrile_neutropenia");
  assert.ok(fn.grades["1"] === null && fn.grades["2"] === null && typeof fn.grades["3"] === "string");
  assert.equal(ENG.findAE(catalog, "not_a_real_ae"), null);
});

test("auditAE FAILS CLOSED if a grade is present-but-empty (missing value, not an honest null)", () => {
  const bad = JSON.parse(JSON.stringify(ENG.findAE(catalog, "nausea")));
  bad.grades["1"] = "   ";
  assert.equal(ENG.auditAE(bad).ok, false);
});

test("auditAE FAILS CLOSED if the source is not CTCAE (R1 gate removed per owner directive)", () => {
  const b = JSON.parse(JSON.stringify(ENG.findAE(catalog, "anemia")));
  b.source = "made up";
  assert.equal(ENG.auditAE(b).ok, false);
});

test("auditFabricationSafe FAILS CLOSED if any AE grade key is deleted entirely", () => {
  const bad = JSON.parse(JSON.stringify(catalog));
  delete bad.aes[0].grades["3"];
  assert.equal(ENG.auditFabricationSafe(bad).ok, false);
});
