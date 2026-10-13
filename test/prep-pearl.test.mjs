import { test } from "node:test"; import assert from "node:assert";
import P from "../prep-pearl.js";
test("pearlId from share ID scheme PN-xxxx", () => {
  assert.equal(P.pearlId("ana-epithelium", "L-4FDN-0V2R-A"), "PN-4FDN");
  assert.match(P.pearlId("ahm-acid-base"), /^PN-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(P.pearlId("x"), P.pearlId("x"));
  assert.notEqual(P.pearlId("a"), P.pearlId("b"));
  assert.equal(P.pearlId("k", "L-4FDN-0V2R-A"), P.pearlId("k", "L-4FDN-0V2R-A"));
});
test("isPearl only with table/figure/compare", () => {
  assert.equal(P.isPearl({ steps: [{ vis: { kind: "table", cols: [], rows: [] } }] }), true);
  assert.equal(P.isPearl({ steps: [{ vis: { kind: "compare" } }] }), true);
  assert.equal(P.isPearl({ steps: [{ vis: { kind: "image", src: "a.webp" } }] }), true);
  assert.equal(P.isPearl({ steps: [{ vis: null }, { tx: "x" }] }), false);
  assert.equal(P.isPearl(null), false);
  assert.equal(P.isPearl({ steps: "no" }), false);
});
test("breadcrumb header footer table escape", () => {
  const l = { module: "perineal-body", subject: "anatomy", title: "Perineal <Body>", steps: [] };
  assert.match(P.breadcrumb(l, "L-4FDN-0V2R-A"), /^Pearl #PN-4FDN · Anatomy · Perineal Body$/);
  assert.match(P.headerHtml(l, "L-4FDN-0V2R-A"), /&lt;Body&gt;/);
  assert.match(P.footerHtml(l, "L-4FDN-0V2R-A"), /data-pearl-copy="PN-4FDN"/);
  assert.match(P.footerHtml(l, "L-4FDN-0V2R-A"), /data-act="id-share" data-v="L-4FDN-0V2R-A"/);
  assert.match(P.footerHtml(l, null, true), /aria-pressed="true"/);
  assert.match(P.tableHtml({ kind: "table", cols: ["A"], rows: [["<x>", "y"]] }), /&lt;x&gt;/);
  assert.equal(P.tableHtml({ kind: "flow" }), "");
});
test("attribution only for images, sheet escapes", () => {
  assert.equal(P.attributionLink({ kind: "table" }), "");
  assert.match(P.attributionLink({ kind: "image", src: "x.webp", credit: "CC BY <test>" }), /Image Attribution and License/);
  assert.match(P.sheetHtml("CC BY <x>", "a/b.webp"), /CC BY &lt;x&gt;/);
  assert.match(P.sheetHtml("c", ""), /data-act="img-credits"/);
  assert.match(P.sheetHtml("c", ""), /data-pearl-close/);
});
