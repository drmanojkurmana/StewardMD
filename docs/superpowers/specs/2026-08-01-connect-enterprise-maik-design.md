# StewardMD Connect — Track D: Enterprise + MaiK Wiring (Design)

**Date:** 2026-08-01
**Status:** Draft for owner review (no implementation until approved)
**Builds on:** Part-1 v1.1 (`2026-07-31-stewardmd-connect-part1-foundation-design.md`) — Phase 0 MERGED to main (commit 54b1b949), flag `smd_connect` OFF — and Part-2/Phase-1 ABDM (`2026-07-31-stewardmd-connect-part2-abdm-design.md`), esp. **R7** (the MaiK-egress predicate fix) and **R15** (DPDP HIU=Fiduciary vs HIP-pull=Processor).
**Author:** Claude (acting Principal/Interoperability Architect)
**Two linked capabilities:** (D-1) **Enterprise** — real multi-tenant org management + fail-closed RBAC on the Phase-0 `connect_membership`/`resolveTenant` seam. (D-2) **MaiK wiring** — wire the canonical SCCM patient context into the LIVE MaiK reasoning **behind the anti-corruption egress layer**, so MaiK consumes `buildMaikContext(bundle)` and never a vendor schema, and **real PHI stays blocked from LLM egress until the BAA/no-retention gate (`assertEgressAllowed`) passes**.

---

## 0. The hard invariant (read first)

> **Flag-on is NOT consent to send PHI to a third-party LLM.** With `smd_connect_maik` ON and a real, consented, *live* patient bundle bound to a MaiK session, the canonical context feeds **only the deterministic MaiK reasoning** (on-device engine + KB retrieval biasing) and the answer the clinician sees on **their own authorized device**. It does **NOT** reach Vertex/Gemini. The LLM-egress lane opens **only** when `assertEgressAllowed(bundle, tenant)` passes — i.e. `tenant.mode === "sandbox"` (synthetic-only dev/test) **or** `tenant.egressBaaOk === true` (a signed BAA/DPA + a no-retention/no-training provider tier). This is the R7 guard, unchanged. Track D **consumes** it; it never weakens it.

The load-bearing distinction: **"the treating clinician's device" is an authorized recipient of their own patient's record; "a third-party LLM (Vertex/Gemini)" is not, until a BAA/no-retention tier exists.** The egress guard governs the *second* boundary only.

---

## 1. What Track D adds (and does not)

Phase 0 gave us: SCCM v1 + validator, the injected connector contract, the fail-closed/ephemeral `ConnectEngine.loadPatientContext`, `resolveTenant`/`connect_membership`, PHI-free audit, envelope secrets, and the `buildMaikContext`/`assertEgressAllowed` boundary (`functions/_connect/maik-context.js`). Phase 1 made Connect a real ABDM participant. **Track D turns the platform into something a hospital can operate and something MaiK can actually use:**

- **D-1 Enterprise.** A real org/tenant admin plane: membership management (invite / assign role / remove) with roles **owner / admin / clinician / auditor**; a **deny-by-default RBAC matrix** enforced server-side on every Connect action; **per-tenant rate-limits**; **per-tenant audit + observability views** (built from the already-PHI-free audit table). Builds on the *existing* `connect_tenant` / `connect_membership` tables — adds an additive enterprise schema, not a parallel auth system. Gated by the existing `smd_connect` flag (OFF).
- **D-2 MaiK wiring.** A server-side **bridge** that, when a clinician has attached a Connect patient to their MaiK session, pulls the canonical bundle through the *unchanged* Phase-0 engine, flattens it via the *unchanged* `buildMaikContext`, splits it into a **deterministic lane** (always available for a consented bundle) and a **gated LLM-egress lane** (opened only by `assertEgressAllowed`), and hands MaiK **only what the gate allows**. Double-gated by `smd_connect` **and** the new `smd_connect_maik` flag (both OFF).

**NOT in Track D:** ABAC / attribute policies beyond the role matrix (Phase 3 remains); a self-service onboarding portal UI (the admin plane here is API-only + reuses owner tooling); consent-workflow changes (Phase 1 owns consent); any change to MaiK's deterministic engine, prompts, or clinical behavior when the flag is off; any new terminology mapping. The **only** live-product surface touched is one flag-gated call-site in the MaiK/AI endpoint.

---

## 2. Reconciliation with Phase 0 / Phase 1 (the seams we extend, never fork)

