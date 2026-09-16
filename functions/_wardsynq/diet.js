/* functions/_wardsynq/diet.js - diet orders from the chart, and the kitchen's meal rounds.
 *
 * A DIET ORDER IS A CLINICAL ORDER. One record per stay (`wsq-diet-<encounterId>`); every change is a new
 * version with the reason for it, so "what was this patient meant to be eating on Tuesday" is answered from
 * the record and not from a whiteboard. It is written by a doctor (emr.treat) or a dietitian (diet.order).
 *
 * NIL BY MOUTH IS A TIME WINDOW, NOT A WORD. "NBM from midnight for theatre" is ordered at six in the evening
 * and dinner is still served; breakfast is not. So an order carries its diet AND, when needed, an NBM window
 * {from, until, reason}; a diet of NBM alone is "nil by mouth from this time until further orders". What the
 * kitchen may serve is decided per instant by dietAt(), in one place.
 *
 * THE KITCHEN IS TOLD, NOT TRUSTED TO NOTICE. The meal board shows each patient's diet as it stands at that
 * meal's hospital-set time, the allergies from the record, NBM loudly, and whether the order changed since
 * the last tray was prepared for them. A tray prepared against one version of the order cannot be marked
 * delivered once the order has changed: it has to be prepared again.
 *
 * NOTHING IS GUESSED. No allergies recorded and allergies that could not be read are different words on the
 * board. A patient with no diet order is flagged "no diet order", never served "normal".
 */

