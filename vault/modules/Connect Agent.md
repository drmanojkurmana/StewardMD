---
tags: [module, connect]
status: full stack implemented and tested locally (broker, runner, manifest, activation, connector, doctor UI, acceptance matrix); browser continuity and discovery verified against a real Camofox server; never deployed, never run against a real hospital, never activated in production
flag: smd_connect_agent (client launcher, def:FALSE, ?connect_agent=1), CONNECT_AGENT_FLAG (provisional, def:FALSE), CONNECT_BROWSER_SESSION_FLAG (provisional, def:FALSE), CONNECT_AGENT_AUTO_ACTIVATE_FLAG (provisional, def:FALSE)
---
# Connect Agent

Automated hospital EMR onboarding through a doctor-controlled browser session. The clinician
authenticates in a dedicated, isolated browser context (Camofox); Connect Agent observes approved
read workflows, compiles a sanitized adapter manifest, validates it against a synthetic fixture, and
activates it after human approval. Another doctor at the same hospital reuses the exact same activated
version with a fresh session - no rediscovery.

## Flag + default

- `smd_connect_agent` (client launcher in `connect-agent-boot.js`, default: OFF). Resolves via
  `?connect_agent=1` -> `localStorage.getItem("smd_connect_agent")` -> default OFF.
- `CONNECT_AGENT_FLAG` (broker + runner router master flag, provisional, default: OFF).
- `CONNECT_BROWSER_SESSION_FLAG` (live browser-session provisioning flag, provisional, default: OFF).
- `CONNECT_AGENT_AUTO_ACTIVATE_FLAG` (automatic activation policy flag, provisional, default: OFF).

## Key files

**Client (doctor-facing)**
- `connect-agent-boot.js`: flag-gated launcher, lazy-loads the onboarding UI.
- `connect-agent-onboarding.js`: the doctor-facing onboarding/session sheet (replaced the old test
  console) - hospital picker, consent, login viewport, live progress states, pause/resume, reconnect
  path for a returning doctor. Apple-fluid-interface motion (critically-damped spring, rubber-band
  drag-to-dismiss, translucent header) in plain CSS/JS, no library.

**Browser transport**
- `connect-agent/camofox-client.mjs`: REST client for `jo-inc/camofox-browser`.
- `connect-agent/camofox-plugins/main-world/`: required server-side plugin enabling the `mw:`
  evaluation prefix.
- `connect-agent/discovery.mjs`, `connect-agent/policy.mjs`: request/response observer, in-page action
  guard, origin allowlist, path identifier redaction (`{id}`), attach/detach lifecycle.
- `connect-agent/consent.mjs`: HMAC-SHA256 consent receipts (`CONNECT_CONSENT_SIGNING_KEY`).

**Manifest pipeline** (`connect-agent/manifest/`)
- `schema.mjs`, `compile.mjs`: discovery spec -> versioned candidate manifest, deterministic, never
  invents an unobserved endpoint.
- `interpret.mjs`: restricted interpreter executing only declared operations against an injected
  `exec` transport - no eval, no dynamic code.
- `normalize.mjs`: manifest results -> SCCM canonical bundle.
- `validate.mjs`: candidate-specific validation against a synthetic fixture (identity, dates/units,
  absent-vs-negative, partial-read reporting); identity checks derive the id from the operation's own
  declared mapping, not an assumed raw `.id`/`.identifier` key.

**Server broker** (`functions/_connect/agent/`, `functions/api/connect/agent/`)
- `store.js`, `state.js`: D1 access and the three distinct state machines (session / job / adapter
  lifecycle), each with an explicit authorization gate.
- `activation.js`: adapter version activation (exact evidence-hash binding), rollback (append-only
  activation ledger), drift (`NEEDS_REPAIR` on the affected version only, deployment pointer untouched).
- `consent.js`, `viewer-token.js`, `hmac.js`, `flags.js`.
- `functions/api/connect/agent/[[path]].js`: doctor-facing router (sessions, viewer-token, handoff,
  pause/resume, hospitals/resolve).
- `functions/api/connect/agent/runner/[[path]].js`: runner-facing router (job lease/renew, HMAC +
  nonce + timestamp-window replay-resistant report callback).

