/* test/wardsynq-safety-case.test.mjs — the safety case itself.
 *
 * A safety case is a claim about other software, so the thing worth testing is whether it can be
 * WRONG in the flattering direction: reporting a hazard as handled when it is not. Every test here
 * is an attempt to make it lie.
 *
 * node --test test/wardsynq-safety-case.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { HAZARDS, STATUS, assess, summarise, report } from "../wardsynq/wardsynq-safety-case.js";

/** A passing result for every test any hazard declares: the most flattering possible input. */
function allPassing(hazards = HAZARDS) {
  return hazards.flatMap((h) => (h.verification.tests || []).map((name) => ({ name, passed: true })));
}

test("case: every hazard declares a requirement, a residual risk and a named approver", () => {
  for (const h of HAZARDS) {
    assert.ok(h.id && /^HAZ-/.test(h.id), `${h.id} has an id`);
    assert.ok(h.requirement && h.requirement.length > 20, `${h.id} states a requirement`);
    assert.ok(h.residualRisk, `${h.id} states residual risk`);
    assert.ok(h.approver, `${h.id} names who signs it off, because no code can approve a clinical control`);
    assert.ok("adequacy" in h.control, `${h.id} declares how much of the requirement its control covers`);
  }
});

test("case: a hazard with no control can never report as handled, however many tests pass", () => {
  const a = assess(allPassing(), HAZARDS);
  for (const r of a.filter((x) => !x.control.module)) {
    assert.equal(r.status, STATUS.UNCONTROLLED,
      `${r.id} has nothing built and must say so even on a fully green test run`);
  }
});

test("case: a PARTIAL control is capped and can never reach verified", () => {
  const a = assess(allPassing(), HAZARDS);
  for (const r of a) {
    if (r.control.module && r.control.adequacy !== "full") {
      assert.equal(r.status, STATUS.PARTIAL,
        `${r.id} is a partial control; passing tests must not promote it to verified`);
    }
  }
  // The cap must actually be doing work, not passing vacuously because nothing is partial any more.
  // Pinned to whatever is currently declared partial rather than to an id, because the previous
  // version named HAZ-AI-01 and went stale the moment that control was genuinely built.
  //
  // Historical note, kept because it is the reason the cap exists: on this file's first run
  // HAZ-AI-01 and HAZ-DEV-01 both reported VERIFIED while carrying caveats saying no control had
  // been built, because a passing field-shape test turned the row green.
  const partials = HAZARDS.filter((h) => h.control.module && h.control.adequacy !== "full");
  assert.ok(partials.length > 0,
    "if nothing is partial, this test is vacuous; add a partial fixture rather than deleting the rule");
  for (const h of partials) {
    const r = a.find((x) => x.id === h.id);
    assert.equal(r.status, STATUS.PARTIAL, `${h.id} is a partial control and a green test run must not promote it`);
    assert.notEqual(r.status, STATUS.VERIFIED);
  }
});

test("case: a renamed or deleted test surfaces as missing evidence, not as success", () => {
  const hazard = HAZARDS.find((h) => h.id === "HAZ-MED-01");
  const stale = allPassing().filter((r) => r.name !== hazard.verification.tests[0]);
  const r = assess(stale, [hazard])[0];
  assert.equal(r.status, STATUS.FAILING);
  assert.deepEqual(r.missingEvidence, [hazard.verification.tests[0]],
    "the case must name the test it can no longer find, or it silently decays as the suite is refactored");
});

test("case: a failing test fails its hazard", () => {
  const hazard = HAZARDS.find((h) => h.id === "HAZ-MED-02");
  const results = allPassing().map((r) => (r.name === hazard.verification.tests[0] ? { ...r, passed: false } : r));
  assert.equal(assess(results, [hazard])[0].status, STATUS.FAILING);
});

test("case: an empty test run leaves nothing looking verified", () => {
  const a = assess([], HAZARDS);
  assert.equal(a.some((r) => r.status === STATUS.VERIFIED), false,
    "with no evidence at all, no hazard may claim verification");
  for (const r of a.filter((x) => x.control.module)) {
    assert.equal(r.status, STATUS.NO_EVIDENCE, `${r.id} has a control but no evidence in this run`);
  }
});

test("case: fragment matching still requires a real hit", () => {
  const hazard = HAZARDS.find((h) => h.verification.matchMode === "fragment");
  assert.ok(hazard, "at least one hazard matches evidence by fragment");
  assert.equal(assess([{ name: "something unrelated entirely", passed: true }], [hazard])[0].status,
    STATUS.NO_EVIDENCE, "a fragment that matches nothing is no evidence");
});

test("case: the summary counts every hazard exactly once", () => {
  const a = assess(allPassing(), HAZARDS);
  const s = summarise(a);
  assert.equal(s.uncontrolled + s["no-evidence"] + s.failing + s.partial + s.verified, s.total);
  assert.equal(s.total, HAZARDS.length);
});

test("case: the report leads with the worst status present, never with successes", () => {
  // Asserted as the general invariant rather than as a literal first row. The literal version said
  // UNCONTROLLED and went stale the moment the last uncontrolled hazard was actually built, which
  // would have pressured a future reader to relax the rule instead of the assertion.
  const assessment = assess(allPassing(), HAZARDS);
  const text = report(assessment);
  const severity = ["uncontrolled", "no-evidence", "failing", "partial", "verified"];
  const worstPresent = severity.find((s) => assessment.some((a) => a.status === s));

  const rows = text.split("\n").filter((l) => /^(UNCONTROLLED|NO-EVIDENCE|FAILING|PARTIAL|VERIFIED)/.test(l));
  assert.equal(rows[0].split(/\s+/)[0].toLowerCase(), worstPresent,
    "an assurance report that opens with its successes is a marketing document");
  assert.notEqual(rows[0].split(/\s+/)[0], "VERIFIED",
    "while anything is unverified, a verified row must never be the first thing read");

  // And the ordering holds all the way down, not just at the top.
  const seen = rows.map((r) => severity.indexOf(r.split(/\s+/)[0].toLowerCase()));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), "rows stay ordered worst first");
  assert.match(text, /caveat:/, "every claim carries its caveat in the same view");
});

test("case: the hazards named in the spec's table are all present", () => {
  const ids = HAZARDS.map((h) => h.id);
  for (const id of ["HAZ-MED-01", "HAZ-MED-02", "HAZ-MED-03", "HAZ-MED-04", "HAZ-BLD-01",
    "HAZ-SURG-01", "HAZ-DIAG-01", "HAZ-ID-01", "HAZ-AI-01", "HAZ-DEV-01", "HAZ-DOWN-01"]) {
    assert.ok(ids.includes(id), `${id} from the spec's assurance table is accounted for`);
  }
});
