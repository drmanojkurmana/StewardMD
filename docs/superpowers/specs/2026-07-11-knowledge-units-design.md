# Knowledge Units (KU) — Design

**Date:** 2026-07-11
**Status:** Approved design; pending implementation plan.

## Goal

Reward clinicians for reading and using StewardMD. Users earn **Knowledge Units (KU)**
by opening clinical content and using features; their balance and progress toward
reward tiers are displayed in-app. Tiers map to **future** subscription discounts.
The ledger is **server-authoritative** and identity-verified, so KU can gate real money.

## Scope

**In scope**
- Server-authoritative KU ledger (Cloudflare Pages Function + KV), keyed to a
  cryptographically-verified Firebase `uid`.
- Client accrual: batch meaningful "learning/usage" events → award endpoint.
- Display: a header KU chip + a "Knowledge Points" panel (balance, breakdown,
  streak, tier progress bar).
- Reward tiers defined and shown as goals; "unlocked" state computed from balance.

**Out of scope (YAGNI / deferred)**
- Actual discount redemption + billing/subscription integration (no billing backend
  exists yet). Tiers are displayed as goals only.
- Leaderboards, badges, social sharing, cosmetic gamification.

## Key decisions (agreed)

1. **Earning:** reading-weighted, but overall usage counts too.
2. **Trust model:** server-authoritative ledger (KV), **with Firebase ID-token
   verification** so the earning `uid` cannot be forged.
3. **Redemption:** tiers + progress now; discount/billing hookup deferred.
4. **Eligibility:** KU accrues **only for signed-in users**. Guests see a
   "Sign in to start earning Knowledge Units" prompt (KU gate real money, so an
   anonymous/device identity must not accrue redeemable value).

## Earning model (weights are tunable via env)

| Event `type`      | KU | Client signal                                   | Dedup key (`refId`)         |
|-------------------|----|-------------------------------------------------|-----------------------------|
| `read`            | 5  | `recent.js` `record()` — clinical page opened   | content id (disease/drug/…) |
| `case`            | 15 | a Dx / Clinical-Reasoning case saved            | case id                     |
| `calc`            | 3  | a calculator run                                | calculator id               |
| `maik`            | 2  | a MaiK answer rendered (grounded answer shown)  | answer id (hash of q)       |
| `streak`          | 10 | first qualifying event of a new day (server UTC)| `YYYYMMDD` (UTC)            |

- **Per-`refId` dedup:** a given content item pays **once per UTC day** (re-reading
  the same disease page the same day does not re-pay). This is how "the more they
  read" stays honest: breadth of reading is rewarded, refresh-farming is not.
- **Per-`type` daily caps (tunable):** e.g. `read` ≤ 100 KU/day, `calc` ≤ 30,
  `maik` ≤ 40, `case` ≤ 90. Caps bound both gaming and daily variance.
- All weights/caps read from env with the table above as defaults, so tuning needs
  no code change.

## Architecture

Mirrors the existing `functions/_usage.js` KV pattern and the app's local-first UX.

```
recent.js / calculators / cases / MaiK
        │  (emit events)
        ▼
  ku.js  (window.SMD_KU)              ── batches + debounces, caches balance locally
        │  POST /api/ku/award  (Authorization: Bearer <firebaseIdToken>)
        ▼
functions/api/ku/[[path]].js         ── verifies ID token → uid
        │                               applies weights + dedup + caps
        ▼
   Cloudflare KV  (ku:<uid>)          ── authoritative balance + counters
```

### Server: `functions/api/ku/[[path]].js`

Reuses `authorise()` (origin/app-token gate) as the coarse gate, **plus** Firebase
ID-token verification for identity. KV via the existing `usageKv(env)` accessor
(`MAIK_KV || CASES_KV || GHIS_KV || UPDATES_KV`). Fail-open→**fail-closed** for KU:
if no KV is bound, award returns `{error:"unavailable"}` (never silently grants KU).

Endpoints:
- `POST /api/ku/award`
  - Body: `{ events: [{ type, refId }], tz? }` (max ~50 events/request).
  - Header: `Authorization: Bearer <firebaseIdToken>`.
  - Verifies token → `uid`; rejects (401) if missing/invalid.
  - Loads `ku:<uid>`; for each event: skip if type unknown, skip if `refId` already
    in today's `seen` set for that type, skip if type's daily cap reached; else add
    weight, record `refId`, increment counters. Applies streak once/day.
  - Persists; returns `{ balance, todayEarned, streak, tier, nextTier, progressPct }`.
- `GET /api/ku/summary`
  - Header: `Authorization: Bearer <firebaseIdToken>`.
  - Returns `{ balance, byType, streak, lastDay, tiers:[{ku,label,unlocked}],
    nextTier, progressPct }`.

### Firebase ID-token verification (server, keyless)

- Fetch Google's public certs from
  `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`
  (or the JWK endpoint), cache per-isolate honoring `Cache-Control: max-age`.
- Verify the JWT: RS256 signature against the matching `kid`, `aud` == Firebase
  project id (env `FIREBASE_PROJECT_ID`), `iss` == `https://securetoken.google.com/<project>`,
  `exp`/`iat` valid. Reuses the Worker's existing `crypto.subtle` usage (Vertex WIF
  already imports/verifies RSA keys).
