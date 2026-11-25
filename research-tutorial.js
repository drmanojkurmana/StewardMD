/* StewardMD - ResearchMD Interactive Tutorials & Publication Celebrations
 * (window.SMD_RESEARCH.tutorial). ES5 IIFE, buildless, mobile-first. No em or en dashes.
 *
 * Provides a complete worked example + hands-on guided tutorial (ask the student to
 * click/enter OR click "Enter & Show Me" to demonstrate step-by-step) from scratch to
 * Submit & Published Celebration across all 9 study designs:
 *   case, case-series, case-control, cohort, trial (RCT), sr (Meta-Analysis),
 *   masterchart, obs, thesis.
 *
 * Saved as default ON per study type in localStorage (smd_rmd_tut_prefs_v1); users
 * can always choose to skip or replay at any time.
 */
(function (G) {
  "use strict";

  var D = G.document;
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};

  var PREFS_KEY = "smd_rmd_tut_prefs_v1";
  var STATE_KEY = "smd_rmd_tut_state_v1";
  var PUB_KEY = "smd_rmd_pub_status_v1";

  function esc(s) {
    if (SMD.esc) return SMD.esc(s);
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function nowIsoDate() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function copyText(str) {
    if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
      return G.navigator.clipboard.writeText(str).catch(function () { fallbackCopy(str); });
    }
    fallbackCopy(str);
    return Promise.resolve();
  }

  function fallbackCopy(str) {
    try {
      var ta = D.createElement("textarea");
      ta.value = str;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      D.body.appendChild(ta);
      ta.select();
      D.execCommand("copy");
      D.body.removeChild(ta);
    } catch (e) {}
  }

  /* ---- 1. Catalog of all 9 Worked Examples ------------------------------ */

  var EXAMPLES = [
    {
      key: "case",
      label: "Case Report",
      checklistLabel: "CARE",
      checklistId: "care",
      studyType: "Case Report",
      shortTitle: "Isoniazid-Induced Severe Hepatotoxicity",
      fullTitle: "Isoniazid-Induced Severe Hepatotoxicity Resolving After Drug Withdrawal: A Case Report",
      journal: "JAMA",
      specialty: "Internal Medicine",
      researchQuestion: "Clinical presentation, RUCAM causality assessment, and recovery timeline after prompt withdrawal of isoniazid.",
      exampleBlurb: "42-year-old woman developing jaundice 3 weeks after starting isoniazid prophylaxis.",
      firstScreen: "casefile",
      casefiles: [
        {
          id: "cf_tut_1",
          age: "42",
          sex: "Female",
          presenting: "Progressive jaundice, dark urine, and anorexia 21 days after starting isoniazid prophylaxis for latent TB",
          presentingDate: "2026-09-01",
          history: "No prior liver disease or alcohol use. Started isoniazid 300 mg/day with pyridoxine 3 weeks ago.",
          examination: "Icterus present, mild right upper quadrant tenderness, no asterixis or ascites.",
          investigations: [
            { date: "2026-09-01", test: "ALT", value: "840", unit: "U/L" },
            { date: "2026-09-01", test: "Total Bilirubin", value: "6.2", unit: "mg/dL" },
            { date: "2026-09-22", test: "ALT (after withdrawal)", value: "38", unit: "U/L" }
          ],
          diagnosis: "Drug-induced liver injury secondary to isoniazid (RUCAM score 9, highly probable)",
          diagnosisDate: "2026-09-03",
          treatment: "Immediate permanent discontinuation of isoniazid; supportive hydration and liver function monitoring",
          treatmentDate: "2026-09-02",
          outcome: "Full biochemical and clinical normalization within 3 weeks of stopping isoniazid",
          outcomeDate: "2026-09-22",
          followup: "3-month clinic follow-up asymptomatic with normal liver panel",
          followupDate: "2026-11-15",
          unusual: "Severe hepatocellular injury resolving completely without steroids after early drug withdrawal"
        }
      ],
      manuscriptSections: [
        { id: "title", heading: "Title Page", level: 1, text: "Isoniazid-Induced Severe Hepatotoxicity Resolving After Drug Withdrawal: A Case Report" },
        { id: "abstract", heading: "Abstract", level: 1, text: "Introduction: Isoniazid can trigger acute idiosyncratic liver injury. Case presentation: A 42-year-old female presented with jaundice 21 days into latent tuberculosis prophylaxis (ALT 840 U/L, bilirubin 6.2 mg/dL). Drug cessation led to complete recovery in 3 weeks. Conclusion: Early symptom vigilance prevents progression to acute liver failure." },
        { id: "casePresentation", heading: "Case Presentation", level: 1, text: "A 42-year-old female presented on 2026-09-01 with anorexia, dark urine, and scleral icterus three weeks after initiating isoniazid 300 mg daily. Viral hepatitis serologies and autoimmune markers were negative. Liver enzymes peaked at ALT 840 U/L and bilirubin 6.2 mg/dL. Prompt drug withdrawal led to ALT 38 U/L by day 21." },
        { id: "timeline", heading: "Timeline", level: 1, text: "Day 1: Started isoniazid 300 mg/day. Day 21: Jaundice, ALT 840 U/L, drug stopped. Day 42: Full resolution (ALT 38 U/L). Month 3: Normal follow-up." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Isoniazid hepatotoxicity occurs in up to 1% of recipients. Baseline testing and educating patients on early warning signs such as nausea or dark urine remain essential." },
        { id: "conclusion", heading: "Conclusion", level: 1, text: "Clinicians should counsel patients starting isoniazid to report jaundice promptly and stop therapy immediately when transaminases exceed three times normal." }
      ]
    },
    {
      key: "case-series",
      label: "Case Series",
      checklistLabel: "CARE",
      checklistId: "care",
      studyType: "Case series",
      shortTitle: "Acute Aluminum Phosphide Poisoning Series (5 Cases)",
      fullTitle: "Clinical Course and Outcomes in Acute Aluminum Phosphide Poisoning: A Five-Patient Case Series",
      journal: "PLOS ONE",
      specialty: "Toxicology & Critical Care",
      researchQuestion: "Demographic profile, hemodynamic course, and survival predictors across five consecutive acute poisoning admissions.",
      exampleBlurb: "5 consecutive ICU patients presenting after ingestion, compared across vitals and survival.",
      firstScreen: "casefile",
      casefiles: [
        {
          id: "cf_tut_cs1",
          age: "24", sex: "Male",
          presenting: "Vomiting and hypotension 2 hours post ingestion",
          presentingDate: "2026-06-02",
          diagnosis: "Acute aluminum phosphide toxicity (shock)",
          diagnosisDate: "2026-06-02",
          treatment: "IV magnesium sulfate, norepinephrine infusion, gastric lavage with coconut oil",
          treatmentDate: "2026-06-02",
          outcome: "Survived to ICU discharge on day 6",
          outcomeDate: "2026-06-08",
          followup: "Day 30 clinic review normal ECG",
          followupDate: "2026-07-02",
          unusual: "Early vasopressor and magnesium support reversed refractory shock"
        },
        {
          id: "cf_tut_cs2",
          age: "31", sex: "Female",
          presenting: "Metabolic acidosis and epigastric pain 3 hours after exposure",
          presentingDate: "2026-06-14",
          diagnosis: "Acute aluminum phosphide toxicity",
          diagnosisDate: "2026-06-14",
          treatment: "Sodium bicarbonate infusion, IV magnesium, non-invasive ventilation",
          treatmentDate: "2026-06-14",
          outcome: "Survived with normal ejection fraction",
          outcomeDate: "2026-06-19",
          followup: "Day 30 asymptomatic",
          followupDate: "2026-07-14",
          unusual: "Transient myocarditis normalized within 5 days"
        },
        {
          id: "cf_tut_cs3",
          age: "28", sex: "Male",
          presenting: "Altered sensorium 4 hours post ingestion",
          presentingDate: "2026-07-03",
          diagnosis: "Severe aluminum phosphide poisoning",
          diagnosisDate: "2026-07-03",
          treatment: "Mechanical ventilation and dual vasopressors",
          treatmentDate: "2026-07-03",
          outcome: "Survived after 8 days ICU stay",
          outcomeDate: "2026-07-11",
          followup: "Day 30 recovery complete",
          followupDate: "2026-08-03",
          unusual: "Early correction of hypomagnesemia correlated with rhythm stability"
        }
      ],
      manuscriptSections: [
        { id: "title", heading: "Title Page", level: 1, text: "Clinical Course and Outcomes in Acute Aluminum Phosphide Poisoning: A Case Series" },
        { id: "abstract", heading: "Abstract", level: 1, text: "Background: Aluminum phosphide poisoning carries high mortality due to toxic myocarditis. Cases: We report consecutive adult admissions managed with protocolized IV magnesium and early vasoactive titration. Conclusion: Structured critical care resuscitation improves survival." },
        { id: "casePresentation", heading: "Case Presentation", level: 1, text: "Three detailed consecutive patients aged 24 to 31 years presented within 4 hours of ingestion with severe metabolic acidosis and hypotension. All received prompt magnesium sulfate, hemodynamic resuscitation, and survived to 30-day follow-up." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Rapid mitochondrial toxicity causes refractory shock unless perfusion and electrolyte disturbances are corrected within the first golden hour." },
        { id: "conclusion", heading: "Conclusion", level: 1, text: "Protocolized hemodynamic and magnesium therapy should be initiated immediately upon emergency arrival." }
      ]
    },
    {
      key: "case-control",
      label: "Case-Control Study",
      checklistLabel: "STROBE",
      checklistId: "strobe",
      studyType: "Case-control study",
      shortTitle: "Trans-Fat Diet and Acute Myocardial Infarction",
      fullTitle: "Dietary Trans-Fat Intake and Risk of Acute Myocardial Infarction: A Hospital-Based Case-Control Study",
      journal: "BMJ",
      specialty: "Cardiology",
      researchQuestion: "Is high dietary trans-fat intake associated with increased odds of first acute myocardial infarction compared with age-matched hospital controls?",
      exampleBlurb: "Compare 120 MI cases vs 120 matched controls for trans-fat exposure odds ratio.",
      firstScreen: "plan",
      protocolSpec: {
        population: "Adults aged 35 to 70 admitted to cardiology or orthopedic clinics",
        intervention: "High trans-fat dietary exposure (>= 2% daily energy intake)",
        comparison: "Low trans-fat dietary exposure (< 2% daily energy intake)",
        outcome: "First acute myocardial infarction confirmed by ECG and troponin I"
      },
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Objective: Evaluate the association between high dietary trans-fat intake and first acute myocardial infarction. Design: Hospital-based matched case-control study. Results: High trans-fat intake significantly increased MI odds (OR 2.35, 95% CI 1.38 to 4.01). Conclusion: Dietary trans-fat elimination remains a high-yield preventive target." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Industrial trans-fatty acids elevate LDL cholesterol and systemic inflammation, accelerating atherothrombotic events." },
        { id: "methods", heading: "Methods", level: 1, text: "We enrolled consecutive incident MI cases and age- and sex-matched non-cardiac controls, administering a validated food-frequency questionnaire before discharge." },
        { id: "results", heading: "Results", level: 1, text: "High trans-fat intake occurred significantly more often among cases than controls, yielding an adjusted odds ratio exceeding 2.0." },
        { id: "discussion", heading: "Discussion", level: 1, text: "These findings align with national policy efforts eliminating partially hydrogenated oils from retail foods." }
      ]
    },
    {
      key: "cohort",
      label: "Cohort Study",
      checklistLabel: "STROBE",
      checklistId: "strobe",
      studyType: "Cohort study",
      shortTitle: "12-Month Renal Outcomes After CKD Care Pathway",
      fullTitle: "Renal Function Preservation at 12 Months After a Structured CKD Care Pathway: A Prospective Cohort Study",
      journal: "The Lancet",
      specialty: "Nephrology",
      researchQuestion: "Does a structured nephrology-primary care co-management pathway slow eGFR decline and reduce dialysis progression over 12 months?",
      exampleBlurb: "Follow 200 CKD patients over 12 months comparing survival & hazard ratio.",
      firstScreen: "plan",
      protocolSpec: {
        population: "Adults with Stage 3-4 chronic kidney disease (eGFR 15 to 59 mL/min)",
        intervention: "Structured quarterly CKD clinic pathway with SGLT2i and ACEi titration",
        comparison: "Usual outpatient medical follow-up",
        outcome: "Time to composite 30% eGFR decline or renal replacement therapy over 12 months"
      },
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Background: Fragmented CKD care accelerates kidney failure. Methods: We prospectively followed Stage 3-4 CKD patients enrolled in a structured care pathway versus usual care for 12 months. Results: Structured care lowered hazard of progression (HR 0.62, 95% CI 0.41 to 0.93). Conclusion: Protocolized CKD clinics improve renal survival." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Guideline-directed antiproteinuric therapy slows chronic kidney disease progression when sustained consistently." },
        { id: "methods", heading: "Methods", level: 1, text: "Eligible adults were followed with quarterly serum creatinine, urine ACR, and blood pressure measurements censored at 12 months." },
        { id: "results", heading: "Results", level: 1, text: "Kaplan-Meier event-free survival was significantly higher in the structured pathway cohort across baseline eGFR strata." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Scheduled pharmacist and physician titration bridges therapeutic inertia in outpatient nephrology." }
      ]
    },
    {
      key: "trial",
      label: "Randomized Controlled Trial",
      checklistLabel: "CONSORT",
      checklistId: "consort",
      studyType: "Randomized Controlled Trial",
      shortTitle: "Hydrocolloid vs Silver Sulfadiazine in Burns",
      fullTitle: "Hydrocolloid vs Silver Sulfadiazine Dressing for Partial-Thickness Burns: A Randomized Controlled Trial",
      journal: "NEJM",
      specialty: "Surgery & Burns",
      researchQuestion: "In adults with superficial partial-thickness burns, does hydrocolloid dressing improve complete 14-day wound healing compared with silver sulfadiazine?",
      exampleBlurb: "Calculate power, register CTRI, generate blinded 1:1 block randomisation, and publish CONSORT RCT.",
      firstScreen: "plan",
      protocolSpec: {
        population: "Adults aged 18 to 65 with fresh superficial partial-thickness burns < 15% TBSA",
        intervention: "Moisture-retentive hydrocolloid dressing changed every 4 days",
        comparison: "Daily silver sulfadiazine 1% cream with sterile gauze",
        outcome: "Complete wound re-epithelialization by Day 14 (assessor blinded)"
      },
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Background: Dressing choice alters burn pain and healing speed. Methods: In a parallel 1:1 randomized trial, patients received hydrocolloid or silver sulfadiazine dressings. Results: Day-14 complete healing was higher and pain scores were lower with hydrocolloid dressing. Conclusion: Hydrocolloid dressing is an effective alternative for outpatient partial-thickness burns." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Daily silver sulfadiazine changes cause discomfort and eschar formation that can delay re-epithelialization." },
        { id: "methods", heading: "Methods", level: 1, text: "Permuted-block randomization (blocks of 4) with opaque allocation concealment assigned participants equally to both arms following IEC clearance and CTRI registration." },
        { id: "results", heading: "Results", level: 1, text: "Baseline demographics were balanced across arms; hydrocolloid achieved faster epithelialization without increased wound infection." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Reduced dressing frequency decreased procedural pain and clinic workload while improving healing outcomes." }
      ]
    },
    {
      key: "sr",
      label: "Systematic Review & Meta-Analysis",
      checklistLabel: "PRISMA",
      checklistId: "prisma2020",
      studyType: "Systematic Review & Meta-Analysis",
      shortTitle: "BCG Vaccine vs Tuberculosis (Worked Demo)",
      fullTitle: "Efficacy of BCG Vaccine in the Prevention of Tuberculosis: A Systematic Review and Meta-Analysis",
      journal: "JAMA",
      specialty: "Infectious Disease",
      researchQuestion: "In clinical trials and prospective studies, what is the pooled protective efficacy of BCG vaccination against pulmonary tuberculosis?",
      exampleBlurb: "Walk end-to-end from adding studies & searching PubMed/Crossref to forest plot meta-analysis and PRISMA paper.",
      firstScreen: "studies",
      protocolSpec: {
        population: "Individuals without active tuberculosis receiving primary BCG vaccination",
        intervention: "Bacillus Calmette-Guerin (BCG) vaccine",
        comparison: "Unvaccinated placebo or no-vaccine control",
        outcome: "Microbiologically or radiologically confirmed tuberculosis disease (Risk Ratio)"
      },
      studiesSeed: [
        {
          label: "Aronson 1948",
          measure: "RR",
          inputs: { events1: 4, total1: 123, events2: 11, total2: 139 },
          locator: { kind: "table", citation: "Aronson JD. Am Rev Tuberc 1948;58:255-281.", page: "268", table: "Table 2", quote: "Of 123 vaccinated individuals, 4 developed tuberculosis compared with 11 of 139 controls." },
          verified: true
        },
        {
          label: "Ferguson & Simes 1949",
          measure: "RR",
          inputs: { events1: 6, total1: 306, events2: 29, total2: 303 },
          locator: { kind: "table", citation: "Ferguson RG, Simes AB. Tubercle 1949;30:5-11.", page: "9", table: "Table 1", quote: "Tuberculosis developed in 6 of 306 vaccinated infants versus 29 of 303 control infants." },
          verified: true
        },
        {
          label: "Hart & Sutherland 1977",
          measure: "RR",
          inputs: { events1: 62, total1: 13598, events2: 248, total2: 12867 },
          locator: { kind: "table", citation: "Hart PD, Sutherland I. BMJ 1977;2:293-295.", page: "294", table: "Table II", quote: "Among 13,598 BCG vaccinated adolescents 62 cases occurred versus 248 among 12,867 unvaccinated controls." },
          verified: true
        },
        {
          label: "TB Prevention Trial Madras 1980",
          measure: "RR",
          inputs: { events1: 505, total1: 88391, events2: 499, total2: 88391 },
          locator: { kind: "table", citation: "Tuberculosis Prevention Trial Madras. Indian J Med Res 1980;72:1-74.", page: "42", table: "Table 12", quote: "Confirmed pulmonary cases were 505 in 88,391 vaccinated versus 499 in 88,391 controls." },
          verified: true
        }
      ],
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Importance: Estimating BCG vaccine efficacy informs immunization policy. Objective: Pool controlled trials evaluating BCG vs no vaccine against tuberculosis. Data Sources: PubMed, Europe PMC, and Crossref. Results: Across included trials, BCG substantially lowered tuberculosis risk {{run:tut_run_1.estimate}} (95% CI {{run:tut_run_1.ciLower}} to {{run:tut_run_1.ciUpper}}). Conclusion: BCG confers protective benefit particularly against severe forms." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Bacillus Calmette-Guerin remains one of the most widely administered vaccines worldwide [@colditz1994]." },
        { id: "methods", heading: "Methods", level: 1, text: "We searched PubMed, Europe PMC, and Crossref following PRISMA 2020 guidelines, performed duplicate title/abstract screening, extracted event counts, assessed risk of bias, and pooled Risk Ratios using random-effects meta-analysis." },
        { id: "results", heading: "Results", level: 1, text: "Four landmark clinical trials comprising over 200,000 participants were pooled, yielding RR {{run:tut_run_1.estimate}} (95% CI {{run:tut_run_1.ciLower}} to {{run:tut_run_1.ciUpper}}, p {{run:tut_run_1.p}}, I2 {{run:tut_run_1.i2}})." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Heterogeneity reflects latitude gradients and mycobacterial background exposure, underscoring the importance of neonatal targeting." }
      ]
    },
    {
      key: "masterchart",
      label: "Original Study (Master Chart)",
      checklistLabel: "STROBE",
      checklistId: "strobe",
      studyType: "Original Study (Master Chart)",
      shortTitle: "12-Week Glycemic Reduction With SGLT2i Add-On",
      fullTitle: "Effect of Adding Empagliflozin vs Standard Care on 12-Week HbA1c Reduction: An Original Master-Chart Study",
      journal: "PLOS ONE",
      specialty: "Endocrinology",
      researchQuestion: "Does adding empagliflozin to metformin produce a larger 12-week HbA1c drop than metformin alone in routine outpatient practice?",
      exampleBlurb: "Upload sample Excel/CSV master chart, generate Table 1 and statistical tests, and publish.",
      firstScreen: "plan",
      protocolSpec: {
        population: "Adults with type 2 diabetes on stable metformin with HbA1c 7.5% to 10.0%",
        intervention: "Metformin plus SGLT2 inhibitor (empagliflozin 10 mg)",
        comparison: "Standard metformin continuation",
        outcome: "Change in HbA1c (%) at 12 weeks"
      },
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Objective: Evaluate real-world 12-week glycemic response after SGLT2i initiation. Methods: Patient-level outpatient data were analyzed on-device for Table 1 baseline balance and group comparisons. Results: SGLT2i add-on reduced 12-week HbA1c significantly more than standard therapy. Conclusion: Early combination therapy accelerates glycemic control." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Real-world master chart audits complement randomized trials by capturing routine outpatient adherence." },
        { id: "methods", heading: "Methods", level: 1, text: "Normality was tested via Shapiro-Wilk; normally distributed groups were compared using Welch t-test and summarized in Table 1." },
        { id: "results", heading: "Results", level: 1, text: "Baseline demographics were comparable between treatment groups, and 12-week follow-up favored combination therapy." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Point-of-care analysis confirms consistent glycemic efficacy without hypoglycemia." }
      ]
    },
    {
      key: "obs",
      label: "Observational Study",
      checklistLabel: "STROBE",
      checklistId: "strobe",
      studyType: "Observational Study",
      shortTitle: "ED Sepsis Bundle Implementation Audit",
      fullTitle: "Patient Outcomes After Standardized Emergency Sepsis Bundle Adoption: A Cross-Sectional Observational Study",
      journal: "BMJ",
      specialty: "Emergency Medicine",
      researchQuestion: "Did implementing a 1-hour emergency sepsis bundle improve lactate clearance and in-hospital survival?",
      exampleBlurb: "Plan study, run on-device observational tests on clinic records, complete STROBE checklist, and publish.",
      firstScreen: "plan",
      protocolSpec: {
        population: "Adults presenting to the emergency department with suspected sepsis (qSOFA >= 2)",
        intervention: "1-hour sepsis bundle (cultures, lactate, broad-spectrum antibiotics, 30 mL/kg fluids)",
        comparison: "Pre-bundle standard emergency triage",
        outcome: "28-day hospital survival and time to antibiotics"
      },
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Background: Timely sepsis recognition lowers mortality. Methods: Observational audit before and after implementing a 1-hour bundle. Results: Door-to-antibiotic time dropped substantially with improved survival. Conclusion: Standardized triage bundles save lives." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Each hour of antimicrobial delay in septic shock increases mortality." },
        { id: "methods", heading: "Methods", level: 1, text: "De-identified audit records were evaluated following STROBE recommendations." },
        { id: "results", heading: "Results", level: 1, text: "Bundle compliance rose across shifts alongside significantly faster fluid and antibiotic delivery." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Pre-packed sepsis trays remove bedside bottlenecks." }
      ]
    },
    {
      key: "thesis",
      label: "Thesis to Journal Article",
      checklistLabel: "STROBE",
      checklistId: "strobe",
      studyType: "Thesis to Journal Article",
      shortTitle: "Predictors of Diabetic Retinopathy (Thesis)",
      fullTitle: "Prevalence and Clinical Predictors of Diabetic Retinopathy in Type 2 Diabetes: Converting an MD Thesis into a Journal Article",
      journal: "Indian J Med Res",
      specialty: "Ophthalmology & Medicine",
      researchQuestion: "What clinical and biochemical predictors associate with sight-threatening retinopathy in adult type 2 diabetes?",
      exampleBlurb: "Convert a full 80-page MD/MS thesis into a crisp 3,000-word journal article with verified tables & citations.",
      firstScreen: "thesis",
      manuscriptSections: [
        { id: "abstract", heading: "Abstract", level: 1, text: "Background: Converting thesis dissertations into concise peer-reviewed manuscripts amplifies clinical impact. Results: Among 120 adults with type 2 diabetes, retinopathy prevalence was 31.7%, driven by diabetes duration and elevated HbA1c. Conclusion: Early fundus screening catches preventable vision loss." },
        { id: "introduction", heading: "Introduction", level: 1, text: "Diabetic retinopathy remains the leading preventable cause of adult blindness." },
        { id: "methods", heading: "Methods", level: 1, text: "We condensed our cross-sectional university thesis into IMRaD sections while verifying every table statistic." },
        { id: "results", heading: "Results", level: 1, text: "Mean age was 54.2 years across 120 participants; multivariable predictors matched the primary thesis Table 7 verbatim." },
        { id: "discussion", heading: "Discussion", level: 1, text: "Routine annual retinal photography should prioritize patients exceeding 5 years of diabetes duration." }
      ]
    }
  ];

  function exampleByKey(key) {
    for (var i = 0; i < EXAMPLES.length; i++) {
      if (EXAMPLES[i].key === key) return EXAMPLES[i];
    }
    return null;
  }

  function keyForStudyType(studyType) {
    var t = String(studyType || "").toLowerCase();
    if (t.indexOf("case-control") >= 0 || t.indexOf("case control") >= 0) return "case-control";
    if (t.indexOf("case-series") >= 0 || t.indexOf("case series") >= 0) return "case-series";
    if (t.indexOf("case-report") >= 0 || t.indexOf("case report") >= 0) return "case";
    if (t.indexOf("rct") >= 0 || t.indexOf("randomized controlled") >= 0 || t.indexOf("randomised controlled") >= 0) return "trial";
    if (t.indexOf("cohort") >= 0 && t.indexOf("synthesis") < 0) return "cohort";
    if (t.indexOf("thesis") >= 0) return "thesis";
    if (t.indexOf("master") >= 0) return "masterchart";
    if (t.indexOf("observational") >= 0) return "obs";
    return "sr";
  }

  /* ---- 2. Preferences & Tutorial Sandbox Storage ----------------------- */

  function readJson(key, fallback) {
    try {
      var raw = G.localStorage ? G.localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try {
      if (G.localStorage) G.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  function getPrefs() {
    var p = readJson(PREFS_KEY, null);
    if (!p || typeof p !== "object") p = {};
    if (!p.skipByType) p.skipByType = {};
    if (!p.completedByType) p.completedByType = {};
    return p;
  }

  function isTutorialDefault(key) {
    var p = getPrefs();
    if (p.globalSkip) return false;
    return !p.skipByType[key];
  }

  function setTutorialDefault(key, enabled) {
    var p = getPrefs();
    if (!key) {
      p.globalSkip = !enabled;
    } else {
      if (enabled) delete p.skipByType[key];
      else p.skipByType[key] = true;
    }
    writeJson(PREFS_KEY, p);
  }

  function isCompleted(key) {
    var p = getPrefs();
    return !!(p.completedByType && p.completedByType[key]);
  }

  function markPublished(proj, statusRec) {
    if (!proj) return;
    var p = getPrefs();
    var key = proj.tutorialKey || keyForStudyType(proj.studyType);
    if (proj.tutorial && key) {
      p.completedByType[key] = {
        at: (statusRec && statusRec.publishedAt) || Date.now(),
        doi: (statusRec && statusRec.doi) || "",
        title: proj.title
      };
      writeJson(PREFS_KEY, p);
    }
  }

  function getPubStatus(pid) {
    var all = readJson(PUB_KEY, {});
    return all[pid] || null;
  }

  function setPubStatus(pid, rec) {
    var all = readJson(PUB_KEY, {});
    all[pid] = rec;
    writeJson(PUB_KEY, all);
  }

  function getSandboxAll() {
    return readJson(STATE_KEY, {});
  }

  function getSandbox(pid) {
    var all = getSandboxAll();
    if (!all[pid]) {
      var key = String(pid || "").replace(/^tut_/, "");
      var ex = exampleByKey(key) || EXAMPLES[0];
      var secs = [];
      for (var i = 0; i < (ex.manuscriptSections || []).length; i++) {
        secs.push({
          id: ex.manuscriptSections[i].id,
          heading: ex.manuscriptSections[i].heading,
          level: ex.manuscriptSections[i].level || 1,
          text: ""
        });
      }
      all[pid] = {
        key: ex.key,
        stepsDone: {},
        protocol: null,
        searchRuns: [],
        records: [],
        decisions: {},
        manuscript: {
          id: "man_" + pid,
          projectId: pid,
          version: 1,
          title: ex.fullTitle,
          authors: ["Student Researcher", "Clinical Mentor"],
          affiliations: "StewardMD Academic Research Collaborative",
          status: "draft",
          journal: ex.journal || "JAMA",
          sections: secs,
          tokens: {
            "tut_run_1:estimate": { value: 0.49, formatted: "0.49" },
            "tut_run_1:ciLower": { value: 0.34, formatted: "0.34" },
            "tut_run_1:ciUpper": { value: 0.70, formatted: "0.70" },
            "tut_run_1:p": { value: 0.0001, formatted: "< .001" },
            "tut_run_1:i2": { value: 72.8, formatted: "72.8%" }
          },
          references: [
            { key: "colditz1994", title: "Colditz GA et al. JAMA 1994", doi: "10.1001/jama.1994.03510370074034", pmid: "8309034" }
          ],
          approval: null,
          lock: null
        },
        manualChecklist: {},
        formatFixed: false
      };
      writeJson(STATE_KEY, all);
    }
    return all[pid];
  }

  function saveSandbox(pid, sb) {
    var all = getSandboxAll();
    all[pid] = sb;
    writeJson(STATE_KEY, all);
  }

  function resetSandbox(pid) {
    var all = getSandboxAll();
    delete all[pid];
    writeJson(STATE_KEY, all);
    var pubAll = readJson(PUB_KEY, {});
    delete pubAll[pid];
    writeJson(PUB_KEY, pubAll);
  }

  function checklistDef(gid) {
    function makeChecklist(id, name, rows) {
      var mapped = [];
      for (var i = 0; i < rows.length; i++) {
        mapped.push({
          num: rows[i].num,
          topic: rows[i].section,
          text: rows[i].title,
          projectField: "manual"
        });
      }
      return {
        id: id,
        name: name,
        items: rows,
        sections: [{ title: "Reporting Checklist Items", items: mapped }]
      };
    }
    var defs = {
      care: makeChecklist("care", "CARE 2013 Case Report Checklist", [
        { num: "1", section: "Title", title: "Title identifies diagnosis/intervention followed by case report", projectField: "title" },
        { num: "4", section: "Introduction", title: "Clinical background explaining why this case is unique", projectField: "introduction" },
        { num: "5", section: "Patient Information", title: "De-identified demographics, symptoms, and medical history", projectField: "casePresentation" },
        { num: "7", section: "Timeline", title: "Important milestones organized chronologically", projectField: "timeline" },
        { num: "11", section: "Discussion", title: "Strengths, limitations, and primary take-away lessons", projectField: "discussion" },
        { num: "13", section: "Informed Consent", title: "Patient provided informed consent for publication", projectField: "pubconsent" }
      ]),
      consort: makeChecklist("consort", "CONSORT 2010 Trial Checklist", [
        { num: "1a", section: "Title", title: "Identification as a randomized trial in the title", projectField: "title" },
        { num: "2a", section: "Background", title: "Scientific background and explanation of rationale", projectField: "introduction" },
        { num: "7a", section: "Sample Size", title: "How sample size was determined", projectField: "methods" },
        { num: "8a", section: "Randomisation", title: "Method used to generate the random allocation sequence", projectField: "randomise" },
        { num: "17a", section: "Outcomes", title: "Primary outcome results, effect size, and precision", projectField: "results" },
        { num: "23", section: "Registration", title: "Registration number and name of trial registry", projectField: "ctri" }
      ]),
      strobe: makeChecklist("strobe", "STROBE Observational Checklist", [
        { num: "1a", section: "Title & Abstract", title: "Indicate the study design in title or abstract", projectField: "abstract" },
        { num: "3", section: "Introduction", title: "State specific objectives and prespecified hypotheses", projectField: "introduction" },
        { num: "4", section: "Study Design", title: "Present key elements of study design early in the paper", projectField: "methods" },
        { num: "10", section: "Study Size", title: "Explain how the study size was arrived at", projectField: "methods" },
        { num: "16", section: "Main Results", title: "Give unadjusted and adjusted estimates with 95% confidence intervals", projectField: "results" },
        { num: "18", section: "Discussion", title: "Summarise key results with reference to study objectives", projectField: "discussion" }
      ]),
      prisma2020: makeChecklist("prisma2020", "PRISMA 2020 Review Checklist", [
        { num: "1", section: "Title", title: "Identify the report as a systematic review", projectField: "title" },
        { num: "3", section: "Introduction", title: "Describe the rationale for the review", projectField: "introduction" },
        { num: "6", section: "Information Sources", title: "Specify all databases and dates searched", projectField: "methods" },
        { num: "16", section: "Study Selection", title: "Describe numbers of studies screened and included", projectField: "prisma" },
        { num: "20", section: "Synthesis", title: "Present pooled results, confidence intervals, and heterogeneity", projectField: "results" },
        { num: "24", section: "Discussion", title: "Provide a general interpretation of results and limitations", projectField: "discussion" }
      ])
    };
    return defs[gid] || defs.strobe;
  }

  /* ---- 3. Seamless Sandbox API Wrapper for Tutorial Projects ------------- */

  var apiWrapped = false;
  function installApiWrapper() {
    if (apiWrapped || !SMD.api) return;
    var origReq = SMD.api.request;
    var origUp = SMD.api.upload;
    apiWrapped = true;

    SMD.api.upload = function (path, formData) {
      var m = String(path || "").match(/^\/v1\/projects\/(tut_[^/]+)\//);
      if (!m) return origUp(path, formData);
      return Promise.resolve({
        storageKey: "projects/" + m[1] + "/imports/tutorial_upload.txt",
        sha256: "tut0000",
        bytes: 512,
        pdf: { id: "pdf_" + m[1], filename: "tutorial-thesis.pdf" }
      });
    };

    SMD.api.request = function (method, path, body) {
      var meth = String(method || "GET").toUpperCase();
      var clean = String(path || "").split("?")[0];
      var mProj = clean.match(/^\/v1\/projects\/(tut_[^/]+)(\/.*)?$/);
      var mProto = clean.match(/^\/v1\/protocols\/(proto_tut_[^/]+)$/);
      var mChk = clean.match(/^\/v1\/checklists(?:\/([^/]+))?$/);
      var mRec = clean.match(/^\/v1\/records\/(tut_rec_[^/]+)\/decisions$/);

      /* Handle /v1/checklists when active project is a tutorial */
      var act = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
      if (mChk && act && act.tutorial) {
        if (!mChk[1]) {
          return Promise.resolve({
            checklists: [checklistDef("care"), checklistDef("strobe"), checklistDef("consort"), checklistDef("prisma2020")]
          });
        }
        return Promise.resolve({ checklist: checklistDef(mChk[1]) });
      }

      if (mProto) {
        var pidFromProto = mProto[1].replace(/^proto_/, "");
        var sbP = getSandbox(pidFromProto);
        return Promise.resolve({ protocol: sbP.protocol });
      }

      if (mRec) {
        var parts = mRec[1].split("_");
        var recPid = "tut_" + (parts[2] || "sr");
        var sbR = getSandbox(recPid);
        if (meth === "POST") {
          sbR.decisions[mRec[1]] = (body && body.decision) || "include";
          saveSandbox(recPid, sbR);
          return Promise.resolve({ decision: { id: "dec_" + mRec[1], decision: sbR.decisions[mRec[1]] } });
        }
        return Promise.resolve({ decisions: [] });
      }

      if (!mProj) {
        return origReq(method, path, body);
      }

      var pid = mProj[1];
      var sub = mProj[2] || "";
      var sb = getSandbox(pid);
      var ex = exampleByKey(sb.key) || EXAMPLES[0];

      /* Protocols */
      if (sub === "/protocols") {
        if (meth === "GET") {
          return Promise.resolve({ protocols: sb.protocol ? [sb.protocol] : [] });
        }
        if (meth === "POST") {
          var spec = ex.protocolSpec || { population: "Study population", intervention: "Intervention", comparison: "Comparator", outcome: "Primary outcome" };
          sb.protocol = {
            id: "proto_" + pid,
            projectId: pid,
            version: (sb.protocol ? sb.protocol.version + 1 : 1),
            status: "draft",
            createdTs: Date.now(),
            content: (body && body.content) || { pico: spec, outcomes: { primary: spec.outcome }, eligibility: ["Adults meeting criteria"], subgroups: [] }
          };
          saveSandbox(pid, sb);
          return Promise.resolve({ protocol: sb.protocol });
        }
      }

      /* Find studies (0 tokens, simulated pubmed/europe_pmc/crossref results for tutorial topic) */
      if (sub === "/find-studies" && meth === "POST") {
        var q = (body && body.q) || ex.shortTitle;
        return Promise.resolve({
          results: [
            {
              pmid: "8309034",
              doi: "10.1001/jama.1994.03510370074034",
              title: ex.fullTitle + " (Primary Reference)",
              authors: ["Aronson JD", "Colditz GA"],
              year: 2024,
              journal: ex.journal || "JAMA",
              abstract: "Controlled investigation of " + q + " demonstrating clinically significant benefit (RR 0.49, 95% CI 0.34 to 0.70).",
              freeFullText: true,
              source: "pubmed",
              sources: ["pubmed", "europe_pmc", "crossref"]
            },
            {
              pmid: "29400012",
              doi: "10.1016/j.trial.2025.001",
              title: "Prospective Evaluation of " + ex.shortTitle,
              authors: ["Patel R", "Sharma K"],
              year: 2025,
              journal: "BMJ",
              abstract: "Cohort and trial validation supporting the primary clinical findings.",
              freeFullText: true,
              source: "europe_pmc",
              sources: ["europe_pmc"]
            },
            {
              pmid: "",
              doi: "10.5000/rmd." + ex.key,
              title: "Crossref Multicenter Registry Follow-Up: " + ex.shortTitle,
              authors: ["Kumar M", "Nair S"],
              year: 2026,
              journal: "NEJM",
              abstract: "Multicenter clinical registry confirming long-term durability and safety.",
              freeFullText: false,
              source: "crossref",
              sources: ["crossref"]
            }
          ]
        });
      }

      /* Searches & Records */
      if (sub === "/searches") {
        if (meth === "GET") return Promise.resolve({ searchRuns: sb.searchRuns, nextCursor: null });
        if (meth === "POST") {
          var run = { id: "srch_" + Date.now(), database: (body && body.database) || "pubmed", query: (body && body.query) || ex.shortTitle, resultCount: 24, createdTs: Date.now(), apiVersion: "tut-v1" };
          sb.searchRuns.unshift(run);
          saveSandbox(pid, sb);
          return Promise.resolve({ searchRun: run });
        }
      }
      if (sub === "/records") {
        if (meth === "GET") {
          return Promise.resolve({ records: sb.records, nextCursor: null });
        }
        if (meth === "POST") {
          var newRec = {
            id: "tut_rec_" + sb.key + "_" + (sb.records.length + 1),
            projectId: pid,
            source: (body && body.source) || "pubmed",
            externalId: (body && (body.pmid || body.doi)) || String(sb.records.length + 1),
            title: (body && body.title) || "Tutorial Study",
            authors: (body && body.authors) || ["Researcher A"],
            year: (body && body.year) || 2025,
            doi: (body && body.doi) || "",
            metadata: { journal: (body && body.journal) || "JAMA", abstract: (body && body.abstract) || "" },
            createdTs: Date.now()
          };
          sb.records.push(newRec);
          saveSandbox(pid, sb);
          return Promise.resolve({ record: newRec, duplicate: false });
        }
      }

      /* Screening, Conflicts, PRISMA, Extract, ROB, Data, Grade */
      if (sub === "/exclusion-reasons") {
        return Promise.resolve({ reasons: [{ code: "wrong_population", label: "Wrong population" }, { code: "wrong_design", label: "Wrong study design" }] });
      }
      if (sub === "/conflicts") return Promise.resolve({ conflicts: [] });
      if (sub === "/prisma") {
        var recsCount = Math.max(sb.records.length, 24);
        var incCount = (SMD.store && SMD.store.getStudies) ? Math.max((SMD.store.getStudies(pid) || []).length, 4) : 4;
        return Promise.resolve({
          prisma: {
            recordsIdentified: recsCount,
            recordsFromDatabases: recsCount,
            recordsFromOtherSources: 0,
            recordsDuplicatesRemoved: 4,
            recordsScreened: recsCount - 4,
            recordsExcluded: Math.max(0, recsCount - 4 - incCount),
            reportsSought: incCount,
            reportsNotRetrieved: 0,
            reportsAssessed: incCount,
            reportsExcluded: 0,
            studiesIncluded: incCount,
            conflictsOpen: 0,
            excludedByReason: []
          }
        });
      }
      if (sub === "/pdfs" || sub === "/extractions" || sub === "/rob" || sub === "/data-imports" || sub === "/grade") {
        return Promise.resolve({ items: [], pdfs: [], extractions: [], assessments: [], imports: [], grades: [] });
      }
      if (sub === "/ai-draft" && meth === "POST") {
        return Promise.resolve({ draft: {}, model: "tutorial-demo", costInr: 0 });
      }

      /* Manuscript */
      if (sub === "/manuscript") {
        return Promise.resolve({ manuscript: sb.manuscript });
      }
      if (sub === "/manuscript/versions") {
        return Promise.resolve({ versions: [{ version: sb.manuscript.version, createdTs: Date.now() }] });
      }
      if (sub.indexOf("/manuscript/sections/") === 0 && meth === "PUT") {
        var sid = sub.replace("/manuscript/sections/", "");
        var sec = null;
        for (var i = 0; i < sb.manuscript.sections.length; i++) {
          if (sb.manuscript.sections[i].id === sid) { sec = sb.manuscript.sections[i]; break; }
        }
        if (sec && body && body.text !== undefined) sec.text = body.text;
        saveSandbox(pid, sb);
        return Promise.resolve({ section: sec, version: sb.manuscript.version, tokens: sb.manuscript.tokens });
      }
      if (sub === "/manuscript/approval/approve" && meth === "POST") {
        sb.manuscript.status = "approved";
        sb.manuscript.approval = { status: "approved", approvedAt: Date.now() };
        saveSandbox(pid, sb);
        return Promise.resolve({ manuscript: sb.manuscript });
      }
      if (sub === "/manuscript/lock" && meth === "POST") {
        sb.manuscript.status = "locked";
        saveSandbox(pid, sb);
        return Promise.resolve({ manuscript: sb.manuscript });
      }
      if (sub === "/manuscript/export" && meth === "POST") {
        return Promise.resolve({ ok: true, filename: "tutorial-manuscript.docx" });
      }

      /* Checklists & Snapshot */
      if (sub === "/checklist-snapshot") {
        var chkList = checklistDef(ex.checklistId || "strobe");
        var manualMap = sb.manualChecklist || {};
        var manualCount = Object.keys(manualMap).length;
        return Promise.resolve({
          snapshot: {
            type: ex.checklistId || "strobe",
            projectTitle: ex.fullTitle,
            manual: manualMap,
            manuscript: { sections: sb.manuscript.sections || [] },
            prisma: { studiesIncluded: Math.max(sb.records.length, 4) },
            completeHint: manualCount >= chkList.items.length
          },
          completionPct: Math.min(100, Math.round((manualCount / Math.max(1, chkList.items.length)) * 100))
        });
      }
      if (sub.indexOf("/checklist-manual/") === 0) {
        if (meth === "GET") return Promise.resolve({ entries: sb.manualChecklist || {} });
        if (meth === "PUT") {
          if (body && body.num) sb.manualChecklist[body.num] = body.text || "Covered in tutorial manuscript";
          saveSandbox(pid, sb);
          return Promise.resolve({ entries: sb.manualChecklist });
        }
      }

      /* Format checks */
      if (sub === "/format-check") {
        var allReady = sb.manuscript.status === "approved" || sb.manuscript.status === "locked";
        var chkItems = checklistDef(ex.checklistId || "strobe").items;
        var chkComplete = Object.keys(sb.manualChecklist || {}).length >= chkItems.length;
        return Promise.resolve({
          checks: [
            { check: "title_length", status: "pass", detail: "Title length verified for " + (ex.journal || "JAMA") },
            { check: "required_sections", status: allReady ? "pass" : "warn", detail: allReady ? "All required manuscript sections finalized" : "Draft and approve sections in Manuscript", sectionId: ex.manuscriptSections[0].id },
            { check: "declarations", status: "pass", detail: "Ethics, funding, conflicts, and data availability prepared" },
            { check: "reporting_checklist", status: chkComplete ? "pass" : "warn", detail: chkComplete ? ex.checklistLabel + " checklist 100% complete" : "Complete " + ex.checklistLabel + " checklist items", sectionId: "checklist" }
          ]
        });
      }

      return Promise.resolve({});
    };
  }

  /* ---- 4. Launching & Resetting Tutorials ------------------------------- */

  function startTutorial(key, opts) {
    installApiWrapper();
    var ex = exampleByKey(key) || EXAMPLES[0];
    var pid = "tut_" + ex.key;
    var store = SMD.store;
    if (!store) return null;

    if (!opts || opts.reset !== false) {
      resetSandbox(pid);
      if (G.RMDStore && typeof G.RMDStore.clearProject === "function") {
        try { G.RMDStore.clearProject(pid); } catch (e) {}
      }
      try {
        G.localStorage.removeItem("smd_rmd_casefile_" + pid);
        G.localStorage.removeItem("smd_rmd_mc_tutorial_" + pid);
      } catch (e) {}
    }

    var state = store.getState();
    var now = Date.now();
    var proj = {
      id: pid,
      serverId: pid,
      practice: false,
      tutorial: true,
      tutorialKey: ex.key,
      title: "[Tutorial] " + ex.shortTitle,
      discipline: "medicine",
      specialty: ex.specialty,
      studyType: ex.studyType,
      targetJournal: ex.journal,
      researchQuestion: ex.researchQuestion,
      role: "owner",
      createdAt: now,
      updatedAt: now
    };

    var replaced = false;
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === pid) {
        state.projects[i] = proj;
        replaced = true;
        break;
      }
    }
    if (!replaced) state.projects.unshift(proj);
    state.studies[pid] = [];
    state.runs[pid] = [];
    store.setActiveProject(pid);

    getSandbox(pid);

    var first = (SMD.journeyFor ? SMD.journeyFor(proj)[0] : ex.firstScreen) || ex.firstScreen;
    if (SMD.navigate) SMD.navigate(first, { projectId: pid });
    return proj;
  }

  /* ---- 5. Step-by-Step Coach Guides & Auto-Fill Actions ------------------ */

  function setInput(el, val) {
    if (!el) return;
    el.value = val;
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }

  function stepGuide(screenName, proj) {
    var key = (proj && proj.tutorialKey) || keyForStudyType(proj && proj.studyType);
    var ex = exampleByKey(key) || EXAMPLES[0];

    var guides = {
      casefile: {
        ask: "Ask yourself: enter patient age (e.g. 42), sex, presenting complaint, diagnosis, and treatment, then click Save case file, OR click Enter & Show Me.",
        why: "CARE guidelines require chronological patient findings before writing.",
        sel: '#rmdCfAge, [data-rmd-cf="save"]',
        autoDo: function (body) {
          var firstCf = (ex.casefiles && ex.casefiles[0]) || {};
          setInput(body.querySelector("#rmdCfAge"), firstCf.age || "42");
          setInput(body.querySelector('[data-rmd-cf-field="sex"]'), firstCf.sex || "Female");
          setInput(body.querySelector('[data-rmd-cf-field="presenting"]'), firstCf.presenting || "Presenting complaint");
          setInput(body.querySelector('[data-rmd-cf-field="diagnosis"]'), firstCf.diagnosis || "Confirmed diagnosis");
          setInput(body.querySelector('[data-rmd-cf-field="treatment"]'), firstCf.treatment || "Standard management");
          setInput(body.querySelector('[data-rmd-cf-field="outcome"]'), firstCf.outcome || "Recovered");
          setInput(body.querySelector('[data-rmd-cf-field="unusual"]'), firstCf.unusual || "Rare clinical lesson");
          if (ex.casefiles && ex.casefiles.length > 1 && G.RMDStore && G.RMDStore.put) {
            for (var ci = 0; ci < ex.casefiles.length; ci++) {
              try { G.RMDStore.put(proj.id, "casefile", ex.casefiles[ci].id, ex.casefiles[ci]); } catch (e) {}
            }
          }
          var saveBtn = body.querySelector('[data-rmd-cf="save"]');
          if (saveBtn) saveBtn.click();
          return "Saved realistic patient case details cleanly onto your device.";
        }
      },
      novelty: {
        ask: "Type keywords into the Prior Cases search box and click Search to check novelty, OR click Enter & Show Me.",
        why: "Checking published cases confirms whether your case adds new clinical evidence.",
        sel: '#rmdNvQuery, [data-rmd-nv="search"]',
        autoDo: function (body) {
          var q = body.querySelector("#rmdNvQuery");
          setInput(q, ex.shortTitle);
          var btn = body.querySelector('[data-rmd-nv="search"]');
          if (btn) btn.click();
          return "Searched live online databases to check existing literature.";
        }
      },
      iec: {
        ask: "Select Ethics Committee status, add your IEC reference and approval date, OR click Enter & Show Me.",
        why: "Journals reject human research or case series without documented ethics oversight or exemption.",
        sel: '#rmdIecStatus, #rmdIecRef',
        autoDo: function (body) {
          var chks = body.querySelectorAll("[data-rmd-iec-packet]");
          for (var i = 0; i < chks.length; i++) {
            if (!chks[i].checked) { chks[i].checked = true; chks[i].dispatchEvent(new Event("change", { bubbles: true })); }
          }
          setInput(body.querySelector("#rmdIecStatus"), key === "case" ? "exempt" : "approved");
          setInput(body.querySelector("#rmdIecRef"), "IEC/RMD/2026/041");
          setInput(body.querySelector("#rmdIecDate"), nowIsoDate());
          return "Recorded Ethics Committee clearance (" + (key === "case" ? "Case Report Waiver" : "IEC Approved") + ").";
        }
      },
      pubconsent: {
        ask: "Select consent language, tick confirmation, and save patient publication consent, OR click Enter & Show Me.",
        why: "Written patient permission for de-identified clinical publication is mandatory under CARE.",
        sel: '[data-rmd="save-manual-consent"], #rmd-manual-local-check',
        autoDo: function (body) {
          var tab = body.querySelector('[data-rmd="tab-manual"]');
          if (tab) tab.click();
          var chk = body.querySelector("#rmd-manual-local-check");
          if (chk && !chk.checked) { chk.checked = true; chk.dispatchEvent(new Event("change", { bubbles: true })); }
          var btn = body.querySelector('[data-rmd="save-manual-consent"]');
          if (btn) btn.click();
          return "Patient consent for de-identified publication documented locally.";
        }
      },
      images: {
        ask: "Tick every de-identification safety check confirming no patient names, MRNs, or faces show, OR click Enter & Show Me.",
        why: "Protecting patient privacy prevents HIPAA/DPDP breaches before upload.",
        sel: '[data-rmd-img-check]',
        autoDo: function (body) {
          var chks = body.querySelectorAll("[data-rmd-img-check]");
          for (var i = 0; i < chks.length; i++) {
            if (!chks[i].checked) { chks[i].checked = true; chks[i].dispatchEvent(new Event("change", { bubbles: true })); }
          }
          return "Confirmed image de-identification safety checks.";
        }
      },
      plan: {
        ask: "Pick a study aim, review the calculated sample size, and save your plan, OR click Enter & Show Me.",
        why: "Adequate sample size avoids underpowered inconclusive trials.",
        sel: '[data-rmd="plan-save"], [data-rmd-aim]',
        autoDo: function (body) {
          var saveBtn = body.querySelector('[data-rmd="plan-save"]');
          if (saveBtn) saveBtn.click();
          return "Sample size and ethics study plan calculated and saved.";
        }
      },
      protocol: {
        ask: "Fill Population, Intervention, Comparison, and Outcome (PICO), then save the protocol, OR click Enter & Show Me.",
        why: "Pre-specifying PICO locks your research question before results bias decisions.",
        sel: '[data-rmd-pico="population"], [data-rmd="proto-create"], [data-rmd="proto-save"]',
        autoDo: function (body) {
          var spec = ex.protocolSpec || { population: "Adult patients", intervention: "Intervention arm", comparison: "Control arm", outcome: "Primary clinical outcome" };
          var createBtn = body.querySelector('[data-rmd="proto-create"]');
          if (createBtn) {
            createBtn.click();
            setTimeout(function () {
              var b2 = D.querySelector("#rmdScreenBody");
              if (!b2) return;
              setInput(b2.querySelector('[data-rmd-pico="population"]'), spec.population);
              setInput(b2.querySelector('[data-rmd-pico="intervention"]'), spec.intervention);
              setInput(b2.querySelector('[data-rmd-pico="comparison"]'), spec.comparison);
              setInput(b2.querySelector('[data-rmd-pico="outcome"]'), spec.outcome);
              setInput(b2.querySelector('[data-rmd-out="primary"]'), spec.outcome);
              var sBtn = b2.querySelector('[data-rmd="proto-save"]');
              if (sBtn) sBtn.click();
            }, 120);
          } else {
            setInput(body.querySelector('[data-rmd-pico="population"]'), spec.population);
            setInput(body.querySelector('[data-rmd-pico="intervention"]'), spec.intervention);
            setInput(body.querySelector('[data-rmd-pico="comparison"]'), spec.comparison);
            setInput(body.querySelector('[data-rmd-pico="outcome"]'), spec.outcome);
            setInput(body.querySelector('[data-rmd-out="primary"]'), spec.outcome);
            var sBtn = body.querySelector('[data-rmd="proto-save"]');
            if (sBtn) sBtn.click();
          }
          return "Filled PICO protocol fields and saved Protocol v1.";
        }
      },
      ctri: {
        ask: "Select Registered, type your CTRI ID and registration date, and click Save, OR click Enter & Show Me.",
        why: "ICJME journals reject clinical trials unless prospectively registered before the first patient.",
        sel: '#rmd-ctri-status, #rmd-ctri-number, [data-rmd="ctri-save"]',
        autoDo: function (body) {
          setInput(body.querySelector("#rmd-ctri-status"), "registered");
          setInput(body.querySelector("#rmd-ctri-number"), "CTRI/2026/11/098412");
          setInput(body.querySelector("#rmd-ctri-date"), nowIsoDate());
          var btn = body.querySelector('[data-rmd="ctri-save"]');
          if (btn) btn.click();
          return "Trial registration details saved and compliance statement generated.";
        }
      },
      randomise: {
        ask: "Enter arms, block size, and total N, then click Generate list and Save blinding, OR click Enter & Show Me.",
        why: "Concealed randomisation prevents selection bias.",
        sel: '[data-rmd="generate-random-list"], [data-rmd="save-blinding"]',
        autoDo: function (body) {
          setInput(body.querySelector("#rmd-rand-arms"), "Hydrocolloid, Silver Sulfadiazine");
          setInput(body.querySelector("#rmd-rand-n"), "40");
          setInput(body.querySelector("#rmd-rand-blocks"), "4");
          var gBtn = body.querySelector('[data-rmd="generate-random-list"]');
          if (gBtn) gBtn.click();
          var bBtn = body.querySelector('[data-rmd="save-blinding"]');
          if (bBtn) bBtn.click();
          return "Generated 1:1 permuted-block allocation list and saved blinding plan on-device.";
        }
      },
      masterchart: {
        ask: "Load the built-in sample dataset, advance to variables, and click Run analysis on your device, OR click Enter & Show Me.",
        why: "All statistical tests run locally inside your device so patient rows never leave your phone.",
        sel: '[data-rmd-mc="sample"], [data-rmd-mc="continue-columns"], [data-rmd-mc="continue-identifiers"], [data-rmd-mc="run"]',
        autoDo: function (body) {
          var stepBtns = ['[data-rmd-mc="sample"]', '[data-rmd-mc="continue-columns"]', '[data-rmd-mc="continue-identifiers"]', '[data-rmd-mc="run"]'];
          for (var i = 0; i < stepBtns.length; i++) {
            var b = body.querySelector(stepBtns[i]);
            if (b) { b.click(); break; }
          }
          if (!body.querySelector('[data-rmd-mc="sample"]') && !body.querySelector('[data-rmd-mc="run"]')) {
            var choice = body.querySelector('[data-rmd-mc-choice="table1"]');
            if (choice) choice.click();
          }
          return "Advanced Master Chart analysis cleanly on-device (tap again if multiple stages remain).";
        }
      },
      studies: {
        ask: "Click Add manually or Find and add studies, OR click Enter & Show Me to add 4 verified BCG trials.",
        why: "Verified outcome numbers feed directly into the pooled forest plot.",
        sel: '[data-rmd="add-study"], [data-rmd="find-studies"]',
        autoDo: function () {
          var list = ex.studiesSeed || EXAMPLES[5].studiesSeed;
          if (SMD.store && SMD.store.createStudy && SMD.store.getStudies(proj.id).length === 0) {
            for (var i = 0; i < list.length; i++) {
              SMD.store.createStudy(proj.id, list[i]);
            }
          }
          if (SMD.refreshScreen) SMD.refreshScreen();
          return "Added " + list.length + " verified clinical trials into your Studies table.";
        }
      },
      search: {
        ask: "Type a plain topic in Quick Search and click Search All Sources, OR click Enter & Show Me.",
        why: "Searching PubMed, Europe PMC, and Crossref in one box prevents missed evidence.",
        sel: '#rmd_topic_q, [data-rmd="topic-search"]',
        autoDo: function (body) {
          setInput(body.querySelector("#rmd_topic_q"), ex.shortTitle);
          var btn = body.querySelector('[data-rmd="topic-search"]');
          if (btn) btn.click();
          setTimeout(function () {
            var addAll = D.querySelector('[data-rmd="topic-add-all"]');
            if (addAll) addAll.click();
          }, 220);
          return "Searched all 3 live online sources and queued papers directly into Screening.";
        }
      },
      screening: {
        ask: "Vote Include or Exclude on titles/abstracts, OR click Enter & Show Me.",
        why: "Documented screening generates an auditable PRISMA flow diagram.",
        sel: '[data-rmd-vote="include"], [data-rmd="to-search"]',
        autoDo: function (body) {
          var v = body.querySelector('[data-rmd-vote="include"]');
          if (v) v.click();
          return "Recorded inclusion decision in Screening.";
        }
      },
      run: {
        ask: "Verify your effect measure (Risk Ratio) and click Run Meta-Analysis, OR click Enter & Show Me.",
        why: "Statistical pooling computes the weighted overall effect, confidence interval, and heterogeneity I2.",
        sel: '[data-rmd="calculate"]',
        autoDo: function (body) {
          var calc = body.querySelector('[data-rmd="calculate"]');
          if (calc) calc.click();
          return "Pooled studies mathematically and generated forest plot.";
        }
      },
      thesis: {
        ask: "Upload your thesis PDF or click Enter & Show Me to load our sample MD Ophthalmology thesis.",
        why: "ResearchMD keeps thesis figures anchored to exact page numbers so zero hallucinations enter your paper.",
        sel: '#rmdThesisFile',
        autoDo: function () {
          if (SMD.navigate) SMD.navigate("manuscript", {});
          return "Loaded structured thesis data and jumped cleanly into your draft manuscript.";
        }
      },
      manuscript: {
        ask: "Inspect or edit your sections and click Mark as final (approve this version), OR click Enter & Show Me to draft and approve every section.",
        why: "Only clinician-approved manuscripts can proceed to final journal submission.",
        sel: '[data-rmd="manuscript-approve"], [data-rmd="section-save"]',
        autoDo: function (body) {
          var sb = getSandbox(proj.id);
          for (var i = 0; i < (ex.manuscriptSections || []).length; i++) {
            var srcSec = ex.manuscriptSections[i];
            for (var j = 0; j < sb.manuscript.sections.length; j++) {
              if (sb.manuscript.sections[j].id === srcSec.id) {
                sb.manuscript.sections[j].text = srcSec.text;
              }
            }
          }
          sb.manuscript.status = "approved";
          sb.manuscript.approval = { status: "approved", approvedAt: Date.now() };
          saveSandbox(proj.id, sb);
          if (SMD.refreshScreen) SMD.refreshScreen();
          else if (body) {
            var appBtn = body.querySelector('[data-rmd="manuscript-approve"]');
            if (appBtn) appBtn.click();
          }
          return "Drafted all sections from the worked example and approved Manuscript v1.";
        }
      },
      checklist: {
        ask: "Fill in how your paper covers each reporting item, OR click Enter & Show Me to complete the entire " + ex.checklistLabel + " checklist.",
        why: "Peer reviewers check " + ex.checklistLabel + " compliance before sending manuscripts for review.",
        sel: '[data-rmd-manual], [data-rmd-manual-save]',
        autoDo: function () {
          var sb = getSandbox(proj.id);
          var def = checklistDef(ex.checklistId || "strobe");
          for (var i = 0; i < def.items.length; i++) {
            sb.manualChecklist[def.items[i].num] = "Verified in tutorial " + def.items[i].section + " section.";
          }
          saveSandbox(proj.id, sb);
          if (SMD.refreshScreen) SMD.refreshScreen();
          return "Completed all " + def.items.length + " " + ex.checklistLabel + " checklist items.";
        }
      },
      ready: {
        ask: "Verify your Journal Format Checks, click Confirm & Submit Paper, then click Accept & Publish Paper for your publication celebration!",
        why: "Final verification confirms zero missing sections, complete checklist, and ready-to-upload submission files.",
        sel: '[data-rmd="submit-paper"], [data-rmd="publish-paper"]',
        autoDo: function (body) {
          var pubBtn = body.querySelector('[data-rmd="publish-paper"]');
          if (pubBtn && !pubBtn.disabled) { pubBtn.click(); return "Triggered editorial acceptance and Publication Celebration!"; }
          var subBtn = body.querySelector('[data-rmd="submit-paper"]');
          if (subBtn && !subBtn.disabled) {
            subBtn.click();
            return "Submitted manuscript pack to " + (ex.journal || "JAMA") + "!";
          }
          var sb = getSandbox(proj.id);
          sb.manuscript.status = "approved";
          sb.manuscript.approval = { status: "approved", approvedAt: Date.now() };
          var def = checklistDef(ex.checklistId || "strobe");
          for (var i = 0; i < def.items.length; i++) sb.manualChecklist[def.items[i].num] = "Verified in tutorial";
          saveSandbox(proj.id, sb);
          if (SMD.refreshScreen) SMD.refreshScreen();
          return "Completed remaining approval & checklist checks so Submit is unlocked!";
        }
      }
    };

    return guides[screenName] || {
      ask: "Review this step and click Next when ready, OR click Enter & Show Me.",
      why: "Each step builds an auditable, journal-ready research trail.",
      sel: ".rmd-card",
      autoDo: function () {
        var sb = getSandbox(proj.id);
        sb.stepsDone[screenName] = true;
        saveSandbox(proj.id, sb);
        return "Completed step " + screenName + " cleanly.";
      }
    };
  }

  /* ---- 6. Coach Bar UI & Target Highlighting --------------------------- */

  var coachMsg = "";
  var pulseTimer = null;

  function clearSpotlight() {
    if (!D) return;
    var old = D.querySelectorAll(".rmd-tut-spot");
    for (var i = 0; i < old.length; i++) old[i].classList.remove("rmd-tut-spot");
  }

  function highlightTarget(sel) {
    clearSpotlight();
    if (!sel || !D) return;
    var body = D.querySelector("#rmdScreenBody");
    if (!body) return;
    var parts = String(sel).split(",");
    for (var i = 0; i < parts.length; i++) {
      var target = body.querySelector(parts[i].trim());
      if (target) {
        target.classList.add("rmd-tut-spot");
        try { target.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(clearSpotlight, 4500);
        break;
      }
    }
  }

  function renderBar(rootEl, screenName, proj) {
    if (!rootEl) return;
    var wrap = rootEl.querySelector("#rmdTutWrap");
    if (!wrap) return;

    if (!proj || !proj.tutorial || screenName === "projects" || screenName === "start") {
      wrap.innerHTML = "";
      return;
    }

    var key = proj.tutorialKey || keyForStudyType(proj.studyType);
    var ex = exampleByKey(key) || EXAMPLES[0];
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1;
    for (var i = 0; i < journey.length; i++) {
      if (journey[i] === screenName) idx = i;
    }
    var nextStep = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var guide = stepGuide(screenName, proj);
    var sb = getSandbox(proj.id);
    var isDef = isTutorialDefault(key);

    var h = [];
    h.push('<div class="rmd-tut-bar" id="rmdTutBar" role="region" aria-label="Interactive Tutorial Coach">');
    h.push('  <div class="rmd-tut-top">');
    h.push('    <span class="rmd-badge rmd-badge-pill" style="background:var(--rmd-acc);color:#fff;">Tutorial · ' + esc(ex.label) + '</span>');
    h.push('    <span class="rmd-tut-prog">' + (idx >= 0 ? ('Step ' + (idx + 1) + ' of ' + journey.length) : 'Guided Practice') + ' · ' + esc(ex.journal || 'Journal') + ' · 0 tokens</span>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-tut="skip" style="margin-left:auto;">Skip tutorial</button>');
    h.push('  </div>');
    h.push('  <p class="rmd-tut-ask">' + esc(guide.ask) + '</p>');
    h.push('  <p class="rmd-tut-why">Why this matters: ' + esc(guide.why) + '</p>');
    if (coachMsg) {
      h.push('  <div class="rmd-banner rmd-banner-info" style="margin:6px 0;" role="status">' + esc(coachMsg) + '</div>');
    }
    h.push('  <div class="rmd-tut-actions">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-tut="auto">Enter &amp; Show Me</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-tut="spot">Show me where</button>');
    if (nextStep) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-tut="next">Next step: ' + esc(nextStep) + '</button>');
    }
    h.push('    <label class="rmd-tut-def"><input type="checkbox" data-rmd-tut="default"' + (isDef ? ' checked' : '') + '> Save tutorial as default for ' + esc(ex.label) + '</label>');
    h.push('  </div>');
    h.push('</div>');

    wrap.innerHTML = h.join("\n");

    var autoBtn = wrap.querySelector('[data-rmd-tut="auto"]');
    if (autoBtn) {
      autoBtn.onclick = function () {
        var body = rootEl.querySelector("#rmdScreenBody");
        coachMsg = guide.autoDo ? guide.autoDo(body) : "Completed step.";
        var freshSb = getSandbox(proj.id);
        freshSb.stepsDone[screenName] = true;
        saveSandbox(proj.id, freshSb);
        renderBar(rootEl, screenName, proj);
      };
    }
    var spotBtn = wrap.querySelector('[data-rmd-tut="spot"]');
    if (spotBtn) {
      spotBtn.onclick = function () { highlightTarget(guide.sel); };
    }
    var nextBtn = wrap.querySelector('[data-rmd-tut="next"]');
    if (nextBtn) {
      nextBtn.onclick = function () {
        coachMsg = "";
        if (SMD.navigate && nextStep) SMD.navigate(nextStep, {});
      };
    }
    var skipBtn = wrap.querySelector('[data-rmd-tut="skip"]');
    if (skipBtn) {
      skipBtn.onclick = function () {
        coachMsg = "";
        setTutorialDefault(key, false);
        if (SMD.navigate) SMD.navigate("start", {});
      };
    }
    var defChk = wrap.querySelector('[data-rmd-tut="default"]');
    if (defChk) {
      defChk.onchange = function () { setTutorialDefault(key, !!this.checked); };
    }
  }

  /* ---- 7. Publication Celebration Modal + Confetti --------------------- */

  var celeKeyHandler = null;
  function closeCelebration() {
    var rootEl = D.getElementById("researchMD");
    var m = rootEl ? rootEl.querySelector("#rmdCelebrationModal") : D.getElementById("rmdCelebrationModal");
    if (m && m.parentNode) m.parentNode.removeChild(m);
    if (celeKeyHandler) {
      D.removeEventListener("keydown", celeKeyHandler);
      celeKeyHandler = null;
    }
  }

  function showCelebration(proj, statusRec) {
    var rootEl = D.getElementById("researchMD");
    if (!rootEl) return;
    closeCelebration();
    markPublished(proj, statusRec);

    var key = (proj && proj.tutorialKey) || keyForStudyType(proj && proj.studyType);
    var ex = exampleByKey(key) || EXAMPLES[0];
    var journal = (statusRec && statusRec.journal) || (proj && proj.targetJournal) || ex.journal || "JAMA";
    var doi = (statusRec && statusRec.doi) || ("10.1000/rmd." + key + ".2026");
    var cleanTitle = String((proj && proj.title) || ex.fullTitle).replace(/^\[Tutorial\]\s*/i, "");
    var citation = "Researcher S, Mentor C. " + cleanTitle + ". " + journal + ". 2026. doi:" + doi;

    var confettiColors = ["#15803d", "#2563eb", "#eab308", "#ec4899", "#0ea5e9", "#f97316"];
    var confettiHtml = '<div class="rmd-cele-confetti" aria-hidden="true">';
    for (var ci = 0; ci < 24; ci++) {
      var left = Math.round((ci * 4.2) % 98);
      var delay = (ci * 0.08).toFixed(2);
      var color = confettiColors[ci % confettiColors.length];
      confettiHtml += '<span class="rmd-confetti-bit" style="left:' + left + '%;animation-delay:' + delay + 's;background:' + color + ';"></span>';
    }
    confettiHtml += '</div>';

    var back = D.createElement("div");
    back.className = "rmd-modal-backdrop rmd-cele-backdrop";
    back.id = "rmdCelebrationModal";
    back.innerHTML =
      confettiHtml +
      '<div class="rmd-modal-card rmd-cele-card" role="dialog" aria-modal="true" aria-labelledby="rmdCeleTitle">' +
      '  <div class="rmd-cele-medal" aria-hidden="true">' +
      '    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>' +
      '  </div>' +
      '  <span class="rmd-badge rmd-badge-pill" style="background:var(--rmd-acc);color:#fff;margin-bottom:6px;">Manuscript Submitted &amp; Published!</span>' +
      '  <h2 id="rmdCeleTitle" class="rmd-cele-heading">Congratulations, Author!</h2>' +
      '  <p class="rmd-cele-sub">' + (proj && proj.tutorial ? 'You completed the entire ' + esc(ex.label) + ' research tutorial from scratch to publication.' : 'Your paper milestone is recorded and ready to share.') + '</p>' +
      '  <div class="rmd-cele-cite">' +
      '    <div class="rmd-cele-meta">' + esc(ex.label) + ' &middot; ' + esc(journal) + ' &middot; ' + esc(ex.checklistLabel) + ' Verified</div>' +
      '    <div class="rmd-cele-citestr">' + esc(citation) + '</div>' +
      '  </div>' +
      '  <div class="rmd-cele-actions">' +
      '    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cele="own">Start my own ' + esc(ex.label) + '</button>' +
      '    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-cele="copy">Copy Citation</button>' +
      '    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-cele="hub">Try another example</button>' +
      '    <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-cele="close">Close</button>' +
      '  </div>' +
      '</div>';

    rootEl.appendChild(back);
    back.addEventListener("click", function (e) { if (e.target === back) closeCelebration(); });
    var btnClose = back.querySelector('[data-rmd-cele="close"]');
    if (btnClose) btnClose.onclick = closeCelebration;
    var btnHub = back.querySelector('[data-rmd-cele="hub"]');
    if (btnHub) btnHub.onclick = function () {
      closeCelebration();
      if (SMD.navigate) SMD.navigate("projects", {});
    };
    var btnOwn = back.querySelector('[data-rmd-cele="own"]');
    if (btnOwn) btnOwn.onclick = function () {
      closeCelebration();
      setTutorialDefault(key, false);
      if (SMD.navigate) SMD.navigate("start", { studyKey: key });
    };
    var btnCopy = back.querySelector('[data-rmd-cele="copy"]');
    if (btnCopy) btnCopy.onclick = function () {
      copyText(citation).then(function () { btnCopy.textContent = "Copied Citation"; });
    };
    celeKeyHandler = function (e) { if (e.key === "Escape") closeCelebration(); };
    D.addEventListener("keydown", celeKeyHandler);
  }

  /* ---- 8. Public Helpers Exposed for Projects, Start & Ready Screens ----- */

  SMD.tutorial = {
    EXAMPLES: EXAMPLES,
    exampleByKey: exampleByKey,
    keyForStudyType: keyForStudyType,
    isTutorialDefault: isTutorialDefault,
    setTutorialDefault: setTutorialDefault,
    isCompleted: isCompleted,
    startTutorial: startTutorial,
    renderBar: renderBar,
    getPubStatus: getPubStatus,
    setPubStatus: setPubStatus,
    markPublished: markPublished,
    showCelebration: showCelebration,
    closeCelebration: closeCelebration,
    clearCoachMessage: function () { coachMsg = ""; }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SMD.tutorial;
  }

})(typeof window !== "undefined" ? window : globalThis);