| Seam (as-built) | Track D use |
|---|---|
| `connect_membership(user_id, tenant_id, role)` + `resolveTenant(db, actorId, tenantId)` (`identity.js`) | **D-1** membership-management CRUD writes here; `resolveTenant` already returns `{tenant, role}` — the RBAC gate consumes that `role`. No new identity source. |
| `resolveActor(identifyFn, request, env)` — server-derived, non-guest, rejects body-supplied identity | Reused verbatim for every Enterprise + MaiK-bridge call. `identifyFn` = `_usage.js identify` (the canonical object form the AI endpoint already imports). |
| `permission.js` `enforceScope` + typed `AuthError/PermissionError/SandboxViolation/UpstreamError` — **fail-closed** ("any failure ⇒ deny") | The RBAC `can()` gate follows the **same** fail-closed idiom (deny on any error). We explicitly do **not** copy the house KV fail-*open* default. |
| `engine.js loadPatientContext(env, deps, req, io)` — resolve identity/tenant → sandbox gate → fail-closed scope → fetch → normalize → validate → filter → PHI-free audit → return, persist nothing | The MaiK bridge **calls it as-is**. No changes to the engine. The bridge is a thin caller + lane-splitter downstream of the returned `CanonicalBundle`. |
| `maik-context.js` — `buildMaikContext(bundle)` (SCCM-only flatten, no vendor fields/provenance) + `assertEgressAllowed(bundle, tenant)` (R7: throws `EgressBlocked` unless `sandbox` or `tenant.egressBaaOk`) | The bridge's **entire reason to exist**: consume `buildMaikContext` output; gate the LLM-egress lane on `assertEgressAllowed`. **Zero edits** to this file — Track D depends on R7 exactly as Phase-1 left it. |
| `audit.js` — `buildAuditEvent` (field allow-list, structurally drops non-listed keys), `hmacPseudonym`, append-only `makeAuditSink` | Enterprise admin events + MaiK attach/pull events reuse this sink. New action strings only (`member.invite`, `role.change`, `maik.attach`, `maik.pull`, `ratelimit.block`, `observability.read`) — **no new PHI-bearing fields**, so the allow-list is untouched and continues to drop anything else by construction. |
| `secrets.js` — `makeSecrets(env)` envelope AES-GCM, fail-closed on missing `CONNECT_MASTER_KEY` | The MaiK-session **binding** (`{tenantId, connectorId, patientRef}`) is **envelope-sealed** before it touches KV — `patientRef` is PHI-in-transit and never lands in KV as plaintext. |
| `tenant.js` — `assertSandboxAllowed` + `SANDBOX_ALLOWLIST`; `mode:"live"` refused in Phase 0 | Enterprise tenant-lifecycle keeps this refusal (mode transitions to `live` remain owner + consent-gated per Phase-1 R3). Enterprise does not open `live`. |
| Existing catch-all router `functions/api/connect/[[path]].js` | **Untouched.** Enterprise + attach routes ship as **new, more-specific** Pages-Functions route files (`functions/api/connect/enterprise/[[path]].js`, `functions/api/connect/maik/[[path]].js`) that Cloudflare routes ahead of the catch-all. |

**The ONE existing-file touch (the whole point of the invariant):** `functions/api/ai/[[path]].js` — a flag-gated hook in the `explain` and `research` handlers, immediately before `renderGroundedPrompt(pkg)` / `callGemini`. `smd_connect_maik` OFF ⇒ a single early-return guard, byte-for-byte unchanged behavior. `// VERIFY` the exact insertion points against the live file before editing (this is the shipping MaiK product).

---

## 3. D-1 Enterprise — org management + RBAC

### 3.1 The RBAC role matrix (the security core) — `// VERIFY`

Deny-by-default. `can(role, action) → boolean` returns `true` **only** if the action is explicitly listed for the role; anything else, an unknown role, an unknown action, or any thrown error ⇒ **deny**. There is no wildcard except `owner`, which is enumerated explicitly (no implicit "owner can do anything" that could mask a bug).

