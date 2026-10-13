// Guarantee floor map (tools/prep-nucleus360-floor.mjs): direct membership only, never guesses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { floorTopicFor, buildFloorMap } from "../tools/prep-nucleus360-floor.mjs";

const DOC = { topics: [
  { id: "t-pancreas", modules: [["surgery", "sur-pancreas"], ["medicine", "med-pancreatitis"]] },
  { id: "t-empty", modules: [] },
] };

test("floorTopicFor: direct membership maps, lookalikes do not", () => {
  assert.equal(floorTopicFor("sur-pancreas", "surgery", DOC), "t-pancreas");
  assert.equal(floorTopicFor("sur-pancreas", null, DOC), "t-pancreas");
  assert.equal(floorTopicFor("sur-pancreas-like", "surgery", DOC), null);
  assert.equal(floorTopicFor("sur-pancreas", "medicine", DOC), null);
  assert.equal(floorTopicFor("nope", "surgery", DOC), null);
  assert.equal(floorTopicFor("sur-pancreas", "surgery", null), null);
});

test("buildFloorMap: splits mapped from uncovered", () => {
  const { map, uncovered } = buildFloorMap(
    [{ mid: "sur-pancreas", sid: "surgery" }, { mid: "ana-foot", sid: "anatomy" }], DOC);
  assert.deepEqual(map, { "sur-pancreas": "t-pancreas" });
  assert.deepEqual(uncovered, ["ana-foot"]);
});
