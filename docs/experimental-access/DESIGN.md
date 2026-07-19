# Experimental Access framework

A reusable **one-code / one-device** unlock system for beta features. FundX AI is the first
consumer; ECG AI, Ultrasound AI, Clinical Copilot, etc. plug in by adding a single registry entry
and generating codes — no system change.

Everything is **validated server-side** (mirrors the Pro entitlement rule in `_entitlement.js`: the
server is the source of truth, a client flag is never trusted).

---

## How it works (one paragraph)

An owner generates a cryptographically-random code in the admin console (`stewardmd.in/admin →
Experimental`). Only its **hash** is stored in Firestore — the plaintext is shown once and is
unrecoverable. A tester enters the code in the app (Settings → Experimental Features → FundX AI, or
the FundX tile). The server hashes it, atomically marks the code **activated**, and binds it to
`{ StewardMD account uid, device id, platform }`. The code is now dead; any other device or account
gets *"This code has already been used."* The app stores only a **signed activation token** (never
the code) and re-verifies it against the live record on every launch, so a remote revocation
disables the feature immediately.

---

## Architecture

| Layer | File | Role |
|---|---|---|
| Firestore REST | `functions/_fbfirestore.js` | get / atomic multi-write commit (preconditions) / query, via the existing service-account token (`datastore` scope). |
| Framework core | `functions/_experimental.js` | `FEATURES` registry, code gen, hashing, HMAC tokens, the activate/verify/revoke state machine. Pure helpers are unit-tested; I/O accepts an injectable store. |
| API router | `functions/api/experimental/[[path]].js` | App + admin endpoints, CORS, rate-limit. |
| Rules | `firestore.rules` | Explicit **deny-all** for `experimentalCodes` + `experimentalActivations` (server-only). |
| Admin UI | `admin/index.html` (`Experimental` pane) | Generate / Active codes / Activated devices / Revoke / Deactivate device / Delete expired / Analytics. |
| Client device id | `device-id.js` (`window.SMD_DEVICE`) | Stable per-device id (persistent UUID; upgrades to `@capacitor/device` if added). |
| Client framework | `experimental.js` (`window.SMD_XACCESS`) | Gate UI + activate/verify/status; stores only the signed token. |
| App integration | `home.js` | FundX tile + a "Settings → Experimental Features" entry route through `SMD_XACCESS.gate/openGate`. |

---

## Data model (Firestore, server-only)

`experimentalCodes/{hashedCode}` — **the doc id is `sha256(pepper + normalizedCode)`**, so validation
is one O(1) `get`:

```
feature, hashedCode, status (unused|activated|expired|revoked),
createdAt, expiry (ms|null), notes,
activatedAt, activatedByUID, activatedDeviceId, activatedDeviceModel, activatedPlatform,
activationId, revokedAt
```

`experimentalActivations/{activationId}` — fast per-device verification + revocation:

```
feature, uid, deviceId, platform, deviceModel, hashedCode,
status (active|revoked), activatedAt, revokedAt
```

---

## Security properties

- **Codes** are `crypto.getRandomValues` over an ambiguity-free alphabet (no `I O L 0 1`), format
  `FUNDX-8QK4-XM92`. Shown to the admin **once**; never stored in plaintext.
- **At rest** only `sha256(serverPepper + normalizedCode)` exists. High entropy + secret pepper →
  a DB dump reveals no codes. SHA-256 (not bcrypt) is correct here: codes are high-entropy so they
  can't be brute-forced, and deterministic hashing is what makes lookup-by-id possible.
- **Single-use is exactly-once.** Activation is an atomic Firestore commit: the code update is guarded
  on its `updateTime` and the activation record is created with `exists:false`, in one all-or-nothing
  write. Concurrent redemptions → one wins, the rest get *"already used"*.
- **Device binding.** Activation records `{uid, deviceId, platform}`; the code dies instantly. Same
  device + same account re-entering the same code is idempotent (re-issues the token); any other
  device/account is rejected.
- **Local storage** holds only a **signed HMAC token** (`EXPERIMENTAL_TOKEN_SECRET`), never the code.
  Startup + every open re-verifies against the live record → revoked/expired locks immediately;
  offline → the cached token is trusted and re-checked when back online.
- **Revoke / deactivate device.** Revoking an activation sets it **and** the code to `revoked`. The
  code stays consumed forever (activation only ever accepts `unused`); the tester is issued a fresh
  code for the new device.
- **Rate-limited** per identity + IP on activate (defence in depth; guessing is already infeasible).
- **Server-side compute enforcement (not just UI).** The protected resource — the FundX AI compute
  endpoints `/api/fundx/{vision,clinical}` — requires a valid activation token (`X-XA-Token`, verified
  against the live record via `checkActive`) or an owner login before running inference. Enforcement
  is ON by default; `EXPERIMENTAL_ENFORCE_FUNDX="0"` is a kill-switch for migration. The client sends
  the token automatically (`fundx-providers.js`). So the one-code/one-device gate genuinely restricts
  the beta compute — a spoofed client cannot reach it.
