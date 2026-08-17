# Anatomy Atlas — Specification

**Status:** spec, pending licence clearance register (§9)
**Date:** 2026-08-17
**Plans implementing this spec:**
- `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md` (in-app viewer)
- `docs/superpowers/plans/2026-08-17-anatomy-atlas-pipeline.md` (offline content pipeline)

Supersedes `docs/ANATOMY_ATLAS_PLAN.md`, which contains three claims that are
wrong against the current codebase (see §7 Corrections).

---

## 1. Goal

A cross-sectional anatomy atlas inside StewardMD: scroll through a stack of
labelled slices, tap a structure, read its definition. Interaction fidelity
equal to e-Anatomy (IMAIOS); content built entirely from attribution-free,
commercial-use-permitted sources.

Free to all users. Framed and labelled as educational reference.

## 2. Non-goals

Explicitly out of scope. Do not build these; do not leave hooks for them.

- 3D rendering, volume reconstruction, MPR.
- DICOM parsing in the app. Window/level, measurement, ROI tools.
- Any clinical/diagnostic claim. This is a reference, not a reporting tool.
- User-generated annotation, sharing, or export of slices.
- Multi-language terminology (Latin/TA parallel names) in v1.
- Offline availability of slice images in v1 (see §6 Deferred).

## 3. Two subsystems

The seam is `atlas.json`. Each subsystem is independently testable and neither
blocks the other.

| | **A — Content pipeline** | **B — Viewer** |
|---|---|---|
| Runs | Offline, dev machine | In app |
| Language | Python 3 | Vanilla ES5-style JS (IIFE) |
| Input | Public-domain volumes + open segmentations | `atlas/**/*.json` + `.webp` |
| Output | `atlas.json`, `NNN.webp`, `t/NNN.webp` | The UI |
| Tested against | The §4 schema | A hand-written fixture |
| Ships to users | No (dev tooling) | Yes |

**B is built first**, against a hand-written 3-pin fixture. This guarantees the
schema is exercised by a real consumer before the pipeline generates 20,000 pins
in the wrong shape.

## 4. Data contract

The single source of truth for both subsystems. Any change here is a change to
both plans.

### 4.1 `atlas/modules.json`

```json
{
  "version": 1,
  "credits": ["Courtesy of the U.S. National Library of Medicine"],
  "modules": [
    {
      "id": "brain-mri-axial-t1",
      "title": "Brain - MRI",
      "subtitle": "Axial - T1",
      "region": "Brain",
      "modality": "MRI",
      "slices": 24,
      "thumb": "/atlas/brain-mri-axial-t1/t/012.webp"
    }
  ]
}
```

- `credits` — the **only** strings the UI may render as attribution, shown solely on
  the atlas info screen. Curated and render-safe by construction. Deliberately *not*
  `provenance`, which carries licence notes and internal tooling paths that must
  never reach a user. Empty array = no credit block rendered.
- `region` is a free string; the catalog groups by it in first-appearance order.
  No separate region registry — one less thing to keep in sync.
- `modality` is display-only text (`MRI`, `CT`, `Illustration`, `Photograph`).
- `id` is `[a-z0-9-]+` and is also the directory name.

### 4.2 `atlas/<id>/atlas.json`

```json
{
  "id": "brain-mri-axial-t1",
  "provenance": {
    "images": "NLM Visible Human Project",
    "licence": "Public domain",
    "definitions": "Gray's Anatomy (1918)",
    "derivedFrom": "…",
    "clearedOn": "2026-08-17"
  },
  "categories": {
    "white-matter": { "label": "White matter", "color": "#ffffff" },
    "grey-matter":  { "label": "Grey matter",  "color": "#7ee081" },
    "csf":          { "label": "CSF space",    "color": "#7fd9e8" }
  },
  "structures": {
    "fornix": {
      "name": "Fornix",
      "category": "white-matter",
      "parent": "limbic-system",
      "definition": "The fornix is a longitudinal, arch-shaped lamella of white substance situated below the corpus callosum."
    },
    "limbic-system": { "name": "Limbic system", "category": "white-matter" }
  },
  "slices": [
    {
      "i": 1,
      "img": "/atlas/brain-mri-axial-t1/001.webp",
      "aspect": 0.89,
      "pins": [
        { "s": "fornix", "x": 49.2, "y": 55.8 },
        { "s": "fornix", "x": 52.6, "y": 55.4 }
      ]
    }
  ]
}
```

