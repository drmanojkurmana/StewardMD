/* functions/_wardsynq/cssd.js - the Central Sterile Services Department: instrument sets through their cycle.
 *
 *   receive (used, from OT or a ward) -> wash -> pack -> sterilise (in a load) -> store (with expiry) -> issue
 *
 * THREE RECORDS. An InstrumentSet is the master: its name and what should be in it. A SterilizerLoad is one run
 * of one steriliser: its number, the cycle parameters, and the chemical and biological indicator results. A
 * CssdCycle is ONE trip of ONE physical set through the department, versioned at every step, so the record
 * says who washed it, who packed it and whether anything was missing, which load sterilised it, and where it
 * went.
 *
 * A SET IS NOT ISSUED ON A HOPE. Issue is refused unless the set's load passed its chemical indicator and its
 * biological indicator (or the load was recorded as released without one, by name), and unless it is in date.
 * The step order is enforced: a set cannot be stored that was never sterilised.
 *
 * A FAILED INDICATOR RECALLS THE LOAD. Recording a fail marks every cycle in that load recalled, and names every
 * set already issued and every theatre case it reached, so the recall is a list of people to tell rather than a
 * search somebody has to think of doing.
 *
 * THE THEATRE CASE IS THE LINK. A set issued for a case, or returned used from one, carries that SurgicalCase id
 * (checked to exist), and the case's sets are listed from it: traceability from a patient to a load and back.
 */

import { str, slug, baseOf, offOf, isoOk, newId, openSvc, writeFailure, readFailure } from "./support-common.js";

const SET_TYPE = "InstrumentSet";
const LOAD_TYPE = "SterilizerLoad";
const CYCLE_TYPE = "CssdCycle";
const STEPS = Object.freeze(["receive", "wash", "pack", "sterilise", "store", "issue"]);
/* The state a cycle must be in for each step, and the state it moves to. */
const FLOW = Object.freeze({ wash: ["received", "washed"], pack: ["washed", "packed"], sterilise: ["packed", "sterilised"], store: ["sterilised", "stored"], issue: ["stored", "issued"] });
const INDICATOR = Object.freeze(["pass", "fail", "pending"]);

/** PURE. A set master from input, or { error }. */
function setFrom(input) {
  const i = input || {};
  const name = str(i.name);
  if (!name) return { error: "set_name_required", detail: "Name the set." };
  const items = (Array.isArray(i.items) ? i.items : []).map((x) => ({ name: str(x && x.name), count: Number(x && x.count) }));
  if (!items.length) return { error: "items_required", detail: "List what is in the set: each instrument and how many." };
  const bad = items.findIndex((x) => !x.name || !Number.isInteger(x.count) || x.count < 1);
  if (bad >= 0) return { error: "bad_item", line: bad, detail: `Item ${bad + 1} needs a name and a whole count of at least one.` };
  return { set: { name: name.slice(0, 120), code: str(i.code).slice(0, 40) || null, items } };
}

/** PURE. Whether a load's sets may leave the department, and why not. */
function loadRelease(load) {
  if (!load) return { ok: false, reason: "load_not_found" };
  if (load.state === "failed" || load.chemicalIndicator === "fail" || load.biologicalIndicator === "fail") return { ok: false, reason: "load_failed" };
  if (load.chemicalIndicator !== "pass") return { ok: false, reason: "chemical_indicator_not_passed" };
  if (load.biologicalIndicator === "pass") return { ok: true };
  if (load.biologicalIndicator === "not-used" && load.releasedWithoutBi) return { ok: true, withoutBi: true };
  return { ok: false, reason: "biological_indicator_pending" };
}

