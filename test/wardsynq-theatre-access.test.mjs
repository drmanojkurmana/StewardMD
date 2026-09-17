/* test/wardsynq-theatre-access.test.mjs - P3 theatre-opd-access: theatre sessions held and released, theatre times,
 * rescheduling and the unplanned-return flag on the case, utilisation from booked and used minutes, appointment
 * arrival and no-show, OPD and diagnostic waiting times, and NABH indicators 6, 19, 22 and 23.
 *
 * Routes (the real router, ops harness): POST /api/queue/ward/theatre-session, POST /ward/theatre-session-release,
 * GET /ward/theatre-utilisation, POST /ward/book-resource, POST /ward/surgery-reschedule, POST /ward/surgery-times,
 * POST /ward/surgery-return, POST /ward/diagnostic-arrival, POST /ward/diagnostic-start, GET /ward/access-times,
 * POST /ward/book, POST /ward/appointment.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-theatre-access.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, H, TENANT, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { theatreSettings, sessionStatus, heldSessionFor, computeTheatreUtilisation, rescheduleOf, rescheduleCell, unplannedReturnCell } = await import("../functions/_wardsynq/theatre.js");
const { waitOf, opdWaits, diagnosticWaits, waitCell } = await import("../functions/_wardsynq/access-times.js");
const { encounterFromTicket, sameEncounter } = await import("../functions/_wardsynq/migrate-encounter.js");
const { computeNabhIndicators, monthWindows } = await import("../functions/_wardsynq/compliance.js");

const IST = 330 * 60000, H1 = 3600000, M1 = 60000;
const AUG = { month: "2026-08", fromMs: Date.UTC(2026, 7, 1) - IST, toMs: Date.UTC(2026, 8, 1) - IST - 1, offsetMs: IST };
const at = (s) => new Date(Date.parse(s)).toISOString();

/* ---------------------------------------------------------------- pure */

test("a session is held until the configured release hour, then its minutes are free; with no rule only a person releases it", () => {
  const s = { theatreId: "ot-1", startAt: "2026-08-10T03:30:00Z", minutes: 240, owner: { kind: "unit", id: "ortho" } };
  const cfg = theatreSettings({ releaseHours: 24 });
  const start = Date.parse(s.startAt);
  assert.equal(sessionStatus(s, cfg, start - 24 * H1 - 1).state, "held");
  assert.deepEqual(sessionStatus(s, cfg, start - 24 * H1), { state: "released", releasedAt: new Date(start - 24 * H1).toISOString(), by: "rule" });
  const other = { resourceId: "ot-1", startAt: "2026-08-10T04:00:00Z", minutes: 60 };
  assert.equal(heldSessionFor([s], other, "gen-surg", cfg, start - 25 * H1), s, "another unit is refused while held");
  assert.equal(heldSessionFor([s], other, "ortho", cfg, start - 25 * H1), null, "the owner books its own session");
  assert.equal(heldSessionFor([s], other, "gen-surg", cfg, start - 23 * H1), null, "after the release hour anyone books");
  assert.equal(sessionStatus(s, theatreSettings(null), start).state, "held", "no rule: nothing is released by the clock");
  assert.equal(sessionStatus({ ...s, releasedAt: "2026-08-08T00:00:00Z" }, theatreSettings(null), start).by, "person");
  assert.deepEqual(theatreSettings({ releaseHours: "x", firstCaseGraceMinutes: -1, rescheduleReasons: ["List overran", { code: "No bed", label: "No ICU bed" }, ""] }),
    { releaseHours: null, firstCaseGraceMinutes: null, rescheduleReasons: [{ code: "list-overran", label: "List overran" }, { code: "no-bed", label: "No ICU bed" }] });
});

