/* StewardMD — Watch-Lab API (A2, consent-gated background lab alerts).
 *
 *   GET  /api/watch/status   (Bearer Firebase idToken) -> { consented, watching:[...] }
 *   POST /api/watch/enable   (Bearer) body={ ghisUserId, ghisPassword, patient, consent:true }
 *   POST /api/watch/add      (Bearer) body={ patient }         (must already be consented)
 *   POST /api/watch/remove   (Bearer) body={ patientId }
 *   POST /api/watch/forget   (Bearer)                          (delete creds + all watches)
 *   POST /api/watch/run      (X-Admin-Token; cron only)        -> polls GHIS, pushes new labs
 *
 * Per-user endpoints require a VERIFIED Firebase ID token — the owning account is derived
 * from it, never from the client — so a doctor can only touch their own watch state and can
 * only ever receive their own patients' alerts.
 */
import { identify } from "../../_fbauth.js";
import {
  watchConfigured, saveCred, getCred, getList, addWatch, removeWatch, forget,
  getSeen, setSeen, labSignature, listWatchUids,
} from "../../_watch.js";
import { sendNativeToAll } from "../../_nativepush.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
function adminOK(request, env) {
  const want = env.UPDATES_ADMIN_TOKEN || ""; if (!want) return null;
  const got = request.headers.get("X-Admin-Token") || "";
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

// Poll GHIS for one doctor's watched patients and push on any new/changed lab.
async function runForUid(env, origin, uid) {
  const list = await getList(env, uid);
  if (!list.length) return { pushed: 0 };
  const cred = await getCred(env, uid);
  if (!cred) return { pushed: 0, noCred: true };

  // Mint a fresh GHIS session from the stored creds (the session token is NEVER stored).
  let token = null;
  try {
    const lr = await fetch(origin + "/api/ghis/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: cred.userId, password: cred.password }),
    });
    const lj = await lr.json().catch(() => ({}));
    token = lj && lj.token;
  } catch (e) { /* login failed (network / bad creds) — skip this cycle */ }
  if (!token) return { pushed: 0, loginFailed: true };

  let pushed = 0;
  for (const p of list) {
    try {
      const r = await fetch(origin + "/api/ghis/lab?patientId=" + encodeURIComponent(p.patientId), {
        headers: { "Authorization": "Bearer " + token },
      });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const sig = labSignature(j && j.orders);
      const prev = await getSeen(env, uid, p.patientId);
      if (prev === null || prev === undefined) { await setSeen(env, uid, p.patientId, sig); continue; } // baseline, no alert
      if (sig !== prev) {
        await setSeen(env, uid, p.patientId, sig);
        // No PHI/values in the push — just that something new arrived.
        await sendNativeToAll(env, {
          title: "New lab — " + (p.name || "patient"),
          body: "A new result was reported. Open StewardMD to review.",
          url: "/?ghisPatient=" + encodeURIComponent(p.patientId),
          tag: "lab-" + p.patientId,
        }, { uid });
        pushed++;
      }
    } catch (e) { /* skip this patient this cycle */ }
  }
  return { pushed };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;
  const origin = new URL(request.url).origin;

  if (!watchConfigured(env)) return json({ error: "watch-not-configured" }, 503);

  // ── cron / admin ──
  if (method === "POST" && seg === "run") {
    const ok = adminOK(request, env);
    if (ok === null) return json({ error: "admin-not-configured" }, 503);
    if (!ok) return json({ error: "unauthorised" }, 401);
    const uids = await listWatchUids(env);
    let pushed = 0, users = 0;
    for (const uid of uids) { const r = await runForUid(env, origin, uid); pushed += (r.pushed || 0); if (r.pushed) users++; }
    return json({ ok: true, users: uids.length, notifiedUsers: users, pushed });
  }

  // ── per-user (verified Firebase token) ──
  const uid = await identify(request, env);
  if (!uid) return json({ error: "auth-required" }, 401);

  if (seg === "status") {
    const [cred, list] = [await getCred(env, uid), await getList(env, uid)];
    return json({ consented: !!cred, watching: list });
  }
  if (method === "POST" && seg === "enable") {
    let b = {}; try { b = await request.json(); } catch (e) {}
    if (b.consent !== true) return json({ error: "consent-required" }, 400);
    if (!b.ghisUserId || !b.ghisPassword) return json({ error: "missing-credentials" }, 400);
    if (!b.patient || !b.patient.patientId) return json({ error: "missing-patient" }, 400);
    await saveCred(env, uid, { userId: String(b.ghisUserId), password: String(b.ghisPassword) });
    const list = await addWatch(env, uid, b.patient);
    return json({ ok: true, consented: true, watching: list });
  }
  if (method === "POST" && seg === "add") {
    if (!(await getCred(env, uid))) return json({ error: "not-consented" }, 403);
    let b = {}; try { b = await request.json(); } catch (e) {}
    if (!b.patient || !b.patient.patientId) return json({ error: "missing-patient" }, 400);
    const list = await addWatch(env, uid, b.patient);
    return json({ ok: true, watching: list });
  }
  if (method === "POST" && seg === "remove") {
    let b = {}; try { b = await request.json(); } catch (e) {}
    let list = await removeWatch(env, uid, b.patientId);
    if (!list.length) { await forget(env, uid); list = []; }   // nothing watched → drop stored creds too
    return json({ ok: true, watching: list });
  }
  if (method === "POST" && (seg === "forget" || seg === "disable")) {
    await forget(env, uid);
    return json({ ok: true, consented: false, watching: [] });
  }
  return json({ error: "not-found", seg }, 404);
}
