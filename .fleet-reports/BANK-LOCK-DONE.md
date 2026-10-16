# BANK-LOCK-DONE: PrepNucleus MCQ bank locked behind login + app proof

Status: gate implemented and merged (PR #1652, fail-open client fix #1673). This
report covers the enforcement rollout. Enforcement result is appended after the
flip is verified on stewardmd.in.

## What was already on main (verified 2026-10-16)

- `functions/_prep_bank_gate.js`: Origin allowlist (stewardmd.in, www,
  capacitor://localhost, https://localhost, ionic://localhost, localhost dev),
  per-session HMAC proof (10 min key minted server-side after Firebase/Cf-Access
  auth, bound to user id + device id + app version, 60 s timestamp window, KV
  nonce cache), signed image URLs (HMAC, 5 min), rate limits via `_ratelimit.js`
  `hitLimit` (120/min, 2,000/h, 10,000/day per user), enumeration flag
  (>30 module files/min flags the account 24 h), hashed user ids in logs,
  attestation TODO hook `verifyPlatformAttestation` (Apple App Attest / Play
  Integrity not wired; web proof + Origin is the current guarantee).
- `functions/api/prep/bank/[[path]].js`: auth runs before any R2 read; gated
  responses are `private, no-store` (images `private, max-age=300`) with
  `Vary: Authorization, Origin`; public only for lessons/cards, image-credits,
  health. Guard: every bank path is classified public or gated.
- `functions/api/prep/session.js`: POST mints the session key; requires allowed
  Origin + signed-in user.
- `prep-bank-client.js` + callers (prep.js, prep-pyq.js, prep-ids.js,
  prep-reason.js): signed fetches, in-memory only; service-worker cache name
  carries `banklock1` (old caches cleared on update); "Questions need a
  connection" state in prep.js. Lessons, KB and pearls keep working offline.
- Tests: `test/prep-bank-gate.test.mjs` (20 tests: 401 no token, token-only
  refused, foreign Origin 403 with no CORS, valid proof 200, replay 401, stale
  timestamp 401, image sign/expiry, 429 limits, enumeration flag, shadow mode,
  guard tests) and `test/prep-bank-client-failopen.test.mjs`. Both pass locally
  (2026-10-16, node --experimental-test-module-mocks).

## Rollout (owner authorization 2026-10-14 20:55 + 21:00)

- OTA: `gh workflow run ota-publish.yml` run 38863257479, published version 484
  at commit fc2e3e3e8 (live via /api/ota/check). The signed client is live.
- Signed-in production probe (pre-flip, shadow mode): throwaway Firebase user
  minted a session (200), fetched a module (200, private/no-store) and signed
  an image URL (200). Test user deleted afterwards.
- Browser test in this sandbox: not run (no Chromium binary, sandbox forbids
  local listen). The protocol-level probe above covers session mint, signed
  module fetch and image signing against production; clinix-ui on the PR covers
  the browser suite.

## Flipping ENFORCE on

The local Cloudflare token in ~/.config/stewardmd/cloudflare.env has no Pages
permission (API 403 on pages/projects), so the flip runs through GitHub:

    gh workflow run bank-enforce.yml -f enforce=enable

That sets the Pages production secret PREP_BANK_ENFORCE=1 (read by the gate as
env.PREP_BANK_ENFORCE === "1") and retries the latest production deployment.
Flip off / rollback:

    gh workflow run bank-enforce.yml -f enforce=disable

(deletes the secret and redeploys; gate returns to shadow logging). Full
rollback: revert the bank-lock commits on main and redeploy.

Older app versions without the signed client lose MCQ access until they update
to OTA 484 or later.

## Honest limits

Nothing stops a signed-in user copying what is on screen (screenshots,
accessibility services, rooted devices). This stops bulk download and casual
scraping: no anonymous reads, no curl with a bare user token, per-user caps and
enumeration flagging. Lessons and KB content are NOT covered by this change and
remain public/offline by design. Next steps (not built): per-user watermark in
explanations, native attestation (App Attest / Play Integrity) behind the
existing hook, device attestation before session mint.
