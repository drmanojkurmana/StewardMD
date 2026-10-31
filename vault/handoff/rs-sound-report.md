# rs-sound report — PrepNucleus Sound Phases 0-2 + provider chooser (2026-10-31)

Branch `prep-reels-sound`. Plan [PrepNucleus-Sound.md](../plans/PrepNucleus-Sound.md),
Phase 0 note [PrepSound-architecture-note.md](../plans/PrepSound-architecture-note.md).
No Spotify approval request sent or drafted (owner §14.6). No paid calls, no network in tests.

## What was built

- **Phase 0** — `vault/plans/PrepSound-architecture-note.md`: Capacitor/CSP/audio-lifecycle
  audit, provider approval matrix, verified-link table, asset-rights plan, Apple Music
  spike (doc only, result OPEN), native-service gap listed as OPEN.
- **Phase 3 prerequisite (committed first, `0dbaefa3e`)** — `prep-sound-providers.js`:
  `PREP_SOUND_PROVIDERS` registry with shape validation; adapter contract per plan §4.2;
  generic external-handoff adapters (transport ops → typed `unsupported`, never faked);
  `spotify_remote` mount slot for `prep-sound-spotify.js` (rs-spotify) with a plug-in/out test.
- **Core** — `prep-sound-core.js`: `smd_prep_sound` gate (requires `smd_prep`, default OFF),
  §10 preference object (no history field validates), 8-provider capability matrix,
  verified-only handoff builders (unverified → `unavailable:*`), 4-track original
  ambient/white-noise catalogue + rights gate, pure state machine (idle → … → playing_embedded/
  playing_external/paused/interrupted/error; HUSH never auto-resumes).
- **Phase 2** — `prep-sound-web.js`: in-browser WebAudio synthesis (looped noise buffers,
  pad oscillators, periodic LFOs; peak gains capped, validator enforced), Media Session
  metadata/handlers for our own audio only, gesture-initiated start, pause on hidden tab
  unless background pref. No audio files, no downloads, works offline.
- **Phase 1** — `prep-sound.js` + `prep-sound.css` (`.pn-sound-*`): home Sound section,
  body-level persistent dock (root is repainted, so it lives outside), provider chooser
  sheet, 4 focus-preset cards, prefs (pause-before-video, background), share-link/search
  boxes, stop/disconnect. External rows always labelled "Opens the app · PrepNucleus
  cannot control it". Coordination API for parallel jobs: `pauseForVideo()`,
  `hushForTts()`, `isPlaying()`.

## Shared-file hooks (all guarded; no-ops when flag off / files absent)

- `prep-loader.js`: comment + `prep-sound.css` in CSS; `prep-sound-core/providers/web/sound.js`
  in JS + OPTIONAL (404-safe). Coexists with rs-spotify's + rs-reels' entries (disjoint lines).
- `prep.js` (4 one-liners): `back()` closes Sound sheet; `close()` calls `leave()`;
  home renders `homeHtml()`; `s-` acts dispatch to `PREP_SOUND.act` **excluding `sp-`**
  (rs-spotify's prefix runs later — order coupling, both jobs note it).
- Both files' hook lines landed in HEAD via rs-spotify's commit `6ec75bf0c` (it staged
  the shared files while my lines were in the working tree). Content is mine, attribution
  is theirs — stated here so the history stays honest.
- `vault/Flags.md`: `smd_prep_sound` OFF row (mine) + `smd_prep_medigram` row (rs-reels);
  both landed in HEAD via rs-reels' commit `893ef0631` — same shared-file situation as above.
- `index.html`/CSP untouched (none needed — synthesis is local, handoff is `window.open`).

## Tests run + results

- `test/prep-sound-core.test.mjs`, `test/prep-sound-providers.test.mjs`,
  `test/prep-sound-web.test.mjs`, `test/prep-sound.test.mjs` — **20/20 pass**
  (`node --test`), incl. flag-gate, prefs migration, matrix, verified/unverified links,
  rights gate, state machine, control visibility, synth validator, HTML builders,
  CSS contract (palette/44px/focus/reduced-motion/no-glow), flag-off regression on the
  shared files (loader lists, OPTIONAL, guarded hooks, `s-`≠`sp-`).
- Throwaway stub-DOM probe (`/tmp/probe-sound.cjs`, not committed): ON mounts, opt-in,
  no-AudioContext degrades to error state without throwing, `back`/`leave`/`hush` safe;
  OFF leaves `PREP_SOUND` undefined and renders nothing.
- Neighbours green: `prep-action-row` 10/10, `prep-pearl` + `prep-play` 12/12.

## Compliance pass (Vercel web-interface-guidelines, fetched fresh 2026-10-31)

Checked: icon buttons labelled; inputs labelled/typed (`url`, `inputmode`, `name`,
`autocomplete=off`); buttons-not-divs (scrim converted to labelled `<button>`);
`role=status/region/dialog`, h2/h3 order; focus-visible everywhere, focus into dialog,
focus return on close; transform-only sheet animation, explicit transition props,
reduced-motion disables; contrast approx 15/12/8/7:1 for ink/body/accent/muted on
`#0D1D23` (calculated, not measured); 44px targets asserted in tests; fixed dark card
in both themes (why-chip precedent); fluid to 390px with scroll chips + ellipsis;
no `...`, no `transition:all`, no autoFocus (dialog focus is justified).

## Accessibility pass (accessibility skill, WCAG 2.2 AA lens)

Name/Role/Value native (`button`, `label`-wrapped inputs, `aria-pressed` toggles with text
names, labelled icon buttons); targets 44px (exceeds SC 2.5.8 24px); focus-visible on every
control; dialog focus-in on open + focus return on close; `role=status` live regions;
contrast ≈15/12/8/7:1 (calculated). Gap found and fixed: the sheet lives outside prep.js
root, so root Escape/back never fired there and focus was uncontained — the dock now owns
`keydown`: Escape closes the sheet, Tab wraps inside it (stub-DOM probe verified Escape +
no-throw; full Tab-wrap with live focusables needs a real browser — OPEN below).

## UI skills

Owner-listed paths (under `/Users/diwakarkumar/…`) do not exist on this machine —
stated, not skipped: ui-ux-pro-max, brand, design-system, ui-styling, anti-ui-slop,
impeccable, emil-design-eng, pick-ui-library. Used local equivalents instead:
anti-ui-slop (contract: extend `prep.css`/`pn-sheet`/`pn-btn` language, real states,
no new system), impeccable + emil-design-eng (press states, ease-out ≤280ms, hover
gated, reduced motion), web-design-guidelines (pass above). No new UI library
(pick-ui-library rule: repo is buildless vanilla — kept).

## OPEN (need humans/devices/legal — not faked)

Real-device audio + background/ headset/ call-interruption tests; Android Media3
background service + notification controls (no suitable Capacitor plugin installed —
web path built); Spotify written approval + `smd_prep_sound_spotify` enablement
(rs-spotify owns the module; dev-mode allowlist only); Apple Music Android SDK +
commercial validation (spike §5); 30-learner pilot; store review of background audio;
visual screenshot check + screen-reader pass + live Tab-wrap with real focusables (headless here — code-checked only);
mock-test undisturbed + no-mix with PrepReels verified by design (independent nodes,
`hush` pauses, no timer calls) but not yet exercised against rs-reels' player.
