/* The ED re-triage, reassessment, procedures and referral cards, and the care plan screen, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(SRC, sb);
  return sb.window.WARD;
}
const SEL = { class: "ED", encounterId: "e1", patientId: "p1", mrn: "MRN1", acuity: 2, triagedAt: "2026-09-09T08:00:00.000Z" };
const chart = (W, extra) => W._render({ ...W._st, view: "chart", sel: SEL, ...extra });

test("ED board: loading, failed and empty are different sentences; overdue reassessments are counted and shown on the row; no interval is never 'not due'", () => {
  const W = loadWard();
  const board = (ed, err) => W._render({ ...W._st, view: "ed", ed, edErr: err || "" });
  assert.match(board(null), /Loading the ED board/);
  assert.match(board(null, "Could not reach the ED."), /Do not read this as an empty department/);
  assert.match(board({ ok: true, patients: [] }), /No patients currently in the ED/);
  const html = board({ ok: true, overdueReassessments: 1, reassessIntervalsSet: true, patients: [
    { encounterId: "e1", mrn: "A", acuity: 2, arrivedAt: "2026-09-09T08:00:00.000Z", reassessment: { state: "overdue", minutesOverdue: 12, dueAt: "2026-09-09T08:15:00.000Z" } },
    { encounterId: "e2", mrn: "B", acuity: 4, arrivedAt: "2026-09-09T08:00:00.000Z", reassessment: { state: "no-interval", text: "no reassessment interval set" } },
    { encounterId: "e3", mrn: "C", acuity: 3, arrivedAt: "2026-09-09T08:00:00.000Z", reassessment: { state: "not-known", text: "reassessment time not known: the last triage time could not be read" } },
  ] });
  assert.match(html, /1 patient is overdue for reassessment/);
  assert.match(html, /Reassessment overdue by 12 min/);
  assert.match(html, /No reassessment interval set/);
  assert.match(html, /reassessment time not known: the last triage time could not be read/);
  assert.ok(!/not due/i.test(html));
  assert.match(board({ ok: true, reassessIntervalsSet: false, patients: [{ encounterId: "e1", acuity: 2, reassessment: { state: "no-interval" } }] }), /has not set reassessment intervals/);
});

test("triage card: once triaged it keeps a history and offers a re-triage that asks for a reason; loading, failed and empty history differ", () => {
  const W = loadWard();
  assert.match(chart(W, { edRecord: null }), /Loading the triage history/);
  assert.match(chart(W, { edRecord: { failed: true } }), /Could not load the triage history or reassessment time/);
  assert.match(chart(W, { edRecord: { ok: true, triages: [], procedures: [] } }), /No triage history recorded/);
  const html = chart(W, { edRecord: { ok: true, reassessment: { state: "due", dueAt: "2026-09-09T08:15:00.000Z" }, procedures: [], triages: [
    { acuity: 2, previousAcuity: 4, retriage: true, reason: "New confusion", triagedAt: "2026-09-09T08:10:00.000Z", triagedBy: "nurse1" },
    { acuity: 4, retriage: false, triagedAt: "2026-09-09T08:00:00.000Z" },
  ] } });
  assert.match(html, /Re-triaged: 2 - Emergent<\/b> \(was 4\)/);
  assert.match(html, /Reason:<\/b> New confusion/);
  assert.match(html, /Reassessment due/);
  assert.ok(html.includes('data-w-act="retriage"') && html.includes('id="wRetriageReason"'));
  assert.match(chart(W, { sel: { ...SEL, acuity: null } }), /Not yet triaged/);
});

test("procedures card and referral: loading, failed and empty differ; a procedure shows site, performer, notes and complications; referral posts through the existing route", () => {
  const W = loadWard();
  assert.match(chart(W, { edRecord: null }), /Loading procedures/);
  assert.match(chart(W, { edRecord: { failed: true } }), /Could not load procedures. Do not read this as none done/);
  assert.match(chart(W, { edRecord: { ok: true, triages: [], procedures: [] } }), /No procedures recorded for this ED visit/);
  const html = chart(W, { edRecord: { ok: true, triages: [], procedures: [
    { name: "Chest drain", site: "Left 5th ICS", performedBy: "Dr A", performedAt: "2026-09-09T08:30:00.000Z", notes: "28Fr", complications: null },
  ] }, referrals: { ok: true, referrals: [] } });
  assert.match(html, /Chest drain<\/b> &middot; Left 5th ICS/);
  assert.match(html, /by Dr A/);
  assert.match(html, /Complications:<\/b> none recorded/);
  assert.ok(html.includes('id="wProcAt" type="datetime-local"') && html.includes('data-w-act="edprocsave"'));
  assert.match(html, /No referrals for this patient/);
  assert.ok(html.includes('data-w-act="refcreate"'));
  assert.match(chart(W, { referrals: { failed: true } }), /Could not load referrals/);
  assert.ok(SRC.includes('"/ward/ed-record?orgId="') && SRC.includes('"/ward/ed-procedure"') && SRC.includes('"/ward/referral-create"'));
});

test("care plan screen: loading, failed and no plan are different sentences; goals show progress and offer the other outcomes; review status is stated", () => {
  const W = loadWard();
  const v = (d) => W._render({ ...W._st, view: "careplan", sel: { ...SEL, class: "IPD" }, carePlan: d });
  assert.match(v(null), /Loading the care plan/);
  assert.match(v({ failed: true }), /Could not load the care plan. Do not read this as no plan/);
  assert.match(v({ ok: true, exists: false, plan: null }), /No care plan has been written for this stay yet/);
  const html = v({ ok: true, exists: true, plan: {
    title: "Recovery after fall", state: "active", reviewBy: "2020-01-01T00:00:00.000Z", review: { state: "stale", overdueDays: 3 },
    counts: { active: 1, met: 1, "not-met": 0, cancelled: 0 },
    goals: [
      { key: "mobilise", title: "Mobilise", measure: "Walks to bathroom with one assistant", state: "met", decidedAt: "2026-09-09T10:00:00.000Z", decidedBy: "nurse1" },
      { key: "oxygen", title: "Off oxygen", measure: "SpO2 94 percent on air", state: "active" },
    ] } });
  assert.match(html, /Recovery after fall/);
  assert.match(html, /Review overdue by 3 days/);
  assert.match(html, /How we will know:<\/b> Walks to bathroom with one assistant/);
  assert.ok(html.includes('data-w-act="cpprog:oxygen~met"') && html.includes('data-w-act="cpprog:oxygen~not-met"'));
  assert.ok(!html.includes('data-w-act="cpprog:mobilise~met"'), "the state a goal is already in is not offered again");
  assert.ok(html.includes('data-w-act="cpreview"') && html.includes('id="wCpGoals"'));
  assert.ok(SRC.includes('"/ward/plan?orgId="') && SRC.includes('"/ward/progress"'));
  assert.ok(!/—/.test(html));
});
