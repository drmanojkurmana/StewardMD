/* functions/_wardsynq/bug-reports.js - the Report Bug button's reports, kept on the server per hospital.
 *
 * Owner, 2026-09-16: "make sure all bugs reported thru report bug are saved on server and removed only after
 * solved". Until this the widget (wardsynq/site/bug-reporter.js) kept reports in one browser's localStorage and
 * a collector on the developer's own Mac, so a report from any other device was lost.
 *
 * WHERE. The hospital's own append-only record store (repository.js), as an internal type like connectors and
 * payment requests: every change is a new version and lands in the same append as its audit row, and nothing
 * needs a schema migration. NOT a RecordService resource type, on purpose: that door needs a clinical actor, and
 * any member of the hospital may report a bug, including roles with no clinical actor at all (hr, viewer). And a
 * type in RESOURCE_TYPES is readable through the raw record door by every role holding emr.view (read scope null),
 * which would hand every nurse every colleague's report.
 *
 * WHO. The route decides, before this file runs (functions/api/queue/[[path]].js, the ward block):
 *   report        any member of the hospital
 *   list          any member; a manager sees every report, anyone else only their own
 *   status/remove managers only: the hospital's admin (or its owner) and the StewardMD platform owner
 * ctx.manager carries that decision here; ctx.reporter is the signed-in person.
 *
 * LIFECYCLE. open -> in_progress -> solved (a note saying how it was solved is required), solved -> open
 * (reopened). Remove is refused unless the report is solved, and removing archives it: status "removed", still
 * in the store with its whole history, hidden from the default list. Nothing is ever deleted.
 *
 * NO PHI IN LOGS. The audit row names the report id, status and version, never the description. A patient's id
 * and bed are kept only when the page already had them; a name is never stored.
 */

import { VersionConflictError } from "./repository.js";

const TYPE = "_wardsynq_bug_report";
const MAX_LIST = 1000;
const STATUSES = Object.freeze(["open", "in_progress", "solved", "removed"]);
const SEVERITIES = Object.freeze(["minor", "major", "blocker"]);
/* Where each status may go by a status change. Removal is its own act (removeBugReport), from solved only. */
const NEXT = Object.freeze({ open: ["in_progress", "solved"], in_progress: ["open", "solved"], solved: ["open"], removed: [] });

const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const nameOf = (who) => clip(who && who.name, 120) || null;

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The server id is bound to the reporter: the same client id from someone else is a different report, never theirs. */
async function reportIdFor(reporterId, clientReportId) {
  return "bug-" + (await sha(str(reporterId) + "|" + str(clientReportId))).slice(0, 32);
}

const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-bug-reports", action, outcome: "ok", scope });
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const notHospital = { ok: false, status: 404, error: "not_a_wardsynq_hospital", message: "Bug reports are kept for a WardSynQ hospital." };
const readFailed = { ok: false, status: 502, error: "bug_report_read_failed", message: "Bug reports could not be read, so nothing was changed." };
const writeFailed = (e) => e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This report changed at the same moment. Reload and try again; nothing was saved." }
  : { ok: false, status: 502, error: "bug_report_write_failed", message: "The change could not be saved, so it was not made." };

/** PURE. The page context the widget sends, cut to what is useful and bounded. No query string (it can carry a code). */
function contextFrom(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  let url = clip(c.url, 600);
  const q = url.search(/[?]/);
  if (q >= 0) { const h = url.indexOf("#", q); url = url.slice(0, q) + (h >= 0 ? url.slice(h) : ""); }
  const p = c.patient && typeof c.patient === "object" ? c.patient : null;
  const patient = p && (str(p.id) || str(p.bed)) ? { id: clip(p.id, 120) || null, bed: clip(p.bed, 40) || null } : null;
  return { url: url.slice(0, 500), page: clip(c.page, 80) || null, tab: clip(c.tab, 80) || null, wardView: clip(c.wardView, 80) || null,
    surface: clip(c.surface, 40) || null, activeNavText: clip(c.activeNavText, 80) || null, patient };
}

