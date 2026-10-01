---
tags: [module, clinical-content, review]
status: built 2026-09-28 behind the flag; tables self-create on first use (no manual migration)
flag: smd_kb_bulletins (client, default ON since 2026-09-28; ?bulletins=0 or localStorage "0" turns it off on a device; server kill switch turns it off everywhere)
---
# Clinical Bulletins

Up to three short practice updates on the Knowledge Library disease reader, each signed by a registered doctor
against the primary source. Plan and safety rules S1 to S12: `docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md`.
Decision: `vault/decisions/Decisions.md` (2026-09-28). Signing happens in the [[Review Desk]] "Clinical updates" tab.

## How it fits together
- **Source:** a Medical Updates row (`updates`, the bell feed). The bell is unchanged.
- **Bulletin:** its own row in `bulletins` (+ `bulletin_diseases`, 1 to 5 `KB_ENRICHMENT.byId` keys), written
  by a signer in their own words. Signed content is hashed (`body_hash`, `functions/_bulletin_rules.js`
  `canonicalFields`); signing stores `signed_hash` and requires the bulletin's `source_hash` to equal the
  update's current `content_hash`.
- **Visible** only while: status signed, `signed_hash = body_hash`, `source_hash = updates.content_hash`,
  `review_due_ts` in the future, the update still exists, and the kill switch is off. Derived in SQL
  (`functions/_bulletins_repo.js` `VISIBLE_WHERE`), never a flag writes must reset.
- **Signers:** `bulletin_signers`, added by an owner (Firebase login with an owner email; token refused) after
  checking name and Reg. No. against the NMC register. Signing also needs a live `verified` claim, not trainee.
- **Kill switch:** `bulletin_settings.enabled = '0'` from the Review Desk (next request, no redeploy); env
  `BULLETINS_OFF=1` as a second layer (needs a redeploy).
- **Audit:** `bulletin_audit`, append-only, written in the same D1 batch as each change and conditioned on it.
- **Phone:** `bulletins.js` syncs `GET /api/updates/bulletins` (ETag) on launch/resume/online, at most every
  6 hours, to `localStorage smd_kb_bulletins_v1`. Copy older than 7 days: no cards, a "last synced" line.
  A disease with no bulletin shows nothing (never "no updates"). `enabled:false` from the server drops the copy.

## Phase 2: automatic intake (2026-09-28)
Journals and regulators feed the Review Desk automatically; a doctor still signs every bulletin.
- **PubMed** (`functions/_pubmed.js`, parser `pubmed`): E-utilities esearch by MeSH date (`datetype=mhda`, last 7
  days, newest first, no retractions/errata) + efetch structured abstracts. MeSH date, not publication date,
  because many journals get the trial publication type only at MEDLINE indexing, weeks later. NCBI pacing 360 ms and one 429 retry (a live run hit 429
  without it); `NCBI_API_KEY` optional. Europe PMC answered 503 from the build sandbox, so trials use PubMed.
