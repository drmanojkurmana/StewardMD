/* functions/_wardsynq/source-order-close.js - closing the orders the SENDING system has finished.
 *
 * An order that arrives from a laboratory information system or another hospital's EMR lands here as
 * `draft`: the ingest door writes as an ADAPTER actor (service.js governedForIngest) and the adapter
 * ceiling caps it at the draft tier, so an upstream "active" - or even an upstream "completed" -
 * cannot be committed as itself. That ceiling is right and is not moved here.
 *
 * WHAT IT LEAVES BEHIND is a census that only grows. `draft` is in OPEN_ORDER_STATUSES, so the
 * ingested order correctly appears on the laboratory, specimen and imaging boards - and if the
 * result is filed UPSTREAM rather than in WardSynQ, closeOrderOnResult() never runs for it and it
 * stays open for ever. Every order a real LIS feed ever sent counts against OPEN_CENSUS_MAX (5,000),
 * and the day it is reached those three boards refuse. Months, not weeks, on a hospital with a feed.
 *
 * THE SENDER'S WORD IS KEPT, AND IS NOT AUTHORITY. The adapter already records what the sending
 * system called the order, beside the order and never as the order's own status:
 * `externalStatus` (wardsynq-sccm-adapter.js, from FHIR ServiceRequest.status or the HL7 ORC). That
 * is the non-authoritative field this pass reads; nothing else in the tree treats it as the
 * record's status, and this pass does not either. It is evidence, and a local governed actor acts
 * on it - exactly as a released result is evidence and closeOrderOnResult acts on that.
 *
 * SO AN ADAPTER NEVER CLOSES A CLINICAL ORDER. The adapter writes draft, as before. The closing
 * write is made by the order closure actor with `roleSource: "wardsynq-source-terminal"`, on the
 * authority of the administrator who pressed the button, whose id is stamped on the new version;
 * service.js sourceTerminalClosure() admits that one write past external authority and refuses it
 * if ANY other field would change. The record keeps its `externalStatus` and its `meta.source`, and
 * carries `completedOn: "source-terminal"`, so the audit trail says plainly that the assertion came
 * from outside and the closure was made here.
 *
 * AN ORDER THE SENDER STILL CALLS ACTIVE IS NEVER TOUCHED. Nor is one whose sender said nothing,
 * or said a word this system does not know: `unknown` is not a terminal status, and a test that may
 * still be owed stays on the board where a human can see it.
 *
 * Shaped like order-backfill.js and for the same reasons: dry run first, one page per request off
 * the store's own cursor, resumable, safe to run twice (a closed order is no longer in the open page
 * and the commit refuses it by name), and nothing partial ever reported as a success.
 */

import { RecordService, isExternalRecord, SOURCE_TERMINAL_STATUSES } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { OPEN_ORDER_STATUSES, closeOrderOnResult } from "./ward-order.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* One page of open orders per request - the same sizes as order-backfill.js, because it is the same
 * shape of job against the same store and two different batch vocabularies on one admin screen is
 * how an administrator loses track of which run is which. */
const BATCH_DEFAULT = 100;
const BATCH_MAX = 500;
const COMMIT_MAX = BATCH_MAX;

/** PURE. The sender's own word for an ingested order. Never read as the record's status. */
function sourceStatus(order) {
  return str(order && order.externalStatus).toLowerCase();
}

/** PURE. Has the sending system finished with this order? An unknown or absent word has not. */
function sourceSaysFinished(order) {
  return SOURCE_TERMINAL_STATUSES.includes(sourceStatus(order));
}

/** PURE. Why an order this pass met stays open. Every reason the screen shows comes from this list. */
const REASONS = Object.freeze([
  "native_order",          // this hospital's own order; order-backfill.js closes those, on a result
  "source_active",         // the sending system still calls it open, or has not said. It stays.
  "already_closed",        // its stored status is already closed; nothing is rewritten
  "not_found",             // commit only: the order is no longer in the store
  "write_failed",          // commit only: the close was refused or failed; the reason travels with it
]);

function emptyReasons() {
  const out = {};
  for (const r of REASONS) out[r] = 0;
  return out;
}

