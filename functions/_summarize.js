/* StewardMD — Medical Updates AI summarizer.
 *
 * Turns a newly-detected medical document (metadata + a bounded text excerpt) into
 * a structured, ORIGINAL summary. Called ONCE per genuinely new/changed document by
 * the ingest pipeline; the result is cached in D1 forever and shared by all users.
 *
 * Reuses the app's existing Gemini transport (callGemini → Vertex primary, AI-Studio
 * fallback) from functions/api/ai. Model chain: gemini-2.5-flash-lite (cheapest) →
 * gemini-2.5-flash (fallback), overridable via UPDATES_MODEL / UPDATES_MODEL_FALLBACK.
 *
 * COPYRIGHT: the prompt forbids reproducing guideline text, tables, or figures. Only
 * an original plain-language summary + structured facts + links are produced/stored.
 */
import { callGemini } from "./api/ai/[[path]].js";
import { usageKv, usageConfig, recordUsage, estTokens } from "./_usage.js";

const MODEL_PRIMARY_DEFAULT = "gemini-2.5-flash-lite";
const MODEL_FALLBACK_DEFAULT = "gemini-2.5-flash";
const WORKSPACES = ["internal_medicine", "surgery", "ent", "ophthalmology", "obstetrics_gynaecology", "urology", "dentistry_omfs", "paediatrics"];

const SUMMARY_SYS =
  "You are a medical editor for a clinical app used by qualified doctors. You are given METADATA and a " +
  "SOURCE EXCERPT for ONE newly released medical item (a guideline, drug approval, safety alert, or major " +
  "trial) from an official organization. Write an ORIGINAL, plain-language summary for busy clinicians.\n" +
  "STRICT COPYRIGHT RULES: Do NOT reproduce, quote, or closely paraphrase the source text. Do NOT copy tables, " +
  "figures, or verbatim recommendation wording. Summarize in your own words only. If the excerpt is too thin to " +
  "summarize reliably, say so in the summary and leave the detail arrays empty — never invent facts, doses, " +
  "numbers, DOIs, or PMIDs that are not present.\n" +
  "Return ONLY JSON (no prose, no markdown fence) with EXACTLY these keys:\n" +
  "{\"title\":string, \"organization\":string, \"specialty\":string, \"release_date\":string, \"version\":string, " +
  "\"importance\":\"normal\"|\"high\"|\"critical\", \"estimated_read_time\":number, \"summary\":string, " +
  "\"major_changes\":[string], \"what_changed\":[string], \"clinical_impact\":string, \"clinical_pearls\":[string], " +
  "\"new_recommendations\":[string], \"removed_recommendations\":[string], \"practice_points\":[string], " +
  "\"evidence_level\":string, \"keywords\":[string], \"official_url\":string, \"official_pdf_url\":string, " +
  "\"doi\":string, \"pmid\":string, " +
  "\"pharma\":{\"drug_class\":string,\"indications\":[string],\"dose\":string,\"duration\":string,\"contraindications\":[string]}}.\n" +
  "GUIDANCE: \"summary\" is original prose, AT MOST 700 words. \"estimated_read_time\" is whole minutes to read the " +
  "summary. \"importance\": 'critical' for safety withdrawals/boxed warnings/drug bans, 'high' for practice-changing " +
  "guideline updates or major approvals, else 'normal'. Arrays hold short phrases; use [] when genuinely none. Echo " +
  "official_url/doi/pmid from the metadata when present, else empty string. Use the WEB SEARCH RESULTS " +
  "(when provided) as authoritative context. PHARMA: fill \"pharma\" ONLY for a drug (a drug approval, " +
  "or a safety alert about a specific drug) — drug class, key licensed indication(s), usual adult " +
  "dose/route, typical duration, and main contraindications/black-box cautions, each concise and taken " +
  "ONLY from the inputs (NEVER invent a dose or number); empty fields for non-drugs. No text outside the JSON.";

