/* StewardMD - the free Pro week is once per DOCTOR, not once per account.
 *
 * Owner request 2026-09-26: "7 days free trial is one time and once per number verification ...
 * same device id no second trial. use device id/imei, ip address, old signout account already pro
 * new sign in again creating pro trial dont activate." Plan: vault/plans/One-Time-Trial.md.
 *
 * Every door that starts a free week (verify-doctor auto-verify, the pending-review grant, the
 * owner's approve, "Skip for now") asks gateTrial() first. It fingerprints what the request can
 * prove and looks each one up in a permanent ledger:
 *
 *   trial:used:<kind>:<hmac>  -> { uid, at, door }   kind = reg | phone | hw | ls
 *   trial:ip:<hmac>           -> { n, uids[] }       30-day counter, a SIGNAL, never a block
 *   trial:uid:<uid>           -> { at, door }        when THIS account's week first started
 *
 * A hard fingerprint (reg, phone, hw) already held by a DIFFERENT uid denies the week. The same
 * uid always passes (reinstall, second phone, sign out and back in). `ls` (the localStorage device
 * id, lost on reinstall) and `ip` (hospital wifi, mobile CGNAT) are soft: recorded, logged, never
 * decisive. IMEI is not readable by apps on Android 10+ or iOS, so `hw` is ANDROID_ID / the iOS
 * device id from @capacitor/device when the native build has it.
 *
 * Values are HMAC-SHA256'd with TRIAL_PEPPER, so the ledger holds no phone or registration number
 * and a 10-digit phone cannot be brute-forced back out of it. No pepper = the ledger is off.
 *
 * TRIAL_ONCE_ON (KV flag via cfgFlag, no deploy): "1" enforce, "shadow" record + log would-be
 * denials without denying, anything else off (today's behaviour exactly). Default off.
 *
 * The ledger is never purged: _lifecycle.js purge removes the account, the ledger is the tombstone.
 */
import { cfgFlag, warmBillingCfg } from "./_billingcfg.js";
import { normalizePhone } from "./_phone_otp.js";

export const HARD = ["reg", "phone", "hw"];
export const IP_TTL = 30 * 86400;

export function trialOnceMode(env) {
  const v = String(cfgFlag(env, "TRIAL_ONCE_ON") == null ? "" : cfgFlag(env, "TRIAL_ONCE_ON")).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return "on";
  if (v === "shadow") return "shadow";
  return "off";
}

// The flag lives in the owner-editable billing config (KV, 30 s cache). Warm it before reading so
// a flip from /admin takes effect without a deploy, in every route that gates a trial.
export async function warmTrialMode(env) {
  try { await warmBillingCfg(env && env.MAIK_KV); } catch (e) {}
  return trialOnceMode(env);
}

export function ledgerStore(env) { return (env && (env.CASES_KV || env.GHIS_KV)) || null; }

