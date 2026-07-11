/* StewardMD — browser RAG wiring (client-side retrieval; grounded-package builder)
 *
 * Wires the pure kb/ai/interface.mjs (retrieve / getGroundingContext /
 * resolveTreatment) into the live app WITHOUT shipping the 12 MB chunk index:
 * the Harrison chunk corpus is DERIVED at runtime from the already-loaded
 * window.KB_ENRICHMENT (+ KB_CORE) — so retrieval is fully OFFLINE. Treatment
 * precedence (ICMR ▸ guideline ▸ Harrison) + hospital overlays come from the
 * ~550 KB window.KB_RAG bundle, lazy-loaded once when the smd_ai flag is on.
 *
 * The deterministic engine OWNS the diagnosis; this only assembles the compact,
 * de-identified, citable grounding package that the server Function forwards to
 * Gemini. The whole KB is never sent; only top-K retrieved objects are.
 *
 * Retrieval provider stays abstract: swapping interface.mjs's lexical retrieve()
 * for embeddings/Vectorize later changes nothing here or in the Function.
 *
 * window.StewardRAG.ready()          -> Promise<boolean>   (lazy init; safe to call repeatedly)
 * window.StewardRAG.buildPackage(assess, opts) -> Promise<pkg>  (opts: {question,hospitalId,caseData})
 */
