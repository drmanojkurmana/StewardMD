/* functions/_wardsynq/dialysis.js - the haemodialysis unit: stations, the session record, the dialyzer reuse log and URR.
 *
 * THE HOSPITAL'S RULES HAVE NO DEFAULT. Which serology groups dialyse on separate stations, and how many times one
 * dialyzer may be reused, are the unit's own policy (owner item O13). Absent means "not configured" and every screen
 * says so: no segregation check is made, and reuse is not recorded as allowed at all. Nothing here picks a number.
 *
 * STATIONS ARE BOOKED THROUGH resource-booking.js, so a station holds one patient at a time by the same refusal a
 * scanner does. They live in the dialysis settings rather than `resources` because that list has no screen, and a
 * station the unit cannot add is a station on paper. Their resource ids carry a "dialysis-" prefix so they cannot
 * collide with a room, and the generic booking route does not know them, so the serology check cannot be stepped round.
 *
 * URR IS THE PLAIN PUBLISHED RATIO, shown with its inputs: (pre-dialysis urea - post-dialysis urea) / pre-dialysis
 * urea x 100 (Lowrie EG, Lew NL. Death risk in hemodialysis patients. Am J Kidney Dis 1990;15:458-82; NKF KDOQI
 * Clinical Practice Guideline for Hemodialysis Adequacy, 2015 update, Am J Kidney Dis 2015;66:884-930). Missing an
 * input, or two inputs in different units, is "not computable", never 0. Kt/V is not built: it needs a formula choice
 * and nephrology sign-off (owner item O12).
 *
 * NOTHING IS DECIDED CLINICALLY. A post weight above the pre weight while fluid was removed is refused only until the
 * nurse says why (a scale, a meal, a transfusion); anticoagulation goes through the existing orders and eMAR, not a
 * field here; complications are the nurse's words.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { bookResource } from "./resource-booking.js";

const str = (v) => (v == null ? "" : String(v).trim());
const READ_CAP = 1000;
const ACCESS_TYPES = Object.freeze(["av-fistula", "av-graft", "tunnelled-catheter", "non-tunnelled-catheter"]);
const DIALYZER_KINDS = Object.freeze(["first-use", "reuse", "discard"]);
const STATION_PREFIX = "dialysis-";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------------------------------------ settings */

/** PURE. The dialysis settings as saved, or every error. Stations need an id and a name; when serology groups are set,
 *  every station names one of them, and when they are not, no station may. maxReuses is a whole number 1 to 100. */
