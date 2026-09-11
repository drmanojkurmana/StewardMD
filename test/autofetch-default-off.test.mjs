/* Auto-fetch stores a GHIS password in the device keystore, so its availability switch is
 * opt-in: absent flag means OFF, not ON.
 *
 * Owner, 2026-08-31: "auto fetch should be off by default and should be turned on by user
 * where he consents for password being stored on phone vault."
 *
 * There are two independent gates and this tests the outer one. The inner gate (the per-patient
 * consent tick that actually authorises storeCred) is unchanged and is what makes storage
 * impossible without consent either way. This one decides whether the feature is reachable at
 * all, and a credential-storing feature should not be reachable until someone asks for it.
 *
 * The old default read `!== "0"`, so a device that had never heard of the flag got the feature
 * switched on, and its catch block returned true on any localStorage failure. Both now fail closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../autofetch.js", import.meta.url), "utf8");

// Pull the real one-line `function on() {...}` out of the IIFE and run it against stubs, so this
// tests the shipped logic rather than a copy of it that could drift.
const decl = SRC.match(/^\s*function on\(\)\s*\{.*\}$/m);
assert.ok(decl, "autofetch.js must still define on() as a single-line function");

function onWith({ native = true, stored = null, throws = false } = {}) {
  const localStorage = {
    getItem(k) {
      if (throws) throw new Error("localStorage unavailable (private mode, disabled site data)");
      return k === "smd_autofetch" ? stored : null;
    }
  };
  const window = { SMD_IS_NATIVE: native };
  return new Function("window", "localStorage", decl[0] + "\nreturn on();")(window, localStorage);
}

test("a device that has never set the flag gets the feature OFF", () => {
  assert.equal(onWith({ stored: null }), false);
});

test("it turns on only when the doctor explicitly enabled it", () => {
  assert.equal(onWith({ stored: "1" }), true);
});

test("an explicit off stays off", () => {
  assert.equal(onWith({ stored: "0" }), false);
});

test("web/PWA never reaches it — there is no OS keystore to hold the credential", () => {
  assert.equal(onWith({ native: false, stored: "1" }), false);
});

test("it fails CLOSED when the flag cannot be read", () => {
  assert.equal(onWith({ throws: true }), false,
    "an unreadable flag must not switch on a feature that stores a password");
});

test("the Settings switch shows the same default the runtime uses", () => {
  const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
  const row = HOME.match(/swRow\("autofetch"[\s\S]*?flag\("smd_autofetch",\s*(true|false)\)/);
  assert.ok(row, "home.js must still render the Auto-fetch settings row");
  assert.equal(row[1], "false",
    "a switch that displays ON while on() returns false would tell the doctor the opposite of the truth");
});
