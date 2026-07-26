/* StewardMD ID Phase 2 — owner-gated entitlements admin API.
 *
 *   POST /api/entitlements/admin/lookup         {uid|smdId|email|regNo}                -> joined record
 *   POST /api/entitlements/admin/set-role       {uid|smdId|email|regNo, role}          -> write role
 *   POST /api/entitlements/admin/set-tier       {uid|smdId|email|regNo, feature, tier} -> write override
 *   POST /api/entitlements/admin/clear-override {uid|smdId|email|regNo, feature}       -> null override
 *   POST /api/entitlements/admin/set-budget     {uid|smdId|email|regNo, tokens}        -> write aiCapTokens
 *   POST /api/entitlements/admin/add-grant      {uid|smdId|email|regNo, tokens, month} -> write monthly grant
 *   POST /api/entitlements/admin/set-model      {uid|smdId|email|regNo, model, allowed}-> toggle premium model
 * (dispatch is by the LAST path segment, so the `admin/` prefix the console uses is honored.)
 *
 * Owner-gated (same OWNER_EMAILS / legacy admin-token gate as every other admin surface).
 * The handlers themselves are pure + deps-injectable (see _entitlements.js); this router
 * just authenticates, stamps the auditable `updatedBy`, and dispatches by last path segment.
 */
import { ownerOK, emailFromToken } from "../../_adminauth.js";
import { adminLookup, adminSetRole, adminSetTier, adminClearOverride, adminSetBudget, adminAddGrant, adminSetModel } from "../../_entitlements.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!(await ownerOK(request, env))) return json({ ok: false, error: "forbidden" }, 403);
  const route = (params && params.path) || [];
  const seg = Array.isArray(route) ? route[route.length - 1] : route;   // .../admin/<seg>
  let body = {}; try { body = await request.json(); } catch (e) {}
  // stamp who made the change for the audit trail
  try { body.updatedBy = emailFromToken((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")) || null; } catch (e) {}
  if (seg === "lookup") return json(await adminLookup(env, body));
  if (seg === "set-role") return json(await adminSetRole(env, body));
  if (seg === "set-tier") return json(await adminSetTier(env, body));
  if (seg === "clear-override") return json(await adminClearOverride(env, body));
  if (seg === "set-budget") return json(await adminSetBudget(env, body));
  if (seg === "add-grant") return json(await adminAddGrant(env, body));
  if (seg === "set-model") return json(await adminSetModel(env, body));
  return json({ ok: false, error: "not_found" }, 404);
}
