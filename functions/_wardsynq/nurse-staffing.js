/* functions/_wardsynq/nurse-staffing.js - nurses required per ward per shift from census and dependency, checked against
 * the rota (P4 nursing-staffing, gap 9 of the 2026-09-17 audit), and the staff needlestick and sharps injury report.
 *
 * THE REQUIREMENT IS ARITHMETIC ON THE HOSPITAL'S OWN NUMBERS, SHOWN LINE BY LINE. For each dependency level in the ward:
 * patients at that level divided by the hospital's patients-per-nurse for that level (and unit type, and shift), summed,
 * rounded up once at the end. WardSynQ ships no ratio and no dependency tool. The dependency levels are the bands of a
 * risk tool the hospital supplies (risk-assessment.js); the norms are rows the hospital enters (wardsynq.staffing):
 *
 *   wardTypes  { "<ward>": "<unit type>" }                                          e.g. which wards are ICUs
 *   norms      [{ unitType, shiftId ("*" every shift), band ("*" any level), patientsPerNurse }]
 *   dependencyToolId  the riskTools id whose bands are the dependency levels, or null to count every patient alike
 *
 * WHAT IS NOT KNOWN IS SAID. A ward with no unit type or a unit type with no norm is "not configured", never "fully
 * staffed". A patient with no dependency level for the shift is listed as missing, and the requirement is then a lower
 * bound that can show short but never met. A dependency level with no norm row is listed too.
 *
 * THE IN-CHARGE IS NOT COUNTED (NABH 6th edition PSQ 3c #21 remarks: "the in-charge/supervisor of the area shall not be
 * included"). The rota marks who is in charge of a shift; that person is left out of rostered and on-duty counts.
 *
 * A DRAFT IS A SUGGESTION. draftRoster fills the gap of a coming shift from nurses who are not on approved leave and not
 * already on an overlapping shift. Nothing is written until a staff.admin publishes it through /roster/draft-publish,
 * which checks every entry again.
 *
 * STAFF DATA, NOT THE CHART. The shift staffing record (NABH #21) and the staff injury report (NABH #30) are written to the
 * hospital's append-only store under their own types, like hr-attendance.js and for its reason: a RecordService type is
 * readable through the raw record door by every emr.view role, and a staff member's injury is not the chart. Every write
 * is a new version in the same append as its audit row. Audit rows carry ids and counts, never a name.
 */

import { VersionConflictError } from "./repository.js";
import { span as shiftSpan, onLeave, assignmentProblem, addDays } from "../_roster.js";
import { onDutyNow, wardTeamGroupOf } from "./alert-recipients.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";

const SHIFT_TYPE = "_wardsynq_staffing_shift", INJURY_TYPE = "_wardsynq_staff_injury";
const INJURY_KINDS = Object.freeze(["needlestick", "sharp", "splash", "other"]);
const HOUR = 3600000, DAY = 86400000, PAGE = 1000, MAX_PAGES = 10, ASSESS_READ = 5000;
const DRAFT_DAYS = 7;

const str = (v) => (v == null ? "" : String(v).trim());
const low = (v) => str(v).toLowerCase();
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && ms(str(d) + "T00:00:00Z") != null;
const offOf = (cfg) => (cfg && cfg.utcOffsetMinutes != null && Number.isFinite(Number(cfg.utcOffsetMinutes)) ? Number(cfg.utcOffsetMinutes) : 330);
const localDate = (t, off) => new Date(t + off * 60000).toISOString().slice(0, 10);
const refuse = (status, error, message, extra) => ({ ok: false, status, error, message, ...(extra || {}) });
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor: str(actor), connectorId: "wardsynq-staffing", action, outcome: "ok", scope });
const isNurse = (role) => wardTeamGroupOf(role) === "nurse";

/* ------------------------------------------------------------------ settings */

