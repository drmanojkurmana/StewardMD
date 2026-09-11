# Connect Hospital acceptance test matrix

Section 10 of the handoff brief, run against the real modules (broker router, runner router,
activation, manifest compiler/interpreter/validator, browser-session connector) and the real
multi-tenant synthetic hospital fixture (`test/connect-agent/synthetic-hospital.mjs`) - in-memory D1
testkit + the fixture's real HTTP server + `execFromFetch(realFetch)` as the transport. Not a
hand-wired fake that bypasses the actual modules.

Test file: `test/connect-agent/acceptance/matrix.test.mjs`. Run: `node --test
test/connect-agent/acceptance/matrix.test.mjs`.

| # | Scenario | Status | Where |
|---|---|---|---|
| 1 | Same browser context survives doctor login -> agent handoff -> runtime read | **Skipped** - requires a live Camofox server with the main-world plugin. Already verified separately against a real Camofox instance: `test/run-connect-agent-camofox-continuity.mjs`. | matrix.test.mjs:~ (skip) |
| 2 | Doctor A produces an active adapter; Doctor B reuses the exact version via a fresh session with zero rediscovery | **Real.** Full path: session -> consent -> handoff -> runner lease -> discover/compile/validate reports -> activation with real evidence-hash binding -> Doctor B resolves the same version and reads through it. | matrix.test.mjs:331 |
| 3 | Cross-tenant and stale-token denials fail closed | **Real**, plus a pointer to the router's own adversarial suites which cover the rest: `test/connect/agent/router.test.mjs`, `test/connect/agent/runner-router.test.mjs`, `test/connect/rbac-adversarial.test.mjs`. | matrix.test.mjs:585 |
| 4 | Patient and encounter identities remain correct across pagination and concurrent selections | **Real**, against the fixture's real paginated worklist. | matrix.test.mjs |
| 5 | Cookies, passwords, OTPs, PHI path segments never reach manifest/activation/error output | **Real**, using the same leak-detection technique as `connect-agent/manifest`'s own tests, applied to real synthetic-hospital responses. | matrix.test.mjs |
| 6 | Redirects, private-network targets, unapproved API origins blocked at network execution | **Real.** | matrix.test.mjs |
| 7 | GET-mutation traps, GraphQL mutations, unknown clicks, prompt injection cannot trigger writes | **Real**, using the synthetic hospital's trap counters (`assertZeroTraps`), asserted at the end of every scenario, not just this one. | matrix.test.mjs |
| 8 | Observer handles fetch(Request), XHR, initial/navigation requests across frame boundaries | **Skipped** - requires a live Camofox server. Unit-level coverage already exists: `test/connect-agent/discovery-lifecycle.test.mjs`. | matrix.test.mjs:~ (skip) |
| 9 | Empty observations, malformed manifests, missing mappings, wrong units, partial responses cannot activate | **Real.** | matrix.test.mjs |
| 10 | Consent expiry/invalid date, revocation, manifest/evidence tampering, insufficient activation role fail closed | **Real**, through the actual router (not just the module directly - `functions/_connect/agent/activation.js`'s own unit tests already cover the module in isolation). | matrix.test.mjs:894 |
| 11 | Runner crash, timeout, duplicate completion, app backgrounding, retries and cancellation leave consistent state | **Real**: lease timeout + reclaim by a second runner, progress/success report sequencing, duplicate terminal report as a no-op. | matrix.test.mjs:952 |
| 12 | Session expiry prompts re-login, preserves the hospital adapter, never falls back to another doctor's session | **Real.** | matrix.test.mjs |
| 13 | EMR drift puts only the affected version into NEEDS_REPAIR; validated rollback restores service; restricted role reported as restricted access | **Real**, through the real store/activation code. | matrix.test.mjs |
| 14 | Existing FHIR/REST/SDK/tenant/RBAC/canonical regressions remain green | **Real** - the full existing suite is run alongside this file every time (see the command list in the commit message / CI). | matrix.test.mjs |
| 15 | Real browser UI verifies keyboard/focus/loading/error/retry; native iOS/Android verify viewer continuity | **Skipped** - requires physical mobile devices for the native half. The web UI half is already verified for real: `test/run-connect-agent-onboarding-ui.mjs` (61/61, headless Chrome via CDP). | matrix.test.mjs:~ (skip) |

**12 of 15 scenarios run as real, executing code.** The 3 skips are all honestly infrastructure-gated
(a live Camofox server, physical mobile hardware) and each names exactly what already covers the
adjacent ground at the unit or transport level - none are silently mocked into looking done, per the
brief's own instruction against that.

## Bugs this matrix caught building it

Writing real integration tests against real modules surfaced defects no unit test had exercised,
because each unit test constructed its own consistent fixture rather than two different tracks'
components meeting for the first time:

- **Router bug**: `POST /sessions/:id/handoff` advanced the job straight to `DISCOVERING`, but
  `JOB_LEASABLE` (state.js) only accepts `CREATED`/`AUTHENTICATED` - a job handed off this way could
  never actually be leased by a runner. Fixed: handoff now stops at `AUTHENTICATED`; the runner's own
  `POST .../report` is what legitimately advances the job once it has actually leased and started work.
- **Manifest validator bug**: `validateCandidate`'s identity check assumed every raw upstream item
  carries a literal `.id`/`.identifier` key. A real EMR item routinely does not - that is exactly why a
  manifest declares its own `id` mapping. Fixed to derive the identity check from the operation's own
  declared mapping instead of guessing at the raw shape.
