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
