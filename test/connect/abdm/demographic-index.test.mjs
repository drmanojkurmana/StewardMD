// test/connect/abdm/demographic-index.test.mjs — deterministic demographic discovery.
//
// The failure this suite exists to prevent: returning ONE patient's medical history to a stranger who
// guessed close enough. So the tests are weighted toward the refusals - ambiguity, partial corroboration,
// conflicting identifiers, and another tenant's data - rather than the happy path.
//
// Every comparison in the implementation is exact equality on a deterministically-derived value. There is
// no distance metric and no threshold, so there is nothing here that can be "tuned" into a wrong match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  indexPatient, unindexPatient, matchDemographics, demographicKeys,
  nameCode, nameMatches, normaliseMobile, normaliseMrn, normaliseGender, normaliseYob,
  ageWithinTolerance, AGE_TOLERANCE_YEARS, DEMOGRAPHIC_TABLE, DemographicIndexError,
} from "../../../functions/_connect/abdm/demographic-index.js";

const NOW = "2026-08-19T00:00:00.000Z";
const ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
const deps = (tables = {}) => ({ db: makeAbdmDb(tables), now: () => NOW });
const rows = (d) => d.db._tables[DEMOGRAPHIC_TABLE] || [];

const RAMESH = { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985, mrn: "MRN-001" };
const probeOf = (o = {}) => ({ name: RAMESH.name, mobile: RAMESH.mobile, gender: RAMESH.gender, yearOfBirth: RAMESH.yearOfBirth, ...o });

async function seeded(patients = [RAMESH], tenantId = "t1") {
  const d = deps();
  for (const p of patients) await indexPatient(ENV, d, { tenantId, ...p });
  return d;
}

// ── normalisation primitives ────────────────────────────────────────────────────────────────────────
test("mobile normalises to the last 10 digits, and refuses anything that is not one", () => {
  assert.equal(normaliseMobile("+91 98765 43210"), "9876543210");
  assert.equal(normaliseMobile("098765-43210"), "9876543210");
  assert.equal(normaliseMobile("00919876543210"), "9876543210");
  for (const bad of ["12345", "5876543210", "", null, undefined, "abcdefghij", "1234567890"]) {
    assert.equal(normaliseMobile(bad), null, "must refuse: " + bad);
  }
});

test("MRN folds case and punctuation but refuses a stub", () => {
  assert.equal(normaliseMrn("mrn-001"), "MRN001");
  assert.equal(normaliseMrn("MRN 001"), "MRN001");
  assert.equal(normaliseMrn("M/R/N-0.0.1"), "MRN001");
  for (const bad of ["", null, "A", "A1"]) assert.equal(normaliseMrn(bad), null);
});

test("gender normalises to M/F/O, and Unknown is NOT a match key", () => {
  assert.equal(normaliseGender("m"), "M");
  assert.equal(normaliseGender("Male"), "M");
  assert.equal(normaliseGender("FEMALE"), "F");
  assert.equal(normaliseGender("Transgender"), "O");
  assert.equal(normaliseGender("Other"), "O");
  for (const bad of ["U", "Unknown", "", null, "x"]) assert.equal(normaliseGender(bad), null);
});

test("year of birth accepts a year or a date, and refuses nonsense", () => {
  assert.equal(normaliseYob(1985), 1985);
  assert.equal(normaliseYob("1985"), 1985);
  assert.equal(normaliseYob("1985-03-04"), 1985);
  for (const bad of [null, "", "19**", 1800, 3000, "abcd"]) assert.equal(normaliseYob(bad), null);
});

// ── name folding ────────────────────────────────────────────────────────────────────────────────────
test("the same name spelled two ways folds to one code", () => {
  for (const [a, b] of [["Ramesh", "Rameesh"], ["Anil", "Aneel"], ["Viswanath", "Vishwanath"],
                        ["Siddharth", "Sidharth"], ["Phanindra", "Fanindra"], ["Lakshmi", "Laxmi"],
                        ["Satya", "Satia"], ["Jose", "José"]]) {
    assert.ok(nameMatches(a, b), a + " should fold to the same code as " + b);
  }
});

test("word order does not matter - two desks record one person differently", () => {
  assert.ok(nameMatches("Ramesh Kumar", "Kumar Ramesh"));
  assert.ok(nameMatches("Ramesh  Kumar", "kumar   ramesh"));
});

