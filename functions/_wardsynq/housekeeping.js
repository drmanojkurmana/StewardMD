/* functions/_wardsynq/housekeeping.js - cleaning tasks, inspection, and the bed that waits for both.
 *
 * A BED IN "CLEANING" IS A TASK. The bed master already holds the state (the bed board sets it, and a
 * discharge or transfer sets it when the hospital asks for inspection: supportServices.housekeepingInspection).
 * Every bed in that state appears here as an open task the moment it enters it, with no second write that
 * could be missed: the task's id is the bed and the instant the clean began (bed.stateSince), and its record
 * is written by the first person who acts on it. Manual tasks (a spill, a room clean, a terminal clean after
 * an isolation patient) are written when somebody raises one.
 *
 *   open -> assigned -> in-progress -> finished -> inspected          (a failed inspection goes back to rework)
 *
 * THE PERSON WHO CLEANED DOES NOT INSPECT. Inspection is its own capability (housekeeping.inspect), and the
 * route refuses the cleaner or the assignee as the inspector, whatever they hold. A passed inspection of a bed
 * clean releases the bed to available; nothing else here does, and with the hospital's inspection setting on
 * the bed master refuses to be made available by hand while it is cleaning.
 *
 * Turnaround is measured, never estimated: requested to finished, and requested to inspected, from the times
 * on the record. A task missing either time is left out of the figure and counted as left out.
 */

import { listWards, listBeds, getBed, updateBed } from "../_opd_org_store.js";
import { str, baseOf, offOf, newId, openSvc, writeFailure, readFailure, spread, readAllOf } from "./support-common.js";

const TASK_TYPE = "HousekeepingTask";
const KINDS = Object.freeze(["bed-clean", "terminal-clean", "spill", "room-clean"]);
const ISOLATION = Object.freeze(["none", "contact", "droplet", "airborne", "contact-enteric", "other"]);
const bedTaskId = (bed) => `wsq-hk-bed-${str(bed.id)}-${Number(bed.stateSince) || 0}`;

/** PURE. The open work: every recorded task still open, and every cleaning bed nobody has acted on yet. */
function boardTasks(beds, wards, tasks, nowMs) {
  const wardName = new Map((wards || []).map((w) => [w.id, w.name]));
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const out = [];
  for (const b of beds || []) {
    if (!b || b.active === false || b.state !== "cleaning") continue;
    const id = bedTaskId(b);
    if (byId.has(id)) continue;
    out.push({ id, virtual: true, kind: b.isolation ? "terminal-clean" : "bed-clean", origin: "bed", state: "open", bedId: b.id, bedName: b.name,
      wardId: b.wardId, wardName: wardName.get(b.wardId) || null, isolationBed: !!b.isolation,
      requestedAt: b.stateSince ? new Date(b.stateSince).toISOString() : null });
  }
  const bedNow = new Map((beds || []).map((b) => [b.id, b]));
  for (const t of tasks || []) {
    if (!t || t.state === "inspected" || t.state === "cancelled") continue;
    const b = t.bedId ? bedNow.get(t.bedId) : null;
    const released = t.origin === "bed" && (!b || b.state !== "cleaning" || bedTaskId(b) !== t.id);
    /* A bed made available by hand while its clean was open: shown for a week, then it is history. */
    if (released && nowMs - Date.parse(t.requestedAt || 0) > 7 * 86400000) continue;
    out.push({ ...t, ...(released ? { bedNoLongerCleaning: true } : {}) });
  }
  return out.sort((a, b) => (a.kind === "spill" ? -1 : 0) - (b.kind === "spill" ? -1 : 0) || str(a.requestedAt).localeCompare(str(b.requestedAt)));
}

