# Unified, account-linked My Cases — design

_Date: 2026-07-02 · Area: StewardMD saved cases (app.js My Cases + icu.js roster)_

## Goal

1. **Bug:** patients saved in the ICU Dashboard never appear in "My Cases" — the
   two systems are entirely separate. Fix by making "My Cases" a single unified
   list that includes ICU patients **and** Dx/clinical cases.
2. **Requirement:** saved cases are linked to the signed-in Google account and
   sync across devices — signing in with the same Google account on any device
   shows the same cases. Sync is **automatic when signed in**; Guest = on-device
   only. Guest cases are offered for upload on sign-in.

## Non-goals (YAGNI)

- No new backend or datastore; reuse the two existing per-account stores.
- No merging the two case data schemas into one — ICU and Dx cases stay distinct
  record types that share one list.
- No real-time push/subscription — fetch-on-open is sufficient.
- No change to the ICU dashboard's own in-panel roster UI (it keeps working);
  we add the unified surface in the main "My Cases".

## Current systems (verified)

| | ICU patients | Dx / clinical "My Cases" |
|---|---|---|
| Code | `icu.js` (`ICU.savePatient/listPatients/loadPatient`) | `app.js` `SMD_CASES` + My Cases viewer (`#mcpList`) |
| Cloud store | `/api/cases` Cloudflare KV, keyed per-uid via Firebase ID token (`icu:index:<uid>`, `icu:case:<uid>:<id>`) — PR #165 | Firestore `SMD_DB.collection("users").doc(uid).collection("cases")` |
| Local store | `stewardmd_icu_patients:<uid>` (per-account roster) | `stewardmd_cases_<user>` (`user` = `u_<email>` or `guest`) |
| Sync today | Auto per-uid **when signed in** (already cross-device) | Cloud **only if** `isGoogle && getPref()==="firebase"`; **default local, no sync** |
| Data shape | full `ICU_STATE` snapshot (vitals/labs/…) | `{label,name,caseId,age,sex,syndrome,synId,drugs,findings,vitals,savedAt,…}` |

Key facts driving the design:
- Both cloud stores are **already keyed by the Google-account uid**, so
  cross-device works once (a) the user is signed in and (b) each store is used.
- `icu.js` has **zero** references to `SMD_CASES`/My Cases — the only reason ICU
  cases don't show in My Cases is that nothing reads them there.
- Google sign-in now reliably resolves via `onAuthStateChanged` →
  `window.SMD_applyGoogleUser(user)` (gold133). We hook migration into that.

## Design

Three units.

### Unit A — Unified My Cases list (`app.js`)

The My Cases viewer (`#mcpList`, rendered by the function that today calls
`SMD_CASES.getAll`) becomes an **aggregator**:

- Fetch **Dx cases** via existing `SMD_CASES.getAll(user, isGoogle, cb)`.
- Fetch **ICU cases** via `ICU.listCasesForMyCases()` — a NEW read-only method
  added to `icu.js` that returns the account's ICU roster as lightweight
  summaries: `[{id, kind:"icu", label, name, age, sex, savedAt, savedAtStr,
  subtitle}]` (from the cloud roster when signed in, else local; ICU already has
  `loadRoster`/cloud fetch internally).
- Tag Dx entries `kind:"dx"`; merge both arrays; sort by `savedAt` desc; render
  each row with a **type badge** — 🫀 "ICU" for `kind:"icu"`, 🩺 "Case" for
  `kind:"dx"`.
- **Open dispatch** by kind: `dx` → the existing clinical viewer
  (`viewCaseOutput(id)`); `icu` → `ICU.loadPatient(id)` then open the dashboard
  and close the My Cases sheet. Delete dispatch likewise routes to
  `SMD_CASES.delete(...)` or `ICU.deletePatient(id)` by kind.
- Empty state unchanged; count reflects the merged total.

`icu.js` gains only additive read methods (`listCasesForMyCases`, and reuse of
existing `loadPatient`/`deletePatient`); the ICU dashboard's own roster UI is
untouched.

### Unit B — Automatic cloud sync when signed in (`app.js` `SMD_CASES` + save UI)

