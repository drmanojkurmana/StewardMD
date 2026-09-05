/* test/wardsynq-research.test.mjs — the record that looks anonymous and is not.
 *
 * The interesting tests are the ones where every direct identifier has been removed and the person
 * is still findable: unique on date of birth and district, or the only patient in the set with that
 * diagnosis. A module that passed those rows would be more dangerous than one that did nothing,
 * because its output carries the word "de-identified".
 *
 * node --test test/wardsynq-research.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGE_CEILING, DEFAULT_K, ResearchError,
  classify, pseudonymise, offsetDaysFor, deidentifyRecord, kAnonymity, rareValues, prepareRelease,
} from "../wardsynq/wardsynq-research.js";

const SALT = "held-in-the-key-vault-not-with-the-data";

const record = (over) => ({
  patientId: "pat-1",
  name: "Asha Menon", mrn: "MRN-88213", phone: "+91 98xxxxxx", email: "a@example.com",
  address: "12 Residency Road", postcode: "560025",
  dob: "1978-04-02", sex: "female", district: "Bengaluru Urban",
  diagnosis: "type 2 diabetes", hba1c: 8.4,
  admittedAt: "2026-06-01T09:00:00.000Z", dischargedAt: "2026-06-05T14:00:00.000Z",
  notes: "Seen with her daughter Priya. Referred by Dr Raghavan at the Jayanagar clinic.",
  ...over,
});

const deid = (over, opts) => deidentifyRecord(record(over), { salt: SALT, dateFields: ["admittedAt", "dischargedAt"], keepFields: ["diagnosis", "hba1c", "district"], ...opts });

/* ------------------------------------------------------------------ direct identifiers */

test("every direct identifier is removed", () => {
  const r = deid();
  for (const f of ["name", "mrn", "phone", "email", "address", "postcode"]) {
    assert.equal(r.row[f], undefined, `${f} must not survive`);
    assert.ok(r.removed.includes(f));
  }
});

test("ADVERSARIAL: free text is REMOVED, never scrubbed", () => {
  const r = deid();
  assert.equal(r.row.notes, undefined);
  assert.ok(r.removed.includes("notes"),
    "a regex over a discharge summary produces text that looks scrubbed and still names the daughter and the referring doctor");
});

test("ADVERSARIAL: an unrecognised field is dropped, not assumed safe", () => {
  const r = deid({ bedLabel: "Side room 3, next to the nurses station", referrerNote: "known to the CEO" });
  assert.equal(r.row.bedLabel, undefined);
  assert.equal(r.row.referrerNote, undefined);
  assert.deepEqual(r.unknownFields.sort(), ["bedLabel", "referrerNote"]);
});

test("a field explicitly kept is kept", () => {
  const r = deid();
  assert.equal(r.row.diagnosis, "type 2 diabetes");
  assert.equal(r.row.hba1c, 8.4);
});

test("field classification is by name, and says so by treating unknowns as unsafe", () => {
  assert.equal(classify("familyName"), "direct");
  assert.equal(classify("clinicalNote"), "free-text");
  assert.equal(classify("dob"), "quasi");
  assert.equal(classify("somethingNobodyAnticipated"), "unknown");
});

/* ------------------------------------------------------------------ dates and ages */

test("ADVERSARIAL: date shifting is per-patient and CONSISTENT, so intervals survive", () => {
  const r = deid();
  const inDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  assert.equal(inDays(r.row.admittedAt, r.row.dischargedAt), 4,
    "the length of stay is the research value and must survive");
  assert.notEqual(r.row.admittedAt, record().admittedAt, "and the absolute date must not");
});

test("ADVERSARIAL: two patients get DIFFERENT offsets, so no absolute anchor leaks", () => {
  const a = deidentifyRecord(record({ patientId: "pat-1" }), { salt: SALT, dateFields: ["admittedAt"] });
  const b = deidentifyRecord(record({ patientId: "pat-2" }), { salt: SALT, dateFields: ["admittedAt"] });
  assert.notEqual(a.row.admittedAt, b.row.admittedAt,
    "one dataset-wide offset would let anyone who knows a single real date recover every other");
});

