/* test/wardsynq-lineage.test.mjs — where did that number come from.
 *
 * The two tests that carry the weight are the staleness one, because a fresh-looking score built on
 * old inputs is the specific way a display lies, and the incomplete-provenance one, because a
 * partial explanation shown as a complete one is worse than no explanation.
 *
 * node --test test/wardsynq-lineage.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NODE_KIND, LineageError, LineageGraph, fromNews2 } from "../wardsynq/wardsynq-lineage.js";
import { news2, PARAM } from "../wardsynq/wardsynq-deterioration.js";
import { Observation } from "../wardsynq/wardsynq-model.js";

const NOW = "2026-09-04T12:00:00.000Z";
const ago = (m) => new Date(Date.parse(NOW) - m * 60000).toISOString();
const graph = () => new LineageGraph({ now: () => NOW });

/* ------------------------------------------------------------------ the basics */

test("a derived value explains itself down to its raw inputs", () => {
  const g = graph();
  g.raw({ id: "cr-1", label: "Creatinine", value: 180, unit: "umol/L", at: ago(30), source: "laboratory" });
  g.raw({ id: "age-1", label: "Age", value: 62, at: ago(30), source: "demographics" });
  g.derived({ id: "egfr-1", label: "eGFR", value: 31, unit: "mL/min/1.73m2", inputs: ["cr-1", "age-1"], method: "CKD-EPI" });

  const e = g.explain("egfr-1", NOW);
  assert.equal(e.found, true);
  assert.equal(e.complete, true);
  assert.equal(e.rawInputs.length, 2);
  assert.match(e.explanation, /computed from 2 values by CKD-EPI/);
});

test("a derived node with no inputs is refused", () => {
  const g = graph();
  assert.throws(() => g.derived({ id: "x", label: "Mystery score", value: 7, inputs: [] }),
    (e) => e instanceof LineageError && e.code === "NO_INPUTS");
  try {
    g.derived({ id: "x", value: 7, inputs: [] });
  } catch (e) {
    assert.match(e.message, /cannot be explained to the clinician who has to act on it/);
  }
});

test("an externally asserted value says the explanation stops there", () => {
  const g = graph();
  g.external({ id: "ext-1", label: "Risk score", value: "HIGH", source: "the referring hospital", at: ago(10) });
  const e = g.explain("ext-1", NOW);
  assert.equal(e.node.kind, NODE_KIND.EXTERNAL);
  assert.match(e.node.note, /its own inputs are not visible to this graph/);
});

