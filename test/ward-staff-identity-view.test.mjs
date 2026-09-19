/* Owner 2026-09-16: "timeline shows by clinician account it should state his/her employee id and name". The chart
 * screens rendered for real from ward.js, painted the way the ward paints them: every actor id on the screen goes to
 * GET /ward/staff-identities in ONE request, and the answer names the person as "Name (employee id)", with the whole
 * identity on hover and on a click or tap. The route half is test/wardsynq-staff-identity.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(answer) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const calls = [], toasts = [];
  const rootEl = { id: "smdWard", innerHTML: "", classList: { add() {}, remove() {}, contains: () => true }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => (id === "smdWard" ? rootEl : null),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {},
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url) => { calls.push(String(url)); return answer(String(url)); },
    toast: (m) => toasts.push(m),
    setTimeout, clearTimeout, console, Promise, Date,
    addEventListener() {},
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  const W = sandbox.window.WARD;
  return { W, calls, toasts, html: () => rootEl.innerHTML };
}
const reply = (body) => Promise.resolve({ json: () => Promise.resolve(body) });
const settle = () => new Promise((r) => setTimeout(r, 20));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&#39;/g, "'").replace(/\s+/g, " ");

const NURSE = "cfa:nurse-anitha", DOCTOR = "fb:DcGIzIXwxURU0G9L4J5jehluENl1", WITNESS = "nurse2", STRANGER = "cfa:gone";
const IDENTITIES = {
  [NURSE]: { name: "Sister Anitha R", employeeId: "EMP-1042", role: "nurse" },
  [DOCTOR]: { name: "Dr Manoj K", employeeId: "EMP-0007", role: "doctor" },
  [WITNESS]: { name: null, employeeId: "nurse2", role: "nurse" },
  [STRANGER]: null,
};
const CHART = {
  orgId: "org-wsq", loaded: true, view: "chart", busy: false,
  sel: { encounterId: "enc-1", patientId: "pat-1", ward: "Ward A", bed: "12", admittedAt: "2026-09-15T04:00:00.000Z" },
  timeline: [
    { at: "2026-09-16T08:00:00.000Z", resourceType: "MedicationAdministration", id: "mar-1", category: "medication",
      label: "Amoxicillin — administered · by a clinician account", labelBase: "Amoxicillin — administered", byId: NURSE, witnessId: WITNESS },
    { at: "2026-09-16T07:00:00.000Z", resourceType: "MedicationOrder", id: "ord-1", category: "medication",
      label: "a clinician account prescribed Amoxicillin 500mg oral TDS — active", labelBase: "Prescribed Amoxicillin 500mg oral TDS — active", byId: DOCTOR },
    { at: "2026-09-16T06:00:00.000Z", resourceType: "ClinicalNote", id: "note-1", category: "note",
      label: "a clinician account wrote a progress note, signed", labelBase: "A progress note, signed", byId: STRANGER, signedById: DOCTOR },
  ],
  activeMeds: [{ orderId: "ord-1", drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", prescriberId: DOCTOR, since: "2026-09-16T07:00:00.000Z", pharmacy: "verified" }],
  due: [
    { orderId: "ord-1", drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, dueAt: "2026-09-16T08:00:00.000Z", status: "administered", administeredAt: "2026-09-16T08:02:00.000Z", administeredBy: NURSE, witnessedBy: WITNESS, statusBy: NURSE },
    { orderId: "ord-1", drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, dueAt: "2026-09-16T14:00:00.000Z", status: "held", administeredAt: null, administeredBy: null, statusBy: NURSE },
  ],
};

test("timeline and eMAR: while the lookup runs the chart shows the old fallback, never a blank; every actor on the screen is asked for in one request", async () => {
  let release;
  const { W, calls, html } = loadWard((url) => (url.indexOf("/ward/staff-identities") >= 0 ? new Promise((r) => { release = () => r({ json: () => Promise.resolve({ ok: true, identities: IDENTITIES }) }); }) : reply({ ok: true })));
  Object.assign(W._st, CHART);
  W._dispatch("timelinefilter:all");
  await settle();
  const asked = calls.filter((u) => u.indexOf("/ward/staff-identities") >= 0);
  assert.equal(asked.length, 1, "one request for the whole screen");
  const ids = decodeURIComponent(asked[0].split("&ids=")[1]).split(",").sort();
  assert.deepEqual(ids, [NURSE, DOCTOR, WITNESS, STRANGER].sort());
  assert.ok(asked[0].indexOf("orgId=org-wsq") >= 0);
  const t = text(html());
  assert.match(t, /Amoxicillin — administered · by a clinician account/, "the fallback, not a blank, while resolving");
  assert.ok(!t.includes(DOCTOR) && !t.includes(NURSE), "never the raw account id");
  release();
  await settle();
  assert.equal(calls.filter((u) => u.indexOf("/ward/staff-identities") >= 0).length, 1, "answered ids are not asked for again on the repaint");
});

test("timeline and eMAR: the resolved name with the employee id, the whole identity in the tooltip, and a tap that says it", async () => {
  const { W, toasts, html } = loadWard((url) => reply(url.indexOf("/ward/staff-identities") >= 0 ? { ok: true, identities: IDENTITIES } : { ok: true }));
  Object.assign(W._st, CHART);
  W._dispatch("timelinefilter:all");
  await settle();
  const h = html(), t = text(h);
  // Timeline: who gave the dose and its witness, who prescribed, who signed the note.
  assert.match(t, /Amoxicillin — administered · by Sister Anitha R \(EMP-1042\) · witness Name not set \(nurse2\)/);
  assert.match(t, /Prescribed Amoxicillin 500mg oral TDS — active · by Dr Manoj K \(EMP-0007\)/);
  assert.match(t, /A progress note, signed · by a clinician account \(identity not recorded\) · signed by Dr Manoj K \(EMP-0007\)/, "an id that is nobody here says so");
  // eMAR round: given by, witness, held by.
  assert.match(t, /given .* by Sister Anitha R \(EMP-1042\) witness Name not set \(nurse2\)/);
  assert.match(t, /held by Sister Anitha R \(EMP-1042\)/);
  // Active medications: the prescriber.
  assert.match(t, /prescribed by Dr Manoj K \(EMP-0007\)/);
  // Hover and tap: the same chip carries the whole identity and opens it.
  const chip = `<button type="button" class="w-who" data-w-act="whoinfo:${NURSE}" title="Name: Sister Anitha R · Employee ID: EMP-1042 · Role: nurse">Sister Anitha R (EMP-1042)</button>`;
  assert.ok(h.includes(chip), "tooltip and click target on the name");
  assert.ok(h.includes(`title="Name: Name not set · Employee ID: nurse2 · Role: nurse"`));
  W._dispatch("whoinfo:" + NURSE);
  assert.deepEqual(toasts, ["Name: Sister Anitha R · Employee ID: EMP-1042 · Role: nurse"], "a touch screen gets the identity on a tap");
});

test("a failed lookup says the identity could not be loaded, beside the fallback, and never pretends", async () => {
  const { W, html } = loadWard((url) => (url.indexOf("/ward/staff-identities") >= 0 ? reply({ ok: false, error: "audit_write_failed" }) : reply({ ok: true })));
  Object.assign(W._st, CHART);
  W._dispatch("timelinefilter:all");
  await settle();
  const t = text(html());
  assert.match(t, /Amoxicillin — administered · by a clinician account \(identity could not be loaded\)/);
  assert.ok(!/Sister Anitha/.test(t));
});

test("critical results board: a live staff record wins; with no name there the name stored with the acknowledgement is used; a role alone reads with identity not recorded", async () => {
  const live = { "fb:abc": { name: null, employeeId: null, role: "doctor" }, "fb:def": { name: null, employeeId: null, role: "doctor" }, "fb:ghi": { name: "Dr Priya S", employeeId: "EMP-0200", role: "doctor" } };
  const { W, html } = loadWard((url) => reply(url.indexOf("/ward/staff-identities") >= 0 ? { ok: true, identities: live } : { ok: true }));
  const loop = (id, by, name) => ({ loopId: id, patientId: "p1", display: "Potassium", state: "acknowledged", minutesSinceReported: 12, escalation: { level: "none", minutesOpen: 0 }, acknowledgedBy: by, acknowledgedByName: name });
  Object.assign(W._st, CHART, { view: "critsboard", critsBoard: [loop("l1", "fb:abc", "Dr Manoj"), loop("l2", "fb:def", null), loop("l3", "fb:ghi", "old name")] });
  const before = text(W._render(W._st));
  assert.match(before, /acknowledged by Dr Manoj/, "before the lookup: the name stored with the acknowledgement");
  W._dispatch("timelinefilter:all");
  await settle();
  const t = text(html());
  assert.match(t, /acknowledged by Dr Manoj\b/);
  assert.match(t, /acknowledged by doctor, identity not recorded/);
  assert.match(t, /acknowledged by Dr Priya S \(EMP-0200\)/, "the live staff record over the stored name");
});
