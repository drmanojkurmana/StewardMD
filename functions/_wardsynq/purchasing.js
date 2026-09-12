/* functions/_wardsynq/purchasing.js — ordering stock from a supplier, and receiving it.
 *
 * stock.js has said "NOTHING HERE PURCHASES ANYTHING" since it was written, and was right to: a
 * reorder list is a pharmacist's reading, and placing an order is a commercial act that spends a
 * hospital's money and needs somebody's name against it. This is that act, added deliberately, with
 * the same three disciplines stock.js already keeps.
 *
 * DERIVED, NEVER STORED. How much of a purchase order has arrived is computed by adding up the
 * goods received against it, exactly as a stock level is computed by adding up movements. There is
 * no `receivedQty` column to drift, and no `status` field to disagree with the events under it. A
 * partly-delivered order is not a state somebody remembered to set; it is what the arithmetic says.
 *
 * A GOODS RECEIPT IS A STOCK MOVEMENT, NOT A SECOND LEDGER. Receiving against an order writes the
 * receipt stock.js already has, carrying the order it belongs to. Danphe keeps a separate inventory
 * ledger alongside its stock ledger and they can disagree; when two records describe the same
 * physical box, one of them is going to be wrong and nobody will know which. So there is one.
 *
 * APPROVAL IS THE CHAIN, NOT A FLAG. A purchase order is approved through verification.js like
 * anything else: append-only, by somebody other than whoever raised it, at however many levels the
 * hospital asked for. "PurchaseOrder" was already one of its subjects.
 *
 * OVER-DELIVERY IS REPORTED, NEVER SILENTLY ACCEPTED OR REFUSED. If ninety boxes were ordered and a
 * hundred arrive, a hundred arrived - the stock is real and the pharmacist is holding it, so the
 * receipt is recorded and the discrepancy is named. Refusing the receipt would leave ten boxes on a
 * shelf that no record knows about, which is the failure mode that makes a count untrustworthy.
 * Same reasoning as stock.js refusing to clamp a negative level.
 *
 * UNITS ARE NOT CONVERTED, for the same reason stock.js will not: a line ordered in boxes and
 * received in tablets are not the same number, and guessing the ratio produces a confident answer
 * that is wrong by a factor of twenty-eight. A receipt in a different unit from its line is
 * recorded and flagged, and it does not count towards that line being fulfilled.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { chainState, approvalCovers } from "./verification.js";

const str = (v) => (v == null ? "" : String(v).trim());
const key = (v) => str(v).toUpperCase();
const PO_TYPE = "PurchaseOrder";
const VENDOR_TYPE = "Vendor";
const MOVE_TYPE = "StockMovement";

/** A number that is plainly a number. Anything else is not guessed at - same rule as stock.js. */
function qtyOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = str(v);
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function poIdFor(orgId, at, salt) {
  const o = str(orgId).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const t = str(at).replace(/[^0-9a-zA-Z]+/g, "");
  const s = str(salt).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return o && t ? `wsq-po-${o}-${t}${s ? "-" + s : ""}` : null;
}

/**
 * Reads an order's lines and every receipt booked against it, and says where the order stands.
 * The ONLY place an order's state is decided. Nothing stores it.
 */
