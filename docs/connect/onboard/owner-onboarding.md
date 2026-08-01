# StewardMD Connect — Self-Service EMR Onboarding: Owner Go-Live + Hospital-Admin Guide

**This is the single document the owner works through to take the self-service EMR onboarding live for real
hospitals, plus the guide a hospital admin follows to connect their EMR without any code changes.** It covers
the generic, multi-tenant, connector-based onboarding track (Tracks A/B): FHIR/SMART pull, CSV upload, HL7 v2
feed, and FHIR-push webhook. It is deliberately NOT specific to one hospital or one FHIR server.

> ABDM (India HIE) has its own gate: `docs/connect/abdm/owner-onboarding.md`. This onboarding track is
> independent of ABDM — it needs no ABDM registration, no R2 push-buffer, and no JWKS. Where a hospital uses
> ABDM instead of a direct EMR connection, work the ABDM doc.

## Current state (what is true today)

- The onboarding surface is **merged behind flags, all default OFF, inert + mock-safe.** With any flag unset,
  or any binding missing, every `/api/connect/*` and `/api/connect/onboard/*` route 404s — a partial provision
  cannot leak. Nothing runs until the steps below are done.
- **Built and live-proven** (against the public FHIR sandbox `r4.smarthealthit.org`, Smile CDR, FHIR 4.0.0):
  self-service connect for FHIR (token + SMART), CSV upload, HL7 v2 feed, and FHIR-push webhook; a connections
  dashboard; and a membership-scoped tenant picker. Credentials are envelope-sealed at rest and never returned;
  every user-entered URL is SSRF-guarded; RBAC + audit are PHI-free.
- **No D1 binding, no `CONNECT_MASTER_KEY`, no real hospital credential exists yet.** All owner steps below.

**Recovery / rollback anchors:** recovery tag `pre-connect-onboard-golive`; instant kill = set `CONNECT_FLAG`
(and the per-mode flags) unset/`0` — every route 404s immediately, nothing else in the app is affected.

---

## What this delivers (the Part-3 self-service promise)

Any supported hospital onboards itself, with **no per-hospital engineering**:

- **Generic** — one wizard, four ingestion modes cover the standards-based majority of hospitals. A new
  connection is data (a row), not code.
- **Multi-tenant** — every connection is a row keyed `(tenant_id, connector_id)`; a fresh `connectionId` per
  connection, tenant-scoped on every read (`WHERE tenant_id = ?`), IDOR-safe (tenant is server-derived from the
  authenticated membership, never client-supplied).
- **Self-service** — a hospital admin enters a URL + credentials in the wizard, clicks Test, and pulls. No deploy.
- **Safe by construction** — SSRF-guarded fetch (redirect-safe `makeSafeFetch`, creds dropped cross-origin),
  envelope-sealed credentials (never stored or returned in the clear), fail-closed RBAC, and a PHI-free audit.

---

## Section 1 — Cloudflare provisioning (owner)

All Connect data-plane bindings are **Cloudflare Pages bindings** (Pages project -> Settings -> Functions ->
bindings/secrets), NOT `wrangler.toml`. Fail-safe: with the flag off or a binding missing, every route 404s.

### 1a. D1 (canonical + connection store)
- [ ] Create the D1 database: `wrangler d1 create stewardmd-connect` — record the returned `database_id`.
- [ ] Add it as a **Pages binding** named **`CONNECT_DB`** -> the `stewardmd-connect` DB. (Code reads `env.CONNECT_DB`.)
- [ ] Apply the base schema: `wrangler d1 execute stewardmd-connect --file db/connect_schema.sql`
      (creates `connect_tenant`, `connect_membership`, `connect_connector_config`, `connect_audit_event`).
- [ ] Apply the feed schema (needed for HL7 + FHIR-push feeds): `wrangler d1 execute stewardmd-connect --file db/connect_hl7_schema.sql`
      (creates `connect_feed`, with the inline `secret_sealed` column).
