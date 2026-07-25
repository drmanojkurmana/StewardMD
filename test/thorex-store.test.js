const assert = require("assert");
const { webcrypto } = require("crypto");
global.crypto = webcrypto; // real AES-GCM in node
const S = require("../thorex-store.js");
(async () => {
  const store = S.__testStore(); // in-memory KV factory (memKV for records + memKV for key)
  await store.save({ id: "c1", createdAt: 1, verdict: "Pneumonia" });
  await store.save({ id: "c2", createdAt: 2, verdict: "Normal" });
  assert.equal((await store.all()).length, 2);
  assert.equal((await store.get("c1")).verdict, "Pneumonia");
  assert.deepEqual((await store.timeline()).map(x => x.id), ["c2", "c1"]);
  await store.delete("c1");
  assert.equal((await store.get("c1")), null);
  console.log("ok");

  // --- Corrupt-record resilience: one tampered record must not reject the whole timeline. ---
  // __testStore doesn't expose its kv/keyStore instances, so build a store manually with our own
  // memKV so we can reach in and corrupt a stored record's ciphertext post-save.
  const kvStore = S._memKV();
  const keyStore = S._memKV();
  const store3 = S.makeStore({ kv: kvStore, keyStore: keyStore });
  await store3.save({ id: "g1", createdAt: 1, verdict: "Pneumonia" });
  await store3.save({ id: "g2", createdAt: 2, verdict: "Normal" });
  await store3.save({ id: "bad", createdAt: 3, verdict: "Effusion" });

  const stored = await kvStore.get("tx-cxr:bad");
  assert.ok(stored && stored.ct, "expected stored record to have ct");
  // Flip one character in the base64 ciphertext to corrupt it (auth tag / ciphertext mismatch).
  const ctChars = stored.ct.split("");
  const flipIdx = 0;
  const orig = ctChars[flipIdx];
  ctChars[flipIdx] = orig === "A" ? "B" : "A";
  const corrupted = { iv: stored.iv, ct: ctChars.join("") };
  await kvStore.set("tx-cxr:bad", corrupted);

  // all() must not reject — it should silently skip the corrupt record and return the 2 good ones.
  const list = await store3.all();
  assert.equal(list.length, 2, "all() should skip the corrupt record and return only good ones");
  assert.deepEqual(list.map(x => x.id).sort(), ["g1", "g2"]);

  // timeline() (built on all()) must also be resilient and keep descending order for good records.
  const tl = await store3.timeline();
  assert.deepEqual(tl.map(x => x.id), ["g2", "g1"]);

  // get() on a still-good record must keep working.
  assert.equal((await store3.get("g1")).verdict, "Pneumonia");

  console.log("ok: corrupt-record resilience");
})();
