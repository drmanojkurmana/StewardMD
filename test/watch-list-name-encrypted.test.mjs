/* The watched-patient name is PHI and must never sit readable in KV.
 *
 * It was encrypted on the way in by addWatch, and then quietly written back in plaintext: getList
 * decrypts `nameEnc` into `name` for its callers, and addWatch/removeWatch both read-then-write,
 * so adding a second patient re-persisted the FIRST patient's name in the clear. The encryption
 * looked present in the code and was defeated in the store.
 *
 * These tests assert against the raw bytes in the fake KV, not against what getList hands back,
 * because the bug was invisible from the caller's side: getList returned the right thing either way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getList, setList, addWatch, removeWatch } from "../functions/_watch.js";

const NAME_A = "Testpatient Alpha";
const NAME_B = "Testpatient Beta";

function fakeEnv() {
  const store = new Map();
  return {
    store,
    WATCH_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    WATCH_KV: {
      async get(k, mode) {
        const v = store.get(k);
        if (v == null) return null;
        return mode === "json" ? JSON.parse(v) : v;
      },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }
    }
  };
}

const raw = (env) => env.store.get("watch:list:doc1") || "";

test("a name added to the list is not readable in the store", async () => {
  const env = fakeEnv();
  await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "IPMR000000001", name: NAME_A });
  assert.ok(!raw(env).includes(NAME_A), "the stored list must not contain the plaintext name");
  assert.match(raw(env), /nameEnc/, "it must be there, encrypted");
});

test("REGRESSION: adding a second patient does not re-expose the first one's name", async () => {
  const env = fakeEnv();
  await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "IPMR000000001", name: NAME_A });
  await addWatch(env, "doc1", { patientId: "MR00000002", episodeId: "IPMR000000002", name: NAME_B });
  const stored = raw(env);
  assert.ok(!stored.includes(NAME_A), "the first patient's name leaked back into the store");
  assert.ok(!stored.includes(NAME_B));
});

test("REGRESSION: removing a patient does not re-expose the survivors", async () => {
  const env = fakeEnv();
  await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "IPMR000000001", name: NAME_A });
  await addWatch(env, "doc1", { patientId: "MR00000002", episodeId: "IPMR000000002", name: NAME_B });
  await removeWatch(env, "doc1", "MR00000002");
  assert.ok(!raw(env).includes(NAME_A), "the remaining patient's name leaked back into the store");
});

test("callers still receive the name in plaintext", async () => {
  const env = fakeEnv();
  await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "IPMR000000001", name: NAME_A });
  const list = await getList(env, "doc1");
  assert.equal(list[0].name, NAME_A, "decryption for callers must be unchanged");
  assert.equal(list[0].patientId, "MR00000001");
});

test("a legacy plaintext row is encrypted on first read, not left until it expires", async () => {
  const env = fakeEnv();
  // Written by the old code path: plaintext `name`, no `nameEnc`.
  env.store.set("watch:list:doc1", JSON.stringify(
    [{ patientId: "MR00000001", episodeId: "IPMR000000001", name: NAME_A, since: 1756600000000 }]));

  const list = await getList(env, "doc1");
  assert.equal(list[0].name, NAME_A, "the migration must not lose the name");
  assert.ok(!raw(env).includes(NAME_A), "the legacy row should have been rewritten encrypted");
  assert.match(raw(env), /nameEnc/);
});

test("a name is dropped rather than stored readable if encryption fails", async () => {
  const env = fakeEnv();
  env.WATCH_ENC_KEY = "not-a-valid-key";   // importKey will reject
  await setList(env, "doc1", [{ patientId: "MR00000001", name: NAME_A }]);
  assert.ok(!raw(env).includes(NAME_A), "failing closed means no plaintext, not best-effort plaintext");
});
