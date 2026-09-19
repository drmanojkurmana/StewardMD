/* test/wardsynq-flowsheet-render.test.mjs — the display half of the missing-hour problem.
 *
 * The engine already refuses to call an incomplete total complete. This tests that the VIEW does not
 * undo that: an empty cell must look empty rather than like a zero, and the incompleteness must be
 * in the same sentence as the number rather than in a tooltip nobody opens at 08:00.
 *
 * The last test is the one that closes HAZ-FLUID-01: opening a balance records a read, the value is
 * corrected, and the consultant who prescribed on it is found.
 *
 * node --test test/wardsynq-flowsheet-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { render, renderGrid, renderBalance, attach, recordActedOn, esc } from "../wardsynq/ui/flowsheet-render.js";
import { chart, correct, recomputeAfterCorrection, KIND, DIRECTION } from "../wardsynq/wardsynq-flowsheet.js";
import { ReadLog, READ_KIND, notifyReadersOfCorrection } from "../wardsynq/wardsynq-readlog.js";

const DAY = "2026-09-05T";
const h = (hour, min = 0) => `${DAY}${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;

const entry = (over) => chart({
  patientId: "pat-1", code: "urine", label: "Urine output", value: 80, unit: "mL",
  kind: KIND.OBSERVED, direction: DIRECTION.OUT, observedAt: h(0), chartedAt: h(0, 5), by: "nurse-7", ...over,
});

/** Six hours, both directions charted every hour. */
const sixHours = (skipOutputAt = []) => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push(entry({ code: "iv", label: "IV fluids", direction: DIRECTION.IN, value: 100, observedAt: h(i), chartedAt: h(i, 5) }));
    if (!skipOutputAt.includes(i)) rows.push(entry({ observedAt: h(i), chartedAt: h(i, 5) }));
  }
  return rows;
};

function makeContainer() {
  return { innerHTML: "", closest() { return this; } };
}
function makeDoc() {
  const listeners = new Map();
  return {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
    _fire: (t, ev) => { const fn = listeners.get(t); if (fn) fn(ev); },
    _count: () => listeners.size,
  };
}

const ACTOR = { id: "dr-shah" };

/* ------------------------------------------------------------------ ADVERSARIAL: the empty cell */

test("ADVERSARIAL: an empty cell renders EMPTY, not as a zero and not as a dash", () => {
  const html = renderGrid({ entries: sixHours([2, 3]), from: h(0), to: h(6) });
  assert.match(html, /class="fs-cell fs-empty" aria-label="not charted"/);
  assert.equal(/fs-empty[^>]*>0</.test(html), false, "a zero in an unrecorded hour is the display half of the missing-hour problem");
  assert.equal(/fs-empty[^>]*>[-–—]</.test(html), false, "and at a glance a dash and a zero are the same mark");
});

test("ADVERSARIAL: a half-empty row cannot look complete", () => {
  const html = renderGrid({ entries: sixHours([2, 3, 4]), from: h(0), to: h(6) });
  assert.match(html, /class="fs-charted fs-incomplete">3 of 6</,
    "the count sits beside the row, so incompleteness is visible without counting blanks");
  assert.match(html, /class="fs-charted ">6 of 6</, "and a complete row says so too");
});

test("a backfilled cell says so rather than rendering identically", () => {
  const late = [entry({ observedAt: h(0), chartedAt: h(7) })];
  const html = renderGrid({ entries: late, from: h(0), to: h(2) });
  assert.match(html, /class="fs-mark" title="charted well after it was observed">late</);
  assert.match(html, /Read this grid as partly retrospective/,
    "a grid that renders a six-hour-late entry identically to a bedside one quietly launders the difference");
});

