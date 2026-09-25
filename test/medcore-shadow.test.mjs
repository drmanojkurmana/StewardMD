/* test/medcore-shadow.test.mjs — shadow means it reaches nobody, and today it records only refusals.
 *
 * The one assertion that matters most is the last: with only synthetic artifacts available, a full
 * shadow run over real bus events records ABSTAIN with MODEL_UNAVAILABLE on every decision. A
 * probability appearing here would mean the refusal in medcore-models.js had been bypassed
 * somewhere between the event and the buffer.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createShadow } from "../medcore/medcore-shadow.js";
import { buildState } from "../medcore/medcore-state.js";
import { STATUS, ABSTAIN_REASON } from "../medcore/medcore-calibration.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const DEPS = { unitTable: j("medcore/data/units.json"), freshness: j("medcore/data/freshness.json") };
const OUTCOMES = j("medcore/data/outcomes.json");
const SYNTHETIC = j("test/fixtures/medcore-artifact-mc3.json");

const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

function stateFor(payload) {
  if (!payload || !payload.subjectKey) return null;
  const base = buildState(DEPS, {
    asOf: payload.asOf || NOW, subjectKey: payload.subjectKey,
    patient: { ageYears: 68, sex: "M", weightKg: 74 },
    observations: [
      { param: "map", value: 62, at: min(10), unit: "mmHg", source: "extract" },
      { param: "hr", value: 118, at: min(10), unit: "bpm", source: "extract" }
    ],
    interventions: { vasopressor: { active: false }, ventilation: { active: false }, oxygen: { active: true }, rrt: { active: false } }
  });
  return Object.assign({}, base, { context: { dnr: false, inIcu: false, electivePostOp: false, admissionPlanned: false, creatinineBaseline: 0.9 } });
}

const make = (over) => createShadow(Object.assign({
  outcomes: OUTCOMES, artifacts: {}, enabled: ["MC-3"], stateFor
}, over || {}));

test("shadow: it debounces per patient on wall time, not on the decision instant", () => {
  let t = 0;
  const s = make({ clock: () => t, debounceMs: 60000 });
  s.observe({ subjectKey: "a" });
  s.observe({ subjectKey: "a" });                 // same minute, skipped
  s.observe({ subjectKey: "b" });                 // a different patient is not debounced
  t += 60001;
  s.observe({ subjectKey: "a" });
  const r = s.report();
  assert.equal(r.stats.seen, 4);
  assert.equal(r.stats.debounced, 1);
  assert.equal(r.stats.evaluated, 3);
  assert.equal(r.subjectsTracked, 2);
});

test("shadow: an event with no state is counted, not guessed at", () => {
  const s = make();
  s.observe({ nothing: true });
  s.observe(null);
  assert.equal(s.report().stats.noState, 2);
  assert.equal(s.report().stats.evaluated, 0);
});

test("shadow: a failure is a number on a diagnostic, never a throw into the app", () => {
  const s = make({ stateFor: () => { throw new Error("adapter blew up"); } });
  assert.doesNotThrow(() => s.observe({ subjectKey: "a" }));
  assert.equal(s.report().stats.failed, 1);
});

test("shadow: the buffer carries statuses and versions, never a patient value", () => {
  const s = make();
  s.observe({ subjectKey: "a" });
  const e = s.entries()[0];
  assert.ok(e.outcome && e.status);
  const json = JSON.stringify(s.entries());
  assert.ok(!/62|118|"map"|"hr"/.test(json), "no clinical value may reach the buffer: " + json);
  assert.ok(!/subjectKey|opaque/.test(json), "no identifier either");
});

test("shadow: the buffer is bounded", () => {
  let t = 0;
  const s = make({ clock: () => (t += 60001), bufferSize: 5 });
  for (let i = 0; i < 40; i++) s.observe({ subjectKey: "p" + i });
  assert.equal(s.entries().length, 5);
  assert.equal(s.report().buffered, 5);
});

test("shadow: it attaches to a real ClinicalEventBus and detaches cleanly", async () => {
  const bus = new ClinicalEventBus();
  const s = make();
  const detach = s.attach(bus, { types: ["observation.recorded"] });
  assert.equal(s.report().attached, true);
  await bus.emit("observation.recorded", { subjectKey: "a" });
  assert.equal(s.report().stats.evaluated, 1);
  detach();
  assert.equal(s.report().attached, false);
  await bus.emit("observation.recorded", { subjectKey: "b" });
  assert.equal(s.report().stats.evaluated, 1, "a detached observer observes nothing");
});

test("shadow: it emits nothing back onto the bus", async () => {
  const bus = new ClinicalEventBus();
  const seen = [];
  for (const t of ["medcore.decision", "observation.recorded", "alert.raised"]) {
    bus.on(t, async (p) => { seen.push(t); });
  }
  const s = make();
  s.attach(bus, { types: ["observation.recorded"] });
  await bus.emit("observation.recorded", { subjectKey: "a" });
  assert.deepEqual(seen, ["observation.recorded"], "only the inbound event; the shadow adds nothing");
});

test("shadow: the module touches no DOM, no network and raises nothing", () => {
  const src = readFileSync(join(ROOT, "medcore/medcore-shadow.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/document\.|window\.|fetch\s*\(|localStorage/.test(src), "no DOM, no network, no storage");
  assert.ok(!/\.emit\s*\(|notify|escalat|prompt\s*\(/.test(src), "it must not emit, notify or prompt");
});

test("shadow: TODAY it records nothing but refusals, because every artifact is synthetic", () => {
  // The whole chain runs: bus event -> state -> askable -> features -> artifact admission -> verdict.
  // The artifact is offered and medcore-models.js refuses it, so every entry is an abstention.
  const s = make({ artifacts: { "MC-3": SYNTHETIC } });
  s.observe({ subjectKey: "a" });
  const entries = s.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, STATUS.ABSTAIN);
  assert.deepEqual(entries[0].reason, [ABSTAIN_REASON.MODEL_UNAVAILABLE]);
  assert.equal(entries[0].artifactRefusal, "SYNTHETIC_TRAINING_DATA");
  assert.equal(entries[0].probabilityDecile, null, "a probability here would mean the refusal was bypassed");
  assert.deepEqual(s.report().stats.byStatus, { ABSTAIN: 1 });
});

test("shadow: with a real admitted artifact it records a decile, and mlops gets the prediction", () => {
  const real = JSON.parse(JSON.stringify(SYNTHETIC));
  real.provenance.synthetic = false;
  for (const k of Object.keys(real.gates)) real.gates[k].pass = true;
  const recorded = [];
  const s = make({
    artifacts: { "MC-3": real },
    mlops: { registry: { id: "r" }, recordShadowPrediction: (reg, p) => recorded.push(p) }
  });
  s.observe({ subjectKey: "a" });
  const e = s.entries()[0];
  assert.equal(e.status, STATUS.OK);
  assert.ok(e.probabilityDecile !== null && e.probabilityDecile >= 0 && e.probabilityDecile <= 1);
  assert.equal(recorded.length, 1);
  assert.equal(s.report().stats.recorded, 1);
  // Even here the buffer keeps a DECILE, not the probability: a shadow log is not a chart.
  assert.equal(Math.round(e.probabilityDecile * 10) / 10, e.probabilityDecile);
});

test("shadow: an abstention is never recorded to mlops as a prediction", () => {
  const recorded = [];
  const s = make({
    artifacts: { "MC-3": SYNTHETIC },
    mlops: { registry: { id: "r" }, recordShadowPrediction: (reg, p) => recorded.push(p) }
  });
  s.observe({ subjectKey: "a" });
  assert.equal(recorded.length, 0, "there is no prediction to record");
  assert.equal(s.report().stats.recorded, 0);
});
