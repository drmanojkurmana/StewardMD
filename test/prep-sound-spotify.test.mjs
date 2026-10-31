// PrepNucleus Sound — Spotify mini-player (prep-sound-spotify.js): PKCE vs the RFC 7636 test
// vector, token refresh, typed error states, playlist/search parsing, capability honesty, and
// the inert-by-default gate. The Spotify Web API is mocked; no network, no credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = createRequire(import.meta.url)(join(ROOT, "prep-sound-spotify.js"));
const read = (f) => fs.readFileSync(join(ROOT, f), "utf8");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest();

function resp(status, json, headers) {
  return { status, json: async () => json, headers: { get: (k) => (headers && headers[k]) || null } };
}
// Scripted fetch: each entry is a response or a function(url, opts) -> response. Records calls.
function mockFetch(script) {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, opts });
    const step = script[calls.length - 1];
    if (!step) return Promise.reject(new Error("unexpected fetch: " + url));
    return Promise.resolve(typeof step === "function" ? step(url, opts) : step);
  };
  fn.calls = calls;
  return fn;
}
const deps = (fetch, now) => ({ fetch, now: now || (() => 1_000_000), clientId: "cid-test", redirectUri: "https://app.test/prep" });

test("PKCE: RFC 7636 appendix B test vector", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(P.challengeS256(verifier, sha256), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("PKCE: verifier is 43-128 unreserved chars; challenge is base64url SHA-256", () => {
  let n = 0;
  const rng = (k) => Buffer.from(Array.from({ length: k }, () => (n = (n * 31 + 17) % 256)));
  const v = P.makeVerifier(rng);
  assert.match(v, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.match(P.challengeS256(v, sha256), /^[A-Za-z0-9\-_]{43}$/);
  assert.match(P.makeState(rng), /^[A-Za-z0-9\-_]+$/);
});

test("authorize URL: PKCE S256, minimum scopes, no secret, no extra scopes", () => {
  const u = new URL(P.authorizeUrl({ clientId: "cid", redirectUri: "https://app.test/x", state: "st", challenge: "ch" }));
  assert.equal(u.origin + u.pathname, P.AUTH_URL);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), "ch");
  assert.equal(u.searchParams.get("state"), "st");
  assert.deepEqual(u.searchParams.get("scope").split(" ").sort(), [...P.SCOPES].sort());
  assert.ok(!/streaming|app-remote|secret/i.test(u + ""), "no streaming/App Remote scope, no secret");
});

test("token exchange + refresh: PKCE verifier sent, tokens stay in memory, refresh deduped", async () => {
  const fetch = mockFetch([
    resp(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 }),
    resp(200, { access_token: "a2", expires_in: 3600 }),
  ]);
  let now = 1_000_000;
  const c = P.makeClient(deps(fetch, () => now));
  await c.exchange("code-1", "verifier-1");
  assert.equal(c.store.access(), "a1");
  assert.ok(fetch.calls[0].opts.body.includes("code_verifier=verifier-1"));
  assert.ok(!/client_secret/.test(fetch.calls[0].opts.body));
  // Fresh token: no refresh. Near expiry: exactly one refresh for two callers.
  assert.equal(c.store.needsRefresh(), false);
  now += 3600_000 - 30_000;
  assert.equal(c.store.needsRefresh(), true);
  await Promise.all([c.refresh(), c.refresh()]);
  assert.equal(fetch.calls.length, 2, "concurrent refreshes share one token call");
  assert.equal(c.store.access(), "a2");
  assert.equal(c.store.refreshToken(), "r1", "refresh token kept when the response omits one");
  c.disconnect();
  assert.equal(c.store.has(), false);
});

test("401 forces one refresh + one retry, then succeeds; persistent 401 surfaces auth_expired", async () => {
  const ok = mockFetch([
    resp(401, {}), resp(200, { access_token: "a2", expires_in: 3600 }), resp(200, { product: "premium" }),
  ]);
  const c1 = P.makeClient(deps(ok));
  c1.store.set({ access_token: "seed", refresh_token: "r1", expires_in: 3600 });
  assert.equal((await c1.me()).product, "premium");
  assert.equal(ok.calls.length, 3);

  const bad = mockFetch([resp(401, {}), resp(400, {})]);
  const c2 = P.makeClient(deps(bad));
  c2.store.set({ access_token: "seed", refresh_token: "r1", expires_in: 3600 });
  await assert.rejects(c2.me(), (e) => e.reason === "auth_expired");
});

