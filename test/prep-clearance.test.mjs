import { test } from "node:test"; import assert from "node:assert";
import { applyClearance, isLive } from "../tools/prep-clearance.mjs";
test("held item hidden until cleared", () => { const it = { id: "x", hold: "rights", img: ["rb-ctc-1.webp"] }; assert.equal(isLive(it, []), false); assert.equal(isLive(it, ["rb-ctc-1.webp"]), true); assert.equal(applyClearance([it], ["rb-ctc-1.webp"])[0].hold, undefined); assert.equal(applyClearance([it], [])[0].hold, "rights"); });
