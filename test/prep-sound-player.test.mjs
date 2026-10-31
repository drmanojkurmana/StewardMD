/* PrepNucleus Sound — Now Playing card (prep-sound-player.js, job rs-player-ui):
   provider-neutral model, capability-driven rendering (no dead buttons),
   progress interpolation, poll gating, Spotify 2026 mapping, ambience and
   honest external cards. Pure logic only: no network, no DOM, no paid calls.
   node --test test/prep-sound-player.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PL = require("../prep-sound-player.js");
const SP = require("../prep-sound-spotify.js");
const CSS = fs.readFileSync(path.join(ROOT, "prep-sound-player.css"), "utf8");

const FULL = { play: true, pause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true, like: true, volume: true, artwork: true };
const TRACK = { provider: "spotify", providerLabel: "Spotify", title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue",
  artworkUrl: "https://i.scdn.co/image/abc", durationMs: 327000, positionMs: 61000, isPlaying: true,
  shuffle: true, repeat: "context", liked: true, likeAvailable: true, volume: 40 };

test("model: normalisation clamps volume, validates repeat, drops non-https artwork", () => {
  const m = PL.normalizeModel({ title: "X", repeat: "loop", volume: 240, artworkUrl: "http://insecure/img", durationMs: -5 });
  assert.equal(m.repeat, "off");
  assert.equal(m.volume, 100);
  assert.equal(m.artworkUrl, null);
  assert.equal(m.durationMs, 0);
  assert.equal(PL.normalizeModel({ liked: "yes" }).liked, null, "unknown liked stays null, never guessed");
  assert.equal(PL.formatMs(327000), "5:27");
  assert.equal(PL.formatMs(61000), "1:01");
  assert.equal(PL.formatMs(0), "0:00");
});

test("artwork: pickArtwork chooses the image closest to 300px, https only", () => {
  const imgs = [{ url: "https://i/64", width: 64 }, { url: "https://i/640", width: 640 }, { url: "https://i/300", width: 300 }];
  assert.equal(PL.pickArtwork(imgs), "https://i/300");
  assert.equal(PL.pickArtwork([{ url: "http://i/300", width: 300 }]), null);
  assert.equal(PL.pickArtwork(null), null);
});

test("spotify mapping: GET /me/player 2026 shape fills the neutral model", () => {
  const m = SP.parseNowPlaying({ is_playing: true, progress_ms: 61000, shuffle_state: true, repeat_state: "track",
    device: { name: "Phone", volume_percent: 40, supports_volume: true },
    item: { id: "t1", uri: "spotify:track:t1", name: "Blue in Green", duration_ms: 327000,
      artists: [{ name: "Miles Davis" }], album: { name: "Kind of Blue", images: [{ url: "https://i/300", width: 300 }] } } }, false);
  assert.equal(m.title, "Blue in Green");
  assert.equal(m.artist, "Miles Davis");
  assert.equal(m.durationMs, 327000);
  assert.equal(m.positionMs, 61000);
  assert.equal(m.isPlaying, true);
  assert.equal(m.shuffle, true);
  assert.equal(m.repeat, "track");
  assert.equal(m.volume, 40);
  assert.equal(m.liked, false);
  assert.equal(m.trackId, "t1");
  assert.equal(PL.pickArtwork(m.images), "https://i/300");
  const empty = SP.parseNowPlaying({ is_playing: false, item: null }, null);
  assert.equal(empty.title, "", "no item maps to the empty state, never a stale track");
});

test("liked parsing: both endpoint generations collapse to one boolean", () => {
  assert.equal(SP.parseLiked([true]), true);
  assert.equal(SP.parseLiked([false]), false);
  assert.equal(SP.parseLiked([{ uri: "spotify:track:t1", contains: true }]), true);
  assert.equal(SP.parseLiked([{ uri: "spotify:track:t1", contains: false }]), false);
  assert.equal(SP.parseLiked([]), null);
  assert.equal(SP.parseLiked(null), null);
});

test("card: full caps render artwork, seek, transport, volume and a filled heart", () => {
  const h = PL.cardHtml(TRACK, FULL);
  assert.match(h, /Blue in Green/);
  assert.match(h, /Miles Davis/);
  assert.match(h, /on Spotify/);
  assert.match(h, /<img[^>]+src="https:\/\/i\.scdn\.co\/image\/abc"/, "centred square artwork");
  assert.match(h, /data-player-seek/, "seek slider present");
  assert.match(h, /1:01/, "elapsed time shown");
  assert.match(h, /5:27/, "total time shown");
  for (const a of ["toggle", "next", "previous", "shuffle", "repeat", "like"]) assert.match(h, new RegExp('data-player-act="' + a + '"'), "control: " + a);
  assert.match(h, /aria-label="Pause"/, "playing state shows Pause");
  assert.match(h, /aria-pressed="true"[^>]*aria-label="Remove/, "liked heart is pressed and filled");
  assert.match(h, /data-player-volume/, "volume slider present");
});

test("caps hiding: a false cap removes the control entirely — no dead buttons", () => {
  const none = PL.cardHtml(TRACK, PL.defaultCaps());
  for (const a of ["toggle", "next", "previous", "shuffle", "repeat", "like"]) assert.doesNotMatch(none, new RegExp('data-player-act="' + a + '"'), "hidden: " + a);
  assert.doesNotMatch(none, /data-player-seek|data-player-volume|<img/, "no seek, volume or artwork without caps");
  assert.match(none, /pn-player-bar/, "progress still reads as a plain bar without the seek cap");
  const amb = PL.cardHtml(PL.ambienceModel({ title: "Deep Focus", presetId: "deep_focus", isPlaying: true, volume01: 0.8 }), PL.ambienceCaps());
  assert.match(amb, /data-player-act="toggle"/, "ambience keeps play/pause");
  assert.match(amb, /data-player-volume/, "ambience keeps volume");
  assert.doesNotMatch(amb, /data-player-seek|data-player-act="next"|data-player-act="like"/, "ambience never shows seek/next/like");
  assert.match(amb, /pn-player-tile--deep_focus/, "ambience artwork is the generated preset tile");
  assert.doesNotMatch(amb, /<img/, "no stock image for ambience");
});

test("empty state: Nothing playing plus the provider pick action, no transport", () => {
  const h = PL.cardHtml({ provider: "spotify", providerLabel: "Spotify", title: "" }, FULL, { pickLabel: "Pick a playlist" });
  assert.match(h, /Nothing playing/);
  assert.match(h, /data-player-act="pick"/);
  assert.match(h, /Pick a playlist/);
  assert.doesNotMatch(h, /data-player-seek|aria-label="Pause"/, "nothing to seek or pause");
});

test("like scope gate: without user-library-modify the heart is disabled with the reconnect note", () => {
  const noScope = PL.cardHtml({ ...TRACK, likeAvailable: false }, FULL);
  assert.match(noScope, /<button[^>]*disabled[^>]*aria-label="Save song unavailable"/, "heart disabled, not hidden, not live");
  assert.match(noScope, /Reconnect Spotify to save songs/);
  assert.doesNotMatch(noScope, /data-player-act="like"/, "a disabled heart fires no action");
  const scoped = PL.cardHtml(TRACK, FULL);
  assert.doesNotMatch(scoped, /Reconnect Spotify/, "granted scope shows no warning");
});

test("spotify caps: Free gets no transport; Premium without a volume device gets no volume", () => {
  const model = SP.parseNowPlaying({ item: { id: "t", uri: "spotify:track:t", name: "S", artists: [], album: { name: "", images: [] }, duration_ms: 1000 },
    device: { volume_percent: null, supports_volume: false } }, null);
  const free = SP.capsForPlayer(false, model, true);
  assert.deepEqual([free.play, free.next, free.seek, free.shuffle, free.volume], [false, false, false, false, false]);
  assert.equal(free.like, true, "saving works on Free");
  const prem = SP.capsForPlayer(true, model, true);
  assert.equal(prem.play, true);
  assert.equal(prem.volume, false, "device reports no usable volume");
});

test("progress: position interpolates while playing, freezes paused, clamps at the end", () => {
  const m = { title: "X", durationMs: 100000, positionMs: 10000, isPlaying: true };
  assert.equal(PL.interpolatePosition(m, 1000, 4000), 13000, "+3s after 3s of play");
  assert.equal(PL.interpolatePosition({ ...m, isPlaying: false }, 1000, 9000), 10000, "paused never drifts");
  assert.equal(PL.interpolatePosition(m, 0, 999999), 100000, "never past the track end");
});

test("polling: shouldPoll stops when hidden, closed or backgrounded", () => {
  assert.equal(PL.shouldPoll({ visible: true, documentHidden: false, hasCard: true }), true);
  assert.equal(PL.shouldPoll({ visible: false, documentHidden: false, hasCard: true }), false, "card hidden");
  assert.equal(PL.shouldPoll({ visible: true, documentHidden: true, hasCard: true }), false, "app backgrounded");
  assert.equal(PL.shouldPoll({ visible: true, documentHidden: false, hasCard: false }), false, "card closed");
});

test("poller: fetches on cycle, and a hidden card stops it permanently", async () => {
  let ticks = null, fetches = 0, active = true;
  const poller = PL.createPoller({ pollMs: 5000,
    setInterval: (fn) => { ticks = fn; return 7; }, clearInterval: () => { ticks = null; },
    isActive: () => active,
    fetch: () => { fetches++; return Promise.resolve({ model: TRACK, caps: FULL }); },
    onData: () => {} });
  poller.start();
  ticks(); assert.equal(fetches, 1, "visible card re-syncs");
  active = false; ticks();
  assert.equal(fetches, 1, "no fetch after hide");
  assert.equal(poller.isStopped(), true, "poller stopped itself");
});

test("external card: honest iOS wording, exactly one Open button, no fake controls", () => {
  const h = PL.externalHtml("gaana", "Gaana", { platform: "ios", openAct: "s-home", openV: "gaana" });
  assert.match(h, /Playing in Gaana/);
  assert.match(h, /can't see or control it on iPhone/);
  assert.match(h, /data-act="s-home"[^>]*data-v="gaana"|data-v="gaana"/, "Open reuses the verified handoff");
  assert.equal((h.match(/<button/g) || []).length, 1, "one button only");
  assert.doesNotMatch(h, /data-player-seek|aria-label="Play"|aria-label="Pause"/, "no fake transport");
  const web = PL.externalHtml("jiosaavn", "JioSaavn", { platform: "other" });
  assert.doesNotMatch(web, /on iPhone/, "iPhone wording only on iOS");
});

test("repeat cycles off -> context -> track -> off", () => {
  assert.equal(PL.nextRepeat("off"), "context");
  assert.equal(PL.nextRepeat("context"), "track");
  assert.equal(PL.nextRepeat("track"), "off");
});

test("spotify client: shuffle/repeat/seek URLs and liked fallback across endpoint generations", async () => {
  const calls = [];
  const resp = (status, json) => ({ status, text: async () => (json == null ? "" : JSON.stringify(json)), json: async () => json, headers: { get: () => null } });
  const fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(url.includes("/me/tracks?") ? resp(404) : resp(204)); };
  const c = SP.makeClient({ fetch, now: () => 1_000_000, clientId: "cid", redirectUri: "https://app.test/x" });
  c.store.set({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "user-library-modify" });
  assert.equal(c.store.hasScope("user-library-modify"), true);
  await c.shuffle(true); await c.repeatMode("track"); await c.seekMs(42000);
  assert.match(calls[0].url, /\/me\/player\/shuffle\?state=true/);
  assert.match(calls[1].url, /\/me\/player\/repeat\?state=track/);
  assert.match(calls[2].url, /\/me\/player\/seek\?position_ms=42000/);
  await c.saveTrack("t1", "spotify:track:t1");
  assert.match(calls[3].url, /\/me\/tracks\?ids=t1/, "save tries the tracks endpoint first");
  assert.match(calls[4].url, /\/me\/library\?uris=spotify%3Atrack%3At1/, "404 falls back to the library endpoint");
  assert.equal(calls[4].opts.method, "PUT");
});

test("css: fixed palette, 44px targets, focus, reduced motion, no glow/gradient/backdrop", () => {
  for (const hex of ["#071318", "#0D1D23", "#42CDB5"]) assert.ok(CSS.includes(hex), "palette " + hex);
  assert.ok(!/linear-gradient|radial-gradient/.test(CSS), "no gradients");
  // Owner 2026-10-31 asked for subtle shadows: offset soft shadows are allowed, zero-offset glows and backdrop blur are not.
  assert.ok(!/backdrop-filter/.test(CSS) && !/box-shadow:\s*0\s+0\s/.test(CSS), "no glows or backdrops");
  assert.match(CSS, /\.pn-player-play \{[^}]*width:\s*64px[^}]*height:\s*64px/, "big play/pause target");
  assert.match(CSS, /\.pn-player-iconbtn \{[^}]*width:\s*44px[^}]*height:\s*44px/, "44px icon targets");
  assert.match(CSS, /focus-visible/, "visible focus");
  assert.match(CSS, /prefers-reduced-motion/, "reduced motion honoured");
  assert.match(CSS, /aspect-ratio:\s*1/, "square artwork like the reference card");
});

test("wiring: loader ships the card lazily; both sheets render it; no Spotify audio in PrepReels", () => {
  const loader = fs.readFileSync(path.join(ROOT, "prep-loader.js"), "utf8");
  assert.match(loader, /"prep-sound-player\.js"/, "player js in the lazy Sound list");
  assert.match(loader, /"prep-sound-player\.css"/, "player css in the lazy Sound list");
  assert.match(loader, /"prep-sound-player\.js": 1/, "player js is OPTIONAL (404-safe)");
  const sp = fs.readFileSync(path.join(ROOT, "prep-sound-spotify.js"), "utf8");
  assert.match(sp, /user-library-modify/, "save scope requested at sign-in");
  assert.match(sp, /data-sp-player/, "Spotify sheet mounts the shared card");
  assert.match(sp, /PREP_SOUND_PLAYER/, "Spotify sheet renders through the card");
  const sound = fs.readFileSync(path.join(ROOT, "prep-sound.js"), "utf8");
  assert.match(sound, /ambienceModel/, "Sound Dock renders the ambience card");
  assert.match(sound, /externalHtml/, "Sound Dock renders the honest external card");
  const reels = fs.existsSync(path.join(ROOT, "prep-medigram.js")) ? fs.readFileSync(path.join(ROOT, "prep-medigram.js"), "utf8") : "";
  assert.doesNotMatch(reels, /PREP_SOUND_PLAYER|spotify/i, "PrepReels never touches Spotify audio");
});
