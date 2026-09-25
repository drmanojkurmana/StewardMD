/* functions/_wardsynq/stock.js - what the pharmacy believes it has, and why that is never a gate.
 *
 * pharmacy-dispense.js has said "NO INVENTORY. There is no stock level, no reorder and no location"
 * since #931, and it was right to defer it: inventory is where a medicines system most easily
 * acquires the power to stop a patient getting a drug. This adds it with that failure designed out
 * rather than promised against.
 *
 * A COUNT IS A BELIEF. THE BOX IN THE PHARMACIST'S HAND IS THE FACT. Nothing in this file can refuse
 * a dispense, and the dispense path does not import it. If the count says zero and the pharmacist is
 * holding the medicine, the patient gets the medicine and the count is wrong - which is information
 * about the record, not about the patient. The one block pharmacy-dispense.js does perform is on an
 * EXPIRED box, because that is a physical fact the pharmacist can read, and it stays there rather
 * than moving here.
 *
 * STOCK IS DERIVED FROM MOVEMENTS AND NEVER STORED AS A COUNTER. A counter loses one of two
 * concurrent updates, silently, and the direction it loses in is the direction that says there is
 * more stock than there is. Same reasoning as SafetyFiring in #921. Every movement is an append-only
 * record and the level is a sum computed on read.
 *
 * ISSUES ARE NOT RE-ENTERED. The quantity that left the pharmacy is already in the record as a
 * MedicationDispense, so the level subtracts those directly instead of asking anyone to write a
 * second movement for the same event. Double entry means the two entries can disagree, and when they
 * do, the one describing an actual patient is the one that is right.
 *
 * A NEGATIVE LEVEL IS REPORTED, NEVER CLAMPED TO ZERO. Clamping is the single most common way an
 * inventory hides its own corruption: the number stops being impossible and starts being merely
 * wrong, and nobody investigates a plausible number. A negative level means stock was issued that
 * was never received, which is either a missing delivery record or a controlled-drug problem, and
 * both need a human today.
 *
 * A REORDER LEVEL PRODUCES A LIST, NEVER AN ORDER. Nothing here purchases anything. The list is what
 * a pharmacist reads; ordering is a commercial act with an approver, and a system that placed orders
 * on its own would be a system nobody could explain the spending of.
 *
 * UNITS ARE NOT GUESSED. A movement in boxes and a dispense in tablets are not added together unless
 * an item SAYS how they relate (packFactors/toBaseUnit below, of PACK-SIZE CONVERSION): an optional,
 * per-item `packs` declaration such as a strip of 10 tablets, or a box of 10 strips. An item with no
 * `packs` behaves exactly as it always did - mixed units are reported per unit, side by side, and
 * flagged. Even with `packs` declared, a unit this file cannot resolve is refused by name, never
 * assumed to be one-to-one; a bad or looping declaration is caught at the item level (validatePacks),
 * before anything is ever received against it.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, ListCeilingError } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { witnessOrRefusal } from "./controlled-drugs.js";

const str = (v) => (v == null ? "" : String(v).trim());
const key = (v) => str(v).toUpperCase();

const MOVE_TYPE = "StockMovement";

/**
 * What a movement can be. Issues are deliberately NOT here: they come from MedicationDispense.
 *
 *   receipt     stock arrived from a supplier
 *   adjustment  a count correction, always with a reason
 *   wastage     destroyed, spilled, expired off the shelf
 *   transfer    moved between locations; written as two movements, out and in
 *   consumption used up by the hospital itself, never by a patient: a spare part fitted on a job card
 *               (assets.js). It names the job card and the department, so the store level and the
 *               consumption report read the same one movement.
 *   supplier-return  stock sent back to the supplier it came from. Written only by returnToSupplier(), which ties it
 *               to the receipt that brought the stock in and never returns more than that receipt brought.
 */
const KINDS = Object.freeze(["receipt", "adjustment", "wastage", "transfer-out", "transfer-in", "consumption", "supplier-return"]);

/** Which kinds add to a level and which take away. An issue is handled separately. */
const SIGN = Object.freeze({ receipt: 1, "transfer-in": 1, adjustment: 1, wastage: -1, "transfer-out": -1, consumption: -1, "supplier-return": -1 });

/**
 * PURE. A quantity is a number and a unit, or it is nothing.
 *
 * "Some" is not a supply record, and `Number("")` is 0 and 0 is finite - so absence is checked
 * before finiteness, as it must be everywhere in this codebase.
 */
function quantityOf(q) {
  const o = q && typeof q === "object" ? q : null;
  if (!o) return null;
  if (o.value === undefined || o.value === null || str(o.value) === "") return null;
  const value = Number(o.value);
  const unit = str(o.unit);
  if (!Number.isFinite(value) || !unit) return null;
  return { value, unit };
}

/**
 * PACK-SIZE CONVERSION (optional, per item). An item's own unit is what stock is counted in (its base
 * unit); `packs` declares how a purchasing unit ("strip", "box") converts to it:
 *
 *   packs: [{ unit: "strip", of: 10 }, { unit: "box", of: 10, packUnit: "strip" }]
 *
 * `of` is a positive integer count of `packUnit` (or of the base unit, when `packUnit` is omitted) in
 * one `unit`. Packs chain (a box of strips of tablets); a chain that loops back on itself is never
 * resolved. OPT-IN AND NEVER GUESSED: an item that declares no `packs` behaves exactly as before.
 */

