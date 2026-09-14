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


## 2026-09-13 (night) — backlog 66 → 52

Six more complete-but-unreachable modules now have real workflows, each verified off the backlog by
route name, no false greens:
- **Payment method picker** on the cashier screen (no "confirmed by card machine" control exists).
- **Emergency access (break-glass)** — limits stated before declaring; review log shows whether
  anybody was notified, including "nobody was notified automatically".
- **Order sets** — a set writes no orders; each item goes through the ordinary ordering route with its
  own safety checks, sequentially; a part-applied set says exactly what was refused and nothing is
  retried.
- **Bed waiting list** — hours waited on every row; closed deliberately, never aged out.
- **Infusions + care plan** — the volume caveat shown beside every total; an uncharted drip still
  reads as running, with a stale warning.
- **Duplicate records (MPI + merge/unmerge)** — agreed/disagreed fields per candidate; a partial
  search can never read as "no duplicate". Closes the P0.7 merge screen.

**Numbers:** 5974 tests passing, 0 failing. 305 routes — 233 reachable, **52 waiting for a screen**,
35 waiting for a test.

**Remaining backlog groups:** wristband tags (6), oncology/cardiology links (6), surgery list and
abandon (2), billing extras (charges, invoice-void, upcoding, tariff), results release and specimen
outcome, dispense returns, transfusion trace, maternity status, follow-up, discharge, digital-twin
and MaiK routes, metrics/operational health. Then P0.7 phonetic search, P0.9 MFA, P0.8 documents,
P0.10 invariant tests, cash-drawer shift closing.


## 2026-09-13 (late night) — backlog 52 → 44

- **Wristbands** (6 routes): issue, check, replace, lost, end. A mismatched band is a loud STOP; a
  failed check is never shown as a verdict; ended bands stay in the history.
- **A patient's operations + ending a case not going ahead** (2 routes). Caught a dead Open button
  (wrong action name) and a blank abandon reason (it lives in the case ledger, not a field).

**Numbers:** 5984 passing, 0 failing. 305 routes — 241 reachable, **44 waiting for a screen**.

**Remaining backlog:** release-result, specimen-outcome, oncology/cardiology links (6), billing extras
(charges, invoice-void, upcoding, tariff), dispense-return, transfusion-trace, maternity-status,
follow-up, discharge, twin/MaiK routes, metrics/operational-health, readers, link-mrn, identity,
advisory-check, dose-ceiling, emergency-chart, extend, flag-critical, backfill, resus-waive, and the
13 found by the checker correction (assess is done; clinic, delete, disable, hl7, hospital, order,
orders, pay, reset, restore still open).


## 2026-09-14 — lab result entry (backlog 44 → 43)

**Bug, not just a gap:** the laboratory board listed tests awaiting a result and offered no way to
report any of them - `release-result` had no screen, so a lab on WardSynQ could not report results at
all. Each pending test now has "Enter result", reported against its own order; values sent exactly as
typed; rejected rows named with the reason.

**Numbers:** 5988 passing, 0 failing. 43 routes waiting for a screen.
**Next:** specimen-outcome (failed/received sample), dispense-return, transfusion-trace, billing extras.


## 2026-09-14 (cont.) — backlog 43 -> 40

- **Sample received / failed** on the lab board (a failure needs a reason).
- **Medicine returns** in pharmacy dispense history (never returned twice).
- **Blood-unit trace** on the transfusion screen (an unreadable trace never reads as "no record").

**Numbers:** 5992 passing, 0 failing. 40 routes waiting for a screen.
**Next:** billing extras (charges, invoice-void, upcoding, tariff), maternity-status, follow-up, discharge, oncology/cardiology links.


## 2026-09-14 (cont.) — billing (backlog 40 -> 37)

**Bug:** a failed bill load read as "No invoices for this patient yet" - a cashier could send a patient
home believing nothing was owed. Fixed and tested. Added: unbilled charges (unpriced shown as a gap),
cancel a bill, claims whose coding changed after a payer refusal.

**Numbers:** 5997 passing, 0 failing. 37 routes waiting for a screen.
**Next:** tariff (price list, admin), maternity-status, follow-up, discharge, oncology/cardiology links.


## 2026-09-14 (cont.) — price list (backlog 37 -> 36)

**Bug:** changing a price left no audit trail (every other billing action did). Now audited with the
old and new price; 4 tests. **Bug:** a failed department load read as "No departments yet". Fixed.
Added the price list tab to the admin centre (paise stored, rupees shown, unparseable price refused).

**Numbers:** 6001 passing, 0 failing. 36 routes waiting for a screen.
**Next:** maternity-status, follow-up, discharge, oncology/cardiology links, then P0.7 fuzzy search.


## 2026-09-14 (cont.) — ward discharge (backlog 36 -> 34)

**Bug:** a ward patient had no discharge action - the stay could never be closed and the bed never
freed from the chart. Added Discharge (asks where they went; refuses "died" until the death is recorded
on the Contacts screen) and Follow-up (requires a real date).

**Numbers:** 6004 passing, 0 failing. 34 routes waiting for a screen.
**Next:** maternity-status, oncology/cardiology links, then P0.7 fuzzy search, P0.9 MFA, P0.8 documents.


## 2026-09-14 (cont.) — maternity (backlog 34 -> 33)

**Bug:** a failed pregnancy load read as "No pregnancy episode recorded". Fixed and tested. The
pregnancy card now shows obstetric status in the engine's words (e.g. day 2 postpartum, haemorrhage
risk highest now).

**Numbers:** 6007 passing, 0 failing. 33 routes waiting for a screen.
**Next:** oncology/cardiology links, then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10 invariants.


## 2026-09-14 (cont.) — oncology/cardiology (backlog 33 -> 28)

**Bug (server):** both specialty timelines turned a failed read into an empty list, so a failed chemotherapy
read showed "no chemotherapy given". Failed parts are now named and warned on screen; 3 tests.
Five list routes verified as fully covered by the timelines the screens already call, recorded byDesign
with that reason rather than given duplicate screens.

**Numbers:** 6010 passing, 0 failing. 28 routes waiting for a screen.
**Next:** remaining backlog (onco recommend, readers, link-mrn, identity, advisory-check, dose-ceiling,
emergency-chart, extend, flag-critical, backfill, resus-waive, metrics, operational-health, twin, maik,
and the older set), then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10 invariants.


## 2026-09-14 (cont.) — resuscitation waiver (backlog 28 -> 27)

Bundle elements can be recorded as "not appropriate" with a reason. **Bug caught:** a waived element
would still have shown as overdue and counting down; it now reads as a decision. 2 tests.

**Numbers:** 6012 passing, 0 failing. 27 routes waiting for a screen.
**Next:** flag-critical, extend, emergency-chart, dose-ceiling, advisory-check; then P0.7, P0.9, P0.8, P0.10.


## 2026-09-14 (cont.) — child maximum dose (backlog 27 -> 26)