test("explaining something the graph never produced says so", () => {
  assert.equal(graph().explain("nope", NOW).found, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: staleness propagates */

test("ADVERSARIAL: a score calculated a minute ago on a four-hour-old input is four hours old", () => {
  const g = graph();
  g.raw({ id: "rr", label: "Respiratory rate", value: 22, at: ago(5) });
  g.raw({ id: "bp", label: "Systolic BP", value: 98, at: ago(240) });   // four hours
  g.derived({ id: "news2-1", label: "NEWS2", value: 7, inputs: ["rr", "bp"], at: ago(1), method: "NEWS2 scale 1" });

  const e = g.explain("news2-1", NOW);
  assert.equal(e.ownAgeMinutes, 1, "the arithmetic ran a minute ago");
  assert.equal(e.effectiveAgeMinutes, 240, "and the assessment is four hours old");
  assert.match(e.explanation, /this assessment is 240 minutes old even though it was calculated 1 minute ago/,
    "a display that shows only the calculation time is lying by omission");
});

/* ------------------------------------------------------------------ ADVERSARIAL: what was thrown away */

test("ADVERSARIAL: an input that was REJECTED is part of the lineage", () => {
  const g = graph();
  g.raw({ id: "p1", label: "Pulse", value: 88, at: ago(3) });
  g.derived({
    id: "score", label: "NEWS2", value: 0, inputs: ["p1"], at: NOW,
    rejected: [{ id: "p2", reason: "device observation excluded as artifact, SQI 21" }],
  });

  const e = g.explain("score", NOW);
  assert.equal(e.rejected.length, 1);
  assert.match(e.rejected[0].reason, /excluded as artifact/);
  assert.match(e.explanation, /1 value was considered and not used/,
    "what was discarded is often the whole explanation and is the first thing an investigation asks for");
});

/* ------------------------------------------------------------------ ADVERSARIAL: broken chains */

test("ADVERSARIAL: a missing input makes the provenance INCOMPLETE rather than partial-but-quiet", () => {
  const g = graph();
  g.raw({ id: "a", label: "A", value: 1, at: ago(5) });
  g.derived({ id: "d", label: "Derived", value: 2, inputs: ["a", "vanished"], at: NOW });

  const e = g.explain("d", NOW);
  assert.equal(e.complete, false);
  assert.deepEqual(e.missing, ["vanished"]);
  assert.match(e.explanation, /^INCOMPLETE PROVENANCE/);
  assert.match(e.explanation, /must not be read as the whole one/);
});

test("brokenChains finds every node whose explanation would be partial", () => {
  const g = graph();
  g.raw({ id: "a", label: "A", value: 1, at: ago(1) });
  g.derived({ id: "d1", label: "D1", value: 2, inputs: ["a"] });
  g.derived({ id: "d2", label: "D2", value: 3, inputs: ["a", "gone"] });
  const broken = g.brokenChains();
  assert.equal(broken.length, 1);
  assert.equal(broken[0].id, "d2");
  assert.deepEqual(broken[0].missing, ["gone"]);
});

test("a cycle is reported rather than hung on", () => {
  const g = graph();
  g.raw({ id: "a", label: "A", value: 1, at: ago(1) });
  const d1 = g.derived({ id: "d1", label: "D1", value: 2, inputs: ["a"] });
  const d2 = g.derived({ id: "d2", label: "D2", value: 3, inputs: ["d1"] });
  d1.inputs.push("d2"); // whatever built this graph has a bug
  const e = g.explain("d1", NOW);
  assert.equal(e.found, true, "a malformed graph must not hang the explanation");
});

/* ------------------------------------------------------------------ ADVERSARIAL: impact */

test("ADVERSARIAL: a corrected result finds every decision that rested on it", () => {
  const g = graph();
  g.raw({ id: "k-1", label: "Potassium", value: 6.4, at: ago(60), source: "laboratory" });
  g.derived({ id: "crit-1", label: "Critical result alert", value: true, inputs: ["k-1"] });
  g.derived({ id: "esc-1", label: "Escalation to on-call", value: "sent", inputs: ["crit-1"] });
  g.derived({ id: "rx-1", label: "Insulin-dextrose order", value: "ordered", inputs: ["crit-1"] });

  const i = g.impactOf("k-1");
  assert.deepEqual(i.directlyAffected, ["crit-1"]);
  assert.deepEqual(i.allAffected.sort(), ["crit-1", "esc-1", "rx-1"]);
  assert.match(i.reading, /3 derived values are wrong/);
  assert.match(i.reading, /anyone who acted on it needs telling/,
    "this is the question asked after a mislabelled sample, and it is not 'what fed this'");
});

test("impactOf on a leaf reports plainly that nothing depended on it", () => {
  const g = graph();
  g.raw({ id: "lonely", label: "A value nothing used", value: 1, at: ago(1) });
  const i = g.impactOf("lonely");
  assert.equal(i.allAffected.length, 0);
  assert.match(i.reading, /Nothing in this graph was derived from lonely/);
});

/* ------------------------------------------------------------------ the real integration */

test("ADVERSARIAL: a real NEWS2 hands itself to the graph, rejects and all", () => {
  const obs = (code, value, minutesAgo) => Observation({
    patientId: "pat-1", code, value, category: "vital-signs", effectiveAt: ago(minutesAgo),
  });

  const observations = [
    obs("9279-1", 24, 5), obs("2708-6", 93, 5), obs("80288-4", true, 5),
    obs("8480-6", 96, 200), obs("8867-4", 118, 5), obs("80339-5", "A", 5), obs("8310-5", 38.4, 5),
    // A stale systolic that the gatherer will reject: 5 hours old, past the freshness window.
    obs("8480-6", 130, 300),
  ];

  const score = news2({ observations, patient: { ageYears: 71 }, now: NOW });
  assert.equal(score.scorable, true);

  const g = graph();
  const node = fromNews2(g, score, { patientId: "pat-1" });
  const e = g.explain(node.id, NOW);

  assert.equal(e.complete, true);
  assert.equal(e.rawInputs.length, 7, "one raw input per NEWS2 parameter");
  assert.ok(e.rejected.length >= 1, "and the stale reading the score refused is on the record");
  assert.match(e.rejected[0].reason, /freshness window/);

  // The property the whole file exists for: the score is as old as its oldest input.
  assert.equal(e.effectiveAgeMinutes, 200);
  assert.match(e.explanation, /this assessment is 200 minutes old/);
});
