---
tags: [plan, learning, video, adaptive, medigram]
status: proposed (2026-10-31); owner decisions recorded 2026-10-31 (section 16); not implemented
owner-goal: turn short-form scrolling intent into short, measurable learning sessions inside PrepNucleus without creating an addictive infinite-scroll product.
flag: smd_prep_medigram (planned, default OFF)
---

# PrepNucleus MediGram

**Working tagline:** Scroll less. Recall more.

MediGram is an optional short-form, swipe-based learning experience inside PrepNucleus. It combines exam questions, concise explanations, short educational videos, clinical discoveries and scheduled recall in one adaptive feed. It is not an Instagram clone and must not depend on importing a user's personalised social-media feed.

## 1. Product thesis

Medical learners already have question banks, lectures, notes and entertainment feeds. The unmet need is starting a study session, sustaining active engagement, deciding what to study next and retaining it later.

MediGram should:
1. Reduce friction when starting a useful study session.
2. Make active recall approachable through a short-form interface.
3. Adapt the next item to the learner's exam, performance, weak areas and due reviews.
4. Turn video exposure into retrieval practice rather than passive watch time.
5. Give breaks a clear, user-controlled boundary and a reliable route back to learning.

**North-star outcome:** improvement in delayed recall and exam performance per minute of active learning, not total feed time, video views or swipes.

Evidence-informed rationale: retrieval practice and distributed practice have substantial support in health-professions education. Short video is a delivery format, not a substitute for retrieval. The proposed feed ratio and UX are hypotheses to validate in a pilot, not established optimal learning ratios.

## 2. Positioning within PrepNucleus

MediGram is an optional discovery and engagement surface over existing PrepNucleus learning assets. It must reuse the current question bank, exam profiles, lessons, bookmarks, My Mistakes, flashcards and FSRS-6 scheduling. It must not create a parallel question bank or a second mastery system.

| Existing capability | MediGram use |
|---|---|
| Exam profile and taxonomy | Filter content by exam, subject and speciality |
| Screened MCQ bank | Primary active-recall content |
| Explanations and wrong-option reasons | Immediate feedback |
| Lessons and lesson visuals | Short concept segments and video companions |
| My Mistakes / weak areas | Prioritise misconception repair |
| Flashcards + FSRS-6 | Schedule delayed recall |
| Bookmarks and notes | Save for later and personal annotation |
| Today's plan / timetable | Respect planned workload |
| Offline bank and IndexedDB cache | Offline questions and eligible first-party media |

MediGram should be a new home entry or tab inside PrepNucleus, not a separate app or independent account system.

## 3. Experience and feed modes

### 3.1 Study Feed (default)

A vertical, one-item-at-a-time feed containing:
- MCQs and short clinical vignettes.
- Explanation cards, including why distractors are wrong.
- First-party micro-lessons and concise concept videos.
- Clinical image, ECG, pathology and radiology challenges only where assets are licensed and clinically reviewed.
- Research, guideline and clinical-practice updates with date, source and review status.
- Recall cards due under FSRS-6.

The feed is exam-aware: NEET-PG, INI-CET, NEET-SS, USMLE and FMGE according to the selected PrepNucleus profile.

### 3.2 Clinical Discovery

A less exam-focused but still professional feed:
- Interesting clinical cases and diagnostic reasoning.
- ECG, imaging, pathology and procedural teaching.
- Medical history, physiology curiosities and evidence updates.
- Short explainers from approved creators.

Every clinical item needs provenance, date/context where relevant, and editorial status. Do not present an isolated social-media claim as a guideline or clinical recommendation.

### 3.3 Smart Break

A clearly separate, optional, time-bounded break experience. Initial release should use curated light medical content, humour and non-clinical relaxation content that StewardMD owns or has permission to display. Do not reproduce an unrestricted social feed.

- User chooses a 3- or 5-minute break; default may be 3 minutes.
- Show remaining break time unobtrusively and provide a clear return-to-study action.
- User may dismiss or extend the break deliberately; never shame, punish or create artificial urgency.
- Do not auto-switch modes, autoplay an endless sequence, or make the break timer a coercive lock.
- No Instagram or YouTube account scraping, credential collection or importing personalised recommendation feeds.

