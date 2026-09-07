/* test/wardsynq-fluid-balance.test.mjs — intake, output, and the balance between them. Pure half.
 *
 * node --test test/wardsynq-fluid-balance.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE, OUTPUT, UNIT, SYSTEM, CATEGORY,
  fluidCode, displayOf, directionOf, fluidIdFor, fluidToObservations, summariseBalance,
} from "../functions/_wardsynq/fluid-balance.js";

const ENC = "wsq-adm-1", PAT = "opd-pat-1";
const make = (entries) => fluidToObservations({ entries, patientId: PAT, encounterId: ENC });
/** An observation as the store hands it back, with the effective time on meta. */
const at = (code, value, iso) => ({
  category: CATEGORY, codeSystem: SYSTEM, code, value, unit: UNIT,
  meta: { effectiveAt: iso, recordedAt: iso },
});

test("the vocabulary is closed, honestly local, and never claims a code it does not have", () => {
  assert.equal(fluidCode("intake", "oral"), "intake.oral");
  assert.equal(fluidCode("output", "urine"), "output.urine");
  assert.equal(fluidCode("INTAKE", "IV"), "intake.iv", "case is not identity");
  assert.equal(fluidCode("output", "oral"), null, "an intake kind is not an output");
  assert.equal(fluidCode("sideways", "urine"), null);
  assert.equal(fluidCode("intake", "telepathy"), null);
  // "other" exists so nothing a ward measures is unrecordable.
  assert.ok(INTAKE.other && OUTPUT.other);
  assert.equal(displayOf("output.drain"), "Drain");
  assert.equal(directionOf("intake.ng"), "intake");
  // A local system, labelled as local. A guessed LOINC on a clinical observation survives every
  // export afterwards, so there are none here.
  assert.equal(SYSTEM, "wardsynq-fluid");
  assert.equal(make([{ direction: "intake", kind: "oral", value: 200, at: "2026-09-07T09:00:00.000Z" }]).observations[0].codeSystem, SYSTEM);
});

test("a volume that is not plainly one number is NOT recorded and NOT guessed at", () => {
  const r = make([
    { direction: "intake", kind: "oral", value: "a cup", at: "2026-09-07T09:00:00.000Z" },
    { direction: "intake", kind: "oral", value: "approx 500", at: "2026-09-07T10:00:00.000Z" },
    { direction: "output", kind: "urine", value: "", at: "2026-09-07T11:00:00.000Z" },
    { direction: "output", kind: "urine", value: -50, at: "2026-09-07T12:00:00.000Z" },
    { direction: "intake", kind: "iv", value: "250", at: "2026-09-07T13:00:00.000Z" },   // a number in a string IS one
  ]);
  assert.equal(r.observations.length, 1, "only the real number is recorded");
  assert.equal(r.observations[0].value, 250);
  assert.deepEqual(r.rejected.map((x) => x.reason), ["not_a_number", "not_a_number", "not_a_number", "negative"]);
  // Rejections carry what was sent, so a ward can see WHICH row to fix.
  assert.equal(r.rejected[1].value, "approx 500");
});

test("UNITS ARE NEVER CONVERTED: an unusable unit is refused rather than multiplied", () => {
  const r = make([
    { direction: "intake", kind: "iv", value: 1, unit: "L", at: "2026-09-07T09:00:00.000Z" },
    { direction: "intake", kind: "oral", value: 200, unit: "ml", at: "2026-09-07T10:00:00.000Z" },
    { direction: "output", kind: "urine", value: 300, unit: "cc", at: "2026-09-07T11:00:00.000Z" },
    { direction: "output", kind: "drain", value: 50, at: "2026-09-07T12:00:00.000Z" },       // no unit given: mL
  ]);
  // A silent x1000 reaching a fluid balance is the error this refuses to risk.
  assert.deepEqual(r.rejected.map((x) => x.reason), ["unusable_unit"]);
  assert.equal(r.rejected[0].unit, "L");
  assert.equal(r.observations.length, 3);
  assert.ok(r.observations.every((o) => o.unit === UNIT));
});