**Field rules — these are the validator's assertions:**

- `x`, `y` — floats 0–100, percentages **of the image box**, not the viewport.
  Screen-size independent by construction; no resize listener anywhere.
- `aspect` — `width / height` of the image file. Present so the stage can
  letterbox before the image loads, which is what prevents the layout jump
  while scrubbing.
- `i` — 1-based, contiguous, ascending, `length === modules[].slices`.
- Repeating the same `s` within one slice is **legal and load-bearing**: it is
  how bilateral structures get two pins that highlight together. Selection is
  keyed on structure id, so multi-instance highlight falls out of the model with
  no extra code.
- `parent` is optional and must resolve to another key in `structures` when
  present. Used by the hierarchy tab. Cycles are a validation error.
- `definition` is optional. A structure may exist purely as a hierarchy parent.
- `provenance` is recorded for our own audit trail and **is never rendered**
  (see §5.6).

### 4.3 Budget

- ~90 KB/slice at 800 px → **~2 MB per 24-slice module**.
- Cloudflare Pages: 25 MiB per file (fine), 20,000 files per deployment
  (20 modules ≈ 500 files, fine). Revisit at ~150 modules → move to R2.
- `atlas.json` per module: < 200 KB. Well under any limit.

## 5. Viewer requirements

Derived frame-by-frame from a 27 s reference recording (1180×2556, iPhone).
Every number below was measured, not invented.

### 5.1 Catalog screen

- Region-grouped single scroll. Section header per region.
- Row: 76×76 thumbnail · title · modality subtitle. **No price/tier badge** —
  everything is free, so the `FREE`/`PREMIUM` badge in the reference has no
  analogue here and must not be reproduced.
- Two filter controls: region and modality. Filtering is a pure function of
  `(modules, region, modality)` → `modules`, unit-tested independently of the DOM.

### 5.2 Slice viewer layout

| Zone | Contents |
|---|---|
| Header | back control · title · subtitle · (no search in v1) |
| Stage | black; image centred, letterboxed to `aspect` |
| Gutters | ~90 px columns left and right of the image |
| Bottom bar | grid button · 5-thumbnail scrub track with playhead · `←  N/M  →` |

### 5.3 Label rendering

- One inline `<svg>` layered over the stage, in **stage pixel coordinates** — so
  circles stay circular and text stays upright at any stage aspect. Cost: one
  `ResizeObserver` repaint. There is no per-pin pixel maths and no percentage
  bookkeeping beyond a single `imageBox()` call.
- Side assignment: `pin.x < 50` → left gutter, else right.
- Labels are **vertically redistributed to avoid overlap**, not placed at their
  pin's Y. This is the one real algorithm; see §5.4.
- Label = a short vertical tick + up to 2 lines of text, truncated with `…`.
- Leader line = a straight 2-point polyline from tick to dot.
- **Colour is per category** and shared by text, line and dot. Measured from the
  reference: white matter → white, grey matter/nuclei → green, CSF → cyan.
  Colours come from `categories[].color`; the viewer hardcodes none.

### 5.4 Label placement

Pure function, no DOM. Signature is fixed here because both the viewer and its
test depend on it:

```js
layoutGutter(pins, gapPct, padPct) -> [{ pin, labelY }]
```

Greedy three-pass: sort by `pin.y`; push down to enforce `gapPct`; if the column
overflows the bottom, shift the whole column up; clamp the top and re-enforce
`gapPct` downward. `gapPct = 6.5`, `padPct = 2` (matched to the reference's label
density).

