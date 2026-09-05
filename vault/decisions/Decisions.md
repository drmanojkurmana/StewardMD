---
tags: [decisions, adr]
---
# Decisions

Dated architectural calls + why. Newest first. Keep each short: **decision · why · trade-off · status**.

## 2026-09-04 · ICD Search — shipped default-on, no flag, from the first commit

**Ask:** "now integrate ICD also and add a Search ICD button and add ICD integration into EMR/icu
ward & OPD" — then, when asked which edition, "ICD 10 & 11" (both).

**Decision:** built as a new module (`icd.js`/`icd.css`/`functions/_icd_repo.js`/`functions/api/icd/`,
D1 `stewardmd-icd`) carrying no feature flag at all, applying the owner's earlier "no more
flagging" instruction (see the Scheme Search entry below) from the start rather than shipping
gated-then-flipping. 106,367 codes loaded (71,704 ICD-10-CM + 34,663 ICD-11 MMS), both from public
WHO/CMS downloads, no API credentials needed — see `scripts/icd/README.md` for exact provenance.

**Trade-off:** ICD-10 here is the US ICD-10-CM edition (most complete freely-downloadable
machine-readable set), not the plainer WHO 4-character ICD-10 — documented explicitly so the
extra granularity doesn't surprise anyone. ICD-11 is WHO's own public "Simple Tabulation" export,
current as of WHO's 2024-01 release (not the live API, which needs registered credentials).
**Status: shipped.** See `vault/modules/ICD Search.md`.

## 2026-09-04 · Scheme Search (renamed from Government Health Schemes) — owner overrode the review gate, flag defaults ON for all devices

**Owner's explicit order** (verbatim intent): stop flagging this module behind a per-device toggle;
it should be open for everyone, on every device, by default, effective immediately.

**Decision: reverses the 2026-09-02 "admin review pass before default ON" gate below.**
`smd_govt_schemes` now defaults `true` in `govschemes-flags.js` (was `false`); all 29
`scheme_versions` rows were bulk-promoted `draft` → `active` in the remote D1
(`stewardmd-govschemes`) to match. A device can still force it off with `?gs=0` or
`localStorage smd_govt_schemes=0`, but no further review pass gates default visibility.

**Trade-off, stated plainly:** the per-jurisdiction data quality varies (see
`vault/modules/Government Health Schemes.md` — some states have codes/names but no verified
amounts, e.g. Arunachal Pradesh; some have partial coverage, e.g. Meghalaya IPD). This is now
live to every clinician by default rather than opt-in. **Status: shipped per direct owner
instruction, superseding the earlier default-off decision.**

## 2026-09-02 · Government Health Schemes Phase 1 — schema mirrors Medical Updates, not a new pattern

**Ask:** a national database of every state/UT/central government health-assurance scheme (packages,
native codes, rates, eligibility), searchable by disease/procedure/code, versioned, with full
source provenance. Explicitly told to build a NEW data domain from scratch, India-wide, no
reduced scope.

**Decision: reuse the Medical Updates module's shape rather than inventing one.** Before writing any
schema, read `functions/db/updates_schema.sql`, `functions/_updates_repo.js`, `worker/schema.sql`
(Drugs DB), `onco-protocol-review.js`, `functions/_adminauth.js`, and `*-flags.js` — this repo already
solves "versioned external-document data with provenance" once (Medical Updates: `sources` →
`updates` → `update_versions` → `crawl_logs`) and "structured dataset with fast search" once (Drugs
DB: flat table + FTS5 + sync triggers). `functions/db/govschemes_schema.sql` mirrors both directly:
`jurisdictions` / `sources` / `schemes` / `scheme_versions` / `packages` (+ `packages_fts`, same
FTS5-with-triggers shape as `drugs_fts`) / `crawl_logs`, plus a `clinical_concepts` /
`clinical_synonyms` / `concept_package_map` shape reserved now (empty in Phase 1) so Phase 2's
clinical crosswalk needs no migration later.

**Versioning granularity: per scheme_version, not per package row.** A government package master is
published as a whole replacement document (one XLSX/PDF), never as an incremental diff — so the
version boundary is the scheme_version (one row = one published document), and `packages` rows
belong to exactly one `scheme_version_id`. Re-importing a scheme creates a NEW scheme_version;
the old one's rows are never touched. This is simpler than per-row temporal versioning and matches
how the source data actually arrives.

**Native-key discovery from the real first dataset** (Dr. NTR Vaidya Seva Trust workbook, Andhra
Pradesh — 3,713 rows, 32 speciality codes, confirmed by direct parse): a `treatment_code` alone is
NOT unique — 332 codes are legitimately reused across different specialities (e.g. `S11.36.3` appears
under Cardiothoracic Surgery, ENT, and General Surgery, each a distinct package with its own amount).
The real natural key is `(scheme_version_id, speciality_code, treatment_code)` — confirmed zero
collisions on that triple. Documented as a schema comment so a future importer doesn't "fix" the
apparent duplicates by dropping rows.

**Trade-off: admin review workflow deliberately NOT the two-gate ONCQIS pattern (yet).**
`onco-protocol-review.js`'s DRAFT→R1_REVIEW→INSTITUTIONAL_APPROVAL→ACTIVE state machine with
per-field accept/reject/edit/verify and a blocking "VERIFY" flag is the strongest precedent for
"Upload source → Analyze → Review → Publish," and Phase 3 should adopt its `changeRecords`/audit/
diff shape for scheme updates. Phase 1 instead follows Medical Updates' lighter flow (AI-assisted
classify → human eyeballs an on-screen draft → single admin publish) — correct for getting the
foundation running, not correct as the final production review gate for financial/eligibility data
patients rely on. Revisit before Phase 3 production release.

**Flag:** `smd_govt_schemes` (module master), default **OFF** — not a `PUBLIC-RELEASE-GATE`
default-on candidate like most new StewardMD features, because the data itself is unverified until
Phase 1's data-quality engine and at least one admin review pass exist. Turn on only after the first
scheme_version is marked `verified` in `sources.verification_status`.

**Status:** Phase 1 schema + jurisdiction registry seeded, NTR Vaidya Seva (Andhra Pradesh) workbook
ingestion built. D1 database not yet provisioned to remote (`wrangler d1 create` needs an explicit
go-ahead — real infra/cost, not a code change). API layer, admin UI, and the other 35
jurisdictions' source discovery are follow-up work, delegated per the owner's explicit Claude
Code + agy split. See [[Government Health Schemes]].

## 2026-09-02 · Auto-verification at 1 in 10, and the Subscription tap that asked a verified doctor to verify

**Reported with a screenshot:** the owner's own account wearing the Pro badge while the More → Subscription
row said "This feature needs a verified registration"; and separately, "auto verification of doctors doesn't
work as intended (1/10 of expected)".

**Why auto-verification said no to doctors who are on the register.** Four decisions in
`functions/api/verify-doctor.js`, each defensible alone, that together sent most genuine uploads to
manual review:

| Decision | Effect |
|---|---|
| Live register queried with the number AS PRINTED (`APMC/FMR/112487/2015`) | The app's own register search (`nmc-search.js`) queries the digit core and works. Same service, different question, empty answer. |
| An EMPTY answer from the live register was final | The offline D1 mirror was consulted only when the register was DOWN, never when it was up and did not recognise the form of the number. |
| Name agreement had no notion of initials | `K MANOJ KUMAR` vs `KURMANA MANOJ KUMAR` is one person; the rule needed equal tokens. |
| Register match on number AND name still went to a human under Gemini confidence 0.85 | Self-reported OCR confidence is uncalibrated and sits at 0.6-0.8 for a phone photo. The register match is the evidence; the model's opinion of its own reading is not, once the register has agreed. |

**Fix: `functions/_verify_match.js`**, the pure half of the decision, unit-tested (`test/verify-match.test.mjs`,
27 cases). `nmcQueriesFor()` asks for the core first and the printed form last; `registerLookup()` falls
through to D1 on an empty answer, not just on an outage; `nameAgrees()` honours initials in both
directions and joined names, and still refuses bare initials; `AUTO_VERIFY_MIN_CONFIDENCE` is 0.5, a
sanity floor. **Nothing here can auto-reject**: every "no" still lands in the owner's manual queue with
provisional access. What changed is how many genuine doctors get a "yes" without waiting for a human.
Each pending record now carries `lookup: {queries, source, records}` so "why was this one manual?" is
answerable from the review queue. **Behind a flag, default OFF:** `VERIFY_NAME_ONLY_MATCH=1` lets a
certificate whose number could not be read but whose name could verify against a register that returns
EXACTLY ONE agreeing row (council-narrowed). It is a loosening of the rule, so the owner turns it on.

**Why the Subscription tap asked a verified doctor to verify.** Two readers, two answers, both honest:
the header badge reads the `pro` CLAIM (`pro-badge.js`); the paywall's verify-bounce reads the
`/billing/status` payload `account.js` cached at sign-in (`SMD_PRO_NOTICE.reason()`). A verification
that lands mid-session refreshed the token (so the claim was fresh) and never told `account.js`, so the
cache said "unverified" until the next app open. And for the owner specifically, `accessState()` had no
notion of an owner at all, so the server itself answered `unverified` for the person running the platform.

**Fix, three places.** (1) `_entitlement.js` `isOwnerClaims()`: a platform owner (`_adminauth.js`
`OWNER_EMAILS`, email read from the SIGNED token) holds Pro as a team entitlement, `source:"owner"`.
Deliberately NOT `verified`: verification also unlocks the prescription pad, which stamps a real
registration number, and an owner who is not a registered doctor must still not have that.
(2) `pro-paywall.js` `openPaywall()` decides on a FRESH verdict: when the cache says unverified/pending it
calls `SMD_PRO.sync()` once, then re-decides; the second pass never re-syncs, so a still-unverified
account sees the explainer exactly once and nothing loops. (3) `verify.js` `resyncPro()`: a
verification landing mid-session (upload success, or an owner approval discovered by `evaluate()`)
pushes a cache refresh AFTER the forced token refresh, so the request carries the new claim.

**Trade-off:** one extra `/billing/status` round trip on a Subscription tap by an unverified account,
a rare user-initiated action. Owner Pro is a new server-side entitlement source; it is gated on the
signed token's email against the same owner list every admin surface already trusts.

**Status:** `test/verify-match.test.mjs` 27/27, `test/verify-gate.test.mjs` +5 owner cases,
`test/paywall-resync.test.mjs` 6/6 (sandbox), `test/verify-resync.test.mjs` 3/3 (structural),
`test/run-paywall-resync-ui.mjs` 10/10 in a real browser (`test/fixtures/paywall-resync.html`).
Verification + entitlement suites 124/124. The live NMC endpoint could not be probed from the build
environment (its certificate chain fails verification through the proxy), so the "core not printed
form" claim rests on `nmc-search.js`, which ships to doctors and queries the core.

## 2026-08-27 · The verification split-brain: two stores, one question, no reconciler

**Reported with a screen recording.** The verification panel showed "Your account is verified ✓"
while, at the same moment and for the same account, every Pro feature showed "This feature needs a
verified registration". Both were reading honestly, from different places:

| Reader | Source |
|---|---|
| `GET /api/verify-doctor` (the panel) | the KV doctor record `icu:doctor:<uid>` |
| every entitlement gate (`accessState`) | the Firebase claim `verified` / `verifiedAt` |

They drift whenever a record is written and the claim does not land: a doctor verified before the
claim existed, an owner approval whose claim write failed, a claim cleared by a later merge. Nothing
ever reconciled them, so once drifted the disagreement was **permanent and invisible** - and the new
enforcement turned a latent inconsistency into a hard lockout.

**Fix: `functions/_verify_claim.js` `reconcileVerifiedClaim()`.** The CLAIM stays authoritative - it
is what the gates read, it is signed, a client cannot forge it - so healing is **one-way**: a record
that says verified re-asserts the claim, never the reverse (a stale KV record must not be able to
grant entitlement on its own). Called from BOTH the panel's GET (heals while the doctor is looking
at it) and `/billing/status` BEFORE the entitlement is computed (so Pro returns on the next app open
without the doctor having to know to visit that screen). `verifiedAt` starts now, so an
already-verified doctor gets a full free week rather than one that expired before they saw it.

**The second half, and the reason a server-only fix would have looked broken anyway:** the gates read
claims out of the ID token the CLIENT sends, and Firebase caches that token for up to an hour. A
just-written claim does not reach them until the token happens to refresh. `account.js` now forces
ONE refresh per session when `/billing/status` reports a verified account. Without this the app says
"verified" and every feature keeps refusing for an hour.

**Status:** 8/8 `test/verify-claim-reconcile.test.mjs` (the one-way direction is the load-bearing
case), 15/15 `run-pro-notice-ui`. Suite 2830/2833.

## 2026-08-27 · Selling to institutions: tenant provisioning, and the code-vs-id bug under it

Owner: *"we should also be able to make medical colleges admins ... for each medical college there
will be an admin where I can assign username pwd (autogenerated) and can be linked to google account
... they have full controls and dashboard of faculty and student."*

**Almost all of it already existed** and had simply never been joined up: `createOrg`,
`setMembership`, `setMemberPassword` (salted), and `POST /api/queue/auth/email` which mints a staff
session. A college admin lands on the `admin` role, which already carries every cap except the PGLOG
sign-off ones - so the Academic Cell console, `dept` oversight and the 12 reports were all already
theirs. The missing piece was one owner-gated seam to create a college and hand over credentials.

**New: `functions/api/tenants/[[path]].js`** (ownerOK) - list every institution, create one with its
admin, re-issue a password. Plus a **"Medical colleges" pane** in `admin/index.html`.

**Decisions worth keeping:**
- **The college admin OWNS their org**, not merely administers it. Consequence, accepted
  deliberately: `authorizeOrgAccess` knows only org-owner and membership, so **StewardMD staff cannot
  read a tenant's clinical data through the org routes.** Support means re-provisioning, not reading.
- **Two logins, different reach.** Google (Firebase) reaches everything including the eLOGBook
  console; the generated password mints a STAFF SESSION which reaches the OPD/queue surfaces and
  NOT the logbook, because `functions/api/pglog/[[path]].js` authenticates with
  `verifyFirebaseToken()` alone. Owner chose "Google for admins, password for staff" over widening
  the auth surface of the module carrying the PGMER-2023 9.2(c) signing guarantees.
- Password alphabet excludes `O/0/I/1/l`: it is read off a screen and typed on a phone. CSPRNG,
  returned exactly once, stored only salted+hashed.
- An Academic Cell can never mint an org admin or owner (the `/enrol` allowlist); only the platform
  owner can, through this route.

**The bug found while wiring it, which would have broken the whole enrolment flow.** `screenSetup()`
has always asked for the "Institution code (SMD-XXXXXX)" and stored it as `orgId` - but an org has
BOTH an internal `id` and an `SMD-XXXXXX` `code`, and pglog's gate calls `getOrg()`, a **direct
document fetch by id** that never resolves the code. So a resident typing exactly what their
department told them got `org_not_found`. Fixed in the pglog route's `context()`, which now resolves
either form via `ORG.resolveOrgId()` (a real id passes straight through, so it is a no-op for
existing callers) and returns the canonical `orgId` + `orgCode` from `/me`, which the client then
persists. The Academic Cell console shows `org.code` and stores `org.id` - they are different values.

**Not done, on purpose:** `stewardmd.in@gmail.com` is still hardcoded as a PLATFORM owner in
`_adminauth.js` and `functions/api/verifications/[[path]].js`. Owner said "just for testing he will
be customer", which is not the same as giving up platform access, so the allowlist is untouched.
**While it stays there that account can reach every tenant's data regardless of membership, so a
test using it demonstrates the flow but NOT tenant isolation.** Removing the email from those two
files is the whole change if real isolation is wanted.

**Status:** 10/10 `test/tenant-provision.test.mjs`, 15/15 headless-Chrome
`test/run-tenants-admin-ui.mjs` (which fails on any uncaught exception, because the admin script is
one IIFE and a syntax error there kills every handler silently), 21/21
`run-pglog-designation-ui`. Full suite 2822/2825.

## 2026-08-27 · Acknowledgements: read #ackCard, don't restyle a clone of it

**Owner: "it looks too big".** It was. `openAck()` cloned `#ackCard` into the sheet and used a wall
of `!important` to force every hover tooltip open INLINE, because hover does not exist on touch.
Twelve people x a full bio each is roughly three screens, so the names - the entire point of the
page - were buried in prose nobody scrolls.

**Fix: read the markup instead of restyling it.** `#ackCard` STAYS the single source of truth (the
desktop hover tooltips still use it, and adding a contributor is still one `<span>` there and
nothing else). `ackHTML()` now parses name / role / bio / links out of both markup shapes
(`.creator-tip` -> `.ctp-deg`/`.ctp-bio`/`a.ctp-linkedin`; `.ack-tip` -> `<strong>` + trailing text)
and renders a compact accordion. Owner picked this from four mockups.

- **Collapsed by default, one open at a time** - twelve open accordions is the same wall again.
- **Founders get initials avatars**, contributors do not: it separates the two groups without a
  second heading style, and keeps contributor rows to one line each.
- **`visibility:hidden` on collapsed bios, not just `overflow:hidden`.** Clipping alone leaves the
  text in the a11y tree and in find-in-page, so a screen reader still read all twelve. Caught by the
  browser test, which asserted on `innerText` rather than on height.
- `openAck()` and the About-box "Acknowledgements" tab now share ONE builder, so the two surfaces
  cannot drift. Both render into the DOM at once, so anything testing them must scope to the
  VISIBLE roster - a document-wide query hits the hidden About copy, where `innerText` does not
  respect collapse and every assertion silently inverts.

**Added:** Dr. Sri Harsha Gora, Field Testing & Bug Reports (IM resident using the app on the wards).

**Measured:** 12 people in ~1000 px, was ~3 screens. **Status:** 19/19 headless-Chrome
`test/run-ack-ui.mjs`, driven against the REAL page rather than a fixture, precisely so it fails if
the parser stops matching `#ackCard`. Cache tokens bumped (`home.js` + the SW key).

## 2026-08-27 · Enforcement armed: deletion on, prompt every open, tiered AI limits

Owner, after reviewing the dry-run design: *"push it, turn on auto delete if not verified in 7 days,
and ask them to verify on every app opening, and no launch promo for who not verified (like who
verified had better pro limits while guest have very less)"*. All four, plus the first push.

**1. The sweep is ARMED and DELETES.** `UNVERIFIED_PURGE_ON` and `UNVERIFIED_PURGE_HARD_DELETE` now
both default ON. The concern about irreversibility was raised and the owner reaffirmed, so it ships.
What makes it survivable is not the switches but `decidePurge()`: verified, paying and
pending-review accounts are spared by explicit claim-checked rules, and **nobody is removed who was
not warned by email first** (day 5, send-once, and an overdue-but-unwarned account gets warned rather
than deleted). Either switch can be softened from env with no deploy.

**New: `purgeUserData()` runs BEFORE the account delete.** Deleting the Firebase user alone would
have left the account's saved cases (`icu:index:` / `icu:case:` in CASES_KV), verification record,
budget cache and Firestore `users/{uid}/profile/self` + `doctorDirectory/{smdId}` behind: the doctor
locked out of records we were still holding, which is the worst of both outcomes and a retention
problem rather than a tidy-up. The lifecycle record itself is KEPT as a `purgedAt` tombstone so a
later run cannot reprocess the same uid.

**2. Ask on every app open.** `verify.js` `evaluate()` re-opens the gate for a provisional
(skipped) account once per app OPEN, latched on `_promptedThisOpen` because evaluate() also fires on
every auth/account change. Still dismissible, because unverified keeps the free tier. **Pending
review is exempt** - nagging someone for something they have already done is how a real doctor is
lost. Before this, one tap on skip silenced the prompt for the whole 7 days, so an account could
reach the deletion sweep having been asked exactly once.

**3. Tiered AI limits ON.** `_aibudget.js` already encoded precisely what the owner described and
was simply switched off behind `AI_BUDGET_ON`, now default ON: unverified **0**, verified-not-Pro
5k, Pro 1M, physician 3M, every rung env-tunable. This is also what "no launch promo for the
unverified" means in practice at the token level.

**Gotcha found while arming it:** `monthlyCapFor()` caches the computed cap for ~26h. Verification
changes the tier from 0 to a real allowance, so without busting that cache a doctor verifies and
MaiK still refuses them until the next day - the exact "I did what you asked and nothing happened"
report. New `clearBudgetCache()` is called on both verification paths (auto NMC + owner approval).

**Status:** 2560/2563 (2 pre-existing `mock.module` failures), new suites
`ai-budget-tiers` 6/6 and `verify-prompt` 6/6. PUSHED to `fix/audit-sweep-2026-08-26`.
Recovery point: tag `pre-verify-enforcement-2026-08-27`. See [[Flags]].

## 2026-08-27 · A locked Pro feature must explain itself, with the RIGHT button

**Why this had to ship with the verification gate, not after it.** Enforcing verification turns on a
brand-new failure mode: features that worked yesterday stop working, and the app's existing answer
was either silence or "upgrade to Pro". Both are wrong now. Silence reads as a bug, and a paywall
shown to an unverified doctor takes money for something verification would have unlocked **free**.

**The silence was real, not hypothetical.** `functions/api/cases/[[path]].js` carried the comment
*"client handles 402 silently"* — a doctor's saved patients simply never appeared on their second
device and nothing, anywhere, said why. `icu.js` said "Saved on this device" and stopped there.

**Server: every refusal now names its cause.** `requirePro()` returns `{ reason, verified,
pendingReview }` from `entitlementState`, and the new `needsProBody()` builds the 402 body so eleven
endpoints cannot drift into eleven different answers. Wired through cases, watch (x2), ghis,
queue and `_usage.js`. `proMessageFor()` holds the one wording of each case. `_usage.js` reuses the
`callerVerified` it already had, so a doctor over the free AI allowance who is merely unverified is
told to verify rather than sold a subscription.

**Client: one explainer, `pro-notice.js` (`SMD_PRO_NOTICE`).** `explain()` is pure, so the wording
is unit-tested — the wording IS the feature. Four cases:

| State | What they see | Button |
|---|---|---|
| not verified | "needs a verified registration ... free for 7 days. This is not a payment." | **Verify my registration** |
| review pending | "we are reviewing it, you keep full access" | Got it (**no price, ever**) |
| free week over | "your free Pro week has ended, your saved work is untouched" | See Pro plans |
| unknown | admits it could not confirm, rather than inventing a cause | Open account |

`openPaywall()` itself now bounces an unverified or pending user to the explainer, so **the paywall
can no longer be the wrong door** regardless of which call site opens it. No loop: the explainer
never routes those two reasons back to the paywall.

**Trade-off:** `SMD_PRO_NOTICE` is a fifth place that can render a modal (paywall, AI-limit sheet,
verify gate, guest bar). Accepted: the alternative is each gate inventing its own wording, which is
exactly how "upgrade to Pro" ended up being shown to people who could not benefit from it.

**Status:** 11/11 `test/pro-notice.test.mjs` + 15/15 `test/verify-gate.test.mjs`, 15/15
headless-Chrome `test/run-pro-notice-ui.mjs` (incl. that the unverified button reaches verification
and not the paywall), full suite 2547/2550 (2 pre-existing `mock.module` failures). See
[[StewardMD ID]].

## 2026-08-27 · Pro is an entitlement of a VERIFIED account (three tiers)

**The bug behind the ask.** "The app is not verifying anyone" was true, but not because the gate was
off: `verify.js` has had `BETA_VERIFY_ALL = false` for a while and the forced gate does fire. The
hole was in `functions/_entitlement.js` `isPro()`, whose FIRST line was `if (promoActive(env, now))
return true` - the launch promo (to 15 Sep 2026) granted Pro to every caller **without ever reading
`claims.verified`**. Nothing anywhere in the codebase consulted `verified` when deciding Pro. Eleven
server modules gate on that one function, so the fix is one guard, not eleven.

Secondary hole: the forced gate's "Skip for now" button AND its ✕ both called `startTrial()`, so any
signed-in user got **7 days of full access** by tapping the close box.

**Decision (owner).** Three tiers:

| Who | What they get |
|---|---|
| Verified against NMC/SMC | **Pro free for 7 days** from the moment of verification, then paid |
| Signed up, not verified | **Free tier only**; the account is removed after 7 days |
| Guest (not signed up) | **300 s per session, 2 sessions per day** |
| Proof uploaded, review pending | **Full access while pending** - owner review latency must never be a user-facing outage |

**How.** `isPro()`/`entitlementState()` ask `accessState()` first, which reads **claims only**
(`verified`, `verifiedAt`, `provUntil`) so the hot path stays free of KV/Firestore reads. When
enforcement is on the promo deliberately does NOT apply - it is the exact hole being closed.
`verifiedAt` is stamped at all three places that set `verified:true` (auto NMC, the owner's review
dashboard, the admin console) and **backfilled** in `entitlementFor()` for doctors verified before
this existed, so nobody who did the right thing blinks out of Pro on deploy day.

**Trade-off, and it is a pricing decision:** enforcement effectively **ends the launch promo early**
for unverified accounts. That is the point, but it is the owner's call to keep or revert -
`VERIFY_REQUIRED_FOR_PRO=0` in KV restores the old contract with no deploy, and
`test/entitlement-trial.test.mjs` pins that the flag-off path is byte-identical.

**Client.** `account.js` seeded `_pro = true` for everyone and failed open. Harmless while the promo
covered all; with verification enforced it would flash Pro UI at an unverified account. Now the seed
is the **last known verdict for that uid** (`smd_pro_last:<uid>`), false when never seen - a verified
doctor offline on a ward still gets in, a new unverified account does not.

**Guest 300 s.** Already existed and was already correct (`app.js` writes
`expiresAt: Date.now()+3e5`, ticks `Guest · M:SS`, wipes and reloads at zero; `account.js`
`GUEST_MAX_PER_DAY = 2`). What was missing is that the clock lived in a chip nobody looks at. New
`guest-timer.js` renders the same clock as a **top bar** (additive, never edits app.js) and carries a
backstop teardown at zero, so auto-sign-out is a guarantee rather than a side effect of a chip having
rendered.

**Auto-deletion is built but OFF.** A StewardMD account can own ICU membership and saved clinical
cases, so the destructive path is deliberately two switches deep: `UNVERIFIED_PURGE_ON` (default
OFF - the sweep reports what it would do and changes nothing) and, only then,
`UNVERIFIED_PURGE_HARD_DELETE` (default OFF - otherwise it **disables**, which is reversible).
Day 5 sends one warning email; **nobody is removed who was never warned**, and verified, paying and
pending-review accounts are all spared by explicit rules in `decidePurge()` rather than by a KV
filter that can go stale.

**Status:** 25/25 across `test/verify-gate.test.mjs` + `test/unverified-purge.test.mjs`, 14/14
headless-Chrome `test/run-guest-bar-ui.mjs`, full suite 2531/2534 (the 2 failures are pre-existing
`mock.module` issues in OPD/FollowCare, untouched here). Recovery point: tag
`pre-verify-enforcement-2026-08-27`. NOT deployed. See [[StewardMD ID]].

## 2026-08-27 · MaiK on-device is a Pro feature, not a private beta

**Decision:** `SMD_MAIK_ENGINE.gateActive()` is now **Pro only** - `window.SMD_PRO.isProSync()`.
The shared experimental access-code gate (`SMD_XACCESS` feature `maik_local`) is REMOVED from the
feature: the constant, the client row under Settings > Experimental Features, its `openFeat()`
branch, and the `maik_local` entry in `functions/_experimental.js` FEATURES are all gone. The two
developer escape hatches stay (`localStorage smd_maik_local_bypass=1`, and a native DEBUG build via
`SMD_MAIK_LOCAL.isDebugBuild()`) because the device harnesses drive them and a debug install has no
Pro state to read.

**Why:** it was never a boolean feature flag - it was the FundX/KardioX beta-code gate, so on-device
answering was unreachable for every clinician who did not have a code from the team. A paying
subscriber was being shown a greyed-out row reading "Private beta. Unlock with an access code below"
and a toast telling them to go find one. Owner: make it available to Pro subscribers, no gates.

**Trade-off:** a code can no longer unlock it for a non-subscriber, so existing MAIK-prefixed codes
are inert. Accepted - that is the point of the change. `SMD_PRO` **fails OPEN** (`_pro` defaults
true, only an explicit `{pro:false}` from `/api/billing/status` flips it), so during the launch promo
(to 2026-09-15) this is effectively open to everyone on a native build; enforcement tightens by
itself when the promo ends. That is the right direction: a network blip must never lock a clinician
out of a 2.5 GB model already on their phone.

**Copy** follows the gate: the locked row now reads "Included with Pro. Subscribe to unlock, then
download the model.", the picker row carries a **Pro** pill next to **Beta** (Pro = access, Beta =
quality - the model is still ungrounded and can be wrong), and `kbOnlyNotice()` says
"On-device answering is included with Pro." instead of naming an access code.

**Status:** 178/178 `test/maik-engine.test.mjs` + 19/19 headless-Chrome `test/run-maik-engine-ui.mjs`
green. Client-only apart from the dead FEATURES line. NOT yet in a native build - needs
`build-www` -> `cap sync` -> rebuild + reinstall to reach a device. See [[MaiK]].

## 2026-08-26 · ACCEPTED EXPOSURE: real patient identifiers are permanent in main's history

**Owner decision: leave it, and record it here so it is not rediscovered as a surprise.**

