/* onco-home.js — Onco Home reference workbench (window.SMD_ONCOHOME). Phase 8 P0.
 * Buildless ES5 IIFE. Full-screen overlay (#smdOncoHome) with open()/close(), a delegated click
 * handler and a paint()-style render, mirroring queue.js/opd-emr.js.
 *
 * This is a REFERENCE / TOOL LIBRARY (global search + a grouped tool grid), the complement to the
 * existing onco-*.js patient TREATMENT-PLAN executor. It never stores clinical content of its own —
 * every card/result deep-links into an EXISTING StewardMD asset:
 *   - Calculators & Prognostic Scores -> window.MEDCALC        (calculators.js, 405 calcs incl.
 *     ECOG/Karnofsky/Khorana/Calvert/Cockcroft-Gault — MEDCALC.list()/.open(id)/.openList(cat))
 *   - Diseases / Knowledge Base       -> window.KB_ENRICHMENT.byId (kb-loader.js-injected KB),
 *     filtered to oncology-tagged entries; opened via window.DX.openRef(id) (reasoning.js)
 *   - Drugs & Interactions            -> window.MEDDRUGS       (drugs.js ward formulary +
 *     interaction checker — MEDDRUGS.searchIndex(q)/.openList()/.openInteractions())
 *   - Protocols                       -> kb/protocols/index.json (id/name/lifecycleState metadata
 *     only) + window.OPDEMR.openProfile({tab:"onco"}) for the patient-scoped treatment-plan matrix
 *     (onco-protocols.js) — protocols are per-patient, so this needs a Ward Sync patient selected.
 *   - AJCC/TNM Staging, CTCAE, IO Toxicity -> NOT built yet (P1/P2). Rendered as labelled
 *     placeholders, never fabricated tables.
 *
 * Search is a pure, deterministic function (substring + a small abbreviation map) — NO LLM ever
 * decides a dose/stage/score here. Flag: smd_onco_home (queue-flags.js), default OFF.
 * window.SMD_ONCOHOME + module.exports (the pure search fn, for node --test). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ==========================================================================================
   * Deterministic query expansion — a small oncology abbreviation/synonym map. Most KB entries
   * already contain the abbreviation verbatim (e.g. "NSCLC" appears in Lung Cancer's text), so
   * this is defense-in-depth for the entries/buckets that don't spell it out.
   * ========================================================================================== */
  var ABBR = {
    nsclc: "non small cell lung cancer", sclc: "small cell lung cancer",
    egfr: "epidermal growth factor receptor", alk: "anaplastic lymphoma kinase",
    her2: "human epidermal growth factor receptor 2", "her-2": "human epidermal growth factor receptor 2",
    pdl1: "programmed death ligand 1", "pd-l1": "programmed death ligand 1", pd1: "programmed death 1",
    cll: "chronic lymphocytic leukaemia", aml: "acute myeloid leukaemia", all: "acute lymphoblastic leukaemia",
    cml: "chronic myeloid leukaemia", nhl: "non hodgkin lymphoma", hl: "hodgkin lymphoma",
    dlbcl: "diffuse large b cell lymphoma", rcc: "renal cell carcinoma",
    hcc: "hepatocellular carcinoma", crc: "colorectal cancer", gist: "gastrointestinal stromal tumour",
    mds: "myelodysplastic syndrome", vte: "venous thromboembolism", cup: "carcinoma of unknown primary",
    tnm: "tumour node metastasis staging", ctcae: "common terminology criteria for adverse events",
    rchop: "r-chop", "r-chop": "rchop"
  };
  function expandTerms(qLower) {
    var out = [qLower];
    if (ABBR[qLower]) out.push(ABBR[qLower]);
    return out;
  }
  // Short terms (<=4 chars, e.g. "ecog") need a WORD-BOUNDARY match — a plain substring test lets
  // "ecog" false-positive-match inside "Recognition" (R-ECOG-nition). Longer terms/phrases stay a
  // simple substring test (mirrors the rest of the app's search — kbHasTok in reasoning.js applies
  // the same short-token whole-word rule).
  function hasTerm(text, term) {
    if (!term) return false;
    if (term.length > 4 || term.indexOf(" ") >= 0) return text.indexOf(term) >= 0;
    try { return new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text); } catch (e) { return text.indexOf(term) >= 0; }
  }
  function hay(text, terms) {
    text = (text || "").toLowerCase();
    for (var i = 0; i < terms.length; i++) { if (terms[i] && hasTerm(text, terms[i])) return true; }
    return false;
  }

  /* ==========================================================================================
   * Adapters over EXISTING data sources. Never a local copy of clinical content — these read the
   * live globals injected by calculators.js / kb-loader.js / drugs.js and cache only a cheap index.
   * ========================================================================================== */
  function calcCatalog() { try { return (G.MEDCALC && G.MEDCALC.list) ? G.MEDCALC.list() : []; } catch (e) { return []; } }

  var ONCO_KB_RE = /onco|cancer|leukaemia|leukemia|lymphoma|myelom|carcinom|sarcoma|neoplas|malignan/i;
  var _kbIdx = null;
  function kbIndex() {
    if (_kbIdx && _kbIdx.length) return _kbIdx;   // never cache an empty index — the KB script may still be loading
    var H = (G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId) || {};
    var arr = [];
    for (var id in H) {
      if (!Object.prototype.hasOwnProperty.call(H, id)) continue;
      var d = H[id] || {};
      if (!ONCO_KB_RE.test((d.system || "") + " " + (d.name || ""))) continue;
      var extra = [].concat(d.clinicalPearls || [], d.pathophysiology || [], d.redFlags || []).join(" ");
      var text = ((d.name || "") + " " + id.replace(/_/g, " ") + " " + (d.system || "") +
        " " + (d.aliases || []).join(" ") + " " + extra).toLowerCase();
      arr.push({ id: id, name: d.name || id, system: d.system || "", text: text });
    }
    arr.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    if (arr.length) _kbIdx = arr;
    return arr;
  }

  function drugSearch(qLower) { try { return (G.MEDDRUGS && G.MEDDRUGS.searchIndex) ? G.MEDDRUGS.searchIndex(qLower) : []; } catch (e) { return []; } }

  // Protocol metadata only (id/name/diseaseId/lifecycleState) — the actual template content
  // (drugs/doses) lives server-side and is never fetched/duplicated here.
  var _protocols = [];
  function loadProtocols() {
    if (!G.fetch) return;
    try {
      G.fetch("/kb/protocols/index.json").then(function (r) { return (r && r.ok) ? r.json() : null; })
        .then(function (j) { _protocols = (j && (j.protocols || j)) || []; if (!(_protocols instanceof Array)) _protocols = []; })
        .catch(function () {});
    } catch (e) {}
  }

  /* ==========================================================================================
   * PURE, deterministic, unit-testable categorized search. No LLM, ever — every hit routes to an
   * existing tool that owns the real computation/content.
   * ========================================================================================== */
  function search(q) {
    q = String(q == null ? "" : q).trim().toLowerCase();
    if (!q) return { diseases: [], calculators: [], drugs: [], protocols: [] };
    var terms = expandTerms(q);

    var calculators = calcCatalog().filter(function (c) {
      return hay((c.title || "") + " " + (c.desc || "") + " " + (c.cat || "") + " " + (c.id || ""), terms);
    }).sort(function (a, b) {
      var ao = a.cat === "Oncology" ? 0 : 1, bo = b.cat === "Oncology" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return String(a.title || "").localeCompare(String(b.title || ""));
    }).map(function (c) { return { id: c.id, title: c.title, cat: c.cat, desc: c.desc }; });

    var diseases = kbIndex().filter(function (d) { return hay(d.text, terms); })
      .map(function (d) { return { id: d.id, name: d.name, system: d.system }; });

    var drugsOut = [], seenGen = {};
    for (var ti = 0; ti < terms.length; ti++) {
      drugSearch(terms[ti]).forEach(function (d) {
        if (seenGen[d.generic]) return;
        seenGen[d.generic] = true;
        drugsOut.push({ generic: d.generic, cls: d.cls, brands: d.brands, dose: d.dose });
      });
    }

    var protocols = (_protocols || []).filter(function (p) {
      return hay((p.name || "") + " " + (p.id || "") + " " + (p.diseaseId || ""), terms);
    }).map(function (p) { return { id: p.id, name: p.name, diseaseId: p.diseaseId, lifecycleState: p.lifecycleState }; });

    return { diseases: diseases, calculators: calculators, drugs: drugsOut, protocols: protocols };
  }

  /* ==========================================================================================
   * Overlay UI — mirrors queue.js: #smdOncoHome, open()/close(), one delegated click handler.
   * The header + search input are painted ONCE (paintShell); only #ohResults is repainted per
   * keystroke, so typing never blurs the input (same fix queue.js applies to its live search).
   * ========================================================================================== */
  var st = { q: "", ctx: null, mode: null, favIndex: {} };

  /* ---- Feature 4: Favorites + Recent (onco-favorites.js). Pure UX, no clinical content. Star a tool
   * card / disease / calculator, and a recent-items list across Onco Home. Star rendering + recording
   * are entirely no-op unless the flag is on AND window.SMD_ONCOFAV loaded (private-mode safe). ---- */
  function favOn() { return flag("smd_onco_favorites") && !!G.SMD_ONCOFAV; }
  function starHtml(item) {
    if (!favOn()) return "";
    st.favIndex[item.id] = item;
    var on = false; try { on = G.SMD_ONCOFAV.has(item.id); } catch (e) {}
    return '<button class="oh-star' + (on ? " on" : "") + '" data-oh-fav="' + esc(item.id) + '" aria-label="' + (on ? "Remove favourite" : "Add favourite") + '">' + (on ? "★" : "☆") + "</button>";
  }
  // Wrap navigational HTML with a star sibling (never nested inside the button) when favorites is on.
  function wrapStar(inner, item, cls) { var s = starHtml(item); return s ? '<div class="' + (cls || "oh-star-row") + '">' + inner + s + "</div>" : inner; }
  function favRowHtml(item) {
    st.favIndex[item.id] = item;
    var inner = '<button class="oh-favchip" data-oh-act="' + esc(item.act) + '"><span class="oh-favchip-t">' + esc(item.label) + "</span></button>";
    return wrapStar(inner, item, "oh-star-row");
  }
  function favSection() {
    if (!favOn()) return "";
    var favs = [], recents = [];
    try { favs = G.SMD_ONCOFAV.all() || []; } catch (e) {}
    try { recents = G.SMD_ONCOFAV.recent() || []; } catch (e) {}
    if (!favs.length && !recents.length) return "";
    var out = "";
    if (favs.length) out += '<div class="oh-grp"><div class="oh-grp-h">Favourites</div><div class="oh-favlist">' + favs.map(favRowHtml).join("") + "</div></div>";
    if (recents.length) out += '<div class="oh-grp"><div class="oh-grp-h">Recent</div><div class="oh-favlist">' + recents.map(favRowHtml).join("") + "</div></div>";
    return out;
  }
  function toggleFav(id) {
    try { if (G.SMD_ONCOFAV) G.SMD_ONCOFAV.toggle(st.favIndex[id] || { id: id, label: id, act: "" }); } catch (e) {}
    renderResults();
  }
  function recordRecent(b, act) {
    if (!favOn() || !act) return;
    var labelEl = b && b.querySelector ? (b.querySelector(".oh-card-t") || b.querySelector(".oh-row-t") || b.querySelector(".oh-favchip-t")) : null;
    var label = labelEl ? labelEl.textContent : (b && b.textContent) || act;
    try { G.SMD_ONCOFAV.record({ id: act, label: String(label || act).trim(), act: act }); } catch (e) {}
  }

  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_home")); } catch (e) { return false; } }
  function flag(name) { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool(name)); } catch (e) { return false; } }
  // Tall-man (item 2): applied only when smd_onco_tallman is on; a no-op otherwise. Never fabricates.
  function tallman(name) { try { return (G.SMD_ONCOTALLMAN && flag("smd_onco_tallman")) ? G.SMD_ONCOTALLMAN.apply(name) : name; } catch (e) { return name; } }
  function rootEl() { var el = document.getElementById("smdOncoHome"); if (!el) { el = document.createElement("div"); el.id = "smdOncoHome"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }

  // Best-effort identity-only read of the Ward Sync selected patient (name/mrn — GHIS exposes no
  // vitals/labs accessor today; see the "concerns" note in the PR/report). Callers may instead pass
  // an explicit ctx to open({...}) — this is the primary, fully-tested path (unit + CDP).
  function livePatientContext() {
    try {
      var p = G.GHISMEDS && G.GHISMEDS.getSelectedPatient && G.GHISMEDS.getSelectedPatient();
      if (p && p.patientId) return { patient: { name: p.name, patientId: p.patientId } };
    } catch (e) {}
    return null;
  }

  function chip(label, kind) { return '<span class="oh-chip oh-chip-' + esc(kind || "") + '">' + esc(label) + "</span>"; }
  function bsaChip(ctx) {
    if (!ctx || !(ctx.heightCm > 0) || !(ctx.weightKg > 0)) return "";
    var bsa = null;
    try { bsa = (G.SMD_ONCODOSE && G.SMD_ONCODOSE.bsaMosteller) ? G.SMD_ONCODOSE.bsaMosteller(ctx.heightCm, ctx.weightKg) : null; } catch (e) {}
    if (bsa == null) return "";
    return chip("BSA " + (Math.round(bsa * 100) / 100) + " m2 (computed)", "calc");
  }
  // Patient-context strip: VERIFY/EDIT chips only — never an auto-decision. Hidden entirely when
  // no context is available (nothing to show beats a fabricated default).
  function contextStrip(ctx) {
    if (!ctx) return "";
    var chips = [];
    if (ctx.patient && ctx.patient.name) chips.push(chip(ctx.patient.name + (ctx.patient.patientId ? " #" + ctx.patient.patientId : ""), "id"));
    if (ctx.age != null) chips.push(chip(ctx.age + " yrs", "verify"));
    if (ctx.sex) chips.push(chip(String(ctx.sex).toUpperCase(), "verify"));
    if (ctx.heightCm != null) chips.push(chip(ctx.heightCm + " cm", "verify"));
    if (ctx.weightKg != null) chips.push(chip(ctx.weightKg + " kg", "verify"));
    if (ctx.creatinine != null) chips.push(chip("Creat " + ctx.creatinine + " mg/dL", "verify"));
    if (ctx.renal) chips.push(chip(ctx.renal, "verify"));
    if (ctx.diagnosis) chips.push(chip(ctx.diagnosis, "verify"));
    var bsa = bsaChip(ctx);
    if (!chips.length && !bsa) return "";
    return '<section class="oh-ctx"><div class="oh-ctx-h">Patient data<span class="oh-ctx-tag">verify / edit</span></div>' +
      '<div class="oh-ctx-row">' + chips.join("") + bsa + "</div>" +
      '<div class="oh-ctx-note">For reference only. StewardMD never auto-decides a dose, stage or score from this.</div></section>';
  }

  function evForCalc(c) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.forCalculator) ? G.SMD_ONCOEV.forCalculator({ id: c.id, title: c.title, cat: c.cat, interpretation: c.desc }) : ""; } catch (e) { return ""; } }
  function evForDisease(d) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.forDisease) ? G.SMD_ONCOEV.forDisease(d) : ""; } catch (e) { return ""; } }

  function resultSection(label, itemsHtml) { return itemsHtml ? '<div class="oh-sec"><div class="oh-sec-h">' + esc(label) + "</div>" + itemsHtml + "</div>" : ""; }
  function calcRowHtml(c) { var inner = '<button class="oh-row" data-oh-act="calc:' + esc(c.id) + '"><span class="oh-row-t">' + esc(c.title) + '</span><span class="oh-row-s">' + esc(c.cat || "") + "</span>" + evForCalc(c) + "</button>"; return wrapStar(inner, { id: "calc:" + c.id, label: c.title, act: "calc:" + c.id }, "oh-star-row"); }
  function diseaseRowHtml(d) { var inner = '<button class="oh-row" data-oh-act="kb:' + esc(d.id) + '"><span class="oh-row-t">' + esc(d.name) + '</span><span class="oh-row-s">' + esc(d.system || "") + "</span>" + evForDisease(d) + "</button>"; return wrapStar(inner, { id: "kb:" + d.id, label: d.name, act: "kb:" + d.id }, "oh-star-row"); }
  function drugRowHtml(d) { return '<button class="oh-row" data-oh-act="drug-browse"><span class="oh-row-t">' + esc(d.generic) + '</span><span class="oh-row-s">' + esc(d.cls || "") + "</span></button>"; }
  function protocolRowHtml(p) { return '<button class="oh-row" data-oh-act="protocol-open"><span class="oh-row-t">' + esc(p.name || p.id) + '</span><span class="oh-row-s">' + esc(p.lifecycleState || "") + "</span></button>"; }

  function searchResultsHtml(r) {
    var any = r.calculators.length || r.diseases.length || r.drugs.length || r.protocols.length;
    if (!any) return '<div class="oh-empty">No matches. Try a drug name, a calculator (e.g. Khorana), or a disease/abbreviation (e.g. NSCLC).</div>';
    return resultSection("Calculators & Scores", r.calculators.map(calcRowHtml).join("")) +
      resultSection("Diseases", r.diseases.map(diseaseRowHtml).join("")) +
      resultSection("Drugs", r.drugs.map(drugRowHtml).join("")) +
      resultSection("Protocols", r.protocols.map(protocolRowHtml).join(""));
  }

  function quickActionsHtml() {
    return '<div class="oh-quick">' +
      '<button class="oh-qa" data-oh-act="calc-cat">Calculators</button>' +
      '<button class="oh-qa" data-oh-act="drug-browse">Drugs</button>' +
      '<button class="oh-qa" data-oh-act="drug-interactions">Interactions</button>' +
      '<button class="oh-qa" data-oh-act="protocol-open">Protocols</button>' +
      "</div>";
  }

  var GRID = [
    { group: "Diagnosis & Staging", cards: [
      { title: "Diseases & Knowledge Base", sub: "Oncology reference (KB)", act: "kb-browse" },
      { title: "AJCC / TNM Staging", sub: "TNM framework + honest gaps (R1-pending)", act: "staging-open", flag: "smd_onco_staging", phSub: "Coming in P1" }
    ] },
    { group: "Treatment", cards: [
      { title: "Treatment-Plan Protocols", sub: "Tata-style dose matrix (per patient)", act: "protocol-open" },
      { title: "Protocol Reference", sub: "Read-only library (lifecycle badges)", act: "protoref-open", flag: "smd_onco_protoref" }
    ] },
    { group: "Monitoring", cards: [
      { title: "Toxicity / CTCAE", sub: "CTCAE v5.0 grading (R1-pending)", act: "ctcae-open", flag: "smd_onco_ctcae", phSub: "Coming in P2" },
      { title: "IO Toxicity (irAE)", sub: "irAE management principles (ASCO / NCCN / SITC)", act: "iotox-open", flag: "smd_onco_iotox", phSub: "Coming in P2" }
    ] },
    { group: "Response assessment", cards: [
      { title: "RECIST 1.1", sub: "Target-lesion response calculator", act: "recist-open", flag: "smd_onco_recist", phSub: "Coming in P2" }
    ] },
    { group: "Medication", cards: [
      { title: "Drug Info & Interaction", sub: "Formulary + interaction checker", act: "drug-browse" }
    ] },
    { group: "Prognosis", cards: [
      { title: "Prognostic Scores", sub: "ECOG, Karnofsky, Khorana, IPI...", act: "calc-cat" }
    ] },
    { group: "Evidence", cards: [
      { title: "Formulas", sub: "BSA, Calvert, Cockcroft-Gault...", act: "calc-cat" }
    ] }
  ];
  function cardHtml(c) {
    // A flag-gated card: when its flag is OFF, show a labelled placeholder if it has phSub, else omit
    // entirely (never a broken/dead link). When ON, it is a real active card.
    if (c.flag && !flag(c.flag)) {
      if (!c.phSub) return "";
      return '<div class="oh-card oh-card-ph" aria-disabled="true"><div class="oh-card-t">' + esc(c.title) + '</div><div class="oh-card-s">' + esc(c.phSub) + "</div></div>";
    }
    if (c.placeholder) return '<div class="oh-card oh-card-ph" aria-disabled="true"><div class="oh-card-t">' + esc(c.title) + '</div><div class="oh-card-s">' + esc(c.sub) + "</div></div>";
    var inner = '<button class="oh-card" data-oh-act="' + esc(c.act) + '"><div class="oh-card-t">' + esc(c.title) + '</div><div class="oh-card-s">' + esc(c.sub) + "</div></button>";
    return wrapStar(inner, { id: "card:" + c.act, label: c.title, act: c.act }, "oh-card-wrap");
  }
  function gridHtml() {
    return GRID.map(function (g) { return '<div class="oh-grp"><div class="oh-grp-h">' + esc(g.group) + '</div><div class="oh-grid">' + g.cards.map(cardHtml).join("") + "</div></div>"; }).join("");
  }
  function kbBrowseHtml() {
    var list = kbIndex();
    return '<button class="oh-back-inline" data-oh-act="kb-browse">&lsaquo; Back</button>' +
      '<div class="oh-sec-h">Oncology diseases (' + list.length + ")</div>" + list.map(diseaseRowHtml).join("");
  }

  /* ---- Feature 3: oncology drug + interaction view (reuses MEDDRUGS + onco-tallman, never a new DB) ---- */
  // Supportive-care filter over the REAL ward formulary (drugs.js) — no doses invented, no drug added.
  var ONCO_SUPPORT_RE = /antiemetic|ondansetron|metoclopramide|domperidone|dexamethasone|prednisolone|methylprednisolone|hydrocortisone|corticosteroid|enoxaparin|heparin|dalteparin|morphine|fentanyl|tramadol|lorazepam|allopurinol|filgrastim|granisetron|palonosetron|aprepitant/i;
  function oncoSupportive(list) {
    return (list || []).filter(function (d) { return ONCO_SUPPORT_RE.test((d.generic || "") + " " + (d.cls || "")); });
  }
  function drugOncoHtml() {
    var tm = (G.SMD_ONCOTALLMAN && G.SMD_ONCOTALLMAN.MAP) || {};
    var tmOn = flag("smd_onco_tallman"), tmRows = "";
    for (var gen in tm) {
      if (!Object.prototype.hasOwnProperty.call(tm, gen)) continue;
      var disp = tmOn ? tm[gen].tallman : (gen.charAt(0).toUpperCase() + gen.slice(1));
      var partners = (G.SMD_ONCOTALLMAN.confusedWith(gen) || []).join(", ");
      tmRows += '<div class="oh-row oh-row-static"><span class="oh-row-t">' + esc(disp) + '</span><span class="oh-row-s">Look-alike name: confused with ' + esc(partners) + "</span></div>";
    }
    var tmEv = "";
    try { tmEv = (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build([{ kind: "guideline", why: "Tall-man lettering reduces look-alike drug-name errors.", source: { name: (G.SMD_ONCOTALLMAN && G.SMD_ONCOTALLMAN.SOURCE) || "ISMP" } }]) : ""; } catch (e) {}
    var list = []; try { list = (G.MEDDRUGS && G.MEDDRUGS._list) || []; } catch (e) {}
    var supRows = oncoSupportive(list).map(function (d) {
      return '<button class="oh-row" data-oh-act="drug-formulary"><span class="oh-row-t">' + esc(tallman(d.generic)) + '</span><span class="oh-row-s">' + esc(d.cls || "") + "</span></button>";
    }).join("");
    return '<button class="oh-back-inline" data-oh-act="home-dash">&lsaquo; Back</button>' +
      '<div class="oh-sec-h">Oncology drugs &amp; interactions</div>' +
      '<div class="oh-quick"><button class="oh-qa" data-oh-act="drug-interactions">Interaction check</button><button class="oh-qa" data-oh-act="drug-formulary">Full formulary</button></div>' +
      '<div class="oh-sec"><div class="oh-sec-h">Antineoplastic agents (tall-man names)</div>' + (tmRows || '<div class="oh-empty">Tall-man table unavailable.</div>') + tmEv + "</div>" +
      '<div class="oh-sec"><div class="oh-sec-h">Oncology supportive care (from formulary)</div>' + (supRows || '<div class="oh-empty">No supportive-care drugs found in the formulary.</div>') + "</div>" +
      '<div class="oh-ctx-note">Names shown for look-alike safety. Formulary doses are adult reference values, verify before use. No prescription is created here.</div>';
  }

  /* ---- Feature 4: protocol reference library (read-only; distinct from the per-patient matrix) ---- */
  function protoBadge(state) {
    if (state === "draft") return '<span class="oh-badge oh-badge-draft">DRAFT - not activated</span>';
    return state ? '<span class="oh-badge">' + esc(state) + "</span>" : "";
  }
  function protoRefHtml() {
    var rows = (_protocols || []).map(function (p) {
      return '<div class="oh-row oh-row-static"><span class="oh-row-t">' + esc(p.name || p.id) + " " + protoBadge(p.lifecycleState) + '</span><span class="oh-row-s">' + esc((p.diseaseId || "") + (p.version ? " · v" + p.version : "")) + "</span></div>";
    }).join("");
    return '<button class="oh-back-inline" data-oh-act="home-dash">&lsaquo; Back</button>' +
      '<div class="oh-sec-h">Protocol reference library (read-only)</div>' +
      '<div class="oh-ctx-note" style="margin-bottom:12px">Reference only. Not for ordering or administration. Per-patient plans are built in the treatment-plan matrix.</div>' +
      (rows || '<div class="oh-empty">Protocol index loading or unavailable.</div>');
  }

  // PURE: state -> HTML (repainted into #ohResults only, never the search input's shell).
  function bodyHtml(state) {
    state = state || {};
    var q = String(state.q || "").trim();
    if (q) return searchResultsHtml(search(q));
    if (state.mode === "kb") return kbBrowseHtml();
    if (state.mode === "drugonco") return drugOncoHtml();
    if (state.mode === "protoref") return protoRefHtml();
    return favSection() + contextStrip(state.ctx) + quickActionsHtml() + gridHtml();
  }

  function renderResults() { var box = document.getElementById("ohResults"); if (box) box.innerHTML = bodyHtml(st); }

  // Protocols are per-patient (onco-protocols.js's matrix reads a real treatment plan) — with a
  // Ward Sync patient in context, jump straight into it; otherwise ask for one (never a broken link).
  function openProtocolContext() {
    var ctx = st.ctx || livePatientContext();
    var pid = ctx && ctx.patient && ctx.patient.patientId;
    if (pid && G.OPDEMR && G.OPDEMR.openProfile) {
      close();
      G.OPDEMR.openProfile({ patientId: pid, name: (ctx.patient && ctx.patient.name) || "", tab: "onco" });
    } else {
      toast("Open a patient in Ward Sync to view their treatment-plan matrix.");
    }
  }

  function onClick(e) {
    var t = e.target;
    var star = (t && t.closest) ? t.closest("[data-oh-fav]") : null;
    if (star) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); toggleFav(star.getAttribute("data-oh-fav")); return; }
    var b = (t && t.closest) ? t.closest("[data-oh-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-oh-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    // Recent: record navigational cards/rows/chips (never close/back/toggles). No-op unless favorites on.
    if (b.classList && (b.classList.contains("oh-card") || b.classList.contains("oh-row") || b.classList.contains("oh-favchip"))) recordRecent(b, act);
    if (verb === "close") { close(); return; }
    if (verb === "calc-cat") { try { G.MEDCALC && G.MEDCALC.openList && G.MEDCALC.openList("Oncology"); } catch (e2) {} return; }
    if (verb === "calc") { try { G.MEDCALC && G.MEDCALC.open && G.MEDCALC.open(arg); } catch (e2) {} return; }
    if (verb === "kb-browse") { st.mode = (st.mode === "kb") ? null : "kb"; renderResults(); return; }
    if (verb === "kb") { try { G.DX && G.DX.openRef && G.DX.openRef(arg); } catch (e2) {} return; }
    if (verb === "home-dash") { st.mode = null; renderResults(); return; }
    // Drug card: with the onco drug view flag ON, open the in-overlay onco drug view; else the P0 formulary.
    if (verb === "drug-browse") { if (flag("smd_onco_drugview")) { st.mode = "drugonco"; renderResults(); } else { try { G.MEDDRUGS && G.MEDDRUGS.openList && G.MEDDRUGS.openList(); } catch (e2) {} } return; }
    if (verb === "drug-formulary") { try { G.MEDDRUGS && G.MEDDRUGS.openList && G.MEDDRUGS.openList(); } catch (e2) {} return; }
    if (verb === "drug-interactions") { try { G.MEDDRUGS && G.MEDDRUGS.openInteractions && G.MEDDRUGS.openInteractions(); } catch (e2) {} return; }
    if (verb === "protoref-open") { st.mode = "protoref"; renderResults(); return; }
    if (verb === "staging-open") { try { G.SMD_ONCOSTAGING && G.SMD_ONCOSTAGING.openList && G.SMD_ONCOSTAGING.openList(); } catch (e2) {} return; }
    if (verb === "ctcae-open") { try { G.SMD_ONCOCTCAE && G.SMD_ONCOCTCAE.openList && G.SMD_ONCOCTCAE.openList(); } catch (e2) {} return; }
    if (verb === "iotox-open") { try { G.SMD_ONCOIOTOX && G.SMD_ONCOIOTOX.openList && G.SMD_ONCOIOTOX.openList(); } catch (e2) {} return; }
    if (verb === "recist-open") { try { G.SMD_ONCORECIST && G.SMD_ONCORECIST.open && G.SMD_ONCORECIST.open(); } catch (e2) {} return; }
    if (verb === "protocol-open") { openProtocolContext(); return; }
  }

  function paintShell() {
    var el = rootEl();
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-oh-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">ONCO</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><input id="ohSearch" class="oh-search" type="text" placeholder="Explore tools, drugs and content" autocomplete="off" value="' + esc(st.q) + '">' +
      '<div id="ohResults"></div></div>';
    var si = el.querySelector("#ohSearch");
    if (si) si.addEventListener("input", function () { st.q = si.value; renderResults(); });
    renderResults();
  }

  // open(ctx): ctx is optional — { patient:{name,patientId}, heightCm, weightKg, age, sex,
  // creatinine, renal, diagnosis }. Falls back to a best-effort Ward Sync identity read; hides the
  // strip entirely if nothing is available.
  function open(ctx) {
    if (!flagOn()) { toast("Onco Home is off"); return; }
    st.q = ""; st.mode = null; st.ctx = ctx || livePatientContext();
    loadProtocols();
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    paintShell();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function close() { var el = document.getElementById("smdOncoHome"); if (el) el.classList.remove("on"); document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.getElementById("smdOncoHome") && document.getElementById("smdOncoHome").classList.contains("on")) close(); }); } catch (e) {}

  // Testing/launch hook (mirrors queue.js): with the flag on, ?oncohome=1 auto-opens.
  try {
    if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_home") && /[?&]oncohome=1\b/.test((G.location && G.location.search) || "")) {
      G.addEventListener("DOMContentLoaded", function () { open(); });
    }
  } catch (e) {}

  G.SMD_ONCOHOME = { open: open, close: close, search: search, _render: bodyHtml, _kbIndex: kbIndex, _oncoSupportive: oncoSupportive, _protoBadge: protoBadge, _st: st, _version: "1.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = { search: search, _render: bodyHtml, _oncoSupportive: oncoSupportive, _protoBadge: protoBadge };
})();
