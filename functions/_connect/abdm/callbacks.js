// functions/_connect/abdm/callbacks.js — the ABDM V3 callback receiver (M2 + M3 transport).
//
// WHY THIS EXISTS: the original ingress.js exposed ONE endpoint that expected a signed-JWS body and
// dispatched on an internal `type` field. That is not how the gateway behaves. ABDM POSTs PLAIN JSON to
// roughly a dozen DISTINCT paths under our registered callback base, authenticated with a bearer token,
// carrying REQUEST-ID / TIMESTAMP / X-HIP-ID (or X-HIU-ID) headers. See
// docs/connect/abdm/V3-SPEC-RECONCILIATION.md D3.
//
// TIMING IS PART OF THE CONTRACT: `on-notify` must reach ABDM within 60 SECONDS of `/hip/notify`, or no
// health-information request ever follows (FAQ Q36). So every handler here ACKNOWLEDGES IMMEDIATELY and
// the real work is handed to the platform's waitUntil. Never put a queue or a slow read in front of the
// acknowledgement.
//
// SECURITY: the bearer token is verified against ABDM's pinned JWKS (GET /api/hiecm/gateway/v3/certs)
// with the asymmetric-only, kid-selected verifier in jws.js, so alg-confusion and HS-forgery are
// structurally impossible. REQUEST-ID doubles as a replay nonce.

import { verifyJws, getPinnedJwks, JwsError } from "./jws.js";
import { abdmConfig } from "./config.js";

export class CallbackError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

// ── The route table. Paths are relative to the registered callback base. ────────────────────────────
// `role` says which id header ABDM stamps, and therefore which of our two identities is being addressed.
export const HIP_ROUTES = {
  "/api/v3/hip/token/on-generate-token":        { kind: "link-token-result",    role: "hip" },
  "/api/v3/hip/patient/care-context/discover":  { kind: "discover",             role: "hip" },
  "/api/v3/hip/link/care-context/init":         { kind: "link-init",            role: "hip" },
  "/api/v3/hip/link/care-context/confirm":      { kind: "link-confirm",         role: "hip" },
  "/api/v3/link/on_carecontext":                { kind: "link-result",          role: "hip" },
  "/api/v3/links/context/on-notify":            { kind: "context-notify-ack",   role: "hip" },
  "/api/v3/patients/sms/on-notify":             { kind: "sms-notify-ack",       role: "hip" },
  "/api/v3/consent/request/hip/notify":         { kind: "consent-notify",       role: "hip" },
  "/api/v3/hip/health-information/request":     { kind: "hi-request",           role: "hip" },
  "/api/v3/hip/patient/share":                  { kind: "patient-share",        role: "hip" },
};

export const HIU_ROUTES = {
  "/api/v3/hiu/consent/request/on-init":        { kind: "consent-on-init",      role: "hiu" },
  "/api/v3/hiu/consent/request/on-status":      { kind: "consent-on-status",    role: "hiu" },
  "/api/v3/hiu/consent/request/notify":         { kind: "consent-hiu-notify",   role: "hiu" },
  "/api/v3/hiu/consent/on-fetch":               { kind: "consent-on-fetch",     role: "hiu" },
  "/api/v3/hiu/health-information/on-request":  { kind: "hi-on-request",        role: "hiu" },
  "/api/v3/hiu/patient/on-share":               { kind: "patient-on-share",     role: "hiu" },
};

export const ROUTES = Object.freeze({ ...HIP_ROUTES, ...HIU_ROUTES });

/** Resolve a request path to a route, tolerating a trailing slash and a query string. */
export function routeFor(pathname) {
  const clean = String(pathname || "").split("?")[0].replace(/\/+$/, "") || "/";
  return ROUTES[clean] || null;
}

// ── Replay protection ───────────────────────────────────────────────────────────────────────────────
const NONCE_PREFIX = "connect:abdm:cbnonce:";
const NONCE_TTL_SEC = 900;   // 15 min: comfortably beyond any legitimate retry window

/**
 * True when this REQUEST-ID has been seen before. The nonce is a gateway-generated UUID and carries no
 * patient data, so it is safe in KV under the no-PHI residency rule.
 */
export async function seenBefore(kv, requestId) {
  if (!kv || !requestId) return false;
  const key = NONCE_PREFIX + requestId;
  try {
    if (await kv.get(key)) return true;
    await kv.put(key, "1", { expirationTtl: NONCE_TTL_SEC });
  } catch { /* a KV failure must not block a legitimate callback */ }
  return false;
}

// ── Header + token validation ───────────────────────────────────────────────────────────────────────
const MAX_SKEW_MS = 10 * 60 * 1000;   // 10 min either way

