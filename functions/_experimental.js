/* StewardMD — Experimental Access framework (server-authoritative).
 *
 * A reusable one-code / one-device unlock system for beta features. FundX AI is the first
 * consumer; adding ECG AI / Ultrasound AI / Clinical Copilot is a single FEATURES entry — the
 * admin dropdown and the client list are registry-driven, nothing else changes.
 *
 * Security model (mirrors _entitlement.js: the server is the source of truth, a client flag is
 * NEVER trusted):
 *   • Codes are cryptographically random (crypto.getRandomValues, ambiguity-free alphabet).
 *   • Firestore stores ONLY sha256(pepper + normalizedCode) — the doc id IS that hash, so
 *     validation is one O(1) get and a DB dump reveals no codes (high entropy + secret pepper).
 *   • Activation is EXACTLY-ONCE: an atomic commit updates the code (guarded on its updateTime)
 *     and creates the activation record in one all-or-nothing write. Concurrent attempts → one
 *     wins, the rest get "already used".
 *   • Activation binds { uid, deviceId, platform }. The code dies instantly (status→activated);
 *     any other device/account is rejected. Same device re-entering the same code is idempotent.
 *   • The client keeps ONLY a signed HMAC activation token, never the code. Startup re-verifies
 *     against the live record → revoked/expired disables the feature immediately.
 *   • Admin "deactivate device" revokes the activation AND marks the code revoked (it stays
 *     consumed — never reusable); the tester is simply issued a fresh code for the new device.
 *
 * Pure helpers (makeCode / normalizeCode / hashCode / signToken / verifyToken / decideActivation /
 * effectiveStatus) are exported and unit-tested; the I/O functions compose them over Firestore and
 * accept an optional `deps` (fsGet/fsCommit/fsQuery) so the whole state machine is testable offline.
 */
import * as FS from "./_fbfirestore.js";
import { getEntitlement, effectiveTier, entitlementsOn } from "./_entitlements.js";

// ---- feature registry (add a line to unlock a new beta feature) ------------------------
export const FEATURES = {
  fundx: { id: "fundx", label: "FundX AI", prefix: "FUNDX", blurb: "AI-guided retinal imaging" },
  kardiox: { id: "kardiox", label: "KardioX AI", prefix: "KARDX", blurb: "AI ECG interpretation" },
  thorex: { id: "thorex", label: "ThoreX AI", prefix: "THORX", blurb: "AI chest X-ray interpretation" },
  // ecg:      { id: "ecg",      label: "ECG AI",          prefix: "ECG",   blurb: "12-lead ECG interpretation" },
  // ultrasound:{ id: "ultrasound", label: "Ultrasound AI", prefix: "USG",   blurb: "POCUS assistance" },
  // copilot:  { id: "copilot",  label: "Clinical Copilot", prefix: "COPILOT", blurb: "Bedside reasoning copilot" },
};
export function isFeature(f) { return Object.prototype.hasOwnProperty.call(FEATURES, f); }
export function featureList() { return Object.keys(FEATURES).map((k) => ({ id: k, label: FEATURES[k].label, blurb: FEATURES[k].blurb || "" })); }
// Closes the tier set to exactly v1|v2beta — any unrecognized/missing value normalizes to v1.
export function normalizeTier(t) { return t === "v2beta" ? "v2beta" : "v1"; }

const CODES = "experimentalCodes";
const ACTS = "experimentalActivations";
// Ambiguity-free alphabet: no I O L (letters) or 0 1 (digits). 31 symbols.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 2, CODE_LEN = 4;   // PREFIX-XXXX-XXXX

