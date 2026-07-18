# FundX Stage 3 — Safety Event Report

> FundX is **advisory only**; a clinician reviews every case and makes the final decision, which
> is the primary safeguard. **Any patient harm, or any unsafe advisory acted upon, is a P0 event:
> stop the affected testing, file this report, and notify the IEC per protocol.** PHI or secret
> exposure halts **all** testing immediately.

*One report per event. No PHI — describe clinically without identifiers; reference anon
session/scan IDs.*

## Identity

| Field | Value |
|---|---|
| Event ID | FUNDX-S3-SAFE-________ |
| Date / time | ____________ |
| Reporter (anon) | ____________ |
| Linked session / scan ID | ____________ |
| Device / build / lens | ____________ |

## Classification

- **Type:** ☐ Patient harm/discomfort during imaging ☐ Near-miss ☐ Unsafe AI advisory (acted upon)
  ☐ Unsafe AI advisory (caught by clinician) ☐ Scope breach (autonomous-diagnosis framing)
  ☐ PHI/data exposure ☐ Secret/key exposure ☐ Device malfunction ☐ Other: __________
- **Severity:** ☐ **P0** (harm / PHI / secret / crash-with-loss — **halt**) ☐ P1 ☐ P2 ☐ P3
- **Error code (from §6 guide):** ____________
- **Actual or potential harm:** ☐ actual ☐ potential/near-miss

## Description

**What happened:**
________________________________________________________________

**What the operator/clinician was doing (context):**
________________________________________________________________

**Was an AI advisory involved?** ☐ no ☐ yes → suggestion summary: ____________________
**Did anyone act on it before clinician review?** ☐ no ☐ **yes (workflow breach)**

## Immediate action taken

- [ ] Testing stopped for the affected path ☐ / all testing ☐ (PHI/harm)
- [ ] Patient assessed / cared for by on-site clinician
- [ ] Data secured (no PHI in telemetry confirmed; any exposed secret rotated)
- [ ] Study lead notified
- [ ] Reported to IEC/ethics committee (date: ____________)

## Causality assessment (FundX relatedness)

☐ Unrelated ☐ Unlikely ☐ Possible ☐ Probable ☐ Definite — rationale:
________________________________________________________________

## Root cause & corrective action

- Suspected cause: ____________________________________________
- Corrective action (note: feature changes require approval; CFG calibration is expected): ____________
- Linked bug report ID (if system): ____________
- Re-verification session ID: ____________

## Resolution

Resolved date: ____________  Verified by: ____________  Testing resumed: ☐ yes ☐ no

> **Program rule:** Stage 3 acceptance requires **0 safety events attributable to FundX**. An open
> P0 blocks progression to Stage 4/5.