test("utilisation is booked and used minutes over session minutes, with every input returned and missing times listed, never zero", () => {
  const theatres = [{ id: "ot-1", name: "OT 1", kind: "theatre" }, { id: "room-1", name: "Room", kind: "room" }];
  const sessions = [{ id: "s1", theatreId: "ot-1", startAt: "2026-08-10T03:30:00Z", minutes: 240, owner: { kind: "unit", id: "ortho", name: "Ortho" } }];
  const bookings = [
    { resourceId: "ot-1", state: "booked", startAt: "2026-08-10T03:30:00Z", minutes: 90, sessionOwnerId: "ortho" },
    { resourceId: "ot-1", state: "completed", startAt: "2026-08-10T07:00:00Z", minutes: 60, sessionOwnerId: "gen" }, // 30 inside the session
    { resourceId: "ot-1", state: "cancelled", startAt: "2026-08-10T05:00:00Z", minutes: 60 },
  ];
  const cases = [
    { id: "c1", theatreId: "ot-1", procedure: "TKR", scheduledAt: "2026-08-10T03:30:00Z", theatreTimes: { inRoomAt: "2026-08-10T03:45:00Z", outRoomAt: "2026-08-10T05:15:00Z" } },
    { id: "c2", theatreId: "OT 1", procedure: "ORIF", scheduledAt: "2026-08-10T05:30:00Z", theatreTimes: { inRoomAt: "2026-08-10T05:40:00Z", outRoomAt: "2026-08-10T06:40:00Z" } }, // matched by the theatre's name
    { id: "c3", theatreId: "ot-1", procedure: "Arthroscopy", scheduledAt: "2026-08-10T07:00:00Z", theatreTimes: { inRoomAt: "2026-08-10T07:10:00Z" } },
    { id: "c4", theatreId: "ot-1", procedure: "Cancelled", scheduledAt: "2026-08-10T08:00:00Z", stage: "abandoned" },
  ];
  const day = { fromMs: Date.parse("2026-08-09T18:30:00Z"), toMs: Date.parse("2026-08-10T18:29:59Z"), offsetMs: IST, nowMs: Date.parse("2026-08-11T00:00:00Z") };
  const rep = computeTheatreUtilisation({ theatres, sessions, bookings, cases, settings: theatreSettings({ firstCaseGraceMinutes: 10, releaseHours: 24 }), ...day });
  assert.equal(rep.theatres.length, 1, "only theatres");
  const t = rep.theatres[0];
  assert.equal(t.sessionMinutes, 240);
  assert.equal(t.bookedMinutesInSessions, 120, "90 + the 30 of the second booking inside the session; the cancelled one never occupied it");
  assert.equal(t.bookedUtilisation, 50);
  assert.equal(t.usedMinutesInSessions, 150, "90 for c1 and 60 for c2; c3 has no out-of-room time and adds nothing");
  assert.equal(t.usedUtilisation, 62.5);
  assert.equal(t.bookedMinutesOutsideSessions, 30);
  assert.deepEqual(t.sessions[0].status.by, "rule");
  assert.equal(t.sessions[0].releasedMinutes, 150, "released: the owner's unbooked minutes");
  assert.deepEqual(t.casesMissingTimes, [{ caseId: "c3", procedure: "Arthroscopy", scheduledAt: "2026-08-10T07:00:00Z", missing: ["outRoomAt"] }]);
  assert.deepEqual(t.cases.map((c) => [c.caseId, c.minutes]), [["c1", 90], ["c2", 60]]);
  assert.deepEqual(t.firstCases, [{ day: "2026-08-10", caseId: "c1", procedure: "TKR", scheduledAt: "2026-08-10T03:30:00Z", inRoomAt: "2026-08-10T03:45:00.000Z", lateMinutes: 15, onTime: false, missing: [] }]);
  assert.deepEqual(t.turnovers.map((x) => [x.fromCaseId, x.toCaseId, x.minutes]), [["c1", "c2", 25], ["c2", "c3", 30]]);
  assert.deepEqual(t.turnoverMissing, []);
  const noOut = computeTheatreUtilisation({ theatres, sessions, bookings, cases: [cases[2], { ...cases[2], id: "c5", scheduledAt: "2026-08-10T09:00:00Z", theatreTimes: { inRoomAt: "2026-08-10T09:10:00Z" } }], settings: theatreSettings({}), ...day }).theatres[0];
  assert.deepEqual(noOut.turnoverMissing, [{ fromCaseId: "c3", toCaseId: "c5", missing: ["outRoomAt"] }], "a turnover with a missing time is listed, not counted");
  const noGrace = computeTheatreUtilisation({ theatres, sessions, bookings, cases, settings: theatreSettings({}), ...day }).theatres[0];
  assert.equal(noGrace.firstCases[0].onTime, null, "no grace configured: the lateness is shown, no on-time judgement");
  assert.equal(computeTheatreUtilisation({ theatres, sessions: [], bookings, cases, ...day }).theatres[0].bookedUtilisation, null, "no session minutes: no percentage");
});

