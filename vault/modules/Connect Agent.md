---
tags: [module, connect]
status: browser continuity and discovery verified against a real Camofox server; consent/validator/redaction fixes shipped; broker, manifest, activation, UI in progress on other branches
flag: smd_connect_agent (client launcher, def:FALSE, ?connect_agent=1), CONNECT_AGENT_FLAG (provisional, def:FALSE), CONNECT_BROWSER_SESSION_FLAG (provisional, def:FALSE), CONNECT_AGENT_AUTO_ACTIVATE_FLAG (provisional, def:FALSE)
---
# Connect Agent

Automated hospital EMR onboarding through a doctor-controlled browser session. The clinician authenticates in a dedicated, isolated browser context (Camofox); Connect Agent observes approved read workflows, produces a sanitized adapter specification, validates safety, and registers the connection after human approval.

## Flag + default

- `smd_connect_agent` (client launcher in `connect-agent-boot.js`, default: OFF). Resolves via `?connect_agent=1` -> `localStorage.getItem("smd_connect_agent")` -> default OFF.
- `CONNECT_AGENT_FLAG` (server/broker master flag, provisional, default: OFF).
- `CONNECT_BROWSER_SESSION_FLAG` (remote session broker flag, provisional, default: OFF).
- `CONNECT_AGENT_AUTO_ACTIVATE_FLAG` (automatic activation policy flag, provisional, default: OFF).

## Key files

- `connect-agent-boot.js`: Root boot script. Gates the launcher behind `smd_connect_agent`; when off, does nothing observable and does not load the UI.
- `connect-agent-ui.js`: Doctor-facing test console sheet. Re-pointed to from `connect-agent-boot.js`.
- `connect-agent/camofox-client.mjs`: REST client for `jo-inc/camofox-browser` (tabs, navigation, evaluation, snapshots).
- `connect-agent/camofox-plugins/main-world/`: Camofox plugin enabling the `mw:` evaluation prefix for main-world script injection.
- `connect-agent/discovery.mjs`: Page request/response observer, origin allowlist enforcement, and path identifier redaction (`{id}`).
- `connect-agent/consent.mjs`: Scoped consent receipts with HMAC-SHA256 signature verification via `CONNECT_CONSENT_SIGNING_KEY`.
- `connect-agent/controller.mjs`: Spec validation (`validateAdapterSpec` schema v1/v2) and hash-bound human approval receipts.
- `connect-agent/adapter-pipeline.mjs`: Composition helper coordinating consent, discovery, validation, and artifact output.
- `docs/connect/agent-runbook.md`: Operator and owner runbook for deployment, kill switch, rollback, and prerequisites.
- `test/run-connect-agent-boot-ui.mjs`: Headless Chrome CDP harness proving launcher gating, zero errors, and error telemetry.

## Dependencies

- [[Infra]] (Camofox runner, VNC/noVNC on port 6080)
- [[Flags]] (`smd_connect_agent`, `CONNECT_AGENT_FLAG`)
- [[Decisions]] (browser continuity in same context, no credentials collected)
- `functions/_connect/sdk/conformance.js` (SCCM 1.0 conformance verification)
- `functions/_connect/` (canonical model and enterprise RBAC)

## Status

Browser continuity and discovery verified against a real Camofox server; consent/validator/redaction fixes shipped; broker, manifest, activation, UI in progress on other branches.

## Known gotchas

- **Camoufox isolated evaluate realm and the `mw:` prefix**: Camoufox runs `evaluate()` in an isolated JS realm by default. Page requests are invisible from that realm. The main-world plugin must be installed and enabled in `camofox.config.json`, and all observer injections must use the `mw:` prefix.
- **No init-script primitive so inline onload fetches are missed**: Camofox REST API lacks an `addInitScript` primitive. Navigating after evaluation wipes the realm. The observer is installed after navigation, so inline fetches during initial document load are not captured; delayed, polling, and interaction-driven requests are captured.
- **Tracing records credentials**: Enabling Camofox's `trace` option captures full POST bodies (passwords and MFA tokens), headers, cookies, responses, and screenshots across the entire session. Never enable `trace` for clinician sessions.
- **/wait takes timeout not ms**: Camofox's `/wait` endpoint takes `timeout` (maximum readiness wait in milliseconds), not `ms`. Passing `ms` results in an unhandled parameter or timeout.
- **about: URLs rejected**: Camofox rejects non-http(s) targets such as `about:blank`. Initial tabs must be directed to an allowed HTTP/HTTPS URL.
