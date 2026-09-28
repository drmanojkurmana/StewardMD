# Clinical Bulletins: physician-signed practice updates on the disease page

Status: BUILT behind flag `smd_kb_bulletins` (default off), 2026-09-28. Owner decisions D1 to D5 settled
(section 14). Remote D1 migration not yet applied. Module note: `vault/modules/Clinical Bulletins.md`.
Deviations from the plan text, all deliberate: routes live in `functions/_bulletins_api.js`, dispatched from
`[[path]].js` above the owner gate; card styles are injected by `bulletins.js` (one renderer, one style, so the
Review Desk preview matches the bedside exactly) instead of `knowledge-library.css`; the card sits directly
under the disease title, above "At a glance" (which holds the Management summary); the signing UI is its own
file, `bulletins-desk.js`.
Supersedes: `docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md` and `functions/db/0002_updates_signoff.sql`
on `feature/clinical-update-spec` (both dropped; reasons in section 13).
Module notes to read first: `vault/modules/Review Desk.md`, `vault/modules/Knowledge Library.md`,
`vault/modules/Medical Knowledge Base.md`.

---

## 1. Problem and outcome

A doctor opening a disease in the Knowledge Library sees Harrison-derived reference content that can be
months behind practice. Medical Updates (the bell feed) already collects guideline, approval, safety and
trial news, but it is a news feed: unreviewed, not tied to any disease, and not written for the bedside.

Outcome: on the disease reader, up to three short bulletins that a registered doctor has read against
the primary source and signed, each saying what changed, who it applies to, whether it applies in India,
and where it came from. Nothing reaches that page without a signature, and a signature stops counting
the moment the text or its source changes.

## 2. Clinical safety rules (every design choice below follows from these)

| # | Rule | Enforced by |
|---|------|-------------|
| S1 | **Sign what you see.** A signature covers one exact text. | `body_hash` over the signed fields; sign request must echo the hash the signer previewed (409 otherwise). |
| S2 | **Any change voids the signature.** Editing the bulletin or a change in its source hides it until re-signed. | Visibility predicate (section 5.3) compares `signed_hash = body_hash` and `source_hash = updates.content_hash`. |
| S3 | **Fail closed.** Missing data, stale cache, deleted source, unknown disease, kill switch: show nothing. | Inner joins, cache max age, server kill switch, client ignores unknown ids. |
| S4 | **Inform, never instruct.** A bulletin reports a change and its source. It never gives a dose unless quoted from the label, never tells anyone to stop a drug, and always ends with "Check your local protocol before acting." | Field limits, fixed footer rendered by code (not stored text), reviewer checklist. |
| S5 | **India first.** An FDA or EMA approval does not mean the drug is available or approved here. | Mandatory `india_status` chosen by the signer; shown on the card. |
| S6 | **No invented evidence grades.** The signer picks the evidence *type* from a fixed list. A GRADE label appears only if the source guideline itself states it, typed in by the signer. | No defaults on evidence columns; enum validation. |
| S7 | **Safety outranks novelty.** Withdrawals and boxed warnings sort first and render with more weight than efficacy news. | Sort order and card style by `kind`. |
| S8 | **Everything expires.** The signer picks a review interval (6, 12 or 24 months) as part of the signed content; the due date is fixed at the moment of signing. Past it, the bulletin leaves the bedside until re-signed. | `review_due_ts = signed_ts + review_months` in the visibility predicate. |
| S9 | **Identity comes from the server.** The signer's name, registration number and council come from an owner-confirmed signer registry keyed by Firebase uid, never from the request body or a shared token. | `signerIdentity()` and `bulletin_signers` (section 6). |
| S10 | **Full audit.** Every draft, edit, signature, retraction, kill-switch change and automatic hide is logged append-only. | `bulletin_audit` table. |
| S11 | **Never imply completeness.** Coverage is partial by design. A disease with no bulletin shows nothing, never "No new updates". A device whose copy is too old says so instead of going silent. | Renderer rules (9.1). |
| S12 | **Original wording.** Bulletins are written in the signer's own words. At most one sentence may be quoted (for example a label dose), in quotation marks, with the source. | Reviewer checklist, 8.1. Matches the copyright rule already in `updates_schema.sql`. |

