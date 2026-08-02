// test/connect/smart/mock-fhir-server.mjs — ADVERSARIAL mock FHIR server + synthetic SMART token endpoint.
// Test-harness only (never shipped). It verifies the client assertion the way a real authorization server
// would (JWS signature vs JWKS, aud, exp, alg allow-list, jti replay), so a broken/again-symmetric signer is
// caught HERE. Knobs let it serve a poisoned discovery, a scope-narrowed / short-lived / revoked token, an
// over-paged or dangling-reference bundle — to stress the connector's invariants, not confirm them.
import { verifyCompactJws } from "./fixtures/smart-keys.mjs";
import { makeMockKv } from "../../../functions/_connect/testkit.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const SKEW_MS = 60_000;

function synthPatient() { return { resourceType: "Patient", id: "P1", name: [{ text: "Synthetic Testpatient", given: ["Synthetic"], family: "Testpatient" }], gender: "female", birthDate: "1979-05-02" }; }
function synthResource(type, id, patientRef) {
  const base = { resourceType: type, id: type + "-" + id };
  if (type === "Condition") return { ...base, code: { text: "Type 2 diabetes mellitus", coding: [{ system: "http://snomed.info/sct", code: "44054006" }] }, clinicalStatus: { text: "active" }, subject: { reference: "Patient/" + patientRef } };
  if (type === "Observation") return { ...base, category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: id === "vit" ? "vital-signs" : "laboratory" }] }], code: { text: id === "vit" ? "Heart rate" : "HbA1c" }, valueQuantity: { value: id === "vit" ? 88 : 9.1, unit: id === "vit" ? "/min" : "%" }, interpretation: [{ text: "high" }] };
  if (type === "MedicationRequest") return { ...base, medicationCodeableConcept: { text: "Metformin" }, status: "active", dosageInstruction: [{ text: "500 mg PO BID" }] };
  if (type === "AllergyIntolerance") return { ...base, code: { text: "Penicillin" }, criticality: "high" };
  if (type === "DiagnosticReport") return { ...base, code: { text: "CBC" }, status: "final", conclusion: "Unremarkable.", result: [{ reference: "Observation/Observation-lab" }] };
  if (type === "DocumentReference") return { ...base, type: { text: "Discharge summary" }, status: "current", description: "Discharge narrative text." };
  return base;
}

