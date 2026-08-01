// functions/_connect/onboard/discover.js — auto-discovery: given ONLY a FHIR base URL, detect the server's
// capabilities (FHIR version, software name, SMART Backend Services support) so the onboarding wizard can
// pre-fill the connection. UNAUTHENTICATED probe (most FHIR servers expose /metadata and often
// /.well-known/smart-configuration without credentials) — this is deliberately lighter than probe.js's
// runProbe (which requires creds and also checks /Patient search access); discovery only needs /metadata
// plus a best-effort SMART check. Same SSRF posture as probe.js: assertPublicHttpsUrl guards the base,
// makeSafeFetch guards every hop. Client-safe: only { ok, detected } or { ok:false, error:<class> } — the
// error is a CLASS string only; a stack/URL/response body NEVER leaks (detected.smart.tokenEndpoint is the
// one intentional exception — the discovered token endpoint IS the capability being surfaced for pre-fill,
// and it is re-validated by assertPublicHttpsUrl at save time in store.js before ever being persisted).
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { enforce } from "../enterprise/ratelimit.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { makeSafeFetch } from "./net.js";
import { OnboardError } from "./errors.js";

// Duplicated (NOT imported) from probe.js: classifyFetchError/klassOf are module-private there, and
// importing them would widen probe.js's export surface for an unrelated feature. Kept identical on purpose.
const klassOf = (e) => (e instanceof OnboardError ? e.klass : classifyFetchError(e));
function classifyFetchError(e) {
  const code = String((e && (e.cause && (e.cause.code || e.cause.reason) || e.code)) || "");
  const msg = String((e && e.message) || "");
  if (/CERT|_TLS_|SSL|SELF_SIGNED|ALTNAME|_HANDSHAKE/i.test(code) || /certificate|self[- ]signed|SSL|TLS/i.test(msg)) return "tls";
  return "unreachable";                                  // DNS/connect/reset/timeout — reachable class not established
}

// Scan a CapabilityStatement's rest[].security.extension for the SMART oauth-uris "token" sub-extension —
// the same fallback path probe.js's discoverTokenEndpoint uses, but reusing the CapabilityStatement we
// ALREADY fetched for fhirVersion/software (no second /metadata round-trip).
function scanOauthToken(cs) {
  for (const rest of (cs && cs.rest) || [])
    for (const ext of (rest.security && rest.security.extension) || [])
      if (String(ext.url).endsWith("oauth-uris"))
        for (const sub of ext.extension || []) if (sub.url === "token") return sub.valueUri;
  return null;
}

// Best-effort SMART discovery: well-known first, CapabilityStatement oauth-uris fallback. NEVER fatal to
// the overall discovery — any failure here just yields { supported:false }.
async function discoverSmart(sfetch, base, cs) {
  try {
    const r = await sfetch(base + "/.well-known/smart-configuration");
    if (r && r.ok) {
      const d = await r.json();
      if (d && d.token_endpoint) return { supported: true, tokenEndpoint: String(d.token_endpoint) };
    }
  } catch { /* best-effort; fall through to the CapabilityStatement fallback below */ }
  // A malformed rest[]/security/extension shape (e.g. a truthy non-array) must NEVER be fatal to discovery:
  // scanOauthToken can throw on a hostile CapabilityStatement, so guard it here (keeps the "never fatal to the
  // overall discovery" contract AND ensures discoverCapabilities still reaches its audit sink).
  try {
    const tok = scanOauthToken(cs);
    return tok ? { supported: true, tokenEndpoint: String(tok) } : { supported: false };
  } catch { return { supported: false }; }
}

// Pure capability probe: no RBAC, no audit (mirrors probe.js's runProbe). Returns a client-safe result;
// never throws for a connection fault (those become { ok:false, error }).
export async function runDiscovery(deps, baseUrl) {
  const sfetch = makeSafeFetch(deps.fetch);              // redirect-safe: every hop re-validated
  let b;
  try { b = assertPublicHttpsUrl(baseUrl, "fhirBaseUrl").href.replace(/\/$/, ""); } catch (e) { return { ok: false, error: e.klass || "bad-url" }; }

  let mres;
  try { mres = await sfetch(b + "/metadata"); } catch (e) { return { ok: false, error: klassOf(e) }; }
  if (mres.status === 401 || mres.status === 403) return { ok: false, error: "unauthorized" };
  if (!mres.ok) return { ok: false, error: "unreachable" };
  let cs; try { cs = await mres.json(); } catch { return { ok: false, error: "not-fhir" }; }
  if (!cs || cs.resourceType !== "CapabilityStatement") return { ok: false, error: "not-fhir" };

  const fhirVersion = cs.fhirVersion || null;
  const softwareName = (cs.software && cs.software.name) || null;
  const smart = await discoverSmart(sfetch, b, cs);

  return {
    ok: true,
    detected: { type: "fhir", fhirVersion, softwareName, smart, suggestedAuthMethod: smart.supported ? "smart" : "token" },
  };
}

// Endpoint: RBAC-gated (connector:validate — same action testConnection uses; discovery probes a URL the
// admin is about to save, same trust tier), audits PHI-free.
export async function discoverCapabilities(deps, request, env, tenantId, body = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:validate");
  await enforce(deps, env, tenant.id, "connector:validate", actor.id);   // throttle this egress-probe primitive (fail-open on a KV blip)
  const result = await runDiscovery(deps, body && body.baseUrl);
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, action: "connect.onboard.discovered", outcome: result.ok ? "ok" : "error", ts: new Date().toISOString() });
  return result;
}
