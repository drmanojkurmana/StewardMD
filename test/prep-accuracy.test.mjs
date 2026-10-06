// tools/prep-accuracy.mjs: the public accuracy numbers come only from the fixture files; nothing without a source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compute, fromRepo } from "../tools/prep-accuracy.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prep-acc-"));
  const w = (f, j) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), JSON.stringify(j)); };
  w("prep/taxonomy.json", { v: 1, branches: [{ id: "mbbs", subjects: [{ id: "anatomy", name: { en: "Anatomy" } }, { id: "ent", name: { en: "ENT" } }] }] });
  w("prep/bank/v1/screen-2026-09-01.json", { v: 1, date: "2026-09-01", subjects: [{ id: "anatomy", screened: 10, disputed: 9 }] });
  w("prep/bank/v1/screen-2026-10-06.json", { v: 1, date: "2026-10-06", model: "m", bank: "v1", subjects: [
    { id: "anatomy", screened: 100, agree: 80, disputed: 10 }, { id: "ent", screened: 50, agree: 40, disputed: 10 }, { id: "empty", screened: 0, disputed: 0 }] });
  w("prep/fill/a.json", { v: 1, module: "a", stats: { generated: 10, rejected: { g5: 2, solve: 1 }, regenerated: 3, accepted: 7 } });
  w("prep/fill/b.json", { v: 1, module: "b", stats: { generated: 5, rejected: { "verbatim-pack": 1 }, regenerated: 1, accepted: 4 } });
  w("prep/fill/shortfall.json", { v: 1, modules: [{ module: "x" }] });
  w("prep/lessons/v1/index.json", { v: 1, modules: {} });
  w("prep/lessons/v1/l1.json", { gen: "AI", steps: [1, 2, 3, 4, 5], checks: { redone: 1, dropped: 1 } });
  w("prep/lessons/v1/l2.json", { gen: "hand", steps: [1, 2], checks: { selfCheck: "hand" } });
  w("prep/cards/v1/index.json", { v: 1 });
  w("prep/cards/v1/d.json", { cards: [{ gen: "hand" }, { gen: "hand" }] });
  return root;
}

test("fromRepo: newest screen, per subject disputed rate, worst first", () => {
  const j = fromRepo(fixture(), "2026-10-07");
  assert.equal(j.generated, "2026-10-07");
  assert.equal(j.sources.keys, "prep/bank/v1/screen-2026-10-06.json");
  assert.equal(j.keys.screened, 150); assert.equal(j.keys.disputed, 20); assert.equal(j.keys.rate, 0.1333);
  assert.deepEqual(j.keys.subjects.map((s) => [s.id, s.name, s.rate]), [["ent", "ENT", 0.2], ["anatomy", "Anatomy", 0.1]]);
});

test("fromRepo: AI question gates add up; shortfall.json is not a fill report", () => {
  const q = fromRepo(fixture(), "d").ai.questions;
  assert.equal(q.modules, 2); assert.equal(q.generated, 15); assert.equal(q.accepted, 11); assert.equal(q.rejected, 4); assert.equal(q.passRate, 0.7333);
  const g = Object.fromEntries(q.gates.map((x) => [x.id, x.rejected]));
  assert.equal(g.g5, 2); assert.equal(g.solve, 1); assert.equal(g.verbatim, 1); assert.equal(g.g1, 0);
});

test("fromRepo: lessons count only AI lessons; cards split AI and hand", () => {
  const j = fromRepo(fixture(), "d");
  assert.deepEqual([j.ai.lessons.lessons, j.ai.lessons.hand, j.ai.lessons.steps, j.ai.lessons.passRate, j.ai.lessons.firstPass], [1, 1, 5, 0.8333, 0.6667]);
  assert.deepEqual(j.ai.cards, { decks: 1, cards: 2, ai: 0, hand: 2 });
});

test("no source, no number: reports and fix time are null", () => {
  const j = fromRepo(fixture(), "d");
  assert.equal(j.reports.reported, null); assert.equal(j.reports.autoHidden, null); assert.equal(j.fixTime.medianHours, null);
  const e = compute({ date: "d" });
  assert.equal(e.keys, null); assert.equal(e.ai.questions, null); assert.equal(e.ai.lessons, null);
  assert.equal(compute({ date: "d", fixHours: [5, 1, 3, 100] }).fixTime.medianHours, 4);
});

test("the committed prep/accuracy.json is what the script makes from the repo (date aside)", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  const committed = JSON.parse(fs.readFileSync(path.join(root, "prep/accuracy.json"), "utf8"));
  assert.deepEqual(fromRepo(root, committed.generated), committed, "prep/accuracy.json is stale: run node tools/prep-accuracy.mjs");
});
