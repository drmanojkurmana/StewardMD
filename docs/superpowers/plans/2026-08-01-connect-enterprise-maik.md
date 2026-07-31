# StewardMD Connect — Track D: Enterprise + MaiK Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **TDD is mandatory** (superpowers:test-driven-development): write the failing test first, watch it fail, then the minimum code to pass, then refactor. **Two tasks are REVIEW: DUAL-ADVERSARIAL — Task 1 (RBAC enforcement) and Task 8 (the MaiK-egress gate).** Spawn two independent adversarial reviewers before either counts as done (see Execution handoff). **The HARD invariant governs everything: real PHI must NOT reach the LLM (`callGemini`) on flag-on alone — the BAA/no-retention gate (`assertEgressAllowed`, R7) is necessary; a live consented bundle feeds ONLY the deterministic MaiK context until that gate passes.**

**Goal:** Ship StewardMD Connect Track D — (D-1) a real multi-tenant org/RBAC admin plane on the Phase-0 `connect_membership`/`resolveTenant` seam, and (D-2) the wiring that lets the LIVE MaiK consume canonical SCCM patient context (`buildMaikContext`) behind the anti-corruption egress layer — with the single existing-file touch being one flag-gated hook in `functions/api/ai/[[path]].js`.

**Architecture:** Additive pure ES modules under `functions/_connect/enterprise/*` and `functions/_connect/maik-bridge/*` (dependency-injected, `node --test`), exposed by NEW more-specific Pages-Functions route files under `functions/api/connect/enterprise/*` and `functions/api/connect/maik/*` (the existing catch-all router is untouched). RBAC is deny-by-default pure data; the MaiK bridge reuses the *unchanged* `engine.js`/`maik-context.js`; the egress gate is the *unchanged* R7 `assertEgressAllowed`. Enterprise is gated by the existing `smd_connect` flag; the MaiK hook is additionally gated by the NEW `smd_connect_maik` flag (both default OFF). See spec `docs/superpowers/specs/2026-08-01-connect-enterprise-maik-design.md`.

**Tech Stack:** Plain ES modules (no build, no TypeScript), `node:test` + `node:assert/strict`, WebCrypto (`globalThis.crypto`), Cloudflare Pages Functions + D1 + KV. No new npm dependencies. Reuses Phase-0 `testkit.js` (`makeMockDb`/`makeMockKv`/`flagOn`).

## Global Constraints

- **No new runtime dependencies.** Plain ES modules only. (spec §6)
- **Additive; ONE existing-file touch.** New files only under `functions/_connect/enterprise/*`, `functions/_connect/maik-bridge/*`, new route files under `functions/api/connect/enterprise/*` + `functions/api/connect/maik/*`, a new `functions/_connect/enterprise/schema.sql`, and `test/connect/*`. **`db/connect_schema.sql`, `engine.js`, `maik-context.js`, `identity.js`, `audit.js`, `secrets.js`, and the existing `functions/api/connect/[[path]].js` router are NOT modified.** The **only** existing-file edit is the flag-gated hook in `functions/api/ai/[[path]].js` (Task 8). Rollback = revert + flag-off. (spec §2, §6, ADR-D7)
- **Deny-by-default, fail-closed RBAC.** `can(role, action)` allows only explicit matrix entries; unknown role/action or any thrown error ⇒ deny. Do **NOT** copy the house KV fail-open default. (spec §3.1, ADR-D2)
- **Server-derived identity.** actor + tenant from `resolveActor`/`resolveTenant` (reusing `_usage.js identify`), never from the request body. (spec §3.2)
- **The egress invariant.** With `smd_connect_maik` ON + a live bundle + `egressBaaOk === false`, ZERO patient bytes reach the `callGemini` payload; the egress lane opens only when `assertEgressAllowed(bundle, tenant)` does not throw. (spec §0, §4.2)
- **No PHI in URLs/logs/KV.** `patientRef` is POST-body-only; the MaiK binding is envelope-**sealed** before KV; rate-limit keys are tenant+action+time; audit is PHI-free by construction (the `audit.js` ALLOW-list is reused unchanged — new action strings only, no new PHI fields). (spec §3.5, §4.4, §5)
- **Zero regression when off.** `smd_connect_maik` OFF (or no binding) ⇒ `pkg` and the `callGemini` input are byte-identical to today. The hook is provably inert and fail-safe (a Connect error degrades to "no context", never breaks/delays a MaiK answer). (spec §4.5–4.6)
- **DPDP.** EMR pull → hospital = Fiduciary, Connect = Processor; the egress lane is a sub-processing step the BAA/DPA must cover; forbidden without `egressBaaOk`; no secondary use. (spec §5)
- **Owner preconditions:** the `stewardmd-connect` D1 binding + `CONNECT_MASTER_KEY`/`CONNECT_HMAC_SALT` secrets exist from Phase 0; until then D1/KV-touching steps run against the injected `makeMockDb()`/`makeMockKv()`. `egressBaaOk` stays `false` until the §4.3 preconditions hold — nothing in this plan flips it.

