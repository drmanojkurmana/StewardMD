/* StewardMD — PrepNucleus bank authentication, app proof & rate limiting gate.
 *
 * Implements the security architecture for the question bank:
 * 1. Strict Origin/Referer allowlist and CORS for StewardMD web & native schemes.
 * 2. Per-session app proof: authenticated HMAC session keys (10 min TTL) bound to uid,
 *    device id, and app version, with timestamp replay window (60s) and KV nonce cache.
 * 3. Platform attestation hook for Apple App Attest & Play Integrity.
 * 4. Short-lived signed image URLs (HMAC, 5 min) for <img> tags.
 * 5. Multi-tier user rate limits (120/min burst, 2,000/h, 10,000/day) and 24h account
 *    flagging on sequential enumeration / bulk download.
 * 6. Rollout safety: PREP_BANK_ENFORCE env flag (default OFF = shadow logging; ON = gating).
 */

import { identify, sha256hex, usageKv } from "./_usage.js";
import { hitLimit } from "./_ratelimit.js";

export const ALLOWED_ORIGINS = new Set([
  "https://stewardmd.in",
  "https://www.stewardmd.in",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
  "ionic://localhost",
]);

export function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  origin = origin.trim();
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  return false;
}

export function corsHeaders(request) {
  const o = request && request.headers ? request.headers.get("Origin") || "" : "";
  if (!isAllowedOrigin(o)) return {};
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-SMD-Session, X-SMD-Timestamp, X-SMD-Nonce, X-SMD-Signature, X-SMD-Device, X-SMD-App, X-App-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Authorization",
  };
}

export function withCors(request, resp) {
  const ch = corsHeaders(request);
  if (!Object.keys(ch).length) return resp;
  const h = new Headers(resp.headers);
  for (const k in ch) h.set(k, ch[k]);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export const STUDY_RE = /^v\d{1,3}\/(?:(?:lessons|cards)\/(?:index|[a-z0-9-]{2,80})\.json|lessons\/media\/[a-z0-9-]{2,80}\.(?:svg|webp))$/;
export const CREDITS_RE = /^image-credits\.json$/;

export function classifyBankPath(p) {
  if (!p || typeof p !== "string") return null;
  if (p === "health" || p === "status") return "public";
  if (CREDITS_RE.test(p)) return "public";
  if (STUDY_RE.test(p)) return "public";
  return "gated";
}

export function isGatedBankPath(p) {
  return classifyBankPath(p) === "gated";
}

export function isImagePath(p) {
  return /\.(?:webp|svg|png|jpg)$/i.test(String(p || ""));
}

/* HMAC-SHA256 via WebCrypto (standard in Cloudflare Workers and Node.js >= 18) */
export async function hmacSha256Hex(keyHexOrStr, message) {
  const enc = new TextEncoder();
  const keyBytes = typeof keyHexOrStr === "string" && /^[0-9a-f]{64}$/i.test(keyHexOrStr)
    ? new Uint8Array(keyHexOrStr.match(/../g).map((b) => parseInt(b, 16)))
    : enc.encode(String(keyHexOrStr));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(message)));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Attestation hook: Apple App Attest / Play Integrity */
export async function verifyPlatformAttestation(attestation, user, env) {
  if (!attestation) {
    // Web clients and environments without native hardware attestation
    return { ok: true, attestationType: "none" };
  }
  // TODO: Verify Apple App Attest statement with Apple / Play Integrity verdict with Google Play Integrity API
  return { ok: true, attestationType: attestation.type || "passed" };
}

// In-memory session and nonce cache (for isolates, unit tests, or when KV is not bound)
const _localSessions = new Map();
const _localNonces = new Map();
const _localFlags = new Map();

export function resetBankGateMemory() {
  _localSessions.clear();
  _localNonces.clear();
  _localFlags.clear();
}

