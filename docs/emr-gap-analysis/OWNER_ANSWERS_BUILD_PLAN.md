# Build plan for the owner answers of 2026-09-14
Owner answers: top of HANDOVER_2026-09-14.md. Builders follow the common rules
(/Users/diwakarkumar/.claude/jobs/d1986003/tmp/common-brief.md). This Mac has 8 GB RAM: at most 3 writing builders
at once, targeted tests in builders, full suite once at merge by the orchestrator.

## Wave 1 (launched 2026-09-14 ~19:10 IST)
- d6-i18n-split (worker-sonnet): per-language portal files so Antigravity can translate without conflicts,
  language switch on every portal section, TRANSLATION_BRIEF_ANTIGRAVITY.md.
- fhir-r5-g6-g9-g10 (genius-opus): G6 Immunization, G9 Group/$export + POST + admin downloads, G10 Subscription
  create + $status, D9 R4B/R5 by fhirVersion MIME parameter (406 where not transformed).
- connectors-s2-s4-s5-s7 (genius-opus): pluggable payment gateway (Razorpay, Stripe, manual), payer/TPA registry
  (+ NHCX as far as verifiable), DICOMweb plug with test connection, Vertex as the PHI-approved AI provider.
- design-s3-s6 (genius-opus, docs only): S3 unified Ward Sync + WardSynQ phone app with push; S6 per-hospital ABDM.
- Muse muse/tidy-d2-g1: D2 dependency upgrades, G1 outbox status index, G15 tidy.

## Wave 2
- W2a d5-g5-withholding (opus): D5 B structured per-result withholding in patient copy / full discharge summary
  (each withheld item replaced by "withheld, ask your care team"; unverifiable free text withheld as a block; old
  releases still work; portal and chart preview identical). G5 chart Documents shows released versions.
- W2b opd-dept-settings (opus): D7 B per-department tokens in StewardMD OPD (queue.js, opd.html, board, SMS);
  D14 prefix required per issuing department; D13 recall no_show keeps the token (audited); D11 A per-hospital
  clinical settings template screen; D10 seed data items carry sign-off by Dr Manoj Kurmana, unsigned visibly
  marked and never silently active; D4 B group counts from a hospital-published snapshot (publisher, time, stale).
- W2c audit-g3-g12-g11 (opus): G3 chain the Firestore q_audit; G12 second anchor in Firestore (S1 bucket pending)
  checked with KV; G11 out-of-assignment reads (ward history, email-to-uid, clickable evidence); G4 live check.
- W2d ux-g2-g7-g8 (opus): G2 offline reconnect conflict review; G7 transfer stay history and past per-day beds;
  G8 webhook address edit and per-endpoint delivery log.
- W2e ux-g13-g14-d8 (sonnet): G13 keep scroll/focus; G14 tablet two-pane nursing panel; D8 WCAG 2.2 AA contrast
  and conventional clinical colour meaning, never colour alone.

## Wave 3
- S3 and S6 build phases from the design docs (S3_UNIFIED_WARD_APP_DESIGN.md section 6,
  S6_ABDM_INTEGRATION_DESIGN.md section 5). Start without owner answers: S3 P0 server alert path behind
  `wardsynq.alerts.push.enabled` (default off, escalation defaults labelled UNAPPROVED until D10 sign-off);
  S6 A1 ABDM hospital profile (new files only). Waiting on owner: S3 O1-O5, S6 A1-A5 (asked 2026-09-14).
- Design found live gaps: no critical result reaches a phone (empty channel lists), escalation only runs while
  someone uses the ward, existing ICU push shows value and bed on the lock screen, ward-offline.js not wired.
- Antigravity translations land on i18n/<code> branches; we test and improve (D6).
- D12: AWS migration around 2026-09-28; keep domain logic free of new Cloudflare coupling.
- Not doing: D3 paid pen test (no budget), S1 until the owner names the bucket.
