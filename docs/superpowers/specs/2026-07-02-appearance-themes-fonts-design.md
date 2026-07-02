# Appearance: Theme + Font picker — design

_Date: 2026-07-02 · Area: StewardMD frontend (Display & Accessibility)_

## Goal

Let users choose a **color theme** and a **font** from curated presets, inside the
existing **More → Settings → Display & Accessibility** sheet. The current look
stays the default and must be byte-for-byte unchanged when no preset is picked.
Every offered theme × light/dark × font combination must keep text **readable**
(WCAG AA contrast; legible typefaces).

## Non-goals (YAGNI)

- No free/custom color picker (readability can't be guaranteed).
- No per-element customization, no user font upload.
- No change to medical content, engine, or the existing font-size/density/auto-fit
  controls (they stay; theme/font are added alongside).

## Existing system (what we build on)

- **Palette** = CSS custom properties on `:root` (light) with a `body.dark`
  override block (`index.html`): `--ink, --slate, --slate-soft, --line, --paper,
  --panel, --teal, --teal-soft, --amber, --green(-bg/-line), --yellow(...),
  --orange(...), --red(...), --sans, --mono`.
- **Dark mode** = `body.classList.toggle('dark')`, persisted as
  `localStorage.stewardmd_theme` = `"dark"|"light"`, toggled by the moon icon
  (`SB.toggleTheme`). Unchanged by this feature.
- **Display engine** (`home.js`): `openDisplay()` renders the Display sheet;
  settings persist in `localStorage.smd_display_v1` (`{fontScale, density,
  autoFit}`); `applyD()` applies them on load and on change; `refreshD()` syncs
  the UI controls. We extend this object and these functions.

## Data model

Extend the persisted display-settings object (`smd_display_v1`) with three fields;
all default to the current look:

```
{ fontScale, density, autoFit,          // existing
  theme: "classic",                      // NEW — one of THEME ids
  font:  "plex",                         // NEW — one of FONT ids
  headingStyle: "default" }              // NEW — "default" | "script"
```

`loadD()` must accept objects missing the new fields (old installs) and fall back
to the defaults above. Validation: unknown `theme`/`font`/`headingStyle` values
fall back to the defaults (never leave the app in an unstyled state).

## Themes (7)

Each theme is a **color family** with a full **light** and **dark** palette.
`classic` is the default and applies **no** attribute, so the untouched
`:root` / `body.dark` blocks remain the source of truth for the default look.

| id | Name | Accent direction |
|----|------|------------------|
| `classic` | Classic (default) | current teal — **unchanged** |
| `blue` | Clinical Blue | calm medical blue |
| `ocean` | Blue-Green (Ocean) | bluer teal/cyan |
| `tiranga` | Tiranga | saffron/orange accent + green (Indian flag) |
| `amber` | Warm Amber | amber/terracotta on soft paper |
| `slate` | Slate / Neutral | desaturated grey, minimal |
| `contrast` | High-Contrast | near-black/white, bold, thick borders |

**Application:** set `document.documentElement.setAttribute('data-theme', id)`
(omit/remove the attribute for `classic`). CSS blocks override the palette vars:

```css
html[data-theme="blue"]        { --ink:…; --paper:…; --panel:…; --teal:…; --teal-soft:…; --line:…; … }
html[data-theme="blue"] body.dark,
body.dark[data-theme="blue"]   { --ink:…; --paper:…; … }   /* dark variant */
```

Every non-classic theme must redefine **all** palette vars it changes for **both**
light and dark, so the semantic status colors (`--green/--yellow/--orange/--red`
and their `-bg/-line`) stay meaningful and AA-legible in every theme. `--teal`
is the app's primary/accent var; each theme repoints it to its own accent (name
kept for compatibility). New theme CSS lives in one appended block in
`index.html` (kept adjacent to the existing `:root`/`body.dark` blocks).

## Fonts (7 body + optional heading)

