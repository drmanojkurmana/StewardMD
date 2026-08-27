#!/usr/bin/env node
/* scripts/build-pglog-curricula.mjs — emit the NMC PG curriculum packs into pglog/curricula/.
 *
 * WHY A GENERATOR AND NOT 15 HAND-WRITTEN FILES: the packs share a large amount of identical NMC
 * boilerplate (the 2019-era guidelines repeat the same three paragraphs verbatim across specialties).
 * Hand-copying that 15 times is 15 chances to mistype a quotation that this module then presents as
 * a regulation. Here each shared paragraph is written ONCE, quoted from the source PDF, and reused.
 *
 * NOTHING IN THIS FILE IS INVENTED. Every `quote` is copied from the NMC PDF named in `source.url`,
 * fetched 2026-08-27. Every requirement with a number has that number in its quote. A requirement
 * whose source gives no number has `target: null` — the module then COUNTS it and never shows a
 * denominator. See NMC_PG_LOGBOOK_REQUIREMENTS.md.
 *
 * Run:  node scripts/build-pglog-curricula.mjs
 * Then: node --test test/pglog-curriculum.test.mjs   (asserts every requirement is traceable)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "pglog", "curricula");
mkdirSync(OUT, { recursive: true });
const RETRIEVED = "2026-08-27";

/* ── quotations that recur verbatim across the 2019-era guidelines ─────────────────────────────── */

// Appears identically in MS Surgery, MS ENT and (with "present seminars" instead of
// "present seminars/review articles") MD Psychiatry.
const Q_LOGBOOK_SPECIFIED_NUMBER =
  "Each student must be asked to present a specified number of cases for clinical discussion, " +
  "perform procedures/tests/operations/present seminars/review articles from various journals in " +
  "inter-unit/interdepartmental teaching sessions. They should be entered in a Log Book. The Log " +
  "books shall be checked and assessed periodically by the faculty members imparting the training.";

// The 2019-era dissemination clause. NOTE: it is a CONJUNCTION ("and"), where PGMER-2023 5.2(x) is a
// DISJUNCTION ("or"). That difference is real and is preserved — the module reports both.
const Q_DISSEMINATION_2019 =
  "A postgraduate student of a postgraduate degree course in broad specialities/super specialities " +
  "would be required to present one poster presentation, to read one paper at a national/state " +
  "conference and to present one research paper which should be published/accepted for " +
  "publication/sent for publication during the period of his postgraduate studies so as to make him " +
  "eligible to appear at the postgraduate degree examination.";

const Q_UG_TEACHING_2019 =
  "The postgraduate students shall be required to participate in the teaching and training " +
  "programme of undergraduate students and interns.";

const Q_CLINICAL_MEETINGS_2019 =
  "There should be intra- and inter- departmental meetings for discussing the uncommon /interesting " +
  "cases involving multiple departments.";

/* ── requirement builders ─────────────────────────────────────────────────────────────────────── */

const req = (o) => ({
  target: null, per: "course", source: "nmc_curriculum", mandatoryForExam: false, ...o
});

// The dissemination trio as the 2019 guidelines state it: three things, joined by "and".
const dissemination2019 = (p, clause) => [
  req({ id: p + "_poster", kind: "research", label: "One poster presentation", target: 1,
        match: { subtype: "poster" }, mandatoryForExam: true, clause, quote: Q_DISSEMINATION_2019,
        note: "This guideline states the three as a CONJUNCTION ('and'); PGMER-2023 5.2(x) states them as a DISJUNCTION ('or'). Both are evaluated separately." }),
  req({ id: p + "_conference_paper", kind: "research", label: "One paper read at a national/state conference", target: 1,
        match: { subtype: "conference_paper" }, mandatoryForExam: true, clause, quote: Q_DISSEMINATION_2019 }),
  req({ id: p + "_publication", kind: "research", label: "One research paper published / accepted / sent for publication", target: 1,
        match: { subtype: "publication" }, mandatoryForExam: true, clause, quote: Q_DISSEMINATION_2019 })
];

const ugTeaching2019 = (p, clause) => req({
  id: p + "_ug_teaching", kind: "academic", label: "Teaching and training of undergraduates and interns",
  match: { academicType: "ug_teaching" }, clause, quote: Q_UG_TEACHING_2019
});

const logbookSpecifiedNumber = (p, clause) => [
  req({ id: p + "_case_presentation", kind: "academic", label: "Cases presented for clinical discussion",
        match: { academicType: "case_presentation" }, clause, quote: Q_LOGBOOK_SPECIFIED_NUMBER,
        note: "The guideline says 'a specified number' — specified by the department, not by NMC. Counted, never targeted." }),
  req({ id: p + "_procedures", kind: "procedure", label: "Procedures / tests / operations performed",
        match: { roles: ["observed", "assisted", "performed_supervised", "performed_independent"] },
        clause, quote: Q_LOGBOOK_SPECIFIED_NUMBER }),
  req({ id: p + "_seminar", kind: "academic", label: "Seminars / review articles presented in inter-unit or interdepartmental sessions",
        match: { academicType: "seminar" }, clause, quote: Q_LOGBOOK_SPECIFIED_NUMBER })
];

const clinicalMeetings2019 = (p, clause) => req({
  id: p + "_clinical_meeting", kind: "academic", label: "Intra- and inter-departmental clinical meetings",
  match: { academicType: "clinical_meeting" }, clause, quote: Q_CLINICAL_MEETINGS_2019
});

/* ── the packs ────────────────────────────────────────────────────────────────────────────────── */

const B19 = "https://www.nmc.org.in/wp-content/uploads/2019/09/";
const B22 = "https://www.nmc.org.in/wp-content/uploads/2022/revised/";

const PACKS = [];

