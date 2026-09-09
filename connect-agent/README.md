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

## Camofox setup

Run Camofox separately and point `CAMOFOX_URL` at its REST server. The default is `http://127.0.0.1:9377`; `CAMOFOX_ACCESS_KEY` is used only to authenticate to the Camofox service.

The browser service is intentionally external to the buildless StewardMD web application. This keeps browser automation out of the Cloudflare Pages runtime and allows the same Connect Agent to run from a controlled workstation or future managed browser runner.

## Controller

`connect-agent/controller.mjs` is the fail-closed human gate. It validates the generated specification and writes an approval receipt containing a SHA-256 digest of the exact spec. A changed spec invalidates the approval.

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
