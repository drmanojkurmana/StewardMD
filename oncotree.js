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

  var st = {
    guideline: "breast", graph: null, protocols: {}, answers: {}, rebaseId: null,
    view: "pathway", openedProtocol: null, selection: null, whyOpen: {}, showExcluded: false,
    loaded: false, loading: false, error: null, ctx: null
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
      '<h2 class="ot-step-title">' + esc(node.title || node.name) + "</h2>" +
      (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") +
      '<div class="ot-opts">' + opts + "</div></div>";
  }

  // Protocol card - references an EXISTING protocol; lifecycle badge is unmistakable; never approved-looking for drafts.
  function protocolCardHtml(ref, match) {
    var p = st.protocols[ref];
    if (!p) return '<div class="ot-card ot-card-missing">' + esc(ref) + ' - protocol not loaded</div>';
    var badge = (match && match.badge) || (p.experimental ? "EXPERIMENTAL DRAFT" : (p.lifecycleState || "draft").toUpperCase());
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

  function outcomeHtml(node, state) {
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
    var head = '<div class="ot-outcome-head">' + catChip("treatment") +
      '<h2 class="ot-step-title">' + esc(node.title || node.name) + "</h2>" +
      (node.description ? '<p class="ot-step-desc">' + esc(node.description) + "</p>" : "") + "</div>";
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

  function mapHtml(state) {
    var rows = state.order.map(function (id) {
      var ns = state.nodes[id], node = st.byId[id];
      var cls = ns.status;
      var mark = ns.status === "active" ? (ns.isAnswered ? "task_alt" : "radio_button_unchecked")
        : ns.status === "disabled" ? "block" : "more_horiz";
      var sel = ns.options.filter(function (o) { return o.isSelected; });
      return '<div class="ot-map-row ' + cls + '" style="--ot-c:' + (CAT[node.nodeCategory] || CAT.other).color + '">' +
        '<span class="ot-map-mark">' + ms(mark) + "</span>" +
        '<span class="ot-map-name">' + esc(node.name) + (sel.length ? ' <b>' + esc(shortLabel(sel[0].label)) + "</b>" : "") + "</span>" +
        '<span class="ot-map-cat">' + esc((CAT[node.nodeCategory] || CAT.other).name) + "</span></div>";
    }).join("");
    return '<div class="ot-map">' + rows + "</div>";
  }

  function protocolDetailHtml(ref) {
    var p = st.protocols[ref];
    if (!p) return '<div class="ot-empty">Protocol not loaded.</div>';
    var badge = p.experimental ? "EXPERIMENTAL DRAFT" : (p.lifecycleState || "draft").toUpperCase();
    var drugs = asArr(p.drugs).map(function (d) {
      var freq = d.frequency || (d.dosesPerDay > 1 ? ({ 2: "BID", 3: "TID", 4: "QID" }[d.dosesPerDay] || d.dosesPerDay + "x/day") : "");
      var dm = asArr(d.days).length ? "D" + (d.days.length === 1 ? d.days[0] : d.days[0] + "-" + d.days[d.days.length - 1]) : "";
      return '<tr><td>' + esc(d.name || d.id) + "</td><td>" + esc((d.dosePerUnit != null ? d.dosePerUnit + " " + (d.unit || "") : "VERIFY") + (freq ? " " + freq : "")) + "</td><td>" + esc((d.route || "") + (dm ? " " + dm : "")) + "</td></tr>";
    }).join("");
    var src = p.source ? [p.source.nccn, p.source.textbook].filter(Boolean).join(" · ") : "";
    return '<div class="ot-detail">' +
      '<button class="ot-back" data-ot-act="close-proto">' + ms("arrow_back") + "Back to options</button>" +
      '<div class="ot-detail-head"><h2>' + esc(p.name || ref) + '</h2><span class="ot-badge ' + (p.experimental ? "exp" : "draft") + '">' + esc(badge) + "</span></div>" +
      '<div class="ot-detail-warn">' + ms("info") + "This protocol is " + esc(badge) + " - decision support only, not an approved clinical order. The physician and the existing dose engine own dosing and activation.</div>" +
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
      '<div class="ot-detail-actions"><button class="ot-btn primary lg" data-ot-act="select-proto" data-ot-proto="' + esc(ref) + '">' + ms("check_circle") + "Select this protocol</button></div>" +
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

  function bodyHtml() {
    if (st.loading) return '<div class="ot-loading">' + ms("progress_activity") + "Loading navigator...</div>";
    if (st.error) return '<div class="ot-error">' + ms("error") + esc(st.error) + '<button class="ot-btn ghost" data-ot-act="retry">Retry</button></div>';
    var state = evalState();
    if (!state) return '<div class="ot-loading">Preparing...</div>';
    if (st.openedProtocol) return protocolDetailHtml(st.openedProtocol);
    if (st.selection) return selectionHtml();
    if (st.view === "map") return mapHtml(state);

    var cur = currentQuestion(state);
    var mid = "";
    if (cur) mid = questionCardHtml(cur, state);
    else {
      var outs = reachedOutcomes(state);
      mid = outs.length ? outs.map(function (n) { return outcomeHtml(n, state); }).join("")
        : '<div class="ot-empty">Answer the questions above to see applicable protocols.</div>';
    }
    return railHtml(state) + missingHtml(state) + '<div class="ot-body-main">' + mid + "</div>" + disabledPanelHtml(state);
  }

  // ---- shell + paint -----------------------------------------------------------------------------
  function shellHtml() {
    var title = (st.graph && st.graph.title) || "ONCOTREE";
    var viewToggle = '<div class="ot-viewtoggle">' +
      '<button class="ot-vt' + (st.view === "pathway" ? " on" : "") + '" data-ot-act="view-pathway">' + ms("account_tree") + "Pathway</button>" +
      '<button class="ot-vt' + (st.view === "map" ? " on" : "") + '" data-ot-act="view-map">' + ms("map") + "Map</button></div>";
    return '<div class="ot-shell">' +
      '<header class="ot-header">' +
        '<button class="ot-hbtn" data-ot-act="close" aria-label="Close">' + ms("close") + "</button>" +
        '<div class="ot-htitle"><span class="ot-hkicker">ONCOTREE navigator</span><span class="ot-hname">' + esc(title) + "</span></div>" +
        '<button class="ot-hbtn" data-ot-act="reset" aria-label="Restart">' + ms("restart_alt") + "</button>" +
      "</header>" +
      viewToggle +
      '<div class="ot-scroll" id="otBody">' + bodyHtml() + "</div>" +
      '<div class="ot-disclaimer">Decision support. DRAFT navigator + protocols. Not an approved clinical order; the physician decides and the existing dose engine computes doses.</div>' +
      "</div>";
  }

  function paint() {
    var el = D && D.getElementById("smdOncoTree");
    if (!el) return;
    el.innerHTML = shellHtml();
  }
  function repaintBody() {
    var b = D && D.getElementById("otBody");
    if (b) b.innerHTML = bodyHtml(); else paint();
  }

  // ---- events ------------------------------------------------------------------------------------
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-ot-act]") : null;
    if (!t) return;
    var act = t.getAttribute("data-ot-act");
    var node = t.getAttribute("data-ot-node"), opt = t.getAttribute("data-ot-opt"), proto = t.getAttribute("data-ot-proto");
    if (act === "close") return close();
    if (act === "retry") { st.error = null; load(); return; }
    if (act === "reset") { st.answers = {}; st.rebaseId = null; st.openedProtocol = null; st.selection = null; st.whyOpen = {}; st.view = "pathway"; repaintBody(); return; }
    if (act === "view-pathway") { st.view = "pathway"; paint(); return; }
    if (act === "view-map") { st.view = "map"; paint(); return; }
    if (act === "answer") { answer(node, opt); return; }
    if (act === "edit") { editStep(node); return; }
    if (act === "why") { st.whyOpen[node] = !st.whyOpen[node]; repaintBody(); return; }
    if (act === "toggle-excluded") { st.showExcluded = !st.showExcluded; repaintBody(); return; }
    if (act === "view-proto") { st.openedProtocol = proto; paint(); return; }
    if (act === "close-proto") { st.openedProtocol = null; paint(); return; }
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

  function selectProtocol(ref) {
    var p = st.protocols[ref] || {};
    var state = evalState();
    st.selection = {
      protocolId: ref, protocolVersion: p.version || p.protocolVersion || null,
      guideline: st.guideline, navigatorVersion: (st.graph && st.graph.navigatorVersion) || null,
      badge: p.experimental ? "EXPERIMENTAL DRAFT" : ((p.lifecycleState || "draft").toUpperCase()),
      phenotype: state ? state.phenotype : {}, answers: JSON.parse(JSON.stringify(st.answers)),
      pathway: state ? state.activePathIds.slice() : []
    };
    G.SMD_ONCOTREE._lastSelection = st.selection;
    st.openedProtocol = null;
    paint();
  }

  // Hand off to the EXISTING oncology workflow. Emits a CustomEvent the host (opd-emr / onco home) can
  // listen for; never activates a plan or computes a dose here (existing gates stay in control).
  function doHandoff() {
    var payload = st.selection;
    try {
      if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-oncotree-select", { detail: payload }));
    } catch (e) {}
    try { if (G.SMD_ONCOHOME && G.SMD_ONCOHOME.open) { /* future: open workbench with this protocol */ } } catch (e2) {}
    try { if (G.toast) G.toast("Selection recorded. Continue in the treatment workflow (dose engine + physician confirmation)."); } catch (e3) {}
  }

  // ---- load + open -------------------------------------------------------------------------------
  function load() {
    if (!G.fetch) { st.error = "Navigator unavailable in this environment."; paint(); return; }
    st.loading = true; st.error = null; paint();
    G.fetch("/kb/oncotree/" + st.guideline + ".json").then(function (r) { return r.ok ? r.json() : null; })
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
          st.loaded = true; st.loading = false; prepopulate(); paint();
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
    }
    el.style.display = "block";
    if (D.body) D.body.classList.add("ot-open");
    if (!st.loaded) load(); else { prepopulate(); paint(); }
  }
  function close() {
    var el = D && D.getElementById("smdOncoTree");
    if (el) el.style.display = "none";
    if (D && D.body) D.body.classList.remove("ot-open");
  }

  var API = {
    open: open, close: close, _evalState: evalState, _bodyHtml: bodyHtml, _st: st,
    _answer: answer, _select: selectProtocol, _version: "1.0"
  };
  if (root) root.SMD_ONCOTREE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
