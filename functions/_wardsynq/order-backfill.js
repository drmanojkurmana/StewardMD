/* functions/_wardsynq/order-backfill.js - closing the orders that were resulted before anything closed them.
 *
 * R5-2 made a released result close the order it answers (ward-order.js closeOrderOnResult) and pointed
 * the laboratory, specimen and imaging boards at the OPEN orders (service.listByStatus). Both halves are
 * about orders placed from now on. An existing hospital's archive is the half neither touched: every
 * order it ever resulted is still `active`, because nothing in the tree had ever written any other word,
 * so those orders count against the 5,000 open-census ceiling and those three boards answer 503
 * `too_many_open` on a hospital that has simply been open for a while. That is the gap this closes.
 *
 * IT IS THE SAME CLOSURE, NOT A SECOND ONE. Every order closed here goes through
 * closeOrderOnResult() - the same writer, the same `completed` status, the same append-only new
 * version, the same governed and audited put - and the only difference it leaves on the record is
 * `completedOn: "backfill"` rather than `"result"`, so an auditor can tell a retrospective tidy-up
 * from a result being filed. A second closure path with its own status vocabulary is exactly how a
 * board ends up showing an order nobody can explain.
 *
 * DRY RUN FIRST, ALWAYS. The scan writes NOTHING and answers with what it would close and, for
 * everything it would not, why - grouped, because "1,412 have no report" is a number an administrator
 * can act on and 1,412 order ids are not. The commit then closes only the ids a scan actually handed
 * back: it re-checks every one of them from the store before writing, so a stale list from an hour ago
 * cannot close an order whose situation has changed in the meantime.
 *
 * RESUMABLE, BECAUSE A WORKER HAS MINUTES AND A HOSPITAL HAS YEARS. The scan takes one page of open
 * orders at the store's own cursor (service.pageByStatus) and hands back the cursor for the next one.
 * Nothing here holds the whole archive, and a run that stops halfway - a deploy, a closed laptop -
 * resumes from the cursor rather than starting again.
 *
 * SAFE TO RUN TWICE. An order already closed is skipped and never rewritten: the scan does not see it
 * at all (the store filters on the open statuses) and the commit refuses it by name.
 *
 * WHAT IT WILL NOT TOUCH, and these are deliberate:
 *   - an order with no released report. There is no evidence its work is finished, and closing it
 *     would take a genuinely owed test off the bench list, which is a missed result.
 *   - an imaging order whose only report is preliminary. The final reading is still owed - the rule
 *     radiology-report.js and dicom.js's worklist already apply.
 *   - an order another system owns (an adapter draft). The R5-2 builder tried closing those and
 *     reverted it: an adapter actor holds the draft tier and the governed store refuses it any other
 *     status, so the whole transaction is rejected. Closing them needs a governance change, not a job.
 */

import { RecordService, isExternalRecord } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { OPEN_ORDER_STATUSES, isOpenOrder, closeOrderOnResult } from "./ward-order.js";
import { effectiveCategory } from "./investigation-catalogue.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* One page of open orders per request. Small enough that a Worker finishes the reports beside it,
 * large enough that a hospital's archive is a handful of batches rather than a hundred. */
const BATCH_DEFAULT = 100;
const BATCH_MAX = 500;
/* How many order ids one commit accepts - the scan's own batch, and no more. A commit is not a
 * second place to enumerate the archive. */
const COMMIT_MAX = BATCH_MAX;

/** PURE. Why an order the scan met stays open. Every reason the screen shows comes from this list. */
const REASONS = Object.freeze([
  "already_closed",        // its status is already one of the closed words; nothing is rewritten
  "external_order",        // another system owns it (see the header)
  "no_report",             // no released report for it: its work is not finished
  "report_preliminary",    // imaging, and only a preliminary reading exists; the final one is owed
  "report_read_failed",    // the reports could not be read. NOT "no report" - it is a failure, and it is counted as one
  "not_found",             // commit only: the order is no longer in the store
  "write_failed",          // commit only: the close was refused or failed; the reason travels with it
]);