/** PURE. What one order's situation is. Reads the STORED status, and the sender's word beside it. */
function verdictFor(order) {
  if (!order || !order.id) return "not_found";
  if (SOURCE_TERMINAL_STATUSES.includes(str(order.status))) return "already_closed";
  if (!isExternalRecord(order)) return "native_order";
  if (!sourceSaysFinished(order)) return "source_active";
  return "close";
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
 * THE DRY RUN. One page of open orders, which of them the sending system has finished, and why the
 * rest stay. Writes nothing.
 *
 * ctx: { migration, cursor?, limit? } -> { scanned, wouldClose, orders, stayOpen, nextCursor, done }
 *
 * `orders` carries the sender's word per order, because "close 14 orders" is not a thing an
 * administrator can check and "14 orders the LIS says are completed" is.
 */
async function scanSourceClosures(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: (mig && mig.mode) || null, tenantId: (mig && mig.tenantId) || null, run: "dry-run" };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", scanned: 0, wouldClose: 0, orders: [], orderIds: [], stayOpen: emptyReasons(), done: true };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, scanned: 0, wouldClose: 0, orders: [], orderIds: [], stayOpen: emptyReasons() };

  const cursor = Math.max(0, Number(ctx.cursor) || 0);
  const limit = Math.max(1, Math.min(BATCH_MAX, Number(ctx.limit) || BATCH_DEFAULT));

  let page;
  try { page = await svc.pageByStatus("ServiceRequest", OPEN_ORDER_STATUSES, { afterSeq: cursor, limit }); }
  catch (e) {
    /* A page that could not be read is a 502 with `done` absent. "The read failed" and "there is
     * nothing left" must never be the same answer on a screen whose job is to say how much is left. */
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message),
      scanned: 0, wouldClose: 0, orders: [], orderIds: [], stayOpen: emptyReasons(), cursor };
  }

  const stayOpen = emptyReasons(), orders = [];
  for (const order of page.rows) {
    if (!order || !order.id) continue;
    const verdict = verdictFor(order);
    if (verdict === "close") orders.push({ orderId: str(order.id), system: str(order.meta && order.meta.source && order.meta.source.system), sourceStatus: sourceStatus(order) });
    else stayOpen[verdict] += 1;
  }

  return {
    ...base, ok: true, scanned: page.rows.length, wouldClose: orders.length, orders,
    orderIds: orders.map((o) => o.orderId), stayOpen,
    cursor, nextCursor: page.next, done: page.next == null, written: 0,
  };
}

/**
 * THE COMMIT. Closes only the order ids a scan handed back, each one re-checked from the store first.
 *
 * ctx: { migration, orderIds } -> { closed, reasons, failures }
 *
 * The list is not the authority, the store is: between a scan and this button an order may have been
 * amended, cancelled, or superseded by a message from the same sending system, so every id is read
 * again and re-judged before anything is written. Idempotent by construction - a closed order is no
 * longer in the open page and is refused here by name.
 */
async function closeSourceTerminal(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: (mig && mig.mode) || null, tenantId: (mig && mig.tenantId) || null, run: "commit" };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", closed: 0, written: 0, reasons: emptyReasons(), failures: [] };

  const ids = [...new Set((Array.isArray(ctx.orderIds) ? ctx.orderIds : []).map(str).filter(Boolean))];
  if (!ids.length) {
    return { ...base, ok: false, status: 422, error: "order_ids_required",
      detail: "This closes the orders a dry run listed. Run the scan first and send its order ids.", closed: 0, written: 0, reasons: emptyReasons(), failures: [] };
  }
  if (ids.length > COMMIT_MAX) {
    return { ...base, ok: false, status: 422, error: "too_many_orders",
      detail: `A batch closes at most ${COMMIT_MAX} orders. Send the scan's batches one at a time.`, closed: 0, written: 0, reasons: emptyReasons(), failures: [] };
  }

  // record:write, because this writes the clinical record - through the closure's own actor, but on
  // the authority of the person who pressed the button, and their id is stamped on every version.
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, closed: 0, written: 0, reasons: emptyReasons(), failures: [] };

  const closeDeps = { repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actorId: resolved.actor.id, on: "source-terminal" };
  const reasons = emptyReasons(), failures = [];
  let closed = 0;

  for (const id of ids) {
    let order;
    try { order = await svc.get("ServiceRequest", id); }
    catch (e) { failures.push({ orderId: id, reason: "read_failed", detail: str(e && e.message) }); continue; }
    if (!order) { reasons.not_found += 1; failures.push({ orderId: id, reason: "not_found" }); continue; }

    const verdict = verdictFor(order);
    if (verdict !== "close") { reasons[verdict] += 1; continue; }

    const r = await closeOrderOnResult(closeDeps, order);
    if (r.closed) { closed += 1; continue; }
    reasons.write_failed += 1;
    failures.push({ orderId: id, reason: "write_failed", detail: r.reason || null });
  }

  return {
    ...base, ok: true, closed, written: closed, asked: ids.length, reasons, failures,
    actor: resolved.actor.id, role: resolved.role,
    /* An order that would not close is not a failure of the run, and it is emphatically not a
     * success either: the caller is told, and the screen shows it rather than a tidy tick. */
    ...(failures.length ? { incomplete: true } : {}),
  };
}

export { BATCH_DEFAULT, BATCH_MAX, COMMIT_MAX, REASONS, sourceStatus, sourceSaysFinished, verdictFor, scanSourceClosures, closeSourceTerminal };