(function () {
  "use strict";
  if (window.StewardRAG) return;

  var _ai = null, _initP = null, _rrf = null;
  // Hybrid retrieval (flag smd_hybrid, default OFF). Vector arm = POST /api/retrieve
  // (Workers AI embed → Vectorize). Fully degradation-safe: flag off OR empty/failed
  // vector arm → identical to lexical-only.
  function smdHybridOn() { try { return localStorage.getItem("smd_hybrid") !== "0"; } catch (e) { return true; } }   // default ON (Vectorize index live); set "0" to disable
  function hybridBase() { return window.AI_PROXY ? String(window.AI_PROXY).replace(/\/ai\b/, "/retrieve") : "/api/retrieve"; }
  function vectorDiseaseIds(query, k) {
    var headers = { "Content-Type": "application/json" };
    var p;
    try {
      var u = window.firebase && firebase.auth && firebase.auth().currentUser;
      p = (u && u.getIdToken) ? u.getIdToken().then(function (t) { if (t) headers["Authorization"] = "Bearer " + t; }).catch(function () {}) : Promise.resolve();
    } catch (e) { p = Promise.resolve(); }
    // Bounded: hybrid must never delay a MaiK answer if /api/retrieve is slow.
    var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var to = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 2500) : null;
    return p.then(function () {
      return fetch(hybridBase(), { method: "POST", headers: headers, body: JSON.stringify({ query: String(query || "").slice(0, 500), k: k || 12 }), signal: ac ? ac.signal : undefined });
    }).then(function (r) { if (to) clearTimeout(to); return r && r.ok ? r.json() : null; }).then(function (j) {
      var ids = [], seen = {};
      ((j && j.matches) || []).forEach(function (m) { var d = m && m.diseaseId; if (d && !seen[d]) { seen[d] = 1; ids.push(d); } });
      return ids;
    }).catch(function () { if (to) clearTimeout(to); return []; });   // any failure/timeout → lexical-only
  }
  var TOP_N = 5;                 // grounded diseases (engine-ranked)
  var PER_DISEASE = 8;           // max knowledge chunks per grounded disease
  var RETRIEVE_K = 8;            // lexical retrieve() top-K for the free-text query
  // sections worth grounding on, in priority order
  var PRIORITY = ["reasoning", "harrison.pearl", "harrison.differential", "harrison.redFlag",
    "redFlags", "harrison.investigation", "investigation", "harrison.pathophysiology",
    "harrison.infectionMimic", "harrison.nonInfectiousMimic", "harrison.pitfall", "overview"];

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-rag="' + src + '"]')) return res();
      var s = document.createElement("script"); s.src = src; s.defer = true; s.setAttribute("data-rag", src);
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }

  // Curated disease ALIASES (gold154): discriminative synonyms + abbreviations + classic-presentation
  // tokens folded into the retrieval name-match, so a symptom/abbreviation query locks the right
  // disease instead of a lexically-adjacent one. Kept SPECIFIC (no bare 'pain'/'fever'/'chest') to
  // avoid new mis-routes. Retrieval-only; the deterministic engine is unaffected.
  var SMD_ALIASES = {
    acs: "mi stemi nstemi angina acs coronary infarction",
    aortic_dissection: "tearing ripping interscapular dissection",
    atrial_fib: "af afib rvr palpitations arrhythmia fibrillation",
    hypoglycemia: "hypo hypoglycaemia neuroglycopenia",
    temporal_arteritis: "gca claudication amaurosis arteritis",
    angioedema_acei: "angioedema acei ramipril enalapril",
    crystal_arthritis: "gout pseudogout podagra urate tophi monoarthritis",
    dka: "dka ketoacidosis ketones ketone",
    hhs: "hhs hyperosmolar honk nonketotic",
    hyperkalemia: "hyperkalemia hyperkalaemia potassium",
    MENINGITIS: "meningitis meningococcal kernig nuchal photophobia",
    CNS_TB: "tbm tuberculous",
    organophosphate: "op organophosphate cholinergic insecticide carbamate miosis sludge",
    ischemic_stroke: "stroke cva hemiparesis thrombolysis",
    STATUS_EPILEPTICUS: "epilepticus convulsive fitting",
    seizure_epilepsy: "seizure epilepsy convulsion",
    gbs: "gbs areflexia ascending",
    FEBRILE_NEUTROPENIA: "neutropenia neutropenic",
    rheumatoid: "ra rheumatoid",
    sle_flare: "sle lupus",
    dic: "dic schistocytes coagulopathy",
    pheo: "pheochromocytoma phaeochromocytoma catecholamine",
    adrenal_crisis: "addisonian addison",
    opioid_od: "opioid naloxone",
    anaphylaxis: "anaphylaxis anaphylactic",
    SEPSIS: "sepsis qsofa sirs",
    SEPTIC_SHOCK: "vasopressor septic",
    CAP: "cap pneumonia",
    COPD_EXACERBATION: "copd aecopd",
    asthma_exac: "asthma wheeze bronchospasm"
  };
  // Derive citable chunks from loaded globals, mirroring kb/tools/build-kb-index.mjs
  // (Harrison enrichment sections + a disease overview). Offline; no 12 MB download.
  function deriveChunks() {
    var out = [];
    var EN = (window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId) || {};
    var CORE = (window.KB_CORE && (window.KB_CORE.diseases || window.KB_CORE.byId)) || null;
    var coreById = {};
    if (Array.isArray(CORE)) CORE.forEach(function (d) { coreById[d.id] = d; });
    else if (CORE) coreById = CORE;
    function push(id, name, cls, system, section, text, src) {
      if (!text) return;
      var n = 0; for (var i = out.length - 1; i >= 0 && out[i].diseaseId === id; i--) if (out[i].section === section) n++;
      out.push({ chunkId: id + "#" + section + "#" + (n + 1), diseaseId: id, diseaseName: name, class: cls, system: system,
        section: section, text: String(text).trim(), source: src, aliases: (SMD_ALIASES[id] || ""), crossLinks: [], drugRefs: [] });
    }
    Object.keys(EN).forEach(function (id) {
      // dist KB_ENRICHMENT.byId stores harrison fields FLAT on the entry; raw KB files
      // nest them under .harrison — support both.
      var e = EN[id] || {}, h = e.harrison || e, name = e.name || id, cls = e.class || null, system = e.system || null;
      var src = { ref: h.source || e.source || "Harrison 22e", page: h.pages || e.pages || null };
      var core = coreById[id];
      if (core && core.name) push(id, name, cls, system, "overview", (core.name + " (" + (cls || "") + ") — " + (system || "")), src);
      if (core && core.matching && core.matching.reasoningTemplate) push(id, name, cls, system, "reasoning", core.matching.reasoningTemplate, src);
      (h.clinicalPearls || []).forEach(function (t) { push(id, name, cls, system, "harrison.pearl", t, src); });
      if (h.pathophysiology) push(id, name, cls, system, "harrison.pathophysiology", h.pathophysiology, src);
      (h.additionalDifferentials || []).forEach(function (t) { push(id, name, cls, system, "harrison.differential", t, src); });
      (h.infectionMimics || []).forEach(function (t) { push(id, name, cls, system, "harrison.infectionMimic", t, src); });
      (h.nonInfectiousMimics || []).forEach(function (t) { push(id, name, cls, system, "harrison.nonInfectiousMimic", t, src); });
      (h.additionalInvestigations || []).forEach(function (t) { push(id, name, cls, system, "harrison.investigation", t, src); });
      (h.redFlags || []).forEach(function (t) { push(id, name, cls, system, "harrison.redFlag", t, src); });
      (h.pitfalls || []).forEach(function (t) { push(id, name, cls, system, "harrison.pitfall", t, src); });
      if (core && (core.redFlags || []).length) push(id, name, cls, system, "redFlags", "Red flags: " + core.redFlags.join("; "), src);
      (core && core.investigations || []).forEach(function (iv) { push(id, name, cls, system, "investigation", (iv.test || "") + (iv.why ? " — " + iv.why : ""), src); });

      // ── MANAGEMENT / TREATMENT chunks (gold122) ──────────────────────────
      // Previously NO management content was indexed, so "how to treat X" could only
      // retrieve pathophysiology/pearls (root cause of the organophosphate failure).
      // Index the already-curated StewardMD management content so treatment queries
      // retrieve treatment. This is disease-level reference content (no patient data,
      // no new clinical claims) — RAG privacy/de-identification rules are unchanged.
      var mgmtSrc = { ref: "StewardMD management protocol", page: null };
      var dm = (window.DX_MGMT && window.DX_MGMT[id]) || null;   // non-infective management (curated)
      if (dm && dm.tx && dm.tx.length) push(id, name, cls, system, "management", "Management / how to treat " + name + ": " + dm.tx.join(" "), mgmtSrc);
      if (dm && dm.ix && dm.ix.length) push(id, name, cls, system, "management.investigation", "Investigations & monitoring: " + dm.ix.join("; "), mgmtSrc);
      var tx = (window.KB_RAG && window.KB_RAG.treatments && window.KB_RAG.treatments[id]) || null;   // infective + NI treatment resolution
      if (tx) {
        var drugSrc = { ref: "StewardMD Drug Index / protocol", page: null };
        (tx.recommendations || []).forEach(function (r) {
          var drugs = (r.drugRefs || []).map(function (d) { return (d.composition || d.regimenLabel || "") + (d.why ? " — " + d.why : ""); }).filter(Boolean);
          if (drugs.length) push(id, name, cls, system, "management.treatment", "Treatment (" + (r.line || "empiric") + ") for " + name + ": " + drugs.join("; "), drugSrc);
          if (r.steps && r.steps.length) push(id, name, cls, system, "management", "Management steps (" + (r.line || "management") + ") for " + name + ": " + r.steps.join(" "), mgmtSrc);
        });
        var stw = tx.stewardship || {};
        if (stw.framework && stw.framework.length) push(id, name, cls, system, "management.stewardship", "Stewardship principles for " + name + ": " + stw.framework.join(" "), mgmtSrc);
        if (stw.deescalation) push(id, name, cls, system, "management.stewardship", "De-escalation for " + name + ": " + stw.deescalation, mgmtSrc);
      }
    });

    // ── DX_MGMT-only canonical objects (gold122) ─────────────────────────────
    // Some high-risk topics (e.g. dedicated toxicology entries) live only in
    // DX_MGMT with no enrichment record — the loop above would skip them, so they
    // were unretrievable. Index every DX_MGMT entry not already covered, using its
    // name + synonyms so "how to treat X" (and synonym queries) find its management.
    var DM_ALL = window.DX_MGMT || {};
    var covered = {}; out.forEach(function (c) { covered[c.diseaseId] = 1; });
    Object.keys(DM_ALL).forEach(function (id) {
      if (covered[id]) return;
      var m = DM_ALL[id] || {}, nm = m.name || id.replace(/_/g, " ");
      var mgmtSrc2 = { ref: m.src || "StewardMD management protocol", page: null };
      var synText = (m.syn && m.syn.length) ? " (also: " + m.syn.join(", ") + ")" : "";
      push(id, nm, m.class || null, m.system || null, "overview", nm + synText + (m.dx ? " — " + m.dx : ""), mgmtSrc2);
      if (m.tx && m.tx.length) push(id, nm, m.class || null, m.system || null, "management", "Management / how to treat " + nm + ": " + m.tx.join(" "), mgmtSrc2);
      if (m.ix && m.ix.length) push(id, nm, m.class || null, m.system || null, "management.investigation", "Investigations & monitoring: " + m.ix.join("; "), mgmtSrc2);
    });
    return out;
  }

  function init() {
    if (_initP) return _initP;
    _initP = (function () {
      // KB_CORE/KB_ENRICHMENT are lazy-loaded after first paint (see index.html); wait for them.
      var kbReady = window.SMD_KB_READY || Promise.resolve();
      return kbReady.then(function () {
        return !window.KB_RAG ? loadScript("/kb/dist/kb.rag.js?v=gold117") : Promise.resolve();
      }).then(function () {
        return import("/kb/ai/interface.mjs?v=gold154");
      }).then(function (mod) {
        var CORE = (window.KB_CORE && (window.KB_CORE.diseases || window.KB_CORE.byId)) || [];
        var diseases = {}; (Array.isArray(CORE) ? CORE : Object.values(CORE)).forEach(function (d) { if (d && d.id) diseases[d.id] = d; });
        var store = {
          diseases: diseases,
          treatments: (window.KB_RAG && window.KB_RAG.treatments) || {},
          policies: (window.KB_RAG && window.KB_RAG.policies) || {},
          index: { chunks: deriveChunks() }
        };
        _ai = mod.createStewardAI(store, { flags: { ai: true, ragRetrieval: true } });
        _rrf = mod.rrf || null;   // hybrid fusion (available when smd_hybrid on)
        return true;
      }).catch(function (e) { _ai = null; return false; });
    })();
    return _initP;
  }

  function lbl(k) { try { return (window.SMD_REASON && SMD_REASON.label) ? SMD_REASON.label(k) : k; } catch (e) { return k; } }

  function trimGrounding(g) {
    if (!g) return null;
    var byPri = g.knowledge.slice().sort(function (a, b) {
      var ia = PRIORITY.indexOf(a.section), ib = PRIORITY.indexOf(b.section);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).slice(0, PER_DISEASE);
    return { diseaseId: g.diseaseId, name: g.name, class: g.class,
      knowledge: byPri.map(function (c) { return { section: c.section, text: c.text, source: c.source }; }),
      provenance: g.provenance, drugRefs: (g.drugRefs || []).slice(0, 12) };
  }

  // Assemble the compact, de-identified, citable grounding package. Only the
  // allowed fields ever leave the browser (no identifiers, no whole reports).
  function buildPackage(assess, opts) {
    opts = opts || {};
    return init().then(async function (ok) {
      if (!ok || !_ai) return null;
      var hospitalId = opts.hospitalId || "GIMSR";
      var cd = opts.caseData || {};
      var cands = [].concat(assess.infectious || [], assess.nonInfectious || [])
        .sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
      var top = cands.slice(0, TOP_N);
      var lead = top[0];
      var findingLabels = (cd.findings || []).map(String);

      var query = findingLabels.concat([opts.question || ""], top.map(function (c) { return c.name; })).join(" ");
      var retrieved = _ai.retrieve(query, RETRIEVE_K);

      // Hybrid retrieval (flag smd_hybrid) — only for a standalone knowledge question
      // (no case differential), where the topicMatch gate keys off the nearest candidate.
      // Fuse the lexical disease order with the Vectorize semantic arm (RRF). Any failure
      // or empty vector arm leaves hybridIds null → candid selection is unchanged.
      var hybridIds = null;
      if (!top.length && smdHybridOn() && _rrf && (opts.question || "").trim()) {
        var lexIds = []; retrieved.forEach(function (r) { if (r && r.diseaseId && lexIds.indexOf(r.diseaseId) < 0) lexIds.push(r.diseaseId); });
        var vecIds = await vectorDiseaseIds(opts.question, RETRIEVE_K);
        if (vecIds.length) hybridIds = _rrf(lexIds, vecIds);
      }

      var grounding = top.map(function (c) { return trimGrounding(_ai.getGroundingContext(c.id)); }).filter(Boolean);

      var treatment = lead ? _ai.resolveTreatment(lead.id, hospitalId) : null;

      // ICU / calculator / drug refs from the disease objects (by reference only)
      var coreArr = (window.KB_CORE && window.KB_CORE.diseases) || [];
      var coreById = {}; (Array.isArray(coreArr) ? coreArr : Object.keys(coreArr).map(function (k) { return coreArr[k]; })).forEach(function (d) { if (d && d.id) coreById[d.id] = d; });
      var refs = { drug: [], calculators: [], icuProtocols: [], stewardship: [] };
      var seenDrug = {};
      function addDrug(d) { if (d && !seenDrug[d]) { seenDrug[d] = 1; refs.drug.push(d); } }
      grounding.forEach(function (g) { (g.drugRefs || []).forEach(addDrug); });
      top.forEach(function (c) {
        var d = coreById[c.id]; if (!d) return;
        (d.drugRefs || []).forEach(function (x) { addDrug(typeof x === "string" ? x : (x && (x.composition || x.name))); });
        (d.calculatorRefs || []).forEach(function (x) { if (refs.calculators.indexOf(x) < 0) refs.calculators.push(x); });
        (d.icuModuleRefs || []).forEach(function (x) { if (refs.icuProtocols.indexOf(x) < 0) refs.icuProtocols.push(x); });
      });
      // drug references from the resolved treatment (by reference only)
      if (treatment && treatment.default) (treatment.default.drugRefs || []).forEach(addDrug);
      if (treatment) (treatment.alternatives || []).forEach(function (a) { (a.drugRefs || []).forEach(addDrug); });
      if (treatment && treatment.diseaseId) {
        var t = (window.KB_RAG && window.KB_RAG.treatments && window.KB_RAG.treatments[treatment.diseaseId]) || null;
        if (t && t.stewardship) refs.stewardship = Array.isArray(t.stewardship) ? t.stewardship.slice(0, 6) : [t.stewardship];
      }

      // de-identified case (only the allowed fields; caller supplies caseData)
      var patientCase = {};
      if (cd.age != null) patientCase.age = cd.age;
      if (cd.sex) patientCase.sex = cd.sex;
      if (findingLabels.length) patientCase.findings = findingLabels;
      if (cd.abnormalLabs) patientCase.abnormalLabs = cd.abnormalLabs;
      if (cd.labTrends) patientCase.labTrends = cd.labTrends;
      if (cd.cultures) patientCase.cultures = cd.cultures;
      if (cd.radiologyImpressions) patientCase.radiologyImpressions = cd.radiologyImpressions;

      var reasoning = {
        gate: assess.gate || null,
        dominantSystem: assess.dominantSystem || null,
        differential: top.map(function (c) {
          return { id: c.id, name: c.name, class: (c.inf ? "infective" : "non_infective"), confidence: c.confidence,
            supporting: (c.supporting || []).map(lbl).slice(0, 8),
            contradictory: (c.contradictory || []).map(lbl).slice(0, 6),
            missing: (c.missing || []).map(lbl).slice(0, 6) };
        })
      };

      // ---- knowledge-question relevance (gold197) ----------------------------------------
      // When there is NO case-derived candidate (a standalone knowledge question), the grounding
      // must come from the QUESTION's own topic, not from an empty/ambient differential. And if
      // the question's distinctive term isn't actually in the KB (e.g. "paraquat" → the nearest
      // lexical hit is paracetamol/methanol poisoning), we must NOT ground on that different
      // disease — surface topicMatch.matched=false so the caller caveats instead of confidently
      // describing the wrong condition.
      var topicMatch = null;
      if (!top.length && (opts.question || "").trim()) {
        var GENERIC_TOPIC = { treatment:1,treat:1,treating:1,management:1,manage:1,managing:1,therapy:1,approach:1,protocol:1,regimen:1,empiric:1,initial:1,signs:1,sign:1,symptoms:1,symptom:1,diagnosis:1,diagnose:1,poisoning:1,poison:1,toxicity:1,toxic:1,overdose:1,syndrome:1,disease:1,disorder:1,infection:1,fever:1,dose:1,dosing:1,drug:1,drugs:1,acute:1,chronic:1,severe:1,about:1,information:1,info:1,what:1,which:1,when:1,how:1,why:1,does:1,with:1,from:1,the:1,and:1,for:1,of:1,
          // conversational fillers/lead-ins (4+ chars) — must NOT count as the topic, else
          // "tell"/"hello"/"please" break the exact-match gate ("no entry for tell diabetic ketoacidosis").
          tell:1,tells:1,told:1,telling:1,hello:1,hey:1,hi:1,please:1,kindly:1,could:1,would:1,should:1,shall:1,can:1,you:1,your:1,give:1,gives:1,giving:1,want:1,wants:1,need:1,needs:1,know:1,knows:1,explain:1,explaining:1,describe:1,help:1,helps:1,share:1,provide:1,list:1,discuss:1,okay:1,sure:1,here:1,there:1,also:1,some:1,more:1,this:1,that:1,these:1,those:1,understand:1,regarding:1,concerning:1,briefly:1,quickly:1,detail:1,details:1,
          // more conversational lead-ins (verbs/nouns that carry NO clinical topic) — must be
          // dropped so "speak about X", "talk me through X", "read out X" ground on X, not on "speak X".
          speak:1,speaks:1,speaking:1,spoke:1,talk:1,talks:1,talking:1,talked:1,read:1,reads:1,reading:1,discusses:1,discussed:1,discussing:1,teach:1,teaches:1,teaching:1,taught:1,learn:1,learns:1,learning:1,study:1,studying:1,cover:1,covers:1,covering:1,define:1,defines:1,defining:1,mention:1,mentions:1,note:1,notes:1,overview:1,summary:1,summarise:1,summarize:1,summarised:1,summarized:1,lecture:1,walk:1,through:1,everything:1,anything:1,something:1,thing:1,things:1,stuff:1,aspect:1,aspects:1,topic:1,topics:1,brief:1,briefing:1,elaborate:1,
          // demographic / qualifier / route / dose framing words (gold-next): they describe HOW a
          // topic is framed, not the topic itself. Leaving them "distinctive" made the relevance
          // gate refuse valid in-KB questions ("… in an ADULT", "CONFIRM … ORAL … FIRST-LINE …").
          // NOTE: clinically-discriminating qualifiers (renal, hepatic, pregnant, resistant, mrsa,
          // paediatric-specific dosing intent, etc.) are deliberately NOT listed here.
          adult:1,adults:1,child:1,children:1,childhood:1,elderly:1,geriatric:1,male:1,female:1,
          man:1,woman:1,men:1,women:1,patient:1,patients:1,person:1,people:1,someone:1,
          year:1,years:1,month:1,months:1,week:1,weeks:1,aged:1,age:1,ages:1,old:1,young:1,
          adolescent:1,adolescents:1,baby:1,babies:1,
          confirm:1,confirms:1,confirmed:1,confirming:1,verify:1,verifies:1,verified:1,verifying:1,
          correct:1,incorrect:1,wrong:1,right:1,true:1,false:1,really:1,actually:1,indeed:1,
          first:1,second:1,third:1,line:1,firstline:1,oral:1,orally:1,intravenous:1,parenteral:1,
          dosage:1,duration:1,frequency:1,route:1,routes:1 };
        var distinctive = String(opts.question).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (t) { return t.length >= 4 && !GENERIC_TOPIC[t]; });
        var candId = (hybridIds && hybridIds[0]) || (retrieved[0] && retrieved[0].diseaseId) || null;
        var candGc = candId ? trimGrounding(_ai.getGroundingContext(candId)) : null;
        var hay = candGc ? (String(candId) + " " + (candGc.name || "") + " " + JSON.stringify(candGc)).toLowerCase() : "";
        // Coverage-based relevance (gold-next) — replaces the brittle all-or-nothing every() gate.
        // The old gate required EVERY distinctive token to appear in the nearest topic, so any real
        // qualifier the KB chunk didn't contain verbatim ("in an adult", "oral", a drug name)
        // refused an answerable question. Three tiers instead:
        //   • CONFIDENT  → most distinctive tokens hit, or a token names the topic → answer directly
        //   • ASSUME     → partial overlap → answer the NEAREST topic under a STATED assumption, and
        //                  the caller offers one-tap refine chips (mirrors UpToDate Expert AI)
        //   • NONE       → zero overlap (topic genuinely absent) → do NOT describe a different
        //                  condition; caller offers opt-in web research (paraquat-vs-paracetamol case)
        var hit = distinctive.filter(function (t) { return hay.indexOf(t) >= 0; });
        var coverage = distinctive.length ? hit.length / distinctive.length : 1;
        // a distinctive token that NAMES the topic is a strong confident signal on its own
        var nameHit = false, nameToksAll = false;
        if (candGc && candGc.name) {
          var nm = String(candGc.name).toLowerCase();
          nameHit = distinctive.some(function (t) { return t.length >= 5 && nm.indexOf(t) >= 0; });
          // question contains ALL of the topic's own significant name tokens (typo/lead-in tolerant)
          var qHay = " " + String(opts.question).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
          var nameToks = nm.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (t) { return t.length >= 4 && !GENERIC_TOPIC[t]; });
          nameToksAll = nameToks.length > 0 && nameToks.every(function (t) { return qHay.indexOf(" " + t + " ") >= 0; });
        }
        var confident = !!candGc && (distinctive.length === 0 || coverage >= 0.6 || nameHit || nameToksAll);
        var missing = distinctive.filter(function (t) { return hay.indexOf(t) < 0; });
        if (confident) {
          grounding = [candGc];
          if (!lead) lead = { id: candId, name: candGc.name || candId };
          if (!treatment && _ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(candId, hospitalId); } catch (e) {} }
          topicMatch = { matched: true, topic: distinctive.join(" "), grounded: candGc.name || candId };
        } else if (candGc && hit.length > 0) {
          // partial overlap → keep grounding on the nearest topic so nothing off-KB is invented,
          // but flag it as an ASSUMPTION for the caller to state + let the clinician refine.
          grounding = [candGc];
          if (!lead) lead = { id: candId, name: candGc.name || candId };
          if (!treatment && _ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(candId, hospitalId); } catch (e) {} }
          topicMatch = { matched: false, mode: "assume", topic: distinctive.join(" ") || String(opts.question).trim(),
            nearest: candGc.name || candId, assume: { id: candId, name: candGc.name || candId },
            coverage: Math.round(coverage * 100) / 100, missing: missing };
        } else {
          // topic genuinely not in the KB → drop the near-miss grounding so nothing wrong is described
          grounding = []; lead = null; treatment = null; retrieved = [];
          topicMatch = { matched: false, mode: "none", topic: distinctive.join(" ") || String(opts.question).trim(), nearest: (candGc && candGc.name) || candId || null };
        }
      }

      return {
        schema: "steward-rag-1",
        hospitalId: hospitalId,
        patientCase: patientCase,
        reasoning: reasoning,            // deterministic engine output — AUTHORITATIVE diagnosis
        grounding: grounding,            // retrieved Harrison KB (per top disease, cited)
        retrieved: retrieved,            // lexical top-K chunks for the query (cited)
        treatment: treatment,            // ICMR ▸ guideline ▸ Harrison + hospital overlay
        refs: refs,                      // drug/calculator/ICU/stewardship — by reference only
        topicMatch: topicMatch,          // knowledge-Q relevance: null=case/NA, {matched:false}=topic not in KB
        question: opts.question || ""
      };
    });
  }

  window.StewardRAG = { ready: init, buildPackage: buildPackage, _deriveChunks: deriveChunks };
})();
