/* The nurse worklist, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const v = (W, d) => W._render({ ...W._st, view: "nurseworklist", nurseWorklist: d });

test("loading, failed and an empty ward are different sentences", () => {
  const W = loadWard();
  assert.match(v(W, null), /Loading the ward/);
  assert.match(v(W, { failed: true }), /Do not read this as nothing due/);
  assert.match(v(W, { ok: true, rows: [] }), /No patients on this ward/);
});

test("overdue doses stand out, an unscorable score has no number, and a read failure is on the row", () => {
  const W = loadWard();
  const html = v(W, { ok: true, rows: [
    { patientId: "p1", patient: { name: "Asha", bed: "4", encounterId: "e1" }, overdue: 2, dueSoon: 1, news2: { total: 7, risk: "high", scorable: true }, problems: [] },
    { patientId: "p2", patient: { name: "Ravi", encounterId: "e2" }, overdue: 0, dueSoon: 0, news2: { total: null, risk: null, scorable: false }, problems: [] },
    { patientId: "p3", patient: { name: "Sita" }, overdue: null, dueSoon: null, news2: null, problems: ["medication schedule could not be read"] },
  ] });
  assert.match(html, /2 doses overdue/);
  assert.match(html, /NEWS 7 high/);
  assert.match(html, /Score: not enough observations/);
  assert.ok(!/NEWS 0/.test(html), "never a zero for a score that was not worked out");
  assert.match(html, /medication schedule could not be read/);
  assert.ok(html.includes('data-w-act="open:e1"'));
  assert.match(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"), /go: "ward:nurseworklist"/);
});

const row = (over) => ({ patientId: "p1", patient: { name: "Asha", bed: "4", encounterId: "e1" }, overdue: 0, dueSoon: 0, news2: { total: 8, risk: "high", scorable: true }, problems: [], ...over });

test("Mine / Whole ward: 'mine' shows only my patients, and none-assigned is a different sentence from an empty ward", () => {
  const W = loadWard();
  const d = { ok: true, me: "cfa:me", staff: [], rows: [
    row({ assignment: { nurseId: "cfa:me", nurseLabel: "me@h.test", shift: "Night" }, tasksOpen: 2, tasksOverdue: 1, vitals: { state: "overdue", text: "Observations every 4 h; overdue", dueAt: "2026-09-13T01:00:00Z" },
      escalation: { text: "NEWS2 8 (high). Escalation is your call; nothing has been paged." } }),
    row({ patientId: "p2", patient: { name: "Ravi", encounterId: "e2" }, assignment: { nurseId: null }, tasksOpen: 0, tasksOverdue: 0, vitals: { state: "no_frequency", text: "No observation frequency set" }, escalation: null }),
  ] };
  const whole = W._render({ ...W._st, view: "nurseworklist", nurseWorklist: d, nwScope: "ward" });
  assert.match(whole, /Ravi/); assert.match(whole, /Asha/);
  assert.match(whole, /Nurse: me@h\.test \(Night\)/);
  assert.match(whole, /1 task overdue/);
  assert.match(whole, /No observation frequency set/);
  assert.ok(!/not due/i.test(whole), "no frequency is never 'not due'");
  assert.match(whole, /Escalation is your call; nothing has been paged/);
  assert.ok(whole.includes('data-w-act="nursingpatient:p1~e1"'));
  const mine = W._render({ ...W._st, view: "nurseworklist", nurseWorklist: d, nwScope: "mine" });
  assert.match(mine, /Asha/); assert.ok(!/Ravi/.test(mine));
  const none = W._render({ ...W._st, view: "nurseworklist", nurseWorklist: { ...d, me: "cfa:other" }, nwScope: "mine" });
  assert.match(none, /No patients on this ward are assigned to you/);
});

test("a nursing piece the server could not read is not shown as zero", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "nurseworklist", nwScope: "ward", nurseWorklist: { ok: true, me: "x", staff: null, rows: [
    row({ assignment: null, tasksOpen: null, tasksOverdue: null, vitals: null, escalation: null, problems: ["nursing assignment, tasks and observation schedule could not be read"] }),
  ] } });
  assert.ok(!/0 open tasks|No nurse assigned/.test(html));
  assert.match(html, /could not be read/);
});

test("nursing panel: loading, failed and no tasks are different sentences; tasks, frequency and assignment render", () => {
  const W = loadWard();
  const p = (data, wl) => W._render({ ...W._st, view: "nursingpatient", nurseWorklist: wl || { staff: [{ identity: "cfa:n", label: "nurse@h.test", role: "nurse" }] }, nursingPanel: { patientId: "p1", encounterId: "e1", name: "Asha", data } });
  assert.match(p(null), /Loading tasks and observations/);
  assert.match(p({ failed: true }), /Do not read this as nothing due/);
  const empty = p({ ok: true, assignment: { nurseId: null }, tasks: [], vitals: { state: "no_frequency", text: "No observation frequency set" }, problems: [] });
  assert.match(empty, /No tasks for this patient/); assert.match(empty, /No nurse assigned/); assert.match(empty, /No observation frequency set/);
  assert.match(empty, /nurse@h\.test \(nurse\)/);
  const unknown = p({ ok: true, assignment: null, tasks: null, vitals: null, problems: ["tasks could not be read"] }, { staff: null });
  assert.match(unknown, /Tasks not known/); assert.match(unknown, /Assignment not known/); assert.match(unknown, /Observation schedule not known/);
  assert.match(unknown, /staff list could not be loaded/);
  assert.ok(!/No tasks for this patient/.test(unknown));
  const full = p({ ok: true, assignment: { nurseId: "cfa:n", nurseLabel: "nurse@h.test", assignedAt: "2026-09-13T00:00:00Z", version: 1 },
    tasks: [{ id: "t1", title: "Turn patient", status: "open", overdue: true, dueAt: "2026-09-13T00:00:00Z", createdBy: "cfa:n", version: 1 },
      { id: "t2", title: "Catheter care", status: "cancelled", cancelReason: "removed", dueAt: "2026-09-13T00:00:00Z", createdBy: "cfa:n", version: 2 }],
    vitals: { state: "not_due", everyHours: 4, text: "Observations every 4 h; next due", dueAt: "2026-09-13T04:00:00Z", version: 1 }, problems: [] });
  assert.match(full, /Overdue/); assert.match(full, /Cancelled: removed/); assert.match(full, /added by nurse@h\.test/);
  assert.ok(full.includes('data-w-act="ntaskact:t1~done~1"'));
  assert.ok(!full.includes("ntaskact:t2"), "a closed task has no actions");
  assert.ok(full.includes('data-w-act="nurseassign:unassign"'));
  assert.match(full, /<option value="4" selected>/);
});