---

## File structure

```
functions/_connect/enterprise/
  rbac.js            # Task 1 — ROLE_MATRIX + can(role, action); deny-by-default          [DUAL-ADVERSARIAL]
  schema.sql         # Task 1 — ADDITIVE new tables: connect_membership_invite,
                     #          connect_tenant_limits, connect_tenant_egress
  guard.js           # Task 1 — requireCan(deps, request, tenantId, action) → {actor, tenant, role}
  members.js         # Task 2 — membership CRUD (invite/setRole/remove) + last-owner/†-admin guards
  org.js             # Task 3 — createTenant/updateTenant/suspendTenant + mode guard
  ratelimit.js       # Task 4 — per-tenant per-action KV counter; fail-open counter
  observability.js   # Task 5 — tenant-scoped audit read + aggregate metrics (PHI-free)
functions/_connect/maik-bridge/
  lanes.js           # Task 6 — buildMaikContext → {deterministic, egress|null} via assertEgressAllowed
  attach.js          # Task 7 — seal/open + KV binding connect:maikbind:{actorId} (short TTL)
  bridge.js          # Task 6/7 — pullLanes(env, {request}) — identify → binding → engine → lanes
functions/api/connect/enterprise/[[path]].js   # Task 2/3/4/5 — NEW route (router untouched)
functions/api/connect/maik/[[path]].js         # Task 7 — NEW route: attach/detach
functions/api/ai/[[path]].js                   # Task 8 — ***THE ONE existing-file touch***   // VERIFY
test/connect/
  rbac.test.mjs  rbac-adversarial.test.mjs                     # Task 1  [DUAL-ADVERSARIAL]
  members.test.mjs                                             # Task 2
  org.test.mjs                                                 # Task 3
  ratelimit.test.mjs                                           # Task 4
  observability.test.mjs                                       # Task 5
  maik-bridge-lanes.test.mjs                                   # Task 6
  maik-attach.test.mjs                                         # Task 7
  maik-egress-invariant.test.mjs  maik-callsite-regression.test.mjs   # Task 8  [DUAL-ADVERSARIAL]
```

---

### Task 1 — RBAC matrix + fail-closed guard + additive schema  **[REVIEW: DUAL-ADVERSARIAL]**

**Files:** Create `functions/_connect/enterprise/rbac.js`, `functions/_connect/enterprise/guard.js`, `functions/_connect/enterprise/schema.sql`. Test `test/connect/rbac.test.mjs`, `test/connect/rbac-adversarial.test.mjs`.

**Interfaces:**
- Consumes: `resolveActor`, `resolveTenant` (`identity.js`), `PermissionError` (`permission.js`), `makeMockDb` (`testkit.js`).
- Produces: `ROLE_MATRIX` (pure data), `ACTIONS` (frozen list), `can(role, action) → boolean` (deny-by-default, try/catch ⇒ false), `requireCan(deps, request, tenantId, action) → {actor, tenant, role}` (throws `PermissionError` on deny; audits `outcome:"denied"`).

