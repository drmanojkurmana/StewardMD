import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-hr.test.mjs - HR beyond the rota: attendance, credentials with expiry alerts and the signing rule, training.
 *
 * Pure rules, and the real routes: GET /api/queue/ward/hr-my-records, POST /api/queue/ward/hr-clock,
 * GET /api/queue/ward/hr-attendance, POST /api/queue/ward/hr-attendance-correct, POST /api/queue/ward/hr-attendance-import,
 * GET /api/queue/ward/hr-credentials, POST /api/queue/ward/hr-credential-save, POST /api/queue/ward/hr-credential-alerts,
 * POST /api/queue/ward/hr-alert-ack, GET /api/queue/ward/hr-training, POST /api/queue/ward/hr-course-save,
 * POST /api/queue/ward/hr-session-save, POST /api/queue/ward/hr-session-attendance, POST /api/queue/ward/hr-training-record.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-hr.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, CASHIER, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const A = await import("../functions/_wardsynq/hr-attendance.js");
const R = await import("../functions/_wardsynq/hr-records.js");
const { resolveClinicalActor } = await import("../functions/_wardsynq/actor.js");
const { actorDeps } = await import("../functions/_wardsynq/deps.js");

const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const Q = `?orgId=${ORG_ID}`;
const OFF = 330;
const pad = (n) => String(n).padStart(2, "0");
const local = (ms) => new Date(ms + OFF * 60000);
const hm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** A rota shift for `email` that started an hour ago and runs eight hours, seeded into the Firestore double. */
function rotaNow(email) {
  const start = local(Date.now() - 3600000), end = local(Date.now() + 7 * 3600000);
  const date = start.toISOString().slice(0, 10);
  docs.set(`q_roster_shifts/${ORG_ID}__now`, { fields: { orgId: ORG_ID, shiftId: "now", name: "Day", unit: "Ward A", start: hm(start), end: hm(end), minimum: {}, active: true }, updateTime: "t1" });
  docs.set(`q_roster_assign/a-now`, { fields: { orgId: ORG_ID, orgMonth: `${ORG_ID}|${date.slice(0, 7)}`, identity: idFor(email), date, shiftId: "now", status: "active" }, updateTime: "t1" });
  return date;
}

/* ---- pure ------------------------------------------------------------------------------------------------ */

test("shiftFor: the caller's assignment whose window holds now, from two hours before start; never someone else's", () => {
  const shifts = { d: { name: "Day", unit: "W", start: "08:00", end: "16:00" }, n: { name: "Night", unit: "W", start: "20:00", end: "08:00" } };
  const asg = [{ id: "1", identity: "me", date: "2026-09-16", shiftId: "d" }, { id: "2", identity: "other", date: "2026-09-16", shiftId: "d" }, { id: "3", identity: "me", date: "2026-09-15", shiftId: "n" }];
  const at = (hhmm, date) => Date.parse(`${date || "2026-09-16"}T${hhmm}:00Z`) - OFF * 60000;
  assert.equal(A.shiftFor(at("07:10"), OFF, shifts, asg, "me").assignmentId, "1", "inside both windows: the nearest start wins, today's day shift");
  assert.equal(A.shiftFor(at("09:00"), OFF, shifts, asg, "me").assignmentId, "1");
  assert.equal(A.shiftFor(at("05:00"), OFF, shifts, asg, "me").assignmentId, "3", "overnight shift across midnight");
  assert.equal(A.shiftFor(at("17:00"), OFF, shifts, asg, "me"), null);
  assert.equal(A.shiftFor(at("09:00"), OFF, shifts, asg, "nobody"), null);
});

