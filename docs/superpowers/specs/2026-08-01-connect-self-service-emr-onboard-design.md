# StewardMD Connect — Self-Service EMR Onboarding (Part 3 core) — Design

**Goal:** A hospital admin connects StewardMD to their EMR by entering connection details in the app — no engineering support (the Part-3 success criterion). Increment 1 lands the FHIR path end-to-end, architected so every other connector type (HL7, CSV, REST, DICOM, …) slots into the same wizard.

**Maps to plan:** Part 3 "Self-Service Hospital Onboarding" (wizard, EMR selection, auth, auto-discovery, connection testing, connection list). Reuses the Part-2 connector engine (Track A FHIR/SMART) + Part-1 canonical model + secrets/tenant.

## Architecture
Builds on `feat/connect-fhir-smart` (the reviewed FHIR/SMART engine + secrets + normalize + SCCM). Additive; flag `smd_connect_onboard` default OFF; zero regression.

### Backend — `functions/api/connect/onboard/[[path]].js` (new)
- `POST /api/connect/onboard/emr` — body `{ name, type:"fhir", fhirBaseUrl, auth:{ method:"token"|"smart", token?, headerName?, tokenEndpoint?, clientId? } }`. Validates URL is **https** + **SSRF-guarded** (reject private/loopback/metadata IPs), envelope-encrypts credentials, stores a per-tenant connector config row, returns `{ ok, connectionId }`. Server-derived tenant via `identify()`; owner/admin gated.
- `POST /api/connect/onboard/test/:id` — runs a capability probe against the stored connection (SMART discovery if `smart`, then `GET {base}/metadata` and `GET {base}/Patient?_count=1`), returns `{ ok, fhirVersion, softwareName, error? }` — clear, actionable errors (bad URL, TLS, 401, not-FHIR).
- `GET /api/connect/onboard/list` — the tenant's connections + last-test status (no secrets returned).
- `POST /api/connect/onboard/pull/:id` — body `{ patientId }` → pull via the FHIR connector → normalize to SCCM → return the canonical bundle (viewing in-app; LLM egress stays BAA-gated behind the existing R7 gate).
- `DELETE /api/connect/onboard/:id` — remove a connection (erase its sealed creds).

### Reuse (do NOT rebuild)
`fhir-r4` connector + `smart/*` (discovery, assertion, token) + `secrets.js` envelope + `canonical/*` (SCCM + validate) + `tenant.js` + `identity.js` + `audit.js` (PHI-free). The onboarding endpoint is a thin, validated write/test/pull layer over the existing engine — it must not fork the connector logic.

### Storage
Reuse/extend `connect_connector_config` (tenant_id, connector_id, config JSON with the FHIR base + envelope-sealed creds + auth method + a friendly name + created/updated + last_test). No new secret handling — reuse the envelope.

### UI — "Connect EMR" screen
A new screen (start in the owner/admin console as a `connect` pane, structured so it can move to a hospital-admin surface later): connection-type picker (FHIR active; others shown "coming soon"), a form (name, FHIR base URL, auth method → token or SMART fields), **Test connection** button (live status), **Save**, and a list of saved connections with status + a "pull a patient" tester. Plain, clinical, no em-dash in app copy.

### Security
Flag OFF by default. SSRF guard on every user-entered URL. Credentials envelope-encrypted, never returned to the client. Tenant/actor server-derived. Real PHI to the LLM still requires the BAA gate (unchanged). Sandbox/public-FHIR works with zero legal exposure.

### Extensibility (the point)
The wizard + endpoint are **type-dispatched**: `type:"fhir"` today; `hl7`, `csv`, `rest`, `dicom`, `webhook` register as additional types using the Part-2 Connector SDK — same UI, same save/test/pull shape, no core change. This is how "support all EMR types" is actually delivered: one wizard, many registered connector types.

## Testing
`node --test`. Cover: URL validation + SSRF reject; envelope round-trip; capability-probe success + each error class; token vs SMART auth; pull→normalize→SCCM; flag-OFF inert; list omits secrets. Live smoke against a public FHIR sandbox (r4.smarthealthit.org) where feasible.

## Increment plan (this is Increment 1 of Part 3)
1. Backend onboarding endpoint (save/test/list/pull/delete) + storage + SSRF guard — TDD.
2. "Connect EMR" UI screen wired to it.
3. Verify live against a public FHIR sandbox.
Later increments: the rest of Part 3 (dashboards, monitoring/alerting, AI field-mapping, deployment profiles) and Part 2 breadth (REST/GraphQL/DICOM/Webhook/DB connectors).
