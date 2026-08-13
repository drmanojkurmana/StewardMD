/* Phase 3 unit tests: the pure matrix/drawer builder (onco-protocols.js) and the opd-emr.js Oncology
 * tab wiring. Both files stay PURE (no DOM, no fetch) so they run headless under node --test. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Requiring onco-protocols.js also sets globalThis.SMD_ONCOUI (its IIFE targets `window ||
// globalThis`), which is exactly how opd-emr.js's oncoTab()/_render() find window.SMD_ONCOUI in
// the browser - so loading order here mirrors the real <script> order in index.html.
const ONCOUI = require(join(ROOT, "onco-protocols.js"));
// Oncology tab is flag-gated; stub the flag ON before opd-emr.js reads it (mirrors the CDP harness).
global.SMD_QUEUE_FLAGS = { bool: function () { return true; } };
const OPDEMR = require(join(ROOT, "opd-emr.js"));

const RCHOP = require(join(ROOT, "kb", "protocols", "rchop.json"));
const DOSE = require(join(ROOT, "onco-dose.js"));

function fixturePlan() {
  var params = { height: 165, weight: 60, age: 55, sex: "female" }; // BSA drives rituximab/cyclo/doxo/vincristine
  var calculatedDoses = DOSE.planDoses(RCHOP, params);
  return {
    planId: "TP-fixture", protocolId: RCHOP.id, lockedVersion: RCHOP.version, lockedTemplate: RCHOP,
    plannedCycles: RCHOP.cycles, calculatedDoses: calculatedDoses, confirmedDoses: [], status: "active"
  };
}

test("_buildOncoMatrix: one row per drug, one cell-button per cycle, carrying data-oe-act=\"onco-cell:<cycleNo>:<drugId>\"", () => {
  const plan = fixturePlan();
  const html = ONCOUI._buildOncoMatrix(plan);
  const drugCount = RCHOP.drugs.length, cycleCount = RCHOP.cycles;

  const rowMatches = html.match(/<tr>/g) || [];
  assert.equal(rowMatches.length, drugCount + 1, "one <tr> per drug plus the header row"); // +1 header <tr>

  const cellMatches = html.match(/data-oe-act="onco-cell:\d+:[^"]+"/g) || [];
  assert.equal(cellMatches.length, drugCount * cycleCount, "one cell-button per drug x cycle");

  RCHOP.drugs.forEach(function (d) {
    for (var c = 1; c <= cycleCount; c++) {
      assert.ok(html.indexOf('data-oe-act="onco-cell:' + c + ':' + d.id + '"') >= 0, "cell present for cycle " + c + " / " + d.id);
    }
    assert.ok(html.indexOf(d.name) >= 0, "drug name rendered: " + d.name);
  });
  assert.ok(html.indexOf("375 mg/m2 IV, D1") >= 0, "dose & administration column renders the static protocol text");
});

test("_buildOncoMatrix escapes drug names (no raw HTML injection)", () => {
  const plan = fixturePlan();
  plan.lockedTemplate = Object.assign({}, RCHOP, { drugs: [Object.assign({}, RCHOP.drugs[0], { name: '<img src=x onerror=alert(1)>' })] });
  const html = ONCOUI._buildOncoMatrix(plan);
  assert.ok(html.indexOf("<img") < 0, "raw tag never lands in the output");
  assert.ok(html.indexOf("&lt;img") >= 0, "escaped instead");
});

test("_buildOncoMatrix never invents a number: a drug with no matched dose renders 'verify'", () => {
  const plan = fixturePlan();
  plan.calculatedDoses = []; // nothing matched
  const html = ONCOUI._buildOncoMatrix(plan);
  assert.ok(html.indexOf(">verify<") >= 0, "unmatched drug cell shows verify, not a guessed number");
});

test("doseDrawerView renders protocol dose, calculation, rounding and the final dose", () => {
  const plan = fixturePlan();
  const rituximabLin = plan.calculatedDoses.filter(function (d) { return d.drugId === "rituximab"; })[0];
  const drawer = { cycleNo: 1, drugId: "rituximab", drug: RCHOP.drugs[0], lineage: rituximabLin };
  const html = ONCOUI.doseDrawerView(drawer);
  const low = html.toLowerCase();
  assert.ok(low.indexOf("protocol dose") >= 0, "shows protocol dose");
  assert.ok(low.indexOf("calculation") >= 0, "shows the calculation");
  assert.ok(low.indexOf("rounding") >= 0, "shows the rounding step");
  assert.ok(low.indexOf("final") >= 0, "shows the final dose");
  assert.ok(html.indexOf(rituximabLin.final + " mg") >= 0, "final confirmed/calculated dose value present");
  assert.ok(html.indexOf('data-oe-act="onco-drawer-close"') >= 0, "close action present");
  assert.ok(low.indexOf("view protocol source") >= 0 && low.indexOf("view audit trail") >= 0, "static affordances present");
});

test("doseDrawerView never invents: no lineage renders verify, not a fabricated dose", () => {
  const html = ONCOUI.doseDrawerView({ cycleNo: 2, drugId: "x", drug: { name: "X" }, lineage: null });
  assert.ok(html.indexOf(">verify<") >= 0);
});

test("opd-emr.js _render (onco tab) includes the matrix and stays pure (no throw)", () => {
  const plan = fixturePlan();
  const state = { tab: "onco", oncoPlan: plan, loading: false, error: "", patient: { name: "Test Patient", mrn: "MR1" } };
  const html = OPDEMR._render(state);
  assert.ok(html.indexOf("oe-onco-tbl") >= 0, "matrix table rendered inside the onco tab");
  assert.ok(html.indexOf('data-oe-act="onco-cell:1:rituximab"') >= 0, "a cell button for cycle 1 / rituximab is present");
});

test("opd-emr.js _render (onco tab, no plan) renders a friendly empty state, no throw", () => {
  const state = { tab: "onco", oncoPlan: null, loading: false, error: "", patient: {} };
  const html = OPDEMR._render(state);
  assert.ok(/no active treatment plan/i.test(html));
});

test("opd-emr.js _render (onco tab, doseDrawer set) overlays the drawer", () => {
  const plan = fixturePlan();
  const lin = plan.calculatedDoses[0];
  const state = { tab: "onco", oncoPlan: plan, loading: false, error: "", patient: {}, doseDrawer: { cycleNo: 1, drugId: lin.drugId, drug: RCHOP.drugs[0], lineage: lin } };
  const html = OPDEMR._render(state);
  assert.ok(html.indexOf("oe-onco-drawer") >= 0, "drawer overlay rendered when st.doseDrawer is set");
});

test("opd-emr.js _render (onco tab) is inert when the flag would be off - covered via oncoTab directly", () => {
  const off = { bool: function () { return false; } };
  const saved = global.SMD_QUEUE_FLAGS;
  global.SMD_QUEUE_FLAGS = off;
  try {
    const html = OPDEMR.oncoTab({ oncoPlan: fixturePlan() });
    assert.ok(/not enabled/i.test(html), "inert 'not enabled' state when the flag is off");
  } finally { global.SMD_QUEUE_FLAGS = saved; }
});
