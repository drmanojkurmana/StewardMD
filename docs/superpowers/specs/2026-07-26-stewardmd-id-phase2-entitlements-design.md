# StewardMD ID — Phase 2: Unified Entitlement Record + Admin Console (Design)

**Date:** 2026-07-26
**Status:** Design — approved direction, pending user review of this spec
**Owner:** diwakar.kurmana@sapiens.com
**Feature area:** Account entitlement / admin / access control

> **Phase 2 of 4.** Phase 1 (universal StewardMD ID + verified-email) is in PR #545. Phase 3 (per-ID AI token budgets) and Phase 4 (Pro feature-toggle switchboard) are later cycles. This phase's record **reserves** their fields but does not enforce them.

---

## Goal

Introduce a **per-person entitlement record keyed to the StewardMD ID** that is the source of truth for a user's **role** (physician / resident / student) and per-module **tier** (KardioX/ThoreX V1 vs V2 Beta), and give admin a console to manage it by **StewardMD ID / email / reg number**. The headline change: **KardioX/ThoreX tier moves from the device activation to the person.**

## Why

Today tier (`v1`/`v2beta`) is bound to `experimentalActivations/{activationId}` — the same person on two devices has two independent tiers, and admin can only change it per-`activationId`. The user wants role/tier to be a property of the *person* (the StewardMD ID), manageable centrally, so a student is a student on every device.

## Key decisions (user, 2026-07-26)

- **Role drives tier automatically:** physician → V1 (clinical only), resident/student → V2 Beta (clinical + educational). An optional per-module override exists for exceptions (e.g. a physician you want on V2 Beta for teaching).
- **Pro stays as-is** (Firebase custom claim, billing-written). The record does not own Pro — the admin view *joins* Pro live for display. Least risk to the live payment path.
- **Admin targets a user by StewardMD ID, email, OR reg number** (all three).
- **Scope:** the record + admin console + moving tier to the person. Token-budget **enforcement** is Phase 3; the Pro-toggle switchboard is Phase 4. The schema reserves `aiTokens` and `featureFlags`.
- **Flag-gated OFF:** the server prefers the person-tier only when enabled; dark-launchable.
- The pre-existing "verify wipes Pro claim" bug (verify-doctor uses clobbering `setUserClaims`) is **out of scope** — spawned as a separate task.

---

## Architecture

**Principle:** a server-only Firestore record `entitlements/{uid}` holds the person's role + optional tier overrides. The server's existing experimental-access gates (`checkActive`/`verify`/`statusFor`) consult it and **prefer the person-tier over the device-activation tier**, falling back to the activation tier when no record exists (zero forced migration). The **client is essentially unchanged** — `experimental.js tierFor` already returns whatever tier the server last put in its local cache, so once the server resolves person-tier, the client gets it through the same `verify`/`status` responses it already reads.

```
Admin sets role (by smdId/email/regNo → uid)
        │
        ▼
entitlements/{uid} = { role, tierOverrides, ... }   (server-only Firestore)
        │
        ▼  (server gate, when ENTITLEMENTS_ON)
checkActive/verify/statusFor  →  effectiveTier(feature) = tierOverrides[feature] || roleToTier(role)
        │                                                   (physician→v1, resident/student→v2beta, unset→v1)
        ▼
tier in the verify/status response  →  client cache (smd_xa_st_<feature>.tier)  →  tierFor()  →  ThoreX resolver
```

### The record — `entitlements/{uid}`

Server-only (Firestore rules `allow read, write: if false`, like `experimentalActivations`):

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Firebase uid (doc id) |
| `smdId` | string | the StewardMD ID (denormalized for admin display; resolved from `doctorDirectory`) |
| `role` | `"physician"\|"resident"\|"student"\|null` | admin-assigned; drives tier |
| `tierOverrides` | `{ [feature]: "v1"\|"v2beta" }` | optional manual per-module override; wins over role-derived |
| `updatedBy` | string | owner email who last changed it (audit) |
| `updatedAt` | serverTimestamp | audit |
| `aiTokens` | null | **RESERVED (Phase 3)** — not read/enforced in Phase 2 |
| `featureFlags` | `{}` | **RESERVED (Phase 4)** |

**Derivation:** `effectiveTier(feature, record) = record.tierOverrides?.[feature] || roleToTier(record.role)`, where `roleToTier`: `physician→"v1"`, `resident→"v2beta"`, `student→"v2beta"`, else `"v1"`. Pro and `verified` are **not** stored (read live from claims for the admin view — no staleness).

### Server pieces (`functions/_experimental.js` + new helpers)

