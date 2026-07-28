# FollowCare AI — Messaging Strategy
Phase 0 deliverable #12. Channels, cadence, branding, delivery tracking — grounded in the StewardMD reuse audit (`00-reuse-inventory.md`).

## Channels & reuse posture
| Channel | Purpose | StewardMD status | Decision |
|---|---|---|---|
| **Email** | Branded enrollment + reminders + summaries | **`functions/_email.js` `sendBranded()` fully built** (Resend, verified `@stewardmd.in`) | **Reuse**; add hospital/doctor branding params + FollowCare templates |
| **SMS** | Primary patient reach (India), enrollment + reminders | **GAP — none today** | **Build** a provider module behind an interface (MSG91 / Gupshup / Twilio); India DLT-compliant sender-ID + templates |
| **WhatsApp** | Future primary (interactive, media, languages) | GAP | **Interface-ready now, implement Phase 4** (WhatsApp Business) |
| **Push (APNs/FCM/web)** | **Doctor/nurse** alerts + morning digest (not patients) | **`_apns.js`/`_fcm.js`/`_nativepush.js`/`_taskpush.js` fully built** | **Reuse** `sendNativeToAll` + `_taskpush.js` cadence/escalation |

**Provider abstraction (new, required):** a `MessagingProvider` interface `send(channel, {to, template, vars, hospitalId}) -> {ok, providerMsgId, status}` with `channelConfigured(env, channel)` capability gates — modeled exactly on the existing `_nativepush.js` dispatcher (`sendApns`/`sendFcm` behind one fan-out with uniform `{ok}/{prune}`). Channels are swappable; SMS provider is replaceable. This satisfies "everything replaceable / no parallel systems."

## Cadence (reuse the cron + send-once pattern)
Reuse `worker/src/index.js scheduled()` + the `api/lifecycle` **day-N sweep** + KV **send-once idempotency** (`_lifecycle.js`) pattern — the "Day 3 Recovery Check" is structurally identical to the existing day-3 upsell sweep.
- **Assessment due** → send on the disease template's scheduled dayOffset at the hospital's configured local time.
- **Missed assessment** → reminder at +Xh, +1 day (bounded, like `_taskpush.js` `RETRY_CAP_MS=24h`); then a **nurse task** (Phase 3); then doctor notification. Never silently drop.
- **Escalation messages** → immediate on Orange/Red (patient advice) + doctor push (reuse `_taskpush.js`).
- **Digest** → one doctor morning digest (Phase 3), reuse push + email.
- **Rate/quiet hours** → respect hospital timezone + quiet-hours; batch (`MAX_PER_RUN` like lifecycle).

## Message anatomy & branding (must add branding parameterization)
Current `_email.js shell()` is StewardMD-hardcoded (logo/teal/footer) with no per-hospital branding and no literal "Powered by StewardMD" — **must parameterize**. Every patient message carries, in order: **Hospital brand (primary) → Doctor name → purpose → action link → "Powered by StewardMD" (footer)**.

**SMS example (no PHI in body, opaque link):**
```
GITAM Hospital
Day 3 Recovery Check — Dr. Manoj Kumar.
Tap to complete (2 min): https://stewardmd.in/f/xR9k2p
Powered by StewardMD
```
Rules: **no PHI in SMS/URL** (no name/diagnosis) — opaque signed token only; OTP gate on open; STOP/opt-out handling; length-aware (single segment where possible); language per patient preference.

## Delivery tracking (must build)
No per-message log exists today (email returns `{ok}` only; no `opened`). **Build** a delivery-log store (KV keyed `fc:msg:<episodeId>:<msgId>` and/or a D1 `fc_messages` table) recording `{channel, to(masked), template, status: queued|sent|delivered|failed|opened, providerMsgId, ts, error}` + **provider webhooks** (Resend for delivered/opened; SMS provider DLR; WhatsApp status). Powers Phase 1 Module 12 (Messaging Logs) and Phase 3 Patient Communication Center.

## Security
Opaque tokens (no PHI in links); OTP before any content; masked recipients in logs; per-tenant rate limits (extend `_usage.js` keying with `hospitalId`); consent-gated (no messaging without recorded consent); STOP/opt-out + retention.

## Reuse-vs-build summary
- **Reuse:** Resend email engine; APNs/FCM/web push for staff; cron + day-N sweep + send-once idempotency; `_taskpush.js` escalation/reminder/tier-preference logic.
- **Build:** SMS provider module (India); WhatsApp channel (Phase 4); the unified `MessagingProvider` interface; hospital/doctor branding parameterization + FollowCare templates; delivery-log store + webhooks; patient opt-out.