| Action (Connect capability) | owner | admin | clinician | auditor |
|---|:---:|:---:|:---:|:---:|
| `tenant:read` (metadata) | ✔ | ✔ | ✔ | ✔ |
| `tenant:write` (create/update/suspend, mode) | ✔ | ✔ | ✕ */ | ✕ |
| `member:read` | ✔ | ✔ | self only ‡ | ✔ |
| `member:invite` | ✔ | ✔ | ✕ | ✕ |
| `member:role` (assign/change role) | ✔ | ✔ † | ✕ | ✕ |
| `member:remove` | ✔ | ✔ † | ✕ | ✕ |
| `connector:read` | ✔ | ✔ | ✔ | ✔ |
| `connector:write` / `connector:validate` | ✔ | ✔ | ✕ | ✕ |
| `context:load` (**pull patient PHI**) | ✕ ⚑ | ✕ ⚑ | ✔ | ✕ |
| `maik:attach` (**bind a patient to MaiK**) | ✕ ⚑ | ✕ ⚑ | ✔ | ✕ |
| `ratelimit:write` (per-tenant limits) | ✔ | ✔ | ✕ | ✕ |
| `audit:read` (tenant-scoped) | ✔ | ✔ | ✕ | ✔ |
| `observability:read` (aggregate metrics) | ✔ | ✔ | ✕ | ✔ |
| `egress:baa` (flip `egressBaaOk`) | ✔ ⚑⚑ | ✕ | ✕ | ✕ |

Legend / **owner-decisions to ratify (`// VERIFY`)**:
- **⚑ PHI is clinician-only by default.** `admin` and `owner` are *org-administration* roles; they manage members/connectors/limits but **cannot pull patient content or attach a patient to MaiK** unless they *also* hold a `clinician` membership. This is deliberate least-privilege — **owner must confirm** whether an org-admin should ever read PHI. Deny-by-default means silence ⇒ no PHI for admins.
- **† admin cannot act on an owner** (cannot remove/demote an owner; cannot grant `owner`). Only an owner grants/revokes `owner`. **Last-owner protection:** removing/demoting the final `owner` of a tenant is refused.
- **‡ clinician `member:read`** is limited to their own membership row (confirm: should a clinician see the full member roster? default no).
- **⚑⚑ `egress:baa`** — flipping `tenant.egressBaaOk` (the switch that lets real PHI reach the LLM) is **owner-only**, audited, and additionally requires the operational precondition in §4.3 (a real BAA/DPA + provider no-retention tier). This is not a routine toggle.
- **`*/` clinician `tenant:write`** — default **deny**; a clinician does not administer the org.

The matrix lives in `functions/_connect/enterprise/rbac.js` as pure data (`ROLE_MATRIX`) + `can(role, action)`. It is the **DUAL-ADVERSARIAL** target: two independent reviewers must actively try to (a) escalate a clinician/auditor into a write/PHI action, (b) get a `true` from an unknown role/action, (c) act cross-tenant, (d) survive a thrown error as an allow.

### 3.2 Enforcement (fail-closed, server-derived, IDOR-safe)

Every Enterprise + MaiK-bridge entry point runs the same guard, in order:

1. `actor = await resolveActor(identify, request, env)` — non-guest, server-derived. (Never trust body identity.)
2. `{tenant, role} = await resolveTenant(db, actor.id, tenantId)` — membership proven; **tenant is derived from the membership row, not echoed from the body** for read/write on a tenant the actor belongs to. For a body-supplied `tenantId`, membership is the authorization; a non-member throws `PermissionError` (deny) exactly as today.
3. `if (!can(role, action)) throw new PermissionError(...)` — **deny-by-default**; any throw anywhere in 1–3 ⇒ deny + a PHI-free `outcome:"denied"` audit event.

No RBAC decision is ever cached at module scope (Workers isolates are reused across tenants — a cached allow would leak). Every request re-derives identity → membership → role → decision.

### 3.3 Membership management — `functions/_connect/enterprise/members.js` + route

CRUD over `connect_membership`, RBAC-gated: `listMembers` (`member:read`), `invite`/`addMember` (`member:invite`), `setRole` (`member:role`, with the †/last-owner guards), `removeMember` (`member:remove`, last-owner guard). An **invite** creates a membership row in `status:'invited'` (see schema) that becomes `active` on the invitee's first authenticated resolve; no email/PII in KV or logs — the invite is keyed by the invitee's existing StewardMD account id (the same id `identify()` returns). Roles are validated against the enum; an unknown role is refused (not stored). Every mutation emits a PHI-free audit event (`member.invite` / `role.change` / `member.remove`, actor + target actor-id + role — no names/emails).

### 3.4 Org / tenant lifecycle — `functions/_connect/enterprise/org.js` + route

