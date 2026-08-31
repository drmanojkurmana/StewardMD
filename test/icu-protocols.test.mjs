/* test/icu-protocols.test.mjs — the Critical Care Protocols library (icu.js: PROTOCOLS + the
 * dx-name -> protocol matcher PROTO_RE) must stay index-aligned, or protocolIndexFor() silently
 * points a diagnosis at the WRONG checklist. Extracted straight from the live source, not re-typed.
 *
 * Owner: "in treatment of ICU please also add saved sets for pneumonia, heart failure, co2
 * narcosis, some most common diseases."
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ICU_SRC = readFileSync(new URL("../icu.js", import.meta.url), "utf8");

function loadProtocols() {
  const s1 = ICU_SRC.indexOf("var PROTOCOLS = [");
  const e1 = ICU_SRC.indexOf("\n  ];", s1) + "\n  ];".length;
  const s2 = ICU_SRC.indexOf("var PROTO_RE = [");
  const e2 = ICU_SRC.indexOf("\n  ];", s2) + "\n  ];".length;
  assert.ok(s1 > -1 && s2 > -1, "PROTOCOLS / PROTO_RE must exist in icu.js");
  const code = ICU_SRC.slice(s1, e1) + "\n" + ICU_SRC.slice(s2, e2) +
    "\nmodule.exports = { PROTOCOLS: PROTOCOLS, PROTO_RE: PROTO_RE };";
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.module.exports;
}

test("REGRESSION: PROTOCOLS and PROTO_RE stay index-aligned (protocolIndexFor matches by position)", () => {
  const { PROTOCOLS, PROTO_RE } = loadProtocols();
  assert.equal(PROTOCOLS.length, PROTO_RE.length, "every protocol needs exactly one matcher, in the same slot");
});

test("every protocol entry has a title, a non-empty checklist, and a cited evidence source", () => {
  const { PROTOCOLS } = loadProtocols();
  PROTOCOLS.forEach((p) => {
    assert.ok(p.title, "a protocol with no title would render blank in the tab");
    assert.ok(Array.isArray(p.checklist) && p.checklist.length > 0, p.title + " needs a checklist");
    assert.ok(Array.isArray(p.evidence) && p.evidence.length > 0, p.title + " ships with no cited source");
  });
});

test("Pneumonia, Acute heart failure and CO2 narcosis are in the shipped protocol library", () => {
  const { PROTOCOLS } = loadProtocols();
  const titles = PROTOCOLS.map((p) => p.title);
  assert.ok(titles.some((t) => /pneumonia/i.test(t)), "expected a Pneumonia protocol");
  assert.ok(titles.some((t) => /heart failure/i.test(t)), "expected a Heart failure protocol");
  assert.ok(titles.some((t) => /narcosis/i.test(t)), "expected a CO2 narcosis / hypercapnic protocol");
});

test("a working-dx name resolves to the right protocol by keyword match", () => {
  const { PROTOCOLS, PROTO_RE } = loadProtocols();
  function indexFor(name) {
    const n = name.toLowerCase();
    for (let i = 0; i < PROTO_RE.length; i++) if (PROTO_RE[i].test(n)) return i;
    return -1;
  }
  [
    ["Community acquired pneumonia", /pneumonia/i],
    ["HAP", /pneumonia/i],
    ["Acute decompensated heart failure", /heart failure/i],
    ["Pulmonary oedema", /heart failure/i],
    ["CO2 narcosis", /narcosis/i],
    ["Type 2 respiratory failure", /narcosis/i],
  ].forEach(([name, expect]) => {
    const idx = indexFor(name);
    assert.ok(idx >= 0, "\"" + name + "\" matched no protocol at all");
    assert.match(PROTOCOLS[idx].title, expect, "\"" + name + "\" resolved to \"" + PROTOCOLS[idx].title + "\", not the expected protocol");
  });
});

test("REGRESSION: sepsis still wins over the generic patterns (existing precedence untouched by the new entries)", () => {
  const { PROTOCOLS, PROTO_RE } = loadProtocols();
  const n = "severe community acquired pneumonia with septic shock";
  let idx = -1;
  for (let i = 0; i < PROTO_RE.length; i++) if (PROTO_RE[i].test(n)) { idx = i; break; }
  assert.match(PROTOCOLS[idx].title, /sepsis/i);
});
