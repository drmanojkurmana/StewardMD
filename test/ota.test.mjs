/* test/ota.test.mjs — OTA update system, Phase 1 (functions/_ota.js).
 *
 * Every assertion here traces back to the failure that killed the last version of this system:
 * a stale bundle silently downgrading installs because the kill mechanism needed a redeploy to
 * re-arm. So the load-bearing checks are: staging a build never touches the live channel; the
 * kill switch works without any of the publish/rollback machinery; a rollback increases the
 * version number rather than moving it backward; and a device is never offered a bundle its
 * native build can't run or a version it already has.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as OTA from "../functions/_ota.js";

// A fake R2 bucket — just enough of the real R2Bucket surface (.get/.put) for _ota.js to run
// against, backed by an in-memory Map so nothing here touches the network.
function fakeR2() {
  const store = new Map();
  return {
    _store: store,
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return { text: async () => v.text, body: v.text, size: v.size, httpMetadata: v.httpMetadata };
    },
    async put(key, value, opts) {
      const text = typeof value === "string" ? value : String(value);
      store.set(key, { text, size: text.length, httpMetadata: (opts && opts.httpMetadata) || {} });
    },
  };
}

test("a staged candidate is invisible to devices until published", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json", message: "fix" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [{ path: "icu.js", hash: "h1", size: 10 }] }));
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false, "no channel published yet -> no update, even though a candidate exists");
  assert.equal(check.reason, "no-channel");
});

test("publish moves the candidate to the live channel, versioned from 1", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json", message: "fix" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [{ path: "icu.js", hash: "h1", size: 10 }] }));
  const channel = await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal(channel.version, 1);
  assert.equal(channel.commit, "abc123");
  assert.equal(channel.publishedBy, "owner@x.com");
  const history = await OTA.getHistory(r2);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "publish");
});

test("publish with nothing staged fails explicitly, does not fabricate a channel", async () => {
  const r2 = fakeR2();
  const res = await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal(res.error, "no-candidate");
  assert.equal(await OTA.getChannel(r2), null);
});

test("a device already on the live version is told there is nothing to do", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const upToDate = await OTA.checkForDevice(r2, { version: 1, nativeBuild: 7 });
  assert.equal(upToDate.ota, false);
  assert.equal(upToDate.reason, "up-to-date");
  const behind = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(behind.ota, true);
  assert.equal(behind.version, 1);
});

test("a device is never offered a release its native build can't run", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));
  await OTA.publish(r2, { by: "owner@x.com", minNativeBuild: 9 });
  const tooOld = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(tooOld.ota, false);
  assert.equal(tooOld.reason, "native-build-too-old");
  const okBuild = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 9 });
  assert.equal(okBuild.ota, true);
});

test("THE load-bearing one: the kill switch beats everything, and needs no publish state to work", async () => {
  const r2 = fakeR2();
  // No candidate, no channel, no history — kill must still work on a completely empty store.
  const state = await OTA.setKill(r2, { on: true, by: "owner@x.com" });
  assert.equal(state.on, true);
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false);
  assert.equal(check.reason, "disabled");
});

test("kill switch overrides an ALREADY-LIVE channel — an armed release goes dark instantly", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, true, "sanity: live before kill");
  await OTA.setKill(r2, { on: true, by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, false, "dark after kill");
  await OTA.setKill(r2, { on: false, by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, true, "restored after un-kill");
});

test("rollback republishes an old version under a NEW, higher version number", async () => {
  const r2 = fakeR2();
  // v1
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "v1commit", manifestKey: "ota/manifests/v1commit.json" }));
  await r2.put("ota/manifests/v1commit.json", JSON.stringify({ commit: "v1commit", files: [{ path: "a.js", hash: "ha", size: 1 }] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  // v2 — a bad release
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "v2commit", manifestKey: "ota/manifests/v2commit.json" }));
  await r2.put("ota/manifests/v2commit.json", JSON.stringify({ commit: "v2commit", files: [{ path: "a.js", hash: "hb", size: 1 }] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  let channel = await OTA.getChannel(r2);
  assert.equal(channel.version, 2);
  assert.equal(channel.commit, "v2commit");

  // roll back to v1's content
  const rolled = await OTA.rollback(r2, { toVersion: 1, by: "owner@x.com" });
  assert.equal(rolled.version, 3, "rollback is version 3, NOT a reversion to version 1 — a device that only trusts 'newer' must still take it");
  assert.equal(rolled.commit, "v1commit", "but the CONTENT is v1's — the bad v2 build is gone from the live channel");

  const history = await OTA.getHistory(r2);
  assert.equal(history[0].action, "rollback");
  assert.equal(history[0].rollbackOf, 1);

  // a device that had already taken v2 (version 2) must still see the rollback as an update
  const deviceOnBadV2 = await OTA.checkForDevice(r2, { version: 2, nativeBuild: 7 });
  assert.equal(deviceOnBadV2.ota, true, "a device on the bad release must be offered the rollback");
  assert.equal(deviceOnBadV2.version, 3);
  const back = await OTA.getManifest(r2, deviceOnBadV2.commit);
  assert.equal(back.files[0].hash, "ha", "the file it downloads is v1's content, not v2's");
});

test("rolling back to a version that never existed fails explicitly", async () => {
  const r2 = fakeR2();
  const res = await OTA.rollback(r2, { toVersion: 999, by: "owner@x.com" });
  assert.equal(res.error, "version-not-found");
});

test("a missing manifest fails the device check closed, never half-answers", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  // simulate the manifest object having gone missing from R2 after the channel already points at it
  r2._store.delete("ota/manifests/abc123.json");
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false);
  assert.equal(check.reason, "manifest-missing");
});

test("history is capped, newest first", async () => {
  const r2 = fakeR2();
  for (let i = 1; i <= 5; i++) {
    await r2.put("ota/candidate.json", JSON.stringify({ commit: "c" + i, manifestKey: "ota/manifests/c" + i + ".json" }));
    await r2.put("ota/manifests/c" + i + ".json", JSON.stringify({ commit: "c" + i, files: [] }));
    await OTA.publish(r2, { by: "owner@x.com" });
  }
  const history = await OTA.getHistory(r2);
  assert.equal(history.length, 5);
  assert.equal(history[0].commit, "c5", "newest entry first");
  assert.equal(history[4].commit, "c1", "oldest entry last");
});

test("getFile fetches the exact content-addressed key, nothing else", async () => {
  const r2 = fakeR2();
  await r2.put("ota/files/deadbeef", "file-bytes");
  const obj = await OTA.getFile(r2, "deadbeef");
  assert.equal(await obj.text(), "file-bytes");
  assert.equal(await OTA.getFile(r2, "not-there"), null);
});
