/* functions/_wardsynq/infusion.js — the drip, and the volume nobody actually watched go in.
 *
 * The eMAR gives a DOSE at a TIME: verify, dispense, scan, administer, done. An infusion is not that.
 * It runs, somebody changes the rate at 04:00, it is paused for a scan, it is restarted, and the
 * question a consultant asks at 08:00 is "how much has actually gone in" - which no
 * MedicationAdministration can answer, because there is no single moment to attach it to.
 *
 * A RATE IS NOT A DOSE. The order says what the drug is and how concentrated; the rate is how fast
 * the bag runs. Nothing here computes a dose from a rate or a rate from a dose, and the two are never
 * mixed in one field: a system that let them be would be one where changing a pump changed a
 * prescription.
 *
 * THE VOLUME IS COMPUTED, AND IT IS AN ASSUMPTION. This is the part that has to be said out loud.
 * `infusionVolume` integrates the rate over time, which means it assumes the pump ran at the last
 * charted rate for every minute since. Nobody watches a pump continuously. If it occluded at 02:00
 * and nobody noticed until 06:00, the computed volume is four hours too high - and it is the fluid
 * balance, and then the resuscitation decision, that is built on it. So every total says how long it
 * has been extrapolating and how stale the last observation is, and a long gap is FLAGGED rather
 * than smoothed over.
 *
 * AN INFUSION IS NEVER STOPPED AUTOMATICALLY. Not by time, not by a bag volume running out, not by
 * a shift ending. An infusion that stops being charted is UNCHARTED, not stopped, and the two mean
 * opposite things: one is a patient no longer receiving a drug, the other is a patient receiving it
 * with nobody looking. Stopping is a human act with a time on it.
 *
 * IT DOES NOT CONTROL A PUMP AND CANNOT. This records what a human says the pump is doing. There is
 * no device integration here, and nothing in this file should ever be read as having set a rate.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { infusionVolume } from "../../wardsynq/wardsynq-flowsheet.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "InfusionRate";
const num = (v) => {
  if (v === null || v === undefined || (typeof v !== "number" && str(v) === "")) return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** What happened at this moment. `stopped` is its own event, never a rate of zero by another name. */
const EVENTS = Object.freeze(["started", "rate-changed", "paused", "resumed", "stopped"]);
/** How long a rate may stand before the computed volume is extrapolating further than it should. */
const STALE_AFTER_HOURS = 6;

