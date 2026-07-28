# FollowCare AI — Analytics & White-Label
Phase 0 deliverables #18 (Analytics) + #19 (White-Label).

## Analytics (data → decision support)
Computed from the D1 rollup (`fc_episode_rollup`, nightly Firestore→D1) so dashboards/exports are fast and PHI-free at the aggregate layer.

### Core scores & KPIs
| Metric | Definition |
|---|---|
| **Recovery Score** | per-patient dynamic score from symptoms + adherence + trend + pathway (deterministic engine) |
| **Recovery Confidence** | High/Med/Low from input completeness/consistency |
| **Recovery Index** (hospital) | aggregate recovery health across active episodes |
| **Readmission Score/Risk** | Low/Moderate/High/Very-High per patient, with reasons (never a black box) |
| **Compliance** | follow-up completion %, assessment completion, missed rate |
| **Engagement** | message open/response rate, portal completion |
| **Adherence** | medication-taken % |
| **Recovery duration** | avg days to Recovered (by disease/dept) |
| **Doctor KPIs (private)** | follow-up completion, response time, engagement — **not public rankings** (patient complexity differs) |
| **Hospital KPIs** | recovery index, 7/30-day readmission, avg recovery, engagement, teleconsult conversion |

### Views (by phase)
- **P1:** basic hospital dashboard (active/completed/pending/high-risk/completion%/avg-days).
- **P3:** disease analytics (recovered%/avg-days/readmission/adherence per disease), department/hospital/executive/quality dashboards, **AI operational insights** (LLM narrates trends over rollups — "pneumonia recovery slowed; low antibiotic adherence correlates with longer recovery — review discharge counseling"), **Recovery Radar™** one-page morning brief.
- **P5:** population health, predictive readmission, Hospital Quality Index™, recovery-pathway optimizer, research workspace (de-identified, governed).

### Principles
Benchmarking is **against the hospital's own history** (this month vs last, trend over time), never named-hospital comparison without explicit agreement. AI **explains** rather than dumping graphs. Reasons always shown (explainable). Doctor metrics private + complexity-aware. Exports: PDF/Excel/CSV for QI meetings. All aggregate/de-identified; raw PHI stays role-scoped.

## White-label / branding
**Hospital brand is always primary; StewardMD is the "Powered by" credit.**
```
GITAM Hospital · Recovery Care
Powered by StewardMD
```
(Not "StewardMD, powered by GITAM.")

### Branding surfaces & reuse
- **Per-hospital config** (`followcare/{hospitalId}/config.branding`): logo, theme accent, footer, email/SMS sender ID, name. Reuse: doctor identity already captured (`users/{uid}/profile/self`: name, hospital, NMC reg via `verify.js`); hospital directory `hospitals-in.js`.
- **Patient portal header** = hospital logo (primary) + Dr name + NMC reg — the `prescription.js` letterhead pattern is the co-branded template.
- **"Powered by StewardMD"** footer = the MaiK dev-foot credit pattern (wordmark, dark-mode invert). This literal string is **new** (must be added to `_email.js shell()` params + portal footer).
- **Email/SMS** carry hospital + doctor branding (parameterized templates, see `12-messaging-strategy.md`).
- **Levels:** individual doctor (clinic branding) → hospital → enterprise hospital group (Phase 4 full white-label, own WhatsApp/email domain/sender ID).

### Enterprise white-label (Phase 4)
Hospital owns email domain + SMS sender ID + WhatsApp Business number; full theme; "GITAM Recovery Care · Powered by StewardMD"; per-tenant assets in R2/config. Provisioned via the onboarding portal (extends `hospitalRequests`).