### 3.4 Mode controls

Use a clear segmented selector: **Study | Clinical | Break**. Study is the default. Make returning to Study one tap away. Do not label ordinary entertainment as medical education.

## 4. Core learning loop

### 4.1 Initial default cadence

Pilot with **3 MCQs → 1 related short video or micro-lesson → 1 retrieval check**.

Example:
1. MCQ 1: answer before reveal.
2. Feedback: correct answer, reasoning and why alternatives are wrong.
3. MCQ 2: test a related concept.
4. MCQ 3: test application or a clinical vignette.
5. Short video/micro-lesson: ideally 30–90 seconds, tied to the concepts just tested.
6. Retrieval check: one new question or concise teach-back prompt.
7. Continue, save, or finish the session.

This is the starting hypothesis, not a fixed rule. A/B test 2:1, 3:1 and 5:1 sequences, measuring delayed recall and completion quality rather than swipe volume. Do not insert a video after every question by default.

### 4.2 Adaptive cadence

- If the learner answers incorrectly, show targeted feedback and optionally a short explanation before moving on.
- If a misconception repeats, prioritise a different representation (analogy, diagram, comparison or worked case), then test again.
- If the learner answers confidently and correctly, increase difficulty or move to a related concept.
- If the learner is fatigued or has reached the session goal, offer a natural stopping point.
- Do not infer mastery from video completion, dwell time or a swipe.

### 4.3 Gesture and controls

- Swipe up: next item.
- Tap MCQ option: submit answer.
- Tap explanation: expand full rationale.
- Save: bookmark or add to a revision queue.
- "I don't understand": open a simplified explanation, analogy, diagram or AI Tutor flow.
- "Not relevant": reduce similar content.
- Include accessible alternatives to gestures, visible progress and an explicit Finish session action. Scrolling must never be the only way to exit.

Support screen readers, keyboard navigation, reduced motion, captions, playback speed and sufficiently large touch targets.

## 5. Scroll Missions and session design

Offer small, finite missions rather than an endless feed. Examples:
- 5 questions (about 3–5 minutes).
- 3 questions + 1 micro-lesson.
- Revise 5 due mistakes.
- One clinical case.
- A 10-minute mixed revision session.

Durations are estimates, not promises. Let the learner choose or skip missions. Completing a mission should lead to a meaningful summary and a stopping point, not an automatic new mission.

A mission is complete only when required learning actions are complete; video watch time alone does not count.

## 6. Adaptive recommendation engine

### 6.1 Candidate ranking

Build a candidate pool from existing PrepNucleus assets. Rank deterministically in the first release using:
1. Due FSRS reviews and overdue mistakes.
2. Weak topics and recurring error tags.
3. Selected exam, subjects and current timetable.
4. Appropriate difficulty and concept prerequisites.
5. Variety across subjects and content types.
6. Freshness for time-sensitive clinical updates.
7. Explicit user feedback (save, not relevant, hide topic).

Apply hard eligibility filters before ranking: correct exam/speciality, valid question key, no disputed/hidden item, content approval, licence status and current clinical review requirements.

Do not let opaque engagement optimisation override educational priority. Do not optimise for session length, compulsive return, outrage, fear or social comparison.

### 6.2 Learning signals

Use reliable signals already generated by the learning engine:
- answer correctness and response time (time is contextual, not a mastery score alone);
- confidence, only if the learner explicitly provides it;
- repeated wrong-option patterns and mistake tags;
- FSRS due date, stability and retrievability;
- lesson completion followed by retrieval performance;
- explicit save / not relevant / hide feedback.

Do not treat a video view, replay, like or dwell time as proof of knowledge.

### 6.3 Spaced recall

A video or feed interaction may suggest a related recall item, but it must enter the existing FSRS workflow only when the learner actually answers or grades a valid question/card. Avoid duplicate cards or changing FSRS scheduling merely because a video was watched.

## 7. YouTube integration: permitted discovery, not feed cloning

YouTube can be an optional video source, but MediGram must own its feed ranking and learning experience.

