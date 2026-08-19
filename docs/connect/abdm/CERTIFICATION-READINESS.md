# ABDM certification readiness — 2026-08-19

**Not certification-ready.** Two of the eight mandatory HI types cannot be produced at all, and no ABDM
callback body has yet been observed. Everything below distinguishes what was proven against real ABDM
behaviour from what is only proven against our own tests, because those are not the same claim.

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
| M1 client UI | done | 22 tests |

**Test counts:** ABDM + connect suites **1052/1052**. Client **22/22**. Full-repo sweep unchanged apart from four
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
total errors: 0   (all 8 of 8)
```

Evidence: `docs/connect/abdm/fhir-validation-evidence.log`.
Reproduce: `./scripts/abdm-validate-fhir.sh` (needs a JDK; downloads a 220MB jar once).

Root cause was one generic bundle for eight profiles — five of them allow `Composition.section` a maximum
of **one** with entry slicing CLOSED. Fixed by driving the serializer from a shape table read out of the
IG package itself.

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

6. **OTP delivery.** An Indian transactional SMS needs a DLT-approved template. `deliverOtp` returns
   `not_configured` and `on-init` reports `delivered:false` until you register an OTP template and set
   `ABDM_OTP_TEMPLATE`. Nothing fakes a send.

7. **`findTicketMobile` is unbound**, so the OTP has no number to go to. It needs the OPD store's `decPHI`
   lookup wired in the composition root.

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

10. Demographic discovery needs `indexPatient` called from registration; the index is otherwise empty and
    discovery falls back to the ABHA-address arm only.
10b. Nothing yet WRITES SCCM immunisations or invoices — the resources exist and round-trip, but the OPD /
    billing surfaces have to populate them before a real ImmunizationRecord or InvoiceRecord can be served.
11. `ABDM_CLIENT_ID` is a committed wrangler var (the secret is a Pages secret). Deliberate and documented;
    override if you disagree.

## 5. Reproducing everything

```bash
cd <repo>

# ABDM suite (738 tests) - no external dependencies
node --test "test/connect/abdm/"*.test.mjs

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

- That this is certification-ready. No ABDM callback has been seen, and nothing yet populates the two
  newest SCCM collections.
- That the inbound callback handlers are correct. They are *reasoned*, and marked as such.
- That FHIR conformance means ABDM will accept the bundles. It means they conform to the NRCES profiles
  under HAPI 6.2.1 with terminology checks off. A functional-testing agency may still object to content.
- That the demographic index works in production. It has no writer yet.
