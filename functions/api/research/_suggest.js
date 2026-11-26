/* ResearchMD Phase 3.5 T1 suggestions (ES module, server side).
 * Plan section 6 / 8: extraction and screening suggestions through the central
 * gateway, stored UNVERIFIED, never auto-applied. Routes hooked in [[path]].js:
 *   POST /v1/projects/{pid}/studies/{sid}/extraction/suggestions
 *   POST /v1/projects/{pid}/records/{rid}/screening-suggestions
 *   GET  /v1/projects/{pid}/records/{rid}/screening-suggestions
 *
 * Gateway reuse: the worker-facing llmRoute (_gateway.js) authenticates with a
 * per-job HMAC token bound to a research_job_runs row, which a user-facing
 * suggestion request does not have. This module therefore runs the SAME ordered
 * pipeline reusing the gateway's exported framing (RESEARCH_FRAMING) and tier
 * routing (tierModel) plus the identical _phi / _caps / _credits primitives and
 * the same callGemini facade: PHI gate FIRST on the exact assembled text, then
 * caps, then credits reserve, then one provider call, then usage logging and
 * settle. No new provider client; no PHI reaches a provider; suggestions are
 * labelled and a human must Accept (extraction) or submit their own vote
 * (screening, B6). Nothing here writes a field value or a screening decision.
 */
import { callGemini } from "../ai/[[path]].js";
import { RESEARCH_FRAMING, tierModel } from "./_gateway.js";
import { scan, phiCategories } from "./_phi.js";
import { TIER_CEILINGS, estimateTokens, checkAiCaps, HARD_STOP_MESSAGES } from "./_caps.js";
import { quoteAiCall, aiActualMicroUsd, availableCredits, reserveCredits,
  settleCredits, releaseCredits, microUsdToInr, usdInrRate } from "./_credits.js";
import { TEMPLATES, templateById, extractionOf, rowFor } from "./_extraction.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const VOTE_ROLES = ["owner", "editor", "analyst", "reviewer"];
const DOC_CHAR_BUDGET = 28000; /* keeps the assembled T1 prompt under 8000 tokens */
export const PHI_OVERRIDE_TERMS_VERSION = "rmd-phi-override-v0";

/* The ordered gateway pipeline for one user-facing T1 call. Returns either
 * {error: Response} or {text, model, usage, costInr}. refId traces the
 * ledger/usage rows (there is no worker job; the suggestion request id is
 * the pointer). opts.temperature defaults to 0.2 (extraction and screening).
 * opts.maxOutputTokens caps the T1 output ceiling. opts.insufficientMessage
 * replaces the 402 text. The cheapest routed model is T1 (tierModel). */
