/* test/research-cost-quotes.test.mjs - ResearchMD cost honesty.
 * No ResearchMD screen may print a hardcoded MaiK price; every Ask MaiK and
 * PaperOrchestra entry must quote the server's unit (wallet MaiK Tokens) from
 * the server pricing catalogue for its task and input size. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MT_PER_INR, inrToMt, quoteTaskPricing, researchPricingView } from "../functions/api/research/_credits.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_FILES = fs.readdirSync(root)
  .filter((f) => /^research.*\.js$/.test(f) && !/\.test\./.test(f));

test("no ResearchMD client file hardcodes a MaiK price", () => {
  const bad = [];
  for (const f of CLIENT_FILES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    if (/Costs about/i.test(src)) bad.push(f + ": Costs about");
    if (/about\s+\d[\d,]*\s+MaiK tokens?/i.test(src)) bad.push(f + ": about N MaiK tokens");
    if (/\bcost:\s*[1-9]\d*\s*,/.test(src)) bad.push(f + ": cost: N in an AI option");
    if (/1 MaiK token\b/.test(src)) bad.push(f + ": 1 MaiK token");
  }
  assert.deepEqual(bad, []);
});

test("each task named by an AI entry exists in the server pricing catalogue", () => {
  const view = researchPricingView({});
  const used = new Set();
  for (const f of CLIENT_FILES) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    let m;
    const bar = /barHtml\([\s\S]*?task:\s*"([a-z_]+)"/g;
    while ((m = bar.exec(src))) used.add(m[1]);
    const qt = /quoteText\(\s*"([a-z_]+)"/g;
    while ((m = qt.exec(src))) used.add(m[1]);
  }
  assert.ok(used.size >= 10, "found the ResearchMD AI entries");
  for (const task of used) {
    if (task === "grade") continue; /* deterministic, free */
    assert.ok(view.tasks[task], "server pricing catalog has " + task);
    assert.ok(view.tasks[task].maxMt > 0, task + " has a token quote");
  }
});

test("quotes use the wallet unit and the server model rates", () => {
  const env = {};
  const view = researchPricingView(env);
  assert.equal(view.mtPerInr, MT_PER_INR);
  assert.equal(view.mtPerInr, 2000, "Rs 49 pack = 50,000 MaiK Tokens");
  const q = quoteTaskPricing(env, "manuscript_draft", 6000);
  assert.ok(q.minMt > 1 && q.maxMt > q.minMt, "a draft is a token range, not 2 tokens");
  assert.ok(q.minInr > 0 && q.maxInr > q.minInr);
  assert.ok(Math.abs(q.maxMt - inrToMt(q.maxInr)) <= 1);
  assert.ok(q.minMt >= Math.floor(q.minInr * MT_PER_INR) - 1);
});

test("thesis quote scales with a 341-page thesis and never shows the old 2-token price", () => {
  const q = quoteTaskPricing({}, "thesis_to_paper", 555148);
  assert.ok(q.minMt >= 3000, "a 341-page run is thousands of tokens: " + q.minMt);
  assert.ok(q.maxMt > q.minMt);
  assert.ok(q.maxMt >= 5860, "the upper quote covers the live 5,860 MT run");
  const small = quoteTaskPricing({}, "thesis_to_paper", 12000);
  assert.ok(small.maxMt < q.maxMt, "a short thesis quotes less than 341 pages");
});

test("every task quote is a real range with the rupee value", () => {
  const view = researchPricingView({});
  for (const [task, q] of Object.entries(view.tasks)) {
    assert.ok(q.minMt >= 1, task + " min");
    assert.ok(q.maxMt >= q.minMt, task + " max");
    assert.ok(q.minInr >= 0 && q.maxInr >= q.minInr, task + " INR range");
  }
});
