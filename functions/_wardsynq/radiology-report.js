/* functions/_wardsynq/radiology-report.js — the imaging report, which is prose and not a number.
 *
 * lab-result.js releases a laboratory result: values, units, reference ranges, a critical flag. An
 * imaging report is a different kind of object and forcing it through that path would break it. It
 * has no value and no unit. It has FINDINGS - what the radiologist saw - and an IMPRESSION, which is
 * what they concluded, and the second is not derivable from the first by anybody except them.
 *
 * THE IMPRESSION IS NEVER COMPOSED. Not summarised from the findings, not defaulted to the findings,
 * not left to be inferred. A report with findings and no impression is a report the radiologist has
 * not finished, and it can be released as PRELIMINARY exactly so - but nothing here writes the
 * sentence a clinician will act on.
 *
 * PRELIMINARY IS A REAL AND USEFUL STATE. The registrar at 02:00 reports the CT head, the consultant
 * reads it at 09:00. Both readings matter, the first is acted on, and a system that only stored the
 * final one would erase what the night team actually saw and decided from. A final report SUPERSEDES
 * a preliminary one as a new version; the preliminary is still on the record.
 *
 * A CHANGED IMPRESSION IS THE DANGEROUS CASE, and it is the one thing this file goes out of its way
 * to make loud. When a final report's impression differs from the preliminary one somebody already
 * acted on, that is a discrepancy - the commonest serious one in radiology - and it is flagged on the
 * response and on the record rather than being quietly overwritten. Nothing here decides whether the
 * change is clinically significant; it says the impression changed, and who to ask.
 *
 * NO IMAGES. This holds the report, never the pixels: DICOM/PACS is excluded by the owner's
 * instruction and a study that half-lives here would be worse than one that does not.
 */

import { DiagnosticReport } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const STATUSES = Object.freeze(["preliminary", "final", "corrected"]);

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One report per request. A second reading is a new VERSION of it, never a second report. */
function reportIdFor(serviceRequestId) {
  const r = slug(serviceRequestId);
  return r ? `wsq-rad-${r}` : null;
}

/**
 * PURE. Did the impression change between two readings?
 *
 * Compared on normalised text, because whitespace and case are not a discrepancy. Anything else IS
 * one as far as this file is concerned: it does not judge clinical significance, it says the sentence
 * a clinician acted on is not the sentence that now stands.
 */
function impressionChanged(previous, next) {
  const a = str(previous && previous.impression).toLowerCase().replace(/\s+/g, " ");
  const b = str(next).toLowerCase().replace(/\s+/g, " ");
  if (!a || !b) return false;
  return a !== b;
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
 * Reports an imaging study.
 * ctx: { migration, serviceRequestId, findings, impression?, status?, modality?, ... }
 */
async function reportImaging(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const serviceRequestId = str(ctx.serviceRequestId);
  const findings = str(ctx.findings);
  const impression = str(ctx.impression);
  const status = str(ctx.status) || "preliminary";
  if (!serviceRequestId) return { ...base, ok: false, status: 422, error: "request_required", detail: "an imaging report answers a request", written: 0 };
  if (!STATUSES.includes(status)) return { ...base, ok: false, status: 400, error: "unknown_status", detail: `status must be one of ${STATUSES.join(", ")}`, written: 0 };
  // A report with nothing seen is not a report. The impression may be absent on a preliminary one -
  // that is what preliminary MEANS - but the findings are what was actually looked at.
  if (!findings) return { ...base, ok: false, status: 422, error: "findings_required", detail: "say what was seen; the impression may follow", written: 0 };
  /* A FINAL report needs the sentence a clinician will act on. Releasing one without an impression
   * would leave a ward reading raw findings and drawing its own radiological conclusion. */
  if (status !== "preliminary" && !impression) {
    return { ...base, ok: false, status: 422, error: "impression_required", detail: "a final report needs an impression; release it as preliminary if it is not ready", written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let sr;
  try { sr = await svc.get("ServiceRequest", serviceRequestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };

  const id = reportIdFor(serviceRequestId);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get("DiagnosticReport", id); }
  catch { current = null; }
  /* A FINAL report is CORRECTED, never re-finalised silently - the same rule lab-result.js keeps,
   * because amending a report somebody has acted on is the most dangerous thing either does. */
  if (current && current.status === "final" && status !== "corrected") {
    return { ...base, ok: false, status: 409, error: "already_final", detail: "this study is reported; re-reporting it is a correction and must say so", reportId: id, version: current.version, written: 0 };
  }

  /* THE DISCREPANCY. A final impression that differs from the preliminary one somebody already acted
   * on is the commonest serious event in radiology. It is flagged, on the record and on the response,
   * and nothing here decides whether the change matters clinically - it says the sentence changed. */
  const changed = current && impression && impressionChanged(current, impression);

  const report = DiagnosticReport({
    id, patientId: sr.patientId, encounterId: sr.encounterId || null,
    serviceRequestId, code: sr.display || sr.code || "Imaging",
    status, conclusion: impression || null,
    resultObservationIds: [],
    source: { system: "wardsynq-native", sourceId: `radiology:${id}` },
  });
  // Bolted on, the convention this codebase uses for facts the canonical shape has no field for.
  report.category = "imaging";
  report.modality = str(ctx.modality) || null;
  report.findings = findings;
  report.impression = impression || null;
  report.reportedBy = resolved.actor.id;
  report.reportedAt = str(ctx.reportedAt) || new Date().toISOString();
  if (changed) {
    report.impressionChangedFrom = current.impression || null;
    report.discrepancy = true;
  }

  try {
    const out = await svc.put(report, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, reportId: id, patientId: report.patientId,
      serviceRequestId, status, modality: report.modality,
      findings, impression: report.impression, version: out.record.version,
      supersedes: current ? { status: current.status, version: current.version } : null,
      ...(changed ? {
        discrepancy: true,
        previousImpression: current.impression || null,
        detail: "The impression has changed from the reading somebody may already have acted on. Whether that matters clinically is not this system's call - tell the team looking after this patient.",
      } : {}),
      ...(status === "preliminary" ? { note: "Preliminary. It stays on the record when the final reading supersedes it." } : {}),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId: id, written: 0, actor: resolved.actor.id }) };
  }
}

export { STATUSES, reportIdFor, impressionChanged, reportImaging };
