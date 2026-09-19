/* Cashier: unbilled charges, cancelling a bill, the coding watchlist, and the failed-load fix. */
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

const view = (W, cashier) => W._render({ ...W._st, view: "cashier", cashier: { patientId: "p1", ...cashier } });

test("BUG FIX: bills that failed to load never read as 'no invoices'", () => {
  const W = loadWard();
  const html = view(W, { invoices: [], invoicesFailed: true });
  assert.match(html, /could not be loaded. Do not read this as nothing owed/);
  assert.ok(!html.includes("No invoices for this patient yet"), "a failed load must not tell a cashier the patient owes nothing");
});

test("an open bill can be cancelled", () => {
  const W = loadWard();
  const html = view(W, { invoices: [{ invoiceId: "inv1", status: "open", events: [], lines: [], balance: 10 }] });
  assert.ok(html.includes('data-w-act="invvoid:inv1"'));
});

test("unbilled charges are listed, and an item with no price is shown as a gap, not as free", () => {
  const W = loadWard();
  const html = view(W, { invoices: [], charges: { ok: true, priced: [{ display: "Bed day", amount: 1500 }], unpriced: [{ display: "Oxygen" }] } });
  assert.ok(html.includes("Bed day"));
  assert.match(html, /no price set.*Oxygen/);
});

test("charges that failed to load never read as 'nothing to bill'", () => {
  const W = loadWard();
  const html = view(W, { invoices: [], charges: { failed: true } });
  assert.match(html, /could not be loaded. Do not read this as nothing to bill/);
  assert.ok(!html.includes("Nothing waiting to be billed"));
});

test("claims coded differently after a refusal are shown for a person to decide", () => {
  const W = loadWard();
  const html = view(W, { invoices: [], watch: { ok: true, count: 1, reading: "1 claim had its clinical coding changed after a payer denial." } });
  assert.match(html, /changed after a payer denial/);
});