- [ ] **If you provisioned a Connect D1 before this track landed**, add the inline-secret column:
      `ALTER TABLE connect_feed ADD COLUMN secret_sealed TEXT;` (the ingest spine prefers `secret_sealed` over a
      runtime env write, so a self-service feed needs it).

### 1b. KV (non-PHI only)
- [ ] Confirm the existing **`MAIK_KV`** namespace is bound to the Pages project. Onboarding reuses it (no new
      namespace). **Invariant: no PHI/credential material in KV.**

### 1c. R2
- [ ] **Not required for this track.** R2 (`CONNECT_R2`) is only the ABDM encrypted push-buffer. Skip it unless
      you are also enabling ABDM.

### 1d. Secret
- [ ] **`CONNECT_MASTER_KEY`** — 32-byte AES-256 key, base64. `secrets.js` requires exactly 32 raw bytes.
      Generate: `openssl rand -base64 32`. This envelope-seals every hospital's EMR credentials (bearer token or
      SMART private key) and every feed's HMAC secret at rest. **Without it, save/test fail closed** (creds cannot
      be sealed).

---

## Section 2 — Flags (owner)

All default OFF. The base flag is required together with each per-mode flag.

| Flag (env var) | `smd_` name | Enables |
|---|---|---|
| **`CONNECT_FLAG`** | `smd_connect` | Base kill-switch. Required for everything. |
| **`CONNECT_ONBOARD_FLAG`** | `smd_connect_onboard` | The onboarding wizard + management API (save/test/list/pull/delete a FHIR connection, CSV upload, create/list/revoke feeds, dashboard, tenant picker). |
| **`CONNECT_HL7_FLAG`** | `smd_connect_hl7` | The HL7 v2 **ingest** endpoint a hospital's HL7 sender POSTs to (`flagHl7On`). Needed for a created HL7 feed to actually accept messages. |
| **`CONNECT_FHIR_PUSH_FLAG`** | `smd_connect_fhir_push` | The FHIR-push **webhook ingest** endpoint (`flagFhirPushOn`). Needed for a created webhook feed to accept pushes. |

Set `CONNECT_FLAG=1` and `CONNECT_ONBOARD_FLAG=1` to open the wizard. Add `CONNECT_HL7_FLAG=1` and/or
`CONNECT_FHIR_PUSH_FLAG=1` only when you want those inbound feeds to start accepting data.

> The "coming soon" site gate does **not** block this: `/api/*` and `/admin/*` pass straight through it and each
> route enforces its own auth (the admin console gates itself with Google owner login). No workaround is needed.

---

## Section 3 — Legal / compliance gate (BLOCKING before ANY real patient data)

The onboarding pipeline is a **Data Processor** for the hospital's data. Before real PHI flows:

- [ ] **BAA / DPA signed** with the hospital and with every downstream processor that could touch real bundles
      (the LLM provider for the MaiK path, any storage). Hospital = Data **Fiduciary**, StewardMD Connect = Data
      **Processor**; bind every use to a stated purpose; **no secondary use** (no analytics/training on hospital PHI).
- [ ] **R7 LLM-egress gate.** Pulled/ingested PHI must NOT reach MaiK/Vertex until the tenant carries the
      `egressBaaOk` flag (BAA/DPA + de-identification). This is enforced in `functions/_connect/maik-context.js`
      (`assertEgressAllowed`) and is a distinct gate from the connection working — a connection can pull and
      normalize for a clinician view while LLM egress stays blocked.
- [ ] **Clinician sign-off** that pulled/served summaries are decision-support, not the hospital's legal record.

---

## Section 4 — Owner `// VERIFY` / policy decisions (self-service track)

- [ ] **PHI-to-admin policy (ratify).** The verify-tester (`POST /onboard/pull/:id`) and CSV upload return the
      normalized SCCM bundle to the owner/admin under `connector:read`. The permission matrix reserves the
      PHI-carrying `context:load` for clinicians. Ratify that an onboarding admin may see the pulled bundle for
      the connection test, or tighten `pull`/`csv` to `connector:write` / clinician-only.
