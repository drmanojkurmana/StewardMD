/* test/wardsynq-nurse-staffing.test.mjs - P4 nursing-staffing: nurses required per ward per shift from census, the
 * hospital's dependency tool and its own staffing norms; rostered and on duty against it with the in-charge left out; a
 * draft roster a staff.admin publishes; the staff needlestick and sharps injury report; NABH #21 and #30.
 *
 * Routes (the real router, ops harness): GET and POST /api/queue/org/staffing-norms, GET /ward/nurse-staffing,
 * POST /ward/nurse-staffing-record, GET /ward/staffing-draft, POST /roster/draft-publish, POST /ward/staff-injury,
 * GET /ward/staff-injuries, GET /ward/nabh-indicators.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-nurse-staffing.test.mjs
 */
import { as, seedHospital, patchOrgConfig, H, TENANT, U, ORG, ORG2, idFor } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { requiredNurses, verdict, rostered, dependencyFor, draftRoster, validateStaffingNorms, normaliseInjury, ventilationSplit, SHIFT_TYPE, INJURY_TYPE } = await import("../functions/_wardsynq/nurse-staffing.js");
const { computeNabhIndicators, reportingYearFrom } = await import("../functions/_wardsynq/compliance.js");

const NORMS = { dependencyToolId: "dep", wardTypes: { "Ward A": "General ward" }, norms: [{ unitType: "General ward", shiftId: "*", band: "Level 1", patientsPerNurse: 4 }, { unitType: "General ward", shiftId: "*", band: "Level 2", patientsPerNurse: 2 }] };

/* ---------------------------------------------------------------- pure */

test("no norm configured reads not configured, never fully staffed; the requirement is summed and rounded up once", () => {
  const pts = [{ encounterId: "e1", band: "Level 2" }, { encounterId: "e2", band: "Level 1" }, { encounterId: "e3", band: "Level 1" }];
  const none = requiredNurses(pts, "Ward A", "day", { wardTypes: {}, norms: [] });
  assert.equal(none.configured, false); assert.equal(none.required, null);
  assert.equal(verdict(none, 10), "not_configured", "ten nurses on a ward with no norm is still not configured");
  assert.equal(verdict(requiredNurses(pts, "Ward A", "day", { ...NORMS, norms: [] }), 10), "not_configured");
  const r = requiredNurses(pts, "ward a", "day", NORMS);
  assert.equal(r.required, 1, "2/4 + 1/2 = 1.0");
  assert.deepEqual(r.lines.map((l) => [l.band, l.patients, l.nurses]).sort(), [["Level 1", 2, 0.5], ["Level 2", 1, 0.5]]);
  assert.equal(verdict(r, 1), "met"); assert.equal(verdict(r, 0), "short");
  const perShift = requiredNurses(pts, "Ward A", "night", { ...NORMS, norms: [...NORMS.norms, { unitType: "General ward", shiftId: "night", band: "Level 1", patientsPerNurse: 1 }] });
  assert.equal(perShift.required, 3, "a shift's own row wins over the every-shift row: 2/1 + 1/2 = 2.5, rounded up");
  const noTool = requiredNurses(pts, "Ward A", "day", { dependencyToolId: null, wardTypes: NORMS.wardTypes, norms: [{ unitType: "General ward", shiftId: "*", band: "*", patientsPerNurse: 6 }] });
  assert.equal(noTool.required, 1); assert.equal(noTool.complete, true);
});

test("a missing dependency level is listed and the requirement is a lower bound: short or incomplete, never met", () => {
  const r = requiredNurses([{ encounterId: "e1", band: "Level 2", bed: "1" }, { encounterId: "e2", band: null, bed: "2", why: "not_assessed" }, { encounterId: "e3", band: "Level 9" }], "Ward A", "day", NORMS);
  assert.deepEqual(r.missing, [{ encounterId: "e2", bed: "2", why: "not_assessed" }]);
  assert.deepEqual(r.noNorm, [{ band: "Level 9", patients: 1 }]);
  assert.equal(r.complete, false); assert.equal(r.required, 1);
  assert.equal(verdict(r, 5), "incomplete"); assert.equal(verdict(r, 0), "short");
});

