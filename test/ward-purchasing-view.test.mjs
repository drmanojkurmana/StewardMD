/* Purchasing screen: totals and approver counts shown; loading, failed and none are different sentences. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const v = (W, extra) => W._render({ ...W._st, view: "purchasing", ...extra });

test("loading, failed and no orders read differently", () => {
  const W = loadWard();
  assert.match(v(W, { purchaseOrders: null }), /Loading purchase orders/);
  const failed = v(W, { purchaseOrders: null, purchaseOrdersFailed: true });
  assert.match(failed, /Do not read this as none/);
  assert.ok(!/No purchase orders\./.test(failed));
  assert.match(v(W, { purchaseOrders: [] }), /No purchase orders\./);
});

test("an order shows its total, or says the total is unknown, beside approvals needed", () => {
  const W = loadWard();
  const html = v(W, { purchaseOrders: [
    { purchaseOrderId: "po1", vendor: "MedSupply", state: "awaiting-approval", totalPaise: 22500000, approval: { approvals: 1, required: 2 }, lines: [] },
    { purchaseOrderId: "po2", vendor: "Gauze Co", state: "awaiting-approval", totalPaise: null, approval: { approvals: 0, required: 2 }, lines: [] },
  ] });
  assert.match(html, /approvals 1 of 2 &middot; total Rs 225000\.00/);
  assert.match(html, /total not known \(a line has no price\)/);
  assert.ok(html.includes('id="wPoPrice"'));
});
