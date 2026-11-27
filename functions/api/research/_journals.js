/* ResearchMD Phase 5B.3 journal records + matching (ES module, server side).
 * Contract: docs/research/contracts/phase-6/journals.md. The seed below is the
 * SAME data as docs/research/contracts/phase-6/journals.seed.json (a test
 * asserts deep equality so the two cannot drift); Pages functions do not read
 * docs at runtime, so the module embeds it and lazy-seeds research_journals
 * with INSERT OR IGNORE (the global-reasons pattern).
 *
 * Integrity: knowledge snapshot 2026-11-24, NOT live-verified. checkedTs is
 * null until a source check lands; uncertain values are null (plan rule 4).
 * Matching is deterministic keyword/design scoring; no LLM.
 */

export const JOURNAL_SEED = [
  {
    id: "nejm", name: "New England Journal of Medicine", issn: "0028-4793",
    scope: ["general medicine", "internal medicine", "clinical trials", "randomized controlled trials", "cohort studies", "original research"],
    designs: ["rct", "cohort", "observational", "narrative_review"],
    authorInstructionsUrl: "https://www.nejm.org/author-center",
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "lancet", name: "The Lancet", issn: "0140-6736",
    scope: ["general medicine", "global health", "public health", "clinical trials", "randomized controlled trials", "cohort studies"],
    designs: ["rct", "cohort", "observational", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "jama", name: "JAMA", issn: "0098-7484",
    scope: ["general medicine", "internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://jamanetwork.com/journals/jama/pages/instructions-for-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "ama", checkedTs: null,
  },
  {
    id: "bmj", name: "The BMJ", issn: "0959-8138",
    scope: ["general medicine", "primary care", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "public health"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://www.bmj.com/about-bmj/resources-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "annals", name: "Annals of Internal Medicine", issn: "0003-4819",
    scope: ["internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "clinical practice"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: null, checkedTs: null,
  },
  {
    id: "plos_medicine", name: "PLOS Medicine", issn: "1549-1277",
    scope: ["general medicine", "public health", "global health", "clinical trials", "systematic reviews", "meta-analysis", "observational studies", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://journals.plos.org/plosmedicine/s/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "bmc_medicine", name: "BMC Medicine", issn: "1741-7015",
    scope: ["general medicine", "clinical trials", "systematic reviews", "meta-analysis", "observational studies", "public health", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://bmcmedicine.biomedcentral.com/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "jama_internal_medicine", name: "JAMA Internal Medicine", issn: "2168-6106",
    scope: ["internal medicine", "clinical trials", "randomized controlled trials", "systematic reviews", "meta-analysis", "observational studies", "health services research"],
    designs: ["rct", "cohort", "observational", "systematic_review", "narrative_review"],
    authorInstructionsUrl: "https://jamanetwork.com/journals/jamainternalmedicine/pages/instructions-for-authors",
    wordLimits: { abstract: null, main: null }, referenceStyle: "ama", checkedTs: null,
  },
  {
    id: "bmj_open", name: "BMJ Open", issn: "2044-6055",
    scope: ["general medicine", "clinical trials", "randomized controlled trials", "cohort studies", "observational studies", "systematic reviews", "meta-analysis", "diagnostic accuracy", "prognosis", "open access"],
    designs: ["rct", "cohort", "observational", "systematic_review", "diagnostic_accuracy", "prognostic", "narrative_review"],
    authorInstructionsUrl: null,
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
  {
    id: "systematic_reviews", name: "Systematic Reviews", issn: "2046-4053",
    scope: ["systematic reviews", "meta-analysis", "evidence synthesis", "methodology", "scoping reviews", "open access"],
    designs: ["systematic_review", "meta_analysis"],
    authorInstructionsUrl: "https://systematicreviewsjournal.biomedcentral.com/submission-guidelines",
    wordLimits: { abstract: null, main: null }, referenceStyle: "vancouver", checkedTs: null,
  },
];

export const JOURNALS_CATALOGUE = [
  {
    "id": "ijccm",
    "name": "Indian Journal of Critical Care Medicine (IJCCM)",
    "shortName": "IJCCM",
    "publisher": "Thieme / ISCCM",
    "specialty": "Critical Care",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusion), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 6,
    "maxFigures": 6,
    "openAccess": true,
    "apcNote": "No publication fee / APC funded by society",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijccm.org/journal/IJCCM/page/instructions-to-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "japi",
    "name": "Journal of The Association of Physicians of India (JAPI)",
    "shortName": "JAPI",
    "publisher": "Association of Physicians of India",
    "specialty": "Internal Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Correspondence"
    ],
    "wordLimit": 2000,
    "abstractFormat": "Structured abstract, up to 200 words",
    "abstractWordLimit": 200,
    "referenceStyle": "vancouver",
    "maxReferences": 20,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No APC for API members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.japi.org/instructions-for-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijmr",
    "name": "Indian Journal of Medical Research (IJMR)",
    "shortName": "IJMR",
    "publisher": "ICMR / Wolters Kluwer Medknow",
    "specialty": "General Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Short Communication",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background & objectives, Methods, Results, Interpretation & conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 35,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "No submission or publication fees (diamond open access funded by ICMR)",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijmr.org.in/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "nmji",
    "name": "National Medical Journal of India (NMJI)",
    "shortName": "NMJI",
    "publisher": "AIIMS New Delhi",
    "specialty": "Internal Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Short Report",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 300 words",
    "abstractWordLimit": 300,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No publication charges",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.nmji.in/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "indian_pediatr",
    "name": "Indian Pediatrics",
    "shortName": "Indian Pediatrics",
    "publisher": "Indian Academy of Pediatrics / Springer",
    "specialty": "Pediatrics",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Research Paper",
      "Review Article",
      "Research Brief",
      "Case Report"
    ],
    "wordLimit": 2500,
    "abstractFormat": "Structured (Objective, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 3,
    "openAccess": true,
    "apcNote": "No processing fee for regular submissions from India",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.indianpediatrics.net/authorguidelines.htm",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ija",
    "name": "Indian Journal of Anaesthesia (IJA)",
    "shortName": "IJA",
    "publisher": "Wolters Kluwer Medknow / ISA",
    "specialty": "Anaesthesia",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Clinical Investigation",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background and Aims, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "Free publishing for members of ISA / society sponsored",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijaweb.org/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijo",
    "name": "Indian Journal of Ophthalmology (IJO)",
    "shortName": "IJO",
    "publisher": "Wolters Kluwer Medknow / AIOS",
    "specialty": "Ophthalmology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Brief Communication",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Purpose, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "No APC for AIOS members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijo.in/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "indian_j_surg",
    "name": "Indian Journal of Surgery",
    "shortName": "Indian J Surg",
    "publisher": "Springer / ASI",
    "specialty": "Surgery",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Short Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Subscription journal with open access option; no fee for standard publication",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://link.springer.com/journal/12262/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "jpgm",
    "name": "Journal of Postgraduate Medicine (JPGM)",
    "shortName": "J Postgrad Med",
    "publisher": "Wolters Kluwer Medknow",
    "specialty": "General Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Aims, Settings and Design, Materials and Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "No submission or page charges (diamond open access)",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.jpgmonline.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "lung_india",
    "name": "Lung India",
    "shortName": "Lung India",
    "publisher": "Wolters Kluwer Medknow / ICS",
    "specialty": "Pulmonology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No publication charges for authors",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.lungindia.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "indian_heart_j",
    "name": "Indian Heart Journal",
    "shortName": "Indian Heart J",
    "publisher": "Elsevier / Cardiological Society of India",
    "specialty": "Cardiology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Brief Communication",
      "Case Report"
    ],
    "wordLimit": 3500,
    "abstractFormat": "Structured (Objective, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 35,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "No APC for authors; sponsored by Cardiological Society of India",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.elsevier.com/journals/indian-heart-journal/0019-4832/guide-for-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijdvl",
    "name": "Indian Journal of Dermatology, Venereology and Leprology (IJDVL)",
    "shortName": "IJDVL",
    "publisher": "Scientific Scholar / IADVL",
    "specialty": "Dermatology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Brief Report",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Aims, Methods, Results, Limitations, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "Diamond Open Access; no article processing charges",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://ijdvl.com/for-authors/",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "jog_india",
    "name": "Journal of Obstetrics and Gynaecology of India (JOGI)",
    "shortName": "J Obstet Gynaecol India",
    "publisher": "Springer / FOGSI",
    "specialty": "Obstetrics & Gynaecology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Clinical Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Objective, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Subscription model with hybrid OA option; standard publication is free",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://link.springer.com/journal/13224/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "indian_j_psychiatry",
    "name": "Indian Journal of Psychiatry",
    "shortName": "Indian J Psychiatry",
    "publisher": "Wolters Kluwer Medknow / IPS",
    "specialty": "Psychiatry",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Brief Research Communication",
      "Case Report"
    ],
    "wordLimit": 3500,
    "abstractFormat": "Structured (Background, Aims, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 35,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "Free publication for members of Indian Psychiatric Society",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.indianjpsychiatry.org/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "indian_j_orthop",
    "name": "Indian Journal of Orthopaedics",
    "shortName": "Indian J Orthop",
    "publisher": "Springer / IOA",
    "specialty": "Orthopaedics",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Surgical Technique",
      "Case Report"
    ],
    "wordLimit": 4000,
    "abstractFormat": "Structured (Background, Purpose, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 35,
    "maxTables": 6,
    "maxFigures": 6,
    "openAccess": false,
    "apcNote": "Hybrid journal; free publication under subscription route",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://link.springer.com/journal/43465/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "neurol_india",
    "name": "Neurology India",
    "shortName": "Neurology India",
    "publisher": "Wolters Kluwer Medknow / NSI",
    "specialty": "Neurology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Technical Note"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Objective, Materials and Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "No APC for authors; sponsored by Neurological Society of India",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.neurologyindia.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijph",
    "name": "Indian Journal of Public Health (IJPH)",
    "shortName": "IJPH",
    "publisher": "Wolters Kluwer Medknow / IPHA",
    "specialty": "Public Health",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Short Communication",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Objectives, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 3,
    "openAccess": true,
    "apcNote": "Publication fee waived or minimal society charge",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijph.in/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "jcdr",
    "name": "Journal of Clinical and Diagnostic Research (JCDR)",
    "shortName": "JCDR",
    "publisher": "JCDR Research and Publications",
    "specialty": "General Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Short Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Introduction, Aim, Materials and Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": true,
    "apcNote": "Processing fee / APC applies (check current JCDR fee tiers)",
    "noFee": false,
    "indexedPubMed": false,
    "indexedScopus": true,
    "url": "https://jcdr.net/author_guidelines.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "mjafi",
    "name": "Medical Journal Armed Forces India (MJAFI)",
    "shortName": "MJAFI",
    "publisher": "Elsevier / AFMS",
    "specialty": "General Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Short Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No publication fee for authors; funded by Armed Forces Medical Services",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.elsevier.com/journals/medical-journal-armed-forces-india/0377-1237/guide-for-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "jfmpc",
    "name": "Journal of Family Medicine and Primary Care (JFMPC)",
    "shortName": "JFMPC",
    "publisher": "Wolters Kluwer Medknow / AFPI",
    "specialty": "Family Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Short Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Context, Aims, Settings and Design, Methods and Material, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "Processing fee applies upon acceptance",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.jfmpc.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "aian",
    "name": "Annals of Indian Academy of Neurology (AIAN)",
    "shortName": "Ann Indian Acad Neurol",
    "publisher": "Wolters Kluwer Medknow / IAN",
    "specialty": "Neurology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Brief Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Objective, Materials and Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No fee for IAN members / society supported",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.annalsofian.org/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijpm",
    "name": "Indian Journal of Pathology and Microbiology (IJPM)",
    "shortName": "IJPM",
    "publisher": "Wolters Kluwer Medknow / IAPM",
    "specialty": "Pathology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Brief Communication"
    ],
    "wordLimit": 2500,
    "abstractFormat": "Structured (Background, Aims, Materials and Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No APC for IAPM members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijpmonline.org/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijmpo",
    "name": "Indian Journal of Medical and Paediatric Oncology (IJMPO)",
    "shortName": "IJMPO",
    "publisher": "Thieme / ISMPO",
    "specialty": "Oncology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Objective, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "Society-sponsored; no author fee for ISMPO members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.thieme.in/ijmpo",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijri",
    "name": "Indian Journal of Radiology and Imaging (IJRI)",
    "shortName": "IJRI",
    "publisher": "Thieme / IRIA",
    "specialty": "Radiology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Pictorial Essay",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Purpose, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 8,
    "openAccess": true,
    "apcNote": "No fee for members of IRIA",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.thieme.in/ijri",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijohns",
    "name": "Indian Journal of Otolaryngology and Head & Neck Surgery",
    "shortName": "IJOHNS",
    "publisher": "Springer / AOI",
    "specialty": "ENT",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Short Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Purpose, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Hybrid subscription model; free publication option",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://link.springer.com/journal/12070/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijn",
    "name": "Indian Journal of Nephrology",
    "shortName": "IJN",
    "publisher": "Wolters Kluwer Medknow / ISN",
    "specialty": "Nephrology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Brief Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Introduction, Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No publication fee for ISN members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.indianjnephrol.org/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijg",
    "name": "Indian Journal of Gastroenterology",
    "shortName": "Indian J Gastroenterol",
    "publisher": "Springer / ISG",
    "specialty": "Gastroenterology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Brief Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Subscription journal with hybrid OA option; free standard publication",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://link.springer.com/journal/12664/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijp",
    "name": "Indian Journal of Pharmacology",
    "shortName": "IJP",
    "publisher": "Wolters Kluwer Medknow / IPS",
    "specialty": "Pharmacology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Research Paper",
      "Review Article",
      "Short Communication",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Objectives, Materials and Methods, Results, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No APC for members of Indian Pharmacological Society",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijp-online.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijcm",
    "name": "Indian Journal of Community Medicine (IJCM)",
    "shortName": "IJCM",
    "publisher": "Wolters Kluwer Medknow / IAPSM",
    "specialty": "Community Medicine",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Short Communication",
      "Letter to Editor"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Context, Aims, Settings and Design, Methods and Material, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 25,
    "maxTables": 4,
    "maxFigures": 2,
    "openAccess": true,
    "apcNote": "Nominal society fee or free for IAPSM members",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.ijcm.org.in/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "iju",
    "name": "Indian Journal of Urology (IJU)",
    "shortName": "IJU",
    "publisher": "Wolters Kluwer Medknow / USI",
    "specialty": "Urology",
    "region": "indian",
    "isIndian": true,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Urological Technique",
      "Case Report"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Introduction, Materials and Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": true,
    "apcNote": "No publication charges (supported by Urological Society of India)",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.indianjurol.com/contributors.asp",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "cureus",
    "name": "Cureus Journal of Medical Science",
    "shortName": "Cureus",
    "publisher": "Springer Nature",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Case Report",
      "Technical Report"
    ],
    "wordLimit": null,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 3500 characters",
    "abstractWordLimit": null,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "Free publishing tier available (max 30 references, max 10 authors); preferred editing fee applies otherwise",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": false,
    "url": "https://www.cureus.com/author_guide",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "bmj_open",
    "name": "BMJ Open",
    "shortName": "BMJ Open",
    "publisher": "BMJ Publishing Group",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research",
      "Study Protocol",
      "Review"
    ],
    "wordLimit": 4000,
    "abstractFormat": "Structured (Objectives, Design, Setting, Participants, Interventions, Primary outcome measures, Results, Conclusions), up to 300 words",
    "abstractWordLimit": 300,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "Open access APC applies (waivers available for qualifying low and middle income researchers)",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://bmjopen.bmj.com/pages/authors/",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "plos_one",
    "name": "PLOS ONE",
    "shortName": "PLOS ONE",
    "publisher": "Public Library of Science",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research Article",
      "Clinical Trial",
      "Systematic Review"
    ],
    "wordLimit": null,
    "abstractFormat": "Unstructured, single paragraph up to 300 words without citations",
    "abstractWordLimit": 300,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "APC applies (waivers and fee assistance available for eligible authors)",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://journals.plos.org/plosone/s/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "medicine_baltimore",
    "name": "Medicine (Baltimore)",
    "shortName": "Medicine",
    "publisher": "Wolters Kluwer",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Observational Study",
      "Clinical Trial",
      "Systematic Review",
      "Case Report"
    ],
    "wordLimit": 4000,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusion), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": 40,
    "maxTables": 6,
    "maxFigures": 6,
    "openAccess": true,
    "apcNote": "Open access publication fee applies",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://journals.lww.com/md-journal/Pages/Instructions-for-Authors.aspx",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "bmc_medicine",
    "name": "BMC Medicine",
    "shortName": "BMC Med",
    "publisher": "BioMed Central / Springer Nature",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research Article",
      "Review",
      "Policy Review"
    ],
    "wordLimit": null,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "APC applies (institutional agreements and waivers apply)",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://bmcmedicine.biomedcentral.com/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "bmc_public_health",
    "name": "BMC Public Health",
    "shortName": "BMC Public Health",
    "publisher": "BioMed Central / Springer Nature",
    "specialty": "Public Health",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research Article",
      "Study Protocol",
      "Systematic Review"
    ],
    "wordLimit": null,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "Open access APC applies",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://bmcpublichealth.biomedcentral.com/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "bmc_infect_dis",
    "name": "BMC Infectious Diseases",
    "shortName": "BMC Infect Dis",
    "publisher": "BioMed Central / Springer Nature",
    "specialty": "Infectious Diseases",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research Article",
      "Case Report",
      "Study Protocol"
    ],
    "wordLimit": null,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "Open access APC applies",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://bmcinfectdis.biomedcentral.com/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "trials",
    "name": "Trials",
    "shortName": "Trials",
    "publisher": "BioMed Central / Springer Nature",
    "specialty": "Methodology & Trials",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Study Protocol",
      "Methodology",
      "Clinical Trial Report"
    ],
    "wordLimit": null,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "Open access APC applies",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://trialsjournal.biomedcentral.com/submission-guidelines",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "ijerph",
    "name": "International Journal of Environmental Research and Public Health (IJERPH)",
    "shortName": "IJERPH",
    "publisher": "MDPI",
    "specialty": "Public Health",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Article",
      "Review",
      "Brief Report"
    ],
    "wordLimit": null,
    "abstractFormat": "Unstructured single paragraph, 200 to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": null,
    "maxTables": null,
    "maxFigures": null,
    "openAccess": true,
    "apcNote": "APC applies",
    "noFee": false,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.mdpi.com/journal/ijerph/instructions",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "thelancet",
    "name": "The Lancet",
    "shortName": "The Lancet",
    "publisher": "Elsevier",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Articles",
      "Review",
      "Seminar",
      "Correspondence"
    ],
    "wordLimit": 4500,
    "abstractFormat": "Structured (Background, Methods, Findings, Interpretation, Funding), up to 300 words",
    "abstractWordLimit": 300,
    "referenceStyle": "vancouver",
    "maxReferences": 30,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": false,
    "apcNote": "Subscription journal with open access option",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.thelancet.com/lancet/information-for-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "thebmj",
    "name": "The BMJ",
    "shortName": "The BMJ",
    "publisher": "BMJ Publishing Group",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Research",
      "Clinical Review",
      "Practice",
      "Analysis"
    ],
    "wordLimit": 4000,
    "abstractFormat": "Structured (Objectives, Design, Setting, Participants, Interventions, Main outcome measures, Results, Conclusions), up to 300 words",
    "abstractWordLimit": 300,
    "referenceStyle": "vancouver",
    "maxReferences": 40,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": false,
    "apcNote": "Subscription journal; open access APC applies only if chosen by author",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.bmj.com/about-bmj/resources-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "jama",
    "name": "JAMA (Journal of the American Medical Association)",
    "shortName": "JAMA",
    "publisher": "American Medical Association",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Original Investigation",
      "Brief Report",
      "Review",
      "Viewpoint"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Importance, Objective, Design, Setting, Participants, Exposures/Interventions, Main Outcomes, Results, Conclusions and Relevance), up to 350 words",
    "abstractWordLimit": 350,
    "referenceStyle": "ama",
    "maxReferences": 40,
    "maxTables": 5,
    "maxFigures": 5,
    "openAccess": false,
    "apcNote": "Subscription publication is free; open access fee optional",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://jamanetwork.com/journals/jama/pages/instructions-for-authors",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "nejm",
    "name": "New England Journal of Medicine (NEJM)",
    "shortName": "NEJM",
    "publisher": "Massachusetts Medical Society",
    "specialty": "General Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Original Article",
      "Review Article",
      "Clinical Practice",
      "Correspondence"
    ],
    "wordLimit": 2700,
    "abstractFormat": "Structured (Background, Methods, Results, Conclusions), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 40,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Subscription publication is free; no author fee for standard publication",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.nejm.org/author-center",
    "checkedOn": "2026-11-26"
  },
  {
    "id": "annals_internal_med",
    "name": "Annals of Internal Medicine",
    "shortName": "Ann Intern Med",
    "publisher": "American College of Physicians",
    "specialty": "Internal Medicine",
    "region": "international",
    "isIndian": false,
    "articleTypes": [
      "Original Research",
      "Review",
      "Clinical Guideline",
      "Brief Communication"
    ],
    "wordLimit": 3000,
    "abstractFormat": "Structured (Background, Objective, Design, Setting, Patients, Measurements, Results, Limitations, Conclusion), up to 250 words",
    "abstractWordLimit": 250,
    "referenceStyle": "vancouver",
    "maxReferences": 35,
    "maxTables": 4,
    "maxFigures": 4,
    "openAccess": false,
    "apcNote": "Subscription publication is free; open access fee optional",
    "noFee": true,
    "indexedPubMed": true,
    "indexedScopus": true,
    "url": "https://www.acpjournals.org/journal/aim/authors",
    "checkedOn": "2026-11-26"
  }
];


