# ResearchMD Reporting Guideline Checklists (Phase 5B)

This directory contains structured JSON definitions for the seven reporting guidelines planned for Phase 5B (`5B.1` PRISMA 2020 and `5B.2` CONSORT 2010, STROBE, CARE, STARD 2015, TRIPOD, and SPIRIT 2013) in `docs/research/RESEARCHMD_PLAN.md`.

Every JSON file preserves the exact official item and sub-item numbering and item count. All `text` fields are original short paraphrases (under 30 words each), not verbatim copies of publisher checklist wording, which also protects commercial software compatibility where a publisher licence restricts commercial or derivative reuse.

## Sources, Licences, and Item Counts

| File | Guideline | Version | Numbered Items | Total Sub-items / Rows | Publisher Licence | Primary Source |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `prisma2020.json` | PRISMA 2020 | 2020 (pub. 2021) | 27 | 42 | CC BY 4.0 | Page MJ et al., *BMJ* 2021;372:n71 ([PRISMA Checklist](https://www.prisma-statement.org/prisma-2020-checklist), [PMC8008539](https://pmc.ncbi.nlm.nih.gov/articles/PMC8008539/)) |
| `consort2010.json` | CONSORT 2010 | 2010 | 25 | 37 | CC BY (*PLoS Med*, version not printed); CC BY-NC 2.0 (*BMJ*) | Schulz KF et al., *BMJ* 2010;340:c332 / *PLoS Med* 2010;7(3):e1000251 ([consort-statement.org](https://www.consort-statement.org/), [PMC2844794](https://pmc.ncbi.nlm.nih.gov/articles/PMC2844794/), [PMC2844940](https://pmc.ncbi.nlm.nih.gov/articles/PMC2844940/)) |
| `strobe.json` | STROBE (combined v4) | 2007 (v4) | 22 | 34 | CC BY (*PLoS Med*, version not printed); copyright reserved by authors on strobe-statement.org | von Elm E et al., *PLoS Med* 2007;4(10):e296 ([STROBE Checklists](https://www.strobe-statement.org/checklists/), [PMC2020495](https://pmc.ncbi.nlm.nih.gov/articles/PMC2020495/)) |
| `care.json` | Case Report Checklist | 2026-11 | 12 | 33 | Owner-supplied text (replaces CARE CC BY-NC-ND wording) | Owner-provided PDF, 2026-11-24 |
| `stard2015.json` | STARD 2015 | 2015 | 30 | 34 | CC BY 4.0 (*BMJ* article license block); CC BY-NC 4.0 (simultaneous-publication footnote) | Bossuyt PM et al., *BMJ* 2015;351:h5527 ([EQUATOR STARD](https://equator-network.org/reporting-guidelines/stard/), [PMC4623764](https://pmc.ncbi.nlm.nih.gov/articles/PMC4623764/)) |
| `tripod.json` | TRIPOD | 2015 (D+V) | 22 | 37 | CC BY 4.0 + CC0 1.0 data waiver (*BMC Med*); authors jointly hold copyright | Collins GS et al., *Ann Intern Med* 2015;162(1):55-63 / *BMC Med* 2015;13:1 ([TRIPOD Resources](https://www.tripod-statement.org/resources/), [PMC4284921](https://pmc.ncbi.nlm.nih.gov/articles/PMC4284921/)) |
| `spirit.json` | Clinical Trial Protocol Checklist | 2026-11 | 9 | 53 | Owner-supplied text (replaces SPIRIT CC BY-NC-ND wording) | Owner-provided PDF, 2026-11-24; includes the participant schedule grid |

### Licensing and Version Notes

- **CARE and SPIRIT (resolved 2026-11-24):** the owner supplied replacement case report and trial protocol checklists (`care.json`, `spirit.json`), so no CC BY-NC-ND text ships. Remaining note on co-publication dual licences: CARE (`CC BY-NC-ND 3.0`) and SPIRIT 2013 (`CC BY-NC-ND 3.0 Unported`) prohibit commercial reuse and derivative works of the official checklist text. CONSORT 2010 (*BMJ* vs *PLoS Med*), STROBE (website vs *PLoS Med*), and STARD 2015 (*BMJ* header vs simultaneous-publication footnote) carry differing licence notices across co-publications. For this reason, ResearchMD stores only original short paraphrases (under 30 words) plus official citations and links to the canonical checklists, and must not bundle verbatim publisher PDFs or verbatim wording for NC/ND guidelines without written permission.
- **Newer guideline editions:** TRIPOD 2015 was updated by TRIPOD+AI in 2024, and SPIRIT 2013 has a SPIRIT 2025 update on the EQUATOR Network. These files implement the exact editions requested in Phase 5B (`tripod.json` = TRIPOD 2015 Development and Validation; `spirit.json` = owner-supplied trial protocol checklist).
- **STROBE asterisks (`*`):** Items `8*`, `13a*`, `13b*`, `13c*`, `14a*`, `14b*`, `14c*`, and `15*` follow the official combined v4 convention indicating that information should be reported separately for cases and controls (case-control studies) or exposed and unexposed groups (cohort and cross-sectional studies).
- **TRIPOD `D` / `V` / `D;V` tags:** Each topic in `tripod.json` retains its official Development (`D`: 6 items), Validation (`V`: 6 items), or Both (`D;V`: 25 items) applicability tag.

## Auto-Fill vs. Manual Mapping (`projectField`)

Each item carries a `projectField` indicating which ResearchMD module populates it automatically (with page/section pointers into the manuscript in Phase 5B.1) versus requiring manual researcher entry:

| `projectField` | ResearchMD Data Source | Auto-Fill Capability |
| :--- | :--- | :--- |
| `protocol` | Module B (PICO/PECO, eligibility, outcomes, protocol lock/version, registration, amendments) and Phase 5D study-design templates | Auto-fill from locked protocol and registry fields |
| `search` | Module C (per-database query strings, filters, date bounds, API versions, timestamps, result counts) | Auto-fill from saved search runs |
| `screening` | Module D (screening workflow, reviewer counts, blinded dual review, conflict resolution, full-text exclusion reasons) | Auto-fill from screening audit logs |
| `prisma` | Module D / H (PRISMA 2020 record/report/study counts, duplicates removed, flow diagram) | Auto-fill from deterministic PRISMA counts |
| `extraction` | Module E / F (verified extraction tables, study/baseline characteristics, variable definitions, missing-data counts) | Auto-fill from verified extraction snapshots |
| `rob` | Module L (RoB 2, ROBINS-I, QUADAS-2, NOS judgments and supporting locators) | Auto-fill from completed dual-assessor RoB forms |
| `analysis` | Module G / Phase 5D (`research-engine.js` and Python worker manifests: models, effect sizes, CIs, heterogeneity, subgroups, sensitivity, publication bias, regression/survival/diagnostic outputs) | Auto-fill from saved analysis run manifests and `{{run:...}}` tokens |
| `grade` | Module M (GRADE domain ratings and Summary of Findings table) | Auto-fill from GRADE assessment records |
| `manuscript` | Module I / J (Title, Abstract, Introduction, Discussion, Limitations, Implications, Funding, Competing Interests, Data/Code Availability declarations) | Auto-link to manuscript sections and submission declarations (human-authored/approved text) |
| `manual` | Not stored in structured ResearchMD project records (clinical trial randomisation implementation, blinding logistics, IRB/ethics procedures, consent forms, patient perspective, case-report physical exam/timeline, adverse event narratives, DMC/sponsor governance, biospecimens) | Manual researcher entry and verification required |

### Breakdown by Guideline (Auto-Fillable vs. Manual)

| Guideline | Total Rows | Structured Auto-Fill (`protocol` through `grade`) | Manuscript / Declarations (`manuscript`) | Manual Only (`manual`) | Notes |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **PRISMA 2020** | 42 | 32 (76%) | 10 (24%) | 0 (0%) | Core ResearchMD workflow; every item maps to project modules or manuscript/declarations |
| **CONSORT 2010** | 37 | 18 (49%) | 7 (19%) | 12 (32%) | Manual: interim/stopping rules (`7b`), randomisation/blinding (`8a`-`11b`), flow/recruitment (`13a`-`14b`), harms (`19`) |
| **STROBE** | 34 | 21 (62%) | 8 (24%) | 5 (15%) | Manual: matching details (`6b`), bias handling narrative (`9`), participant flow/non-participation (`13a*`-`13c*`) |
| **CARE** | 30 | 0 (0%) | 11 (37%) | 19 (63%) | Case reports are single-patient clinical narratives; clinical course (`5a`-`10d`), patient perspective (`12`), and consent (`13`) are manual |
| **STARD 2015** | 34 | 20 (59%) | 6 (18%) | 8 (24%) | Manual: index/reference test protocols (`10a`-`11`), reader blinding (`13a`-`13b`), flow diagram (`19`), test interval (`22`), adverse events (`25`) |
| **TRIPOD (2015)** | 37 | 22 (59%) | 9 (24%) | 6 (16%) | Manual: treatments (`5c`), outcome/predictor blinding (`6b`, `7b`), dev-vs-val differences (`12`), flow (`13a`), clinical usage guide (`15b`) |
| **SPIRIT 2013** | 51 | 16 (31%) | 4 (8%) | 31 (61%) | Protocol-stage governance, randomisation/blinding implementation, DMC/auditing, ethics/consent, confidentiality, and biospecimens are manual |

*Note:* For non-systematic-review designs (CONSORT, STROBE, STARD, TRIPOD, SPIRIT), auto-fill for `protocol`, `extraction`, and `analysis` depends on Phase 5D study-design templates (`5D.1`) and Python worker regression/survival/diagnostic models (`5D.2`, `5D.3`). Until Phase 5D is built, those fields fall back to manual entry in the Phase 5B.2 UI.