/** PURE. The staffing settings as saved, shaped for the screen. Nothing is filled in that the hospital did not enter. */
function readStaffingNorms(cfg) {
  const s = cfg && cfg.staffing && typeof cfg.staffing === "object" ? cfg.staffing : {};
  const wardTypes = {};
  for (const [w, t] of Object.entries(s.wardTypes && typeof s.wardTypes === "object" ? s.wardTypes : {})) if (str(w) && str(t)) wardTypes[str(w)] = str(t);
  const norms = (Array.isArray(s.norms) ? s.norms : []).filter((n) => n && str(n.unitType) && Number(n.patientsPerNurse) > 0)
    .map((n) => ({ unitType: str(n.unitType), shiftId: str(n.shiftId) || "*", band: str(n.band) || "*", patientsPerNurse: Number(n.patientsPerNurse) }));
  return { dependencyToolId: str(s.dependencyToolId) || null, wardTypes, norms };
}

/** PURE. Validates what the admin sent against the hospital's risk tools and shifts. -> { value, errors } */
function validateStaffingNorms(input, riskTools, shiftIds) {
  const errors = [], i = input && typeof input === "object" ? input : null;
  if (!i) return { value: null, errors: ["Send the staffing settings as an object."] };
  const toolId = str(i.dependencyToolId) || null;
  const tool = toolId ? (Array.isArray(riskTools) ? riskTools : []).find((t) => t && str(t.id) === toolId) : null;
  if (toolId && !tool) errors.push(`"${toolId.slice(0, 60)}" is not one of this hospital's risk tools.`);
  const bands = new Set(((tool && tool.bands) || []).map((b) => str(b && b.band)).filter(Boolean));
  const wardTypes = {};
  const wt = i.wardTypes && typeof i.wardTypes === "object" && !Array.isArray(i.wardTypes) ? i.wardTypes : {};
  if (Object.keys(wt).length > 200) errors.push("At most 200 wards.");
  for (const [w, t] of Object.entries(wt)) {
    if (!str(w) || !str(t)) { errors.push("Every ward needs a unit type."); continue; }
    if (str(w).length > 80 || str(t).length > 60) { errors.push(`"${str(w).slice(0, 30)}": a ward name is at most 80 characters and a unit type 60.`); continue; }
    wardTypes[str(w)] = str(t);
  }
  const rows = Array.isArray(i.norms) ? i.norms : [];
  if (rows.length > 300) errors.push("At most 300 norm rows.");
  const norms = [], seen = new Set();
  for (const n of rows.slice(0, 300)) {
    const unitType = str(n && n.unitType), shiftId = str(n && n.shiftId) || "*", band = str(n && n.band) || "*", ppn = Number(n && n.patientsPerNurse);
    const where = `${unitType || "?"} / ${shiftId} / ${band}`;
    if (!unitType) { errors.push("Every norm row needs a unit type."); continue; }
    if (!Object.values(wardTypes).includes(unitType)) errors.push(`${where}: no ward has the unit type "${unitType}".`);
    if (shiftId !== "*" && !(shiftIds || []).includes(shiftId)) errors.push(`${where}: "${shiftId}" is not a shift on the rota.`);
    if (band !== "*" && !toolId) errors.push(`${where}: a dependency level needs a dependency tool; use * to count every patient alike.`);
    if (band !== "*" && toolId && tool && !bands.has(band)) errors.push(`${where}: "${band}" is not a band of the tool "${toolId}".`);
    if (!Number.isFinite(ppn) || ppn <= 0 || ppn > 50) errors.push(`${where}: patients per nurse must be a number above 0 and at most 50.`);
    const key = low(unitType) + "|" + shiftId + "|" + band;
    if (seen.has(key)) errors.push(`${where}: this row is entered twice.`);
    seen.add(key);
    norms.push({ unitType, shiftId, band, patientsPerNurse: ppn });
  }
  return { value: { dependencyToolId: toolId, wardTypes, norms }, errors };
}

/* ------------------------------------------------------------------ pure calculation */