Paediatric card works out the most a child may have (server-side; no weight = refusal, not a number).
The UI dose-logic guard tripped on the route name; not bypassed - server adds a neutral limitMg field,
UI names changed, guard now ignores quoted server route paths only.

**Numbers:** 6015 passing, 0 failing. 26 routes waiting for a screen.
**Next:** flag-critical, extend, emergency-chart, advisory-check; then P0.7, P0.9, P0.8, P0.10.


## 2026-09-14 (cont.) — SAFETY: critical lab results now alert

**Bug (serious):** releasing a lab result never opened a critical-result loop - the only path was an
uncalled route - and the lab grant could not write one anyway. A potassium of 7 alerted nobody. Fixed on
the server (release opens loops against the stored report with site limits; a failed check is reported)
and in the lab grant. Proved through real routes: normal = checked, nothing opened; 7.2 = one loop;
no duplicates on re-flag.

**Numbers:** 6015 passing, 0 failing. 26 routes waiting for a screen (flag-critical remains machine-callable).
**Next:** extend, emergency-chart, advisory-check; then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10.


## 2026-09-14 (cont.) — SAFETY: critical imaging findings now alert

**Bug:** a critical imaging report (e.g. tension pneumothorax) opened no alert, same cause as lab. Fixed on
the imaging release route. My own previous change had overwritten the imaging reply's existing critical
flag; caught by an existing test; both routes now use criticalCheck. flag-critical recorded byDesign.

**Numbers:** 6015 passing, 0 failing. 25 routes waiting for a screen.
**Next:** extend, emergency-chart, advisory-check; then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10.


## 2026-09-14 (cont.) — emergency access usable (backlog 25 -> 24)

**Bug:** break-glass granted access but no screen opened the chart. Active grants now open it read-only;
expired ones cannot. Live and verified (ward.js site46).

**Numbers:** 6017 passing, 0 failing. 24 routes waiting for a screen.
**Next:** extend, advisory-check; then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10 invariants.


## 2026-09-14 (cont.) — safety reminder dry run (backlog 24 -> 23)

Admin centre Safety reminders tab: try a draft advisory set, see what it would do, nothing published. Live (admin.js v7).

**Numbers:** 6017 passing, 0 failing. 23 routes waiting for a screen.
**Next:** extend; then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10 invariants.

### 2026-09-13 - visit link extension (backlog 23 -> 19)

Outpatient checked-out box shows the real expiry and lets a doctor keep the patient link open 30 days. Server fixes: refused before checkout, capped at the 30-day token life (was promising unreachable dates), failures no longer reported as success, each extension audited. Checker now reads the api("path") calls in opd.html and clinic-billing.html, which showed delete/orders/pay already had real screens (were false reds). Live on wardsynq.com/opd.

**Numbers:** 6022 passing, 0 failing. 19 routes waiting for a screen.
**Next:** re-check the 19 against other screens; then P0.7 fuzzy search, P0.9 MFA, P0.8 documents, P0.10 invariants.

### 2026-09-13 - staff sign-in typo bug (backlog 19 -> 16)

Security fix: set PIN / password / disable / restore / reset / remove all upserted, so a mistyped staff ID created a member row and a PIN on it was a working read-only login nobody chose. All now refuse an unknown member ("Add them first"), returned as a failure, nothing audited as if it happened. Admin staff table routes through an action table, so the checker sees its real Disable/Restore/Reset buttons. Live (admin.js v8).

**Numbers:** 6025 passing, 0 failing. 16 routes waiting for a screen.
**Next:** remaining 16 (backfill clinic hl7 hospital identity link-mrn maik-interactions metrics operational-health order readers recommend roi round twin-predict twin-reconstruct).

### 2026-09-13 - merge history on duplicate records (backlog 16 -> 15)

P0.7 identifier history: the duplicate-records screen shows what the open record was joined into, what was joined into it, and every undo with who and why. Undo only on a live merge (was on every search match, where it could only fail). Loading/failed/never-merged are distinct; a capped link scan is flagged partial on the server. Live (ward.js site47).

**Numbers:** 6029 passing, 0 failing. 15 routes waiting for a screen.
**Next:** P0.7 fuzzy/phonetic search check; remaining 15 (backfill clinic hl7 hospital link-mrn maik-interactions metrics operational-health order readers recommend roi round twin-predict twin-reconstruct).

### 2026-09-13 - phonetic name matching

P0.7 phonetic search: Soundex was written and never used, so transliterated names (Mohammed/Muhammad, Lakshmi/Laxmi, Sita/Seetha) scored as different people and duplicates went unsuggested. Name now also agrees when every word sounds alike and spelling similarity >= 0.75 (floor stops Ravi/Rupa). Cannot auto-link alone. Deployed.

**Numbers:** 6030 passing, 0 failing. 15 routes waiting for a screen.
**Next:** P0.7 relationships / next of kin / guardian / emergency contacts / deceased status - check what exists.

### 2026-09-13 - merge preview + fail-closed chain check

P0.7 governed merge: "Same person - merge" now asks the server for a dry run (every check, nothing written) and shows both records side by side, differing fields marked, with a reason box before "Join these records". Safety fix: the check that stops a record being merged twice swallowed a read failure as "no links" and let the merge proceed; it now refuses. Harness fix: throttle reset per seeded hospital. P0.7 contacts/guardian/next of kin/deceased already had a screen. Live (ward.js site48, ward.css site12).

**Numbers:** 6032 passing, 0 failing. 15 routes waiting for a screen.
**P0.7 status:** duplicate detection, phonetic matching, preview/authorised/audited/reversible merge, identifier history all in place. Remaining P0.7: none known.
**Next:** P0.9 MFA/session hardening.

### 2026-09-13 - P0.9 sign-in hardening (part 1)

Password sign-in now locks after 5 wrong tries (had no limit; PIN already did), own counters. Every sign-in outcome audited under the hospital, never the secret. Weak PINs (repeated/consecutive, not 4-8 digits) and passwords (<10, common, contains email name) refused when set. Resetting, disabling, or changing a PIN/password ends sessions issued before it (sessionsRevokedAt vs signed issue time); restore does not revive them. Fixed three screens that said Saved / Clinic ready / nothing when a PIN or password was refused. Live on both sites.

**Numbers:** 6038 passing, 0 failing. 15 routes waiting for a screen.
**Next (P0.9):** two-step sign-in (authenticator code) for staff password sign-in; staff "sessions and devices" visibility; security headers check.

### 2026-09-13 - P0.9 two-step sign-in for staff

Staff switch on authenticator-app codes for their own account (new Sign-in security page on wardsynq.com). Correct PIN/password then returns a 5-minute challenge (signed ver 2, never usable as a session); code checked server-side (RFC 6238 vectors verified), secret encrypted at rest, used step refused, 8 hashed one-time backup codes spent under a precondition, 5 wrong codes lock 15 min, all outcomes audited. Turning on ends older sessions; turning off needs a code; admin Reset access clears it (lost phone). All three staff sign-in screens (wardsynq.com, opd, queue app) ask for the code. Doctor StewardMD accounts out of scope (their identity provider).