- **openFDA** (`functions/_openfda.js`, parser `openfda`): original NDA (type 1/2/4) or BLA approvals dated in
  the last 30 days, applied in code (openFDA's search matched a 2022 Mounjaro approval for a 2026 window);
  indication from `drug/label`, or, when openFDA has no label yet, from the approval letter PDF read with
  TinyFish Fetch (`pickIndication`: "is indicated for" / "provides for the use of"); https approval letters. ANDAs, new dosage forms and tentative approvals dropped.
- **Sources** (`functions/_journal_sources.js`): batch 1: openFDA approvals, NEJM/Lancet/JAMA/BMJ trials,
  cardiology (Circulation/EHJ/JACC), oncology (JCO/Lancet Oncol/JAMA Oncol). Batch 2: Annals/JAMA IM/Nature
  Medicine/NEJM Evidence trials, guidelines in major journals, Lancet specialty trials, IM specialty trials
  (Diabetes Care, Kidney Int, JASN, AJRCCM, Chest, Gastroenterology, Hepatology, CID, ICM, CCM, Blood, ARD),
  Indian journals (IJMR, NMJI, JAPI, Lancet Reg Health SE Asia, Indian Pediatr), and meta-analyses in the big six.
  Each batch is seeded once by `runPipeline` (`bulletin_settings.seed_journal_sources_v<N>`), so a new batch
  reaches existing sites and an admin delete or disable sticks. SQL copy:
  `functions/db/seed_sources_journals.sql`. Daily via the worker cron `30 5 * * *` -> `/api/updates/sync`.
- **CDSCO** (`functions/_cdsco.js`): the yearly "new drugs approved" PDFs (2020 on, via the download JSP's
  iframe) are read with TinyFish Fetch (free; Workers AI `toMarkdown` only as the fallback) into `cdsco_lists`
  during the daily sync (at most 3 a run;
  current and previous year weekly). Review Desk "Check" shows the matching entry and approval date, or "not
  found in the lists for <years>", which proves nothing. It never sets India status. Owner can force
  `POST /api/updates/bulletins/cdsco/refresh`.
- **TinyFish** (`functions/_search.js`): search (already used to enrich drug and safety summaries) and
  `tinyfishFetch` (POST api.fetch.tinyfish.ai, max 10 URLs, markdown; free, 150 URLs/min) for regulator PDFs.
  Same `TINYFISH_API_KEY` secret. No key: CDSCO falls back to Workers AI and openFDA keeps the "see the letter" note.
- **Source links** (`bulletins-desk.js` `linkFields`): source link, DOI and PMID fill in from the source item
  (http:// feed links such as FDA press releases upgraded to https; DOI/PMID recovered from doi.org / PubMed
  links; a missing link rebuilt from DOI or PMID). "Open source / Open DOI / Open in PubMed" links follow edits.
  The disease-page card also links DOI and PubMed beside the source.
- **Formatting**: B / I / U toolbar wraps the selection in `[b]..[/b]`, `[i]..[/i]`, `[u]..[/u]` (headline, What
  changed, Applies to). `bulletins.js` `fmt()` applies them AFTER escaping, fixed tags only. Length limits ignore
  the markers (`_bulletin_rules.js` `stripFormat`); the markers are part of the signed text.
- **Drafting aids** (`bulletins-desk.js`): "Draft from source" (headline, What changed cut at a full stop,
  evidence type, regulator; never India status), a banner asking for the signer's own words, "Numbers to check",
  and library diseases named in the source as tap-to-add suggestions.
- **Bell**: items with a live bulletin show "Signed bulletin in Library" (`signed_bulletin` from `getFeed`),
  worded so it never implies the AI summary itself was reviewed.
- Tests: `test/journal-intake.test.mjs`, `test/cdsco.test.mjs`, plus bell/draft/CDSCO steps in the UI harness.

## Weekly review run (Saturday 09:00 IST)
Worker cron `30 3 * * 6` posts `/api/updates/review-digest` (admin/cron token): runs the pipeline, counts what
waits (new source items without a bulletin, drafts, source changes, reviews due in 30 days;
`functions/_bulletins_review_digest.js` `pendingCounts`), then sends ONE native push to each ACTIVE signer's
devices (`sendNativeToAll(..., { uid: "fb:<uid>" })`). Nothing is sent when nothing waits. The tap opens
`/?rvtab=bulletins`: `native-push.js` `routeUrl` (warm) or `home.js` cold start -> `SMD_REVIEW.openBulletins()`.
The Review Desk tab reads "Clinical updates (N)" from `/bulletins/me` `pending`. Recorded in
`bulletin_settings.review_digest_ts` and `bulletin_audit` ('review_digest'). The daily 05:30 UTC crawl continues.
Web push is payloadless broadcast only, so signers are reached through the native app. Worker changes deploy via
`.github/workflows/deploy-worker.yml` (production environment).

## Signing desk (Review Desk tab, `bulletins-desk.js`, rebuilt 2026-09-29)
- **Queue = inbox.** To do / Live switch with counts. To do groups: Check again (source changed, review due or
  due within 30 days, source removed, disease gone from the library), Your drafts, New from journals and
  regulators. Cards: coloured type (safety red, approval teal, guideline indigo, trial blue), source and date,
  title, a one-line teaser, then Write update / Skip or Continue / Check again. Owner tools sit at the bottom.
- **Skip** (`POST /api/updates/bulletins/skip {update_id, undo}`, signer only): a row in `bulletin_skips` takes the
  source item out of `listCandidates`, so it leaves the queue and the Saturday count for every signer. Undo
  (the snackbar) deletes the row. Both are audited.
- **Editor** in the order of the work: 1 Read the source (links, AI summary folded, "Draft from source" offered
  once so it never overwrites a rewrite, source fields folded as "filled in", opened when one needs a look),
  2 Write (B/I/U, live counters that ignore the markers, numbers to check, diseases), 3 Classify (one-tap chips
  for type, India status, evidence, regulator, review interval; CDSCO check under India status).
  Preview is folded; fold state survives re-renders (`toggle` listener, capture phase).
- **Bottom bar** (sticky): "Ready to sign" or "N left: ..." (`missing()`, a mirror of `validateDraft`); tapping it
  scrolls to and flashes the first gap. Save / Preview and sign send nothing while a gap remains.
- **Sign sheet**: preview, four large checklist rows, Sign locked until all four are ticked ("3 of 4 done").
- **Polish pass (Impeccable, 2026-09-29)**: targets are 48 px because `home.js autoFitD` zooms the app to 0.95 on
  340-399 px phones (44 px rendered as 42). The bar says "N to fill in" in neutral text and turns red ("Fix: ...") only for
  a wrong entry (too long, em-dash, bad link/DOI/PMID/date). Type colour = the disease card's meaning (red safety, accent
  otherwise), shown under the title, no coloured stripe. Queue loading shows a skeleton; a failed load shows Try again
  (it used to re-request on every render). The harness audits WCAG AA contrast (text and placeholders) and 44 px
  targets on every desk screen, light and dark.

