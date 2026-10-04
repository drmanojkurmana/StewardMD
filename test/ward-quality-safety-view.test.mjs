/* P1.14 screens: the Quality and safety view (loading, failed, forbidden and not-computable are never a
 * zero; each measure opens its case list) and the incident list's stage, category and confirm action. */
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
const qs = (W, extra) => W._render({ ...W._st, view: "qualitysafety", ...extra });
const REPORT = {
  ok: true, period: { days: 30, from: "2026-08-14T00:00:00Z", to: "2026-09-13T00:00:00Z" },
  safety: { signals: 3, confirmed: 2, rejected: 1, withRootCause: 1, capasOpen: 2, capasCompleted: 4 },
  measures: [
    { id: "falls", title: "Falls per 1000 bed-days", computable: true, unit: "per 1000 bed-days", numerator: 2, denominator: 400, rate: 5, cases: [{ id: "inc-1", patientId: "pat-9" }] },
    { id: "antibiotic-dot", title: "Antibiotic days of therapy per 1000 bed-days", computable: false, reason: "antibiotic list not configured." },
    { id: "lab-tat", title: "Laboratory turnaround", computable: true, unit: "minutes", denominator: 0, median: null, mean: null, cases: [] },
  ],
};

test("quality and safety: reachable from Boards and tools; loading, failed and forbidden are distinct and never a zero", () => {
  const W = loadWard();
  assert.ok(W._render({ ...W._st, view: "list", list: [] }).includes('data-w-act="qualityview"'));
  assert.match(qs(W, { qs: { busy: true } }), /Loading measures/);
  const failed = qs(W, { qs: { ok: false } });
  assert.match(failed, /could not be loaded. Do not read this as nothing to report/);
  assert.match(qs(W, { qs: { ok: false, status: 403 } }), /analytics rights needed/);
  for (const html of [qs(W, { qs: { busy: true } }), failed]) assert.ok(!/<b>0<\/b>/.test(html));
});

test("measures show numerator, denominator and period; not computable carries its reason; cases drill down", () => {
  const W = loadWard();
  const html = qs(W, { qs: REPORT, qsDays: 30 });
  assert.match(html, /<b>5<\/b> per 1000 bed-days \(2 over 400 bed-days\)/);
  assert.match(html, /Not computable: antibiotic list not configured/);
  assert.match(html, /Laboratory turnaround<\/h4><p class="w-hint">.*No cases in this period/);
  assert.ok(html.includes('data-w-act="qsdays:90"'));
  assert.ok(html.includes('data-w-act="qscases:falls"'));
  assert.ok(!html.includes("pat-9"), "the case list is closed until asked for");
  const open = qs(W, { qs: REPORT, qsOpen: "falls" });
  assert.match(open, /inc-1 &middot; patient pat-9/);
  assert.match(html, /Signals awaiting a decision<\/b><span>3/);
  assert.match(html, /Confirmed, with a root cause recorded<\/b><span>1/);
  assert.match(html, /Corrective actions completed<\/b><span>4/);
  assert.match(qs(W, { qs: { ...REPORT, safety: null } }), /safety pipeline is not shown/);
});

test("incident list: stage and category shown, confirm offered on a signal, RCA only once confirmed", () => {
  const W = loadWard();
  const inc = (x) => ({ id: "i1", severity: "minor", what: "fell", reportedAt: "2026-09-10T00:00:00Z", capas: [], ...x });
  const view = (i) => W._render({ ...W._st, view: "incidents", incidentLog: [i], incidentHealth: { signals: 1, confirmed: 0, rejected: 0, withRootCause: 0, completedCapas: 0, total: 1, openCapas: 0, reading: "" } });
  const sig = view(inc({ state: "reported", stage: "signal", category: "fall", source: { resourceType: "CriticalResultLoop", id: "loop-1" } }));
  assert.match(sig, /<span class="w-st due">signal<\/span> <b>minor<\/b> &middot; Fall/);
  assert.ok(sig.includes('data-w-act="incidentconfirm:i1"'));
  assert.match(sig, /raised from CriticalResultLoop loop-1/);
  assert.ok(!sig.includes('data-w-act="incidentrca:i1"'));
  assert.match(sig, /1 signals &middot; 0 confirmed/);
  const conf = view(inc({ state: "triaged", stage: "confirmed", category: "fall", confirmation: { outcome: "confirmed", reason: "witnessed" } }));
  assert.ok(conf.includes('data-w-act="incidentrca:i1"'));
  assert.ok(!conf.includes('data-w-act="incidentconfirm:i1"'));
  const rej = view(inc({ state: "rejected", stage: "rejected", confirmation: { outcome: "duplicate", duplicateOf: "i0", reason: "same" } }));
  assert.match(rej, /decision: duplicate of i0 - same/);
  assert.ok(!rej.includes("incidentclose:i1") && !rej.includes("incidenttriage:i1"));
});

