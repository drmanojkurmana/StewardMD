/* functions/_wardsynq/assets.js - biomedical equipment: what the hospital owns, where it is, and whether it works.
 *
 * STATUS AND LOCATION ARE EVENTS. An asset's register entry says what it IS (tag, make, model, serial, purchase,
 * warranty, contracts). Where it is and whether it is in service are AssetEvent records - registered, moved, status -
 * so the movement history is the record itself rather than something reconstructed from overwritten fields.
 *
 * A JOB CARD IS A STORY, NOT A ROW. The card says what was reported or scheduled; every step after it (assigned,
 * a part fitted, closed with the checklist and the downtime) is a JobCardEvent appended after it. Whether a card is
 * open, and how long the equipment was down, is read from those events and never stored beside them.
 *
 * ANYONE ON THE WARD CAN SAY IT IS BROKEN. A breakdown complaint needs dept.request, which every hospital-floor role
 * holds; everything after it is the biomedical engineer's (asset.manage). A complaint that needed the engineer's
 * authority would be a complaint nobody files at 3am.
 *
 * A SPARE PART IS A STORES MOVEMENT. Fitting a part writes stock.js's `consumption` against the store it came from,
 * naming the job card and the asset's department, so the store level and the department's consumption report both
 * read the one movement (stores.js). A part whose movement was written but whose job-card step was not is reported
 * as exactly that, so nobody books it out of the store a second time.
 *
 * OVERDUE IS COMPUTED FROM THE LAST CLOSED JOB, not from a "next due" field somebody forgot to move on. Uptime is
 * the share of a window not covered by breakdown downtime, with overlapping breakdowns counted once.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { recordMovement } from "./stock.js";

const str = (v) => (v == null ? "" : String(v).trim());
const key = (v) => str(v).toUpperCase();
const READ_CAP = 1000;
const DAY = 86400000;

const CATEGORIES = Object.freeze(["life-support", "monitoring", "diagnostic", "therapeutic", "imaging", "laboratory", "surgical", "other"]);
const STATUSES = Object.freeze(["in-service", "under-repair", "condemned"]);
const CONTRACT_KINDS = Object.freeze(["AMC", "CMC"]);
const JOB_KINDS = Object.freeze(["breakdown", "pm", "calibration"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
const off = (ctx) => !ctx.migration || ctx.migration.mode === "off";
function latest(rows) {
  const m = new Map();
  for (const r of rows || []) { if (!r || !str(r.id)) continue; const p = m.get(r.id); if (!p || Number(r.version || 0) >= Number(p.version || 0)) m.set(r.id, r); }
  return [...m.values()];
}
const byAt = (a, b) => str(a.at).localeCompare(str(b.at)) || str(a.id).localeCompare(str(b.id));

/** PURE. Current status, department and location of one asset, and its movement history, from its events. */
function assetPosition(assetId, events) {
  const mine = (events || []).filter((e) => e && str(e.assetId) === assetId).sort(byAt);
  let status = null, location = null, departmentId = null, departmentName = null;
  const movements = [];
  for (const e of mine) {
    if (e.kind === "registered" || e.kind === "moved") {
      movements.push({ at: e.at, by: e.by, location: e.location || null, departmentId: e.departmentId || null, departmentName: e.departmentName || null, reason: e.reason || null });
      location = e.location || null; departmentId = e.departmentId || null; departmentName = e.departmentName || null;
    }
    if (e.kind === "registered" || e.kind === "status") status = e.status || status;
  }
  return { status, location, departmentId, departmentName, movements, statusHistory: mine.filter((e) => e.kind !== "moved").map((e) => ({ at: e.at, by: e.by, status: e.status, reason: e.reason || null })) };
}

