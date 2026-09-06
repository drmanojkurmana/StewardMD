import { test } from "node:test";
import assert from "node:assert";
import STORE from "../sknx-store.js";

test("save/list/get roundtrip via an injected store", () => {
  const mem = {}; const s = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const id = STORE.save({ differential: [{ label: "psoriasis", prob: 0.7 }], at: 1000 }, s);
  assert.ok(id);
  const list = STORE.list(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].top, "psoriasis");
  assert.equal(STORE.get(id, s).differential[0].label, "psoriasis");
});

test("save reports storage failure instead of claiming success", () => {
  const s = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(STORE.save({ differential: [], at: 10 }, s), null);
});

test("handle corrupt/non-array stored values gracefully", () => {
  // Test with "null" string
  const mem1 = {}; const s1 = { getItem: (k) => (k in mem1 ? mem1[k] : null), setItem: (k, v) => { mem1[k] = v; } };
  mem1["smd_sknx_history_v1"] = "null";
  assert.doesNotThrow(() => STORE.list(s1));
  assert.equal(STORE.list(s1).length, 0);
  assert.equal(STORE.get("x", s1), null);
  const id1 = STORE.save({ differential: [{ label: "eczema" }], at: 100 }, s1);
  assert.ok(id1);

  // Test with "{}" (empty object)
  const mem2 = {}; const s2 = { getItem: (k) => (k in mem2 ? mem2[k] : null), setItem: (k, v) => { mem2[k] = v; } };
  mem2["smd_sknx_history_v1"] = "{}";
  assert.doesNotThrow(() => STORE.list(s2));
  assert.equal(STORE.list(s2).length, 0);
  assert.equal(STORE.get("y", s2), null);
  const id2 = STORE.save({ differential: [{ label: "vitiligo" }], at: 200 }, s2);
  assert.ok(id2);
});

test("id uniqueness: same at and top label produce different ids even at cap", () => {
  const mem = {}; const s = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  // Fill store to 100-item cap with distinct entries (different labels)
  for (let i = 0; i < 100; i++) {
    STORE.save({ differential: [{ label: "disease_" + i, prob: 0.5 }], at: i }, s);
  }
  assert.equal(STORE.list(s).length, 100, "store should be at 100-item cap");

  // Now save two records with SAME at (1000) and SAME label ("acne") but different prob
  const id1 = STORE.save({ differential: [{ label: "acne", prob: 0.8 }], at: 1000 }, s);
  const id2 = STORE.save({ differential: [{ label: "acne", prob: 0.9 }], at: 1000 }, s);

  // IDs must be different despite identical at and label
  assert.notEqual(id1, id2, "ids must be different even with identical at and label");

  // Both should be in the list (2 newest entries at cap)
  const list = STORE.list(s);
  assert.equal(list.length, 100, "list should still be capped at 100");
  const id1InList = list.some(r => r.id === id1);
  const id2InList = list.some(r => r.id === id2);
  assert.ok(id1InList, "first new record should be in list");
  assert.ok(id2InList, "second new record should be in list");

  // get(id) must return the correct record for each
  const rec1 = STORE.get(id1, s);
  const rec2 = STORE.get(id2, s);
  assert.equal(rec1.differential[0].prob, 0.8, "rec1 should have prob 0.8");
  assert.equal(rec2.differential[0].prob, 0.9, "rec2 should have prob 0.9");
});