Guarantees the test asserts: no two labels in a column closer than `gapPct`;
every `labelY` within `[padPct, 100 - padPct]`; output length equals input length;
order preserved by `pin.y`.

`// ponytail:` single-column greedy. A slice with ~28 labels can saturate one
gutter. Upgrade to cross-gutter count balancing **only if that shows up
visually** — not pre-emptively.

### 5.5 Slice navigation

- Native `<input type="range" min=1 max=M step=1>` over the thumbnail track.
  Chosen so drag, keyboard arrows and VoiceOver all work with zero code.
- `←`/`→` buttons call `stepDown()`/`stepUp()` then dispatch `input`.
- Playhead position: `(i - 1) / (M - 1)`. Verified against the reference at
  10/24 → 39% and 20/24 → 83%.
- Track background: 5 evenly-sampled thumbnails, absolutely positioned behind a
  transparent range input.
- Grid button → overlay grid of all slice thumbnails; tap sets the slice.
- Preload slices `i±1` and `i±2` via `new Image()` so scrubbing never flashes.
- **Drag-on-image scrub:** on `pointerdown`, if the pointer travels > 8 px before
  release, treat as scrub (map `dx` → slice delta) and suppress the tap. The same
  8 px threshold is what cleanly separates scrub from tap-a-pin — one constant,
  two jobs.

### 5.6 Selection and detail sheet

- Tap a dot or a label → select that **structure id**.
- **Every** pin with that id on the current slice renders as a white pill with
  black text; its leader lines go opaque white and thicker; its dots go solid.
- All other labels, lines and dots drop to 38% opacity.
- Sheet opens at **peek** height (~170 px): grab handle · bookmark · close ·
  structure name · category chip · `Lock` · `Hide`.
- Dragging the sheet up snaps it to **full** height, revealing three tabs:
  `Definition` · `Gallery` · `Anatomical hierarchy`.
- `Lock` keeps the structure highlighted while scrubbing slices.
  `Hide` removes that label from the overlay for the session.
- A persistent line in the viewer footer: *"Educational reference only — not for
  diagnosis."*
- **No attribution or source text is rendered anywhere in the UI.** This is a
  hard product requirement and is the reason for the §9 source constraint.
  `provenance` exists in the JSON for our audit trail only.

### 5.7 Accessibility

Not negotiable, and mostly free given the choices above:

- The scrubber is a real `<input type="range">` with an `aria-label`.
- Every pin is a focusable `<circle role="button">` with an `aria-label` of the
  structure name; keyboard `Tab` reaches them.
- The sheet traps focus while open and restores it on close.
- No information conveyed by colour alone — the name is always present as text.

## 6. Deferred

Each with the trigger that would justify building it.

| Deferred | Build when |
|---|---|
| Offline slice images (`@capacitor/filesystem`) | users report needing the atlas offline; the WebView HTTP cache covers casual reuse |
| Pinch-zoom / pan | someone asks; ~20 lines of CSS transform when real |
| Cross-module structure search | more than ~5 modules exist |
| Bookmarks / Recent | the bookmark button has somewhere to write to |
| Multi-language (TA Latin) terminology | after v1 ships, and only if licence-clear |
| Cross-gutter label balancing | a slice visibly saturates one gutter |
| R2 image hosting | past ~150 modules |
| Live DICOM, window/level, measurement | never — that is a viewer feature, not an atlas feature |

## 7. Corrections to `docs/ANATOMY_ATLAS_PLAN.md`

That doc was written before the codebase was surveyed. Three claims are wrong and
would have caused real rework:

1. **"Add a `<section id="atlasScreen">` to index.html."** Wrong. `grep '<section id='
   index.html` returns zero hits. Every module written since the legacy `app.js`
   era creates its own root in JS (`onco-home.js:193`) and exposes
   `window.XXX = { open, close }`. Follow that.
