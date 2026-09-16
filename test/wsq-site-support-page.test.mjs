/* The support-services screens (wardsynq/site/pages/support.js): loading, failed and empty read differently on
 * every board; NBM, unread allergies, a failed load and a medico-legal release are loud; buttons only where the
 * server would allow the act; the Map tiles are gated on each service's capability. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/support.js"), sb);
const S = sb.window.WSQ._support;
const C = { esc, state: {} };

test("meal board: loading, failed and no patients are three different screens", () => {
  assert.match(S.mealBoardHtml(C, null), /Loading the meal round/);
  const f = S.mealBoardHtml(C, { ok: false, detail: "refused" });
  assert.match(f, /Do not read this as none/); assert.ok(!/No admitted patients/.test(f));
  assert.match(S.mealBoardHtml(C, { ok: true, rows: [] }), /No admitted patients/);
});

test("meal board: NBM and no order are flagged and offer no tray; unread allergies are not 'none'; a changed order is marked", () => {
  const rows = [
    { encounterId: "e1", name: "A", ward: "Medical A", bed: "1", serve: { state: "nbm", reason: "Laparotomy" }, nbmNow: true, allergies: null },
    { encounterId: "e2", name: "B", ward: "Medical A", bed: "2", serve: { state: "no-diet" }, allergies: [] },
    { encounterId: "e3", name: "C", ward: "Medical A", bed: "3", serve: { state: "diet", types: ["soft"] }, allergies: [{ substance: "peanut" }], changedSinceLastRound: true,
      prepared: { at: "x" }, preparedAgainstOldOrder: true },
  ];
  const html = S.mealBoardHtml(C, { ok: true, rows });
  assert.match(html, /NIL BY MOUTH/); assert.match(html, /No diet order: ask the ward/);
  assert.match(html, /Allergies could not be read/); assert.match(html, /None recorded/); assert.match(html, /peanut/);
  assert.match(html, /Changed since the last round/); assert.match(html, /Prepared against an older order: prepare again/);
  assert.ok(!html.includes('data-id="e1"') && !html.includes('data-id="e2"'), "no tray button for NBM or no order");
  assert.ok(html.includes('data-mark="prepared" data-id="e3"') && !html.includes('data-mark="delivered" data-id="e3"'), "a stale tray is prepared again, not delivered");
});

test("CSSD: a failed load is shown recalled and a stored set offers issue; the board failing never reads as empty", () => {
  assert.match(S.cssdHtml(C, { ok: false }), /Do not read this as none/);
  const b = { ok: true, sets: [{ id: "s1", name: "Lap set", items: [{ name: "Forceps", count: 2 }] }], cases: [{ caseId: "k1", procedure: "Laparotomy", laterality: "none", bookedAt: "2026-09-16" }], expiring: [],
    loads: [{ id: "l1", sterilizer: "A1", loadNumber: "9", programme: "134", temperatureC: 134, holdMinutes: 4, state: "failed", chemicalIndicator: "pass", biologicalIndicator: "fail" }],
    cycles: [{ id: "c1", setName: "Lap set", state: "stored", stored: { expiresAt: "2026-10-01T00:00:00Z" }, received: { from: "OT 1" } }, { id: "c2", setName: "Lap set", state: "issued", recalled: { loadId: "l1" }, issued: { to: "OT 2" }, received: { from: "OT 2" } }] };
  const html = S.cssdHtml(C, b);
  assert.match(html, /Failed, recalled/); assert.match(html, /Recalled with its load/);
  assert.ok(html.includes('data-step="issue"') && html.includes("Laparotomy"));
  assert.ok(!html.includes('data-k="bi"'), "a failed load offers no further result");
});

test("housekeeping: inspection only for an inspector, never on their own task; failed and empty differ", () => {
  const tasks = [{ id: "t1", kind: "bed-clean", origin: "bed", state: "finished", wardName: "Medical A", bedName: "4", mine: false }, { id: "t2", kind: "spill", origin: "manual", state: "finished", location: "Corridor", mine: true }];
  const inspector = S.hkBoardHtml(C, { ok: true, canInspect: true, tasks });
  assert.ok(inspector.includes('data-step="pass" data-i="0"') && !inspector.includes('data-step="pass" data-i="1"'));
  assert.ok(!S.hkBoardHtml(C, { ok: true, canInspect: false, tasks }).includes('data-step="pass"'));
  assert.match(S.hkBoardHtml(C, { ok: false }), /Do not read this as none/);
  assert.match(S.hkBoardHtml(C, { ok: true, tasks: [] }), /Nothing waiting to be cleaned/);
  assert.match(S.hkReportHtml(C, { ok: true, inspected: 0, byKind: [], byWard: [] }), /No figure is shown/);
});

test("ambulance: an unfit vehicle is not offered for dispatch and expiries are named", () => {
  const b = { ok: true, patients: {}, closed: [], open: [{ id: "tr1", kind: "emergency-call", state: "requested", pickup: "Highway", drop: "ED", priority: "emergency", times: { call: "2026-09-16T10:00:00Z" } }],
    vehicles: [{ id: "v1", registration: "TS09AB0001", vehicleClass: "BLS", fitness: { ok: false, expired: ["fitnessExpiry"], dueSoon: [] } }, { id: "v2", registration: "TS09AB0002", vehicleClass: "ALS", fitness: { ok: true, expired: [], dueSoon: ["insuranceExpiry"] } }] };
  const html = S.transportHtml(C, b, { ok: false });
  assert.ok(!html.includes('<option value="v1"') && html.includes('<option value="v2"'));
  assert.match(html, /Expired: fitness certificate/); assert.match(html, /Due within 30 days: insurance/);
  assert.match(html, /The rota could not be read/);
});

test("mortuary: MLC status is shown, and the release form asks who confirmed a case with no MLC flag", () => {
  const b = { ok: true, awaiting: [], released: [], chambers: [{ chamber: "C1", caseId: "m1" }, { chamber: "C2", caseId: null }],
    held: [{ id: "m1", name: "X", mrn: "M1", chamber: "C1", mlc: { flag: null }, postMortem: { required: "undecided" }, belongings: [], releaseNeeds: ["mlc_status_confirmed", "post_mortem_decision"] }] };
  const html = S.mortuaryHtml(C, b, { release: "m1" });
  assert.match(html, /Medico-legal status not recorded/);
  assert.match(html, /who confirmed this is not a medico-legal case/);
  assert.ok(html.includes('id="mrMlcBy"'));
  assert.match(S.refusalHtml(C, { ok: false, missing: ["police_noc"] }), /the police no-objection certificate/);
  assert.match(S.mortuaryHtml(C, { ok: false }, {}), /Do not read this as none/);
});

test("the Map: each support tile is gated on its own capability, and a translated screen leaves no English behind", () => {
  const { win, st } = loadSite({ lang: "xx", pages: ["support.js"] });
  st.org = { id: "o", name: "H", mode: "wardsynq" }; st.orgId = "o"; st.who = { role: "kitchen", caps: ["queue.view", "diet.kitchen"] };
  const shell = read("wardsynq/site/shell.js");
  for (const [go, need] of [["diet", '["diet.order", "diet.kitchen", "emr.treat"]'], ["cssd", '"cssd.process"'], ["housekeeping", '["housekeeping.task", "housekeeping.inspect"]'], ["transport", '"transport.dispatch"'], ["mortuary", '"mortuary.manage"']]) {
    assert.ok(new RegExp('go: "' + go + '"[^\\n]*need: ' + need.replace(/[[\]]/g, "\\$&")).test(shell), go);
  }
  assert.ok(read("wardsynq/site/index.html").includes("/wardsynq/site/pages/support.js?v="));
  const c = { esc, state: st, t: (k, v, en) => win.WSQ.t(k, v, en), tSafe: (k, v, en) => win.WSQ.tSafe(k, v, en), en: (h) => h };
  const html = S.mealBoardHtml(c, { ok: true, rows: [{ encounterId: "e1", name: "Ravi", mrn: "MRN1", ward: "Medical A", bed: "1", serve: { state: "nbm", reason: "Laparotomy" }, nbmNow: true, allergies: [] }] });
  assert.deepEqual(leftovers(html, ["Ravi", "MRN1", "Medical A 1", "Laparotomy"]), []);
});