async function ensureSeeded(db) {
  const now = Date.now();
  await db.batch(JOURNAL_SEED.map((j) =>
    db.prepare("INSERT OR IGNORE INTO research_journals (id,name,issn,scope_json,designs_json,author_instructions_url,word_limit_abstract,word_limit_main,reference_style,checked_ts,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(j.id, j.name, j.issn, JSON.stringify(j.scope), JSON.stringify(j.designs),
        j.authorInstructionsUrl, j.wordLimits.abstract, j.wordLimits.main,
        j.referenceStyle, j.checkedTs, now)));
}
function journalOf(row) {
  return {
    id: row.id, name: row.name, issn: row.issn || "",
    scope: JSON.parse(row.scope_json || "[]"), designs: JSON.parse(row.designs_json || "[]"),
    authorInstructionsUrl: row.author_instructions_url == null ? null : row.author_instructions_url,
    wordLimits: { abstract: row.word_limit_abstract == null ? null : row.word_limit_abstract,
      main: row.word_limit_main == null ? null : row.word_limit_main },
    referenceStyle: row.reference_style == null ? null : row.reference_style,
    checkedTs: row.checked_ts == null ? null : row.checked_ts,
  };
}

/* GET /v1/journals?q=&catalogue= */
export async function listJournals(ctx, url) {
  const { db, requestId, api } = ctx;
  const catalogue = url.searchParams.get("catalogue") === "1" || url.searchParams.get("all") === "1";
  if (catalogue) {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    let list = JOURNALS_CATALOGUE;
    if (q) {
      list = list.filter((j) =>
        j.name.toLowerCase().includes(q) ||
        (j.shortName && j.shortName.toLowerCase().includes(q)) ||
        (j.specialty && j.specialty.toLowerCase().includes(q)));
    }
    return api.json({ journals: list }, 200, { "x-request-id": requestId });
  }
  await ensureSeeded(db);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const rows = (await db.prepare("SELECT * FROM research_journals ORDER BY name ASC").all()).results || [];
  let journals = rows.map(journalOf);
  if (q) journals = journals.filter((j) =>
    j.name.toLowerCase().includes(q) || j.scope.some((s) => s.toLowerCase().includes(q)));
  return api.json({ journals }, 200, { "x-request-id": requestId });
}
function journalFromCatalogue(entry) {
  if (!entry) return null;
  const limits = {};
  if (entry.maxReferences != null) limits.references = entry.maxReferences;
  if (entry.maxTables != null) limits.tables = entry.maxTables;
  if (entry.maxFigures != null) limits.figures = entry.maxFigures;
  return {
    id: entry.id,
    name: entry.name,
    shortName: entry.shortName || "",
    issn: entry.issn || "",
    scope: [],
    designs: [],
    authorInstructionsUrl: entry.url || null,
    wordLimits: {
      abstract: entry.abstractWordLimit == null ? null : entry.abstractWordLimit,
      main: entry.wordLimit == null ? null : entry.wordLimit,
    },
    referenceStyle: entry.referenceStyle || null,
    limits,
    checkedTs: null,
  };
}

