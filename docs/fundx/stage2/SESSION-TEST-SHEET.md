# FundX Stage 2 — Device Session Test Sheet

*Print one per device/session. Pair with `DEVICE-VALIDATION-PACKAGE.md`. No PHI on this sheet —
use the session ID, never a patient name.*

## Header

| Field | Value |
|---|---|
| Session ID (anon) | ____________________ |
| Date / time | ____________________ |
| Tester | ____________________ |
| Device model | ____________________ |
| OS version | ____________________ |
| App / build version | ____________________ |
| Device tier (flagship/mid/budget) | ____________________ |
| Lens used (20D / 28D / other) | ____________________ |
| Sensitivity (low/med/**med**/high) | ____________________ |
| Target (model eye / live eye) | ____________________ |
| Consent obtained (if live eye) | ☐ yes ☐ n/a |
| Network (on / off — MediaPipe test) | ____________________ |

## Pre-flight (all must be ✅)

☐ Build+version recorded ☐ Camera usage string present ☐ Motion usage string present
☐ MediaPipe loads locally ☐ Battery ≥50% / not Low-Power ☐ Storage free
☐ FundX ON ☐ Telemetry ON ☐ Dev overlay ON ☐ Lens-confirm OFF
☐ Inspector connected ☐ `/api/fundx/health` ok ☐ Telemetry baseline noted

## Compatibility & permissions

| Check | Pass | Note |
|---|---|---|
| Overlay opens from Home/Records | ☐ | |
| **Rear** camera opens | ☐ | |
| Preview **inline** (no fullscreen/black) | ☐ | |
| MediaPipe local load (network off) OR graceful fallback | ☐ | |
| Orientation permission prompt → rotate cue (deny = no block) | ☐ | |
| Guidance fps ≥ 15 (dev overlay: ______ fps) | ☐ | |
| Camera **released** on background | ☐ | |
| Camera **deny** path fails safe (message, no crash) | ☐ | |
| Permission **revoke** mid-life handled | ☐ | |
| No crash / white-screen this session | ☐ | |

## Lens (power-agnostic)

| Check | Pass | Note |
|---|---|---|
| Capture works with lens used, no config change | ☐ | |
| Second lens power works, same settings (if tested) | ☐ | |
| **No lens-power prompt** / no block on "lens detected" | ☐ | |
| No false capture from field-of-view difference | ☐ | |

## Test cases

| ID | Test | Pass | captureMs / metric | Reject reasons | Note |
|---|---|---|---|---|---|
| D2-ACQ | Image acquisition → saved scan (all fields) | ☐ | ______ | | |
| D2-OVL | Guidance overlay + state progression + cues | ☐ | | | |
| D2-FOC | Autofocus — focus metric > 0.55 when sharp | ☐ | focus ______ | | |
| D2-EXP | Exposure — in band, gated (min 0.50) | ☐ | exp ______ | | |
| D2-GLR | Glare — cue + refuse capture (>0.40) | ☐ | refl ______ | | |
| D2-MOT | Motion — cue + no fleeting capture (>0.35) | ☐ | motion ______ | | |
| D2-CAP(a) | Capture fires on good view (diag ≥0.62, sustained) | ☐ | qAtCap ______ | | |
| D2-CAP(b) | **0% false-capture** on decoy/inadequate | ☐ | | | |

## Telemetry captured (attach files)

☐ Telemetry JSON exported — filename: ________________________________
☐ Dev frame CSV exported — filename: ________________________________
☐ `summary()` — captureRate ______  median captureMs ______  top reject reason ______
☐ Device metrics (Instruments/Profiler) — fps ______ peak mem ______ thermal ______ battery Δ ______
☐ `/health?metrics=1` — provider ______ errors ______ avg latency ______ cost ______

## Bugs found this session

| # | Severity (P0–P3) | One-line summary | Bug report filed? |
|---|---|---|---|
| 1 | | | ☐ |
| 2 | | | ☐ |
| 3 | | | ☐ |

## Session outcome

☐ **PASS** — all acceptance criteria met, no open P0
☐ **FAIL** — see bugs above (device blocked until fixed)
☐ **PARTIAL** — note which tests deferred and why: ________________________________

Tester signature: ____________________   Reviewed by: ____________________
