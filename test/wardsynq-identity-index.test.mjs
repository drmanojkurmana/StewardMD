/* test/wardsynq-identity-index.test.mjs — the patient identity index, adversarially.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Identity reconciliation used to answer "do we already have this
 * person?" by reading a bounded roster of Patient rows - list("Patient", 1000) - and scanning it in
 * JavaScript. On a hospital with more patients than the roster ceiling, a returning patient who
 * happened to sit outside it simply was not found: the matcher fell through to "new" and a SECOND
 * chart was created for somebody who was already here. That is the whole of the wrong-patient
 * failure mode, arriving quietly, through the success path, on every feed the hospital runs.
 *
 * Raising the ceiling does not fix it and this suite is written so that it cannot be faked that way:
 * the populations here (1001 and 10001) are deliberately larger than any roster limit in the
 * repository, and the patient the feed is looking for is always the LAST one written, which is
 * precisely the one an insertion-ordered roster drops first.
 *
 * BOTH IMPLEMENTATIONS ARE RUN AGAINST THE SAME EXPECTATIONS. A memory double and a real SQLite
 * store that disagree about identity semantics is how a suite stays green over a defect only
 * production has, so every structural test below runs twice, once per implementation.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-identity-index.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { MemoryRepository, IdentityConflictError, VersionConflictError, MAX_ROSTER, rowOf } from "../functions/_wardsynq/repository.js";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { patientIdentifierKeys, identifierKey, identifierValue } from "../functions/_wardsynq/identity-key.js";
import { reconcileIdentity } from "../functions/_wardsynq/fhir-inbound.js";

/* ------------------------------------------------------------------ the two implementations */