/* One journal row, or null. Seeds on first read. Used by format-check. */
export async function loadJournal(db, id) {
  await ensureSeeded(db);
  const row = await db.prepare("SELECT * FROM research_journals WHERE id=?").bind(id).first();
  if (row) return journalOf(row);
  const cat = JOURNALS_CATALOGUE.find((j) => j.id === id);
  if (cat) return journalFromCatalogue(cat);
  if (id === "default") {
    return {
      id: "default",
      name: "General Indian medical journal format",
      issn: "",
      scope: [],
      designs: [],
      authorInstructionsUrl: null,
      wordLimits: { abstract: 250, main: 3000 },
      referenceStyle: "vancouver",
      limits: {},
      checkedTs: null,
    };
  }
  return null;
}

/* GET /v1/journals/{id} */
export async function getJournal(ctx, id) {
  const { db, requestId, api } = ctx;
  const journal = await loadJournal(db, id);
  if (!journal) return api.err(404, "journal_not_found", "Journal not found", requestId);
  return api.json({ journal }, 200, { "x-request-id": requestId });
}
/* POST /v1/journals/match {keywords, design?}: deterministic scoring.
 * score = 2 * distinct scope hits + 3 * design match; zero-score omitted. */
export async function matchJournals(ctx, body) {
  const { db, requestId, api } = ctx;
  const keywords = body.keywords;
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 20 ||
      keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 80))
    return api.err(400, "invalid_body", "keywords must be 1-20 strings of 1-80 characters", requestId);
  const design = body.design === undefined ? null : body.design;
  if (design !== null && (typeof design !== "string" || design.length > 80))
    return api.err(400, "invalid_body", "design must be a string", requestId);
  await ensureSeeded(db);
  const kws = keywords.map((k) => k.trim().toLowerCase());
  const rows = (await db.prepare("SELECT * FROM research_journals").all()).results || [];
  const matches = [];
  for (const row of rows) {
    const j = journalOf(row);
    const matchedKeywords = j.scope.filter((s) => {
      const sl = s.toLowerCase();
      return kws.some((k) => sl.includes(k) || k.includes(sl));
    });
    const designMatch = design !== null && j.designs.indexOf(design) >= 0;
    const score = 2 * matchedKeywords.length + (designMatch ? 3 : 0);
    if (score > 0) matches.push({ journal: j, score, matchedKeywords, designMatch });
  }
  matches.sort((a, b) => b.score - a.score || (a.journal.name < b.journal.name ? -1 : 1));
  return api.json({ matches }, 200, { "x-request-id": requestId });
}
