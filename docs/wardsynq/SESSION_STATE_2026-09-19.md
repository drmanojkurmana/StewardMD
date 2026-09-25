# WardSynQ session state, 2026-09-19

Read this before starting any WardSynQ work. **Nothing listed as built may be rebuilt.** Check the code
first (`grep`/`graphify query`), then build only what is genuinely missing.

## Where things are

- Worktree `/Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/wardsynq-p0`, branch `wardsynq-product`.
- Live: `main` at `d3d29588` (server build passed; wardsynq.com serving it). Language files token 30, 8 languages.
- Full suite: 8,469 tests passing (`bash .claude-suite-chunks.sh` style chunks; see the job's suite-chunk.sh).
- Knowledge graph: `graphify-out/` and `.planning/graphs/` (59,769 nodes, built at d3d2958). Both gitignored.

## Built and live (do not rebuild)

Six audit rounds against Epic, Oracle Health, athenaOne and Palantir, plus the earlier gap work:

1. ABDM (ABHA, Scan and Share, sharing, HFR/HPR), labels and scanning, lab analysers with Westgard QC,
   statutory registers (NDPS, PCPNDT, MLC, MTP, births and deaths, IDSP), DPDP and NABH, HMIS, report builder,
   stores, assets, blood bank, support services (diet, CSSD, housekeeping, ambulance, mortuary), HR, reminders,
   portal booking, feedback, backups, claims with NHCX, GST, packages, clinical (pregnancy and lactation checks,
   growth charts, APGAR, pre-anaesthetic checkup, expected discharge, transfer requests, code sets).
2. Owner's legal and GST model: legal requirement registry with State/UT rules and status (under challenge is
   enforced), retention by legal basis, GST parties per payer contract, donor criteria stricter of WHO and
   Indian law, CDC 2000 growth tables (public domain).
3. Claims operations, discharge milestones and transfer centre, theatre sessions and OPD access times, nurse
   staffing, infection control and antibiogram, staff messaging and in-basket, legacy import, formulary screen,
   dialysis unit, cashless desk, pre-admission intake.
4. Correctness at scale: census by open status, whole-type paged reads, store caps, clinical settings editors,
   over-limit messages, purchase order store, appointment intake switch.
5. No silent empty clinical reads (break-glass, prescribing advisories, patient flow), status-scoped worklists
   (orders now close on result release), order-close backfill, period-scoped reports (`listSince`,
   `read-window.js`), remaining capped reads (smart-server revocation, digital twin, lab QC, security review).
6. Unchecked safety checks (rx-safety, pharmacy verify and dispense, radiology contrast and renal), no silent
   empty chart (patient copy refuses on unreadable chart), external order closure, booking clash window with a
   last look before writing, registry newest-first.

NABH: 30 of 32 indicators compute.

7. Recall register screen (2026-09-19): `recallView` in `ward.js`, reached from Boards and tools, reads
   `/ward/registries`. The last route without a screen; the reachability gate is now at zero on both lists
   (`knownGaps` is empty) and `test/ward-recall-register-view.test.mjs` pins it.

8. Ward list latency (2026-09-20): the list cost one read per patient plus one audit chain write per
   read (249 store calls for a 120-bed ward, ~370 D1 round trips, 5-8s on screen). Now 7 store calls:
   `latestByIds` on the port (memory + D1/SQLite), `RecordService.getMany` (one audit row per chart
   still, written in batches), patients and stated discharge dates read by id, and `/ward/list` wrapped
   in `bufferReadAudits`. Pinned by `test/wardsynq-ward-list-round-trips.test.mjs`, which counts round
   trips rather than timing anything. The ED board shares `patientsFor`, so it gained the same fix.

## Open work that does NOT need the owner

- Nothing. Every route has a screen and a test (`node scripts/wardsynq-reachability.mjs`).
- Optional graph parsers: `graphifyy[sql]`, `graphifyy[terraform]` (SQL/HCL files contributed nothing).

## Needs the owner (do not guess these)

- **O1** NABH KPI 4: the hospital's medication-error capture definition.
- **O2** NABH KPI 9: a severity model plus clinical sign-off.
- **O19** a formulary capability, so a pharmacist need not hold the admin role.
- **O20** a latest-version table or index: every paged read still costs a whole-type group-by per page.
- Clinical sign-offs: Kt/V formula (dialysis), infection criteria names, patient leaflet content.
- Accountant: GST on supplier returns; cut-over rules for open stays and balances.
- Credentials and approvals: an AI provider approved for patient data (hard Local AI policy), NHCX, e-invoice,
  WhatsApp, the A2 production release, the S1 bucket.

## House rules that bit this session

- Never run the worktree cleanup script while builders are running; it deletes a clean worktree that has not
  committed yet. Use the exclusion form (`wt-clean4.sh <live agent dirs>`).
- Cloudflare Pages caps a deployment at 20,000 files. The `stewardmd` project's build command is
  `rm -rf test docs vault android ios` (build copy only) to stay under it.
- Background translation is killed by the low-memory monitor; run one language per foreground call.
- A route that does not exist also answers 401, so a 401 probe never proves a deploy.