This plan makes no claim of conformity to IEC 62304, ISO 13485 or any regulatory classification. Whether
the feature changes StewardMD's regulatory position is a question for the owner and counsel, not this doc.

## 3. Scope

**Phase 1 (this plan):** data model, signer-only API, signing in Review Desk, bedside display behind a flag
with an offline cache, remote kill switch, tests.

**Not in phase 1:** new ingestion sources (OpenFDA, PubMed), AI-drafted bulletin text, changes to the bell
feed, dual signing, hospital overlays. Phase 2 is sketched in section 11 so phase 1 does not paint it into
a corner.

## 4. Architecture

```
 updates (existing, pipeline-owned)         bulletins (new, physician-owned)
 ┌──────────────────────────────┐   1..n   ┌─────────────────────────────────────┐
 │ id, content_hash, title, ... │◄─────────│ update_id, source_hash, body_hash,  │
 └──────────────────────────────┘          │ signed_hash, status, review_months  │
            ▲                              └───────────────┬─────────────────────┘
            │ bell feed (unchanged)                        │ n..m
            │                                    ┌─────────▼──────────┐
                                                 │ bulletin_diseases  │  disease_id = KB_ENRICHMENT.byId key
                                                 └────────────────────┘
 Review Desk (signer only) ── POST draft / sign / retract ──► [[path]].js ──► _bulletins_repo.js
 App launch (flag on) ── GET /api/updates/bulletins (ETag) ──► localStorage smd_kb_bulletins_v1
 openDiseaseRef(id) ── SMD_BULLETINS.html(id) ──► card above "Management / Treatment"
```

Why a separate `bulletins` table instead of columns on `updates`:
- `updates` rows are rewritten by the pipeline (`updateExisting` in `_updates_pipeline.js:68`) and by
  manual re-publish of the same URL (`[[path]].js`, POST with no head). A `verified` flag on that row
  would either be silently carried onto new text (unsafe) or need resetting in every write path (fragile).
- The bedside text is a different artifact: shorter, written by a doctor, with India status and
  population. The source news item stays as it is.
- The bell feed needs no change and no decision to ship phase 1.
- One update can yield bulletins for several diseases (an SGLT2 inhibitor result touches heart failure and
  CKD), hence the join table.

## 5. Data model

### 5.1 Migration `functions/db/migrate_bulletins.sql`

Follows the repo's `migrate_*.sql` naming. New tables only, all `IF NOT EXISTS`, so it is safe to re-run.
No `ALTER` on `updates`. The same DDL is appended to `functions/db/updates_schema.sql` so a fresh database
matches a migrated one (a parity test enforces this, section 9).