- `roleToTier(role)`, `effectiveTier(feature, record)` — pure, unit-tested.
- `getEntitlement(env, uid, deps)` — `fsGet entitlements/{uid}` → record or null.
- `writeEntitlement(env, uid, patch, deps)` — guarded merge write (mirror `setActivationTier`'s `fsCommit` update, create-or-merge), stamps `updatedBy`/`updatedAt`.
- `resolveUid(env, { smdId | email | regNo }, deps)` — new resolver:
  - `smdId` → `fsGet doctorDirectory/{normalizeId(smdId)}` → `uid` (NEW — no server smdId resolver exists today).
  - `email` → `lookupUidByEmail` (Identity Toolkit; directory `e_{hash}` as fallback).
  - `regNo` → KV `icu:reg:<REG>` → `uid`.
- **Read integration (the load-bearing change):** `checkActive`, `verify`, `statusFor` — when `entitlementsOn(env)` — look up `getEntitlement(env, payload.u)` and return `effectiveTier(feature, record)` if the record yields a tier, else the current `act.fields.tier`. When the flag is off, behavior is byte-for-byte today's.

### Admin endpoints — new router `functions/api/entitlements/[[path]].js` (owner-gated via `ownerOK`)

- `POST /api/entitlements/admin/lookup` `{ smdId | email | regNo }` → `{ uid, smdId, email, name, role, effectiveTiers:{thorex,kardiox}, tierOverrides, pro, proExp, verified, regNo }` — one unified view (joins the record + live `pro`/`verified` claims via `getUserClaims`/`lookupUserByUid`).
- `POST /api/entitlements/admin/set-role` `{ smdId|email|regNo|uid, role }` → writes `role` (+ recomputes nothing stored; tier derives at read).
- `POST /api/entitlements/admin/set-tier` `{ …identity, feature, tier }` → sets `tierOverrides[feature]`.
- `POST /api/entitlements/admin/clear-override` `{ …identity, feature }` → removes an override.

All resolve identity → uid via `resolveUid`, then read/write `entitlements/{uid}`. Typed errors: `not_found`, `bad_role`, `bad_tier`, `bad_feature`, `missing_identity`, `forbidden`.

### Admin console — `admin/index.html`

New **"User Entitlements"** panel: an identity input (SMD ID / email / reg number) + Lookup → renders the joined view (StewardMD ID, email, name, role, effective ThoreX/KardioX tier, Pro badge, verified badge). Controls: a **role** dropdown (physician / resident / student / — none —) and an optional **per-module tier override** (v1 / v2beta / auto). Save calls the endpoints above. This becomes the primary tier control; the existing per-`activationId` set-tier stays for device-level edge cases.

### Client — minimal

- `experimental.js tierFor` and `thorex-entitlement.js resolve` **unchanged** — the server drives the cached tier value.
- Client flag `smd_entitlements` (default OFF) reserved for a future read-only "your role / tier" display in the account/ThoreX UI — **deferred**, not built in Phase 2.

---

## Flag / gating

- **Server:** `entitlementsOn(env)` = `String(env.ENTITLEMENTS_ON || "") === "1"` (default OFF). Gates ONLY the person-tier *preference* in `checkActive`/`verify`/`statusFor`. Admin endpoints + record writes are always available (harmless while the read-gate is off — records simply aren't consulted → true dark launch).
- **Client:** `smd_entitlements` flag (default OFF) reserved for future display; no behavior in Phase 2.

## Error handling

- `resolveUid` miss → `not_found` (never leak whether an identity exists beyond the owner-gated context).
- Missing/omitted `entitlements/{uid}` → treated as "no record" → activation-tier fallback. Never blocks a feature.
- Firestore read failure in a gate → fall back to the activation tier (fail-open to *current* behavior, never fail-closed to locking a user out).
- All admin writes stamp `updatedBy`/`updatedAt`; invalid role/tier/feature rejected with typed errors.

## Security & privacy (R3)

- `entitlements/{uid}` is server-only (rules deny all client access; service account bypasses).
- All admin endpoints owner-gated (`ownerOK`). `resolveUid` runs only inside the owner gate.
- No raw email stored (directory hash-only, as Phase 1); the record stores `smdId`/`uid`.
- Role/tier are access-control data, not PHI; standard logging discipline (no tokens/PII in logs).
- Tier remains **server-authoritative** — `checkActive`/`verify` read the live record + activation, never trust a client-supplied tier.
- Ships only through R3 security review before the flag flip.

## Testing

Node tests (repo convention — `.test.js`/`node:test` for logic, `.test.mjs` for functions):
- **`roleToTier`/`effectiveTier`** truth table: physician→v1, resident/student→v2beta, null→v1; override wins over role; unknown feature falls back to role tier.
- **`resolveUid`** — smdId path (`doctorDirectory/{smdId}`), email path (`lookupUidByEmail`), regNo path (KV), and miss → `not_found`; with injected deps (fake fsGet / KV / lookup).
- **Read integration** — `checkActive`/`verify` with a fake `entitlements` doc: person-tier preferred when `ENTITLEMENTS_ON`; activation-tier fallback when the record is absent or the flag is off; fail-open on read error.
- **Admin endpoints** — lookup joins record + claims; set-role/set-tier/clear-override write the expected fields with `updatedBy`; bad role/tier/feature rejected; non-owner → 403.
- **No regression** — existing `_experimental.tier.test.mjs` + experimental access tests pass with the flag off (unchanged behavior).

## Rollout

1. Land behind `ENTITLEMENTS_ON` unset (OFF). Admin console + endpoints usable to pre-stage roles.
2. R3 security review.
3. Set `ENTITLEMENTS_ON=1` in staging → verify a person-tier set via the console overrides the device tier on the next `verify`/`status` for ThoreX; verify activation-tier fallback for users with no record.
4. Staged production enable.

## Out of scope (later phases / spawned)

- AI token budget **enforcement** (Phase 3) — record reserves `aiTokens`.
- Pro feature-toggle switchboard (Phase 4) — record reserves `featureFlags`.
- The verify-doctor Pro-claim-clobber bug — spawned as its own task.
- Aadhaar linking — Phase-2-adjacent identity work, hash/flag-only, not in this slice.

## Open items for the plan

- Confirm `_experimental.js` exposes an `fsGet`/`fsCommit` seam usable for `entitlements/{uid}` (the map shows `FS.fsGet`/`fsCommit`/`wUpdate` exist) and whether a create-if-absent write needs `wSet` vs `wUpdate`.
- Decide the exact response shape of `lookup` for the admin UI (field names the console renders).
- Confirm `normalizeId` is reachable server-side for the smdId resolver (Phase 1's `SMD_STEWARD_ID.normalizeId` is client-side; the server helper should inline the same normalization).
