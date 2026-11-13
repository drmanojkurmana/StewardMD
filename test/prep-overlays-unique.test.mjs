/* prep.js OVERLAYS: every subject key appears once.
 * A second `"medicine": ["maiknuc1"]` appended at the end of the literal silently REPLACED the first
 * medicine list, so 8 core subjects (medicine, anatomy, pathology, ...) stopped loading their earlier
 * overlay sets while overlay-counts.json still counted them.
 *   node --test test/prep-overlays-unique.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("OVERLAYS default has no duplicate subject keys", () => {
  const src = fs.readFileSync(new URL("../prep.js", import.meta.url), "utf8");
  const m = /var OVERLAYS = G\.SMD_PREP_OVERLAYS \|\| (\{[^\n]*?\});/.exec(src);
  assert.ok(m, "OVERLAYS literal found");
  const keys = [...m[1].matchAll(/("?)([\w-]+)\1: \[/g)].map((x) => x[2]);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupes, []);
  const ov = new Function("return " + m[1])();
  assert.ok(ov.medicine.includes("medcov4") && ov.medicine.includes("maiknuc1"));
});
