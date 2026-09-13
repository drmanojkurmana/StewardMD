# StewardMD Connect Agent - Operator Runbook

Deployment and operational runbook for the Connect Agent, written for the system owner and operators.

The Connect Agent enables automated EMR onboarding through a doctor-controlled browser session. The clinician authenticates in an isolated browser runner, and the agent observes approved read workflows, produces a sanitized adapter specification, validates safety, and registers the connection after human approval.

---

## 1. Status and Delivery Baseline

In accordance with the release qualification requirements, all components must carry an honest status label:

- **Implemented and tested locally**:
  - Client launcher relocated to `connect-agent-boot.js` behind client flag `smd_connect_agent` (default OFF).
  - Consent receipt generator and HMAC-SHA256 signature verification (`connect-agent/consent.mjs`).
  - Discovery observer with main-world script injection, path redaction (`{id}`), and origin allowlisting (`connect-agent/discovery.mjs`).
  - Safety validation engine separating verbs from clinical nouns under `schemaVersion: 2` (`connect-agent/controller.mjs`).
  - Conformance verification integration (`functions/_connect/sdk/conformance.js`).
- **Demonstrated against a real browser service**:
  - Browser context continuity across tabs sharing a `userId` on real `jo-inc/camofox-browser` 1.14.0 (`test/run-connect-agent-camofox-continuity.mjs`).
  - Main-world evaluation via `mw:` prefix capturing live in-page requests.
- **Validated with an authorized hospital**:
  - *Planned / External dependency*: Blocked on formal hospital authorization and sandbox access.
- **Deployed and enabled**:
  - *Planned*: Blocked on server broker completion, production runner deployment, and final owner sign-off.

---

## 2. Prerequisites and Runner Infrastructure

The browser runner executes outside Cloudflare Pages to keep headless browser processes out of edge request lifecycles.

### Camofox Browser Runner
- **Engine**: Self-hosted `jo-inc/camofox-browser` version 1.14.0.
- **Main-World Plugin**: Mandatory. Discovery fails without it because Camoufox executes `evaluate()` in an isolated JS realm.
  - Install: Copy `connect-agent/camofox-plugins/main-world/` to `plugins/main-world/` in the camofox-browser installation.
  - Enable: Set `"plugins": { "main-world": { "enabled": true } }` in `camofox.config.json`.
  - Effect: Enables the `mw:` evaluate prefix used by `discovery.mjs` to hook into page-level XHR and fetch.
- **Service Authentication**: Set `CAMOFOX_ACCESS_KEY` on the runner and pass it via the client transport.
- **Trace Option Invariant**: NEVER enable the Camofox `trace` option for clinician sessions. Playwright traces capture plaintext login POST bodies (passwords, MFA tokens), session cookies, headers, response payloads, and screen frame grabs. Tracing must remain permanently disabled in doctor sessions.
- **Doctor-Facing Viewport**:
  - Use the VNC/noVNC plugin on port 6080 for interactive doctor authentication.
  - Secure the stream with `VNC_PASSWORD`.
  - Ensure mobile clients stream over HTTPS/WSS only.

---

## 3. Configuration and Feature Flags

All new flags default to OFF (fail closed).

### Feature Flags (Provisional Names Pending Broker Track)
- Prerequisites the agent gate ALSO requires (found 2026-09-12: all agent routes 404 without them):
  `CONNECT_FLAG=1` and `CONNECT_ONBOARD_FLAG=1` (`agentFlagOn = onboardFlagOn && CONNECT_AGENT_FLAG`).
- Pages binds secrets at BUILD time: after uploading a flag, push a commit to main or retry the latest
  production deployment, then confirm with `GET /api/connect/agent/connections` (401 = on, 404 = off).
- `CONNECT_AGENT_FLAG`: Master switch for the Connect Agent discovery pipeline (default: OFF).
- `CONNECT_BROWSER_SESSION_FLAG`: Enables remote browser session broker allocation (default: OFF).
- `CONNECT_AGENT_AUTO_ACTIVATE_FLAG`: Allows automated activation of previously approved adapter templates (default: OFF).
- `smd_connect_agent`: Client-side UI launcher gate in `connect-agent-boot.js` (default: OFF). Set via `localStorage.setItem("smd_connect_agent", "1")` or URL parameter `?connect_agent=1`.

### The brain (model that reads screen structure)
- `CONNECT_AGENT_MODEL`: REQUIRED. The exact Google model id for the Connect Agent brain (owner: Gemini 3.8). No default and no fallback: unset means every brain call fails with brain_not_configured. `GET /api/connect/agent/brain/model` reports what is configured. Not set on production as of 2026-09-13.
- `CONNECT_AGENT_MODEL_PROVIDER`: `vertex` (default) or `gemini` (AI Studio). No automatic switch between them.
- Ops: `classify`, `map-columns`, `next`, `verify` (judges a replayed view from columns, row count and response kind).
- Requests pass a refusing PHI gate (whitelisted keys, no 3+ digit runs, no `@`); answers are cached in `MAIK_KV` per origin and structure hash for 30 days. A model outage answers 503 `brain_unavailable` and the phone continues on its deterministic rules.

