/* StewardMD — AI interface layer + evidence engine (Phase 4, NO AI INTEGRATED)
 *
 * This is the SEAM a future Gemini "explainer" plugs into. It integrates NO AI
 * and performs NO network calls. The application is FULLY FUNCTIONAL with AI
 * disabled: explain() returns the existing rule-based reasoning verbatim, and
 * retrieve() is a deterministic lexical search over the RAG index (a fallback
 * that needs no embeddings). When a future build sets flags.ai=true AND injects
 * a provider, explain() would route the grounded prompt to that provider — but
 * the decision is always computed offline first and the provider only explains
 * an already-decided output (post-validated; works with AI off).
 *
 * Pure + dependency-free + side-effect-free. Factory takes a KB "store" so it is
 * testable in node and usable in the browser (a thin shim would build the store
 * from window.KB_CORE/KB_CLINICAL/kb.index.json — that wiring is intentionally
 * deferred until the UI/flag review; nothing here is loaded by index.html yet).
 *
 *   import { createStewardAI } from "./interface.mjs";
 *   const ai = createStewardAI(store, { flags });
 */

export const DEFAULT_FLAGS = Object.freeze({
  ai: false,            // master AI switch — OFF. App must work fully with this false.
  gemini: false,        // Gemini provider wired — OFF (no provider, no network).
  ragRetrieval: true,   // lexical retrieve() works with AI off (no embeddings needed).
  embeddings: false,    // vector index present — OFF until the embedding step runs.
  professional: false,  // future Professional-subscription gate — OFF.
});

/* Reciprocal Rank Fusion — merge two ranked id lists (e.g. lexical + vector arms)
 * into one. score(id) = Σ over lists containing id of 1/(K + rank0based). Ties keep
 * first-appearance order (A before B) via a stable sort. An empty second list makes
 * the result identical to the first — the hybrid-retrieval no-regression guarantee. */
export function rrf(a, b, K) {
  K = (typeof K === "number" && K > 0) ? K : 60;
  const score = new Map(), order = [];
  const add = (list) => (Array.isArray(list) ? list : []).forEach((id, i) => {
    if (id == null) return;
    if (!score.has(id)) { score.set(id, 0); order.push(id); }
    score.set(id, score.get(id) + 1 / (K + i));
  });
  add(a); add(b);
  return order.slice().sort((x, y) => score.get(y) - score.get(x));  // stable → ties keep insertion order
}

