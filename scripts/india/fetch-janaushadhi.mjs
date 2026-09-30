#!/usr/bin/env node
/* Refresh data/india/janaushadhi.json: the Jan Aushadhi (PMBJP) product and MRP list.
 *
 *   node scripts/india/fetch-janaushadhi.mjs
 *
 * Run it from a normal Indian connection (the product API listens on port 8443, which cloud sandboxes and some
 * networks block). The endpoint, request body and response fields are the ones the official site
 * (janaushadhi.gov.in, "Product & MRP List") uses itself, read from its code on 2026-09-30:
 *   POST https://janaushadhi.gov.in:8443/api/v1/website/getAllProductForWeb
 *   { pageIndex, pageSize, searchText, columnName: "drug_code", orderBy: "asc" }
 *   -> { responseCode: 200, responseBody: { totalElement, newProductResponsesList: [{ drugCode, genericName, unitSize, mrp, groupName }] } }
 * Writes nothing unless the list looks complete (at least 500 products, every one with a name and a price).
 */
import { writeFileSync, mkdirSync } from "node:fs";

const URL = "https://janaushadhi.gov.in:8443/api/v1/website/getAllProductForWeb";
const OUT = new globalThis.URL("../../data/india/janaushadhi.json", import.meta.url);

async function page(pageIndex, pageSize) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://janaushadhi.gov.in", Referer: "https://janaushadhi.gov.in/" },
    body: JSON.stringify({ pageIndex, pageSize, searchText: "", columnName: "drug_code", orderBy: "asc" }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  if (d.responseCode !== 200 || !d.responseBody) throw new Error("unexpected response: " + JSON.stringify(d).slice(0, 200));
  return d.responseBody;
}

const first = await page(0, 5000);
let list = first.newProductResponsesList || [];
const total = Number(first.totalElement) || list.length;
for (let p = 1; list.length < total && p < 20; p++) list = list.concat((await page(p, 5000)).newProductResponsesList || []);

const products = list.map((x) => ({
  code: String(x.drugCode || "").trim(), name: String(x.genericName || "").replace(/\s+/g, " ").trim(),
  unit: String(x.unitSize || "").trim(), mrp: Number(x.mrp), group: String(x.groupName || "").trim(),
})).filter((x) => x.name);
const bad = products.filter((x) => !(x.mrp > 0));
if (products.length < 500 || bad.length > products.length * 0.02) {
  console.error("Not written: " + products.length + " products, " + bad.length + " without a price. Expected about 2000.");
  process.exit(1);
}
mkdirSync(new globalThis.URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  list: "Pradhan Mantri Bhartiya Janaushadhi Pariyojana (PMBJP) product and MRP list",
  source_url: "https://janaushadhi.gov.in/product-portfolio/product-mrp-list",
  fetched: new Date().toISOString().slice(0, 10), count: products.length, products,
}));
console.log("Wrote " + products.length + " products to data/india/janaushadhi.json. Commit it, then build and push to devices.");
