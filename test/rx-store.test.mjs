/* test/rx-store.test.mjs — the security properties of a prescription verification record.
 *
 * "so no one can fake it" is the entire requirement, and it reduces to three claims that must hold
 * no matter what a client sends:
 *
 *   1. The PRESCRIBER cannot be chosen by the caller. Name, registration number and verified status
 *      come from the verified Firebase token's custom claims. If a request body could set them,
 *      anyone could mint a prescription carrying someone else's registration number and the QR
 *      would attest to nothing.
 *   2. The ISSUE DATE cannot be chosen by the caller. A back-dated issuedAt silently resurrects an
 *      expired prescription, because validity is measured from it.
 *   3. NO PATIENT DATA is stored, ever. That is what makes a public, login-free verify page safe -
 *      there is nothing on the record to leak even if a code is guessed.
 *
 * Everything runs against injected fakes (deps), so there is no network and no Firestore here.
 * The "patient" strings below are fixtures for NEGATIVE assertions: the point is that they never
 * reach the record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { issue, lookup, revoke } from "../functions/_rx_store.js";
import { describe } from "../functions/_rx_public.js";

const T0 = Date.UTC(2026, 7, 30);
const ENV = { FIREBASE_PROJECT_ID: "test-project" };
const CLAIMS = { sub: "uid-real", name: "Dr Real", regNo: "TSMC/12345", verified: true };

// A fake Firestore: fsCommit records the writes, fsGet reads them back.
function fakeDb() {
  const docs = new Map();
  return {
    docs,
    deps: {
      now: () => T0,
      randomBytes: (n) => new Uint8Array(n).fill(7),
      // Shaped like the REAL fsGet, which resolves to the Firestore envelope and keeps the record
      // under .fields. This fake used to hand back the bare record, so a lookup() that returned the
      // envelope passed here and produced undefined fields in production: the verify page found the
      // doc, said "Valid prescription", and showed no prescriber and no drugs. A fake more
      // convenient than the thing it stands in for cannot catch that class of bug.
      fsGet: async (_env, path) => {
        const rec = docs.get(path);
        if (!rec) return null;
        return { id: String(path).split("/").pop(), name: "projects/p/databases/(default)/documents/" + path, fields: rec, updateTime: "1970-01-01T00:00:00Z" };
      },
      fsCommit: async (_env, writes) => {
        for (const w of writes) {
          if (w.update) {
            const name = w.update.name || "";
            const key = name.split("/documents/")[1] || name;
            const prev = docs.get(key) || {};
            docs.set(key, Object.assign({}, prev, decode(w.update.fields)));
          }
        }
        return { ok: true };
      },
    },
  };
}
// Minimal inverse of _fbfirestore.encodeFields, enough for these assertions.
function decode(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = dv(fields[k]);
  return out;
}
function dv(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dv);
  if ("mapValue" in v) return decode(v.mapValue.fields);
  return null;
}
const only = (db) => [...db.docs.values()][0];

/* ---------------- 1. the prescriber cannot be forged ---------------- */

test("the prescriber comes from the TOKEN, and a client-supplied one is ignored", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, {
    drugs: [{ name: "Alprazolam", schedule: "H1" }],
    // Everything below is an attempt to impersonate another doctor:
    doctor: { name: "Dr Someone Else", regNo: "FAKE/999", verified: true },
    doctorName: "Dr Someone Else", regNo: "FAKE/999", verified: true, uid: "uid-victim",
  }, db.deps);
  assert.equal(out.status, 200);
  const rec = only(db);
  assert.equal(rec.doctor.name, "Dr Real", "the name must come from the token");
  assert.equal(rec.doctor.regNo, "TSMC/12345", "the registration number must come from the token");
  assert.equal(rec.doctor.uid, "uid-real");
  assert.equal(JSON.stringify(rec).includes("FAKE/999"), false, "no client-supplied identity may survive");
  assert.equal(JSON.stringify(rec).includes("Someone Else"), false);
});