/** PURE. Every unit this item declares, mapped to its factor to the base unit (the base unit itself is
 *  1). A pack this file cannot resolve - a bad factor, an unresolved packUnit, a unit declared twice,
 *  or a cycle - is named in `problems` and left out of `factors`, never guessed at. */
function packFactors(baseUnit, packs) {
  const base = str(baseUnit);
  const list = Array.isArray(packs) ? packs : [];
  const factors = new Map();
  const problems = [];
  if (!base) return { factors, problems: [{ reason: "no_base_unit" }] };
  factors.set(key(base), { unit: base, factor: 1 });

  const byUnit = new Map();
  for (const p of list) {
    const u = str(p && p.unit);
    if (!u) { problems.push({ reason: "pack_needs_unit" }); continue; }
    if (key(u) === key(base)) { problems.push({ unit: u, reason: "pack_is_base_unit" }); continue; }
    if (byUnit.has(key(u))) { problems.push({ unit: u, reason: "duplicate_pack_unit" }); continue; }
    byUnit.set(key(u), p);
  }

  const resolve = (unit, trail) => {
    const k = key(unit);
    if (factors.has(k)) return factors.get(k).factor;
    if (trail.has(k)) { problems.push({ unit, reason: "pack_cycle" }); return null; }
    const p = byUnit.get(k);
    if (!p) return null;
    const of = Number(p.of);
    if (!Number.isInteger(of) || of <= 0) { problems.push({ unit, reason: "bad_pack_factor" }); return null; }
    const via = str(p.packUnit) || base;
    trail.add(k);
    const viaFactor = resolve(via, trail);
    trail.delete(k);
    if (viaFactor === null) { problems.push({ unit, reason: "unresolved_pack_unit", packUnit: via }); return null; }
    const factor = of * viaFactor;
    factors.set(k, { unit, factor });
    return factor;
  };
  for (const p of list) resolve(str(p && p.unit), new Set());
  return { factors, problems };
}

/** { ok, problems } - whether an item's own packs are usable, checked when the item is saved so a
 *  broken declaration is refused before anything is ever received against it. No packs at all is fine. */
function validatePacks(baseUnit, packs) {
  if (!Array.isArray(packs) || !packs.length) return { ok: true, problems: [] };
  return { ok: packFactors(baseUnit, packs).problems.length === 0, problems: packFactors(baseUnit, packs).problems };
}

/** PURE. A quantity in any unit the item declares (its own base unit, or a pack of it), converted to
 *  the base unit. Never guesses: a unit that is neither is refused by name, not assumed to be 1:1. */
function toBaseUnit(baseUnit, packs, quantity) {
  const q = quantityOf(quantity);
  if (!q) return { ok: false, reason: "no_quantity" };
  const { factors } = packFactors(baseUnit, packs);
  const hit = factors.get(key(q.unit));
  if (!hit) return { ok: false, reason: "unknown_unit", detail: `"${q.unit}" is not ${str(baseUnit)} or a pack size declared for this item.` };
  return { ok: true, value: q.value * hit.factor, unit: str(baseUnit), factor: hit.factor, enteredAs: q };
}

/** PURE. "25 strip (250 tablet)" - the base quantity, and the same amount in the largest declared pack
 *  that divides it exactly (so 250 tablets with both strip=10 and box=100 declared reads in boxes, not
 *  strips). null when the item declares no packs, or none divides the quantity exactly - never a
 *  fraction of a pack shown as though it were whole. */
function dualDisplay(baseUnit, packs, baseValue) {
  if (!Array.isArray(packs) || !packs.length || !Number.isFinite(baseValue)) return null;
  const { factors } = packFactors(baseUnit, packs);
  const options = [...factors.values()].filter((f) => key(f.unit) !== key(baseUnit)).sort((a, b) => b.factor - a.factor);
  const pick = options.find((f) => baseValue !== 0 && baseValue % f.factor === 0);
  if (!pick) return null;
  return `${baseValue / pick.factor} ${pick.unit} (${baseValue} ${str(baseUnit)})`;
}

/**
 * PURE. The level of every item, per location and per unit.
 *
 * `movements` are StockMovement records; `dispenses` are MedicationDispense records, whose quantity
 * is subtracted. Returns one row per (code, location, unit) - never a single number across units.
 */