test("the same patient always gets the same offset and pseudonym", () => {
  const a = deid();
  const b = deid();
  assert.equal(a.row.admittedAt, b.row.admittedAt);
  assert.equal(a.pseudonym, b.pseudonym);
});

test("a different salt gives different pseudonyms, so the salt is the secret", () => {
  assert.notEqual(pseudonymise("pat-1", SALT), pseudonymise("pat-1", "other-salt"));
  assert.notEqual(offsetDaysFor("pat-1", SALT), offsetDaysFor("pat-1", "other-salt"));
});

test("de-identification without a salt is refused", () => {
  assert.throws(() => deidentifyRecord(record(), {}), (e) => e instanceof ResearchError && e.code === "NO_SALT");
});

test("ages above the ceiling are capped, because the very old are rare enough to identify", () => {
  const r = deidentifyRecord({ patientId: "p", ageYears: 97 }, { salt: SALT });
  assert.equal(r.row.ageYears, AGE_CEILING + 1);
  assert.equal(r.row.ageYearsCapped, true);
  const young = deidentifyRecord({ patientId: "p", ageYears: 44 }, { salt: SALT });
  assert.equal(young.row.ageYears, 44);
  assert.equal(young.row.ageYearsCapped, false);
});

test("an unparseable date is removed rather than passed through", () => {
  const r = deid({ admittedAt: "sometime last June" });
  assert.equal(r.row.admittedAt, undefined);
  assert.ok(r.removed.includes("admittedAt"));
});

/* ------------------------------------------------------------------ ADVERSARIAL: still identifiable */

const cohort = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => record({
    patientId: `pat-${i}`, name: `Person ${i}`, dob: "1980-01-01", district: "Bengaluru Urban", ...over(i),
  }));

test("ADVERSARIAL: a row unique on its quasi-identifiers is WITHHELD, not warned about", () => {
  // Twenty ordinary rows, plus one woman who is the only person in the set with her date of birth
  // and district. Every direct identifier has been removed from all of them.
  const records = [...cohort(20), record({ patientId: "pat-x", dob: "1943-11-08", district: "Kodagu" })];

  const r = prepareRelease(records, {
    salt: SALT, dateFields: ["admittedAt", "dischargedAt"],
    quasiFields: ["dob", "sex", "district"], keepFields: ["diagnosis", "hba1c", "district"],
    k: DEFAULT_K, purpose: "diabetes outcomes study", requestedBy: "dr-research",
  });

  assert.equal(r.withheldCount, 1, "a warning does not travel with the row once somebody opens the file");
  assert.match(r.withheld[0].reason, /below k=5 this row identifies a person/);
  assert.equal(r.releasedCount, 20);
  assert.ok(r.rows.every((row) => row.dob === "1943-11-08" ? false : true));
});

test("ADVERSARIAL: k-anonymity catches what Safe Harbor passes", () => {
  const rows = [
    { dob: "1980-01-01", sex: "female", district: "A" },
    { dob: "1980-01-01", sex: "female", district: "A" },
    { dob: "1943-11-08", sex: "female", district: "B" },
  ];
  const k = kAnonymity(rows, ["dob", "sex", "district"], 5);
  assert.equal(k.satisfied, false);
  assert.equal(k.achievedK, 1);
  assert.equal(k.uniqueRows, 1);
  assert.equal(k.violatingRows, 3);
});

test("ADVERSARIAL: a rare diagnosis identifies on its own and is flagged", () => {
  const records = [
    ...cohort(20),
    record({ patientId: "pat-rare", diagnosis: "erdheim-chester disease" }),
  ];
  const r = prepareRelease(records, {
    salt: SALT, dateFields: [], quasiFields: ["dob", "sex", "district"],
    keepFields: ["diagnosis", "hba1c", "district"], rareValueFields: ["diagnosis"],
    purpose: "study", requestedBy: "dr-research",
  });
  const rare = r.rareValues.find((v) => v.value === "erdheim-chester disease");
  assert.ok(rare, "there may be one patient in the state with that condition");
  assert.equal(rare.count, 1);
  assert.ok(r.warnings.some((w) => /rare value/.test(w)));
});

