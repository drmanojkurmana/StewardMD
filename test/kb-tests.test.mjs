// smd_kb_tests (round 72): the tappable test results and their effects are consistent with each other and the KB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "reasoning.js"), "utf8");
const block = (name) => { const s = src.indexOf(`var ${name} = `); assert.ok(s >= 0, name); return src.slice(s, src.indexOf("\n  };", s) + 5); };
const obj = (name) => Function(`return ${block(name).replace(/^var \w+ = /, "").replace(/;\s*$/, "")}`)();
const fieldsSrc = src.slice(src.indexOf("var KB_TEST_FIELDS = ["), src.indexOf("\n  ];", src.indexOf("var KB_TEST_FIELDS = [")) + 5);
const FIELDS = Function(`return ${fieldsSrc.replace(/^var \w+ = /, "").replace(/;\s*$/, "")}`)();
const TESTS = obj("KB_TESTS"), ALT = obj("KB_TEST_ALT"), TAG = obj("KB_TEST_TAG");
globalThis.window = {}; createRequire(import.meta.url)(join(ROOT, "kb", "dist", "kb.core.js"));
const D = globalThis.window.KB_CORE.diseases;

test("every test result has a field, a label without an em-dash, and an organ tag", () => {
  const keys = FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate field key");
  for (const f of FIELDS) { assert.ok(f.label && !/—/.test(f.label), f.key); assert.ok(TAG[f.key], "tag " + f.key); }
  for (const k of Object.keys(TESTS)) assert.ok(keys.includes(k), "no field for " + k);
});

test("every diagnosis a test result moves exists in the KB, with a score (infection) or finding weights", () => {
  for (const [k, m] of Object.entries(TESTS)) for (const id of Object.keys(m)) {
    assert.ok(D[id], `${k} -> unknown diagnosis ${id}`);
    assert.ok(D[id].score || D[id].find, `${k} -> ${id} has neither score nor find`);
  }
  for (const id of Object.keys(ALT)) assert.ok(D[id] && D[id].rule, "alt rule for " + id);
});

test("a positive diagnostic result that meets an infection's criteria also raises it", () => {
  for (const [id, alts] of Object.entries(ALT)) for (const a of alts) {
    const k = typeof a === "string" ? a : a.allOf[0];
    assert.ok(TESTS[k] && TESTS[k][id] > 0, `${k} meets ${id} but does not raise it`);
  }
});
