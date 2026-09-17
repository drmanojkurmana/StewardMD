/* R4-1 made every census route answer 503 error "too_many_open" past the open-stay ceiling. R4-5: every ward.js
 * screen that calls one says so in one translated sentence, and none of them reads as an empty ward. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const REFUSAL = { ok: false, status: 503, error: "too_many_open", detail: "more than 5000 Encounter records matched; the read was refused rather than shortened" };
const SENTENCE = /Too many open stays to show safely\. Close visits that are finished/;

function loadWard(answer) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const calls = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: (url) => { calls.push(String(url)); return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(answer(String(url))))) }); },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  const W = sb.window.WARD; W._st.orgId = "org1";
  return { W, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const census = (path) => (url) => (url.includes(path) ? REFUSAL : { ok: true });

for (const [cmd, path, view] of [
  ["reload", "/ward/list", "list"],
  ["board", "/ward/beds", "board"],
  ["edboard", "/ward/ed-list", "ed"],
  ["flowcommand", "/ward/patient-flow", "flowcommand"],
  ["surgeryboard", "/ward/surgery-board", "surgery"],
  ["downtime", "/ward/downtime", "downtime"],
  ["nurseworklist", "/ward/nurse-worklist", "nurseworklist"],
]) {
  test(`${path}: a census refusal is the translated sentence, not an empty screen or a code`, async () => {
    const { W, calls } = loadWard(census(path));
    W._dispatch(cmd);
    await settle();
    assert.ok(calls.some((u) => u.includes(path)), `${cmd} calls ${path}`);
    const html = W._render({ ...W._st, view });
    assert.match(html, SENTENCE);
    assert.ok(!html.includes("too_many_open"), "no raw code on screen");
    assert.ok(!/No patients are currently admitted|No patients currently in the ED|nothing to print/.test(html), "never an empty list");
  });
}

test("the ward list after a failed load says not loaded, never 'No patients are currently admitted'", async () => {
  const { W } = loadWard(census("/ward/list"));
  W._dispatch("reload");
  await settle();
  const html = W._render({ ...W._st, view: "list", err: "" });
  assert.match(html, /The ward list was not loaded/);
  assert.ok(!/No patients are currently admitted/.test(html));
});

test("admitting (POST /ward/admit) past the ceiling shows the sentence and does not report an admission", async () => {
  const { W } = loadWard(census("/ward/admit"));
  W._st.admitTarget = { ward: "A", bed: "1" }; W._st.mrnLookup = { mrn: "M1", name: "X" };
  W._dispatch("admitconfirm");
  await settle();
  assert.match(W._st.err, SENTENCE);
  assert.ok(!/Admitted to/.test(W._st.note || ""));
});

test("digital twin ICU card: a census refusal is the sentence; the removed encounterReadCapped flag is no longer read", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const section = (s) => ({ generatedAt: "2026-09-17T10:00:00Z", sectionsOk: 0, sectionsTotal: 1, sections: { icu: s } });
  let html = W._render({ ...W._st, view: "twin", twin: { loaded: true, snapshot: section({ status: "unavailable", error: "too_many_open", detail: REFUSAL.detail }) } });
  assert.match(html, SENTENCE);
  assert.ok(!html.includes("too_many_open"));
  html = W._render({ ...W._st, view: "twin", twin: { loaded: true, snapshot: section({ status: "ok", freshness: "live", generatedAt: "2026-09-17T10:00:00Z",
    data: { occupied: 2, ventilatedRecorded: 0, vasopressorsRecorded: 0, recordsCapped: false, encounterReadCapped: true } }) } });
  assert.ok(!/Read limit reached/.test(html), "only recordsCapped warns now");
  html = W._render({ ...W._st, view: "twin", twin: { loaded: true, snapshot: section({ status: "ok", freshness: "live", generatedAt: "2026-09-17T10:00:00Z",
    data: { occupied: 2, ventilatedRecorded: 0, vasopressorsRecorded: 0, recordsCapped: true } }) } });
  assert.match(html, /Read limit reached/);
});

/* R5-1: the flow board's companion reads. A truncated Condition / DiagnosticReport read makes open
 * items UNKNOWN for every stay, and an unread bed master makes the bed states unknown. Neither may
 * render as a zero. */
const FLOW = {
  computedAt: "2026-09-17T10:00:00Z",
  ed: { arrivals: 0, untriaged: 0 }, admissionsPending: { waiting: 0, longestWaitHours: 0 },
  beds: { occupied: 2, unplacedPatients: 0, wardsKnown: 1, states: { available: 1, reserved: 0, occupied: 2, blocked: 0, cleaning: 0, maintenance: 0 } },
  dischargeCandidates: 0, openItemsUnknown: [], staysWithOpenItems: [], recentTransfers: [],
  overdueDischarges: [], pendingTransfers: [], bottlenecks: [], drill: {},
};
test("patient flow: open items that could not be counted say so, and never read as 'ready to leave'", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const unknown = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: { ...FLOW, dischargeCandidates: null, openItemsUnknown: ["Condition", "DiagnosticReport"] } } });
  assert.match(unknown, /Open items could not be counted for any stay/);
  assert.match(unknown, /Condition, DiagnosticReport/);
  assert.ok(!/Nothing outstanding right now is a live fact/.test(unknown), "the fact sentence is not shown when nothing was counted");
  assert.match(unknown, /stays with nothing outstanding right now: not known/);

  const counted = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: FLOW } });
  assert.ok(!/could not be counted/.test(counted));
  assert.match(counted, /Nothing outstanding right now is a live fact/);
});

test("patient flow: a bed master that could not be read is said, not drawn as zero blocked beds", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const unread = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: { ...FLOW, beds: { ...FLOW.beds, states: null } } } });
  assert.match(unread, /The bed list could not be read/);
  assert.ok(!/Blocked 0/.test(unread));

  const read = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: FLOW } });
  assert.match(read, /Blocked 0/);
  assert.ok(!/The bed list could not be read/.test(read));
});

test("bed board: a ward master that could not be read is said, not drawn as a hospital with no wards", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const unread = W._render({ ...W._st, view: "board", board: { ok: true, wards: [], bedsConfigured: false, wardsUnread: true } });
  assert.match(unread, /ward list could not be read/);
  const read = W._render({ ...W._st, view: "board", board: { ok: true, wards: [], bedsConfigured: false } });
  assert.ok(!/ward list could not be read/.test(read));
  assert.match(read, /No admissions and no bed lists configured/);
});

test("waiting list: who is admitted could not be checked is said, with the census sentence when that is why", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const html = W._render({ ...W._st, view: "admreqs", admReqs: { ok: true, requests: [], admittedCheckFailed: true, admittedCheckError: "too_many_open" } });
  assert.match(html, SENTENCE);
  assert.match(html, /Who is already admitted could not be checked/);
  const plain = W._render({ ...W._st, view: "admreqs", admReqs: { ok: true, requests: [] } });
  assert.ok(!/could not be checked/.test(plain));
});
