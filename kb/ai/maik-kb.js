/* MaiK V2 — Deterministic KB Answer Engine  (window.MaiKKB)
 *
 * The retrieval-first brain: answers the ~95% of clinical KNOWLEDGE questions
 * (what-is / features / differentials / investigations / treatment / dose /
 * red-flags / prognosis …) DIRECTLY from the StewardMD Knowledge Base, with
 * citations and a confidence score — NO Gemini, NO network, sub-second.
 *
 * Data sources (all client-side globals already loaded by index.html):
 *   KB_ENRICHMENT.byId[id]  {name,system,class,source,pages, pathophysiology,
 *     clinicalPearls[], additionalDifferentials[], infectionMimics[],
 *     nonInfectiousMimics[], additionalInvestigations[], redFlags[], pitfalls[],
 *     prognosis, severityClassification, references[]}
 *   KB_RAG.treatments[id]   {precedence[], recommendations[{tier,line,
 *     drugRefs[{composition,regimenLabel,dose,route,freq,duration,why}]}], ...}
 *   DX_MGMT[id]             {dx, tx[], ix[]}  (416 management briefs)
 *
 * SAFETY: never fabricates. If the KB lacks the field the question needs, or the
 * topic isn't confidently identified, compose() returns null and the caller falls
 * through to the existing Gemini path. Doses are quoted ONLY from KB_RAG; a drug
 * not in the KB regimen is never given a made-up number. The deterministic engine
 * still owns any diagnosis; this engine only surfaces reference knowledge.
 *
 * Output is markdown in the SAME shape the Gemini path produces (bold lead,
 * bullets, inline page cites, optional @@REFINE:…@@ chips line), so it renders
 * through the unchanged Aurora UI (maikRenderAnswer) with zero UI change.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : this);

  // ---------------------------------------------------------------- utils ----
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^\w\s%+/.-]/g, " ").replace(/\s+/g, " ").trim(); }
  // Canonicalise British/American medical spelling so "ischaemic"≡"ischemic",
  // "oedema"≡"edema", "paediatric"≡"pediatric" all resolve to the same disease.
  var SPELL = [[/aemia/g, "emia"], [/aemic/g, "emic"], [/ischaem/g, "ischem"], [/haemat/g, "hemat"], [/haemo/g, "hemo"], [/anaem/g, "anem"], [/leukaem/g, "leukem"],
    [/oedem/g, "edem"], [/oesophag/g, "esophag"], [/paediatr/g, "pediatr"], [/aetiolog/g, "etiolog"], [/coeliac/g, "celiac"],
    [/diarrhoea/g, "diarrhea"], [/tumour/g, "tumor"], [/gynaec/g, "gynec"], [/orthopaed/g, "orthoped"], [/foetal/g, "fetal"],
    [/caesar/g, "cesar"], [/oestrogen/g, "estrogen"], [/colour/g, "color"], [/dyspnoea/g, "dyspnea"], [/pyrexia/g, "fever"]];
  function medNorm(s) { var x = norm(s); for (var i = 0; i < SPELL.length; i++) x = x.replace(SPELL[i][0], SPELL[i][1]); return x; }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function arr(x) { return Array.isArray(x) ? x.filter(function (v) { return v != null && String(v).trim(); }) : (x ? [x] : []); }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }
  function bullets(list, n) { return arr(list).slice(0, n || 6).map(function (x) { return "- " + String(x).trim(); }).join("\n"); }
  function nonEmpty(list) { return arr(list).length > 0; }

  // ---- high-value medical abbreviation dictionary (whole-word expansion) ----
  var ABBREV = {
    cap: "community acquired pneumonia", hap: "hospital acquired pneumonia", vap: "ventilator associated pneumonia",
    copd: "chronic obstructive pulmonary disease", ards: "acute respiratory distress syndrome", pe: "pulmonary embolism",
    dvt: "deep vein thrombosis", mi: "myocardial infarction", acs: "acute coronary syndrome", stemi: "st elevation myocardial infarction",
    nstemi: "non st elevation myocardial infarction", chf: "heart failure", hf: "heart failure", af: "atrial fibrillation",
    svt: "supraventricular tachycardia", vt: "ventricular tachycardia", htn: "hypertension", dka: "diabetic ketoacidosis",
    hhs: "hyperosmolar hyperglycemic state", t1dm: "type 1 diabetes mellitus", t2dm: "type 2 diabetes mellitus", dm: "diabetes mellitus",
    aki: "acute kidney injury", ckd: "chronic kidney disease", uti: "urinary tract infection", gn: "glomerulonephritis",
    gi: "gastrointestinal", gib: "gastrointestinal bleeding", ugib: "upper gastrointestinal bleeding", gerd: "gastroesophageal reflux disease",
    ibd: "inflammatory bowel disease", uc: "ulcerative colitis", ibs: "irritable bowel syndrome", ld: "liver disease",
    sbp: "spontaneous bacterial peritonitis", he: "hepatic encephalopathy", sle: "systemic lupus erythematosus",
    ra: "rheumatoid arthritis", oa: "osteoarthritis", tb: "tuberculosis", hiv: "human immunodeficiency virus",
    sah: "subarachnoid hemorrhage", ich: "intracerebral hemorrhage", tia: "transient ischemic attack", cva: "stroke",
    gbs: "guillain barre syndrome", mg: "myasthenia gravis", ms: "multiple sclerosis", sepsis: "sepsis",
    af: "atrial fibrillation", vte: "venous thromboembolism", pud: "peptic ulcer disease", cap_: "community acquired pneumonia",
    hlh: "hemophagocytic lymphohistiocytosis", dic: "disseminated intravascular coagulation", ttp: "thrombotic thrombocytopenic purpura",
    itp: "immune thrombocytopenia", aml: "acute myeloid leukemia", all: "acute lymphoblastic leukemia", cml: "chronic myeloid leukemia",
    cll: "chronic lymphocytic leukemia", ns: "nephrotic syndrome", rpgn: "rapidly progressive glomerulonephritis",
    atn: "acute tubular necrosis", sirs: "systemic inflammatory response syndrome", op: "organophosphate poisoning"
  };
  function expandAbbrev(q) {
    return String(q || "").replace(/[A-Za-z][A-Za-z0-9]{1,6}/g, function (w) {
      var lw = w.toLowerCase();
      return (ABBREV[lw] && /^[a-z0-9]+$/.test(lw)) ? ABBREV[lw] : w;
    });
  }

  // ------------------------------------------------------ intent taxonomy ----
  // Order matters — more specific first; "definition" is the catch-all. Stems use
  // a LEADING \b only (no trailing \b) so "investigat"→investigations, "manage"→
  // management, "pathophysiolog"→pathophysiology all match. (The trailing-\b form
  // silently failed on inflected words.)
  var INTENTS = [
    { intent: "dose", re: /\b(dose|dosing|dosage|how much|mg\s*\/\s*kg|loading dose|maintenance dose|max(imum)? dose|what dose|which dose)/ },
    { intent: "treatment", re: /\b(treat|manage|managing|therap|regimen|first[- ]?line|second[- ]?line|drug of choice|antibiotic|empiric|prophylax|de[- ]?escalat)/ },
    { intent: "differential", re: /\b(differential|ddx|d\/dx|causes? of|cause of|etiolog|aetiolog|what causes|reasons? for)/ },
    { intent: "investigation", re: /\b(investigat|work[- ]?up|which tests|what tests|blood test|\blab\b|initial tests|how (to|do i) diagnos|confirm.{0,12}diagnos|diagnostic (test|work))/ },
    { intent: "redflags", re: /\b(red[- ]?flags?|warning signs?|danger signs?|when to (worry|refer|escalate|admit)|alarm (signs|features))/ },
    { intent: "features", re: /\b(symptom|clinical features|features of|presentation|presents|manifestation|signs? of|how does .* present)/ },
    { intent: "pathophysiology", re: /\b(pathophysiolog|pathogenesis|mechanism of|why does .* (happen|develop|occur))/ },
    { intent: "prognosis", re: /\b(prognos|mortality|survival|life expectancy|natural history|outcome of)/ },
    { intent: "pitfalls", re: /\b(pitfall|common mistakes|caveats?|things to avoid)/ },
    { intent: "severity", re: /\b(severity|how severe|grading|classification|staging|stages? of|classify)/ },
    { intent: "definition", re: /\b(what is|what'?s|whats|define|definition of|overview of|tell me about|explain|^about )/ }
  ];
  function classifyIntent(q) {
    var n = norm(q);
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].re.test(n)) return INTENTS[i].intent;
    return "definition";
  }

  // Complexity signals → NOT a single-disease KB lookup → hand to Gemini/web (reasoning mode).
  var COMPLEX_RE = /\b(vs|versus|compare|comparison|difference between|differentiate|why would|why might|reason(ing)? (behind|for)|approach to|synthesi|correlat|interpret|explain (the|why)|walk me through|step[- ]?by[- ]?step|pros and cons|when should i choose|which is better|risk[- ]?benefit)\b/;
  var RECENCY_RE = /\b(latest|recent|newest|new|updated?|current|2023|2024|2025|2026|this year|nowadays)\b/;
  var SOURCEY_RE = /\b(trial|guideline|guidance|recommendation|evidence|study|studies|research|approval|meta.?analysis|rct|consensus|update|publication|landmark)\b/;
  function isComplex(q) {
    var n = norm(q);
    if (COMPLEX_RE.test(n)) return true;
    // "latest / 2025 / recent trial|guideline|approval" → needs current sources → reasoning/web, not canned KB
    if (RECENCY_RE.test(n) && SOURCEY_RE.test(n)) return true;
    if (/\b(clinical trial|\brct\b|meta.?analysis|guideline update|guidelines update|systematic review|newly approved|fda approval)\b/.test(n)) return true;
    // patient vignette / scenario → reasoning
    if (/\bpresent(s|ing)? with\b|\bp\/w\b|\bcase of a\b|\bworkup of a\b/.test(n)) return true;
    if (/\b\d{1,3}[\s-]*(y\/?o|yo|year|yr|m\b|f\b|male|female|man|woman|boy|girl)\b/.test(n) && /\b(present|with|develop|complain|history|admitted|came|brought)\b/.test(n)) return true;
    // "patient with X, Y and Z" (2+ findings) → vignette
    var pm = n.match(/\bpatient (?:with|who)\b(.*)$/);
    if (pm && ((pm[1].match(/,| and | plus /g) || []).length >= 2)) return true;
    // "should I start X or Y first?" / "is this X or Y?" — a choice/comparison → reasoning
    if (/\bor\b/.test(n) && /\b(should i|which|whether|better|prefer|first|instead|rather|choose)\b/.test(n)) return true;
    if (/\bis (this|it) \w+ or \w+/.test(n)) return true;
    return false;
  }

  // --------------------------------------------------- target resolution ----
  // Unified name index across ALL knowledge stores (enrichment + DX_MGMT briefs +
  // treatment bundle), so a disease that lives only in DX_MGMT (e.g. toxicology:
  // paracetamol_poisoning) or only in KB_RAG is still resolvable and answerable.
  var _nameIndex = null; // [{id, key(medNorm name), name}]
  function stores() { return { KE: G.KB_ENRICHMENT, DX: G.DX_MGMT || {}, KR: (G.KB_RAG && G.KB_RAG.treatments) || {} }; }
  function displayName(id, e) { return (e && e.name) || cap(String(id).replace(/_/g, " ")); }
  function buildNameIndex() {
    if (_nameIndex) return _nameIndex;
    _nameIndex = []; var seen = {};
    try {
      var s = stores();
      function add(id, name) { if (!id || seen[id]) return; seen[id] = 1; var key = medNorm(name || String(id).replace(/_/g, " ")); if (key.length >= 4) _nameIndex.push({ id: id, key: key, name: name || cap(String(id).replace(/_/g, " ")) }); }
      if (s.KE && s.KE.byId) Object.keys(s.KE.byId).forEach(function (id) { add(id, s.KE.byId[id] && s.KE.byId[id].name); });
      Object.keys(s.DX).forEach(function (id) { add(id, null); });
      Object.keys(s.KR).forEach(function (id) { add(id, s.KR[id] && s.KR[id].name); });
    } catch (e) {}
    return _nameIndex;
  }
  function lookupStores(id) {
    var s = stores();
    var E = (s.KE && s.KE.byId) ? (s.KE.byId[id] || s.KE.byId[String(id).toLowerCase()] || s.KE.byId[String(id).toUpperCase()]) : null;
    var DX = s.DX[id] || s.DX[String(id).toLowerCase()] || s.DX[String(id).toUpperCase()] || null;
    var Traw = s.KR[id] || s.KR[String(id).toUpperCase()] || s.KR[String(id).toLowerCase()] || null;
    return { E: E, DX: DX, Traw: Traw };
  }
  // Resolve the disease the question is about. Prefer the engine's package
  // (pkg.grounding — the authoritative topic match); fall back to a name index.
  function resolveTarget(question, pkg) {
    var id = null, name = null, confident = false, tm = pkg && pkg.topicMatch;
    if (pkg && pkg.grounding && pkg.grounding.length) {
      id = pkg.grounding[0].diseaseId; name = pkg.grounding[0].name;
      confident = tm ? (tm.matched === true && tm.mode !== "assume") : true;
    } else if (tm && tm.assume && tm.assume.id) {
      id = tm.assume.id; name = tm.assume.name; confident = false;   // ASSUME tier → not confident
    }
    var s = id ? lookupStores(id) : { E: null, DX: null, Traw: null };
    // Fallback: resolve by unified name index if the package gave us nothing usable.
    if (!s.E && !s.DX && !s.Traw) {
      var qn = medNorm(expandAbbrev(question));
      var idx = buildNameIndex(), best = null;
      for (var i = 0; i < idx.length; i++) {
        var it = idx[i];
        if (qn.indexOf(it.key) >= 0) { if (!best || it.key.length > best.key.length) best = it; }
      }
      if (best) { id = best.id; name = best.name; s = lookupStores(id); confident = false; }   // name-index hit is weaker than engine grounding
    }
    if (!s.E && !s.DX && !s.Traw) return null;
    var T = (pkg && pkg.treatment && (pkg.treatment.default || pkg.treatment.recommendations)) ? pkg.treatment : null;
    return {
      id: id, name: name || displayName(id, s.E),
      source: (s.E && s.E.source) || "StewardMD Knowledge Base", pages: (s.E && s.E.pages) || "",
      confident: confident, E: s.E, T: T, Traw: s.Traw, DX: s.DX
    };
  }

  // ---------------------------------------------------------- citations ------
  function citeSrc(t) {
    var s = (t.E && t.E.source) || (t.DX ? "StewardMD Knowledge Base (Harrison-aligned)" : "StewardMD Knowledge Base");
    return t.pages ? (s + ", " + t.pages) : s;
  }

  // ------------------------------------------------- per-intent composers ----
  // Each returns { text, ok } — ok=false means the KB lacks the field → caller
  // must fall through to Gemini (never fabricate).
  function composeDefinition(t) {
    var E = t.E, dxLine = t.DX && t.DX.dx;
    var lead = dxLine || E.pathophysiology;
    if (!lead) return { ok: false };
    var body = ["**" + t.name + "** — " + clip(String(lead).replace(/\s+/g, " "), 420)];
    var pearls = arr(E.clinicalPearls);
    if (pearls.length) { body.push("\n**Key points**\n" + bullets(pearls, 4)); }
    if (E.pathophysiology && dxLine) body.push("\n**Pathophysiology.** " + clip(E.pathophysiology, 340));
    body.push("\n_" + citeSrc(t) + " · decision-support — verify with local protocol._");
    return { ok: true, text: body.join("\n") };
  }
  function composeFeatures(t) {
    var E = t.E, pearls = arr(E.clinicalPearls);
    if (!pearls.length) return { ok: false };
    return { ok: true, text: "**Clinical features of " + t.name + "**\n" + bullets(pearls, 7) + "\n\n_" + citeSrc(t) + " · verify clinically._" };
  }
  function composePatho(t) {
    if (!t.E.pathophysiology) return { ok: false };
    return { ok: true, text: "**Pathophysiology of " + t.name + "**\n\n" + clip(t.E.pathophysiology, 700) + "\n\n_" + citeSrc(t) + "._" };
  }
  function composeDifferential(t) {
    var E = t.E, ddx = arr(E.additionalDifferentials).concat(arr(E.infectionMimics)).concat(arr(E.nonInfectiousMimics));
    if (!ddx.length) return { ok: false };
    return { ok: true, text: "**Differential diagnosis / mimics of " + t.name + "**\n" + bullets(ddx, 9) + "\n\n_" + citeSrc(t) + " · consider the clinical context._" };
  }
  function composeInvestigation(t) {
    var ix = (t.DX && arr(t.DX.ix)) || [];
    ix = ix.concat(arr(t.E.additionalInvestigations));
    // dedup
    var seen = {}, out = []; ix.forEach(function (x) { var k = norm(x); if (k && !seen[k]) { seen[k] = 1; out.push(x); } });
    if (!out.length) return { ok: false };
    return { ok: true, text: "**Investigations / workup for " + t.name + "**\n" + bullets(out, 9) + "\n\n_" + citeSrc(t) + "._" };
  }
  function composeRedFlags(t) {
    if (!nonEmpty(t.E.redFlags)) return { ok: false };
    return { ok: true, text: "**Red flags in " + t.name + "** — escalate if present:\n" + bullets(t.E.redFlags, 6) + "\n\n_" + citeSrc(t) + "._" };
  }
  function composePitfalls(t) {
    if (!nonEmpty(t.E.pitfalls)) return { ok: false };
    return { ok: true, text: "**Common pitfalls in " + t.name + "**\n" + bullets(t.E.pitfalls, 6) + "\n\n_" + citeSrc(t) + "._" };
  }
  function composePrognosis(t) {
    if (!t.E.prognosis) return { ok: false };
    return { ok: true, text: "**Prognosis of " + t.name + "**\n\n" + clip(t.E.prognosis, 500) + "\n\n_" + citeSrc(t) + "._" };
  }
  function composeSeverity(t) {
    if (!t.E.severityClassification) return { ok: false };
    return { ok: true, text: "**Severity / classification of " + t.name + "**\n\n" + clip(t.E.severityClassification, 600) + "\n\n_" + citeSrc(t) + "._" };
  }
  // Treatment: prefer the package's resolved treatment (precedence-applied), else
  // KB_RAG regimen, else the DX_MGMT tx brief. Emits the actual dosing.
  function regimenLines(recs, maxRec) {
    var out = [];
    arr(recs).slice(0, maxRec || 3).forEach(function (rec) {
      var head = cap(rec.line || rec.tier || "Regimen");
      var drugs = arr(rec.drugRefs).slice(0, 5).map(function (d) {
        var dose = [d.dose, d.route, d.freq, d.duration && ("for " + d.duration)].filter(Boolean).join(" · ");
        return "- **" + (d.regimenLabel || d.composition || d.drug) + "**" + (dose ? " — " + dose : "");
      });
      if (drugs.length) out.push("**" + head + "**\n" + drugs.join("\n"));
    });
    return out.join("\n\n");
  }
  function composeTreatment(t) {
    var parts = [], t2 = t.T, traw = t.Traw, dx = t.DX;
    var precedence = (t2 && t2.precedence) || (traw && traw.precedence);
    // dosing from resolved package
    if (t2 && t2.default && (t2.default.dosing || t2.default.line)) {
      var d = t2.default, dl = [];
      if (d.line) dl.push(clip(d.line, 220));
      arr(d.dosing).slice(0, 6).forEach(function (x) {
        var dose = [x.dose, x.route, x.freq, x.duration && ("for " + x.duration)].filter(Boolean).join(" · ");
        dl.push("- **" + (x.drug || x.label) + "**" + (dose ? " — " + dose : ""));
      });
      if (dl.length) parts.push("**First-line**\n" + dl.join("\n"));
    } else if (traw && traw.recommendations) {
      var rl = regimenLines(traw.recommendations, 3);
      if (rl) parts.push(rl);
    }
    // management steps from the DX_MGMT brief
    if (dx && nonEmpty(dx.tx)) parts.push("**Management**\n" + bullets(dx.tx, 6));
    if (!parts.length) return { ok: false };
    var head = "**Treatment of " + t.name + "**" + (precedence && precedence.length ? " _(precedence: " + arr(precedence).join(" ▸ ") + ")_" : "");
    return { ok: true, text: head + "\n\n" + parts.join("\n\n") + "\n\n_" + citeSrc(t) + " · doses are standard references — verify locally._" };
  }
  // Extract the specific agent the clinician named in a dose query ("dose of amiodarone in AF"
  // → "amiodarone"), stripping the disease/filler words. Returns "" for a generic "dosing in X".
  function askedDrug(qn, diseaseName) {
    var m = qn.match(/dos(?:e|ing|age)\s+(?:of|for)\s+([a-z][a-z0-9\-]{2,}(?:\s+[a-z0-9\-]{2,})?)/) ||
            qn.match(/\b([a-z][a-z0-9\-]{3,})\s+dos(?:e|ing|age)\b/) ||
            qn.match(/how much\s+([a-z][a-z0-9\-]{3,})/);
    if (!m) return "";
    var dn = norm(diseaseName || "");
    var toks = m[1].trim().split(/\s+/).filter(function (x) { return x.length >= 3 && dn.indexOf(x) < 0 && ["the", "for", "in", "of", "adult", "child", "paediatric", "pediatric", "acute", "severe", "chronic"].indexOf(x) < 0; });
    return toks.join(" ");
  }
  // Dose: only quote a dose that is in the KB regimen for the named agent. SAFETY: if the clinician
  // names a specific drug the KB regimen does NOT contain, DEFER (never present a different drug's
  // dose under that query, e.g. "dose of amiodarone" must not show metoprolol). Never invents a number.
  function composeDose(t, question) {
    var qn = norm(question);
    var refs = [];
    if (t.T && t.T.default && t.T.default.dosing) refs = t.T.default.dosing.map(function (x) { return { name: x.drug || x.label, dose: x.dose, route: x.route, freq: x.freq, duration: x.duration, why: x.why }; });
    if (t.Traw && t.Traw.recommendations) t.Traw.recommendations.forEach(function (r) { arr(r.drugRefs).forEach(function (d) { refs.push({ name: d.regimenLabel || d.composition, dose: d.dose, route: d.route, freq: d.freq, duration: d.duration, why: d.why }); }); });
    if (!refs.length) return { ok: false };
    function drugMatch(r) { return norm(r.name).split(/[ \-()]+/).some(function (w) { return w.length >= 4 && qn.indexOf(w) >= 0; }); }
    var hit = refs.filter(drugMatch);
    var wanted = askedDrug(qn, t.name);
    if (wanted && !hit.length) return { ok: false };            // named drug not in the KB regimen → DEFER (never show a different drug)
    var show = hit.length ? hit : refs;                         // generic "dosing in X" → show the regimen
    var lines = show.slice(0, 5).map(function (r) {
      var dose = [r.dose, r.route, r.freq, r.duration && ("for " + r.duration)].filter(Boolean).join(" · ");
      return "- **" + r.name + "**" + (dose ? " — " + dose : "") + (r.why ? "\n  " + clip(r.why, 140) : "");
    });
    if (!lines.filter(function (l) { return /—/.test(l); }).length) return { ok: false };   // no actual dose figure
    var lead = (wanted && hit.length) ? ("**" + cap(wanted) + " — dosing in " + t.name + "**") : ("**Dosing — " + t.name + "**");
    return { ok: true, text: lead + "\n" + lines.join("\n") + "\n\n_" + citeSrc(t) + " · standard references, verify locally._" };
  }

  var COMPOSERS = {
    definition: composeDefinition, features: composeFeatures, pathophysiology: composePatho,
    differential: composeDifferential, investigation: composeInvestigation, redflags: composeRedFlags,
    pitfalls: composePitfalls, prognosis: composePrognosis, severity: composeSeverity,
    treatment: composeTreatment, dose: composeDose
  };

  // -------------------------------------------------- refine-chip builder ----
  // Offers OTHER intents the KB can answer for this disease → deterministic chips.
  function refineLine(t, intent) {
    var avail = [], E = t.E;
    if (intent !== "treatment" && (t.Traw || (t.DX && nonEmpty(t.DX.tx)) || (t.T && t.T.default))) avail.push("treatment");
    if (intent !== "dose" && (t.Traw || (t.T && t.T.default && t.T.default.dosing))) avail.push("dose");
    if (intent !== "differential" && (nonEmpty(E.additionalDifferentials) || nonEmpty(E.infectionMimics))) avail.push("differentials");
    if (intent !== "investigation" && ((t.DX && nonEmpty(t.DX.ix)) || nonEmpty(E.additionalInvestigations))) avail.push("investigations");
    if (intent !== "redflags" && nonEmpty(E.redFlags)) avail.push("red flags");
    if (intent !== "features" && nonEmpty(E.clinicalPearls)) avail.push("clinical features");
    if (intent !== "definition" && (E.pathophysiology || (t.DX && t.DX.dx))) avail.push("overview");
    avail = avail.slice(0, 4);
    return avail.length ? ("\n\n@@REFINE:" + avail.join(" | ") + "@@") : "";
  }

  // ------------------------------------------------------------ compose ------
  // Returns { text, confidence(0..1), intent, mode, evidence } or null.
  function compose(question, pkg, opts) {
    try {
      if (!question) return null;
      if (isComplex(question)) return null;                         // reasoning → Gemini
      var t = resolveTarget(question, pkg);
      if (!t) return null;
      if (!t.E) t.E = {};                                           // enrichment-absent (e.g. DX_MGMT-only toxicology) → composers stay null-safe
      if (!t.confident) return null;                                // ASSUME / weak → Gemini (it can caveat)
      var intent = classifyIntent(question);
      var composer = COMPOSERS[intent] || composeDefinition;
      var res = composer(t, question);
      if (!res || !res.ok || !res.text) return null;                // KB lacks the field → Gemini
      // confidence: confident target + populated field. Slightly higher when the
      // engine (not the name-index) resolved it and the treatment/dose is structured.
      var conf = 0.82;
      if (pkg && pkg.grounding && pkg.grounding.length) conf += 0.06;
      if ((intent === "treatment" || intent === "dose") && t.T && t.T.default) conf += 0.05;
      conf = Math.min(0.97, conf);
      var text = res.text + refineLine(t, intent);
      return { text: text, confidence: conf, intent: intent, mode: "kb-instant", disease: t.name, evidence: citeSrc(t) };
    } catch (e) { return null; }
  }

  var API = {
    compose: compose,
    classifyIntent: classifyIntent,
    isComplex: isComplex,
    expandAbbrev: expandAbbrev,
    resolveTarget: resolveTarget,
    _version: "v2.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;   // node tests
  G.MaiKKB = API;
})();
