/* A patient's operations, and abandoning a case, rendered for real. */
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

const SEL = { patientId: "p1", name: "Ramesh Kumar" };
const LIVE = { id: "c1", procedure: "Appendicectomy", site: "abdomen", laterality: "not-applicable", stage: "booked", ledger: [{ event: "booked", detail: "x" }] };
const GONE = { id: "c2", procedure: "Hernia repair", laterality: "left", stage: "abandoned",
  ledger: [{ event: "booked", detail: "x" }, { event: "abandoned", actorId: "dr.s", detail: "Patient febrile, postponed" }] };

test("the operations list opens a case with an action that actually exists", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "patientsurgery", sel: SEL, patientCases: { ok: true, cases: [LIVE] } });
  assert.ok(html.includes("Appendicectomy"));
  assert.ok(html.includes('data-w-act="opensurgery:c1"'), "the Open button must use the real case-open action");
  assert.ok(!html.includes("surgeryopen:"), "a dead action name must never be rendered");
});

test("an abandoned case shows WHY, read from its ledger", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "patientsurgery", sel: SEL, patientCases: { ok: true, cases: [GONE] } });
  assert.ok(html.includes("Abandoned"));
  assert.ok(html.includes("Patient febrile, postponed"), "the reason lives in the ledger and must be shown");
});

test("a live case offers 'not going ahead'; a signed-out or abandoned one does not", () => {
  const W = loadWard();
  const live = W._render({ ...W._st, view: "surgerycase", surgCase: { case: LIVE } });
  assert.ok(live.includes('data-w-act="surgeryabandon:c1"'));

  const gone = W._render({ ...W._st, view: "surgerycase", surgCase: { case: GONE } });
  assert.ok(!gone.includes('data-w-act="surgeryabandon:'), "nothing to abandon twice");
  assert.match(gone, /Abandoned: Patient febrile, postponed/);
});

test("an unloaded operations list says loading, never 'none recorded'", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "patientsurgery", sel: SEL, patientCases: null });
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No operations recorded"));
});