test("honorifics are not part of the name", () => {
  assert.ok(nameMatches("Dr Ramesh Kumar", "Ramesh Kumar"));
  assert.ok(nameMatches("Smt Lakshmi", "Lakshmi"));
});

test("DIFFERENT names do not fold together", () => {
  for (const [a, b] of [["Ramesh", "Suresh"], ["Priya", "Pooja"], ["Anil", "Sunil"],
                        ["Krishna", "Kishore"], ["Meera", "Seema"]]) {
    assert.ok(!nameMatches(a, b), a + " must NOT match " + b);
  }
});

test("an empty or unusable name yields NO code, so it can never match everyone", () => {
  for (const bad of ["", "   ", null, undefined, "!!!", "123"]) assert.equal(nameCode(bad), null);
  assert.ok(!nameMatches("", ""), "two empty names are not a match");
});

// ── age tolerance ───────────────────────────────────────────────────────────────────────────────────
test("the age window is ABDM's +/-5 years, inclusive at the boundary", () => {
  assert.equal(AGE_TOLERANCE_YEARS, 5);
  assert.ok(ageWithinTolerance(1985, 1985));
  assert.ok(ageWithinTolerance(1985, 1990), "exactly +5 is inside");
  assert.ok(ageWithinTolerance(1985, 1980), "exactly -5 is inside");
  assert.ok(!ageWithinTolerance(1985, 1991));
  assert.ok(!ageWithinTolerance(1985, 1979));
});

test("the age window fails CLOSED on an unusable year", () => {
  for (const bad of [null, "", "19**", "abcd", 1800]) {
    assert.ok(!ageWithinTolerance(1985, bad), "must not match on " + bad);
    assert.ok(!ageWithinTolerance(bad, 1985));
  }
});

// ── the index at rest ───────────────────────────────────────────────────────────────────────────────
test("NO raw demographic reaches storage", async () => {
  const d = await seeded();
  const row = rows(d)[0];
  const durable = JSON.stringify(row);
  assert.ok(!durable.includes("9876543210"), "no raw mobile");
  assert.ok(!durable.includes("Ramesh"), "no raw name");
  assert.ok(!durable.includes("MRN-001") && !durable.includes("MRN001"), "no raw MRN");
  // What IS stored, deliberately: gender and year of birth, because both must be compared.
  assert.equal(row.gender, "M");
  assert.equal(row.year_of_birth, 1985);
  assert.match(row.mobile_hash, /^[0-9a-f]{64}$/);
  assert.match(row.name_hash, /^[0-9a-f]{64}$/);
});

test("the same mobile at two tenants produces UNRELATED hashes", async () => {
  const a = await demographicKeys(ENV, "t1", { mobile: "9876543210" });
  const b = await demographicKeys(ENV, "t2", { mobile: "9876543210" });
  assert.notEqual(a.mobileHash, b.mobileHash,
    "a shared salt across tenants would let one hospital confirm a patient of another");
});

test("re-indexing the same patient updates rather than duplicating", async () => {
  const d = await seeded();
  await indexPatient(ENV, d, { tenantId: "t1", ...RAMESH, mobile: "9000000001" });
  assert.equal(rows(d).length, 1, "a duplicate row would look like ambiguity and suppress the patient's own match");
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mobile: "9000000001" }) });
  assert.equal(m.matched, true, "the NEW mobile matches");
  const old = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() });
  assert.equal(old.matched, false, "the OLD mobile no longer does");
});

test("an unbound store or a missing key is refused, never silently skipped", async () => {
  await assert.rejects(() => indexPatient(ENV, { db: null }, { tenantId: "t1", patientRef: "P" }), DemographicIndexError);
  await assert.rejects(() => indexPatient(ENV, deps(), { tenantId: "t1" }), DemographicIndexError);
  await assert.rejects(() => indexPatient(ENV, deps(), { patientRef: "P" }), DemographicIndexError);
});

// ── EXACT MATCH ─────────────────────────────────────────────────────────────────────────────────────
test("mobile + gender + age + name all corroborate -> a unique match", async () => {
  const d = await seeded();
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() });
  assert.deepEqual(m, { matched: true, patientRef: "P-1", matchedBy: ["MOBILE"], reason: "unique" });
});