- [ ] **Step 1: Write the failing tests.** Positive: each row of spec §3.1 (`can('clinician','context:load')===true`, `can('auditor','audit:read')===true`, `can('admin','tenant:write')===true`, `can('owner','egress:baa')===true`). Negative/deny-by-default: `can('admin','context:load')===false`, `can('clinician','member:invite')===false`, `can('auditor','context:load')===false`, `can('clinician','egress:baa')===false`, `can('nope','tenant:read')===false`, `can('owner','no-such-action')===false`, `can(undefined,undefined)===false`. `requireCan` with a non-member ⇒ `PermissionError`; with a member lacking the action ⇒ `PermissionError`.
- [ ] **Step 2: Run — expect FAIL** (modules not found).
- [ ] **Step 3: Implement `rbac.js`** as pure data exactly matching spec §3.1 (owner enumerated explicitly — NO implicit wildcard). `can()` wraps lookup in try/catch returning `false` on any throw. Mark the matrix `// VERIFY` (owner ratifies admin-no-PHI, clinician self-only member:read, owner-only egress:baa).
- [ ] **Step 4: Implement `guard.js` `requireCan`** = `resolveActor` → `resolveTenant` (membership proof; tenant derived from the row) → `if(!can(role,action)) throw PermissionError` → return `{actor,tenant,role}`. On any throw, the caller writes a PHI-free `outcome:"denied"` audit event (reuse `makeAuditSink`).
- [ ] **Step 5: Write `schema.sql`** (ADDITIVE new tables only; `db/connect_schema.sql` untouched):
  - `connect_membership_invite(tenant_id, user_id, role, status, invited_by, created_at, PRIMARY KEY(tenant_id,user_id))` — `status ∈ invited|active`.
  - `connect_tenant_limits(tenant_id, action, window_sec, max_count, PRIMARY KEY(tenant_id,action))`.
  - `connect_tenant_egress(tenant_id PRIMARY KEY, baa_ok INTEGER DEFAULT 0, provider_tier TEXT, updated_by TEXT, updated_at TEXT)`.
- [ ] **Step 6: Refactor + run green.**
- [ ] **Step 7 (adversarial half):** `rbac-adversarial.test.mjs` — actively try to break it: a role string with trailing whitespace / different case / prototype-pollution key (`__proto__`, `constructor`); an action array instead of a string; a matrix entry mutated at runtime must not affect `can` (freeze `ROLE_MATRIX`); a thrown error inside a lookup must return `false` not propagate-as-allow; `requireCan` must never allow a body-supplied `tenantId` the actor is not a member of. **All must deny.** Then request TWO independent adversarial reviewers (escalation, cross-tenant, error-as-allow, unknown-action) before this task is done.

---

### Task 2 — Membership management (invite / assign role / remove)

**Files:** Create `functions/_connect/enterprise/members.js`, `functions/api/connect/enterprise/[[path]].js` (router for the enterprise sub-tree; members routes now, org/ratelimit/observability added in Tasks 3–5). Test `test/connect/members.test.mjs`.

**Interfaces:** `listMembers(deps, request, tenantId)` (`member:read`), `invite(deps, request, tenantId, {userId, role})` (`member:invite`), `setRole(deps, request, tenantId, {userId, role})` (`member:role`), `removeMember(deps, request, tenantId, {userId})` (`member:remove`). Each begins with `requireCan(...)`.

- [ ] **Step 1: Failing tests** — an admin invites a clinician ⇒ row in `connect_membership_invite status:'invited'`; a clinician calling `invite` ⇒ `PermissionError`; `setRole` validates against the enum (unknown role refused, nothing written); **admin cannot remove/demote an owner** (†) ⇒ `PermissionError`; **last-owner protection** — removing/demoting the final `owner` ⇒ refused; a member of tenant A cannot list tenant B (cross-tenant deny); every mutation writes a PHI-free audit event (`member.invite`/`role.change`/`member.remove`, actor + target user-id + role, NO name/email).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the CRUD with the guards; an `invited` row is promoted to `active` on the invitee's first authenticated `resolveTenant` (add that promotion in `members.js`, not in the frozen `identity.js` — a helper the enterprise route calls). Validate role ∈ `{owner,admin,clinician,auditor}`.
- [ ] **Step 4: Wire the enterprise route** `functions/api/connect/enterprise/[[path]].js` — `flagOn(env)` (`smd_connect`) gate → 404 when off; `no-store`; parse the sub-path (`members`); dispatch; sanitize typed errors to codes (`PermissionError`→403, `AuthError`→401) with non-PHI bodies.
- [ ] **Step 5: Refactor + run green.**

---

### Task 3 — Org / tenant lifecycle + mode guard

**Files:** Create `functions/_connect/enterprise/org.js`; extend the enterprise route with `org` paths. Test `test/connect/org.test.mjs`.

**Interfaces:** `createTenant(deps, request, {id,name})`, `updateTenant(deps, request, tenantId, patch)`, `suspendTenant(deps, request, tenantId)` — all `tenant:write` (owner/admin).

