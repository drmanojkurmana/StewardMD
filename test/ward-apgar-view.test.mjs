/* test/ward-apgar-view.test.mjs - the APGAR card in ward.js, on the newborn's own chart.
 *
 * Loading, failed and recorded read differently; an unrecorded minute says "not recorded", never 0; the form posts the
 * five signs as numbers to POST /api/queue/ward/apgar and a recorded minute needs a reason. Routes: test/wardsynq-apgar.test.mjs.
 *
 * node --test test/ward-apgar-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadWard(values) {
  const calls = [];
  const el = (id) => (values && id in values ? { value: values[id] } : null);
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: el, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? "tok" : ""), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url, opts) => { calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null }); return Promise.resolve({ json: () => Promise.resolve({ ok: false }) }); },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), sb);
  return { W: sb.window.WARD, calls };
}
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ");
const PID = "opd-pat-newborn-1";
const BABY = { encounterId: "enc-n", patientId: PID, name: "Baby", mrn: "NB-1", ward: "NICU", bed: "Cot 1", class: "NICU", admittedAt: "2026-09-16T04:00:00.000Z" };
const REC = { minute: 1, record: { total: 7, version: 1, components: { appearance: 1, pulse: 2, grimace: 1, activity: 1, respiration: 2 }, recordedAt: "2026-09-16T04:01:00.000Z", recordedBy: "n-1", correction: null } };

test("APGAR CARD on a NICU chart: loading, failed and recorded; an unrecorded minute is 'not recorded', never 0", () => {
  const { W } = loadWard();
  const chart = (apgar) => text(W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "o", loaded: true, view: "chart", sel: BABY, apgar }))));
  assert.match(chart(null), /APGAR score .*Loading the APGAR score\.\.\./);
  assert.match(chart({ [PID]: false }), /could not be loaded\. Do not read this as not recorded\./);
  const t = chart({ [PID]: { minutes: [REC, { minute: 5, record: null }, { minute: 10, record: null }] } });
  assert.match(t, /1 min 7\/10 1 2 1 1 2/);
  assert.match(t, /5 min not recorded 10 min not recorded/);
  assert.equal(chart({}).indexOf("APGAR score") >= 0, true);
  assert.equal(text(W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "o", loaded: true, view: "chart", sel: { ...BABY, class: "IPD", patientId: "pat-adult" } })))).includes("APGAR score"), false, "not on an adult chart");
});

test("RECORD: the five picks go as numbers with the minute; a recorded minute without a reason is not sent, with one it names the version", async () => {
  const id = PID.replace(/[^A-Za-z0-9_-]/g, "-");
  const picks = { ["wApgarMin-" + id]: "5", ["wApgar-appearance-" + id]: "2", ["wApgar-pulse-" + id]: "2", ["wApgar-grimace-" + id]: "1", ["wApgar-activity-" + id]: "2", ["wApgar-respiration-" + id]: "2", ["wApgarReason-" + id]: "" };
  const { W, calls } = loadWard(picks);
  Object.assign(W._st, { orgId: "o", view: "chart", sel: BABY, apgar: { [PID]: { minutes: [REC, { minute: 5, record: null }, { minute: 10, record: null }] } } });
  W._dispatch("apgarsave:" + PID);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.find((c) => c.url.endsWith("/ward/apgar")).body, { orgId: "o", patientId: PID, minute: 5, components: { appearance: 2, pulse: 2, grimace: 1, activity: 2, respiration: 2 } });

  const again = loadWard({ ...picks, ["wApgarMin-" + id]: "1" });
  Object.assign(again.W._st, { orgId: "o", view: "chart", sel: BABY, apgar: { [PID]: { minutes: [REC, { minute: 5, record: null }, { minute: 10, record: null }] } } });
  again.W._dispatch("apgarsave:" + PID);
  assert.match(again.W._st.err, /already recorded\. To change it, give a correction reason\./);
  assert.equal(again.calls.filter((c) => c.url.endsWith("/ward/apgar")).length, 0);

  const fix = loadWard({ ...picks, ["wApgarMin-" + id]: "1", ["wApgarReason-" + id]: "Grimace was a cry" });
  Object.assign(fix.W._st, { orgId: "o", view: "chart", sel: BABY, apgar: { [PID]: { minutes: [REC, { minute: 5, record: null }, { minute: 10, record: null }] } } });
  fix.W._dispatch("apgarsave:" + PID);
  await new Promise((r) => setTimeout(r, 20));
  const body = fix.calls.find((c) => c.url.endsWith("/ward/apgar")).body;
  assert.equal(body.correctionReason, "Grimace was a cry"); assert.equal(body.expectedVersion, 1);
});
