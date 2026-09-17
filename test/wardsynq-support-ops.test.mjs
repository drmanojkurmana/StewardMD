/* test/wardsynq-support-ops.test.mjs - housekeeping, ambulance and mortuary through the real routes:
 * GET /api/queue/ward/housekeeping-board, POST /ward/housekeeping-task, POST /ward/housekeeping-step,
 * GET /ward/housekeeping-report, POST /bed/update (the inspection gate), POST /ward/ambulance-vehicle,
 * POST /ward/ambulance-trip, POST /ward/ambulance-trip-step, GET /ward/transport-board,
 * POST /ward/mortuary-receive, /ward/mortuary-update, /ward/mortuary-release, GET /ward/mortuary-board.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-support-ops.test.mjs
 */
import { as, seed, docs, H, T, ORG_ID, ADMIN, NURSE, HR, CASHIER, DOCTOR, KITCHEN, CSSD, HOUSEKEEPER, HOUSEKEEPER2, SUPERVISOR, TRANSPORT, MORTUARY, idFor, admitted, refusals } from "./wardsynq-support-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const bed = (id) => docs.get("q_beds/" + id).fields;

test("housekeeping routes refuse without a session, with the wrong role (nothing written), and from another hospital", async () => {
  seed();
  await refusals("/ward/housekeeping-board", "GET", null, NURSE);
  await refusals("/ward/housekeeping-task", "POST", { kind: "spill", location: "Corridor B" }, KITCHEN);
  await refusals("/ward/housekeeping-step", "POST", { taskId: "x", step: "assign" }, CSSD);
  await refusals("/ward/housekeeping-step", "POST", { taskId: "x", step: "inspect", result: "pass" }, HOUSEKEEPER);
  await refusals("/ward/housekeeping-report", "GET", null, CASHIER);
});

test("a transfer (as a discharge) sends the bed to cleaning, the task appears by itself, and only a passed inspection by someone else frees the bed", async () => {
  seed();
  const p = await admitted();
  // The bed board's own transfer frees bed 1: with inspection on it goes to cleaning.
  const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG_ID, encounterId: p.encounterId, ward: "Medical A", bed: "5" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  assert.equal(bed("b-1").state, "cleaning");
  assert.ok(bed("b-1").stateSince > 0);
  const byHand = await as(ADMIN, "/bed/update", "POST", { orgId: ORG_ID, bedId: "b-1", state: "available" });
  assert.equal(byHand.__status, 409); assert.equal(byHand.error, "housekeeping_inspection_required");

  const board = await as(HOUSEKEEPER, "/ward/housekeeping-board?orgId=" + ORG_ID);
  assert.equal(board.__status, 200, JSON.stringify(board));
  const task = board.tasks.find((t) => t.bedId === "b-1");
  assert.ok(task && task.virtual && task.state === "open", JSON.stringify(board.tasks));
  assert.equal(board.canInspect, false);

  const step = (who, b) => as(who, "/ward/housekeeping-step", "POST", { orgId: ORG_ID, taskId: task.id, ...b });
  assert.equal((await step(HOUSEKEEPER, { step: "start" })).error, "out_of_order");
  assert.equal((await step(HOUSEKEEPER, { step: "assign" })).__status, 200);
  assert.equal((await step(HOUSEKEEPER2, { step: "start" })).error, "not_assignee");
  assert.equal((await step(HOUSEKEEPER, { step: "start" })).__status, 200);
  assert.equal((await step(HOUSEKEEPER, { step: "finish" })).__status, 200);
  const selfInspect = await step(HOUSEKEEPER, { step: "inspect", result: "pass" });
  assert.equal(selfInspect.__status, 403, "a cleaner cannot inspect");
  const fail = await step(SUPERVISOR, { step: "inspect", result: "fail", note: "Locker not wiped" });
  assert.equal(fail.__status, 200, JSON.stringify(fail)); assert.equal(fail.state, "rework");
  assert.equal(bed("b-1").state, "cleaning", "a failed inspection leaves the bed cleaning");
  for (const s of ["assign", "start", "finish"]) assert.equal((await step(HOUSEKEEPER, { step: s })).__status, 200, s);
  const pass = await step(SUPERVISOR, { step: "inspect", result: "pass" });
  assert.equal(pass.__status, 200, JSON.stringify(pass)); assert.equal(pass.bedReleased, true);
  assert.equal(bed("b-1").state, "available");
  const hist = await H.RECORD.history(T, "HousekeepingTask", task.id);
  assert.deepEqual(hist.map((h) => h.state), ["assigned", "in-progress", "finished", "rework", "assigned", "in-progress", "finished", "inspected"]);

  const rep = await as(SUPERVISOR, "/ward/housekeeping-report?orgId=" + ORG_ID + "&days=7");
  assert.equal(rep.__status, 200); assert.equal(rep.inspected, 1);
  assert.equal(rep.byKind[0].key, "bed-clean"); assert.equal(rep.byKind[0].toInspected.count, 1);
});

