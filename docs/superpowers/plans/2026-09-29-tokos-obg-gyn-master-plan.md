# Tokós 2.0: Obstetrics and Gynaecology Module, Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase by phase. This is a master plan: it covers several independent subsystems, so each phase gets its own executable plan (bite-sized, test-first steps with code) written at the start of that phase from the phase section below, then executed with a task review after every unit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tokós from a single CTG trainer into the complete Obstetrics and Gynaecology learning and practice module for MBBS students, interns and OBG residents in India, at a standard above Ophthalmós ("20/10").

**Architecture:** Extract a shared **specialty engine** (shell, Learn, question bank, explorers, tools, notes, spaced repetition, levels and trials) from Ophthalmós into host-agnostic files, without changing Ophthalmós. Tokós becomes the engine's first host; its CTG clinic becomes a registered clinic plugin. Obstetric and gynaecology content, clinics, simulators, drills, calculators and OSCE stations are added as data packs and plugins on that engine. Future specialty modules (Paediatrics, Anaesthesia, Orthopaedics, ENT) reuse the same engine.

**Tech Stack:** ES5 IIFEs (host convention), buildless, `?v=` cache tokens, `scripts/build-www.sh`; Node `--test`; headless Chrome via CDP for UI tests; Node-only build pipelines under `tools/` (never shipped, 404 on the web); content as JSON validated by schema tests.

**Spec:** This document is the spec for the whole programme. The CTG clinic spec it builds on is `docs/superpowers/plans/2026-09-29-tokos-obgyn-ctg-clinic-v2.md`. Dataset licence findings: `~/.claude/projects/-Users-diwakarkumar/memory/specialty-module-dataset-licenses.md`. Module notes: `vault/modules/Tokós.md`, `vault/modules/Ophthalmós.md`, `vault/modules/Review Desk.md`, `vault/modules/CliniX.md`.

---

## 1. What "20/10" means (acceptance bar for the whole programme)

The module ships when every line below is true and evidenced (test output, count, or reviewer sign-off):

1. **Syllabus coverage.** At least 90% of the NMC CBME Obstetrics and Gynaecology (OG) competencies map to a lesson, tool, drill or OSCE station, checked against the NMC competency document itself (Phase 2, Task 2.1), not from memory. The mapping file lists every competency code and its Tokós item, and the gaps.
2. **Learn.** At least 180 lessons in 40 units (Obstetrics and Gynaecology, MBBS and Resident), English and Hindi, each with an idea, a picture (real licence-clear image or original diagram), why, what to spot, what to do, a remember line, a check and a link to practice. Ophthalmós has 107.
3. **Question bank.** Every usable Obstetrics and Gynaecology question from MedMCQA (MIT) after de-duplication, tagged by subtopic and difficulty, with explanations, doubtful-key flags, study sets and a timed exam. MBBS sees easy and medium; Resident sees all.
4. **Real-data clinics.** At least 3 reading clinics on licence-clear real data: CTG (existing, extended), fetal ultrasound standard planes, fetal head biometry. Gynaecology clinics only where a licence is verified (Phase 4, Task 4.4); otherwise original illustrations.
5. **Simulators and drills.** At least 10: labour room, mechanism of labour, PPH, eclampsia, shoulder dystocia, breech and twin delivery steps (Resident), menstrual cycle, AUB PALM-COEIN, POP-Q, ovarian mass triage.
6. **Calculators.** At least 12, each showing its rule, its source, and a worked example that the unit test pins.
7. **OSCE and viva.** At least 10 stations on the CliniX skill engine (obstetric history, examination in pregnancy, gynaecological history, speculum and bimanual examination steps, counselling stations), with an AI patient where CliniX supports it.
8. **Two real levels.** MBBS and Resident differ in content, not just in locks: Resident units, Resident drills, the action and management questions, the timed exam. Resident is Pro with one free trial per feature; locked items stay visible.
9. **Every clinical claim is sourced and reviewable.** Each lesson, drill, tool and case cites its source, carries `review: ai_drafted` until approved, and appears in the in-app Review Desk. Approved items drop their "rule-based, pending review" mark. Zero fabricated clinical data.
10. **Design.** Every screen passes the owner's UI skills finish gate (`anti-ui-slop`, `web-design-guidelines`) and follows `ui-ux-pro-max`, `impeccable`, `taste-skill`, `emil-design-eng` while built. WCAG AA contrast in both themes, keyboard and screen-reader usable, 44 px targets, reduced motion respected, clinical numerals in ASCII in Hindi.
11. **Performance.** Tokós code and content load lazily on first open, not at app boot. Cold open to hub under 1.5 s and a lesson under 300 ms on a mid-range Android (measured with the argent profiler or Chrome trace, numbers recorded in the vault).
12. **Tests.** Unit tests for every pure function and schema, a headless UI test per feature, all in CI (`.github/workflows/tokos-ui.yml` extended), full `npm test` green.

