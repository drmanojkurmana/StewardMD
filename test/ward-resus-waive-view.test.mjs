/* Resuscitation bundle waivers, rendered for real. */
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

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", class: "ED", arrivedAt: "2026-09-14T08:00:00.000Z" };
const bundle = (els) => [{ bundleId: "b1", state: "running", elements: els }];
const chart = (W, els) => W._render({ ...W._st, view: "chart", sel: SEL, resusBundles: bundle(els) });

test("an undone element can be marked done OR recorded as not appropriate", () => {
  const W = loadWard();
  const html = chart(W, [{ key: "fluids", label: "30 mL/kg fluids", done: false, minutesRemaining: 40 }]);
  assert.ok(html.includes('data-w-act="resusmark:b1|fluids"'));
  assert.ok(html.includes('data-w-act="resuswaive:b1|fluids"'));
});

test("A WAIVED ELEMENT NEVER READS AS OVERDUE OR COUNTING DOWN", () => {
  const W = loadWard();
  const html = chart(W, [{ key: "fluids", label: "30 mL/kg fluids", done: false, notApplicable: true, reason: "Heart failure", overdue: true, minutesRemaining: -10 }]);
  assert.match(html, /not appropriate: Heart failure/);
  assert.ok(!html.includes(">overdue<"), "a deliberate decision must not read as forgotten care");
  assert.ok(!html.includes("min left"));
  assert.ok(!html.includes('data-w-act="resuswaive:b1|fluids"'), "nothing to waive twice");
});
