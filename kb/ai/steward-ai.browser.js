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
  var _tokIdx = null, _uniqToks = null;   // instant nearest-KB resolver index (built in init)
  // Hybrid retrieval (flag smd_hybrid, default ON since the Vectorize index went live; "0" turns it
  // off). Vector arm = POST /api/retrieve (Workers AI embed → Vectorize). Fully degradation-safe:
  // flag off OR empty/failed vector arm → identical to lexical-only.
  //
  // The vector arm sends the QUESTION to a server-side AI embedder under the doctor's token, so it is
  // a cloud AI call and obeys the engine policy (audit T07, 2026-09-25): in Local or KB-only mode
  // (SMD_MAIK_ENGINE.cloudAllowed() false) it never runs. No engine module (a harness) = unchanged.
  function vectorAllowed() {
    try { var E = window.SMD_MAIK_ENGINE; return !(E && typeof E.cloudAllowed === "function") || !!E.cloudAllowed(); } catch (e) { return false; }
  }
  function smdHybridOn() {
    if (!vectorAllowed()) return false;
    try { return localStorage.getItem("smd_hybrid") !== "0"; } catch (e) { return true; }
  }
  function hybridBase() { return window.AI_PROXY ? String(window.AI_PROXY).replace(/\/ai\b/, "/retrieve") : "/api/retrieve"; }
  var _vecSections = {};   // diseaseId -> the section the vector arm matched (chunk-level), used to bias grounding
  function vectorDiseaseIds(query, k) {
    _vecSections = {};
    if (!vectorAllowed()) return Promise.resolve([]);   // the choke point: no caller can bypass the policy
    var headers = { "Content-Type": "application/json" };
    var p;
    try {
      var u = window.firebase && firebase.auth && firebase.auth().currentUser;
      p = (u && u.getIdToken) ? u.getIdToken().then(function (t) { if (t) headers["Authorization"] = "Bearer " + t; }).catch(function () {}) : Promise.resolve();
    } catch (e) { p = Promise.resolve(); }
    // Bounded: hybrid must never delay a MaiK answer if /api/retrieve is slow.
    var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var to = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 2500) : null;
    var _q = p.then(function () {
      return fetch(hybridBase(), { method: "POST", headers: headers, body: JSON.stringify({ query: String(query || "").slice(0, 500), k: k || 12 }), signal: ac ? ac.signal : undefined });
    }).then(function (r) { if (to) clearTimeout(to); return r && r.ok ? r.json() : null; }).then(function (j) {
      // Noise-reduction: AGGREGATE chunk matches per disease + apply a score floor, then rank by the
      // strongest signal with a small bonus for multiple matching chunks. A disease with several
      // relevant chunks beats a single stray fragment from an unrelated disease (chunk-level noise).
      var agg = {};
      ((j && j.matches) || []).forEach(function (m) {
        if (!m || !m.diseaseId) return;
        var s = (typeof m.score === "number") ? m.score : 0;
        if (s < 0.45) return;                                  // drop weak/noisy matches
        var d = m.diseaseId;
        if (!agg[d]) agg[d] = { n: 0, max: 0, sec: null };
        agg[d].n++; if (s > agg[d].max) { agg[d].max = s; if (m.section) agg[d].sec = m.section; }
        else if (m.section && !agg[d].sec) agg[d].sec = m.section;
      });
      var ids = Object.keys(agg).sort(function (a, b) {
        return (agg[b].max + 0.04 * (agg[b].n - 1)) - (agg[a].max + 0.04 * (agg[a].n - 1));   // score + small multi-chunk bonus
      });
      ids.forEach(function (d) { if (agg[d].sec) _vecSections[d] = agg[d].sec; });   // vector-matched section per disease (for grounding bias)
      return ids;
    }).catch(function () { if (to) clearTimeout(to); return []; });   // any failure/timeout → lexical-only
    // Real wall-clock bound: on the native app CapacitorHttp ignores AbortController, so the abort
    // above can't fire — race a hard 3s timer so a stalled /api/retrieve never blocks the answer.
    return Promise.race([_q, new Promise(function (res) { setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} res([]); }, 3000); })]);
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
    acs: "mi stemi nstemi angina acs coronary infarction heart attack heartattack",
    acute_infectious_diarrheal_diseases_and: "diarrhea diarrhoea loose motion loose motions loose stool loose stools gastroenteritis dysentery watery stools",
    // C. difficile is indexed under its 2016 genus rename "Clostridioides"; clinicians still
    // type the old genus "Clostridium", the abbreviations "c diff"/"cdiff", and the classic
    // presentation "pseudomembranous colitis" — none of which match "Clostridioides" in the body
    // text, so without these aliases the query mis-routed to web / to a wrong colitis entry.
    C_DIFF: "clostridium clostridioides difficile cdiff diff pseudomembranous colitis",
    // Upper GI bleeding presents by its signs; the KB indexes it under peptic ulcer disease. Without
    // these, "melena" fuzzy-resolved to "Mal de Meleda" (edit distance 1) and "melena workup" to a
    // dermatitis entry (owner screenshot, 2026-09-18).
    peptic_ulcer: "melena melaena malena hematemesis haematemesis ugib coffee ground vomitus black stool tarry stool tarry stools",
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

  // Stopwords / framing words / connectors that must NOT count as clinical topic identity
  var GENERIC_TOPIC = {
    // Question-frame words that must never count as a NAME hit (owner, 2026-09-18): "melena workup"
    // routed CONFIDENTLY to "Exfoliative dermatitis (erythroderma workup)" because "workup" is in
    // that disease's display name and the KB has no melena entry, so it was the only token that hit.
    workup:1,workups:1,evaluation:1,evaluate:1,evaluating:1,assessment:1,assess:1,assessing:1,algorithm:1,algorithms:1,
    criteria:1,investigation:1,investigations:1,investigate:1,differential:1,differentials:1,causes:1,cause:1,
    treatment:1,treat:1,treating:1,management:1,manage:1,managing:1,therapy:1,approach:1,protocol:1,regimen:1,empiric:1,initial:1,signs:1,sign:1,symptoms:1,symptom:1,diagnosis:1,diagnose:1,poisoning:1,poison:1,toxicity:1,toxic:1,overdose:1,syndrome:1,disease:1,disorder:1,infection:1,fever:1,dose:1,dosing:1,drug:1,drugs:1,acute:1,chronic:1,severe:1,about:1,information:1,info:1,what:1,which:1,when:1,how:1,why:1,does:1,with:1,from:1,the:1,and:1,for:1,of:1,
    // conversational fillers/lead-ins (4+ chars) — must NOT count as the topic, else
    // "tell"/"hello"/"please" break the exact-match gate ("no entry for tell diabetic ketoacidosis").
    tell:1,tells:1,told:1,telling:1,hello:1,hey:1,hi:1,please:1,kindly:1,could:1,would:1,should:1,shall:1,can:1,you:1,your:1,give:1,gives:1,giving:1,want:1,wants:1,need:1,needs:1,know:1,knows:1,explain:1,explaining:1,describe:1,help:1,helps:1,share:1,provide:1,list:1,discuss:1,okay:1,sure:1,here:1,there:1,also:1,some:1,more:1,this:1,that:1,these:1,those:1,understand:1,regarding:1,concerning:1,briefly:1,quickly:1,detail:1,details:1,
    // more conversational lead-ins (verbs/nouns that carry NO clinical topic) — must be
    // dropped so "speak about X", "talk me through X", "read out X" ground on X, not on "speak X".
    speak:1,speaks:1,speaking:1,spoke:1,talk:1,talks:1,talking:1,talked:1,read:1,reads:1,reading:1,discusses:1,discussed:1,discussing:1,teach:1,teaches:1,teaching:1,taught:1,learn:1,learns:1,learning:1,study:1,studying:1,cover:1,covers:1,covering:1,define:1,defines:1,defining:1,mention:1,mentions:1,note:1,notes:1,overview:1,summary:1,summarise:1,summarize:1,summarised:1,summarized:1,lecture:1,walk:1,through:1,everything:1,anything:1,something:1,thing:1,things:1,stuff:1,aspect:1,aspects:1,topic:1,topics:1,brief:1,briefing:1,elaborate:1,
    // demographic / qualifier / route / dose framing words (gold-next): they describe HOW a
    // topic is framed, not the topic itself. Leaving them "distinctive" made the relevance
    // gate refuse valid in-KB questions ("… in an ADULT", "CONFIRM … ORAL … FIRST-LINE …").
    adult:1,adults:1,child:1,children:1,childhood:1,elderly:1,geriatric:1,male:1,female:1,
    man:1,woman:1,men:1,women:1,patient:1,patients:1,person:1,people:1,someone:1,
    year:1,years:1,month:1,months:1,week:1,weeks:1,aged:1,age:1,ages:1,old:1,young:1,
    adolescent:1,adolescents:1,baby:1,babies:1,
    confirm:1,confirms:1,confirmed:1,confirming:1,verify:1,verifies:1,verified:1,verifying:1,
    correct:1,incorrect:1,wrong:1,right:1,true:1,false:1,really:1,actually:1,indeed:1,
    first:1,second:1,third:1,line:1,firstline:1,oral:1,orally:1,intravenous:1,parenteral:1,
    dosage:1,duration:1,frequency:1,route:1,routes:1,
    // comparison, quantifier, relational, and prepositional connectors:
    // must NOT count as disease identity words (e.g. "than" in "other than covid-19" or "more than 400")
    than:1,then:1,other:1,others:1,more:1,most:1,less:1,least:1,much:1,many:1,
    over:1,under:1,between:1,among:1,within:1,without:1,into:1,onto:1,
    after:1,before:1,during:1,since:1,until:1,against:1,versus:1,each:1,every:1,both:1,
    neither:1,either:1,such:1,same:1,different:1,difference:1 };

  // ── Instant nearest-KB resolver (deterministic; 0 tokens; offline/native-safe) ──────────
  // On a routing MISS, match the query's distinctive tokens against every KB entry's name +
  // alias tokens — exact first, then bounded edit-distance for typos/variants — and ground on
  // the nearest entry under a STATED assumption instead of dead-ending to slow web research.
  // Runs ONLY when the gate already found no lexical/semantic candidate, so it can never
  // override a confident/assume decision; web stays the last resort when nothing is close.
  function buildNameIndex(chunks) {
    var byId = {}, tokIdx = {}, uniq = {};
    (chunks || []).forEach(function (c) {
      if (!c || !c.diseaseId) return;
      var id = c.diseaseId; if (!byId[id]) byId[id] = {};
      (String(c.diseaseName || "") + " " + String(c.aliases || "")).toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).forEach(function (t) { if (t.length >= 4 && !GENERIC_TOPIC[t]) byId[id][t] = 1; });
    });
    Object.keys(byId).forEach(function (id) {
      Object.keys(byId[id]).forEach(function (t) { (tokIdx[t] = tokIdx[t] || []).push(id); if (t.length >= 5) uniq[t] = 1; });
    });
    _tokIdx = tokIdx; _uniqToks = Object.keys(uniq);
  }
  // Bounded Levenshtein: returns the edit distance, or max+1 as soon as the budget is blown.
  function editWithin(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = []; for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      var cur = [i], best = i;
      for (var k = 1; k <= lb; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (cur[k] < best) best = cur[k];
      }
      if (best > max) return max + 1;   // whole row over budget → prune
      prev = cur;
    }
    return prev[lb];
  }
  // Typo tolerance scales with token length: short tokens are exact-only (fuzzing them is unsafe).
  function fuzzThreshold(len) { return len >= 8 ? 2 : (len >= 5 ? 1 : 0); }
  // Resolve distinctive query tokens to the nearest KB disease id, or null when nothing is close.
  var _aliasTokSet = null;
  function fuzzyResolve(distinctive) {
    if (!_tokIdx || !distinctive || !distinctive.length) return null;
    var score = {};
    // A real clinical word is never a typo of a disease name: "melena" is not "Meleda". Any token
    // that a curated alias already names is exact-only here (2026-09-18).
    if (!_aliasTokSet) { _aliasTokSet = {}; Object.keys(SMD_ALIASES).forEach(function (aid) { String(SMD_ALIASES[aid]).toLowerCase().split(" ").forEach(function (t) { if (t.length >= 4) _aliasTokSet[t] = 1; }); }); }
    distinctive.forEach(function (q) {
      if (q.length < 4) return;
      if (_tokIdx[q]) _tokIdx[q].forEach(function (id) { score[id] = (score[id] || 0) + 2; });   // exact = strong
      if (_aliasTokSet[q]) return;
      var thr = fuzzThreshold(q.length); if (thr <= 0) return;
      var bestTok = null, bestEd = thr + 1;
      for (var i = 0; i < _uniqToks.length; i++) {
        var t = _uniqToks[i];
        if (Math.abs(t.length - q.length) > thr || (t === q)) continue;
        var ed = editWithin(q, t, thr);
        if (ed <= thr && ed < bestEd) { bestEd = ed; bestTok = t; if (ed === 1) break; }
      }
      if (bestTok) (_tokIdx[bestTok] || []).forEach(function (id) { score[id] = (score[id] || 0) + (bestEd === 1 ? 1.5 : 1); });
    });
    var bestId = null, best = 0;
    Object.keys(score).forEach(function (id) { if (score[id] > best) { best = score[id]; bestId = id; } });
    return (bestId && best >= 1.5) ? { id: bestId, score: best } : null;   // need one exact or one ed-1 fuzzy hit
  }

  // ── Name gate (flag smd_kb_gate: default ON; "0" = the coverage gate in buildPackage) ─────────────
  // A standalone question gets an entry's notes only when it NAMES the entry: a whole name form
  // ("Haemophilia A", the "(factor VIII)" gloss, "Acute heart failure" out of "... / pulmonary
  // edema"), a phrase from KB_NAMES ("heart attack"), or the entry's one-word id ("DVT", "PE").
  // One shared word is not a name: "RA factor" is not Factor X deficiency and "capital of France" is
  // not slipped capital femoral epiphysis. A real word just before the matched words names something
  // else ("heat stroke", "tuberculous meningitis", "respiratory failure"); a letter or number just
  // after is an identifier ("hepatitis B", "factor 9"). An unnamed question gets no notes, so the
  // model answers from its own knowledge instead of from the wrong entry. Scored by
  // test/maik-kb-relevance.test.mjs.
  function kbGateV2() { try { return localStorage.getItem("smd_kb_gate") !== "0"; } catch (e) { return true; } }
  // Names a clinician types that the entry's KB name does not contain. Synonyms and abbreviations
  // only: SMD_ALIASES above also carries feature words ("palpitations", "potassium") that help
  // retrieval but name nothing. Written singular and in US spelling; foldTok() covers the variants.
  var KB_NAMES = {
    acs: "mi, stemi, nstemi, acs, heart attack, myocardial infarction",
    atrial_fib: "af, afib",
    acute_infectious_diarrheal_diseases_and: "diarrhea, loose motion, loose stool, watery stool, gastroenteritis",
    C_DIFF: "c diff, cdiff, c difficile, clostridium, clostridioides, difficile, pseudomembranous colitis",
    peptic_ulcer: "melena, malena, hematemesis, ugib, upper gi bleed, upper gi bleeding, coffee ground vomitus, black stool, tarry stool",
    hypoglycemia: "hypo, low sugar, low blood sugar",
    crystal_arthritis: "gout, podagra",
    hhs: "honk",
    MENINGITIS: "meningitis",
    CHOLANGITIS: "ascending cholangitis",
    CNS_TB: "tbm, tuberculous meningitis",
    PULMONARY_TB: "tb, ptb, tuberculosis",
    organophosphate: "op, op poisoning",
    ischemic_stroke: "stroke, cva, brain attack",
    ich: "hemorrhagic stroke",
    seizure_epilepsy: "convulsion",
    FEBRILE_NEUTROPENIA: "neutropenic fever",
    rheumatoid: "ra, rheumatoid",
    sle_flare: "sle, lupus",
    adrenal_crisis: "addisonian crisis, addison",
    opioid_od: "opioid poisoning",
    anaphylaxis: "anaphylactic",
    SEPSIS: "septicemia",
    CAP: "cap, pneumonia",
    COPD_EXACERBATION: "copd, aecopd",
    asthma_exac: "asthma",
    hiv_aids: "hiv",
    heart_failure: "chf, congestive heart failure, adhf",
    nephrolithiasis: "kidney stone, renal stone, renal calculi, urolithiasis",
    biliary_colic: "gallstone, gall stone, gall bladder stone",
    haemorrhoids: "pile",
    variceal_bleed: "varices, esophageal varices",
    varicella_zoster: "herpes zoster, shingles, chickenpox, chicken pox",
    snake_envenomation: "snake bite, snakebite, anti snake venom",
    neuroleptic_malignant_syndrome: "nms",
    sjs_ten: "sjs",
    acquired_thrombotic_thrombocytopenic_purpura: "ttp",
    urinary_tract_infections_cystitis_prostati: "uti, urinary tract infection",
    pernicious_anemia: "intrinsic factor",
    stable_angina: "angina pectoris",
    hyperkalemia: "high potassium",
    hyponatremia: "low sodium",
    MALARIA: "falciparum malaria, vivax malaria, cerebral malaria, complicated malaria",
    rabies: "dog bite, animal bite",
    gastroesophageal_reflux_disease: "gerd, gord, acid reflux",
    helicobacter_pylori_infection: "h pylori",
    tricyclic_antidepressant_overdose: "tricyclic poisoning, tca poisoning",
    PHARYNGITIS: "sore throat, strep throat",
    latent_tuberculosis: "latent tb, ltbi",
    mdr_tuberculosis: "mdr tb"
  };
  // One spelling for British/US variants, plurals, poisoning words and Roman numerals, applied to
  // questions and names alike, so "haemophilia A" = "hemophilia a" and "factor VIII" = "factor 8".
  var ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13" };
  var SAME = { overdose: "poisoning", toxicity: "poisoning", intoxication: "poisoning", ingestion: "poisoning" };
  function foldTok(t) {
    t = t.replace(/ae|oe/g, "e").replace(/sulph/g, "sulf");
    if (t.length > 4 && /ies$/.test(t)) t = t.slice(0, -3) + "y";
    else if (t.length > 4 && /s$/.test(t) && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
    return SAME[t] || ROMAN[t] || t;
  }
  function rawToks(s) {
    s = String(s == null ? "" : s);
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(function (t) { return t && t !== "s"; });
  }
  function foldToks(s) { return rawToks(s).map(foldTok); }   // "Bell's" and "bells" both -> "bell"
  // Connectives are skipped when matching. Leading qualifiers and trailing head nouns may be left out
  // of a name ("Acute pancreatitis" = "pancreatitis", "Cushing syndrome" = "cushing"), never both
  // ("Chronic kidney disease" is not "kidney").
  var CONNECT = { of: 1, and: 1, the: 1, "in": 1, "with": 1, due: 1, to: 1, other: 1, or: 1, by: 1, "for": 1, on: 1, at: 1, from: 1, type: 1 };
  var LEAD_Q = { acute: 1, chronic: 1, severe: 1, mild: 1, moderate: 1, uncomplicated: 1, recurrent: 1, idiopathic: 1, spontaneous: 1, primary: 1, paroxysmal: 1 };
  var HEAD_Q = { disease: 1, disorder: 1, syndrome: 1, infection: 1, deficiency: 1, management: 1, treatment: 1, diagnosis: 1, complication: 1, overview: 1, mellitus: 1, pectoris: 1, erythematosus: 1, virus: 1 };
  var Q_STOP = { is: 1, are: 1, was: 1, were: 1, be: 1, a: 1, an: 1, i: 1, me: 1, my: 1, we: 1, it: 1, its: 1, as: 1, "do": 1, did: 1, has: 1, have: 1, had: 1, will: 1, may: 1, vs: 1, per: 1, any: 1, all: 1, not: 1, no: 1, "if": 1, so: 1, but: 1, up: 1 };
  function plainWord(t) { return !!(CONNECT[t] || Q_STOP[t] || GENERIC_TOPIC[t] || LEAD_Q[t] || HEAD_Q[t]) || /^\d+$/.test(t); }
  // A form must carry identity: a word of 5+ letters that is not a qualifier or a question word
  // (4+ inside a longer form).
  function validForm(f) { return f.some(function (w) { return w.length >= (f.length > 1 ? 4 : 5) && !LEAD_Q[w] && !HEAD_Q[w] && !GENERIC_TOPIC[w]; }); }
  function nameForms(name) {
    var pieces = [], out = [], seen = {}, raw = String(name || "");
    // "(Typhoid)" at the end is a synonym; "Giant cell (temporal) arteritis" means "temporal arteritis".
    raw.replace(/\(([^)]*)\)([^(]*)/g, function (m, p, tail) { pieces.push(/[a-z]/i.test(tail) ? p + " " + tail : p); return m; });
    var main = raw.replace(/\([^)]*\)/g, " ");
    pieces.unshift(main);
    pieces.slice().forEach(function (p) {
      p = String(p);
      var sl = p.split("/");
      if (sl.length === 2 && !/[,;:&]/.test(p) && /^\S+(al|ic|ed|ous|ive|ary|ar)$/i.test(sl[0].trim()) && /\s/.test(sl[1].trim())) {
        pieces.push(sl[0] + " " + sl[1].trim().split(/\s+/).pop(), sl[1]);   // "Renal / ureteric colic": renal colic, ureteric colic
        return;
      }
      var an = p.split(/ and /i);
      if (an.length === 2 && !/[\/,;:&]/.test(p) && /\s/.test(an[0].trim()) && !/\s/.test(an[1].trim())) {
        var mods = an[0].trim().split(/\s+/); mods.pop();
        pieces.push(an[0], mods.join(" ") + " " + an[1]);   // "... aortic aneurysm and dissection": aortic dissection
        return;
      }
      // "Hyponatraemia and SIADH" is two names; "Hand, foot and mouth disease" is one.
      p.split(/,/.test(p) ? /[\/,;:&]/ : /[\/;:&]| and /i).forEach(function (x) { pieces.push(x); });
    });
    pieces.forEach(function (p) {
      var t = foldToks(p).filter(function (w) { return !CONNECT[w]; });
      var lead = t.slice(), head = t.slice();
      while (lead.length > 1 && LEAD_Q[lead[0]]) lead.shift();
      while (head.length > 1 && HEAD_Q[head[head.length - 1]]) head.pop();
      [t, lead, head].forEach(function (f) { var k = f.join(" "); if (f.length && !seen[k] && validForm(f)) { seen[k] = 1; out.push(f); } });
    });
    return out;
  }
  var _chunkRef = null, _gate = null;
  function gateIndex() {
    if (_gate) return _gate;
    var names = {}, forms = {}, first = {}, own = {}, words = {};
    (_chunkRef || []).forEach(function (c) { if (c && c.diseaseId && !names[c.diseaseId]) names[c.diseaseId] = c.diseaseName || c.diseaseId; });
    Object.keys(names).forEach(function (id) {
      var f = nameForms(names[id]);
      String(KB_NAMES[id] || "").split(",").forEach(function (p) { var t = foldToks(p).filter(function (w) { return !CONNECT[w]; }); if (t.length) f.push(t); });
      if (!/_/.test(id)) f.push([foldTok(id.toLowerCase())]);   // "dvt", "pe", "aki", "dengue"
      var o = {};
      f.concat([foldToks(names[id]), foldToks(String(id).replace(/_/g, " "))]).forEach(function (t) { t.forEach(function (w) { o[w] = 1; words[w] = 1; }); });
      forms[id] = f; own[id] = o;
      f.forEach(function (t) { var l = first[t[0]] || (first[t[0]] = []); if (l.indexOf(id) < 0) l.push(id); });
    });
    return (_gate = { forms: forms, first: first, own: own, known: words, words: Object.keys(words).filter(function (w) { return w.length >= 5; }) });
  }
  function ownWord(w, own) {
    if (own[w]) return true;
    if (w.length < 5) return false;
    for (var k in own) if (k.length >= 5 && k.slice(0, 5) === w.slice(0, 5)) return true;   // infected ~ infection
    return false;
  }
  function clash(qa, s, e, own, acro) {
    var p = qa[s - 1], n = qa[e + 1];
    if (p && (p.length >= 3 || acro[p]) && !plainWord(p) && !ownWord(p, own)) return true;   // "heat" stroke
    return !!(n && /^([a-z]|\d+)$/.test(n) && !own[n]);                                       // hepatitis "b"
  }
  // id -> longest form of that entry the question names (in order, connectives skipped, no clash).
  function nameHits(qa, acro) {
    var G = gateIndex(), qs = [], pos = [], hits = {};
    qa.forEach(function (t, i) { if (!CONNECT[t]) { qs.push(t); pos.push(i); } });
    qs.forEach(function (t, i) {
      (G.first[t] || []).forEach(function (id) {
        G.forms[id].forEach(function (f) {
          if (f[0] !== t || i + f.length > qs.length) return;
          for (var k = 1; k < f.length; k++) if (qs[i + k] !== f[k]) return;
          if (clash(qa, pos[i], pos[i + f.length - 1], G.own[id], acro)) return;
          if (!(hits[id] >= f.length)) hits[id] = f.length;
        });
      });
    });
    return hits;
  }
  // -> { id, gc, mode: "confident"|"assume", named, topic } or { id: null, topic }
  function nameGate(question, retrieved) {
    var acro = {};
    String(question).replace(/[^a-zA-Z0-9 ]+/g, " ").split(/\s+/).forEach(function (w) { if (w.length >= 2 && w.length <= 5 && /^[A-Z0-9]+$/.test(w) && /[A-Z]/.test(w)) acro[w.toLowerCase()] = 1; });
    var raw = rawToks(question), qa = raw.map(foldTok), lex = [];
    (retrieved || []).forEach(function (r) { if (r && r.diseaseId && lex.indexOf(r.diseaseId) < 0) lex.push(r.diseaseId); });
    var topic = raw.filter(function (t, j) { return (t.length >= 3 || acro[t]) && !plainWord(qa[j]); }).join(" ") || String(question).trim();
    function best(hits) {   // the longest name wins; a tie goes to the lexical retriever's order
      var b = null;
      Object.keys(hits).forEach(function (id) {
        var r = lex.indexOf(id); r = r < 0 ? 1e9 : r;
        if (!b || hits[id] > b.s || (hits[id] === b.s && r < b.r)) b = { id: id, s: hits[id], r: r };
      });
      return b;
    }
    var hits = nameHits(qa, acro), b = best(hits), mode = "confident";
    if (!b) {
      // A spelling slip: a word the KB text never uses, one or two letters from a name word with the
      // same first letter ("malria", "clostridiym"). A real word is never "corrected": "value" is not
      // "valve", "anion" is not "Anton", "brucella" is not "rubella".
      var G = gateIndex(), fixed = false;
      var inKb = function (t) { return !_ai.hasTerm || _ai.hasTerm(t); };
      var qf = qa.map(function (t, j) {
        if (t.length < 5 || G.known[t] || plainWord(t) || inKb(raw[j]) || inKb(t)) return t;
        var thr = fuzzThreshold(t.length), bt = null, be = thr + 1;
        for (var i = 0; i < G.words.length && be > 1; i++) {
          var w = G.words[i];
          if (w === t || w.charAt(0) !== t.charAt(0) || Math.abs(w.length - t.length) > thr) continue;
          var ed = editWithin(t, w, thr);
          if (ed < be) { be = ed; bt = w; }
        }
        if (bt) { fixed = true; return bt; }
        return t;
      });
      if (fixed) { hits = nameHits(qf, acro); b = best(hits); mode = "assume"; }
    }
    var gc = b ? trimGrounding(_ai.getGroundingContext(b.id)) : null;
    return gc ? { id: b.id, gc: gc, mode: mode, named: hits, topic: topic } : { id: null, topic: topic };
  }

  function init() {
    if (_initP) return _initP;
    _initP = (function () {
      // KB_CORE/KB_ENRICHMENT are lazy-loaded after first paint (see index.html); wait for them.
      var kbReady = window.SMD_KB_READY || Promise.resolve();
      return kbReady.then(function () {
        return !window.KB_RAG ? loadScript("/kb/dist/kb.rag.js?v=gold117") : Promise.resolve();
      }).then(function () {
        return import("/kb/ai/interface.mjs?v=gold1035-kbgate");
      }).then(function (mod) {
        var CORE = (window.KB_CORE && (window.KB_CORE.diseases || window.KB_CORE.byId)) || [];
        var diseases = {}; (Array.isArray(CORE) ? CORE : Object.values(CORE)).forEach(function (d) { if (d && d.id) diseases[d.id] = d; });
        var _chunks = deriveChunks();
        var store = {
          diseases: diseases,
          treatments: (window.KB_RAG && window.KB_RAG.treatments) || {},
          policies: (window.KB_RAG && window.KB_RAG.policies) || {},
          index: { chunks: _chunks }
        };
        _ai = mod.createStewardAI(store, { flags: { ai: true, ragRetrieval: true } });
        _chunkRef = _chunks; _gate = null;   // the name gate indexes entry names lazily, on first use
        buildNameIndex(_chunks);   // instant nearest-KB resolver index (typo/variant tolerance)
        _rrf = mod.rrf || null;   // hybrid fusion (available when smd_hybrid on)
        return true;
      }).catch(function (e) { _ai = null; return false; });
    })();
    return _initP;
  }

  function lbl(k) { try { return (window.SMD_REASON && SMD_REASON.label) ? SMD_REASON.label(k) : k; } catch (e) { return k; } }

  function trimGrounding(g) {
    if (!g) return null;
    // Chunk-level bias: if the vector arm matched a specific SECTION for this disease, surface that
    // section's chunk FIRST (ahead of the fixed priority order) — section-precise grounding.
    var boost = g.diseaseId && _vecSections[g.diseaseId];
    var pri = function (s) { if (boost && s === boost) return -1; var i = PRIORITY.indexOf(s); return i < 0 ? 99 : i; };
    var byPri = g.knowledge.slice().sort(function (a, b) { return pri(a.section) - pri(b.section); }).slice(0, PER_DISEASE);
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

      // Hybrid retrieval (flag smd_hybrid) is applied LAZILY inside the knowledge-question gate
      // below — the Vectorize round-trip (~0.7-1.4s) is only paid when the lexical arm is NOT a
      // confident match (exactly when the semantic arm can rescue a mis-route). Confident lexical
      // hits (the common case) skip the network hop, so answers start ~1s sooner. (perf)

      var grounding = top.map(function (c) { return trimGrounding(_ai.getGroundingContext(c.id)); }).filter(Boolean);

      var treatment = lead ? _ai.resolveTreatment(lead.id, hospitalId) : null;
      // NOTE: pkg.refs (drug/calculator/ICU/stewardship) is assembled LOWER DOWN, AFTER the
      // knowledge-question gate — because for a standalone knowledge question lead/grounding/
      // treatment are only resolved inside that gate. Building refs here left every ref empty
      // on that path (the coverage matrix, de-escalation regimens and REFERENCES never reached
      // the model). See the refs block just before the return.

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
      var _gateV2 = !top.length && !!(opts.question || "").trim() && kbGateV2();
      if (_gateV2) {
        var ng = nameGate(opts.question, retrieved);
        if (ng.id) {
          grounding = [ng.gc];
          lead = { id: ng.id, name: ng.gc.name || ng.id };
          if (_ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(ng.id, hospitalId); } catch (e) {} }
          retrieved = retrieved.filter(function (r) { return r && ng.named[r.diseaseId]; });   // notes of named entries only
          topicMatch = ng.mode === "assume"
            ? { matched: false, mode: "assume", topic: ng.topic, nearest: ng.gc.name || ng.id, assume: { id: ng.id, name: ng.gc.name || ng.id }, resolver: "fuzzy" }
            : { matched: true, topic: ng.topic, grounded: ng.gc.name || ng.id };
        } else {
          grounding = []; lead = null; treatment = null; retrieved = [];
          topicMatch = { matched: false, mode: "none", topic: ng.topic, nearest: null };
        }
      }
      if (!_gateV2 && !top.length && (opts.question || "").trim()) {
        var acroSet = {};
        String(opts.question).replace(/[^a-zA-Z0-9 ]+/g, " ").split(/\s+/).forEach(function (w) {
          if (w.length >= 2 && w.length <= 5 && (w === w.toUpperCase() || /^[A-Z0-9]+$/.test(w) || (w.length >= 3 && /^[A-Z][a-zA-Z0-9]+[A-Z]/.test(w)))) {
            acroSet[w.toLowerCase()] = 1;
          }
        });
        var distinctive = String(opts.question).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (t) {
          return !GENERIC_TOPIC[t] && (t.length >= 4 || (t.length >= 2 && acroSet[t]));
        });
        // Coverage-based relevance (gold-next) — replaces the brittle all-or-nothing every() gate.
        // Three tiers: CONFIDENT (answer directly) / ASSUME (nearest topic, stated assumption +
        // refine chips) / NONE (topic absent → opt-in web research, never describe a wrong disease).
        //
        // gold326: evaluate the whole candidate POOL, not just rank-0. With hybrid on the pool is
        // the RRF-fused lexical+vector order, so a semantically-correct disease the lexical arm
        // mis-ranked (e.g. "hyperkalemia" losing rank-0 to "Diabetes: Management" for "hyperkalemia
        // management", because RRF rewards the disease present in BOTH arms) is still tested and
        // wins the gate on coverage. Without hybrid the pool is just the lexical nearest (unchanged).
        var qHay = " " + String(opts.question).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
        var _ecache = {};   // memoize per id — Phase 1/2 pools overlap; grounding build is the costly bit
        function evalCand(id) {
          if (id && _ecache.hasOwnProperty(id)) return _ecache[id];
          var gc = id ? trimGrounding(_ai.getGroundingContext(id)) : null;
          if (!gc) { if (id) _ecache[id] = null; return null; }
          // Coverage haystack = the WHOLE grounding object (name/class/section/source/crossLinks/text)
          // so a distinctive term anywhere in it counts — kept as-is for routing parity. This runs only
          // for the candidates actually evaluated (≈1 for a confident rank-0 match, memoized), so it's
          // cheap; the real perf win is the short-circuit + the lazy vector hop, not trimming this.
          var aliasStr = " " + String(SMD_ALIASES[id] || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
          var hay = (String(id) + " " + (gc.name || "") + " " + aliasStr + JSON.stringify(gc)).toLowerCase();
          var hitT = distinctive.filter(function (t) { return hay.indexOf(t) >= 0; });
          var cov = distinctive.length ? hitT.length / distinctive.length : 1;
          var nameHit = false, nameToksAll = false, headHit = false;
          if (gc.name) {
            var nm = String(gc.name).toLowerCase();
            nameHit = distinctive.some(function (t) { return t.length >= 5 && nm.indexOf(t) >= 0; });
            var nameToks = nm.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (t) { return t.length >= 4 && !GENERIC_TOPIC[t]; });
            nameToksAll = nameToks.length > 0 && nameToks.every(function (t) { return qHay.indexOf(" " + t + " ") >= 0; });
            // HEAD match: the specific entity usually LEADS a disease name (Dengue…, Enteric…,
            // Scrub…, Diabetic…). A query token that hits the head is a real topic hit; a lone token
            // that only hits a NON-head/body position ("hypertension" → Idiopathic intracranial
            // Hypertension, "management" → Diabetes Mellitus: Management, "high" in a fever body) is a
            // mis-route — so a single-term query must hit the head (or the whole name) to be confident.
            headHit = nameToks.length > 0 && qHay.indexOf(" " + nameToks[0] + " ") >= 0;
          }
          // ALIAS match: a curated discriminative synonym/abbreviation for THIS disease appears in
          // the query ("stemi"/"heart attack" → ACS, "loose motions" → diarrhoea). Aliases are
          // hand-picked to be specific, so an alias hit is a real name-level match even when the
          // display name is empty (e.g. ACS) or generic.
          var aliasToks = aliasStr.split(" ").filter(function (t) { return t.length >= 2 && !GENERIC_TOPIC[t]; });
          var aliasHit = aliasToks.some(function (t) { return qHay.indexOf(" " + t + " ") >= 0; });
          // Confident when: nothing distinctive to check; the whole name is named; a NAME token or a
          // curated ALIAS is named; or ≥2 distinct query terms are covered. A LONE BODY-ONLY hit no
          // longer counts (was `cov >= 0.6`): "high fever" only touched a Tick-borne relapsing fever
          // body, so it now degrades to general knowledge instead of confidently describing it.
          var conf = distinctive.length === 0 || nameToksAll || nameHit || aliasHit || (cov >= 0.6 && hitT.length >= 2);
          var res = { id: id, gc: gc, hit: hitT, coverage: cov, missing: distinctive.filter(function (t) { return hay.indexOf(t) < 0; }),
                      confident: conf, nameHit: nameHit, nameToksAll: nameToksAll, headHit: headHit, aliasHit: aliasHit };
          if (id) _ecache[id] = res;
          return res;
        }
        // pick(): highest-ranked candidate — confident, else partial, else rank-0. Short-circuits on
        // the first confident hit, so a rank-0 match builds grounding for ONE disease, not the whole
        // pool of 8 (grounding assembly is the costly step).
        function pick(ids) {
          var firstPartial = null, firstAny = null;
          for (var i = 0; i < ids.length; i++) {
            var e = evalCand(ids[i]); if (!e) continue;
            if (!firstAny) firstAny = e;
            if (e.confident) return e;
            if (!firstPartial && e.hit.length > 0) firstPartial = e;
          }
          return firstPartial || firstAny || null;
        }
        // Phase 1 — LEXICAL only (instant, no network). Dedup the retrieved disease order.
        var lexIds = []; retrieved.forEach(function (r) { if (r && r.diseaseId && lexIds.indexOf(r.diseaseId) < 0) lexIds.push(r.diseaseId); });
        if (!lexIds.length && retrieved[0] && retrieved[0].diseaseId) lexIds = [retrieved[0].diseaseId];
        // Evaluate ONLY the lexical rank-0 here — matches the pre-hybrid lexical path (and the
        // offline/native path where the vector arm is unreachable). Scanning the deeper lexical pool
        // let a body-coverage match on a LOWER-ranked disease win (e.g. HF-management mentions many
        // electrolytes) → mis-routes. The multi-candidate POOL evaluation belongs to the fused
        // vector phase below, where the semantic arm actually justifies considering rank>0.
        // ALIAS-SEEDED candidate (2026-09-18): a curated alias in the query names its disease outright
        // ("melena" -> peptic_ulcer) even when the lexical index has no row for the word, so the
        // aliased disease is evaluated FIRST instead of falling through to the typo resolver.
        Object.keys(SMD_ALIASES).some(function (aid) {
          var toks = String(SMD_ALIASES[aid]).toLowerCase().split(" ").filter(function (t) { return t.length >= 4 && !GENERIC_TOPIC[t]; });
          if (!toks.some(function (t) { return qHay.indexOf(" " + t + " ") >= 0; })) return false;
          if (lexIds[0] !== aid) { var ix = lexIds.indexOf(aid); if (ix >= 0) lexIds.splice(ix, 1); lexIds.unshift(aid); }
          return true;
        });
        var chosen = pick(lexIds.slice(0, 1));
        // Phase 2 — SEMANTIC fallback. Skip the Vectorize hop ONLY when the lexical pick is a NAME-level
        // match (disease name matches the query topic) or there's no distinctive term to disambiguate.
        // A mere body-text coverage match is NOT enough to skip — e.g. "hyperkalemia management" hits
        // "Heart Failure: Management" (which just mentions hyperkalemia); the vector arm must still run
        // to route it to the actual Hyperkalaemia entry.
        var nameSure = chosen && chosen.confident && (chosen.nameHit || chosen.nameToksAll);
        if (distinctive.length && !nameSure && smdHybridOn() && _rrf && (opts.question || "").trim()) {
          var vecIds = await vectorDiseaseIds(opts.question, RETRIEVE_K);
          if (vecIds.length) {
            var fusedChosen = pick(_rrf(lexIds, vecIds).slice(0, 8));
            // adopt the fused pick when it's a stronger match (confident, or a hit where lexical had none)
            if (fusedChosen && (fusedChosen.confident || (fusedChosen.hit.length > 0 && (!chosen || !chosen.hit.length)))) chosen = fusedChosen;
          }
        }
        var candId = chosen ? chosen.id : null;
        var candGc = chosen ? chosen.gc : null;
        if (chosen && chosen.confident) {
          grounding = [candGc];
          if (!lead) lead = { id: candId, name: candGc.name || candId };
          if (!treatment && _ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(candId, hospitalId); } catch (e) {} }
          topicMatch = { matched: true, topic: distinctive.join(" "), grounded: candGc.name || candId };
        } else if (chosen && chosen.hit.length > 0 && (chosen.nameHit || chosen.aliasHit || chosen.hit.length >= 2)) {
          // partial overlap → keep grounding on the nearest topic so nothing off-KB is invented,
          // but flag it as an ASSUMPTION for the caller to state + let the clinician refine.
          // Require a NAME/ALIAS match or ≥2 distinct hits: a lone BODY-ONLY hit ("high" only in a
          // Tick-borne relapsing fever body) is a mis-route, so it falls through to "none" → the
          // model answers from general knowledge instead of confidently describing the wrong disease.
          grounding = [candGc];
          if (!lead) lead = { id: candId, name: candGc.name || candId };
          if (!treatment && _ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(candId, hospitalId); } catch (e) {} }
          topicMatch = { matched: false, mode: "assume", topic: distinctive.join(" ") || String(opts.question).trim(),
            nearest: candGc.name || candId, assume: { id: candId, name: candGc.name || candId },
            coverage: Math.round(chosen.coverage * 100) / 100, missing: chosen.missing };
        } else {
          // No lexical/semantic candidate. Before dead-ending to slow web research, try the
          // deterministic nearest-KB resolver (typo/variant/old-name tolerance, 0 tokens) so
          // messy input still gets a FAST verified answer under a stated assumption.
          var fz = fuzzyResolve(distinctive);
          var fzGc = fz ? trimGrounding(_ai.getGroundingContext(fz.id)) : null;
          if (fzGc) {
            grounding = [fzGc];
            if (!lead) lead = { id: fz.id, name: fzGc.name || fz.id };
            if (!treatment && _ai.resolveTreatment) { try { treatment = _ai.resolveTreatment(fz.id, hospitalId); } catch (e) {} }
            topicMatch = { matched: false, mode: "assume", topic: distinctive.join(" ") || String(opts.question).trim(),
              nearest: fzGc.name || fz.id, assume: { id: fz.id, name: fzGc.name || fz.id }, resolver: "fuzzy" };
          } else {
            // topic genuinely not in the KB → drop the near-miss grounding so nothing wrong is described
            grounding = []; lead = null; treatment = null; retrieved = [];
            topicMatch = { matched: false, mode: "none", topic: distinctive.join(" ") || String(opts.question).trim(), nearest: (candGc && candGc.name) || candId || null };
          }
        }
      }

      // ICU / calculator / drug / stewardship refs (by reference only). Assembled HERE — after
      // the knowledge-question gate — so it reflects the FINAL grounding/treatment: on the
      // standalone-question path lead/grounding/treatment are resolved inside that gate, so
      // building refs earlier left every ref empty. Derive disease-object refs from the union of
      // the case differential (top) AND the grounded diseases, covering both paths.
      var coreArr = (window.KB_CORE && window.KB_CORE.diseases) || [];
      var coreById = {}; (Array.isArray(coreArr) ? coreArr : Object.keys(coreArr).map(function (k) { return coreArr[k]; })).forEach(function (d) { if (d && d.id) coreById[d.id] = d; });
      var refs = { drug: [], calculators: [], icuProtocols: [], stewardship: [] };
      var seenDrug = {};
      function addDrug(d) { if (d && !seenDrug[d]) { seenDrug[d] = 1; refs.drug.push(d); } }
      grounding.forEach(function (g) { (g.drugRefs || []).forEach(addDrug); });
      var refDiseaseIds = {};
      top.forEach(function (c) { if (c && c.id) refDiseaseIds[c.id] = 1; });
      grounding.forEach(function (g) { if (g && g.diseaseId) refDiseaseIds[g.diseaseId] = 1; });
      Object.keys(refDiseaseIds).forEach(function (id) {
        var d = coreById[id]; if (!d) return;
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
