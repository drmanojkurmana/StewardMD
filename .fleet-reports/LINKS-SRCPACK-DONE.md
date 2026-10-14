# LINKS-SRCPACK-DONE — item source provenance (srcPack) as Know more evidence

Branch `links-srcpack-1014` off `origin/main`. Owner check item Q-34P-8EY-5B7
(ss-medical-oncology / son-gtn-rare, `q_4d63d0b4ada8`, triploid partial mole).

## Outcome first

Shipped, gated: `tools/prep-links.mjs` maps each item's `srcPack` kb ids to real
KB articles / clinical protocols and shows **only the ones the item itself
evidences** (distinguishing-word bar, titles only), at most 3 KB per item; the
verified module topic rides as the chapter row and the subject lesson stays as
"Learn this module". Q-34P-8EY-5B7 now shows Hydatidiform mole (sp 95) and
Gestational trophoblastic neoplasia (kt 75 chapter) first, then med-mixed
"Learn this module", plus the son-gtn-rare concept lesson. The literal
job text (all srcPack ids as top-tier links) was built, blind-audited, and
**rejected**: srcPack is batch provenance, not item evidence, and showing the
whole pack scores 40% wrong (46/300 items worse, 0 better). Details below.

## 1. Measure — srcPack coverage (live links corpus: cache + bank v5)

- Live items 224,042; with non-empty `srcPack` 29,120 (13.0%), all also carrying
  `src.sn` + `fid`. 22 subjects affected, concentrated in ss-* super-specialties:
  ss-general-medicine 7,142/7,518; ss-infectious-diseases 2,811/3,034;
  ss-medical-oncology 2,723/3,111; ss-neurology 2,719/2,961;
  ss-rheumatology-immunology 2,393/2,683; ss-critical-care 2,188/2,406;
  ss-nephrology 2,137/2,409; ss-endocrinology 1,487/1,649; ss-cardiology
  1,185/1,357; ss-pulmonology 1,018/1,194; base subjects only trace amounts
  (medicine 129, dermatology 71, community-medicine 38). Overlays/PYQ: 0.
- 2,335 unique srcPack ids: 1,504 `kb-*`, 830 `sp-*`, 1 other. With the fixed
  resolver: 1,239 map to KB articles, 141 to clinical protocols
  (e.g. `kb-diabetic-ketoacidosis` -> protocol `diabetic-ketoacidosis`), 955
  unresolved (830 `sp-nbk*` external pack ids; 124 suffixed `kb-*` variants such
  as `kb-systemic-lupus-erythematosus-2`). Unresolved are logged, never guessed.

## 2. Implement — `tools/prep-links.mjs`

- `normKbId` now strips a bare `kb-`/`kb_` prefix, so `kb-hydatidiform-mole` ->
  `hydatidiform_mole` (existing longer prefixes unchanged; existing tests green).
- New `srcPackTargets` (+ `SRCPACK_MAX_KB = 3`): KB via `normKbId`, protocols via
  exact slug match, dedupe, unresolved + skipped (batch-context) reporting.
- `linkItem`: evidenced targets ride at 95/94/93 as via `sp` (exempt from the
  relevance and specific-link gates — they passed the item-evidence bar); trim
  lets them fill up to 3 KB slots; `clinical === false` still blocks protocols.
- `addTopicLinks`: with provenance-only shown links, the verified mapped module
  topic rides as the chapter row (`kt`, honest `ev`), and the subject lesson
  stays as "Learn this module". Any matcher/pipeline specific keeps the old
  suppression exactly (replaces topic and fallback).
- Build `reportText` carries a `srcPack:` line (items, links shown, skipped,
  unresolved count).

## 3. Oncology protocols — no counterpart to merge

`onco-links-1014` has zero diff vs `origin/main` (nothing landed, no
`briefs/onco-protocol-links.md`), so there was nothing to rebase. No duplication
by construction: srcPack protocol rows dedupe by `k:id` with existing links in
`put()`, and respect `MAX.pr`.

## 4. Precision audit — 300 random linked items, blind, $0

Method: seeded sample (seed 1014) of 300 linked items (77 with srcPack); all
shown kb/pr/dr rows before and after (833 stem+title pairs, system labels
hidden) judged wrong / related / correct in my own pass (no Anthropic API, no
OpenRouter spend); 7 rows unique to the final build judged freshly under the
same rubric. Reused verdicts only — no re-judging after unblinding.

| system | rows | wrong | related | correct | wrong% |
|---|---|---|---|---|---|
| before (origin/main) | 347 | 31 | 45 | 271 | 8.9% |
| literal srcPack-as-top-tier (rejected, not shipped) | 486 | 105 | 98 | 283 | 21.6% |
| shipped (gated srcPack + topic riding) | 364 | 32 | 52 | 280 | 8.8% |

- Literal rule, paired: 46 items worse, 0 better, +74 net wrong links,
  items-with-a-wrong 30 -> 74. srcPack is batch provenance: a JIA frequency item
  lists every JIA subtype, a tumour-localisation item sits in a migraine pack,
  an NVDRS item carries nipah. No item-text bar can both show GTN for Q-34P
  (named nowhere in the item) and hide batch siblings — so the literal rule
  cannot satisfy the owner's precision rule. Not published.
- Shipped: sp rows 36 — wrong 1 (2.8%), related 7, correct 28. Current specific
  links (before a/k/q/s, n=163) — wrong 7 (4.3%). sp is at least as precise.
  Items with a wrong: 30 -> 31 (one same-family borderline: NSTEMI article for a
  STEMI item, evidenced via "myocardial infarction"; arguable related). Zero-link
  items in sample: 0 -> 0 (sample was linked items; fallback coverage unchanged
  at 100% corpus-wide).
- Q-34P-8EY-5B7: before `med-mixed` lesson only; after Hydatidiform mole sp95,
  GTN kt75 chapter, med-mixed lt "Learn this module", son-gtn-rare lk80.

## 5. Build / publish / verify

- After-build: 202,277/202,277 usable linked (100.0%); 338,220 links shown
  (+14,078 vs before: kb +4,068, protocols +387, lessons +9,623, drugs 0);
  sp 11,096 shown; 73,638 batch-context ids skipped; 955 unresolved.
- Publish: `node tools/prep-links.mjs publish --out ~/prep-data/links/out`
  (token from `~/.config/stewardmd/cloudflare.env`, trimmed, never printed).
- Tests: `test/prep-links.test.mjs` 26/26 (5 new: bare-`kb-` mapping, gated
  mapper incl. JIA/misfit/DKA cases, linkItem integration, topic riding);
  links suites + coming-soon guard 61 run / 60 pass / 1 pre-existing skip / 0 fail.

## 6. UI compliance (standing rules)

All seven skill files read before the first edit; `pick-ui-library` N/A (no new
library — no UI code changed at all). This is a data-only change: the Know more
panel, its rows, tokens and palette (#071318 / #0D1D23 / #42CDB5) are untouched;
new `sp` rows render through the existing evidenced path and `ev: 0` rows
through the existing "Learn this module" path (verified in `prep-reason.js`).
No new components, states, motion, or copy. No visual change to screenshot.

## 7. Environment note

The Mac disk filled mid-job (ENOSPC); per the disk-cleanup skill I removed my
own superseded build dirs and ran `cleanup.sh --apply` (regenerable junk only),
freeing ~4 GB before rebuilding. Nothing source, git, worktree or app-data was
touched.

## Recommendation

Ask the content pipeline to stamp item-level (not batch-level) provenance: with
per-item sources the primary rule becomes safe and the skipped 73,638 ids turn
into links. Until then the gate stays.
