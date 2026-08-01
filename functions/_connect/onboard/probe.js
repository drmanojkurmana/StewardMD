// functions/_connect/onboard/probe.js — the capability probe (test endpoint) + SMART token acquisition.
// SSRF-guards the base and any discovered token endpoint (assertPublicHttpsUrl REPLACES the sandbox host-
// allowlist here — self-service brings its own host). Reuses signClientAssertion (the security-critical
// SMART crypto) but NOT discoverSmart/acquireAccessToken (those are frozen to sandbox hosts by design).
// Returns a client-safe { ok, fhirVersion?, softwareName?, error? } — the error is only a CLASS string
// (bad-url | tls | unauthorized | not-fhir | unreachable); a stack / URL / token / upstream body NEVER leak.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { enforce } from "../enterprise/ratelimit.js";
import { signClientAssertion } from "../smart/assertion.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { makeSafeFetch } from "./net.js";
import { OnboardError } from "./errors.js";
import { getRow, recordTest } from "./store.js";

// A blocked-redirect / SSRF class propagates as OnboardError; anything else (network/TLS) is classified.
const klassOf = (e) => (e instanceof OnboardError ? e.klass : classifyFetchError(e));

// Map a thrown fetch error to a class WITHOUT surfacing its message. Node's undici raises a TypeError whose
// .cause.code carries TLS failures (e.g. CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT, ERR_TLS_*).
function classifyFetchError(e) {
  const code = String((e && (e.cause && (e.cause.code || e.cause.reason) || e.code)) || "");
  const msg = String((e && e.message) || "");
  if (/CERT|_TLS_|SSL|SELF_SIGNED|ALTNAME|_HANDSHAKE/i.test(code) || /certificate|self[- ]signed|SSL|TLS/i.test(msg)) return "tls";
  return "unreachable";                                  // DNS/connect/reset/timeout — reachable class not established
}

// Well-known-first, /metadata oauth-uris fallback token-endpoint discovery. SSRF-guarded (base + result).
async function discoverTokenEndpoint(deps, base) {
  const b = base.replace(/\/$/, "");
  try { const r = await deps.fetch(b + "/.well-known/smart-configuration"); if (r && r.ok) { const d = await r.json(); if (d && d.token_endpoint) return d.token_endpoint; } } catch { /* fall through to metadata */ }
  try {
    const r = await deps.fetch(b + "/metadata");
    if (r && r.ok) {
      const cs = await r.json();
      for (const rest of (cs && cs.rest) || []) for (const e of (rest.security && rest.security.extension) || [])
        if (String(e.url).endsWith("oauth-uris")) for (const sub of e.extension || []) if (sub.url === "token") return sub.valueUri;
    }
  } catch { /* fail-closed below */ }
  throw new OnboardError("unauthorized", "SMART token endpoint discovery failed");
}

// Resolve the auth header for a probe/pull. token -> static bearer (or custom header); smart -> SSRF-guarded
// discovery + private_key_jwt client-credentials. Returns { header: {<name>: <value>}, bearer: <token|null> }.
export async function resolveAuth(deps, base, config, creds) {
  if (config.authMethod === "token") {
    const name = (config.headerName && String(config.headerName)) || "authorization";
    const value = name.toLowerCase() === "authorization" ? "Bearer " + creds.token : creds.token;
    // `header` honors a custom header (used by the probe); `bearer` is always the raw token so the connector-
    // based pull can still attempt Authorization: Bearer (the connector emits only a Bearer header).
    return { header: { [name]: value }, bearer: creds.token };
  }
  // smart — all fetches (discovery + the signed token POST) go through the redirect-safe wrapper so a 30x
  // can never bounce the signed client-assertion to a private/other host.
  const sfetch = makeSafeFetch(deps.fetch);
  if (!creds.clientId || !creds.privateKeyJwk || !creds.kid || !creds.alg) throw new OnboardError("unauthorized", "SMART client key material missing");
  let tokenEndpoint = config.tokenEndpoint || await discoverTokenEndpoint({ fetch: sfetch, now: deps.now }, base);
  assertPublicHttpsUrl(tokenEndpoint, "token endpoint");
  const assertion = await signClientAssertion({ now: deps.now }, { clientId: creds.clientId, tokenEndpoint, privateKeyJwk: creds.privateKeyJwk, kid: creds.kid, alg: creds.alg });
  const body = "grant_type=client_credentials&scope=" + encodeURIComponent("system/*.rs") +
    "&client_assertion_type=" + encodeURIComponent("urn:ietf:params:oauth:client-assertion-type:jwt-bearer") +
    "&client_assertion=" + encodeURIComponent(assertion);
  let res;
  try { res = await sfetch(tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); }
  catch (e) { throw new OnboardError(klassOf(e), "token request failed"); }
  if (!res || res.status === 401 || res.status === 403 || !res.ok) throw new OnboardError("unauthorized", "token endpoint refused");
  let data; try { data = await res.json(); } catch { throw new OnboardError("unauthorized", "bad token response"); }
  if (!data.access_token) throw new OnboardError("unauthorized", "no access_token");
  return { header: { authorization: "Bearer " + data.access_token }, bearer: data.access_token };
}