const STOP = new Set("the a an of to in is are with and or for as on at by from this that without within into be can may not no".split(" "));
function tokenize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export function createStewardAI(store, opts) {
  store = store || {};
  const flags = Object.assign({}, DEFAULT_FLAGS, (opts && opts.flags) || {});
  const provider = (opts && opts.provider) || null;   // future Gemini provider; null here
  const diseases = store.diseases || {};               // id -> disease object
  const treatments = store.treatments || {};           // id -> treatment object
  const policies = store.policies || {};               // hospitalId -> policy object
  const chunks = (store.index && store.index.chunks) || store.chunks || [];

  // precompute per-chunk token bags for deterministic lexical retrieval.
  // nameToks are tracked separately so a query that NAMES a disease ranks that
  // disease's own chunks above chunks that merely mention it (e.g. a differential).
  const bags = chunks.map((c) => ({ c, toks: tokenize(c.text + " " + c.diseaseName + " " + c.section),
    nameToks: new Set(tokenize(c.diseaseName + " " + c.diseaseId + " " + (c.aliases || ""))) }));
  const df = {};
  bags.forEach((b) => { const seen = new Set(); b.toks.forEach((t) => { if (!seen.has(t)) { seen.add(t); df[t] = (df[t] || 0) + 1; } }); });
  const N = bags.length || 1;
  const idf = (t) => Math.log(1 + N / (1 + (df[t] || 0)));

  function isAIEnabled() { return !!flags.ai && !!provider; }

  /* RAG retrieval — deterministic tf-idf lexical scorer (pre-embedding fallback). */
  function retrieve(query, k) {
    k = k || 8;
    const q = tokenize(query);
    if (!q.length) return [];
    // Treatment-intent detection (gold122): for "how to treat / manage X" queries,
    // float management/treatment chunks above pathophysiology WITHIN the named disease.
    // Name-match stays the dominant sort key, so the correct disease still leads.
    const treatIntent = /\b(treat|treatment|treating|manage|management|managing|therapy|therapeutic|antidote|regimen|empiric|initial|approach|protocol|first[\s-]?line|dose|dosing|administer)\b/i.test(query) || /how\s+to/i.test(query);
    // Capability-intent detection (gold153): float the section the clinician actually asked for
    // (red flags / investigations / differential) WITHIN the named disease — mirrors treatIntent.
    // Name-match stays the dominant sort key, so the correct disease still leads.
    const redFlagIntent = /\b(red[\s-]?flags?|danger signs?|warning signs?|when to (escalate|refer|admit|worry)|do ?n[o']?t miss|not to miss|alarm|life[\s-]?threat)\b/i.test(query);
    const ixIntent = /\b(investigat\w*|work[\s-]?up|what tests?|which tests?|what to order|labs?|imaging|\bix\b|bloods?|diagnostic (test|work))\b/i.test(query);
    const ddxIntent = /\b(differential\w*|\bddx\b|d\/dx|versus|\bvs\b|distinguish|tell (them )?apart|differentiate|mimics?)\b/i.test(query);
    const qset = {}; q.forEach((t) => (qset[t] = (qset[t] || 0) + 1));
    const scored = bags.map((b) => {
      const tf = {}; b.toks.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      let s = 0, nameHits = 0;
      for (const t in qset) {
        if (tf[t]) s += qset[t] * (1 + Math.log(tf[t])) * idf(t);
        if (b.nameToks.has(t)) nameHits++;           // query token naming this disease
      }
      if (s > 0) {
        const sec = String(b.c.section || "");
        if (treatIntent) {
          if (/^management/.test(sec)) s *= 2.4;                          // treatment/how-to chunks
          else if (/(redflag|investigation|pitfall)/i.test(sec)) s *= 1.3; // safety-relevant
          else if (/(pathophysiolog|overview|reasoning|differential|mimic)/i.test(sec)) s *= 0.6; // demote non-management
        }
        if (redFlagIntent && /redflag/i.test(sec)) s *= 2.4;               // "red flags in X"
        if (ixIntent && /investigation/i.test(sec)) s *= 2.4;             // "what to order for X"
        if (ddxIntent && /(differential|mimic)/i.test(sec)) s *= 2.4;     // "X vs Y" / "ddx"
      }
      return { b, s, nameHits };
    }).filter((x) => x.s > 0);
    // name match is the DOMINANT key: a query that names a disease ranks that
    // disease's own chunks above chunks that merely mention it; tf-idf orders within.
    scored.sort((a, x) => x.nameHits - a.nameHits || x.s - a.s || (a.b.c.chunkId < x.b.c.chunkId ? -1 : 1));
    return scored.slice(0, k).map((x) => ({
      chunkId: x.b.c.chunkId, diseaseId: x.b.c.diseaseId, section: x.b.c.section,
      text: x.b.c.text, source: x.b.c.source, score: Math.round(x.s * 1000) / 1000,
    }));
  }

  /* Grounding context for a disease — what a future Gemini prompt is grounded on.
   * Returns ONLY KB-sourced, page-cited material (never free text), so any AI
   * output can be post-validated against it. */
  function getGroundingContext(diseaseId) {
    const d = diseases[diseaseId];
    const cs = chunks.filter((c) => c.diseaseId === diseaseId);
    if (!d && !cs.length) return null;
    return {
      diseaseId,
      name: (d && d.name) || (cs[0] && cs[0].diseaseName) || diseaseId,
      class: (d && d.class) || (cs[0] && cs[0].class) || null,
      knowledge: cs.map((c) => ({ section: c.section, text: c.text, source: c.source })),
      provenance: [...new Set(cs.map((c) => c.source && c.source.ref).filter(Boolean))],
      crossLinks: [...new Set(cs.flatMap((c) => c.crossLinks || []))],
      drugRefs: [...new Set(cs.flatMap((c) => c.drugRefs || []))],
    };
  }

  /* EVIDENCE ENGINE — resolve the default treatment by precedence
   * (ICMR ▸ international guideline ▸ Harrison fallback), and surface the
   * optional hospital overlay SEPARATELY (it never silently replaces the
   * default). Pharmacology is referenced by composition only. */
  function resolveTreatment(diseaseId, hospitalId) {
    const t = treatments[diseaseId];
    if (!t) return null;
    const precedence = t.precedence || ["icmr", "guideline", "harrison"];
    const recs = t.recommendations || [];
    const rank = (tier) => { const i = precedence.indexOf(tier); return i < 0 ? 99 : i; };
    const byPref = recs.slice().sort((a, b) => rank(a.tier) - rank(b.tier));
    const def = byPref[0] || null;
    // Preserve the STRUCTURED dosing (dose/route/freq/why), not just the drug name. Flattening a
    // rich drugRef {composition,dose,…} down to x.composition dropped every figure, so the grounding
    // package carried "atropine, pralidoxime" with no numbers — the model then described management
    // and re-OFFERED the dose it never received. drugRefs stays a string[] of names for backward
    // compatibility (server join + addDrug); the numbers ride alongside in `dosing`.
    const dosingOf = (rec) => (rec.drugRefs || []).map((x) => ({
      drug: x.composition || null, label: x.regimenLabel || null,
      dose: x.dose || null, route: x.route || null, freq: x.freq || null,
      duration: x.duration || null, coverage: x.coverage || null, why: x.why || null,
    })).filter((d) => d.drug && (d.dose || d.route || d.freq || d.duration));
    const out = {
      diseaseId, precedence,
      default: def ? { tier: def.tier || null, line: def.line || null, source: (def.evidence && def.evidence.ref) || null,
        regimenLabel: def.regimenLabel || null, steps: def.steps || null,
        drugRefs: (def.drugRefs || []).map((x) => x.composition).filter(Boolean),
        dosing: dosingOf(def) } : null,
      alternatives: recs.filter((r) => r !== def).map((r) => ({ tier: r.tier || null, line: r.line || null,
        drugRefs: (r.drugRefs || []).map((x) => x.composition).filter(Boolean), dosing: dosingOf(r) })),
      overlay: null, overlayApplied: false, conflicts: [],
    };
    if (hospitalId && policies[hospitalId]) {
      const pol = policies[hospitalId];
      const entry = pol.diseases && pol.diseases[diseaseId];
      if (entry && entry.entry) {
        out.overlay = { hospitalId, recommendation: entry.entry };
        out.overlayApplied = true;
        // a real difference between overlay and default is recorded as a conflict (both kept)
        out.conflicts.push({ type: "hospital_overlay", note: "Hospital overlay present — clinician-selected, does not replace national/guideline default by default." });
      }
    }
    return out;
  }

  /* The Gemini SEAM. Decision is computed offline FIRST; this only explains an
   * already-decided output. With AI disabled (default) it returns the existing
   * rule-based reasoning verbatim — so the app is fully functional without AI.
   * No network is ever called from here; a provider, if injected and enabled,
   * receives the grounding context and must be post-validated by the caller. */
  function explain(payload) {
    payload = payload || {};
    const ruleBased = payload.ruleBasedReason || (payload.diseaseId ? summarize(getGroundingContext(payload.diseaseId)) : "");
    if (!isAIEnabled()) {
      return { mode: "rule-based", aiEnabled: false, text: ruleBased, grounding: payload.diseaseId ? getGroundingContext(payload.diseaseId) : null };
    }
    // AI path is intentionally not implemented here (no provider/network in this phase).
    // A future build injects a post-validated provider; until then we fail safe to rules.
    return { mode: "rule-based-fallback", aiEnabled: true, text: ruleBased, note: "provider explain not implemented in this phase; returned rule-based output" };
  }
  function summarize(ctx) {
    if (!ctx) return "";
    const reason = ctx.knowledge.find((c) => c.section === "reasoning");
    return reason ? reason.text : (ctx.knowledge[0] ? ctx.knowledge[0].text : "");
  }

  return {
    version: "p4-ai-iface-1", flags, isAIEnabled,
    retrieve, getGroundingContext, resolveTreatment, explain,
    stats: { diseases: Object.keys(diseases).length, treatments: Object.keys(treatments).length, policies: Object.keys(policies).length, chunks: chunks.length },
  };
}

/* node convenience loader (tests / CLI). Browser builds a store from window.KB_*. */
export async function loadStoreFromDisk(root) {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const rd = (dir) => {
    const out = {};
    if (!existsSync(dir)) return out;
    readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f) => { out[f.replace(".json", "")] = JSON.parse(readFileSync(join(dir, f), "utf8")); });
    return out;
  };
  const diseases = rd(join(root, "kb", "diseases"));
  const treatments = rd(join(root, "kb", "treatments"));
  const policiesRaw = rd(join(root, "kb", "policies"));
  const policies = {}; for (const k in policiesRaw) policies[policiesRaw[k].hospitalId || k] = policiesRaw[k];
  const idxPath = join(root, "kb", "dist", "kb.index.json");
  const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { chunks: [] };
  return { diseases, treatments, policies, index };
}
