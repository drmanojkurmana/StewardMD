/* ResearchMD Phase 3.6 risk of bias (module L, ES module, server side).
 * Contract: docs/research/contracts/phase-3/rob.md (+ frozen schemas).
 * Routes hooked in [[path]].js (Firebase auth + project role on every call):
 *   GET  /v1/rob-tools
 *   GET  /v1/projects/{pid}/studies/{sid}/rob?tool=
 *   POST /v1/projects/{pid}/studies/{sid}/rob
 *   GET  /v1/projects/{pid}/rob-conflicts
 *   POST /v1/rob-conflicts/{cid}/resolve
 *   GET  /v1/projects/{pid}/studies/{sid}/rob/audit?tool=
 *
 * Blinding mirrors phase-2/blinding.md (B1-B7), enforced server-side: the peer
 * assessment is redacted ({hidden:true}, NO domains) until BOTH assessors have
 * a current submission; a viewer sees only outcome and consensus, never votes.
 * Re-submit before unblinding inserts a new immutable row (latest counts). Once
 * both submit, agreement -> agreed; any disagreement (or no_information/unclear)
 * opens ONE conflict per study+tool. Voting with an open conflict is 409.
 * Resolution is owner/editor only (a voter may resolve only when no non-voter
 * owner/editor exists, recorded in the note). Every domain judgment keeps a
 * supporting quote AND a locator (422 locator_required otherwise). T1
 * suggestions never submit for the assessor (B6).
 */
import { validateLocator } from "./_extraction.js";

const VOTE_ROLES = ["owner", "editor", "analyst", "reviewer"];
const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const RESOLVER_ROLES = ["owner", "editor"];

/* Four tools, real domains and signalling questions, source stated per tool
 * (rob.md). Signalling answers use each tool's own answer set. */