// ---- small crypto / encoding utils -----------------------------------------------------
function randBytes(n) { const u = new Uint8Array(n); (globalThis.crypto || crypto).getRandomValues(u); return u; }
function b64urlFromBytes(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlFromStr(str) { return b64urlFromBytes(new TextEncoder().encode(str)); }
function b64urlToBytes(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function b64urlToStr(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function timingSafeEqualStr(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---- pure: code generation, normalization, hashing -------------------------------------
// Cryptographically random code, e.g. "FUNDX-8QK4-XM92". Rejection sampling removes modulo bias.
export function makeCode(prefix, rnd) {
  rnd = rnd || randBytes;
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;   // 248 for a 31-char alphabet
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let s = "";
    while (s.length < CODE_LEN) {
      const bytes = rnd(CODE_LEN * 2);
      for (let i = 0; i < bytes.length && s.length < CODE_LEN; i++) if (bytes[i] < max) s += ALPHABET[bytes[i] % ALPHABET.length];
    }
    groups.push(s);
  }
  return String(prefix || "").toUpperCase() + "-" + groups.join("-");
}
// Canonical form for hashing: uppercase, strip everything but A-Z/2-9 (so hyphens, spaces and
// case never matter to the user). The feature prefix is part of the canonical string.
export function normalizeCode(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
export async function hashCode(code, pepper) {
  const data = new TextEncoder().encode(String(pepper || "") + ":" + normalizeCode(code));
  return hex(await crypto.subtle.digest("SHA-256", data));
}

// ---- pure: activation token (HMAC-SHA256) ----------------------------------------------
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(msg))));
}
// payload → "<b64url(json)>.<b64url(hmac)>" — the ONLY thing stored on the device.
export async function signToken(payload, secret) {
  const body = b64urlFromStr(JSON.stringify(payload));
  return body + "." + b64urlFromBytes(await hmac(secret, body));
}
export async function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = b64urlFromBytes(await hmac(secret, parts[0]));
  if (!timingSafeEqualStr(parts[1], expected)) return null;
  try { return JSON.parse(b64urlToStr(parts[0])); } catch (e) { return null; }
}
// Pure readback: pulls just the tier claim out of a signed token, reusing verifyToken (no second
// HMAC implementation). Any failure (bad signature, missing claim, malformed token) reads as "v1".
export async function readTokenTier(token, secret) {
  try {
    const payload = await verifyToken(token, secret);
    return normalizeTier(payload && payload.t);
  } catch (e) { return "v1"; }
}

// ---- pure: status + activation decision (the security state machine) -------------------
// Effective status of a code doc — an unused code past its expiry reads as "expired".
export function effectiveStatus(codeFields, now) {
  if (!codeFields) return "missing";
  const st = codeFields.status;
  if (st === "unused") return (codeFields.expiry && now > +codeFields.expiry) ? "expired" : "unused";
  return st || "missing";
}
// Given the current code doc, decide what activate() should do. NO I/O — this is the single-use +
// device-binding + idempotency logic, unit-tested exhaustively.
export function decideActivation(codeFields, req, now) {
  if (!codeFields) return { action: "reject", error: "invalid" };
  if (codeFields.feature !== req.feature) return { action: "reject", error: "invalid" };
  const st = effectiveStatus(codeFields, now);
  if (st === "expired") return { action: "reject", error: "expired" };
  if (st === "revoked") return { action: "reject", error: "invalid" };
  if (st === "activated") {
    // Same account + same device re-entering the same code → idempotent success (re-issue token).
    if (codeFields.activatedByUID === req.uid && codeFields.activatedDeviceId === req.deviceId) return { action: "reissue" };
    return { action: "reject", error: "already_used" };
  }
  return { action: "activate" };   // st === "unused"
}
// Map an internal error code to the exact user-facing message the spec mandates.
export function messageFor(error) {
  if (error === "already_used") return "This code has already been used.";
  if (error === "signin_required") return "Sign in to activate this feature.";
  if (error === "no_device") return "Could not identify this device.";
  if (error === "server_misconfig") return "Activation is temporarily unavailable.";
  return "Invalid or expired code.";   // invalid | expired | anything else
}

function randomId(prefix) { return (prefix || "act_") + hex(randBytes(16)); }
function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }

