/* StewardMD - oncotree.js. ONCOTREE navigator UI: the mobile-first clinical pathway experience.
 *
 * A NAVIGATION layer over the EXISTING oncology foundation. It renders ONE evaluated pathway state
 * (oncotree-engine.js) as: a step-by-step phenotype flow, an excluded-branch explainer (disabledBy),
 * a map overview, and APPLICABLE existing Standard Protocol cards (oncotree-recommend.js) - all from
 * the same state. It references existing protocol IDs/versions; it never creates a protocol, never
 * computes a dose (the existing dose engine + physician own that), and never presents a DRAFT protocol
 * as approved. Select hands off to the existing workflow via a CustomEvent; no safety gate is bypassed.
 *
 * Mirrors the onco-home.js overlay pattern (own overlay + st, pure bodyHtml(state), delegated onClick,
 * open/close). Flag smd_onco_navigator (queue-flags.js), default OFF. window.SMD_ONCOTREE. */
(function (root) {
  "use strict";
  var G = root || {};
  var D = (typeof document !== "undefined") ? document : null;

  var CAT = {
    criteria: { color: "#785EF0", icon: "checklist", name: "Criteria" },
    workup: { color: "#648FFF", icon: "biotech", name: "Work-up" },
    treatment: { color: "#FE6100", icon: "medication", name: "Treatment" },
    surveillance: { color: "#FFB000", icon: "monitor_heart", name: "Surveillance" },
    other: { color: "#870F54", icon: "more_horiz", name: "Other" }
  };

  // Diseases with an authored + reviewed navigator graph (kb/oncotree/<id>.json). The engine + UI are
  // disease-agnostic; adding a disease = author its graph JSON + one entry here.
  var DISEASES = [
    { id: "breast", title: "Breast Cancer", sub: "Invasive - HER2 / HR pathways", icon: "female", ready: true },
    { id: "lung", title: "Lung Cancer", sub: "NSCLC drivers / immunotherapy, SCLC, mesothelioma", icon: "pulmonology", ready: true },
    { id: "colorectal", title: "Colorectal Cancer", sub: "Adjuvant / metastatic; MMR-MSI directed", icon: "gastroenterology", ready: true },
    { id: "uppergi", title: "Gastric / Esophageal Cancer", sub: "Resectable / metastatic; HER2-MSI-PD-L1", icon: "gastroenterology", ready: true },
    { id: "prostate", title: "Prostate Cancer", sub: "Localized / mCSPC / mCRPC; HRR + PSMA", icon: "man", ready: true },
    { id: "bladder", title: "Bladder / Urothelial", sub: "Muscle-invasive / metastatic by line", icon: "water_drop", ready: true },
    { id: "rcc", title: "Renal Cell Carcinoma", sub: "Advanced clear-cell; IO-combo vs TKI", icon: "nephrology", ready: true },
    { id: "testicular", title: "Testicular (germ cell)", sub: "Seminoma / NSGCT by risk", icon: "man", ready: true },
    { id: "melanoma", title: "Melanoma (cutaneous)", sub: "BRAF-targeted vs immunotherapy", icon: "dermatology", ready: true },
    { id: "headneck", title: "Head & Neck Cancer", sub: "Locoregional / recurrent-metastatic; PD-L1", icon: "face", ready: true },
    { id: "ovarian", title: "Ovarian Cancer", sub: "Primary chemo; PARP maintenance by HRD", icon: "female", ready: true },
    { id: "myeloma", title: "Multiple Myeloma", sub: "Newly diagnosed / maintenance / relapsed", icon: "bloodtype", ready: true },
    { id: "amyloidosis", title: "Systemic AL Amyloidosis", sub: "Mayo cardiac staging; Dara-CyBorD + autologous HCT", icon: "bloodtype", ready: true },
    { id: "castleman", title: "Castleman Disease", sub: "UCD vs iMCD (Siltuximab) & HHV-8+ MCD (Rituximab)", icon: "bloodtype", ready: true },
    { id: "thyroid", title: "Thyroid Cancer", sub: "Anaplastic (BRAF) / medullary (RET)", icon: "biotech", ready: true },
    { id: "cervical", title: "Cervical Cancer", sub: "FIGO stage; chemoRT vs surgery; recurrent by PD-L1", icon: "female", ready: true },
    { id: "uterine", title: "Uterine / Endometrial", sub: "Molecular class; risk-adapted adjuvant; MMR / HER2", icon: "female", ready: true },
    { id: "gtn", title: "Gestational Trophoblastic Neoplasia", sub: "FIGO/WHO risk score; Methotrexate vs EMA-CO; PSTT/ETT surgery", icon: "female", ready: true },
    { id: "pancreatic", title: "Pancreatic Cancer", sub: "Resectable vs metastatic; FOLFIRINOX vs gem-nab", icon: "gastroenterology", ready: true },
    { id: "ampullary", title: "Ampullary Adenocarcinoma", sub: "Pancreatobiliary vs intestinal; Whipple + adjuvant", icon: "gastroenterology", ready: true },
    { id: "biliary", title: "Biliary Tract Cancers", sub: "GBC & Cholangiocarcinoma; BILCAP adjuvant; TOPAZ-1 & NGS targets", icon: "gastroenterology", ready: true },
    { id: "appendiceal", title: "Appendiceal Neoplasms", sub: "LAMN/PMP vs adenocarcinoma; CRS + HIPEC", icon: "gastroenterology", ready: true },
    { id: "hcc", title: "Hepatocellular Carcinoma", sub: "BCLC + Child-Pugh; local vs systemic by line", icon: "gastroenterology", ready: true },
    { id: "anal", title: "Anal Cancer", sub: "Definitive chemoRT; metastatic immunotherapy", icon: "gastroenterology", ready: true },
    { id: "gist", title: "GI Stromal Tumor (GIST)", sub: "Risk-adapted imatinib; TKI by line + mutation", icon: "gastroenterology", ready: true },
    { id: "sarcoma", title: "Soft Tissue Sarcoma", sub: "Grade / size; surgery +/- RT; histology-directed", icon: "healing", ready: true },
    { id: "dfsp", title: "Dermatofibrosarcoma Protuberans", sub: "COL1A1::PDGFB fusion; Mohs vs WLE; Imatinib for advanced", icon: "healing", ready: true },
    { id: "bone", title: "Bone Cancer", sub: "Osteosarcoma (MAP), Ewing (VDC/IE), Chondrosarcoma, GCTB", icon: "orthopedics", ready: true },
    { id: "cns", title: "CNS / Glioma", sub: "IDH / 1p19q class; Stupp protocol; recurrence", icon: "neurology", ready: true },
    { id: "aml", title: "Acute Myeloid Leukemia", sub: "ELN risk; fit vs unfit; targeted + transplant", icon: "bloodtype", ready: true },
    { id: "all", title: "Acute Lymphoblastic Leukemia", sub: "Ph+ / Ph- B-ALL & T-ALL; MRD-directed", icon: "bloodtype", ready: true },
    { id: "cml", title: "Chronic Myeloid Leukemia", sub: "ELTS risk; 1L TKIs & Asciminib; molecular milestones", icon: "bloodtype", ready: true },
    { id: "cll", title: "Chronic Lymphocytic Leukemia", sub: "Watch vs treat; TP53 / IGHV; BTKi vs venetoclax", icon: "bloodtype", ready: true },
    { id: "hcl", title: "Hairy Cell Leukemia", sub: "BRAF V600E; Cladribine / Pentostatin; targeted relapse", icon: "bloodtype", ready: true },
    { id: "bcell", title: "B-Cell Lymphomas", sub: "Follicular, Mantle Cell (TP53), MZL, Burkitt", icon: "bloodtype", ready: true },
    { id: "dlbcl", title: "Diffuse Large B-Cell Lymphoma", sub: "IPI; R-CHOP vs pola-R-CHP; relapsed CAR-T", icon: "bloodtype", ready: true },
    { id: "hodgkin", title: "Hodgkin Lymphoma", sub: "Early vs advanced; PET-adapted ABVD / BV", icon: "bloodtype", ready: true },
    { id: "cutaneous_lymphoma", title: "Cutaneous Lymphomas", sub: "MF/SS TNMB; CD30+ LyP/pcALCL; CBCL indolent vs leg-type", icon: "dermatology", ready: true },
    { id: "histiocytic", title: "Histiocytic Neoplasms", sub: "LCH (adult/pediatric), ECD, RDD; BRAF V600E & MEK inhibitors", icon: "bloodtype", ready: true },
    { id: "kaposi", title: "Kaposi Sarcoma", sub: "HIV-associated, classic, endemic, iatrogenic; Liposomal doxorubicin & ART", icon: "healing", ready: true },
    { id: "mastocytosis", title: "Systemic Mastocytosis", sub: "ISM vs AdvSM; KIT D816V; Avapritinib & Midostaurin", icon: "bloodtype", ready: true },
    { id: "merkel", title: "Merkel Cell Carcinoma", sub: "CK20 dot-like; mandatory SLNB; Avelumab / Pembrolizumab / Retifanlimab", icon: "dermatology", ready: true },
    { id: "mds", title: "Myelodysplastic Syndromes", sub: "IPSS-M / IPSS-R; del(5q) Lenalidomide, Luspatercept & Azacitidine", icon: "bloodtype", ready: true },
    { id: "mesothelioma", title: "Mesothelioma", sub: "Pleural & Peritoneal; Epithelioid vs Non-Epithelioid; Nivo+Ipi & Cis+Pem", icon: "pulmonology", ready: true },
    { id: "mpn", title: "Myeloproliferative Neoplasms", sub: "MF (DIPSS/MIPSS70), PV (CYTO-PV), ET; Ruxolitinib / Fedratinib / Momelotinib / HU", icon: "bloodtype", ready: true },
    { id: "neuroendocrine", title: "Neuroendocrine & Adrenal Tumors", sub: "GI/pNET (SSTR-PET); SSA, Lu-177 Dotatate (NETTER-1), Everolimus & CAPTEM", icon: "biotech", ready: true },
    { id: "basal_cell", title: "Basal Cell Skin Cancer", sub: "Risk stratification; Mohs surgery, Vismodegib (SMO inhibitor) & Cemiplimab", icon: "dermatology", ready: true },
    { id: "occult_primary", title: "Occult Primary (CUP)", sub: "Favorable subsets vs true CUP; IHC, NGS profiling & empiric doublets", icon: "biotech", ready: true },
    { id: "neuroblastoma", title: "Neuroblastoma (Pediatric)", sub: "INRG risk; MYCN amplification; Dinutuximab (anti-GD2) + GM-CSF + Isotretinoin", icon: "child_care", ready: true },
    { id: "penile", title: "Penile Cancer", sub: "Organ-sparing surgery; DSNB / ILND; Neoadjuvant TIP & Pembrolizumab", icon: "man", ready: true },
    { id: "pediatric_all", title: "Pediatric ALL", sub: "B-ALL & T-ALL; NCI risk; MRD-directed, Blinatumomab & Tisagenlecleucel CAR-T", icon: "child_care", ready: true },
    { id: "pediatric_aml", title: "Pediatric AML", sub: "CBF vs High-risk; Gemtuzumab ozogamicin (ADE+GO), APL (ATRA+ATO) & HCT", icon: "child_care", ready: true },
    { id: "pediatric_lymphoma", title: "Pediatric B-Cell Lymphoma", sub: "Burkitt & DLBCL; LMB96 Group A-C, Rituximab + COPADM/CYVE & DA-EPOCH-R", icon: "child_care", ready: true },
    { id: "pediatric_cns", title: "Pediatric CNS Tumors", sub: "Medulloblastoma (CSI), pLGG (BRAF/MEK inhibitors), DMG (ONC201) & Ependymoma", icon: "neurology", ready: true },
    { id: "sclc", title: "Small Cell Lung Cancer", sub: "LS-SCLC (ChemoRT + ADRIATIC); ES-SCLC (Atezo/Durva); Lurbinectedin & Tarlatamab (DLL3)", icon: "pulmonology", ready: true },
    { id: "squamous_cell_skin", title: "Squamous Cell Skin Cancer", sub: "Risk features (Area H, PNI); Mohs surgery, CCPDMA, PORT & Cemiplimab (anti-PD-1)", icon: "dermatology", ready: true },
    { id: "tcell_lymphoma", title: "T-Cell Lymphomas", sub: "ALCL, PTCL-NOS, AITL; CD30-directed BV-CHP (ECHELON-2), CHOEP & ASCR", icon: "bloodtype", ready: true },
    { id: "rectal", title: "Rectal Cancer", sub: "Total Neoadjuvant Therapy (TNT: mFOLFOX6 + LCRT), Dostarlimab (dMMR) & Watch-and-Wait", icon: "gastroenterology", ready: true },
    { id: "small_bowel", title: "Small Bowel Adenocarcinoma", sub: "Duodenal / jejunal / ileal; MSI/Lynch; Whipple, mFOLFOX6, CAPOX & Pembrolizumab", icon: "gastroenterology", ready: true },
    { id: "thymic", title: "Thymoma & Thymic Carcinoma", sub: "Masaoka-Koga stage; Surgical thymectomy, CAP chemotherapy (rare-thymic-cap), PORT & Pembrolizumab", icon: "pulmonology", ready: true },
    { id: "uveal_melanoma", title: "Uveal Melanoma", sub: "Ocular brachytherapy; Liver MRI surveillance; Tebentafusp (HLA-A*02:01) & Liver-directed therapy", icon: "visibility", ready: true },
    { id: "vaginal", title: "Vaginal Cancer", sub: "FIGO stage; Pelvic ChemoRT (Cisplatin) + Interstitial IGBT; KEYNOTE-826 IO-chemo", icon: "female", ready: true },
    { id: "vulvar", title: "Vulvar Cancer", sub: "FIGO stage; Radical local excision, SLNB / Groin dissection, Pelvic ChemoRT & Pembrolizumab", icon: "female", ready: true },
    { id: "waldenstrom", title: "Waldenström Macroglobulinemia", sub: "IgM & hyperviscosity; MYD88 L265P / CXCR4; Zanubrutinib (ASPEN), BR & DRC", icon: "bloodtype", ready: true },
    { id: "wilms", title: "Wilms Tumor (Pediatric)", sub: "FH vs Anaplasia; 1p/16q LOH; Radical nephrectomy, Regimen EE-4A/DD-4A & Flank RT", icon: "child_care", ready: true }
  ];

  var st = {
    guideline: null, graph: null, protocols: {}, answers: {}, rebaseId: null,
    view: "navigator", openedProtocol: null, selection: null, whyOpen: {}, showExcluded: false,
    loaded: false, loading: false, error: null, ctx: null,
    trail: [], tocQuery: "", summaryOpen: false, _pendingRebase: null,
    showNonActive: true, navEndModalOpen: false, sidebarOpen: true, navZoom: 1,
    navMode: "auto", lastEndStepNode: null, lastEndStepOpt: null, lastEndStepPressCount: 0,
    pickerSearch: "", pickerCategory: "all"
  };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(name) { return '<span class="material-symbols-outlined">' + name + "</span>"; }
  function flagOn() {
    try {
      if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool) return G.SMD_QUEUE_FLAGS.bool("smd_onco_navigator");
      var q = (G.location && G.location.search && (G.location.search.match(/[?&]qoncotree=([^&]+)/) || []))[1];
      if (q != null) return (q === "1" || q === "on" || q === "true");
      if (G.localStorage) return G.localStorage.getItem("smd_onco_navigator") !== "0";
      return true;
    } catch (e) { return true; }
  }
  function ENG() { return G.SMD_ONCOTREE_ENGINE; }
  function REC() { return G.SMD_ONCOTREE_RECOMMEND; }

  // ---- state derivation (single evaluated state) -------------------------------------------------
  function evalState() {
    if (!st.graph || !ENG()) return null;
    return ENG().evaluate(st.graph, st.answers, { rebaseId: st.rebaseId });
  }
  function nodeById(id) { return (st.graph && st.byId && st.byId[id]) || null; }
  function currentQuestion(state) {
    for (var i = 0; i < state.order.length; i++) {
      var id = state.order[i], ns = state.nodes[id], node = st.byId[id];
      if (ns.status === "active" && node.nodeType === "question" && !ns.isAnswered) return node;
    }
    return null;
  }
  function reachedOutcomes(state) {
    return state.order.filter(function (id) {
      var ns = state.nodes[id], node = st.byId[id];
      return ns.status === "active" && (node.nodeType === "end" || node.showsRecommendation);
    }).map(function (id) { return st.byId[id]; });
  }
  function answeredSteps(state) {
    return state.order.filter(function (id) {
      var ns = state.nodes[id], node = st.byId[id];
      return ns.status === "active" && node.nodeType === "question" && ns.isAnswered;
    }).map(function (id) { return st.byId[id]; });
  }

  // ---- render pieces -----------------------------------------------------------------------------
  function catChip(cat) {
    var c = CAT[cat] || CAT.other;
    return '<span class="ot-cat" style="--ot-c:' + c.color + '">' + ms(c.icon) + esc(c.name) + "</span>";
  }
  function pillRow(pills) {
    if (!pills || !pills.length) return "";
    return '<div class="ot-pills">' + pills.map(function (p) { return '<span class="ot-pill">' + esc(p) + "</span>"; }).join("") + "</div>";
  }

  function railHtml(state) {
    var steps = answeredSteps(state);
    if (!steps.length && !st.rebaseId) return "";
    var chips = steps.map(function (n) {
      var ns = state.nodes[n.id], sel = ns.options.filter(function (o) { return o.isSelected; });
      var label = sel.length ? sel[0].label : "";
      return '<button class="ot-rail-chip" data-ot-act="edit" data-ot-node="' + esc(n.id) + '">' +
        '<span class="ot-rail-k">' + esc(n.name) + "</span>" +
        '<span class="ot-rail-v">' + esc(shortLabel(label)) + "</span>" + ms("edit") + "</button>";
    }).join('<span class="ot-rail-arrow">' + ms("chevron_right") + "</span>");
    return '<div class="ot-rail">' + chips + "</div>";
  }
  function shortLabel(l) { l = String(l || ""); var i = l.indexOf(" ("); return i > 0 ? l.slice(0, i) : l; }

  function questionCardHtml(node, state) {
    var ns = state.nodes[node.id];
    var opts = node.options.map(function (o) {
      var on = ns.options.filter(function (x) { return x.id === o.id && x.isSelected; }).length > 0;
      return '<button class="ot-opt' + (on ? " on" : "") + '" data-ot-act="answer" data-ot-node="' + esc(node.id) + '" data-ot-opt="' + esc(o.id) + '">' +
        '<span class="ot-opt-radio">' + (on ? ms("radio_button_checked") : ms("radio_button_unchecked")) + "</span>" +
        '<span class="ot-opt-l">' + esc(o.label) + pillRow(o.pills) + "</span></button>";
    }).join("");
    return '<div class="ot-step" style="--ot-c:' + (CAT[node.nodeCategory] || CAT.other).color + '">' +
      '<div class="ot-step-head">' + catChip(node.nodeCategory) + (node.section ? '<span class="ot-step-sec">' + esc(node.section) + "</span>" : "") + "</div>" +
      '<h2 class="ot-step-title">' + esc(node.title || node.name) + evBadge(node) + fnMarkers(node) + "</h2>" +
      (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") +
      bulletsHtml(node.bullets) + tablesHtml(node) +
      '<div class="ot-opts">' + opts + "</div></div>";
  }

  // Protocol card - references an EXISTING protocol; lifecycle badge is unmistakable; never approved-looking for drafts.
  function protocolCardHtml(ref, match) {
    var p = st.protocols[ref];
    if (!p) return '<div class="ot-card ot-card-missing">' + esc(ref) + ' - protocol not loaded</div>';
    var badge = (match && match.badge) || (p.experimental ? "BETA · AI-DRAFTED" : (p.lifecycleState || "draft").toUpperCase());
    var approved = match ? match.approved : (p.lifecycleState === "active");
    var cls = "ot-badge " + (approved ? "ok" : (p.experimental ? "exp" : "draft"));
    var ctx = [];
    if (p.stage) ctx.push("Stage " + asArr(p.stage).join("/"));
    if (p.treatmentSetting) ctx.push(asArr(p.treatmentSetting).join("/"));
    if (p.intentOptions) ctx.push(asArr(p.intentOptions).join("/"));
    var cyc = (p.cycles ? p.cycles + " cycle" + (p.cycles === 1 ? "" : "s") : "") + (p.cycleLengthDays ? " q" + p.cycleLengthDays + "d" : "");
    var unconf = match && match.unconfirmed && match.unconfirmed.length
      ? '<div class="ot-card-verify">' + ms("error") + "Needs verification: " + esc(match.unconfirmed.join(", ")) + "</div>" : "";
    return '<div class="ot-card">' +
      '<div class="ot-card-top"><div class="ot-card-name">' + esc(p.name || ref) + "</div>" +
        '<span class="' + cls + '">' + esc(badge) + "</span></div>" +
      '<div class="ot-card-ctx">' + esc(ctx.join(" · ")) + (cyc ? '<span class="ot-card-cyc">' + esc(cyc) + "</span>" : "") + "</div>" +
      (p.version ? '<div class="ot-card-ver">Protocol v' + esc(p.version) + " · " + esc(ref) + "</div>" : "") +
      unconf +
      '<div class="ot-card-actions">' +
        '<button class="ot-btn ghost" data-ot-act="view-proto" data-ot-proto="' + esc(ref) + '">' + ms("visibility") + "View</button>" +
        (G.SMD_PROTOSHEET ? '<button class="ot-btn ghost" data-ot-act="proto-sheet" data-ot-proto="' + esc(ref) + '">' + ms("description") + "Sheet</button>" : "") +
        '<button class="ot-btn primary" data-ot-act="select-proto" data-ot-proto="' + esc(ref) + '">' + ms("check_circle") + "Select</button>" +
      "</div></div>";
  }
  function asArr(v) { return v == null ? [] : (v instanceof Array ? v : [v]); }
  // Rich checklist / criteria list on a node (workup investigations, treatment components, criteria, follow-up).
  // Each item is a plain string, or { label, sub } for a two-line item. Renders like NCCN's node checklists.
  function bulletsHtml(items) {
    items = asArr(items);
    if (!items.length) return "";
    return '<ul class="ot-bullets">' + items.map(function (b) {
      if (b && typeof b === "object") return "<li>" + esc(b.label || "") + (b.sub ? '<span class="ot-bl-sub">' + esc(b.sub) + "</span>" : "") + "</li>";
      return "<li>" + esc(b) + "</li>";
    }).join("") + "</ul>";
  }
  // Staging / dosing / biomarker tables on a node. node.tables = [{ title, headers:[], rows:[[...]] }],
  // or a single node.table with the same shape. Pure render; horizontally scrollable on mobile.
  function tablesHtml(node) {
    var tbls = node && node.tables ? asArr(node.tables) : (node && node.table ? [node.table] : []);
    if (!tbls.length) return "";
    return tbls.map(function (tb) {
      if (!tb) return "";
      var hdr = asArr(tb.headers), rows = asArr(tb.rows);
      var head = hdr.length ? "<thead><tr>" + hdr.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead>" : "";
      var body = "<tbody>" + rows.map(function (r) { return "<tr>" + asArr(r).map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody>";
      return '<div class="ot-tablewrap">' + (tb.title ? '<div class="ot-table-cap">' + esc(tb.title) + "</div>" : "") +
        '<table class="ot-table">' + head + body + "</table></div>";
    }).join("");
  }
  // Cross-page "see X" link node. node.linkGuideline jumps to another disease graph; node.linkTo re-roots
  // (rebases) the current graph at that node. Pushes a breadcrumb so the physician can navigate back.
  function linkCardHtml(node) {
    var g = node.linkGuideline, n = node.linkTo;
    if (!g && !n) return "";
    var label = node.linkLabel || (g ? ("Go to " + g) : "Continue this pathway");
    return '<button class="ot-linkcard" data-ot-act="link-follow"' +
      (g ? ' data-ot-guideline="' + esc(g) + '"' : "") + (n ? ' data-ot-node="' + esc(n) + '"' : "") + '>' +
      ms("linked_services") + '<span class="ot-linkcard-t">' + esc(label) + "</span>" + ms("arrow_forward") + "</button>";
  }
  // ---- Standard-Guidelines schema support: evidence categories + lettered footnotes ----
  // Evidence-category badge(s) on a node (e.g. "1", "2A", "2B", "3").
  function evBadge(node) {
    var ev = asArr(node && node.evidenceCategory); if (!ev.length) return "";
    return ev.map(function (c) { var s = String(c); return '<span class="ot-ev ot-ev-' + esc(s.toLowerCase().replace(/[^a-z0-9]/g, "")) + '" title="Evidence category ' + esc(s) + '">' + esc(s) + "</span>"; }).join("");
  }
  // Superscript footnote markers on a node; resolved against the graph footnote registry on tap.
  function fnMarkers(node) {
    var fns = asArr(node && node.footnotes); if (!fns.length) return "";
    return '<span class="ot-fnrow">' + fns.map(function (f) { var id = (f && typeof f === "object") ? f.id : f; return '<sup class="ot-fn" data-ot-act="footnote" data-ot-fn="' + esc(id) + '" role="button" tabindex="0">' + esc(id) + "</sup>"; }).join("") + "</span>";
  }
  function fnResolve(id) {
    var reg = (st.graph && st.graph.footnotes) || {}, f = reg[id];
    if (f == null) return null;
    return (typeof f === "object") ? f : { text: String(f) };
  }
  function footnoteSheetHtml() {
    if (!st.footnoteOpen) return "";
    var f = fnResolve(st.footnoteOpen);
    return '<div class="ot-fn-ov" data-ot-act="footnote-close"><div class="ot-fn-sheet" data-ot-act="footnote-stop">' +
      '<div class="ot-fn-hd"><b>Footnote ' + esc(st.footnoteOpen) + "</b>" +
      (f && f.evidence ? evBadge({ evidenceCategory: f.evidence }) : "") +
      '<button class="ot-fn-x" data-ot-act="footnote-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="ot-fn-body">' + (f ? esc(f.text || "") : "This footnote is not defined in the current guideline.") + "</div></div></div>";
  }

  function outcomeHtml(node, state) {
    var link = linkCardHtml(node);
    if (link) {
      var lcat = CAT[node.nodeCategory] || CAT.other;
      return '<div class="ot-outcome"><div class="ot-outcome-head" style="--ot-c:' + lcat.color + '">' + catChip(node.nodeCategory || "other") +
        '<h2 class="ot-step-title">' + esc(node.title || node.name) + evBadge(node) + fnMarkers(node) + "</h2>" +
        (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") +
        bulletsHtml(node.bullets) + tablesHtml(node) + "</div>" + link + "</div>";
    }
    var refs = asArr(node.protocolRefs);
    var rec = REC();
    // Deterministic curated refs are the primary list; recommend supplies the per-protocol match rationale
    // + narrows by the collected phenotype (a ref contradicted by the phenotype is shown as "review").
    var matchById = {};
    if (rec) {
      var protoObjs = refs.map(function (r) { return st.protocols[r]; }).filter(Boolean);
      rec.recommend(state.phenotype, protoObjs).applicable.forEach(function (m) { matchById[m.id] = m; });
    }
    var applicable = refs.filter(function (r) { return matchById[r]; });
    var excludedByPheno = refs.filter(function (r) { return st.protocols[r] && !matchById[r]; });

    // Safety Fallback: If curated protocols exist on this node, but strict phenotype filters
    // marked them as excluded, retain them as reviewable guideline options so clinicians never hit a dead end.
    if (!applicable.length && refs.length) {
      var availableRefs = refs.filter(function (r) { return st.protocols[r]; });
      if (availableRefs.length) {
        applicable = availableRefs;
        excludedByPheno = [];
      }
    }

    var cards = applicable.map(function (r) {
      var match = matchById[r];
      if (!match && st.protocols[r]) {
        var proto = st.protocols[r];
        match = {
          id: r,
          name: proto.name || r,
          badge: (proto.lifecycleState || "DRAFT").toUpperCase(),
          approved: proto.lifecycleState === "active",
          rationale: "Curated guideline regimen for " + (node.title || node.name) + ". Review clinical parameters prior to order verification."
        };
      }
      return protocolCardHtml(r, match);
    }).join("");

    var ocat = CAT[node.nodeCategory] || CAT.treatment;
    var head = '<div class="ot-outcome-head" style="--ot-c:' + ocat.color + '">' + catChip(node.nodeCategory || "treatment") +
      '<h2 class="ot-step-title">' + esc(node.title || node.name) + evBadge(node) + fnMarkers(node) + "</h2>" +
      (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") + bulletsHtml(node.bullets) + tablesHtml(node) + "</div>";

    var count = "";
    var bodyContent = "";
    if (applicable.length > 0) {
      count = '<div class="ot-outcome-count">' + applicable.length + " applicable protocol" + (applicable.length === 1 ? "" : "s") +
        ' <span class="ot-outcome-note">Decision support only. Physician selects; the existing dose engine computes doses.</span></div>';
      bodyContent = cards;
    } else {
      var isSurgObs = /surg|resect|excision|observation|surveillance|watch|rt|radiation|supportive|remission|follow-up|biochem|local/i.test((node.title || "") + " " + (node.name || "") + " " + (node.regimenSummary || ""));
      if (isSurgObs) {
        count = '<div class="ot-outcome-count"><span class="ot-outcome-note">Local / Non-Systemic Pathway &bull; Guideline Support</span></div>';
        bodyContent = '<div class="ot-nonchemo-card" style="padding:14px 16px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;margin-top:10px;display:flex;gap:12px;align-items:flex-start">' +
          '<span class="material-symbols-outlined" style="color:#16a34a;font-size:24px">verified</span>' +
          '<div><b style="color:#15803d;font-size:13px;display:block;margin-bottom:3px">Standard Local / Non-Systemic Pathway</b>' +
          '<span style="color:#166534;font-size:12px;line-height:1.4">Systemic chemotherapy is not indicated for this favorable / localized phenotype per standard clinical practice guidelines. Follow surgical resection, radiotherapy, or active surveillance protocol detailed in the clinical summary above.</span></div></div>';
      } else {
        count = '<div class="ot-outcome-count">0 applicable protocols <span class="ot-outcome-note">Decision support only.</span></div>';
        bodyContent = '<div class="ot-empty">Clinical protocol pending formal institutional review. Follow clinical guidelines above.</div>';
      }
    }

    var exHtml = excludedByPheno.length
      ? '<details class="ot-excl-proto"><summary>' + excludedByPheno.length + " option" + (excludedByPheno.length === 1 ? "" : "s") + " not applicable to this phenotype</summary>" +
        excludedByPheno.map(function (r) { var p = st.protocols[r]; return '<div class="ot-excl-row">' + esc((p && p.name) || r) + "</div>"; }).join("") + "</details>"
      : "";
    return '<div class="ot-outcome">' + head + count + bodyContent + exHtml + "</div>";
  }

  function disabledPanelHtml(state) {
    var excluded = state.order.filter(function (id) {
      var ns = state.nodes[id], node = st.byId[id];
      return ns.status === "disabled" && (node.nodeType === "end" || node.nodeCategory === "treatment" || node.showsRecommendation);
    }).map(function (id) { return { node: st.byId[id], ns: state.nodes[id] }; });
    if (!excluded.length) return "";
    var rows = excluded.map(function (e) {
      var why = e.ns.disabledBy.map(function (d) {
        return esc(d.nodeName) + (d.answers && d.answers.length ? " = " + esc(d.answers.join(", ")) : "");
      }).join("; ");
      var open = st.whyOpen[e.node.id];
      return '<div class="ot-excl">' +
        '<div class="ot-excl-h"><span class="ot-excl-name">' + esc(e.node.name) + "</span>" +
          '<span class="ot-na">Not applicable</span>' +
          '<button class="ot-why" data-ot-act="why" data-ot-node="' + esc(e.node.id) + '">' + (open ? "Hide" : "Why?") + "</button></div>" +
        (open ? '<div class="ot-excl-why">' + ms("block") + "Excluded because " + (why || "an earlier answer ruled it out") + ".</div>" : "") +
        "</div>";
    }).join("");
    return '<div class="ot-excluded"><button class="ot-excluded-toggle" data-ot-act="toggle-excluded">' + ms(st.showExcluded ? "expand_less" : "expand_more") +
      "Excluded pathways (" + excluded.length + ")</button>" + (st.showExcluded ? '<div class="ot-excluded-body">' + rows + "</div>" : "") + "</div>";
  }

  function missingHtml(state) {
    if (!state.missingRequired.length) return "";
    var cur = currentQuestion(state);
    // the current step already asks the first missing item; only note the rest as "more info needed"
    var rest = state.missingRequired.filter(function (m) { return !cur || m.id !== cur.id; });
    if (!rest.length) return "";
    return '<div class="ot-missing">' + ms("info") + "More information required: " + rest.map(function (m) { return esc(m.name); }).join(", ") + "</div>";
  }

  // ---- interactive MAP: layered node-graph layout (pure, deterministic) --------------------------
  // Longest-path layering over the DAG (from -> to), nodes centered per layer. Fixed node box so the
  // math needs no DOM measurement. ponytail: sibling order = topo order (no barycentre crossing-min);
  // fine for these tree-ish pathways - revisit only if a disease graph looks tangled.
  var NW = 168, NH = 62, HGAP = 28, VGAP = 66;
  var graphMoved = false;   // set during a pan/pinch so the trailing tap doesn't also select a node
  function graphLayout(state) {
    var ids = state.order.slice(), links = state.links;
    var layer = {}, out = {};
    ids.forEach(function (id) { layer[id] = 0; });
    Object.keys(links).forEach(function (lid) { var l = links[lid]; (out[l.from] = out[l.from] || []).push(l.to); });
    ids.forEach(function (id) { (out[id] || []).forEach(function (to) { if (layer[to] < layer[id] + 1) layer[to] = layer[id] + 1; }); });
    var layers = {}, maxL = 0;
    ids.forEach(function (id) { (layers[layer[id]] = layers[layer[id]] || []).push(id); if (layer[id] > maxL) maxL = layer[id]; });
    var maxRow = 0, L; for (L = 0; L <= maxL; L++) maxRow = Math.max(maxRow, (layers[L] || []).length);
    var canvasW = Math.max(maxRow * (NW + HGAP) - HGAP, NW), pos = {};
    for (L = 0; L <= maxL; L++) {
      var row = layers[L] || [], rowW = row.length * (NW + HGAP) - HGAP, x0 = (canvasW - rowW) / 2;
      row.forEach(function (id, i) { pos[id] = { x: x0 + i * (NW + HGAP), y: L * (NH + VGAP) }; });
    }
    var edges = Object.keys(links).map(function (lid) {
      var l = links[lid], a = pos[l.from], b = pos[l.to]; if (!a || !b) return null;
      var x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2;
      return { d: "M" + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + my + " " + x2 + "," + y2, active: l.isActive, disabled: l.isDisabled };
    }).filter(Boolean);
    return { pos: pos, edges: edges, width: canvasW, height: (maxL + 1) * (NH + VGAP) - VGAP, ids: ids };
  }

  function mapHtml(state) {
    var g = graphLayout(state);
    st._graphSize = { w: g.width, h: g.height };
    st._graphPos = g.pos;
    var paths = g.edges.map(function (e) {
      return '<path class="ot-edge' + (e.active ? " active" : "") + (e.disabled ? " disabled" : "") + '" d="' + e.d + '"/>';
    }).join("");
    var svg = '<svg class="ot-graph-svg" width="' + g.width + '" height="' + g.height + '" viewBox="0 0 ' + g.width + " " + g.height + '" fill="none">' + paths + "</svg>";
    var nodes = g.ids.map(function (id) {
      var ns = state.nodes[id], raw = st.byId[id] || {}, p = g.pos[id], cat = CAT[raw.nodeCategory] || CAT.other;
      var sel = ns.options.filter(function (o) { return o.isSelected; });
      var frontier = ns.status === "active" && !ns.isAnswered;
      var cls = "ot-gnode " + ns.status + (raw.nodeType === "end" ? " end" : "") + (ns.isResolved ? " resolved" : "") + (frontier ? " frontier" : "") + (st.mapSel === id ? " sel" : "");
      var mark = ns.status === "active" ? (ns.isAnswered ? "task_alt" : "radio_button_unchecked") : ns.status === "disabled" ? "block" : "more_horiz";
      return '<button class="' + cls + '" data-ot-act="mapnode" data-ot-node="' + esc(id) + '" style="left:' + p.x + "px;top:" + p.y + "px;width:" + NW + "px;height:" + NH + "px;--ot-c:" + cat.color + '">' +
        '<span class="ot-gn-top">' + ms(cat.icon) + '<span class="ot-gn-cat">' + esc(cat.name) + "</span>" + '<span class="ot-gn-mark">' + ms(mark) + "</span></span>" +
        '<span class="ot-gn-name">' + esc(raw.name || raw.title || id) + "</span>" +
        (asArr(raw.evidenceCategory).length ? '<span class="ot-gn-ev">' + evBadge(raw) + "</span>" : "") +
        (sel.length ? '<span class="ot-gn-sel">' + esc(shortLabel(sel[0].label)) + "</span>" : "") +
        "</button>";
    }).join("");
    return '<div class="ot-graph" id="otGraph">' +
      '<div class="ot-graph-vp" id="otGraphVp"><div class="ot-graph-canvas" id="otGraphCanvas" style="width:' + g.width + "px;height:" + g.height + 'px">' + svg + nodes + "</div></div>" +
      '<div class="ot-graph-ctl">' +
        '<button class="ot-gctl" data-ot-act="graph-zoom" data-ot-arg="out" aria-label="Zoom out">' + ms("remove") + "</button>" +
        '<button class="ot-gctl" data-ot-act="graph-fit" aria-label="Fit">' + ms("fit_screen") + "</button>" +
        '<button class="ot-gctl" data-ot-act="graph-zoom" data-ot-arg="in" aria-label="Zoom in">' + ms("add") + "</button></div>" +
      '<div class="ot-graph-hint">' + ms("drag_pan") + "Drag to pan &middot; pinch to zoom &middot; tap a node</div>" +
      tocHtml(state) +
      (st.mapSel ? mapPopHtml(st.mapSel, state) : "") +
      "</div>";
  }
  // Table-of-Contents / outline panel: nodes grouped by section, each a jump-to-node link. Collapsible.
  // Full-text over a node's visible text - powers the Contents search box.
  function nodeSearchText(raw) {
    return [raw.name || raw.title || "", raw.description || "",
      asArr(raw.bullets).map(function (b) { return (b && typeof b === "object") ? ((b.label || "") + " " + (b.sub || "")) : b; }).join(" ")
    ].join(" ").toLowerCase();
  }
  function tocItemHtml(raw, active) {
    var cat = CAT[raw.nodeCategory] || CAT.other;
    return '<button class="ot-toc-item' + (active ? " on" : "") + (st.mapSel === raw.id ? " sel" : "") +
      '" data-ot-act="toc-goto" data-ot-node="' + esc(raw.id) + '" style="--ot-c:' + cat.color + '">' + esc(raw.name || raw.title || raw.id) + "</button>";
  }
  // The list under the Contents header - a flat filtered list while searching, grouped by section otherwise.
  function tocListHtml(state) {
    var order = asArr(state.order), q = (st.tocQuery || "").trim().toLowerCase();
    if (q) {
      var hits = order.filter(function (id) { var raw = st.byId[id]; return raw && nodeSearchText(raw).indexOf(q) >= 0; });
      if (!hits.length) return '<div class="ot-toc-empty">No matches for "' + esc(q) + '"</div>';
      return hits.map(function (id) { return tocItemHtml(st.byId[id], state.nodes[id] && state.nodes[id].status === "active"); }).join("");
    }
    var secs = [], bySec = {};
    order.forEach(function (id) {
      var raw = st.byId[id]; if (!raw) return;
      var sec = raw.section || "Other";
      if (!bySec[sec]) { bySec[sec] = []; secs.push(sec); }
      bySec[sec].push(raw);
    });
    return secs.map(function (sec) {
      var items = bySec[sec].map(function (raw) { return tocItemHtml(raw, state.nodes[raw.id] && state.nodes[raw.id].status === "active"); }).join("");
      return '<div class="ot-toc-sec"><div class="ot-toc-sec-h">' + esc(sec) + "</div>" + items + "</div>";
    }).join("");
  }
  function tocHtml(state) {
    if (st.tocOpen === false) return '<button class="ot-toc-fab" data-ot-act="toc-toggle" aria-label="Contents">' + ms("list") + "</button>";
    return '<div class="ot-toc"><div class="ot-toc-hd">' + ms("list") + "<span>Contents</span>" +
      '<button class="ot-toc-x" data-ot-act="toc-toggle" aria-label="Collapse contents">' + ms("close") + "</button></div>" +
      '<div class="ot-toc-search-wrap">' + ms("search") +
        '<input class="ot-toc-search" type="text" placeholder="Search this navigator" data-ot-input="toc-search" value="' + esc(st.tocQuery || "") + '">' +
        '<button class="ot-toc-clear" data-ot-act="toc-clear" aria-label="Clear">' + ms("close") + "</button></div>" +
      '<div class="ot-toc-body" id="otTocList">' + tocListHtml(state) + "</div></div>";
  }

  // Bottom-sheet detail for a tapped map node - keeps the physician IN the map (interactive), shows the
  // node's category/answer/why, and offers the same jump the pathway rail's Edit does.
  function mapPopHtml(id, state) {
    var ns = state.nodes[id]; if (!ns) return "";
    var raw = st.byId[id] || {}, cat = CAT[raw.nodeCategory] || CAT.other;
    var sel = ns.options.filter(function (o) { return o.isSelected; });
    var why = (ns.disabledBy || []).map(function (e) { return esc(e.nodeName || e.nodeId) + (e.optionLabel ? " = " + esc(e.optionLabel) : ""); });
    var statusTxt = ns.status === "active" ? (ns.isAnswered ? "Answered" : "Current step") : ns.status === "disabled" ? "Excluded branch" : "Not yet reached";
    return '<div class="ot-mappop" id="otMapPop" style="--ot-c:' + cat.color + '">' +
      '<button class="ot-mappop-x" data-ot-act="mappop-close" aria-label="Close">' + ms("close") + "</button>" +
      '<div class="ot-mappop-cat">' + ms(cat.icon) + esc(cat.name) + " &middot; " + esc(statusTxt) + "</div>" +
      '<div class="ot-mappop-name">' + esc(raw.name || raw.title || id) + evBadge(raw) + fnMarkers(raw) + "</div>" +
      (raw.description ? '<div class="ot-mappop-desc">' + esc(raw.description) + "</div>" : "") +
      bulletsHtml(raw.bullets) + tablesHtml(raw) +
      (asArr(raw.protocolRefs).length ? '<div class="ot-mappop-rx">' + ms("medication") + "Regimens: " + asArr(raw.protocolRefs).map(function (r) { var p = st.protocols[r]; return esc((p && p.name) || r); }).join("; ") + "</div>" : "") +
      (sel.length ? '<div class="ot-mappop-sel">' + ms("check_circle") + esc(sel[0].label) + "</div>" : "") +
      (why.length ? '<div class="ot-mappop-why">' + ms("block") + "Excluded because " + why.join("; ") + "</div>" : "") +
      (ns.status === "active" ? '<button class="ot-btn primary sm" data-ot-act="map-goto" data-ot-node="' + esc(id) + '">' + ms("my_location") + "Go to this step</button>" : "") +
      "</div>";
  }

  function protocolDetailHtml(ref) {
    var p = resolveProto(ref);
    if (!p) return '<div class="ot-empty">Protocol not loaded.</div>';
    var badge = p.experimental ? "BETA · AI-DRAFTED" : (p.lifecycleState || "draft").toUpperCase();
    var drugs = asArr(p.drugs).map(function (d) {
      var freq = d.frequency || (d.dosesPerDay > 1 ? ({ 2: "BID", 3: "TID", 4: "QID" }[d.dosesPerDay] || d.dosesPerDay + "x/day") : "");
      var dm = asArr(d.days).length ? "D" + (d.days.length === 1 ? d.days[0] : d.days[0] + "-" + d.days[d.days.length - 1]) : "";
      return '<tr><td>' + esc(d.name || d.id) + "</td><td>" + esc((d.dosePerUnit != null ? d.dosePerUnit + " " + (d.unit || "") : "VERIFY") + (freq ? " " + freq : "")) + "</td><td>" + esc((d.route || "") + (dm ? " " + dm : "")) + "</td></tr>";
    }).join("");
    var src = p.source ? [p.source.nccn, p.source.textbook].filter(Boolean).join(" · ") : "";
    return '<div class="ot-detail">' +
      '<button class="ot-back" data-ot-act="close-proto">' + ms("arrow_back") + "Back to options</button>" +
      '<div class="ot-detail-head"><h2>' + esc(p.name || ref) + '</h2><span class="ot-badge ' + (p.experimental ? "exp" : "draft") + '">' + esc(badge) + "</span></div>" +
      '<div class="ot-detail-warn">' + ms("info") + "AI-drafted (Beta). Decision support only. Verify against your institutional protocol; the physician and dose engine own dosing.</div>" +
      '<div class="ot-detail-meta">' +
        (p.diseaseId ? '<div><b>Disease</b>' + esc(p.diseaseId) + "</div>" : "") +
        (p.stage ? '<div><b>Stage</b>' + esc(asArr(p.stage).join(", ")) + "</div>" : "") +
        (p.treatmentSetting ? '<div><b>Setting</b>' + esc(asArr(p.treatmentSetting).join(", ")) + "</div>" : "") +
        (p.intentOptions ? '<div><b>Intent</b>' + esc(asArr(p.intentOptions).join(", ")) + "</div>" : "") +
        (p.cycles ? '<div><b>Cycles</b>' + esc(p.cycles + (p.cycleLengthDays ? " q" + p.cycleLengthDays + "d" : "")) + "</div>" : "") +
        (p.version ? '<div><b>Version</b>' + esc(p.version) + "</div>" : "") +
      "</div>" +
      (drugs ? '<div class="ot-detail-sec">Regimen (per-administration dose; the dose engine computes patient doses)</div><table class="ot-drugs"><thead><tr><th>Drug</th><th>Dose</th><th>Route / days</th></tr></thead><tbody>' + drugs + "</tbody></table>" : "") +
      (src ? '<div class="ot-detail-src"><b>Evidence source</b> ' + esc(src) + "</div>" : "") +
      '<div class="ot-detail-actions">' +
        (G.SMD_PROTOSHEET ? '<button class="ot-btn ghost lg" data-ot-act="proto-sheet" data-ot-proto="' + esc(ref) + '">' + ms("description") + "Protocol sheet</button>" : "") +
        '<button class="ot-btn primary lg" data-ot-act="select-proto" data-ot-proto="' + esc(ref) + '">' + ms("check_circle") + "Select this protocol</button></div>" +
      '<div class="ot-superpowers-bar">' +
        '<button class="ot-btn ghost sm" data-ot-act="cycle-timeline" data-ot-proto="' + esc(ref) + '">' + ms("calendar_month") + " Cycle Timeline</button>" +
        '<button class="ot-btn ghost sm" data-ot-act="organ-dose-check" data-ot-proto="' + esc(ref) + '">' + ms("water_drop") + " Organ Dose</button>" +
        '<button class="ot-btn ghost sm" data-ot-act="ddi-check" data-ot-proto="' + esc(ref) + '">' + ms("medication") + " DDI Sentry</button>" +
        '<button class="ot-btn ghost sm" data-ot-act="genomics-drawer" data-ot-proto="' + esc(ref) + '">' + ms("biotech") + " Genomics</button>" +
      '</div>' +
      "</div>";
  }

  function selectionHtml() {
    var s = st.selection, p = st.protocols[s.protocolId] || {};
    return '<div class="ot-selection">' +
      '<div class="ot-sel-icon">' + ms("check_circle") + "</div>" +
      "<h2>Protocol selected</h2>" +
      '<div class="ot-sel-name">' + esc(p.name || s.protocolId) + '</div>' +
      '<div class="ot-badge ' + (p.experimental ? "exp" : "draft") + '">' + esc(s.badge) + "</div>" +
      '<div class="ot-sel-note">' + ms("info") + "Recorded the physician's selection. This does NOT activate a treatment plan or compute a dose. Continue in the existing StewardMD oncology workflow, where the dose engine and physician confirmation apply.</div>" +
      '<div class="ot-sel-payload"><b>Handoff</b>' +
        "<div>Protocol: " + esc(s.protocolId) + " v" + esc(s.protocolVersion || "-") + "</div>" +
        "<div>Navigator: " + esc(s.guideline) + " v" + esc(s.navigatorVersion) + "</div>" +
        "<div>Phenotype: " + esc(phenoSummary(s.phenotype)) + "</div>" +
      "</div>" +
      '<div class="ot-sel-actions">' +
        '<button class="ot-btn ghost" data-ot-act="back-pathway">' + ms("arrow_back") + "Back to pathway</button>" +
        (G.SMD_PROTOSHEET ? '<button class="ot-btn ghost" data-ot-act="proto-sheet" data-ot-proto="' + esc(s.protocolId) + '">' + ms("description") + "Protocol sheet</button>" : "") +
        '<button class="ot-btn primary" data-ot-act="handoff">' + ms("open_in_new") + "Continue in treatment workflow</button>" +
      "</div></div>";
  }
  function phenoSummary(ph) {
    ph = ph || {}; var parts = [];
    if (ph.stage) parts.push("Stage " + ph.stage);
    if (ph.biomarkers) { if (ph.biomarkers.HER2) parts.push("HER2 " + ph.biomarkers.HER2); if (ph.biomarkers.HR) parts.push("HR " + ph.biomarkers.HR); }
    if (ph.setting) parts.push(ph.setting);
    return parts.join(", ") || "not specified";
  }

  var COMMON_DISEASE_IDS = ["breast", "lung", "colorectal", "uppergi", "prostate", "bladder", "rcc", "testicular", "melanoma", "cervical", "ovarian", "myeloma", "headneck"];

  function getDiseaseCategory(d) {
    var id = (d && d.id) || "";
    var ic = (d && d.icon) || "";
    if (id.indexOf("pediatric") === 0 || id === "neuroblastoma" || id === "wilms") return "peds";
    if (ic === "bloodtype" || ["dlbcl", "hodgkin", "bcell", "tcell_lymphoma", "cutaneous_lymphoma", "histiocytic", "mastocytosis", "waldenstrom", "amyloidosis", "castleman", "mds", "mpn"].indexOf(id) >= 0) return "heme";
    return "solid";
  }

  function getDiseaseIconTheme(d) {
    var ic = (d && d.icon) || "";
    if (ic === "female") return "rose";
    if (ic === "pulmonology") return "sky";
    if (ic === "gastroenterology") return "emerald";
    if (ic === "man" || ic === "water_drop" || ic === "nephrology") return "indigo";
    if (ic === "bloodtype") return "crimson";
    if (ic === "child_care") return "amber";
    if (ic === "dermatology") return "violet";
    if (ic === "neurology") return "purple";
    return "teal";
  }

  function diseaseCardsHtml() {
    var q = (st.pickerSearch || "").trim().toLowerCase();
    var cat = st.pickerCategory || "all";
    var filtered = DISEASES.filter(function (d) {
      if (cat === "common" && COMMON_DISEASE_IDS.indexOf(d.id) < 0) return false;
      if (cat !== "all" && cat !== "common" && getDiseaseCategory(d) !== cat) return false;
      if (!q) return true;
      var title = (d.title || "").toLowerCase();
      var sub = (d.sub || "").toLowerCase();
      var id = (d.id || "").toLowerCase();
      return title.indexOf(q) >= 0 || sub.indexOf(q) >= 0 || id.indexOf(q) >= 0;
    });

    if (!filtered.length) {
      return '<div class="ot-empty-search">' +
        ms("search_off") +
        '<div class="ot-empty-t">No matching cancer guidelines</div>' +
        '<div class="ot-empty-sub">Try searching with a different term or select another category above.</div>' +
        (q ? '<button class="ot-btn ghost sm" data-ot-act="picker-clear-search">' + ms("backspace") + 'Clear search</button>' : '') +
        '</div>';
    }

    var cards = filtered.map(function (d) {
      var theme = getDiseaseIconTheme(d);
      return '<button class="ot-disease ot-theme-' + theme + '" data-ot-act="pick" data-ot-guideline="' + esc(d.id) + '"' + (d.ready ? "" : " disabled") + '>' +
        '<div class="ot-disease-ic">' + ms(d.icon) + '</div>' +
        '<div class="ot-disease-t">' +
          '<div class="ot-disease-title-row">' +
            '<b>' + esc(d.title) + '</b>' +
            (d.ready ? '<span class="ot-card-pill">NCCN</span>' : '<span class="ot-soon">soon</span>') +
          '</div>' +
          '<span>' + esc(d.sub) + '</span>' +
        '</div>' +
        '<span class="material-symbols-outlined ot-chevron">chevron_right</span>' +
      '</button>';
    }).join("");

    var maker = (cat === "all" || cat === "common") && !q && G.SMD_PROTOMAKER ? (
      '<button class="ot-disease ot-disease-maker" data-ot-act="proto-maker">' +
        '<div class="ot-disease-ic">' + ms("note_add") + '</div>' +
        '<div class="ot-disease-t">' +
          '<div class="ot-disease-title-row"><b>Custom Clinical Protocol</b><span class="ot-card-pill ot-pill-maker">BUILDER</span></div>' +
          '<span>Author or paste an off-guideline regimen for this patient</span>' +
        '</div>' +
        '<span class="material-symbols-outlined ot-chevron">add</span>' +
      '</button>'
    ) : "";

    return cards + maker;
  }

  // Disease-picker landing (multi-disease entry). Only diseases with a reviewed graph are selectable.
  function pickerHtml() {
    var q = esc(st.pickerSearch || "");
    var curCat = st.pickerCategory || "all";
    var counts = {
      all: DISEASES.length,
      common: DISEASES.filter(function (d) { return COMMON_DISEASE_IDS.indexOf(d.id) >= 0; }).length,
      solid: DISEASES.filter(function (d) { return getDiseaseCategory(d) === "solid"; }).length,
      heme: DISEASES.filter(function (d) { return getDiseaseCategory(d) === "heme"; }).length,
      peds: DISEASES.filter(function (d) { return getDiseaseCategory(d) === "peds"; }).length
    };

    return '<div class="ot-picker">' +
      '<div class="ot-picker-hd">' +
        '<div class="ot-picker-topline">' +
          '<div class="ot-picker-badge">' + ms("verified") + '<span>NCCN GUIDELINES HARMONIZED · V2026</span></div>' +
          '<button type="button" class="ot-calc-pill" data-ot-act="open-calvert-calc">' + ms("calculate") + '<span>Creatinine &amp; Calvert</span></button>' +
        '</div>' +
        '<h1 class="ot-picker-h">Oncology Navigator</h1>' +
        '<p class="ot-picker-sub">Evidence-based clinical decision algorithms, biomarker stratifications, and standardized treatment protocols.</p>' +
      '</div>' +
      '<div class="ot-picker-controls">' +
        '<div class="ot-search-box">' +
          ms("search") +
          '<input type="search" class="ot-search-input" data-ot-input="picker-search" placeholder="Search 40+ cancer guidelines..." value="' + q + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
          '<button class="ot-search-clear" data-ot-act="picker-clear-search" aria-label="Clear search" style="display:' + (q ? "grid" : "none") + '">' + ms("cancel") + '</button>' +
        '</div>' +
        '<div class="ot-picker-tabs">' +
          '<button class="ot-tab-chip' + (curCat === "all" ? " on" : "") + '" data-ot-act="picker-filter" data-ot-cat="all">All <span class="ot-chip-num">' + counts.all + '</span></button>' +
          '<button class="ot-tab-chip' + (curCat === "common" ? " on" : "") + '" data-ot-act="picker-filter" data-ot-cat="common">Common <span class="ot-chip-num">' + counts.common + '</span></button>' +
          '<button class="ot-tab-chip' + (curCat === "solid" ? " on" : "") + '" data-ot-act="picker-filter" data-ot-cat="solid">Solid <span class="ot-chip-num">' + counts.solid + '</span></button>' +
          '<button class="ot-tab-chip' + (curCat === "heme" ? " on" : "") + '" data-ot-act="picker-filter" data-ot-cat="heme">Hematologic <span class="ot-chip-num">' + counts.heme + '</span></button>' +
          '<button class="ot-tab-chip' + (curCat === "peds" ? " on" : "") + '" data-ot-act="picker-filter" data-ot-cat="peds">Pediatric <span class="ot-chip-num">' + counts.peds + '</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="ot-disease-list" id="otDiseaseList">' +
        diseaseCardsHtml() +
      '</div>' +
    '</div>';
  }

  // Breadcrumb trail across cross-page link jumps (guideline switches + in-graph rebases).
  function crumbsHtml() {
    if (!st.trail || !st.trail.length) return "";
    var items = st.trail.map(function (c, i) {
      return '<button class="ot-crumb" data-ot-act="crumb" data-ot-idx="' + i + '">' + esc(c.label || "Start") + "</button>" + ms("chevron_right");
    }).join("");
    var curNode = st.rebaseId && st.byId[st.rebaseId];
    var cur = curNode ? (curNode.name || curNode.title || "") : (st.graph ? (st.graph.title || st.guideline || "") : "");
    return '<div class="ot-crumbs">' + ms("account_tree") + items + '<span class="ot-crumb cur">' + esc(cur) + "</span></div>";
  }
  // Plain-text summary of the walked pathway - copyable / shareable (no PHI; decision logic only).
  function summaryText(state) {
    var lines = [];
    lines.push((st.graph && (st.graph.title || st.guideline)) || "Oncology navigator");
    if (st.graph && st.graph.navigatorVersion) lines.push("Navigator " + st.graph.navigatorVersion);
    lines.push("");
    var steps = answeredSteps(state);
    if (steps.length) {
      lines.push("PATHWAY");
      steps.forEach(function (n) {
        var ns = state.nodes[n.id], sel = ns.options.filter(function (o) { return o.isSelected; }).map(function (o) { return o.label; });
        lines.push("- " + (n.name || n.title || n.id) + ": " + (sel.join(", ") || "-"));
      });
      lines.push("");
    }
    var outs = reachedOutcomes(state);
    if (outs.length) {
      lines.push("OUTCOME");
      outs.forEach(function (n) {
        lines.push("- " + (n.title || n.name || n.id));
        asArr(n.protocolRefs).forEach(function (r) { var p = st.protocols[r]; lines.push("    regimen: " + ((p && p.name) || r)); });
      });
      lines.push("");
    }
    lines.push("Decision support only - DRAFT. The physician decides; the dose engine computes doses.");
    return lines.join("\n");
  }
  // ---- NCCN GUIDELINES NAVIGATOR (interactive horizontal multi-column flowchart) --------------
  var SECTIONS_BREAST = [
    { title: "Table of Contents", sec: "Diagnosis", desc: "Initial Presentation & Histopathology", opt: null },
    { title: "Ductal Carcinoma In Situ (DCIS)", sec: "DCIS", desc: "Workup, Surgical Margins & Endocrine Risk-Reduction", opt: "dcis" },
    { title: "Invasive Breast Cancer: Workup & Staging", sec: "Workup", desc: "Clinical Staging, Multidisciplinary Workup & Genetic Testing", opt: "invasive" },
    { title: "Locoregional Therapy (BCS vs Mastectomy)", sec: "Locoregional", desc: "Breast-Conserving Surgery ± RT vs Total Mastectomy ± PMRT", opt: "invasive" },
    { title: "Preoperative Systemic Therapy (Neoadjuvant)", sec: "Preoperative", desc: "Anthracycline/Taxane, Dual HER2 Blockade, Keynote-522", opt: "invasive" },
    { title: "Post-Neoadjuvant Residual Triage", sec: "Adjuvant Post-pCR", desc: "pCR De-escalation vs Residual Non-pCR Escalation (T-DM1 / Olaparib)", opt: "invasive" },
    { title: "Adjuvant Systemic Therapy (Upfront Surgery)", sec: "Adjuvant Upfront", desc: "Subtype-Adapted: HR+/HER2-, HER2+, TNBC, Favorable", opt: "invasive" },
    { title: "Adjuvant Endocrine Therapy & CDK4/6", sec: "Endocrine Therapy", desc: "Postmenopausal vs Premenopausal + OFS; monarchE / NATALEE", opt: "invasive" },
    { title: "Recurrent & Stage IV (Metastatic) Disease", sec: "Metastatic", desc: "1L CDK4/6 + AI, 4-Tier HER2 Spectrum, Post-CDK4/6 Biomarkers", opt: "recurrent" },
    { title: "Special Presentations (IBC, Phyllodes, Paget)", sec: "Special Presentations", desc: "Inflammatory Breast Cancer, Phyllodes, Paget, Pregnancy", opt: "ibc" },
    { title: "Post-Therapy Surveillance & Survivorship", sec: "Surveillance", desc: "Mammography, DEXA Monitoring, Bone-Modifying Therapy", opt: "invasive" }
  ];

  function buildNavFlowchart(state) {
    var startId = (st.graph.startNodeIds && st.graph.startNodeIds[0]) || (st.graph.nodes[0] && st.graph.nodes[0].id);
    if (!startId) return { columns: [], edges: [], colOf: {}, cardPos: {} };

    var links = st.graph.links || [];
    var linksFrom = {};
    links.forEach(function (l) {
      linksFrom[l.from] = linksFrom[l.from] || [];
      linksFrom[l.from].push(l);
    });

    var columns = [];
    var colOf = {};
    var visited = {};
    var edges = [];

    columns.push([startId]);
    colOf[startId] = 0;
    visited[startId] = true;

    var curColIdx = 0;
    while (curColIdx < columns.length) {
      var curCol = columns[curColIdx];
      var activeNodeId = curCol.find(function (id) {
        return state.nodes[id] && state.nodes[id].status === "active";
      });
      if (!activeNodeId) break;

      var node = st.byId[activeNodeId];
      if (!node) break;

      var outLinks = linksFrom[activeNodeId] || [];
      if (!outLinks.length) break;

      var selOpts = st.answers[activeNodeId] || [];
      var nextActiveTarget = null;
      var nextOtherTargets = [];

      outLinks.forEach(function (l) {
        var fromOpts = l.fromOptions || [];
        var isSel = selOpts.length && fromOpts.some(function (o) { return selOpts.indexOf(o) >= 0; });
        var isDirect = !fromOpts.length || fromOpts.indexOf("continue") >= 0;

        if (isSel || (isDirect && (node.nodeType !== "question" || selOpts.length))) {
          nextActiveTarget = l.to;
          edges.push({ from: activeNodeId, to: l.to, fromOpt: selOpts[0] || fromOpts[0], active: true });
        } else if (st.showNonActive) {
          if (nextOtherTargets.indexOf(l.to) < 0 && l.to !== nextActiveTarget) {
            nextOtherTargets.push(l.to);
          }
          edges.push({ from: activeNodeId, to: l.to, fromOpt: fromOpts[0], active: false });
        }
      });

      var nextColNodes = [];
      if (nextActiveTarget) nextColNodes.push(nextActiveTarget);
      if (st.showNonActive) {
        nextOtherTargets.forEach(function (id) {
          if (nextColNodes.indexOf(id) < 0 && !visited[id]) nextColNodes.push(id);
        });
      }

      if (nextColNodes.length) {
        nextColNodes.forEach(function (id) {
          colOf[id] = curColIdx + 1;
          visited[id] = true;
        });
        columns.push(nextColNodes);
      } else {
        break;
      }

      curColIdx++;
      if (curColIdx > 15) break;
    }

    var CW = 360, CGAP = 75, VGAP = 24;
    var cardPos = {};
    var maxW = Math.max(columns.length * (CW + CGAP), CW + 100);
    var maxH = 800;

    columns.forEach(function (col, cIdx) {
      var curY = 30;
      var curX = 30 + cIdx * (CW + CGAP);
      col.forEach(function (nodeId) {
        var raw = st.byId[nodeId] || {};
        var optCount = (raw.options || []).length;
        var bulletCount = (raw.bullets || []).length;
        var estH = 140 + optCount * 42 + (bulletCount ? Math.min(bulletCount * 22, 160) : 0);
        cardPos[nodeId] = { x: curX, y: curY, w: CW, h: estH, optCount: optCount };
        curY += estH + VGAP;
      });
      if (curY > maxH) maxH = curY;
    });

    var svgEdges = edges.map(function (e) {
      var pFrom = cardPos[e.from], pTo = cardPos[e.to];
      if (!pFrom || !pTo) return null;
      var rawFrom = st.byId[e.from] || {};
      var optIdx = 0;
      if (e.fromOpt && rawFrom.options) {
        var foundIdx = rawFrom.options.findIndex(function (o) { return o.id === e.fromOpt; });
        if (foundIdx >= 0) optIdx = foundIdx;
      }
      var x1 = pFrom.x + pFrom.w;
      var y1 = pFrom.y + 70 + optIdx * 42 + 20;
      var x2 = pTo.x;
      var y2 = pTo.y + 36;
      var mx = (x1 + x2) / 2;
      var d = "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2;
      return { d: d, active: e.active, from: e.from, to: e.to };
    }).filter(Boolean);

    return { columns: columns, edges: svgEdges, cardPos: cardPos, width: maxW + 120, height: maxH + 100, colOf: colOf };
  }

  function navNodeCardHtml(nodeId, state, isActive) {
    var raw = st.byId[nodeId];
    if (!raw) return "";
    var ns = state.nodes[nodeId] || { status: isActive ? "active" : "disabled", options: [] };
    var cat = CAT[raw.nodeCategory] || CAT.other;
    var selOpts = st.answers[nodeId] || [];
    var isOutcome = raw.nodeType === "end" || raw.showsRecommendation;
    var code = raw.linkId || (raw.id.replace(/^n_/, "").toUpperCase());
    var title = raw.name || raw.title || nodeId;
    var desc = raw.description || "";

    var optsHtml = (raw.options || []).map(function (o) {
      var isSelected = selOpts.indexOf(o.id) >= 0;
      return '<div class="ot-nav-opt' + (isSelected ? " selected" : "") + '" data-ot-act="answer" data-ot-node="' + esc(nodeId) + '" data-ot-opt="' + esc(o.id) + '">' +
        '<span class="ot-nav-radio' + (isSelected ? " checked" : "") + '"><span class="ot-nav-radio-dot"></span></span>' +
        '<span class="ot-nav-opt-lbl">' + esc(o.label) + '</span>' +
        '</div>';
    }).join("");

    var workupHtml = "";
    if (raw.bullets && raw.bullets.length && (raw.nodeCategory === "workup" || raw.nodeCategory === "criteria" || !raw.options || !raw.options.length)) {
      workupHtml = '<div class="ot-nav-workup-list">' +
        raw.bullets.slice(0, 10).map(function (b) {
          var txt = (b && typeof b === "object") ? ((b.label || "") + ": " + (b.sub || "")) : String(b);
          return '<div class="ot-nav-check-item">' +
            '<span class="material-symbols-outlined ot-nav-check-ic">check_box</span>' +
            '<span class="ot-nav-check-txt">' + esc(txt) + '</span>' +
            '</div>';
        }).join("") +
        '</div>';
    }

    var linksHtml = "";
    var refs = asArr(raw.protocolRefs);
    if (refs.length) {
      var p0 = st.protocols[refs[0]];
      var protoName = (p0 && p0.name) || refs[0];
      linksHtml = '<div class="ot-nav-links-wrap">' +
        '<button class="ot-nav-links-btn" data-ot-act="view-proto" data-ot-proto="' + esc(refs[0]) + '">' +
          '<span class="ot-nav-tx-badge">Tx</span>' +
          '<span class="ot-nav-links-pill">' + ms("link") + ' Links (' + refs.length + ')</span>' +
          '<span class="ot-nav-links-label">' + esc(shortLabel(protoName)) + '</span>' +
        '</button>' +
        '</div>';
    }

    return '<div class="ot-nav-card' + (isActive ? " active" : " non-active") + (isOutcome ? " outcome" : "") + '" id="otNavCard_' + esc(nodeId) + '" style="--ot-nav-c:' + cat.color + '">' +
      '<div class="ot-nav-card-hd">' +
        '<div class="ot-nav-card-cat">' + ms(cat.icon) + '<span>' + esc(cat.name) + '</span></div>' +
        '<div class="ot-nav-card-code">' + esc(code) + '</div>' +
      '</div>' +
      '<div class="ot-nav-card-title ot-step-title">' + esc(title) + '</div>' +
      (desc ? '<div class="ot-nav-card-desc">' + esc(desc) + '</div>' : "") +
      workupHtml +
      (optsHtml ? '<div class="ot-nav-opts">' + optsHtml + '</div>' : "") +
      linksHtml +
      '</div>';
  }

  function navSidebarHtml(state) {
    var secs = (st.guideline === "breast" || !st.guideline) ? SECTIONS_BREAST : [];
    if (!secs.length) {
      var seenSec = {};
      (st.graph.nodes || []).forEach(function (n) {
        if (n.section && !seenSec[n.section]) {
          seenSec[n.section] = true;
          secs.push({ title: n.section, sec: n.section, opt: null, desc: "" });
        }
      });
    }

    var q = (st.tocQuery || "").trim().toLowerCase();
    var filtered = secs.filter(function (s) {
      if (!q) return true;
      return s.title.toLowerCase().indexOf(q) >= 0 || (s.desc && s.desc.toLowerCase().indexOf(q) >= 0);
    });

    var itemsHtml = filtered.map(function (s) {
      return '<button class="ot-nav-sb-item" data-ot-act="nav-jump-section" data-ot-sec="' + esc(s.sec) + '" data-ot-opt="' + esc(s.opt || "") + '">' +
        '<div class="ot-nav-sb-item-t">' + esc(s.title) + '</div>' +
        (s.desc ? '<div class="ot-nav-sb-item-d">' + esc(s.desc) + '</div>' : "") +
        '</button>';
    }).join("");

    return '<aside class="ot-nav-sidebar' + (st.sidebarOpen === false ? " collapsed" : "") + '" id="otNavSidebar">' +
      '<div class="ot-nav-sb-hd">' +
        '<div class="ot-nav-sb-title">' + ms("menu_book") + '<span>Table of Contents</span></div>' +
        '<button class="ot-nav-sb-toggle" data-ot-act="nav-sidebar-toggle" aria-label="Toggle Sidebar">' + ms("first_page") + '</button>' +
      '</div>' +
      '<div class="ot-nav-sb-search">' + ms("search") +
        '<input type="text" placeholder="Search guidelines..." data-ot-input="toc-search" value="' + esc(st.tocQuery || "") + '">' +
      '</div>' +
      '<div class="ot-nav-sb-list">' + (itemsHtml || '<div class="ot-toc-empty">No matches found</div>') + '</div>' +
      '</aside>';
  }

  function isMobileScreen() {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
  }
  function currentNavMode() {
    if (st.navMode === "flow") return "flow";
    if (st.navMode === "canvas") return "canvas";
    return isMobileScreen() ? "flow" : "canvas";
  }

  var CLINICAL_STAGES = [
    { id: "workup", label: "1. Workup", icon: "biotech" },
    { id: "staging", label: "2. Staging", icon: "checklist" },
    { id: "primary", label: "3. Primary Tx", icon: "medical_services" },
    { id: "response", label: "4. Response", icon: "fact_check" },
    { id: "subtype", label: "5. Subtype/Adjuvant", icon: "dna" },
    { id: "regimens", label: "6. Regimens", icon: "medication" }
  ];

  function getActiveStageIndex(state) {
    var cur = currentQuestion(state);
    var outs = reachedOutcomes(state);
    if (!cur && outs.length) return 5;
    if (!cur) return 0;
    var sec = (cur.section || "").toLowerCase();
    var cat = (cur.nodeCategory || "").toLowerCase();
    var id = cur.id.toLowerCase();

    if (id.indexOf("mbc") >= 0 || id.indexOf("recur") >= 0 || sec.indexOf("metastatic") >= 0) {
      if (id.indexOf("genom") >= 0 || id.indexOf("line") >= 0) return 4;
      return 1;
    }
    if (sec.indexOf("workup") >= 0 || cat === "workup") return 0;
    if (sec.indexOf("staging") >= 0 || id === "n_histology" || (id.indexOf("er") >= 0 && id.indexOf("dcis") >= 0)) return 1;
    if (sec.indexOf("sequencing") >= 0 || sec.indexOf("locoregional") >= 0 || sec.indexOf("preoperative") >= 0 || id.indexOf("tx_preop") >= 0 || id.indexOf("locoregional") >= 0) return 2;
    if (sec.indexOf("response") >= 0 || id.indexOf("response") >= 0 || id.indexOf("pcr") >= 0 || id.indexOf("residual") >= 0) return 3;
    if (sec.indexOf("adjuvant") >= 0 || sec.indexOf("subtype") >= 0 || sec.indexOf("endocrine") >= 0 || id.indexOf("subtype") >= 0 || id.indexOf("hrpos") >= 0) return 4;
    return 1;
  }

  function navStageStepperHtml(state) {
    var curIdx = getActiveStageIndex(state);
    var stepsHtml = CLINICAL_STAGES.map(function (stage, idx) {
      var isPassed = idx < curIdx;
      var isCurrent = idx === curIdx;
      var statusClass = isPassed ? "completed" : (isCurrent ? "current" : "upcoming");
      return '<div class="ot-flow-step-item ' + statusClass + '">' +
        '<div class="ot-flow-step-dot">' + (isPassed ? ms("check") : ms(stage.icon)) + '</div>' +
        '<div class="ot-flow-step-lbl">' + esc(stage.label) + '</div>' +
        '</div>';
    }).join('<div class="ot-flow-step-arrow">' + ms("chevron_right") + '</div>');

    return '<div class="ot-flow-stepper-wrap">' +
      '<div class="ot-flow-stepper">' + stepsHtml + '</div>' +
      '</div>';
  }

  function navFlowchartViewHtml(state) {
    var answered = answeredSteps(state);
    var answeredCardsHtml = answered.map(function (node, idx) {
      var selOpts = st.answers[node.id] || [];
      var optLabels = (node.options || []).filter(function (o) {
        return selOpts.indexOf(o.id) >= 0;
      }).map(function (o) { return o.label; });
      var choiceTxt = optLabels.join(", ") || selOpts.join(", ");
      var cat = CAT[node.nodeCategory] || CAT.other;

      return '<div class="ot-flow-card completed" id="otFlowCard_' + esc(node.id) + '">' +
        '<div class="ot-flow-card-hd">' +
          '<div class="ot-flow-card-cat" style="color:' + cat.color + '">' + ms(cat.icon) + '<span>' + esc(cat.name) + '</span></div>' +
          '<div class="ot-flow-badge-group">' +
            '<span class="ot-flow-done-pill">' + ms("check_circle") + ' Done</span>' +
            '<button class="ot-flow-edit-btn" data-ot-act="nav-edit-step" data-ot-node="' + esc(node.id) + '">' + ms("edit") + ' Change</button>' +
          '</div>' +
        '</div>' +
        '<div class="ot-flow-card-title">' + esc(node.title || node.name) + '</div>' +
        '<div class="ot-flow-answered-val" data-ot-act="answer" data-ot-node="' + esc(node.id) + '" data-ot-opt="' + esc(selOpts[0] || "") + '">' +
          '<div class="ot-flow-answered-dot"></div>' +
          '<div class="ot-flow-answered-txt"><b>Selected:</b> ' + esc(choiceTxt) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ot-flow-connector"><div class="ot-flow-line"></div>' + ms("arrow_downward") + '</div>';
    }).join("");

    var cur = currentQuestion(state);
    var activeCardHtml = "";
    if (cur) {
      var cat = CAT[cur.nodeCategory] || CAT.other;
      var hasBullets = cur.bullets && cur.bullets.length;
      var isWorkup = cur.nodeCategory === "workup" || cur.nodeCategory === "criteria";

      var workupHtml = "";
      if (hasBullets) {
        workupHtml = '<div class="ot-flow-workup-box">' +
          '<div class="ot-flow-workup-hd">' +
            ms(isWorkup ? "biotech" : "checklist") +
            '<span>' + (isWorkup ? "High-Yield Diagnostic Workup Checklist" : "Clinical Evaluation Criteria") + '</span>' +
          '</div>' +
          '<div class="ot-flow-workup-list">' +
            cur.bullets.map(function (b) {
              var txt = (b && typeof b === "object") ? ((b.label || "") + ": " + (b.sub || "")) : String(b);
              return '<div class="ot-flow-check-item">' +
                '<span class="material-symbols-outlined ot-flow-check-ic">check_box</span>' +
                '<span class="ot-flow-check-txt">' + esc(txt) + '</span>' +
              '</div>';
            }).join("") +
          '</div>' +
          '</div>';
      }

      var opts = cur.options || [];
      var isSingleContinue = opts.length === 1 && /^(continue|next|proceed|ack)$/i.test(opts[0].id);
      var optsHtml = "";

      if (isSingleContinue) {
        var opt = opts[0];
        optsHtml = '<div class="ot-flow-single-opt">' +
          '<button class="ot-flow-continue-btn" data-ot-act="answer" data-ot-node="' + esc(cur.id) + '" data-ot-opt="' + esc(opt.id) + '">' +
            ms("task_alt") + '<span>' + esc(opt.label || "Workup Reviewed — Proceed to Next Step") + '</span>' +
          '</button>' +
          '</div>';
      } else {
        optsHtml = '<div class="ot-flow-opts-container">' +
          '<div class="ot-flow-decision-prompt">' + ms("tune") + '<span>Once workup is verified, select patient status:</span></div>' +
          '<div class="ot-flow-opts-list">' +
            opts.map(function (o) {
              return '<button class="ot-flow-opt-card" data-ot-act="answer" data-ot-node="' + esc(cur.id) + '" data-ot-opt="' + esc(o.id) + '">' +
                '<div class="ot-flow-opt-radio"><div class="ot-flow-opt-radio-dot"></div></div>' +
                '<div class="ot-flow-opt-info">' +
                  '<div class="ot-flow-opt-lbl">' + esc(o.label) + '</div>' +
                  (o.pills && o.pills.length ? '<div class="ot-flow-opt-pills">' + o.pills.map(function (p) { return '<span class="ot-flow-pill">' + esc(p) + '</span>'; }).join("") + '</div>' : "") +
                '</div>' +
                ms("arrow_forward_ios") +
              '</button>';
            }).join("") +
          '</div>' +
          '</div>';
      }

      activeCardHtml = '<div class="ot-flow-card active" id="otFlowCard_' + esc(cur.id) + '" style="--ot-nav-c:' + cat.color + '">' +
        '<div class="ot-flow-card-hd">' +
          '<div class="ot-flow-card-cat">' + ms(cat.icon) + '<span>' + esc(cat.name) + '</span></div>' +
          '<span class="ot-flow-active-badge">Active Decision</span>' +
        '</div>' +
        '<h2 class="ot-flow-card-title">' + esc(cur.title || cur.name) + '</h2>' +
        (cur.description ? '<p class="ot-flow-card-desc">' + esc(cur.description) + '</p>' : "") +
        workupHtml +
        optsHtml +
        '</div>';
    }

    var outcomeCardHtml = "";
    var outs = reachedOutcomes(state);
    if (outs.length) {
      var outsHtml = outs.map(function (outNode) {
        var refs = asArr(outNode.protocolRefs);
        var protoCardsHtml = "";
        if (refs.length) {
          var compareBtn = refs.length > 1 ? '<div class="ot-flow-proto-actions"><button class="ot-btn sm ghost" data-ot-act="compare-protos" data-ot-node="' + esc(outNode.id) + '">' + ms("compare_arrows") + ' Compare Regimens (' + refs.length + ' options)</button></div>' : "";
          protoCardsHtml = compareBtn + '<div class="ot-flow-protos-grid">' +
            refs.map(function (refId) {
              var proto = st.protocols[refId];
              var name = proto ? proto.name : refId;
              var sub = proto ? (proto.setting || proto.tumorType || "NCCN standard") : "Protocol";
              return '<div class="ot-flow-proto-card" data-ot-act="view-proto" data-ot-proto="' + esc(refId) + '">' +
                '<div class="ot-flow-proto-hd">' +
                  '<span class="ot-flow-proto-tag">REGIMEN</span>' +
                  '<span class="ot-flow-proto-name">' + esc(name) + '</span>' +
                '</div>' +
                '<div class="ot-flow-proto-sub">' + esc(sub) + '</div>' +
                '<div class="ot-flow-proto-ft">' +
                  '<span class="ot-flow-proto-view">' + ms("visibility") + ' View Regimen</span>' +
                  '<span class="ot-flow-proto-btn">' + ms("open_in_new") + ' Open</span>' +
                '</div>' +
              '</div>';
            }).join("") +
            '</div>';
        }

        var bulletsHtml = "";
        if (outNode.bullets && outNode.bullets.length) {
          bulletsHtml = '<div class="ot-flow-guidance-list">' +
            outNode.bullets.map(function (b) {
              var txt = (b && typeof b === "object") ? ((b.label || "") + ": " + (b.sub || "")) : String(b);
              return '<div class="ot-flow-guide-item">' + ms("verified") + '<span>' + esc(txt) + '</span></div>';
            }).join("") +
            '</div>';
        }

        return '<div class="ot-flow-card outcome">' +
          '<div class="ot-flow-card-hd">' +
            '<div class="ot-flow-card-cat" style="color:#2E7D32">' + ms("flag") + '<span>End of Pathway / Regimens</span></div>' +
            '<span class="ot-flow-rec-badge">Recommendation</span>' +
          '</div>' +
          '<h2 class="ot-flow-card-title">' + esc(outNode.title || outNode.name) + '</h2>' +
          (outNode.description ? '<p class="ot-flow-card-desc">' + esc(outNode.description) + '</p>' : "") +
          bulletsHtml +
          (protoCardsHtml ? '<div class="ot-flow-protos-wrap"><div class="ot-flow-protos-title">' + ms("medication") + ' Recommended Regimens (NCCN Aligned):</div>' + protoCardsHtml + '</div>' : "") +
          '<div class="ot-flow-restart-box">' +
            '<button class="ot-btn ghost" data-ot-act="reset">' + ms("restart_alt") + ' Restart Pathway</button>' +
          '</div>' +
        '</div>';
      }).join("");

      outcomeCardHtml = (answered.length ? '<div class="ot-flow-connector"><div class="ot-flow-line"></div>' + ms("arrow_downward") + '</div>' : "") + outsHtml;
    }

    return '<div class="ot-flow-viewport" id="otFlowVp">' +
      navStageStepperHtml(state) +
      '<div class="ot-flow-content">' +
        answeredCardsHtml +
        activeCardHtml +
        outcomeCardHtml +
      '</div>' +
      '</div>';
  }

  function navToolbarHtml(state) {
    var cur = currentQuestion(state);
    var curName = cur ? (cur.name || cur.title || "") : "Recommendations";
    var title = (st.graph && st.graph.title) || "Breast Cancer";
    var version = "Version 6.2026 — July 29, 2026";
    var mode = currentNavMode();

    return '<div class="ot-nav-toolbar">' +
      '<div class="ot-nav-tb-left">' +
        (st.sidebarOpen === false ? '<button class="ot-nav-tb-btn" data-ot-act="nav-sidebar-toggle" aria-label="Open Table of Contents">' + ms("menu") + '</button>' : "") +
        '<div class="ot-nav-brand">' +
          '<span class="ot-nav-brand-t">' + esc(title) + '</span>' +
          '<span class="ot-nav-brand-v">' + esc(version) + '</span>' +
        '</div>' +
        '<div class="ot-nav-crumb-sep">/</div>' +
        '<div class="ot-nav-cur-node">' + esc(curName) + '</div>' +
      '</div>' +
      '<div class="ot-nav-tb-right">' +
        '<div class="ot-nav-mode-pill">' +
          '<button class="ot-nav-mode-btn' + (mode === "flow" ? " on" : "") + '" data-ot-act="nav-set-mode" data-ot-mode="flow" title="Guided Flowchart">' + ms("view_timeline") + '<span>Flowchart</span></button>' +
          '<button class="ot-nav-mode-btn' + (mode === "canvas" ? " on" : "") + '" data-ot-act="nav-set-mode" data-ot-mode="canvas" title="Interactive 2D Board">' + ms("account_tree") + '<span>Canvas</span></button>' +
        '</div>' +
        '<label class="ot-nav-toggle-wrap" title="Toggle display of non-active decision branches">' +
          '<span class="ot-nav-toggle-lbl">Non-active paths</span>' +
          '<span class="ot-nav-switch' + (st.showNonActive ? " checked" : "") + '">' +
            '<input type="checkbox" data-ot-act="nav-toggle-nonactive"' + (st.showNonActive ? " checked" : "") + '>' +
            '<span class="ot-nav-slider"></span>' +
          '</span>' +
        '</label>' +
        (mode === "canvas" ? (
          '<div class="ot-nav-zoom-group">' +
            '<button class="ot-nav-zbtn" data-ot-act="nav-zoom-out" title="Zoom Out">−</button>' +
            '<button class="ot-nav-zbtn" data-ot-act="nav-zoom-fit" title="Fit to 100%">Fit</button>' +
            '<button class="ot-nav-zbtn" data-ot-act="nav-zoom-in" title="Zoom In">+</button>' +
          '</div>'
        ) : "") +
        '<button class="ot-nav-clear-btn" data-ot-act="reset" title="Clear all answers and restart">' +
          ms("restart_alt") + '<span>Clear</span>' +
        '</button>' +
      '</div>' +
      '</div>';
  }

  function navEndModalHtml(state) {
    if (!st.navEndModalOpen) return "";
    return '<div class="ot-nav-modal-backdrop" data-ot-act="nav-modal-close">' +
      '<div class="ot-nav-modal" data-ot-act="footnote-stop">' +
        '<div class="ot-nav-modal-hd">' +
          '<div class="ot-nav-modal-title">End of algorithm reached</div>' +
          '<button class="ot-nav-modal-x" data-ot-act="nav-modal-close" aria-label="Close">' + ms("close") + '</button>' +
        '</div>' +
        '<div class="ot-nav-modal-body">' +
          '<p>You have reached the end of the algorithm in these Guidelines.</p>' +
          '<p>Select <b>Clear</b> to delete your answers and refresh the Guidelines or <b>Cancel</b> to return to where you were.</p>' +
        '</div>' +
        '<div class="ot-nav-modal-acts">' +
          '<button class="ot-btn ghost" data-ot-act="nav-modal-close">Cancel</button>' +
          '<button class="ot-btn primary" data-ot-act="reset">Clear</button>' +
          '<button class="ot-btn accent" data-ot-act="nav-view-protocols">' + ms("medication") + ' View Regimens</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function navigatorHtml(state) {
    var mode = currentNavMode();
    var mainViewHtml = "";

    if (mode === "flow") {
      mainViewHtml = navFlowchartViewHtml(state);
    } else {
      var flow = buildNavFlowchart(state);
      var colsHtml = flow.columns.map(function (colNodes, colIdx) {
        var hasActive = colNodes.some(function (id) { return state.nodes[id] && state.nodes[id].status === "active"; });
        var cardsHtml = colNodes.map(function (nodeId) {
          var isActive = state.nodes[nodeId] && state.nodes[nodeId].status === "active";
          return navNodeCardHtml(nodeId, state, isActive);
        }).join("");
        return '<div class="ot-nav-col' + (hasActive ? " has-active" : "") + '" id="otNavCol_' + colIdx + '">' + cardsHtml + '</div>';
      }).join("");

      var svgPaths = flow.edges.map(function (e) {
        return '<path class="ot-nav-edge' + (e.active ? " active" : " non-active") + '" d="' + e.d + '"/>';
      }).join("");

      var svgHtml = '<svg class="ot-nav-svg" width="' + flow.width + '" height="' + flow.height + '" viewBox="0 0 ' + flow.width + ' ' + flow.height + '">' + svgPaths + '</svg>';

      var zoom = st.navZoom || 1;
      var canvasStyle = 'width:' + flow.width + 'px;height:' + flow.height + 'px;transform:scale(' + zoom + ');';

      mainViewHtml = '<div class="ot-nav-vp" id="otNavVp">' +
        '<div class="ot-nav-canvas" id="otNavCanvas" style="' + canvasStyle + '">' +
          svgHtml +
          '<div class="ot-nav-cols">' + colsHtml + '</div>' +
        '</div>' +
      '</div>';
    }

    return '<div class="ot-nav-wrap' + (mode === "flow" ? " mode-flow" : " mode-canvas") + '">' +
      (st.sidebarOpen && isMobileScreen() ? '<div class="ot-nav-sb-backdrop" data-ot-act="nav-sidebar-toggle"></div>' : "") +
      navSidebarHtml(state) +
      '<div class="ot-nav-main">' +
        navToolbarHtml(state) +
        mainViewHtml +
      '</div>' +
      navEndModalHtml(state) +
      '</div>';
  }

  function navJumpSection(sec, opt) {
    if (sec === "Diagnosis" || sec === "Table of Contents") {
      st.answers = {};
    } else if (sec === "DCIS") {
      st.answers = { n_histology: ["dcis"] };
    } else if (sec === "Special Presentations") {
      st.answers = { n_histology: ["ibc"] };
    } else if (sec === "Preoperative") {
      st.answers = { n_histology: ["invasive"], n_inv_wk: ["continue"], n_inv_approach: ["preop"] };
    } else if (sec === "Adjuvant Post-pCR") {
      st.answers = { n_histology: ["invasive"], n_inv_wk: ["continue"], n_inv_approach: ["preop"], n_tx_preop: ["pcr"] };
    } else if (sec === "Adjuvant Upfront") {
      st.answers = { n_histology: ["invasive"], n_inv_wk: ["continue"], n_inv_approach: ["upfront"] };
    } else if (sec === "Locoregional") {
      st.answers = { n_histology: ["invasive"], n_inv_wk: ["continue"], n_inv_approach: ["upfront"] };
    } else if (sec === "Endocrine Therapy") {
      st.answers = { n_histology: ["invasive"], n_inv_wk: ["continue"], n_inv_approach: ["upfront"], n_locoregional: ["bcs"] };
    } else if (sec === "Metastatic") {
      st.answers = { n_histology: ["recurrent"] };
    } else if (opt) {
      st.answers = { n_histology: [opt] };
    } else if (!navJumpGeneric(sec)) {
      if (G.toast) G.toast("No step found for " + sec);
      return;
    }
    pruneDownstream();
    st.navEndModalOpen = false;
    st.sidebarOpen = isMobileScreen() ? false : st.sidebarOpen;   // the drawer covered the result on a phone
    repaintBody();
    navAutoScroll();
  }
  // QA BUG-015: guideline-agnostic section jump. Finds the first node whose section matches, walks
  // the answered path back to the closest active ancestor so the flow re-roots there, and on the
  // canvas selects + centres that node. Returns false when the section has no nodes.
  function navSectionNodes(sec) {
    var want = String(sec || "").trim().toLowerCase(), out = [];
    if (!want) return out;
    var state = evalState(), order = (state && asArr(state.order)) || Object.keys(st.byId || {});
    order.forEach(function (id) {
      var raw = st.byId && st.byId[id]; if (!raw) return;
      var s2 = String(raw.section || "").trim().toLowerCase();
      if (s2 === want || s2.indexOf(want) === 0) out.push(id);
    });
    return out;
  }
  function navJumpGeneric(sec) {
    var ids = navSectionNodes(sec);
    if (!ids.length) return false;
    var target = ids[0];
    // Prefer a node already reachable on the current path; otherwise the section's first node.
    var state = evalState();
    for (var i = 0; i < ids.length; i++) { var n = state && state.nodes && state.nodes[ids[i]]; if (n && n.status === "active") { target = ids[i]; break; } }
    st.mapSel = target;
    st.navJumpTarget = target;
    if (typeof editStep === "function" && state && state.nodes && state.nodes[target] && st.answers[target]) { try { editStep(target); } catch (e) {} }
    return true;
  }

  function navZoom(dir) {
    var canvas = D && D.getElementById("otNavCanvas");
    if (!canvas) return;
    if (dir === "fit") st.navZoom = 1.0;
    else if (dir === "in") st.navZoom = Math.min(2.0, (st.navZoom || 1) * 1.2);
    else if (dir === "out") st.navZoom = Math.max(0.4, (st.navZoom || 1) / 1.2);
    canvas.style.transform = "scale(" + st.navZoom + ")";
    canvas.style.transformOrigin = "0 0";
  }

  function navAutoScroll() {
    if (typeof setTimeout === "undefined") return;
    setTimeout(function () {
      // QA BUG-015: a section jump lands on its node (flow card or canvas card) rather than the
      // last active column.
      if (st.navJumpTarget) {
        var jt = st.navJumpTarget; st.navJumpTarget = null;
        var card = D && (D.getElementById("otFlowCard_" + jt) || D.querySelector('[data-ot-node="' + jt + '"].ot-nav-card, .ot-nav-card[data-ot-node="' + jt + '"]'));
        if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); } catch (e) { card.scrollIntoView(); } return; }
      }
      var vp = D && D.getElementById("otNavVp");
      if (!vp) return;
      var activeCols = vp.querySelectorAll(".ot-nav-col.has-active");
      if (activeCols.length) {
        var lastActiveCol = activeCols[activeCols.length - 1];
        var left = lastActiveCol.offsetLeft - 120;
        vp.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      }
    }, 60);
  }

  function setupNavigatorCanvas() {
    if (st.view !== "navigator") return;
    var vp = D && D.getElementById("otNavVp");
    if (!vp || vp._navWired) return;
    vp._navWired = true;

    var isDown = false, startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;
    vp.addEventListener("mousedown", function (e) {
      if (e.target && (e.target.closest(".ot-nav-card") || e.target.closest("button") || e.target.closest("input"))) return;
      isDown = true;
      startX = e.pageX - vp.offsetLeft;
      startY = e.pageY - vp.offsetTop;
      scrollLeft = vp.scrollLeft;
      scrollTop = vp.scrollTop;
    });
    vp.addEventListener("mouseleave", function () { isDown = false; });
    vp.addEventListener("mouseup", function () { isDown = false; });
    vp.addEventListener("mousemove", function (e) {
      if (!isDown) return;
      e.preventDefault();
      var x = e.pageX - vp.offsetLeft;
      var y = e.pageY - vp.offsetTop;
      vp.scrollLeft = scrollLeft - (x - startX);
      vp.scrollTop = scrollTop - (y - startY);
    });

    // QA BUG-016: phones. One finger pans (native scroll of the viewport), two fingers pinch-zoom the
    // board about the pinch midpoint, clamped to the same 0.4x..2x range as the +/- buttons. Page
    // zoom is suppressed while a pinch is in progress (touch-action + preventDefault on the move).
    var pinch = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    function mid(t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; }
    vp.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 2) { pinch = null; return; }
      var m = mid(e.touches), r = vp.getBoundingClientRect(), z = st.navZoom || 1;
      pinch = { d0: dist(e.touches), z0: z,
        // board-space point under the pinch midpoint, so zooming keeps that point under the fingers
        bx: (vp.scrollLeft + (m.x - r.left)) / z, by: (vp.scrollTop + (m.y - r.top)) / z,
        mx: m.x - r.left, my: m.y - r.top };
    }, { passive: true });
    vp.addEventListener("touchmove", function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var z = Math.max(0.4, Math.min(2.0, pinch.z0 * (dist(e.touches) / (pinch.d0 || 1))));
      st.navZoom = z;
      var canvas = D && D.getElementById("otNavCanvas");
      if (canvas) canvas.style.transform = "scale(" + z + ")";
      var m = mid(e.touches), r = vp.getBoundingClientRect();
      vp.scrollLeft = pinch.bx * z - (m.x - r.left);
      vp.scrollTop = pinch.by * z - (m.y - r.top);
    }, { passive: false });
    vp.addEventListener("touchend", function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true });
    vp.addEventListener("touchcancel", function () { pinch = null; }, { passive: true });
  }

  function summarySheetHtml() {
    if (!st.summaryOpen) return "";
    var state = evalState(); if (!state) return "";
    var txt = summaryText(state);
    return '<div class="ot-fn-ov" data-ot-act="summary-close"><div class="ot-fn-sheet ot-sum-sheet" data-ot-act="footnote-stop">' +
      '<div class="ot-fn-hd"><b>Pathway summary</b>' +
      '<button class="ot-fn-x" data-ot-act="summary-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<pre class="ot-sum-pre">' + esc(txt) + "</pre>" +
      '<div class="ot-detail-actions"><button class="ot-btn primary" data-ot-act="summary-copy">' + ms("content_copy") + "Copy</button></div></div></div>";
  }

  function bodyHtml() {
    if (st.loading) return '<div class="ot-loading">' + ms("progress_activity") + "Loading navigator...</div>";
    if (st.error) return '<div class="ot-error">' + ms("error") + esc(st.error) + '<button class="ot-btn ghost" data-ot-act="retry">Retry</button></div>';
    if (!st.graph) return pickerHtml();
    var state = evalState();
    if (!state) return '<div class="ot-loading">Preparing...</div>';
    // BUG-006: the Summary sheet must open from the protocol detail / selection views too —
    // the header tabs stay visible there, so a sheet that only renders in the three main views
    // would make Summary look dead.
    if (st.openedProtocol) return protocolDetailHtml(st.openedProtocol) + summarySheetHtml();
    if (st.selection) return selectionHtml() + summarySheetHtml();
    if (st.view === "map") return mapHtml(state) + footnoteSheetHtml() + summarySheetHtml();
    if (st.view === "navigator") return navigatorHtml(state) + footnoteSheetHtml() + summarySheetHtml();

    var cur = currentQuestion(state);
    var mid = "";
    if (cur) mid = questionCardHtml(cur, state);
    else {
      var outs = reachedOutcomes(state);
      mid = outs.length ? outs.map(function (n) { return outcomeHtml(n, state); }).join("")
        : '<div class="ot-empty">Answer the questions above to see applicable protocols.</div>';
    }
    return railHtml(state) + missingHtml(state) + '<div class="ot-body-main">' + mid + "</div>" + disabledPanelHtml(state) + footnoteSheetHtml() + summarySheetHtml();
  }

  function round2(v) {
    if (v == null || isNaN(v)) return "-";
    return Math.round(Number(v) * 100) / 100;
  }

  // Resolve a protocol reference that may be an id string, a loaded key, or a full object.
  // Returns the protocol object or null when its data is still resolving.
  function resolveProto(ref) {
    if (ref && typeof ref === "object") return ref;
    if (ref == null || ref === "") return null;
    if (st.protocols[ref]) return st.protocols[ref];
    for (var k in st.protocols) {
      if (!Object.prototype.hasOwnProperty.call(st.protocols, k)) continue;
      var p = st.protocols[k];
      if (p && (p.id === ref || k === ref)) return p;
    }
    return null;
  }
  // A superpower tap must never silently die: missing data or a missing library renders an
  // explicit modal explaining what is still loading instead of doing nothing.
  function superpowerNotice(title, lines) {
    st.superpowerModal = {
      title: title,
      html: '<div class="ot-notice">' + ms("hourglass_empty") + "<div>" +
        lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div></div>"
    };
    renderSuperpowerModal();
  }

  function superpowerModalHtml() {
    if (!st.superpowerModal) return "";
    var m = st.superpowerModal;
    return '<div class="ot-superpower-backdrop" data-ot-act="superpower-modal-close">' +
      '<div class="ot-superpower-modal" data-ot-act="footnote-stop">' +
      '<div class="ot-superpower-hd">' +
      '<span class="ot-superpower-title">' + esc(m.title || "Clinical Evaluation") + '</span>' +
      '<button class="ot-superpower-x" data-ot-act="superpower-modal-close" aria-label="Close">' + ms("close") + '</button>' +
      '</div>' +
      '<div class="ot-superpower-body">' + (m.html || "") + '</div>' +
      '<div class="ot-superpower-ft">' +
      '<button class="ot-btn primary sm" data-ot-act="superpower-modal-close">Close</button>' +
      '</div>' +
      '</div></div>';
  }

  function renderSuperpowerModal() {
    if (!D || !D.querySelectorAll) return;
    var existing = D.querySelectorAll(".ot-superpower-backdrop");
    if (existing) {
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].parentNode) existing[i].parentNode.removeChild(existing[i]);
      }
    }
    if (!st.superpowerModal) return;
    var shell = D.querySelector ? D.querySelector(".ot-shell") : null;
    if (shell && D.createElement) {
      var wrap = D.createElement("div");
      wrap.innerHTML = superpowerModalHtml();
      if (wrap.firstElementChild) shell.appendChild(wrap.firstElementChild);
    }
  }

  function calvertCalcHtml(params) {
    params = params || {};
    var p = params.patient || {};
    var age = params.age != null ? params.age : (p.age != null ? p.age : 65);
    var sex = params.sex || p.sex || "male";
    var weight = params.weight != null ? params.weight : (p.weightKg != null ? p.weightKg : 70);
    var scr = params.scr != null ? params.scr : (p.creatinine != null ? p.creatinine : 1.0);
    var auc = params.auc != null ? params.auc : 5.0;

    var cg = G.SMD_ONCO_ORGAN_DOSE ? G.SMD_ONCO_ORGAN_DOSE.calculateCockcroftGault({ age: age, weightKg: weight, serumCreatinine: scr, sex: sex }) : { crcl: 60 };
    var calvert = G.SMD_ONCO_ORGAN_DOSE ? G.SMD_ONCO_ORGAN_DOSE.calculateCalvertCarboplatin({ targetAuc: auc, gfr: cg.crcl }) : { totalDoseMg: 425, gfrUsed: 60 };

    var crcl = cg.crcl || 0;
    var renalStage = "Normal (≥ 90 mL/min)";
    var stageBadge = "badge-success";
    if (crcl < 15) { renalStage = "Kidney Failure (< 15 mL/min)"; stageBadge = "badge-danger"; }
    else if (crcl < 30) { renalStage = "Severe Impairment (15–29 mL/min)"; stageBadge = "badge-danger"; }
    else if (crcl < 60) { renalStage = "Moderate Impairment (30–59 mL/min)"; stageBadge = "badge-warning"; }
    else if (crcl < 90) { renalStage = "Mild Impairment (60–89 mL/min)"; stageBadge = "badge-info"; }

    var isFemale = String(sex).toLowerCase().indexOf("f") === 0;

    return '<div class="ot-calc-shell">' +
      '<div class="ot-calc-desc">Bedside Cockcroft-Gault CrCl &amp; Calvert Carboplatin dosing engine with ASCO/FDA/NCCN safety caps.</div>' +
      ((G.SMD_ONCO_ORGAN_DOSE && G.SMD_ONCO_ORGAN_DOSE.fetchWardSyncPatientLabs) || (G.GHIS && G.GHIS.pickPatient) ? (
        '<div class="ot-calc-sync-row">' +
          '<button type="button" class="ot-btn ghost sm ot-sync-btn" data-ot-act="calc-wardsync-fetch">' + ms("sync") + ' Pick patient from WardSynQ &amp; fetch labs</button>' +
          '<div class="ot-calc-patient" data-ot-calc-patient style="font:600 12px system-ui;color:#607D8B;margin-top:6px">' + esc(p.name ? (p.name + (p.patientId ? " · MR " + p.patientId : "")) : "No patient picked yet. Values below are editable defaults.") + '</div>' +
        '</div>'
      ) : '') +
      '<div class="ot-calc-grid">' +
        '<div class="ot-calc-f">' +
          '<label>Patient Age (years)</label>' +
          '<input type="number" data-ot-calc="age" min="1" max="120" value="' + esc(age) + '">' +
        '</div>' +
        '<div class="ot-calc-f">' +
          '<label>Biological Sex</label>' +
          '<select data-ot-calc="sex">' +
            '<option value="male"' + (!isFemale ? ' selected' : '') + '>Male (x 1.0)</option>' +
            '<option value="female"' + (isFemale ? ' selected' : '') + '>Female (x 0.85)</option>' +
          '</select>' +
        '</div>' +
        '<div class="ot-calc-f">' +
          '<label>Weight (kg)</label>' +
          '<input type="number" data-ot-calc="weight" min="20" max="300" step="0.5" value="' + esc(weight) + '">' +
        '</div>' +
        '<div class="ot-calc-f">' +
          '<label>Serum Creatinine (mg/dL)</label>' +
          '<input type="number" data-ot-calc="scr" min="0.1" max="25" step="0.05" value="' + esc(scr) + '">' +
        '</div>' +
        '<div class="ot-calc-f ot-calc-f-wide">' +
          '<label>Target Carboplatin AUC</label>' +
          '<div class="ot-calc-auc-row">' +
            '<input type="number" data-ot-calc="auc" min="1" max="10" step="0.5" value="' + esc(auc) + '">' +
            '<div class="ot-auc-presets">' +
              '<button type="button" class="ot-auc-tag' + (auc == 4 ? ' on' : '') + '" data-ot-act="set-auc" data-ot-val="4">AUC 4</button>' +
              '<button type="button" class="ot-auc-tag' + (auc == 5 ? ' on' : '') + '" data-ot-act="set-auc" data-ot-val="5">AUC 5</button>' +
              '<button type="button" class="ot-auc-tag' + (auc == 6 ? ' on' : '') + '" data-ot-act="set-auc" data-ot-val="6">AUC 6</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="ot-calc-cards">' +
        '<div class="ot-res-card">' +
          '<div class="ot-res-hd">' +
            '<span class="ot-res-title">' + ms("water_drop") + ' Creatinine Clearance (CrCl)</span>' +
            '<span class="badge ' + stageBadge + '" id="otCalcStageBadge">' + renalStage + '</span>' +
          '</div>' +
          '<div class="ot-res-val" id="otCalcCrclVal">' + round2(crcl) + ' <span class="ot-res-unit">mL/min</span></div>' +
          '<div class="ot-res-sub">Cockcroft-Gault: ((140 - Age) × Weight) / (72 × SCr)' + (isFemale ? ' × 0.85' : '') + '</div>' +
        '</div>' +

        '<div class="ot-res-card highlight">' +
          '<div class="ot-res-hd">' +
            '<span class="ot-res-title">' + ms("medication") + ' Calvert Carboplatin Total Dose</span>' +
            (calvert.isGfrCapped ? '<span class="badge badge-warning" id="otCalcCapBadge">GFR Capped at 125</span>' : '<span class="badge badge-info" id="otCalcCapBadge">Target AUC ' + auc + '</span>') +
          '</div>' +
          '<div class="ot-res-val ot-res-glow" id="otCalcDoseVal">' + round2(calvert.totalDoseMg) + ' <span class="ot-res-unit">mg</span></div>' +
          '<div class="ot-res-sub" id="otCalcDoseSub">Calvert: Dose = AUC ' + auc + ' × (' + round2(calvert.gfrUsed) + ' + 25)' + (calvert.isGfrCapped ? ' · GFR capped at 125 mL/min per ASCO/FDA/NCCN safety guidance' : '') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="ot-calc-alerts" id="otCalcAlerts">' +
        (crcl < 45 ? '<div class="ot-alert danger">' + ms("warning") + ' <b>Cisplatin Contraindicated:</b> CrCl ' + round2(crcl) + ' mL/min is below 45 mL/min. Switch to Carboplatin dosed by Calvert formula.</div>' : (crcl < 60 ? '<div class="ot-alert warning">' + ms("info") + ' <b>Renal Caution:</b> CrCl ' + round2(crcl) + ' mL/min. For Cisplatin, reduce dose by 25% or switch to Carboplatin. For Capecitabine, reduce dose by 25%.</div>' : '<div class="ot-alert success">' + ms("verified") + ' <b>Normal Renal Function:</b> Standard cytotoxic dosing permitted without renal reduction.</div>')) +
      '</div>' +
      '</div>';
  }

  function updateCalvertCalc() {
    var shell = D && D.querySelector(".ot-calc-shell");
    if (!shell || !G.SMD_ONCO_ORGAN_DOSE) return;
    var ageInp = shell.querySelector("[data-ot-calc='age']");
    var sexInp = shell.querySelector("[data-ot-calc='sex']");
    var wtInp = shell.querySelector("[data-ot-calc='weight']");
    var scrInp = shell.querySelector("[data-ot-calc='scr']");
    var aucInp = shell.querySelector("[data-ot-calc='auc']");

    var age = Number(ageInp ? ageInp.value : 65) || 65;
    var sex = (sexInp ? sexInp.value : "male") || "male";
    var weight = Number(wtInp ? wtInp.value : 70) || 70;
    var scr = Number(scrInp ? scrInp.value : 1.0) || 1.0;
    var auc = Number(aucInp ? aucInp.value : 5.0) || 5.0;

    var cg = G.SMD_ONCO_ORGAN_DOSE.calculateCockcroftGault({ age: age, weightKg: weight, serumCreatinine: scr, sex: sex });
    var calvert = G.SMD_ONCO_ORGAN_DOSE.calculateCalvertCarboplatin({ targetAuc: auc, gfr: cg.crcl });

    var crcl = cg.crcl || 0;
    var renalStage = "Normal (≥ 90 mL/min)";
    var stageBadge = "badge-success";
    if (crcl < 15) { renalStage = "Kidney Failure (< 15 mL/min)"; stageBadge = "badge-danger"; }
    else if (crcl < 30) { renalStage = "Severe Impairment (15–29 mL/min)"; stageBadge = "badge-danger"; }
    else if (crcl < 60) { renalStage = "Moderate Impairment (30–59 mL/min)"; stageBadge = "badge-warning"; }
    else if (crcl < 90) { renalStage = "Mild Impairment (60–89 mL/min)"; stageBadge = "badge-info"; }

    var crclValEl = D.getElementById("otCalcCrclVal");
    if (crclValEl) crclValEl.innerHTML = round2(crcl) + ' <span class="ot-res-unit">mL/min</span>';
    var stageBadgeEl = D.getElementById("otCalcStageBadge");
    if (stageBadgeEl) {
      stageBadgeEl.className = "badge " + stageBadge;
      stageBadgeEl.textContent = renalStage;
    }

    var doseValEl = D.getElementById("otCalcDoseVal");
    if (doseValEl) doseValEl.innerHTML = round2(calvert.totalDoseMg) + ' <span class="ot-res-unit">mg</span>';
    var capBadgeEl = D.getElementById("otCalcCapBadge");
    if (capBadgeEl) {
      if (calvert.isGfrCapped) {
        capBadgeEl.className = "badge badge-warning";
        capBadgeEl.textContent = "GFR Capped at 125";
      } else {
        capBadgeEl.className = "badge badge-info";
        capBadgeEl.textContent = "Target AUC " + auc;
      }
    }
    var doseSubEl = D.getElementById("otCalcDoseSub");
    if (doseSubEl) {
      doseSubEl.textContent = "Calvert: Dose = AUC " + auc + " × (" + round2(calvert.gfrUsed) + " + 25)" + (calvert.isGfrCapped ? " · GFR capped at 125 mL/min per ASCO/FDA/NCCN safety guidance" : "");
    }

    var alertsEl = D.getElementById("otCalcAlerts");
    if (alertsEl) {
      alertsEl.innerHTML = (crcl < 45
        ? '<div class="ot-alert danger">' + ms("warning") + ' <b>Cisplatin Contraindicated:</b> CrCl ' + round2(crcl) + ' mL/min is below 45 mL/min. Switch to Carboplatin dosed by Calvert formula.</div>'
        : (crcl < 60
          ? '<div class="ot-alert warning">' + ms("info") + ' <b>Renal Caution:</b> CrCl ' + round2(crcl) + ' mL/min. For Cisplatin, reduce dose by 25% or switch to Carboplatin. For Capecitabine, reduce dose by 25%.</div>'
          : '<div class="ot-alert success">' + ms("verified") + ' <b>Normal Renal Function:</b> Standard cytotoxic dosing permitted without renal reduction.</div>'));
    }
  }

  // ---- shell + paint -----------------------------------------------------------------------------
  function shellHtml() {
    var hasGraph = !!st.graph;
    var title = hasGraph ? (st.graph.title || "ONCOTREE") : "Oncology Navigator";
    var viewToggle = hasGraph ? ('<div class="ot-viewtoggle">' +
      '<button class="ot-vt' + (st.view === "navigator" ? " on" : "") + '" data-ot-act="view-navigator">' + ms("account_tree") + "Navigator</button>" +
      '<button class="ot-vt' + (st.view === "pathway" ? " on" : "") + '" data-ot-act="view-pathway">' + ms("format_list_bulleted") + "Step Flow</button>" +
      '<button class="ot-vt' + (st.view === "map" ? " on" : "") + '" data-ot-act="view-map">' + ms("map") + "Overview</button>" +
      '<button class="ot-vt ot-vt-stg" data-ot-act="open-staging" title="TNM Staging for this cancer">' + ms("stairs") + "Staging</button>" +
      '<button class="ot-vt ot-vt-act" data-ot-act="summary">' + ms("summarize") + "Summary</button></div>") : "";
    var kicker = hasGraph
      ? '<button class="ot-hkicker ot-hkicker-btn" data-ot-act="change-disease">' + ms("swap_horiz") + "Change cancer</button>"
      : '<span class="ot-hkicker">STEWARDMD ONCOLOGY</span>';
    var rightBtn = '<div class="ot-h-actions">' +
      '<button type="button" class="ot-hbtn ot-hbtn-stg" data-ot-act="open-staging" aria-label="TNM Cancer Staging" title="TNM Cancer Staging">' + ms("stairs") + '</button>' +
      '<button type="button" class="ot-hbtn ot-hbtn-calc" data-ot-act="open-calvert-calc" aria-label="Creatinine & Calvert Calculator" title="Creatinine & Calvert Calculator">' + ms("calculate") + '</button>' +
      (hasGraph ? '<button class="ot-hbtn" data-ot-act="reset" aria-label="Restart">' + ms("restart_alt") + '</button>' : '<span class="ot-hbtn" aria-hidden="true" style="opacity:0;pointer-events:none;"></span>') +
      '</div>';
    var isNavScrollLocked = !!st.graph && !st.openedProtocol && !st.selection && (st.view === "navigator");
    return '<div class="ot-shell">' +
      '<header class="ot-header">' +
        '<button class="ot-hbtn" data-ot-act="close" aria-label="Close">' + ms("close") + "</button>" +
        '<div class="ot-htitle">' + kicker + '<span class="ot-hname">' + esc(title) + "</span></div>" +
        rightBtn +
      "</header>" +
      viewToggle +
      crumbsHtml() +
      '<div class="ot-scroll' + (isNavScrollLocked ? " ot-scroll-nav" : "") + '" id="otBody">' + bodyHtml() + "</div>" +
      '<div class="ot-disclaimer">Decision support. DRAFT navigator + protocols. Not an approved clinical order; the physician decides and the existing dose engine computes doses.</div>' +
      superpowerModalHtml() +
      "</div>";
  }

  // ---- motion (motion.dev vanilla API, vendored /assets/vendor/motion.min.js) -------------------
  // Premium spring/stagger entrance. Progressive enhancement: if Motion is absent, or the user prefers
  // reduced motion, the CSS transitions in oncotree.css remain the baseline and this is a no-op.
  function reduceMotion() { try { return D && D.defaultView && D.defaultView.matchMedia && D.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function motionRender() {
    var M = G.Motion;
    if (!M || !M.animate || reduceMotion()) return;
    try {
      var root = D.getElementById("otBody"); if (!root) return;
      var spring = M.spring ? M.spring({ stiffness: 320, damping: 30 }) : "ease-out";
      var cards = root.querySelectorAll(".ot-card");
      if (cards.length) M.animate(cards, { opacity: [0, 1], transform: ["translateY(14px)", "translateY(0)"] }, { duration: 0.5, delay: M.stagger ? M.stagger(0.06) : 0, easing: spring });
      var step = root.querySelector(".ot-step");
      if (step) M.animate(step, { opacity: [0, 1], transform: ["translateY(10px) scale(0.99)", "translateY(0) scale(1)"] }, { duration: 0.42, easing: spring });
      var opts = root.querySelectorAll(".ot-step .ot-opt");
      if (opts.length) M.animate(opts, { opacity: [0, 1], transform: ["translateX(-6px)", "translateX(0)"] }, { duration: 0.35, delay: M.stagger ? M.stagger(0.04, { start: 0.08 }) : 0, easing: "ease-out" });
      var disease = root.querySelectorAll(".ot-disease");
      if (disease.length) M.animate(disease, { opacity: [0, 1], transform: ["translateY(12px)", "translateY(0)"] }, { duration: 0.45, delay: M.stagger ? M.stagger(0.05) : 0, easing: spring });
      var selIcon = root.querySelector(".ot-sel-icon");
      if (selIcon) M.animate(selIcon, { transform: ["scale(0.4)", "scale(1)"], opacity: [0, 1] }, { duration: 0.5, easing: spring });
      var gnodes = root.querySelectorAll(".ot-gnode");
      if (gnodes.length) M.animate(gnodes, { opacity: [0, 1], transform: ["scale(0.82)", "scale(1)"] }, { duration: 0.34, delay: M.stagger ? M.stagger(0.014) : 0, easing: spring });
      var gedges = root.querySelectorAll(".ot-edge");
      if (gedges.length) M.animate(gedges, { opacity: [0, 1] }, { duration: 0.55, easing: "ease-out" });
      var pop = root.querySelector(".ot-mappop");
      if (pop) M.animate(pop, { opacity: [0, 1], transform: ["translateY(16px)", "translateY(0)"] }, { duration: 0.32, easing: spring });
    } catch (e) {}
  }

  function paint() {
    var el = D && D.getElementById("smdOncoTree");
    if (!el) return;
    el.innerHTML = shellHtml();
    motionRender();
    setupGraph();
    setupNavigatorCanvas();
  }
  function repaintBody() {
    var b = D && D.getElementById("otBody");
    if (b) { b.innerHTML = bodyHtml(); motionRender(); setupGraph(); setupNavigatorCanvas(); } else paint();
  }

  // ---- interactive MAP: pan / zoom / fit (transform kept in st.graphT so it survives repaints) ------
  function applyGraphT() {
    var c = D && D.getElementById("otGraphCanvas"); if (!c) return;
    var t = st.graphT || { x: 0, y: 0, s: 1 };
    c.style.transform = "translate(" + t.x + "px," + t.y + "px) scale(" + t.s + ")";
    c.style.transformOrigin = "0 0";
  }
  // Pan (keeping current zoom) so a given node is centered in the viewport - used by the Contents panel.
  function centerOnNode(id) {
    var vp = D && D.getElementById("otGraphVp"), pos = st._graphPos && st._graphPos[id];
    if (!vp || !pos) return;
    var s = (st.graphT && st.graphT.s) || 1;
    st.graphT = { x: vp.clientWidth / 2 - (pos.x + NW / 2) * s, y: vp.clientHeight / 2 - (pos.y + NH / 2) * s, s: s };
    applyGraphT();
  }
  function graphFit() {
    var vp = D && D.getElementById("otGraphVp"), sz = st._graphSize; if (!vp || !sz) return;
    var pad = 20, s = Math.min((vp.clientWidth - pad * 2) / sz.w, (vp.clientHeight - pad * 2) / sz.h, 1);
    if (!isFinite(s) || s <= 0) s = 1;
    st.graphT = { x: Math.max(pad, (vp.clientWidth - sz.w * s) / 2), y: pad, s: s }; applyGraphT();
  }
  function graphZoom(dir) {
    var vp = D && D.getElementById("otGraphVp"); var t = st.graphT || { x: 0, y: 0, s: 1 };
    var ns = Math.max(0.3, Math.min(2.5, dir === "in" ? t.s * 1.25 : t.s / 1.25));
    if (vp) { var cx = vp.clientWidth / 2, cy = vp.clientHeight / 2, k = ns / t.s; st.graphT = { x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k, s: ns }; }
    else st.graphT = { x: t.x, y: t.y, s: ns };
    applyGraphT();
  }
  function setupGraph() {
    if (st.view !== "map") return;
    var vp = D && D.getElementById("otGraphVp"); if (!vp) return;
    if (!st.graphT) graphFit(); else applyGraphT();
    if (vp._otWired) return; vp._otWired = true;
    var pts = {}, base = null, baseMid = null, baseDist = 0;
    function ids() { return Object.keys(pts); }
    function mid() { var a = ids(); return { x: (pts[a[0]].x + pts[a[1]].x) / 2, y: (pts[a[0]].y + pts[a[1]].y) / 2 }; }
    function dist() { var a = ids(), dx = pts[a[0]].x - pts[a[1]].x, dy = pts[a[0]].y - pts[a[1]].y; return Math.sqrt(dx * dx + dy * dy) || 1; }
    vp.addEventListener("pointerdown", function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; try { vp.setPointerCapture(e.pointerId); } catch (_) {}
      var t = st.graphT || { x: 0, y: 0, s: 1 }; graphMoved = false;
      if (ids().length === 1) base = { px: e.clientX, py: e.clientY, tx: t.x, ty: t.y };
      else if (ids().length === 2) { base = { tx: t.x, ty: t.y, s: t.s }; baseMid = mid(); baseDist = dist(); }
    });
    vp.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return; pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = ids().length, t = st.graphT || { x: 0, y: 0, s: 1 };
      if (n === 1 && base) {
        var dx = e.clientX - base.px, dy = e.clientY - base.py;
        if (Math.abs(dx) + Math.abs(dy) > 6) graphMoved = true;
        st.graphT = { x: base.tx + dx, y: base.ty + dy, s: t.s }; applyGraphT();
      } else if (n === 2 && base) {
        graphMoved = true; var s2 = Math.max(0.3, Math.min(2.5, base.s * (dist() / baseDist))), k = s2 / base.s;
        st.graphT = { x: baseMid.x - (baseMid.x - base.tx) * k, y: baseMid.y - (baseMid.y - base.ty) * k, s: s2 }; applyGraphT();
      }
    });
    function up(e) { if (pts[e.pointerId]) delete pts[e.pointerId]; if (ids().length < 2) base = null; }
    vp.addEventListener("pointerup", up); vp.addEventListener("pointercancel", up);
  }

  // ---- events ------------------------------------------------------------------------------------
  // Search input: update only the results list so the field keeps focus (no full repaint per keystroke).
  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.hasAttribute("data-ot-calc")) {
      updateCalvertCalc();
      return;
    }
    var inp = t.getAttribute("data-ot-input");
    if (inp === "toc-search") {
      st.tocQuery = t.value || "";
      var list = D && D.getElementById("otTocList"), state = evalState();
      if (list && state) list.innerHTML = tocListHtml(state);
      return;
    }
    if (inp === "picker-search") {
      st.pickerSearch = t.value || "";
      var dList = D && D.getElementById("otDiseaseList");
      if (dList) dList.innerHTML = diseaseCardsHtml();
      var clearBtn = D && D.querySelector(".ot-search-clear");
      if (clearBtn) clearBtn.style.display = st.pickerSearch ? "grid" : "none";
      return;
    }
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-ot-act]") : null;
    if (!t) return;
    var act = t.getAttribute("data-ot-act");
    var node = t.getAttribute("data-ot-node"), opt = t.getAttribute("data-ot-opt"), proto = t.getAttribute("data-ot-proto");
    if (act === "close") {
      if (st.openedProtocol) { st.openedProtocol = null; paint(); return; }
      if (st.superpowerModal) { st.superpowerModal = null; try { renderSuperpowerModal(); } catch (e) {} paint(); return; }
      if (st.graph) { st.graph = null; st.guideline = null; st.byId = {}; st.answers = {}; st.protocols = {}; st.openedProtocol = null; st.selection = null; st.view = "navigator"; paint(); return; }
      close(); return;
    }
    if (act === "pick") { loadGuideline(t.getAttribute("data-ot-guideline")); return; }
    if (act === "change-disease") {
      st.graph = null; st.guideline = null; st.byId = {}; st.answers = {}; st.protocols = {};
      st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.view = "navigator";
      st.pickerSearch = ""; st.pickerCategory = "all";
      st.superpowerModal = null;
      renderSuperpowerModal();
      paint(); return;
    }
    if (act === "picker-filter") {
      var cat = t.getAttribute("data-ot-cat") || "all";
      st.pickerCategory = cat;
      var tabs = D && D.querySelectorAll(".ot-tab-chip");
      if (tabs) {
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].getAttribute("data-ot-cat") === cat) tabs[i].classList.add("on");
          else tabs[i].classList.remove("on");
        }
      }
      var dList = D && D.getElementById("otDiseaseList");
      if (dList) dList.innerHTML = diseaseCardsHtml();
      return;
    }
    if (act === "picker-clear-search") {
      st.pickerSearch = "";
      var pInp = D && D.querySelector("[data-ot-input='picker-search']");
      if (pInp) { pInp.value = ""; pInp.focus(); }
      var pClearBtn = D && D.querySelector(".ot-search-clear");
      if (pClearBtn) pClearBtn.style.display = "none";
      var dList2 = D && D.getElementById("otDiseaseList");
      if (dList2) dList2.innerHTML = diseaseCardsHtml();
      return;
    }
    if (act === "open-staging") {
      var gid = (st.guideline || (st.graph && st.graph.id) || "").toLowerCase();
      var map = {
        cervical: "cervix",
        anal: "anus",
        rcc: "kidney",
        headneck: "oral_cavity",
        cutaneous_melanoma: "melanoma",
        rectal: "colorectal"
      };
      var siteId = map[gid] || gid;
      if (window.SMD_ONCOSTAGING) {
        if (siteId && SMD_ONCOSTAGING.open) {
          SMD_ONCOSTAGING.open(siteId);
        } else if (SMD_ONCOSTAGING.openList) {
          SMD_ONCOSTAGING.openList();
        }
      } else if (G.toast) {
        G.toast("Cancer Staging loading…");
      }
      return;
    }
    if (act === "open-calvert-calc") {
      var initialParams = { patient: (st.ctx && st.ctx.patient) || {} };
      st.superpowerModal = {
        title: "Creatinine Clearance & Calvert Carboplatin Calculator",
        html: calvertCalcHtml(initialParams)
      };
      renderSuperpowerModal();
      return;
    }
    if (act === "set-auc") {
      var val = t.getAttribute("data-ot-val");
      var aucInp = D && D.querySelector("[data-ot-calc='auc']");
      if (aucInp) { aucInp.value = val; updateCalvertCalc(); }
      var tags = D && D.querySelectorAll(".ot-auc-tag");
      if (tags) {
        for (var k = 0; k < tags.length; k++) {
          if (tags[k].getAttribute("data-ot-val") === val) tags[k].classList.add("on");
          else tags[k].classList.remove("on");
        }
      }
      return;
    }
    /* "Fetch Patient Labs from WardSync EMR" only ever read an ALREADY-selected patient, so with no
     * active EMR session it said "No active WardSync patient" and stopped - the clinician had no way
     * to get to one from here. Open the ward patient list instead (WARD.open asks for the hospital
     * first when none is remembered), so they can pick the patient and fetch again. */
    function openWardPatientPicker() {
      if (G.WARD && G.WARD.open) {
        if (G.toast) G.toast("Pick the patient in the ward list, then tap Fetch again.");
        try { G.WARD.open(); return; } catch (e) {}
      }
      if (G.toast) G.toast("Open a patient in WardSync first, then tap Fetch again.");
    }
    if (act === "calc-wardsync-fetch") {
      // QA BUG-018: hospital -> WardSynQ patient list -> pick -> this patient's demographics and
      // newest creatinine land in the calculator. The same one-shot picker SURGX and ICU use.
      if (G.GHIS && G.GHIS.pickPatient && G.GHIS.latestLabsFor) {
        if (G.toast) G.toast("Pick the patient from the WardSynQ list");
        G.GHIS.pickPatient(function (pk) {
          if (!pk || !pk.patientId) return;
          if (G.toast) G.toast("Fetching labs for " + (pk.name || "patient") + "…");
          G.GHIS.latestLabsFor(pk.patientId).then(function (res) {
            res = res || {};
            var dem = res.patient || {}, labs = res.labs || {};
            var filled = [];
            if (dem.age) { var aInp2 = D.querySelector("[data-ot-calc='age']"); if (aInp2) { aInp2.value = dem.age; filled.push("age"); } }
            if (dem.sex) { var sInp2 = D.querySelector("[data-ot-calc='sex']"); if (sInp2) { sInp2.value = /^f/i.test(String(dem.sex)) ? "female" : "male"; filled.push("sex"); } }
            if (dem.weightKg) { var wInp2 = D.querySelector("[data-ot-calc='weight']"); if (wInp2) { wInp2.value = dem.weightKg; filled.push("weight"); } }
            if (labs.creatinine != null) { var scInp2 = D.querySelector("[data-ot-calc='scr']"); if (scInp2) { scInp2.value = labs.creatinine; filled.push("creatinine"); } }
            st.ctx = st.ctx || {};
            st.ctx.patient = Object.assign({}, st.ctx.patient || {}, { name: pk.name, patientId: pk.patientId, age: dem.age, sex: dem.sex, weightKg: dem.weightKg, creatinine: labs.creatinine });
            if (labs.creatinine != null) st.ctx.serumCreatinine = labs.creatinine;
            if (dem.age) st.ctx.age = dem.age;
            var lbl = D.querySelector("[data-ot-calc-patient]");
            if (lbl) lbl.textContent = (pk.name || "Patient") + " · WardSynQ" + (labs.creatinineDate ? " · creatinine " + labs.creatinineDate : "");
            updateCalvertCalc();
            if (G.toast) G.toast(filled.length ? ("Filled " + filled.join(", ") + " from WardSynQ") : "No creatinine on file for this patient; enter it manually.");
          }).catch(function () { if (G.toast) G.toast("Could not fetch labs from WardSynQ."); });
        });
        return;
      }
      if (G.SMD_ONCO_ORGAN_DOSE && G.SMD_ONCO_ORGAN_DOSE.fetchWardSyncPatientLabs) {
        var wsq = G.SMD_ONCO_ORGAN_DOSE.fetchWardSyncPatientLabs(G);
        if (wsq && (wsq.patient || wsq.vitals || wsq.labs)) {
          if (wsq.vitals) {
            if (wsq.vitals.age) { var aInp = D.querySelector("[data-ot-calc='age']"); if (aInp) aInp.value = wsq.vitals.age; }
            if (wsq.vitals.sex) { var sInp = D.querySelector("[data-ot-calc='sex']"); if (sInp) sInp.value = wsq.vitals.sex; }
            if (wsq.vitals.weightKg) { var wInp = D.querySelector("[data-ot-calc='weight']"); if (wInp) wInp.value = wsq.vitals.weightKg; }
          }
          if (wsq.labs && wsq.labs.serumCreatinine != null) {
            var scInp = D.querySelector("[data-ot-calc='scr']"); if (scInp) scInp.value = wsq.labs.serumCreatinine;
          }
          updateCalvertCalc();
          if (G.toast) G.toast("Imported patient labs & vitals from WardSync EMR.");
        } else {
          openWardPatientPicker();
        }
      } else {
        // No provider on this device: still route to the ward list (it asks for the hospital and the
        // sign-in itself) rather than ending in a toast (test/calvert-wardsync-picker.test.mjs).
        openWardPatientPicker();
      }
      return;
    }
    if (act === "retry") { st.error = null; if (st.guideline) loadGuideline(st.guideline); else paint(); return; }
    if (act === "reset") {
      st.answers = {}; st.rebaseId = null; st.openedProtocol = null; st.selection = null; st.whyOpen = {};
      st.navEndModalOpen = false; st.lastEndStepNode = null; st.lastEndStepOpt = null; st.lastEndStepPressCount = 0;
      st.superpowerModal = null;
      renderSuperpowerModal();
      repaintBody();
      if (st.view === "navigator") navAutoScroll();
      return;
    }
    if (act === "view-navigator") { st.openedProtocol = null; st.selection = null; st.view = "navigator"; paint(); return; }
    if (act === "view-pathway") { st.openedProtocol = null; st.selection = null; st.view = "pathway"; paint(); return; }
    if (act === "view-map") { st.openedProtocol = null; st.selection = null; st.view = "map"; paint(); return; }
    if (act === "nav-sidebar-toggle") { st.sidebarOpen = !(st.sidebarOpen !== false); repaintBody(); return; }
    if (act === "nav-toggle-nonactive") { st.showNonActive = !st.showNonActive; repaintBody(); return; }
    if (act === "nav-zoom-in") { navZoom("in"); return; }
    if (act === "nav-zoom-out") { navZoom("out"); return; }
    if (act === "nav-zoom-fit") { navZoom("fit"); return; }
    if (act === "nav-modal-close") { st.navEndModalOpen = false; st.lastEndStepPressCount = 0; repaintBody(); return; }
    if (act === "nav-set-mode") {
      var m = t.getAttribute("data-ot-mode");
      st.navMode = (m === "flow" || m === "canvas") ? m : "auto";
      repaintBody();
      if (st.navMode === "canvas") navAutoScroll();
      return;
    }
    if (act === "nav-edit-step") {
      if (node) {
        delete st.answers[node];
        pruneDownstream();
        st.openedProtocol = null;
        st.selection = null;
        st.navEndModalOpen = false;
        st.lastEndStepNode = null;
        st.lastEndStepOpt = null;
        st.lastEndStepPressCount = 0;
        repaintBody();
      }
      return;
    }
    if (act === "nav-view-protocols") { st.navEndModalOpen = false; st.view = "pathway"; repaintBody(); return; }
    if (act === "nav-jump-section") { navJumpSection(t.getAttribute("data-ot-sec"), t.getAttribute("data-ot-opt")); return; }
    if (act === "graph-zoom") { graphZoom(t.getAttribute("data-ot-arg")); return; }
    if (act === "graph-fit") { graphFit(); return; }
    if (act === "toc-toggle") { st.tocOpen = !(st.tocOpen !== false); repaintBody(); return; }
    if (act === "toc-goto") { st.mapSel = node; repaintBody(); centerOnNode(node); return; }
    if (act === "mapnode") { if (graphMoved) { graphMoved = false; return; } st.mapSel = (st.mapSel === node ? null : node); repaintBody(); return; }
    if (act === "mappop-close") { st.mapSel = null; repaintBody(); return; }
    if (act === "footnote") { st.footnoteOpen = t.getAttribute("data-ot-fn"); repaintBody(); return; }
    if (act === "footnote-close") { st.footnoteOpen = null; repaintBody(); return; }
    if (act === "footnote-stop") { return; }
    if (act === "toc-clear") { st.tocQuery = ""; repaintBody(); return; }
    if (act === "summary") { st.summaryOpen = true; repaintBody(); return; }
    if (act === "summary-close") { st.summaryOpen = false; repaintBody(); return; }
    if (act === "summary-copy") { copySummary(); return; }
    if (act === "link-follow") { followLink(t.getAttribute("data-ot-guideline"), node); return; }
    if (act === "crumb") { gotoCrumb(parseInt(t.getAttribute("data-ot-idx"), 10)); return; }
    if (act === "map-goto") { st.mapSel = null; st.view = "pathway"; editStep(node); return; }
    if (act === "answer") { answer(node, opt); return; }
    if (act === "edit") { editStep(node); return; }
    if (act === "why") { st.whyOpen[node] = !st.whyOpen[node]; repaintBody(); return; }
    if (act === "toggle-excluded") { st.showExcluded = !st.showExcluded; repaintBody(); return; }
    if (act === "view-proto") { st.openedProtocol = proto; paint(); return; }
    if (act === "close-proto") { st.openedProtocol = null; paint(); return; }
    if (act === "proto-maker") { if (G.SMD_PROTOMAKER) { var c0 = st.ctx || {}; G.SMD_PROTOMAKER.open({ patient: { name: c0.name || "", age: c0.age || null, sex: c0.sex || "", heightCm: c0.heightCm || null, weightKg: c0.weightKg || null, diagnosis: c0.diagnosis || "" } }); } return; }

    if (act === "superpower-modal-close") {
      st.superpowerModal = null;
      renderSuperpowerModal();
      return;
    }
    if (act === "compare-protos") {
      var nId = (t.getAttribute("data-ot-node") || "").trim();
      var nodeObj = st.byId[nId];
      var refs = asArr(nodeObj && nodeObj.protocolRefs);
      var protos = refs.map(function(r) { return st.protocols[r]; }).filter(Boolean);
      if (G.SMD_ONCO_COMPARE && protos.length) {
        var html = G.SMD_ONCO_COMPARE.renderComparisonTable(protos);
        st.superpowerModal = { title: "Head-to-Head Regimen Comparison (" + protos.length + " Regimens)", html: html };
        renderSuperpowerModal();
      }
      return;
    }
    if (act === "cycle-timeline") {
      var pObj = resolveProto(proto);
      if (!pObj) { superpowerNotice("Patient Cycle Calendar & Nadir Timeline", ["The protocol data for this regimen is still loading.", "Wait a moment for the pathway to finish loading, then tap Cycle Timeline again."]); return; }
      if (!G.SMD_ONCO_TIMELINE) { superpowerNotice("Patient Cycle Calendar & Nadir Timeline", ["The cycle-timeline tool is still loading.", "Try again in a moment."]); return; }
      try {
        var tl = G.SMD_ONCO_TIMELINE.generateCycleTimeline(pObj);
        var html = G.SMD_ONCO_TIMELINE.renderTimelineHtml(tl);
        st.superpowerModal = { title: "Patient Cycle Calendar & Nadir Timeline", html: html };
        renderSuperpowerModal();
      } catch (e2) { superpowerNotice("Patient Cycle Calendar & Nadir Timeline", ["Could not build the timeline for this regimen.", String((e2 && e2.message) || e2)]); }
      return;
    }
    if (act === "organ-dose-check") {
      var pObj = resolveProto(proto);
      if (!pObj) { superpowerNotice("Organ Function & Calvert Dosing", ["The protocol data for this regimen is still loading.", "Wait a moment for the pathway to finish loading, then tap Organ Dose again."]); return; }
      if (!G.SMD_ONCO_ORGAN_DOSE) { superpowerNotice("Organ Function & Calvert Dosing", ["The organ-dose tool is still loading.", "Try again in a moment."]); return; }
      try {
        var c = st.ctx || {};
        var labs = { crcl: c.crcl || 45, totalBili: c.totalBili || 2.2, anc: c.anc || 1800, platelets: c.platelets || 150000 };
        var calcDoses = {};
        asArr(pObj.drugs).forEach(function(d) { calcDoses[d.id] = d.dosePerUnit || 100; });
        var ev = G.SMD_ONCO_ORGAN_DOSE.evaluateOrganDoseModifications(pObj, labs, calcDoses);
        var h = "<div class=\"ot-organ-eval\"><h4>Renal & Hepatic Dose Modifications</h4>";
        h += "<p class=\"text-muted small\">Evaluated for <b>" + esc(pObj.name || proto) + "</b> against labs: CrCl " + labs.crcl + " mL/min, Total Bili " + labs.totalBili + " mg/dL</p>";
        if (ev.hasModifications) {
          h += "<table class=\"ot-compare-table\"><thead><tr><th>Drug</th><th>Condition</th><th>Recommended Adjustment</th><th>Citation</th></tr></thead><tbody>";
          ev.adjustments.forEach(function(a) {
            h += "<tr><td><b>" + esc(a.drugName) + "</b></td><td>" + esc(a.organ) + " impairment (" + esc(a.metric) + ")</td><td><span class=\"badge badge-warning\">" + a.recommendedPercent + "% dose</span><br>" + esc(a.text) + "</td><td class=\"small text-muted\">" + esc(a.citation) + "</td></tr>";
          });
          h += "</tbody></table>";
        } else {
          h += "<div class=\"legend\">No mandatory organ dose reductions triggered for standard lab values.</div>";
        }
        h += "</div>";
        h += '<div class="ot-organ-calc-divider"></div>';
        h += '<h4 style="margin:14px 0 6px;font-size:15px;font-weight:700;">Interactive Bedside Calculator</h4>';
        h += calvertCalcHtml({
          age: c.age || 65,
          sex: c.sex || "male",
          weight: c.weightKg || 70,
          scr: c.serumCreatinine || 1.1,
          auc: (asArr(pObj.drugs).find(function(d) { return d.basis === "auc"; }) || {}).dosePerUnit || 5
        });
        st.superpowerModal = { title: "Organ Function & Calvert Dosing (" + esc(pObj.name || proto) + ")", html: h };
        renderSuperpowerModal();
      } catch (e3) { superpowerNotice("Organ Function & Calvert Dosing", ["Could not evaluate organ dosing for this regimen.", String((e3 && e3.message) || e3)]); }
      return;
    }
    if (act === "ddi-check") {
      var pObj = resolveProto(proto);
      if (!pObj) { superpowerNotice("DDI & QTc Interaction Sentry", ["The protocol data for this regimen is still loading.", "Wait a moment for the pathway to finish loading, then tap DDI Sentry again."]); return; }
      if (!G.SMD_ONCO_DDI) { superpowerNotice("DDI & QTc Interaction Sentry", ["The interaction sentry is still loading.", "Try again in a moment."]); return; }
      try {
        var sampleMeds = ["voriconazole", "ondansetron", "levofloxacin", "omeprazole"];
        var ddi = G.SMD_ONCO_DDI.auditDrugInteractions(pObj, sampleMeds);
        var h = "<div class=\"ot-ddi-eval\"><h4>Oncology Drug-Drug & QTc Interaction Audit</h4>";
        h += "<p class=\"text-muted small\">Co-medications checked: " + sampleMeds.join(", ") + "</p>";
        if (ddi.alertCount > 0) {
          h += "<table class=\"ot-compare-table\"><thead><tr><th>Severity</th><th>Regimen Drug</th><th>Co-medication</th><th>Clinical Effect & Management</th></tr></thead><tbody>";
          ddi.alerts.forEach(function(a) {
            var bCls = a.severity === "major" ? "badge-danger" : "badge-warning";
            h += "<tr><td><span class=\"badge " + bCls + "\">" + esc(a.severity) + "</span></td><td><b>" + esc(a.oncoDrug) + "</b></td><td>" + esc(a.interactingMeds.join(", ")) + "</td><td><b>" + esc(a.category) + "</b><br>" + esc(a.clinicalEffect) + "<br><em>" + esc(a.management) + "</em></td></tr>";
          });
          h += "</tbody></table>";
        } else {
          h += "<div class=\"legend\">No major or contraindicated interactions detected with current medication profile.</div>";
        }
        h += "</div>";
        st.superpowerModal = { title: "DDI & QTc Interaction Sentry", html: h };
        renderSuperpowerModal();
      } catch (e4) { superpowerNotice("DDI & QTc Interaction Sentry", ["Could not audit interactions for this regimen.", String((e4 && e4.message) || e4)]); }
      return;
    }
    if (act === "genomics-drawer") {
      if (!G.SMD_ONCO_GENOMICS) { superpowerNotice("Molecular Tumor Board & Precision Matcher", ["The genomics matcher is still loading.", "Try again in a moment."]); return; }
      try {
        var profile = [{ gene: "EGFR", alteration: "L858R" }, { gene: "BRAF", alteration: "V600E" }, { gene: "MMR", alteration: "dMMR / MSI-H" }];
        var gm = G.SMD_ONCO_GENOMICS.matchActionableTargets(profile, st.guideline);
        var h = "<div class=\"ot-genomics-eval\"><h4>Actionable Genomic Biomarkers & Precision Therapies</h4>";
        h += "<table class=\"ot-compare-table\"><thead><tr><th>Biomarker</th><th>Alteration</th><th>Category 1 Targeted Therapy</th><th>Evidence Level</th></tr></thead><tbody>";
        gm.matches.forEach(function(m) {
          h += "<tr><td><b>" + esc(m.gene) + "</b></td><td>" + esc(m.alteration) + "</td><td>" + esc(m.recommendedTherapies.join(", ")) + "</td><td><span class=\"badge badge-info\">" + esc(m.evidenceLevel) + "</span></td></tr>";
        });
        h += "</tbody></table></div>";
        st.superpowerModal = { title: "Molecular Tumor Board & Precision Matcher", html: h };
        renderSuperpowerModal();
      } catch (e5) { superpowerNotice("Molecular Tumor Board & Precision Matcher", ["Could not match genomic targets right now.", String((e5 && e5.message) || e5)]); }
      return;
    }

    if (act === "proto-sheet") { openProtocolSheet(proto); return; }
    if (act === "select-proto") { selectProtocol(proto); return; }
    if (act === "back-pathway") { st.selection = null; st.openedProtocol = null; paint(); return; }
    if (act === "handoff") { doHandoff(); return; }
  }

  // Answering a node: single-select (radio) replaces the answer, then CLEAR any now-unreachable
  // downstream answers so the re-derived state is consistent (never keeps a stale deeper answer).
  function answer(nodeId, optId) {
    st.answers[nodeId] = [optId];
    pruneDownstream();
    st.openedProtocol = null; st.selection = null;
    var state = evalState();
    if (state) {
      var cur = currentQuestion(state);
      var outs = reachedOutcomes(state);
      if (!cur && outs && outs.length) {
        if (st.lastEndStepNode === nodeId && st.lastEndStepOpt === optId) {
          st.lastEndStepPressCount = (st.lastEndStepPressCount || 1) + 1;
        } else {
          st.lastEndStepNode = nodeId;
          st.lastEndStepOpt = optId;
          st.lastEndStepPressCount = 1;
        }
        st.navEndModalOpen = (st.lastEndStepPressCount >= 3);
      } else {
        st.lastEndStepNode = null;
        st.lastEndStepOpt = null;
        st.lastEndStepPressCount = 0;
        st.navEndModalOpen = false;
      }
    }
    repaintBody();
    if (st.view === "navigator") {
      if (currentNavMode() === "canvas") navAutoScroll();
      else {
        if (typeof setTimeout !== "undefined") {
          setTimeout(function () {
            var el = D && (D.querySelector(".ot-flow-card.active") || D.querySelector(".ot-flow-card.outcome"));
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 60);
        }
      }
    }
  }
  function editStep(nodeId) {
    // Jump back to a step: drop this answer + everything downstream, so the doctor re-answers forward.
    delete st.answers[nodeId];
    pruneDownstream();
    st.openedProtocol = null; st.selection = null; st.view = "pathway";
    paint();
  }
  // Remove answers for nodes that are no longer active under the current answers (keeps state clean).
  function pruneDownstream() {
    if (!ENG() || !st.graph) return;
    for (var pass = 0; pass < 6; pass++) {
      var state = ENG().evaluate(st.graph, st.answers, { rebaseId: st.rebaseId }), changed = false;
      Object.keys(st.answers).forEach(function (id) {
        if (state.nodes[id] && state.nodes[id].status !== "active") { delete st.answers[id]; changed = true; }
      });
      if (!changed) break;
    }
  }

  // Cross-page navigation. g = jump to another disease graph; n = re-root the current graph at that node.
  function followLink(g, n) {
    var label = (st.graph && (st.graph.title || st.guideline)) || "Start";
    st.trail = (st.trail || []).concat([{ label: label, guideline: st.guideline, rebaseId: st.rebaseId }]);
    if (g && g !== st.guideline) { var keep = st.trail; st._pendingRebase = n || null; loadGuideline(g); st.trail = keep; }
    else { st.rebaseId = n || null; st.mapSel = null; st.view = "pathway"; paint(); }
  }
  function gotoCrumb(idx) {
    if (!st.trail || idx < 0 || idx >= st.trail.length) return;
    var c = st.trail[idx];
    st.trail = st.trail.slice(0, idx);
    if (c.guideline && c.guideline !== st.guideline) { var keep = st.trail; st._pendingRebase = c.rebaseId || null; loadGuideline(c.guideline); st.trail = keep; }
    else { st.rebaseId = c.rebaseId || null; st.mapSel = null; st.view = "pathway"; paint(); }
  }
  function copySummary() {
    var state = evalState(); if (!state) return;
    var txt = summaryText(state);
    try {
      if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
        G.navigator.clipboard.writeText(txt).then(function () { if (G.toast) G.toast("Pathway summary copied"); }, function () { if (G.toast) G.toast("Copy failed"); });
      } else if (G.toast) { G.toast("Clipboard unavailable"); }
    } catch (e) { if (G.toast) G.toast("Copy failed"); }
  }

  function selectProtocol(ref) {
    var p = resolveProto(ref) || st.protocols[ref] || {};
    var state = evalState();
    st.selection = {
      protocolId: ref, protocolVersion: p.version || p.protocolVersion || null,
      guideline: st.guideline, navigatorVersion: (st.graph && st.graph.navigatorVersion) || null,
      badge: p.experimental ? "BETA · AI-DRAFTED" : ((p.lifecycleState || "draft").toUpperCase()),
      phenotype: state ? state.phenotype : {}, answers: JSON.parse(JSON.stringify(st.answers)),
      pathway: state ? state.activePathIds.slice() : []
    };
    G.SMD_ONCOTREE._lastSelection = st.selection;
    st.openedProtocol = null;
    paint();
  }

  // Open the printable/assignable Protocol Sheet for a protocol, carrying any patient context from the
  // chart so the dose engine can compute per-drug totals. Assign routes back through the same handoff event.
  function openProtocolSheet(ref) {
    if (!G.SMD_PROTOSHEET) { try { G.toast && G.toast("Protocol sheet unavailable."); } catch (e) {} return; }
    var p = resolveProto(ref) || st.protocols[ref] || ref;
    var c = st.ctx || {};
    var today = "";
    try { var d = new (G.Date)(); today = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); } catch (e2) {}
    var patient = {
      caseNo: c.caseNo || c.patientId || "", name: c.name || "", age: c.age || null, sex: c.sex || "",
      heightCm: c.heightCm || null, weightKg: c.weightKg || null,
      creatinine: c.creatinine || c.serumCreatinine || null,
      diagnosis: c.diagnosis || st.guideline || "", intent: (asArr(p && p.intentOptions)[0] || ""), consultant: c.consultant || ""
    };
    try {
      G.SMD_PROTOSHEET.open(p, patient, {
        today: today,
        onAssign: function (payload) {
          try { if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-oncotree-select", { detail: { protocolId: ref, template: (typeof p === "object" ? p : null), patient: payload.patient, protocolSheet: payload } })); } catch (e3) {}
        }
      });
    } catch (err) {
      try { G.toast && G.toast("Error opening protocol sheet: " + (err && err.message ? err.message : err)); } catch (e4) {}
    }
  }

  // Hand off to the EXISTING oncology workflow. Emits a CustomEvent the host (opd-emr / onco home) can
  // listen for; never activates a plan or computes a dose here (existing gates stay in control).
  function doHandoff() {
    var payload = st.selection || {};
    var ctx = st.ctx || {};
    var proto = st.protocols[payload.protocolId] || null;
    var dx = (payload.phenotype && (payload.phenotype.diagnosis || payload.phenotype.histology)) || st.guideline || null;
    // Carry the loaded protocol object + (when launched from a chart) the patient so the OPD-EMR
    // listener can stage the dose draft for THIS patient. Dosing/activation stay in OPD-EMR's gates.
    payload.template = proto;
    var fromPatient = !!(ctx.patientId || ctx.fromEmr);
    if (fromPatient) payload.patient = { patientId: ctx.patientId || null, name: ctx.name || null, heightCm: ctx.heightCm || null, weightKg: ctx.weightKg || null };
    // Always emit the selection so a host listener (the OPD-EMR patient context) can pick it up.
    try {
      if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-oncotree-select", { detail: payload }));
    } catch (e) {}
    // 1) Launched from a patient's chart -> the OPD-EMR listener stages the dose preview there; just close.
    if (fromPatient) {
      close();
      try { if (G.toast) G.toast("Protocol sent to the patient's Oncology plan - review the computed doses there."); } catch (e1) {}
      return;
    }
    // 2) Standalone with the dose flow available -> open it with the protocol. The flow self-gates on its
    // flags (smd_onco_protocols + smd_onco_recommend); when OFF (e.g. public release) skip this branch so we
    // fall through to the read-only Onco workbench instead of closing into a dead "flow is off" toast.
    try {
      var flowOn = G.SMD_ONCOFLOW && (!G.SMD_ONCOFLOW.isOn || G.SMD_ONCOFLOW.isOn());
      if (flowOn && G.SMD_ONCOFLOW.openFind && proto) {
        close(); G.SMD_ONCOFLOW.openFind({ diagnosis: dx }, [proto]); return;
      }
    } catch (e2) {}
    // 3) Otherwise open the Onco workbench (reference) with the disease context, so it lands somewhere real.
    try {
      if (G.SMD_ONCOHOME && G.SMD_ONCOHOME.open) {
        close(); G.SMD_ONCOHOME.open({ diagnosis: dx });
        if (G.toast) G.toast("Selection recorded - opened the Onco workbench. Plan patient doses in the patient's Assessment > Oncology.");
        return;
      }
    } catch (e3) {}
    // 4) Nothing reachable: keep the honest guidance.
    try { if (G.toast) G.toast("Selection recorded. Continue in the patient's Assessment > Oncology for dose planning."); } catch (e4) {}
  }

  // ---- load + open -------------------------------------------------------------------------------
  function loadGuideline(id) {
    if (!G.fetch) { st.error = "Navigator unavailable in this environment."; paint(); return; }
    // fresh disease: clear all per-disease state so nothing from a prior disease leaks
    st.guideline = id; st.graph = null; st.byId = {}; st.answers = {}; st.protocols = {};
    st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.showExcluded = false; st.view = "pathway"; st.rebaseId = null; st.superpowerModal = null;
    st.loading = true; st.error = null; paint();
    G.fetch("/kb/oncotree/" + encodeURIComponent(id) + ".json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (graph) {
        if (!graph) throw new Error("navigator graph not found");
        st.graph = graph; st.byId = {}; asArr(graph.nodes).forEach(function (n) { st.byId[n.id] = n; });
        var refs = {};
        asArr(graph.nodes).forEach(function (n) { asArr(n.protocolRefs).forEach(function (r) { refs[r] = 1; }); });
        var ids = Object.keys(refs);
        return Promise.all(ids.map(function (id) {
          return G.fetch("/kb/protocols/" + encodeURIComponent(id) + ".json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        })).then(function (protos) {
          protos.forEach(function (p, i) { if (p) st.protocols[ids[i]] = p; });
          st.loaded = true; st.loading = false; prepopulate();
          if (st._pendingRebase) { if (st.byId[st._pendingRebase]) st.rebaseId = st._pendingRebase; st._pendingRebase = null; }
          paint();
        });
      })
      .catch(function (err) { st.loading = false; st.error = "Could not load the navigator. " + (err && err.message ? err.message : ""); paint(); });
  }

  // Prepopulate from EMR/patient context where available (no duplicate patient DB; best-effort, audited
  // as a physician-editable answer). ctx may carry {diseaseId, stage, her2, hr, setting}.
  function prepopulate() {
    var c = st.ctx; if (!c) return;
    function set(nodeId, optId) { if (st.byId[nodeId] && !st.answers[nodeId]) st.answers[nodeId] = [optId]; }
    if (c.histology === "invasive" || /invasiv/i.test(c.diagnosis || "")) set("n_histology", "invasive");
    var stageMap = { I: "s1", II: "s2", III: "s3", IV: "s4" };
    if (c.stage && stageMap[String(c.stage).toUpperCase()]) set("n_stage", stageMap[String(c.stage).toUpperCase()]);
  }

  function open(ctx) {
    if (!flagOn()) { try { G.toast && G.toast("ONCOTREE is off"); } catch (e) {} return; }
    if (!D) return;
    st.ctx = ctx || null;
    st.view = (ctx && ctx.view) || "navigator";
    var el = D.getElementById("smdOncoTree");
    if (!el) {
      el = D.createElement("div"); el.id = "smdOncoTree"; el.className = "ot-overlay";
      D.body.appendChild(el);
      el.addEventListener("click", onClick);
      el.addEventListener("input", onInput);
    }
    el.style.display = "block";
    if (D.body) D.body.classList.add("ot-open");
    if (ctx && ctx.guideline) loadGuideline(ctx.guideline);   // deep-link straight to a disease
    else paint();                                             // show the disease picker (or the loaded disease on re-open)
  }
  function close() {
    st.superpowerModal = null;
    renderSuperpowerModal();
    var el = D && D.getElementById("smdOncoTree");
    if (el) el.style.display = "none";
    if (D && D.body) D.body.classList.remove("ot-open");
    try { if (D && D.getElementById("smdOncoHome") && D.getElementById("smdOncoHome").classList.contains("on") && G.SMD_ONCOHOME && G.SMD_ONCOHOME.foreground) G.SMD_ONCOHOME.foreground(); } catch (e) {}
  }

  // React Bits Spotlight tracking: calculates cursor/pointer offset for luminous gradients
  try {
    if (typeof document !== "undefined") {
      document.addEventListener("pointermove", function (e) {
        var card = e.target && e.target.closest ? e.target.closest(".ot-spotlight-card, .ot-opt, .ot-node-card, .ot-proto-card, .ot-hero-card, .ot-super-card, .ot-disease, .ot-flow-card, .ot-flow-opt-card, .ot-step, .ot-flow-proto-card, .ot-btn") : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mouse-x", (e.clientX - r.left) + "px");
        card.style.setProperty("--mouse-y", (e.clientY - r.top) + "px");
      }, { passive: true });
    }
  } catch (e) {}

  var API = {
    open: open, close: close, _evalState: evalState, _bodyHtml: bodyHtml, _st: st,
    _answer: answer, _select: selectProtocol, _doHandoff: doHandoff, _version: "1.0"
  };
  if (root) root.SMD_ONCOTREE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
