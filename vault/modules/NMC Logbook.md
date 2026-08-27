---
tags: [module, education, regulatory]
flag: smd_pglog
default: ON (testers)
status: built, flag-ON for testers, R1 run 2026-08-27 (NO-GO -> fixed)
built: 2026-08-27
---
# NMC Logbook — the PG digital logbook

The e-logbook **PGMER-2023 §5.2(v)–(vi) requires every Indian PG resident to maintain**: updated
weekly, authenticated monthly by the postgraduate guide. Phase 1 is **PG only**. UG/CBME is
deliberately **not built** — the engine carries `programmeType` so it can be added without a rewrite.

> **The authority for every regulatory claim is `NMC_PG_LOGBOOK_REQUIREMENTS.md` at the repo root.**
> It maps `NMC source → clause → verbatim quote → digital feature → evidence → verification → report`
> for every requirement the module implements. If a requirement appears in a pack and not in that
> file, it is a bug. Read it before changing anything here.

## The one sentence that explains the design

A PG logbook entry is a document a University examiner relies on, and **PGMER-2023 §9.2(c) puts a
monetary penalty on the named faculty / HoD / Dean who submits a false record**. So the guarantees
are throws at the data layer, not disabled buttons.

## Flag + default

| Flag | Def | What it does |
|---|---|---|
| `smd_pglog` | **ON** | Master. Off = a COMPLETE no-op (no root, no fetch, no CSS). Same tester rationale as `smd_clinix` / `smd_surgx`. |
| `smd_pglog_server` | ON | `/api/pglog` sync. Off = on-device drafts only, and the UI says so. |
| `smd_pglog_ai` | ON | MaiK assist. Advisory only — see [[#AI]]. Off changes no number. |
| `smd_pglog_faculty` | ON | Faculty / HOD / Academic-Cell surfaces (server still cap-gates). |
| `smd_pglog_attendance` | ON | §5.6 attendance records. |
| `smd_pglog_reports` | ON | The 11 reports. |
| `smd_pglog_demo` | **OFF — NEVER SHIP ON** | Seeds **fabricated** residents, entries and verifications locally. Fabricated verified records in an official training logbook are precisely what §9.2(c) penalises. Local-only; the server has no demo path. |
| `smd_pglog_verify_sla_days` | 7 | **CONFIG, not NMC.** NMC's only cadence is monthly authentication. |
| `smd_pglog_attest_grace_days` | 7 | CONFIG, not NMC. |

## Key files

| File | What it is |
|---|---|
| `pglog-model.js` | **THE PURE CORE.** Entities, the verification state machine, progress/cadence, attendance, exam checklist, assessment scoring, PHI scrubbing. Imported by the server too — the rules exist once. |
| `pglog-curriculum.js` | Pack registry, flatten/resolve, the **deterministic** requirement matcher. |
| `pglog/curricula/*.json` | 15 specialty packs + 2 common packs + a PGMER-only fallback. Data, not code. |
| `pglog/specialties.json` | **Generated from PGMER Annexure-1/-2**: all 84 recognised qualifications → pack id. `scripts/build-pglog-specialties.mjs`. |
| `pglog-sources/` | The extracted text of 18 NMC PDFs. Test fixtures + audit trail, NOT bundled. |
| `pglog/assessment-templates.json` | DOPS / shift WPBA / clinical WPBA / appraisal, taken from the NMC proformas. |
| `pglog-store.js` | Client: account-scoped local drafts, offline queue, API. |
| `pglog-screens.js` | Router + every screen (resident / faculty / HOD / Academic Cell). |
| `pglog-reports.js` | 12 pure report builders + print/CSV + `certifiedLogbook`/`certifiedDocHtml`/`exportCertifiedPdf` (the document that leaves the app). |
| `pglog-ai.js` | Advisory assist. Two of its six functions are pure and have no AI at all. |
| `functions/_pglog_store.js` | Firestore I/O + the org-RBAC gate + `publicEntry()` (the privacy boundary). |
| `functions/_pglog_signer.js` | **THE SIGNING GATE.** Nobody signs without a verified medical-council registration. Reads the existing `/api/verify-doctor` result; never re-implements it. Fails closed. |
| `functions/_pglog_verify.js` | The HMAC-signed verification code behind every QR + supersede-on-amend. **`payloadFor()` is the single definition of what a signature covers.** |
| `functions/_pglog_public.js` | The one definition of what a verification DISCLOSES. Both the JSON route and the HTML page resolve through it. |
| `functions/pglog/v/[code].js` | The page an examiner lands on. Server-rendered, no JavaScript, strict CSP, noindex. |
| `pglog-qr.js` | Our own ISO/IEC 18004 QR encoder (byte mode, v1-10). No dependency, no image service. `toSvg` for the app, `toTableHtml`+`tableCss` for the PDF. |
| `functions/_pglog_templates.js` | **Generated.** The server's own scoring contract, so a forged client template cannot inflate a mark. |
| `functions/api/pglog/[[path]].js` | The API router. |
| `scripts/build-pglog-curricula.mjs` | Emits the packs. **Add a new specialty here**, never by hand-editing JSON. |
| `scripts/build-pglog-templates.mjs` | Regenerates `_pglog_templates.js` from the JSON. |

## The invariants (and where they are enforced)

All in `pglog-model.js`, so they hold for the UI, the API and any future importer:

1. `verify()` **throws** if the actor is the entry's author. Namespace-tolerant (`fb:` / raw / case).
2. `returnEntry()` throws on an empty reason.
3. `applyEdit()` throws on a `verified` entry.
4. `amend()` snapshots the whole prior document into `revisions[]`, then re-opens verification.
5. `softDelete()` throws on a `verified` entry. Deletion is never hard.
6. `assess()` throws if the assessor is the assessee, or on a partially-scored form.
7. Attestation ids are deterministic + `wCreate` — **a month can be signed exactly once.**

**Two independent locks on "a resident cannot approve their own record":** `pg_resident` holds no
`PGLOG_VERIFY` cap at all, *and* the model throws. Neither alone is trusted.

## RBAC

Extends the **existing** `functions/_queue_roles.js` — no parallel permission system. New caps
`PGLOG_*`; new roles `pg_resident`, `pg_faculty`, `pg_hod`, `academic_cell`. Membership + scope come
from the existing `q_members` + `authorizeOrgAccess()`.

**`admin` is deliberately NOT granted verify/assess/attest** — the same separation the ONCQIS
approval caps already use. Signing a trainee's clinical record is not a technical-admin power.

## Privacy — the thing to not break

This is an educational logbook, **not a second EMR**.

- The entry schema has **no field** for a patient name, phone, address or Aadhaar.
- `sanitizeCaseRef()` strips a name / mobile / Aadhaar / email typed into the case-reference box,
  **on write, server-side too**. It keeps MRN-shaped tokens.
- Age is a **band**, never a DOB.
- `publicEntry(e, audience)` is the boundary. `self` / `verifier` / `hod` see clinical detail;
  **`aggregate` (Academic Cell, department summary, every export) sees counts and categories only.**
- Notifications and audit rows carry ids and kinds, never a case reference or a diagnosis.

## AI

`pglog-ai.js`. Advisory, labelled, and structurally unable to do the forbidden things:

- Suggestions are filtered against the **resolved pack** — an id not in it is dropped. The AI cannot
  mint a requirement.
- **No function creates, edits, submits or verifies an entry.** `pglog-store.saveDraft` is not imported.
- Progress is computed from **verified entries only**, by pure code.
- `incomplete()` and `reminders()` are **pure, with no AI at all** — a reminder about a regulatory
  deadline must be right, not plausible.

## R1 outcome — 2026-08-27

R1 returned **NO-GO** on the first cut and found 7 critical + 9 important defects. All are fixed; the
full list with before/after is **`NMC_PG_LOGBOOK_REQUIREMENTS.md` §12**. The five worth carrying in
your head:

1. **A 77-day District Residency counted as "three months"** — the check was `months >= 2.5`, a
   tolerance from nowhere. The floor is now **89 days** (the shortest real three calendar months).
2. **Statutory leave was deducted from attendance** under a §5.6 badge — 90 days of maternity leave
   read as 47%. §5.6 *grants* that leave. Permitted leave now counts; what counts is institutional
   config reported separately from the regulation's 80%.
3. **Any faculty member could read any resident's full record** — both branches of the read guard
   returned `verifier`. Assigned now means guide, co-guide, or the supervisor named on that entry.
4. **The Emergency Medicine pack shipped 64 of 81 NMC minima** behind a complete-looking checklist.
   All 87 entries now ship.
5. **The test that was supposed to catch (4) could not.** It compared each procedure count against a
   quotation the generator had built *from that count*. See the next section.

## The provenance test — read this before touching a pack

`pglog-sources/` holds the **extracted plain text of every NMC PDF** (868 KB, checked in, deliberately
outside `pglog/` so `build-www.sh` never bundles it). `test/pglog-provenance.test.mjs` checks **every
quotation and every number in every pack against it**. A claim that is not in the source fails the
build.

That test found four things R1's spot-check did not: the shared 2022 pack dropped "the" from "from
**the** Head of Department"; MD Radiodiagnosis says "training **program**", not "programme"; MS OBGY
prints "**clinic**-pathological", which had been silently tidied to "clinico-"; and **MD Pathology
carried a CPC requirement quoting a clause that does not exist in that PDF** — a fabricated
quotation, since deleted.

If you add or change a pack, run it. It will name what does not match.

## THE CLAUSE NUMBERS CHANGED — 2026-08-27. Read this before citing anything.

This module was built against **`LatestNews/MER.pdf`**, whose own first line reads
*"[To be published in the Gazette of India…]"*. It is the **pre-publication draft**. The
**published gazette** (`CG-DL-E-03012024-251108`, 29 Dec 2023) numbers the clauses differently
**and words some of them differently**.

| | Draft (old citations) | **Gazette (correct)** |
|---|---|---|
| e-log book, weekly | 5.2(v) | **5.2(vi)** |
| Monthly guide authentication | 5.2(vi) | **5.2(vii)** |
| UG teaching | 5.2(vii) | **5.2(viii)** |
| Activity types | 5.2(x) | **5.2(i)** |
| Academic Cell | 5.2(iii) | **5.2(iv)** |
| Thesis research | *absent* | **5.2(iii)** |
| Research Methodology / Ethics / BCLS | 5.2(xi)(a)/(b)/(c) | **5.2(xi) / (xii) / (xiii)** |
| DRP | 5.2(xii) | **5.2(xv)** |
| Leave + 80% attendance | 5.6 | **5.5** |

Both texts are in `pglog-sources/`; only `PGMER-2023.txt` (the gazette) may be cited, and
`PGMER-2023-DRAFT-prepublication.txt` is marked non-authoritative. Full diff, including the wording
changes, in **§16** of the requirements doc.

**The module is "structured to PGMER-2023 §5.2(vi)–(vii)".** If you see §5.2(v)–(vi) anywhere, it is
stale.

## Competitive position — 2026-08-27

Teardown of **NMC eLogbook** (Neugenic Mediventure, ₹4,999+GST per resident per 3 years) is in
[[competitor-nmc-elogbook-2026-08-27]]. Three things came out of it:

1. **A real bug in ours.** Their faculty field is a roster dropdown; ours was free text, and
   `pendingFor` is a copy of it — so a typo produced an entry that was submitted, counted toward
   nothing and reached nobody. Now resolved against the roster, and refused if unresolvable.
2. **Their compliance citation led to the PGMEB FAQ we could not find**, which **corrected our
   attendance model**: 80% is of WORKING days (939 in three years), not of recorded days. See §14 of
   the requirements doc.
3. **Coverage**: their picker has ~35 departments. Ours is now generated from PGMER Annexure-1/-2 —
   **84 recognised qualifications**, 15 with a real pack, the rest honestly on PGMER-only.

Their "Mandatory Checklist" ships **three** items and omits the Ethics/GCP-GLP and BCLS/ACLS courses,
both of which §5.2(xi) makes examination pre-requisites.

**The one place they are genuinely ahead is onboarding** — a resident self-registers in two minutes;
ours needs the Academic Cell. That is a deliberate trade (verification needs a real guide) but it is
the biggest adoption risk and is an owner decision, not a technical one.

## Signing and the QR — 2026-08-27

**Nobody digitally signs anything in this module without a verified medical registration, and the
registration number is written onto the record they signed.**

PGMER-2023 §5.2(vii) has the logbook authenticated by "the Post-graduate guide"; §9.2(c) attaches a
penalty to the NAMED faculty / HoD / Dean who submits a false record. Both presuppose a registered
practitioner. Before this, the module checked a *capability* — what a role may do — and never whether
the person was on a medical register at all.

`functions/_pglog_signer.js` gates **verify, return, assess, sign-off and the monthly attestation**.
It does not re-implement verification: StewardMD already checks doctors against the **live Indian
Medical Register** via `/api/verify-doctor`, which writes `icu:doctor:<uid>` and sets the `verified`
custom claim. This reads that, and cannot grant it.

- **Fails CLOSED.** KV unreachable *and* the claims lookup throwing gives a 503 that says nothing was
  signed. An outage must never quietly downgrade a regulatory signature.
- **`verified: true` with no registration number is refused.** A signature nobody can check is not a
  signature.
- **De-namespace the uid first** (`rawUid`): the router says `fb:abc`, KV and claims are keyed `abc`.
  Getting that wrong misses every lookup — and before the fail-closed rule it would have failed OPEN.
- The UI (`signerBanner()`) explains *why* the verify button is unavailable. That is a courtesy, not
  the gate. The gate is `signerSnapshot()` throwing on the write path.

**Every signed event mints a code and a QR.** A printed logbook is trusted because a named person
signed it; a PDF of one is trusted because of nothing. `GET /api/pglog/v/<code>` answers
**unauthenticated** — an examiner holding a printout has no account, and requiring one would make the
QR useless to the only person it exists for.

- The code is an **opaque 80-bit handle**, not an encoding of the record. A code on a whiteboard leaks
  nothing.
- The stored record holds an **HMAC-SHA256 digest of a FIXED canonical field list** — never
  `Object.keys()` over a live document, whose key order would change with a schema edit and silently
  invalidate every code ever issued. The digest is recomputed from the live record on lookup, so a
  direct Firestore edit shows **TAMPERED** instead of a green tick over altered content.
- **Tamper-EVIDENT, not tamper-proof**, and **not** a cryptographic signature by the faculty member —
  it is the server attesting to what it recorded. A real per-signer keypair needs key custody we do
  not have. The page says exactly this; do not upgrade the wording without upgrading the crypto.
- **Amending a verified entry supersedes its code.**
- **No `PGLOG_SIGNING_KEY` → no code is issued at all.** An uncheckable "verification code" is worse
  than none, because it looks checkable.
- **Minting a code can never take a signature down with it.** A failure leaves the record signed and
  auditable, with no QR, and the UI says so.
- The public payload is PHI-free by construction: resident name + SMD ID, programme, activity KIND
  and date, signer + registration + council, and whether it still stands. Never the case reference,
  the diagnosis, the remarks or the reflection.

## The security review — 2026-08-27 (R3 + S4). Read this before touching authorization.

Two reviewers, run independently over the signing/QR surface. **Four blocking findings, all fixed.**
Both reviewers independently found the same two authorization holes, which is the part worth
remembering: the module's own comments described boundaries the code did not enforce.

**B1 — every entry QR would have read TAMPERED.** The document written at signing and the document
read back at verification were mapped into the canonical form by two separate lists of field names,
in two files, and they disagreed twice (`verifiedReg` vs `verifiedByReg`, `revisions` vs
`revisionCount`). Every genuine signature would have told the examiner *"This record does not match
what was signed. Do not rely on it."* The tests missed it because both sides were fed a hand-built
payload. Fixed by `V.payloadFor()` — **one definition of what a signature covers, called at both
ends** — plus a round-trip test that signs a real entry and verifies its real code.

**B2 — the URL printed on every QR was not served.** `/pglog/v/<code>` is extensionless, so the site
gate treated it as an anonymous page view and returned the **marketing home page, HTTP 200**. Fixed
by `functions/pglog/v/[code].js` (server-rendered, script-free, strict CSP, noindex) and a
pass-through in `functions/_middleware.js`, with a gate regression test for both halves.

**B3 — any faculty member could sign any resident's entry.** `PGLOG_VERIFY` is an org-wide
capability; PGMER-2023 §5.2(vii) is not an org-wide question. `requireNamedFor()` now demands the
named supervisor, the guide/co-guide, or the HoD — the same shape the attest path already had.

**B4 / C5-again — the Academic Cell and the technical admin read every trainee's clinical detail.**
The read guard tested `PGLOG_VIEW_DEPT` first, and `academic_cell` and `admin` hold that cap too, so
they entered the HoD branch and the `VIEW_INSTITUTION -> aggregate` line below it was **dead code**.
`canReadResident` is now ordered by **named responsibility, not capability breadth**, and there is a
table-driven test (`test/pglog-audience.test.mjs`) enumerating every role against every relationship.
Also: `publicEntry()` was the documented privacy boundary and covered **entries only**, so
assessments (3000 chars of feedback, the remediation plan, every criterion score), attestation notes
and the raw resident record (including the Firebase uid) were serialised next to it unprojected.
`publicAssessment` / `publicAttestation` / `publicResident` now exist and are applied.

Also fixed: `amend` could mass-assign `deleted` (retiring a verified, signed record that
`softDelete()` refuses to touch) — both edit paths now share **one** `SERVER_OWNED` list; the
verification code is a capability and no longer goes to an aggregate audience; `getUserClaims()`
returning `{}` on an outage no longer reads as "not verified"; the rate-limit key no longer falls
back to the client-supplied `X-Forwarded-For`; `PGLOG_OFF` now covers the public endpoint; Firestore
error detail is no longer echoed to clients; the SMD ID is masked on the public page; the free text
sent to the AI is scrubbed of honorific-led names (`scrubForAi`, stored text unchanged); the
department dashboard (~600 reads a call) is rate-limited per caller.

**The rule the two mistakes have in common:** a boundary defined in two places drifts, and the copy
that drifts is the one that leaks. One payload builder, one pinned-field list, one audience function.

## Certification and the exported PDF — 2026-08-27

The module now produces a document that LEAVES the app: a signed, frozen PDF a college, a University
or the NMC can be handed and can check.

**The quorum.** Default **2 faculty + 1 HoD, the HoD counting toward both** — so two distinct people
can complete it. Configurable per programme (`config.certQuorum`), plus an optional `requireGuide`
(default OFF: a guide who has left would otherwise strand their former trainees permanently).

**WHOSE RULE IS WHOSE — the thing not to break.** The **HoD signature is sourced** (2022-revised NMC
curricula, "the completed log book should be signed by the Head of the Department"). The **number of
faculty signatures is the owner's policy and is NOT an NMC requirement**, and both the screen and the
exported document say so in those words. This is the likeliest place in the whole module to launder a
local policy into a regulatory claim, so it is stated on the artefact, not in a help page.

**What makes the document worth anything:**
- It **freezes its content**: `contentDigest` is an HMAC over the exact verified-entry set, each with
  its own signature state, sorted by id (Firestore result order must never flip a certificate to
  tampered). Amend a covered entry and the certificate is **superseded** — its code stops validating
  and the page says why; the certificate and its signatures are retained, never deleted.
- Every signature carries a **registration number** (`_pglog_signer.js` refuses otherwise) and the
  **server decides the signing role from the membership** — a client that could name itself "hod"
  would be the whole quorum on its own.
- It covers **verified entries only**, and prints what it excluded. A certificate that silently
  omitted forty unverified entries would read as a complete logbook.
- Re-derived at issue: if the logbook moved between the request and the last signature, it is
  refused (`pglog_cert_content_changed`) rather than certifying something nobody read.
- Only a **pg_hod** can revoke, and a revocation needs a reason that is shown to anyone who checks.

**What it is NOT, and must never claim to be:** a digitally signed document under the **IT Act,
2000**. No DSC from a licensed Certifying Authority is applied — nobody here holds such a key. The
limitation is printed **on the document**. Upgrade path if it is ever required: a per-faculty DSC
(eMudhra / Capricorn / NIC class 3, or Aadhaar eSign) plus PAdES signing at issue; the certificate
record already pins exactly what would be signed, so nothing in this design has to change.

**The PDF path.** `REP.exportCertifiedPdf()` → `SMD_NATIVE.sharePdfFromHtml` (iOS WKWebView → real
PDF → share sheet), `SMD_PDF.fromHtml` (html2canvas + jsPDF) elsewhere, browser print as the last
fallback. No new dependency.

**The print QR is a TABLE, not the SVG** (`SMD_PGLOG_QR.toTableHtml` + `tableCss`). html2canvas's
inline-SVG support is unreliable and a QR that silently fails to render is worse than none, because
the document still says it is verifiable. It needs an explicit `<colgroup>`: `table-layout: fixed`
sizes columns from the first row, and a QR's first row is all quiet zone — one cell spanning
everything — which leaves the algorithm nothing to read. Class is `pgl-qrt`, deliberately NOT
`pgl-qr` (the in-app block owns that and styles it as a flex card).

**An uncertified export is stamped `NOT CERTIFIED` and carries no QR and no signature block.** There
is no configuration in which the exported document is ambiguous about whether anyone signed it.

## Gotchas

- **Only VERIFIED entries count toward progress.** A resident cannot move their own bar. Submitted
  work is reported separately as `pending` so it does not look lost.
- **A requirement with no NMC number gets no denominator and no progress bar.** Most NMC specialty
  curricula say *"a specified number"* — specified by the department. Inventing a target there is the
  single easiest way to make this module lie.
- **Cadence ≠ total.** "Journal club: once a fortnight" is measured against what is expected *by
  today*, not against the whole course.
- **A matcher with no discriminator matches nothing** — otherwise a `target: 100` requirement
  silently completes itself off unrelated entries. There is a test for this.
- **Attendance has two provenances.** The 80% is PGMER §5.6 (gazette). The 751/501-day figures are
  from the PGMEB FAQ — a **secondary source we could not fetch as a primary PDF**. They carry
  different grades and the UI shows which. Do not merge them.
- **The DRP semester window is a WARNING, not a block.** A State's posting schedule is not the
  resident's to fix, and refusing the record would make the logbook less true.
- **`normalizeCode()` must strip the `PGL` prefix BEFORE folding confusables** — "PGL" contains an
  L, and the folder rewrites L to 1. Reversed, every scanned and every hand-typed code returns empty.
  Order is the whole bug; there is a test.
- **The QR block stays LIGHT in dark mode on purpose.** An inverted QR does not scan reliably.
- **A wrong QR is worse than no QR** — it looks scannable and is not. Every part of the encoder with
  a published reference value is tested against it (GF(256) tables, RS generators, all 32 format
  strings from Table C.1, the version strings from Table D.1). Do not "optimise" it without those.
- **The signature block is NOT in `M.entry()`'s schema**, so every read path must re-attach it —
  `withSignature()` in the store. `getEntry` did and `listEntries` did not, which silently zeroed the
  "verified entries carrying the signer's registration" count in every report and made a
  certificate's content digest flip between request and issue for no visible reason.
- **The faculty COUNT is ours; the HoD signature is the NMC's.** Never let the UI or the document
  blur the two.
- **Order the read guard by NAMED RESPONSIBILITY, never by capability breadth.** `academic_cell` and
  `admin` hold `PGLOG_VIEW_DEPT` as well as their own caps, so any "widest cap first" ordering hands
  them the department branch. This has been got wrong twice; `test/pglog-audience.test.mjs` is the guard.
- **`/pglog/v/*` must stay in the `_middleware.js` pass-through.** Remove it and every printed QR
  silently lands on the marketing page with a 200.
- **Signature content is defined ONLY by `V.payloadFor()`.** Hand-building a payload at either end is
  how every genuine QR once read TAMPERED.
- **Test on port 8994, not 8991.** Another worktree's `serve.mjs` on the shared port silently serves
  *its* copy of the app — that is how this module's UI test once "failed" 48 assertions against code
  it was never looking at. See [[two-claude-sessions-one-folder]].

## Tests

| File | Covers |
|---|---|
| `test/pglog-model.test.mjs` | 65 — every invariant, dates, privacy, progress, cadence, attendance, eligibility, attestation, assessment, + the R1 regressions |
| `test/pglog-provenance.test.mjs` | 18 — **the real one**: every quotation and every number checked against `pglog-sources/`, plus specialty coverage |
| `test/pglog-curriculum.test.mjs` | 29 — pack structure, flatten/resolve, overrides, the requirement mapper |
| `test/pglog-certificate.test.mjs` | 20 — the quorum, what a signature covers, and that a draft export can never look certified |
| `test/pglog-audience.test.mjs` | 8 — the audience matrix: every role x every relationship, and what each audience discloses |
| `test/pglog-public.test.mjs` | 13 — the unauthenticated verification page: what it says, what it refuses to say, escaping, headers |
| `test/pglog-qr.test.mjs` | 22 — the encoder against ISO/IEC 18004 reference values + code normalisation |
| `test/pglog-server.test.mjs` | 76 — store flow against an in-memory Firestore, RBAC, the privacy projection, exactly-once attestation, the server template contract, + the R1 regressions |
| `test/run-pglog-ui.mjs` | 68 — real headless Chrome: flag-off no-op, mount, drafts offline, provenance rendering, packs over HTTP, reports, navigation |

Run: `node --test test/pglog-*.test.mjs` and `node test/run-pglog-ui.mjs`.
**251 unit assertions + 68 browser assertions, all green.** Full repo suite: 423 files, 0 failures.
`test/run-gate-middleware.mjs` also covers the public verify path (and two of its assertions were
stale against the web-app-killed middleware; fixed).

Note: two repo tests (`followcare-voice-server`, `opd-mrn-alloc`) need `node --experimental-test-module-mocks`,
which `npm test` passes and a bare `node --test test/*.test.mjs` does not. They are unrelated to this module.

## Status / what is NOT done

- **R1 was run on 2026-08-27** (NO-GO, all findings fixed — §12 of the requirements doc). A
  **re-review** is owed before a non-tester release, since the fixes have not themselves been
  reviewed. R1 also recommended chaining `stewardmd-security-reviewer` for the C5 read-guard fix
  — **done 2026-08-27** (R3 + S4, see the security section above; 4 blocking findings, all fixed).
  **The security fixes have not themselves been re-reviewed**, and the C5 read guard was wrong twice.
- **Native rebuild not done.** Web deploys do not reach installed apps ([[Native app delivery]]).
- ~~PGMEB FAQ not obtainable~~ — **obtained 2026-08-27**, and it corrected the attendance model
  (80% is of WORKING days). §14 of the requirements doc.
- ~~PG-MSR is a scanned image~~ — **obtained 2026-08-27**. It specifies no logbook content; the one
  per-resident figure in it (OT training ≥2 full days/week, surgical specialties) is now a
  requirement, reconstructed from a table with `sourceFragments`.
- **~20 broad specialties and all DM/M.Ch have no pack** — they fall back to `generic-pg`, which
  carries the PGMER requirements and *says* no specialty pack is loaded.
- **`PGLOG_SIGNING_KEY` is not provisioned yet.** Until it is set on the Pages project, signatures
  still work and are still gated on registration, but **no QR or verification code is issued** — by
  design. `PGLOG_VERIFY_BASE` optionally overrides the printed domain.
- **Certification is built but not exercised on a device.** The PDF path reuses the existing
  `sharePdfFromHtml` bridge; it has been verified in headless Chrome (layout, QR uniformity,
  self-containment) but not through a real iOS share sheet.
- **UG/CBME not built**, by instruction.

## Adding a specialty

1. Fetch the NMC curriculum PDF, extract the logbook / assessment / procedure clauses.
2. Add the pack to `scripts/build-pglog-curricula.mjs` with a **verbatim quote per requirement**.
3. `node scripts/build-pglog-curricula.mjs`
4. `node --test test/pglog-curriculum.test.mjs` — it will refuse any number that is not in its quote.
5. Add the source row to `NMC_PG_LOGBOOK_REQUIREMENTS.md` §10.