// Prefer the person's entitlement tier over the device-activation tier — flag-gated, fail-open.
// When ENTITLEMENTS_ON is off (default), or there's no uid, or the lookup throws/misses, this is
// byte-for-byte the old behavior: normalizeTier(activationTier). Never locks a user out.
export async function resolveTier(env, feature, uid, activationTier, fs) {
  let tier = normalizeTier(activationTier);
  if (!entitlementsOn(env) || !uid) return tier;
  try {
    const rec = await getEntitlement(env, uid, fs);   // fs has .fsGet
    if (rec) tier = effectiveTier(feature, rec);
  } catch (e) { /* fail-open to the activation tier — never lock a user out */ }
  return tier;
}

// ========================================================================================
// I/O operations — compose the pure helpers over Firestore. `deps` (fsGet/fsCommit/fsQuery)
// defaults to the real client; tests pass an in-memory store.
// ========================================================================================

// ADMIN: mint a new single-use code. Returns the plaintext ONCE (never stored).
export async function generateCode(env, opts, deps) {
  const fs = deps || FS;
  const feature = opts.feature;
  if (!isFeature(feature)) throw Object.assign(new Error("bad_feature"), { code: "bad_feature", status: 400 });
  const pepper = env.EXPERIMENTAL_CODE_PEPPER;
  if (!pepper) throw Object.assign(new Error("no_pepper"), { code: "server_misconfig", status: 500 });
  const now = Date.now();
  const expiry = opts.expiry != null && opts.expiry !== "" ? +opts.expiry : null;
  const tierNorm = normalizeTier(opts.tier);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode(FEATURES[feature].prefix);
    const hash = await hashCode(code, pepper);
    const doc = {
      feature, hashedCode: hash, status: "unused", createdAt: now,
      expiry: (expiry && expiry > now) ? expiry : (expiry ? expiry : null),
      notes: clip(opts.notes, 300), tier: tierNorm,
      activatedAt: null, activatedByUID: null, activatedDeviceId: null,
      activatedDeviceModel: null, activatedPlatform: null, activationId: null, revokedAt: null,
    };
    try {
      await fs.fsCommit(env, [FS.wCreate(env, CODES + "/" + hash, doc)]);
      return { ok: true, code, id: hash.slice(0, 12), feature, expiry: doc.expiry, createdAt: now, tier: tierNorm };
    } catch (e) {
      if (e && e.code === "precondition") continue;   // ~impossible hash collision — retry
      throw e;
    }
  }
  throw Object.assign(new Error("gen_failed"), { code: "gen_failed", status: 500 });
}