## Source hygiene (2026-09-30, after the first live bulletins)
- The queue never offers a whole-page digest: a `head`-crawled source stores its whole page as one item keyed by the
  page URL (title "EMA News and Updates", link to the index, hash moves with any change on the page). `listCandidates`
  drops items whose `doc_key` is their source's `guideline_page` or `homepage`.
- EMA moved from the news page (head) to its "New medicines: human" feed
  (`https://www.ema.europa.eu/en/new-human-medicine-new.xml`, one item per medicine with its EPAR page). Existing sites
  switch once via `applySourceFixesOnce` (`bulletin_settings.source_fix_ema_epar_v1`, only while the row still has the
  seeded values). Titles read "Inijaq (tofacitinib): EMA CHMP opinion" (`tidyFeedTitle`); a CHMP opinion is a
  recommendation, not yet an EU authorisation.
- An approval can no longer be saved with India status "Not applicable" (`validateDraft`
  `not-applicable-approval`; the desk shows "Fix: India status").
- `NON_MEDICAL_RE` (`_updates_util.js`) matches "CAT"/"CATs" (EMA's Committee for Advanced Therapies) as "cats": any
  EMA news text naming that committee is dropped. Not changed; the per-medicine feed avoids it.

## v2 (2026-09-30): second reader, specialties, checks, numbers, India access
- **Second reader** (`_bulletins_repo.js cosign / sendBack`, routes `/:id/cosign`, `/:id/return`, owner
  `/second-reader`): approvals and safety alerts signed while the rule is on (`second_required = 1`) show only after a
  DIFFERENT signer confirms the same `body_hash` (`VISIBLE_WHERE` + `COSIGNED`). Send back returns it to draft with
  `returned_note` (the first signer sees it; it counts as a correction). The card names both doctors
  (`publicProjection` `second_*`, never a uid). Queue: "Read as second doctor" (To do) and "Waiting for a second
  doctor" (your own). Desk view `second`.
- **Specialties**: owner picks them per signer (Signers > Edit); `specialtiesOf()` routes items (source branch or
  workspace first, then whole-word terms); queue filters to Mine with "Show all"; `pendingCounts(env, now, signer)`
  and the Saturday push are per signer.
- **Pre-sign checks** (`bulletins-desk.js checksFor`): `index_link`, `cdsco_contradiction`, `cdsco_unconfirmed`
  (approvals look the drug up in the CDSCO lists automatically), `ai_verbatim` (5-word overlap >= 60% with the AI
  summary), `numbers_unsourced`. Shown in the editor, the bottom bar, the sign sheet and the second read; sent as
  `warnings` with the signature and kept in the audit detail (`| warnings: ...`).
- **Numbers** (`repo.metrics`, `GET /bulletins/metrics?days=`): from the audit: days to page (first sign, or the
  second reader's), correction rate (edited, sent back or retracted after first signing; a source deletion does not
  count), coverage by source, backlog, per signer. Desk view `numbers` (Desk tools > Numbers).
- **India access** (`bulletins.js indiaAccess`): medicines named in headline / What changed / Applies to that are on
  NLEM 2022 (whole word; US names mapped: epinephrine, acetaminophen, albuterol...), with levels of care; Jan
  Aushadhi cheapest matching MRP when `data/india/janaushadhi.json` exists. Separate box, "Not part of the signed
  update". Data ships in the bundle (`build-www.sh` copies `data/india/*.json`); loaded at boot.
- **Schema v2 columns** self-apply (`_bulletins_schema.js BULLETIN_COLUMNS`, PRAGMA table_info + ALTER); hand copy
  `functions/db/migrate_bulletins_v2.sql`.
- **Indian guidelines**: PubMed seed batch 3 `pubmed-india-guidelines` (13 Indian journals, guideline types and title
  phrases; "Consensus"[pt] does not exist in PubMed, two journal names match nothing and were dropped).

## Key files
`functions/_bulletins_api.js` (routes, mounted from `functions/api/updates/[[path]].js` above the owner gate),
`functions/_bulletins_repo.js`, `functions/_bulletins_auth.js`, `functions/_bulletin_rules.js`,
`functions/_kb_disease_ids.js` (generated by `kb/tools/build-disease-ids.mjs`, part of `build-all.mjs`),
`functions/db/migrate_bulletins.sql` (same DDL at the end of `updates_schema.sql`), `bulletins.js`
(card + sync; hook in `reasoning.js` `openDiseaseRef`), `bulletins-desk.js` (signing UI), `review-desk.js` (tab).

## Tests
- `test/bulletins.test.mjs` (in `npm test`): schema parity, auth (token never signs), registry identity,
  sign-what-you-see, races, each visibility condition (mutation-checked), kill switch, tables self-create, fail closed if D1 refuses,
  audit, disease-id drift.
- `node test/run-bulletins-ui.mjs`: headless Chromium. Flag off/on, order and cap, placement above At a glance,
  India line, widths 320/390/768, stale copy, offline, kill switch, `SMD_API_BASE`, Review Desk tab gating,
  preview = bedside renderer, checklist, 409 path; desk inbox, Skip/Undo, chips, the bottom bar's gap list and
  jump, Sign locked until four ticks, desk at 320px, dark mode. Screenshots in `$TMPDIR/stewardmd-bulletins/`.

## To go live
0. v2: add a second signer (Signers > Find by email) so approvals and safety alerts can go live; set each signer's
   specialties; run `node scripts/india/fetch-janaushadhi.mjs` on a Mac in India, commit `data/india/janaushadhi.json`.
1. Nothing to migrate: `functions/_bulletins_schema.js` runs the same DDL (CREATE ... IF NOT EXISTS, once per
   isolate) on the first bulletins request, like `functions/_counters.js`. The `.sql` file stays for manual use
   (run it from the repo root: `wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_bulletins.sql`).
2. Owner opens Review Desk > Clinical updates > Signers > Add me (check the pre-filled name, Reg. No., council).
3. Default ON since 2026-09-28 (owner). Sign a few on device; a second doctor reads them for wording.

## Gotchas
- Changing `canonicalFields` changes every hash and un-signs every live bulletin. Append only, with a plan.
- After a KB rebuild, regenerate `functions/_kb_disease_ids.js` (the drift test fails until you do).
- Manual publishes now hash title + body + URL into `content_hash`, so a re-publish with new text un-signs.
- Deleting an update retracts its bulletins (`source deleted`) before the row goes.
