/* test/verify-resync.test.mjs — a verification that lands mid-session refreshes the cached
 * entitlement verdict, so the Subscription row and every Pro gate agree with the verify panel.
 *
 * Reported 2026-09-02: verified, then tapped Subscription, told to verify again. verify.js refreshed
 * the ID token (so the CLAIM was fresh) but never told account.js, whose cached /billing/status
 * payload is what the paywall and SMD_PRO_NOTICE read. Structural assertions over the source, in
 * the style of verify-prompt.test.mjs: evaluate()/submit() need live Firebase.
 *
 * node --test test/verify-resync.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../verify.js", import.meta.url), "utf8");
const body = (fn) => {
  const i = SRC.indexOf("function " + fn);
  assert.ok(i > -1, fn + " not found");
  return SRC.slice(i, i + 4000);
};

test("there is one resync helper and it calls SMD_PRO.sync, best-effort", () => {
  const b = body("resyncPro");
  assert.match(b, /SMD_PRO\.sync\(\)/);
  assert.match(b, /try \{/, "must never throw into the verification flow");
});

test("a successful upload refreshes the token FIRST, then the cached verdict", () => {
  // The upload success branch specifically, not render()'s earlier `var verified = ...` read.
  const i = SRC.indexOf('if (data.status === "verified")');
  assert.ok(i > -1);
  const after = SRC.slice(i, i + 700);
  const tok = after.indexOf("getIdToken(true)");
  const sync = after.indexOf("resyncPro()");
  assert.ok(tok > -1 && sync > -1, "both the token refresh and the resync are on the success path");
  assert.ok(tok < sync, "the status request must carry the NEW claim, so the token refresh comes first");
  assert.ok(after.indexOf("_rememberVerified(true)") > -1, "isVerified() must not keep a cached 'no' after a fresh 'yes'");
});

test("an owner approval discovered by evaluate() refreshes the cached verdict too", () => {
  const ev = body("evaluate");
  const i = ev.indexOf('d.status === "verified"');
  assert.ok(i > -1);
  const branch = ev.slice(i, i + 600);
  assert.ok(branch.indexOf("resyncPro()") > -1, "the approved-while-open path must resync as well");
  assert.ok(branch.indexOf("getIdToken(true)") < branch.indexOf("resyncPro()"), "after the token refresh");
});
