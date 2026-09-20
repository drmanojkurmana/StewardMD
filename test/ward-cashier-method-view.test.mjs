/* The cashier's payment-method picker, rendered for real. */
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

const view = (W, extra) => W._render({ ...W._st, view: "cashier", cashier: { patientId: null }, ...extra });

test("cash asks for the counter and cashier, and nothing a bank transfer needs", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: "cash" });
  assert.ok(html.includes('id="wPay_counter"'));
  assert.ok(html.includes('id="wPay_cashier"'));
  assert.ok(!html.includes('id="wPay_utr"'), "a cashier taking cash should not be shown a UTR box");
});

test("a bank transfer asks for the UTR, the bank and who paid", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: "neft" });
  assert.ok(html.includes('id="wPay_utr"'));
  assert.ok(html.includes('id="wPay_bank"'));
  assert.ok(html.includes('id="wPay_payer"'));
  assert.ok(!html.includes('id="wPay_counter"'));
});

test("a card payment asks for the machine and the slip reference", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: "card" });
  assert.ok(html.includes('id="wPay_terminal"'));
  assert.ok(html.includes('id="wPay_reference"'));
});

test("THERE IS NO WAY TO MARK A PAYMENT AS CONFIRMED BY A CARD MACHINE FROM THIS SCREEN", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: "card" });
  assert.match(html, /never marked as confirmed by a card machine from here/);
  assert.ok(!/confirmed["']?\s*type="checkbox"|id="wPay_capture"|id="wPay_settlement"/.test(html), "no capture or settlement control may exist");
});

test("the chosen method stays chosen across a repaint", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: "upi" });
  assert.match(html, /<option value="upi" selected>UPI<\/option>/);
});

test("with no method chosen yet, cash is the default", () => {
  const W = loadWard();
  const html = view(W, { cashMethod: undefined });
  assert.ok(html.includes('id="wPay_counter"'));
});