/** PURE. One job card's state from its events. */
function jobCardState(card, events, nowIso) {
  const mine = (events || []).filter((e) => e && str(e.jobCardId) === str(card.id)).sort(byAt);
  const assigned = mine.filter((e) => e.action === "assign").pop() || null;
  const close = mine.find((e) => e.action === "close") || null;
  const parts = mine.filter((e) => e.action === "part").map((e) => e.part);
  const end = close ? str(close.at) : str(nowIso);
  let downtimeMinutes = null;
  const downtimeStated = !!(close && close.downtimeMinutes != null && str(close.downtimeMinutes) !== "");
  if (card.kind === "breakdown") {
    downtimeMinutes = downtimeStated ? Number(close.downtimeMinutes)
      : Math.max(0, Math.round((Date.parse(end) - Date.parse(card.reportedAt)) / 60000));
  }
  return {
    jobCardId: card.id, assetId: card.assetId, kind: card.kind, scheduleId: card.scheduleId || null,
    description: card.description || null, reportedBy: card.reportedBy, reportedAt: card.reportedAt,
    state: close ? "closed" : assigned ? "assigned" : "open",
    engineer: assigned ? assigned.engineer : null, parts,
    closedAt: close ? close.at : null, closedBy: close ? close.by : null, resolution: close ? close.resolution : null,
    checklist: close ? close.checklist || [] : [], calibrationResult: close ? close.calibrationResult || null : null,
    downtimeMinutes, downtimeStated,
  };
}

/** PURE. When each schedule is next due, from the last job closed against it. */
function scheduleDue(schedule, cards, nowIso) {
  const done = (cards || []).filter((c) => c.scheduleId === schedule.id && c.state === "closed").map((c) => str(c.closedAt)).sort().pop() || null;
  const baseIso = done || str(schedule.startFrom) || str(schedule.at);
  const dueMs = Date.parse(baseIso) + Number(schedule.intervalDays) * DAY;
  const now = Date.parse(nowIso);
  const daysLeft = Math.floor((dueMs - now) / DAY);
  return { lastDone: done, dueOn: Number.isFinite(dueMs) ? new Date(dueMs).toISOString().slice(0, 10) : null, overdue: dueMs < now, dueSoon: dueMs >= now && daysLeft <= 7, daysLeft };
}

/** PURE. Share of [now - days, now] an asset was not down, merging overlapping breakdowns. null with no window. */
function uptimeFraction(cards, nowIso, days) {
  const end = Date.parse(nowIso), start = end - days * DAY;
  /* An open breakdown is down from the report until now. A closed one ends at its closure; when the engineer stated
   * the downtime, it is that long before the closure, else it began at the report. */
  const spans = (cards || []).filter((c) => c.kind === "breakdown").map((c) => {
    const e = c.closedAt ? Date.parse(c.closedAt) : end;
    const stated = c.closedAt && c.downtimeStated;
    const s = stated ? e - c.downtimeMinutes * 60000 : Date.parse(c.reportedAt);
    return [Math.max(start, s), Math.min(end, e)];
  }).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
  let down = 0, curS = null, curE = null;
  for (const [s, e] of spans) {
    if (curE === null || s > curE) { if (curE !== null) down += curE - curS; curS = s; curE = e; }
    else curE = Math.max(curE, e);
  }
  if (curE !== null) down += curE - curS;
  return { uptime: Math.round((1 - down / (end - start)) * 10000) / 10000, downMinutes: Math.round(down / 60000) };
}

/** PURE. Warranty and AMC/CMC ends within `days` or already past. */
function contractAlerts(asset, nowIso, days) {
  const out = [];
  const now = Date.parse(nowIso);
  const add = (kind, until, vendor) => {
    const u = Date.parse(until);
    if (!Number.isFinite(u)) return;
    const left = Math.floor((u - now) / DAY);
    if (left <= days) out.push({ assetId: asset.id, tag: asset.tag, name: asset.name, kind, until, vendor: vendor || null, daysLeft: left, expired: left < 0 });
  };
  if (str(asset.warrantyUntil)) add("warranty", asset.warrantyUntil, asset.vendor);
  for (const c of asset.contracts || []) add(c.kind, c.until, c.vendor);
  return out;
}

