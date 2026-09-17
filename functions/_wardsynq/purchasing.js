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
import { chainState, approvalCovers, levelsFor, amountOf } from "./verification.js";
import { levelsFrom, quantityOf, returnableFrom, MOVE_TYPE as STOCK_TYPE } from "./stock.js";

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

/* A receipt carries its quantity either as a { value, unit } (what stock.js counts, written since
 * 2026-09-13) or as a bare number beside `unit` (older receipts). Both are read. */
const amountIn = (r) => (r && r.quantity && typeof r.quantity === "object" ? qtyOf(r.quantity.value) : qtyOf(r && r.quantity));
const unitOf = (r) => str(r && (r.unit || (r.quantity && r.quantity.unit)));

/** PURE. An order's total in paise from its own lines; null when any line has no price, so nothing is
 *  ever approved against a total that silently left something out. */
function poTotalPaise(po) {
  const lines = Array.isArray(po && po.lines) ? po.lines : [];
  if (!lines.length) return null;
  let total = 0;
  for (const l of lines) {
    const q = qtyOf(l && l.quantity), p = qtyOf(l && l.unitPricePaise);
    if (q === null || p === null || p < 0) return null;
    total += Math.round(q * p);
  }
  return total;
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
    const same = mine.filter((r) => key(unitOf(r)) === unit);
    const otherUnits = mine.filter((r) => key(unitOf(r)) !== unit);
    const received = same.reduce((a, r) => a + (amountIn(r) || 0), 0);
    return {
      index: i, item: str(l && l.item), unit: str(l && l.unit),
      ordered, received,
      outstanding: ordered === null ? null : Math.max(0, ordered - received),
      ...(ordered !== null && received > ordered ? { over: received - ordered } : {}),
      ...(ordered === null ? { unusable: "The quantity on this line is not a plain number, so nothing can be said about what is outstanding." } : {}),
      ...(otherUnits.length ? { receivedInOtherUnits: otherUnits.map((r) => ({ quantity: amountIn(r), unit: str(unitOf(r)) })) } : {}),
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
    ...(str(l && l.unitPricePaise) !== "" ? { unitPricePaise: qtyOf(l.unitPricePaise) } : {}),
  }));
  const bad = lines.findIndex((l) => !l.item || !l.unit || l.quantity === null || l.quantity <= 0);
  if (bad >= 0) {
    return { ...base, ok: false, status: 422, error: "bad_line", line: bad, written: 0,
      detail: "Line " + (bad + 1) + " needs an item, a plain quantity above zero, and the unit it is counted in. The unit is not guessed at." };
  }
  const badPrice = lines.findIndex((l) => "unitPricePaise" in l && (l.unitPricePaise === null || l.unitPricePaise < 0 || !Number.isInteger(l.unitPricePaise)));
  if (badPrice >= 0) {
    return { ...base, ok: false, status: 422, error: "bad_price", line: badPrice, written: 0,
      detail: "Line " + (badPrice + 1) + " has a price that is not a whole number of paise at or above zero." };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  /* Random tail: two orders to one supplier in the same millisecond shared an id, and the second
   * silently became a new version of the first. A retry is caught by idempotencyKey. */
  const id = poIdFor(ctx.orgId, at, vendor + "-" + crypto.randomUUID().slice(0, 8));
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  try {
    const po = {
      resourceType: PO_TYPE, id, vendor, lines, raisedBy: resolved.actor.id, raisedAt: at,
      ...(str(ctx.note) ? { note: str(ctx.note) } : {}),
      /* Raised from a stores indent's back-order (stores.js): the indent it will fill, so the store can see why. */
      ...(str(ctx.indentId) ? { indentId: str(ctx.indentId) } : {}),
      /* R3-1: the store it is bought for (free text, as a receipt's location is). Reorder drafts count what is still to
       * arrive only against this store; an order that names none counts against every store holding the item. */
      ...(str(ctx.location) ? { location: str(ctx.location) } : {}),
    };
    const out = await svc.put(po, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, purchaseOrderId: id, vendor, lines, totalPaise: poTotalPaise(po), location: po.location || null,
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
    /* The shape stock.js counts: a code and a { value, unit } quantity. This used to write a bare
     * number and no code, so levelsFrom() reported every booked-in delivery as "no_quantity" and an
     * approved, received order never reached the stock level. item/unit stay for orderState(). */
    const movement = {
      resourceType: MOVE_TYPE, id, kind: "receipt",
      code: item, display: item, item, quantity: { value: quantity, unit }, unit,
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
  const state = chainState(chain, levelsFor(ctx, PO_TYPE, amountOf(chain.find((r) => str(r.kind) === "request"))));
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

  return { ...base, ok: true, orders: ordersFrom(pos, moves, verifs, ctx) };
}

/** PURE. Every order and where each stands, from the orders, the receipts and the approval rows. */
function ordersFrom(pos, moves, verifs, ctx) {
  return pos.map((po) => {
    const id = str(po.id);
    const mine = moves.filter((m) => str(m.purchaseOrderId) === id);
    const rows = verifs.filter((r) => str(r.subjectType) === PO_TYPE && str(r.subjectId) === id);
    const reqRow = rows.find((r) => str(r.kind) === "request");
    const requestId = str((reqRow || {}).id);
    const chain = rows.filter((r) => str(r.id) === requestId || str(r.parentVerificationId) === requestId);
    const want = levelsFor(ctx, PO_TYPE, reqRow ? amountOf(reqRow) : poTotalPaise(po) === null ? undefined : poTotalPaise(po));
    const approval = chain.length ? chainState(chain, want) : { state: "none", approvals: 0, required: want, approvers: [] };
    return { purchaseOrderId: id, vendor: str(po.vendor), raisedBy: str(po.raisedBy), raisedAt: str(po.raisedAt),
      ...(str(po.indentId) ? { indentId: str(po.indentId) } : {}),
      location: str(po.location) || null,
      totalPaise: poTotalPaise(po), ...orderState(po, mine, approval), approval };
  }).sort((a, b) => str(b.raisedAt).localeCompare(str(a.raisedAt)));
}

/* ------------------------------------------------------------------ supply chain depth (R2-4, 2026-09-17)
 *
 * RATE CONTRACTS LIVE ON THE VENDOR. A Vendor record (already a resource type, already granted to the pharmacy and the
 * store) holds the supplier's contracts: item, unit, price in paise before GST, valid from and to. Every change is a new
 * version of that one record, so what the contract said on the day an order was raised stays readable. Two contracts
 * for the same item and unit that overlap in time are refused: an order could not say which price it was held to.
 *
 * A PRICE ABOVE CONTRACT IS A WARNING, NEVER A CHANGE. The order keeps the price somebody typed; the approver is shown
 * the contract price beside it and decides. Units are compared as typed and never converted.
 *
 * A REORDER SUGGESTION IS A DRAFT WITH ITS ARITHMETIC SHOWN. Average daily use over the hospital's window, times lead
 * time plus safety days, minus the level and what is already on order. The hospital sets all four numbers (Admin); with
 * any missing there is no suggestion at all, and an item without enough history or with no use in the window is
 * refused by name rather than suggested as zero. Nothing here raises an order.
 */

const DAY_MS = 86400000;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && Number.isFinite(Date.parse(str(v)));
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const vendorIdFor = (name) => (slug(name) ? `wsq-vendor-${slug(name)}` : null);
const readFailure = (e) => ({ ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", detail: str(e && e.message) });

/** PURE. Each order line priced above an in-date contract with the same supplier, item and unit, on `onDate`. */
function contractWarnings(po, vendors, onDate) {
  const day = str(onDate).slice(0, 10);
  const v = (vendors || []).find((x) => x && key(x.name) === key(po && po.vendor));
  const contracts = v && Array.isArray(v.rateContracts) ? v.rateContracts : [];
  const warnings = [], unpriced = [];
  (Array.isArray(po && po.lines) ? po.lines : []).forEach((l, i) => {
    const c = contracts.find((k) => key(k.item) === key(l && l.item) && key(k.unit) === key(l && l.unit) && str(k.validFrom) <= day && day <= str(k.validTo));
    if (!c) return;
    const price = qtyOf(l && l.unitPricePaise);
    if (price === null) unpriced.push({ line: i, item: str(l.item), unit: str(l.unit), contractPricePaise: c.pricePaise });
    else if (price > c.pricePaise) warnings.push({ line: i, item: str(l.item), unit: str(l.unit), pricePaise: price, contractPricePaise: c.pricePaise, validTo: str(c.validTo) });
  });
  return { warnings, unpriced };
}

/** Adds or replaces one rate contract on a supplier. ctx: { vendor, item, unit, pricePaise, validFrom, validTo, reason? } */
async function saveRateContract(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const name = str(ctx.vendor).slice(0, 200), item = str(ctx.item).slice(0, 120), unit = str(ctx.unit).slice(0, 40);
  const pricePaise = qtyOf(ctx.pricePaise);
  const id = vendorIdFor(name);
  if (!id || !item || !unit) return { ...base, ok: false, status: 422, error: "contract_incomplete", detail: "A rate contract names the supplier, the item and the unit it is priced in.", written: 0 };
  if (pricePaise === null || pricePaise < 0 || !Number.isInteger(pricePaise)) return { ...base, ok: false, status: 422, error: "bad_price", detail: "The contract price is a whole number of paise at or above zero, before GST.", written: 0 };
  if (!isDate(ctx.validFrom) || !isDate(ctx.validTo) || str(ctx.validTo) < str(ctx.validFrom)) {
    return { ...base, ok: false, status: 422, error: "bad_dates", detail: "Give the dates the contract is valid from and to (YYYY-MM-DD), the end on or after the start.", written: 0 };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(VENDOR_TYPE, id); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const contracts = current && Array.isArray(current.rateContracts) ? current.rateContracts : [];
  const same = (c) => key(c.item) === key(item) && key(c.unit) === key(unit);
  const replacing = contracts.find((c) => same(c) && str(c.validFrom) === str(ctx.validFrom));
  const reason = str(ctx.reason).slice(0, 300);
  if (replacing && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "This changes a contract already recorded. Say why.", written: 0 };
  const clash = contracts.find((c) => c !== replacing && same(c) && str(c.validFrom) <= str(ctx.validTo) && str(ctx.validFrom) <= str(c.validTo));
  if (clash) {
    return { ...base, ok: false, status: 409, error: "contract_overlap", written: 0,
      detail: `This supplier already has a contract for ${item} (${unit}) valid ${clash.validFrom} to ${clash.validTo}. Contracts for one item cannot overlap, or an order could not say which price it was held to.` };
  }
  const contract = { item, unit, pricePaise, validFrom: str(ctx.validFrom), validTo: str(ctx.validTo), by: resolved.actor.id, at: new Date().toISOString(), ...(reason ? { reason } : {}) };
  /* Copy the Vendor forward (an imported supplier's GSTIN, phone, email, address, licence number); only the contracts change. */
  const record = { ...(current || {}), resourceType: VENDOR_TYPE, id, name: current ? str(current.name) || name : name,
    rateContracts: [...contracts.filter((c) => c !== replacing), contract].sort((a, b) => str(a.item).localeCompare(str(b.item)) || str(a.validFrom).localeCompare(str(b.validFrom))) };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, vendorId: id, vendor: record.name, contract, replaced: !!replacing, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** The price check for the orders an approver is looking at. ctx: { purchaseOrderIds } -> { ok, checks: { id: {...} } } */
async function purchaseOrderPriceChecks(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, checks: {} };
  const ids = [...new Set((ctx.purchaseOrderIds || []).map(str).filter(Boolean))];
  if (!ids.length) return { ok: true, checks: {} };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return error;
  try {
    const vendors = (await svc.list(VENDOR_TYPE, 500)) || [];
    const checks = {};
    for (const id of ids) {
      const po = await svc.get(PO_TYPE, id);
      /* Held to the contract in date on the day the order was raised, the price the person raising it could see. */
      if (po) checks[id] = contractWarnings(po, vendors, str(po.raisedAt) || new Date().toISOString());
    }
    return { ok: true, checks };
  } catch (e) {
    return readFailure(e);
  }
}

/** Receipts that can still go back, returns already made, and suppliers with their contracts. One read for the screen. */
async function supplyChainOverview(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", receipts: [], returns: [], vendors: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let moves, pos, vendors;
  try { [moves, pos, vendors] = await Promise.all([svc.list(STOCK_TYPE, 1000), svc.list(PO_TYPE, 200), svc.list(VENDOR_TYPE, 500)]); }
  catch (e) { return { ...base, ...readFailure(e) }; }
  moves = (moves || []).filter(Boolean);
  const poVendor = new Map((pos || []).filter(Boolean).map((p) => [str(p.id), str(p.vendor)]));
  const receipts = moves.filter((m) => str(m.kind) === "receipt").map((m) => {
    const left = returnableFrom(m, moves);
    return left && left.remaining > 0 ? { receiptId: str(m.id), code: str(m.code), display: str(m.display) || str(m.code), unit: left.unit, location: m.location || null, batch: m.batch || null,
      at: str(m.at), supplier: str(m.receivedFrom) || poVendor.get(str(m.purchaseOrderId)) || null, purchaseOrderId: str(m.purchaseOrderId) || null,
      received: left.received, returned: left.returned, remaining: left.remaining } : null;
  }).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  const returns = moves.filter((m) => str(m.kind) === "supplier-return").map((m) => {
    const q = quantityOf(m.quantity);
    return { movementId: str(m.id), receiptId: str(m.returnOfReceipt), code: str(m.code), display: str(m.display) || str(m.code), quantity: q ? q.value : null, unit: q ? q.unit : null,
      supplier: str(m.supplier), reason: str(m.reason), debitNoteNo: m.debitNoteNo || null, at: str(m.at), by: str(m.by), controlled: m.controlled === true };
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  const today = new Date().toISOString().slice(0, 10);
  return { ...base, ok: true, receipts, returns,
    vendors: (vendors || []).filter(Boolean).map((v) => ({ vendorId: str(v.id), name: str(v.name), version: v.version,
      contracts: (Array.isArray(v.rateContracts) ? v.rateContracts : []).map((c) => ({ ...c, inDate: str(c.validFrom) <= today && today <= str(c.validTo) })) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...(moves.length >= 1000 ? { truncated: true, truncatedWarning: "More than 1000 stock records exist; only the newest were read, so older receipts are not listed here." } : {}) };
}

/* The hospital's reorder numbers (wardsynq.reorderPolicy): all four or none. */
const POLICY_KEYS = Object.freeze(["windowDays", "leadTimeDays", "safetyDays", "minDataDays"]);
const POLICY_RANGE = Object.freeze({ windowDays: [7, 365], leadTimeDays: [0, 365], safetyDays: [0, 365], minDataDays: [1, 365] });

/** PURE. { value, errors } from what the Admin screen sent. */
function validateReorderPolicy(input) {
  const errors = {}, value = {};
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!i) return { value: null, errors: { policy: "Send the reorder settings as an object." } };
  for (const k of POLICY_KEYS) {
    const s = str(i[k]);
    const [lo, hi] = POLICY_RANGE[k];
    if (!/^\d{1,3}$/.test(s) || Number(s) < lo || Number(s) > hi) errors[k] = `${k} is a whole number of days from ${lo} to ${hi}.`;
    else value[k] = Number(s);
  }
  if (!errors.windowDays && !errors.minDataDays && value.minDataDays > value.windowDays) errors.minDataDays = "The minimum days of data cannot be more than the window.";
  return { value: Object.keys(errors).length ? null : value, errors };
}

/** PURE. The saved policy, or null when it is not fully and validly set. Never a default. */
function readReorderPolicy(wsqCfg) {
  const p = wsqCfg && wsqCfg.reorderPolicy;
  return p ? validateReorderPolicy(p).value : null;
}

/**
 * PURE. One draft per (item, store, unit). movements/dispenses as stock.js reads them. What is still to arrive on orders
 * that are not cancelled, rejected or received: onOrderAt Map "ITEM|STORE|UNIT" for orders naming a store, counted only
 * against that store; onOrder Map "ITEM|UNIT" for orders naming none, counted against each store holding the item
 * (onOrderNoStore on the row, so the screen can say so).
 */
function reorderSuggestionsFrom({ movements, dispenses, onOrder, onOrderAt, policy, now }) {
  const nowMs = Date.parse(str(now)) || Date.now();
  const since = nowMs - policy.windowDays * DAY_MS;
  const { levels } = levelsFrom(movements, dispenses);
  const k3 = (code, location, unit) => `${key(code)}|${key(location)}|${key(unit)}`;
  /* A dispense comes out of the one store its item was received into, as levelsFrom() decides. */
  const receivedAt = new Map();
  for (const m of movements || []) {
    const q = m && quantityOf(m.quantity);
    if (!q || (str(m.kind) !== "receipt" && str(m.kind) !== "transfer-in")) continue;
    const k = `${key(m.code)}|${key(q.unit)}`;
    const s = receivedAt.get(k) || new Set(); s.add(str(m.location) || null); receivedAt.set(k, s);
  }
  const stat = new Map();
  const note = (k, atMs, used) => {
    const r = stat.get(k) || { first: Infinity, used: 0 };
    if (Number.isFinite(atMs)) { r.first = Math.min(r.first, atMs); if (atMs >= since && atMs <= nowMs) r.used += used; }
    stat.set(k, r);
  };
  for (const m of movements || []) {
    const q = m && quantityOf(m.quantity);
    if (!q || !str(m.code)) continue;
    /* Use is what left this store for a patient, a department or the hospital's own consumption. Wastage, a count
     * correction and a return to the supplier are not use, and counting them would buy more of what is thrown away. */
    note(k3(m.code, m.location, q.unit), Date.parse(str(m.at)), ["transfer-out", "consumption"].includes(str(m.kind)) ? q.value : 0);
  }
  for (const d of dispenses || []) {
    const q = d && d.state !== "returned" && quantityOf(d.quantity);
    const code = d && (str(d.drugCode) || str(d.drug));
    if (!q || !code) continue;
    const from = receivedAt.get(`${key(code)}|${key(q.unit)}`);
    note(k3(code, from && from.size === 1 ? [...from][0] : null, q.unit), Date.parse(str(d.dispensedAt)), q.value);
  }
  return levels.map((r) => {
    const s = stat.get(k3(r.code, r.location, r.unit)) || { first: Infinity, used: 0 };
    const daysOfData = Number.isFinite(s.first) ? Math.floor((nowMs - s.first) / DAY_MS) : 0;
    const noStore = (onOrder && onOrder.get(`${key(r.code)}|${key(r.unit)}`)) || 0;
    const ordered = ((onOrderAt && onOrderAt.get(k3(r.code, r.location, r.unit))) || 0) + noStore;
    const row = { code: r.code, display: r.display, location: r.location, unit: r.unit, level: r.level, onOrder: ordered, ...(noStore ? { onOrderNoStore: noStore } : {}), daysOfData, used: s.used,
      windowDays: policy.windowDays, leadTimeDays: policy.leadTimeDays, safetyDays: policy.safetyDays };
    if (r.level < 0) return { ...row, refused: "negative_level" };
    if (daysOfData < policy.minDataDays) return { ...row, refused: "insufficient_data", minDataDays: policy.minDataDays };
    if (!(s.used > 0)) return { ...row, refused: "no_usage" };
    const daysUsed = Math.max(1, Math.min(policy.windowDays, daysOfData));
    const avgDaily = s.used / daysUsed;
    const need = avgDaily * (policy.leadTimeDays + policy.safetyDays);
    return { ...row, daysUsed, avgDaily: Math.round(avgDaily * 100) / 100, cover: Math.round(need * 100) / 100, suggestedQuantity: Math.max(0, Math.ceil(need - r.level - ordered)) };
  }).sort((a, b) => str(a.display).localeCompare(str(b.display)));
}

/** ctx: { policy, storesOnly, now? } - drafts only. storesOnly: a store keeper, who reads no dispenses; general stores items only. */
async function reorderSuggestions(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", suggestions: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, suggestions: [] };
  if (!ctx.policy) return { ...base, ok: true, configured: false, suggestions: [], detail: "Reorder suggestions are not configured: the hospital has not set the window, lead time, safety days and minimum days of data (Admin)." };
  let moves, dispenses, pos, verifs, items;
  try {
    [moves, dispenses, pos, verifs, items] = await Promise.all([svc.list(STOCK_TYPE, 1000), ctx.storesOnly ? [] : svc.list("MedicationDispense", 1000),
      svc.list(PO_TYPE, 200), svc.list("Verification", 500), ctx.storesOnly ? svc.list("StoreItem", 1000) : null]);
  } catch (e) {
    return { ...base, ...readFailure(e), suggestions: [] };
  }
  /* A suggestion from a partial ledger is wrong in a direction nobody can see, so none is made. */
  if ((moves || []).length >= 1000 || (dispenses || []).length >= 1000 || (pos || []).length >= 200) {
    return { ...base, ok: false, status: 409, error: "too_many_records", detail: "More stock or order records exist than can be read at once, so usage cannot be worked out safely. No suggestion was made.", suggestions: [] };
  }
  const onOrder = new Map(), onOrderAt = new Map();
  for (const o of ordersFrom((pos || []).filter(Boolean), (moves || []).filter((m) => m && str(m.purchaseOrderId)), (verifs || []).filter(Boolean), ctx)) {
    if (!["open", "part-received", "awaiting-approval"].includes(o.state)) continue;
    for (const l of o.lines) {
      if (!(l.outstanding > 0)) continue;
      const [map, k] = o.location ? [onOrderAt, `${key(l.item)}|${key(o.location)}|${key(l.unit)}`] : [onOrder, `${key(l.item)}|${key(l.unit)}`];
      map.set(k, (map.get(k) || 0) + l.outstanding);
    }
  }
  let suggestions = reorderSuggestionsFrom({ movements: (moves || []).filter(Boolean), dispenses: (dispenses || []).filter(Boolean), onOrder, onOrderAt, policy: ctx.policy, now: ctx.now });
  if (ctx.storesOnly) { const codes = new Set((items || []).map((i) => key(i && i.code))); suggestions = suggestions.filter((r) => codes.has(key(r.code))); }
  return { ...base, ok: true, configured: true, policy: ctx.policy, suggestions, draft: true };
}

export {
  PO_TYPE, VENDOR_TYPE, qtyOf, poIdFor, orderState, poTotalPaise, ordersFrom,
  raisePurchaseOrder, receiveGoods, listPurchaseOrders,
  contractWarnings, saveRateContract, purchaseOrderPriceChecks, supplyChainOverview,
  validateReorderPolicy, readReorderPolicy, reorderSuggestionsFrom, reorderSuggestions,
};
