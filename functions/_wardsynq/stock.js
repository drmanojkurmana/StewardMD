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
 * UNITS ARE NOT CONVERTED. A movement in boxes and a dispense in tablets are not added together, and
 * this file will not guess how many tablets are in a box - that mapping is a product catalogue this
 * build does not have, and guessing it produces a confident number that is wrong by a factor of
 * twenty-eight. Mixed units are reported per unit, side by side, and flagged.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

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
 */
const KINDS = Object.freeze(["receipt", "adjustment", "wastage", "transfer-out", "transfer-in"]);

/** Which kinds add to a level and which take away. An issue is handled separately. */
const SIGN = Object.freeze({ receipt: 1, "transfer-in": 1, adjustment: 1, wastage: -1, "transfer-out": -1 });

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
    const row = rows.get(k) || { code, display: display || code, location: location || null, unit: qty.unit, level: 0, received: 0, issued: 0, wasted: 0, adjusted: 0 };
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
  }

  for (const d of dispenses || []) {
    if (!d) continue;
    const qty = quantityOf(d.quantity);
    const code = str(d.drugCode) || str(d.drug);
    if (!qty || !code) {
      /* A dispense with no quantity is a real and permitted record - pharmacy-dispense.js allows it
       * - but it cannot be counted, and a level computed as though it were zero would overstate
       * stock. Named so the gap is visible rather than absorbed. */
      problems.push({ dispenseId: d.id || null, reason: "dispense_not_countable" });
      continue;
    }
    const row = bump(code, d.drug, d.destination, qty, -1);
    row.issued += qty.value;
  }

  return { levels: [...rows.values()], problems };
}

/** PURE. Which rows are at or below the hospital's reorder level, and which are impossible. */
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
      svc.list(MOVE_TYPE, 1000).catch(() => []),
      svc.list("MedicationDispense", 1000).catch(() => []),
    ]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

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

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-stock-${key(code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "")}-${kind}`;
  const record = {
    resourceType: MOVE_TYPE, id, kind, code, display: str(ctx.display) || code,
    quantity, location: str(ctx.location) || null,
    batch: str(ctx.batch) || null, expiry: str(ctx.expiry) || null,
    reason: reason || null, at, by: resolved.actor.id,
    source: { system: "wardsynq-native", sourceId: `stock:${id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, movementId: id, kind, recordVersion: out.record.version, movement: record, actor: resolved.actor.id,
      note: "A movement, not a gate. Nothing in stock control can refuse a dispense." };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/** ctx: { migration, reorderLevels?, location? } - the levels, computed now. */
async function stockLevels(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", levels: [] };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, levels: [] };

  let movements, dispenses;
  try {
    [movements, dispenses] = await Promise.all([
      svc.list(MOVE_TYPE, 1000).catch(() => []),
      svc.list("MedicationDispense", 1000).catch(() => []),
    ]);
  } catch (e) {
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

export { MOVE_TYPE, KINDS, SIGN, quantityOf, levelsFrom, flagLevels, mixedUnits, nearExpiry, recordMovement, stockLevels, reconcileCount };
