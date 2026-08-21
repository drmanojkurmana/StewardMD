# Anatomy Atlas — implementation plan

Reverse-engineered from a 27s screen recording of e-Anatomy (IMAIOS) on iPhone.
Target: a StewardMD module with the same interaction, built on free/open-access
content. **Educational reference only — not for diagnosis.**

---

## 1. What the recording actually does

Two screens. Nothing more.

### Screen A — module catalog

- Header: `?` help · title "Modules" · account avatar.
- Two filter dropdowns: **Regions** and **Content types**.
- One long scroll, grouped by region section headers (`Brain`, `Head and Neck`,
  `Spine`, `Thorax`, … `Lower limb`).
- Each row is a card: ~76×76 square thumbnail (left) + title + modality subtitle
  (`MRI` / `CT` / `Illustrations` / `Angiography` / `Endoscopy` / `Photography`)
  + a badge bottom-right (`FREE` / `PREMIUM`).
- Thumbnails have decorative colour pins baked into the image, colour-coded by
  modality (blue=MRI, green=CT, red=illustration, magenta=angio/endoscopy).
  Purely cosmetic — not interactive.
- Floating bottom nav: Modules · Recent · Bookmarks · Quick links, plus a search FAB.

### Screen B — slice viewer (the real feature)

Layout, top to bottom:

| Zone | Contents |
|---|---|
| Header | circular back · title `Brain - MRI` · subtitle `Axial - T1` · search icon · hamburger |
| Stage | black; slice image centred and letterboxed; image footprint changes per slice (constant physical scale) |
| Label gutters | ~90px columns left and right of the image |
| Bottom bar | grid icon · 5-thumbnail scrub track with a blue playhead · `←  10/24  →` |

**Label rendering** (the distinctive part):

- Each label = a short vertical tick + 1–2 lines of text, hard-truncated with `…`
  (`Superi or fro…`, `Subarach noid sp…`). No wrapping beyond 2 lines.
- Labels sit in the left or right gutter depending on which half of the image
  their pin is in.
- Labels are **vertically redistributed to avoid overlap** — they are *not* at
  their pin's Y. `Precuneus` on slice 2 sits at the very bottom of the gutter
  while its pin is mid-image.
- A thin leader line runs from the tick to a small dot on the anatomy.
- **Colour encodes tissue category**, and the dot + line + text all share it:
  - white → white matter (`External capsule`, `Fornix`)
  - green → grey matter / nuclei (`Claustrum`, `Putamen`, `Thalamus`, `Pulvinar`)
  - cyan → CSF spaces / ventricles (`Subarachnoid sp…`, `Frontal horn`)
  - (extend: red arteries, blue veins, yellow nerves, tan bone/muscle)
- Label count varies per slice: 4 on slice 1, 7 on slice 2, ~28 on slice 10, 1 on slice 24.

**Slice navigation:**

- `←` / `→` step one slice.
- The 5-thumbnail strip is a **slider track**, not a filmstrip: 5 fixed
  representative thumbnails form the background, and a 3px blue vertical
  playhead moves across. Verified: 10/24 → playhead at ~40%, 20/24 → ~83%.
  So `playhead = (i-1)/(N-1)`.
- The grid icon opens an all-slices thumbnail grid.

**Selecting a structure** (tap a dot or a label):

- The selected label becomes a **white pill with black text**.
- **Every instance of that structure on the slice highlights together** — the
  bilateral fornix shows two white pills at once.
- Selected leader lines go bright white and thicker; selected dots go solid white.
- Everything else dims to ~35–40% opacity.
- A bottom sheet rises to a ~170px peek: grabber bar · ☆ bookmark · ✕ close ·
  large title (`Fornix`) · a synonym row with a small illustration thumbnail ·
  a pill row: `🔒 Lock` · `👁̸ Hide` · `🧠 White matter` (the parent category).
- Dragging the sheet to full height reveals three tabs:
  **Definition** (active, blue underline) · **Gallery** · **Anatomical hierarchy**.
- The Definition prose is classic Gray's Anatomy register: *"The Fornix is a
  longitudinal, arch-shaped lamella of white substance, situated below the
  corpus callosum…"* — which is **public domain** and directly reusable.
- `Lock` = keep this structure highlighted while scrubbing slices.
  `Hide` = remove this label from the overlay.

That is the entire feature. There is no 3D, no windowing/levelling, no
measurement, no DICOM parsing anywhere in this flow.

---

## 2. Design decisions — what we deliberately do NOT build

