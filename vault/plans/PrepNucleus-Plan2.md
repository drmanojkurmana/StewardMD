# PrepNucleus Plan 2: everything the market leader has, done properly, plus what nobody else can do (2026-10-06)

Inputs: the private competitor audit (owner's recordings of the reference app, its listing, site and policies; copy
in the owner's private bucket `gs://…-prep-batch/private/`), Plan 1 ([[plans/PrepNucleus]]), Layer C
([[plans/PrepNucleus-LayerC]]), Arena ([[plans/PrepNucleus-Arena]]). Flags stay OFF until the owner turns them on.

## 0. The bar
"100x better" is not 100 more features. It is: every feature the reference app has, each one measurably better on
the axis students feel (accuracy, speed to the right answer, retention, trust), plus five things it structurally
cannot copy. Every claim we print is sourced; every number we show the student is computed, not decorative.

## 1. Parity map (what they have -> what we ship -> why ours is better)
| Theirs | Ours | Better because |
|---|---|---|
| Flashcards (81k claimed) | **Cards** per module: front/back + image occlusion + cloze, generated from the screened bank explanations and the KB, same 12 gates as Layer B, FSRS-6 scheduling shared with MCQs | One memory model across cards and MCQs; every card traceable to a source sentence; disputed keys never become cards |
| "Path" lessons (text + slide + TTS) | **Lessons** (in build): 4-8 steps, text on top, a drawn visual below (table / flow / compare / licensed photo), on-device TTS with speed, Ask MaiK per step, 3 bank MCQs at the end | Visuals are data, not screenshots: crisp, dark-mode, zoomable, searchable; every number checked against the grounding; offline |
| QBank + PYQs + mock tests | 147k screened MCQs, Layer B fill, **PYQs (section 3)**, mocks per real pattern with marking | Key screen (16.6k disputed hidden), report + auto-hide, PYQ year tags, recall-paper honesty labels |
| AI tutor "Ruby" with voice | **MaiK Tutor**: inside every question, card and lesson step; voice in and out (Live Doctor voice stack); offline teacher on device | Grounded in StewardMD's clinical KB; refuses to invent numbers; works with no signal |
| Personalised study plan, Daily Target | **Plan**: exam + date + daily minutes -> a daily target split across cards / MCQs / lesson / test, re-planned every morning from FSRS due load and weak areas | The plan is derived from real retention data, and it shows its reasoning ("12 cards due, Pharmacology weakest") |
| Exam readiness ring | **Readiness** = coverage x retention (FSRS stability) x accuracy per subject, weighted by the exam blueprint; tap to see the formula and the three weakest topics | A number a student can trust and act on, not a motivational dial |
| Streak, XP, levels, trophies | Streak with a weekly freeze, XP, a small set of real milestones (first mock, 1,000 cards, 30-day streak) | No fake urgency, no loss-framing copy |
| Live Activity / lock screen | iOS Live Activity + home widget, Android widget: "Today N of M", next due, exam countdown; opt-in reminders at a chosen time | Native, quiet, one tap into the next item |
| 2-3 device sync | **Sync** (opt-in): encrypted store sync via the StewardMD account; conflict-free merge (FSRS logs are append-only) | Works across phone + tablet + reinstall; data minimal; delete any time |
| Notes, videos, books | Notes = lesson summaries + the student's own Layer C decks + annotations on any step; **no videos/books chase** (licence-heavy, low retention per minute) | Time goes to active recall, which is what moves ranks |
| Exams: UG, PG, FMGE, MDS, USMLE, AMC, UKMLA | Now: NEET-PG/INI-CET, NEET-SS (14 SS subjects), USMLE. Add **FMGE** (MBBS bank as is) in phase 1; NEET UG, MDS, AMC, UKMLA only with a real bank each | We do not list an exam we cannot serve well |
| Add friends | Arena (live): 1v1 battles (Elo), daily sprint, weekly grand test, leaderboards; add friends + challenge a friend + college boards | Competition built on server-side scoring that cannot be gamed |
| Paywall with countdowns | One honest price, a real free tier, 7-day refund, student verification discount, no countdowns, no tracking prompt | Trust is the brand (CCPA dark-pattern rules, DPDP) |

## 2. The five things they cannot copy (the "100x")
1. **Truth layer.** Every MCQ key screened, every AI item labelled and gated, every lesson number checked, every
   PYQ marked "official" or "memory-based recall" honestly. A public accuracy page: disputed rate per subject,
   reports resolved, median fix time.
2. **One memory model.** Cards, MCQs, lesson quizzes, PYQs and battles all write to the same FSRS state, so the
   plan, readiness and weak areas see everything the student did, everywhere.
3. **Clinician continuity.** The same app the student uses as an intern and resident: MaiK, calculators, protocols,
   drug index. Prep content links into the clinical tool ("see this in practice") and back.
4. **Superspeciality depth.** NEET-SS across 14 subjects grounded in StewardMD's oncology trees, protocols and
   clinical KB, an exam the reference app does not serve.
5. **Offline-first with on-device AI.** Bank, cards, lessons and the AI teacher work on a ward with no signal.

## 3. PYQs (owner will supply)
- **Input:** whatever the owner provides (PDFs, scans, spreadsheets). Each paper tagged `{exam, year, session,
  kind: "official" | "recall"}`. NEET-PG papers are not published by NBEMS; most "PYQs" in the market are
  memory-based recalls, so they get the `recall` label in the app, never "official", unless the source is official.
- **Pipeline (`tools/prep-pyq.mjs`):** extract (Layer C OCR path for scans; plain text otherwise), split into items,
  normalise options, dedupe against the bank (exact + near-duplicate by n-gram Jaccard; a duplicate gets a PYQ tag on
  the existing item instead of a copy), map to modules (Gemini mapping, 96.7% on the sample), blind-solve key screen,
  write explanations where missing (Layer B gates), image items kept with their figure.
- **App:** "Previous year papers" on home (by exam and year, full paper as a timed test with the real pattern), PYQ
  filter in every module, "asked in 2023, 2021" chips on items, PYQ-weighted readiness.
- **Copyright:** the owner supplies and accepts the sources (as D2); we store the questions, never the source PDF;
  no publisher branding.

## 4. UX direction (keep the StewardMD identity, raise the craft)
- **Home:** one hero line (readiness + days to exam), then Today's plan as a checklist, then Continue (last lesson,
  due cards), then Compete, then Subjects. Fewer cards, more hierarchy.
