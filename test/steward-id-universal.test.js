/* The StewardMD ID must be UNIVERSAL: every signed-in user gets one at sign-in.
 *
 * The bug this pins: the ID used to be minted only from icu-collab's ensureIdentity, which was
 * reached only via ICU's group-mode subscription — so it appeared only after a user turned Group
 * mode ON and a unit resolved. A resident who is simply ADDED to someone else's unit (and anyone
 * who never opens ICU) therefore had no ID, which is backwards: the ID is what they are added BY.
 *
 * These assertions cover the decision point (steward-id-onboard._onUser): mint for a signed-in user
 * regardless of the anchor-email flag, once per account, and never when the kill switch is off.
 * USAGE: node --test test/steward-id-universal.test.js
 */
const assert = require("assert");

global.window = global.window || {};
let flags = { smd_steward_id: false, smd_steward_id_mint: true };
global.window.SMD_STEWARD_ID_FLAGS = { bool: (k) => !!flags[k] };

const ensured = [];
global.window.SMD_STEWARD_ID = { ensure: (deps, cb) => { ensured.push(true); cb && cb("SMD-TEST22"); } };
global.window.SMD_ANCHOR = require("../anchor-email.js");

const O = require("../steward-id-onboard.js");

// 1. Anchor-email flow OFF (its default) — the ID is still minted. This is the whole bug.
flags = { smd_steward_id: false, smd_steward_id_mint: true };
O._onUser({ uid: "resident-1", email: "resident@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 1, "a signed-in user gets an ID with the anchor flag OFF and ICU never opened");

// 2. Same account, repeat auth callback (token refresh, tab focus) — no second mint attempt.
O._onUser({ uid: "resident-1", email: "resident@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 1, "repeat callbacks for the same uid do not re-run the mint");

// 3. A different account in the same page lifetime DOES resolve again (never reuse account A's ID).
O._onUser({ uid: "resident-2", email: "other@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 2, "a second account resolves its own ID");

// 4. Signed out then back in as the same user — re-resolved, not skipped.
O._onUser(null);
O._onUser({ uid: "resident-2", email: "other@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 3, "sign-out clears the last-uid latch");

// 5. Kill switch off — no write at all (reversible without a redeploy).
flags = { smd_steward_id: false, smd_steward_id_mint: false };
O._onUser({ uid: "resident-3", email: "third@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 3, "smd_steward_id_mint=0 stops the mint");

// 6. Turning the anchor-email flow ON must not change the mint — it is an additional step, not a
//    precondition. (What that flow then does with a proxy email is covered by steward-id-onboard.test.js.)
flags = { smd_steward_id: true, smd_steward_id_mint: true };
O._onUser({ uid: "resident-4", email: "fourth@hospital.org", providerData: [{ providerId: "google.com" }] });
assert.equal(ensured.length, 4, "anchor flag ON still mints the ID");
assert.ok(O._mintOn(), "mintOn() reads the kill switch");
flags.smd_steward_id_mint = false;
assert.ok(!O._mintOn(), "mintOn() flips with it");

console.log("ok");
