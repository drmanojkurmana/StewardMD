# WardSynQ P2 exit evidence

Date: 2026-09-14. Method: each row below was checked against the code it names.
A pointer that could not be confirmed in a file is not listed. The progress log
(`docs/emr-gap-analysis/P0_CURRENT_STATE.md`) was used only as a map; the proof
is the file, the route, and the named test. Plain reading guide: Screen says how
a user reaches the thing, Server names the file and the route, Tests quote a
test title from the named file, Known limit says what is still true and bounded.

Verdict scale: MET means the claim holds with only minor stated limits.
MET WITH LIMITS means the claim holds for the workflows named, with limits a
buyer should know. NOT MET means the claim cannot be made yet.

## 1. Clinicians can understand a patient rapidly

Verdict: MET WITH LIMITS. The chart gives timeline, record versions, documents,
and a cross hospital summary, but licensed vocabularies are absent and some
sections only appear once their modules hold data.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| The whole clinical story appears on one timeline, with who did each thing | Ward board, open a patient, chart sections call `apiGet("/ward/timeline?" ...)` (`ward.js`, line 6826) | `functions/api/queue/[[path]].js`, seg `ward` sub `timeline` (line 2588) | `test/wardsynq-timeline-story.test.mjs`: "the whole clinical story appears, not just notes and vitals" | Unread and unacknowledged state lives in the safety inbox, not on the timeline itself |
| Any timeline line drills down to the record with every version and what changed | Chart record view calls `apiGet("/ward/record-detail?..." ...)` (`ward.js`, line 1324) | `functions/api/queue/[[path]].js`, seg `ward` sub `record-detail` (line 1509); `functions/_wardsynq/record-detail.js` | `test/wardsynq-record-detail.test.mjs`: "versions come back oldest first, with who wrote each and when" | Opening a record logs a decisive read; superseded versions show who saw them |
| Documents sit on the chart with versions, withdrawal reasons, and retention rules | Chart Documents screen calls `apiGet("/ward/documents?..." ...)` and `apiPost("/ward/document-upload" ...)` (`ward.js`, lines 9622, 9640) | `functions/api/queue/[[path]].js`, seg `ward` subs `documents` (line 1697) and `document-upload` (line 1709); `functions/_wardsynq/documents.js` | `test/ward-documents-view.test.mjs`: "loading, failed, storage off and none on file read as four different things" | Production uploads need the owner configured bucket; until then the screen says storage is off and refuses uploads |
| Another hospital gets a readable summary, with empty kept apart from unreadable | Chart "IPS summary" button, `data-w-act="ipsopen"` (`ward.js`, line 1734) | `functions/api/fhir/[[path]].js` with `functions/_wardsynq/fhir-ips.js`, route `Patient/{id}/$summary` | `test/wardsynq-fhir-ips.test.mjs`: "IPS EMPTY VERSUS UNAVAILABLE: no allergy rows is 'none recorded' as text, an allergy read that fails is emptyReason unavailable with no entries, never 'none recorded'" | Immunizations have no source type so no IPS immunization section; no IPS profile is claimed because none is validated (`docs/FHIR_STRATEGY.md`) |

The doctor workspace (`workspaceView` in `ward.js`, line 5081) is a pure
projection over state the chart already loads: allergies, outstanding criticals,
current medicines, problems, score, results, pending tests, notes, contacts, and
a deceased banner. It adds no endpoint and no second source of truth. A block
that did not load never looks like an empty one.

## 2. Hospital staff can run their daily workflows

