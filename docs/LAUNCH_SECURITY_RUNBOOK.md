# StewardMD — Pre-Launch Security Runbook (#4)

Go-live checklist to close the beta open-doors before opening to 1000+ real doctors with PHI.
**Do NOT run these mid-development** — several will lock you (and testers) out until accounts are
provisioned. Run top-to-bottom on launch day. Each item says WHERE + the verification.

Owner accounts to keep working throughout: `stewardmd.in@gmail.com`, `drmanojkurmana@gmail.com`
(grant them Pro + verified via the new **User access control** console before flipping anything).

## 1. Entitlement: stop "free-for-everyone"
- **Where:** `functions/_entitlement.js` — `proFromRequest` currently returns `{pro:true}` for every
  request (beta). Gate Pro on a real claim (`claims.pro === true`) / your billing source.
- **Verify:** a non-Pro account gets 402/needs-pro on Pro features; owner accounts (Pro claim) pass.

## 2. Doctor verification gate ON
- **Where:** `verify.js` — `BETA_VERIFY_ALL` (already `false` as of 2026-08-15) + `VERIFY_ALLOWLIST` empty.
  Keep it false. Confirm the NMC gate + the 7-day trial on-ramp both work in prod.
- **Verify:** a fresh account hits the verification gate; the live NMC cross-check + cert upload work.

## 3. Firebase App Check ENFORCED on all `/api/*`
- **Where:** App Check bridge exists (index.html) minting App Attest / Play Integrity tokens. Enforce
  server-side: reject `/api/*` without a valid App Check token (allow a short grace + the admin token).
- **Verify:** a raw `curl` to a protected `/api/*` (no App Check header) is rejected; the app works.
- **Note:** `/api/clientlog` + `/api/config` are intentionally public (telemetry/boot config) — keep
  them public but rate-limited (item 7).

## 4. Firestore + D1 security rules — least-privilege audit
- Every collection/table: a signed-in doctor can read/write ONLY their own + their consented patients'
  data; no open reads. Cross-check `firestore.rules` + the D1 access paths (queue, updates, FollowCare,
  Connect). Deny by default.
- **Verify:** attempt a cross-account read with a valid token for account A against account B's doc → denied.

## 5. Remove / gate dev bypasses
- `localStorage smd_verify_bypass` (verify escape hatch) — document as team-only; it's client-side and
  not a server boundary, so ensure the SERVER (App Check + claims) is the real gate.
- Dev "enable-everything" (3 owner accounts unrestricted) — confirm it's owner-email-scoped only.
- Wear `Demo.enabled` — already double-guarded (debuggable build + a global setting) → inert in release. OK.

## 6. PHI / secrets sweep
- Grep the codebase + Worker logs for PHI in URLs/logs/toasts and any leftover diagnostic `console.*`
  (several diagnostic logs were added during debugging this session — remove before launch).
- Confirm all keys are gitignored + outside the repo; **rotate** anything that touched a shared shell/log.
- `google-services.json` / `GoogleService-Info.plist` stay gitignored (client config, not a secret, but
  keep them out of git); preflight (`scripts/preflight.sh`) already guards their presence for builds.

## 7. Rate-limit the public endpoints
- `/api/clientlog` + `/api/config` are unauthenticated. Add a light per-IP cap (KV window) so a flood
  can't churn KV / inflate cost. The AI + Connect paths already have limiters (`_usage.js`,
  `_connect/enterprise/ratelimit.js`) — reuse the pattern.

## 8. Turn on the scale controls (built this session)
- **Min-version floor:** set `minBuild` in the owner console **Remote config** to your current native
  `versionCode`, so stale/dangerous builds are force-upgraded.
- **Scribe cost caps (optional):** Cloudflare env `SCRIBE_MODEL` / `SCRIBE_CAPS` (default off).
- **Crash telemetry + CI:** already live (#1, #2). Watch the console "Client errors" panel post-launch.

## 9. Coming-soon gate
- `_middleware.js` gates `/api/*` behind `APP_GATE_KEY` for the private beta. Decide keep-vs-remove for
  public launch; if removed, items 1–4 + 7 MUST be in place first.

## 10. Backups before go-live
- Enable scheduled Firestore + D1 exports (P1 backups item) and do one manual export + a restore drill
  BEFORE launch. Never open to 1000 doctors without a tested restore path.

---
Sign-off: run items 1–9, then #10, verifying each, before flipping the coming-soon gate off.
