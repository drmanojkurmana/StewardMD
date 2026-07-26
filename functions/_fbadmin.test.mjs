import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeClaims } from "./_fbadmin.js";

// Regression guard for the doctor-verification Pro-wipe bug: verifying an already-Pro
// doctor must ADD verified/regNo without clobbering the existing pro/proExp/source claims.
// (Root cause was verify paths calling the whole-object-REPLACING setUserClaims instead of
//  the read-merge mergeUserClaims — mergeClaims is the pure core mergeUserClaims applies.)
test("mergeClaims keeps an existing (timed) pro claim while adding verified", () => {
  const cur = { pro: true, proExp: 1893456000000, source: "stripe" };
  assert.deepEqual(mergeClaims(cur, { verified: true, regNo: "APMC/112487" }), {
    pro: true, proExp: 1893456000000, source: "stripe", verified: true, regNo: "APMC/112487",
  });
});

test("mergeClaims keeps a forever pro claim (proExp absent) while adding verified", () => {
  // grantPro stores "forever" as the ABSENCE of proExp (null is pruned), so the stored claim
  // has no proExp — verifying must not resurrect or drop pro.
  assert.deepEqual(mergeClaims({ pro: true, source: "admin" }, { verified: true, regNo: "R1" }), {
    pro: true, source: "admin", verified: true, regNo: "R1",
  });
});

test("mergeClaims rejecting a doctor keeps pro (only verified flips)", () => {
  assert.deepEqual(mergeClaims({ pro: true, verified: true }, { verified: false }), {
    pro: true, verified: false,
  });
});

test("mergeClaims prunes null/undefined patch keys (delete semantics)", () => {
  assert.deepEqual(mergeClaims({ pro: true, proExp: 123, verified: true }, { pro: null, proExp: undefined }), {
    verified: true,
  });
});

test("mergeClaims tolerates a missing/empty current-claims object", () => {
  assert.deepEqual(mergeClaims(undefined, { verified: true }), { verified: true });
});
