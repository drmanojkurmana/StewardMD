/* StewardMD — user lifecycle tracking for onboarding emails (welcome → verify → Pro).
 *
 * Stored in KV (MAIK_KV, falling back to GHIS_KV/UPDATES_KV), keyed by Firebase uid. Holds ONLY
 * the fields the email sweeps need — email, display name, and a few timestamps. NEVER any PHI.
 *
 *   lifecycle:u:<uid> -> { email, name, firstSeen, verifiedAt?, upsellAt? }
 *
 * - firstSeen is idempotent (never reset) so the day-3 sweep measures from the true first sign-in.
 * - upsellAt is the send-once guard shared by the on-verify and day-3 Pro-email paths.
 * The `firstSeen` + `upsellAt` markers are also mirrored into the KV entry's metadata so the nightly
 * sweep can filter from list() alone, without a get() per user.
 */

import { emailProUpsell } from "./_email.js";
import { promoActive, promoUntil } from "./_entitlement.js";
import { getUserClaims } from "./_fbadmin.js";
import { fsGet, fsCommit, wDelete } from "./_fbfirestore.js";

function lcKv(env) { return env.MAIK_KV || env.GHIS_KV || env.UPDATES_KV || null; }
const PREFIX = "lifecycle:u:";
const KEY = (uid) => PREFIX + uid;

