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

### Interop & compliance
- [[ABDM]] — national health-data exchange (ABHA, HIP/HIU, consent); read the V3 reconciliation first

## Cross-cutting
- [[Infra]] — Cloudflare, Firebase, signing, hosting
- [[Decisions]] — architectural decision log
- [[Roadmap]] — pending / deferred work

## The shape of the thing
The [[Medical Knowledge Base]] hierarchy (Harrison = disease reference → ICMR → guidelines → hospital
overlay) is a linked graph — Obsidian's model mirrors the app's clinical model. See [[Decisions]].