test("verified status is the token's, so an unverified account cannot claim to be verified", async () => {
  const db = fakeDb();
  await issue(ENV, { sub: "uid-2", name: "Dr New", regNo: "", verified: false },
    { drugs: [{ name: "Alprazolam" }], verified: true }, db.deps);
  assert.equal(only(db).doctor.verified, false, "claiming verified:true in the body must not work");
});

test("an anonymous caller cannot issue at all", async () => {
  const db = fakeDb();
  const out = await issue(ENV, {}, { drugs: [{ name: "Alprazolam" }] }, db.deps);
  assert.equal(out.status, 401);
  assert.equal(db.docs.size, 0, "nothing may be written for an unauthenticated caller");
});

/* ---------------- 2. the issue date cannot be forged ---------------- */

test("issuedAt is the SERVER clock - a back-dated request cannot resurrect validity", async () => {
  const db = fakeDb();
  const lastYear = T0 - 400 * 86400000;
  await issue(ENV, CLAIMS,
    { drugs: [{ name: "Alprazolam", schedule: "H1" }], issuedAt: lastYear, validUntil: lastYear }, db.deps);
  const rec = only(db);
  assert.equal(rec.issuedAt, T0, "the client's issuedAt must be ignored");
  assert.equal(rec.validUntil, T0 + 30 * 86400000, "validity is measured from server time");
});

/* ---------------- 3. no patient data, ever ---------------- */

test("NOTHING about the patient is stored, however hard the caller pushes it", async () => {
  const db = fakeDb();
  await issue(ENV, CLAIMS, {
    drugs: [{ name: "Alprazolam", schedule: "H1" }],
    patient: { name: "Ramesh Kumar", age: 54, mrn: "MRN-99881", phone: "+919000000000" },
    patientName: "Ramesh Kumar", mrn: "MRN-99881", diagnosis: "Anxiety disorder",
    age: 54, sex: "M", phone: "+919000000000", address: "12 Main St",
  }, db.deps);
  const blob = JSON.stringify(only(db));
  for (const leak of ["Ramesh", "MRN-99881", "Anxiety", "9000000000", "Main St"]) {
    assert.equal(blob.includes(leak), false, `patient data leaked into the record: ${leak}`);
  }
  assert.deepEqual(Object.keys(only(db).drugs[0]).sort(), ["name"], "only the fields the verifier needs");
});

test("drug dose/frequency/duration ARE kept - a tampered quantity must be detectable", async () => {
  const db = fakeDb();
  await issue(ENV, CLAIMS, {
    drugs: [{ name: "Alprazolam", dose: "0.25 mg", freq: "HS", duration: "7 days", junk: "x".repeat(500) }],
  }, db.deps);
  const d = only(db).drugs[0];
  assert.equal(d.dose, "0.25 mg");
  assert.equal(d.freq, "HS");
  assert.equal(d.duration, "7 days");
  assert.equal(d.junk, undefined, "arbitrary caller fields are dropped, not stored");
});

/* ---------------- scope ---------------- */

/* Every prescription is issued a code. This asserted the opposite until the scope rule was removed:
 * an ordinary sheet printed with no QR and no ID, which reads as a broken feature, and a sheet
 * carrying no code cannot be checked by whoever is holding it. */
test("an ordinary prescription is issued a code like any other", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Amlodipine" }, { name: "Metformin" }] }, db.deps);
  assert.equal(out.body.issued, true, "no scope rule stands between a prescription and its code");
  assert.ok(out.body.code, "and it carries one");
  assert.equal(db.docs.size, 1, "the record exists, so the code resolves when someone scans it");
});

test("an antibiotic alone brings a prescription into scope", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Amlodipine" }, { name: "Azithromycin" }] }, db.deps);
  assert.equal(out.body.issued, true);
  assert.ok(out.body.reasons.some((r) => /antibiotic/i.test(r)), "and the reason is reported back");
});

