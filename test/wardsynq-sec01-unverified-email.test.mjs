/* SEC-01 (audit A1): a Firebase identity whose email is NOT verified must never match a staff member,
 * an org owner or the platform owner list by address. Firebase signs a valid ID token for a
 * self-signed-up email/password account nobody confirmed, so before this fix an attacker who signed up
 * with a staff member's login email inherited that member's role and the staff roster.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec01-unverified-email.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";

const { verifiedEmailOf } = await import("../functions/_fbauth.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { ownerOK } = await import("../functions/_adminauth.js");

// A real RS256 key served as the Firebase JWKS, so the token passes the real signature check.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }); jwk.kid = "sec01"; jwk.alg = "RS256"; jwk.use = "sig";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => String(u).includes("securetoken@system")
  ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Cache-Control": "max-age=3600", "Content-Type": "application/json" } })
  : realFetch(u, i);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64({ alg: "RS256", kid: "sec01", typ: "JWT" });
  const pl = b64({ iss: "https://securetoken.google.com/stewardmd-498ec", aud: "stewardmd-498ec", sub: "uid-" + Math.random().toString(36).slice(2), iat: now, exp: now + 3600, firebase: { sign_in_provider: "password" }, ...claims });
  return hdr + "." + pl + "." + createSign("RSA-SHA256").update(hdr + "." + pl).sign(privateKey).toString("base64url");
}
async function call(path, tok) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers: { Authorization: "Bearer " + tok } }), env: H.ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status; return j;
}

test("verifiedEmailOf: only a proved address counts", () => {
  assert.equal(verifiedEmailOf({ email: "A@x.in", email_verified: true }), "a@x.in");
  assert.equal(verifiedEmailOf({ email: "a@x.in", email_verified: false }), null);
  assert.equal(verifiedEmailOf({ email: "a@x.in" }), null);
  assert.equal(verifiedEmailOf({ email: "a@x.in", emailVerified: true, emailVerifiedFor: "a@x.in" }), "a@x.in");
  assert.equal(verifiedEmailOf({ email: "b@x.in", emailVerified: true, emailVerifiedFor: "a@x.in" }), null, "proof was for another address");
  assert.equal(verifiedEmailOf({ email: "a@x.in", emailVerified: "true" }), null);
  assert.equal(verifiedEmailOf(null), null);
});

test("an unverified Firebase email does not inherit the staff member's role or the roster", async () => {
  H.seed();
  const tok = idToken({ email: H.HR_A, email_verified: false });
  const who = await call("/whoami?orgId=org-a", tok);
  assert.notEqual(who.role, "hr", "not the hr member");
  assert.ok(!(who.caps || []).includes("staff.admin"));
  const mem = await call("/members?orgId=org-a", tok);
  assert.equal(mem.__status, 403, JSON.stringify(mem));
  assert.ok(!mem.members);
});

test("the same member signing in with a VERIFIED email keeps their role", async () => {
  H.seed();
  for (const claims of [{ email: H.HR_A, email_verified: true }, { email: H.HR_A, email_verified: false, emailVerified: true, emailVerifiedFor: H.HR_A }]) {
    const tok = idToken(claims);
    const who = await call("/whoami?orgId=org-a", tok);
    assert.equal(who.role, "hr", JSON.stringify(who));
    const mem = await call("/members?orgId=org-a", tok);
    assert.equal(mem.__status, 200);
  }
});

test("an unverified platform-owner email is not the platform owner", async () => {
  H.seed();
  const env = { ...H.ENV, OWNER_EMAILS: H.PLATFORM };
  const req = (claims) => new Request("https://x/", { headers: { Authorization: "Bearer " + idToken(claims) } });
  assert.equal(await ownerOK(req({ email: H.PLATFORM, email_verified: false }), env), false);
  assert.equal(await ownerOK(req({ email: H.PLATFORM, email_verified: true }), env), true);
});
