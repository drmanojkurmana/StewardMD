# LINKS-FINAL: Know more coverage back to zero unlinked, no wrong links

## Result

Fresh build, exactly as CI (`.github/workflows/links-floor.yml`):

```
node tools/prep-links.mjs fetch --cache /tmp/fresh-cache
node tools/prep-links.mjs build --cache /tmp/fresh-cache --out /tmp/fresh-out
node tools/prep-links.mjs gaps --out /tmp/fresh-out --fail   # exit 0
{"items":202673,"linked":202673,"unlinked":0}
```

Before (same sequence, this machine, 2026-10-14): 179,470 of 202,673 linked, **23,203 unlinked**
across 748 modules. After: **0 unlinked**, every subject at 100.0%.
(The 48,046 figure in the job brief came from an older live bank snapshot; the gap
shape was identical: modules with no own lesson and no resolved module topic.)

## Root cause: why the fresh build differed from the published v2 index

The published index was built with three inputs a fresh repo build does not have:

1. **API-confirmed verdicts** (`confirmed.json`, Haiku confirm stage) lived next to the
   output dir under `~/prep-data`, never in git. Without them, stem-only candidates
   (confidence 65) stay below the bar.
2. **The topic map was stale.** `prep/bank/topic-links.json` held 1,500 modules of which
   748 were empty ("no candidate") or still queued for Haiku. Modules added since
   (maikbook*, maikbook2, maikss*, maikfill*, gap1013*, maikpearl* overlays: 618 modules)
   had no map entry at all.
3. **Newer item formats were unread.** Generated items carry their explanation in
   top-level `kp`/`r`/`tg`, which `expText` never read, so stem+explanation
   corroboration (77) rarely fired for ss-* and overlay items.
4. Seven lesson files on disk (`med-ich`, `ped-diarrhoea`, `med-overdose`,
   `med-pesticides`, `med-envenomation`, `sur-shock-transfusion`, `mphar-interactions`)
   were missing from `prep/lessons/v1/index.json`, so their modules had no lesson.

## Fix (no Anthropic API used)

- `tools/prep-links.mjs`
  - `expText` now reads `kp`, `r[]` and `tg[]` as explanation text.
  - `addTopicLinks` accepts a mapped lesson (`entry.ls`) and a single lesson filed
    under the module as the topic lesson (`lt`).
  - New `moduleTopicFallback`: a module's own majority/corpus-dominant KB or protocol
    target becomes its chapter (`kt`) only under strict bars (at least 5 shown items
    and 40% of linked items with a distinctive-word overlap, or a corpus candidate in
    at least 12% of items at 1.5x the runner-up). Generic words (disease, disorder,
    management) never count as overlap.
- `tools/prep-links-topicmap-local.mjs` (new, deterministic, no API) resolves the
  committed topic map: name/head subset with distinctive words (one-word matches must
  be a whole title part), shared-words with at most one extra word and no
  acute/chronic or infection/neoplasm conflict, acronym disambiguation (single
  acronym, KB system, longest expansion), same-subject sibling lessons, and finally
  the subject's (or parent subject's) mixed rapid-review lesson as the broad chapter.
  Single-word alias matches were removed after spot-checking showed they caused
  every wrong pick. Result: 2,118 modules mapped, including all 618 overlay modules.
- `prep/lessons/v1/index.json`: the seven on-disk lessons above are now indexed.
- `test/prep-links-final.test.mjs`: the committed topic map covers every overlay
  set and module; `moduleTopicFallback` fails closed; `entry.ls` never links a
  lesson that does not exist.

## Spot check (200 random newly linked items)

Read stem + answer + first target for 200 randomly sampled newly linked items in
three rounds. Rejects found and fixed by rule, not by example:

- Round 1: Dry eye / Jet lag / Diabetes chapters for unrelated modules (generic
  words counted as overlap), Marine envenomation for general toxicology,
  Limb-girdle dystrophy for kidney transplant. Fix: generic words excluded,
  single-word alias matches dropped.
- Round 2: Thyroid membrane-transporter defect for cell membranes, ARVC for
  arrhythmias, genitourinary cancers lesson for kidney transplant. Fix: one-word
  matches must be a whole title part, shared candidates may carry at most one
  extra distinctive word, lesson matches need two shared words.
