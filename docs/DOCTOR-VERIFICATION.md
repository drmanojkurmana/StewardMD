# Doctor Verification Gate

Restricts StewardMD to **registered doctors**. After Google/Apple sign-in a user must
verify once: upload the medical registration certificate → Gemini reads it → cross-check
the **live NMC register** → on pass, set the Firebase custom claim `verified:true`
(mirrors the existing `pro` claim). Guest access is removed.

## Files

| File | Role |
|---|---|
| `functions/api/verify-doctor.js` | POST endpoint. Reuses `functions/_fbauth.js` `verifyFirebaseToken`; Gemini extract → live NMC check → sets `verified` claim via a service account; records the doctor + reg-no→uid map in KV (`CASES_KV`/`GHIS_KV`, keys `icu:doctor:*` / `icu:reg:*`); emails support on manual-review cases. |
| `verify.js` | Additive client module (never edits `app.js`), loaded after `account.js`. Shows a full-screen blocking overlay until the `verified` claim is present; handles cert upload. Mirrors `account.js` (`SMD_PRO` → `SMD_VERIFY`). |
| `index.html` | `#verifyGate` overlay markup + `verify.js` include; guest UI hidden; account-gate copy updated. |
| `account.js` | `GUEST_MAX_PER_DAY = 0` — reuses the existing cap machinery to remove guest access. |

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