test("a spill raised by hand; a terminal clean needs its isolation type; the bed board still works when inspection is off", async () => {
  seed({ housekeepingInspection: false });
  const spill = await as(SUPERVISOR, "/ward/housekeeping-task", "POST", { orgId: ORG_ID, kind: "spill", location: "Ward A corridor" });
  assert.equal(spill.__status, 200, JSON.stringify(spill));
  const term = await as(HOUSEKEEPER, "/ward/housekeeping-task", "POST", { orgId: ORG_ID, kind: "terminal-clean", location: "Side room 2" });
  assert.equal(term.error, "isolation_type_required");
  assert.equal((await as(HOUSEKEEPER, "/ward/housekeeping-step", "POST", { orgId: ORG_ID, taskId: spill.taskId, step: "cancel", reason: "dup" })).__status, 403);
  // Inspection off: the bed board sets cleaning and available by hand, as it always has.
  assert.equal((await as(ADMIN, "/bed/update", "POST", { orgId: ORG_ID, bedId: "b-2", state: "cleaning" })).__status, 200);
  const board = await as(HOUSEKEEPER, "/ward/housekeeping-board?orgId=" + ORG_ID);
  assert.ok(board.tasks.some((t) => t.bedId === "b-2" && t.virtual));
  assert.equal((await as(ADMIN, "/bed/update", "POST", { orgId: ORG_ID, bedId: "b-2", state: "available" })).__status, 200);
  assert.ok(!(await as(HOUSEKEEPER, "/ward/housekeeping-board?orgId=" + ORG_ID)).tasks.some((t) => t.bedId === "b-2"));
});

test("ambulance routes refuse without a session, with the wrong role (nothing written), and from another hospital", async () => {
  seed();
  await refusals("/ward/ambulance-vehicle", "POST", { vehicle: { registration: "TS09AB1234", vehicleClass: "ALS", fitnessExpiry: days(100), insuranceExpiry: days(100) } }, NURSE);
  await refusals("/ward/ambulance-trip", "POST", { trip: { kind: "emergency-call", pickup: "Highway", drop: "ED" } }, MORTUARY);
  await refusals("/ward/ambulance-trip-step", "POST", { tripId: "x", step: "dispatch" }, HR);
  await refusals("/ward/transport-board", "GET", null, KITCHEN);
});

