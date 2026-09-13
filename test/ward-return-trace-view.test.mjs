/* Dispense returns and blood-unit tracing, rendered for real. */
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

test("a dispensed medicine can be returned; one already returned says so and cannot be returned again", () => {
  const W = loadWard();
  // Dispense history is shown inside the picked order's panel, so an order is picked here.
  const html = W._render({ ...W._st, view: "pharmacy", pharmacy: { pickedOrderId: "o1", queue: { orders: [{ orderId: "o1", drug: "Amoxicillin" }] }, dispenses: [
    { dispenseId: "d1", drug: "Amoxicillin", quantity: { value: 21, unit: "capsule" }, dispensedAt: "2026-09-13T10:00:00.000Z" },
    { dispenseId: "d2", drug: "Paracetamol", quantity: { value: 10, unit: "tablet" }, dispensedAt: "2026-09-13T09:00:00.000Z", returnedAt: "2026-09-13T12:00:00.000Z", returnReason: "Discharged" },
  ] } });
  assert.ok(html.includes('data-w-act="dispensereturn:d1"'));
  assert.ok(!html.includes('data-w-act="dispensereturn:d2"'), "a returned dispense cannot be returned twice");
  assert.match(html, /returned .*Discharged/);
});

test("a blood unit's trace lists every step", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "transfusion", transfusion: {}, bloodTrace: { ok: true, unitId: "U1", trace: [
    { at: "2026-09-13T10:00:00.000Z", event: "issued", patientId: "p1", by: "bb.a" },
    { at: "2026-09-13T10:30:00.000Z", event: "transfused", patientId: "p1", by: "nurse.b" },
  ] } });
  assert.ok(html.includes("issued"));
  assert.ok(html.includes("transfused"));
});

test("A TRACE THAT COULD NOT BE READ never reads as 'no record of this unit'", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "transfusion", transfusion: {}, bloodTrace: { ok: false } });
  assert.match(html, /could not be read/);
  assert.ok(!html.includes("No record of unit"));
});