test("NABH 19 counts cancellations and starts beyond 4 hours of the first booked time; 6 counts surgeon-flagged returns with unanswered cases beside", () => {
  const base = { firstScheduledAt: "2026-08-10T03:30:00Z", scheduledAt: "2026-08-10T03:30:00Z" };
  assert.equal(rescheduleOf({ ...base, reschedules: [{ kind: "postponed", toStart: "2026-08-10T07:00:00Z" }] }), null, "3.5 hours is not a reschedule");
  assert.equal(rescheduleOf({ ...base, reschedules: [{ kind: "postponed", toStart: "2026-08-10T07:00:00Z" }, { kind: "postponed", toStart: "2026-08-10T08:00:00Z" }] }).kind, "postponed", "measured from the first booked time");
  assert.equal(rescheduleOf({ ...base, reschedules: [{ kind: "cancelled" }] }).kind, "cancelled");
  assert.equal(rescheduleOf({ ...base, theatreTimes: { inRoomAt: "2026-08-10T08:00:00Z" } }).kind, "started-late");
  const cases = [
    { ...base, reschedules: [{ kind: "cancelled" }] }, { ...base }, { ...base }, { ...base, firstScheduledAt: "2026-07-31T03:30:00Z" },
    { ledger: [{ at: "2026-08-12T05:00:00Z" }] },
  ];
  assert.deepEqual(rescheduleCell(cases, AUG), { numerator: 1, denominator: 4, value: 25 });
  const ops = [{ incisionAt: "2026-08-10T04:00:00Z", unplannedReturn: { value: true } }, { incisionAt: "2026-08-11T04:00:00Z", unplannedReturn: { value: false } }, { incisionAt: "2026-08-12T04:00:00Z" }, { incisionAt: "2026-07-12T04:00:00Z", unplannedReturn: { value: true } }];
  assert.deepEqual(unplannedReturnCell(ops, AUG), { numerator: 1, denominator: 3, value: 33.33, unreviewed: 1 });
});

test("R2-1 NABH 6 leaves out a case under local anaesthesia from both counts; a case with no checkup stays in and is counted beside", () => {
  const ops = [
    { id: "la", incisionAt: "2026-08-10T04:00:00Z", unplannedReturn: { value: true } },
    { id: "ga", incisionAt: "2026-08-11T04:00:00Z", unplannedReturn: { value: true } },
    { id: "spinal", incisionAt: "2026-08-12T04:00:00Z", unplannedReturn: { value: false } },
    { id: "nopac", incisionAt: "2026-08-13T04:00:00Z", unplannedReturn: { value: false } },
  ];
  const pacs = [{ caseId: "la", plan: { technique: "local-with-monitoring" } }, { caseId: "ga", plan: { technique: "general" } }, { caseId: "spinal", plan: { technique: "spinal" } }];
  const cell = computeNabhIndicators({ rows: { SurgicalCase: ops, PreAnaestheticCheckup: pacs }, unreadable: {}, windows: [AUG] }).find((i) => i.no === 6).months[0];
  assert.deepEqual([cell.numerator, cell.denominator, cell.value, cell.localAnaesthesiaExcluded, cell.techniqueNotRecorded], [1, 3, 33.33, 1, 1]);
  const without = computeNabhIndicators({ rows: { SurgicalCase: ops.filter((c) => c.id !== "la"), PreAnaestheticCheckup: pacs }, unreadable: {}, windows: [AUG] }).find((i) => i.no === 6).months[0];
  assert.deepEqual([without.numerator, without.denominator], [cell.numerator, cell.denominator], "the local anaesthesia case with a return changes neither count");
  const blocked = computeNabhIndicators({ rows: { SurgicalCase: ops }, unreadable: { PreAnaestheticCheckup: "not readable with this role" }, windows: [AUG] }).find((i) => i.no === 6);
  assert.equal(blocked.computable, false, "a technique that cannot be read is not guessed");
});