test("ambulance: an unfit vehicle is not dispatched, times run in order, the crew is read against the rota, and a completed trip is a charge", async () => {
  seed();
  const p = await admitted();
  const bad = await as(TRANSPORT, "/ward/ambulance-vehicle", "POST", { orgId: ORG_ID, vehicle: { registration: "TS09AB0001", vehicleClass: "BLS", fitnessExpiry: days(-1), insuranceExpiry: days(200) } });
  assert.equal(bad.__status, 200);
  const good = await as(TRANSPORT, "/ward/ambulance-vehicle", "POST", { orgId: ORG_ID, vehicle: { registration: "TS09AB0002", vehicleClass: "ALS", fitnessExpiry: days(20), insuranceExpiry: days(300) } });
  const board0 = await as(TRANSPORT, "/ward/transport-board?orgId=" + ORG_ID);
  const fit = (id) => board0.vehicles.find((v) => v.id === id).fitness;
  assert.deepEqual(fit(bad.vehicleId).expired, ["fitnessExpiry"]);
  assert.deepEqual(fit(good.vehicleId).dueSoon, ["fitnessExpiry"]);
  assert.equal((await as(TRANSPORT, "/ward/ambulance-trip", "POST", { orgId: ORG_ID, trip: { kind: "inter-facility", pickup: "Medical A", drop: "City Hospital" } })).error, "stay_required");
  const trip = await as(TRANSPORT, "/ward/ambulance-trip", "POST", { orgId: ORG_ID, trip: { kind: "inter-facility", pickup: "Medical A", drop: "City Hospital", encounterId: p.encounterId } });
  assert.equal(trip.__status, 200, JSON.stringify(trip));
  const step = (b) => as(TRANSPORT, "/ward/ambulance-trip-step", "POST", { orgId: ORG_ID, tripId: trip.tripId, ...b });
  assert.equal((await step({ step: "arrive" })).error, "out_of_order");
  assert.equal((await step({ step: "dispatch", vehicleId: bad.vehicleId, crew: [idFor(NURSE)] })).error, "vehicle_not_fit");
  assert.equal((await step({ step: "dispatch", vehicleId: good.vehicleId, crew: [] })).error, "crew_required");
  assert.equal((await step({ step: "dispatch", vehicleId: good.vehicleId, crew: [idFor(NURSE)] })).__status, 200);
  for (const s of ["arrive", "depart"]) assert.equal((await step({ step: s })).__status, 200, s);
  assert.equal((await step({ step: "handover", distanceKm: 12.5 })).__status, 200);
  const done = await H.RECORD.latest(T, "AmbulanceTrip", trip.tripId);
  assert.equal(done.state, "completed"); assert.equal(done.chargeCode, "AMBULANCE-ALS"); assert.equal(done.patientId, p.patientId);
  assert.ok(done.times.call <= done.times.dispatch && done.times.dispatch <= done.times.arrival && done.times.departure <= done.times.handover);
  assert.equal(done.crew[0].onRota, false, "nobody is rostered in this hospital, and the rota was read");
  const charges = await as(CASHIER, "/ward/charges?orgId=" + ORG_ID + "&patientId=" + encodeURIComponent(p.patientId));
  assert.equal(charges.__status, 200, JSON.stringify(charges));
  assert.ok(charges.items.some((i) => i.sourceType === "AmbulanceTrip" && i.code === "AMBULANCE-ALS"), JSON.stringify(charges.items));
});

test("mortuary routes refuse without a session, with the wrong role (nothing written), and from another hospital", async () => {
  seed();
  await refusals("/ward/mortuary-receive", "POST", { patientId: "x", broughtBy: "a", identifiedBy: "b" }, NURSE);
  await refusals("/ward/mortuary-update", "POST", { caseId: "x", chamber: "C1" }, TRANSPORT);
  await refusals("/ward/mortuary-release", "POST", { caseId: "x", release: {} }, HR);
  await refusals("/ward/mortuary-board", "GET", null, CSSD);
});