`createTenant` / `updateTenant` / `suspendTenant` (`tenant:write`, owner/admin). `mode` transitions are **guarded**: `sandbox → live` stays refused here (Phase-1 R3 owns the per-request-artifact live gate; Enterprise does not open blanket `live`). `id` restricted to `[a-z0-9-]` (KV-delimiter-safe, per foundation). This overlaps the foundation's `POST /api/connect/tenants` conceptually but is implemented as a new module so the existing router is untouched; the owner may instead fold it into the existing tenants route (owner-decision).

### 3.5 Per-tenant rate-limits — `functions/_connect/enterprise/ratelimit.js`

A per-tenant, per-action fixed-window counter in the dedicated `connect:*` KV namespace: key `connect:rl:{tenantId}:{action}:{windowEpoch}`, value = an integer count (**non-PHI**; no patient identifiers, no `patientRef` — the key is tenant+action+time only). Limits are configured per tenant in the enterprise schema (`connect_tenant_limits`); a missing config falls back to conservative platform defaults. Enforced on the cost/PHI-bearing actions (`context:load`, `maik:attach`, `connector:validate`). On **limit exceeded** ⇒ `429` + a `ratelimit.block` audit event.

**Fail-open/closed split (explicit, `// VERIFY`):** the **authorization** gate (RBAC) is *fail-closed*. The **throttle counter** is a *secondary availability control*: a KV read/write error on the counter **does not deny a clinical call** (fail-open on the counter only), because a metering infra blip must never block a treating clinician — this mirrors the AI endpoint's existing "fail-open on any store/identity error so metering never breaks a clinical AI call." The owner ratifies this split.

### 3.6 Audit + observability views — `functions/_connect/enterprise/observability.js` + route

The audit table (`connect_audit_event`) is **already PHI-free by construction** (field allow-list; `patient_ref_hash` is a per-tenant HMAC pseudonym, not de-identified but never the raw ref). Track D adds **read** surfaces, all tenant-scoped even for owner (an owner of tenant A cannot read tenant B):

- `GET /api/connect/enterprise/audit?tenant=…&…` — `audit:read` (owner/admin/auditor). Tenant-filter is applied server-side from the membership, not from a client filter that could be widened.
- `GET /api/connect/enterprise/observability?tenant=…` — `observability:read`. Returns **aggregates only** derived from the audit rows: counts by `action`/`outcome`, allow/deny ratio, `ratelimit.block` count, latency percentiles (`latency_ms`), egress-lane-open vs deterministic-only counts. No per-patient rows, no `patient_ref_hash` in the aggregate output.

This satisfies the "per-tenant audit/observability views" requirement without any new PHI surface: everything derives from data that is already PHI-free.

---

## 4. D-2 MaiK wiring — canonical context into the LIVE MaiK, behind the egress gate

### 4.1 Flow (server-centric so the invariant lives where the egress lives)

```
[clinician, in a NEW Connect surface] attach patient
      │  POST /api/connect/maik/attach {tenantId, connectorId, patientRef}
      │  RBAC maik:attach → envelope-seal {tenantId,connectorId,patientRef} → KV connect:maikbind:{actorId} (short TTL)
      ▼
[clinician asks MaiK a question]  (home.js runClinical → POST /api/ai/explain — UNCHANGED client)
      │
      ▼  ── functions/api/ai/[[path]].js  (THE ONE existing-file touch, flag-gated) ──
   smd_connect_maik ON?  ──no──►  early return; pkg untouched; MaiK behaves EXACTLY as today
        │ yes
        ▼
   binding for identify(request).id ?  ──none──►  early return; unchanged
        │ present
        ▼
   MaiKBridge.pullLanes(env, {actorId}) ──►  open seal ──► ConnectEngine.loadPatientContext(...)  [Phase-0, unchanged]
                                            ──► buildMaikContext(bundle)                         [unchanged]
                                            ──► split lanes:
                                                 • deterministic  (always, for a consented bundle)
                                                 • egress          (ONLY if assertEgressAllowed(bundle, tenant) passes)  ◄── R7
        │
        ▼
   egress lane present?  ──yes──►  merge into pkg.patientCase → renderGroundedPrompt → callGemini (LLM sees patient context)
                          ──no───►  deterministic lane only: bias KB retrieval + return an on-device `connectContext`
                                    to the clinician's device; add a visible notice
                                    ("patient record used for on-device reasoning only; not sent to the AI model");
                                    the callGemini payload gets ZERO patient bytes.
```