test("device CSV: quoted fields, three date orders, am/pm, direction column, duplicates and unknown staff", () => {
  assert.deepEqual(A.parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n'), [["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  const utc = (s) => Date.parse(s) - OFF * 60000;
  assert.equal(A.deviceTime("2026-09-01", "08:59", "ymd", OFF), utc("2026-09-01T08:59:00Z"));
  assert.equal(A.deviceTime("01/09/2026", "08:59:30", "dmy", OFF), utc("2026-09-01T08:59:30Z"));
  assert.equal(A.deviceTime("09/01/2026", "8:59 pm", "mdy", OFF), utc("2026-09-01T20:59:00Z"));
  assert.ok(Number.isNaN(A.deviceTime("31/02/2026", "08:00", "dmy", OFF)), "an impossible date is unreadable, never rolled over");
  const members = [{ identity: "n1", employeeId: "E001" }, { identity: "n2", employeeId: "E002" }];
  const rows = A.parseCsv("code,when,dir\nE001,2026-09-01 08:00,IN\nE001,2026-09-01 08:00,IN\nE001,2026-09-01 16:05,OUT\nE002,2026-09-01 09:00,0\nE009,2026-09-01 09:00,IN\nE002,garbage,IN\nE002,2026-09-02 01:00,OUT\n");
  const p = A.pairPunches(rows, { staffColumn: 0, timeColumn: 1, directionColumn: 2, dateOrder: "ymd" }, members, OFF);
  assert.equal(p.duplicatesInFile, 1);
  assert.deepEqual(p.unknownStaff, ["E009"]);
  assert.deepEqual(p.unreadable, [7]);
  assert.equal(p.orphanOuts, 0);
  assert.equal(p.pairs.length, 2);
  assert.equal(p.pairs.find((x) => x.identity === "n1").outMs, utc("2026-09-01T16:05:00Z"));
  assert.equal(p.pairs.find((x) => x.identity === "n2").outMs, utc("2026-09-02T01:00:00Z"), "an out within 18 hours closes the in");
  const noDir = A.pairPunches(A.parseCsv("E001,2026-09-01 08:00\nE001,2026-09-02 08:00\n"), { staffColumn: 0, timeColumn: 1, hasHeader: false }, members, OFF);
  assert.deepEqual(noDir.pairs.map((x) => x.outMs), [null, null], "punches a day apart are two clock-ins without a clock-out, not one shift");
});

test("monthSummary: present, late, left early, no clock-out, absent only once a shift has ended, and unrostered attendance", () => {
  const shifts = { d: { name: "Day", unit: "W", start: "08:00", end: "16:00" } };
  const iso = (s) => new Date(Date.parse(s) - OFF * 60000).toISOString();
  const asg = ["01", "02", "03", "04", "05", "20"].map((d) => ({ id: "a" + d, identity: "me", date: `2026-09-${d}`, shiftId: "d" }));
  const att = [
    { id: "x1", identity: "me", date: "2026-09-01", clockIn: iso("2026-09-01T07:55:00Z"), clockOut: iso("2026-09-01T16:02:00Z") },
    { id: "x2", identity: "me", date: "2026-09-02", clockIn: iso("2026-09-02T08:30:00Z"), clockOut: iso("2026-09-02T16:00:00Z") },
    { id: "x3", identity: "me", date: "2026-09-03", clockIn: iso("2026-09-03T08:00:00Z"), clockOut: iso("2026-09-03T14:00:00Z") },
    { id: "x4", identity: "me", date: "2026-09-04", clockIn: iso("2026-09-04T08:00:00Z"), clockOut: null },
    { id: "x9", identity: "me", date: "2026-09-10", clockIn: iso("2026-09-10T10:00:00Z"), clockOut: iso("2026-09-10T12:00:00Z") },
    { id: "xv", identity: "me", date: "2026-09-05", clockIn: iso("2026-09-05T08:00:00Z"), clockOut: iso("2026-09-05T16:00:00Z"), voided: true },
  ];
  const s = A.monthSummary({ month: "2026-09", shifts, assignments: asg, attendance: att, off: OFF, nowMs: Date.parse(iso("2026-09-16T12:00:00Z")), graceMinutes: 10 });
  assert.deepEqual(s.rows.map((r) => r.status), ["present", "late", "left_early", "no_clock_out", "absent", "upcoming"]);
  assert.deepEqual(s.unrostered.map((u) => u.id), ["x9"]);
  assert.deepEqual(s.people.me, { rostered: 6, present: 4, late: 1, leftEarly: 1, noClockOut: 1, absent: 1, upcoming: 1, unrostered: 1 });
  const csv = A.summaryCsv(s, [{ identity: "me", displayName: "=Nurse One", employeeId: "E1" }], OFF);
  assert.match(csv, /^Staff,Employee ID,Date/);
  assert.match(csv, /'=Nurse One/, "a cell starting with = is neutralised for spreadsheets");
});

test("credentials: state, the nearest alert threshold only, the signing block, and compliance by department", () => {
  const creds = [{ id: "c1", identity: "n1", kind: "certificate", name: "BLS", validTo: "2026-09-21" }, { id: "c2", identity: "n1", kind: "registration", validTo: "2026-12-30" }, { id: "c3", identity: "n1", kind: "certificate", name: "ACLS", validTo: "2026-08-01" }];
  assert.deepEqual(R.credentialState(creds[0], "2026-09-16"), { state: "expiring", daysLeft: 5 });
  assert.equal(R.credentialState(creds[2], "2026-09-16").state, "expired");
  const due = R.dueAlerts(creds, new Set(), "2026-09-16");
  assert.deepEqual(due.map((a) => [a.credentialId, a.threshold]), [["c1", 7]], "5 days left raises the 7-day alert alone; an expired credential and one 105 days out raise none");
  assert.deepEqual(R.dueAlerts(creds, new Set([due[0].id]), "2026-09-16"), [], "once raised, never again for that expiry");
  assert.equal(R.registrationBlock(creds, ["n1"], "2026-09-16").blocked, false);
  assert.equal(R.registrationBlock(creds, ["n1"], "2027-01-01").blocked, true);
  assert.equal(R.registrationBlock([], ["n1"], "2027-01-01").blocked, false, "no registration on file is not an expired one");
  assert.equal(R.addMonths("2026-01-31", 1), "2026-02-28");
  const courses = [{ id: "course-bls", mandatory: true }, { id: "course-posh", mandatory: true, roles: ["nurse"] }, { id: "course-x", mandatory: false }];
  const members = [{ identity: "n1", role: "nurse", scope: { departments: ["dep-med"] } }, { identity: "d1", role: "doctor", scope: { departments: ["dep-med"] } }, { identity: "h1", role: "hr" }];
  const done = [{ identity: "n1", courseId: "course-bls", completedOn: "2026-01-01", validUntil: "2027-01-01" }, { identity: "n1", courseId: "course-posh", completedOn: "2024-01-01", validUntil: "2025-01-01" }, { identity: "d1", courseId: "course-bls", completedOn: "2026-02-01", validUntil: null }];
  const c = R.complianceOf(members, [{ id: "dep-med", name: "Medicine" }], courses, done, "2026-09-16");
  const med = c.departments.find((d) => d.department === "dep-med");
  assert.deepEqual([med.name, med.required, med.compliant, med.percent], ["Medicine", 3, 2, 66.7]);
  assert.deepEqual(c.hospital, { required: 4, compliant: 2, percent: 50 });
});

/* ---- routes ----------------------------------------------------------------------------------------------- */

test("NEGATIVE: no session 401, a role without the capability 403 with nothing written, another hospital 403", async () => {
  seed();
  const before = writesNow();
  assert.equal((await as(null, `/ward/hr-attendance${Q}&month=2026-09`)).__status, 401);
  assert.equal((await as(null, "/ward/hr-clock", "POST", { orgId: ORG_ID, action: "in" })).__status, 401);
  assert.equal((await as(NURSE, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, identity: idFor(NURSE), clockIn: "2026-09-01T08:00", reason: "x" })).__status, 403);
  assert.equal((await as(NURSE, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(NURSE), kind: "certificate", category: "BLS", name: "BLS", validTo: "2027-01-01" })).__status, 403);
  assert.equal((await as(CASHIER, "/ward/hr-course-save", "POST", { orgId: ORG_ID, standard: true })).__status, 403);
  assert.equal((await as(DOCTOR, `/ward/hr-training${Q}`)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, `/ward/hr-credentials${Q}`)).__status, 403, "another hospital's admin");
  assert.equal((await as(OTHER_ADMIN, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv: "a,b\n" })).__status, 403);
  assert.equal(writesNow(), before, "nothing was written by any refused call");
});