Verdict: MET WITH LIMITS. Core ward, nursing, pharmacy, billing, and admin
workflows each have server, screen, and test, but money movement and outside
connections wait on owner supplied credentials and endpoints.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| A consultation saves all pieces at once or nothing at all | Chart consultation form calls `apiPost("/ward/consultation" ...)` (`ward.js`, line 9813) | `functions/api/queue/[[path]].js`, seg `ward` sub `consultation` (line 1557); `functions/_wardsynq/consultation.js` over `functions/_wardsynq/staged.js` | `test/wardsynq-consultation.test.mjs`: "INVARIANT: a failure in the middle leaves the chart exactly as it was - no half consultation" | The guarantee covers one append batch; a retried consultation replays by key and writes nothing twice |
| Nurses see doses due, early warning scores, and their own patients first | Nurse worklist screen calls `apiGet("/ward/nurse-worklist?..." ...)` (`ward.js`, line 9580) | `functions/api/queue/[[path]].js`, seg `ward` sub `nurse-worklist` (line 3282) | `test/ward-nurse-worklist-view.test.mjs`: "overdue doses stand out, an unscorable score has no number, and a read failure is on the row" | An unscorable score shows no number by design; a dose whose record was unreadable reads as unknown with a warning |
| A ward stay can be closed and a follow up booked, with death kept on its own screen | Chart Discharge and Follow-up actions call `apiPost("/ward/discharge" ...)` (`ward.js`, line 8616) | `functions/api/queue/[[path]].js`, seg `ward` sub `discharge` (line 3346) | `test/ward-discharge-action.test.mjs`: "closing a stay as 'died' is refused from here - a death is recorded on its own screen first" | "Died" is refused until the death is recorded on the Contacts screen; a follow up needs a real date |
| Referrals go end to end with an inbox, states, and honest partial scans | Chart referral form and hospital Referral inbox call `apiGet("/ward/referrals?..." ...)` (`ward.js`, line 9548) | `functions/api/queue/[[path]].js`, seg `ward` sub `referrals` (line 1660); `functions/_wardsynq/referral.js` | `test/ward-referrals-view.test.mjs`: "the inbox has a specialty filter and a sent-by-me view, states a partial scan, and is a hospital tile" | A reply depends on the receiving hospital acting; a capped scan says it is partial |
| Shift handover carries SBAR with gaps counted, never looking complete | Handover board calls `apiGet("/ward/handovers?..." ...)` and `apiPost("/ward/handover" ...)` (`ward.js`, lines 9452, 9468) | `functions/api/queue/[[path]].js`, seg `ward` sub `handover` (line 3215) | `test/ward-handover-view.test.mjs`: "a handover with parts left blank says how many, rather than looking complete" | Handovers are ward scoped; the incoming shift list is the default view |
| Patients and families have their own page with released data, messages, and consent control | `wardsynq/site/portal.html` (no staff sign in); staff "Patient portal" tile | `functions/api/portal/[[path]].js` (POST only, no patient id taken from the caller) | `test/wardsynq-portal-p29.test.mjs`: "NEGATIVE: a patient token cannot read another patient, whatever the body says" | Not built: queue status, released documents, and the full discharge summary in the portal |

Payments are provider agnostic: method is separate from provider, cash is a
first class collection method, and typed money is never recorded as machine
confirmed. Live provider adapters wait on credentials (see Waiting on the owner).

## 3. Clinical safety is enforced

