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
})();
