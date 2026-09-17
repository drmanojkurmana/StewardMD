# WardSynQ Penetration Test Plan (P2.17)

A practical plan a hired tester or the owner can run against wardsynq.com.
Every "where the defence lives" pointer is a real file in this repo, checked
at the time of writing. Test against staging first; production only with a
written window and a rollback contact.

## 1. Scope and rules of engagement

Scope: the WardSynQ clinical doors (`/api/queue/*`, `/api/wardsynq/*`,
`/api/fhir/*`, `/api/portal/*`), the ward frontend (`ward.js`, the site shell
and pages under `wardsynq/site/`), SMART/OAuth, bulk export, webhooks,
document upload/download, and the patient portal. Out of scope: Firebase,
Cloudflare, Apple/Google infrastructure, physical security, social
engineering of staff, and denial-of-service load testing.

Rules:

- Staging first. Use a preview deployment or the OTA candidate slot (staging
  is never live; see `.github/workflows/ota-stage.yml`), never the production
  tenant. Promote to production only after staging is clean.
- No real PHI. Seed synthetic patients (the demo-script pattern in
  `scripts/wardsynq-demo-live.sh` shows how scripted tenants are built) and
  keep the synthetic IDs recognizable (for example names starting with ZTEST)
  so a leak is obvious and harmless.
- Test tenants only. Create two hospitals (Tenant A and Tenant B) plus a
  third party SMART client and a portal grant, so cross-tenant tests have a
  place to live. Tenancy is decided server-side from `connect_membership`
  (see `functions/_connect/identity.js` `resolveTenant`, and org linking in
  `functions/_connect/enterprise/org.js` `selfCreateTenant`).
- Flag gates stay as in production. The record door 404s unless
  `WARDSYNQ_RECORD=1` (`functions/api/wardsynq/[[path]].js` `recordFlagOn`);
  test with the flag exactly as production sets it, and separately confirm a
  flag-off build leaks no existence (404, not 403).
- Stop and report on first confirmed cross-tenant read, privilege escalation,
  or secret disclosure. Do not pivot further; capture the audit evidence
  (section 12) and hand over.
- Findings go through `docs/INCIDENT_RESPONSE.md`; launch-blocking issues
  through `docs/LAUNCH_SECURITY_RUNBOOK.md`.

## 2. Authentication (staff PIN, password, two-step sign-in)

What to test: brute force of staff PIN and email/password login, session
fixation/reuse after PIN reset or disable, second-factor enrolment and replay,
and signed-in versus signed-out access to every clinical route.

How to test it:

- POST wrong PINs for one staff identity 6+ times from one client; then try
  the correct PIN. Repeat for email/password.
- Sign in, then (as owner) reset that member's PIN, disable the member, and
  replay the old `X-Staff-Token`.
- For a role with two-step required: sign in without MFA setup and try a
  clinical call; complete TOTP setup, then replay an old TOTP code and a code
  from a skewed clock.
- Call a clinical route with no token, a garbage token, and an expired token.

Expected secure result: lockout after 5 attempts for 15 minutes on both PIN
and password, independently; pre-reset sessions rejected; MFA-setup-only
sessions can reach setup and nothing else; unauthenticated clinical calls 401
with no data.

Where the defence lives: `functions/_opd_auth.js` (`PIN_MAX_ATTEMPTS`,
`PIN_LOCK_MS`, `pinLocked`/`nextPinState`, `passLocked`/`nextPassState`,
`passwordProblem`/`pinProblem`, PBKDF2 `hashSecret`/`verifySecret`,
`verifyStaffSession`, `sessionRevoked`, TOTP `newTotpSecret`/`verifyTotp`);
the entry point and MFA-setup-only gate in `functions/api/queue/[[path]].js`
(`resolveActor`, `mintMfaChallenge`/`verifyMfaChallenge`); Firebase checks in
`functions/_fbauth.js` (`verifyFirebaseToken`, `identify`); owner checks in
`functions/_adminauth.js` (`ownerOK`).

## 3. Authorization (cross-hospital IDOR, role escalation)

What to test: every object route (ward, record, room, bed, group, session,
ticket) with Tenant B credentials against Tenant A IDs; role-vs-capability
mismatches (nurse prescribing, reception reading charts, lab writing vitals,
cashier coding claims); staff-admin changes (promote self, touch the owner,
grant a role you do not hold).

How to test it:

- As Tenant B staff, replay Tenant A IDs captured from Tenant A sessions
  across ward/record/room/bed/group routes; also swap `orgId`/`hospitalId`
  parameters while keeping your own session.
- As nurse/reception/cashier/lab roles, attempt writes outside the grant
  table (prescribe, diagnose, release results, code claims).
- As `hr` (staff.admin but low clinical caps): promote yourself to admin,
  change your own role, disable the owner's sign-in, create another manager.

Expected secure result: cross-tenant access refused (`org_not_found`,
`not_a_member`, never data); out-of-scope writes 403 `SCOPE_DENIED` with the
refusal naming the attempted action; staff-admin changes outside your own
capabilities refused (`owner_protected`, `own_role`, `target_outranks_you`,
`role_above_yours`).

Where the defence lives: `functions/_opd_org.js` (`authorizeOrgAccess`,
`memberChangeRefusal`, `canAccessOrg`, `withinScope`, `isOwnerOfOrg`);
`functions/_queue_roles.js` (roles, capabilities); the per-request gates in
`functions/api/queue/[[path]].js` (`loadSessionFor`, `requireSessionCap`,
`requireOrgOrGlobal`); the clinical grant in `functions/_wardsynq/actor.js`
(`resolveClinicalActor`, `grantForCaps`); enforcement in
`functions/_wardsynq/service.js`.

## 4. SMART on FHIR / OAuth flows

What to test: authorize URL tampering (redirect_uri, client_id, scope
widening), PKCE removal or mismatch, code replay and cross-client redemption,
refresh-token reuse and expiry, revoked-client access, backend-services
assertion forgery (wrong audience, expired, wrong key).

How to test it:

- Alter `redirect_uri` to an unregistered host; request scopes above what the
  client registered (for example add `system/*.read` to a narrow client).
- Redeem the same code twice and from a second client; drop the PKCE verifier
  or send a wrong one.
- Use a revoked grant, an expired refresh token, and a client assertion
  signed with a different key or with a stale `exp`.

Expected secure result: unregistered redirect refused; scopes clamped to the
registration; second redemption fails; PKCE mismatch fails; revoked/expired
grants and forged assertions rejected; token endpoint rate limited (429 with
`Retry-After`).

Where the defence lives: `functions/_wardsynq/smart-server.js`
(`smartEnabled`, `parseScope`/`grantScopes`, `pkceMatches`, `createLaunch`,
`authorize`/`decide`/`token`/`revoke`, `resolveBearer`,
`verifyClientAssertion`, `signingKey`/`publicJwks`); the HTTP door in
`functions/api/fhir/[[path]].js`; limiter in
`functions/_wardsynq/rate-limit.js` (`hit`).

## 5. FHIR bulk export and download authorization

What to test: kickoff with a narrow token, status/file reads of another
hospital's export, file URL sharing with an unauthenticated browser,
concurrent exports, and expiry of download links.

How to test it:

- Kick off an export as a bearer that lacks export scope; list and fetch
  export status/files of Tenant A as Tenant B.
- Copy a file/download URL into a clean browser with no token and GET it.
- Start two exports for the same hospital at once; fetch a file after its
  TTL.

Expected secure result: kickoff refused without scope; status and files are
tenant-bound (404 across tenants, never 403-with-metadata); file URLs are
useless without the bearer; second concurrent export throttled (429);
expired files gone.

Where the defence lives: `functions/_wardsynq/fhir-bulk.js`
(`kickoffExport`, `exportStatus`, `exportFile`, `listExports`,
single-running-export throttle); routing in
`functions/_wardsynq/fhir-route.js` (`dispatchBulk`); errors in
`functions/_wardsynq/fhir.js` (`operationOutcome`).

## 6. Webhooks and SSRF

What to test: registering webhook and outbound destinations pointing at
internal targets (169.254.169.254, localhost, 10/8, 192.168/16, fc00::/7),
HTTP (non-TLS) URLs, URLs with userinfo, DNS names that resolve private, and
redirect chains that start public and land private.

How to test it:

- Register destinations with each blocked shape above plus
  `http://public-host/`, `https://user:pass@host/`, `https://localhost./`,
  `https://x.internal/`, and a public URL that 302s to
  `http://169.254.169.254/`.
- Save the destination, then trigger a delivery and watch where the bytes go
  (use a request-bin you control plus an internal sink that must stay silent).

Expected secure result: every blocked shape refused at save time and again at
fetch time (`bad-url` / `ssrf`, nothing sent onward); cross-origin redirects
drop and re-check each hop; plain HTTP refused.

