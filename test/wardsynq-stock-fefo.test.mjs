/* P1.2 first-expiry-first-out advice (functions/_wardsynq/stock.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { batchBalances, fefoSuggestion } from "../functions/_wardsynq/stock.js";

const tab = (n) => ({ value: n, unit: "tablet" });
const MOVES = [
  { kind: "receipt", code: "AMOX500", quantity: tab(100), batch: "B-LATE", expiry: "2027-06-30" },
  { kind: "receipt", code: "AMOX500", quantity: tab(40), batch: "B-SOON", expiry: "2026-11-30" },
  { kind: "receipt", code: "AMOX500", quantity: tab(30), batch: "B-OLD", expiry: "2026-01-31" },
  { kind: "wastage", code: "AMOX500", quantity: tab(5), batch: "B-SOON" },
  { kind: "receipt", code: "PARA500", quantity: tab(999), batch: "P1", expiry: "2026-10-01" },
];

test("takes from the batch that expires first, never an expired one, and says what it skipped", () => {
  const bal = batchBalances(MOVES, [{ drugCode: "AMOX500", quantity: tab(10), batch: "B-SOON" }], "AMOX500", "tablet");
  assert.equal(bal.batches.find((b) => b.batch === "B-SOON").onHand, 25, "40 received - 5 wasted - 10 dispensed");
  const s = fefoSuggestion(bal, 60, "2026-09-13");
  assert.equal(s.ok, true);
  assert.deepEqual(s.picks, [{ batch: "B-SOON", expiry: "2026-11-30", take: 25 }, { batch: "B-LATE", expiry: "2027-06-30", take: 35 }]);
  assert.equal(s.shortfall, 0);
  assert.deepEqual(s.excluded.map((x) => x.batch + ":" + x.why), ["B-OLD:expired"]);
});

test("a shortfall is reported, not hidden", () => {
  const s = fefoSuggestion(batchBalances(MOVES, [], "AMOX500", "tablet"), 500, "2026-09-13");
  assert.equal(s.shortfall, 500 - 135);
});

test("REFUSES to advise when stock left without a batch recorded, because batch counts cannot be trusted", () => {
  const bal = batchBalances(MOVES, [{ drugCode: "AMOX500", quantity: tab(10) }], "AMOX500", "tablet");
  assert.equal(bal.unbatched, 10);
  const s = fefoSuggestion(bal, 5, "2026-09-13");
  assert.equal(s.ok, false);
  assert.equal(s.reason, "unbatched_issues");
});

test("other items and other units never leak into a batch count", () => {
  const bal = batchBalances([...MOVES, { kind: "receipt", code: "AMOX500", quantity: { value: 3, unit: "box" }, batch: "B-LATE", expiry: "2027-06-30" }], [], "AMOX500", "tablet");
  assert.equal(bal.batches.find((b) => b.batch === "B-LATE").onHand, 100);
  assert.ok(!bal.batches.some((b) => b.batch === "P1"));
});
