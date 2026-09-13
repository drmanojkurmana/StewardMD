/* functions/_roster_store.js — staff rostering storage, beside memberships in the org store.
 *
 * Every rule is in _roster.js (pure, tested); this file reads, calls the rules, writes, and audits.
 * Nothing here touches the patient record. Every write is audited under the hospital.
 *
 * ASSIGNING SEVERAL WEEKS IS ALL-OR-NOTHING: every date is checked first and, if any one is refused,
 * none is written and every refusal is returned, so a manager never ends up with half a repeating rota.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import * as R from "./_roster.js";

const now = () => Date.now();
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const newId = () => crypto.randomUUID().replace(/-/g, "");
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: String(meta || "").slice(0, 200) });
const SCAN = 1000;
const fail = (e) => ({ ok: false, error: e.code || "roster_error", message: e.message });

async function rows(env, coll, orgId) {
  const r = await fsQuery(env, coll, { where: { field: "orgId", value: String(orgId) }, limit: SCAN });
  return { list: r.map((x) => ({ id: x.id, ...(x.fields || {}) })), partial: r.length >= SCAN };
}
/* ASSIGNMENTS ARE READ BY MONTH, LEAVE BY YEAR. A whole-hospital scan capped at SCAN rows fills in about a
 * month for thirty staff, after which every clash check would be working on part of the rota. Each check
 * reads only the months (or years) that can possibly clash with what it is checking. */
const monthKey = (orgId, date) => String(orgId) + "|" + String(date).slice(0, 7);
const yearKey = (orgId, date) => String(orgId) + "|" + String(date).slice(0, 4);
const today = () => new Date().toISOString().slice(0, 10);
function datesBetween(from, to) { const out = []; for (let d = from; d <= to && out.length < 400; d = R.addDays(d, 1)) out.push(d); return out; }
const monthsFor = (orgId, dates, padDays) => [...new Set(dates.flatMap((d) => [R.addDays(d, -(padDays || 0)), d, R.addDays(d, padDays || 0)]).map((d) => monthKey(orgId, d)))];
const yearsFor = (orgId, dates) => [...new Set(dates.flatMap((d) => [d, String(Number(d.slice(0, 4)) - 1) + d.slice(4)]).map((d) => yearKey(orgId, d)))];
async function rowsBy(env, coll, field, keys) {
  const byId = new Map(); let partial = false;
  for (const k of keys) {
    const r = await fsQuery(env, coll, { where: { field, value: k }, limit: SCAN });
    if (r.length >= SCAN) partial = true;
    for (const x of r) byId.set(x.id, { id: x.id, ...(x.fields || {}) });
  }
  return { list: [...byId.values()], partial };
}
const TOO_BIG = { ok: false, error: "roster_too_large_to_check", message: "Too many rota entries in these months to check for clashes, so nothing was changed." };
async function shiftsOf(env, orgId) {
  const { list } = await rows(env, "q_roster_shifts", orgId);
  const out = {}; for (const s of list) if (s.active !== false) out[s.shiftId] = { ...s, id: s.shiftId };
  return out;
}

export async function listShifts(env, orgId) { return { ok: true, shifts: Object.values(await shiftsOf(env, orgId)) }; }

export async function saveShift(env, orgId, input, actorId) {
  let def;
  try { def = R.shiftDef({ ...input, id: input.id || sanitize(String(input.name || "").toLowerCase()) }); } catch (e) { return fail(e); }
  await fsCommit(env, [wUpdate(env, "q_roster_shifts/" + sanitize(orgId) + "__" + sanitize(def.id), { orgId: String(orgId), shiftId: def.id, name: def.name, unit: def.unit, start: def.start, end: def.end, minimum: def.minimum, active: input.active !== false, updatedAt: now() })]);
  await audit(env, orgId, actorId, "roster:shift_saved", `${def.name} ${def.unit} ${def.start}-${def.end}`);
  return { ok: true, shift: def };
}

export async function assign(env, orgId, input, actorId) {
  const shifts = await shiftsOf(env, orgId);
  let dates;
  try { dates = R.weeklyDates(input.date, input.weeks); } catch (e) { return fail(e); }
  const [{ list: existing, partial }, { list: leaves, partial: lp }] = await Promise.all([rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, dates, 1)), rowsBy(env, "q_roster_leave", "orgYear", yearsFor(orgId, dates))]);
  if (partial || lp) return TOO_BIG;
  const pending = [], refused = [];
  for (const date of dates) {
    const a = { identity: String(input.identity || ""), date, shiftId: String(input.shiftId || "") };
    const p = R.assignmentProblem(a, shifts, existing.concat(pending), leaves);
    if (p) refused.push({ date, error: p.code, message: p.message }); else pending.push({ ...a, id: newId(), status: "active" });
  }
  if (refused.length) return { ok: false, error: "assignment_refused", message: "Nothing was assigned: " + refused.map((r) => r.message).join("; "), refused };
  await fsCommit(env, pending.map((a) => wCreate(env, "q_roster_assign/" + a.id, { orgId: String(orgId), orgMonth: monthKey(orgId, a.date), identity: a.identity, date: a.date, shiftId: a.shiftId, status: "active", createdBy: actorId, createdAt: now() })));
  await audit(env, orgId, actorId, "roster:assigned", `${input.identity} ${input.shiftId} ${dates[0]} x${dates.length}`);
  return { ok: true, assigned: pending };
}