2. **"Reuse `dialog-motion.js` as the sheet."** Wrong. `dialog-motion.js` is a
   passive `MutationObserver` with no exports and no open API. What it actually
   gives you: put `sheet` in the element's class list and toggle `.on`, and it
   springs the element for free. The sheet itself must be written.
   Also **no multi-height/peek sheet exists anywhere in the repo** — `home.js`'s
   private `openSheet()` is single-height and not exported. Peek→full is net-new.
3. **"Add a `Cache-Control: immutable` block to `_headers`."** Skip it. `_headers`
   currently has no `Cache-Control` and no path-scoped block at all; runtime
   caching is the service worker's stale-while-revalidate. Adding the first-ever
   path block to get a marginal caching win is not worth the blast radius.

## 8. Integration contract

Surveyed from the live repo. These are the exact seams; deviating from them
produces a module that renders behind the home screen or is invisible to
swipe-back.

- **Root:** created in JS. `window.ATLAS = { open, close, isOpen, back }`.
  Overlay `position:fixed; inset:0; display:none`, `.on` → `display:flex`.
  Call `window.SMD_hideHome()` on open.
- **`goHome()` registration:** add `window.ATLAS && window.ATLAS.close` to the
  `apis` array in `home.js` (~line 480). Without this, Home leaves the atlas open.
- **Home tile:** one entry in `HOME_TOOLS` (`home.js:1350`). `ic` is a **Material
  Symbols ligature** (System B, `ric()`), not an `ICONS` key.
- **Sidebar:** three edits in `sidebar-redesign.js` — its `ACT` map, a `row(...)`
  call, and its **own private `ICON` map** (it does not use `window.ICONS`).
- **Module-internal icons:** `window.ICONS.get(name, cls)` (System A), always
  guarded: `(window.ICONS && ICONS.get) ? ICONS.get(n) : ""`.
- **Emoji ban:** `test/no-ui-emoji.test.mjs` blocks `☆ ✕ 🔒 🧠` and friends. Use
  `ICONS.get`. Add `atlas.js` to the `COVERED` list (line 77) so it is scanned.
- **Back / swipe-back:** back controls must match `swipe-back.js`'s `BACK_SEL` —
  use `class="atlas-back"` (matches `[class*="-back"]`) **and**
  `aria-label="Close"`. For two-level back (viewer → catalog → home) add an
  interception line at `swipe-back.js:69` mirroring the FundX precedent.
- **Native bundling:** `scripts/build-www.sh` is an **explicit allowlist**. A new
  top-level `atlas/` directory silently does not ship to native. Copy the JSON
  into `www/`; leave `.webp` slices on Pages and rewrite their URLs natively,
  mirroring `kardiox-screens.js:16` (`kxImg`).
- **Cache bump:** on ship, bump `?v=` in `index.html` and `CACHE` in `sw.js:13`.
- **Fetch idiom:** absolute `/`-prefixed paths, no version param. Unlike the
  house fire-and-forget pattern, the atlas **must await** its module JSON before
  the first slice paints (or paint a skeleton and repaint on resolve).
- **Formatter hook:** a save-time formatter rewrites `index.html` / `home.js` /
  `app.js`. Edit programmatically, re-read to confirm, `git add` only your paths.
- **Vault:** add `vault/modules/Anatomy Atlas.md`; log the build decision in
  `vault/decisions/Decisions.md`.

## 9. Content licence constraint

