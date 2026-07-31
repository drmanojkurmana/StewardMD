// functions/_connect/smart/discovery.js — SMART discovery + the token-endpoint TRUST GATE (anti-exfil).
// The token endpoint comes from attacker-influenceable discovery, so it is validated (https, no userinfo,
// host-allow-listed) BEFORE anything is signed or POSTed. Fail-closed on any error. Only the NON-PHI
// discovery doc is cached.
export class SmartError extends Error {}

// // VERIFY: the real hospital FHIR base host(s) AND their authorization-server host(s) (often DISTINCT).
export const SMART_HOST_ALLOWLIST = Object.freeze(["launch.smarthealthit.org", "smart-mock.local"]);

// The frozen list is the HARD CEILING. A per-tenant override (from config) may only NARROW it, never widen
// it; a non-array override is ignored (defends against a string degrading `.includes` to substring match).
export function effectiveAllowlist(override) {
  if (!Array.isArray(override)) return SMART_HOST_ALLOWLIST;
  return SMART_HOST_ALLOWLIST.filter((h) => override.includes(h));
}
export function assertHostAllowed(urlStr, override, label = "url") {
  let u; try { u = new URL(urlStr); } catch { throw new SmartError("invalid " + label); }
  if (u.protocol !== "https:") throw new SmartError(label + " must be https");
  if (u.username || u.password) throw new SmartError(label + " must not contain userinfo");
  if (!effectiveAllowlist(override).includes(u.host)) throw new SmartError(label + " host not allow-listed: " + u.host);
}
export function assertTokenEndpointAllowed(tokenEndpoint, hostAllowlist) { assertHostAllowed(tokenEndpoint, hostAllowlist, "token endpoint"); }

function extractOauthToken(cs) {
  try {
    for (const rest of cs.rest || []) {
      for (const e of (rest.security && rest.security.extension) || []) {
        if (String(e.url).endsWith("oauth-uris")) {
          for (const sub of e.extension || []) if (sub.url === "token") return sub.valueUri;
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

async function fetchDisco(fetch, fhirBase) {
  const b = fhirBase.replace(/\/$/, "");
  try { const r = await fetch(b + "/.well-known/smart-configuration"); if (r && r.ok) { const d = await r.json(); if (d.token_endpoint) return { tokenEndpoint: d.token_endpoint, scopesSupported: d.scopes_supported, algsSupported: d.token_endpoint_auth_signing_alg_values_supported, authMethods: d.token_endpoint_auth_methods_supported }; } } catch { /* fallback */ }
  try { const r = await fetch(b + "/metadata"); if (r && r.ok) { const te = extractOauthToken(await r.json()); if (te) return { tokenEndpoint: te }; } } catch { /* fail-closed below */ }
  throw new SmartError("SMART discovery failed (no smart-configuration or metadata oauth-uris)");
}

export async function discoverSmart(deps, { fhirBase, tokenEndpointHint, hostAllowlist = SMART_HOST_ALLOWLIST }) {
  const { fetch, kv } = deps;
  let fhirHost; try { fhirHost = new URL(fhirBase).host; } catch { throw new SmartError("invalid fhirBase"); }
  assertHostAllowed(fhirBase, hostAllowlist, "fhirBase");   // gate the base BEFORE any discovery fetch (no SSRF)
  const cacheKey = "connect:smart:disco:" + fhirHost;
  let disco = null, fromCache = false;
  if (tokenEndpointHint) disco = { tokenEndpoint: tokenEndpointHint };
  else {
    if (kv) { try { const c = await kv.get(cacheKey); if (c) { disco = JSON.parse(c); fromCache = true; } } catch { /* corrupt cache -> refetch */ } }
    if (!disco) disco = await fetchDisco(fetch, fhirBase);
  }
  if (!disco || !disco.tokenEndpoint) throw new SmartError("no token endpoint discovered");
  assertTokenEndpointAllowed(disco.tokenEndpoint, hostAllowlist);       // gate BEFORE returning/caching
  if (kv && !fromCache && !tokenEndpointHint) { try { await kv.put(cacheKey, JSON.stringify(disco), { expirationTtl: 3600 }); } catch { /* cache best-effort */ } }
  return { tokenEndpoint: disco.tokenEndpoint, scopesSupported: disco.scopesSupported || [], algsSupported: disco.algsSupported || [], authMethods: disco.authMethods || [] };
}
