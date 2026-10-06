# Narkē: Anaesthesia Module, Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Master plan: each phase below is executed by subagents in isolated worktrees with a task review after every unit, then a whole-phase review. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The complete Anaesthesiology learning and practice module for MBBS students, interns and anaesthesia residents in India, built as the second host on the specialty engine, at the Tokós standard.

**Name:** Narkē (Greek νάρκη, numbness; the root of "narcosis"), id `narke`, subtitle "Anaesthesia" / "एनेस्थीसिया". The name lives only in display strings, so the owner can rename it without code impact.

**Architecture:** No engine change. Narkē is a host config (`narke.js`) on `specialty-*.js`, loaded lazily by `narke-loader.js`, with content in `narke/` and models in `narke-models/`. It copies Tokós's host pattern and reuses every engine feature (Learn, bank, explorers, tools, drills, notes). The only shared-code changes are generalisations a second host needs: the Review Desk specialty tab, `apply-reviews.mjs` targets, the build tools' host arguments, and the drill core's global name.

**Tech stack:** ES5 IIFE, buildless, `?v=` tokens, `scripts/build-www.sh`; Node `--test`; headless Chrome UI tests; Node build tools under `tools/` (never shipped).

**Inputs:** NMC CBME Curriculum 2024 (No. D-11011/500/2024-AcademicCell, 12-09-2024, the document Tokós uses), Anaesthesiology AS1.1 to AS11.6, 52 competencies in 11 topics; AS11 (oxygen delivery, oxygen therapy and airway management) is new since the 2018 Vol III (46 competencies), whose AS1 to AS10 codes are unchanged. Extracted to `narke/learn/competencies.json`. Reviewed protocols already in `kb/clinical-protocols/`: adult and paediatric cardiac arrest, post-cardiac-arrest care, anaphylaxis, local anaesthetic systemic toxicity, malignant hyperthermia, blood transfusion, sepsis and septic shock, ICU sedation-analgesia-delirium, status epilepticus, neonatal resuscitation. OPD kit `kb/specialty-kits/src/anaesthesia.json` exists (linked, ids kept distinct).

---

## 1. Acceptance bar

1. **Coverage:** all 52 NMC AS competencies map to a lesson, tool, drill or OSCE station; `narke/learn/competencies.json` plus a coverage report with zero gaps.
2. **Learn:** at least 80 lessons in 19 units (11 MBBS on AS1 to AS11, 8 Resident), English and Hindi, Learn schema (idea, see, why, spot, todo, remember, check, test, sources, review).
3. **Bank:** all 3,206 MedMCQA Anaesthesia questions (train 3,172 + dev 34, no duplicates, 3,106 with explanations), tagged into a Narkē subtopic taxonomy with difficulty, study sets and a timed exam, built the same way as the Tokós bank.
4. **Clinics:** at least 2 reading clinics on synthetic, clearly labelled teaching signals: capnography waveform clinic and monitor (vital signs) clinic. No real-data clinic until a licence is verified (Section 6).
5. **Drills:** at least 10 timed crisis drills, doses from the kb protocols or a cited guideline.
6. **Explorers:** at least 6 interactive explainers.
7. **Calculators:** at least 12, each with rule, source and a pinned example test.
8. **OSCE:** a CliniX `anaesthesia` system with at least 6 stations, deep-linked from Narkē.
9. **Two levels:** MBBS free, Resident Pro with one trial per feature, locked items visible.
10. **Review:** every item `ai_drafted` with sources, listed in Review Desk; "draft" mark on every screen until approved.
11. **Quality:** owner UI skills finish gate on every new screen; WCAG AA; Hindi with ASCII numerals; no em dashes.
12. **Performance and size:** nothing Narkē loads at app boot except the loader; the deployed file count stays under the Pages 20,000 cap (measured in Phase 0 and at every merge).
13. **Tests:** unit tests for every model and schema, headless UI tests, CI workflow, full suite green.

## 2. Levels

| Level | Who | Content |
|---|---|---|
| MBBS | 3rd-year and final-year students, interns | AS1 to AS11 units, core drills (BLS, cardiac arrest, anaphylaxis), calculators, clinics, OSCE |
| Resident | MD/DNB anaesthesia residents | Resident units, crisis drills (difficult airway, LAST, MH, high spinal, laryngospasm, massive haemorrhage), full bank, timed exam |

## 3. Syllabus