test("a match survives a differently-spelled name and an age 5 years out", async () => {
  const d = await seeded();
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ name: "Rameesh Kumar", yearOfBirth: 1990 }) });
  assert.equal(m.matched, true);
  assert.equal(m.patientRef, "P-1");
});

test("the MRN arm matches only when gender, age and name ALSO corroborate", async () => {
  const d = await seeded();
  // No mobile on the probe, so the mobile arm is skipped entirely.
  const ok = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mobile: null, mrn: "mrn 001" }) });
  assert.deepEqual(ok.matchedBy, ["MR"]);
  assert.equal(ok.patientRef, "P-1");

  // The SAME MRN with a different person's demographics must NOT match. An MRN is patient-declared and
  // unverified, so it is never sufficient on its own.
  const no = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mobile: null, mrn: "MRN-001", name: "Suresh Rao" }) });
  assert.equal(no.matched, false);
  assert.equal(no.reason, "no-match");
});

// ── NO MATCH ────────────────────────────────────────────────────────────────────────────────────────
test("an unknown mobile matches nobody", async () => {
  const d = await seeded();
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mobile: "9111111111" }) });
  assert.equal(m.matched, false);
  assert.equal(m.reason, "no-match");
});

test("each corroborating field alone can veto the match", async () => {
  const d = await seeded();
  for (const [what, probe] of [
    ["gender differs", probeOf({ gender: "F" })],
    ["age 6 years out", probeOf({ yearOfBirth: 1991 })],
    ["a different name", probeOf({ name: "Suresh Rao" })],
  ]) {
    const m = await matchDemographics(ENV, d, { tenantId: "t1", probe });
    assert.equal(m.matched, false, what + " must veto");
    assert.equal(m.patientRef, null);
  }
});

test("a probe that cannot corroborate matches NOTHING, however good its identifier", async () => {
  const d = await seeded();
  // Knowing only the phone number must teach an attacker nothing.
  for (const [what, probe] of [
    ["no name", { mobile: RAMESH.mobile, gender: "M", yearOfBirth: 1985 }],
    ["no gender", { mobile: RAMESH.mobile, name: RAMESH.name, yearOfBirth: 1985 }],
    ["no year of birth", { mobile: RAMESH.mobile, name: RAMESH.name, gender: "M" }],
    ["gender Unknown", probeOf({ gender: "U" })],
    ["nothing at all", {}],
  ]) {
    const m = await matchDemographics(ENV, d, { tenantId: "t1", probe });
    assert.equal(m.matched, false, what + " must not match");
    assert.equal(m.reason, "insufficient-corroboration", what);
  }
});

// ── MULTIPLE MATCHES: never guess ───────────────────────────────────────────────────────────────────
test("two patients who BOTH fit resolve to NOBODY", async () => {
  // Twins at one address: same mobile, same gender, same name, birth years inside the window.
  const d = await seeded([
    { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985 },
    { patientRef: "P-2", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1986 },
  ]);
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() });
  assert.equal(m.matched, false, "picking either would be a coin toss with somebody's medical history");
  assert.equal(m.patientRef, null);
  assert.equal(m.reason, "ambiguous");
});

test("a shared mobile is fine as long as exactly one person corroborates", async () => {
  // A family phone. Different people, so only one survives - and that one IS returned.
  const d = await seeded([
    { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985 },
    { patientRef: "P-2", name: "Lakshmi Kumar", mobile: "9876543210", gender: "F", yearOfBirth: 1988 },
    { patientRef: "P-3", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 2015 },  // son, outside +/-5
  ]);
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() });
  assert.equal(m.matched, true);
  assert.equal(m.patientRef, "P-1");
});

test("ambiguity on the mobile arm does NOT fall through to the MRN arm", async () => {
  // Falling through would let an attacker escape an ambiguous result by adding an MRN guess.
  const d = await seeded([
    { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985, mrn: "A100" },
    { patientRef: "P-2", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1986, mrn: "B200" },
  ]);
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mrn: "A100" }) });
  assert.equal(m.matched, false);
  assert.equal(m.reason, "ambiguous");
});

