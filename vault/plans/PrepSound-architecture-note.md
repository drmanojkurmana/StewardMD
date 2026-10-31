# PrepSound Architecture Note (Phase 0) — rs-sound, 2026-10-31

Branch `prep-reels-sound`. Plan: [PrepNucleus-Sound.md](./PrepNucleus-Sound.md).
`graphify-out/graph.json` does not exist in this worktree, so per the graphify
skill fast-path rule (graph missing → build would be a full-pipeline run, out of
scope for this job) this audit was done by direct inspection. Reuse targets from
the job brief were all confirmed in-tree.

## 1. What was audited

| Area | Finding |
|---|---|
| Android wrapper | Capacitor 8.4.3 (`capacitor.config.json`, `android/` present, appId `in.stewardmd.app`, `webDir www`, schemes https). |
| Capacitor plugins (package.json) | Audio-adjacent: `@capacitor-community/text-to-speech` (TTS), `@capacitor/haptics`, local Whisper STT plugin. **No background-audio / media-session / music-control plugin installed** (no `background-mode`, `music-controls`, Media3 bridge). |
| CSP (`index.html:17`) | `object-src 'none'; base-uri 'self'; upgrade-insecure-requests`. No `script-src`/`media-src`/`connect-src` limits → WebAudio synthesis + Media Session need **zero CSP changes**. External handoff uses `window.open`, unaffected by CSP. |
| Existing audio/TTS | `sound.js` (SMD_SOUND UI blips, OFF by default, WebAudio oscillators, gesture-unlock pattern — reused); `clinix-audio.js` (synthesised teaching sounds, labelled synthetic, licence-free — the precedent for procedural audio); `voice-ambient.js` (orchestrator, owns no engine); `prep-lessons.js:356` narration (Capacitor TextToSpeech native else `speechSynthesis`, `hush()`/stop-on-leave — reused pattern); `prep-play.js:383` voice/TTS + focus minutes (`fxm`, independent of Sound presets — no shared state). |
| Lifecycle | `prep.js` `close()` calls `leave()` per module; `back()` chain; `visibilitychange`/`freeze`/`resume` → `onAway` (pauses clocks). Sound follows the same three hooks. Mock-test clock code (`prep.js:2436+`, `prep-assess.js`) is untouched; Sound never calls into it. |
| Host + forwarding | `PREP._host` (`prep.js:4501`) exposes push/rerender/back/paint/nav/esc/toast/store/etc. Click delegation on root forwards by prefix: `v-`→PLAY, `l-`→LESSONS, `n-`→NAV, `t2-`→TESTS, `x-`→TOOLS, `tt-`→TT, `n360-`→NUCLEUS360 (`prep.js:4225-4230,4441`). Sound takes **`s-` → `G.PREP_SOUND.act`**. |
| Loader | `prep-loader.js`: `CSS`/`JS` arrays + `OPTIONAL` map, `?v=prep100` token. Sound adds `prep-sound.css` + `prep-sound-core.js`, `prep-sound-providers.js`, `prep-sound-web.js`, `prep-sound.js` as OPTIONAL (flag OFF → files never load → behaviour-identical). |
| Styles | `prep.css` tokens (`--pn-*`, `body.dark` palette, `pn-sheet`/`pn-btn`/`pn-chip`, 44px `.pn-ib`, `button:focus-visible`, reduced-motion block). Fixed owner palette already tokenised as `--pn-why-*` (`#071318/#0D1D23/#42CDB5`). Sound CSS reuses all of it; no new library. |
| Flags | `vault/Flags.md`; convention `smd_<area>` + `?sound=0` kill path. New: `smd_prep_sound` (requires `smd_prep`, default OFF). `smd_prep_sound_spotify` is **reserved for job rs-spotify** — not created here. |
| Tests | `test/prep-*.test.mjs`, `node --test`, no network/DOM/paid calls. Pure helpers exported via `module.exports` under `NODE` guard (prep-play.js pattern). |

## 2. Provider approval matrix (checked 2026-10-31 against plan §3, §8/8.1, §14 + owner 2026-10-31)