**Deploy note:** Cloudflare accepted both publishes (build and deploy stages "success") but every deployment since ~08:25 UTC, on both projects, answers "Deployment Not Found"; live sites still serve the previous version. Not code-related (a static-only upload is affected too). Watching.

**Numbers:** 6048 passing, 0 failing. 15 routes waiting for a screen.
**Next (P0.9):** confirm live once Cloudflare serves new deploys; security headers; session/device visibility.

### 2026-09-13 - P0.9 sign-in history + sign out everywhere

Cloudflare hold-up cleared 08:44 UTC; two-step sign-in confirmed live. Each staff sign-in audit now names the device ("Chrome on Android", never raw user-agent). Sign-in security page lists the account's own recent sign-ins/failures/lockouts/two-step events with device, failed and partial loads stated, and Sign out everywhere (ends every session). Checker now scans wardsynq.com pages that call via c.api (8 files were invisible; mfa routes had passed only by word coincidence); operational-health confirmed on the audit page. Security headers already set (_headers; no strict CSP by documented decision). Live.

**Numbers:** 6051 passing, 0 failing. 14 routes waiting for a screen.
**P0.9 status:** MFA, lockout, password/PIN policy, session revocation, login audit, device visibility, rate limiting, break-glass, headers all in place. Not done: org policy to REQUIRE two-step for roles.
**Next:** org policy "require two-step sign-in" for chosen roles; then P0.8 documents.

### 2026-09-13 - P0.9 require two-step sign-in per role