test("mortuary: only a recorded death is received, one body per chamber, and release needs the checklist, the police for an MLC", async () => {
  seed();
  const p = await admitted(), q = await admitted();
  const early = await as(MORTUARY, "/ward/mortuary-receive", "POST", { orgId: ORG_ID, patientId: p.patientId, broughtBy: "Ward porter", identifiedBy: "Staff nurse" });
  assert.equal(early.error, "not_recorded_deceased");
  for (const x of [p, q]) assert.equal((await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG_ID, patientId: x.patientId, confirm: true, deceased: { at: new Date(Date.now() - 3600000).toISOString(), cause: "Cardiac arrest", certifiedBy: "Dr Test" } })).__status, 200);
  // The stay of q is medico-legal.
  const enc = await H.RECORD.latest(T, "Encounter", q.encounterId);
  await H.RECORD.append(T, [{ ...enc, version: enc.version + 1, mlc: true }], { actor: "test" });

  const board0 = await as(MORTUARY, "/ward/mortuary-board?orgId=" + ORG_ID);
  assert.equal(board0.awaiting.length, 2);
  const rp = await as(MORTUARY, "/ward/mortuary-receive", "POST", { orgId: ORG_ID, patientId: p.patientId, encounterId: p.encounterId, broughtBy: "Ward porter", identifiedBy: "Staff nurse", chamber: "C1", belongings: [{ item: "Wrist watch", quantity: 1 }] });
  assert.equal(rp.__status, 200, JSON.stringify(rp)); assert.equal(rp.mlc.flag, null);
  const rq = await as(MORTUARY, "/ward/mortuary-receive", "POST", { orgId: ORG_ID, patientId: q.patientId, encounterId: q.encounterId, broughtBy: "Porter", identifiedBy: "Nurse", chamber: "C1" });
  assert.equal(rq.error, "chamber_occupied");
  const rq2 = await as(MORTUARY, "/ward/mortuary-receive", "POST", { orgId: ORG_ID, patientId: q.patientId, encounterId: q.encounterId, broughtBy: "Porter", identifiedBy: "Nurse", chamber: "C2" });
  assert.equal(rq2.__status, 200); assert.equal(rq2.mlc.flag, true);

  const release = { to: "relatives", receiverName: "Son", relationship: "son", idProofType: "aadhaar", idProofNumber: "XXXX1234", bodyIdentified: true, documents: { deathCertificate: true } };
  const incomplete = await as(MORTUARY, "/ward/mortuary-release", "POST", { orgId: ORG_ID, caseId: rp.caseId, release });
  assert.equal(incomplete.__status, 422);
  assert.deepEqual(incomplete.missing.sort(), ["belongings_handed_over", "mlc_status_confirmed", "post_mortem_decision"]);
  assert.equal((await as(MORTUARY, "/ward/mortuary-update", "POST", { orgId: ORG_ID, caseId: rp.caseId, postMortem: { required: "no", orderedBy: "Treating doctor" } })).__status, 200);
  const released = await as(MORTUARY, "/ward/mortuary-release", "POST", { orgId: ORG_ID, caseId: rp.caseId, release: { ...release, mlcConfirmedNotBy: "Dr Test", documents: { deathCertificate: true, belongingsHandedOver: true } } });
  assert.equal(released.__status, 200, JSON.stringify(released));
  assert.equal((await as(MORTUARY, "/ward/mortuary-update", "POST", { orgId: ORG_ID, caseId: rp.caseId, chamber: "C2" })).error, "released");

  const noWaiver = await as(MORTUARY, "/ward/mortuary-update", "POST", { orgId: ORG_ID, caseId: rq2.caseId, postMortem: { required: "no", orderedBy: "Police" } });
  assert.equal(noWaiver.error, "post_mortem_waiver_reason_required");
  assert.equal((await as(MORTUARY, "/ward/mortuary-update", "POST", { orgId: ORG_ID, caseId: rq2.caseId, postMortem: { required: "yes", orderedBy: "Police" } })).__status, 200);
  const mlc = await as(MORTUARY, "/ward/mortuary-release", "POST", { orgId: ORG_ID, caseId: rq2.caseId, release: { ...release, documents: { deathCertificate: true } } });
  assert.deepEqual(mlc.missing.sort(), ["police_noc", "post_mortem_report"]);
  const board = await as(MORTUARY, "/ward/mortuary-board?orgId=" + ORG_ID);
  assert.equal(board.held.length, 1); assert.equal(board.released.length, 1);
  assert.deepEqual(board.chambers, [{ chamber: "C1", caseId: null }, { chamber: "C2", caseId: rq2.caseId }]);
  const versions = await H.RECORD.history(T, "MortuaryCase", rp.caseId);
  assert.deepEqual(versions.map((v) => v.state), ["received", "received", "released"]);
});