```sql
CREATE TABLE IF NOT EXISTS bulletins (
  id               TEXT PRIMARY KEY,              -- "b<base36ts><rand>" (repo.newId("b"))
  update_id        TEXT NOT NULL,                 -- updates.id this bulletin was written from
  source_hash      TEXT NOT NULL DEFAULT '',      -- updates.content_hash when the draft was last saved
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | signed | retracted
  kind             TEXT NOT NULL,                 -- safety | approval | guideline | trial
  headline         TEXT NOT NULL,                 -- <= 120 chars
  what_changed     TEXT NOT NULL,                 -- <= 400 chars
  applies_to       TEXT NOT NULL DEFAULT '',      -- population, <= 200 chars
  evidence_type    TEXT NOT NULL,                 -- regulatory_approval | regulatory_safety | guideline | rct | meta_analysis
  evidence_note    TEXT NOT NULL DEFAULT '',      -- e.g. "Strong recommendation, moderate certainty (per guideline)"; <= 120
  regulator        TEXT NOT NULL DEFAULT '',      -- FDA | EMA | MHRA | CDSCO | WHO | ICMR | SOCIETY | ''
  india_status     TEXT NOT NULL,                 -- cdsco_approved | not_approved_india | not_applicable | unknown
  source_label     TEXT NOT NULL,                 -- "NEJM 2026;395:1021" / "FDA Drug Safety Communication"
  source_url       TEXT NOT NULL,                 -- https only
  source_date      TEXT NOT NULL,                 -- YYYY-MM-DD of the source, not of ingestion
  doi              TEXT NOT NULL DEFAULT '',
  pmid             TEXT NOT NULL DEFAULT '',
  review_months    INTEGER NOT NULL,              -- 6 | 12 | 24, chosen by the signer, part of the signed content
  review_due_ts    INTEGER NOT NULL DEFAULT 0,    -- set at signing: signed_ts + review_months; 0 while a draft
  body_hash        TEXT NOT NULL,                 -- sha256 of the canonical signed fields (5.2)
  signed_hash      TEXT NOT NULL DEFAULT '',      -- body_hash at the moment of signing
  signed_uid       TEXT NOT NULL DEFAULT '',
  signed_name      TEXT NOT NULL DEFAULT '',
  signed_reg       TEXT NOT NULL DEFAULT '',
  signed_council   TEXT NOT NULL DEFAULT '',
  signed_ts        INTEGER NOT NULL DEFAULT 0,
  retract_reason   TEXT NOT NULL DEFAULT '',
  created_uid      TEXT NOT NULL DEFAULT '',
  created_ts       INTEGER NOT NULL DEFAULT 0,
  updated_ts       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bulletins_update ON bulletins(update_id);
CREATE INDEX IF NOT EXISTS idx_bulletins_status ON bulletins(status, updated_ts DESC);

CREATE TABLE IF NOT EXISTS bulletin_diseases (
  bulletin_id TEXT NOT NULL,
  disease_id  TEXT NOT NULL,                      -- key of KB_ENRICHMENT.byId, case preserved
  PRIMARY KEY (bulletin_id, disease_id)
);
CREATE INDEX IF NOT EXISTS idx_bd_disease ON bulletin_diseases(disease_id);

CREATE TABLE IF NOT EXISTS bulletin_audit (       -- append-only; no UPDATE or DELETE anywhere in code
  id          TEXT PRIMARY KEY,
  bulletin_id TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  actor_uid   TEXT NOT NULL DEFAULT '',           -- '' for system events
  action      TEXT NOT NULL,                      -- draft | edit | sign | retract | source_deleted | signer_add | signer_remove | kill_on | kill_off
  body_hash   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT ''            -- <= 300 chars, never PHI
);
CREATE INDEX IF NOT EXISTS idx_audit_bulletin ON bulletin_audit(bulletin_id, ts DESC);

CREATE TABLE IF NOT EXISTS bulletin_signers (     -- who may sign; owner-confirmed identity (section 6)
  uid         TEXT PRIMARY KEY,                   -- Firebase uid
  name        TEXT NOT NULL,                      -- as on the council register
  reg_no      TEXT NOT NULL,
  council     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  added_by    TEXT NOT NULL,                      -- owner uid
  added_ts    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bulletin_settings (    -- runtime switches that must act without a redeploy
  key         TEXT PRIMARY KEY,                   -- 'enabled'
  value       TEXT NOT NULL,
  updated_by  TEXT NOT NULL DEFAULT '',
  updated_ts  INTEGER NOT NULL DEFAULT 0
);
```

No column has a clinical default. `evidence_type`, `india_status`, `kind`, `source_date` and
`review_months` must be supplied. A missing `bulletin_settings.enabled` row reads as enabled; the kill
switch writes `'0'`.

### 5.2 Canonical hash

`body_hash = sha256(JSON.stringify([kind, headline, what_changed, applies_to, evidence_type, evidence_note,
regulator, india_status, source_label, source_url, source_date, doi, pmid, review_months,
sortedDiseaseIds]))`, computed server-side with `crypto.subtle` in `functions/_bulletin_rules.js`. A fixed
array order means no key-order ambiguity. Disease ids are part of the signed content: remapping a bulletin
to another disease is a clinical change and needs a new signature.

### 5.3 Visibility predicate (single definition, used by the public read and by tests)

