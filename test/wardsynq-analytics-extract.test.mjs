/* test/wardsynq-analytics-extract.test.mjs — the numbers that leave the hospital.
 *
 * node --test test/wardsynq-analytics-extract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_CELL, COUNTABLE, suppress, tally } from "../functions/_wardsynq/analytics-extract.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/analytics-extract.js", import.meta.url), "utf8");

test("SMALL NUMBERS IDENTIFY PEOPLE, so a small cell is WITHHELD and not rounded", () => {
  /* "One patient on Ward B had a critical result acknowledged late in March" is not an aggregate; on
   * a small ward it is a person, and anybody who works there knows which. */
  const out = suppress([{ key: "a", count: 40 }, { key: "b", count: 2 }, { key: "c", count: 30 }]);
  const b = out.cells.find((c) => c.key === "b");
  assert.equal(b.suppressed, true);
  assert.equal(b.count, null, "withheld means absent, never rounded and never zero");
  assert.equal(MIN_CELL, 5);
  assert.match(out.note, /Withheld is not zero/);
});

test("SUPPRESSION THAT ARITHMETIC CAN UNDO IS NOT SUPPRESSION", () => {
  /* One withheld cell beside published siblings is a subtraction away from being republished, so the
   * next-smallest goes too. Without complementary suppression the control is decorative. */
  const out = suppress([{ key: "a", count: 40 }, { key: "b", count: 2 }, { key: "c", count: 30 }]);
  const hidden = out.cells.filter((c) => c.suppressed).map((c) => c.key).sort();
  assert.deepEqual(hidden, ["b", "c"], "the small one and the next-smallest");
  assert.equal(out.cells.find((c) => c.key === "a").count, 40);
  assert.equal(out.suppressed, 2);
});

test("a zero becomes disclosive once something in its group is withheld", () => {
  /* A zero is not disclosive alone - nobody is identified by an event that did not happen - but
   * beside a withheld cell it narrows what the withheld number can be. */
  const clean = suppress([{ key: "a", count: 40 }, { key: "b", count: 0 }, { key: "c", count: 30 }]);
  assert.equal(clean.suppressed, 0, "nothing small, so the zero stays visible");
  assert.equal(clean.cells.find((c) => c.key === "b").count, 0);

  const dirty = suppress([{ key: "a", count: 40 }, { key: "b", count: 0 }, { key: "c", count: 2 }]);
  assert.equal(dirty.cells.find((c) => c.key === "b").suppressed, true);
});

test("THE FLOOR CANNOT BE LOWERED BY A REQUESTER, only raised", () => {
  // A threshold a requester can lower is not a control.
  assert.equal(suppress([{ key: "a", count: 3 }], 1).floor, MIN_CELL);
  assert.equal(suppress([{ key: "a", count: 3 }], 0).floor, MIN_CELL);
  assert.equal(suppress([{ key: "a", count: 3 }], "").floor, MIN_CELL, 'Number("") is 0 and 0 is finite');
  assert.equal(suppress([{ key: "a", count: 3 }], -5).floor, MIN_CELL);
  // Raising it is a hospital being more careful, which is always allowed.
  assert.equal(suppress([{ key: "a", count: 30 }], 50).floor, 50);
  assert.equal(suppress([{ key: "a", count: 30 }], 50).cells[0].suppressed, true);
});

test("a group with nothing small publishes everything", () => {
  const out = suppress([{ key: "a", count: 40 }, { key: "b", count: 30 }]);
  assert.equal(out.suppressed, 0);
  assert.equal(out.note, undefined);
  assert.deepEqual(out.cells.map((c) => c.count), [40, 30]);
  // An empty group is not an error and suppresses nothing.
  assert.equal(suppress([]).suppressed, 0);
  assert.deepEqual(suppress(null).cells, []);
});

test("PURE: tallying is by period and by a fixed label", () => {
  const from = Date.parse("2026-09-01T00:00:00.000Z"), to = Date.parse("2026-09-30T23:59:59.000Z");
  const rows = tally([
    { class: "OPD", startedAt: "2026-09-05T09:00:00.000Z" },
    { class: "OPD", startedAt: "2026-09-06T09:00:00.000Z" },
    { class: "IPD", startedAt: "2026-09-07T09:00:00.000Z" },
    { class: "IPD", startedAt: "2026-08-30T09:00:00.000Z" },
    { class: "IPD" },
  ], (e) => e.class, from, to, "startedAt");
  assert.deepEqual(rows, [{ key: "IPD", count: 1 }, { key: "OPD", count: 2 }]);

  // A record with no usable label is counted under a fixed word, never under its own content.
  assert.deepEqual(tally([{ startedAt: "2026-09-05T09:00:00.000Z" }], (e) => e.class, from, to, "startedAt"),
    [{ key: "unspecified", count: 1 }]);
});

test("NO PATIENT IDENTIFIER AND NO CLINICIAN NAME CAN REACH THE OUTPUT", () => {
  /* The registry cohort is deliberately the ONE report in this codebase that names patients, and it
   * is a clinical worklist that stays inside. This is its opposite and the two must not converge. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/patientId/.test(code), "no patient id is read into a variable at all");
  assert.ok(!/\bmrn\b/i.test(code));
  assert.ok(!/\bdob\b/i.test(code));
  assert.ok(!/pseudonym\s*:/.test(code) || /recordDeps\.pseudonym/.test(code), "only the service's own dependency");
  assert.ok(!/actorId|writtenBy|clinicianId/.test(code), "and nothing is attributed to a person");
  // The keys are enumerated properties, never free text a patient supplied.
  assert.ok(/e\.class|a\.status|r\.status|l\.state|o\.ruleId/.test(code));
});

test("it is an EXTRACT and says it is not a warehouse", () => {
  assert.ok(/not a warehouse/.test(SRC));
  assert.ok(COUNTABLE.includes("Encounter"));
  assert.ok(!COUNTABLE.includes("Patient"), "the people themselves are not a countable type here");
});