- [ ] **Step 1: Failing tests** — create/update/suspend by owner ⇒ ok; by clinician/auditor ⇒ `PermissionError`; `id` not matching `[a-z0-9-]` ⇒ refused; a `mode:'live'` transition ⇒ **refused** (Phase-1 R3 owns the per-request live gate; Enterprise does not open blanket live); status writes audited.
- [ ] **Step 2: Run — expect FAIL.**  **Step 3: Implement** with the `[a-z0-9-]` id restriction + the `live` refusal reusing the `tenant.js` posture. **Step 4:** wire `org` sub-paths. **Step 5:** refactor + green.

---

### Task 4 — Per-tenant rate-limits (fail-open counter, fail-closed authz)

**Files:** Create `functions/_connect/enterprise/ratelimit.js`; extend the enterprise route with `ratelimit` (config write, `ratelimit:write`). Test `test/connect/ratelimit.test.mjs`.

**Interfaces:** `setLimit(deps, request, tenantId, {action, windowSec, maxCount})` (`ratelimit:write`); `checkAndCount(kv, db, tenantId, action, now) → {ok, used, limit}` (enforcement primitive, no RBAC — called by already-authorized actions).

- [ ] **Step 1: Failing tests** — under the limit ⇒ `{ok:true}`; at the limit ⇒ `{ok:false}`; the KV key is `connect:rl:{tenantId}:{action}:{windowEpoch}` and contains **no** patient identifier / `patientRef` (assert the key shape); a **KV read/write error on the counter ⇒ `{ok:true}` (fail-open)** — a metering blip never denies a clinical call; but an **RBAC** failure on `setLimit` ⇒ `PermissionError` (fail-closed). A missing config falls back to conservative defaults.
- [ ] **Step 2: Run — expect FAIL.**  **Step 3: Implement** the fixed-window counter (`connect:*` ns) with the documented fail-open-counter / fail-closed-authz split (spec §3.5, ADR-D8, `// VERIFY`). On exceed, the *caller* (context/attach) returns 429 + a `ratelimit.block` audit event.  **Step 4:** wire the config route.  **Step 5:** refactor + green.

---

### Task 5 — Tenant-scoped audit + observability views (PHI-free)

**Files:** Create `functions/_connect/enterprise/observability.js`; extend the enterprise route with `audit` + `observability` reads. Test `test/connect/observability.test.mjs`.

**Interfaces:** `readAudit(deps, request, tenantId, filter)` (`audit:read`); `metrics(deps, request, tenantId) → {counts, allowDenyRatio, ratelimitBlocks, latencyP50/P95, egressOpen, deterministicOnly}` (`observability:read`).

- [ ] **Step 1: Failing tests** — owner/admin/auditor of tenant A read A's audit; **owner of A cannot read B** (tenant scope from membership, not from a client filter that could widen); `metrics` returns aggregates only — **no `patient_ref_hash`, no per-patient rows** in the output; a clinician calling either ⇒ `PermissionError`.
- [ ] **Step 2: Run — expect FAIL.**  **Step 3: Implement** reads over `connect_audit_event` (already PHI-free); force the tenant filter server-side from the membership.  **Step 4:** wire routes.  **Step 5:** refactor + green.

---

### Task 6 — MaiK bridge core: lanes + engine reuse + egress split

**Files:** Create `functions/_connect/maik-bridge/lanes.js`, `functions/_connect/maik-bridge/bridge.js`. Test `test/connect/maik-bridge-lanes.test.mjs`.

**Interfaces:**
- Consumes: `buildMaikContext`, `assertEgressAllowed`, `EgressBlocked` (`maik-context.js`, UNCHANGED); `loadPatientContext` (`engine.js`, UNCHANGED).
- Produces: `splitLanes(bundle, tenant) → {deterministic, egress|null, notice|null}`; `pullLanes(env, {request, deps}) → {deterministic, egress|null, notice|null} | null` (identify → binding (Task 7) → engine → `buildMaikContext` → `splitLanes`).

- [ ] **Step 1: Failing tests** — `splitLanes` with a **sandbox** tenant (synthetic bundle) ⇒ `egress` populated (gate passes), `notice` null; with a **live** tenant + `egressBaaOk:false` ⇒ `egress === null`, `notice` set, `deterministic` populated; with `egressBaaOk:true` ⇒ `egress` populated. The deterministic lane contains structured coded facts (problem/med/allergy labels + status/value/interpretation) and **no vendor fields / no provenance** (already guaranteed by `buildMaikContext`, assert it). `pullLanes` returns `null` when no binding exists.
- [ ] **Step 2: Run — expect FAIL.**  **Step 3: Implement** `splitLanes` = call `assertEgressAllowed(bundle, tenant)` in try/catch: on `EgressBlocked` ⇒ `egress:null` + the notice; else build the `patientCase`-shaped egress block. `deterministic` is derived from `buildMaikContext` regardless. `pullLanes` composes the `tenant` object with `egressBaaOk` read from `connect_tenant_egress` (Task 1 schema).  **Step 4:** refactor + green. (The engine and `maik-context.js` are NOT edited — depend on R7 exactly as Phase-1 left it.)

