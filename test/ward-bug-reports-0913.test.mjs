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