/**
 * PURE. Is this report a released answer to this order, by the SAME rule the live path uses?
 *
 * Laboratory (and procedure, referral, other): any report at all, because lab-result.js
 * releaseResult closes the order on any release, a preliminary one included - the value is on the
 * chart and a second person verifying it is a new version of the same report, not a new answer.
 * Imaging: final or corrected only, because radiology-report.js closes on those alone and a
 * preliminary reading still owes a final one.
 */
function isReleasedFor(report, order) {
  if (!report || str(report.serviceRequestId) !== str(order.id)) return false;
  if (effectiveCategory(order) !== "imaging") return true;
  const s = str(report.status);
  return s === "final" || s === "corrected";
}

/** PURE. An empty tally of the grouped reasons, so a zero reads as zero and never as absent. */
function emptyReasons() {
  const out = {};
  for (const r of REASONS) out[r] = 0;
  return out;
}

async function openService(request, env, ctx, need) {
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

/**
 * The DiagnosticReports of one patient, read once per patient per batch through the caller's own
 * governed read. A read that FAILS answers null, never an empty list: an empty list here would be
 * read as "this order was never resulted", which is the one wrong answer that matters - it would
 * leave a finished order on the bench for ever, or (on the commit side) is the failure that must be
 * counted rather than silently turned into a decision.
 */
function reportReader(svc) {
  const cache = new Map();
  return async (patientId) => {
    const pid = str(patientId);
    if (!pid) return null;
    if (!cache.has(pid)) {
      let rows = null;
      try { rows = await svc.byPatient("DiagnosticReport", pid); } catch { rows = null; }
      cache.set(pid, rows);
    }
    return cache.get(pid);
  };
}

/** PURE-ish. What one open order's situation is, given the reports of its patient. */
function verdictFor(order, reports) {
  if (!isOpenOrder(order)) return "already_closed";
  if (isExternalRecord(order)) return "external_order";
  if (reports == null) return "report_read_failed";
  const mine = reports.filter((r) => r && str(r.serviceRequestId) === str(order.id));
  if (!mine.length) return "no_report";
  if (mine.some((r) => isReleasedFor(r, order))) return "close";
  // Imaging with a reading that is not final or corrected. The only way to be here.
  return "report_preliminary";
}

/** The same verdict, but only reading a patient's reports when the cheap checks have not settled it. */
async function verdictOf(order, reportsOf) {
  if (!isOpenOrder(order)) return "already_closed";
  if (isExternalRecord(order)) return "external_order";
  return verdictFor(order, await reportsOf(order.patientId));
}

/**
 * THE DRY RUN. One page of open orders, what would close, and why the rest would not. Writes nothing.
 *
 * ctx: { migration, cursor?, limit? } -> { scanned, wouldClose, orderIds, stayOpen, cursor, nextCursor, done }
 *
 * `done` is true only when the store said there is no next page. A page that could not be read is a
 * 502 with `done` absent: "the read failed" and "there is nothing left" must never be the same answer
 * on a screen whose whole job is to say how much work is left.
 */
async function scanOrderClosures(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: (mig && mig.mode) || null, tenantId: (mig && mig.tenantId) || null, run: "dry-run" };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", scanned: 0, wouldClose: 0, orderIds: [], stayOpen: emptyReasons(), done: true };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, scanned: 0, wouldClose: 0, orderIds: [], stayOpen: emptyReasons() };

  const cursor = Math.max(0, Number(ctx.cursor) || 0);
  const limit = Math.max(1, Math.min(BATCH_MAX, Number(ctx.limit) || BATCH_DEFAULT));

  let page;
  try { page = await svc.pageByStatus("ServiceRequest", OPEN_ORDER_STATUSES, { afterSeq: cursor, limit }); }
  catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message),
      scanned: 0, wouldClose: 0, orderIds: [], stayOpen: emptyReasons(), cursor };
  }

  const reportsOf = reportReader(svc);
  const stayOpen = emptyReasons(), orderIds = [];
  for (const order of page.rows) {
    if (!order || !order.id) continue;
    const verdict = await verdictOf(order, reportsOf);
    if (verdict === "close") orderIds.push(str(order.id));
    else stayOpen[verdict] += 1;
  }

  return {
    ...base, ok: true, scanned: page.rows.length, wouldClose: orderIds.length, orderIds, stayOpen,
    cursor, nextCursor: page.next, done: page.next == null,
    /* A batch where the reports of some patient could not be read has NOT been fully scanned. The
     * screen says so rather than presenting its count as the whole picture. */
    ...(stayOpen.report_read_failed ? { partial: true } : {}),
    written: 0,
  };
}

