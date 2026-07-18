# FundX Stage 3 — Workflow Timing Sheet

*Print one per operator session. Advisory-only tool; no PHI — anon operator/session IDs only.*

| Field | Value |
|---|---|
| Operator ID (anon) | ____________ | Cohort: ☐ nurse ☐ junior/general doctor ☐ optometrist |
| Session ID | ____________ | Date/time: ____________ |
| Device / build | ____________ | Lens: ☐ 20D ☐ 28D ☐ other ____ |
| Sensitivity | ☐ med (default) ☐ other ____ | Observer: ____________ |

**Timing definitions:** *time-to-first-cue* = start → first on-screen guidance; *time-to-capture*
= start → auto-capture (blank if no capture); *corrections* = number of distinct guidance cues
issued; *outcome* = captured / no-capture / crash.

## A. Model-eye practice (learning curve)

| Attempt | Scenario | Time-to-first-cue (s) | Time-to-capture (s) | Corrections | Outcome | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

## B. Live-eye captures

| Attempt | Eye (OD/OS) | Scenario (S1–S7) | Time-to-capture (s) | Corrections | Outcome | Image ID | Notes |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

## C. Session rollup (from telemetry `summary()` + sheet)

| Metric | Value |
|---|---|
| First-time success (first real attempts): captured gradeable / total | ______ / ______ = ____% |
| Trained success (post-warm-up attempts): captured gradeable / total | ______ / ______ = ____% |
| Median time-to-capture (model) | ______ s |
| Median time-to-capture (live) | ______ s |
| Median corrections/attempt | ______ |
| False captures (saved but ungradeable/decoy) | ______ |
| Never captured? | ☐ no ☐ **yes (P0 for §7 crit 5)** |

**Telemetry exported:** ☐ JSON: ____________________  ☐ dev-frame CSV: ____________________
`summary()`: captureRate ____ · median captureMs ____ · top rejectReason ____

**Outcome:** ☐ complete ☐ incomplete (why: ____________)  Operator improved 1→10? ☐ yes ☐ no
Tester signature: ____________  Reviewed: ____________