## 2. Audience and levels

| Level | Who | What Tokós gives them |
|---|---|---|
| MBBS | 3rd-year and final-year students, interns | NMC OG competencies, NEET-PG and NExT style questions, core clinics, core drills, calculators, OSCE stations |
| Resident | MS/DNB OBG residents, junior consultants | Resident units (high-risk obstetrics, fetal medicine, reproductive medicine, gynae oncology, urogynaecology, endoscopy), Resident drills, management and action questions, full question bank, timed exam |

Levels, trials and Pro follow the owner decisions already in Ophthalmós and Tokós 1.0: MBBS free, Resident is Pro with one free trial per feature, locked items visible. English and Hindi everywhere; the learner chooses Learn or Test on first open, then the last tab opens.

## 3. What already exists (reuse, do not rebuild)

| Existing | Use in Tokós 2.0 |
|---|---|
| Tokós 1.0 CTG clinic (`tokos*.js`, `tokos/`, 12 CTU-UHB cases, FIGO checklist, calipers, Review Desk source) | Becomes the engine's first clinic plugin (Phase 0) and is extended (Phase 4) |
| Ophthalmós engine files (`ophthalmos-*.js`) | Source for the specialty engine extraction (Phase 0); Ophthalmós itself is not modified |
| Review Desk (`review-desk.js`, `scripts/apply-reviews.mjs`) | Every Tokós content type gets a Review Desk source (Phase 8, plus one per phase as content lands) |
| Clinical Protocols (PPH, pre-eclampsia and eclampsia India protocols in `kb/clinical-protocols/`) | Drills and lessons link to them; drills reuse their dosing tables where they are already reviewed |
| Specialty Kits, O&G kit | Lessons link "use it in the OPD" to the kit |
| Gynae oncology regimens (`docs/superpowers/onco-protocols-v2/gyn-*.json`) and the Oncology module | Resident gynae oncology lessons link to them |
| CliniX skill engine (Learn, Bedside, Case, OSCE, Viva projections; AI patient) | OSCE and viva stations (Phase 7) are CliniX skill packs, not a new engine |
| Dose Calculator, Insulin module | Linked from the MgSO4, anti-D, iron and GDM tools where relevant |
| MaiK (`SMD_askMaik`) | "Ask MaiK" after every case and lesson, as in Ophthalmós |

## 4. Architecture decision: the specialty engine

**Ruling (reverses the "duplicate until a third specialty" decision logged for Tokós 1.0):** Tokós 2.0 needs the whole Ophthalmós engine (about 3,000 lines of shell, Learn, bank, explorers, tools), not the 250 lines duplicated in 1.0, and the roadmap already names four more specialty modules. Copying the engine per specialty would multiply every future fix by six. Extract it once. Log this in `vault/decisions/Decisions.md` in Phase 0.

**Constraints:**
- Ophthalmós files stay byte-identical to the `drmanojkurmana/ophthalmos` repo (enforced by `test/ophthalmos-sync.json`). The engine is a new set of files; Ophthalmós may migrate onto it later in its own repo (out of scope here).
- ES5 IIFE, no new runtime dependency, no bundler.

**Engine files (new):**

