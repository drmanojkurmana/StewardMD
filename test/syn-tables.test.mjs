// The phrase tables in reasoning.js are object literals: a key written twice keeps only its LAST array, silently
// dropping the first (round 33's urinary-retention phrases were lost that way). One key per table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "reasoning.js"), "utf8").split("\n");
const TABLES = ["FT_SYN", "FT_SYN_MORE", "FT_SYN_ADD_V2", "FT_SYN_ADD_V2_R8", "FT_SYN_ADD_V2_R10", "FT_SYN_ADD_V2_R11", "FT_SYN_ADD_V2_R16", "FT_SYN_ADD_V2_R21", "FT_SYN_ADD_V2_R47", "FT_SYN_ADD_V2_R48", "FT_SYN_ADD_V2_R52", "FT_SYN_ADD_V2_R53", "FT_SYN_ADD_V2_R60", "FT_SYN_ADD_V2_R67", "FT_SYN_ADD_V2_R71", "KB_V2_PATCH", "RANK_V3_R2", "RANK_V3_ANCHOR", "RANK_V3_DQ"];

for (const name of TABLES) {
  test(`${name}: no key written twice`, () => {
    const s = src.findIndex((l) => l.includes(`var ${name} = {`));
    assert.ok(s >= 0, `${name} not found`);
    const e = src.findIndex((l, i) => i > s && /^  };/.test(l));
    const keys = [];
    for (const line of src.slice(s + 1, e)) {
      if (/^\s*\/\//.test(line) || !/^ {4}[A-Za-z_$]/.test(line)) continue;   // top-level keys sit at 4 spaces
      for (const m of line.matchAll(/(?:^ {4}|\],\s*|\},\s*)([A-Za-z_$][\w$]*)\s*:\s*[[{f]/g)) keys.push(m[1]);
    }
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, [], `${name} repeats: ${dup.join(", ")}`);
  });
}
