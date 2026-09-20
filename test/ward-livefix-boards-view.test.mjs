/* The boards the live test of 2026-09-15 found wrong (LT-22 to LT-29), rendered for real from ward.js.
 * The route half is test/wardsynq-livefix-boards.test.mjs; the browser half is test/run-ward-crits-board-golden-path.mjs,
 * test/run-ward-lab-specimen-golden-path.mjs and test/run-ward-ed-golden-path.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(hooks) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const listeners = {};
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => (hooks && hooks.byId ? hooks.byId(id) : null),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  const W = sandbox.window.WARD;
  W.__sandbox = sandbox; W.__listeners = listeners;
  return W;
}
const render = (W, s) => W._render({ ...W._st, orgId: "org-1", loaded: true, ...s });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&#39;/g, "'").replace(/\s+/g, " ");

/* ---- LT-25: the laboratory board --------------------------------------------------------------------- */
const spec = (id, state, extra) => ({ serviceRequestId: id, code: id, display: id.toUpperCase(), category: "laboratory", patientId: "p1", collection: { state, ...(extra || {}) } });
const LAB = {
  specimens: [spec("cbc", "none"), spec("lft", "failed", { reason: "haemolysed" }), spec("rft", "collected", { at: "2026-09-15T10:00:00.000Z", by: "lab.01@h.test", specimenId: "s-rft" }), spec("crp", "received")],
  pending: ["cbc", "lft", "rft", "crp", "tsh"].map((id) => ({ serviceRequestId: id, code: id, display: id.toUpperCase(), patientId: "p1" })),
  criticals: [
    { loopId: "l-open", patientId: "p1", encounterId: "e1", display: "Haemoglobin", value: 5.2, unit: "g/dL", state: "open", minutesSinceReported: 3, escalation: { level: "due", minutesOpen: 3 }, patient: { name: "Test Patient QA-01", mrn: "SMD-27", ward: "General Medicine A", bed: "GMA-11" } },
    { loopId: "l-ack", patientId: "p2", display: "Sodium", value: 118, state: "acknowledged", minutesSinceReported: 5588, escalation: { level: "none", minutesOpen: 0 } },
  ],
  toVerify: [], cultures: [], histopathology: [], errors: [], failed: {},
};

test("LT-25: an uncollected blood test has Collect on the laboratory board and no Enter result anywhere; a failed attempt says why", () => {
  const W = loadWard();
  const html = render(W, { view: "labboard", labBoard: LAB, labDept: "all", list: [{ patientId: "p1", name: "Test Patient QA-01", mrn: "SMD-27" }] });
  for (const id of ["cbc", "lft"]) assert.ok(html.includes(`data-w-act="collectspecimen:${id}"`), id + " can be collected from the board");
  assert.ok(!html.includes('data-w-act="collectspecimen:rft"') && !html.includes('data-w-act="collectspecimen:crp"'), "a collected or received sample is not collected again");
  assert.match(text(html), /Last attempt failed: haemolysed/);
  assert.match(text(html), /collected .* by lab\.01@h\.test/, "who collected and when, on the in-transit row");
  for (const id of ["cbc", "lft", "rft"]) assert.ok(!html.includes(`data-w-act="labresultopen:${id}"`), id + " is not awaiting a result while its sample is not with the laboratory");
  for (const id of ["crp", "tsh"]) assert.ok(html.includes(`data-w-act="labresultopen:${id}"`), id + " awaits a result (received, or state not read: the server decides)");
});

test("LT-26: the laboratory board counts open critical results the way the Map does, with the patient named and minutes since reported", () => {
  const W = loadWard();
  const t = text(render(W, { view: "labboard", labBoard: LAB, labDept: "all" }));
  assert.match(t, /Critical results · 1 /, "acknowledged loops are not open");
  assert.match(t, /Test Patient QA-01 · SMD-27 · General Medicine A, bed GMA-11/);
  assert.match(t, /3 min since reported/);
  assert.ok(!/Sodium/.test(t), "the acknowledged one is on the critical results board, not counted here");
});

/* ---- LT-26/LT-28: the critical results board ---------------------------------------------------------- */

test("LT-28: the critical results board names patient, ward and bed; an acknowledgement keeps minutes since reported and shows a person", () => {
  const W = loadWard();
  const loops = [
    LAB.criticals[0],
    { ...LAB.criticals[1], acknowledgedBy: "fb:DcGIzIXwxURU0G9L4J5jehluENl1", acknowledgedByName: null },
    { loopId: "l-named", patientId: "p3", display: "Potassium", state: "acknowledged", minutesSinceReported: 12, escalation: { level: "none", minutesOpen: 0 }, acknowledgedBy: "fb:abc", acknowledgedByName: "Dr Manoj" },
  ];
  const html = render(W, { view: "critsboard", critsBoard: loops });
  const t = text(html);
  assert.match(t, /Open loops · 1 /, "open means not acknowledged");
  assert.match(t, /Acknowledged, not yet closed · 2/);
  assert.match(t, /Test Patient QA-01 · SMD-27 · General Medicine A, bed GMA-11/);
  assert.match(t, /5588 min since reported/, "acknowledging does not reset it to 0");
  assert.ok(!html.includes("fb:DcGIzIXwxURU0G9L4J5jehluENl1"), "never a sign-in uid");
  assert.match(t, /acknowledged by a clinician account/);
  assert.match(t, /acknowledged by Dr Manoj/);
  assert.equal(html.split('data-w-act="ackboard:').length - 1, 1, "only the open loop offers Acknowledge");
});

