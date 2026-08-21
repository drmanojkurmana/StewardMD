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
    { id: "thyroid", title: "Thyroid Cancer", sub: "Anaplastic (BRAF) / medullary (RET)", icon: "biotech", ready: true },
    { id: "cervical", title: "Cervical Cancer", sub: "FIGO stage; chemoRT vs surgery; recurrent by PD-L1", icon: "female", ready: true },
    { id: "uterine", title: "Uterine / Endometrial", sub: "Molecular class; risk-adapted adjuvant; MMR / HER2", icon: "female", ready: true },
    { id: "pancreatic", title: "Pancreatic Cancer", sub: "Resectable vs metastatic; FOLFIRINOX vs gem-nab", icon: "gastroenterology", ready: true },
    { id: "hcc", title: "Hepatocellular Carcinoma", sub: "BCLC + Child-Pugh; local vs systemic by line", icon: "gastroenterology", ready: true },
    { id: "anal", title: "Anal Cancer", sub: "Definitive chemoRT; metastatic immunotherapy", icon: "gastroenterology", ready: true },
    { id: "gist", title: "GI Stromal Tumor (GIST)", sub: "Risk-adapted imatinib; TKI by line + mutation", icon: "gastroenterology", ready: true },
    { id: "sarcoma", title: "Soft Tissue Sarcoma", sub: "Grade / size; surgery +/- RT; histology-directed", icon: "healing", ready: true },
    { id: "cns", title: "CNS / Glioma", sub: "IDH / 1p19q class; Stupp protocol; recurrence", icon: "neurology", ready: true },
    { id: "aml", title: "Acute Myeloid Leukemia", sub: "ELN risk; fit vs unfit; targeted + transplant", icon: "bloodtype", ready: true },
    { id: "cll", title: "Chronic Lymphocytic Leukemia", sub: "Watch vs treat; TP53 / IGHV; BTKi vs venetoclax", icon: "bloodtype", ready: true },
    { id: "dlbcl", title: "Diffuse Large B-Cell Lymphoma", sub: "IPI; R-CHOP vs pola-R-CHP; relapsed CAR-T", icon: "bloodtype", ready: true },
    { id: "hodgkin", title: "Hodgkin Lymphoma", sub: "Early vs advanced; PET-adapted ABVD / BV", icon: "bloodtype", ready: true }
  ];

  var st = {
    guideline: null, graph: null, protocols: {}, answers: {}, rebaseId: null,
    view: "pathway", openedProtocol: null, selection: null, whyOpen: {}, showExcluded: false,
    loaded: false, loading: false, error: null, ctx: null,
    trail: [], tocQuery: "", summaryOpen: false, _pendingRebase: null
  };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(name) { return '<span class="material-symbols-outlined">' + name + "</span>"; }
  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_navigator")); } catch (e) { return false; } }
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
        '<button class="ot-btn ghost" data-ot-act="view-proto" data-ot-proto="' + esc(ref) + '">' + ms("visibility") + "View protocol</button>" +
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
    var cards = applicable.map(function (r) { return protocolCardHtml(r, matchById[r]); }).join("");
    var ocat = CAT[node.nodeCategory] || CAT.treatment;
    var head = '<div class="ot-outcome-head" style="--ot-c:' + ocat.color + '">' + catChip(node.nodeCategory || "treatment") +
      '<h2 class="ot-step-title">' + esc(node.title || node.name) + evBadge(node) + fnMarkers(node) + "</h2>" +
      (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") + bulletsHtml(node.bullets) + tablesHtml(node) + "</div>";
    var count = '<div class="ot-outcome-count">' + applicable.length + " applicable protocol" + (applicable.length === 1 ? "" : "s") +
      ' <span class="ot-outcome-note">Decision support only. Physician selects; the existing dose engine computes doses.</span></div>';
    var exHtml = excludedByPheno.length
      ? '<details class="ot-excl-proto"><summary>' + excludedByPheno.length + " option" + (excludedByPheno.length === 1 ? "" : "s") + " not applicable to this phenotype</summary>" +
        excludedByPheno.map(function (r) { var p = st.protocols[r]; return '<div class="ot-excl-row">' + esc((p && p.name) || r) + "</div>"; }).join("") + "</details>"
      : "";
    return '<div class="ot-outcome">' + head + count + (cards || '<div class="ot-empty">No applicable protocol found for this phenotype.</div>') + exHtml + "</div>";
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
    var p = st.protocols[ref];
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

  // Disease-picker landing (multi-disease entry). Only diseases with a reviewed graph are selectable.
  function pickerHtml() {
    var cards = DISEASES.map(function (d) {
      return '<button class="ot-disease" data-ot-act="pick" data-ot-guideline="' + esc(d.id) + '"' + (d.ready ? "" : " disabled") + '>' +
        '<span class="ot-disease-ic">' + ms(d.icon) + "</span>" +
        '<span class="ot-disease-t"><b>' + esc(d.title) + "</b><span>" + esc(d.sub) + "</span></span>" +
        (d.ready ? ms("chevron_right") : '<span class="ot-soon">soon</span>') + "</button>";
    }).join("");
    var maker = G.SMD_PROTOMAKER ? '<button class="ot-disease ot-disease-maker" data-ot-act="proto-maker">' +
        '<span class="ot-disease-ic">' + ms("note_add") + "</span>" +
        '<span class="ot-disease-t"><b>Custom protocol</b><span>Build or open your own regimen (new guideline, off-list)</span></span>' +
        ms("chevron_right") + "</button>" : "";
    return '<div class="ot-picker"><div class="ot-picker-h">Choose a cancer</div>' +
      '<div class="ot-picker-sub">Navigate the disease pathway to applicable StewardMD Standard Protocols. Decision support only; the physician decides and the existing dose engine computes doses.</div>' +
      cards + maker + "</div>";
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
    if (st.openedProtocol) return protocolDetailHtml(st.openedProtocol);
    if (st.selection) return selectionHtml();
    if (st.view === "map") return mapHtml(state) + footnoteSheetHtml() + summarySheetHtml();

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

  // ---- shell + paint -----------------------------------------------------------------------------
  function shellHtml() {
    var hasGraph = !!st.graph;
    var title = hasGraph ? (st.graph.title || "ONCOTREE") : "Oncology navigator";
    var viewToggle = hasGraph ? ('<div class="ot-viewtoggle">' +
      '<button class="ot-vt' + (st.view === "pathway" ? " on" : "") + '" data-ot-act="view-pathway">' + ms("account_tree") + "Pathway</button>" +
      '<button class="ot-vt' + (st.view === "map" ? " on" : "") + '" data-ot-act="view-map">' + ms("map") + "Map</button>" +
      '<button class="ot-vt ot-vt-act" data-ot-act="summary">' + ms("summarize") + "Summary</button></div>") : "";
    var kicker = hasGraph
      ? '<button class="ot-hkicker ot-hkicker-btn" data-ot-act="change-disease">' + ms("swap_horiz") + "Change cancer</button>"
      : '<span class="ot-hkicker">ONCOTREE navigator</span>';
    var rightBtn = hasGraph
      ? '<button class="ot-hbtn" data-ot-act="reset" aria-label="Restart">' + ms("restart_alt") + "</button>"
      : '<span class="ot-hbtn" aria-hidden="true"></span>';
    return '<div class="ot-shell">' +
      '<header class="ot-header">' +
        '<button class="ot-hbtn" data-ot-act="close" aria-label="Close">' + ms("close") + "</button>" +
        '<div class="ot-htitle">' + kicker + '<span class="ot-hname">' + esc(title) + "</span></div>" +
        rightBtn +
      "</header>" +
      viewToggle +
      crumbsHtml() +
      '<div class="ot-scroll" id="otBody">' + bodyHtml() + "</div>" +
      '<div class="ot-disclaimer">Decision support. DRAFT navigator + protocols. Not an approved clinical order; the physician decides and the existing dose engine computes doses.</div>' +
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
  }
  function repaintBody() {
    var b = D && D.getElementById("otBody");
    if (b) { b.innerHTML = bodyHtml(); motionRender(); setupGraph(); } else paint();
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
    if (!t || t.getAttribute("data-ot-input") !== "toc-search") return;
    st.tocQuery = t.value || "";
    var list = D && D.getElementById("otTocList"), state = evalState();
    if (list && state) list.innerHTML = tocListHtml(state);
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-ot-act]") : null;
    if (!t) return;
    var act = t.getAttribute("data-ot-act");
    var node = t.getAttribute("data-ot-node"), opt = t.getAttribute("data-ot-opt"), proto = t.getAttribute("data-ot-proto");
    if (act === "close") return close();
    if (act === "pick") { loadGuideline(t.getAttribute("data-ot-guideline")); return; }
    if (act === "change-disease") { st.graph = null; st.guideline = null; st.byId = {}; st.answers = {}; st.protocols = {}; st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.view = "pathway"; paint(); return; }
    if (act === "retry") { st.error = null; if (st.guideline) loadGuideline(st.guideline); else paint(); return; }
    if (act === "reset") { st.answers = {}; st.rebaseId = null; st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.view = "pathway"; repaintBody(); return; }
    if (act === "view-pathway") { st.view = "pathway"; paint(); return; }
    if (act === "view-map") { st.view = "map"; paint(); return; }
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
    repaintBody();
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
    var p = st.protocols[ref] || {};
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
    var p = st.protocols[ref]; if (!p) return;
    var c = st.ctx || {};
    var today = "";
    try { var d = new (G.Date)(); today = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); } catch (e2) {}
    var patient = {
      caseNo: c.caseNo || c.patientId || "", name: c.name || "", age: c.age || null, sex: c.sex || "",
      heightCm: c.heightCm || null, weightKg: c.weightKg || null,
      diagnosis: c.diagnosis || st.guideline || "", intent: (asArr(p.intentOptions)[0] || ""), consultant: c.consultant || ""
    };
    G.SMD_PROTOSHEET.open(p, patient, {
      today: today,
      onAssign: function (payload) {
        try { if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-oncotree-select", { detail: { protocolId: ref, template: p, patient: payload.patient, protocolSheet: payload } })); } catch (e3) {}
      }
    });
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
    st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.showExcluded = false; st.view = "pathway"; st.rebaseId = null;
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
    var el = D && D.getElementById("smdOncoTree");
    if (el) el.style.display = "none";
    if (D && D.body) D.body.classList.remove("ot-open");
  }

  var API = {
    open: open, close: close, _evalState: evalState, _bodyHtml: bodyHtml, _st: st,
    _answer: answer, _select: selectProtocol, _doHandoff: doHandoff, _version: "1.0"
  };
  if (root) root.SMD_ONCOTREE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
