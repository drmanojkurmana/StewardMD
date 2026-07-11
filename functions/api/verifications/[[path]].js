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
import { setUserClaims } from "../../_fbadmin.js";

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
const DOCTOR_PREFIX = "icu:doctor:";
const doctorKey = (uid) => DOCTOR_PREFIX + uid;
const regKey = (reg) => "icu:reg:" + String(reg).replace(/[^A-Za-z0-9]/g, "_").toUpperCase();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

// admin token check → true/false, or null when not configured
function adminOK(request, env) {
  const want = env.VERIFY_ADMIN_TOKEN || "";
  if (!want) return null;
  const got = request.headers.get("X-Admin-Token") || "";
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

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

  const ok = adminOK(request, env);
  if (ok === null) return json({ error: "admin-not-configured", detail: "set VERIFY_ADMIN_TOKEN" }, 503);
  if (!ok) return json({ error: "unauthorised" }, 401);
  if (!store) return json({ error: "no-store", detail: "CASES_KV/GHIS_KV not bound" }, 501);

  try {
    if (method === "GET") {
      const url = new URL(request.url);
      const status = url.searchParams.get("status") || "pending";
      return json({ ok: true, doctors: await listDoctors(store, status) });
    }

    if (method === "POST" && seg === "approve") {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const uid = String(body.uid || "").trim();
      if (!uid) return json({ error: "uid-required" }, 400);
      const rec = (await store.get(doctorKey(uid), "json")) || { uid };
      const regNo = String(body.regNo || rec.regNo || rec.extractedRegNo || "").trim();
      await setUserClaims(env, uid, { verified: true, regNo });
      const updated = { ...rec, uid, status: "verified", verified: true, regNo,
        approvedBy: "admin", verifiedAt: new Date().toISOString() };
      await store.put(doctorKey(uid), JSON.stringify(updated));
      if (regNo) { try { await store.put(regKey(regNo), uid); } catch (e) {} }
      return json({ ok: true, doctor: updated });
    }

    if (method === "POST" && seg === "reject") {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const uid = String(body.uid || "").trim();
      if (!uid) return json({ error: "uid-required" }, 400);
      const rec = (await store.get(doctorKey(uid), "json")) || { uid };
      // Revoke any verified claim as well.
      try { await setUserClaims(env, uid, { verified: false }); } catch (e) {}
      const updated = { ...rec, uid, status: "rejected", verified: false,
        reason: String(body.reason || "rejected_by_admin"), updatedAt: new Date().toISOString() };
      await store.put(doctorKey(uid), JSON.stringify(updated));
      return json({ ok: true, doctor: updated });
    }

    return json({ error: "bad-request", method, seg }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