Why server-centric: `callGemini` is the third-party egress and it runs **server-side**. Placing the pull + the `assertEgressAllowed` gate at the server call-site means the invariant is enforced at exactly the boundary it protects, and the **client (`home.js`) never changes** — it keeps posting the same `pkg`; the server decides, from a server-held binding, whether any patient context is added. The client can never smuggle Connect PHI into the prompt because the Connect PHI **only exists server-side** and is added only after the gate.

### 4.2 The two lanes — `functions/_connect/maik-bridge/lanes.js`

`buildMaikContext(bundle)` returns the SCCM-only flat object (patient demographics, problems, medications, allergies, labs, vitals, reports, documents — all `text`-fallback labels, no vendor fields, no provenance). The bridge splits it:

- **Deterministic lane** — the *structured, coded* facts (problem labels + clinicalStatus, medication labels + status, allergy labels + criticality, lab labels + numeric value + interpretation). Consumed by MaiK's **deterministic** path: (a) retrieval biasing (the KB *topic names* used to weight what StewardMD knowledge is retrieved — topic names are not PHI), and (b) returned to the **clinician's own device** as `connectContext` for the on-device engine's use. **Never** serialized into the Gemini prompt.
- **LLM-egress lane** — the patient-context block that *would* be written into the grounded prompt's `=== PATIENT ===` section (`pkg.patientCase`-shaped). Emitted **only** when `assertEgressAllowed(bundle, tenant)` does not throw. When it throws (`EgressBlocked`), the egress lane is `null` and the bridge contributes **zero bytes** to the `callGemini` payload.

The `tenant` object passed to `assertEgressAllowed` carries `mode` (from `connect_tenant`) and `egressBaaOk` (from the enterprise egress table, §4.3). Sandbox/synthetic ⇒ `mode:"sandbox"` ⇒ gate passes ⇒ the full path is exercisable in dev/test with synthetic fixtures. Live/real ⇒ gate requires `egressBaaOk`.

### 4.3 The BAA/no-retention gate config — `// VERIFY`

`tenant.egressBaaOk` is **not** a loose settings flag. It is a dedicated, owner-only, audited record — `connect_tenant_egress(tenant_id, baa_ok, provider_tier, updated_by, updated_at)` in the enterprise schema — flipped **only** via `egress:baa` (owner, §3.1) and **only** when the operational preconditions hold:

1. a signed **BAA/DPA** with the LLM provider covering this tenant's PHI (DPDP: hospital = Fiduciary for an EMR pull, Connect = **Processor** — see §5);
2. a **no-retention / no-training** provider tier is configured for the MaiK LLM calls (`provider_tier` names it — e.g. a Vertex/Gemini enterprise no-retention endpoint) `// VERIFY the exact tier + endpoint + who provisions it`;
3. de-identification posture agreed for the egress lane (Phase-3 "clinical-only" mode is the eventual stricter form; until then the egress lane is the SCCM patient block, and the owner accepts that a consented, BAA-covered, no-retention egress of that block is lawful).

Until all three hold for a tenant, `baa_ok` stays `false`, `assertEgressAllowed` throws for any live bundle, and real PHI **cannot** reach Gemini regardless of any flag. Flipping this is the single most consequential owner action in Track D.

### 4.4 The MaiK-session binding — `functions/_connect/maik-bridge/attach.js` + route

`POST /api/connect/maik/attach {tenantId, connectorId, patientRef}` — RBAC `maik:attach` (clinician). Server derives actor+tenant, envelope-**seals** `{tenantId, connectorId, patientRef}` with `makeSecrets(env).seal`, and stores the ciphertext under `connect:maikbind:{actorId}` in the `connect:*` KV namespace with a **short TTL** (a MaiK session, minutes-to-hours — `// VERIFY the exact TTL`). **No raw `patientRef` in KV** — only ciphertext; `patientRef` may embed an MRN, so this preserves "no PHI in KV." `POST /api/connect/maik/detach` deletes the key. Every attach/detach emits a PHI-free audit event (`maik.attach` / `maik.detach`, `patientRefHash` only). One active binding per clinician's MaiK session; a new attach overwrites the prior.

The AI endpoint's hook looks up the binding by `identify(request).id` alone — no `tenantId` needed from the MaiK call (the sealed binding carries it). One KV `get` per MaiK call **only when the flag is on**; flag-off is a pure early return (zero added cost, zero behavior change).

### 4.5 The single existing-file touch — `functions/api/ai/[[path]].js` — `// VERIFY`