- [ ] **DNS-rebinding residual.** `assertPublicHttpsUrl` + `makeSafeFetch` block SSRF via literal private IPs,
      redirects, and cross-origin credential leakage, but a hostname that resolves public-then-private between
      validation and fetch (DNS rebinding) is a documented residual. Before you open the wizard to untrusted
      admins, add resolve-then-pin (resolve once, connect to the pinned IP). Trusted-owner use today is fine.
- [ ] **Tenant provisioning.** Create the `connect_tenant` + `connect_membership` rows for each hospital and its
      admins (the tenant picker is membership-scoped). Decide the tenant `mode` (`sandbox` until the BAA is signed).

---

## Section 5 — How a hospital admin self-onboards (no code changes)

1. Sign in to the admin console (`/admin/connect-emr.html`) with an authorized Google owner/admin account.
2. Pick the **hospital (tenant)** from the membership-scoped dropdown.
3. Choose a **connection type**:
   - **FHIR (token)** — enter the FHIR base URL and a bearer token (or a custom header name + value).
   - **FHIR (SMART)** — enter the FHIR base URL, client id, token endpoint, and the SMART private key (JWK).
   - **CSV** — upload a patient CSV; columns are auto-mapped to SCCM.
   - **HL7 v2 feed** — create a feed; you get a one-time HMAC secret + an ingest URL for the hospital's HL7 sender.
   - **FHIR-push webhook** — create a feed; you get a one-time HMAC secret + a webhook URL the EMR pushes to.
4. Click **Test** (FHIR/SMART): it probes `/metadata` + a one-patient search and reports the FHIR version and
   server software, or a specific error class (bad-url / tls / unauthorized / not-fhir / unreachable). No PHI leaks.
5. **Pull / activate.** For pull connections, pull normalizes into an SCCM bundle (PHI-free audit written). For
   feed connections, the secret is shown once — hand it to the hospital's integration engine; the feed then
   accepts signed messages at its ingest URL.
6. Manage everything from the **connections dashboard** (unified FHIR + feed table; revoke deletes the row and
   erases its sealed secret with it).

---

## Section 6 — Safe enable sequence + rollback

- [ ] **1. Provision** — Section 1 (D1 + schema + `CONNECT_MASTER_KEY` + `MAIK_KV`). Flags OFF -> all routes 404.
- [ ] **2. Smoke test** — full suite green (`npm test`; the subdir suites now run) + a sandbox pull against a
      public FHIR server (e.g. `r4.smarthealthit.org`). No real hospital.
- [ ] **3. Open the wizard** — set `CONNECT_FLAG=1` + `CONNECT_ONBOARD_FLAG=1`. Onboard a hospital in tenant
      `mode = sandbox`; verify Test + pull against its EMR sandbox. LLM egress stays blocked (no `egressBaaOk`).
- [ ] **4. Enable feeds (optional)** — set `CONNECT_HL7_FLAG=1` / `CONNECT_FHIR_PUSH_FLAG=1` when the hospital's
      HL7 / push senders are ready.
- [ ] **5. Real patient data** — only after Section 3 (BAA/DPA + `egressBaaOk` + clinician sign-off) may a tenant
      move to `mode = live` and PHI reach MaiK.

**Rollback (any step):**
- [ ] **Instant kill** — set `CONNECT_FLAG` (and the per-mode flags) unset/`0`. Every `/api/connect/*` route
      404s immediately; the rest of the app is unaffected (additive, zero-regression).
- [ ] **Per-connection** — revoke it from the dashboard: the row is deleted and its envelope-sealed secret is
      erased with it.
- [ ] **Full revert** — revert the Connect commits on `main`; recovery tag `pre-connect-onboard-golive`.