| File | Extracted from | Responsibility |
|---|---|---|
| `specialty-core.js` | `ophthalmos-core.js` | FSRS-6, sessions, stats (verbatim logic, renamed global `SPECIALTY_CORE`) |
| `specialty-data.js` | `ophthalmos-data.js` | Levels, access, trials, persistence, Learn schema helpers, keyed by host config |
| `specialty-stage.js` | `ophthalmos-stage.js` | Pinch-zoom (verbatim, `SPECIALTY_STAGE`) |
| `specialty-shell.js` | `ophthalmos.js` + `ophthalmos-screens.js` | `SPECIALTY.createHost(cfg)` returns a host with `open/close/back/isOpen`, `_st`, `_internal` (ACTIONS, KEYS, imgUrl, track), registries `_clinics`, `_sims`, `_banks`, `_tools`, `_reads`, `_explore`, Today's plan, stats, sources, Ask MaiK, Learn/Test tabs |
| `specialty-learn.js` | `ophthalmos-learn.js` | `SPECIALTY.features.learn(host)` |
| `specialty-bank.js` | `ophthalmos-mcq.js` | `SPECIALTY.features.bank(host, cfg)` |
| `specialty-explore.js` | `ophthalmos-explore.js` (host part only) | `SPECIALTY.features.explore(host)`; the explorer models stay per specialty |
| `specialty-tools.js` | `ophthalmos-tools.js` (UI part) | `SPECIALTY.features.tools(host)`; calculator models stay per specialty |
| `specialty-notes.js` | `ophthalmos-notes.js` | `SPECIALTY.features.notes(host)` |
| `specialty-*.css` | the matching Ophthalmós CSS | Scoped under a host root class, colour tokens per host |

**Host config (Tokós):**
```js
SPECIALTY.createHost({
  id: "tokos", global: "TOKOS", base: "/tokos/", rootId: "smdTokos", rootClass: "tok-root",
  storeKey: "smd_tokos_v1", prefKey: "smd_tokos_prefs", flag: "smd_tokos",
  title: { en: "Tokós", hi: "टोकोस" }, subtitle: { en: "Obstetrics and Gynaecology", hi: "प्रसूति एवं स्त्री रोग" },
  levels: { free: ["mbbs"] }, proFeature: "tokos"
});
```

**Mapping rule for the extraction:** every `G.OPHTHALMOS` read becomes the `host` argument; every `G.OPHTHALMOS_CORE/DATA/STAGE` becomes `SPECIALTY_CORE/DATA/STAGE`; every `/ophthalmos/` path and `smd_ophthalmos*` key comes from `cfg`; every eye-specific string moves to the host's content (`tokos/strings.json`). A grep for `ophthalmos` (case-insensitive) in `specialty-*.js` must return nothing; a unit test enforces it.

**Lazy loading:** `home.js` loads only a 2 KB `tokos-loader.js` at boot; the engine and Tokós files load on first open (script injection with the same `?v=` tokens), then `TOKOS.open()`. Ophthalmós keeps its current eager load until it migrates.

---

## 5. The syllabus (content map)

Unit and lesson counts are targets; Phase 2, Task 2.1 locks them against the NMC competency list. Each lesson follows the existing Learn schema (idea, see, why, spot, todo, remember, check, test, deeper, glossary, sources, review).

### Obstetrics, MBBS (12 units, about 62 lessons)
1. Physiology of pregnancy and diagnosis of pregnancy
2. Antenatal care and screening (Indian schedule: PMSMA, investigations, IFA and calcium, Td, ultrasound schedule)
3. Normal labour: stages, mechanism, monitoring, labour care guide style chart
4. Puerperium, breastfeeding, postpartum contraception
5. Hypertensive disorders: pre-eclampsia, eclampsia, HELLP
6. Haemorrhage: antepartum (previa, abruption) and postpartum (4 Ts)
7. Anaemia and medical disorders: GDM, heart disease, thyroid, HIV, hepatitis B, syphilis
8. Preterm labour, PROM, post-term pregnancy
9. Rh isoimmunisation, multiple pregnancy, malpresentations and breech
10. Obstetric procedures: episiotomy, instrumental delivery, caesarean section, MTP Act
11. Early pregnancy: miscarriage, ectopic pregnancy, gestational trophoblastic disease
12. Fetal surveillance: CTG (links the CTG clinic), BPP, Doppler basics

