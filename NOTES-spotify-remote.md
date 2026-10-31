# Spotify App Remote (native) — lead notes

Built on branch `spotify-remote`. The lead builds and device-tests; nothing here was compiled
with Xcode or run on a device in this job.

## What changed

New local Capacitor plugin `local-plugins/capacitor-spotify-remote` (JS name `SpotifyRemote`),
modelled on `local-plugins/capacitor-capture-guard`:

- `Package.swift`, `package.json`
- `ios/Sources/SpotifyRemotePlugin/SpotifyRemotePlugin.swift` — SPTAppRemote bridge:
  `isAvailable`, `connect({accessToken})`, `disconnect`, `getState`, `play({uri, positionMs?})`,
  `resume`, `pause`, `next`, `previous`, `seek({positionMs})`, `setShuffle({on})`,
  `setRepeat({mode})`, `wake({uri})`; events `playerState` (getState shape) and `connection`.
  Client ID `9545526c500040058279facbdcdba9ee`, redirect `stewardmd://spotify-callback`.
  The App Remote auth return URL is consumed from Capacitor's `.capacitorOpenURL` notification;
  a URL carrying a PKCE `code` is ignored by the plugin and left to `prep-sound-spotify.js`.
  Disconnects on background, reconnects on foreground if a token was given. Token stays in
  memory in the plugin; nothing is logged.
- `android/` — stub plugin + `build.gradle` + empty manifest. Every method resolves
  `{available:false}`-shaped results; Android keeps the Web API path.

Wiring:

- `package.json` — added `"@stewardmd/capacitor-spotify-remote": "file:local-plugins/capacitor-spotify-remote"`.
- `ios/App/CapApp-SPM/Package.swift` — added the package (canonical `../../../local-plugins/...`
  path) and its product.
- `ios/App/App/Info.plist` — added `LSApplicationQueriesSchemes` with `spotify` (no entries
  existed before; nothing was removed).

Player (`prep-sound-spotify.js`):

- `app-remote-control` added to `SCOPES`. Sessions granted before this lack it: the card shows
  a plain note under `data-sp-scope-note` asking for one Disconnect + Connect; nothing is
  force-reconnected, and playback keeps working through the Web API meanwhile.
- When `Capacitor.Plugins.SpotifyRemote` exists and is connected, transport
  (toggle/play/pause/next/previous/seek/shuffle/repeat, playlist/track picks) and Now Playing
  come from the plugin; `playerState` events update the card and the mini. Playlists, search,
  queue and like stay on the Web API. Volume also stays on the Web API (App Remote has none).
- If connect fails (Spotify installed but not running), the sheet shows one line
  (`data-sp-wake-note`) plus a **Wake Spotify** button (`data-act="sp-wake"`). `wake()` is called
  only from that tap — grep confirms exactly one `.wake(` call site.
- Diagnostics (long-press **Music**) gain `remote:` lines (connect, state, connection).
- Web, Android and older builds without the plugin run the previous Web API path unchanged.

Version bump: `prep116` → `prep117` in `prep-loader.js`, `index.html`
(`prep-loader.js?v=prep117`), `test/run-prep-play-ui.mjs`, `test/run-prep-tools-ui.mjs`.

Shared files touched (smallest hooks): `package.json`, `ios/App/CapApp-SPM/Package.swift`,
`ios/App/App/Info.plist`, `index.html`, `prep-loader.js`. Everything else is new files plus
`prep-sound-spotify.js` and its test. `sound.js` was not touched.

## Spotify iOS SDK version / pin

- Upstream: `https://github.com/spotify/ios-sdk`, pinned **exact `5.0.1`** (tag `v5.0.1`,
  2025-08-13) in the plugin's `Package.swift`.
- Verified 2026-11-01 via the GitHub API: tag `v5.0.1` ships a `Package.swift` declaring
  `.binaryTarget(name: "SpotifyiOS", path: "SpotifyiOS.xcframework")` with product
  `SpotifyiOS`; the xcframework has `ios-arm64` and `ios-arm64_x86_64-simulator` slices and an
  iOS 12 floor (below the app's iOS 17 target, so no deployment-target change).
- Therefore **no vendoring and no fetch script**: nothing binary is committed. The plugin
  depends on the upstream SPM package directly. Only re-pin after re-checking the new tag's
  `Package.swift`, `CHANGELOG.md` and headers.

## Lead must do

1. Xcode: `npm install` (updates `package-lock.json` — deliberately not run in this job because
   this worktree's `node_modules` is a symlink into another checkout), then
   `npm run sync` / `npx cap sync ios` and build. Check these compile points in
   `SpotifyRemotePlugin.swift` (written from the v5.0.1 headers, not compile-verified):
   `SPTAppRemoteConnectionParamsImageFormat.JPEG`, `SPTAppRemoteLogLevel.error`,
   `authorizationParameters(from:)`, `fetchImage(for:with:callback:)`, `seek(toPosition:callback:)`.
2. developer.spotify.com, app for client ID `9545526c500040058279facbdcdba9ee`: confirm bundle
   ID `in.stewardmd.app` is listed on the app and redirect URI `stewardmd://spotify-callback`
   is registered. Existing users will be asked to reconnect once for `app-remote-control`.
3. Do NOT send any Spotify approval request from this work (owner rule). The mini-player stays
   on allowlisted accounts until the owner says otherwise.
4. Device-test: connect while Spotify plays; kill Spotify and use **Wake Spotify**; pause and
   wait >30 s (iOS suspends Spotify) and confirm the Wake path; background/foreground reconnect;
   confirm the PKCE `?code=` sign-in still completes with the plugin installed.

## Risks not verified

- Swift was only syntax-parsed (`swiftc -parse`, clean). No Xcode build, no device run, no
  Gradle build of the Android stub (same shape as `capacitor-capture-guard`, which builds).
- `swift package dump-package` fails in this sandbox for BOTH the new plugin manifest and the
  untouched `CapApp-SPM` (local CommandLineTools SDK/compiler mismatch), so manifest validity
  rests on matching the existing plugins' structure, not on SPM evaluation.
- App Remote connect-failure timing: the plugin rejects after Spotify's failure delegate or a
  12 s timeout; real timing/behaviour when Spotify is installed-but-never-opened needs a device.
- Artwork: the card's artwork picker only accepts `https:` URLs, so the plugin's
  `imageDataUrl` shows through the mini/card only where a matching Web API `images[]` entry is
  merged in for the same track; otherwise the existing music-note placeholder shows.
- The Spotify return after **Wake Spotify** depends on Spotify honouring the
  `stewardmd://spotify-callback` redirect with an `access_token` parameter; unverified on device.

## Tests

- `node --test test/prep-sound-spotify.test.mjs` — 28 pass.
- `node --test test/prep-sound*.test.mjs test/prep-app.test.mjs` — 118 pass, 0 fail.

Open items needing humans/devices: clinical review n/a for this job; real-device audio tests;
Spotify dashboard check (above); pilot with learners n/a. Nothing was faked.
