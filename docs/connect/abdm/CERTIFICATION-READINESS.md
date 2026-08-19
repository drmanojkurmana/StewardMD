# ABDM certification report — 2026-08-19

*Scope note: feature development on ABDM stopped on owner instruction (2026-08-19). Everything after that
point is certification hardening only. This document is the final report.*

**Not certification-ready** — but the FHIR gap is closed: all eight mandatory HI types now conform to the
real NRCES profiles. What remains is that **no ABDM callback body has yet been observed**, and nothing yet
populates the two newest SCCM collections. Everything below distinguishes what was proven against real
ABDM behaviour from what is only proven against our own tests, because those are not the same claim.

Branch `feat/abdm-v3-reconcile`. All flags OFF. Nothing merged.

---

## 1. What is now complete

| | Status | Proven by |
|---|---|---|
| Fidelius E2E crypto | done | independent BigInt oracle reproducing BouncyCastle |
| Wire formats (D4, D4b, D4c, D6) | done | ABDM's own M2/M3 Postman collections |
| Consent-init body (D7) | done | **live gateway**, field-by-field |
| Cross-tenant write (D8) | fixed | route-level adversarial tests |
| KV key guard (D9) | fixed | 0/2000 false positives, was 141/2000 |
| M2 HIP callbacks (9 kinds) | wired | unit + adversarial tests |
| M3 HIU callbacks (6 kinds) | wired | unit tests |
| Demographic discovery | done | 32 tests incl. ambiguity + cross-tenant |
| Link OTP | done | 30 tests; delivery honest-false until provisioned |
| FHIR conformance (**8 of 8**) | **done** | **HAPI 6.2.1 vs the real NRCES IG, 0 errors** |
| Published ABHA consent language | done | transcribed from ABDM's own image, recorded single-use |
| Erasure completeness | done | R2 blobs + discovery index, verified to fail without the fix |
| D1 migration | done | real SQLite, clean/old/current/half-migrated |
| SCCM v1.1 immunisations + billing | done | 17 tests, round-trip proven |
| Link-OTP number lookup | done | 6 tests incl. the cross-tenant guard |
| Discovery index populated at link | done | 5 tests through the real route |
| A real bill -> InvoiceRecord | done | 11 tests + HAPI on the emitted bundle |
| OPD immunisation capture -> ImmunizationRecord | done | 13 tests + HAPI on the emitted bundle |
| All 15 inferred shapes fail SAFE | done | 5 sweep tests x 15 kinds x 11 hostile bodies |
| M2/M3 E2E verdict tooling | done | `--expect`, verified offline |
| M1 client UI | done | 22 tests |

**Test counts:** ABDM + connect suites **1092/1092**. Client **22/22**. Full-repo sweep unchanged apart from four
pre-existing failures (`followcare-voice-server` 1, `onco-emr` 3, `site-gate` 2, `sknx-flags` 3) — none
imports anything changed here.

## 2. What was tested against REAL ABDM behaviour

Only these. Everything else is internal.

**Live gateway (`dev.abdm.gov.in`, our own bridge credentials):**

- Session, bridge-services, bridge/url PATCH — all 200/202.
- **Consent-init field matrix.** Removing one field at a time and posting for real. The gateway's own words:

  | Removed | Gateway says |
  |---|---|
  | `consent.hiu` | "HIU ID is mandatory" |
  | `permission.accessMode` | "Invalid accessMode, it must be in VIEW, STORE, QUERY, STREAM" |
  | `permission.frequency` | "Frequency should not be null or empty" |
  | `hiTypes` | "HI Types cannot be null" |
  | `purpose` | "Consent purpose cannot be null" |
  | `requester` | *accepted* — we refuse anyway (certification pins it) |
  | `hip` / `careContexts` | *accepted* — we send explicit nulls, as ABDM's collection does |

  Pinned in `test/connect/abdm/fixtures/sandbox-probes.mjs`; reproduce with
  `./scripts/abdm-sandbox-probe.sh consent-matrix`.

- **Subject resolution is synchronous.** An unknown ABHA address is refused `400 "User not found"` on the
  request itself and **no callback is emitted**. This is why no callback can be captured yet.

**Real HAPI validator, real NRCES IG** — see §3.

**NOT tested against ABDM:** every inbound callback body. All 15 handler payload shapes are still marked
`// INFERRED`.

## 3. Validator results

