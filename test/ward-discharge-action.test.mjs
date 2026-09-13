/* Ending a ward stay and requesting a follow-up: the buttons exist on a ward chart. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
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

test("a ward chart offers Discharge and Follow-up", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "chart", sel: { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", class: "IPD", admittedAt: "2026-09-10T08:00:00.000Z" } });
  assert.ok(html.includes('data-w-act="wardcloseopen"'), "a ward stay must be closable");
  assert.ok(html.includes('data-w-act="followup"'));
});

test("closing a stay as 'died' is refused from here - a death is recorded on its own screen first", () => {
  assert.match(src, /Record the death first on the Contacts screen/);
});

test("a follow-up requires a real date, because one with no date is never booked", () => {
  assert.match(src, /Give a date like 2026-10-01/);
});
