# Doctor Verification Gate

Restricts StewardMD to **registered doctors**. After Google/Apple sign-in a user must
verify once: upload the medical registration certificate → Gemini reads it → cross-check
the **live NMC register** → on pass, set the Firebase custom claim `verified:true`
(mirrors the existing `pro` claim). Guest access is removed.

## Files

| File | Role |
|---|---|
| `functions/api/verify-doctor.js` | `POST` verifies a cert (Gemini → live NMC → sets `verified` claim, records doctor + reg-no→uid map in KV `icu:doctor:*`/`icu:reg:*`, emails support on manual-review). `GET` returns the caller's own status (for the account panel). Reuses `_fbauth.js` + `_fbadmin.js`. |
| `functions/_fbadmin.js` | Shared Firebase-admin helper: mints a service-account OAuth token (Web Crypto) and sets custom claims. Used by verify-doctor + the admin endpoint. |
| `functions/api/verifications/[[path]].js` | **Admin** endpoint (token-gated like `updates`): `GET` list by status; `POST /approve` (set claim), `POST /reject`. Lists KV prefix `icu:doctor:`. Secret `VERIFY_ADMIN_TOKEN`. |
| `admin/verifications.html` | Owner UI to review pending doctors and Approve/Reject (mirrors `admin/updates.html`). |
| `verify.js` | Additive client module (never edits `app.js`). Two surfaces on one overlay: **forced gate** (blocks unverified) + **Account & Verification panel** opened from the sidebar (shows provider + email ↔ reg no ↔ status; upload if unverified). Injects the menu item via the `SB.open` wrap (home.js pattern). Mirrors `account.js` (`SMD_PRO` → `SMD_VERIFY`). |
| `index.html` | `#verifyGate` overlay (account summary + upload + close/done) + `verify.js` include; guest UI hidden; account-gate copy updated. |
| `account.js` | `GUEST_MAX_PER_DAY = 0` — reuses the existing cap machinery to remove guest access. |

## Admin

Open `https://stewardmd.in/admin/verifications.html`, paste the `VERIFY_ADMIN_TOKEN`, and
review **Pending** doctors (auto-verification could not match them against NMC). Approve →
sets their `verified` claim; Reject → marks rejected. Set the secret:
`npx wrangler pages secret put VERIFY_ADMIN_TOKEN --project-name stewardmd`.

## In-app account panel

Sidebar menu → **Account & Verification** opens a panel showing the linked account
(Google/Apple/Mobile) ↔ registration number ↔ status. Unverified users get the upload
option there too (in addition to the forced gate at sign-in). Mobile/phone sign-in is
labelled "Mobile" and slots in once phone auth is added — no panel change needed.

## Secrets (Cloudflare Pages)

```bash
npx wrangler pages secret put GEMINI_API_KEY            # Google AI Studio (aistudio.google.com/apikey)
npx wrangler pages secret put FIREBASE_SERVICE_ACCOUNT  # Firebase console → Service accounts → generate key; paste JSON
npx wrangler pages secret put RESEND_API_KEY            # resend.com (manual-review emails)
# optional: SUPPORT_EMAIL (default support@stewardmd.in), FROM_EMAIL
```
KV: reuses the existing `CASES_KV` (or `GHIS_KV`) binding — no new binding needed.

## Team bypass during rollout

`verify.js` → `VERIFY_ALLOWLIST` (owner/test emails) are treated as verified client-side so
the team can test without a scanned certificate. `BETA_VERIFY_ALL` is a master bypass, kept
`false`. Remove/trim these before public launch and rely on the claim.

## Decision logic

```
Gemini looks_valid && confidence ≥ 0.4 && regNo present
  && NMC searchDoctor(regNo) returns a record
  && extracted name agrees with NMC firstName (token overlap)   → VERIFIED (claim set)
else / NMC unreachable / low confidence                         → PENDING_REVIEW (email support)
reg no already bound to a different uid                         → REJECTED
```

## Test

- NMC reachable: `curl -sk ".../getDataFromService?service=searchDoctor" -H "Referer: https://www.nmc.org.in/information-desk/indian-medical-register/" -H "Content-Type: application/json" -d '{"registrationNo":"112487"}'`
- Positive: sign in, upload the owner's certificate (`APMC/FMR/112487`) → ✓ verified, claim set, overlay clears.
- Negative: name/reg mismatch → "under review" + email to support@stewardmd.in.

## Note — server-side enforcement (follow-up)

The certificate check + custom claim are in place. Gating the per-user data Functions
(`functions/api/cases`, etc.) on `verified` is intentionally **not** enabled yet to avoid
locking out existing beta users mid-rollout. When ready, add a `verified`-claim check to
those Functions (they already verify the token via `_fbauth.js`).
