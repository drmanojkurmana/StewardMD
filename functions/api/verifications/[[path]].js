/* StewardMD — Admin: doctor verifications (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:  functions/api/verifications/[[path]].js  ->  /api/verifications/*
 *
 * Owner-only management of doctor verifications (the admin/verifications.html UI).
 * Token-gated exactly like functions/api/updates (X-Admin-Token vs a Pages secret).
 *
 *   GET  /api/verifications?status=pending|verified|all   → list doctor records
 *   POST /api/verifications/approve  {uid, regNo}         → set verified claim + mark verified
 *   POST /api/verifications/reject   {uid, reason}        → mark rejected
 *
 * Storage: reuses CASES_KV / GHIS_KV, keys "icu:doctor:<uid>" (written by verify-doctor).
 * Secret:  VERIFY_ADMIN_TOKEN
 * ---------------------------------------------------------------------------
 */
import { mergeUserClaims } from "../../_fbadmin.js";
import { clearBudgetCache } from "../../_aibudget.js";
import { emailVerified, emailFailed } from "../../_email.js";
import { markVerified, sendProUpsellOnce } from "../../_lifecycle.js";
import { verifyFirebaseToken } from "../../_fbauth.js";

// Owners who may manage verifications (by Google account email). Override via env.OWNER_EMAILS
// (comma-separated). Kept in sync with the intent of the app's team allowlist.
// Kept in step with functions/_adminauth.js: stewardmd.in@gmail.com is a CUSTOMER account, not a
// platform owner, so it must not be able to approve doctors' NMC verifications either.
const OWNER_EMAILS_DEFAULT = ["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com"];
function ownerEmails(env) {
  return (env.OWNER_EMAILS ? String(env.OWNER_EMAILS).split(",") : OWNER_EMAILS_DEFAULT)
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function emailFromToken(idToken) {
  try {
    const p = String(idToken).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), (c) => c.charCodeAt(0)))).email || "").toLowerCase();
  } catch (e) { return ""; }
}

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
const DOCTOR_PREFIX = "icu:doctor:";
const doctorKey = (uid) => DOCTOR_PREFIX + uid;
const regKey = (reg) => "icu:reg:" + String(reg).replace(/[^A-Za-z0-9]/g, "_").toUpperCase();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

// Legacy admin-token check (kept as a fallback) → true/false, or null when not configured.
function tokenOK(request, env) {
  const want = env.VERIFY_ADMIN_TOKEN || "";
  if (!want) return null;
  const got = request.headers.get("X-Admin-Token") || "";
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

// Authorised = an OWNER signed in with Google (Authorization: Bearer <Firebase ID token>,
// email in the owner allowlist), OR the legacy admin token. Returns
// { ok, who } — who is the email/'token' for logging, or "" if unauthorised.
async function authOK(request, env) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer) {
    const uid = await verifyFirebaseToken(bearer, env);
    if (uid) {
      const email = emailFromToken(bearer);
      if (email && ownerEmails(env).indexOf(email) > -1) return { ok: true, who: email };
      return { ok: false, who: email || "signed-in" };  // valid Google user but not an owner
    }
  }
  if (tokenOK(request, env) === true) return { ok: true, who: "token" };
  return { ok: false, who: "" };
}

// HMAC verify for one-click email action links (uid|action signed with VERIFY_ADMIN_TOKEN).
async function actionSigOK(env, uid, action, sig) {
  const want = env.VERIFY_ADMIN_TOKEN || "";
  if (!want || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(want), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(uid + "|" + action)));
  const expect = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  if (expect.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < expect.length; i++) d |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