The obvious plan (Canvas + touch-gesture engine + Cornerstone.js + DICOM +
Vaul + Supabase + offline file cache) is four rungs too high. Every item below
is replaced by something already in this app or already in the browser.

| Tempting | What we use instead | Why |
|---|---|---|
| Canvas renderer | `<img src>` swap | No draw loop, no DPR maths, browser decodes + caches for free |
| Custom touch/velocity scrubber | `<input type="range">` | Native drag, keyboard arrows, VoiceOver, and momentum for zero lines |
| Cornerstone.js / Niivue | nothing | Both exist to render DICOM. We ship pre-rendered `.webp`. |
| DICOM in the app | offline conversion script | The app should never see a DICOM file. e-Anatomy ships flat images too. |
| Vaul drawer | existing `dialog-motion.js` | Already the app-wide spring sheet, kill-switch already wired |
| Supabase / a backend | static JSON on Pages | Content is read-only and versioned with the repo |
| `@capacitor/filesystem` cache | WebView HTTP cache | Only needed for true offline — deferred, see §9 |
| React / Next.js | vanilla JS | This app is vanilla `index.html` + `home.js`. Do not import a framework. |
| A new npm dependency | — | Zero new deps. The whole feature is DOM + SVG + CSS. |

Pin/line/label overlay: **inline SVG with a `viewBox`**, sized to the image box.
Percentage coordinates map straight to viewBox units, so it scales to any screen
with no resize listener and no pixel maths.

---

## 3. Data model

Two files per module. Structures are deduped into a dictionary so a definition
is stored once, not once per slice.

`atlas/modules.json` — the catalog (one file, all modules):

```json
{
  "version": 1,
  "regions": ["Brain", "Head and Neck", "Spine", "Thorax", "Abdomen", "Upper limb", "Lower limb"],
  "modules": [
    {
      "id": "brain-mri-axial-t1",
      "title": "Brain - MRI",
      "subtitle": "Axial - T1",
      "region": "Brain",
      "modality": "MRI",
      "slices": 24,
      "thumb": "atlas/brain-mri-axial-t1/thumb.webp",
      "source": { "name": "Visible Human Project (NLM)", "license": "Public domain", "url": "https://..." }
    }
  ]
}
```

`atlas/<module-id>/atlas.json` — one module:

```json
{
  "id": "brain-mri-axial-t1",
  "categories": {
    "white-matter": { "label": "White matter", "color": "#ffffff" },
    "grey-matter":  { "label": "Grey matter",  "color": "#7ee081" },
    "csf":          { "label": "CSF spaces",   "color": "#7fd9e8" }
  },
  "structures": {
    "fornix": {
      "name": "Fornix",
      "synonyms": ["Fornix cerebri"],
      "category": "white-matter",
      "parent": "limbic-system",
      "definition": "The Fornix is a longitudinal, arch-shaped lamella of white substance, situated below the corpus callosum…",
      "definitionSource": "Gray's Anatomy (1918), public domain"
    }
  },
  "slices": [
    {
      "i": 10,
      "img": "atlas/brain-mri-axial-t1/010.webp",
      "w": 1, "h": 1.12,
      "pins": [
        { "s": "fornix",   "x": 49.2, "y": 55.8 },
        { "s": "fornix",   "x": 52.6, "y": 55.4 },
        { "s": "thalamus", "x": 46.1, "y": 51.0 }
      ]
    }
  ]
}
```

- `x`/`y` are percentages of the **image box**, not the screen. Screen-size independent.
- Repeating `"s": "fornix"` twice is how bilateral structures get two pins that
  highlight together — the selection key is the structure id, so this falls out
  of the data model for free.
- `w`/`h` = image aspect ratio, so the stage can letterbox without waiting for
  the image to load (prevents a layout jump while scrubbing).

Budget check: 24 slices × ~90KB webp @ 800px ≈ **2 MB per module**.
Cloudflare Pages limits are **25 MiB per file** (fine) and **20,000 files per
deployment** (also fine: 20 modules × 25 files ≈ 500). Past ~150 modules, move
images to R2 and keep the JSON in the repo.

---

## 4. Files to add

Small and additive. Nothing existing gets restructured.

```
atlas/modules.json                     catalog
atlas/<module-id>/atlas.json           per-module annotations
atlas/<module-id>/NNN.webp             slices
atlas/<module-id>/t/NNN.webp           128px thumbnails (grid + scrub track)
atlas.js                               the whole feature (~600 lines)
atlas.css                              gutters, pills, scrub track (~200 lines)
tools/atlas-author.html                local-only annotation tool (NOT deployed)
tools/atlas-convert.py                 DICOM/PNG → webp + thumbnails
test/atlas-labels.test.mjs             the one check (§5)
```