```sql
SELECT b.* FROM bulletins b
JOIN updates u ON u.id = b.update_id
WHERE b.status = 'signed'
  AND b.signed_hash = b.body_hash          -- S1/S2: not edited since signing
  AND b.source_hash = u.content_hash       -- S2: source unchanged since drafting
  AND b.review_due_ts > ?now               -- S8
  AND COALESCE((SELECT value FROM bulletin_settings WHERE key = 'enabled'), '1') = '1'   -- kill switch
```

The inner join to `updates` makes a deleted source hide its bulletins (S3). Writes do not need to remember
to reset anything: visibility is derived.

### 5.4 Fix required in existing code for S2

Manual publish and the KV migration write `content_hash: ""` (`[[path]].js:151`, `:315`), so a manual
re-publish that changes the text keeps the same hash and would not void a bulletin. Phase 1 changes the
manual path to compute `content_hash = sha256(title + "\n" + bodyText + "\n" + url)`. The pipeline already
hashes. Existing manual rows keep `""` until their next edit, which is harmless: a bulletin drafted from one
records `source_hash = ""` and the next edit changes it.

`repo.deleteUpdate` additionally sets `status = 'retracted', retract_reason = 'source deleted'` on the
update's bulletins and writes a `source_deleted` audit row, so the queue shows why they vanished.

## 6. Who can sign

**Why a signer registry and not the verified-doctor KV record directly.** `icu:doctor:<uid>` has more than
one shape. The auto-verify path writes `status: "verified"`, `name`, `regNo`, `council`
(`verify-doctor.js:132`); the manual-review path writes `status: "pending"` with `extractedName`,
`extractedRegNo` (`verify-doctor.js:528`), and an owner's later approval sets the Firebase claim without
necessarily rewriting that record. `claims.regNo` is also absent for some verified doctors (`prescription.js`
`verifiedInfo` falls back to `/api/verify-doctor` for exactly that case). Reading identity straight from KV
would either lock out a manually approved owner or tempt a loose fallback. A small registry the owner
confirms once is exact and auditable, and it is also how signing widens to other doctors later (D1).

`functions/_bulletins_auth.js` exports `signerIdentity(request, env)`:

1. `verifiedClaimsFor(request, env)` (Firebase ID token). **`X-Admin-Token` is never accepted** for any
   bulletin write: a shared token proves no identity, so it cannot back a signature.
2. `claims.verified === true` and `claims.traineeVerified` not set (a live check: revoking a doctor's
   verification revokes their signing).
3. `bulletin_signers` has an `active = 1` row for `claims.sub`.

Result: `{ uid, name, regNo, council }` from that row, the only source of `signed_*` fields. Any failure
returns `null` and the route answers 403 with a reason code (`not-signed-in`, `not-verified`, `trainee`,
`not-a-signer`) so the UI can say what to fix.

**Managing signers** (owner only, Firebase login with an owner email, token refused):
`POST /api/updates/bulletins/signers { uid, name, reg_no, council }` and
`POST /api/updates/bulletins/signers/:uid/deactivate`. The Review Desk form pre-fills from whichever shape
of `icu:doctor:<uid>` exists; the owner checks the values against the NMC register before saving. Adding and
removing are audited. Deactivating a signer does not unsign their past bulletins (that is a retraction
decision, made per bulletin).

## 7. API

All routes live in `functions/api/updates/[[path]].js` under `head === "bulletins"`, in a block placed
**before** the existing owner gate at line 228. The signer block does its own `signerIdentity` check and
returns before control can fall through to `ownerOK`, which would accept the admin token. SQL lives in a new
`functions/_bulletins_repo.js`; validation, hashing and the render-safe projection in
`functions/_bulletin_rules.js` (pure, unit-testable).

