# rs-player-ui report — one provider-agnostic "Now Playing" card (2026-10-31)

Branch `prep-reels-sound-2`, worktree `wt-prep-reels-sound`. Flags unchanged:
`smd_prep_sound` (OFF) + `smd_prep_sound_spotify` (OFF); with them off no
Sound file loads and PrepNucleus is behaviour-identical.

## What was built

- [prep-sound-player.js](../../prep-sound-player.js) (new): the neutral model
  `{ provider, providerLabel, title, artist, album, artworkUrl, durationMs,
  positionMs, isPlaying, shuffle, repeat, liked, volume }`, caps
  `{ play, pause, next, previous, seek, shuffle, repeat, like, volume,
  artwork }`, and `window.PREP_SOUND_PLAYER.render(model, caps)` — one
  centred-artwork card after the owner's reference (square artwork, title +
  artist, seek with elapsed/total, shuffle | previous | big play/pause |
  next | repeat, heart top-right, volume, "on \<provider\>"). A false cap
  removes the control from the HTML (never a dead button); the single
  documented exception is the save heart without the scope (disabled +
  "Reconnect Spotify to save songs", never a forced reconnect). Empty state
  is "Nothing playing" + the provider's pick action. Pure helpers
  (`interpolatePosition`, `shouldPoll`, `createPoller`) tick progress locally
  every second and re-sync ~every 5 s only while the card is visible;
  hidden/closed/backgrounded stops polling. Ambience models use a calm
  generated SVG tile per preset (original drawing, no stock images).
- [prep-sound-player.css](../../prep-sound-player.css) (new): `.pn-player-*`,
  fixed palette #071318 / #0D1D23 / #42CDB5, no glows/gradients/backdrops,
  44px+ targets (64px play), visible focus, reduced-motion safe, fluid at
  390px. The card carries its own dark ink, so contrast is AA in the app's
  light and dark themes (checked: #E2F1EE and #94B4AB on #0D1D23, dark ink
  on the accent button).
- Spotify adapter ([prep-sound-spotify.js](../../prep-sound-spotify.js)):
  `parseNowPlaying` maps GET /me/player (2026 `shuffle_state`,
  `repeat_state`, `device.volume_percent`, ~300px artwork pick); liked via
  `/me/library/contains` with `/me/tracks/contains` fallback, both response
  shapes parsed (`[true]` and `[{contains}]`); controls for shuffle, repeat,
  seek, volume, save/remove (tracks endpoint, library fallback on 404).
  `user-library-modify` added to SCOPES; the token store now records the
  granted scope and the heart disables honestly without it. `bodyOf()`'s
  empty 200/204 handling untouched. The sheet mounts the shared card in
  place of the old now-playing line + 3 buttons (old markup remains as the
  no-card fallback).
- Sound Dock ([prep-sound.js](../../prep-sound.js)): the sheet leads with the
  same card for ambience (play/pause + volume only, generated tile) and the
  honest external card for Gaana/JioSaavn/Amazon/YouTube Music ("Playing in
  <app> — PrepNucleus can't see or control it on iPhone", one Open button,
  no fake controls; iPhone wording only on iOS).
- [PrepSound-apple-music.md](../plans/PrepSound-apple-music.md) (new, doc
  only): why MusicKit needs a server-signed developer token and the exact
  owner steps (MusicKit capability, .p8 key, Key/Team IDs). No Apple code.

## Hooks into shared files

- [prep-loader.js](../../prep-loader.js): `prep-sound-player.js` +
  `prep-sound-player.css` added to the lazy Sound lists and `OPTIONAL`
  only. Nothing else. `prep.js`, `index.html`, CSP untouched.

## Tests run + results

- `node --test` on the player, Spotify, Sound, core, providers and web
  suites: **55 pass, 0 fail** (17 new player tests: 2026 model mapping,
  liked shapes, caps hiding, scope-disabled heart, interpolation, poller
  stop-on-hide, external honesty, client URL/fallback contract, CSS
  contract).
- [run-prep-medigram-ui.mjs](../../test/run-prep-medigram-ui.mjs) extended
  with the ambience card (card present, play shows pause, elapsed + volume
  present, pause stops ambience) after the existing 1500ms/390px settle
  check. **Not run here** (no Chrome in the sandbox) — the lead runs it.

## Not verified / OPEN

- Chrome harness run (lead), real Spotify account end-to-end (allowlisted
  test account), real-device checks.
- Spotify approval for commercial use: not sent (per owner decision).
- Apple Music: owner developer-account steps + legal review (see plan doc).
- Ambience card elapsed is render-time (loops have no track length); the
  live 1s tick + 5s re-sync runs on the mounted Spotify card.
- UI skill files under `/Users/diwakarkumar/.claude/...` do not exist on
  this machine; direction was taken from the job brief, the owner palette,
  anti-ui-slop / impeccable / emil-design-eng (loaded), and the compliance
  pass above (44px, focus, reduced motion, AA light+dark, 390px).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
