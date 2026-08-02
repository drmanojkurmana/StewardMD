// test/connect/smart/assertion.test.mjs — Task 3 (DUAL-ADVERSARIAL): the private_key_jwt signer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signClientAssertion, SIGN_ALG, AssertionError } from "../../../functions/_connect/smart/assertion.js";
import { RS384_PRIVATE_JWK, ES384_PRIVATE_JWK, verifyCompactJws } from "./fixtures/smart-keys.mjs";

const TE = "https://smart-mock.local/oauth/token";
const decode = (seg) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - seg.length % 4) % 4)), (c) => c.charCodeAt(0))));

test("RS384 sign -> a verifiable 3-part JWS with correct header + claims", async () => {
  const jws = await signClientAssertion({ now: () => 1_700_000_000_000 }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: RS384_PRIVATE_JWK, kid: RS384_PRIVATE_JWK.kid, alg: "RS384" });
  const parts = jws.split("."); assert.equal(parts.length, 3);
  const v = await verifyCompactJws(jws); assert.equal(v.ok, true);
  const h = decode(parts[0]), c = decode(parts[1]);
  assert.deepEqual({ alg: h.alg, kid: h.kid, typ: h.typ }, { alg: "RS384", kid: RS384_PRIVATE_JWK.kid, typ: "JWT" });
  assert.equal(c.iss, "cid"); assert.equal(c.sub, "cid"); assert.equal(c.aud, TE);
  assert.ok(c.exp - c.iat <= 300 && c.exp - c.iat > 0); assert.ok(c.jti);
  assert.equal(c.iat, 1_700_000_000);                          // injected clock honored (not Date.now)
});

test("ES384 sign -> verifiable", async () => {
  const jws = await signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: ES384_PRIVATE_JWK, kid: ES384_PRIVATE_JWK.kid, alg: "ES384" });
  assert.equal((await verifyCompactJws(jws)).ok, true);
});

test("two calls -> two DISTINCT jti", async () => {
  const mk = () => signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: RS384_PRIVATE_JWK, kid: RS384_PRIVATE_JWK.kid, alg: "RS384" });
  const a = decode((await mk()).split(".")[1]).jti, b = decode((await mk()).split(".")[1]).jti;
  assert.notEqual(a, b);
});

test("symmetric / none / unknown alg -> AssertionError, nothing signed", async () => {
  for (const alg of ["HS256", "none", "RS999", undefined]) {
    await assert.rejects(() => signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: RS384_PRIVATE_JWK, kid: "k", alg }), AssertionError);
  }
  assert.deepEqual(Object.keys(SIGN_ALG).sort(), ["ES384", "RS384"]);   // asymmetric-only frozen table
});

test("missing/invalid key material -> AssertionError; the key never leaks into the error", async () => {
  await assert.rejects(() => signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: null, kid: "k", alg: "RS384" }), AssertionError);
  try {
    await signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: { kty: "oct", k: "bad" }, kid: "k", alg: "RS384" });
    assert.fail("should throw");
  } catch (e) { assert.equal(e.message.includes(String(RS384_PRIVATE_JWK.d)), false); }   // no private material in message
});
