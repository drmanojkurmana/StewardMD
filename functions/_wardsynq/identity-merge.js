/* functions/_wardsynq/identity-merge.js — two records, one person.
 *
 * Duplicate patient records are among the most reliably harmful things in a hospital system, and the
 * harm is not the duplication. It is that HALF THE CLINICAL PICTURE IS INVISIBLE from whichever
 * record you happen to open: the penicillin allergy is on the other one, the potassium from
 * yesterday is on the other one, the anticoagulant is on the other one. WardSynQ had deterministic
 * identity from the MRN and no way at all to resolve two records that turned out to be one patient.
 *
 * A MERGE MOVES NOTHING AND DESTROYS NOTHING. The obvious implementation is to rewrite the duplicate
 * record's clinical rows to point at the survivor. This does not do that, for two reasons that are
 * the same reason: the store is append-only so that a chart can always be read back as it was, and a
 * merge is a CLAIM about identity that can be wrong. So a merge writes ONE new record - a link - and
 * both patient records stay exactly as they are. Nothing is rewritten, so nothing can be lost.
 *
 * A MERGE IS REVERSIBLE. Merges are wrong sometimes: two people with the same name and birth date,
 * a mistyped MRN, a trauma record matched to the wrong person. An irreversible merge is worse than a
 * duplicate, because a duplicate is at least visibly two things. Unmerging is a new version of the
 * link, and the whole history of the claim survives.
 *
 * NOTHING IS EVER MERGED AUTOMATICALLY. Probabilistic matching on name and date of birth may SUGGEST
 * - and this file does not even do that - but merging two people's records because they look alike
 * is how one patient inherits another's allergies. A named human decides, with a reason.
 *
 * READING RESOLVES; IT DOES NOT HIDE. A read of a merged record still works and SAYS it is merged,
 * rather than 404ing or silently redirecting: a clinician who followed a link to that record needs
 * to be told where the rest of the picture is, not shown an empty chart.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "PatientLink";
// ponytail: identityOf scans every link; index links on mergedId too if a tenant approaches this.
const LINK_SCAN_CAP = 500;

/** What a link asserts. `merged` means "these are one person"; `unmerged` retracts that. */
const STATES = Object.freeze(["merged", "unmerged"]);

function PatientLink(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    /* `patientId` is the SURVIVOR, deliberately: it is what byPatient() indexes on, so a survivor's
     * chart read finds the links pointing at it without a second query. */
    patientId: i.patientId,
    survivorId: i.patientId,
    mergedId: i.mergedId,
    state: STATES.includes(i.state) ? i.state : "merged",
    reason: i.reason || null,
    mergedBy: i.mergedBy || null,
    mergedAt: i.mergedAt || null,
    unmergedBy: i.unmergedBy || null,
    unmergedAt: i.unmergedAt || null,
    unmergeReason: i.unmergeReason || null,
    source: { system: "wardsynq-native", sourceId: `patient-link:${i.id}` },
  };
}

/** PURE. One link per ordered pair, so re-merging the same two is the same record. */
function linkIdFor(survivorId, mergedId) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const a = slug(survivorId), b = slug(mergedId);
  return a && b && a !== b ? `wsq-link-${a}-${b}` : null;
}

