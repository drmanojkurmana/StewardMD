/* R4-5: the purchase order form on the ward screen names the store the order is for, and POST /ward/purchase-order carries it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(answer, fields) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const posts = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: (id) => (fields && id in fields ? { value: fields[id] } : null), createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: (url, opts) => { if (opts && opts.method === "POST") posts.push({ url: String(url), body: JSON.parse(opts.body) }); return Promise.resolve({ json: () => Promise.resolve(answer(String(url))) }); },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  const W = sb.window.WARD; W._st.orgId = "org1";
  return { W, posts };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const STOCK = { ok: true, levels: [{ code: "A", location: "OT" }, { code: "B", location: "Central store" }, { code: "C", location: "ot" }, { code: "D", location: null }] };

test("the store names offered are the stores stock is held in, once each; a failed read says so and still lets a store be typed", async () => {
  const { W } = loadWard((u) => (u.includes("/ward/stock") ? STOCK : { ok: true, orders: [] }));
  W._dispatch("purchasing");
  await settle();
  const html = W._render(W._st);
  assert.match(html, /For which store/);
  assert.match(html, /<datalist id="wPoStores"><option value="Central store"><\/option><option value="OT"><\/option><\/datalist>/);
  const failed = loadWard((u) => (u.includes("/ward/stock") ? { ok: false, error: "permission" } : { ok: true, orders: [] }));
  failed.W._dispatch("purchasing");
  await settle();
  const fh = failed.W._render(failed.W._st);
  assert.match(fh, /The store names could not be loaded/);
  assert.match(fh, /id="wPoStore"/);
});

test("raising an order posts the typed store as location; an empty store sends none", async () => {
  const f = { wPoVendor: "Acme", wPoItem: "Gloves", wPoQty: "15", wPoUnit: "box", wPoPrice: "", wPoStore: "OT" };
  const { W, posts } = loadWard(() => ({ ok: true, written: 1, orders: [], levels: [] }), f);
  W._dispatch("poraise");
  await settle();
  const po = posts.find((p) => p.url.endsWith("/ward/purchase-order"));
  assert.equal(po.body.location, "OT");
  f.wPoStore = "";
  W._dispatch("poraise");
  await settle();
  assert.equal("location" in posts.filter((p) => p.url.endsWith("/ward/purchase-order"))[1].body, false);
});

test("an order list row names its store", () => {
  const { W } = loadWard(() => ({ ok: true }));
  const html = W._render({ ...W._st, view: "purchasing", purchaseOrders: [{ purchaseOrderId: "po1", vendor: "Acme", state: "open", location: "OT", lines: [] }] });
  assert.match(html, /for OT/);
});
