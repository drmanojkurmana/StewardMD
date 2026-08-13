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
  assert.equal(ENG.GAP_MESSAGE, "Staging content pending licensed AJCC data + R1 sign-off");
  assert.equal(index.gapMessage, ENG.GAP_MESSAGE);
});

test("resolve(): seeded version -> seeded; un-seeded version -> honest gap", () => {
  const seeded = ENG.resolve(breast, "AJCC 8th");
  assert.equal(seeded.status, "seeded");
  assert.ok(seeded.version && seeded.version.t && seeded.version.stageGroups);
  const gap = ENG.resolve(breast, "AJCC 7th");
  assert.equal(gap.status, "gap");
  assert.equal(gap.message, ENG.GAP_MESSAGE);
});

test("resolve(): unknown site/version and null input all fall to a marked gap (never a fabricated table)", () => {
  assert.equal(ENG.resolve(breast, "AJCC 9th").status, "gap");
  assert.equal(ENG.resolve(null, "AJCC 8th").status, "gap");
  assert.equal(ENG.resolve(undefined).status, "gap");   // gap-only site (no file loaded)
  assert.equal(ENG.resolve({}, "AJCC 8th").status, "gap");
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

test("seeded stage groups use ONLY the universally-true rows (0, I, IV) — no invented II/III boundaries", () => {
  const v = ENG.resolve(breast, "AJCC 8th").version;
  const stages = v.stageGroups.map((g) => g.stage).sort();
  assert.deepEqual(stages, ["0", "I", "IV"]);
  v.stageGroups.forEach((g) => assert.ok(ENG.ALLOWED_STAGES[g.stage], "unexpected stage " + g.stage));
  assert.ok(v.partial === true && v.gapNote, "a scaffold must mark the II/III gap explicitly");
});

test("auditor FAILS CLOSED if a forbidden (site-specific) stage group is injected", () => {
  const bad = JSON.parse(JSON.stringify(breast));
  bad.versions[0].stageGroups.push({ stage: "IIA", t: "T2", n: "N0", m: "M0", basis: "x", requiresR1Verification: true });
  const res = ENG.auditFabricationSafe(bad);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /IIA|not a universally-true/.test(p)));
});

test("auditor FAILS CLOSED if any seeded value is not flagged requiresR1Verification", () => {
  const bad = JSON.parse(JSON.stringify(lung));
  bad.versions[0].t[3].requiresR1Verification = false;
  assert.equal(ENG.auditFabricationSafe(bad).ok, false);
});

test("no proprietary/site-specific measurement content leaked into scaffold labels (honesty heuristic)", () => {
  Object.keys(SCAFFOLDS).forEach((k) => {
    const v = SCAFFOLDS[k].versions[0];
    [].concat(v.t, v.n, v.m).forEach((row) => {
      assert.ok(!/\d\s?cm\b/i.test(row.label), k + " leaked a size cut-off: " + row.label);
      assert.ok(!/\b\d+\s+(nodes?|lymph)/i.test(row.label), k + " leaked a node count: " + row.label);
    });
    // every seeded version carries a provenance string that names the R1/AJCC-licence gap
    v.provenance && assert.ok(/R1|licensed AJCC/i.test(v.provenance), k + " provenance must name the R1/AJCC gap");
  });
});

test("index lists gap-only sites with status 'gap' (a real, visible content gap, not a fabricated table)", () => {
  const gapSites = index.sites.filter((s) => s.status === "gap");
  assert.ok(gapSites.length >= 1, "expected at least one honest gap site");
  gapSites.forEach((s) => assert.ok(!s.file, "a gap site must not ship a staging file: " + s.id));
  const scaffoldSites = index.sites.filter((s) => s.status === "scaffold");
  assert.ok(scaffoldSites.length >= 2 && scaffoldSites.length <= 4, "seed a SMALL set (2-4) of scaffold sites");
});
