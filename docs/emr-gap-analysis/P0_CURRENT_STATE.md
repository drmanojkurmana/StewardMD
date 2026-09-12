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
| P0.1 | Reachability gate | `scripts/wardsynq-reachability.mjs` — four checks: orphaned handlers, fail-closed capability guard, screens, tests | yes | n/a | yes | **DONE.** Orphan handlers locked at 0; capability-guard check verified by breaking it | Work the 65-route backlog |
| P0.2 | Patient timeline | Full story + author + note text + type/date filters + expand/collapse + **search** + **drill-down to the record with every version** (`record-detail.js`) | yes | yes (governed read scope applies) | yes, 38 tests | Remaining: unread/unacknowledged state; referrals and documents cannot appear until they exist | **Mostly done.** Acknowledgement state lands with the safety inbox |
| P0.3 | Doctor workspace | `workspaceView` — allergies, outstanding criticals, current medicines, problems, score, results, pending tests, notes, contacts, deceased banner | yes | yes (pure projection, no new route) | yes, 10 tests | **DONE.** Adds no endpoint and no second source of truth | — |
| P0.4 | Clinical safety centre | `safety-inbox.js` — ward-wide, role-tailored, reusing `chart-completion.js`'s detectors and critical-results; acknowledge from the row | yes | yes (grant applies; role filter only narrows) | yes, 25 tests | **DONE.** Incompleteness is loud: named failures, scan cap, never reads as all-clear | — |
| P0.5 | Medication safety | Strong: `rx-safety.js`, `maik-cds.js`, `formulary.js`, advisories, dose ceiling, interaction rules, override capture (`SafetyOverride`, `SafetyFiring`) | yes | yes, server-side | yes | Renal/hepatic/weight-based checks not confirmed present; overrides captured but not surfaced as a review queue | **Verify each check individually, then close only real gaps** |
| P0.6 | Terminology | `terminology.js` with `$validate-code`, `askServer`, `txCache`, wired into FHIR inbound + `$validate-code` route | yes (machine) | yes | yes | No `$expand`; no autocomplete for clinicians beyond the ICD search; **no licensed content** | **Content is a licensing task, not code.** Add `$expand` + a clean interface |
| P0.7 | Identity / master data | `patient-identity.js` (deceased + RelatedPerson) + Contacts screen; `identity-merge.js`, `PatientLink`, `mpi-view.js` | contacts/deceased **yes**; merge/MPI still unreachable | yes, incl. negative-auth route tests | yes, 36 tests | **Partly done.** Still missing: fuzzy/phonetic search, duplicate detection, identifier history; merge/MPI need a screen | Fuzzy search next; then wire merge |
| P0.8 | Secure documents | **None.** No object storage, no document module | no | n/a | no | Blocked on infrastructure: needs an R2/S3 bucket decision first | **Infrastructure decision, then build** |
| P0.9 | Auth / security | Two-layer capability + record grant, rate limiting, break-glass, audit — all real and enforced | yes | yes | yes, 45 test files carry negative-auth assertions | **No MFA/2FA.** Session timeout, password policy, device/session visibility unverified | **Add MFA; verify the rest before assuming it missing** |
| P0.10 | Composite clinical transaction | `consultation.js` + Consultation screen | yes | yes | yes, 10 tests | **NOT COMPLETE, and not claimed to be.** No cross-record atomicity is available from an append-only store. Authorisation and validation happen before any write, and partial failure is detectable and reported | **Stays open**: identify which workflows genuinely require atomicity, add invariant tests. Do not redesign storage without a proven clinical-safety need |
| P0.11 | **Payment framework** (replaces "live payments") | `wardsynq-payment-methods.js` (pure, method ≠ provider) enforced on the cashier routes; method picker on the cashier screen | yes | yes, incl. nurse refused | yes, 28 tests | **Core done.** Still to build: cash-drawer shift closing + reconciliation screen, bank-statement reconciliation, provider adapters (need credentials) | Drawer closing next |
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


---

# Progress log

## 2026-09-13 — P0.1 closed, P0.7 substantially closed

**P0.1 (reachability gate): DONE.** The checker now proves four links instead of one:
orphaned domain handlers (locked at **zero** — every capability is wired to a route, so the whole
backlog is route-to-screen, not domain-to-route), the fail-closed capability guard, screens, and
tests. The capability-guard check was verified by deleting the guard and watching the build fail,
then restoring it byte-identically. Two new baselines that may shrink and never grow.

**P0.7 (identity): contacts and deceased status shipped.** `functions/_wardsynq/patient-identity.js`,
five routes, a Contacts screen on the chart, 36 tests including eleven through the real routes with
negative authorisation (a nurse cannot record or withdraw a death), audit-row assertions, and
cross-hospital isolation. Still open in P0.7: fuzzy/phonetic search, duplicate detection, identifier
history, and screens for merge/MPI.

**Architecture decisions recorded this session:**
- **Payments are provider-agnostic.** Payment *method* is separate from payment *provider*; cash is
  a first-class collection method and not a fake gateway. The framework, the adapter interface and
  the manual/cash/bank adapters are built without any provider credentials, and no P0 work blocks
  on a provider.
- **No Cloudflare coupling in the domain layer.** New code targets an S3-compatible object-storage
  interface so documents can run on R2 now and S3 in production, and infrastructure boundaries
  (database, storage, queues, auth, payments, notifications, jobs) stay clean. No migration starts
  now; the point is to avoid creating migration debt.
