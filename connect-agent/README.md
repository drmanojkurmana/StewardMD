# StewardMD Connect Agent — Camofox transport

This transport makes Camofox the browser execution layer for authorized EMR integration discovery.

## Architecture

```text
Clinician consent
  -> Camofox browser session
  -> authorized EMR login/navigation
  -> Connect discovery observer
  -> sanitized request/response schemas
  -> adapter-spec.json
  -> Connect Controller review
  -> conformance tests
  -> explicit production enable
```

## Credential rule

The Connect Agent does not accept or persist an EMR password. The clinician authenticates in the browser session. Discovery records only sanitized interface metadata. Cookies, authorization headers, bearer tokens, passwords and patient values are not written to the adapter specification.

## Camofox setup

Run Camofox separately and point `CAMOFOX_URL` at its REST server. The current client defaults to `http://127.0.0.1:9377` and optionally sends `CAMOFOX_ACCESS_KEY` as a bearer credential for the Camofox service itself.

The browser service is intentionally external to the buildless StewardMD web application. This keeps browser automation out of the Cloudflare Pages runtime and makes the same Connect Agent usable from a controlled workstation or a future managed browser runner.

## Discovery boundary

`discoverAuthorizedEmr()` requires an explicit `allowedOrigins` list. It will only record requests whose origin is in that allowlist. It does not attempt to defeat authentication, MFA, CAPTCHAs, browser security controls, or origin restrictions.

The output is an interface map, not a live connector. A separate generation/controller stage must review it before a connector can be registered.