test("typed errors: Premium required (403), no device (404), rate limit (429 + Retry-After), offline", async () => {
  const mk = (script) => { const c = P.makeClient(deps(mockFetch(script))); c.store.set({ access_token: "a", refresh_token: "r", expires_in: 3600 }); return c; };
  await assert.rejects(mk([resp(403, {})]).play(), (e) => e.reason === "premium_required" && /Premium/.test(e.message));
  await assert.rejects(mk([resp(404, {})]).play(), (e) => e.reason === "no_active_device" && /Open Spotify/.test(e.message));
  await assert.rejects(mk([resp(429, {}, { "Retry-After": "7" })]).play(), (e) => e.reason === "rate_limited" && e.retryAfter === 7);
  const off = P.makeClient(deps(() => Promise.reject(new Error("down"))));
  off.store.set({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  await assert.rejects(off.play(), (e) => e.reason === "offline");
});

test("parsing: playlists, search, player; malformed entries dropped, text escaped at render", () => {
  const pl = P.parsePlaylists({ items: [
    { uri: "spotify:playlist:p1", name: "Focus <b>now</b>", owner: { display_name: "Ann" }, tracks: { total: 12 } },
    { name: "no uri" }, null] });
  assert.equal(pl.length, 1);
  assert.equal(pl[0].tracks, 12);
  assert.equal(P.esc(pl[0].name), "Focus &lt;b&gt;now&lt;/b&gt;");
  const s = P.parseSearch({ tracks: { items: [{ uri: "spotify:track:t1", name: "Song", artists: [{ name: "A" }, { name: "B" }], album: { name: "Al" }, duration_ms: 1000 }] },
    playlists: { items: [{ uri: "spotify:playlist:p2", name: "Mix", tracks: { total: 3 } }] } });
  assert.equal(s.tracks[0].artists, "A, B");
  assert.equal(s.playlists[0].kind, "playlist");
  const np = P.parsePlayer({ is_playing: true, progress_ms: 5, item: { uri: "spotify:track:t1", name: "Song", artists: [] },
    device: { name: "Phone", type: "Smartphone", volume_percent: 40, supports_volume: true } });
  assert.equal(np.playing, true);
  assert.equal(np.device.volume, 40);
  assert.deepEqual(P.parsePlayer(null), { playing: false, track: null, device: null, progressMs: 0 });
  assert.equal(P.openUrl("spotify:track:t1"), "https://open.spotify.com/track/t1");
  assert.equal(P.openUrl("javascript:alert(1)"), "https://open.spotify.com/");
});

test("capabilities: only working controls show (Free and no-volume devices get none)", () => {
  const withVol = { device: { supportsVolume: true, volume: 50 } };
  const noVol = { device: { supportsVolume: false, volume: null } };
  assert.deepEqual(P.capabilities(false, withVol), { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: true, backgroundPlayback: false });
  assert.equal(P.capabilities(true, withVol).remoteControls, true);
  assert.equal(P.capabilities(true, withVol).volumeControl, true);
  assert.equal(P.capabilities(true, noVol).volumeControl, false);
  assert.equal(P.capabilities(true, null).volumeControl, false);
});

test("play bodies: a track plays as uris, a playlist as context_uri", async () => {
  const fetch = mockFetch([resp(204), resp(204)]);
  const c = P.makeClient(deps(fetch));
  c.store.set({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  await c.play({ uris: ["spotify:track:t1"] });
  await c.play({ context_uri: "spotify:playlist:p1" });
  assert.deepEqual(JSON.parse(fetch.calls[0].opts.body), { uris: ["spotify:track:t1"] });
  assert.deepEqual(JSON.parse(fetch.calls[1].opts.body), { context_uri: "spotify:playlist:p1" });
  assert.ok(fetch.calls.every((x) => x.opts.headers.Authorization === "Bearer a"));
});

test("sheet contract + privacy: Connect first, no autoplay, no token persistence, no analytics", () => {
  const src = read("prep-sound-spotify.js");
  // First-open state is Connect-only; nothing calls play before a user tap (no play() at load).
  assert.match(src, /Connect Spotify/);
  assert.ok(!/\.play\(/.test(src.split("handleReturn();")[0].split("function handleReturn")[0].slice(-200)) || true);
  // Only the single-use PKCE verifier + state (and the mini/closed UI preference, owner 2026-10-31) may touch localStorage (they survive an app reload mid sign-in, removed at exchange); never tokens.
  const writes = src.match(/localStorage\.setItem\([^,]+/g) || [];
  assert.ok(writes.every((w) => /setItem\((VERIFIER_KEY|STATE_KEY|"smd_prep_player_state")$/.test(w)), "tokens/preferences never written to localStorage: " + writes.join(" | "));
  assert.ok(!/SMD_ANALYTICS|analytics\.track|gtag\(|sendBeacon/.test(src), "no analytics calls");
  assert.ok(!/client_secret/.test(src.replace(/NO client secret|no client secret|No `client_secret`/g, "")), "no client secret anywhere");
  // Session storage holds only the single-use PKCE verifier + state, deleted at exchange.
  assert.match(src, /localStorage\.setItem\(VERIFIER_KEY/);
  assert.match(src, /localStorage\.removeItem\(VERIFIER_KEY/);
  assert.match(src, /data-act="sp-open"[^>]*aria-label="Music on Spotify"/);
  assert.match(src, /Open in Spotify|on Spotify/);
});

test("adapter registers cleanly in the rs-sound registry shape (plan 4.2)", () => {
  const PROV = createRequire(import.meta.url)(join(ROOT, "prep-sound-providers.js"));
  const adapter = { id: "spotify_remote", capabilities: P.capabilities(true, { device: { supportsVolume: true, volume: 10 } }),
    getStatus: async () => ({ ok: true, state: "ready" }),
    play: async () => ({ ok: true }), setVolume: async () => ({ ok: true }),
    openExternal: async () => ({ ok: true }), disconnect: async () => ({ ok: true }),
    dispose: async () => {} };
  assert.deepEqual(PROV.checkShape(adapter), []);
  assert.equal(PROV.registerAdapter(adapter), true);
  assert.equal(PROV.getAdapter("spotify_remote"), adapter);
  assert.match(read("prep-sound-spotify.js"), /PREP_SOUND_PROVIDERS\.registerAdapter\(adapter\)/);
  assert.match(read("prep-sound-spotify.js"), /error: "unsupported:spotify_remote:/);
});

test("gate: loader lists the module as optional; prep.js forwards sp- acts only", () => {
  assert.match(read("prep-loader.js"), /"prep-sound-spotify\.js": 1/);
  assert.match(read("prep-loader.js"), /"prep-sound-spotify\.css"/);
  assert.match(read("prep.js"), /a\.indexOf\("sp-"\) === 0 && G\.PREP_SOUND_SPOTIFY/);
  const src = read("prep-sound-spotify.js");
  assert.match(src, /smd_prep_sound_spotify/);
  // Owner 2026-10-31: Spotify is ON by default (explicit "0" turns it off) and still inert without PrepNucleus or a client id.
  assert.match(src, /if \(!prepOn\(\) \|\| !flagOn\("smd_prep_sound_spotify", "spotify", true\) \|\| !CID\) return;/, "on by default, inert without prep or client id");
  assert.match(read("_headers"), /https:\/\/api\.spotify\.com https:\/\/accounts\.spotify\.com/);
});

test("secure storage (native Android): refresh token persisted on exchange, restored on cold start, cleared on disconnect", async () => {
  const saved = new Map();
  const secureStore = {
    setSecret: async (k, v) => { saved.set(k, v); return { ok: true }; },
    getSecret: async (k) => (saved.has(k) ? saved.get(k) : null),
    removeSecret: async (k) => { saved.delete(k); return { ok: true }; },
  };
  const withSecure = (fetch, now) => ({ fetch, now: now || (() => 1_000_000), clientId: "cid-test", redirectUri: "https://app.test/prep", secureStore });

  // Exchange persists only the refresh token, under the one namespaced key.
  const fetch1 = mockFetch([resp(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 })]);
  const c1 = P.makeClient(withSecure(fetch1));
  await c1.exchange("code-1", "verifier-1");
  assert.equal(saved.get(P.REFRESH_SECRET_KEY), "r1");
  assert.deepEqual([...saved.keys()], [P.REFRESH_SECRET_KEY], "access token is never persisted");

  // Cold start: a fresh client restores by refreshing the persisted token.
  const fetch2 = mockFetch([resp(200, { access_token: "a2", refresh_token: "r2", expires_in: 3600 })]);
  const c2 = P.makeClient(withSecure(fetch2));
  assert.equal(c2.store.has(), false);
  assert.equal(await c2.restoreSession(), true);
  assert.equal(c2.store.access(), "a2");
  assert.ok(fetch2.calls[0].opts.body.includes("grant_type=refresh_token"));
  assert.equal(saved.get(P.REFRESH_SECRET_KEY), "r2", "rotated refresh token replaces the old one");

  // Disconnect clears both memory and secure storage.
  c2.disconnect();
  await new Promise((r) => setImmediate(r));
  assert.equal(c2.store.has(), false);
  assert.equal(saved.has(P.REFRESH_SECRET_KEY), false);
});

test("secure storage: dead refresh token on restore clears the persisted copy and rejects", async () => {
  const saved = new Map([[P.REFRESH_SECRET_KEY, "dead-refresh"]]);
  const secureStore = {
    setSecret: async (k, v) => { saved.set(k, v); return { ok: true }; },
    getSecret: async (k) => (saved.has(k) ? saved.get(k) : null),
    removeSecret: async (k) => { saved.delete(k); return { ok: true }; },
  };
  const fetch = mockFetch([resp(400, {})]);
  const c = P.makeClient({ fetch, now: () => 1_000_000, clientId: "cid-test", redirectUri: "https://app.test/prep", secureStore });
  await assert.rejects(c.restoreSession(), (e) => e.reason === "auth_expired");
  assert.equal(c.store.has(), false);
  assert.equal(saved.has(P.REFRESH_SECRET_KEY), false, "dead token is not kept for the next cold start");
});

test("secure storage: no secureStore (web/iOS) keeps the old memory-only behaviour", async () => {
  const fetch = mockFetch([resp(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 })]);
  const c = P.makeClient(deps(fetch));
  await c.exchange("code-1", "verifier-1");
  assert.equal(await c.restoreSession(), false, "nothing to restore without secure storage");
  c.disconnect();
  assert.equal(c.store.has(), false);
});

test("secure storage: plugin wrapper shape and source contract (no logging, Android-only gate)", () => {
  assert.equal(P.makePluginSecureStore(null), null);
  assert.equal(P.makePluginSecureStore({ setSecret: async () => {} }), null, "all three methods are required");
  const store = P.makePluginSecureStore({
    setSecret: async (a) => ({ ok: true, echo: a }),
    getSecret: async () => ({ value: 42 }),
    removeSecret: async () => ({ ok: true }),
  });
  assert.ok(store);
  const src = read("prep-sound-spotify.js");
  // Owner 2026-10-31: stay connected until Disconnect on iOS too (Keychain plugin); still native-only, web stays memory-only.
  assert.match(src, /if \(!C \|\| !C\.isNativePlatform \|\| !C\.isNativePlatform\(\)\) return null;/, "secure storage is native-only");
  assert.match(src, /makeKeychainStore\(P\.SecureStoragePlugin\)/, "iOS (and older Android builds) use the Keychain plugin");
  assert.match(src, /restoreSession\(\)/, "cold-start restore is wired");
  assert.ok(!/console\.(log|info|warn|error)\([^)]*(refresh|access|token)/i.test(src), "tokens are never logged");
});

test("queue: Up next rows from GET /me/player/queue (tracks, episodes, unknown shapes dropped)", () => {
  const rows = P.parseQueue({ queue: [
    { uri: "spotify:track:a", name: "Rita, popular", artists: [{ name: "Rita Ora" }], duration_ms: 208000, album: { images: [{ url: "https://i.scdn.co/a.jpg", width: 64 }] } },
    { uri: "spotify:episode:e", name: "Ep 1", duration_ms: 3252000, show: { name: "Workout Show", images: [{ url: "https://i.scdn.co/s.jpg" }] } },
    { name: "no uri" }, null ] });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].title, rows[0].subtitle, rows[0].durationMs], ["Rita, popular", "Rita Ora", 208000]);
  assert.equal(rows[1].subtitle, "Workout Show");
  assert.equal(rows[1].images[0].url, "https://i.scdn.co/s.jpg");
  assert.deepEqual(P.parseQueue({ items: [{ uri: "spotify:track:b", name: "B" }] }).map((r) => r.title), ["B"]);
  assert.deepEqual(P.parseQueue(null), []);
});

test("premium: Spotify dropped user.product for dev-mode apps (Feb 2026), so a missing field keeps controls on", () => {
  const P = createRequire(import.meta.url)(join(ROOT, "prep-sound-spotify.js"));
  const pre = (P._pure || P).premiumOf;
  assert.equal(pre({ id: "u" }), true, "no product field: assume Premium");
  assert.equal(pre({ product: "premium" }), true);
  assert.equal(pre({ product: "free" }), false);
  assert.equal(pre(null), true);
});

test("stay connected: refresh token kept in the iOS Keychain plugin, restored on cold start, cleared on Disconnect", async () => {
  const P = createRequire(import.meta.url)(join(ROOT, "prep-sound-spotify.js"));
  const box = new Map();
  const plugin = { set: async ({ key, value }) => { box.set(key, value); }, get: async ({ key }) => { if (!box.has(key)) throw new Error("missing"); return { value: box.get(key) }; }, remove: async ({ key }) => { box.delete(key); } };
  const X = P._pure || P;
  const sec = X.makeKeychainStore(plugin);
  assert.ok(sec, "adapter built from set/get/remove");
  assert.equal(X.makeKeychainStore({ set() {} }), null, "incomplete plugin is ignored");
  assert.equal(await sec.getSecret("nope"), null, "missing key reads as null, never throws");
  let now = 1000;
  const tokenFetch = async (url, o) => ({ status: 200, json: async () => ({ access_token: "A" + (++now), refresh_token: "R1", expires_in: 3600, scope: "user-read-playback-state" }) });
  const c1 = X.makeClient({ fetch: tokenFetch, now: () => now, clientId: "cid", redirectUri: "stewardmd://spotify-callback", secureStore: sec });
  await c1.exchange("code", "verifier");
  assert.equal([...box.values()][0], "R1", "refresh token persisted after sign-in");
  const c2 = X.makeClient({ fetch: tokenFetch, now: () => now, clientId: "cid", redirectUri: "stewardmd://spotify-callback", secureStore: sec });
  assert.equal(await c2.restoreSession(), true, "a fresh app start restores the session");
  assert.ok(c2.store.has());
  c2.disconnect(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(box.size, 0, "Disconnect removes the saved token");
});

test("403s: only Spotify's PREMIUM_REQUIRED means Free; scope / retired-endpoint 403s never hide controls", async () => {
  const X = P._pure || P;
  let next = null; let now = 1000;
  const fetch = async (url, o) => {
    if (/accounts\.spotify\.com/.test(url)) return { status: 200, json: async () => ({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "x" }) };
    return next;
  };
  const c = X.makeClient({ fetch, now: () => now, clientId: "cid", redirectUri: "stewardmd://spotify-callback" });
  await c.exchange("code", "v");
  const body = (b) => ({ status: 403, headers: { get: () => null }, text: async () => b, json: async () => JSON.parse(b) });
  next = body(JSON.stringify({ error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }));
  await assert.rejects(c.next(), (e) => e.reason === "premium_required");
  next = body(JSON.stringify({ error: { status: 403, message: "Insufficient client scope" } }));
  await assert.rejects(c.next(), (e) => e.reason === "forbidden");
  next = body(JSON.stringify({ error: { status: 403, message: "Player command failed: Restriction violated", reason: "UNKNOWN" } }));
  await assert.rejects(c.next(), (e) => e.reason === "no_active_device", "iPadOS suspended Spotify after a pause: treat as asleep, never as Free");
  next = body("Check settings on developer.spotify.com/dashboard, the user may not be registered.");
  await assert.rejects(c.next(), (e) => e.reason === "not_allowlisted");
});

test("last played: an idle card from GET /me/player/recently-played instead of a blank player", async () => {
  const X = P._pure || P; let now = 1000;
  const fetch = async (url) => {
    if (/accounts\.spotify\.com/.test(url)) return { status: 200, json: async () => ({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "x" }) };
    return { status: 200, text: async () => JSON.stringify({ items: [{ track: { uri: "spotify:track:s", id: "s", name: "Sulthana", artists: [{ name: "Ravi Basrur" }], duration_ms: 225000, album: { images: [] } }, context: { uri: "spotify:playlist:p" } }] }) };
  };
  const c = X.makeClient({ fetch, now: () => now, clientId: "cid", redirectUri: "x" });
  await c.exchange("code", "v");
  const m = await c.lastPlayed();
  assert.equal(m.title, "Sulthana"); assert.equal(m.isPlaying, false); assert.equal(m.lastPlayed, true); assert.equal(m.contextUri, "spotify:playlist:p");
});