test("the in-charge is left out of the rostered nurse count; dependency counts for the shift only inside its window", () => {
  const roles = { a: "nurse", b: "nurse", c: "doctor" };
  const r = rostered([{ identity: "a", date: "2026-09-17", shiftId: "day", inCharge: true }, { identity: "b", date: "2026-09-17", shiftId: "day" }, { identity: "c", date: "2026-09-17", shiftId: "day" }, { identity: "b", date: "2026-09-17", shiftId: "night" }], "2026-09-17", "day", (id) => roles[id]);
  assert.equal(r.inCharge, "a"); assert.deepEqual(r.nurses, ["b"]); assert.equal(r.others, 1);
  const start = Date.parse("2026-09-17T02:30:00Z"), end = Date.parse("2026-09-17T14:30:00Z");
  const as1 = [{ encounterId: "e1", toolId: "dep", band: "Level 1", assessedAt: "2026-09-16T20:00:00Z" }, { encounterId: "e1", toolId: "dep", band: null, assessedAt: "2026-09-17T01:00:00Z" }];
  assert.equal(dependencyFor(as1, "e1", "dep", start, end, null, "shift").why, "not_assessed", "yesterday's assessments do not count for today's shift with no interval");
  assert.equal(dependencyFor(as1, "e1", "dep", start, end, 2, "shift").why, "outside_bands", "within a 2 hour interval the latest counts, and it scored outside every band");
  assert.equal(dependencyFor(as1, "e1", "dep", start, end, null, "latest").assessedAt, "2026-09-17T01:00:00Z");
});