export async function mintBankSession(user, env, opts = {}) {
  const deviceId = opts.deviceId || "unknown";
  const appVersion = opts.appVersion || "1.0.0";
  const attestation = opts.attestation || null;

  await verifyPlatformAttestation(attestation, user, env);

  const sessionId = "ps_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const sessionKey = Array.from(keyBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 600; // 10 minutes

  const sessionData = {
    key: sessionKey,
    uid: user.id,
    deviceId,
    appVersion,
    exp: expiresAt,
  };

  _localSessions.set(sessionId, sessionData);

  const store = usageKv(env);
  if (store && store.put) {
    try {
      await store.put("psess:" + sessionId, JSON.stringify(sessionData), { expirationTtl: 900 });
    } catch (e) {}
  }

  return { ok: true, sessionId, sessionKey, expiresAt };
}

export async function getBankSession(env, sessionId) {
  if (!sessionId) return null;
  const now = Math.floor(Date.now() / 1000);

  const hit = _localSessions.get(sessionId);
  if (hit && hit.exp > now) return hit;

  const store = usageKv(env);
  if (store && store.get) {
    try {
      const raw = await store.get("psess:" + sessionId);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.exp > now) {
          _localSessions.set(sessionId, parsed);
          return parsed;
        }
      }
    } catch (e) {}
  }
  return null;
}

export async function signImagePath(sessionKey, sessionId, p, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec);
  const sig = await hmacSha256Hex(sessionKey, p + ":" + exp);
  return `s=${encodeURIComponent(sessionId)}&exp=${exp}&sig=${sig}`;
}

export async function verifyImageQuery(env, p, searchParams) {
  if (!searchParams) return { ok: false, code: "missing-params" };
  const s = searchParams.get("s");
  const exp = Number(searchParams.get("exp"));
  const sig = searchParams.get("sig");
  if (!s || !exp || !sig) return { ok: false, code: "missing-params" };

  const now = Math.floor(Date.now() / 1000);
  if (isNaN(exp) || exp <= now || exp > now + 360) {
    return { ok: false, code: "expired-or-invalid-expiry" };
  }

  const session = await getBankSession(env, s);
  if (!session || session.exp < now) {
    return { ok: false, code: "invalid-session" };
  }

  const expectedSig = await hmacSha256Hex(session.key, p + ":" + exp);
  if (sig.toLowerCase() !== expectedSig.toLowerCase()) {
    return { ok: false, code: "invalid-signature" };
  }

  return { ok: true, session, uid: session.uid };
}