- On success, `uid = token.sub`. This is the ONLY identity KU trusts.

### KV schema

`ku:<uid>` (JSON):
```json
{
  "balance": 1240,
  "byType": { "read": 900, "case": 210, "calc": 60, "maik": 40, "streak": 30 },
  "day": "20260711",
  "seen": { "read": ["cap","dka",...], "calc": ["crcl"], "maik": ["h1a2"], "case": ["c_x"] },
  "dayTotals": { "read": 45, "calc": 6, "maik": 8, "case": 15 },
  "streakDays": 3,
  "lastDay": "20260711",
  "updatedAt": 1752000000000
}
```
- `seen`/`dayTotals` reset when `day` rolls over (server computes current UTC day).
- `seen` lists are bounded by the per-type daily cap, so the doc stays small.
- KV eventual consistency is acceptable for a points balance (no strict ordering
  needed; last-write-wins with read-modify-write per request is fine at this scale).

### Client: `ku.js` (`window.SMD_KU`)

- Loaded from `index.html` (bump `?v=goldN` + `sw.js` CACHE per convention).
- API:
  - `SMD_KU.emit(type, refId)` — enqueue an event; no-op if not signed in.
  - `SMD_KU.balance()` — last known balance (from local cache) for instant display.
  - `SMD_KU.summary()` — Promise resolving to server summary (for the panel).
  - `SMD_KU.onChange(fn)` — subscribe for header-chip updates.
- Behaviour:
  - Only emits when `SMD_ACCOUNT.uid()` is a real signed-in uid (not `anon`).
  - Debounces/batches events (~4s or on 20 queued) → one `POST /api/ku/award`
    with the current Firebase ID token (`auth().currentUser.getIdToken()`).
  - Caches `{balance,tier,...}` in `localStorage` (`stewardmd_ku_<uid>`) for instant
    paint; the server response is authoritative and overwrites the cache.
  - **Offline queue:** a signed-in user's events queued while offline flush on the
    next successful award call. Guests never emit (see Eligibility), so there is no
    guest queue. Local cache is display-only; the server is the source of truth
    (local edits never grant redeemable KU).
- Hooks (thin, non-invasive): `recent.js record()` → `emit("read", id)`;
  calculator run → `emit("calc", id)`; case save → `emit("case", id)`;
  MaiK grounded answer render → `emit("maik", hash(question))`.

## Display / UI (home.js + CSS)

- **Header chip:** `◆ 1,240` next to the account/notifications buttons; tap opens
  the Knowledge Points panel. Hidden (or shows "Sign in to earn") for guests.
- **Knowledge Points panel** (new menu entry + sheet, styled like existing sheets):
  - Large balance + streak ("🔥 3-day streak").
  - **Progress bar** to the next tier ("260 KU to 25% off").
  - Tier ladder with unlocked/locked state.
  - Breakdown by activity (reading / cases / calculators / MaiK).
  - Footer: "Discounts apply at renewal once redemption launches. KU are provisional
    until verified at redemption."

## Reward tiers (placeholder, tunable via env)

| KU     | Reward (future)     |
|--------|---------------------|
| 500    | 10% off             |
| 1,500  | 25% off             |
| 4,000  | 40% off             |

Displayed as goals; **no** discount is applied yet.

## Privacy

- Ledger keyed by verified `uid`; stores only aggregate KU counts + content
  **refIds** (disease/drug/guide/calculator ids) — never patient data / PHI.
- No new PHI leaves the device. Content refIds are the same non-PHI ids already in
  `recent.js`.
- KU is opt-in by virtue of being sign-in-gated; guest/device use is unaffected.

## Anti-gaming summary

- Server-authoritative balance (localStorage tampering is display-only).
- Verified identity (can't earn under a forged/other uid).
- Per-`refId` once-per-day dedup + per-type daily caps.
- Unknown event types ignored; award batch size capped.

## Testing

- **Server unit tests** (node): weight application, per-`refId` dedup, daily caps,
  day rollover reset, streak once/day, unknown-type rejection, malformed-token 401,
  no-KV fail-closed. Token verification tested with a locally-signed RS256 JWT +
  injected test JWK (mirrors the WIF signing already in the repo).
- **Client tests:** `emit` no-ops when signed out; batching/debounce; offline queue
  flush; local cache reconcile with server response.
- **Manual smoke:** sign in, read pages → chip increments; open panel → breakdown +
  progress; re-read same page same day → no double-count; sign out → chip hides.

## Rollout / flags

- Gated behind `smd_ku` flag (default on when a KV + `FIREBASE_PROJECT_ID` are
  configured; off otherwise, so the feature no-ops cleanly in envs without KV).
- Cache-bust: add `ku.js?v=goldN` to `index.html` and bump `sw.js` CACHE.

## Open items for the plan

- Confirm which KV namespace to bind (reuse `MAIK_KV` vs a dedicated `KU_KV`).
- Confirm `FIREBASE_PROJECT_ID` env is available to Functions.
- Exact placement of the header chip in the existing top bar without crowding.