A flag-gated block in the `explain` handler (after `pkg` is assembled, before `renderGroundedPrompt(pkg)` at the current `let grounded = renderGroundedPrompt(pkg)` line) and the analogous point in the `research` handler. Shape:

```
// smd_connect_maik (default OFF). Inert unless BOTH smd_connect and this flag are on AND a binding exists.
if (maikWiringOn(env)) {
  try {
    const lanes = await MaiKBridge.pullLanes(env, { request });   // identify() inside; null if no binding
    if (lanes) {
      connectContext = lanes.deterministic;                        // returned to the device in the JSON response
      if (lanes.egress) pkg.patientCase = mergePatientCase(pkg.patientCase, lanes.egress);  // ONLY when gate passed
      else pkg._connectNotice = "patient record used for on-device reasoning only; not sent to the AI model";
    }
  } catch (e) { /* fail-safe: a Connect error NEVER breaks a MaiK answer — proceed with no context */ }
}
```

`// VERIFY`: the exact line numbers / insertion points drift with the live file — confirm against `functions/api/ai/[[path]].js` (`explain` ≈ the `renderGroundedPrompt` call; `research` ≈ its grounded-prompt assembly) **before** editing. Fail-safe wrapping is mandatory: a bridge/engine/KV error must degrade to "no patient context," never to a broken or delayed MaiK answer (the client already has a 90 s watchdog; the hook must not risk it). This task is **DUAL-ADVERSARIAL** — the egress gate.

### 4.6 Zero-regression + the egress-invariant proof

Two properties are tested as first-class (see plan Task 8):
- **Zero regression when off:** with `smd_connect_maik` OFF (or no binding), the `pkg` and the `callGemini` input are **byte-identical** to today for the same request. The hook is provably inert.
- **Egress invariant when on + live + no BAA:** with the flag ON, a bound **live** bundle, and `egressBaaOk === false`, the exact string bytes of every patient field (a labelled synthetic MRN, a condition text, a med label) **do not appear** anywhere in the payload handed to `callGemini`; the deterministic lane is present; the notice is set. This is the adversary test the DUAL-ADVERSARIAL reviewers must try to break (smuggle via `patientCase`, via retrieval-bias text, via the notice, via history).

---

## 5. Security & compliance

- **Deny-by-default RBAC**, server-derived identity, fail-closed on any error — explicitly **not** the house KV fail-open idiom. (§3.1–3.2)
- **PHI never in URLs/logs/KV.** `patientRef` travels in a POST body only; the KV binding is **envelope-sealed**; rate-limit keys are tenant+action+time; audit is PHI-free by construction (allow-list; HMAC pseudonym). (§3.5, §3.6, §4.4)
- **The egress invariant** (§0, §4.2, §4.6) — the platform payoff, enforced at the server call-site by the unchanged R7 guard.
- **DPDP roles (foundation C13 / Phase-1 R15).** For an **EMR pull** feeding MaiK, the **hospital is the Data Fiduciary and Connect is the Data Processor** — Track D adds no purpose-determination for a pull, so the Processor posture holds; the egress lane's third-party LLM call is a **sub-processing** step that the BAA/DPA (§4.3) must cover, and it is **forbidden** without `egressBaaOk`. No secondary use (no analytics/training on PHI). (`// VERIFY` the processor contract covers the LLM sub-processor.)
- **Tenant isolation everywhere** — every Enterprise read/write and every audit/observability view is tenant-scoped from the membership, not from a client filter. Cross-tenant = `PermissionError`.
- **Least-privilege PHI** — PHI actions (`context:load`, `maik:attach`) are clinician-only by default (§3.1 ⚑).
- **Fail-safe MaiK** — a Connect error degrades to "no context," never breaks the live MaiK answer (§4.5).
- **Reversible** — everything behind `smd_connect` (OFF) + `smd_connect_maik` (OFF); new files only save the one call-site; rollback = revert + flag-off.

---

## 6. Additive footprint