- **Lesson reader:** large reading type, bold terms, drawn visual, bottom bar (MaiK, Back/Next, Play, speed).
- **Cards:** swipe to grade (Again / Hard / Good / Easy) with haptics, image occlusion taps, keyboard on tablets.
- **Onboarding:** 4 screens: exam, exam date, daily minutes, notification time. No phone number, no tracking prompt,
  no fake loader, no paywall in onboarding.
- **Finish moments:** a quiet, satisfying end screen per lesson, mock and battle with what changed (readiness delta).
- Every screen passes the owner's UI rule set (ui-ux-pro-max, anti-ui-slop, impeccable, Emil, web-design-guidelines).

## 5. Phases (each ends with tests + screenshots reviewed + owner yes before anything paid or live)
| Phase | Scope | Paid? |
|---|---|---|
| 1 | Lessons pilot (12 modules) + reader; FMGE exam tab; onboarding (4 screens); readiness v1; plan v1 | Lessons Batch, about cents (dry run first) |
| 2 | Cards: generator + reviewer UI (swipe, occlusion), pilot 20 modules, then all MBBS | Batch, dry run first |
| 3 | PYQ pipeline on the owner's papers; PYQ home + filters + chips | Batch for mapping/screen/explanations |
| 4 | Sync (opt-in, encrypted), widgets + Live Activity (native, needs a store build), reminders | No AI cost; native build |
| 5 | Layer B full fill (packs in progress), lessons + cards for all modules, NEET-SS lessons | Largest Batch spend; staged with dry runs |
| 6 | Arena social (friends, challenges, college boards), honest pricing page wired to the existing monetization | No AI cost |

## 6. Measures (decide by data, not by feel)
- Accuracy: disputed rate per subject < 2% after screening; reports per 1,000 attempts; fix time.
- Learning: 7-day retention (FSRS predicted vs actual), readiness vs mock score correlation.
- Engagement: D1/D7/D30 retention, days with the daily target met, lessons finished.
- Trust: refund rate, store rating, zero dark-pattern findings in a CCPA checklist.

## 7. Open owner decisions
1. Pricing for PrepNucleus (free tier scope, annual price, student discount).
2. Exams to add after FMGE (needs banks).
3. Whether to publish the accuracy page.
4. Native build timing for widgets and Live Activity (needs App Store / Play releases).