Where the defence lives: `functions/_connect/onboard/ssrf.js`
(`assertPublicHttpsUrl`); transport in `functions/_connect/onboard/net.js`
(initial validation plus per-hop re-check); save-time guards in
`functions/_connect/onboard/store.js`, `functions/_connect/onboard/pull.js`,
`functions/_connect/onboard/worklist.js`,
`functions/_connect/onboard/discover.js`; webhook registration and delivery
in `functions/_wardsynq/webhooks.js`; outbound destinations in
`functions/_wardsynq/fhir-outbound.js`; transmit in
`functions/_wardsynq/transmit-send.js`. Residual: DNS rebinding is documented
open in `ssrf.js` (resolve-then-pin is future work), so a hostname that
passes literal checks but resolves private at fetch time is a known gap to
retest, not a surprise.

## 7. File and document upload and download

What to test: oversized files, disallowed content types, polyglot/HTML
uploads served back inline, version overwrite, early purge, and link sharing
or guessing.

How to test it:

- Upload 11 MB, `.exe`, `.svg`, and HTML-with-script files as each document
  type; upload a new version and try to open the old one.
- Withdraw then purge before retention expiry; open a signed link after 5
  minutes, from another user, and with a tampered signature; guess an object
  key directly against the bucket.

Expected secure result: over-limit and off-allowlist uploads refused;
versions append-only (old bytes still open); purge refused until the
hospital's retention period passes with metadata retained; links are
single-person, single-document, 5-minute, audited on use; bucket holds
ciphertext only under unguessable keys.

Where the defence lives: `functions/_wardsynq/documents.js`
(`DOC_TYPES`, `CONTENT_TYPES`, `MAX_BYTES`, `DEFAULT_RETENTION_YEARS`,
`uploadDocument`, `documentVersions`, `withdrawDocument`, `purgeDocument`,
`documentLink`, `serveDocumentLink`, AES-GCM encrypt before storage);
`functions/_wardsynq/object-store.js`
(`storeFromEnv`, `s3Store`, `signV4`).

## 8. XSS in ward rendering

What to test: stored XSS through every patient-controlled string the ward
renders (names, notes, refusal text, error banners, handover text), and
reflected content in the SMART consent page.

How to test it:

- Store `<img src=x onerror=alert(1)>`, `<svg/onload=...>`, and
  quote-breaking payloads in each rendered field; load the ward screen and
  watch for execution (use a harmless `console.log` marker, not `alert`, on a
  shared staging box).
- Grep new rendering code for string concatenation into HTML without the
  escaper.

Expected secure result: every dynamic string escaped (`&amp; &lt; &gt;
&quot; &#39;`); no script execution; the consent page serves no script with a
deny-by-default policy.