function validateDialysisSettings(input) {
  const i = input && typeof input === "object" ? input : {};
  const errors = {};
  const groups = [...new Set((Array.isArray(i.serologyGroups) ? i.serologyGroups : []).map(str).filter(Boolean))];
  const stations = [], seen = new Set();
  (Array.isArray(i.stations) ? i.stations : []).forEach((raw, n) => {
    const s = raw && typeof raw === "object" ? raw : {};
    const id = str(s.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const name = str(s.name).slice(0, 80), group = str(s.serologyGroup) || null;
    if (!id || !name) { errors[`stations.${n}`] = `Station ${n + 1} needs an id and a name.`; return; }
    if (seen.has(id)) { errors[`stations.${n}`] = `Station id ${id} is used twice.`; return; }
    seen.add(id);
    if (groups.length && !groups.includes(group)) { errors[`stations.${n}`] = `Station ${id} must name one of the serology groups.`; return; }
    if (!groups.length && group) { errors[`stations.${n}`] = `Station ${id} names a serology group, but no serology groups are set.`; return; }
    stations.push({ id, name, serologyGroup: group });
  });
  let maxReuses = null;
  if (i.maxReuses != null && str(i.maxReuses) !== "") {
    const m = Number(i.maxReuses);
    if (!(Number.isInteger(m) && m >= 1 && m <= 100)) errors.maxReuses = "The maximum number of reuses is a whole number from 1 to 100.";
    else maxReuses = m;
  }
  const value = { stations, ...(groups.length ? { serologyGroups: groups } : {}), ...(maxReuses != null ? { maxReuses } : {}) };
  return { value, errors };
}

/** PURE. What the unit runs on, validated on every read. A saved value that fails is reported and treated as unset. */
function readDialysisSettings(cfg) {
  const saved = cfg && cfg.dialysis;
  if (!saved) return { stations: [], serologyGroups: [], segregation: false, maxReuses: null, configured: false };
  const { value, errors } = validateDialysisSettings(saved);
  const problems = Object.values(errors);
  return {
    stations: value.stations, serologyGroups: value.serologyGroups || [], segregation: !!(value.serologyGroups && value.serologyGroups.length),
    maxReuses: value.maxReuses == null ? null : value.maxReuses, configured: true, ...(problems.length ? { problems } : {}),
  };
}

/* ------------------------------------------------------------------------------------------------ pure rules */

/** PURE. URR in percent to one decimal, or why it cannot be computed. Inputs are { value, unit }. */
function urr(pre, post) {
  const num = (x) => (x && x.value != null && str(x.value) !== "" && Number.isFinite(Number(x.value)) ? Number(x.value) : null);
  const a = num(pre), b = num(post);
  const inputs = { pre: pre || null, post: post || null };
  if (a === null) return { computable: false, reason: "pre_urea_missing", inputs };
  if (b === null) return { computable: false, reason: "post_urea_missing", inputs };
  if (str(pre.unit) !== str(post.unit)) return { computable: false, reason: "units_differ", inputs };
  if (a <= 0) return { computable: false, reason: "pre_urea_not_positive", inputs };
  return { computable: true, value: Math.round(((a - b) / a) * 1000) / 10, inputs };
}

/** PURE. One dialyzer's story from its events: whose, how many uses, discarded or not. */
function dialyzerState(dialyzerId, events) {
  const mine = (events || []).filter((e) => e && str(e.dialyzerId) === str(dialyzerId)).sort((x, y) => str(x.at).localeCompare(str(y.at)));
  if (!mine.length) return null;
  const discard = mine.find((e) => e.kind === "discard") || null;
  const reuses = mine.filter((e) => e.kind === "reuse").length;
  return { dialyzerId: str(dialyzerId), patientId: mine[0].patientId, firstUseAt: mine[0].at, uses: 1 + reuses, reuses,
    discarded: !!discard, discardedAt: discard ? discard.at : null, discardReason: discard ? discard.reason : null,
    events: mine.map((e) => ({ kind: e.kind, at: e.at, by: e.by, reason: e.reason || null })) };
}

/** PURE. The post-dialysis values a session still lacks. */
function missingPost(s) {
  const out = [];
  if (s.postWeightKg == null) out.push("postWeightKg");
  if (!s.postBp) out.push("postBp");
  if (s.achievedUfMl == null) out.push("achievedUfMl");
  if (!s.endAt) out.push("endAt");
  return out;
}

/* ------------------------------------------------------------------------------------------------ plumbing */

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

/** The patient by id or hospital number: exactly one, or the refusal. */
async function patientOf(svc, patientId, mrn) {
  if (!str(patientId) && !str(mrn)) return { error: { ok: false, status: 422, error: "patient_required", detail: "Name the patient." } };
  try {
    if (!str(patientId)) {
      const hits = await svc.findPatientsByIdentifier({ mrn: str(mrn) });
      if (hits.length !== 1) return { error: { ok: false, status: hits.length ? 409 : 404, error: hits.length ? "patient_ambiguous" : "patient_not_found", detail: hits.length ? "More than one patient has this hospital number." : "No patient has this hospital number." } };
      return { patient: hits[0] };
    }
    const p = await svc.get("Patient", str(patientId));
    return p ? { patient: p } : { error: { ok: false, status: 404, error: "patient_not_found", detail: "No such patient in this hospital." } };
  } catch (e) { return { error: readFailure(e) }; }
}

function sessionView(s) {
  return {
    sessionId: s.id, version: s.version, patientId: s.patientId, encounterId: s.encounterId, stationId: s.stationId, stationName: s.stationName || null,
    accessType: s.accessType, preWeightKg: s.preWeightKg, postWeightKg: s.postWeightKg, preBp: s.preBp, postBp: s.postBp,
    targetUfMl: s.targetUfMl, achievedUfMl: s.achievedUfMl, weightReason: s.weightReason || null, startAt: s.startAt, endAt: s.endAt,
    dialyzerId: s.dialyzerId || null, reuseNumber: s.reuseNumber == null ? null : s.reuseNumber, complications: s.complications || null,
    nurse: s.nurse || null, doctor: s.doctor || null, preUrea: s.preUrea || null, postUrea: s.postUrea || null,
    urr: urr(s.preUrea, s.postUrea), missingPost: missingPost(s), by: s.by, at: s.at,
  };
}

/* ------------------------------------------------------------------------------------------------ routes */

/** GET /ward/dialysis-unit - the day's schedule by station, the day's sessions, every session still missing post values. */
async function dialysisUnit(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off" };
  const settings = readDialysisSettings(ctx.wsqCfg);
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const offsetMin = ctx.clock && Number.isFinite(ctx.clock.offsetMinutes) ? ctx.clock.offsetMinutes : 330;
  const day = ISO_DAY.test(str(ctx.date)) ? str(ctx.date) : new Date(Date.now() + offsetMin * 60000).toISOString().slice(0, 10);
  const from = Date.parse(day + "T00:00:00Z") - offsetMin * 60000, to = from + 86400000;
  const inDay = (iso) => { const t = Date.parse(str(iso)); return Number.isFinite(t) && t >= from && t < to; };
  let bookings, sessions, events;
  try { [bookings, sessions, events] = await Promise.all([svc.list("ResourceBooking", READ_CAP), svc.list("DialysisSession", READ_CAP), svc.list("DialyzerEvent", READ_CAP)]); }
  catch (e) { return { ...base, ...readFailure(e) }; }
  const all = latest(sessions).map(sessionView);
  const ids = new Set([...latest(bookings).filter((b) => str(b.resourceId).startsWith(STATION_PREFIX)).map((b) => b.patientId), ...all.map((s) => s.patientId)].filter(Boolean));
  const names = new Map();
  try { for (const id of ids) { const p = await svc.get("Patient", id); if (p) names.set(id, { name: p.name || null, mrn: p.mrn || null }); } }
  catch (e) { return { ...base, ...readFailure(e) }; }
  const who = (id) => names.get(id) || { name: null, mrn: null };
  const stations = settings.stations.map((st) => ({
    ...st, resourceId: STATION_PREFIX + st.id,
    bookings: latest(bookings).filter((b) => b.resourceId === STATION_PREFIX + st.id && b.state === "booked" && inDay(b.startAt))
      .sort((a, b) => str(a.startAt).localeCompare(str(b.startAt)))
      .map((b) => ({ bookingId: b.id, patientId: b.patientId, ...who(b.patientId), startAt: b.startAt, minutes: b.minutes })),
  }));
  const withName = (s) => ({ ...s, ...who(s.patientId) });
  const truncated = [bookings, sessions, events].some((r) => (r || []).length >= READ_CAP);
  return {
    ...base, ok: true, date: day, settings, accessTypes: ACCESS_TYPES, stations,
    sessions: all.filter((s) => inDay(s.startAt)).sort((a, b) => str(a.startAt).localeCompare(str(b.startAt))).map(withName),
    missingPost: all.filter((s) => s.missingPost.length).sort((a, b) => str(a.startAt).localeCompare(str(b.startAt))).map(withName),
    ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} dialysis records of one kind exist and only the latest ${READ_CAP} were read, so this list may be incomplete.` } : {}),
  };
}

/** GET /ward/dialysis-patient - one patient's serology status, open visits, recent laboratory results to link, dialyzers and sessions. */
async function dialysisPatient(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off" };
  const settings = readDialysisSettings(ctx.wsqCfg);
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const { patient, error: pe } = await patientOf(svc, ctx.patientId, ctx.mrn);
  if (pe) return { ...base, ...pe };
  let serology, encounters, observations, sessions, events;
  try {
    [serology, encounters, observations, sessions, events] = await Promise.all([
      svc.byPatient("DialysisSerology", patient.id), svc.byPatient("Encounter", patient.id), svc.byPatient("Observation", patient.id),
      svc.byPatient("DialysisSession", patient.id), svc.list("DialyzerEvent", READ_CAP)]);
  } catch (e) { return { ...base, ...readFailure(e) }; }
  const sero = latest(serology).sort((a, b) => str(b.at).localeCompare(str(a.at)))[0] || null;
  const dialyzerIds = [...new Set((events || []).filter((e) => e && e.patientId === patient.id).map((e) => e.dialyzerId))];
  return {
    ...base, ok: true, settings, accessTypes: ACCESS_TYPES,
    patient: { patientId: patient.id, name: patient.name || null, mrn: patient.mrn || null },
    serology: sero ? { group: sero.group, testedOn: sero.testedOn || null, note: sero.note || null, by: sero.by, at: sero.at } : null,
    encounters: latest(encounters).filter((e) => e.status !== "finished" && e.status !== "cancelled")
      .map((e) => ({ encounterId: e.id, class: e.class, status: e.status, periodStart: e.periodStart || null })),
    labResults: latest(observations).filter((o) => o.category === "laboratory" && str(o.value) !== "" && Number.isFinite(Number(o.value)))
      .sort((a, b) => str((b.meta && b.meta.recordedAt) || "").localeCompare(str((a.meta && a.meta.recordedAt) || ""))).slice(0, 30)
      .map((o) => ({ observationId: o.id, code: o.code, value: Number(o.value), unit: o.unit || null, at: (o.meta && (o.meta.effectiveAt || o.meta.recordedAt)) || null })),
    dialyzers: dialyzerIds.map((id) => dialyzerState(id, events)).filter(Boolean),
    sessions: latest(sessions).map(sessionView).sort((a, b) => str(b.startAt).localeCompare(str(a.startAt))).slice(0, 30),
  };
}

/** POST /ward/dialysis-serology - the patient's serology group as the unit's settings name them, with the test date. */
async function recordSerology(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const settings = readDialysisSettings(ctx.wsqCfg);
  if (!settings.segregation) return { ...base, ok: false, status: 409, error: "serology_not_configured", detail: "This unit has not set serology groups, so there is no group to record.", written: 0 };
  const group = str(ctx.group);
  if (!settings.serologyGroups.includes(group)) return { ...base, ok: false, status: 422, error: "bad_group", detail: "Choose one of this unit's serology groups.", written: 0 };
  if (!ISO_DAY.test(str(ctx.testedOn))) return { ...base, ok: false, status: 422, error: "tested_on_required", detail: "Give the date of the test the group comes from.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const { patient, error: pe } = await patientOf(svc, ctx.patientId, ctx.mrn);
  if (pe) return { ...base, ...pe, written: 0 };
  const record = { resourceType: "DialysisSerology", id: `wsq-dialysis-sero-${crypto.randomUUID()}`, patientId: patient.id, group, testedOn: str(ctx.testedOn), note: str(ctx.note) || null, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, patientId: patient.id, group, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/dialysis-book - a patient on a station. Serology segregation is checked when the unit set it. */
async function bookStation(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const settings = readDialysisSettings(ctx.wsqCfg);
  const station = settings.stations.find((s) => s.id === str(ctx.stationId)) || null;
  if (!station) return { ...base, ok: false, status: 404, error: "station_not_found", detail: settings.stations.length ? "This unit has no such station." : "This unit has set no dialysis stations.", written: 0 };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, written: 0 };
  const { patient, error: pe } = await patientOf(svc, ctx.patientId, ctx.mrn);
  if (pe) return { ...base, ...pe, written: 0 };
  let segregation = "not-configured";
  if (settings.segregation) {
    let rows;
    try { rows = latest(await svc.byPatient("DialysisSerology", patient.id)).sort((a, b) => str(b.at).localeCompare(str(a.at))); }
    catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    const group = rows[0] ? rows[0].group : null;
    if (!group) return { ...base, ok: false, status: 409, error: "serology_not_recorded", detail: `No serology group is recorded for this patient, and ${station.name} is for ${station.serologyGroup}.`, written: 0 };
    if (group !== station.serologyGroup) return { ...base, ok: false, status: 409, error: "serology_mismatch", detail: `The patient's recorded group is ${group}; ${station.name} is for ${station.serologyGroup}.`, patientGroup: group, stationGroup: station.serologyGroup, written: 0 };
    segregation = "checked";
  }
  const r = await bookResource(request, env, { ...ctx, resources: [{ id: STATION_PREFIX + station.id, name: station.name, kind: "equipment" }],
    resourceId: STATION_PREFIX + station.id, startAt: ctx.startAt, minutes: ctx.minutes, patientId: patient.id, encounterId: ctx.encounterId, purpose: "haemodialysis", sessionOwnerId: null });
  return { ...r, segregation };
}

