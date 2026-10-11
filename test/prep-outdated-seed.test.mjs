// Outdated-guidance seeding (tools/prep-outdated-seed.mjs): reports with enough outdated votes become a sorted
// ids list for item-edits --outdated. All reports synthetic; the tool deletes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectOutdated } from "../tools/prep-outdated-seed.mjs";

const R = (itemId, outdated, extra) => ({ itemId, n: outdated + 1, reasons: { outdated, other: 1 },
  subject: "medicine", module: "med-x", ...extra });

test("selectOutdated: the outdated threshold, sorted ids, junk dropped", () => {
  const rows = selectOutdated({ items: [R("b", 2), R("a", 1), R("c", 0), R("d", 3, { reasons: { typo: 2 } }), null, {}] }, 1);
  assert.deepEqual(rows.map((x) => x.itemId), ["a", "b"]);
  assert.deepEqual(rows[1], { itemId: "b", subject: "medicine", module: "med-x", n: 3, outdated: 2 });
  assert.deepEqual(selectOutdated({ items: [R("b", 2), R("a", 1)] }, 2).map((x) => x.itemId), ["b"]);
  assert.deepEqual(selectOutdated({ items: [] }, 1), []);
  assert.deepEqual(selectOutdated(null, 1), []);
});