function targetFrom(raw) {
  if (!raw || typeof raw !== "object") return null;
  return { selector: clip(raw.selector, 200), tag: clip(raw.tag, 40), id: clip(raw.id, 120) || null, snippet: clip(raw.snippet, 120),
    parentContext: clip(raw.parentContext, 120) || null, outerHtml: clip(raw.outerHtml, 300) };
}

function errorsFrom(raw) {
  return (Array.isArray(raw) ? raw : []).slice(-25).map((e) => ({
    type: clip(e && e.type, 40), time: clip(e && e.time, 40), text: clip(e && e.text, 1000), stack: clip(e && e.stack, 2000) || null }));
}

/**
 * Report a bug. ctx: { migration, recordDeps, reporter: {id, name, role}, clientReportId, description, severity,
 * location, context, target, errors, userAgent, screen, clientReportedAt }. Resubmitting the same client id
 * returns the saved report (replayed: true) and writes nothing.
 */
async function submitBugReport(request, env, ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return notHospital;
  const repo = ctx.recordDeps.repository, tenantId = mig.tenantId, who = ctx.reporter || {};
  if (!str(who.id)) return { ok: false, status: 401, error: "auth", message: "Sign in to send a bug report." };
  const description = clip(ctx.description, 4000);
  if (!description) return { ok: false, status: 422, error: "description_required", message: "Say what went wrong." };
  const clientReportId = clip(ctx.clientReportId, 80) || crypto.randomUUID();
  const id = await reportIdFor(who.id, clientReportId);

  let cur;
  try { cur = await repo.latest(tenantId, TYPE, id); } catch { return readFailed; }
  if (cur) return { ok: true, replayed: true, report: cur };

  const at = new Date().toISOString();
  const sev = str(ctx.severity);
  const screen = ctx.screen && typeof ctx.screen === "object" ? { width: num(ctx.screen.width), height: num(ctx.screen.height), dpr: num(ctx.screen.dpr) } : null;
  const rec = {
    resourceType: TYPE, id, version: 1, clientReportId, status: "open",
    description, severity: SEVERITIES.includes(sev) ? sev : "major", location: clip(ctx.location, 300),
    context: contextFrom(ctx.context), target: targetFrom(ctx.target), errors: errorsFrom(ctx.errors),
    userAgent: clip(ctx.userAgent, 300), screen,
    reporter: { id: str(who.id), name: clip(who.name, 120) || null, role: clip(who.role, 40) || null },
    reportedAt: at, clientReportedAt: clip(ctx.clientReportedAt, 40) || null,
    events: [{ status: "open", by: str(who.id), byName: nameOf(who), at }],
    writtenBy: { id: str(who.id), kind: "human", at },
  };
  try { await repo.append(tenantId, [rec], { audit: auditEvent("bug.report", str(who.id), { id, status: "open", version: 1, severity: rec.severity }) }); }
  catch (e) {
    // Two sends of the same report at once: the first landed, so this one answers with it.
    if (e instanceof VersionConflictError) { try { const again = await repo.latest(tenantId, TYPE, id); if (again) return { ok: true, replayed: true, report: again }; } catch { /* below */ } }
    return writeFailed(e);
  }
  return { ok: true, replayed: false, report: rec };
}

/** ctx: { migration, recordDeps, reporter, manager, status: open|in_progress|solved|removed|all (default: all but removed) }. Newest first. */
async function listBugReports(request, env, ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return notHospital;
  const filter = str(ctx.status) || "active";
  if (filter !== "active" && filter !== "all" && !STATUSES.includes(filter)) return { ok: false, status: 422, error: "bad_status", message: "Filter by open, in_progress, solved, removed or all." };
  let rows;
  // ponytail: newest 1000 reports per hospital are scanned; page by id prefix if a hospital ever keeps more.
  try { rows = (await ctx.recordDeps.repository.latestByType(mig.tenantId, TYPE, MAX_LIST, { newest: true })) || []; } catch { return readFailed; }
  const me = str(ctx.reporter && ctx.reporter.id);
  const reports = rows
    .filter((r) => ctx.manager || (r.reporter && r.reporter.id === me))
    .filter((r) => (filter === "all" ? true : filter === "active" ? r.status !== "removed" : r.status === filter))
    .sort((a, b) => String(b.reportedAt).localeCompare(String(a.reportedAt)));
  return { ok: true, manager: !!ctx.manager, status: filter, reports };
}

