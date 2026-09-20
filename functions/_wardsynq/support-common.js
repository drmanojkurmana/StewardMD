/* functions/_wardsynq/support-common.js - what the hospital support services (diet.js, cssd.js,
 * housekeeping.js, ambulance.js, mortuary.js) share: opening the record service as the caller, and saying
 * honestly why a write did not land. The same two helpers every domain module in this directory carries,
 * written once for these five. */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, ListCeilingError } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const offOf = (mig) => !mig || mig.mode === "off";
/** A plain ISO instant or YYYY-MM-DD date that parses; anything else is not guessed at. */
const isoOk = (v) => { const s = str(v); return !!s && s.length <= 40 && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?([+-]\d{2}:\d{2})?)?$/.test(s) && !isNaN(Date.parse(s)); };
const newId = (prefix, orgId) => `${prefix}-${slug(orgId) || "h"}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

async function openSvc(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "Somebody else changed this a moment ago. Reload and try again." };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}

/* Every record of one type (service.listAll, oldest first), for a board, a clash check or a recall. Past READ_MAX it
 * throws ListCeilingError: the newest records are the ones a short read would drop, so the read is refused (503), never
 * answered short. ponytail: each page re-groups every version; audit O20 (a latest-version table) if that is slow. */
const READ_MAX = 50000;
async function readAllOf(svc, type) { return (await svc.listAll(type, { max: READ_MAX, throwOnTruncate: true })).rows; }

function readFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
  if (e instanceof ListCeilingError) return { ok: false, status: 503, error: e.code, detail: str(e.message) };
  return { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
}

/** Median and 90th percentile of a list of minutes, or null when there is nothing to say. */
function spread(mins) {
  const xs = (mins || []).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (p) => xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
  return { count: xs.length, medianMinutes: Math.round(at(0.5)), p90Minutes: Math.round(at(0.9)) };
}

export { str, slug, baseOf, offOf, isoOk, newId, openSvc, writeFailure, readFailure, spread, READ_MAX, readAllOf };
