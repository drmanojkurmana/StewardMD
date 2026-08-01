// test/connect/smart/token.test.mjs — Task 4 (DUAL-ADVERSARIAL): token acquisition + envelope cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireAccessToken, TokenError } from "../../../functions/_connect/smart/token.js";
import { makeMockFhir } from "./mock-fhir-server.mjs";
import { RS384_PRIVATE_JWK } from "./fixtures/smart-keys.mjs";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";

const ENV = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(9)).toString("base64") };
const envelope = makeSecrets(ENV);
const SEC = { clientId: "cid", kid: RS384_PRIVATE_JWK.kid, alg: "RS384", privateKeyJwk: RS384_PRIVATE_JWK };
const CONFIG = { base_url: "https://smart-mock.local/fhir", config: JSON.stringify({ smart: {} }), secret_ref: "x" };
const REQ = ["system/Patient.rs", "system/Observation.rs"];

function deps(mock, over = {}) {
  return { fetch: mock.fetch, kv: over.kv || makeMockKv(), secrets: over.secrets || (async (n) => (n === "smart" ? SEC : null)), envelope, now: () => Date.now(), logger: { warn() {}, error() {} }, tenantId: "t1", connectorId: "fhir-r4" };
}

test("happy path -> access token, granted scopes intersected, cached encrypted", async () => {
  const mock = makeMockFhir(); const d = deps(mock);
  const r = await acquireAccessToken(d, { config: CONFIG, requestedScopes: REQ });
  assert.match(r.accessToken, /^mock-access-/);
  assert.ok(r.grantedScopes.every((s) => REQ.includes(s)));    // never widened
  const cached = await d.kv.get("connect:smart:tok:t1:fhir-r4");
  assert.ok(cached && cached.includes("mock-access-") === false);   // ciphertext, not the raw token
});

test("second call within TTL -> cached token, ZERO token-endpoint POST", async () => {
  const mock = makeMockFhir(); const d = deps(mock);
  await acquireAccessToken(d, { config: CONFIG, requestedScopes: REQ });
  const posts1 = mock.calls.filter((c) => c.method === "POST").length;
  await acquireAccessToken(d, { config: CONFIG, requestedScopes: REQ });
  const posts2 = mock.calls.filter((c) => c.method === "POST").length;
  assert.equal(posts2, posts1);                                // no new exchange
});

test("forceRefresh -> a fresh exchange", async () => {
  const mock = makeMockFhir(); const d = deps(mock);
  await acquireAccessToken(d, { config: CONFIG, requestedScopes: REQ });
  const before = mock.calls.filter((c) => c.method === "POST").length;
  await acquireAccessToken(d, { config: CONFIG, requestedScopes: REQ, forceRefresh: true });
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, before + 1);
});

test("poisoned discovery -> throws, NOTHING is POSTed (nothing signed/sent)", async () => {
  const mock = makeMockFhir({ poisonDiscovery: true });
  await assert.rejects(() => acquireAccessToken(deps(mock), { config: CONFIG, requestedScopes: REQ }));
  assert.equal(mock.calls.some((c) => c.method === "POST"), false);
});

test("missing SMART key material -> TokenError (fail-closed)", async () => {
  const mock = makeMockFhir();
  await assert.rejects(() => acquireAccessToken(deps(mock, { secrets: async () => null }), { config: CONFIG, requestedScopes: REQ }), TokenError);
});

test("server narrows scope -> grantedScopes narrowed accordingly", async () => {
  const mock = makeMockFhir({ narrowScope: "system/Patient.rs" });
  const r = await acquireAccessToken(deps(mock), { config: CONFIG, requestedScopes: REQ });
  assert.deepEqual(r.grantedScopes, ["system/Patient.rs"]);
});
