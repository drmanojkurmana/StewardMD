# Security Report (Phase 8 + 9)

_Two auditors: repo-wide secret sweep + deep API app-security (attacker perspective). A broad
security/privacy reviewer + red-team pass are still running and will be appended._

## Executive summary

- **Secrets: CLEAN.** No live API key, private key/PEM, password, token, or connection string in any
  source, client-shipped file, or across 2,668 commits of git history. **Nothing requires rotation.**
- **API: notably well-hardened.** Every clinician data endpoint derives identity from a **server-verified
  Firebase ID token** (never a client-supplied id) and gates PHI reads on ownership/membership. No
  missing-auth data endpoint, no cross-tenant IDOR, no forgeable/non-expiring PHI portal token, no
  unescaped untrusted HTML in the API.
- **One HIGH (client transport, H1):** the SknX + ThoreX *native* vision modules POST patient images
  **directly to raw Cloud Run URLs**, bypassing the authenticated edge proxy (which already exists but is
  unwired). This is a production-blocker for enabling those cloud engines, not a live API hole. Everything
  else is **defense-in-depth (Medium/Low).**

## Positively verified (no issue)

- **Portal/share tokens** (`_followcare.js:55-83`): HMAC-SHA256, per-episode, expiring (45d default),
  revocable (`tokenVer`), no PHI in the token; access always gated on the cryptographic verify.
- **FollowCare IDOR surface**: every route (`episode`/`comms`/`media`/`export`/`revoke`/`ack`/`erase`)
  enforces `ep.doctorUid === uid || ownerOK`; `/media` re-derives the episodeId from the R2 key.
- **XSS**: portal + doctor board escape all server text (`esc()`/`textContent`); `html:` sinks take only
  static SVG icons.
- **Firestore/D1**: parameterized (`.bind`), tenant-scoped `WHERE tenant_id=?`; `ORDER BY` allow-listed;
  RBAC derives the actor server-side and refuses forged superadmin rows.
- **SSRF**: onboarding fetches pass `assertPublicHttpsUrl` (blocks private/loopback/metadata/`.internal`).
- **Cross-user data**: `api/cases`/`watch`/`push` key all storage by the server-derived uid;
  `register-native` ignores any client uid.

## Findings

### MEDIUM

- **M1 - FollowCare photo upload size not enforced on actual bytes.**
  `functions/api/followcare/[[path]].js:211` -> `_followcare_comms.js:158-171` -> `followcare-comms.js:158-163`.
  The 15MB cap is derived only from the client `Content-Length`; if the client omits/understates it, the
  raw body streams to R2 with no server-measured cap (bounded only by the ~100MB platform limit). Any
  holder of a valid portal link can push oversized PHI blobs -> R2 cost + data-minimisation violation.
  **Fix:** reject missing/oversized `Content-Length` up front AND wrap `request.body` in a byte-counting
  TransformStream that aborts the R2 put past `PHOTO_MAX_BYTES`; treat `bytes == null` as rejection.

- **M2 - App-gate `authorise()` treats an empty `Origin` as allowed** (`[[path]].js:56-62`, shared by
  `_experimental`/`fundx`/`ai` gates). Not independently exploitable (every route still requires a
  verified `callerUid`), but it removes the gate as a layer for non-browser clients. **Fix:** drop the
  `o === ""` branch; require an allow-listed Origin / valid `X-App-Token` / Cf-Access header.

### LOW

- **L1 - Binary/CSV responses omit `X-Content-Type-Options: nosniff`** (`/media` stream L330-333, CSV
  export L148). No magic-byte check on upload. **Fix:** add `nosniff` + `Content-Disposition`; validate
  leading bytes on upload.
- **L2 - Owner one-click email action links never expire** (`verifications/[[path]].js:72-81,138-151`).
  HMAC-signed over `uid|action` with no exp/nonce -> a leaked link is a permanent replayable owner action
  (sets the `verified` claim). Plus a minor reflected `${email}` HTML sink (valid-signature-only).
  **Fix:** add `exp` to the signed payload + reject expired; escape `email`/`uid`.
- **L3 - Watch/ICU writes interpolate client `pid`/`taskId` into Firestore REST paths unsanitised**
  (`_icuwrite.js:72-127`). Membership checked only on `gid`; `pid`/`taskId` concatenated with no charset
  validation -> a unit member could steer a write to another doc path (blast radius limited to members).
  **Fix:** validate ids against `^[A-Za-z0-9_-]+$` or `encodeURIComponent` each segment.
- **L4 (secret hygiene) - `ios/App/App/GoogleService-Info.plist` is committed** despite the `.gitignore`
  "NEVER commit" policy. The values are **public-safe Firebase iOS identifiers** (no private key), so no
  rotation - but the policy is misleading. **Fix:** either `git rm --cached` it or annotate `.gitignore`.
