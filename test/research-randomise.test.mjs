/* Block randomisation: seeded lists, balance, strata, refused block sizes.
 * Run: node --test test/research-randomise.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const RAND = require("../research-randomise.js");

function list(extra) {
  const opts = {
    n: 30,
    arms: ["A", "B"],
    ratio: [1, 1],
    blockSizes: [4],
    seed: "seed-1"
  };
  Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
  return RAND.blockList(opts);
}

function assertBlocks(rows, arms, ratio) {
  const sum = ratio.reduce(function (a, b) { return a + b; }, 0);
  const blocks = {};
  rows.forEach(function (row) {
    const key = row.stratum + "#" + row.block;
    if (!blocks[key]) blocks[key] = [];
    blocks[key].push(row);
  });
  Object.keys(blocks).forEach(function (key) {
    const block = blocks[key];
    const size = block[0].blockSize;
    assert.equal(block.length, size, key);
    arms.forEach(function (arm, i) {
      const n = block.filter(function (row) { return row.arm === arm; }).length;
      assert.equal(n, size * ratio[i] / sum, key + " " + arm);
    });
  });
}

test("the same seed writes the same CSV and a different seed does not", function () {
  const a = list();
  const b = list();
  const c = list({ seed: "seed-2" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.csv, b.csv);
  assert.equal(a.seed, "seed-1");
  assert.notEqual(a.csv, c.csv);
  assert.equal(a.csv.indexOf("seq,stratum,envelope,block,block_size,arm\n"), 0);
  assert.equal(a.csv.charAt(a.csv.length - 1), "\n");
});

test("every block matches the ratio and 1:1 stays within one block", function () {
  const fit = list({ blockSizes: [2, 4], n: 30 });
  assert.equal(fit.ok, true);
  assert.ok(fit.rows.length >= 30);
  assert.ok(fit.rows.length < 30 + 4);
  assertBlocks(fit.rows, ["A", "B"], [1, 1]);
  let nA = 0;
  let nB = 0;
  fit.rows.forEach(function (row) {
    if (row.arm === "A") nA += 1;
    else nB += 1;
    assert.ok(Math.abs(nA - nB) <= row.blockSize, "balance " + row.seq + " " + Math.abs(nA - nB));
  });
});

test("strata are independent and envelopes stay inside the stratum", function () {
  const strata = [["Male", "Female"], ["Centre 1", "Centre 2"]];
  const fit = list({ n: 8, strata: strata, blockSizes: [4] });
  assert.equal(fit.ok, true);
  assert.equal(fit.rows.length, 32);
  const labels = ["Male, Centre 1", "Male, Centre 2", "Female, Centre 1", "Female, Centre 2"];
  labels.forEach(function (label, idx) {
    const rows = fit.rows.filter(function (row) { return row.stratum === label; });
    assert.equal(rows.length, 8, label);
    rows.forEach(function (row) {
      assert.equal(row.envelope.indexOf((idx + 1) + "-"), 0);
      assert.ok(/^\d+-\d{3,}$/.test(row.envelope));
    });
    const alone = RAND.blockList({
      n: 8,
      arms: ["A", "B"],
      ratio: [1, 1],
      blockSizes: [4],
      seed: "seed-1",
      strata: [[label]]
    });
    assert.equal(alone.ok, true);
    assert.deepEqual(alone.rows.map(function (row) { return row.arm; }), rows.map(function (row) { return row.arm; }));
  });
  assertBlocks(fit.rows, ["A", "B"], [1, 1]);
  assert.ok(fit.csv.indexOf("\"Male, Centre 1\"") >= 0);
});

test("2:1 with block size 4 is refused before a list is built", function () {
  const fit = RAND.blockList({ n: 12, arms: ["A", "B"], ratio: [2, 1], blockSizes: [4], seed: "s" });
  assert.equal(fit.ok, false);
  assert.deepEqual(fit.warnings, ["Block size 4 cannot split 2:1; use 3 or 6."]);
  assert.equal(fit.csv, "");
  assert.deepEqual(fit.rows, []);
  assert.equal(fit.seed, null);
});

test("the generator source does not call Math.random", function () {
  const src = readFileSync(new URL("../research-randomise.js", import.meta.url), "utf8");
  assert.equal(src.indexOf("Math.random"), -1);
  assert.equal(src.indexOf("=>"), -1);
  assert.equal(src.indexOf("let "), -1);
  assert.equal(src.indexOf("const "), -1);
  assert.equal(src.indexOf("`"), -1);
  assert.equal(src.indexOf("async"), -1);
  assert.equal(src.indexOf("await"), -1);
});
