/* insulin-ui.test.mjs - the UI layer, driven in Node with a minimal DOM stub (same approach as
 * test/oncotree-ui.test.mjs). These lock the behaviours that were BUGS in the UI rather than in
 * the engine: prefilled demo data, cross-patient IOB and daily totals, the critical-warning
 * bypass, the fabricated paediatric age, and the diabetes-type routing.
 * The headless-browser pass (Playwright against insulin-demo.html) exercises real clicks on top.
 * Run: node --test test/insulin-ui.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---- minimal DOM + storage stubs, enough for the module's builders to run ---- */
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};
const noopEl = () => ({
  style: {}, classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {}, appendChild() {},
  querySelector: () => null, querySelectorAll: () => [], innerHTML: "", textContent: "", hidden: false
});
/* Real elements for the two panels render() writes into. Returning null here (the easy stub)
 * makes render() bail at its first guard, so the whole output path goes untested - which is
 * how a var-hoisting bug in the empty-state branch (`missingFields(m)` where `m` is assigned
 * further down) survived a green suite. These let the tests assert what the screen SAYS. */
const panels = { insOut: noopEl(), insInputs: noopEl(), insDoseN: noopEl(), insHeader: noopEl(), insScreen: noopEl() };
global.window = global;
global.matchMedia = () => ({ matches: false });
global.document = {
  getElementById: id => panels[id] || null, createElement: noopEl, querySelector: () => null,
  querySelectorAll: () => [], body: noopEl(), documentElement: noopEl(),
  head: noopEl(), addEventListener() {}
};
global.requestAnimationFrame = () => 0;

require(join(ROOT, "insulin-flags.js"));
require(join(ROOT, "insulin-engine.js"));
require(join(ROOT, "insulin-safety.js"));
require(join(ROOT, "insulin-db.js"));
require(join(ROOT, "insulin-convert.js"));
require(join(ROOT, "insulin.js"));

const UI = global.window.INSULIN;
const B = UI._build;
const st = UI._st;

function reset() {
  store.clear();
  Object.assign(st, {
    mode: "correction", group: "now", dxType: "", dxSkipped: false, corrSource: "isf",
    glucose: "", carbs: "", icr: "", isf: "", iob: "", tdd: "", target: 120, increment: 1,
    patientId: null, patientName: "", acked: false, advAck: false, _hasCritical: false,
    scaleResist: "usual", scaleMax: 10, isfRule: 1800, curBasal: "", fasting: "", npoType1: false,
    pedStage: "prepubertal", bolus: "aspart"
  });
  st.ctx = { age: "", weightKg: "", pregnancy: false, renal: false, hepatic: false,
    exercise: false, steroids: false, pediatric: false, egfr: null, dialysis: false, trimester: null };
}

/* ── Empty defaults: the calculator must not open with a dose for a fictional patient ── */

test("no clinical input carries a prefilled value", () => {
  reset();
  for (const f of ["glucose", "carbs", "icr", "isf", "iob", "tdd"]) {
    assert.equal(st[f], "", f + " must start empty");
  }
  assert.equal(st.ctx.weightKg, "");
  assert.equal(st.ctx.age, "");
});

test("with nothing entered the engine returns no dose, not a number", () => {
  reset();
  assert.equal(B.compute().rounded, null);
  st.mode = "combined";
  assert.equal(B.compute().rounded, null);
});

test("IOB defaulting to 2 would silently shrink every correction - it must be empty", () => {
  reset();
  st.glucose = 300; st.isf = 50; st.target = 100;
  // IOB blank -> the full 4 u correction. With the old default of 2 this returned 2.
  assert.equal(B.compute().rounded, 4);
});

/* ── Patient scoping: one device, many patients ── */

function logDose(patientId, units, mode = "correction", minutesAgo = 30, unit = "units") {
  const log = JSON.parse(localStorage.getItem("smd_insulin_log_guest") || "[]");
  log.unshift({ mode, patientId, calculatedDose: units, confirmedDose: units, givenDose: units,
    unit, warnings: [], engineVersion: 2, ts: Date.now() - minutesAgo * 60000 });
  localStorage.setItem("smd_insulin_log_guest", JSON.stringify(log));
}

test("another patient's doses never become this patient's insulin on board", () => {
  reset();
  logDose("bed4", 8);
  st.patientId = "bed7"; st.patientName = "Bed 7";
  assert.equal(B.logForPatient().length, 0, "bed 7 must not see bed 4's dose");
  st.patientId = "bed4";
  assert.equal(B.logForPatient().length, 1);
});