**Not supported / prohibited design assumptions:**
- No API access to a user's personalised YouTube Shorts recommendation feed.
- No importing watch history or recommendations from a personal YouTube account unless a future documented API and explicit permission genuinely support the exact use case.
- No scraping, unofficial endpoints, browser-cookie extraction, credential collection or downloading/rehosting YouTube videos.
- No hiding, replacing or modifying YouTube player controls, branding, advertising or links.
- No incentives, XP, coins, prizes or mission rewards for watching embedded YouTube videos.

**Permitted implementation path, subject to current YouTube API policies and review:**
- Discover public videos using the official YouTube Data API, within quota and policy limits.
- Curate approved channels and videos by exam, speciality, topic, language, duration and editorial quality.
- Store only permitted metadata and video IDs; respect API caching, attribution, deletion and refresh requirements.
- Play eligible videos through the official YouTube embedded player or open them in YouTube where embedding is unavailable.
- Preserve player branding, controls, ads and required links. Do not imply a YouTube video is owned or clinically endorsed by StewardMD.
- Provide a clear external-source label and report/remove flow.
- Before launch, review current YouTube API Services Terms, Developer Policies, branding requirements and embedded-player requirements. API availability does not imply permission to reproduce Shorts' native feed UX.

**Preferred content hierarchy:** StewardMD-original/commissioned videos first; verified creator submissions second; curated third-party YouTube embeds as optional supplements. First-party media should use StewardMD's own player and rights-cleared hosting.

## 8. Creator and editorial ecosystem (later phase)

Allow verified doctors, educators and institutions to submit short videos. Initial creator workflow should be invite-only.

Required metadata:
- creator identity and verification status;
- speciality, topic, exam relevance and learning objective;
- language, duration, captions/transcript;
- references and date of evidence;
- rights/consent declaration for footage, patient images and music;
- review status and reviewer identity;
- version, correction history and withdrawal status.

Clinical review gates:
- No identifiable patient data without valid documented consent and lawful basis.
- No real patient images, scans, recordings or case details unless rights, consent and de-identification requirements are met.
- High-risk topics (drug doses, treatment protocols, emergency management, guidelines) require qualified clinical review and date/version checks.
- Clearly distinguish education from patient-specific medical advice.
- Provide a rapid correction and takedown process.

AI may assist with transcripts, captions, topic tags, question drafts and summaries. AI must not independently certify clinical accuracy or publish unreviewed high-risk claims.

## 9. AI Tutor integration

The "I don't understand" action should reuse the existing PrepNucleus/MaiK teaching pathway where available.

Response structure:
1. Explain in plain language.
2. Give a useful analogy, clearly labelled as an analogy.
3. Show a mechanism, comparison table or flow diagram when useful.
4. Give one clinical application.
5. Ask one follow-up retrieval question.

Ground explanations in approved PrepNucleus content and available StewardMD knowledge sources. Preserve existing number/drug-name checks and safety gates. If grounding is insufficient, say so and offer the stored explanation; do not invent a confident answer. Respect current AI usage caps, provider routing, quotas and offline teacher behaviour.

## 10. Proposed architecture (reuse-first)

Do not implement until the repository is audited on the active PrepNucleus branch. This is a proposed separation of concerns, not a claim that these files already exist.

Potential client modules:
- prep-medigram.js: feed controller, session lifecycle, mode selection and action routing.
- prep-medigram.css: isolated .pn-mg-* styles using existing PrepNucleus theme tokens.
- prep-medigram-data.js (only if needed): pure candidate selection, cadence and session helpers.
- prep-medigram-media.js (only if needed): approved first-party media and compliant YouTube player adapter.

Integration:
- Load lazily through prep-loader.js only when the feature is enabled.
- Reuse PREP._host, existing prep.js action forwarding conventions and established back/leave lifecycle.
- Reuse existing bank loaders, IndexedDB prep-bank cache, prep-lessons.js, prep-cards.js, prep-tools.js, prep-plan.js and specialty-core.js/FSRS-6 as appropriate.
- Pause media and release player resources on navigation, backgrounding or session exit.
- No duplicate auth, profile, question, bookmark, notes, mistake or FSRS stores.

