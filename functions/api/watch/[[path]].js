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
import { ownerOK } from "../../_adminauth.js";
import { requirePro } from "../../_entitlement.js";
import {
  watchConfigured, saveCred, getCred, getList, addWatch, removeWatch, forget,
  getSeen, setSeen, listWatchUids,
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

  let pushed = 0, delivered = 0, tokenTotal = 0;
  const ORD_RID = (o) => String((o && (o.renderId || o.orderId)) || "");
  // Does this order have RESULT VALUES yet? GHIS shows "No values recorded" for an order that has
  // only been PLACED / is processing — the value lives in the per-order DETAIL, not the order list.
  // So we alert on actual results, never on a freshly-ordered (empty) test. (This is what the client
  // does too: it fetches lab-detail and shows "No values recorded" when tests[] is empty.)
  async function orderHasValues(o) {
    try {
      const dr = await fetch(origin + "/api/ghis/lab-detail?renderId=" + encodeURIComponent(o.renderId || "") + "&episodeId=" + encodeURIComponent(o.episodeId || ""),
        { headers: { "Authorization": "Bearer " + token } });
      if (!dr.ok) return false;
      const dj = await dr.json().catch(() => ({}));
      return ((dj && dj.tests) || []).some((t) => t && String(t.result == null ? "" : t.result).trim() !== "");
    } catch (e) { return false; }
  }
  const CAP = 20;   // max detail fetches per patient per cycle — bounds the one-time baseline cost
  for (const p of list) {
    try {
      const r = await fetch(origin + "/api/ghis/lab?patientId=" + encodeURIComponent(p.patientId),
        { headers: { "Authorization": "Bearer " + token } });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const orders = (j && j.orders) || [];
      // `valued` = the set of order ids ALREADY counted as reported (have values). Persisted as JSON.
      // First sight (or a legacy string signature) → baseline: classify silently, never alert.
      let baseline = false, valued;
      try { const s = await getSeen(env, uid, p.patientId); const pj = s ? JSON.parse(s) : null; if (pj && pj.v === 2 && Array.isArray(pj.valued)) valued = new Set(pj.valued); } catch (e) {}
      if (!valued) { baseline = true; valued = new Set(); }
      // Only orders NOT already known-reported need a value check (steady state = just the new/pending ones).
      const pend = orders.filter((o) => ORD_RID(o) && !valued.has(ORD_RID(o)));
      let newly = 0;
      for (let i = 0; i < pend.length; i++) {
        if (i >= CAP) { valued.add(ORD_RID(pend[i])); continue; }        // beyond cap → mark handled (no alert); rare
        if (await orderHasValues(pend[i])) { valued.add(ORD_RID(pend[i])); if (!baseline) newly++; }
        // no values yet → leave UNvalued so a later cycle alerts once results are actually reported
      }
      await setSeen(env, uid, p.patientId, JSON.stringify({ v: 2, valued: Array.from(valued).slice(-500) }));
      if (!baseline && newly > 0) {
        // Only fires when a watched order actually GAINED values — not on a freshly-placed order.
        const d = (await sendNativeToAll(env, {
          title: "New lab — " + (p.name || "patient"),
          body: "A new result was reported. Open StewardMD to review.",
          url: "/?ghisPatient=" + encodeURIComponent(p.patientId),
          tag: "lab-" + p.patientId,
        }, { uid })) || {};
        pushed++;
        delivered += (d.sent || 0);                       // pushes APNs/FCM accepted for this account
        tokenTotal = Math.max(tokenTotal, d.total || 0);  // # of registered devices scoped to this account
      }
    } catch (e) { /* skip this patient this cycle */ }
  }
  return { pushed, delivered, hasDevice: tokenTotal > 0 };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;
  const origin = new URL(request.url).origin;

  // ── Apple Watch: acknowledge a critical result ──────────────────────────────
  // Placed BEFORE the Lab-Watch config guard so acks work even where the GHIS
  // Lab-Watch feature isn't configured. Idempotent by client key; appended to a
  // per-user audit log. Uses the cases KV (independent of Lab-Watch encryption).
  if (method === "POST" && seg === "ack") {
    const auid = await identify(request, env);
    if (!auid) return json({ error: "auth-required" }, 401);
    const store = env.CASES_KV || env.GHIS_KV || null;
    if (!store) return json({ error: "no-store" }, 501);
    let b = {}; try { b = await request.json(); } catch (e) {}
    const ackId = String(b.id || "").slice(0, 120);
    if (!ackId) return json({ error: "missing-id" }, 400);
    const key = "watchack:" + auid;
    let log = [];
    try { log = (await store.get(key, "json")) || []; } catch (e) {}
    if (log.some((a) => a.id === ackId)) return json({ ok: true, idempotent: true });
    log.push({
      id: ackId,
      labId: String(b.labId || "").slice(0, 120),
      patient: String(b.patientLabel || "").slice(0, 120),
      ackedAt: Number(b.ackedAt) || Math.floor(Date.now() / 1000),
      at: Date.now(),
    });
    log = log.slice(-500);
    await store.put(key, JSON.stringify(log));
    return json({ ok: true });
  }

  if (!watchConfigured(env)) return json({ error: "watch-not-configured" }, 503);

  // ── cron / admin ──
  if (method === "POST" && seg === "run") {
    if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
    const uids = await listWatchUids(env);
    let pushed = 0, users = 0, delivered = 0, undeliveredAccounts = 0;
    for (const uid of uids) {
      const r = await runForUid(env, origin, uid);
      pushed += (r.pushed || 0);
      delivered += (r.delivered || 0);
      if (r.pushed) { users++; if (!r.hasDevice) undeliveredAccounts++; }   // new lab detected but this account has NO registered device → alert can't land (usually a multi-account mismatch)
    }
    // pushed = new-lab detections; delivered = pushes the store accepted; undeliveredAccounts makes a
    // silent scoped-push drop VISIBLE instead of guessing.
    return json({ ok: true, users: uids.length, notifiedUsers: users, pushed, delivered, undeliveredAccounts });
  }

  // ── per-user (verified Firebase token) ──
  const uid = await identify(request, env);
  if (!uid) return json({ error: "auth-required" }, 401);

  if (seg === "status") {
    const [cred, list] = [await getCred(env, uid), await getList(env, uid)];
    return json({ consented: !!cred, watching: list });
  }
  if (method === "POST" && seg === "enable") {
    if (!(await requirePro(env, request)).ok) return json({ error: "needs-pro", needsPro: true }, 402);   // Lab Watch is Pro
    let b = {}; try { b = await request.json(); } catch (e) {}
    if (b.consent !== true) return json({ error: "consent-required" }, 400);
    if (!b.ghisUserId || !b.ghisPassword) return json({ error: "missing-credentials" }, 400);
    if (!b.patient || !b.patient.patientId) return json({ error: "missing-patient" }, 400);
    await saveCred(env, uid, { userId: String(b.ghisUserId), password: String(b.ghisPassword) });
    const list = await addWatch(env, uid, b.patient);
    return json({ ok: true, consented: true, watching: list });
  }
  if (method === "POST" && seg === "add") {
    if (!(await requirePro(env, request)).ok) return json({ error: "needs-pro", needsPro: true }, 402);   // Lab Watch is Pro
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
