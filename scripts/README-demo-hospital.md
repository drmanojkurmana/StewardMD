# WardSynQ DEMO hospital seeder

`scripts/wardsynq-demo-hospital.mjs` builds a complete, clearly-labelled **DEMO** superspecialty
hospital in WardSynQ by driving the real HTTP API — one authenticated session per member of staff.

## THE DATA IS FABRICATED

Every patient, name, phone number, diagnosis, laboratory result, invoice, claim and transfusion this
script creates is **invented**. No real person's data is used and none is produced. Nothing it writes
is clinically meaningful and no phone number it writes should ever be dialled.

The seeder **refuses to write into any organisation whose name does not contain "DEMO"**, and it
prints that warning at the start and at the end of every run.

Names use invented surnames (`Testkar`, `Fictor`, `Samplewala`, …) and are prefixed `Demo `.

**On the phone numbers.** India has no officially reserved fiction range (unlike Ofcom's
`07700 900xxx`), and `functions/_opd_patient.js` validates a real 10-digit Indian mobile — so a
foreign fiction-range number is refused at registration. The seeder therefore uses one contiguous
block of sequential synthetic numbers starting `7000 1xxxxx`, internally consistent and never dialled
by the software. They are not "reserved" in any regulatory sense; treat them as unusable test data.

## What it builds

| | |
|---|---|
| Departments | 20 (14 clinical specialities + lab, radiology, pharmacy, blood bank, billing, HIM) |
| Wards | 15 |
| Beds | exactly **100** |
| Occupied at the end | exactly **80** (82 admissions, 2 discharged with signed summaries) |
| Other bed states | 3 cleaning, 2 blocked, 1 maintenance, 14 available |
| Staff | **164** members across 15 roles, each acting through their own session |

Clinical surfaces exercised: registration, admission and bed placement; nursing vitals and a second
observation round; fluid balance; care plans; shift handover (given by one nurse, received by
another); problem lists; medication orders; pharmacy verification and dispensing; the full eMAR round
through its real five-rights gate (with a second-nurse witness for high-alert products); laboratory
ordering, specimen collection, result release and the critical-result escalation loop; radiology
reports; ED arrivals with triage acuity and disposition; theatre cases through the whole WHO
checklist with anaesthesia records and an implant; a pregnancy, labour observations, a delivery and a
linked newborn; paediatric and neonatal dosing checks and a neonatal line; an oncology plan link,
staging and a chemotherapy administration; cardiology ECG references; a full transfusion chain
(request → crossmatch → issue → two-person bedside check → start → observe → complete); invoices,
deposits, payments, coded claims and a TPA pre-authorisation; release-of-information requested,
authorised and fulfilled; incidents filed by a nurse and triaged by a safety officer; and two
discharges with signed summaries.

## Running it locally

```sh
# 1. build the site bundle once, if dist-wardsynq is missing
scripts/build-wardsynq-site.sh

# 2. the real local backend (in-memory Firestore double + a REAL on-disk sqlite clinical record)
node --experimental-test-module-mocks \
  test/wardsynq-persistence-server.mjs 8799 /tmp/demo.sqlite &

# 3a. seed straight against that server (fastest, no Pages layer needed)
BASE=http://localhost:8799 WSQ_ACCESS=1 WSQ_ORG=org-wsq node scripts/wardsynq-demo-hospital.mjs

# 3b. or put wrangler in front of it first, if you also want the site
npx wrangler pages dev dist-wardsynq --port 8790 --compatibility-date=2025-01-01 \
  --binding WSQ_UPSTREAM=http://localhost:8799 &
BASE=http://localhost:8790 WSQ_ACCESS=1 WSQ_ORG=org-wsq node scripts/wardsynq-demo-hospital.mjs
```

Two things about the local harness are worth knowing, because the seeder works *with* them rather
than fighting them:

* **`WSQ_ORG=org-wsq` is required locally.** The test double hard-codes the Connect tenant's
  `settings.wardsynq.orgId` at `org-wsq`, so a freshly created organisation would never be the one
  `functions/_wardsynq/org.js` resolves for that tenant, and every staff membership would be invisible
  to the record service. `WSQ_ORG` names the existing WardSynQ-native org to adopt; the seeder renames
  it to `WardSynQ DEMO Superspecialty Hospital` before it writes anything.
* **Signing needs no flag any more.** Until 2026-09-11 a signing credential came from exactly one
  place, a verified Firebase custom claim (`regNo`), so a doctor signing in as hospital staff could
  write the chart and never sign a prescription, note or discharge summary: every one refused with
  `NO_CREDENTIAL`. **This seeder found that**, and the hospital's own staff registry is now the
  second source: the Admin Center records a prescriber's registration number on their membership,
  and the seeder sets one for every doctor, resident, supervisor and admin it creates. Each signed
  record says which of the two vouched, in `writtenBy.credentialSource` -
  `"hospital-asserted"` here, `"platform-verified"` for a StewardMD account whose registration
  the platform itself verified.

  `WSQ_LOCAL_REGNO=1` still exists on the local server and is now OPTIONAL: it synthesises the
  Firebase claim for identities whose local part starts `dr.` or `res.`, which is the only way to
  exercise the `platform-verified` branch locally. Leave it off and the run proves the registry
  path instead, which is what a real hospital uses.

The persistence server's Firestore double is in memory: the organisation, wards, beds and staff
roster are rebuilt on every start, while the clinical record persists in the sqlite file. That is why
the seeder re-creates only the wards and beds it cannot find and leaves the rest alone.

## Running it against a deployed site

```sh
BASE=https://wardsynq.com \
WSQ_OWNER_TOKEN="<a Firebase ID token for the owner>" \
node scripts/wardsynq-demo-hospital.mjs
```

Without `WSQ_ACCESS=1` the seeder uses **staff PIN sessions**: for every member it created it sets a
PIN (`POST /api/queue/member/pin`, needs `staff.admin`) and then exchanges it for an `X-Staff-Token`
(`POST /api/queue/auth/pin`). Owner-gated setup — creating the WardSynQ-native hospital when none
exists — uses `WSQ_OWNER_TOKEN` as a bearer token. The deployment must have `QUEUE_STAFF_ENABLED=1`.

Note that on a deployed site staff PIN sessions carry no `regNo` either, so the same `NO_CREDENTIAL`
limit applies to every signable write. See the findings note in the script header.

## Flags and environment

| | |
|---|---|
| `--dry-run` | prints the whole plan and writes nothing |
| `--force` | replays every call against an already-seeded hospital |
| `BASE` | API origin, default `http://localhost:8790` |
| `WSQ_ACCESS=1` | identity travels as `Cf-Access-Authenticated-User-Email` |
| `WSQ_OWNER_TOKEN` | Firebase ID token for owner-gated setup on a deployed site |
| `WSQ_ORG` | organisation id to adopt and rename (required locally) |
| `WSQ_BOOTSTRAP` | an identity that already holds `staff.admin`; its only job is to create the DEMO admins |
| `WSQ_CONCURRENCY` | bounded parallelism, default 6 |
| `WSQ_ANCHOR` | ISO instant every deterministic id hangs off; changing it seeds a second cohort |

## Idempotency

Every id the seeder produces is deterministic (fixed MRNs, a fixed admission-time anchor, one
idempotency key per logical action), so a second run updates rather than duplicates. By default a run
against an already-seeded hospital stops and says so. `--force` replays everything; expect a long
list of refusals — the state machine correctly declining to re-give a given dose, re-release a final
result or redraft a signed summary. Those are the product working, and the summary says so.

## Reading the output

The run ends with: the bed count and every bed state, the number of inpatients the server itself
reports on the board, the staff count, total calls, wall time, a per-role count of successful actions
(with an explicit check that every role created actually did something), and every failure grouped by
route + role + the server's own error text. A fresh run that does not reach 100 beds / 80 occupied,
or that leaves a role idle, exits non-zero.
