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

## Flipping ENFORCE on: BLOCKED on token permission (2026-10-16)

ENFORCE is NOT on. Production is still in shadow mode (unauthenticated module
fetch returns 200, verified 2026-10-16 after all attempts below), so no
student flow is broken.

Both available tokens lack Cloudflare Pages permission (API code 10000,
"Authentication error" on /accounts/{id}/pages/projects/stewardmd):

1. Local token (~/.config/stewardmd/cloudflare.env): 403 on the Pages API.
2. GitHub secret CLOUDFLARE_API_TOKEN: the bank-enforce workflow (PR #1698,
   choice fix #1699, both merged after clinix-ui passed) failed at
   `wrangler pages secret put` with the same code 10000. That token covers
   R2/Workers (OTA works) but not Pages.

Owner action (one of), then re-run the flip:

- Dashboard: Cloudflare > Pages > stewardmd > Settings > Environment
  variables > Production: add PREP_BANK_ENFORCE = 1, save, redeploy the
  latest production deployment. Or:
- Grant either token "Cloudflare Pages: Edit" on the account, then run:

    gh workflow run bank-enforce.yml -f enforce=enable

That sets the Pages production secret PREP_BANK_ENFORCE=1 (the gate reads
env.PREP_BANK_ENFORCE === "1") and retries the latest production deployment.
Flip off / rollback (immediate, if any signed-in flow breaks):

    gh workflow run bank-enforce.yml -f enforce=disable

(deletes the secret and redeploys; gate returns to shadow logging). Full
rollback: revert the bank-lock commits on main and redeploy.

After the flip, verify unauthenticated module/overlay/pyq/tests/links fetches
return 401, foreign Origin is refused, and a signed session fetch returns 200
private/no-store, before declaring enforcement live.

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
