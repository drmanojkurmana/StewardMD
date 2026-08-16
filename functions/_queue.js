/* functions/_queue.js — Smart OPD Queue foundations (Phase 0).
 *
 * Dependency-free on purpose: the security-critical link-token mint/verify is self-contained WebCrypto so
 * it unit-tests in isolation and does not drag in FollowCare's 8-module tree. The token FORMAT deliberately
 * mirrors functions/_followcare.js — base64url(id.exp) . base64url(HMAC-SHA256 over id.exp.ver) — so a queue
 * ticket link is the same proven, PHI-free, revocable-by-ver shape and MAY share the same secret. PHI
 * encryption (encPHI/decPHI) is reused from _followcare.js at runtime by the engine (Phase 1), not here.
 * ponytail: ~15 lines of standard HMAC duplicated rather than importing an 8-dependency module for them.
 *
 * Flag/config: feature is OFF unless env QUEUE_ENABLED === "1" (default OFF — not built for prod yet).
 * Secret: QUEUE_TOKEN_SECRET, falling back to FOLLOWCARE_TOKEN_SECRET (both >=32 chars). PHI key reused.
 */

const enc = new TextEncoder(), dec = new TextDecoder();
function b64u(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(str) { let s = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function hmacKey(secret) { return crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }

// Sign a link token. payload = { id, exp(ms), ver }. ver = ticket's tokenVer (bump to revoke). No PHI.
export async function signToken(payload, secret) {
  const body = payload.id + "." + payload.exp;
  const k = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body + "." + payload.ver)));
  return b64u(enc.encode(body)) + "." + b64u(sig);
}
// Structural id parse WITHOUT verifying — used only to load the ticket (and its current ver) before the
// authoritative signed verify. Never grants access by itself.
export function idFromToken(token) {
  try {
    const body = dec.decode(unb64u(String(token).split(".")[0]));
    const i = body.lastIndexOf(".");
    const id = i > 0 ? body.slice(0, i) : "";
    // Guard the trust boundary: the id is later concatenated into a Firestore doc path on a
    // service-account request (which bypasses security rules), so a crafted "../" id would be a
    // path-traversal. Legit ids are UUIDs, "orgId~identity" staff ids, or usernames (may contain a
    // single "."). Allow those chars, block the traversal primitives ("/", "\", "..").
    return (/^[A-Za-z0-9_.~:-]{1,128}$/.test(id) && id.indexOf("..") === -1) ? id : "";
  } catch (e) { return ""; }
}
// Verify + parse against the CURRENT ver + expiry. Returns { ok, id, reason }. Never throws.
export async function verifyToken(token, secret, curVer, nowMs) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed" };
    const body = dec.decode(unb64u(parts[0]));
    const bi = body.lastIndexOf(".");
    const id = body.slice(0, bi), exp = Number(body.slice(bi + 1));
    if (!id || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
    const k = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", k, unb64u(parts[1]), enc.encode(body + "." + curVer));
    if (!ok) return { ok: false, reason: "bad_signature" };          // wrong secret OR revoked (ver bumped)
    if (typeof nowMs === "number" && exp < nowMs) return { ok: false, reason: "expired", id };
    return { ok: true, id };
  } catch (e) { return { ok: false, reason: "malformed" }; }
}

// ---- config / flag ------------------------------------------------------------------------
export function queueEnabled(env) { return String(env && env.QUEUE_ENABLED) === "1"; }   // default OFF
function secretOf(env) { return env && (env.QUEUE_TOKEN_SECRET || env.FOLLOWCARE_TOKEN_SECRET); }
export function queueSecret(env) {
  const s = secretOf(env);
  if (!s || String(s).length < 32) throw Object.assign(new Error("queue_secret_missing"), { code: "config", status: 500 });
  return s;
}
// Both secrets present (token + the reused PHI key). When false the feature degrades to a clean
// "being set up" state (no 500s) so the flag can be ON before provisioning.
export function isQueueConfigured(env) {
  const s = secretOf(env);
  return !!(s && String(s).length >= 32 && env && env.FOLLOWCARE_PHI_KEY);
}

// ---- ticket link token wrappers ----------------------------------------------------------
export function mintTicketToken(env, ticketId, expMs, ver) { return signToken({ id: ticketId, exp: expMs, ver: ver || 1 }, queueSecret(env)); }
export function verifyTicketToken(env, token, curVer) { return verifyToken(token, queueSecret(env), curVer, Date.now()); }
export const ticketIdFromToken = idFromToken;

// ---- wall-display link token: org-scoped, read-only, login-free (a waiting-room screen) ----------
// Same signed opaque format as the ticket token but keyed to an org, not a ticket. 90-day default;
// regenerate to rotate. verify is async — callers MUST await it.
export function mintDisplayToken(env, orgId, expMs) { return signToken({ id: "disp:" + orgId, exp: expMs, ver: 1 }, queueSecret(env)); }
export async function verifyDisplayToken(env, token) {
  const id = idFromToken(token);
  if (!id || id.indexOf("disp:") !== 0) return null;
  const v = await verifyToken(token, queueSecret(env), 1, Date.now());
  return v && v.ok ? id.slice(5) : null;
}

// ---- PHI at rest (AES-256-GCM), reusing the app's FOLLOWCARE_PHI_KEY. blob = base64url(iv[12]||ct).
// Self-contained (same reason as the token) so the queue runtime path stays lean and unit-testable.
async function phiKey(env) {
  const raw = env && env.FOLLOWCARE_PHI_KEY;
  if (!raw) throw Object.assign(new Error("phi_key_missing"), { code: "config", status: 500 });
  const bytes = unb64u(raw);
  if (bytes.length !== 32) throw Object.assign(new Error("phi_key_bad_length"), { code: "config", status: 500 });
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encPHI(env, plaintext) {
  if (plaintext == null || plaintext === "") return "";
  const key = await phiKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext))));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv, 0); out.set(ct, iv.length);
  return b64u(out);
}
export async function decPHI(env, blob) {
  if (!blob) return "";
  const key = await phiKey(env);
  const all = unb64u(blob), iv = all.slice(0, 12), ct = all.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}

// ---- Firestore collections (service-account writes; deny-all client rules) ----------------
export const Q_COLL = { sessions: "q_sessions", tickets: "q_tickets", events: "q_events", config: "q_config", stats: "q_stats" };