export async function unassign(env, orgId, assignmentId, reason, actorId) {
  if (!String(reason || "").trim()) return { ok: false, error: "reason_required", message: "Say why this shift is being removed." };
  const d = await fsGet(env, "q_roster_assign/" + sanitize(assignmentId));
  if (!d || d.fields.orgId !== String(orgId)) return { ok: false, error: "not_found" };
  await fsCommit(env, [wUpdate(env, "q_roster_assign/" + sanitize(assignmentId), { status: "cancelled", cancelReason: String(reason).slice(0, 200), cancelledBy: actorId, updatedAt: now() })]);
  await audit(env, orgId, actorId, "roster:unassigned", `${d.fields.identity} ${d.fields.date} ${reason}`);
  return { ok: true };
}

export async function coverageFor(env, orgId, from, to, roleOf) {
  const shifts = await shiftsOf(env, orgId);
  try { R.coverage(from, to, {}, [], roleOf); } catch (e) { return fail(e); }
  const { list, partial } = await rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, datesBetween(from, to), 0));
  return { ok: true, coverage: R.coverage(from, to, shifts, list, roleOf), partial };
}

export async function onDuty(env, orgId, unit, utcOffsetMinutes) {
  const shifts = await shiftsOf(env, orgId);
  const { list, partial } = await rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, [today()], 1));
  return { ok: true, onDuty: R.onDutyAt(now(), utcOffsetMinutes, shifts, list, unit).map((a) => ({ identity: a.identity, shiftId: a.shiftId, shift: shifts[a.shiftId].name, unit: shifts[a.shiftId].unit, date: a.date })), partial };
}

export async function mine(env, orgId, identity) {
  const span = datesBetween(R.addDays(today(), -7), R.addDays(today(), 62));
  const [{ list: asg }, { list: leaves }, { list: swaps }, shifts] = await Promise.all([rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, span, 0)), rowsBy(env, "q_roster_leave", "orgYear", yearsFor(orgId, [today(), R.addDays(today(), 62)])), rowsBy(env, "q_roster_swap", "orgMonth", monthsFor(orgId, span, 0)), shiftsOf(env, orgId)]);
  return {
    ok: true,
    assignments: asg.filter((a) => a.identity === identity && a.status !== "cancelled").map((a) => ({ ...a, shift: shifts[a.shiftId] || null })).sort((a, b) => a.date.localeCompare(b.date)),
    leave: leaves.filter((l) => l.identity === identity),
    swaps: swaps.filter((s) => s.from === identity || s.to === identity),
  };
}

export async function requestLeave(env, orgId, identity, input) {
  let l; try { l = R.validLeave(input); } catch (e) { return fail(e); }
  const id = newId();
  await fsCommit(env, [wCreate(env, "q_roster_leave/" + id, { orgId: String(orgId), orgYear: yearKey(orgId, l.from), identity, ...l, status: "requested", requestedAt: now() })]);
  await audit(env, orgId, identity, "roster:leave_requested", `${l.from}..${l.to}`);
  return { ok: true, leave: { id, identity, ...l, status: "requested" } };
}

/** Approving leave that clashes with shifts already rostered is refused, naming the shifts: remove or swap them first. */
export async function decideLeave(env, orgId, leaveId, approve, actorId) {
  const d = await fsGet(env, "q_roster_leave/" + sanitize(leaveId));
  if (!d || d.fields.orgId !== String(orgId)) return { ok: false, error: "not_found" };
  if (d.fields.status !== "requested") return { ok: false, error: "already_decided", message: "This leave request was already " + d.fields.status + "." };
  if (approve) {
    const { list, partial } = await rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, datesBetween(d.fields.from, d.fields.to), 1));
    if (partial) return TOO_BIG;
    const clashes = list.filter((a) => a.identity === d.fields.identity && a.status !== "cancelled" && d.fields.from <= a.date && a.date <= d.fields.to);
    if (clashes.length) return { ok: false, error: "leave_clashes_with_rota", message: `${d.fields.identity} is rostered on ${clashes.map((c) => c.date).join(", ")}. Remove or swap those shifts first.`, clashes };
  }
  const status = approve ? "approved" : "declined";
  await fsCommit(env, [wUpdate(env, "q_roster_leave/" + sanitize(leaveId), { status, decidedBy: actorId, decidedAt: now() })]);
  await audit(env, orgId, actorId, "roster:leave_" + status, `${d.fields.identity} ${d.fields.from}..${d.fields.to}`);
  return { ok: true, decision: status };
}

