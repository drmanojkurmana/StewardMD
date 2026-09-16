/* functions/_wardsynq/abdm-registry.js - is this facility in ABDM's Health Facility Registry, and each doctor in the
 * Health Professional Registry? The Admin ABDM card asks, and shows what the registry answered instead of a typed-in
 * checklist (design S6 4.2).
 *
 * ADAPTER. The registries sit behind the ABDM gateway session of the shared StewardMD bridge (owner A1), in the
 * environment of this hospital's profile; production is never asked (owner A2). The request shapes below are pinned to
 * the best sources this build has, and each says how sure it is:
 *
 *   FACILITY   POST <host>/v4/int/FacilityManagement/v1.5/facility/search, Authorization: Bearer <session>,
 *              body { facilityId, page, resultsPerPage } -> { facilities: [{ facilityId, facilityName, facilityStatus }] }.
 *              Body and response fields: NHA "Register Professional HPR V2" guide, section 8 "Search For Facility API"
 *              (https://sandboxcms.abdm.gov.in/uploads/Register_Professional_HPR_V2_15012023_sbx_2_70c48e7e6b_aa9370c468.pdf):
 *              "if facilityId is sent the other fields are ignored". The V4 host prefix (apihspsbx.abdm.gov.in/v4/int)
 *              is from NHA's Milestone 4 Postman export as copied by integrators; UNCONFIRMED against a live call.
 *   PROFESSIONAL POST <host>/v4/int/apis/v1/doctors/fetch-professional-info, body { practitioner: { id } }. The path is in the
 *              same Postman export; the body and response are UNCONFIRMED (no official document reachable). So a
 *              professional is "verified" only when the answer carries the very HPR ID asked about; any other shape
 *              is "unverified", never guessed into a yes.
 *
 * RESULT. "verified" (the registry returned this exact ID), "not-found" (the registry answered and it is not there),
 * "unverified" (no usable answer: an error, a refusal, an unknown shape). What the registry said about status
 * (facilityStatus) is shown as the registry wrote it. Each check is stored on the hospital's ABDM profile record as a
 * new version and audited in the same append, naming the ID and the outcome, never a token.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";
import { CONNECTOR_TYPE } from "./connectors.js";
import { abdmConfigFor } from "../_connect/abdm/config.js";
import { requestId } from "../_connect/abdm/gateway.js";
import { gatewayFor } from "./abdm-connect.js";
import { isValidHfrId, isValidHprId } from "../_region_in.js";

const str = (v) => (v == null ? "" : String(v).trim());
const digits = (v) => str(v).replace(/\D/g, "");

export const REGISTRY = Object.freeze({
  sandbox: Object.freeze({ host: "https://apihspsbx.abdm.gov.in", facilitySearch: "/v4/int/FacilityManagement/v1.5/facility/search", professional: "/v4/int/apis/v1/doctors/fetch-professional-info" }),
});

/** PURE. Whether the registries can be asked for this hospital, and in which environment. */
function registryAccessOf(rec, env) {
  if (!rec) return { ok: false, code: "not_set_up" };
  const s = rec.settings || {};
  if (s.status === "production-linked") return { ok: false, code: "production_held" };
  if (!(env && str(env.ABDM_CLIENT_SECRET))) return { ok: false, code: "bridge_not_configured" };
  return { ok: true, conn: { connected: true, envName: "sandbox", hipId: str(s.hipId), hiuId: str(s.hiuId) || str(s.hipId) } };
}

async function post(env, conn, path, body, opts) {
  const o = opts || {};
  const cfg = abdmConfigFor(env, conn), base = REGISTRY[conn.envName];
  let token;
  try { token = await gatewayFor(env, conn, { fetchImpl: o.fetchImpl, kv: o.kv }).session(); }
  catch { return { failed: "session" }; }
  let res;
  try {
    res = await (o.fetchImpl || fetch)(base.host + path, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: "Bearer " + token, "REQUEST-ID": requestId(), TIMESTAMP: new Date().toISOString(), "X-CM-ID": cfg.cmId } });
  } catch { return { failed: "network" }; }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

/** A facility check. -> { status, checkedAt, httpStatus, facilityStatus?, facilityName?, reason? } */
async function checkFacility(env, conn, hfrId, opts) {
  const checkedAt = new Date().toISOString(), id = str(hfrId);
  if (!isValidHfrId(id)) return { status: "unverified", checkedAt, reason: "bad_format" };
  const r = await post(env, conn, REGISTRY[conn.envName].facilitySearch, { facilityId: id, page: 1, resultsPerPage: 10 }, opts);
  if (r.failed) return { status: "unverified", checkedAt, reason: r.failed };
  if (r.status === 404) return { status: "not-found", checkedAt, httpStatus: 404 };
  if (r.status < 200 || r.status >= 300 || !r.json || !Array.isArray(r.json.facilities)) return { status: "unverified", checkedAt, httpStatus: r.status, reason: r.status >= 400 ? "refused" : "unknown_shape" };
  const hit = r.json.facilities.find((f) => f && str(f.facilityId).toUpperCase() === id.toUpperCase());
  if (!hit) return { status: "not-found", checkedAt, httpStatus: r.status };
  return { status: "verified", checkedAt, httpStatus: r.status, facilityStatus: str(hit.facilityStatus).slice(0, 40) || null, facilityName: str(hit.facilityName).slice(0, 120) || null };
}