function levelsFrom(movements, dispenses) {
  const rows = new Map();
  const problems = [];

  const bump = (code, display, location, qty, delta) => {
    const k = `${key(code)}|${key(location)}|${key(qty.unit)}`;
    const row = rows.get(k) || { code, display: display || code, location: location || null, unit: qty.unit, level: 0, received: 0, issued: 0, wasted: 0, adjusted: 0, returnedToSupplier: 0 };
    row.level += qty.value * delta;
    rows.set(k, row);
    return row;
  };

  for (const m of movements || []) {
    if (!m) continue;
    const kind = str(m.kind);
    const sign = SIGN[kind];
    const qty = quantityOf(m.quantity);
    if (sign === undefined || !qty || !str(m.code)) {
      /* Reported, never skipped into silence: a movement that did not count is a discrepancy
       * somebody will otherwise find as an unexplained level. */
      problems.push({ movementId: m.id || null, reason: !qty ? "no_quantity" : (sign === undefined ? "unknown_kind" : "no_code") });
      continue;
    }
    const row = bump(m.code, m.display, m.location, qty, sign);
    if (kind === "receipt" || kind === "transfer-in") row.received += qty.value;
    else if (kind === "wastage") row.wasted += qty.value;
    else if (kind === "adjustment") row.adjusted += qty.value;
    else if (kind === "transfer-out") row.issued += 0;
    else if (kind === "consumption") row.issued += qty.value;
    else if (kind === "supplier-return") row.returnedToSupplier += qty.value;
  }

  /* AN ISSUE LEAVES THE STORE IT CAME FROM, NOT THE WARD IT WENT TO (LT-38). A dispense's `destination` is the
   * ward the medicine was sent to, and this subtracted it THERE: the pharmacy's received stock never went down, and
   * every ward that was sent a dose, having received nothing on record, read negative ("Amoxicillin, General
   * Medicine A, -12 dose"). A dispense names no source location (pharmacy-dispense.js), so it comes out of the one
   * place that item and unit were ever received into; received into several places, or nowhere, it comes out of the
   * unnamed main store (location null), where a level with no receipt at all still shows negative, as it should. */
  const receivedAt = new Map();
  for (const m of movements || []) {
    const qty = m && quantityOf(m.quantity);
    if (!qty || (str(m.kind) !== "receipt" && str(m.kind) !== "transfer-in") || !str(m.code)) continue;
    const k = `${key(m.code)}|${key(qty.unit)}`;
    const set = receivedAt.get(k) || new Set();
    set.add(str(m.location) || null);
    receivedAt.set(k, set);
  }
  for (const d of dispenses || []) {
    /* A RETURNED ISSUE CAME BACK (pharmacy-dispense.js returnDispense: "stock comes back"). It was subtracted anyway,
     * so every return left the level short by what was returned, and a controlled-drug count then read as a loss. */
    if (!d || d.state === "returned") continue;
    const qty = quantityOf(d.quantity);
    const code = str(d.drugCode) || str(d.drug);
    if (!qty || !code) {
      /* A dispense with no quantity is a real and permitted record - pharmacy-dispense.js allows it
       * - but it cannot be counted, and a level computed as though it were zero would overstate
       * stock. Named so the gap is visible rather than absorbed. */
      problems.push({ dispenseId: d.id || null, reason: "dispense_not_countable" });
      continue;
    }
    const from = receivedAt.get(`${key(code)}|${key(qty.unit)}`);
    const row = bump(code, d.drug, from && from.size === 1 ? [...from][0] : null, qty, -1);
    row.issued += qty.value;
  }

  return { levels: [...rows.values()], problems };
}

/** PURE. Which rows are at or below the hospital's reorder level, and which are impossible. */
/**
 * PURE. Per-batch balances for one item (code + unit), counting receipts, transfers, wastage and
 * dispenses that name a batch. Anything that moved stock WITHOUT naming a batch is totalled in
 * `unbatched`, because it came out of some batch nobody recorded.
 */
function batchBalances(movements, dispenses, code, unit) {
  const k = key(code), u = key(unit);
  const b = new Map();
  let unbatched = 0;
  const row = (batch, expiry) => { const r = b.get(batch) || { batch, expiry: expiry || null, onHand: 0 }; if (expiry && !r.expiry) r.expiry = expiry; b.set(batch, r); return r; };
  for (const m of movements || []) {
    const q = m && quantityOf(m.quantity); const sign = m && SIGN[str(m.kind)];
    if (!q || sign === undefined || key(m.code) !== k || key(q.unit) !== u) continue;
    if (!str(m.batch)) { if (sign < 0) unbatched += q.value; continue; }
    row(str(m.batch), str(m.expiry)).onHand += q.value * sign;
  }
  for (const d of dispenses || []) {
    const q = d && d.state !== "returned" && quantityOf(d.quantity);
    if (!q || key(str(d.drugCode) || str(d.drug)) !== k || key(q.unit) !== u) continue;
    if (!str(d.batch)) { unbatched += q.value; continue; }
    row(str(d.batch), str(d.expiry)).onHand -= q.value;
  }
  return { batches: [...b.values()], unbatched };
}

/**
 * PURE. First-expiry-first-out: which batches to take `quantity` from. REFUSES to advise when stock left
 * without a named batch (the per-batch counts cannot be trusted), and never offers an expired batch or
 * one with no expiry recorded. Reports any shortfall instead of pretending there is enough.
 */
function fefoSuggestion(balances, quantity, nowIso) {
  if (balances.unbatched > 0) return { ok: false, reason: "unbatched_issues", detail: `${balances.unbatched} left stock without a batch recorded, so batch counts cannot be trusted. Record batches when dispensing.` };
  const today = String(nowIso || new Date().toISOString()).slice(0, 10);
  const usable = balances.batches.filter((x) => x.onHand > 0 && x.expiry && x.expiry >= today).sort((a, c) => a.expiry.localeCompare(c.expiry));
  const picks = []; let need = Number(quantity);
  for (const x of usable) { if (need <= 0) break; const take = Math.min(x.onHand, need); picks.push({ batch: x.batch, expiry: x.expiry, take }); need -= take; }
  const excluded = balances.batches.filter((x) => x.onHand > 0 && !(x.expiry && x.expiry >= today)).map((x) => ({ batch: x.batch, expiry: x.expiry, onHand: x.onHand, why: x.expiry ? "expired" : "no expiry recorded" }));
  return { ok: true, picks, shortfall: Math.max(0, need), excluded };
}