---

### Task 7 — MaiK-session binding (sealed, no-PHI-in-KV) + attach route

**Files:** Create `functions/_connect/maik-bridge/attach.js`, `functions/api/connect/maik/[[path]].js`. Test `test/connect/maik-attach.test.mjs`.

**Interfaces:** `attach(deps, request, {tenantId, connectorId, patientRef})` (`maik:attach`) — `requireCan` → `makeSecrets(env).seal(JSON.stringify({tenantId,connectorId,patientRef}))` → `kv.put("connect:maikbind:"+actorId, sealed, {expirationTtl})`; `detach(deps, request)`; `readBinding(env, kv, actorId) → {tenantId,connectorId,patientRef} | null` (open the seal). Used by `pullLanes` (Task 6).

- [ ] **Step 1: Failing tests** — attach by a clinician ⇒ a KV value under `connect:maikbind:{actorId}` that is **ciphertext** (assert the stored value does NOT contain the plaintext `patientRef` / MRN substring — the no-PHI-in-KV proof, `// VERIFY`); `readBinding` round-trips to the original; attach by admin/auditor ⇒ `PermissionError`; a new attach overwrites the prior (one active binding); `detach` deletes; every attach/detach emits a PHI-free audit event (`maik.attach`/`maik.detach`, `patientRefHash` only — no raw ref). TTL is passed to `kv.put` (`// VERIFY` the value).
- [ ] **Step 2: Run — expect FAIL.**  **Step 3: Implement** with envelope seal/open + short TTL; audit via `makeAuditSink` + `hmacPseudonym`.  **Step 4: Wire the maik route** — `flagOn(env)` (`smd_connect`) gate; `no-store`; `attach`/`detach`; sanitize typed errors.  **Step 5:** refactor + green.

---

### Task 8 — The ONE existing-file touch: flag-gated hook in the LIVE MaiK/AI endpoint  **[REVIEW: DUAL-ADVERSARIAL]**  `// VERIFY`

**Files:** Add `functions/_connect/maik-bridge/hook.js` (the small, testable adapter the endpoint calls) + `maikWiringOn(env)` (reads `CONNECT_MAIK_FLAG === "1"` AND `flagOn(env)`). **Edit `functions/api/ai/[[path]].js`** — the single existing-file touch. Test `test/connect/maik-egress-invariant.test.mjs`, `test/connect/maik-callsite-regression.test.mjs`.

**Interfaces:** `hook.js` exports `applyConnectContext(env, request, pkg) → {pkg, connectContext, notice} | {pkg}` — pure enough to unit-test without the whole endpoint: if `!maikWiringOn(env)` return `{pkg}` unchanged; else `pullLanes`; if lanes present, attach `lanes.egress` to `pkg.patientCase` **only when non-null**, set `connectContext = lanes.deterministic`, `notice = lanes.notice`. Wrapped so any throw returns `{pkg}` unchanged (fail-safe).

- [ ] **Step 1: Write the failing invariant + regression tests FIRST.**
  - `maik-egress-invariant.test.mjs` (**the adversary test**): flag ON, a bound **live** bundle with distinctive synthetic markers (a labelled MRN `MRN-Z9`, a condition text `TESTOSIS-XYZ`, a med label `ZZDRUG`), `egressBaaOk:false`. Assert: `applyConnectContext` returns a `pkg` whose **full JSON serialization contains none** of those marker substrings (they must not reach `renderGroundedPrompt`/`callGemini`); `connectContext` (device-only) DOES contain them; `notice` is set. Repeat the smuggle-probes: they must not appear via `patientCase`, via any retrieval-bias field, via `history`, or via the notice string.
  - `maik-callsite-regression.test.mjs`: flag OFF ⇒ `applyConnectContext` returns the input `pkg` **by identity / deep-equal unchanged** (byte-identical prompt); no binding + flag ON ⇒ unchanged; a thrown bridge error ⇒ unchanged (fail-safe).
