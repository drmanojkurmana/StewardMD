// test/opd-auth.test.mjs — Phase 5 staff auth: PBKDF2 hashing, PIN lockout logic, staff session token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { genSalt, hashSecret, verifySecret, pinLocked, nextPinState, PIN_MAX_ATTEMPTS, mintStaffSession, verifyStaffSession } from "../functions/_opd_auth.js";

const ENV = { FOLLOWCARE_TOKEN_SECRET: "test-secret-32-bytes-long-xxxxxx" };

test("secrets are PBKDF2-hashed, never plaintext; verify only on the right secret", async () => {
  const salt = genSalt();
  const hash = await hashSecret("1234", salt);
  assert.notEqual(hash, "1234");
  assert.ok(hash.length > 20);
  assert.equal(await verifySecret("1234", salt, hash), true);
  assert.equal(await verifySecret("9999", salt, hash), false);   // wrong PIN
  assert.equal(await verifySecret("1234", genSalt(), hash), false); // wrong salt
  assert.equal(await verifySecret("", salt, hash), false);
});

test("PIN lockout: locks after PIN_MAX_ATTEMPTS failures, success resets", () => {
  const now = 1000000;
  let m = { pinAttempts: 0, pinLockedUntil: 0 };
  for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) { m = Object.assign(m, nextPinState(m, now, false)); assert.equal(pinLocked(m, now).locked, false); }
  m = Object.assign(m, nextPinState(m, now, false));   // the 5th failure
  assert.equal(pinLocked(m, now).locked, true, "locked after max attempts");
  assert.equal(pinLocked(m, now + 20 * 60 * 1000).locked, false, "unlocks after the window");
  m = Object.assign(m, nextPinState(m, now, true));    // a success resets
  assert.equal(m.pinAttempts, 0);
  assert.equal(pinLocked(m, now).locked, false);
});

test("staff session token round-trips identity+org; tamper/expiry rejected", async () => {
  const now = 1000000000000;
  const tok = await mintStaffSession(ENV, "org1", "recep1", now);
  const v = await verifyStaffSession(ENV, tok, now + 1000);
  assert.deepEqual(v, { orgId: "org1", identity: "recep1", issuedAt: now });   // issuedAt read back from the signed expiry
  assert.equal(await verifyStaffSession(ENV, tok, now + 13 * 3600 * 1000), null);   // expired (>12h)
  assert.equal(await verifyStaffSession(ENV, tok + "x", now + 1000), null);          // tampered
  assert.equal(await verifyStaffSession(ENV, "garbage", now + 1000), null);
});