test("clock in against the rota and out; twice in is refused; the month shows it", async () => {
  seed();
  const date = rotaNow(NURSE);
  const inn = await as(NURSE, "/ward/hr-clock", "POST", { orgId: ORG_ID, action: "in", identity: idFor(HR) });
  assert.equal(inn.__status, 200, inn.__text);
  assert.equal(inn.attendance.identity, idFor(NURSE), "the identity comes from the credential, never the body");
  assert.equal(inn.attendance.shift.assignmentId, "a-now");
  assert.equal((await as(NURSE, "/ward/hr-clock", "POST", { orgId: ORG_ID, action: "in" })).error, "already_clocked_in");
  const out = await as(NURSE, "/ward/hr-clock", "POST", { orgId: ORG_ID, action: "out" });
  assert.equal(out.__status, 200); assert.ok(out.attendance.clockOut);
  assert.equal((await as(NURSE, "/ward/hr-clock", "POST", { orgId: ORG_ID, action: "out" })).error, "not_clocked_in");
  const mine = await as(NURSE, `/ward/hr-my-records${Q}`);
  assert.equal(mine.__status, 200, mine.__text);
  assert.equal(mine.attendance.ok, true);
  assert.equal(mine.attendance.rows.length, 1);
  assert.equal(mine.attendance.rows[0].attendanceId, inn.attendance.id);
  const month = await as(HR, `/ward/hr-attendance${Q}&month=${date.slice(0, 7)}&format=csv`);
  assert.equal(month.__status, 200, month.__text);
  assert.ok(month.staff.length >= 4 && month.csv.includes("Day"));
  assert.ok(H.RECORD.audit.some((a) => a.action === "hr.attendance.clock_in") && H.RECORD.audit.some((a) => a.action === "hr.attendance.clock_out"));
});

