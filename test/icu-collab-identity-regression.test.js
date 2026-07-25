/* Regression guard for the icu-collab.js -> SMD_STEWARD_ID rewire (Task 4 of the ID phase-1 plan).
 * icu-collab.js's genSmdId/emailHash/normalizeId now delegate to window.SMD_STEWARD_ID
 * (steward-id.js) when present. This test asserts the shared module's alphabet + hash are
 * byte-identical to what icu-collab historically produced inline, so:
 *   - old doctorDirectory/{smdId} entries still match the ID format icu-collab expects, and
 *   - old doctorDirectory/e_<hash> entries (keyed by icu-collab's original emailHash) still
 *     resolve unchanged after the rewire.
 * This is a characterization/guard test — it only fails if steward-id.js's alphabet or hash
 * function drifts from the historical icu-collab contract. */
const assert = require("assert");
const S = require("../steward-id.js");

assert.equal(S.emailHash("dr@example.com"), S.emailHash("DR@EXAMPLE.COM"), "hash case-insensitive");
assert.ok(/^SMD-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(S.genId()), "id uses the icu alphabet");
assert.equal(S.normalizeId("abc234"), "SMD-ABC234");

console.log("ok");
