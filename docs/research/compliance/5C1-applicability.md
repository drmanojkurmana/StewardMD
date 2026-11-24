# Package 5C.1: Patient-Level Data (IPD) Compliance Applicability Review

**Module:** ResearchMD (StewardMD app, Phase 5C)
**Scope:** Individual Participant Data (IPD) / patient-level dataset uploads to ResearchMD (private R2 + D1 `stewardmd-research` + Cloudflare Containers Python worker)
**Review Date:** 2026-11-23
**Status:** Draft for owner and legal counsel sign-off (software never replaces ethics review or legal advice; see `docs/research/RESEARCHMD_PLAN.md` section 11).

> **Hard Architectural Boundary (Section 3, Rule 10 & 12):** No identifiable or patient-level data ever goes to an external LLM (enforced in code by the PHI gate and IPD gate). Research data remains strictly isolated from clinical EMR data unless a separately reviewed integration is approved.

---

## 1. Cross-Framework Summary Matrix

| Dimension | India DPDP Act 2023 & Rules 2025 | EU GDPR (Reg. 2016/679) | US HIPAA (45 CFR Parts 160 & 164) |
| :--- | :--- | :--- | :--- |
| **Trigger for StewardMD user** | Processing digital personal data in India, or outside India when offering goods/services to individuals in India (DPDP Act s. 3(a)-(b)) | EU-established controller/processor (Art. 3(1)), or non-EU entity offering goods/services to or monitoring individuals in the EEA (Art. 3(2)) | Uploading PHI from or on behalf of a US Covered Entity (CE) or Business Associate (BA) (45 CFR 160.103) |
| **StewardMD role** | Data Processor (s. 2(k)) under contract (s. 8(2)) when processing on investigator's behalf; Data Fiduciary (s. 2(i)) for user accounts or any platform-defined reuse | Processor (Art. 4(8)) under Art. 28 DPA; becomes Controller (Art. 28(10)) if reusing IPD for platform purposes | Business Associate (45 CFR 160.103) requiring a BAA (164.502(e), 164.504(e)), even for encrypted "no-view" ePHI; NOT a BA if hosting only HIPAA-de-identified data |
| **Out-of-scope data** | Irreversibly anonymised data (not identifiable under s. 2(t)). Coded/pseudonymised IPD remains personal data | Irreversibly anonymised data (Recital 26) and deceased persons (Recital 27). Pseudonymised IPD (Art. 4(5)) remains personal data | De-identified data via Safe Harbor (164.514(b)(2)) or Expert Determination (164.514(b)(1)); decedents >50 years (160.103, 164.502(f)) |
| **Primary research basis** | Consent (ss. 4-6) OR Research exemption (s. 17(2)(b) + Rule 16 & Second Schedule, if no individual decision is taken) | Art. 6(1)(a)/(e)/(f) AND Art. 9(2)(a) explicit consent OR Art. 9(2)(j) scientific research under Union/Member State law + Art. 89(1) safeguards | Authorization (164.508), IRB/Privacy Board Waiver (164.512(i)(1)(i)), or Limited Data Set + DUA (164.514(e)) |
| **Pre-upload ethics/consent evidence** | IEC approval or IEC-issued exemption/waiver (ICMR 2017 ss. 4.8.3, 5.7) + consent/waiver attestation + DPA | Ethics/IRB approval (per national law under Art. 9(4)), Art. 7(1) consent or Art. 9(2)(j) legal basis citation, Art. 35 DPIA attestation, Art. 28 DPA | Executed BAA (if PHI) + one of: signed Authorization confirmation, IRB/Privacy Board Waiver PDF, executed DUA (for LDS), or Safe Harbor / Expert Determination attestation |
| **Data residency** | Negative-list model (s. 16(1), Rule 15); SDF localisation power (s. 10, Rule 13(4)-(5)). Restricted list & SDF rules: **UNCONFIRMED** (not yet notified) | No strict EU-only storage, but EEA-to-non-EEA transfers require Chapter V (Art. 45 adequacy or Art. 46 SCCs + TIA) | No federal US-only requirement (HHS Cloud Q9); offshore risks must be in Security Rule risk analysis (164.308(a)(1)(ii)(A)) |
| **Retention** | Erase when purpose ends or consent withdrawn (s. 8(7)); mandatory **1-year** minimum log & personal data retention (Rule 6(1)(e), Rule 8(3)); ICMR archiving 3 yrs (5 yrs regulatory trials) | Storage limitation with scientific research exception (Art. 5(1)(e)) subject to Art. 89(1) safeguards; return/delete on DPA end (Art. 28(3)(g)) | Compliance docs (BAAs, authorizations, DUAs, policies): **6 years** (164.530(j)); BA returns/destroys PHI at contract end (164.504(e)(2)(ii)(J)) |
| **Breach notification** | **Without delay** to DPBI (Rule 7(2)(a)) and every affected individual (Rule 7(1)); detailed report to DPBI within **72 hours** (Rule 7(2)(b)); no harm threshold | Processor to Controller **without undue delay** (Art. 33(2)); Controller to authority within **72 hours** (Art. 33(1)); high-risk individuals **without undue delay** (Art. 34(1)) | Unsecured PHI: BA to CE **<= 60 days** (164.410(b)); CE to individuals **<= 60 days** (164.404(b)); HHS OCR **<= 60 days** (>=500, 164.408(b)) or annual log within 60 days of year-end (<500, 164.408(c)) |