// APP: activate a code on this device. Exactly-once + device-bound.
export async function activate(env, req, deps) {
  const fs = deps || FS;
  const feature = req.feature;
  if (!isFeature(feature) || !req.code) return { ok: false, error: "invalid" };
  if (!req.uid) return { ok: false, error: "signin_required" };
  if (!req.deviceId) return { ok: false, error: "no_device" };
  const pepper = env.EXPERIMENTAL_CODE_PEPPER, secret = env.EXPERIMENTAL_TOKEN_SECRET;
  if (!pepper || !secret) return { ok: false, error: "server_misconfig" };
  const now = Date.now();
  const hash = await hashCode(req.code, pepper);
  const path = CODES + "/" + hash;
  const doc = await fs.fsGet(env, path);
  const decision = decideActivation(doc && doc.fields, { feature, uid: req.uid, deviceId: req.deviceId }, now);

  if (decision.action === "reject") return { ok: false, error: decision.error };
  if (decision.action === "reissue") return tokenResult(secret, feature, req, doc.fields.activationId, doc.fields, now, true, normalizeTier(doc.fields.tier));

  // action === "activate": bind atomically (code update guarded on updateTime + activation create).
  const activationId = randomId();
  const tierNorm = normalizeTier(doc.fields.tier);
  const codePatch = {
    status: "activated", activatedAt: now, activatedByUID: req.uid,
    activatedDeviceId: req.deviceId, activatedDeviceModel: clip(req.deviceModel, 120),
    activatedPlatform: clip(req.platform, 20), activationId,
  };
  const actDoc = {
    feature, uid: req.uid, deviceId: req.deviceId, platform: clip(req.platform, 20),
    deviceModel: clip(req.deviceModel, 120), hashedCode: hash, status: "active",
    activatedAt: now, revokedAt: null, tier: tierNorm,
  };
  try {
    await fs.fsCommit(env, [
      FS.wUpdate(env, path, codePatch, { updateTime: doc.updateTime }),
      FS.wCreate(env, ACTS + "/" + activationId, actDoc),
    ]);
  } catch (e) {
    if (e && e.code === "precondition") {
      // lost the race — re-read + re-decide (turns into idempotent success or "already used")
      const fresh = await fs.fsGet(env, path);
      const d2 = decideActivation(fresh && fresh.fields, { feature, uid: req.uid, deviceId: req.deviceId }, now);
      if (d2.action === "reissue") return tokenResult(secret, feature, req, fresh.fields.activationId, fresh.fields, now, true, normalizeTier(fresh.fields.tier));
      return { ok: false, error: d2.error || "already_used" };
    }
    throw e;
  }
  return tokenResult(secret, feature, req, activationId, actDoc, now, false, tierNorm);
}

async function tokenResult(secret, feature, req, activationId, srcFields, now, reused, tier) {
  const tierNorm = normalizeTier(tier != null ? tier : srcFields.tier);
  const token = await signToken({ f: feature, u: req.uid, d: req.deviceId, p: clip(req.platform, 20), a: activationId, t: tierNorm }, secret);
  return {
    ok: true, token, feature, activationId, reused: !!reused,
    deviceModel: srcFields.deviceModel || srcFields.activatedDeviceModel || "",
    activatedAt: srcFields.activatedAt || now, tier: tierNorm,
  };
}

// APP: verify a stored token against the live activation record (startup / on-resume gate).
export async function verify(env, req, deps) {
  const fs = deps || FS;
  const secret = env.EXPERIMENTAL_TOKEN_SECRET;
  if (!secret) return { active: false, reason: "server_misconfig" };
  const payload = await verifyToken(req.token, secret);
  if (!payload) return { active: false, reason: "bad_token" };
  if (req.feature && payload.f !== req.feature) return { active: false, reason: "feature_mismatch" };
  if (req.deviceId && payload.d !== req.deviceId) return { active: false, reason: "device_mismatch" };
  if (req.uid && payload.u !== req.uid) return { active: false, reason: "uid_mismatch" };
  const act = await fs.fsGet(env, ACTS + "/" + payload.a);
  if (!act) return { active: false, reason: "no_activation" };
  const fa = act.fields;
  if (fa.status !== "active") return { active: false, reason: "revoked" };
  if (fa.feature !== payload.f || fa.deviceId !== payload.d || fa.uid !== payload.u) return { active: false, reason: "mismatch" };
  const tier = await resolveTier(env, fa.feature, payload.u, fa.tier, fs);
  return { active: true, feature: fa.feature, deviceModel: fa.deviceModel, activatedAt: fa.activatedAt, tier };
}

// SERVER-SIDE gate for a feature's protected compute (e.g. /api/fundx). A valid HMAC token that
// points at an ACTIVE activation record for this feature is server-authoritative proof of a live
// one-device activation — so the beta compute is genuinely code-gated, not just hidden in the UI.
export async function checkActive(env, feature, token, deps) {
  const fs = deps || FS;
  const secret = env.EXPERIMENTAL_TOKEN_SECRET;
  if (!secret) return { active: false, reason: "server_misconfig" };
  const payload = await verifyToken(token, secret);
  if (!payload || payload.f !== feature) return { active: false, reason: "bad_token" };
  const act = await fs.fsGet(env, ACTS + "/" + payload.a);
  if (!act || act.fields.status !== "active" || act.fields.feature !== feature || act.fields.deviceId !== payload.d) return { active: false, reason: "inactive" };
  const tier = await resolveTier(env, feature, payload.u, act.fields.tier, fs);
  return { active: true, uid: payload.u, deviceId: payload.d, tier };
}