/** PURE. The instant span of one shift on one local date: [startMs, endMs). */
function shiftWindow(date, shift, off) {
  const [a, b] = shiftSpan(date, shift);
  return [a * 60000 - off * 60000, b * 60000 - off * 60000];
}

/**
 * PURE. A patient's dependency level for a shift. mode "shift": an assessment made during the shift, or within the tool's
 * reassessment interval before it started (no interval: during the shift only). mode "latest": the newest assessment made
 * by `endMs` (a projection for a shift that has not started). A score outside every band has no level.
 * -> { band|null, assessedAt|null, why? }
 */
function dependencyFor(assessments, encounterId, toolId, startMs, endMs, reassessHours, mode) {
  const floor = mode === "latest" ? -Infinity : startMs - (Number(reassessHours) > 0 ? Number(reassessHours) * HOUR : 0);
  const mine = (assessments || []).filter((a) => a && str(a.encounterId) === str(encounterId) && str(a.toolId) === str(toolId))
    .filter((a) => { const t = ms(a.assessedAt); return t != null && t < endMs && t >= floor; })
    .sort((x, y) => ms(y.assessedAt) - ms(x.assessedAt));
  if (!mine.length) return { band: null, assessedAt: null, why: "not_assessed" };
  return mine[0].band ? { band: str(mine[0].band), assessedAt: mine[0].assessedAt } : { band: null, assessedAt: mine[0].assessedAt, why: "outside_bands" };
}

/**
 * PURE. Nurses required for one ward on one shift. patients: [{encounterId, bed, band|null, why?}] (band ignored when the
 * hospital has no dependency tool). -> { configured, reason?, unitType, lines, missing, noNorm, census, required, complete }
 */
function requiredNurses(patients, ward, shiftId, settings) {
  const s = settings || { wardTypes: {}, norms: [] };
  const typeKey = Object.keys(s.wardTypes || {}).find((w) => low(w) === low(ward));
  const unitType = typeKey ? s.wardTypes[typeKey] : null;
  const census = (patients || []).length;
  if (!unitType) return { configured: false, reason: "ward_has_no_unit_type", unitType: null, census, required: null, complete: false, lines: [], missing: [], noNorm: [] };
  const rows = (s.norms || []).filter((n) => low(n.unitType) === low(unitType));
  if (!rows.length) return { configured: false, reason: "unit_type_has_no_norms", unitType, census, required: null, complete: false, lines: [], missing: [], noNorm: [] };
  const normFor = (band) => rows.find((n) => n.shiftId === shiftId && n.band === band) || rows.find((n) => n.shiftId === "*" && n.band === band)
    || rows.find((n) => n.shiftId === shiftId && n.band === "*") || rows.find((n) => n.shiftId === "*" && n.band === "*") || null;
  const byBand = new Map(), missing = [], noNorm = new Map();
  for (const p of patients || []) {
    const band = s.dependencyToolId ? p.band : "*";
    if (!band) { missing.push({ encounterId: p.encounterId, bed: p.bed || null, why: p.why || "not_assessed" }); continue; }
    const n = normFor(band);
    if (!n) { noNorm.set(band, (noNorm.get(band) || 0) + 1); continue; }
    const key = band + "|" + n.shiftId + "|" + n.band;
    if (!byBand.has(key)) byBand.set(key, { band, normBand: n.band, normShift: n.shiftId, patientsPerNurse: n.patientsPerNurse, patients: 0 });
    byBand.get(key).patients++;
  }
  const lines = [...byBand.values()].map((l) => ({ ...l, nurses: Math.round((l.patients / l.patientsPerNurse) * 100) / 100 }));
  const exact = [...byBand.values()].reduce((a, l) => a + l.patients / l.patientsPerNurse, 0);
  return {
    configured: true, unitType, census, lines, missing, noNorm: [...noNorm].map(([band, n]) => ({ band, patients: n })),
    // Rounded up once, at the end: 1.2 nurses of need is two people. A tiny float error is not a whole extra nurse.
    required: Math.ceil(Math.round(exact * 1e6) / 1e6), complete: !missing.length && !noNorm.size,
  };
}

