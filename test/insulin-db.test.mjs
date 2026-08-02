/* test/insulin-db.test.mjs - insulin reference database query layer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import DB from "../insulin-db.js";

test("database has entries across all classes", () => {
  const list = DB.list();
  assert.ok(list.length >= 12);
  DB.CLASSES.forEach(function (c) {
    assert.ok(DB.byClass(c).length >= 1, "class has at least one insulin: " + c);
  });
});

test("every entry has the required fields", () => {
  const req = ["id", "generic", "cls", "strengths", "onset", "peak", "duration", "timing",
    "route", "devices", "pregnancy", "pediatric", "renal", "hepatic", "storage", "notes", "brands"];
  DB.list().forEach(function (d) {
    req.forEach(function (k) { assert.ok(d[k] != null && d[k] !== "", d.id + " missing " + k); });
    assert.ok(Array.isArray(d.strengths) && d.strengths.length);
    assert.ok(Array.isArray(d.brands) && d.brands.length);
    assert.ok(DB.CLASSES.indexOf(d.cls) > -1, d.id + " has a known class");
  });
});

test("get returns by id, null for unknown", () => {
  assert.equal(DB.get("lispro").generic, "Insulin lispro");
  assert.equal(DB.get("nope"), null);
});

test("search matches generic, brand, manufacturer, concentration, country, class", () => {
  assert.ok(DB.search("lispro").some(function (d) { return d.id === "lispro"; }), "generic");
  assert.ok(DB.search("lantus").some(function (d) { return d.id === "glargine100"; }), "brand");
  assert.ok(DB.search("biocon").some(function (d) { return d.id === "glargine100"; }), "manufacturer");
  assert.ok(DB.search("U-500").some(function (d) { return d.id === "regularu500"; }), "concentration");
  assert.ok(DB.search("india").length >= 5, "country name");
  assert.ok(DB.search("Premixed").every(function (d) { return d.cls === "Premixed"; }), "class");
});

test("empty search returns everything", () => {
  assert.equal(DB.search("").length, DB.list().length);
});

test("brandCountries dedupes across brands", () => {
  const c = DB.brandCountries(DB.get("glargine100"));
  assert.ok(c.indexOf("IN") > -1);
  assert.equal(c.length, new Set(c).size);
});
