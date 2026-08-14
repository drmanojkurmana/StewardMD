/* StewardMD - ONCQIS Phase J-a: Knowledge Center INGESTION API (Cloudflare Pages Function).
 *
 * Admin-only guideline ingestion for the oncology protocol governance system. Powers admin/oncology.html.
 *
 * THE HARD SAFETY RULE (structural, non-negotiable): UPLOAD -> AI ANALYSIS -> PROPOSED artifacts only.
 * This route can create/read Evidence-Source, extraction and Update-Impact-Report objects and NOTHING
 * else - it never writes a Standard Protocol, a Treatment Plan or a dose (it does not import a protocol
 * writer). The AI (reused via callGemini from the approved Vertex/Gemini path) is sent ONLY guideline +
 * Standard-Protocol TEXT (see _onco_kb.analyzePayload) - never a patient name/MRN/clinical field.
 *
 * Gate: server env SMD_ONCO_KB_ADMIN must be "1" (feature flag smd_onco_kb_admin, default OFF) AND the
 * caller must be an authenticated admin (owner Google login or admin token) who ALSO holds the
 * ONCQIS_PROTOCOL_AUTHOR cap (functions/_queue_roles.js). Author emails: env ONCQIS_PROTOCOL_AUTHORS
 * (comma-separated), defaulting to the owner list - so the owner running the console has it out of the
 * box, while a clinical author can be granted it without owner powers.
 *
 * Routes (all under /api/onco/kb):
 *   GET  /api/onco/kb/ready                 -> { ok, enabled }                     (unauth probe)
 *   GET  /api/onco/kb/evidence              -> { ok, evidence }                    (J3 library)
 *   GET  /api/onco/kb/extractions           -> { ok, extractions }
 *   GET  /api/onco/kb/reports               -> { ok, reports }                     (J6 outputs)
 *   POST /api/onco/kb/evidence/upload       -> { ok, evidence }                    (J4)
 *   POST /api/onco/kb/evidence/analyze      -> { ok, extraction }                  (J5)
 *   POST /api/onco/kb/evidence/impact       -> { ok, report }                      (J6 batch job)
 */
import { ownerOK, emailFromToken, ownerEmails } from "../../_adminauth.js";
import { CAPS, can, requireCap } from "../../_queue_roles.js";
import { callGemini } from "../ai/[[path]].js";      // REUSE the approved Vertex/Gemini transport
import ONCOKB from "../../_onco_kb.js";               // pure J5/J6 core (UMD default import)
import * as STORE from "../../_onco_kb_store.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function kbAdminEnabled(env) { return String(env && env.SMD_ONCO_KB_ADMIN) === "1"; }

// The ONCQIS author allowlist. Configurable via env; defaults to the owner emails so the console works
// for the owner immediately. A member on this list resolves to the oncqis_protocol_author role.
function oncqisAuthors(env) {
  if (env && env.ONCQIS_PROTOCOL_AUTHORS) return String(env.ONCQIS_PROTOCOL_AUTHORS).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ownerEmails(env);
}
function oncqisRoleFor(email) { return email ? "oncqis_protocol_author" : "viewer"; }

// Gate every ingestion op: authenticated admin boundary (ownerOK) AND holds ONCQIS_PROTOCOL_AUTHOR.
// Returns { ok, email } or { ok:false, resp }.
async function gateAuthor(request, env) {
  if (!(await ownerOK(request, env))) return { ok: false, resp: json({ error: "unauthorized" }, 401) };
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const email = bearer ? emailFromToken(bearer) : "";
  // An admin-token caller (no email, e.g. a server/cron) is trusted as an author; a Google login must
  // be on the ONCQIS author list.
  const isAuthor = !email || oncqisAuthors(env).indexOf(email.toLowerCase()) > -1;
  const role = isAuthor ? oncqisRoleFor(email || "token") : "viewer";
  try { requireCap(role, CAPS.ONCQIS_PROTOCOL_AUTHOR); }
  catch (e) { return { ok: false, resp: json({ error: "forbidden", detail: "ONCQIS_PROTOCOL_AUTHOR required" }, 403) }; }
  return { ok: true, email: email };
}

function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  try { return JSON.parse(s); } catch (e) {}
  const m = s.match(/\{[\s\S]*\}/);   // first {...} block
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}

async function sha256hex(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return ""; }
}

