# StewardMD Connect — Track D (Enterprise + MaiK Wiring) — Owner Onboarding

**Status:** Built + tested behind `smd_connect` (existing, OFF) + `smd_connect_maik` (new, OFF). Recovery tag `pre-connect-track-d`; branch `feat/connect-track-d-enterprise-maik`.
**Spec:** `docs/superpowers/specs/2026-08-01-connect-enterprise-maik-design.md` · **Plan:** `docs/superpowers/plans/2026-08-01-connect-enterprise-maik.md`

Track D adds (D-1) a fail-closed multi-tenant RBAC admin plane on the Phase-0 membership seam, and (D-2) the wiring that lets the LIVE MaiK consume canonical SCCM patient context behind the anti-corruption egress gate. Real PHI does NOT reach the LLM on flag-on alone.

## What shipped (files)

New, additive (nothing existing modified except the one MaiK call-site):
- `functions/_connect/enterprise/` — `rbac.js` (deny-by-default matrix + `can`), `guard.js` (`requireCan`), `members.js`, `org.js`, `ratelimit.js`, `observability.js`, `schema.sql` (3 new tables).
- `functions/_connect/maik-bridge/` — `lanes.js` (the R7 egress split), `attach.js` (sealed KV binding), `bridge.js` (`pullLanes`, reuses the unchanged engine), `hook.js` (the AI-endpoint adapter).
- `functions/api/connect/enterprise/[[path]].js`, `functions/api/connect/maik/[[path]].js` — new, more-specific routes (the Phase-0 catch-all router is untouched).
- The ONE existing-file touch: `functions/api/ai/[[path]].js` — one import + one flag-gated, fail-safe block before `renderGroundedPrompt` in the `explain` handler.
- Tests: `test/connect/{rbac,rbac-adversarial,members,org,ratelimit,observability,maik-bridge-lanes,maik-attach,maik-egress-invariant,maik-callsite-regression,track-d-router}.test.mjs` + `track-d-bench.mjs`.

## Verification (as run)

- Connect suite: 118 pass / 0 fail. Top-level suite: 208 pass / 0 fail (incl. `maik-dosing-grounding` which imports the edited AI endpoint). Zero regression.
- Egress invariant proven (via mocked `pullLanes`): flag ON + live bundle + `egressBaaOk=false` ⇒ zero patient bytes in the pkg handed to `callGemini`. Flag OFF ⇒ pkg byte-identical + bridge never called.
  - CORRECTION (2026-08-01 review): that mocked test asserts `splitLanes` blocks a hand-fed live bundle, but it is NOT how the real boundary is confined. The real zero-real-PHI-egress property holds because the ENGINE refuses any non-sandbox tenant (`assertSandboxAllowed` throws for `mode!=="sandbox"`) and confines `base_url` to the synthetic `SANDBOX_ALLOWLIST` — so only synthetic sandbox bundles ever exist to be split. `egressBaaOk` is a SECONDARY, presently UN-WIRED gate (`maik-context.js` short-circuits `true` for sandbox). See `test/connect/maik-egress-boundary-e2e.test.mjs` for the real end-to-end guard, and `maik-context.js` for the honest wording.
- Hot-path bench: `can()` 23 ns, max-bundle `splitLanes` ~5 µs, flag-OFF hook 63 ns.

## The RBAC matrix (`// VERIFY` — owner ratifies)

| Action | owner | admin | clinician | auditor |
|---|:-:|:-:|:-:|:-:|
| tenant:read | y | y | y | y |
| tenant:write | y | y | - | - |
| member:read | y | y | - | y |
| member:invite / member:role / member:remove | y | y* | - | - |
| connector:read | y | y | y | y |
| connector:write / connector:validate | y | y | - | - |
| context:load (PHI) | - | - | y | - |
| maik:attach (PHI) | - | - | y | - |
| ratelimit:write | y | y | - | - |
| audit:read / observability:read | y | y | - | y |
| egress:baa (opens LLM egress) | y | - | - | - |

\* admin cannot act on an owner; the last owner cannot be removed/demoted. PHI (context:load / maik:attach) is clinician-only by default (default #3). `egress:baa` is owner-only.

## Go-live checklist (owner)

1. **Provision** (Phase-0 preconditions already assume these): D1 `stewardmd-connect` bound as `CONNECT_DB`; `MAIK_KV`; secrets `CONNECT_MASTER_KEY` (32-byte base64) + `CONNECT_HMAC_SALT`. Apply `functions/_connect/enterprise/schema.sql` (additive) to the Connect D1.
2. **Ratify the RBAC matrix** above — confirm admins/owners get NO PHI, clinician has no roster read, `egress:baa` is owner-only. (`// VERIFY`, spec §11.3)
3. **Enable Enterprise** by turning on `smd_connect` (`CONNECT_FLAG=1`). The admin plane (members/org/ratelimit/audit/observability) is now live; no PHI or LLM egress involved.
4. **Enable MaiK wiring** by turning on `smd_connect_maik` (`CONNECT_MAIK_FLAG=1`). With this on, a clinician can attach a Connect patient (new Connect surface) and the AI endpoint will fold the patient context into MaiK — but ONLY the R7-gated egress lane. For any real/live tenant the egress lane stays CLOSED until step 5.

### The egress go-live gate (the single most consequential action — `egressBaaOk`)

`connect_tenant_egress.baa_ok` stays `0` (blocked) until ALL of the following hold for that tenant. Only an `owner` may flip it (`egress:baa`), and it is audited:

1. A signed **BAA/DPA** with the LLM provider covering this tenant's PHI. DPDP: for an EMR pull the hospital is the **Data Fiduciary** and Connect is the **Data Processor**; the processor contract must **name the LLM as a sub-processor** for the egress lane. (`// VERIFY`, spec §5)
2. A configured **no-retention / no-training** provider tier/endpoint for the MaiK LLM calls, recorded in `connect_tenant_egress.provider_tier`. (`// VERIFY` the exact tier + who provisions it, spec §4.3)
3. Agreed de-identification posture for the egress lane (the Phase-3 clinical-only mode is the stricter eventual form).

Until then, MaiK on live tenants runs **deterministic-lane only** (on-device reasoning + the notice "Patient record used for on-device reasoning only; not sent to the AI model"); sandbox/synthetic tenants exercise the full path for dev/test.

## Open `// VERIFY` / owner decisions (consolidated)

1. The exact MaiK call-site in `functions/api/ai/[[path]].js` (verified: one import + one guarded block before `renderGroundedPrompt` in `explain`; `research` deferred to keep the live touch minimal — default #1).
2. `egressBaaOk` provider tier/endpoint + who provisions it; per-tenant vs global (currently per-tenant).
3. RBAC matrix ratification (§ above).
4. Rate-limit fail-open-counter vs fail-closed-authz split (authz fails closed; the throttle counter fails open on infra error so a metering blip never denies a clinical call).
5. Binding TTL (`BIND_TTL_SEC = 3600`) and one-active-binding-per-clinician.
6. Whether the "attach patient to MaiK" UI is a new Connect surface (default #5, chosen) vs a future home.js touch.
7. Whether target user-id should be recorded in member.* audit events (currently omitted — the audit ALLOW-list has no target field; adding it is a future `audit.js` change).
