/* functions/_wardsynq/stores.js - general stores: what a department asks for, who says yes, and what it was given.
 *
 * ONE LEDGER. The store's stock is stock.js's StockMovement, the same record the pharmacy counts: a delivery is a
 * receipt, an issue to a department is a transfer out of the central store and into the department's sub-store,
 * a spare part fitted by an engineer is a consumption. Nothing here keeps a second count of anything, so the store
 * level, the pharmacy level and the consumption report can never disagree about the same box.
 *
 * AN INDENT'S STATE IS DERIVED, NEVER STORED. Like a purchase order in purchasing.js, an indent holds only what was
 * asked for. The in-charge's decision is its own record (IndentDecision), what was issued is the sum of the
 * transfers booked against it, what the ward acknowledged is its own record (IndentReceipt), and a back-order the
 * store will not fill is closed by its own record (IndentClosure). A part-issued indent is what the arithmetic says.
 *
 * FOUR PEOPLE, FOUR AUTHORITIES (_queue_roles.js). The ward raises (dept.request), the department's in-charge
 * approves (stores.indent.approve, within the membership's department scope, and never their own indent), the
 * store issues (stores.manage), and the ward acknowledges what arrived. The record grants in actor.js keep each
 * authority out of the others' records.
 *
 * NOTHING IS ISSUED BEYOND WHAT WAS APPROVED, and nothing is reported issued that was not written. An issue of
 * several lines writes each line's two movements in turn; if any write fails the answer is a failure that names the
 * lines that DID land, because those boxes left the shelf on the record and a retry must not issue them twice.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { levelsFrom, flagLevels, nearExpiry, recordMovement, MOVE_TYPE } from "./stock.js";
import { raisePurchaseOrder } from "./purchasing.js";

const str = (v) => (v == null ? "" : String(v).trim());
const key = (v) => str(v).toUpperCase();
/* Every stores record of a kind is read (service.listAll, paged, oldest first). Past READ_CAP the NEWEST are the ones not
 * read: an overview or report says so, an indent step refuses (409). ponytail: audit O20 is the upgrade if paging is slow. */
const READ_CAP = 50000;

const CATEGORIES = Object.freeze(["consumables", "linen", "stationery", "housekeeping", "surgical-supplies", "other"]);
const LOCATION_KINDS = Object.freeze(["central", "sub-store"]);

/** A plain number above zero, or null. Same strictness as purchasing.js: "a few" is not a quantity. */
function positive(v) {
  const s = str(v);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const codeOf = (v) => str(v).toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

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
function readFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
  return { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });

/** Latest version of each id: a list read returns versions, and an edited item must not appear twice. */
function latest(rows) {
  const m = new Map();
  for (const r of rows || []) { if (!r || !str(r.id)) continue; const p = m.get(r.id); if (!p || Number(r.version || 0) >= Number(p.version || 0)) m.set(r.id, r); }
  return [...m.values()];
}

/**
 * PURE. Where one indent stands, from its own records. Never stored.
 * movements: StockMovement rows (only transfer-in rows naming this indent count as issued).
 */