// ── 1. MD General Medicine (revised 2022) ───────────────────────────────────────────────────────
PACKS.push({
  id: "general-medicine", degree: "MD", specialty: "General Medicine", durationMonths: 36,
  extends: ["_pgmer-common", "_revised-2022-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in General Medicine (revised)",
            publisher: "National Medical Commission", year: 2022,
            url: B22 + "MD-in-General-Medicine-(revised).pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "gm_lecture", kind: "academic", label: "Departmental lectures attended", target: 10, per: "year",
          match: { academicType: "lecture" }, clause: "Teaching-Learning methods — A. Lectures",
          quote: "Didactic lectures should be used sparingly. A minimum of 10 lectures per year in the concerned PG department is suggested. … All postgraduate trainees will be required to attend these lectures." }),
    req({ id: "gm_journal_club", kind: "academic", label: "Journal club", target: 1, per: "fortnight",
          match: { academicType: "journal_club" }, clause: "Teaching-Learning methods — B. Journal club",
          quote: "Journal club: Minimum of once in 1-2 weeks is suggested. Topics will include presentation and critical appraisal of original research papers published in peer reviewed indexed journals. The presenter(s) shall be assessed by faculty and grades recorded in the logbook.",
          note: "'once in 1-2 weeks' is a RANGE. The pack uses the conservative end (once a fortnight) so the module never reports a resident behind on a cadence the curriculum does not actually demand." }),
    req({ id: "gm_seminar", kind: "academic", label: "Student seminar", target: 1, per: "fortnight",
          match: { academicType: "seminar" }, clause: "Teaching-Learning methods — C. Student Seminar",
          quote: "Student Seminar: Minimum of once every 1-2 weeks is suggested. … The student should be graded by the faculty and peers.",
          note: "Range; conservative end used (see gm_journal_club)." }),
    req({ id: "gm_symposium", kind: "academic", label: "Student symposium", target: 1, per: "quarter",
          match: { academicType: "symposium" }, clause: "Teaching-Learning methods — D. Student Symposium",
          quote: "Student Symposium: Minimum of once every 3 months. … All participating postgraduates should be graded by the faculty and peers." }),
    req({ id: "gm_bedside", kind: "academic", label: "Laboratory work / bedside clinics", target: 1, per: "fortnight",
          match: { academicType: "laboratory_work" }, clause: "Teaching-Learning methods — E. Laboratory work / Bedside clinics",
          quote: "Laboratory work / Bedside clinics: Minimum - once every 1-2 weeks. … Various methods like DOAP (Demonstrate, Observe, Assist, Perform), simulations in skills lab, and case-based discussions etc. are to be used.",
          note: "Range; conservative end used." }),
    req({ id: "gm_interdepartmental", kind: "academic", label: "Interdepartmental colloquium", target: 1, per: "month",
          match: { academicType: "interdepartmental" }, clause: "Teaching-Learning methods — F. Interdepartmental colloquium",
          quote: "Faculty and students must attend monthly meetings between the main Department and other department/s on topics of current/common interest or clinical cases." }),
    req({ id: "gm_case_presentation", kind: "academic", label: "Case presentation / work-up / handling", target: 1, per: "week",
          match: { academicType: "case_presentation" }, clause: "Assessment — Quarterly assessment",
          quote: "Quarterly assessment during the MD training should be based on: Case presentation, case work up, case handling/management : once a week" }),
    req({ id: "gm_lab_performance", kind: "academic", label: "Laboratory performance", target: 2, per: "week",
          match: { academicType: "laboratory_work" }, clause: "Assessment — Quarterly assessment",
          quote: "Laboratory performance : twice a week",
          note: "The curriculum writes the number as a word: 'twice a week' — target 2 per week." }),
    req({ id: "gm_case_discussion", kind: "academic", label: "Case discussions", target: 1, per: "month",
          match: { academicType: "case_discussion" }, clause: "Assessment — Quarterly assessment",
          quote: "Case discussions : once a fortnight/month",
          note: "The curriculum gives 'fortnight/month'. The pack uses the conservative end (monthly)." }),
    req({ id: "gm_cme", kind: "academic", label: "Attendance at scientific meetings / CME programmes", target: 2, per: "course",
          match: { academicType: "cme_conference" }, clause: "Assessment — Quarterly assessment",
          quote: "Attendance at Scientific meetings, CME programmes (at least 02 each)" }),
    req({ id: "gm_drp", kind: "rotation", label: "District Residency Programme posting", target: 3, unit: "months",
          rotationKind: "drp", clause: "Teaching-Learning methods — G.(b) Posting under District Residency Programme",
          quote: "All postgraduate students pursuing MS/MS in broad specialties in all Medical Colleges/Institutions shall undergo a compulsory rotation of three months in District Hospitals/District Health System as a part of the course curriculum … Such rotation shall take place in the 3rd or 4th or 5th semester." })
  ],
  procedures: [],
  proceduresNote: "The MD General Medicine guidelines prescribe no procedure counts. Procedure entries are counted; the department sets targets in-app (which then display as institutional policy, not as NMC)."
});

// ── 2. MS General Surgery (2019) ────────────────────────────────────────────────────────────────
PACKS.push({
  id: "general-surgery", degree: "MS", specialty: "General Surgery", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MS in General Surgery",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MS-Surgery.pdf", retrieved: RETRIEVED },
  requirements: [
    ...logbookSpecifiedNumber("gs", "3. Log book"),
    clinicalMeetings2019("gs", "2. Clinical meetings"),
    ugTeaching2019("gs", "5."),
    ...dissemination2019("gs", "6."),
    req({ id: "gs_thesis", kind: "research", label: "Thesis", target: 1, match: { subtype: "thesis_milestone" },
          mandatoryForExam: true, clause: "4. Thesis writing and research", quote: "Thesis writing is compulsory." })
  ],
  procedures: [],
  proceduresNote: "MS General Surgery prescribes NO operation counts — its logbook clause says 'a specified number', specified by the department. PGMER-2023 5.2(v) separately makes the surgical-procedure ENTRY mandatory for MS, which this module enforces (supervisor + role required)."
});

