# KB Figures — progress (owner cap: $50 total image-generation spend)

Branch: kb-figs. Worktree: /private/tmp/stewardmd-wt/kb-figs (SSD path in the job brief is
not writable from this sandbox: `Operation not permitted`; escalated execution needs human
approval, which is disabled. /private/tmp/stewardmd-wt/ is the established fallback —
ir-depth already lives there. Main checkout untouched; all edits in this worktree.)

Spend so far: $0.00 (no paid calls yet; one free Vertex connectivity probe returned OK).

## Step 1 — reader (done, tests green)
- `kb-figure.js`: new pure helpers `isImage`, `imgUrl` (bank path → `/api/prep/bank/`,
  same shape as lesson figures), `imageHTML` (protocol-reader card), `imageKbrHTML`
  (disease-page figure). Strict src allowlist `v1/kb/media/*.webp`; anything else renders nothing.
- `kb-protocols.js` readerHTML: draws `figures[]` image entries in document order; drawn
  svg-spec keeps stable `Fig{i}` jump targets; images get `FigImg{i}` sections + TOC chips.
- Disease page: `kb/tools/build-kb-v2.mjs` now carries `figures[]` into buckets (new `entryFor`/
  `hasV2` exports, CLI unchanged; rebuild verified byte-identical except b42.json, where the
  one article with an svg-spec figure gains its `figures` entry); `kb-v2-loader.js` renders a
  new `figures` kind; `reasoning.js` dx section mounts a `v2("figures")` slot after imaging.
- `functions/api/prep/bank/[[path]].js`: allowlist gains `v1/kb/media/*.webp` (immutable).
- Cache tokens bumped: kb-figure kbfg2, kb-v2-loader kbv25 (+bucket `?v=kbv23`), kb-protocols
  kbp11 (hash suffix kept), reasoning +kbfig1.
- UI skills read before first edit: ui-ux-pro-max, brand, design-system, ui-styling,
  anti-ui-slop, impeccable, emil-design-eng, pick-ui-library (no new library chosen, per skill),
  bundled:taste, accessibility. Notes: `_ui-rules.md` does not exist in the repo; the standing
  block at the top of the job brief was followed instead. New work reuses `kbp-diagram-card`
  and `kbr-fig` idioms: no new colors, no motion, alt + lazy + async decode + ar box reserve.
- Tests: new `test/kb-figures-image.test.mjs` (7 tests). Adjacent suites green:
  kb-clinical-protocols 14, prep-links 26, prep-lessons 23, kb-search 16, kb-tests 3, kb-handouts 4.
  No existing test edited.

## Engine (built, pilot shipped)
- `tools/kb-img-engine.mjs`: KB variant of img-engine2.mjs. Free-licence Commons first
  (same licence filter + de-ID/RULES: no PHI, brand, watermark, R/L markers), Vertex image
  fallback in StewardMD palette, Flash judge ≥70 ships / <70 to rejects. Spend persisted in
  state file, HARD STOP $50 checked before every paid call + worker loop, per-article spend log.
- `~/prep-data/ir-work` is not writable from this sandbox (EPERM), so runs use
  `KB_IMG_WORK=/private/tmp/stewardmd-wt/kb-figs-work` (default stays the owner path; state,
  shipped-keys and rejects live there and will be handed over). R2 + Vertex work fine.
- Targets: 5,221 eligible of 5,222 reference articles (1 diagnostic-twin overlap screened out);
  ranked by links-index inbounds + nucleus360 hub bonus + core-system weight. Top-500 head and
  tail both clinical (IBD…aldosteronism). Planner judges image-worthiness per article and
  skips fillers at $0.003.
- PILOT: mitral_stenosis → AI figure, judge 100/100, $0.05 total spend. R2 bytes downloaded
  back and inspected: clean textbook diagram, navy + teal on white, correct labels, no
  watermark/logo/PHI. Fixed after pilot: AI figures now also carry an in-caption credit
  ("Illustration: StewardMD original.") per the job's "caption with credit".

## Run update: naming bug caught and fixed
- Bug: `figName` did not lowercase, so uppercase ids (STATUS_EPILEPTICUS, MCTD) shipped
  dash-mangled R2 names (`-------------------fig1`). Valid per the route, but ugly and
  collision-prone. Run stopped at 11 shipped / $0.77, engine fixed (lowercase + verified
  zero collisions across all 5,222), both figures re-uploaded under proper slugs
  (status-epilepticus-fig1, mctd-fig1), JSON + v2 buckets + ATTRIBUTION rows repaired.
  Orphaned dash-named R2 objects left in place (immutable bucket, harmless; noted for owner).
- Both renamed figures downloaded back and visually inspected: SE stepwise algorithm and
  MCTD overlap Venn, palette-clean, correct labels, no watermark/logo/PHI. Judge scores
  so far look honest (1 reject + 1 not-image-worthy skip in first 13).
- Run restarted with fixed engine (resumes from state; shipped keys skipped). Mix so far:
  2 Commons / 9 AI.
- Mid-run check: 78 shipped, 1 rejected (owner queue), 1 skipped (not image-worthy), 0 failed,
  spent $5.26 of $50 (pace ≈ $0.067/article, projects ≈ $34 for 500 — inside the cap).
- 60-min check: 134 shipped (23 Commons / 111 AI), 2 rejected, 1 skipped, 1 transient error
  (auto-retry), spent $9.43 of $50. Pace holding.
- 90-min check: 200 shipped (39 Commons / 161 AI), 3 rejected, 2 skipped, spent $13.30
  of $50. Pace ≈ $0.066/article, projects ≈ $33 for 500.
- 120-min check: 255 shipped (55 Commons / 200 AI), 3 rejected, 2 skipped, spent $16.61
  of $50. Past halfway, pace steady.
- 150-min check: 316 shipped (68 Commons / 248 AI), 4 rejected, 2 skipped, spent $20.62
  of $50. Three transient single-errors pending auto-retry.
- 180-min check: 386 shipped (85 Commons / 301 AI), 4 rejected, 2 skipped, spent $24.97
  of $50. About 115 articles left, projects ≈ $32 total.
- Later check: 388 shipped, spent $25.10. State file fresh (run alive); recent stretch is
  AI-heavy, so per-article time is up. Still well inside the cap.
- 210-min check: 454 shipped (97 Commons / 357 AI), 4 rejected, 2 skipped, spent $29.65
  of $50. About 45 articles left, projects ≈ $33 total.

## Next
- Full run: 500 articles, cap $50. Then attribution check, 390px / light+dark / contrast /
  focus / reduced-motion pass, full suite, one PR, merge, ota-publish, KB-FIGURES-DONE.md.