| Method and path | Who | Behaviour |
|---|---|---|
| `GET /api/updates/bulletins` | public | `{ enabled, v, items }` of visible bulletins only (5.3), projected to display fields plus `disease_ids`. No uids, no drafts. `ETag` = sha256 of ids + `updated_ts`; `If-None-Match` gives 304. `Cache-Control: public, max-age=300`. Cap 500 rows. Kill switch on (D1 setting, or env `BULLETINS_OFF=1` as a second layer) returns `{ enabled:false, items:[] }`. No DB: `{ enabled:false, items:[] }`. |
| `GET /api/updates/bulletins/me` | signed-in | `{ canSign, reason, name, regNo }` for UI gating. |
| `GET /api/updates/bulletins/queue` | signer | Groups: `source_changed`, `review_due` (within 30 days or past), `drafts`, `signed`, `candidates` (updates of the last 90 days with no bulletin, types safety_alert, drug_approval, guideline, trial). Each draft carries its `body_hash`. |
| `POST /api/updates/bulletins` | signer | Create (no `id`) or edit a draft or signed bulletin. Validates (8.1), stores `source_hash` from the current `updates.content_hash`, recomputes `body_hash`. Editing a signed bulletin sets `status='draft'` and clears `signed_*` on the row (the audit keeps them). Returns the row. |
| `POST /api/updates/bulletins/:id/sign` | signer | Body `{ body_hash, checklist: { source_read, numbers_match, india_checked, own_words } }`. 400 if any checklist item is not `true`. One conditional statement does the check and the write (below); 0 rows changed gives 409 `changed` or `source_changed` (re-read to tell which). Sets `signed_*` from `signerIdentity`, `signed_hash = body_hash`, `review_due_ts = now + review_months`, `status='signed'`. |
| `POST /api/updates/bulletins/:id/retract` | signer | Body `{ reason }`, 10 to 300 chars. Sets `status='retracted'`. |
| `POST /api/updates/bulletins/kill` | owner (Firebase) | Body `{ on: true \| false, reason }`. Writes `bulletin_settings.enabled`. Takes effect on the next request, no redeploy (a Pages env var change needs a new deployment, which is why the env var is only the second layer). |

**No check-then-write races.** Signing is a single conditional `UPDATE`:

```sql
UPDATE bulletins SET status='signed', signed_hash=body_hash, signed_uid=?, signed_name=?, signed_reg=?,
       signed_council=?, signed_ts=?now, review_due_ts=?now + review_months * 2629800000, updated_ts=?now
WHERE id=? AND body_hash=?previewed
  AND source_hash = (SELECT content_hash FROM updates WHERE updates.id = bulletins.update_id)
```

The audit row is written in the same D1 `batch` with `INSERT ... SELECT ... FROM bulletins WHERE id=? AND
signed_ts=?now AND signed_uid=?`, so it exists only if the sign actually happened. Every other write follows
the same pattern: state change and audit row in one batch, audit conditioned on the change.

## 8. Validation and wording

### 8.1 Server validation (`_bulletin_rules.js`)

- Lengths as in 5.1; trimmed; control characters stripped.
- Enums for `kind`, `evidence_type`, `regulator`, `india_status`; `review_months` in {6, 12, 24}.
- `source_url` must parse as `https:`; `source_date` must be a real date not in the future.
- 1 to 5 disease ids, each present in the generated `functions/_kb_disease_ids.js` (8.2).
- App-facing text: reject an em-dash (house rule) with a message naming the field, rather than rewrite the
  doctor's words silently.
- `update_id` must exist.

### 8.2 Disease ids on the server

`kb/tools/build-disease-ids.mjs` writes `functions/_kb_disease_ids.js` (a frozen array of the 4,804
`KB_ENRICHMENT.byId` keys, about 122 KB) from `kb/dist/kb.enrichment*.js`. It runs as part of
`kb/tools/build-all.mjs`. A unit test fails if the checked-in list differs from the current KB, so a KB
rebuild cannot leave the server validating against stale ids. A bulletin mapped to an id later removed from
the KB is listed under "Orphaned" in the queue and is ignored by the client, which only renders ids it knows.

### 8.3 What the card says (rendered by code, not stored)

