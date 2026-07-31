// functions/_connect/abdm/gateway.js — ABDM gateway adapter (spec §1/§3, ADR-2H). Dependency-injected; Workers+Node.
export class AbdmError extends Error {}

// ── ADR-2H: THE one-file config seam. Every path here is corroborated-not-official (research WAS WAF-blocked);
//    pin to the live Postman/Swagger before real calls. Changing these should be the ONLY code change needed
//    when the real paths are confirmed.
export const ENDPOINTS = {
  sessions:     "/api/hiecm/gateway/v3/sessions",   // VERIFY: live Postman/Swagger
  consentInit:  "/consent-requests/init",            // VERIFY
  consentFetch: "/consents/fetch",                   // VERIFY
  hiRequest:    "/health-information/cm/request",    // VERIFY
  hiNotify:     "/health-information/notify",         // VERIFY
};

export function requestId() { return globalThis.crypto.randomUUID(); }

export function gatewayHeaders({ token, cmId, hiuId, hipId, now }) {
  const h = {
    authorization: "Bearer " + token,
    "X-CM-ID": cmId || "sbx",
    "REQUEST-ID": requestId(),                       // fresh per call — gateway rejects reuse
    TIMESTAMP: (now ? now() : new Date()).toISOString(),
    "content-type": "application/json",
  };
  if (hiuId) h["X-HIU-ID"] = hiuId;
  if (hipId) h["X-HIP-ID"] = hipId;
  return h;
}

export function makeGateway({ baseUrl, cmId, hiuId, hipId, fetch, kv, now, secrets }) {
  const tokKey = "connect:abdm:tok:" + (hiuId || hipId || "default");   // KV: NON-PHI token only (R16)
  const clock = now || (() => new Date());

  async function session() {
    try {
      const cached = await kv.get(tokKey);
      if (cached) { const c = JSON.parse(cached); if (c.exp > clock().getTime()) return c.token; }
    } catch { /* fall through to refresh */ }
    const clientId = await secrets.get("ABDM_CLIENT_ID");
    const clientSecret = await secrets.get("ABDM_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new AbdmError("ABDM client credentials not configured");
    let res;
    try { res = await fetch(baseUrl + ENDPOINTS.sessions, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret, grantType: "client_credentials" }) }); }
    catch (e) { throw new AbdmError("session request failed: " + e.message); }
    if (!res.ok) throw new AbdmError("session HTTP " + res.status);
    const j = await res.json();
    const token = j.accessToken; const expiresIn = Number(j.expiresIn) || 0;
    if (!token) throw new AbdmError("session returned no accessToken");
    const exp = clock().getTime() + Math.max(0, (expiresIn - 30)) * 1000;   // safety skew; runtime expiresIn (never hardcoded)
    try { await kv.put(tokKey, JSON.stringify({ token, exp })); } catch { /* cache best-effort */ }
    return token;
  }

  async function post(endpointKey, body) {
    const path = ENDPOINTS[endpointKey];
    if (!path) throw new AbdmError("unknown endpoint key: " + endpointKey);
    const token = await session();
    let res;
    try { res = await fetch(baseUrl + path, { method: "POST", headers: gatewayHeaders({ token, cmId, hiuId, hipId, now: clock }), body: JSON.stringify(body) }); }
    catch (e) { throw new AbdmError(endpointKey + " request failed: " + e.message); }
    if (res.status !== 202 && !res.ok) throw new AbdmError(endpointKey + " HTTP " + res.status);
    try { return await res.json(); } catch { return {}; }
  }

  return { session, post };
}
