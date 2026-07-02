# StewardMD — Gold-standard validation library (500 cases)

**Where the cases live**
- `kb/validation/cases/gc_001.json … gc_492.json` — 492 per-case clinician records (one JSON per case).
- `kb/validation/cases.json` — 8 seed archetype cases.
- Total = **500** cases across 16 specialties.

**Each case** (full clinician record): presenting complaint · history · examination · vitals · labs · imaging · microbiology · differentials · final diagnosis · society-level citations · stewardship · contraindications · edge cases · expected MaiK / next-questions / investigations / confidence · `findings` (engine inputs) · `expected` (diagnosis + acceptableIds + differentialIds + stewardship) · regression assertions · `review` (all `clinicianApproved:false`).

**How to browse**
- **Visual dashboard** → open `docs/validation/gold-cases-dashboard.html` in any browser (every case, pass/fail, confidence, top-3).
- **Markdown table** → `docs/validation/gold-cases-report.md`.
- **Raw data** → `docs/validation/gold-cases.json`, or the per-case files in `kb/validation/cases/`.
- **On GitHub** → browse `kb/validation/cases/` in the repo tree.

**Regenerate the dashboard after edits**
```
node test/serve.mjs "$PWD" 8902 &
BASE=http://localhost:8902/ node test/run-case-validation.mjs   # writes dashboard.html + cases-report.{md,json}
```

**Phase reports**: `kb/validation/M2-PHASE1..4-REPORT.md`.