test("one entry per kind per recorded minute, so a double tap is not a second cup of tea", () => {
  const a = fluidIdFor(ENC, "2026-09-07T09:00:00.000Z", "intake.oral");
  const b = fluidIdFor(ENC, "2026-09-07T09:00:00.000Z", "intake.oral");
  assert.equal(a, b);
  assert.notEqual(a, fluidIdFor(ENC, "2026-09-07T09:00:00.000Z", "output.urine"));
  assert.notEqual(a, fluidIdFor(ENC, "2026-09-07T10:00:00.000Z", "intake.oral"));
  assert.equal(fluidIdFor("", "2026-09-07T09:00:00.000Z", "intake.oral"), null);
  // A bad timestamp is refused rather than defaulted to now, which would file it in the wrong hour.
  assert.deepEqual(make([{ direction: "intake", kind: "oral", value: 100, at: "never" }]).rejected.map((x) => x.reason), ["bad_time"]);
});

test("INTAKE AND OUTPUT ARE ALWAYS BOTH REPORTED, never just the net", () => {
  const rows = [
    at("intake.oral", 400, "2026-09-07T09:10:00.000Z"),
    at("output.urine", 0, "2026-09-07T09:30:00.000Z"),
  ];
  const drank = summariseBalance(rows, { from: "2026-09-07T09:00:00.000Z", to: "2026-09-07T10:00:00.000Z" });
  const churned = summariseBalance([
    at("intake.iv", 3000, "2026-09-07T09:10:00.000Z"),
    at("output.urine", 2600, "2026-09-07T09:30:00.000Z"),
  ], { from: "2026-09-07T09:00:00.000Z", to: "2026-09-07T10:00:00.000Z" });

  // Both are "+400". They are different patients and one of them is in trouble.
  assert.equal(drank.balance, 400);
  assert.equal(churned.balance, 400);
  assert.deepEqual([drank.intake, drank.output], [400, 0]);
  assert.deepEqual([churned.intake, churned.output], [3000, 2600]);
  assert.equal(drank.unit, "mL");
  assert.deepEqual(drank.byKind, { "intake.oral": 400, "output.urine": 0 });
});

test("A BALANCE SAYS WHAT IT IS MISSING: the hours nobody charted are named", () => {
  const twelve = { from: "2026-09-07T08:00:00.000Z", to: "2026-09-07T20:00:00.000Z" };
  const thin = summariseBalance([
    at("intake.oral", 200, "2026-09-07T08:30:00.000Z"),
    at("output.urine", 150, "2026-09-07T09:30:00.000Z"),
  ], twelve);
  // A twelve-hour balance built from two entries is not a twelve-hour balance, and the total alone
  // cannot say so. A falsely reassuring fluid balance is worse than none, because somebody acts on it.
  assert.equal(thin.entries, 2);
  assert.equal(thin.complete, false);
  assert.equal(thin.gaps.length, 10, "ten of the twelve hours have nothing charted");
  assert.equal(thin.gaps[0], "2026-09-07T10:00:00.000Z");
  assert.deepEqual(thin.hours.map((h) => h.hour), ["2026-09-07T08:00:00.000Z", "2026-09-07T09:00:00.000Z"]);
  assert.deepEqual(thin.hours[0], { hour: "2026-09-07T08:00:00.000Z", intake: 200, output: 0 });

  // A fully charted period says so outright rather than leaving it to be inferred.
  const full = [];
  for (let h = 8; h < 20; h++) full.push(at("output.urine", 50, `2026-09-07T${String(h).padStart(2, "0")}:15:00.000Z`));
  const complete = summariseBalance(full, twelve);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.gaps, []);
  assert.equal(complete.output, 600);

  // An empty period is NOT complete: nothing charted is not the same as nothing happened.
  const none = summariseBalance([], twelve);
  assert.equal(none.complete, false);
  assert.equal(none.entries, 0);
  assert.equal(none.gaps.length, 12);
});

test("the window is respected, and foreign observations never leak into a balance", () => {
  const rows = [
    at("intake.oral", 500, "2026-09-07T07:59:00.000Z"),   // before
    at("intake.oral", 100, "2026-09-07T08:30:00.000Z"),   // in
    at("intake.oral", 900, "2026-09-07T10:00:00.000Z"),   // at `to`, exclusive
    // A vital sign is not a fluid entry, even though both are Observations.
    { category: "vital-signs", codeSystem: "http://loinc.org", code: "8867-4", value: 88, unit: "/min", meta: { effectiveAt: "2026-09-07T08:40:00.000Z" } },
  ];
  const s = summariseBalance(rows, { from: "2026-09-07T08:00:00.000Z", to: "2026-09-07T10:00:00.000Z" });
  assert.equal(s.intake, 100);
  assert.equal(s.entries, 1);
});
