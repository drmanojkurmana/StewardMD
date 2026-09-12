/* functions/_wardsynq/record-detail.js — the record behind a line on the timeline.
 *
 * The timeline is a PROJECTION. It says "dr.mehta prescribed Co-amoxiclav 1.2g IV TDS", which is
 * what a reader wants ninety-nine times out of a hundred; the hundredth time somebody needs to know
 * exactly what was written, by whom, when it was written as against when it took effect, and
 * whether it was later corrected. Until now there was nowhere to go and look.
 *
 * THIS ADDS NO AUTHORITY AND NO SECOND COPY. It reads the same governed record the timeline already
 * projected, through the same actor's own read scope, and returns its versions. A reader who may
 * not read the type does not get it here either; a reader who may sees exactly what the record
 * says and nothing translated.
 *
 * WHAT WAS SUPERSEDED IS SHOWN, NOT HIDDEN. wardsynq-temporal.js already works out which versions
 * were ever the current clinical belief and which were overtaken before they took effect, and that
 * distinction is the whole reason to look: "this dose was prescribed and then corrected an hour
 * later" and "this dose stood all week" are different facts, and a chart that shows only the latest
 * version makes them look identical. A corrected record is marked corrected rather than quietly
 * replaced, and the version that was corrected stays readable.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { historyOf } from "../../wardsynq/wardsynq-temporal.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* What a person may be shown about who wrote a version. The actor id is the thing an audit follows
 * and is returned as-is; the readable form is a rendering and never replaces it. */
function personName(actorId) {
  const id = str(actorId);
  if (!id) return "";
  const at = id.indexOf("@");
  if (at > 0) return id.slice(0, at);
  if (id.indexOf("fb:") === 0) return "a clinician account";
  return id;
}

/**
 * PURE. Turns raw versions into what a reader needs: who, when, whether it stood, and what changed.
 *
 * `changed` compares each version against the one before it at the top level only. That is
 * deliberate: a deep diff of a clinical record produces a wall of paths nobody reads, and the
 * question being asked here is "what moved", not "produce me a patch".
 */
function versionSummaries(versions) {
  /* historyOf returns each VERSION spread flat with its three verdict flags alongside - not a
   * wrapper around the record. Reading it as a wrapper silently yields the version NUMBER where the
   * record should be, and every field then comes back undefined. */
  const rows = historyOf(versions || [], {});
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    const changed = [];
    if (prev) {
      const keys = new Set([...Object.keys(prev), ...Object.keys(v)]);
      for (const k of keys) {
        /* meta, version and writtenBy differ on EVERY version by construction, and the three
         * verdict flags are historyOf's own working - listing any of them would drown the one
         * field that actually moved. */
        if (k === "meta" || k === "version" || k === "writtenBy") continue;
        if (k === "wasCurrentBelief" || k === "isCurrentBelief" || k === "supersededBeforeEffective") continue;
        if (JSON.stringify(prev[k]) !== JSON.stringify(v[k])) changed.push(k);
      }
    }
    const meta = v.meta || {};
    out.push({
      version: v.version ?? null,
      recordedAt: str(meta.recordedAt) || null,
      effectiveAt: str(meta.effectiveAt) || null,
      amendedAt: str(meta.amendedAt) || null,
      by: str(v.writtenBy && v.writtenBy.id) || null,
      byName: personName(v.writtenBy && v.writtenBy.id),
      onBehalfOf: str(v.writtenBy && v.writtenBy.onBehalfOf) || null,
      source: str(meta.source && meta.source.system) || null,
      /* Whether this version was ever what the record actually said. A version overtaken before it
       * took effect never was, and reading it as though it had been is how a chart tells a story
       * that did not happen. */
      stood: v.wasCurrentBelief !== false,
      supersededBeforeEffective: v.supersededBeforeEffective === true,
      ...(changed.length ? { changed } : {}),
      /* The one the record hands back today. Deliberately NOT historyOf's `isCurrentBelief`, which
       * answers a different and narrower question - "was this the live belief at its OWN effective
       * time" - and is therefore true of several versions at once. The rows are in recorded order
       * and the store returns the latest recorded version, so that is the one marked current, and
       * it is the same version this response carries in `record`. */
      ...(i === rows.length - 1 ? { current: true } : {}),
    });
  }
  return out;
}

/**
 * The record behind one timeline line, with its versions.
 *
 * ctx: { migration, resourceType, recordId, actorDeps, recordDeps }
 */
async function recordDetail(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", record: null, versions: [] };

  const resourceType = str(ctx.resourceType);
  const recordId = str(ctx.recordId);
  if (!resourceType || !recordId) {
    return { ...base, ok: false, status: 422, error: "type_and_id_required", record: null, versions: [] };
  }

  let resolved, svc;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message), record: null, versions: [] };
  }

  let current, versions;
  try {
    /* Both reads go through the governed store, so a reader outside this type's read scope is
     * refused here exactly as they would be anywhere else - this is not a side door. */
    current = await svc.get(resourceType, recordId);
    versions = await svc.history(resourceType, recordId);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), record: null, versions: [] };
  }
  if (!current) return { ...base, ok: false, status: 404, error: "record_not_found", resourceType, recordId, record: null, versions: [] };

  const summaries = versionSummaries(versions || [current]);
  return {
    ...base, ok: true, resourceType, recordId,
    record: current,
    versions: summaries,
    /* Said plainly rather than left for a reader to work out by comparing timestamps. */
    corrected: summaries.some((v) => v.amendedAt) || summaries.length > 1,
    versionCount: summaries.length,
  };
}

export { recordDetail, versionSummaries, personName };