- **Firestore rules** deny all client access; only the service account (which bypasses rules) reads
  or writes these collections.

---

## API

App (gate: `X-App-Token` / allowed `Origin`; a Firebase ID token in `Authorization` gives the uid):

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/experimental/features` | — | `{ features }` |
| POST | `/api/experimental/activate` | `{ feature, code, deviceId, deviceModel, platform }` | `{ ok, token, deviceModel }` or `{ ok:false, error, message }` |
| POST | `/api/experimental/verify` | `{ feature, deviceId, token }` | `{ active, reason? }` |
| POST | `/api/experimental/status` | `{ feature, deviceId }` | `{ active, token? }` (restores after reinstall) |

Admin (`_adminauth.ownerOK` — owner Google login):

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/experimental/admin/generate` | `{ feature, expiry, notes }` | `{ ok, code (ONCE), id }` |
| GET | `/api/experimental/admin/codes?feature=` | — | `{ codes }` |
| GET | `/api/experimental/admin/activations?feature=` | — | `{ activations }` |
| POST | `/api/experimental/admin/revoke` | `{ activationId }` | deactivate a device (code stays consumed) |
| POST | `/api/experimental/admin/revoke-code` | `{ id }` | kill a code by its hash id |
| POST | `/api/experimental/admin/delete-expired` | `{ feature? }` | `{ removed }` |
| GET | `/api/experimental/admin/analytics?feature=` | — | `{ analytics }` |

User-facing messages are exactly: **"Invalid or expired code."** and **"This code has already been used."**

---

## Adding a new beta feature

1. Add one line to `FEATURES` in `functions/_experimental.js`, e.g.
   `ecg: { id: "ecg", label: "ECG AI", prefix: "ECG", blurb: "12-lead interpretation" }`.
2. (Client) add a title in `experimental.js` `TITLES` and a Settings button + `onUnlock` in `home.js`.
3. Generate codes for `ecg` in the admin console. Done — no schema or endpoint change.

---

## Deployment / configuration

**Environment variables** (Cloudflare Pages → Settings → Environment variables — production):

| Var | Purpose |
|---|---|
| `EXPERIMENTAL_CODE_PEPPER` | secret pepper mixed into the code hash. **Rotating it invalidates all outstanding codes.** |
| `EXPERIMENTAL_TOKEN_SECRET` | HMAC key for activation tokens. Rotating it forces every device to re-verify (they auto-restore via `/status` if still bound). |
| `EXPERIMENTAL_APP_TOKEN` | *(optional)* extra `X-App-Token` accepted from the app; the `Origin` gate already covers the native/web app. |
| `EXPERIMENTAL_ACTIVATE_DAILY_CAP` | *(optional, default 30)* per-identity/IP activate attempts per day. |
| `EXPERIMENTAL_ENFORCE_FUNDX` | *(default: enforce)* set to `"0"` to disable the server-side beta gate on `/api/fundx` (e.g. while migrating existing testers onto codes). Owners always bypass. |

Already present and reused: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, a KV binding
(`MAIK_KV`/`CASES_KV`/… for rate-limit), `OWNER_EMAILS`.

**Firestore rules** — deploy separately: `firebase deploy --only firestore:rules`. No composite index
is required (admin lists use single-field equality filters only).

**Debug bypass** (decision: Xcode/adb debug installs open FundX without a code; **production always
requires one**). The only automatic path is a native **debug** build setting `window.SMD_NATIVE.debug
= true` (one line in the native layer). The `?xadev=1` / `localStorage.smd_xa_dev` opt-in is honoured
**only on a non-production, non-native origin** (a localhost dev server) — never on the production web
app or a release native build, so a curious end user can't self-unlock at `stewardmd.in/?xadev=1`. A
debug build that needs the *compute* (not just the UI) must sign in as an owner or activate a real
code (the server gate is separate from the client bypass).

**Native rebuild** — the app serves the bundled `www`, so a native rebuild is required for the app to
pick up `device-id.js` + `experimental.js` and the gated FundX entry.

---

## Tests

`test/experimental.test.mjs` (44 assertions) covers code gen (format / entropy / ambiguity-free),
normalize + hash (determinism, pepper dependence), token sign/verify + tamper, the `decideActivation`
state machine (every branch), and the full lifecycle against an in-memory Firestore mock that honours
the same atomic-commit + precondition semantics: generate → activate → single-use → device binding →
idempotent same-device → verify → reinstall restore → revoke (code stays consumed) → admin
lists/analytics/delete-expired → sign-in/device guards.