```
functions/
  _connect/
    enterprise/
      rbac.js            # ROLE_MATRIX + can(role, action); deny-by-default          [DUAL-ADVERSARIAL]
      members.js         # membership CRUD over connect_membership (RBAC-gated)
      org.js             # tenant create/update/suspend; mode guard
      ratelimit.js       # per-tenant per-action KV counter; fail-open counter / fail-closed authz
      observability.js   # tenant-scoped audit read + aggregate metrics (PHI-free)
      schema.sql         # ADDITIVE: connect_membership status/invited_by cols via new tables +
                         #   connect_tenant_limits + connect_tenant_egress   (NEW file; connect_schema.sql untouched)
    maik-bridge/
      lanes.js           # buildMaikContext → {deterministic, egress|null}; assertEgressAllowed split
      attach.js          # seal/open + KV binding (connect:maikbind:{actorId}), short TTL
      bridge.js          # pullLanes(env, {request}) — identify → binding → engine → lanes
  api/connect/
    enterprise/[[path]].js   # NEW route: members / org / ratelimit / audit / observability (more-specific; router untouched)
    maik/[[path]].js         # NEW route: attach / detach
  api/ai/[[path]].js         # ***THE ONE existing-file touch*** — flag-gated hook (explain + research)   // VERIFY
test/connect/
  rbac.test.mjs  rbac-adversarial.test.mjs           # DUAL-ADVERSARIAL
  members.test.mjs  org.test.mjs  ratelimit.test.mjs  observability.test.mjs
  maik-bridge-lanes.test.mjs  maik-attach.test.mjs
  maik-egress-invariant.test.mjs  maik-callsite-regression.test.mjs   # DUAL-ADVERSARIAL
```

Flags: `smd_connect` (existing, env `CONNECT_FLAG`) gates Enterprise; `smd_connect_maik` (**new**, env `CONNECT_MAIK_FLAG`, default OFF) additionally gates the MaiK hook. `maikWiringOn(env)` = both on.

---

## 7. ADRs (Track D)

- **ADR-D1 — Extend the Phase-0 tenant/membership seam; do not fork auth.** RBAC reads the `role` `resolveTenant` already returns; membership CRUD writes the existing table. *Rejected:* a parallel roles table / a new identity source.
- **ADR-D2 — Deny-by-default RBAC matrix as pure data, fail-closed.** `can(role, action)` allows only explicit entries; unknown/any-error ⇒ deny. *Rejected:* the house KV fail-open default; an implicit "owner ⇒ all" wildcard.
- **ADR-D3 — PHI is clinician-only by default.** Org-admin roles manage the org, not patient content, unless separately a clinician. *Rejected:* admin-implies-PHI (privacy blast-radius).
- **ADR-D4 — Server-centric MaiK bridge; one existing-file touch is the server AI endpoint.** The pull + egress gate live where `callGemini` lives; the client stays unchanged; the binding is server-held (sealed). *Rejected:* a client-side pull that would force a second existing-file touch and let the client assemble PHI into the prompt.
- **ADR-D5 — Two lanes; the egress lane is R7-gated, deterministic lane is not.** A consented live bundle always feeds deterministic reasoning + the treating clinician's device; only `assertEgressAllowed` opens the third-party LLM. *Rejected:* flag-on ⇒ egress (the invariant violation).
- **ADR-D6 — `egressBaaOk` is a dedicated owner-only audited record, not a settings toggle.** Requires BAA/DPA + no-retention tier. *Rejected:* a loose `settings.egressBaaOk` an admin could flip.
- **ADR-D7 — Enterprise routes as new more-specific route files; the existing Connect router is untouched.** Keeps "the ONLY existing-file touch is the MaiK call-site" literally true. *Alternative (owner-decision):* fold into the existing router.
- **ADR-D8 — Rate-limit is a secondary availability control (fail-open counter), distinct from the fail-closed authz gate.** Mirrors the AI endpoint's fail-open-on-metering posture. *Rejected:* denying a clinical call on a counter infra blip.

---

## 8. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| RBAC bypass / privilege escalation (forged role, unknown-action allow, error-as-allow) | High | Deny-by-default pure-data matrix; fail-closed; **DUAL-ADVERSARIAL** review + adversary test; no module-scope cache |
| **Real PHI reaches Gemini on flag-on alone** | High | R7 `assertEgressAllowed` unchanged; egress lane null unless `sandbox`/`egressBaaOk`; **DUAL-ADVERSARIAL** egress-invariant byte test |
| Cross-tenant read (IDOR) in audit/observability/members | High | Tenant scope derived from membership, not client filter; `resolveTenant` membership proof; `connect:*` ns |
| `patientRef` (PHI) in KV/logs/URL via the binding | High | Envelope-seal before KV; body-only transport; PHI-free audit; no-PHI test |
| Live MaiK product regresses from the one touch | High | Flag default OFF + double-gate; fail-safe try/catch; byte-identical zero-regression test; `// VERIFY` call-site |
| `egressBaaOk` flipped casually | High | Owner-only `egress:baa`; dedicated audited record; operational preconditions (§4.3) `// VERIFY` |
| Admin reads PHI unexpectedly | Medium | PHI clinician-only by default (⚑); owner ratifies the matrix |
| Rate-limit blocks a clinician on infra error | Medium | Fail-open counter (authz stays fail-closed); owner ratifies the split |
| Last-owner lockout / self-escalation via member APIs | Medium | Last-owner + †-admin-can't-touch-owner guards; role-enum validation |
| Bridge latency added to every MaiK call | Low | Only when flag on + binding present; one KV get; flag-off pure early return |

