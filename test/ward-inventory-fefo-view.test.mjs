/* Inventory screen: a failed load is not empty stock, and batch advice renders what the server said. */
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
const v = (W, inv) => W._render({ ...W._st, view: "inventory", inventory: inv });

test("loading, failed and genuinely empty stock are different sentences", () => {
  const W = loadWard();
  assert.match(v(W, null), /Loading stock/);
  const failed = v(W, { failed: true });
  assert.match(failed, /Do not read this as no stock/);
  assert.ok(!/No stock movements recorded yet/.test(failed));
  assert.match(v(W, { stock: { ok: true, levels: [], expiring: [] } }), /No stock movements recorded yet/);
  assert.match(v(W, { stock: { ok: true, levels: [], expiring: [], truncatedWarning: "only the latest 1000" } }), /only the latest 1000/);
});

test("batch advice shows picks, what was left out and why, a shortfall, and a refusal", () => {
  const W = loadWard();
  const html = v(W, { stock: { ok: true, levels: [], expiring: [] }, fefo: { ok: true, unit: "vial", picks: [{ batch: "SOON", expiry: "2098-01-01", take: 4 }], shortfall: 2, excluded: [{ batch: "OLD", onHand: 3, why: "expired" }], note: "Advice only." } });
  assert.match(html, /Batch SOON/);
  assert.match(html, /take 4 vial/);
  assert.match(html, /Short by 2 vial/);
  assert.match(html, /Batch OLD[\s\S]*expired[\s\S]*do not issue/);
  const refused = v(W, { stock: { ok: true, levels: [], expiring: [] }, fefo: { ok: false, error: "unbatched_issues", detail: "batch counts cannot be trusted" } });
  assert.match(refused, /batch counts cannot be trusted/);
  assert.ok(!/Batch /.test(refused.split("Which batch to use")[1]));
});
