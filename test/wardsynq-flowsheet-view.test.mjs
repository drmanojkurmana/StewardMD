/* test/wardsynq-flowsheet-view.test.mjs — the record, onto the flowsheet. Pure.
 *
 * node --test test/wardsynq-flowsheet-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, resolveRows, entryFrom } from "../functions/_wardsynq/flowsheet-view.js";

const obs = (over) => ({
  patientId: "pat", code: "8480-6", display: "Systolic", value: 126, unit: "mmHg", category: "vital-signs",
  meta: { effectiveAt: "2026-09-07T09:00:00.000Z", recordedAt: "2026-09-07T09:05:00.000Z" },
  writtenBy: { id: "cfa:nurse" }, ...(over || {}),
});

test("OBSERVED AND CHARTED ARE DIFFERENT TIMES, and the record already holds both", () => {
  const e = entryFrom(obs());
  assert.equal(e.observedAt, "2026-09-07T09:00:00.000Z");
  assert.equal(e.chartedAt, "2026-09-07T09:05:00.000Z");
  assert.equal(e.lagMinutes, 5);
  assert.equal(e.backfilled, false);
  assert.equal(e.by, "cfa:nurse", "and who charted it");

  /* Charting is retrospective on a busy ward: the 14:00 observations get written at 20:00. Surfacing
   * that is a fact about how the ward is running that no other screen can show. */
  const late = entryFrom(obs({ meta: { effectiveAt: "2026-09-07T09:00:00.000Z", recordedAt: "2026-09-07T14:00:00.000Z" } }));
  assert.equal(late.backfilled, true);
  assert.equal(late.lagMinutes, 300);
  assert.match(late.backfillNote, /retrospective/);
});

test("AN UNUSABLE OBSERVATION IS SKIPPED, never allowed to take the grid off the screen", () => {
  /* The flowsheet refuses an entry charted BEFORE it was observed, and it is right to - but a record
   * can hold that pair after a corrected effectiveAt or a clock skew, and one bad row must not cost
   * a nurse the whole chart. */
  assert.equal(entryFrom(obs({ meta: { effectiveAt: "2026-09-07T14:00:00.000Z", recordedAt: "2026-09-07T09:00:00.000Z" } })), null);
  assert.equal(entryFrom(obs({ code: null })), null);
  assert.equal(entryFrom(obs({ patientId: null })), null);
  assert.equal(entryFrom(obs({ meta: {} })), null);
  assert.equal(entryFrom(null), null);

  // With no recordedAt, the observation time stands for both - a lag of zero, not a guessed one.
  const bare = entryFrom(obs({ meta: { effectiveAt: "2026-09-07T09:00:00.000Z" } }));
  assert.equal(bare.lagMinutes, 0);
  assert.equal(bare.backfilled, false);
});

test("nothing here claims a value was SET when the record only knows what was seen", () => {
  /* `set` and `measured` are deliberately different kinds in the flowsheet: what a person told a
   * ventilator to do, and what it reports back. WardSynQ has no route that writes a setting, so none
   * is claimed. */
  assert.equal(entryFrom(obs()).kind, "observed");
  assert.equal(entryFrom(obs({ kind: "set" })).kind, "observed", "a caller cannot assert one either");
  // A laboratory result is not a flowsheet row: it has its own report, critical loop and release rules.
  assert.deepEqual(CATEGORIES, ["vital-signs", "fluid-balance", "device"]);
  assert.ok(!CATEGORIES.includes("laboratory"));
});

test("a row the hospital configured is a row, and one with no code is REPORTED", () => {
  const { rows, problems } = resolveRows([{ code: "8480-6", label: "Systolic BP" }, "8462-4", { label: "no code" }]);
  assert.deepEqual(rows, [{ code: "8480-6", label: "Systolic BP" }, { code: "8462-4", label: "8462-4" }]);
  /* A row that silently failed to load is indistinguishable from one nobody charted, and those mean
   * opposite things - "not part of this chart" versus "nobody filled it in". */
  assert.deepEqual(problems.map((p) => p.reason), ["no_code"]);
  assert.deepEqual(resolveRows(null).rows, []);
});
