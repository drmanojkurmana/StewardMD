---
tags: [moc]
---
# StewardMD — Home

Clinician-only medical decision-support app. **Mobile-only** (Capacitor 8; iOS + Android render the
local `www/` bundle, calling `stewardmd.in/api/*`). Buildless PWA (ES5 IIFEs, `?v=goldNNN` cache-bust).

## Modules
### AI
- [[MaiK]] — the clinical AI assistant (3-tier: KB engine → Vertex router → Gemini)
- [[MaiK Intent Firewall]] — clinician-only scope gate (allow-list)
- [[AI Control Center]] — usage engine: per-module caps, model switch, admin console
- [[Medical Knowledge Base]] — the KB / RAG brain + clinical content

### Clinical modules
- [[Scan-Meds and Drug Index]] — prescription/med scan, drug DB, interactions
- [[RxChoice]] — same prescribed therapy, four price choices over the same drug DB
- [[ICU]] — the ICU flagship workstation
- [[FollowCare]] — post-discharge recovery intelligence
- [[KardiQ X]] — ECG interpretation + Learn atlas
- [[RadioAnatome]] — cross-sectional CT/MRI atlas · [[RadioAnatome 3D]] — BodyParts3D 3D layer on the same ontology
- [[ThoreX]] — chest X-ray support
- [[FundX]] — smartphone fundus/retinal imaging
- [[CliniX]] — clinical learning + bedside skills for medical students (flag OFF, content pending R1)
- [[SURGX]] — SURGˣ Surgical Intelligence: notes, protocols, procedures, evidence, cases (flag ON for testers, content pending R1)
- [[WardSynQ]] — the Clinical OS built inside this repo: canonical clinical model, event bus, safety
  engine, and 16 hazards under an executable safety case. All three flags default OFF. **Nothing in
  it is clinically approved** — read the module note's status taxonomy before quoting any of it.

### Medical education
- [[NMC Logbook]] — the PG digital logbook required by PGMER-2023 5.2(v)-(vi): weekly e-logbook,
  monthly guide authentication, faculty verification, department oversight. **PG only** — UG/CBME
  deliberately not built. Every regulatory claim traces to `NMC_PG_LOGBOOK_REQUIREMENTS.md`.

## Cross-cutting
- [[OTA Updates]] — push-to-devices update system, self-hosted (Cloudflare R2 + admin console).
  PHASE 1 (server-only) built 2026-08-22; a rebuild of a system torn down once before — read it
  before touching this.
- [[StewardMD ID]] — the universal per-user SMD-XXXXXX handle (units, referrals, entitlements)
- [[Infra]] — Cloudflare, Firebase, signing, hosting
- [[Decisions]] — architectural decision log
- [[Flags]] — every feature flag: what is ON, what is OFF, and WHY (incl. the four that must never ship on)
- [[Roadmap]] — pending / deferred work
- **Handoffs** — session-spanning records, in `vault/handoff/`. Read the most recent before
  picking up a thread; they carry the open items and the temporary production values that must be
  reverted. Latest: `2026-08-25-three-days-maik-opd-quotas.md` (MaiK latency/streaming, OPD,
  quota + guest-identity fixes).

## The shape of the thing
The [[Medical Knowledge Base]] hierarchy (Harrison = disease reference → ICMR → guidelines → hospital
overlay) is a linked graph — Obsidian's model mirrors the app's clinical model. See [[Decisions]].