- `SMD_CASES.save`/`getAll`/`delete`/`clear` currently gate cloud on
  `getPref()==="firebase"`. Change the gate to **"use cloud when the user is a
  signed-in Google account"** (`isGoogle`), regardless of the manual pref. Local
  mirror still written for offline. ICU already auto-syncs per-uid — no change to
  its transport.
- **Remove the manual Local/Cloud toggle** from the save prompt and My Cases
  header (`#mcpLocalBtn`/`#mcpFirebaseBtn`/`#storageChoiceModal`). Replace with a
  non-interactive **status line**: signed in → "☁ Synced to `<email>`"; guest →
  "📱 On this device — sign in to sync across your devices."
- `getPref`/`setPref` may remain as dead-safe no-ops or be removed if unused;
  do not leave a half-wired toggle.

### Unit C — Guest → account migration on sign-in

- Add `window.SMD_migrateGuestCasesOnSignIn(user)` (in `app.js`, same closure as
  `SMD_applyGoogleUser`), invoked from the existing `onAuthStateChanged` capture
  **after** `SMD_applyGoogleUser` writes the account.
- It counts on-device guest cases: Dx (`stewardmd_cases_guest`) + ICU anon roster
  (`ICU.countAnonCases()` — a NEW read-only count in icu.js). If total > 0 and
  not already migrated for this uid (guard flag `stewardmd_cases_migrated:<uid>`),
  show a prompt: **"Move your N saved case(s) to your account?"** with
  Move / Not now.
- On **Move**: upload Dx guest cases into Firestore `users/<uid>/cases` (via
  `SMD_CASES.save` under the signed-in user) and ICU anon roster into the account
  via a NEW `ICU.migrateAnonCases()` (re-saves anon roster entries under the
  current uid through the existing cloud path). Set the guard flag. Clear the
  guest buckets only after successful upload (best-effort; keep on failure).
- On **Not now**: set the guard flag so we don't nag again this account; guest
  cases remain on-device.

## Data flow

- **Save (signed in):** Dx → Firestore + local mirror; ICU → `/api/cases` + local
  roster (unchanged). **Guest:** local only.
- **Open My Cases:** aggregate Dx (cloud→local fallback) + ICU (cloud→local
  fallback) → merge/sort → render with badges.
- **Sign-in:** `onAuthStateChanged` → `SMD_applyGoogleUser` (account) →
  `SMD_migrateGuestCasesOnSignIn` (offer upload).
- **Another device, same account:** sign in → both stores fetch by uid → unified
  list shows all cases.

## Error handling / edge cases

- Every cloud call degrades to the local mirror on failure (both stores already
  do this); the unified list must render whatever each source returns and never
  throw if one source fails.
- Account switch (A→B) must not show A's cases: both stores are already per-uid
  and icu.js reconciles the on-device roster on `onAuthStateChanged`; the
  aggregator always reads for the current uid.
- Migration is idempotent (guard flag per uid); re-running never duplicates.
- Caps unchanged: ICU and Dx each keep their existing 10-item cap; the merged
  list can show up to both.

## Files touched

- `app.js` — My Cases viewer becomes aggregator (Unit A open/delete dispatch by
  kind + badges); `SMD_CASES` cloud gate → `isGoogle` (Unit B); remove
  Local/Cloud toggle UI + add status line (Unit B); add
  `SMD_migrateGuestCasesOnSignIn` and wire it into `onAuthStateChanged` (Unit C).
- `icu.js` — add read-only `ICU.listCasesForMyCases()`, `ICU.countAnonCases()`,
  `ICU.migrateAnonCases()` (additive; no change to existing roster/dashboard).
- `index.html` — small CSS for the type badge + status line; cache-bust
  (`app.js`/`icu.js` `?v`, `sw.js` CACHE).
- No backend/Functions changes (both stores already per-uid).

## Verification (no unit tests; live via preview MCP)

- ICU-saved patient appears in My Cases with an ICU badge and reopens the ICU
  dashboard; a Dx case appears with a Case badge and reopens the clinical viewer.
- Signed in: saving shows "☁ Synced"; a case saved under uid A is retrievable
  after simulating the same uid (cross-device proxy) and absent under uid B.
- Guest→sign-in prompt appears with the correct count and, on Move, guest cases
  become account cases; idempotent on repeat.
- Default look/flows unchanged when signed out (guest still works locally).
