/* functions/_wardsynq/ambulance.js - the ambulance fleet, trip requests, dispatch and the times of a trip.
 *
 * A VEHICLE THAT IS NOT FIT IS NOT DISPATCHED. Each ambulance carries its type (BLS or ALS), registration,
 * and the expiry of its fitness certificate and insurance. The fleet list says which are expired or expire
 * within thirty days; dispatch refuses an expired one rather than warning about it.
 *
 * A TRIP'S TIMES ARE ITS RECORD. call -> dispatch -> arrival -> departure -> handover, each written as a new
 * version when it happens, in that order and never earlier than the one before. An inter-facility transfer or
 * a discharge journey names the patient's stay, checked against the chart, so the trip belongs to that stay.
 *
 * THE CREW IS READ AGAINST THE ROTA. Who went is recorded by staff id, and beside each name whether the rota
 * had them on duty at dispatch (true, false, or null when the rota could not be read). It records the fact; it
 * does not refuse an emergency because a rota was out of date.
 *
 * CHARGES GO THROUGH CHARGE CAPTURE. A completed trip with a patient is a thing that happened, and
 * charge-capture.js lists it by its charge code (AMBULANCE-BLS / AMBULANCE-ALS) against the hospital's price
 * list, like any other. Nothing here prices or bills.
 */

import { ADMISSION_CLASSES } from "./migrate-inpatient.js";
import { str, slug, baseOf, offOf, isoOk, newId, openSvc, writeFailure, readFailure } from "./support-common.js";

const VEHICLE_TYPE = "AmbulanceVehicle";
const TRIP_TYPE = "AmbulanceTrip";
const VEHICLE_CLASSES = Object.freeze(["BLS", "ALS"]);
const TRIP_KINDS = Object.freeze(["emergency-call", "inter-facility", "discharge", "pickup"]);
/* step -> [state before, state after, time field] */
const TRIP_FLOW = Object.freeze({
  dispatch: ["requested", "dispatched", "dispatch"], arrive: ["dispatched", "arrived", "arrival"],
  depart: ["arrived", "departed", "departure"], handover: ["departed", "completed", "handover"],
});
const chargeCodeFor = (vehicleClass) => `AMBULANCE-${vehicleClass}`;

/** PURE. Fitness of a vehicle at an instant: { ok, expired: [...], dueSoon: [...] }. */
function vehicleFitness(v, nowMs) {
  const expired = [], dueSoon = [];
  for (const k of ["fitnessExpiry", "insuranceExpiry"]) {
    const t = Date.parse(str(v && v[k]));
    if (!Number.isFinite(t) || t <= nowMs) expired.push(k);
    else if (t - nowMs < 30 * 86400000) dueSoon.push(k);
  }
  return { ok: expired.length === 0 && !!(v && v.active !== false), expired, dueSoon };
}