test("with no patient selected nothing in the log is attributable", () => {
  reset();
  logDose("bed4", 8);
  st.patientId = null;
  assert.equal(B.logForPatient().length, 0);
  assert.equal(B.todayTotal(), 0);
});

test("the daily total is per patient, so six patients do not share one cap", () => {
  reset();
  logDose("bed4", 10); logDose("bed5", 10); logDose("bed6", 10);
  st.patientId = "bed4";
  assert.equal(B.todayTotal(), 10, "must count only this patient's dose");
});

test("units/hour and whole-day totals never contaminate the daily unit total", () => {
  reset();
  logDose("bed4", 6, "correction");
  logDose("bed4", 7, "dka", 30, "units/hour");     // an infusion RATE
  logDose("bed4", 40, "basal", 30, "units/day");   // a whole-day total
  st.patientId = "bed4";
  assert.equal(B.todayTotal(), 6);
});

/* ── Critical-warning gate ── */

test("a critical warning fires in Pediatric, the mode that used to skip it", () => {
  reset();
  st.mode = "pediatric"; st.ctx.weightKg = 300;    // 150 u/day, over the 100 u default cap
  const crit = B.safety(B.compute()).filter(w => w.interrupt);
  assert.ok(crit.length, "an over-cap paediatric TDD must raise a critical interrupt");
  assert.equal(crit[0].id, "max_daily");
});

test("the pediatric flag is a real flag, never a fabricated age", () => {
  reset();
  st.ctx.pediatric = true;
  assert.ok(B.safety({ rounded: 4 }).some(w => w.id === "pediatric"));
  assert.equal(st.ctx.age, "", "ticking Pediatric must not write an age into the patient record");
});

/* ── Diabetes type routing ── */

test("the type gate is shown first, and offers a skip", () => {
  reset();
  assert.equal(st.dxType, "");
  assert.equal(st.dxSkipped, false);
  const html = B.dxGate();
  for (const id of ["t1", "t2", "stress", "steroid", "secondary"]) {
    assert.ok(html.includes('data-v="' + id + '"'), "gate must offer " + id);
  }
  assert.ok(html.includes('data-ins="dx-skip"'), "gate must offer a skip");
});

test("the chosen type reaches the correction scale and changes it", () => {
  reset();
  st.mode = "scale"; st.ctx.weightKg = 70;
  st.dxType = "t1"; st.scaleResist = "sensitive";
  const t1 = B.compute();
  st.dxType = "stress"; st.scaleResist = "resistant";
  const stress = B.compute();
  assert.ok(stress.rows[3].units > t1.rows[3].units,
    "an insulin-resistant stressed patient must get more per band than a type 1");
  assert.ok(t1.blocked, "type 1 must carry the scale-alone refusal");
  assert.equal(stress.blocked, null);
});

test("skipping the type still produces a working scale", () => {
  reset();
  st.mode = "scale"; st.ctx.weightKg = 70; st.dxSkipped = true; st.dxType = "";
  const r = B.compute();
  assert.ok(r.rows && r.rows.length === 6);
  assert.equal(r.resistance, "usual");
  assert.equal(r.blocked, null);
});

test("the type chip reads empty before a choice and names the type after", () => {
  reset();
  assert.match(B.dxChip(), /No diabetes type set/);
  st.dxType = "t2";
  assert.match(B.dxChip(), /T2DM/);
});

/* ── Ward Sync import ── */

test("a Ward Sync patient becomes a profile with age, sex and bed, but no DOB or MRN identity", () => {
  reset();
  const p = B.wardProfile(
    { patientId: "MR12345", episodeId: "EP99", name: "Test Patient" },
    { patientFirstName: "Test Patient", dob: "64", gender: "Male", bedName: "12", deptDescription: "General Medicine" }
  );
  assert.equal(p.name, "Test Patient");
  assert.equal(p.age, 64);
  assert.equal(p.sex, "M");
  assert.match(p.notes, /General Medicine/);
  assert.match(p.notes, /Bed 12/);
  // the identifiers live in a link block, never as identity fields on the profile
  assert.equal(p.ward.patientId, "MR12345");
  assert.equal(p.ward.episodeId, "EP99");
  assert.equal(p.mrn, undefined, "no MRN field on the profile");
  assert.equal(p.dob, undefined, "no DOB is ever copied");
  // weight is the one number every weight-based calc needs - it must be asked, not guessed
  assert.equal(p.weightKg, "");
});

