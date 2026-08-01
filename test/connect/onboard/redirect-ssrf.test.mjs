// test/connect/onboard/redirect-ssrf.test.mjs — ADVERSARIAL redirect-SSRF coverage (security review).
// Proves makeSafeFetch (and the probe/pull that route through it) NEVER follow a 30x to a private/internal/
// http host, and DROP credentials + body on a cross-origin hop. These are the live-exploitable cases the
// cooperative-server tests could not catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSafeFetch } from "../../../functions/_connect/onboard/net.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { runProbe } from "../../../functions/_connect/onboard/probe.js";
import { pullConnection } from "../../../functions/_connect/onboard/pull.js";
import { saveConnection } from "../../../functions/_connect/onboard/store.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const redirect = (loc, status = 302) => new Response(null, { status, headers: { location: loc } });
const ok = (obj = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });

test("safeFetch BLOCKS a redirect to the cloud-metadata IP and never fetches it", async () => {
  const calls = [];
  const base = async (url) => { calls.push(String(url)); return redirect("https://169.254.169.254/latest/meta-data"); };
  const sf = makeSafeFetch(base);
  await assert.rejects(() => sf("https://fhir.example.org/metadata", { headers: { authorization: "Bearer s" } }),
    (e) => e instanceof OnboardError && e.klass === "ssrf");
  assert.equal(calls.length, 1);                                    // only the first hop was ever fetched
  assert.equal(calls.some((c) => c.includes("169.254.169.254")), false);
});

test("safeFetch BLOCKS a redirect to a private IP and to an http:// internal host", async () => {
  for (const target of ["https://10.0.0.5/x", "http://169.254.169.254/x"]) {
    const calls = [];
    const base = async (url) => { calls.push(String(url)); return redirect(target); };
    const sf = makeSafeFetch(base);
    await assert.rejects(() => sf("https://fhir.example.org/metadata"), (e) => e instanceof OnboardError && e.klass === "ssrf", target);
    assert.equal(calls.length, 1);                                  // never followed onward
  }
});

test("safeFetch DROPS Authorization + custom header + body on a CROSS-ORIGIN redirect (no cred exfil)", async () => {
  const seen = [];
  const base = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {}, body: init.body, method: init.method });
    if (String(url).startsWith("https://auth.example.org")) return redirect("https://other.example.net/next", 307);  // 307 preserves method+body by spec
    return ok();
  };
  const sf = makeSafeFetch(base);
  await sf("https://auth.example.org/token", { method: "POST", headers: { authorization: "Bearer SECRET", "x-api-key": "KEY" }, body: "client_assertion=SIGNED_JWT" });
  assert.equal(seen.length, 2);
  // hop 1 legitimately carried creds + the signed assertion to the intended origin
  assert.equal(seen[0].headers.authorization, "Bearer SECRET");
  assert.equal(seen[0].body, "client_assertion=SIGNED_JWT");
  // hop 2 (the attacker origin) received NOTHING sensitive
  assert.ok(seen[1].url.startsWith("https://other.example.net"));
  assert.deepEqual(seen[1].headers, {});
  assert.equal(seen[1].body, undefined);
});

test("safeFetch PRESERVES creds on a SAME-ORIGIN redirect (functional, not over-strict)", async () => {
  const seen = [];
  const base = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {} });
    if (String(url).endsWith("/1")) return redirect("https://fhir.example.org/2");   // same origin
    return ok({ ok: true });
  };
  const sf = makeSafeFetch(base);
  const res = await sf("https://fhir.example.org/1", { headers: { authorization: "Bearer keep" } });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].headers.authorization, "Bearer keep");
});

test("safeFetch bounds the redirect chain -> unreachable", async () => {
  const base = async () => redirect("https://fhir.example.org/" + Math.random());
  const sf = makeSafeFetch(base, { maxHops: 3 });
  await assert.rejects(() => sf("https://fhir.example.org/start"), (e) => e instanceof OnboardError && e.klass === "unreachable");
});

test("runProbe: /metadata 302 -> metadata IP is blocked (error 'ssrf', IP never hit)", async () => {
  const calls = [];
  const base = async (url) => { calls.push(String(url)); return String(url).endsWith("/metadata") ? redirect("https://169.254.169.254/x") : ok(); };
  const res = await runProbe({ fetch: base, now: () => Date.now() }, "https://fhir.example.org/r4", { authMethod: "token" }, { token: "t" });
  assert.deepEqual(res, { ok: false, error: "ssrf" });
  assert.equal(calls.some((c) => c.includes("169.254.169.254")), false);
});

test("pullConnection: a FHIR host that 302s the PHI read to the metadata IP is blocked", async () => {
  const env = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(6)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
  const db = makeOnboardDb({ connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "admin" }], connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }] });
  const calls = [];
  const fetchMock = async (url) => { calls.push(String(url)); return String(url).includes("/Patient/") ? redirect("https://169.254.169.254/x") : ok(); };
  const deps = { db, kv: makeMockKv(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: fetchMock, now: () => Date.now() };
  const { connectionId } = await saveConnection(deps, {}, env, "t1", { name: "P", type: "fhir", fhirBaseUrl: "https://fhir.example.org", auth: { method: "token", token: "x" } });
  await assert.rejects(() => pullConnection(deps, {}, env, "t1", connectionId, "P1"), (e) => e instanceof OnboardError && e.klass === "ssrf");
  assert.equal(calls.some((c) => c.includes("169.254.169.254")), false);
});