Touched existing files, minimally:

- `index.html` — one `<section id="atlasScreen">` shell + the two `<script>`/`<link>` tags.
- `home.js` — one sidebar entry and one home tile, copying the shape of an existing one.
- `_headers` — long `Cache-Control: immutable` for `/atlas/*` (content is
  versioned by filename, so cache it hard).

> The repo's formatter hook rewrites `index.html` / `app.js` / `home.js` on save.
> Use scripted edits and `git add` those paths explicitly.

Reuse, do not reimplement: `dialog-motion.js` (the sheet), `window.ICONS`
(all icons — the emoji-ban test will fail the build otherwise), `no-copy.js`
(already global), the existing back-control convention so swipe-back works.

---

## 5. The only real algorithm: label placement

Everything else is plumbing. This is the part that decides whether it looks like
the recording or looks broken.

```js
// Lay out one gutter. pins already filtered to this side, y in 0..100.
// Returns [{pin, labelY}] with no overlaps, all within [pad, 100-pad].
function layoutGutter(pins, gapPct, padPct) {
  const out = pins
    .map(p => ({ pin: p, labelY: p.y }))
    .sort((a, b) => a.labelY - b.labelY);

  // pass 1: push down to enforce the minimum gap
  for (let i = 1; i < out.length; i++) {
    const min = out[i - 1].labelY + gapPct;
    if (out[i].labelY < min) out[i].labelY = min;
  }
  // pass 2: if we ran off the bottom, push the whole column back up
  const overflow = out.length ? out[out.length - 1].labelY - (100 - padPct) : 0;
  if (overflow > 0) for (const o of out) o.labelY -= overflow;
  // pass 3: clamp the top, re-enforcing the gap downward
  if (out.length && out[0].labelY < padPct) {
    out[0].labelY = padPct;
    for (let i = 1; i < out.length; i++)
      out[i].labelY = Math.max(out[i].labelY, out[i - 1].labelY + gapPct);
  }
  return out;
}
```

