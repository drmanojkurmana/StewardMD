/* test/opd-scribe-ground-wire.test.mjs — opd-emr groundOpts/differentialFor wiring.
 * Confirms the AI scribe's differential + investigations are now ENGINE-ANCHORED (not LLM-only),
 * that the DX-engine adapter is PURE (never mutates the live reasoning workspace S.f), and that
 * ground() tags engine entries source:"engine" while still merging LLM-only entries as source:"ai".
 * node --test test/opd-scribe-ground-wire.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OPD = require("../opd-emr.js");
const GROUND = require("../voice-scribe-ground.js");

function stubEngine() {
  globalThis.DX = {
    _state: { f: {} },
    findingCatalog: () => [{ key: "fever", label: "Fever" }, { key: "splenomegaly", label: "Splenomegaly" }],
    _differential: () => ({
      inf: [{ name: "Malaria", score: 82, inv: ["Peripheral smear", "Rapid malaria antigen"] }],
      ni: [{ name: "Lymphoma", score: 40, inv: [] }]
    })
  };
  globalThis.SMD_NLP = { extract: () => ({ present: ["fever", "splenomegaly"] }) };
}
function clearEngine() { delete globalThis.DX; delete globalThis.SMD_NLP; }

test("groundOpts: findings from SMD_NLP + engine-anchored differential + investigations", () => {
  stubEngine();
  try {
    const o = OPD._groundOpts("fever with chills and a big spleen");
    assert.deepEqual(o.findings, ["fever", "splenomegaly"]);
    assert.deepEqual(o.differential(), [{ dx: "Malaria", score: 82 }, { dx: "Lymphoma", score: 40 }]);
    assert.deepEqual(o.investigationsFor("Malaria"), ["Peripheral smear", "Rapid malaria antigen"]);
    assert.deepEqual(o.investigationsFor("Lymphoma"), []);
  } finally { clearEngine(); }
});

test("differentialFor is PURE — restores DX._state.f, never disturbs the live workspace", () => {
  stubEngine();
  try {
    globalThis.DX._state.f = { preexisting: true };   // simulate an open reasoning workspace
    const d = OPD._differentialFor(["fever"]);
    assert.ok(d.length >= 1 && d[0].dx === "Malaria");
    assert.deepEqual(globalThis.DX._state.f, { preexisting: true }, "live S.f must be restored exactly");
  } finally { clearEngine(); }
});

test("ground(): engine ddx tagged source:engine, LLM-only merged as source:ai, engine inv surfaced", () => {
  stubEngine();
  try {
    const opts = OPD._groundOpts("fever, spleen");
    const g = GROUND.ground("fever, spleen", { ddx: ["Dengue", "Malaria"], investigations: ["CBC"] }, opts);
    const by = {}; g.ddx.forEach((d) => { by[d.label.toLowerCase()] = d; });
    assert.equal(by["malaria"].source, "engine", "engine anchors Malaria (not the duplicate LLM one)");
    assert.equal(by["dengue"].source, "ai", "LLM-only Dengue kept as a suggestion");
    assert.ok(g.investigations.some((i) => i.label === "Peripheral smear" && i.source === "engine"));
  } finally { clearEngine(); }
});

test("no engine present => empty grounding (never fabricates)", () => {
  clearEngine();
  const o = OPD._groundOpts("anything");
  assert.deepEqual(o.findings, []);
  assert.deepEqual(o.differential(), []);
  assert.deepEqual(OPD._differentialFor(["fever"]), []);
});