/** A professional check. -> { status, checkedAt, httpStatus, name?, reason? } */
async function checkProfessional(env, conn, hprId, opts) {
  const checkedAt = new Date().toISOString(), id = digits(hprId);
  if (!isValidHprId(id)) return { status: "unverified", checkedAt, reason: "bad_format" };
  const r = await post(env, conn, REGISTRY[conn.envName].professional, { practitioner: { id } }, opts);
  if (r.failed) return { status: "unverified", checkedAt, reason: r.failed };
  if (r.status === 404) return { status: "not-found", checkedAt, httpStatus: 404 };
  if (r.status < 200 || r.status >= 300 || !r.json || typeof r.json !== "object") return { status: "unverified", checkedAt, httpStatus: r.status, reason: r.status >= 400 ? "refused" : "unknown_shape" };
  const p = r.json.practitioner || r.json.professional || r.json;
  const ids = [p.hprIdNumber, p.hprId, p.id, p.healthProfessionalId, p.registrationId].map(digits);
  if (!ids.includes(id)) return { status: "unverified", checkedAt, httpStatus: r.status, reason: "unknown_shape" };
  return { status: "verified", checkedAt, httpStatus: r.status, name: str(p.name || p.fullName).slice(0, 120) || null };
}

/**
 * POST /ward/abdm-registry-check. ctx: { migration, actorDeps, recordDeps, org, members, target, identity?, fetchImpl?, kv? }
 * target "facility" checks the profile's HFR facility ID; "professional" checks one member's HPR ID.
 */
async function abdmRegistryCheck(request, env, ctx) {
  let actorId;
  try { actorId = (await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:write", ctx.actorDeps)).actor.id; }
  catch (e) { const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502; return { ok: false, status, error: status === 403 ? "permission" : status === 401 ? "auth" : "error" }; }
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId;
  let rec;
  try { rec = await repo.latest(tenantId, CONNECTOR_TYPE, "abdm"); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The ABDM profile could not be read, so nothing was checked." }; }
  const access = registryAccessOf(rec, env);
  if (!access.ok) return { ok: false, status: 409, error: "registry_unavailable", code: access.code, message: access.code === "not_set_up" ? "Save the ABDM profile first." : access.code === "production_held" ? "Production ABDM traffic is held until India-region hosting exists." : "The StewardMD ABDM bridge credential is not configured on this server." };

  const target = str(ctx.target);
  const registry = { facility: null, professionals: {}, ...(rec.registry || {}) };
  let result, scope;
  if (target === "facility") {
    const hfr = str(rec.settings && rec.settings.hfrFacilityId);
    result = await checkFacility(env, access.conn, hfr, ctx);
    registry.facility = { ...result, hfrFacilityId: hfr };
    scope = { target, hfrFacilityId: hfr, status: result.status, reason: result.reason || null, httpStatus: result.httpStatus || null };
  } else if (target === "professional") {
    const m = (ctx.members || []).find((x) => x && x.identity === str(ctx.identity) && x.active !== false);
    if (!m) return { ok: false, status: 404, error: "member_not_found", message: "No such active staff member at this hospital." };
    const hpr = digits(m.regionProfile && m.regionProfile.hprId);
    if (!hpr) return { ok: false, status: 422, error: "hpr_missing", message: "This staff member has no HPR ID to check." };
    result = await checkProfessional(env, access.conn, hpr, ctx);
    registry.professionals = { ...(registry.professionals || {}), [m.identity]: { ...result, hprId: hpr } };
    scope = { target, identity: m.identity, status: result.status, reason: result.reason || null, httpStatus: result.httpStatus || null };
  } else {
    return { ok: false, status: 422, error: "unknown_target", message: "Check the facility or a professional." };
  }

  const at = new Date().toISOString();
  const next = { ...rec, version: rec.version + 1, registry, writtenBy: { id: actorId, kind: "human", at } };
  try { await repo.append(tenantId, [next], { audit: { ts: at, actor: actorId, connectorId: "wardsynq-connectors", action: "abdm.registry.check", outcome: "ok", scope: { connectorId: "abdm", ...scope } } }); }
  catch (e) {
    return { ok: false, status: e instanceof VersionConflictError ? 409 : 502, error: e instanceof VersionConflictError ? "version_conflict" : "record_write_failed",
      message: `The registry answered "${result.status}", but the answer could not be recorded. Check again.` };
  }
  return { ok: true, target, result };
}

export { registryAccessOf, checkFacility, checkProfessional, abdmRegistryCheck };