function flagLevels(levels, reorderLevels) {
  const table = {};
  for (const k of Object.keys(reorderLevels || {})) table[key(k)] = reorderLevels[k];

  const belowReorder = [], negative = [];
  const out = (levels || []).map((r) => {
    const entry = table[key(r.code)];
    const raw = entry && typeof entry === "object" ? entry.level : entry;
    const at = raw === undefined || raw === null || str(raw) === "" ? null : Number(raw);
    const reorderAt = Number.isFinite(at) ? at : null;
    const row = { ...r, reorderAt };

    /* NEVER clamped. A negative level means stock was issued that was never received - a missing
     * delivery record or a controlled-drug problem - and a plausible zero is what stops anyone
     * looking into it. */
    if (r.level < 0) {
      row.impossible = true;
      row.note = "This level is negative, which cannot be true. Stock has been issued that was never recorded as received. It is shown as it computes rather than corrected to zero, because a plausible number is one nobody investigates.";
      negative.push(row);
    }
    if (reorderAt !== null && r.level <= reorderAt) {
      row.belowReorder = true;
      belowReorder.push(row);
    }
    return row;
  });

  return { levels: out, belowReorder, negative };
}

/**
 * PURE. TASK 3.4: which received batches are close to expiry, or already past it.
 *
 * Grouped by (code, location, batch) - a batch is the unit expiry actually applies to, not the
 * aggregate level. A movement with no batch and no expiry is simply not a candidate: nothing here
 * guesses an expiry for stock that was never recorded with one.
 */
function nearExpiry(movements, days, now) {
  // Number(null) is 0, and 0 is finite - so absence must be checked before finiteness, exactly the
  // discipline quantityOf() already applies to a movement's own quantity.
  const windowDays = days != null && str(days) !== "" && Number.isFinite(Number(days)) ? Number(days) : 90;
  const nowMs = now ? Date.parse(now) : Date.now();
  const rows = new Map();
  for (const m of movements || []) {
    if (!m || str(m.kind) !== "receipt") continue;
    const expiry = str(m.expiry);
    if (!expiry) continue;
    const expiryMs = Date.parse(expiry);
    if (!Number.isFinite(expiryMs)) continue;
    const k = `${key(m.code)}|${key(m.location)}|${key(m.batch)}`;
    // The SOONEST expiry recorded for this exact batch key wins - two receipts logged for what is
    // genuinely the same batch should never let a later, longer-dated entry hide the sooner one.
    const existing = rows.get(k);
    if (!existing || expiryMs < existing.expiryMs) {
      rows.set(k, { code: m.code, display: m.display || m.code, location: m.location || null, batch: m.batch || null, expiry, expiryMs });
    }
  }
  const out = [...rows.values()].map((r) => ({
    ...r, daysRemaining: Math.round((r.expiryMs - nowMs) / 86400000),
    expired: r.expiryMs < nowMs,
  })).filter((r) => r.expired || r.daysRemaining <= windowDays);
  out.sort((a, b) => a.expiryMs - b.expiryMs);
  return out;
}

/**
 * A physical count against the derived level, posted as an auditable adjustment - never a silent
 * overwrite of the level. ctx: { migration, code, location?, unit, counted, reason?, at? }
 *
 * THE VARIANCE IS THE RECORD. The adjustment movement carries the counted quantity, the level this
 * file believed before the count, and their difference - so a reader sees not just what changed but
 * what the count DISAGREED with, which is the fact a reconciliation exists to surface.
 */
async function reconcileCount(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const code = str(ctx.code), unit = str(ctx.unit);
  if (!code || !unit) return { ...base, ok: false, status: 422, error: "code_and_unit_required", written: 0 };
  const counted = Number(ctx.counted);
  if (!Number.isFinite(counted)) return { ...base, ok: false, status: 422, error: "counted_required", detail: "a reconciliation needs the number actually counted, not \"some\".", written: 0 };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, written: 0 };

  let movements, dispenses;
  try {
    [movements, dispenses] = await Promise.all([
      /* No catch: an empty read here would post a wrong adjustment into the permanent record. */
      ledger(svc, MOVE_TYPE),
      ledger(svc, "MedicationDispense"),
    ]);
  } catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ...tooMany("the expected level cannot be worked out safely. Nothing was posted."), written: 0 };
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }

  const computed = levelsFrom((movements || []).filter(Boolean), (dispenses || []).filter(Boolean));
  const k = `${key(code)}|${key(ctx.location)}|${key(unit)}`;
  const before = computed.levels.find((r) => `${key(r.code)}|${key(r.location)}|${key(r.unit)}` === k);
  const expected = before ? before.level : 0;
  const variance = counted - expected;

  if (variance === 0) {
    return { ...base, ok: true, written: 0, skipped: "no_variance", expected, counted, note: "The count matches the derived level exactly. No adjustment was needed." };
  }

  const reasonGiven = str(ctx.reason);
  const reason = `Count reconciliation. Expected ${expected} ${unit}, counted ${counted} ${unit}, variance ${variance > 0 ? "+" : ""}${variance} ${unit}.` + (reasonGiven ? ` ${reasonGiven}` : "");

  const moved = await recordMovement(request, env, {
    ...ctx, kind: "adjustment", code, display: (before && before.display) || code, location: ctx.location || null,
    quantity: { value: variance, unit }, reason, at: ctx.at,
  });
  if (!moved.ok) return moved;
  return { ...base, ok: true, written: moved.written, movementId: moved.movementId, expected, counted, variance, reason, actor: moved.actor };
}

