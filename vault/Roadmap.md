---
tags: [roadmap]
---
# Roadmap

Pending / deferred, by area. `- [ ]` so Obsidian renders checkboxes (Tasks/Dataview can query them).

## App-store release
- [ ] Install a **release Xcode** (beta was removed) → rebuild + install iPhone (scan-fix client bits, [[Scan-Meds and Drug Index]])
- [ ] iOS TestFlight archive (Product ▸ Archive; needs Apple ID at archive time). See `docs/PRODUCTION-RELEASE-RUNBOOK.md` C.1
- [ ] Android: Play Developer API service-account key → `node scripts/play-upload.mjs` one-command uploads
- [ ] Enable Firebase **App Check** (console + native) once a TestFlight/release build shows verified tokens
- [ ] Cloudflare WAF / Bot Fight / rate-limit (dashboard)

## Install size (on-demand assets) — see [[Decisions]]
- [x] MediaPipe / [[FundX]] stripped (~22 MB) → gold1048
- [ ] ONNX runtime ([[KardiQ X]]) → remote (~11 MB, flag-gated)
- [ ] KardiQ X Learn images/content → remote (~8 MB, non-clinical; needs `onerror` fallback)
- [ ] ML Kit face detector → Google **downloadable** model (~8 MB/device)
- [ ] offline clinical KB → download on first launch (biggest ~46 MB; touches offline-first core)

## [[AI Control Center]]
- [ ] X-ray ([[ThoreX]]) daily cap — cap belongs at the IMAGE-analysis entry (on-device), not the text `thorex/llm`
- [ ] Per-endpoint precise per-module token cost (currently counts requests, rough cost)

## Modules
- [ ] **[[SURGX]] clinical sign-off** — 8 authored protocols, 13 engine overlays, 5 procedures,
      3 cases and 15 evidence records are all `ai_drafted`. Flip `review.status` per item after
      review, then set `smd_surgx_draft` to 0. This is the ONLY thing between the module and use.
- [ ] **[[SURGX]] media sourcing** — 3 uncleared entries in `surgx/media/manifest.json`, each with a
      work order. One (`abscess-deloculation`) is authorable in-house as an inline SVG.
- [ ] [[SURGX]] voice → note: `SMD_VOICE` target + the `/extract` kind `surgx-note` are built and
      tested but not wired to a mic. Per-SECTION mic, not one global one (the opd-emr PR #648 rule).
- [ ] [[SURGX]] Senior Surgeon Mode: `surgx_case` bucket + `mode:"surgx-mentor"` remap exist;
      `MENTOR_SYS` still to be written. Cases are fully playable without it.
- [ ] Missing surgical calculators for `calculators.js` (NOT for SURGX): POSSUM / P-POSSUM,
      Clavien-Dindo, Tokyo Guidelines grading, LRINEC, Boey, Mannheim Peritonitis Index.
- [x] Apply SURGX's `?v=<contentVersion>` content-fetch fix to [[CliniX]] — done 2026-08-26.
      `clinix-content.js` now fetches the manifest `no-store` and everything else with
      `?v=<contentVersion>`; pinned by `test/clinix-content-version.test.mjs`.
- [ ] **[[CliniX]] clinical sign-off** — content is `ai_drafted` and the review gate hides ALL of it
      from students. Flip `review.status` to `approved` per skill after review. This is the ONLY
      thing between the module and student testing.
- [ ] **[[CliniX]] media sourcing** — 10 uncleared entries in `clinix/media/manifest.json`, each with
      what is needed and where to look. Openly-licensed or permitted embeds only; the 3 that render
      today are self-authored diagrams.
- [ ] [[CliniX]] decide whether the exam-vocabulary firewall widening should apply app-wide (it would
      fix the two-token clarify trap for doctors typing "JVP" too, not just students)
- [ ] [[ICU]] v2 redesign deploy (rules+indexes, emulator + 2-device test); alert-safety push
- [ ] [[KardiQ X]] photo-dx pivot (image-based model) — ≤$35 GPU-VM overnight build
- [ ] [[Medical Knowledge Base]] — Obsidian → build pipeline for clinical content; dx-mgmt enrichment merge
- [ ] [[FollowCare]] owner TODOs (clinician thresholds, translations, R2 bind, WhatsApp BSP)
- [ ] [[RxChoice]] Phase 2 — pharmacy availability + live prices (MRP is a list price today), patient
      selection (`smd_rxchoice_patient_selection`), refill savings. Also: per-brand strength is only
      recoverable from the brand NAME for most combination rows, so a `strength_mg` column on `drugs`
      would let RxChoice match combinations on the composition instead of on naming convention.

## Security / ops
- [ ] Rotate: Mac pw, admin token (done?), 2Factor, Green-API, GHIS, Resend, keystore; move+rotate the Firebase-admin JSON out of ~/Downloads
- [ ] Gemini model migration before 2027-01-28 (env-swappable)
