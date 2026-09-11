/* test/wardsynq-readlog.test.mjs — telling the person who prescribed on the wrong number.
 *
 * The end-to-end test at the bottom is the point of the whole file: a consultant reads a fluid
 * balance at 06:12, prescribes on it, the urine output in it is corrected at 08:00, and the
 * consultant gets told. That path did not exist and is the reason HAZ-FLUID-01 was partial.
 *
 * node --test test/wardsynq-readlog.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { READ_KIND, ReadLog, ReadLogError, notifyReadersOfCorrection } from "../wardsynq/wardsynq-readlog.js";
import {
  chart, correct, fluidBalance, recomputeAfterCorrection, KIND, DIRECTION,
} from "../wardsynq/wardsynq-flowsheet.js";

const DAY = "2026-09-04T";
const h = (hour, min = 0) => `${DAY}${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;

const log = (now = h(9)) => new ReadLog({ now: () => now });

const aRead = (over) => ({
  valueId: "balance-24h", version: 1, value: -320, by: "dr-shah",
  kind: READ_KIND.OPENED, patientId: "pat-1", at: h(6, 12), ...over,
});

/* ------------------------------------------------------------------ recording */

test("a read records who, what version, and why it was on screen", () => {
  const l = log();
  const e = l.record(aRead());
  assert.equal(e.by, "dr-shah");
  assert.equal(e.version, 1);
  assert.equal(e.kind, READ_KIND.OPENED);
  assert.match(e.purpose, /Not for performance management/);
});

test("ADVERSARIAL: a value merely rendered on a page is NOT a read", () => {
  const l = log();
  assert.throws(() => l.record({ ...aRead(), kind: "rendered" }), (e) => e instanceof ReadLogError && e.code === "NO_KIND");
  try {
    l.record({ ...aRead(), kind: undefined });
  } catch (e) {
    assert.match(e.message, /buries the three that mattered/);
  }
});

test("ADVERSARIAL: a read without a VERSION is refused, or every correction notifies everybody", () => {
  const l = log();
  assert.throws(() => l.record({ ...aRead(), version: undefined }), (e) => e.code === "NO_VERSION");
});

test("an anonymous read is refused, because it cannot be told about a correction", () => {
  const l = log();
  assert.throws(() => l.record({ ...aRead(), by: null }), (e) => e.code === "NO_ACTOR");
  assert.throws(() => l.record({ ...aRead(), valueId: null }), (e) => e.code === "NO_VALUE");
});

/* ------------------------------------------------------------------ ADVERSARIAL: who to notify */

test("ADVERSARIAL: only readers of the SUPERSEDED version, and only BEFORE the correction", () => {
  const l = log();
  l.record(aRead({ by: "dr-shah", version: 1, at: h(6, 12) }));          // saw the wrong figure
  l.record(aRead({ by: "dr-patel", version: 1, at: h(9, 30) }));         // saw it, but after the fix
  l.record(aRead({ by: "dr-rao", version: 2, at: h(6, 30) }));           // saw a different version
  l.record(aRead({ by: "dr-khan", version: 1, at: h(7, 0), valueId: "other" }));

  const readers = l.readersToNotify({ valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8) });
  assert.deepEqual(readers.map((r) => r.by), ["dr-shah"],
    "notifying the other three would flood the list and teach people these notices are noise");
});

test("finding readers needs the correction it is about", () => {
  const l = log();
  assert.throws(() => l.readersToNotify({ valueId: "x" }), (e) => e.code === "NO_CORRECTION");
});

test("a correction nobody had read produces nothing to send", () => {
  const l = log();
  const r = l.forNotification({ valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8), nowValue: 40 });
  assert.equal(r.count, 0);
  assert.match(r.reading, /nobody had read the previous figure/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the message */

test("ADVERSARIAL: the output is a list of PEOPLE and what each saw, not a count of totals", () => {
  const l = log();
  l.record(aRead({ by: "dr-shah", value: -320, at: h(6, 12), kind: READ_KIND.ACTED_ON }));

  const r = l.forNotification({
    valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8),
    label: "24 hour fluid balance", wasValue: -320, nowValue: 40, delta: 360, unit: "mL",
  });

  assert.equal(r.count, 1);
  assert.equal(r.people[0].person, "dr-shah");
  assert.equal(r.people[0].actedOn, true);
  assert.match(r.people[0].message, /You saw 24 hour fluid balance as -320 mL at/);
  assert.match(r.people[0].message, /corrected to 40 mL, a difference of \+360 mL/);
  assert.match(r.people[0].message, /If you made a decision on it, please review it/);
});

test("ADVERSARIAL: the person who ACTED on it is named first", () => {
  const l = log();
  l.record(aRead({ by: "nurse-7", at: h(5), kind: READ_KIND.OPENED }));
  l.record(aRead({ by: "dr-shah", at: h(6, 12), kind: READ_KIND.ACTED_ON }));

  const r = l.forNotification({ valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8), nowValue: 40 });
  assert.equal(r.people[0].person, "dr-shah", "they are the one who may have prescribed on it");
  assert.equal(r.actedOnCount, 1);
  assert.match(r.reading, /carried it into a decision/);
});