export function makeMockFhir(opts = {}) {
  const BASE = opts.base || "https://smart-mock.local";
  const TOKEN = opts.poisonDiscovery ? "https://evil.exfil.example/token" : BASE + "/oauth/token";
  const ISSUED = "mock-access-" + (opts.tokenTag || "1");                 // the exact token this mock's /oauth/token mints
  // Data endpoints authenticate like a real FHIR server: the bearer must EQUAL the minted token VALUE. A missing
  // header or "Bearer undefined" (the A-F1 bug where the connector read .token instead of .accessToken) is rejected.
  // The old mock only recorded hadAuth=!!authorization, so "Bearer undefined" slipped through and the bug hid.
  const bearerOk = (h) => ((h && (h.authorization || h.Authorization)) || "") === "Bearer " + ISSUED;
  const calls = [];
  const seenJti = new Set(opts.seedJti || []);
  const kv = opts.kv || makeMockKv();
  let patient401Used = false;

  async function tokenResponse(init) {
    const body = new URLSearchParams(String(init.body || ""));
    if (body.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return json({ error: "invalid_request" }, 400);
    const assertion = body.get("client_assertion");
    const v = await verifyCompactJws(assertion);                       // rejects alg:none / HMAC / bad sig structurally
    if (!v.ok) return json({ error: "invalid_client", detail: v.reason }, 400);
    const c = v.claims, now = Date.now();
    if (c.aud !== TOKEN) return json({ error: "invalid_client", detail: "aud-mismatch" }, 400);
    if (!(c.exp * 1000 > now - SKEW_MS)) return json({ error: "invalid_client", detail: "expired" }, 400);
    if (!(c.exp * 1000 <= now + 300_000 + SKEW_MS)) return json({ error: "invalid_client", detail: "exp-too-far" }, 400);
    if (c.iss !== c.sub) return json({ error: "invalid_client", detail: "iss!=sub" }, 400);
    if (!c.jti || seenJti.has(c.jti) || opts.replayJti) return json({ error: "invalid_client", detail: "jti-replay" }, 400);
    seenJti.add(c.jti);
    const requested = body.get("scope") || "";
    const scope = opts.narrowScope || requested;                       // server may narrow
    return json({ access_token: "mock-access-" + (opts.tokenTag || "1"), token_type: "bearer", expires_in: opts.expireToken || 300, scope });
  }

  function searchResponse(type, u) {
    const page = Number(u.searchParams.get("_page") || "1");
    const total = opts.extraPages && ["Observation", "Condition"].includes(type) ? opts.extraPages + 1 : 1;
    const idBase = type === "Observation" ? (page === 1 ? "lab" : "vit") : String(page);
    const entry = [{ resource: synthResource(type, idBase, "P1") }];
    if (opts.danglingRef && type === "DiagnosticReport") entry[0].resource.result = [{ reference: "Observation/Observation-OUT-OF-SCOPE" }];
    const bundle = { resourceType: "Bundle", type: "searchset", entry };
    if (page < total) bundle.link = [{ relation: "next", url: (opts.foreignNext ? "https://evil.exfil.example" : BASE) + "/" + type + "?patient=P1&_page=" + (page + 1) }];
    return json(bundle);
  }

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    const h = init.headers || {};
    // Redaction check: record only method+path and WHETHER an auth header was present — never its value,
    // and assert the assertion/token value never appears in the recorded path.
    calls.push({ method, path: u.pathname + (u.search || ""), hadAuth: !!(h.authorization || h.Authorization) });

    if (u.pathname.endsWith("/.well-known/smart-configuration")) {
      if (opts.noWellKnown) return new Response("", { status: 404 });
      return json({ token_endpoint: TOKEN, token_endpoint_auth_methods_supported: ["private_key_jwt"], token_endpoint_auth_signing_alg_values_supported: ["RS384", "ES384"], scopes_supported: ["system/*.rs"], capabilities: ["client-confidential-asymmetric"] });
    }
    if (u.pathname.endsWith("/metadata")) {
      return json({ resourceType: "CapabilityStatement", rest: [{ security: { extension: [{ url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris", extension: [{ url: "token", valueUri: TOKEN }] }] }, resource: [{ type: "Patient" }, { type: "Observation" }, { type: "Condition" }] }] });
    }
    if (method === "POST" && url.split("?")[0] === TOKEN) return tokenResponse(init);

    let m;
    if ((m = u.pathname.match(/\/Patient\/([^/]+)$/))) {
      if (opts.revokeThenReissue && !patient401Used) { patient401Used = true; return new Response("", { status: 401 }); }   // token-revoked simulation (drives ONE re-auth)
      if (!bearerOk(h)) return new Response("", { status: 401 });                 // data endpoint: enforce the bearer VALUE
      return json(synthPatient());
    }
    // {Type} search. The `patient` query param is OPTIONAL: validate() issues a param-less connectivity probe
    // GET {base}/Patient?_count=1 which a conformant FHIR server MUST answer (authored fix — a real server does
    // not require a patient param to answer a type-level search; the prior mock wrongly 404'd it).
    if (method === "GET" && (m = u.pathname.match(/\/([A-Za-z]+)$/))) {
      if (!bearerOk(h)) return new Response("", { status: 401 });                 // data endpoint: enforce the bearer VALUE
      return searchResponse(m[1], u);
    }
    return new Response("not found", { status: 404 });
  }

  return { fetch, kv, calls, tokenEndpoint: TOKEN, base: BASE };
}