### Obstetrics, Resident (8 units, about 34 lessons)
1. Fetal growth restriction and Doppler-based management
2. Twins and their complications (TTTS, selective FGR)
3. Placenta accreta spectrum and massive obstetric haemorrhage
4. Maternal collapse, sepsis, amniotic fluid embolism
5. VBAC/TOLAC and operative obstetrics complications
6. Cardiac and other high-risk pregnancy
7. Fetal medicine and prenatal screening (NT, combined test, NIPT, anomaly scan; PCPNDT Act)
8. Preterm birth prevention (progesterone, cerclage) and maternal mortality review in India (MDSR)

### Gynaecology, MBBS (12 units, about 58 lessons)
1. Anatomy and development, Mullerian anomalies
2. Menstrual physiology; AUB (PALM-COEIN); amenorrhoea
3. PCOS
4. Genital infections, STIs, PID, syndromic management (NACO)
5. Fibroids, endometriosis, adenomyosis
6. Pelvic organ prolapse and urinary incontinence
7. Infertility: basic evaluation and management
8. Contraception and the national family planning programme
9. Menopause and HRT
10. Cervical cancer screening (VIA, Pap, HPV) and HPV vaccination
11. Benign ovarian tumours and ovarian mass triage
12. Gynaecological cancers: cervix, endometrium, ovary (FIGO staging basics)

### Gynaecology, Resident (8 units, about 34 lessons)
1. Assisted reproduction (IUI, IVF, OHSS) and the ART Act 2021
2. Reproductive endocrinology (hyperprolactinaemia, POI, adolescent gynaecology)
3. Endometriosis: medical and surgical management
4. Urogynaecology and POP-Q based surgical choice
5. Gynae oncology management (links the Oncology gyn regimens)
6. Minimal access surgery: laparoscopy and hysteroscopy principles and complications
7. Pregnancy of unknown location and early pregnancy unit management
8. Medico-legal: MTP Amendment 2021, consent, POCSO in gynaecology

**Total target:** 40 units, about 188 lessons.

---

## 6. Data and licence register

| Source | Use | Licence | Status |
|---|---|---|---|
| CTU-UHB intrapartum CTG (PhysioNet) | CTG clinic | ODC-BY 1.0 | Verified 2026-09-28 |
| FETAL_PLANES_DB (Zenodo 3904280) | Fetal planes clinic | CC BY 4.0 | Verified 2026-09-28 |
| HC18 (Zenodo 1322001) | Head circumference biometry clinic | CC BY 4.0 | Verified 2026-09-28 |
| MedMCQA ("Gynaecology & Obstetrics" subject) | Question bank | MIT | Used by Ophthalmós; re-check the repo licence file in Task 1.1 |
| US MEC for Contraceptive Use 2024 (CDC) | Contraception eligibility tool | US federal work, public domain | Verify in Task 6.5; note where Indian practice follows WHO MEC |
| WHO Labour Care Guide, WHO growth and MEC charts | Not reproduced | CC BY-NC-SA 3.0 IGO | Blocked: original logic and art only |
| Cervical cytology (SIPaKMeD, Herlev), colposcopy (IARC atlas), pelvic ultrasound sets | Candidate gyn clinics | Unknown | Task 4.4 verifies; use only CC0, CC BY, ODC-BY or public domain |
| Published formulas (Naegele, Robinson CRL, Hadlock EFW and HC, Ganzoni, RMI, MFMU VBAC 2021, DIPSI) | Calculators | Facts and published equations | Each tool cites the paper; the executor verifies every coefficient against the source |
| Original diagrams and animations (SVG, no text in the image) | Learn, explorers, drills | Original, MAIKNOWLEDGE LLP | Same pipeline as Ophthalmós Learn |

Rule: no image, chart or table from a non-permissive source is copied, traced or "recreated". Every media item has a `credits.json` entry.

---

## 7. Phases

Order is by value to learners first and by dependency. Content phases (2, 3, 7) run as parallel subagents per unit, the way Ophthalmós Learn was built, after the engine exists. Every phase ends with a task review per unit, a whole-phase review, a merged PR, and its items in Review Desk.

