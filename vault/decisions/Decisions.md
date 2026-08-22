---
tags: [decisions, adr]
---
# Decisions

Dated architectural calls + why. Newest first. Keep each short: **decision · why · trade-off · status**.

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