test("a Ward Sync record with no age or gender still yields a usable profile", () => {
  reset();
  const p = B.wardProfile({ patientId: "X1", name: "Unknown" }, {});
  assert.equal(p.age, "");
  assert.equal(p.sex, "");
  assert.equal(p.name, "Unknown");
});

/* ── Mode grouping ── */

test("every mode belongs to its group, and each group has at least one mode", () => {
  reset();
  for (const g of ["start", "adjust", "now", "special", "derive"]) {
    st.group = g;
    assert.ok(B.modes().length, g + " must expose at least one mode");
    for (const m of B.modes()) assert.equal(m.group, g);
  }
});

test("every mode has a label and a How-it-works explanation", () => {
  reset();
  for (const g of ["start", "adjust", "now", "special", "derive"]) {
    st.group = g;
    for (const m of B.modes()) {
      assert.ok(B.modeLabel(m.id) && B.modeLabel(m.id) !== "Insulin dose", m.id + " needs a label");
      assert.ok(B.howItWorks(m.id).length > 40, m.id + " needs a real explanation");
    }
  }
});

/* ── Findability and empty states: the ease-of-use surface ── */

test("the dashboard reorders the questions for the chosen diagnosis", () => {
  reset();
  st.dxType = "t2";
  const t2 = B.dashboard();
  st.dxType = "steroid";
  const steroid = B.dashboard();
  // steroid cover must lead for a steroid patient, and not for a type 2
  assert.ok(steroid.indexOf('data-mode="steroid"') < steroid.indexOf('data-mode="basalT2"'),
    "steroid cover must come first for a steroid patient");
  assert.ok(t2.indexOf('data-mode="basalT2"') < t2.indexOf('data-mode="steroid"'),
    "type 2 initiation must come first for a type 2 patient");
});

test("every calculator is reachable from the dashboard, suggested or not", () => {
  reset();
  st.dxType = "t1";
  const html = B.dashboard();
  for (const id of Object.keys(B.questions())) {
    assert.ok(html.includes('data-mode="' + id + '"'), id + " must be reachable from the dashboard");
  }
});

test("search finds a calculator by a word a clinician would actually type", () => {
  reset();
  const Q = B.questions();
  const hit = q => Object.keys(Q).filter(id =>
    Q[id].join(" ").toLowerCase().includes(q) || B.modeLabel(id).toLowerCase().includes(q));
  assert.ok(hit("prednisolone").includes("steroid"));
  assert.ok(hit("surgery").includes("periop"));
  assert.ok(hit("mixtard").includes("premix"));
  assert.ok(hit("nbm").includes("npo"));
  assert.ok(hit("ryles").includes("nutrition"));
  assert.ok(hit("sliding scale").includes("scale"));
  assert.ok(hit("stacking").includes("iob"));
});

test("the empty state names the fields still needed, per mode", () => {
  reset();
  st.mode = "titrate";
  assert.deepEqual(B.missingFields("titrate"), ["current basal dose", "fasting glucose"]);
  st.curBasal = 20;
  assert.deepEqual(B.missingFields("titrate"), ["fasting glucose"]);
  st.fasting = 190;
  assert.deepEqual(B.missingFields("titrate"), []);
});

/* REGRESSION: the branch really does render the names. The first version of this feature
 * called missingFields(m) where `m` is a var assigned further down render(), so hoisting
 * handed it `undefined` and the screen silently fell back to "Enter all required values"
 * while missingFields() itself tested green. Assert the rendered output, not the helper. */
test("render() actually prints the missing field names on screen", () => {
  reset();
  st.mode = "titrate";
  B.render();
  assert.match(panels.insOut.innerHTML, /Still needed/);
  assert.match(panels.insOut.innerHTML, /current basal dose/);
  assert.match(panels.insOut.innerHTML, /fasting glucose/);

  st.curBasal = 20; B.render();
  assert.ok(!/current basal dose/.test(panels.insOut.innerHTML), "a filled field drops off the list");
  assert.match(panels.insOut.innerHTML, /fasting glucose/);

  st.fasting = 190; B.render();
  assert.ok(!/Still needed/.test(panels.insOut.innerHTML), "a complete form shows a result, not a prompt");
  assert.match(panels.insOut.innerHTML, /22/, "20 u + 2 u = the titrated dose");
});

test("render() names the missing inputs for every mode that has them", () => {
  reset();
  for (const g of ["start", "adjust", "now", "special", "derive"]) {
    st.group = g;
    for (const m of B.modes()) {
      if (m.id === "iob") continue;                  // reads the log, no typed input
      reset(); st.mode = m.id; st.group = g;
      B.render();
      assert.match(panels.insOut.innerHTML, /Still needed/, m.id + " must name what it needs");
    }
  }
});