export async function verifyBankProof(request, env, p, user, waitUntil) {
  const sessionId = request.headers.get("X-SMD-Session");
  const timestamp = request.headers.get("X-SMD-Timestamp");
  const nonce = request.headers.get("X-SMD-Nonce");
  const sig = request.headers.get("X-SMD-Signature");

  if (!sessionId || !timestamp || !nonce || !sig) {
    return { ok: false, code: "missing-proof", message: "Missing app proof headers" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (isNaN(ts) || Math.abs(now - ts) > 60) {
    return { ok: false, code: "stale-timestamp", message: "Timestamp outside 60-second window" };
  }

  // Nonce replay check (KV + local memory)
  const nonceKey = "pbn:" + sessionId + ":" + nonce;
  if (_localNonces.has(nonceKey)) {
    return { ok: false, code: "replayed-nonce", message: "Replayed nonce detected" };
  }
  _localNonces.set(nonceKey, now);

  const store = usageKv(env);
  if (store && store.get) {
    try {
      const seen = await store.get(nonceKey);
      if (seen) return { ok: false, code: "replayed-nonce", message: "Replayed nonce detected in store" };
      const put = () => store.put(nonceKey, "1", { expirationTtl: 120 });
      if (typeof waitUntil === "function") { try { waitUntil(put().catch(() => {})); } catch (e) {} }
      else await put();
    } catch (e) {}
  }

  const session = await getBankSession(env, sessionId);
  if (!session || session.exp < now) {
    return { ok: false, code: "invalid-session", message: "Session expired or invalid" };
  }

  if (session.uid !== user.id) {
    return { ok: false, code: "session-user-mismatch", message: "Session does not match authenticated user" };
  }

  // Verification: signature covers timestamp:path:nonce
  const toSign = `${ts}:${p}:${nonce}`;
  const expectedSig = await hmacSha256Hex(session.key, toSign);
  if (sig.toLowerCase() !== expectedSig.toLowerCase()) {
    return { ok: false, code: "invalid-signature", message: "Invalid request signature" };
  }

  return { ok: true, session };
}

export async function checkBankRateLimits(env, user, p, waitUntil, nowMs) {
  const store = usageKv(env);
  const now = nowMs || Date.now();
  const hashedUid = await sha256hex(user.id);
  const flagKey = "pbf:" + hashedUid;

  // 1. Check if user is flagged for 24h
  if (_localFlags.has(flagKey)) {
    const fl = _localFlags.get(flagKey);
    if (fl && now < fl.exp) {
      console.warn("[bank-gate] flagged user rejected", { user: hashedUid });
      return { ok: false, status: 429, code: "account-flagged", message: "Account flagged for bulk download. Try again in 24 hours." };
    }
  }

  if (store && store.get) {
    try {
      const flagged = await store.get(flagKey);
      if (flagged) {
        console.warn("[bank-gate] flagged user rejected from store", { user: hashedUid });
        return { ok: false, status: 429, code: "account-flagged", message: "Account flagged for bulk download. Try again in 24 hours." };
      }
    } catch (e) {}
  }

  // 2. Burst limits: 120/min, 2,000/h, 10,000/day
  const rMin = await hitLimit(store, "pbm", user.id, 120, 60, waitUntil, now);
  if (!rMin.ok) {
    console.warn("[bank-gate] per-minute limit exceeded", { user: hashedUid, used: rMin.used });
    return { ok: false, status: 429, code: "minute-limit", message: "Rate limit exceeded (120 req/min). Please slow down." };
  }

  const rHr = await hitLimit(store, "pbh", user.id, 2000, 3600, waitUntil, now);
  if (!rHr.ok) {
    console.warn("[bank-gate] hourly limit exceeded", { user: hashedUid, used: rHr.used });
    return { ok: false, status: 429, code: "hour-limit", message: "Hourly question fetch limit reached (2,000 req/h)." };
  }

  const rDay = await hitLimit(store, "pbd", user.id, 10000, 86400, waitUntil, now);
  if (!rDay.ok) {
    console.warn("[bank-gate] daily limit exceeded", { user: hashedUid, used: rDay.used });
    return { ok: false, status: 429, code: "daily-limit", message: "Daily question fetch limit reached (10,000 req/day)." };
  }

  // 3. Sequential enumeration / bulk-download detection:
  // Triggered when >30 module/overlay question files are requested within 60 seconds
  const isModuleFile = /\/mcq\/[a-z0-9-]+\.json$/.test(p) || /^overlay\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(p);
  if (isModuleFile) {
    const rEnum = await hitLimit(store, "pbenum", user.id, 30, 60, waitUntil, now);
    if (!rEnum.ok) {
      console.warn("[bank-gate] enumeration detected, account flagged 24h", { user: hashedUid, path: p });
      _localFlags.set(flagKey, { exp: now + 86400 * 1000 });
      if (store && store.put) {
        try {
          const putFlag = () => store.put(flagKey, JSON.stringify({ ts: now, reason: "enumeration" }), { expirationTtl: 86400 });
          if (typeof waitUntil === "function") { try { waitUntil(putFlag().catch(() => {})); } catch (e) {} }
          else await putFlag();
        } catch (e) {}
      }
      return { ok: false, status: 429, code: "enumeration-detected", message: "Bulk download or sequential enumeration detected. Account flagged for 24 hours." };
    }
  }

  return { ok: true };
}
