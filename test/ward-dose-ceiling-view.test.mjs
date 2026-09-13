/* The paediatric maximum-dose check, rendered for real. */
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

const SEL = { patientId: "p1", encounterId: "e1", name: "Aarav", class: "PEDIATRICS", admittedAt: "2026-09-14T08:00:00.000Z" };
const chart = (W, extra) => W._render({ ...W._st, view: "chart", sel: SEL, ...extra });

test("a paediatric chart offers the maximum-dose check", () => {
  const W = loadWard();
  const html = chart(W);
  assert.ok(html.includes('data-w-act="childdoselimit"'));
  assert.ok(html.includes('id="wLimMgKg"'));
});

test("with no weight, the screen shows the refusal, never a number", () => {
  const W = loadWard();
  const html = chart(W, { limitResult: { limitMg: null, cappedByAdult: false, reasons: [{ code: "NO_WEIGHT", message: "a child dose cannot be calculated without a recorded weight" }] } });
  assert.match(html, /cannot be calculated without a recorded weight/);
  assert.ok(!/Maximum \d/.test(html));
});

test("a dose capped by the adult maximum says so", () => {
  const W = loadWard();
  const html = chart(W, { limitResult: { limitMg: 1000, cappedByAdult: true, reasons: [{ code: "ADULT_CAP", message: "weight-based 1200 mg exceeds the adult maximum 1000 mg, so the adult maximum applies" }] } });
  assert.match(html, /Maximum 1000 mg/);
  assert.match(html, /adult maximum applies/);
});