/** PURE. Turnaround per kind and per ward, from inspected tasks inside the window. */
function turnaround(tasks, fromMs, toMs) {
  const done = (tasks || []).filter((t) => t && t.state === "inspected" && Date.parse(t.inspectedAt) >= fromMs && Date.parse(t.inspectedAt) < toMs);
  const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
  const group = (keyOf) => {
    const g = new Map();
    for (const t of done) { const k = keyOf(t) || "unknown"; if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
    return [...g.entries()].map(([key, ts]) => {
      const timed = ts.filter((t) => t.requestedAt && t.finishedAt);
      return { key, tasks: ts.length, untimed: ts.length - timed.length,
        toFinished: spread(timed.map((t) => mins(t.requestedAt, t.finishedAt))), toInspected: spread(timed.map((t) => mins(t.requestedAt, t.inspectedAt))) };
    }).sort((a, b) => a.key.localeCompare(b.key));
  };
  return { inspected: done.length, byKind: group((t) => t.kind), byWard: group((t) => t.wardName) };
}

async function readTasks(svc) { return readAllOf(svc, TASK_TYPE); }

/** The open housekeeping work for the hospital. */
async function housekeepingBoard(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", tasks: [] };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, tasks: [] };
  let beds, wards, tasks;
  try { [beds, wards] = await Promise.all([listBeds(env, ctx.orgId), listWards(env, ctx.orgId)]); }
  catch (e) { return { ...base, ok: false, status: 502, error: "beds_unreadable", detail: "The bed list could not be read, so beds waiting for a clean cannot be shown.", tasks: [] }; }
  try { tasks = await readTasks(svc); } catch (e) { return { ...base, ...readFailure(e), tasks: [] }; }
  return { ...base, ok: true, tasks: boardTasks(beds, wards, tasks, Date.now()).map((t) => ({ ...t, mine: !!t.assignee && t.assignee === resolved.actor.id })), inspectionRequired: ctx.inspectionRequired === true };
}

/** Raises a task by hand. ctx: { kind, location, wardId, isolationType, note } */
async function raiseHousekeepingTask(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind), location = str(ctx.location), iso = str(ctx.isolationType);
  if (!["spill", "room-clean", "terminal-clean"].includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", detail: "A task raised by hand is a spill, a room clean or a terminal clean. A bed clean starts when the bed goes to cleaning.", written: 0 };
  if (!location) return { ...base, ok: false, status: 422, error: "location_required", detail: "Say where.", written: 0 };
  if (kind === "terminal-clean" && !ISOLATION.includes(iso)) return { ...base, ok: false, status: 422, error: "isolation_type_required", detail: "A terminal clean needs the isolation type it follows.", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let wardName = null;
  if (str(ctx.wardId)) { try { const w = (await listWards(env, ctx.orgId)).find((x) => x.id === str(ctx.wardId)); if (!w) return { ...base, ok: false, status: 404, error: "ward_not_found", written: 0 }; wardName = w.name; } catch { return { ...base, ok: false, status: 502, error: "wards_unreadable", written: 0 }; } }
  const id = newId("wsq-hk", ctx.orgId);
  const task = { resourceType: TASK_TYPE, id, kind, origin: "manual", state: "open", location: location.slice(0, 120), wardId: str(ctx.wardId) || null, wardName,
    ...(kind === "terminal-clean" ? { isolationType: iso } : {}), note: str(ctx.note).slice(0, 300) || null,
    requestedAt: new Date().toISOString(), requestedBy: resolved.actor.id, inspections: [] };
  try {
    const out = await svc.put(task, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, taskId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** A task that exists only as a cleaning bed becomes a record here, from the bed as it is now. */
async function materialise(env, ctx, svc, taskId) {
  const t = await svc.get(TASK_TYPE, taskId);
  if (t) return { task: t };
  const m = /^wsq-hk-bed-(.+)-(\d+)$/.exec(taskId);
  if (!m) return { error: { ok: false, status: 404, error: "task_not_found" } };
  let bed, wards;
  try { bed = await getBed(env, m[1]); wards = await listWards(env, ctx.orgId); } catch { return { error: { ok: false, status: 502, error: "beds_unreadable" } }; }
  if (!bed || bed.orgId !== ctx.orgId) return { error: { ok: false, status: 404, error: "task_not_found" } };
  if (bed.state !== "cleaning" || bedTaskId(bed) !== taskId) return { error: { ok: false, status: 409, error: "bed_not_cleaning", detail: "This bed is no longer waiting for a clean." } };
  const w = (wards || []).find((x) => x.id === bed.wardId);
  return { task: { resourceType: TASK_TYPE, id: taskId, kind: bed.isolation ? "terminal-clean" : "bed-clean", origin: "bed", state: "open", bedId: bed.id, bedName: bed.name,
    wardId: bed.wardId, wardName: w ? w.name : null, isolationBed: !!bed.isolation, bedStateSince: bed.stateSince || null,
    requestedAt: bed.stateSince ? new Date(bed.stateSince).toISOString() : null, inspections: [], version: 0 } };
}

/** One step on a task. ctx: { taskId, step: assign|start|finish|inspect|cancel, assignee, kind, isolationType, result, note, reason, canInspect } */
async function housekeepingStep(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const step = str(ctx.step), taskId = str(ctx.taskId);
  if (!taskId || !["assign", "start", "finish", "inspect", "cancel"].includes(step)) return { ...base, ok: false, status: 422, error: "bad_step", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let got;
  try { got = await materialise(env, ctx, svc, taskId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (got.error) return { ...base, ...got.error, written: 0 };
  const cur = got.task, me = resolved.actor.id, at = new Date().toISOString();
  const next = { ...cur };
  delete next.version; delete next.meta;
  const refuse = (status, err, detail) => ({ ...base, ok: false, status, error: err, detail, written: 0 });

  if (step === "assign") {
    if (!["open", "assigned", "rework"].includes(cur.state)) return refuse(409, "out_of_order", `This task is ${cur.state}.`);
    const kind = str(ctx.kind) || cur.kind;
    if (cur.origin === "bed" && !["bed-clean", "terminal-clean"].includes(kind)) return refuse(422, "bad_kind", "A bed task is a bed clean or a terminal clean.");
    if (kind === "terminal-clean" && !ISOLATION.includes(str(ctx.isolationType) || str(cur.isolationType))) return refuse(422, "isolation_type_required", "A terminal clean needs the isolation type it follows.");
    Object.assign(next, { kind, ...(kind === "terminal-clean" ? { isolationType: str(ctx.isolationType) || cur.isolationType } : {}),
      state: "assigned", assignee: str(ctx.assignee) || me, assignedAt: at, assignedBy: me });
  } else if (step === "start") {
    if (cur.state !== "assigned") return refuse(409, "out_of_order", "Assign the task before starting it.");
    if (str(cur.assignee) !== me) return refuse(403, "not_assignee", "Only the person the task is assigned to starts it.");
    Object.assign(next, { state: "in-progress", startedAt: at });
  } else if (step === "finish") {
    if (cur.state !== "in-progress") return refuse(409, "out_of_order", "Start the task before finishing it.");
    if (str(cur.assignee) !== me) return refuse(403, "not_assignee", "Only the person doing the clean finishes it.");
    Object.assign(next, { state: "finished", finishedAt: at, finishedBy: me });
  } else if (step === "inspect") {
    if (ctx.canInspect !== true) return refuse(403, "inspect_capability_required", "Inspection needs the housekeeping inspection authority.");
    if (cur.state !== "finished") return refuse(409, "out_of_order", "Only a finished clean is inspected.");
    if (me === str(cur.finishedBy) || me === str(cur.assignee)) return refuse(403, "inspector_cleaned", "The person who cleaned cannot inspect their own clean.");
    const result = str(ctx.result);
    if (result !== "pass" && result !== "fail") return refuse(422, "bad_result", "An inspection passes or fails.");
    if (result === "fail" && !str(ctx.note)) return refuse(422, "note_required", "Say what has to be done again.");
    next.inspections = [...(cur.inspections || []), { at, by: me, result, note: str(ctx.note).slice(0, 300) || null }];
    Object.assign(next, result === "pass" ? { state: "inspected", inspectedAt: at, inspectedBy: me } : { state: "rework", startedAt: null, finishedAt: null, finishedBy: null });
  } else {
    if (ctx.canInspect !== true) return refuse(403, "inspect_capability_required", "Cancelling a task needs the housekeeping inspection authority.");
    if (cur.origin === "bed") return refuse(409, "bed_task", "A bed clean ends when it is inspected, or when the bed is taken out of cleaning.");
    if (["inspected", "cancelled"].includes(cur.state)) return refuse(409, "out_of_order", `This task is ${cur.state}.`);
    if (!str(ctx.reason)) return refuse(422, "reason_required", "Say why it is cancelled.");
    Object.assign(next, { state: "cancelled", cancelledAt: at, cancelledBy: me, cancelReason: str(ctx.reason).slice(0, 300) });
  }

  let out;
  try { out = await svc.put(next, { expectedVersion: cur.version || 0, idempotencyKey: ctx.idempotencyKey || null }); }
  catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
  const done = { ...base, ok: true, written: 1, taskId, state: next.state, version: out.record.version };
  if (!(step === "inspect" && next.state === "inspected" && cur.origin === "bed")) return done;

  /* The bed goes back to available only now, and only if it is still the same clean. A write to the bed master
   * that fails is said: the inspection is recorded, the bed is not released. */
  let bed;
  try { bed = await getBed(env, cur.bedId); } catch { bed = undefined; }
  if (bed === undefined) return { ...done, ok: false, status: 502, error: "bed_not_released", detail: "The inspection is recorded, but the bed could not be read, so it is still cleaning. Release it on the bed board." };
  if (!bed || bed.state !== "cleaning" || bedTaskId(bed) !== taskId) return { ...done, bedReleased: false, bedNote: "The bed had already left cleaning, so it was not changed." };
  try { await updateBed(env, bed.id, { state: "available" }, me); }
  catch (e) { return { ...done, ok: false, status: e && e.code === "bed_changed" ? 409 : 502, error: "bed_not_released", detail: "The inspection is recorded, but the bed could not be released. Release it on the bed board." }; }
  return { ...done, bedReleased: true };
}

/** Turnaround over the last `days` days. */
async function housekeepingReport(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off" };
  const days = Math.max(1, Math.min(90, Number(ctx.days) || 7));
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let tasks;
  try { tasks = await readTasks(svc); } catch (e) { return { ...base, ...readFailure(e) }; }
  const toMs = Date.now();
  return { ...base, ok: true, days, ...turnaround(tasks, toMs - days * 86400000, toMs) };
}

export {
  TASK_TYPE, KINDS, ISOLATION, bedTaskId, boardTasks, turnaround,
  housekeepingBoard, raiseHousekeepingTask, housekeepingStep, housekeepingReport,
};