Candidate data contract (versioned; refine after audit):
{ id, kind, exam[], subject, module, topicIds[], difficulty?, durationSec?, language, title, summary?, questionId?, lessonId?, media: { provider: "first_party" | "youtube", assetId?, videoId? }, rightsStatus, clinicalReview: { status, reviewedAt?, reviewerRole? }, sourceRefs[], tags[], updatedAt }

Do not put API keys, user tokens, private creator data or personal data in public feed manifests. Validate every record at build/publish time and again at the serving boundary. Treat third-party metadata and transcripts as untrusted content, never as instructions.

## 11. State, privacy and sync

- Use the existing PrepNucleus local store and opt-in sync map where appropriate; do not create a new identity layer.
- Persist only what is needed: session position, dismissed/saved content, explicit preferences, and learning outcomes already recorded by PrepNucleus.
- Do not store YouTube or other platform credentials.
- Do not collect contacts, social graph, watch history or unrelated browsing data.
- Clearly disclose analytics and obtain required consent; support data export/deletion through existing PrepNucleus controls.
- Keep feed personalisation explainable: "Shown because this topic is due / you missed a related question / it matches your exam."
- Provide controls to reset feed preferences independently of learning progress.

## 12. Ethical engagement rules

MediGram must not reproduce harmful infinite-scroll mechanics.

- Finite sessions, visible progress and clear stopping points.
- No autoplay into an endless sequence by default.
- No guilt, shame, fake urgency, manipulative streak loss, fear-based notifications or punitive reminders.
- No public ranking based on time spent, video views or swipes.
- Notifications off by default for MediGram-specific engagement prompts; use existing reminder preferences and digest limits.
- Break timer is a user aid, not a lock or punishment.
- Do not deliberately make it difficult to leave, pause or switch back to the main question bank.
- Accessibility and reduced-motion preferences apply throughout.

## 13. Feature flags and rollout

Proposed flag: smd_prep_medigram, default OFF. It requires smd_prep; no other feature should depend on it. Keep a kill switch and ensure existing PrepNucleus screens work unchanged when the flag is off or the module fails to load.

### Phase 0 — Product and policy validation
- Audit current PrepNucleus code, flags, module loader, lesson/video assets, media hosting, sync, analytics and YouTube policy requirements.
- Confirm target exam profiles, languages, content rights and clinical-review workflow.
- Produce UX prototype and synthetic fixtures.
- No paid generation or third-party API calls before an explicit cost/quota estimate and owner approval.

Exit: reviewed specification, architecture note, policy checklist and clickable prototype.

### Phase 1 — First-party MVP (no YouTube dependency)
- Add flag-gated vertical feed using existing MCQs and lessons.
- Implement Study mode, 3:1 pilot cadence, immediate explanations, save, skip, "I don't understand", finite missions and Finish session.
- Add deterministic ranking from due reviews, mistakes, exam profile and timetable.
- Support offline questions and already-bundled/cached eligible first-party media.
- Add accessible controls, loading/error/empty states and telemetry for learning outcomes.

Exit: unit and headless UI tests pass; no regression when flag off; feed works offline for cached content; no ungrounded questions; session can always be exited.

### Phase 2 — Clinical Discovery and compliant video sources
- Add curated first-party/commissioned micro-videos and clinical discovery categories.
- Add optional YouTube public-video discovery and official embedded-player adapter only after policy review.
- Add captions, creator/source labels, report action and editorial status.
- Keep third-party playback optional; feed remains useful without network or YouTube.

Exit: policy/legal review, player compliance tests, content rights audit, removal/correction workflow.

### Phase 3 — Adaptive remediation and memory loop
- Personalise based on actual answers, mistake tags and FSRS due state.
- Add post-video retrieval checks and delayed recall through existing FSRS.
- Add concept explanation/diagram flow through MaiK with grounding and existing safety checks.
- A/B test 2:1, 3:1 and 5:1 cadence.

Exit: pilot demonstrates improved delayed recall or exam performance without increasing unproductive time.

### Phase 4 — Creator ecosystem and scale
- Invite-only creator portal, verification, review queues, rights management, versioning and analytics.
- Expand languages and speciality-specific feeds.
- Add carefully controlled Smart Break content after the Study Feed proves educational value.

Exit: editorial operations, moderation, creator rights and correction SLA are staffed and tested.

## 14. Measurement and experiment design

