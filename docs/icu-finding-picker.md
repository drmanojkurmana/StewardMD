# ICU Clinical Complaint Autocomplete + Structured Finding Picker

A fast, deterministic, **offline** clinical autocomplete for the ICU complaint/finding input.
Type natural clinician language → a grouped dropdown of matching structured findings → tap to add a
chip. Free text is preserved. This is **documentation only** — chips are **never** fed to the
reasoning engine and never change any scoring, ranking, or diagnosis.

## Where it lives

ICU dashboard → **Care Plan → Diagnosis** → a new **Structured findings** section with an
**＋ Add findings** button that opens a bottom-sheet picker (`openFindingPicker()` in `icu.js`).
Rendered as a modal sheet (not an inline dropdown) so results never overlap the bottom nav, the
camera FAB, or the MaiK sheet; `.icu-sheet` already respects `env(safe-area-inset-bottom)`.

## Architecture — a reusable vocabulary registry, separate from scoring

- **`clinical-vocab.js`** exposes `window.SMD_VOCAB` (`search` / `toChips` / `all`). It is a
  **curated** registry of ~90 findings mapping clinician language → **existing canonical engine
  finding IDs** (`cid`) where they exist, and marks concepts the engine does not yet score as
  `inReasoning:false` (`cid:null` → a `note:*` chip id). It is **deliberately separate** from disease
  scoring — search + display only, no engine coupling. Isomorphic (browser `window` + Node
  `module.exports`) so it is unit-testable, matching `clinical-nlp.js`.
- Deterministic **LOCAL** search only — `prefix > token-prefix > synonym > typo (Levenshtein,
  distance-gated)`. **NEVER AI** for autocomplete. Boosts: active workspace (`im` in ICU) + red flag.
  Ranking tiebreak on raw match quality so a clean prefix beats a red-flag/workspace nudge.
  Word-boundary matching only (so "ear" can't match inside "heart"). Query expansion (`b/l`→bilateral;
  strips `h/o`, `c/o`) and cue stripping (`no`, `without`, `possible`, `rule out`, …).
- Results are **grouped** by category (Red flags → Symptoms → Signs → Vitals → Labs → Imaging →
  History), top-8 visible with **Show more**. Red flags surface first and are **never hidden** across
  workspaces.

## Chips

Stored in a new patient-scoped top-level `findings: []` on `ICU_STATE` (sibling of `labs`/`vitals`/
`imaging`; not scored, not charted). Each chip:

```
{ canonicalFindingId, displayLabel, polarity: present|absent|possible,
  temporality: current|historical|resolved, source: manual_picker|extract,
  clinicianConfirmed: true, inReasoning, at }
```

- Dedupe by `canonicalFindingId`.
- A **▾ modifier** cycles 5 states → `{polarity, temporality}`: present `{present,current}`,
  absent `{absent,current}`, possible `{possible,current}`, history-of `{present,historical}`,
  resolved `{present,resolved}`. Color-coded (teal present / red absent / amber possible / muted note).
- **Compound** entries (e.g. "Headache with vomiting") add multiple canonical chips in one tap.

## Free text + Extract (review-first, never auto-add)

- **Add as note** appends the free text to the patient's complaints (kept verbatim).
- **Extract findings** runs the existing **deterministic, negation/temporal-aware** `SMD_NLP.extract`
  (LOCAL — *not* the network AI extractor) over the free text, mapped to vocab entries, and shows them
  as **reviewable** suggestions. Nothing is added until the clinician taps a suggestion. Negated
  findings ("no fever") are excluded.

## Safety / constraints held

- **Documentation only** — the picker never calls the reasoning engine and never sets a diagnosis
  (regression-tested: `SMD_REASON.assess()` output is unchanged after adding chips).
- **Local / offline** — no network, no AI for autocomplete; the Extract path uses the on-device
  deterministic extractor, so **no free text leaves the device** (no PHI egress).
- Does **not** modify: reasoning scoring/ranking, disease signatures, MaiK/RAG/provider, Ward Sync
  auth/ownership, ICU calculations/trends/imaging-correlation/discharge, or `app.js`.

## Tests

`test/run-icu-findpicker.mjs` (CDP): search precision / typo / shorthand / ranking-tiebreak /
word-boundary; red flags never hidden; canonical-ID mapping + grouping; button opens the modal;
grouped dropdown; tap → structured chip; dedupe; modifier cycle; remove; compound; Extract
(review-first, negation-safe, no auto-add); documentation-only (no scoring change); patient isolation.

## Deploy

`clinical-vocab.js` loaded in `index.html` before `icu.js`. Bumped `?v=gold269` (icu.js +
clinical-vocab.js) and `sw.js` CACHE `stewardmd-gold269`.