/** PURE. The verdict on one count against the requirement. Never "met" when the requirement is not configured or not complete. */
function verdict(req, count) {
  if (!req || !req.configured) return "not_configured";
  if (count == null) return null;
  if (count < req.required) return "short";
  return req.complete ? "met" : "incomplete";
}

/**
 * PURE. Rostered nurses on one shift, the in-charge left out. assignments: raw rota rows; roleOf: identity -> role.
 * -> { inCharge: identity|null, nurses: [identity], others: n }
 */
function rostered(assignments, date, shiftId, roleOf) {
  const on = (assignments || []).filter((a) => a && a.date === date && a.shiftId === shiftId && a.status !== "cancelled");
  const lead = on.find((a) => a.inCharge === true);
  return { inCharge: lead ? lead.identity : null, nurses: on.filter((a) => a !== lead && isNurse(roleOf(a.identity))).map((a) => a.identity), others: on.filter((a) => a !== lead && !isNurse(roleOf(a.identity))).length };
}

/**
 * PURE. A draft for the coming shifts of one ward: for each shift short of its projected requirement, nurses who are
 * active, not on approved leave that day and not on an overlapping shift, fewest shifts in the span first. Never the
 * in-charge, never a person twice on one shift. -> { entries: [{identity, date, shiftId}], unfilled: [{date, shiftId, short}] }
 */
function draftRoster(ctx) {
  const shifts = ctx.shifts || {}, pending = [], unfilled = [];
  const existing = (ctx.assignments || []).filter((a) => a && a.status !== "cancelled");
  const load = new Map();
  for (const a of existing) load.set(a.identity, (load.get(a.identity) || 0) + 1);
  const nurses = (ctx.members || []).filter((m) => m && m.active !== false && isNurse(m.role)).map((m) => m.identity).sort();
  for (const t of ctx.targets || []) {
    let short = t.required - t.have;
    if (!(short > 0)) continue;
    const taken = new Set(existing.concat(pending).filter((a) => a.date === t.date && a.shiftId === t.shiftId).map((a) => a.identity));
    const pool = nurses.filter((id) => !taken.has(id) && !onLeave(id, t.date, ctx.leaves) && !assignmentProblem({ identity: id, date: t.date, shiftId: t.shiftId }, shifts, existing.concat(pending), ctx.leaves))
      .sort((x, y) => (load.get(x) || 0) - (load.get(y) || 0) || x.localeCompare(y));
    for (const id of pool) {
      if (!(short > 0)) break;
      pending.push({ identity: id, date: t.date, shiftId: t.shiftId });
      load.set(id, (load.get(id) || 0) + 1);
      short--;
    }
    if (short > 0) unfilled.push({ date: t.date, shiftId: t.shiftId, short });
  }
  return { entries: pending, unfilled };
}

/* ------------------------------------------------------------------ census and dependency (read through the record) */

/** The live census per ward from the bed board, and the dependency assessments of the chosen tool. */
async function censusAndDependency(request, env, ctx) {
  const board = await ctx.bedBoard(request, env, { ...ctx, ward: "" });
  if (!board || !board.ok) return { error: { ok: false, status: (board && board.status) || 502, error: (board && board.error) || "census_unavailable", message: "The ward census could not be read, so the nurses required cannot be worked out." } };
  const settings = readStaffingNorms(ctx.wsqCfg);
  let assessments = [], tool = null;
  if (settings.dependencyToolId) {
    tool = (Array.isArray(ctx.wsqCfg && ctx.wsqCfg.riskTools) ? ctx.wsqCfg.riskTools : []).find((t) => t && str(t.id) === settings.dependencyToolId) || null;
    try {
      const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
      const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
      assessments = ((await svc.list("RiskAssessment", ASSESS_READ)) || []).filter((a) => a && a.toolId === settings.dependencyToolId);
    } catch (e) {
      const status = e instanceof AuthError ? 401 : e instanceof PermissionError || e instanceof GovernanceError ? 403 : 502;
      return { error: { ok: false, status, error: "dependency_unavailable", message: "The dependency assessments could not be read, so the nurses required cannot be worked out." } };
    }
  }
  const wards = (board.wards || []).map((w) => ({ ward: w.ward, patients: [...(w.occupied || []), ...(w.unplaced || [])].map((p) => ({ encounterId: p.encounterId, bed: p.bed || null })) }));
  return { settings, tool, assessments, wards, assessmentsCapped: assessments.length >= ASSESS_READ };
}