Body font overrides `--sans` (the app's UI/body font var). `--mono` is left alone
(used for code/wordmark). Applied via
`document.documentElement.setAttribute('data-font', id)`:

| id | Name | Stack / source | Load |
|----|------|----------------|------|
| `plex` | IBM Plex Sans (default) | current `--sans` stack | instant (system fallback) |
| `system` | System | `-apple-system, "Segoe UI", Roboto, system-ui, sans-serif` | instant |
| `arial` | Arial | `Arial, Helvetica, "Liberation Sans", sans-serif` | instant |
| `serif` | Serif | `Georgia, "Times New Roman", Times, serif` | instant |
| `atkinson` | Atkinson Hyperlegible | Google Fonts webfont + `sans-serif` fallback | lazy |
| `lexend` | Lexend | Google Fonts webfont + `sans-serif` fallback | lazy |
| `inter` | Inter | webfont (already used by home v2) + `sans-serif` fallback | lazy/instant |

**Offline safety:** webfonts (`atkinson`, `lexend`, `inter`) are lazy-loaded by
injecting a `<link rel="stylesheet">` to the font **only when that font is
selected** (once; guarded by id). Each `data-font` CSS rule includes a
system-`sans-serif` fallback, so if the network is unavailable the text still
renders in a legible fallback — never invisible or broken. Non-webfont options
have zero network cost.

**Heading style (optional):** `headingStyle: "script"` applies a cursive display
font to **headings only** via a `data-head="script"` attribute on `<html>` and a
CSS rule targeting a **fixed, safe selector set** — the sidebar/app wordmark and
section titles (e.g. `.sb-head b`, `.hv-sh-t`, `.smd-modal-logo`, card/section
`h1,h2,h3,h4` within known containers). It must **never** apply to body copy,
list items, table cells, inputs, or any numeric/dose text. The script font is a
lazy-loaded webfont with a `cursive` fallback. Default `headingStyle` leaves all
headings in the chosen body font.

## UI (Display & Accessibility sheet)

Add two sections (and one toggle) to `openDisplay()`'s sheet, below the existing
Font size / Density / Presets / Auto-fit:

1. **Theme** — a grid of 7 swatch chips (each shows the theme's paper + accent as
   a mini preview + name); selected chip highlighted. Tapping applies instantly.
2. **Font** — a list of 7 rows, each rendering its own name **in that font** as a
   live preview; selected row highlighted. Tapping applies instantly.
3. **Headings** — a two-option segment: `Default` / `Script` (with a caption:
   "Decorative — titles only; never doses").

`applyD()` extends to: set/remove `data-theme`, `data-font`, `data-head` on
`<html>`; lazy-load the selected webfont if needed; persist. `refreshD()` extends
to reflect the selected theme/font/heading in the sheet. The existing "Reset to
defaults" resets theme→`classic`, font→`plex`, headingStyle→`default` too.

## Readability guarantee (acceptance criteria)

- For **every** theme, in **both** light and dark, these pairs meet **WCAG AA**:
  body text (`--ink` on `--paper` and on `--panel`) ≥ **4.5:1**; secondary text
  (`--slate`, `--slate-soft` on `--paper`/`--panel`) ≥ **4.5:1** for normal size
  (≥ 3:1 only where used at large size); accent/status text and borders
  (`--teal`, `--red`, `--green`, `--yellow`, `--orange` used as foreground) ≥
  **3:1** against their background; status `-bg`/`-line` chips keep their label
  text ≥ 4.5:1.
- **High-Contrast** theme targets ≥ **7:1** for body text (AAA) in both modes.
- Verification is part of implementation: compute the rendered colors for each
  theme × mode via the live preview and check the ratios programmatically
  (`preview_inspect` + contrast math) before the feature is considered done.
  Any pair below target is retuned.
- All body fonts are legible by selection; font-size/density engine already lets
  users enlarge. Script font is heading-only, so it never affects readability of
  clinical text/numbers.

## Interactions & edge cases

- **Dark toggle** unchanged; it flips `body.dark`, which now selects the dark
  variant of whichever theme is active.
- **Cache-bust:** bump `index.html` `?v=` for `home.js` + the new CSS, and
  `sw.js` CACHE, per repo convention.
- **Concurrent editing:** `index.html`/`home.js` are shared with the other
  terminal and a formatter hook rewrites them on save — use precise edits and
  `git add` specific files; keep diffs surgical.
- Applying a theme/font must not trigger layout jank on load: `applyD()` runs
  early (same place today's display settings apply).

## Files touched

- `index.html` — appended theme CSS blocks + `data-font`/`data-head` CSS rules;
  cache-bust bumps.
- `home.js` — extend `DDEF`/`loadD`/`applyD`/`refreshD`/`openDisplay`; add
  `THEMES`, `FONTS` tables and the lazy webfont loader.
- `sw.js` — CACHE bump.
- (No new asset files required unless a self-hosted script font is chosen; default
  plan uses Google Fonts lazy links.)