function parseJsonLoose(t) {
  if (!t) return null;
  const m = String(t).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
function clampWords(s, max) {
  const w = String(s || "").trim().split(/\s+/);
  return w.length <= max ? String(s || "").trim() : w.slice(0, max).join(" ") + "…";
}
function arr(x) { return Array.isArray(x) ? x.filter(Boolean).map((v) => String(v)).slice(0, 12) : []; }
function normImportance(v) { v = String(v || "").toLowerCase().trim(); return (v === "high" || v === "critical") ? v : "normal"; }
function normWorkspace(v, fallback) { v = String(v || "").toLowerCase().trim(); return WORKSPACES.indexOf(v) >= 0 ? v : (fallback || "internal_medicine"); }

// Build a metering gate that reuses _usage.recordUsage so summaries appear in the
// existing /api/ai/admin report under byType.updates_summary. Fail-open (no KV → no meter).
export async function meterGate(env, type) {
  const store = usageKv(env);
  if (!store) return { meter: false };
  const cfg = usageConfig(env);
  const now = new Date(), day = now.toISOString().slice(0, 10), month = now.toISOString().slice(0, 7);
  const id = "system:updates";
  const rj = async (k) => { try { return (await store.get(k, "json")) || null; } catch (e) { return null; } };
  const u = (await rj("maik:u:" + id + ":" + day)) || { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 };
  const m = (await rj("maik:m:" + id + ":" + month)) || { tokens: 0 };
  const g = (await rj("maik:global:" + day)) || { cost: 0, req: 0, blocked: 0 };
  return { meter: true, store, cfg, u, m, g, id, _day: day, _month: month, type: type || "updates_summary" };
}

/**
 * summarizeDocument(env, meta) → { ok, data?, model?, error? }
 *   meta = { title, organization, sourceType, workspace, url, doi, pmid, publishedTs, excerpt }
 * `data` is the normalised structured object ready to persist. On failure ok=false.
 */
export async function summarizeDocument(env, meta) {
  const primary = env.UPDATES_MODEL || MODEL_PRIMARY_DEFAULT;
  const fallback = env.UPDATES_MODEL_FALLBACK || MODEL_FALLBACK_DEFAULT;
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

  const metaBlock = [
    "=== METADATA ===",
    "Organization: " + (meta.organization || ""),
    "Item type: " + (meta.sourceType || "guideline"),
    "Title: " + (meta.title || ""),
    meta.url ? "Official URL: " + meta.url : "",
    meta.doi ? "DOI: " + meta.doi : "",
    meta.pmid ? "PMID: " + meta.pmid : "",
    meta.publishedTs ? "Published: " + new Date(meta.publishedTs).toISOString().slice(0, 10) : "",
    "",
    "=== SOURCE EXCERPT (summarize in your OWN words; do not copy) ===",
    String(meta.excerpt || meta.title || "").slice(0, 8000),
    (Array.isArray(meta.search) && meta.search.length)
      ? "\n=== WEB SEARCH RESULTS (authoritative context — summarize facts in your OWN words; do not copy) ===\n" +
        meta.search.slice(0, 8).map((r, i) => (i + 1) + ". " + (r.title || "") + (r.site ? " — " + r.site : "") + "\n" + (r.snippet || "") + "\n" + (r.url || "")).join("\n")
      : "",
  ].filter(Boolean).join("\n");

  const gate = await meterGate(env);
  let lastErr = null;

  for (const model of models) {
    try {
      const text = await callGemini(
        Object.assign({}, env, { GEMINI_MODEL: model }),
        [{ text: SUMMARY_SYS + "\n\n" + metaBlock }],
        1400,
        { temperature: 0.3 }
      );
      const parsed = parseJsonLoose(text);
      if (parsed && (parsed.summary || parsed.title)) {
        if (gate.meter) {
          try { await recordUsage(gate, { inTok: estTokens(SUMMARY_SYS.length + metaBlock.length), outTok: estTokens((text || "").length), status: "success" }); } catch (e) {}
        }
        const _ph = (parsed.pharma && typeof parsed.pharma === "object") ? parsed.pharma : {};
        const _pharma = { drug_class: String(_ph.drug_class || "").slice(0, 140), indications: arr(_ph.indications), dose: String(_ph.dose || "").slice(0, 400), duration: String(_ph.duration || "").slice(0, 300), contraindications: arr(_ph.contraindications) };
        const _hasPharma = !!(_pharma.drug_class || _pharma.dose || _pharma.duration || _pharma.indications.length || _pharma.contraindications.length);
        const data = {
          title: String(parsed.title || meta.title || "").slice(0, 240),
          organization: String(parsed.organization || meta.organization || "").slice(0, 120),
          pharma: (_hasPharma && (meta.sourceType === "drug_approval" || meta.sourceType === "safety_alert")) ? _pharma : null,
          workspace: normWorkspace(meta.workspace, "internal_medicine"),
          specialty: String(parsed.specialty || "").slice(0, 80),
          release_date: String(parsed.release_date || "").slice(0, 40),
          version: String(parsed.version || "").slice(0, 60),
          importance: normImportance(parsed.importance),
          est_read_min: Math.max(1, Math.min(60, parseInt(parsed.estimated_read_time, 10) || 3)),
          summary: clampWords(parsed.summary, 700),
          major_changes: arr(parsed.major_changes),
          what_changed: arr(parsed.what_changed),
          clinical_impact: String(parsed.clinical_impact || "").slice(0, 1200),
          clinical_pearls: arr(parsed.clinical_pearls),
          new_recommendations: arr(parsed.new_recommendations),
          removed_recommendations: arr(parsed.removed_recommendations),
          practice_points: arr(parsed.practice_points),
          evidence_level: String(parsed.evidence_level || "").slice(0, 80),
          keywords: arr(parsed.keywords),
          official_url: String(parsed.official_url || meta.url || "").slice(0, 500),
          official_pdf_url: String(parsed.official_pdf_url || "").slice(0, 500),
          doi: String(parsed.doi || meta.doi || "").slice(0, 120),
          pmid: String(parsed.pmid || meta.pmid || "").slice(0, 40),
        };
        return { ok: true, data, model };
      }
      lastErr = new Error("summarizer returned unparseable JSON");
    } catch (e) { lastErr = e; }
  }
  if (gate.meter) {
    try { await recordUsage(gate, { inTok: estTokens(SUMMARY_SYS.length + metaBlock.length), outTok: 0, status: "failed" }); } catch (e) {}
  }
  return { ok: false, error: String((lastErr && lastErr.message) || lastErr || "summarize failed") };
}

/* ------------------------------------------------------------------ *
 * Admin "AI push box" classifier. Given an admin note and/or a fetched
 * page (title + text), pick the content TYPE and specialty WORKSPACE
 * (which the pipeline summarizer takes from the crawl source, not the AI)
 * and write a short original summary — so the owner can paste ANY link
 * (incl. non-FDA / Indian launches the crawler misses) and publish it.
 * Returns a draft ready for POST /api/updates. Metered as updates_classify.
 * ------------------------------------------------------------------ */
const CLASSIFY_TYPES = ["guideline", "drug_approval", "safety_alert", "trial"];
const CLASSIFY_SYS =
  "You are a medical content editor for a clinical app used by qualified doctors in India. You are given an admin NOTE " +
  "and (optionally) the TITLE and TEXT of one official medical item — a clinical guideline, a drug approval/launch, a " +
  "drug safety alert, or a major trial. Classify it and write an ORIGINAL short summary for busy clinicians.\n" +
  "STRICT: Do NOT copy or closely paraphrase source wording; summarize in your own words. Never invent facts, doses, " +
  "numbers, DOIs, or PMIDs. If the text is thin, rely on the note + title and keep it brief.\n" +
  "Return ONLY JSON (no prose, no markdown fence) with EXACTLY these keys:\n" +
  "{\"type\":\"guideline\"|\"drug_approval\"|\"safety_alert\"|\"trial\", \"workspace\":one of [" + WORKSPACES.join(", ") + "], " +
  "\"title\":string, \"organization\":string, \"summary\":string, \"importance\":\"normal\"|\"high\"|\"critical\", " +
  "\"keywords\":[string], \"official_url\":string, " +
  "\"pharma\":{\"drug_class\":string, \"indications\":[string], \"dose\":string, \"duration\":string, \"contraindications\":[string]}}.\n" +
  "GUIDANCE: choose the single best type and the single most relevant specialty workspace. \"summary\" is original " +
  "prose, AT MOST 120 words, usable as both a push-notification body and a feed card. \"importance\": 'critical' for " +
  "withdrawals/boxed warnings/bans, 'high' for practice-changing guidelines or major approvals, else 'normal'. " +
  "\"title\" <= 140 characters.\n" +
  "PHARMA: fill \"pharma\" ONLY for a drug (type drug_approval, or a safety_alert about a specific drug) — give the " +
  "drug class, key licensed indication(s), the usual adult dose/route, typical duration, and the main " +
  "contraindications/black-box cautions, each concise. Use ONLY facts present in the source/note/search results; NEVER " +
  "invent a dose, number, or contraindication — leave a field empty ('' or []) if not stated. For non-drug items set " +
  "every pharma field empty.\n" +
  "\"official_url\": the single MOST authoritative source URL for this item — prefer an official regulator/label/" +
  "society/journal link from the WEB SEARCH RESULTS or the provided URL; echo the provided URL if nothing better. " +
  "No text outside the JSON.";

export async function classifyDocument(env, meta) {
  meta = meta || {};
  const primary = env.UPDATES_MODEL || MODEL_PRIMARY_DEFAULT;
  const fallback = env.UPDATES_MODEL_FALLBACK || MODEL_FALLBACK_DEFAULT;
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];
  const searchBlock = (Array.isArray(meta.search) && meta.search.length)
    ? "\n=== WEB SEARCH RESULTS (authoritative context — summarize facts in your OWN words; do not copy) ===\n" +
      meta.search.slice(0, 8).map((r, i) => (i + 1) + ". " + (r.title || "") + (r.site ? " — " + r.site : "") + "\n" + (r.snippet || "") + "\n" + (r.url || "")).join("\n")
    : "";
  const block = [
    meta.prompt ? "=== ADMIN NOTE ===\n" + String(meta.prompt).slice(0, 2000) : "",
    meta.url ? "Provided URL: " + meta.url : "",
    meta.title ? "Title: " + meta.title : "",
    meta.excerpt ? "\n=== SOURCE TEXT (summarize in your OWN words; do not copy) ===\n" + String(meta.excerpt).slice(0, 30000) : "",
    searchBlock,
  ].filter(Boolean).join("\n");
  const gate = await meterGate(env, "updates_classify");
  let lastErr = null;
  for (const model of models) {
    try {
      const text = await callGemini(Object.assign({}, env, { GEMINI_MODEL: model }), [{ text: CLASSIFY_SYS + "\n\n" + block }], 1100, { temperature: 0.2 });
      const p = parseJsonLoose(text);
      if (p && (p.title || p.summary)) {
        if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(CLASSIFY_SYS.length + block.length), outTok: estTokens((text || "").length), status: "success" }); } catch (e) {} }
        const type = CLASSIFY_TYPES.indexOf(String(p.type || "").toLowerCase().trim()) >= 0 ? String(p.type).toLowerCase().trim() : "guideline";
        const ph = (p.pharma && typeof p.pharma === "object") ? p.pharma : {};
        const pharma = {
          drug_class: String(ph.drug_class || "").slice(0, 140),
          indications: arr(ph.indications),
          dose: String(ph.dose || "").slice(0, 400),
          duration: String(ph.duration || "").slice(0, 300),
          contraindications: arr(ph.contraindications),
        };
        const hasPharma = !!(pharma.drug_class || pharma.dose || pharma.duration || pharma.indications.length || pharma.contraindications.length);
        const draft = {
          type,
          workspace: normWorkspace(p.workspace, "internal_medicine"),
          title: String(p.title || meta.title || "").trim().slice(0, 200),
          organization: String(p.organization || "").slice(0, 120),
          body: clampWords(p.summary, 120),
          importance: normImportance(p.importance),
          keywords: arr(p.keywords),
          url: String(p.official_url || meta.url || "").slice(0, 500),   // AI picks the most authoritative link from search/URL
          // pharma only meaningful for drug items; the app renders it only when non-empty.
          pharma: (hasPharma && (type === "drug_approval" || type === "safety_alert")) ? pharma : null,
        };
        return { ok: true, draft, model };
      }
      lastErr = new Error("classifier returned unparseable JSON");
    } catch (e) { lastErr = e; }
  }
  if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(CLASSIFY_SYS.length + block.length), outTok: 0, status: "failed" }); } catch (e) {} }
  return { ok: false, error: String((lastErr && lastErr.message) || lastErr || "classify failed") };
}

