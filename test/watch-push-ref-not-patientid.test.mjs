/* A lab-watch push must never carry the real GHIS patientId in its url/tag, because both transit
 * APNs/FCM and can sit on a lock screen. The title/body already withheld the name and MRN with an
 * explicit comment to that effect — this covers the deep link, which did not.
 *
 * Owner: "i want patient name in lab watch app should encrypt and decrypt" — tracing that same
 * property (nothing about the patient should be readable outside an authenticated session) found
 * the deep link carrying the id in the clear. Fix: every watch-list entry gets a random `ref`;
 * the push carries only that; the app resolves ref -> patientId itself via an authenticated
 * GET /api/watch/status, which is the one place the mapping is allowed to exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addWatch, getList } from "../functions/_watch.js";

function fakeEnv() {
  const store = new Map();
  return {
    store,
    WATCH_ENC_KEY: Buffer.alloc(32, 3).toString("base64"),
    WATCH_KV: {
      async get(k, mode) { const v = store.get(k); if (v == null) return null; return mode === "json" ? JSON.parse(v) : v; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }
    }
  };
}

test("every watched patient gets a ref distinct from its patientId", async () => {
  const env = fakeEnv();
  const list = await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "IPMR000000001", name: "A" });
  assert.ok(list[0].ref, "ref must be present");
  assert.notEqual(list[0].ref, "MR00000001", "ref must not just echo the patientId");
  assert.match(list[0].ref, /^[0-9a-f]{32}$/, "ref should be an opaque token, not a guessable shape");
});

test("a legacy entry with no ref is given one on first read, same as the name migration", async () => {
  const env = fakeEnv();
  env.store.set("watch:list:doc1", JSON.stringify(
    [{ patientId: "MR00000001", episodeId: "IPMR000000001", nameEnc: "", since: 1756600000000 }]));
  const list = await getList(env, "doc1");
  assert.ok(list[0].ref, "a pre-existing entry without ref must be backfilled");
});

test("two different patients never collide on ref", async () => {
  const env = fakeEnv();
  await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "E1", name: "A" });
  const list = await addWatch(env, "doc1", { patientId: "MR00000002", episodeId: "E2", name: "B" });
  assert.notEqual(list[0].ref, list[1].ref);
});

test("REGRESSION: the link built from a watch entry never contains the real patientId", async () => {
  const env = fakeEnv();
  const list = await addWatch(env, "doc1", { patientId: "MR00000001", episodeId: "E1", name: "Testpatient" });
  const p = list[0];
  const url = "/" + (p.ref ? ("?ghisRef=" + encodeURIComponent(p.ref)) : "");
  const tag = "lab-" + (p.ref || "watch");
  assert.ok(!url.includes(p.patientId), "the deep link must not contain the real patientId");
  assert.ok(!tag.includes(p.patientId), "the notification grouping tag must not contain the real patientId");
  assert.match(url, /ghisRef=/, "the link must carry the opaque ref");
});

test("the route table in functions/api/watch/[[path]].js actually builds the link this way", () => {
  const SRC = readFileSync(new URL("../functions/api/watch/[[path]].js", import.meta.url), "utf8");
  assert.match(SRC, /ghisRef=.*p\.ref/, "the push construction must use p.ref, not p.patientId, for the link");
  assert.ok(!/ghisPatient=.*p\.patientId/.test(SRC), "the old patientId-in-url construction must be gone");
});
