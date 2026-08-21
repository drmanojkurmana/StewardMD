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
 *   - TNM cancer staging, CTCAE, IO toxicity -> full modules; sites/content not yet added render as
 *     labelled honest gaps, never fabricated tables.
 *
 * Search is a pure, deterministic function (substring + a small abbreviation map) — NO LLM ever
 * decides a dose/stage/score here. Flag: smd_onco_home (queue-flags.js), default OFF.
 * window.SMD_ONCOHOME + module.exports (the pure search fn, for node --test). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  // Material Symbols Rounded, self-hosted (never emoji). The shared onco-home.css styles these spans.
  function ms(name) { return '<span class="material-symbols-rounded">' + name + "</span>"; }

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
  var _protocols = [], _protoLoaded = false;
  function loadProtocols() {
    if (!G.fetch) { _protoLoaded = true; return; }
    try {
      G.fetch("/kb/protocols/index.json").then(function (r) { return (r && r.ok) ? r.json() : null; })
        .then(function (j) { var all = (j && (j.protocols || j)) || []; if (!(all instanceof Array)) all = []; _protocols = all; })   // show the full library; each row carries a lifecycle/DRAFT badge, and the detail view is labelled reference-only (was filtered to non-experimental -> looked empty since 123/124 are experimental)
        .catch(function () {})
        .then(function () { _protoLoaded = true; renderResults(); });   // resolve any skeleton once the index arrives
    } catch (e) { _protoLoaded = true; }
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
    return '<button class="oh-star' + (on ? " on" : "") + '" data-oh-fav="' + esc(item.id) + '" aria-label="' + (on ? "Remove favourite" : "Add favourite") + '">' + ms("star") + "</button>";
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
    var favs = [];
    try { favs = G.SMD_ONCOFAV.all() || []; } catch (e) {}
    if (!favs.length) return "";
    return '<div class="oh-grp"><div class="oh-grp-h">Favourites</div><div class="oh-favlist">' + favs.map(favRowHtml).join("") + "</div></div>";
  }
  function toggleFav(id) {
    try { if (G.SMD_ONCOFAV) G.SMD_ONCOFAV.toggle(st.favIndex[id] || { id: id, label: id, act: "" }); } catch (e) {}
    renderResults();
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

  // Loading + empty presentation (shared): shimmering skeleton rows, and an iconful empty state.
  function skelRows(n) { var s = ""; for (var i = 0; i < (n || 5); i++) s += '<div class="oh-skel"></div>'; return s; }
  function emptyHtml(icon, text) { return '<div class="oh-empty">' + ms(icon) + "<span>" + esc(text) + "</span></div>"; }
  function resultSection(label, itemsHtml) { return itemsHtml ? '<div class="oh-sec"><div class="oh-sec-h">' + esc(label) + "</div>" + itemsHtml + "</div>" : ""; }
  function calcRowHtml(c) { var inner = '<button class="oh-row" data-oh-act="calc:' + esc(c.id) + '"><span class="oh-row-t">' + esc(c.title) + '</span><span class="oh-row-s">' + esc(c.cat || "") + "</span>" + evForCalc(c) + "</button>"; return wrapStar(inner, { id: "calc:" + c.id, label: c.title, act: "calc:" + c.id }, "oh-star-row"); }
  function diseaseRowHtml(d) { var inner = '<button class="oh-row" data-oh-act="kb:' + esc(d.id) + '"><span class="oh-row-t">' + esc(d.name) + '</span><span class="oh-row-s">' + esc(d.system || "") + "</span>" + evForDisease(d) + "</button>"; return wrapStar(inner, { id: "kb:" + d.id, label: d.name, act: "kb:" + d.id }, "oh-star-row"); }
  function drugRowHtml(d) { return '<button class="oh-row" data-oh-act="drug-browse"><span class="oh-row-t">' + esc(d.generic) + '</span><span class="oh-row-s">' + esc(d.cls || "") + "</span></button>"; }
  function protocolRowHtml(p) { return '<button class="oh-row" data-oh-act="protodetail:' + esc(p.id) + '"><span class="oh-row-t">' + esc(p.name || p.id) + '</span><span class="oh-row-s">' + esc(p.lifecycleState || "") + "</span></button>"; }

  function searchResultsHtml(r) {
    var any = r.calculators.length || r.diseases.length || r.drugs.length || r.protocols.length;
    if (!any) return emptyHtml("search_off", "No matches. Try a drug name, a calculator (e.g. Khorana), or a disease/abbreviation (e.g. NSCLC).");
    return resultSection("Calculators & Scores", r.calculators.map(calcRowHtml).join("")) +
      resultSection("Diseases", r.diseases.map(diseaseRowHtml).join("")) +
      resultSection("Drugs", r.drugs.map(drugRowHtml).join("")) +
      resultSection("Protocols", r.protocols.map(protocolRowHtml).join(""));
  }

  function quickActionsHtml() {
    return '<div class="oh-quick">' +
      '<button class="oh-qa" data-oh-act="calc-cat">' + ms("calculate") + "Calculators</button>" +
      '<button class="oh-qa" data-oh-act="drug-browse">' + ms("pill") + "Drugs</button>" +
      '<button class="oh-qa" data-oh-act="drug-interactions">' + ms("compare_arrows") + "Interactions</button>" +
      '<button class="oh-qa" data-oh-act="protocol-open">' + ms("clinical_notes") + "Protocols</button>" +
      "</div>";
  }

  var GRID = [
    { group: "Diagnosis & Staging", cards: [
      { title: "Diseases & knowledge base", sub: "Oncology reference (KB)", act: "kb-browse", icon: "book_2" },
      { title: "Cancer staging (TNM)", sub: "Full TNM staging by cancer site", act: "staging-open", flag: "smd_onco_staging", icon: "stairs" }
    ] },
    { group: "Treatment", cards: [
      { title: "Treatment-plan protocols", sub: "Regimens, dose calculator and printable sheet", act: "protocol-open", icon: "clinical_notes" },
      { title: "Protocol reference", sub: "Read-only library (lifecycle badges)", act: "protoref-open", flag: "smd_onco_protoref", icon: "menu_book" }
    ] },
    { group: "Monitoring", cards: [
      { title: "Toxicity / CTCAE", sub: "CTCAE v5.0 grading", act: "ctcae-open", flag: "smd_onco_ctcae", icon: "warning" },
      { title: "IO toxicity (irAE)", sub: "irAE management principles (ASCO / NCCN / SITC)", act: "iotox-open", flag: "smd_onco_iotox", icon: "immunology" }
    ] },
    { group: "Calculators & tools", cards: [
      { title: "RECIST 1.1", sub: "Target-lesion response calculator", act: "recist-open", flag: "smd_onco_recist", icon: "straighten" },
      { title: "Drug info & interaction", sub: "Formulary + interaction checker", act: "drug-onco", icon: "pill" },
      { title: "Prognostic scores", sub: "ECOG, Karnofsky, Khorana, IPI and more", act: "calc-cat", icon: "insights" },
      { title: "Formulas", sub: "BSA, Calvert, Cockcroft-Gault and more", act: "calc-cat", icon: "function" }
    ] }
  ];
  function cardHtml(c) {
    // Flag-gated tool: render its tile ONLY when the flag is on. A flag-off (or placeholder) tool is
    // omitted entirely — no greyed "coming soon" tile, never lead the landing with disabled cards.
    if (c.flag && !flag(c.flag)) return "";
    if (c.placeholder) return "";
    var inner = '<button class="oh-card" data-oh-act="' + esc(c.act) + '">' +
      '<span class="oh-card-ic">' + ms(c.icon || "chevron_right") + "</span>" +
      '<div class="oh-card-body"><span class="oh-card-t">' + esc(c.title) + '</span><span class="oh-card-s">' + esc(c.sub) + "</span></div>" +
      '<span class="oh-card-go">' + ms("chevron_right") + "</span></button>";
    return wrapStar(inner, { id: "card:" + c.act, label: c.title, act: c.act }, "oh-card-wrap");
  }
  function gridHtml() {
    return GRID.map(function (g) { return '<div class="oh-grp"><div class="oh-grp-h">' + esc(g.group) + '</div><div class="oh-grid">' + g.cards.map(cardHtml).join("") + "</div></div>"; }).join("");
  }
  // ponytail: KB skeleton resolves on the next render, not a KB-ready event (none exists). KB is
  // normally injected before Onco Home opens; wire a listener only if late-load shimmer is ever seen.
  function kbLoading() { return !(G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId); }
  function kbBrowseHtml() {
    var back = '<button class="oh-back-inline" data-oh-act="kb-browse">&lsaquo; Back</button>';
    if (kbLoading()) return back + '<div class="oh-sec-h">Oncology diseases</div>' + skelRows(6);
    var list = kbIndex();
    if (!list.length) return back + emptyHtml("book_2", "No oncology entries in the knowledge base yet.");
    return back + '<div class="oh-sec-h">Oncology diseases (' + list.length + ")</div>" + list.map(diseaseRowHtml).join("");
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
      '<div class="oh-quick"><button class="oh-qa" data-oh-act="drug-interactions">' + ms("compare_arrows") + 'Interaction check</button><button class="oh-qa" data-oh-act="drug-formulary">' + ms("medication") + "Full formulary</button></div>" +
      '<div class="oh-sec"><div class="oh-sec-h">Antineoplastic agents (tall-man names)</div>' + (tmRows || emptyHtml("medication", "Tall-man table unavailable.")) + tmEv + "</div>" +
      '<div class="oh-sec"><div class="oh-sec-h">Oncology supportive care (from formulary)</div>' + (supRows || emptyHtml("medication", "No supportive-care drugs found in the formulary.")) + "</div>" +
      '<div class="oh-ctx-note">Names shown for look-alike safety. Formulary doses are adult reference values, verify before use. No prescription is created here.</div>';
  }

  /* ---- Feature 4: protocol reference library (read-only; distinct from the per-patient matrix) ---- */
  function protoBadge(state) {
    if (state === "draft") return '<span class="oh-badge oh-badge-draft">DRAFT - not activated</span>';
    return state ? '<span class="oh-badge">' + esc(state) + "</span>" : "";
  }
  function protoRefHtml() {
    var rows = (_protocols || []).map(function (p) {
      return '<button class="oh-row" data-oh-act="protodetail:' + esc(p.id) + '"><span class="oh-row-t">' + esc(p.name || p.id) + " " + protoBadge(p.lifecycleState) + '</span><span class="oh-row-s">' + esc((p.diseaseId || "") + (p.version ? " · v" + p.version : "")) + "</span></button>";
    }).join("");
    var body = rows || (_protoLoaded ? emptyHtml("clinical_notes", "No protocols in the reference library.") : skelRows(5));
    return '<button class="oh-back-inline" data-oh-act="home-dash">&lsaquo; Back</button>' +
      '<div class="oh-sec-h">Protocol library</div>' +
      '<div class="oh-ctx-note" style="margin-bottom:12px">Reference only. Not for ordering or administration. Tap a protocol for its full regimen, an optional patient-dose calculator and a printable sheet. No hospital or patient record needed.</div>' +
      body;
  }

  // ---- Standalone protocol detail: full regimen from kb/protocols + an OPTIONAL patient-dose
  // calculator (pure SMD_ONCODOSE) + a printable PDF (SMD_ONCOREPORT). Reference/educational, never an
  // order. This is how a doctor WITHOUT a hospital reads a protocol and prints its sheet - no Ward Sync. ----
  var _protoFull = {};
  function loadProtoFull(id, cb) {
    if (_protoFull[id]) { cb(_protoFull[id]); return; }
    if (!G.fetch) { cb(null); return; }
    G.fetch("/kb/protocols/" + encodeURIComponent(id) + ".json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { if (j) _protoFull[id] = j; cb(j || null); })
      .catch(function () { cb(null); });
  }
  function openProtoDetail(id) {
    st.mode = "protodetail"; st.detailId = id; st.detailProto = _protoFull[id] || null;
    var c = st.ctx || {};   // seed the calculator from a Ward Sync patient when present (optional, never required)
    st.calc = { height: c.heightCm || "", weight: c.weightKg || "", age: c.age || "", sex: c.sex || "", creatinine: c.creatinine || "" };
    renderResults();
    loadProtoFull(id, function (p) { if (st.mode === "protodetail" && st.detailId === id) { st.detailProto = p; renderResults(); } });
  }
  // dose-engine params (height/weight/... names) from the calc form; null when not entered (never invented)
  function calcFromForm() {
    function num(id) { var el = document.getElementById(id); var v = el ? parseFloat(el.value) : NaN; return isFinite(v) ? v : ""; }
    var sx = document.getElementById("ocSex");
    return { height: num("ocHt"), weight: num("ocWt"), age: num("ocAge"), sex: sx ? sx.value : "", creatinine: num("ocCr") };
  }
  function calcHasPt(c) { c = c || {}; return Number(c.height) > 0 && Number(c.weight) > 0; }
  function doseParams(c) { c = c || {}; return { height: Number(c.height) || null, weight: Number(c.weight) || null, age: Number(c.age) || null, sex: c.sex || "", creatinine: Number(c.creatinine) || null }; }
  function protoDoseMap(p, c) {
    var m = {};
    if (!calcHasPt(c)) return m;
    try { (G.SMD_ONCODOSE.planDoses(p, doseParams(c)) || []).forEach(function (l) { if (l && l.drugId) m[l.drugId] = l; }); } catch (e) {}
    return m;
  }
  // NB: named protoDrugRowHtml, NOT drugRowHtml - the latter already exists for drug SEARCH results
  // (data-oh-act="drug-browse"); a duplicate name would hoist-override it and break drug search.
  function protoDrugRowHtml(d, doseMap, showDose) {
    var per = (d.dosePerUnit != null ? d.dosePerUnit + (d.unit ? " " + d.unit : "") : "verify");
    var admin = per + (d.route ? " " + d.route : "") + (d.days && d.days.length ? ", D" + d.days.join(",") : "");
    var dose = "";
    if (showDose) { var lin = doseMap[d.id]; dose = '<span class="oh-drow-dose' + (lin && lin.final != null ? "" : " oh-drow-verify") + '">' + esc(lin && lin.final != null ? lin.final + " mg" : "verify") + "</span>"; }
    return '<div class="oh-row oh-row-static"><span class="oh-row-t">' + esc(d.name || d.id) + '</span><span class="oh-row-s">' + esc(admin) + "</span>" + dose + "</div>";
  }
  function protoDetailHtml() {
    var p = st.detailProto;
    if (!p) return '<button class="oh-back-inline" data-oh-act="protoref-open">&lsaquo; Back to library</button>' + skelRows(6);
    var drugs = p.drugs || (p.regimen && p.regimen.drugs) || [];
    var has = calcHasPt(st.calc), doseMap = protoDoseMap(p, st.calc);
    var meta = [];
    if (p.diseaseId) meta.push(esc(p.diseaseId));
    if (p.cycles) meta.push("Cycles " + Math.min(60, Number(p.cycles) || 0) + (p.cycleLengthDays ? " x " + p.cycleLengthDays + " days" : ""));
    if (p.intentOptions && p.intentOptions.length) meta.push(esc(p.intentOptions.join(" / ")));
    var regimen = drugs.length ? drugs.map(function (d) { return protoDrugRowHtml(d, doseMap, has); }).join("") : emptyHtml("clinical_notes", "No regimen detail in this protocol.");
    var cv = st.calc || {};
    var calc = '<div class="oh-sec-h">Calculate for a patient (optional)</div>' +
      '<div class="oh-calc">' +
      '<input id="ocHt" type="number" inputmode="decimal" placeholder="Height (cm)" value="' + esc(cv.height) + '">' +
      '<input id="ocWt" type="number" inputmode="decimal" placeholder="Weight (kg)" value="' + esc(cv.weight) + '">' +
      '<input id="ocAge" type="number" inputmode="numeric" placeholder="Age (years)" value="' + esc(cv.age) + '">' +
      '<select id="ocSex"><option value="">Sex</option><option value="male"' + (cv.sex === "male" ? " selected" : "") + '>Male</option><option value="female"' + (cv.sex === "female" ? " selected" : "") + '>Female</option></select>' +
      '<input id="ocCr" type="number" inputmode="decimal" placeholder="Creatinine (mg/dL)" value="' + esc(cv.creatinine) + '">' +
      "</div>" +
      '<div><button class="oh-cta ghost" data-oh-act="proto-calc">' + ms("calculate") + (has ? "Recalculate" : "Calculate doses") + "</button>" +
      '<button class="oh-cta" data-oh-act="proto-pdf">' + ms("print") + "Print / Save PDF</button></div>";
    var chart = (st.ctx && st.ctx.patient && st.ctx.patient.patientId && G.OPDEMR && G.OPDEMR.openProfile)
      ? '<div style="margin-top:14px"><button class="oh-cta ghost" data-oh-act="proto-chart">' + ms("clinical_notes") + "Open in patient chart</button></div>" : "";
    return '<button class="oh-back-inline" data-oh-act="protoref-open">&lsaquo; Back to library</button>' +
      '<div class="oh-sec-h">' + esc(p.name || p.id) + " " + protoBadge(p.lifecycleState) + "</div>" +
      (meta.length ? '<div class="oh-dmeta">' + meta.join(" &middot; ") + "</div>" : "") +
      '<div class="oh-note-ref">Educational reference. Not a prescription or an order. Verify every dose against your institutional protocol; the physician and dose engine own dosing.</div>' +
      '<div class="oh-sec-h">Regimen</div>' + regimen +
      '<div style="height:14px"></div>' + calc + chart;
  }
  function protoPdf() {
    var R = G.SMD_ONCOREPORT;
    if (!R || !R.buildProtocolSheet) { toast("Print is not available on this build."); return; }
    var p = st.detailProto; if (!p) return;
    var has = calcHasPt(st.calc), params = doseParams(st.calc), bsa = null, doses = [];
    if (has) { try { bsa = G.SMD_ONCODOSE.bsaMosteller(params.height, params.weight); } catch (e) {} try { doses = G.SMD_ONCODOSE.planDoses(p, params) || []; } catch (e2) {} }
    var plan = {
      protocolId: p.id || "", lockedTemplate: p, sourceProtocolId: p.id || "",
      plannedCycles: Math.min(60, Number(p.cycles) || 0),
      intent: (p.intentOptions && p.intentOptions[0]) || "",
      patientParams: has ? { height: params.height, weight: params.weight, bsa: bsa, age: params.age, sex: params.sex, creatinine: params.creatinine } : {},
      calculatedDoses: doses, confirmedDoses: [], status: "reference"
    };
    var html = R.buildProtocolSheet(plan, { patientName: (st.ctx && st.ctx.patient && st.ctx.patient.name) || "", diagnosis: (st.ctx && st.ctx.diagnosis) || "" });
    exportHtmlDoc(html, "StewardMD-" + (plan.protocolId || "protocol"));
  }
  // Native fallback when the real-PDF plugin (VisionOcr.htmlToPdf) is absent: write the HTML to cache
  // and open the share sheet (user picks Print / Save as PDF). Mirrors opd-emr.js oncoShareHtml.
  function shareHtmlFile(html, name) {
    try {
      var P = G.Capacitor && G.Capacitor.Plugins;
      if (P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share) {
        P.Filesystem.writeFile({ path: name + ".html", data: html, directory: "CACHE", encoding: "utf8" })
          .then(function () { return P.Filesystem.getUri({ path: name + ".html", directory: "CACHE" }); })
          .then(function (r) { return P.Share.share({ title: "StewardMD - Protocol sheet", files: [r.uri], dialogTitle: "Save as PDF / Print / Share" }); })
          .catch(function () { toast("Export unavailable on this device."); });
        return;
      }
    } catch (e) {}
    toast("Export not available on this device.");
  }
  function exportHtmlDoc(html, filename) {
    var name = (filename || "StewardMD-Protocol").replace(/[^\w.-]+/g, "-");
    // NATIVE: real PDF if the renderer is present, else share the HTML file (share sheet -> Save as PDF).
    if (G.SMD_IS_NATIVE) {
      var N = G.SMD_NATIVE;
      if (N && N.sharePdfFromHtml) { toast("Building PDF..."); N.sharePdfFromHtml(html, name, "StewardMD - Protocol sheet").catch(function () { shareHtmlFile(html, name); }); return; }
      shareHtmlFile(html, name); return;
    }
    // WEB: hidden-iframe print (the browser dialog offers Save as PDF).
    try {
      var ifr = document.createElement("iframe"); ifr.setAttribute("aria-hidden", "true");
      ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
      document.body.appendChild(ifr);
      var d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
      setTimeout(function () { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {} setTimeout(function () { try { ifr.remove(); } catch (e2) {} }, 1500); }, 350);
    } catch (e) { toast("Export unavailable."); }
  }

  // PURE: state -> HTML (repainted into #ohResults only, never the search input's shell).
  function bodyHtml(state) {
    state = state || {};
    var q = String(state.q || "").trim();
    if (q) return searchResultsHtml(search(q));
    if (state.mode === "kb") return kbBrowseHtml();
    if (state.mode === "drugonco") return drugOncoHtml();
    if (state.mode === "protoref") return protoRefHtml();
    if (state.mode === "protodetail") return protoDetailHtml();
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
    // These verbs open a SEPARATE full-screen overlay. Onco Home is z-index 875; the calculators (870),
    // drugs (872) and onco sub-views (staging/CTCAE/irAE/RECIST) sit at/below it. Rather than CLOSING
    // Onco Home (which dropped the user to the app home when the sub-view was dismissed), we BACKGROUND
    // it (z-index 865, still mounted) so the sub-view renders above and dismissing it returns HERE. Any
    // other interaction foregrounds it again. In-place modes (kb-browse / protoref / protodetail /
    // drugonco / home-dash) repaint inside this overlay and never background it.
    var OPENS_OVERLAY = { calc: 1, "calc-cat": 1, kb: 1, "staging-open": 1, "ctcae-open": 1, "iotox-open": 1, "recist-open": 1, "drug-formulary": 1, "drug-interactions": 1 };
    if (OPENS_OVERLAY[verb]) background(); else foreground();
    if (verb === "close") { close(); return; }
    if (verb === "calc-cat") { try { G.MEDCALC && G.MEDCALC.openList && G.MEDCALC.openList("Oncology"); } catch (e2) {} return; }
    if (verb === "calc") { try { G.MEDCALC && G.MEDCALC.open && G.MEDCALC.open(arg); } catch (e2) {} return; }
    if (verb === "kb-browse") { st.mode = (st.mode === "kb") ? null : "kb"; renderResults(); return; }
    if (verb === "kb") { try { G.DX && G.DX.openRef && G.DX.openRef(arg); } catch (e2) {} return; }
    if (verb === "home-dash") { st.mode = null; renderResults(); return; }
    // Drug tile -> the in-overlay onco drug view, which offers BOTH "Interaction check"
    // (-> MEDDRUGS.openInteractions) and "Full formulary" (-> MEDDRUGS.openList). Search-result drug
    // rows keep drug-browse below (open MEDDRUGS directly for that drug).
    if (verb === "drug-onco") { st.mode = "drugonco"; renderResults(); return; }
    // Drug SEARCH result / quick action: open the real MEDDRUGS browse overlay (flag routes to the split view).
    if (verb === "drug-browse") { if (flag("smd_onco_drugview")) { st.mode = "drugonco"; renderResults(); } else { try { G.MEDDRUGS && G.MEDDRUGS.openList && G.MEDDRUGS.openList(); } catch (e2) {} } return; }
    if (verb === "drug-formulary") { try { G.MEDDRUGS && G.MEDDRUGS.openList && G.MEDDRUGS.openList(); } catch (e2) {} return; }
    if (verb === "drug-interactions") { try { G.MEDDRUGS && G.MEDDRUGS.openInteractions && G.MEDDRUGS.openInteractions(); } catch (e2) {} return; }
    if (verb === "protoref-open") { st.mode = "protoref"; renderResults(); return; }
    if (verb === "protodetail") { openProtoDetail(arg); return; }
    if (verb === "proto-calc") { st.calc = calcFromForm(); renderResults(); return; }
    if (verb === "proto-pdf") { protoPdf(); return; }
    if (verb === "proto-chart") { openProtocolContext(); return; }
    if (verb === "staging-open") { try { G.SMD_ONCOSTAGING && G.SMD_ONCOSTAGING.openList && G.SMD_ONCOSTAGING.openList(); } catch (e2) {} return; }
    if (verb === "ctcae-open") { try { G.SMD_ONCOCTCAE && G.SMD_ONCOCTCAE.openList && G.SMD_ONCOCTCAE.openList(); } catch (e2) {} return; }
    if (verb === "iotox-open") { try { G.SMD_ONCOIOTOX && G.SMD_ONCOIOTOX.openList && G.SMD_ONCOIOTOX.openList(); } catch (e2) {} return; }
    if (verb === "recist-open") { try { G.SMD_ONCORECIST && G.SMD_ONCORECIST.open && G.SMD_ONCORECIST.open(); } catch (e2) {} return; }
    if (verb === "protocol-open") { st.mode = "protoref"; renderResults(); return; }   // browse the library -> tap a protocol for its regimen/calc/PDF (no hospital needed)
  }

  // Landing identity: teal gradient hero card (masked logo). Painted once above the persistent search.
  function heroHtml() {
    return '<section class="oh-hero">' +
      '<div class="oh-hero-eyebrow">ONCOLOGY</div>' +
      '<div class="oh-hero-title">The Cancer Library</div>' +
      '<div class="oh-hero-sub">Staging, toxicity, protocols, drugs and calculators in one place. StewardMD never invents a dose, stage or score.</div>' +
      '<span class="oh-hero-mark" aria-hidden="true"></span></section>';
  }
  function paintShell() {
    var el = rootEl();
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-oh-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">ONCqis</div><span style="width:64px"></span></div>' +
      '<div class="oh-body">' + heroHtml() +
      '<input id="ohSearch" class="oh-search" type="text" placeholder="Explore tools, drugs and content" autocomplete="off" value="' + esc(st.q) + '">' +
      '<div id="ohResults"></div></div>';
    var si = el.querySelector("#ohSearch");
    if (si) si.addEventListener("input", function () { st.q = si.value; renderResults(); });
    renderResults();
  }

  // open(ctx): ctx is optional — { patient:{name,patientId}, heightCm, weightKg, age, sex,
  // creatinine, renal, diagnosis }. Falls back to a best-effort Ward Sync identity read; hides the
  // strip entirely if nothing is available.
  function open(ctx) {
    if (!flagOn()) { toast("ONCqis is off"); return; }
    st.q = ""; st.mode = null; st.ctx = ctx || livePatientContext();
    loadProtocols();
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    paintShell();
    el.classList.add("on"); el.classList.remove("oh-bg"); document.body.classList.add("oh-lock");
  }
  function close() { var el = document.getElementById("smdOncoHome"); if (el) { el.classList.remove("on"); el.classList.remove("oh-bg"); } document.body.classList.remove("oh-lock"); }
  // Background: keep ONCqis mounted but below a sub-view overlay (so dismissing the sub returns here).
  function background() { var el = document.getElementById("smdOncoHome"); if (el) el.classList.add("oh-bg"); }
  // Foreground: restore full z-index once the user interacts with ONCqis again (returned from a sub-view).
  function foreground() { var el = document.getElementById("smdOncoHome"); if (el) el.classList.remove("oh-bg"); }

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
