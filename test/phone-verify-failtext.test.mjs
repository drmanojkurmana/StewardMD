/* phone-verify.js: what the OTP sheet says when a request gets no answer at all.
 *
 * Owner screenshot, 2026-09-28: "You are offline. Try again once you are connected." on a phone with
 * full signal. Every rejection (not signed in, a failed token refresh, a fetch that never returned)
 * used to read as offline. Only the phone's own word counts now.
 *
 * node --test --experimental-test-module-mocks test/phone-verify-failtext.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../phone-verify.js", import.meta.url), "utf8");
function load(onLine) {
  const win = { addEventListener() {}, innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const doc = { readyState: "loading", addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }, body: { appendChild() {}, classList: { contains: () => false } }, createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, setAttribute() {}, appendChild() {} }), documentElement: { style: {} } };
  new Function("window", "document", "location", "navigator", "localStorage", "sessionStorage", SRC)(win, doc, { hash: "", search: "" }, { userAgent: "UA", onLine }, { getItem: () => null, setItem() {}, removeItem() {} }, { getItem: () => null, setItem() {} });
  return win.SMD_PHONE_VERIFY._failText;
}

test("offline only when the phone says so; not signed in is named; anything else is 'could not reach'", () => {
  const off = load(false), on = load(true);
  assert.match(off(new TypeError("Failed to fetch")), /You are offline/);
  assert.match(on(new TypeError("Failed to fetch")), /Couldn't reach StewardMD/);
  assert.doesNotMatch(on(new TypeError("Failed to fetch")), /offline/i, "online: the connection is not blamed as offline");
  assert.match(on(new Error("signin-required")), /Sign in to verify your number/);
  assert.match(on(null), /Couldn't reach StewardMD/, "an empty rejection still gets a sentence");
});

test("both request paths (send a code, verify a code) use it; no hard-coded offline text remains", () => {
  assert.equal((SRC.match(/failed\(failText\(e\)\)|showErr\(failText\(e\)\)/g) || []).length, 2);
  assert.equal(/(failed|showErr)\("You are offline/.test(SRC), false);
});