```
[Safety alert | New approval | Guideline change | Trial result]          <source_date>
<headline>
<what_changed>
Applies to: <applies_to>
In India: Approved by CDSCO | Not yet approved in India | Not applicable | India status not confirmed
Evidence: <evidence_type label><, evidence_note>
Source: <source_label> (link)
Reviewed by Dr <signed_name>, Reg. No. <signed_reg>, <signed_council>, on <signed date>. Review due <month year>.
Check your local protocol before acting.
```

"Not yet approved in India" and "India status not confirmed" render in the amber caution style. The footer
line is fixed in code (S4). Links render only for `https:` URLs and open through the same external-link path
the bell feed detail uses. The card is a `<section aria-label="Practice update">`, not `role="alert"`, so a
screen reader does not interrupt the doctor every time a disease opens.

## 9. Client

### 9.1 `bulletins.js` (new, ES5 IIFE, exposes `window.SMD_BULLETINS`)

- **Flag:** `smd_kb_bulletins`, default off. `?bulletins=1` or `localStorage smd_kb_bulletins = "1"` turns it
  on, `?bulletins=0` forces off. Same shape as `review-desk.js:77`.
- **Sync:** when the flag is on and the device is online, on launch and on resume, at most every 6 hours:
  `GET (window.SMD_API_BASE || "") + "/api/updates/bulletins"` with the stored ETag. The base prefix is required:
  the native app serves `www/` locally, so a bare `/api/...` would not reach the server (same pattern as
  `account.js` `apiUrl`). `sw.js` already never caches `/api/` (line 94), so the service worker cannot mask a
  retraction. Store `{ fetchedAt, etag, items }` in `localStorage smd_kb_bulletins_v1`
  (try/catch on every read and write). A response with `enabled:false` clears the cache (kill switch reaches
  every device on its next sync).
- **Offline:** render from cache only if `fetchedAt` is within 7 days (decision D4) and the item's
  `review_due_ts` is in the future. This bounds how long a retracted bulletin can survive on a device that
  never comes online. Older cache: no cards, and one muted line in their place, "Practice updates not shown:
  last synced <date>. Connect to refresh." (S11: silence would read as "nothing has changed").
- **No bulletin for this disease:** render nothing at all. Never "No new updates" (S11).
- **`html(diseaseId)`:** filters by `disease_ids`, drops ids not in `KB_ENRICHMENT.byId`, sorts safety first
  then `source_date` desc, takes 3, escapes every field, returns the card markup. Pure and synchronous.
- **`card(bulletin)`:** the single renderer, also used by the Review Desk preview (S1: the signer previews the
  exact markup the bedside shows).

### 9.2 Hook in `reasoning.js`

