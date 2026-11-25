/* Plan v2 item 5: randomisation list engine (research-randomise.js).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-randomise.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const R = require("../research-randomise.js");
const SRC = readFileSync(new URL("../research-randomise.js", import.meta.url), "utf8");

test("source is ES5, pure and has no dashes", () => {
  assert.ok(!/=>/.test(SRC) && !/\b(let|const|class)\s/.test(SRC));
  assert.ok(!/Math\.random|Date\.now|new Date/.test(SRC));
  assert.ok(!/[–—]/.test(SRC));
});

test("FNV-1a 32-bit and mulberry32 match their published reference values", () => {
  assert.equal(R._fnv1a(""), 2166136261);
  assert.equal(R._fnv1a("a"), 0xe40c292c);
  assert.equal(R._fnv1a("foobar"), 0xbf9cf968);
  const m = R._mulberry32(1);
  assert.equal(m(), 0.6270739405881613);
});

test("the same seed gives the same list (frozen), a different seed a different list", () => {
  const r = R.blockList({ seed: "thesis-2026", arms: ["A", "B"], n: 20, blockSizes: [4, 6] });
  assert.equal(r.ok, true);
  assert.equal(r.rows.map((x) => x.arm).join(""), "ABABBABAABBABABABBABAA");
  assert.equal(R.blockList({ seed: "thesis-2026", arms: ["A", "B"], n: 20, blockSizes: [4, 6] }).csv, r.csv);
  assert.notEqual(R.blockList({ seed: "thesis-2027", arms: ["A", "B"], n: 20, blockSizes: [4, 6] }).csv, r.csv);
});

test("every block is balanced by the ratio, and whole blocks are kept", () => {
  const r = R.blockList({ seed: "s", arms: ["Drug", "Placebo"], ratio: [2, 1], n: 50, blockSizes: [3, 6] });
  assert.equal(r.ok, true);
  const blocks = {};
  for (const x of r.rows) (blocks[x.block] = blocks[x.block] || []).push(x);
  for (const b of Object.values(blocks)) {
    const drug = b.filter((x) => x.arm === "Drug").length;
    assert.equal(b.length, b[0].blockSize);
    assert.equal(drug * 3, b.length * 2);
  }
  assert.ok(r.rows.length >= 50);
});

test("strata get their own lists, envelopes and sequences", () => {
  const r = R.blockList({ seed: "s", arms: ["A", "B"], n: 8, blockSizes: [4], strata: ["Male", "Female"] });
  const male = r.rows.filter((x) => x.stratum === "Male");
  const female = r.rows.filter((x) => x.stratum === "Female");
  assert.equal(male[0].envelope, "1-001");
  assert.equal(female[0].envelope, "2-001");
  assert.equal(female[0].seq, 1);
  assert.ok(r.warnings.some((w) => /one block size/.test(w)));
});

test("csv has the fixed columns and quotes awkward names", () => {
  const r = R.blockList({ seed: "s", arms: ["Dressing, new", "Usual \"care\""], n: 4, blockSizes: [2, 4] });
  const lines = r.csv.trim().split("\n");
  assert.equal(lines[0], "seq,stratum,envelope,block,block_size,arm");
  assert.equal(lines.length, r.rows.length + 1);
  assert.ok(lines.slice(1).every((l) => /"Dressing, new"$|"Usual ""care"""$/.test(l)));
});

test("bad inputs return a plain message", () => {
  assert.equal(R.blockList({ seed: "x", arms: ["A", "B"], ratio: [2, 1], n: 10, blockSizes: [4] }).warnings[0], "Block size 4 cannot split 2:1; use 3 or 6.");
  assert.equal(R.blockList({ arms: ["A", "B"], n: 10 }).ok, false);
  assert.equal(R.blockList({ seed: "x", arms: ["A"], n: 10 }).ok, false);
  assert.equal(R.blockList({ seed: "x", n: 0 }).ok, false);
  assert.equal(R.blockList({ seed: "x", n: 10, strata: ["a", "a"] }).ok, false);
});
