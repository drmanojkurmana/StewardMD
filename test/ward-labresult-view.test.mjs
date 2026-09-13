/* Lab result entry on the laboratory board, rendered for real. */
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

const PENDING = { serviceRequestId: "sr1", code: "U&E", display: "Urea and electrolytes", patientId: "p1", encounterId: "e1" };
const board = { specimens: [], pending: [PENDING], criticals: [], errors: [] };
const view = (W, extra) => W._render({ ...W._st, view: "labboard", labBoard: board, ...extra });

test("a test awaiting a result now has a way to enter one", () => {
  const W = loadWard();
  const html = view(W);
  assert.ok(html.includes('data-w-act="labresultopen:sr1"'), "the laboratory must be able to report a pending test");
});

test("the entry form names the test and asks for value and unit, reported against its order", () => {
  const W = loadWard();
  const html = view(W, { labResultFor: PENDING });
  assert.match(html, /Result for Urea and electrolytes/);
  assert.ok(html.includes('id="wLrVal0"'));
  assert.ok(html.includes('id="wLrUnit0"'));
  assert.match(html, /Nothing is converted or rounded/);
});

test("ROWS THE SERVER REJECTED ARE NAMED, never hidden behind a partial success", () => {
  const W = loadWard();
  const html = view(W, { labResultFor: PENDING, labResultOutcome: { ok: true, rejected: [{ index: 1, reason: "no_value", test: "Potassium" }] } });
  assert.match(html, /Not saved: Potassium \(no_value\)/);
});

test("with no test picked, no entry form is shown", () => {
  const W = loadWard();
  const html = view(W, { labResultFor: null });
  assert.ok(!html.includes('id="wLrVal0"'));
});

test("a sample in transit can be marked received or failed by the laboratory", () => {
  const W = loadWard();
  const spec = { serviceRequestId: "sr2", code: "FBC", display: "Full blood count", patientId: "p1", collection: { state: "collected", specimenId: "spc1" } };
  const html = W._render({ ...W._st, view: "labboard", labBoard: { specimens: [spec], pending: [], criticals: [], errors: [] } });
  assert.ok(html.includes('data-w-act="specreceived:spc1"'));
  assert.ok(html.includes('data-w-act="specfailed:spc1"'));
});
