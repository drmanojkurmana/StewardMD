// PrepNucleus Sound native adapter + plugin contract (rs-android-native).
// Pure logic with a mocked Capacitor plugin: no network, no device, no audio.
// node --test test/prep-sound-native.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require("../prep-sound-native.js");
const C = require("../prep-sound-core.js");
const read = (f) => fs.readFileSync(join(ROOT, f), "utf8");

function mockPlugin(overrides) {
  const calls = [];
  const plugin = {
    calls,
    play: async (arg) => { calls.push(["play", arg]); return { ok: true }; },
    pause: async (arg) => { calls.push(["pause", arg]); return { ok: true }; },
    stop: async (arg) => { calls.push(["stop", arg]); return { ok: true }; },
    setVolume: async (arg) => { calls.push(["setVolume", arg]); return { ok: true }; },
    getStatus: async () => ({ ok: true, playing: true, trackId: "rain_soft" }),
    setSecret: async (arg) => { calls.push(["setSecret", arg]); return { ok: true }; },
    getSecret: async (arg) => { calls.push(["getSecret", arg]); return { ok: true, value: "stored-value" }; },
    removeSecret: async (arg) => { calls.push(["removeSecret", arg]); return { ok: true }; },
    ...(overrides || {}),
  };
  return plugin;
}

test("backend selection: native Android + plugin wins; iOS and web fall back to web", () => {
  assert.deepEqual(N.selectBackend({ platform: "android", isNative: true, hasPlugin: true, webSupported: true }), { backend: "native", reason: "android-plugin" });
  assert.deepEqual(N.selectBackend({ platform: "ios", isNative: true, hasPlugin: false, webSupported: true }), { backend: "web", reason: "ios-web-fallback" });
  // iOS stays web even if a plugin object somehow appeared (native service is Android-only).
  assert.equal(N.selectBackend({ platform: "ios", isNative: true, hasPlugin: true, webSupported: true }).backend, "web");
  assert.equal(N.selectBackend({ platform: "android", isNative: true, hasPlugin: false, webSupported: true }).backend, "web");
  assert.equal(N.selectBackend({ platform: "web", isNative: false, hasPlugin: false, webSupported: true }).backend, "web");
  assert.equal(N.selectBackend({ platform: "web", isNative: false, hasPlugin: false, webSupported: false }).backend, "none");
  // Core mirrors the same rule.
  assert.deepEqual(C.selectPlaybackBackend({ platform: "android", isNative: true, hasPlugin: true, webSupported: false }), { backend: "native", reason: "android-plugin" });
  assert.equal(C.selectPlaybackBackend({ platform: "ios", isNative: true, hasPlugin: true, webSupported: true }).backend, "web");
});

test("track catalogue agrees across core, native adapter and WAV renderer", async () => {
  assert.deepEqual(Object.keys(C.TRACK_FILES).sort(), C.TRACKS.map((t) => t.id).sort());
  assert.deepEqual([...N.TRACK_IDS].sort(), C.TRACKS.map((t) => t.id).sort());
  assert.deepEqual(N.TRACK_FILES, C.TRACK_FILES);
  const gen = await import("../tools/prep-sound-render-wavs.mjs");
  assert.deepEqual(Object.keys(gen.RECIPES).sort(), C.TRACKS.map((t) => t.id).sort());
  const files = gen.renderAll();
  for (const t of C.TRACKS) {
    const bytes = files[t.id + ".wav"];
    assert.ok(bytes && bytes.length > 1000, t.id);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  }
  // Deterministic: rendering twice is byte-identical.
  const again = gen.renderAll();
  for (const k of Object.keys(files)) assert.ok(files[k].equals(again[k]), k);
});

