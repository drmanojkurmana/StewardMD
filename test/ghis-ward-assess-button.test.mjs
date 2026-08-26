/* Ward Sync already lists the admitted patients. Let the doctor tap one and assess.
 *
 * Owner, 2026-08-26: "how are you getting patients list in ward sync after login — all those
 * patients are admitted patients. Simple: let user click on anyone and do initial assessment."
 *
 * That is the whole design, and it makes most of the machinery around it unnecessary. GetIPWL IS
 * the admitted roster, and every row already carries its IPMR admission as `episodeId`. So there is
 * nothing to look up and no episode to resolve: the two ids the assessment needs are already in
 * hand at the moment of the tap. The roster-search fallback in saveAssessment stays only for
 * callers that arrive WITHOUT an episode; it is not the path a ward tap takes.
 *
 * Verified against the live server (docs/ghis/captured-initial-assessment-write.md section 5): an
 * admitted patient activates with the same <MR>-<visit> recordNo as an out-patient, and the Initial
 * assessment tab is the same form. So this reuses OPDEMR.openProfile rather than building a second
 * assessment screen that would drift from the first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WARD = readFileSync(new URL("../ghis-ward.js", import.meta.url), "utf8");
const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

const fn = WARD.slice(WARD.indexOf("openAssessment: function"), WARD.indexOf("onPatient: function"));

test("every admitted patient card offers an Assess action", () => {
  assert.match(WARD, /GHIS\.openAssessment\(/, "the card must call it");
  assert.match(WARD, /ghis-pt-assess/, "and it is a real button, not a hidden affordance");
  assert.match(WARD, /title="Initial assessment"/);
});

test("the tap hands over the ids the row already has — nothing is looked up", () => {
  assert.match(fn, /patientId: patientId/);
  assert.match(fn, /episodeId: episodeId/);
  assert.ok(!/fetch\(|listNotes|getOpdPatients|resolveEpisode/.test(fn),
    "a ward tap must not go hunting for an episode it was already given");
});

test("for an in-patient the admission IS the visit", () => {
  // visitId drives the history timeline (Getopcard); for an admission there is no separate OP number.
  assert.match(fn, /visitId: episodeId/);
});

test("it opens the assessment tab of the SAME workspace the OPD queue uses", () => {
  /* Not a second assessment screen. opd-emr.js owns the form, the voice scribe, the Save/Authorise
   * lock and the GHIS write path; a parallel one would drift from all four. */
  assert.match(fn, /window\.OPDEMR\.openProfile\(/);
  assert.match(fn, /tab: 'assess'/);
  assert.match(fn, /source: 'ghis'/);
  assert.match(OPD, /G\.OPDEMR = \{ openProfile: openProfile/, "that entry point is the public one");
});

test("a row missing either id is refused with a reason, not opened blank", () => {
  /* An assessment attaches to a VISIT. Opening the workspace with no episode gives the doctor a
   * form that cannot be saved, which they only discover after typing the consult. */
  assert.match(fn, /if \(!patientId\)/);
  assert.match(fn, /if \(!episodeId\)/);
  assert.match(fn, /no hospital record number/i);
  assert.match(fn, /cannot be filed against it/i);
  assert.ok(fn.indexOf("if (!patientId)") < fn.indexOf("window.OPDEMR.openProfile("),
    "both checks run before the workspace opens");
});

test("it degrades honestly if the workspace has not loaded yet", () => {
  assert.match(fn, /openProfile\)\) \{[^}]*still loading/i,
    "a missing OPDEMR must toast, never throw silently on tap");
});

test("the ward drawer closes, so the assessment is not opened behind it", () => {
  assert.match(fn, /ghisPanel[\s\S]{0,80}classList\.remove\('open'\)/);
});

test("it uses window.* like the rest of this file", () => {
  /* ghis-ward.js has no `G` alias — an early version of this used G.OPDEMR and would have thrown
   * ReferenceError on the first tap, on a screen no unit test renders. */
  assert.ok(!/\bG\.(OPDEMR|toast)\b/.test(fn), "no bare G.* reference may return");
  assert.match(fn, /window\.OPDEMR/);
});

test("tapping the card itself still does what it always did", () => {
  // The Assess button is additive: the card tap remains lab/import/pick.
  assert.match(WARD, /onPatient: function\(episodeId, patientId, name\)/);
  assert.match(WARD, /GHIS\.openLab\(episodeId, patientId, name\)/);
  assert.match(WARD, /event\.stopPropagation\(\);GHIS\.openAssessment/,
    "the button must not also trigger the card's own tap");
});
