/* StewardMD — MaiK Vertex Workload Identity Federation (keyless) auth test
 *
 * Exercises the FULL production WIF chain with a throwaway key + mocked Google endpoints
 * (no network, no GCP credentials, NO service-account key): the Worker self-signs an OIDC
 * JWT → STS token-exchange (sts.googleapis.com) → SA impersonation (IAM Credentials
 * generateAccessToken) → Vertex call with the impersonated SA token. Asserts the chain,
 * the Bearer hand-off at each hop, and OAuth token caching.
 *
 * USAGE: node test/run-ai-wif.mjs   (exit 0 = pass). Separate process = fresh token cache.
 */
import { onRequest } from "../functions/api/ai/[[path]].js";
import { generateKeyPairSync } from "node:crypto";

let fails = 0; const ok = (c, m, x) => { console.log((c ? "✅ " : "❌ ") + m + (x !== undefined ? " — " + x : "")); if (!c) fails++; };

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const AUD = "//iam.googleapis.com/projects/911280405587/locations/global/workloadIdentityPools/maik-pool/providers/maik-provider";
const WIF_ENV = { GCP_PROJECT: "stewardmd-498ec", GCP_LOCATION: "us-central1", GCP_SA_EMAIL: "maik-vertex-ai@stewardmd-498ec.iam.gserviceaccount.com",
  GCP_WIF_PRIVATE_KEY: privateKey, GCP_WIF_AUDIENCE: AUD, GCP_WIF_KID: "maik-test", GCP_WIF_ISSUER: "https://stewardmd.in", GCP_WIF_SUBJECT: "maik-worker" };

const pkg = { reasoning: { differential: [{ id: "CAP", name: "CAP", class: "infective", confidence: 82, supporting: [], contradictory: [], missing: [] }] }, grounding: [{ diseaseId: "CAP", name: "CAP", knowledge: [{ section: "harrison.pearl", text: "x", source: { ref: "Harrison 22e" } }], provenance: ["Harrison 22e"], drugRefs: [] }], retrieved: [], treatment: null, refs: {}, patientCase: {} };
const req = () => new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://stewardmd.in" }, body: JSON.stringify({ package: pkg }) });

let c;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url), body = init && init.body ? String(init.body) : "";
  if (u.indexOf("sts.googleapis.com/v1/token") >= 0) {
    c.sts++;
    const b = JSON.parse(body);
    c.stsGrant = b.grantType; c.stsAud = b.audience; c.subjTokParts = (b.subjectToken || "").split(".").length;
    return { json: async () => ({ access_token: "FED-TOKEN", token_type: "Bearer", expires_in: 3600 }) };
  }
  if (u.indexOf("iamcredentials.googleapis.com") >= 0 && u.indexOf("generateAccessToken") >= 0) {
    c.imp++; c.impAuth = init.headers.Authorization; c.impUrl = u;
    return { json: async () => ({ accessToken: "SA-TOKEN", expireTime: new Date(Date.now() + 3600e3).toISOString() }) };
  }
  if (u.indexOf("aiplatform.googleapis.com") >= 0) {
    c.vertex++; c.vertexAuth = init.headers.Authorization;
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: "VERTEX-OK" }] } }] }) };
  }
  throw new Error("unexpected fetch " + u);
};

try {
  c = { sts: 0, imp: 0, vertex: 0 };
  let r = await (await onRequest({ request: req(), env: WIF_ENV, params: { path: ["explain"] } })).json();
  ok(r.text === "VERTEX-OK", "WIF chain returns Vertex output", r.text);
  ok(c.sts === 1 && c.imp === 1 && c.vertex === 1, "one STS exchange + one impersonation + one Vertex call", JSON.stringify({ sts: c.sts, imp: c.imp, vertex: c.vertex }));
  ok(c.stsGrant === "urn:ietf:params:oauth:grant-type:token-exchange" && c.stsAud === AUD, "STS uses token-exchange grant + WIF audience");
  ok(c.subjTokParts === 3, "subject token is a signed 3-part OIDC JWT", c.subjTokParts + " parts");
  ok(c.impAuth === "Bearer FED-TOKEN", "impersonation authorized with the federated STS token", c.impAuth);
  ok(/serviceAccounts\/maik-vertex-ai(%40|@)stewardmd-498ec\.iam\.gserviceaccount\.com:generateAccessToken/.test(c.impUrl), "impersonates the maik-vertex-ai service account", decodeURIComponent(c.impUrl).split("/serviceAccounts/")[1]);
  ok(c.vertexAuth === "Bearer SA-TOKEN", "Vertex called with the impersonated SA access token", c.vertexAuth);

  // caching: second call reuses the SA token (no new STS/impersonation)
  r = await (await onRequest({ request: req(), env: WIF_ENV, params: { path: ["explain"] } })).json();
  ok(r.text === "VERTEX-OK" && c.sts === 1 && c.imp === 1 && c.vertex === 2, "SA token cached (STS+impersonation still 1; Vertex 2)", JSON.stringify({ sts: c.sts, imp: c.imp, vertex: c.vertex }));

  const s = await (await onRequest({ request: new Request("https://stewardmd.in/api/ai/status", { headers: { Origin: "https://stewardmd.in" } }), env: WIF_ENV, params: { path: ["status"] } })).json();
  ok(s.enabled === true && s.provider === "vertex" && s.vertex === true, "/status: Vertex enabled via WIF (no SA key present)", JSON.stringify(s));

  globalThis.fetch = realFetch;
  console.log(`\n${fails === 0 ? "ALL GREEN — WIF keyless auth: OIDC JWT → STS → SA impersonation → Vertex, token cached" : fails + " failed"}`);
  process.exit(fails ? 1 : 0);
} catch (e) { globalThis.fetch = realFetch; console.log("HARNESS ERROR:", e.message); process.exit(2); }