/** The D1 binding surface over node:sqlite, the same shim repository-sqlite.js ships. */
function d1(db) {
  return {
    prepare(sql) {
      const st = { sql, args: [] };
      st.bind = (...a) => { st.args = a; return st; };
      st.all = async () => ({ results: db.prepare(sql).all(...st.args) });
      st.first = async () => db.prepare(sql).get(...st.args) || null;
      st.run = async () => { const r = db.prepare(sql).run(...st.args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; };
      return st;
    },
    async batch(stmts) {
      const out = [];
      db.exec("BEGIN");
      try { for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
      return out;
    },
  };
}

function sqliteRepo() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../db/connect_schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../functions/db/wardsynq_schema.sql", import.meta.url), "utf8"));
  return new D1Repository(d1(db));
}

/** Both sides of the port, so every structural claim below is asserted about each. */
const IMPLEMENTATIONS = [
  ["MemoryRepository", () => new MemoryRepository()],
  ["D1Repository over real SQLite", sqliteRepo],
];

const patient = (over = {}) => ({
  resourceType: "Patient", version: 1, name: "Somebody", dob: "1970-01-01", sex: "female",
  identifiers: [], meta: {}, ...over,
});

/** Fills a tenant with `n` unrelated patients, then the one the feed will actually look for. */
async function hospitalOf(repo, n, target) {
  for (let i = 0; i < n; i++) {
    await repo.append("t1", [patient({ id: `pat-${String(i).padStart(6, "0")}`, mrn: `BULK-${i}` })]);
  }
  await repo.append("t1", [target]);
}

/* ------------------------------------------------------------------ the canonicalisation itself */

test("identifier normalisation is one rule, and the index and the matcher share it", () => {
  // Systems: every spelling of one system is one key; two unknown systems are never each other.
  assert.equal(identifierKey("ABHA"), identifierKey("https://healthid.ndhm.gov.in"));
  assert.equal(identifierKey("abha"), "abha");
  assert.notEqual(identifierKey("some-lab-system"), identifierKey("another-lab-system"));
  assert.equal(identifierKey(""), "", "no system is not a system");

  // Values: the same hospital number written three ways is one value.
  assert.equal(identifierValue("GH-1024"), "GH1024");
  assert.equal(identifierValue(" gh 1024 "), "GH1024");
  assert.equal(identifierValue("GH1024"), "GH1024");
  // A leading zero is part of a number, not noise.
  assert.notEqual(identifierValue("0042"), identifierValue("42"));

  // An empty system or value is DROPPED, never indexed as "". Otherwise every patient with no ABHA
  // would share one key and match each other, which is the failure this mechanism exists to prevent.
  assert.deepEqual(patientIdentifierKeys(patient({ id: "p", mrn: "", identifiers: [{ system: "ABHA", value: "" }, { system: "", value: "X" }] })), []);

  // The MRN is an identifier like any other, under the system "mrn".
  assert.deepEqual(patientIdentifierKeys(patient({ id: "p", mrn: "GH-1", identifiers: [] })), [{ systemKey: "mrn", valueNorm: "GH1" }]);
  // De-duplicated: the same identifier offered twice is one key.
  assert.equal(patientIdentifierKeys(patient({ id: "p", mrn: "GH-1", identifiers: [{ system: "mrn", value: "gh1" }] })).length, 1);
  // Only a Patient has patient identifiers.
  assert.deepEqual(patientIdentifierKeys({ resourceType: "Observation", id: "o", mrn: "GH-1" }), []);
});

/* ------------------------------------------------------------------ the population proofs */

for (const [label, make] of IMPLEMENTATIONS) {
  test(`${label}: 1001 patients, the target written LAST, is still found by identifier`, async () => {
    const repo = make();
    const target = patient({ id: "pat-target", mrn: "GH-TARGET-1", identifiers: [{ system: "ABHA", value: "11-2222-3333-4444" }] });
    await hospitalOf(repo, 1001, target);

    // The roster genuinely cannot see this patient - that is the defect, reproduced, still true.
    const roster = await repo.latestByType("t1", "Patient", 99999);
    assert.ok(roster.length <= MAX_ROSTER, "the roster is still bounded");
    assert.ok(!roster.some((p) => p.id === "pat-target"), "and the target is outside it, as the defect required");

    // The index finds them regardless, by either identifier, however the value is spelled.
    const byMrn = await repo.patientsByIdentifier("t1", patientIdentifierKeys(patient({ id: "x", mrn: "gh target 1" })));
    assert.deepEqual(byMrn.map((p) => p.id), ["pat-target"]);
    const byAbha = await repo.patientsByIdentifier("t1", patientIdentifierKeys(patient({ id: "x", mrn: "", identifiers: [{ system: "https://healthid.ndhm.gov.in", value: "1122223333 4444" }] })));
    assert.deepEqual(byAbha.map((p) => p.id), ["pat-target"]);
  });

  test(`${label}: 10001 patients, the target outside ANY roster ceiling, is still found`, async () => {
    const repo = make();
    const target = patient({ id: "pat-needle", mrn: "GH-NEEDLE" });
    await hospitalOf(repo, 10001, target);

    const roster = await repo.latestByType("t1", "Patient", 99999);
    assert.ok(!roster.some((p) => p.id === "pat-needle"), "no roster of any permitted size reaches this patient");

    const found = await repo.patientsByIdentifier("t1", patientIdentifierKeys(patient({ id: "x", mrn: "GH-NEEDLE" })));
    assert.deepEqual(found.map((p) => p.id), ["pat-needle"], "the index does not care how many patients exist");
  });

  test(`${label}: reconciliation LINKS the far-away patient instead of creating a duplicate`, async () => {
    const repo = make();
    const target = patient({ id: "pat-returning", mrn: "GH-RETURN-9" });
    await hospitalOf(repo, 1200, target);

    const incoming = patient({ id: "EXT-55", mrn: "GH-RETURN-9", name: "Returning Patient" });

    // What the OLD code did: reconcile against the roster alone.
    const roster = await repo.latestByType("t1", "Patient", 1000);
    assert.equal(reconcileIdentity(incoming, roster, true).decision, "new",
      "THE DEFECT, still reproducible: a roster scan invents a second chart for a patient who is here");

    // What it does now: the index supplies the candidate, the SAME rules decide.
    const indexed = await repo.patientsByIdentifier("t1", patientIdentifierKeys(incoming));
    const byId = new Map();
    for (const p of [...indexed, ...roster]) byId.set(p.id, p);
    const decision = reconcileIdentity(incoming, [...byId.values()], true);
    assert.deepEqual(decision, { decision: "link", localId: "pat-returning", by: "identifier" });
  });

  test(`${label}: a second patient cannot claim an identifier that already identifies someone`, async () => {
    const repo = make();
    await repo.append("t1", [patient({ id: "pat-a", mrn: "GH-DUP" })]);
    await assert.rejects(
      () => repo.append("t1", [patient({ id: "pat-b", mrn: "gh dup" })]),
      (e) => e instanceof IdentityConflictError && e.detail.heldBy === "pat-a" && e.detail.offeredFor === "pat-b",
      "the database itself refuses to give one number to two people, whatever the application does");
    // And the refusal wrote nothing: the loser did not half-land.
    assert.equal(await repo.latest("t1", "Patient", "pat-b"), null);
  });

  test(`${label}: a patient re-offering its OWN identifiers is not a conflict, at any version`, async () => {
    const repo = make();
    const p = patient({ id: "pat-same", mrn: "GH-SAME", identifiers: [{ system: "ABHA", value: "99-8888-7777-6666" }] });
    await repo.append("t1", [p]);
    await repo.append("t1", [{ ...p, version: 2, name: "Corrected Name" }]);
    await repo.append("t1", [{ ...p, version: 3, sex: "male" }]);
    const found = await repo.patientsByIdentifier("t1", patientIdentifierKeys(p));
    assert.deepEqual(found.map((x) => [x.id, x.version]), [["pat-same", 3]], "the latest version, once");
  });

  test(`${label}: an identifier NEVER matches across tenants`, async () => {
    const repo = make();
    await repo.append("t1", [patient({ id: "pat-h1", mrn: "SHARED-1", identifiers: [{ system: "ABHA", value: "11-1111-1111-1111" }] })]);
    // A different hospital legitimately issues the same MRN to a different person.
    await repo.append("t2", [patient({ id: "pat-h2", mrn: "SHARED-1", identifiers: [{ system: "ABHA", value: "22-2222-2222-2222" }] })]);

    const keys = patientIdentifierKeys(patient({ id: "x", mrn: "SHARED-1" }));
    assert.deepEqual((await repo.patientsByIdentifier("t1", keys)).map((p) => p.id), ["pat-h1"]);
    assert.deepEqual((await repo.patientsByIdentifier("t2", keys)).map((p) => p.id), ["pat-h2"]);
    // And the other hospital's ABHA is invisible here, rather than merely outranked.
    const foreign = patientIdentifierKeys(patient({ id: "x", mrn: "", identifiers: [{ system: "ABHA", value: "22-2222-2222-2222" }] }));
    assert.deepEqual(await repo.patientsByIdentifier("t1", foreign), []);
  });

  test(`${label}: different identifiers do not merge, and a near miss is not a match`, async () => {
    const repo = make();
    await repo.append("t1", [patient({ id: "pat-x", mrn: "GH-1000" })]);
    await repo.append("t1", [patient({ id: "pat-y", mrn: "GH-1001" })]);
    assert.deepEqual((await repo.patientsByIdentifier("t1", patientIdentifierKeys(patient({ id: "q", mrn: "GH-1000" })))).map((p) => p.id), ["pat-x"]);
    assert.deepEqual((await repo.patientsByIdentifier("t1", patientIdentifierKeys(patient({ id: "q", mrn: "GH-1002" })))), [], "a number nobody holds matches nobody");
    // Same VALUE under a different SYSTEM is a different identifier, and is not a match.
    await repo.append("t1", [patient({ id: "pat-z", mrn: "", identifiers: [{ system: "some-lab-system", value: "GH-1000" }] })]);
    const sameValueOtherSystem = await repo.patientsByIdentifier("t1", [{ systemKey: "some-lab-system", valueNorm: "GH1000" }]);
    assert.deepEqual(sameValueOtherSystem.map((p) => p.id), ["pat-z"], "and it belongs to the patient who actually holds it");
  });

  test(`${label}: an ambiguity across TWO different people is reported, never guessed`, async () => {
    const repo = make();
    await repo.append("t1", [patient({ id: "pat-one", mrn: "AMB-A" })]);
    await repo.append("t1", [patient({ id: "pat-two", mrn: "AMB-B", identifiers: [{ system: "ABHA", value: "33-3333-3333-3333" }] })]);
    // One incoming patient whose two identifiers belong to two different local people.
    const incoming = patient({ id: "EXT-AMB", mrn: "AMB-A", identifiers: [{ system: "ABHA", value: "33-3333-3333-3333" }] });
    const candidates = await repo.patientsByIdentifier("t1", patientIdentifierKeys(incoming));
    assert.equal(candidates.length, 2, "the index surfaces BOTH, so the reconciler can see the ambiguity");
    assert.equal(reconcileIdentity(incoming, candidates, true).decision, "ambiguous");
  });
}

/* ------------------------------------------------------------------ concurrency and replay */

/* THE RACE, AND WHY IT IS STAGED RATHER THAN TIMED.
 *
 * append() checks who holds an identifier and then writes. Two callers can both pass that check
 * before either writes - that is the whole race - and if the application's check were the only
 * guard, both would then create a patient. The guarantee is supposed to be the PRIMARY KEY, so this
 * test proves exactly that by making BOTH writers pass the pre-check, which is the state a real race
 * produces. Sleeping two promises against each other would not test it: it would test whether this
 * machine happened to interleave them today, and would pass for the wrong reason on a quiet run. */
test("CONCURRENT: when both writers pass the pre-check, the DATABASE refuses the second", async () => {
  const repo = sqliteRepo();
  await repo.append("t1", [patient({ id: "pat-race-a", mrn: "RACE-1" })]);

  // Blind the application-level check, exactly as a lost race blinds it.
  const realOwners = repo._identifierOwners.bind(repo);
  repo._identifierOwners = async () => new Map();
  let refusal = null;
  try { await repo.append("t1", [patient({ id: "pat-race-b", mrn: "RACE-1" })]); }
  catch (e) { refusal = e; }
  repo._identifierOwners = realOwners;

  assert.ok(refusal, "the second writer must not succeed just because the pre-check missed it");
  assert.ok(refusal instanceof IdentityConflictError, `refused by the constraint as an identity conflict, got ${refusal && refusal.name}: ${refusal && refusal.message}`);

  // The loser left NOTHING behind - not a patient row, and not an index entry pointing at a ghost.
  const owners = await repo.patientsByIdentifier("t1", [{ systemKey: "mrn", valueNorm: "RACE1" }]);
  assert.deepEqual(owners.map((p) => p.id), ["pat-race-a"], "one identifier, one patient");
  assert.equal(await repo.latest("t1", "Patient", "pat-race-b"), null, "the refused write rolled back completely");
});

test("REPLAY: the same identifier arriving again and again resolves to the same patient, and writes nothing new", async () => {
  const repo = sqliteRepo();
  const target = patient({ id: "pat-replay", mrn: "GH-REPLAY" });
  await hospitalOf(repo, 1100, target);

  const incoming = patient({ id: "EXT-REPLAY", mrn: "GH-REPLAY" });
  const keys = patientIdentifierKeys(incoming);
  for (let i = 0; i < 5; i++) {
    const found = await repo.patientsByIdentifier("t1", keys);
    assert.deepEqual(found.map((p) => p.id), ["pat-replay"], `attempt ${i + 1} resolves identically`);
    assert.equal(reconcileIdentity(incoming, found, true).decision, "link");
  }
  // Reading never wrote: the patient is still on version 1 after five reconciliations.
  assert.deepEqual((await repo.history("t1", "Patient", "pat-replay")).map((v) => v.version), [1]);
});

/* The SECOND place a roster scan minted a duplicate, found by the repository-wide sweep rather than
 * by the original report. FHIR conditional create asks "create this patient unless one already
 * matches"; answered against a bounded roster it says "no match" for anybody outside it and creates
 * the second chart itself. Same defect, different door. */
test("CONDITIONAL CREATE: If-None-Exist on identifier is decided against the whole register, not a roster", async () => {
  const repo = sqliteRepo();
  const target = patient({ id: "pat-cond", mrn: "GH-COND-7", identifiers: [{ system: "ABHA", value: "44-4444-4444-4444" }] });
  await hospitalOf(repo, 1100, target);

  const keys = patientIdentifierKeys(patient({ id: "x", mrn: "", identifiers: [{ system: "ABHA", value: "44-4444-4444-4444" }] }));

  // The roster the old code searched genuinely does not contain them.
  const roster = await repo.latestByType("t1", "Patient", 1000);
  assert.ok(!roster.some((p) => p.id === "pat-cond"), "outside the roster, which is what made this create a duplicate");

  // The union the condition is now evaluated over does.
  const indexed = await repo.patientsByIdentifier("t1", keys);
  const byId = new Map();
  for (const p of [...indexed, ...roster]) byId.set(p.id, p);
  assert.ok(byId.has("pat-cond"), "the condition now sees the patient it is supposed to find");
  assert.equal(indexed.length, 1, "and finds exactly one, so the create is refused rather than ambiguous");
});

/* WITHOUT A BACKFILL THE WHOLE FIX IS THEORETICAL. The index is maintained on write, so on the day
 * it ships every patient the hospital already holds has no entry in it, and reconciliation would go
 * on missing exactly the people it was built to find while looking like it worked. */
for (const [label, make] of IMPLEMENTATIONS) {
  test(`${label}: patients written BEFORE the index existed become findable after a reindex`, async () => {
    const repo = make();
    const target = patient({ id: "pat-legacy", mrn: "GH-LEGACY", identifiers: [{ system: "ABHA", value: "55-5555-5555-5555" }] });
    await hospitalOf(repo, 1050, target);

    // Simulate a store whose rows pre-date the index: drop every index entry, keep every record.
    if (repo._ident) repo._ident.clear();
    else await repo.db.prepare("DELETE FROM wardsynq_patient_identifier").bind().run();
    assert.deepEqual(await repo.patientsByIdentifier("t1", patientIdentifierKeys(target)), [], "nothing is indexed yet, as on upgrade day");

    const report = await repo.reindexPatientIdentifiers("t1");
    assert.equal(report.scanned, 1051, "every patient was walked, not the first roster-full of them");
    assert.ok(report.indexed >= 1052, `every identifier was recorded, got ${report.indexed}`);
    assert.deepEqual(report.conflicts, [], "and this register holds no pre-existing duplicate identifier");

    assert.deepEqual((await repo.patientsByIdentifier("t1", patientIdentifierKeys(target))).map((p) => p.id), ["pat-legacy"]);
    // Idempotent: running it again records nothing new and reports no conflict against itself.
    const again = await repo.reindexPatientIdentifiers("t1");
    assert.equal(again.indexed, 0);
    assert.deepEqual(again.conflicts, []);
  });
}

test("a reindex REPORTS a pre-existing duplicate identifier rather than silently picking a winner", async () => {
  const repo = new MemoryRepository();
  await repo.append("t1", [patient({ id: "pat-dup-1", mrn: "OLD-DUP" })]);
  // A second patient with the same MRN can only exist from before the constraint, so plant it the
  // only way that state can arise: in the rows, behind the index's back.
  repo._rows.push({ seq: 999, ...rowOf("t1", patient({ id: "pat-dup-2", mrn: "OLD-DUP" })) });

  const report = await repo.reindexPatientIdentifiers("t1");
  assert.equal(report.conflicts.length, 1, "the collision is surfaced for a human to resolve");
  assert.deepEqual(report.conflicts[0], { systemKey: "mrn", valueNorm: "OLDDUP", heldBy: "pat-dup-1", alsoClaimedBy: "pat-dup-2" });
  // And the existing mapping was NOT rewritten underneath anybody.
  assert.deepEqual((await repo.patientsByIdentifier("t1", [{ systemKey: "mrn", valueNorm: "OLDDUP" }])).map((p) => p.id), ["pat-dup-1"]);
});

test("the version conflict and the identity conflict are DIFFERENT errors, because the fix for each is different", async () => {
  const repo = sqliteRepo();
  await repo.append("t1", [patient({ id: "pat-e", mrn: "ERR-1" })]);

  // Same record, same version, twice: read again and retry.
  await assert.rejects(() => repo.append("t1", [patient({ id: "pat-e", mrn: "ERR-1" })]), VersionConflictError);
  // A different person claiming a taken number: do NOT retry, go and look at who holds it.
  await assert.rejects(() => repo.append("t1", [patient({ id: "pat-f", mrn: "ERR-1" })]), IdentityConflictError);
  // And an identity conflict is deliberately NOT a version conflict, so no retry loop absorbs it.
  await assert.rejects(() => repo.append("t1", [patient({ id: "pat-g", mrn: "ERR-1" })]), (e) => !(e instanceof VersionConflictError));
});
