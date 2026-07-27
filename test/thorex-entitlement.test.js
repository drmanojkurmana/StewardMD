const assert = require("assert");
const E = require("../thorex-entitlement.js");
const R = (pro, tier) => E.resolve({ isPro: () => pro, tierFor: () => tier });
assert.equal(R(false, "v2beta"), "free", "non-pro is always free");
assert.equal(R(true, "v1"), "v1", "pro default v1");
assert.equal(R(true, "v2beta"), "v2beta", "pro + granted v2beta");
assert.equal(R(true, undefined), "v1", "pro + no grant -> v1");
console.log("ok");
