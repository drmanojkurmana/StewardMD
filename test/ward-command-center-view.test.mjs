/* P1.13 command center screen: every count links to what is behind it, a count with no ids says so,
 * new sections render, finance is only drawn when the server sent it, and loading / failed / empty
 * read differently. */
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
const ok = (data) => ({ status: "ok", freshness: "live", generatedAt: "2026-09-13T10:00:00Z", data });
const drill = (items, total) => ({ items, total: total == null ? items.length : total, truncated: total != null && total > items.length });
function snapshot(extra) {
  return {
    generatedAt: "2026-09-13T10:00:00Z", sectionsOk: 5, sectionsTotal: 6, notBuilt: {},
    sections: {
      flow: ok({ flow: { beds: { occupied: 2 }, ed: { arrivals: 0 }, dischargeCandidates: 1, drill: { occupied: drill([{ patientId: "p1", encounterId: "e1", ward: "A", bed: "3" }]), edArrivals: drill([]), dischargeCandidates: drill([{ patientId: "p1", encounterId: "e1" }]) } } }),
      clinicalOps: ok({ metrics: { open: { criticalResults: 1, dosesInFlight: 0 }, openItems: 4 } }),
      icu: ok({ occupied: 3, ventilatedRecorded: 1, vasopressorsRecorded: 0, drill: { occupied: drill([{ patientId: "p9", encounterId: "e9" }], 60), ventilated: drill([]), vasopressors: drill([]) } }),
      staffing: ok({ rosterConfigured: true, onDutyNow: 2, requiredNow: 3, gaps: [{ role: "nurse", shift: "Day", unit: "ICU", need: 2, have: 1, short: 1 }], drill: { onDuty: drill([{ identity: "n1", shift: "Day" }]) } }),
      labTat: ok({ sampleSize: 0, medianMinutes: null, p90Minutes: null, excludedTotal: 2, drill: { slowest: drill([]) } }),
      radiology: { status: "unavailable", freshness: "unavailable", error: "threw", detail: "storage fault" },
      otUtilisation: ok({ theatresConfigured: 2, overallUtilisation: 0.25, perTheatre: [{ name: "OT 1", utilisation: 0.5, bookedMinutes: 720 }] }),
      pharmacy: ok({ dispenseCount: 1, pendingVerification: 0, stock: [{ code: "ceftriaxone", level: 2, reorderAt: 10, belowReorder: true }] }),
      opdQueue: ok({ waiting: 4, inConsultation: 1, sessions: 2, drillNotAvailable: "OPD tickets are not ward records; open the OPD board to see who is waiting." }),
      ...(extra || {}),
    },
  };
}
const twin = (W, tw) => W._render({ ...W._st, view: "twin", twin: { loaded: true, ...tw } });

test("twin: counts with ids are buttons, counts without say detail not available, sections show when computed", () => {
  const W = loadWard();
  const html = twin(W, { snapshot: snapshot() });
  assert.ok(html.includes('data-w-act="twindrill:icu.occupied"'));
  assert.ok(html.includes('data-w-act="twindrill:flow.occupied"'));
  assert.ok(html.includes('data-w-act="twindrill:staffing.onDuty"'));
  assert.match(html, /open item\(s\) <small class="w-hint">\(detail not available\)/);
  assert.match(html, /Computed /);
  assert.match(html, /short 1 \(have 1 of 2\)/, "staffing gaps are named");
  assert.match(html, /No reported requests with both times in the last 7 days\. No figure is shown\./);
  assert.match(html, /UNAVAILABLE, not zero/);
  assert.match(html, /Overall <b>25%<\/b> of 2 theatre/);
  assert.match(html, /<b>ceftriaxone<\/b><span>level 2 &middot; reorder at 10/);
  assert.match(html, /OPD tickets are not ward records/);
  assert.ok(!/Billing|Claims/.test(html), "finance is not drawn when the server did not send it");
});

test("twin: the drill list opens each chart, names the board, and says when it is cut short", () => {
  const W = loadWard();
  const html = twin(W, { snapshot: snapshot(), drill: { section: "icu", key: "occupied" } });
  assert.ok(html.includes('data-w-act="cmdopen:e9"'));
  assert.ok(html.includes('data-w-act="bedmgmt"'));
  assert.match(html, /Showing 1 of 60/);
  const none = twin(W, { snapshot: snapshot(), drill: { section: "clinicalOps", key: "openItems" } });
  assert.match(none, /Detail not available for this count\./);
});

test("twin: finance withheld is said, finance sent is drawn; failed load is not an empty snapshot", () => {
  const W = loadWard();
  const withheld = snapshot(); withheld.financeWithheld = "billing_view_required";
  assert.match(twin(W, { snapshot: withheld }), /Billing and claims need billing rights/);
  const fin = twin(W, { snapshot: snapshot({ billing: ok({ invoiceCount: 3, charged: 900, collected: 500, outstanding: 400 }), claims: ok({ claimCount: 2, pending: 1, denied: 0, outstandingAmount: 100 }) }) });
  assert.match(fin, /charged 900/);
  assert.match(fin, /pending 1/);
  assert.match(twin(W, { snapshot: null, err: "permission" }), /could not be loaded: permission\. Do not read this as zero/);
  assert.match(W._render({ ...W._st, view: "twin", twin: {} }), /Loading/);
  assert.match(twin(W, { snapshot: null }), /Nothing to show yet/);
  assert.match(SRC, /\/ward\/twin\?orgId=" \+ encodeURIComponent\(st\.orgId\) \+ "&finance=1"/);
});

test("patient flow: counts drill to patients, rows open the chart, failed load is distinct", () => {
  const W = loadWard();
  const f = { computedAt: "2026-09-13T10:00:00Z", ed: { arrivals: 1, untriaged: 1 }, beds: { occupied: 1, unplacedPatients: 0, states: {} }, admissionsPending: { waiting: 0, longestWaitHours: 0 },
    dischargeCandidates: 0, staysWithOpenItems: [{ encounterId: "e5", openItems: 2, ward: "A" }], recentTransfers: [], bottlenecks: [],
    drill: { edArrivals: drill([{ patientId: "p7", encounterId: "e7" }]), edUntriaged: drill([{ patientId: "p7", encounterId: "e7" }]), occupied: drill([{ patientId: "p5", encounterId: "e5" }]), unplaced: drill([]), dischargeCandidates: drill([]) } };
  const html = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: f } });
  assert.ok(html.includes('data-w-act="flowdrill:occupied"'));
  assert.ok(html.includes('data-w-act="cmdopen:e5"'));
  const open = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: f, drill: "edArrivals" } });
  assert.ok(open.includes('data-w-act="cmdopen:e7"'));
  assert.ok(open.includes('data-w-act="edboard"'));
  assert.match(W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, err: "permission" } }), /could not be loaded: permission\. Do not read this as an empty hospital/);
  assert.match(W._render({ ...W._st, view: "flowcommand", flow: {} }), /Loading/);
  assert.match(W._render({ ...W._st, view: "flowcommand", flow: { loaded: true } }), /Nothing to show yet/);
});
