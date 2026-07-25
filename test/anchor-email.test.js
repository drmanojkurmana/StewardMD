const assert = require("assert");
const A = require("../anchor-email.js");
assert.deepEqual(A.classifyEmail("x@privaterelay.appleid.com", "apple.com"), { status: "proxy", source: "apple" });
assert.deepEqual(A.classifyEmail("X@PrivateRelay.AppleID.com", "apple.com"), { status: "proxy", source: "apple" });
assert.deepEqual(A.classifyEmail("", "apple.com"), { status: "empty", source: "apple" });
assert.deepEqual(A.classifyEmail(null, "apple.com"), { status: "empty", source: "apple" });
assert.deepEqual(A.classifyEmail("dr@gmail.com", "google.com"), { status: "real", source: "google" });
assert.deepEqual(A.classifyEmail("dr@hospital.org", "password"), { status: "real", source: "password" });
assert.deepEqual(A.classifyEmail("dr@icloud.com", "apple.com"), { status: "real", source: "apple" });
assert.equal(A.needsRealEmail(A.classifyEmail("x@privaterelay.appleid.com", "apple.com")), true);
assert.equal(A.needsRealEmail(A.classifyEmail("dr@gmail.com", "google.com")), false);
// resolve() reads a user object
assert.deepEqual(A.resolve({ email: "x@privaterelay.appleid.com", providerData: [{ providerId: "apple.com" }] }), { status: "proxy", source: "apple" });
console.log("ok");