---

## 9. Reviewer panel (run on the implementation)

| Requested | Agent(s) |
|---|---|
| Architecture | `stewardmd-platform-reviewer` |
| Security (incl. the two DUAL-ADVERSARIAL controls) | `stewardmd-security-reviewer`, `stewardmd-appsec-reviewer`, `stewardmd-redteam-reviewer`, `stewardmd-secret-scan-reviewer` |
| API / Data flow (egress lanes, tenant scoping) | `stewardmd-dataflow-reviewer` |
| Compliance | `stewardmd-dpdp-reviewer`, `stewardmd-hipaa-reviewer` |
| Testing | `stewardmd-preprod-reviewer` |
| Clinical (does the deterministic lane help without misleading) | `stewardmd-clinical-reviewer` |

The **RBAC matrix** (Task 1) and the **MaiK-egress gate** (Task 8) each require **two independent adversarial reviewers** before the task counts as done — not a single reviewer.

---

## 10. Acceptance criteria

1. `can(role, action)` matches §3.1, deny-by-default, fail-closed; the adversary suite cannot escalate, cross-tenant, or turn an error into an allow. **(DUAL-ADVERSARIAL)**
2. Membership CRUD enforces RBAC, the last-owner + †-admin guards, and role-enum validation; every mutation emits a PHI-free audit event.
3. Per-tenant rate-limit enforces `429` on exceed with a PHI-free key; the counter fails open on infra error while authz stays fail-closed.
4. Tenant-scoped audit + observability views return only PHI-free data and never cross tenants (owner of A cannot read B).
5. The MaiK bridge pulls the canonical bundle through the *unchanged* engine, consumes `buildMaikContext`, and splits lanes; the binding is envelope-sealed with **no raw `patientRef` in KV**.
6. **Egress invariant:** flag ON + live bundle + `egressBaaOk === false` ⇒ zero patient bytes in the `callGemini` payload; deterministic lane present; notice set. **(DUAL-ADVERSARIAL)**
7. **Zero regression:** `smd_connect_maik` OFF (or no binding) ⇒ `pkg` and the `callGemini` input byte-identical to today; `npm test` green.
8. All new code behind `smd_connect` + `smd_connect_maik` (both OFF); the only existing-file touch is the flag-gated AI-endpoint hook; rollback = revert.
9. Platform + security (both DUAL-ADVERSARIAL) + dpdp/hipaa reviewers pass.

---

## 11. Owner decisions / `// VERIFY` gaps (pinned)

1. **The MaiK call-site (LIVE product).** Confirm the exact insertion points in `functions/api/ai/[[path]].js` (`explain` + `research`) against the live file before editing; confirm the fail-safe wrapping does not risk the client's 90 s watchdog. `// VERIFY`
2. **`egressBaaOk` / provider config.** What no-retention/no-training LLM tier + endpoint backs a BAA-covered egress; who provisions it; per-tenant vs global; the exact flip preconditions (§4.3). Nothing reaches Gemini for real PHI until this is real. `// VERIFY`
3. **The RBAC matrix (§3.1).** Ratify: admins get **no** PHI (`context:load`/`maik:attach`) by default; clinician `member:read` is self-only; `egress:baa` is owner-only. `// VERIFY`
4. **Rate-limit fail-open counter vs fail-closed authz split** (§3.5) — ratify.
5. **Where the "attach patient to MaiK" UI lives** — a new Connect surface (keeps `home.js` untouched) vs a future client touch. Default: new Connect surface; the live MaiK client stays untouched.
6. **Enterprise routes as new route files vs folding into the existing Connect router** (ADR-D7) — default new files so the router stays untouched.
7. **Binding TTL** (§4.4) and one-active-binding-per-clinician semantics — ratify.
8. **DPDP: the processor contract must name the LLM sub-processor** for the egress lane; hospital=Fiduciary/Connect=Processor for the pull (§5). `// VERIFY`
