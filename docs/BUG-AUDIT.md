# StewardMD — Bug & Security Audit

_Date: 2026-07-02 · Scope: full repo (frontend JS, Cloudflare Pages Functions, Worker, Firestore rules, test harness)_

This is the result of fetching the repo, running every runnable test suite, and
reading the app + backend end-to-end. The good news: the clinical reasoning
engine is well-tested and **every reasoning/KB/ICU regression suite passes**.
The problems are concentrated in the **cloud storage / API auth layer**, where
there are two real data-exposure bugs, plus a batch of smaller correctness and
tooling issues.

---

## How to read this

Severity is about *impact if left as-is in production*:

- **P0 – Critical**: patient data (PHI) can leak, or cross-user corruption.
- **P1 – High**: security weakness or a bug that breaks a real workflow.
- **P2 – Medium**: correctness / robustness issues worth fixing.
- **P3 – Low**: hygiene, portability, polish.

---

## P0 — Critical (fix before any real clinical use)

> **Status update:** #1, #2 (the `/api/cases` half) and #3 are **FIXED** on this
> branch — `/api/cases` now verifies a Firebase ID token (or Cf-Access email)
> server-side and stores every case under a per-user key. Verified end-to-end:
> tampered/expired/wrong-audience tokens are rejected and users cannot read or
> delete each other's cases. The `/api/ai` origin `endsWith` bypass is also
> hardened. See "Fixes applied" at the bottom.

### 1. ICU cloud cases have **no per-user isolation** — shared global storage (PHI leak + mutual overwrite)  — ✅ FIXED
`functions/api/cases/[[path]].js`

Every ICU case is written to and read from **fixed global KV keys**:

```js
const IDX = "icu:index", PFX = "icu:case:";   // no user id anywhere
```

The client (`icu.js`) never sends a user identity, and the handler never
derives one. Consequences on any deployment with `CASES_KV`/`GHIS_KV` bound:

- **Cross-tenant PHI exposure** — Clinician A's saved ICU patients (name,
  diagnosis, bed, full vitals/labs snapshot) are returned to Clinician B.
- **Mutual data loss** — the `MAX = 10` cap is global, so every clinician
  shares one pool of 10 cases; saving evicts *other* clinicians' patients.

**Fix:** scope every key by an authenticated user id
(`icu:index:<uid>`, `icu:case:<uid>:<id>`) derived from a verified identity
(Cf-Access email, or the Firebase ID token you already have on the client),
not from an unauthenticated header.

### 2. API auth gate is bypassable — empty `Origin` and suffix-match both pass  — ✅ FIXED (cases) / partially hardened (ai)
`functions/api/cases/[[path]].js`, `functions/api/ai/[[path]].js`

```js
const o = request.headers.get("Origin") || "";
return o.endsWith("stewardmd.in") || o === "";
```

Two independent bypasses (both verified):

- `o === ""` → **any non-browser client (curl, script) sends no `Origin`** and
  is treated as authorized. Combined with bug #1, `curl https://…/api/cases`
  and `/api/cases/:id` return **all stored ICU PHI with no auth at all**.
- `endsWith("stewardmd.in")` matches attacker domains like
  `evil-stewardmd.in` (`"evil-stewardmd.in".endsWith("stewardmd.in") === true`).

`/api/ai` has the same gate — an unauthenticated caller can drive the Gemini
endpoints (cost/abuse). (`/api/ghis` is unaffected — it requires a bearer token.)

**Fix:** require a real credential (Cf-Access header or a verified app token /
Firebase token). Do not treat "no Origin" as trusted. If you keep an origin
check as defense-in-depth, match the exact host set, e.g.
`["https://stewardmd.in","https://www.stewardmd.in"].includes(o)`.

---

## P1 — High

### 3. `/api/cases` mutations are not CSRF-safe  — ✅ FIXED
Because the gate above accepts a spoofable/absent `Origin` and there is no
token, `PUT`/`DELETE /api/cases/:id` are state-changing requests with no
anti-CSRF protection. Fixing #2 (a real credential) resolves this; a per-request
token is the standard mitigation.

---

## P2 — Medium (correctness / robustness)

### 4. Test harnesses hard-code the macOS Chrome path (fixed in this branch)
All 13 `test/run-*.mjs` harnesses used
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`, so the entire
regression net was **unrunnable on Linux/CI**. This branch makes the binary and
flags env-overridable (`CHROME_BIN`/`CHROME`, `CHROME_FLAGS`) with the macOS
path kept as the default, so the suites now run headlessly in CI.

### 5. `caseshare` autosave reads `currentUser` directly, re-introducing the settle race
`caseshare.js` — `autosaveOpened()` uses `firebase.auth().currentUser` directly
instead of going through `ensureReady()` (which the file added specifically to
fix "currentUser is briefly null right after lazy Firebase load"). Opening a
shared link right after load can silently skip the "save to My Cases" copy.
**Fix:** route the autosave through the same `ensureReady(db,user)` path.

### 6. `showViewer` renders `ownerEmail` but shares intentionally don't store it
`caseshare.js` — `showViewer()` builds `"(" + rec.ownerEmail + ")"`, but
`doShare()` deliberately omits email from the public doc (correct — avoids PII
leak). Harmless today (always undefined), but it's dead/misleading code that
would leak email the moment someone re-adds the field. Remove the `ownerEmail`
branch so the "no email in public shares" invariant is enforced in one place.

### 7. Live clinical-validation suite can't reach the target from a sandbox
`test/run-clinical-validation.mjs` points at `https://stewardmd.in`. In a
no-egress environment it reports FAILs ("MaiK not loaded", "ICU is not defined",
FCP ~13 s) that are **network artifacts, not code bugs** — every *local* suite
(golden, main-engine, nextq, kb-parity, kb-expanded, icu-import, icu-wardsync,
ghis-ward, maik-knowledge) is green. Add a `BASE` override / local-server mode
so this suite can run against the checked-out copy like the others.

