# StewardMD — lifecycle emails (welcome → verify → Pro)

**Date:** 2026-07-18 · **Status:** approved, implementing

## Goal
Turn a bare sign-in into an engaged, verified, converting user via three email touchpoints.
All copy leans on the app's **real capabilities + the launch promo** (Pro free until 15 Sep 2026).
**No invented growth numbers** (medical-app liability). Emails only ever go to the token-verified
own address (no open relay), and each is **send-once**.

## Touchpoints
1. **Welcome** — on first sign-in (Google/Apple). Rewrite of `emailWelcome`. Shows the *whole* app,
   drives one CTA: **verify your medical registration** (unlocks the ℞ generator + verified badge).
2. **Pro upsell (on verify)** — the moment verification succeeds, chain `emailProUpsell` after
   `emailVerified`. Highest-intent moment.
3. **Pro upsell (day-3)** — for people who signed in but never verified / never converted. A nightly
   job emails anyone whose first sign-in was ≥3 days ago, who has no **real** Pro claim, and who
   hasn't already been upsell-emailed.

## Emails (`functions/_email.js`)
- **`emailWelcome(env,{email,name})`** — REWRITE. Grouped feature tour: Clinical engine (differentials,
  risk scores, calculators, drug-interaction checks, antimicrobial stewardship/antibiogram — offline),
  MaiK AI (reasoning, imaging, scribe, evidence), Ward tools (Ward Sync, Lab Watch 24/7, ICU/Ward
  dashboards, case sharing), ℞ generator, offline KB. Primary CTA: "Verify your medical registration"
  with a one-line why (unlocks ℞ + badge; cert OR reg-no + photo ID).
- **`emailProUpsell(env,{email,name,promoActive,promoUntilStr})`** — NEW. What Pro unlocks (MaiK AI
  unlimited, Ward Sync, Lab Watch 24/7, team collaboration, cross-device sync + share-case, full drug
  DB) vs always-free. During promo: "you're on free Pro until <date> — here's how to keep it." CTA →
  open app / paywall. Uses the existing `sendBranded` shell + `btn()`.

## Triggers
- **`functions/api/welcome.js`** — after `emailWelcome`, upsert the lifecycle record (set `firstSeen`
  only if absent). Idempotent.
- **`functions/api/verify-doctor.js`** + **`functions/api/verifications/[[path]].js`** — after the
  existing `emailVerified(...)` call, `emailProUpsell(...)` (guarded: only if `!record.upsellAt`), then
  stamp `upsellAt`/`verifiedAt`.
- **`functions/api/lifecycle/[[path]].js`** — NEW. `POST /lifecycle/run` (X-Admin-Token via `ownerOK`,
  same as `/watch/run`). Scans `lifecycle:u:*`; for each: if `firstSeen ≤ now-3d`, `!upsellAt`, and
  `getUserClaims(uid).pro !== true` → `emailProUpsell`, stamp `upsellAt`. Returns `{scanned, emailed}`.

## Data (KV — `MAIK_KV` || `GHIS_KV`)
`lifecycle:u:<uid>` → `{ email, name, firstSeen, verifiedAt?, upsellAt? }`
- `firstSeen` write is idempotent (never reset).
- `upsellAt` is the send-once guard shared by the on-verify and day-3 paths (natural dedup: a verified
  user emailed on verify is skipped at day-3).
- "real Pro" = the actual `pro` custom claim (NOT the promo) — during the promo most users have no real
  claim, so they still get the upsell, framed as "keep your free Pro."

## Cron wiring (`worker/src/index.js` + `worker/wrangler.jsonc`)
The `stewardmd-api` Worker already pings Pages endpoints on cron with `X-Admin-Token`. Add a daily ping
to `POST https://stewardmd.in/api/lifecycle/run` (piggyback the existing `30 5 * * *` daily branch).
Deploying the Worker requires the approval-gated `deploy-worker` GitHub Action (path-filtered to
`worker/**`) — or a direct `wrangler deploy` from `worker/`.

## Non-goals / YAGNI
No A/B testing, no open/click tracking beyond Resend's own dashboard, no per-user scheduling engine
(one nightly sweep), no drip beyond these three, no invented stats.

## Verification
- `node --check` all touched functions.
- Live: `POST /api/lifecycle/run` with the admin token → `{scanned, emailed}`; confirm a test record
  emails exactly once (second run emails 0). Welcome/verify emails visible as Delivered in Resend.
