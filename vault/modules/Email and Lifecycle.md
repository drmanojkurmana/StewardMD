---
tags: [module, cross-cutting, email, lifecycle]
status: live (transactional + welcome/upsell) · promo series OFF (PROMO_SERIES_ON) · phone OTP ON (PHONE_VERIFY_ON)
flag: PROMO_SERIES_ON (def OFF) · PHONE_VERIFY_ON (def ON) · smd_phone_verify (client, def ON)
---
# Email and Lifecycle

Every email StewardMD sends, the lifecycle record that decides who gets what, the unsubscribe path,
the promotional series, and the mobile-number OTP that reuses the FollowCare senders.

## Key files
- `functions/_email.js` — the component kit + `renderEmail()` shell + every transactional template.
  `sendBranded(env, {to, subject, title, subtitle, bodyHtml, preheader, kind, uid})`. `kind:"marketing"`
  + `uid` adds the unsubscribe button/link and `List-Unsubscribe` headers. An env carrying
  `__EMAIL_CAPTURE(opts)` captures instead of sending (previews, tests).
- `functions/_promo.js` — `PROMO_EDITIONS` (7), `promoEdition(env, id|index)`, `emailPromo()`.
- `functions/_pricing.js` — `dayPrices(env)`: per-day figures from the live `cfgPrice` amounts, rounded UP.
- `functions/_unsub.js` — signed token (`unsubToken`, `unsubUid`, `unsubUrl`); `UNSUB_SECRET` or `RESEND_API_KEY`.
- `functions/api/unsubscribe.js` — GET link page, POST one-click, `resub=1`.
- `functions/api/email-preview.js` — owner-only: `GET ?kind=` renders, `POST {kind,email}` sends. `?kind=list`.
- `functions/_lifecycle.js` — `lifecycle:u:<uid>` record: `firstSeen, verifiedAt, upsellAt, purgeWarnedAt,
  purgedAt, unsubscribedAt, promoIdx, promoAt, phone, phoneVerifiedAt` (metadata mirrors the sweep keys).
  `sendProUpsellOnce`, `decidePromo` (pure), `sendPromoNext`, `markUnsubscribed`, `markPhoneVerified`.
- `functions/api/lifecycle/[[path]].js` — nightly `/run`: upsell sweep, unverified sweep, promo sweep.
- `functions/_phone_otp.js` + `functions/api/auth/[[path]].js` (`phone-start`, `phone-verify`) + `phone-verify.js`.

## Which emails are what
| Email | Kind | Suppressed by unsubscribe |
|---|---|---|
| OTP, reset code, temp password, verified, verification failed, Pro active, day-5 removal warning, alerts | transactional | never |
| Welcome, Pro upsell (day 3 / on verify), promo editions | marketing | yes |

## Cadence
- Day 0 welcome (client `welcome-email.js` → `/api/welcome`). Day 3 Pro upsell (once). Day 5 removal
  warning, day 7 removal (unverified only). Promo: from day 5, every 4 days, 7 editions, only when
  `PROMO_SERIES_ON=1`.

## Gotchas
- **No em-dash in any email** (CLAUDE.md); `test/email-template.test.mjs` fails the build on one.
- **The logo URL must be a file that is actually served.** `mark-teal.png` is in the repo but 404s on
  stewardmd.in; `logo.png` (same mark, 368px) is live. Check with curl before switching.
- **Prices are never typed into copy.** Use `dayPrices(env)`; the promo sweep warms the billing cfg
  first so KV price overrides reach the emails.
- **Resend headers**: `payload.headers` carries `List-Unsubscribe` + `List-Unsubscribe-Post`; the
  footer link and the header point at the same signed token (pinned by test).
- `test/render-emails.mjs` writes every email as HTML + PNG (`OUT=… CHROME=…`) for a visual check.
- Phone OTP: 2Factor goes through `/API/V1/<key>/SMS/<10-digit>/<code>[/<template>]`, not the
  check-in TSMS template; other SMS providers get the code in `var2`. A WhatsApp OTP through the
  custom BSP needs `PHONE_OTP_WA_BODY` with the code as `{{link}}`.