/* ------------------------------------------------------------------ *
 * Phase 3 — "What's Changed": diff a document against its prior version.
 * Runs ONLY when the pipeline detects a changed doc (rare). Produces the
 * Topic / Previous / Current / Impact rows shown on the guideline page.
 * ------------------------------------------------------------------ */
const IMPACTS = ["Practice changing", "High", "Moderate", "Low"];
function normImpact(v) {
  v = String(v || "").trim().toLowerCase();
  if (/practice/.test(v)) return "Practice changing";
  if (v === "high") return "High";
  if (v === "moderate" || v === "medium") return "Moderate";
  if (v === "low") return "Low";
  return "Moderate";
}
const DIFF_SYS =
  "You are a medical editor. You are given a PREVIOUS plain-language summary of a clinical guideline/document " +
  "(already in our own words) and the CURRENT source excerpt for the NEW version of that same document. Identify " +
  "what MATERIALLY CHANGED for a practising clinician — new, revised, or removed recommendations, thresholds, drug " +
  "choices, dosing, eligibility/indications. Focus on differences, not a re-summary.\n" +
  "COPYRIGHT: paraphrase in your own words; never copy source wording, tables, or figures.\n" +
  "Return ONLY JSON (no prose, no fence): {\"changes\":[{\"topic\":string,\"previous\":string,\"current\":string," +
  "\"impact\":\"Practice changing\"|\"High\"|\"Moderate\"|\"Low\"}]}. `topic` is the clinical area (e.g. 'Blood pressure " +
  "target'); `previous` and `current` are short phrases. Include ONLY concrete, evidence-based changes you can support " +
  "from the inputs — never invent a change. If you cannot identify concrete changes, return {\"changes\":[]}. Max 8 rows.";