Admin Center, Staff tab: tick roles that must use two-step sign-in (org.security.requireTwoStepRoles, only real role names kept). A member of such a role without it can sign in but the server refuses every route except mfa/* and whoami (two_step_required); wardsynq.com routes them to Sign-in security, OPD page and queue app say where to set it up. Live (admin.js v9, shell.js v28, security.js v3).

**Numbers:** 6053 passing, 0 failing. 14 routes waiting for a screen.
**P0.9 status:** complete for staff accounts (MFA + required-by-role, lockouts, credential policy, session revocation, sign-in audit with device, sign out everywhere, rate limiting, break-glass, headers). Doctor StewardMD accounts use their identity provider.
**Next:** P0.8 documents behind an S3-compatible interface.

### 2026-09-13 - P0.8 patient documents

DocumentReference metadata in the append-only record (patient, visit, type, title, size, SHA-256, uploader, retention date, withdrawal, purge). Bytes AES-GCM encrypted before leaving the server, stored under unguessable keys via functions/_wardsynq/object-store.js: plain-fetch S3 SigV4 adapter (matches AWS published example), works with R2/S3/MinIO, no Cloudflare binding. Versions never overwrite; withdraw keeps file with reason; purge admin-only, refused before retention (hospital documentRetentionYears, default 3), record kept. Files open only via a 5-minute signed link bound to person/document/version, integrity-checked and audited per use (document-file byDesign). Ward chart Documents screen: loading/failed/storage-off/none distinct. Live (ward.js site49).

**Blocked for production uploads (owner action):** no storage is configured, so the live screen says so and refuses uploads. To turn on: create a private bucket (R2 or S3) and set DOC_S3_ENDPOINT, DOC_S3_BUCKET, DOC_S3_ACCESS_KEY_ID, DOC_S3_SECRET_ACCESS_KEY (DOC_S3_REGION for AWS; optional dedicated DOC_ENC_KEY, 32 bytes base64url) as secrets on the stewardmd Pages project.

**Numbers:** 6065 passing, 0 failing. 14 routes waiting for a screen.
**Next:** P0.10 atomicity investigation and invariant tests.

### 2026-09-13 - P0.10 consultation all-or-nothing

The earlier claim that cross-record atomicity was unavailable was wrong: repository.append is atomic across its records (one D1 batch). New functions/_wardsynq/staged.js StagedRepository (unit of work over the port; reads overlay staged records; append holds; commit = one append). Port extended backward-compatibly: ctx.idempotency[] and ctx.audits[] (memory + D1). saveConsultation runs all writers against it and commits once; any failure or commit conflict = nothing written, no keys spent, no audit rows. Invariant tests added. Ward consultation screen now shows "not saved" for every failure (was blank for most). Live (ward.js site50).

**Numbers:** 6069 passing, 0 failing. 14 routes waiting for a screen.
**P0 remaining:** 14 small screens, live payment providers (need credentials), document storage settings (owner). User asked to move faster; P1 starts next, leftovers in parallel.

### 2026-09-13 - P1.8 referrals, P1.7 staff rostering, storage check

P1 started (user asked to move faster; P0 leftovers run alongside). Referrals end to end (referral.js; patient Referrals screen + hospital Referral inbox). Staff rostering (_roster.js pure rules, _roster_store.js by-month storage, Staff rota page): overlap/leave/swap refusals, all-or-nothing weekly assignment, leave clash blocks approval, swap needs colleague + manager with re-check, coverage gaps, on duty now, removal with reason, all audited, negative-auth tested. GET /api/queue/ready now reports documentStorage via a real save/read/delete round trip.

**Deploy note:** wardsynq.com is live (rota.js v2, shell.js v30, ward.js site51). stewardmd.in (server) has served no new deployment since ff5f14e (~50 min): Cloudflare lists them as deployed but answers "Deployment Not Found"; the previous one still serves. The same build runs correctly in local workerd (wrangler pages dev: /api/queue/ready 200 with documentStorage). Referral/rota/storage-check server routes go live when Cloudflare serves the new deployment.

**Numbers:** 6092 passing, 0 failing. 14 routes waiting for a screen.
**Next:** confirm storage round trip once live; P1.1 dynamic forms, P1.4 accounting, P1.15 outbox.

### 2026-09-13 - P1.15 transactional outbox

functions/_wardsynq/outbox.js: events staged through StagedRepository commit atomically with the business records; drainOutbox claims via next-version (no double claim), consumers recorded per event (retries skip succeeded ones), exponential backoff, dead after 6 with outboxHealth surfacing them, stale claims (>10 min) reclaimed. At-least-once, consumers must be idempotent (documented). Saved consultation carries one consultation.saved event. No production consumer registered yet; nothing to deploy visibly.

**Deploy blocker (owner):** every stewardmd production deployment since ff5f14e is "Failure" (latest 3e2fdc9 from another session too); an identical preview deployment builds and serves. wrangler.toml unchanged since 2026-09-04; DOC_S3_* are valid encrypted secrets. Needs the failed deployment build log from the Cloudflare dashboard.

**Numbers:** 6097 passing, 0 failing. 14 routes waiting for a screen.
**Next:** P1.1 dynamic forms; P1.4 accounting.

### 2026-09-13 - P1.4 accounting core; suite fix

wardsynq/wardsynq-accounting.js (pure, beside the billing ledger): starter chart of accounts, balanced integer-paise journal entries on open accounts, no posting into closed periods, correction only by single reversal, trial balance as at a date, period close refused on unbalanced books, billing event -> entry mapping. Storage/routes/screens next. Fixed a suite failure merged from main: RxChoice prescription table used a star/tick emoji (forbidden by no-ui-emoji test; its own test asserted it). Process note: one commit (6dde3ef) was pushed while that inherited test was red because the gate checked output, not the fail count; fixed immediately (e7f2a09).

**Deploy blocker (owner):** stewardmd production deployments still "Failure"; preview of the same code succeeds. Needs the build log.

**Numbers:** 6109 passing, 0 failing. 14 routes waiting for a screen.

### 2026-09-13 - production deploy fixed (text binding limit)

Confirmed from the failed deployment log: "Failed to publish your Function. Got error: Too many text bindings, found a total of 129, they exceed the limit of 128." Started when the 4 DOC_S3_* secrets were added. Audited all 82 production secrets + 43 production vars against code: only GITHUB_OTA_TOKEN is referenced nowhere (OTA uses the OTA_R2 binding); the 6 AI_COST_CAP_<ROLE> vars looked unused but are read dynamically in functions/_credits.js and were kept. Deleted GITHUB_OTA_TOKEN only (129 -> 128). Storage secrets left as four separate provider-agnostic settings, per owner. Headroom is now zero: any new setting needs another verified removal first.

### 2026-09-13 - owner decision

Owner: park open issues (document bucket name InvalidBucketName; 14 unscreened routes; payment provider credentials) and finish P1 then P2 first; issues are sorted at the end.

### 2026-09-13 - production deploy failed again (130 bindings)

Another session added secrets CONNECT_AGENT_MODEL and CONNECT_AGENT_MODEL_PROVIDER (130 > 128). No unused secrets remained, so removed three production vars whose values equal the code default (behaviour identical, verified): DEVICE_LOCK_ON="0" (cfgFlag: KV override first, absent = off), PGLOG_VERIFY_BASE (default https://stewardmd.in), MAIK_CACHE_VERSION (default "1"). Count 127, one slot spare. Also shipped P1.4 accounting storage/routes/Accounts page and clinic billing postings.

### 2026-09-13 - P1.1 hospital forms live

wardsynq/wardsynq-forms.js engine + _forms_store.js (drafts, create-only published versions) + form-response.js (FormResponse checked server-side against the exact version). Admin Forms tab (JSON, problems listed, publish), ward chart Forms screen. FormResponse added to nurse write scope. Live: production deploy succeeded, ward.js site52, admin.js v10.

**P1 done so far:** P1.1 forms, P1.4 accounting, P1.7 rostering, P1.8 referrals, P1.15 outbox.
**Next:** P1.3 approval engine gaps, P1.2 supply chain gaps, P1.6 nursing command center, P1.9-14 top-ups, P1.5 TPA; then P2.
**Numbers:** 6122 passing, 0 failing.

### 2026-09-13 - forms follow-up questions

Conditional form fields now appear on change (onFormChange redraw), ward.js site53, live. 6122 passing.
**Next:** P1.6 nursing command center.

### 2026-09-13 - P1.6 nurse worklist live

GET /ward/nurse-worklist (MAR schedule overdue/due-next + NEWS2/PEWS per ward patient, sickest first, per-row read failures) + Nurse worklist screen and map tile. Bug fixed: unscorable early-warning score was total 0; now no number. Live (ward.js site54, shell.js v32), production deploy succeeded. 6127 passing.
**P1 done:** 1.1 forms, 1.4 accounting, 1.6 nurse worklist (first cut: no nurse-patient assignment or task list yet), 1.7 rostering, 1.8 referrals, 1.15 outbox.
**Next:** P1.3 approvals gaps, P1.2 supply chain gaps, P1.9-1.14 top-ups, P1.5 TPA; then P2.

### 2026-09-13 - P1.3 approvals: roles and expiry

approvalPolicy[subjectType] = { approverRoles, expiresHours } (whitelisted): approver role enforced, pending requests expire and must be resubmitted; no policy = unchanged. Amount thresholds NOT added (requester-supplied amount is dodgeable; needs server-held subject values such as a PO total, which purchasing does not store yet). Server-only change, deployed via main. 6128 passing.
**Next:** P1.2 supply chain gaps (PO totals, partial/over receipt, FEFO, transfers), then amount thresholds on server-held values; P1.9-1.14; P1.5; then P2.

### 2026-09-13 - P1.2 supply chain audit

Already present: PO lines, approvals, partial and over-receipt detection (reported, never silently accepted), batch/expiry on receipt, near-expiry list, wastage, transfers (out+in), reorder list, count reconciliation, append-only ledger. GAP found, not built: FEFO needs per-batch on-hand, but dispensing does not record the batch, so any "take this batch" suggestion would be a guess. Next step for P1.2: record batch on dispense/return, then per-batch balances, then FEFO; PO line unit cost (enables server-held amount thresholds for approvals). Returns to supplier and pack/unit conversion also still to verify.

### 2026-09-13 - P1.2 FEFO rules

Correction to the audit above: dispenses DO record batch/expiry. Added pure batchBalances/fefoSuggestion in stock.js (earliest usable expiry first, expired/undated excluded with reason, shortfall reported, refuses when unbatched issues exist). 4 tests. Next: route + pharmacy screen for it; PO line unit cost.

### 2026-09-13 - P1.2 FEFO on the pharmacy screen; stock fixes

GET /ward/stock-fefo (ORDER_DISPENSE) + Inventory "Which batch to use" card. Fixed: stock levels and reconciliation swallowed a failed dispense read as [] (levels too high; reconciliation would post a wrong adjustment); a failed stock load read as "No stock movements"; two receipts of one drug in the same millisecond shared a movement id and the second overwrote the first (random tail added). Deployed.

### 2026-09-13 - every route has a screen or a stated reason (owner: "every backend has frontend")

Reachability 14 -> 0 without a screen. Wired: link-mrn (Patients page), maik-interactions (chart MaiK card history), metrics (Ward status card), readers + read (record detail: opening logs a decisive read; superseded versions show who saw them), twin-predict + twin-reconstruct (Digital twin forecast and look-back), order (clinic billing add-from-price-list). Recorded with reasons: hl7 (machine), backfill (operator only), clinic/hospital (opd.html computed path), recommend (runs on device), roi (superseded by roi-requests), round (superseded by schedule).
Bugs fixed on the way: SAFETY medication round showed an unreadable dose record as not started (both routes; now "unknown" + warning; nurse worklist carries it). SECURITY clinic billing orders took price from the request (now tariff). SECURITY any account could create a hospital under a chosen id / run backfill (now platform operator only). link-mrn onto an in-use MR overwrote that patient. Ward metrics counted unreadable types as 0. Twin look-back dropped unreadable histories silently. ROI consent failure showed "not recorded". Clinic billing queues read failures as empty; billing ID counter had no compare-and-set. 6149 passing, 0 failing.
Noted, not yet fixed: other time-derived record ids (fluid balance entry, handover, preauth) may share the same-millisecond collision class as stock movements; audit next. Patient-app routes (patient-enrol/messages/reply/revoke) are marked "patient's own app": P2.9 must build that app.
**Next:** P1.2 PO line unit cost -> P1.3 amount thresholds; P1.6 nurse assignment + tasks; P1.9-1.14; P1.5; P2.

### 2026-09-13 - P1.2 priced purchase orders + P1.3 approvals by amount; security fixes

PO lines take unitPricePaise; order total computed server-side (null if any line unpriced). approvalPolicy[kind].amountThresholds [{abovePaise, levels}] uses only serverAmountPaise stamped on the request from the subject (PurchaseOrder); unknown amount = strictest; requester context ignored. Admin > Hospital "Approval rules" card; Purchasing screen shows price, total, approvals needed.
Fixed: SECURITY raw record door let any prescriber write authority records (forged Verification approvals clearing restricted drugs, MedicationVerification skipping pharmacist, PatientConsent, EmergencyActivation, BreakGlassGrant, etc.) - now refused (route_governed). Restricted-medicine prescribing ignored the hospital's approver count (read a ctx field never passed). Pharmacy could neither raise a PO (grant) nor ask for approval (cap) - purchasing only worked for admins; now ORDER_DISPENSE grants PurchaseOrder/Vendor/Verification and may request approval for supply subjects only. Goods received against a PO never reached stock levels (no code, bare quantity). Same-ms PO id collision. 6157 passing.
Still open in P1.3: delegation, escalation, parallel approvals. Existing GRNs written before today still show as stock "problems" (no_quantity) - visible, not auto-migrated.
**Next:** P1.6 nurse-patient assignment + task list; P1.9 lab; P1.10 radiology; P1.11 ED; P1.12 ICU; P1.13 command center; P1.14 quality; P1.5 TPA; P1.3 delegation/escalation; P2.

### 2026-09-13 - P1 gap audit (three read-only audits) and first build batch

Audit findings, with evidence, drove this batch. Built and live:
- P1.9 lab: opt-in second-person verification (labVerification.mode, Admin card), verify/return queue with delta/autoverify reasons, reference range + Corrected status on the entry form; critical loops still open immediately.
- Critical-result escalation now runs on its own (ops-tick.js, background on ward traffic, once per 2 min per hospital): one escalation per level recorded on the loop with the notification attempt ("nobody was notified" when no channel). The P1.15 outbox is drained by the same tick (it had no caller - my earlier "done" was wrong).
- P1.6 nursing (builder, reviewed): nurse-patient assignment, shift tasks, observation frequency with obs due, NEWS2-high flag (nothing paged), nursing note template, Mine/Whole ward.
- P1.11 ED + care plan (builder, reviewed): re-triage history with reason, reassessment clock from edReassessMinutes, ED procedures, triage/disposition timeline events, referral from disposition, care plan view + goal progress (and fixed: care plan saves were always refused).
- P1.12 ICU (builder, reviewed): ABG entry + interpretation, ventilator, RASS, vasopressor mcg/kg/min (refuses without weight/concentration), SOFA server-side (partial marked), sepsis screen (advisory), Code Sepsis on ICU charts, sparklines with gaps, round checklist.
- UI false-empties fixed: critical results board (said none open while loading/failed), devices, lines, billing, fluid balance, purchasing.
Known checker weakness: reachability matches route names without their segment, so a same-named route in another segment hides a gap (found: ward/plan vs onco /plan; ward/progress via templateId "progress"). Make seg-aware.
Parked for owner (end): an external scheduler token for ops tick (optional), notification channel credentials (escalation currently records "no channel"), plus earlier parked items.
**Next batch:** microbiology/culture-sensitivity; command center drill-down + ICU/OPD/staffing/finance/OT sections; quality measures + incident signal/confirm/category; radiology viewer launch + structured templates; P1.5 TPA adapters; checker seg-aware; then P2.

### 2026-09-13 - checker segment-aware; ward/bed cross-hospital edits closed

Reachability now keys routes by segment+sub (onco/plan no longer hides ward/plan; bare words need context). Found and built: Admin ward rename/deactivate, clinic billing "Waiting to be billed". SECURITY: ward/update and bed/update did not check the ward/bed belongs to the caller's hospital (now 404, test). Live verified: wardsynq.com serves ward.js site63/admin.js 13; /ward/results-to-verify answers 401 (deployed). 6199 passing.
In flight (builders): microbiology + histopathology; command center drill-down; quality measures + incident signal/confirm; radiology viewer + TPA adapters.

### 2026-09-13 - P1.9 microbiology/histopathology, P1.13 command center, P1.14 quality merged

Builders reviewed and merged; live (ward.js site64).
- Cultures (stages, organisms, S/I/R, positive blood culture opens one critical loop, "not tested" never S) and histopathology (addenda only after signing, second-person verification) as DiagnosticReport extensions; resistant-antibiotic advisory.
- Command center: every count drills to patients/boards; ICU, OPD queue, staffing, lab TAT, radiology backlog, OT, pharmacy items, finance. SECURITY: twin ?finance=1 leaked billing/claims to any EMR_VIEW role; now BILLING_VIEW server-side.
- Quality: incident categories (WHO ICPS), signal stage linked to source records, confirm/reject/duplicate (RCA/CAPA only after confirm), mortality/readmission/sepsis wired, LOS, falls/pressure injury rates, antibiotic DOT (needs antibiotics list), TAT, bed utilisation, case lists. 6231 passing.
Waiting: radiology viewer + TPA builder. Then P2.

### 2026-09-13 - P1.10 radiology viewer/templates + P1.5 payer adapters merged; P2 started

Radiology: imagingViewer urlTemplate (https only, no names in URL) with "Open images" when a study UID/accession is known; ImagingStudy matched to orders; structured report templates. TPA: per-payer registry (org config payers), generic FHIR R4 Claim adapter (mocked fetch only - not verified against any payer), credentials via sealed credentialRef (existing CONNECT_MASTER_KEY, no new binding), estimate, acknowledge, settle, balance-to-patient as explicit action, rule warnings. Live ward.js site65. 6278 passing.
P1 status: all P1 items now have server + screen; remaining limits are listed per builder (no live payer/PACS verification, notification channels unconfigured).
P2 builders running: patient/family portal (P2.9), surveillance + copilot tasks (P2.3/2.2), security monitoring + restore evidence (P2.17/2.15).
Parked for owner: payer credentials + endpoint per payer, PACS viewer URL, notification channel, document bucket name, payment provider credentials.

### 2026-09-13 - P2.17 security review + P2.15 restore evidence merged

Admin "Security review" tab (STAFF_ADMIN, doctor/nurse 403): chart-access anomalies vs own baseline, unusual exports, suspicious sign-ins, break-glass and privileged-action review queue (append-only, no self-review), data-protection status green only with a backup inside RPO AND a recorded successful restore test; audit storage that cannot be read shows "unavailable". Fixed on the way: backup export audit rows recorded a NULL actor. Not built: out-of-assignment reads (no staff-ward data), VIP flag, configurable audit retention. Live admin.js 14. 6290 passing.

### 2026-09-13 - P2.3 surveillance + P2.2 copilot tasks, P2.9 patient portal merged

Surveillance board (ward): deterministic signals with evidence links (deterioration trend, sepsis screen, critical lab trend, overdue care, medication risk needs highAlertDrugs/orderVerifyWithinHours config - "not evaluated" otherwise), append-only acknowledgement, raise as incident signal. Copilot: 8 MaiK tasks with record facts shown apart from reasoning; outage = no answer. Portal: wardsynq.com/portal.html (live 200) - patient and proxy access with grants, audited proxy reads, released-only data, messages, consent withdraw (non-treatment); staff "Patient portal" tile; needs wardsynq.patientAccess.enabled per hospital. Queue status, released documents and full discharge summary in portal built 2026-09-14 (branch p2-portal-gaps). Live shell 34, ward.js site66. 6328 passing.
**Next P2:** offline-first (P2.4), FHIR platform depth (P2.5), India profile (P2.6), multilingual (P2.7), voice notes (P2.8), hospital intelligence (P2.10), specialty framework + pathways (P2.11/2.12), developer platform (P2.13), multi-hospital (P2.14), UX bar (P2.16).

### 2026-09-13 - P2 builders completed: P2.12/2.11 pathways & specialty, P2.6/2.7 India & multilingual, P2.4 offline-first

Resumed and completed all three stopped P2 builders:
- P2.12 Clinical pathways & P2.11 Specialty framework: authoring in Admin > Pathways card (`/pathways/draft`, `/pathways/publish`, `/pathways/retire`), bedside pathways view (`loadPathways`, `pathwayEnrol`, `pathwayOverride`), specialty timeline panel with dangling reference safety. 5/5 tests in `test/wardsynq-pathways.test.mjs`.
- P2.6 India profile & P2.7 Multilingual: GSTIN mod-36 validation & line calculation on invoices, ABDM HFR/HPR identifier validation, India region profiles on orgs, Devanagari phonetic transliteration in MPI patient search (`wardsynq-mpi.js`), and patient-facing `wardsynq/site/i18n.js` with non-translation invariant for clinical entities. 8/8 tests in `test/wardsynq-region-in.test.mjs`.
- P2.4 Offline-first clinical operation: IndexedDB-backed `ward-offline.js` bedside queue & cache, `requestContextOf` offline headers (`X-Offline-Created-At`, conflict reason), idempotency replay in `RecordService.replayFor()`, audit capturing offline creation time alongside server sync time, `_worker.js` header forwarding. 4/4 tests in `test/wardsynq-offline.test.mjs`.
- Reachability: 0 routes without a screen (365 reachable, 30 machine-only). Regression: 6316 pass, 0 fail, 1 skipped. Live admin.js 15, ward.js site67, ward-offline.js 1.

### 2026-09-14 - Review of the bulk "36 bugs" and workstation commits; P2.8 voice typing

A read-only review of 84a5f176 / ff5fd900 / 40ff5a45 / 8d759a70 / 8e1b75a1 found regressions; each verified, then fixed (66b49de8, f7fd8dac):
- Whole blood was checked with the red-cell ABO table (O whole blood passed for an A patient). Now identical group only; test added.
- 2D echo, angiogram and critical-result follow-up posted to `/ward/timeline-note` (no such route) and reported "recorded"/"notification sent". Echo/angio now write through `/ward/note` with settle; the follow-up sheet is gone. Blank angiogram vessels are "not reported", never "Normal".
- Unidentified FEMALE shown as MALE (MRN substring). Add/Remove bed browser-only. Blood bank "auto-detected" Hb/PLT/group banner. Instruction notes claiming notification; FollowCare enrolment the server ignores. Dead buttons fronting fabricated imaging findings, a fake QR "secret token", scheme search. Invented oncology protocol versions. All removed or reworded; ED trauma checkbox now sent.
- Lab templates prefilled adult ranges/units: now test names only, unit/range as hints; blank template rows not sent.
- Workstation: removed the demo-cohort fallback on a failed real record, and a real hospital (site=1, not demo) with no record connected now stops with a message instead of showing demo patients.
- Two tests the bulk change broke were repaired (lab hint restored; timeline test checks the Billing chip, not the word).
P2.8 voice typing (f94933e1): on-device recognition only (`SpeechRecognition.available/processLocally`); a browser that would stream audio to an outside service is refused. Indian English or Hindi toggle, language-pack download, named errors (blocked mic, no speech), transcript lands only in an editable box. Tests: ward-dictation, ward-no-fake-success. Regression 6358 pass, 0 fail. Live ward.js site72, wardsynq-app.js 13, sw wardsynq-v6.
**Decision for the owner:** voice typing now needs Chrome 139+ on-device speech; Safari/older browsers get "type instead". Say if cloud speech is acceptable for your hospitals and under what agreement.
**Next P2:** P2.1 chart-grounded intelligence gaps, P2.5 FHIR depth, P2.10 hospital intelligence, P2.13 developer platform, P2.14 multi-hospital, P2.15 reliability, P2.16 UX bar.

### 2026-09-14 (later) - staff-admin escalation fixed; P2.5 bulk export, P2.14 groups, P2.15 health, P2.17 assignment reads merged

- Negative-authorization tests for 10 sensitive routes (tests/neg-auth-sensitive) exposed three holes, fixed in the router via `memberChangeRefusal` (functions/_opd_org.js): a non-owner staff.admin (e.g. hr) could promote itself to admin, and disable or re-PIN the owner's staff sign-in. Now: no own-role change, owner untouchable, no acting on or granting a staff-managing role holding permissions the caller lacks; hr managing clinicians unchanged. Untested-route worklist 32 -> 22.
- P2.5 FHIR Bulk Data (p2-fhir-bulk): `$export` system and Patient level, async via outbox/tick, encrypted NDJSON in existing document storage, manifest error[] for anything truncated or unconvertible, one export per hospital, 24h expiry, audited downloads. Admin > Data export. Not built: download buttons in the admin screen (files are fetched through the FHIR API), POST kick-off, Group/$export.
- P2.14 Hospital groups (p2-hospital-group): invite plus owner acceptance, aggregate-only overview (#/group) read as an audited system read per hospital, recommended-settings policy adopted explicitly. Group admins get 403 on every member hospital's patient routes. **Owner to confirm:** counts are computed by a system read authorised by the hospital owner's acceptance (Decisions.md).
- P2.15 System health (p2-access-reliability): seven dependency probes with a 3 s timeout, fixed plain-language consequences, Admin > System health; docs/INCIDENT_RESPONSE.md; last tick outcome kept in MAIK_KV.
- P2.17 Reads outside assignment: `outOfAssignmentFindings` in the Security review, with exemptions listed and "not evaluated" when no assignment data.
- Regression 6435 pass, 0 fail, 1 skipped. Reachability 0 without a screen. Live admin.js 18, group.js 1.
**Next P2:** P2.13 webhooks on the outbox, P2.10 longitudinal trends, P2.16 severity-colour audit, P2.5 remaining (terminology, Subscription, IPS).

### 2026-09-14 (evening) - P2.10 trends, P2.13 webhooks, P2.16 colour audit merged; approval race fixed

- Approval decisions used requestId + millisecond as their id; two approvers in the same millisecond overwrote each other and the chain counted one. Random tail added; clock-frozen test fails without the fix (was an intermittent 409 order_not_approved under parallel load).
- P2.10 Trends (p2-trends): Digital twin > Trends. Ten metrics plus billed charges (BILLING_VIEW), computed from record history (no snapshot store; Decisions.md), hospital time zone buckets, numerator/denominator/coverage per point, null with a reason for unreadable sources, drill to ward then record ids gated like record-detail plus a department-scope check (a nurse scoped to Surgery gets 403 on a Medicine ward's records). Limits: current ward per stay, today's bed count for past occupancy, 1000-row cap marked partial.
- P2.13 Webhooks (p2-webhooks): Admin > Integrations > Webhooks. Thin HMAC-signed notifications (hashed ids, event type only, no PHI; receivers read through FHIR/SMART), staged in the same append as the record in TenantBackend.write so a failed write emits nothing, one outbox event per endpoint, 5 s timeout, no redirects, private and metadata addresses refused at registration and before each send, auto-disable after sustained failure, secret shown once and stored encrypted. Also fixed outbox drain reading the OLDEST 200 events (new events became invisible after 200 settled ones). Open: DNS pinning is not possible in this runtime, no secret overlap on rotation, delivery log reads the newest 1000 attempts.
- P2.16 (p2-ux-severity): stock adjust/wastage and rota "Block period" buttons no longer warning-coloured; test/wsq-severity-colour-audit.test.mjs blocks new decorative red/amber. Owner decisions: recording dot, admin status pills, portal Revoke button.
- Regression 6459 pass, 0 fail, 1 skipped. Reachability 0 without a screen, 22 without a test. Live ward.js site74, admin.js 19.
**P2 remaining:** P2.5 depth (terminology service, Subscription, IPS, Consent/AuditEvent as FHIR, R4B/R5), P2.13 SMART app registration UI for third parties, P2.16 doctor keyboard shortcuts and tablet nurse layout, and the 22 routes without a test.

### 2026-09-14 (night) - P2.16 keyboard and tablet, P2.5 FHIR depth, three Muse follow-ups

- P2.16 (p2-ux-speed): ward keyboard layer (/ search, g w/c/l, n/o/r/v on a chart, ? sheet, Esc), never fires while typing, never bound to a write (test fails on any non-GET), aria labels on icon buttons, focus ring. Tablet 768-1180 px: 44 px targets, sticky "next due" (says "not known" when a dose was unreadable), two-pane round in landscape; headless check test/run-ward-tablet-ui.mjs 35/35.
- P2.5 (p2-fhir-depth): terminology (CodeSystem/ValueSet, $expand, $validate-code; external systems served only as flagged fragments), Patient/$summary IPS (emptyReason vs unavailable vs withheld), AuditEvent (system/ or admin only, reading audited), Consent tests, FHIR Subscription notifications on the webhooks outbox; Admin > FHIR tab and chart "IPS summary". docs/FHIR_STRATEGY.md: R4 only for now. Not built: R4B/R5, IPS immunizations (no source type), Subscription create over FHIR.
- Muse (muse-spark-1.3, reviewed and verified here): webhook secret rotation keeps the old secret valid 24 h (dual signature); bulk export records file keys before writing so failed runs cannot orphan encrypted files (failed and stalled jobs now delete files); hospital groups can have several administrators (last one cannot be removed).
- Regression 6515 pass, 0 fail, 1 skipped. Reachability 0 without a screen. Live admin.js 22, ward.js site76.
**P2 remaining:** 22 routes without a test (builder running), SMART third-party app registration screen, R4B/R5 when a partner needs it. Owner items unchanged.

### 2026-09-14 (late) - every route has a test; three bugs they found; SMART apps screen; no em dash

- Tests for the last 22 routes (tests/remaining-routes). Bugs fixed: maternity status/MEOWS/blood-loss/delivery swallowed failed reads and answered ok (now 502, and the screen shows each failure and hides the delivery form when delivery state is unknown); POST /room/update had no hospital ownership check; loadSessionFor refusals threw a raw 500 on 11 session routes. Reachability: "Every route has a screen and a test."
- Muse: Admin > Integrations > Connected apps (SMART) registers clients in wardsynq.fhir.smart with strict validation, private JWKs refused, removal revokes live tokens; em dash removed from app-facing text with test/wsq-no-emdash.test.mjs.
- Flaky outbound test fixed (T0 fixed one second after load; under load later deliveries were never due).
- Regression 6552 pass, 0 fail, 1 skipped. Live admin.js 23, ward.js site78.
**In progress:** P2.17 security scanning plus penetration test plan (Muse), P2.17 tamper-evident audit chain with database-level immutability (builder). After these, P2 is complete except R4B/R5 (deferred by docs/FHIR_STRATEGY.md) and owner items.

### 2026-09-14 (evening, 2) - P2.17 security scan and tamper-evident audit trail live

- Security scan (Muse, two rounds): scripts/security-scan.mjs in its own CI job. Current tree: 0 findings, 16 public-by-design values recognised by SHA-256 fingerprint, 2 dependency advisories reported as non-blocking WARN for the owner (@xmldom/xmldom GHSA-6gmq-8vp8-gcm6, brace-expansion GHSA-rgw5-rvv9-x895). docs/PENETRATION_TEST_PLAN.md written; the test itself has not been done.
- Audit trail (p2-audit-immutable): wardsynq_audit_chain hash-links every clinical audit row in the same batch; BEFORE UPDATE/DELETE triggers on connect_audit_event and the chain table. Verification in Admin > Security review and System health. auditRetentionYears informational (India default 3 years per IMC 1.3.1). Also fixed a double-admission bed race in claimBed (2-minute in-flight window).
- Deploy order followed: schema applied to production D1 (stewardmd-connect) BEFORE the code, after a local wrangler D1 run confirmed the triggers parse and refuse DELETE. Production now shows both tables' triggers and the chain table.
- Post-deploy: /api/queue/ready 200. No production writes since deploy (last audit row 07:57Z), so the chain is still empty in production. Verified instead on workerd's D1 (wrangler getPlatformProxy) with the real D1Repository: writes, multi-audit batch, auditOnly and two racing writers gave "Intact: all 6 chained rows checked", and DELETE was refused. Watch: first production writes should show wardsynq_audit_chain rows equal to new audit rows.
- Not built: anchoring the chain head outside the database (a DB-level attacker can rebuild the chain or truncate its tail), chaining the Firestore org/staff audit, retention deletion.
- Regression 6593 pass, 0 fail, 1 skipped. Every route has a screen and a test. Live admin.js 24.
**Remaining for P2:** exit evidence document (Muse, paused on quota until 11:47Z), then owner items only.

### 2026-09-14 - P2 COMPLETE (engineering), owner items open

- docs/emr-gap-analysis/P2_EXIT_EVIDENCE.md: all nine P2 exit criteria with verified screens, routes and quoted tests. Verdicts: 8 MET WITH LIMITS, 1 MET (modules without destabilising the core); none NOT MET. Limits are named per row.
- Reachability checker fix: it walked dist-wardsynq/ (build output) and counted stale copies as screens; now skipped. Honest count: 23 screens, 423 routes, 0 without a screen, 0 without a test.
- Production audit chain: schema and code live; no production writes since the 11:10Z deploy, so the first live links are still to be observed (hourly check armed).
- Update later the same day: portal gaps closed (p2-portal-gaps) and the audit chain head anchored outside D1 (Muse). See the next entry.
- Open, owner only: document bucket (DOC_S3_*), payment provider credentials, notification channel, payer endpoint and credentials, PACS viewer URL template, cloud speech decision for voice typing, two dependency advisories (@xmldom/xmldom, brace-expansion), penetration test to commission (plan in docs/PENETRATION_TEST_PLAN.md), FHIR R4B/R5 when a partner needs it. Owner confirmations requested: hospital-group counts computed by an audited system read authorised by owner acceptance; recording-dot/admin pill/portal Revoke colours.


### 2026-09-14 (night) - portal gaps closed; audit chain anchored outside the database

- Portal (p2-portal-gaps): queue status (own tickets only, people ahead as a count, stored ETA or "No estimate", ambiguous MRN link shows "ask at the desk"; POST /api/portal/queue audited); released documents (clinician releases an exact version from Chart > Documents via POST /ward/document-release, emr.treat; portal download via POST /api/portal/document streams bytes only if released, current and within retention, audited before sending); full discharge summary (clinician chooses patient copy or full at release; while any result is withheld or a diagnosis is differential, Tests/Assessment/Diagnoses stay withheld). Proxies get the new sections only when granted. 19 new tests, headless portal check 25/25.
- Owner decisions: the OPD queue has no token numbers (portal shows people ahead, not a token); full-summary withholding is per section, not per result (needs structured summary storage to refine); portal's older sections are still English-only.
- Audit anchors (Muse): chain head copied to KV hourly; rewritten/truncated after an anchor shows in System health and Security review. Owner acknowledgement of a legitimate restore is being built (Muse).
- Regression 6620 pass, 0 fail, 1 skipped. Every route has a screen and a test. Live portal.js 2, ward.js site79, admin.js 25.

### 2026-09-14 (night, 2) - OPD token numbers; owner-confirmed restore

- Token numbers (opd-token-numbers): per hospital, per OPD day, per scope (default whole hospital; department scope with 1-3 character prefixes set in Admin > Hospital). Counter and ticket written in one compare-and-set commit (no burnt numbers, no ticket without a token; 5 retries then 409 token_contention). Stable across move, reassign, priority and send-back; cancelled numbers never reused; new day restarts at 1; no backfill. Shown on desk, doctor queue, OPD console, waiting-hall display (token only, names removed), patient portal ("Your token") and SMS/WhatsApp text (no PHI).
- Notes: no recall out of no-show exists (no_show is terminal); department scope without prefixes can repeat numbers across departments (admin card warns); native app not rebuilt.
- Audit anchor acknowledgement (Muse): hospital owner or platform owner only, reason plus incident reference, old anchor log archived, acknowledgement chained.
- Regression 6640 pass, 0 fail. Every route has a screen and a test. Security scan 0 findings.

### 2026-09-14 (night, 3) - owner answers recorded; portal languages ready for translation; outbox status read

- Owner answered S1-S7, D1-D14, G1-G15 (top of HANDOVER_2026-09-14.md); build waves in OWNER_ANSWERS_BUILD_PLAN.md.
- D6: one file per portal language (en in i18n.js; es, te, hi, bn, kn, ta, ml in wardsynq/site/i18n/), switch on every portal section listing all eight, only the chosen file loads (offered codes only). Antigravity brief: docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md (154 English keys).
- G1 (Muse): outbox drain and health read waiting events by status; idx_wardsynq_record_outbox_status applied to production D1 first. D2 (Muse): @xmldom/xmldom 0.9.12, brace-expansion 5.0.9. G15: no dead tr.warn CSS existed (the warn rows are unstyled; D8 work); CI already runs the security scan.
- Disk was full (0.6 GB); 19 merged clean agent worktrees removed (18 GB free). Old muse-* worktrees still hold unstaged copies of merged work.
- Regression 6653, 0 fail after two tests updated for the language split. Every route has a screen and a test. Live portal.js 5, i18n.js 4.

### 2026-09-14 (night, 4) - connectors, per-entry withholding, FHIR R4B/R5, immunizations

- Connectors (S2/S4/S5/S7): Admin > Integrations cards for payment gateway (manual, Razorpay, Stripe), payers/TPA (FHIR Claim, NHCX envelope only, manual) and DICOMweb (server-side test connection); credentials sealed, shown once; cashier online payment link; POST /api/queue/payment-callback/<org> marks paid only after signature, gateway read-back and exact amount/currency, else flagged. PHI to AI only via Vertex (wardsynq.maik.phiApproved). Not live-tested against any real gateway, PACS or payer; NHCX needs onboarding.
- D5/G5: full discharge summary withholds entry by entry (open critical loop, preliminary, never-release test, differential/refuted diagnosis); assessment, rewritten sections and older summaries still withheld whole; staff preview uses the portal renderer. Chart > Documents lists portal releases per version.
- G6/G9/G10/D9: Immunization record, chart screen, FHIR and IPS section; ward Group $export with POST kick-off and Admin downloads; FHIR Subscription create and $status; R4B and R5 by fhirVersion (R5 for Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest, Immunization; 406 elsewhere).
- S3/S6 designs merged (S3_UNIFIED_WARD_APP_DESIGN.md, S6_ABDM_INTEGRATION_DESIGN.md). Found: no critical result reaches a phone today; escalation runs only while the ward is open; ICU push shows value and bed on the lock screen. Owner questions O1-O5, A1-A5 open (O1 Pro paywall deadline 2026-09-15 23:59 IST).
- Regression 6724, 0 fail. Every route has a screen and a test. Security scan 0 findings. Live ward.js site83, admin.js 29, shell.js 37, portal.js 6, i18n.js 5.
