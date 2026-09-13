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