- Side assignment: `pin.x < 50 ? 'left' : 'right'`.
- `gapPct` ≈ 6.5 (two lines of text at the recording's density), `padPct` ≈ 2.
- Leader line = a 2-point polyline `tick → dot`. The recording uses straight
  diagonals; no elbow needed.

`// ponytail:` greedy single-column pass. On slices with ~28 labels one column
can saturate; if that shows up visually, upgrade to balancing counts across the
two gutters before the vertical pass — not before.

**The one check** (`test/atlas-labels.test.mjs`, assert-based, no framework):
for every slice in every module, run `layoutGutter` and assert (a) no two labels
in a column are closer than `gapPct`, (b) every label is within bounds, (c) every
`pin.s` resolves to a structure and every structure's `category` resolves.
That last one catches the typo class that would otherwise render an invisible pin.

---

## 6. Content pipeline — this is the actual project

The code is a few days. Sourcing and annotating is the real work. Plan for it
explicitly or this stalls at one module forever.

### Image sources — safe to ship

| Source | What | Licence |
|---|---|---|
| **Visible Human Project** (NLM/NIH) | cryosection photography, CT, MRI | Public domain |
| **TCIA** | DICOM CT/MR series | Mostly CC-BY — **check per collection** |
| **Wikimedia Commons** | labelled cross-sections, illustrations | CC0 / PD only — check each file |
| **OpenAnatomy** (SPL/Harvard) | labelled atlases, segmentations | Open, attribution required |

**Do not use Radiopaedia.** Its open cases are non-commercial-only. StewardMD is
a commercial app; an "educational" module inside it does not clear that licence.
This is the one item in the original plan that must be dropped.

### Text sources

- **Definitions:** Gray's Anatomy (1918) — public domain, Project Gutenberg /
  Wikisource. This matches the recording's register almost exactly.
- **Terminology + hierarchy:** Terminologia Anatomica / FMA via BioPortal.
  Verify the terms of use before bulk import; a hand-built 3-level hierarchy is
  enough for v1 and has no licence question at all.

### Conversion (`tools/atlas-convert.py`)

Reads a DICOM or PNG stack, applies a fixed window/level once, exports
`NNN.webp` at 800px plus `t/NNN.webp` at 128px, and emits a skeleton
`atlas.json` with the right slice count and aspect ratios. Uses `pydicom` +
`Pillow` — a local script, not an app dependency.

### Annotation (`tools/atlas-author.html`)

**Build this second, before the viewer polish.** You will spend 95% of your time
in it, so its ergonomics decide whether the atlas ever gets content.

Local-only page, never deployed. Shows one slice, and:

- click on the image → records `x`/`y` as percentages,
- type into a `<datalist>` of existing structure ids → autocomplete or create,
- `←`/`→` move slices, `Delete` removes the selected pin,
- **copy-forward:** press `↓` to copy the current slice's pins to the next slice
  as a starting point — adjacent slices share most structures, so this is the
  single biggest time saver in the whole project,
- a "Download atlas.json" button writes the file.

~150 lines. It pays for itself on the first module.

---

## 7. Build phases

Each phase ends in something visibly working. Stop and look at it before moving on.

**Phase 1 — one hardcoded slice (half a day)**
`atlasScreen` section, header, black stage, one `.webp`, an SVG overlay with 3
hand-written pins, `layoutGutter` + leader lines. Acceptance: labels and lines
land correctly and stay correct when you rotate the phone and resize.

**Phase 2 — the converter and the authoring tool (1–2 days)**
`atlas-convert.py` on a real public-domain stack, then `atlas-author.html`.
Acceptance: 24 real slices exist as webp, and you have annotated slice 10 with
~15 structures entirely through the tool.

**Phase 3 — scrubbing (half a day)**
`<input type="range">` over the 5-thumbnail track, `←`/`→` calling
`stepDown()`/`stepUp()`, `(i-1)/(N-1)` playhead, the all-slices grid overlay, and
preload of slices `i±1` and `i±2` so scrubbing never flashes white.
Add drag-on-image scrub: on `pointerdown`, if the pointer moves >8px before
release, treat it as a scrub instead of a tap — that same threshold is also what
cleanly separates "scrub" from "tap a pin". Acceptance: drag from slice 1 to 24
with no flicker and no missed taps.

**Phase 4 — selection and the sheet (1 day)**
Tap a pin or a label → white pill on *every* instance of that structure, bright
leader lines, everything else to 38% opacity. Open `dialog-motion.js`'s sheet at
peek height with title / synonym / `Lock` `Hide` `<category>` pills; expand to
the three tabs. `Lock` persists the highlight across slices; `Hide` drops the
label. Acceptance: selecting `Fornix` on slice 10 highlights both pins; Lock
keeps it highlighted while you scrub to 14.

**Phase 5 — catalog (half a day)**
`modules.json` → region-grouped list, filter chips for Regions and Content types,
sidebar entry and home tile, back/swipe-back wired to the existing convention,
per-module attribution row. Acceptance: home → atlas → module → back → home,
with swipe-back working at each step.

**Phase 6 — content scale-up (ongoing)**
Repeat phases 2's annotation step per module. This is calendar time, not code time.

---

## 8. Educational-use guardrails

Since the framing is educational, make that explicit in the product, not just in
intent:

- A persistent footer line in the viewer: *"Educational reference only — not for
  diagnosis."* Matches the app's existing disclaimer pattern.
- An attribution row per module rendered straight from `source` in the JSON
  (name, licence, link). Keeps compliance in the data, not in someone's memory.
- Ship only public-domain / CC0 / CC-BY images. Every file's licence is recorded
  in the JSON at ingestion time, not looked up later.

---

## 9. Deliberately deferred

| Deferred | Add when |
|---|---|
| Offline image caching (`@capacitor/filesystem`) | users actually report needing the atlas offline; images are ~2 MB/module and the WebView already caches over HTTP |
| Pinch-zoom / pan on the slice | someone asks; CSS `touch-action` + a transform is ~20 lines when it's real |
| Live DICOM, window/levelling, measurement | never, for an atlas — that is a viewer feature, not an atlas feature |
| Search across structures, Bookmarks, Recent, Quick links | after one module ships and there is something to search |
| Two-gutter label balancing | a slice visibly saturates one column (§5) |
| R2 image hosting | the atlas passes ~150 modules |

---

## 10. Model / cost note

This is a well-scoped vanilla-JS DOM feature — Sonnet handles it. The label
placement pass and the scrub/tap disambiguation are the only parts worth
escalating for, and only if they misbehave. On a Claude Code subscription the
per-token cost framing does not apply at all; the real budget line for this
project is **annotation hours**, not tokens.
