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
import { appendOrgAudit } from "./_q_audit_chain.js";
import { listWards } from "./_opd_org_store.js";
import { onDutyNow, wardTeamGroupOf } from "./_wardsynq/alert-recipients.js";
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

/* P2.17: the rota for a span, raw, for the security review to compare chart reads against. partial is
 * true when any month hit the scan cap, so the caller can say the comparison is incomplete. */
export async function assignmentsBetween(env, orgId, from, to) {
  const [shifts, { list, partial }] = await Promise.all([shiftsOf(env, orgId), rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, datesBetween(from, to), 1))]);
  return { ok: true, shifts, assignments: list.filter((a) => a.status !== "cancelled" && a.date >= R.addDays(from, -1) && a.date <= to), partial };
}

export async function onDuty(env, orgId, unit, utcOffsetMinutes) {
  const shifts = await shiftsOf(env, orgId);
  const { list, partial } = await rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(orgId, [today()], 1));
  return { ok: true, onDuty: R.onDutyAt(now(), utcOffsetMinutes, shifts, list, unit).map((a) => ({ identity: a.identity, shiftId: a.shiftId, shift: shifts[a.shiftId].name, unit: shifts[a.shiftId].unit, date: a.date })), partial };
}

/* SELF-MARKED DUTY (owner 2026-09-15). A nurse, resident or consultant says "I am on duty" (for a ward) or "I am off
 * duty", for their own membership only. One row per person per hospital, overwritten, each change a hash-chained
 * event-log row IN THE SAME COMMIT (appendOrgAudit), so a status with no audit row cannot exist. It stops counting at
 * the end of the shift they are rostered on now, or after 12 hours (R.dutyExpiry). Staff data, never the record. */
const offsetOf = (org) => (org && org.wardsynq && org.wardsynq.utcOffsetMinutes != null ? org.wardsynq.utcOffsetMinutes : 330);
const dutyPath = (orgId, identity) => "q_duty_status/" + sanitize(orgId) + "__" + sanitize(identity);
const liveStatus = (s, at) => !!s && Number(s.expiresAt) > at;
const statusOut = (s) => ({ status: s.status, unit: s.unit || "", setAt: s.setAt, expiresAt: new Date(Number(s.expiresAt)).toISOString(), basis: s.basis || "hours", shiftId: s.shiftId || "" });

export async function dutyStatuses(env, orgId) {
  const { list, partial } = await rows(env, "q_duty_status", orgId);
  return { ok: true, statuses: list.map((s) => ({ identity: s.identity, status: s.status, unit: s.unit || "", expiresAt: Number(s.expiresAt) || 0, setAt: s.setAt })), partial };
}

/** The wards a person may say they are working on: the rota's units, the hospital's wards, and the configured bed lists. */
export async function wardChoices(env, org) {
  const [shifts, wards] = await Promise.all([shiftsOf(env, org.id), listWards(env, org.id).catch(() => [])]);
  const beds = org.wardsynq && org.wardsynq.beds && typeof org.wardsynq.beds === "object" ? Object.keys(org.wardsynq.beds) : [];
  return [...new Set([...Object.values(shifts).map((s) => s.unit), ...wards.filter((w) => w.active !== false).map((w) => w.name), ...beds].map((x) => String(x || "").trim()).filter(Boolean))].sort();
}

async function rotaNow(env, org, identity) {
  const [shifts, { list }] = await Promise.all([shiftsOf(env, org.id), rowsBy(env, "q_roster_assign", "orgMonth", monthsFor(org.id, [today()], 1))]);
  return R.dutyExpiry(now(), offsetOf(org), shifts, list, identity);
}

export async function myDutyStatus(env, org, identity) {
  const [d, exp, wards] = await Promise.all([fsGet(env, dutyPath(org.id, identity)), rotaNow(env, org, identity), wardChoices(env, org)]);
  const s = d && d.fields && d.fields.orgId === String(org.id) ? d.fields : null;
  return { ok: true, identity, status: liveStatus(s, now()) ? statusOut(s) : null, rota: exp.shift, wards, hours: R.DUTY_STATUS_HOURS };
}

export async function setDutyStatus(env, org, identity, input) {
  const status = String((input && input.status) || "");
  if (status !== "on" && status !== "off") return { ok: false, error: "bad_status", message: "Say on or off duty." };
  const [exp, wards] = await Promise.all([rotaNow(env, org, identity), wardChoices(env, org)]);
  let unit = "";
  if (status === "on") {
    unit = String((input && input.unit) || "").trim() || (exp.shift ? exp.shift.unit : "");
    if (!unit) return { ok: false, error: "ward_required", message: "You are not on the rota now. Choose the ward you are working on." };
    if (!wards.includes(unit)) return { ok: false, error: "unknown_ward", message: `"${unit.slice(0, 60)}" is not a ward in this hospital. Choose one of: ${wards.join(", ") || "no wards are set up yet"}.` };
  }
  const at = now();
  const fields = { orgId: String(org.id), identity, status, unit, setAt: at, expiresAt: exp.expiresAt, basis: exp.basis, shiftId: exp.shift ? exp.shift.id : "" };
  try {
    await appendOrgAudit(env, { hospitalId: org.id, ticketId: "", actor: identity, action: "roster:duty_" + status, meta: `${identity}${unit ? " " + unit : ""} until ${new Date(exp.expiresAt).toISOString()}` }, [wUpdate(env, dutyPath(org.id, identity), fields)]);
  } catch (e) {
    return { ok: false, error: "duty_status_not_saved", message: "Your duty status was not saved. Nothing changed; try again." };
  }
  return { ok: true, identity, status: statusOut(fields), rota: exp.shift };
}

/** For the rota screen: who is on duty now in each ward (rota or self-marked) and who marked themselves off. No patient data. */
export async function dutyByWard(env, org, members) {
  const [duty, st] = await Promise.all([onDuty(env, org.id, "", offsetOf(org)), dutyStatuses(env, org.id)]);
  const at = now();
  const roleOf = new Map((members || []).filter((m) => m && m.active !== false).map((m) => [m.identity, m.role]));
  const liveBy = new Map(st.statuses.filter((s) => liveStatus(s, at)).map((s) => [s.identity, s]));
  const wards = new Map();
  for (const a of onDutyNow({ unit: "", duty: duty.onDuty, statuses: st.statuses, nowMs: at })) {
    if (!wards.has(a.unit)) wards.set(a.unit, []);
    const s = liveBy.get(a.identity);
    wards.get(a.unit).push({ identity: a.identity, role: roleOf.get(a.identity) || null, group: wardTeamGroupOf(roleOf.get(a.identity)), via: a.via, until: s && s.status === "on" ? new Date(s.expiresAt).toISOString() : null });
  }
  const off = [...liveBy.values()].filter((s) => s.status === "off").map((s) => ({ identity: s.identity, role: roleOf.get(s.identity) || null, until: new Date(s.expiresAt).toISOString() }));
  return { ok: true, wards: [...wards].sort((a, b) => a[0].localeCompare(b[0])).map(([ward, people]) => ({ ward, people })), off, partial: !!(duty.partial || st.partial) };
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
