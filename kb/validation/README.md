# StewardMD — Clinical Validation Framework (Phase 6, QA only)

Validate StewardMD like a medical device: gold-standard cases replayed through the
**real deterministic engine**, compared to expected answers, with regression
protection and a KB completeness audit. **Adds no clinical features; changes no
reasoning-engine code.** Dev/Admin-only.

## Contents
- `cases.json` — the Gold-Standard Case Library (array; extensible to hundreds).
- `schema.json` — the case schema.
- `baseline.json` — accuracy baseline for regression protection (regenerate with `--rebaseline`).
- Runner: `test/run-case-validation.mjs` (headless replay + compare + dashboard + report).
- KB audit: `kb/tools/kb-completeness-audit.mjs` (KB vs Harrison entity index → completeness report).

## A case (see schema.json)
Human-readable clinical fields (age, sex, chiefComplaint, symptoms, physicalFindings,
vitals, labs, imaging, microbiology, cultures) **plus** two machine fields that drive
the replay:
- `findings` — a map of ENGINE finding-keys → true (the controlled vocabulary the
  reasoning engine scores; this is what is fed to `SMD_REASON.assess`).
- `expected` — `{ diagnosis, acceptableIds[], differentialIds[], investigations[],
  stewardship:{ tier, antibiotics[] } }` (the gold answer).

## Adding cases (supports hundreds)
Append objects to `cases.json` (or drop `*.json` case files into `cases/` — the
runner reads both). Use finding-keys from the engine vocabulary. Author `expected`
from the confirmed final diagnosis. Then run the runner; never merge a reasoning
change that regresses accuracy (see baseline.json).