async function load(ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return { error: notHospital };
  if (!ctx.manager) return { error: { ok: false, status: 403, error: "bug_manager_only", message: "Only the hospital's admin can change a bug report." } };
  const id = str(ctx.id);
  if (!id) return { error: { ok: false, status: 422, error: "id_required", message: "Name the report." } };
  let cur;
  try { cur = await ctx.recordDeps.repository.latest(mig.tenantId, TYPE, id); } catch { return { error: readFailed }; }
  if (!cur) return { error: { ok: false, status: 404, error: "bug_report_not_found", message: "No such bug report in this hospital." } };
  if (ctx.expectedVersion != null && ctx.expectedVersion !== "" && Number(ctx.expectedVersion) !== cur.version) {
    return { error: { ok: false, status: 409, error: "version_conflict", message: "This report changed since you opened it. Reload and try again; nothing was saved.", current: cur } };
  }
  return { cur, repo: ctx.recordDeps.repository, tenantId: mig.tenantId, by: str(ctx.reporter && ctx.reporter.id), byName: nameOf(ctx.reporter) };
}

async function commit(o, next, action) {
  try { await o.repo.append(o.tenantId, [next], { audit: auditEvent(action, o.by, { id: next.id, status: next.status, version: next.version, from: o.cur.status }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, report: next };
}

/** ctx: { migration, recordDeps, reporter, manager, id, status: open|in_progress|solved, note, expectedVersion? }. */
async function setBugReportStatus(request, env, ctx) {
  const o = await load(ctx);
  if (o.error) return o.error;
  const to = str(ctx.status), note = clip(ctx.note, 2000);
  if (!["open", "in_progress", "solved"].includes(to)) return { ok: false, status: 422, error: "bad_status", message: "A report can be set to open, in progress or solved." };
  if (!NEXT[o.cur.status].includes(to)) return { ok: false, status: 409, error: "bad_transition", message: `A ${o.cur.status.replace("_", " ")} report cannot be set to ${to.replace("_", " ")}.` };
  if (to === "solved" && note.length < 3) return { ok: false, status: 422, error: "solution_note_required", message: "Say how it was solved." };
  const at = new Date().toISOString();
  const next = { ...o.cur, version: o.cur.version + 1, status: to,
    solution: to === "solved" ? { note, by: o.by, at } : o.cur.solution || null,
    events: [...(o.cur.events || []), { status: to, by: o.by, byName: o.byName, at, ...(note ? { note } : {}), ...(o.cur.status === "solved" ? { reopened: true } : {}) }],
    writtenBy: { id: o.by, kind: "human", at } };
  return commit(o, next, o.cur.status === "solved" ? "bug.reopen" : "bug.status");
}

/** ctx: { migration, recordDeps, reporter, manager, id, expectedVersion? }. Archives a SOLVED report; 409 otherwise. */
async function removeBugReport(request, env, ctx) {
  const o = await load(ctx);
  if (o.error) return o.error;
  if (o.cur.status !== "solved") return { ok: false, status: 409, error: "bug_not_solved", message: "Only a solved report can be removed. Mark it solved first, with how it was solved." };
  const at = new Date().toISOString();
  const next = { ...o.cur, version: o.cur.version + 1, status: "removed", removed: { by: o.by, at },
    events: [...(o.cur.events || []), { status: "removed", by: o.by, byName: o.byName, at }], writtenBy: { id: o.by, kind: "human", at } };
  return commit(o, next, "bug.remove");
}

export { TYPE as BUG_REPORT_TYPE, reportIdFor, submitBugReport, listBugReports, setBugReportStatus, removeBugReport };