Verdict: MET WITH LIMITS. Inbox, critical loops, advisories, ceilings, and
surveillance signals are server side and fail loud, but some checks need
hospital configuration and renal and hepatic dosing rules remain unverified.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| One ward wide inbox, role tailored, with acknowledge from the row | Safety inbox view calls `apiGet("/ward/safety-inbox?" ...)` (`ward.js`, lines 5191, 9493) | `functions/api/queue/[[path]].js`, seg `ward` sub `safety-inbox` (line 1494); `functions/_wardsynq/safety-inbox.js` | `test/ward-safety-inbox-view.test.mjs`: "an EMPTY but INCOMPLETE list never says 'nothing outstanding'" | A patient whose chart could not be read is named; a ward past the scan cap says so; role filtering only orders, never permits |
| A critical lab value opens an alert loop, with no duplicates on re-flag | Critical results board calls `apiGet("/ward/criticals?" ...)` (`ward.js`, lines 3854, 3880) | `functions/api/queue/[[path]].js`, seg `ward` sub `criticals` (line 3245); `functions/_wardsynq/critical-results.js` | `test/wardsynq-critical-results.test.mjs`: "UNCOMPARABLE IS NOT NORMAL: a mismatched unit is reported, never silently passed" | Loops open against the stored report with site limits; escalation records "nobody was notified" when no channel is configured |
| Prescribing advice can never block, and child ceilings refuse without a weight | Dose check calls `apiPost("/ward/dose-ceiling" ...)` (`ward.js`, line 7041); admin Safety reminders tab dry runs drafts via `c.api("/ward/advisory-check" ...)` (`wardsynq/site/pages/admin.js`, line 352) | `functions/api/queue/[[path]].js`, seg `ward` subs `advisory-check` (line 2519) and `dose-ceiling` (line 1871) | `test/wardsynq-advisories.test.mjs`: "AN ADVISORY CAN NEVER BLOCK, and says so on every one" | Renal and hepatic dose checks are not confirmed present; the paediatric ceiling refuses with no weight rather than guessing |
| Deterioration, sepsis, lab trends, and overdue care raise named signals with evidence links | Surveillance board calls `apiGet("/ward/surveillance?..." ...)` and `apiPost("/ward/surveillance-ack" ...)` (`ward.js`, lines 9564, 9574) | `functions/api/queue/[[path]].js`, seg `ward` sub `surveillance` (line 2602); `functions/_wardsynq/surveillance.js` | `test/wardsynq-surveillance.test.mjs`: "stable NEWS2 is no signal; one reading is NOT EVALUATED, and an unread chart is never a quiet pass" | Medication risk signals need the hospital's high alert list and verification window configured, and read "not evaluated" otherwise |
| Interaction and allergy checking runs on the patient's actual meds, and advice never gates an order | Ordering and reconciliation screens via the prescribing routes | `functions/_wardsynq/rx-safety.js`, `functions/_wardsynq/maik-cds.js`, `functions/_wardsynq/formulary.js` | `test/wardsynq-rx-safety.test.mjs`: "evaluateRx NEVER gates: no allowed/blocks/blocked field exists on the response, whatever it finds" | Overrides are captured but a dedicated override review queue was still open at P0; allergy checking is best effort when no allergy data exists yet |

## 4. AI is contextual and traceable

Verdict: MET WITH LIMITS. Copilot answers are governed records with model,
provenance, and snapshot named, and silence on outage, but cloud reasoning only
happens with an approved provider and some bedside models run on device.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| The command copilot answers from the snapshot it saw, naming model and provenance | Digital twin view, `data-w-act="twin"` (`ward.js`, line 327); forecast calls `apiGet("/ward/twin-predict?..." ...)` (`ward.js`, line 10908) | `functions/api/queue/[[path]].js`, seg `ward` sub `twin-predict` (line 3058); `functions/_wardsynq/twin-copilot.js` | `test/wardsynq-twin-copilot.test.mjs`: "1. a Command Copilot answer is a governed record naming the model, provenance and the snapshot it saw" | With no PHI approved provider the copilot refuses and nothing is sent; on outage there is no answer rather than a guessed one |
| The model is told to use only the snapshot, including what is not built | Same twin view as above | Same copilot seam as above | `test/wardsynq-twin-copilot.test.mjs`: "4. the model is instructed to use ONLY the snapshot, and told what is NOT built" | Financial sections are opt in and absent by default, never blended into the clinical read |
| MaiK guides the next clinical step with record facts shown apart from reasoning | Chart MaiK card, history via `apiGet("/ward/maik-interactions?..." ...)` (`ward.js`, line 7700) | `functions/api/queue/[[path]].js`, seg `ward` sub `maik-interactions` (line 2699) | `test/maik-copilot.test.mjs`: "Stage 2 - workflow chains guide the next clinical step, in order" (note below) | Specialty recommendation runs on device; with MaiK disabled for the hospital the copilot refuses |

Note: quoted test titles keep their words exactly, except that one source
title contains an em dash character which this document renders as a hyphen
to keep the document itself free of that character.

## 5. The platform works through network interruptions