// ── CONFLICTING IDENTIFIERS ─────────────────────────────────────────────────────────────────────────
test("a mobile and an MRN belonging to DIFFERENT people resolve to the mobile's owner only", async () => {
  const d = await seeded([
    { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985, mrn: "A100" },
    { patientRef: "P-2", name: "Suresh Rao", mobile: "9000000002", gender: "M", yearOfBirth: 1985, mrn: "B200" },
  ]);
  // The probe carries P-1's demographics but P-2's MRN. The mobile arm runs first and corroborates P-1.
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mrn: "B200" }) });
  assert.equal(m.matched, true);
  assert.equal(m.patientRef, "P-1");
  assert.deepEqual(m.matchedBy, ["MOBILE"], "the VERIFIED identifier decides; the declared one cannot override it");
});

test("an MRN that belongs to someone else cannot pull in their records", async () => {
  const d = await seeded([
    { patientRef: "P-1", name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1985, mrn: "A100" },
    { patientRef: "P-2", name: "Suresh Rao", mobile: "9000000002", gender: "M", yearOfBirth: 1985, mrn: "B200" },
  ]);
  // No mobile at all, and the probe claims P-2's MRN while describing P-1. Nothing corroborates.
  const m = await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf({ mobile: null, mrn: "B200" }) });
  assert.equal(m.matched, false);
});

// ── CROSS-TENANT ────────────────────────────────────────────────────────────────────────────────────
test("a perfect probe finds NOTHING in another tenant", async () => {
  const d = deps();
  await indexPatient(ENV, d, { tenantId: "t1", ...RAMESH });
  const m = await matchDemographics(ENV, d, { tenantId: "t2", probe: probeOf() });
  assert.equal(m.matched, false, "tenant scoping is in the WHERE, so t1's row is never even loaded");
});

test("two tenants holding the SAME patient each match only their own record", async () => {
  const d = deps();
  await indexPatient(ENV, d, { tenantId: "t1", ...RAMESH, patientRef: "T1-P-1" });
  await indexPatient(ENV, d, { tenantId: "t2", ...RAMESH, patientRef: "T2-P-9" });
  assert.equal((await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() })).patientRef, "T1-P-1");
  assert.equal((await matchDemographics(ENV, d, { tenantId: "t2", probe: probeOf() })).patientRef, "T2-P-9");
});

test("no tenant means no match - never an unscoped scan of every patient", async () => {
  const d = await seeded();
  for (const t of [null, undefined, ""]) {
    const m = await matchDemographics(ENV, d, { tenantId: t, probe: probeOf() });
    assert.equal(m.matched, false);
    assert.equal(m.reason, "no-tenant");
  }
});

test("a forged hash from another tenant's salt cannot be replayed into this one", async () => {
  // Even if an attacker somehow learned t2's stored hash, it is keyed to t2's derivation.
  const d = deps();
  await indexPatient(ENV, d, { tenantId: "t2", ...RAMESH });
  const t2 = await demographicKeys(ENV, "t2", { mobile: RAMESH.mobile, name: RAMESH.name });
  const t1 = await demographicKeys(ENV, "t1", { mobile: RAMESH.mobile, name: RAMESH.name });
  assert.notEqual(t1.mobileHash, t2.mobileHash);
  assert.notEqual(t1.nameHash, t2.nameHash);
  assert.equal((await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() })).matched, false);
});

// ── erasure reaches the index ───────────────────────────────────────────────────────────────────────
test("unindexing a patient makes them undiscoverable", async () => {
  const d = await seeded();
  assert.equal((await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() })).matched, true);
  assert.deepEqual(await unindexPatient(ENV, d, { tenantId: "t1", patientRef: "P-1" }), { removed: true });
  assert.equal((await matchDemographics(ENV, d, { tenantId: "t1", probe: probeOf() })).matched, false);
  assert.equal(rows(d).length, 0, "an erased patient must leave no index row behind");
});

test("unindexing is scoped to one tenant and is a no-op for an unknown patient", async () => {
  const d = deps();
  await indexPatient(ENV, d, { tenantId: "t1", ...RAMESH });
  assert.deepEqual(await unindexPatient(ENV, d, { tenantId: "t2", patientRef: "P-1" }), { removed: false });
  assert.equal(rows(d).length, 1, "another tenant must not be able to erase our index row");
  assert.deepEqual(await unindexPatient(ENV, d, { tenantId: "t1", patientRef: "nobody" }), { removed: false });
});
