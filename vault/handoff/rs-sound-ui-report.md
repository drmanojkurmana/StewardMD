# rs-sound-ui report — Sound section UI fixes + lazy loading (2026-10-31)

Job: fix the Sound section UI bugs seen in headless-Chrome screenshots at 390px, make s-open reach the first-party player, lazy-load Sound files. Branch `prep-reels-sound-2`.

## Root causes found (all in owned files)

1. **Unreadable button/chip text (bug 1):** `prep.css` has `.pn-root button { color: inherit }` (specificity 0-1-1), which beats the unscoped `.pn-sound-btn` / `.pn-sound-chip` (0-1-0). Inside the themed home the controls inherited body ink — dark-navy text on the dark fill in the light theme. Fix: the home section now uses the app's own themed classes (`pn-btn pri` for Enable Sound, `pn-btn` for Providers and settings, `pn-chip` for preset chips), which render correctly in both themes by construction. `presetChips()` takes an optional 3rd class arg (default `pn-sound-chip` for the body-level dark sheet, where `pn-chip` has no rules). The home Turn-off link keeps `pn-sound-link` but is now root-scoped (`.pn-root .pn-sound-home .pn-sound-link`, specificity 0-3-0) with `color: var(--pn-pri)` — Prussian on white / amber on navy, AA in both.
2. **No inner padding (bug 2):** `.pn-group` carries no padding (sibling rows pad themselves). Added `.pn-root .pn-sound-home { padding: 16px }`, 14px at ≤420px — mirrors `.pn-mg-card` / `.pn-plan`.
3. **Chips clipped (bug 3):** `.pn-sound-chips` was `overflow-x: auto` with no wrap. Now `flex-wrap: wrap` + `max-width: 100%`, like `.pn-mg-missions`.
4. **s-open showed nothing playable (bug 4), three causes:**
   - (a) `.pn-sound-layer` was `z-index: 40`, hidden behind the PrepNucleus overlay (`.pn-root` is 885). Now 890 (above root 885 and ghost 886, far below the image viewer).
   - (b) After s-enable the machine sat in `idle`, where `visibleControls` exposes no Play and `PLAY` is rejected as `unsupported` — the sheet could never start audio. s-enable now runs `ENABLE` + `SELECT_PROVIDER(first_party)` through the machine, landing on `ready` (still silent until a tap; PLAY is the only path to sound). Boot with prefs already enabled also starts at `ready`.
   - (c) The sheet had no Turn off. Added `s-disable` ("Turn off") next to "Stop and disconnect".
5. **Lazy loading (bug 5):** Sound files were in the always-load CSS/JS lists. Removed from base lists; added `SOUND_CSS`/`SOUND_JS` + `soundOn()` (requires `enabled()`, honours `?sound=1/0` and `localStorage smd_prep_sound==="1"`) and `SPOTIFY_CSS`/`SPOTIFY_JS` + `spotifyOn()` (needs `soundOn()` AND `?spotify=1` or `smd_prep_sound_spotify==="1"`), same pattern as `MG_CSS`/`MG_JS` + `mgOn()`. `applyFlagLink` untouched. V bumped to `prep102`.

## Files changed (all owned by this job)

- `prep-sound.js` — themed home controls, `presetChips` class param, sheet Turn off, s-enable/boot land on `ready`.
- `prep-sound.css` — layer z-index 890, chips wrap, home padding 16/14px, root-scoped home link.
- `prep-loader.js` — lazy SOUND/SPOTIFY lists, `soundOn()`/`spotifyOn()`, V `prep102`.
- `index.html` — ONE line: `prep-loader.js?v=prep101` → `prep102` (allowed edit).
- `test/prep-sound.test.mjs` — new assertions: home uses `pn-btn pri`/`pn-chip`, sheet has Play + Turn off, CSS z-index/wrap/padding, loader lazy gating + V pin.
- `test/run-prep-medigram-ui.mjs` — flags-off: no `prep-sound*` request, no Sound section; `?sound=1`: `prep-sound.js` fetched, no spotify fetch, s-enable → s-open shows Play, Play → `isPlaying()` + live WebAudio track, 1500ms settle then `#smdPrep` overflow check.
- `test/run-prep-play-ui.mjs`, `test/run-prep-tools-ui.mjs` — V pin `prep101` → `prep102`.

