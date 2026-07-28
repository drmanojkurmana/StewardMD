# FollowCare AI — Phase 1 Completion Report

**Status:** Phase 1 is **built, reviewed by four independent gates, hardened, and merged to `main`** — and
remains **behind a default-OFF flag (`smd_followcare`), not enabled for any real patient.** This report is
the Phase-1 stop-and-report per the one-phase-at-a-time rule. It lists what shipped, what every review found
and how it was resolved, and the **decisions + provisioning that are yours** before go-live.

Commits `bdd0c995 → 681a6a04` (11 commits). Tests: **69 FollowCare unit tests + 126/126 repo, all green.**

---

## 1. What Phase 1 delivers

- **Deterministic Recovery Engine** + **9 disease pathways** (rules-as-data) + assessment + scheduling — the
  engine owns every clinical decision (server-authoritative; a tampered client cannot fake a "green").
- **Patient portal** (`/followcare?t=…`) — login-free, install-free, mobile-first, accessible, **English + Hindi**.
- **Doctor module** — enroll → patient link, recovery board by escalation, timeline, revoke, mark-reviewed, delete.
- **Messaging** — real MSG91/Twilio/Gupshup behind one interface (honestly OFF until configured) + daily
  scheduler (due links, reminders, missed-check-in escalation, retention sweep).
- **Governance** — deny-all Firestore rules for the 5 PHI collections; provisioning runbook; reusable DPDP + HIPAA reviewer agents.

Safety invariants held throughout: the AI never changes therapy or diagnoses; patients never install the app;
no PHI in URLs/tokens/logs; a red flag always routes to urgent in-person care.

---

## 2. Reviews & resolution

Four independent adversarial reviews ran (server-security, clinical-safety, DPDP Act 2023, HIPAA-readiness).
**Every code-level, decision-free finding was fixed and regression-tested.** Findings that need a product,
legal, or ops decision are listed in §3.

### Server security (4 findings — ALL FIXED, committed `da057873`)
| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | High | Patient could answer not-yet-due days → fast-forward the schedule, self-recover, self-clear a red | `currentDueDay` returns only a currently-due day; portal/submit refuse future days; `peakEscalation` keeps a red visible until clinician ack |
| 2 | High | Double-submit/retry could double-advance the schedule | Day pinned to the due day + episode update guarded on `updateTime` (optimistic concurrency) |
| 3 | Med | Decrypted first name returned in the token-gated portal reply | Portal reply is now name-free; greeting is generic |
| 4 | Med | `enroll` trusted a client `hospitalId` (cross-tenant write) | Hospital resolved server-side from a uid-keyed doctor→hospital binding |

### Clinical safety (2 Critical + 5 Important — ALL FIXED, committed `e91828f6`)
| # | Sev | Finding | Fix |
|---|---|---|---|
| C1 | **Critical** | A disease red-flag question left blank was scored "no flag" → a deteriorating patient (e.g. bleeding dengue) could go Green | Engine blocks Green + flags review whenever ANY red-tier question is unanswered; **server** now enforces the emergency + answerable red-flag questions (not just the browser) |
| C2 | **Critical** | Hypoglycaemia 55–70 mg/dL produced no flag (only ≤54 caught) | Added glucose ≤70 → Orange (ADA Level-1); ≤54 stays Red |
| I1 | Important | 0–3 clinical scales were rendered 0–10 in the portal → mis-calibration (3/10 tripped a RED) | Scales carry their real max; portal renders 0..max, engine scores n/max |
| I2 | Important | Emergency-probe enforcement lived only in the browser | Server rejects any submit missing `overall`/global-probe/answerable red-flag |
| I3 | Important | Missed-check-in escalation was disease-agnostic + slow (3 misses) | Pathway-specific: dengue after 1 miss, AKI/HF after 2, others 3 |
| I4 | Important | An escalated episode stopped receiving check-ins (could strand) | Scheduler now monitors active **and** escalated episodes |
| I5 | Important | `needsReview` / low-confidence not surfaced | Persisted on the episode + shown on the board |
| — | Advisory | worseDir dead; dengue byDay vs schedule; SpO₂ floor; absolute-weight false-red | All wired/aligned |

### DPDP Act 2023 & HIPAA — code-level fixes (FIXED, committed `681a6a04`)
Erasure endpoint (clinician + patient-portal opt-out + owner) · configurable retention sweep · consent
attestation + `consentVersion` at enroll · minor→guardian routing · MRN dropped (minimisation) · content-free
clinician push · phone redaction in the delivery-error log · audited clinician reads · token-secret min 32.

**HIPAA verdict: no Critical findings** — ePHI is encrypted at rest + fail-closed, links are cryptographically
verified, IDOR/tenant-isolation is sound, no PHI in URLs/tokens/logs.

---

## 3. Go-live gate — what is YOURS (decisions + provisioning)

FollowCare must **not** be enabled for real patients until these are resolved. None are code bugs; they are
product/legal/ops decisions plus the external dependencies from the provisioning runbook.

### Decisions I need from you
1. **Data-Fiduciary vs Processor role** for FollowCare, and the **patient privacy notice / consent copy**
   (legal wording). The current `privacy.html` says StewardMD is a *Processor* and "not for patients" — that
   contradicts direct-to-patient messaging and must be reconciled. *(DPDP C1/I1)*
2. **Consent model**: is the doctor-attestation (built) sufficient for launch, or do you want a patient-facing
   consent gate on first portal open? *(DPDP C1)*
3. **OTP second factor** on the patient link (built as token-only; the Phase-0 design specified token + phone
   OTP). Add it, or formally accept the residual risk with the current compensating controls (name-free page,
   45-day expiry, revocable)? *(DPDP I3 / HIPAA I-4)*
4. **Retention period** value for `FOLLOWCARE_RETENTION_DAYS` (mechanism built, default OFF). *(DPDP C3)*
5. **Escalation hand-off** semantics — is "escalated = clinician now owns the patient, keep monitoring" (what I
   built) what you want, or should it pause monitoring? *(Clinical I4)*
6. **Pediatric scope** — enable the minor/guardian path, or gate minors out entirely for launch? *(DPDP C4)*

### Provisioning (from `docs/followcare/phase1/PROVISIONING.md`)
- `FOLLOWCARE_TOKEN_SECRET` (≥32) + `FOLLOWCARE_PHI_KEY` (base64 32B).
- One SMS provider + **India DLT** entity/sender/template registration (**only you can do this**).
- Deploy the Firestore rules; add the daily cron → `/api/followcare/admin/run-scheduler`.
- **Processor DPAs / BAAs** with the SMS provider + Cloudflare + Google; pin the Firestore region; prefer an
  India-processing SMS provider. *(DPDP I4 / HIPAA I-3)*

### Before enabling (each is a hard gate)
- **Clinician sign-off** on all 9 pathways' thresholds against your local protocols.
- Real end-to-end test (enroll → SMS → portal → board → escalation push) on a device.
- Legal review of the notice/consent + DPA/BAA posture.

---

## 4. Recommendation

The engineering, clinical-logic, and security/privacy **mechanisms** for Phase 1 are complete and independently
reviewed. The remaining work to go live is **governance + provisioning + clinician sign-off**, not code. I
recommend we (a) settle the six decisions in §3, (b) you provision the secrets + SMS/DLT, (c) get clinician
sign-off on the pathways, then enable behind the flag for a small pilot.

**Phase 1 is complete and I am stopping here for your review and approval before any Phase 2 work.**
