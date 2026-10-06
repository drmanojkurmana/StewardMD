/* PrepNucleus social: helpers for functions/api/prep/social/[[path]].js and the Leave Arena path.
 * Owner decision 2026-10-06 (vault/decisions/Decisions.md "PrepNucleus pricing, free tier and social").
 *
 * People are the Arena's players (sha256(uid) prefix, PREP_ARENA_DB). A StewardMD ID (SMD-XXXXXX) resolves to a uid
 * through Firestore doctorDirectory/{smdId}.uid (the same lookup as _entitlements.js resolveUid); a resolved pair is
 * kept in social_ids so friend lists can show IDs without another lookup.
 */
import { fsGet } from "./_fbfirestore.js";
import { normalizeSmdId } from "./_entitlements.js";
import { uidHash } from "./_prep-arena.js";
export { normalizeSmdId };

/* ---------- time (IST, no DST) ---------- */
const IST = 5.5 * 3600e3, DAY = 86400e3;
export const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);
// Monday (IST) of t's week, as YYYY-MM-DD.
export function weekStart(t) { const d = new Date(t + IST); return istDay(t - ((d.getUTCDay() + 6) % 7) * DAY); }

/* ---------- codes ---------- */
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // steward-id.js alphabet: no 0/O/1/I/L
export function randomCode(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (let i = 0; i < n; i++) s += CODE_ABC[b[i] % CODE_ABC.length];   // ponytail: tiny modulo bias (256 % 31), irrelevant for room/group codes
  return s;
}
export const ROOM_RE = /^[A-HJ-NP-Z2-9]{16}$/;
export const GROUP_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/* ---------- colleges ---------- */
const ABBR = { govt: "government", gov: "government", med: "medical", medl: "medical", coll: "college", clg: "college", col: "college", inst: "institute", instt: "institute", univ: "university", sci: "sciences", hosp: "hospital", res: "research", st: "saint" };
/* "Govt. Med. Coll., Nagpur" -> "government medical college nagpur". Case-folded, punctuation out, spaces collapsed,
 * common abbreviations expanded, "&" as "and". The key for boards; the typed text is kept for display. */
export function collegeKey(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)
    .map((w) => ABBR[w] || w).join(" ");
}
export const cleanText = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
// A modest pick list; free text is accepted too.
export const COLLEGES = [
  ["All India Institute of Medical Sciences, New Delhi", "Delhi"], ["Maulana Azad Medical College", "Delhi"], ["Vardhman Mahavir Medical College", "Delhi"],
  ["Lady Hardinge Medical College", "Delhi"], ["University College of Medical Sciences", "Delhi"], ["PGIMER Chandigarh", "Chandigarh"],
  ["Christian Medical College, Vellore", "Tamil Nadu"], ["Madras Medical College", "Tamil Nadu"], ["JIPMER Puducherry", "Puducherry"],
  ["Seth GS Medical College", "Maharashtra"], ["Grant Medical College", "Maharashtra"], ["BJ Medical College, Pune", "Maharashtra"],
  ["Armed Forces Medical College", "Maharashtra"], ["Government Medical College, Nagpur", "Maharashtra"], ["Bangalore Medical College", "Karnataka"],
  ["Kasturba Medical College, Manipal", "Karnataka"], ["St John's Medical College", "Karnataka"], ["Government Medical College, Thiruvananthapuram", "Kerala"],
  ["Osmania Medical College", "Telangana"], ["Gandhi Medical College", "Telangana"], ["Andhra Medical College", "Andhra Pradesh"],
  ["King George's Medical University", "Uttar Pradesh"], ["Institute of Medical Sciences, BHU", "Uttar Pradesh"], ["Patna Medical College", "Bihar"],
  ["Medical College, Kolkata", "West Bengal"], ["Institute of Post Graduate Medical Education and Research", "West Bengal"], ["SCB Medical College", "Odisha"],
  ["BJ Medical College, Ahmedabad", "Gujarat"], ["SMS Medical College", "Rajasthan"], ["Gandhi Medical College, Bhopal", "Madhya Pradesh"],
  ["Government Medical College, Chandigarh", "Chandigarh"], ["Gauhati Medical College", "Assam"],
].map(([name, state]) => ({ name, state }));

/* ---------- StewardMD ID -> player ---------- */
/* The uidh for an SMD ID, or null. social_ids first; else Firestore doctorDirectory, remembered. Throws when Firestore
 * fails (the caller answers 503, never "not found"). */
export async function uidhForSmd(env, db, raw) {
  const smd = normalizeSmdId(raw);
  if (!/^SMD-[A-Z0-9]{6}$/.test(smd)) return null;
  const known = await db.prepare("SELECT uidh FROM social_ids WHERE smd_id = ?").bind(smd).first();
  if (known) return known.uidh;
  const d = await fsGet(env, "doctorDirectory/" + smd);
  const uid = d && d.fields && d.fields.uid;
  if (!uid) return null;
  const uidh = uidHash(uid);
  await db.prepare("INSERT OR IGNORE INTO social_ids (uidh, smd_id) VALUES (?, ?)").bind(uidh, smd).run();
  return uidh;
}
/* My own SMD ID (so friends see it): users/{uid}/profile/self.smdId, accepted only when the directory row points back at
 * this uid (the profile doc is client-written). Null when none yet. */
export async function ensureMySmd(env, db, uid, uidh) {
  const known = await db.prepare("SELECT smd_id FROM social_ids WHERE uidh = ?").bind(uidh).first();
  if (known) return known.smd_id;
  const p = await fsGet(env, "users/" + uid + "/profile/self");
  const smd = normalizeSmdId(p && p.fields && p.fields.smdId);
  if (!/^SMD-[A-Z0-9]{6}$/.test(smd)) return null;
  const d = await fsGet(env, "doctorDirectory/" + smd);
  if (!d || !d.fields || d.fields.uid !== uid) return null;
  await db.prepare("INSERT OR IGNORE INTO social_ids (uidh, smd_id) VALUES (?, ?)").bind(uidh, smd).run();
  return smd;
}

/* ---------- leaving ---------- */
/* Statements that take uidh out of one group (code) or every group (code null): the membership goes, a group the
 * leaver owned passes to its longest-standing member, and an empty group is deleted. */
export function leaveGroupStmts(db, uidh, code) {
  const where = code ? " AND code = ?" : "", args = code ? [uidh, code] : [uidh];
  return [
    db.prepare("DELETE FROM social_group_members WHERE uidh = ?" + where).bind(...args),
    db.prepare("UPDATE social_groups SET owner = (SELECT m.uidh FROM social_group_members m WHERE m.code = social_groups.code ORDER BY m.joined_at, m.uidh LIMIT 1) WHERE owner = ?" + where).bind(...args),
    db.prepare("DELETE FROM social_groups WHERE NOT EXISTS (SELECT 1 FROM social_group_members m WHERE m.code = social_groups.code)"),
  ];
}
// Every social row of a player, for Leave Arena (DELETE /api/prep/arena/consent).
export function socialDeleteStmts(db, uidh) {
  return [
    db.prepare("DELETE FROM social_friends WHERE a = ? OR b = ?").bind(uidh, uidh),
    db.prepare("DELETE FROM social_challenges WHERE from_uidh = ? OR to_uidh = ?").bind(uidh, uidh),
    db.prepare("DELETE FROM social_college WHERE uidh = ?").bind(uidh),
    db.prepare("DELETE FROM social_progress WHERE uidh = ?").bind(uidh),
    ...leaveGroupStmts(db, uidh, null),
    db.prepare("DELETE FROM social_ids WHERE uidh = ?").bind(uidh),
  ];
}
