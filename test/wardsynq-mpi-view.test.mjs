/* test/wardsynq-mpi-view.test.mjs — finding the patient who is already here.
 *
 * node --test test/wardsynq-mpi-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POOL, candidateFrom, hitFor } from "../functions/_wardsynq/mpi-view.js";
import { findCandidates, scoreMatch, PROVISIONAL_DOB_SENTINEL, DEFAULT_THRESHOLDS } from "../wardsynq/wardsynq-mpi.js";

const pat = (over = {}) => ({ id: "pat-1", mrn: "MRN-1", name: "Ramesh Kumar", dob: "1980-04-12", sex: "male", identifiers: [], ...over });

test("THE SENTINEL DATE IS NOT EVIDENCE: two unidentified arrivals are not thereby a match", () => {
  /* wardsynq-mpi.js puts 0000-00-00 on an unidentified arrival precisely so age arithmetic fails
   * loudly. Passing it through as a date would make every trauma arrival match every other one on
   * their shared non-date. */
  const c = candidateFrom({ name: "Unknown Male", dob: PROVISIONAL_DOB_SENTINEL });
  assert.equal(c.dob, "", "the sentinel is stripped, not forwarded");

  const withSentinel = scoreMatch(
    candidateFrom({ name: "Unknown Male", dob: PROVISIONAL_DOB_SENTINEL }),
    pat({ id: "pat-9", name: "Unknown Female", dob: PROVISIONAL_DOB_SENTINEL }));
  const dobField = (withSentinel.breakdown || []).find((f) => f.field === "dob");
  assert.ok(!dobField || dobField.agreed !== true, "the shared non-date never counts as agreement");
});

test("PURE: the candidate is not a canonical Patient, because neither mrn nor dob exists yet", () => {
  /* The whole point of searching BEFORE creating is that the record does not exist. A constructor
   * that required an mrn would make the most valuable search - the one at the desk - impossible. */
  const c = candidateFrom({ name: "  Dr Ramesh   Kumar " });
  assert.equal(c.name, "Dr Ramesh   Kumar".trim());
  assert.equal(c.mrn, "");
  assert.equal(c.dob, "");
  assert.deepEqual(c.identifiers, []);
  // A non-array identifiers field is not passed through as one.
  assert.deepEqual(candidateFrom({ name: "x", identifiers: "abc" }).identifiers, []);
});

test("a strong match surfaces WITH ITS REASONS, because a bare score is unarguable", () => {
  const hits = findCandidates(
    candidateFrom({ name: "Ramesh Kumar", dob: "1980-04-12", sex: "male" }),
    [pat(), pat({ id: "pat-2", mrn: "MRN-2", name: "Suresh Patel", dob: "1972-01-03", sex: "male" })]);
  assert.ok(hits.length >= 1);
  const top = hitFor(hits[0]);
  assert.equal(top.patientId, "pat-1");
  assert.ok(top.score > 0);
  assert.ok(top.agreed.includes("name"));
  assert.ok(top.agreed.includes("dob"));
  // The clerk gets the patient's identifying fields and never the chart.
  assert.deepEqual(Object.keys(top).sort(),
    ["agreed", "band", "disagreed", "dob", "mrn", "name", "patientId", "score", "sex"]);
});

test("A RECORD NEVER MATCHES ITSELF, so searching from an existing patient is safe", () => {
  const self = pat();
  const hits = findCandidates({ ...candidateFrom(self), id: self.id }, [self, pat({ id: "pat-2", mrn: "MRN-2", name: "Ramesh Kumar", dob: "1980-04-12", sex: "male" })]);
  assert.ok(!hits.some((h) => h.patient.id === "pat-1"));
  assert.ok(hits.some((h) => h.patient.id === "pat-2"), "the genuine twin still surfaces");
});

const SRC = readFileSync(new URL("../functions/_wardsynq/mpi-view.js", import.meta.url), "utf8");

test("NOTHING HERE LINKS ANYTHING, at any score", () => {
  /* The module computes an `auto` band and this adapter deliberately does not act on it. An
   * automatic link at 0.5 would bypass identity-merge.js, whose whole design is that a merge is a
   * human claim that moves no clinical row and can be retracted. */
  assert.ok(!/\bmerge\s*\(/.test(SRC), "the adapter never calls merge()");
  assert.ok(!/PatientLink/.test(SRC), "and writes no link record");
  // A read path only: no write of any kind reaches the record from here.
  assert.ok(!/svc\.put\(/.test(SRC));
  assert.ok(!/"record:write"/.test(SRC));
});

test("A CAPPED SEARCH THAT FINDS NOTHING IS NOT A CLEAR ANSWER", () => {
  /* The single most dangerous way this feature could fail: a truncated pool reporting no duplicate,
   * with a reassuring message, while the patient's existing record sits outside the page. */
  assert.equal(POOL, 500);
  assert.ok(/partial: capped/.test(SRC), "the flag is on every response, not only when convenient");
  assert.ok(/does not mean this patient is new/.test(SRC));
});

test("the thresholds are the module's, and a hospital may only override them explicitly", () => {
  assert.equal(DEFAULT_THRESHOLDS.auto, 0.5);
  assert.equal(DEFAULT_THRESHOLDS.review, 0.13);
  /* 0.5 is exactly one national identifier's worth of agreement: a perfect name plus dob plus sex
   * cannot reach it, because namesakes born on the same day are not rare enough to bet a chart on. */
  const namesake = scoreMatch(
    candidateFrom({ name: "Ramesh Kumar", dob: "1980-04-12", sex: "male" }),
    pat({ id: "pat-2" }));
  assert.ok(namesake.score < DEFAULT_THRESHOLDS.auto, `a perfect namesake scored ${namesake.score}`);
});