export async function runUserAi(ctx, projectId, purpose, system, prompt, refId, opts = {}) {
  const { env, db, uid, claims, requestId, api } = ctx;
  const { json, err, audit, uuid } = api;
  const email = claims && claims.email;
  /* 1. PHI gate: skip entirely when the caller certifies that the input is
   * ONLY published literature (fetched from PubMed/Europe PMC/Crossref, never
   * user-typed text). Caps, credits, usage log and audit stay. */
  const finalSystem = RESEARCH_FRAMING + (system ? "\n\n" + system : "");
  const assembled = finalSystem + "\n\n" + prompt;
  if (opts.publicLiterature === true) {
    await audit(db, projectId, uid, "phi_gate_skipped_public_literature", refId, { purpose });
  } else if (opts.thesisCleared === true && purpose === "ai_draft_thesis_to_paper") {
    /* Thesis PHI masking and soft-hit consent already ran in thesisTask (_ai_draft.js). */
  } else {
    const report = scan(assembled, opts.phiMode === "user" ? { mode: "user" } : undefined);
    if (report.blocked) {
      const categories = phiCategories(report.hits);
      const rules = [...new Set(report.hits.map((h) => h.rule))].sort();
      /* Override is /ai-draft only, never automated paths. Only _ai_draft.js
       * sets these opts, after validating body.phiOverride; every other
       * caller never passes phiOverride. */
      if (opts.phiOverride === true && opts.phiMode === "user" && opts.phiRoute === "ai-draft") {
        await audit(db, projectId, uid, "ai_phi_override", refId, {
          route: "ai-draft",
          task: opts.phiTask || "",
          categories,
          rules,
          termsVersion: opts.phiTermsVersion || PHI_OVERRIDE_TERMS_VERSION,
        });
      } else {
        await audit(db, projectId, uid, "ai_phi_blocked", refId, { categories, purpose });
        const payload = { error: { code: "phi_blocked", message: "Patient identifiers detected; the AI call was blocked.", requestId },
          categories };
        if (opts.phiRoute === "ai-draft" && opts.phiOverridable === true) payload.overridable = true;
        return { error: json(payload, 422, { "x-request-id": requestId }) };
      }
    }
  }
  /* 2. Caps: per-call input ceiling, then daily AI spend (quote included). */
  const ceiling = TIER_CEILINGS.T1;
  if (estimateTokens(assembled) > ceiling.maxInputTokens)
    return { error: err(400, "ceiling_input_tokens", HARD_STOP_MESSAGES.ceiling_input_tokens, requestId) };
  const model = tierModel(env, "T1");
  const maxOut = opts.maxOutputTokens
    ? Math.min(ceiling.maxOutputTokens, opts.maxOutputTokens)
    : ceiling.maxOutputTokens;
  const temperature = opts.temperature === undefined ? 0.2 : opts.temperature;
  const quote = quoteAiCall(env, "T1", model);
  const now = Date.now();
  const capBreach = await checkAiCaps(db, projectId, uid, quote, now);
  if (capBreach) return { error: err(429, capBreach.code, capBreach.message, requestId) };
  /* 3. Credits: available -> reserve. The reserve is the full T1 ceiling. */
  const credits = await availableCredits(db, env, uid, email);
  if (credits.availableMicroUsd < quote)
    return { error: err(402, "insufficient_credits",
      opts.insufficientMessage || "Not enough research credits for this AI suggestion.", requestId) };
  const reservation = await reserveCredits(db, env, uuid, { uid, email, jobId: refId, quote });
  /* 4. One provider call through the existing facade. No tools. */
  const meta = {};
  let text;
  try {
    text = await callGemini(env, [{ text: prompt }], maxOut, { model, system: finalSystem, temperature, meta });
  } catch (e) {
    await releaseCredits(db, uuid, reservation);
    return { error: err(502, "ai_provider_error", "The AI service could not complete this request. Try again.", requestId) };
  }
  /* 5. Log actual usage (metadata only) and settle; release the rest. */
  const u = meta && meta.usage;
  const inTok = u && u.promptTokenCount != null ? (u.promptTokenCount | 0) : estimateTokens(assembled);
  const outTok = u && u.promptTokenCount != null ? (((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) | 0) : estimateTokens(text);
  const usedModel = meta.model || model;
  const actual = aiActualMicroUsd(env, usedModel, inTok, outTok);
  await db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uuid("aiu_"), projectId, uid, refId, purpose, "T1", usedModel, inTok, outTok, actual, Date.now()).run();
  await settleCredits(db, env, uuid, reservation, actual);
  await audit(db, projectId, uid, "ai_call", refId, { tier: "T1", model: usedModel, purpose, tokensIn: inTok, tokensOut: outTok, costMicroUsd: actual });
  return {
    text: String(text || ""), model: usedModel,
    usage: { inputTokens: inTok, outputTokens: outTok },
    costInr: microUsdToInr(actual, usdInrRate(env)),
  };
}

async function runT1(ctx, projectId, purpose, system, prompt, refId, opts) {
  return runUserAi(ctx, projectId, purpose, system, prompt, refId, opts);
}

/* Pull the first JSON value (array or object) out of a model reply, tolerating
 * code fences and prose. Deterministic; never evaluates the text. */
export function extractJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    const slice = s.slice(start, end);
    if (!/[\]}]$/.test(slice.trim())) continue;
    try { return JSON.parse(slice); } catch (e) { /* keep shrinking */ }
  }
  return null;
}

