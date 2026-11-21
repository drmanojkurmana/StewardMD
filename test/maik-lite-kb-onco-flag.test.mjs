/* test/maik-lite-kb-onco-flag.test.mjs - the oncology book switch (2026-11-21).
 * smd_maik_kb_onco unset or anything but "1" must pin the ORIGINAL book (file, bytes, rows, sha),
 * so turning the feature off is exactly the previous behaviour; "1" pins the onco1 book. */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const PATH = require.resolve("../kb/ai/maik-lite-kb-store.js");

function loadWith(flag) {
  const store = {};
  if (flag !== undefined) store.smd_maik_kb_onco = flag;
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  delete require.cache[PATH];
  const m = require(PATH);
  delete globalThis.localStorage;
  return m;
}

test("flag off or unset keeps the original book exactly", () => {
  for (const f of [undefined, "0", "", "yes"]) {
    const m = loadWith(f);
    assert.equal(m.NAME, "maik-lite-kb.jsonl");
    assert.equal(m.URL, "https://models.stewardmd.in/maik/maik-lite-kb.jsonl");
    assert.equal(m.BYTES, 37976783);
    assert.equal(m.ROWS, 42176);
    assert.equal(m.SHA256, "96b4504ac62dfa50d672913aa7d52fbdb5f949de0b52dc9aed2fd73e74be480b");
  }
});

test("flag 1 picks the oncology book", () => {
  const m = loadWith("1");
  assert.equal(m.NAME, "maik-lite-kb-onco1.jsonl");
  assert.equal(m.URL, "https://models.stewardmd.in/maik/maik-lite-kb-onco1.jsonl");
  assert.equal(m.BYTES, 44952641);
  assert.equal(m.ROWS, 55385);
  assert.equal(m.SHA256, "9de2045d281fc05473b809401bd7dc2b3df9520505ab84c58be03d76dc5f4b43");
});

test("no localStorage (worker / node) keeps the original book", () => {
  delete require.cache[PATH];
  assert.equal(require(PATH).NAME, "maik-lite-kb.jsonl");
});