/** GET /ward/assets - the register with positions, schedules and when each is due, job cards, alerts and uptime. */
async function assetsOverview(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off" };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const readable = (t) => { const r = resolved.grant ? resolved.grant.read : null; return r === null || r === undefined || r.includes(t); };
  let assets, events, schedules, cards, cardEvents;
  try {
    [assets, events, cards, cardEvents] = await Promise.all([svc.list("Asset", READ_CAP), svc.list("AssetEvent", READ_CAP), svc.list("JobCard", READ_CAP), svc.list("JobCardEvent", READ_CAP)]);
    /* The ward reads the register to report a fault; the schedules are the engineer's. Not readable is not "none". */
    schedules = readable("MaintenanceSchedule") ? await svc.list("MaintenanceSchedule", READ_CAP) : null;
  } catch (e) { return { ...base, ...readFailure(e) }; }
  const now = ctx.now || new Date().toISOString();
  const alertDays = Number.isFinite(Number(ctx.contractAlertDays)) && str(ctx.contractAlertDays) !== "" ? Number(ctx.contractAlertDays) : 60;
  const jobs = latest(cards).map((c) => jobCardState(c, cardEvents, now)).sort((a, b) => str(b.reportedAt).localeCompare(str(a.reportedAt)));
  const list = latest(assets).map((a) => {
    const pos = assetPosition(a.id, events);
    const mine = jobs.filter((j) => j.assetId === a.id);
    return {
      assetId: a.id, tag: a.tag, name: a.name, category: a.category, make: a.make || null, model: a.model || null, serial: a.serial || null,
      purchaseDate: a.purchaseDate || null, costPaise: a.costPaise == null ? null : a.costPaise, vendor: a.vendor || null,
      warrantyUntil: a.warrantyUntil || null, contracts: a.contracts || [], critical: a.critical === true,
      ...pos, openJobs: mine.filter((j) => j.state !== "closed").length,
      ...(a.critical === true ? { uptime90: uptimeFraction(mine, now, 90) } : {}),
    };
  }).sort((a, b) => str(a.tag).localeCompare(str(b.tag)));
  const live = list.filter((a) => a.status !== "condemned");
  const sched = schedules === null ? null : latest(schedules).filter((s) => s.active !== false).map((s) => {
    const asset = list.find((a) => a.assetId === s.assetId);
    return { scheduleId: s.id, assetId: s.assetId, tag: asset ? asset.tag : null, name: asset ? asset.name : null, kind: s.kind, intervalDays: s.intervalDays, checklist: s.checklist || [], condemned: !!(asset && asset.status === "condemned"), ...scheduleDue(s, jobs, now) };
  });
  const due = (sched || []).filter((s) => !s.condemned);
  const truncated = [assets, events, cards, cardEvents].some((r) => (r || []).length >= READ_CAP);
  return {
    ...base, ok: true, now, categories: CATEGORIES, statuses: STATUSES,
    assets: list, jobCards: jobs, schedules: sched,
    overduePm: schedules === null ? null : due.filter((s) => s.kind === "pm" && s.overdue),
    calibrationDue: schedules === null ? null : due.filter((s) => s.kind === "calibration" && (s.overdue || s.dueSoon)),
    contractAlerts: live.flatMap((a) => contractAlerts({ id: a.assetId, tag: a.tag, name: a.name, warrantyUntil: a.warrantyUntil, vendor: a.vendor, contracts: a.contracts }, now, alertDays)),
    uptime: live.filter((a) => a.critical).map((a) => ({ assetId: a.assetId, tag: a.tag, name: a.name, windowDays: 90, ...a.uptime90 })),
    ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} asset records of one kind exist and only the latest ${READ_CAP} were read, so this register may be incomplete.` } : {}),
  };
}

/** POST /ward/asset - register an asset, or change its register entry (a new version). Registration writes its first position. */
async function saveAsset(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const tag = str(ctx.tag).toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const name = str(ctx.name), category = str(ctx.category);
  if (!tag || !name) return { ...base, ok: false, status: 422, error: "asset_incomplete", detail: "An asset needs a tag and a name.", written: 0 };
  if (!CATEGORIES.includes(category)) return { ...base, ok: false, status: 422, error: "bad_category", written: 0 };
  for (const d of [ctx.purchaseDate, ctx.warrantyUntil]) if (str(d) && !ISO_DAY.test(str(d))) return { ...base, ok: false, status: 422, error: "bad_date", written: 0 };
  const cost = str(ctx.costPaise) === "" ? null : Number(ctx.costPaise);
  if (cost !== null && !(Number.isInteger(cost) && cost >= 0)) return { ...base, ok: false, status: 422, error: "bad_cost", detail: "Cost is a whole number of paise.", written: 0 };
  const contracts = [];
  for (const c of Array.isArray(ctx.contracts) ? ctx.contracts : []) {
    if (!c || !CONTRACT_KINDS.includes(str(c.kind)) || !ISO_DAY.test(str(c.until)) || (str(c.from) && !ISO_DAY.test(str(c.from)))) return { ...base, ok: false, status: 422, error: "bad_contract", detail: "A contract is AMC or CMC with an end date (and optionally a start date).", written: 0 };
    contracts.push({ kind: str(c.kind), vendor: str(c.vendor) || null, from: str(c.from) || null, until: str(c.until), reference: str(c.reference) || null });
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = `wsq-asset-${tag.toLowerCase()}`;
  let existing;
  try { existing = await svc.get("Asset", id); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  let dept = null;
  if (!existing) {
    dept = (ctx.departments || []).find((d) => d && str(d.id) === str(ctx.departmentId) && d.active !== false) || null;
    if (!dept || !str(ctx.location)) return { ...base, ok: false, status: 422, error: "position_required", detail: "A new asset needs the department and the location it is in.", written: 0 };
  }
  if (existing && str(ctx.expectedVersion) === "") return { ...base, ok: false, status: 409, error: "tag_exists", detail: "An asset with this tag is already registered. Open it to change it.", written: 0 };
  const at = new Date().toISOString();
  const record = {
    resourceType: "Asset", id, tag, name, category, make: str(ctx.make) || null, model: str(ctx.model) || null, serial: str(ctx.serial) || null,
    purchaseDate: str(ctx.purchaseDate) || null, costPaise: cost, vendor: str(ctx.vendor) || null, warrantyUntil: str(ctx.warrantyUntil) || null,
    contracts, critical: ctx.critical === true, by: resolved.actor.id, at,
  };
  try {
    const out = await svc.put(record, { expectedVersion: existing ? Number(ctx.expectedVersion) : 0, idempotencyKey: ctx.idempotencyKey || null });
    if (existing) return { ...base, ok: true, written: 1, assetId: id, version: out.record.version };
    try {
      await svc.put({ resourceType: "AssetEvent", id: `wsq-asset-event-${tag.toLowerCase()}-registered`, assetId: id, kind: "registered", status: "in-service", location: str(ctx.location), departmentId: dept.id, departmentName: str(dept.name), by: resolved.actor.id, at }, { expectedVersion: 0 });
    } catch (e) {
      return { ...base, ...writeFailure(e), partial: true, written: 1, assetId: id, detail: "The asset was registered but its department, location and status were not written. Record them with Move." };
    }
    return { ...base, ok: true, written: 2, assetId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/asset-event - moved (department and location) or status (in service, under repair, condemned). */
async function recordAssetEvent(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind), assetId = str(ctx.assetId);
  if (!["moved", "status"].includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  let extra;
  if (kind === "moved") {
    const dept = (ctx.departments || []).find((d) => d && str(d.id) === str(ctx.departmentId) && d.active !== false);
    if (!dept || !str(ctx.location)) return { ...base, ok: false, status: 422, error: "position_required", written: 0 };
    extra = { location: str(ctx.location), departmentId: dept.id, departmentName: str(dept.name) };
  } else {
    if (!STATUSES.includes(str(ctx.status))) return { ...base, ok: false, status: 422, error: "bad_status", written: 0 };
    if (!str(ctx.reason)) return { ...base, ok: false, status: 422, error: "reason_required", detail: "A status change says why.", written: 0 };
    extra = { status: str(ctx.status) };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let asset, events;
  try { [asset, events] = await Promise.all([svc.get("Asset", assetId), svc.list("AssetEvent", READ_CAP)]); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!asset) return { ...base, ok: false, status: 404, error: "asset_not_found", written: 0 };
  if (assetPosition(assetId, events).status === "condemned") return { ...base, ok: false, status: 409, error: "asset_condemned", detail: "A condemned asset is not moved or returned to service.", written: 0 };
  const at = new Date().toISOString();
  const record = { resourceType: "AssetEvent", id: `wsq-asset-event-${crypto.randomUUID()}`, assetId, kind, ...extra, reason: str(ctx.reason) || null, by: resolved.actor.id, at };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, assetId, event: record, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/maintenance-schedule - a preventive maintenance or calibration interval with its checklist. */
async function saveSchedule(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind), interval = Number(ctx.intervalDays), assetId = str(ctx.assetId);
  if (!["pm", "calibration"].includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  if (!(Number.isInteger(interval) && interval > 0 && interval <= 3650)) return { ...base, ok: false, status: 422, error: "bad_interval", detail: "The interval is a whole number of days.", written: 0 };
  const checklist = (Array.isArray(ctx.checklist) ? ctx.checklist : []).map(str).filter(Boolean);
  if (!checklist.length) return { ...base, ok: false, status: 422, error: "checklist_required", detail: "A schedule lists what has to be checked.", written: 0 };
  if (str(ctx.startFrom) && !ISO_DAY.test(str(ctx.startFrom))) return { ...base, ok: false, status: 422, error: "bad_date", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let asset;
  try { asset = await svc.get("Asset", assetId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!asset) return { ...base, ok: false, status: 404, error: "asset_not_found", written: 0 };
  const id = str(ctx.scheduleId) || `wsq-maint-${kind}-${assetId}`;
  const record = { resourceType: "MaintenanceSchedule", id, assetId, kind, intervalDays: interval, checklist, startFrom: str(ctx.startFrom) || null, active: ctx.active !== false, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, scheduleId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Opens a job card. A breakdown from the ward (POST /ward/equipment-complaint), a PM or calibration from the engineer (POST /ward/job-card). */
async function openJobCard(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = ctx.complaint ? "breakdown" : str(ctx.kind);
  const assetId = str(ctx.assetId);
  if (!JOB_KINDS.includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  if (kind === "breakdown" && !str(ctx.description)) return { ...base, ok: false, status: 422, error: "description_required", detail: "Say what is wrong with it.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let asset, events;
  try { [asset, events] = await Promise.all([svc.get("Asset", assetId), svc.list("AssetEvent", READ_CAP)]); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!asset) return { ...base, ok: false, status: 404, error: "asset_not_found", written: 0 };
  if (assetPosition(assetId, events).status === "condemned") return { ...base, ok: false, status: 409, error: "asset_condemned", written: 0 };
  let scheduleId = null;
  if (kind !== "breakdown") {
    let s;
    try { s = await svc.get("MaintenanceSchedule", str(ctx.scheduleId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    if (!s || s.assetId !== assetId || s.kind !== kind) return { ...base, ok: false, status: 422, error: "schedule_required", detail: "A PM or calibration job is opened against one of this asset's schedules.", written: 0 };
    scheduleId = s.id;
  }
  const at = new Date().toISOString();
  const record = { resourceType: "JobCard", id: `wsq-job-${at.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`, assetId, kind, scheduleId, description: str(ctx.description) || null, reportedBy: resolved.actor.id, reportedAt: at };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, jobCardId: record.id, kind, version: out.record.version,
      ...(kind === "breakdown" ? { detail: "Reported. The biomedical engineering team sees it on their job list." } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/job-card-update - assign, fit a part (from stores), or close with the checklist and downtime. */
async function updateJobCard(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const action = str(ctx.action), jobCardId = str(ctx.jobCardId);
  if (!["assign", "part", "close"].includes(action)) return { ...base, ok: false, status: 422, error: "bad_action", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let card, events, schedule = null, asset = null, assetEvents = [];
  try {
    [card, events] = await Promise.all([svc.get("JobCard", jobCardId), svc.list("JobCardEvent", READ_CAP)]);
    if (card) [asset, assetEvents] = await Promise.all([svc.get("Asset", card.assetId), svc.list("AssetEvent", READ_CAP)]);
    if (card && card.scheduleId) schedule = await svc.get("MaintenanceSchedule", card.scheduleId);
  } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!card) return { ...base, ok: false, status: 404, error: "job_card_not_found", written: 0 };
  const now = new Date().toISOString();
  const state = jobCardState(card, events, now);
  if (state.state === "closed") return { ...base, ok: false, status: 409, error: "job_card_closed", written: 0 };
  const ev = { resourceType: "JobCardEvent", id: `wsq-job-event-${crypto.randomUUID()}`, jobCardId, action, by: resolved.actor.id, at: now };
  let movementId = null;
  if (action === "assign") {
    if (!str(ctx.engineer)) return { ...base, ok: false, status: 422, error: "engineer_required", written: 0 };
    ev.engineer = str(ctx.engineer);
  } else if (action === "part") {
    const q = Number(ctx.quantity);
    if (!str(ctx.code) || !str(ctx.location) || !(q > 0)) return { ...base, ok: false, status: 422, error: "part_incomplete", detail: "A part needs the stores item, the quantity and the store it came from.", written: 0 };
    let items;
    try { items = latest(await svc.list("StoreItem", READ_CAP)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    const item = items.find((i) => key(i.code) === key(ctx.code));
    if (!item) return { ...base, ok: false, status: 422, error: "unknown_item", detail: "That part is not in the stores item master.", written: 0 };
    const pos = assetPosition(card.assetId, assetEvents);
    const moved = await recordMovement(request, env, { ...ctx, kind: "consumption", code: item.code, display: item.name, quantity: { value: q, unit: item.unit }, location: str(ctx.location), jobCardId, departmentId: pos.departmentId, reason: `Fitted to ${asset ? asset.tag : card.assetId} on job card ${jobCardId}`, idempotencyKey: ctx.idempotencyKey || null });
    if (!moved.ok) return { ...base, ...moved, written: 0 };
    movementId = moved.movementId;
    ev.part = { code: item.code, display: item.name, quantity: q, unit: item.unit, location: str(ctx.location), movementId };
  } else {
    if (!str(ctx.resolution)) return { ...base, ok: false, status: 422, error: "resolution_required", detail: "Say what was done.", written: 0 };
    if (!state.engineer) return { ...base, ok: false, status: 409, error: "not_assigned", detail: "Assign an engineer before closing the job.", written: 0 };
    const results = Array.isArray(ctx.checklist) ? ctx.checklist : [];
    if (schedule) {
      const missing = (schedule.checklist || []).filter((item) => !results.some((r) => r && str(r.item) === item && typeof r.done === "boolean"));
      if (missing.length) return { ...base, ok: false, status: 422, error: "checklist_incomplete", missing, detail: "Every checklist item is marked done or not done before the job closes.", written: 0 };
      ev.checklist = results.filter((r) => (schedule.checklist || []).includes(str(r.item))).map((r) => ({ item: str(r.item), done: r.done, note: str(r.note) || null }));
    }
    if (card.kind === "calibration") {
      if (!["pass", "fail"].includes(str(ctx.calibrationResult))) return { ...base, ok: false, status: 422, error: "calibration_result_required", written: 0 };
      ev.calibrationResult = str(ctx.calibrationResult);
    }
    if (card.kind === "breakdown" && str(ctx.downtimeMinutes) !== "") {
      const m = Number(ctx.downtimeMinutes);
      if (!(Number.isInteger(m) && m >= 0)) return { ...base, ok: false, status: 422, error: "bad_downtime", written: 0 };
      ev.downtimeMinutes = m;
    }
    if (str(ctx.statusAfter) && !STATUSES.includes(str(ctx.statusAfter))) return { ...base, ok: false, status: 422, error: "bad_status", written: 0 };
    ev.resolution = str(ctx.resolution);
  }
  try { await svc.put(ev); }
  catch (e) {
    return { ...base, ...writeFailure(e), written: movementId ? 1 : 0, ...(movementId ? { partial: true, movementId,
      detail: "The part was booked out of the store but the job card step was not written. Do not book the part out again; add a note to the job card." } : {}) };
  }
  const written = movementId ? 2 : 1;
  if (action === "close" && str(ctx.statusAfter) && asset) {
    try {
      await svc.put({ resourceType: "AssetEvent", id: `wsq-asset-event-${crypto.randomUUID()}`, assetId: card.assetId, kind: "status", status: str(ctx.statusAfter), reason: `Job card ${jobCardId} closed: ${ev.resolution}`, by: resolved.actor.id, at: now });
    } catch (e) {
      return { ...base, ...writeFailure(e), partial: true, written, jobCardId, detail: "The job card was closed but the asset's status was not changed. Set the status on the asset." };
    }
    return { ...base, ok: true, written: written + 1, jobCardId, action };
  }
  return { ...base, ok: true, written, jobCardId, action, ...(movementId ? { movementId } : {}) };
}

export {
  CATEGORIES as ASSET_CATEGORIES, STATUSES as ASSET_STATUSES,
  assetPosition, jobCardState, scheduleDue, uptimeFraction, contractAlerts,
  assetsOverview, saveAsset, recordAssetEvent, saveSchedule, openJobCard, updateJobCard,
};
