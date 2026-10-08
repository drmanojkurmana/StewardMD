# Competitor audit: Revisable vs PrepNucleus (2026-10-06)

Sources: owner's screen recordings (onboarding to home, about 3 min; AI lesson, 40 s) and screenshots; App Store
listing and iTunes lookup (id6451157089, 4.49 from 1,159 India ratings, v8.0.0); revisableapp.com (features, plans,
privacy policy and terms, both updated 2026-02-17); MCA data via Tracxn. Individual store reviews could NOT be pulled
(Apple and Play blocked the fetches), so review themes below are from the listing only. Revio Education Pvt Ltd,
Delhi, incorporated 2022, unfunded, revenue under Rs 10 cr (FY25).

## What Revisable has (observed)
| Area | What they ship |
|---|---|
| Content | Flashcards (81,419 NEET PG claimed in app; 200K+ on site), QBank (39,25x NEET PG Q; 100K+ on site), notes, videos, books / audiobooks, PYQs, mock tests, AI book summaries |
| Learning path | "Path": micro-lessons per chapter (Surgery > Breast > Benign Breast Conditions, 8 min), text + tables + clinical photos + diagrams, audio narration with speed control, XP per lesson, Next/Finish |
| AI | "Ruby AI" / "Dr. Kanika AI" tutor with a human avatar and voice; "learns from your mistakes"; AI generates flashcards and quizzes; paywall says "unlimited AI tutor & Claude" (provider not disclosed in policy) |
| Personalisation | Onboarding asks name, phone, exam (NEET UG/PG, FMGE, NEET MDS, USMLE Step 1, AMC, UKMLA), exam date -> "180 days until NEET PG", builds a Daily Target across 7 content types |
| Motivation | Exam readiness ring (%), streak, XP, level, trophies, Daily Target checklist, iOS Live Activity on the lock screen ("Today 0 of 7 done"), Add friends |
| Platform | Cloud sync on 2 to 3 devices, iOS and Android |
| Price | Free tier (limited, rate-limited AI); Pro 999 / 3 months, 1,999 to 2,499 / year, also 599 / month and a 6-month 850 IAP |

## Where they are weak or exposed (do not copy)
- **False urgency and nagging (CCPA Dark Patterns Guidelines 2023):** three different paywalls in one onboarding,
  a 23:59:59 countdown that restarts, "valid till 7 Oct", "52% -> 60% OFF" animation, a "Surprise Gift" popup, a
  persistent "Unlock @ 50% OFF" countdown bar on home, and two prices for the same 12 months (1,999 and 2,499).
- **Forced tracking consent:** a pre-prompt plus "Please tap Allow on the prompt above to continue" for App Tracking
  Transparency. Apple guideline 5.1.2(i) forbids making access conditional on tracking permission.
- **Rating request before any use** ("Give us a rating", pre-filled 5-star reviews).
- **Fake progress theatre:** "Optimizing your plan 1% -> 86%" loader; fear copy ("Every week you wait 70% of it is gone").
- **Endorsement by logo:** AIIMS, KGMU, JIPMER, MAMC, GMCH, Oxford Medical logos under "Content you can trust".
- **Unverifiable numbers:** 300K+ students in app vs 100K+ on the site; 4.7+ claimed vs 4.49 on the India store;
  "94% questions matched" with no method.
- **Privacy:** phone number required; tracking identifiers on the App Store label; policy has no DPDP grievance
  officer, no minors' consent (13+ rating, NEET UG under-18s), vague retention, AI vendors not named.
- **Terms:** no full refund; "We do not guarantee the accuracy of the AI features" while marketing "accurate" answers.
- **Everything locked:** every Daily Target item shows PRO on a new free account.

## Where PrepNucleus already matches or wins
| Area | PrepNucleus today |
|---|---|
| QBank size and quality | 147,310 MedMCQA questions, Gemini-mapped (92.5%), blind-solve key screen (16.6k disputed keys hidden), report + auto-hide; Layer B AI questions gated by 12 automatic checks |
| Spaced repetition | FSRS-6 on every answer (real algorithm, not marketing) |
| Exams | NEET-PG / INI-CET, NEET-SS (14 SS subjects, which Revisable lacks), USMLE |
| Testing | Practice, timed tests with question grid, mock exams per pattern with marking, My mistakes with reasons, weak areas, custom module |
| Competition | 1v1 live battles (Elo), daily sprint, weekly grand test, leaderboards (Revisable only has "Add friends") |
| Your own material | PDF or notes -> deck (Layer C), OCR for scans |
| Offline | Bank downloads per subject; offline AI teacher ("Why is B wrong?") with a MaiK pack |
| Trust | No dark patterns, consent-first Arena, progress on device, licence shown, clinician-built StewardMD behind it |

