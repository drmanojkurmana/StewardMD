/* MaiK conversation memory: a short, all-generic message ("what medicines you suggest?", "ok rx?",
 * "dose?") must be treated as a FOLLOW-UP on the current topic, while a message naming a new condition
 * ("meningitis treatment") must route fresh. Guards the GENERIC_FU classifier in home.js maikResolveFollowup.
 * node --test test/maik-followup.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const m = SRC.match(/var GENERIC_FU = (\/\^\([\s\S]*?\)\$\/);/);
assert.ok(m, "GENERIC_FU regex present in home.js");
const GENERIC_FU = eval(m[1]);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s?]/g, " ").replace(/\s+/g, " ").trim();
// mirrors the wc<=7 + every-token-generic gate in maikResolveFollowup
function isFollowup(q) { const t = norm(q).replace(/\?/g, "").split(" ").filter(Boolean); return t.length > 0 && t.length <= 7 && t.every((w) => GENERIC_FU.test(w)); }

test("follow-up phrasings stay on the current topic", () => {
  ["what medicines you suggest", "ok rx", "what to write in prescription", "dose?", "first line treatment",
   "which drug", "what medicines would you suggest", "recommend medication", "how to treat", "and complications",
   "what investigations", "any red flags", "side effects", "safe in renal"].forEach((q) => {
    assert.equal(isFollowup(q), true, "expected follow-up: " + q);
  });
});

test("naming a new condition routes fresh (NOT a follow-up)", () => {
  ["meningitis treatment", "pneumonia antibiotics", "how to correct metabolic acidosis", "dengue management",
   "start dx my patient", "sepsis workup", "treat DKA", "management of stroke"].forEach((q) => {
    assert.equal(isFollowup(q), false, "expected new topic: " + q);
  });
});