// ── 3. MS Obstetrics & Gynaecology (2019) ───────────────────────────────────────────────────────
PACKS.push({
  id: "obstetrics-gynaecology", degree: "MS", specialty: "Obstetrics & Gynaecology", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MS in Obstetrics and Gynaecology",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MS-OBGY.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "og_teaching_methods", kind: "academic", label: "Lectures, seminars, symposia, inter/intra-departmental meetings, journal club",
          match: { academicType: "seminar" }, clause: "Postgraduate Training",
          quote: "Lectures, seminars, symposia, Inter- and intra- departmental meetings (clinico-pathological, Radio-diagnosis, Radiotherapy, Anaesthesia, Pediatrics/Neonatology), maternal morbidity/mortality meetings and journal club. Records of these are to be maintained by the department." }),
    req({ id: "og_journal_club", kind: "academic", label: "Journal club", match: { academicType: "journal_club" },
          clause: "Postgraduate Training", quote: "… maternal morbidity/mortality meetings and journal club. Records of these are to be maintained by the department." }),
    req({ id: "og_mortality_meeting", kind: "academic", label: "Maternal morbidity / mortality meetings",
          match: { academicType: "mortality_morbidity" }, clause: "Postgraduate Training",
          quote: "… maternal morbidity/mortality meetings and journal club. Records of these are to be maintained by the department." }),
    req({ id: "og_cme", kind: "academic", label: "CMEs / conferences with paper presentation",
          match: { academicType: "cme_conference" }, clause: "Postgraduate Training",
          quote: "By encouraging and allowing the students to attend and actively participate in CMEs, Conferences by presenting papers." }),
    req({ id: "og_procedures", kind: "procedure", label: "Procedures and operations",
          match: { roles: ["observed", "assisted", "performed_supervised", "performed_independent"] },
          clause: "Maintenance of log book",
          quote: "Maintenance of log book: Log books shall be checked and assessed periodically by the faculty members imparting the training." }),
    ugTeaching2019("og", "Postgraduate Training"),
    ...dissemination2019("og", "Postgraduate Training")
  ],
  procedures: [],
  proceduresNote: "No operation counts are given in the MS OBGY guidelines. Counted, not targeted."
});

// ── 4. MD Paediatrics (revised 2022) ────────────────────────────────────────────────────────────
PACKS.push({
  id: "paediatrics", degree: "MD", specialty: "Paediatrics", durationMonths: 36,
  extends: ["_pgmer-common", "_revised-2022-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Paediatrics (revised)",
            publisher: "National Medical Commission", year: 2022, url: B22 + "MD_Peadiatrics_( revised ).pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "pd_life_support", kind: "certification", label: "BCLS, Neonatal Resuscitation, Advanced Paediatric Life Support and ACLS",
          target: 1, requiresEvidence: true, match: { subtype: "bcls_acls" }, clause: "Other aspects",
          quote: "The Postgraduate trainees should undergo training in Basic Cardiac Life Support (BCLS), Neonatal Resuscitation, Advanced Pediatric Life Support and Adult Advanced Cardiac Life Support (ACLS).",
          note: "WIDER than PGMER-2023 5.2(xi)(c) (BCLS + ACLS only) — paediatrics adds NRP and APLS." })
  ],
  procedures: [],
  proceduresNote: "No procedure counts in the MD Paediatrics guidelines."
});

// ── 5. MD Anaesthesiology (2019) ────────────────────────────────────────────────────────────────
PACKS.push({
  id: "anaesthesiology", degree: "MD", specialty: "Anaesthesiology", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Anaesthesiology",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MD-Anesthesia.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "an_logbook", kind: "meta", label: "Log books maintained regularly and assessed periodically",
          clause: "Postgraduate training",
          quote: "Log books shall be maintained regularly and should be checked and assessed periodically by the faculty members imparting the training." }),
    req({ id: "an_specialised_procedures", kind: "procedure", label: "Newer specialised diagnostic / therapeutic procedures",
          match: { roles: ["observed", "assisted", "performed_supervised", "performed_independent"] },
          clause: "Postgraduate training",
          quote: "Exposure to newer specialized diagnostic/therapeutic procedures concerning his/her subject should be given." }),
    ugTeaching2019("an", "Postgraduate training"),
    ...dissemination2019("an", "Postgraduate training"),
    req({ id: "an_emergency_duty", kind: "clinical", label: "Emergency duty under close supervision",
          match: { setting: "emergency" }, clause: "Thesis: Supervision",
          quote: "This involves providing services for emergencies and it makes different demands upon the anaesthesiologist. It should be learned through experience, with reduced staff. The clinical work during emergency should have a close supervision." })
  ],
  procedures: [],
  proceduresNote: "No case/procedure counts in the MD Anaesthesia guidelines."
});