import { listWard, ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { str, baseOf, offOf, isoOk, openSvc, writeFailure, readFailure } from "./support-common.js";

const DIET_TYPE = "DietOrder";
const ROUND_TYPE = "MealRound";
const DIET_TYPES = Object.freeze(["normal", "soft", "liquid", "nbm", "diabetic", "renal", "low-salt", "high-protein", "tube-feed"]);
const CONSISTENCY = Object.freeze(["normal", "soft", "liquid"]);
const TEXTURES = Object.freeze(["regular", "minced", "pureed", "liquidised"]);
const FEED_ROUTES = Object.freeze(["NG", "OG", "NJ", "PEG", "PEJ", "other"]);
const MEALS = Object.freeze(["breakfast", "lunch", "tea", "dinner"]);

const dietIdFor = (encounterId) => `wsq-diet-${str(encounterId)}`;
const roundIdFor = (date, meal, encounterId) => `wsq-meal-${date}-${meal}-${str(encounterId)}`;

/** PURE. A diet order from what the screen sent, or { error, detail }. */
function dietOrderFrom(input) {
  const o = input || {};
  const types = [...new Set((Array.isArray(o.types) ? o.types : []).map(str))];
  if (!types.length) return { error: "diet_type_required", detail: "Choose the diet." };
  const bad = types.find((t) => !DIET_TYPES.includes(t));
  if (bad) return { error: "unknown_diet_type", detail: `"${bad}" is not a diet this hospital orders.` };
  const nbmOnly = types.length === 1 && types[0] === "nbm";
  if (types.includes("nbm") && !nbmOnly) return { error: "nbm_with_diet", detail: "Nil by mouth is not combined with a diet. To keep meals until a procedure, order the diet and add an NBM window." };
  const cons = types.filter((t) => CONSISTENCY.includes(t));
  if (types.includes("tube-feed") && cons.length) return { error: "tube_feed_with_oral", detail: "A tube feed is not ordered together with an oral diet." };
  if (!nbmOnly && !types.includes("tube-feed") && cons.length !== 1) return { error: "consistency_required", detail: "Choose exactly one of normal, soft or liquid." };
  const texture = str(o.texture) || null;
  if (texture && !TEXTURES.includes(texture)) return { error: "unknown_texture", detail: "Texture is regular, minced, pureed or liquidised." };

  let tubeFeed = null;
  if (types.includes("tube-feed")) {
    const t = o.tubeFeed || {};
    const regimen = str(t.regimen), route = str(t.route);
    if (!regimen || regimen.length > 300) return { error: "regimen_required", detail: "A tube feed needs its regimen: the feed, the volume and how often." };
    if (!FEED_ROUTES.includes(route)) return { error: "feed_route_required", detail: "Say which tube: NG, OG, NJ, PEG, PEJ or other." };
    tubeFeed = { regimen, route };
  }

  let nbm = null;
  if (nbmOnly || (o.nbm && (str(o.nbm.from) || str(o.nbm.until)))) {
    const n = o.nbm || {};
    if (!isoOk(n.from)) return { error: "nbm_from_required", detail: "Nil by mouth needs the time it starts." };
    if (!str(n.reason)) return { error: "nbm_reason_required", detail: "Say why the patient is nil by mouth, for example the procedure." };
    if (str(n.until) && !isoOk(n.until)) return { error: "nbm_until_unreadable", detail: "The end of nil by mouth is not a time." };
    if (str(n.until) && Date.parse(n.until) <= Date.parse(n.from)) return { error: "nbm_until_before_from", detail: "Nil by mouth ends before it starts." };
    if (!nbmOnly && !str(n.until)) return { error: "nbm_until_required", detail: "An NBM window on a diet needs the time the diet resumes. For nil by mouth until further orders, order NBM itself." };
    nbm = { from: new Date(n.from).toISOString(), until: str(n.until) ? new Date(n.until).toISOString() : null, reason: str(n.reason).slice(0, 200) };
  }
  const note = str(o.note);
  if (note.length > 500) return { error: "note_too_long", detail: "Keep the note under 500 characters." };
  return { order: { types, texture, tubeFeed, nbm, note: note || null } };
}

/** PURE. What the kitchen may serve at an instant: { state: "diet"|"nbm"|"no-diet"|"stopped", ... }. */
function dietAt(order, atMs) {
  if (!order) return { state: "no-diet" };
  if (order.status === "stopped") return { state: "stopped" };
  const n = order.nbm;
  if (n) {
    const from = Date.parse(n.from), until = n.until ? Date.parse(n.until) : Infinity;
    if (atMs >= from && atMs < until) return { state: "nbm", from: n.from, until: n.until, reason: n.reason };
  }
  if ((order.types || []).length === 1 && order.types[0] === "nbm") return { state: "no-diet", nbmOrder: true };
  return { state: "diet", types: order.types, texture: order.texture || null, tubeFeed: order.tubeFeed || null };
}

/** PURE. The meal's instant on a date, at the hospital's clock; null when the hospital set no time for it. */
function mealInstant(date, meal, mealTimes, utcOffsetMinutes) {
  const hhmm = str(mealTimes && mealTimes[meal]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const off = Number.isFinite(Number(utcOffsetMinutes)) ? Number(utcOffsetMinutes) : 330;
  return Date.parse(`${date}T${hhmm}:00Z`) - off * 60000;
}

const mealKey = (r) => `${str(r.date)}#${MEALS.indexOf(str(r.meal))}`;

/**
 * PURE. The meal board rows.
 * ctx: { patients, orders: Map encounterId -> order, allergies: Map patientId -> [..] (absent key = unread),
 *        rounds: MealRound[], date, meal, atMs, nowMs }
 */
function mealBoardRows(ctx) {
  const here = `${ctx.date}#${MEALS.indexOf(ctx.meal)}`;
  return (ctx.patients || []).map((p) => {
    const order = ctx.orders.get(p.encounterId) || null;
    const serve = dietAt(order, ctx.atMs);
    const nowServe = dietAt(order, ctx.nowMs);
    const mine = (ctx.rounds || []).filter((r) => r && str(r.encounterId) === str(p.encounterId));
    const thisRound = mine.find((r) => str(r.date) === ctx.date && str(r.meal) === ctx.meal) || null;
    const earlier = mine.filter((r) => r.prepared && mealKey(r) < here).sort((a, b) => mealKey(b).localeCompare(mealKey(a)))[0] || null;
    const changed = !!order && (!earlier || Number(earlier.dietVersion) !== Number(order.version));
    const n = order && order.nbm;
    const upcoming = !!n && serve.state !== "nbm" && Date.parse(n.from) > ctx.atMs && Date.parse(n.from) - ctx.atMs < 24 * 3600000;
    return {
      encounterId: p.encounterId, patientId: p.patientId, name: p.name || null, mrn: p.mrn || null, ward: p.ward || null, bed: p.bed || null,
      dietVersion: order ? order.version : null, orderedAt: order ? order.orderedAt : null, note: order ? order.note : null,
      serve, nbmNow: nowServe.state === "nbm", ...(upcoming ? { nbmUpcoming: { from: n.from, reason: n.reason } } : {}),
      changedSinceLastRound: changed, firstRound: !!order && !earlier,
      allergies: ctx.allergies.has(p.patientId) ? ctx.allergies.get(p.patientId) : null,
      prepared: thisRound && thisRound.prepared ? { ...thisRound.prepared, dietVersion: thisRound.dietVersion } : null,
      delivered: thisRound && thisRound.delivered ? thisRound.delivered : null,
      preparedAgainstOldOrder: !!(thisRound && thisRound.prepared && order && Number(thisRound.dietVersion) !== Number(order.version)),
    };
  }).sort((a, b) => str(a.ward).localeCompare(str(b.ward)) || str(a.bed).localeCompare(str(b.bed), undefined, { numeric: true }));
}

async function openAdmission(svc, encounterId, patientId) {
  const enc = await svc.get("Encounter", encounterId);
  if (!enc) return { error: { ok: false, status: 404, error: "encounter_not_found" } };
  if (patientId && str(enc.patientId) !== str(patientId)) return { error: { ok: false, status: 409, error: "patient_mismatch", detail: "This stay belongs to another patient." } };
  if (!ADMISSION_CLASSES.includes(enc.class) || enc.status !== OPEN) return { error: { ok: false, status: 409, error: "not_admitted", detail: "A diet is ordered for a patient admitted now." } };
  return { enc };
}

/** Orders a diet, or changes the one standing. ctx: { encounterId, patientId, order, reason, expectedVersion } */
async function saveDietOrder(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  const parsed = dietOrderFrom(ctx.order);
  if (parsed.error) return { ...base, ok: false, status: 422, error: parsed.error, detail: parsed.detail, written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current, adm;
  try { adm = await openAdmission(svc, encounterId, ctx.patientId); current = await svc.get(DIET_TYPE, dietIdFor(encounterId)); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (adm.error) return { ...base, ...adm.error, written: 0 };
  const reason = str(ctx.reason);
  if (current && !reason) return { ...base, ok: false, status: 422, error: "change_reason_required", detail: "Say why the diet is changing.", written: 0 };
  const at = new Date().toISOString();
  const record = { resourceType: DIET_TYPE, id: dietIdFor(encounterId), patientId: adm.enc.patientId, encounterId, status: "active",
    ...parsed.order, orderedBy: resolved.actor.id, orderedAt: at, changeReason: current ? reason.slice(0, 300) : null };
  try {
    const out = await svc.put(record, { expectedVersion: current ? (ctx.expectedVersion != null ? ctx.expectedVersion : current.version) : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, dietOrderId: record.id, version: out.record.version, order: { ...record, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Stops the diet order (the patient no longer needs one from the kitchen). A new version, never a delete. */
async function stopDietOrder(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId), reason = str(ctx.reason);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say why the diet order is stopped.", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(DIET_TYPE, dietIdFor(encounterId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "no_diet_order", written: 0 };
  if (current.status === "stopped") return { ...base, ok: true, written: 0, skipped: "already_stopped", version: current.version };
  const next = { ...current, status: "stopped", changeReason: reason.slice(0, 300), orderedBy: resolved.actor.id, orderedAt: new Date().toISOString() };
  delete next.version; delete next.meta;
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** The diet order for a stay and every version of it, newest first. */
async function dietOrderHistory(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", versions: [] };
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", versions: [] };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, versions: [] };
  let versions, allergies;
  try {
    versions = (await svc.history(DIET_TYPE, dietIdFor(encounterId))) || [];
    const enc = await svc.get("Encounter", encounterId);
    allergies = enc ? await allergiesOf(svc, enc.patientId) : null;
  } catch (e) { return { ...base, ...readFailure(e), versions: [] }; }
  const current = versions.length ? versions[versions.length - 1] : null;
  return { ...base, ok: true, current, now: current ? dietAt(current, Date.now()) : { state: "no-diet" }, versions: [...versions].reverse(), allergies };
}

async function allergiesOf(svc, patientId) {
  const rows = await svc.byPatient("AllergyIntolerance", patientId);
  return (rows || []).filter((a) => a && a.status !== "entered-in-error" && a.verificationStatus !== "refuted")
    .map((a) => ({ substance: str(a.substance) === "unspecified" ? str(a.reportedText) || "unspecified" : str(a.substance), reaction: a.reaction || null, severity: a.severity || null }));
}

/** The kitchen's list for one meal on one day, by ward and bed. ctx: { date, meal, ward, mealTimes, utcOffsetMinutes } */
async function mealBoard(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", rows: [] };
  const date = str(ctx.date), meal = str(ctx.meal);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return { ...base, ok: false, status: 422, error: "date_required", rows: [] };
  if (!MEALS.includes(meal)) return { ...base, ok: false, status: 422, error: "meal_required", detail: "breakfast, lunch, tea or dinner", rows: [] };
  const roster = await listWard(request, env, { ...ctx, ward: ctx.ward || "" });
  if (!roster || !roster.ok) return { ...base, ...(roster || {}), ok: false, status: (roster && roster.status) || 502, rows: [] };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, rows: [] };
  let orders, rounds;
  try {
    orders = new Map(((await svc.list(DIET_TYPE, 1000)) || []).map((o) => [str(o.encounterId), o]));
    rounds = (await svc.list(ROUND_TYPE, 5000)) || [];
  } catch (e) { return { ...base, ...readFailure(e), rows: [] }; }
  /* Allergies per patient; one that cannot be read is left out of the map and reads as "could not be read". */
  const allergies = new Map();
  await Promise.all((roster.patients || []).map(async (p) => { try { allergies.set(p.patientId, await allergiesOf(svc, p.patientId)); } catch { /* unread */ } }));
  const nowMs = Date.now();
  const instant = mealInstant(date, meal, ctx.mealTimes, ctx.utcOffsetMinutes);
  const rows = mealBoardRows({ patients: roster.patients || [], orders, allergies, rounds, date, meal, atMs: instant == null ? nowMs : instant, nowMs });
  return { ...base, ok: true, date, meal, mealTime: str(ctx.mealTimes && ctx.mealTimes[meal]) || null, mealTimes: ctx.mealTimes || null,
    ...(instant == null ? { mealTimeWarning: "This hospital has not set a time for this meal, so diets and nil by mouth are shown as they stand now." } : {}),
    rows, ...(roster.partial ? { partial: true, partialWarning: roster.partialWarning } : {}) };
}

/** Marks one patient's tray prepared or delivered. ctx: { date, meal, encounterId, mark, mealTimes, utcOffsetMinutes } */
async function markMeal(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const date = str(ctx.date), meal = str(ctx.meal), encounterId = str(ctx.encounterId), mark = str(ctx.mark);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !MEALS.includes(meal) || !encounterId) return { ...base, ok: false, status: 422, error: "meal_required", written: 0 };
  if (mark !== "prepared" && mark !== "delivered") return { ...base, ok: false, status: 422, error: "bad_mark", detail: "prepared or delivered", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let adm, order, round;
  try {
    adm = await openAdmission(svc, encounterId, null);
    order = await svc.get(DIET_TYPE, dietIdFor(encounterId));
    round = await svc.get(ROUND_TYPE, roundIdFor(date, meal, encounterId));
  } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (adm.error) return { ...base, ...adm.error, written: 0 };
  const nowMs = Date.now(), instant = mealInstant(date, meal, ctx.mealTimes, ctx.utcOffsetMinutes);
  for (const t of [nowMs, instant == null ? nowMs : instant]) {
    const s = dietAt(order, t);
    if (s.state === "nbm") return { ...base, ok: false, status: 409, error: "nbm", detail: `Nil by mouth (${s.reason}). No tray for this patient.`, written: 0 };
    if (s.state !== "diet") return { ...base, ok: false, status: 409, error: "no_diet_order", detail: "There is no diet order to serve. Ask the ward.", written: 0 };
  }
  if (mark === "delivered") {
    if (!round || !round.prepared) return { ...base, ok: false, status: 409, error: "not_prepared", detail: "Mark the tray prepared before it is delivered.", written: 0 };
    if (Number(round.dietVersion) !== Number(order.version)) return { ...base, ok: false, status: 409, error: "diet_changed_since_prepared", detail: "The diet order changed after this tray was prepared. Prepare it again against the current order.", written: 0 };
    if (round.delivered) return { ...base, ok: true, written: 0, skipped: "already_delivered" };
  }
  const by = { at: new Date(nowMs).toISOString(), by: resolved.actor.id };
  const record = mark === "prepared"
    ? { resourceType: ROUND_TYPE, id: roundIdFor(date, meal, encounterId), date, meal, encounterId, patientId: adm.enc.patientId,
      ward: (adm.enc.location && adm.enc.location.ward) || null, bed: (adm.enc.location && adm.enc.location.bed) || null,
      dietVersion: order.version, diet: { types: order.types, texture: order.texture || null }, prepared: by, delivered: null }
    : { ...round, delivered: by };
  delete record.version; delete record.meta;
  try {
    const out = await svc.put(record, { expectedVersion: round ? round.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, mark, version: out.record.version, dietVersion: record.dietVersion };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

export {
  DIET_TYPE, ROUND_TYPE, DIET_TYPES, MEALS, dietIdFor, roundIdFor, dietOrderFrom, dietAt, mealInstant, mealBoardRows,
  saveDietOrder, stopDietOrder, dietOrderHistory, mealBoard, markMeal,
};