**What happened.** GHIS work captured against the live server used a real admitted patient. Real MR
and IP numbers reached four files and were committed. `c47cdb47` ("GHIS: confirm activation by
identity, not HTTP status; redact patient ids") replaced them with synthetic ids in the WORKING
TREE — it stripped 32 identifier-shaped values (7-, 8- and 9-digit) across:

- `docs/ghis/captured-initial-assessment-write.md`
- `functions/api/ghis/[[path]].js`
- `test/ghis-save-docid.test.mjs`
- `test/ghis-ward-assessment.test.mjs`

**A redaction commit does not remove anything.** The pre-redaction blobs remain reachable at
`c47cdb47^` and its ancestors, and those commits are now in `main`. `git show <parent>:<file>`
returns the real values to anyone who can clone. This is permanent short of a history rewrite.

**Why it is being accepted rather than purged.** The repository is **private with 0 forks**, so the
audience is exactly the people who already have repo access. Purging means `git filter-repo`/BFG
plus a force-push to `main`, which invalidates every existing clone and all eight active worktrees —
a real cost against an exposure that is already bounded. That trade is the owner's to make and they
made it.

**What this does NOT make acceptable.** `CLAUDE.md` says: never commit PHI. That rule is unchanged
and this entry is not a precedent. The failure was not the redaction, which was correct and prompt —
it was capturing against a **real patient** when a synthetic one would have proved the same thing.
Capture against synthetic identifiers, or redact BEFORE the first commit, because after it there is
no undo that does not hurt.

**If the repo is ever made public, this must be revisited first.** Publishing without a history
rewrite would publish these identifiers. Treat that as a hard gate on any decision to open the repo.

**Found by:** the parallel session that did the GHIS work, which flagged it rather than quietly
leaving it; verified independently here against `origin/main` before being recorded.

## 2026-08-26 · One icon treatment on Home, and one stroke weight across three glyph systems

**The split was a selector, not a design decision.** The glossy sphere lived on
`.rnav-tile.feat .rnav-badge`, and `feat` marks a **branded** module, not a more important one. So
six tiles (FundX, SknX, CliniX, SURGX, MAiTRI, OncoTree) read as the product and twelve — FollowCare,
OPD Queue, Dictate, Scan Meds, Guides and the rest — read as placeholders, for a reason that had
nothing to do with them. The sphere is now the base `.rnav-badge`. `.feat` is kept as a hook: it no
longer owns the sphere but still marks a branded module and still carries the status dot.

`.addtool` opts OUT deliberately — an empty slot inviting a choice is not a tool and should not
pretend to be one. It needs the inherited sheen and shadow explicitly cleared or it renders as a
*broken* sphere.

### The trap worth remembering: `stroke-width` is in USER units

Measured on the real page, the badges disagreed badly:

| glyph | artboard → box | effective |
|---|---|---|
| inline SVG | 24-wide viewBox at 32px | 2 × 1.333 = **2.67px** |
| the ECG | **48**-wide viewBox at 36px | 2 × 0.75 = **1.50px** |
| Material Symbols | `wght 400` at 28px | ≈ **2.30px** |
| brand PNGs | inline-styled | **48 / 38 / 34px** |

The ECG was drawing at *nearly half* the others, and nothing warned anyone: the same literal `2`
draws a different thickness in every viewBox, so **an icon drawn on a wider artboard silently comes
out thinner**. This will happen again to the next icon someone adds on a non-24 artboard.

**The fix is `vector-effect: non-scaling-stroke`**, which takes the viewBox out of the equation —
`stroke-width` then means SCREEN pixels, so ONE number governs every SVG however it was drawn.
Everything is driven from `--rds-glyph-stroke: 2.5` in `redesign-system.css`, with Material's weight
axis at 500 to sit on the same line. Solid shapes (`.pupil`, `.p`, `.n`, `.beam`) are explicitly
excluded, or they take an outline and bloat.

The three brand marks moved from inline `width:48/38/34px` to a shared `.ai-brandmark` class: one
optical box, `object-fit: contain`, which also deleted a triplicated inline filter.

**Verified by measurement and by screenshot in both themes**, not by reading the CSS — the only
honest way to check a visual property. Every SVG reports `eff=2.50px`, every ligature 28px/`wght 500`,
every brand mark inside a 38px box.

**Known limit, not a bug:** `surgx-logo.png`, `maitri-logo.png` and `clinix-logo.png` are RASTER. Size
and colour normalise; the drawn line weight cannot. They read slightly finer than a Material glyph at
38px. Redrawing them as SVG at 2.5px is the only real fix, and that is illustration work.

**Not touched, deliberately:** the top quick-action row (`.rnav-qa-btn`) and the bottom tab bar are
different components and keep their compact outline style. Unifying them is one more selector if the
owner wants it. See [[Flags]] for the module gating that decides which tiles appear at all.

## 2026-08-26 · SURGX notes survive a reinstall, without a background sync

**Decision:** an explicit, confirmed **backup + restore** to the surgeon's own Google Drive
(`surgx-backup.js`), NOT continuous sync. **Why:** notes are encrypted device-local with no note
server by design, and every native install creates a new container, so a reinstall destroys them —
twice, already. The `drive` destination that shipped in August is a readable `.txt` per note: an
export for a human, not something the app can read back.

**Why note bodies and not ciphertext:** `surgx-store.js` encrypts with a per-device, per-account
random secret in `localStorage`. A reinstall wipes that secret, so backed-up ciphertext would be
permanently unreadable. A backup that cannot restore is not a backup. The file carries note JSON
into the doctor's OWN Drive — the same data class and destination the sanctioned `.txt` export
already uses — and restoring re-encrypts under the new device's secret.

**Why not auto-sync, given the request was "get SURGX synced":** the module's PHI posture states
that every non-local send needs `confirmed:true` AND a second in-UI tap, and that no silent or
background upload path exists. Continuous sync would break both. So the feature is foreground and
double-pressed, and **the owner is told plainly that background sync remains available as a
deliberate decision to relax that posture** rather than something shipped quietly under a
sync-shaped request. **Trade-off:** the surgeon must remember to back up; the mitigation is that the
control sits in the Notes screen where the loss is felt, not buried in settings.

**Restore is additive**: strictly-newer-wins on `updatedAt`, equal timestamps skip, so a repeat
restore writes nothing and a restore onto a working device cannot roll back newer edits. See
[[SURGX]].

## 2026-08-26 · The overlay-stacking trap again (MaiK), and the brand field's missing query

**A third module hit the same z-index trap.** `#maikSheet` is **999**; `.db-overlay` (Drugs
Database) is **880** and `.mc-overlay` (Calculators) **870**. The "Open in StewardMD" copilot chips
called `TOOLS[kind].open()` with the MaiK sheet still up, so the module opened BEHIND it, working
and invisible. The sibling chip group (`data-maik-tool`) always `close()`s first, which is precisely
why those worked. **Rule, now three modules deep (SURGX, CliniX, MaiK):** before deep-linking into a
shared app surface, either close your own overlay or lift the target above it. Never assume a module
overlay is below yours. Also: the "Drug database" chip pointed at `MEDDRUGS.openList()` (drugs.js,
the small local list used elsewhere only for `openInteractions`) instead of `MEDDB.openList()`
(api.js, the 4-lakh brand index) — `surgx-screens.js` already carried a comment warning not to
confuse the two, and this is what confusing them looks like.

**The Rx pad had no entry of its own** — only from a MaiK answer or a consult. It now has a tile in
the Hospital hub. Opening it cold also produced NO drug row, because `regimenFromCtx()` always seeds
a `"Lifestyle & general measures"` **advice** row, which carries no drug/brand input: a length check
on `lines` therefore never fires, and the pad looked populated while offering nothing to type into.
The guard tests for a non-advice row.

**The brand field could not find brands the Drugs Database found instantly — same backend, one
missing query.** The pad resolved the typed drug to a composition via `/search` and filtered that
molecule's brands; it never called `/brand-search`, which the Drugs Database pairs with `/search`.
So a drug field holding a shorthand the composition index does not carry (`Amoxiclav` for
Amoxycillin + Clavulanic Acid) made every brand unreachable, while the empty state still said "Type
the drug first". Two further faults surfaced while fixing it: clearing the box left the previous
drug's suggestions on screen, and `if (loading) return` DROPPED a newer drug mid-flight, parking
`loadedFor` on the wrong molecule. Requests supersede now. The rules live in **`rx-brand-match.js`**
as pure functions, for the same reason `functions/_sse_parse.js` was extracted: unit-testable
without a browser. **Harness note:** the app calls `location.reload()` when the guest session
expires, which lands mid-run and wipes long browser tests — keep them short and push detail into
unit tests. See [[Scan-Meds and Drug Index]].

## 2026-08-26 · Edge swipe ownership, and the profile that never loaded

**The edge swipe belongs to home; every other screen goes back.** `homeIsForeground()` decided "am
I at home?" by asking `elementFromPoint()` about ONE pixel, the viewport centre. Anything not
covering that pixel was invisible to it (a bottom sheet shorter than half the screen, a small
dialog, a top-anchored panel), so home still looked like the foreground and the swipe opened the
MENU instead of dismissing what was on top. A structural check now runs first: is a LIVE layer
stacked above `#homeV2`? Measured on the app, at home every layer above home (`sbBackdrop`,
`hvScrim`, `harrisonQuotePopup`) is `opacity:0` AND `pointer-events:none`, while an open sheet's
scrim and sheet are `opacity:1` / `pointer-events:auto`. Both conditions required, so a parked layer
can never suppress the home menu. The pixel test is KEPT as a second, independent condition because
it still catches an overlay rendered INSIDE `#homeV2`. `edgeSwipeAction()` was
`openMenuAtHome() || goBack()` and is now an explicit either/or, so a false positive can no longer
open the menu on a screen the user meant to step back from. **Also:** `#hvSheet` (More, the settings
sheets, Customize tools, Account) ships no back/close control, so the `BACK_SEL` scan found nothing
in it and clicked a stray match on the home screen UNDERNEATH, leaving the sheet open. `goBack()`
now clicks `#hvScrim`, whose handler is the app's own `closeSheet()`. Pinned by
`test/run-swipe-back-ui.mjs`. **Not reproduced:** "the sidebar opens on every page" did not occur on
any screen driven in the web build; what was found is the same rule failing on sheets/dialogs. If it
persists on device, check the installed bundle's `?v=`.

**The Profile's professional details never loaded.** Firestore is loaded LAZILY
(`window.SMD_loadFirebase`), so `window.SMD_DB` does not exist on a cold start;
`acctFillProfessional()` looked once, saw no DB and declared "Offline" with no way back but a manual
Retry. It now boots Firebase and re-fills the sheet that is on screen at that moment. Separately,
`offline()` appended its notice unconditionally, so a second call stacked a second
"Couldn't load your details" row (visible in the owner's screenshot); it is now keyed on
`data-offnote`. **Trade-off:** none. `Offline` now means an actual failure.

**Nothing ever asked for the professional details.** `hospitals-in.js` (~2,400 institutions) and its
searchable picker were already wired into the Profile card, but the card never loaded and no flow
requested them, so the directory looked absent. `profile-setup.js` asks on every app start when a
signed-in user is missing phone / college / degree / speciality; "Later" postpones for that app-open
only. It writes the SAME `users/{uid}/profile/self` doc the card reads. Degree and Speciality are now
rows on the card too, chosen from shared lists that live in `profile-setup.js` so the two surfaces
cannot drift. **MBBS is in the degree list** although the request named only PG degrees: a
near-mandatory form must let an intern or medical officer answer truthfully. Pinned by
`test/run-profile-details-ui.mjs`. See [[StewardMD ID]].

## 2026-08-26 (follow-up) · Closing the sweep's own caveats: verify by observation, not by reading

The sweep below shipped with three stated caveats. Two are now closed by evidence; the third needs
the owner. Closing them turned up a real bug the original fix had left standing.

**Verification, not more code.** The answer-cache fix was pinned only by asserting the ORDER of two
blocks in the handler's source. That is too weak for this particular bug: the original defect was
code that was present, correct, and in a plausible-looking place — a source grep would have passed
against the broken build. `test/maik-cache-wiring.test.mjs` now drives the real exported
`onRequest()` over the live-stream path with a fake KV and a fake Gemini upstream and asserts on
OBSERVED EFFECTS (a `maik:ans:*` key appears; the next identical question makes no upstream call).
**Checked the check:** run against the pre-fix handler (`9f9e4770^`) the three live-stream tests
FAIL and the three controls (non-stream, differential-not-cached, flag-off) still pass.

**Confirmed against live prod, read-only.** `MAIK_KV` (`c110474d…`) holds 453 keys, 114 under
`maik:`, including `maik:route:` — and **zero** under `maik:ans:`. `maik:cfg` reads
`{"answerCache":true,...}`, so the KV runtime override is NOT the explanation. That is the reported
symptom reproduced live and the last alternative cause ruled out. The FIX itself cannot be verified
in prod until it deploys (server changes go live on push to `main`); the post-deploy check is
`npx wrangler kv key list --namespace-id c110474def2947ddb657d93a6f9cbefe --prefix "maik:ans:" --remote`
turning non-empty.

**A browser test found what the unit tests could not.** KardiQ had no headless-browser harness, so
the Learn-progress fix rested on unit tests plus a one-string UI edit. `test/run-kardiox-progress-ui.mjs`
drives the real library + lesson screens in Chrome — and the bookmark still did not persist. Cause:
`data-act="kx-bookmark"` had TWO live handlers, the lesson screen's `host.onclick` on `#kxScroll`
and a duplicate `case` in the router's delegated listener on the ancestor `#kardioxRoot`. One tap
toggled the store twice and netted zero. Invisible before the sweep (the toggle only mutated an
in-memory record that was already lost on reload); once the store became real it WAS the bug.
**Decision:** the router's duplicate case is deleted rather than the screen's handler silenced —
`kx-bookmark` is emitted by exactly one screen, which also owns its `aria-pressed` and toast, and
`render09` already documented the toggle as local. **Trade-off:** a future screen wanting the same
`data-act` must handle it itself; there is no such screen. See [[KardiQ X]].

**`MAIK_GUEST_DAILY_LIMIT` set back to 15** (owner ran it; two attempts from this session were
refused by the environment's permission policy). 15 is also the code default in `functions/_usage.js`.
**Not live yet:** Pages binds secrets at deploy time — Cloudflare's own docs say a secret "needs to
be done before a deployment that uses" it — and production is still deployment `87b57391`
(`main` @ `d59d8ba`), which predates the change. The next push to `main` picks it up; no separate
action needed if #760 is merged. Nothing verifies this from outside, since secrets are write-only
and the effective limit is not exposed on an unauthenticated route: confirm on the Pages deployment,
not by probing.

## 2026-08-26 · Audit sweep: four open items, each fixed at the seam every caller routes through

Cleared from [[Roadmap]] and the 2026-08-25 handoff. Nothing here needed new architecture; each was
a fix in the one place all callers already pass through, plus a test that pins it.

**1. The MaiK answer cache was UNREACHABLE, not broken.** `maik:ans:*` stayed empty with
`MAIK_ANSWER_CACHE=1` even though the router cache proved the KV binding good — the cause the
handoff left open. The block sat BELOW the live-stream early return in `/explain`, so with
`MAIK_LIVE_STREAM` (or `?livestream=1`) on, the handler returned the SSE response before reaching
either the read or the write. Lookup hoisted above that return; the stream path now writes from its
completion callback via `context.waitUntil` — the same pattern the router cache uses, which is
exactly why that one always worked. **Trade-off:** none; flag-off is still byte-identical.

**2. CliniX content could never be updated on a cached device.** SURGX's `?v=<contentVersion>` fix
applied verbatim. See [[CliniX]].

**3. KardiQ Learn state was frozen inside the content records.** `status`/`masteryPct`/`bookmarked`
are fields of the shipped, read-only bundle, so the 1,041-lesson pack rendered "new · 0%" forever
and bookmarks died on reload. Real state already existed in `kxProgress` (localStorage); the library
now overlays it in `mockLibrary`, the single seam every screen reads through, and never mutates the
content record. Two more in that layer: the progress ring's denominator was a hardcoded `100`
against a 1,141-lesson library, and one lucky answer marked a lesson mastered — mastery now needs
repeated success on SEPARATE days, which is what this log already said it should be.
**Drift corrected:** the 2026-08-22 entry below says the `tier:"atlas"` mismatch makes all 1,041
pack lessons "unreachable through the UI". Verified against the code: they DO render under the
default "All" chip and in search; what was true is that no tier chip could ever surface them. An
Atlas chip is added. The rest of that entry's critique (1.9 MB parsed on every load, no media
licence manifest) stands unchanged, and so does the decision to build CliniX like RadioAnatome.

**4. `functions/_research.test.mjs` had been red since #596** made per-module caps opt-in; it still
asserted the old always-on 2/day. It now asks for `MAIK_ENFORCE_CAPS` the way `test/ai-usage.test.mjs`
already did, and pins the launch default too. **The cap behaviour was never wrong — only the test.**

Also corrected: `native-bridge.js` claimed `X-SMD-App` was INERT because no server code read
`env.APP_GATE_KEY`. Three handlers read it and the secret has been in prod since 2026-08-16, so the
header is load-bearing — acting on that comment would have locked the native app out of `/api/*`.

**Status:** 2495/2495 unit green + `test/run-clinix-ui.mjs` green in a real browser. Client `?v=`
tokens bumped. NOT deployed — server changes go live on push to `main`; the client needs
build-www → cap sync → rebuild.

## 2026-08-24 · SURGX projects the existing surgery engine rather than re-authoring it
New module (see [[SURGX]]), built behind `smd_surgx` off tag `pre-surgx`. Three decisions worth keeping.

**1. `ws-surgery.js` was ABSORBED, not duplicated, and not edited.** The app already had a working
surgical decision engine: 13 syndromes with focused findings, danger signs, a deterministic
`assess()` returning an emergency flag, a management-ladder index, source control, referral, notes
and empiric antibiotic regimens with an ICMR reference. The obvious move - author SURGX protocol
JSON covering the same syndromes - would have produced two places where "acute abdomen" gets a
recommendation, drifting apart. That is exactly the failure recorded above for the KardiQ content
pack. Instead `compileEngineProtocol()` projects the engine's own output onto a seven-band spine, so
**parity is structural rather than tested-for**, and `ws-surgery.js` has zero changes. Provenance,
an INVESTIGATE band and calculator links live in a separately-reviewed overlay JSON. Eight authored
protocols cover only what the engine does NOT model (ATLS, shock, sepsis, chest, head, burns, GI
bleed, post-op deterioration).

**The projection is deliberately non-interpretive.** `result.sc` is source control so it becomes
DEFINITIVE; `result.ref` is referral so it becomes ESCALATION; `result.mgmt[]` is an unstructured
note list so it is carried WHOLE rather than scattered across bands by keyword matching.
Regex-splitting clinical prose into bands would silently relocate a safety-critical line, and that
class of change is precisely what the module exists to prevent.

**2. For Notes, only ONE of the four anti-fabrication layers is a prompt.** An operative note is a
legal record. The prompt says "do not invent"; the server intersects the model's keys with the
schema's `aiFillable:true` set and then applies a hard DENY list on top (counts, specimens,
implants, consent, discharge medications, identifiers, attribution); the client voids any field
containing a number absent from the transcript; and export is blocked until every required field is
clinician-confirmed, behind a double press. Layers 2 to 4 are code. **A prompt is a request, not a
mechanism** - the same conclusion `clinix-tutor.js` reached about dose refusal.

**3. Notes reuse `SMD_RX.canPrescribe()` as the clinician gate rather than inventing a role check.**
There is no client-facing role read in this app, and verify.js already draws the line in the right
place: a student "unlocks StewardMD's learning tools" while "prescription and clinical-action
features stay locked". Notes is on the locked side of that line. SURGX Notes does not prescribe, so
this is STRICTER than needed - the correct direction to be wrong in, at zero cost. An unverified
user SEES the section and is told what is needed; hiding it would read as a broken app.

**Trade-off accepted:** notes are device-local only (AES-GCM via `SMD_CLINIC_CRYPTO`, key in
localStorage). That defends against a backup or a storage-panel dump, not against code execution on
an unlocked device, and it is written down as such rather than glossed. Moving the secret to
Keychain/Keystore is the marked upgrade path. **Status: built, flag ON for testers, content
ai_drafted pending R1.**

## 2026-08-23 · Arming OTA on a device DOWNGRADED it to the pre-CliniX bundle
**Measured on the owner's iPhone 15 Pro, not inferred.** The first device ever built with
`@capgo/capacitor-updater` linked in immediately hit `/api/ota/check`, downloaded a 36 MB bundle and
served it over the fresh install. The app then reported `build 1`, no `clinix.js` (404), and the
pre-CliniX `?v=` tokens, while the correct build sat unused in the app bundle.

The server is the cause, and it is unambiguous:
```
GET /api/ota/check?version=builtin&nativeBuild=7
  -> {"ota":true,"version":1,"commit":"b2b1bdcdbbd6d4df94e7598c595b370ae0073ded", ...}
```
`b2b1bdcd` is the commit immediately BEFORE CliniX. **The live channel is pinned to a stale
commit**, so any device that arms the updater is silently downgraded to it. This is precisely the
failure the 1 Aug system was torn down for ("a stale bundle silently downgrading installs"), now
reproduced by the rebuild on its first real device.

`CapacitorUpdater.reset()` and `delete()` did NOT hold - the bundle re-applied on the next launch.
The only reliable local escape was to unlink the plugin and rebuild. **Decision: do not arm OTA on
any device until the live channel is correct.** Fix the channel (or flip the Phase-1 kill switch,
which is designed to make devices `reset()` themselves) FIRST, arm second. `autoUpdate:"off"` in
`capacitor.config.json` and `isAuto()` in `native-ota.js` were both verified correct, so the apply
path is either the update banner being tapped or something outside those two gates - **worth
establishing before this is armed again.**

**Method note worth keeping:** three wrong diagnoses (service worker, wrong `App.app`, WebView
cache) were guessed before anyone looked. The answer took five minutes once
`ios_webkit_debug_proxy` was pointed at the running WebView and it was asked directly. For a
native WebView bug, attach the inspector FIRST. Note iOS needs the `Target.sendMessageToTarget`
envelope; a bare `Runtime.evaluate` returns "'Runtime' domain was not found".

## 2026-08-22 · CliniX: one skill object, many runners, and two gates that fail closed
New module for medical students (see [[CliniX]]), built behind `smd_clinix` def:false off tag
`pre-clinix`. Three decisions worth keeping.

**1. The atom is a Skill, and Learn / Case / OSCE / Viva / Competency are PROJECTIONS over it.**
The alternative, which every LMS reaches for, is to author a lesson, then an OSCE station, then a
viva bank. That triples the content and guarantees they drift. Here `compileLesson()`,
`compileStation()` and `compileViva()` all read the same object, so an OSCE station is a *selection
of skills plus a clock*, not authored content, and a single `competencyKey()` is what all three write
against. A disease does not own skills, it references them and adds `emphasis` - which is what makes
the fourth disease cheap rather than a fourth full authoring job.

**2. CliniX is built like RadioAnatome, deliberately NOT like the KardiQ Learn atlas.** This is a
measured call, not a stylistic one. `kardiox-content-pack.js` is 1.9 MB of JS parsed on every page
load for every user whether or not they open Learn; `management` is `string[]` in 100 records and
`""` in the other 1,041; user state (`status`, `masteryPct`, `bookmarked`) lives INSIDE content
records and is therefore frozen at `"new"`/`0` forever; `tier:"atlas"` matches none of its own UI's
tier chips, so **all 1,041 pack lessons are unreachable through the UI that ships with them**; and
`assets/kardiox-learn/` holds 872 images with no manifest and no licence record. `atlas.js` already
demonstrates the right answer in this repo: a small catalog, lazily fetched per-unit JSON, and
`atlas-pipeline`'s `require_clear()` licence gate. CliniX takes that, and grounds content in
`kb/reference/*` (4,664 Harrison-cited entries with per-entry review state) rather than authoring a
parallel corpus.

**3. Both gates fail CLOSED, and the module ships with them closed.** The review gate: content whose
`review.status` is not `approved`/`published` never reaches a student, and a missing or garbled
status reads as `draft`. The licence gate: media renders only when `cleared === true` with a real
licence and attribution; **absence of a licence record is a refusal, not a default-allow**. The
consequence is deliberate and visible: all Phase-1 COPD content is `ai_drafted` and no media is
cleared, so a student today sees an explicit "Awaiting clinical review" state and lessons render
captions rather than assets. That is the gate working. **Never flip `review.status` to `approved` to
make a screen look finished** - the whole point is that the owner's clinical sign-off is the only
thing that opens it.

A fourth, smaller call: mastery requires repeated success on SEPARATE days, not one correct answer
(which is what `kardiox-providers.js:112` does, and why no row in the ECG atlas ever shows mastered).
**Status**: Phase 1 built, flag OFF. 55 unit + 36 real-browser checks green; full suite shows 104
failures before and after, identical set, verified against `pre-clinix` in a clean worktree.
**Open for the owner**: per-skill clinical sign-off, and the media work order in
`clinix/media/manifest.json`.

## 2026-08-04 · SknX AI Phases 2-3 (educational report merged; clinician-Rx built OFF)
See [[SknX]]. **Phase 2 (MERGED, PR #622):** evidence-grounded educational dermatology report using the REAL Gemini/Vertex transport (`functions/api/sknx` reuses `callGemini`, mirrors the audited thorex proxy) + Explain-Like + Compare. Three hard invariants, each tested: no raw image/PHI to the LLM (image-key reject + strict whitelist + recursive scan; TEXT-only prompt), no hallucinated citations (guidelineSummary/references only from the vetted `sknx-evidence.js` corpus; the LLM writes only the free-text discussion), no Rx (deterministic management principles; LLM discussion dropped if it looks like an Rx). R2 (AI-safety) + R1 (clinical) APPROVED; referral guardrail INTACT. **Phase 3 (built, branch `claude/sknx-phase3`, flag OFF):** `smd_sknx_rx` def:false. `sknx-rx.js` drafts a class-level first-line regimen (no patient dose) the clinician confirms/doses/signs in the existing `SMD_RX` pad; the affordance is impossible unless rxEligible + not-referral + flag-on + verified-prescriber, and malignant/urgent conditions (melanoma/BCC/SCC/cellulitis) are never draftable. **Decision: SknX never prescribes autonomously and never on a malignant/referral case; the `smd_sknx_rx` flag must NOT flip on without R1 clinical + R3-DPDP + R7 sign-off.** **Why:** prescribing is the one clinically-loaded capability; keep it clinician-confirmed, KB-grounded, reversible, and hard-gated. **Trade-off:** the real vision models (weights + native Core ML/TFLite) remain the one asset-dependent piece; everything else is real/mock-swappable. **Status:** Phase 2 merged (R1+R2 clean, 75 unit + 19 e2e); Phase 3 flag-OFF scaffold, 82 unit + 23 e2e green, pending R1 GO/NO-GO + its own PR.

## 2026-08-01 · Connect Track A (FHIR/SMART) + Track B (HL7/CSV legacy feeds)
Built on `feat/connect-fhir-smart` (off merged main; tag `pre-connect-fhir`), both behind own flags default OFF. **Track A** = synchronous FHIR R4 **pull** via SMART Backend Services (`private_key_jwt`): asymmetric-only signer (alg:none/HMAC structurally impossible), token-endpoint **trust gate** validated pre-sign + re-asserted pre-POST, envelope-sealed NON-PHI token cache, same-origin pagination, FHIR->SCCM. **Decision:** the frozen `SMART_HOST_ALLOWLIST` is a HARD CEILING — a per-tenant config override may only NARROW it (fix from the token-exchange red-team, which also caught a string-allowlist substring-match degrade + an unvalidated-fhirBase SSRF); connector is dual-mode (SMART when `secret_ref` present, else Phase-0 no-auth) for zero regression; scope is SCCM-canonical (medications family = MedicationRequest+MedicationStatement). **Track B** = HL7 v2 + file/CSV **event/push** via one HMAC-gated ingest spine (mirrors abdm/ingress): verify(constant-time HMAC)->replay(freshness+HMAC'd nonce)->correlate(authoritative tenant from `connect_feed`, headers cross-check only)->route->validate/filter/PHI-free-audit->discard; hand-written no-dep parsers, warn-never-throw, budget-bounded; no StewardMD actor on push. **Why:** realizes the reserved pull + event profiles; the egress/auth boundary lives where the secret/PHI crosses. **Trade-off:** AL1/DG1 ADT maps + local->LOINC crosswalk owner-gated/deferred. **Status:** 391 connect (incl smart/hl7/csv/abdm) + 208 top-level green, zero regression; benches under budget; DUAL-ADVERSARIAL reviews on the signer/token (SAFE, exfil HIGHs fixed) + HL7 parser + ingest spine. NOT merged/pushed — owner // VERIFY the real FHIR+AS host allow-list, client registration, and the HL7 inbound auth/transport before any real feed (see `docs/connect/track-a-b-onboarding.md`). See [[Home]].

## 2026-08-01 · Connect Track D — Enterprise RBAC + MaiK wiring behind the egress gate
Built (behind `smd_connect` + new `smd_connect_maik`, both OFF; tag `pre-connect-track-d`, branch `feat/connect-track-d-enterprise-maik`): (1) deny-by-default fail-closed RBAC (owner/admin/clinician/auditor) on the existing membership seam — PHI actions are clinician-only, `egress:baa` owner-only; (2) MaiK consumes canonical SCCM via `buildMaikContext` behind the R7 `assertEgressAllowed` gate. **Decision:** the wiring is SERVER-CENTRIC — the single existing-file touch is one flag-gated, fail-safe block in `functions/api/ai/[[path]].js` (before `renderGroundedPrompt` in `explain`); the client `home.js` is untouched; the patient binding is server-held (envelope-SEALED in KV, no raw patientRef in KV). Only the R7-GATED egress lane is folded into `pkg.patientCase`; a live bundle without `egressBaaOk` feeds the deterministic lane only (served to the clinician's device by the new `functions/api/connect/maik` surface), NEVER the LLM. **Why:** `callGemini` is the third-party egress, so the invariant must live where the egress lives; flag-off is byte-identical (63 ns hot-path). **Trade-off:** meds/allergies fold into the existing `findings` channel (no second live-function change); `research` handler + target-in-audit deferred. **Status:** 118/118 connect + 208/208 top-level green, zero regression; DUAL-ADVERSARIAL reviews on RBAC + egress gate. NOT merged/deployed — owner ratifies the RBAC matrix + flips `egressBaaOk` only after BAA/DPA + no-retention LLM tier (see `docs/connect/track-d-enterprise-maik.md`). See [[Home]].

## 2026-07-30 · Block internal source/docs from public serving
Pages serves the repo root, so `docs/` (runbook) + `CLAUDE.md` were publicly reachable (leaking team ID, SHA fingerprints, the inert-gate-key note). `functions/_middleware.js` now 404s internal paths (`docs/`, `vault/`, `ios/`, `*.md`, `CLAUDE.md`…). **Trade-off**: none for the app (only web assets are served). **Status**: live. Protects [[Home|this vault]] too.

## 2026-07-30 · On-demand native assets (fetch from stewardmd.in)
Heavy, flag-gated module assets are stripped from the native bundle and fetched on first use, cached by the WebView. First: [[FundX]] MediaPipe (~22 MB). **Why**: shrink install. **Trade-off**: one-time download on first module use (fallback: LOCAL→SELF→CDN, so nothing breaks). **Status**: phase 1 live (AAB 124→115 MB); ONNX / Learn / ML-Kit / offline-KB pending — see [[Roadmap]].

## 2026-07-30 · Vision/OCR pinned to a strong fixed model
[[Scan-Meds and Drug Index]] `/vision` used the global model → an admin model-override to `gemini-3.5-flash-lite` degraded handwriting OCR. Now `VISION_MODEL` (default `gemini-2.5-flash`), ignoring the text override + emergency-cheap. **Why**: misreading a drug is a safety risk. **Status**: live.

## 2026-07-30 · Admin access = exactly 3 owner accounts
`drmanojkurmana@` / `mkkmanojkumar0@` / `kdiwakar45@gmail.com`; removed `stewardmd.in@`. Set in ALL gates (server `_adminauth.js` + `verifications`, client `home.js`/`sidebar-redesign.js`) + env `OWNER_EMAILS`. Server (Firebase id-token email) is the real boundary; client lists = UI visibility. **Status**: live.

## 2026-07-29 · Intent Firewall = allow-list, not block-list
See [[MaiK Intent Firewall]]. Require a positive medical signal; reject the rest. **Why**: a block-list can't enumerate all non-medical topics. **Invariant**: zero false-refusals. **Status**: live (gold1041).

## 2026-08-20 · Intent Firewall: refuse only what we can NAME; the model handles the rest
Amends the 2026-07-29 allow-list decision, which stood on one wrong assumption: that "no positive
medical signal" means "not medical". It means "not in our vocabulary". A doctor's own device transcript
had MaiK answering "What is PCOD?" and "What is SGLT2 drugs mechanism of action?" with "MaiK is for
healthcare professionals. It answers only medical and clinical questions." The **invariant of zero
false-refusals was being violated by the firewall's own default branch**, and no amount of vocabulary
can close it - medicine is open-ended.

**Now:** `classify()` returns `certain:true|false`. Gate on `MaiKScope.isRefusable(q)`, which is true
only for a POSITIVELY identified non-clinical category (code / creative / general / lay). An
unrecognised query goes to the model, and the model refuses non-medical itself (`MEDICAL_ONLY` in the
Vertex prompts, and a medical-only line in the on-device SYSTEM prompt). The model has the world
knowledge to tell PCOD from a state capital; a regex does not.

**Cost accepted:** a genuinely non-medical query that we cannot name deterministically now costs one
model call to refuse. The named shapes (code, creative, general knowledge, travel, sport) are still
refused for free. That trade is the right way round: a wasted call is cheap, telling a doctor their
clinical question is not medical is not.

**Corollary:** the client gate and the server `firewallBlock()` must share ONE predicate. They had
drifted - the server already excluded the uncertain bucket, the client did not, and the client is what
doctors saw. **Status**: live. See [[MaiK Intent Firewall]].

## 2026-08-21 · iOS background download is capped ~1 MB/s; chunking buys resilience, NOT speed
**Measured, after two wrong turns.** The controlled comparison that settled the diagnosis was the
owner's own: same Wi-Fi, same room, same hour, same 3.11 GB file on HuggingFace - **Android
DownloadManager 10.5 MB/s vs iOS background URLSession 1.3 MB/s**. So the origin is not the cap and
**R2 would not fix iOS**; the ceiling is client-side.

**The burst-vs-sustained trap.** A DownloadProbe measured 20 MB bursts: default session 6.55 MB/s,
background 1 stream 1.08 MB/s, background 4 range tasks 4.77 MB/s. The 4.4x looked like a per-task
throttle, so a chunked downloader was built on it. The real sustained number, read off the `.parts`
sidecar after a 2.49 GB attempt, was **1.04 MB/s across 8 parallel parts** - identical to one stream.
**A 20 MB burst does not predict a 2.5 GB transfer**; iOS gives an initial allowance and then caps the
session. Measure sustained throughput for a sustained feature.

**Chunking was kept anyway, on different grounds:** 64 MB ranged parts written straight into the final
file at their offset, with a `<name>.parts` sidecar. It buys resilience, not speed - a part is the most
that can be lost, progress survives crashes AND app reinstalls (verified: 1.38 GB preserved across a
reinstall), and a failure at 89% no longer costs 2.5 GB. The sidecar is also the best measurement tool
available: pull it with `devicectl device copy from` and count '1's, no console needed.

**Still untested:** whether a DEFAULT session sustains ~6 MB/s. Only the burst figure exists, and
extrapolating it is exactly the mistake above. If it does, a foreground-first chunked download is worth
building - and chunking is what makes it safe, because backgrounding would cost only the in-flight
parts. **Status**: chunked background download shipped; speed unresolved and honestly so.

## 2026-08-21 · On-device model download stays on ONE background URLSession
**Rejected:** a foreground/background hybrid (default session for speed while on screen, handed to the
background session on `didEnterBackgroundNotification`). It was built, shipped to a device, and
**reverted the same night** because background downloads stopped working: `cancel(byProducingResumeData:)`
is ASYNCHRONOUS, so it tears the running transfer down immediately and iOS suspends the app before the
completion block can restart it on the background session. The download died the moment the app left
the screen.

**The mistake worth remembering** is not the API detail, it is the trade: a VERIFIED capability (a
2.49 GB model completing with the app force-stopped) was risked for an UNMEASURED speed hypothesis.
The 0.5 MB/s figure came off the UI and was never confirmed natively, and the diagnosis ("iOS
background sessions are throttled") was inferred from a Mac-vs-phone comparison, not measured on the
phone. Correctness that is proven outranks speed that is assumed.

**What was kept:** native throughput printing (`[llama-dl] … MB/s`, readable via
`devicectl --console`), so the speed question can finally be measured rather than argued.

**If throughput does need work,** prefer options that keep a single background session: several
concurrent background tasks over byte ranges (a background session may throttle per-task, and a Mac
test showed only a 23% gain from parallelism on an UNTHROTTLED session, so the per-task theory is
untested and worth measuring), or host the files closer to the user (R2, APAC). Do NOT reintroduce a
foreground/background handoff. **Status**: reverted, background-only shipped.

## Standing principles
- **Reversible changes**: big/risky changes go behind a feature **flag** + a git **recovery point** (tag/branch); made permanent only after owner approval.
- **Test before you build** (owner mandate): unit + a real headless-browser test before shipping UI/logic.
- **No em-dash** in app-facing text (MaiK AI *output* exempt).
- **Mobile-only**: the web code IS the app (Capacitor renders local `www/`).

## 2026-08-21 — Never deploy a subset of a branch by copying whole files
Hand-copying `functions/api/ai/[[path]].js` from a feature branch onto main (`6064c197`) silently
REVERTED three later main commits and took MaiK Cloud down with HTTP 500 (no provider failover).
Cherry-pick hunks instead, and prove the result: `git show <target>:<file> > /tmp/x && diff /tmp/x <file>`.
A correct server fix was then masked for another hour because the **WebView had cached the failure** -
clearing `cache/` + `app_webview/Default/Cache` fixed it without wiping login or the 2.5 GB models.
Full write-up: `vault/handoff/2026-08-21-maik-cloud-outage.md`.

## 2026-08-22 — ICU visual design system (visual layer only, UX locked)
The ICU dashboard was restyled to read as mature clinical software rather than a generic SaaS
surface. The rule for the pass: **treat the UX as locked** and change only the design layer, so the
whole redesign lives inside `icu.js` `injectCSS()` (plus the one inline `style=` on the unit-picker
card). No component, action, screen, filter, alert rule or navigation path was added, removed or
renamed; `git diff` on that commit contains only CSS declarations and comments.

The system:
- **Surfaces** — paper-grey ground (`--bg`), white `--panel`, recessed `--panel2`; separation is done
  by hairline `--border`, not shadow (`--sh` is a single 1px lift; `--sh-lift` for pressed/raised).
- **Radii** — a 12/10/8 step (`--r`/`--r-sm`/`--r-xs`) replacing 16px + pill-everything. `--r-pill`
  is kept for the genuinely round things (avatars, dots, badges).
- **Colour** — one deep teal accent (`--primary`/`--primary2`); status colours (danger/warn/ok) are
  reserved for status, and acuity now tints the bed tile only when it means something (a stable bed
  is neutral, so exceptions pop). Header chrome is flat `--primary2` — the gradients are gone.
- **Type** — weights pulled down (800 → 600/700), eyebrows 10.5px/.11em, body copy at 400, and
  **tabular figures on every measured number** so vitals/labs/doses stay column-aligned as they change.
- **States** — no scale-bounce; press = brightness/surface change, selection = colour + weight (+ a
  tinted plate in the bottom bar), so selection survives glare and colour-vision deficiency.

Verified by re-running the ICU browser suites (nav, alerts, modal-color, safety-ux, dx-flow,
swipe-remove) — unchanged, incl. the pre-existing failures in `run-icu-nav` / `run-icu-labwatch`
which reproduce identically on the parent commit.

## 2026-08-22 — The StewardMD ID is minted at sign-in, for everyone
The `SMD-XXXXXX` ID was reachable through exactly ONE path: `icu-collab.ensureIdentity`, guarded by
`icuGroupsOn()` and called only from `grpEnsureGroupsSub`. So an ID existed only after a user turned
**Group mode on** AND a unit resolved. That is backwards: a resident does not create units — someone
adds them to one, **by their ID** — so the people who most need an ID were the ones who could not
get one without toggling Group mode purely to mint it. `steward-id.js` already implemented a
universal mint (Phase 1, PR #545) but nothing ever called it: its bootstrap was flag-gated AND ran
`if (window.firebase)` at parse time, while index.html loads the Firebase SDK lazily on idle.

**Decision**: the ID is universal and unconditional, like a national ID number. It is minted on
sign-in for every user (`steward-id-onboard.js`, waiting for `SMD_loadFirebase`), the `icuGroupsOn()`
guard is gone from `ensureIdentity`, and the ID card shows on the solo ICU Team screen too.
Reversibility is a **kill switch, not a rollout gate**: `smd_steward_id_mint` defaults ON and can be
set to 0 to stop the per-user write without a redeploy. The verified-email / Apple-proxy **capture
UI** stays behind `smd_steward_id` (default OFF) — it has open R3/R5 items; minting does not.

**Consequence to know**: every signed-in user now gets a `doctorDirectory/{smdId}` entry holding
`{uid, name}`. That collection is get-only and never listable (rules), so it is a lookup key, not a
public roster — the same exposure ICU users already had, now for all users.

**Latent bug this exposed and fixed**: identity was cached without its uid. With minting universal,
sign-out → sign-in as someone else happens inside one page lifetime, so account B would have been
handed account A's ID — and it would have travelled into referrals, invites and the directory. Both
caches are now keyed on uid and `my(uid)` refuses a mismatch. See [[StewardMD ID]].

## 2026-08-22 — One profile page, and it never renders a shorter version of you
The account sheet had three problems: the StewardMD ID was absent (the only place to read your own
ID was ICU → Team), the professional details (reg no · hospital/college · city · phone) were
appended ONLY inside a successful Firestore `.then()`, and edits went through `window.prompt()`.

The second one is the real bug: when the read was slow, the user signed out, or `SMD_DB` wasn't up
yet, the rows simply never appeared — so the page looked like a profile with nothing filled in
rather than a profile that failed to load. **A UI that degrades by omission lies about the data.**
Every row now renders in every state (loading / loaded / empty / unreadable), with an explicit
"Couldn't load your details · Retry".

Also: `openAccount()` is exported as `window.SMD_openProfile` so all entry points open ONE page —
the sidebar identity block (tapping your own photo, which was previously inert), More → Profile, and
a new Settings → Account → "Profile & StewardMD ID" row. `window.prompt` is replaced by in-place row
editing (hospital keeps the searchable directory picker). Test: `test/run-profile-ui.mjs`, which
drives the real sheet and asserts the failure state still renders all four rows. See
[[StewardMD ID]].

## 2026-08-22 — AI may draft the discharge narrative, never the prescription
"Draft with MaiK" in the Discharge Creator writes prose into a medico-legal document, so the design
is mostly a set of refusals. MaiK drafts exactly four sections — hospital course, condition at
discharge, follow-up, advice to patient — and is explicitly forbidden, in the prompt and by having
no field to write into, from touching:

- **Discharge medications.** Medication reconciliation is the highest-risk act in the document. The
  existing R1 decision already refuses to auto-seed it from running infusions (a summary must never
  tell a GP the patient goes home on noradrenaline); an AI that lists drugs it inferred is that same
  failure with better grammar. Meds stay the clinician's Treatment list.
- **The final diagnosis.** Ask MaiK has never been allowed to set a Dx; drafting a discharge does not
  change that.
- **Pending results.** Asserting that a culture is pending when nobody recorded it is inventing
  clinical fact.

Two further rules: the prompt forbids inventing any value and requires missing data to come back as
a bracketed prompt (`[ confirm admission date ]`) rather than a plausible guess; and **nothing is
written into the form until the clinician ticks that section and presses Insert** — a draft that
silently fills fields is a draft nobody reads. The guideline basis MaiK cites is shown for review and
deliberately NOT inserted, so nothing unverified travels into the printed document.

**Open question for the owner**: whether the printed summary should carry a provenance line saying
parts were AI-drafted. It is stamped DRAFT and clinician-review-required either way, but the
medico-legal answer is a product call, not an engineering one. Deliberately not decided here.

## 2026-08-28 — Interstitial revamp is a flagged override layer, and the returning-user splash is personalised
The three interstitials (boot splash `#smdBootSplash`, first-run intro poster `#introPoster`, landing
splash `#splash`) all live inline in `index.html` — the poster's phase logic sits in the minified
`app.js`, and the poster/landing CSS is inside the ~100 KB single-line `<style>` blob on line 30.
Editing that blob in place would have been an unreviewable diff with no way back, so the revamp is an
**additive override `<style>` layer scoped to `html.smd-splash-v2`**, appended in readable form just
above the poster markup. Flag resolution copies the `rds-on` pattern set before first paint: default
**ON**, `?splashv2=0` or `localStorage smd_splash_v2="0"` reverts. No markup, IDs or phase logic
changed, so `app.js` is untouched and the fallback is exact.

Scope of the visual change is deliberately narrow: composition, spacing, type hierarchy, micro-motion.
The palette is unchanged (same teal `#3fc7b3` / `#0e6e63`, paper `#f6f7f5` and navy-teal gradients the
originals used). Reduced-motion was previously honoured only on the boot splash; the layer now covers
the poster and landing splash too.

**The returning-user splash is personalised with the clinician's own profile photo.** `#smdBootSplash`
is the only interstitial a returning user actually sees (the gate at the top of `index.html` hides
`#introPoster` and `#splash` for them), so that is where "welcome back" belongs. It reads the SAME
record the sidebar and profile sheet read — `localStorage "stewardmd_account"` (`.name`/`.email`/
`.picture`, mirrored from the Firebase user by `account.js`) — because Firebase has not booted that
early; no new avatar field was invented. Signed-in users only; guests and first-time users keep the
brand tagline, and the poster stays entirely logo/brand-led. The photo is accepted only over `https:`
and falls back to a monogram if it fails to load; nothing is written or transmitted. Test:
`test/run-splash-ui.mjs` (CDP, 390x844, covers both flag states and the guest path).

The layer sits on top of the same day's "broaden the splash from antibiotic-only to full platform"
change and styles its module-pill strip too, tightened so the five pills read as one balanced row at
390px instead of breaking 4 + 1.

Also fixed there: `.ip-dev-maik-logo` carried `filter:invert(1)` over a white-on-transparent asset, so
the credit wordmark rendered black on the dark poster. It now uses `brightness(0) invert(1)`, matching
`.dev-studio-logo`.

## 2026-08-28 - Interstitials adopt Direction C (gradient depth, glass cards, real brand assets)
The owner was shown three design directions for the five interstitial screens and picked **Direction C**
(modern app-native: gradient depth, glass cards, bold type). It is built as a **restyle of the existing
`html.smd-splash-v2` override layer**, not a new mechanism: same flag, same default-ON resolution, same
`?splashv2=0` / `localStorage smd_splash_v2="0"` revert, still zero markup / ID / `app.js` changes.

The visual language, from the approved mockups:
- a deep teal-to-navy radial gradient mesh with two soft off-edge glows (teal, amber), expressed as
  extra `radial-gradient` layers in one `background` rather than blurred blob elements, so there is no
  `filter:blur` compositing cost on device;
- glass cards (`rgba(255,255,255,.06-.07)` fill, hairline border, `backdrop-filter:blur(10px)`, 18-26px
  radius, soft elevation) for the AMR stats, the credit card, the case preview and the boot-splash foot;
- bold tight-tracked display type (700-800, -.01 to -.02em), tinted pill chips (teal `#6fe0cf`, amber
  `#f0c060` for the risk/de-escalation note), progress dots as rounded-rect pills with an elongated
  active pill, and a teal glow shadow on the primary CTA only.

Two structural notes worth keeping. `.ip-bg` animates the `background` **shorthand** via `ipBgShift`,
and a keyframe beats a normal declaration, so the previous layer's `.ip-bg{background:...}` never
actually applied; the Direction C rule sets `animation:none` first. Phase 2 and phase 3 are recomposed
without touching markup: the AMR block flips from a 3-up grid to stacked rows by setting
`grid-template-columns:1fr`, and phase 3 becomes one glass card by styling `#ipPhase3` itself and
re-ordering its children with flex `order` (quote, then credit, then copyright).

**Brand marks are the real assets, not drawn shapes.** The mockups used a placeholder shield-and-pulse
SVG and a typographic "MaiK" because the canvas tool could not reach app assets. The shipped layer uses
`/mark-white.png` for the app mark (phase 1 and the landing splash, swapped in via CSS `background` so
the markup is untouched) and `/maik-logo-white.png` for the "a product of" / "developed by" credit,
preserving the existing `.sbs-maik-light` / `.sbs-maik-dark` theme pairing in `.sbs-foot`. Only genuinely
decorative shapes stay generated: the phase-1 pulse line (an inline SVG data URI) and the avatar's
online-status dot.

The boot splash keeps both themes: Direction C's gradient mesh on `.sbs-dark`, a light equivalent
otherwise. The C5 avatar treatment (84px gradient avatar, status dot, translucent "Loading your
workspace" pill) applies **only** in the personalised state, off the same `stewardmd_account` record as
before; the guest and first-run paths are structurally unchanged. Reduced-motion coverage from the
previous layer is retained and now also stills the loading pill. `sw.js` `CACHE` bumped to
`...-splashv2c`. Test: `test/run-splash-ui.mjs`, extended to assert the Direction C treatment, that the
real brand assets resolve 200 (not 404 placeholders), the dark boot splash, and reduced-motion.

## 2026-08-28 — The interstitials get a display face (Bricolage Grotesque) and a hero mark
Review of the Direction C interstitials: *"looks like created by generic vibe coding"*, *"make font
better"*, *"I want StewardMD logo to look big and better"*. Direction C's foundations (gradient mesh,
depth, palette, real brand assets) were kept; what read as templated was the type and the composition.

**One self-hosted display face, not another weight of the UI sans.** `Bricolage Grotesque` (SIL OFL
1.1) now does every brand and headline moment on the five interstitials; supporting copy stays on
`var(--sans)`, so the two roles read as two voices. It was picked for having actual idiosyncrasy in the
letterforms while staying clinical, and for its 200..800 weight axis, which is what carries the
recurring device: **weight contrast on one line** ("Steward" at 300 against "MD" at 800; the AMR
headline at 800 against its kicker at 200). Display sizes are set tight (-.045em) and small labels
loose (.24em) so the hierarchy is optical rather than numeric.

`@font-face` lives in `redesign-system.css` with the other faces, `font-display:block` (as Sacramento
does) so the word-mark never flashes in a fallback, plus a `<link rel=preload>` in `index.html` so that
block period is effectively zero. **Self-hosting is not optional here**: the interstitials paint before
any network is guaranteed inside the Capacitor shell, so a runtime Google Fonts `<link>` would silently
fall back to the system sans offline — exactly the failure that would undo the change invisibly.
`assets/fonts/bricolage-grotesque.woff2` is the Latin subset trimmed to the characters these screens
use with both axes kept, 48 KB (the same size as the bundled Inter). `scripts/build-www.sh` already
copies `assets/fonts/*`, so it ships in the native bundle with no build change.

**The mark is a hero, not an icon in a tile.** 152px on poster phase 1, 118px on the landing splash,
126px on the boot splash, standing free with its own glow and drop-shadow. The rounded glass tile that
used to box it in is gone — it was the single most template-looking element in the set. Note the glow
goes only on `.sbs-mark` (a CSS mask, genuinely transparent); `/logo.png` is opaque to its edges, so a
drop-shadow on `.sbs-logo` renders as a square halo around the artwork.

**Composition.** The poster is left-aligned and top-weighted so phases 1-3 share one axis instead of
being three centred slides, and phase 1 is dropped 58px below the optical centre (via `position`, since
`.ip-phase` runs the ipRise transform) so the empty upper half reads as sky. The AMR figures are an open
list hung off a teal rule rather than a third identical glass card; cards are now the exception (the
credit, the case preview), which is what makes them read. Landing module pills became squared hairline
chips with only the first filled.

Gotcha worth keeping: **phase 3's quote `<br>` must stay.** The markup is `...the only thing<br>standing
between...` with no space either side, so `br{display:none}` sets "thingstanding".

Still presentation-only and inside `html.smd-splash-v2`: no markup, ID or logic changes, flag and
`?splashv2=0` revert unchanged, reduced-motion still covered. `sw.js` `CACHE` and the
`redesign-system.css` token bumped to `splashv2d`. `test/run-splash-ui.mjs` extended to assert the face
genuinely LOADS (`document.fonts.check` on both ends of the axis, the loaded-font set, canvas metrics
differing from the fallback stack, and the woff2 returning 200) alongside the hero sizes, the absent
tile chrome and the weight contrast.

## Interstitials: Apple-style liquid glass for every splash surface (2026-08-28)

Owner review of the LIGHT-theme personalised boot splash on device: he circled the "Loading your
workspace" pill and the "developed by MaiK" footer bar with "can we make this marked boxes liquid
glass for all - it should look like apple liquid glass". Direction C's surfaces were
"translucent fill + flat 1px border + blur(10px)", which on a near-white field renders as a flat
white shape with an outline. On the dark screens it passed; on light it was the flattest thing in
the set.

**One material, six tokens.** `--lg-blur / --lg-blur-sm`, `--lg-fill(-d)`, `--lg-rim(-d)`,
`--lg-inset(-d)`, `--lg-shadow(-d)`, `--lg-solid(-d)` are declared once on `html.smd-splash-v2` in
the boot-splash `<style>` and consumed by the poster/landing layer further down (custom properties
cross `<style>` boundaries, so the two layers stay separate but share one surface language). Every
pill and card on the five screens is rebuilt from them: the loading pill, the developed-by bar,
poster phase 3's credit card, the skip pill, the landing case card, the module chips and the CTA.

What actually makes it read as Apple glass, rather than generic glassmorphism:
- **refraction**: `blur(22px) saturate(180%)` (16px on small controls, so a 30px pill does not smear
  the whole background), always with the `-webkit-` twin, since iOS renders these in WKWebView.
- **specular edge as a 1px GRADIENT border**, not a solid one: the sheen fill is painted to
  `padding-box` and a rim gradient to `border-box` in one `background` shorthand, so no
  pseudo-element is needed (several of these surfaces already spend `::after` on content).
- **layered inset highlights** top and bottom plus a soft ambient drop shadow, which on the light
  theme is most of what makes the glass visible at all.
- **something worth refracting**: the light boot splash's radial blobs were so faint the backdrop
  was effectively flat white, so they were strengthened and two were added under the pill and the
  foot bar. Light-theme copy darkened (`#4a6577` / `#54707f`) to stay readable on the brighter fill.
- **the CTA stays tinted glass**, not clear: a near-solid teal gradient keeps the dark label legible
  and keeps it reading as the one tappable thing; the glass shows up as rim, sheen and refraction.

**Fallback is mandatory.** Each surface has a more opaque plain fill + solid hairline outside the
`@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px)))` block, so a WebView
without backdrop-filter still gets a legible panel.

**Gotcha found here:** `home.js` injects `body.ui-v2 .demo-card{border-radius:16px!important;
border:...!important;box-shadow:...!important}` for the advanced app theme, and that sheet lands
after `index.html`. It had already been flattening the landing case card whenever that theme was on.
The interstitial is a splash surface, not an app card, so `html.smd-splash-v2 #splash .demo-card`
now re-asserts its radius/border/shadow with `!important`. Scoped to that one card. This also made
the harness flaky: the assertion passed or failed depending on whether the injected sheet had landed.

Same commit, owner's second ask: the interstitials display the brand as **StewardMD**, never
"StewardMD.in". Two visible spots, both plain copy in the poster markup: the `.ip-in` superscript on
the phase 1 word-mark and the phase 3 copyright line. Functional uses of the domain (api endpoints,
`mailto:Support@StewardMD.in`) are untouched.

Still presentation-only inside `html.smd-splash-v2`: no layout, size, ID, data or flag changes, and
`?splashv2=0` reverts everything. `sw.js` `CACHE` and the `redesign-system.css` token bumped to
`splashv2e`. `test/run-splash-ui.mjs` grew a `glass()` helper asserting blur+saturate, a rim/sheen
gradient and layered inset speculars on all seven surfaces in both themes, a source check that every
`backdrop-filter` in the material ships with its `-webkit-` twin (Chromium drops the prefixed alias
at parse time, so the CSSOM cannot prove it), and the two brand-text assertions.
## 2026-08-22 — OTA updates, Phase 1: rebuilding what was torn down, this time against the failure
This exact system existed once — self-hosted OTA on Cloudflare (Worker + R2 + admin console),
built 1 Aug 2026, deliberately torn down the SAME DAY. The retire commit is explicit:
"...so it can't be re-armed and leave a stale bundle silently downgrading installs (which is what
broke ICU once)." The user asked to rebuild it (22 Aug 2026), explicitly wanting a PUBG/Duolingo-
style banner update, admin-console control, easy undo, "full user and my control." Full plan
published as an artifact and approved before any code was written.

**Phase 1 (server-only, this session) is deliberately shaped around the one sentence above:**
- **Staging and going live are two different acts by two different systems.** CI (on every push to
  `main`) can only ever write a `candidate` pointer — nothing a device would see. Only an owner
  pressing "Push to devices" in the admin console moves the live channel. Confusing "a build
  exists" with "a build is live" is precisely what the 1 Aug system never separated.
- **The kill switch is the FIRST thing built, not an afterthought**, and is a single R2 JSON
  object checked on every device request — flipping it needs no redeploy, no rebuild, no code
  change. That is the direct fix for "the retire mechanism itself needed a redeploy to re-arm,"
  which is the actual mechanism of the original failure, not just its symptom.
- **Rollback republishes the OLD manifest under a NEW, higher version number**, never moving the
  counter backward — so a device that only trusts "is this newer than mine" still takes the
  rollback instead of silently ignoring it because the number went down.
- A device is never offered a release its native build can't run (`minNativeBuild` gate), and a
  missing/corrupt manifest fails the device check CLOSED, never with a half-answer.

**What's built**: `functions/_ota.js` (pure, deps-injectable, 12 unit tests — the kill-switch ones
are load-bearing), `functions/api/ota/[[path]].js` (HTTP surface), `scripts/ota-stage.mjs` +
`.github/workflows/ota-stage.yml` (auto-stage on push, reusing existing `CLOUDFLARE_API_TOKEN`/
`CLOUDFLARE_ACCOUNT_ID` secrets), a new `ota` pane in `admin/index.html` (18 UI tests against the
REAL console), and an `OTA_R2` binding reusing the existing `stewardmd-offline` bucket — no new
service, no new bucket, no new secret.

**What's deliberately NOT built yet**: the native client (`native-ota.js`, the update banner,
`notifyAppReady()` wiring) and the exact `@capgo/capacitor-updater` wire contract. Nothing in the
shipped app calls `/api/ota/check`. Guessing the plugin's exact release-artifact shape now, before
a real client exists to hold that guess accountable, is how a format mismatch would go unnoticed
until the one time it matters — Phase 2 pins it down against whatever version is actually
installed then. Full detail: [[OTA Updates]].

## 2026-08-22 — OTA updates, Phase 2: the native client, contract pinned against the real plugin
Phase 2 built the actual `native-ota.js` client (`window.SMD_OTA`) and, per the plan, pinned the
exact `@capgo/capacitor-updater` wire contract against the plugin's real current docs rather than
the stale Aug-1 assumption. Two corrections that came out of that verification:
- `capacitor.config.json`'s `autoUpdate` is a STRING enum (`"off"|"atBackground"|...`), not the
  boolean `false` the old plan assumed — using the wrong type would have silently left the plugin
  on its default `"atBackground"` polling mode, fighting our own manual check/download logic.
- Self-hosted delta-via-`manifest` support is ambiguous in the OSS docs. Rather than build against
  an uncertain feature, Phase 2 ships ONE zip per release (`scripts/ota-stage.mjs` now also zips
  `www/`, content-addressed like every other file) — simpler, verifiably matches `download({url,
  version})`'s documented contract, and the per-file manifest `_ota.js` already produces stays
  available for a real delta path later if it's confirmed to work self-hosted.
- The plugin is MPL-2.0, not MIT as stated in conversation earlier this session — corrected here;
  still free, still not the paid Capgo cloud (only their hosted service costs money).

**Two more decisions, both direct extensions of the kill-switch principle from Phase 1:**
- **The kill switch is enforced ON THE DEVICE, inside `check()` itself** — when the server reports
  `disabled` and the device is on a non-builtin version, it calls `reset()` and clears its local
  version right there. A device that already took a bad release does not sit on it waiting for
  someone to reopen the admin console; the moment it can reach the server again, it reverts itself.
- **Two install paths map to two different plugin calls, and nothing outside them is allowed to
  invoke either**: an explicit user tap (banner or the pre-existing Settings button) calls `set()`
  (immediate reload); the user's own opt-in "Automatic updates" toggle calls `next()` (queued for a
  future natural restart, never interrupting a live session). This is the literal mechanism behind
  "nothing applies without the user's own choice" — not a policy statement, an enforced code path.

**Reuse note**: `home.js` already carried a full, correctly-shaped Settings-page integration for
`window.SMD_OTA` (Automatic-updates toggle, Check for updates, Download & install), dormant since
before the teardown and guarded by `if (window.SMD_OTA && SMD_OTA.available())`. Phase 2 is built
to satisfy that EXISTING contract exactly, rather than design a new one — the row activates the
moment `native-ota.js` defines the global correctly, no home.js change needed.

Verified inert (zero exceptions, `available()===false`) in both non-target states: plain web, and
native-WITHOUT-the-plugin-yet — which is the actual state of the shipped app the moment this PR
merges, before the one Phase 3 native rebuild. Full detail: [[OTA Updates]].

---

## 2026-08-24 — MaiK latency: the model was never the main problem

Instrumented the WHOLE request instead of just the model call, and the long-held picture was wrong
in two ways. All figures measured on production, `?stream=1` with timings on the done event.

**Stage attribution (median), before → after:**

| stage | before | after |
|---|---|---|
| head — request entry to the answer path | 1112ms | 12ms |
| pre-Gemini — quota gate, re-rank, prompt render | 409ms | 76ms |
| Gemini first token | ~1900ms | ~1900ms (unchanged) |
| transport — real network | ~92ms | ~92ms |
| **non-model overhead** | **~1613ms** | **~230ms** |

**Decision 1 — "network latency" was a misattribution, and instrumentation is the fix.**
The ~1.2s repeatedly blamed on the network is 92ms of actual transport. The rest was our own code
running before the answer path started. `headMs` / `preMs` / `transport` are now reported separately
on the stream's done event specifically so this cannot be hand-waved again. Attribution before
optimisation — every guess made without it in this session was wrong.

**Decision 2 — KV WRITES were the dead weight, not reads and not the model.**
A KV write costs ~380ms in this Worker. `recordAiUsage` (the admin analytics rollup) was awaited in
front of every clinical answer at ~1096ms, and `checkQuota`'s rate-limit slot write was the final
~380ms. Both now run via `waitUntil`, CONCURRENTLY with the response. Every read in `checkQuota`
finishes in 8-15ms once parallelised — the reads were never the problem.

**What is deliberately NOT deferred**, because it gates: `checkModuleQuota` still counts per ATTEMPT
before the AI call (its contract — deferring it lets a burst exceed the daily cap), the cost cap
still blocks, `deviceCheck`'s READ still enforces the device cap. Refusal ORDER is unchanged:
circuit breaker → rate limit → per-user caps, each awaiting its own read before deciding. Only the
waiting is overlapped, never the decisions.

**Accepted trade-off, stated plainly:** deferring the rate-limit slot write narrows the double-fire
window from "none" to ~380ms on a control the code already documents as best-effort and non-atomic.
It buys 380ms on every answer.

**Decision 3 — prefill is NOT the TTFT floor, so context caching was NOT implemented.**
Tested directly: adding ~6,000 tokens of prompt cost only ~356ms of TTFT (~0.06ms/token), so the
whole 2,338-token system prompt contributes ~140ms of the ~1900ms. Vertex context caching would buy
~0.3-0.6s at most and was declined on evidence, not preference. Recorded so it is not re-litigated.

**Decision 4 — staying on `gemini-2.5-flash`, benchmarked not assumed.**
`gemini-3.1-flash-lite` BROKE live streaming (fell back to whole-answer; reverted immediately).
`gemini-2.5-flash-lite` gave ~200ms better TTFT but produced much longer answers, making total
latency WORSE (stream total 5527ms vs 3877ms), and carries a known router parse-quality regression.
The done event now reports the serving model so a model A/B is verifiable rather than assumed.

**Decision 5 — the router, not Gemini, was the biggest single wait.**
`/api/ai/refine` costs 6.0-7.7s and ran BEFORE the answer on every new question — 6.0s + 3.7s TTFV
is the ~9.7s clinicians actually saw. Now cached server-side (7.695s → 1.557s, `cached:"kv"`) keyed
by a SHA-256 of the normalised query, value = canonical concepts only, never the raw query; and
warmed client-side on a typing pause. Same router, same text, same result — only earlier, or not
repeated. Failed parses are never cached.

**Reliability:** the streaming path had NO timeout anywhere — a stalled upstream held the SSE open
until the phone gave up (measured: a 196-SECOND hang). Now bounded by connect/idle/total deadlines
with one exit that always emits a done event; a deadline-closed stream carries `stalled:true` and
the client refuses to surface it, so the new clean close cannot turn a truncated clinical answer
into one that looks complete. The other device "failures" were HTTP 429 rate limiting — the limiter
working correctly against a back-to-back benchmark, not a transport fault.

**Method note worth keeping:** every latency number before this was taken from curl on a laptop,
which is exactly how a 26.6s on-device regression shipped while curl looked fine. Device numbers now
come from `test/device/maik-bench.html`, run inside the real WKWebView on a physical iPhone via a
throwaway build launched with `devicectl ... --console`. Its control arm uses the PATCHED
`window.fetch` and reliably shows `ttfv == total` — proof on-device that CapacitorHttp buffers and
the pristine XHR transport is required.

---

## 2026-08-26 — Sign-out never wiped anything, in any module

**The gap.** CliniX, SknX, ThoreX, KardioX and SURGX each registered a `wipe()` on
`smd:signout` / `smd-signout` / `signout` / `smd:logout`. **Nothing in the repo had ever
dispatched one of those events.** Every module's privacy contract was dead code from the day it
was written; `kardiox-screens.js` even carried the note "hook the real signout".

Two things hid it. The real path (`signout-fix.js`) ends in `location.reload()`, so a fresh JS
context and a closed overlay *look* like a clean slate while the localStorage keys survive
untouched. And four of the five modules only called `wireSignout()` from `mount()`/`init()`, so
even a dispatched event would have missed any module the student had not opened that session.

**Consequence.** The next person to sign in on a shared device inherited the previous user's
CliniX competency, misses and resume tile; their SknX dermatology history; their KardioX/ThoreX
study records. On a shared ward device that is a real privacy failure, not a cosmetic one.

**Decision.** The dispatch belongs in `signout-fix.js` (the one place that already owns the real
teardown), fired BEFORE the reload — a wipe after the reload never runs. Modules wire their
listener at LOAD, not on mount. `SMD_SKNX_STORE` gained the `deleteAll()` its `wipe()` had been
missing (its handler was a comment reading "no bulk-delete API yet" while the store held up to
100 analyses).

**The consequence that needed a guard.** Making the wipe real also made sign-out an irreversible
way to destroy data: **SURGX notes are encrypted, device-local, have no server copy, and the wipe
deletes the encryption key with them.** Nothing in the app asked before signing out. Sign-out now
confirms *only when there are notes to lose* — an empty store stays a single tap. Fixing a
privacy leak must not quietly create a data-loss path.

**Also, same day, in CliniX:** OSCE graded each skill all-or-nothing
(`record(sid, ps.correct === ps.seen)`), so ticking 5 of 6 items filed one hard WRONG against the
whole skill and a well-performed chest examination read as a weak area. It now records one attempt
per checklist item, matching how Learn, Viva and Case record one per probe, and the miss log finally
names *which step* was missed. A null viva verdict ("MaiK could not judge") no longer fires the
wrong-answer haptic; reaching for the mic no longer erases what the student had already typed.

**Test-harness note.** `test/run-clinix-ui.mjs` reused one Chrome profile across runs, and it
toggles a *persisted* flag (`smd_clinix_viva_voice`) as part of its own assertions — so a passing
run left the flag ON and made the next run fail three checks against correct code. It had been
failing "viva opens on the MBBS tier by default" for the same reason. Fresh profile per run. A test
that fails because the last run of itself passed is worse than no test. (Second harness-state bug of
this exact shape this week; the first was `smd_verify_bypass`.)

---

## 2026-08-26 — SURGX notes get an encrypted Drive backup (the only clinical data with no copy)

**Why.** SURGX notes were the single piece of clinical data in the app with no copy anywhere:
encrypted by `surgx-store.js` under a **per-device random secret** with no server record. A
reinstall makes a new container and destroys them (CLAUDE.md records this costing a linked note
twice in one session), and once the sign-out wipe actually started running (same day, see above)
signing out destroyed them too.

**Why the local ciphertext could not simply be uploaded.** The device secret exists nowhere but
that phone. Uploading blobs encrypted under it would produce a backup no other device could ever
read: insurance that is worthless at the moment it is claimed. So the backup is **re-encrypted
under a password-derived key** (PBKDF2-SHA256 200k -> AES-GCM 256) that the surgeon can reproduce
on a new phone.

**Reused, not reinvented.** That scheme is `personal-clinic.js`'s `encryptBackup`/`decryptBackup`,
already shipping for My Clinic, and the same clinic backup password from the Keychain. One password
for the doctor, one crypto implementation to review, none to drift. Drive auth is native-auth's
existing `SMD_getDriveToken` (`drive.file` scope, so it cannot see the user's other Drive files).
`surgx-sync.js` adds no new auth and no new cryptography.

**Decisions worth not re-litigating:**
- **Opt-in, default OFF** (`smd_surgx_drive_backup`, def false). An app upgrade must never silently
  begin uploading operative notes. Both the feature flag AND a per-account toggle must be on.
- **Silence is not consent.** Personal clinic treats a missing auto-sync key as ON (opt-out). For
  PHI leaving the device that is the wrong way round, so `autoSyncOn()` requires an explicit `"1"`.
- **Both keys are per-account**, mirroring `surgx-store.js`'s `uid()`. Global keys would have meant
  the next person on a shared ward phone inherits "backup on" and starts uploading to their own
  Drive without ever agreeing, and is told they have a backup to restore when they have none. This
  is the same shared-device trap the sign-out wipe exists for.
- **Restore MERGES, newest-wins per note, never deletes.** A restore that dropped a note the phone
  had but the backup did not would turn "recover my notes" into "lose my notes".
- **ONE file, overwritten in place.** Drive must not accumulate a history of operative notes.
- **An empty note list never uploads**, so a fresh install cannot overwrite a real backup with an
  empty one.
- **A My Clinic backup is refused as a note backup.** Both use the same `{smd_enc:1}` envelope and
  `decryptBackup` opens either, so only the payload (`{surgx:1}`) can tell them apart. It is checked
  before anything is written.

**Consistency fix that came with it.** The Notes banner said "Encrypted on this device and never
uploaded ... Sign out wipes them" unconditionally. That becomes a flat lie once a backup exists, so
it now branches, and the sign-out confirmation softens when a backup is present (an alarming
"permanent loss" dialog shown to someone who set up a backup only teaches them to ignore dialogs).

**GHIS was already done.** `smd_surgx_dest_emr` has defaulted true, `/api/ghis/surgx-note` writes
over the same verified transport as the OPD assessment (visit activation, authoritative form
re-serialisation, patient_id mismatch abort, doc_id 0 refusal), gated by the same `QUEUE_EMR_WRITE`
env var. No new work was needed; it needs a patient with an ACTIVE assessment, which is what the
earlier live attempt lacked.

---

## 2026-08-27 — NMC Logbook: a regulatory record, built as a data layer that refuses

**Context.** StewardMD gains a Medical Education module. Phase 1 is the **PG digital logbook** that
PGMER-2023 §5.2(v)–(vi) requires every Indian PG resident to maintain. UG/CBME is explicitly out of
scope and was not built.

**The decision that shaped everything else.** A PG logbook entry is not app data. It is a document a
University examiner relies on, and **PGMER-2023 §9.2(c) puts a monetary penalty on the named
faculty / HoD / Dean who submits a false record**. So every guarantee is a **throw in
`pglog-model.js`**, the pure core that the client AND the Cloudflare Function both import — not a
disabled button, and not a server-only check that a future importer or admin script would bypass:

- `verify()` throws if the actor is the entry's author (namespace-tolerant, so `fb:uid` vs `uid`
  cannot silently disable the guard — that is exactly how this class of check dies).
- `applyEdit()` / `softDelete()` throw on a verified entry. Correction is `amend()`, which snapshots
  the **entire prior document** into `revisions[]` and re-opens verification.
- A return without a reason, an assessment with a blank criterion, a remediation without a plan: all
  refused at the data layer.
- Attestation ids are deterministic + `wCreate`, so **a month can be authenticated exactly once**.

**Decisions worth not re-litigating:**

- **The module does NOT claim "NMC compliant."** It claims *"structured to PGMER-2023 §5.2(v)–(vi)"*
  and, per pack, *"NMC \<specialty\> guidelines, \<year\>"*. Whether a logbook satisfies a University
  is the institution's decision. Every report says so in its own footer.
- **No invented numbers, ever.** `NMC_PG_LOGBOOK_REQUIREMENTS.md` maps source → clause → verbatim
  quote → feature for every requirement, and `test/pglog-curriculum.test.mjs` **fails the build if a
  numeric target does not appear in its own quotation**. Most NMC specialty curricula say
  *"a specified number of cases"* — so those requirements COUNT and show **no denominator and no
  progress bar**. MD Emergency Medicine 2024 is the one curriculum in the set that prints procedure
  minima; those 64 numbers are shipped verbatim, and the 5 procedures it names *without* a number
  stay `null` rather than being back-filled from a neighbour.
- **Provenance is a visible material, not metadata.** An NMC requirement and an institutional target
  must never look alike, so `.pgl-prov` differs by colour AND weight AND border style per grade —
  the distinction survives greyscale and a photocopy. An institutional override may change a
  `target`; it can **never** rewrite a label, source, clause or quote.
- **Attendance carries two provenances and they are not merged.** The 80% is §5.6 (the gazette). The
  751/501-day figures come from the PGMEB FAQ of 10.04.2024 — **a secondary source; the primary PDF
  was not obtainable on 2026-08-27**. They are graded differently, shown differently, and editable.
  The module reports attendance; it never declares anyone exam-ineligible on it.
- **Only VERIFIED entries count toward progress.** A resident cannot advance their own bar; a faculty
  member advancing it is the entire point of §5.2(vi). Submitted-but-unverified work is surfaced
  separately as `pending` so it does not look lost.
- **Two independent locks on self-approval.** `pg_resident` holds no `PGLOG_VERIFY` cap *and* the
  model throws. `admin` is deliberately **not** granted verify/assess/attest — the same separation
  the ONCQIS approval caps already use, for the same reason: signing a trainee's clinical record is
  not a technical-admin power.
- **The DRP semester window is a WARNING, not a block** (§5.2(xii)V). A State's posting schedule is
  not the resident's to fix, and refusing to record a posting that actually happened would make the
  logbook less true, not more compliant. Same reasoning for late logging: the delay is measured and
  shown, never used to reject the entry.
- **It is a logbook, not a second EMR.** The entry schema has no field for a patient name, phone,
  address or Aadhaar; `sanitizeCaseRef()` strips them on write, server-side included; age is a band,
  never a DOB; and `publicEntry(e, audience)` withholds case reference and diagnosis from every
  cross-resident surface — the Academic Cell's institution-wide view (§5.2(iii) "ensure and monitor")
  is a completeness question, so it gets counts.
- **AI cannot touch the record.** Suggestions are filtered against the resolved pack, so the model
  cannot mint a requirement; no AI path creates, edits, submits or verifies anything; and the two
  features the brief listed as AI — detecting incomplete entries, and reminders — were implemented as
  **pure code with no model call**, because a reminder about a regulatory deadline must be right
  rather than plausible.
- **Drafts work with no network and are never called "submitted."** Submitted means a named faculty
  member now owes a verification, which is a fact about the server, not the phone. A queued draft
  says "waiting to submit".
- **Offline computes the same numbers.** The client recomputes progress with the same pure functions
  the server uses, so a phone that was offline and a server that was not can never disagree about a
  number printed on a regulatory document.

**A note for whoever runs the tests next.** The headless UI test binds port **8994**, not the shared
8991. Another worktree's `serve.mjs` on 8991 silently served *its* copy of the app, and 48 assertions
"failed" against code they were never looking at. See [[two-claude-sessions-one-folder]].

### 2026-08-27, same day — what R1 found, and the one that stings

R1 returned **NO-GO** on the module above. Seven critical, nine important. The full before/after is in
`NMC_PG_LOGBOOK_REQUIREMENTS.md` §12; the decisions worth recording here are these.

**Three of the seven were the module inventing a number and attributing it to the NMC** — precisely
the failure the whole design was supposed to prevent. `months >= 2.5` let a 77-day District Residency
satisfy a clause that says three months. `COUNTS_AS_ATTENDED` deducted statutory maternity leave from
a resident's attendance and badged the result "PGMER-2023 5.6", when §5.6 *grants* that leave and
extends the term only for leave **in excess** of what is permitted. And a whole-course target was
"expected" from day one, so a resident three days into residency saw 72 high-severity gaps and
"about 100 intubations expected by now". Writing "no invented numbers" in a design document does not
prevent inventing numbers; a test that reads the source does.

**Two were authorization holes that the client flag does not contain**, because Cloudflare Functions
go live on push regardless of `smd_pglog`: any faculty member in the institution could read any
resident's case references, diagnoses and reflections (both branches of the read guard returned the
same value — the `if` was dead and its comment described a restriction that was not implemented), and
a rotation `PATCH` gated on a caller-supplied org while writing to the rotation's own. The lesson is
narrow and worth keeping: **a comment describing a guard is not a guard**, and a branch whose two
arms return the same value is a bug that reads as a feature.

**The one that stings.** The commit message advertised: *"test/pglog-curriculum.test.mjs fails the
build if a numeric target does not appear in its own quotation."* It could not. The generator
synthesised each procedure's quotation *from that target* (`label + " (" + target + ")"`), so the
assertion compared a number with itself. It passed for all 64 shipped Emergency Medicine minima
without ever reading the PDF — and did not notice that **17 more minima had been dropped**, including
nasogastric tube insertion (100) and lab/imaging interpretation (100), about a fifth of the
requirement, behind a checklist that looked complete. Two neighbouring assertions were worse than
useless: `every OTHER specialty pack ships procedure targets of null` iterated **zero** items in all
sixteen packs and read as if sixteen had been verified, and the EM count was asserted as a **floor**,
which is exactly what let a 69-item list that should have had 87 go by.

**So the fix was not a patch, it was evidence.** `pglog-sources/` now holds the extracted plain text
of all sixteen NMC PDFs (868 KB, checked in, deliberately *outside* `pglog/` so `build-www.sh` never
bundles it into the app), and `test/pglog-provenance.test.mjs` checks every quotation and every number
against it. A number that is not in the source is a build failure.

That test immediately found four things R1's own spot-check had not: the shared 2022 pack dropped
"the" from "from **the** Head of Department"; MD Radiodiagnosis writes "training **program**", not
"programme"; MS OBGY prints "**clinic**-pathological", which had been silently tidied to "clinico-";
and **MD Pathology carried a requirement quoting "…clinico-pathological conferences…" to a clause
that does not exist in that PDF**. That last one was a fabricated quotation. It was deleted rather
than given an invented replacement — PGMER-2023 §5.2(x) already covers CPCs for every specialty, so
nothing was lost by removing it, and inventing a citation to keep a feature would have been the worst
available outcome.

**A quotation is evidence, not a transcription to be tidied.** Where the NMC PDF prints something
odd — "clinic-pathological", "examinationof" with the space missing — the pack now quotes it as
printed, with a note. The test's normaliser is allowed to forgive the *extractor's* artefacts (line-
break hyphenation, page numbers inside a paragraph, padded columns); it is not allowed to forgive
ours.

**Also worth not re-litigating:** the appraisal form now prints no total. The MD General Medicine
Annexure 1 is a banded per-element rating with a comments column and **no total row**, and the module
was synthesising "105 / 135" onto a document an examiner may read. `noTotal` is carried through the
model, the server scoring contract and the report. A mark the form does not have is a mark that was
made up.

### 2026-08-27, later — signatures that mean something: the registration gate and the QR

Two things were missing from a module whose entire purpose is an auditable official record.

**A signature from an unverified account is worth nothing, and looks exactly like one that is worth
something.** PGMER-2023 §5.2(vii) says the logbook is authenticated by "the Post-graduate guide";
§9.2(c) attaches a monetary penalty to the NAMED faculty/HoD/Dean who submits a false record. Both
presuppose a registered medical practitioner. The module was checking a *capability* — what a role
may do — and never whether the *person* was on a medical register at all.

So `functions/_pglog_signer.js` now gates every act of signing: verify, return, assess, sign-off and
the monthly attestation. It does **not** re-implement verification — StewardMD already checks
doctors against the **live Indian Medical Register** via `/api/verify-doctor`, which writes
`icu:doctor:<uid>` and sets the `verified` custom claim. This reads that.

**Decisions worth not re-litigating:**

- **FAIL CLOSED.** If KV is unreachable and the claims lookup throws, the signature is refused with a
  503 that says *nothing was signed*. An outage must never silently downgrade a regulatory signature
  to an unverified one: the resident can wait, a falsified training record cannot be taken back.
- **The registration NUMBER is recorded on the record**, not just a uid — number, council, registered
  name, and how it was verified. A signature that said only "fb:abc123 signed this" is unauditable by
  the University that has to rely on it.
- **`verified:true` with no registration number is refused.** A signature nobody can check is not a
  signature.
- **The uid is de-namespaced before lookup.** `fb:abc` vs `abc` would have made every lookup miss —
  and before the fail-closed rule that would have failed *open*. It is one function, used everywhere,
  with a test.

**The QR.** A printed logbook is trusted because a named person signed it; a PDF of one is trusted
because of nothing at all. Every signed event now mints an 80-bit code and a QR
(`functions/_pglog_verify.js`), and `GET /api/pglog/v/<code>` answers **unauthenticated** — an
examiner holding a printout has no account, and requiring one would make the QR useless to the only
person it exists for.

- **The code is an opaque handle, not an encoding of the record.** A code on a whiteboard leaks
  nothing.
- **The stored record holds an HMAC digest of a FIXED canonical form** — an explicit field list, never
  `Object.keys()` over a live document, whose key order would change with a schema edit and silently
  invalidate every code ever issued. On lookup the digest is recomputed from the live record: if
  someone edits Firestore directly, the page says **TAMPERED** rather than showing a green tick over
  altered content.
- **The honest claim is the one on the page.** This is tamper-EVIDENT, not tamper-proof, and it is
  *not* a cryptographic signature by the faculty member — it is the server attesting to what it
  recorded. A real per-signer keypair needs key custody we do not have, and claiming otherwise would
  be worse than not claiming it.
- **Amending a verified entry supersedes its code.** The old signature described a document that no
  longer stands, so the code says so instead of continuing to validate.
- **Without `PGLOG_SIGNING_KEY`, no code is issued at all** — an uncheckable "verification code" is
  worse than no QR, because it looks like one that can be checked.
- **Minting a code can never take a signature down with it.** If signing is unconfigured or the write
  fails, the record is still signed and auditable; it simply carries no QR and the UI says so.
- **The public payload is PHI-free by construction.** Every field was chosen by asking: *is this
  already on the document the examiner is holding?* Resident name and SMD ID, programme, activity
  KIND and date, signer and registration, and whether it still stands. Never the case reference, the
  diagnosis, the remarks or the reflection.

**The QR encoder is ours** (`pglog-qr.js`, ~350 lines, ISO/IEC 18004 byte mode, versions 1–10). A
library would add a dependency to a buildless ES5 app; an image service would send the code to a
third party and fail on a ward with no signal. **A wrong QR is worse than no QR** — it looks
scannable and is not — so every part with a published reference value is tested against it: the
GF(256) tables, the RS generator polynomials, **all 32 format-information strings from Table C.1**,
the version strings from Table D.1. The QR block deliberately stays **light in dark mode**: an
inverted QR does not scan reliably.

**Two bugs the tests caught, both mine.** `normalizeCode()` folded confusable characters *before*
stripping the `PGL` prefix — and "PGL" contains an L, which the folder rewrites to `1`. Every scanned
and every hand-typed code returned empty. Order was the whole bug. And the first cut of the
supervisor-resolution error overwrote `err.message`, which broke the router's error mapping it was
supposed to feed.

### 2026-08-27, later still — what two security reviewers found, and the rule they both found

Two reviewers (R3 security/privacy, S4 app-security) over the signing + QR surface, independently.
Four blocking findings. Both reviewers found the same two authorization holes without seeing each
other's work, which is the part worth keeping: **the module's own comments described boundaries the
code did not enforce.** A comment is not a control.

**The rule underneath all four:** a boundary defined in two places drifts, and the copy that drifts
is the one that leaks. Every fix collapses a duplicated definition into one.

- **Every entry QR would have read TAMPERED.** The signing side and the verification side each had
  their own list of the field names a signature covers, in two different files, and they disagreed
  twice. Every genuine record would have told the examiner not to rely on it. The tests missed it
  because both sides were handed a hand-built payload — so the fix is `payloadFor()`, one definition,
  called at both ends, plus a round-trip test that signs a real entry and verifies its real code.
  **A signature that cries forgery over honest records is worse than no signature.**
- **The URL printed on every QR was not served.** `/pglog/v/<code>` is extensionless, so the site
  gate classified it as an anonymous page view and returned the marketing home page with a 200. The
  feature existed end to end except for the end the examiner actually touches. Now a server-rendered
  page (no JavaScript at all — the reader is a stranger on an unknown device, often printing it) plus
  a middleware pass-through, and a gate regression test so it cannot silently close again.
- **Any faculty member could sign any resident's entry.** `PGLOG_VERIFY` is an org-wide capability;
  §5.2(vii) is not an org-wide question — it names "the Post-graduate guide". The gate was asking
  what a ROLE may do where the regulation asks who a PERSON is to this trainee.
- **The Academic Cell and the technical admin read every trainee's clinical detail.** The read guard
  tested the department capability first, and both of those roles hold it too, so they took the HoD
  branch and the institution-wide → aggregate line below it was dead code. The role definition in
  `_queue_roles.js` promised the opposite in a comment. Now ordered by named responsibility, with a
  table-driven test enumerating every role against every relationship — this guard has been wrong
  twice, so it gets a table rather than another careful reading.
- **`publicEntry()` was called the privacy boundary and covered entries only.** Assessments (3000
  characters of feedback about a named trainee, their remediation plan, every criterion score),
  attestation notes and the raw resident record including the Firebase uid sat next to it,
  unprojected. A boundary that covers one of four record types is not a boundary.
- **`amend` could mass-assign `deleted`** and retire a verified, signed training record that
  `softDelete()` explicitly refuses to touch — while naming someone else as the deleter. The two edit
  paths kept separate lists of un-patchable fields and disagreed. One `SERVER_OWNED` list now.

Smaller, same spirit: the verification code is a **capability**, not a fact about the record, so it
no longer goes to an aggregate audience; `getUserClaims()` returning `{}` during an outage no longer
reads as "this person is not verified"; the rate-limit key no longer falls back to the
client-supplied `X-Forwarded-For`; `PGLOG_OFF` now covers the public endpoint, because an operator
flipping a kill switch during an incident should not find the one unauthenticated route still
serving; Firestore error detail stays in the log; the SMD ID is masked on the public page; and the
free text posted to the AI endpoint is scrubbed of honorific-led names — the *copy sent out*, not the
stored text, which stays readable to the resident and their guide.

Not done, and owed before a non-tester release: **these fixes have not themselves been re-reviewed**,
and `PGLOG_SIGNING_KEY` is not provisioned (so no QR is issued yet — deliberately).

### 2026-08-27, later still — the logbook becomes a document

Owner's requirement: a logbook must be shareable as a PDF once signed, with at least two faculty and
the HoD signing before it can be approved or shared (the HoD may count as both), and the PDF must
carry a digital signature verifiable through StewardMD so a college or the NMC can hold it and rely
on it.

**The core decision: a CERTIFICATE, not a flag.** "Approved" as a boolean on a logbook would be a
claim about a moving target — a logbook gains entries daily. So certification mints a separate record
that **freezes what it covers**: an HMAC over the exact verified-entry set, each entry with its own
signature state, sorted by id. Amend a covered entry afterwards and the certificate is **superseded**
rather than quietly continuing to validate. The document those people signed no longer exists, and
saying otherwise over changed content is the worst thing this feature could do.

**Decisions worth not re-litigating:**

- **The quorum defaults to exactly the owner's rule** — 2 faculty + 1 HoD, HoD counting toward both,
  so two distinct people suffice — and is per-programme configurable. The same person cannot fill two
  slots: distinct *people*, matched through `sameActor` so a namespace or case difference is not a
  second signatory.
- **WHOSE RULE IS WHOSE, printed on the artefact.** The HoD signature is sourced (the 2022-revised
  curricula say the completed log book is signed by the Head of the Department). The **number of
  faculty signatures is ours**, and the screen and the PDF both say "not an NMC requirement" in those
  words. This is the likeliest place in the module for a local policy to be laundered into a
  regulatory claim.
- **`requireGuide` defaults OFF.** Defensible from §5.2(vii), but a guide who has left, retired or
  died would otherwise make their former trainees permanently uncertifiable, and a rule that strands
  a resident is a rule the department will work around. Whether the guide signed is reported either
  way.
- **The server decides the signing role from the membership.** A client that could name itself "hod"
  would be the entire quorum by itself.
- **Only verified entries are certified**, and what was excluded is printed. A certificate that
  silently omitted unverified work would read as a complete logbook.
- **NOT a digital signature under the IT Act, 2000.** No DSC from a licensed Certifying Authority is
  applied, because nobody here holds such a key. It is tamper-EVIDENT: a QR that re-reads the live
  record and re-derives the digest. **The limitation is printed on the document**, since the person
  relying on it is the person who needs to read it. Upgrading later is a key-custody problem, not a
  rendering one — the certificate record already pins exactly what would be signed.
- **An uncertified export is stamped `NOT CERTIFIED`, with no QR and no signature block.** There is
  no configuration in which the exported document is ambiguous about whether anyone signed it. That
  ambiguity is the only way it could mislead by accident.
- **The print QR is a TABLE of cells, not the SVG.** The export runs through two renderers — the iOS
  WKWebView (fine with SVG) and an html2canvas fallback (not reliably). A QR that silently fails to
  render is worse than no QR, because the document still says it is verifiable. It needs an explicit
  `<colgroup>`: `table-layout: fixed` reads column widths from the first row, and a QR's first row is
  all quiet zone, i.e. one cell spanning everything.

**A real bug this surfaced, well outside the feature.** The certificate's content digest flipped
between "request" and "issue" for no reason a reader could see. Cause: `getEntry()` re-attached the
signature block that `M.entry()`'s schema drops, and `listEntries()` did not — the same stored
document came back with a registration number down one path and without it down the other. Same shape
as the two field lists behind the QR digest. It had a second, silent consequence nobody had noticed:
every report's "verified entries carrying the signer's registration" count was reading zero. One
`withSignature()` now serves every read path.

**Measurement note.** The browser test first "failed" the printed QR at 132.8px against an expected
123px. That was not the QR: the app carries a root `zoom` of 1.08 for the OS text-size setting. The
assertion was wrong, not the code — so it now tests **module uniformity and squareness**, which is
what actually decides whether a scanner can read it, and is zoom-independent.

## 2026-08-28 — The boot splash is a SEQUENCE: the classic splash first, the personalised one second
Owner feedback from a real device, in strong terms: the v2 layer had *replaced* the classic boot
splash, and the classic one is not negotiable. The composition he wants on open is the original:
light field, the interlocked mark, the two-tone "Steward**MD**" wordmark, "Built by clinicians, for
clinicians", the thin progress bar, and the "DEVELOPED BY [MaiK]" foot, in **both** the light and the
dark variant. What the v2 layer built is not rejected; it is **misplaced in time**. It should come
*after*.

**So `#smdBootSplash` now has two phases inside the same element.**
- **Phase 1 (default, no class):** the classic CSS, untouched. Every v2 rule that changes composition
  (126px mark, the display-face lock-up, the "Loading your workspace" glass pill in place of the
  progress bar, the full-width row foot, the `.sbs-personal` hiding of the wordmark and tagline) is
  now scoped to `#smdBootSplash.smd-boot-phase2`. The single carry-over is the **liquid-glass
  material on the developed-by bar**, which the owner had explicitly asked for: material only, the
  classic stacked composition and the 53px MaiK logo are kept.
- **Phase 2 (`.smd-boot-phase2`):** the personalised "welcome back" screen, added by the existing
  inline personalisation script after a **900ms beat** plus a **220ms crossfade** (opacity on
  `.sbs-center` / `.sbs-foot`; instant swap under `prefers-reduced-motion`).

**It cannot delay boot.** The beat is a bare `setTimeout` that no-ops if the splash is already fading
(`.sbs-hide`) or detached, so a fast boot goes straight to the app exactly as before — the phase is
skipped, never waited on. The splash's own `MIN`/`CAP` hold logic is untouched.

**Only signed-in returning clinicians reach phase 2.** The beat is scheduled inside the
personalisation block, which already returns early for guests and first-run users — so they keep the
classic splash for the whole boot, and their "what you created" arrives as the intro poster and
landing splash that follow. That is also why the phase-2 field is painted on a `#smdBootSplash::before`
overlay rather than swapped into `background`: a background-image swap cannot crossfade, an overlay's
opacity can, and phase 1 then keeps the genuinely original white / dark-teal field.

Same flag, same default-ON resolution, `?splashv2=0` still drops the whole layer. `sw.js` CACHE
`...-splashv2e` → `...-splashv2f`. Test: `test/run-splash-ui.mjs` now asserts the classic phase FIRST
in both themes (107px mark, two-tone 30px/800 wordmark, the tagline, the 132x3 progress bar, the
stacked foot, no loading-pill copy, the hello row not yet shown), then the transition into phase 2,
and that a guest never enters phase 2 at all.

**The general lesson, worth more than the fix.** A redesign layer that improves a screen can still be
a deletion from the owner's side if it removes the moment he recognises the product by. Brand-recall
surfaces are not styling surfaces. When there is something new to show, prefer adding a *phase*
over overwriting the existing one.

## 2026-08-28 — Phase 2 is a stop, not a second loading screen: the Open Workspace button gates boot
Follow-up owner feedback on the two-phase boot splash: "WHY TWO LOADING SCREENS FOR WHO LOGGED IN."
He is right, and the diagnosis is sharper than the complaint. Phase 1 and phase 2 were both passive
waits, so the sequence read as the same dead time twice. A screen only earns its place if the user
does something on it.

**So phase 2's pill became the action.** The "Loading your workspace" pill is now a real
`<button id="sbsGo">Open Workspace</button>`, carrying the same tinted-glass primary treatment as
the landing CTA, and the splash **holds** on the welcome-back screen until the clinician taps. On
tap: reveal at once if boot has finished, otherwise the button flips to "Opening..." (reusing the
existing `sbsGlow`) and the reveal happens the moment boot is ready.

**Fail-open is the whole design, because this is a clinical app.** A clinician stuck behind a splash
is not a cosmetic bug. Four independent ways out:
- The hold arms only after the button is **in the DOM, measured at a real 44px+ tap target, and its
  listener attached**. Any throw or bad measurement and `.sbs-gate` never lands, so phase 2 keeps
  today's passive pill and auto-hides. This is why the pill/button swap is keyed on `.sbs-gate`
  rather than on phase 2 itself: the CSS cannot show a button the JS did not successfully wire.
- A **20s safety valve** opens it for them if they set the phone down.
- The hide loop **re-checks that deadline itself** (`gateHeld()` compares against `gate.armed`), so a
  dropped or throttled timer cannot strand anyone. Anything unexpected reads as "not held".
- `?splashv2=0` and guests never reach the arming code at all (the personalisation block already
  returned early), so both keep the exact pre-existing auto-hide.

**The gate deliberately suppresses `CAP` (15s) while held.** A visible button the user can press is a
better failure mode than a screen that vanishes under them, and the gate's own 20s deadline bounds
the wait regardless, so the true worst case is ~21s from boot rather than unbounded.

**No `app.js` change and no fork of the hide logic.** The splash's `MIN`/`CAP` loop was extended in
place with one `gateHeld()` check plus a `window.__smdBootGateOpened` hook for an immediate reveal on
tap; the gate object is published by the splash-v2 script that already owns personalisation. The
button is **static markup kept `hidden`**, the same pattern `.sbs-hello` uses, so the flag-off path
stays byte-exact.

`sw.js` CACHE `...-splashv2g` → `...-splashv2h`. Test: `test/run-splash-ui.mjs` asserts the button
renders as a `<button>` with the right label at a 44px+ target in both themes, that the splash holds
**under the exact `ready()` condition that would otherwise hide it** (the harness forces a visible
`#accountGate`, which is the proof: staying up merely for a while would prove nothing), that the tap
releases and reveals, that a mid-boot tap yields "Opening...", and that guests and `?splashv2=0` are
neither gated nor shown the button and still auto-hide.

## 2026-08-29 — App Lock: PIN / Face ID·Touch ID / no-lock, chosen once at first login
Owner ask, after seeing the "Open Workspace" welcome-back splash (build 3464): add a real lock in
front of it. Three options, offered once right after the first-run profile step (email-auth.js's
`openProfile({firstRun:true})`, the single choke point every sign-in method — Google/Apple/email —
already funnels through):
1. **PIN** — 4-6 digits, salted SHA-256 (Web Crypto), stored in the OS Keychain/Keystore via
   `capacitor-secure-storage-plugin` (the same `window.SMD_SECURE` shim autofetch.js defines).
   Available on every device regardless of biometric hardware.
2. **Face ID / Touch ID** — feature-detected via `Capacitor.isPluginAvailable()`. No biometric
   plugin is installed in this repo today, so the option correctly never renders on any current
   build. Wiring a `NativeBiometric`-shaped plugin (`p.verifyIdentity`/`p.authenticate`) + `cap
   sync` + a native rebuild lights it up with **zero** changes to `applock.js` — the call shape is
   already written and named-lookup-guarded (`NativeBiometric` or `BiometricAuth`).
3. **No lock (auto sign-in)** — own-risk, gated to **personal accounts only**. There is no existing
   "institution account" field, so this reuses the profile's `hospital` freetext (already collected
   at the same first-run step): non-empty hospital → the option is not rendered at all, not merely
   discouraged. A risk checkbox gates the Confirm button even for personal accounts.