**DECIDED 2026-08-17 by the product owner — attribution tier B+ ("notices + one
credit line"):**

1. **Nothing names a source anywhere in the slice viewer or the catalog.** No credit
   on or beside an image, ever. The existing tests assert this and must keep passing.
2. **One credit line is permitted on a dedicated atlas info screen**, reached from an
   `i` control in the atlas header — not in `catalogHtml()` or `viewerHtml()`. Exact
   string: `Courtesy of the U.S. National Library of Medicine`.
3. **Third-party licence text ships in the app's existing Settings → Legal page**
   (Apache-2.0 §4 notice retention), not in the atlas.

StewardMD is a commercial product; distributing the atlas free of charge to students
does not create a licence, and "educational use" is not a substitute for one. The
tier above is what makes the chosen sources lawful — it is not cosmetic.

Consequent flips in the register: **Visible Human CT + MRI → CLEAR** (base images),
**SPL/NAC Brain Atlas → CLEAR** (300+ hand-labelled structures), **TotalSegmentator
`total`/`total_mr`, FastSurfer `--seg_only`, SynthSeg v1.0 → CLEAR** (notice retention
satisfied by the Settings → Legal page).

Consequences already known:

- **Radiopaedia is excluded.** Its open cases are non-commercial only.
- **Wikipedia prose is excluded.** CC BY-SA requires both attribution and
  share-alike.
- **CC-BY sources are excluded** under the no-attribution rule — including
  several TCIA collections and some ontologies. If a needed layer turns out to
  have no attribution-free option, the choice is escalated to the product owner:
  either render one credit line, or hand-author that layer.

Every source must be entered in the **Clearance Register** below before any of
its data is committed. Register columns: source · licence + version ·
commercial? · attribution required? · share-alike? · derived-data
redistribution? · verified-from URL · verdict.

### 9.1 Three kinds of "attribution"

Verification showed the constraint is not binary. Sources split three ways, and
the middle bucket is a decision for the product owner, not a technical finding:

- **(A) Content attribution** — CC BY / BY-SA, or a contractual credit clause.
  Requires a visible credit near the content. **Fails the constraint.**
- **(B) Notice retention** — Apache-2.0 §4, BSD, FreeSurfer/Slicer Part B.
  Requires licence text in the distributed software *and its user documentation* —
  normally satisfied by a bundled third-party-notices screen, which most apps
  already ship. Not a credit caption on the image. **Owner's call.**
- **(C) No obligation** — public domain / CC0.

### 9.2 Clearance Register

Verified 2026-08-17 from primary licence sources. **No pipeline task may run
against a source whose row is not `CLEAR`.**

| Source | Licence | Comm. | Attrib. | Verdict |
|---|---|---|---|---|
| **TotalSegmentator code + `total` / `total_mr` weights** | Apache-2.0 | yes | notice only (B) | **CLEAR** |
| **FastSurfer `--seg_only` (`asegdkt`, `cereb`)** | Apache-2.0 | yes | notice only (B) | **CLEAR** — needs no FreeSurfer licence |
| **SynthSeg v1.0 weights (in-repo)** | Apache-2.0 | yes | notice only (B) | **CLEAR** |
| **Terminologia Anatomica — individual terms** | explicitly PD | yes | no | **CLEAR** |
| **Gray's Anatomy 1918 — text + figures** | PD-US (pre-1931) | yes | no | **CLEAR (US)** |
| **Wikimedia Commons — CC0/PD filtered only** | CC0 / PD | yes | no | **CLEAR** with per-file audit record |
| NLM Visible Human | US Gov, no copyright | yes | **YES (contractual)** | **CONDITIONAL** — download T&C demands "Courtesy of the U.S. National Library of Medicine" |
| SPL/NAC Brain Atlas (Open Anatomy) | 3D Slicer Part B | yes | notice (B) | **CONDITIONAL** — 300+ hand-labelled structures; best single source if (B) is acceptable |
| PMC OA — CC0 subset only | mixed | varies | varies | **CONDITIONAL** — programmatic per-article filter |
| TotalSegmentator training dataset | CC BY 4.0 | yes | YES | **CONDITIONAL** — never run models *on* it |
| TCIA (all collections) | CC BY 3.0/4.0, some NC | varies | **YES + DOI cite** | **BLOCKED** — no CC0 collection found |
| Wikipedia prose | CC BY-SA 4.0 | yes | YES + share-alike | **BLOCKED** |
| FMA | CC BY 3.0 | yes | YES | **BLOCKED** |
| UBERON | CC BY 3.0 | yes | YES | **BLOCKED** |
| TA2 document / its hierarchy | CC BY-**ND** 4.0 | yes | YES + no derivatives | **BLOCKED** (terms alone are fine) |
| **FSL** | FSL Licence | **NO** | — | **BLOCKED** — and §(2)/(3) reach the *dev process*: using FSL to generate coordinates for a commercial app is caught even if no FSL code ships |
| **JHU ICBM-DTI-81** (via FSL) | FSL | **NO** | — | **BLOCKED** |
| FreeSurfer + DK / DKT / Destrieux atlas **files** | FreeSurfer v1.0 | yes | **YES** (Part B §1(b), into user docs) | **BLOCKED** under a strict rule. Also: "CLINICAL APPLICATIONS ARE NEITHER RECOMMENDED NOR ADVISED" |
| DK / DKT / Destrieux **label names** | nomenclature, unprotectable | yes | no | **CLEAR** — names usable, geometry not |
| Mindboggle-101 | CC BY-NC-SA 3.0 (paper) vs CC BY 4.0 (site) — conflicting | no | YES | **BLOCKED** |
| TotalSegmentator `brain_structures` | proprietary, paid commercial | **NO** | — | **BLOCKED** |
| TotalSegmentator `brain_aneurysm` | CC BY-NC 4.0 | **NO** | — | **BLOCKED** |
| TractSeg | Apache-2.0 code; weights UNVERIFIED; needs MRtrix3 | ? | ? | **CONDITIONAL** — weakest link |

**The one genuine dead end: named white matter.** Every named WM atlas is FSL-encumbered
(JHU, XTRACT, HCP1065, FMRIB58) or non-commercial. There is no attribution-free path.
**Resolution: hand-author it** — ~12–20 pins placed once on our own PD base image
(corpus callosum genu/body/splenium, internal capsule limbs, external capsule, corona
radiata, forceps major/minor, fornix, cingulum, SLF, optic radiation), named with PD
TA terms and described from Gray's. The result is our own copyright with no upstream.
Cheaper than negotiating an FSL commercial licence, and it removes the layer permanently.

**Flagged UNVERIFIED — must not be treated as cleared:** FMA's licence *version*
(licensor's page offline) · Open-i site-level terms · JHU's independent non-FSL terms ·
FastSurfer and TractSeg *weights* licences as distinct from their code · SynthSeg
2.0/robust/parc weights · HCP data-use terms behind TractSeg · MRtrix3's licence ·
whether W. H. Lewis is the 1918 editor of record · the argument that model *output*
escapes Apache-2.0 notice conditions.

**Correction to an earlier draft:** Project Gutenberg #33513 is *not* Gray's Anatomy
(it is an unrelated novel); Gray's does not appear to be on Project Gutenberg. Source
the 1918 text from an original scan — not Gutenberg (trademark notice + 20% commercial
royalty clause) and not Wikisource wikitext (editor annotations are BY-SA).

## 10. Success criteria

The feature is done when all of these hold:

1. From Home, one tap opens the catalog; one tap opens a module; swipe-back
   returns viewer → catalog → home.
2. Dragging the scrubber from slice 1 to 24 shows no white flash and drops no taps.
3. Tapping `Fornix` on a slice where it appears twice highlights **both** pins,
   dims everything else, and opens the sheet at peek height.
4. Dragging the sheet up reveals the Definition tab with real text.
5. `Lock` keeps the structure highlighted while scrubbing to another slice.
6. `npm test` passes, including the new label-placement and schema-validation
   tests and the emoji scan over `atlas.js`.
7. Rotating the device and running at 320 px width keeps every label inside its
   gutter and every leader line attached to its dot.
8. No attribution or source string appears anywhere in the UI.
9. Every shipped source has a `CLEAR` row in the Clearance Register.