// APP: authoritative status for a signed-in user on THIS device — restores the token after a
// reinstall (same account + same device) so the consumed code never has to be re-entered.
export async function statusFor(env, req, deps) {
  const fs = deps || FS;
  if (!req.uid || !isFeature(req.feature)) return { active: false };
  const rows = await fs.fsQuery(env, ACTS, { where: { field: "uid", value: req.uid } });
  const match = rows.find((r) => r.fields.feature === req.feature && r.fields.deviceId === req.deviceId && r.fields.status === "active");
  if (!match) return { active: false };
  const secret = env.EXPERIMENTAL_TOKEN_SECRET;
  const tierNorm = await resolveTier(env, req.feature, req.uid, match.fields.tier, fs);
  let token = null;
  if (secret && req.deviceId) token = await signToken({ f: req.feature, u: req.uid, d: req.deviceId, p: clip(match.fields.platform, 20), a: match.id, t: tierNorm }, secret);
  return { active: true, token, feature: req.feature, deviceModel: match.fields.deviceModel, activatedAt: match.fields.activatedAt, tier: tierNorm };
}

// ADMIN: deactivate an activated device. Revokes the activation AND marks the code revoked — the
// original code stays consumed (never reusable); issue the tester a fresh code for the new device.
export async function revokeActivation(env, opts, deps) {
  const fs = deps || FS;
  const act = await fs.fsGet(env, ACTS + "/" + opts.activationId);
  if (!act) return { ok: false, error: "not_found" };
  const now = Date.now();
  const writes = [FS.wUpdate(env, ACTS + "/" + opts.activationId, { status: "revoked", revokedAt: now }, { exists: true })];
  if (act.fields.hashedCode) writes.push(FS.wUpdate(env, CODES + "/" + act.fields.hashedCode, { status: "revoked", revokedAt: now }, { exists: true }));
  await fs.fsCommit(env, writes);
  return { ok: true, activationId: opts.activationId, feature: act.fields.feature };
}

// Pure: the guarded write for an admin tier change — path + normalized-tier fields, no I/O.
export function buildSetTierWrite(activationId, tier) {
  return { path: ACTS + "/" + activationId, fields: { tier: normalizeTier(tier) } };
}

// ADMIN: change an existing activation's tier (e.g. v1 <-> v2beta). The client picks this up on
// its next verify/status call — the already-issued token keeps its old tier claim until then,
// consistent with revokeActivation's "takes effect on next open" behavior.
export async function setActivationTier(env, opts, deps) {
  const fs = deps || FS;
  if (!opts || !opts.activationId) return { ok: false, error: "bad_request" };
  const w = buildSetTierWrite(opts.activationId, opts.tier);
  await fs.fsCommit(env, [FS.wUpdate(env, w.path, w.fields, { exists: true })]);   // guard: must exist
  return { ok: true, activationId: opts.activationId, tier: w.fields.tier };
}

// ADMIN: revoke a code by its hashed id (kills an unused code, or an activated one + its device).
export async function revokeCode(env, opts, deps) {
  const fs = deps || FS;
  const doc = await fs.fsGet(env, CODES + "/" + opts.hashedCode);
  if (!doc) return { ok: false, error: "not_found" };
  const now = Date.now();
  const writes = [FS.wUpdate(env, CODES + "/" + opts.hashedCode, { status: "revoked", revokedAt: now }, { exists: true })];
  if (doc.fields.activationId) writes.push(FS.wUpdate(env, ACTS + "/" + doc.fields.activationId, { status: "revoked", revokedAt: now }, { exists: true }));
  await fs.fsCommit(env, writes);
  return { ok: true };
}

