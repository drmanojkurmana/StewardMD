/* Phase 5 unit tests: the nurse execution view builder (onco-nurse.js) stays PURE (no DOM, no fetch)
 * and - the non-negotiable safety guarantee this file exists to prove - NEVER calculates a dose. It
 * reads confirmed doses off the plan/cycle already in state and renders "verify" when there is none,
 * exactly like the doctor matrix (onco-protocols.js) does. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const NURSE_PATH = join(ROOT, "onco-nurse.js");

// Load order mirrors index.html: onco-protocols.js (doctor matrix, window.SMD_ONCOUI) before
// opd-emr.js, same as onco-ui.test.mjs - needed so oncoTab()'s DEFAULT (doctor) branch has a real
// matrix builder to delegate to, not just the nurse-view path this file otherwise exercises.
const ONCOUI = require(join(ROOT, "onco-protocols.js"));
const NURSE = require(NURSE_PATH);
global.SMD_QUEUE_FLAGS = { bool: function () { return true; } };   // smd_onco_protocols on, before opd-emr.js reads it
const OPDEMR = require(join(ROOT, "opd-emr.js"));

const RCHOP = require(join(ROOT, "kb", "protocols", "rchop.json"));
const DOSE = require(join(ROOT, "onco-dose.js"));

function fixturePlan() {
  const params = { height: 165, weight: 60, age: 55, sex: "female" };
  const calculatedDoses = DOSE.planDoses(RCHOP, params);
  return {
    planId: "TP-fixture", protocolId: RCHOP.id, ghisPatientId: "MRN-900", lockedTemplate: RCHOP,
    plannedCycles: RCHOP.cycles, calculatedDoses: calculatedDoses, confirmedDoses: calculatedDoses, status: "active",
  };
}
function fixtureCycle(overrides) {
  return Object.assign({
    cycleId: "TP-fixture__1", planId: "TP-fixture", cycleNo: 1, day: 1, state: "ready",
    clearance: { status: "cleared", checks: [{ name: "CBC/platelets", status: "ok" }], resolvedBy: "dr1", resolvedAt: 12345 },
    confirmedDoses: fixturePlan().confirmedDoses, administrationSequence: [],
  }, overrides || {});
}

test("onco-nurse.js NEVER references the dose engine - no 'onco-dose' / 'SMD_ONCODOSE' anywhere in its own source (nurse view never calculates)", () => {
  const src = readFileSync(NURSE_PATH, "utf8");
  assert.ok(!/onco-dose/i.test(src), "onco-nurse.js must not import/require onco-dose.js");
  assert.ok(!/SMD_ONCODOSE/.test(src), "onco-nurse.js must not reference window.SMD_ONCODOSE");
});

test("buildNurseView renders the CONFIRMED dose read from the cycle, not recomputed", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle();
  const html = NURSE.buildNurseView(plan, cycle);
  const rituximabFinal = cycle.confirmedDoses.filter((d) => d.drugId === "rituximab")[0].final;
  assert.ok(html.indexOf(rituximabFinal + " mg") >= 0, "shows the exact confirmed dose value from the cycle, verbatim");
  RCHOP.drugs.forEach((d) => assert.ok(html.indexOf(d.name) >= 0, "give-list shows " + d.name));
  RCHOP.premedications.forEach((p) => assert.ok(html.indexOf(p.name) >= 0, "give-list shows premedication " + p.name));
});

test("buildNurseView never invents: a drug with no confirmed/calculated dose renders 'verify'", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle({ confirmedDoses: [] });
  plan.confirmedDoses = []; plan.calculatedDoses = [];
  const html = NURSE.buildNurseView(plan, cycle);
  assert.ok(html.indexOf(">verify<") >= 0, "an unmatched drug shows verify, never a guessed number");
});

test("give-list carries one [Start] button per drug as data-oe-act=\"onco-start:<cycleId>:<drugId>\", none for premedications", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle();
  const html = NURSE.buildNurseView(plan, cycle);
  RCHOP.drugs.forEach((d) => {
    assert.ok(html.indexOf('data-oe-act="onco-start:' + cycle.cycleId + ":" + d.id + '"') >= 0, "Start action present for " + d.id);
  });
  const startMatches = html.match(/data-oe-act="onco-start:[^"]+"/g) || [];
  assert.equal(startMatches.length, RCHOP.drugs.length, "exactly one Start action per protocol drug, not per premedication");
});

test("a drug already in cycle.administrationSequence shows a 'Given' tag instead of a Start button", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle({ administrationSequence: [{ drugId: "rituximab", actual: 700, startTime: 1, endTime: 2, reaction: "", administeredBy: "nurse1" }] });
  const html = NURSE.buildNurseView(plan, cycle);
  assert.ok(html.indexOf('data-oe-act="onco-start:' + cycle.cycleId + ':rituximab"') < 0, "rituximab already given - no Start button");
  assert.ok(html.indexOf('data-oe-act="onco-start:' + cycle.cycleId + ':cyclophosphamide"') >= 0, "cyclophosphamide not yet given - Start button present");
});

test("clearance status maps to the banner colour: cleared/review/not_cleared -> green/amber/red", () => {
  assert.equal(NURSE._clearanceColor("cleared"), "green");
  assert.equal(NURSE._clearanceColor("review"), "amber");
  assert.equal(NURSE._clearanceColor("not_cleared"), "red");
  assert.equal(NURSE._clearanceColor("pending"), "red", "an unresolved/default status must never render as safe");
  assert.equal(NURSE._clearanceColor(undefined), "red", "a missing status must never render as safe (fail-closed)");

  const plan = fixturePlan();
  ["cleared", "review", "not_cleared"].forEach((status, i) => {
    const color = ["green", "amber", "red"][i];
    const cycle = fixtureCycle({ clearance: { status: status, checks: [], resolvedBy: "dr1", resolvedAt: 1 } });
    const html = NURSE.buildNurseView(plan, cycle);
    assert.ok(html.indexOf("oe-clr-" + color) >= 0, status + " clearance renders the " + color + " banner class");
  });
});

test("administration record table renders actual dose | start | end | reaction | nurse from cycle.administrationSequence", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle({ administrationSequence: [
    { drugId: "rituximab", actual: 700, startTime: Date.UTC(2026, 0, 1, 9, 30), endTime: Date.UTC(2026, 0, 1, 11, 0), reaction: "mild flushing", administeredBy: "Nurse Jane" },
  ] });
  const html = NURSE.buildNurseView(plan, cycle);
  assert.ok(html.indexOf("700 mg") >= 0, "actual dose rendered");
  assert.ok(html.indexOf("09:30") >= 0, "start time rendered");
  assert.ok(html.indexOf("11:00") >= 0, "end time rendered");
  assert.ok(html.indexOf("mild flushing") >= 0, "reaction rendered");
  assert.ok(html.indexOf("Nurse Jane") >= 0, "administering nurse rendered");
});

test("administration record shows an empty state with zero rows (nothing given yet)", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle({ administrationSequence: [] });
  const html = NURSE.buildNurseView(plan, cycle);
  assert.ok(/no administration recorded/i.test(html));
});

test("[Complete cycle] carries data-oe-act=\"onco-complete:<cycleId>\" while live, and is replaced by a done badge once state is 'done'", () => {
  const plan = fixturePlan();
  const live = NURSE.buildNurseView(plan, fixtureCycle({ state: "administering" }));
  assert.ok(live.indexOf('data-oe-act="onco-complete:TP-fixture__1"') >= 0);
  const doneHtml = NURSE.buildNurseView(plan, fixtureCycle({ state: "done" }));
  assert.ok(doneHtml.indexOf('data-oe-act="onco-complete:') < 0, "no Complete action once the cycle is already done");
  assert.ok(/cycle complete/i.test(doneHtml));
});

test("buildNurseView escapes drug/premedication text (no raw HTML injection)", () => {
  const plan = fixturePlan();
  plan.lockedTemplate = Object.assign({}, RCHOP, {
    drugs: [Object.assign({}, RCHOP.drugs[0], { name: "<img src=x onerror=alert(1)>" })],
    premedications: [{ name: "<script>evil()</script>", notes: "" }],
  });
  const html = NURSE.buildNurseView(plan, fixtureCycle());
  assert.ok(html.indexOf("<img") < 0 && html.indexOf("<script>evil") < 0, "raw markup never lands in the output");
  assert.ok(html.indexOf("&lt;img") >= 0 && html.indexOf("&lt;script&gt;") >= 0, "escaped instead");
});

test("opd-emr.js oncoTab renders the nurse view when st.oncoView is 'nurse' and a cycle is present", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle();
  const html = OPDEMR.oncoTab({ oncoPlan: plan, oncoCycle: cycle, oncoView: "nurse" });
  assert.ok(html.indexOf("oe-onco-nurse") >= 0, "nurse view container rendered");
  assert.ok(html.indexOf("oe-onco-tbl") < 0, "the doctor matrix is NOT rendered in nurse mode");
  assert.ok(html.indexOf('data-oe-act="onco-view:doctor"') >= 0 && html.indexOf('data-oe-act="onco-view:nurse"') >= 0, "doctor/nurse toggle present");
});

test("opd-emr.js oncoTab (nurse mode, no cycle yet) shows a friendly empty state, no throw", () => {
  const html = OPDEMR.oncoTab({ oncoPlan: fixturePlan(), oncoCycle: null, oncoView: "nurse" });
  assert.ok(/no cycle ready/i.test(html));
});

test("opd-emr.js oncoTab defaults to the doctor matrix when oncoView is unset", () => {
  const html = OPDEMR.oncoTab({ oncoPlan: fixturePlan() });
  assert.ok(html.indexOf("oe-onco-tbl") >= 0, "doctor matrix is the default view");
  assert.ok(html.indexOf("oe-onco-nurse") < 0);
});