test("LT-28: an escalation that reached nobody is not called 'Escalated', and says why", () => {
  const W = loadWard();
  const loop = { loopId: "l1", patientId: "p1", display: "Creatinine", state: "open", minutesSinceReported: 5592, escalation: { level: "escalate" },
    escalations: [{ level: "escalate", at: "2026-09-13T08:00:00.000Z", minutesOpen: 2771, notification: { delivered: false, reason: "NO_CHANNEL" } },
      { level: "overdue", at: "2026-09-12T08:00:00.000Z", minutesOpen: 40, notification: { delivered: false, reason: "NO_RECIPIENT" } }] };
  const t = text(render(W, { view: "critsboard", critsBoard: [loop] }));
  assert.ok(!/Escalated/.test(t), t);
  assert.match(t, /Due for escalation .* after 2771 min: nobody was notified \(no notification channel is set up\)/);
  assert.match(t, /nobody was notified \(nobody is on duty to tell under this hospital's alert rule\)/);
});

/* ---- LT-27: radiology waiting time -------------------------------------------------------------------- */

test("LT-27: a worklist time is read with its TimezoneOffsetFromUTC, and a worklist without one wrote UTC", () => {
  const W = loadWard();
  const item = (offset) => ({ "00080050": { Value: ["sr-1"] }, ...(offset ? { "00080201": { Value: [offset] } } : {}),
    "00400100": { Value: [{ "00400002": { Value: ["20260915"] }, "00400003": { Value: ["210600"] } }] } });
  assert.equal(Date.parse(W._radWorklistRow(item("+0530")).orderedAt), Date.parse("2026-09-15T15:36:00.000Z"), "21:06 IST is 15:36 UTC, whatever the browser's zone");
  assert.equal(Date.parse(W._radWorklistRow(item(null)).orderedAt), Date.parse("2026-09-15T21:06:00.000Z"));
});

/* ---- LT-22/LT-23: handover and nursing tasks ---------------------------------------------------------- */

test("LT-22: a handover names the patient (name, MRN, ward, bed) and the staff, never a record id or a sign-in uid", () => {
  const W = loadWard();
  const h = { handoverId: "h1", patientId: "opd-pat-smd-demo-00001", encounterId: "e1", state: "received", sections: { situation: "Stable." }, sbarStated: 1,
    givenBy: "fb:DcGIzIXwxURU0G9L4J5jehluENl1", givenByName: null, givenAt: "2026-09-02T07:00:00.000Z", receivedBy: "fb:xyz", receivedByName: "Sister Anita", receivedAt: "2026-09-02T07:30:00.000Z",
    patient: { name: "Demo Patient One", mrn: "SMD-DEMO-00001", ward: "Ward A", bed: "4" } };
  const html = render(W, { view: "handover", list: null, handovers: { ok: true, handovers: [h], waiting: 0 } });
  const t = text(html);
  assert.match(t, /Demo Patient One · SMD-DEMO-00001 · Ward A, bed 4/);
  assert.ok(!html.includes("opd-pat-smd-demo-00001") && !html.includes("fb:DcGI"), "no ids where names belong");
  assert.match(t, /given by a clinician account/);
  assert.match(t, /taken by Sister Anita/);
});

test("LT-23: the chart's Nursing category carries Hand over and Nursing tasks; from the chart the handover screen opens the SBAR form", () => {
  const W = loadWard();
  const sel = { patientId: "p1", encounterId: "e1", ward: "W1", bed: "3", name: "Test Patient QA-01", admittedAt: "2026-09-15T08:00:00Z" };
  const chart = render(W, { view: "chart", sel });
  const panel = chart.slice(chart.indexOf('id="wCnavP-nursing"'));
  assert.ok(panel.slice(0, panel.indexOf("</div></div>")).includes('data-w-act="handoverchart"'));
  assert.ok(panel.slice(0, panel.indexOf("</div></div>")).includes('data-w-act="nursetasks"'));
  const ho = render(W, { view: "handover", sel, handovers: { ok: true, handovers: [], waiting: 0 } });
  assert.ok(ho.includes('id="wHo_situation"') && ho.includes('data-w-act="handovergive"'));
  const np = render(W, { view: "nursingpatient", sel, nurseWorklist: null, nursingPanel: { patientId: "p1", encounterId: "e1", name: "Test Patient QA-01", fromChart: true, data: { ok: true, assignment: { nurseId: null }, tasks: [], vitals: null, problems: [] } } });
  assert.ok(np.includes('id="wNtTitle"') && np.includes('data-w-act="ntaskadd"'), "the task form is there");
  assert.match(text(np), /A nurse is assigned from the nurse worklist/, "no false 'could not be loaded' when opened from the chart");
});

/* ---- LT-29: ward-to-ward navigation ------------------------------------------------------------------- */

test("LT-29: moving between ward boards does not close the ward (which sent the shell to the Map); leaving the ward does", () => {
  let closed = 0;
  const W = loadWard({ byId: (id) => (id === "smdWard" ? { classList: { contains: () => true, remove() {}, add() {} }, innerHTML: "" } : null) });
  W.onClose = () => { closed += 1; };
  const change = W.__listeners.hashchange;
  W.__sandbox.location.hash = "#/ward/labboard"; change();
  assert.equal(closed, 0);
  W.__sandbox.location.hash = "#/home"; change();
  assert.equal(closed, 1);
});
