/* Phase 8 P1 unit tests: the AJCC/TNM staging ENGINE (onco-staging.js) is a structured, versioned
 * reader that NEVER emits fabricated staging content. It returns an honest marked-gap for un-seeded
 * sites/versions, the version toggle resolves correctly, and its fabrication auditor fails closed on
 * any seeded value that is unflagged or that uses a non-universal (site-specific) stage group.
 * The real kb/onco/staging/*.json scaffold files are loaded from disk and checked.
 * node --test test/onco-staging.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const STG = join(ROOT, "kb", "onco", "staging");

global.window = global;
if (!global.document) global.document = { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; }, body: { appendChild() {} } };

const ENG = require(join(ROOT, "onco-staging.js"));
const readJson = (f) => JSON.parse(readFileSync(join(STG, f), "utf8"));
const index = readJson("index.json");
const breast = readJson("breast.json");
const colorectal = readJson("colorectal.json");
const lung = readJson("lung.json");
const SCAFFOLDS = { breast, colorectal, lung };

test("the honest gap message is a fixed, exact string (matches the index)", () => {
  assert.equal(ENG.GAP_MESSAGE, "Staging for this cancer site is being added.");
  assert.equal(index.gapMessage, ENG.GAP_MESSAGE);
});

test("resolve(): seeded version -> seeded; un-seeded version -> honest gap", () => {
  const seeded = ENG.resolve(breast, "8th edition");
  assert.equal(seeded.status, "seeded");
  assert.ok(seeded.version && seeded.version.t && seeded.version.stageGroups);
  const gap = ENG.resolve(breast, "7th edition");
  assert.equal(gap.status, "gap");
  assert.equal(gap.message, ENG.GAP_MESSAGE);
});

test("resolve(): unknown site/version and null input all fall to a marked gap (never a fabricated table)", () => {
  assert.equal(ENG.resolve(breast, "9th edition").status, "gap");
  assert.equal(ENG.resolve(null, "8th edition").status, "gap");
  assert.equal(ENG.resolve(undefined).status, "gap");   // gap-only site (no file loaded)
  assert.equal(ENG.resolve({}, "8th edition").status, "gap");
});

test("version toggle: every scaffold file exposes >1 version, with at least one seeded and one gap", () => {
  Object.keys(SCAFFOLDS).forEach((k) => {
    const f = SCAFFOLDS[k];
    assert.ok(f.versions.length >= 2, k + " needs >=2 versions for a real toggle");
    assert.ok(f.versions.some((v) => v.seeded), k + " needs a seeded version");
    assert.ok(f.versions.some((v) => !v.seeded), k + " needs a gap version (to prove honest gaps in the toggle)");
    // resolveVersion finds the right object by name
    const first = f.versions[0];
    assert.equal(ENG.resolveVersion(f, first.version).version, first.version);
    assert.equal(ENG.resolveVersion(f, "nope"), null);
  });
});

test("fabrication auditor PASSES on the real scaffolds: every seeded T/N/M/stage row is R1-flagged", () => {
  Object.keys(SCAFFOLDS).forEach((k) => {
    const res = ENG.auditFabricationSafe(SCAFFOLDS[k]);
    assert.ok(res.ok, k + " failed the fabrication audit: " + JSON.stringify(res.problems));
  });
});

test("seeded stage groups render full site-specific stages; each row has a complete T/N/M mapping", () => {
  // Auditor relaxed per owner directive: site-specific stages (II/III and sub-stages) are now allowed;
  // the safety boundary is STRUCTURAL (every stage row must map T + N + M).
  const v = ENG.resolve(breast, "8th edition").version;
  assert.ok(v.stageGroups.length >= 3, "expected real stage grouping rows");
  v.stageGroups.forEach((g) => {
    assert.ok(g.stage && g.t && g.n && g.m, "stage row must map T/N/M: " + JSON.stringify(g));
  });
});

test("auditor FAILS CLOSED on a structurally incomplete stage row (missing T/N/M mapping)", () => {
  const bad = JSON.parse(JSON.stringify(breast));
  bad.versions[0].stageGroups.push({ stage: "IIA", n: "N0", m: "M0" });   // missing t
  const res = ENG.auditFabricationSafe(bad);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /IIA/.test(p) && /incomplete/i.test(p)));
});

test("auditor FAILS CLOSED on a T/N/M row missing its code or label", () => {
  const bad = JSON.parse(JSON.stringify(lung));
  bad.versions[0].t[3].label = "";
  assert.equal(ENG.auditFabricationSafe(bad).ok, false);
});

test("every seeded version names its source + the R1/licensed verification gap in provenance", () => {
  Object.keys(SCAFFOLDS).forEach((k) => {
    const v = SCAFFOLDS[k].versions[0];
    assert.ok(v.provenance && /R1|licensed|verification/i.test(v.provenance), k + " provenance must name the R1/licensed verification gap");
  });
});

test("index lists gap-only sites with status 'gap' (a real, visible content gap, not a fabricated table)", () => {
  const gapSites = index.sites.filter((s) => s.status === "gap");
  gapSites.forEach((s) => assert.ok(!s.file, "a gap site must not ship a staging file: " + s.id));
  const scaffoldSites = index.sites.filter((s) => s.status === "scaffold");
  assert.ok(scaffoldSites.length >= 2, "expected the seeded staging sites");
});
