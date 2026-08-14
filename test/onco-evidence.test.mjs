/* ONCQIS Phase C unit tests: onco-evidence.js pure helpers.
 *   _whyDiffer(a,b) -> a STRUCTURED diff (per-field standard vs guideline), never reconciles.
 *   _divergenceModel(entry) -> resolution ALWAYS clinical-review-required, selection ALWAYS null.
 *   recordChoice / recordDivergenceSelection -> RECORD a physician choice, NEVER auto-apply/reconcile.
 * No en/em dashes in any app-facing string. node --test test/onco-evidence.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EV = require(join(ROOT, "onco-evidence.js"));

test("existing exports still work (no regression)", () => {
  assert.equal(typeof EV.build, "function");
  assert.equal(typeof EV.forCalculator, "function");
  assert.equal(EV.build([]), "");
});

test("_whyDiffer produces a structured per-field diff", () => {
  const a = { name: "FOLFOX-6", drugs: ["Oxaliplatin", "Leucovorin", "Fluorouracil"], version: "1.0", source: "DeVita 12th ed" };
  const b = { name: "FOLFOXIRI", drugs: ["Oxaliplatin", "Leucovorin", "Fluorouracil", "Irinotecan"], version: "2.0", source: "NCCN Colon" };
  const wd = EV._whyDiffer(a, b);
  assert.equal(wd.differs, true);
  assert.ok(Array.isArray(wd.fields));
  const byField = {};
  wd.fields.forEach((f) => { byField[f.field] = f; });
  assert.ok(byField["regimen name"] && byField["regimen name"].standard === "FOLFOX-6" && byField["regimen name"].guideline === "FOLFOXIRI");
  assert.ok(byField["drugs"], "drugs field diff present");
  assert.deepEqual(byField["drugs"].added, ["Irinotecan"]);
  assert.deepEqual(byField["drugs"].removed, []);
  assert.ok(byField["version"] && byField["source"]);
  assert.ok(/review/i.test(wd.summary));
  assert.ok(!/[–—]/.test(wd.summary), "no en/em dashes");
});

test("_whyDiffer on identical descriptors -> no differences but review still required", () => {
  const a = { name: "R-CHOP", drugs: ["Rituximab", "Cyclophosphamide"], version: "1.0", source: "DeVita" };
  const wd = EV._whyDiffer(a, { ...a, drugs: a.drugs.slice() });
  assert.equal(wd.differs, false);
  assert.deepEqual(wd.fields, []);
  assert.ok(/review/i.test(wd.summary));
});

test("_divergenceModel always marks clinical-review-required and never pre-selects", () => {
  // Even if a caller tried to smuggle a resolution/selection in, the model forces review-required.
  const entry = { field: "cycleLengthDays", sources: [{ name: "DeVita 12th ed", version: "12", value: 21 }, { name: "NCCN", version: "3.2026", value: 28 }], note: "Cycle length differs.", resolution: "resolved", selection: 1 };
  const m = EV._divergenceModel(entry);
  assert.equal(m.resolution, "clinical-review-required");
  assert.equal(m.reviewRequired, true);
  assert.equal(m.selection, null, "never auto-resolved");
  assert.equal(m.field, "cycleLengthDays");
  assert.equal(m.sources.length, 2);
  assert.ok(m.difference && m.difference.length > 0);
});

test("recordChoice returns the physician choice and applies NOTHING", () => {
  ["continue", "select", "review"].forEach((c) => {
    const r = EV.recordChoice(c);
    assert.equal(r.choice, c);
    assert.equal(r.applied, false);
    assert.equal(r.autoApplied, false);
    assert.equal(r.reviewRequired, true);
  });
});

test("recordDivergenceSelection records a source, never auto-reconciles", () => {
  const entry = { field: "cycleLengthDays", sources: [{ name: "DeVita", value: 21 }, { name: "NCCN", value: 28 }] };
  const r = EV.recordDivergenceSelection(entry, 1);
  assert.equal(r.field, "cycleLengthDays");
  assert.equal(r.selected, "NCCN");
  assert.equal(r.sourceIndex, 1);
  assert.equal(r.applied, false);
  assert.equal(r.autoReconciled, false);
  assert.equal(r.resolution, "clinical-review-required");
  // no selection index -> nothing chosen, still review-required
  const none = EV.recordDivergenceSelection(entry, null);
  assert.equal(none.selected, null);
  assert.equal(none.resolution, "clinical-review-required");
});

test("renderEvidenceLayers renders all 3 layers and core is independent of guideline", () => {
  const protocol = {
    name: "FOLFOX-6",
    evidence: {
      core: [{ layer: "core", source: "DeVita 12th ed", version: "12", date: "2023", evidenceStatus: "current" }],
      guideline: [{ layer: "guideline", source: "NCCN Colon", version: "3.2026", date: "2026-05", evidenceStatus: "current" }],
      institutional: [{ hospitalId: "H1", source: "Tumour Board Policy", version: "2026.1", approvedBy: "Dr X", date: "2026-06" }]
    }
  };
  const html = EV.renderEvidenceLayers(protocol);
  assert.ok(/Core Evidence/.test(html) && /Current Guideline/.test(html) && /Institutional/.test(html));
  assert.ok(/DeVita 12th ed/.test(html) && /NCCN Colon/.test(html) && /Tumour Board Policy/.test(html));
  // core row does not contain the guideline source (layers not flattened)
  const coreBlock = html.split("Current Guideline")[0];
  assert.ok(/DeVita/.test(coreBlock) && !/NCCN/.test(coreBlock), "core layer is not mutated by guideline");
  assert.ok(!/[–—]/.test(html), "no en/em dashes");
});

test("renderUpdateAvailable shows both regimens and all 3 actions, applies nothing", () => {
  const protocol = { name: "FOLFOX-6", protocolVersion: "1.0", regimen: { drugs: [{ name: "Oxaliplatin" }] }, evidence: { core: [{ layer: "core", source: "DeVita" }] } };
  const ge = { source: "NCCN Colon", version: "3.2026", regimen: { name: "FOLFOXIRI", drugs: [{ name: "Oxaliplatin" }, { name: "Irinotecan" }] } };
  const html = EV.renderUpdateAvailable(protocol, ge);
  assert.ok(/UPDATE AVAILABLE/.test(html));
  assert.ok(/Current StewardMD Standard Protocol/.test(html) && /Current guideline/.test(html));
  assert.ok(/CONTINUE STANDARD PROTOCOL/.test(html) && /SELECT UPDATED REGIMEN/.test(html) && /REVIEW EVIDENCE/.test(html));
  assert.ok(/never auto-applies/i.test(html));
  assert.ok(!/[–—]/.test(html), "no en/em dashes");
});
