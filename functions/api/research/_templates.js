/* ResearchMD Phase 5D.1 study design templates (ES module, server side).
 * Contract: docs/research/contracts/phase-6/templates.md. Read-only reference
 * data (the _extraction.js TEMPLATES pattern); Firebase claims required, no
 * project role. Analysis defaults name the Python worker stats_model families
 * exactly as backend/research/stats/job.py accepts them. Templates never
 * auto-fill a protocol or run an analysis; a human signs off (plan rule 9).
 */

export const STUDY_TEMPLATES = [
  {
    id: "rct",
    name: "Randomised controlled trial",
    design: "rct",
    reportingChecklistId: "consort",
    protocolChecklistId: "spirit",
    guidance: "Parallel, cluster or crossover randomised trial. Register the protocol before enrolment; pre-specify the primary outcome, the analysis population (intention-to-treat) and the handling of missing data. CONSORT for the report, SPIRIT for the protocol.",
    protocolFields: [
      { key: "title", label: "Scientific title", type: "string", required: true },
      { key: "registration", label: "Trial registration id and registry", type: "string", required: true },
      { key: "population", label: "Eligibility criteria (population)", type: "string", required: true },
      { key: "interventions", label: "Interventions and comparator, with dose/timing", type: "string", required: true },
      { key: "outcomes", label: "Primary and secondary outcomes with time points", type: "string", required: true },
      { key: "sampleSize", label: "Sample size calculation and assumptions", type: "string", required: true },
      { key: "randomisation", label: "Sequence generation, allocation concealment, blinding", type: "string", required: true },
      { key: "analysisPlan", label: "Analysis populations and missing-data handling", type: "string", required: true },
      { key: "ethics", label: "Ethics approval and consent basis", type: "string", required: true },
    ],
    extractionForm: { fields: [
      { key: "study_id", label: "Study id", type: "string", required: true },
      { key: "n_randomised", label: "Participants randomised", type: "integer", required: true },
      { key: "n_intervention", label: "Intervention arm n", type: "integer", required: true },
      { key: "n_control", label: "Control arm n", type: "integer", required: true },
      { key: "events_intervention", label: "Events, intervention arm", type: "integer", required: false },
      { key: "events_control", label: "Events, control arm", type: "integer", required: false },
      { key: "mean_intervention", label: "Mean, intervention arm", type: "number", required: false },
      { key: "sd_intervention", label: "SD, intervention arm", type: "number", required: false },
      { key: "mean_control", label: "Mean, control arm", type: "number", required: false },
      { key: "sd_control", label: "SD, control arm", type: "number", required: false },
      { key: "follow_up", label: "Follow-up duration", type: "string", required: false },
      { key: "attrition", label: "Loss to follow-up per arm", type: "string", required: false },
    ] },
    analysisDefaults: {
      jobKind: "stats_model", engine: "python-stats", family: "linear",
      spec: { family: "linear", formula: "outcome ~ arm", robust: "HC3" },
      alternatives: [{ family: "logistic", spec: { family: "logistic", formula: "event ~ arm" } }],
      notes: "Binary outcomes may use the Phase 1 JS engine (OR/RR/RD) for meta-analysis; participant-level modelling uses the Python worker.",
    },
  },
  {
    id: "cohort",
    name: "Cohort study",
    design: "cohort",
    reportingChecklistId: "strobe",
    protocolChecklistId: null,
    guidance: "Prospective or retrospective cohort with exposed/unexposed or exposure-level groups. Pre-specify confounders, follow-up and censoring rules. STROBE for the report; time-to-event outcomes use survival models.",
    protocolFields: [
      { key: "title", label: "Scientific title", type: "string", required: true },
      { key: "setting", label: "Setting, locations and dates", type: "string", required: true },
      { key: "population", label: "Eligibility and source population", type: "string", required: true },
      { key: "exposure", label: "Exposure definition and measurement", type: "string", required: true },
      { key: "outcomes", label: "Outcomes, follow-up and censoring", type: "string", required: true },
      { key: "confounders", label: "Confounders and adjustment plan", type: "string", required: true },
      { key: "sampleSize", label: "Sample size / power rationale", type: "string", required: false },
      { key: "analysisPlan", label: "Model choice and missing-data handling", type: "string", required: true },
      { key: "ethics", label: "Ethics approval and consent basis", type: "string", required: true },
    ],
    extractionForm: { fields: [
      { key: "study_id", label: "Study id", type: "string", required: true },
      { key: "n", label: "Cohort size", type: "integer", required: true },
      { key: "exposed_n", label: "Exposed n", type: "integer", required: false },
      { key: "unexposed_n", label: "Unexposed n", type: "integer", required: false },
      { key: "events", label: "Outcome events", type: "integer", required: false },
      { key: "person_time", label: "Person-time at risk", type: "number", required: false },
      { key: "follow_up", label: "Median follow-up", type: "string", required: false },
      { key: "adjusted_effect", label: "Adjusted effect (HR/RR/OR) with CI", type: "string", required: false },
      { key: "covariates", label: "Adjustment covariates", type: "string", required: false },
    ] },
    analysisDefaults: {
      jobKind: "stats_model", engine: "python-stats", family: "cox",
      spec: { family: "cox", time: "follow_up_time", event: "event", covariates: ["exposure"] },
      alternatives: [
        { family: "km", spec: { family: "km", time: "follow_up_time", event: "event" } },
        { family: "logrank", spec: { family: "logrank", time: "follow_up_time", event: "event", group: "exposure" } },
      ],
      notes: "Column names in the spec are placeholders; map them to the frozen dataset dictionary before running.",
    },
  },
  {
    id: "observational",
    name: "Observational study (cross-sectional / case-control)",
    design: "observational",
    reportingChecklistId: "strobe",
    protocolChecklistId: null,
    guidance: "Cross-sectional prevalence or association study, or case-control design. Pre-specify the sampling frame, case definition and matching. STROBE for the report; logistic regression is the usual participant-level model.",
    protocolFields: [
      { key: "title", label: "Scientific title", type: "string", required: true },
      { key: "design", label: "Cross-sectional or case-control, with rationale", type: "string", required: true },
      { key: "setting", label: "Setting, locations and dates", type: "string", required: true },
      { key: "population", label: "Eligibility, sampling frame and recruitment", type: "string", required: true },
      { key: "variables", label: "Outcome, exposure and covariate definitions", type: "string", required: true },
      { key: "bias", label: "Bias sources and mitigation (selection, information)", type: "string", required: false },
      { key: "sampleSize", label: "Sample size rationale", type: "string", required: false },
      { key: "analysisPlan", label: "Model choice, matching and missing data", type: "string", required: true },
      { key: "ethics", label: "Ethics approval and consent basis", type: "string", required: true },
    ],
    extractionForm: { fields: [
      { key: "study_id", label: "Study id", type: "string", required: true },
      { key: "n", label: "Sample size", type: "integer", required: true },
      { key: "cases", label: "Cases / outcome-positive n", type: "integer", required: false },
      { key: "controls", label: "Controls / outcome-negative n", type: "integer", required: false },
      { key: "exposed_cases", label: "Exposed cases", type: "integer", required: false },
      { key: "exposed_controls", label: "Exposed controls", type: "integer", required: false },
      { key: "prevalence", label: "Prevalence with CI", type: "string", required: false },
      { key: "adjusted_effect", label: "Adjusted OR with CI", type: "string", required: false },
      { key: "covariates", label: "Adjustment covariates", type: "string", required: false },
    ] },
    analysisDefaults: {
      jobKind: "stats_model", engine: "python-stats", family: "logistic",
      spec: { family: "logistic", formula: "outcome ~ exposure" },
      alternatives: [{ family: "linear", spec: { family: "linear", formula: "outcome ~ exposure" } }],
      notes: "Aggregate 2x2 data can use the Phase 1 JS engine (OR) for meta-analysis.",
    },
  },
  {
    id: "diagnostic_accuracy",
    name: "Diagnostic accuracy study",
    design: "diagnostic_accuracy",
    reportingChecklistId: "stard",
    protocolChecklistId: null,
    guidance: "Index test against a reference standard in a consecutive or random sample. Pre-specify the threshold, the reference standard and handling of indeterminate results. STARD for the report; the bivariate (REITSMA) model pools sensitivity/specificity across studies.",
    protocolFields: [
      { key: "title", label: "Scientific title", type: "string", required: true },
      { key: "population", label: "Participants, setting and recruitment", type: "string", required: true },
      { key: "indexTest", label: "Index test, threshold and execution", type: "string", required: true },
      { key: "referenceStandard", label: "Reference standard and rationale", type: "string", required: true },
      { key: "blinding", label: "Blinding of test interpretation", type: "string", required: false },
      { key: "analysisPlan", label: "2x2 construction, indeterminate results, subgroup plans", type: "string", required: true },
      { key: "ethics", label: "Ethics approval and consent basis", type: "string", required: true },
    ],
    extractionForm: { fields: [
      { key: "study_id", label: "Study id", type: "string", required: true },
      { key: "tp", label: "True positives", type: "integer", required: true },
      { key: "fn", label: "False negatives", type: "integer", required: true },
      { key: "fp", label: "False positives", type: "integer", required: true },
      { key: "tn", label: "True negatives", type: "integer", required: true },
      { key: "threshold", label: "Positivity threshold", type: "string", required: false },
      { key: "indeterminate", label: "Indeterminate / uninterpretable results", type: "integer", required: false },
    ] },
    analysisDefaults: {
      jobKind: "stats_model", engine: "python-stats", family: "diagnostic",
      spec: { family: "diagnostic", columns: { TP: "tp", FN: "fn", FP: "fp", TN: "tn" } },
      alternatives: [{ family: "diagnostic", spec: { family: "diagnostic", model: "per-study", columns: { TP: "tp", FN: "fn", FP: "fp", TN: "tn" } } }],
      notes: "REITSMA bivariate model is canonical for pooled accuracy (Phase 5D.3, R parity in CI).",
    },
  },
  {
    id: "prognostic",
    name: "Prognostic model study",
    design: "prognostic",
    reportingChecklistId: "tripod",
    protocolChecklistId: null,
    guidance: "Development, validation or update of a prediction model for individual outcomes. Pre-specify candidate predictors, sample size, handling of missing data and the validation strategy. TRIPOD for the report; report discrimination and calibration, not only coefficients.",
    protocolFields: [
      { key: "title", label: "Scientific title (development/validation/update)", type: "string", required: true },
      { key: "population", label: "Source population, setting and dates", type: "string", required: true },
      { key: "outcome", label: "Outcome definition and time horizon", type: "string", required: true },
      { key: "predictors", label: "Candidate predictors and measurement", type: "string", required: true },
      { key: "sampleSize", label: "Sample size and events-per-variable rationale", type: "string", required: true },
      { key: "missingData", label: "Missing-data handling", type: "string", required: true },
      { key: "validation", label: "Internal/external validation strategy", type: "string", required: true },
      { key: "analysisPlan", label: "Model family, shrinkage and performance measures", type: "string", required: true },
      { key: "ethics", label: "Ethics approval and consent basis", type: "string", required: true },
    ],
    extractionForm: { fields: [
      { key: "study_id", label: "Study id", type: "string", required: true },
      { key: "n", label: "Participants", type: "integer", required: true },
      { key: "events", label: "Outcome events", type: "integer", required: true },
      { key: "predictors", label: "Predictors in the final model", type: "string", required: true },
      { key: "c_statistic", label: "C-statistic / AUC with CI", type: "string", required: false },
      { key: "calibration", label: "Calibration slope / intercept", type: "string", required: false },
      { key: "validation", label: "Validation type and sample", type: "string", required: false },
    ] },
    analysisDefaults: {
      jobKind: "stats_model", engine: "python-stats", family: "cox",
      spec: { family: "cox", time: "follow_up_time", event: "event", covariates: ["predictor_1"] },
      alternatives: [
        { family: "logistic", spec: { family: "logistic", formula: "outcome ~ predictor_1" } },
        { family: "linear", spec: { family: "linear", formula: "outcome ~ predictor_1" } },
      ],
      notes: "Time-to-event prognosis uses Cox; fixed-horizon binary outcomes use logistic. Calibration and validation are the researcher's responsibility.",
    },
  },
];

export function templateById(id) {
  return STUDY_TEMPLATES.find((t) => t.id === id) || null;
}
function summaryOf(t) {
  return { id: t.id, name: t.name, design: t.design, reportingChecklistId: t.reportingChecklistId };
}

/* GET /v1/study-templates */
export async function listTemplates(ctx) {
  const { requestId, api } = ctx;
  return api.json({ templates: STUDY_TEMPLATES.map(summaryOf) }, 200, { "x-request-id": requestId });
}
/* GET /v1/study-templates/{id} */
export async function getTemplate(ctx, id) {
  const { requestId, api } = ctx;
  const t = templateById(id);
  if (!t) return api.err(404, "template_not_found", "Template not found", requestId);
  return api.json({ template: t }, 200, { "x-request-id": requestId });
}
