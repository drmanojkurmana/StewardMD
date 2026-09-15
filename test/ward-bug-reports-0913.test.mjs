/* The owner's Report Bug entries of 2026-09-13 (docs/wardsynq/BUG_REPORTS.md), one test per fixed report id.
 * No patient data: every fixture here is invented and carries no real name or MRN. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");

function loadWard(opts) {
  opts = opts || {};
  const els = opts.els || {};
  const posts = [];
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: opts.fetch || ((url, init) => { posts.push({ url, body: init && init.body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); }),
    setTimeout, clearTimeout, console, Promise, Date,
    confirm: opts.confirm || (() => true), prompt: opts.prompt || (() => ""),
  };
  Object.assign(sandbox, opts.globals || {});
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(SRC, sandbox);
  return { W: sandbox.window.WARD, posts };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

// ---- BUG-MU06X41N-V874: the ICD search the ward already calls --------------------------------------
test("BUG-MU06X41N-V874: /api/icd/search accepts the Origin wardsynq.com's worker forwards, and still refuses others", async () => {
  const { onRequest } = await import("../functions/api/icd/[[path]].js");
  const call = async (origin) => {
    let queried = false;
    const env = { ICD_DB: { prepare() { queried = true; throw new Error("stub"); } } };
    const request = new Request("https://stewardmd.in/api/icd/search?q=diabetes", { headers: { Origin: origin } });
    const res = await onRequest({ request, env, params: { path: ["search"] } });
    return { queried, body: await res.json() };
  };
  assert.equal((await call("https://wardsynq.com")).queried, true, "wardsynq.com was refused before the lookup ran");
  const evil = await call("https://evil.example");
  assert.equal(evil.queried, false);
  assert.equal(evil.body.error, "unavailable");
});

test("BUG-MU06X41N-V874: the scheme package search accepts wardsynq.com too", () => {
  const s = readFileSync(fileURLToPath(new URL("../functions/api/schemes/[[path]].js", import.meta.url)), "utf8");
  assert.match(s, /o === "https:\/\/wardsynq\.com"/);
});

test("BUG-MU06X41N-V874: an unavailable ICD search is said as unavailable, never as 'No matching code'", async () => {
  const { W } = loadWard({
    els: { wProbText: { value: "type 2 diabetes" }, wProbCode: { value: "" } },
    fetch: (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/\/api\/icd\//.test(url) ? { results: [], error: "unavailable" } : { ok: true }) }),
  });
  W._st.orgId = "org-test";
  W._dispatch("icd");
  await tick();
  assert.notEqual(Array.isArray(W._st.icd) && W._st.icd.length === 0, true, "an unavailable search was stored as an empty result");
  assert.match(W._st.err, /code search is unavailable/);
  const html = W._render({ ...W._st, view: "chart", sel: { class: "IPD", patientId: "p1", encounterId: "e1" }, icd: W._st.icd });
  assert.ok(!/No matching code/.test(html));
});

test("BUG-MU06X41N-V874: typing in the ICD code box searches the list as the words box does", () => {
  assert.match(SRC, /e\.target\.id === "wProbText" \|\| e\.target\.id === "wProbCode"/);
});

// ---- BUG-MU06Z46U-DMDX / BUG-MU08T4RL-GU0N: department and destination come from the bed board ---------
const BOARD = { ok: true, wards: [
  { ward: "CCU", department: "Cardiology", occupied: [], unplaced: [], free: ["1"], bedsKnown: true },
  { ward: "General A", department: "General Medicine", occupied: [], unplaced: [], free: ["4"], bedsKnown: true },
] };

test("BUG-MU06Z46U-DMDX: no fixed department list, and nothing claims a department that is never recorded", () => {
  assert.ok(!SRC.includes("HOSPITAL_DEPARTMENTS"));
  assert.ok(!SRC.includes("edAdmitDept"));
  const { W } = loadWard();
  const html = W._render({ ...W._st, view: "board", board: BOARD, edAdmitPending: true, sel: { class: "ED", patientId: "p1", encounterId: "e1", mrn: "TEST-1" } });
  assert.match(html, /Admitting <b>TEST-1<\/b> from the ED: choose the department, then a free bed/);
  assert.match(html, /<select id="wBoardDept">/);
  const only = W._render({ ...W._st, view: "board", board: BOARD, boardDept: "Cardiology" });
  assert.match(only, /CCU/);
  assert.ok(!/General A/.test(only), "the department filter did not narrow the wards");
});

test("BUG-MU08T4RL-GU0N: a transfer picks a real ward and bed on the board and posts exactly that", async () => {
  const posts = [];
  const { W } = loadWard({
    fetch: (url, init) => {
      if (init && init.method === "POST") posts.push({ url, body: JSON.parse(init.body) });
      const body = /\/ward\/beds/.test(url) ? BOARD : { ok: true, written: 1, patients: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
  });
  W._st.orgId = "org-test";
  W._st.sel = { class: "IPD", patientId: "p1", encounterId: "e1", ward: "General A", bed: "2", name: "Test Patient" };
  W._st.view = "chart";
  W._dispatch("move");
  await tick();
  assert.equal(W._st.view, "board");
  const html = W._render(W._st);
  assert.match(html, /Transferring <b>Test Patient<\/b> from General A, bed 2/);
  assert.match(html, /data-w-act="transferward:CCU"/);
  W._dispatch("pickbed:CCU|1");
  await tick();
  const t = posts.find((p) => /\/ward\/transfer$/.test(p.url));
  assert.ok(t, "no transfer was posted");
  assert.equal(t.body.ward, "CCU");
  assert.equal(t.body.bed, "1");
  assert.equal(W._st.transferPending, false);
});

test("BUG-MU072XAL-4EHO: the bed board reaches Admin Center, Wards; it has no bed editing of its own", () => {
  const { W } = loadWard();
  assert.ok(!/data-w-act="managebeds"/.test(W._render({ ...W._st, view: "board", board: BOARD })), "offered where there is no Admin Center");
  // wardsynq.com: the shell's WSQ is present.
  const went = [];
  const WSQ = { state: {}, go: (p) => went.push(p) };
  const site = loadWard({ globals: { WSQ } });
  assert.match(site.W._render({ ...site.W._st, view: "board", board: BOARD }), /data-w-act="managebeds"/);
  site.W._dispatch("managebeds");
  assert.deepEqual(went, ["admin"]);
  assert.equal(WSQ.state._adminTab, "wards");
  assert.ok(!/bedadd|bedremove/.test(SRC));
});

// ---- BUG-MU08DSH6-N7FM / BUG-MU09DOEX-I3GT: a bed tile and a critical result open the chart ------------
test("BUG-MU08DSH6-N7FM: tapping an occupied bed opens THAT patient's chart, loading the ward list when needed", async () => {
  const PATIENTS = [{ encounterId: "enc-7", patientId: "p7", name: "Bed Seven", ward: "CCU", bed: "7", class: "IPD" }];
  const gets = [];
  const { W } = loadWard({
    fetch: (url) => { gets.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/\/ward\/list/.test(url) ? { ok: true, patients: PATIENTS } : { ok: true }) }); },
  });
  W._st.orgId = "org-test";
  W._st.view = "board";
  W._dispatch("openbedpatient:enc-7");
  await tick(); await tick();
  assert.equal(W._st.view, "chart");
  assert.equal(W._st.sel && W._st.sel.encounterId, "enc-7");
  assert.ok(!gets.some((u) => /\/ward\/encounter\?/.test(u)), "asked a route the server does not have");
});

test("BUG-MU09DOEX-I3GT: a critical result offers Open chart, and acknowledging names the next step", () => {
  const { W } = loadWard();
  const html = W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "l1", patientId: "p7", encounterId: "enc-7", display: "Potassium", value: "6.9", state: "open", escalation: {} }] });
  assert.match(html, /data-w-act="openbedpatient:enc-7"/);
  assert.match(SRC, /Acknowledged\. Next: Open chart to write a note, place an order or reassess\./);
});

// ---- BUG-MU06DWAT-VZ9C: the note opens on choosing it, and a failed template list is visible ------------
test("BUG-MU06DWAT-VZ9C: choosing a note template opens its headings without a separate Open click", () => {
  const { W } = loadWard();
  const TPL = [{ id: "assessment", name: "Clinical assessment & admission", sections: [{ key: "complaints", title: "Chief complaints" }] }];
  const sel = { class: "ED", patientId: "p1", encounterId: "e1" };
  const before = W._render({ ...W._st, view: "chart", sel, templates: TPL, noteTemplateId: "" });
  assert.ok(!/data-w-act="pickTpl"/.test(before), "the extra Open button is still there");
  assert.match(SRC, /t\.id === "wNoteTpl"\) \{ st\.noteTemplateId = t\.value;/);
  const after = W._render({ ...W._st, view: "chart", sel, templates: TPL, noteTemplateId: "assessment" });
  assert.match(after, /Chief complaints/);
});

test("BUG-MU06DWAT-VZ9C: note templates that failed to load say so instead of the note card vanishing", async () => {
  const { W } = loadWard({ fetch: () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ ok: false, error: "record_read_failed" }) }) });
  W._st.orgId = "org-test";
  const html = W._render({ ...W._st, view: "chart", sel: { class: "ED", patientId: "p1", encounterId: "e1" }, templates: false });
  assert.match(html, /note templates could not be loaded/);
});

// ---- BUG-MU08MEQI-JZH1: one vitals set is one timeline row, and nothing else is filed under it -----------
test("BUG-MU08MEQI-JZH1: vitals charted together are one row; a laboratory value at the same minute is not a vital", () => {
  const { W } = loadWard();
  const at = "2026-09-13T08:00:00.000Z";
  const events = [
    { id: "o1", at, resourceType: "Observation", category: "observation", label: "Heart rate: 88 /min" },
    { id: "o2", at, resourceType: "Observation", category: "observation", label: "Respiratory rate: 18 /min" },
    { id: "o3", at, resourceType: "Observation", category: "observation", label: "Thrombocytes: 90 10*3/uL" },
    { id: "o4", at, resourceType: "Observation", category: "observation", label: "Chloride: 99 mmol/L" },
  ];
  const html = W._render({ ...W._st, view: "chart", sel: { class: "IPD", patientId: "p1", encounterId: "e1" }, timeline: events });
  assert.match(html, /Vital signs set: Heart rate: 88 \/min · Respiratory rate: 18 \/min/);
  assert.ok(!/Vital signs set:[^<]*Thrombocytes/.test(html), "a platelet count was filed as a vital sign");
  assert.ok(!/Vital signs set:[^<]*Chloride/.test(html));
  assert.match(html, /Thrombocytes: 90/);
});

// ---- BUG-MU06HOBO-488C: an infusion's duration never becomes its frequency ------------------------------
function orderWith(vals) {
  const els = {};
  for (const [k, v] of Object.entries(vals)) els[k] = { value: v };
  const posts = [];
  const { W } = loadWard({ els, fetch: (url, init) => { if (init && init.method === "POST") posts.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, written: 1, due: [] }) }); } });
  W._st.orgId = "org-test";
  W._st.sel = { class: "IPD", patientId: "p1", encounterId: "e1" };
  return { W, posts };
}
test("BUG-MU06HOBO-488C: thiamine in 100 mL D25 over 3 hrs is refused without a frequency, and sent as written with one", async () => {
  const base = { wMoDrug: "Thiamine", wMoValue: "200", wMoUnit: "mg", wMoRoute: "", wMoDiluentVal: "100 mL D25", wMoInfDuration: "3 hrs" };
  const a = orderWith({ ...base, wMoFreq: "" });
  a.W._dispatch("medorder");
  await tick();
  assert.equal(a.posts.filter((p) => /medication-order/.test(p.url)).length, 0, "an order with an invented frequency was sent");
  assert.match(a.W._st.err, /duration is not a frequency/);
  const b = orderWith({ ...base, wMoFreq: "OD" });
  b.W._dispatch("medorder");
  await tick();
  const sent = b.posts.find((p) => /medication-order/.test(p.url));
  assert.ok(sent, "the order was not sent");
  assert.equal(sent.body.order.frequency, "OD");
  assert.equal(sent.body.order.route, "IV infusion in 100 mL D25 over 3 hrs");
});

// ---- BUG-MU0710W4-04KD: ward list filters ---------------------------------------------------------------
test("BUG-MU0710W4-04KD: department filter from the record; no 'doctor' search that matched nothing; selects apply on change", () => {
  const { W } = loadWard();
  const pts = [
    { encounterId: "e1", patientId: "p1", name: "Alpha Test", ward: "CCU", department: "Cardiology", class: "IPD", admittedAt: new Date().toISOString() },
    { encounterId: "e2", patientId: "p2", name: "Beta Test", ward: "General A", department: null, class: "IPD", admittedAt: new Date().toISOString() },
  ];
  assert.deepEqual(W.filterRoster(pts, "", "", { dept: "Cardiology" }).map((p) => p.encounterId), ["e1"]);
  assert.deepEqual(W.filterRoster(pts, "", "cardio", {}).map((p) => p.encounterId), ["e1"], "search reaches the department");
  const html = W._render({ ...W._st, view: "list", patients: pts, loaded: true });
  assert.match(html, /<select id="wRosterDeptFilter"/);
  assert.ok(!/or doctor/.test(html), "the search box still promises a doctor search the list cannot do");
  assert.ok(!/data-w-act="rosterfilter:/.test(html), "a filter select still repaints on click, closing itself");
});

// ---- BUG-MU06NW2S-8D53: the ED board shows sex in bold, from the record ----------------------------------
test("BUG-MU06NW2S-8D53: the ED board and ED chart show the recorded sex in bold, and nothing when none is recorded", () => {
  const { W } = loadWard();
  const board = W._render({ ...W._st, view: "ed", ed: { patients: [
    { encounterId: "e1", patientId: "p1", name: "Board Test", mrn: "TEST-1", sex: "male" },
    { encounterId: "e2", patientId: "p2", mrn: "EMERG-UNKNOWN-0001", sex: null },
  ] } });
  assert.match(board, /<b>Board Test · TEST-1<\/b> &middot; <b class="w-sex">MALE<\/b>/);
  assert.equal((board.match(/class="w-sex"/g) || []).length, 1, "a patient with no recorded sex was given one");
  const chart = W._render({ ...W._st, view: "chart", sel: { class: "ED", patientId: "p1", encounterId: "e1", mrn: "TEST-1", name: "Board Test", sex: "female" } });
  assert.match(chart, /<b class="w-sex">FEMALE<\/b>/);
});

// ---- BUG-MU09M56N-TOP1 / BUG-MU09NX9N-JJMQ: the laboratory board -------------------------------------
const LAB_BOARD = {
  specimens: [], toVerify: [], cultures: [], histopathology: [], criticals: [], errors: [], failed: {},
  pending: [
    { serviceRequestId: "sr-cbc", display: "CBC", category: "laboratory", patientId: "p1" },
    { serviceRequestId: "sr-cxr", display: "Chest X-ray PA", category: "laboratory", patientId: "p1" },
  ],
};
const labHtml = (W, extra) => W._render({ ...W._st, view: "labboard", labBoard: { ...LAB_BOARD, ...(extra || {}) }, labDept: (extra && extra.dept) || "all", list: [] });

test("BUG-MU09M56N-TOP1: the Microbiology and Pathology tabs can start a culture or a histopathology report", () => {
  const { W } = loadWard();
  const micro = labHtml(W, { dept: "micro" });
  assert.match(micro, /data-w-act="cultureopen:sr-cbc"/, "microbiology had no way to start a culture");
  assert.ok(!/labresultopen:sr-cbc/.test(micro));
  const path = labHtml(W, { dept: "path" });
  assert.match(path, /data-w-act="histoopen:sr-cbc"/, "pathology had no way to start a report");
  const hb = labHtml(W, { dept: "hema_bio" });
  assert.match(hb, /labresultopen:sr-cbc/);
  assert.ok(!/cultureopen:sr-cbc/.test(hb));
});

test("BUG-MU09NX9N-JJMQ: an X-ray awaiting its report is not offered a blood result entry, and is still listed", () => {
  const { W } = loadWard();
  const html = labHtml(W);
  assert.ok(!/labresultopen:sr-cxr/.test(html), "the X-ray was offered Enter result among the blood tests");
  assert.match(html, /Imaging orders &middot; 1/);
  assert.match(html, /Chest X-ray PA/);
  assert.match(html, /data-w-act="radboard"/);
});

test("BUG-MU09M56N-TOP1: a laboratory list that failed to load says so in its own card, never 'No tests awaiting'", () => {
  const { W } = loadWard();
  const html = labHtml(W, { pending: [], failed: { "tests awaiting a result": true, specimens: true }, errors: ["tests awaiting a result", "specimens"] });
  assert.ok(!/No tests awaiting a result/.test(html));
  assert.ok(!/No specimens awaiting collection/.test(html));
  assert.match(html, /Could not be read\. Do not read this as none\./);
});
