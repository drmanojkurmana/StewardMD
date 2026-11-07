import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { assertClean } from "../tools/pyq-ss-build.mjs";
const PQ = createRequire(import.meta.url)("../prep-pyqss.js");

// Runs on the built data (gitignored, real questions); skipped in CI where it is absent.
const have = fs.existsSync("prep/pyq-ss/out/index.json");
test("30-day plan: 30 days, every question once, high yield first, short clean reminders", { skip: !have && "built data not present" }, () => {
  const ix = JSON.parse(fs.readFileSync("prep/pyq-ss/out/index.json", "utf8")), items = JSON.parse(fs.readFileSync("prep/pyq-ss/out/" + ix.file, "utf8")).items;
  const plan = PQ.makePlan(ix.analysis);
  assert.equal(plan.length, 30);
  const learn = plan.filter((d) => d.k === "learn");
  assert.equal(learn.length, 27);
  const seen = new Set();
  learn.forEach((d) => { assert.ok(d.tp.length >= 1 && d.q >= 1); PQ.itemsOfDay(items, ix.analysis, d).forEach((it) => { assert.ok(!seen.has(it.id), "no question twice"); seen.add(it.id); }); });
  assert.equal(seen.size, items.length, "every question lands on exactly one learning day");
  assert.equal(ix.analysis.domains.find((x) => x.name === plan[0].dom).tier, 1, "high yield first");
  plan.forEach((d) => { const n = PQ.noticeOf(plan, d.n); assert.ok(n.body.length < 220, "fits a notification"); assertClean(n); });
  assert.ok(PQ.itemsOfDay(items, ix.analysis, plan[27]).length > 0 && PQ.itemsOfDay(items, ix.analysis, plan[29]).length > 0);
  assert.equal(PQ.dayOf({ start: 100 }, 100), 1);
  assert.equal(PQ.noticeOf(plan, 31), null);
  console.log(plan.slice(0, 3).map((d) => PQ.noticeOf(plan, d.n).title + " | " + PQ.noticeOf(plan, d.n).body).join("\n"));
});