**Enforcement point**: `index.html`'s boot-splash `finish()` — the single function that already
hides/removes `#smdBootSplash` (see the 2026-08-28 Phase-2 entry above) — gained ONE check:
if `SMD_APPLOCK.required()`, hold behind an unlock overlay and only call the real hide once it
calls back. No fork of the hide/tick loop, matching how Phase 2's own gate was added.

**Fail-open, deliberately, because this file's own rule already exists**: every unlock screen
carries a "Sign out instead" escape (routes to the existing `#sessionSignOut` click, the same
button the header already wires); `window.SMD_APPLOCK` undefined/throwing anywhere is read as "not
required" — a clinician locked out by a bug in THIS code is worse than the lock not firing once.

**Known gap, accepted rather than engineered around**: `applock.js` loads as a deferred script
after `app.js` in the script order, while the boot-splash gate script is inline and starts polling
immediately. On an extremely slow first cold load (no service-worker cache yet) it's theoretically
possible for `finish()` to fire once before `SMD_APPLOCK` has registered, skipping the gate for
that one boot. Not restructured, because moving `applock.js` earlier only matters for a narrow,
self-healing window (the very next boot has it cached) and this codebase's own MIN/CAP splash logic
already accepts equivalent races elsewhere.

**Flag**: `smd_applock`, default **OFF** — this is a big, security-adjacent, boot-blocking change
per this repo's own flag convention, and has NOT had a device pass yet (Chrome-headless UI test
only: `test/run-applock-ui.mjs`, 25/25 green, plus the full existing `test/run-splash-ui.mjs` still
25/25 green with the `finish()` change in place). `?applock=1` / `localStorage.smd_applock="1"`
forces it on for testing; `?applock=0` forces off. Needs an owner device pass + R3 security review
before flipping the default, per CLAUDE.md's "reversible changes" rule for anything auth-shaped.
sw.js CACHE bumped `-applock1`.

