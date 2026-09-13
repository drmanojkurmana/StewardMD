/* test/wardsynq-mpi.test.mjs: WardSynQ P0 Master Patient Identity engine.
 *
 * Identity is where wrong-patient errors are born, so these tests are about the two failure modes
 * rather than coverage: linking two people who are not the same person, and losing the ability to
 * take a link back. The string functions are pinned to published reference values because a silently
 * wrong Jaro-Winkler would move every score in the system without breaking anything visibly.
 *
 * node --test test/wardsynq-mpi.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Patient } from "../wardsynq/wardsynq-model.js";
import {
  normalizeName, soundex, jaroWinkler,
  DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS,
  scoreMatch, findCandidates,
  PROVISIONAL_DOB_SENTINEL, makeProvisionalIdentity,
  merge, unmerge,
} from "../wardsynq/wardsynq-mpi.js";

/* ------------------------------------------------------------------ fixtures */

function aPatient(over) {
  return Patient({
    mrn: "MRN-0001",
    name: "Anita Rao",
    dob: "1984-03-11",
    sex: "female",
    identifiers: [{ system: "ABHA", value: "11-2222-3333-4444" }, { system: "mobile", value: "+91 98765 43210" }],
    ...over,
  });
}

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} (got ${actual}, expected ~${expected})`);

/* ------------------------------------------------------------------ string utilities */

test("strings: jaroWinkler matches published reference values", () => {
  close(jaroWinkler("MARTHA", "MARHTA"), 0.961, 0.001, "the canonical transposition example must be exact");
  close(jaroWinkler("DIXON", "DICKSONX"), 0.813, 0.001, "the canonical length-mismatch example must be exact");
  close(jaroWinkler("DWAYNE", "DUANE"), 0.84, 0.001, "prefix bonus applies to a single shared leading character");
  assert.equal(jaroWinkler("anita rao", "anita rao"), 1, "an identical pair is a perfect 1");
  assert.equal(jaroWinkler("abc", "xyz"), 0, "no shared characters is 0, not a small positive number");
  assert.equal(jaroWinkler("", "anything"), 0, "an empty side cannot be similar to anything");
  const value = jaroWinkler("Suresh", "Suraj");
  assert.ok(value > 0 && value < 1, "a partial match stays strictly inside 0..1");
});

test("strings: soundex matches published reference values", () => {
  assert.equal(soundex("Robert"), "R163");
  assert.equal(soundex("Rupert"), "R163", "the classic homophone pair shares a code");
  assert.equal(soundex("Tymczak"), "T522", "adjacent same-coded consonants collapse, vowels break the run");
  assert.equal(soundex("Ashcraft"), "A261", "H is transparent, so S-H-C still collapses to one 2");
  assert.equal(soundex("Pfister"), "P236", "a first letter and its same-coded successor collapse");
  assert.equal(soundex("Honeyman"), "H555");
  assert.equal(soundex("Lee"), "L000", "short names are zero-padded to four characters");
  assert.equal(soundex("1234"), "", "input with no letters has no code rather than a fake one");
});

test("strings: normalizeName strips titles, punctuation and spacing but not identity", () => {
  assert.equal(normalizeName("Dr. Anita  Rao"), "anita rao");
  assert.equal(normalizeName("MRS ANITA RAO"), "anita rao");
  assert.equal(normalizeName("Smt. Anita Rao "), "anita rao");
  assert.equal(
    normalizeName("Dr Anita Rao"),
    normalizeName("anita rao"),
    "an honorific typed by one clerk and not another must not make two people",
  );
  assert.equal(normalizeName("O'Brien-Patel"), "o brien patel", "punctuation splits tokens rather than joining them");
  assert.notEqual(normalizeName("Anita Rao"), normalizeName("Anita Roy"), "normalization must not erase a real difference");
  assert.equal(normalizeName(undefined), "", "a missing name normalizes to empty, it does not throw");
  assert.equal(normalizeName("Mrs."), "mrs", "a name made only of an honorific keeps it rather than becoming empty");
});

/* ------------------------------------------------------------------ scoreMatch */

test("score: an exact strong identifier outscores everything else", () => {
  const existing = aPatient();
  const sameAbha = scoreMatch(
    { name: "Anita Rao", identifiers: [{ system: "ABHA", value: "11-2222-3333-4444" }] },
    existing,
  );
  const nameOnly = scoreMatch({ name: "Anita Rao" }, existing);

  assert.ok(sameAbha.score > nameOnly.score, "a shared government identifier is stronger evidence than a shared name");
  const abha = sameAbha.breakdown.find((f) => f.field === "identifier:ABHA");
  assert.equal(abha.agreed, true);
  assert.equal(abha.contribution, DEFAULT_WEIGHTS.identifier.agree, "an exact identifier pays its full agreement weight");
  assert.equal(sameAbha.band, "auto", "identifier plus name is enough evidence to link without a human");
});

test("score: a name-only candidate can never reach the auto band", () => {
  const existing = aPatient();
  const perfectName = scoreMatch({ name: "Anita Rao" }, existing);
  assert.equal(perfectName.band, "review", "a perfect name alone is a namesake risk, never an auto-link");
  assert.ok(
    perfectName.score <= DEFAULT_WEIGHTS.name.agree / perfectName.maxWeight,
    "a name can earn at most its own weight, which is structurally below the auto threshold",
  );
  assert.ok(
    DEFAULT_WEIGHTS.name.agree / perfectName.maxWeight < DEFAULT_THRESHOLDS.auto,
    "no re-weighting that keeps a name below the auto threshold can let a name alone auto-link",
  );
});

test("score: a transliterated name that sounds the same agrees; a coarse sound-alike does not", () => {
  const nameOf = (a, b) => scoreMatch({ name: a }, aPatient({ name: b })).breakdown.find((f) => f.field === "name");
  for (const [a, b] of [["Mohammed Rafi", "Muhammad Rafi"], ["Lakshmi", "Laxmi"], ["Sita Devi", "Seetha Devi"]]) {
    const f = nameOf(a, b);
    assert.equal(f.agreed, true, a + " / " + b + " is one person written two ways");
    assert.match(f.detail, /sounds alike/);
  }
  // Both R100 in Soundex, but nothing alike on the page: the spelling floor refuses it.
  assert.equal(nameOf("Ravi", "Rupa").agreed, false);
  // Close spelling, different sound: two different people.
  assert.equal(nameOf("Ramesh Kumar", "Rakesh Kumar").agreed, false);
  // A word missing is not "sounds alike".
  assert.equal(nameOf("Sita", "Seetha Devi").agreed, false);
  // Exact spelling agreement is unchanged and not labelled phonetic.
  assert.doesNotMatch(nameOf("Anita Rao", "Anita Rao").detail, /sounds alike/);
  // And a phonetic name still cannot auto-link on its own.
  assert.notEqual(scoreMatch({ name: "Muhammad Rafi" }, aPatient({ name: "Mohammed Rafi" })).band, "auto");
});

test("score: a missing field is not a disagreement", () => {
  const existing = aPatient();
  const noDob = scoreMatch({ name: "Anita Rao", sex: "female" }, existing);
  assert.ok(!noDob.breakdown.some((f) => f.field === "dob"), "a dob nobody supplied contributes nothing at all");
  assert.ok(!noDob.breakdown.some((f) => f.field.startsWith("identifier:")), "an unshared identifier system is not evidence");
  assert.equal(scoreMatch({}, existing).score, 0, "with nothing comparable the score is 0, not an error");
  assert.equal(scoreMatch({}, existing).band, "none");
  assert.doesNotThrow(() => scoreMatch(null, null), "partial keystroke input must never throw at the registration desk");
});

test("score: same name with a different DOB scores below same name with the same DOB", () => {
  const existing = aPatient();
  const sameDob = scoreMatch({ name: "Anita Rao", dob: "1984-03-11" }, existing);
  const differentDob = scoreMatch({ name: "Anita Rao", dob: "1991-07-02" }, existing);

  assert.ok(differentDob.score < sameDob.score, "a contradicted date of birth must cost the pair, not be ignored");
  const dobFactor = differentDob.breakdown.find((f) => f.field === "dob");
  assert.equal(dobFactor.agreed, false);
  assert.ok(dobFactor.contribution < 0, "a disagreement is a penalty, not a zero");
  assert.match(dobFactor.detail, /DOB differs/, "the clerk is told which field disagreed");
});

test("score: mobile numbers compare on significant digits, not formatting", () => {
  const existing = aPatient();
  const formatted = scoreMatch({ name: "Anita Rao", mobile: "09876543210" }, existing);
  const mobile = formatted.breakdown.find((f) => f.field === "mobile");
  assert.equal(mobile.agreed, true, "a country code or a leading zero is formatting, not a different person");
  const different = scoreMatch({ name: "Anita Rao", mobile: "+91 90000 00001" }, existing);
  assert.equal(different.breakdown.find((f) => f.field === "mobile").agreed, false);
  assert.ok(different.score < formatted.score);
});

test("score: the breakdown contributions sum to the reported score", () => {
  const existing = aPatient();
  const result = scoreMatch(
    {
      name: "Anitha Rao",
      dob: "1984-03-11",
      sex: "female",
      identifiers: [{ system: "ABHA", value: "11-2222-3333-4444" }, { system: "mobile", value: "9876543210" }],
    },
    existing,
  );
  const sum = result.breakdown.reduce((total, f) => total + f.contribution, 0);
  close(
    sum / result.maxWeight,
    result.score,
    0.01,
    "the explanation the UI renders must add up to the number it renders beside it",
  );
  assert.match(result.explanation, /percent match/, "there is always a renderable one-line explanation");
  assert.match(result.explanation, /exact ABHA \(50\)/, "each contributing factor is named with its weight");
});

test("score: thresholds and weights are configurable per site", () => {
  const existing = aPatient();
  const candidate = { name: "Anita Rao", dob: "1984-03-11", sex: "female" };
  assert.equal(scoreMatch(candidate, existing).band, "review", "seed thresholds keep a demographic-only match in review");
  assert.equal(
    scoreMatch(candidate, existing, { thresholds: { auto: 0.2 } }).band,
    "auto",
    "a site that has re-estimated on its own registry can move the gate",
  );
  const heavy = scoreMatch(candidate, existing, { weights: { dob: { agree: 80, disagree: 40 } } });
  assert.ok(heavy.maxWeight > scoreMatch(candidate, existing).maxWeight, "custom weights actually take effect");
  assert.ok(heavy.breakdown.find((f) => f.field === "dob").contribution === 80);
});

/* ------------------------------------------------------------------ findCandidates */

test("candidates: results are ordered by score and the no-match band is filtered out", () => {
  const registry = [
    aPatient({ id: "p-exact", mrn: "MRN-1" }),
    aPatient({ id: "p-namesake", mrn: "MRN-2", dob: "1970-01-01", identifiers: [{ system: "mobile", value: "9876543210" }] }),
    Patient({ id: "p-other", mrn: "MRN-3", name: "Vikram Menon", dob: "1962-08-19", sex: "male", identifiers: [] }),
  ];
  const hits = findCandidates(
    { name: "Anita Rao", dob: "1984-03-11", sex: "female", mobile: "9876543210" },
    registry,
  );

  assert.deepEqual(hits.map((h) => h.patient.id), ["p-exact", "p-namesake"], "an unrelated patient is not offered at all");
  assert.ok(hits[0].score >= hits[1].score, "the strongest candidate is first");
  assert.equal(hits[0].band, "auto");
  assert.ok(hits[0].match.breakdown.length > 0, "each hit carries its full scoreMatch result for the UI");
});

test("candidates: live partial input yields review suggestions and never an auto-link", () => {
  const registry = [aPatient({ id: "p-1" }), aPatient({ id: "p-2", mrn: "MRN-2", identifiers: [] })];
  for (const typed of ["A", "Ani", "Anit", "Anita", "Anita R", "Anita Rao"]) {
    const hits = findCandidates({ name: typed }, registry);
    for (const hit of hits) {
      assert.notEqual(hit.band, "auto", `typing "${typed}" must never be enough to auto-link a chart`);
    }
  }
});

test("candidates: degenerate input is answered, not thrown at", () => {
  assert.deepEqual(findCandidates({ name: "x" }, null), [], "a registry that has not loaded yet returns no candidates");
  assert.deepEqual(findCandidates({}, [aPatient()]), [], "an empty form matches nobody");
  assert.deepEqual(findCandidates(null, [aPatient(), null, "junk"]), [], "malformed registry rows are skipped, not fatal");
});

test("candidates: a record is never offered as a match for itself", () => {
  const existing = aPatient({ id: "p-self" });
  assert.deepEqual(findCandidates(existing, [existing]), [], "editing a chart must not suggest merging it with itself");
});

test("candidates: limit caps the list the UI has to render", () => {
  const registry = Array.from({ length: 10 }, (_, i) => aPatient({ id: `p-${i}`, mrn: `MRN-${i}` }));
  assert.equal(findCandidates({ name: "Anita Rao" }, registry, { limit: 3 }).length, 3);
});

/* ------------------------------------------------------------------ provisional identity */

test("provisional: the mrn is the documented resus-bay form", () => {
  const p = makeProvisionalIdentity({ sex: "male", arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 1 });
  assert.equal(p.mrn, "TRAUMA-UNKNOWN-MALE-20260903-01");
  assert.equal(p.provisional, true, "the record announces that it is expected to be merged later");
  assert.equal(p.resourceType, "Patient", "a provisional arrival is a real Patient, not a special case downstream");

  assert.equal(
    makeProvisionalIdentity({ arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 12 }).mrn,
    "TRAUMA-UNKNOWN-UNKNOWN-20260903-12",
    "sex that has not been established reads UNKNOWN rather than being guessed",
  );
  assert.equal(
    makeProvisionalIdentity({ sex: "female", arrivedAt: new Date("2026-01-07T03:00:00.000Z"), sequence: 4 }).mrn,
    "TRAUMA-UNKNOWN-FEMALE-20260107-04",
    "the sequence is zero-padded so mrns sort in arrival order",
  );
});

test("provisional: the dob is an unmistakable sentinel", () => {
  const p = makeProvisionalIdentity({ sex: "male", arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 1 });
  assert.equal(p.dob, PROVISIONAL_DOB_SENTINEL);
  assert.ok(Number.isNaN(new Date(p.dob).getTime()), "age arithmetic must fail loudly rather than invent an age");
  assert.notEqual(p.dob, new Date().toISOString().slice(0, 10), "the sentinel is never a plausible real date");
});

test("provisional: the sentinel dob is treated as absent, not as a disagreement", () => {
  const provisional = makeProvisionalIdentity({ sex: "male", arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 1 });
  const known = Patient({ mrn: "MRN-9", name: "Vikram Menon", dob: "1962-08-19", sex: "male" });
  const result = scoreMatch(provisional, known);
  assert.ok(!result.breakdown.some((f) => f.field === "dob"), "an unidentified patient has no dob to contradict anyone with");
});

test("provisional: an unusable arrival or sequence is refused", () => {
  assert.throws(() => makeProvisionalIdentity({ arrivedAt: "not-a-date", sequence: 1 }), /valid arrivedAt/);
  assert.throws(() => makeProvisionalIdentity({ arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 0 }), /sequence/);
  assert.throws(() => makeProvisionalIdentity({ arrivedAt: "2026-09-03T21:14:00.000Z", sequence: 1.5 }), /sequence/);
});

/* ------------------------------------------------------------------ merge / unmerge */

function aMergePair() {
  const survivor = aPatient({ id: "p-survivor", mrn: "MRN-1" });
  const duplicate = aPatient({
    id: "p-duplicate",
    mrn: "MRN-2",
    identifiers: [{ system: "ABHA", value: "11-2222-3333-4444" }, { system: "MRN-LEGACY", value: "OLD-778" }],
  });
  return { survivor, duplicate };
}

test("merge: neither input record is mutated", () => {
  const { survivor, duplicate } = aMergePair();
  const survivorBefore = structuredClone(survivor);
  const duplicateBefore = structuredClone(duplicate);

  const { merged, mergeRecord } = merge(survivor, duplicate, { actorId: "clerk-7" });

  assert.deepEqual(survivor, survivorBefore, "a merge must not edit the survivor in place");
  assert.deepEqual(duplicate, duplicateBefore, "a merge must not edit the duplicate in place");
  merged.identifiers.push({ system: "SCRATCH", value: "x" });
  mergeRecord.survivor.name = "overwritten";
  assert.deepEqual(survivor, survivorBefore, "the outputs are deep copies, so editing them cannot reach back");
});

test("merge: identifiers are unioned without duplication", () => {
  const { survivor, duplicate } = aMergePair();
  const { merged } = merge(survivor, duplicate, { actorId: "clerk-7" });

  const systems = merged.identifiers.map((i) => i.system);
  assert.ok(systems.includes("MRN-LEGACY"), "the duplicate's identifiers come across so the old number still resolves");
  assert.equal(systems.filter((s) => s === "ABHA").length, 1, "a shared identifier is carried once, not twice");
  assert.equal(merged.id, survivor.id, "the survivor's identity is the one that continues");
  assert.ok(merged.meta.derivedFrom.includes("p-duplicate"), "the merged chart records where the extra identifiers came from");
});

test("merge: disagreements are listed for a human and never silently resolved", () => {
  const survivor = aPatient({ id: "p-a", mrn: "MRN-1", dob: "1984-03-11", sex: "female" });
  const duplicate = aPatient({
    id: "p-b",
    mrn: "MRN-2",
    name: "Vikram Menon",
    dob: "1991-07-02",
    sex: "male",
    identifiers: [{ system: "ABHA", value: "99-0000-0000-0001" }],
  });

  const { merged, mergeRecord } = merge(survivor, duplicate, { actorId: "clerk-7", reason: "same mobile" });
  const fields = mergeRecord.conflicts.map((c) => c.field).sort();
  assert.deepEqual(fields, ["dob", "identifier:ABHA", "name", "sex"], "every contradicted field is surfaced");

  assert.equal(merged.dob, "1984-03-11", "the survivor's value is kept, the duplicate's is not blended in");
  assert.equal(merged.sex, "female");
  assert.equal(merged.name, "Anita Rao");
  const abha = merged.identifiers.filter((i) => i.system === "ABHA");
  assert.equal(abha.length, 1, "a conflicting identifier is not added, or the chart would carry two ABHA numbers");
  assert.equal(abha[0].value, "11-2222-3333-4444");
  assert.equal(mergeRecord.reason, "same mobile");
});

test("merge: an absent or unknown value is not a conflict", () => {
  const survivor = aPatient({ id: "p-a", dob: "1984-03-11", sex: "female" });
  const duplicate = Patient({ id: "p-b", mrn: "MRN-2", name: "Anita Rao", dob: PROVISIONAL_DOB_SENTINEL, sex: "unknown" });
  const { mergeRecord } = merge(survivor, duplicate, { actorId: "clerk-7" });
  assert.deepEqual(mergeRecord.conflicts, [], "a record that asserts nothing cannot contradict one that does");
});

test("merge: attribution is mandatory and self-merge is refused", () => {
  const { survivor, duplicate } = aMergePair();
  assert.throws(() => merge(survivor, duplicate, {}), /actorId/, "a merge is a clinical act and is never anonymous");
  assert.throws(() => merge(survivor, duplicate, { actorId: "  " }), /actorId/);
  assert.throws(() => merge(survivor, survivor, { actorId: "clerk-7" }), /into itself/);
  assert.throws(() => merge(null, duplicate, { actorId: "clerk-7" }), /survivor/);
  assert.throws(() => merge(survivor, null, { actorId: "clerk-7" }), /duplicate/);
});

test("merge: the record carries who merged, when, and both originals", () => {
  const { survivor, duplicate } = aMergePair();
  const { mergeRecord } = merge(survivor, duplicate, { actorId: "clerk-7", at: "2026-09-04T06:00:00.000Z" });
  assert.equal(mergeRecord.actorId, "clerk-7");
  assert.equal(mergeRecord.mergedAt, "2026-09-04T06:00:00.000Z");
  assert.equal(mergeRecord.survivorId, "p-survivor");
  assert.equal(mergeRecord.duplicateId, "p-duplicate");
  assert.deepEqual(mergeRecord.survivor, survivor, "the record holds the originals, not a diff to reconstruct from");
  assert.deepEqual(mergeRecord.duplicate, duplicate);
});

test("merge: merge then unmerge round-trips deep-equal", () => {
  const { survivor, duplicate } = aMergePair();
  const survivorBefore = structuredClone(survivor);
  const duplicateBefore = structuredClone(duplicate);

  const { mergeRecord } = merge(survivor, duplicate, { actorId: "clerk-7" });
  const restored = unmerge(mergeRecord);

  assert.deepEqual(restored.survivor, survivorBefore, "an unmerge restores the survivor exactly as it was");
  assert.deepEqual(restored.duplicate, duplicateBefore, "and the duplicate too, or the link was one-way");

  restored.survivor.name = "tampered";
  assert.deepEqual(unmerge(mergeRecord).survivor, survivorBefore, "unmerge is pure: repeated calls give the same result");
});

test("merge: unmerge refuses a record it cannot restore from", () => {
  assert.throws(() => unmerge(null), /merge record/);
  assert.throws(() => unmerge({ survivorId: "p-a", duplicateId: "p-b" }), /both original patients/);
});
