/* functions/_admin_users.js - the owner's User control: who just signed up, everything about one account.
 *
 * Owner, 2026-10-08: "create an easy user control section where I can control users who just signed up
 * and see their profile, activate anything or deactivate, give any subscription, enable limits specific
 * to that account and see usage by specific account."
 *
 * READ ONLY. Every change goes through an endpoint that already existed and is already owner-gated:
 *   sign-in on/off, verify/unverify, revoke Pro     POST /api/ai/admin/user-action
 *   per-account daily AI limit per module           POST /api/ai/admin/user-limit
 *   plan (Pro / Physician / Clinician Pro / Ultimate) POST /api/entitlements/admin/set-plan
 *   monthly AI token budget                          POST /api/entitlements/admin/set-budget
 *   approve / reject a pending verification          POST /api/verifications/approve|reject
 * This file only joins what is already stored about an account into one answer.
 *
 * Sources: lifecycle:u:<uid> (first sign-in, email, name, phone; MAIK_KV), the Firebase account
 * (status, provider, custom claims), icu:doctor:<uid> (the verification record; CASES_KV),
 * users/<uid>/profile/self (Firestore), the entitlements record (adminLookup) and the AI meters.
 * Every dependency is injectable (deps.*) so the joins are unit-tested without any of them.
 */
import { serviceAccountToken } from "./_fbadmin.js";
import { fsGet as realFsGet } from "./_fbfirestore.js";
import { getUserLimit, doctorUsageSummary, aiModuleList, moduleDailyLimit } from "./_ai_usage.js";
import { adminLookup } from "./_entitlements.js";

const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const DAY = 86400000;
const LC_PREFIX = "lifecycle:u:";

function lcKv(env) { return env.MAIK_KV || env.GHIS_KV || env.UPDATES_KV || null; }
function verifyKv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function usageStore(env) { return env.MAIK_KV || env.GHIS_KV || env.UPDATES_KV || null; }

function parseClaims(u) { try { return u && u.customAttributes ? (JSON.parse(u.customAttributes) || {}) : {}; } catch (e) { return {}; } }

/* Firebase accounts by uid, up to 100 per request (Identity Toolkit accounts:lookup takes a localId list). */
export async function lookupAccounts(env, uids, deps) {
  if (deps && deps.lookupAccounts) return deps.lookupAccounts(env, uids);
  const out = new Map();
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const tok = await serviceAccountToken(env);
  for (let i = 0; i < uids.length; i += 100) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
      method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uids.slice(i, i + 100) }),
    });
    if (!res.ok) continue;
    const d = await res.json();
    for (const u of (d.users || [])) out.set(u.localId, u);
  }
  return out;
}

/* One row of the list: what the owner needs to decide at a glance. */
export function accountRow(uid, lc, fb, vrec, now) {
  lc = lc || {}; const c = parseClaims(fb); const t = now || Date.now();
  const provider = fb && fb.providerUserInfo && fb.providerUserInfo[0] ? fb.providerUserInfo[0].providerId : (fb && fb.phoneNumber ? "phone" : "");
  const proActive = c.pro === true && (!c.proExp || +c.proExp > t);
  const provActive = !!(c.provUntil && +c.provUntil > t);
  let status = "unverified";
  if (c.verified === true) status = "verified";
  else if (c.traineeVerified === true) status = "trainee";
  else if (vrec && vrec.status === "pending") status = "pending";
  else if (vrec && vrec.status === "rejected") status = "rejected";
  return {
    uid,
    email: String((fb && fb.email) || lc.email || "").toLowerCase(),
    name: (fb && fb.displayName) || lc.name || (vrec && vrec.extractedName) || "",
    phone: lc.phone || (fb && fb.phoneNumber) || "",
    phoneVerified: !!(lc.phoneVerifiedAt || c.phoneVerified === true),
    provider,
    signedUpAt: lc.firstSeen || (fb && Number(fb.createdAt)) || null,
    lastLoginAt: (fb && Number(fb.lastLoginAt)) || null,
    disabled: !!(fb && fb.disabled),
    exists: !!fb,
    status,                                   // verified | trainee | pending | rejected | unverified
    reviewReason: (vrec && vrec.status === "pending" && vrec.reason) || "",
    role: (vrec && vrec.role) || "",
    pro: proActive, proExp: c.pro === true ? (c.proExp || null) : null,
    freeWeekUntil: provActive ? +c.provUntil : null,
  };
}

/* Newest sign-ups first. days: how far back (max 365). filter: all | pending | unverified | verified |
 * pro | disabled. q: matches email, name, phone or uid within that window. */