test("OPD and diagnostic waits: from arrival or a later appointment to the start, zero if seen early, missing starts counted and not averaged", () => {
  const t = (s) => Date.parse(s);
  assert.deepEqual(waitOf(t("2026-08-10T04:00:00Z"), null, t("2026-08-10T04:25:00Z")), { minutes: 25, from: "2026-08-10T04:00:00.000Z", missing: [] });
  assert.equal(waitOf(t("2026-08-10T04:00:00Z"), t("2026-08-10T04:30:00Z"), t("2026-08-10T04:20:00Z")).minutes, 0, "seen before the appointment time");
  assert.equal(waitOf(t("2026-08-10T04:40:00Z"), t("2026-08-10T04:30:00Z"), t("2026-08-10T05:00:00Z")).minutes, 20, "a late patient waits from arrival");
  assert.deepEqual(waitOf(t("2026-08-10T04:00:00Z"), null, null), { minutes: null, missing: ["start"] });
  const enc = [
    { id: "e1", class: "OPD", status: "finished", patientId: "p1", periodStart: "2026-08-10T04:00:00Z", consultStartAt: "2026-08-10T04:50:00Z" },
    { id: "e2", class: "OPD", status: "planned", patientId: "p2", periodStart: "2026-08-10T04:10:00Z", consultStartAt: null },
    { id: "e3", class: "OPD", status: "cancelled", patientId: "p3", periodStart: "2026-08-10T04:10:00Z" },
    { id: "e4", class: "IPD", status: "finished", patientId: "p4", periodStart: "2026-08-10T04:10:00Z" },
  ];
  const appts = [{ patientId: "p1", state: "arrived", startAt: "2026-08-10T04:30:00Z" }, { patientId: "p1", state: "cancelled", startAt: "2026-08-10T04:00:00Z" }];
  const rows = opdWaits(enc, appts, AUG);
  assert.deepEqual(rows.map((r) => [r.encounterId, r.appointmentAt, r.minutes, r.missing]), [["e1", "2026-08-10T04:30:00.000Z", 20, []], ["e2", null, null, ["start"]]]);
  assert.deepEqual(waitCell(rows), { numerator: 20, denominator: 1, value: 20, missing: 1 });
  const two = opdWaits(enc, [...appts, { patientId: "p1", state: "completed", startAt: "2026-08-10T09:00:00Z" }], AUG)[0];
  assert.deepEqual([two.appointmentAt, two.appointmentsThatDay, two.minutes], [null, 2, 50], "two appointments that day: none is chosen, arrival is used");
  const dx = diagnosticWaits([
    { id: "d1", setting: "outpatient", service: "imaging", patientId: "p1", arrivedAt: "2026-08-10T05:00:00Z", startedAt: "2026-08-10T05:45:00Z" },
    { id: "d2", setting: "inpatient", service: "laboratory", patientId: "p2", arrivedAt: "2026-08-10T05:00:00Z", startedAt: "2026-08-10T05:05:00Z" },
    { id: "d3", setting: "outpatient", service: "laboratory", patientId: "p3", arrivedAt: "2026-08-10T05:00:00Z" },
  ], AUG);
  assert.deepEqual(waitCell(dx), { numerator: 45, denominator: 1, value: 45, missing: 1 }, "inpatients are not NABH 23");
});

