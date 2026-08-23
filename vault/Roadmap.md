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

## Security / ops
- [ ] Rotate: Mac pw, admin token (done?), 2Factor, Green-API, GHIS, Resend, keystore; move+rotate the Firebase-admin JSON out of ~/Downloads
- [ ] Gemini model migration before 2027-01-28 (env-swappable)
