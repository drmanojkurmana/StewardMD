// PrepNucleus Sound system media adapter (rs-android-media): mocked
// PrepSound plugin, no network, no device. Model/caps mapping, capability
// honesty, permission states, inert web/iOS. node --test test/prep-sound-system.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require("../prep-sound-system.js");
const read = (f) => fs.readFileSync(join(ROOT, f), "utf8");

const ANDROID = { platform: "android", isNative: true, hasPlugin: true };
const ART = "data:image/jpeg;base64,/9j/abc";

function rawPlaying(overrides) {
  return {
    granted: true, hasSession: true, app: "Gaana", package: "com.gaana",
    title: "Kesariya", artist: "Arijit Singh", album: "Brahmastra",
    artwork: ART, durationMs: 240000, positionMs: 61000, isPlaying: true,
    actions: { play: false, pause: true, next: true, previous: true, seek: true },
    ...(overrides || {}),
  };
}

function mockPlugin(overrides) {
  const calls = [];
  const listeners = {};
  const plugin = {
    calls, listeners,
    mediaAccessStatus: async () => ({ granted: true }),
    openMediaAccessSettings: async () => { calls.push(["openMediaAccessSettings"]); return { ok: true }; },
    nowPlaying: async () => rawPlaying(),
    control: async (arg) => { calls.push(["control", arg]); return { ok: true, action: arg.action }; },
    addListener: (event, cb) => {
      (listeners[event] = listeners[event] || []).push(cb);
      return Promise.resolve({ remove: () => { calls.push(["removeListener", event]); listeners[event] = []; } });
    },
    ...(overrides || {}),
  };
  return plugin;
}

test("model mapping: native payload becomes exactly the player model shape", () => {
  const m = S.toModel(rawPlaying());
  assert.deepEqual(Object.keys(m), ["provider", "providerLabel", "title", "artist", "album",
    "artworkUrl", "durationMs", "positionMs", "isPlaying", "shuffle", "repeat", "liked", "volume"]);
  assert.deepEqual(m, { provider: "system", providerLabel: "Gaana", title: "Kesariya",
    artist: "Arijit Singh", album: "Brahmastra", artworkUrl: ART, durationMs: 240000,
    positionMs: 61000, isPlaying: true, shuffle: null, repeat: null, liked: null, volume: null });
  // Missing text/artwork degrade to ""/null; bad numbers to 0; package is the label fallback.
  const sparse = S.toModel(rawPlaying({ app: null, title: null, artist: 7, artwork: null, durationMs: -5, positionMs: "x" }));
  assert.deepEqual(sparse, { provider: "system", providerLabel: "com.gaana", title: "", artist: "",
    album: "Brahmastra", artworkUrl: null, durationMs: 0, positionMs: 0, isPlaying: true,
    shuffle: null, repeat: null, liked: null, volume: null });
  assert.equal(S.toModel(null), null);
  assert.equal(S.toModel({ granted: true, hasSession: false }), null);
});

test("caps come from PlaybackState actions; unsupported features stay false", () => {
  assert.deepEqual(S.toCaps(rawPlaying()),
    { play: false, pause: true, next: true, previous: true, seek: true,
      shuffle: false, repeat: false, like: false, volume: false, artwork: true });
  assert.deepEqual(S.toCaps(rawPlaying({ artwork: null, actions: { play: true, pause: false, next: false, previous: false, seek: false } })),
    { play: true, pause: false, next: false, previous: false, seek: false,
      shuffle: false, repeat: false, like: false, volume: false, artwork: false });
  assert.deepEqual(S.toCaps(null), S.emptyCaps());
  assert.deepEqual(S.toCaps({ hasSession: false, actions: { play: true } }), S.emptyCaps());
  assert.deepEqual(Object.keys(S.emptyCaps()), ["play", "pause", "next", "previous", "seek", "shuffle", "repeat", "like", "volume", "artwork"]);
});

test("unsupported on web and iOS: status/nowPlaying/control never pretend", async () => {
  for (const env of [{ platform: "ios", isNative: true, hasPlugin: true },
                     { platform: "web", isNative: false, hasPlugin: false },
                     { platform: "android", isNative: false, hasPlugin: true },
                     { platform: "android", isNative: true, hasPlugin: false }]) {
    assert.equal(S.isSupportedEnv(env), false, JSON.stringify(env));
    const a = S.makeAdapter(mockPlugin(), env);
    assert.equal(a.supported(), false);
    assert.equal((await a.status()).state, "unsupported");
    const np = await a.nowPlaying();
    assert.equal(np.model, null);
    assert.deepEqual(np.caps, S.emptyCaps());
    assert.equal(np.error, "unsupported:system:nowPlaying");
    assert.equal((await a.requestAccess()).error, "unsupported:system:requestAccess");
    assert.equal((await a.play()).error, "unsupported:system:play");
  }
  // No plugin at all on Android is equally unsupported.
  assert.equal(S.makeAdapter(null, ANDROID).supported(), false);
  assert.equal(S.isSupportedEnv(ANDROID), true);
});