## 2026-08-29 — App Lock biometric: wired to a real plugin, not just feature-detected
Follow-up to the App Lock entry above: owner asked for iPhone Face ID/Touch ID and Android
biometrics to actually work, not just be structurally ready for a plugin. Added
`@aparajita/capacitor-biometric-auth@10.0.0` (verified against the npm registry + its
TypeScript definitions before writing any call — declares `@capacitor/*: ^8.x`, matching this
repo's Capacitor 8.4.1; 214k weekly downloads, updated 2026-02, actively maintained — over the
older, Capacitor-3-targeted `capacitor-native-biometric`).

- `npm install` + `npm run build:www` + `npx cap sync` run in this session: 28 iOS / 21 Android
  plugins now include it, WatchBridge still present (no repeat of the incomplete-node_modules
  drop — node_modules was already complete before this install).
- `ios/App/App/Info.plist` gained `NSFaceIDUsageDescription` — mandatory or iOS silently refuses
  Face ID. No Android manifest change needed (AndroidX BiometricPrompt handles its own
  permission).
- **Corrected two wrong assumptions from the first pass**: the plugin's registered name is
  `BiometricAuthNative` (not `NativeBiometric`/`BiometricAuth` — those were guesses; the export
  named `BiometricAuth` in the plugin's own JS is just a local alias for that proxy, and
  `Capacitor.Plugins` is keyed on the string passed to `registerPlugin()`). And device capability
  is NOT `Capacitor.isPluginAvailable()` (that only proves the plugin is compiled into the
  build) — it's the async `checkBiometry().isAvailable` (whether the device actually has
  biometry enrolled), so `canBiometric()` became async and `renderChooser()` now awaits it
  before deciding whether to show the Face ID/Touch ID row.
- `authenticate()` resolves (void) on success and REJECTS with a `BiometryError` on failure/
  cancel — never returns a boolean — so `verifyBiometric()` reads success from settle, not from
  the resolved value; this matches the resolve→true/catch→false wrapper already written, so no
  caller (`renderBiometricSetup`/`renderBiometricUnlock`) needed to change.
- Not yet run on a physical device — this session has no iPhone/Android attached. Web-side logic
  is fully verified (`test/run-applock-ui.mjs`, 25/25 green, unaffected since Chrome-headless
  has no `window.Capacitor` bridge — biometric correctly reports unavailable there, same as
  before); `test/run-splash-ui.mjs` still 25/25. The remaining step is the owner's own
  build→install→test pass per this file's native-build gotchas (Xcode SPM scheme, `devicectl`
  reinstall wipes app data, `ios_webkit_debug_proxy` for on-device debugging).

## 2026-08-30 — App Lock biometric: call the NATIVE method name (internalAuthenticate)
Correction to the entry above. On the iPhone 15 Pro, Face ID setup failed instantly with no
Face ID sheet, no "StewardMD would like to use Face ID" permission dialog, and no Dynamic Island
animation. Root cause was not the device or memory: `verifyBiometric()` called
`Capacitor.Plugins.BiometricAuthNative.authenticate()`, but the Swift plugin's `pluginMethods`
are exactly `checkBiometry` and `internalAuthenticate`. The public `authenticate()` exists only
in the plugin's ESM JS layer (`dist/esm/base.js`), which a buildless ES5 app never loads.
- Capacitor's native proxy returns a wrapper function for EVERY property, so `!p.authenticate`
  guards can never detect a wrong name; the call rejects `UNIMPLEMENTED` before `LAContext` is
  touched. `checkBiometry()` is a real native method, which is why the option still rendered.
- Rule for this repo: when using a Capacitor plugin through `window.Capacitor.Plugins` (no
  bundler), the callable names are the plugin's native `pluginMethods` / `@PluginMethod`s, not
  its TypeScript public API. Read the Swift/Java, not `definitions.d.ts`.
- Failure text now maps the LAError code (`userCancel`, `authenticationFailed`,
  `biometryLockout`, `biometryNotEnrolled`, ...). `test/run-applock-ui.mjs` section 9 installs a
  Capacitor-shaped fake proxy where only native names succeed (41/41).

## 2026-08-30 — App Lock: closable Manage, lock at load, optional 2h grace (personal only)
Owner feedback after the Face ID fix: Manage had no way out and forced a re-pick; boot unlock
felt slow; wanted auto Face ID on launch or "don't ask if opened within 2 hours".
- **Manage is closable, first-run is not.** `manage()` sets `_fromManage`; the chooser then
  shows "Keep current setting" (or "Not now" when nothing is set) and marks the current method.
  `promptSetup()` (first-run) keeps the forced choice from the original 3-option spec.
- **Lock is shown the moment `applock.js` loads**, over the boot splash, not at the splash's
  `finish()`. Face ID fires on launch; the PIN pad is up while the app still loads. `unlock()` is
  idempotent with a `done` queue, so `finish()`'s `unlock(reallyFinish)` joins the screen already
  on show. Completing setup counts as that boot's unlock (`markUnlocked()`), no second prompt.
- **2h grace** (`smd_applock_grace`="2h", `smd_applock_lastunlock` ms): skip the prompt when the
  app is reopened within 2h of the last open (sliding: a grace-skipped open refreshes the stamp).
  Classified with "no lock" as own-risk: opt-in, off by default, **hidden for institutional
  profiles** (same PHI rule), cleared by sign-out. Not a security boundary; the PIN hash /
  LAContext still is.
- `test/run-applock-ui.mjs` 54/54; `test/run-splash-ui.mjs` now clears its own origin at start
  (the persisted Chrome profile used to fake a signed-in first run and fail 2 asserts on every
  second run).
- **Addendum (same day): biometric unlock shows no card.** Owner: "never app should show face id
  option on click of app". Boot is splash -> system Face ID / Touch ID sheet fires by itself at
  the splash's `finish()` -> app. `renderBiometricUnlock()` renders nothing; `renderBiometricRetry()`
  (Try <Face ID|Touch ID> again / Sign out) appears only after a failed or cancelled scan. The
  PIN pad still pre-shows at load. So the "lock at load" point above now applies to PIN only.

## 2026-08-30 — Boot splash: one frame, constant 3s, then Face ID / PIN by itself (gate REMOVED)
Reverses the "Open Workspace gate" and the phase-1 -> phase-2 crossfade decisions. Owner sent a
screen recording: bare grey WebView, then a loading bar alone, then the foot, then the logo, then
the logo faded out for a welcome card with a button. "Unprofessional. Constant 3 sec splash,
all appear at once, then automatic Face ID / PIN, fast, into app."
- **Grey frame root cause:** `capacitor.config.json` `SplashScreen.launchShowDuration: 0` +
  `launchAutoHide: true` dropped the native splash at launch, exposing the unpainted WKWebView
  (system-dark) even though `native-bridge.js` hides it on `load`. Now `launchShowDuration: 3000`
  (auto-hide kept only as the cap); the native splash (white + mark) covers until paint.
- **Web splash:** no entrance animation on any element (sbsPop/sbsFade removed); the signed-in
  avatar + name row sits in the SAME frame as mark, wordmark, tagline, bar, foot; `MIN` 900 ->
  3000; no phase 2, no `.sbs-go` button, no `__smdBootGate`. App Lock's early PIN pad is gone
  too: `finish()` -> `unlock()` after the 3s frame, for both Face ID (no card) and PIN.
- Dead `.smd-boot-phase2` selectors remain inside the shared LIQUID GLASS lists; harmless.
- `test/run-splash-ui.mjs` section 2 rewritten (static-at-first-paint, hold at 1.6s/2.5s with
  ready forced at 0.6s, self-hide by 3.6s, no button) 91/91; `run-applock-ui` 59/59.

## 2026-08-30 — App Lock: forced for every signed-in user (not flag-gated, every provider)
Owner: "no one is forcing me to set up id/pin once signed up/in i want you to force users."
`promptSetup()` was gated on the `smd_applock` rollout flag (unreachable in the native app) and
fired only from the email first-run profile step, so Google/Apple sign-ins and existing accounts
were never asked. Now `applock.js` subscribes to `SMD_ACCOUNT.onChange` (runs at boot and on
every sign-in): signed-in, non-guest, no method configured -> the first-run chooser (no close)
as soon as nothing else owns the screen. "Busy" = `SMD_EMAIL_AUTH.gateUp()` (account / intro /
verify gates, splashes), `SMD_EMAIL_AUTH.flowOpen()` (its own sheet, which hands over via
`promptSetup()` itself), or `#smdBootSplash`. Polls 500ms up to 2 min per event. Hospital for
the institutional rule comes from `SMD_EMAIL_AUTH.loadProfile(uid)` (Firestore profile doc;
"" when unavailable, i.e. treated as personal, and Manage re-evaluates with the real value).
`smd_applock` now gates nothing that matters; the Security row shows for everyone.
- **Addendum (same day): screen 2 is back.** Owner: "why did you remove second screen after
  splash? bring it back i want both". Screen 1 (classic, static) -> 1.5s beat -> crossfade ->
  screen 2 (avatar, name, glass foot, passive pill). Still no Open Workspace button/hold; the
  constant 3s + automatic Face ID / PIN stands. So only the GATE stays removed, not phase 2.
- **Addendum (same day): the "second screen" was the merged frame, held for 3s of REAL visibility.**
  Owner's screenshot circled the welcome row + bar on the single merged frame: "i want user to
  see this screen for at least 3 secs". The two-screen crossfade restore (87fc0f7c) is reverted.
  The real defect: MIN counted from script start while the native splash still covered the
  WebView. `native-bridge.js` now stamps `window.__smdSplashShownAt` when it lifts the native
  splash and the boot script measures MIN from that stamp (script start on the web).
- **Addendum (same day, final): BOTH screens, screen 2 seen for 3s.** "still same single splash
  screen" after the revert: the ask was the two-screen sequence with the welcome screen on for at
  least 3s. Screen 1 (classic, static) 1.2s -> 220ms crossfade -> screen 2 (avatar, name, glass
  foot, passive pill) 3s. Beat AND hold count from `__smdSplashShownAt`; `MIN` = 4500 for
  `.sbs-personal` boots, 3000 for guests (screen 1 only). Gate/button still gone.

## 2026-08-28 — Ask MaiK inside the insulin calculator: MaiK fills the form, it does not answer the dose