function promoUntilStr(env) {
  try { return new Date(promoUntil(env)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
}

export async function getLifecycle(env, uid) {
  const kv = lcKv(env); if (!kv || !uid) return null;
  try { return (await kv.get(KEY(uid), "json")) || null; } catch (e) { return null; }
}

async function putLifecycle(env, uid, rec) {
  const kv = lcKv(env); if (!kv || !uid) return;
  // Mirror the sweep-relevant fields into metadata so list() can filter without reading each value.
  const metadata = { firstSeen: rec.firstSeen || 0, upsellAt: rec.upsellAt || 0, verifiedAt: rec.verifiedAt || 0,
                     purgeWarnedAt: rec.purgeWarnedAt || 0, purgedAt: rec.purgedAt || 0 };
  try { await kv.put(KEY(uid), JSON.stringify(rec), { metadata }); } catch (e) {}
}

// Record first sign-in (idempotent — never resets firstSeen). Fills email/name if newly known.
export async function markFirstSeen(env, uid, { email, name } = {}) {
  if (!lcKv(env) || !uid) return null;
  const cur = await getLifecycle(env, uid);
  if (cur && cur.firstSeen) {
    let dirty = false;
    if (email && !cur.email) { cur.email = email; dirty = true; }
    if (name && !cur.name) { cur.name = name; dirty = true; }
    if (dirty) await putLifecycle(env, uid, cur);
    return cur;
  }
  const rec = { email: email || (cur && cur.email) || "", name: name || (cur && cur.name) || "", firstSeen: Date.now() };
  await putLifecycle(env, uid, rec);
  return rec;
}

// Stamp the verification timestamp (keeps firstSeen/upsellAt).
export async function markVerified(env, uid) {
  if (!lcKv(env) || !uid) return null;
  const rec = (await getLifecycle(env, uid)) || { firstSeen: Date.now() };
  rec.verifiedAt = Date.now();
  await putLifecycle(env, uid, rec);
  return rec;
}

// Stamp the Pro-upsell send (send-once guard). Returns the updated record.
export async function markUpsold(env, uid) {
  if (!lcKv(env) || !uid) return null;
  const rec = (await getLifecycle(env, uid)) || { firstSeen: Date.now() };
  rec.upsellAt = Date.now();
  await putLifecycle(env, uid, rec);
  return rec;
}

// Send the Pro-upsell email at most once per user (guarded by upsellAt). Skips anyone who already
// holds a REAL Pro claim (granted/purchased — NOT the launch promo). Promo-aware copy. Best-effort;
// only stamps upsellAt when the send actually succeeds, so a transient failure retries next sweep.
export async function sendProUpsellOnce(env, uid, { email, name } = {}) {
  if (!lcKv(env) || !uid) return { sent: false, reason: "no-kv" };
  const rec = (await getLifecycle(env, uid)) || {};
  if (email && !rec.email) rec.email = email;
  if (name && !rec.name) rec.name = name;
  if (rec.upsellAt) { await putLifecycle(env, uid, rec); return { sent: false, reason: "already" }; }
  // Don't upsell someone who already bought / was granted Pro (the real claim, not the promo).
  try { const c = await getUserClaims(env, uid); if (c && c.pro === true) { rec.upsellAt = Date.now(); await putLifecycle(env, uid, rec); return { sent: false, reason: "already-pro" }; } } catch (e) {}
  const to = email || rec.email || "";
  if (!to) { await putLifecycle(env, uid, rec); return { sent: false, reason: "no-email" }; }
  let ok = false;
  try {
    const r = await emailProUpsell(env, { email: to, name: name || rec.name || "", promoActive: promoActive(env), promoUntilStr: promoUntilStr(env) });
    ok = !!(r && r.ok);
  } catch (e) {}
  if (ok) rec.upsellAt = Date.now();
  await putLifecycle(env, uid, rec);
  return { sent: ok };
}

/* ── Unverified-account sweep (owner decision, 2026-08-27) ────────────────────────────────────
 * "Who signs up just gets access to FREE, with auto account deletion after 7 days."
 *
 * decidePurge() is deliberately PURE: given a lifecycle record and the account's claims it returns
 * what should happen, with no network and no writes. Every skip rule below is a way for a real
 * person to be spared, so they are worth reading as a list rather than trusting to a KV filter:
 * KV list() metadata can be stale, claims are authoritative, and this is a destructive path.
 *
 * Returns { action, reason, ageDays } where action is one of:
 *   "skip"    leave the account alone
 *   "warn"    send the day-5 reminder (once)
 *   "purge"   the account is due for removal (the CALLER decides disable vs delete)
 */
export const PURGE_DAYS_DEFAULT = 7;
export const WARN_DAYS_DEFAULT = 5;

export function purgeDays(env) {
  const n = +(env && env.UNVERIFIED_PURGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : PURGE_DAYS_DEFAULT;
}
export function warnDays(env) {
  const n = +(env && env.UNVERIFIED_WARN_DAYS);
  return Number.isFinite(n) && n > 0 ? n : WARN_DAYS_DEFAULT;
}
// ARMED by owner decision, 2026-08-27. Set UNVERIFIED_PURGE_ON=0 to put it back into report-only
// mode without a deploy. The protections in decidePurge() are what make this safe to leave running:
// verified, paying and pending-review accounts are spared, and nobody is removed unwarned.
export function purgeEnabled(env) {
  const v = env && env.UNVERIFIED_PURGE_ON;
  if (v === undefined || v === null || v === "") return true;
  return !(String(v) === "0" || String(v) === "false");
}
// Owner asked for DELETE, not disable. Set UNVERIFIED_PURGE_HARD_DELETE=0 to soften it back to a
// reversible account disable. When this is on, purgeUserData() runs FIRST - deleting the sign-in
// while leaving the clinical data behind would be the worst of both: the doctor cannot reach their
// own records and we are still holding them.
export function hardDeleteEnabled(env) {
  const v = env && env.UNVERIFIED_PURGE_HARD_DELETE;
  if (v === undefined || v === null || v === "") return true;
  return !(String(v) === "0" || String(v) === "false");
}

/* Remove the server-side data an account owns, before the account itself goes.
 *
 * An unverified account is by definition one that never unlocked the clinical tools, so in practice
 * this is near-empty - but "near" is not "always", and a delete that orphans patient data is a
 * retention problem, not a tidy-up. Best-effort and never throws: a failure here must not stop the
 * sweep, and every step is independently safe to retry.
 *
 * Deliberately NOT deleted: the lifecycle record itself, which stays as a tombstone (purgedAt) so a
 * later run does not reprocess the same uid.
 */
export async function purgeUserData(env, uid) {
  const out = { cases: 0, index: false, doctor: false, budget: false, profile: false, directory: false };
  if (!uid) return out;
  const cs = (env && (env.CASES_KV || env.GHIS_KV)) || null;
  if (cs) {
    try {
      const idx = (await cs.get("icu:index:" + uid, "json")) || [];
      for (const e of (Array.isArray(idx) ? idx : [])) {
        if (!e || !e.id) continue;
        try { await cs.delete("icu:case:" + uid + ":" + e.id); out.cases++; } catch (x) {}
      }
      await cs.delete("icu:index:" + uid); out.index = true;
    } catch (e) {}
    try { await cs.delete("icu:doctor:" + uid); out.doctor = true; } catch (e) {}   // verification record
  }
  const mk = lcKv(env);
  if (mk) { try { await mk.delete("maik:budget:" + uid); out.budget = true; } catch (e) {} }

  // Firestore: the private profile, and the directory pointer that makes them findable by ID.
  try {
    const prof = await fsGet(env, "users/" + uid + "/profile/self");
    const writes = [wDelete(env, "users/" + uid + "/profile/self")];
    const smdId = prof && prof.smdId;
    if (smdId) writes.push(wDelete(env, "doctorDirectory/" + smdId));
    await fsCommit(env, writes);
    out.profile = true; out.directory = !!smdId;
  } catch (e) {}
  return out;
}

export function decidePurge(env, rec, claims, now) {
  now = now || Date.now();
  const c = claims || {};
  const r = rec || {};
  const ageDays = r.firstSeen ? (now - r.firstSeen) / 86400000 : null;

  // --- reasons a real account is spared, checked against CLAIMS, not the KV metadata ---
  if (c.verified === true) return { action: "skip", reason: "verified", ageDays };
  if (c.provUntil && +c.provUntil > now) return { action: "skip", reason: "pending-review", ageDays };
  // Never remove someone who paid us, verified or not. If that ever happens it is a refund
  // conversation, not a cron job.
  if (c.pro === true && (!c.proExp || +c.proExp > now)) return { action: "skip", reason: "paying", ageDays };
  if (r.verifiedAt) return { action: "skip", reason: "verified-record", ageDays };
  if (r.purgedAt) return { action: "skip", reason: "already-purged", ageDays };
  if (!r.firstSeen) return { action: "skip", reason: "no-first-seen", ageDays };

  const age = ageDays;
  if (age >= purgeDays(env)) {
    // Nobody is removed who was never told. If the warning has not gone out (a sweep that only
    // started running today, an email that kept failing), warn now and purge on a later run.
    if (!r.purgeWarnedAt) return { action: "warn", reason: "overdue-but-unwarned", ageDays };
    return { action: "purge", reason: "unverified", ageDays };
  }
  if (age >= warnDays(env) && !r.purgeWarnedAt) return { action: "warn", reason: "approaching", ageDays };
  return { action: "skip", reason: "too-young", ageDays };
}

// Stamp the day-5 warning (send-once guard).
export async function markPurgeWarned(env, uid) {
  if (!lcKv(env) || !uid) return null;
  const rec = (await getLifecycle(env, uid)) || { firstSeen: Date.now() };
  rec.purgeWarnedAt = Date.now();
  await putLifecycle(env, uid, rec);
  return rec;
}
// Stamp the removal, so a re-run never touches the same account twice.
export async function markPurged(env, uid, how) {
  if (!lcKv(env) || !uid) return null;
  const rec = (await getLifecycle(env, uid)) || { firstSeen: Date.now() };
  rec.purgedAt = Date.now();
  rec.purgedHow = how || "disable";
  await putLifecycle(env, uid, rec);
  return rec;
}

// List uids whose entry passes `pred(metadata)` — filtered from list() metadata, no per-key get.
// pred receives { firstSeen, upsellAt, verifiedAt }. Returns an array of uids.
export async function listLifecycleUids(env, pred) {
  const kv = lcKv(env); if (!kv) return [];
  const out = []; let cursor;
  do {
    const r = await kv.list({ prefix: PREFIX, cursor });
    for (const k of (r.keys || [])) {
      const md = k.metadata || {};
      if (!pred || pred(md)) out.push(k.name.slice(PREFIX.length));
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
