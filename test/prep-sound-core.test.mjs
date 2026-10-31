/* PrepNucleus Sound core tests (rs-sound, Phase 0-2). Pure logic only: no network,
   no DOM, no audio, no paid calls.
   node --test test/prep-sound-core.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../prep-sound-core.js");

const store = (vals) => ({ getItem: (k) => (k in vals ? vals[k] : null) });

test("flags: sound OFF unless explicitly opted in; master smd_prep gates it", () => {
  assert.equal(C.enabled(store({})), false);
  assert.equal(C.enabled(store({ smd_prep_sound: "0" })), false);
  assert.equal(C.enabled(store({ smd_prep_sound: "1" })), true);
  assert.equal(C.enabled(store({ smd_prep: "0", smd_prep_sound: "1" })), false, "master off wins");
  assert.equal(C.FLAG, "smd_prep_sound");
  assert.equal(C.SPOTIFY_FLAG, "smd_prep_sound_spotify", "spotify flag name reserved, not created here");
});

test("prefs: defaults never autoplay, never resume, pause-before-video on", () => {
  const p = C.defaultPrefs();
  assert.equal(p.enabled, false);
  assert.equal(p.autoResume, false);
  assert.equal(p.backgroundPlayback, false);
  assert.equal(p.pauseBeforeVideo, true);
  assert.equal(p.preferredProvider, "first_party");
  assert.deepEqual(C.validatePrefs(p), []);
});

test("prefs: migrate unknown/partial input back to a valid shape", () => {
  assert.deepEqual(C.validatePrefs(C.migratePrefs(null)), []);
  assert.deepEqual(C.validatePrefs(C.migratePrefs({ enabled: true, preferredProvider: "spotify", autoResume: true })), []);
  const m = C.migratePrefs({ preferredProvider: "napster", preferredPreset: "x", enabled: "yes" });
  assert.equal(m.preferredProvider, "first_party");
  assert.equal(m.enabled, false);
  assert.deepEqual(C.validatePrefs({ v: 1 }), ["enabled-bool", "provider-unknown", "preset-unknown", "autoResume-bool", "backgroundPlayback-bool", "pauseBeforeVideo-bool"]);
  assert.deepEqual(C.validatePrefs({ ...C.defaultPrefs(), history: [{ t: "x" }] }), ["history-forbidden"], "listening history must never validate");
});

test("matrix: seven providers with plan-section-3 capabilities", () => {
  const ids = C.PROVIDERS.map((p) => p.id);
  assert.deepEqual(ids, ["first_party", "spotify", "spotify_remote", "youtube_music", "amazon_music", "jiosaavn", "gaana", "apple_music"]);
  assert.equal(C.providerById("first_party").capabilities.embeddedPlayback, true);
  for (const id of ["spotify", "youtube_music", "amazon_music", "jiosaavn", "gaana", "apple_music"]) {
    const c = C.providerById(id).capabilities;
    assert.equal(c.embeddedPlayback, false, id);
    assert.equal(c.externalHandoff, true, id);
    assert.equal(c.remoteControls, false, id + ": no phantom remote controls");
    assert.equal(c.queueControls, false, id);
  }
  assert.equal(C.providerById("spotify_remote").kind, "reserved");
  assert.equal(C.providerById("nope"), null);
});

test("handoff: verified home URLs open; unverified shapes are unavailable", () => {
  assert.deepEqual(C.handoffHome("spotify"), { ok: true, url: "https://open.spotify.com/" });
  assert.deepEqual(C.handoffHome("youtube_music"), { ok: true, url: "https://music.youtube.com/" });
  assert.deepEqual(C.handoffHome("amazon_music"), { ok: true, url: "https://music.amazon.com/" });
  assert.deepEqual(C.handoffHome("jiosaavn"), { ok: true, url: "https://www.jiosaavn.com/" });
  assert.deepEqual(C.handoffHome("gaana"), { ok: true, url: "https://gaana.com/" });
  assert.deepEqual(C.handoffHome("apple_music"), { ok: true, url: "https://music.apple.com/" });
  assert.equal(C.handoffHome("first_party").ok, false);
  assert.equal(C.handoffHome("spotify").error, undefined);
  // User-supplied share URLs: official shapes pass, anything else fails.
  assert.equal(C.handoffShare("spotify", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").ok, true);
  assert.equal(C.handoffShare("spotify", "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M").ok, false, "no spotify: URIs");
  assert.equal(C.handoffShare("spotify", "https://open.spotify.com/search/lofi").ok, false, "no fabricated search shapes");
  assert.equal(C.handoffShare("youtube_music", "https://music.youtube.com/watch?v=dQw4w9WgXcQ").ok, true);
  assert.equal(C.handoffShare("amazon_music", "https://music.amazon.com/playlists/xyz").ok, false, "unverified amazon deep shape");
  assert.equal(C.handoffShare("jiosaavn", "https://www.jiosaavn.com/search/foo").ok, false);
  assert.equal(C.handoffShare("gaana", "https://gaana.com/search/foo").ok, false);
  // Search: only the official YouTube results shape.
  assert.equal(C.handoffSearch("youtube_music", "lofi study").url, "https://www.youtube.com/results?search_query=" + encodeURIComponent("lofi study"));
  assert.equal(C.handoffSearch("spotify", "lofi").ok, false);
  assert.equal(C.handoffSearch("jiosaavn", "lofi").ok, false);
  assert.equal(C.handoffSearch("youtube_music", "  ").ok, false);
});

test("catalogue: ambient/white-noise originals only; rights gate rejects the rest", () => {
  assert.deepEqual(C.checkManifest(C.TRACKS), []);
  assert.ok(C.TRACKS.length >= 4);
  for (const p of C.PRESETS) assert.ok(C.trackById(p.track), "preset has a real track: " + p.id);
  assert.deepEqual(C.checkManifest([{ id: "x", title: "X", kind: "song", licence: "original", expiry: null }]), ["kind:x"]);
  assert.deepEqual(C.checkManifest([{ id: "y", title: "Y", kind: "ambient", licence: "licensed-hit", expiry: null }]), ["licence:y"]);
  assert.deepEqual(C.checkManifest([{ id: "z", title: "Z", kind: "ambient", licence: "original", expiry: "2027-01-01" }]), ["expiry:z"]);
});

test("state machine: select, external handoff, play/pause/hush/stop", () => {
  let s = C.transition("idle", { t: "ENABLE" });
  assert.equal(s.state, "selecting_provider");
  s = C.transition(s.state, { t: "SELECT_PROVIDER", provider: "first_party" });
  assert.equal(s.state, "ready");
  s = C.transition(s.state, { t: "PLAY" });
  assert.equal(s.state, "playing_embedded");
  assert.ok(s.effects.includes("start-embedded"));
  s = C.transition(s.state, { t: "HUSH" });
  assert.equal(s.state, "interrupted", "video/TTS path pauses");
  assert.ok(!s.effects.includes("start-embedded"), "hush never schedules a resume");
  s = C.transition(s.state, { t: "PLAY" });
  assert.equal(s.state, "playing_embedded", "user explicitly resumes");
  s = C.transition(s.state, { t: "STOP" });
  assert.equal(s.state, "idle");
  // External path.
  s = C.transition("selecting_provider", { t: "SELECT_PROVIDER", provider: "spotify" });
  assert.equal(s.state, "connecting");
  assert.ok(s.effects.includes("open-url"));
  s = C.transition(s.state, { t: "HANDOFF_DONE" });
  assert.equal(s.state, "playing_external");
  // Reserved slot degrades to handoff choice, never a fake player.
  s = C.transition("selecting_provider", { t: "SELECT_PROVIDER", provider: "spotify_remote" });
  assert.equal(s.state, "selecting_provider");
  assert.ok(s.effects.includes("note:reserved-fallback"));
  // Background without the explicit pref pauses; with it, keeps state.
  assert.equal(C.transition("playing_embedded", { t: "APP_HIDDEN", background: false }).state, "interrupted");
  assert.equal(C.transition("playing_embedded", { t: "APP_HIDDEN", background: true }).state, "playing_embedded");
  // Unknown events/states never crash the host.
  assert.equal(C.transition("paused", { t: "BOGUS" }).effects[0], "unsupported");
  assert.equal(C.transition("nope", { t: "PLAY" }).state, "error");
});

test("controls: external providers show no play/next/volume/meta", () => {
  const ext = C.visibleControls("spotify", "playing_external");
  assert.equal(ext.openExternal, true);
  assert.equal(ext.disconnect, true);
  assert.equal(ext.play, false);
  assert.equal(ext.pause, false);
  assert.equal(ext.volume, false);
  assert.equal(ext.meta, false);
  assert.equal(ext.queue, false);
  const emb = C.visibleControls("first_party", "playing_embedded");
  assert.equal(emb.pause, true);
  assert.equal(emb.stop, true);
  assert.equal(emb.volume, true);
  assert.equal(emb.meta, true);
  assert.equal(emb.queue, false, "first-party has no queue");
  assert.equal(C.visibleControls("first_party", "idle").play, false, "nothing to play from idle");
  assert.deepEqual(C.unsupported("spotify", "next"), { ok: false, error: "unsupported:spotify:next" });
});