test("the OPD visit carries the ticket's consultation start, and a record written before the field existed is not a change", () => {
  const ticket = { id: "t1", ghisPatientId: "MRN-100", status: "in_consultation", registeredAt: Date.parse("2026-08-10T04:00:00Z"), consultStartAt: Date.parse("2026-08-10T04:20:00Z"), department: "Med" };
  const e = encounterFromTicket({ ticket, attendingId: "doc", tenantId: "t" });
  assert.equal(e.periodStart, "2026-08-10T04:00:00.000Z");
  assert.equal(e.consultStartAt, "2026-08-10T04:20:00.000Z");
  assert.equal(encounterFromTicket({ ticket: { ...ticket, status: "waiting", consultStartAt: 0 } }).consultStartAt, null, "sent back to the waiting hall");
  const old = { ...e }; delete old.consultStartAt;
  assert.equal(sameEncounter(old, e), true);
  assert.equal(sameEncounter({ ...e, consultStartAt: null }, e), false);
});

/* ---------------------------------------------------------------- through the router */

const META = () => { const t = new Date().toISOString(); return { meta: { recordedAt: t }, writtenBy: { id: "seed", kind: "human", at: t } }; };
const P1 = "opd-pat-mrn-100";
async function setup() {
  seedHospital();
  const cfg = await as(U.ADMIN, "/org/update", "POST", { orgId: ORG, wardsynq: { resources: [{ id: "ot-1", name: "OT 1", kind: "theatre" }], theatre: { releaseHours: 24, firstCaseGraceMinutes: 10, rescheduleReasons: [{ code: "list-overrun", label: "List overran" }] } } });
  assert.equal(cfg.__status, 200, JSON.stringify(cfg));
  await H.RECORD.append(TENANT, [{ resourceType: "Patient", id: P1, version: 1, mrn: "MRN-100", name: "Asha Rao", dob: "1970-01-01", sex: "female", ...META() }]);
}
const iso = (offsetMs) => new Date(Math.floor((Date.now() + offsetMs) / M1) * M1).toISOString();