function InfusionRate(input) {
  const i = input || {};
  const event = EVENTS.includes(i.event) ? i.event : "rate-changed";
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    orderId: i.orderId,
    drug: i.drug || null,
    event,
    /* mL per hour, as set on the pump. A paused or stopped infusion is running at zero, and that is
     * recorded so the integration is right - but the EVENT is what says why. */
    ratePerHour: event === "paused" || event === "stopped" ? 0 : num(i.ratePerHour),
    reason: i.reason || null,
    at: i.at || null,
    recordedBy: i.recordedBy || null,
    source: { system: "wardsynq-native", sourceId: `infusion:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One entry per (order, instant). Re-charting the same change is the same entry. */
function rateIdFor(orderId, at) {
  const o = slug(orderId), t = slug(at);
  return o && t ? `wsq-inf-${o}-${t}` : null;
}

/** PURE. Is this infusion still running, from its own history? Derived, never stored. */
function isRunning(history) {
  const rows = (history || []).filter(Boolean).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!rows.length) return false;
  return rows[rows.length - 1].event !== "stopped";
}

/**
 * PURE. How much has gone in, and how much of that is assumption.
 *
 * The arithmetic is `infusionVolume`'s, unchanged. What this adds is the honesty: how long the total
 * has been extrapolating from the last thing a human actually saw.
 */
function volumeSoFar(history, { from, to, nowMs } = {}) {
  const rows = (history || []).filter(Boolean)
    .map((r) => ({ at: r.at, ratePerHour: r.ratePerHour, event: r.event }))
    .filter((r) => r.at && Number.isFinite(Date.parse(r.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!rows.length) return { ml: 0, segments: [], complete: false, reason: "nothing has been charted for this infusion" };

  const start = from || rows[0].at;
  const end = to || new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const out = infusionVolume(rows, { from: start, to: end });

  const last = rows[rows.length - 1];
  const lastMs = Date.parse(last.at);
  const endMs = Date.parse(end);
  const sinceHours = Math.max(0, (endMs - lastMs) / 3600000);
  const running = last.event !== "stopped";

  return {
    ...out,
    ml: Math.round(out.ml * 10) / 10,
    from: start, to: end,
    running,
    lastChartedAt: last.at, lastRatePerHour: last.ratePerHour, lastEvent: last.event,
    hoursSinceLastCharted: Math.round(sinceHours * 10) / 10,
    /* THE CAVEAT, on every total. The number assumes the pump ran at the last charted rate for every
     * minute since. If it occluded at 02:00 and nobody noticed until 06:00, this is four hours too
     * high - and the fluid balance, and then the resuscitation decision, is built on it. */
    assumption: running && sinceHours > 0
      ? `This total assumes the pump has run at ${last.ratePerHour} mL/h for the ${Math.round(sinceHours * 10) / 10} hours since it was last charted. Nobody watches a pump continuously.`
      : null,
    ...(running && sinceHours > STALE_AFTER_HOURS
      ? { stale: true, staleDetail: `No rate has been charted for ${Math.round(sinceHours)} hours. Check the pump before relying on this volume.` }
      : {}),
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

/** ctx: { migration, orderId, event, ratePerHour?, reason?, at?, actorDeps, recordDeps } */
async function chartInfusion(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const orderId = str(ctx.orderId), event = str(ctx.event) || "rate-changed";
  if (!orderId) return { ...base, ok: false, status: 422, error: "order_required", written: 0 };
  if (!EVENTS.includes(event)) return { ...base, ok: false, status: 400, error: "unknown_event", detail: `event must be one of ${EVENTS.join(", ")}`, written: 0 };
  const rate = num(ctx.ratePerHour);
  /* A running infusion needs a rate. Without one the volume cannot be computed at all, and a drip
   * charted as running at nothing is a drip nobody can account for. */
  if (event !== "paused" && event !== "stopped" && rate === null) {
    return { ...base, ok: false, status: 422, error: "rate_required", detail: "a running infusion needs a rate in mL per hour", written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let order;
  try { order = await svc.get("MedicationOrder", orderId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId, written: 0 };
  if (order.status !== "active") return { ...base, ok: false, status: 409, error: "order_not_active", detail: `this order is ${order.status}`, orderId, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = rateIdFor(orderId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let history;
  try { history = ((await svc.byPatient(TYPE, order.patientId)) || []).filter((r) => r && str(r.orderId) === orderId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const existing = history.find((r) => r.id === id);
  if (existing) return { ...base, ok: true, written: 0, skipped: "already_charted", entryId: id, event: existing.event, ratePerHour: existing.ratePerHour };
  /* A stopped infusion is not restarted by charting a rate on it. Restarting is a new prescription
   * decision, and letting a rate entry quietly revive one would put a drug back up with nobody
   * having decided to. */
  if (!isRunning(history) && history.length && event !== "started") {
    return { ...base, ok: false, status: 409, error: "infusion_stopped", detail: "this infusion was stopped; restarting it is a new order, not a rate change", orderId, written: 0 };
  }

  const record = InfusionRate({
    id, patientId: order.patientId, encounterId: order.encounterId || null,
    orderId, drug: order.drug, event, ratePerHour: rate, reason: str(ctx.reason) || null,
    at, recordedBy: resolved.actor.id,
  });

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    const volume = volumeSoFar([...history, record], {});
    return {
      ...base, ok: true, written: 1, entryId: id, orderId, drug: order.drug,
      event: record.event, ratePerHour: record.ratePerHour, at, version: out.record.version,
      volume,
      /* Said on every write, because this is what the record is NOT. */
      note: "Recorded as what the pump is doing. Nothing here has set a rate or controls a device.",
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { entryId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** The patient's infusions with their running volumes. ctx: { migration, patientId, from?, to? } */
async function listInfusions(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", infusions: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", infusions: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, infusions: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), infusions: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), infusions: [] };
  }

  const byOrder = new Map();
  for (const r of (rows || []).filter(Boolean)) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) || []), r]);

  const nowMs = Date.parse(str(ctx.to)) || Date.now();
  const infusions = [...byOrder.entries()].map(([orderId, history]) => {
    history.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return {
      orderId, drug: history[history.length - 1].drug || null,
      running: isRunning(history), entries: history.length,
      startedAt: history[0].at, lastChartedAt: history[history.length - 1].at,
      volume: volumeSoFar(history, { from: str(ctx.from) || null, to: str(ctx.to) || null, nowMs }),
    };
  }).sort((a, b) => (Number(b.running) - Number(a.running)) || String(b.lastChartedAt).localeCompare(String(a.lastChartedAt)));

  return {
    ...base, ok: true, patientId, infusions,
    running: infusions.filter((i) => i.running).length,
    /* Counted at the top, because a drip nobody has charted for hours is the one to look at first. */
    stale: infusions.filter((i) => i.volume && i.volume.stale).length,
    note: "Volumes are integrated from the charted rates. An infusion that stopped being charted is uncharted, not stopped.",
  };
}

export { TYPE, EVENTS, STALE_AFTER_HOURS, InfusionRate, rateIdFor, isRunning, volumeSoFar, chartInfusion, listInfusions };