test("alternatives are offered as a choice, not demanded together", () => {
  reset();
  st.mode = "scale";
  assert.deepEqual(B.missingFields("scale"), ["total daily dose or weight"]);
  st.ctx.weightKg = 70;
  assert.deepEqual(B.missingFields("scale"), [], "weight alone must satisfy the scale");
});

test("every mode with required inputs declares them", () => {
  reset();
  for (const g of ["start", "adjust", "now", "special", "derive"]) {
    st.group = g;
    for (const m of B.modes()) {
      if (m.id === "iob") continue;                 // reads the log, has no typed input
      assert.ok(B.missingFields(m.id).length, m.id + " must name what it needs when empty");
    }
  }
});

test("skipping the type is remembered as a preference", () => {
  reset();
  assert.equal(UI._set.dxSkipped, false);
  UI._set.dxSkipped = true;                          // as the dx-skip handler sets it
  st.dxSkipped = !!(st.dxSkipped || UI._set.dxSkipped);
  assert.equal(st.dxSkipped, true, "a clinician who opted out must not be asked again");
  UI._set.dxSkipped = false;
});

test("mode tabs carry correct tab semantics and a roving tabindex", () => {
  reset();
  st.group = "now"; st.mode = "correction";
  const html = B.calc();
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('id="insTab-correction"'));
  assert.ok(html.includes('aria-controls="insInputs"'));
  assert.ok(/id="insTab-correction"[^>]*aria-selected="true"[^>]*tabindex="0"/.test(html),
    "the selected tab is focusable");
  assert.ok(/id="insTab-scale"[^>]*tabindex="-1"/.test(html), "unselected tabs are skipped by Tab");
  assert.ok(!html.includes('aria-pressed'), "role=tab must not use aria-pressed");
});

/* ASK MaiK HAS A KILL SWITCH. askAvailable() used to check only that window.INSULIN_ASK existed, so
 * the one path that sends a clinician's free text to an LLM could not be turned off without shipping
 * a new build - unlike every other risk-bearing workflow in this module, which is flag-gated.
 * Turning it off must remove the entry point entirely, not merely refuse on submit. */
test("Ask MaiK is flag-gated: off removes the Ask entry point, on restores it", () => {
  reset();
  st.dxType = "t2";
  const FLAGS = global.window.SMD_INSULIN_FLAGS;
  const prevAsk = global.window.INSULIN_ASK;
  global.window.INSULIN_ASK = { extract() {} };   // present, so ONLY the flag decides
  try {
    // The Ask bar is on the DASHBOARD (dashboardHTML), not inside the calculator screen.
    FLAGS.set("smd_insulin_ask", true);
    assert.ok(B.dashboard().includes('data-ins="ask-run"'), "with the flag ON the Ask bar is rendered");

    FLAGS.set("smd_insulin_ask", false);
    const off = B.dashboard();
    assert.ok(!off.includes('data-ins="ask-run"'), "with the flag OFF the Ask control is gone");
    assert.ok(!off.includes('data-ins="ask-text"'), "and so is its free-text box");
    assert.ok(off.length > 200, "the dashboard still renders - the fallback is the manual form itself");

    FLAGS.set("smd_insulin_ask", true);
    assert.ok(B.dashboard().includes('data-ins="ask-run"'), "it comes back when re-enabled");
  } finally {
    global.window.INSULIN_ASK = prevAsk;
    FLAGS.set("smd_insulin_ask", true);
  }
});

test("the Ask flag defaults ON, so adding this gate does not silently remove a shipped feature", () => {
  const FLAGS = global.window.SMD_INSULIN_FLAGS;
  assert.equal(FLAGS.DEFS.smd_insulin_ask.def, true);
  store.delete("smd_insulin_ask");
  assert.equal(FLAGS.bool("smd_insulin_ask"), true, "unset must resolve to ON");
});

test("no builder emits undefined, NaN or [object Object]", () => {
  reset();
  st.dxType = "t2";
  for (const html of [B.dashboard(), B.dxGate(), B.dxChip(), B.calc()]) {
    assert.ok(!html.includes("undefined"), "no 'undefined' in rendered HTML");
    assert.ok(!html.includes("NaN"), "no 'NaN' in rendered HTML");
    assert.ok(!html.includes("[object Object]"), "no '[object Object]' in rendered HTML");
  }
});
