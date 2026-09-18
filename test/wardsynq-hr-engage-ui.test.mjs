/* test/wardsynq-hr-engage-ui.test.mjs - the screens of the gap wave: portal booking, message preferences and surveys;
 * Admin Center HR tabs (pages/hr.js) and patient engagement tabs (pages/engage.js); the Staff rota's own-records card.
 * Loading, failed and empty are distinct everywhere, a proxy sees no change buttons, and every string on these
 * screens goes through the catalog (a fake language marks every translated string).
 *
 * node --test test/wardsynq-hr-engage-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
function loadPortal() {
  const window = {};
  vm.runInNewContext(read("wardsynq/site/i18n.js"), { window });
  vm.runInNewContext(read("wardsynq/site/portal.js"), { window });
  return window.WSQPortal;
}

const OPTIONS = {
  ok: true, enabled: true, rules: { maxDaysAhead: 14, minHoursBefore: 2, cancelHoursBefore: 4, rescheduleHoursBefore: 4, maxUpcoming: 2 },
  departments: ["General medicine", "Paediatrics"], clinicians: [{ clinicianId: "dr-rao", name: "Dr Rao", department: "General medicine" }],
  slots: [{ clinicianId: "dr-rao", clinicianName: "Dr Rao", department: "General medicine", startAt: "2026-09-20T04:00:00.000Z", minutes: 15 }],
  mine: [{ appointmentId: "a1", clinicianId: "dr-rao", startAt: "2026-09-18T04:00:00.000Z", online: true, canCancel: true, canReschedule: true }, { appointmentId: "a2", clinicianId: "dr-rao", startAt: "2026-09-19T04:00:00.000Z", online: false, canCancel: false, canReschedule: false }],
};

test("portal booking: loading, failed and not offered are different; a desk booking offers no change; confirming is a second step", () => {
  const P = loadPortal();
  assert.match(P.bookingSection(null), /role="status"/);
  assert.match(P.bookingSection(false), /role="alert"/);
  assert.match(P.bookingSection({ ok: true, enabled: false }), /data-section="booking" hidden/);
  const html = P.bookingSection(OPTIONS, {});
  assert.equal((html.match(/data-act="book-cancel"/g) || []).length, 1, "only the online booking can be cancelled here");
  assert.match(html, /Booked by the hospital/);
  assert.match(html, /data-act="book-ask"/);
  assert.doesNotMatch(html, /data-act="book-confirm"/);
  const confirming = P.bookingSection(OPTIONS, { confirm: "dr-rao|2026-09-20T04:00:00.000Z" });
  assert.match(confirming, /data-act="book-confirm"/);
  assert.match(confirming, /Dr Rao/);
  assert.match(P.bookingSection({ ...OPTIONS, slots: [] }, { dept: "Paediatrics" }), /data-empty="booking"/);
});

test("portal preferences and surveys: a proxy sees and cannot change or answer; no survey is not an empty card; a link survey has its own phases", () => {
  const P = loadPortal();
  const pref = { ok: true, preference: { channels: { sms: { optedIn: true, mobile: "********3210" }, whatsapp: { optedIn: false } } } };
  assert.match(P.commSection({ ...pref, canChange: true }), /data-act="comm-out" data-ch="sms"/);
  const proxy = P.commSection({ ...pref, canChange: false });
  assert.doesNotMatch(proxy, /data-act="comm-/);
  assert.match(proxy, /Only the patient can change/);
  assert.match(P.commSection(false), /role="alert"/);
  assert.match(P.surveysSection({ ok: true, surveys: [], canAnswer: true }), /hidden/);
  const sv = { inviteId: "fbi-1", kind: "discharge", department: "Ward A", questions: [{ id: "q1", text: "How was the food?", kind: "rating5" }, { id: "q2", text: "Were you told about your medicines?", kind: "yesno" }] };
  const form = P.surveysSection({ ok: true, surveys: [sv], canAnswer: true });
  assert.equal((form.match(/name="pS0_nps"/g) || []).length, 11, "0 to 10");
  assert.match(form, /How was the food\?/);
  assert.doesNotMatch(P.surveysSection({ ok: true, surveys: [sv], canAnswer: false }), /data-act="survey-send"/);
  assert.match(P.surveyPage({ phase: "failed" }), /could not be opened/);
  assert.match(P.surveyPage({ phase: "answered" }), /already been answered/);
  assert.match(P.surveyPage({ phase: "open", survey: sv, hospital: "WSQ" }), /data-link="1"/);
});

function site(lang) {
  const s = loadSite({ lang, pages: ["hr.js", "engage.js"] });
  const ctx = { esc: s.win.WSQ.esc, ms: s.win.WSQ.ms, t: s.win.WSQ.t, tSafe: s.win.WSQ.tSafe, en: s.win.WSQ.en, state: { orgId: "org-wsq", org: { wardsynq: {} } } };
  return { W: s.win.WSQ, ctx };
}

test("HR screens: loading, failed and not staff are distinct; every visible string is translated", () => {
  const { W, ctx } = site("xx");
  const H = W._hr;
  assert.match(H.selfHtml(ctx, null), /spin/);
  assert.match(H.selfHtml(ctx, { ok: false }), /msg err/);
  assert.match(H.selfHtml(ctx, { ok: true, notStaff: true }), /not a staff member/);
  const mine = { ok: true, identity: "n1", month: "2026-09",
    attendance: { ok: true, rows: [{ date: "2026-09-01", shift: "Day", start: "08:00", end: "16:00", status: "late", flags: ["late"], clockIn: "2026-09-01T02:40:00Z", clockOut: null }], records: [] },
    credentials: { ok: false, error: "hr_read_failed" }, training: { ok: true, mine: { courses: [{ courseId: "course-bls", state: "expired", validUntil: "2026-01-01" }] }, courses: [{ id: "course-bls", name: "BLS" }], sessions: [] } };
  const html = H.selfHtml(ctx, mine);
  assert.match(html, /data-hr="self-in"/);
  assert.match(html, /msg err/, "credentials that failed to load are said to have failed, not shown as none");
  assert.deepEqual(leftovers(html, ["2026-09-01", "Day 08:00-16:00", "2026-09-01 08:10", "BLS", "2026-01-01", "0", "Could not load this. Do not read it as none."]).filter((x) => !/^\d/.test(x)), []);
  const att = H.attendanceHtml(ctx, { month: "2026-09", data: false });
  assert.match(att, /msg err/);
  assert.doesNotMatch(att, /<table/);
  const trn = H.trainingHtml(ctx, { data: { ok: true, staff: [], courses: [], sessions: [], completions: [], compliance: { hospital: { required: 0, compliant: 0, percent: null }, departments: [], people: [] } } });
  assert.match(trn, /data-hr="trn-standard"/);
  assert.deepEqual(leftovers(trn, ["0"]), []);
});

test("engagement screens: the delivery log says sent means accepted by the provider, and failed is not empty", () => {
  const { W, ctx } = site("xx");
  const E = W._engage;
  assert.match(E.logHtml(ctx, { log: null, filter: "" }), /spin/);
  assert.match(E.logHtml(ctx, { log: { ok: false, error: "record_read_failed" }, filter: "" }), /msg err/);
  const log = E.logHtml(ctx, { filter: "", log: { ok: true, messages: [{ id: "m1", type: "appointment", patientId: "pat-1", channel: "sms", to: "********3210", status: "failed", reason: "SMS_NOT_CONFIGURED", attempts: 0, dueAt: "2026-09-16T04:00:00Z" }] } });
  assert.match(log, /data-pc="retry"/);
  assert.doesNotMatch(log, /SMS_NOT_CONFIGURED/, "a reason code is shown as words");
  assert.deepEqual(leftovers(log, ["pat-1", "********3210", "0", "2026-09-16 09:30"]), []);
  const fb = E.feedbackHtml(ctx, { from: "", to: "", data: { ok: true, responses: 0, nps: null, byDepartment: [], recoveryQueue: [], recentComments: [] } });
  assert.deepEqual(leftovers(fb, ["0", "6", "1", "2"]), []);
});
