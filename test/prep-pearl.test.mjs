import { test } from "node:test"; import assert from "node:assert";
import P from "../prep-pearl.js";
test("pearlId stable PN-xxxx", () => { assert.match(P.pearlId("ahm-acid-base"), /^PN-\d{4}$/); assert.equal(P.pearlId("x"), P.pearlId("x")); assert.notEqual(P.pearlId("a"), P.pearlId("b")); });
test("isPearl only with table/figure", () => { assert.equal(P.isPearl({steps:[{vis:{kind:"table",cols:[],rows:[]}}]}), true); assert.equal(P.isPearl({steps:[{vis:null},{tx:"x"}]}), false); assert.equal(P.isPearl(null), false); });
test("breadcrumb header footer table escape", () => { const l={module:"perineal-body",subject:"anatomy",title:"Perineal <Body>",steps:[]}; assert.match(P.breadcrumb(l), /^Pearl #PN-\d{4} · Anatomy · Perineal Body$/); assert.match(P.headerHtml(l), /&lt;Body&gt;/); assert.match(P.footerHtml(l), /data-pearl-copy="PN-/); assert.match(P.tableHtml({kind:"table",cols:["A"],rows:[["<x>","y"]]}), /&lt;x&gt;/); });
