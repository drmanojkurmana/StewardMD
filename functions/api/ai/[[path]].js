/* StewardMD — Gemini AI Function (Cloudflare Pages)
 *
 * Decision-support EXPLAINER + Vision EXTRACTOR only. The clinical decision is
 * ALWAYS computed by the rule engine first; Gemini only (a) explains an
 * already-computed differential in plain language, or (b) reads a captured
 * image and returns STRUCTURED fields that the app then validates and ingests.
 * It never makes the diagnosis and never returns free-form treatment orders.
 *
 * Routes (POST unless noted):
 *   GET  /api/ai/status   -> { enabled }                 (is a key configured)
 *   POST /api/ai/explain  -> { text }                    body: { summary, question? }
 *   POST /api/ai/vision   -> { fields }                  body: { image(base64|dataURL), kind }
 *
 * Config (Pages env, encrypted secret):
 *   GEMINI_API_KEY  (required to enable; absent => AI disabled, client falls back)
 *   GEMINI_MODEL    (optional, default 'gemini-2.0-flash')
 * Auth: same gate as the GHIS Function (Cf-Access / X-App-Token / same-origin).
 *
 * PHI NOTE: /vision sends a clinical IMAGE and /explain sends clinical FINDINGS
 * to Google. This is OFF unless GEMINI_API_KEY is set AND the app's `smd_ai`
 * flag is on. Nothing is persisted by this Function.
 */

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  if (env.GHIS_APP_TOKEN && request.headers.get("X-App-Token") === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && request.headers.get("X-App-Token") === env.AI_APP_TOKEN) return true;
  const o = request.headers.get("Origin") || "";
  return o.endsWith("stewardmd.in") || o === "";
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function callGemini(env, parts, maxTokens) {
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const r = await fetch(`${GEMINI}/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens || 1024 }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ("Gemini HTTP " + r.status));
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ""; }).join("") : "";
  return text || "";
}

const EXPLAIN_SYS =
  "You are an internal-medicine teaching assistant inside a clinical decision-support tool. " +
  "The differential and ranking below were COMPUTED BY A RULE ENGINE — do NOT change them, invent new diagnoses, or give specific drug doses. " +
  "In 4-6 short bullet points, explain WHY the leading diagnosis fits, which findings argue for/against it, what would discriminate it from the next contender, and the single most important next step. Be concise and bedside-useful. End with: 'Decision-support only — verify clinically.'";

// RAG (grounded) system prompt. The StewardMD Knowledge Base supplied in the
// package is the PRIMARY source of truth; the model's own medical knowledge is
// secondary. The deterministic engine OWNS the diagnosis.
const RAG_SYS =
  "You are StewardMD's internal-medicine teaching assistant. A DETERMINISTIC RULE ENGINE has already computed the diagnosis and ranked differential (in ENGINE OUTPUT below) — that ranking is AUTHORITATIVE. You must NOT override it, invent a new leading diagnosis, or reason primarily from your own training. " +
  "Reason PRIMARILY from the RETRIEVED STEWARDMD KNOWLEDGE and TREATMENT RESOLUTION provided (Harrison-derived, page-cited; ICMR ▸ international-guideline ▸ Harrison precedence; hospital overlay shown separately). Your own medical knowledge is SECONDARY — use it only to connect or clarify the provided knowledge, and flag when you do. " +
  "You may ONLY: (1) explain why the leading diagnosis fits and what discriminates it from the next contenders; (2) critique the reasoning (weak/contradictory evidence, gaps); (3) suggest additional differentials worth considering; (4) recommend further investigations; (5) give teaching points; (6) suggest culture-directed antibiotic considerations WHEN culture/sensitivity data is provided. " +
  "Cite the provided sources inline (e.g. 'Harrison 22e' or the tier). Reference drugs by name/class only — NO specific doses beyond what the provided treatment resolution states. Do NOT use patient identifiers. Be concise, bedside-useful, structured with short headed sections. End with: 'Decision-support only — the StewardMD rule engine owns the diagnosis; verify clinically.'";

function clip(s, n) { return String(s == null ? "" : s).slice(0, n || 240); }
function renderGroundedPrompt(pkg) {
  const L = [];
  const r = pkg.reasoning || {}, pc = pkg.patientCase || {};
  L.push("=== DETERMINISTIC ENGINE OUTPUT (AUTHORITATIVE — do not change the diagnosis) ===");
  if (r.gate) L.push("Gate: " + clip(JSON.stringify(r.gate), 300));
  (r.differential || []).forEach((d, i) => {
    L.push((i + 1) + ". " + d.name + " [" + d.class + ", confidence " + d.confidence + "/100]" +
      (d.supporting && d.supporting.length ? "\n   supporting: " + d.supporting.join(", ") : "") +
      (d.contradictory && d.contradictory.length ? "\n   against: " + d.contradictory.join(", ") : "") +
      (d.missing && d.missing.length ? "\n   not yet known: " + d.missing.join(", ") : ""));
  });
  L.push("\n=== PATIENT (de-identified) ===");
  const bits = [];
  if (pc.age != null) bits.push("age " + pc.age); if (pc.sex) bits.push("sex " + pc.sex);
  if (bits.length) L.push(bits.join(", "));
  if (pc.findings) L.push("Findings: " + pc.findings.join(", "));
  if (pc.abnormalLabs) L.push("Abnormal labs: " + clip(JSON.stringify(pc.abnormalLabs), 600));
  if (pc.labTrends) L.push("Lab trends: " + clip(JSON.stringify(pc.labTrends), 400));
  if (pc.cultures) L.push("Cultures: " + clip(JSON.stringify(pc.cultures), 500));
  if (pc.radiologyImpressions) L.push("Radiology impressions: " + clip(JSON.stringify(pc.radiologyImpressions), 500));
  L.push("\n=== RETRIEVED STEWARDMD KNOWLEDGE (PRIMARY SOURCE — reason from THIS) ===");
  (pkg.grounding || []).forEach((g) => {
    L.push("• " + g.name + " (" + g.diseaseId + "):");
    (g.knowledge || []).forEach((c) => L.push("   [" + c.section + "] " + clip(c.text, 300) + (c.source && c.source.ref ? " (" + c.source.ref + (c.source.page ? ", " + clip(c.source.page, 60) : "") + ")" : "")));
  });
  if ((pkg.retrieved || []).length) {
    L.push("\nAdditional retrieved chunks (query-matched):");
    pkg.retrieved.forEach((c) => L.push("   [" + c.section + "] " + c.diseaseId + ": " + clip(c.text, 240) + (c.source && c.source.ref ? " (" + c.source.ref + ")" : "")));
  }
  if (pkg.treatment) {
    const t = pkg.treatment;
    L.push("\n=== TREATMENT RESOLUTION (precedence " + (t.precedence || []).join(" ▸ ") + ") ===");
    if (t.default) L.push("Default [" + (t.default.tier || "?") + "]: " + clip(t.default.line, 200) + (t.default.drugRefs && t.default.drugRefs.length ? " — drugs: " + t.default.drugRefs.join(", ") : "") + (t.default.source ? " (" + t.default.source + ")" : ""));
    (t.alternatives || []).slice(0, 4).forEach((a) => L.push("Alt [" + (a.tier || "?") + "]: " + clip(a.line, 160) + (a.drugRefs && a.drugRefs.length ? " — " + a.drugRefs.join(", ") : "")));
    if (t.overlayApplied && t.overlay) L.push("Hospital overlay (" + t.overlay.hospitalId + ", SEPARATE — does not replace the default): " + clip(JSON.stringify(t.overlay.recommendation), 400));
  }
  const rf = pkg.refs || {};
  const refLine = [];
  if (rf.drug && rf.drug.length) refLine.push("drugs(by ref): " + rf.drug.join(", "));
  if (rf.calculators && rf.calculators.length) refLine.push("calculators: " + rf.calculators.join(", "));
  if (rf.icuProtocols && rf.icuProtocols.length) refLine.push("ICU modules: " + rf.icuProtocols.join(", "));
  if (refLine.length) { L.push("\n=== REFERENCES (by reference only) ==="); L.push(refLine.join(" | ")); }
  if (pkg.question) L.push("\n=== CLINICIAN QUESTION ===\n" + clip(pkg.question, 500));
  return L.join("\n");
}

const VISION_SYS = {
  monitor: "Read this ICU monitor photo. Return ONLY JSON: {\"hr\":num,\"sbp\":num,\"dbp\":num,\"map\":num,\"rr\":num,\"spo2\":num,\"temp\":num,\"cvp\":num,\"etco2\":num}. Omit fields you cannot read with confidence. No prose.",
  labs: "Read this laboratory report photo. Return ONLY JSON with any of: {\"na\",\"k\",\"cl\",\"hco3\",\"ca\",\"mg\",\"po4\",\"glu\",\"creat\",\"urea\",\"alb\",\"wbc\",\"hb\",\"plt\",\"inr\",\"ferritin\",\"crp\",\"bili\",\"ast\",\"alt\"} as numbers. Omit unreadable fields. No prose.",
  ventilator: "Read this ventilator screen photo. Return ONLY JSON: {\"mode\":str,\"fio2\":num,\"peep\":num,\"tv\":num,\"rr\":num,\"peak\":num,\"plateau\":num}. Omit unreadable fields. No prose.",
  flowsheet: "Read this ICU flow-sheet photo. Return ONLY JSON: {\"intake24h\":num,\"output24h\":num,\"urine24h\":num,\"drains\":num}. Omit unreadable fields. No prose."
};

function parseJsonLoose(t) {
  if (!t) return null;
  var m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!authorise(request, env)) return json({ error: "unauthorised" }, 403);
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const enabled = !!env.GEMINI_API_KEY;

  if (seg === "status") return json({ enabled: enabled });
  if (!enabled) return json({ error: "ai-disabled", enabled: false }, 200);  // client falls back to rule-based

  let body = {};
  try { if (request.method === "POST") body = await request.json(); } catch (e) {}

  try {
    if (seg === "explain") {
      // Preferred: grounded RAG package (KB primary). The client assembles it from
      // the deterministic engine output + retrieved StewardMD knowledge; we forward
      // it to Gemini with the KB-primary system prompt. The whole KB never transits.
      const pkg = body.package || (body.grounding || body.reasoning ? body : null);
      if (pkg && (pkg.grounding || pkg.reasoning)) {
        const grounded = renderGroundedPrompt(pkg).slice(0, 24000);
        const text = await callGemini(env, [{ text: RAG_SYS + "\n\n" + grounded }], 1536);
        const cites = [];
        (pkg.grounding || []).forEach((g) => (g.provenance || []).forEach((p) => { if (p && cites.indexOf(p) < 0) cites.push(p); }));
        return json({ text: text, mode: "grounded", citations: cites });
      }
      // Legacy fallback: plain engine summary string (backward compatible).
      const summary = String(body.summary || "").slice(0, 6000);
      if (!summary) return json({ error: "no summary" }, 400);
      const text = await callGemini(env, [{ text: EXPLAIN_SYS + "\n\n--- ENGINE OUTPUT ---\n" + summary + (body.question ? "\n\nClinician question: " + String(body.question).slice(0, 500) : "") }]);
      return json({ text: text, mode: "summary" });
    }
    if (seg === "vision") {
      const kind = VISION_SYS[body.kind] ? body.kind : "monitor";
      let b64 = String(body.image || "");
      const mime = (b64.match(/^data:([^;]+);base64,/) || [])[1] || "image/jpeg";
      b64 = b64.replace(/^data:[^;]+;base64,/, "");
      if (!b64) return json({ error: "no image" }, 400);
      const text = await callGemini(env, [{ text: VISION_SYS[kind] }, { inline_data: { mime_type: mime, data: b64 } }]);
      const fields = parseJsonLoose(text) || {};
      return json({ kind: kind, fields: fields });
    }
    return json({ error: "unknown endpoint", seg: seg }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
