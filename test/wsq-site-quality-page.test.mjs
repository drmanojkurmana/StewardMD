/* test/wsq-site-quality-page.test.mjs - the Infection control and quality screen (wardsynq/site/pages/quality.js).
 *
 * Rendered from answers shaped like GET /api/queue/ward/infection-control, /ward/antibiogram, /ward/quality-registers,
 * /ward/emergency-stock and /ward/ed-returns: loading and a failed read never look like an empty list, a case under
 * review offers only its own event's NHSN criteria, an antibiogram below the minimum shows no percentage, every word on
 * screen goes through the staff catalog (the fake "xx" language marks it) and recorded values are shown as data.
 *
 * node --test test/wsq-site-quality-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ctxOf = (env) => ({ esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en });
const IC = {
  ok: true, month: "2026-08",
  events: [{ id: "CLABSI", label: "Central line-associated bloodstream infection", device: "central-line", criteria: ["LCBI 1", "LCBI 2"], source: "NHSN ch.4" }, { id: "SSI", label: "Surgical site infection", device: null, criteria: ["Deep incisional SSI"], source: "NHSN ch.9" }],
  rates: [{ event: "CLABSI", computable: true, numerator: 1, denominator: 31, per: 1000, value: 32.26 }, { event: "SSI", computable: true, numerator: 0, denominator: 0, per: 100, value: null }],
  cases: [{ id: "h1", patientId: "p1", event: "CLABSI", dateOfEvent: "2026-08-05", status: "under-review", eligibility: { eligible: false, deviceDay: 2 }, criteriaMet: [], organisms: [], definitionSource: "NHSN ch.4" }],
  lines: [{ lineId: "l1", patientId: "p1", deviceClass: "central-line", type: "CVC", site: "Right IJ", insertedAt: "2026-08-01T05:00:00Z" }], operations: [],
  prophylaxis: [{ caseId: "c1", patientId: "p1", procedure: "Appendicectomy", incisionAt: "2026-08-10T06:00:00Z", doses: [{ drug: "Cefazolin", at: "2026-08-10T05:30:00Z", source: "eMAR", minutesBeforeIncision: 30 }], dosesInWindow: 1, review: null }],
  windowMinutes: 60, patients: { p1: { name: "Asha Rao", mrn: "MRN-100" } }, ssiDepths: ["deep-incisional"], deviceClasses: ["central-line"], unapproved: "Seed content.", denominatorNote: "Counted electronically.",
};

test("infections and prophylaxis: loading and failure are never empty; a case offers only its event's criteria and asks why when the timing does not fit", () => {
  const en = loadSite({ lang: "en", pages: ["quality.js"] }), c = ctxOf(en), Q = en.win.WSQ._quality;
  assert.match(Q.icHtml(c, null), /Loading/);
  assert.match(Q.icHtml(c, { ok: false }), /Do not read it as none/);
  const html = Q.icHtml(c, IC);
  assert.ok(html.includes('data-crit="LCBI 1"') && !html.includes('data-crit="Deep incisional SSI"'), "only the CLABSI criteria on a CLABSI case");
  assert.ok(html.includes('id="qElig-h1"'), "the eligibility reason is asked for");
  assert.match(html, /32\.26 per 1000 device-days/);
  assert.match(html, /no rate: nothing to divide by/);
  assert.match(Q.sapHtml(c, { ...IC, prophylaxis: null, prophylaxisReason: "window-not-configured" }), /prophylaxis window is not configured/);
  assert.match(Q.sapHtml(c, IC), /30 minutes before incision/);
});

test("antibiogram, stock-outs and emergency returns: below the minimum is not a percentage; the list not configured is said", () => {
  const en = loadSite({ lang: "en", pages: ["quality.js"] }), c = ctxOf(en), Q = en.win.WSQ._quality;
  const ab = Q.abgHtml(c, { ok: true, computable: true, period: { from: "2026-08-01", to: "2026-08-31" }, firstIsolates: 3, reportsUsed: 4, duplicatesExcluded: 1, minIsolates: 30,
    organisms: [{ organism: "Klebsiella pneumoniae", isolates: 3, insufficient: true, antibiotics: [] }], dot: { computable: false, reason: "not readable" }, method: "CLSI M39." });
  assert.match(ab, /Too few isolates for a percentage/);
  assert.doesNotMatch(ab, /%<\/|\d+%/);
  assert.match(Q.abgHtml(c, { ok: true, computable: false, dot: null }), /CLSI M39 recommends 30/);
  assert.match(Q.stockHtml(c, { ok: true, configured: false, medicines: [], open: [], stockOuts: [] }), /emergency medicine list is not configured/);
  const ed = Q.edHtml(c, { ok: true, edVisits: 2, returns: [{ encounterId: "e2", patientId: "p2", arrivedAt: "2026-08-03T05:00:00Z", complaint: "pain", prior: { arrivedAt: "2026-08-01T05:00:00Z", complaint: "pain" }, review: null }], patients: {} }, false);
  assert.ok(!ed.includes('data-q="edsimilar"'), "a reader without emr.treat is not offered the decision");
});

test("a translated screen leaves no English behind, and the Map offers the tile to each capability", () => {
  const xx = loadSite({ lang: "xx", pages: ["quality.js"] }), c = ctxOf(xx), Q = xx.win.WSQ._quality;
  const html = Q.icHtml(c, IC) + Q.sapHtml(c, IC);
  assert.deepEqual(leftovers(html, ["CLABSI", "SSI", "Central line-associated bloodstream infection", "Surgical site infection", "Asha Rao · MRN-100", "LCBI 1", "LCBI 2", "NHSN ch.4", "Seed content.", "Counted electronically.",
    "2026-08-05", "31", "1", "0", "CVC Right IJ 2026-08-01 05:00", "Appendicectomy 2026-08-10 06:00", "Cefazolin 2026-08-10 05:30", "30", "60", "90"]), []);
  const shell = read("wardsynq/site/shell.js");
  assert.ok(/go: "quality"[^\n]*need: \["infection.control", "quality.audit", "lab.result", "incident.report", "dept.request", "emr.view"\]/.test(shell));
  assert.ok(read("wardsynq/site/index.html").includes("/wardsynq/site/pages/quality.js?v="));
});

test("R2-1: a diagnostics safety checklist asks for the department and the auditor's statement, translated; other kinds do not", () => {
  const d = { ok: true, kinds: ["hand-hygiene", "diagnostic-safety"], summary: { "hand-hygiene": { audited: 0, compliant: 0 }, "diagnostic-safety": { audited: 1, compliant: 0 } },
    audits: [{ at: "2026-08-06T05:00:00Z", templateName: "Lab safety", department: "radiology", compliant: false }],
    templates: [{ id: "t1", name: "Lab safety", kind: "diagnostic-safety", items: [{ id: "i1", text: "Gloves worn" }] }, { id: "t2", name: "Hands", kind: "hand-hygiene", items: [{ id: "i1", text: "Before touching" }] }] };
  const en = loadSite({ lang: "en", pages: ["quality.js"] }), Q = en.win.WSQ._quality;
  const html = Q.auditsHtml(ctxOf(en), d, "t1");
  assert.ok(html.includes('id="qAuDept"') && html.includes('id="qAuOutside"'));
  assert.match(html, /Safety precautions in diagnostics \(NABH 3\)/);
  assert.match(html, /Lab safety · Radiology/);
  assert.ok(!Q.auditsHtml(ctxOf(en), d, "t2").includes('id="qAuDept"'), "a hand hygiene audit has no department");
  const xx = loadSite({ lang: "xx", pages: ["quality.js"] }), X = xx.win.WSQ._quality;
  assert.deepEqual(leftovers(X.auditsHtml(ctxOf(xx), d, "t1"), ["Lab safety", "Gloves worn", "Hands"]), []);
});