function orderState(po, receipts, approval) {
  const lines = Array.isArray(po && po.lines) ? po.lines : [];
  const booked = Array.isArray(receipts) ? receipts : [];

  const byLine = lines.map((l, i) => {
    const ordered = qtyOf(l && l.quantity);
    const unit = key(l && l.unit);
    /* A receipt that NAMES a line belongs to that line and only that line. Only one that names no
     * line falls back to matching on the item. Doing both at once double-counts a receipt whose
     * line is 0 against every other line holding the same item. */
    const mine = booked.filter((r) => (str(r.purchaseOrderLine) !== ""
      ? str(r.purchaseOrderLine) === str(i)
      : (str(r.item) && key(r.item) === key(l && l.item))));
    /* Only receipts in the SAME unit count towards the line being fulfilled. One in a different
     * unit is real stock and is recorded, but adding it here would be the unit guess this file
     * refuses to make. */
    const same = mine.filter((r) => key(r.unit) === unit);
    const otherUnits = mine.filter((r) => key(r.unit) !== unit);
    const received = same.reduce((a, r) => a + (qtyOf(r.quantity) || 0), 0);
    return {
      index: i, item: str(l && l.item), unit: str(l && l.unit),
      ordered, received,
      outstanding: ordered === null ? null : Math.max(0, ordered - received),
      ...(ordered !== null && received > ordered ? { over: received - ordered } : {}),
      ...(ordered === null ? { unusable: "The quantity on this line is not a plain number, so nothing can be said about what is outstanding." } : {}),
      ...(otherUnits.length ? { receivedInOtherUnits: otherUnits.map((r) => ({ quantity: qtyOf(r.quantity), unit: str(r.unit) })) } : {}),
    };
  });

  const usable = byLine.filter((l) => l.ordered !== null);
  const allIn = usable.length > 0 && usable.every((l) => l.received >= l.ordered);
  const anyIn = byLine.some((l) => l.received > 0);

  let state;
  if (str(po && po.cancelledAt)) state = "cancelled";
  else if (!approval || approval.state !== "approved") state = approval && approval.state === "rejected" ? "rejected" : "awaiting-approval";
  else if (allIn) state = "received";
  else if (anyIn) state = "part-received";
  else state = "open";

  return {
    state, lines: byLine,
    ...(byLine.some((l) => l.over) ? { overDelivered: true } : {}),
    ...(byLine.some((l) => l.unusable) ? { hasUnusableLines: true } : {}),
    ...(byLine.some((l) => l.receivedInOtherUnits) ? { mixedUnits: true } : {}),
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

function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}

/** Raises a purchase order. It buys nothing until it is approved. */
async function raisePurchaseOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const vendor = str(ctx.vendor);
  if (!vendor) return { ...base, ok: false, status: 422, error: "vendor_required", detail: "Say who this is being ordered from.", written: 0 };

  const rawLines = Array.isArray(ctx.lines) ? ctx.lines : [];
  if (!rawLines.length) return { ...base, ok: false, status: 422, error: "lines_required", detail: "An order with nothing on it is not an order.", written: 0 };

  const lines = rawLines.map((l) => ({
    item: str(l && l.item), quantity: qtyOf(l && l.quantity), unit: str(l && l.unit),
    ...(qtyOf(l && l.unitPrice) !== null ? { unitPrice: qtyOf(l.unitPrice) } : {}),
  }));
  const bad = lines.findIndex((l) => !l.item || !l.unit || l.quantity === null || l.quantity <= 0);
  if (bad >= 0) {
    return { ...base, ok: false, status: 422, error: "bad_line", line: bad, written: 0,
      detail: "Line " + (bad + 1) + " needs an item, a plain quantity above zero, and the unit it is counted in. The unit is not guessed at." };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = poIdFor(ctx.orgId, at, vendor);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  try {
    const po = {
      resourceType: PO_TYPE, id, vendor, lines, raisedBy: resolved.actor.id, raisedAt: at,
      ...(str(ctx.note) ? { note: str(ctx.note) } : {}),
    };
    const out = await svc.put(po, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, purchaseOrderId: id, vendor, lines,
      /* Said on the way out, because an order that looks placed and is only raised is how a ward
       * ends up waiting for stock nobody ever bought. */
      state: "awaiting-approval",
      detail: "Raised. Nothing is ordered until somebody else approves it.",
      version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** Books stock in against an order. Writes the receipt stock.js already understands. */
async function receiveGoods(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const poId = str(ctx.purchaseOrderId);
  if (!poId) return { ...base, ok: false, status: 422, error: "order_required", written: 0 };
  const item = str(ctx.item), unit = str(ctx.unit);
  const quantity = qtyOf(ctx.quantity);
  if (!item || !unit || quantity === null || quantity <= 0) {
    return { ...base, ok: false, status: 422, error: "bad_receipt", written: 0,
      detail: "Receiving needs the item, a plain quantity above zero, and the unit it arrived in." };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let po;
  try { po = await svc.get(PO_TYPE, poId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!po) return { ...base, ok: false, status: 404, error: "order_not_found", purchaseOrderId: poId, written: 0 };
  if (str(po.cancelledAt)) return { ...base, ok: false, status: 409, error: "order_cancelled", detail: "This order was cancelled. Stock that arrived against it is recorded as an ordinary receipt, not against this.", written: 0 };

  /* GOODS ARE NOT BOOKED IN AGAINST AN UNAPPROVED ORDER. Not because the stock is not real - it is,
   * and it can always be received as an ordinary receipt through stock.js - but because booking it
   * here would make an order that nobody approved look like one that was placed properly. */
  const approval = await approvalFor(svc, poId, ctx);
  if (!approval || approval.state !== "approved") {
    return { ...base, ok: false, status: 409, error: "order_not_approved", written: 0,
      detail: "This order has not been approved, so stock cannot be booked in against it. If the stock is here, record it as an ordinary receipt." };
  }

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-grn-${poId}-${str(at).replace(/[^0-9a-zA-Z]+/g, "")}`;
  try {
    const movement = {
      resourceType: MOVE_TYPE, id, kind: "receipt",
      item, quantity, unit,
      purchaseOrderId: poId,
      ...(str(ctx.line) !== "" ? { purchaseOrderLine: str(ctx.line) } : {}),
      ...(str(ctx.batch) ? { batch: str(ctx.batch) } : {}),
      ...(str(ctx.expiry) ? { expiry: str(ctx.expiry) } : {}),
      ...(str(ctx.location) ? { location: str(ctx.location) } : {}),
      receivedBy: resolved.actor.id, at,
    };
    const out = await svc.put(movement, { idempotencyKey: ctx.idempotencyKey || null });
    const after = await readOrder(svc, poId, ctx);
    return { ...base, ok: true, written: 1, receiptId: id, purchaseOrderId: poId,
      item, quantity, unit, state: after ? after.state : null, lines: after ? after.lines : [],
      /* Over-delivery is named, not refused: the boxes are on the shelf either way, and a receipt
       * turned away is stock no record knows about. */
      ...(after && after.overDelivered ? { overDelivered: true, detail: "More arrived than was ordered. It is recorded, because it is on the shelf; the difference is worth a word with the supplier." } : {}),
      ...(after && after.mixedUnits ? { mixedUnits: true, detail: "Something arrived in a different unit from the one it was ordered in. It is recorded, and it does not count towards that line, because nothing here converts between units." } : {}),
      version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** The approval chain for one order, as verification.js reads it. */
async function approvalFor(svc, poId, ctx) {
  let rows;
  try {
    const all = await svc.list("Verification", 500);
    rows = (all || []).filter((r) => r && (str(r.subjectId) === poId) && str(r.subjectType) === PO_TYPE);
  } catch { return null; }
  if (!rows.length) return null;
  const requestId = str((rows.find((r) => str(r.kind) === "request") || {}).id);
  const chain = rows.filter((r) => str(r.id) === requestId || str(r.parentVerificationId) === requestId);
  const levels = ctx && ctx.wsqCfg && ctx.wsqCfg.approvalLevels && ctx.wsqCfg.approvalLevels[PO_TYPE];
  const state = chainState(chain, Number.isFinite(levels) ? levels : 1);
  /* The rows were already narrowed to this order's subject, but the covers check is what actually
   * ties an approval to the thing it approves, so it is asked rather than assumed - an approved
   * chain that turns out to be about something else must not read as this order's approval. */
  if (state.state === "approved" && !approvalCovers(state, PO_TYPE, poId)) {
    return { ...state, state: "pending" };
  }
  return state;
}

async function readOrder(svc, poId, ctx) {
  let po, moves;
  try {
    po = await svc.get(PO_TYPE, poId);
    const all = await svc.list(MOVE_TYPE, 1000);
    moves = (all || []).filter((m) => m && str(m.purchaseOrderId) === poId);
  } catch { return null; }
  if (!po) return null;
  const approval = await approvalFor(svc, poId, ctx);
  return { purchaseOrderId: poId, vendor: str(po.vendor), raisedBy: str(po.raisedBy), raisedAt: str(po.raisedAt),
    ...orderState(po, moves, approval), approval: approval || { state: "none" } };
}

/** Every order and where each stands. */
async function listPurchaseOrders(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", orders: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, orders: [] };

  let pos, moves, verifs;
  try {
    pos = (await svc.list(PO_TYPE, 200)) || [];
    moves = (await svc.list(MOVE_TYPE, 1000)) || [];
    verifs = (await svc.list("Verification", 500)) || [];
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), orders: [] };
  }

  const levels = ctx && ctx.wsqCfg && ctx.wsqCfg.approvalLevels && ctx.wsqCfg.approvalLevels[PO_TYPE];
  const want = Number.isFinite(levels) ? levels : 1;

  const orders = pos.map((po) => {
    const id = str(po.id);
    const mine = moves.filter((m) => str(m.purchaseOrderId) === id);
    const rows = verifs.filter((r) => str(r.subjectType) === PO_TYPE && str(r.subjectId) === id);
    const requestId = str((rows.find((r) => str(r.kind) === "request") || {}).id);
    const chain = rows.filter((r) => str(r.id) === requestId || str(r.parentVerificationId) === requestId);
    const approval = chain.length ? chainState(chain, want) : { state: "none", approvals: 0, required: want, approvers: [] };
    return { purchaseOrderId: id, vendor: str(po.vendor), raisedBy: str(po.raisedBy), raisedAt: str(po.raisedAt),
      ...orderState(po, mine, approval), approval };
  }).sort((a, b) => str(b.raisedAt).localeCompare(str(a.raisedAt)));

  return { ...base, ok: true, orders };
}

export {
  PO_TYPE, VENDOR_TYPE, qtyOf, poIdFor, orderState,
  raisePurchaseOrder, receiveGoods, listPurchaseOrders,
};