// Generic REST/JSON probe: GET {base}{resultsPath||"/results"} with the resolved auth header; ok iff 2xx AND
// the body matches the SAME array/{results:[...]} contract the connector's fetchPatient accepts (never
// invents rows). No fhirVersion/softwareName — there is no CapabilityStatement for a plain JSON API.
// Reuses the shared PROBE_KLASSES enum: "not-fhir" doubles here as "not the expected JSON shape" (a bad
// response body / unrecognized shape), matching its use elsewhere as "this endpoint isn't what we expected".
async function runRestProbe(sfetch, base, config, header) {
  const path = (config && config.resultsPath) || "/results";
  let res;
  try { res = await sfetch(base + path, { headers: header }); } catch (e) { return { ok: false, error: klassOf(e) }; }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
  if (!res.ok) return { ok: false, error: "unreachable" };
  let data;
  try { data = await res.json(); } catch { return { ok: false, error: "not-fhir" }; }
  if (!(Array.isArray(data) || (data && Array.isArray(data.results)))) return { ok: false, error: "not-fhir" };
  return { ok: true };
}

// Generic DICOMweb QIDO-RS probe: GET {base}{studiesPath||"/studies"}?limit=1 with the resolved auth header +
// the DICOM-JSON Accept header; ok iff 2xx AND the body is a bare JSON array (the SAME shape the connector's
// fetchPatient accepts — never invents studies). No fhirVersion/softwareName — there is no CapabilityStatement
// for DICOMweb. Reuses "not-fhir" as "not the expected JSON shape", matching runRestProbe's convention.
async function runDicomProbe(sfetch, base, config, header) {
  const path = (config && config.studiesPath) || "/studies";
  const acceptHeader = Object.assign({ accept: "application/dicom+json" }, header);
  let res;
  try { res = await sfetch(base + path + "?limit=1", { headers: acceptHeader }); } catch (e) { return { ok: false, error: klassOf(e) }; }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
  if (!res.ok) return { ok: false, error: "unreachable" };
  let data;
  try { data = await res.json(); } catch { return { ok: false, error: "not-fhir" }; }
  if (!Array.isArray(data)) return { ok: false, error: "not-fhir" };
  return { ok: true };
}

// Run the probe against the base. Returns a client-safe result object; never throws for a connection fault
// (those become { ok:false, error }); only a programmer/dep error would propagate.
export async function runProbe(deps, base, config, creds) {
  const sfetch = makeSafeFetch(deps.fetch);              // redirect-safe: every hop re-validated, creds dropped cross-origin
  let b;
  try { b = assertPublicHttpsUrl(base, "baseUrl").href.replace(/\/$/, ""); } catch (e) { return { ok: false, error: e.klass || "bad-url" }; }
  let header;
  try { ({ header } = await resolveAuth(deps, b, config, creds)); } catch (e) { return { ok: false, error: e.klass || "unauthorized" }; }

  // Generic REST/JSON connections probe a single results endpoint (no FHIR CapabilityStatement/Patient search).
  if (config && config.type === "rest-json") return runRestProbe(sfetch, b, config, header);
  // Generic DICOMweb connections probe a single (limited, unfiltered) studies endpoint.
  if (config && config.type === "dicomweb") return runDicomProbe(sfetch, b, config, header);

  // 1. /metadata -> fhirVersion + software.name
  let mres;
  try { mres = await sfetch(b + "/metadata", { headers: header }); } catch (e) { return { ok: false, error: klassOf(e) }; }
  if (mres.status === 401 || mres.status === 403) return { ok: false, error: "unauthorized" };
  if (!mres.ok) return { ok: false, error: "unreachable" };
  let cs; try { cs = await mres.json(); } catch { return { ok: false, error: "not-fhir" }; }
  if (!cs || cs.resourceType !== "CapabilityStatement") return { ok: false, error: "not-fhir" };
  const fhirVersion = cs.fhirVersion || null;
  const softwareName = (cs.software && cs.software.name) || null;

  // 2. /Patient?_count=1 -> a searchset Bundle proves read+search works under this auth
  let pres;
  try { pres = await sfetch(b + "/Patient?_count=1", { headers: header }); } catch (e) { return { ok: false, error: klassOf(e) }; }
  if (pres.status === 401 || pres.status === 403) return { ok: false, error: "unauthorized" };
  if (!pres.ok) return { ok: false, error: "unreachable" };
  let pb; try { pb = await pres.json(); } catch { return { ok: false, error: "not-fhir" }; }
  if (!pb || pb.resourceType !== "Bundle") return { ok: false, error: "not-fhir" };

  return { ok: true, fhirVersion, softwareName };
}

// Endpoint: RBAC-gated (connector:validate), opens the sealed creds, probes, records + audits (PHI-free).
export async function testConnection(deps, request, env, tenantId, connectionId) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:validate");
  await enforce(deps, env, tenant.id, "connector:validate", actor.id);   // throttle the egress-probe primitive (fail-open on a KV blip)
  const { row, config } = await getRow(deps.db, tenant.id, connectionId);
  let creds = {}; try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch { creds = {}; }
  const result = await runProbe(deps, row.base_url, config, creds);
  await recordTest(deps, tenant.id, connectionId, result);
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, connectorId: connectionId, action: "connect.onboard.tested", outcome: result.ok ? "ok" : "error", ts: new Date().toISOString() });
  return result;
}