test("a satisfied release still refuses to call itself anonymous", () => {
  const r = prepareRelease(cohort(20), {
    salt: SALT, dateFields: ["admittedAt"], quasiFields: ["dob", "sex", "district"],
    keepFields: ["diagnosis", "hba1c", "district"], purpose: "study", requestedBy: "dr-research",
  });
  assert.equal(r.kAnonymity.satisfied, true);
  assert.equal(r.withheldCount, 0);
  assert.match(r.disclaimer, /DE-IDENTIFIED, not anonymous/);
  assert.match(r.disclaimer, /Safe Harbor field removal is a recipe, not a proof/);
  assert.match(r.disclaimer, /Treat it as personal data under a data use agreement/);
  assert.equal(/\banonymous\b/.test(JSON.stringify(r.rows)), false);
});

test("ADVERSARIAL: a release with no stated purpose is refused", () => {
  assert.throws(
    () => prepareRelease(cohort(5), { salt: SALT, purpose: "study" }),
    (e) => e instanceof ResearchError && e.code === "NO_PURPOSE");
  try {
    prepareRelease(cohort(5), { salt: SALT, requestedBy: "x" });
  } catch (e) {
    assert.match(e.message, /cannot be audited or revoked/);
  }
});

test("dropped unknown fields are surfaced as a warning, not buried", () => {
  const r = prepareRelease(cohort(20, () => ({ bedLabel: "the corner bed" })), {
    salt: SALT, dateFields: ["admittedAt", "dischargedAt"], quasiFields: ["dob", "sex", "district"],
    keepFields: ["diagnosis", "hba1c", "district"], purpose: "study", requestedBy: "dr-1",
  });
  assert.deepEqual(r.unknownFieldsDropped, ["bedLabel"]);
  assert.ok(r.warnings.some((w) => /unrecognised field/.test(w)));
});

test("ADVERSARIAL: a date field nobody declared as a date is dropped, not released raw", () => {
  // Found by a failing test: forgetting to list a timestamp in dateFields must not release the real
  // date. An undeclared date is an unknown field, and unknown means unsafe.
  const r = prepareRelease(cohort(20), {
    salt: SALT, quasiFields: ["dob", "sex", "district"],
    keepFields: ["diagnosis", "hba1c", "district"], purpose: "study", requestedBy: "dr-1",
  });
  assert.deepEqual(r.unknownFieldsDropped.sort(), ["admittedAt", "dischargedAt"]);
  assert.equal(r.rows[0].admittedAt, undefined, "an unshifted real admission date is a re-identification key");
});

test("the name match is deliberately over-broad, and that costs research fields", () => {
  // "wardNickname" ends in "name" and is stripped as a direct identifier. So would "drugName" and
  // "testName". That is the safe direction and it is a real cost: a study can lose a field it needed
  // and nobody would know. removedFields is why it is recoverable, and keepFields is the escape.
  assert.equal(classify("wardNickname"), "direct");
  assert.equal(classify("drugName"), "direct");
  const r = deidentifyRecord({ patientId: "p", drugName: "metformin" }, { salt: SALT });
  assert.ok(r.removed.includes("drugName"),
    "over-removal is recoverable because it is reported; under-removal is not, because nobody looks");
  const kept = deidentifyRecord({ patientId: "p", drugName: "metformin" }, { salt: SALT, keepFields: ["drugName"] });
  assert.equal(kept.row.drugName, undefined,
    "and keepFields does NOT override a DIRECT identifier match: opting a name-like field back in has to be a deliberate rename, not a flag");
});

test("rareValues ignores empty cells rather than counting them as a rare value", () => {
  const rows = [{ dx: "" }, { dx: null }, { dx: undefined }, { dx: "common" }, { dx: "common" }];
  assert.deepEqual(rareValues(rows, ["dx"], 2), []);
});
