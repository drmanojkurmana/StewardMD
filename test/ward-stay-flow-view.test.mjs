/* test/ward-stay-flow-view.test.mjs - the screens for the expected discharge date and transfer requests, in ward.js.
 *
 * Rendered from the real ward.js in a sandbox: the date and "overdue" on the ward list, the chart's card, the ward
 * list's Transfer requests board and the command center's two cards; loading, failed and empty never look alike.
 * The steps post what the server needs (the request's version, the bed typed), through the real askFor dialog.
 * The routes themselves are tested in test/wardsynq-stay-flow.test.mjs.
 *
 * node --test test/ward-stay-flow-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WARD_SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function load() {
  const calls = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? "tok" : ""), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url, opts) => { calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, written: 1, requests: [] }) }); },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(WARD_SRC, sb);
  return { W: sb.window.WARD, calls };
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&rarr;/g, "->").replace(/&hellip;/g, "...").replace(/\s+/g, " ");
const render = (W, s) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, ...s })));
const PATIENT = { encounterId: "enc-1", patientId: "pat-1", name: "Asha Rao", mrn: "MRN-1", ward: "Medical A", bed: "3", class: "IPD", admittedAt: "2026-09-10T04:00:00.000Z" };
const REQ = { id: "xfer-1", version: 2, encounterId: "enc-1", patientId: "pat-1", name: "Asha Rao", mrn: "MRN-1", status: "accepted", urgency: "urgent",
  from: { ward: "Medical A", bed: "3" }, to: { unit: "ward", ward: "Surgical B", requestedBed: "5" }, reason: "Needs surgical review", requestedAt: "2026-09-16T04:00:00.000Z", requestedBy: "dr-1" };

test("WARD LIST: the stated date and overdue on the row, unreadable said, none shows nothing; the Transfer requests board never shows loading or failed as none", () => {
  const { W } = load();
  const list = (patients, transfers) => text(render(W, { view: "list", patients, transfers }));
  const rows = list([{ ...PATIENT, expectedDischarge: { date: "2026-01-02", overdue: true, dueToday: false } }, { ...PATIENT, encounterId: "enc-2", name: "B Two", expectedDischarge: false }, { ...PATIENT, encounterId: "enc-3", name: "C Three", expectedDischarge: null }], []);
  assert.match(rows, /Discharge overdue: expected 2026-01-02/);
  assert.match(rows, /expected discharge not readable/);
  assert.ok(!/discharge/i.test(rows.slice(rows.indexOf("C Three"), rows.indexOf("chevron_right", rows.indexOf("C Three")))), "a stay with no date carries no discharge words");
  assert.match(list([], null), /Transfer requests Loading\.\.\./);
  assert.match(list([], false), /Transfer requests could not be loaded\. Do not read this as none\./);
  assert.match(list([], []), /No open transfer requests\./);
  const html = render(W, { view: "list", patients: [], transfers: [REQ] });
  assert.match(text(html), /Asha Rao · MRN-1 Urgent Medical A bed 3 -> Surgical B \(asked for bed 5\) · Accepted, waiting for a bed/);
  assert.ok(html.includes('data-w-act="xferbed:xfer-1"') && !html.includes("xferaccept:xfer-1") && !html.includes("xferexec:xfer-1"), "an accepted request offers the bed step, not accept or move");
  assert.ok(render(W, { view: "list", patients: [], transfers: [{ ...REQ, status: "requested" }] }).includes('data-w-act="xferdecline:xfer-1"'));
  assert.ok(render(W, { view: "list", patients: [], transfers: [{ ...REQ, status: "bed-assigned", bed: { bed: "5" } }] }).includes('data-w-act="xferexec:xfer-1"'));
});

test("CHART CARD: loading, failed and not set are three different things; a set date offers a change with a reason; an open request offers cancel, none offers the request form", () => {
  const { W } = load();
  const chart = (stayPlan) => render(W, { view: "chart", sel: PATIENT, stayPlan });
  assert.match(text(chart(null)), /Expected discharge and transfer refresh Loading\.\.\./);
  assert.match(text(chart({ edd: false, xfer: false })), /could not be loaded\. Do not read this as not set\..*Transfer requests could not be loaded\. Do not read this as none\./);
  const none = chart({ edd: { current: null, history: [] }, xfer: [] });
  assert.match(text(none), /No expected discharge date is set\./); assert.ok(none.includes('data-w-act="eddsave"') && none.includes('data-w-act="xferrequest"'));
  assert.match(text(none), /Set the date/);
  const set = chart({ edd: { current: { date: "2026-09-20", overdue: false, dueToday: false, version: 2, setAt: "2026-09-16T04:00:00.000Z", setBy: "dr-1", reason: "Awaiting cultures" },
    history: [{ expectedDate: "2026-09-20", setAt: "2026-09-16T04:00:00.000Z", setBy: "dr-1", reason: "Awaiting cultures" }, { expectedDate: "2026-09-18", setAt: "2026-09-12T04:00:00.000Z", setBy: "dr-1" }] },
    xfer: [{ ...REQ, status: "requested" }] });
  assert.match(text(set), /2026-09-20 expected discharge 2026-09-20/); assert.match(text(set), /Reason for the change/); assert.match(text(set), /2026-09-18/);
  assert.ok(set.includes('data-w-act="xfercancel:xfer-1"') && !set.includes('data-w-act="xferrequest"'), "one open request: cancel it, no second request form");
  assert.equal(render(W, { view: "chart", sel: { ...PATIENT, class: "ED" }, stayPlan: null }).includes("Expected discharge and transfer"), false, "not on an ED chart");
});

test("COMMAND CENTER: overdue discharges and open transfer requests, each with could-not-read distinct from none", () => {
  const { W } = load();
  const flow = (f) => text(render(W, { view: "flowcommand", flow: { loaded: true, flow: { computedAt: "2026-09-16T04:00:00.000Z", ed: { arrivals: 0, untriaged: 0 },
    beds: { occupied: 0, unplacedPatients: 0, states: {} }, admissionsPending: { waiting: 0, longestWaitHours: 0 }, dischargeCandidates: 0, bottlenecks: [], drill: {}, ...f } } }));
  assert.match(flow({ overdueDischarges: null, pendingTransfers: null }), /Expected discharge dates could not be read\. Do not read this as none overdue\..*Transfer requests could not be loaded/);
  assert.match(flow({ overdueDischarges: [], pendingTransfers: [] }), /No open stay is past the expected discharge date its team set\..*No open transfer requests\./);
  const full = flow({ overdueDischarges: [{ ...PATIENT, expectedDischarge: { date: "2026-09-14", overdue: true } }], pendingTransfers: [{ ...REQ, requestId: "xfer-1" }] });
  assert.match(full, /Asha Rao Medical A · bed 3 · Discharge overdue: expected 2026-09-14/);
  assert.match(full, /Asha Rao Medical A bed 3 -> Surgical B \(asked for bed 5\) · Urgent · Accepted, waiting for a bed/);
});

test("STEPS: assigning a bed posts the request's version and the bed typed in the dialog; a step with no reason is not sent", async () => {
  const { W, calls } = load();
  Object.assign(W._st, { orgId: "org-1", view: "list", transfers: [REQ] });
  W._dispatch("xferbed:xfer-1");
  assert.equal(W._st.ask.values.bed, "5", "the bed asked for is offered");
  W._st.ask.values.bed = "7";
  W._dispatch("askok");
  await new Promise((r) => setTimeout(r, 20));
  const post = calls.find((c) => c.url.endsWith("/ward/transfer-assign-bed"));
  assert.deepEqual(post && post.body, { orgId: "org-1", requestId: "xfer-1", expectedVersion: 2, bed: "7" });

  W._st.ask = null; W._st.transfers = [{ ...REQ, status: "requested", version: 1 }];
  W._dispatch("xferdecline:xfer-1");
  W._dispatch("askok");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.filter((c) => c.url.endsWith("/ward/transfer-respond")).length, 0, "a decline with no reason is refused on screen");
  assert.match(W._st.ask.err, /Say why the transfer is declined\./);
});