test("the draft never assigns a nurse on approved leave, a double-booked nurse or a non-nurse, and says what it could not fill", () => {
  const shifts = { day: { id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00" }, icu: { id: "icu", name: "ICU Day", unit: "ICU", start: "09:00", end: "17:00" } };
  const members = [{ identity: "n1", role: "nurse" }, { identity: "n2", role: "nurse" }, { identity: "n3", role: "nurse" }, { identity: "d1", role: "doctor" }, { identity: "n4", role: "nurse", active: false }];
  const d = draftRoster({ shifts, members, targets: [{ date: "2026-09-20", shiftId: "day", required: 3, have: 0 }],
    assignments: [{ identity: "n2", date: "2026-09-20", shiftId: "icu", status: "active" }], // no id: the draft must still see the clash
    leaves: [{ identity: "n1", from: "2026-09-19", to: "2026-09-21", status: "approved" }, { identity: "n3", from: "2026-09-20", to: "2026-09-20", status: "requested" }] });
  assert.deepEqual(d.entries, [{ identity: "n3", date: "2026-09-20", shiftId: "day" }], "n1 is on leave, n2 is on an overlapping shift, d1 is not a nurse, n4 is inactive; requested leave is not approved leave");
  assert.deepEqual(d.unfilled, [{ date: "2026-09-20", shiftId: "day", short: 2 }]);
  assert.deepEqual(draftRoster({ shifts, members, targets: [{ date: "2026-09-20", shiftId: "day", required: 1, have: 1 }], assignments: [], leaves: [] }).entries, [], "a shift already staffed gets nothing");
  const two = draftRoster({ shifts, members: [{ identity: "n1", role: "nurse" }], assignments: [], leaves: [], targets: [{ date: "2026-09-20", shiftId: "day", required: 1, have: 0 }, { date: "2026-09-20", shiftId: "icu", required: 1, have: 0 }] });
  assert.deepEqual(two.entries.map((e) => e.shiftId), ["day"], "one nurse is not drafted onto two overlapping shifts in the same draft");
});

test("norms are validated against the hospital's tool bands and rota shifts; injuries need a kind, the person and no future time", () => {
  const tools = [{ id: "dep", bands: [{ band: "Level 1" }, { band: "Level 2" }] }];
  assert.deepEqual(validateStaffingNorms(NORMS, tools, ["day"]).errors, []);
  const bad = validateStaffingNorms({ dependencyToolId: "dep", wardTypes: { "Ward A": "General ward" }, norms: [{ unitType: "General ward", shiftId: "nope", band: "Level 7", patientsPerNurse: 0 }, { unitType: "ICU", band: "*", patientsPerNurse: 1 }] }, tools, ["day"]);
  assert.equal(bad.errors.length, 4, bad.errors.join(" | "));
  assert.match(validateStaffingNorms({ dependencyToolId: "other" }, tools, []).errors[0], /not one of this hospital's risk tools/);
  const now = Date.parse("2026-09-17T10:00:00Z");
  assert.equal(normaliseInjury({ occurredAt: "2026-09-18T10:00:00Z", kind: "needlestick", injuredStaff: "n1", description: "x", sourceKnown: "yes" }, now).error, "bad_time");
  assert.equal(normaliseInjury({ occurredAt: "2026-09-17T09:00:00Z", kind: "bite", injuredStaff: "n1", description: "x", sourceKnown: "yes" }, now).error, "unknown_kind");
  assert.equal(normaliseInjury({ occurredAt: "2026-09-17T09:00:00Z", kind: "sharp", injuredStaff: "n1", description: "Scalpel cut", sourceKnown: "no" }, now).injury.kind, "sharp");
});

test("NABH #21 computes from recorded shifts (ICU and wards apart) and #30 from needlestick and sharps over average occupied beds", () => {
  const IST = 330 * 60000;
  const w = { month: "2026-08", fromMs: Date.UTC(2026, 7, 1) - IST, toMs: Date.UTC(2026, 8, 1) - IST - 1, offsetMs: IST, nowMs: Date.UTC(2026, 8, 20) };
  const rows = {
    StaffingShift: [{ recordedAt: "2026-08-02T05:00:00Z", unitType: "ICU", nursesCounted: 4, occupiedBeds: 4 }, { recordedAt: "2026-08-02T05:00:00Z", unitType: "General ward", nursesCounted: 2, occupiedBeds: 10 }, { recordedAt: "2026-07-02T05:00:00Z", unitType: "ICU", nursesCounted: 9, occupiedBeds: 1 }],
    StaffInjury: [{ kind: "needlestick", occurredAt: "2026-08-03T05:00:00Z" }, { kind: "splash", occurredAt: "2026-08-04T05:00:00Z" }, { kind: "sharp", occurredAt: "2026-08-05T05:00:00Z" }],
    Encounter: [{ class: "IPD", status: "in-progress", periodStart: "2026-07-01T00:00:00Z", periodEnd: null }, { class: "OPD", status: "finished", periodStart: "2026-08-01T00:00:00Z" }],
  };
  const out = computeNabhIndicators({ rows, unreadable: {}, windows: [w] });
  const k21 = out.find((i) => i.no === 21), k30 = out.find((i) => i.no === 30);
  assert.equal(k21.computable, true);
  assert.deepEqual([k21.months[0].numerator, k21.months[0].denominator, k21.months[0].value, k21.months[0].shiftsRecorded], [6, 14, 0.43, 2]);
  assert.equal(k21.months[0].byUnitType.ICU.value, 1); assert.equal(k21.months[0].byUnitType["General ward"].value, 0.2);
  assert.equal(k30.computable, true);
  assert.deepEqual([k30.months[0].numerator, k30.months[0].denominator, k30.months[0].value], [2, 1, 2000], "one bed occupied all month");
  const blocked = computeNabhIndicators({ rows, unreadable: { StaffInjury: "read failed" }, windows: [w] }).find((i) => i.no === 30);
  assert.equal(blocked.computable, false); assert.match(blocked.reason, /could not be read/);
});

test("R2-1 NABH #21 ICU split: ventilator lines in place at recording, on-duty nurses assigned to each group, unassigned counted beside; a shift not split says so", () => {
  const now = Date.parse("2026-08-02T05:00:00Z");
  const patients = ["e1", "e2", "e3", "e4", "e5"].map((e, k) => ({ encounterId: e, patientId: "p" + (k + 1) }));
  const lines = [
    { encounterId: "e1", patientId: "p1", deviceClass: "ventilator", insertedAt: "2026-08-01T05:00:00Z", removedAt: null },
    { patientId: "p2", deviceClass: "ventilator", insertedAt: "2026-08-01T05:00:00Z" },
    { encounterId: "e3", patientId: "p3", deviceClass: "ventilator", insertedAt: "2026-08-01T05:00:00Z", removedAt: "2026-08-02T04:00:00Z" },
    { encounterId: "e4", patientId: "p4", deviceClass: "central-line", insertedAt: "2026-08-01T05:00:00Z" },
  ];
  const asg = new Map([["e1", { nurseId: "n2" }], ["e2", { nurseId: "n2" }], ["e3", { nurseId: "n2" }], ["e4", { nurseId: "n1" }], ["e5", null]]);
  const v = ventilationSplit(patients, lines, asg, ["n2"], now);
  assert.deepEqual(v, { recorded: true, ventilated: { beds: 2, nurses: 1, unassignedBeds: 0 }, nonVentilated: { beds: 3, nurses: 1, unassignedBeds: 2 }, sharedNurses: 1 },
    "the removed line is not ventilated; n1 is not on duty, so bed e4 is unassigned");
  const IST = 330 * 60000;
  const w = { month: "2026-08", fromMs: Date.UTC(2026, 7, 1) - IST, toMs: Date.UTC(2026, 8, 1) - IST - 1, offsetMs: IST, nowMs: Date.UTC(2026, 8, 20) };
  const StaffingShift = [
    { recordedAt: "2026-08-02T05:00:00Z", unitType: "ICU", nursesCounted: 2, occupiedBeds: 5, ventilation: v },
    { recordedAt: "2026-08-03T05:00:00Z", unitType: "ICU", nursesCounted: 2, occupiedBeds: 5, ventilation: { recorded: false, reason: "read failed" } },
    { recordedAt: "2026-08-02T05:00:00Z", unitType: "General ward", nursesCounted: 2, occupiedBeds: 10, ventilation: null },
  ];
  const cell = computeNabhIndicators({ rows: { StaffingShift }, unreadable: {}, windows: [w] }).find((i) => i.no === 21).months[0];
  const icu = cell.byUnitType.ICU.ventilation;
  assert.deepEqual([icu.ventilated.value, icu.nonVentilated.value, icu.nonVentilated.unassignedBeds, icu.shiftsSplit, icu.shiftsNotSplit], [0.5, 0.33, 2, 1, 1]);
  assert.equal(cell.byUnitType["General ward"].ventilation, undefined, "a ward shift shows no split");
  assert.deepEqual([cell.numerator, cell.denominator], [6, 20], "the overall ratio is unchanged by the split");
});

test("R2-1 NABH #30 is year to date from the hospital's reporting year; with no setting the month's own rate says so", () => {
  const IST = 330 * 60000;
  const mar = { month: "2027-03", fromMs: Date.UTC(2027, 2, 1) - IST, toMs: Date.UTC(2027, 3, 1) - IST - 1, offsetMs: IST, nowMs: Date.UTC(2027, 5, 1) };
  const rows = {
    StaffInjury: [{ kind: "needlestick", occurredAt: "2026-03-20T05:00:00Z" }, { kind: "sharp", occurredAt: "2026-04-02T05:00:00Z" }, { kind: "needlestick", occurredAt: "2027-03-10T05:00:00Z" }, { kind: "needlestick", occurredAt: "2027-04-02T05:00:00Z" }],
    Encounter: [{ class: "IPD", status: "in-progress", periodStart: "2025-01-01T00:00:00Z", periodEnd: null }],
  };
  const ytd = computeNabhIndicators({ rows, unreadable: {}, windows: [mar], settings: { reportingYearStartMonth: 4 } }).find((i) => i.no === 30).months[0];
  assert.deepEqual([ytd.numerator, ytd.denominator, ytd.value, ytd.yearToDateFrom], [2, 1, 2000, "2026-04"], "April 2026 to March 2027 only");
  const month = computeNabhIndicators({ rows, unreadable: {}, windows: [mar] }).find((i) => i.no === 30).months[0];
  assert.deepEqual([month.numerator, month.value, month.reportingYearNotConfigured], [1, 1000, true]);
  assert.equal(reportingYearFrom({ month: "2027-04", offsetMs: IST }, 4).month, "2027-04", "the start month opens a new year");
  assert.equal(reportingYearFrom({ month: "2027-03", offsetMs: IST }, 1).month, "2027-01");
});

/* ---------------------------------------------------------------- through the router */

const IST_MIN = 330;
const hhmm = (t) => new Date(t + IST_MIN * 60000).toISOString().slice(11, 16);
const localDay = (t) => new Date(t + IST_MIN * 60000).toISOString().slice(0, 10);
const META = () => { const at = new Date().toISOString(); return { meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at } }; };
const TOOL = { id: "dep", name: "Dependency", version: "1", items: [{ key: "care", options: [{ value: "self", score: 1 }, { value: "full", score: 6 }] }], bands: [{ band: "Level 1", min: 0, max: 3, actions: ["Routine"] }, { band: "Level 2", min: 4, max: 10, actions: ["Close"] }] };

/* F2: the scenario is a shift that started an hour ago. Just after local midnight that hour is yesterday and the
 * shift is not today's, so every test that builds it pins the clock to the middle of a (past) hospital day. */
const MIDDAY = (() => { const d = new Date(Date.now() + IST_MIN * 60000 - 86400000).toISOString().slice(0, 10); return Date.parse(d + "T12:00:00+05:30"); })();
async function setup(t) {
  t.mock.timers.enable({ apis: ["Date"], now: MIDDAY });
  seedHospital();
  patchOrgConfig(ORG, { riskTools: [TOOL] });
  const now = Date.now(), startAt = now - 60 * 60000;
  const shift = await as(U.ADMIN, "/roster/shift", "POST", { orgId: ORG, id: "wa-day", name: "Ward A now", unit: "Ward A", start: hhmm(startAt), end: hhmm(now + 5 * 3600000), minimum: {} });
  assert.equal(shift.__status, 200, JSON.stringify(shift));
  const date = localDay(startAt);
  for (const [who, lead] of [[U.NURSE, true], [U.NURSE2, false]]) {
    const a = await as(U.ADMIN, "/roster/assign", "POST", { orgId: ORG, identity: idFor(who), shiftId: "wa-day", date, weeks: 1, inCharge: lead });
    assert.equal(a.__status, 200, JSON.stringify(a));
  }
  const at = new Date(now - 10 * 60000).toISOString();
  await H.RECORD.append(TENANT, [
    ...["1", "2", "3"].map((b) => ({ resourceType: "Encounter", id: "enc-" + b, version: 1, patientId: "opd-pat-mrn-" + b, class: "IPD", status: "in-progress", periodStart: "2026-09-01T05:00:00Z", periodEnd: null, location: { ward: "Ward A", bed: b }, ...META() })),
    { resourceType: "RiskAssessment", id: "ra-1", version: 1, patientId: "opd-pat-mrn-1", encounterId: "enc-1", toolId: "dep", band: "Level 2", total: 6, assessedAt: at, ...META() },
    { resourceType: "RiskAssessment", id: "ra-2", version: 1, patientId: "opd-pat-mrn-2", encounterId: "enc-2", toolId: "dep", band: "Level 1", total: 1, assessedAt: at, ...META() },
  ]);
  return { date };
}

test("GET and POST /api/queue/org/staffing-norms: 401, 403 for a nurse and another hospital with nothing saved; the admin saves the hospital's own norms", async (ctx) => {
  await setup(ctx);
  const body = { orgId: ORG, settings: NORMS };
  assert.equal((await as(null, "/org/staffing-norms", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/org/staffing-norms", "POST", body)).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, `/org/staffing-norms?orgId=${ORG}`)).__status, 403);
  const before = await as(U.ADMIN, `/org/staffing-norms?orgId=${ORG}`);
  assert.equal(before.__status, 200); assert.deepEqual(before.settings, { dependencyToolId: null, wardTypes: {}, norms: [], icuUnitTypes: [], reportingYearStartMonth: null }, "nothing refused was saved, and nothing is filled in by default");
  assert.deepEqual(before.tools[0].bands, ["Level 1", "Level 2"]);
  const bad = await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: { ...NORMS, norms: [{ unitType: "General ward", band: "Level 3", patientsPerNurse: 2 }] } });
  assert.equal(bad.__status, 422); assert.match(bad.message, /Level 3/);
  const ok = await as(U.ADMIN, "/org/staffing-norms", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok)); assert.equal(ok.settings.norms.length, 2);
});

test("GET /api/queue/ward/nurse-staffing and POST /ward/nurse-staffing-record: 401, 403 for a cashier and another hospital, nothing written; not configured, then required against rostered and on duty with the in-charge left out; #21 computes", async (ctx) => {
  const { date } = await setup(ctx);
  const q = `/ward/nurse-staffing?orgId=${ORG}&date=${date}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(U.CASHIER, q)).__status, 403);
  assert.equal((await as(U.NURSE, `/ward/nurse-staffing?orgId=${ORG2}&date=${date}`)).__status, 403);
  const rec = { orgId: ORG, date, shiftId: "wa-day" };
  assert.equal((await as(null, "/ward/nurse-staffing-record", "POST", rec)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/nurse-staffing-record", "POST", rec)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/nurse-staffing-record", "POST", { ...rec, orgId: ORG2 })).__status, 403);

  let v = await as(U.NURSE, q);
  assert.equal(v.__status, 200, JSON.stringify(v));
  let row = v.wards[0].shifts[0];
  assert.equal(row.timing, "running");
  assert.equal(row.requirement.configured, false); assert.equal(row.rosteredVerdict, "not_configured", "no norm is not configured, not fully staffed");
  const refused = await as(U.NURSE, "/ward/nurse-staffing-record", "POST", rec);
  assert.equal(refused.error, "not_configured");
  assert.equal((await H.RECORD.latestByType(TENANT, SHIFT_TYPE, 10)).length, 0, "nothing written by refused calls");

  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: NORMS })).__status, 200);
  v = await as(U.NURSE, q);
  row = v.wards[0].shifts[0];
  assert.equal(row.inCharge, idFor(U.NURSE));
  assert.equal(row.rosteredNurses, 1, "two nurses rostered, the in-charge not counted");
  assert.equal(row.onDutyNurses, 1, "on duty from the rota, the in-charge not counted");
  assert.equal(row.requirement.census, 3);
  assert.deepEqual(row.requirement.missing.map((m) => m.bed), ["3"], "bed 3 has no dependency level this shift and is shown as missing");
  assert.equal(row.requirement.required, 1, "1/2 + 1/4 rounded up");
  assert.equal(row.rosteredVerdict, "incomplete", "enough for the patients assessed, but not met while one is missing");

  const saved = await as(U.NURSE, "/ward/nurse-staffing-record", "POST", rec);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual([saved.record.occupiedBeds, saved.record.nursesCounted, saved.record.required, saved.record.complete], [3, 1, 1, false]);
  assert.ok((H.RECORD.audit || []).some((e) => e.action === "staffing.shift_recorded"), "audited");
  const again = await as(U.NURSE, "/ward/nurse-staffing-record", "POST", rec);
  assert.equal(again.record.version, 2, "recording again is a new version, the first kept");
  const k = await as(U.ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  assert.equal(k.__status, 200, JSON.stringify(k).slice(0, 300));
  const k21 = k.indicators.find((i) => i.no === 21);
  assert.equal(k21.computable, true, JSON.stringify(k21));
  assert.deepEqual([k21.months[0].numerator, k21.months[0].denominator, k21.months[0].value], [1, 3, 0.33]);
});

test("R2-1 POST /api/queue/ward/nurse-staffing-record on an ICU unit type: 2 ventilated and 3 other patients give both ratios through GET /ward/nabh-indicators; a ward shift records no split; a store keeper gets 403 on GET /ward/nurse-staffing", async (ctx) => {
  const { date } = await setup(ctx);
  assert.equal((await as(U.STORE, `/ward/nurse-staffing?orgId=${ORG}&date=${date}`)).__status, 403, "same hospital, a role with no business with the census");
  const ICU = { dependencyToolId: null, wardTypes: { "Ward A": "ICU" }, norms: [{ unitType: "ICU", shiftId: "*", band: "*", patientsPerNurse: 1 }], icuUnitTypes: ["ICU"] };
  const badIcu = await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: { ...ICU, icuUnitTypes: ["HDU"] } });
  assert.equal(badIcu.__status, 422); assert.match(badIcu.message, /HDU/);
  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: ICU })).__status, 200);
  const nurse2 = idFor(U.NURSE2), inserted = new Date(Date.now() - 5 * 3600000).toISOString();
  await H.RECORD.append(TENANT, [
    ...["4", "5"].map((b) => ({ resourceType: "Encounter", id: "enc-" + b, version: 1, patientId: "opd-pat-mrn-" + b, class: "ICU", status: "in-progress", periodStart: "2026-09-01T05:00:00Z", periodEnd: null, location: { ward: "Ward A", bed: b }, ...META() })),
    ...["1", "2"].map((b) => ({ resourceType: "LineRecord", id: "line-" + b, version: 1, patientId: "opd-pat-mrn-" + b, encounterId: "enc-" + b, type: "ETT", deviceClass: "ventilator", insertedAt: inserted, removedAt: null, ...META() })),
    ...["1", "2", "3"].map((b) => ({ resourceType: "NurseAssignment", id: "wsq-nassign-enc-" + b, version: 1, patientId: "opd-pat-mrn-" + b, encounterId: "enc-" + b, nurseId: nurse2, history: [], ...META() })),
    { resourceType: "NurseAssignment", id: "wsq-nassign-enc-4", version: 1, patientId: "opd-pat-mrn-4", encounterId: "enc-4", nurseId: idFor(U.NURSE), history: [], ...META() },
  ]);
  const saved = await as(U.NURSE, "/ward/nurse-staffing-record", "POST", { orgId: ORG, date, shiftId: "wa-day" });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.record.ventilation, { recorded: true, ventilated: { beds: 2, nurses: 1, unassignedBeds: 0 }, nonVentilated: { beds: 3, nurses: 1, unassignedBeds: 2 }, sharedNurses: 1 },
    "the in-charge's patient and the patient with no assignment are unassigned");
  const k = await as(U.ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  const v = k.indicators.find((i) => i.no === 21).months[0].byUnitType.ICU.ventilation;
  assert.deepEqual([v.ventilated.value, v.nonVentilated.value], [0.5, 0.33]);

  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: NORMS })).__status, 200);
  const ward = await as(U.NURSE, "/ward/nurse-staffing-record", "POST", { orgId: ORG, date, shiftId: "wa-day" });
  assert.equal(ward.__status, 200, JSON.stringify(ward)); assert.equal(ward.record.ventilation, null, "a ward shift records no split");
});

test("R2-1 POST /api/queue/org/reporting-year: 401, 403 for a nurse and another hospital, a reason required, nothing saved when refused; the admin sets April and #30 is year to date; saving the norms keeps it", async (ctx) => {
  await setup(ctx);
  const body = { orgId: ORG, month: 4, reason: "Financial year reporting" };
  assert.equal((await as(null, "/org/reporting-year", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/org/reporting-year", "POST", body)).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/reporting-year", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/reporting-year", "POST", { ...body, reason: "" })).error, "reason_required");
  assert.equal((await as(U.ADMIN, "/org/reporting-year", "POST", { ...body, month: 13 })).error, "month_invalid");
  assert.equal((await as(U.ADMIN, `/org/staffing-norms?orgId=${ORG}`)).settings.reportingYearStartMonth, null, "nothing saved by refused calls, and no default");
  let k30 = (await as(U.ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`)).indicators.find((i) => i.no === 30);
  assert.equal(k30.months[0].reportingYearNotConfigured, true);
  const ok = await as(U.ADMIN, "/org/reporting-year", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok)); assert.equal(ok.reportingYearStartMonth, 4);
  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: NORMS })).settings.reportingYearStartMonth, 4, "saving the norms keeps the reporting year");
  k30 = (await as(U.ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`)).indicators.find((i) => i.no === 30);
  const m = k30.months[0].month, y = Number(m.slice(0, 4)), mo = Number(m.slice(5));
  assert.equal(k30.months[0].yearToDateFrom, `${mo >= 4 ? y : y - 1}-04`);
});

test("GET /api/queue/ward/staffing-draft and POST /roster/draft-publish: 401, 403 for a nurse and another hospital, nothing written; the draft skips a nurse on approved leave and publishing needs staff.admin", async (ctx) => {
  const { date } = await setup(ctx);
  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: NORMS })).__status, 200);
  await H.RECORD.append(TENANT, [{ resourceType: "RiskAssessment", id: "ra-3", version: 1, patientId: "opd-pat-mrn-3", encounterId: "enc-3", toolId: "dep", band: "Level 2", total: 6, assessedAt: new Date(Date.now() - 5 * 60000).toISOString(), ...META() }]);
  const tomorrow = new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  const lv = await as(U.NURSE2, "/roster/leave-request", "POST", { orgId: ORG, from: tomorrow, to: tomorrow, reason: "Family" });
  assert.equal(lv.__status, 200, JSON.stringify(lv));
  assert.equal((await as(U.ADMIN, "/roster/leave-decide", "POST", { orgId: ORG, leaveId: lv.leave.id, approve: true })).__status, 200);

  const q = `/ward/staffing-draft?orgId=${ORG}&ward=${encodeURIComponent("Ward A")}&from=${date}&days=2`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(U.NURSE, q)).__status, 403);
  assert.equal((await as(U.ADMIN, `/ward/staffing-draft?orgId=${ORG2}&ward=Ward%20A&from=${date}`)).__status, 403);
  const d = await as(U.ADMIN, q);
  assert.equal(d.__status, 200, JSON.stringify(d));
  const t = d.targets.find((x) => x.date === tomorrow);
  assert.equal(t.required, 2, "1/2 + 1/2 + 1/4 rounded up, projected from today's census"); assert.equal(t.have, 0);
  assert.deepEqual(d.entries, [{ identity: idFor(U.NURSE), date: tomorrow, shiftId: "wa-day" }], "nurse 2 is on approved leave tomorrow and is never drafted");
  assert.deepEqual(d.unfilled, [{ date: tomorrow, shiftId: "wa-day", short: 1 }]);

  const pub = { orgId: ORG, entries: d.entries };
  assert.equal((await as(null, "/roster/draft-publish", "POST", pub)).__status, 401);
  assert.equal((await as(U.NURSE, "/roster/draft-publish", "POST", pub)).__status, 403);
  assert.equal((await as(U.ADMIN, "/roster/draft-publish", "POST", { ...pub, orgId: ORG2 })).__status, 403);
  const leaveEntry = await as(U.ADMIN, "/roster/draft-publish", "POST", { orgId: ORG, entries: [...d.entries, { identity: idFor(U.NURSE2), date: tomorrow, shiftId: "wa-day" }] });
  assert.equal(leaveEntry.error, "draft_refused", "an entry for someone on leave refuses the whole draft");
  let mine = await as(U.NURSE, `/roster/mine?orgId=${ORG}`);
  assert.equal(mine.assignments.filter((a) => a.date === tomorrow).length, 0, "nothing written by refused publishes");
  const ok = await as(U.ADMIN, "/roster/draft-publish", "POST", pub);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  mine = await as(U.NURSE, `/roster/mine?orgId=${ORG}`);
  assert.equal(mine.assignments.filter((a) => a.date === tomorrow).length, 1);
});

test("POST /api/queue/ward/staff-injury and GET /ward/staff-injuries: 401, 403 for a cashier and another hospital with nothing written; a nurse reports, the quality team reads, #30 computes", async (ctx) => {
  await setup(ctx);
  const body = { orgId: ORG, occurredAt: new Date(Date.now() - 3600000).toISOString(), kind: "needlestick", injuredStaff: "Staff 114", unit: "Ward A", device: "Insulin syringe", description: "Recapping after a dose", sourceKnown: "yes", firstAid: "Washed, reported to casualty" };
  assert.equal((await as(null, "/ward/staff-injury", "POST", body)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/staff-injury", "POST", body)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/staff-injury", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await H.RECORD.latestByType(TENANT, INJURY_TYPE, 10)).length, 0, "nothing written by refused calls");
  const q = `/ward/staff-injuries?orgId=${ORG}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(U.NURSE, q)).__status, 403);
  assert.equal((await as(U.SAFETY, `/ward/staff-injuries?orgId=${ORG2}`)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/staff-injury", "POST", { ...body, sourceKnown: "" })).error, "source_known_required");
  const r = await as(U.NURSE, "/ward/staff-injury", "POST", body);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const list = await as(U.SAFETY, q);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.reports.length, 1); assert.equal(list.needlestickOrSharp, 1); assert.equal(list.reports[0].reportedBy, idFor(U.NURSE));
  assert.ok((H.RECORD.audit || []).some((e) => e.action === "staffing.injury_reported" && !JSON.stringify(e).includes("Staff 114")), "audited, without the person's name");
  const k = await as(U.ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  const k30 = k.indicators.find((i) => i.no === 30);
  assert.equal(k30.computable, true, JSON.stringify(k30));
  assert.equal(k30.months[0].numerator, 1); assert.ok(k30.months[0].denominator > 0, "three beds occupied this month");
});
