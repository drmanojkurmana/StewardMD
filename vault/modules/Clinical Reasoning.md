# Dx My Patient / clinical reasoning

## Files and status

- `reasoning.js`: DX workspace, deterministic ranking, infection gates and shared SMD_REASON API. Also defines the shared SMD_AI transport; do not treat this as a UI-only file.
- `reasoning-workspace.css`: additive, scoped presentation layer loaded by index.html. Uses shared light/dark theme tokens.
- `home.js`: Dx entry chooser and patient import entry point.
- No new feature flag. UX changes are isolated on `codex/dx-reasoning-ux` pending approval.

## September 2026 workspace polish

User selected direction B, Guided Consult. Intake and differential use separate switchable panes with a centered reading column and violet accents. Existing missing-finding suggestions appear one at a time, with Present/add and Skip for now. The focused question sits before the case finding chips; case notes/tools and system browsing start collapsed so the primary interaction fits the phone viewport. The overlay is explicitly bounded to the dynamic viewport and uses compact phone chrome. Skips are session-only presentation state, never negative findings or ranking inputs; reset clears them and revisit restores them. No new clinical question-generation logic. All findings remain searchable; system browsing uses progressive disclosure.

Finding count, labeled inputs, 44px controls, keyboard-operable diagnosis disclosure and compare state, clearer score wording and suggestion verification guidance. Case-note drafts survive finding changes. Clear asks before discarding a populated case; programmatic DX.reset clears draft and skips. Search autofocus is desktop-only and does not scroll the intake out of view.

Clinical scoring, thresholds, treatment content, patient import and AI transport are not changed. Scores are ranking values, not calibrated disease probabilities. Findings currently represent positive entries, not a complete present/absent/unknown examination.

## Verification

- `node test/run-dx-workspace-ui.mjs`: real Chrome interaction checks, draft preservation, finding search/add/remove, keyboard disclosure, comparison, invariant ranking, reset and 320/390/1280px overflow checks.
- Set `DX_SHOTS=/tmp/stewardmd-dx-ux` for light/dark mobile and desktop screenshots using synthetic data.
- `node test/run-reason-api.mjs`: shared engine shape, purity, suggestions and readiness.
- `node --test test/maik-reasoning.test.mjs`: adjacent reasoning-provider validation regression.

## Suggested follow-up work (not implemented)

1. Explicit present/absent/unknown states, with validated engine semantics and backward-compatible saved cases.
2. Review extracted findings before accepting them, including original narrative evidence and edits.
3. Structured onset, duration and trajectory, incorporated only after clinical validation; do not infer a calibrated probability from current ranking scores.
