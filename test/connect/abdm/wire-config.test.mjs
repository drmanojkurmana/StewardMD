// test/connect/abdm/wire-config.test.mjs — the two settings that only a REAL callback can validate.
//
// D14 and D15 were both found on 2026-08-20 by letting the live gateway post to the real receiver
// (scripts/abdm-local-receiver.sh) instead of to a recorder. Together they meant EVERY ABDM callback was
// refused: no JWKS URL was configured so verification threw 503, and once that was fixed the issuer check
// rejected the bearer with 401 because the expected realm string had been truncated. The gateway retries
// non-2xx indefinitely, so production would have been a retry storm serving nothing.
//
// Neither was catchable by the 1109 tests that already existed, and the reason is worth keeping in mind
// when adding tests here: every one of those tests supplies its own JWKS and signs its own bearer with
// whatever issuer it expects. Testing our code against our code cannot find a value that is simply wrong.
// So these assertions pin the LITERAL strings read off the wire, not values recomputed from the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPinnedJwks, JwsError, ABDM_JWKS_HOSTS, ABDM_JWKS_PATH } from "../../../functions/_connect/abdm/jws.js";
import { expectedIssuer } from "../../../functions/_connect/abdm/callbacks.js";

// Read off a genuine callback bearer captured 2026-08-20 (consent/request/on-init):
//   {"alg":"RS256","typ":"JWT","kid":"AlRb5WCm8Tm9EJ_IfO9z06j9oCv51pKKFknGb_TBvK0"}
//   iss: https://dev.abdm.gov.in/auth/realms/central-registry   azp: gateway   aud: account
const REAL_SANDBOX_ISSUER = "https://dev.abdm.gov.in/auth/realms/central-registry";

/** Records the URL getPinnedJwks decides to call, then answers with a minimal valid JWKS. */
function spyFetch() {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ keys: [{ kty: "RSA", kid: "k", n: "x", e: "AQAB" }] }) };
  };
  fn.calls = calls;
  return fn;
}

// ── D15: the issuer ─────────────────────────────────────────────────────────────────────────────────
test("expectedIssuer matches the realm on a real sandbox bearer, in full", () => {
  assert.equal(expectedIssuer({ ABDM_ENV: "sandbox" }), REAL_SANDBOX_ISSUER);
});

test("expectedIssuer is not the truncated realm that rejected every callback (D15)", () => {
  const iss = expectedIssuer({ ABDM_ENV: "sandbox" });
  assert.notEqual(iss, "https://dev.abdm.gov.in/auth/realms/cent");
  assert.ok(iss.endsWith("/auth/realms/central-registry"), "realm must be central-registry, not a prefix of it");
});

test("expectedIssuer follows the environment's gateway host", () => {
  assert.equal(expectedIssuer({ ABDM_ENV: "production" }), "https://apis.abdm.gov.in/auth/realms/central-registry");
});

test("ABDM_TOKEN_ISSUER still overrides, because the realm path is ABDM's to change", () => {
  assert.equal(expectedIssuer({ ABDM_ENV: "sandbox", ABDM_TOKEN_ISSUER: "https://x/realms/y" }), "https://x/realms/y");
});

// ── D14: the JWKS URL ───────────────────────────────────────────────────────────────────────────────
test("getPinnedJwks derives the sandbox certs URL when nothing configures one (D14)", async () => {
  const fetch = spyFetch();
  const jwks = await getPinnedJwks({ ABDM_ENV: "sandbox" }, { fetch });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0], "https://dev.abdm.gov.in" + ABDM_JWKS_PATH);
  assert.equal(jwks.keys.length, 1);
});

test("getPinnedJwks derives the production certs URL", async () => {
  const fetch = spyFetch();
  await getPinnedJwks({ ABDM_ENV: "production" }, { fetch });
  assert.equal(fetch.calls[0], "https://apis.abdm.gov.in" + ABDM_JWKS_PATH);
});

test("an explicit ABDM_JWKS_URL still wins over the derived one", async () => {
  const fetch = spyFetch();
  await getPinnedJwks({ ABDM_ENV: "sandbox", ABDM_JWKS_URL: "https://apis.abdm.gov.in/other/certs" }, { fetch });
  assert.equal(fetch.calls[0], "https://apis.abdm.gov.in/other/certs");
});

test("every derivable JWKS host is on the allow-list, or the derivation is unreachable", () => {
  for (const env of ["sandbox", "production"]) {
    const host = new URL(expectedIssuer({ ABDM_ENV: env })).hostname;
    assert.ok(ABDM_JWKS_HOSTS.includes(host), host + " must be allow-listed");
  }
});

test("an unknown ABDM_ENV fails closed instead of guessing a host", async () => {
  const fetch = spyFetch();
  await assert.rejects(() => getPinnedJwks({ ABDM_ENV: "staging" }, { fetch }), JwsError);
  assert.equal(fetch.calls.length, 0, "must not reach out before it knows where to");
});