## P3 — Low (hygiene)

### 8. `index.html` has no `</head>` tag
The document jumps straight from `<head>` content to `<body>` (line 101). Browsers
auto-recover, but it's invalid markup and can confuse tooling/validators.

### 9. CSP relies on inline handlers
`index.html` documents that `script-src` is intentionally unlocked because the
app uses inline `on*` handlers (also present in `ghis-ward.js`'s injected HTML).
This blocks a strong CSP. Longer-term, move to delegated listeners so a real
`script-src` can be set as a Cloudflare response header.

---

## What passed (so you know where the floor is)

Run locally with `CHROME_BIN=/path/to/chromium CHROME=… CHROME_FLAGS=--no-sandbox`:

| Suite | Result |
|---|---|
| `run-golden` (differential regression) | ✅ ALL GREEN |
| `run-main-engine` | ✅ ALL GREEN |
| `run-nextq` (next-question purity) | ✅ ALL GREEN |
| `run-kb-parity` (declarative KB == closures) | ✅ ALL GREEN |
| `run-kb-expanded` | ✅ ALL GREEN |
| `run-icu-import`, `run-icu-wardsync` | ✅ ALL GREEN |
| `run-ghis-ward` | ✅ ALL GREEN |
| `run-maik-knowledge` | ✅ ALL GREEN |

The Drug Worker (`worker/src/index.js`), Firestore rules
(`firestore.rules` — properly scopes `users/{uid}/cases` and shared-case expiry),
and the GHIS Function's per-token session model are well-built and were not
found to have equivalent issues.

---

## Recommended order of work

1. **#1 + #2 together** — add a verified user identity to `/api/cases` and
   key storage by it; drop the "empty Origin = trusted" rule. This closes the
   PHI exposure and the cross-user overwrite in one change.
2. **#3** falls out of #2.
3. **#5, #6** — small `caseshare.js` correctness fixes.
4. **#4** is already done on this branch (harness portability) — wire the
   suites into CI so this net actually runs on every push.
5. **#7, #8, #9** as hygiene.

---

## Fixes applied on this branch

- **#1 / #2 (cases) / #3 — per-user, authenticated cloud cases.**
  `functions/api/cases/[[path]].js` now derives identity from a **verified
  Firebase ID token** (`Authorization: Bearer …`, RS256-verified against
  Google's public JWK set, checking `aud`/`iss`/`exp`/signature) or a
  Cloudflare Access email. Storage is keyed per user
  (`icu:index:<uid>`, `icu:case:<uid>:<id>`). Signed-out callers get
  `enabled:false` (on-device fallback) for the index and `401` for everything
  else — no more unauthenticated PHI reads, cross-user leakage, or mutual
  eviction. Requiring a token also closes the CSRF hole (#3).
  `icu.js` attaches the signed-in clinician's ID token to every `/api/cases`
  call; not signed in → graceful localStorage fallback (unchanged UX).
  Config: `env.FIREBASE_PROJECT_ID` (defaults to the app's project id).
  Verified end-to-end (13/13 checks): rejects tampered/expired/wrong-`aud`
  tokens; user B cannot read or delete user A's cases; no global keys written.

- **#2 (ai) — origin allowlist hardened.** `functions/api/ai/[[path]].js`
  replaced `o.endsWith("stewardmd.in")` (which matched `evil-stewardmd.in`)
  with an exact-host allowlist. Empty `Origin` is still accepted there because
  browsers omit it on same-origin GETs and `/api/ai` is not a PHI store; the
  remaining abuse surface is Gemini cost, not patient data.

- **#5, #6** — `caseshare.js` auth-settle race and dead `ownerEmail` render
  path (see earlier commit).

- **#4** — test-harness Chrome path/flags made env-overridable so the
  regression net runs on Linux/CI (see earlier commit).

- **On-device isolation on a SHARED device** — `icu.js` now namespaces the
  saved-patient roster per Google account (`stewardmd_icu_patients:<uid>`) and,
  via Firebase `onAuthStateChanged`, wipes the live working buffer on a real
  account switch or sign-out (signing in from anon keeps your work; reloads as
  the same user don't wipe). The legacy shared bucket is migrated once, never
  destroyed. So two clinicians sharing one phone/tablet never see each other's
  ICU patients even before the cloud round-trip. Verified with a 9-case
  state-machine test (migrate / claim / switch / sign-out / reload).
