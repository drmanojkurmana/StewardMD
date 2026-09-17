/* test/ward-livefix-site.test.mjs - ward.js fixes from the live test of 2026-09-15 (docs/wardsynq/LIVE_TEST_2026-09-15.md).
 * Pure _render, no DOM or network. The browser behaviour (scroll, focus, address) is in test/run-ward-livefix-site-ui.mjs.
 *
 *   LT-02  the admit panel is drawn under the picked bed's ward, not after every ward
 *   LT-04  a ward nobody covers tells an admin what to set up, with a way to the rota
 *   LT-16  a failed pathways read is shown as failed, never as "no pathways"
 *   LT-38  reports are labelled rows and tables, not a dump of keys and internal ids
 *
 * node --test test/ward-livefix-site.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load(wsq) {
  const win = wsq ? { WSQ: wsq } : {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "", hash: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}
const base = { orgId: "org-wsq", ward: "", patients: [], view: "list", sel: null, problems: [], due: [], dueAt: "", busy: false, err: "", note: "", refusal: null, loaded: true };

test("LT-02 bed board: the admit panel follows the picked bed's own ward, before the next ward", () => {
  const wards = ["Cardiac", "Gastro", "Maternity"].map((w, i) => ({ ward: w, bedsKnown: true, occupied: [], free: [String(i + 1) + "A", String(i + 1) + "B"], unplaced: [] }));
  const html = load()._render(Object.assign({}, base, { view: "board", board: { ok: true, wards }, admitTarget: { ward: "Cardiac", bed: "1A" } }));
  const panel = html.indexOf('id="wAdmitPanel"'), cardiac = html.indexOf("pickbed:Cardiac|1B"), gastro = html.indexOf("pickbed:Gastro|2A");
  assert.ok(panel > 0, "the panel is drawn");
  assert.ok(cardiac < panel && panel < gastro, "under Cardiac, above Gastro: " + [cardiac, panel, gastro]);
  assert.equal(html.split('id="wAdmitPanel"').length, 2, "drawn once");
  // A picked bed in a ward the department filter hides still gets its panel, at the end.
  const hidden = load()._render(Object.assign({}, base, { view: "board", board: { ok: true, wards: wards.map((w, i) => Object.assign({}, w, { department: i ? "Other" : "Heart" })) }, boardDept: "Other", admitTarget: { ward: "Cardiac", bed: "1A" } }));
  assert.equal(hidden.split('id="wAdmitPanel"').length, 2);
  // Transferring never shows the admit panel.
  const moving = load()._render(Object.assign({}, base, { view: "board", board: { ok: true, wards }, admitTarget: { ward: "Cardiac", bed: "1A" }, transferPending: true, sel: { encounterId: "e1", name: "P" } }));
  assert.ok(!moving.includes('id="wAdmitPanel"'));
});

test("LT-03 bed board: one bed order across occupied and free beds, and the MRN under a name", () => {
  const html = load()._render(Object.assign({}, base, { view: "board", board: { ok: true, wards: [
    { ward: "CAR", bedsKnown: true, occupied: [{ encounterId: "e2", bed: "CAR-02", name: "Demo Arjun Synthia", mrn: "SMD-DEMO-00022" }, { encounterId: "e10", bed: "CAR-10", name: "Demo Omar", mrn: "SMD-DEMO-00082" }], free: ["CAR-03", "CAR-01", "CAR-09"], unplaced: [] },
  ] } }));
  const order = [...html.matchAll(/<b>(CAR-\d+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["CAR-01", "CAR-02", "CAR-03", "CAR-09", "CAR-10"]);
  assert.match(html, /Demo Arjun Synthia<\/span><span>SMD-DEMO-00022<\/span>/);
});

test("LT-39 / LT-05 / LT-07: no capitalised-every-word buttons or scores; twin headings and rows read cleanly", () => {
  const css = readFileSync(new URL("../ward.css", import.meta.url), "utf8");
  assert.ok(!/\.w-btn\.tiny \{[^}]*text-transform: capitalize/.test(css), "a tiny button's label is shown as written");
  assert.ok(!/\.w-news2 span \{[^}]*text-transform: capitalize/.test(css), "a score's sentence is shown as written");
  assert.ok(!/twinSectionCard\(wTH\(/.test(SRC), "icon names are never translated text");
  const ok = (data) => ({ status: "ok", freshness: "live", generatedAt: "2026-09-15T10:00:00.000Z", data });
  const snap = { generatedAt: "2026-09-15T10:00:00.000Z", sectionsOk: 2, sectionsTotal: 2, notBuilt: {}, sections: {
    flow: ok({ flow: { beds: { occupied: 83 }, ed: { arrivals: 1 }, dischargeCandidates: 2, drill: {} } }),
    otUtilisation: ok({ theatresConfigured: 2, overallUtilisation: 0, perTheatre: [{ name: "Theatre 1", utilisation: 0, bookedMinutes: 0 }] }),
  } };
  const html = load()._render(Object.assign({}, base, { view: "twin", twin: { loaded: true, snapshot: snap } }));
  assert.match(html, /<h3>Flow and capacity<\/h3>/);
  assert.ok(!html.includes("&amp;amp;"), "no entity shown as text");
  assert.match(html, /<b>Theatre 1<\/b> <span>0%/, "a theatre's name and its figure are apart");
  assert.ok(!html.includes("(detail not available)"));
});

const cover = (total, shiftsDefined) => ({ ok: true, shiftsDefined, wards: [{ ward: "Medical A", counts: { nurse: total, resident: 0, consultant: 0 }, total }, { ward: "Surgical B", counts: { nurse: 0, resident: 0, consultant: 0 }, total: 0 }] });

test("LT-04 ward home: an admin whose wards nobody covers is told what to set up, with a way to the rota", () => {
  const admin = { can: (c) => c === "staff.admin" };
  const noShifts = load(admin)._render(Object.assign({}, base, { alertCover: cover(0, 0) }));
  assert.match(noShifts, /The staff rota has no shifts\. In Staff rota, define a shift for each ward/);
  assert.match(noShifts, /data-w-act="openrota"/);
  const unassigned = load(admin)._render(Object.assign({}, base, { alertCover: cover(1, 3) }));
  assert.match(unassigned, /Nobody is assigned to a shift running now in 1 ward\(s\)/);
  // Not for a role that cannot change the rota, and not when every ward is covered.
  assert.ok(!load({ can: () => false })._render(Object.assign({}, base, { alertCover: cover(0, 0) })).includes("openrota"));
  const covered = { ok: true, shiftsDefined: 2, wards: [{ ward: "Medical A", counts: { nurse: 1, resident: 0, consultant: 0 }, total: 1 }] };
  assert.ok(!load(admin)._render(Object.assign({}, base, { alertCover: covered })).includes("openrota"));
  // An admin's duty status (notWardTeam, now a 200) shows no duty card.
  assert.ok(!load(admin)._render(Object.assign({}, base, { duty: { ok: true, notWardTeam: true, status: null } })).includes('id="wDutyCard"'));
});

test("LT-16 pathways: a failed read of either half says so, and never reads as no pathways", () => {
  const sel = { encounterId: "e1", patientId: "p1", name: "Asha" };
  const both = load()._render(Object.assign({}, base, { view: "pathways", sel, pathwaysData: { available: false, progress: false } }));
  assert.match(both, /Could not load clinical pathways\. Do not read this as no pathways\./);
  assert.match(both, /Could not load the hospital's published pathways\. Do not read this as none published\./);
  assert.ok(!/No active clinical pathways|No hospital pathways are currently published/.test(both), both);
  const ok = load()._render(Object.assign({}, base, { view: "pathways", sel, pathwaysData: { available: { ok: true, pathways: [] }, progress: { ok: true, enrolments: [] } } }));
  assert.match(ok, /No active clinical pathways for this patient/);
  assert.match(ok, /No hospital pathways are currently published/);
});

test("LT-16 pathways and specialty reads name the hospital", () => {
  assert.match(SRC, /"\/ward\/pathway-progress\?orgId=" \+ encodeURIComponent\(st\.orgId\)/);
  assert.match(SRC, /"\/ward\/specialty\?orgId=" \+ encodeURIComponent\(st\.orgId\)/);
});

const env = (ds, body) => Object.assign({ ok: true, dataSource: ds, period: { from: null, to: null }, filters: {}, generatedAt: "2026-09-15T16:55:11.422Z", scope: { role: "admin", tenantId: "tenant-x" } }, body);
const REPORTS = {
  patientFlow: env(["Encounter"], { flow: { computedAt: "2026-09-15T16:55:11.422Z", ed: { arrivals: 3, untriaged: 1 }, admissionsPending: { waiting: 2, longestWaitHours: 5 },
    beds: { occupied: 83, unplacedPatients: 1, wardsKnown: 16, states: { available: 10, reserved: 0, occupied: 83, blocked: 1, cleaning: 2, maintenance: 0 } }, dischargeCandidates: 4,
    staysWithOpenItems: [{ encounterId: "wsq-adm-smd-6teqzm-00025-x", patientId: "opd-pat-smd-6teqzm-00025", ward: "GAS", bed: "03", lengthOfStayDays: 2, openItems: 5 }],
    recentTransfers: [{ encounterId: "wsq-adm-y", patientId: "opd-pat-y", ward: "GMA", bed: "11", movedAt: "2026-09-15T10:00:00.000Z", movedFrom: { ward: "GAS", bed: "03" }, moveReason: "Needs monitoring" }],
    bottlenecks: [{ kind: "unplaced_patients", ward: "cardio", count: 1 }], drill: { occupied: { total: 83, items: [{ patientId: "opd-pat-z" }] } } } }),
  clinicalOperations: env(["Encounter"], { metrics: { patients: 85, occupiedBeds: 83, unplaced: 2, openItems: 12, open: { criticalResults: 1, criticalResultsEscalated: 0, dosesInFlight: 3, handoversWaiting: 2, medicinesUndecided: 4, staysWithNoMedicationHistory: 1, ordersNotPharmacyVerified: 1 } } }),
  billing: env(["Invoice"], { invoiceCount: 7, charged: 42000, collected: 30000, refunded: 0, discounted: 0, adjusted: 0, writtenOff: 0, outstanding: 12000 }),
  claims: env(["Claim"], { claimCount: 4, byState: { submitted: 2, denied: 1, paid: 1 }, submitted: 2, pending: 2, denied: 1, approved: 1, outstandingAmount: 8000 }),
  pharmacy: env(["MedicationDispense"], { stock: [{ code: "amox", display: "Amoxicillin 500 mg", location: "Main store", unit: "tablet", level: 120, belowReorder: true }], dispenseCount: 82, dispenseVolume: { "Amoxicillin (tablet)": 40 }, pendingVerification: 3 }),
  him: env(["Encounter"], { filters: { chartCompletionTypesChecked: [] }, incompleteCharts: 0, incompleteBy: {}, chartsChecked: 0, roiRequests: { fulfilled: 5 }, disclosures: 5 }),
};

test("LT-38 reports: labelled figures and tables, no key names, no internal ids, no raw timestamps as data", () => {
  const html = load()._render(Object.assign({}, base, { view: "reports", reports: REPORTS }));
  for (const label of ["In the emergency department", "Beds occupied", "Largest bottlenecks", "Patients without a bed", "Invoices raised", "Amount awaiting the payer", "Supplies issued", "Stock on hand", "Incomplete charts", "Hospital-wide open work"]) assert.ok(html.includes(label), label);
  for (const figure of ["42000", "8000", "83", "Amoxicillin (tablet)", "Needs monitoring", "Main store"]) assert.ok(html.includes(figure), figure);
  for (const raw of ["computedAt", "encounterId", "patientId", "wsq-adm-", "opd-pat-", "outstandingAmount", "dispenseVolume", "staysWithOpenItems", "tenant-x", "unplaced_patients", "2026-09-15T16:55:11.422Z"]) assert.ok(!html.includes(raw), "raw on screen: " + raw);
  assert.match(html, /No chart-completion rules are set for this hospital/);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.ok(text.length < 6000, "readable, not a dump: " + text.length + " characters");
});

test("LT-38 reports: a figure the server did not send is not readable, never 0; a failed report says so", () => {
  const html = load()._render(Object.assign({}, base, { view: "reports", reports: { billing: env(["Invoice"], { invoiceCount: 2, charged: null }), claims: { ok: false, error: "permission" } } }));
  assert.match(html, /Charged<\/th><td><span class="w-st overdue">not readable/);
  assert.match(html, /Could not load:/);
  assert.match(html, /permission/);
});