function withBands(patients, settings, tool, assessments, startMs, endMs, mode) {
  if (!settings.dependencyToolId) return patients.map((p) => ({ ...p, band: null }));
  return patients.map((p) => ({ ...p, ...dependencyFor(assessments, p.encounterId, settings.dependencyToolId, startMs, endMs, tool && tool.reassessEveryHours, mode) }));
}

/**
 * One ward-shift row. timing: "running" (live census, dependency for the shift, on duty counted), "coming" (live census,
 * latest dependency: a projection) or "ended" (only what was recorded while it ran).
 */
function shiftRow(ctx, cd, unit, shift, date, nowMs, off, recorded) {
  const [startMs, endMs] = shiftWindow(date, shift, off);
  const timing = nowMs >= endMs ? "ended" : nowMs >= startMs ? "running" : "coming";
  const roleOf = (id) => ((ctx.members || []).find((m) => m.identity === id) || {}).role || "";
  const r = rostered(ctx.assignments, date, shift.id, roleOf);
  const base = { date, shiftId: shift.id, shift: shift.name, start: shift.start, end: shift.end, timing, inCharge: r.inCharge, rosteredNurses: r.nurses.length, rostered: r.nurses, otherStaff: r.others };
  if (timing === "ended") {
    const rec = recorded.find((x) => x.shiftId === shift.id && x.date === date && low(x.ward) === low(unit));
    return { ...base, recorded: rec ? recordSummary(rec) : null };
  }
  const w = cd.wards.find((x) => low(x.ward) === low(unit));
  const patients = withBands(w ? w.patients : [], cd.settings, cd.tool, cd.assessments, startMs, timing === "running" ? Math.min(endMs, nowMs + 1) : nowMs + 1, timing === "running" ? "shift" : "latest");
  const req = requiredNurses(patients, unit, shift.id, cd.settings);
  const row = { ...base, projected: timing === "coming", requirement: req, rosteredVerdict: verdict(req, r.nurses.length) };
  if (timing === "running") {
    const live = onDutyNow({ unit: "", duty: ctx.onDuty || [], statuses: ctx.statuses || [], nowMs }).filter((a) => low(a.unit) === low(unit) && a.identity !== r.inCharge && isNurse(roleOf(a.identity)));
    row.onDutyNurses = live.length;
    row.onDuty = live.map((a) => ({ identity: a.identity, via: a.via }));
    row.onDutyVerdict = verdict(req, live.length);
  }
  return row;
}

const recordSummary = (rec) => ({ id: rec.id, version: rec.version, recordedAt: rec.recordedAt, recordedBy: rec.recordedBy, unitType: rec.unitType, occupiedBeds: rec.occupiedBeds, required: rec.required,
  complete: rec.complete, nursesCounted: rec.nursesCounted, counted: rec.counted, rosteredNurses: rec.rosteredNurses, onDutyNurses: rec.onDutyNurses, inCharge: rec.inCharge, verdict: rec.verdict });

async function readPrefix(repo, tenantId, type, prefix) {
  const rows = [];
  let before;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await repo.pageByIdPrefix(tenantId, type, prefix, { limit: PAGE, ...(before ? { before } : {}) });
    rows.push(...(page.records || []));
    if (!page.next) return { rows, partial: false };
    before = page.next;
  }
  return { rows, partial: true };
}