**Decision (owner, "B").** A doctor describes the situation in free text ("patient on 16 units
regular, sugar 320 now, how much?") and MaiK responds by **pre-filling the calculator** — mode plus
every input — for the doctor to check and press Calculate. It does NOT print a dose inline.

**Why the LLM never produces the number.** insulin.js already separates the maths (`INSULIN_ENGINE`:
`correctionDose`, `mealBolus`, `firstDoseCorrection`, `combinedDose`, `basalInitiation`, `isfFromTdd`,
`icrFromTdd`, `activeInsulin`, `pediatricInit`, `dkaInsulin`) from the presentation, and
`INSULIN_SAFETY.evaluate(ctx, input, res)` from both. So the agent's whole job is EXTRACTION: choose
the engine function and fill its arguments. The dose then comes from the same validated code path the
calculator has always used, and every existing safety warning and `interrupt` still fires. An LLM that
emitted units directly would bypass all of it.

**Why pre-fill rather than an inline answer.** Both were considered. Inline is one tap faster, but the
failure mode is "the AI said 6 units" — a number a busy doctor may accept without auditing inputs the
AI inferred. Pre-fill makes the failure mode "the AI filled these five fields, check them", on the
screen the clinician already reads, with the existing confirm/acknowledge flow intact. For insulin
that trade is worth the tap. An inline answer can be layered on later once extraction is shown to be
reliable in practice.

**Rules the implementation must keep.**
- Missing required input (no ISF, no weight, no time since last dose) -> ASK, never assume a default.
  Silent defaulting is where the real danger is, not the arithmetic.
- Show the extracted inputs as an editable summary with a one-line rationale, before any result.
- A safety `interrupt` blocks the answer exactly as it does in the manual flow.
- Never auto-confirm or auto-log a dose on the doctor's behalf.

**Implemented 2026-08-29** behind `smd_insulin_ask` (DEFAULT OFF). `insulin-extract.js`
(`window.INSULIN_EXTRACT`) is the validated seam: free text → `{mode, corrSource, set[], missing[],
questions[], rationale}`, whitelisted to known modes/field keys with plausibility ranges, mirroring
`maik-reasoning.js`. Server kind `insulin-extract` (`functions/api/ai/_insulin-extract.js`).

Two implementation facts worth keeping:
- **The result had to be HELD.** The calculator recomputes live on every keystroke, so a plain
  pre-fill paints a dose in the same instant MaiK fills the fields — the exact inline-answer failure
  rejected above. `st.askPending` makes `render()` paint the review card *instead of computing*;
  Calculate releases it. This is the load-bearing line, and `test/run-insulin-ask-ui.mjs` pins it.
- **The engine cannot enforce the no-defaulting rule, so the UI does.** `st` holds a value for
  everything (glucose 180, isf 50, iob 2, weight 70), and `correctionDose()` treats a missing IOB as 0
  and still returns a number. Every REQUIRED field MaiK did not read is therefore *blanked* and
  Calculate stays disabled until a human types it.

Extraction runs on the CLOUD model (`SMD_AI.maik`), matching MaiK Ask/Scribe/SURGX posture. On-device
was considered — it keeps the scenario off the network — but `SMD_MAIK_LOCAL.answer()` takes a KB
package rather than a prompt, is PRO-gated and needs a downloaded pack, so it cannot be relied on for
strict JSON. `INSULIN_EXTRACT.setProvider()` is the one-line swap if the owner wants it later.
**Owner: confirm cloud-vs-on-device.**

## 2026-08-31 — MaiK Lite is now OUR trained model, and the flagship on-device tier

The `maik-lite` pack no longer points at the upstream qvac/MedPsy-1.7B base on HuggingFace. It now
ships StewardMD's own LoRA fine-tune (v2), trained on the StewardMD Knowledge Base, hosted on our
R2 (`models.stewardmd.in/maik/maik-lite-q4_k_m.gguf`) because the weights are private. It is the
DEFAULT_PACK, carries a STEWARDMD picker badge, and has its OWN system prompt in the registry
(`pk.system`, consumed by maik-local.js) - the shared SYSTEM's example dose ("2 g IV over 20 min")
was parroted by the 1.7B as a real furosemide dose, so its prompt carries no example dose.

Presentation rule (owner): on-device answers never show page numbers or upstream source names; the
only attribution anywhere is "StewardMD Knowledge Base - based on standard medical resources".
stripReasoning() now also drops trained-in [n] citation markers.

Two training passes: v1 (reasoning-style SFT, loss 0.62) answered well but inherited the base's
thinking habit when served over plain ChatML (the native path) - it burned the whole nPredict on an
unterminated <think> and the doctor got a blank. v2 (continued SFT, 1 epoch, lr 1e-5) moved the
empty think block INTO the loss target and added the system turn to 60% of examples. Probes over
the native-style path after v2: most questions answer immediately (empty think block); some still
reason first, hence nPredict 768 and an explicit "did not produce an answer" error instead of an
empty bubble when reasoning eats the budget. Server-path eval held: structured 52%, unsupported
1.2%, cited 100% on the 100-question set.

Known gaps for a v3 pass (do not re-discover): the think habit is reduced, not eliminated - the
robust fix is a <think>-token ban at the native sampler (both platforms) or more discipline data;
scope-refusal is enforced by the Intent Firewall (maik-scope.js) upstream, NOT by the model, which
answered a football question in bare-model probes.

## 2026-09-02 — MaiK Lite v3/v4: found and fixed WHY the think habit persisted, caution policy removed

v3 (bare-question data, no abstain examples, caution policy removed per owner order) trained
cleanly but its own in-VM probes came back 0/8 passing - still opening `<think>` and never
closing it, exactly like v1/v2 on the phone path. Root cause, found by inspecting the actual
training prompt: `tokenizer.apply_chat_template()` silently prepends the BASE MODEL VENDOR'S
default system line ("You are MedPsy, a medical and healthcare AI assistant developed by QVAC")
ahead of whatever system text we pass it. So v1/v2/v3 were all trained with an extra hidden
system turn the phone never sends - the empty-think suppression was conditioned on a prompt
that does not exist at serve time. Confirmed by decoding the actual tokenized prompt, not by
reading the template source.

v4 (`train_vm3.py`) fixes this the only reliable way: it does not call `apply_chat_template` at
all. It hand-builds the exact ChatML string llama.cpp's `llama_chat_apply_template` produces
(`<|im_start|>system\n...<|im_end|>\n<|im_start|>user\n...`) so train and serve are byte-identical.
Data recipe otherwise unchanged from v3: bare questions (no book-evidence wrapper - the phone
never sends one), abstain/clarify examples fully removed (owner: "REMOVE CAUTION POLICY"), dose/
numeric/criteria/contra examples kept for dosing quality.

Result, in-VM probes over the exact phone path (llama-cli --chat-template chatml, no evidence,
app system prompt), 8 owner-supplied questions including the two that had failed live
("Treatment of Pneumonia", "Fever Treatment") plus 4 dose questions: **8/8 clean - zero
unterminated thinking, zero blank answers.** Shipped as the maik-lite pack's weights (sha256
3d779b25..., same R2 object key as v2/v3, no other code change needed).

Not fixed by v4, still true: a 1.7B WILL make occasional dose errors (verified: one probe named
azithromycin BID instead of the correct QD/weekly regimen for CAP - a plausible-sounding but wrong
figure). No training pass removes this ceiling; the durable fix is routing dose-specific questions
to the deterministic drug engine instead of the fine-tuned model. Scope-refusal (non-medical
questions) is still enforced upstream by the Intent Firewall (`maik-scope.js`), not by the model.

## 2026-09-03 — MaiK Lite v4 never reached phones: same-size retrain defeated the install check

Live symptom: v4 was merged (#814), weights verified live on R2, but the owner's phone kept
returning the exact v2 failure mode ("did not produce an answer"). Root cause: `installed()`/
`installedCached()` in maik-models.js only ever compared on-disk byte count + GGUF magic against
the registry - never content. A LoRA-merge retrain (v2 -> v3 -> v4) never changes file size, so a
phone that had already downloaded v2 saw "right size, right magic, marker already set" and never
re-fetched, forever - no matter how many times the registry's sha256 or code shipped a new PR.

Fix: a new localStorage marker per pack (`smd_maik_packsha_<id>`) records the registry sha256 that
was actually verified at download time. `installed()`/`installedCached()` now treat a pack as
stale (not installed) the moment the registry's sha256 for that pack differs from the stamped
value, even though size+magic still pass. Both download entry points (`nativeDownload`'s
modelPath "already" shortcut, and `oneFile()`'s Range-resume shortcut) were ALSO patched - each
had its own identical same-size short-circuit that would otherwise still skip the redownload even
after installedCached() correctly started reporting "not installed". Deliberately still no full
sha256 rehash on-device (would mean reading the whole multi-GB file back through the bridge); this
is a cheap string compare against a value already known from download time.

Consequence chain that WAS working correctly and needed no fix: `maik-engine.js`'s
`packInstalled()` -> `localReady()` -> `effective()` already refuses to route to a local engine
that `installedCached()` says isn't ready, falling back to KB-only - so once this fix ships, a
stale phone will show "Tap to download" and auto-fallback to KB-only rather than silently running
old weights, with no further app-side changes needed.

Regression tests added in test/maik-models.test.mjs for both download paths: a same-size file with
a stale registry sha256 must be deleted and genuinely re-fetched, not reported as already-installed.

## 2026-09-03 — MaiK Lite on-device RAG: BM25 book search wired to the trained model, and the fresh-install crash

Owner's ask: doctors expect to-the-point answers with drug, dose and duration as per the textbook,
so bring the BM25 + evidence-gate pipeline built for training (`~/MedPsy/run/book_search.py`,
`pipeline.py`, `validator.py`) into the app and connect it to MaiK Lite on the phone. Shipped in
PR #819: `kb/ai/maik-lite-rag.js` (BM25 port, verified byte-identical scores against the Python on
the real 42,176-chunk book), `kb/ai/maik-lite-kb-store.js` (chunked download of the 38 MB JSONL
asset from R2, cached in Documents), and wiring in `maik-local.js`: top-3 passages prefixed to the
prompt, the model's answer run through the same evidence gate (any drug or figure not present in
the retrieved passages fails), and on failure the passage itself is shown instead of the answer.
The gate is never weakened to raise the answer rate. Only the `maik-lite` pack is RAG-eligible.

Citation policy (owner, verbatim intent): NEVER a page number, on device or anywhere. Every
grounded answer ends with "Source: StewardMD Knowledge Base - based on standard medical
resources." and nothing else. A unit test pins that the source line can never carry a page number.
Book text never leaves the device.

Crashes found live on the owner's iPhone 15 Pro and fixed, in order:
1. `String.fromCharCode.apply` on a 2 MiB download chunk blew the call stack. Sub-chunk at 0x8000.
2. `Filesystem.readFile` without `encoding: "utf8"` returned base64, so the index built with zero
   rows while reporting installed. Encoding now explicit, with a full-size synthetic regression test.
3. Jetsam kill after a handful of questions: the built Book (42,176 per-chunk term Maps) was cached
   for the app's life. First attempt: rebuild it per question and release. WRONG, see 5.
4. Jetsam kill on a FRESH install (the path every earlier test had skipped because the KB was already
   on disk): the post-download whole-file SHA-256 read 38 MB back through the bridge as base64 and
   looped 38 million charCodeAt calls on the main thread. Removed. Integrity is now the exact byte
   count plus an exact 42,176-row parse in loadBook(); a short file is deleted and re-downloaded.
   The registry sha256 stays as the same-size staleness marker only, as in maik-models.js.
5. Still crashing for the owner after 3 and 4. The pulled JetsamEvent report was decisive: it was
   NOT the App process (0.6 GB, fine, it holds the model natively) but com.apple.WebKit.WebContent,
   the WebView's content process, at 2.16 GB, reason "per-process-limit". Every earlier memory
   probe had read the App process's headroom via the Llama plugin and so could never see this.
   The 42,176 Maps were ~640 MB, and rebuilding per question left the previous build's garbage
   overlapping the new one. Fix: a flat inverted index (one term->id Map, typed arrays for
   per-term offset/idf and one global posting array), built once per session and cached: 121 MB,
   2.9 s build, 18 ms search on the full book, scores bit-identical to the old code (checked on all
   42,176 chunks, 17 queries). A per-term-object layout was tried first and measured at 955 MB,
   WORSE than the Maps, because the book has 1.6 million distinct terms (bigrams): never allocate
   per term. Lesson for any future WebView memory question: pull the JetsamEvent with
   `idevicecrashreport -n -u <network udid> -e -k <dir>` and read which process died; the App
   process and the WebContent process have separate limits.

Verified live after fix 5, installed over the existing container: 5 paced questions plus one more,
all grounded, none rejected by the gate, no page number, App PID unchanged throughout, no new
jetsam report. First question including the index build 13 to 14 s, later ones 9 to 27 s
depending on answer length. Native builds for this work must come from the live checkout, not
a worktree: the CapApp-SPM Package.swift relative paths resolve to the original checkout's
`local-plugins` when synced from a worktree, so a worktree build silently compiles the OLD Swift.
Also: `devicectl device info processes` pads lines with trailing spaces, so a `$`-anchored grep on
the app path silently matches nothing and looks like "the app is gone" when it is not.

## 2026-09-03 — Bonsai packs (PrismML 1-bit / ternary) in the picker; ternary 8B as the offline stand-in for MaiK Cloud

Owner decision: add Ternary Bonsai 8B as an offline model and use it in place of Vertex/Gemini for
offline users wherever possible; list all three Bonsai models (1-bit 8B, ternary 8B, 1-bit 27B) in
the MaiK Assistant picker. Chosen over the 27B on the numbers: PrismML's own suite has ternary 8B at
85.0% vs 1-bit 27B at 82.9% and 1-bit 8B at 78.9%, and the 27B at 5.2 GB RAM (4K context) would be
the first thing iOS evicts on an 8 GB phone every time the app is backgrounded.

No native change was needed, and this was verified rather than assumed. The plugin links the
mainline llama.cpp b10502 xcframework; that tag's ggml.h already carries GGML_TYPE_Q1_0 (41) and
GGML_TYPE_Q2_0 (42) with Metal kernels, because PrismML's formats were merged upstream after their
March release. Group sizes differ from PrismML's fork defaults: mainline Q2_0 is a 64-weight group,
so the ternary pack points at `Ternary-Bonsai-8B-Q2_0_g64.gguf` (2,310,125,920 bytes), NOT the
default g128 file the model card recommends (that one needs their fork). Q1_0 is g128 in both, so
the 1-bit files are used as published. The 27B's GGUF declares arch `qwen35` (Qwen3.6 backbone),
present in b10502. Licence Apache-2.0 on all three, so direct HuggingFace URLs like the MedGemma
packs. Sizes and sha256 are the HF API's exact size and lfs.oid.

Live on the owner's iPhone 15 Pro: the g64 ternary file downloaded (2.31 GB), loaded and answered on
the unchanged build. Cold first answer 79 s including the load; warm answers 47 to 57 s, about four
times slower than MaiK Lite 1.7B on the same phone, with the retrieved passages in the prompt. Four
questions: two passed the evidence gate, two were rejected and showed the reference passage. So it
WORKS as an offline stand-in and is honest, but it is slow on an 8 GB phone; the flagship badge is a
statement of quality per gigabyte, not speed. The 1-bit 8B and the 27B are in the registry and
unverified on device (same formats, same runtime path).

Routing: `maik-engine.js` `effective()` now sends a `cloud`-preference user to the installed local
pack when `navigator.onLine` is false and `localReady()`. The preference is untouched, so cloud
resumes with the network. Flag `smd_maik_offline_local` ("0" disables). Flagship flag moved from
Apex to `bonsai-ternary-8b`.

REVERSED THE SAME DAY (owner): the first cut grounded the Bonsai packs in the book (`rag: true`,
half their answers were then rejected by the gate, see above). The owner's call is that the Bonsai
models act individually on their own weights and knowledge, ungrounded, unlike MaiK Lite. The
`rag` flag is gone; `ragEligible()` is back to `maik-lite` only. Consequence to keep in mind: a
Bonsai answer carries no evidence gate and no source line, exactly like the MedGemma packs.

## 2026-09-04 — On-device MaiK: where it is reached from, idle unload, and the "not in the reference material" miss

**Coverage audit** (owner asked whether the on-device engine works from CliniX Ask MaiK, OPD Queue
Ask MaiK and Let MaiK Ask). `maik-engine.js` decorates exactly four `SMD_AI` calls: explain,
explainGrounded, explainGroundedStream, refine. Everything that goes through those reaches the
on-device model when it is selected (or offline with the stand-in): the MaiK sheet (home.js), the
reasoning module, ICU explain/explainGrounded, the med list explain, insulin refine, the SurgX
"Ask MaiK" button (opens the sheet via `SMD_askMaik`), and the CliniX tutor (`clinix-tutor.js`
streams through explainGroundedStream). NOT covered, cloud only, fail honestly offline: the CliniX
viva judge (`SMD_AI.vivaJudge`, a dedicated server model), the OPD EMR "Ask MaiK Pro" differential
(`SMD_AI.extract` "opd-suggest"), Let MaiK Ask's finding extraction (`SMD_AI.extract`), translate,
research, vision/OCR, transcription, ICU correlate/evidence/imagingSummary.

SAME DAY, owner: "cant we make them use on device model lite or bonsai". Yes for the two that are
plain structured calls. `maik-local.js` gains `vivaJudge()` and `opdSuggest()`: the server's own
prompts and output whitelisting (viva-judge in [[path]].js, _opd-suggest.js) ported verbatim, run
with the task prompt as the SYSTEM prompt so the interpretive MaiK prompt cannot turn JSON into
prose, temperature 0, tolerant JSON extraction, honest `{error:"parse"}` on garbage rather than an
invented verdict. `maik-engine.js` now decorates `vivaJudge` and `extract`; they go local only when
the effective engine is local, and only extract kind `opd-suggest` (voice, translate and MaiK Ask
extraction keep today's cloud behaviour regardless of engine; KB-only mode has no model and also
stays cloud there). Tracked by the idle unload like any other call.

Measured live on the owner's iPhone 15 Pro (assessment: fever, flank pain, dysuria; viva:
anaphylaxis first step):

| call | MaiK Lite 1.7B | Ternary Bonsai 8B |
|---|---|---|
| OPD differential | 11 to 24 s, thin (1 ddx, 1 investigation, 1 treatment, 1 red flag) | 151 s incl. load, rich (6 ddx, ceftriaxone dosing, 3 red flags) |
| viva judge | 5 to 11 s, verdict right, feedback often empty | 20 s, verdict + proper examiner feedback |

Small-model realities handled in code: MaiK Lite (a prose fine-tune) answers the JSON prompt in
prose about half the time. generateJSON() nudges ("Start your reply with {"), retries ONCE with a
blunter instruction at temperature 0.3, and on a second miss returns {error:"parse", sample}. For
the viva only, a verdict the model states plainly in its opening sentence ("The student's answer is
incorrect because...") is accepted with that sentence as feedback, when exactly one verdict word
appears and "correct" is not negated; anything vaguer stays a parse error. Nothing is inferred.
The 151 s Bonsai OPD call is the honest cost of a 27B-class-quality differential on an 8 GB phone;
the OPD screen shows its busy state throughout and the local path has no 45 s race timeout (that
timeout wraps only the cloud fetch in reasoning.js).

## 2026-09-04 — Bonsai image models, and the on-device model as the offline alternative to AI Vision

Owner asked for "Bonsai Image model as extension to Bonsai, Swift, Max". Facts checked on the HF
API: PrismML publishes an image-reading projector (mmproj) for the 27B only (Q8_0 629 MB, BF16
931 MB); the 8B repos have none and sit on a text-only Qwen3-8B base, so MAiK Bonsai and Bonsai
Swift cannot read images. PrismML's separate "Bonsai Image" family (bonsai-image-binary/ternary-4B)
is a TEXT-TO-IMAGE diffusion model in MLX/gemlite/safetensors builds only: not a vision model, not
loadable by llama.cpp. Registered: `bonsai-27b.vision` = the Q8_0 projector (exact HF size and
lfs.oid). Unverified on a device (the 27B needs a 12 GB phone; mtmd + qwen35 not exercised).

"Let it be the offline alternative to Google AI Vision": image-engine.js already had the on-device
multimodal model as a third engine but only ever offered it in the chooser; its offline path and
every fallback dialog knew only OCR. Now `recommendFor()` recommends "local" when AI Vision cannot
run and a projector is installed; `routeAI()` goes straight to the on-device model when offline
(preference untouched, cloud again with the network); every fallback dialog offers "Use On-device
AI (offline)"; Settings lists On-device AI when a projector is installed; copy names it the
offline alternative and says it is slower and can be wrong. If the on-device read fails too, the
dialog drops to OCR/manual rather than looping to a cloud that is not there.

Picker intro closes with the owner's reassurance to users that our models are still being trained
and will keep improving, thanking them for trusting MaiKnowledge and StewardMD.

**Idle unload** (owner: "make sure model is stopped once we close the tab or its work is done").
`maik-local.js` wraps `answer` and `warm`: any pending release is cancelled while a call is in
flight; when the last one settles a release is scheduled, 3 min with the MaiK sheet open, 20 s
once it is closed. `home.js` `openAskAi()` calls `sheetOpened()` and warms the local pack there;
`close()` calls `sheetClosed()`. A running generation is never cut (close() deliberately lets it
finish and persist). The startup warm-up in `maik-engine.js install()` is gone: no resident 1 to
4 GB model for a session that never opens MaiK. Cost: the first question after a release reloads
the pack (seconds for MaiK Lite, longer for the Bonsai packs).

**"Not addressed in the provided reference material"** (owner screenshot: "Spleenomegaly with
Fever DD and RX" on MaiK Lite). Retrieval missed: the misspelling is in no chunk, "DD" matched the
book's dd-cfDNA passage and "RX" expanded to treatment, junk cleared the score floor, and the model
obediently reported no coverage. Two fixes, both deviations from the Python port and marked as such
in the code: (1) `Book.us()` repairs an unknown 6+ letter word by trying single-letter deletions
against the index vocabulary and taking the commonest hit ("Spleenomegaly" -> "splenomegaly"),
and SYNONYMS gains "dd/ddx/d/d" -> differential diagnosis; (2) `maik-local.js` treats a
no-coverage reply (NO_COVERAGE regex) as a retrieval verdict and re-asks ONCE with no reference
material, returning an ungrounded answer from the model's own weights with no gate and no source
line. The gate is untouched: it still applies to every grounded answer.

Naming caveat for the owner: the labels "MAiK Bonsai / Bonsai Swift / Bonsai Max" carry the upstream
brand, against the tier-name convention (MxCore, Neural, Horizon, Apex). Kept because the owner
asked for the models by that name; rename is a one-line registry edit each.

## 2026-09-04 — Web research: Gemini fallback removed, on-device model writes the answer off-cloud

Owner: "remove gemini fallback" and "let gemini do it during MaiK Cloud selected and for rest
offline or free models we cant charge them for snippet conversion into clean language". Two
separate changes to `functions/api/ai/[[path]].js`'s `seg === "research"` handler (plain web
research, NOT Evidence Review, which is untouched and stays cloud-only):

1. The Gemini-grounded fallback (`webSearch: true`) that ran when TinyFish returned nothing is
   deleted outright, per the literal instruction. It was the slower, costlier of the two search
   paths and duplicated ground TinyFish already covers at $0/search (see functions/_search.js). A
   TinyFish miss is now an honest `{text: null, sources: []}`, which the client's existing no-text
   branch already renders as a clear retry - no new failure mode introduced.
2. A new `body.snippetsOnly` branch, checked BEFORE the quota gate, does the TinyFish search and
   returns raw sources with NO Gemini call and no quota burn - it is a plain search proxy. This is
   what lets an engine other than MaiK Cloud avoid paying for the snippet-to-prose step at all.

Client side: `maik-engine.js` now decorates `research` (it previously reached SMD_AI.research
undecorated, always cloud). Its route() intercepts kind "research" ONLY when `effective() ===
"local"` and mode is not "evidence-review": it calls the new `SMD_AI.researchSnippets()`
(reasoning.js - hits `/research` with `snippetsOnly:true`, the free path above) and hands the raw
sources to the new `maik-local.js` `webAnswer(question, sources, opts)`, which writes the prose on
device using WEB_SYS (RESEARCH_SYS_SNIPPETS ported verbatim, so a web-research answer reads the
same regardless of which engine wrote it) and then runs the SAME `evidenceGate` the book RAG uses -
generic against arbitrary evidence text, not book-specific - so an unsupported drug or figure in a
locally-written web answer is caught exactly as it would be for a StewardMD Knowledge Base answer,
and the gate-fail branch shows the top real source instead of a wrong paraphrase, matching the
book-RAG UX. Cloud engine and KB-only both fall straight through to the unchanged cloud path
(`orig.apply`); a local engine with no `webAnswer` (older bundle) also falls through cleanly rather
than throwing. Web research still needs a live network for the TinyFish call itself regardless of
engine - only the WRITING step moves on-device, not the search.

Dead code removed: `RESEARCH_SYS` (only the deleted fallback used it); `test/maik-cloud-scope.test.mjs`
updated to stop asserting a scope rule on a constant that no longer exists.

Verified live on the owner's iPhone 15 Pro (same question, both engines): local engine ->
{engine:"local", mode:"web-local", 8 free TinyFish sources, 989-char answer, 21 s}; MaiK Cloud ->
{mode:"web-tinyfish", 8 sources, 7 s}, confirming the cloud path is unchanged. Unit coverage:
maik-local.test.mjs webAnswer tests using the REAL kb/ai/maik-lite-rag.js evidenceGate, not a
book-specific stub; maik-engine.test.mjs routing; test/research-web-fallback.test.mjs, a
source-level regression for the two server changes.

## 2026-09-04 — TinyFish restricted to trusted medical domains

Owner: "mk sure tinyfish uses trusted medical resources". `functions/_search.js` `tinyfishSearch()`
now passes TinyFish's `include_domains` param (a comma-separated allow-list the API enforces
server-side, not a ranking hint - confirmed against TinyFish's own docs) with a fixed list of
health authorities (WHO, CDC, FDA, EMA, NICE, ICMR, MoHFW), PubMed/PMC/NIH/Cochrane/ClinicalTrials.gov,
major journals (NEJM, Lancet, JAMA, BMJ), and specialty/reference sites (Mayo Clinic, UpToDate,
Medscape, Drugs.com, the AHA/ADA/NKF/ACS society sites). No general news, forums or unvetted blogs
can ever be returned.

Applied ONCE in the shared helper rather than per caller, because `tinyfishSearch()` is already
shared by three medical-only call sites - "Research on the web" (`/research`), the Medical-Updates
crawler (`functions/_updates_pipeline.js`), and the admin manual-publish enrichment
(`functions/api/updates/[[path]].js`) - all three benefit and none had any reliance on
unrestricted results (checked: both crawler call sites already exist to enrich medical
drug/guideline/headline items, never general web content).

New test/tinyfish-trusted-domains.test.mjs (4 tests, stubs global.fetch) asserts the outbound
request actually carries `include_domains` with the exact list, so a future edit that silently
drops the restriction fails a test rather than being noticed the first time a doctor sees a
non-medical source cited. Verified live on the owner's iPhone after merge+deploy: a real search for
DKA management returned 7 sources, all resolving under the trusted list (bestpractice.bmj.com under
bmj.com, pmc.ncbi.nlm.nih.gov under ncbi.nlm.nih.gov, etc.) - confirms TinyFish genuinely enforces
`include_domains` (subdomain matching included) rather than ignoring an unrecognized parameter.

## 2026-09-04 — "Was this helpful?" feedback: durable storage, an admin console pane, and a "why?" prompt

Owner asked where the answer feedback button's data went (nowhere durable: an anonymous
`maik_feedback_up`/`down` counter via `/api/analytics`, plus a "No" also wrote to a DEVICE-LOCAL-ONLY
gap log in `localStorage` that never reached a server), then asked for an admin console section and
for a "No" tap to ask why and store the reason.

Modeled on the two existing patterns closest to this shape: `functions/_clientlog.js`'s KV ring
buffer (get/record/clear, same shape) and `functions/api/ws-feedback.js`'s anonymous-signal stance
(no identity, an aggregate for public GETs, entries only readable by admin). New:
- `functions/_maik_feedback.js` - `sanitizeFeedback`/`recordFeedback`/`amendFeedbackReason`/
  `getFeedback`/`getFeedbackAgg`/`clearFeedback`. Metadata + the doctor's own free text only: helpful
  (up/down), the question typed (clipped 300), an optional reason (clipped 500), engine/pack, ts, a
  generated id. No identity, no patient data.
- `functions/api/maik-feedback.js` - public, unauthenticated (feedback must never be blocked by a
  sign-in check, matches `/api/clientlog`'s own reasoning). Two request shapes on one POST: a new
  rating `{helpful, question, engine, pack}` records immediately and returns `{id}`; `{id, reason}`
  amends that SAME row. GET is counts-only (never the free text), same split as ws-feedback.js.
- `functions/api/ai/[[path]].js` - `admin/maik-feedback` added to the existing owner-gated
  (`aiAdminAuthed`) admin segment list; GET returns entries (with reasons) + the aggregate, POST
  clears and audit-logs, identical pattern to `admin/clientlog`.
- `admin/index.html` - new "MaiK feedback" pane (👍/👎 counts, % helpful, with-a-reason count, and the
  scrollable list of Yes/No + question + reason), wired the same way as the Crashes pane (`fbLoad`,
  nav badge, PANES/TITLES, `refresh()`).
- `home.js` `_answerFeedback` - "No" now shows "Sorry it missed. Please tell us why - help us
  improve." with an optional reason textarea (Send/Skip), a note against patient details. The
  down-vote is recorded THE MOMENT "No" is tapped (so the admin aggregate reflects every tap, not
  only the ones a doctor stays to explain) and its id is used to amend that SAME entry if a reason is
  typed - never a duplicate row for one tap. Existing `SMD_track`/`MaiKCopilot.gapLog` calls are
  untouched (kept for their existing purposes: the allow-listed analytics counter and the local
  per-device gap report).

14 new tests (`test/maik-feedback.test.mjs`: sanitize/record/amend/aggregate/clear, including that
amending twice never double-counts `withReason` and an unknown id is a safe no-op;
`test/maik-feedback-admin-route.test.mjs`: source-level, the route sits inside the same owner gate
every other admin segment uses and returns the free text only there, never on the public GET).

NOT yet verified: the admin console pane's rendering itself needs the owner's own Google login at
stewardmd.in/admin to see - this session has no admin credentials. What WAS verified is the parts
reachable without them: the client and storage logic pass their tests, and (pending a live device
check after merge+deploy) the network flow from a real "No" tap through to the stored aggregate.

## 2026-09-04 — MaiK CHAT skin: make MaiK feel like ChatGPT / Claude

Owner: "not getting a feel of using an AI assistant like ChatGPT or Claude", asked via the
taste-skill. That skill is scoped to landing pages and says so; what applies here is its discipline
(audit before touching, preserve mode, copy self-audit, kill the decorative tells), measured against
what actually makes those two apps feel like assistants. An audit of the sheet found five concrete
differences, none of them streaming (both engines already stream tokens; native falls back to a
word-paced reveal):
1. every assistant answer was a bordered, shaded, shadowed 92%-wide card with an uppercase teal
   "MAIK" label on top; ChatGPT/Claude render assistant prose unboxed and only the user's turn as a
   bubble
2. "Educational clinical reference. Verify with local protocol." was stamped INSIDE every answer, on
   top of the sheet's permanent banner saying the same thing (no recorded decision required the
   duplicate)
3. 13px body / 12.5px user text: widget-sized, not reading-sized
4. up to 17 tappable bordered chips under one answer (Know more, sources, 6 refine, follow-ups, tool
   chips, Create prescription, Research on the web, Yes/No)
5. thinking = mascot + three shimmering skeleton bars + stage captions, then a whole-bubble swap

Decision: a presentation-only CSS skin on `body.mkchat`, DEFAULT ON, `?mkchat=0` kill switch
(persists in `smd_mkchat`), `?mkchat=1` restores. No DOM or logic change, so flag-off is
byte-for-byte the previous MaiK. It unboxes `.maik-b.ai`, hides `.maik-attr` (with !important: the
web-research path inlines its own display) and `.maik-edu`, hides `.maik-conf` except the LOWER
warning, sets 15px reading text, turns every chip into a quiet outline with muted sentence-case
labels, and hides the skeleton bars. Tokens are untouched so dark mode follows. The existing
off-by-default `body.mk2` "UI 2" skin is left as is; the two are independent selectors.

Also fixed in app-facing strings (repo rule, not the skin): the emoji prefixes on the four follow-up
chips, and the em-dashes in the chip/stage/feedback/error strings the audit listed. The model's own
output remains exempt, as CLAUDE.md says. `test/maik-chat-skin.test.mjs` pins the flag semantics,
each of the five CSS fixes, and the string cleanups. Branch stacks on PR #826 because both touch
`_answerFeedback`.

Not changed, deliberately: the chip SET itself (which chips exist is product logic, not skin), lazy
"Know more" (a token-cost decision), the mascot, the sidebar, the empty state. If the owner wants
fewer chips per answer, that is a separate product call.

Two things the first live check caught (fixed in the same PR): the on-device path renders BARE
`<p>/<ul>/<li>` with no `.maik-p` class, so the 15px rule had missed it (measured 12.5px live); and
the "Create prescription" chip is inline-styled as a filled teal button, which beat the skin. The
skin now targets `.maik-b.ai p/li/strong/em/h1-h4` and overrides `.maik-chip.maik-rx` with
`!important`, leaving the send button as the one filled accent on the screen.

Owner, same session: "Answer can show Bold Italic etc formats to make it more appealing and
reading". The renderer (reasoning.js `maikMarkdown`) already turns `**x**`/`*x*` into `<b>`/`<i>`,
with headings, lists and tables; the gap was that MaiK Lite, a prose fine-tune, emits plain text,
and its system prompt is the exact training prompt and stays untouched. `maik-local.js
emphasize()` adds it deterministically instead: drug names (the evidence gate's own suffix regex
via `SMD_MAIK_RAG.drugsOf`, with a fallback), doses and durations are bolded, only when the model
produced no `**` of its own, after the gate (it changes no figure), never on the Source line, and
never on a verbatim quoted book passage (the gate-fail path shows the book as written). Also
applied to on-device web-research answers. 10 tests.

Verified live on the owner's iPhone 15 Pro, fresh question, MaiK Lite: assistant prose unboxed
(border none, transparent, no shadow, 100% width), MAIK label and per-answer disclaimer gone, prose
measured 15px/24.75px, user bubble 14.5px, two `<b>` drug names in the answer, prescription chip
transparent with muted text, no emoji in chips, app process unchanged through the test.

## 2026-09-04 MaiK Lite assistant gaps: retrieval drift guard, dose follow-up, answer actions (PR #827, same branch)