Verdict: MET WITH LIMITS. Named bedside workflows queue offline, a paper pack
covers a full outage, and the outbox replays atomically, but offline covers
specific workflows rather than everything, and identity outages stay fail closed.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| Bedside entries queue on the device with their offline time kept for replay | `ward-offline.js` (`window.WARD_OFFLINE`, line 348); queue and cache for named bedside kinds | Offline headers (`X-Offline-Created-At`, conflict reason) into `RecordService.replayFor()`; audit keeps offline creation time beside server sync time | `test/wardsynq-offline.test.mjs`: "RecordService.replayFor returns committed record on retry" | Covers specific bedside workflows and named record kinds, not all of them; kinds outside the list are refused offline rather than guessed |
| A stamped paper pack carries the ward when the system is down, and says it is a copy | Downtime pack button, `data-w-act="downtime"` (`ward.js`, line 351); `apiGet("/ward/downtime?..." ...)` (`ward.js`, line 10149) | `functions/api/queue/[[path]].js`, seg `ward` sub `downtime` (line 2777); `functions/_wardsynq/downtime.js` | `test/wardsynq-downtime.test.mjs`: "IT SAYS IT IS A COPY, and how old it is" | Read only and write nothing by design; an unreadable allergy list is named, never printed blank |
| Business records and their events land together and replay without doubles | Outbox status calls `apiGet("/ward/outbox?..." ...)` (`ward.js`, line 10477) | `functions/api/queue/[[path]].js`, seg `ward` sub `outbox` (line 2231); `functions/_wardsynq/outbox.js` | `test/wardsynq-outbox.test.mjs`: "INVARIANT: the business record and its event land in one append, or neither does" | At least once delivery, so consumers must be idempotent; the drain runs on ward traffic ticks, and an external scheduler token remains optional |

The failure policy is written down in `vault/decisions/Decisions.md` (2026-09-09
downtime matrix): network means read only paper, database and identity outages
fail closed with honest errors, payment and payer legs continue safely by
construction because no live gateway call exists yet, and LIS and RIS failures
queue inbound and continue safely outbound. Reconciling actions after recovery
is recorded there as separate future work.

## 6. Data is interoperable

Verdict: MET WITH LIMITS. R4 doors, validation, terminology checks, bulk
export, and HL7 inbound are live and tested, but R4B and R5 are deferred, no
licensed code releases ship, and payer verification against a real payer has
not happened.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| Staff and SMART apps read and search R4 with validation at the door | Admin center FHIR tab (`wardsynq/site/pages/admin.js`, lines 59, 70) | `functions/api/fhir/[[path]].js` with `functions/_wardsynq/fhir-route.js` (`$validate`, `$everything`, read, vread, history, search) | `test/wardsynq-fhir-validate.test.mjs`: "STRUCTURE: unknown elements, wrong cardinality, nulls, empty arrays and bad primitives are each named at their path" | Base structure validation only; every door speaks R4 4.0.1 and only R4 |
| Codes are checked against the hospital's own lists, and outside systems are flagged as fragments | Admin center FHIR tab as above | Ward door `ValueSet/$expand` and `$validate-code`; `functions/_wardsynq/fhir-terminology.js` | `test/wardsynq-fhir-terminology.test.mjs`: "VALIDATE-CODE on /api/queue/ward/fhir/ValueSet/formulary/$validate-code: true for a stocked drug, false for one not on the list" | No SNOMED CT, LOINC, or ICD release ships; the server never answers as authoritative for one; every fragment expansion carries a warning |
| Bulk export is async, audited, encrypted, and tenant bound | Admin center Data export tab (`wardsynq/site/pages/admin.js`, line 59) | `functions/_wardsynq/fhir-bulk.js` via `$export` in `functions/_wardsynq/fhir-route.js` | `test/wardsynq-fhir-bulk.test.mjs`: "KICK-OFF AUTH on /api/queue/ward/fhir/$export: no session 401, a doctor 403, another hospital's admin 403, nothing started" | One export per hospital, 24 hour file expiry, files live in document storage (needs the bucket); Group export, POST kick off, and admin download buttons are not built |
| HL7 v2 ADT lands with identifiers, authorities, and warnings, never silent drops | Admin center Integration tab, `data-w-act="integration"` (`ward.js`, line 348) | `functions/_wardsynq/hl7-inbound.js` with an exception queue for ambiguous bundles | `test/wardsynq-hl7-inbound.test.mjs`: "ADT A01 -> SCCM 1.1: identifiers with their authorities, the visit number, the location as sent, diagnosis and allergy, Z-segments preserved and never read" | Ambiguous bundles wait for human resolution; local to LOINC crosswalk mapping is owner gated and deferred |