export async function pendingLeave(env, orgId) {
  const y = Number(today().slice(0, 4));
  const { list, partial } = await rowsBy(env, "q_roster_leave", "orgYear", [y - 1, y, y + 1].map((n) => String(orgId) + "|" + n));
  return { ok: true, leave: list.filter((l) => l.status === "requested").sort((a, b) => String(a.from).localeCompare(String(b.from))), partial };
}

export async function proposeSwap(env, orgId, identity, assignmentId, to) {
  const d = await fsGet(env, "q_roster_assign/" + sanitize(assignmentId));
  if (!d || d.fields.orgId !== String(orgId) || d.fields.status === "cancelled") return { ok: false, error: "not_found" };
  if (d.fields.identity !== identity) return { ok: false, error: "not_your_shift", message: "You can only offer your own shift." };
  const id = newId();
  await fsCommit(env, [wCreate(env, "q_roster_swap/" + id, { orgId: String(orgId), orgMonth: monthKey(orgId, d.fields.date), assignmentId: sanitize(assignmentId), from: identity, to: String(to || ""), date: d.fields.date, shiftId: d.fields.shiftId, status: "proposed", createdAt: now() })]);
  await audit(env, orgId, identity, "roster:swap_proposed", `${d.fields.date} to ${to}`);
  return { ok: true, swapId: id };
}

export async function respondSwap(env, orgId, identity, swapId, accept) {
  const d = await fsGet(env, "q_roster_swap/" + sanitize(swapId));
  if (!d || d.fields.orgId !== String(orgId)) return { ok: false, error: "not_found" };
  if (d.fields.to !== identity) return { ok: false, error: "not_your_swap", message: "Only the colleague asked can answer this swap." };
  if (d.fields.status !== "proposed") return { ok: false, error: "already_answered" };
  const status = accept ? "accepted" : "declined";
  await fsCommit(env, [wUpdate(env, "q_roster_swap/" + sanitize(swapId), { status, respondedAt: now() })]);
  await audit(env, orgId, identity, "roster:swap_" + status, d.fields.date);
  return { ok: true, decision: status };
}

/** The manager's approval re-checks the swap against today's rota: things change between asking and approving. */
export async function approveSwap(env, orgId, swapId, approve, actorId) {
  const d = await fsGet(env, "q_roster_swap/" + sanitize(swapId));
  if (!d || d.fields.orgId !== String(orgId)) return { ok: false, error: "not_found" };
  if (d.fields.status !== "accepted") return { ok: false, error: "not_accepted", message: "The colleague has to accept the swap before it can be approved." };
  if (!approve) {
    await fsCommit(env, [wUpdate(env, "q_roster_swap/" + sanitize(swapId), { status: "declined", decidedBy: actorId, decidedAt: now() })]);
    await audit(env, orgId, actorId, "roster:swap_declined_by_manager", d.fields.date);
    return { ok: true, decision: "declined" };
  }
  const a = await fsGet(env, "q_roster_assign/" + d.fields.assignmentId);
  if (!a || a.fields.status === "cancelled" || a.fields.identity !== d.fields.from) return { ok: false, error: "shift_changed", message: "That shift has changed since the swap was asked for." };
  const shifts = await shiftsOf(env, orgId);
  const [{ list: existing, partial }, { list: leaves, partial: lp }] = await Promise.all([rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, [d.fields.date], 1)), rowsBy(env, "q_roster_leave", "orgYear", yearsFor(orgId, [d.fields.date]))]);
  if (partial || lp) return TOO_BIG;
  const p = R.swapProblem({ id: d.fields.assignmentId, ...a.fields }, d.fields.to, shifts, existing, leaves);
  if (p) return fail(p);
  await fsCommit(env, [
    wUpdate(env, "q_roster_assign/" + d.fields.assignmentId, { identity: d.fields.to, swappedFrom: d.fields.from, updatedAt: now() }),
    wUpdate(env, "q_roster_swap/" + sanitize(swapId), { status: "approved", decidedBy: actorId, decidedAt: now() }),
  ]);
  await audit(env, orgId, actorId, "roster:swap_approved", `${d.fields.date} ${d.fields.from} -> ${d.fields.to}`);
  return { ok: true, decision: "approved" };
}

export async function pendingSwaps(env, orgId) {
  const { list, partial } = await rowsBy(env, "q_roster_swap", "orgMonth", monthsFor(orgId, datesBetween(R.addDays(today(), -31), R.addDays(today(), 62)), 0));
  return { ok: true, swaps: list.filter((s) => s.status === "accepted" || s.status === "proposed"), partial };
}
