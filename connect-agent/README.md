# StewardMD Connect Agent — Camofox transport

StewardMD Connect Agent turns an **authorized, doctor-controlled EMR session** into a sanitized connector specification. Camofox is the browser execution layer; the StewardMD Connect Controller remains the human approval boundary.

## End-to-end pipeline

```text
Doctor consent
  -> Camofox browser session
  -> clinician completes EMR authentication
  -> Connect discovery observer
  -> sanitized request/response schemas
  -> adapter-spec.json
  -> safety validation
  -> Connect Controller review
  -> adapter approval receipt (bound to spec hash)
  -> existing Connect conformance tests
  -> explicit production enable
```

## Credential and PHI rule

The Connect Agent does not ask the application to collect or persist an EMR password. Authentication is completed by the clinician in the controlled browser session. Discovery output contains interface metadata and response shapes only. Cookies, authorization headers, bearer tokens, passwords and patient values are not written to the adapter specification.

The Camofox service itself may maintain a browser session while the clinician is using it. Deployments must configure the browser service with appropriate isolation, retention and access controls.

## Consent gate

Before discovery, create a consent receipt with:

- clinician/actor identifier
- hospital
- EMR origin
- explicit integration scope
- optional expiry
- timestamp

The agent must refuse to run without a valid receipt and required scope. Consent does not authorize bypassing authentication, MFA, CAPTCHA, security controls or access outside the approved origin/scope.

The receipt's `signature` is a server-owned HMAC-SHA256 over the receipt, keyed by `CONNECT_CONSENT_SIGNING_KEY` — not a checksum. `assertConsent()` verifies it and fails closed (throws) if the key is missing, the signature doesn't match, or `expiresAt` is present but not a parseable date. Set `CONNECT_CONSENT_SIGNING_KEY` wherever `createConsentReceipt`/`assertConsent` run in production; there is no unkeyed fallback.

## Camofox setup

Run Camofox separately and point `CAMOFOX_URL` at its REST server. The default is `http://127.0.0.1:9377`; `CAMOFOX_ACCESS_KEY` is used only to authenticate to the Camofox service.