R4B first, then R5, only when a partner needs it, is the recorded path in
`docs/FHIR_STRATEGY.md`. The TPA Claim adapter is a generic FHIR R4 shape tested
with mocked fetch only, never verified against a real payer.

## 7. Hospital operations are measurable

Verdict: MET WITH LIMITS. Metrics, trends, quality, and command center views
compute from record history with case lists and stated coverage, but historical
depth has named approximations and caps.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| Ward status counts open items with the oldest critical named | Ward status card calls `apiGet("/ward/metrics?..." ...)` (`ward.js`, line 9972) | `functions/api/queue/[[path]].js`, seg `ward` sub `metrics` (line 2966); `functions/_wardsynq/ward-metrics.js` | `test/wardsynq-ward-metrics.test.mjs`: "THE HEADLINE IS A SUM OF OPEN ITEMS, not a score" | Unreadable types are named, never counted as zero; no patient is named except the oldest critical |
| Trends show rates with numerator, denominator, and coverage per point | Digital twin Trends view calls the trends endpoint (`ward.js`, line 7975) | `functions/api/queue/[[path]].js`, seg `ward` sub `trends` (line 3001); `functions/_wardsynq/trends.js` | `test/wardsynq-trends.test.mjs`: "GET /api/queue/ward/trends: 401 with no session, 403 for a role without emr.view and for another hospital; a doctor gets the series" | Current ward per stay, today's bed count for past occupancy, 1000 row cap marked partial; unreadable sources are null with a reason, never zero |
| Quality measures carry case lists and never invent thresholds | Quality and safety views call `apiGet("/ward/quality?..." ...)` and `apiGet("/ward/quality-safety?..." ...)` (`ward.js`, lines 9977, 10000) | `functions/api/queue/[[path]].js`, seg `ward` sub `quality` (line 2759); `functions/_wardsynq/quality.js` | `test/wardsynq-quality.test.mjs`: "A RATE WITH NO CASES IS NULL, never 0% and never 100%" | Antibiotic DOT needs the antibiotics list; RCA and CAPA only after an incident is confirmed; a measure with no agreed threshold is not computed |

The command center drills every count to patients and boards (ICU, OPD queue,
staffing, lab turnaround, radiology backlog, OT, pharmacy, finance), with
billing sections gated server side to billing view.

## 8. Security and audit are demonstrable