| Provider | Embedded | Handoff / remote | Status for this job |
|---|---|---|---|
| first_party (own synthesis) | Yes — the only provider-independent path | n/a | **Build now** (ambient/white-noise only, §14.3) |
| spotify | No (needs written approval, §8) | App/web link now; mini-player later | Handoff only here. `spotify_remote` adapter slot **reserved** for rs-spotify (`prep-sound-spotify.js`); **no approval request is sent** (owner §14.6) |
| youtube_music | No SDK | Link handoff | Handoff only |
| amazon_music | Closed beta, no public SDK | Link handoff | Handoff only |
| jiosaavn | No verified SDK | Link handoff | Handoff only |
| gaana | No verified SDK | Link handoff | Handoff only |
| apple_music | MusicKit candidate, unvalidated | Link handoff | Handoff now; embedded conditional on spike below (**OPEN**) |

No Spotify audio in PrepReels, no mixing/syncing, no listening-history collection — enforced by design (no history store exists; §10 preference object only).

## 3. Verified deep-link formats (never guessed)

Open only these shapes; everything else is reported `unavailable`, never fabricated:

- Spotify home `https://open.spotify.com/` ✔; share `open.spotify.com/{album,playlist,track,episode}/{id}` ✔ **for user-supplied IDs only**.
- YouTube Music home `https://music.youtube.com/` ✔; watch `music.youtube.com/watch?v={id}` ✔ for user-supplied IDs; `/search?q=` **unverified → unavailable** (fallback: official `https://www.youtube.com/results?search_query=` or home).
- Amazon Music home `https://music.amazon.com/` ✔; search/deep formats **unverified → unavailable**.
- JioSaavn home `https://www.jiosaavn.com/` ✔; `/search/` patterns **unverified → unavailable**.
- Gaana home `https://gaana.com/` ✔; deep patterns **unverified → unavailable**.
- Apple Music home `https://music.apple.com/` ✔; catalog URLs need storefront+ID, opened as-is only when user-supplied.
- Banned: `spotify:` URIs, `intent://` with assumed packages, `amzn://`/`saavn://` schemes, scraped endpoints, unofficial wrappers.

## 4. Asset-rights plan (Phase 2)

- Tracks are **generated in-browser** (WebAudio noise/ambient synthesis, seamless loops) — no files, no downloads, no copyrighted audio, no paid services, works offline.
- Manifest (`prep-sound-web.js` TRACKS): every entry `licence="original"`, `expiry=null` (n/a), `kind ∈ {ambient, white-noise}`; `checkManifest()` fails CI on any other kind/licence.
- Offline caching of streams: **deferred** until licences allow (owner §14.5) — nothing cached.
- No user-uploaded copyrighted files; no music extracted from videos.

## 5. Apple Music spike (doc only — no code, per job brief)

1. Register Apple developer identifiers + MusicKit capability; server-side developer-token generation (never ship the signing key in-client).
2. Verify MusicKit Web playback in target browsers; verify the **current official Android SDK** on target Android versions + Capacitor interop (do not assume web≡Android).
3. Verify subscription entitlement, India catalogue availability, background behaviour, attribution, monetisation/app-store terms.
4. Confirm Sound Dock can carry required metadata/artwork.
5. If SDK or terms fail → Apple Music stays external-handoff. No unofficial wrappers in production.
6. **Result: OPEN** (needs Apple developer account + legal review — humans).

## 6. Native gaps → OPEN (web path built, no new plugins added)

- Android background service / Media3 media session + notification controls: **OPEN** (no suitable plugin installed; adding one needs a real-device + store-review pass).
- Audio-focus loss, calls/alarms, headset/Bluetooth routes, process recreation: handled on web via `visibilitychange`/Media Session; native behaviour **OPEN** pending the service above.
- Real-device audio tests, store rights n/a (original audio), 30-learner pilot, Telugu/Hindi reviewers n/a (no speech content — ambience needs no captions).

## 7. Files this job adds (shared-file hooks kept minimal)

New: `prep-sound-core.js` (prefs/state-machine/capabilities/links/presets),
`prep-sound-providers.js` (**the Phase-3 adapter interface** — committed first),
`prep-sound-web.js` (synth player + Media Session), `prep-sound.js` (Dock UI),
`prep-sound.css` (`.pn-sound-*`), 4 test files, this note, `vault/handoff/rs-sound-report.md`.
Shared touches: `prep-loader.js` (CSS/JS/OPTIONAL entries + comment), `prep.js`
(4 guarded one-liners: `back`, `leave`, home section, `s-` dispatch),
`vault/Flags.md` (one flag row). `index.html`/CSP untouched.
