/* test/opd-clinic-login-robustness.test.mjs — Comprehensive tests for OPD staff login robustness.
 *
 * Verifies that staff can reliably sign in with:
 * - Full clinic code (SMD-XXXXXX)
 * - Prefix-less code (XXXXXX or xxxxxx)
 * - Lowercase code (smd-xxxxxx)
 * - Code without hyphen (smdxxxxxx)
 * - Code or orgId with whitespace padding
 * - Raw orgId (case folded)
 * - Identity entered in mixed case or lowercase (matching lowercase or legacy mixed-case stored members)
 * - PIN entered with trailing/leading whitespace
 *
 * node --test --experimental-test-module-mocks test/opd-clinic-login-robustness.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedHospital, as, ORG, ADMIN } from "./_wardsynq-alert-harness.mjs";

test("clinic code resolution is resilient across formatting variants", async () => {
  seedHospital();
  // Set up nurse1 with PIN 482913 in ORG (which has code "SMD-WARD01")
  const setPin = await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "nurse1", pin: "482913" });
  assert.equal(setPin.__status, 200);

  // 1. Full canonical code
  const r1 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "nurse1", pin: "482913" });
  assert.equal(r1.__status, 200, "Full canonical SMD-WARD01 works");
  assert.ok(r1.token);
  assert.equal(r1.orgCode, "SMD-WARD01");

  // 2. Prefix-less code (uppercase)
  const r2 = await as(null, "/auth/pin", "POST", { clinicCode: "WARD01", identity: "nurse1", pin: "482913" });
  assert.equal(r2.__status, 200, "Prefix-less code WARD01 works");
  assert.ok(r2.token);

  // 3. Prefix-less code (lowercase)
  const r3 = await as(null, "/auth/pin", "POST", { clinicCode: "ward01", identity: "nurse1", pin: "482913" });
  assert.equal(r3.__status, 200, "Prefix-less lowercase ward01 works");
  assert.ok(r3.token);

  // 4. Lowercase full code
  const r4 = await as(null, "/auth/pin", "POST", { clinicCode: "smd-ward01", identity: "nurse1", pin: "482913" });
  assert.equal(r4.__status, 200, "Lowercase smd-ward01 works");
  assert.ok(r4.token);

  // 5. Code without hyphen
  const r5 = await as(null, "/auth/pin", "POST", { clinicCode: "smdward01", identity: "nurse1", pin: "482913" });
  assert.equal(r5.__status, 200, "No-hyphen smdward01 works");
  assert.ok(r5.token);

  // 6. Code with whitespace padding
  const r6 = await as(null, "/auth/pin", "POST", { clinicCode: "  SMD-WARD01  ", identity: "nurse1", pin: "482913" });
  assert.equal(r6.__status, 200, "Padded code works");
  assert.ok(r6.token);

  // 7. Raw orgId (org-wsq)
  const r7 = await as(null, "/auth/pin", "POST", { clinicCode: "org-wsq", identity: "nurse1", pin: "482913" });
  assert.equal(r7.__status, 200, "Raw orgId works");
  assert.ok(r7.token);

  // 8. Raw orgId uppercase (ORG-WSQ)
  const r8 = await as(null, "/auth/pin", "POST", { clinicCode: "ORG-WSQ", identity: "nurse1", pin: "482913" });
  assert.equal(r8.__status, 200, "Uppercase raw orgId works");
  assert.ok(r8.token);
});

test("identity casing & PIN whitespace tolerance", async () => {
  seedHospital();

  // Create a member with mixed-case identity (e.g. legacy or mobile auto-capitalized "Reception")
  const addRec = await as(ADMIN, "/member", "POST", { orgId: ORG, identity: "Reception", role: "reception" });
  assert.equal(addRec.__status, 200);
  const setRecPin = await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "Reception", pin: "593721" });
  assert.equal(setRecPin.__status, 200);

  // Staff signs in as lowercase "reception"
  const r1 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "reception", pin: "593721" });
  assert.equal(r1.__status, 200, "Signing in with lowercase reception finds Reception member");
  assert.ok(r1.token);

  // Staff signs in as "Reception"
  const r2 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "Reception", pin: "593721" });
  assert.equal(r2.__status, 200, "Signing in with exact Reception works");
  assert.ok(r2.token);

  // PIN with trailing or leading whitespace (mobile autocomplete / keyboard space)
  const r3 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "reception", pin: "593721 " });
  assert.equal(r3.__status, 200, "PIN with trailing space succeeds");
  assert.ok(r3.token);

  const r4 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "reception", pin: " 593721" });
  assert.equal(r4.__status, 200, "PIN with leading space succeeds");
  assert.ok(r4.token);

  // Consecutive digits PINs (e.g. 1234, 123456) are permitted
  const addConsec = await as(ADMIN, "/member", "POST", { orgId: ORG, identity: "diwa", role: "nurse" });
  assert.equal(addConsec.__status, 200);
  const setConsecPin = await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "diwa", pin: "1234" });
  assert.equal(setConsecPin.__status, 200, "Setting consecutive PIN 1234 is allowed");

  const r5 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "diwa", pin: "1234" });
  assert.equal(r5.__status, 200, "Signing in with 1234 succeeds");
  assert.ok(r5.token);
});

test("security boundary remains enforced: invalid credentials refused", async () => {
  seedHospital();
  await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "nurse1", pin: "482913" });

  // Wrong clinic code
  const w1 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WRONG9", identity: "nurse1", pin: "482913" });
  assert.equal(w1.__status, 401);
  assert.equal(w1.error, "invalid_login");

  // Empty clinic code
  const w2 = await as(null, "/auth/pin", "POST", { clinicCode: "", identity: "nurse1", pin: "482913" });
  assert.equal(w2.__status, 401);
  assert.equal(w2.error, "invalid_login");

  // Wrong staff ID
  const w3 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "ghost", pin: "482913" });
  assert.equal(w3.__status, 401);
  assert.equal(w3.error, "invalid_login");

  // Wrong PIN
  const w4 = await as(null, "/auth/pin", "POST", { clinicCode: "SMD-WARD01", identity: "nurse1", pin: "999999" });
  assert.equal(w4.__status, 401);
  assert.equal(w4.error, "invalid_login");
});
