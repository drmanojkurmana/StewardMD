import { test } from "node:test"; import assert from "node:assert";
import { applyClearance, isLive } from "../tools/prep-clearance.mjs";
test("held item hidden until cleared", () => { const it = { id: "x", hold: "rights", img: ["rb-ctc-1.webp"] }; assert.equal(isLive(it, []), false); assert.equal(isLive(it, ["rb-ctc-1.webp"]), true); assert.equal(applyClearance([it], ["rb-ctc-1.webp"])[0].hold, undefined); assert.equal(applyClearance([it], [])[0].hold, "rights"); });
import { idsForPool } from "../tools/prep-clearance.mjs";
test("idsForPool reads clearance CSV", () => { const csv = "pool,image id\nrb-ctc-*,rb-ctc-a.webp,x\nrb-r11-*,rb-r11-b.webp,x\n"; assert.deepEqual(idsForPool(csv, "rb-ctc"), ["rb-ctc-a.webp"]); assert.deepEqual(idsForPool(csv, "rb-r11-*"), ["rb-r11-b.webp"]); });