### MBBS units (one per NMC topic)
| Unit | NMC topic | Competencies | Lesson themes |
|---|---|---|---|
| as1 | AS1 Anaesthesiology as a specialty | 4 | History, roles, ethics and consent, the anaesthetist in the hospital |
| as2 | AS2 Cardiopulmonary resuscitation | 2 | BLS adult and child, ALS algorithm, post-arrest care |
| as3 | AS3 Preoperative evaluation and medication | 6 | History and examination, airway assessment, ASA status, investigations, fasting, premedication |
| as4 | AS4 General anaesthesia | 7 | Stages and components, induction agents, inhalational agents, muscle relaxants and reversal, airway devices, the machine and circuits, monitoring |
| as5 | AS5 Regional anaesthesia | 6 | Local anaesthetic pharmacology, spinal, epidural, peripheral blocks, complications |
| as6 | AS6 Post-anaesthesia recovery | 3 | PACU care, discharge criteria, common complications (PONV, pain, hypothermia, airway) |
| as7 | AS7 Intensive care management | 5 | ICU admission, oxygen therapy, ventilation basics, sepsis, sedation |
| as8 | AS8 Pain and its management | 5 | Pain physiology, assessment scales, WHO ladder, acute pain, chronic and palliative pain |
| as9 | AS9 Fluids | 4 | Body fluids, crystalloids and colloids, maintenance and deficit, blood and transfusion |
| as10 | AS10 Patient safety | 4 | Checklists, drug errors, equipment checks, positioning and burns, critical incidents |
| as11 | AS11 Oxygen delivery devices, oxygen therapy and airway management (new in 2024) | 6 | Oxygen devices and FiO2, oxygen therapy targets and safety, airway opening, OPA and NPA, BVM, intubation and LMA steps, ventilation basics |

### Resident units
| Unit | Theme |
|---|---|
| asr1 | Advanced airway: difficult airway algorithms, videolaryngoscopy, front of neck access, extubation |
| asr2 | Ultrasound-guided regional anaesthesia: plexus and fascial plane blocks |
| asr3 | Obstetric anaesthesia: labour analgesia, caesarean, failed intubation in pregnancy, PPH |
| asr4 | Paediatric and neonatal anaesthesia |
| asr5 | Cardiac, thoracic and vascular anaesthesia |
| asr6 | Neuroanaesthesia and trauma |
| asr7 | Critical care: ventilation modes, ARDS, shock and vasopressors, ABG |
| asr8 | Perioperative medicine and crisis resource management |

## 4. Features

**Calculators (`narke-models/tool-*.js`, Tokós tool contract):** ASA physical status classifier; Holliday-Segar maintenance fluids; fasting deficit; maximum allowable blood loss; local anaesthetic maximum dose (from the kb LAST protocol); paediatric ETT size and depth; ideal and lean body weight with drug dosing weight; STOP-BANG; Apfel PONV risk; Revised Cardiac Risk Index; P/F ratio and oxygenation; Mallampati and airway predictor summary (described classes, original art).

**Drills (`narke/drill/*.json`, drill core):** MBBS: adult BLS and ALS (kb cardiac arrest), anaphylaxis (kb), paediatric arrest (kb). Resident: unanticipated difficult intubation and CICO (DAS 2015 and AIDAA, facts cited, original wording), LAST (kb), malignant hyperthermia (kb), high or total spinal, laryngospasm, bronchospasm, massive haemorrhage (kb transfusion), aspiration.

**Explorers (`narke-models/explorer-*.js`):** oxygen-haemoglobin dissociation curve; inhalational agents and MAC; train-of-four and neuromuscular block; dermatomes and neuraxial block height; ventilator waveforms (pressure, flow, volume by mode); circle system and fresh gas flow.

**Clinics (synthetic, labelled "teaching signal"):** capnography (normal, oesophageal intubation, bronchospasm, curare cleft, rebreathing, disconnection, rising EtCO2 in MH, cardiac arrest and ROSC) and monitor reading (ECG rhythm, SpO2, NIBP, EtCO2 trends in common crises). Signals come from a seeded generator model with unit tests per pattern.

**OSCE (CliniX `anaesthesia` system, deep link `narke-osce`):** preoperative assessment, airway assessment, consent for GA and for spinal, bag-mask ventilation, LMA insertion steps, spinal anaesthesia steps, BLS.

## 5. Shared-code changes (Phase 0)