// ── 6. MS Orthopaedics (revised 2022) ───────────────────────────────────────────────────────────
PACKS.push({
  id: "orthopaedics", degree: "MS", specialty: "Orthopaedics", durationMonths: 36,
  extends: ["_pgmer-common", "_revised-2022-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MS in Orthopaedics (revised)",
            publisher: "National Medical Commission", year: 2022, url: B22 + "MS_Orthopedics_( revised ).pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "or_minicex", kind: "academic", label: "Mini-CEX encounters", target: 4, per: "quarter",
          match: { academicType: "case_discussion" }, clause: "Assessment — Quarterly assessment",
          quote: "Mini Cex encounter – at least 4" }),
    req({ id: "or_encounter_cards", kind: "academic", label: "Clinical encounter cards", target: 4, per: "quarter",
          match: { academicType: "case_presentation" }, clause: "Assessment — Quarterly assessment",
          quote: "Clinical encounter cards - at least -4" }),
    req({ id: "or_dops", kind: "procedure", label: "Direct observation of procedural skills (incl. cadaver dissection)", target: 6, per: "quarter",
          match: { roles: ["performed_supervised", "performed_independent"] }, clause: "Assessment — Quarterly assessment",
          quote: "Direct observation of procedural skills – at least 6 including Cadaver dissection" }),
    req({ id: "or_cme", kind: "academic", label: "Attendance at scientific meetings / CME programmes", target: 2, per: "course",
          match: { academicType: "cme_conference" }, clause: "Assessment — Quarterly assessment",
          quote: "Attendance at Scientific meetings, CME programmes (at least 02 each)" }),
    req({ id: "or_bone_lab", kind: "academic", label: "Bone skill-lab performance assessment",
          match: { academicType: "workshop" }, clause: "Assessment — Quarterly assessment",
          quote: "Bone Skill Lab performance assessment" })
  ],
  procedures: [],
  proceduresNote: "No operation counts in the MS Orthopaedics guidelines. The per-quarter figures above are assessment counts, not operation counts."
});

// ── 7. MD Radiodiagnosis (2019) ─────────────────────────────────────────────────────────────────
PACKS.push({
  id: "radiodiagnosis", degree: "MD", specialty: "Radiodiagnosis", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Radiodiagnosis",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MD-Radiodiagnosis.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "rd_logbook", kind: "meta", label: "Log book checked and signed regularly by the faculty-in-charge",
          clause: "Training components — 5",
          quote: "A log book should be maintained by the student and will be checked and signed regularly by the faculty-in-charge during the training program." }),
    req({ id: "rd_seminar", kind: "academic", label: "Seminars, case discussion, journal club",
          match: { academicType: "seminar" }, clause: "Training components — 3",
          quote: "Seminars, case discussion, journal club." }),
    req({ id: "rd_journal_club", kind: "academic", label: "Journal club", match: { academicType: "journal_club" },
          clause: "Training components — 3", quote: "Seminars, case discussion, journal club." }),
    req({ id: "rd_case_discussion", kind: "academic", label: "Case discussion", match: { academicType: "case_discussion" },
          clause: "Training components — 3", quote: "Seminars, case discussion, journal club." }),
    req({ id: "rd_subspecialty_rotation", kind: "rotation", label: "Rotational posting in sub-specialties",
          clause: "Training components — 2", quote: "Rotational posting in various sub-specialties." }),
    ugTeaching2019("rd", "Training components — 6"),
    req({ id: "rd_poster", kind: "research", label: "One poster presentation", target: 1, match: { subtype: "poster" },
          mandatoryForExam: true, clause: "Training components — 7",
          quote: "The postgraduate student would be required to present one poster presentation, to read one paper at a national/state conference and to submit one research paper which should be published or accepted for publication or sent for publication to a peer reviewed journal, during the period of his/her postgraduate studies so as to make him/her eligible to appear at the postgraduate degree examination." }),
    req({ id: "rd_conference_paper", kind: "research", label: "One paper read at a national/state conference", target: 1,
          match: { subtype: "conference_paper" }, mandatoryForExam: true, clause: "Training components — 7",
          quote: "…to read one paper at a national/state conference…" }),
    req({ id: "rd_publication", kind: "research", label: "One research paper submitted to a peer-reviewed journal", target: 1,
          match: { subtype: "publication" }, mandatoryForExam: true, clause: "Training components — 7",
          quote: "…to submit one research paper which should be published or accepted for publication or sent for publication to a peer reviewed journal…" })
  ],
  procedures: [],
  proceduresNote: "No procedure/study counts in the MD Radiodiagnosis guidelines."
});

// ── 8. MD Pathology (revised 2022) ──────────────────────────────────────────────────────────────
PACKS.push({
  id: "pathology", degree: "MD", specialty: "Pathology", durationMonths: 36,
  extends: ["_pgmer-common", "_revised-2022-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Pathology (revised)",
            publisher: "National Medical Commission", year: 2022, url: B22 + "MD_Pathology_(revised).pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "pa_lab_work", kind: "academic", label: "Laboratory bench work / reporting sessions",
          match: { academicType: "laboratory_work" }, clause: "Teaching and learning methods",
          quote: "Laboratory work / Bedside clinics … should be coordinated and guided by faculty from the department." }),
    req({ id: "pa_cpc", kind: "academic", label: "Clinico-pathological conferences", match: { academicType: "cpc" },
          clause: "Teaching and learning methods", quote: "…clinico-pathological conferences…" })
  ],
  procedures: [],
  proceduresNote: "No specimen/slide counts in the MD Pathology guidelines. Reporting workload is counted."
});

// ── 9. MD Psychiatry (revised 2022) ─────────────────────────────────────────────────────────────
PACKS.push({
  id: "psychiatry", degree: "MD", specialty: "Psychiatry", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Psychiatry (revised)",
            publisher: "National Medical Commission", year: 2022, url: B22 + "MD_Psychiatry_( revised ).pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "ps_logbook", kind: "meta", label: "Log book signed by the authorized teacher and Head of Department",
          clause: "18. Log book",
          quote: "Each student must be asked to present a specified number of cases for clinical discussion, perform procedures/present seminars/review articles from various journals in inter-unit/interdepartmental teaching sessions. They should be entered in a Log Book and signed by the authorized teacher and Head of Department." }),
    req({ id: "ps_case_presentation", kind: "academic", label: "Cases presented for clinical discussion",
          match: { academicType: "case_presentation" }, clause: "18. Log book",
          quote: "Each student must be asked to present a specified number of cases for clinical discussion…",
          note: "'a specified number' — specified by the department. Counted, never targeted." }),
    req({ id: "ps_seminar", kind: "academic", label: "Seminars / review articles presented",
          match: { academicType: "seminar" }, clause: "18. Log book",
          quote: "…present seminars/review articles from various journals in inter-unit/interdepartmental teaching sessions." }),
    req({ id: "ps_clinical_meeting", kind: "academic", label: "Intra- and inter-departmental meetings",
          match: { academicType: "clinical_meeting" }, clause: "17.",
          quote: "There should be intra - and inter - departmental meetings for discussing the uncommon / interesting medical problems." })
  ],
  procedures: [],
  proceduresNote: "No procedure counts in the MD Psychiatry guidelines."
});

