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
