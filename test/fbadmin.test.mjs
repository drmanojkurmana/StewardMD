/* test/fbadmin.test.mjs — pure user-admin helpers behind the User access control console.
 * node --test test/fbadmin.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeUser, mergeClaims } from "../functions/_fbadmin.js";

test("summarizeUser maps a raw Firebase record -> console status (lowercased email, parsed claims)", () => {
  const s = summarizeUser({ localId: "u1", email: "Dr.A@Hospital.COM", displayName: "Dr A", disabled: true, customAttributes: '{"pro":true,"verified":false}', lastLoginAt: "1786000000000", createdAt: "1780000000000" });
  assert.equal(s.uid, "u1");
  assert.equal(s.email, "dr.a@hospital.com");
  assert.equal(s.pro, true);
  assert.equal(s.verified, false);
  assert.equal(s.disabled, true);
  assert.equal(s.lastLoginAt, 1786000000000);
});

test("summarizeUser: null in -> null; missing claims -> basic (not pro/verified)", () => {
  assert.equal(summarizeUser(null), null);
  const s = summarizeUser({ localId: "u2", email: "b@c.com" });
  assert.equal(s.pro, false);
  assert.equal(s.verified, false);
  assert.equal(s.disabled, false);
  assert.equal(s.lastLoginAt, null);
});

test("mergeClaims: patch over current, null deletes (clobber-safe)", () => {
  assert.deepEqual(mergeClaims({ pro: true, keep: 1 }, { verified: true }), { pro: true, keep: 1, verified: true });
  assert.deepEqual(mergeClaims({ pro: true, drop: 1 }, { drop: null }), { pro: true });   // null => delete
  assert.deepEqual(mergeClaims({ pro: true }, { pro: false }), { pro: false });            // overwrite
});