test("a supervisor adds, corrects and voids with a reason, and the record keeps what it replaced", async () => {
  seed();
  const add = await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, identity: idFor(NURSE), clockIn: "2026-09-01T08:00", clockOut: "2026-09-01T16:00", reason: "Device was down" });
  assert.equal(add.__status, 200, add.__text);
  assert.equal(add.attendance.clockIn, "2026-09-01T02:30:00.000Z", "local time at +05:30");
  assert.equal((await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, id: add.attendance.id, clockOut: "2026-09-01T15:00" })).error, "reason_required");
  assert.equal((await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, id: add.attendance.id, clockOut: "2026-09-01T07:00", reason: "typo" })).error, "out_before_in");
  const fix = await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, id: add.attendance.id, clockOut: "2026-09-01T15:00", reason: "Left at three, confirmed" });
  assert.equal(fix.__status, 200); assert.equal(fix.attendance.corrections, 2);
  const history = await H.RECORD.history(T, A.ATTENDANCE_TYPE, add.attendance.id);
  assert.equal(history.length, 2, "append-only: the first version is still there");
  assert.equal(history[1].corrections[1].before.clockOut, "2026-09-01T10:30:00.000Z");
  const voided = await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, id: add.attendance.id, void: true, reason: "Duplicate of device record" });
  assert.equal(voided.attendance.voided, true);
  assert.equal((await as(HR, "/ward/hr-attendance-correct", "POST", { orgId: ORG_ID, identity: "nobody", clockIn: "2026-09-01T08:00", reason: "x" })).error, "unknown_staff");
});

