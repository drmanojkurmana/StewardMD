/* functions/_coupons.js — institution coupon codes.
 * An institution that pays for its doctors gets an admin-issued code; each doctor redeems it in-app to
 * unlock Pro. Revocable anytime (institution stops paying → their doctors lose Pro). Store: MAIK_KV key
 * coupon:<CODE> -> { code, type:"pro", forever|months|days, maxRedemptions, redeemedBy[], expiresAt,
 * revoked, note, createdAt }. Redeem grants Pro via _entitlement.grantPro; revoke pulls Pro from every
 * redeemer whose entitlement STILL came from this coupon (never nukes a doctor who has since paid).
 * Pure verdict + deps-injectable IO (kv/grantPro/revokePro/getUserClaims) so it tests offline. */
import { grantPro, revokePro } from "./_entitlement.js";
import { getUserClaims } from "./_fbadmin.js";

const PFX = "coupon:";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no ambiguous 0/O/1/I/L

function kvOf(env, deps) { return (deps && deps.kv) || (env && env.MAIK_KV); }
export function normCode(c) { return String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
export function genCode(n) {
  n = n || 10; const buf = new Uint8Array(n); crypto.getRandomValues(buf);
  let s = ""; for (let i = 0; i < n; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return s;
}

// Pure: is this coupon redeemable by uid at `now`? The tested core — no IO.
export function couponVerdict(c, uid, now) {
  now = now || Date.now();
  if (!c) return { ok: false, reason: "not-found" };
  if (c.revoked) return { ok: false, reason: "revoked" };
  if (c.expiresAt && now > +c.expiresAt) return { ok: false, reason: "expired" };
  const redeemed = c.redeemedBy || [];
  if (uid && redeemed.indexOf(uid) >= 0) return { ok: true, already: true };   // idempotent re-redeem
  if (c.maxRedemptions && redeemed.length >= +c.maxRedemptions) return { ok: false, reason: "exhausted" };
  return { ok: true };
}

export async function createCoupon(env, opts, deps) {
  const kv = kvOf(env, deps); opts = opts || {};
  const code = normCode(opts.code) || genCode(Math.min(16, Math.max(6, +opts.length || 10)));
  const rec = {
    code, type: "pro",
    forever: !!opts.forever,
    months: opts.months ? Math.max(1, +opts.months) : 0,
    days: opts.days ? Math.max(1, +opts.days) : 0,
    maxRedemptions: opts.maxRedemptions ? Math.max(1, +opts.maxRedemptions) : 0,   // 0 = unlimited
    redeemedBy: [], revoked: false,
    expiresAt: opts.expiresAt ? +opts.expiresAt : 0,
    note: String(opts.note || "").slice(0, 200), createdAt: Date.now(),
  };
  if (!rec.forever && !rec.months && !rec.days) rec.months = 12;   // default grant: 1 year of Pro
  await kv.put(PFX + code, JSON.stringify(rec));
  return rec;
}

export async function getCoupon(env, code, deps) {
  const kv = kvOf(env, deps);
  const raw = await kv.get(PFX + normCode(code));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function listCoupons(env, deps) {
  const kv = kvOf(env, deps);
  const out = []; let cursor;
  do {
    const page = await kv.list({ prefix: PFX, cursor });
    for (const k of page.keys) { const raw = await kv.get(k.name); if (raw) { try { out.push(JSON.parse(raw)); } catch (e) {} } }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function redeemCoupon(env, code, uid, deps) {
  if (!uid) return { ok: false, reason: "signin-required" };
  const kv = kvOf(env, deps);
  const c = await getCoupon(env, code, deps);
  const v = couponVerdict(c, uid, Date.now());
  if (!v.ok) return v;
  const grant = (deps && deps.grantPro) || grantPro;
  const opts = c.forever ? { forever: true, source: "coupon:" + c.code }
    : c.days ? { days: c.days, source: "coupon:" + c.code }
      : { months: c.months || 12, source: "coupon:" + c.code };
  const g = await grant(env, uid, opts);
  if (!v.already) { c.redeemedBy = (c.redeemedBy || []).concat([uid]); await kv.put(PFX + c.code, JSON.stringify(c)); }
  return { ok: true, code: c.code, already: !!v.already, grant: g };
}

export async function revokeCoupon(env, code, deps) {
  const kv = kvOf(env, deps);
  const c = await getCoupon(env, code, deps);
  if (!c) return { ok: false, reason: "not-found" };
  c.revoked = true; c.revokedAt = Date.now();
  await kv.put(PFX + c.code, JSON.stringify(c));
  // Pull Pro from redeemers whose entitlement STILL came from this coupon. Skip anyone who has since
  // paid (source no longer "coupon:...") so revoking an institution's code never nukes a paying doctor.
  const revoke = (deps && deps.revokePro) || revokePro;
  const claimsOf = (deps && deps.getUserClaims) || getUserClaims;
  const pulled = [];
  for (const uid of (c.redeemedBy || [])) {
    try {
      let cur = {}; try { cur = (await claimsOf(env, uid)) || {}; } catch (e) {}
      const src = String(cur.source || "");
      if (src && src !== "coupon:" + c.code) continue;   // they since paid / got another coupon — leave it
      await revoke(env, uid); pulled.push(uid);
    } catch (e) {}
  }
  return { ok: true, code: c.code, revoked: true, pulledPro: pulled.length };
}