function indentState(indent, decisions, movements, receipts, closures) {
  const id = str(indent && indent.id);
  const mine = (rows) => (rows || []).filter((r) => r && str(r.indentId) === id);
  const decision = mine(decisions).sort((a, b) => str(a.at).localeCompare(str(b.at)))[0] || null;
  const closure = mine(closures)[0] || null;
  const ins = mine(movements).filter((m) => str(m.kind) === "transfer-in");
  const acks = mine(receipts);
  const lines = (Array.isArray(indent && indent.lines) ? indent.lines : []).map((l) => {
    const same = (r) => key(r.code) === key(l.code) && key(r.quantity && r.quantity.unit) === key(l.unit);
    const issued = ins.filter(same).reduce((a, m) => a + (Number(m.quantity && m.quantity.value) || 0), 0);
    const dl = decision && Array.isArray(decision.lines) ? decision.lines.find((x) => key(x.code) === key(l.code)) : null;
    const approved = !decision || str(decision.decision) !== "approved" ? 0
      : dl && dl.approvedQuantity != null && str(dl.approvedQuantity) !== "" ? Number(dl.approvedQuantity) : Number(l.quantity);
    const acknowledged = acks.reduce((a, r) => {
      const x = (Array.isArray(r.lines) ? r.lines : []).find((y) => key(y.code) === key(l.code));
      return a + (x ? Number(x.received) || 0 : 0);
    }, 0);
    return {
      code: str(l.code), display: str(l.display) || str(l.code), unit: str(l.unit), requested: Number(l.quantity),
      approved, issued, backOrder: closure ? 0 : Math.max(0, approved - issued), acknowledged,
      ...(acknowledged > 0 && acknowledged !== issued ? { discrepancy: issued - acknowledged } : {}),
    };
  });
  let state;
  if (!decision) state = "awaiting-approval";
  else if (str(decision.decision) === "rejected") state = "rejected";
  else if (lines.every((l) => l.issued >= l.approved)) state = "issued";
  else if (closure) state = "closed";
  else if (lines.some((l) => l.issued > 0)) state = "part-issued";
  else state = "approved";
  const anyIssued = lines.some((l) => l.issued > 0);
  return {
    indentId: id, departmentId: str(indent.departmentId), departmentName: str(indent.departmentName),
    fromLocation: str(indent.fromLocation), toLocation: str(indent.toLocation),
    raisedBy: str(indent.raisedBy), raisedAt: str(indent.raisedAt), note: str(indent.note) || null,
    state, lines,
    decision: decision ? { decision: str(decision.decision), by: str(decision.by), at: str(decision.at), reason: str(decision.reason) || null } : null,
    closure: closure ? { by: str(closure.by), at: str(closure.at), reason: str(closure.reason) } : null,
    acknowledged: anyIssued && lines.every((l) => l.acknowledged >= l.issued),
    backOrdered: lines.some((l) => l.backOrder > 0) && anyIssued,
  };
}

/**
 * PURE. What each department used between two dates: stock transferred into a sub-store that belongs to it, plus
 * parts consumed against it. Per (department, item, unit); units are never added together.
 */
function consumptionByDepartment(movements, locations, fromIso, toIso) {
  const deptOf = new Map((locations || []).map((l) => [key(l.code), { id: str(l.departmentId), name: str(l.departmentName) }]));
  const rows = new Map();
  for (const m of movements || []) {
    if (!m || !m.quantity) continue;
    const at = str(m.at);
    if ((fromIso && at < fromIso) || (toIso && at > toIso)) continue;
    let dept = null;
    if (str(m.kind) === "transfer-in") dept = deptOf.get(key(m.location)) || null;
    else if (str(m.kind) === "consumption" && str(m.departmentId)) dept = { id: str(m.departmentId), name: "" };
    if (!dept || !dept.id) continue;
    const k = `${dept.id}|${key(m.code)}|${key(m.quantity.unit)}`;
    const row = rows.get(k) || { departmentId: dept.id, departmentName: dept.name, code: str(m.code), display: str(m.display) || str(m.code), unit: str(m.quantity.unit), quantity: 0 };
    row.quantity += Number(m.quantity.value) || 0;
    rows.set(k, row);
  }
  return [...rows.values()].sort((a, b) => a.departmentId.localeCompare(b.departmentId) || a.display.localeCompare(b.display));
}

async function readAll(svc, types) {
  const out = {};
  let truncated = false;
  for (const t of types) { const got = await svc.listAll(t, { max: READ_CAP }); out[t] = got.rows; if (got.truncated) truncated = true; }
  return { all: out, truncated };
}

