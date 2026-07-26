# StewardMD ID — Phase 4: Pro Feature-Toggle Switchboard (Design)

**Date:** 2026-07-26
**Status:** Design — approved direction, pending user review of this spec
**Owner:** diwakar.kurmana@sapiens.com
**Feature area:** Entitlement / feature-access control

> **Phase 4 of 4 — the final phase.** Builds on Phase 1 (StewardMD ID), Phase 2 (`entitlements/{uid}` record + role/tier), Phase 3 (AI budgets + a minimal `premiumModels` toggle). This generalizes toggling into one switchboard and wires the first real server-side enforcement.

---

## Goal

A generic, **server-side** per-user/role **feature switchboard** on the entitlement record: an admin enables/disables specific Pro features per user or per role, from one registry that holds both whole-module keys and sub-feature keys. Absorbs Phase-3's `premiumModels` into one system.

## Key decisions (user, 2026-07-26)

- **One generic registry** — a single `featureFlags` map holds either a whole-module key (`kardiox`, `thorex`) or a sub-feature key (`kardiox_ecg19`, `scribe_dictation`). The registry defines what exists.
- **Role-based defaults + per-user override** — each feature has a per-role (or global) default; a per-user flag overrides it (and can turn a feature **off** as well as on).
- **Server-enforce only for now** — no client entitlement-read endpoint; enforcement is server-side. The client UI keeps its current gating (honoring flags in the UI is a documented follow-up).
- **Admin OR access-code** — a feature is granted if the admin/role allows it **OR** (for experimental modules) the user holds a valid access code. Existing `checkActive` code gates stay intact.
- **Absorb `premiumModels`, keep back-compat** — `kardiox_ecg19` becomes a registry feature; the resolver reads `featureFlags` first, then the legacy `premiumModels` map, so Phase-3 data/toggle keep working.
- **First enforced consumer:** the ThoreX LLM proxy (`thorex_llm` feature, default-on → no behavior change).
- **Flag-gated OFF** by `FEATURES_ON`.

## Non-goals

- Client-side UI honoring of per-user flags (needs a `GET /api/entitlements/me`-style read — a follow-up).
- Migrating the per-device `smd_*` localStorage flags (`thorex-flags.js` etc.) — those stay dev/QA per-device switches, distinct from admin `featureFlags`.
- Broad adoption of `requireFeature` across every module — Phase 4 wires ONE consumer (ThoreX LLM) as proof; other modules adopt it as follow-ups.
- KardioX external Cloud Run enforcement (out of repo).

---

## Architecture

**Principle:** a new `functions/_features.js` owns the feature registry + pure resolver + a `requireFeature` server gate. The record gains a `featureFlags` map managed by new owner-gated admin handlers. When `FEATURES_ON` is off, `requireFeature` is inert (allows) — no behavior change.

### Feature registry — `FEATURE_REGISTRY` (in `functions/_features.js`)

An array of entries; each: `{ key, label, defaultOn?, defaultRoles?, experimental? }`.
- `defaultOn: true` → on for everyone (incl. no-role) unless a per-user flag disables it.
- `defaultRoles: [...]` → on for those roles only.
- `experimental: true` → the access-code OR applies (the key is also an `SMD_XACCESS` FEATURE).

Seed:
| key | label | default | experimental |
|---|---|---|---|
| `thorex_llm` | ThoreX "Learn more" / correlate LLM | `defaultOn` | — |
| `kardiox_ecg19` | KardioX 19-class ECG model | `defaultRoles: []` (admin-only) | — |
| `scribe_dictation` | MaiK Scribe clinical dictation | `defaultRoles: ["physician","resident"]` | — |
| `lab_watch` | Apple Watch Lab Watch sync | `defaultRoles: ["physician","resident","student"]` | — |
| `case_sync` | Cross-device case sync | `defaultOn` | — |
| `ward_sync` | Ward Sync / ICU collaboration | `defaultRoles: ["physician","resident"]` | — |
| `fundx` | FundX module | `defaultRoles: []` | `experimental` |
| `kardiox` | KardioX module | `defaultRoles: []` | `experimental` |
| `thorex` | ThoreX module | `defaultRoles: []` | `experimental` |

Numbers/roles are placeholders — env-overridable via `FEATURE_<KEY>_ROLES` (comma list) and `FEATURE_<KEY>_DEFAULT_ON=1`. The registry is the source of truth for valid keys.

### Pure resolver — `featureAllowed(env, record, key, role)`

```
1. record.featureFlags[key] set?  → return it === true      (explicit per-user enable OR disable wins)
2. record.premiumModels[key] === true?  → true              (legacy Phase-3 back-compat)
3. registry entry missing?  → false
4. entry.defaultOn (or env FEATURE_<KEY>_DEFAULT_ON)?  → true
5. role ∈ (env FEATURE_<KEY>_ROLES || entry.defaultRoles)?  → true
6. else → false
```
Plus `featuresOn(env)` = `env.FEATURES_ON === "1"` (default OFF), `featureKeys()`, `registryEntry(key)`.

### Server gate — `requireFeature(env, request, key, deps)`

