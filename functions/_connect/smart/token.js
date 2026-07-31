// functions/_connect/smart/token.js — SMART Backend Services token acquisition (DUAL-ADVERSARIAL).
// discover (SSRF-gated) -> envelope-decrypt the private key in memory -> sign (aud === token endpoint) ->
// RE-ASSERT the endpoint is allow-listed -> POST client_credentials -> intersect scope (never widen) ->
// envelope-seal the NON-PHI token, tenant+connector-scoped, TTL-with-skew. Fail-closed everywhere. The
// private key / assertion / access token live only in request-scoped vars; never logged/URL'd/KV-plaintext.
import { discoverSmart, assertTokenEndpointAllowed } from "./discovery.js";
import { signClientAssertion } from "./assertion.js";
export class TokenError extends Error {}

const parseScope = (s) => String(s || "").split(/\s+/).filter(Boolean);

export async function acquireAccessToken(deps, { config, requestedScopes, forceRefresh }) {
  const { fetch, kv, secrets, envelope, now, logger, tenantId, connectorId } = deps;
  const nowMs = () => (typeof now === "function" ? now() : Date.now());
  const fhirBase = config.base_url;
  let hints = {}; try { hints = (JSON.parse(config.config || "{}").smart) || {}; } catch { hints = {}; }
  const cacheKey = "connect:smart:tok:" + tenantId + ":" + connectorId;
  const reqScopes = Array.isArray(requestedScopes) ? requestedScopes : parseScope(requestedScopes);

  // 2. cache read (envelope-decrypt; corrupt/expired -> miss)
  if (!forceRefresh && kv && envelope) {
    try { const ct = await kv.get(cacheKey); if (ct) { const t = JSON.parse(await envelope.open(ct)); if (t && t.exp > nowMs()) return { accessToken: t.token, expiresIn: Math.max(0, Math.round((t.exp - nowMs()) / 1000)), grantedScopes: t.scope || [], tokenEndpoint: t.te }; } } catch { /* miss */ }
  }
  // 3. discover (SSRF-gated) -> a validated token endpoint
  const { tokenEndpoint } = await discoverSmart({ fetch, kv, now, logger }, { fhirBase, tokenEndpointHint: hints.tokenEndpointHint, hostAllowlist: hints.authHostAllowlist });
  // 4. secrets: envelope-decrypted SMART client key material (fail-closed if absent)
  const sec = await secrets("smart");
  if (!sec || !sec.clientId || !sec.privateKeyJwk || !sec.kid || !sec.alg) throw new TokenError("SMART client key material unavailable");
  // 5. sign — aud bound to the exact validated endpoint
  const assertion = await signClientAssertion({ now, logger }, { clientId: sec.clientId, tokenEndpoint, privateKeyJwk: sec.privateKeyJwk, kid: sec.kid, alg: sec.alg });
  // 6. re-assert the endpoint, then POST
  assertTokenEndpointAllowed(tokenEndpoint, hints.authHostAllowlist);
  const body = "grant_type=client_credentials&scope=" + encodeURIComponent(reqScopes.join(" ")) +
    "&client_assertion_type=" + encodeURIComponent("urn:ietf:params:oauth:client-assertion-type:jwt-bearer") +
    "&client_assertion=" + encodeURIComponent(assertion);   // // VERIFY v1/v2 scope syntax + form field names
  let res; try { res = await fetch(tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); } catch { throw new TokenError("token request failed"); }
  if (!res || !res.ok) throw new TokenError("token endpoint non-2xx");
  let data; try { data = await res.json(); } catch { throw new TokenError("bad token response"); }
  if (!data.access_token) throw new TokenError("no access_token in response");
  // 7. scope intersect — never widen beyond what we requested
  const reqSet = new Set(reqScopes);
  const grantedScopes = parseScope(data.scope).filter((s) => reqSet.has(s));
  const expiresIn = Number(data.expires_in) || 0;
  // 8. cache the NON-PHI token, envelope-sealed, TTL-with-skew, tenant+connector-scoped
  const ttl = Math.min(Math.max(0, expiresIn - 30), 3600);
  if (kv && envelope && ttl >= 60) { try { await kv.put(cacheKey, await envelope.seal(JSON.stringify({ token: data.access_token, exp: nowMs() + ttl * 1000, scope: grantedScopes, te: tokenEndpoint })), { expirationTtl: ttl }); } catch { /* cache best-effort */ } }
  return { accessToken: data.access_token, expiresIn, grantedScopes, tokenEndpoint };
}
