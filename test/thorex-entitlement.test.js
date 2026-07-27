const assert = require("assert");
const E = require("../thorex-entitlement.js");
const R = (pro, tier) => E.resolve({ isPro: () => pro, tierFor: () => tier });
assert.equal(R(false, "v2beta"), "free", "non-pro is always free");
assert.equal(R(true, "v1"), "v1", "pro default v1");
assert.equal(R(true, "v2beta"), "v2beta", "pro + granted v2beta");
assert.equal(R(true, undefined), "v1", "pro + no grant -> v1");
// V2 Beta local opt-in flag: Pro + flag on -> v2beta (even without an access-code grant); non-pro stays free.
const RF = (pro, tier, flag) => E.resolve({ isPro: () => pro, tierFor: () => tier, v2betaFlag: () => flag });
assert.equal(RF(true, "v1", true), "v2beta", "pro + v2beta flag on -> v2beta");
assert.equal(RF(false, "v1", true), "free", "non-pro + flag on is still free");
assert.equal(RF(true, "v1", false), "v1", "pro + flag off -> v1 (default)");
console.log("ok");
