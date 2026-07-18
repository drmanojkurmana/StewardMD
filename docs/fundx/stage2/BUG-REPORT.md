# FundX Stage 2 — Bug Report

*One per defect. Copy this template. **No PHI** — reference the anon session ID, never a patient
name; do not attach unredacted retinal images to a bug tracker without DPDP-approved handling.*

## Identity

| Field | Value |
|---|---|
| Bug ID | FUNDX-D2-________ |
| Date / time | ____________________ |
| Reporter | ____________________ |
| Linked session ID | ____________________ |
| Test case (D2-ACQ/OVL/FOC/EXP/GLR/MOT/CAP / other) | ____________________ |

## Severity & status

- **Severity:** ☐ **P0** safety/data (false capture, PHI/secret leak, crash-with-loss) — *halts testing*
  ☐ **P1** blocks a test on a target device ☐ **P2** degraded UX ☐ **P3** cosmetic
- **Status:** ☐ Open ☐ In progress ☐ Fixed ☐ Won't fix ☐ Cannot reproduce
- **Reproducibility:** ☐ Always ☐ Intermittent (___ of ___ tries) ☐ Once

## Environment

| Field | Value |
|---|---|
| Device model | ____________________ |
| OS version | ____________________ |
| App / build version | ____________________ |
| Lens (20D/28D/other) | ____________________ |
| Sensitivity | ____________________ |
| Network (on/off) | ____________________ |
| Provider active (mock/vertex/cerebras) | ____________________ |
| Flags (fundx / telemetry / dev / lens-confirm) | ____________________ |

## Description

**Summary (one line):**
____________________________________________________________

**Steps to reproduce:**
1. ____________________________________________________________
2. ____________________________________________________________
3. ____________________________________________________________

**Expected result** (cite the package acceptance criterion / CFG gate):
____________________________________________________________

**Actual result:**
____________________________________________________________

## Evidence

- ☐ Screen recording / screenshot — file: ____________________
- ☐ Dev frame CSV — file: ____________________ (frames around the failure)
- ☐ Telemetry JSON — file: ____________________ (`outcome`, `rejectReasons`, `trace`)
- ☐ Console / network log (redacted) — file: ____________________
- ☐ `/health?metrics=1` snapshot (if backend-related): ____________________
- Relevant metric values at failure: focus ____ exposure ____ reflection ____ motion ____ diagnostic ____ readiness ____ state ____

## Analysis (fill on triage)

- **Suspected area:** ☐ camera/WebView ☐ MediaPipe ☐ heuristics/CFG ☐ state machine ☐ capture/persist ☐ backend/provider ☐ permissions/lifecycle ☐ telemetry ☐ UI
- **Likely cause:** ____________________________________________________________
- **Proposed fix / CFG tune** (note: CFG calibration is expected; feature changes need approval):
  ____________________________________________________________
- **Regression risk / affected devices:** ____________________________________________________________

## Resolution

| Field | Value |
|---|---|
| Fixed in build/version | ____________________ |
| Verified by (retest session ID) | ____________________ |
| Date closed | ____________________ |

> **P0 rule:** any P0 bug halts Stage 2 for the affected path until fixed and re-verified. PHI or
> secret exposure halts **all** testing immediately and triggers the incident process.
