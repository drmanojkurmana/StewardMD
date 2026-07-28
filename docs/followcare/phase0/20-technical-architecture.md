# FollowCare AI — Technical & Deployment Architecture
Phase 0 deliverable #20. Reuses StewardMD's Cloudflare + Firebase stack; adds only Queues, an SMS provider, an R2 bucket, and a D1 database.

## System diagram
```
                          ┌───────────────── Doctors / Hospital staff ─────────────────┐
                          │  StewardMD app (web PWA + Capacitor iOS/Android)            │
                          │  + FollowCare module (followcare.js, #followcareRoot)       │
                          └───────────────┬────────────────────────────────────────────┘
                                          │ Firebase ID token
                     ┌────────────────────▼─────────────────────┐        ┌──── Patients (no app) ────┐
                     │  Cloudflare Pages (stewardmd.in)          │        │  branded link → OTP →      │
                     │  static app (repo root) +                 │◀───────│  assessment (browser)      │
                     │  Pages Functions  functions/api/*         │  opaque│  functions/followcare/p/…  │
                     │   • /api/followcare/*  (doctor/patient/…) │  token └────────────────────────────┘
                     │   • reuse: _fbfirestore,_email,_usage,    │
                     │     callGemini, _nativepush, _watch, R2   │
                     └───┬───────┬───────┬───────┬──────┬────────┘
             Firestore◀──┘       │       │       │      └──▶ Workers AI / Vectorize (RAG, P2/P5)
             (PHI, real-time)    │       │       └──▶ R2 followcare-media (photos, PDFs)
                                 │       └──▶ D1 FOLLOWCARE_DB (msg log, analytics rollup)
                                 └──▶ KV (OTP, idempotency, cursors, rate limit)
                                          │ enqueue
                     ┌────────────────────▼─────────────────────┐
                     │  Cloudflare Queue  FOLLOWCARE_Q           │
                     │        │ consume (batch, retry, DLQ)      │
                     │  Consumer Worker → MessagingProvider ─────┼──▶ Resend (email)  [reuse]
                     │                                           ├──▶ SMS provider (MSG91/Gupshup/Twilio) [NEW]
                     │                                           ├──▶ WhatsApp Business (P4) [NEW]
                     │                                           └──▶ APNs/FCM/web push (doctor alerts) [reuse]
                     └───────────────────────────────────────────┘
   Cron: Worker scheduled() ── admin-token POST ──▶ /api/followcare/reminders/run ─▶ enqueue due/missed
```

## Components (reuse vs new)
- **Frontend:** in-app module (`followcare*.js/.css`, ThoreX template) + patient portal (`functions/followcare/p/[token].js` + branded static shell). Reuse `rds-*` design system, haptics, toast.
- **API:** Pages Functions `functions/api/followcare/[[path]].js`. Reuse `_fbfirestore`, `_fbadmin`, `_email`, `_usage`, `callGemini`, `_nativepush`/`_taskpush`, `_watch` patterns.
- **Async:** **NEW** Cloudflare Queue `FOLLOWCARE_Q` + consumer Worker (scale to 10k+ episodes; replaces inline `Promise.all`-in-cron).
- **Messaging:** **NEW** `_sms.js` + unified `MessagingProvider`; reuse Resend + push; WhatsApp interface (P4).
- **Data:** Firestore (PHI/real-time) + **NEW** D1 `FOLLOWCARE_DB` (log/analytics) + KV + **NEW** R2 `followcare-media`.
- **AI:** reuse `callGemini` + RAG + safety pattern; **NEW** Recovery/risk engine + pathways + conversation-state + i18n (see `17-ai-architecture.md`).
- **Cron:** **EXTEND** `worker/wrangler.jsonc` triggers + `worker/src/index.js scheduled()`.

## Deployment pipeline (reuse)
- **Pages (app + `functions/`)** auto-deploys on merge to `main` (git integration; repo root + functions). FollowCare module + portal + API ship this way.
- **Consumer Worker + cron changes** deploy via `.github/workflows/deploy-worker.yml` (production-environment gated). Queue/R2/D1 bindings added to `wrangler.jsonc`/`wrangler.toml` (`[env.production]`).
- **Firestore rules** deploy separately (`firebase deploy --only firestore:rules`) — a required step in the FollowCare release checklist.
- **Secrets** via `wrangler pages secret put` / `wrangler secret put`: `SMS_API_KEY`, `SMS_SENDER_ID`, `FOLLOWCARE_ENC_KEY`, queue/R2 bindings, branding defaults.
- **Asset versioning:** `?v=fcNNN`; `build-www.sh` auto-bundles root `followcare*.js/.css` into native.

## Environments & config
- Bindings declared under `[env.production]` (KV/D1 convention). Local dev via `.dev.vars` + `wrangler pages dev`.
- Feature flags: `smd_followcare` (master, default OFF) + sub-flags — safe, incremental rollout per the StewardMD reversible-change norm (recovery tag before merge).

## Monitoring & reliability (P1 basics → P4 enterprise)
- Delivery-log store + provider webhooks (send success/failure visibility).
- Queue depth / consumer errors / DLQ; API health; SMS/email failure counters; Firestore/D1 latency.
- Retries (queue) + idempotency (KV send-once) + channel fallback (SMS↔email).
- **P4:** daily backups, regional redundancy, DR drills, enterprise monitoring dashboards.

## Scalability
- Enrollment + assessment submit are O(1) writes; dashboards read tenant-scoped indexed queries (Firestore) + D1 rollups.
- Messaging fan-out is decoupled via the Queue → horizontal scale to the 10k+ concurrent-episode target (vs. today's ~300/run cron cap).
- No new always-on infrastructure; everything is serverless (Workers/Pages/Queues) — cost scales with use.