async function doApprove(store, env, uid, regNo) {
  const rec = (await store.get(doctorKey(uid), "json")) || { uid };
  const reg = String(regNo || rec.regNo || rec.extractedRegNo || "").trim();
  // verifiedAt starts the free Pro week; provUntil is cleared because the review is over.
  await mergeUserClaims(env, uid, { verified: true, verifiedAt: Date.now(), provUntil: null, regNo: reg });   // merge: keep any existing pro claim
  try { await clearBudgetCache(env, uid); } catch (e) {}   // tier changed; the cap is cached ~26h
  try { if (rec.photoKey && env.FOLLOWCARE_R2) await env.FOLLOWCARE_R2.delete(rec.photoKey); } catch (e) {}   // purge the review photo on decision
  const updated = { ...rec, uid, status: "verified", verified: true, regNo: reg, photoKey: "", approvedBy: "admin", verifiedAt: new Date().toISOString() };
  await store.put(doctorKey(uid), JSON.stringify(updated));
  if (reg) { try { await store.put(regKey(reg), uid); } catch (e) {} }
  try { await emailVerified(env, { email: rec.email, name: rec.name || rec.firstName, regNo: reg, council: rec.council }); } catch (e) {}
  try { await markVerified(env, uid); await sendProUpsellOnce(env, uid, { email: rec.email, name: rec.name || rec.firstName }); } catch (e) {}
  return updated;
}
async function doReject(store, env, uid, reason) {
  const rec = (await store.get(doctorKey(uid), "json")) || { uid };
  // Clear the free-week start and any pending grant too, or a rejected account keeps Pro.
  try { await mergeUserClaims(env, uid, { verified: false, verifiedAt: null, provUntil: null }); } catch (e) {}   // merge: revoke verified only, keep pro
  try { if (rec.photoKey && env.FOLLOWCARE_R2) await env.FOLLOWCARE_R2.delete(rec.photoKey); } catch (e) {}   // purge the review photo on decision
  // Clear provisional so the client gate forces a fresh upload.
  const updated = { ...rec, uid, status: "rejected", verified: false, provisionalUntil: "", photoKey: "", reason: String(reason || "rejected_by_admin"), updatedAt: new Date().toISOString() };
  await store.put(doctorKey(uid), JSON.stringify(updated));
  try { await emailFailed(env, { email: rec.email, name: rec.name || rec.firstName, reason: updated.reason }); } catch (e) {}
  return updated;
}
const htmlPage = (title, body) => new Response(
  `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:500 16px system-ui;background:#0f1b24;color:#f6f7f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center"><div style="max-width:440px;padding:28px"><h2 style="margin:0 0 10px">${title}</h2><p style="color:#9fb0bd;line-height:1.5">${body}</p></div>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
);

async function listDoctors(store, statusFilter) {
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix: DOCTOR_PREFIX, cursor });
    for (const k of page.keys) {
      const rec = await store.get(k.name, "json");
      if (!rec) continue;
      const st = rec.status || (rec.verified ? "verified" : "unverified");
      if (statusFilter === "all" || st === statusFilter) out.push({ ...rec, status: st });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  // pending first, then newest
  out.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return String(b.updatedAt || b.verifiedAt || "").localeCompare(String(a.updatedAt || a.verifiedAt || ""));
  });
  return out;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;
  const store = kv(env);
  if (method === "OPTIONS") return new Response(null, { status: 204 });

  // ── One-click email action links (GET, HMAC-signed — no admin token needed) ──
  if (method === "GET" && seg === "action") {
    if (!store) return htmlPage("Unavailable", "Storage is not configured.");
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid") || "";
    const doWhat = url.searchParams.get("do") || "";
    const sig = url.searchParams.get("sig") || "";
    const reg = url.searchParams.get("reg") || "";
    if (!(await actionSigOK(env, uid, doWhat, sig))) return htmlPage("Invalid or expired link", "This action link could not be verified. Open the admin page instead.");
    try {
      if (doWhat === "approve") { const d = await doApprove(store, env, uid, reg); return htmlPage("✓ Doctor verified", `${d.email || uid} now has full access${d.regNo ? " (" + d.regNo + ")" : ""}. They'll see it on next sign-in.`); }
      if (doWhat === "reject")  { await doReject(store, env, uid); return htmlPage("Access blocked", "This account is blocked until the doctor uploads a valid certificate again."); }
      return htmlPage("Unknown action", "Nothing to do.");
    } catch (e) { return htmlPage("Something went wrong", "Please try again in a moment."); }
  }

  const auth = await authOK(request, env);
  if (!auth.ok) return json({ error: "unauthorised", detail: auth.who ? "not an owner account" : "sign in as an owner" }, 401);
  if (!store) return json({ error: "no-store", detail: "CASES_KV/GHIS_KV not bound" }, 501);

  try {
    // Owner-gated: stream the uploaded proof photo for the review dashboard (no-store).
    if (method === "GET" && seg === "photo") {
      const url = new URL(request.url);
      const uid = String(url.searchParams.get("uid") || "").trim();
      if (!uid) return json({ error: "uid-required" }, 400);
      const rec = (await store.get(doctorKey(uid), "json")) || {};
      const key = rec.photoKey || ("verify/" + uid);
      if (!env.FOLLOWCARE_R2) return json({ error: "no-bucket" }, 501);
      const obj = await env.FOLLOWCARE_R2.get(key);
      if (!obj) return json({ error: "not-found" }, 404);
      return new Response(obj.body, { headers: {
        "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || rec.photoMime || "image/jpeg",
        "Cache-Control": "no-store",
      } });
    }

    if (method === "GET") {
      const url = new URL(request.url);
      const status = url.searchParams.get("status") || "pending";
      return json({ ok: true, doctors: await listDoctors(store, status) });
    }

    if (method === "POST" && seg === "approve") {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const uid = String(body.uid || "").trim();
      if (!uid) return json({ error: "uid-required" }, 400);
      return json({ ok: true, doctor: await doApprove(store, env, uid, body.regNo) });
    }

    if (method === "POST" && seg === "reject") {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const uid = String(body.uid || "").trim();
      if (!uid) return json({ error: "uid-required" }, 400);
      return json({ ok: true, doctor: await doReject(store, env, uid, body.reason) });
    }

    return json({ error: "bad-request", method, seg }, 400);
  } catch (e) {
    { try { console.warn("[api] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {} return json({ error: "server_error" }, 500); }
  }
}
