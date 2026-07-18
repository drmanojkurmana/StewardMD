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
  const metadata = { firstSeen: rec.firstSeen || 0, upsellAt: rec.upsellAt || 0, verifiedAt: rec.verifiedAt || 0 };
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
