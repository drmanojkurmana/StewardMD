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

test("id uniqueness: same at and top label produce different ids", () => {
  const mem = {}; const s = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const id1 = STORE.save({ differential: [{ label: "acne", prob: 0.8 }], at: 1000 }, s);
  const id2 = STORE.save({ differential: [{ label: "acne", prob: 0.9 }], at: 1000 }, s);
  assert.notEqual(id1, id2, "ids must be different for distinct saves");
  const list = STORE.list(s);
  assert.equal(list.length, 2, "both analyses should be in history");
  const rec1 = STORE.get(id1, s);
  const rec2 = STORE.get(id2, s);
  assert.equal(rec1.differential[0].prob, 0.8, "first record should have prob 0.8");
  assert.equal(rec2.differential[0].prob, 0.9, "second record should have prob 0.9");
});
