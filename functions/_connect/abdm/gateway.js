// functions/_connect/abdm/gateway.js — ABDM gateway adapter (spec §1/§3, ADR-2H). Dependency-injected; Workers+Node.
import { guardedKvPut } from "./no-phi.js"; // R16: the token cache is NON-PHI — this guard keeps it that way, fail-closed.
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

// ADR-2H field-name seam — VERIFY against live Postman/Swagger (OAuth2 is often snake_case; ABDM V1↔V3 differs).
export const FIELDS = {
  reqClientId:     "clientId",           // VERIFY session request body keys
  reqClientSecret: "clientSecret",       // VERIFY
  reqGrantType:    "grantType",          // VERIFY
  grantTypeValue:  "client_credentials", // VERIFY
  resAccessToken:  "accessToken",        // VERIFY session response keys (may be "access_token")
  resExpiresIn:    "expiresIn",          // VERIFY (may be "expires_in")
};

export function requestId() { return globalThis.crypto.randomUUID(); }

export function gatewayHeaders({ token, cmId, hiuId, hipId, now }) {
  const h = {
    authorization: "Bearer " + token,                // VERIFY: header name
    "X-CM-ID": cmId || "sbx",                         // VERIFY: header name
    "REQUEST-ID": requestId(),                        // VERIFY: header name — fresh per call, gateway rejects reuse
    TIMESTAMP: (now ? now() : new Date()).toISOString(), // VERIFY: header name
    "content-type": "application/json",              // VERIFY: header name
  };
  if (hiuId) h["X-HIU-ID"] = hiuId;                  // VERIFY: header name
  if (hipId) h["X-HIP-ID"] = hipId;                  // VERIFY: header name
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
      body: JSON.stringify({ [FIELDS.reqClientId]: clientId, [FIELDS.reqClientSecret]: clientSecret, [FIELDS.reqGrantType]: FIELDS.grantTypeValue }) }); }
    catch (e) { throw new AbdmError("session request failed: " + e.message); }
    if (!res.ok) throw new AbdmError("session HTTP " + res.status);
    let j; try { j = await res.json(); } catch { throw new AbdmError("session returned invalid JSON"); }
    const token = j[FIELDS.resAccessToken];
    if (!token) throw new AbdmError("session returned no accessToken");
    const ttlSec = Math.min(Math.max(0, (Number(j[FIELDS.resExpiresIn]) || 0) - 30), 3600);  // 30s skew, cap at 1h (anti-wedge)
    const exp = clock().getTime() + ttlSec * 1000;
    if (ttlSec >= 60) {                       // only cache a usefully-long token; KV min TTL is 60s
      try { await guardedKvPut(kv, tokKey, JSON.stringify({ token, exp }), { expirationTtl: ttlSec }); } catch { /* best-effort */ }
    }
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
    let parsed; try { parsed = await res.json(); } catch { parsed = {}; }
    return { status: res.status, body: parsed };   // Stage-4: distinguish 202-accept from 200-inline, log status
  }

  return { session, post };
}