test("device import: map, preview with duplicates and unknown staff, commit only what was previewed, re-import writes nothing", async () => {
  seed();
  docs.set(`q_members/${ORG_ID}__${idFor(NURSE).replace(/[^A-Za-z0-9_-]/g, "-")}`, { fields: { orgId: ORG_ID, identity: idFor(NURSE), role: "nurse", active: true, employeeId: "E001" }, updateTime: "t1" });
  const csv = "Emp,Date,Time,State\nE001,01/09/2026,08:02,IN\nE001,01/09/2026,16:01,OUT\nE777,01/09/2026,08:00,IN\nE001,02/09/2026,07:58,IN\nE001,02/09/2026,16:10,OUT\n";
  const map = await as(HR, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv });
  assert.deepEqual([map.step, map.headers, map.rowCount], ["map", ["Emp", "Date", "Time", "State"], 5]);
  const mapping = { staffColumn: 0, dateColumn: 1, timeColumn: 2, directionColumn: 3, dateOrder: "dmy" };
  const before = writesNow();
  const preview = await as(HR, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv, mapping });
  assert.equal(preview.step, "preview"); assert.equal(preview.toWrite, 2); assert.deepEqual(preview.unknownStaff, ["E777"]);
  assert.equal(writesNow(), before, "a preview writes nothing");
  assert.equal((await as(HR, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv, mapping, commit: true, confirmCount: 3 })).error, "preview_changed");
  const done = await as(HR, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv, mapping, commit: true, confirmCount: 2 });
  assert.equal(done.__status, 200, done.__text); assert.equal(done.written, 2);
  const again = await as(HR, "/ward/hr-attendance-import", "POST", { orgId: ORG_ID, csv, mapping });
  assert.equal(again.toWrite, 0); assert.equal(again.duplicatesInStore, 2);
});

test("credentials: HR records one, alerts reach the member and HR, each acknowledges their own", async () => {
  seed();
  const today = new Date(Date.now() + OFF * 60000).toISOString().slice(0, 10);
  const soon = new Date(Date.parse(today + "T00:00:00Z") + 20 * 86400000).toISOString().slice(0, 10);
  assert.equal((await as(HR, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(NURSE), kind: "certificate", category: "BLS", name: "BLS provider" })).error, "expiry_required");
  const saved = await as(HR, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(NURSE), kind: "certificate", category: "BLS", name: "BLS provider", number: "AHA-1", validTo: soon });
  assert.equal(saved.__status, 200, saved.__text); assert.equal(saved.credential.state, "expiring");
  const run = await as(HR, "/ward/hr-credential-alerts", "POST", { orgId: ORG_ID });
  assert.equal(run.created, 1);
  assert.equal((await as(HR, "/ward/hr-credential-alerts", "POST", { orgId: ORG_ID })).created, 0);
  const mine = await as(NURSE, `/ward/hr-my-records${Q}`);
  assert.equal(mine.credentials.alerts.length, 1); assert.equal(mine.credentials.alerts[0].threshold, 30);
  assert.equal((await as(CASHIER, "/ward/hr-alert-ack", "POST", { orgId: ORG_ID, id: mine.credentials.alerts[0].id })).error, "alert_not_found", "not the cashier's alert");
  assert.equal((await as(NURSE, "/ward/hr-alert-ack", "POST", { orgId: ORG_ID, id: mine.credentials.alerts[0].id })).__status, 200);
  assert.equal((await as(NURSE, `/ward/hr-my-records${Q}`)).credentials.alerts.length, 0);
  const hr = await as(HR, `/ward/hr-credentials${Q}`);
  assert.equal(hr.alerts.length, 1, "HR still sees it until HR acknowledges");
});

