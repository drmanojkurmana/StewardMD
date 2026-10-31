# rs-spotify report — Spotify mini-player (flag `smd_prep_sound_spotify`, OFF)

## What was built

- [prep-sound-spotify.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-sound-spotify.js) — self-contained ES5 module, `window.PREP_SOUND_SPOTIFY`. Round music button (44px+, `aria-label="Music on Spotify"`) opens a compact sheet over the study screen. First open shows only "Connect Spotify"; music never starts without a tap. After sign-in: now-playing, play/pause, next/previous, volume only when the active device reports `supports_volume`, the learner's own playlists, and track+playlist search. Choosing a track/playlist starts it on the learner's Spotify (`uris` / `context_uri`) and the sheet closes. One-tap Disconnect. Free accounts see playlists/search as "Open in Spotify" links with a plain Premium explanation and no dead controls. Typed errors: Premium required (403), no active device (404), sign-in expired (401, after one refresh+retry), rate limited (429, honours `Retry-After`), offline. Exposes the Sound plan 4.2 adapter shape (`id "spotify_remote"`, capabilities/getStatus/play/pause/stop→pause/next/previous/openExternal/disconnect/dispose) for the future Sound Dock; until rs-sound lands it mounts its own button in the PrepNucleus root.
- [prep-sound-spotify.css](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-sound-spotify.css) — `.pn-sound-sp-*` only, existing `--pn-*` / `--pn-why-*` tokens (`#071318/#0D1D23/#42CDB5`), no glow/gradient/blur, ≥44px targets, visible `:focus-visible`, `prefers-reduced-motion`, safe-area aware. Reuses the shared `.pn-sheet`/`.pn-scrim`/`.pn-grab` language; Spotify is named ("on Spotify", "Open in Spotify") but never skinned in Spotify green.
- [vault/plans/PrepSound-spotify-spike.md](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/vault/plans/PrepSound-spotify-spike.md) — playback-path decision: **Web API player endpoints on every platform** (controls the learner's active Spotify app; works in PWA + Capacitor webview with no native SDK). Web Playback SDK and Android App Remote rejected for v1 with reasons. Degradation path (approval refused → deep-link handoff) documented.
- [test/prep-sound-spotify.test.mjs](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/test/prep-sound-spotify.test.mjs) — 11 node tests, Spotify Web API fully mocked, no network/credentials.

## Auth (per the security checklist)

Authorization Code + PKCE, S256, `state` verified on return, verifier single-use. **No client secret anywhere** (test-asserted). Minimum scopes only: `user-read-private`, `user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`. Access+refresh tokens live **in memory only** (60s-early, deduped refresh); the PKCE verifier+state sit in `sessionStorage` only for the redirect round-trip and are deleted at exchange. Nothing is written to `localStorage`, analytics, or the AI Tutor; no listening history is collected. Client id from `window.SMD_SPOTIFY_CLIENT_ID` / `window.SMD_CONFIG.spotifyClientId`, empty by default — with no client id (or any of `smd_prep`/`smd_prep_sound`/`smd_prep_sound_spotify` off) the module returns early, `PREP_SOUND_SPOTIFY` stays undefined, and no button renders.

## Hooks into shared files (smallest possible)

| File | Change |
|---|---|
| [prep-loader.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-loader.js:35) | `prep-sound-spotify.css` appended to CSS; `prep-sound-spotify.js` appended to JS and to OPTIONAL (404-safe) |
| [prep.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep.js:4453) | Two lines in `act()`: `sp-` acts forward to `PREP_SOUND_SPOTIFY.act(a, b, HOST)` |
| [_headers](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/_headers:18) | `https://api.spotify.com https://accounts.spotify.com` added to the Report-Only `connect-src` |

rs-sound landed during this job (`0dbaefa3e`, `prep-sound-providers.js` registry). The adapter was aligned to its exact checked shape — live `capabilities` object, `getStatus() -> {ok, state}`, `{ok:false, error:"unsupported:spotify_remote:…"}` results, `setVolume(0..1)`, `openExternal({url})` — and registers via `PREP_SOUND_PROVIDERS.registerAdapter(adapter)` when the registry is present (guarded; harmless when absent). The module otherwise stays self-contained.

## Tests run + results

- `node --test test/prep-sound-spotify.test.mjs` — **12 pass, 0 fail**: RFC 7636 PKCE test vector; verifier/challenge shape; authorize URL (minimum scopes, no secret); token exchange + deduped refresh; 401 refresh+retry and persistent-401; 403/404/429/offline typed errors; playlist/search/player parsing + escaping; capability honesty (Free / no-volume); play bodies; rs-sound registry shape (`checkShape` + `registerAdapter`); privacy/source contract (no `localStorage`, no analytics, no secret); loader/flag wiring.
- `node --test test/prep-sound.test.mjs test/prep-sound-web.test.mjs` (rs-sound's suites) — **8 pass, 0 fail** with this module present.
- `node --check prep-sound-spotify.js` — syntax OK.
- Neighbour suite `test/prep-ids.test.mjs`: 12 pass, 1 fail — the live-cache count test (1514 lessons on this machine vs its 1700 floor). Data-dependent, pre-existing, unrelated to this change; not modified.
- Compliance pass (code-level, web-design-guidelines style): ≥44px targets ✓; focus-visible ✓; reduced-motion ✓; contrast — sheet ink `#E2F1EE`/muted `#94B4AB` on `#0D1D23` ✓; 390px — sheet is fluid `max-width:720px`, lists truncate with ellipsis ✓; light+dark — the sheet uses the dark-green `--pn-why-*` surface in both themes, matching the existing PrepNucleus "why" cards ✓. Not rendered on a real device (see OPEN).
- UI skills: ui-ux-pro-max, brand, design-system (plugin), ui-styling, anti-ui-slop, impeccable, emil-design-eng, pick-ui-library (not needed — no new library), and the security-review checklist were read before editing. The job text's `/Users/diwakarkumar/...` skill paths resolve to the same plugin cache under this machine's home; nothing was skipped silently.

## OPEN (needs humans / owner / devices — not faked)

1. **End-to-end on a real allowlisted account is NOT done.** Owner must supply: a Spotify developer app (client id) with the redirect URI registered, and allowlisted test accounts (Spotify development mode). Then set `window.SMD_SPOTIFY_CLIENT_ID`, turn on `smd_prep_sound` + `smd_prep_sound_spotify`, and verify Connect → playlists → search → play → sheet-closes on web and in the Android app.
2. **Spotify commercial approval: NOT requested** (per owner decision — build/verify first). Until written approval exists this stays development-mode/allowlist only; refusal degrades to the deep-link handoff already rendered for Free accounts.
3. **Android secure token storage: OPEN.** No encrypted-storage Capacitor plugin is installed (`@capacitor/preferences` is plain storage and was not used for tokens). Tokens are memory-only on Android until the owner approves adding a secure-storage plugin.
4. **Real-device checks not done:** sheet at 390px on a phone, Spotify app present/absent, no-device and Free-account states against the live API, background/foreground behaviour.
5. CSP is Report-Only today; if it is ever enforced, the two Spotify hosts added here must be kept in `connect-src`.