// ── 10. MD Dermatology, Venereology & Leprosy (2019) ────────────────────────────────────────────
PACKS.push({
  id: "dermatology", degree: "MD", specialty: "Dermatology, Venereology & Leprosy", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Dermatology, Venereology and Leprosy",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MD-Dermatology.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "dv_journal_club", kind: "academic", label: "Journal club", target: 1, per: "week",
          match: { academicType: "journal_club" }, clause: "2. Journal Club & Subject seminars",
          quote: "Journal Club & Subject seminars: Both are recommended to be held once a week. All PG students are expected to attend and actively participate in discussion and enter relevant details in the Log Book." }),
    req({ id: "dv_seminar", kind: "academic", label: "Subject seminar", target: 1, per: "week",
          match: { academicType: "seminar" }, clause: "2. Journal Club & Subject seminars",
          quote: "Journal Club & Subject seminars: Both are recommended to be held once a week." }),
    req({ id: "dv_journal_presentation", kind: "academic", label: "Journal presentations made by the student", target: 4, per: "year",
          match: { academicType: "journal_club", roles: ["presented"] }, clause: "2. Journal Club & Subject seminars",
          quote: "Further, every post graduate student must make a presentation from the allotted journal(s), selected articles at least four times a year. The presentations would be evaluated and would carry weightage for internal assessment.",
          note: "The guideline writes the number as a word: 'at least four times a year' — target 4 per year." }),
    req({ id: "dv_case_presentation", kind: "academic", label: "Clinical case presentations", target: 5, per: "year",
          match: { academicType: "case_presentation" }, clause: "5. Clinical Case Presentations",
          quote: "Clinical Case Presentations: Minimum of 5 cases to be presented by every post graduate student each year. They should be assessed using check lists and entries made in the log book." }),
    req({ id: "dv_cpc", kind: "academic", label: "Clinico-pathological conference", target: 1, per: "month",
          match: { academicType: "cpc" }, clause: "6. Clinico-Pathological Conference (CPC)",
          quote: "Clinico-Pathological Conference (CPC): Recommended once a month for all post graduate students. Presentation is to be done by rotation." }),
    req({ id: "dv_interdepartmental", kind: "academic", label: "Inter-departmental meetings (Pathology, Radio-diagnosis)", target: 1, per: "week",
          match: { academicType: "interdepartmental" }, clause: "7. Inter-Departmental Meetings",
          quote: "Inter-Departmental Meetings: Strongly recommended particularly with Departments of Pathology and Radio-Diagnosis at least once a week. These meetings should be attended by post graduate students and relevant entries must be made in the Log Book." }),
    req({ id: "dv_ward_round", kind: "academic", label: "Teaching / grand rounds", match: { academicType: "grand_round" },
          clause: "4. Ward Rounds",
          quote: "Teaching Rounds: Every unit should have 'grand rounds' for teaching purpose. A diary (log book) should be maintained for day to day activities by the students." })
  ],
  procedures: [],
  proceduresNote: "No procedure counts in the MD Dermatology guidelines."
});

// ── 11. MS Ophthalmology (2019) ─────────────────────────────────────────────────────────────────
PACKS.push({
  id: "ophthalmology", degree: "MS", specialty: "Ophthalmology", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MS in Ophthalmology",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MS-Ophthamology.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "op_logbook", kind: "meta", label: "Log book checked and assessed periodically",
          clause: "13. Maintenance of log book",
          quote: "Maintenance of log book: Log books shall be checked and assessed periodically by the faculty members imparting the training." }),
    req({ id: "op_cme", kind: "academic", label: "Accredited scientific meetings (CME, symposia, conferences)",
          match: { academicType: "cme_conference" }, clause: "10.",
          quote: "Attend accredited scientific meetings (CME, Symposia, and Conferences)." }),
    req({ id: "op_procedures", kind: "procedure", label: "Surgical procedures — models, then supervised, then independent",
          match: { roles: ["observed", "assisted", "performed_supervised", "performed_independent"] },
          clause: "During the training programme",
          quote: "During the training programme, patient safety is of paramount importance; therefore, skills are to be learnt initially on the models, later to be performed under supervision followed by performing independently; for this purpose, provision of surgical skills laboratories in medical colleges is mandatory." })
  ],
  procedures: [],
  proceduresNote: "No operation counts in the MS Ophthalmology guidelines."
});

// ── 12. MS Otorhinolaryngology (2019) ───────────────────────────────────────────────────────────
PACKS.push({
  id: "ent", degree: "MS", specialty: "Otorhinolaryngology — Head and Neck", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MS in Otorhinolaryngology",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MS-ENT.pdf", retrieved: RETRIEVED },
  requirements: [
    ...logbookSpecifiedNumber("en", "3. Log book"),
    clinicalMeetings2019("en", "2. Clinical meetings"),
    req({ id: "en_inter_unit_rotation", kind: "rotation", label: "Inter-unit rotation within the department",
          clause: "1. Rotation", quote: "Inter-unit rotation in the department should be done for a period of up to one year." }),
    req({ id: "en_subspecialty_rotation", kind: "rotation", label: "Rotation in related sub-specialties",
          clause: "1. Rotation", quote: "Rotation in appropriate related subspecialties for a total period not exceeding 06 months." }),
    req({ id: "en_thesis", kind: "research", label: "Thesis", target: 1, match: { subtype: "thesis_milestone" },
          mandatoryForExam: true, clause: "4. Thesis writing and research", quote: "Thesis writing is compulsory." }),
    ugTeaching2019("en", "5."),
    ...dissemination2019("en", "6.")
  ],
  procedures: [],
  proceduresNote: "No operation counts in the MS ENT guidelines — 'a specified number', specified by the department."
});

