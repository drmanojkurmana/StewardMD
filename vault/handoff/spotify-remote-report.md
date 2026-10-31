# spotify-remote — report

Native Spotify App Remote (SPTAppRemote) for the PrepNucleus music player on iOS, per the
2026-11-01 owner decision (option 1). The Web API "devices" route stays for web/Android and as
fallback. Full lead notes: [NOTES-spotify-remote.md](/Volumes/WD BLACK SN7100 1TB Media/wt-player-design/NOTES-spotify-remote.md).

## What was built

- New plugin [capacitor-spotify-remote](/Volumes/WD BLACK SN7100 1TB Media/wt-player-design/local-plugins/capacitor-spotify-remote) (SPM, modelled on capacitor-capture-guard).
  iOS Swift bridge exposes `SpotifyRemote`: isAvailable/connect/disconnect/getState/play/
  resume/pause/next/previous/seek/setShuffle/setRepeat/wake, `playerState` + `connection`
  events, background disconnect / foreground reconnect, App Remote auth URL consumed via
  Capacitor's open-URL notification (PKCE `code` URLs left to JS), token in memory only.
  Spotify iOS SDK pinned exact **5.0.1** via SPM (upstream tag ships a `SpotifyiOS`
  binaryTarget — verified; no vendored binary, no fetch script). Android stub resolves
  `{available:false}` for every call.
- [prep-sound-spotify.js](/Volumes/WD BLACK SN7100 1TB Media/wt-player-design/prep-sound-spotify.js): `app-remote-control` scope added (plain
  reconnect note when an older grant lacks it); connected plugin drives transport + Now
  Playing (events replace the `/me/player` poll); playlists/search/queue/like/volume stay on
  the Web API; failed connect shows **Wake Spotify**, called only from that tap; diagnostics
  gain `remote:` lines. No existing feature removed.
- Loader bumped prep116 → prep117 with all pins.

## Files

New: `local-plugins/capacitor-spotify-remote/{Package.swift, package.json,
ios/Sources/SpotifyRemotePlugin/SpotifyRemotePlugin.swift, android/build.gradle,
android/src/main/AndroidManifest.xml,
android/src/main/java/in/stewardmd/spotifyremote/SpotifyRemotePlugin.java}`,
`NOTES-spotify-remote.md`, this report.
Changed: `prep-sound-spotify.js`, `test/prep-sound-spotify.test.mjs`.

Hooks into shared files (smallest possible): `package.json` (one dependency line),
`ios/App/CapApp-SPM/Package.swift` (package + product lines), `ios/App/App/Info.plist`
(`LSApplicationQueriesSchemes`: `spotify`; nothing existed there before), `index.html`
(loader `?v=prep117`), `prep-loader.js` (`V = "prep117"`), `test/run-prep-play-ui.mjs` and
`test/run-prep-tools-ui.mjs` (pin strings). `sound.js` untouched. With the plugin absent the
app behaves as before (plugin detection is guarded; Web API path unchanged).

## Tests run

- `node --test test/prep-sound-spotify.test.mjs` — 28 pass (new mocked-plugin tests: connected
  transport hits the plugin with zero fetch calls; not-running connect shows Wake and never
  calls wake until the tap; no plugin = Web API path unchanged; scope gate; state→model merge).
- `node --test test/prep-sound*.test.mjs test/prep-app.test.mjs` — **118 pass, 0 fail**.
- `swiftc -parse` on the Swift plugin — clean. `plutil -lint` Info.plist — OK.

## Compliance pass (UI)

Only new visible UI: the Wake line + button and the scope note in the existing Spotify sheet.
Checked: reuses `.pn-btn.pri` (min-height 50px, ≥44px target) and `.pn-sound-sp-note` tokens
(fixed palette #071318/#0D1D23/#42CDB5, no glows/gradients/backdrops added); focus-visible
styles already cover sheet buttons; no new animation (reduced-motion safe); fluid sheet width
at 390px; light/dark inherit existing `--pn-*` tokens. Standing UI skill files 1–4 at the
owner's `diwakarkumar` paths do not exist on this machine (reported, not skipped silently);
anti-ui-slop, impeccable and emil-design-eng were read and followed. `pick-ui-library` not
applicable (no new UI library). No screenshot verification: the sheet needs a signed-in native
build, which only the lead can produce.

## Not verified / OPEN

- No Xcode or Gradle build (per brief). Swift written from the v5.0.1 headers; compile-check
  enum case spellings listed in [NOTES-spotify-remote.md](/Volumes/WD BLACK SN7100 1TB Media/wt-player-design/NOTES-spotify-remote.md). `swift package dump-package`
  fails in this sandbox for the untouched CapApp-SPM too (toolchain mismatch), so manifests
  were matched to existing plugins by structure.
- Lead: `npm install` (lockfile deliberately untouched — this worktree's `node_modules` is a
  symlink into another checkout), `npx cap sync`, build, device-test (connect, Wake after iOS
  suspends Spotify, background/foreground, PKCE return with plugin present).
- Lead: confirm bundle ID `in.stewardmd.app` and redirect `stewardmd://spotify-callback` on the
  Spotify dashboard app. Do not send any Spotify approval request (owner rule).
- Risks: connect-failure timing on device; Wake return token hand-off; `imageDataUrl` artwork
  only merges where the same track has Web API artwork (documented in NOTES).
