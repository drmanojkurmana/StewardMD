/* functions/api/portal/[[path]].js - the patient's own door, deliberately not inside the clinical one.
 *
 * Every other WardSynQ route lives under /api/queue and begins by resolving a STAFF actor through
 * authorizeOrg. A patient has no staff account and never will, so these two routes could not live
 * there - and putting them there behind an exception would have been worse than the plumbing this
 * file duplicates: the one place a non-employee can read a chart should not sit inside the block
 * whose every other line assumes an employee, where a later edit widens it by accident.
 *
 * SO THIS FILE IS SMALL ON PURPOSE. It exposes exactly two operations - exchange a code for a
 * session, and read the record that session is for - and it can reach nothing else. There is no
 * write path here of any kind, no patient id is ever accepted from the caller, and no clinical
 * module is imported except the one that assembles the patient's own copy.
 *
 * IT IS OFF UNLESS THE HOSPITAL TURNS IT ON. `wardsynq.patientAccess.enabled` gates both routes, and
 * the modules refuse independently of this file - the check is not in one place.
 *
 * THE ORG IS NAMED IN THE REQUEST AND THAT IS NOT A SECRET. Knowing which hospital a portal belongs
 * to gets an anonymous caller nothing: they still need a grant id and its code, the code is hashed
 * at rest, attempts are capped on the grant itself, and a wrong code and a missing grant return the
 * same answer so this cannot be used to enumerate anything.
 */

import * as ORG from "../../_opd_org_store.js";
import { recordDeps } from "../../_wardsynq/deps.js";
import { redeemCode, portalRead, sessionPatient } from "../../_wardsynq/patient-access.js";
import { sendMessage, requestAppointment } from "../../_wardsynq/portal-requests.js";

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)),
  });
}

const str = (v) => (v == null ? "" : String(v).trim());

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const sub = parts[0] || "";
  /* POST only, both routes. A session token in a query string ends up in every access log and
   * proxy on the way, and a GET is the request a browser will happily repeat. */
  if (request.method !== "POST") return json({ ok: false, error: "not_found" }, 404, request);

  let body = {};
  try { body = await request.json(); } catch (_) { body = {}; }

  const orgId = str(body.orgId);
  if (!orgId) return json({ ok: false, error: "org_required" }, 400, request);

  const org = await ORG.getOrg(env, orgId);
  /* A hospital not running WardSynQ natively has no record here to open, and saying anything more
   * specific than "not found" tells an anonymous caller which orgs exist. */
  if (!org || org.mode !== "wardsynq" || !org.connectTenantId) return json({ ok: false, error: "not_found" }, 404, request);

  const cfg = (org && org.wardsynq) || null;
  const migration = { mode: "authoritative", tenantId: String(org.connectTenantId) };
  /* No actorDeps. There is no staff identity to resolve and nothing here asks for one: the modules
   * that need a clinician (enrol, revoke) are NOT imported by this file and are unreachable from it. */
  const deps = { migration, recordDeps: recordDeps(env, migration.tenantId), config: cfg && cfg.patientAccess };

  if (sub === "redeem") {
    const r = await redeemCode(request, env, { ...deps, grantId: body.grantId, code: body.code });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  if (sub === "record") {
    const r = await portalRead(request, env, {
      ...deps, grantId: body.grantId, token: body.token,
      /* The hospital's own withholding list, exactly as the clinician's handout uses it. */
      neverRelease: (cfg && cfg.neverRelease) || null,
    });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  /* The two write routes. Both check the session FIRST and then take the patient id from the grant -
   * a caller cannot name whose record it writes onto, exactly as on the read side. */
  if (sub === "message" || sub === "appointment-request") {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);

    if (sub === "message") {
      const r = await sendMessage(request, env, { ...deps, patientId: session.patientId, subject: body.subject, body: body.body });
      return json(r, r.ok ? 200 : (r.status || 502), request);
    }
    const r = await requestAppointment(request, env, { ...deps, patientId: session.patientId, reason: body.reason, preference: body.preference });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }

  return json({ ok: false, error: "not_found" }, 404, request);
}
