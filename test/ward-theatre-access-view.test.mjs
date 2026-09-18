/* test/ward-theatre-access-view.test.mjs - P3 theatre-opd-access screens in ward.js, rendered in a sandbox: the theatre
 * sessions and use view, the theatre times card on a case, and the waiting times card on Scheduling. Loading, failed and
 * loaded read differently; a missing time says so; utilisation shows the minutes it was divided from.
 *
 * Screens call GET /api/queue/ward/theatre-utilisation, POST /ward/theatre-session, POST /ward/theatre-session-release,
 * POST /ward/surgery-times, POST /ward/surgery-reschedule, POST /ward/surgery-return, GET /ward/access-times,
 * POST /ward/diagnostic-arrival, POST /ward/diagnostic-start.
 *
 * node --test test/ward-theatre-access-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load() {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb); vm.runInContext(WARD_SRC, sb);
  return sb.window.WARD;
}
const W = load();
const render = (s) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, ...s })));

test("theatre use: loading and failed are not an empty day; utilisation shows its minutes; missing times listed; rules not configured said so", () => {
  assert.match(render({ view: "theatreuse", theatreUse: null }), /Loading/);
  assert.match(render({ view: "theatreuse", theatreUse: false, theatreUseErr: "record_read_failed" }), /Theatre use could not be loaded/);
  const html = render({ view: "theatreuse", theatreUse: { ok: true, theatresConfigured: true, settings: { releaseHours: null, firstCaseGraceMinutes: 10, rescheduleReasons: [] },
    theatres: [{ theatreId: "ot-1", name: "OT 1", sessionMinutes: 240, bookedMinutesInSessions: 120, bookedUtilisation: 50, usedMinutesInSessions: 150, usedUtilisation: 62.5, bookedMinutesOutsideSessions: 0,
      sessions: [{ sessionId: "s1", startAt: "2026-08-10T03:30:00Z", minutes: 240, owner: { name: "Ortho" }, status: { state: "held", releasesAt: null }, bookedMinutes: 120, ownerBookedMinutes: 90, releasedMinutes: 0, usedMinutes: 150 }],
      cases: [], casesMissingTimes: [{ caseId: "c3", procedure: "Arthroscopy", scheduledAt: "2026-08-10T07:00:00Z", missing: ["outRoomAt"] }],
      firstCases: [{ day: "2026-08-10", caseId: "c1", procedure: "TKR", scheduledAt: "2026-08-10T03:30:00Z", inRoomAt: null, lateMinutes: null, onTime: null, missing: ["inRoomAt"] }], turnovers: [], turnoverMissing: [] }] } });
  assert.match(html, /50% \(120 of 240 minutes\)/);
  assert.match(html, /62\.5% \(150 of 240 minutes\)/);
  assert.match(html, /missing: outRoomAt/);
  assert.match(html, /in theatre not recorded/);
  assert.match(html, /not judged/);
  assert.match(html, /not configured: only a person releases a session/);
  assert.match(html, /data-w-act="theatrerelease:s1"/);
  assert.match(render({ view: "theatreuse", theatreUse: { ok: true, theatresConfigured: false, settings: {}, theatres: [] } }), /No theatres are configured/);
});

test("case theatre times: unrecorded times say so; reschedule offered before incision only; return question only after incision", () => {
  const base = { id: "case-1", patientId: "p", procedure: "Knee arthroscopy", laterality: "not-applicable", ledger: [] };
  const booked = render({ view: "surgerycase", surgCase: { case: { ...base, stage: "booked", scheduledAt: "2026-08-10T03:30:00Z" }, implants: [], pac: { rec: null } } });
  assert.match(booked, /Patient in theatre<\/b><span>not recorded/);
  assert.match(booked, /data-w-act="surgresched:postponed"/);
  assert.doesNotMatch(booked, /surgreturn:yes/);
  const incised = render({ view: "surgerycase", surgCase: { case: { ...base, stage: "incised", incisionAt: "2026-08-10T04:00:00Z", theatreTimes: { inRoomAt: "2026-08-10T03:40:00Z" } }, implants: [], pac: { rec: null } } });
  assert.doesNotMatch(incised, /surgresched:postponed/);
  assert.match(incised, /Not answered by the surgeon yet/);
});

test("scheduling waiting times: loading, failed, and loaded with inputs and the missing count", () => {
  assert.match(render({ view: "scheduling", scheduling: {} }), /Waiting times today<\/h3><\/div><p class="w-empty">Loading/);
  assert.match(render({ view: "scheduling", scheduling: { access: false } }), /Waiting times could not be loaded/);
  const html = render({ view: "scheduling", scheduling: { access: { ok: true, opdSummary: { numerator: 45, denominator: 1, value: 45, missing: 1 },
    opd: [{ patientId: "pat-1", arrivedAt: "2026-08-10T04:00:00Z", consultStartAt: "2026-08-10T04:45:00Z", minutes: 45 }, { patientId: "pat-2", arrivedAt: "2026-08-10T05:00:00Z", consultStartAt: null, minutes: null }],
    diagnostics: [{ visitId: "v1", patientId: "pat-3", service: "imaging", arrivedAt: "2026-08-10T05:00:00Z", startedAt: null, minutes: null }], diagnosticsSummary: { numerator: 0, denominator: 0, value: null, missing: 1 }, openVisits: [] } } });
  assert.match(html, /Average 45 minutes \(45 minutes over 1 visits\)/);
  assert.match(html, /1 missing a time, not averaged/);
  assert.match(html, /consultation not recorded/);
  assert.match(html, /data-w-act="dxstart:v1"/);
  assert.match(html, /No visit has both times yet/);
});