/** GET /ward/stores - the item master, locations, store levels, below-reorder and near-expiry lists, and every indent. */
async function storesOverview(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let all, truncated;
  try { ({ all, truncated } = await readAll(svc, ["StoreItem", "StoreLocation", MOVE_TYPE, "Indent", "IndentDecision", "IndentReceipt", "IndentClosure"])); }
  catch (e) { return { ...base, ...readFailure(e) }; }
  const items = latest(all.StoreItem).sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const locations = latest(all.StoreLocation).sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const codes = new Set(items.map((i) => key(i.code)));
  const storeMoves = all[MOVE_TYPE].filter((m) => m && codes.has(key(m.code)));
  const reorder = {};
  for (const i of items) if (i.reorderLevel != null && str(i.reorderLevel) !== "") reorder[i.code] = Number(i.reorderLevel);
  /* A store level is the sum of the movements at each location; the reorder level applies to the central store,
   * because that is where a purchase order is raised from. A department's sub-store is not reordered from here. */
  const central = new Set(locations.filter((l) => l.kind === "central").map((l) => key(l.code)));
  const computed = levelsFrom(storeMoves, []);
  const flagged = flagLevels(computed.levels.filter((r) => central.has(key(r.location))), reorder);
  const subLevels = computed.levels.filter((r) => !central.has(key(r.location)));
  const indents = all.Indent.filter(Boolean).map((i) => indentState(i, all.IndentDecision, all[MOVE_TYPE], all.IndentReceipt, all.IndentClosure))
    .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  return {
    ...base, ok: true, categories: CATEGORIES,
    items: items.map((i) => ({ code: i.code, name: i.name, category: i.category, unit: i.unit, reorderLevel: i.reorderLevel == null ? null : i.reorderLevel, active: i.active !== false })),
    locations: locations.map((l) => ({ code: l.code, name: l.name, kind: l.kind, departmentId: l.departmentId || null, departmentName: l.departmentName || null, active: l.active !== false })),
    levels: [...flagged.levels, ...subLevels].sort((a, b) => str(a.display).localeCompare(str(b.display))),
    belowReorder: flagged.belowReorder, negative: flagged.negative,
    expiring: nearExpiry(storeMoves, ctx.nearExpiryDays, ctx.now),
    indents, problems: computed.problems,
    ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} stores records of one kind exist and the newest were not read, so these levels and indents may be incomplete.` } : {}),
  };
}

/** POST /ward/store-item - add or change an item in the non-drug item master. A change is a new version. */
async function saveStoreItem(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const code = codeOf(ctx.code), name = str(ctx.name), unit = str(ctx.unit), category = str(ctx.category);
  if (!code || !name || !unit) return { ...base, ok: false, status: 422, error: "item_incomplete", detail: "An item needs a code, a name and the unit it is counted in.", written: 0 };
  if (!CATEGORIES.includes(category)) return { ...base, ok: false, status: 422, error: "bad_category", detail: `category must be one of ${CATEGORIES.join(", ")}.`, written: 0 };
  const reorder = str(ctx.reorderLevel) === "" ? null : Number(ctx.reorderLevel);
  if (reorder !== null && !(Number.isFinite(reorder) && reorder >= 0)) return { ...base, ok: false, status: 422, error: "bad_reorder_level", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const record = { resourceType: "StoreItem", id: `wsq-store-item-${code.toLowerCase()}`, code, name, unit, category, reorderLevel: reorder, active: ctx.active !== false, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, item: record, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/store-location - a central store or a department's sub-store. departments: the hospital's own list. */
async function saveStoreLocation(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const code = codeOf(ctx.code), name = str(ctx.name), kind = str(ctx.kind);
  if (!code || !name) return { ...base, ok: false, status: 422, error: "location_incomplete", detail: "A store location needs a code and a name.", written: 0 };
  if (!LOCATION_KINDS.includes(kind)) return { ...base, ok: false, status: 422, error: "bad_location_kind", written: 0 };
  let dept = null;
  if (kind === "sub-store") {
    dept = (ctx.departments || []).find((d) => d && str(d.id) === str(ctx.departmentId) && d.active !== false) || null;
    if (!dept) return { ...base, ok: false, status: 422, error: "department_required", detail: "A department's sub-store must name one of this hospital's active departments.", written: 0 };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const record = { resourceType: "StoreLocation", id: `wsq-store-loc-${code.toLowerCase()}`, code, name, kind, departmentId: dept ? dept.id : null, departmentName: dept ? str(dept.name) : null, active: ctx.active !== false, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, location: record, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

async function itemsAndLocations(svc) {
  // The item master and locations check a movement: past the ceiling this throws rather than refuse a real item.
  const [items, locs] = await Promise.all(["StoreItem", "StoreLocation"].map(async (t) => (await svc.listAll(t, { max: READ_CAP, throwOnTruncate: true })).rows));
  return { items: latest(items), locations: latest(locs) };
}

/** POST /ward/store-move - a receipt, adjustment or wastage in a store, through stock.js. The item must be in the master. */
async function storeMovement(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind);
  if (!["receipt", "adjustment", "wastage"].includes(kind)) return { ...base, ok: false, status: 400, error: "unknown_kind", detail: "A store movement is a receipt, an adjustment or a wastage. Issues go through an indent.", written: 0 };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, written: 0 };
  let master;
  try { master = await itemsAndLocations(svc); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const item = master.items.find((i) => key(i.code) === key(ctx.code));
  const loc = master.locations.find((l) => key(l.code) === key(ctx.location));
  if (!item) return { ...base, ok: false, status: 422, error: "unknown_item", detail: "That item is not in the stores item master.", written: 0 };
  if (!loc) return { ...base, ok: false, status: 422, error: "unknown_location", detail: "That store location does not exist.", written: 0 };
  const qty = kind === "adjustment" ? Number(ctx.quantity) : positive(ctx.quantity);
  if (qty === null || !Number.isFinite(qty) || qty === 0) return { ...base, ok: false, status: 422, error: "quantity_required", written: 0 };
  return recordMovement(request, env, { ...ctx, kind, code: item.code, display: item.name, quantity: { value: qty, unit: item.unit }, location: loc.code });
}

/**
 * POST /ward/indent - a department asks the store for items. ctx.authorizeDepartment(departmentId) is the route's
 * scope check: a member scoped to other departments cannot raise an indent in this one's name.
 */
async function raiseIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const rawLines = Array.isArray(ctx.lines) ? ctx.lines : [];
  if (!rawLines.length) return { ...base, ok: false, status: 422, error: "lines_required", detail: "An indent with nothing on it is not an indent.", written: 0 };
  const dept = (ctx.departments || []).find((d) => d && str(d.id) === str(ctx.departmentId) && d.active !== false);
  if (!dept) return { ...base, ok: false, status: 422, error: "department_required", detail: "Name the department this indent is for.", written: 0 };
  if (ctx.authorizeDepartment) {
    const az = await ctx.authorizeDepartment(dept.id);
    if (!az.ok) return { ...base, ok: false, status: 403, error: "out_of_scope", detail: "Your membership does not cover this department.", written: 0 };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let master;
  try { master = await itemsAndLocations(svc); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const from = master.locations.find((l) => key(l.code) === key(ctx.fromLocation) && l.kind === "central" && l.active !== false);
  const to = master.locations.find((l) => key(l.code) === key(ctx.toLocation) && l.kind === "sub-store" && l.active !== false);
  if (!from) return { ...base, ok: false, status: 422, error: "unknown_store", detail: "Name the central store this indent is raised on.", written: 0 };
  if (!to || str(to.departmentId) !== str(dept.id)) return { ...base, ok: false, status: 422, error: "unknown_sub_store", detail: "Name a sub-store that belongs to this department. The store has to know where the items go.", written: 0 };
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i] || {};
    const item = master.items.find((x) => key(x.code) === key(l.code) && x.active !== false);
    const q = positive(l.quantity);
    if (!item || q === null) return { ...base, ok: false, status: 422, error: "bad_line", line: i, detail: `Line ${i + 1} needs an item from the stores item master and a plain quantity above zero.`, written: 0 };
    if (lines.some((x) => key(x.code) === key(item.code))) return { ...base, ok: false, status: 422, error: "duplicate_line", line: i, written: 0 };
    lines.push({ code: item.code, display: item.name, unit: item.unit, quantity: q });
  }
  const at = new Date().toISOString();
  const record = {
    resourceType: "Indent", id: `wsq-indent-${at.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`,
    departmentId: dept.id, departmentName: str(dept.name), fromLocation: from.code, toLocation: to.code,
    lines, note: str(ctx.note) || null, raisedBy: resolved.actor.id, raisedAt: at,
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, indentId: record.id, state: "awaiting-approval", version: out.record.version,
      detail: "Raised. Nothing is issued until the department's in-charge approves it." };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

async function readIndent(svc, indentId) {
  const [indent, got] = await Promise.all([svc.get("Indent", indentId), readAll(svc, ["IndentDecision", MOVE_TYPE, "IndentReceipt", "IndentClosure"])]);
  if (!indent) return null;
  if (got.truncated) return { tooMany: true };
  const { IndentDecision: decisions, [MOVE_TYPE]: moves, IndentReceipt: receipts, IndentClosure: closures } = got.all;
  return { indent, state: indentState(indent, decisions, moves, receipts, closures) };
}

/** POST /ward/indent-decide - the department's in-charge approves (optionally fewer) or rejects. Never their own. */
async function decideIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const decision = str(ctx.decision), indentId = str(ctx.indentId);
  if (!indentId) return { ...base, ok: false, status: 422, error: "indent_required", written: 0 };
  if (!["approved", "rejected"].includes(decision)) return { ...base, ok: false, status: 422, error: "bad_decision", written: 0 };
  if (decision === "rejected" && !str(ctx.reason)) return { ...base, ok: false, status: 422, error: "reason_required", detail: "A rejected indent says why, so the ward knows what to do instead.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await readIndent(svc, indentId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "indent_not_found", written: 0 };
  if (cur.tooMany) return { ...base, ok: false, status: 409, error: "too_many_records", written: 0 };
  if (ctx.authorizeDepartment) {
    const az = await ctx.authorizeDepartment(cur.indent.departmentId);
    if (!az.ok) return { ...base, ok: false, status: 403, error: "out_of_scope", detail: "Only an in-charge of this indent's department may decide it.", written: 0 };
  }
  if (str(cur.indent.raisedBy) === resolved.actor.id) return { ...base, ok: false, status: 403, error: "own_indent", detail: "Nobody approves their own indent. Another in-charge of the department has to.", written: 0 };
  if (cur.state.decision) return { ...base, ok: false, status: 409, error: "already_decided", decision: cur.state.decision, written: 0 };
  const lines = [];
  if (decision === "approved") {
    for (const l of cur.indent.lines || []) {
      const given = (Array.isArray(ctx.lines) ? ctx.lines : []).find((x) => x && key(x.code) === key(l.code));
      const raw = given ? str(given.approvedQuantity) : "";
      const q = raw === "" ? Number(l.quantity) : Number(raw);
      if (!Number.isFinite(q) || q < 0 || q > Number(l.quantity)) return { ...base, ok: false, status: 422, error: "bad_approved_quantity", code: l.code, detail: `The approved quantity of ${l.display} must be between 0 and the ${l.quantity} asked for.`, written: 0 };
      lines.push({ code: l.code, approvedQuantity: q });
    }
  }
  const at = new Date().toISOString();
  const record = { resourceType: "IndentDecision", id: `wsq-indent-decision-${indentId}`, indentId, decision, lines, reason: str(ctx.reason) || null, by: resolved.actor.id, at };
  try {
    /* One decision per indent: the id is the indent's, and expectedVersion 0 refuses a second one written in a race. */
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, indentId, decision, lines, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/indent-issue - the store hands over approved items. Partial issue leaves the rest back-ordered. */
async function issueIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const indentId = str(ctx.indentId);
  if (!indentId) return { ...base, ok: false, status: 422, error: "indent_required", written: 0 };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await readIndent(svc, indentId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "indent_not_found", written: 0 };
  if (cur.tooMany) return { ...base, ok: false, status: 409, error: "too_many_records", written: 0 };
  if (!["approved", "part-issued"].includes(cur.state.state)) return { ...base, ok: false, status: 409, error: "indent_not_issuable", state: cur.state.state, detail: "Only an approved indent with items still to issue can be issued against.", written: 0 };
  const wanted = [];
  for (const l of Array.isArray(ctx.lines) ? ctx.lines : []) {
    if (!l || str(l.quantity) === "" || Number(l.quantity) === 0) continue;
    const line = cur.state.lines.find((x) => key(x.code) === key(l.code));
    const q = positive(l.quantity);
    if (!line || q === null) return { ...base, ok: false, status: 422, error: "bad_line", code: str(l.code), written: 0 };
    if (q > line.backOrder) return { ...base, ok: false, status: 422, error: "over_approved", code: line.code, detail: `Only ${line.backOrder} ${line.unit} of ${line.display} is approved and not yet issued.`, written: 0 };
    wanted.push({ line, quantity: q, batch: str(l.batch) || null, expiry: str(l.expiry) || null });
  }
  if (!wanted.length) return { ...base, ok: false, status: 422, error: "nothing_to_issue", written: 0 };
  const issued = [];
  let written = 0;
  for (const w of wanted) {
    const common = { ...ctx, code: w.line.code, display: w.line.display, quantity: { value: w.quantity, unit: w.line.unit }, batch: w.batch, expiry: w.expiry, indentId, departmentId: cur.indent.departmentId, idempotencyKey: null };
    const out = await recordMovement(request, env, { ...common, kind: "transfer-out", location: cur.indent.fromLocation });
    if (!out.ok) return { ...base, ...out, ok: false, partial: written > 0, written, issued, failedLine: w.line.code, detail: `${w.line.display} could not be issued: ${out.detail || out.error}. ${issued.length ? "The lines listed as issued were written and must not be issued again." : "Nothing was issued."}` };
    written++;
    const inn = await recordMovement(request, env, { ...common, kind: "transfer-in", location: cur.indent.toLocation });
    if (!inn.ok) return { ...base, ...inn, ok: false, partial: true, written, issued, failedLine: w.line.code, detail: `${w.line.display} left ${cur.indent.fromLocation} on the record but did not arrive at ${cur.indent.toLocation}: ${inn.detail || inn.error}. Record a receipt of ${w.quantity} ${w.line.unit} at ${cur.indent.toLocation} by hand. Do not issue it again.` };
    written++;
    issued.push({ code: w.line.code, quantity: w.quantity, unit: w.line.unit });
  }
  return { ...base, ok: true, written, indentId, issued };
}

/** POST /ward/indent-acknowledge - the department says what actually arrived. A shortfall is recorded, never corrected. */
async function acknowledgeIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const indentId = str(ctx.indentId);
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await readIndent(svc, indentId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "indent_not_found", written: 0 };
  if (cur.tooMany) return { ...base, ok: false, status: 409, error: "too_many_records", written: 0 };
  if (ctx.authorizeDepartment) {
    const az = await ctx.authorizeDepartment(cur.indent.departmentId);
    if (!az.ok) return { ...base, ok: false, status: 403, error: "out_of_scope", written: 0 };
  }
  const lines = [];
  for (const l of cur.state.lines) {
    const pending = l.issued - l.acknowledged;
    if (pending <= 0) continue;
    const given = (Array.isArray(ctx.lines) ? ctx.lines : []).find((x) => x && key(x.code) === key(l.code));
    const raw = given ? str(given.received) : "";
    const q = raw === "" ? pending : Number(raw);
    if (!Number.isFinite(q) || q < 0 || q > pending) return { ...base, ok: false, status: 422, error: "bad_received_quantity", code: l.code, detail: `Received ${l.display} must be between 0 and the ${pending} ${l.unit} issued and not yet acknowledged.`, written: 0 };
    lines.push({ code: l.code, received: q, ...(q < pending ? { short: pending - q } : {}) });
  }
  if (!lines.length) return { ...base, ok: false, status: 409, error: "nothing_to_acknowledge", written: 0 };
  const at = new Date().toISOString();
  const record = { resourceType: "IndentReceipt", id: `wsq-indent-receipt-${indentId}-${at.replace(/[^0-9]/g, "")}`, indentId, lines, note: str(ctx.note) || null, by: resolved.actor.id, at };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, indentId, lines, version: out.record.version,
      ...(lines.some((l) => l.short) ? { short: true, detail: "Less arrived than was issued. It is recorded as received; the store needs to know about the difference." } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/indent-close - the store will not fill the rest of a back-order, and says why. */
async function closeIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const indentId = str(ctx.indentId), reason = str(ctx.reason);
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await readIndent(svc, indentId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "indent_not_found", written: 0 };
  if (cur.tooMany) return { ...base, ok: false, status: 409, error: "too_many_records", written: 0 };
  if (!["approved", "part-issued"].includes(cur.state.state)) return { ...base, ok: false, status: 409, error: "indent_not_open", state: cur.state.state, written: 0 };
  const record = { resourceType: "IndentClosure", id: `wsq-indent-closure-${indentId}`, indentId, reason, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, indentId, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** GET /ward/store-consumption?from&to - what each department used. Dates are ISO days; default the last 30 days. */
async function storeConsumption(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", rows: [] };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const from = str(ctx.from) || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const to = str(ctx.to) || now.toISOString().slice(0, 10);
  if (!day.test(from) || !day.test(to) || from > to) return { ...base, ok: false, status: 422, error: "bad_date_range", rows: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, rows: [] };
  let moves, locs, truncated;
  try { ({ all: { [MOVE_TYPE]: moves, StoreLocation: locs }, truncated } = await readAll(svc, [MOVE_TYPE, "StoreLocation"])); }
  catch (e) { return { ...base, ...readFailure(e), rows: [] }; }
  const names = new Map((ctx.departments || []).map((d) => [str(d.id), str(d.name)]));
  const rows = consumptionByDepartment(moves, latest(locs), from, to + "T23:59:59.999Z").map((r) => ({ ...r, departmentName: names.get(r.departmentId) || r.departmentName || r.departmentId }));
  return { ...base, ok: true, from, to, rows, ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} stock records exist and the newest were not read, so this report may be incomplete.` } : {}) };
}

