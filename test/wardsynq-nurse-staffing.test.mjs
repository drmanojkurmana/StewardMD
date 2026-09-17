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
const { requiredNurses, verdict, rostered, dependencyFor, draftRoster, validateStaffingNorms, normaliseInjury, SHIFT_TYPE, INJURY_TYPE } = await import("../functions/_wardsynq/nurse-staffing.js");
const { computeNabhIndicators } = await import("../functions/_wardsynq/compliance.js");

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

/* ---------------------------------------------------------------- through the router */

const IST_MIN = 330;
const hhmm = (t) => new Date(t + IST_MIN * 60000).toISOString().slice(11, 16);
const localDay = (t) => new Date(t + IST_MIN * 60000).toISOString().slice(0, 10);
const META = () => { const at = new Date().toISOString(); return { meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at } }; };
const TOOL = { id: "dep", name: "Dependency", version: "1", items: [{ key: "care", options: [{ value: "self", score: 1 }, { value: "full", score: 6 }] }], bands: [{ band: "Level 1", min: 0, max: 3, actions: ["Routine"] }, { band: "Level 2", min: 4, max: 10, actions: ["Close"] }] };

async function setup() {
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

test("GET and POST /api/queue/org/staffing-norms: 401, 403 for a nurse and another hospital with nothing saved; the admin saves the hospital's own norms", async () => {
  await setup();
  const body = { orgId: ORG, settings: NORMS };
  assert.equal((await as(null, "/org/staffing-norms", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/org/staffing-norms", "POST", body)).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/staffing-norms", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, `/org/staffing-norms?orgId=${ORG}`)).__status, 403);
  const before = await as(U.ADMIN, `/org/staffing-norms?orgId=${ORG}`);
  assert.equal(before.__status, 200); assert.deepEqual(before.settings, { dependencyToolId: null, wardTypes: {}, norms: [] }, "nothing refused was saved, and nothing is filled in by default");
  assert.deepEqual(before.tools[0].bands, ["Level 1", "Level 2"]);
  const bad = await as(U.ADMIN, "/org/staffing-norms", "POST", { orgId: ORG, settings: { ...NORMS, norms: [{ unitType: "General ward", band: "Level 3", patientsPerNurse: 2 }] } });
  assert.equal(bad.__status, 422); assert.match(bad.message, /Level 3/);
  const ok = await as(U.ADMIN, "/org/staffing-norms", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok)); assert.equal(ok.settings.norms.length, 2);
});

test("GET /api/queue/ward/nurse-staffing and POST /ward/nurse-staffing-record: 401, 403 for a cashier and another hospital, nothing written; not configured, then required against rostered and on duty with the in-charge left out; #21 computes", async () => {
  const { date } = await setup();
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

test("GET /api/queue/ward/staffing-draft and POST /roster/draft-publish: 401, 403 for a nurse and another hospital, nothing written; the draft skips a nurse on approved leave and publishing needs staff.admin", async () => {
  const { date } = await setup();
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

test("POST /api/queue/ward/staff-injury and GET /ward/staff-injuries: 401, 403 for a cashier and another hospital with nothing written; a nurse reports, the quality team reads, #30 computes", async () => {
  await setup();
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