function prevSummaryText(prev) {
  if (!prev) return "";
  if (typeof prev === "string") return prev;
  return [
    prev.summary || "",
    (prev.new_recommendations || []).length ? "Recommendations: " + prev.new_recommendations.join("; ") : "",
    (prev.practice_points || []).length ? "Practice points: " + prev.practice_points.join("; ") : "",
    (prev.major_changes || []).length ? "Prior changes: " + prev.major_changes.join("; ") : "",
  ].filter(Boolean).join("\n");
}

/**
 * diffDocument(env, meta) → { ok, changes: [{topic, previous, current, impact}] }
 *   meta = { prevSummary (object|string), newExcerpt, title, organization }
 */
export async function diffDocument(env, meta) {
  const prevText = prevSummaryText(meta.prevSummary);
  if (!prevText) return { ok: false, changes: [], error: "no-previous" };
  const primary = env.UPDATES_MODEL || MODEL_PRIMARY_DEFAULT;
  const fallback = env.UPDATES_MODEL_FALLBACK || MODEL_FALLBACK_DEFAULT;
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];
  const block = [
    "Title: " + (meta.title || ""),
    "Organization: " + (meta.organization || ""),
    "",
    "=== PREVIOUS SUMMARY (older version, our own words) ===",
    prevText,
    "",
    "=== CURRENT SOURCE EXCERPT (new version) ===",
    String(meta.newExcerpt || "").slice(0, 8000),
  ].join("\n");
  const gate = await meterGate(env, "updates_diff");
  let lastErr = null;
  for (const model of models) {
    try {
      const text = await callGemini(Object.assign({}, env, { GEMINI_MODEL: model }), [{ text: DIFF_SYS + "\n\n" + block }], 1024, { temperature: 0.2 });
      const parsed = parseJsonLoose(text);
      if (parsed && Array.isArray(parsed.changes)) {
        const changes = parsed.changes.filter((c) => c && (c.topic || c.current)).slice(0, 8).map((c) => ({
          topic: String(c.topic || "").slice(0, 120),
          previous: String(c.previous || "").slice(0, 300),
          current: String(c.current || "").slice(0, 300),
          impact: normImpact(c.impact),
        }));
        if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(DIFF_SYS.length + block.length), outTok: estTokens((text || "").length), status: "success" }); } catch (e) {} }
        return { ok: true, changes };
      }
      lastErr = new Error("diff returned unparseable JSON");
    } catch (e) { lastErr = e; }
  }
  if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(DIFF_SYS.length + block.length), outTok: 0, status: "failed" }); } catch (e) {} }
  return { ok: false, changes: [], error: String((lastErr && lastErr.message) || lastErr || "diff failed") };
}
