# P0 current state — verified against the repository, not against the plan

Method: read the source, ran the full suite (5810 passing, 0 failing), ran the reachability
checker, and probed the router directly for dead UI calls and unauthorised routes. Every
"missing" below was confirmed by reading the code; nothing is marked missing because a plan said
so. Three findings in the plans turned out to be **already built**, and two things the plans did
not mention turned out to be **already correct** — both are recorded here because they change what
P0 actually costs.

## What the probes found (evidence, before the table)

- **No dead UI buttons.** Every path a screen calls is answered. Three apparent misses
  (`branding/logo`, `members/remove`, `members/role`) belong to the `/api/connect` surface, not the
  queue router — verified by reading `admin/connect-emr.html:514`, which sets its own API base.
- **Authorisation is not the weak spot.** Of 51 router segments, only `ready` (health check) and
  `auth` (sign-in) have no authorisation call, both correctly. **Zero** POST handlers appear before
  any authorisation call in the file.
- **Audit is comprehensive.** `service.js` audits reads, list, chart, history, identity lookups,
  writes AND denials (`record.denied`), with the write audit in the same atomic batch as the write.
- **Reachability is the weak spot, as the audit said.** 298 routes: 213 reachable, 20 machine-only
  by design, **65 with no screen**.

## The table

| # | Feature | Existing implementation | Reachable? | Secure? | Tested? | Gap | Action |
|---|---|---|---|---|---|---|---|
| P0.1 | Reachability gate | `scripts/wardsynq-reachability.mjs`, runs in the suite | yes | n/a | yes | Only checks route↔screen. Does NOT check: capability present, audit present, UI→nonexistent route, orphaned exports | **Extend the checker**, then work the 65-route backlog |
| P0.2 | Patient timeline | `timelineFromChart()` + history page. Note text, author, category, colour, type+date filters, expand/collapse, report button all shipped | yes | yes (governed `chart()`) | yes, 23 tests | No search; no unread/unacknowledged state; no drill-down to source record; voided/corrected versions not surfaced; referrals and documents absent because neither exists | **Add search, drill-down, voided handling, acknowledgement state** |
| P0.3 | Doctor workspace | **None.** No `workspace` surface anywhere | no | n/a | no | The chart exists and is rich, but there is no single "everything for this patient" landing screen | **Build**, composing existing cards — no new data layer |
| P0.4 | Clinical safety centre | Partial: `critical-results.js` + `critsboard`, `labboard`, `radboard`, `rx-safety.js` | boards yes | yes | yes | No single cross-cutting, role-tailored inbox; no unified acknowledge/resolve state across alert kinds | **Build an inbox that projects existing alert sources** |
| P0.5 | Medication safety | Strong: `rx-safety.js`, `maik-cds.js`, `formulary.js`, advisories, dose ceiling, interaction rules, override capture (`SafetyOverride`, `SafetyFiring`) | yes | yes, server-side | yes | Renal/hepatic/weight-based checks not confirmed present; overrides captured but not surfaced as a review queue | **Verify each check individually, then close only real gaps** |
| P0.6 | Terminology | `terminology.js` with `$validate-code`, `askServer`, `txCache`, wired into FHIR inbound + `$validate-code` route | yes (machine) | yes | yes | No `$expand`; no autocomplete for clinicians beyond the ICD search; **no licensed content** | **Content is a licensing task, not code.** Add `$expand` + a clean interface |
| P0.7 | Identity / master data | `identity-merge.js`, `PatientLink`, `mpi-view.js`, `identity-key.js` | merge/MPI **unreachable** (on the 65 list) | yes | yes | Patient model has **no** deceased, relationships, next-of-kin, guardian, emergency contact. No fuzzy/phonetic search | **Add the fields + search; wire merge/MPI to a screen** |
| P0.8 | Secure documents | **None.** No object storage, no document module | no | n/a | no | Blocked on infrastructure: needs an R2/S3 bucket decision first | **Infrastructure decision, then build** |
| P0.9 | Auth / security | Two-layer capability + record grant, rate limiting, break-glass, audit — all real and enforced | yes | yes | yes, 45 test files carry negative-auth assertions | **No MFA/2FA.** Session timeout, password policy, device/session visibility unverified | **Add MFA; verify the rest before assuming it missing** |
| P0.10 | Composite clinical transaction | `consultation.js` + Consultation screen; one actor resolution, all-or-nothing permission pre-flight, honest partial reporting | yes | yes | yes, 10 tests | **Not atomic.** The plan demands "no partial clinical state"; the store is append-only per record with no cross-record transaction | **Close the gap honestly** — either a compensating void, or state the limit in the plan |
| P0.11 | Live payments | Seam only: `wardsynq-payment-adapter.js` exports `NullPaymentAdapter` and nothing else | seam yes | yes | yes | No real provider. No webhook verification, refunds, or reconciliation | **Integrate one Indian provider behind the existing seam** |
| P0.12 | P0 testing standard | 5810 passing; negative-auth in 45 files; 8 screens rendered in tests | — | — | — | No end-to-end signed-in workflow test; no migration/rollback test | **Add an E2E harness** |

## What this changes about P0's cost

Three P0 items are already substantially done (P0.2, P0.5, P0.10) and two more are stronger than
the plans assume (P0.9's authorisation, P0.12's negative-auth coverage). The genuinely absent
things are narrower than "90% missing": **a doctor workspace, a safety inbox, patient
relationships/deceased, document storage, MFA, a live payment provider, and the 65 unreachable
routes.**

The single largest item is not on the plan's list at its true size: **65 finished routes with no
screen**. That is more P0 work than P0.3, P0.4, P0.7 and P0.11 combined, and it is the thing the
original audit correctly identified as WardSynQ's defining weakness.

## Order of work

1. **P0.1 extended** — make the checker verify capability and audit presence too, so every later
   item is checked as it lands rather than audited afterwards.
2. **P0.7 fields + P0.2 drill-down** — small, high-value, no infrastructure needed.
3. **P0.3 workspace and P0.4 safety inbox** — both compose what already exists; they are the
   screens that make the 65-route backlog start shrinking.
4. **P0.9 MFA**, **P0.11 payments**, **P0.8 documents** — each needs an external decision
   (authenticator, provider, bucket) and is sequenced after the internal work.
