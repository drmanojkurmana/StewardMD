/* The nurse staffing cards (pages/staffing.js): not configured never reads as staffed, a missing dependency level is
 * shown, a failed load never reads as fully staffed, and the norms text round-trips. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/staffing.js"), sb);
const S = sb.window.WSQ._staffing;
const C = { esc, state: {} };
const row = (over) => ({ date: "2026-09-17", shiftId: "day", shift: "Day", start: "08:00", end: "20:00", timing: "running", inCharge: "n1", rosteredNurses: 3, onDutyNurses: 3, ...over });

test("not configured reads not configured, never met, and a failed load is not fully staffed", () => {
  const html = S.staffingHtml(C, { ok: true, rotaConfigured: true, toolFound: true, wards: [{ ward: "Ward A", shifts: [row({ requirement: { configured: false, reason: "ward_has_no_unit_type", census: 5 }, rosteredVerdict: "not_configured", onDutyVerdict: "not_configured" })] }] }, true);
  assert.match(html, /Not configured/); assert.match(html, /no unit type/);
  assert.ok(!/Met/.test(html)); assert.ok(!html.includes('data-staff="record"'), "nothing to record against with no norm");
  assert.match(S.staffingHtml(C, { ok: false, error: "census_unavailable" }), /Do not read this as fully staffed/);
});

test("a missing dependency level is listed, the requirement says at least, and short rows are marked", () => {
  const requirement = { configured: true, census: 3, required: 2, complete: false, lines: [{ band: "Level 2", patients: 2, patientsPerNurse: 2, nurses: 1 }], missing: [{ bed: "3" }], noNorm: [] };
  const html = S.staffingHtml(C, { ok: true, rotaConfigured: true, toolFound: true, wards: [{ ward: "Ward A", shifts: [row({ requirement, rosteredNurses: 1, onDutyNurses: 1, rosteredVerdict: "short", onDutyVerdict: "short" })] }] }, true);
  assert.match(html, /beds: 3/); assert.match(html, /at least/); assert.match(html, /class="warn"/); assert.match(html, /Short/);
  assert.match(html, /2 patients \/ 2 per nurse = 1/);
  assert.ok(html.includes('data-staff="record"'));
});

test("the norms text an admin types becomes the rows the server checks, and back", () => {
  const n = S.textToNorms("dep", "Ward A | General ward\nICU 1 | ICU", "General ward | * | Level 1 | 4\nICU | night | * | 0.5");
  assert.deepEqual(JSON.parse(JSON.stringify(n)), { dependencyToolId: "dep", wardTypes: { "Ward A": "General ward", "ICU 1": "ICU" }, norms: [{ unitType: "General ward", shiftId: "*", band: "Level 1", patientsPerNurse: 4 }, { unitType: "ICU", shiftId: "night", band: "*", patientsPerNurse: 0.5 }], icuUnitTypes: [] });
  assert.equal(S.normsToText(n).norms, "General ward | * | Level 1 | 4\nICU | night | * | 0.5");
  assert.equal(S.textToNorms("", "", "ICU | *").norms[0].patientsPerNurse, null, "a blank figure is sent blank for the server to refuse, never guessed");
});

test("R2-1: ICU unit types round-trip; an ended ICU shift shows both ratios' inputs or says the split was not read; the reporting year says not configured", () => {
  const n = S.textToNorms("", "ICU 1 | ICU", "ICU | * | * | 1", " ICU , HDU ");
  assert.deepEqual(JSON.parse(JSON.stringify(n.icuUnitTypes)), ["ICU", "HDU"]);
  assert.equal(S.normsToText(n).icu, "ICU, HDU");
  const rec = { occupiedBeds: 5, required: 5, rosteredNurses: 2, onDutyNurses: 2, verdict: "short", recordedAt: "2026-09-17T09:00:00Z",
    ventilation: { recorded: true, ventilated: { beds: 2, nurses: 1, unassignedBeds: 0 }, nonVentilated: { beds: 3, nurses: 1, unassignedBeds: 2 }, sharedNurses: 1 } };
  const html = S.staffingHtml(C, { ok: true, rotaConfigured: true, toolFound: true, wards: [{ ward: "ICU 1", shifts: [row({ timing: "ended", recorded: rec })] }] }, true);
  assert.match(html, /Ventilated: 1 nurses for 2 patients \(0 not assigned\)\. Not ventilated: 1 nurses for 3 patients \(2 not assigned\)\./);
  assert.match(S.ventText(C, { recorded: false }), /were not counted apart/);
  assert.equal(S.ventText(C, null), "", "a ward shift shows no split");
  assert.match(S.yearHtml(C, null), /Not configured/);
  assert.match(S.yearHtml(C, 4), /starts in month 4/);
  const norms = S.normsHtml(C, { ok: true, settings: { dependencyToolId: null, wardTypes: {}, norms: [], icuUnitTypes: ["ICU"], reportingYearStartMonth: null }, tools: [], shifts: [] });
  assert.ok(norms.includes('id="stfIcu" value="ICU"') && norms.includes('data-staff="year"'));
  assert.ok(read("wardsynq/site/pages/staffing.js").includes('c.api("/org/reporting-year"'));
});