Owner ran a 5-question live battery ("As an AI Engineer and CEO of ChatGPT, run MaiK Assistant and
tell me what is left"), then: "Fix as many as possible but keeping speed & size of model same".
Model, quant, context and system prompt are untouched. Every fix is in retrieval, the follow-up
resolver and the UI.

1. Retrieval drift guard (`maik-local.js retrieveGrounding`). Live, "UTI treatment" retrieved a
   DEFINITIONS/glossary passage and "what if she is pregnant" retrieved hepatitis-in-pregnancy,
   which the model then answered from (lamivudine/IFN) and the presence-only gate passed. Now:
   the top-3 BM25 hits are anchored on the question's 2-3 highest-IDF non-generic tokens (the
   pregnancy/renal/paediatric modifiers and words like management/dose/first-line are excluded from
   the anchors), passages missing every anchor are dropped, introductory chapters are demoted for
   treatment questions, glyph bullets are cleaned, evidence is capped at 700 chars per passage and
   a weak third passage (<60 % of the top score) is dropped. Net effect is fewer, more relevant
   prompt tokens, so prefill gets shorter, not longer. The gate itself is unchanged (repo rule:
   never weaken it). If anchoring empties the set, the answer is "not covered", not a drift.
2. Gate-fail fallback shows the cleaned, capped passage, and states plainly that the model's answer
   could not be verified; the raw "■■ DEFINITIONS" dump is gone.
3. Dose follow-up (`home.js maikResolveFollowup`). "and the dose?" with no drug named and none
   remembered used to answer "Which drug's dose would you like?". It now resolves to the current
   topic's first-line drug and dose, with retrieval steered at "<topic> first line drug dose
   duration". Named or remembered drugs keep precedence.
4. Answer actions: Copy (answer text only, chips/sources stripped), Regenerate (drops the cached
   render, resends with `regen: true`, which the local engine maps to temperature 0.4 so the answer
   actually changes; default remains temperature 0), Edit (question back in the composer).

Tests: `test/maik-local.test.mjs` (real RAG index harness for the drift cases, cap/weak-third,
regen temperature), `test/maik-followup-actions.test.mjs`. `anchorsFor` degrades to "no anchoring"
when the RAG build lacks a tokenizer instead of throwing (an exception there would silently turn
every answer ungrounded, which the older test stubs exposed).

Not fixed, same-model constraint: first-token latency (3-7 s) is prefill-bound; the real lever is
KV prefix caching of the fixed system prompt in `LlamaEngine.swift`, which is native work and a
separate PR.

Addendum, second live battery same day (after the guard above shipped to the phone): CAP comparison
still grounded in typhoid-resistance passages because "community" alone was an anchor match, and
"UTI" was lost as an anchor since expand() rewrites it to the long form. Anchors are now three
kinds (topic / drug / population modifier); a passage must contain a topic anchor when the question
has one (a drug name is not the topic), two anchors beat one when any passage has two, search runs
3x TOPK and keeps TOPK after filtering, and among on-topic passages the ones mentioning the asked
modifier win (negated "non-pregnant" excluded). Result on the phone, MaiK Lite, same model: UTI
treatment grounded (TMP-SMX / nitrofurantoin / fosfomycin, 6.7 s first text); "and the dose?"
grounded 3-day oral regimen, gate passed (4.1 s); "what if she is pregnant" UTI-in-pregnancy
(2.0 s); CAP comparison pneumonia passages only, honest "not compared head to head" (6.4 s);
pregnancy follow-up after CAP stays on CAP; poem refused (1.1 s). Copy / Regenerate / Edit on
every answer. `window.__smdLastGate` holds the last gate rejection (numbers, drugs, anchors,
headings; never passage text) for triage.

## 2026-09-04 WardSynQ: one system with Ward Sync, and the P0 core

**WardSynQ is a module inside StewardMD, not a separate repo or product codebase** (owner, 2026-09-04).
`wardsynq.com` is its EMR web surface. A separate `~/Developer/WardSynQ` repo was started earlier in
the same session and abandoned on that instruction; nothing depends on it.

**Ward Sync and WardSynQ are the same system.** The existing GIMSR GHIS integration (`ghis-ward.js`,
`wardSync` state in `icu.js` / `medlist.js` / `autofetch.js`) is not a parallel feature to be kept
alongside a new EMR. It becomes the first hospital-data adapter under WardSynQ's future Integration
Hub. The pipeline the owner specified:

    GHIS / existing Ward Sync connector
      -> WardSynQ canonical clinical model
      -> Clinical Event Bus
      -> Safety / Workflow / AI / Patient 360 / EMR

with HL7 v2, FHIR R4, DICOM/DICOMweb, LIS, ABDM and IoMT following the same adapter shape. The
binding constraint: **no adapter-specific logic in WardSynQ core.** GHIS lab-name mapping, unit
conversion, token handling and the GIMSR picker stay in the adapter. Existing mobile behaviour keeps
working while it migrates onto the shared layer.

**Not started: the `ghis-ward.js` migration itself.** It touches live mobile code that the ICU
flowsheet, medlist and autofetch all read through, so it is its own reviewed change, not a side
effect of scaffolding.

P0 shipped three files plus 44 tests (`wardsynq/wardsynq-model.js`, `-events.js`, `-meds.js`,
`test/wardsynq-p0-core.test.mjs`). Nothing is wired to the app, nothing is flagged on, there is no UI
and no persistence layer. See `vault/modules/WardSynQ.md` for the design rules; the ones most likely
to be undone by accident are that the eMAR holds no clinical pharmacology (the safety engine is
injected, and its default refuses everything), and that `ADMINISTERED` is structurally reachable only
from `SCANNED`.

Deliberately NOT written, despite the spec listing them: `wardsynq-safety.js`,
`wardsynq-safety-case.js`, `wardsynq-temporal.js`, `wardsynq-mpi.js`, `wardsynq-store.js`,
`wardsynq-interop.js`. The spec routes the clinical-safety files to Opus-level clinical reasoning and
they were kept out of a scaffolding pass on purpose.

Tooling note for future sessions: the owner approved using `agy` (Gemini Antigravity CLI) for small
local tasks, but the Claude Code auto-mode permission classifier refused to spawn it from a
background session, with both `--dangerously-skip-permissions` and `--mode accept-edits`. An owner
saying "go ahead" does not lift that classifier; it needs a Bash permission rule in settings.

## 2026-09-04 WardSynQ safety engine: reuse the interaction data, seed the allergy gap

Built `wardsynq-safety.js` plus store, MPI and an adapter. 127 tests. Still unwired: no flag, no
route, no UI. Three decisions worth not re-deriving.

**Reuse, do not re-author, the interaction data.** A survey of the repo found
`data/interaction-rules.json` already carrying 310 curated rules and 2620 generic-to-class mappings
(ONC HPDDI, openFDA SPL, CredibleMeds, RxNorm) behind the existing `interactions.js` engine and its
tests. WardSynQ reads it through `wardsynq/adapters/wardsynq-rules-stewardmd.js`. A second copy of
drug-interaction content that can drift from the first is a patient-safety problem, not a
duplication smell. CredibleMeds licensing needs checking before commercial use.

**The allergy data did not exist, so it is a labelled seed.** The same survey found no allergy
cross-reactivity data of any kind: no beta-lactam class map, no sulfonamide grouping, nothing. The
Allergy Shield had nothing to run against. `wardsynq/data/allergy-classes.seed.json` fills it,
marked UNAPPROVED with a review date, using the modern side-chain understanding of beta-lactam
cross-reactivity rather than the discredited 10 percent figure, and deliberately recording
sulfonamide-antibiotic to non-antibiotic cross-reactivity as NONE so a later reviewer does not
"helpfully" add it. Dose ceilings are a similar eight-drug seed: StewardMD's max doses exist only as
free-text monograph prose, and regex-parsing prose into a hard-stop is not acceptable.

**Severity and disposition are separate axes.** Severity is the clinical judgement; disposition is
the policy decision about who may proceed anyway. Verdicts carry `blocks` (Category 1, absolute) and
`overridables` (Category 2, audited handshake) separately, and a test asserts that NO override
payload, however well formed or witnessed, can clear a block. A finding may only move between the
two by a reviewed change to a rule pack, never by a code change in the engine and never by a caller
passing a flag. This is the invariant most likely to be quietly eroded later.

**Two drug vocabularies, found the hard way.** The RxNorm-derived data spells amoxicillin
"amoxicillin anhydrous"; every clinician and allergy list writes "amoxicillin". An integration test
expecting an amoxicillin order to trip a penicillin allergy caught the shield failing open.
Reconciled in the adapter by aliasing a multi-word generic's first word to it only when exactly one
generic starts with that word, with allergy membership indexed under both spellings; ambiguous first
words get no alias and the drug is reported unresolved instead of guessed. Every future adapter
(HL7, FHIR, ABDM, LIS) will hit this and needs the same discipline.

Two of these files were written by delegated agents (`agy` for the store, a Claude subagent for the
MPI) against written briefs, then verified here: the MPI's Jaro-Winkler and Soundex were checked
against published reference values including Tymczak and Pfister, and every suite was re-run
independently rather than trusted from the agent's own report.

## 2026-09-04 WardSynQ: the GHIS adapter exists, the cut-over does not

Built `wardsynq/adapters/wardsynq-ghis-adapter.js` (23 tests): GHIS bundle to canonical model, onto
the Clinical Event Bus. This is the owner's stated architecture (Ward Sync becomes WardSynQ's first
interop adapter) implemented as the non-destructive half.

**Deliberately NOT done: rewiring the live path.** `ghis-ward.js`, `icu.js`, `medlist.js` and
`autofetch.js` are untouched. The adapter is pure mapping with no fetch, no token, no live state.
`ghis-ward.js` keeps transport, the per-doctor bearer token (`ghis_token:<uid>`), the 401 silent
refresh and the patient picker. Splitting it this way means the mapping is verifiable in a test with
no network, and the risky part is a separate reviewed change against code real users depend on.

**What a cut-over will have to preserve** (from the survey, all read directly rather than through an
accessor): `STATE.wardSync` shape `{connected,lastTs,patientId,newUpdate}` is read at icu.js:556,
2286, 2424, 2431, 2434, 3718, 6433, 8538, plus autofetch.js:57 and ghis-ward.js:1076. Roster ids are
derived as `"pw_"+patientId` / `"w_"+patientId` (icu.js:873-918). `wardSwitchGuard` (icu.js:725-730)
keys cross-patient contamination protection on `bundle.patientId`. `ingestFromWard`'s conflict logic
treats `STATE.src[key].source === "Manual"` as clinician-entered and everything else as overwritable,
so a new source name must never be "Manual". `GHIS.getSelectedPatient()` is the sole handle
`ghis-meds.js` and the DDI patient context use.

**Three traps in the payload, each pinned by a test.** `dob` is an AGE in years as a string, so
parsing it as a date gives a patient born in year 45, and age drives paediatric dosing; the adapter
records `ageYears` and leaves `dob` as a sentinel that does not parse as a date. `wardToSI` in
icu.js does the opposite of its name (SI back to conventional), so the adapter does no unit
normalisation at all and flags `unitNormalised: false` while keeping the raw value and unit.
`patientId` is the MRN, with no separate UHID.

**Model gap found by the adapter, now fixed:** `Encounter` had no `identifiers` field, so a source
visit id could only survive by being baked into the generated `id` string, which no consumer can
parse back out. Every adapter after this one (HL7 visit numbers, FHIR Encounter.identifier) would
have hit it.

Adapter contract for everything that follows: stable ids from source-stable parts only; nothing
silently dropped (unmapped vocabulary keeps its name and raises an issue, one bad row never discards
the import); the raw source preserved on every record; no invented clinical values; and a source
system's own assertions (GHIS's `critical` flag) carried as data, never promoted to a control.

## 2026-09-04 WardSynQ workstation, and two safety bugs only the UI exposed

Built the EMR surface (`wardsynq/ui/`): patient banner, worklist, order entry with live safety
checking, and the override handshake. Buildless native ES modules and hand-written CSS, importing
the same source the tests import, so the screen cannot drift from tested behaviour. No clinical
logic in the UI: every verdict comes from the real engine against the real pack.

**taste-skill was the wrong tool and says so itself.** Its section 13 excludes dashboards, dense
product UI and data tables, which is exactly what a clinical workstation is. Used
`ecc-healthcare-emr-patterns` instead. Design dials set deliberately against web defaults: variance
LOW (a clinician must find the same control in the same place at 3am), motion LOW (movement in a
ward UI is distraction, and an animated critical alert is worse), density HIGH.

**Two real bugs found by driving the interface, neither caught by 165 unit tests.**

1. **Duplicate-therapy rules fired on a SINGLE drug.** All 270 `duplicate_class` rules in the pack
   carry exactly one subject, meaning "two or more drugs in this class". Read literally by a
   generic matcher they fire when only one is present, so ordering warfarin for a patient on
   nothing else raised a MAJOR "two systemic anticoagulants" alert and demanded an override
   handshake for a duplication that did not exist. That is a false gate on the majority of ordinary
   orders, and the fastest possible way to teach clinicians to click through safety prompts. Fixed
   with `satisfyDuplicationRule`, which requires at least two distinct matching drugs and names all
   of them in the finding.
2. **Alert fatigue by class multiplicity.** Amoxicillin plus clarithromycin produced SIX identical
   duplicate-therapy advisories, one per shared class tag, including tags meaningless at the bedside
   ("Chemical Structure", "Established Pharmacologic Classes"). Fixed with
   `collapseDuplicateFindings`, grouping by rule type, severity and drug set; every contributing
   rule id survives in `mergedRuleIds` so an audit loses nothing. Findings of different severity or
   about different drugs are never collapsed. Together these took the amoxicillin case from seven
   findings to three.

**A UX bug that is really an audit-quality bug.** The verdict panel re-renders on every keystroke in
the order form, which destroyed a half-typed override rationale. A clinician who loses a careful
justification once starts writing "as discussed", and the audit trail quietly stops being worth
reading. Drafts are now preserved across re-renders.

**Buildless ESM caching gotcha.** A `?v=` token on the entry script does NOT invalidate the modules
it imports: ES module imports are cached per URL. The workstation ran stale safety logic in the
browser while the served file and the tests were both correct, which is a genuinely dangerous
failure mode for a safety control. Development now uses a no-store dev server; a production
deployment needs cache headers on the module files, not just a version token on the entry point.
StewardMD's `?v=goldNNN` convention has the same blind spot for anything loaded as a module.

The screen states the rule pack version and its approval status permanently, because a clinician
trusting seed data because the interface looked finished is a foreseeable route to harm.

## 2026-09-04 WardSynQ workstation: redesign after the first pass read as AI-generated

Owner feedback: the font and the safety boxes looked "vibe coded". Correct on both counts, and the
first pass had more tells than those two.

**What was wrong.** The font stack was `ui-sans-serif, Segoe UI, Roboto` — the most generic possible
choice, in a file whose own comments said to avoid generic stacks. Findings rendered as rounded
tinted cards with a thick coloured left border and an uppercase micro-label, which is the standard
LLM alert-card shape. Containers nested three deep (panel inside card inside card) so there were
three levels of box and no levels of hierarchy. Severity colours were washed-out pastels that read
as decoration. The dose field was 800px wide for three digits. A "checked in 0.3 ms" floated in the
top right corner attached to nothing.

**Direction, from the ui-ux-pro-max database rather than taste.** Swiss / International grid style
(its match for enterprise dashboards and professional tools), dials variance 3, motion 2, density 9.
Typeface **Fira Sans with Fira Mono**, the database's dashboard and analytics pairing. Fira was drawn
for legibility at small sizes on poor screens, and the matched monospace is the point: every clinical
number here is tabular, so a decimal sits in the same column down a list and 1.42 cannot be misread
as 142.

**What changed structurally.** Ruled bands instead of nested rounded cards. A label column plus a
control column, with controls sized to their content, because a field's width is a hint about what
belongs in it. Findings are a severity rail plus a ground, where **fill intensity is the hierarchy**:
a hard stop is filled and unmissable, an override is lightly filled, an advisory has no fill at all
and recedes. Making advisories quiet is the alert-fatigue lesson expressed in the layout, and it is
what keeps the filled one noticeable. The override handshake now sits inside the finding it belongs
to, separated by a rule rather than by a second border and radius. The results table is deliberately
NOT full width: five columns stretched across 950px puts a value half a screen from its reference
range, and long scan distances are how a value gets read against the wrong row.

**Unchanged on purpose.** Severity is a word before it is a colour, everywhere. Both colour schemes
ship and both were checked visually, not assumed. 44px targets.

**PRODUCTION GAP:** the webfont loads from a CDN in this build. A ward loses its network, so a real
deployment must self-host the woff2 files. The fallback stack is ordered to degrade to another
tabular-capable face rather than to something that reflows every number, but that is a mitigation,
not the fix.

## 2026-09-04 WardSynQ workstation v4: designed as a clinical instrument, not a dashboard

Owner brief: Bloomberg terminal meets Apple clinical software meets modern ICU workstation. Premium,
dense but calm, no generic SaaS or shadcn look, safety engine as the hero, never weaken a warning
for aesthetics. Built directly into the existing buildless app: vanilla ES modules and token-driven
CSS, no framework added, engine untouched apart from one additive field (`effect` and `action` kept
separately on interaction findings so Risk and Guidance can render as distinct facts).

**Critique of the previous pass that drove this.** The patient was a header, not the object. The
safety result was a paragraph in a tinted box; a clinician under pressure needs Risk, Mechanism
and Guidance as separable facts. Labs sat in a table three scrolls from the decision they inform.
The override was a form, not a decision. Typography was competent but anonymous.

**Decisions.**
- Type: IBM Plex Sans + IBM Plex Mono. Built for dense enterprise data, true tabular figures, and a
  mono that carries the terminal register without cosplay. Every clinical number is mono/tabular.
- Tokens in `:root` for colour, type scale, space, radius, hairline/rail widths, shadow, motion.
  Components only use tokens. Severity scale: critical, major, moderate, monitor, info, ok. Fill
  intensity is the hierarchy: critical and major filled, moderate lightly, monitor and info unfilled
  so they recede and the loud finding stays loud.
- Patient context bar: sticky, hairline-separated segments (identity, MRN, location and status,
  allergy with rail, actions). 59px. The allergy is in the bar, not a panel, because the hazard is
  acting on the wrong chart.
- Sidebar: chart navigation with keyboard hints plus the ward worklist; Notes and Alerts present but
  aria-disabled with a title, rather than faked.
- Workspace: order and safety engine in the main column, clinical context (results as data points,
  dosing context, active meds) in an aside beside the decision. Results are a figure, a name and a
  WORD for the flag; abnormal cells are lightly filled.
- InteractionCard: severity badge (word first), drug pair in mono, rule code, then Risk and
  Mechanism as a labelled fact grid, with Guidance, Monitoring and rule id under a native
  `details` disclosure. Merged rule count shown as "and N related".
- OverridePanel: "Override required. Why are you proceeding?" with four reason buttons (Clinical
  necessity, No suitable alternative, Benefit outweighs risk, Other), rationale, Cancel and "Apply
  override and sign", and a line stating it is recorded to the clinical audit trail. Drafts survive
  re-render. Apply records the override, re-evaluates, and signs only if the engine then allows.
- AuditTrail: an in-session list of override and signing events, timestamped.
- Keyboard: Enter advances fields, Ctrl+Enter signs when allowed, Esc clears, N/O/L/M/P jump.
- Engine status line in the safety header: "310 rules in 0.3 ms" with a state dot.

**Verified, not assumed.** Viewport screenshots read by eye in light mode; end-to-end override
flow driven in the browser (gating, draft survival across a mid-entry re-render, apply and sign,
audit entries, active medication list updated); zero console errors; 173 tests, 172 passing.

**Production gaps recorded.** Webfont from CDN (must self-host; wards lose network). Dark scheme
tokens exist but this pass was checked by eye in light only. Notes and Alerts are placeholders.

## 2026-09-04 WardSynQ v5: an original visual language, and the defects redesigning it exposed

Owner rejected v4 as still AI-coded and generic-enterprise. Correct. The `frontend-design` skill
lists the current AI-design tells, and v4 hit three of five by name: broadsheet layout with hairline
rules, tracked-out all-caps eyebrow labels above every heading, and a monospace face for small data
labels. It was the generated default, not a designed thing.

**Research actually read** (subagent, `gh`/WebFetch, cited in full in the session): NASA Open MCT
(`_status.scss`, `_limits.scss`), NHS.UK design system colour + service manual, GOV.UK type scale,
IBM Carbon `packages/type`, GitHub Primer `primitives`, Microsoft Fluent 2 `packages/tokens`,
OpenMRS O3 esm-styleguide, Bahmni, Medplum.

**Principles extracted, and what each changed here.**
- Open MCT encodes a limit violation on four independent channels: glyph, colour, border and dash
  spacing, with limit DIRECTION as a separate arrow. Severity survives with colour removed. Adopted
  as the core idea: WardSynQ's marks differ in LENGTH, WEIGHT and TEXTURE (solid, broken, dot)
  before they differ in hue, and result deviation is split from result direction.
- NHS.UK: "make sure what the colour is saying is available in other ways", and a grey-tinted ground
  to cut glare for sustained reading. Our ground is a low-chroma green-grey for that reason.
- GOV.UK: tabular figures are opt-in per element, not global. v5 scopes `tabular-nums` to results,
  dose and dosing facts; running clinical prose gets proportional figures.
- Primer: monospace is policy-restricted to code. Fluent 2 goes further and gives numerals their own
  family rather than reaching for mono. v5 has exactly ONE monospace use left, the MRN.
- Carbon/Primer/Fluent all use ONE family for every text role. v5 uses Source Sans 3 throughout.
- Anti-pattern found: Bahmni and Medplum document no typography, density or accessibility policy at
  all, and O3's tokens are gated in Zeplin. Being used in real hospitals is not evidence of design
  rigour, so none of them was treated as a model.

**The original idea: the signal column.** A narrow channel down the left of the workspace is the only
place colour appears. Every clinical statement registers a mark there; nothing else does. It is not
any of the references: Open MCT marks rows in a table, this binds a whole workspace to one continuous
significance channel, so peripheral vision answers "is anything wrong on this screen" before a word
is read. Findings are written as clinical sentences (significance, then the patient's own data as
context, then what to consider, then what an override actually does) rather than a labelled
Risk/Mechanism grid, and mechanism moves under a disclosure because it is study material.

**Colour earns its place.** The allergy on the identity bar is unfilled until the drug being ordered
actually implicates it, verified: ordering amoxicillin lights it, ibuprofen does not. A chip that is
red all day is wallpaper by the second shift.

**THREE REAL DEFECTS the redesign exposed, none cosmetic.**
1. **The medication input rendered at 1.2:1.** The signal mechanism set `color` on the line so the
   mark could use `currentColor`, and it cascaded into descendants: with `data-sig="none"` the drug
   field drew its text in the hairline grey. A clinician could not read the drug name they had just
   typed. The mark now rides on its own `--mark` property and never touches text. Now 18.35:1.
2. **Duplicate-therapy findings with subset drug lists.** The screen showed the same sentence twice,
   once for two drugs and once for three including both. `collapseDuplicateFindings` now absorbs a
   finding whose drugs are a strict subset of an identical one at the same severity, keeping the
   superset because it names every drug involved. Three tests pin it, including that different
   severities and different messages are never merged.
3. **A disabled commit button at 1.85:1.** `.btn[disabled]` outranked `.btn-commit`, leaving muted
   text on the signal fill, so the clinician could not read what the button would do before earning
   the right to press it. Disabled now drops the fill instead of dimming text on top of it.
Also: the signal column marked non-clinical rows with a vestigial dot. A channel that marks every
row means nothing, so plain lines now render no mark at all.

**Verified:** light and dark by eye at 1680x1000; contrast measured in both schemes (body 7.4 to
17.5, severity words 5.95 and 7.84, inputs 13.9 to 18.4); tab order runs drug, dose, unit, route,
the four reason chips, rationale; no horizontal overflow at 1180; full override-to-signature flow
driven in the browser including draft survival across a mid-entry re-render; 176 tests, 175 passing.
Zero uppercase labels and one monospace use remain in the stylesheet.

**Still open:** webfont from CDN must be self-hosted for wards without network; Notes and Handover
are disabled placeholders; the clinical seed content remains unapproved.

## 2026-09-04 WardSynQ: the safety case is executable, and it says 4 of 11

Built `wardsynq/wardsynq-safety-case.js` and `scripts/wardsynq-assurance.mjs`. The spec's hazard
table is now code whose verification column names real tests, and the script runs the suites, parses
TAP, and cross-references what actually passed. A hazard whose named test is renamed or deleted
reports MISSING TEST instead of quietly continuing to look verified, which is how a paper safety case
decays the week after it is signed.

**The honest number is 4 of 11 fully verified**, 4 partially controlled, 3 uncontrolled. Verified:
HAZ-MED-01 interactions, HAZ-MED-02 allergy, HAZ-MED-03 dose ceilings, HAZ-MED-04 bedside five
rights. Uncontrolled with nothing built: HAZ-DIAG-01 critical-result acknowledgement, HAZ-BLD-01
transfusion compatibility, HAZ-SURG-01 the WHO surgical checklist.

**The file caught itself lying on its first run.** HAZ-AI-01 and HAZ-DEV-01 came back VERIFIED
because their declared tests passed, while their own caveats said no control had been built: the
model carries `aiDrafted` and `artifact` FIELDS and nothing enforces or ever sets them. A green row
for a control that does not exist is worse than no safety case at all. Controls now declare an
`adequacy`, and a partial control is capped at PARTIAL however green its tests are, because tests can
show that what was built works but never that what was NOT built was unnecessary. That single change
took the headline from a flattering 8 of 11 to a truthful 4 of 11.

Its own test suite is written as attempts to make it lie: an all-passing run must still report the
uncontrolled hazards as uncontrolled, a partial control must not be promoted, a renamed test must
surface as missing evidence rather than success, an empty run must leave nothing looking verified,
and the report must open with what is not covered because an assurance report that leads with its
successes is a marketing document.

Exit code is 1 only on FAILING, deliberately 0 on UNCONTROLLED and NO_EVIDENCE: those are declared
gaps in an early build, and a gate that fails from day one is a gate somebody switches off.

Two caveats on the artefact itself. VERIFIED means the named tests pass, not that the control is
clinically adequate; that judgement belongs to the named approver. And HAZ-MED-01 through 03 are
verified as MECHANISMS while their clinical content is still unapproved seed data.

## 2026-09-04 WardSynQ: the three uncontrolled hazards are now built

Built controls for the three hazards that had nothing at all, in the owner's priority order. 269
tests, 268 passing, 1 skipped. Assurance moves from 4 of 11 verified to 7 of 11, with 0 uncontrolled.
The scoring methodology was NOT touched; every point came from a control that now exists.

**HAZ-DIAG-01, `wardsynq-critical.js`.** The whole loop: deterministic classification against an
injected threshold pack, responsible clinician identified, dispatch, delivery, viewing,
acknowledgement, documented action, time-driven escalation, append-only ledger. Design rules each
exist because of a way the control could be defeated: a source system's own critical flag can RAISE
a loop but never close or veto one; no state may be skipped; timestamps are server-assigned so an
acknowledgement cannot be backdated; escalation has no suppression flag; viewing does NOT stop
escalation because a result that was looked at and abandoned is the hazard; acknowledgement alone
does not close the loop because seeing a potassium of 7.1 is not treating it.

Caught during the build: `tick()` was a correct method that nothing called, which would have left
the state machine right and the clinical control absent. Added `CriticalResultMonitor`, whose
`pump()` drives every live loop and whose failures are isolated so one broken loop cannot silence
every other patient's result.

**HAZ-BLD-01, `wardsynq-transfusion.js`.** ABO and RhD compatibility live in code because they are
immutable biology; anything genuinely local, such as D-positive to D-negative policy, is injected.
Red cell and plasma tables are kept separate and both matrices are asserted by hand in the tests,
because plasma is the INVERSE of red cells and one shared table would be lethal in one direction.
Nearly all the effort is on identity: the crossmatch binds one unit to one patient, and the bedside
check needs two different named people, a scanned wristband, a scanned unit, and RE-DERIVES
compatibility from the physical bag rather than the crossmatch record, so a mislabelled bag is
caught by the check that matters. Platelets are explicitly refused rather than guessed.

**HAZ-SURG-01, `wardsynq-surgical.js`.** Incision is unreachable until Sign In and Time Out are
complete, and complete means every item explicitly confirmed plus three DIFFERENT people signing as
surgeon, anaesthetist and nurse. The laterality chain is the interesting part: the side is declared
once at booking and re-asserted independently at marking, Sign In and Time Out, each compared to the
BOOKING rather than to the previous step, so an early error cannot propagate by agreement. Consent
must match procedure and side. An operative record is refused while any milestone is outstanding,
because otherwise the gate would only delay the paperwork.

**One test was rewritten and it is worth being explicit that this was not a weakening.** The safety
case test "the report leads with what is not covered" asserted the literal string UNCONTROLLED as
the first row. It went stale the moment the last uncontrolled hazard was genuinely built. It now
asserts the general invariant instead, that the report leads with the worst status actually present
and never with a verified row while anything is unverified, and additionally that the whole listing
stays ordered worst first. The scoring, the adequacy cap and the criteria are unchanged.

**Status vocabulary, kept distinct as the owner asked.** All three are IMPLEMENTED and TESTED. None
is CLINICALLY VALIDATED or CLINICALLY APPROVED. The critical threshold pack is unapproved seed and
models ADULT limits only, so a paediatric result classified against it would be wrong. Transfusion
covers ABO and RhD only, with antibody screening, phenotype matching, special requirements, massive
transfusion and neonatal rules all absent. The surgical item set is shorter than the full WHO
checklist and than most local variants. No barcode hardware is integrated anywhere, so every bedside
gate is verified against supplied scan values rather than a scanner.

**Remaining, in priority order:** HAZ-AI-01 is the worst of the four PARTIALs, because the AI
boundary is currently a convention with nothing enforcing it and the store will accept a
signed-looking record from any caller; it needs an actor model. Then HAZ-DEV-01 (fields exist,
nothing sets them), HAZ-DOWN-01 (offline and three-way merge), and HAZ-ID-01 (cross-context chart
contamination).

## 2026-09-04 WardSynQ: actor model, device gateway, offline reconciliation, and the shadow tap

Four pieces. 343 tests, 342 passing. Assurance moves 7 of 11 to 10 of 11, with one hazard held at
PARTIAL deliberately.

**HAZ-AI-01, `wardsynq-actors.js`.** The boundary was a convention: the model carried `aiDrafted` and
`signedBy` and the store would accept a record claiming `status: "active"` and `signedBy: "dr-x"`
from any caller including the model that wrote the draft. Now a four-tier ladder where the ceiling is
a property of the actor's KIND rather than its configuration, clamped at construction on a frozen
object, so no AI, device, adapter or service actor can hold EXECUTE by any route. A signature is an
act: only a credentialed human writing as themselves may set `signedBy`.

One rule was removed during the build for being both weaker and wrong. It refused a record claiming
`aiDrafted: false`, which broke on ordinary writes because the model factory defaults that field to
false, and which could only ever catch a claim it could see. Replaced by stamping provenance at the
point of writing, which cannot be evaded by omitting, defaulting or misspelling the claim.

**HAZ-DEV-01, `wardsynq-iomt.js`.** `signalQualityIndex` and `artifact` existed and NOTHING EVER SET
THEM. Now a gateway sets them. The bigger half of the hazard is attribution rather than noise: a
reading from an unassociated device is REFUSED rather than queued or guessed from the bed, and moving
a monitor explicitly ends the previous claim so no chart has two live claims on one device. Artefact
is derived from signal quality and plausibility and cannot be overridden by a payload asserting its
own data is clean. An implausible value is marked but never discarded, because an SpO2 of 71 is a
sick patient rather than a broken sensor. Clock skew is marked, never corrected.

**HAZ-DOWN-01, `wardsynq-offline.js`. HELD AT PARTIAL ON PURPOSE.** Three-way reconciliation against
the common ancestor: only disjoint field changes combine automatically, anything signed or
administered is never folded into, and the same field changed on both sides becomes a conflict
carrying both versions and the ancestor. A conflict cannot be resolved without a named clinician and
a rationale, and the discarded version stays on the record. That closes the silent-overwrite half.
The data-loss half is NOT closed: the journal is in memory, so a workstation losing power mid-outage
loses the charting it held. Raising this to full would be exactly the flattering arithmetic the
adequacy cap exists to prevent.

**The Ward Sync cut-over: shadow first.** `wardsynq-flags.js` follows the insulin-flags pattern, all
flags default OFF. `wardsynq-shadow.js` observes: with the flag on, a bundle already ingested by the
legacy path is additionally passed through the adapter and the two compared. Three properties make
it safe, in order of importance: icu.js is NOT MODIFIED, the wrapper is installed from outside so not
loading the file removes the change entirely; the legacy result is computed first and returned
untouched; and the shadow cannot throw into the caller, so an adapter defect is a number on a report
rather than a broken ward round. A legacy throw still propagates, because swallowing it would turn a
real ingest failure into a silent success.

The cut-over proper is NOT built and its flag says so. It should happen only after the shadow has run
against real ward data and `report().clean` has stayed true.

**Two safety-case tests were rewritten and neither weakened anything.** The literal example naming
HAZ-AI-01 as the partial-control regression went stale when that control was genuinely built; it now
pins to whatever is currently partial and asserts the set is non-empty so it cannot pass vacuously.
The scoring, the adequacy cap and the criteria are unchanged.

## 2026-09-04 WardSynQ: the last open hazard, and guarding the number against itself

Closed HAZ-DOWN-01 by making the offline journal durable. 351 tests, 350 passing. Assurance reads
11 of 11 verified, which is exactly the point at which this artefact becomes dangerous to read
carelessly, so the report changed too.

**Durability.** `OfflineJournal` now takes a backend and `record()` is async and does NOT resolve
until the entry has reached storage. A UI that reports a note saved before that resolves is lying to
a clinician, so the ordering is durable-first: a failed write reports failure and is not held in
memory pretending to be journalled. `open()` restores a previous session's work, sorted by when it
was written, skipping unreadable rows so one half-written entry cannot cost a clinician the rest of
the night's charting. Reconciliation now clears settled entries from disk while leaving unresolved
conflicts, so a device dying mid-reconciliation comes back holding only the work still owed a
decision. `IndexedDBJournalBackend` resolves on transaction COMPLETE rather than request success,
because a device dying between those two moments would lose an edit it had already acknowledged.

**Two caveats kept on the record rather than buried.** The durability tests exercise the backend
INTERFACE through an in-memory implementation; the IndexedDB adapter itself is reasoned about rather
than proven. And nothing yet wires the journal into the workstation, so the control exists and an
application that does not use it gets none of it.