---

## 2. India: DPDP Act, 2023, DPDP Rules, 2025, and ICMR 2017 Guidelines

**Primary Sources:**
- [Digital Personal Data Protection Act, 2023 (No. 22 of 2023)](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)
- [Digital Personal Data Protection Rules, 2025, G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) (notified 13 Nov 2025; published 14 Nov 2025) and [Commencement Notification G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
- [DPDP (Removal of Difficulties) Order, 2026, S.O. 5458(E)](https://www.meity.gov.in/static/uploads/2026/10/daf495a7b5798a3dfa72a944b51fc176.pdf) (dated 5 Oct 2026) and [PIB Press Release ID 2336151](https://www.pib.gov.in/PressReleaseDetail.aspx?PRID=2336151) (14 Nov 2026)
- [ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants, 2017](https://ethics.ncdirindia.org/asset/pdf/ICMR_National_Ethical_Guidelines.pdf) and [ICMR Feb 2024 Addendum for Systematic Reviews/Meta-Analyses](https://www.icmr.gov.in/icmrobject/uploads/Guidelines/1724842157_ethical_requirements_for_systematic_review_metaanalysis_proposals_an_addendum.pdf)

### 2.1 Enforcement Status as of 23 November 2026
Under [G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), and [PIB PRID 2336151](https://www.pib.gov.in/PressReleaseDetail.aspx?PRID=2336151):
- **Tranche 1 (13 Nov 2025, in force):** DPDP Act ss. 1(2), 2, 18-26, 35, 38-43, 44(1), 44(3); Rules 1, 2, 17-21 and Schedules V-VI (Data Protection Board of India setup).
- **Tranche 2 (13 Nov 2026, in force):** DPDP Act ss. 6(9), 27(1)(d); Rule 4 and First Schedule (Consent Manager registration via `dpbi.gov.in`).
- **Tranche 3 (13 May 2027, upcoming):** Substantive Data Fiduciary obligations, Data Principal rights, research exemption, breach rules, penalties (up to INR 250 crore), and repeal of IT Act s. 43A / SPDI Rules 2011 (DPDP Act ss. 3-5, 6(1)-(8) & (10), 7-17, 27-34, 36-37, 44(2); Rules 3, 5-16, 22-23; Schedules II, III, IV, VII). Until 13 May 2027, IT Act s. 43A and the SPDI Rules 2011 remain in force.
- **UNCONFIRMED items on current notifications:**
  1. Direct official MeitY/eGazette PDF URL for Corrigenda G.S.R. 892(E) (10 Dec 2025) was not retrieved from primary Gazette portals (referenced in secondary legal trackers).
  2. Formal Gazette appointment of the DPBI Chairperson and four Members could not be verified from primary Gazette sources as of 23 Nov 2026.

### 2.2 When DPDP Applies to a StewardMD User
- **Material & Territorial Scope (s. 3(a)-(b)):** Applies whenever a user processes digital personal data in India (including paper clinical records or CRFs digitised into ResearchMD under s. 3(a)(ii)), or processes personal data outside India in connection with offering goods or services to Data Principals in India (s. 3(b)). Academic/clinical research is NOT excluded under the personal/domestic exclusion (s. 3(c)(i)).
- **Identifiability (s. 2(t)):** Truly irreversibly anonymised datasets fall outside the Act. Coded or pseudonymised IPD (where the investigator or hospital retains a linkage key) remains regulated personal data.
- **Role Allocation (ss. 2(i), 2(k), 8(1)-(2)):** The researcher or host hospital/university is the **Data Fiduciary** (retaining statutory compliance liability under s. 8(1)). StewardMD is a **Data Processor** only when processing IPD strictly under a valid contract (s. 8(2)). StewardMD must never reuse uploaded IPD for model training or cross-tenant analytics, which would make StewardMD a Data Fiduciary for that data.

### 2.3 Lawful Basis and Research Exemption
- **Consent (ss. 4(1)(a), 5, 6; Rule 3):** Requires a standalone plain-language notice (itemised data list, specified purposes, communication link for withdrawal/rights/Board complaints; accessible in English or any Eighth Schedule language under s. 5(3)) and free, specific, informed, unconditional, unambiguous affirmative consent (s. 6(1)). Burden of proof rests on the Data Fiduciary (s. 6(10)).
- **Certain Legitimate Uses (s. 7):** Medical emergency (s. 7(f)) and epidemic/public health treatment (s. 7(g)) do NOT cover routine biomedical research.
- **Children & Persons with Disabilities (s. 9, as amended by S.O. 5458(E); Rules 10-12 & Fourth Schedule):** Requires verifiable parental consent (child under 18, s. 2(f), Rule 10) or verifiable lawful guardian consent (Rule 11). The healthcare exemption in Rule 12 / Fourth Schedule Part A covers clinical treatment/referral only, NOT paediatric research.
- **Research, Archiving, or Statistical Exemption (s. 17(2)(b); Rule 16 & Second Schedule):** Exempts processing necessary for research, archiving, or statistical purposes PROVIDED (1) the data is NOT used to take any decision specific to a Data Principal, and (2) Second Schedule standards are met: (a) lawful processing (meaning ICMR/NDCT ethics rules still apply), (b) purpose limitation to s. 17(2)(b), (c) data minimisation, (d) completeness/accuracy/consistency efforts, (e) retention limited to purpose or legal need, (f) reasonable security safeguards covering Data Processors, and (h) accountability. Pure statistical IPD analysis in ResearchMD qualifies when Second Schedule safeguards are enforced; clinical decision-support tools generating patient-specific outputs do NOT qualify.

### 2.4 Consent and IEC/IRB Evidence Required Before Upload
Under the [ICMR National Ethical Guidelines, 2017](https://ethics.ncdirindia.org/asset/pdf/ICMR_National_Ethical_Guidelines.pdf):
- **Mandatory IEC Review (ss. 4.0, 4.8.3, Table 4.2):** Researchers cannot self-exempt a study. Every IPD study protocol must be submitted to an Institutional Ethics Committee (IEC) to grant formal exemption, expedited review, or full committee approval. (By contrast, the [ICMR Feb 2024 Addendum](https://www.icmr.gov.in/icmrobject/uploads/Guidelines/1724842157_ethical_requirements_for_systematic_review_metaanalysis_proposals_an_addendum.pdf) exempts prospectively registered systematic reviews/meta-analyses using aggregated published data from EC submission.)
- **Informed Consent / E-Consent / Waiver (ss. 5.0-5.8, 6.5, Box 5.2):** Written informed consent (or EC-approved electronic consent under s. 5.5) is required unless the IEC grants a formal waiver of consent under s. 5.7 & Box 5.2 (less than minimal risk, impracticable without waiver, retrospective de-identified records, or anonymised data). Paediatric studies additionally require verbal assent (ages 7-12) or written assent (ages 12-18) alongside parent/LAR consent (s. 6.5).
- **UNCONFIRMED:** The exact verbatim clause text of ICMR 2017 Table 11.1 and sub-sections 11.2.1-11.7.x (distinguishing anonymous, reversibly coded, and irreversibly anonymised biospecimens/datasets) could not be extracted in full due to PDF truncation and should be verified directly against pages 128-136 of the official ICMR 2017 PDF before finalising Indian IPD coding definitions.

### 2.5 Data Residency, Retention, Security, and Breach Notification
- **Data Residency (s. 16; Rules 13(4)-(5), 15):** Transfers outside India are allowed by default unless to a Central Government restricted country (s. 16(1)) or subject to foreign-State access conditions (Rule 15). Significant Data Fiduciaries (SDFs, s. 10) must also localise designated data categories in India (Rule 13(4)-(5)). **UNCONFIRMED:** As of 23 Nov 2026, no restricted country list (s. 16(1)), no Rule 15 foreign-State order, no SDF designations (s. 10(1)), and no Rule 13(4)-(5) localised data categories have been notified.
- **Retention & Erasure (s. 8(7); Rules 6(1)(e), 8(1)-(3), Second & Third Schedules):** Erase upon consent withdrawal or purpose completion (s. 8(7)). The 3-year inactivity rule (Rule 8(1)-(2), Third Schedule) applies only to large e-commerce, online gaming, and social media platforms, not StewardMD. However, **Rule 6(1)(e)** and **Rule 8(3)** mandate a **1-year minimum retention floor** for personal data, traffic data, and access/processing logs (including at Data Processors). For research-exempt IPD (s. 17(2)(b)), Second Schedule clause (e) aligns retention with research purpose and ICMR 2017 archiving minimums (ss. 4.13.5-4.13.6: **3 years** post-completion; **5 years** for regulatory trials).
- **Security Safeguards (s. 8(5); Rule 6(1)(a)-(g)):** Mandates encryption/obfuscation/masking/virtual tokens (Rule 6(1)(a)), access controls (Rule 6(1)(b)), access logs and monitoring (Rule 6(1)(c)), backups/business continuity (Rule 6(1)(d)), 1-year log retention (Rule 6(1)(e)), contractual processor security (Rule 6(1)(f)), and technical/organisational enforcement (Rule 6(1)(g)).
- **Breach Notification (s. 2(u), s. 8(6); Rule 7(1)-(2)):** Zero harm threshold. Notify every affected Data Principal **without delay** (Rule 7(1)) and notify DPBI in two stages: immediate intimation **without delay** (Rule 7(2)(a)) plus a detailed report within **72 hours** of awareness (Rule 7(2)(b)). Separate CERT-In 6-hour cybersecurity incident reporting rules also apply independently.

---

## 3. EU: General Data Protection Regulation (GDPR)

**Primary Sources:**
- [Regulation (EU) 2016/679 (GDPR), EUR-Lex Full Text](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679)
- [Commission Implementing Decision (EU) 2021/914 (Standard Contractual Clauses)](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj/eng)
- [Commission Implementing Decision (EU) 2023/1795 (EU-US Data Privacy Framework)](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj/eng)
- [EDPB Recommendations 01/2020 on Supplementary Transfer Measures](https://www.edpb.europa.eu/system/files/2021-06/edpb_recommendations_202001vo.2.0_supplementarymeasurestransferstools_en.pdf) and [EDPB Guidelines 9/2022 on Breach Notification](https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf)

### 3.1 When GDPR Applies to a StewardMD User
- **Territorial Scope (Art. 3):** Applies when an EU/EEA-established researcher or institution uses ResearchMD (Art. 3(1)), or when a non-EEA controller/processor processes personal data of individuals in the Union related to offering goods/services or monitoring behaviour in the Union (Art. 3(2)).
- **Controller vs. Processor (Art. 4(7)-(8), Art. 28):** The research institution/investigator is Controller; StewardMD is Processor and must execute a binding Art. 28 Data Processing Agreement (electronic form permitted under Art. 28(9)) before IPD upload. Any platform-defined secondary use converts StewardMD into a Controller (Art. 28(10)).
- **Anonymisation vs. Pseudonymisation (Recital 26, Art. 4(5)):** Irreversibly anonymised IPD (accounting for all means reasonably likely to be used, including singling out) is outside GDPR (Recital 26). Pseudonymised/coded IPD (Art. 4(5)) remains personal data fully subject to GDPR. Deceased persons' data is outside GDPR (Recital 27), subject to national Member State law.

### 3.2 Lawful Basis (Art. 6), Special Category Health Data (Art. 9), and Research Safeguards (Art. 89)
Health data (Art. 4(15)) and genetic data (Art. 4(13)) require satisfying **both** Art. 6(1) and Art. 9(2):
- **Art. 6(1) basis:** Typically consent (Art. 6(1)(a)), task in the public interest under Union/Member State law (Art. 6(1)(e) + Art. 6(3)), or legitimate interests (Art. 6(1)(f), unavailable to public authorities).
- **Art. 9(2) condition:**
  - **Art. 9(2)(a) Explicit Consent:** Express, demonstrable, freely given, specific, informed consent (Art. 7). Recital 33 permits broad-area research consent consistent with recognised ethical standards, but Recital 43 warns against consent where a clear power imbalance exists (such as patient and public hospital).
  - **Art. 9(2)(j) Scientific Research:** Necessary for scientific research in accordance with Art. 89(1), **based on Union or Member State law** that is proportionate and provides suitable safeguards. Under **Art. 9(4)**, Member States may impose additional national conditions on health/genetic data.
- **Art. 89 Safeguards & Derogations:** Art. 89(1) mandates technical and organisational safeguards ensuring data minimisation, specifically pseudonymisation or anonymisation wherever research aims can be achieved without identification. Art. 89(2) allows Union/Member State law derogations from Arts. 15, 16, 18, and 21 where exercising those rights would seriously impair research. Related research rules include Art. 5(1)(b) (compatible secondary research), Art. 14(5)(b) (indirect notice exception), and Art. 17(3)(d) (erasure exception).

### 3.3 Consent, Ethics/IRB, and DPIA Evidence Required Before Upload
- **Consent Demonstration (Art. 7(1)-(3)):** If relying on Art. 9(2)(a), the controller must be able to demonstrate valid consent and support withdrawal with comparable ease.
- **Ethics/IRB & National Law (Art. 9(2)(j), Art. 9(4), Recitals 33, 156, 161):** GDPR relies on Member State law and Regulation (EU) No 536/2014 for ethics committee mandates. **UNCONFIRMED:** Country-by-country Member State statutory requirements under Art. 9(2)(j) and Art. 9(4) (such as national IRB mandates and derogations) vary across all 27 EU Member States and require per-jurisdiction legal review before opening EU IPD uploads.
- **Mandatory DPIA (Art. 35(3)(b)):** Large-scale processing of Art. 9 health data requires a Data Protection Impact Assessment prior to upload (with Art. 36 supervisory authority consultation if high residual risk remains). StewardMD must assist controllers with DPIAs (Art. 28(3)(f)).

### 3.4 Data Residency, Retention, Security, and Breach Notification
- **Data Residency / Transfers (Chapter V, Arts. 44-49):** GDPR does not mandate EU-only storage, but any transfer or remote access from outside the EEA requires an adequacy decision (Art. 45, e.g., EU-US Data Privacy Framework [Decision 2023/1795](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj/eng)), Standard Contractual Clauses (Art. 46(2)(c), [Decision 2021/914](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj/eng)) backed by a Transfer Impact Assessment and supplementary encryption measures ([EDPB 01/2020](https://www.edpb.europa.eu/system/files/2021-06/edpb_recommendations_202001vo.2.0_supplementarymeasurestransferstools_en.pdf)), or a narrow Art. 49 derogation. Pinning EEA IPD to EU R2 buckets and EU-region compute avoids third-country transfer friction.
- **Retention (Art. 5(1)(e), Art. 28(3)(g)):** Longer retention is permitted solely for scientific research under Art. 89(1) safeguards; StewardMD must delete or return IPD upon contract termination per Art. 28(3)(g).
- **Security (Art. 32):** Pseudonymisation, encryption in transit and at rest (Art. 32(1)(a)), ongoing confidentiality/integrity/availability (Art. 32(1)(b)), backup restoration (Art. 32(1)(c)), and regular security testing (Art. 32(1)(d)).
- **Breach Notification (Arts. 33-34):** Processor (StewardMD) notifies Controller **without undue delay** (Art. 33(2)). Controller notifies the supervisory authority within **72 hours** unless unlikely to risk rights/freedoms (Art. 33(1)) and notifies affected individuals **without undue delay** if likely to result in high risk (Art. 34(1)), unless prior encryption rendered the data unintelligible (Art. 34(3)(a)).

---

## 4. US: HIPAA Privacy, Security, and Breach Notification Rules

**Primary Sources:**
- [eCFR 45 CFR Part 160 (Section 160.103 Definitions)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-160/subpart-A/section-160.103)
- [eCFR 45 CFR Part 164 (Security, Breach, and Privacy Rules)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164)
- [HHS Guidance on HIPAA and Cloud Computing](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html), [HHS De-identification Guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html), [HHS HIPAA and Research](https://www.hhs.gov/hipaa/for-professionals/special-topics/research/index.html), and [HHS Breach Notification Rule](https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html)

*(**UNCONFIRMED:** eCFR displays a cross-reference to Federal Register notices published 19 Nov 2026 at 91 FR 74962-74964 affecting 45 CFR 160.103, 164.502, 164.512, and 164.514; the exact text and effective date of any pending amendments in that notice were not verified and must be checked before enabling US PHI uploads.)*

### 4.1 When HIPAA Applies to a StewardMD User
- **Covered Entity & Business Associate (45 CFR 160.103):** Applies when a US Covered Entity (health care provider conducting standard electronic transactions, health plan, or clearinghouse) or its Business Associate uploads Protected Health Information (PHI) to ResearchMD.
- **Cloud Platform as BA ([HHS Cloud Guidance Q1-Q3, Q11](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)):** A cloud service provider storing ePHI is a **Business Associate even if it holds only encrypted "no-view" data without the decryption key**, requiring an executed **Business Associate Agreement (BAA)** under 45 CFR 164.502(e) and 164.504(e) (plus subcontractor BAAs down the stack, e.g., Cloudflare R2/D1/Containers, under 164.504(e)(5)). Conversely, a platform receiving and storing **only HIPAA-de-identified data is NOT a Business Associate**.

### 4.2 De-Identification Pathways (Exits HIPAA Scope)
Properly de-identified data is not PHI (45 CFR 164.502(d), 164.514(a)). A non-derived re-identification code may be assigned if the key is not disclosed (164.514(c)).
1. **Safe Harbor (45 CFR 164.514(b)(2)):** Requires (i) removing all **18 identifiers** of the individual, relatives, employers, or household members: (A) names; (B) geographic subdivisions smaller than a State (except initial 3 ZIP digits where the combined census population exceeds 20,000, else `000`); (C) all date elements except year directly related to an individual (birth, admission, discharge, death) and all ages >89 (may aggregate as `90 or older`); (D) phone numbers; (E) fax numbers; (F) email addresses; (G) SSNs; (H) MRNs; (I) health plan beneficiary numbers; (J) account numbers; (K) certificate/license numbers; (L) vehicle identifiers/license plates; (M) device identifiers/serial numbers; (N) URLs; (O) IP addresses; (P) biometric identifiers; (Q) full-face photos/comparable images; (R) any other unique identifying number, characteristic, or code; **AND** (ii) **no actual knowledge** (164.514(b)(2)(ii)) that remaining data could identify an individual.
2. **Expert Determination (45 CFR 164.514(b)(1)):** A qualified statistical/scientific expert determines the risk of re-identification is **very small** (164.514(b)(1)(i)) and **documents** the methods and results (164.514(b)(1)(ii)).

### 4.3 Limited Data Set (LDS) with Data Use Agreement (DUA)
Under **45 CFR 164.514(e)**, an LDS is **still PHI**, usable for research without individual authorization or IRB waiver if governed by a DUA:
- **16 Direct Identifiers Removed (164.514(e)(2)(i)-(xvi)):** Names; postal address other than town/city, State, and ZIP; phone; fax; email; SSN; MRN; health plan beneficiary number; account number; certificate/license number; vehicle identifiers; device identifiers; URLs; IP addresses; biometric identifiers; full-face/comparable photos.
- **Permitted to Remain:** Exact dates (birth, admission, discharge, death, ages >89), town/city, State, full 5-digit ZIP code, and non-excluded codes.
- **Mandatory DUA Elements (164.514(e)(4)(ii)):** Establish permitted research uses and authorised recipients, and bind the recipient to: (1) not use/disclose beyond the DUA or law; (2) use appropriate safeguards; (3) report unauthorized uses/disclosures to the CE; (4) flow down terms to agents/subcontractors; and (5) **not re-identify or contact individuals**. Because an LDS is PHI, StewardMD still requires a BAA if hosting an LDS for a CE.

### 4.4 Full PHI Research Pathways (When Not De-Identified or LDS)
- **Individual Authorization (45 CFR 164.508):** Plain-language signed written authorization with core elements (164.508(c)(1); research expiration may state `"end of the research study"` or `"none"` under 164.508(c)(1)(v)) and required statements (164.508(c)(2)), plus copy to individual (164.508(c)(4)).
- **IRB / Privacy Board Waiver or Alteration (45 CFR 164.512(i)(1)(i) & (i)(2)):** Signed board documentation confirming minimal privacy risk (with identifier protection/destruction plan and written non-reuse assurances), impracticability without waiver, and impracticability without PHI.
- **Preparatory to Research / Decedents (45 CFR 164.512(i)(1)(ii)-(iii)):** Preparatory-to-research explicitly forbids removing PHI from the Covered Entity (so it does NOT permit uploading CE PHI to ResearchMD). Decedent research requires specific researcher representations and death documentation upon request.

### 4.5 Data Residency, Retention, Security, and Breach Notification
- **Data Residency ([HHS Cloud Guidance Q9](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)):** HIPAA does NOT mandate US-only hosting, provided a BAA is in place and offshore security/legal risks are addressed in the Security Rule risk analysis (45 CFR 164.308(a)(1)(ii)(A)-(B)). State laws or federal/Medicaid grants may separately require US residency.
- **Retention (45 CFR 164.530(j), 164.504(e)(2)(ii)(J)):** Retain HIPAA compliance documentation (authorizations, IRB waivers, DUAs, BAAs, policies, breach assessments) for **6 years** from creation or last effective date. BAs must return or destroy PHI upon contract termination where feasible.
- **Security Rule Technical Safeguards (45 CFR 164.312):** Unique user ID (164.312(a)(2)(i)), emergency access (164.312(a)(2)(ii)), automatic logoff (164.312(a)(2)(iii)), encryption/decryption (164.312(a)(2)(iv)), audit controls recording ePHI access/activity (164.312(b)), integrity controls (164.312(c)), authentication (164.312(d)), and transmission encryption (164.312(e)(2)(ii)). Encryption to HHS/NIST standards qualifies for the Breach Notification safe harbor for "secured" PHI.
- **Breach Notification Timelines (45 CFR Part 164, Subpart D, unsecured PHI):**
  - BA (StewardMD) to CE: without unreasonable delay, **<= 60 calendar days** from discovery (164.410(b); BAAs typically contract shorter windows such as 24-72 hours).
  - CE to affected individuals: without unreasonable delay, **<= 60 calendar days** (164.404(b)).
  - CE to HHS OCR: **<= 60 calendar days** if **>= 500 individuals** (164.408(b)); annual log within **60 days after calendar year-end** if **< 500 individuals** (164.408(c)).
  - CE to prominent media: **<= 60 calendar days** if **> 500 residents** of a State or jurisdiction (164.406(a)-(b)).

---

## 5. What StewardMD Must Enforce in Code (Product Posture)

Until enterprise BAAs/DPAs and regional infrastructure are provisioned, ResearchMD's safest phased rollout for Phase 5C is:
1. **Default posture:** Allow study-level data freely (Phase 3.8); gate all patient-level (IPD) uploads behind the Phase 5C IPD gate.
2. **Tier 1 (Lowest regulatory friction):** De-identified / irreversibly anonymised IPD (HIPAA Safe Harbor or Expert Determination; GDPR Recital 26; DPDP s. 2(t)) with mandatory automated 18-identifier screening and signed user attestation before upload.
3. **Tier 2 (Regulated IPD, enterprise/institutional opt-in only):** Coded/pseudonymised IPD or HIPAA Limited Data Sets ONLY when (a) a signed DPA/BAA is active on the workspace, (b) jurisdiction-specific ethics/IRB/consent/DUA evidence is uploaded and verified, (c) regional storage pinning is enabled, and (d) the hard LLM-isolation gate blocks every IPD row from reaching the AI gateway.

---

## 6. Code Requirements Checklist for Packages 5C.2 and 5C.3

### Package 5C.2: Encryption at Rest, Data Residency, Access Logs, and Breach Logging

- [ ] **Envelope encryption at rest for IPD snapshots:** Encrypt every IPD object in private R2 with per-project/per-dataset data encryption keys (AES-256-GCM) wrapped by a KMS/root key (satisfies DPDP Rule 6(1)(a), GDPR Art. 32(1)(a), HIPAA 45 CFR 164.312(a)(2)(iv), and HIPAA encryption breach safe harbor).
- [ ] **TLS 1.2+ / 1.3 in transit:** Enforce HTTPS/TLS on all client-to-API, API-to-R2, and worker-to-R2 transfers (HIPAA 164.312(e)(2)(ii), GDPR Art. 32(1)(a)).
- [ ] **Project-level data residency pinning:** Add a `data_region` column on `research_projects` (`IN`, `EU`, `US`, `GLOBAL_DEID`) locked at IPD enablement; route R2 bucket writes and Cloudflare Containers worker execution strictly to the pinned region so EU/IN IPD never crosses borders inadvertently (GDPR Chapter V, DPDP s. 16 / Rule 13(4)-(5)).
- [ ] **Immutable access and export audit log:** Record every IPD upload, read, query, analysis run, export, key rotation, and deletion in an append-only audit table (`user_id`, `project_id`, `dataset_version_id`, `action`, `timestamp_utc`, `ip_hash`, `result`) (DPDP Rule 6(1)(c), HIPAA 164.312(b), `RESEARCHMD_PLAN.md` section 11).
- [ ] **Jurisdiction-aware retention and erasure engine:**
  - Enforce a **1-year minimum** audit/processing log retention floor for India projects (DPDP Rule 6(1)(e), Rule 8(3)).
  - Enforce a **6-year minimum** retention floor for compliance evidence artefacts (IRB approvals, consent templates, DUAs, BAAs, breach logs) for US projects (HIPAA 45 CFR 164.530(j)).
  - Support cryptographic erasure (key destruction + R2 object purge + tombstone audit entry) upon consent withdrawal, project closure, or DPA/BAA termination (DPDP s. 8(7), GDPR Art. 28(3)(g), HIPAA 164.504(e)(2)(ii)(J)).
- [ ] **Structured breach incident log and SLA timer:** Implement a `security_incidents` admin table tracking `discovered_at_utc`, `jurisdictions[]`, `affected_projects[]`, `encrypted_flag`, and automated SLA countdown alerts:
  - India DPDP: immediate alert + **72-hour** DPBI detailed report deadline (Rule 7(2)(b)) + CERT-In 6-hour reminder.
  - EU GDPR: immediate Processor-to-Controller alert (Art. 33(2)) + **72-hour** supervisory authority timer (Art. 33(1)).
  - US HIPAA: BA-to-CE and **60-calendar-day** individual/OCR/media timers (45 CFR 164.404-410), plus `<500` annual log export.
- [ ] **Short-lived signed R2 URLs & tenant isolation:** Keep R2 buckets strictly private; issue short-lived signed URLs scoped to verified project membership and role; maintain 0 cross-project reads in automated two-user isolation tests (`RESEARCHMD_PLAN.md` sections 11-12).
- [ ] **Backup and recovery verification:** Automated encrypted backups of D1 metadata and R2 IPD snapshots with periodic restore drills logged for compliance evidence (DPDP Rule 6(1)(d), GDPR Art. 32(1)(c)-(d)).

### Package 5C.3: IPD Gate and Code-Enforced LLM Isolation

- [ ] **Hard server-side IPD upload gate (HTTP 403/422 before R2 presign):** Reject any `dataset_type = 'ipd'` upload unless the project has a completed, non-expired `ipd_compliance_record` in D1 matching its declared jurisdiction(s):
  - **All jurisdictions:** Declared `identifiability_tier` (`anonymised_deid`, `hipaa_lds`, or `coded_pseudonymised`), `jurisdictions[]`, and signed researcher responsibility attestation.
  - **India (`IN`):** IEC/IRB approval letter or IEC-issued exemption/waiver PDF (ICMR 2017 s. 4.8.3; no self-exemption), legal basis selection (`consent` with notice/consent attestation OR `dpdp_s17_2_b_research` with mandatory checkbox confirming no individual-specific decisions), and paediatric/guardian flag (DPDP s. 9).
  - **EU/EEA (`EU`):** Active Art. 28 DPA flag on workspace, Art. 6(1) + Art. 9(2) legal basis (`9_2_a_explicit_consent` or `9_2_j_scientific_research` with Member State law reference), ethics/IRB evidence upload, and Art. 35 DPIA completion attestation.
  - **US (`US`):** For `anonymised_deid`: Safe Harbor 18-identifier + no-actual-knowledge attestation OR Expert Determination PDF (45 CFR 164.514(b)). For `hipaa_lds` or `coded_pseudonymised`: active workspace BAA flag (164.502(e)) PLUS executed DUA PDF (164.514(e)(4)) OR signed IRB/Privacy Board Waiver PDF (164.512(i)) OR Authorization confirmation (164.508). Block upload if `preparatory_to_research` is selected (164.512(i)(1)(ii) prohibits removing PHI from the CE).
- [ ] **Deterministic pre-upload PHI/identifier scanner (T0 code, no LLM):** Scan uploaded IPD column headers and cell samples deterministically before committing the snapshot:
  - For `anonymised_deid` (Safe Harbor): hard-block any column or cell matching the 18 HIPAA identifiers (names, full dates other than year, ages >89, ZIPs with <=20,000 population or full addresses, phone/fax, email, SSN/Aadhaar/MRN patterns, URLs, IP addresses).
  - For `hipaa_lds`: hard-block the 16 excluded direct identifiers while permitting dates, city/State, and 5-digit ZIP codes.
  - Reject raw images or free-text clinical notes inside IPD tables unless explicitly stripped/reviewed.
- [ ] **Zero-LLM isolation for IPD rows (enforced in code):**
  - Tag every R2 IPD object, D1 metadata row, and worker job with `contains_ipd = true`.
  - Enforce in the API layer, Python worker, and central AI gateway client that **no payload tagged `contains_ipd = true`, no raw IPD row, and no unaggregated patient-level slice** can ever be serialised into an external LLM prompt (`RESEARCHMD_PLAN.md` section 3 Rule 10, section 10 Package 5C.3).
  - Permit only deterministic T0 statistical execution (`research-engine.js` or Python worker) over IPD; only aggregated, small-cell-suppressed summary outputs (`{{run:<id>.<field>}}` tokens, with configurable minimum cell-count suppression e.g. `n < 5` to prevent singling out) may enter manuscript drafting or AI critique steps.
- [ ] **Clinical EMR boundary check:** Block any import endpoint or connector attempting to pull directly from StewardMD clinical EMR tables into `stewardmd-research` unless an explicit, separately reviewed integration flag is approved (`RESEARCHMD_PLAN.md` section 3 Rule 12).
- [ ] **Automated CI compliance tests:** Add unit and integration tests proving (a) IPD upload fails with 403 when 5C.1 evidence is missing or expired, (b) Safe Harbor scanner blocks all 18 synthetic identifier classes, (c) AI gateway client throws a hard error if passed any `contains_ipd = true` reference, and (d) cross-tenant signed URL / D1 queries return 0 rows.
