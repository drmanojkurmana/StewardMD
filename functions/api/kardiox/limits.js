/* /api/kardiox/limits — KardiQ X training-quota admin, OWNER-ONLY.
 * Auth = the same Google owner login as every other admin surface (ownerOK -> Firebase ID token whose
 * email ∈ OWNER_EMAILS, incl. drmanojkurmana@gmail.com). NO manual token for the owner. This function
 * proxies to the kardiox-image Cloud Run admin API using a SERVER-SIDE token (env KARDIOX_ADMIN_TOKEN),
 * which never reaches the browser. GET = usage/config/cost; POST = set monthlyLimit / exempt list. */
import { ownerOK } from "../../_adminauth.js";

const SVC = "https://kardiox-image-911280405587.asia-south1.run.app/v1/admin/limits";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!(await ownerOK(request, env))) return J({ error: "unauthorised — owner login required" }, 401);
  try {
    const r = await fetch(SVC, { headers: { "X-Admin-Token": env.KARDIOX_ADMIN_TOKEN || "" } });
    return J(await r.json().catch(() => ({})), r.status);
  } catch (e) { return J({ error: "service unreachable" }, 502); }
}
export async function onRequestPost({ request, env }) {
  if (!(await ownerOK(request, env))) return J({ error: "unauthorised — owner login required" }, 401);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const fd = new FormData();
  if (b.monthlyLimit != null && b.monthlyLimit !== "") fd.append("monthlyLimit", String(b.monthlyLimit));
  if (b.exempt != null) fd.append("exempt", String(b.exempt));
  if (b.modelLab != null) fd.append("modelLab", String(b.modelLab));
  try {
    const r = await fetch(SVC, { method: "POST", headers: { "X-Admin-Token": env.KARDIOX_ADMIN_TOKEN || "" }, body: fd });
    return J(await r.json().catch(() => ({})), r.status);
  } catch (e) { return J({ error: "service unreachable" }, 502); }
}