/**
 * THE COMMIT. Closes only the order ids a scan handed back, each one re-checked from the store first.
 *
 * ctx: { migration, orderIds } -> { closed, skipped, reasons, failures }
 *
 * Idempotent by construction: an order that is already closed is not in the store's open page any
 * more and is refused here by name, so running the same list twice writes nothing the second time.
 * Nothing partial is ever reported as success - `closed` is the count of orders whose new version
 * actually landed, and every other id is in `reasons` with the word for why.
 */
async function closeOrderBacklog(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: (mig && mig.mode) || null, tenantId: (mig && mig.tenantId) || null, run: "commit" };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", closed: 0, written: 0, reasons: emptyReasons(), failures: [] };

  const ids = [...new Set((Array.isArray(ctx.orderIds) ? ctx.orderIds : []).map(str).filter(Boolean))];
  if (!ids.length) {
    return { ...base, ok: false, status: 422, error: "order_ids_required",
      detail: "A backfill closes the orders a dry run listed. Run the scan first and send its order ids.", closed: 0, written: 0, reasons: emptyReasons(), failures: [] };
  }
  if (ids.length > COMMIT_MAX) {
    return { ...base, ok: false, status: 422, error: "too_many_orders",
      detail: `A batch closes at most ${COMMIT_MAX} orders. Send the scan's batches one at a time.`, closed: 0, written: 0, reasons: emptyReasons(), failures: [] };
  }

  // record:write, because this writes the clinical record - through the closure's own actor, but on
  // the authority of the person who pressed the button, and their id is stamped on every version.
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, closed: 0, written: 0, reasons: emptyReasons(), failures: [] };

  const reportsOf = reportReader(svc);
  const closeDeps = { repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actorId: resolved.actor.id, on: "backfill" };
  const reasons = emptyReasons(), failures = [];
  let closed = 0;

  for (const id of ids) {
    let order;
    try { order = await svc.get("ServiceRequest", id); }
    catch (e) { reasons.report_read_failed += 1; failures.push({ orderId: id, reason: "read_failed", detail: str(e && e.message) }); continue; }
    if (!order) { reasons.not_found += 1; failures.push({ orderId: id, reason: "not_found" }); continue; }

    /* THE LIST IS NOT THE AUTHORITY, THE STORE IS. Re-checked here on purpose: a scan is a moment in
     * the past, and between it and this button the order may have been cancelled, amended or closed. */
    const verdict = await verdictOf(order, reportsOf);
    if (verdict !== "close") { reasons[verdict] += 1; continue; }

    const r = await closeOrderOnResult(closeDeps, order);
    if (r.closed) { closed += 1; continue; }
    reasons.write_failed += 1;
    failures.push({ orderId: id, reason: "write_failed", detail: r.reason || null });
  }

  return {
    ...base, ok: true, closed, written: closed, asked: ids.length, reasons, failures,
    actor: resolved.actor.id, role: resolved.role,
    /* An order that would not close is not a failure of the run, but it is emphatically not a
     * success either: the caller is told, and the screen shows it rather than a tidy tick. */
    ...(failures.length ? { incomplete: true } : {}),
  };
}

export { BATCH_DEFAULT, BATCH_MAX, COMMIT_MAX, REASONS, isReleasedFor, verdictFor, verdictOf, scanOrderClosures, closeOrderBacklog };