**Runner and connector**
- `connect-agent/runner.mjs`: the actual long-lived process - leases a job, drives discovery through
  Camofox, compiles, validates, reports each stage. Never activates (human approval required).
- `functions/_connect/connectors/browser-session/connector.js`: the pull connector wiring the manifest
  interpreter into the existing Connect surface (worklist capability, SDK registry/catalog). Refuses to
  execute (fails closed) unless a caller injects a real `exec` transport - no fallback that would
  silently issue an unauthenticated request to the hospital's own origin.

**Tests**
- `test/connect-agent/synthetic-hospital.mjs`: 2-tenant, 2-doctor (one privilege-restricted) synthetic
  EMR fixture with MFA, session expiry, pagination, mutation traps, prompt-injection page, and a
  version-2 drift variant.
- `test/connect-agent/acceptance/matrix.test.mjs`: the Section-10 acceptance matrix, 12 real scenarios
  through the actual stack + 3 honestly-skipped (live Camofox / physical devices) - see
  `docs/connect/acceptance-matrix.md`.
- `test/run-connect-agent-onboarding-ui.mjs`, `test/run-connect-agent-boot-ui.mjs`: headless-Chrome CDP
  harnesses for the client UI.
- `test/run-connect-agent-camofox-continuity.mjs`: the original real-Camofox continuity spike.
- `docs/connect/agent-runbook.md`: operator/owner runbook (prerequisites, kill switch, rollback).

## Dependencies

- [[Infra]] (Camofox runner, VNC/noVNC on port 6080 - not yet exercised)
- [[Flags]]
- [[Decisions]] (browser continuity in same context; no credentials collected; Camofox chosen for
  bot-detection resistance)
- `functions/_connect/sdk/` (registry, catalog, descriptor, conformance)
- `functions/_connect/` (canonical SCCM model, enterprise RBAC, onboard worklist capability seam)

## Status

Full stack implemented and independently test-verified: broker (session/job/adapter state machines,
router), runner (job lease + HMAC-replay-resistant callback + the actual runner process), manifest
pipeline (compile/interpret/normalize/validate), activation (exact evidence binding, rollback, drift),
browser-session connector (worklist + patient read, SDK-registered), doctor onboarding UI (Apple-style
motion, 61/61 CDP-verified), and an acceptance matrix proving 12 of the Section-10 scenarios end to end
through the real stack.

**Not done, and not fakeable per the brief's own instruction:** never deployed to Cloudflare Pages;
never run against a real hospital or a real production Camofox runner; never activated in production;
the noVNC embedded viewer is documented as the answer to the embedded-login-viewport question but not
built or exercised; native iOS/Android viewer continuity untested (needs physical devices). These are
the only remaining line items, and every one of them requires infrastructure or authorization this
session does not have.

## Known gotchas

- **Camoufox isolated evaluate realm and the `mw:` prefix**: `evaluate()` runs in an isolated JS realm
  by default; page requests are invisible from it. The main-world plugin must be installed and enabled,
  and every observer/exec injection must use the `mw:` prefix.
- **No init-script primitive**: `navigate()` wipes whatever `evaluate()` just set. The observer can only
  ever see requests made after it installs; an inline onload fetch is a guaranteed miss, not a race.
- **Tracing records credentials**: never enable Camofox's `trace` option for a clinician session - it
  captures the login POST body, cookies, and screenshots for the whole session.
- **`/wait` takes `timeout`, not `ms`.**
- **`about:` URLs rejected**: initial tabs must target an allowed http(s) URL.
- **No server-side cookie extraction**: `connect_agent_session` stores no cookie field, by design -
  cookies never leave the browser process. The connector's `makeExec()` fails closed rather than
  falling back to an unauthenticated direct fetch; a real transport is injected explicitly
  (`execFromFetch()` is the opt-in adapter, not an automatic default).
- **Handoff stops at `AUTHENTICATED`, not `DISCOVERING`**: a job pushed straight to `DISCOVERING` by
  handoff could never be leased by a runner (`JOB_LEASABLE` is only `CREATED`/`AUTHENTICATED`). The
  runner's own progress/success report is what legally advances the job once it has actually leased and
  started work - a real cross-track bug the acceptance matrix caught on its first end-to-end run.
