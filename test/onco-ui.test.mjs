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

/* Phase 4 unit tests: apply-protocol suggestion list, review/override panel, override-needs-reason
 * (both the pure onco-protocols.js builders and their opd-emr.js Assess-tab wiring). RCHOP itself
 * stays lifecycleState "draft" (activation is a separate owner/R1 step) - a FIXTURE active protocol
 * stands in for "some protocol an owner has actually activated". */
function fixtureActiveTemplate() {
  return Object.assign({}, RCHOP, { id: "fixture-active", name: "Fixture Active Protocol", version: "1.0", lifecycleState: "active" });
}

test("_buildApplyPanel offers an ACTIVE protocol and never a draft one (defensive filter)", () => {
  const active = fixtureActiveTemplate();
  const html = ONCOUI._buildApplyPanel([active, RCHOP]);   // RCHOP ships lifecycleState "draft"
  assert.ok(html.indexOf('data-oe-act="onco-apply:' + active.id + '"') >= 0, "the active protocol is offered");
  assert.ok(html.indexOf("onco-apply:" + RCHOP.id) < 0, "the draft protocol (rchop) is never offered");
});

test("_buildApplyPanel offers nothing when there are zero active protocols (matches the real repo today)", () => {
  assert.equal(ONCOUI._buildApplyPanel([RCHOP]), "", "only a draft protocol on file -> nothing offered");
  assert.equal(ONCOUI._buildApplyPanel([]), "");
  assert.equal(ONCOUI._buildApplyPanel(null), "");
});

test("apply-protocol staging produces one calculated line per drug via planDoses", () => {
  const active = fixtureActiveTemplate();
  const params = { height: 165, weight: 60 };
  const calculatedDoses = DOSE.planDoses(active, params);
  assert.equal(calculatedDoses.length, active.drugs.length, "one lineage per template drug");
  const draft = { protocolId: active.id, template: active, params: params, calculatedDoses: calculatedDoses, overrides: [] };
  const html = ONCOUI._buildReviewPanel(draft);
  active.drugs.forEach(function (d) { assert.ok(html.indexOf(d.name) >= 0, "review panel shows " + d.name); });
});

test("_buildReviewPanel renders a 'verify' badge for a line whose lineage.final is null (never-invent)", () => {
  const active = fixtureActiveTemplate();
  const calculatedDoses = DOSE.planDoses(active, {});   // no height/weight -> every BSA drug is non-computable
  const draft = { protocolId: active.id, template: active, params: {}, calculatedDoses: calculatedDoses, overrides: [] };
  const html = ONCOUI._buildReviewPanel(draft);
  assert.ok(html.indexOf(">verify<") >= 0, "a non-computable line shows verify, not a guessed number");
  assert.ok(/class="oe-tag oe-review">verify</.test(html), "the verify state carries the review badge, same style as the rest of the AI-assist UI");
});

test("_stageOverride rejects an override with no reason", () => {
  assert.equal(ONCOUI._stageOverride([], { drugId: "rituximab", was: 700, now: 600, reason: "" }), null);
  assert.equal(ONCOUI._stageOverride([], { drugId: "rituximab", was: 700, now: 600, reason: "   " }), null);
  assert.equal(ONCOUI._stageOverride([], { drugId: "rituximab", was: 700, now: 600 }), null);
});

test("_stageOverride records {drugId,was,now,reason} once a reason is given, and replaces a prior override for the same drug", () => {
  const first = ONCOUI._stageOverride([], { drugId: "rituximab", was: 700, now: 600, reason: "Renal impairment" });
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { drugId: "rituximab", was: 700, now: 600, reason: "Renal impairment" });
  const second = ONCOUI._stageOverride(first, { drugId: "rituximab", was: 700, now: 650, reason: "Revised after labs" });
  assert.equal(second.length, 1, "same drug replaces, never duplicates");
  assert.equal(second[0].now, 650);
});

test("_buildReviewPanel disables Create & Activate when a staged override is missing a reason (defensive, belt-and-suspenders)", () => {
  const active = fixtureActiveTemplate();
  const params = { height: 165, weight: 60 };
  const draft = { protocolId: active.id, template: active, params: params, calculatedDoses: DOSE.planDoses(active, params), overrides: [{ drugId: "rituximab", was: 700, now: 600, reason: "" }] };
  const html = ONCOUI._buildReviewPanel(draft);
  assert.ok(/data-oe-act="onco-create"\s+disabled/.test(html), "Create & Activate is disabled");
});

test("_buildReviewPanel enables Create & Activate once every staged override carries a reason", () => {
  const active = fixtureActiveTemplate();
  const params = { height: 165, weight: 60 };
  const draft = { protocolId: active.id, template: active, params: params, calculatedDoses: DOSE.planDoses(active, params), overrides: [{ drugId: "rituximab", was: 700, now: 600, reason: "Renal impairment" }] };
  const html = ONCOUI._buildReviewPanel(draft);
  assert.ok(!/data-oe-act="onco-create"\s+disabled/.test(html), "Create & Activate is enabled");
  assert.ok(html.indexOf("Renal impairment") >= 0, "the override reason is shown in the review line");
});

test("opd-emr.js assessTab (write mode, oncoFlagOn) offers the apply panel for an ACTIVE protocol only", () => {
  const active = fixtureActiveTemplate();
  const state = { tab: "assess", writeOn: true, assessVals: {}, oncoProtocols: [active, RCHOP], patient: {}, loading: false, error: "" };
  const html = OPDEMR._render(state);
  assert.ok(html.indexOf('data-oe-act="onco-apply:' + active.id + '"') >= 0, "active protocol offered near the assessment");
  assert.ok(html.indexOf("onco-apply:" + RCHOP.id) < 0, "draft protocol not offered");
});

test("opd-emr.js assessTab shows the review panel (not the apply list) once a plan is staged in st.oncoDraft", () => {
  const active = fixtureActiveTemplate();
  const params = { height: 165, weight: 60 };
  const draft = { protocolId: active.id, template: active, params: params, calculatedDoses: DOSE.planDoses(active, params), overrides: [] };
  const state = { tab: "assess", writeOn: true, assessVals: {}, oncoDraft: draft, oncoProtocols: [active], patient: {}, loading: false, error: "" };
  const html = OPDEMR._render(state);
  assert.ok(html.indexOf('data-oe-act="onco-create"') >= 0, "review panel with Create & Activate is shown");
  assert.ok(html.indexOf("onco-apply:") < 0, "the apply list is replaced by the review panel while a draft is staged");
});

test("opd-emr.js assessTab offers nothing oncology-related when smd_opd_emr_write is off (writeOn false)", () => {
  const active = fixtureActiveTemplate();
  const state = { tab: "assess", writeOn: false, assessVals: {}, oncoProtocols: [active], patient: {}, loading: false, error: "" };
  const html = OPDEMR._render(state);
  assert.ok(html.indexOf("onco-apply:") < 0);
  assert.ok(html.indexOf("onco-create") < 0);
});
