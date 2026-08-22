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
- [[ICU]] — the ICU flagship workstation
- [[FollowCare]] — post-discharge recovery intelligence
- [[KardiQ X]] — ECG interpretation + Learn atlas
- [[ThoreX]] — chest X-ray support
- [[FundX]] — smartphone fundus/retinal imaging
- [[CliniX]] — clinical learning + bedside skills for medical students (flag OFF, content pending R1)

## Cross-cutting
- [[OTA Updates]] — push-to-devices update system, self-hosted (Cloudflare R2 + admin console).
  PHASE 1 (server-only) built 2026-08-22; a rebuild of a system torn down once before — read it
  before touching this.
- [[StewardMD ID]] — the universal per-user SMD-XXXXXX handle (units, referrals, entitlements)
- [[Infra]] — Cloudflare, Firebase, signing, hosting
- [[Decisions]] — architectural decision log
- [[Roadmap]] — pending / deferred work

## The shape of the thing
The [[Medical Knowledge Base]] hierarchy (Harrison = disease reference → ICMR → guidelines → hospital
overlay) is a linked graph — Obsidian's model mirrors the app's clinical model. See [[Decisions]].
