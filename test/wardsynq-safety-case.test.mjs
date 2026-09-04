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
  // The cap is asserted against a SYNTHETIC hazard rather than against the live table, so the rule
  // stays enforced no matter how the real table evolves. Two earlier versions of this test went
  // stale in exactly that way: one named HAZ-AI-01, then the set of partials emptied entirely as the
  // controls were built, and a rule that can pass vacuously is a rule that quietly stops working.
  //
  // Historical note, kept because it is why the cap exists: on this file's first run HAZ-AI-01 and
  // HAZ-DEV-01 both reported VERIFIED while carrying caveats saying no control had been built,
  // because a passing field-shape test turned the row green.
  const fixture = [{
    id: "HAZ-FIXTURE", hazard: "a partial control with perfect tests",
    requirement: "x", residualRisk: "x", approver: "x",
    control: { kind: "half a control", adequacy: "partial", module: "fixture.js", summary: "x" },
    verification: { file: "fixture.test.mjs", tests: ["fixture passes"] },
    caveat: "the other half is missing",
  }];
  const capped = assess([{ name: "fixture passes", passed: true }], fixture)[0];
  assert.equal(capped.status, STATUS.PARTIAL,
    "an all-green run must not promote a control that only does half the job");
  assert.notEqual(capped.status, STATUS.VERIFIED);

  // And whatever the live table currently says, no partial in it is ever reported as verified.
  for (const h of HAZARDS.filter((x) => x.control.module && x.control.adequacy !== "full")) {
    assert.equal(a.find((x) => x.id === h.id).status, STATUS.PARTIAL, `${h.id} must not be promoted`);
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
  const severity = ["uncontrolled", "no-evidence", "failing", "partial", "verified"];
  // Matches a status ROW specifically: a status word followed by a hazard id. The looser version
  // also matched the report's own "VERIFIED means the named tests pass" qualifier line.
  const statusesOf = (text) => text.split("\n")
    .filter((l) => /^(UNCONTROLLED|NO-EVIDENCE|FAILING|PARTIAL|VERIFIED)\s+(HAZ|H)-/.test(l))
    .map((l) => l.split(/\s+/)[0].toLowerCase());

  // Asserted against a synthetic table containing one of everything, so the ordering rule is
  // exercised even when the real hazard table happens to be entirely green. A version of this test
  // pinned to the live table went stale the moment the last gap was closed.
  const mixed = [
    { id: "H-OK", hazard: "verified", requirement: "x", residualRisk: "x", approver: "x", caveat: "c",
      control: { kind: "k", adequacy: "full", module: "m.js", summary: "s" },
      verification: { file: "f", tests: ["green"] } },
    { id: "H-NONE", hazard: "uncontrolled", requirement: "x", residualRisk: "x", approver: "x", caveat: "c",
      control: { kind: null, adequacy: "none", module: null, summary: "s" }, verification: { file: null, tests: [] } },
    { id: "H-HALF", hazard: "partial", requirement: "x", residualRisk: "x", approver: "x", caveat: "c",
      control: { kind: "k", adequacy: "partial", module: "m.js", summary: "s" },
      verification: { file: "f", tests: ["green"] } },
    { id: "H-BAD", hazard: "failing", requirement: "x", residualRisk: "x", approver: "x", caveat: "c",
      control: { kind: "k", adequacy: "full", module: "m.js", summary: "s" },
      verification: { file: "f", tests: ["red"] } },
  ];
  const mixedStatuses = statusesOf(report(assess([{ name: "green", passed: true }, { name: "red", passed: false }], mixed)));
  assert.equal(mixedStatuses[0], "uncontrolled",
    "an assurance report that opens with its successes is a marketing document");
  assert.equal(mixedStatuses.at(-1), "verified", "and successes come last");
  assert.deepEqual(mixedStatuses.map((s) => severity.indexOf(s)), [...mixedStatuses.map((s) => severity.indexOf(s))].sort((a, b) => a - b),
    "rows stay ordered worst first all the way down, not just at the top");

  // The live table must obey the same ordering, whatever it currently contains.
  const text = report(assess(allPassing(), HAZARDS));
  const live = statusesOf(text).map((s) => severity.indexOf(s));
  assert.deepEqual(live, [...live].sort((a, b) => a - b), "the real report is ordered worst first");
  assert.match(text, /caveat:/, "every claim carries its caveat in the same view");
});

test("case: the hazards named in the spec's table are all present", () => {
  const ids = HAZARDS.map((h) => h.id);
  for (const id of ["HAZ-MED-01", "HAZ-MED-02", "HAZ-MED-03", "HAZ-MED-04", "HAZ-BLD-01",
    "HAZ-SURG-01", "HAZ-DIAG-01", "HAZ-ID-01", "HAZ-AI-01", "HAZ-DEV-01", "HAZ-DOWN-01"]) {
    assert.ok(ids.includes(id), `${id} from the spec's assurance table is accounted for`);
  }
});


test("case: the report always qualifies what VERIFIED means, even when everything is green", () => {
  // The count reaching 11 of 11 is exactly when this artefact is most likely to be misread as
  // "safe to use on patients". The qualifier is unconditional for that reason.
  const text = report(assess(allPassing(), HAZARDS));
  assert.match(text, /VERIFIED means the named tests pass/,
    "a headline count with nothing beside it will be read as a safety claim");
  assert.match(text, /NOT mean the control is clinically adequate/);
  assert.match(text, /CLINICALLY VALIDATED or CLINICALLY APPROVED/);

  // And it is present on an all-green table too, not only when something is outstanding.
  const allGreen = [{
    id: "H-ONE", hazard: "everything is fine", requirement: "x", residualRisk: "x", approver: "x",
    caveat: "UNAPPROVED seed content.",
    control: { kind: "k", adequacy: "full", module: "m.js", summary: "s" },
    verification: { file: "f", tests: ["green"] },
  }];
  const green = report(assess([{ name: "green", passed: true }], allGreen));
  assert.match(green, /1 of 1 hazards fully verified/);
  assert.match(green, /VERIFIED means the named tests pass/, "still qualified at 1 of 1");
  assert.match(green, /1 of 1 hazards carry a caveat about unapproved/,
    "and the count of unapproved clinical content is stated in the same breath as the success count");
});