test("even a blank sheet gets a code", async () => {
  // Asked for explicitly: a prescription with nothing on it still has to be verifiable, so an empty
  // drug list is issued rather than refused.
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [] }, db.deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.issued, true);
  assert.ok(out.body.code, "a blank sheet carries a code too");
  assert.equal(db.docs.size, 1);
});

/* ---------------- lookup + revoke ---------------- */

test("the issued code resolves, and the public view drops the uid", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Alprazolam", schedule: "H1" }] }, db.deps);
  const rec = await lookup(ENV, out.body.code, db.deps);
  assert.ok(rec, "the record is findable by its code");

  const pub = describe(rec, T0 + 1000);
  assert.equal(pub.status, "ACTIVE");
  assert.equal(pub.doctor.regNo, "TSMC/12345");
  assert.equal(pub.doctor.uid, undefined, "the prescriber's uid is nobody else's business");
  assert.equal(JSON.stringify(pub).includes("uid-real"), false);
});

test("a code typed with confusable glyphs still resolves", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Alprazolam" }] }, db.deps);
  const typed = out.body.code.replace(/1/g, "I").replace(/0/g, "O").toLowerCase();
  assert.ok(await lookup(ENV, typed, db.deps), "I/O typed for 1/0 must still find the record");
});

test("only the prescriber may revoke, and revoking never deletes", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Alprazolam" }] }, db.deps);

  const bad = await revoke(ENV, { sub: "uid-someone-else" }, out.body.code, "nope", db.deps);
  assert.equal(bad.status, 403, "a stranger must not be able to revoke someone else's prescription");
  assert.equal((await lookup(ENV, out.body.code, db.deps)).revokedAt, undefined);

  const good = await revoke(ENV, CLAIMS, out.body.code, "wrong drug", db.deps);
  assert.equal(good.status, 200);
  const rec = await lookup(ENV, out.body.code, db.deps);
  assert.ok(rec, "the record still exists after revocation - a paper copy is still in circulation");
  assert.equal(describe(rec, T0 + 1000).status, "REVOKED");
  assert.equal(describe(rec, T0 + 1000).revokedReason, "wrong drug");
});

test("an expired prescription reads EXPIRED with no cron and no backfill", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Alprazolam", schedule: "H1" }] }, db.deps);
  const rec = await lookup(ENV, out.body.code, db.deps);
  assert.equal(describe(rec, T0 + 29 * 86400000).status, "ACTIVE");
  assert.equal(describe(rec, T0 + 31 * 86400000).status, "EXPIRED", "derived from the date on every read");
});

/* Regression: lookup must return the RECORD, never the Firestore envelope.
 *
 * Found in production, not here. fsGet resolves to {id,name,fields,updateTime} and lookup returned
 * it whole, so rec.drugs and rec.doctor were undefined everywhere. Nothing threw: the doc was
 * found, so the page said "Valid prescription" while listing no prescriber and no drugs, and
 * revoke answered 403 to the very prescriber who issued it. A verification that confirms nothing
 * is worse than none, because it is believed.
 */
test("lookup returns the record itself, not the Firestore envelope", async () => {
  const db = fakeDb();
  const out = await issue(ENV, CLAIMS, { drugs: [{ name: "Amoxicillin", dose: "500 mg" }] }, db.deps);
  const rec = await lookup(ENV, out.body.code, db.deps);

  assert.ok(rec, "the record is found");
  assert.equal(rec.fields, undefined, "not the envelope - an envelope here is the production bug");
  assert.equal(rec.code, out.body.code, "the code reads straight off the record");
  assert.equal(rec.drugs.length, 1, "and the drugs a pharmacist compares against the paper are present");
  assert.equal(rec.drugs[0].name, "Amoxicillin");
  assert.ok(rec.doctor && rec.doctor.uid, "the prescriber is on the record, so revoke can match them");
});