### Phase 0: Specialty engine and Tokós on it (foundation)
**Deliverable:** the engine files of Section 4, Tokós running on them with Learn and Test tabs, the CTG clinic as a plugin, lazy loading.
- Task 0.1: Port Ophthalmós's unit tests (`core`, `data`, `levels`, `learn`, `mcq`, `explore`, `tools`, `notes`, `stage`) to run against the engine with a fixture specialty (`test/fixtures/specialty-fixture/`). Red first.
- Task 0.2: `specialty-core.js`, `specialty-data.js`, `specialty-stage.js` (verbatim logic, renamed; host-keyed storage). Tests green.
- Task 0.3: `specialty-shell.js` with `createHost(cfg)`; registries; Learn/Test tabs; first-run choice; Today's plan; stats; sources; Ask MaiK; layered back; flag gating. UI test on the fixture host.
- Task 0.4: `specialty-learn.js`, `specialty-bank.js`, `specialty-explore.js`, `specialty-tools.js`, `specialty-notes.js` and their CSS, host-scoped. The "no ophthalmos in engine files" test.
- Task 0.5: Tokós host config; the CTG clinic re-registered as `host._clinics` plugin (its checklist, calipers, reveal, review banner unchanged; its existing tests keep passing); `tokos-core/data/stage.js` removed in favour of the engine (their tests move to the engine).
- Task 0.6: Lazy loader (`tokos-loader.js`), `index.html` and `build-www.sh` changes, `sw.js` check; boot-cost measurement before and after.
- Task 0.7: Vault: `vault/modules/Specialty Engine.md`, update `Tokós.md`, Decisions entry.
**Acceptance:** all ported tests green; Tokós CTG behaves exactly as in 1.0 (its UI tests unchanged and green); Ophthalmós untouched (sync test green); boot no longer loads Tokós code.

### Phase 1: Question bank and first calculators (fast value)
- Task 1.1: `tools/tokos-build-mcq.mjs` (port of the Ophthalmós `build_mcq.py` approach to Node): pull MedMCQA, keep `subject_name == "Gynaecology & Obstetrics"`, clean, de-duplicate, map `topic_name` into a Tokós subtopic taxonomy (Obstetrics: antenatal, labour, medical disorders, haemorrhage, hypertension, fetal medicine, puerperium, early pregnancy, operative; Gynaecology: menstrual, infections, benign tumours, oncology, infertility and endocrinology, contraception, urogynaecology, anatomy). Record the MedMCQA licence file and commit hash.
- Task 1.2: Difficulty tagging (port `tag_difficulty.mjs`), doubtful-key heuristics and a "flag this key" action that feeds Review Desk.
- Task 1.3: Bank registered on the engine: study sets by subtopic, MBBS/Resident pools, timed exam (Pro), search, spaced repetition.
- Task 1.4: Calculators batch 1 (6): EDD and gestational age (Naegele and CRL-based dating), Bishop score, magnesium sulphate regimens (Pritchard, Zuspan) with toxicity checks, anti-D dose, GDM by DIPSI, Apgar. Each: pure model file with tests pinning a worked example from the cited source.
**Acceptance:** bank counts reported by subtopic and level; every calculator's example matches its source; Review Desk lists the calculators.

### Phase 2: Learn, Obstetrics MBBS
- Task 2.1: Get the NMC CBME OG competency document (PDF via the docling pipeline), extract all competency codes, write `tokos/learn/competencies.json`, and lock the unit and lesson list against it. Output the coverage table.
- Task 2.2: Glossary seed (EN and HI) and the diagram style sheet for obstetric anatomy (original SVG, no text in images).
- Tasks 2.3 to 2.14: one per Obstetrics MBBS unit (Section 5), each a subagent: lessons, diagrams, checks, links to bank subtopics, clinics, drills, protocols and kits, sources, Hindi.
- Task 2.15: Integration: `index.json`, glossary union, content tests, Review Desk source for lessons, screenshots.
**Acceptance:** schema and content tests green; every lesson has sources and a Review Desk entry; the coverage table shows each unit's competencies.