/**
 * GET /ward/nurse-staffing. ctx: { migration, actorDeps, recordDeps, wsqCfg, bedBoard, date?, ward?, shifts, assignments,
 * members, onDuty, statuses, rotaPartial, nowMs? }. Every ward on the rota for the date, each shift with its requirement.
 */
async function nurseStaffingView(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Nurse staffing is kept for a WardSynQ hospital.");
  const off = offOf(ctx.wsqCfg), nowMs = Number(ctx.nowMs) || Date.now();
  const today = localDate(nowMs, off), date = str(ctx.date) || today;
  if (!isDate(date) || date < addDays(today, -31) || date > addDays(today, 13)) return refuse(422, "date_out_of_range", "Choose a date from 31 days ago to 13 days ahead.");
  const cd = await censusAndDependency(request, env, ctx);
  if (cd.error) return cd.error;
  let recorded;
  try { recorded = (await readPrefix(ctx.recordDeps.repository, ctx.migration.tenantId, SHIFT_TYPE, `stf-${date}-`)).rows; }
  catch { return refuse(502, "staffing_records_unreadable", "The recorded shift staffing could not be read."); }
  const shifts = Object.values(ctx.shifts || {}).filter((s) => !str(ctx.ward) || low(s.unit) === low(ctx.ward));
  const units = [...new Set(shifts.map((s) => s.unit))].sort();
  return {
    ok: true, date, today, generatedAt: new Date(nowMs).toISOString(), settings: cd.settings,
    toolFound: !cd.settings.dependencyToolId || !!cd.tool,
    rotaConfigured: Object.keys(ctx.shifts || {}).length > 0, partial: !!ctx.rotaPartial, assessmentsCapped: cd.assessmentsCapped,
    wards: units.map((unit) => ({ ward: unit, shifts: shifts.filter((s) => s.unit === unit).sort((a, b) => a.start.localeCompare(b.start)).map((s) => shiftRow(ctx, cd, unit, s, date, nowMs, off, recorded)) })),
  };
}