test("permission states: needs-access, no-session, ready; explanation is the plain card copy", async () => {
  assert.equal(S.PERMISSION_EXPLANATION,
    "Lets PrepNucleus show and control the song playing in your music app. PrepNucleus does not read your notifications.");
  const denied = S.makeAdapter(mockPlugin({ mediaAccessStatus: async () => ({ granted: false }) }), ANDROID);
  assert.deepEqual(await denied.status(), { supported: true, granted: false, hasSession: false,
    state: "needs-access", explanation: S.PERMISSION_EXPLANATION });
  const idle = S.makeAdapter(mockPlugin({ nowPlaying: async () => ({ granted: true, hasSession: false }) }), ANDROID);
  assert.equal((await idle.status()).state, "no-session");
  const ready = S.makeAdapter(mockPlugin(), ANDROID);
  const st = await ready.status();
  assert.equal(st.state, "ready");
  assert.equal(st.hasSession, true);
  // requestAccess opens the system settings exactly once.
  const plugin = mockPlugin();
  await S.makeAdapter(plugin, ANDROID).requestAccess();
  assert.deepEqual(plugin.calls, [["openMediaAccessSettings"]]);
});

test("nowPlaying snapshot and transport controls forward to the plugin", async () => {
  const plugin = mockPlugin();
  const a = S.makeAdapter(plugin, ANDROID);
  const snap = await a.nowPlaying();
  assert.equal(snap.ok, true);
  assert.equal(snap.model.providerLabel, "Gaana");
  assert.equal(snap.caps.pause, true);
  assert.deepEqual(await a.pause(), { ok: true, supported: true, action: "pause" });
  assert.deepEqual(await a.next(), { ok: true, supported: true, action: "next" });
  assert.deepEqual(await a.previous(), { ok: true, supported: true, action: "previous" });
  assert.deepEqual(await a.seek(90500.6), { ok: true, supported: true, action: "seek" });
  assert.deepEqual(plugin.calls.filter((c) => c[0] === "control").map((c) => c[1]),
    [{ action: "pause" }, { action: "next" }, { action: "previous" }, { action: "seek", value: 90501 }]);
  // Unknown transport verbs are rejected locally, never sent natively.
  assert.equal((await a.control("shuffle")).error, "unsupported:system:shuffle");
  assert.equal(plugin.calls.filter((c) => c[0] === "control").length, 4);
});

test("native rejections surface as typed results (denied / no session), never throws", async () => {
  const denied = S.makeAdapter(mockPlugin({
    control: async () => { const e = new Error("media-access-denied"); e.code = "media-access-denied"; throw e; },
  }), ANDROID);
  assert.deepEqual(await denied.play(), { ok: false, supported: true, action: "play", error: "media-access-denied" });
  const gone = S.makeAdapter(mockPlugin({
    nowPlaying: async () => { throw new Error("no-session"); },
  }), ANDROID);
  const snap = await gone.nowPlaying();
  assert.equal(snap.ok, false);
  assert.equal(snap.model, null);
  assert.equal(snap.error, "no-session");
});

test("subscribe maps nowPlayingChanged events and unsubscribe removes the native listener", async () => {
  const plugin = mockPlugin();
  const a = S.makeAdapter(plugin, ANDROID);
  const seen = [];
  const off = a.subscribe((snap) => seen.push(snap));
  await new Promise((r) => setImmediate(r));
  assert.equal(plugin.listeners.nowPlayingChanged.length, 1);
  plugin.listeners.nowPlayingChanged[0](rawPlaying({ title: "Next Song", isPlaying: false,
    actions: { play: true, pause: false, next: true, previous: false, seek: false } }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model.title, "Next Song");
  assert.equal(seen[0].model.isPlaying, false);
  assert.equal(seen[0].caps.play, true);
  plugin.listeners.nowPlayingChanged[0]({ granted: true, hasSession: false });
  assert.equal(seen[1].model, null);
  off();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(plugin.calls.filter((c) => c[0] === "removeListener"), [["removeListener", "nowPlayingChanged"]]);
  // Unsupported adapters subscribe to nothing.
  assert.equal(typeof S.makeAdapter(null, ANDROID).subscribe(() => {}), "function");
});

test("privacy + source contract: no storage, analytics, network or history in the adapter", () => {
  const src = read("prep-sound-system.js");
  for (const banned of ["localStorage", "sessionStorage", "indexedDB", "fetch(", "gtag("]) {
    assert.ok(!src.includes(banned), "must not reference " + banned);
  }
  assert.ok(src.includes("window.PREP_SOUND_SYSTEM") || src.includes("PREP_SOUND_SYSTEM ="));
  assert.ok(src.includes(S.PERMISSION_EXPLANATION));
});
