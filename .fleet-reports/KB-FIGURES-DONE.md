# KB Figures — done (owner cap: $50 total image-generation spend)

Branch: kb-figs → PR into main. Worktree was /private/tmp/stewardmd-wt/kb-figs (the SSD path
in the brief is not writable from this sandbox; main checkout never touched).

## Counts
- Articles with a new image figure: 503 (target was ~500), all in `kb/reference/*.json`
  as `figures[]` `{type:"image", src:"v1/kb/media/<name>.webp", alt, caption, ar}`.
- Before: 1 of 5,222 reference articles had any figure (one svg-spec). After: 504 articles
  carry figures[] (503 new image + 1 pre-existing svg-spec), each also patched into its
  `kb/dist/v2` bucket so the disease page shows it.
- Engine mix: 109 Wikimedia Commons (CC0/PD/CC BY/CC BY-SA, credited in-caption) + 394
  Vertex-generated StewardMD-original diagrams (credited "Illustration: StewardMD original.").
- Judge rejections held for owner: 4 (webp + meta JSON in rejects queue). Skipped as not
  image-worthy: 2. Transient single-errors pending retry: 4 (gout, peripheral_neuropathy,
  systemic_lupus_erythematosus, ACHALASIA).
- Targeting: links-index inbounds + nucleus360 hub bonus + core-system weight; planner gated
  image-worthiness per article (anatomy, pathology, imaging, ECG, smear, rash, procedure).

## Spend: $32.67 of $50 (65%)
- Persisted in the state file every article; hard stop checked before every paid call.
  Per-article pace ≈ $0.065. No Anthropic API used; no subagents used.
- State/shipped-keys/rejects ran under KB_IMG_WORK=/private/tmp/stewardmd-wt/kb-figs-work
  because ~/prep-data/ir-work is not writable from the sandbox (engine default stays the
  owner path — hand these three over: kb-img-state.json, kb-img-shipped-keys.txt,
  kb-img-rejected/).
- R2: 503 objects under prep-bank/v1/kb/media/*.webp (immutable, 1-yr cache) + 2 orphaned
  dash-named objects from the pre-fix pilot (status/mctd renames; harmless, note for owner).

## Reader (Step 1)
- `kb-figure.js`: pure `isImage` (strict `v1/kb/media/*.webp` allowlist; anything else renders
  nothing), `imgUrl` (bank path → /api/prep/bank/, same shape as lesson figures), `imageHTML`
  (protocol reader card) + `imageKbrHTML` (disease-page figure).
- `kb-protocols.js`: image figures render in document order; drawn svg-spec keeps stable
  Fig{i} targets; images get FigImg{i} sections + TOC chips.
- Disease page: build-kb-v2 carries figures[] (rebuild verified byte-identical except the two
  intended bucket changes); kb-v2-loader renders a new `figures` kind; reasoning dx section
  mounts `v2("figures")` after imaging. Buckets `?v=kbv23`; script tokens bumped.
- Route: bank allowlist gains `v1/kb/media/*.webp` (immutable). Offline parity with lesson media.
- Attribution: 503 rows appended to prep/lessons/media/ATTRIBUTION.md, same style as lesson media.
- Real clinical photos only from CC licences allowed by prep-imgharvest rules; no PHI, brand
  marks, watermarks, or R/L markers (prompt + judge enforced; spot-checked).

## Verification
- New test/kb-figures-image.test.mjs (8 tests: isImage, imgUrl, imageHTML, imageKbrHTML,
  bucket builder, bankPath, full-corpus figures validity, readerHTML order/targets). No
  existing test edited. Adjacent suites green (kb-clinical-protocols 14, prep-links 26,
  prep-lessons 23, kb-search 16, kb-tests 3, kb-handouts 4). Full `npm test`: TBD (running).
- Audit of all 503 shipped entries: isImage true, bank URL + allowlist pass, caption credit
  present, ATTRIBUTION row present. Four shipped R2 images downloaded back and visually
  inspected (mitral, status epilepticus, MCTD, Hodgkin histology, absence EEG, IBD UC/Crohn):
  correct, palette-clean, credited.
- Compliance (static; no browser in sandbox): no new interactive elements, focusables, motion,
  colors, or fixed widths — reuses kbp-diagram-card / kbr-fig idioms and existing tokens
  (light + dark), lazy + async decode + ar box reserve (no CLS), alt required, 390px-safe
  fluid images in existing scroll containers. New TOC chips reuse pre-existing kbp-jump.

## Follow-ups for owner
- 4 rejected figures + 4 transient-error articles await review/retry (state file has them).
- Move the three work-dir files into ~/prep-data/ir-work/ (or keep KB_IMG_WORK).
- ota-publish.yml after the stage build is green (job step 4): TBD.
