/* The bed waiting list, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const view = (W, d) => W._render({ ...W._st, view: "admreqs", admReqs: d });
const REQ = (extra) => ({
  requestId: "r1", patientId: "p1", mrn: "MRN-77", specialty: "Medicine", ward: "Ward A",
  reason: "Sepsis, needs IV antibiotics", urgency: "urgent", state: "waiting",
  requestedBy: "dr.a", requestedAt: "2026-09-13T08:00:00.000Z", waitingHours: 6, ...extra,
});

test("a waiting request shows how urgent, why, who asked and HOW LONG in hours", () => {
  const W = loadWard();
  const html = view(W, { ok: true, requests: [REQ()] });
  assert.ok(html.includes("MRN-77"));
  assert.ok(html.includes("Sepsis, needs IV antibiotics"));
  assert.match(html, /urgent/);
  assert.match(html, /waiting 6h/, "'waiting' alone does not say whether it is twenty minutes or two days");
  assert.ok(html.includes('data-w-act="admreqclose:r1~admitted"'));
  assert.ok(html.includes('data-w-act="admreqclose:r1~cancelled"'));
});

test("a closed request offers nothing to do and says how it was closed", () => {
  const W = loadWard();
  const html = view(W, { ok: true, requests: [REQ({ state: "cancelled", closeReason: "Discharged from ED instead" })] });
  assert.ok(html.includes("Discharged from ED instead"));
  assert.ok(!html.includes('data-w-act="admreqclose:r1'), "a closed request needs no buttons");
});

test("an unloaded list says loading, never 'nobody is waiting'", () => {
  const W = loadWard();
  const html = view(W, null);
  assert.match(html, /Loading/);
  assert.ok(!html.includes("Nobody is waiting for a bed"));
});

test("an empty loaded list is allowed to say nobody is waiting", () => {
  const W = loadWard();
  assert.match(view(W, { ok: true, requests: [] }), /Nobody is waiting for a bed/);
});

test("asking for a bed needs the patient and the reason", () => {
  const W = loadWard();
  const html = view(W, { ok: true, requests: [] });
  assert.ok(html.includes('id="wArMrn"'));
  assert.ok(html.includes('id="wArReason"'));
  assert.ok(html.includes('value="emergency"'));
});
