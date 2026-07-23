/* StewardMD — hospital/medical-college "please add this" requests.
 *
 *   POST /api/hospital-request            → submit a request (any signed-in or guest user)
 *   GET  /api/hospital-request            → list pending requests            (OWNER only)
 *   POST /api/hospital-request/approve     { id }  → approve + add to directory (OWNER only)
 *   POST /api/hospital-request/decline     { id }  → decline                    (OWNER only)
 *
 * Requests live in Firestore `hospitalRequests/{id}` { name, state, status, requestedBy, ts };
 * approved ones are copied to `hospitalsApproved/{id}` { name, state } which the client picker can
 * merge into window.SMD_HOSPITALS at runtime (until the next static-directory rebuild folds them in).
 */
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { fsQuery, fsGet, fsCommit, wCreate, wUpdate } from "../../_fbfirestore.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  // ---- submit (open to any user; light validation) ----
  if (method === "POST" && !seg) {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const name = String(b.name || "").trim().slice(0, 160);
    if (name.length < 3) return json({ error: "bad-name" }, 400);
    const state = String(b.state || "").trim().slice(0, 60);
    let uid = ""; try { uid = (await identify(request, env)) || ""; } catch (e) {}
    const id = (crypto.randomUUID && crypto.randomUUID()) || ("hr_" + Date.now() + "_" + Math.round(Math.random() * 1e9));
    try {
      await fsCommit(env, [wCreate(env, `hospitalRequests/${id}`, {
        name, state, status: "pending", requestedBy: uid || "guest", ts: new Date().toISOString(),
      })]);
      return json({ ok: true, id });
    } catch (e) { return json({ error: "store-unavailable", detail: String((e && (e.message + " | " + (e.detail || e.code || e.status))) || e).slice(0, 200) }, 501); }
  }

  // ---- everything below is OWNER-only (admin console) ----
  if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);

  if (method === "GET") {
    try {
      const rows = await fsQuery(env, "hospitalRequests", { where: { field: "status", value: "pending" }, limit: 300 });
      const list = rows.map((r) => ({ id: r.id, name: r.fields.name, state: r.fields.state, requestedBy: r.fields.requestedBy, ts: r.fields.ts }))
        .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
      return json({ ok: true, requests: list });
    } catch (e) { return json({ error: "query-failed" }, 500); }
  }

  if (method === "POST" && (seg === "approve" || seg === "decline")) {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const id = String(b.id || "").trim();
    if (!id) return json({ error: "bad-args" }, 400);
    try {
      const doc = await fsGet(env, `hospitalRequests/${id}`);
      if (!doc) return json({ error: "not-found" }, 404);
      const status = seg === "approve" ? "approved" : "declined";
      const writes = [wUpdate(env, `hospitalRequests/${id}`, { status, reviewedAt: new Date().toISOString() }, { exists: true })];
      if (seg === "approve") {
        writes.push(wCreate(env, `hospitalsApproved/${id}`, { name: doc.fields.name || "", state: doc.fields.state || "" }));
      }
      await fsCommit(env, writes);
      return json({ ok: true, status });
    } catch (e) { return json({ error: "write-failed" }, 500); }
  }

  return json({ error: "not-found" }, 404);
}
