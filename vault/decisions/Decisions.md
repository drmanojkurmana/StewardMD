---
tags: [decisions, adr]
---
# Decisions

Dated architectural calls + why. Newest first. Keep each short: **decision · why · trade-off · status**.

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