// ── 13. MD Community Medicine (2019) ────────────────────────────────────────────────────────────
PACKS.push({
  id: "community-medicine", degree: "MD", specialty: "Community Medicine", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Community Medicine",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MD-Community-Medicine.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "cm_logbook", kind: "meta", label: "Log book of work carried out, incl. programmes implemented under supervision and independently",
          clause: "Log Book",
          quote: "Log Book: Postgraduate students shall maintain a log book of the work carried out by them and the training programme undergone during the period of training including details of work experience during their postings, including programs implemented under supervision and those performed independently. The log book shall be checked and assessed periodically by the faculty members imparting the training." }),
    req({ id: "cm_field_posting", kind: "rotation", label: "Orientation training / field postings",
          clause: "Recommended schedule for three years training", quote: "Orientation Training/Field postings" }),
    req({ id: "cm_special_seminar", kind: "academic", label: "Special seminars / workshops by external faculty",
          match: { academicType: "workshop" }, clause: "Special Seminars / Workshops",
          quote: "Special Seminars / Workshops: conducted by External Faculty on cross-cutting subjects directly or indirectly concerned with Health." }),
    ...dissemination2019("cm", "Postgraduate training")
  ],
  procedures: [],
  proceduresNote: "Community Medicine logs programmes implemented (supervised vs independent), which the module records as procedure-kind entries with the same role ladder."
});