const YPN = ["Y", "PY", "PN", "N", "NI"];
const YNU = ["Y", "N", "Unclear"];
function sq(key, text) { return { key, text }; }
export const ROB_TOOLS = [
  { id: "rob2", name: "RoB 2", source: "Sterne JAC et al. RoB 2: a revised tool for assessing risk of bias in randomised trials. BMJ 2019;366:l4898.",
    scale: "low / some_concerns / high", overallRule: "worst_domain_rob2", answers: YPN,
    domains: [
      { key: "d1", label: "Bias arising from the randomization process", judgments: ["low", "some_concerns", "high"], signallingQuestions: [
        sq("1.1", "Was the allocation sequence random?"),
        sq("1.2", "Was the allocation sequence concealed until participants were enrolled and assigned?"),
        sq("1.3", "Did baseline differences between intervention groups suggest a problem with the randomization process?")] },
      { key: "d2", label: "Bias due to deviations from intended interventions", judgments: ["low", "some_concerns", "high"], signallingQuestions: [
        sq("2.1", "Were participants aware of their assigned intervention?"),
        sq("2.2", "Were carers and people delivering the intervention aware of the assigned intervention?"),
        sq("2.3", "If Y/PY/NI to 2.1 or 2.2: were there deviations from the intended intervention that arose because of the experimental context?"),
        sq("2.4", "If Y/PY/NI to 2.3: were these deviations likely to have impacted the outcome?"),
        sq("2.5", "If Y/PY/NI to 2.4: were these deviations balanced between groups?"),
        sq("2.6", "Was an appropriate analysis used to estimate the effect of assignment to intervention?"),
        sq("2.7", "If Y/PY/NI to 2.6: was there potential for a substantial impact on the result of the failure to analyse participants in the group to which they were randomized?")] },
      { key: "d3", label: "Bias due to missing outcome data", judgments: ["low", "some_concerns", "high"], signallingQuestions: [
        sq("3.1", "Were data for all, or nearly all, participants randomized available?"),
        sq("3.2", "If N/PN/NI to 3.1: is there evidence that the result was not biased by missing outcome data?"),
        sq("3.3", "If N/PN to 3.2: could missingness in the outcome depend on its true value?"),
        sq("3.4", "If Y/PY/NI to 3.3: is it likely that missingness in the outcome depended on its true value?")] },
      { key: "d4", label: "Bias in measurement of the outcome", judgments: ["low", "some_concerns", "high"], signallingQuestions: [
        sq("4.1", "Was the method of measuring the outcome inappropriate?"),
        sq("4.2", "Could measurement or ascertainment of the outcome have differed between intervention groups?"),
        sq("4.3", "If N/PN/NI to 4.1 and 4.2: were outcome assessors aware of the intervention received by study participants?"),
        sq("4.4", "If Y/PY/NI to 4.3: could assessment of the outcome have been influenced by knowledge of intervention received?"),
        sq("4.5", "If Y/PY/NI to 4.4: is it likely that assessment of the outcome was influenced by knowledge of intervention received?")] },
      { key: "d5", label: "Bias in selection of the reported result", judgments: ["low", "some_concerns", "high"], signallingQuestions: [
        sq("5.1", "Were the data that produced this result analysed in accordance with a pre-specified analysis plan finalized before unblinded outcome data were available?"),
        sq("5.2", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain?"),
        sq("5.3", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?")] },
    ] },
  { id: "robins_i", name: "ROBINS-I", source: "Sterne JAC et al. ROBINS-I: a tool for assessing risk of bias in non-randomised studies of interventions. BMJ 2016;355:i4919.",
    scale: "low / moderate / serious / critical / no_information", overallRule: "worst_domain", answers: YPN,
    domains: [
      { key: "d1", label: "Bias due to confounding", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("1.1", "Is there potential for confounding of the effect of intervention in this study?"),
        sq("1.2", "If Y/PY/NI to 1.1: was there adjustment for the most important confounding factors?"),
        sq("1.3", "If Y/PY/NI to 1.2: were the confounding factors measured validly and reliably?"),
        sq("1.4", "If Y/PY/NI to 1.3: was adjustment for time-varying confounding appropriate?")] },
      { key: "d2", label: "Bias in selection of participants into the study", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("2.1", "Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention?"),
        sq("2.2", "If Y/PY/NI to 2.1: were the analyses adjusted for the factors on which selection was based?"),
        sq("2.3", "Do start of follow-up and start of intervention coincide for most participants?"),
        sq("2.4", "If N/PN/NI to 2.3: were adjustment techniques used that are likely to correct for the presence of selection biases?")] },
      { key: "d3", label: "Bias in classification of interventions", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("3.1", "Were intervention groups well defined?"),
        sq("3.2", "Was information used to define intervention groups recorded at the start of the intervention?"),
        sq("3.3", "Could classification of intervention status have been affected by knowledge of the outcome or risk of the outcome?")] },
      { key: "d4", label: "Bias due to deviations from intended interventions", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("4.1", "Were there deviations from the intended intervention beyond what would be expected in usual practice?"),
        sq("4.2", "If Y/PY/NI to 4.1: were these deviations from intended intervention balanced between groups?"),
        sq("4.3", "If Y/PY/NI to 4.2: were these deviations likely to have affected the outcome?"),
        sq("4.4", "Was an appropriate analysis used to estimate the effect of adhering to intervention?")] },
      { key: "d5", label: "Bias due to missing data", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("5.1", "Were data for all, or nearly all, participants available?"),
        sq("5.2", "If N/PN/NI to 5.1: is there evidence that the result was not biased by missing data?"),
        sq("5.3", "If N/PN to 5.2: could missingness in the data depend on the true value of the outcome?"),
        sq("5.4", "If Y/PY/NI to 5.3: is it likely that missingness in the data depended on the true value of the outcome?")] },
      { key: "d6", label: "Bias in measurement of outcomes", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("6.1", "Could measurement or ascertainment of the outcome have differed between intervention groups?"),
        sq("6.2", "Could outcome assessors have been aware of the intervention received by participants?"),
        sq("6.3", "If Y/PY/NI to 6.2: could assessment of the outcome have been influenced by knowledge of intervention received?"),
        sq("6.4", "If Y/PY/NI to 6.3: is it likely that assessment of the outcome was influenced by knowledge of intervention received?")] },
      { key: "d7", label: "Bias in selection of the reported result", judgments: ["low", "moderate", "serious", "critical", "no_information"], signallingQuestions: [
        sq("7.1", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain?"),
        sq("7.2", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?")] },
    ] },
  { id: "quadas2", name: "QUADAS-2", source: "Whiting PF et al. QUADAS-2: a revised tool for the quality assessment of diagnostic accuracy studies. Ann Intern Med 2011;155:529-536.",
    scale: "low / high / unclear (domain level)", overallRule: "domain_level", answers: YNU,
    domains: [
      { key: "patient_selection", label: "Patient selection", judgments: ["low", "high", "unclear"], applicability: true, signallingQuestions: [
        sq("ps1", "Was a consecutive or random sample of patients enrolled?"),
        sq("ps2", "Was a case-control design avoided?"),
        sq("ps3", "Did the study avoid inappropriate exclusions?")] },
      { key: "index_test", label: "Index test", judgments: ["low", "high", "unclear"], applicability: true, signallingQuestions: [
        sq("it1", "Were the index test results interpreted without knowledge of the results of the reference standard?"),
        sq("it2", "If a threshold was used, was it pre-specified?")] },
      { key: "reference_standard", label: "Reference standard", judgments: ["low", "high", "unclear"], applicability: true, signallingQuestions: [
        sq("rs1", "Is the reference standard likely to correctly classify the target condition?"),
        sq("rs2", "Were the reference standard results interpreted without knowledge of the results of the index test?")] },
      { key: "flow_timing", label: "Flow and timing", judgments: ["low", "high", "unclear"], applicability: false, signallingQuestions: [
        sq("ft1", "Was there an appropriate interval between index test and reference standard?"),
        sq("ft2", "Did all patients receive the same reference standard?"),
        sq("ft3", "Were all patients included in the analysis?")] },
    ] },
  { id: "nos", name: "Newcastle-Ottawa Scale", source: "Wells GA et al. The Newcastle-Ottawa Scale (NOS) for assessing the quality of nonrandomised studies in meta-analyses. Ottawa Hospital Research Institute. Cohort form.",
    scale: "stars 0-9 (Good >= 7, Fair 5-6, Poor <= 4; project convention)", overallRule: "stars_threshold", answers: ["yes", "no"],
    domains: [
      { key: "sel1", label: "Selection: representativeness of the exposed cohort", judgments: ["yes", "no"], maxStars: 1 },
      { key: "sel2", label: "Selection: selection of the non-exposed cohort", judgments: ["yes", "no"], maxStars: 1 },
      { key: "sel3", label: "Selection: ascertainment of exposure", judgments: ["yes", "no"], maxStars: 1 },
      { key: "sel4", label: "Selection: demonstration that outcome of interest was not present at start", judgments: ["yes", "no"], maxStars: 1 },
      { key: "comp1", label: "Comparability: comparability of cohorts on the basis of design or analysis", judgments: ["yes", "no"], maxStars: 2 },
      { key: "out1", label: "Outcome: assessment of outcome", judgments: ["yes", "no"], maxStars: 1 },
      { key: "out2", label: "Outcome: was follow-up long enough for outcomes to occur", judgments: ["yes", "no"], maxStars: 1 },
      { key: "out3", label: "Outcome: adequacy of follow-up of cohorts", judgments: ["yes", "no"], maxStars: 1 },
    ] },
];
export function toolById(id) { for (const t of ROB_TOOLS) if (t.id === id) return t; return null; }

/* Overall judgment by the tool's overallRule. NOS uses the traffic-light
 * vocabulary (low=Good>=7, some_concerns=Fair 5-6, high=Poor<=4) and carries the
 * star total separately; the screen labels the threshold a project convention. */
export function overallFor(toolId, domains) {
  const j = domains.map((d) => d.judgment);
  if (toolId === "rob2") {
    if (j.indexOf("high") >= 0) return "high";
    const sc = j.filter((x) => x === "some_concerns").length;
    if (sc >= 2) return "high";
    if (sc === 1) return "some_concerns";
    return "low";
  }
  if (toolId === "robins_i") {
    for (const w of ["critical", "serious", "moderate", "low"]) if (j.indexOf(w) >= 0) return w;
    return "no_information";
  }
  if (toolId === "quadas2") {
    if (j.indexOf("high") >= 0) return "high";
    if (j.indexOf("unclear") >= 0) return "unclear";
    return "low";
  }
  const stars = domains.reduce((a, d) => a + (Number(d.stars) || 0), 0);
  return stars >= 7 ? "low" : stars >= 5 ? "some_concerns" : "high";
}
function starsFor(domains) { return domains.reduce((a, d) => a + (Number(d.stars) || 0), 0); }

async function latestVotes(db, projectId, studyId, tool) {
  return (await db.prepare(
    "SELECT * FROM (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.assessor_uid ORDER BY a.created_ts DESC, a.rowid DESC) AS rn FROM research_rob_assessments a WHERE a.project_id=? AND a.study_id=? AND a.tool=?) WHERE rn=1")
    .bind(projectId, studyId, tool).all()).results || [];
}
async function conflictFor(db, projectId, studyId, tool) {
  return db.prepare("SELECT * FROM research_rob_conflicts WHERE project_id=? AND study_id=? AND tool=?")
    .bind(projectId, studyId, tool).first();
}
function assessorOf(vote, toolId) {
  if (!vote) return { submitted: false, domains: [] };
  const domains = JSON.parse(vote.domains_json || "[]");
  const out = { submitted: true, domains, overall: vote.overall || overallFor(toolId, domains) };
  if (toolId === "nos") out.stars = vote.stars != null ? vote.stars : starsFor(domains);
  return out;
}
function domainsAgree(toolId, a, b) {
  const byKey = {};
  for (const d of b) byKey[d.key] = d;
  for (const d of a) {
    const o = byKey[d.key];
    if (!o || o.judgment !== d.judgment) return false;
    if (toolId === "nos" && (Number(o.stars) || 0) !== (Number(d.stars) || 0)) return false;
    if (d.judgment === "no_information" || d.judgment === "unclear") return false;
  }
  return true;
}
async function assessmentOf(db, projectId, studyId, tool, uid, role) {
  const votes = await latestVotes(db, projectId, studyId, tool);
  const conflict = await conflictFor(db, projectId, studyId, tool);
  const selfVote = votes.find((v) => v.assessor_uid === uid) || null;
  const peerVote = votes.find((v) => v.assessor_uid !== uid) || null;
  const both = votes.length >= 2;
  let outcome = "pending";
  if (conflict) outcome = conflict.status === "open" ? "conflict" : "agreed";
  else if (both) {
    const a = JSON.parse(votes[0].domains_json || "[]"), b = JSON.parse(votes[1].domains_json || "[]");
    outcome = domainsAgree(tool, a, b) ? "agreed" : "conflict";
  }
  const a = { studyId, tool, outcome, conflictId: conflict ? conflict.id : null };
  if (role === "viewer") {
    /* B1: a viewer sees only outcome and consensus, never votes. */
    a.self = { submitted: false, domains: [] };
    a.peer = { hidden: true };
  } else {
    a.self = assessorOf(selfVote, tool);
    a.peer = both ? assessorOf(peerVote, tool) : { hidden: true };
  }
  if (conflict && conflict.status === "resolved" && conflict.consensus_json) {
    const domains = JSON.parse(conflict.consensus_json);
    a.consensus = { submitted: true, domains, overall: overallFor(tool, domains) };
    if (tool === "nos") a.consensus.stars = starsFor(domains);
  }
  return a;
}

/* ---- GET /v1/rob-tools ----------------------------------------------------- */
export async function robTools(ctx) {
  return ctx.api.json({ tools: ROB_TOOLS }, 200, { "x-request-id": ctx.requestId });
}

/* ---- GET assessment -------------------------------------------------------- */
export async function getRob(ctx, projectId, studyId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const tool = url.searchParams.get("tool") || "rob2";
  if (!toolById(tool)) return err(422, "invalid_judgment", "Unknown risk-of-bias tool", requestId);
  const study = await db.prepare("SELECT id FROM research_studies WHERE id=? AND project_id=?").bind(studyId, projectId).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  const assessment = await assessmentOf(db, projectId, studyId, tool, uid, gate.role);
  await api.audit(db, projectId, uid, "rob_viewed", studyId, { tool });
  return json({ assessment }, 200, { "x-request-id": requestId });
}

/* ---- POST submit ----------------------------------------------------------- */
export async function submitRob(ctx, projectId, studyId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, VOTE_ROLES);
  if (gate.status) return gateErr(gate, "Risk-of-bias assessment needs a voting role", requestId);
  const tool = toolById(body.tool);
  if (!tool) return err(422, "invalid_judgment", "Unknown risk-of-bias tool", requestId);
  const study = await db.prepare("SELECT id FROM research_studies WHERE id=? AND project_id=?").bind(studyId, projectId).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  if (!Array.isArray(body.domains) || !body.domains.length)
    return err(400, "invalid_body", "domains must be a non-empty array", requestId);
  const domByKey = {};
  for (const d of tool.domains) domByKey[d.key] = d;
  const domains = [];
  for (const d of body.domains) {
    const def = domByKey[d.key];
    if (!def) return err(422, "invalid_judgment", "Unknown domain: " + d.key, requestId);
    if (typeof d.quote !== "string" || !d.quote.trim() || d.quote.length > 2000)
      return err(422, "locator_required", "Each domain needs a supporting quote", requestId);
    const badLoc = validateLocator(d.locator);
    if (badLoc) return err(422, "locator_required", badLoc, requestId);
    if (def.judgments.indexOf(d.judgment) < 0)
      return err(422, "invalid_judgment", "Judgment " + d.judgment + " is not in the tool's domain set", requestId);
    const item = { key: d.key, judgment: d.judgment, quote: d.quote, locator: d.locator };
    if (d.signallingAnswers !== undefined) {
      if (!d.signallingAnswers || typeof d.signallingAnswers !== "object" || Array.isArray(d.signallingAnswers))
        return err(400, "invalid_body", "signallingAnswers must be an object", requestId);
      for (const k of Object.keys(d.signallingAnswers))
        if (tool.answers.indexOf(d.signallingAnswers[k]) < 0)
          return err(422, "invalid_judgment", "Signalling answer " + d.signallingAnswers[k] + " is not in the tool's answer set", requestId);
      item.signallingAnswers = d.signallingAnswers;
    }
    if (def.applicability) {
      const app = d.applicability === undefined ? "low" : d.applicability;
      if (["low", "high", "unclear"].indexOf(app) < 0)
        return err(422, "invalid_judgment", "applicability must be low, high or unclear", requestId);
      item.applicability = app;
    }
    if (tool.id === "nos") {
      const stars = d.stars === undefined ? (d.judgment === "yes" ? 1 : 0) : d.stars;
      if (!Number.isInteger(stars) || stars < 0 || stars > def.maxStars)
        return err(422, "invalid_judgment", "stars must be 0-" + def.maxStars + " for " + d.key, requestId);
      item.stars = stars;
    }
    domains.push(item);
  }
  const conflict = await conflictFor(db, projectId, studyId, tool.id);
  if (conflict && conflict.status === "open")
    return err(409, "conflict_open", "This study has an open conflict; resolve it first", requestId);
  if (conflict && conflict.status === "resolved")
    return err(409, "conflict_open", "Votes are frozen after consensus; the consensus stands", requestId);
  const votes = await latestVotes(db, projectId, studyId, tool.id);
  const mine = votes.find((v) => v.assessor_uid === uid);
  if (votes.length >= 2) {
    if (mine) return err(409, "conflict_open", "Votes are frozen once both assessors have submitted; a conflict is required to change them", requestId);
    return err(400, "invalid_body", "This study already has two assessors", requestId);
  }
  const overall = overallFor(tool.id, domains);
  const stars = tool.id === "nos" ? starsFor(domains) : null;
  const now = Date.now();
  const id = "rob_" + crypto.randomUUID().replace(/-/g, "");
  await db.prepare("INSERT INTO research_rob_assessments (id,project_id,study_id,tool,assessor_uid,domains_json,overall,stars,created_ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, studyId, tool.id, uid, JSON.stringify(domains), overall, stars, now).run();
  await audit(db, projectId, uid, "rob_submitted", studyId, { tool: tool.id, overall });
  const after = await latestVotes(db, projectId, studyId, tool.id);
  let outcome = "pending", conflictId = null;
  if (after.length >= 2) {
    if (votes.length < 2) await audit(db, projectId, uid, "rob_unblinded", studyId, { tool: tool.id });
    const a = JSON.parse(after[0].domains_json || "[]"), b = JSON.parse(after[1].domains_json || "[]");
    if (!domainsAgree(tool.id, a, b)) {
      await db.prepare("INSERT INTO research_rob_conflicts (id,project_id,study_id,tool,status,created_ts) VALUES (?,?,?,?,'open',?) ON CONFLICT(project_id,study_id,tool) DO NOTHING")
        .bind("rcf_" + crypto.randomUUID().replace(/-/g, ""), projectId, studyId, tool.id, now).run();
      const opened = await conflictFor(db, projectId, studyId, tool.id);
      await audit(db, projectId, uid, "rob_conflict_opened", studyId, { tool: tool.id, conflictId: opened.id });
      outcome = "conflict"; conflictId = opened.id;
    } else outcome = "agreed";
  }
  const assessment = await assessmentOf(db, projectId, studyId, tool.id, uid, gate.role);
  const out = { assessment, outcome };
  if (conflictId) out.conflictId = conflictId;
  return json(out, 200, { "x-request-id": requestId });
}

/* ---- GET conflicts --------------------------------------------------------- */
function conflictOf(row) {
  const out = { id: row.id, projectId: row.project_id, studyId: row.study_id, tool: row.tool,
    status: row.status, createdTs: row.created_ts };
  if (row.status === "resolved") {
    out.resolvedBy = row.resolved_by || ""; out.resolvedTs = row.resolved_ts; out.note = row.note || "";
  }
  return out;
}
export async function listRobConflicts(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare(
    "SELECT * FROM research_rob_conflicts WHERE project_id=? ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_ts DESC, id DESC")
    .bind(projectId).all()).results || [];
  return json({ conflicts: rows.map(conflictOf) }, 200, { "x-request-id": requestId });
}

/* ---- POST resolve ---------------------------------------------------------- */
export async function resolveRobConflict(ctx, conflictId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, member } = api;
  const conflict = await db.prepare("SELECT * FROM research_rob_conflicts WHERE id=?").bind(conflictId).first();
  if (!conflict) return err(404, "rob_conflict_not_found", "Conflict not found", requestId);
  const me = await member(db, conflict.project_id, uid, RESOLVER_ROLES);
  if (!me) {
    const any = await member(db, conflict.project_id, uid);
    return any ? err(403, "resolver_only", "Consensus needs an owner or editor", requestId)
      : err(404, "rob_conflict_not_found", "Conflict not found", requestId);
  }
  if (conflict.status !== "open")
    return err(409, "already_decided", "Conflict already resolved", requestId);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return err(400, "invalid_correction", "A consensus note is required", requestId);
  if (note.length > 1000) return err(400, "invalid_correction", "note must be at most 1000 characters", requestId);
  const tool = toolById(conflict.tool);
  if (!Array.isArray(body.domains) || !body.domains.length)
    return err(400, "invalid_body", "domains must be a non-empty array", requestId);
  const domByKey = {};
  for (const d of tool.domains) domByKey[d.key] = d;
  const domains = [];
  for (const d of body.domains) {
    const def = domByKey[d.key];
    if (!def) return err(422, "invalid_judgment", "Unknown domain: " + d.key, requestId);
    if (typeof d.quote !== "string" || !d.quote.trim())
      return err(422, "locator_required", "Each consensus domain needs a supporting quote", requestId);
    const badLoc = validateLocator(d.locator);
    if (badLoc) return err(422, "locator_required", badLoc, requestId);
    if (def.judgments.indexOf(d.judgment) < 0)
      return err(422, "invalid_judgment", "Judgment " + d.judgment + " is not in the tool's domain set", requestId);
    const item = { key: d.key, judgment: d.judgment, quote: d.quote, locator: d.locator };
    if (def.applicability) item.applicability = ["low", "high", "unclear"].indexOf(d.applicability) >= 0 ? d.applicability : "low";
    if (tool.id === "nos") {
      const stars = d.stars === undefined ? (d.judgment === "yes" ? 1 : 0) : d.stars;
      if (!Number.isInteger(stars) || stars < 0 || stars > def.maxStars)
        return err(422, "invalid_judgment", "stars must be 0-" + def.maxStars, requestId);
      item.stars = stars;
    }
    domains.push(item);
  }
  /* B4: a voter may resolve only when no non-voter owner/editor exists. */
  const voters = (await latestVotes(db, conflict.project_id, conflict.study_id, conflict.tool)).map((v) => v.assessor_uid);
  let finalNote = note;
  if (voters.indexOf(uid) >= 0) {
    const placeholders = voters.map(() => "?").join(",");
    const others = (await db.prepare("SELECT uid FROM research_members WHERE project_id=? AND role IN ('owner','editor') AND uid NOT IN (" + placeholders + ")")
      .bind(conflict.project_id, ...voters).all()).results || [];
    if (others.length)
      return err(403, "resolver_only", "A non-voter owner or editor must resolve this conflict", requestId);
    finalNote = note + " [resolved by a voter: no non-voter owner/editor available]";
  }
  const now = Date.now();
  await db.prepare("UPDATE research_rob_conflicts SET status='resolved',consensus_json=?,note=?,resolved_by=?,resolved_ts=? WHERE id=? AND status='open'")
    .bind(JSON.stringify(domains), finalNote, uid, now, conflictId).run();
  await audit(db, conflict.project_id, uid, "rob_resolved", conflict.study_id,
    { tool: conflict.tool, conflictId, overall: overallFor(tool.id, domains), resolverWasVoter: voters.indexOf(uid) >= 0 });
  const fresh = await db.prepare("SELECT * FROM research_rob_conflicts WHERE id=?").bind(conflictId).first();
  const assessment = await assessmentOf(db, conflict.project_id, conflict.study_id, conflict.tool, uid, me.role);
  return json({ conflict: conflictOf(fresh), assessment }, 200, { "x-request-id": requestId });
}

/* ---- GET audit ------------------------------------------------------------- */
const ROB_AUDIT_KINDS = { rob_submitted: "submitted", rob_unblinded: "unblinded", rob_conflict_opened: "conflict_opened", rob_resolved: "resolved" };
export async function robAudit(ctx, projectId, studyId, url) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const tool = url.searchParams.get("tool") || "rob2";
  const rows = (await db.prepare(
    "SELECT * FROM research_audit_events WHERE project_id=? AND resource_id=? AND event_type IN ('rob_submitted','rob_unblinded','rob_conflict_opened','rob_resolved') ORDER BY created_ts DESC, rowid DESC")
    .bind(projectId, studyId).all()).results || [];
  const events = [];
  for (const r of rows) {
    const meta = JSON.parse(r.metadata_json || "{}");
    if (meta.tool !== tool) continue;
    events.push({ kind: ROB_AUDIT_KINDS[r.event_type], by: r.actor_uid, ts: r.created_ts, tool: meta.tool });
  }
  return json({ events }, 200, { "x-request-id": requestId });
}
