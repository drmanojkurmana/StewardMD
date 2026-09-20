/* A nurse signs in with the login name she was given, whatever her keyboard did to the first letter.
 *
 * THE BUG THIS PINS. The staff console lowercases a login name when it creates the member (mobile
 * keyboards auto-capitalise, and the store's key is case-sensitive), and the sign-in path matched the
 * stored key verbatim. So a nurse added as "nurse1" who typed "Nurse1" was refused with the correct
 * PIN, and the screen told her the Clinic ID, the login or the PIN was wrong - three things, no way
 * to tell which, and all three were right. Reported from a live clinic, 2026-09-21.
 *
 * The exact match still wins, so a clinic that already holds two names differing only in case keeps
 * answering exactly as it did. Only a name that matches nobody is tried again in lower case.
 *
 * node --test --experimental-test-module-mocks test/opd-staff-login-case.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedHospital, as, ORG, ADMIN } from "./_wardsynq-alert-harness.mjs";

const signIn = (identity, pin) => as(null, "/auth/pin", "POST", { clinicCode: ORG, identity, pin });

test("the login name is matched exactly, then in lower case: a capital first letter still signs in", async () => {
  seedHospital();
  const set = await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "nurse1", pin: "482913" });
  assert.equal(set.__status, 200, JSON.stringify(set));

  const exact = await signIn("nurse1", "482913");
  assert.equal(exact.__status, 200, JSON.stringify(exact));
  assert.ok(exact.token, "the name as stored signs in");

  // What a phone keyboard actually sends.
  const capitalised = await signIn("Nurse1", "482913");
  assert.equal(capitalised.__status, 200, JSON.stringify(capitalised));
  assert.ok(capitalised.token, "the same nurse, the same PIN, one capital letter");
  assert.equal(capitalised.identity, "nurse1", "she is signed in as the member that exists, not a new name");

  // A stray space from a copy-paste is the same class of problem.
  assert.equal((await signIn("  NURSE1 ", "482913")).__status, 200, "trimmed and lowered");
});

test("it is a lookup fallback, not a weaker password: the wrong PIN is still refused", async () => {
  seedHospital();
  await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "nurse1", pin: "482913" });
  const wrong = await signIn("Nurse1", "000000");
  assert.equal(wrong.__status, 401, JSON.stringify(wrong));
  assert.equal(wrong.error, "invalid_login");
  // And a login name nobody holds is still refused, in either case.
  assert.equal((await signIn("Nurse2", "482913")).__status, 401);
  assert.equal((await signIn("nurse2", "482913")).__status, 401);
});