### Cryptographic Keys
- `CONNECT_AGENT_TOKEN_KEY`: Mandatory. Signs viewer tokens (`functions/_connect/agent/viewer-token.js`); missing = POST /sessions answers 400 not-configured. Set 2026-09-12.
- `CONNECT_CONSENT_SIGNING_KEY`: Mandatory environment variable for `connect-agent/consent.mjs`. Set in production 2026-09-12.
  - Used to generate and verify HMAC-SHA256 signatures on consent receipts.
  - Fails closed: If the key is missing or signature verification fails, `assertConsent()` throws an error and discovery aborts. There is no unkeyed fallback.

---

## 4. Emergency Kill Switch Procedure

If anomalous behavior, unexpected mutations, credential exposure, or runner instability occur, execute this three-step kill switch immediately:

1. **Flip Feature Flags OFF**:
   - Set `CONNECT_AGENT_FLAG=0` and `CONNECT_BROWSER_SESSION_FLAG=0` in Cloudflare Pages environment variables.
   - Set `smd_connect_agent=0` (or remove key) in client environments.
2. **Revoke Active Sessions**:
   - Terminate all active broker sessions via the admin console or management endpoint.
   - Invalidate short-lived viewer tokens.
   - Clear session leases from KV / persistence.
3. **Halt Browser Runner**:
   - Terminate the Camofox process or stop the container (`docker stop camofox-runner`).
   - Verify port 9377 (REST API) and port 6080 (noVNC) cease accepting connections.

---

## 5. Adapter Versioning and Rollback

- **Immutable Hash Binding**: Every generated adapter specification is bound to a SHA-256 digest in its approval receipt.
- **Rollback Procedure**:
  1. Open the Admin Console (`/admin/connect-emr.html`).
  2. Locate the affected hospital connection.
  3. Select the prior validated adapter version from version history.
  4. Click **Rollback to version**. The active version ID updates atomically in database storage.
- **In-flight Handling**:
  - In-flight operations pinned to a revoked version are cancelled immediately with a retryable error code.
  - No mixed-version execution is permitted.
- **Drift Handling**:
  - If an EMR updates its UI and breaks an existing mapping, mark the affected capability as `NEEDS_REPAIR`.
  - Do not disable unaffected capabilities if reads remain safe.

---

## 6. Pre-Enablement Checklist (Per Hospital)

Before enabling Connect Agent for any hospital tenant, confirm:

1. **Consent on Record**: Valid `ConsentReceipt` signed with `CONNECT_CONSENT_SIGNING_KEY` specifying clinician ID, hospital name, authorized EMR origin, and unexpired timestamp.
2. **Origin Allowlist**: EMR domain explicitly verified and added to allowed origins list. Only HTTPS origins are permitted; intranet EMRs require an authorized secure network bridge.
3. **Test Account Verification**: Discovery runs only against a test account with synthetic test patients.
4. **Safety Validation**: Adapter specification passes `validateAdapterSpec()` with `schemaVersion: 2` (zero write verbs, safe read paths only).
5. **Human Approval**: Controller approval receipt generated with exact specification hash and recorded approver ID (`APPROVED_FOR_CONFORMANCE`).
6. **Conformance Tests**: Conformance suite (`assertConforms`) passes on the generated adapter.
7. **Production Gate**: Production activation requires explicit administrator confirmation.

---

## 7. Metrics and Health Signals to Monitor

Operators must monitor the following signals in logs and telemetry:

- **Runner Latency**: Time to execute `/health` on the Camofox REST server (alert if > 500 ms).
- **Session Duration**: Discovery sessions should settle within 60 seconds. Alert if session age exceeds 5 minutes.
- **Redaction Counter**: Verify count of sanitized `{id}` segments in adapter paths. Alert if raw numeric or UUID segments appear in generated artifacts.
- **Consent Refusals**: Counter of rejected or expired consent receipts.
- **Error Codes to Watch**:
  - `E_CONSENT_INVALID`: Signature mismatch or missing signing key.
  - `E_RUNNER_UNREACHABLE`: Camofox network failure.
  - `E_UNAUTHORIZED_ORIGIN`: Attempt to navigate or fetch outside allowlisted EMR domain.
  - `E_SPEC_VALIDATION_FAILED`: Specification contained prohibited write verbs or unsanitized keys.

---

## 8. Planned Next Steps

The following items are planned on companion feature tracks:
- **Broker Service Track**: Authenticated server session broker (`/api/connect/agent/sessions`) for multi-tenant job persistence and leasing.
- **Mobile Viewport Embed**: Native WebView / noVNC secure viewer stream component inside StewardMD Mobile.
- **Automated Worklist Generalization**: Browser-session pull connector adapter in `functions/_connect/connectors/browser-session/`.