### Phase 3: Learn, Gynaecology MBBS
Same shape as Phase 2 for the 12 Gynaecology MBBS units, sharing the glossary and diagram style.

### Phase 4: Clinics on real data
- Task 4.1: Fetal ultrasound planes clinic: `tools/tokos-fetal-planes.mjs` builds a deck from FETAL_PLANES_DB (plane labels as ground truth; MBBS groups brain planes, Resident separates transthalamic, transcerebellar and transventricular), WebP images to R2 (`tokos-img` bucket, same pattern as Ophthalmós), credits.
- Task 4.2: Head biometry clinic on HC18: the learner fits an ellipse on the skull outline; the app computes HC and compares with the annotation; gestational age from HC by the cited formula (Hadlock), with the tolerance stated.
- Task 4.3: CTG clinic extension: scan all 552 CTU-UHB records (not the first 90) for the missing archetypes (tachysystole, reduced variability, sinusoidal-like patterns), add cases that pass the strip-quality gate, keep labels rule-based until reviewed.
- Task 4.4: Gynaecology image licence check (cytology, colposcopy, pelvic ultrasound candidates). Build a gyn clinic only on a verified permissive licence; otherwise record the finding and move those topics to explorers.
**Acceptance:** each clinic has attribution, a quality gate, MBBS and Resident class sets, Review Desk entries, UI tests.

### Phase 5: Obstetric simulators and drills
- Task 5.1: Labour room simulator. A labour progression model (cervical dilatation, station, contractions, FHR state) driven by published labour-progress data (cite the source; the executor verifies the numbers), with decisions (observe, amniotomy, oxytocin, analgesia, instrumental, caesarean) and consequences. Original chart art in the labour care guide style; no WHO artwork.
- Task 5.2: Mechanism of labour explorer (cardinal movements, positions, station; original SVG animation).
- Task 5.3: PPH drill (timed): recognition, call for help, uterotonics and tranexamic acid with doses from the app's reviewed PPH protocol, 4 Ts, bimanual compression, balloon tamponade, escalation.
- Task 5.4: Eclampsia drill: airway and positioning, magnesium sulphate loading and maintenance, toxicity monitoring, blood pressure control, delivery planning.
- Task 5.5: Shoulder dystocia drill: sequence and timing of manoeuvres, documentation.
- Task 5.6: Resident drills: breech delivery steps, twin delivery, maternal collapse.
**Acceptance:** each drill scores against a stated checklist from its cited protocol, records attempts in spaced repetition, and is in Review Desk; the labour model has unit tests for its progression and every decision branch.

### Phase 6: Gynaecology tools and explorers
- Task 6.1: Menstrual cycle hormone explorer (FSH, LH, oestradiol, progesterone, endometrium, follicle), original art.
- Task 6.2: AUB PALM-COEIN classifier (case vignettes, classify, feedback).
- Task 6.3: POP-Q explorer: set the nine points, see the stage.
- Task 6.4: Ovarian mass triage (IOTA simple rules and RMI calculator, with the cited definitions; description-based, no copied images).
- Task 6.5: Contraception eligibility tool from US MEC 2024 (public domain), with a note where Indian practice follows WHO MEC.
- Task 6.6: Cervical screening pathway (VIA, Pap, HPV) per the current Indian guideline; the executor cites the version used.
- Task 6.7: Calculators batch 2 (6): Hadlock EFW, IOM weight gain, VBAC (MFMU 2021), IV iron (Ganzoni), RMI, MEOWS (cite the chart variant).
**Acceptance:** each tool shows rule and source, has pinned-example tests, and is in Review Desk.

### Phase 7: Resident content, OSCE and viva
- Tasks 7.1 to 7.16: the 16 Resident units (Section 5), one subagent each, Resident-only checks and management questions.
- Task 7.17: OSCE and viva stations as CliniX skill packs: obstetric history, examination in pregnancy (Leopold manoeuvres), gynaecological history, speculum and bimanual steps, breaking bad news (stillbirth), contraception counselling, consent for caesarean section, PPH team station, eclampsia team station, cervical screening counselling. AI patient where CliniX supports it.
- Task 7.18: Resident access wiring (Pro, one trial per feature id: `learn.resident`, `bank.resident`, `exam`, `drill.<id>`, `clinic.<id>`).
**Acceptance:** Resident and MBBS differ in every tab; trial ids tested; OSCE stations score with rubrics.