/** Pull and check the mandatory headers. Throws CallbackError(400) when any is missing or malformed. */
export function readHeaders(request, role, now) {
  const get = (n) => (request.headers && typeof request.headers.get === "function" ? request.headers.get(n) : null);
  const requestId = get("REQUEST-ID");
  const timestamp = get("TIMESTAMP");
  const entityId = get(role === "hiu" ? "X-HIU-ID" : "X-HIP-ID");
  if (!requestId) throw new CallbackError("REQUEST-ID header is required");
  if (!timestamp) throw new CallbackError("TIMESTAMP header is required");
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) throw new CallbackError("TIMESTAMP is not a parseable ISO instant");
  const nowMs = typeof now === "function" ? Date.parse(now()) : Date.now();
  if (Number.isFinite(nowMs) && Math.abs(nowMs - t) > MAX_SKEW_MS) throw new CallbackError("TIMESTAMP outside the accepted skew");
  return { requestId, timestamp, entityId: entityId || "" };
}

/**
 * Verify the inbound bearer. Fail-closed: no token, no JWKS, a bad signature, a wrong issuer or an
 * expired token all refuse. `iss` is checked against the gateway realm for this environment.
 */
export async function verifyBearer(env, deps, request) {
  const auth = request.headers && typeof request.headers.get === "function" ? request.headers.get("authorization") : null;
  const token = /^Bearer\s+(.+)$/i.exec(String(auth || ""));
  if (!token) throw new CallbackError("bearer token required", 401);
  let jwks;
  try { jwks = await getPinnedJwks(env, { fetch: deps.fetch, kv: deps.kv }); }
  catch (e) { throw new CallbackError("cannot verify callback: " + (e && e.message), 503); }
  const res = await verifyJws(token[1].trim(), { jwks, allowedAlgs: ["RS256", "RS512"] });
  if (!res || !res.ok) throw new CallbackError("bearer rejected: " + ((res && res.reason) || "unverified"), 401);
  const claims = res.payload || {};
  const nowSec = Math.floor((typeof deps.now === "function" ? Date.parse(deps.now()) : Date.now()) / 1000);
  if (Number.isFinite(claims.exp) && claims.exp < nowSec) throw new CallbackError("bearer expired", 401);
  const expectedIss = expectedIssuer(env);
  if (expectedIss && claims.iss && claims.iss !== expectedIss) throw new CallbackError("bearer issuer not accepted", 401);
  return claims;
}

/**
 * The gateway realm that mints callback bearers. Confirmed live 2026-08-18 for sandbox:
 * https://dev.abdm.gov.in/auth/realms/cent. Overridable because the realm path is ABDM's to change.
 */
export function expectedIssuer(env) {
  if (env && env.ABDM_TOKEN_ISSUER) return String(env.ABDM_TOKEN_ISSUER);
  const cfg = abdmConfig(env);
  return cfg.gatewayBase + "/auth/realms/cent";
}

// ── The receiver ────────────────────────────────────────────────────────────────────────────────────
const ACK = (body, status) => new Response(JSON.stringify(body ?? { ok: true }), {
  status: status || 202,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

/**
 * Handle one ABDM callback.
 *
 * @param deps.handlers  { [kind]: async ({ env, deps, body, headers, claims, route }) => void }
 *                       Handlers run AFTER the acknowledgement, via deps.waitUntil. A throwing handler
 *                       can no longer change the response - it must record its own failure.
 * @param deps.waitUntil optional; when absent the work is awaited before responding (tests, Node).
 */
export async function handleCallback(env, deps, request) {
  const url = new URL(request.url);
  const base = String((env && env.ABDM_CALLBACK_PATH_PREFIX) || "");
  const path = base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
  const route = routeFor(path);
  if (!route) return ACK({ error: "unknown_callback" }, 404);
  if (request.method !== "POST") return ACK({ error: "method_not_allowed" }, 405);

  let headers, claims;
  try {
    headers = readHeaders(request, route.role, deps.now);
    claims = await verifyBearer(env, deps, request);
  } catch (e) {
    const status = e instanceof CallbackError ? e.status : 400;
    return ACK({ error: "rejected", reason: e && e.message }, status);
  }

  // Replay: acknowledge (so ABDM stops retrying) but do no work twice.
  if (await seenBefore(deps.kv, headers.requestId)) return ACK({ ok: true, duplicate: true });

  let body;
  try { body = await request.json(); }
  catch { return ACK({ error: "rejected", reason: "body is not JSON" }, 400); }

  const handler = deps.handlers && deps.handlers[route.kind];
  if (typeof handler !== "function") {
    // Unimplemented kinds acknowledge rather than 5xx: a retry storm helps nobody, and the gateway
    // treats a non-2xx as a delivery failure. The gap is visible in the audit trail instead.
    if (typeof deps.onUnhandled === "function") { try { deps.onUnhandled({ route, headers }); } catch { /* ignore */ } }
    return ACK({ ok: true, handled: false });
  }

  const work = Promise.resolve()
    .then(() => handler({ env, deps, body, headers, claims, route }))
    .catch((e) => { if (typeof deps.onError === "function") { try { deps.onError(e, { route, headers }); } catch { /* ignore */ } } });

  if (typeof deps.waitUntil === "function") deps.waitUntil(work);
  else await work;                                   // deterministic in tests

  return ACK({ ok: true });
}
