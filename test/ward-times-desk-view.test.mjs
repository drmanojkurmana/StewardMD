/* test/ward-times-desk-view.test.mjs - R2-2 screens in ward.js: bed arrival and initial assessment on the stay's chart, the
 * technique given on the anaesthesia card, the claims desk period and the theatre delay forecast.
 *
 * Rendered from the real ward.js in a sandbox. Not loaded and not recorded never look alike; the actions post what
 * /ward/bed-arrival, /ward/initial-assessment, /ward/anesthesia-start, /ward/anesthesia-end and /ward/rcm-worklists need.
 * The routes are tested in test/wardsynq-initial-assessment.test.mjs, wardsynq-surgery, wardsynq-twin-predict and
 * wardsynq-claims-ops.
 *
 * node --test test/ward-times-desk-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WARD_SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function load(reply, inputs) {
  const calls = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: (id) => (inputs && id in inputs ? { value: inputs[id] } : null), createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? "tok" : ""), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url: String(url), body });
      return Promise.resolve({ json: () => Promise.resolve((reply && reply(String(url), body, calls)) || { ok: true, written: 1 }) });
    },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(WARD_SRC, sb);
  return { W: sb.window.WARD, calls };
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&hellip;/g, "...").replace(/\s+/g, " ");
const render = (W, s) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, ...s })));
const tick = () => new Promise((r) => setTimeout(r, 20));
const SEL = { encounterId: "enc-1", patientId: "pat-1", class: "IPD" };
const plan = (adm) => ({ edd: { current: null, history: [] }, xfer: [], adm });

test("ADMISSION TIMES: not loaded, not recorded, notes unreadable and a marked assessment are four different things", () => {
  const { W } = load();
  const chart = (adm) => text(render(W, { view: "chart", sel: SEL, stayPlan: plan(adm) }));
  assert.match(chart(false), /The admission times could not be loaded\. Do not read this as not recorded\./);
  const empty = render(W, { view: "chart", sel: SEL, stayPlan: plan({ ok: true, eligible: true, record: null, minutes: null, signedNotes: [] }) });
  assert.match(text(empty), /Bed arrival and initial assessment .*Reached the bed Not recorded\. .*Record bed arrival/);
  assert.match(text(empty), /No signed doctor's note on this stay yet\./);
  assert.ok(empty.includes('data-w-act="admarrive"'));
  assert.match(chart({ ok: true, eligible: true, record: null, minutes: null, signedNotes: null }), /The signed notes could not be read, so none can be marked\. Do not read this as none\./);
  const offer = render(W, { view: "chart", sel: SEL, stayPlan: plan({ ok: true, eligible: true, record: null, signedNotes: [{ noteId: "n-1", signedAt: "2026-09-17T05:10:00.000Z", signedBy: "cfa:doc" }] }) });
  assert.ok(offer.includes('data-w-act="admmark:n-1"'));
  const done = chart({ ok: true, eligible: true, minutes: 40, signedNotes: [],
    record: { version: 2, bedArrival: { at: "2026-09-17T04:30:00.000Z", by: "cfa:nurse" }, initialAssessment: { noteId: "n-1", signedAt: "2026-09-17T05:10:00.000Z", signedBy: "cfa:doc", markedBy: "cfa:doc" } } });
  assert.match(done, /40 minutes from bed arrival to the initial assessment\./);
  assert.match(done, /Change the arrival time/);
  assert.doesNotMatch(done, /Mark as initial assessment/);
  assert.equal(chart({ ok: true, eligible: false, record: null, signedNotes: [] }).includes("Bed arrival and initial assessment"), false, "not an inpatient stay: nothing offered");
});

test("ADMISSION TIMES ACTIONS: record posts the stay and a time; a change needs a reason and names the version; mark posts the note", async () => {
  const { W, calls } = load((url) => (url.includes("/ward/admission-times") ? { ok: true, eligible: true, record: null, signedNotes: [] } : null));
  Object.assign(W._st, { orgId: "org-1", view: "chart", sel: SEL, stayPlan: plan({ ok: true, eligible: true, record: { version: 3, bedArrival: { at: "2026-09-17T04:30:00.000Z" } }, signedNotes: [] }) });
  W._dispatch("admarrive:change");
  W._dispatch("askok");
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/ward/bed-arrival")).length, 0, "a change with no reason is not sent");
  W._st.ask.values.reason = "Entered the wrong time";
  W._dispatch("askok");
  await tick();
  const post = calls.find((c) => c.url.endsWith("/ward/bed-arrival"));
  assert.deepEqual({ ...post.body, at: typeof post.body.at }, { orgId: "org-1", encounterId: "enc-1", at: "string", reason: "Entered the wrong time", expectedVersion: 3 });

  Object.assign(W._st, { view: "chart", sel: SEL, stayPlan: plan({ ok: true, eligible: true, record: null, signedNotes: [{ noteId: "n-1", signedAt: "2026-09-17T05:10:00.000Z", signedBy: "cfa:doc" }] }) });
  W._dispatch("admmark:n-1");
  W._dispatch("askok");
  await tick();
  const mark = calls.find((c) => c.url.endsWith("/ward/initial-assessment"));
  assert.deepEqual(mark.body, { orgId: "org-1", encounterId: "enc-1", noteId: "n-1" });
});

test("ANAESTHESIA TECHNIQUE: chosen at the start, shown with a conversion, sent again at the end", async () => {
  const { W, calls } = load(null, { wSurgAnesTech: "local-with-monitoring", wSurgAnesTechEnd: "general", wSurgAsa: "ASA I" });
  const base = { id: "case-1", patientId: "p", procedure: "Hernia repair", laterality: "left", stage: "signed-in", ledger: [] };
  const start = render(W, { view: "surgerycase", surgCase: { case: base, anesthesia: null, implants: [], pac: { rec: null } } });
  assert.match(start, /id="wSurgAnesTech"/); assert.match(text(start), /Technique given/);
  const ended = text(render(W, { view: "surgerycase", surgCase: { case: base, anesthesia: { endedAt: "2026-09-17T06:00:00Z", events: [], technique: "general", techniqueChangedFrom: "local-with-monitoring" }, implants: [], pac: { rec: null } } }));
  assert.match(ended, /Technique given: General anaesthesia · converted from Local with monitoring/);
  Object.assign(W._st, { orgId: "org-1", view: "surgerycase", surgCase: { case: base, anesthesia: null } });
  W._dispatch("anesstart");
  await tick();
  assert.equal(calls.find((c) => c.url.endsWith("/ward/anesthesia-start")).body.technique, "local-with-monitoring");
  Object.assign(W._st, { view: "surgerycase", surgCase: { case: base, anesthesia: { events: [], technique: "local-with-monitoring" } } });
  W._dispatch("anesend");
  await tick();
  assert.equal(calls.find((c) => c.url.endsWith("/ward/anesthesia-end")).body.technique, "general");
});

test("CLAIMS DESK PERIOD: the request carries from and to; clearing asks for all time; the panel says the period the server applied", async () => {
  const inputs = { wDeskFrom: "2026-08-01", wDeskTo: "2026-08-31" };
  const { W, calls } = load((url) => (url.includes("/ward/rcm-worklists") ? { ok: true } : null), inputs);
  Object.assign(W._st, { orgId: "org-1", view: "claimsdesk" });
  W._dispatch("deskperiod");
  await tick();
  const withPeriod = calls.filter((c) => c.url.includes("/ward/rcm-worklists")).pop().url;
  const q = new URL(withPeriod, "https://x").searchParams;
  assert.equal(q.get("from"), new Date("2026-08-01T00:00:00").toISOString());
  assert.equal(q.get("to"), new Date("2026-08-31T23:59:59.999").toISOString());
  assert.match(render(W, { view: "claimsdesk", desk: null, deskFrom: "2026-08-01", deskTo: "2026-08-31" }), /data-w-act="deskperiod:clear"/);
  W._dispatch("deskperiod:clear");
  await tick();
  const all = new URL(calls.filter((c) => c.url.includes("/ward/rcm-worklists")).pop().url, "https://x").searchParams;
  assert.equal(all.get("from"), null); assert.equal(all.get("to"), null);
  inputs.wDeskFrom = "2026-09-10"; inputs.wDeskTo = "2026-09-01";
  const before = calls.length;
  W._dispatch("deskperiod");
  assert.equal(calls.length, before, "a period that ends before it starts is not sent");

  const desk = (period) => text(render(W, { view: "claimsdesk", desk: { ok: true, denialReasonsConfigured: true, dnfb: [], unsubmitted: [], queries: [], ageing: null, unreadable: {}, period,
    denials: { count: 0, byPayer: [], byScheme: [], byService: [], byReason: [], claims: [], disallowances: [] } } }));
  assert.match(desk({ from: null, to: null }), /All time: no period is applied\./);
  assert.match(desk({ from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T12:00:00.000Z" }), /Denied from 2026-08-0\d to 2026-08-3\d/);
});

test("THEATRE DELAY FORECAST: minutes per case with the cases behind each day, and the cases with no scheduled start said", () => {
  const { W } = load();
  const twin = (forecast) => text(render(W, { view: "twin", twin: { snapshot: { generatedAt: "2026-09-17T10:00:00Z", sections: {}, notBuilt: {} }, loaded: true, forecast } }));
  const t = twin({ ok: true, casesMeasured: 3, casesWithoutScheduledStart: 1, prediction: { label: "PREDICTION - NOT AN OBSERVED FACT", unit: "minutes", pointEstimate: 45, horizonDays: 1,
    uncertainty: { lowerBound: 30, upperBound: 60 }, inputWindow: { from: "2026-09-14T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z", sampleSize: 2 },
    method: "mean of minutes", inputs: [{ atIso: "2026-09-14T00:00:00.000Z", value: 30, cases: 2 }, { atIso: "2026-09-16T00:00:00.000Z", value: 60, cases: 1 }] } });
  assert.match(t, /45 minutes from the scheduled start to entering the theatre, per case, expected \(likely range 30 to 60/);
  assert.match(t, /Each day's mean minutes behind this number 30 2026-09-14 · 2 cases 60 2026-09-16 · 1 cases/);
  assert.match(t, /1 cases had no scheduled start/);
  const refused = twin({ ok: false, error: "insufficient_data", casesMeasured: 0, casesWithoutScheduledStart: 4 });
  assert.match(refused, /Not enough past days of data .* 4 cases had no scheduled start/);
});