Shared-file hooks: only the two `prep-loader.js` list/gate lines and the one `index.html` pin. `prep.js` untouched (its `s-` dispatch, `back()` sheet-first, and `leave()` hooks already guard on `G.PREP_SOUND`).

## Tests run + results

- `node --check` on all 5 edited JS/harness files: PASS.
- `node --test test/prep-sound.test.mjs test/prep-medigram.test.mjs`: 21/21 PASS.
- `node --test` on core/providers/web/spotify suites: 26/26 PASS.
- Machine-path probe (node, core only): `idle → ENABLE → selecting_provider → SELECT_PROVIDER(first_party) → ready → PLAY → playing_embedded` with `start-embedded` effect, and `visibleControls("first_party","ready").play === true`: PASS.
- Chrome harnesses (`run-prep-*-ui.mjs`): NOT run — sandbox blocks localhost/Chrome here. Written carefully for the lead to run; the new sound block asserts fetch gating, Play control visibility, `isPlaying()` + `PREP_SOUND_WEB.current()`, and post-settle overflow.

## Compliance pass (static; no browser available)

- Contrast: home controls now inherit app-token contrast (amber-fill primary ~10:1 both themes; chips ink-on-card; link `var(--pn-pri)` both themes); sheet/dock keep `#E2F1EE`/`#CDE2DC` on `#0D1D23` (test-asserted).
- Targets: `pn-btn` 50px, `pn-chip` 44px, `pn-sound-link`/`dbtn`/`toggle` 44px min.
- Focus: app `:focus-visible` covers home `pn-btn`/`pn-chip`; sheet keeps teal outline rules.
- Motion: no new animation; sheet enter still disabled under `prefers-reduced-motion`; press states use the existing 120ms curves.
- 390px: chips wrap, card padding steps to 14px, homerow wraps, dock/sheet are fluid full-width within 12px margins.
- Palette: no glow/gradient/backdrop added (test-asserted); dark dock/sheet keep `#071318`/`#0D1D23`/`#42CDB5`.

## UI skills status

- `bundled:taste` (preflight), `anti-ui-slop`, `impeccable`, `emil-design-eng`: read and followed (Operate-mode refinement: incumbent classes/tokens, no new visual system, bounded pass).
- Standing-rules paths under `/Users/diwakarkumar/...` (ui-ux-pro-max, brand, design-system, ui-styling, pick-ui-library file): **unavailable on this machine** — did not skip silently; equivalent coverage came from reading `prep.css` / `prep-medigram.css` tokens directly. No new UI library chosen, so `pick-ui-library` was not needed.
- `graphify-out/graph.json`: does not exist in this worktree; reused existing code by direct reading instead.

## OPEN (need humans/devices/legal — not faked)

1. Lead must run the three Chrome harnesses (`run-prep-medigram-ui`, `run-prep-play-ui`, `run-prep-tools-ui`) — I could not execute them here.
2. Real-device check: 390px screenshots in light + dark, VoiceOver/TalkBack pass over the new sheet, reduced-motion on device.
3. Clinical/content review, Telugu/Hindi reviewers, pilot, store rights, Spotify approval: untouched by this job (no Spotify request drafted or sent; no listening history collected; first-party audio is synth-only WebAudio).
4. Note: uncommitted changes from parallel workers exist in this worktree (`prep-sound-core.js`, `prep-sound-web.js`, `prep-sound-spotify.js`, `package.json`, etc.). This commit stages **only** the 8 files + this report listed above.