## What we are missing (ranked by impact)
1. **Flashcards as a first-class content type.** FSRS exists but only behind MCQs. Need a flashcard deck per module
   (front/back, image cloze), generated from the bank explanations + KB with the same gates. Biggest content gap.
2. **Guided lessons ("Path").** 5 to 10 minute chapter lessons: short text blocks, one table or diagram, a clinical
   image where it matters, then 3 MCQs. Narrated with on-device TTS and a speed control. Builds on CliniX/SURGX lesson
   patterns and the KB.
3. **Onboarding + study plan.** Exam picker (add FMGE and NEET UG now; FMGE is the MBBS bank as-is), exam date ->
   countdown, daily target split across flashcards / MCQs / lesson / test, re-planned each day from FSRS load. No
   phone number, no tracking prompt, no paywall interruptions.
4. **Exam readiness score.** A defensible number: coverage x retention (FSRS stability) x accuracy per subject,
   shown with how it is computed. Plus streak and a gentle XP/level; no fake urgency.
5. **Cross-device sync.** Today progress lives on one phone. Opt-in encrypted sync of `smd_prep_v1` through the
   existing StewardMD account (Firebase uid) so a reinstall or a second device keeps progress.
6. **Images in questions.** 390 image MCQs were dropped at build; add image-based items (RadioAnatome, ECG atlas,
   fundus, derm atlases the app already licenses) and clinical photos in explanations.
7. **Lock-screen and home presence.** iOS Live Activity / widget and an Android widget for "Today N of M", daily
   reminder notifications (opt-in), exam countdown.
8. **AI tutor depth.** MaiK chat inside a question and a lesson ("explain like a teacher", "quiz me on this"), voice
   (we have Live Doctor voice), and "learns from mistakes" = mistakes tags + FSRS already, surface it.
9. **More exams:** NEET MDS, AMC, UKMLA, PLAB later (needs new banks; not now).
10. **Videos / books:** not recommended to chase; licence-heavy. Lessons + narration cover the need better.
11. **Social:** friends list and "challenge a friend" on top of battles; class or college leaderboards.
12. **Pricing page:** honest single price, a real free tier (practice + 1 battle a day free), student verification
    discount, refund within 7 days, no countdowns. The existing StewardMD monetization (Razorpay/IAP) carries it.

## UI/UX gaps against their app
- **Visual identity:** theirs is a bold dark world (sky hero, pixel icons, mascot). PrepNucleus is calm and clinical;
  keep it, but add one memorable element (exam countdown header, readiness ring) and real imagery in lessons.
- **Home focus:** they lead with one number (readiness) and one list (Daily Target). Our home has more sections; add
  the readiness + countdown as the top element and fold Practise into fewer rows.
- **Lesson reader:** large, high-contrast reading type, bold key terms, a full-width image with zoom, a bottom bar
  (AI, Next, audio, speed). We have no reader.
- **Progress feedback:** XP chip per answer, a satisfying finish screen per lesson. Ours ends with a plain result.
- **Onboarding:** theirs is 25 screens with fear copy; ours has none. Target 4 screens: exam, date, daily minutes, done.

## 10x opportunities (things they cannot easily copy)
- NEET-SS depth (14 superspecialities) grounded in StewardMD's clinical KB and protocols.
- Live battles and tournaments with transparent scoring.
- Offline-first with an on-device AI teacher; works on a ward with no signal.
- Honest product: every number sourced, keys screened, AI questions labelled, no dark patterns. Make that the brand.
- Clinician continuity: the same app the student will use as a resident (StewardMD calculators, protocols, MaiK).

## Not verified
Store reviews (blocked), Play listing details, whether "Claude" is actually used, refund policy version, and the
6-month IAP at Rs 850.