test("the signing rule: off by default; on, an expired registration clears the signing credential and nothing else", async () => {
  const req = () => new Request("https://x/api/queue/ward/x", { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } });
  seed();
  await as(ADMIN, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(DOCTOR), kind: "registration", category: "State medical council", name: "TSMC", number: "44821", validTo: "2020-01-01" });
  let r = await resolveClinicalActor(req(), ENV, T, "record:write", actorDeps());
  assert.ok(r.actor.credential, "rule off: the expired registration changes nothing");
  seed({ hr: { expiredRegistrationBlocksSigning: true } });
  await as(ADMIN, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(DOCTOR), kind: "registration", category: "State medical council", name: "TSMC", number: "44821", validTo: "2020-01-01" });
  r = await resolveClinicalActor(req(), ENV, T, "record:write", actorDeps());
  assert.equal(r.actor.credential, null);
  assert.equal(r.actor.signingBlocked, "registration_expired");
  assert.equal(r.actor.tier, "execute", "the doctor still writes; only signing is refused");
  await as(ADMIN, "/ward/hr-credential-save", "POST", { orgId: ORG_ID, identity: idFor(DOCTOR), kind: "registration", category: "State medical council", name: "TSMC renewed", number: "44821-R", validTo: "2099-01-01" });
  r = await resolveClinicalActor(req(), ENV, T, "record:write", actorDeps());
  assert.ok(r.actor.credential, "a valid registration on file restores signing");
});

test("training: standard courses, a session held writes completions in the same append, compliance, a completion done elsewhere", async () => {
  seed();
  const std = await as(HR, "/ward/hr-course-save", "POST", { orgId: ORG_ID, standard: true });
  assert.equal(std.added, 6);
  assert.equal((await as(HR, "/ward/hr-course-save", "POST", { orgId: ORG_ID, standard: true })).added, 0);
  assert.equal((await as(HR, "/ward/hr-course-save", "POST", { orgId: ORG_ID, id: "course-bls", name: "Basic life support (BLS)", mandatory: true, validityMonths: 24 })).__status, 200);
  const today = new Date(Date.now() + OFF * 60000).toISOString().slice(0, 10);
  const ses = await as(HR, "/ward/hr-session-save", "POST", { orgId: ORG_ID, courseId: "course-bls", date: today, trainer: "Resus officer", invitees: [idFor(NURSE), idFor(DOCTOR)] });
  assert.equal(ses.__status, 200, ses.__text);
  assert.equal((await as(HR, "/ward/hr-session-save", "POST", { orgId: ORG_ID, courseId: "course-bls", date: today, invitees: ["stranger"] })).error, "unknown_staff");
  const held = await as(HR, "/ward/hr-session-attendance", "POST", { orgId: ORG_ID, id: ses.session.id, attendance: [{ identity: idFor(NURSE), attended: true, completed: true }, { identity: idFor(DOCTOR), attended: false, completed: true }] });
  assert.equal(held.__status, 200, held.__text);
  assert.equal(held.completions.length, 1, "absent means not completed, whatever was ticked");
  assert.ok(held.completions[0].validUntil > today);
  assert.equal((await as(HR, "/ward/hr-session-attendance", "POST", { orgId: ORG_ID, id: ses.session.id, attendance: [] })).error, "session_not_planned");
  assert.equal((await as(HR, "/ward/hr-training-record", "POST", { orgId: ORG_ID, identity: idFor(DOCTOR), courseId: "course-fire-safety", completedOn: today })).error, "evidence_required");
  assert.equal((await as(HR, "/ward/hr-training-record", "POST", { orgId: ORG_ID, identity: idFor(DOCTOR), courseId: "course-fire-safety", completedOn: today, note: "Certificate from previous employer seen" })).__status, 200);
  const all = await as(HR, `/ward/hr-training${Q}`);
  assert.equal(all.__status, 200, all.__text);
  assert.equal(all.compliance.hospital.required, 30, "five staff members times six mandatory courses");
  assert.equal(all.compliance.hospital.compliant, 2);
  const mine = await as(NURSE, `/ward/hr-my-records${Q}`);
  assert.equal(mine.training.mine.compliant, 1);
});
