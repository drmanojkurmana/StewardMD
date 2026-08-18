// functions/_connect/abdm/gateway.js — ABDM gateway adapter (spec §1/§3, ADR-2H). Dependency-injected; Workers+Node.
import { guardedKvPut } from "./no-phi.js"; // R16: the token cache is NON-PHI — this guard keeps it that way, fail-closed.
export class AbdmError extends Error {}

// ── ADR-2H: THE one-file config seam. PINNED 2026-08-18 against the official V3 swaggers + the
//    16-02-2026 M2/M3 Postman collections, and live-verified against the sandbox with our own bridge
//    credentials. See docs/connect/abdm/V3-SPEC-RECONCILIATION.md.
//    baseUrl is the HOST ONLY (sandbox https://dev.abdm.gov.in, prod https://apis.abdm.gov.in); every
//    path below is absolute from the host root and includes the /api prefix, matching the collections.
export const ENDPOINTS = {
  sessions:     "/api/hiecm/gateway/v3/sessions",                          // live-verified 200
  consentInit:  "/api/hiecm/consent/v3/request/init",                      // pinned (was /consent-requests/init)
  consentFetch: "/api/hiecm/consent/v3/fetch",                             // pinned (was /consents/fetch)
  hiRequest:    "/api/hiecm/data-flow/v3/health-information/request",      // pinned (was /health-information/cm/request)
  hiNotify:     "/api/hiecm/data-flow/v3/health-information/notify",       // pinned (was /health-information/notify)
  bridgeUrl:      "/api/hiecm/gateway/v3/bridge/url",                      // PATCH {url} - register callback BASE url only
  bridgeServices: "/api/hiecm/gateway/v3/bridge-services",                 // GET - live-verified 200
  certs:          "/api/hiecm/gateway/v3/certs",
};

// Session request/response field names - CONFIRMED against the live sandbox response.
export const FIELDS = {
  reqClientId:     "clientId",
  reqClientSecret: "clientSecret",
  reqGrantType:    "grantType",
  grantTypeValue:  "client_credentials",
  resAccessToken:  "accessToken",
  resExpiresIn:    "expiresIn",          // confirmed present (seconds; sandbox returns 1200)
};

export function requestId() { return globalThis.crypto.randomUUID(); }

// Header names PINNED + live-verified 2026-08-18. X-CM-ID is "sbx" in sandbox, "abdm" in production.
export function gatewayHeaders({ token, cmId, hiuId, hipId, now }) {
  const h = {
    authorization: "Bearer " + token,
    "X-CM-ID": cmId || "sbx",
    "REQUEST-ID": requestId(),                        // fresh UUID per call - the gateway rejects reuse
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
    // REQUEST-ID / TIMESTAMP / X-CM-ID are REQUIRED on /sessions too, even though it carries no bearer.
    // Live-verified 2026-08-18: with them the sandbox returns 200; without them it returns 401.
    const sessHeaders = {
      "content-type": "application/json",
      "REQUEST-ID": requestId(),
      TIMESTAMP: clock().toISOString(),
      "X-CM-ID": cmId || "sbx",
    };
    try { res = await fetch(baseUrl + ENDPOINTS.sessions, { method: "POST", headers: sessHeaders,
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