**The safety case tests fired their own guards, twice, and that was the design working.** With
nothing left partial or unverified, the cap test correctly declared itself vacuous ("add a partial
fixture rather than deleting the rule") and the ordering test found VERIFIED first. Both now assert
against SYNTHETIC hazard fixtures containing one of every status, so the rules stay enforced no
matter how the real table evolves, and additionally check the live table. That is strictly stronger
than the versions that went stale: a rule that can pass vacuously is a rule that has quietly stopped
working. Scoring and the adequacy cap are unchanged.

**The report now qualifies itself unconditionally.** A headline of "11 of 11" with nothing beside it
will be read as "safe to use on patients", which is not what any row says. Every run now prints, in
the header: VERIFIED means the named tests pass, it does NOT mean the control is clinically adequate
or that its clinical content is approved; how many hazards carry an unapproved-content caveat
(currently 9 of 11); and that nothing in the build is clinically validated or approved. A test
asserts the qualifier is present even on an all-green table, because that is when it matters most.

## 2026-09-04 WardSynQ: the workstation now stands on the controls

Phase 1 of what was left: wiring. Before this, `grep` showed the workstation used none of
GovernedStore, OfflineJournal or makeActor. The safety case read 11 of 11 while the UI wrote
straight to the raw store with no actor, no session binding and no journal. An enforcement point off
the path enforces nothing, so three hazards carried a caveat saying so.

**What changed.** The workstation holds a credentialed human actor and a governed session rebound on
every patient switch. Seeding uses a SERVICE actor, capped below EXECUTE by its kind. Offline writes
go to a durable IndexedDB journal and reconcile on reconnect. Governance denials are surfaced in the
record rather than swallowed, because an interface that hides a refusal teaches clinicians the
software is flaky rather than that it is protecting them.

**A real hole found by the wiring, not by a test.** `Reconciler` wrote through the RAW store, so an
outage's worth of charting would have been committed with no actor at all: the exact hole the
governed store exists to close. Added `GovernedStore.asStoreFor(actor)`, an actor-bound but
chart-unbound handle for machinery that legitimately spans patients, and moved reconciliation onto
it. Chart binding is dropped rather than faked, because pretending a batch job has one chart open
would make the WRONG_CHART check meaningless. Four tests now pin it, including that the batch handle
is still governed and is not a way around the ceiling.

**A UI bug the browser found.** `clear()` ignored its parameter and always wiped the confirmation
panel, so the offline path wrote "Held on this device" and then erased it: the clinician saw a
cleared form and no statement of what had happened to their order.

**Verified in a browser, not asserted.** A signed order carries a `writtenBy` stamp that only
GovernedStore applies, which is the proof the wiring is real rather than decorative. A cross-chart
write from the live session was refused with WRONG_CHART. A full outage was driven end to end:
signed offline, held durably, still present when a fresh journal was opened over the same IndexedDB
store, reconciled cleanly on reconnect, journal emptied. Zero console errors.

**That last point closes a caveat honestly.** HAZ-DOWN-01 previously said IndexedDBJournalBackend was
"reasoned about rather than proven" because only the in-memory backend was exercised. The restart
case has now been driven through the real IndexedDB adapter in a browser, so the caveat now records
what remains instead: a service worker, so the app itself LOADS without a network, is separate from
data survival and is still not built.

`window.WARDSYNQ` exposes a diagnostics handle carrying the GOVERNED store rather than the raw one,
so a support console cannot become an ungoverned write path.

## 2026-09-04 WardSynQ: the Integration Hub, so GHIS stops being a special case

`wardsynq-interop.js`, 19 tests. GHIS was the only adapter and there was nothing for a second one to
register with, so the pattern existed only in the comments. Now it is a registry, and GHIS is an
instance of it rather than the exception.

**Four rules, each a way interop layers normally go wrong.**

1. **An adapter is never trusted to commit.** Every feed writes as an ADAPTER-kind actor, which the
   existing actor model caps at DRAFT. The ceiling is enforced by the same control that stops an AI
   committing an order rather than by a second, weaker rule written here. A test sends a feed that
   insists on a signed active prescription from another hospital's system: it is refused and
   quarantined, because "the other system said so" is not a clinician's signature.
2. **Nothing is silently dropped.** Unclaimed, ambiguous, rejected, failed and governance-refused
   payloads all land in quarantine with the reason and the original payload. A feed that discards
   what it does not understand produces a chart that is wrong in a way nobody can see.
3. **One broken feed does not stop the others.** A hospital runs many feeds and they fail
   independently, so a throwing adapter is isolated and counted, and a `claims()` that throws is
   treated as not claiming rather than as a crash.
4. **Replay is expected.** Ingest is keyed on the source's own event identity, so a reconnect or a
   catch-up window is a no-op rather than a second copy of a patient's potassium.

Two adapters claiming one message is quarantined as AMBIGUOUS rather than resolved, because guessing
would attach a patient's data to whichever adapter happened to register first. `health()` reports
per-feed counters and a `stalled` flag for a feed that is arriving and never landing, which is what a
hospital with eight feeds actually needs to see.

The hub works with no store at all, so mapping stays exercisable in a harness, the same property the
adapters themselves have.

## Paediatrics: refusing to treat a child as a small adult (2026-09-04)

Two hazards were VERIFIED while carrying the same caveat: the critical-result thresholds and the dose
ceilings are ADULT values, so a paediatric result classified against them would be wrong. That caveat
was honest and unaddressed, and children are exactly where threshold and dosing errors kill.

`wardsynq/wardsynq-paediatrics.js` closes it, and the way it closes it is by REFUSING rather than by
inventing paediatric numbers.

1. **An unbanded reference range means ADULT and must not be applied to a child.** Not applied with a
   warning, not applied because it is probably close enough: refused, and reported as unclassified.
   A potassium of 6.0 is critical in an adult and ordinary in a neonate.
2. **A refused result RAISES a loop rather than falling through as "not critical."** This was the
   dangerous half. The first cut of the refusal made a child's result vanish silently, which is at
   least as dangerous as judging it wrongly. An unassessable result now opens a loop marked
   `raisedBy: "unassessable-result"` so a human sees the number the machine would not judge.
3. **An age in whole years is not a band below toddler.** `ageYears: 0` is true of a two-day-old and
   an eleven-month-old, so it resolves to UNKNOWN rather than NEONATE. Unknown is refused, never
   assumed adult, because assuming adult is the single most likely way this control gets defeated.
4. **A neonate needs gestational age.** A 26-week preterm on day 2 and a term baby on day 27 are both
   neonates and share almost no reference range.
5. **The adult maximum caps weight-based dosing.** A 90 kg adolescent at 15 mg/kg is 1350 mg: the
   arithmetic is right and the answer is dangerous. That is the classic paediatric overdose.
6. **The weight itself is checked for plausibility.** A mistyped weight is invisible once it has
   become arithmetic. Bounds are deliberately generous: this catches a decimal point or a
   pounds/kilograms mix-up, not an unusual child.

The file is mechanism and almost no content, on purpose. Real paediatric limits vary by band, assay,
gestational age and local policy, and getting them wrong is worse than not having them, so the
numbers stay in a pack a paediatrician signs. The HAZ-MED-03 and HAZ-DIAG-01 caveats were rewritten
to record that the content is still absent; the scoring methodology and criteria were NOT changed.

STATUS: IMPLEMENTED and TESTED (21 tests). NOT clinically validated, NOT clinically approved.

## Deterioration: NEWS2, and the reasons a score must refuse (2026-09-04)

Failure to rescue is the largest avoidable category of inpatient death, and nothing in the build
watched a trend. The spec's own HAZ-DEV-01 verification already named this file's job -- the IoMT
artifact filter exists to keep corrupted telemetry out of "automated NEWS2 calculations" -- but there
was no such calculation, so that clause was asserted rather than exercised.

The arithmetic of NEWS2 is public and easy. Everything that decides whether an early warning system
saves anybody is in what it does when the inputs are not what the score assumes:

1. **A missing parameter is not zero.** The single most dangerous way to implement NEWS2. An absent
   respiratory rate scores 0, the total looks reassuring, and respiratory rate is the earliest sign
   of deterioration there is. An incomplete score is INCOMPLETE and has no risk category, however
   low the partial total. The partial total is still shown, so a human can see how sick this is.
2. **A stale observation is not a current one.** A score built from a six-hour-old blood pressure is
   a current-looking number about a patient who has since changed.
3. **Scale 2 is a prescription, not a guess.** Using Scale 1 on a hypercapnic patient escalates
   somebody who is at their own target; using Scale 2 on anyone else hides real hypoxia. It applies
   only where recorded. The counterintuitive half is tested: 98 percent ON OXYGEN scores 3 on
   Scale 2, and the same number on air scores 0.
4. **The total hides the single parameter.** A total of 3 from one parameter at its extreme is a
   different patient from a total of 3 spread across three. Both now drive escalation.
5. **NEWS2 is adult and non-obstetric**, so children and pregnant patients are REFUSED rather than
   approximated. Same rule as the paediatrics module: an unbanded tool means adult.
6. **An unscorable patient is escalated too.** A patient nobody has fully observed is its own reason
   to send somebody, so an incomplete score raises rather than falls silent.
7. **Re-escalation goes strictly ABOVE whoever was already asked.** The first cut counted rungs on a
   ladder, which sent an ignored medium-risk escalation back to the ward doctor who had just ignored
   it. A test caught it.

**A real defect this exposed.** `scoreEligible` was bolted onto the observation object AFTER
construction and was therefore not part of the canonical model, so any device reading that
round-tripped through the store, an adapter or the event bus lost the flag and was then excluded
from every automated score forever, silently. It is now a modelled field with null meaning NOT
ASSESSED, which for a device observation remains ineligible: a reading nothing has vetted has not
passed.

**A new hazard row, HAZ-DET-01, marked LOCAL.** It is not transcribed from the spec's assurance
table, which has no row for failure to rescue. It is declared PARTIAL and stays partial: the score,
the refusals and the escalation state machine work, but there is NO NOTIFICATION CHANNEL. A monitor
that raises a correct escalation into an in-memory Map has not rescued anybody, and the sweep is
caller-driven so nothing re-escalates unless something calls it on a timer. Adding this row LOWERS
the fully-verified fraction from 11/11 to 11/12; it was added because the omission was real, not to
improve a number. The scoring methodology and criteria are unchanged.

The RCP's published 2017 parameter bands are a national standard, which is why this file carries
numbers where the threshold and dose packs deliberately do not. The escalation policy attached to
them is a local decision and is marked unapproved.

STATUS: IMPLEMENTED and TESTED (32 tests). NOT clinically validated, NOT clinically approved.

## Notification: attempted is not delivered (2026-09-04)

Two closed loops depend on telling a human something: a critical result and a deteriorating patient.
Each had its own idea of what "sent" meant, and a hospital does not need two notification systems
with two different definitions of delivery. The weaker definition is the one that quietly loses a
patient.

`wardsynq/wardsynq-notify.js` is now the only place that decides. One rule: a channel that throws,
returns nothing, returns anything other than `delivered: true`, or is not configured at all has NOT
delivered, and the caller is told so. Silent success is the failure mode; every branch exists to make
failure loud. A site that wires no channel gets NO_CHANNEL thrown at it, because an escalation system
that appears to work while shouting into a void is worse than one that is visibly switched off.

**Two real defects this surfaced.**

1. The deterioration monitor awaited a `notify` callback and treated anything that did not throw as
   success, so a well-meaning `async () => {}` stub read as a receipt. It now refuses to raise at all
   without a channel, unless a harness explicitly opts out and accepts undelivered escalations.
2. The critical-result ESCALATION path -- not its primary dispatch, which was always correct --
   awaited its channel and ignored the return value entirely. A channel reporting failure was
   recorded as though the on-call consultant had been told, and a missing channel was skipped in
   silence. This was the more dangerous of the two, because it sat inside a hazard already marked
   VERIFIED. Three tests now hold it.

The escalation ladder also had a bug worth recording: re-escalation counted rungs on a fixed ladder,
which sent an ignored medium-risk escalation back to the ward doctor who had just ignored it.
Re-escalation now goes strictly ABOVE whoever was already asked, and the top rung is terminal so an
ignored emergency keeps asking the resuscitation team rather than falling off the end into silence.

What has NOT changed: no transport is shipped. Every channel is a function a site supplies and this
build supplies none, so HAZ-DET-01 stays PARTIAL. The improvement is that the system no longer
pretends otherwise.

## Emergency bundles: the clock is the control (2026-09-04)

`wardsynq/wardsynq-emergency.js` (29 tests) implements the spec's named Code Sepsis, Code STEMI and
Code Blue state machines. What makes these different from every other workflow in the build is that
the dangerous variable is TIME: a sepsis bundle completed perfectly at four hours is a bundle that
did not work. So the object is a clock with a checklist attached, not a checklist with a timestamp.

**The failure it is built against.** Bundle compliance is measured, reported and rewarded, so it is
gamed, and it is gamed in one specific way: time zero is moved. A patient recognised at 02:10 who
gets antibiotics at 04:30 becomes compliant the moment somebody records recognition at 03:45. The
record then says the hospital did well and the patient still waited two and a half hours.

1. **Time zero is set once**, non-writable and non-configurable. Under module strict mode both a
   plain assignment and a redefinition throw. It cannot be in the future, and it cannot precede the
   evidence that triggered it -- back-dating in either direction is refused.
2. **A wrong origin is corrected by VOIDING with a mandatory reason**, leaving both bundles on the
   record. Deliberately expensive, so a correction can be told apart from a cover-up.
3. **An element completes on its own named event.** Antibiotics count on `administered`, and passing
   `ordered` is refused with "ordering a thing is not doing it". Ordered at 40 minutes and hung at
   three hours is a three-hour bundle.
4. **A breach stays a breach.** Status is recomputed from the immutable origin every time rather
   than stored, and breach outranks completion: every element eventually done with one done late is
   BREACHED, because the patient waited.
5. **Cultures-before-antibiotics is recorded as a deviation, not enforced.** Delaying an antibiotic
   to draw cultures kills people, so the two facts are kept separable rather than one blocking the
   other.

**Screening is not diagnosis.** qSOFA has poor sensitivity and its documented harm is being read as
a rule-out. There is no NEGATIVE result here: a screen that is not met returns NOT_POSITIVE and says
in words that it does not exclude sepsis. An incomplete screen that has not already reached two
criteria cannot be reported as not-positive at all, because the missing criterion might have been the
deciding one. A screen can never open a bundle; that requires a named human.

**The arrest clock carries no dose.** It gives intervals and says what is due. A system that told a
resuscitation team what to give, from an unapproved table, during the two minutes where nobody has
time to check it, would be the most dangerous thing in this repository. A test asserts that no label
contains anything matching a dose.

**HAZ-TIME-01, marked LOCAL and declared PARTIAL** for a specific reason: the timing control is whole
and adversarially tested, but NOTHING TRIGGERS A BUNDLE. A bundle exists only where a clinician
already knew to start one, which is precisely the population that was never going to be missed. The
patient this hazard is about is the one nobody recognised, and for them this control currently does
nothing. Also open: no notification transport, a caller-driven sweep, and no link to the eMAR, so
"antibiotics administered" is asserted by whoever records it rather than derived from an
administration event.

11 of 13 hazards verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Recognition: the interval between a machine noticing and a human deciding (2026-09-04)

HAZ-TIME-01 was declared PARTIAL with a specific reason: the timing of a bundle was trustworthy, but
nothing started one. A bundle existed only where a clinician already knew to open it, which is
exactly the population that was never going to be missed. `wardsynq/wardsynq-recognition.js` (17
tests) is that trigger, and the design decision worth not re-litigating is that **it does not start
bundles.**

A screen is not a diagnosis. qSOFA is specific and insensitive, NEWS2 is sensitive and non-specific,
and a system that opened a Code Sepsis on either would be diagnosing. Instead a positive screen or a
high NEWS2 raises a PROMPT that a named human must answer. Three properties a passive alert does not
have:

1. **The prompt is timestamped and immutable**, so the interval between the machine noticing and a
   human deciding becomes a measurable number. That interval is invisible in most hospitals, which
   is why nobody manages it. `recognitionStats()` deliberately reports the still-unanswered prompts
   too, because a median over only the answered ones is the flattering number and the wrong one.
2. **The prompt pins the bundle's time zero.**
3. **Declining is an answer and is recorded with its reason and its author.** A clinician who looks
   and decides this is not sepsis is doing their job, and that judgement is worth far more on the
   record than a dismissed alert. An unanswered prompt is the dangerous state, and it is the one
   that escalates.

**A real hole this exposed, and it was in the direction that matters.** The emergency module guarded
time zero against being moved EARLIER than its evidence. It did not guard the other direction, and
moving time zero FORWARD is what gaming actually looks like: it turns a two-hour wait into a
compliant one-hour bundle. An accepted prompt now sets `pinsTimeZero`, and time zero must equal the
evidence time exactly. The end-to-end test is the one that found it: a prompt raised at 02:10,
accepted at 03:45, and an attempt to open the bundle claiming recognition at 03:40. It is refused,
and the honest bundle is BREACHED before the first antibiotic is drawn up.

**Alert fatigue is real and is NOT solved here.** A prompt on every transient qSOFA of 2 would be
ignored within a week, and an ignored prompt is worse than none because it launders inaction into a
record of having been told. What this file does is deduplicate: one live prompt per patient per code,
a stronger signal supersedes rather than stacks, and an answered prompt suppresses repeats for a
refractory period. Whether the trigger threshold is clinically right is a decision this file cannot
make and does not pretend to.

HAZ-TIME-01 stays PARTIAL. The trigger reason is closed; what remains is that no notification
transport is shipped, the sweeps are caller-driven, and no bundle element is derived from a real eMAR
administration, so "antibiotics administered" is still asserted by whoever records it.

Also refreshed `vault/modules/WardSynQ.md`, which still said "P0 complete, unwired, 127 tests" and
listed the safety case and interop hub as unbuilt.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Obstetrics: paying off the second refusal (2026-09-04)

NEWS2 refused pregnant patients and pointed at a module that did not exist. Children got a module
when the same debt came up; pregnant women got a dead end. Refusing to score a population and
offering them nothing leaves that population LESS protected than before, not more, because the
refusal also removes whatever crude signal they were getting.

`wardsynq/wardsynq-obstetrics.js` (30 tests) is that module, and the design decisions are all
consequences of one physiological fact: a healthy young pregnant woman COMPENSATES EXTRAORDINARILY
WELL. Blood volume is up around 40 percent, resting pulse is up, blood pressure FALLS in the second
trimester. She can lose 1.5 litres with a pulse of 100 and a normal blood pressure and then
decompensate suddenly and late. A general early warning score here is not merely miscalibrated, it is
looking for a gradual curve this patient does not draw.

1. **MEOWS is trigger-based and returns NO TOTAL.** Not a re-skinned NEWS2. One red trigger, or two
   concurrent yellows, is the alert. A sum would give a low total to a woman with one catastrophic
   parameter and six normal ones, which is exactly the presentation that kills, so there is no
   number anywhere in the result that can be read as reassuring. A missing parameter never suppresses
   a red trigger either.
2. **The compensation warning is attached to EVERY result, including the calm ones**, because the
   reassuring result is the dangerous one.
3. **Pregnancy is a state with a postpartum day, not a boolean.** Most maternal haemorrhage deaths
   are postpartum, so a `pregnant: true` flag that flips to false at delivery would drop the guard at
   the moment risk peaks. The NEWS2 refusal was widened to match, and the test for it is the one that
   would have caught the original bug.
4. **A visual blood-loss estimate is an observation and never a measurement.** Visual estimation
   underestimates by roughly half, worst at the volumes where the decision changes, so a volume
   threshold on an estimate returns UNKNOWN rather than false, and the plausible true figure is shown
   alongside rather than silently substituted. An untrustworthy estimate PROMPTS: waiting for
   certainty is the error.
5. **No dosing at all, and magnesium sulphate deliberately.** The window between anticonvulsant
   effect and respiratory arrest is narrow, and an unapproved regimen in this file would be a direct
   route to a maternal death. A test asserts no bundle element label contains anything matching a
   dose.
6. **The obstetric bundles reuse the emergency module's clock** via its `definition` injection rather
   than growing a second timing implementation, so they inherit the immutable time zero and the
   ordered-is-not-given guard for free.

**An asymmetry fixed rather than declared.** NEWS2 gathered from observations with a freshness window
and the IoMT artefact filter; MEOWS took a plain values object, so a chart could be built over a
six-hour-old blood pressure or a detached lead with nothing to stop it. Rather than write that into a
caveat, the gatherer was extracted to `wardsynq-vitals.js` and both charts now use it. Two charts with
two ideas of what counts as a current observation is the same class of defect as two notification
paths with two definitions of delivery, which was last week's bug.

**HAZ-MAT-01 is VERIFIED, not partial**, and the distinction is deliberate: it claims DETECTION and
MEASUREMENT DISCIPLINE, and delivers both. It does not claim treatment. The trigger cut-offs are
UNAPPROVED and that matters more here than elsewhere, because MEOWS charts differ substantially
between units and a chart with the wrong cut-offs is worse than no chart, since it is trusted. Fetal
monitoring and CTG interpretation are not touched at all and this row must not be read as covering
them.

12 of 14 hazards verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Bundle binding: knowing versus being told (2026-09-04)

HAZ-TIME-01's last named reason was that "antibiotics administered" was asserted by whoever recorded
it. A bundle element completed by a human typing into a form measures whether the form was filled in.
Next door, `wardsynq-meds.js` already runs a state machine where ADMINISTERED is reachable only from
SCANNED, which means a nurse scanned a wristband and a product. That is a fact about the world.
`wardsynq/wardsynq-bundle-binding.js` (16 tests) connects the two.

**The design decision worth arguing about, because the obvious one is wrong.** The obvious move is to
make a derivable element UNCOMPLETABLE by hand: if the eMAR is the source of truth, refuse anything
else. That is dangerous here. During a haemorrhage or an arrest the eMAR may be down, the drug may
come from an emergency box, the scanner may be broken, and a system that refuses to let the team
record what they did is a system the team abandons mid-resuscitation. It would also fail the patient
in the only direction that matters: the drug was given and the record says it was not.

So manual completion stays, and the two are kept APART instead:

- **DERIVED**: the eMAR emitted an administration for this patient and this drug. We know.
- **ATTESTED**: a named human recorded it. We were told, by someone accountable.

Both complete the element; neither is called the other. `provenanceReport()` leads with the ratio,
and the ratio is the finding: a unit whose sepsis bundles are 100 percent compliant and 3 percent
derived is not measuring care, and nobody could see that before. A test constructs exactly that unit.

**A derived completion cannot be back-dated.** It carries the eMAR's own `administeredAt`, never the
time the event was processed and never a time a caller supplies, so the one route by which automation
could have made a bundle look faster is closed. An administration timed BEFORE the bundle's time zero
belongs to an earlier episode and is refused, because crediting a dose given before the patient was
even recognised would be free compliance.

**A defect in the canonical model, found by wiring this.** `MedicationAdministration` recorded only
its `orderId`, so an administration record could not say what drug was given without the order still
existing and being fetchable. That is a poor clinical record on its own terms, quite apart from
making the emitted `meds.administered` event non-self-describing. `drug` and `drugCode` are now
copied onto the record when it is opened.

**HAZ-TIME-01 stays PARTIAL, and the caveat now names the right reasons.** Two of its original
reasons are closed (nothing triggered a bundle; nothing derived an element). What remains: attestation
is still permitted by design, so a bundle can be compliant on claims alone and only the provenance
report will say so; ONLY medication elements can be derived, since lactate, ECG and cultures have no
binding to a laboratory or imaging result, which means most of a sepsis bundle is still attested; and,
unchanged and largest, no notification transport is shipped.

12 of 14 verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## P2 begins: quality measures and incidents (2026-09-04)

### wardsynq-quality.js: the denominator is the attack surface

Quality measures are reported to regulators, published, and used to decide funding and careers, which
makes them the most incentivised numbers in the building. Numerator over denominator is trivial
arithmetic; everything that decides whether the number means anything is elsewhere.

1. **Nobody improves a mortality rate by falsifying deaths.** Deaths are hard to hide. They improve it
   by removing patients from the denominator. So every exclusion carries a reason, is counted BY
   reason, and travels with the rate in the same sentence. A test shows the same hospital with the
   same ten deaths going from 10 percent to 2.2 percent purely by calling eight of them palliative on
   admission, and shows the exclusion rate making it visible.
2. **"We cannot tell" is not "not eligible."** Missing data excluded as though it were a clinical
   decision is how an unmeasured cohort disappears, so the two are separate exclusion kinds.
3. **A small denominator is not a rate.** One death in three is not 33 percent mortality, it is three
   patients. Below the minimum the counts are still reported and the percentage is refused, because a
   percentage on a dashboard gets compared with one from a unit that had four hundred patients and
   nothing on the screen says they are different kinds of number.
4. **compare() exists in order to refuse.** A league table of unadjusted mortality is a picture of
   case mix that will be read as a picture of quality by people who act on it. No risk model is
   implemented, so no ranking is produced, and even a caller ASSERTING risk adjustment gets rows
   without an ordering, because this module cannot verify the claim.
5. **trend() refuses to draw a line across a definition change**, which would show a definition
   changing rather than care changing.
6. **Evidence quality travels with the number** via the bundle-binding provenance, and is deliberately
   NOT folded into the rate: two numbers that mean different things should not be averaged into one
   that means neither.

### wardsynq-incidents.js: the reports you never receive

An incident system's failure mode is silence, not a bad severity matrix. The reports that matter most
go unfiled for reasons entirely rational from the reporter's side.

1. **A near miss is the free lesson** and is reportable in a minimal form. Anonymity is a first-class
   choice, not a degraded one: it costs follow-up with the author and buys the report existing.
2. **Severity is the outcome, not the culpability.** The same syringe swap is a near miss or a death
   depending on luck the clinician did not control. SAC decides how much INVESTIGATION an event
   warrants; a test asserts no response string contains the language of blame.
3. **A person is never a root cause.** "Human error", "the nurse forgot", "non-compliance by staff"
   are refused, and the refusal says what to do instead, because a bare rejection just gets worked
   around. The question those phrases leave unasked is why the system made the error easy, likely, or
   invisible until it reached the patient.
4. **An incident cannot be closed on retraining alone.** Education and reminders are the most-chosen
   and least-effective response in patient safety: they ask the next tired person to be more careful
   in the same place and change nothing about the place. They are detected, not banned, and closure
   requires at least one action that changes the system.
5. **A CAPA with no owner and no date is a wish**, and "done" with no evidence is not done.
6. **The ledger leads with the near-miss ratio**, because that measures the health of the REPORTING
   system rather than the hospital. A unit reporting only harm is reported as a failing reporting
   system, not a safe one. A falling incident count is celebrated everywhere and is usually bad news.

Neither module gets a hazard row: they are governance and measurement, not clinical controls, and
inventing hazard rows for them would inflate the table with things that do not stop a patient being
harmed. The safety case stays at 12 of 14 with 2 partial.

595 tests across 23 suites. STATUS: IMPLEMENTED and TESTED. NOT clinically validated or approved.

## P2 continued: consent and research de-identification (2026-09-04)

### wardsynq-consent.js: a signature is not consent

Consent is a decision made by someone who understood the proposal, was told what could go wrong, knew
the alternatives including doing nothing, and was free to refuse. The signature is evidence a
conversation happened. This module makes it impossible to record the signature without the
conversation: consent is refused outright if the risks, the alternatives or the option of NO
treatment were not recorded. That last one is the most commonly omitted and is always available.

The asymmetry running through the file is that capacity is presumed and incapacity must be
demonstrated, because the failure modes are not symmetrical. Treating a capable adult as incapable
strips a right they have, and it happens overwhelmingly to the old, the disabled, the mentally ill,
and anyone who disagrees with their doctor.

1. **A refusal is never evidence of incapacity.** Disagreeing with the recommended treatment is the
   commonest trigger for a capacity assessment, and an unwise decision is a right capable people
   have. The two are recorded separately and neither is inferred from the other.
2. **A blanket "lacks capacity" flag is refused.** Capacity is decision-specific and time-specific: a
   person may lack it for cardiac surgery and retain it for a blood test. An assessment names its
   decision or it is not an assessment, it is a label that follows someone for years after the
   delirium resolved.
3. **A finding of incapacity cannot stand on a checkbox.** All four functional abilities must be
   answered and a reason is mandatory. An assessment with no decision-making support recorded is
   flagged as incomplete, since capacity is assessed AFTER support has been offered.
4. **A proxy decides for the patient, not for themselves**, and a valid advance directive OUTRANKS a
   relative who disagrees with it.
5. **Emergency treatment is never recorded as consent.** Passing NECESSITY as a consent basis is
   refused with a pointer to the right function, which records it as what it is and requires both why
   they could not consent and why it could not wait.
6. **Consent does not generalise, goes stale, and is withdrawable at any moment** including after the
   patient is on the table. Withdrawal deliberately requires no reason: requiring one would make it
   something to justify rather than a right exercised.

This module does not assess capacity, and says so in its own output. Any function claiming to would
be used to overrule people, which is why there is not one.

### wardsynq-research.js: the record that looks anonymous

The hazard is not failing, it is succeeding visibly and failing invisibly. The name is gone, the
record looks anonymous, and the person is still findable from date of birth, district and a rare
diagnosis. The output LOOKS safe, which is exactly why it gets shared.

1. **Safe Harbor is a floor, not a proof**, and nothing this module returns uses the word anonymous.
   The disclaimer travels with every release.
2. **k-anonymity catches what Safe Harbor passes**, and rows that fail it are WITHHELD rather than
   released with a warning, because a warning does not travel with the row once somebody opens the
   file in a spreadsheet.
3. **A rare diagnosis is an identifier.** There may be one patient in the state with it.
4. **Date shifting is per-patient and consistent.** Intervals within a patient survive, which is the
   research value; a single dataset-wide offset would let anyone who knows one real date recover
   every other.
5. **Free text is removed, never scrubbed.** A regex over a discharge summary produces text that
   looks clean and still names the daughter and the referring doctor.
6. **An unrecognised field is dropped, not assumed safe.** A failing test caught the corollary: a
   timestamp nobody listed in dateFields is an unknown field, so forgetting to declare it drops the
   date rather than releasing the real one.

One deliberate cost is now pinned by a test: the direct-identifier match is over-broad, so drugName
and testName are stripped as identifiers. Over-removal is recoverable because it is reported;
under-removal is not, because nobody looks.

Neither module gets a hazard row. They are governance, not clinical controls. Safety case holds at
12 of 14 with 2 partial. 639 tests across 25 suites.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT legal advice, NOT certified against
HIPAA, the DPDP Act or any other regime.

## P2 complete: lineage, API governance, billing, population health (2026-09-04)

### wardsynq-lineage.js

The spec asks that a clinician can click any derived value and see the raw observations behind it.
Two properties carry the file. **Staleness propagates**: a NEWS2 calculated one minute ago on a
four-hour-old blood pressure is a four-hour-old assessment, and a display showing only the calculation
time lies by omission. **A rejected input is part of the lineage**: a score built from five values
after discarding a stale sixth is not the same fact as a score built from five, and the discarded one
is the first thing an investigation asks about. A missing input makes provenance INCOMPLETE rather
than partial-but-quiet. `impactOf()` answers the question asked after a mislabelled sample: not what
fed this, but what did this feed, and who acted on it.

### wardsynq-api-gov.js

This is where data leaves the building, so every control upstream is undone by one endpoint that
answers wrongly. **Scope is not access**: a valid, unexpired, correctly scoped token is still refused
for a patient the requester has no relationship with, and a gateway constructed with no relationship
check refuses every patient request rather than defaulting to allow. An unparseable scope invalidates
the SET rather than being dropped, since dropping it means proceeding on the rest, which fails open on
a malformed token. Expired means expired, with no grace window, because a grace window is a window.
Bulk is separated from single-patient: one chart is a clinical act and ten thousand is an export.
Webhooks carry an id and a type and never clinical content, because a webhook posts to a URL somebody
typed and no transport security helps once the payload is at the wrong address. `suspiciousClients()`
distinguishes a client walking a patient id space from one that is merely misconfigured.

### wardsynq-billing.js

A billing module inside an EMR is a safety module, and not for the obvious reason. The danger is not a
wrong bill; it is money starting to decide what the chart says. A record bent for a claim lies to
whoever reads it next, and that patient may be unconscious at the time. So:

**The clinical record is the source. Billing reads it and never writes to it.**

- a code with nothing behind it is REFUSED, not queried, because a queried code sits in a work list
  until somebody makes it go away and the cheapest way is to add the diagnosis
- an inferred code is surfaced as a question for a clinician, with the note "do NOT add it to support
  the claim"
- coding that CHANGES after a payer denial is flagged permanently and not blocked, because a genuine
  correction happens too; what matters is that "we found more documentation" can never be invisible
- `mayProceedClinically()` always returns true and takes no arguments. It exists so no caller invents
  its own answer, and so that removing the boundary means deliberately deleting a function whose
  comment says what it is for
- a refused pre-authorisation is recorded as a FUNDING decision that does not mean the treatment is
  not indicated

### wardsynq-population.js

Every other module reacts to a patient in front of somebody. This one is about the person whose HbA1c
was last checked nineteen months ago and about whom no alert will ever fire, because nothing is
happening to them. A care gap is an absence, so it is computed on a sweep rather than detected.

The suppression rules are the point. An outreach list is a list of people and contacting them costs
them something: a recall letter to a family who has just had a death is a cruelty the system caused.
Suppression is applied BEFORE the list exists rather than as a filter over one somebody could export
first, every applicable reason is returned rather than the first (one at a time invites clearing them
and re-running), and a decline PERSISTS, because re-detecting it monthly teaches people to ignore the
one letter that mattered. The list is ordered by clinical risk, never by how overdue anything is: the
largest overdue number and the sickest patient are rarely the same person.

None of these four gets a hazard row. They are governance, measurement and administration, not
clinical controls, and inventing rows would inflate the table with things that do not stop a patient
being harmed. Safety case holds at 12 of 14 with 2 partial.

P2 is now complete: quality, incidents, consent, research, lineage, api-gov, billing, population.
708 tests across 29 suites.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT approved, NOT certified for any payer
or regulatory regime.

## P3: AI security and MLOps, and a real hole in a VERIFIED hazard (2026-09-04)

### The defect, first, because it matters most

Building `wardsynq-secops.js` required a test that assumed prompt injection SUCCEEDS and checked that
the model still could not commit an order. The test failed, and not for the reason expected.

`can()` read `actor.tier` directly. The AI ceiling was applied in `makeActor()`, so any actor object
that reached the authorisation check without passing through the factory held whatever tier it
claimed. `{kind: "ai", tier: "execute"}` was EXECUTE. That is not an exotic path: an actor gets
hand-built in a harness, deserialised from storage, or rebuilt across a process boundary as a matter
of course. **A ceiling enforced only at construction assumes every path went through the door.**

This sat inside HAZ-AI-01, a row already marked VERIFIED, whose entire argument is that an AI cannot
commit. The ceiling is now re-applied inside `can()` itself, `effectiveTier()` is exported so a UI
shows the truth rather than the claim, and five regression tests hold it, including a deserialised
actor and every non-human kind.

The row stays VERIFIED, and the caveat now records the defect. Finding a hole in a verified control
is the safety case working; hiding it afterwards would be the failure.

### wardsynq-secops.js

An LLM reading a chart cannot distinguish "the patient reports chest pain" from the same sentence
followed by an injected instruction, because both are text in the same field and the model was
trained to be helpful about both. So the defence cannot be the model's judgement: asking a model to
notice it is being manipulated is asking the compromised component to detect its own compromise.

- retrieved content is fenced with a PER-REQUEST nonce and labelled untrusted, so a note written last
  week cannot close this request's fence
- an unsigned document does not enter the context, because the attack is not a clever prompt, it is
  somebody writing a note into a chart and waiting for the summariser to read it
- a document that TRIPS the injection tripwire is still included, deliberately. Dropping it would
  make the tripwire the defence, and an attacker who reads the list simply would not trip it. The
  signals are evidence, not a filter, and the module says so.
- outputs naming another patient are withheld WHOLE, never redacted: a partially redacted leak is
  still a leak and looks safe
- the "signing" is a content DIGEST, named `digest` throughout and documented as not cryptographic,
  so nobody imports it believing otherwise

The module explicitly does not claim to prevent prompt injection. The design assumption is that
injection succeeds and the blast radius is bounded by the actor ceiling, which the model does not
control. That is why the ceiling defect above was the important find.

### wardsynq-mlops.js

Clinical AI does not fail loudly, it degrades, while the dashboard still shows the accuracy from the
validation set that has not changed.

- retrospective performance is accepted and immediately labelled as insufficient: it shows a model
  can fit the data it was built from
- shadow means the output reaches NOBODY. A visible shadow prediction is refused, because its
  evaluation would measure the behaviour it caused rather than the model.
- drift is checked on INPUTS, because outcome labels arrive weeks late and the input distribution
  shifts the same day
- a subgroup gap blocks deployment however good the aggregate: a 92 percent model with a 61 percent
  minority subgroup is not a 92 percent model, it is one that fails the people already worst served
- unlabelled predictions are not evidence, and are disproportionately the recent, sicker cases
- a breach WITHDRAWS the model automatically rather than raising a ticket, because a ticket leaves it
  running until somebody triages it and the meeting is next week
- a withdrawn model goes back through shadow, never straight to deployment, because the evidence that
  supported it was gathered on a population since shown to have changed

Neither module gets its own hazard row; both are evidence under HAZ-AI-01, which is where the AI
hazard already lives. 754 tests across 31 suites, safety case at 12 of 14 with 2 partial.

STATUS: IMPLEMENTED and TESTED. Not a security certification, and explicitly not a claim that prompt
injection is prevented.

## P3: simulation and chaos (2026-09-04)

Every test written before this one asks a module a question it was designed to be asked, which
catches the bugs somebody thought of. `wardsynq-simulation.js` (14 tests) generates load and disorder
instead, and asserts INVARIANTS rather than outcomes.

The distinction is the whole design. An expected-output assertion tells you the simulation ran as
written; an invariant tells you the system did not hurt anybody. The six are: no dose administered
without a scan, no record on the wrong chart, nothing silently dropped (every event applied or
quarantined with a reason), no duplicate applied twice, no critical loop closed without
acknowledgement, no clinical event applied with a future time.

1. **Seeded and deterministic.** A chaos test that cannot be replayed is a bug report saying "it
   failed once". Every report carries the exact call that reproduces it.
2. **The faults are Tuesday, not exotica**: the same event from two feeds eleven seconds apart, an
   arrival 15 minutes out of order, a day of clock skew, a truncated payload, a feed that stops
   mid-stream, a patient merged mid-episode, and a record carrying one patient's id with another's
   identifiers.
3. **The invariants are proven able to FAIL.** One test constructs a world that harmed somebody and
   asserts all six fire. An invariant that has never failed is decoration, not evidence.
4. **A naive handler is actually caught.** A second scenario runs a handler that applies everything
   and trusts the stated patient, and the run fails on cross-patient data. If chaos does not catch
   the obvious wrong implementation, it would not have caught a subtle one.
5. **A passing run says what it does not mean.** The report's own text states that it is evidence
   about one class of failure under one seed, is NOT evidence of safety, does not generalise, and
   must not be quoted without that sentence. That qualifier is attached to the PASS, which is where
   it is needed.

**The honest limitation, stated in the module header and asserted by a test.** This is
single-threaded and interleaves deterministically. That finds ordering assumptions and it does not
find data races. The spec's 10,000-patient figure is treated as a DATA VOLUME claim, not a
concurrency claim, and pretending otherwise would have been the dishonest part of the file.

Two test-side defects found and fixed while writing it, both mine rather than the system's: the event
bus dedupe option is `id`, not `idempotencyKey`, and my test had been silently passing an unknown
field so the storm test was not testing dedupe at all.

768 tests across 32 suites. Safety case at 12 of 14 with 2 partial.

STATUS: IMPLEMENTED and TESTED.

## End-to-end clinical scenarios, and the defect only they could find (2026-09-04)

Thirty-two unit suites each proved one module correct in isolation, which is exactly the shape of
testing that misses integration defects: every module is tested against the interface its own author
imagined. `test/wardsynq-scenarios.test.mjs` runs one patient through the whole stack with the
assertions placed at the SEAMS.

Scenario 1 is the complete journey: observations at 02:10, NEWS2 scores HIGH, a recognition prompt is
raised and nobody answers it, it escalates on its own, a clinician accepts at 03:45 with the delay
recorded as 95 minutes, the bundle refuses to start at a flattering time in either direction, the
antibiotic element is completed by an actual bedside scan through the real eMAR state machine, a
NORMAL lactate still completes its element, and the provenance summary reports two derived elements
and one attested. Every one of those handoffs is a place two modules could have disagreed.

The other scenarios pin seams that would be invisible in isolation:

- a postpartum woman is refused by NEWS2 AND accepted by MEOWS. Both refusing would leave her with
  nothing watching her, and neither suite could see that on its own.
- a child is refused by NEWS2 and by qSOFA, and neither refusal is allowed to read as reassurance
- an unscorable patient escalates for being unobserved and is NOT also raised as suspected sepsis,
  because double-counting one patient as two alerts trains people to ignore both
- a forged AI actor can draft and cannot commit, on this patient's live chart
- the number on the screen explains itself, including what it refused to use

**The defect.** The lineage scenario asserted a stale blood pressure would be rejected and it was
not, because `gatherVitals` guarded staleness and had no guard on FUTURE-dated observations. A
future reading is worse than a stale one: it WINS. "Latest reading" logic ranks it above the correct
current value, so the score is computed from a number describing a moment that has not happened. It
arises from ordinary causes, a device with a skewed clock or a feed with a timezone bug.

The sharpest part is that `wardsynq-simulation.js` already asserts `no-future-clinical-time` as an
invariant, and the gatherer sitting under two clinical charts was not enforcing it. A property named
in one module and unenforced in another is precisely what unit tests do not catch, because each file
is consistent with itself.

Fixed in `wardsynq-vitals.js`, which both NEWS2 and MEOWS go through, with three regression tests
including the boundary case that an observation timestamped exactly now is current rather than
future.

778 tests across 33 suites. Safety case at 12 of 14 with 2 partial.

## The bedside surface (2026-09-04)

`wardsynq/ui/opd.html`, `opd.css` and `opd-emr.js` are the mobile and tablet surface the spec asks
for. Three decisions worth not re-litigating:

**It is the same design system, not a second one.** `opd.css` imports `wardsynq.css` for its tokens
and adds only what a bedside needs that a desk does not. A separate visual language for mobile means
a nurse learning two products, and the one they use at 3am under pressure would be the one they know
less well.

**What changes at a bedside is safety, not style.** Targets are 56px rather than the 44px guideline,
because that guideline assumes a considered tap on a clean screen and this is a gloved thumb in a
corridor while somebody is talking. Nothing moves on its own: no toasts that leave, no reflow as data
arrives, and the scan-state line has its height reserved, because a screen that changes while a thumb
is descending is how the wrong button gets pressed, and here the wrong button administers something.
The workstation's signal column becomes a left edge mark with the same colours and the same rule that
colour is never the only carrier. An irreversible action gets more SPACE around it rather than being
made smaller or hidden behind a confirm.

**The logic holds no clinical rules at all.** `opd-emr.js` sequences the eMAR, the safety engine and
the governed store and renders what they return. There is no threshold, no dose limit and no
interaction rule in it, and there must never be: a rule duplicated in a view drifts from the engine
and the drift is invisible.

The properties the tests hold:

- opening a chart does NOT confirm identity, because opening a chart is something you can do from the
  corridor. Identity is the band on the patient in front of you.
- switching patient REVOKES the confirmation, since the commonest bedside error is the screen still
  showing the last patient
- the ACTION refuses without identity, not just the button. A caller bypassing the UI entirely still
  cannot administer, and the governed store would refuse it again underneath.
- a five-rights failure is rendered IN FULL. Truncating a refusal to fit a phone is how "blocked"
  becomes "the app is broken" and then becomes a workaround.
- a refusal must be acknowledged explicitly, because one that fades was never read
- offline work is durable BEFORE the screen says it was recorded
- a GOVERNANCE refusal is not journalled as though it were a connectivity problem, which would retry
  a write the system has already decided is not allowed

Two smaller things the tests pin: a signalled row cannot be constructed without a word, so no view
can render colour alone; and a value of 0 renders as "0" rather than vanishing, because 0 mL/h urine
output is the important one.

**It is deliberately not reachable.** No route, not in the www/ build, and `opd.html` carries no
script tag: the logic is tested and the renderer is not written, and wiring a half-built view to a
live medication path would be worse than leaving it unwired. That is stated in the file rather than
left for somebody to discover.

794 tests across 34 suites. Safety case at 12 of 14 with 2 partial.

## The ICU flowsheet: the running total that is quietly wrong (2026-09-04)

`wardsynq/wardsynq-flowsheet.js` (35 tests). The flowsheet is the densest document in a hospital, and
the danger is not in its cells: ICU prescribing is done off its running TOTALS, and a total looks
equally authoritative whether or not the hours underneath it are complete.

1. **A missing hour is not zero.** The same defect as a missing NEWS2 parameter, and worse here
   because it compounds. If nobody charted output between 03:00 and 06:00, a balance that sums what
   it has is wrong by exactly the amount nobody knows, and that is the number a consultant reads at
   08:00 before prescribing diuresis. Every balance names the missing hours and states that the true
   figure differs by whatever was not charted. An hour with intake charted and output blank is NOT a
   complete hour, which is the commonest shape of the gap.
   The numbers are still returned, deliberately: suppressing them pushes a nurse to add it up on
   paper, which is worse. What is refused is calling it a balance.
2. **The hour is a bucket, not a timestamp.** `observedAt` and `chartedAt` are both mandatory, and
   BACKFILLED is computed from the lag rather than declared by the caller, so it cannot be omitted
   by someone in a hurry. An entry written six hours late that looks identical to one written on
   time is a clinical and a medico-legal problem. The grid surfaces backfilling at the TOP, because
   the pattern is the signal: one late row is a busy hour, a whole shift of them is a shift where
   nobody was charting.
3. **An infusion volume is an integral, not a multiplication.** Current rate times elapsed time is
   the obvious implementation, is wrong for every patient whose rate was ever changed, and
   under-reports a weaned vasopressor. A test pins the exact wrong answer it would have given.
4. **The weight is the input everybody forgets is an input.** A weight-based rate refuses without
   one, flags an implausible one through the paediatrics sanity check, and carries its workings, so
   a cell can be traced to the three numbers behind it, one of which somebody typed.
5. **SET and MEASURED are different kinds, not a flag.** A set PEEP of 8 against a measured 12 means
   the patient is doing something, and a chart holding one number per row cannot show it.
6. **An empty cell stays empty and is counted.** Rendering a blank as a zero is the display half of
   the missing-hour problem: it looks complete.

**A trap removed rather than documented.** `recomputeAfterCorrection()` first took the entry set
before and after the correction, and a test caught that as a trap: `correct()` marks the original
superseded IN PLACE, so a caller holding one array across the call holds the same mutated objects and
both totals come out identical. It now takes the correction itself and derives the before-state, so
it cannot be got wrong.

**HAZ-FLUID-01, marked LOCAL and declared PARTIAL** for one specific reason. A correction now reports
exactly which totals changed and flags the case that is not merely arithmetic: a balance crossing a
line somebody prescribes against is stated as "read negative and now reads positive", not as "360 mL
smaller". What stays open is the half that matters most. The consultant who prescribed at 06:00 off
the wrong figure is still not notified when it is fixed at 08:00, because nothing in this build
records that a total was READ. That needs a view log, which does not exist, and the function says so
in its own output rather than letting its absence imply otherwise.

Also unbuilt and stated: nothing gates prescribing on an incomplete balance, deliberately, since a
system that blocked a consultant from reading a partial total would be worked around on paper. That
means the honesty is advisory.

Safety case now 12 of 15 verified, 3 partial. The row was added because the omission was real and it
lowered the fraction, as the other two local rows did.

829 tests across 35 suites. STATUS: IMPLEMENTED and TESTED. NOT clinically validated or approved.

## The WardSynQ mark, and three palette defects it found (2026-09-04)

The owner supplied the logo. Wiring it in was meant to be chrome work and turned into a palette audit,
because measuring the brand against the existing tokens required measuring the existing tokens.

### The asset

Sampled brand navy is **#1c3048**. The supplied master was 669x373 with the artwork occupying
522x122, so 94 percent of what every viewer would download was transparent padding, and background
removal had left a fringe of near-navies (1c3048, 1b2f47, 1c3049, 1d3149 all appear in it).

Assets are trimmed, then repainted to one exact navy with alpha as the shape. That removes the
fringe, makes the mark crisp at small sizes, lets the files compress as flat shapes rather than as
photographs (57 to 62 percent smaller), and, most usefully, makes them RECOLOURABLE, which is what
lets dark mode use the same file rather than a second one that can drift.

`wardsynq-lockup.png`, `wardsynq-mark.png`, icons at 512/192/180/32, and a webmanifest. 108 KB total.
An SVG master should still come from whoever drew it: these are raster derivatives of a raster file,
and no attempt was made to trace the artwork, because a redrawn logo that is subtly wrong is worse
than a PNG.

### Three defects, all found by measuring rather than by looking

1. **`--ink-3` was below AA in BOTH palettes.** 3.98:1 on white, 3.90:1 on the dark raised surface.
   The metadata grey is still text somebody has to read. Darkened to #5f6965 and #828d89, hue kept.
2. **`--brand` had no dark-mode value at all.** The dark block redefines every other token, so the
   light navy would have inherited into it and sat on #1a211f at under 1.5:1. That is a mark nobody
   can SEE rather than a mark that looks wrong, so nobody would have reported it. Dark mode now gets
   a lifted navy, and the asset's flat-colour-plus-mask construction is what makes recolouring it
   possible.
3. **The dark stop and major signals were 32 degrees of hue and 1.21:1 of lightness apart**, which is
   closer than the light pair. Nudged the dark amber to #dcb45a: 35 degrees and 1.41:1, still 8.37:1
   on the darkest surface. The threshold was NOT loosened to make the test pass.

### Two brand rules, derived from measurement and enforced by a test

- **`--brand` is not a text colour on a light surface.** Against `--ink` it is 1.37:1, so navy words
  beside near-black words do not read as a deliberate accent, they read as two inks that do not
  match. The mark carries the brand; the words carry `--ink`.
- **Nothing signalled ever sits on a `--brand` fill.** Every signal lands between 1.63:1 and 2.15:1
  against navy, so a smart-looking navy header bar with a status chip in it would fail all four at
  once, and would fail them while looking considered.

### test/wardsynq-brand.test.mjs

The palette is now parsed out of the real stylesheet and the ratios are COMPUTED, per palette. This
project has already shipped two contrast defects, a drug name at 1.2:1 and a disabled button at
1.85:1, and both were found by staring at a screenshot. A comment in CSS claiming a colour is AAA is
a claim; this is a measurement that fails when somebody nudges a hex.

Two of its own tests were wrong first and both are recorded in the file rather than quietly fixed:
the parser took the last definition of each token and was therefore measuring the dark palette while
believing it was measuring the light one (which is how defect 2 surfaced, underneath the nonsense),
and the distinguishability test compared signals by contrast ratio, which is the wrong measure for
telling two colours apart. It now requires hue OR lightness separation, because red and amber are
adjacent hues in every clinical palette ever drawn and are told apart by lightness, while slate and
green are the mirror case.

### Placement

The mark is chrome. It sits above the clinical content and never inside it, it is `aria-hidden`
because a screen reader announcing "WardSynQ logo" before every ward round is noise, it is the first
thing hidden on a short viewport, and on the bedside header it disappears entirely when identity is
unconfirmed, because that warning needs the width. It is kept for print, where a chart that does not
say which system produced it is a page somebody has to identify by hand.

843 tests across 36 suites. Safety case unchanged at 12 of 15.

## A to Z: the five things that were left (2026-09-04)

Five items, each of which was a named gap in the safety case rather than a new feature.

### 1. wardsynq-transport.js — actually telling somebody

Three hazards had been PARTIAL for one reason: escalations computed correctly and delivered to
nobody. The distinction this file exists for is that SENT, DELIVERED and SEEN are three different
things and most systems have one. A webhook returning 200 means a server accepted bytes; calling
that delivery is how a hospital comes to believe in an escalation path nobody has ever been paged
by. Only a NAMED HUMAN acknowledging moves a notice to SEEN, and `outstanding()` deliberately
includes the delivered ones, because a dashboard counting only failures shows zero while the pager
lies face down on a desk.

The outbox is written BEFORE any transport is attempted, so a crash mid-send leaves "we decided and
do not know whether it went", which is recoverable; the reverse order leaves nothing. The ladder
stops at the first CONFIRMED delivery, not the first non-throw, because paging four people for one
patient is how a ward learns to ignore the fifth. A channel that has never carried a message is
UNVERIFIED rather than assumed healthy, and `verify()` is how a site proves one works without
waiting for a real patient: an integration that broke three weeks ago looks exactly like one that
works.

`SweepDriver` closes a separate defect nobody had named: every monitor in this build had a correct
`sweep()` that nothing ever called on a timer, which is a re-escalation ladder that never
re-escalates.

### 2. wardsynq-pews.js — the third refusal, paid off

NEWS2 refused every patient under 16 and named PEWS, which did not exist. A refusal pointing at
nothing leaves that population LESS protected, because it removes the crude signal too. The first
test is the whole argument: a pulse of 150 is unremarkable at four months and peri-arrest at
fourteen, so one set of bands cannot serve both.

Neonates are refused, because a neonatal chart is a different instrument and that population is
where a wrong score does most harm. A FALLING respiratory rate scores harder than a rising one,
since a tiring child's rate falls as they decompensate and rate alone inverts at the worst possible
moment. Parental concern is a scored parameter that can escalate a child whose numbers are all
normal, which is what happened in most of the cases that generated the literature.

### 3. wardsynq-readlog.js — telling the person who prescribed on the wrong number

Every correction path could say WHAT changed; none could say who acted on the old value, because
nothing recorded that anybody read it. The output is a list of PEOPLE, not a count of totals:
"three totals changed" is not actionable and "Dr Shah read the 06:00 balance at 06:12 and it was
wrong by 360 mL" is. Only readers of the superseded version, only from before the correction, and
the person who ACTED on it is named first.

A value merely rendered on a page is not a read. The log is retention-bounded and states its purpose
on every entry, because a record of who looked at what is also a surveillance tool, and used as one
it will stop people opening things.

### 4. HMAC-SHA256 in wardsynq-secops.js

The old function was a 64-bit FNV-ish hash documented as NOT cryptographic. The note was honest and
keeping the function was still wrong: a field called "integrity" gets relied on regardless of the
comment beside it. With no implementation wired it now REFUSES to hash rather than falling back,
because a silent downgrade is worse than a loud failure. A document carrying the previous build's
digest is refused as LEGACY, since honouring it is how a deprecated primitive outlives the decision
to deprecate it. It is a MAC and not a signature and the naming keeps that: it cannot say WHICH key
holder, so it does not attribute authorship.

### 5. Reachability: renderer, offline shell, build

`opd-render.js` draws the surface `opd-emr.js` had been waiting for, holds no clinical rule, and is
a pure function of `session.state()` so the screen cannot keep showing a confirmation the system
revoked. It also populates the read log on OPEN, which is what made item 3 real rather than proven
and unpopulated.

`wardsynq-sw.js`'s one important rule: a stale APP is fine and stale CLINICAL DATA is not. The shell
is cache-first; anything clinical is network-first and returns a 503 saying so rather than a cached
body, because a cached potassium rendered without its age is the exact hazard every gatherer in this
build refuses at the other end of the pipe.

`build-www.sh` ships wardsynq/ whole, and both the script and the markup state that shipping the
files does not make it reachable: nothing links to it, no flag turns it on, and the page does not
boot itself, because a page that constructed its own actor would be a page deciding who may give a
drug.

### Where that leaves it

921 tests across 41 suites, 39 modules. Safety case 13 of 16 verified, 3 partial, and all three
partials now name SMALLER reasons than before:

- HAZ-DET-01 and HAZ-TIME-01: the transport seam, outbox, ladder and driver exist; no real pager,
  SMS or phone system is integrated, and every shipped adapter reaches only somebody already looking
  at a screen.
- HAZ-FLUID-01: the correction-to-reader chain is proven end to end and populated only where a
  bedside row is opened, because the FLOWSHEET still has no renderer.

None of that is dishonest bookkeeping: each partial is a control that works and cannot yet reach far
enough, which is a different thing from a control that does not exist.

## The GHIS cut-over, and the last renderer (2026-09-05)

### The cut-over, approved by the owner

GHIS is now a real adapter on the live path, feeding the canonical model and the event bus. The
design decision worth not re-litigating is what it does NOT do: it does not rewrite
`ingestFromWard`. That function guards cross-patient contamination, preserves manual overrides
against ward values, and writes a STATE object read at more than twenty sites in icu.js alone.
Replacing it in one step would put a live mobile app behind a code path that has never rendered a
ward round, in exchange for tidiness.

So it is a strangler fig: the legacy path keeps owning STATE and every screen that reads it, and
the adapter takes ownership of the canonical model alongside it. Two consumers of one bundle, the
new one authoritative for everything built after it. The duplication is real and is the price of
not breaking a working ward round.

The properties, in the order they matter to a clinician holding the phone: the legacy result is
computed FIRST and returned untouched, so enabling the flag cannot change what the app displays;
the adapter path can never throw into the caller, and an exploding adapter, a full disk, a
rejecting async write and a downed bus are each a number on a report rather than a broken round;
there is a kill switch that works in-process with no reload; it is idempotent on the source's own
event identity; and it writes as an ADAPTER actor, so it is capped at DRAFT by the existing actor
model rather than by anything re-implemented here.

**What "approved" means.** The owner approved an ARCHITECTURAL cut-over, which is theirs to give.
It is not clinical approval. Every rule pack remains UNAPPROVED seed content awaiting pharmacy and
the relevant committees, a test asserts the cut-over's own report says so, and the flag still
defaults OFF.

### The flowsheet renderer

The last named reason HAZ-FLUID-01 was partial. The renderer holds no arithmetic and decides only
how honesty is displayed, which turned out to be most of the work: an empty cell renders blank
rather than as a zero or a dash, because at a glance those are the same mark; a half-charted row
states "3 of 6" beside itself so it cannot look complete; a backfilled entry is marked rather than
rendered identically, which would launder the difference; and the incompleteness of a total sits in
the same sentence as the number, because a qualifier in a tooltip is one nobody reads at 08:00.

Opening a balance records a read. HAZ-FLUID-01 moves to VERIFIED: every clause of its stated
requirement is met and adversarially tested, so the adequacy cap comes off. The deliberate
non-gating stays in the caveat.

### A race, found and closed

The full suite failed once and could not be reproduced in thirteen further runs. Rather than
shrugging, the cause was located: the ghis-live tests used `setTimeout(0)` to let promise chains
settle, which does not guarantee that a `.then()` on an already-rejected promise has run. Now
`setImmediate`, which fires after the microtask queue drains. A racy assertion in a clinical safety
suite is worse than a failing one, because it gets re-run until it passes.

956 tests across 44 suites. Safety case 14 of 16 verified, 2 partial, both waiting on a real pager.

## 2026-09-05 — Shadow mode watched a door no ward sync walks through

The observer was wired to `ICU.ingestFromWard`, and `wardsynq-shadow-boot.js` claimed on that basis
to observe the real GHIS sync. It did not. `ghis-ward.js:685` reads

    var res = (ICU.ingestWardHistory ? ICU.ingestWardHistory(...) : ICU.ingestFromWard(...));

`ingestWardHistory` exists on every current build and is a separate function that does not call
`ingestFromWard`, so the fallback branch is dead on a current device. Shadow mode ran through a real
ward sync on a real iPhone and reported `bundlesSeen: 0`.

Two decisions follow.

**The observer covers every door, not the one it was written against.** `installShadow` now takes a
`method`, and the boot installs on both `ingestWardHistory` and `ingestFromWard`. The caller picks
which entry point it uses; an observer that assumes one has assumed the caller's implementation.
`SMD_WARDSYNQ_SHADOW` became a combined view with a `byMethod` breakdown, because `installShadow`
assigns that global unconditionally and a second install would otherwise have hidden the first —
the same class of silent-masking bug.

**`clean` now requires `observed`.** The old report returned `clean: true` for an observer that had
never been handed a bundle: no errors and no disagreements, because nothing had happened. That is
how a mis-wired observer passes for a working one. Absence of findings is not a finding of absence,
and a readiness signal that fires when nothing ran is worse than no signal.

Worth recording about how it was found: this was invisible to the unit tests, which called
`ingestFromWard` directly and so tested the observer against itself rather than against the caller.
It took putting it on a ward with real traffic. It is the first thing shadow mode found, and what it
found was shadow mode.

## 2026-09-05 — One orchestrator over the existing transport, and what it deliberately did not do

Nine PRs (#835, #836, #838-#843, #845). The through-line is that almost none of it was new
machinery: the transport, the event bus, the push infrastructure and the three clinical monitors all
existed, and what was missing was the connections between them and honesty about what a connection
proves.

**One state machine, not a second notification system.** `wardsynq-orchestrator.js` owns no outbox,
no ladder, no channel and no delivery vocabulary. Duplicating those would have produced two systems
with two ideas of what "delivered" means, which is the exact failure `wardsynq-notify.js` was written
to end. What it adds is ONE identity for a clinical alert across every channel, and one place that
decides the alert has been answered.

**The transport bends to the clinical modules, not the other way round.**
`wardsynq-deterioration.js`, `wardsynq-recognition.js` and `wardsynq-emergency.js` each had their own
payload shape before the orchestrator existed. All three are byte-identical after this work, verified
by `git diff`. The adapter reads three shapes explicitly, one branch each, because a generic
extractor would silently mis-address the day a fourth appears. Reshaping three tested clinical
modules to suit one transport would have been the wrong direction of dependency.

**A re-escalation is not a repeat.** The escalation's tier became the notice sequence. Keying only on
the alert would have made the registrar's page silently return the ward nurse's ignored notice, and
answering any one notice answers the alert so the consultant is not woken for something already
taken. The same reasoning gave a bundle element's warning and its later breach one identity derived
from patient, code, TIME ZERO and element — the same element on a later episode is a different
clinical fact.

**Absence of findings is not a finding of absence.** Two separate controls were changed for this.
Shadow mode's `report().clean` was true for an observer that had been handed nothing, which is how an
observer wired to the wrong function passed for a working one; `clean` now requires `observed`. And a
push accepted by APNs is SENT, never DELIVERED — only the handset's own receipt promotes it. In the
live demonstration the escalation correctly read `delivered: false` after the gateway accepted it for
4 of 11 devices.

**A screen whose only exit is accepting responsibility gets answered by whoever is nearest.** The
forced acknowledgement screen has two answers and only one closes the loop. "I cannot attend" posts
no acknowledgement and leaves the escalation outstanding so the ladder finds somebody who can.

**An unconfigured surface must not look like a working one.** The bedside page previously drew a
wristband field and three live-looking buttons with no system behind them. `opd-boot.js` requires
store, actor and eMAR from the deployment — the page still names nobody, per the earlier decision
that a page constructing its own actor would be a page deciding who may give a drug — and paints an
explicitly disabled "not connected to a patient record" state otherwise.

**Three defects were found only by real hardware**, and each had passed its unit tests: the shadow
observer watched `ingestFromWard` while `ghis-ward.js` calls `ingestWardHistory`; APNs and FCM
dropped every custom key, so an escalation reached a phone that could not say which escalation it
was; and a Debug build's sandbox token was pruned by a production-host rejection, which looked
exactly like a broken push system. The lesson is not "write more tests" — the mocks were faithful to
the contracts they modelled. It is that the contracts themselves were wrong, and only the real thing
said so.

**Nothing here moved a safety-case rating.** 14 of 16 verified, 2 partial, unchanged across all nine
PRs. HAZ-DET-01's remaining blocker is the resuscitation committee approving the escalation policy;
HAZ-TIME-01's is that attestation is permitted by design. Working transport is not an approved
policy, and a demonstration on `DEMO-PAT-1` is not a patient.

## 2026-09-06 — The record leaves the browser: a server-side WardSynQ Clinical Record Service

The audit of 2026-09-05 found the decisive gap: WardSynQ had every part of a clinical core and no
record. `wardsynq-store.js` offered memory and IndexedDB only, so the product model (hospital PC and
StewardMD Mobile as two interfaces to one record) was impossible, and SCCM and the WardSynQ model
overlapped with nothing saying which was the record.

**Decision: the WardSynQ canonical model is the clinical record; SCCM is the ingest wire format.**
They meet in one adapter (`wardsynq-sccm-adapter.js`) and nowhere else. Neither was rewritten.

**Decision: reuse the store and the governance, do not port them.** The server runs the SAME
`ClinicalStore` and `GovernedStore` per request over a `TenantBackend`. There is no second
implementation of versioning, append-only history or the actor ceilings to drift from the first.
This is also why `functions/` now imports from `wardsynq/`, which had no precedent; `wrangler pages
functions build` proves it bundles.

**Decision: a persistence PORT, not a database.** Eight methods (`functions/_wardsynq/repository.js`),
D1 behind it today, a reference in-memory one for tests, on-prem a sibling file nobody has written.
Managed India-hosted, hospital-controlled and hybrid are then deployment choices, not rewrites. Stated
plainly: only D1 exists.

**Decision: concurrency is two layers, and the loser is told.** `expectedVersion` on the API refuses
a stale write with the current record; the UNIQUE (tenant, type, id, version) key catches the race
the check cannot see. Nothing merges silently; the existing Reconciler resolves with a person.

**Decision: authority follows provenance, in both modes.** A record whose latest version came from
another system cannot be overwritten natively, whether the hospital is on Epic or on WardSynQ. This
is what "the existing EMR remains authoritative for the data it owns" means as code. Integration
mode adds only that the external EMR creates the masters. Neither is a clinical rule.

**Decision: PHI stays clinician-only.** `record:read`/`record:write` were added to the Connect RBAC
matrix for clinician (and super-admin, who is then built READ-tier). Owner, admin, auditor: no chart.
The pinned matrix test was updated deliberately, with the reason in the test.

**Not decided, on purpose:** which of the 18 queue roles map to which actor tier; whether the
workstation's demo cohort view model (labs with ranges, med sigs) should become a canonical
projection; write-back to an external EMR. Each is the next build or a committee's, not this one.

## 2026-09-06 — Eighteen roles, one ladder: the operational roles reach the clinical record

The record service shipped with only Connect membership at its door, which has no nurse and no
receptionist. The hospital's real staff registry is `_queue_roles.js` + `q_members`, decided by
`authorizeOrg()`. Wiring it in was the prerequisite for any OPD write to move.

**Decision: derive the grant from capabilities, not from role names.** `emr.treat` → EXECUTE on
everything; `emr.vitals` without it → EXECUTE on Observation only; `emr.view` → READ; `order.read` →
READ on orders; nothing → no actor. The owner's non-negotiable ("a nurse may record vitals but never
treatment/prescriptions") was already a fact about capabilities, so the record inherits it instead of
restating it. A nineteenth role gets the right grant by holding the right capabilities.

**Decision: scope is a field on the actor, enforced in the same place as everything else.** Rather
than a second check in the service, `authoriseWrite` gained `SCOPE_DENIED` and `GovernedStore` reads
gained `READ_SCOPE_DENIED`. Actors built without scope are unchanged (null = every type), which is why
36 existing actor tests and every hub adapter kept passing without edits.

**Decision: a nurse is EXECUTE, not DRAFT.** Her observation is a committed clinical record. What she
may not touch is decided by scope; what she may not sign is decided by the absence of a credential.
Making her DRAFT would have labelled every vital sign a proposal.

**Decision: the OPD role wins over Connect membership when both exist.** Least privilege, and the OPD
org is where the hospital actually manages its people.

**Decision: AI acts as itself.** `origin.kind === "ai"` or `aiDrafted: true` makes the writer an
AI-kind actor with `onBehalfOf`. A doctor's token is a session, not an authorship claim. The
alternative, stamping the doctor and keeping a flag, is exactly the field-is-not-a-control failure the
actor model was written to end.

**Left as is, and named:** `admin` writes as a doctor because the existing matrix grants it
`emr.treat`; a staff PIN session cannot sign because a PIN carries no registration number; the
queue's room/department scope (`withinScope`) is not applied to the chart, since a chart is a patient
and not a room.

## 2026-09-06 — The first write moves: nurse vitals, per tenant, three modes

The smallest real clinical write, chosen because it exercises the nurse grant end to end and needs
nothing not already built.

**Decision: dual-write with a per-tenant mode, not a cut-over.** `off` leaves the handler
byte-identical. `shadow` writes the timeline first and reports the record's outcome. `authoritative`
writes the record first and fails the save if the record refuses. The timeline is never removed:
every OPD screen reads it, and a mode is a setting, not a deploy.

**Decision: structured values from the form, not parsing the text.** The console already had the
fields; sending them alongside the text costs nothing and avoids inventing a parser whose mistakes
would become clinical values.

**Decision: as reported, coded, no conversion.** LOINC codes, UCUM units, Fahrenheit stays
Fahrenheit. A unit conversion is a place to be wrong silently; the GHIS adapter took the same
position for the same reason.

**Decision: no Patient record from a vitals write.** The nurse's grant is Observation only and the
ticket has no demographics. Observations file under `opd-pat-<mrn>`, which the registration
migration will also use, so they attach to the master the day it exists. A ticket with no MRN is
refused rather than given an invented patient.

**Not done:** the doctor's writes (investigations, prescriptions, assessment) still go to GHIS; the
record is not read back into any OPD screen; the safety engine is not wired to these observations.
`WARDSYNQ_RECORD` stays OFF and the production schema unapplied.

## 2026-09-06 — The doctor reads the record: vitals on the ticket, through the record's own door

**Decision: the console reads the record directly, not through the queue API.** The timeline GET
only says WHERE the record is (`record: {tenantId, patientId}`), and only when the tenant is on.
The console then calls the record's existing Observation endpoint with the credentials it already
holds. Proxying through the queue route would have made the queue's EMR_VIEW the authority over the
clinical record, which is a second door with a weaker lock; this way a pharmacist who can open the
notes drawer still cannot see vitals, because the record refuses them, and a tenant elsewhere gets
403, because the record scopes by membership.

**Decision: alongside, not instead.** The timeline keeps its text line; the record card shows the
values. Two facts from one save are two facts. When a tenant is in `shadow`, a doctor can see both
and judge them against each other before the tenant flips to `authoritative`.

**Decision: every failure state is a clinical sentence.** "Could not reach the clinical record.
Showing the visit timeline only" is what a doctor at 3am needs; a spinner that never ends, or an
empty card that looks like "no vitals", would each be read as a clinical fact.

**Not done:** the doctor's own writes still go to GHIS; the safety engine does not read these
observations; no Patient master is created; `WARDSYNQ_RECORD` stays OFF and the schema unapplied.