/** PURE. What a failed load reaches: cycles to recall, and the cases and patients its issued sets went to. */
function recallScope(loadId, cycles) {
  const mine = (cycles || []).filter((c) => c && str(c.sterilised && c.sterilised.loadId) === str(loadId));
  return {
    cycles: mine.map((c) => c.id),
    inDepartment: mine.filter((c) => c.state === "sterilised" || c.state === "stored").map((c) => ({ cycleId: c.id, setName: c.setName })),
    reached: mine.filter((c) => c.state === "issued" || c.issued).map((c) => ({
      cycleId: c.id, setName: c.setName, issuedTo: (c.issued && c.issued.to) || null,
      caseId: (c.issued && c.issued.caseId) || c.usedInCaseId || null, patientId: (c.issued && c.issued.patientId) || c.usedOnPatientId || null,
    })),
  };
}

async function caseFor(svc, caseId) {
  if (!str(caseId)) return { c: null };
  const c = await svc.get("SurgicalCase", str(caseId));
  if (!c) return { error: { ok: false, status: 404, error: "case_not_found", detail: "No theatre case has that id." } };
  return { c };
}

/** Creates or updates a set master. ctx: { set: {id?, name, code, items} } */
async function saveInstrumentSet(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const parsed = setFrom(ctx.set);
  if (parsed.error) return { ...base, ok: false, status: 422, ...parsed, written: 0 };
  const id = str(ctx.set && ctx.set.id) || `wsq-set-${slug(parsed.set.code || parsed.set.name)}`;
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const current = await svc.get(SET_TYPE, id);
    const out = await svc.put({ resourceType: SET_TYPE, id, ...parsed.set, active: ctx.set.active !== false, updatedBy: resolved.actor.id, updatedAt: new Date().toISOString() },
      { expectedVersion: current ? current.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, setId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Starts a steriliser load. ctx: { load: { sterilizer, loadNumber, programme, temperatureC, holdMinutes, pressureKpa } } */
async function startLoad(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const l = ctx.load || {};
  const sterilizer = str(l.sterilizer), loadNumber = str(l.loadNumber), programme = str(l.programme);
  const num = (v) => (str(v) === "" ? null : Number(v));
  const temperatureC = num(l.temperatureC), holdMinutes = num(l.holdMinutes), pressureKpa = num(l.pressureKpa);
  if (!sterilizer || !loadNumber) return { ...base, ok: false, status: 422, error: "load_identity_required", detail: "A load needs the steriliser and its load number.", written: 0 };
  if (!programme || !Number.isFinite(temperatureC) || !Number.isFinite(holdMinutes)) return { ...base, ok: false, status: 422, error: "cycle_parameters_required", detail: "Record the programme, the temperature and the holding time the cycle ran at.", written: 0 };
  if (pressureKpa !== null && !Number.isFinite(pressureKpa)) return { ...base, ok: false, status: 422, error: "bad_pressure", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = `wsq-load-${slug(sterilizer)}-${slug(loadNumber)}`;
  try {
    if (await svc.get(LOAD_TYPE, id)) return { ...base, ok: false, status: 409, error: "load_exists", detail: "That steriliser already has a load with this number.", written: 0 };
    const out = await svc.put({ resourceType: LOAD_TYPE, id, sterilizer, loadNumber, programme, temperatureC, holdMinutes, pressureKpa,
      state: "running", chemicalIndicator: "pending", biologicalIndicator: "pending", startedAt: new Date().toISOString(), startedBy: resolved.actor.id },
    { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, loadId: id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Records indicator results for a load. A fail recalls the load. ctx: { loadId, chemicalIndicator, biologicalIndicator, releaseWithoutBi } */
async function recordLoadResult(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const loadId = str(ctx.loadId);
  const ci = str(ctx.chemicalIndicator), bi = str(ctx.biologicalIndicator);
  if (!loadId) return { ...base, ok: false, status: 422, error: "load_required", written: 0 };
  if ((ci && !INDICATOR.includes(ci)) || (bi && !INDICATOR.includes(bi) && bi !== "not-used")) return { ...base, ok: false, status: 422, error: "bad_indicator", detail: "An indicator is pass, fail or pending.", written: 0 };
  if (!ci && !bi) return { ...base, ok: false, status: 422, error: "result_required", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let load;
  try { load = await svc.get(LOAD_TYPE, loadId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!load) return { ...base, ok: false, status: 404, error: "load_not_found", written: 0 };
  if (load.state === "failed") return { ...base, ok: false, status: 409, error: "load_already_failed", detail: "This load already failed and was recalled.", written: 0 };
  const at = new Date().toISOString();
  const next = { ...load, ...(ci ? { chemicalIndicator: ci } : {}), ...(bi ? { biologicalIndicator: bi } : {}), resultBy: resolved.actor.id, resultAt: at };
  if (bi === "not-used") {
    if (ctx.releaseWithoutBi !== true) return { ...base, ok: false, status: 422, error: "release_without_bi_unconfirmed", detail: "Releasing a load with no biological indicator has to be confirmed.", written: 0 };
    next.releasedWithoutBi = { by: resolved.actor.id, at };
  }
  const failed = next.chemicalIndicator === "fail" || next.biologicalIndicator === "fail";
  next.state = failed ? "failed" : loadRelease(next).ok ? "released" : "running";
  delete next.version; delete next.meta;
  try {
    const out = await svc.put(next, { expectedVersion: load.version, idempotencyKey: ctx.idempotencyKey || null });
    if (!failed) return { ...base, ok: true, written: 1, loadId, state: next.state, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }

  /* The recall. Every cycle in the load gets a new version saying so; one that fails to write is named. */
  let cycles;
  try { cycles = (await svc.list(CYCLE_TYPE, 5000)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "recall_incomplete", written: 1, detail: "The failed result is recorded, but the sets in this load could not be read to recall them. Recall them by hand now.", loadId }; }
  const scope = recallScope(loadId, cycles);
  const notWritten = [];
  let written = 1;
  for (const c of cycles.filter((x) => scope.cycles.includes(x.id))) {
    const r = { ...c, recalled: { loadId, at, by: resolved.actor.id, reason: "indicator_failed" }, state: c.state === "issued" ? "issued" : "recalled" };
    delete r.version; delete r.meta;
    try { await svc.put(r, { expectedVersion: c.version }); written += 1; } catch { notWritten.push(c.id); }
  }
  return { ...base, ok: notWritten.length === 0, ...(notWritten.length ? { status: 502, error: "recall_incomplete", notWritten } : {}),
    written, loadId, state: "failed", recall: scope,
    detail: scope.reached.length ? "Load failed. Sets from it reached patients: tell the teams named below." : "Load failed. Every set from it is recalled for reprocessing." };
}

/** Moves one set a step through its cycle. ctx: { step, setId, cycleId, from, caseId, loadId, expiresAt, location, to, missing, method } */
async function cssdStep(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const step = str(ctx.step);
  if (!STEPS.includes(step)) return { ...base, ok: false, status: 422, error: "bad_step", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString(), by = resolved.actor.id;

  if (step === "receive") {
    const setId = str(ctx.setId), from = str(ctx.from);
    if (!setId || !from) return { ...base, ok: false, status: 422, error: "receive_needs_set_and_source", detail: "Say which set and where it came from.", written: 0 };
    let set, cycles, kase;
    try {
      set = await svc.get(SET_TYPE, setId);
      cycles = ((await svc.list(CYCLE_TYPE, 5000)) || []).filter((c) => str(c.setId) === setId);
      kase = await caseFor(svc, ctx.caseId);
    } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    if (!set) return { ...base, ok: false, status: 404, error: "set_not_found", written: 0 };
    if (kase.error) return { ...base, ...kase.error, written: 0 };
    const busy = cycles.find((c) => !["issued", "recalled"].includes(c.state));
    if (busy) return { ...base, ok: false, status: 409, error: "set_in_process", detail: `This set is already in the department (${busy.state}).`, cycleId: busy.id, written: 0 };
    let written = 0;
    /* The set came back used: the case goes on the cycle whose sterility it was used under, as well as this one. */
    const last = cycles.filter((c) => c.state === "issued").sort((a, b) => str(b.issued && b.issued.at).localeCompare(str(a.issued && a.issued.at)))[0];
    if (last && kase.c) {
      const r = { ...last, usedInCaseId: kase.c.id, usedOnPatientId: kase.c.patientId || null, returnedAt: at };
      delete r.version; delete r.meta;
      try { await svc.put(r, { expectedVersion: last.version }); written += 1; } catch (e) { return { ...base, ...writeFailure(e), written }; }
    }
    const id = newId("wsq-cssd", setId);
    try {
      const out = await svc.put({ resourceType: CYCLE_TYPE, id, setId, setName: set.name, state: "received",
        received: { from: from.slice(0, 120), at, by, ...(kase.c ? { usedInCaseId: kase.c.id } : {}) } }, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
      return { ...base, ok: true, written: written + 1, cycleId: id, state: "received", version: out.record.version };
    } catch (e) { return { ...base, ...writeFailure(e), written }; }
  }

  const cycleId = str(ctx.cycleId);
  if (!cycleId) return { ...base, ok: false, status: 422, error: "cycle_required", written: 0 };
  let cycle;
  try { cycle = await svc.get(CYCLE_TYPE, cycleId); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cycle) return { ...base, ok: false, status: 404, error: "cycle_not_found", written: 0 };
  const [need, to] = FLOW[step];
  if (cycle.recalled && cycle.state !== "issued") return { ...base, ok: false, status: 409, error: "recalled", detail: "This set was recalled with its load. Receive it again to reprocess it.", written: 0 };
  if (cycle.state !== need) return { ...base, ok: false, status: 409, error: "out_of_order", detail: `This set is ${cycle.state}; it has to be ${need} first.`, written: 0 };
  const next = { ...cycle, state: to };
  delete next.version; delete next.meta;

  if (step === "wash") next.washed = { at, by, method: str(ctx.method).slice(0, 60) || null };
  if (step === "pack") {
    const missing = (Array.isArray(ctx.missing) ? ctx.missing : []).map(str).filter(Boolean);
    if (ctx.itemsChecked !== true) return { ...base, ok: false, status: 422, error: "items_not_checked", detail: "Check every item against the set list before packing.", written: 0 };
    next.packed = { at, by, itemsChecked: true, missing };
  }
  if (step === "sterilise") {
    let load;
    try { load = await svc.get(LOAD_TYPE, str(ctx.loadId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    if (!load) return { ...base, ok: false, status: 404, error: "load_not_found", detail: "Start the load first.", written: 0 };
    if (load.state === "failed") return { ...base, ok: false, status: 409, error: "load_failed", written: 0 };
    next.sterilised = { loadId: load.id, sterilizer: load.sterilizer, loadNumber: load.loadNumber, at, by };
  }
  if (step === "store") {
    if (!isoOk(ctx.expiresAt) || Date.parse(ctx.expiresAt) <= Date.now()) return { ...base, ok: false, status: 422, error: "expiry_required", detail: "Give the sterile expiry date, later than today.", written: 0 };
    next.stored = { at, by, expiresAt: new Date(ctx.expiresAt).toISOString(), location: str(ctx.location).slice(0, 60) || null };
  }
  if (step === "issue") {
    const to_ = str(ctx.to);
    if (!to_) return { ...base, ok: false, status: 422, error: "issue_needs_destination", detail: "Say which theatre or ward the set goes to.", written: 0 };
    if (Date.parse(cycle.stored && cycle.stored.expiresAt) <= Date.now()) return { ...base, ok: false, status: 409, error: "expired", detail: "This set is past its sterile expiry. Reprocess it.", written: 0 };
    let load, kase;
    try { load = await svc.get(LOAD_TYPE, str(cycle.sterilised && cycle.sterilised.loadId)); kase = await caseFor(svc, ctx.caseId); }
    catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
    const rel = loadRelease(load);
    if (!rel.ok) return { ...base, ok: false, status: 409, error: rel.reason, detail: "This set's load has not passed its indicators, so it cannot be issued.", written: 0 };
    if (kase.error) return { ...base, ...kase.error, written: 0 };
    next.issued = { to: to_.slice(0, 120), at, by, ...(kase.c ? { caseId: kase.c.id, patientId: kase.c.patientId || null } : {}), ...(rel.withoutBi ? { releasedWithoutBi: true } : {}) };
  }
  try {
    const out = await svc.put(next, { expectedVersion: cycle.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, cycleId, state: to, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** The department's board: sets, cycles by state, loads, and what is near or past expiry. */
async function cssdBoard(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off" };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let sets, loads, cycles, cases;
  try {
    [sets, loads, cycles] = await Promise.all([svc.list(SET_TYPE, 1000), svc.list(LOAD_TYPE, 1000), svc.list(CYCLE_TYPE, 5000)]);
    /* Theatre cases a set can be issued to or come back from: every case not abandoned, newest first. The
     * procedure and side, never the patient: CSSD links a set to a case, and the case knows the patient. */
    const at = (c) => str(c.ledger && c.ledger[0] && c.ledger[0].at);
    cases = ((await svc.list("SurgicalCase", 1000)) || []).filter((c) => c && str(c.stage) !== "abandoned")
      .sort((a, b) => at(b).localeCompare(at(a))).slice(0, 100)
      .map((c) => ({ caseId: c.id, procedure: c.procedure || null, laterality: c.laterality || null, stage: c.stage || null, bookedAt: at(c) || null }));
  } catch (e) { return { ...base, ...readFailure(e) }; }
  const nowMs = Date.now(), soon = nowMs + 3 * 86400000;
  const open = (cycles || []).filter((c) => c.state !== "issued" || c.recalled);
  return { ...base, ok: true,
    sets: (sets || []).sort((a, b) => str(a.name).localeCompare(str(b.name))),
    loads: (loads || []).sort((a, b) => str(b.startedAt).localeCompare(str(a.startedAt))).slice(0, 100),
    cycles: open.sort((a, b) => str(b.received && b.received.at).localeCompare(str(a.received && a.received.at))),
    expiring: (cycles || []).filter((c) => c.state === "stored" && Date.parse(c.stored && c.stored.expiresAt) < soon)
      .map((c) => ({ cycleId: c.id, setName: c.setName, expiresAt: c.stored.expiresAt, expired: Date.parse(c.stored.expiresAt) <= nowMs })),
    cases };
}

/** Which sets were used on a theatre case, and the load each came from. ctx: { caseId } */
async function caseSets(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", sets: [] };
  const caseId = str(ctx.caseId);
  if (!caseId) return { ...base, ok: false, status: 422, error: "case_required", sets: [] };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, sets: [] };
  let cycles, loads;
  try { cycles = (await svc.list(CYCLE_TYPE, 5000)) || []; loads = new Map(((await svc.list(LOAD_TYPE, 1000)) || []).map((l) => [l.id, l])); }
  catch (e) { return { ...base, ...readFailure(e), sets: [] }; }
  const sets = cycles.filter((c) => str(c.issued && c.issued.caseId) === caseId || str(c.usedInCaseId) === caseId).map((c) => {
    const l = loads.get(str(c.sterilised && c.sterilised.loadId));
    return { cycleId: c.id, setName: c.setName, issuedAt: (c.issued && c.issued.at) || null, loadNumber: (c.sterilised && c.sterilised.loadNumber) || null,
      sterilizer: (c.sterilised && c.sterilised.sterilizer) || null, loadState: l ? l.state : null, recalled: !!c.recalled };
  });
  return { ...base, ok: true, caseId, sets };
}

export {
  SET_TYPE, LOAD_TYPE, CYCLE_TYPE, STEPS, setFrom, loadRelease, recallScope,
  saveInstrumentSet, startLoad, recordLoadResult, cssdStep, cssdBoard, caseSets,
};