Where the defence lives: `ward.js` (`esc()` plus its call sites in banners,
refusals, doses); the consent page policy in
`functions/api/fhir/[[path]].js` (`page()` Content-Security-Policy,
`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

## 9. Rate limits

What to test: PIN/password guessing past the lockout, token-endpoint floods,
public-form flooding (hospital requests, feedback, clientlog), export
stampedes, and per-IP rotation evasion.

How to test it:

- Exceed each published cap from one identity/IP and confirm the refusal,
  the window, and recovery after it; rotate IPs/headers and confirm the
  server-derived key still binds (limits keyed on caller identity, not on a
  caller-supplied bucket string).
- Double-submit the same prescription/consent write and confirm one effect.

Expected secure result: 429 with `Retry-After` (or lockout timestamps for
PIN), fail-open only on the store (a broken counter never becomes an allow),
idempotent writes under retry.

Where the defence lives: `functions/_wardsynq/rate-limit.js` (`hit`,
memory/KV/binding stores); SMART endpoints in
`functions/_wardsynq/smart-server.js`; PIN/password lockout in
`functions/_opd_auth.js`; public-form caps in
`functions/api/hospital-request.js`, `functions/api/hospital-request/[[path]].js`,
`functions/api/ws-feedback.js`, `functions/api/maik-feedback.js`,
`functions/api/clientlog.js`; verify caps in `functions/_pglog_public.js`
and `functions/_rx_public.js`; export throttle in
`functions/_wardsynq/fhir-bulk.js`; AI metering in `functions/_usage.js`.

## 10. Patient portal and proxy access

What to test: code guessing, grant enumeration, cross-patient reads, proxy
(messaging/appointment) abuse, and consent withdrawal propagation.

How to test it:

- Redeem wrong codes past the attempt cap; probe sequential grant IDs;
  request Tenant A records with a Tenant B session; submit messages with
  another patient's session; withdraw consent and re-read.
- Confirm GET/OPTIONS-only or query-string tokens are refused (session
  tokens must not travel in URLs).

Expected secure result: codes hashed at rest, attempts capped on the grant,
wrong-code and missing-grant indistinguishable; no patient id accepted from
the caller; POST-only; withdrawal ends the session's reads.

Where the defence lives: `functions/api/portal/[[path]].js` (two routes,
POST-only, no patient id from caller, no staff imports);
`functions/_wardsynq/patient-access.js` (`makeCode`/`hashSecret`/`sameSecret`,
`MAX_ATTEMPTS`, `CODE_TTL_MINUTES`/`SESSION_TTL_MINUTES`,
`redeemable`/`sessionLive`, `redeemCode`, `portalRead`, `sessionPatient`,
`enrolPatient`, `revokeAccess`, `listGrants`);
`functions/_wardsynq/portal-view.js` (`withdrawOwnConsent`);
`functions/_wardsynq/portal-requests.js`
(`sendMessage`, `requestAppointment`).

## 11. Audit evidence to check after each test

After every test above, confirm the trail saw what you did: your denied
attempts must appear as refusals, your allowed reads as reads, and reading
the trail must itself be recorded. Check the security-review evidence table
for your actor (action word, record type and id, patient-reference hash,
outcome), then the FHIR AuditEvent projection of the same rows. A test that
passed but left no trail is a finding, not a pass: silent doors cannot be
monitored.

Where the defence lives: `functions/_wardsynq/security-review.js`
(`evidenceRow`); `functions/_wardsynq/fhir-audit.js` (`fhirAuditEvent`,
`auditEvents`, patient references as hashes only); the underlying
`connect_audit_event` rows via `repository.auditTrail`; request visibility in
`functions/_wardsynq/observability.js`.

## 12. Cadence

- Before go-live: full plan on staging, all sections, with the production
  flag set. No section may be skipped or marked "covered by unit tests".
- At least yearly: full plan again, plus a re-run of
  `node scripts/security-scan.mjs` and the reachability gate
  (`node scripts/wardsynq-reachability.mjs`).
- After major changes: the affected sections only (new route: section 3;
  new OAuth client type: section 4; new upload type: section 7; new
  patient-facing flow: section 10), plus the automated gates on every PR via
  `.github/workflows/ci.yml`.
- Findings feed `docs/INCIDENT_RESPONSE.md`; launch gates feed
  `docs/LAUNCH_SECURITY_RUNBOOK.md`.

## Security scan (automated, every PR)

`node scripts/security-scan.mjs` (unit tests in
`test/security-scan.test.mjs`) checks committed code for secret shapes,
dangerous server patterns and unguarded request-input fetch under
`functions/`, CORS/auth gaps in `functions/api/**`, and npm audit
high/critical advisories. Secret, dangerous-pattern and CORS/auth findings
block the PR; dependency advisories print as WARN lines for owner review and
never block; client values that are public by design (the Firebase client
keys, the AWS documentation example) match by SHA-256 fingerprint and count
as public-by-design, so a different key of the same shape still fails.
Reviewed exceptions carry an inline `security-scan: allow <reason>` comment
on the same line.

Where the defence lives: `scripts/security-scan.mjs` (`SECRET_RULES`,
`KNOWN_PUBLIC`, `PRIVATE_KEY_HEADER_RE`/`hasKeyMaterial`,
`scanTextForDangerous`, `hasApiAuth`/`PUBLIC_ALLOWLIST`,
`formatDepWarning`/`depRanMessage`); the CI gate in
`.github/workflows/ci.yml` (security-scan job).

## 13. Findings template

Copy one block per finding:

- Title: (one line, what is wrong)
- Severity: Critical / High / Medium / Low (with one-sentence impact)
- Area: (section number above)
- Steps to reproduce: (numbered, against which tenant/role/token)
- Expected vs actual: (the secure result from the section vs what happened)
- Evidence: (audit rows, response codes, timestamps; patient hashes only,
  never names or content)
- Defence pointer: (file and function that should have stopped it)
- Suggested fix: (code seam, not just "validate input")
- Retest: (exact re-run that proves the fix)