const numOrNull = (v) => (v == null || str(v) === "" ? null : Number(v));
function bpOf(v) {
  if (v == null || v === "") return { ok: true, value: null };
  const s = Number(v && v.systolic), d = Number(v && v.diastolic);
  if (!(Number.isInteger(s) && Number.isInteger(d) && s >= 30 && s <= 300 && d >= 10 && d <= 250 && d < s)) return { ok: false };
  return { ok: true, value: { systolic: s, diastolic: d } };
}

/** POST /ward/dialysis-session - record a session, or add to one (a new version; fields not sent keep their value). */
async function saveSession(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const settings = readDialysisSettings(ctx.wsqCfg);
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const refuse = (status, code, detail, extra) => ({ ...base, ok: false, status, error: code, ...(detail ? { detail } : {}), ...(extra || {}), written: 0 });
  let current = null;
  if (str(ctx.sessionId)) {
    try { current = await svc.get("DialysisSession", str(ctx.sessionId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    if (!current) return refuse(404, "session_not_found");
    if (str(ctx.expectedVersion) === "") return refuse(409, "version_required", "Open the session again before changing it.");
  }
  const pick = (k) => (ctx[k] !== undefined ? ctx[k] : current ? current[k] : null);

  let patientId = current ? current.patientId : null;
  if (!current) {
    const { patient, error: pe } = await patientOf(svc, ctx.patientId, ctx.mrn);
    if (pe) return { ...base, ...pe, written: 0 };
    patientId = patient.id;
  }
  const encounterId = str(pick("encounterId"));
  if (!encounterId) return refuse(422, "encounter_required", "A session belongs to the patient's stay or OPD visit.");
  const station = settings.stations.find((s) => s.id === str(pick("stationId"))) || null;
  if (!station) return refuse(422, "station_required", settings.stations.length ? "Choose one of this unit's stations." : "This unit has set no dialysis stations.");
  const accessType = str(pick("accessType"));
  if (!ACCESS_TYPES.includes(accessType)) return refuse(422, "bad_access_type", "Choose the vascular access.");
  const startAt = str(pick("startAt")), endAt = str(pick("endAt")) || null;
  if (!Number.isFinite(Date.parse(startAt))) return refuse(422, "start_required", "Give the time dialysis started.");
  if (endAt && !(Number.isFinite(Date.parse(endAt)) && Date.parse(endAt) >= Date.parse(startAt))) return refuse(422, "bad_end", "The end time is after the start.");
  const w = {}, u = {};
  for (const k of ["preWeightKg", "postWeightKg"]) { const n = numOrNull(pick(k)); if (n !== null && !(Number.isFinite(n) && n > 0 && n <= 400)) return refuse(422, "bad_weight", "Weight is in kilograms."); w[k] = n; }
  if (w.preWeightKg === null) return refuse(422, "pre_weight_required", "Record the weight before dialysis.");
  for (const k of ["targetUfMl", "achievedUfMl"]) { const n = numOrNull(pick(k)); if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 10000)) return refuse(422, "bad_uf", "Ultrafiltration is in millilitres, 0 to 10000."); u[k] = n; }
  const preBp = bpOf(pick("preBp")), postBp = bpOf(pick("postBp"));
  if (!preBp.ok || !postBp.ok) return refuse(422, "bad_bp", "Blood pressure is systolic over diastolic in mmHg.");
  if (!preBp.value) return refuse(422, "pre_bp_required", "Record the blood pressure before dialysis.");
  const weightReason = str(pick("weightReason")) || null;
  /* A patient cannot weigh more after fluid was taken off unless something else happened. The nurse says what. */
  if (w.postWeightKg !== null && w.postWeightKg > w.preWeightKg && u.achievedUfMl > 0 && !weightReason) {
    return refuse(422, "weight_reason_required", "The post weight is above the pre weight although fluid was removed. Say why (for example a scale change, food or a transfusion).");
  }

  const urea = {};
  for (const k of ["preUrea", "postUrea"]) {
    const v = pick(k);
    if (!v || (str(v.value) === "" && !str(v.observationId))) { urea[k] = null; continue; }
    if (current && current[k] && v === current[k]) { urea[k] = current[k]; continue; }
    if (str(v.observationId)) {
      let o;
      try { o = await svc.get("Observation", str(v.observationId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
      if (!o || o.patientId !== patientId || o.category !== "laboratory" || !Number.isFinite(Number(o.value))) return refuse(422, "bad_urea_result", "Link a numeric laboratory result of this patient.");
      urea[k] = { value: Number(o.value), unit: o.unit || null, observationId: o.id, source: null };
    } else {
      if (!Number.isFinite(Number(v.value)) || Number(v.value) < 0 || !str(v.unit) || !str(v.source)) return refuse(422, "urea_source_required", "An entered urea needs its value, its unit and where it came from.");
      urea[k] = { value: Number(v.value), unit: str(v.unit), observationId: null, source: str(v.source) };
    }
  }

  let dialyzerId = str(pick("dialyzerId")) || null, reuseNumber = null;
  if (dialyzerId) {
    let events;
    try { events = await svc.list("DialyzerEvent", READ_CAP); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    const d = dialyzerState(dialyzerId, events);
    if (!d) return refuse(422, "dialyzer_not_logged", "Log the dialyzer's first use before naming it on a session.");
    if (d.patientId !== patientId) return refuse(409, "dialyzer_other_patient", "This dialyzer is logged for another patient.");
    if (d.discarded && !(current && current.dialyzerId === dialyzerId)) return refuse(409, "dialyzer_discarded", "This dialyzer was discarded.");
    reuseNumber = current && current.dialyzerId === dialyzerId && current.reuseNumber != null ? current.reuseNumber : d.reuses;
  }

  const record = {
    resourceType: "DialysisSession", id: current ? current.id : `wsq-dialysis-session-${crypto.randomUUID()}`, patientId, encounterId,
    stationId: station.id, stationName: station.name, accessType, startAt, endAt,
    preWeightKg: w.preWeightKg, postWeightKg: w.postWeightKg, preBp: preBp.value, postBp: postBp.value,
    targetUfMl: u.targetUfMl, achievedUfMl: u.achievedUfMl, weightReason,
    dialyzerId, reuseNumber, complications: str(pick("complications")) || null, nurse: str(pick("nurse")) || null, doctor: str(pick("doctor")) || null,
    preUrea: urea.preUrea, postUrea: urea.postUrea, by: resolved.actor.id, at: new Date().toISOString(),
  };
  if (!current) {
    try {
      const enc = await svc.get("Encounter", encounterId);
      if (!enc || enc.patientId !== patientId) return refuse(422, "encounter_not_found", "That visit is not this patient's.");
    } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  }
  try {
    const out = await svc.put(record, { expectedVersion: current ? Number(ctx.expectedVersion) : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, session: sessionView({ ...record, version: out.record.version }) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/dialyzer-event - first use, a reuse within the unit's maximum, or discard with a reason. */
async function dialyzerEvent(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const settings = readDialysisSettings(ctx.wsqCfg);
  const kind = str(ctx.kind), dialyzerId = str(ctx.dialyzerId).slice(0, 60);
  if (!DIALYZER_KINDS.includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  if (!dialyzerId) return { ...base, ok: false, status: 422, error: "dialyzer_required", detail: "Give the dialyzer's label.", written: 0 };
  if (kind === "discard" && !str(ctx.reason)) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say why the dialyzer is discarded.", written: 0 };
  /* Unset maximum: reuse is not recorded as allowed. The unit decides the number, not this file. */
  if (kind === "reuse" && settings.maxReuses == null) return { ...base, ok: false, status: 409, error: "reuse_not_configured", detail: "This unit has not set a maximum number of reuses, so a reuse cannot be recorded.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const { patient, error: pe } = await patientOf(svc, ctx.patientId, ctx.mrn);
  if (pe) return { ...base, ...pe, written: 0 };
  let events;
  try { events = await svc.list("DialyzerEvent", READ_CAP); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const d = dialyzerState(dialyzerId, events);
  if (kind === "first-use" && d) return { ...base, ok: false, status: 409, error: "dialyzer_exists", detail: "This dialyzer label is already logged.", written: 0 };
  if (kind !== "first-use") {
    if (!d) return { ...base, ok: false, status: 404, error: "dialyzer_not_logged", written: 0 };
    if (d.patientId !== patient.id) return { ...base, ok: false, status: 409, error: "dialyzer_other_patient", detail: "This dialyzer is logged for another patient.", written: 0 };
    if (d.discarded) return { ...base, ok: false, status: 409, error: "dialyzer_discarded", written: 0 };
    if (kind === "reuse" && d.reuses + 1 > settings.maxReuses) return { ...base, ok: false, status: 409, error: "reuse_limit", detail: `This dialyzer has been reused ${d.reuses} times; this unit allows ${settings.maxReuses}. Discard it.`, reuses: d.reuses, maxReuses: settings.maxReuses, written: 0 };
  }
  const record = { resourceType: "DialyzerEvent", id: `wsq-dialyzer-event-${crypto.randomUUID()}`, dialyzerId, patientId: patient.id, kind, reason: str(ctx.reason) || null, by: resolved.actor.id, at: new Date().toISOString() };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, version: out.record.version, dialyzer: dialyzerState(dialyzerId, [...(events || []), record]) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

export {
  ACCESS_TYPES as DIALYSIS_ACCESS_TYPES, STATION_PREFIX as DIALYSIS_STATION_PREFIX,
  validateDialysisSettings, readDialysisSettings, urr, dialyzerState, missingPost,
  dialysisUnit, dialysisPatient, recordSerology, bookStation, saveSession, dialyzerEvent,
};