/** PURE. More than one unit for the same item and location is reported, never summed. */
function mixedUnits(levels) {
  const seen = new Map();
  for (const r of levels || []) {
    const k = `${key(r.code)}|${key(r.location)}`;
    const set = seen.get(k) || new Set();
    set.add(r.unit);
    seen.set(k, set);
  }
  return [...seen.entries()].filter(([, u]) => u.size > 1)
    .map(([k, u]) => ({ item: k.split("|")[0], location: k.split("|")[1] || null, units: [...u] }));
}

async function open_(request, env, ctx, need) {
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
 * Records a stock movement.
 * ctx: { migration, kind, code, display?, quantity, location?, batch?, expiry?, reason?, at? }
 */
async function recordMovement(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const kind = str(ctx.kind), code = str(ctx.code);
  if (!KINDS.includes(kind)) return { ...base, ok: false, status: 400, error: "unknown_kind", detail: `kind must be one of ${KINDS.join(", ")}. An issue is not a movement: it is recorded as a MedicationDispense against an order.`, written: 0 };
  if (!code) return { ...base, ok: false, status: 422, error: "code_required", written: 0 };
  /* A return is bounded by the receipt it came from, which only returnToSupplier() checks. */
  if (kind === "supplier-return" && !(ctx.supplierReturn && typeof ctx.supplierReturn === "object")) {
    return { ...base, ok: false, status: 422, error: "use_supplier_return", detail: "A return to a supplier is recorded against the receipt it came from (Returns to suppliers), so it can never send back more than arrived.", written: 0 };
  }

  const quantity = quantityOf(ctx.quantity);
  if (!quantity) return { ...base, ok: false, status: 422, error: "quantity_required", detail: "a movement is a number and a unit. \"Some\" is not a stock record.", written: 0 };

  /* An adjustment without a reason is the movement that hides everything else. It is the only kind
   * that can make a level say whatever somebody wants it to say, so it is the one that must say why. */
  const reason = str(ctx.reason);
  if ((kind === "adjustment" || kind === "wastage") && !reason) {
    return { ...base, ok: false, status: 422, error: "reason_required", written: 0,
      detail: "an adjustment or a wastage records WHY. It is the movement that can make a level say anything, so it is the one that has to be explained." };
  }

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* A CONTROLLED DRUG IS NOT DESTROYED OR WRITTEN OFF BY ONE PERSON (controlled-drugs.js). The route decides whether
   * the item is controlled (the hospital's drug master) and hands in the check that the witness is a real, different
   * member of this hospital; a witness who is the person recording, or nobody at all, is refused and nothing lands. */
  /* NDPS Rules r.52-O: a recognised medical institution whose Form 3G recognition has expired receives no controlled
   * drug, unless it has applied for renewal (register-settings.js rmiStatus, computed by the route). */
  if (ctx.controlled === true && (kind === "receipt" || kind === "transfer-in") && ctx.rmi && ctx.rmi.blocked && (typeof ctx.rmiApplies !== "function" || ctx.rmiApplies(ctx.display, code))) {
    return { ...base, ok: false, status: 409, error: "rmi_recognition_expired", written: 0,
      detail: "The hospital's NDPS recognition (Form 3G) has expired and no renewal application is recorded (NDPS Rules r.52-O). A controlled drug cannot be received. Record the renewal application reference in Registers, Settings." };
  }
  /* NDPS Rules r.52V(3): no transfer, loan or sale of an essential narcotic drug to another institution "without the prior
   * approval of the Controller of Drugs" (legal review F.4.5). A controlled transfer out that names an institution names
   * the approval too, or it is refused. A transfer between this hospital's own stores names no institution. */
  /* A controlled drug sent back to its supplier leaves for another institution too, so the same approval is named. */
  const toInstitution = kind === "supplier-return" ? str(ctx.supplierReturn && ctx.supplierReturn.supplier) : str(ctx.toInstitution);
  if (ctx.controlled === true && (kind === "transfer-out" || kind === "supplier-return") && toInstitution && str(ctx.controllerApprovalRef).length < 3) {
    return { ...base, ok: false, status: 422, error: "controller_approval_required", written: 0,
      detail: "A controlled drug goes to another institution (transfer, loan or sale) only with the prior approval of the Controller of Drugs (NDPS Rules r.52V(3)). Record the approval reference." };
  }
  /* NDPS Rules r.52U: no more held than the Form 3J estimate (controlled-drugs.js estimateRefusal, handed in by the route for
   * an essential narcotic drug). A check that could not be made is said on the response and on the movement. */
  let estimate = null;
  if (ctx.controlled === true && (kind === "receipt" || kind === "transfer-in") && typeof ctx.estimateCheck === "function") {
    estimate = await ctx.estimateCheck({ code, display: str(ctx.display) || code, unit: quantity.unit, value: quantity.value, at: str(ctx.at), revisedEstimateRef: str(ctx.revisedEstimateRef) });
    if (estimate && estimate.refuse) return { ...base, ...estimate.refuse, written: 0 };
  }
  let witnessedBy = null;
  if (ctx.controlled === true && (kind === "wastage" || kind === "adjustment" || kind === "supplier-return")) {
    const w = await witnessOrRefusal(ctx, resolved.actor.id);
    if (w.error) return { ...base, ...w.error, written: 0 };
    witnessedBy = w.witnessId;
  }
  /* NDPS Rules r.52V(1): "The expired stock of essential narcotic drugs shall be destroyed by the recognised medical
   * institution in the presence of an officer nominated by the Controller of Drugs." A controlled wastage that is a
   * destruction of expired stock names that officer and the nominating order, or it is refused and nothing lands. */
  let destruction = null;
  if (ctx.controlled === true && kind === "wastage" && (ctx.destruction || /expir/i.test(reason))) {
    const d = ctx.destruction && typeof ctx.destruction === "object" ? ctx.destruction : {};
    const missing = ["nomineeName", "nomineeDesignation", "nominatingOrderRef", "destroyedOn"].filter((k) => !str(d[k]));
    if (missing.length || !/^\d{4}-\d{2}-\d{2}$/.test(str(d.destroyedOn))) {
      return { ...base, ok: false, status: 422, error: "destruction_nominee_required", missing, written: 0,
        detail: "Expired stock of a controlled drug is destroyed in the presence of an officer nominated by the Controller of Drugs (NDPS Rules r.52V(1)). Give the officer's name, designation, the nominating order reference and the date (YYYY-MM-DD)." };
    }
    destruction = { nomineeName: str(d.nomineeName).slice(0, 120), nomineeDesignation: str(d.nomineeDesignation).slice(0, 120), nominatingOrderRef: str(d.nominatingOrderRef).slice(0, 120), destroyedOn: str(d.destroyedOn) };
  }

  const at = str(ctx.at) || new Date().toISOString();
  /* The random tail matters: two receipts of one drug in the same millisecond used to share an id, and
   * the second became a new version of the first, so the first delivery vanished from every level.
   * A retried request is caught by idempotencyKey, not by the id. */
  const id = `wsq-stock-${key(code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "")}-${kind}-${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    resourceType: MOVE_TYPE, id, kind, code, display: str(ctx.display) || code,
    quantity, location: str(ctx.location) || null,
    batch: str(ctx.batch) || null, expiry: str(ctx.expiry) || null,
    reason: reason || null, at, by: resolved.actor.id,
    ...(ctx.controlled === true ? { controlled: true, witnessedBy } : {}),
    ...(destruction ? { destruction } : {}),
    /* Form 3H (NDPS Rules r.52R) records where a receipt came from and its consignment note, bill or invoice number.
     * Optional for every drug, kept when given. */
    ...(str(ctx.receivedFrom) ? { receivedFrom: str(ctx.receivedFrom).slice(0, 200) } : {}),
    ...(str(ctx.documentNo) ? { documentNo: str(ctx.documentNo).slice(0, 80) } : {}),
    /* PACK-SIZE CONVERSION: when a receipt was entered in a pack unit ("strip", "box") and converted to
     * the item's base unit above `quantity`, the unit and quantity as entered are kept here too - the
     * fact of what was actually counted at the pharmacy hatch, for the dual display and for an audit. */
    ...(ctx.receivedAs && quantityOf(ctx.receivedAs) ? { receivedAs: quantityOf(ctx.receivedAs) } : {}),
    /* Drugs and Cosmetics Rules r.65(21)(b)(ii), (v), (vi): a Schedule X receipt names the supplier's address and licence
     * number and the manufacturer (controlled-drugs.js rule65Register). Kept when given, for any drug. */
    ...(str(ctx.supplierAddress) ? { supplierAddress: str(ctx.supplierAddress).slice(0, 300) } : {}),
    ...(str(ctx.supplierLicenceNo) ? { supplierLicenceNo: str(ctx.supplierLicenceNo).slice(0, 80) } : {}),
    ...(str(ctx.manufacturer) ? { manufacturer: str(ctx.manufacturer).slice(0, 120) } : {}),
    ...(toInstitution && kind === "transfer-out" ? { toInstitution: toInstitution.slice(0, 200), transferKind: ["transfer", "loan", "sale"].includes(str(ctx.transferKind)) ? str(ctx.transferKind) : "transfer",
      ...(str(ctx.controllerApprovalRef) ? { controllerApprovalRef: str(ctx.controllerApprovalRef).slice(0, 120) } : {}) } : {}),
    ...(estimate && estimate.over ? { revisedEstimateRef: str(ctx.revisedEstimateRef).slice(0, 120), aboveEstimate: estimate.over } : {}),
    ...(estimate && estimate.warning ? { estimateUnchecked: true } : {}),
    /* What a stores movement belongs to (stores.js, assets.js): the indent it was issued against, the job card a
     * part was fitted on, the department that used it. Carried, never required: a pharmacy receipt names none. */
    ...(str(ctx.indentId) ? { indentId: str(ctx.indentId) } : {}),
    ...(str(ctx.jobCardId) ? { jobCardId: str(ctx.jobCardId) } : {}),
    ...(str(ctx.departmentId) ? { departmentId: str(ctx.departmentId) } : {}),
    ...(kind === "supplier-return" ? { supplier: toInstitution.slice(0, 200), returnOfReceipt: str(ctx.supplierReturn.receiptId),
      ...(str(ctx.supplierReturn.purchaseOrderId) ? { purchaseOrderId: str(ctx.supplierReturn.purchaseOrderId) } : {}),
      ...(str(ctx.supplierReturn.debitNoteNo) ? { debitNoteNo: str(ctx.supplierReturn.debitNoteNo).slice(0, 80) } : {}),
      ...(ctx.controlled === true ? { controllerApprovalRef: str(ctx.controllerApprovalRef).slice(0, 120) } : {}) } : {}),
    source: { system: "wardsynq-native", sourceId: `stock:${id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    /* A replayed key answers with the movement that key first wrote, not the id this retry minted. */
    const saved = out.replayed && out.record ? out.record : record;
    return { ...base, ok: true, written: 1, movementId: saved.id, kind, recordVersion: out.record.version, movement: saved, actor: resolved.actor.id,
      note: "A movement, not a gate. Nothing in stock control can refuse a dispense.", ...(estimate && estimate.warning ? { estimateWarning: estimate.warning } : {}) };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/* A ledger is never computed from a short read. Every movement and dispense is read (service.listAll, paged); past
 * READ_CAP the read throws ListCeilingError and the caller refuses with 409 too_many_records, as it did at the old 1,000.
 * ponytail: each page re-groups every version; audit O20 (a latest-version table) or a per-item ledger index is the upgrade. */
const READ_CAP = 50000;
const ledger = async (svc, type) => (await svc.listAll(type, { max: READ_CAP, throwOnTruncate: true })).rows;
const tooMany = (what) => ({ ok: false, status: 409, error: "too_many_records", detail: `More than ${READ_CAP} stock records exist, so ${what}` });

/**
 * PURE. How much of one receipt can still go back: what it brought in, less every earlier return naming it.
 * Only the same unit is counted, for the reason the whole file keeps: nothing converts boxes to tablets.
 */
function returnableFrom(receipt, movements) {
  const q = receipt && quantityOf(receipt.quantity);
  if (!q || str(receipt.kind) !== "receipt") return null;
  const returned = (movements || []).filter((m) => m && str(m.kind) === "supplier-return" && str(m.returnOfReceipt) === str(receipt.id))
    .reduce((a, m) => { const x = quantityOf(m.quantity); return a + (x && key(x.unit) === key(q.unit) ? x.value : 0); }, 0);
  return { received: q.value, returned, remaining: q.value - returned, unit: q.unit };
}

/**
 * Sends stock back to the supplier it came from, against the receipt that brought it in.
 * ctx: { migration, receiptId, quantity, reason, supplier?, debitNoteNo?, isControlled(display, code), witnessId?, witnessCheck?,
 *        controllerApprovalRef?, at?, idempotencyKey? }
 *
 * NEVER MORE THAN ARRIVED. The receipt and every earlier return against it are read, and a quantity above what is
 * left is refused with both numbers named. A return is a movement like any other, so the level, the batch balances
 * and the controlled-drug register (controlled-drugs.js) all read it from the one ledger. The supplier's GST credit
 * note or the hospital's debit note is the accountant's document; its number is kept when given, nothing is computed.
 * ponytail: two returns against one receipt at the same instant are not serialised; the level shows any excess.
 */
async function returnToSupplier(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const receiptId = str(ctx.receiptId), reason = str(ctx.reason);
  const qs = str(ctx.quantity);
  const value = /^\d+(\.\d+)?$/.test(qs) ? Number(qs) : NaN;
  if (!receiptId) return { ...base, ok: false, status: 422, error: "receipt_required", detail: "Choose the receipt the stock came in on.", written: 0 };
  if (!(value > 0)) return { ...base, ok: false, status: 422, error: "quantity_required", detail: "Give a plain quantity above zero.", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say why the stock is going back.", written: 0 };

  const { svc, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let receipt, movements, po = null;
  try {
    [receipt, movements] = await Promise.all([svc.get(MOVE_TYPE, receiptId), ledger(svc, MOVE_TYPE)]);
    if (receipt && str(receipt.purchaseOrderId)) po = await svc.get("PurchaseOrder", str(receipt.purchaseOrderId));
  } catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ...tooMany("earlier returns against this receipt cannot all be read. Nothing was recorded."), written: 0 };
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }
  if (!receipt || str(receipt.kind) !== "receipt") return { ...base, ok: false, status: 404, error: "receipt_not_found", detail: "There is no receipt with that reference.", written: 0 };
  const left = returnableFrom(receipt, movements);
  if (!left) return { ...base, ok: false, status: 422, error: "receipt_not_countable", detail: "This receipt has no usable quantity, so nothing can be returned against it.", written: 0 };
  if (value > left.remaining) {
    return { ...base, ok: false, status: 409, error: "return_exceeds_receipt", received: left.received, returned: left.returned, remaining: left.remaining, unit: left.unit, written: 0,
      detail: `This receipt brought in ${left.received} ${left.unit} and ${left.returned} ${left.unit} already went back, so at most ${left.remaining} ${left.unit} can be returned. Nothing was recorded.` };
  }
  const supplier = str(receipt.receivedFrom) || str(po && po.vendor) || str(ctx.supplier);
  if (!supplier) return { ...base, ok: false, status: 422, error: "supplier_required", detail: "The receipt does not name its supplier. Say who the stock is going back to.", written: 0 };

  /* Controlled or not is the hospital's drug master applied to the receipt's own item, never the caller's word. A route
   * that cannot say is refused rather than treated as not controlled. */
  if (typeof ctx.isControlled !== "function") return { ...base, ok: false, status: 502, error: "controlled_check_unavailable", detail: "Whether this is a controlled drug could not be checked, so nothing was recorded.", written: 0 };
  const moved = await recordMovement(request, env, {
    ...ctx, kind: "supplier-return", controlled: ctx.isControlled(receipt.display, receipt.code) === true, code: str(receipt.code), display: str(receipt.display) || str(receipt.code),
    quantity: { value, unit: left.unit }, location: receipt.location || null, batch: receipt.batch || null, expiry: receipt.expiry || null, reason,
    supplierReturn: { receiptId, supplier, purchaseOrderId: str(receipt.purchaseOrderId), debitNoteNo: ctx.debitNoteNo },
  });
  if (!moved.ok) return moved;
  return { ...moved, supplier, receiptId, returned: left.returned + value, remaining: left.remaining - value, unit: left.unit };
}

/** ctx: { migration, code, unit, quantity, now? } - which batches to take from, earliest expiry first. Advice only. */
async function stockFefo(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", picks: [] };
  const code = str(ctx.code), unit = str(ctx.unit), quantity = Number(ctx.quantity);
  if (!code || !unit) return { ...base, ok: false, status: 400, error: "code_and_unit_required" };
  if (!(quantity > 0)) return { ...base, ok: false, status: 400, error: "quantity_required" };
  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let movements, dispenses;
  try {
    [movements, dispenses] = await Promise.all([ledger(svc, MOVE_TYPE), ledger(svc, "MedicationDispense")]);
  } catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ...tooMany("batch counts cannot be worked out safely here. Pick from the shelf by expiry date.") };
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
  }
  const sug = fefoSuggestion(batchBalances((movements || []).filter(Boolean), (dispenses || []).filter(Boolean), code, unit), quantity, ctx.now);
  if (!sug.ok) return { ...base, ok: false, status: 409, error: sug.reason, detail: sug.detail };
  return { ...base, ok: true, code, unit, quantity, picks: sug.picks, shortfall: sug.shortfall, excluded: sug.excluded, note: "Advice only. Check the expiry printed on the box before issuing." };
}

/** ctx: { migration, reorderLevels?, location?, noDispenses? } - the levels, computed now.
 *  noDispenses: the laboratory's own store (reagents and consumables), which no medicine is ever dispensed from
 *  and whose staff cannot read dispenses. */
async function stockLevels(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", levels: [] };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, levels: [] };

  let movements, dispenses;
  try {
    [movements, dispenses] = await Promise.all([
      /* No catch: a dispense read that failed and came back as [] would make every level too high. */
      ledger(svc, MOVE_TYPE),
      ctx.noDispenses === true ? [] : ledger(svc, "MedicationDispense"),
    ]);
  } catch (e) {
    /* A level from a short read is a wrong level: refused, where it used to be shown with a warning. */
    if (e instanceof ListCeilingError) return { ...base, ...tooMany("the levels cannot be worked out safely."), levels: [] };
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), levels: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), levels: [] };
  }

  const computed = levelsFrom((movements || []).filter(Boolean), (dispenses || []).filter(Boolean));
  const flagged = flagLevels(computed.levels, ctx.reorderLevels);
  const where = str(ctx.location);
  const levels = where ? flagged.levels.filter((r) => key(r.location) === key(where)) : flagged.levels;
  const mixed = mixedUnits(flagged.levels);
  const expiring = nearExpiry((movements || []).filter(Boolean), ctx.nearExpiryDays, ctx.now)
    .filter((r) => !where || key(r.location) === key(where));

  return {
    ...base, ok: true,
    levels: levels.sort((a, b) => String(a.display).localeCompare(String(b.display))),
    belowReorder: flagged.belowReorder,
    negative: flagged.negative,
    expiring,
    problems: computed.problems,
    ...(mixed.length ? {
      mixedUnits: mixed,
      mixedUnitsWarning: "Some items are counted in more than one unit and are shown side by side rather than added. Nothing here converts boxes to tablets: that mapping is a product catalogue this build does not have, and guessing it is wrong by a factor of twenty-eight.",
    } : {}),
    ...(flagged.negative.length ? {
      negativeWarning: `${flagged.negative.length} item${flagged.negative.length === 1 ? " has" : "s have"} a negative level, which cannot be true. Stock was issued that was never recorded as received. Shown as computed rather than corrected to zero.`,
    } : {}),
    reorderConfigured: !!(ctx.reorderLevels && Object.keys(ctx.reorderLevels).length),
    /* Said on every response. This is the property the whole file is built around. */
    note: "A count is a belief; the box in the pharmacist's hand is the fact. Nothing here can refuse a dispense, and the reorder list is a list - nothing has been ordered.",
  };
}

export { returnableFrom, returnToSupplier, batchBalances, fefoSuggestion, stockFefo, MOVE_TYPE, KINDS, SIGN, quantityOf, levelsFrom, flagLevels, mixedUnits, nearExpiry, recordMovement, stockLevels, reconcileCount, packFactors, validatePacks, toBaseUnit, dualDisplay };