One line in `openDiseaseRef` (`reasoning.js:3548`), inserting
`(window.SMD_BULLETINS ? SMD_BULLETINS.html(id) : "")` immediately before `mgmtHtml` in the `#dxMgmt`
template. No other change to the reader. Styles go in `knowledge-library.css` (the reader's stylesheet),
using its existing tokens; `?v=` tokens bumped for every changed file.

### 9.3 Review Desk

- A fourth tab, "Clinical updates", shown only when `/bulletins/me` returns `canSign:true`. Other reviewers
  see the desk exactly as today.
- Unlike the other three kinds (local decisions exported as JSON, applied by `scripts/apply-reviews.mjs`),
  this tab talks to the server, because a signature must be attested by the server to mean anything. This
  departure is logged as a decision (section 12).
- Queue order: Source changed, Review due, Drafts, Candidates, Signed, Orphaned.
- Source changed: shows what changed in the source (the pipeline's `update_versions.whats_changed_json` when
  present, otherwise old and new source summary side by side), then the bulletin. If it still holds, the signer
  re-signs through the same checklist; if not, edits or retracts. This keeps fail-closed cheap to recover from.
- Signers (owner only): list, add from a pre-filled form (section 6), deactivate. Kill switch toggle with a
  required reason.
- Editor: source panel on top (update title, organisation, date, official link, the pipeline's AI summary
  labelled "AI summary, not reviewed"), then the fields with character counters, a disease picker searching
  `KB_ENRICHMENT.byId` (chips, 1 to 5), required selects, and a live preview from `SMD_BULLETINS.card`.
- Sign: a sheet showing the preview, the four checklist items (all required: I read the primary source; every
  number matches it; India status checked; written in my own words), and "Sign as Dr <name>, Reg. No. <regNo>". A 409 reloads the item and says "The text changed. Review it again before signing."
- Retract: reason required.

## 10. Testing (per CLAUDE.md: unit AND headless browser before claiming anything works)

### 10.1 Unit, `test/bulletins.test.mjs`

Uses the `node:sqlite` D1 shim pattern from `test/ai-counters-d1.test.mjs`; run with `npm test`.

- Schema: `updates_schema.sql` alone and `updates_schema.sql` + `migrate_bulletins.sql` produce identical
  tables; the migration runs twice without error.
- Auth: admin token only gives 403 on every bulletin write, signer management and the kill switch; no token,
  unverified claim, trainee claim, and verified doctor not in `bulletin_signers` (or deactivated) each give 403
  with the right reason; an active signer passes; a non-owner signer cannot add signers or use the kill switch.
- Identity: `signed_name` and `signed_reg` come from `bulletin_signers` even when the body sends other values.
- Races: two sign calls with the same previewed hash, one after an intervening edit: exactly one succeeds, and
  exactly one `sign` audit row exists. A failed sign writes no audit row.
- Review due: set at signing from `review_months`; a draft saved weeks earlier still gets the full interval.
- Kill switch: setting `enabled='0'` empties the public list on the next request and writes an audit row;
  env `BULLETINS_OFF=1` does the same.
- Sign what you see: a stale `body_hash` gives 409 `changed`; a source hash change gives 409 `source_changed`;
  a missing checklist item gives 400.
- Visibility: signed then edited is hidden; source `content_hash` changed by the pipeline is hidden and listed
  under `source_changed`; past `review_due_ts` is hidden; retracted is hidden; deleted update gives a
  retracted bulletin plus a `source_deleted` audit row.
- Manual re-publish of the same URL with new text changes `content_hash` (5.4 fix).
- Public projection has no `signed_uid`, `created_uid` or draft rows; `BULLETINS_OFF=1` returns
  `enabled:false`; matching `If-None-Match` gives 304.
- Validation: each enum, length limit, non-https URL, future `source_date`, unknown disease id, 0 or 6 disease
  ids, and an em-dash are rejected.
- Audit: every write adds exactly one row, in the same batch.
- Drift: `functions/_kb_disease_ids.js` equals the current `KB_ENRICHMENT.byId` keys.

### 10.2 Headless browser, `test/run-bulletins-ui.mjs`

Same harness style as `test/run-library-discover-ui.mjs`, with `/api/updates/bulletins` intercepted.

- Flag off: no card and no request to `/api/updates/bulletins`.
- Flag on: card appears above "Management / Treatment" for a mapped disease; a disease with no bulletin shows
  no card and no "no updates" text; safety sorts
  first; at most 3; India caution line styled amber; widths 320, 390, 768 without horizontal overflow.
- Cache 8 days old: no cards, the "not shown, last synced" line renders. Network blocked with a fresh cache: card renders. `enabled:false`
  response: cache cleared, card gone.
- A `javascript:` URL in the cache renders as text, not a link. Unknown disease id is ignored.
- The sync request goes to `SMD_API_BASE` + path when `SMD_API_BASE` is set.
- Review Desk: `canSign:false` hides the tab; `canSign:true` shows it; preview markup equals the bedside card
  markup for the same bulletin; sign with an unticked checklist is blocked; a 409 shows the re-review message.

### 10.3 Device

After `build-www`, `cap sync` and a native build: verify the running bundle's `?v=` token through the WebKit
proxy (CLAUDE.md, iOS section), then open a mapped disease with `?bulletins=1`. Stage the whole flow before
installing: a reinstall wipes device data, including SURGX notes.

## 11. Phase 2 sketch (not built now; recorded so phase 1 fits it)

- Ingestion only ever creates `updates` rows and appears under Candidates. Nothing reaches the bedside
  without the phase 1 signing path.
- Approvals: openFDA `drug/drugsfda.json` filtered on original submissions with an approved status in the
  window, not `drug/label.json` (label revisions are mostly generic relabels). Safety: FDA Drug Safety
  Communications through the existing RSS parser. India: CDSCO approval lists, to pre-fill `india_status`
  as a suggestion. Verify every query against the provider's docs before building.
- Literature: extend the existing `litapi` (Europe PMC) sources with trial and guideline queries rather than
  add a PubMed parser; if PubMed is added, use E-utilities `reldate` with `datetype=pdat` and fetch abstracts.
- AI draft: optional "Draft from source" filling the editor from the abstract or label text only, labelled as
  a draft, never auto-signed, numbers highlighted for the signer to check against the source.
- Bell feed: a "Reviewed" chip on news items that have a signed bulletin.

## 12. Rollout and rollback

1. Owner approves this plan and decisions D1 to D5. After PR A is live, the owner adds themselves as the first
   signer from the Review Desk form, checking name, registration number and council against the NMC register. Log them in `vault/decisions/Decisions.md` (dated
   heading, decision, why, trade-off, status), including the Review Desk server-backed departure. Tag a
   recovery point `pre-bulletins` on `main`.
2. **PR A, server:** migration, `_bulletin_rules.js`, `_bulletins_repo.js`, `_bulletins_auth.js`, routes,
   5.4 fixes, `_kb_disease_ids.js` plus generator, unit tests. Owner applies the migration:
   `wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_bulletins.sql`. Live on push but
   invisible: no client reads it yet.
3. **PR B, client:** `bulletins.js`, the `reasoning.js` hook, the Review Desk tab, CSS, `?v=` bumps, UI tests.
   Flag default off. Ships through build-www and OTA staging.
4. Owner signs 5 to 10 real bulletins on device and checks them in the reader with `?bulletins=1`.
5. A second doctor reads those 10 cards for wording and safety (S4, S5) before any wider exposure.
6. Default-on is a separate one-line commit, made only after owner approval.

Rollback, fastest first: kill switch from the Review Desk (next request, no redeploy; devices clear their copy
on next sync); env `BULLETINS_OFF=1` in Cloudflare Pages (needs a redeploy);
retract individual bulletins; flag default off; revert PR B; revert PR A (tables left in place, unused).

Rough effort: PR A 1.5 days, PR B 2 days, device verification and review 1 day.

## 13. Why the previous spec and migration were dropped

- `0002_updates_signoff.sql` gave every existing row `evidence_grade 'GRADE 1B'` and `trial_phase 'Phase III
  RCT'` by default, is not re-runnable, and was not mirrored in `updates_schema.sql`.
- Its sign-off route called `ownerOK(context)` without `await` and with the wrong arguments, so it never
  rejected anyone; it took the signer's name and registration from the request body.
- Nothing set `disease_id`, and the client cache read the bell feed, which does not return `verified` or
  `disease_id`, so no bulletin could ever display.
- Its Review Desk code treated `verifiedInfo()` (a Promise returning `{ verified, regNo }`) as synchronous with
  a `name` field, and sent no auth header.
- `window.SMD_FLAGS` does not exist in this codebase.
- Its revision `4c268847` fixed the await and the defaults but still let any verified app user sign, let the
  admin token sign as "Platform Owner (OWNER)", and kept `verified` on the `updates` row, so a crawler rewrite
  of that row would show new text under the old signature. Its branch is based on `5174f08f`, so checking its
  `vault/decisions/Decisions.md` out over a newer tree would delete later decision entries; the decision entry
  for this feature is written fresh when D1 to D5 are settled.

## 14. Owner decisions (recommended default first)

| # | Question | Recommended | Alternative |
|---|----------|-------------|-------------|
| D1 | Who can sign? | **Decided:** the owner, and verified doctors the owner adds to `bulletin_signers` | |
| D2 | Bell feed in phase 1? | **Decided:** unchanged (news with source links) | |
| D3 | Default review interval | **Decided:** 12 months; signer may pick 6 or 24 | |
| D4 | Offline cache max age | **Decided:** 7 days | |
| D5 | Signatures per bulletin | **Decided:** one | |
