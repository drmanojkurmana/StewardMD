/* test/research-tutorial-cost-copy.test.mjs
 * Live BUG-10 (part): the tutorial is free, so every card and the tutorial
 * coach bar must say so in one consistent style. Before the fix the project
 * cards said "Interactive Tutorial · 0 tokens" while tutorial steps claimed
 * "Costs about 2 MaiK tokens".
 *
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-tutorial-cost-copy.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

describe("Tutorial cost copy is consistently free (BUG-10)", () => {
  test("projects screen never says 0 tokens; free wording is used", () => {
    const src = read("research-screen-projects.js");
    assert.ok(!/\b0 tokens\b/.test(src), "no '0 tokens' badge");
    assert.ok(!/\(0 MaiK tokens\)/.test(src), "no '(0 MaiK tokens)' subtitle");
    assert.match(src, /Free Interactive Tutorial/, "tutorial project card badge says free");
    assert.match(src, /Free · Scratch to Published/, "start-screen tutorial box badge says free");
    assert.match(src, /worked example first, free/, "tutorial hub subtitle says free");
  });

  test("tutorial coach bar says the tutorial needs no tokens, never a token cost", () => {
    const src = read("research-tutorial.js");
    assert.ok(src.indexOf("Costs about") < 0, "the tutorial bar never claims a token cost");
    assert.match(src, /var costStr = "No MaiK tokens needed"/, "coach bar meta uses the shared free label");
  });
});
