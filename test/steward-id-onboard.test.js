const assert = require("assert");
global.window = global.window || {};
global.window.SMD_STEWARD_ID_FLAGS = { bool: () => true };
global.window.SMD_STEWARD_ID = require("../steward-id.js");
global.window.SMD_ANCHOR = require("../anchor-email.js");
const O = require("../steward-id-onboard.js");

(async () => {
  // real-email user: no prompt, anchor written straight through
  const calls = { prompt: 0, anchor: null };
  await O.run(
    { email: "dr@gmail.com", providerData: [{ providerId: "google.com" }], uid: "u1" },
    { ensure: (cb) => cb("SMD-ABC234"), promptRealEmail: () => { calls.prompt++; }, writeAnchor: (e, s) => { calls.anchor = { e, s }; } }
  );
  assert.equal(calls.prompt, 0, "no prompt for a real email");
  assert.deepEqual(calls.anchor, { e: "dr@gmail.com", s: "google" }, "anchor written from real email");

  // apple proxy user: prompt shown, no straight-through anchor
  const calls2 = { prompt: 0, anchor: null };
  await O.run(
    { email: "x@privaterelay.appleid.com", providerData: [{ providerId: "apple.com" }], uid: "u2" },
    { ensure: (cb) => cb("SMD-ZZZ999"), promptRealEmail: () => { calls2.prompt++; }, writeAnchor: (e, s) => { calls2.anchor = { e, s }; } }
  );
  assert.equal(calls2.prompt, 1, "proxy email prompts for a real one");
  assert.equal(calls2.anchor, null, "no anchor until the user supplies a real email");
  console.log("ok");
})();