/** Adds or updates a vehicle. ctx: { vehicle: { registration, vehicleClass, callSign, fitnessExpiry, insuranceExpiry, active } } */
async function saveVehicle(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const v = ctx.vehicle || {};
  const registration = str(v.registration).toUpperCase(), vehicleClass = str(v.vehicleClass).toUpperCase();
  if (!registration) return { ...base, ok: false, status: 422, error: "registration_required", written: 0 };
  if (!VEHICLE_CLASSES.includes(vehicleClass)) return { ...base, ok: false, status: 422, error: "vehicle_class_required", detail: "BLS or ALS.", written: 0 };
  if (!isoOk(v.fitnessExpiry) || !isoOk(v.insuranceExpiry)) return { ...base, ok: false, status: 422, error: "expiry_dates_required", detail: "Enter the fitness certificate and insurance expiry dates.", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = `wsq-amb-${slug(registration)}`;
  try {
    const cur = await svc.get(VEHICLE_TYPE, id);
    const out = await svc.put({ resourceType: VEHICLE_TYPE, id, registration, vehicleClass, callSign: str(v.callSign).slice(0, 40) || null,
      fitnessExpiry: str(v.fitnessExpiry).slice(0, 10), insuranceExpiry: str(v.insuranceExpiry).slice(0, 10), active: v.active !== false,
      updatedBy: resolved.actor.id, updatedAt: new Date().toISOString() }, { expectedVersion: cur ? cur.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, vehicleId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Requests a trip. ctx: { trip: { kind, pickup, drop, patientId, encounterId, priority, note } } */
async function requestTrip(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const t = ctx.trip || {};
  const kind = str(t.kind), pickup = str(t.pickup), drop = str(t.drop);
  if (!TRIP_KINDS.includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  if (!pickup || !drop) return { ...base, ok: false, status: 422, error: "pickup_and_drop_required", detail: "Say where from and where to.", written: 0 };
  const needsStay = kind === "inter-facility" || kind === "discharge";
  if (needsStay && !str(t.encounterId)) return { ...base, ok: false, status: 422, error: "stay_required", detail: "A transfer or discharge journey is linked to the patient's stay.", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let patientId = str(t.patientId) || null, encounterId = str(t.encounterId) || null;
  try {
    if (encounterId) {
      const enc = await svc.get("Encounter", encounterId);
      if (!enc || !ADMISSION_CLASSES.includes(enc.class)) return { ...base, ok: false, status: 404, error: "stay_not_found", written: 0 };
      if (patientId && patientId !== str(enc.patientId)) return { ...base, ok: false, status: 409, error: "patient_mismatch", written: 0 };
      patientId = enc.patientId;
    } else if (patientId && !(await svc.get("Patient", patientId))) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
  } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const at = new Date().toISOString();
  const trip = { resourceType: TRIP_TYPE, id: newId("wsq-trip", ctx.orgId), kind, state: "requested", pickup: pickup.slice(0, 200), drop: drop.slice(0, 200),
    patientId, encounterId, priority: str(t.priority) === "emergency" || kind === "emergency-call" ? "emergency" : "routine",
    note: str(t.note).slice(0, 300) || null, requestedBy: resolved.actor.id, times: { call: at } };
  try {
    const out = await svc.put(trip, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, tripId: trip.id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Moves a trip on. ctx: { tripId, step, vehicleId, crew: [identity], onDuty: [identity]|null, reason, distanceKm } */
async function tripStep(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const step = str(ctx.step), tripId = str(ctx.tripId);
  if (!tripId || !(step in TRIP_FLOW || step === "cancel")) return { ...base, ok: false, status: 422, error: "bad_step", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let trip;
  try { trip = await svc.get(TRIP_TYPE, tripId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!trip) return { ...base, ok: false, status: 404, error: "trip_not_found", written: 0 };
  const at = new Date().toISOString(), next = { ...trip, times: { ...(trip.times || {}) } };
  delete next.version; delete next.meta;

  if (step === "cancel") {
    if (["completed", "cancelled"].includes(trip.state)) return { ...base, ok: false, status: 409, error: "out_of_order", written: 0 };
    if (!str(ctx.reason)) return { ...base, ok: false, status: 422, error: "reason_required", written: 0 };
    Object.assign(next, { state: "cancelled", cancelled: { at, by: resolved.actor.id, reason: str(ctx.reason).slice(0, 300) } });
  } else {
    const [need, to, field] = TRIP_FLOW[step];
    if (trip.state !== need) return { ...base, ok: false, status: 409, error: "out_of_order", detail: `This trip is ${trip.state}.`, written: 0 };
    if (step === "dispatch") {
      const crew = [...new Set((Array.isArray(ctx.crew) ? ctx.crew : []).map(str).filter(Boolean))];
      if (!crew.length) return { ...base, ok: false, status: 422, error: "crew_required", detail: "Name at least one crew member.", written: 0 };
      let v;
      try { v = await svc.get(VEHICLE_TYPE, str(ctx.vehicleId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
      if (!v) return { ...base, ok: false, status: 404, error: "vehicle_not_found", written: 0 };
      const fit = vehicleFitness(v, Date.now());
      if (!fit.ok) return { ...base, ok: false, status: 409, error: "vehicle_not_fit", expired: fit.expired, detail: "This ambulance's fitness certificate or insurance has expired, or it is out of service.", written: 0 };
      const onDuty = Array.isArray(ctx.onDuty) ? new Set(ctx.onDuty.map(str)) : null;
      Object.assign(next, { vehicleId: v.id, registration: v.registration, vehicleClass: v.vehicleClass, chargeCode: chargeCodeFor(v.vehicleClass),
        crew: crew.map((identity) => ({ identity, onRota: onDuty ? onDuty.has(identity) : null })), dispatchedBy: resolved.actor.id });
      /* The same vehicle on two live trips is refused: one ambulance cannot be in two places. */
      try {
        const busy = ((await svc.list(TRIP_TYPE, 2000)) || []).find((x) => x.id !== trip.id && x.vehicleId === v.id && ["dispatched", "arrived", "departed"].includes(x.state));
        if (busy) return { ...base, ok: false, status: 409, error: "vehicle_on_trip", tripId: busy.id, detail: "This ambulance is already on a trip.", written: 0 };
      } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    }
    if (step === "handover" && str(ctx.distanceKm) !== "") {
      const km = Number(ctx.distanceKm);
      if (!Number.isFinite(km) || km < 0) return { ...base, ok: false, status: 422, error: "bad_distance", written: 0 };
      next.distanceKm = km;
    }
    next.state = to;
    next.times[field] = at;
    next.times[field + "By"] = resolved.actor.id;
  }
  try {
    const out = await svc.put(next, { expectedVersion: trip.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, tripId, state: next.state, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** The fleet with fitness alerts, and the trips (open ones, and the last 100 closed). */
async function transportBoard(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off" };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let vehicles, trips;
  try { [vehicles, trips] = await Promise.all([svc.list(VEHICLE_TYPE, 500), svc.list(TRIP_TYPE, 5000)]); }
  catch (e) { return { ...base, ...readFailure(e) }; }
  const nowMs = Date.now();
  const byCall = (a, b) => str(b.times && b.times.call).localeCompare(str(a.times && a.times.call));
  const open = (trips || []).filter((t) => !["completed", "cancelled"].includes(t.state)).sort(byCall);
  const closed = (trips || []).filter((t) => ["completed", "cancelled"].includes(t.state)).sort(byCall).slice(0, 100);
  /* The crew reads a name and an MRN, not a record id. A name that cannot be read is left out, never guessed. */
  const patients = {};
  await Promise.all([...new Set([...open, ...closed].map((t) => t.patientId).filter(Boolean))].map(async (id) => {
    try { const p = await svc.get("Patient", id); if (p) patients[id] = { name: p.name || p.display || null, mrn: p.mrn || null }; } catch { /* unread */ }
  }));
  return { ...base, ok: true, patients,
    vehicles: (vehicles || []).map((v) => ({ ...v, fitness: vehicleFitness(v, nowMs) })).sort((a, b) => str(a.registration).localeCompare(str(b.registration))),
    open, closed };
}

export {
  VEHICLE_TYPE, TRIP_TYPE, VEHICLE_CLASSES, TRIP_KINDS, chargeCodeFor, vehicleFitness,
  saveVehicle, requestTrip, tripStep, transportBoard,
};
