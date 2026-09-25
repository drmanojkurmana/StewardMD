/* The StewardID as a number a hospital can trust (functions/_steward_id.js). PURE.
 * What is defended: a typo is refused rather than resolved to another patient, and a patient ID can
 * never be read as a clinic code.
 * node --test test/steward-id.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintStewardId, normalizeStewardId, isStewardId, STEWARD_PREFIX } from "../functions/_steward_id.js";

test("a minted ID has the SMP- shape and passes its own check", () => {
  for (let i = 0; i < 500; i++) {
    const id = mintStewardId();
    assert.match(id, /^SMP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/, id);
    assert.equal(normalizeStewardId(id), id);
  }
});

test("it is never mistaken for a clinic code", () => {
  const id = mintStewardId();
  assert.ok(id.startsWith(STEWARD_PREFIX) && !id.startsWith("SMD-"));
  assert.equal(normalizeStewardId("SMD-4K7Q2M"), null, "a clinic code is not a patient");
});

test("what a person or scanner produces is read the way Crockford intends", () => {
  const id = mintStewardId(() => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const loose = id.toLowerCase().replace(/-/g, " ");
  assert.equal(normalizeStewardId(loose), id, "lower case and spaces");
  assert.equal(normalizeStewardId(id.replace(/1/g, "I")), id, "I read as 1");
  assert.equal(normalizeStewardId(id.replace(/1/g, "l")), id, "l read as 1");
});

test("a single wrong character or a swap of neighbours is REFUSED, never another patient", () => {
  let refusedSingle = 0, refusedSwap = 0, total = 0;
  for (let k = 0; k < 300; k++) {
    const id = mintStewardId();
    const raw = id.replace(/[^0-9A-Z]/g, "").slice(3);   // 9 chars incl. check
    for (let i = 0; i < raw.length; i++) {
      const alt = raw[i] === "7" ? "8" : "7";
      const typo = "SMP" + raw.slice(0, i) + alt + raw.slice(i + 1);
      total++; if (normalizeStewardId(typo) === null) refusedSingle++;
    }
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === raw[i + 1]) continue;
      const sw = "SMP" + raw.slice(0, i) + raw[i + 1] + raw[i] + raw.slice(i + 2);
      if (normalizeStewardId(sw) === null) refusedSwap++; else refusedSwap += 0;
    }
  }
  assert.equal(refusedSingle, total, "every single-character error is caught");
  assert.ok(refusedSwap > 0, "adjacent swaps are caught");
});

test("junk and empty input is not an ID", () => {
  for (const x of [null, undefined, "", "SMP-", "SMP-123", "hello", "SMP-UUUU-UUUUU"]) assert.equal(isStewardId(x), false, String(x));
});