`HAPI validator_cli 6.2.1` (the version ABDM's FAQ Q37/Q46 names) against
`https://nrces.in/ndhm/fhir/r4`, terminology off, single clean run.

**Before:** 8 of 8 HI types rejected, ~60 errors — while our own `validateNdhmDoc` passed all eight. Two
of the eight were additionally *unproducible*, because SCCM had nowhere to put a vaccination or a bill.

**After:**

```
OPConsultRecord           PASS        DischargeSummaryRecord   PASS
PrescriptionRecord        PASS        HealthDocumentRecord     PASS
DiagnosticReportRecord    PASS        WellnessRecord           PASS
ImmunizationRecord        PASS        InvoiceRecord            PASS
InvoiceRecord-projected   PASS        <- from a REAL clinic bill, not the fixture
ImmunizationRecord-projected PASS     <- from a REAL OPD vaccination capture
total errors: 0   (all 8 of 8, plus both projections)
```

**The two projected bundles earn their place.** The eight above are serialised from hand-written fixtures, whose ids
happen to be FHIR-legal. `InvoiceRecord-projected` is built from a real `q_invoices` row instead, and it
**failed with 3 errors** on its first run: FHIR `Resource.id` is `[A-Za-z0-9-.]{1,64}` and the billing store
mints `inv_<hex>` — an underscore. HAPI rejected the Invoice outright and then failed the section entry
referencing it. Our own gate passed it, which is the same failure mode this file documents at §3: asking our
serializer whether it is happy proves nothing. Fixed at `entryOf`, the single funnel every resource passes
through on its way into a bundle, and `validateNdhmDoc` now refuses the charset too, so the next one is
caught without a JDK.

Evidence: `docs/connect/abdm/fhir-validation-evidence.log`.
Reproduce: `./scripts/abdm-validate-fhir.sh` (needs a JDK; downloads a 220MB jar once).

Root cause was one generic bundle for eight profiles — five of them allow `Composition.section` a maximum
of **one** with entry slicing CLOSED. Fixed by driving the serializer from a shape table read out of the
IG package itself.

## 3b. Certification hardening (the last pass)

Six areas, in the order the owner set them. Two are blocked on a sandbox ABHA address and say so.

| Area | State | Evidence |
|---|---|---|
| Real callbacks | **BLOCKED** on a `@sbx` address | tooling ready; fail-safety proven instead (below) |
| Demographic discovery | done | 32 unit + 5 route tests; index now populated at `/link` |
| OTP | done bar the DLT template | 30 tests; bounded attempts (3), resend cap (2), 3/hour budget, Q31 3/day |
| HAPI / NRCES validation | done | 10 bundles, 0 errors, committed evidence log |
| M2 / M3 sandbox E2E | **BLOCKED** on a `@sbx` address | one-command verdict built and verified offline |
| This report | done | you are reading it |

**The 15 inferred shapes: being wrong is now survivable.** ABDM has never published the V3 request YAML, so
all 15 handlers parse a body we reasoned our way to. No test can tell us the real shape - only a captured
callback does that - but `test/connect/abdm/inferred-shapes-failsafe.test.mjs` sweeps every kind against 11
bodies that break our assumption in different ways (null, wrong type, one level too deep, one too shallow,
hostile strings, a 500-element array) and proves three properties:

1. **Never crash.** A `TypeError` escaping a handler is a 5xx, and ABDM retries non-2xx - so a parser bug
   becomes a retry storm against a body that will fail identically every time. Deliberate refusals are
   fine: `callbacks.js` catches them and still ACKs 202.
2. **Never mis-attribute.** A body we cannot parse writes NOTHING. Filing data against a guessed patient is
   how one person's records reach another, and a linked care context can never be withdrawn.
3. **Never silently succeed.** Every unparseable body leaves an audit trace, so the capture exercise has
   something to diff against.

A count assertion pins the sweep at 9 HIP + 6 HIU = 15, so adding a handler without covering it fails the
suite rather than quietly shrinking the claim. It earned its place immediately: the sweep initially claimed
14 because `discover` had been missed.

**M2 / M3 E2E is one command, waiting on the address.** `abdm-capture.py --expect m2|m3|server-driven` polls
until every callback a milestone needs has arrived, prints PASS/MISSING per step, and exits non-zero
otherwise. `flow` only triggers; `--expect` is the evidence the flow *worked* - a 202 says ABDM accepted the
request, not that the callback came back. The verdict logic is unit-verified offline against synthetic
records (partial set reads INCOMPLETE and names what is missing; full set reads COMPLETE).

Start with `--expect server-driven`: if the two callbacks that need no human tapping are MISSING, the
registered URL is wrong or expired, and nothing else is worth debugging.

## 4. Remaining blockers

### Blocking certification

1. ~~ImmunizationRecord and InvoiceRecord cannot be produced.~~ **RESOLVED.** SCCM v1.1 added
   `immunizations` and `invoices` across all four layers (model, validator, serializer, normalizer), with
   the IG's own code systems. All 8 HI types now conform. A record that happens to carry neither still
   cannot produce those HI types, which is correct — refusing beats pushing a document the far end rejects.

2. **No callback body has been observed.** Needs a sandbox ABHA address (yours: Sandbox ABHA apk,
   Android, ~10 min) and, for roughly half the callbacks, you tapping in the app. Runbook:
   `docs/connect/abdm/CAPTURE-RUNBOOK.md`. **Do not set `CONNECT_HIP_FLAG=1` before this** — an unverified
   parser against a real peer fails silently, which is how D4, D6, D4b and D4c all happened.

3. **M2 / M3 end-to-end not executed.** Same dependency as (2).

4. **India hosting.** ABDM requires an India-based callback host addressed by domain. Cloudflare Regional
   Services has an India region but is Enterprise-only and gives processing residency only — KV
   incompatible, D1 has no jurisdictional restriction, R2 jurisdictions are eu/fedramp. Ask NHA first
   (`integration.support@nha.gov.in`); fallback is a Mumbai forwarder. Only item with a recurring cost.

5. **Functional testing + CERT-In/STQC.** NHA-empanelled agency, chargeable, 7-working-day window once
   started. Worth quoting now.

### Needs a decision from you

6. **OTP delivery — the only thing still missing is the template.** An Indian transactional SMS needs a
   DLT-approved template. `deliverOtp` returns `not_configured` and `on-init` reports `delivered:false`
   until you register an OTP template and set `ABDM_OTP_TEMPLATE`. Nothing fakes a send. The *number* is
   now found (see 7), so once the template exists this path is complete.

7. ~~`findTicketMobile` is unbound, so the OTP has no number to go to.~~ **RESOLVED.** Bound to the
   queue's real lookup: `_queue_engine.findMobileByPatientId` reads this patient's most recent OPD ticket
   and decrypts `encMobile` for one send. `fsQuery` takes a single field filter, so the org is filtered in
   JS — and that filter is a cross-tenant guard with its own test, because a colliding MR# at another
   hospital would otherwise hand back a stranger's phone number.

8. **A stated invariant was narrowed — please confirm.** The serializer said "ZERO binary: attachment
   bytes are never emitted". NRCES makes `DocumentReference.content.attachment.data` min=1, so a
   HealthDocumentRecord *without* the scanned bytes is invalid. Bytes are now emitted **only** for that
   profile, **only** when the source has them; a `data:` URI is still refused everywhere, and a
   HealthDocumentRecord with no bytes is refused. `consented-store.js` already anticipated this. Marked
   `// VERIFY (owner)`.

9. **The old capture token is in git history.** `3ffcc1bd` committed a webhook.site URL, and ABDM
   callbacks to it would carry PHI. It has been **rotated and unregistered**, so the exposed one is inert.
   The doc no longer records any token — read it from `./scripts/abdm-sandbox-probe.sh bridge`. Rotate
   again once the capture exercise is done.

### Lower priority

10. ~~Demographic discovery needs `indexPatient` called from registration.~~ **RESOLVED.** It is called
    from `POST /api/abdm/link` — the moment we hold ABHA-*verified* demographics, and already an
    authenticated, tenant-resolved write. A link with no gender or year of birth writes **nothing** and
    reports `discoverable:false`: both discovery arms require those two to corroborate, so such a row could
    never match anything. An index failure does not lose the ABHA binding.
10b. ~~Nothing populates the new SCCM collections.~~ **BOTH RESOLVED.** A real clinic bill projects to a
    conformant InvoiceRecord (`hip-sources/clinic-billing.js`, from `q_invoices`), and **OPD immunisation
    capture now exists** (owner-approved 2026-08-19): a vaccination recorded in the OPD EMR projects through
    `native-opd.js` to a conformant ImmunizationRecord. Both are validated by HAPI as emitted bundles, not
    just by our own gate. Vaccine codes are generated from the IG's own `ndhm-vaccine-codes` value set
    (179 SNOMED concepts, `scripts/gen-vaccines.mjs`) and the server refuses any code outside it.
10c. `clinic-billing.js` is a projection, not yet a wired HIP source. Advertising a bill as a care context
    needs two decisions it cannot make: whether a bill should be linkable at all (a linked context can
    never be withdrawn), and how it survives the same `q_*` retention conflict `native-opd.js` documents.
11. `ABDM_CLIENT_ID` is a committed wrangler var (the secret is a Pages secret). Deliberate and documented;
    override if you disagree.

## 5. Reproducing everything

```bash
cd <repo>

# ABDM + connect suites (1092 tests) - no external dependencies.
# The flag matters: 11 tests use module mocks (the /link route, the OPD ticket lookup) and SKIP without it,
# so the suite still reads green while testing less.
node --test --experimental-test-module-mocks "test/connect/abdm/"*.test.mjs test/connect/*.test.mjs

# the M1 client
node test/abdm-client.test.mjs

# whole repo (4 pre-existing failures, none from this work)
npm test

# REAL FHIR conformance - needs a JDK; first run downloads ~220MB + the IG
./scripts/abdm-validate-fhir.sh
./scripts/abdm-validate-fhir.sh --verbose

# LIVE sandbox - needs ~/.stewardmd-secrets/abdm-sandbox.env
./scripts/abdm-sandbox-probe.sh session          # credentials work
./scripts/abdm-sandbox-probe.sh bridge           # what URL is registered
./scripts/abdm-sandbox-probe.sh consent-matrix   # the D7 evidence
./scripts/abdm-sandbox-probe.sh flow <abha@sbx>  # drive real flows (sends a real consent request)

# capture callbacks (token from `bridge` above)
./scripts/abdm-capture.py "$(./scripts/abdm-sandbox-probe.sh bridge | sed -n 's#.*webhook.site/##p')" --watch

# D1 migration - ALWAYS plan first
./scripts/abdm-migrate.mjs --plan
./scripts/abdm-migrate.mjs --plan --local
./scripts/abdm-migrate.mjs --apply --sqlite /tmp/x.sqlite   # safe rehearsal
```

## 6. Flags and variables that MUST stay off

| Name | Required state | Why |
|---|---|---|
| `CONNECT_FLAG` | **unset** | master gate; every `/api/connect/*` and `/api/v3/*` route 404s without it |
| `CONNECT_HIP_FLAG` | **unset** | gates all M2 serving. Do not set until callbacks are captured |
| `ABDM_M1_FLAG` | **unset** | gates the ABHA routes |
| `smd_abdm` (client) | **unset / 0** | the registration-desk UI |
| `ABDM_CALLBACK_BASE` | **commented out** | registering a live callback base starts real traffic |
| `CONNECT_HIP_DISCO_LIMIT` | leave default | discovery rate limit |

Safe to set when you are ready: `ABDM_TENANT_ID`, `ABDM_OTP_TEMPLATE`, `ABDM_OPD_HOSPITAL_ID`. Secrets
(`ABDM_CLIENT_SECRET`, `CONNECT_MASTER_KEY`, `CONNECT_HMAC_SALT`) stay Pages **secrets**, never vars — a
name defined as both fails the deployment on a duplicate binding.

## 7. Before merging to main

1. **Fix the four pre-existing test failures, or accept them knowingly.** CI will be red. `onco-emr` is
   already red on main; `followcare-voice-server` looks date-sensitive. None is from this work.
2. **Run the D1 migration in `--plan` first** against the real database, read the plan, then `--apply`.
   Nothing is destructive (additive only), but see the plan before writing to a provisioned DB.
3. **Confirm the byte-emission narrowing** (§4.8). It widens a stated security invariant.
4. **Confirm `ABDM_CLIENT_ID` as a committed var** (§4.11).
5. **Capture at least one real callback per handler** and replace the `// INFERRED` comments. Until then
   `CONNECT_HIP_FLAG` must stay unset even after merge.
6. ~~Decide on ImmunizationRecord / InvoiceRecord.~~ Done — all 8 conform. But confirm §4.10b: nothing
   populates the new SCCM collections yet, so the HI types are *servable* rather than *served*.
7. Confirm nothing enables a flag: `git diff main..HEAD -- wrangler.toml` should show no flag being set.

## 8. What I will not claim

- **That this is certification-ready.** No ABDM callback body has ever been observed. That single gap is
  what stands between this report and a certification attempt.
- **That the inbound callback handlers are CORRECT.** They are *reasoned*, and marked `// INFERRED`. What is
  now proven is weaker and worth stating precisely: being wrong is survivable (§3b) - no crash, no
  mis-attribution, no silent success. Survivable is not correct. Only a captured callback closes this.
- **That FHIR conformance means ABDM will accept the bundles.** It means 10 bundles conform to the NRCES
  profiles under HAPI 6.2.1 with terminology checks off. A functional-testing agency may still object to
  clinical content, and terminology membership in external value sets is a separate question.
- **That the demographic index or the OTP path work in production.** Both are wired and tested end to end
  against fakes. The index now has a writer (`/api/abdm/link`), and the OTP now has a number to send to -
  but neither has run against ABDM, and OTP delivery stays `delivered:false` until a DLT template exists.
- **That ImmunizationRecord and InvoiceRecord are being served.** Both are now producible from real product
  data and validate against the IG. Neither has been linked as a care context or fetched by an HIU.
- **That the sandbox proves production.** The bridge, facility id and every probe in §2 are sandbox
  (`dev.abdm.gov.in`). Production is a separate registration with separate credentials and its own gateway.
