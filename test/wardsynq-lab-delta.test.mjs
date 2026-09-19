/* test/wardsynq-lab-delta.test.mjs — "this cannot be the same patient". Pure.
 *
 * node --test test/wardsynq-lab-delta.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { limitFor, previousFor, deltaCheck, autoVerify } from "../functions/_wardsynq/lab-delta.js";

const CODE = "2160-0";                       // creatinine
const LIMITS = { "2160-0": { maxAbsolute: 50, maxPercent: 30, withinHours: 72 } };
const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const obs = (over) => ({
  code: CODE, category: "laboratory", value: 78, unit: "umol/L",
  meta: { effectiveAt: "2026-09-06T12:00:00.000Z" }, ...(over || {}),
});
const check = (over) => deltaCheck({ code: CODE, unit: "umol/L", value: 240, deltaLimits: LIMITS, observations: [obs()], nowMs: NOW, ...(over || {}) });

test("A BIG CHANGE IS FLAGGED AND THE RESULT IS STILL RELEASED", () => {
  const d = check();
  assert.equal(d.state, "breach");
  assert.equal(d.change, 162);
  assert.equal(d.direction, "rise");
  assert.deepEqual(d.breaches.map((b) => b.rule).sort(), ["absolute", "percent"]);
  /* The commonest explanation for an impossible change is not the disease - it is a mislabelled tube
   * or two swapped samples, and that is what the wording has to make a reader think of. */
  assert.match(d.detail, /check the sample identity/);
  assert.match(d.detail, /NOT been withheld/);
});

test("NOT CHECKED IS NOT THE SAME AS PASSED, and there are five ways to be unchecked", () => {
  /* Returning a bare pass for any of these would read as "we compared it and it was fine", which is
   * the one thing a delta check must never say when it did not compare anything. */
  assert.equal(check({ value: "No growth" }).state, "not-checked");
  assert.equal(check({ value: "No growth" }).reason, "non_numeric_result");

  assert.equal(check({ deltaLimits: {} }).reason, "no_limit_configured");
  assert.equal(check({ observations: [] }).reason, "no_previous_result");

  // A previous value from outside the window is NOT "none": it exists, and it was deliberately not
  // used. A reader deserves to know that rather than assume the patient has no history.
  const stale = check({ observations: [obs({ meta: { effectiveAt: "2026-06-01T12:00:00.000Z" } })] });
  assert.equal(stale.reason, "stale");
  assert.ok(stale.previous.ageHours > 2000);

  /* THE UNIT MISMATCH. A creatinine in µmol/L against one in mg/dL differs by 88x, so a check that
   * quietly compared them would fire on every patient whose sample went to a different analyser. */
  const units = check({ observations: [obs({ unit: "mg/dL", value: 0.9 })] });
  assert.equal(units.reason, "unit_mismatch");
  assert.equal(units.previous.previousUnit, "mg/dL");
});

test("a change inside the hospital's limits passes, and the limits are the HOSPITAL's", () => {
  const ok = check({ value: 90 });
  assert.equal(ok.state, "pass");
  assert.equal(ok.change, 12);
  assert.equal(ok.percent, 15.4);
  assert.equal(ok.previous.value, 78);

  // Nothing in this file knows what a big change in a creatinine is.
  assert.equal(limitFor(null, CODE), null);
  assert.equal(limitFor({ "2160-0": {} }, CODE), null, "a rule with no threshold is not a rule");
  assert.equal(limitFor(LIMITS, "9999-9"), null);
  assert.equal(limitFor(LIMITS, CODE).withinHours, 72);
  assert.equal(limitFor({ "2160-0": { maxAbsolute: 50 } }, CODE).withinHours, 72, "a sensible default window, and only for the window");

  // A previous value of zero has no percentage change; dividing by it would breach every such pair.
  const fromZero = check({ value: 5, observations: [obs({ value: 0 })] });
  assert.equal(fromZero.percent, null);
  assert.equal(fromZero.state, "pass", "5 is within the absolute limit of 50");
});

test("the previous result is the most recent COMPARABLE one", () => {
  const rows = [
    obs({ value: 70, meta: { effectiveAt: "2026-09-05T12:00:00.000Z" } }),
    obs({ value: 78, meta: { effectiveAt: "2026-09-06T12:00:00.000Z" } }),
    obs({ code: "2823-3", value: 4.1, meta: { effectiveAt: "2026-09-07T06:00:00.000Z" } }),  // a different analyte
    { code: CODE, category: "vital-signs", value: 999, unit: "umol/L", meta: { effectiveAt: "2026-09-07T09:00:00.000Z" } },
  ];
  const p = previousFor(rows, CODE, "umol/L", NOW, 72);
  assert.equal(p.state, "ok");
  assert.equal(p.value, 78, "the most recent creatinine, not the potassium and not the vital sign");
  assert.equal(previousFor([], CODE, "umol/L", NOW, 72).state, "none");
  assert.equal(previousFor([obs({ value: "haemolysed" })], CODE, "umol/L", NOW, 72).state, "non-numeric");
});

test("AUTOVERIFICATION FAILS CLOSED: absence never counts as passing", () => {
  const RANGE = { low: 60, high: 110 };
  const cfg = { enabled: true, codes: [CODE] };
  const base = { code: CODE, value: 80, unit: "umol/L", referenceRange: RANGE, autoVerify: cfg, delta: { state: "pass" } };

  assert.equal(autoVerify(base).verified, true);

  // Off by default. A hospital that has not asked for this looks at everything.
  assert.deepEqual(autoVerify({ ...base, autoVerify: null }).reasons, ["not_enabled"]);
  assert.deepEqual(autoVerify({ ...base, autoVerify: { enabled: false, codes: [CODE] } }).reasons, ["not_enabled"]);

  // Each of these is a thing a human still has to do, and "held" with no reason is a bug report.
  assert.deepEqual(autoVerify({ ...base, code: "9999-9" }).reasons, ["analyte_not_listed"]);
  assert.deepEqual(autoVerify({ ...base, value: "No growth at 48h" }).reasons, ["non_numeric"]);
  assert.deepEqual(autoVerify({ ...base, sourceCritical: true }).reasons, ["flagged_critical_by_lab"]);
  assert.deepEqual(autoVerify({ ...base, value: 400 }).reasons, ["above_reference_range"]);
  assert.deepEqual(autoVerify({ ...base, value: 10 }).reasons, ["below_reference_range"]);
  // NO RANGE IS NOT A PASS. There is nothing to check against, so a human checks.
  assert.deepEqual(autoVerify({ ...base, referenceRange: null }).reasons, ["no_reference_range"]);
  assert.deepEqual(autoVerify({ ...base, delta: { state: "breach" } }).reasons, ["delta_breach"]);
  // A delta that could not be computed holds it too...
  assert.deepEqual(autoVerify({ ...base, delta: { state: "not-checked", reason: "unit_mismatch" } }).reasons, ["delta_unit_mismatch"]);
  /* ...except where the patient simply has no previous result. A first result cannot have a delta,
   * and holding every one would mean holding most of a new admission's bloods for no finding. */
  assert.equal(autoVerify({ ...base, delta: { state: "not-checked", reason: "no_previous_result" } }).verified, true);

  // Several failures are all reported, not just the first: they are all work.
  const many = autoVerify({ ...base, value: 400, sourceCritical: true, delta: { state: "breach" } });
  assert.deepEqual(many.reasons.sort(), ["above_reference_range", "delta_breach", "flagged_critical_by_lab"]);
});