The provider is [jo-inc/camofox-browser](https://github.com/jo-inc/camofox-browser) (verified against 1.14.0 and its real `openapi.json`; every endpoint `camofox-client.mjs` calls exists with matching field names). **One prerequisite is not on by default and discovery does not work without it:** main-world evaluation. Copy `connect-agent/camofox-plugins/main-world/` to `plugins/main-world/` in the camofox-browser checkout and enable it in its `camofox.config.json` (`"plugins": { "main-world": { "enabled": true } }`). Camoufox deliberately runs `evaluate()` in an isolated JS realm (part of how it stays undetectable), so a request observer installed from there is invisible to the page; the plugin enables the documented `mw:` prefix that runs a script in the page's own realm, and `discovery.mjs` uses it on both its evaluate calls. Without the plugin discovery throws a clear "Main world evaluation is disabled" error instead of silently recording nothing. Camofox also rejects non-http(s) URLs (`about:blank` included), and its `/wait` endpoint takes `timeout` (a readiness wait, up to that many ms), not `ms`; the client maps to that.

Do not enable Camofox's `trace` option for a doctor's session: a Playwright trace records the login `POST` body (the credentials, verbatim), `Cookie`/`set-cookie` headers, response bodies and screenshots of the login form, and it can only be switched on at session creation, so it necessarily spans the login. It is disqualified as a discovery channel for this use.

The browser service is intentionally external to the buildless StewardMD web application. This keeps browser automation out of the Cloudflare Pages runtime and allows the same Connect Agent to run from a controlled workstation or future managed browser runner.

## Controller

`connect-agent/controller.mjs` is the fail-closed human gate. It validates the generated specification and writes an approval receipt containing a SHA-256 digest of the exact spec. A changed spec invalidates the approval.

`validateAdapterSpec(spec, { schemaVersion })` defaults to `schemaVersion: 1` (legacy): any clinical word (medication, allergy, encounter, ...) anywhere in a path/queryKey blocks the event, read or not — kept as-is so old approvals don't silently change meaning. `schemaVersion: 2` (used by `adapter-pipeline.mjs` for freshly-discovered specs) separates action verbs (prescribe, order, delete, update, ...), which always block, from clinical-domain nouns, which only block on a non-safe HTTP method — so `GET /patients/1/medications` validates as the read it is.

Approval means **approved for conformance**, not automatic production activation. Production registration must remain behind the existing Connect registry/conformance process.

Example:

```bash
node connect-agent/controller.mjs adapter-spec.json adapter-approval.json <approverId> <hospitalName>
```

## Pipeline helper

`connect-agent/adapter-pipeline.mjs` composes consent → discovery → safety validation → sanitized artifacts. It does not deploy a connector.

## Browser discovery boundary

`discoverAuthorizedEmr()` requires an explicit origin allowlist. It records requests observed inside the authorized EMR page and creates an interface map. It does not attempt to defeat authentication, MFA, CAPTCHAs, browser security controls, origin restrictions, or other access controls.

The output is an interface map, not a production connector. Adapter generation, conformance and production enablement remain separate stages.

Each recorded event carries the explicit request `origin` the browser observed, and its `path` has identifier-shaped segments (numeric ids, UUIDs, 24-hex ids, long opaque tokens) collapsed to `{id}` — a patient/record id can live in the path even when no query value is stored, and origin is verified per-event rather than assumed from the first allowed origin.

**Verified against a real Camofox server** (`test/run-connect-agent-camofox-continuity.mjs`): a doctor's login in one tab and the agent's later `discoverAuthorizedEmr()` call share the authenticated session when they share a `userId` — Camofox scopes cookies to the per-`userId` browser context, not the tab, and the session survives the login tab being closed — and, with the main-world plugin, the observer captures the page's own requests (path, real origin, sensitive query keys filtered, value-free response shape).

**Known limitation, unchanged by this pass:** the observer only sees same-origin `fetch`/`XHR` issued *after* it is installed. Camofox's REST API has no init-script primitive and a create-blank/evaluate/navigate reordering does not help (`navigate()` replaces the document and wipes what `evaluate()` set — verified), so a request a page fires inline during its initial load is missed; requests it makes afterwards (delayed loads, polling, interaction-driven reads) are captured. No coverage of other frames, workers, or a second approved API origin. Expanding to multi-origin, cross-navigation observation is tracked separately; the per-event `origin` field is honest about what was seen, not proof of broader coverage.

## Doctor onboarding UI (`connect-agent-onboarding.js`)

Buildless ES5 IIFE, lazy-loaded by `connect-agent-boot.js` when the
`smd_connect_agent` flag is on (same entry point as the old test console:
`window.SMD_CONNECT_AGENT.open/close`, overlay id `smd-connect-ov`). Styles
ship as an injected `<style>` block (id `smd-connect-css`), matching the
previous console's convention. There is no separate CSS file.

Flow: hospital picker (search or canonical EMR URL) -> plain-language
read-only consent with an unchecked opt-in box (no pre-checked boxes) ->
embedded sign in viewport (iframe) with pause/resume -> live job progress with
one specific status line per job state -> success with a worklist placeholder
button. A returning doctor at a hospital with a validated adapter gets a
reconnect screen (re-authenticate only, no rediscovery stage list).

### `api()` seam contract

Every network call goes through `api(path, opts)`, which resolves
`{ s: <http status>, d: <decoded body> }`. Production `api()` calls `fetch`
against `/api/connect/agent` + path. Tests replace the transport with
`window.SMD_CONNECT_AGENT.__setApi(fn)`; `window.SMD_CONNECT_AGENT.__debug()`
reports `{ screen, sessionId, jobState, statusKind, statusText, controlOwner,
reuse, hospitalCount }` for assertions. Mocked response shapes per step:

| Call | Mocked shape |
|---|---|
| `POST /hospitals/resolve` `{query}` or `{emrUrl}` | `{ok:true,hospitals:[{hospitalId,name,emrUrl,hasActiveAdapter,adapterVersion}]}` |
| `POST /sessions` `{hospitalId,emrUrl,reconnect,consent:{scope:"read",agreed:true}}` | `{ok:true,sessionId,jobId,state}` |
| `POST /sessions/:id/viewer-token` | `{ok:true,viewerUrl,expiresInSec}` |
| `POST /sessions/:id/handoff` | `{ok:true,state}` (idempotent) |
| `POST /sessions/:id/pause`, `/resume` | `{ok:true,controlOwner:"clinician"\|"agent"}` |
| `GET /sessions/:id` | `{ok:true,state,stageDetail?,controlOwner?,errorCode?,errorDetail?,hospitalName?,adapterVersion?}` |
| `DELETE /sessions/:id` | `{ok:true}` |

Job states rendered with dedicated copy: `CREATED`, `AWAITING_LOGIN`,
`AUTHENTICATED`, `DISCOVERING`, `COMPILING`, `VALIDATING`,
`AWAITING_APPROVAL`, `ACTIVE`, `NEEDS_REAUTH`, `NEEDS_REPAIR`, `FAILED`,
`CANCELLED`, `EXPIRED`, `REVOKED`.

### Real vs. explicitly mocked (pending the broker router)

Real: the full sheet flow, spring motion, drag-to-dismiss, consent gating,
pause/resume control transfer, per-state progress rendering, error/retry
actions, keyboard and screen-reader support, and the `api()` call shapes above.
Mocked: there is no broker router yet, so `viewerUrl`, session/job ids, and
job-state transitions come from the `__setApi` mock in
`test/run-connect-agent-onboarding-ui.mjs`, and the iframe points at the
same-origin `test/connect-agent/viewer-fixture.html` page. Production must
point the iframe at a broker-issued, actor-bound, short-lived viewer URL
(noVNC-style session), never the raw EMR address. There is no
`docs/connect/agent-contract.md` yet; the endpoint paths above are proposed
per the hospital build brief, section 6, and must be reconciled with the real
router when it lands.

## Production checklist

A hospital adapter is not considered production-ready until all of the following are true:

1. Hospital/authorized clinician consent is recorded.
2. Discovery was performed in an isolated browser session.
3. No credential or raw PHI material is present in artifacts.
4. The adapter spec passes safety validation.
5. The exact spec is approved and hash-bound.
6. Adapter code passes the existing Connect conformance suite.
7. Read workflows are verified against a hospital-approved test account/test patient where available.
8. Write operations remain disabled unless separately authorized and explicitly enabled.
9. Audit logging and revocation are configured.
10. The adapter is registered and versioned through the existing Connect registry.
