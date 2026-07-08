# ICU Imaging Import + Clinical Correlation — phased plan

Two owner tickets ("Ward Sync Imaging Import + AI Differential Assist" and "Imaging + Lab
Clinical Correlation Assistant") delivered as **dependent focused PRs**, each behind a feature
flag + git recovery point. Recovery tag before this work: **`pre-icu-imaging`** (on `main`,
post-#295). Reversibility: flag `smd_icu_imaging` (default ON) + `?icuimaging=0` kill-switch.

## Inspection findings that shaped the design (verified in code)

- **Storage**: adding `imaging: []` as a new top-level `DEFAULT_STATE` key inherits owner+patient
  scoping for free (persistence, per-patient roster, cloud `/api/cases`, backfill, reset,
  account-switch wipe). Sibling array → `labs.trends[]`/`vitals[]` charts untouched. Own cap
  (`MAX_IMAGING=200`) protects the single localStorage blob.
- **Ward Sync radiology** (`ghis-ward.js` → `/api/ghis/radiology` + `/radiology-report`): exposes a
  **single free-text blob** per report + study title + date + reporter. The proxy also exposes
  `testName`/`orderDate`/`doctor` (richer than the design doc noted). **NOT exposed**: structured
  modality, separated findings/impression, body region, ordering dept, indication, **PDF/image
  links**. → normalize modality from the title, parse sections client-side (raw always preserved).
  The existing `importPatientReports` is *lossy* (drops resultid/date) — Phase 1 pulls straight
  from `/radiology` + `/radiology-report`. Auth model unchanged.
- **Reasoning engine has no embeddings/vectors**; retrieval is lexical substring + tf-idf + rule
  scoring, and imaging concepts are almost entirely absent from the finding vocabulary. So Phase 3
  correlation must NOT add imaging finding-keys (that's a golden-rebaseline ranking change — out of
  scope). Instead: map imaging concepts to *existing* finding keys with clinician tap-to-confirm →
  `SMD_REASON.assess()`; AI synthesis via the de-identified `StewardRAG.buildPackage` grounding path
  for the narrative. **Deterministic engine stays the diagnostic authority; nothing auto-ranks.**
- **MaiK AI** reused untouched: new backend route reuses `callGemini` + `checkQuota`/`recordUsage`;
  caller runs `window.SMD_redactPHI` on free text (the RAG whitelist does not scrub inside allowed
  string fields).
- **External-evidence** retrieval IS feasible via the existing allowlisted `functions/api/updates`
  FDA-RSS template — but split to **Phase 4** (needs a trusted-guideline host allowlist decision).

## Phase 1 — Ward Sync Imaging Import + Imaging Notes (SHIPPED; deterministic, no AI)

- `imaging[]` store + `MAX_IMAGING` cap; `ICU.ingestImaging` (manual) + `ICU.ingestWardImaging`
  (batch, content-hash dedup by reportId+date+text, never overwrite).
- `ghis-ward.js`: `fetchImaging(patientId)` (full-field raw records) + `fetchImagingIntoICU`;
  `loadIntoICU` now auto-imports imaging alongside labs (flag-gated, non-blocking).
- Modality normalizer (CT/CECT/MRI/MRCP/US/Doppler/X-ray/Echo/Endoscopy/Other) → filter buckets;
  best-effort section parser (Indication/Technique/Findings/Impression/Recommendation), raw always
  preserved, "Parsed — verify" badge.
- **Deterministic critical-term scan** with light negation guard ("no free air" does NOT flag) →
  "Potential urgent imaging finding — verify & escalate" banner. Keyword triggers *review only*,
  never a diagnosis.
- Imaging Notes view (Documents ▸ Imaging): collapsible cards, filters
  (All/CT-MRI/US/X-ray/Cardiac/Endoscopy/Reviewed/Unreviewed), empty state, hide/unhide, manual
  entry + annotate. Reviewed / added imaging flows into the Daily ICU Summary
  ("IMPORTANT IMAGING").
- Flag `smd_icu_imaging` (default ON, `?icuimaging=0` kill-switch); `gold258` cache-bust.
- Test: `test/run-icu-imaging.mjs` (22 checks) + screenshot-verified mobile/desktop.

## Phase 2 — AI Imaging Assist (planned)

"Summarize imaging" with the **clinician choosing** AI-summary *or* deterministic-extract per use;
critical-term flag ALWAYS deterministic; strict de-id (`SMD_redactPHI` + de-identified context
only); structured 9-part output + mandated safety wording ("suggestive of…", never "confirmed").
One new `/api/ai` route (reuse `callGemini`/`checkQuota`) + one `SMD_AI` client method.
Add-to-note/discharge/reasoning (concise approved summary only). Flag-gated.

## Phase 3 — Imaging + Lab Clinical Correlation Assistant (planned)

Staged evidence pipeline: local extraction → compact de-identified packet → KB match via
`SMD_REASON.assess()` (existing finding keys + clinician confirm) → AI synthesis only when needed
(Quick vs Deep modes) → clinician review → optional advisory use in reasoning (never alters
ranking). Evidence-hashed client cache for token control. "Clinical Correlation" card. Advisory only.

## Phase 4 (optional) — External trusted-evidence fallback

`/api/evidence` allowlisted guideline retrieval (mirrors the `updates` FDA-RSS template), opt-in
only, its own flag. Requires the trusted-host allowlist decision.