test("one person who read it four times is told once", () => {
  const l = log();
  for (const m of [10, 20, 30, 40]) l.record(aRead({ by: "dr-shah", at: h(6, m) }));
  const r = l.forNotification({ valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8), nowValue: 40 });
  assert.equal(r.count, 1, "four messages about one number is how a notice becomes noise");
});

test("ADVERSARIAL: the notification states the thing it cannot know", () => {
  const l = log();
  l.record(aRead());
  const r = l.forNotification({ valueId: "balance-24h", supersededVersion: 1, correctedAt: h(8), nowValue: 40 });
  assert.match(r.limitation, /does not know whether any of them relied on it/);
  assert.match(r.limitation, /the correct direction to be wrong in/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: surveillance */

test("ADVERSARIAL: the log is bounded, because one that grows forever is a dossier", () => {
  const l = new ReadLog({ now: () => h(9), retentionDays: 30 });
  l.record(aRead({ at: "2026-01-01T00:00:00.000Z" }));
  l.record(aRead({ at: h(6) }));

  const pruned = l.prune(h(9));
  assert.equal(pruned.removed, 1);
  assert.equal(pruned.remaining, 1);
});

test("a person can be shown everything recorded about them", () => {
  const l = log();
  l.record(aRead({ by: "dr-shah" }));
  l.record(aRead({ by: "dr-patel" }));
  assert.equal(l.forPerson("dr-shah").length, 1);
});

/* ------------------------------------------------------------------ THE POINT */

test("ADVERSARIAL: end to end, the consultant who prescribed on the wrong balance is told", () => {
  /* 02:00. A urine output of 400 mL is charted. It was really 40. */
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push(chart({ patientId: "pat-1", code: "iv", label: "IV fluids", value: 100, unit: "mL",
      kind: KIND.OBSERVED, direction: DIRECTION.IN, observedAt: h(i), chartedAt: h(i, 5), by: "nurse-7" }));
    if (i !== 2) {
      rows.push(chart({ patientId: "pat-1", code: "urine", label: "Urine output", value: 80, unit: "mL",
        kind: KIND.OBSERVED, direction: DIRECTION.OUT, observedAt: h(i), chartedAt: h(i, 5), by: "nurse-7" }));
    }
  }
  const wrong = chart({ patientId: "pat-1", code: "urine", label: "Urine output", value: 400, unit: "mL",
    kind: KIND.OBSERVED, direction: DIRECTION.OUT, observedAt: h(2), chartedAt: h(2, 5), by: "nurse-7" });
  const before = [...rows, wrong];

  /* 06:12. The consultant opens the balance and prescribes on it. */
  const shown = fluidBalance(before, { from: h(0), to: h(6) });
  assert.ok(shown.balanceMl < 0, "the wrong figure makes this patient look negative");

  const readLog = new ReadLog({ now: () => h(8) });
  readLog.record({
    valueId: "balance-0-6", version: 1, value: shown.balanceMl, unit: "mL",
    by: "dr-shah", kind: READ_KIND.ACTED_ON, patientId: "pat-1", at: h(6, 12),
    context: "prescribed a 500 mL fluid challenge",
  });

  /* 08:00. A nurse notices the jug read 40, not 400. */
  const correction = correct(wrong, { value: 40, by: "nurse-9", reason: "misread the jug", at: h(8) });
  const recomputation = recomputeAfterCorrection({
    entries: [...rows, wrong, correction.replacement], correction,
    windows: [{ from: h(0), to: h(6), label: "balance-0-6" }],
  });
  assert.equal(recomputation.crossings.length, 1, "the balance crossed zero");

  /* The join that did not exist: who saw it, and what to tell them. */
  const out = notifyReadersOfCorrection({
    readLog, recomputation, valueId: "balance-0-6", supersededVersion: 1,
    correctedAt: h(8), label: "0 to 6 hour fluid balance",
  });

  assert.equal(out.count, 1);
  assert.equal(out.notices[0].to, "dr-shah");
  assert.equal(out.notices[0].urgency, "urgent", "they acted on it AND the total crossed zero");
  assert.match(out.notices[0].body, /read negative and now reads positive/);
  assert.match(out.notices[0].body, /please review it/);
  assert.equal(out.urgent, 1);
});

test("a correction that changes a total nobody acted on is routine, not urgent", () => {
  const readLog = new ReadLog({ now: () => h(8) });
  readLog.record({ valueId: "b", version: 1, value: 100, by: "nurse-7", kind: READ_KIND.OPENED, at: h(5) });

  const out = notifyReadersOfCorrection({
    readLog,
    recomputation: { changed: [{ label: "b", wasMl: 100, nowMl: 140, deltaMl: 40, crossedThresholds: [] }] },
    valueId: "b", supersededVersion: 1, correctedAt: h(8), label: "b",
  });
  assert.equal(out.notices[0].urgency, "routine");
  assert.equal(out.urgent, 0);
});

test("the bridge needs a real recomputation, not a claim that something changed", () => {
  const readLog = new ReadLog({ now: () => h(8) });
  assert.throws(() => notifyReadersOfCorrection({ readLog }), (e) => e.code === "NO_RECOMPUTATION");
  assert.throws(() => notifyReadersOfCorrection({}), (e) => e.code === "NO_LOG");
});
