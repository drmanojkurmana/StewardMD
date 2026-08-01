// test/connect/smart/smart-mock.test.mjs — Task 1 self-check: the adversarial mock verifies a client
// assertion like a real AS (good -> token; tampered/none/expired/wrong-aud -> 400) and pages correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMockFhir } from "./mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK, verifyCompactJws } from "./fixtures/smart-keys.mjs";

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

// A minimal inline RS384 signer, ONLY for exercising the mock in this self-check (the real signer is Task 3).
async function signRS384(claims, header = { alg: "RS384", kid: RS384_PRIVATE_JWK.kid, typ: "JWT" }) {
  const data = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(claims));
  const key = await crypto.subtle.importKey("jwk", RS384_PRIVATE_JWK, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(data));
  return data + "." + b64url(sig);
}
const now = () => Math.floor(Date.now() / 1000);
const post = (mock, assertion, scope = "system/*.rs") => mock.fetch(mock.tokenEndpoint, { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", scope, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }).toString() });

test("well-formed assertion -> access token", async () => {
  const mock = makeMockFhir();
  const jws = await signRS384({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now(), exp: now() + 120, jti: "j-1" });
  const res = await post(mock, jws);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.access_token, /^mock-access-/);
  assert.equal(body.token_type, "bearer");
});

test("wrong aud -> 400 invalid_client", async () => {
  const mock = makeMockFhir();
  const jws = await signRS384({ iss: "cid", sub: "cid", aud: "https://evil/token", iat: now(), exp: now() + 120, jti: "j-2" });
  assert.equal((await post(mock, jws)).status, 400);
});

test("expired assertion -> 400", async () => {
  const mock = makeMockFhir();
  const jws = await signRS384({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now() - 1000, exp: now() - 500, jti: "j-3" });
  assert.equal((await post(mock, jws)).status, 400);
});

test("alg:none is rejected (structural) -> 400", async () => {
  const mock = makeMockFhir();
  const header = b64urlStr(JSON.stringify({ alg: "none", kid: RS384_PRIVATE_JWK.kid, typ: "JWT" }));
  const claims = b64urlStr(JSON.stringify({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now(), exp: now() + 120, jti: "j-4" }));
  const forged = header + "." + claims + ".";               // empty signature
  assert.equal((await post(mock, forged)).status, 400);
});

test("jti replay -> 400 on reuse", async () => {
  const mock = makeMockFhir();
  const mk = () => signRS384({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now(), exp: now() + 120, jti: "dup" });
  assert.equal((await post(mock, await mk())).status, 200);
  assert.equal((await post(mock, await mk())).status, 400);  // same jti reused
});

test("poisonDiscovery puts the token endpoint on an off-allow-list host", () => {
  const mock = makeMockFhir({ poisonDiscovery: true });
  assert.equal(new URL(mock.tokenEndpoint).host, "evil.exfil.example");
});

test("paged search returns link.next then a terminal page", async () => {
  const mock = makeMockFhir({ extraPages: 2 });
  const auth = { headers: { authorization: "Bearer mock-access-1" } };      // data endpoints now require the minted bearer
  const p1 = await (await mock.fetch(mock.base + "/Observation?patient=P1&_page=1", auth)).json();
  assert.ok(p1.link && p1.link.find((l) => l.relation === "next"));
  const p3 = await (await mock.fetch(mock.base + "/Observation?patient=P1&_page=3", auth)).json();
  assert.equal(p3.link, undefined);                          // terminal
});

// A-F1: data endpoints validate the bearer VALUE (missing / "Bearer undefined" / wrong -> 401; minted -> 200).
test("data endpoints reject a missing/wrong bearer and accept only the minted token", async () => {
  const mock = makeMockFhir();
  const P = mock.base + "/Patient/P1", S = mock.base + "/Observation?patient=P1";
  assert.equal((await mock.fetch(P)).status, 401);                                                    // no auth
  assert.equal((await mock.fetch(P, { headers: { authorization: "Bearer undefined" } })).status, 401); // the A-F1 bug's literal header
  assert.equal((await mock.fetch(P, { headers: { authorization: "Bearer WRONG" } })).status, 401);
  assert.equal((await mock.fetch(P, { headers: { authorization: "Bearer mock-access-1" } })).status, 200);
  assert.equal((await mock.fetch(S)).status, 401);                                                    // search: no auth
  assert.equal((await mock.fetch(S, { headers: { authorization: "Bearer mock-access-1" } })).status, 200);
  // param-less type search (validate()'s connectivity probe) is answered when authenticated
  assert.equal((await mock.fetch(mock.base + "/Patient?_count=1", { headers: { authorization: "Bearer mock-access-1" } })).status, 200);
});

test("smart-keys JWKS verifies its own signature", async () => {
  const mock = makeMockFhir();
  const jws = await signRS384({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now(), exp: now() + 120, jti: "j-5" });
  const v = await verifyCompactJws(jws);
  assert.equal(v.ok, true);
  assert.equal(v.claims.aud, mock.tokenEndpoint);
});

test("redaction: recorded calls never contain a client_assertion or bearer token value", async () => {
  const mock = makeMockFhir();
  const jws = await signRS384({ iss: "cid", sub: "cid", aud: mock.tokenEndpoint, iat: now(), exp: now() + 120, jti: "j-6" });
  await post(mock, jws);
  await mock.fetch(mock.base + "/Patient/P1", { headers: { authorization: "Bearer mock-access-1" } });
  const blob = JSON.stringify(mock.calls);
  assert.equal(blob.includes(jws), false);                   // assertion value never in the call log path
  assert.equal(blob.includes("mock-access-1"), false);       // bearer token value never in the call log
});