| File | Change |
|---|---|
| `narke.js`, `narke-loader.js`, `narke.css` | New host, loader (copy of the Tokós pattern), palette under `.nrk-root` |
| `home.js` | Tile and `ACT.narke` (kill switch `smd_narke` / `?narke=0`), deep link `stewardmd://narke` works generically |
| `index.html` | Loader tag only |
| `swipe-back.js` | `NARKE.isOpen()` / `NARKE.back()` hooks |
| `scripts/build-www.sh` | `narke/` and `narke-models/` copy block, source-only files removed |
| `review-desk.js`, `scripts/apply-reviews.mjs`, `functions/_kits_share.js` | Specialty tab generalised (base, global, label), `narke` kind |
| `tools/tokos-learn-index.mjs`, `tools/tokos-build-mcq*.mjs`, `tools/tokos-build-drills.mjs` | Host arguments; per-host taxonomy and unit order in `narke/` config files |
| `tokos-models/drill-core.js` | Drill core global accepted per host (Tokós unchanged) |
| `.github/workflows/narke-ui.yml` | UI tests |

## 6. Data and licence register (verified 2026-10-06)

| Source | Use | Licence | Status |
|---|---|---|---|
| MedMCQA, subject "Anaesthesia" (3,206 items) | Bank | MIT (GitHub), Apache-2.0 (Hugging Face card) | Same basis as the shipped Tokós bank; exam-question provenance is the existing owner item (legal sign-off before public release) |
| VitalDB | Intraoperative signals | PhysioNet says CC BY 4.0; the VitalDB data use agreement says CC BY-NC-SA, research use, no disclosure | Blocked until VitalDB confirms in writing |
| CapnoBase | Capnograms | Custom terms, no commercial grant | Blocked; synthetic capnograms instead |
| Airway (Mallampati) photos, nerve-block ultrasound sets | Clinics | Not public or unknown | Blocked; original illustrations |
| AIDAA 2016/2025, ISA/IRC, DAS 2015 | Algorithms | CC BY-NC-SA / CC BY-NC (free to read) | Cite facts, original wording, no figures |
| Association of Anaesthetists (MH, LAST, NAP6), ERC/AHA ALS, ASA PS 2020, ASA fasting 2023 | Facts | All rights reserved or unconfirmed | Cite facts, original wording |
| `kb/clinical-protocols/*` | Drill and calculator doses | App's own reviewed protocols | Use; tests pin doses to these files |

## 7. Phases

- **Phase 0 (foundation):** shared-code changes of Section 5; empty Narkē opening on Learn and Test; loader, tile, kill switch, swipe-back, Review Desk tab; deploy file-count check; tests (wiring, engine host, UI smoke). PR and merge.
- **Phase 1 (bank and calculators):** MedMCQA Anaesthesia build with a Narkē taxonomy (airway, induction agents, inhalational agents, muscle relaxants, local anaesthetics and regional, monitoring and equipment, preoperative, fluids and blood, pain, ICU and ventilation, CPR, special populations, physics and pharmacology basics); 12 calculators with pinned examples.
- **Phase 2 (Learn MBBS):** competencies file and coverage report; 10 units in parallel (one subagent each), original SVG diagrams, glossary, index build.
- **Phase 3 (Learn Resident):** 8 units in parallel.
- **Phase 4 (clinics):** signal generator model, capnography and monitor clinics.
- **Phase 5 (drills):** 11 drills; doses pinned to kb protocols by test.
- **Phase 6 (explorers):** 6 explorers with UI.
- **Phase 7 (OSCE):** CliniX anaesthesia system and skills, deep link.
- **Phase 8 (review and launch):** independent clinical and code review (Tokós method: reviewers per area, fixes, verifier), Review Desk entries, UI finish gate, full tests, vault note `vault/modules/Narkē.md`, OTA.

Content phases run as parallel subagents in isolated worktrees after Phase 0 merges; Phases 4 to 7 run alongside.

## 8. Global constraints

- No em dash in app text or docs. ES5 client code. No engine file names a host (test enforced).
- No fabricated clinical data: doses from kb protocols or a cited guideline; synthetic signals labelled as such.
- Every media item original or licence-clear and credited; NC and all-rights-reserved sources are cited, never copied or traced.
- All content `review: ai_drafted`; draft footer until approval.
- Hindi for every learner string, ASCII numerals.
- Owner UI skills on every screen; subagents doing UI are told to load them.
- `graphify query` before exploring code; tell every subagent.
- English sentences of 20 words or fewer in new lesson text.
- Keep the deployed file count under the Pages cap; prefer fewer, larger files where the engine allows.

## 9. Owner decisions

| Item | Default taken |
|---|---|
| Module name | Narkē (display only, renamable) |
| NMC competency list | CBME 2024 (52 codes) found in the same NMC PDF Tokós uses; mapped |
| MedMCQA exam-content rights | Same as Tokós: ship, pending the existing legal sign-off item |
| VitalDB | Not used; ask VitalDB for written commercial permission if real signals are wanted |
| Clinical reviewers | One anaesthesiologist for Phases 2 to 7 via Review Desk |
