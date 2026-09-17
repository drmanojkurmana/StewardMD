/* test/ward-discharge-capacity-view.test.mjs - the Discharge progress, Transfer centre and forecast screens in ward.js.
 *
 * Rendered from the real ward.js in a sandbox: loading, failed and empty never look alike; a step not recorded offers
 * Record, a recorded one Change, an unreadable one says so; the transfer centre's accept and the identity confirmation
 * post what the server needs; the forecast shows the daily counts it rests on. The routes are tested in
 * test/wardsynq-discharge-capacity.test.mjs.
 *
 * node --test test/ward-discharge-capacity-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WARD_SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function load(reply) {
  const calls = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
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
const steps = (over) => ["advised", "pharmacy-cleared", "bill-ready", "tpa-final-requested", "tpa-final-received", "summary-signed", "left"].map((step) => ({ step, at: null, source: null, ...(over[step] || {}) }));
const STAY = { encounterId: "enc-1", patientId: "pat-1", version: 3, name: "Asha Rao", mrn: "MRN-1", ward: "Medical A", bed: "3", minutesSinceAdvised: 135,
  steps: steps({ advised: { at: "2026-09-17T04:00:00.000Z", source: "recorded" }, "pharmacy-cleared": { at: "2026-09-17T05:00:00.000Z", source: "recorded", outOfOrder: ["advised"], reason: "Cleared on the round" }, "summary-signed": { at: null, source: "unreadable" } }) };

test("DISCHARGE PROGRESS: loading, failed and none are three things; each step shows its time, Record, Change or unreadable; turnaround names what was not recorded", () => {
  const { W } = load();
  const board = (dcBoard) => render(W, { view: "dcboard", dcBoard });
  assert.match(text(board(null)), /Discharge progress .*Loading\.\.\./);
  assert.match(text(board(false)), /Discharge progress could not be loaded\. Do not read this as no discharges\./);
  const none = text(board({ ok: true, days: 30, inProgress: [], turnaround: { stays: 0, steps: [] }, unreadable: {} }));
  assert.match(none, /No discharge is in progress\./); assert.match(none, /No discharge in this period has both the advice and the departure recorded\./);
  const html = board({ ok: true, days: 30, inProgress: [STAY], unreadable: { stays: true },
    turnaround: { stays: 4, medianTotalMinutes: 250, steps: [{ step: "bill-ready", medianMinutesFromAdvised: 95, stays: 3, notRecorded: 1 }, { step: "left", medianMinutesFromAdvised: null, stays: 0, notRecorded: 4 }] } });
  const t = text(html);
  assert.match(t, /Asha Rao · MRN-1 Medical A · bed 3 · 2 h 15 min since discharge was advised/);
  assert.match(t, /Pharmacy cleared .* out of order · Cleared on the round/);
  assert.match(t, /Summary signed could not be read with this role/);
  assert.match(t, /Bill ready not recorded/);
  assert.ok(html.includes('data-w-act="dcstep:enc-1~bill-ready"') && html.includes('data-w-act="dcstep:enc-1~advised~change"'));
  assert.ok(!html.includes('dcstep:enc-1~summary-signed'), "the signature is never typed in");
  assert.match(t, /Stays cannot be read with this role/);
  assert.match(t, /4 discharges · median 4 h 10 min from advised to leaving/);
  assert.match(t, /Bill ready median 1 h 35 min after advice, from 3 discharges · 1 not recorded/);
  assert.match(t, /Left the unit no recorded times · 4 not recorded/);
});

test("DISCHARGE STEPS: Change posts the version and needs a reason; the chart's Discharge advised posts the stay and the time", async () => {
  const { W, calls } = load((url) => (url.includes("/ward/discharge-progress") ? { ok: true, days: 30, inProgress: [STAY], turnaround: { stays: 0, steps: [] }, unreadable: {} } : null));
  Object.assign(W._st, { orgId: "org-1", view: "dcboard", dcBoard: { ok: true, inProgress: [STAY] } });
  W._dispatch("dcstep:enc-1~pharmacy-cleared~change");
  W._dispatch("askok");
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/ward/discharge-milestone")).length, 0, "a change with no reason is not sent");
  assert.match(W._st.ask.err, /A change needs a reason\./);
  W._st.ask.values.reason = "Wrong time entered";
  W._st.ask.values.at = "2026-09-17T10:30";
  W._dispatch("askok");
  await tick();
  const post = calls.find((c) => c.url.endsWith("/ward/discharge-milestone"));
  assert.deepEqual({ ...post.body, at: typeof post.body.at }, { orgId: "org-1", encounterId: "enc-1", step: "pharmacy-cleared", at: "string", reason: "Wrong time entered", expectedVersion: 3 });

  const { W: W2, calls: c2 } = load();
  Object.assign(W2._st, { orgId: "org-1", view: "chart", sel: { encounterId: "enc-9", patientId: "p", class: "IPD" } });
  assert.ok(render(W2, { view: "chart", sel: W2._st.sel, stayPlan: { edd: { current: null, history: [] }, xfer: [] } }).includes('data-w-act="dcadvise"'));
  W2._dispatch("dcadvise");
  W2._dispatch("askok");
  await tick();
  const adv = c2.find((c) => c.url.endsWith("/ward/discharge-milestone"));
  assert.equal(adv.body.step, "advised"); assert.equal(adv.body.encounterId, "enc-9"); assert.ok(adv.body.at, "the time defaults to now");
});

const CALL = { id: "tcr-1", version: 1, status: "requested", facility: "Sai Nursing Home", urgency: "emergency", requestedService: "Cardiology", requestedUnit: "icu", ageYears: 50, sex: "male",
  clinicalSummary: "Inferior STEMI, thrombolysed", contactName: "Dr Rao", contactPhone: "9800000001", minutesWaiting: 12, receivedAt: "2026-09-17T04:00:00.000Z" };

test("TRANSFER CENTRE: capacity unreadable is not no beds; an open call offers accept, decline and withdrawn; answered calls show time to answer", () => {
  const { W } = load();
  const tc = (v) => text(render(W, { view: "tcentre", tc: v }));
  assert.match(tc(null), /Record a call .*Loading\.\.\./);
  assert.match(tc(false), /Transfer centre requests could not be loaded\. Do not read this as none\./);
  const empty = tc({ ok: true, days: 30, open: [], decided: [], summary: {}, capacityNow: { wards: null, waitingForBed: null } });
  assert.match(empty, /The bed list could not be read\. Do not read this as no beds\./); assert.match(empty, /No call is waiting for a decision\./);
  assert.match(empty, /The bed waiting list could not be read\./);
  const html = render(W, { view: "tcentre", tc: { ok: true, days: 30, open: [CALL],
    decided: [{ ...CALL, id: "tcr-2", status: "declined", minutesToDecision: 25, decidedAt: "2026-09-16T04:25:00.000Z", declineReason: "No ICU bed" }],
    summary: { accepted: 2, declined: 1, cancelled: 0, medianMinutesToDecision: 25 },
    capacityNow: { wards: [{ ward: "ICU", available: 0, reserved: 1, occupied: 7, other: 0, total: 8 }], waitingForBed: 3 } } });
  const t = text(html);
  assert.match(t, /ICU 0 free · 1 reserved · 7 occupied · 0 other, of 8/); assert.match(t, /3 already waiting for a bed/);
  assert.match(t, /Sai Nursing Home Emergency Cardiology · ICU · 50 years, male · waiting 12 min for an answer/);
  assert.ok(["tcaccept:tcr-1", "tcdecline:tcr-1", "tcwithdraw:tcr-1"].every((a) => html.includes('data-w-act="' + a + '"')));
  assert.match(t, /Declined Sai Nursing Home answered in 25 min .*No ICU bed/);
  assert.match(t, /2 accepted · 1 declined · 0 withdrawn · median time to an answer 25 min/);
});

test("TRANSFER CENTRE STEPS: accept posts the MRN and version; a mismatch asks for confirmation and re-sends it confirmed", async () => {
  const { W, calls } = load((url, body) => {
    if (url.includes("/ward/transfer-centre-decide")) return body.identityConfirmed ? { ok: true, status: "accepted" } : { ok: false, error: "identity_mismatch", mismatch: ["sex"] };
    if (url.includes("/ward/transfer-centre?")) return { ok: true, days: 30, open: [], decided: [], summary: {}, capacityNow: null };
    return null;
  });
  Object.assign(W._st, { orgId: "org-1", view: "tcentre", tc: { ok: true, open: [CALL] } });
  W._dispatch("tcaccept:tcr-1");
  W._st.ask.values.mrn = "SMD-00042";
  W._dispatch("askok");
  await tick();
  const first = calls.filter((c) => c.url.endsWith("/ward/transfer-centre-decide"));
  assert.deepEqual(first[0].body, { orgId: "org-1", requestId: "tcr-1", expectedVersion: 1, decision: "accept", mrn: "SMD-00042" });
  assert.match(String(W._st.ask.spec.title), /does not match the call/);
  assert.match(String(W._st.ask.spec.text), /The sex the referring hospital gave differs/);
  W._dispatch("askok");
  await tick();
  const second = calls.filter((c) => c.url.endsWith("/ward/transfer-centre-decide"))[1];
  assert.equal(second.body.identityConfirmed, true);
  assert.match(W._st.note, /no bed is reserved/);

  W._st.ask = null; W._st.tc = { ok: true, open: [CALL] };
  W._dispatch("tcdecline:tcr-1");
  W._dispatch("askok");
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/ward/transfer-centre-decide")).length, 2, "a decline with no reason is not sent");
});

test("FORECAST: the method and the daily counts behind the number are shown with it", () => {
  const { W } = load();
  const html = render(W, { view: "twin", twin: { snapshot: { generatedAt: "2026-09-17T10:00:00Z", sections: {}, notBuilt: {} }, loaded: true, forecast: { ok: true, prediction: { label: "PREDICTION - NOT AN OBSERVED FACT", pointEstimate: 1.33, horizonDays: 1,
    uncertainty: { lowerBound: 0.39, upperBound: 2.27 }, inputWindow: { from: "2026-09-14T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z", sampleSize: 3 },
    method: "mean of blood units requested each day", inputs: [{ atIso: "2026-09-14T00:00:00.000Z", value: 2 }, { atIso: "2026-09-15T00:00:00.000Z", value: 0 }, { atIso: "2026-09-16T00:00:00.000Z", value: 2 }] } } } });
  const t = text(html);
  assert.match(t, /Worked out as: mean of blood units requested each day/);
  assert.match(t, /The daily counts behind this number 2 2026-09-14 0 2026-09-15 2 2026-09-16/);
});
