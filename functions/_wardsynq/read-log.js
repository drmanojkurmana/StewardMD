/* functions/_wardsynq/read-log.js — who acted on the number before it turned out to be wrong.
 *
 * Every correction path in this build can say WHAT changed. None of them could say WHO ACTED ON THE
 * OLD VALUE, because nothing recorded that anybody read it. vault/modules/WardSynQ.md has carried
 * HAZ-FLUID-01 as PARTIAL for exactly this, and named the blocker: "nothing records that anyone read
 * it. Closing that needs a view log, which does not exist."
 *
 * IT DID EXIST. `wardsynq/wardsynq-readlog.js` was written for this and was reachable by nobody -
 * the seventh piece of finished, unreachable code found in this session. This is the adapter that
 * gives it somewhere to live, and it re-implements none of its rules.
 *
 * A READ IS NOT A VIEW, AND THIS IS THE WHOLE DESIGN. A page that renders a hundred numbers has not
 * shown a clinician a hundred numbers. Logging everything on screen produces a list nobody can act on
 * and buries the three reads that mattered. Only a DECISIVE read is recorded - opened, expanded,
 * printed, acted on, handed over - and the caller says which, because only the caller knows.
 *
 * IT IS AN AUDIT TRAIL AND THEREFORE A SURVEILLANCE RISK. A log of which clinician looked at what,
 * when, is also a management tool for something other than safety, and if it is used that way people
 * stop opening things - which makes the record less safe, not more. Three controls, all of them
 * structural rather than promised:
 *
 *   - The PURPOSE is stamped on every stored entry, so it travels with the data rather than living in
 *     a policy document nobody reads before running a query.
 *   - The retention is bounded at 90 days, and a read past it is not returned even if the row is
 *     still there. A read log that grows forever becomes a dossier.
 *   - There is NO "what did this person read" query. The only question this file answers is "who has
 *     to be told about THIS correction", which is the safety question. Answering the other one is a
 *     governance decision for whoever owns the audit trail, not a route.
 *
 * READING A VALUE THAT WAS ALREADY CORRECT IS NOT AN INCIDENT. Only reads of a version that was later
 * superseded, and only reads BEFORE the correction, ever come back.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ReadLog, READ_KIND, RETENTION_DAYS } from "../../wardsynq/wardsynq-readlog.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "ClinicalRead";

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * PURE. One entry per (value, version, reader, instant).
 *
 * The reader is IN the id: two clinicians opening the same figure at the same second are two reads
 * and two people to warn, and an id without the reader would keep only one of them.
 */
function readIdFor(valueId, version, by, at) {
  const v = slug(valueId), p = slug(by), t = slug(at);
  if (version === undefined || version === null || version === "") return null;
  return v && p && t ? `wsq-read-${v}-v${Number(version)}-${p}-${t}` : null;
}

function ClinicalRead(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    valueId: i.valueId,
    /* NOT `version`. The record service stamps its OWN `version` on every resource, so a field of
     * that name here is silently overwritten - and a read of value-version 3 comes back claiming to
     * be a read of resource-version 1. It cost a failing test to find, and it would have made every
     * correction notice list the wrong people (or nobody) without ever erroring. */
    valueVersion: i.version,
    value: i.value === undefined ? null : i.value,
    kind: i.kind,
    by: i.by,
    at: i.at,
    context: i.context || null,
    /* Stamped on the row, not only in a doc. Anybody who ever queries this table reads what it is
     * for at the same moment they read the data. */
    purpose: i.purpose || null,
    source: { system: "wardsynq-native", sourceId: `read:${i.id}` },
  };
}