/** POST /ward/nurse-staffing-record: the running shift's staffing, worked out on the server and kept (NABH #21). */
async function recordShiftStaffing(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Nurse staffing is kept for a WardSynQ hospital.");
  const off = offOf(ctx.wsqCfg), nowMs = Number(ctx.nowMs) || Date.now();
  const shift = (ctx.shifts || {})[str(ctx.shiftId)], date = str(ctx.date);
  if (!shift || !isDate(date)) return refuse(422, "shift_required", "Choose a shift on the rota and its date.");
  const [startMs, endMs] = shiftWindow(date, shift, off);
  if (!(nowMs >= startMs && nowMs < endMs)) return refuse(409, "shift_not_running", "Only the shift running now can be recorded: the census is the ward as it is now.");
  const cd = await censusAndDependency(request, env, ctx);
  if (cd.error) return cd.error;
  const row = shiftRow(ctx, cd, shift.unit, shift, date, nowMs, off, []);
  if (!row.requirement.configured) return refuse(422, "not_configured", "This ward has no staffing norm, so there is nothing to record against.", { reason: row.requirement.reason });
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId;
  const id = `stf-${date}-${str(shift.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60)}`;
  let current = null;
  try { current = await repo.latest(tenantId, SHIFT_TYPE, id); } catch { return refuse(502, "staffing_records_unreadable", "The recorded shift staffing could not be read, so nothing was saved."); }
  const at = new Date(nowMs).toISOString();
  const req = row.requirement;
  const rec = {
    resourceType: SHIFT_TYPE, id, version: current ? current.version + 1 : 1, date, shiftId: shift.id, shift: shift.name, ward: shift.unit, unitType: req.unitType,
    occupiedBeds: req.census, required: req.required, complete: req.complete, lines: req.lines, missingDependency: req.missing.length, noNorm: req.noNorm,
    rosteredNurses: row.rosteredNurses, onDutyNurses: row.onDutyNurses, inCharge: row.inCharge,
    // The count NABH asks for is the nursing staff actually there: on duty now, the in-charge left out.
    nursesCounted: row.onDutyNurses, counted: "on-duty", verdict: row.onDutyVerdict,
    recordedAt: at, recordedBy: str(ctx.actorId), writtenBy: { id: str(ctx.actorId), kind: "human", at },
  };
  try { await repo.append(tenantId, [rec], { audit: auditEvent("staffing.shift_recorded", ctx.actorId, { id, version: rec.version, beds: rec.occupiedBeds, nurses: rec.nursesCounted, required: rec.required }) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "version_conflict", "Someone recorded this shift at the same moment. Reload; nothing was saved.") : refuse(502, "staffing_not_saved", "The shift staffing was not saved. Nothing was recorded; try again."); }
  return { ok: true, written: 1, record: recordSummary(rec) };
}

/**
 * GET /ward/staffing-draft. The coming shifts of one ward from `from` for up to 7 days, filled from available nurses.
 * ctx adds leaves. Nothing is written.
 */
async function staffingDraft(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Nurse staffing is kept for a WardSynQ hospital.");
  const off = offOf(ctx.wsqCfg), nowMs = Number(ctx.nowMs) || Date.now(), today = localDate(nowMs, off);
  const ward = str(ctx.ward), from = str(ctx.from) || today, days = Math.max(1, Math.min(DRAFT_DAYS, Math.floor(Number(ctx.days) || DRAFT_DAYS)));
  if (!ward) return refuse(422, "ward_required", "Choose the ward to draft for.");
  if (!isDate(from) || from < today || from > addDays(today, 13)) return refuse(422, "date_out_of_range", "Start the draft from today up to 13 days ahead.");
  const shifts = Object.values(ctx.shifts || {}).filter((s) => low(s.unit) === low(ward));
  if (!shifts.length) return refuse(404, "no_shifts_for_ward", "This ward has no shifts on the rota.");
  const cd = await censusAndDependency(request, env, ctx);
  if (cd.error) return cd.error;
  const targets = [], notDrafted = [];
  for (let k = 0; k < days; k++) {
    const date = addDays(from, k);
    for (const s of shifts) {
      const row = shiftRow(ctx, cd, s.unit, s, date, nowMs, off, []);
      if (row.timing !== "coming") continue;
      if (!row.requirement.configured) { notDrafted.push({ date, shiftId: s.id, reason: row.requirement.reason }); continue; }
      targets.push({ date, shiftId: s.id, required: row.requirement.required, complete: row.requirement.complete, have: row.rosteredNurses });
    }
  }
  const d = draftRoster({ shifts: ctx.shifts, targets, members: ctx.members, assignments: ctx.assignments, leaves: ctx.leaves });
  return { ok: true, draft: true, ward, from, days, basis: `Census and latest dependency levels at ${new Date(nowMs).toISOString()}; the ward may change before these shifts start.`, targets, notDrafted, partial: !!ctx.rotaPartial, ...d };
}

/* ------------------------------------------------------------------ staff injuries (NABH #30) */

/** PURE. The report as entered. */
function normaliseInjury(input, nowMs) {
  const i = input || {};
  const occurredAt = str(i.occurredAt), t = ms(occurredAt);
  if (t == null || t > nowMs + 5 * 60000) return { error: "bad_time", detail: "when the injury happened, not in the future" };
  if (!INJURY_KINDS.includes(str(i.kind))) return { error: "unknown_kind", detail: `kind is one of ${INJURY_KINDS.join(", ")}` };
  const staff = str(i.injuredStaff);
  if (!staff || staff.length > 120) return { error: "injured_staff_required", detail: "the staff ID of the person injured" };
  if (!str(i.description) || str(i.description).length > 2000) return { error: "description_required", detail: "what happened, at most 2000 characters" };
  if (!["yes", "no", "unknown"].includes(str(i.sourceKnown))) return { error: "source_known_required", detail: "say whether the source patient is known: yes, no or unknown" };
  return { injury: { occurredAt: new Date(t).toISOString(), kind: str(i.kind), injuredStaff: staff, unit: str(i.unit).slice(0, 80) || null, device: str(i.device).slice(0, 120) || null,
    description: str(i.description), sourceKnown: str(i.sourceKnown), firstAid: str(i.firstAid).slice(0, 1000) || null } };
}

/** POST /ward/staff-injury. ctx: { migration, recordDeps, wsqCfg, actorId, ...fields } */
async function reportStaffInjury(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Staff injury reports are kept for a WardSynQ hospital.");
  const nowMs = Number(ctx.nowMs) || Date.now(), off = offOf(ctx.wsqCfg);
  const n = normaliseInjury(ctx, nowMs);
  if (n.error) return refuse(422, n.error, n.detail);
  const at = new Date(nowMs).toISOString();
  const id = `inj-${localDate(ms(n.injury.occurredAt), off).slice(0, 7)}-${crypto.randomUUID().replace(/-/g, "")}`;
  const rec = { resourceType: INJURY_TYPE, id, version: 1, ...n.injury, reportedBy: str(ctx.actorId), reportedAt: at, writtenBy: { id: str(ctx.actorId), kind: "human", at } };
  try { await ctx.recordDeps.repository.append(ctx.migration.tenantId, [rec], { audit: auditEvent("staffing.injury_reported", ctx.actorId, { id, kind: rec.kind }), ...(ctx.idempotencyKey ? { idempotencyKey: "inj:" + str(ctx.idempotencyKey) } : {}) }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "already_reported", "This report was already saved.") : refuse(502, "injury_not_saved", "The injury report was not saved. Nothing was recorded; try again."); }
  return { ok: true, written: 1, id };
}

/** GET /ward/staff-injuries?month=YYYY-MM */
async function staffInjuries(request, env, ctx) {
  if (noStore(ctx.migration)) return refuse(404, "not_a_wardsynq_hospital", "Staff injury reports are kept for a WardSynQ hospital.");
  const off = offOf(ctx.wsqCfg), month = str(ctx.month) || localDate(Number(ctx.nowMs) || Date.now(), off).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return refuse(422, "month_invalid", "Choose a month.");
  let got;
  try { got = await readPrefix(ctx.recordDeps.repository, ctx.migration.tenantId, INJURY_TYPE, `inj-${month}-`); }
  catch { return refuse(502, "injuries_unreadable", "Staff injury reports could not be read. Do not read this as none."); }
  const reports = got.rows.filter(Boolean).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return { ok: true, month, partial: got.partial, reports, needlestickOrSharp: reports.filter((r) => r.kind === "needlestick" || r.kind === "sharp").length };
}

/** The staff types NABH #21 and #30 need, for the months asked. -> { rows: {StaffingShift, StaffInjury}, unreadable } */
async function readStaffingRows(repo, tenantId, months) {
  const rows = { StaffingShift: [], StaffInjury: [] }, unreadable = {};
  for (const [key, type, pre] of [["StaffingShift", SHIFT_TYPE, "stf-"], ["StaffInjury", INJURY_TYPE, "inj-"]]) {
    try { for (const m of months || []) { const g = await readPrefix(repo, tenantId, type, `${pre}${m}-`); rows[key].push(...g.rows.filter(Boolean)); } }
    catch { unreadable[key] = "read failed"; rows[key] = []; }
  }
  return { rows, unreadable };
}

export {
  SHIFT_TYPE, INJURY_TYPE, INJURY_KINDS, readStaffingNorms, validateStaffingNorms, shiftWindow, dependencyFor, requiredNurses, verdict, rostered, draftRoster,
  normaliseInjury, nurseStaffingView, recordShiftStaffing, staffingDraft, reportStaffInjury, staffInjuries, readStaffingRows, DAY,
};