test("adapter: play/pause/stop/setVolume forward to the plugin with clamped volume", async () => {
  const plugin = mockPlugin();
  const a = N.makeAdapter(plugin, { titleFor: (id) => "Title " + id });
  assert.equal(a.supported(), true);
  assert.deepEqual(a.start("bogus", 0.5), { ok: false, error: "unknown-track" });
  assert.equal(plugin.calls.length, 0, "unknown track never reaches the plugin");
  assert.deepEqual(a.start("rain_soft", 2), { ok: true });
  assert.equal(a.isPlaying(), true);
  assert.equal(a.current(), "rain_soft");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(plugin.calls[0], ["play", { trackId: "rain_soft", title: "Title rain_soft", volume: 1, backgroundPlayback: false }]);
  assert.deepEqual(a.setVolume(-1), { ok: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(plugin.calls[1], ["setVolume", { volume: 0 }]);
  a.pause(); assert.equal(a.isPlaying(), false);
  a.stop(); assert.equal(a.current(), null);
  const st = await a.refreshStatus();
  assert.deepEqual(st, { ok: true, playing: true, track: "rain_soft" });
});

test("adapter: backgroundPlayback is opt-in and no plugin means unsupported, never a fake success", () => {
  const plugin = mockPlugin();
  const a = N.makeAdapter(plugin);
  a.start("night_quiet", 0.5, { backgroundPlayback: true });
  assert.equal(plugin.calls[0][1].backgroundPlayback, true);
  const none = N.makeAdapter(null);
  assert.equal(none.supported(), false);
  assert.deepEqual(none.start("rain_soft", 0.5), { ok: false, error: "unsupported:native" });
  assert.deepEqual(none.pause(), { ok: false, error: "unsupported:native" });
  assert.deepEqual(N.buildPlayOptions("rain_soft", 99), { trackId: "rain_soft", title: undefined, volume: 1, backgroundPlayback: false });
  assert.equal(N.clampVolume("nope"), 0.8);
});

test("adapter: plugin rejection surfaces via onError and clears playing, without throwing", async () => {
  const errors = [];
  const plugin = mockPlugin({ play: async () => { throw new Error("focus-denied"); } });
  const a = N.makeAdapter(plugin, { onError: (e) => errors.push(String(e.message || e)) });
  assert.deepEqual(a.start("deep_drone", 0.5), { ok: true });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["focus-denied"]);
  assert.equal(a.isPlaying(), false);
});

test("secure storage passthrough: key/value validation, values never in errors", async () => {
  const plugin = mockPlugin();
  const a = N.makeAdapter(plugin);
  assert.deepEqual(await a.setSecret("prep_sound_spotify_refresh_token", "refresh-123"), { ok: true });
  assert.deepEqual(plugin.calls[0], ["setSecret", { key: "prep_sound_spotify_refresh_token", value: "refresh-123" }]);
  assert.deepEqual(await a.getSecret("prep_sound_spotify_refresh_token"), { ok: true, value: "stored-value" });
  assert.deepEqual(await a.removeSecret("prep_sound_spotify_refresh_token"), { ok: true });
  assert.deepEqual(await a.setSecret("bad key!", "x"), { ok: false, error: "invalid-key" });
  assert.deepEqual(await a.setSecret("ok_key", "x".repeat(8193)), { ok: false, error: "invalid-value" });
  const failing = N.makeAdapter(mockPlugin({ setSecret: async () => { throw new Error("keystore"); } }));
  const res = await failing.setSecret("ok_key", "super-secret-value");
  assert.deepEqual(res, { ok: false, error: "secure-store-failed" });
  assert.ok(!JSON.stringify(res).includes("super-secret-value"));
  const none = N.makeAdapter(null);
  assert.deepEqual(await none.getSecret("ok_key"), { ok: false, error: "unsupported:secure-storage" });
  assert.equal(N.validateSecretKey("prep_sound_spotify_refresh_token"), true);
  assert.equal(N.validateSecretKey(""), false);
});

test("plugin contract: manifest, service and plugin sources declare the targetSdk-36 foreground setup", () => {
  const manifest = read("local-plugins/capacitor-prep-sound/android/src/main/AndroidManifest.xml");
  assert.match(manifest, /FOREGROUND_SERVICE"/);
  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PLAYBACK/);
  assert.match(manifest, /foregroundServiceType="mediaPlayback"/);
  assert.match(manifest, /PrepSoundService/);
  assert.ok(!/<uses-permission android:name="android\.permission\.POST_NOTIFICATIONS"/.test(manifest), "does not re-declare a host-app permission");

  const service = read("local-plugins/capacitor-prep-sound/android/src/main/java/in/stewardmd/prepsound/PrepSoundService.java");
  for (const needle of ["MediaSession", "MediaPlayer", "requestAudioFocus", "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK",
    "ACTION_AUDIO_BECOMING_NOISY", "startForeground", "setLooping(true)"]) {
    assert.ok(service.includes(needle), "service: " + needle);
  }
  assert.ok(!/import\s+androidx\.media3/.test(service), "no Media3 dependency introduced");

  const plugin = read("local-plugins/capacitor-prep-sound/android/src/main/java/in/stewardmd/prepsound/PrepSoundPlugin.java");
  for (const m of ["play", "pause", "stop", "setVolume", "getStatus", "isAvailable", "setSecret", "getSecret", "removeSecret"]) {
    assert.ok(plugin.includes("public void " + m + "("), "plugin method " + m);
  }
  assert.ok(!/Log\.[a-z]+\([^)]*value/.test(plugin), "secret values are never logged");

  const store = read("local-plugins/capacitor-prep-sound/android/src/main/java/in/stewardmd/prepsound/SecureStore.java");
  for (const needle of ["AndroidKeyStore", "AES/GCM/NoPadding", "KeyGenParameterSpec", "GCMParameterSpec"]) {
    assert.ok(store.includes(needle), "secure store: " + needle);
  }
  assert.ok(!/import\s+.*EncryptedSharedPreferences|EncryptedSharedPreferences\.create/.test(store), "no deprecated EncryptedSharedPreferences");
  assert.ok(!/android\.util\.Log|Log\./.test(store), "secure store never logs");

  const pkg = JSON.parse(read("local-plugins/capacitor-prep-sound/package.json"));
  assert.equal(pkg.name, "@stewardmd/capacitor-prep-sound");
  assert.equal(JSON.parse(read("package.json")).dependencies["@stewardmd/capacitor-prep-sound"], "file:local-plugins/capacitor-prep-sound");
  const settings = read("android/capacitor.settings.gradle");
  assert.match(settings, /capacitor-prep-sound'\)\.projectDir = new File\('\.\.\/local-plugins\/capacitor-prep-sound\/android'\)/);
  assert.ok(!settings.includes("../../"), "capacitor.settings.gradle keeps ../ paths");
});

test("system media contract: listener service, manifest gate and plugin methods (rs-android-media)", () => {
  const manifest = read("local-plugins/capacitor-prep-sound/android/src/main/AndroidManifest.xml");
  assert.match(manifest, /PrepMediaListenerService/);
  assert.match(manifest, /android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE/);
  assert.match(manifest, /android\.service\.notification\.NotificationListenerService/);

  const listener = read("local-plugins/capacitor-prep-sound/android/src/main/java/in/stewardmd/prepsound/PrepMediaListenerService.java");
  assert.match(listener, /extends NotificationListenerService/);
  assert.match(listener, /reads NO\s*\n?\s*\*?\s*notification content/);
  // The service must never read notification content: no extras/accessor use at all.
  assert.ok(!/getNotification\(\)|\\.extras|getTitle|getText/.test(listener), "listener reads no notification content");

  const plugin = read("local-plugins/capacitor-prep-sound/android/src/main/java/in/stewardmd/prepsound/PrepSoundPlugin.java");
  for (const m of ["mediaAccessStatus", "openMediaAccessSettings", "nowPlaying", "control"]) {
    assert.ok(plugin.includes("public void " + m + "("), "plugin method " + m);
  }
  for (const needle of ["ACTION_NOTIFICATION_LISTENER_SETTINGS", "getActiveSessions",
    "TransportControls", "nowPlayingChanged", "MediaController.Callback",
    "PlaybackState.ACTION_SEEK_TO", "PlaybackState.ACTION_SKIP_TO_NEXT"]) {
    assert.ok(plugin.includes(needle), "plugin: " + needle);
  }
  // PrepNucleus's own ambience session is skipped; artwork is capped small.
  assert.ok(plugin.includes("own.equals(controller.getPackageName())"), "own session ignored");
  assert.ok(plugin.includes("256"), "artwork max ~256px");
  assert.ok(plugin.includes("data:image/jpeg;base64,"), "artwork is a JPEG data URL");
  // Observation stops with the last JS listener and on background.
  assert.ok(plugin.includes("releaseMediaCallback"), "callback released");
  assert.ok(!/Log\.[a-z]+\([^)]*(title|artist|album)/.test(plugin), "track metadata is never logged");
});

test("committed WAV assets match the deterministic renderer", async () => {
  const gen = await import("../tools/prep-sound-render-wavs.mjs");
  const files = gen.renderAll();
  for (const [name, bytes] of Object.entries(files)) {
    const committed = fs.readFileSync(join(ROOT, "local-plugins/capacitor-prep-sound/android/src/main/assets/prep-sound", name));
    assert.ok(committed.equals(bytes), name + " is stale: re-run node tools/prep-sound-render-wavs.mjs");
  }
});
