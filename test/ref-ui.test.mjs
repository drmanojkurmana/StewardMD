// ref-ui.js: the flag behind the 2026-11 look of ICD Search and Scheme Search, and its HTML helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

function load(search, stored) {
  globalThis.location = { search: search || "" };
  globalThis.localStorage = { getItem: (k) => (stored && k in stored ? stored[k] : null) };
  delete require.cache[require.resolve("../ref-ui.js")];
  return require("../ref-ui.js");
}

test("smd_ref_ui2 is on by default", () => { assert.equal(load().on(), true); });
test("localStorage smd_ref_ui2=0 turns it off for the device", () => { assert.equal(load("", { smd_ref_ui2: "0" }).on(), false); });
test("?refui=0 turns it off, ?refui=1 wins over a stored 0", () => {
  assert.equal(load("?refui=0").on(), false);
  assert.equal(load("?refui=1", { smd_ref_ui2: "0" }).on(), true);
});
test("a storage that throws leaves it on", () => {
  globalThis.location = { search: "" };
  globalThis.localStorage = { getItem() { throw new Error("denied"); } };
  delete require.cache[require.resolve("../ref-ui.js")];
  assert.equal(require("../ref-ui.js").on(), true);
});

test("searchBar escapes what was typed and hides the clear button on an empty field", () => {
  const R = load();
  const filled = R.searchBar({ id: "x", cls: "c", placeholder: "Find", value: '"><img src=x>' });
  assert.ok(!filled.includes("<img"));
  assert.ok(filled.includes('aria-label="Clear search">'));
  assert.ok(R.searchBar({ id: "x", placeholder: "Find", value: "" }).includes('aria-label="Clear search" hidden>'));
});
test("state marks an error as an alert and offers one named action", () => {
  const R = load();
  const err = R.state("icd-err", "Could not reach the ICD service", "Check your connection.", "retry");
  assert.ok(err.includes('role="alert"') && err.includes('data-r2="retry"') && err.includes("Try again"));
  assert.ok(!R.state("icd-empty", "Nothing", "").includes("role="));
});
test("skeleton reads its label out and is marked busy", () => {
  const sk = load().skeleton("Searching", 3);
  assert.ok(sk.includes('aria-busy="true"') && sk.includes(">Searching<"));
  assert.equal(sk.split("r2-sk-row").length - 1, 3);
});

test("app-facing text in the three files has no em-dash", () => {
  for (const f of ["ref-ui.js", "icd.js", "govschemes.js"]) {
    const code = readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!code.includes("—"), f + " has an em-dash outside comments");
  }
});
test("index.html loads ref-ui.js before the two screens that use it, and links its stylesheet", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const at = (s) => html.indexOf(s);
  assert.ok(at("/ref-ui.css?v=") > 0);
  assert.ok(at("/ref-ui.js?v=") > 0 && at("/ref-ui.js?v=") < at("/govschemes.js?v=") && at("/ref-ui.js?v=") < at("/icd.js?v="));
});