test("POST /api/queue/ward/theatre-session, POST /ward/theatre-session-release and POST /ward/book-resource: 401, 403 for the cashier and another hospital with nothing written; a held session refuses another unit until released", async () => {
  await setup();
  const body = { orgId: ORG, theatreId: "ot-1", startAt: iso(48 * H1), minutes: 240, ownerKind: "unit", ownerId: "ortho", ownerName: "Orthopaedics" };
  assert.equal((await as(null, "/ward/theatre-session", "POST", body)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/theatre-session", "POST", body)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/theatre-session", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("TheatreSession")).length, 0, "nothing written by refused calls");
  assert.equal((await as(U.DOCTOR, "/ward/theatre-session", "POST", { ...body, theatreId: "room-9" })).error, "theatre_not_found");
  const s = await as(U.DOCTOR, "/ward/theatre-session", "POST", body);
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.equal((await as(U.DOCTOR, "/ward/theatre-session", "POST", { ...body, startAt: iso(49 * H1) })).error, "session_overlaps");
  assert.ok(auditsOf("TheatreSession").length >= 1, "the session write is audited");

  const book = { orgId: ORG, resourceId: "ot-1", startAt: iso(49 * H1), minutes: 60, purpose: "list" };
  const held = await as(U.DOCTOR, "/ward/book-resource", "POST", { ...book, sessionOwnerId: "gen-surg" });
  assert.equal(held.__status, 409); assert.equal(held.error, "session_held");
  assert.equal((await as(U.DOCTOR, "/ward/book-resource", "POST", { ...book, sessionOwnerId: "ortho" })).__status, 200, "the owner books its session");

  // A session starting within the 24 hour release rule is already released: its minutes are free to anyone.
  const soon = await as(U.DOCTOR, "/ward/theatre-session", "POST", { ...body, startAt: iso(2 * H1) });
  assert.equal(soon.__status, 200, JSON.stringify(soon));
  assert.equal((await as(U.DOCTOR, "/ward/book-resource", "POST", { ...book, startAt: iso(2 * H1), sessionOwnerId: "gen-surg" })).__status, 200);

  const rel = { orgId: ORG, sessionId: s.sessionId, reason: "Ortho list cancelled" };
  assert.equal((await as(null, "/ward/theatre-session-release", "POST", rel)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/theatre-session-release", "POST", rel)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/theatre-session-release", "POST", { ...rel, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/theatre-session-release", "POST", { ...rel, reason: "" })).error, "reason_required");
  assert.equal((await H.RECORD.history(TENANT, "TheatreSession", s.sessionId)).length, 1, "refused releases wrote nothing");
  const released = await as(U.DOCTOR, "/ward/theatre-session-release", "POST", rel);
  assert.equal(released.__status, 200, JSON.stringify(released));
  assert.equal((await as(U.DOCTOR, "/ward/book-resource", "POST", { ...book, startAt: iso(51 * H1), sessionOwnerId: "gen-surg" })).__status, 200, "released minutes are free");

  const from = iso(47 * H1), to = iso(53 * H1);
  assert.equal((await as(null, `/ward/theatre-utilisation?orgId=${ORG}&from=${from}&to=${to}`)).__status, 401);
  assert.equal((await as(U.DOCTOR, `/ward/theatre-utilisation?orgId=${ORG2}&from=${from}&to=${to}`)).__status, 403);
  for (const who of [U.CASHIER, U.HR]) { // R2-1: same hospital, a role with queue.view and no business with theatre records
    const refused = await as(who, `/ward/theatre-utilisation?orgId=${ORG}&from=${from}&to=${to}`);
    assert.equal(refused.__status, 403, who); assert.equal(refused.theatres, null, "nothing returned to " + who);
  }
  const u = await as(U.NURSE, `/ward/theatre-utilisation?orgId=${ORG}&from=${from}&to=${to}`);
  assert.equal(u.__status, 200, JSON.stringify(u));
  const t = u.theatres[0];
  assert.deepEqual([t.sessionMinutes, t.bookedMinutesInSessions, t.bookedUtilisation], [240, 120, 50]);
  assert.deepEqual([t.sessions[0].status.state, t.sessions[0].status.by, t.sessions[0].ownerBookedMinutes, t.sessions[0].releasedMinutes], ["released", "person", 60, 180]);
});

test("POST /api/queue/ward/surgery-times, /ward/surgery-reschedule and /ward/surgery-return: 401, 403 for the cashier and another hospital with nothing written; times, reason codes and the flag compute NABH 6 and 19", async () => {
  await setup();
  const booked = await as(U.DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: "MRN-100", procedure: "Knee arthroscopy", laterality: "not-applicable", theatre: "ot-1", scheduledAt: iso(-2 * H1), minutes: 60 } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  const caseId = booked.caseId;
  const v1 = (await H.RECORD.history(TENANT, "SurgicalCase", caseId)).length;

  const inRoom = { orgId: ORG, caseId, event: "in-room", at: iso(-90 * M1) };
  assert.equal((await as(null, "/ward/surgery-times", "POST", inRoom)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/surgery-times", "POST", inRoom)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, event: "out-of-room" })).code, "OUT_OF_SEQUENCE", "out before in is refused");
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, at: iso(H1) })).__status, 422, "a future time is refused");
  assert.equal((await H.RECORD.history(TENANT, "SurgicalCase", caseId)).length, v1, "nothing written by refused calls");
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", inRoom)).__status, 200);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, at: iso(-80 * M1) })).code, "ALREADY_RECORDED");
  assert.equal((await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, event: "out-of-room", at: iso(-100 * M1) })).code, "BAD_TIME");
  const out = await as(U.DOCTOR, "/ward/surgery-times", "POST", { ...inRoom, event: "out-of-room", at: iso(-30 * M1) });
  assert.equal(out.__status, 200, JSON.stringify(out));

  const ret = { orgId: ORG, caseId, value: true, reason: "Post-operative bleeding" };
  assert.equal((await as(null, "/ward/surgery-return", "POST", ret)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/surgery-return", "POST", ret)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-return", "POST", { ...ret, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-return", "POST", ret)).code, "OUT_OF_SEQUENCE", "no incision, no return to theatre");

  const resched = { orgId: ORG, caseId, kind: "postponed", toStart: iso(5 * H1), reasonCode: "list-overrun", reason: "Previous case overran" };
  assert.equal((await as(null, "/ward/surgery-reschedule", "POST", resched)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/surgery-reschedule", "POST", resched)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-reschedule", "POST", { ...resched, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-reschedule", "POST", { ...resched, reasonCode: "made-up" })).__status, 422, "only the hospital's reason codes");
  const moved = await as(U.DOCTOR, "/ward/surgery-reschedule", "POST", resched);
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  const cancelled = await as(U.DOCTOR, "/ward/surgery-reschedule", "POST", { ...resched, kind: "cancelled" });
  assert.equal(cancelled.stage, "abandoned");
  assert.equal((await as(U.DOCTOR, "/ward/surgery-reschedule", "POST", resched)).__status, 409, "a cancelled case is not moved again");

  // A case that was operated on: the surgeon's answer on return to theatre.
  const incised = { resourceType: "SurgicalCase", id: "case-op-1", version: 1, patientId: P1, procedure: "Laparotomy", laterality: "not-applicable", stage: "incised", incisionAt: iso(-3 * H1), ledger: [{ at: iso(-5 * H1), event: "booked" }], ...META() };
  await H.RECORD.append(TENANT, [incised]);
  assert.equal((await as(U.DOCTOR, "/ward/surgery-return", "POST", { ...ret, caseId: "case-op-1", reason: "" })).__status, 422);
  const flagged = await as(U.DOCTOR, "/ward/surgery-return", "POST", { ...ret, caseId: "case-op-1", indexCaseId: caseId });
  assert.equal(flagged.__status, 200, JSON.stringify(flagged));
  assert.ok(auditsOf("SurgicalCase").length >= 4, "case writes are audited");

  const cases = await recordsOf("SurgicalCase");
  const c = cases.find((x) => x.id === caseId);
  assert.equal(c.firstScheduledAt, iso(-2 * H1));
  assert.deepEqual(c.reschedules.map((m) => [m.kind, m.reasonCode]), [["postponed", "list-overrun"], ["cancelled", "list-overrun"]]);
  const nabh = computeNabhIndicators({ rows: { SurgicalCase: cases }, unreadable: {}, windows: monthWindows(Date.now(), 1, 330) });
  const cell = (no) => nabh.find((i) => i.no === no).months[0];
  if (new Date(Date.now() + IST).getUTCDate() > 1) { // both cases fall in this month except in the first hours of a month
    assert.deepEqual([cell(19).numerator, cell(19).denominator], [1, 2], "the cancelled case of the two planned");
    assert.deepEqual([cell(6).numerator, cell(6).denominator, cell(6).unreviewed], [1, 1, 0]);
  }
});

test("POST /api/queue/ward/diagnostic-arrival, /ward/diagnostic-start and GET /ward/access-times: 401, 403 for the laboratory-only role and another hospital with nothing written; waits carry their inputs", async () => {
  await setup();
  const arrive = { orgId: ORG, mrn: "MRN-100", service: "imaging", setting: "outpatient", arrivedAt: iso(-60 * M1), appointmentAt: iso(-50 * M1) };
  assert.equal((await as(null, "/ward/diagnostic-arrival", "POST", arrive)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/diagnostic-arrival", "POST", arrive)).__status, 403);
  assert.equal((await as(U.LAB, "/ward/diagnostic-arrival", "POST", arrive)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-arrival", "POST", { ...arrive, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-arrival", "POST", { ...arrive, setting: "" })).error, "setting_required");
  assert.equal((await recordsOf("DiagnosticVisit")).length, 0, "nothing written by refused calls");
  const a = await as(U.NURSE, "/ward/diagnostic-arrival", "POST", arrive);
  assert.equal(a.__status, 200, JSON.stringify(a));
  const b = await as(U.NURSE, "/ward/diagnostic-arrival", "POST", { ...arrive, service: "laboratory", appointmentAt: "" });
  assert.equal(b.__status, 200);

  const start = { orgId: ORG, visitId: a.visitId, startedAt: iso(-20 * M1) };
  assert.equal((await as(null, "/ward/diagnostic-start", "POST", start)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/diagnostic-start", "POST", start)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-start", "POST", { ...start, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-start", "POST", { ...start, startedAt: iso(-70 * M1) })).error, "bad_time", "not before arrival");
  assert.equal((await H.RECORD.history(TENANT, "DiagnosticVisit", a.visitId)).length, 1);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-start", "POST", start)).__status, 200);
  assert.equal((await as(U.NURSE, "/ward/diagnostic-start", "POST", start)).skipped, "already_started");

  await H.RECORD.append(TENANT, [
    { resourceType: "Encounter", id: "enc-opd-1", version: 1, patientId: P1, class: "OPD", status: "finished", periodStart: iso(-120 * M1), consultStartAt: iso(-75 * M1), ...META() },
    { resourceType: "Encounter", id: "enc-opd-2", version: 1, patientId: "opd-pat-mrn-200", class: "OPD", status: "planned", periodStart: iso(-30 * M1), ...META() },
  ]);
  const win = `from=${encodeURIComponent(iso(-6 * H1))}&to=${encodeURIComponent(iso(H1))}`;
  assert.equal((await as(null, `/ward/access-times?orgId=${ORG}&${win}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/access-times?orgId=${ORG2}&${win}`)).__status, 403);
  for (const who of [U.STORE, U.HR]) { // R2-1: same hospital, a role that reads neither visits nor the diagnostic counter (a cashier reads visits for billing)
    const refused = await as(who, `/ward/access-times?orgId=${ORG}&${win}`);
    assert.equal(refused.__status, 403, who); assert.equal(refused.opd, null, "no waits returned to " + who); assert.equal(refused.diagnostics, null); assert.equal(refused.opdSummary, undefined);
  }
  const r = await as(U.NURSE, `/ward/access-times?orgId=${ORG}&${win}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.opdSummary, { numerator: 45, denominator: 1, value: 45, missing: 1 });
  assert.deepEqual(r.opd.map((x) => [x.encounterId, x.arrivedAt, x.consultStartAt, x.minutes]), [["enc-opd-1", iso(-120 * M1), iso(-75 * M1), 45], ["enc-opd-2", iso(-30 * M1), null, null]]);
  assert.deepEqual(r.diagnosticsSummary, { numerator: 30, denominator: 1, value: 30, missing: 1 }, "from the appointment 50 minutes ago, later than the arrival");
  assert.deepEqual(r.openVisits.map((v) => v.visitId), [b.visitId]);
});

test("POST /api/queue/ward/book and /ward/appointment: a no-show cannot be recorded before the slot starts or after the patient arrived; arrival is timed", async () => {
  await setup();
  const later = await as(U.NURSE, "/ward/book", "POST", { orgId: ORG, patientId: P1, clinicianId: "doc-1", startAt: iso(2 * H1), minutes: 15 });
  assert.equal(later.__status, 200, JSON.stringify(later));
  const dna = await as(U.NURSE, "/ward/appointment", "POST", { orgId: ORG, appointmentId: later.appointmentId, state: "did-not-attend", reason: "Not here" });
  assert.equal(dna.__status, 409); assert.equal(dna.error, "before_slot_start");
  const past = await as(U.NURSE, "/ward/book", "POST", { orgId: ORG, patientId: P1, clinicianId: "doc-1", startAt: iso(-H1), minutes: 15 });
  const arrived = await as(U.NURSE, "/ward/appointment", "POST", { orgId: ORG, appointmentId: past.appointmentId, state: "arrived" });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived));
  assert.ok(arrived.arrivedAt);
  assert.equal((await as(U.NURSE, "/ward/appointment", "POST", { orgId: ORG, appointmentId: past.appointmentId, state: "did-not-attend", reason: "x" })).error, "patient_arrived");
  const done = await as(U.NURSE, "/ward/appointment", "POST", { orgId: ORG, appointmentId: past.appointmentId, state: "completed" });
  assert.equal(done.arrivedAt, arrived.arrivedAt); assert.ok(done.completedAt);
});