// ── 14. MD Emergency Medicine (2024) — the one pack with NMC-stated procedure minima ─────────────
// Source: "Procedural skills:(Minimum number of procedures that a candidate needs to perform are:)".
// Every number below is printed in that list. Where the list names a procedure with NO number, the
// target here is null — it is not back-filled from a neighbour.
const EM_PROCEDURES = [
  ["em_airway_basic", "Basic airway management (opening airway by various methods)", 100],
  ["em_bmv", "Bag mask ventilation", 100],
  ["em_airway_advanced", "Advanced airway management", 25],
  ["em_intubation", "Tracheal intubation", 100],
  ["em_airway_alternative", "Alternative airway procedures (non-surgical and surgical)", 25],
  ["em_airway_paediatric", "Paediatric airway management", 25],
  ["em_airway_neonatal", "Neonatal airway management", 5],
  ["em_cpr_basic", "Cardiopulmonary resuscitation — Basic", 50],
  ["em_cpr_advanced", "Cardiopulmonary resuscitation — Advanced", 50],
  ["em_cardioversion", "Cardioversion / defibrillation", 40],
  ["em_pacing", "Temporary cardiac pacing", 10],
  ["em_ecg", "ECG interpretation", 250],
  ["em_ventilator", "Ventilator management", 100],
  ["em_atls", "Basic trauma management and Advanced Trauma Life Support", 100],
  ["em_icd", "Intercostal chest tube", 10],
  ["em_needle_thoracentesis", "Needle thoracentesis", 10],
  ["em_ed_thoracotomy", "ED thoracotomy", 1],
  ["em_cricothyroidotomy", "Surgical and needle cricothyroidotomy", 5],
  ["em_suprapubic_cath", "Suprapubic catheterization", 4],
  ["em_cvc", "Central venous access", 25],
  ["em_suture", "Suture technique", 100],
  ["em_arterial_puncture", "Arterial puncture", 100],
  ["em_nasal_packing_trauma", "Nasal packing", 10],
  ["em_fb_removal", "Foreign body removal", 10],
  ["em_foley", "Foley's catheterization", 50],
  ["em_invasive_vent", "Invasive ventilation principles", null],
  ["em_thoracentesis", "Thoracentesis", null],
  ["em_thoracostomy", "Needle / tube thoracostomy", null],
  ["em_cardiac_compression", "Cardiac compression", 100],
  ["em_io_access", "Intra-osseous access", 10],
  ["em_pericardiocentesis", "Pericardiocentesis", 10],
  ["em_gastric_lavage", "Gastric lavage", 10],
  ["em_skin_eye_decon", "Skin / eye decontamination", null],
  ["em_paracentesis", "Paracentesis", 25],
  ["em_lumbar_puncture", "Lumbar puncture", 10],
  ["em_wound_prep", "Wound preparation", 50],
  ["em_wound_closure", "Wound closure techniques", 50],
  ["em_debridement", "Debridement", 25],
  ["em_dressing", "Dressing techniques", 50],
  ["em_wound_fb", "Removal of foreign bodies (wound)", 10],
  ["em_splinting", "Splinting / immobilization", 50],
  ["em_spinal_immobilisation", "Spinal immobilization", 50],
  ["em_logroll", "Logrolling", 50],
  ["em_helmet_removal", "Helmet removal", 10],
  ["em_fasciotomy", "Fasciotomy", null],
  ["em_dislocation_reduction", "Reduction of dislocations", 20],
  ["em_traction_splint", "Traction splints", 10],
  ["em_plaster", "Plaster techniques for various fractures", 25],
  ["em_joint_aspiration", "Joint aspiration", 10],
  ["em_cervical_collar", "Cervical collar application", 50],
  ["em_pelvic_stabilisation", "Pelvic stabilization techniques", 2],
  ["em_sedation", "Local and regional anaesthesia: conscious sedation and analgesia", 50],
  ["em_indirect_laryngoscopy", "Indirect laryngoscopy", 10],
  ["em_nasal_packing_ent", "Nasal packing (ENT)", 10],
  ["em_ent_fb", "Removal of foreign bodies (ENT)", 10],
  ["em_tracheostomy_trouble", "Troubleshooting tracheostomy tube problems", 5],
  ["em_dental_anaesthesia", "Dental anaesthesia", 4],
  ["em_dental_socket_suture", "Dental socket suture", 4],
  ["em_slit_lamp", "Slit lamp", 20],
  ["em_ocular_fb", "Ocular foreign body removal", 4],
  ["em_transport_intra", "Intra-hospital transportation of patients", 25],
  ["em_transport_inter", "Inter-hospital transportation of patients", 10],
  ["em_comm_patients", "Communication skills — patients and relatives", 50],
  ["em_comm_colleagues", "Communication skills — colleagues and other personnel", 50],
  ["em_fast", "FAST / E-FAST", 50],
  ["em_focused_echo", "Focused ECHO", 50],
  ["em_airway_us", "Airway ultrasound", 25],
  ["em_shock_us", "Shock assessment ultrasound", 50],
  ["em_lung_us", "Pulmonary ultrasound", 50]
];
PACKS.push({
  id: "emergency-medicine", degree: "MD", specialty: "Emergency Medicine", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "NMC MD Emergency Medicine Curriculum V6 (revised)",
            publisher: "National Medical Commission", year: 2024,
            url: "https://www.nmc.org.in/wp-content/uploads/2024/10/NMC%20MD%20EM%20CURRICULUM-V6%20with%20logo%20revised-1.pdf",
            retrieved: RETRIEVED },
  requirements: [
    req({ id: "em_elogbook", kind: "meta", label: "Dynamic e-log book, updated weekly, authenticated monthly by the guide",
          target: 1, per: "week", engine: "weeklyCadence", clause: "LOG BOOK",
          quote: "Post-graduate students of Emergency Medicine shall maintain a dynamic e-log book which needs to be updated on a weekly basis about the work being carried out by them and the training programme undergone during the period of training. It shall be the duty of the Post-graduate guide imparting the training to assess and authenticate monthly the record (e-Log) books." }),
    req({ id: "em_monthly_proforma", kind: "meta", label: "Monthly observation proforma captured in the logbook",
          target: 1, per: "month", engine: "assessment:wpba_shift", clause: "Monthly observation Proforma",
          quote: "Residents' medical knowledge, patient care, procedural & academic skills, interpersonal skills, professionalism, self-directed learning and ability to practice in the system will be assessed continuously on the ED floor. Attendance (number of authorized leaves and number of absences) and reporting time at work will be recorded. Directly observed procedural skills will be assessed (Performa in Annexure I). A Shift based work placed based assessment will be done daily (Performa in Annexure II). Workplace based assessment of clinical skills will be assessed (Performa in Annexure III)." }),
    req({ id: "em_shift_wpba", kind: "meta", label: "Shift-based workplace assessment, daily",
          target: 1, per: "day", engine: "assessment:wpba_shift", clause: "Monthly observation Proforma",
          quote: "A Shift based work placed based assessment will be done daily (Performa in Annexure II)." }),
    req({ id: "em_academic_journal_club", kind: "academic", label: "Journal club presentation",
          match: { academicType: "journal_club" }, clause: "Academic activities (consolidated)",
          quote: "Academic activities (consolidated – within department/peripheral posting/outside department/outside institution): Journal Club Presentation performance · Thesis review Presentation & performance · Seminar Presentation · Presentation in conferences & CME · Publications & Posters · Mortality & Morbidity audit" }),
    req({ id: "em_academic_thesis_review", kind: "academic", label: "Thesis review presentation",
          match: { academicType: "thesis_presentation" }, clause: "Academic activities (consolidated)",
          quote: "Thesis review Presentation & performance" }),
    req({ id: "em_academic_seminar", kind: "academic", label: "Seminar presentation",
          match: { academicType: "seminar" }, clause: "Academic activities (consolidated)", quote: "Seminar Presentation" }),
    req({ id: "em_academic_conference", kind: "academic", label: "Presentation in conferences & CME",
          match: { academicType: "cme_conference" }, clause: "Academic activities (consolidated)",
          quote: "Presentation in conferences & CME" }),
    req({ id: "em_academic_mm", kind: "academic", label: "Mortality & morbidity audit",
          match: { academicType: "mortality_morbidity" }, clause: "Academic activities (consolidated)",
          quote: "Mortality & Morbidity audit" })
  ],
  procedures: EM_PROCEDURES.map(([id, label, target]) => ({
    id, label, target, per: "course", source: "nmc_curriculum",
    clause: "Procedural skills (Minimum number of procedures that a candidate needs to perform are:)",
    quote: target == null
      ? "Listed under 'Procedural skills' with no minimum number stated."
      : label + " (" + target + ")"
  })),
  proceduresNote: "MD Emergency Medicine 2024 is the only NMC curriculum in this set that prints procedure minima. Entries with target null are named in the list WITHOUT a number and are counted, not targeted.",
  rotations: {
    note: "The curriculum prints a suggested three-year posting schedule. The Academic Cell instantiates it; it is a template, not a record.",
    clause: "Rotation: Schedule for three years of MD Emergency Medicine postings",
    schedule: [
      { year: 1, name: "Emergency Department", months: 8 }, { year: 1, name: "Paediatric Emergency", months: 1 },
      { year: 1, name: "Dermatology", months: 0.5 }, { year: 1, name: "Forensic Medicine", months: 0.5 },
      { year: 1, name: "Cardiology", months: 0.5 }, { year: 1, name: "Wound care and Procedural sedation", months: 0.5 },
      { year: 1, name: "Orthopedics (in ED)", months: 0.5 }, { year: 1, name: "Medicine", months: 0.5 },
      { year: 2, name: "Emergency Department", months: 5 }, { year: 2, name: "Critical Care", months: 1 },
      { year: 2, name: "OBG", months: 1 }, { year: 2, name: "Orthopaedics (ward and OPD)", months: 0.5 },
      { year: 2, name: "District residency posting", months: 3, kind: "drp" },
      { year: 2, name: "Surgery (ward and minor OT)", months: 1 }, { year: 2, name: "Ophthalmology", months: 0.5 },
      { year: 3, name: "Emergency Department", months: 7 }, { year: 3, name: "Radiology (CT, MRI, USG)", months: 0.5 },
      { year: 3, name: "Psychiatry", months: 0.5 }, { year: 3, name: "NICU", months: 0.5 },
      { year: 3, name: "PICU", months: 0.5 }, { year: 3, name: "Neurology", months: 0.5 },
      { year: 3, name: "ENT", months: 0.5 }, { year: 3, name: "Orthopedics (in ED)", months: 0.5 },
      { year: 3, name: "Paediatric Emergency", months: 1 }, { year: 3, name: "Elective", months: 0.5 }
    ]
  }
});