// ADMIN: list codes (optionally by feature). NEVER returns plaintext (unrecoverable by design). The
// `id` IS the sha256 hash — safe to expose (preimage-resistant + secret pepper, and useless for
// activation which needs the plaintext); admin actions round-trip on it. `short` is for display.
function publicCode(id, f, now) {
  return {
    id: String(id), short: String(id).slice(0, 12), feature: f.feature, status: effectiveStatus(f, now), notes: f.notes || "",
    createdAt: f.createdAt || null, expiry: f.expiry || null, tier: normalizeTier(f.tier),
    activatedByUID: f.activatedByUID || null, activatedDeviceModel: f.activatedDeviceModel || null,
    activatedPlatform: f.activatedPlatform || null, activatedAt: f.activatedAt || null,
    activationId: f.activationId || null,
  };
}
export async function listCodes(env, opts, deps) {
  const fs = deps || FS;
  const rows = await fs.fsQuery(env, CODES, (opts && opts.feature) ? { where: { field: "feature", value: opts.feature } } : {});
  const now = Date.now();
  return rows.map((r) => publicCode(r.id, r.fields, now)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ADMIN: list activations / activated devices.
export async function listActivations(env, opts, deps) {
  const fs = deps || FS;
  const rows = await fs.fsQuery(env, ACTS, (opts && opts.feature) ? { where: { field: "feature", value: opts.feature } } : {});
  return rows.map((r) => ({
    activationId: r.id, feature: r.fields.feature, uid: r.fields.uid,
    deviceId: String(r.fields.deviceId || "").slice(0, 12) + "…", deviceModel: r.fields.deviceModel || "",
    platform: r.fields.platform || "", status: r.fields.status || "active", tier: normalizeTier(r.fields.tier),
    activatedAt: r.fields.activatedAt || null, revokedAt: r.fields.revokedAt || null,
  })).sort((a, b) => (b.activatedAt || 0) - (a.activatedAt || 0));
}

// ADMIN: delete expired UNUSED codes (activated / revoked codes are kept for the audit trail).
export async function deleteExpired(env, opts, deps) {
  const fs = deps || FS;
  const rows = await fs.fsQuery(env, CODES, (opts && opts.feature) ? { where: { field: "feature", value: opts.feature } } : {});
  const now = Date.now();
  const stale = rows.filter((r) => effectiveStatus(r.fields, now) === "expired");
  for (let i = 0; i < stale.length; i += 200) {
    const chunk = stale.slice(i, i + 200).map((r) => FS.wDelete(env, CODES + "/" + r.id));
    if (chunk.length) await fs.fsCommit(env, chunk);
  }
  return { ok: true, removed: stale.length };
}

// ADMIN: analytics — code counts by status + device counts (optionally scoped to a feature).
export async function analytics(env, opts, deps) {
  const fs = deps || FS;
  const feature = opts && opts.feature;
  const codes = await fs.fsQuery(env, CODES, feature ? { where: { field: "feature", value: feature } } : {});
  const acts = await fs.fsQuery(env, ACTS, feature ? { where: { field: "feature", value: feature } } : {});
  const now = Date.now();
  const byStatus = { unused: 0, activated: 0, expired: 0, revoked: 0 };
  const perFeature = {};
  codes.forEach((r) => {
    const st = effectiveStatus(r.fields, now);
    byStatus[st] = (byStatus[st] || 0) + 1;
    const ft = r.fields.feature || "?";
    (perFeature[ft] = perFeature[ft] || { unused: 0, activated: 0, expired: 0, revoked: 0 })[st] += 1;
  });
  return {
    total: codes.length, byStatus, perFeature,
    activeDevices: acts.filter((r) => r.fields.status === "active").length,
    revokedDevices: acts.filter((r) => r.fields.status === "revoked").length,
  };
}