```
if (!featuresOn(env)) return { allowed: true, reason: "flag_off" }   // INERT when off — no gating
uid = deps.uid || verifyFirebaseToken(bearer(request), env)
if (!uid) return { allowed: false, reason: "signin_required" }
record = getEntitlement(env, uid)          // direct Firestore read (see caching note); fail-open → null
role = record?.role
if (featureAllowed(env, record, key, role)) return { allowed: true, uid, role, reason: "granted" }
entry = registryEntry(key)
if (entry?.experimental && deps.xaToken) {  // admin OR code
  if ((await checkActive(env, key, deps.xaToken)).active) return { allowed: true, uid, role, reason: "code" }
}
return { allowed: false, uid, role, reason: "feature_off" }
```
- **Fail-open:** any Firestore/verify error → treat as no record → falls to role/registry default; never throws.
- **Caching note:** `requireFeature` reads `getEntitlement` directly. The seed consumer (ThoreX "learn more") is low-frequency (already rate-limited 2s / 120·day), so one Firestore read per call is acceptable. A hot consumer adopting `requireFeature` later should add the KV-cache pattern from `monthlyCapFor` (with `invalidate` on admin write). Deps-injectable for tests.

### Record field — `entitlements/{uid}.featureFlags`

`{ [key]: true | false }` — explicit per-user override. Absent key → resolver falls through to legacy/role/registry default. Managed by:
- `adminSetFlag(env, body, deps)` — `{ …identity, feature, enabled }` → validate `feature ∈ featureKeys()` (`bad_feature`), write `featureFlags[feature] = !!enabled`.
- `adminClearFlag(env, body, deps)` — `{ …identity, feature }` → delete the key (revert to default).
- `adminLookup` extended → returns `featureFlags` (explicit map) + `features` (resolved effective state for every registry key: `{ key, label, allowed, source }`) + the registry, so the console renders the full switchboard.
- Router `functions/api/entitlements/[[path]].js` — `set-flag` / `clear-flag` segments (owner-gated, `updatedBy` stamped).

`premiumModels` + `adminSetModel` (Phase 3) stay as a legacy write path that `featureAllowed` still honors; `premiumModelAllowed` (in `_aibudget.js`) is superseded by `featureAllowed` (left in place, no consumers). `kardiox_ecg19` now appears in the switchboard via `featureFlags`.

### First enforced consumer — ThoreX LLM (`functions/api/thorex/[[path]].js`)

After `callerUid` (flag-gated by `FEATURES_ON` inside `requireFeature`):
```js
const f = await requireFeature(env, request, "thorex_llm", { uid: callerUid });
if (!f.allowed) return json({ ok: false, error: "feature_off", feature: "thorex_llm" }, 403, request);
```
`thorex_llm` is `defaultOn`, so with `FEATURES_ON` on-and-default nothing changes until an admin explicitly disables it for a user. With `FEATURES_ON` off, `requireFeature` returns `allowed:true` → byte-for-byte today's proxy.

### Admin console — feature switchboard (`admin/index.html`)

Extend the "User Entitlements" panel: render `r.features` (every registry feature with its resolved state + explicit override) as a tri-state control per feature — **auto** (clear override) / **on** / **off** — calling `set-flag` / `clear-flag`. Reuse the `api() → {s,d}` idiom.

---

## Flag / gating

- `FEATURES_ON` env (default OFF) gates `requireFeature` (inert/allow when off). Admin can pre-stage flags before enabling. Independent of `ENTITLEMENTS_ON`/`AI_BUDGET_ON` (each phase's flag is separate).

## Error handling

- `requireFeature` fail-open on infra error (no record → registry/role default), never throws into a route.
- `adminSetFlag`/`adminClearFlag` reject unknown feature keys (`bad_feature`), unknown identity (`not_found`).
- Unset `featureFlags`/`premiumModels` → resolver defaults; never a crash on a missing map.

## Security & privacy (R3)

- `featureFlags` are access-control booleans (not PHI). Admin handlers owner-gated; `updatedBy` from token; feature key allow-listed against the registry (no arbitrary-key/proto-pollution write).
- `requireFeature` is server-authoritative; the client can't set its own flags (no client write path; server-enforce only).
- The access-code OR reuses the existing server-authoritative `checkActive` (HMAC-verified), unchanged.
- Ships only through R3 before flipping `FEATURES_ON`.

## Testing

- **`featureAllowed`** truth table: explicit per-user true/false wins; legacy `premiumModels` honored; `defaultOn`; `defaultRoles` role match/miss; env `FEATURE_<KEY>_ROLES`/`_DEFAULT_ON` overrides; unknown key → false.
- **`requireFeature`** with injected deps: flag off → allowed (inert); no uid → signin_required; featureAllowed true → granted; experimental + valid xaToken → code; else feature_off; Firestore error → fail-open to default.
- **Admin** `adminSetFlag`/`adminClearFlag` write/delete the right key + invalidate nothing (direct-read) ; bad feature → `bad_feature`; `adminLookup` returns `featureFlags` + resolved `features` + registry; non-owner 403.
- **ThoreX wiring:** flag off → proxy unchanged (call-rate only); flag on + `thorex_llm` disabled for a user → 403 before routeLLM; default-on → allowed.
- **No regression:** Phase-1/2/3 suites pass; `premiumModels`/`adminSetModel` still work and are honored by `featureAllowed`.

## Rollout

1. Land behind `FEATURES_ON` unset (OFF). Admin can pre-stage flags.
2. R3 security review.
3. Enable in staging → verify `thorex_llm` default-on is a no-op; disabling it for a test user 403s the LLM; a role-defaulted feature resolves correctly; the access-code OR grants an experimental key.
4. Staged production enable. Client UI honoring + broader `requireFeature` adoption follow.

## Open items for the plan

- Confirm `checkActive` + `verifyFirebaseToken` import paths for `_features.js` (`./_experimental.js`, `./_fbauth.js`).
- Confirm the ThoreX proxy's `callerUid` is available before the insertion point (it is, from Phase 3).
- Decide the exact `adminLookup` `features` array shape the console renders (`{key,label,allowed,explicit}`).