- Round 3: Atypical CML for AML (acute/chronic conflict was checked on filtered
  words), Enterokinase deficiency for Enterobacterales (6-letter prefix too
  loose), Soft Tissue & Bone Sarcoma for skin infections. Fix: conflict check on
  raw words, 7-letter prefix floor in the shared tier, infection titles never
  pick neoplasm articles.

Final round: no wrong specific links in the sample. Remaining chapter rows are
module topics (e.g. Meningioma for the CNS tumours module, whose title lists it
first) or explicit mixed rapid-review lessons for the subject, shown as topic
tier, never as the item's concept.

## Publish

Published with `tools/prep-links.mjs publish --yes` (token from
`~/.config/stewardmd/cloudflare.env`, trimmed) and verified with `verify`.
See the PR for the published version string and verify line.

## Tests

- `test/prep-links.test.mjs`, `test/prep-links-topics.test.mjs`,
  `test/prep-links-rematch.test.mjs`, `test/prep-links-final.test.mjs`: 38 pass, 1 skipped.
- `test/prep-lessons.test.mjs`, `test/prep-lessons-100.test.mjs`,
  `test/prep-reason.test.mjs`: 50 pass.

## Quality finding follow-up (2026-10-14): never a wrong link

A fresh build already reported 0 unlinked, but the sidecar carried weak specific
KB links: 142,280 items with a KB link, 69,927 whose top KB link was a specific
below 75 (45,248 explanation-only `e` at 55). Fix, no API:

- `gateSpecificLinks` (tools/prep-links.mjs): a specific kb/pr/dr link must pass
  a method floor (`e` >= 60, others >= 50) AND `entityOverlap` (a significant
  word of the title or aliases in stem, keyed answer, an option, or the
  explanation). Failures are capped below the floor; the module-level lt/kt
  target takes the slot. Cutoff derivation against the human (`a`) links as
  ground truth (matcher re-run with pipeline links stripped, 3,481 items):
  no method/score bucket reached 95% exact agreement (q82 87.8%, k92 66.9%,
  s77 77.0%, e55 46.0%, s65 23.7%), so score alone cannot certify a link and
  the overlap requirement is mandatory, with the suggested floors.
- `ktOk`: derived module-topic targets (topicKb majority/single-title guesses)
  must share a word or acronym with the module's own title or lesson title.
  Mapped topic-list entries stand as the module's verified list; when the
  module's own lesson covers an item, an unevidenced mapped article no longer
  rides along as a second article.
- The sidecar now emits only gated KB/drug/protocol links.

Before/after, same fresh cache, `gaps --fail` exit 0 both times
(202,673 of 202,673 linked; per-subject linked counts unchanged at 100%):

| Measure (sidecar top KB link) | Before | After |
| --- | ---: | ---: |
| Items carrying a KB link | 142,280 | 104,195 |
| Top KB specific below 75 | 69,927 | 10,099 (all at the >=50 floor, none `e`) |
| Explanation-only (`e`) top KB | 52,366+ | 0 |

Precision audit (300 random KB-carrying items, stem + target title judged by
google/gemini-3.8-flash via OpenRouter, a different model than the matcher;
spend under $0.50):

| Judge view | Before wrong | After wrong |
| --- | ---: | ---: |
| Strict (stem + article only) | 51/300 = 17.0% | 38/296 = 12.8% |
| Of which specific (non-kt) links | 41 (13.7%) | 12 (4.0%) |
| Explanation-only wrongs | 28 | 0 |

The <=2% wrong target is **not met** under the strict judge, and this is
reported rather than hidden: the remaining flags are almost all `kt` module
articles for mixed modules that have no lesson (e.g. a Mumps article for a
chickenpox item in a viral-exanthems module). Those articles are the module's
verified topic and are what keeps `gaps --fail` at 0 for modules with no
lesson and no evidenced specific; removing them would re-open unlinked items.
Specific-link wrongs fell from 13.7% to 4.0% and explanation-only wrongs to
zero; the residual specific flags are borderline related cases (a sign or an
associated feature named in the stem) plus five pipeline `a` stamps.
Closing the last gap needs per-subtopic articles/lessons for the mixed
modules, not a looser matcher.

Published: `tools/prep-links.mjs publish --yes` (token trimmed from
~/.config/stewardmd/cloudflare.env), version 2026-10-14.dd526c,
`verify: 2406 files ... (202673 of 202673 items linked): 0 bad`.

Tests: prep-links, prep-links-topics, prep-links-rematch, prep-links-final,
prep-lessons, prep-lessons-100, prep-reason: 91 pass, 1 skipped, 0 fail.
