/* functions/_pglog_templates.js — NMC Logbook · the SCORING CONTRACT of each assessment template.
 *
 * WHY THIS FILE EXISTS: pglog/assessment-templates.json holds the full templates (labels, hints,
 * anchor wording, NMC source citations) for the UI, but a Cloudflare Pages Function cannot read a
 * file off disk. The server still has to score an assessment ITSELF — if it accepted the client's
 * template object, a forged one could inflate maxTotal or drop a criterion, and the resulting mark
 * would be a false record (PGMER-2023 9.2(c) puts a penalty on exactly that).
 *
 * So the scoring-relevant shape lives here, server-side. test/pglog-server.test.mjs asserts it
 * matches the JSON exactly, so the two cannot drift: edit the JSON, run the test, and it tells you.
 *
 * GENERATED — do not hand-edit. Regenerate with:
 *   node scripts/build-pglog-templates.mjs
 */
export const TEMPLATES = {
  dops: { id: "dops", scaleMin: 0, scaleMax: 5, logbookMax: 10, requireDiscussed: false, noTotal: false, appliesTo: "procedure", source: "nmc_curriculum",
            criteria: [{ key: "technical_skill" }, { key: "indications" }, { key: "consent" }, { key: "preparation" }, { key: "situational_awareness" }, { key: "complications" }, { key: "post_procedure" }, { key: "discharge_advice" }] },
  wpba_shift: { id: "wpba_shift", scaleMin: 0, scaleMax: 5, logbookMax: 15, requireDiscussed: false, noTotal: false, appliesTo: "period", source: "nmc_curriculum",
            criteria: [{ key: "medical_expertise" }, { key: "prioritisation" }, { key: "communication" }, { key: "leadership" }, { key: "scholarship" }, { key: "health_advocacy" }, { key: "professionalism" }] },
  wpba_clinical: { id: "wpba_clinical", scaleMin: 0, scaleMax: 5, logbookMax: 5, requireDiscussed: false, noTotal: false, appliesTo: "clinical", source: "nmc_curriculum",
            criteria: [{ key: "history" }, { key: "examination" }, { key: "synthesis" }, { key: "shared_decision" }, { key: "communication" }, { key: "professionalism" }, { key: "organisation" }] },
  appraisal: { id: "appraisal", scaleMin: 1, scaleMax: 9, logbookMax: 0, requireDiscussed: true, noTotal: true, appliesTo: "period", source: "nmc_curriculum",
            criteria: [{ key: "s_knowledge" }, { key: "s_participation" }, { key: "s_research" }, { key: "s_competence_doc" }, { key: "s_wba" }, { key: "s_sdl" }, { key: "p_care" }, { key: "p_team" }, { key: "p_communication" }, { key: "p_procedures" }, { key: "p_documentation" }, { key: "p_quality" }, { key: "pr_responsibility" }, { key: "pr_team_growth" }, { key: "pr_ethics" }] },
  academic_activity: { id: "academic_activity", scaleMin: 0, scaleMax: 5, logbookMax: 0, requireDiscussed: true, noTotal: false, appliesTo: "academic", source: "institution",
            criteria: [{ key: "content" }, { key: "appraisal" }, { key: "delivery" }, { key: "discussion" }, { key: "preparation" }] },
  thesis_review: { id: "thesis_review", scaleMin: 0, scaleMax: 5, logbookMax: 0, requireDiscussed: true, noTotal: false, appliesTo: "research", source: "institution",
            criteria: [{ key: "progress" }, { key: "methodology" }, { key: "ethics" }, { key: "analysis" }, { key: "writing" }] }
};
export function templateFor(id) { return TEMPLATES[String(id || "")] || null; }
export function templateIds() { return Object.keys(TEMPLATES); }
