// #151 — ICU EMR Doctors: the pure row renderer (emrDocRows) is extracted verbatim from icu.js and run
// with an esc stub. Verifies searchable data-s (lowercased name+id, reused by _rosterSearch), escaping,
// and graceful empty/missing-field handling. (The fetch/tenant glue is thin and validated on-device.)
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "icu.js"), "utf8");
const m = src.match(/function emrDocRows\(doctors\) \{[\s\S]*?\n  \}/);
assert.ok(m, "emrDocRows found in icu.js");
globalThis.esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emrDocRows = (0, eval)("(" + m[0].replace("function emrDocRows", "function") + ")");

test("empty list -> empty-state message", () => {
  assert.match(emrDocRows([]), /No doctors found/);
  assert.match(emrDocRows(null), /No doctors found/);
});

test("row carries searchable data-s (lowercased name + id) for _rosterSearch", () => {
  const h = emrDocRows([{ name: "Dr Asha", id: "P123" }]);
  assert.match(h, /data-s="dr asha p123"/);
  assert.match(h, /Dr Asha/);
  assert.match(h, /· P123/);
});

test("HTML is escaped (no injection via EMR name/id)", () => {
  const h = emrDocRows([{ name: "<b>x</b>", id: 'a"b' }]);
  assert.ok(h.indexOf("<b>x</b>") === -1, "raw tag not present");
  assert.match(h, /&lt;b&gt;/);
});

test("missing name falls back to id, missing both -> 'Doctor'", () => {
  assert.ok(emrDocRows([{ id: "X9" }]).indexOf(">X9") > -1, "id used as display name");
  assert.match(emrDocRows([{}]), />Doctor</);
});