/** PURE. Every id whose records belong to this person, survivor first. */
function resolveIdentity(patientId, links) {
  const id = str(patientId);
  const live = (links || []).filter((l) => l && l.state === "merged");
  // Records merged INTO this one.
  const absorbed = live.filter((l) => l.survivorId === id).map((l) => l.mergedId);
  // And the record this one was merged into, if it was.
  const into = live.filter((l) => l.mergedId === id).map((l) => l.survivorId);
  return {
    patientId: id,
    mergedInto: into[0] || null,
    absorbed,
    // Everything a complete chart for this person has to read.
    allIds: [...new Set([id, ...absorbed, ...into])],
    isMerged: into.length > 0,
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

function summary(l) {
  return {
    linkId: l.id, survivorId: l.survivorId, mergedId: l.mergedId, state: l.state,
    reason: l.reason, mergedBy: l.mergedBy, mergedAt: l.mergedAt,
    unmergedBy: l.unmergedBy || null, unmergedAt: l.unmergedAt || null, unmergeReason: l.unmergeReason || null,
    version: l.version,
  };
}

/**
 * Declares that two records are one person.
 * ctx: { migration, survivorId, mergedId, reason, actorDeps, recordDeps }
 */
async function mergePatients(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const survivorId = str(ctx.survivorId), mergedId = str(ctx.mergedId);
  if (!survivorId || !mergedId) return { ...base, ok: false, status: 422, error: "two_patients_required", written: 0 };
  if (survivorId === mergedId) return { ...base, ok: false, status: 422, error: "same_patient", detail: "a record cannot be merged into itself", written: 0 };
  const reason = str(ctx.reason);
  /* A REASON IS MANDATORY. A merge is a claim that two people are one, and the reason is what lets
   * somebody later tell a verified match from a guess. */
  // The preview comes before the reason (the person has not decided yet); the write never does.
  if (!ctx.dryRun && reason.length < 10) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what establishes that these are the same person", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* NOTHING AUTOMATIC MERGES TWO PEOPLE. Merging records because they look alike is how one patient
   * inherits another's allergies, so an automated actor is refused by name. */
  if (resolved.actor && resolved.actor.kind === "ai") {
    return { ...base, ok: false, status: 403, error: "human_required", detail: "identity is resolved by a person, never by a matcher", written: 0 };
  }

  let survivor, merged;
  try { [survivor, merged] = await Promise.all([svc.get("Patient", survivorId), svc.get("Patient", mergedId)]); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  // Both must exist. Merging into a record nobody has ever seen would create an identity by side
  // effect, which is the opposite of resolving one.
  if (!survivor) return { ...base, ok: false, status: 404, error: "survivor_not_found", survivorId, written: 0 };
  if (!merged) return { ...base, ok: false, status: 404, error: "merged_not_found", mergedId, written: 0 };

  let existing;
  try { existing = await svc.byPatient(TYPE, survivorId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  /* A record already merged INTO something else is not available to be merged again. Chaining
   * identities silently is how a merge becomes impossible to unpick, so it is refused with the
   * link that is in the way. */
  /* Found by LISTING, not by byPatient. Links are indexed on the SURVIVOR, so a record that was
   * merged INTO something has no link under its own id - byPatient(mergedId) returns nothing and
   * the chain would go through unnoticed. The same subtlety identityOf already documents. */
  let allLinks;
  /* A failed read is NOT "no chain". This used to swallow the error into an empty list, so the one
   * check that stops a record being merged twice passed whenever it could not look. */
  try { allLinks = await svc.list(TYPE, LINK_SCAN_CAP); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  const alreadyGone = (allLinks || []).find((l) => l && l.state === "merged" && l.mergedId === mergedId && l.survivorId !== survivorId);
  if (alreadyGone) {
    return { ...base, ok: false, status: 409, error: "already_merged", detail: "this record is already merged into another; unmerge that first", mergedId, into: alreadyGone.survivorId, written: 0 };
  }

  const id = linkIdFor(survivorId, mergedId);
  const current = (existing || []).find((l) => l && l.id === id) || null;
  if (current && current.state === "merged") {
    return { ...base, ok: true, written: 0, skipped: "already_merged", ...summary(current) };
  }

  /* PREVIEW. Every check above has run - both records exist, the actor may write, neither is chained
   * - so what a person confirms is exactly what would be written. Nothing is written here. */
  if (ctx.dryRun) {
    const who = (p) => ({ patientId: p.id, name: p.name || null, mrn: p.mrn || null, dob: p.dob || null, sex: p.sex || null });
    return { ...base, ok: true, dryRun: true, written: 0, survivor: who(survivor), merged: who(merged), clinicalRecordsMoved: 0 };
  }

  const link = PatientLink({
    id, patientId: survivorId, mergedId, state: "merged", reason,
    mergedBy: resolved.actor.id, mergedAt: new Date().toISOString(),
  });
  try {
    const out = await svc.put(link, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...link, version: out.record.version }),
      // Said explicitly, because it is the property that makes this safe: no clinical row moved.
      clinicalRecordsMoved: 0,
      actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { linkId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Retracts a merge. ctx: { migration, survivorId, mergedId, reason, actorDeps, recordDeps }
 */
async function unmergePatients(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = linkIdFor(str(ctx.survivorId), str(ctx.mergedId));
  if (!id) return { ...base, ok: false, status: 422, error: "two_patients_required", written: 0 };
  const reason = str(ctx.reason);
  if (reason.length < 10) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this merge was wrong", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "link_not_found", linkId: id, written: 0 };
  if (current.state === "unmerged") return { ...base, ok: true, written: 0, skipped: "already_unmerged", ...summary(current) };

  const next = PatientLink({
    ...current, patientId: current.survivorId, state: "unmerged",
    unmergedBy: resolved.actor.id, unmergedAt: new Date().toISOString(), unmergeReason: reason,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    // Nothing to undo: the merge never moved anything, which is exactly why it can be retracted.
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), clinicalRecordsMoved: 0, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { linkId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Who this patient is, and every id whose records belong to them.
 * ctx: { migration, patientId, actorDeps, recordDeps }
 */
async function identityOf(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", identity: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", identity: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, identity: null };

  let links;
  try {
    // Links are indexed on the SURVIVOR, so a merged record's own byPatient finds nothing; the
    // full list is what answers "was this one absorbed".
    links = await svc.list(TYPE, LINK_SCAN_CAP);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), identity: null }; }

  const identity = resolveIdentity(patientId, links);
  /* The list is capped. A full page means links past the cap were never looked at, so "not merged"
   * would be a guess dressed as a finding - the one answer a records officer must not act on. */
  const partial = (links || []).length >= LINK_SCAN_CAP;
  return {
    ...base, ok: true,
    ...(partial ? { partial: true, partialWarning: `Only the first ${LINK_SCAN_CAP} merge records were checked. This history may be incomplete.` } : {}),
    identity: {
      ...identity,
      links: (links || []).filter((l) => l && (l.survivorId === patientId || l.mergedId === patientId)).map(summary),
    },
    /* A READ OF A MERGED RECORD STILL WORKS AND SAYS SO. A clinician who followed a link here needs
     * to be told where the rest of the picture is, not handed an empty chart or a 404. */
    ...(identity.isMerged ? { notice: `This record has been merged into ${identity.mergedInto}. The complete chart is under that identity.` } : {}),
  };
}

export { TYPE, STATES, PatientLink, linkIdFor, resolveIdentity, mergePatients, unmergePatients, identityOf };
