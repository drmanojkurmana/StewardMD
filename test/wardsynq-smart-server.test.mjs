/* test/wardsynq-smart-server.test.mjs — letting another application read this record, as somebody. Pure.
 *
 * node --test test/wardsynq-smart-server.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRANT_TYPE, JWT_BEARER, smartEnabled, findClient, parseScope, grantScopes, readTypesFor, compartmentTypesFor, pkceMatches, randomToken,
  smartConfiguration, decodeJws, verifyClientAssertion, SmartGrant, grantLive, consentPage, signingKey, publicJwks, signJwt,
} from "../functions/_wardsynq/smart-server.js";
import { hit, resetMemory, memoryStore } from "../functions/_wardsynq/rate-limit.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";
import { FHIR_TYPE } from "../functions/_wardsynq/fhir.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/smart-server.js", import.meta.url), "utf8");
const subtle = globalThis.crypto.subtle;
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

async function es256Client(clientId, kid = "k1") {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await subtle.exportKey("jwk", kp.publicKey);
  const client = { clientId, kind: "backend", scopes: ["system/*.read"], jwks: { keys: [{ ...pub, kid, alg: "ES256", use: "sig" }] } };
  const sign = async (claims, header = {}) => {
    const h = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid, ...header }));
    const p = b64url(JSON.stringify(claims));
    const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { client, sign, kp };
}

test("OFF UNLESS THE HOSPITAL TURNS IT ON, and clients are configuration, not registration", () => {
  assert.equal(smartEnabled(null), false);
  assert.equal(smartEnabled({ smart: { enabled: "true" } }), false);
  assert.equal(smartEnabled({ smart: { enabled: true } }), true);
  const cfg = { smart: { enabled: true, clients: [{ clientId: "app", redirectUris: ["https://a/cb"], scopes: ["user/*.read"] }, { clientId: "sys", kind: "backend", scopes: ["system/Observation.read"], jwks: { keys: [] } }] } };
  assert.equal(findClient(cfg, "app").kind, "public", "public unless said otherwise");
  assert.equal(findClient(cfg, "sys").kind, "backend");
  assert.equal(findClient(cfg, "sys").jwks, null, "an empty key set is no key set");
  assert.equal(findClient(cfg, "nobody"), null);
  assert.equal(findClient(cfg, ""), null);
  assert.ok(!/registerClient|dynamic/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")), "no registration endpoint exists");
});

test("SCOPES: user/ and system/ read only; never widened; a registered wildcard covers, a requested one does not", () => {
  assert.deepEqual(parseScope("user/Observation.read"), { context: "user", resource: "Observation", access: "read", raw: "user/Observation.read" });
  assert.equal(parseScope("user/Observation.rs").raw, "user/Observation.read", "v2 spelling accepted, normalised");
  assert.deepEqual(parseScope("patient/Observation.read"), { context: "patient", resource: "Observation", access: "read", raw: "patient/Observation.read" }, "a patient scope, fenced to the token's patient by the read layer");
  assert.equal(parseScope("user/Observation.write"), null, "no writes");
  assert.equal(parseScope("user/Observation.*"), null);
  assert.equal(parseScope("user/Practitioner.read"), null, "a type this server does not export");
  assert.equal(parseScope("launch"), null);

  const wide = grantScopes("user/Observation.read user/Encounter.read", ["user/*.read"], "user");
  assert.deepEqual(wide.granted, ["user/Observation.read", "user/Encounter.read"]);
  const narrow = grantScopes("user/*.read user/Observation.read", ["user/Observation.read"], "user");
  assert.deepEqual(narrow.granted, ["user/Observation.read"], "asking for everything against a narrow registration yields the narrow grant");
  assert.deepEqual(narrow.dropped, ["user/*.read"]);
  assert.deepEqual(grantScopes("system/Patient.read", ["user/*.read"], "user").granted, [], "the wrong context is not granted");
  assert.deepEqual(grantScopes("", ["user/*.read"], "user").granted, []);

  assert.equal(readTypesFor(["user/*.read"]), null, "every exported type");
  assert.deepEqual(readTypesFor(["user/Observation.read", "user/MedicationRequest.read"]), ["Observation", "MedicationOrder"], "in CANONICAL names, which is what the store checks");
  assert.deepEqual(readTypesFor([]), []);
});

test("PKCE: S256 only, and a verifier must be a real verifier", async () => {
  const verifier = randomToken(48);
  assert.ok(verifier.length >= 43);
  const challenge = b64url(await subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  assert.equal(await pkceMatches(verifier, challenge), true);
  assert.equal(await pkceMatches(verifier + "x", challenge), false);
  assert.equal(await pkceMatches("short", challenge), false, "RFC 7636 minimum length");
  assert.equal(await pkceMatches(verifier, verifier), false, "plain is never accepted: a challenge equal to its verifier protects nothing");
});

test("the smart-configuration document declares exactly what is implemented", () => {
  const cfg = { smart: { enabled: true, clients: [{ clientId: "a", scopes: ["user/Observation.read", "user/*.read", "bogus"] }, { clientId: "b", kind: "backend", scopes: ["system/Patient.read"] }] } };
  const d = smartConfiguration("https://h/api/fhir/org1", cfg);
  assert.equal(d.issuer, "https://h/api/fhir/org1");
  assert.equal(d.authorization_endpoint, "https://h/api/fhir/org1/smart/authorize");
  assert.equal(d.token_endpoint, "https://h/api/fhir/org1/smart/token");
  assert.deepEqual(d.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(d.grant_types_supported, ["authorization_code", "client_credentials", "refresh_token"]);
  assert.deepEqual(d.scopes_supported.sort(), ["system/Patient.read", "user/*.read", "user/Observation.read"], "only scopes a registered client actually holds, and nothing unparseable");
  assert.deepEqual(d["x-wardsynq"], { launch: true, patientScopes: true, refreshTokens: true, idToken: false, writes: false });
  assert.equal(d.jwks_uri, undefined, "no signing key, no jwks_uri and no OpenID");
  assert.ok(!d.capabilities.includes("sso-openid-connect"));
  // With a key, and a client registered for openid: OpenID is offered and the key is discoverable.
  const cfg2 = { smart: { enabled: true, clients: [{ clientId: "a", scopes: ["user/*.read", "openid", "fhirUser", "launch", "offline_access"] }] } };
  const d2 = smartConfiguration("https://h/api/fhir/org1", cfg2, { signingKey: { kid: "k" } });
  assert.equal(d2.jwks_uri, "https://h/api/fhir/org1/.well-known/jwks.json");
  assert.ok(d2.capabilities.includes("sso-openid-connect") && d2.capabilities.includes("launch-ehr") && d2.capabilities.includes("permission-patient"));
  assert.deepEqual(d2.scopes_supported.sort(), ["fhirUser", "launch", "offline_access", "openid", "user/*.read"]);
  assert.ok(!smartConfiguration("https://h/api/fhir/org1", cfg2).scopes_supported.includes("openid"), "openid is not offered without a key even when a client is registered for it");
  assert.equal(d2["x-wardsynq"].idToken, true);
});

test("PATIENT SCOPES: fenced types are exactly those held ONLY by a patient/ scope; special scopes are granted by registration, by name", () => {
  assert.equal(compartmentTypesFor(["user/Observation.read"]), null, "no patient scope: nothing fenced");
  assert.deepEqual(compartmentTypesFor(["patient/Observation.read", "patient/Encounter.read"]), ["Observation", "Encounter"]);
  assert.deepEqual(compartmentTypesFor(["patient/Observation.read", "user/Observation.read"]), [], "a user scope on the same type lifts the fence for it");
  assert.equal(compartmentTypesFor(["patient/*.read"]), "*", "everything fenced");
  assert.deepEqual(compartmentTypesFor(["patient/*.read", "user/Patient.read"]), Object.keys(FHIR_TYPE).filter((t) => t !== "Patient"));
  assert.deepEqual(compartmentTypesFor(["patient/*.read", "user/*.read"]), []);
  const g = grantScopes("launch patient/Observation.read user/Patient.read openid offline_access bogus", ["launch", "patient/*.read", "user/Patient.read", "openid"], ["user", "patient"]);
  assert.deepEqual(g.granted, ["patient/Observation.read", "user/Patient.read", "launch", "openid"]);
  assert.deepEqual(g.dropped, ["offline_access", "bogus"], "offline_access was not registered, so it is dropped and named");
  assert.deepEqual(grantScopes("launch/patient patient/Observation.read", ["patient/*.read"], ["user", "patient"]).dropped, ["launch/patient"], "a special scope is never implied by a resource scope");
});

test("THE CONSENT PAGE says everything, escapes everything, and runs nothing", () => {
  const html = consentPage({ clientName: "Viewer <b>x</b>", who: "Dr A", hospital: "H", granted: ["patient/Observation.read", "launch", "offline_access"], dropped: ["user/Encounter.read"], patient: { id: "p1", display: "p1" }, encounter: "e1", action: "https://h/api/fhir/o/smart/authorize", authz: "tx\"quoted", tokenTtlSeconds: 3600, refresh: true, refreshTtlSeconds: 86400 });
  assert.match(html, /Viewer &lt;b&gt;x&lt;\/b&gt;/, "the client name is escaped");
  assert.match(html, /value="tx&quot;quoted"/, "the transaction id is escaped");
  assert.match(html, /Read this patient's Observation data/);
  assert.match(html, /will NOT get[\s\S]*user\/Encounter\.read/);
  assert.match(html, /Confined to patient <strong>p1<\/strong> \(encounter e1\)/);
  assert.match(html, /may be refreshed for up to 24 hours/);
  assert.ok(!/<script/i.test(html) && !/\son[a-z]+=/i.test(html), "no script, no inline handler");
  assert.ok(!/—/.test(html), "no em-dash");
  const ask = consentPage({ clientName: "A", who: "w", hospital: "h", granted: ["launch/patient", "patient/*.read"], dropped: [], needsPatient: true, patientError: "No patient here matches that MRN or id.", action: "/a", authz: "t" });
  assert.match(ask, /<input name="patient" required/);
  assert.match(ask, /No patient here matches/);
});

test("CLIENT ASSERTION: verified against the REGISTERED key, and every claim checked", async () => {
  const { client, sign } = await es256Client("lab-sys");
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: "lab-sys", sub: "lab-sys", aud: "https://h/api/fhir/org1/smart/token", exp: now + 120, jti: "j1" };
  const opts = { tokenEndpoint: "https://h/api/fhir/org1/smart/token", nowSeconds: now };

  const ok = await verifyClientAssertion(await sign(good), client, opts);
  assert.equal(ok.ok, true, ok.detail);
  assert.equal(ok.kid, "k1");

  assert.match((await verifyClientAssertion(await sign({ ...good, aud: "https://elsewhere/token" }), client, opts)).detail, /aud/);
  assert.match((await verifyClientAssertion(await sign({ ...good, exp: now - 1 }), client, opts)).detail, /expired/);
  assert.match((await verifyClientAssertion(await sign({ ...good, exp: now + 3600 }), client, opts)).detail, /five minutes/);
  assert.match((await verifyClientAssertion(await sign({ ...good, jti: "" }), client, opts)).detail, /jti/);
  assert.match((await verifyClientAssertion(await sign({ ...good, sub: "someone-else" }), client, opts)).detail, /iss and sub/);
  assert.match((await verifyClientAssertion(await sign(good, { alg: "none" }), client, opts)).detail, /alg none/);
  assert.match((await verifyClientAssertion(await sign(good, { kid: "unknown" }), client, opts)).detail, /no registered key/);

  // A different key of the same client id: the signature does not verify. Keys are the hospital's registration.
  const other = await es256Client("lab-sys");
  assert.match((await verifyClientAssertion(await other.sign(good), client, opts)).detail, /signature did not verify/);
  assert.equal((await verifyClientAssertion("not.a.jwt", client, opts)).ok, false);
  assert.equal(decodeJws("garbage"), null);
  assert.equal(JWT_BEARER, "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
});

test("GRANTS hold digests, expire by the record's clock, and fail CLOSED on an unreadable one", () => {
  const g = SmartGrant({ id: "wsq-smart-token-abc", kind: "token", clientId: "app", clientKind: "public", subject: "fb:dr", subjectKind: "human", scopes: ["user/Observation.read"], readTypes: ["Observation"], issuedAt: "2026-09-08T10:00:00.000Z", expiresAt: "2026-09-08T11:00:00.000Z" });
  assert.ok(!JSON.stringify(g).includes("access_token"));
  assert.equal(grantLive(g, "2026-09-08T10:30:00.000Z").ok, true);
  assert.equal(grantLive(g, "2026-09-08T11:00:00.000Z").reason, "expired", "the expiry instant itself is expired");
  assert.equal(grantLive({ ...g, revokedAt: "2026-09-08T10:31:00.000Z" }, "2026-09-08T10:30:00.000Z").reason, "revoked");
  assert.equal(grantLive({ ...g, expiresAt: "nonsense" }, "2026-09-08T10:30:00.000Z").reason, "unusable");
  assert.ok(RESOURCE_TYPES.includes(GRANT_TYPE));
  // Tokens and codes are never stored: only their digests name the grant.
  assert.ok(/hashSecret\(secret/.test(SRC));
  assert.ok(!/access:\s*access\b|token:\s*access\b/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")), "the plaintext token is not placed on the grant");
});

test("RATE LIMIT: a fixed window that says which store it is", async () => {
  resetMemory();
  const deps = { store: memoryStore() };
  let last;
  for (let i = 0; i < 3; i++) last = await hit(deps, { key: "t", limit: 3, windowMs: 60000, now: 1000 });
  assert.equal(last.allowed, true);
  assert.equal(last.remaining, 0);
  const fourth = await hit(deps, { key: "t", limit: 3, windowMs: 60000, now: 1000 });
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterSeconds >= 1);
  assert.equal(fourth.store, "memory", "and it says so, because memory is per isolate");
  // A new window starts clean; another key is unaffected.
  assert.equal((await hit(deps, { key: "t", limit: 3, windowMs: 60000, now: 1000 + 60001 })).allowed, true);
  assert.equal((await hit(deps, { key: "u", limit: 1, windowMs: 60000, now: 1000 })).allowed, true);
  // A Workers rate-limit binding, when bound, is asked first and is the exact, cross-isolate answer.
  const calls = [];
  const binding = { limit: async ({ key }) => { calls.push(key); return { success: calls.length <= 2 }; } };
  assert.equal((await hit({ binding, store: memoryStore() }, { key: "b", limit: 99, windowMs: 60000 })).store, "binding");
  await hit({ binding }, { key: "b", limit: 99, windowMs: 60000 });
  const third = await hit({ binding }, { key: "b", limit: 99, windowMs: 60000 });
  assert.equal(third.allowed, false); assert.ok(third.retryAfterSeconds >= 1);
  assert.deepEqual(calls, ["b", "b", "b"]);
  // A binding that throws falls through to a store that counts, never to "allowed" without counting.
  const broken = { limit: async () => { throw new Error("binding down"); } };
  assert.equal((await hit({ binding: broken, store: memoryStore() }, { key: "c", limit: 1, windowMs: 60000, now: 5000 })).store, "memory");
  assert.equal((await hit({ binding: broken, store: memoryStore() }, { key: "c", limit: 1, windowMs: 60000, now: 5000 })).allowed, false);
});

test("NO WRITES, EVER - said in code, not only in prose; and nothing is signed without the hospital's key", async () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(/tier: TIER\.READ/.test(code), "the bearer's actor is READ tier");
  assert.ok(/write: \[\]/.test(code), "with an empty write scope");
  // Exactly one place asks for a write authority: a person revoking somebody else's token. Nothing else.
  assert.equal((code.match(/"record:write"/g) || []).length, 1, "no write door except the admin revoking another's token");
  assert.ok(/"record:read"/.test(code), "authorising an app needs the clinician to be able to read the record themselves");
  assert.equal(signingKey({}), null);
  assert.equal(signingKey({ WSQ_SMART_SIGNING_JWK: "not json" }), null);
  assert.equal(signingKey({ WSQ_SMART_SIGNING_JWK: JSON.stringify({ kty: "RSA" }) }), null, "only the key shape this server signs with");
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  const key = signingKey({ WSQ_SMART_SIGNING_JWK: JSON.stringify({ ...priv, kid: "k9" }) });
  assert.equal(key.kid, "k9");
  const pub = publicJwks(key);
  assert.equal(pub.keys.length, 1); assert.ok(!("d" in pub.keys[0])); assert.equal(pub.keys[0].alg, "ES256");
  const jwt = await signJwt(key, { iss: "i", sub: "s", aud: "a", exp: 9999999999 });
  const d = decodeJws(jwt);
  assert.equal(d.header.kid, "k9");
  const verifier = await subtle.importKey("jwk", pub.keys[0], { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, d.signature, new TextEncoder().encode(d.signingInput)), true);
});