// Normalisers: two spellings of the same thing must hash the same.
export function normReg(r) { return String(r || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
// Same rules as the OTP route (India-first: a bare 10-digit number gets 91), so the number the
// doctor typed and the E.164 one on the lifecycle record are one fingerprint.
export function normPhone(p) { return normalizePhone(p, "91"); }
// "hw-<id>" is a native hardware id (hard); "dev-<uuid>" is the localStorage fallback (soft).
export function normDevice(d) {
  const s = String(d || "").trim().slice(0, 200);
  if (/^hw-.{6,}$/.test(s)) return { kind: "hw", v: s.slice(3) };
  if (/^dev-.{6,}$/.test(s)) return { kind: "ls", v: s.slice(4) };
  return null;
}
// An IPv4 /24 or IPv6 /64: one household or ward, not one person.
export function ipBucket(ip) {
  const s = String(ip || "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split(".").slice(0, 3).join(".") + ".0/24";
  if (s.indexOf(":") > -1) {
    const full = s.split("::");
    const head = full[0].split(":").filter(Boolean);
    const tail = full.length > 1 ? full[1].split(":").filter(Boolean) : [];
    const groups = head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), tail);
    return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  return "";
}

async function hmac(pepper, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// -> [{ kind, key }]. Nothing raw leaves this function.
export async function fingerprints(pepper, { regNo, phone, device, ip } = {}) {
  if (!pepper) return [];
  const out = [];
  const r = normReg(regNo); if (r) out.push({ kind: "reg", key: "trial:used:reg:" + await hmac(pepper, "reg|" + r) });
  const p = normPhone(phone); if (p) out.push({ kind: "phone", key: "trial:used:phone:" + await hmac(pepper, "phone|" + p) });
  const d = normDevice(device); if (d) out.push({ kind: d.kind, key: "trial:used:" + d.kind + ":" + await hmac(pepper, d.kind + "|" + d.v) });
  const b = ipBucket(ip); if (b) out.push({ kind: "ip", key: "trial:ip:" + await hmac(pepper, "ip|" + b) });
  return out;
}

// -> { ok, hit?, soft[] }. ok:false only when a HARD fingerprint belongs to another uid.
export async function checkTrial(store, uid, fps) {
  const soft = [];
  let hit = null;
  for (const f of fps || []) {
    let rec = null;
    try { rec = await store.get(f.key, "json"); } catch (e) {}
    if (!rec) continue;
    if (f.kind === "ip") { const others = (rec.uids || []).filter((u) => u !== uid).length; if (others) soft.push("ip:" + others); continue; }
    if (rec.uid === uid) continue;
    if (HARD.indexOf(f.kind) > -1) { if (!hit) hit = f.kind; }
    else soft.push(f.kind);
  }
  return hit ? { ok: false, hit, soft } : { ok: true, soft };
}

// Record the fingerprints as this uid's. Never takes a row owned by another uid. `except` lists
// kinds not to record (a TYPED, unverified reg number must not be able to poison the ledger for
// the real doctor who owns it).
export async function consumeTrial(store, uid, fps, door, except, markUid) {
  const at = Date.now();
  for (const f of fps || []) {
    if (except && except.indexOf(f.kind) > -1) continue;
    try {
      if (f.kind === "ip") {
        const cur = (await store.get(f.key, "json")) || { n: 0, uids: [] };
        if ((cur.uids || []).indexOf(uid) < 0) { cur.uids = (cur.uids || []).concat(uid).slice(-50); cur.n = (cur.n || 0) + 1; }
        await store.put(f.key, JSON.stringify(cur), { expirationTtl: IP_TTL });
        continue;
      }
      const cur = await store.get(f.key, "json");
      if (cur && cur.uid && cur.uid !== uid) continue;
      if (!cur) await store.put(f.key, JSON.stringify({ uid, at, door: String(door || "") }));
    } catch (e) {}
  }
  if (markUid === false) return;
  try { if (!(await store.get("trial:uid:" + uid))) await store.put("trial:uid:" + uid, JSON.stringify({ at, door: String(door || "") })); } catch (e) {}
}

// When this account's free week FIRST started (ms), or 0. A reject -> re-approve, a claim heal or
// a backfill reuses it, so no path restarts the week for the same account.
export async function firstGrantAt(store, uid) {
  if (!store || !uid) return 0;
  try { const r = await store.get("trial:uid:" + uid, "json"); return (r && +r.at) || 0; } catch (e) { return 0; }
}

export function requestSignals(request) {
  const h = (request && request.headers) || { get: () => "" };
  return {
    device: h.get("X-SMD-HW") || h.get("X-SMD-Device") || "",
    // CF-Connecting-IP only: X-Forwarded-For is client-supplied.
    ip: h.get("CF-Connecting-IP") || "",
  };
}

/* The one call every door makes.
 *   input  { regNo, phone, device, ip }
 *   opts   { door, noConsume:["reg"], store, pepper }
 * -> { grant:true } | { grant:false, hit } ; `mode` and `wouldDeny` for the caller's log.
 * off    -> always grant, touches nothing.
 * shadow -> always grant, records the fingerprints, logs a would-be denial.
 * on     -> denies on a hard hit; records on grant. */
export async function gateTrial(env, uid, input, opts) {
  opts = opts || {};
  const mode = await warmTrialMode(env);
  const store = opts.store || ledgerStore(env);
  const pepper = opts.pepper || (env && env.TRIAL_PEPPER) || "";
  if (mode === "off" || !store || !pepper || !uid) return { grant: true, mode };
  let fps = [];
  try { fps = await fingerprints(pepper, input || {}); } catch (e) { return { grant: true, mode }; }
  // Fingerprints captured earlier (the device/IP of the upload, kept on the review record for the
  // owner's approve, which has no device of its own).
  for (const f of (opts.extraFps || [])) if (f && f.key && !fps.some((x) => x.key === f.key)) fps.push(f);
  const c = await checkTrial(store, uid, fps);
  try { console.log("[trial-once]", mode, String(opts.door || ""), c.ok ? "clean" : "hit:" + c.hit, c.soft.length ? "soft:" + c.soft.join(",") : ""); } catch (e) {}
  if (!c.ok && mode === "on") return { grant: false, hit: c.hit, mode, fps };
  if (opts.consume !== false) await consumeTrial(store, uid, fps, opts.door, opts.noConsume, opts.markUid);
  return { grant: true, mode, wouldDeny: !c.ok ? c.hit : null, fps };
}

// Record-only: remember a fingerprint for an account that ALREADY holds a week (a phone verified
// after the doctor was), so the next account on that number is caught. Returns the hit, if any.
export async function noteFingerprint(env, uid, input, door) {
  const mode = await warmTrialMode(env);
  const store = ledgerStore(env), pepper = (env && env.TRIAL_PEPPER) || "";
  if (mode === "off" || !store || !pepper || !uid) return { mode, hit: null };
  const fps = await fingerprints(pepper, input || {});
  const c = await checkTrial(store, uid, fps);
  await consumeTrial(store, uid, fps, door, null, false);
  return { mode, hit: c.ok ? null : c.hit };
}

/* Owner one-shot: seed the ledger from everyone who already had a week, so current users cannot
 * farm a second one the day enforcement starts. Reg rows come from icu:reg:<REG> -> uid (verified,
 * register-matched); phones from lifecycle:u:<uid>.phone (OTP-verified). Idempotent. */
export async function backfillLedger(env, { store, lifecycleStore, pepper, limit } = {}) {
  store = store || ledgerStore(env);
  pepper = pepper || (env && env.TRIAL_PEPPER) || "";
  if (!store || !pepper) return { ok: false, error: !pepper ? "no-pepper" : "no-store" };
  const out = { ok: true, reg: 0, phone: 0 };
  const hadWeek = new Set();   // phones are seeded only for accounts that verified (so had a week)
  const max = limit || 100000;
  let cursor;
  do {
    const page = await store.list({ prefix: "icu:reg:", cursor });
    for (const k of page.keys) {
      if (out.reg >= max) break;
      const uid = await store.get(k.name);
      if (!uid) continue;
      const reg = k.name.slice("icu:reg:".length);
      hadWeek.add(uid);
      await consumeTrial(store, uid, await fingerprints(pepper, { regNo: reg }), "backfill", null, false);
      out.reg++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.reg < max);
  const lc = lifecycleStore || (env && (env.MAIK_KV || env.GHIS_KV || env.UPDATES_KV));
  if (lc) {
    cursor = undefined;
    do {
      const page = await lc.list({ prefix: "lifecycle:u:", cursor });
      for (const k of page.keys) {
        if (out.phone >= max) break;
        let rec = null; try { rec = await lc.get(k.name, "json"); } catch (e) {}
        if (!rec || !rec.phone || !rec.phoneVerifiedAt) continue;
        const uid = k.name.slice("lifecycle:u:".length);
        if (!hadWeek.has(uid)) continue;
        await consumeTrial(store, uid, await fingerprints(pepper, { phone: rec.phone }), "backfill", null, false);
        out.phone++;
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && out.phone < max);
  }
  return out;
}

/* The claim patch for a door that would start the verified free week (auto-verify, owner approve).
 * `claims` = the account's current custom claims. Never restarts a week this account already had:
 *   verifiedAt already set          -> {}                      (keep it)
 *   trialDenied already set         -> {}                      (stays denied)
 *   ledger clean                    -> { verifiedAt: first-grant time or now }
 *   ledger hit (mode on)            -> { trialDenied: now }    (verified, but no free week) */
export async function weekPatch(env, uid, claims, input, opts) {
  claims = claims || {};
  const mode = await warmTrialMode(env);
  // off and shadow write exactly what they always did (a fresh verifiedAt); shadow also records.
  if (mode !== "on") { if (mode === "shadow") await gateTrial(env, uid, input, opts); return { verifiedAt: Date.now() }; }
  if (claims.verifiedAt || claims.trialDenied) return {};
  const store = (opts && opts.store) || ledgerStore(env);
  const g = await gateTrial(env, uid, input, opts);
  if (!g.grant) return { trialDenied: Date.now(), provUntil: null };
  const first = g.mode === "on" ? await firstGrantAt(store, uid) : 0;
  return { verifiedAt: first && first < Date.now() ? first : Date.now() };
}

/* A phone verified AFTER the account already holds a free week (verified or pending). Records the
 * number as this account's; if another account already had a week on it (mode on), the free week
 * here ends: -> { trialDenied, provUntil:null } to merge, else {}. A paid claim or an owner is never
 * touched, and nothing else about the account changes (it stays verified). */
export async function phoneTrialPatch(env, uid, phone, claims, request, opts) {
  claims = claims || {};
  const now = Date.now();
  // Only an account that HOLDS a week can own a fingerprint. Otherwise a free-plan account would
  // "own" the number and deny the real doctor later. Accounts without a week are read at grant time.
  const hasWeek = !!(claims.verifiedAt || (claims.provUntil && +claims.provUntil > now));
  if (!hasWeek || claims.trialDenied) return {};
  const r = await noteFingerprint(env, uid, { phone, ...requestSignals(request) }, "phone");
  if (r.mode !== "on" || !r.hit) return {};
  const paid = claims.pro === true && (!claims.proExp || +claims.proExp > now);
  if (paid || (opts && opts.owner)) return {};
  return { trialDenied: now, provUntil: null };
}