test("a critical result loop on the hospital board can raise a linked safety signal", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "loop-7", patientId: "p1", state: "open", reportedAt: "2026-09-13T00:00:00Z", escalation: { level: "due" } }] });
  assert.ok(html.includes('data-w-act="incidentsignal:CriticalResultLoop~loop-7"'), html.slice(0, 400));
});

/* NABH KPI 4 and 9 (owner decision 2026-10-04): the NCC MERP category on the forms, the incident row and the quality screen. */
test("NCC MERP: the filing form and the confirm form ask for the category, all nine, and a record with none says so", () => {
  const W = loadWard();
  const inc = (x) => ({ id: "i1", severity: "minor", what: "wrong rate", reportedAt: "2026-09-10T00:00:00Z", capas: [], state: "reported", stage: "signal", ...x });
  const view = (i) => W._render({ ...W._st, view: "incidents", incidentLog: [i], incidentHealth: { signals: 1, confirmed: 0, rejected: 0, withRootCause: 0, completedCapas: 0, total: 1, openCapas: 0, reading: "" } });
  const html = view(inc({ category: "medication-error", merpCategory: "D" }));
  assert.match(html, /id="wIncMerp"/, "the filing form");
  assert.match(html, /id="wIncConfMerp_i1"/, "the confirm form");
  for (const c of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) assert.ok(html.includes('<option value="' + c + '">' + c + " - "), c);
  assert.match(html, /D - An error reached the patient and required monitoring and\/or intervention to preclude harm/);
  assert.match(html, /Medication error &middot; NCC MERP D<div/);
  assert.match(html, /Keep: D - An error reached the patient and required monitoring/, "a filed category is kept unless changed");
  assert.match(view(inc({ category: "medication-error" })), /<span class="w-st due">NCC MERP uncategorised<\/span>/);
  assert.ok(!/NCC MERP/.test(view(inc({ category: "fall" })).split('id="wIncMerp"')[0].split("<li")[1] || ""), "no category line on a fall");
});

test("NCC MERP: the quality screen shows near misses and uncategorised beside the rate, and the counts by category and group", () => {
  const W = loadWard();
  const byCategory = { A: 1, B: 1, C: 2, D: 0, E: 1, F: 0, G: 0, H: 0, I: 1, uncategorised: 2 };
  const byGroup = { "no-error": 1, "error-no-harm": 3, "error-harm": 1, death: 1, uncategorised: 2 };
  const report = { ...REPORT, measures: [
    { id: "medication-errors", title: "Medication error incidents per 1000 bed-days", computable: true, unit: "per 1000 bed-days", numerator: 8, denominator: 400, rate: 20, nearMisses: 2, uncategorised: 2, cases: [] },
    { id: "medication-error-severity", title: "Medication errors by NCC MERP category", computable: true, unit: "count", numerator: 8, denominator: null, rate: null, byCategory, byGroup, nearMisses: 2, uncategorised: 2, cases: [] },
  ] };
  const html = qs(W, { qs: report });
  assert.match(html, /<b>20<\/b> per 1000 bed-days \(8 over 400 bed-days\) &middot; of which 2 near misses \(NCC MERP A and B\) &middot; 2 with no NCC MERP category/);
  assert.match(html, /8 confirmed medication errors/);
  assert.match(html, /No error \(A\)<\/b><span>1<\/span>/);
  assert.match(html, /Error, no harm \(B to D\)<\/b><span>3<\/span><small class="w-dt-times">B <b>1<\/b> &middot; C <b>2<\/b> &middot; D <b>0<\/b>/);
  assert.match(html, /Error, harm \(E to H\)<\/b><span>1<\/span>/);
  assert.match(html, /Death \(I\)<\/b><span>1<\/span>/);
  assert.match(html, /Uncategorised: filed with no NCC MERP category<\/b><span>2<\/span>/);
  // No errors in the period is said, not drawn as a table of zeros; unreadable records are not a zero either.
  const none = qs(W, { qs: { ...REPORT, measures: [{ id: "medication-error-severity", title: "x", computable: true, unit: "count", numerator: 0, byCategory: { ...byCategory, uncategorised: 0 }, byGroup, cases: [] }] } });
  assert.match(none, /No confirmed medication errors in this period/);
  assert.ok(!/w-merp/.test(none));
  const blocked = qs(W, { qs: { ...REPORT, measures: [{ id: "medication-error-severity", title: "x", computable: false, reason: "Incident records could not be read: not readable with this role", reasonCode: "records-unreadable", reasonVars: { why: "not readable with this role" } }] } });
  assert.match(blocked, /Not computable: Incident records could not be read: not readable with this role/);
});