**Primary metrics**
- 7-day and 30-day delayed recall on concepts encountered in MediGram.
- Change in matched mock-test performance versus baseline/control.
- Correct answers per minute of active retrieval.
- Proportion of video exposures followed by a correct retrieval check.
- Mission completion with actual learning actions.

**Secondary metrics**
- Session start rate and voluntary return rate.
- Saved content later revised.
- "I don't understand" resolution rate.
- Offline success, crash-free sessions and feed load time.
- Break-to-study return rate, measured only with transparent consent.

**Guardrail metrics**
- Total session duration and unplanned overrun.
- Passive video minutes without retrieval.
- Incorrect/disputed content exposure.
- User-reported distraction, pressure or guilt.
- Battery/data usage and accessibility failures.

Pilot: recruit a small, diverse group of adult learners across exam types. Compare traditional PrepNucleus practice with MediGram-enabled sessions using matched topics and baseline ability. Pre-register the primary outcome and analysis. Do not claim causation from engagement analytics alone. Expand only if learning outcomes improve and guardrails remain acceptable.

## 15. Testing requirements

Pure unit tests:
- candidate eligibility and ranking;
- due-review prioritisation;
- cadence sequencing and finite session completion;
- duplicate prevention and stable item IDs;
- no disputed/hidden question exposure;
- FSRS is updated only after valid recall/grade actions;
- mode switching and break timer behaviour;
- content review, rights and expiry gates;
- safe handling of missing/offline media and malformed third-party metadata.

Headless UI tests:
- open MediGram from PrepNucleus;
- answer three MCQs, view a related lesson, complete retrieval check;
- save, skip, report and "I don't understand";
- finish session and return to the exact prior screen;
- switch Study / Clinical / Break;
- timer expiry offers return but does not trap or shame the user;
- back, close, app background and player cleanup;
- dark/light theme, reduced motion, keyboard and screen-reader labels;
- feature flag OFF leaves existing PrepNucleus unchanged;
- network unavailable, API quota exhausted, video unavailable and YouTube embed disabled all degrade gracefully.

No test should require real YouTube playback or a live paid AI call; use deterministic fixtures and mocked adapters.

## 16. Open owner decisions before implementation

**Owner decisions, 2026-10-31:**
1. **UI name: PrepReels** (MediGram stays the internal/plan name; flag stays `smd_prep_medigram`).
2. **v1 modes: all three** (Study Feed, Clinical Discovery, Smart Break). Each mode gets its own sub-flag so one can be switched off without the others; Study Feed is the default and the only one on until the others pass their content-review gate. Risk noted: Smart Break is the highest distraction risk, so it keeps the section 3.3 limits (3 or 5 minutes, user-chosen, no autoplay chain, no lock).
3. **Video sources: own micro-lessons plus official YouTube embeds.** YouTube stays behind the section 7 policy review and the Phase 2 gate; the feed must work with YouTube disabled.
4. **Languages for the first video set: English, Hindi and one regional language.** The regional language is **Telugu** (owner, 2026-10-31); each language needs its own captions and clinical reviewer before it ships.
5. **Budget: free tier only, no paid media.** YouTube API stays inside the free quota, and videos are built from existing lesson assets. Any paid media or quota needs a new owner yes.
6. **Pilot: 30 learners, 4 weeks**, matched topics against normal PrepNucleus practice; primary outcome is 7-day delayed recall on concepts met in PrepReels, pre-registered before the pilot starts. A 30-day recall check and mock-test comparison are secondary.
7. Nothing is open for the owner before Phase 0 starts.

## 17. Definition of done

MediGram is ready for a limited release only when:
- it is an optional, flag-gated part of PrepNucleus;
- the existing bank, lesson and FSRS systems are reused;
- every feed item has a valid source, rights status and required clinical review;
- video exposure is followed by retrieval opportunities;
- the user can always stop, leave or return to normal study;
- the app does not scrape or clone YouTube's personalised Shorts feed;
- privacy, accessibility, offline and failure states are tested;
- pilot data supports improved learning, not merely more screen time.

**Product principle:** MediGram should make starting and continuing meaningful learning easier. It must never measure success by how long it can keep a student scrolling.