/* ---- POST extraction suggestions ------------------------------------------- */
export async function extractionSuggestions(ctx, projectId, studyId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Extraction suggestions need an owner, editor or analyst role", requestId);
  const study = await db.prepare("SELECT id FROM research_studies WHERE id=? AND project_id=?").bind(studyId, projectId).first();
  if (!study) return err(404, "study_not_found", "Study not found", requestId);
  const template = (body && body.template) || "rct_binary";
  const tpl = templateById(template);
  if (!tpl) return err(422, "invalid_template", "Unknown extraction template", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  /* A persisted extraction hosts the suggestions; create the draft if absent. */
  let row = await rowFor(db, projectId, studyId);
  const now = Date.now();
  if (!row) {
    const id = "ext_" + crypto.randomUUID().replace(/-/g, "");
    await db.prepare("INSERT INTO research_extractions (id,project_id,study_id,artifact_id,template,status,version,fields_json,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,'draft',0,'{}',?,?,?)")
      .bind(id, projectId, studyId, (body && body.artifactId) || null, tpl.id, uid, now, now).run();
    row = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(id).first();
  }
  /* Document text comes from the worker result.json of the linked artifact. */
  const artifactId = (body && body.artifactId) || row.artifact_id;
  if (!artifactId) {
    return err(409, "pdf_not_attached", "Attach the study PDF on the Page tab first before asking MaiK to draft.", requestId);
  }
  const artifact = await db.prepare("SELECT * FROM research_extraction_artifacts WHERE id=? AND project_id=?").bind(artifactId, projectId).first();
  if (!artifact) return err(404, "artifact_not_found", "Artifact not found", requestId);
  const job = artifact.job_id ? await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(artifact.job_id).first() : null;
  if (!job || job.status !== "succeeded") {
    if (job && (job.status === "failed" || job.status === "cancelled")) {
      return json({
        error: { code: "job_failed", message: "Reading that PDF did not finish. Re-attach the study PDF on the Page tab.", requestId },
        jobId: job.id,
        jobStatus: job.status
      }, 409, { "x-request-id": requestId });
    }
    return json({
      error: { code: "job_not_done", message: "MaiK is still reading the paper. Wait a moment and try again.", requestId },
      jobId: job ? job.id : null,
      jobStatus: job ? job.status : (artifact.status || "queued")
    }, 409, { "x-request-id": requestId });
  }
  const obj = await env.RESEARCH_R2.get("projects/" + projectId + "/jobs/" + job.id + "/result.json");
  if (!obj) {
    return json({
      error: { code: "job_not_done", message: "MaiK is finishing reading the paper. Wait a moment and try again.", requestId },
      jobId: job.id,
      jobStatus: "running"
    }, 409, { "x-request-id": requestId });
  }
  const result = await obj.json();
  const pages = Array.isArray(result.pages) ? result.pages : [];
  let doc = pages.map((p) => "[page " + p.n + "]\n" + (p.text || "")).join("\n\n");
  if (doc.length > DOC_CHAR_BUDGET) doc = doc.slice(0, DOC_CHAR_BUDGET);
  const fieldList = tpl.fields.map((f) => f.key + " (" + f.type + (f.required ? ", required" : "") + ")").join(", ");
  const system = "You extract study-level data from a published paper into the fields: " + fieldList + ". " +
    "Return ONLY a JSON array of objects {fieldKey, value, quote, page}. value is a number for numeric fields. " +
    "quote is the verbatim snippet supporting the value; page is the 1-based PDF page. " +
    "Never invent a value; omit any field you cannot read. These are suggestions a human will verify.";
  const prompt = "Extract the fields from the document below.\n\n" + doc;
  const refId = "sug_" + crypto.randomUUID().replace(/-/g, "");
  const out = await runT1(ctx, projectId, "extraction_suggestion", system, prompt, refId, { publicLiterature: true });
  if (out.error) return out.error;
  const parsed = extractJson(out.text);
  const arr = Array.isArray(parsed) ? parsed : [];
  const fieldKeys = tpl.fields.map((f) => f.key);
  let added = 0;
  for (const item of arr) {
    if (!item || fieldKeys.indexOf(item.fieldKey) < 0) continue;
    if (item.value === undefined || item.value === null || item.value === "") continue;
    const value = typeof item.value === "number" ? item.value : String(item.value);
    let locator = null;
    const page = Number(item.page);
    if (Number.isInteger(page) && page >= 1)
      locator = { kind: "pdf", citation: artifact.filename || "PDF", page, pdf: { artifactId: artifact.id, page } };
    const quote = typeof item.quote === "string" ? item.quote.slice(0, 2000) : "";
    await db.prepare("INSERT INTO research_extraction_suggestions (id,extraction_id,field_key,value_json,locator_json,quote,model,status,created_by,created_ts) VALUES (?,?,?,?,?,?,?,'unverified',?,?)")
      .bind("sug_" + crypto.randomUUID().replace(/-/g, ""), row.id, item.fieldKey, JSON.stringify(value),
        locator ? JSON.stringify(locator) : null, quote, out.model, uid, Date.now()).run();
    added++;
  }
  await audit(db, projectId, uid, "extraction_suggested", row.id, { added, model: out.model });
  const fresh = await db.prepare("SELECT * FROM research_extractions WHERE id=?").bind(row.id).first();
  /* Suggestions arrive UNVERIFIED; Accept moves a value into a field still
   * unverified, and a human must Verify before promote. Nothing auto-applied. */
  return json({ extraction: await extractionOf(db, fresh), added, requestId }, 200, { "x-request-id": requestId });
}

/* ---- POST / GET screening suggestions -------------------------------------- */
export async function screeningSuggestion(ctx, projectId, recordId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, VOTE_ROLES);
  if (gate.status) return gateErr(gate, "Screening suggestions need a voting role", requestId);
  const record = await db.prepare("SELECT * FROM research_records WHERE id=? AND project_id=?").bind(recordId, projectId).first();
  if (!record) return err(404, "record_not_found", "Record not found", requestId);
  const meta = JSON.parse(record.metadata_json || "{}");
  const abstract = typeof meta.abstract === "string" ? meta.abstract : "";
  const system = "You suggest a title/abstract screening decision for a systematic review. " +
    "Return ONLY a JSON object {decision, reasonCode, rationale}. decision is include, exclude or uncertain. " +
    "reasonCode is an UPPER_SNAKE exclusion code when excluding (for example WRONG_POPULATION), else empty. " +
    "rationale is one short sentence. This is a suggestion; a human reviewer makes the actual vote.";
  const prompt = "Title: " + (record.title || "") + "\nYear: " + (record.year || "") + "\nAbstract: " + abstract.slice(0, DOC_CHAR_BUDGET);
  const refId = "sug_" + crypto.randomUUID().replace(/-/g, "");
  const out = await runT1(ctx, projectId, "screening_suggestion", system, prompt, refId, { publicLiterature: true });
  if (out.error) return out.error;
  const parsed = extractJson(out.text) || {};
  const decision = ["include", "exclude", "uncertain"].indexOf(parsed.decision) >= 0 ? parsed.decision : "uncertain";
  const reasonCode = typeof parsed.reasonCode === "string" ? parsed.reasonCode.slice(0, 80) : "";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "";
  const id = "sug_" + crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  const payload = { decision, reasonCode, rationale };
  await db.prepare("INSERT INTO research_screening_suggestions (id,project_id,record_id,payload_json,model,status,created_by,created_ts) VALUES (?,?,?,?,?,'unverified',?,?)")
    .bind(id, projectId, recordId, JSON.stringify(payload), out.model, uid, now).run();
  await audit(db, projectId, uid, "screening_suggested", recordId, { decision, model: out.model });
  /* B6: a suggestion NEVER writes a screening decision. The reviewer who accepts
   * it submits their own vote through the decisions route. */
  return json({ suggestion: { id, recordId, decision, reasonCode, rationale, model: out.model, status: "unverified", createdTs: now }, requestId },
    201, { "x-request-id": requestId });
}
export async function listScreeningSuggestions(ctx, projectId, recordId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, VOTE_ROLES);
  if (gate.status) return gateErr(gate, "Screening suggestions need a voting role", requestId);
  const record = await db.prepare("SELECT id FROM research_records WHERE id=? AND project_id=?").bind(recordId, projectId).first();
  if (!record) return err(404, "record_not_found", "Record not found", requestId);
  const rows = (await db.prepare("SELECT * FROM research_screening_suggestions WHERE project_id=? AND record_id=? ORDER BY created_ts DESC")
    .bind(projectId, recordId).all()).results || [];
  const suggestions = rows.map((r) => Object.assign({ id: r.id, recordId: r.record_id, model: r.model || "",
    status: r.status, createdTs: r.created_ts }, JSON.parse(r.payload_json || "{}")));
  return json({ suggestions }, 200, { "x-request-id": requestId });
}

export { TEMPLATES };
