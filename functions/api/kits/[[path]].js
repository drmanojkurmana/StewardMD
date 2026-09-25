/* StewardMD - /api/kits/* : the server side of the specialty kits (wave 2). Logic and rules live in
 * functions/_kits_share.js; this file only authenticates, rate-limits and dispatches.
 *
 *   GET  /api/kits/status              { enabled, signedIn, verified }
 *   POST /api/kits/msg/send            referral or handover to a verified colleague (B1, B3)
 *   GET  /api/kits/msg/list            inbox + sent (metadata only)
 *   POST /api/kits/msg/read|status     open one (marks it seen) / accept, decline, acknowledge, withdraw
 *   POST /api/kits/case/create|read|post|invite|close,  GET /api/kits/case/list   (B2)
 *   GET  /api/kits/unit?kit=<id>       the caller's hospitals' versions of a kit (B7)
 *   POST /api/kits/unit/publish|retire
 *   POST /api/kits/hist/add|read|forget   per-patient kit history (E3, E4); patient id only in the body
 *   POST /api/kits/reviews             review-desk decisions (F1);  GET /api/kits/reviews/all (owner)
 *
 * Off unless env KITS_SHARE_ON = "1" (404 { error: "disabled" }), so merging this changes nothing until
 * the owner turns it on. Caller identity is the verified Firebase ID token only (verifiedClaimsFor),
 * never the Cf-Access email header. Errors are { error: code }; nothing clinical is logged.
 */
import { verifiedClaimsFor } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import * as FS from "../../_fbfirestore.js";
import { resolveUid } from "../../_entitlements.js";
import { getUserClaims } from "../../_fbadmin.js";
import { listOrgsForMember, listOrgsForOwner } from "../../_opd_org_store.js";
import { sendNativeToAll } from "../../_nativepush.js";
import { hitLimit } from "../../_ratelimit.js";
import { ROUTES, reviewsAll } from "../../_kits_share.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function makeDeps(env, waitUntil) {
  const rl = env.CASES_KV || env.GHIS_KV || env.MAIK_KV || null;
  return {
    fsGet: (p) => FS.fsGet(env, p), fsBatchGet: (ps) => FS.fsBatchGet(env, ps), fsQuery: (c, o) => FS.fsQuery(env, c, o), fsCommit: (w) => FS.fsCommit(env, w),
    wCreate: (p, f) => FS.wCreate(env, p, f), wUpdate: (p, f, o) => FS.wUpdate(env, p, f, o), wDelete: (p) => FS.wDelete(env, p),
    resolveUid: (ident) => resolveUid(env, ident), getClaims: (uid) => getUserClaims(env, uid).catch(() => ({})),
    listOrgsForMember: (ids) => listOrgsForMember(env, ids).catch(() => []), listOrgsForOwner: (uid) => listOrgsForOwner(env, uid).catch(() => []),
    push: (uid, msg) => sendNativeToAll(env, msg, { uid: "fb:" + uid }),
    hitLimit: (bucket, id, limit, win) => hitLimit(rl, "kx-" + bucket, id, limit, win, waitUntil)
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const waitUntil = context.waitUntil ? (p) => context.waitUntil(p) : null;
  const path = (Array.isArray(params.path) ? params.path.join("/") : String(params.path || "")).replace(/\/+$/, "").slice(0, 60);
  const method = request.method;
  if (String(env.KITS_SHARE_ON || "") !== "1") return json({ enabled: false, error: "disabled" }, 404);

  const claims = await verifiedClaimsFor(request, env);
  const uid = claims && typeof claims === "object" && typeof claims.sub === "string" ? claims.sub : "";
  if (method === "GET" && path === "status") return json({ enabled: true, signedIn: !!uid, verified: !!(claims && claims.verified === true) });

  if (method === "GET" && path === "reviews/all") {
    if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);
    const r = await reviewsAll({ env, uid, claims, deps: makeDeps(env, waitUntil), now: Date.now(), waitUntil });
    return json(r.body, r.status);
  }
  if (!uid) return json({ error: "auth_required" }, 401);

  const handler = ROUTES[method + " " + path];
  if (!handler) return json({ error: "not_found" }, 404);
  let body = {};
  if (method === "POST") {
    // Measured on the text, not Content-Length (absent on chunked bodies): every doc must stay far
    // below Firestore's 1 MiB limit, and nothing a doctor types needs more than this.
    let txt = ""; try { txt = await request.text(); } catch (e) { return json({ error: "bad_json" }, 400); }
    if (txt.length > 64000) return json({ error: "too_large" }, 413);
    try { body = JSON.parse(txt); } catch (e) { return json({ error: "bad_json" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "bad_json" }, 400);
  } else {
    const u = new URL(request.url); u.searchParams.forEach((v, k) => { body[k] = v; });
  }
  try {
    const r = await handler({ env, uid, claims, deps: makeDeps(env, waitUntil), now: Date.now(), waitUntil }, body);
    return json(r.body, r.status);
  } catch (e) {
    try { console.warn("[kits] server error", String((e && e.message) || e).slice(0, 120)); } catch (_e) {}
    return json({ error: "server_error" }, 500);
  }
}