- **P0.10 stays open.** Cross-record atomicity is not available from an append-only store and is not
  claimed. What is guaranteed: authorisation and validation before any write, and partial failure
  that is detectable and reported rather than silent.

**Numbers:** 5846 tests passing, 0 failing. 303 routes — 218 reachable, 20 machine-only, 65 waiting
for a screen, 36 waiting for a test.


## 2026-09-13 (later) — P0.2 and P0.3

**P0.2 (timeline): search and drill-down shipped.** Search covers the line, who did it and the words
behind it. `functions/_wardsynq/record-detail.js` opens the record behind any line with every
version, who wrote each, what changed between them, and — from `wardsynq-temporal.js` — whether a
version was ever the live belief or was overtaken before it took effect. It adds no authority: the
same governed read scope applies, so a reader outside a type's scope is refused there too.
Two bugs caught by its own first tests: `historyOf` returns versions spread flat rather than
wrapped (reading it as a wrapper yielded the version number where the record should be), and
`isCurrentBelief` answers a narrower question than its name suggests and was marking every version
current. Still open: unread/unacknowledged state.

**P0.3 (doctor workspace): DONE.** A pure projection over state the chart already loads — no new
endpoint, no new record type, and the reachability count is unchanged by it. The rule it is built
around: **a block that did not load must never look like an empty one**, because an empty allergy
box reads as "no known allergies". An unloaded block says "Do not read this as empty"; a genuinely
empty one says "None recorded"; a test asserts the unloaded case does not contain the reassuring
words.

**Numbers:** 5871 tests passing, 0 failing. 304 routes — 219 reachable, 20 machine-only, 65 waiting
for a screen, 36 waiting for a test.

**Next:** the unified safety inbox (P0.4), which also supplies the acknowledgement state P0.2 still
needs; then the 65-route backlog; then the payment framework.


## 2026-09-13 (later still) — P0.4, backlog started, and a checker correction

**P0.4 (safety inbox): DONE.** Ward-wide and role-tailored, reusing `chart-completion.js`'s
detectors rather than reimplementing them. Its most important behaviour is about incompleteness: a
patient whose chart could not be read is NAMED, a ward past the scan cap says so, the warning
renders above the list, and an empty-but-incomplete list is forbidden by test from saying "nothing
outstanding". Role filtering is an ordering, never a permission.

**Backlog started.** Two complete-but-unreachable modules now have real workflows:
- **Shift handover** (3 routes) — the incoming shift's list, SBAR handover, and taking one.
- **Medicines reconciliation** (3 routes) — history as the patient says it, decision per medicine,
  completeness computed and never a tick.

**A CORRECTION THAT MADE THE NUMBER WORSE.** Wiring medicines reconciliation dropped four routes off
the backlog when only three had been wired. The fourth, `/ward/discharge`, came off because the
checker accepted any quoted word anywhere in a screen file as proof a route was called — and the new
screen contains `"discharge"` as a stage value. That is a false green, the one failure a checker
must not have.

Fixed two ways: bare strings now count only within sight of an actual API call, and route lookup
tables (`{ pay: "invoice-payment", … }` used as a path tail) are followed properly, because dropping
bare strings entirely would have produced false reds instead. **Thirteen routes were falsely green**
— assess, clinic, delete, disable, hl7, hospital, order, orders, pay, reset, restore and two others
— each checked by hand for a caller; none has one.

**Honest numbers now:** 5911 tests passing, 0 failing. 305 routes — 213 reachable, 20 machine-only,
**72 waiting for a screen** (not the 62 previously reported), 36 waiting for a test.

**Next:** more of the backlog (wound care, risk assessment, order sets, break-glass, patient
identity/MPI), then the provider-agnostic payment framework.


## 2026-09-13 (evening) — backlog, payments, and two config bugs

**Backlog: 72 → 66.** Wound care (worst stage never lowered, where-it-came-from fixed) and risk
assessment (hospital's own tools; "no tools configured" stated as a setting, not an all-clear).
Six routes verified off by name — no false greens.

**P0.11 payment framework: core done.** `wardsynq/wardsynq-payment-methods.js` is pure and
provider-agnostic: each hospital configures the methods it takes and the provider for each; an
unconfigured hospital takes cash only. Each method must carry what reconciliation needs (cash →
counter; bank transfer → UTR + bank; card → terminal + slip reference). **Typed money is never
recorded as machine-confirmed**: everything is `manual` until a provider actually answers, and a
test sends `capture: "integrated"` in the body and asserts it is ignored. Refunds cannot exceed what
was taken; a failed payment cannot be refunded. The cashier screen has a method picker with no
"confirmed" control.

**Two config bugs, one from earlier this session.** The hospital-config projection in
`_opd_org.js` is a whitelist. `payment` was missing, so payment settings would never have reached
the server — and so was `approvalLevels`, which `verification.js` and `purchasing.js` have read
since I wrote them. A hospital asking for two approvers was silently getting one. Both fixed.

**Numbers:** 5948 tests passing, 0 failing. 305 routes — 219 reachable, 66 waiting for a screen,
35 waiting for a test.

**Next:** cash-drawer shift closing; more backlog (order sets, break-glass, identity/MPI, infusions,
admission requests); P0.7 fuzzy search; P0.9 MFA; P0.8 documents; P0.10 invariant tests.
