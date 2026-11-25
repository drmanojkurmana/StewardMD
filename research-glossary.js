/* StewardMD - ResearchMD Glossary (window.SMD_RESEARCH_GLOSSARY).
 * Pure ES5 IIFE: no DOM, no Date, no Math.random, no I/O.
 * Dual export: browser global SMD_RESEARCH_GLOSSARY and CommonJS module.exports.
 *
 * Exactly 30 terms: { term, plain, example }.
 * term = the scientific name.
 * plain = one plain sentence a first-year MBBS student understands.
 * example = one short medical example.
 * Accurate: a statistician must find nothing wrong. Original wording.
 * No em or en dashes anywhere (use "to" or commas).
 */
(function (G) {
  "use strict";

  var GLOSSARY = [
    {
      term: "meta-analysis",
      plain: "A statistical method that pools quantitative results from multiple separate studies to calculate a single overall estimate of effect.",
      example: "Combining data from ten randomized trials to calculate the overall effect of aspirin on preventing heart attacks."
    },
    {
      term: "systematic review",
      plain: "A structured research study that uses predefined, transparent methods to find, select, and critically appraise all relevant evidence answering a specific clinical question.",
      example: "Searching four medical databases with explicit inclusion criteria to summarize all published evidence on dexamethasone for bacterial meningitis."
    },
    {
      term: "PICO",
      plain: "A structured framework used to formulate clinical research questions by defining Population, Intervention, Comparator, and Outcome.",
      example: "In adults with community-acquired pneumonia (Population), does amoxicillin (Intervention) compared with macrolides (Comparator) improve 30-day survival (Outcome)?"
    },
    {
      term: "PRISMA",
      plain: "An evidence-based minimum set of reporting items and a four-phase flow diagram designed to help authors transparently report systematic reviews and meta-analyses.",
      example: "Using the 27-item checklist and flow diagram to document how 2,400 screened abstracts yielded 14 included trials in a review of asthma treatments."
    },
    {
      term: "risk of bias",
      plain: "The likelihood that flaws in study design, conduct, or analysis have systematically distorted the reported treatment effect away from the truth.",
      example: "Downgrading an unblinded surgical trial because surgeons who know the assigned procedure may assess postoperative recovery differently."
    },
    {
      term: "GRADE",
      plain: "A systematic framework for rating the certainty of evidence across four levels from very low to high based on study design, bias risk, inconsistency, indirectness, and imprecision.",
      example: "Rating evidence on beta-blockers in heart failure as High certainty because multiple large, well-blinded randomized trials showed consistent mortality reduction."
    },
    {
      term: "risk ratio (RR)",
      plain: "The probability of an event occurring in the treated group divided by the probability of that event occurring in the control group.",
      example: "An RR of 0.60 in a vaccine trial indicates that vaccinated participants had 40 percent lower risk of contracting influenza than unvaccinated controls."
    },
    {
      term: "odds ratio (OR)",
      plain: "The odds of an outcome occurring in the exposed group divided by the odds of that outcome occurring in the unexposed group.",
      example: "In a case-control study, people with lung cancer had 9 times the odds of having smoked compared with people without lung cancer (OR 9.0)."
    },
    {
      term: "hazard ratio (HR)",
      plain: "A measure of the relative rate at which an event occurs over time in an intervention group compared with a control group in a survival analysis.",
      example: "An HR of 0.75 for mortality in a cancer trial means patients receiving immunotherapy died at 75 percent of the rate of those receiving standard chemotherapy at any given time point."
    },
    {
      term: "mean difference (MD)",
      plain: "The difference between the average values of a continuous outcome measured in two comparison groups using the same measurement scale.",
      example: "An MD of -5.2 mmHg indicates that mean systolic blood pressure fell by 5.2 mmHg more in the antihypertensive group than in the placebo group."
    },
    {
      term: "standardised mean difference (SMD)",
      plain: "A summary statistic that divides the difference in group means by the pooled standard deviation, allowing studies using different measurement scales for the same outcome to be combined.",
      example: "Pooling depression trials that measured severity using either the Hamilton scale or the Beck Depression Inventory into a single SMD of -0.40 standard deviations."
    },
    {
      term: "confidence interval (CI)",
      plain: "A range of plausible values around a sample estimate that would contain the true population parameter in a specified percentage of repeated identical experiments, commonly 95 percent.",
      example: "A risk ratio of 0.70 with a 95 percent CI from 0.55 to 0.89 indicates strong evidence of benefit because the entire interval excludes the neutral value of 1.0."
    },
    {
      term: "p value",
      plain: "The probability of obtaining a test statistic at least as extreme as the observed result assuming the null hypothesis of no true effect is correct.",
      example: "A p value of 0.02 means there is a 2 percent chance of observing this large a difference between drug and placebo if the drug had no real effect."
    },
    {
      term: "I2",
      plain: "The percentage of total variability across included study estimates that is due to real heterogeneity between studies rather than random sampling variation.",
      example: "An I2 of 15 percent indicates low heterogeneity among trial findings, whereas an I2 of 80 percent suggests substantial true variation in treatment effects."
    },
    {
      term: "heterogeneity",
      plain: "The clinical, methodological, or statistical diversity that causes true treatment effects to differ among studies included in a meta-analysis.",
      example: "Different trial dosages of steroid therapy producing widely varying infection outcomes across included hospital intensive care units."
    },
    {
      term: "fixed vs random effects",
      plain: "Fixed-effect models assume all studies share one identical true effect, whereas random-effects models assume true effects vary across study populations and follow a distribution.",
      example: "Choosing a random-effects model when trials included different antibiotic doses, patient age brackets, and underlying disease severities."
    },
    {
      term: "forest plot",
      plain: "A visual chart that displays effect estimates and confidence intervals for each individual study along horizontal lines, with a summary diamond representing the pooled meta-analytic result.",
      example: "Plotting twelve antiplatelet trials on a graph where horizontal lines show individual trial risk ratios and a bottom diamond shows the pooled benefit."
    },
    {
      term: "funnel plot",
      plain: "A scatter plot of study effect sizes against a measure of study precision, used to visually detect publication bias and small-study effects as asymmetry in an inverted funnel shape.",
      example: "Noticing that small negative trials are missing from the lower left corner of the plot, suggesting that small studies showing no drug benefit remained unpublished."
    },
    {
      term: "publication bias",
      plain: "The systematic distortion of the published medical literature caused by positive or statistically significant findings being published more readily than negative or neutral findings.",
      example: "Pharmaceutical company trials finding no benefit for an antidepressant remaining unsubmitted to journals, making published evidence look unrealistically favorable."
    },
    {
      term: "sensitivity analysis",
      plain: "A repeat analysis conducted to test whether the primary conclusions of a review remain robust when specific studies, methods, or assumptions are changed.",
      example: "Re-running the meta-analysis after excluding two low-quality trials with high risk of bias to confirm that the pooled drug benefit remains statistically significant."
    },
    {
      term: "individual participant data (IPD)",
      plain: "A meta-analysis approach that collects, checks, and re-analyzes raw, patient-level datasets from every included trial rather than extracting published summary statistics.",
      example: "Obtaining original patient records from five stroke trials to evaluate whether aspirin benefit depends on patient age and baseline blood pressure."
    },
    {
      term: "protocol",
      plain: "A predefined, formal document that details the planned research objectives, eligibility criteria, search strategies, and analytical methods before a systematic review begins.",
      example: "Locking and publishing a review protocol detailing exact database search strings before screening any titles to prevent post-hoc bias."
    },
    {
      term: "PROSPERO",
      plain: "An international prospective register for systematic reviews where researchers publicly record review protocols in advance to prevent duplication and post-hoc reporting bias.",
      example: "Registering a new systematic review on pediatric diabetes interventions on PROSPERO before screening search results to ensure transparent accountability."
    },
    {
      term: "CONSORT",
      plain: "An evidence-based set of recommendations and a 25-item checklist designed to improve the reporting transparency of parallel-group randomized controlled trials.",
      example: "Using the CONSORT flow diagram to report how 500 screened patients were randomized, received allocation, and accounted for at 12-month follow-up."
    },
    {
      term: "STROBE",
      plain: "A consensus reporting guideline comprising 22 checklist items designed to ensure transparent and complete reporting of observational epidemiological studies.",
      example: "Applying STROBE guidance to report participant recruitment, potential confounders, and loss to follow-up in a prospective cohort study of dietary salt intake."
    },
    {
      term: "CARE",
      plain: "A consensus reporting guideline that outlines a 13-item checklist for authors writing clinical case reports to ensure complete, accurate, and transparent documentation.",
      example: "Following the CARE checklist to report a rare adverse drug reaction to a novel monoclonal antibody, including patient timeline and diagnostic workup."
    },
    {
      term: "SPIRIT",
      plain: "An evidence-based guideline defining 33 core items that should be addressed in high-quality clinical trial protocols before trial conduct begins.",
      example: "Drafting an oncology phase III trial protocol following SPIRIT recommendations to clearly specify primary endpoints, blinding procedures, and interim analysis rules."
    },
    {
      term: "abstract",
      plain: "A brief, structured summary of a scientific paper that succinctly presents the background, methods, primary results, and key conclusions of the research.",
      example: "Reading a 300-word structured abstract in PubMed to quickly determine whether a clinical trial meets the inclusion criteria for a systematic review."
    },
    {
      term: "IMRaD",
      plain: "The standard organizational structure for biomedical research manuscripts, comprising Introduction, Methods, Results, and Discussion sections.",
      example: "Organizing an original research paper so that the rationale appears in the Introduction, study design in the Methods, findings in the Results, and implications in the Discussion."
    },
    {
      term: "DOI",
      plain: "A persistent, unique alphanumeric string assigned by an international agency to identify a specific digital document on the internet permanently.",
      example: "Clicking on 10.1056/NEJMoa2002032 to reliably navigate directly to the primary publication of a landmark coronavirus trial regardless of URL changes."
    }
  ];

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GLOSSARY;
  }
  if (G) {
    G.SMD_RESEARCH_GLOSSARY = GLOSSARY;
  }

})(typeof window !== "undefined" ? window : undefined);