Verdict: MET WITH LIMITS. Authentication, authorization, review queues, and a
tamper evident trail are live and tested, but the penetration test itself has
not been done and two dependency advisories remain open for owner review.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| Staff sign in with lockouts, credential policy, two step codes, and visible sessions | Sign-in security page calls `c.api("/mfa/enrol" ...)`, `c.api("/mfa/confirm" ...)`, `c.api("/mfa/disable" ...)`, `c.api("/mfa/status" ...)`, `c.api("/mfa/signins" ...)`, `c.api("/mfa/signout-all" ...)` (`wardsynq/site/pages/security.js`, lines 81 to 107) | `functions/api/queue/[[path]].js`, seg `mfa` (line 3498); `functions/_opd_auth.js` | `test/opd-staff-mfa.test.mjs`: "pure: TOTP matches the RFC 6238 SHA-1 test vectors and refuses a reused step" | Doctor StewardMD accounts use their own identity provider; hospitals may require two step per role; wrong codes lock the second step after five |
| Emergency access is time boxed, counted, and reviewed, never silent | Emergency access controls call `apiPost("/ward/break-glass" ...)` and read `apiGet("/ward/break-glass-log?..." ...)` (`ward.js`, lines 9287, 9264) | `functions/api/queue/[[path]].js`, seg `ward` sub `break-glass` (line 3116); `functions/_wardsynq/break-glass.js` | `test/wardsynq-break-glass.test.mjs`: "TIME-BOXED AND SHORT: a caller cannot ask for a week" | The review log shows whether anybody was notified, including "nobody was notified automatically"; active grants open the chart read only |
| Every clinical audit row is hash chained with database triggers refusing edits | Admin center Security review tab; review queue via `c.api("/ward/security-review" ...)` (`wardsynq/site/pages/admin.js`, line 1142) | `functions/api/queue/[[path]].js`, seg `ward` sub `security-review` (line 2508); `functions/_wardsynq/audit-chain.js` and `functions/_wardsynq/security-review.js` | `test/wardsynq-audit-chain.test.mjs`: "a changed audit row is detected at that row (memory), and on real SQL once the trigger is bypassed" | The chain head is not anchored outside the database; the Firestore org and staff audit is not chained; retention deletion is not built |
| Access anomalies are judged against each user's own baseline with rows behind each flag | Same Security review tab as above | Same review seam as above | `test/wardsynq-security-review.test.mjs`: "chart access: many distinct patients against the user's OWN baseline, with the rows behind it" | Reads outside assignment report "not evaluated" when no assignment data exists; no self review; out of assignment reads need ward data to judge |
| Each dependency reports healthy or names its reason, in plain words | Admin center System health tab (`wardsynq/site/pages/admin.js`, lines 1160 to 1185) via `c.api("/ward/system-health?..." ...)` | `functions/api/queue/[[path]].js`, seg `ward` sub `system-health` (line 2499); `functions/_wardsynq/system-health.js` | `test/wardsynq-health-probe.test.mjs`: "2. THE OUTAGE: a database with no record schema reports UNHEALTHY, and names the reason" | Seven probes with a 3 second timeout; failure detail never hands out schema or driver text; last tick outcome kept in KV |

Automated scanner evidence, run for this document on 2026-09-14:

- `node scripts/security-scan.mjs` ends with the line `security-scan summary: 0 finding(s), 16 public-by-design`, with the rules `secrets, dangerous-patterns, cors-auth, dependency-audit` all run and none skipped.
- The same run prints `dependency audit: RAN, 2 high/critical advisories (not blocking; owner review)`, naming `WARN dep:high @xmldom/xmldom high https://github.com/advisories/GHSA-6gmq-8vp8-gcm6` and `WARN dep:high brace-expansion high https://github.com/advisories/GHSA-rgw5-rvv9-x895`.
- The full test plan the scanner points at is `docs/PENETRATION_TEST_PLAN.md`; the test itself has not been done (see Waiting on the owner).

## 9. Modules can be added without destabilising the clinical core

Verdict: MET. New domains land behind the same atomic append, outbox, and
reachability gate, with stated runtime caps as the only limits.