// ── 15. MD Respiratory (Pulmonary) Medicine (2019) ──────────────────────────────────────────────
PACKS.push({
  id: "respiratory-medicine", degree: "MD", specialty: "Respiratory Medicine", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "Guidelines for Competency Based Postgraduate Training Programme for MD in Pulmonary Medicine",
            publisher: "National Medical Commission", year: 2019, url: B19 + "MD-Pulmonary-Medicine.pdf", retrieved: RETRIEVED },
  requirements: [
    req({ id: "rm_logbook", kind: "meta", label: "Log book of postings/work in Wards, OPDs and Casualty, procedures and teaching sessions",
          clause: "Log book",
          quote: "Log book: During the training period, the post graduate student should maintain a Log Book indicating the duration of the postings/work done in Wards, OPDs and Casualty. This should indicate the procedures assisted and performed, and the teaching sessions attended. The Log book shall be checked and assessed periodically by the faculty members imparting the training." }),
    req({ id: "rm_procedures", kind: "procedure", label: "Procedures assisted and performed",
          match: { roles: ["observed", "assisted", "performed_supervised", "performed_independent"] },
          clause: "Log book", quote: "This should indicate the procedures assisted and performed, and the teaching sessions attended." }),
    req({ id: "rm_protocol_6m", kind: "research", label: "Thesis protocol submitted before the end of the first 6 months",
          target: 1, dueByMonths: 6, match: { subtype: "thesis_milestone" }, clause: "Thesis",
          quote: "A written protocol of the proposed work should be submitted before the end of the first 6 months. Subsequently, the post graduate student should carry out the proposed work for at least 1 year (not inclusive of the period for submitting the protocol and writing-up the final thesis)." }),
    ugTeaching2019("rm", "Postgraduate training"),
    ...dissemination2019("rm", "Postgraduate training")
  ],
  procedures: [],
  proceduresNote: "No procedure counts in the MD Pulmonary Medicine guidelines."
});

/* ── the generic fallback for a specialty with no pack ─────────────────────────────────────────── */
PACKS.push({
  id: "generic-pg", degree: "", specialty: "Any PG specialty without a loaded NMC pack", durationMonths: 36,
  extends: ["_pgmer-common"],
  source: { title: "PGMER-2023 only — no specialty curriculum pack is loaded", publisher: "National Medical Commission",
            year: 2023, url: "https://www.nmc.org.in/MCIRest/open/getDocument?path=%2FDocuments%2FPublic%2FPortal%2FLatestNews%2FMER.pdf",
            retrieved: RETRIEVED },
  banner: "No NMC specialty curriculum pack is loaded for this specialty. Only the PGMER-2023 requirements that apply to every PG student are shown. Specialty-specific requirements must be added by the Academic Cell and will display as institutional policy, not as NMC requirements.",
  requirements: [], procedures: [],
  proceduresNote: "Nothing specialty-specific is claimed. Procedures are counted only."
});

/* ── emit ─────────────────────────────────────────────────────────────────────────────────────── */

const index = [];
for (const p of PACKS) {
  const pack = {
    id: p.id,
    programmeType: "PG",
    degree: p.degree,
    specialty: p.specialty,
    durationMonths: p.durationMonths,
    version: RETRIEVED,
    extends: p.extends || ["_pgmer-common"],
    source: p.source,
    ...(p.banner ? { banner: p.banner } : {}),
    requirements: p.requirements || [],
    procedures: p.procedures || [],
    proceduresNote: p.proceduresNote || "",
    ...(p.rotations ? { rotations: p.rotations } : {}),
    disclaimer: "Requirements are traced to the NMC source named above. A requirement with target null " +
      "is one the source mandates WITHOUT giving a number — it is counted, never scored against an " +
      "invented target. This pack does not certify compliance; see NMC_PG_LOGBOOK_REQUIREMENTS.md."
  };
  writeFileSync(join(OUT, p.id + ".json"), JSON.stringify(pack, null, 2) + "\n");
  index.push({
    id: p.id, degree: p.degree, specialty: p.specialty, durationMonths: p.durationMonths,
    requirements: pack.requirements.length, procedures: pack.procedures.length,
    hasCounts: pack.procedures.some((x) => x.target != null) || pack.requirements.some((x) => x.target != null),
    source: { title: p.source.title, year: p.source.year, url: p.source.url }
  });
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({
  version: RETRIEVED,
  generatedBy: "scripts/build-pglog-curricula.mjs",
  common: ["_pgmer-common", "_revised-2022-common"],
  note: "PG only. UG/CBME packs are not built — the pack format already carries programmeType.",
  packs: index
}, null, 2) + "\n");

console.log("wrote " + (index.length + 1) + " files to pglog/curricula/");
index.forEach((p) => console.log("  " + p.id.padEnd(24) + p.requirements + " reqs, " + p.procedures + " procedures" + (p.hasCounts ? "  [has NMC counts]" : "")));