/** POST /ward/store-purchase-order - order what an indent is still waiting for, through purchasing.js. */
async function purchaseFromIndent(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const indentId = str(ctx.indentId);
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await readIndent(svc, indentId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "indent_not_found", written: 0 };
  if (cur.tooMany) return { ...base, ok: false, status: 409, error: "too_many_records", written: 0 };
  const lines = cur.state.lines.filter((l) => l.backOrder > 0).map((l) => ({ item: l.code, quantity: l.backOrder, unit: l.unit }));
  if (!lines.length || !["approved", "part-issued"].includes(cur.state.state)) return { ...base, ok: false, status: 409, error: "nothing_back_ordered", written: 0 };
  /* Bought to refill the central store the indent is issued from, so it is on order for that store only (R3-1). */
  const out = await raisePurchaseOrder(request, env, { ...ctx, lines, note: `For indent ${indentId} (${cur.indent.departmentName || cur.indent.departmentId}).` + (str(ctx.note) ? " " + str(ctx.note) : ""), indentId, location: cur.indent.fromLocation });
  return { ...out, indentId };
}

export {
  CATEGORIES, LOCATION_KINDS, indentState, consumptionByDepartment,
  storesOverview, saveStoreItem, saveStoreLocation, storeMovement, raiseIndent, decideIndent, issueIndent,
  acknowledgeIndent, closeIndent, storeConsumption, purchaseFromIndent,
};