test("an amended cell is marked, and the superseded value is not drawn", () => {
  const wrong = entry({ value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const { replacement } = correct(wrong, { value: 40, by: "nurse-9", reason: "misread", at: h(6) });
  const html = renderGrid({ entries: [wrong, replacement], from: h(0), to: h(4) });
  assert.match(html, /title="this value was corrected">amended</);
  assert.match(html, /fs-value">40</);
  assert.equal(/fs-value">400</.test(html), false, "the superseded figure is history, not a current cell");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the qualifier */

test("ADVERSARIAL: incompleteness is in the SAME sentence as the number, not a tooltip", () => {
  const html = renderBalance({ entries: sixHours([2, 3, 4]), from: h(0), to: h(6) });
  assert.match(html, /fs-balance-reading">[^<]*INCOMPLETE/,
    "a consultant reads the figure; whatever qualifies it has to be in the sentence they read");
  assert.match(html, /fs-caution">[^<]*the difference is exactly the amount nobody recorded/);
  assert.match(html, /data-complete="false"/);
  assert.match(html, /fs-missing/, "and the missing hours are listed, so somebody can go and chart them");
});

test("a complete balance carries no caution and says it is complete", () => {
  const html = renderBalance({ entries: sixHours(), from: h(0), to: h(6) });
  assert.match(html, /data-complete="true"/);
  assert.equal(/fs-caution/.test(html), false);
  assert.match(html, /over 6 complete hours/);
});

test("the balance still shows its number when incomplete, deliberately", () => {
  const html = renderBalance({ entries: sixHours([2, 3, 4]), from: h(0), to: h(6) });
  assert.match(html, /fs-balance-value">\+/,
    "hiding it pushes a nurse to add it up on paper, which is worse than showing it with its caveat");
});

test("patient text is escaped, because a label is untrusted input like any other", () => {
  assert.equal(esc('<img src=x onerror=1>'), "&lt;img src=x onerror=1&gt;");
  const html = renderGrid({ entries: [entry({ label: "<script>bad()</script>" })], from: h(0), to: h(2) });
  assert.equal(/<script>bad/.test(html), false);
});

/* ------------------------------------------------------------------ THE POINT: reads are recorded */

test("ADVERSARIAL: opening a balance RECORDS a read, which is the gap HAZ-FLUID-01 named", () => {
  const doc = makeDoc();
  const container = makeContainer();
  const readLog = new ReadLog({ now: () => h(6, 12) });
  const entries = sixHours();

  render({ doc, container, entries, from: h(0), to: h(6), balanceId: "balance-0-6" });
  const detach = attach({ doc, container, readLog, actor: ACTOR, patientId: "pat-1", entries, from: h(0), to: h(6), balanceId: "balance-0-6" });

  doc._fire("click", { target: { closest: () => ({ getAttribute: (k) => (k === "data-action" ? "open-balance" : "balance-0-6") }) } });

  const reads = readLog.forPerson("dr-shah");
  assert.equal(reads.length, 1);
  assert.equal(reads[0].valueId, "balance-0-6");
  assert.equal(reads[0].kind, READ_KIND.OPENED);
  assert.equal(reads[0].patientId, "pat-1");
  detach();
});

test("ADVERSARIAL: merely rendering the grid records NOTHING", () => {
  const doc = makeDoc();
  const container = makeContainer();
  const readLog = new ReadLog({ now: () => h(6) });
  render({ doc, container, entries: sixHours(), from: h(0), to: h(6) });
  attach({ doc, container, readLog, actor: ACTOR, entries: sixHours(), from: h(0), to: h(6) });
  assert.equal(readLog.entries.length, 0, "logging every cell painted produces a list nobody can act on");
});

test("the read carries WHETHER the balance was complete, which a reviewer needs", () => {
  const doc = makeDoc();
  const readLog = new ReadLog({ now: () => h(6) });
  const entries = sixHours([2, 3, 4]);
  const detach = attach({ doc, container: makeContainer(), readLog, actor: ACTOR, entries, from: h(0), to: h(6) });
  doc._fire("click", { target: { closest: () => ({ getAttribute: (k) => (k === "data-action" ? "open-balance" : null) }) } });

  assert.match(readLog.entries[0].context, /incomplete: 3 hours not charted/,
    "'they read -320' is far less useful than 'they read -320 that was missing three hours of output'");
  detach();
});

test("acting on a balance is a stronger signal than opening one, and needs the decision", () => {
  const readLog = new ReadLog({ now: () => h(6, 12) });
  const entries = sixHours();
  assert.throws(() => recordActedOn({ readLog, actor: ACTOR, entries, from: h(0), to: h(6) }), TypeError);

  const e = recordActedOn({
    readLog, actor: ACTOR, patientId: "pat-1", entries, from: h(0), to: h(6),
    decision: "prescribed a 500 mL fluid challenge",
  });
  assert.equal(e.kind, READ_KIND.ACTED_ON);
  assert.match(e.context, /500 mL fluid challenge/);
});

test("attach refuses without an actor, because an anonymous read cannot be told anything", () => {
  assert.throws(() => attach({ doc: makeDoc(), container: makeContainer() }), TypeError);
  assert.throws(() => render({ doc: makeDoc() }), TypeError);
});

test("detach removes the listener, so a patient switch does not leak handlers", () => {
  const doc = makeDoc();
  const detach = attach({ doc, container: makeContainer(), actor: ACTOR, entries: [], from: h(0), to: h(6) });
  assert.equal(doc._count(), 1);
  detach();
  assert.equal(doc._count(), 0);
});

/* ------------------------------------------------------------------ HAZ-FLUID-01, closed */

test("ADVERSARIAL: end to end, the flowsheet reader is found when the value is corrected", () => {
  /* 02:00. A urine output of 400 mL is charted. It was really 40. */
  const rows = sixHours([2]);
  const wrong = entry({ value: 400, observedAt: h(2), chartedAt: h(2, 5) });
  const entries = [...rows, wrong];

  /* 06:12. The consultant OPENS the balance on the flowsheet, then prescribes on it. */
  const doc = makeDoc();
  const readLog = new ReadLog({ now: () => h(6, 12) });
  const detach = attach({ doc, container: makeContainer(), readLog, actor: ACTOR, patientId: "pat-1", entries, from: h(0), to: h(6), balanceId: "balance-0-6" });
  doc._fire("click", { target: { closest: () => ({ getAttribute: (k) => (k === "data-action" ? "open-balance" : "balance-0-6") }) } });
  recordActedOn({ readLog, actor: ACTOR, patientId: "pat-1", entries, from: h(0), to: h(6), balanceId: "balance-0-6", decision: "prescribed a 500 mL fluid challenge" });

  /* 08:00. The jug is re-read: it was 40. */
  const correction = correct(wrong, { value: 40, by: "nurse-9", reason: "misread the jug", at: h(8) });
  const recomputation = recomputeAfterCorrection({
    entries: [...rows, wrong, correction.replacement], correction,
    windows: [{ from: h(0), to: h(6), label: "balance-0-6" }],
  });

  const out = notifyReadersOfCorrection({
    readLog, recomputation, valueId: "balance-0-6", supersededVersion: 1,
    correctedAt: h(8), label: "0 to 6 hour fluid balance",
  });

  assert.equal(out.count, 1, "the consultant is found");
  assert.equal(out.notices[0].to, "dr-shah");
  assert.equal(out.notices[0].actedOn, true, "and is flagged as having prescribed on it");
  assert.equal(out.notices[0].urgency, "urgent");
  assert.match(out.notices[0].body, /please review it/);
  detach();
});