- **L5 (secret hygiene) - owner emails in plaintext `wrangler.toml [vars]`** (`OWNER_EMAILS`). An
  allow-list, not a credential (server still requires a signed-in owner). **Fix (optional):** move to KV /
  keep only a hash to reduce targeting surface.

### Informational
- Public Firebase web config (`app.js:2`) + iOS config are the intended public identifiers, not secrets.
- `sknx-cloudvision.js:18` bakes a public Cloud Run URL (not a credential); auth is a runtime Firebase token.
- Connect DNS-rebinding SSRF is an accepted documented residual (`ssrf.js`); resolve-then-pin is the noted future mitigation.
- Portal rate-limit is coarse (1 req/2s per link+IP, KV best-effort) - fine given unguessable UUIDv4+HMAC tokens.

## Broad security/privacy findings (whole-app, client + edge)

### HIGH

- **H1 - Native SknX + ThoreX vision modules egress patient images directly to raw Cloud Run URLs,
  bypassing the authenticated edge.** `sknx-cloudvision.js:18` (+ `sknx-providers.js:14`), `thorex-net.js:26`.
  The captured skin/CXR image POSTs straight to `https://*.run.app/classify`; a Firebase token is attached
  "when present" but Cloud Run does not verify it. A correct authenticated proxy ALREADY EXISTS
  (`functions/api/sknx/[[path]].js:93-108`, `/api/sknx/classify` - verifies the token, gates the flag,
  rate-limits, forwards with a server-held key) and **KardioX already uses this edge pattern** - but the
  SknX/ThoreX clients don't wire to it. Mitigated today by: flag def-OFF/opt-in, HTTPS-only, consent gate +
  EXIF strip, and the ThoreX experimental-access gate - so it is NOT a live production hole, but it BLOCKS
  production enablement. **Fix:** point the client default endpoint at `https://stewardmd.in/api/sknx`
  (already deployed) + provision `SKNX_CLASSIFY_URL`/`SKNX_API_KEY` + close Cloud Run to unauthenticated.
  (This is the exact production-hardening path already coded + documented for SknX; apply the same to ThoreX.)

### MEDIUM (broad)

- **M6 - admin `ownerOK` trusts the JWT `email` claim without `email_verified`** (`_adminauth.js:16-36`).
  Mitigated (only google/apple providers configured) but fragile. **Fix:** require `email_verified===true`;
  prefer matching on allow-listed UIDs.
- **M7 - no CSP** on a PWA that renders untrusted, world-readable shared-case HTML (`_headers`, hand-rolled
  `sanitizeHTML` in `caseshare.js:21-40` is the only barrier). **Fix:** nonce-based CSP + a vetted sanitizer
  (DOMPurify) on the shared-HTML path.
- **M8 - public shared-case docs rely on client-side regex PHI redaction** before a 30-day world-readable
  write (`caseshare.js:126-132`). **Fix:** re-run redaction server-side / gate reads behind auth / shorten TTL.
- **M9 - server config files served at web root** - `_middleware.js` INTERNAL_FILE block omits
  `firestore.rules`, `storage.rules`, `firebase.json`, `ghis-proxy.js` -> `stewardmd.in/firestore.rules`
  discloses the full rule model. **Fix:** extend the block / add `.assetsignore`.

### LOW (broad)
- **L6 - pdf.js loaded from cdnjs without SRI** (`medlist.js:280`; local bundle tried first). Add SRI or drop the CDN fallback.
- **L7 - GHIS local dev proxy logs patient record numbers** (`ghis-proxy.js:129,159,195`) - local tool only; redact anyway.
- **L8 - site-access unlock cookie is a static path-derived hash** (`_middleware.js:33-52`) - gates only the marketing shell; low impact.

### Verified-good (broad audit)
Token verification (RS256 sig/aud/iss/exp) in all 3 verifiers; Firestore rules deny-by-default with strict
per-user isolation; AI proxies auth+CORS+rate-limit+no-body-logging+TEXT-only; Connect FHIR envelope-
encrypted per-tenant secrets + SSRF-gated + HMAC ingest + pseudonymized audit; logout fix terminates the
session; https-only transport, EXIF-strip before egress.

## Verdict

**No live production-blocking API hole.** Priorities: **H1** (route native vision through the authenticated
edge - blocks cloud-engine production enablement) and **M1** (upload byte-cap). **M2/M6-M9 + L1-L8** are
defense-in-depth / hygiene. Secrets clean (no rotation). Auth + tenant-isolation posture is strong.
Chain to `stewardmd-release-reviewer` before ship.
