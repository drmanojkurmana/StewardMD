# RadioAnatome

Educational cross-sectional anatomy atlas. Scroll a stack of labelled slices, tap a
structure, read its definition. Interaction modelled on e-Anatomy (IMAIOS); content
built only from licence-cleared sources.

- **Entry points:** Home tile `atlas` · sidebar row `RadioAnatome` · `stewardmd://atlas` · `ATLAS.open(moduleId?)`
- **Files:** `atlas.js`, `atlas.css`, `atlas/modules.json`, `atlas/<id>/atlas.json`, `atlas/<id>/NNN.webp`
- **Pipeline:** `atlas-pipeline/` (dev-only, never shipped)
- **Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md`
- **Plans:** `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md` · `…-pipeline.md`
- **Tests:** `test/atlas-layout.test.mjs` · `test/atlas-data.test.mjs`

## Gotchas

- **Display name is RadioAnatome; internal identifiers are `atlas`.** `window.ATLAS`,
  `atlas.js`, `/atlas/` paths, `data-atlas-act`, `.atlas-*` CSS and `#smdAtlas` all keep
  the short name deliberately — renaming them is churn with no user benefit.
- **`close()` must call `SMD_showHome()`.** `open()` calls `SMD_hideHome()`; skipping the
  restore strands the user on a blank page. Same reason Ward Sync does it — see the
  `SMD_showHome` comment in `home.js`.
- **Pin `x`/`y` are percentages of the IMAGE box, not the viewport and not the stage.**
  `overlaySvg` converts them to stage space *before* `layoutGutter`, or every label
  drifts by the letterbox offset and the leader lines fan out diagonally.
- **Duplicate structure ids within one slice are intentional** — that is how bilateral
  structures highlight together. Selection is keyed on structure id.
- **Slice `.webp` files are NOT bundled into the native app** (~2 MB/module). `imgUrl()`
  rewrites `/atlas/*` to `https://stewardmd.in` when `SMD_IS_NATIVE`, mirroring
  `kardiox-screens.js` `kxImg()`. `scripts/build-www.sh` copies only the JSON — it is an
  explicit allowlist, so a new directory silently does not ship.
- **`ICONS.get` returns a truthy EMPTY `<svg>` for an unknown name**, so
  `ico(x) || "fallback"` renders an invisible button. `ico()` consults `has()` first.
- **The local `esc()` escapes quotes** (the house copy in `onco-home.js` does not), and
  `cssUrl()` percent-encodes CSS-breakout characters — a bare `)` closes `url()`
  regardless of HTML escaping.
- **`ResizeObserver` does not fire in headless/CDP panes at all** (verified with a control
  observer). A `window.resize` listener runs alongside it so the repaint path is
  verifiable in CI.
- **No attribution, licence or source string may be rendered** except the curated
  `modules.json.credits` lines on the info screen. `provenance` in each `atlas.json` is an
  audit trail only — it contains internal tooling paths.
- **The selected label's white pill is `paint-order: stroke`**, not a second element.