| Claim | Screen (how a user reaches it) | Server (file and route) | Test(s) that prove it | Known limit |
|---|---|---|---|---|
| Every route has a screen and a test, checked by machine on every change | 23 screens scanned by `scripts/wardsynq-reachability.mjs` | `functions/api/queue/[[path]].js` (423 routes at time of writing) plus `functions/api/fhir/[[path]].js` | The checker plus the unit suite; see the quoted summary lines below | The checker keys routes by segment and sub and follows route lookup tables; machine only routes (HL7, backfill, on device recommend) carry a recorded reason instead of a screen |
| Pathways author as drafts, publish as immutable versions, and retire with enrolments kept visible | Admin Pathways card via `c.api("/pathways/draft" ...)`, `c.api("/pathways/publish" ...)`, `c.api("/pathways/retire" ...)` (`wardsynq/site/pages/admin.js`, lines 335, 316, 326); bedside pathways view, `data-w-act="pathways"` (`ward.js`, line 1711) | `functions/api/queue/[[path]].js`, seg `pathways` (line 3565); `functions/_wardsynq/pathways.js` | `test/wardsynq-pathways.test.mjs`: "authoring is staff.admin only; a published version is immutable and a new publish makes the next version" | The specialty panel reports dangling references rather than hiding them; enrolment and override need a reason |
| Hospital forms validate on the server and never trust client math | Admin Forms tab via `c.api("/forms/draft" ...)` and `c.api("/forms/publish" ...)` (`wardsynq/site/pages/admin.js`, lines 280, 271); chart Forms screen via `apiGet("/ward/form-responses?..." ...)` (`ward.js`, line 11189) | `functions/api/queue/[[path]].js`, seg `forms` (line 3552); `functions/_wardsynq/form-response.js` | `test/wardsynq-forms.test.mjs`: "calculated fields are computed on the server, never taken from the client, and absent without their inputs" | Published versions are create only; drafts never edit a live version |
| Outside systems get thin signed notifications with no PHI, plus strict SMART client registration | Admin Integrations tab: `c.api("/ward/webhook" ...)`, `c.api("/ward/webhook-rotate" ...)`, `c.api("/ward/webhook-test" ...)`, `c.api("/ward/webhook-deliveries" ...)` and `c.api("/ward/smart-clients" ...)` (`wardsynq/site/pages/admin.js`, lines 1424, 1434, 1453, 1464, 1399) | `functions/api/queue/[[path]].js`, seg `ward` subs `webhook` (line 2041) and `smart-clients` (line 2064); `functions/_wardsynq/webhooks.js`, `functions/_wardsynq/smart-server.js` | `test/wardsynq-webhooks.test.mjs`: "an admission emits one encounter.admitted in its own write; the delivery is signed, has the headers, and carries no PHI" | DNS pinning is not possible in this runtime; the delivery log reads the newest 1000 attempts; rotation keeps the old secret valid 24 hours |

Reachability evidence, run for this document on 2026-09-14:

- `node scripts/wardsynq-reachability.mjs` ends with the two lines `Screens: 23 | routes: 423 | reachable: 393 | machine-only: 30 | waiting for a screen: 0 | waiting for a test: 0` and `Every route has a screen and a test.`
- Writes stay atomic through `functions/_wardsynq/staged.js` (one append per unit of work) and fan out through `functions/_wardsynq/outbox.js` (claimed, retried with backoff, dead after 6), so a new module that writes through the same seams cannot half land.

## Waiting on the owner

These are configuration and external decisions the product cannot supply
itself. Each blocks a real capability named above.

- Document storage bucket name: create a private bucket (R2 or S3) and set the `DOC_S3_*` secrets on the stewardmd Pages project; until then uploads are refused and the screen says storage is off.
- Payment provider credentials: the method framework, cashier picker, and reconciliation fields are built, but no live provider adapter can move money without credentials.
- Notification channel: critical result escalation and rota and ticket pings currently record "nobody was notified" when no channel is configured.
- Payer endpoint and credentials: the per payer registry, estimate, acknowledge, settle, and balance to patient flows exist, but the Claim adapter was tested with mocked fetch only and no submission has reached a real payer.
- PACS viewer URL template: the imaging viewer launches from a configured https template with study UID and accession only; without it there is "Open images" nowhere to go.
- Whether voice typing may use a cloud speech service: dictation is on device only (`processLocally: true` in `ward.js`, line 1079), and a browser that would stream audio outside is refused; Safari and older browsers get "type instead".
- FHIR R4B and R5: deferred by design, see `docs/FHIR_STRATEGY.md`; R4 only until a partner needs more, with one mapper table per version and validation before declaring.
- The two dependency advisories reported by `scripts/security-scan.mjs`: `@xmldom/xmldom` (GHSA-6gmq-8vp8-gcm6) and `brace-expansion` (GHSA-rgw5-rvv9-x895), both high, both non blocking WARN lines for owner review.
- Penetration testing itself: the plan exists in `docs/PENETRATION_TEST_PLAN.md`; the test has not been done. Staging first, synthetic patients only, two tenants plus a third party client, findings through `docs/INCIDENT_RESPONSE.md`.