### Phase 8: Integration, review and launch quality
- Task 8.1: Review Desk sources for every content type (lessons, bank key flags, clinics, drills, tools, OSCE stations); `apply-reviews.mjs` handles each.
- Task 8.2: Cross-links: lessons to protocols, kits, oncology regimens, dose calculator, insulin; "one patient" threads (GDM mother to CTG to newborn, hook for the Paediatrics module).
- Task 8.3: Performance pass (lazy loading per feature, image sizes, the 1.5 s and 300 ms budgets measured on a device).
- Task 8.4: Accessibility and design audit of every screen with the owner's UI skills; screenshots EN and HI, dark and paper.
- Task 8.5: Full test sweep, CI workflow update, vault docs, native rebuild or OTA.
**Acceptance:** Section 1 checked line by line with evidence.

---

## 8. Global Constraints (bind every phase)

- No em-dash in any app text or docs. ES5 IIFE client code. Buildless.
- No fabricated clinical data. Vignettes, cases and outcomes come from real datasets or are clearly marked teaching scenarios; drug doses come from the app's reviewed protocols or a cited guideline, never from memory.
- Every media item is licence-clear and credited; blocked sources are never recreated.
- All content `review: ai_drafted` until approved in Review Desk; screens show "rule-based" or "draft" marks until then. Tokós stays ON for all users during testing (owner decision 2026-09-29).
- Ophthalmós files are not modified in StewardMD (sync test).
- Hindi strings go on the Hindi review list; clinical numerals stay ASCII.
- Owner UI skills are mandatory for every screen, and every subagent doing UI work is told to load them.
- Before exploring code, query `graphify-out/graph.json` (`graphify query`), and tell every subagent to do the same.
- Test before build: unit and UI tests per feature; full flagged `npm test` before each merge.

## 9. Review Focus (inputs most likely to hurt a learner)

1. **A drug dose or threshold that is wrong or out of date** (magnesium sulphate, uterotonics, anti-D, iron). Every dose has a source field and a unit test pinning it to the cited value; doses are read from the reviewed protocol files where they exist.
2. **An image or table from a non-permissive source slipping in** through a content subagent. The media test fails any file without a `credits.json` entry with a permitted licence.
3. **A Resident-only item leaking to MBBS or a spent trial still opening content.** Trial and level tests per feature id, including "no fetch on a spent trial".
4. **Hindi screens with English fragments or translated numerals.** The Hindi UI test checks every screen type for Devanagari digits and untranslated labels.
5. **Boot cost for users who never open Tokós.** A test asserts no Tokós engine file is requested at app boot.

## 10. Risks and decisions for the owner

| Item | Recommendation |
|---|---|
| Name: "Tokós" means childbirth, while the module now covers gynaecology too | Keep "Tokós" (already shipped) with the subtitle "Obstetrics and Gynaecology"; alternative names can be decided later without code impact |
| Clinical reviewers | One obstetrician for Phases 2, 4, 5 and one gynaecologist for Phases 3, 6, reviewing in Review Desk as each phase lands |
| Gynaecology real-image clinics | Depend on Task 4.4 licence findings; explorers cover those topics if no licence is clear |
| NMC competency document | Needs the official PDF (Task 2.1); if only an outdated version is available, the mapping says which |
| Ophthalmós migration onto the engine | Later, in the ophthalmos repo, once the engine has run Tokós for a release |

## 11. Execution

- Method: subagent-driven, as for Tokós 1.0: one implementer per unit, a task review after each unit, a whole-phase review, fixes, then a PR per phase merged when green.
- Parallelism: Phases 2, 3 and 7 fan out one subagent per unit after Phase 0 lands; Phases 4, 5 and 6 can run in parallel with content phases once Phase 0 is merged, each in its own worktree and branch.
- Each phase starts by writing its executable plan file `docs/superpowers/plans/<date>-tokos-phase-<n>.md` from its section here.