async function open(request, env, ctx, need) {
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
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/**
 * Records that a value was DECISIVE for a named person.
 * ctx: { migration, patientId, valueId, version, value?, kind, context?, at? }
 */
async function recordRead(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), valueId = str(ctx.valueId), kind = str(ctx.kind);
  if (!patientId || !valueId) return { ...base, ok: false, status: 422, error: "patient_and_value_required", written: 0 };
  /* The kind is the caller's, and there is no default. A default would make every render a read, and
   * the whole value of this log is that it holds only the reads that mattered. */
  if (!Object.values(READ_KIND).includes(kind)) {
    return { ...base, ok: false, status: 400, error: "unknown_kind", detail: `kind must be one of ${Object.values(READ_KIND).join(", ")}. A value merely rendered on a page is not a read.`, written: 0 };
  }
  if (ctx.version === undefined || ctx.version === null || str(ctx.version) === "") {
    return { ...base, ok: false, status: 422, error: "version_required", detail: "a read records WHICH version was shown, or a correction cannot tell a read of the wrong figure from a read of the right one", written: 0 };
  }
  const version = Number(ctx.version);
  if (!Number.isFinite(version)) return { ...base, ok: false, status: 422, error: "version_required", detail: "the version must be a number", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  /* The module validates and stamps the purpose. Building the entry by hand here would be a second
   * copy of its rules, and the two would drift the first time either changed. */
  let entry;
  try {
    entry = new ReadLog().record({
      valueId, version, value: ctx.value, by: resolved.actor.id, kind,
      patientId, at, context: str(ctx.context) || null,
    });
  } catch (e) {
    return { ...base, ok: false, status: 422, error: "read_rejected", detail: str(e && e.message), written: 0 };
  }

  const id = readIdFor(valueId, version, resolved.actor.id, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const record = ClinicalRead({ ...entry, id });
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, readId: id, valueId, valueVersion: version, kind,
      by: resolved.actor.id, at, recordVersion: out.record.version,
      purpose: entry.purpose,
      note: `Recorded so this reader can be told if the value is later corrected. Kept for ${RETENTION_DAYS} days.`,
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { readId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * WHO HAS TO BE TOLD about this correction. The only question this file answers.
 * ctx: { migration, patientId, valueId, supersededVersion, correctedAt, label?, wasValue?, nowValue?, unit? }
 */
async function readersToNotify(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", people: [] };

  const patientId = str(ctx.patientId), valueId = str(ctx.valueId), correctedAt = str(ctx.correctedAt);
  if (!patientId || !valueId || !correctedAt || ctx.supersededVersion === undefined || ctx.supersededVersion === null || str(ctx.supersededVersion) === "") {
    return { ...base, ok: false, status: 422, error: "correction_required", detail: "finding readers needs the patient, the value, the version that turned out to be wrong, and when it was corrected", people: [] };
  }
  const supersededVersion = Number(ctx.supersededVersion);
  if (!Number.isFinite(supersededVersion)) return { ...base, ok: false, status: 422, error: "correction_required", detail: "the superseded version must be a number", people: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, people: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), people: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), people: [] };
  }

  /* Rehydrated into the module, which owns every rule about which reads count. `prune` enforces the
   * retention on the way in, so a read past the window is not returned even though its row survives -
   * the bound is on what the log will ANSWER with, not only on what a cleanup job got round to. */
  const log = new ReadLog();
  log.entries = (rows || []).filter(Boolean).map((r) => ({
    // Back to the module's own field name. `r.version` is the RECORD's version and is not this.
    valueId: r.valueId, version: r.valueVersion, value: r.value, by: r.by, kind: r.kind,
    patientId: r.patientId, at: r.at, context: r.context, purpose: r.purpose,
  }));
  const pruned = log.prune(correctedAt);

  let notice;
  try {
    notice = log.forNotification({
      valueId, supersededVersion, correctedAt,
      label: str(ctx.label) || null, wasValue: ctx.wasValue, nowValue: ctx.nowValue,
      delta: ctx.delta, unit: str(ctx.unit) || null,
    });
  } catch (e) {
    return { ...base, ok: false, status: 422, error: "notice_failed", detail: str(e && e.message), people: [] };
  }

  return {
    ...base, ok: true, valueId, supersededVersion, correctedAt,
    ...notice,
    ...(pruned.removed ? { outsideRetention: pruned.removed } : {}),
    /* Said on every answer. An empty list means nobody DECISIVELY read the wrong figure - it does not
     * mean nobody saw it, and a caller that read it as "nobody was affected" would be wrong. */
    note: notice && notice.people && notice.people.length
      ? "These people read the superseded version before it was corrected. Telling them is a human act; nothing here has sent anything."
      : "Nobody recorded a decisive read of the superseded version. That is not the same as nobody having seen it.",
  };
}

export { TYPE, READ_KIND, RETENTION_DAYS, ClinicalRead, readIdFor, recordRead, readersToNotify };