- [ ] **Step 2: Run — expect FAIL** (`hook.js` missing).
- [ ] **Step 3: Implement `hook.js`** per the interface, with the mandatory fail-safe try/catch and the "attach egress ONLY when non-null" rule.
- [ ] **Step 4: Make the SINGLE edit to `functions/api/ai/[[path]].js`.** `// VERIFY` the exact insertion points against the live file first (they drift): in the `explain` handler, immediately before `let grounded = renderGroundedPrompt(pkg)`; in the `research` handler, at the analogous grounded-prompt assembly. Insert only:
  ```
  let connectContext = null;
  if (maikWiringOn(env)) {
    try { const r = await applyConnectContext(env, request, pkg); pkg = r.pkg; connectContext = r.connectContext || null;
          if (r.notice) pkg._connectNotice = r.notice; } catch (e) {}   // fail-safe: never break a MaiK answer
  }
  ```
  and include `connectContext` (device-only deterministic lane) + `_connectNotice` in the JSON response the client already receives. **Nothing else changes.** No new import at module top beyond `applyConnectContext`/`maikWiringOn` from `maik-bridge/hook.js`. Confirm the flag-off path adds no cost and does not touch the 90 s client watchdog.
- [ ] **Step 5: Run green; prove zero-regression** by diffing the `callGemini` input for a fixed request flag-off vs pre-change (byte-identical).
- [ ] **Step 6 (DUAL-ADVERSARIAL):** request TWO independent adversarial reviewers to try to (a) get any patient byte into the `callGemini` payload with `egressBaaOk:false` (smuggle via any pkg field, via the notice, via a crafted bundle), (b) make the flag-off path differ from baseline, (c) make a bridge error throw out of the handler and break/delay the answer. Both reviewers must clear it before merge.

---

### Task 9 — Owner-onboarding checklist + reviewer panel + docs

**Files:** Create `docs/connect/track-d-enterprise-maik.md` (RBAC matrix, the egress-gate operating procedure, the go-live gates). No code.

- [ ] **Step 1:** Consolidate every `// VERIFY` pinned by Tasks 1–8 (spec §11): the RBAC matrix ratification, the MaiK call-site, the `egressBaaOk`/provider-tier preconditions (§4.3), the rate-limit split, the binding TTL, the attach-UI location, DPDP processor-contract-names-the-LLM-sub-processor.
- [ ] **Step 2:** Write the **egress go-live gate** as an explicit checklist: no `egressBaaOk` flip until (1) signed BAA/DPA, (2) a configured no-retention/no-training provider tier, (3) agreed de-identification posture. Until then, MaiK on live tenants is deterministic-lane-only.
- [ ] **Step 3:** Run the reviewer panel (spec §9); the two DUAL-ADVERSARIAL tasks require two independent reviewers each.

---

## Task dependency / build order

```
Task 1 (RBAC + schema + guard)  ── prerequisite for ── Tasks 2,3,4,5,7,8 (all authorize via requireCan/can)
Task 6 (lanes/bridge core)      ── prerequisite for ── Task 7 (pullLanes uses readBinding) and Task 8 (hook uses pullLanes)
Task 7 (binding + attach route) ── prerequisite for ── Task 8 (the hook reads the binding)
Tasks 2,3,4,5 are independent of each other after Task 1 (may run in parallel).
Task 8 is LAST of the code tasks (the live-product touch) — build it only after 1/6/7 are green.
Task 9 (onboarding) authored last so it captures every // VERIFY.
```

## Execution handoff

Create the recovery tag `pre-connect-track-d` off the current Connect head, then build on `feat/connect-track-d-enterprise-maik`. Build order = Task 1 → 9, each: failing test → minimum code → refactor → commit. **Task 1 (RBAC enforcement) and Task 8 (the MaiK-egress gate) are each REVIEW: DUAL-ADVERSARIAL** — two independent adversarial reviewers must clear each before it counts as done; do not merge those on a single reviewer. **Task 8 is the ONLY existing-file touch (`functions/api/ai/[[path]].js`) — treat it as touching the LIVE, shipping MaiK product: `// VERIFY` the insertion points, keep the flag-off path byte-identical, keep the hook fail-safe.** On completion, Track D is feature-complete behind `smd_connect` (existing, OFF) + `smd_connect_maik` (new, OFF), pending the owner go-live gates in the Task-9 checklist — above all, the `egressBaaOk` gate that alone lets real PHI reach the LLM.