export async function listRecentSignups(env, opts, deps) {
  deps = deps || {}; opts = opts || {};
  const now = opts.now || Date.now();
  const days = Math.min(365, Math.max(1, +opts.days || 30));
  const limit = Math.min(200, Math.max(1, +opts.limit || 100));
  const since = now - days * DAY;
  const kv = deps.lcKv || lcKv(env);
  const vkv = deps.verifyKv || verifyKv(env);
  if (!kv) return { ok: true, users: [], total: 0, days };
  // 1. who signed up in the window, from list() metadata alone (no per-key read)
  const recent = []; let cursor;
  do {
    const r = await kv.list({ prefix: LC_PREFIX, cursor });
    for (const k of (r.keys || [])) {
      const fs = (k.metadata && +k.metadata.firstSeen) || 0;
      if (fs >= since) recent.push({ uid: k.name.slice(LC_PREFIX.length), firstSeen: fs });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  recent.sort((a, b) => b.firstSeen - a.firstSeen);
  // 2. join the details for the newest ones (a search looks through more of the window)
  const q = String(opts.q || "").trim().toLowerCase();
  const pool = recent.slice(0, q || (opts.filter && opts.filter !== "all") ? 600 : limit);
  const uids = pool.map((x) => x.uid);
  const [fbMap, lcs, vrecs] = await Promise.all([
    lookupAccounts(env, uids, deps).catch(() => new Map()),
    Promise.all(uids.map((u) => kv.get(LC_PREFIX + u, "json").catch(() => null))),
    Promise.all(uids.map((u) => (vkv ? vkv.get("icu:doctor:" + u, "json").catch(() => null) : null))),
  ]);
  let rows = uids.map((u, i) => accountRow(u, lcs[i], fbMap.get(u), vrecs[i], now));
  if (q) rows = rows.filter((r) => [r.email, r.name, r.phone, r.uid].some((v) => String(v || "").toLowerCase().indexOf(q) >= 0));
  const f = String(opts.filter || "all");
  if (f === "pending") rows = rows.filter((r) => r.status === "pending");
  else if (f === "unverified") rows = rows.filter((r) => r.status === "unverified" || r.status === "rejected");
  else if (f === "verified") rows = rows.filter((r) => r.status === "verified" || r.status === "trainee");
  else if (f === "pro") rows = rows.filter((r) => r.pro);
  else if (f === "disabled") rows = rows.filter((r) => r.disabled);
  const counts = { total: recent.length, today: recent.filter((x) => x.firstSeen >= now - DAY).length, week: recent.filter((x) => x.firstSeen >= now - 7 * DAY).length };
  return { ok: true, days, counts, users: rows.slice(0, limit) };
}

const PROFILE_FIELDS = ["name", "phone", "state", "city", "hospital", "degree", "speciality", "role", "regNo", "smdId", "profileComplete", "updatedAt"];
const CLAIM_FIELDS = ["pro", "proExp", "source", "verified", "verifiedAt", "traineeVerified", "regNo", "provUntil", "trialStart", "trialDenied", "phoneVerified", "phoneVerifiedAt", "role"];

/* Everything about one account, for the detail sheet. */
export async function userDetail(env, uid, deps) {
  deps = deps || {};
  uid = String(uid || "").trim();
  if (!uid) return { ok: false, error: "no_uid" };
  const now = deps.now || Date.now();
  const kv = deps.lcKv || lcKv(env), vkv = deps.verifyKv || verifyKv(env), store = deps.usageStore || usageStore(env);
  const fbMap = await lookupAccounts(env, [uid], deps).catch(() => new Map());
  const fb = fbMap.get(uid) || null;
  const [lc, vrec, prof, ent] = await Promise.all([
    kv ? kv.get(LC_PREFIX + uid, "json").catch(() => null) : null,
    vkv ? vkv.get("icu:doctor:" + uid, "json").catch(() => null) : null,
    (deps.fsGet || realFsGet)(env, "users/" + uid + "/profile/self").catch(() => null),
    (deps.adminLookup || adminLookup)(env, { uid }, deps.entDeps).catch(() => null),
  ]);
  if (!fb && !lc && !vrec) return { ok: false, error: "not_found" };
  const row = accountRow(uid, lc, fb, vrec, now);
  const claims = parseClaims(fb), c = {};
  CLAIM_FIELDS.forEach((k) => { if (claims[k] !== undefined) c[k] = claims[k]; });
  const pf = (prof && prof.fields) || {}, profile = {};
  PROFILE_FIELDS.forEach((k) => { if (pf[k] !== undefined && pf[k] !== null && pf[k] !== "") profile[k] = pf[k]; });
  const verification = vrec ? {
    status: vrec.status || "", reason: vrec.reason || "", role: vrec.role || "", via: vrec.via || "",
    nameRead: vrec.extractedName || "", regNoRead: vrec.extractedRegNo || vrec.regNo || "", council: vrec.council || "",
    institution: vrec.extractedInstitution || "", confidence: vrec.confidence != null ? vrec.confidence : null,
    hasPhoto: !!vrec.photoKey, updatedAt: vrec.updatedAt || null,
  } : null;
  // AI: per-account limits (enforced for this email, functions/_ai_usage.js checkModuleQuota) + 7 days of use
  const email = row.email;
  const limits = (email && store) ? ((await (deps.getUserLimit || getUserLimit)(store, email)) || {}) : {};
  const modules = aiModuleList().map((m) => ({ id: m.id, label: m.label, group: m.group, defaultLimit: moduleDailyLimit(env, m.id), limit: Object.prototype.hasOwnProperty.call(limits, m.id) ? limits[m.id] : null }));
  const usage = [];
  if (email && store) {
    const sum = deps.doctorUsageSummary || doctorUsageSummary;
    for (let i = 0; i < 7; i++) {
      try { const u = await sum(env, store, "em:" + email, now - i * DAY); usage.push({ day: u.day, req: u.req || 0, tokens: u.tokens || 0, costInr: u.estCostInr || 0, byModule: u.byModule || {} }); }
      catch (e) { /* a missing day is just zero */ }
    }
  }
  return {
    ok: true, account: row, claims: c, lifecycle: lc ? { firstSeen: lc.firstSeen || null, verifiedAt: lc.verifiedAt || null, phoneVerifiedAt: lc.phoneVerifiedAt || null, unsubscribedAt: lc.unsubscribedAt || null } : null,
    profile, verification,
    plan: ent && ent.ok ? { tier: ent.tier || "free", tierExp: ent.tierExp, role: ent.role, smdId: ent.smdId, aiCapTokens: ent.aiCapTokens, monthUsage: ent.usage || null } : null,
    // per-account feature switches (POST /api/entitlements/admin/set-flag | clear-flag)
    features: ent && ent.ok && Array.isArray(ent.features) ? ent.features : [],
    limits: modules, usage,
  };
}