// PDF (base64) -> plain text via Workers AI toMarkdown (same path the Updates pipeline uses). No PHI:
// the doc is a licensed guideline. Returns "" on any failure so analyze degrades to caller-supplied text.
async function pdfB64ToText(env, b64) {
  try {
    if (!(env && env.AI && typeof env.AI.toMarkdown === "function") || !b64) return "";
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (u.byteLength > 25 * 1024 * 1024) return "";   // ponytail: KV-sized cap; move to R2 if volume grows
    const res = await env.AI.toMarkdown({ name: "guideline.pdf", blob: new Blob([u], { type: "application/pdf" }) });
    const conv = Array.isArray(res) ? res[0] : res;
    return (conv && conv.data) ? String(conv.data).slice(0, 60000) : "";
  } catch (e) { return ""; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/onco\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  // parts: ["kb", ...]
  if (parts[0] !== "kb") return json({ error: "not-found" }, 404);
  const seg = parts[1] || "", sub = parts[2] || "";
  const method = request.method;

  if (method === "GET" && seg === "ready") return json({ ok: true, enabled: kbAdminEnabled(env) });
  if (!kbAdminEnabled(env)) return json({ ok: false, error: "disabled" }, 404);

  // Everything below is admin + ONCQIS_PROTOCOL_AUTHOR gated.
  const gate = await gateAuthor(request, env);
  if (!gate.ok) return gate.resp;
  const store = STORE.kbStore(env);

  try {
    /* ---------------- reads (J1 tiles + J2/J3 libraries are aggregated client-side) --------- */
    if (method === "GET" && seg === "evidence") return json({ ok: true, evidence: await STORE.listEvidence(store) });
    if (method === "GET" && seg === "extractions") return json({ ok: true, extractions: await STORE.listExtractions(store) });
    if (method === "GET" && seg === "reports") return json({ ok: true, reports: await STORE.listImpactReports(store) });

    let body = {};
    if (method === "POST") { try { body = await request.json(); } catch (e) { body = {}; } }

    /* ---------------- J4: guideline upload ------------------------------------------------- */
    if (method === "POST" && seg === "evidence" && sub === "upload") {
      // Licensed uploads ONLY, no scraping: the uploader must explicitly attest a licensed source.
      if (!body.licensed) return json({ error: "licensed_attestation_required" }, 400);
      const title = String(body.title || "").trim();
      if (!title) return json({ error: "title_required" }, 400);
      const pdfB64 = typeof body.pdfB64 === "string" ? body.pdfB64 : "";
      const byteSize = pdfB64 ? Math.floor(pdfB64.length * 0.75) : 0;
      if (byteSize > 25 * 1024 * 1024) return json({ error: "pdf_too_large" }, 413);
      const checksum = await sha256hex(pdfB64 || (title + "|" + (body.version || "")));
      const rec = await STORE.saveEvidence(store, {
        title, org: body.org, version: body.version, publicationDate: body.publicationDate,
        updateDate: body.updateDate, uploadDate: Date.now(), uploader: gate.email || "admin",
        sourceType: body.sourceType, diseases: body.diseases, provenance: body.provenance,
        licensed: true, fileName: body.fileName, byteSize, checksum, pdfB64, status: "uploaded"
      });
      const out = Object.assign({}, rec); delete out.pdfB64;
      return json({ ok: true, evidence: out });
    }

    /* ---------------- J5: AI evidence extraction ------------------------------------------- */
    if (method === "POST" && seg === "evidence" && sub === "analyze") {
      const evidenceId = String(body.evidenceId || "");
      const ev = evidenceId ? await STORE.getEvidence(store, evidenceId) : null;
      // Guideline text: caller-supplied, else convert the stored PDF. Standard Protocol text is OPTIONAL
      // context. NEITHER may contain PHI - they are guideline + protocol text only.
      let guidelineText = String(body.guidelineText || "");
      if (!guidelineText && ev && ev.pdfB64) guidelineText = await pdfB64ToText(env, ev.pdfB64);
      if (!guidelineText) return json({ error: "no_guideline_text" }, 400);
      const protocolText = String(body.protocolText || "");

      // The PHI-free payload (only these two keys ever reach the AI - see _onco_kb.analyzePayload).
      const payload = ONCOKB.analyzePayload(guidelineText, protocolText);
      const prompt = ONCOKB.extractionPrompt(payload);
      let text;
      try { text = await callGemini(env, [{ text: prompt }], 4096, { temperature: 0.1 }); }
      catch (e) { return json({ error: "ai_failed", detail: String((e && e.message) || e).slice(0, 120) }, 502); }
      const extraction = ONCOKB.sanitizeExtraction(parseJsonLoose(text));
      const rec = await STORE.saveExtraction(store, Object.assign({
        evidenceId: evidenceId || null, createdAt: Date.now(), createdBy: gate.email || "admin"
      }, extraction));
      if (evidenceId) await STORE.markEvidenceExtracted(store, evidenceId, rec.id);
      return json({ ok: true, extraction: rec });
    }

    /* ---------------- J6: batch impact (protocolUpdateJob) --------------------------------- */
    if (method === "POST" && seg === "evidence" && sub === "impact") {
      const extractionId = String(body.extractionId || "");
      const extraction = extractionId ? await STORE.getExtraction(store, extractionId) : (body.extraction || null);
      if (!extraction) return json({ error: "extraction_required" }, 400);
      // ACTIVE Standard Protocols to compare against, supplied by the client from the protocol library
      // (non-PHI reference objects). The job READS them and writes nothing back to them.
      const protocols = Array.isArray(body.protocols) ? body.protocols : [];
      const report = ONCOKB.protocolUpdateJob(extraction, protocols, {
        now: Date.now(), extractionId: extractionId || null, evidenceId: extraction.evidenceId || null
      });
      const rec = await STORE.saveImpactReport(store, report);
      return json({ ok: true, report: rec });
    }

    return json({ error: "bad_request", seg, sub }, 400);
  } catch (e) {
    try { console.warn("[onco-kb] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {}
    return json({ error: "server_error" }, 500);
  }
}
