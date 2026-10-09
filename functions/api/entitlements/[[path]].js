/* StewardMD ID Phase 2 — owner-gated entitlements admin API.
 *
 *   POST /api/entitlements/admin/lookup         {uid|smdId|email|regNo}                -> joined record
 *   POST /api/entitlements/admin/set-role       {uid|smdId|email|regNo, role}          -> write role
 *   POST /api/entitlements/admin/set-plan       {uid|smdId|email|regNo, tier, days|expiresAt|forever} -> purchase tier (incl. ultimate)
 *   POST /api/entitlements/admin/ultimate-migration {dryRun?, uids?}                   -> list, then convert Pro holders to ultimate
 *   POST /api/entitlements/admin/set-tier       {uid|smdId|email|regNo, feature, tier} -> write override
 *   POST /api/entitlements/admin/clear-override {uid|smdId|email|regNo, feature}       -> null override
 *   POST /api/entitlements/admin/set-budget     {uid|smdId|email|regNo, tokens}        -> write aiCapTokens
 *   POST /api/entitlements/admin/add-grant      {uid|smdId|email|regNo, tokens, month} -> write monthly grant
 *   POST /api/entitlements/admin/set-model      {uid|smdId|email|regNo, model, allowed}-> toggle premium model
 *   POST /api/entitlements/admin/set-flag       {uid|smdId|email|regNo, feature, enabled}-> write explicit feature flag
 *   POST /api/entitlements/admin/clear-flag     {uid|smdId|email|regNo, feature}       -> delete explicit feature flag
 * (dispatch is by the LAST path segment, so the `admin/` prefix the console uses is honored.)
 *
 * PrepNucleus Pro (signed-in user, Firebase ID token; NOT owner-gated; see functions/_prep_pro.js):
 *   GET  /api/entitlements                      -> { prepPro:{active,until,source,autoRenews,manageUrl} }
 *   GET  /api/entitlements/prep-quote[?plan=year] -> see prepQuote() in _prep_pro.js (best single first-year price)
 *   GET  /api/entitlements/prep-offer           -> { offer:null } | { offer:{kind:"winback",...} } (first GET starts 48 h)
 *   POST /api/entitlements/prep-offer/dismiss   -> { ok:true } (ends the offer forever)
 *   POST /api/entitlements/prep-referral {code} -> { ok:true[, already] } | { ok:false, error }
 *
 * Owner-gated (same OWNER_EMAILS / legacy admin-token gate as every other admin surface).
 * The handlers themselves are pure + deps-injectable (see _entitlements.js); this router
 * just authenticates, stamps the auditable `updatedBy`, and dispatches by last path segment.
 */
import { ownerOK, emailFromToken } from "../../_adminauth.js";
import { identify } from "../../_fbauth.js";
import { getPrepRecord, prepProView, quoteFor, getOffer, dismissOffer, recordReferral } from "../../_prep_pro.js";
import { adminLookup, adminSetRole, adminSetTier, adminClearOverride, adminSetBudget, adminAddGrant, adminSetModel, adminSetFlag, adminClearFlag, adminSetPlan, adminUltimateMigration } from "../../_entitlements.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Firebase uid of the caller, or null (CF Access / owner identities are not shoppers).
async function prepUid(request, env) {
  const id = await identify(request, env);
  return typeof id === "string" && id.indexOf("fb:") === 0 ? id.slice(3) : null;
}
const lastSeg = (params) => { const r = (params && params.path) || []; return Array.isArray(r) ? (r[r.length - 1] || "") : r; };

export async function onRequestGet(context) {
  const { request, env, params } = context;
  try {
    const uid = await prepUid(request, env);
    if (!uid) return json({ ok: false, error: "signin-required" }, 401);
    const seg = lastSeg(params);
    if (!seg) return json({ prepPro: prepProView(await getPrepRecord(env, uid), Date.now(), env) });
    if (seg === "prep-quote") return json(await quoteFor(env, uid));   // one plan (year); ?plan is accepted and ignored
    if (seg === "prep-offer") return json(await getOffer(env, uid));
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) { return json({ ok: false, error: "server_error" }, 500); }
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const pseg = lastSeg(params), pparts = (params && params.path) || [];
  if (pseg === "prep-referral" || (pseg === "dismiss" && pparts[0] === "prep-offer")) {
    try {
      const uid = await prepUid(request, env);
      if (!uid) return json({ ok: false, error: "signin-required" }, 401);
      if (pseg === "dismiss") return json(await dismissOffer(env, uid));
      let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
      const r = await recordReferral(env, uid, b.code);
      const st = r.status || 200; delete r.status;
      return json(r, st);
    } catch (e) { return json({ ok: false, error: "server_error" }, 500); }
  }
  if (!(await ownerOK(request, env))) return json({ ok: false, error: "forbidden" }, 403);
  /* Owner-only, so the real reason is returned (owner, 2026-10-09: User control showed a bare "Failed: 500").
   * An uncaught throw (a Firestore commit, a claims write) used to escape as the platform's HTML 500 with
   * no reason anywhere the owner could see. The detail is Google's error text: no patient data. */
  try { return await adminPost(context); }
  catch (e) {
    try { console.warn("[entitlements] admin error", String((e && (e.code || e.message)) || e), e && e.status, String((e && e.detail) || "").slice(0, 200)); } catch (x) {}
    return json({ ok: false, error: (e && e.code) || "server_error", status: (e && e.status) || null, detail: String((e && (e.detail || e.message)) || "").slice(0, 300) }, 500);
  }
}
async function adminPost(context) {
  const { request, env, params } = context;
  const route = (params && params.path) || [];
  const seg = Array.isArray(route) ? route[route.length - 1] : route;   // .../admin/<seg>
  let body = {}; try { body = await request.json(); } catch (e) {}
  // stamp who made the change for the audit trail
  try { body.updatedBy = emailFromToken((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")) || null; } catch (e) {}
  if (seg === "lookup") return json(await adminLookup(env, body));
  if (seg === "set-role") return json(await adminSetRole(env, body));
  if (seg === "set-plan") return json(await adminSetPlan(env, body));
  if (seg === "ultimate-migration") return json(await adminUltimateMigration(env, body));
  if (seg === "set-tier") return json(await adminSetTier(env, body));
  if (seg === "clear-override") return json(await adminClearOverride(env, body));
  if (seg === "set-budget") return json(await adminSetBudget(env, body));
  if (seg === "add-grant") return json(await adminAddGrant(env, body));
  if (seg === "set-model") return json(await adminSetModel(env, body));
  if (seg === "set-flag") return json(await adminSetFlag(env, body));
  if (seg === "clear-flag") return json(await adminClearFlag(env, body));
  return json({ ok: false, error: "not_found" }, 404);
}
