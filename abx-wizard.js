/* ============================================================================
   StewardMD — Antibiotic Decision Engine · 5-STEP GUIDED WIZARD (design handoff)
   ----------------------------------------------------------------------------
   A real, navigated 5-step flow — Vitals & labs -> Systems -> Differential ->
   Decision -> Plan — matching design_handoff_antibiotic_decision_engine.
   PRESENTATION + FLOW only: it OWNS its own DOM (#abxWizard) and calls the
   EXISTING engine for every clinical result. It NEVER re-implements compute:
     • findings taxonomy  = window.FIELD_GROUPS  (the real ontology)
     • differential/gate  = window.SMD_REASON.assess(findings)  (pure, real)
     • plan / treatment   = window.DX_MGMT[id] + window.DX.openRef(id)
   No engine id/class/global is renamed or removed; app.js / reasoning.js are
   untouched. Gated by html.abx-ui (?abxui=0 disables). "Start Case" opens it.
   ============================================================================ */
(function () {
  "use strict";
  if (!document.documentElement.classList.contains("abx-ui")) return;

  // ---- config --------------------------------------------------------------
  var VITALS_GROUPS = ["General / Vitals", "Clinical Course (IV-to-PO)", "MDR Risk Factors", "Vitals & Labs"];
  var NUMERIC_GROUP = "Vitals & Labs";
  // Simple mode step-1 shows only "General / Vitals"; systems still shown, curated.
  var SIMPLE_VITALS = ["General / Vitals"];

  // group/system label -> Material Symbols Rounded glyph
  var ICONS = [
    [/respir|pulmon|lung/, "respiratory_rate"], [/renal|urinary|genitourin|kidney/, "water_drop"],
    [/abdom|gastro|hepat|\bgi\b|liver|biliary/, "gastroenterology"], [/skin|soft ?tissue|haem|derma|rheum/, "dermatology"],
    [/neuro|cns|central nervous/, "neurology"], [/sepsis|oncolog|systemic|unclear|febrile/, "bloodtype"],
    [/cardi|vascular/, "cardiology"], [/tropical|malaria|dengue/, "thermostat"],
    [/endocrine|metabol/, "endocrinology"], [/tox|poison|overdose|general/, "medication"],
    [/general|vital/, "monitor_heart"], [/clinical course|iv.?to.?po/, "sync_alt"], [/mdr|resist|risk/, "coronavirus"], [/lab/, "science"]
  ];
  function iconFor(label) { var s = (label || "").toLowerCase(); for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(s)) return ICONS[i][1]; return "stethoscope"; }

  // engine gate class -> design severity ramp (theme-invariant)
  var SEV = {
    very_likely: { k: "red", label: "Immediate antibiotics required", icon: "emergency" },
    likely: { k: "orange", label: "Antibiotics recommended", icon: "medication" },
    possible: { k: "yellow", label: "Antibiotics optional, narrow", icon: "info" },
    unlikely: { k: "green", label: "No antibiotics needed", icon: "check_circle" },
    noninfective: { k: "green", label: "No antibiotics needed", icon: "check_circle" },
    none: { k: "none", label: "", icon: "rule" }
  };
  function sevOf(cls) { return SEV[cls] || SEV.none; }

  var STEPS = [
    { n: 1, label: "Vitals & labs", icon: "monitor_heart" },
    { n: 2, label: "Systems", icon: "fact_check" },
    { n: 3, label: "Differential", icon: "stacked_line_chart" },
    { n: 4, label: "Decision", icon: "gavel" },
    { n: 5, label: "Plan", icon: "medication" }
  ];
  var NEXT_LABEL = ["Add findings", "See differential", "Confirm & decide", "Treatment plan", "Done"];
  var STEP_CAPTION = ["Vitals & labs · all optional", "Add the findings you observe", "Pick the best-fit diagnosis", "Review the recommendation", "Regimen & stewardship"];

  // ---- state ---------------------------------------------------------------
  var W = { mode: "simple", step: 1, findings: {}, open: null, locked: null };
  function fg() { return (window.FIELD_GROUPS || []); }
  function groupByName(name) { return fg().filter(function (g) { return g.group === name; })[0]; }
  function isNumeric(f) { return f.type === "number" || f.type === "select"; }
  function boolFields(g) { return (g.fields || []).filter(function (f) { return !isNumeric(f) && f.type !== "radio"; }); }
  function radioFields(g) { return (g.fields || []).filter(function (f) { return f.type === "radio"; }); }
  function numFields(g) { return (g.fields || []).filter(isNumeric); }

  // which groups appear in the current step + mode
  function stepGroups() {
    var all = fg();
    if (W.step === 1) {
      var names = (W.mode === "simple") ? SIMPLE_VITALS : VITALS_GROUPS;
      return all.filter(function (g) { return names.indexOf(g.group) >= 0; });
    }
    if (W.step === 2) return all.filter(function (g) { return VITALS_GROUPS.indexOf(g.group) < 0; });
    return [];
  }
  function selectedCount(g) {
    return (g.fields || []).filter(function (f) {
      var v = W.findings[f.key]; return v === true || (f.type === "radio" && v && v !== "none") || (isNumeric(f) && v != null && v !== "");
    }).length;
  }
  function anyFindings() { return Object.keys(W.findings).some(function (k) { return W.findings[k]; }); }

  function assess() {
    try { return (window.SMD_REASON && SMD_REASON.assess) ? SMD_REASON.assess(W.findings) : null; } catch (e) { return null; }
  }
  function lockedCand(a) {
    if (!W.locked || !a) return null;
    return a.infectious.concat(a.nonInfectious).filter(function (c) { return c.id === W.locked; })[0] || null;
  }

  // Split the wizard's findings into the classic engine's shape: boolean/radio/select
  // findings vs numeric vitals — so SMD_restoreCase renders the REAL full output.
  function classicPayload() {
    var f = {}, v = {};
    fg().forEach(function (g) {
      (g.fields || []).forEach(function (fl) {
        var val = W.findings[fl.key];
        if (val == null || val === "" || val === "none") return;
        if (fl.type === "number") v[fl.key] = val;
        else if (fl.type === "select" || fl.type === "radio") f[fl.key] = val;
        else f[fl.key] = true;
      });
    });
    return { f: f, v: v };
  }
  // Render the classic #outputArea for the wizard's findings + locked dx, then
  // DISTRIBUTE its section nodes across the Decision (step 4) and Plan (step 5)
  // steps so neither is one long page. Nodes are MOVED (not cloned) so the live
  // safety inputs / accordions keep working; a fresh SMD_restoreCase re-creates
  // the full set each time, so leftover nodes never matter.
  var DECISION_NUMS = { "02": 1, "SCR": 1, "03": 1, "04": 1 }; // toxicity/severity/syndrome/pathogens
  function isDecisionSection(k) {
    if (k.classList) {
      if (k.classList.contains("quick-answer-card")) return true;      // Quick Decision
      if (k.classList.contains("safety-warning-banner")) return true;  // red-flag alert
      if (k.classList.contains("decision-banner")) return true;        // Antibiotics + Why
      if (k.classList.contains("smd-acc")) {
        var n = k.querySelector(".num"); return !!(n && DECISION_NUMS[n.textContent.trim()]);
      }
    }
    return false; // console / save / patient-safety / toolbar / 05..10 → Plan
  }
  // renderNow=true → freshly render #outputArea before splitting.
  function distributeOutput(host, which, renderNow) {
    try {
      if (renderNow && window.SMD_restoreCase) { var pay = classicPayload(); window.SMD_restoreCase(pay.f, W.locked, pay.v); }
      var out = document.getElementById("outputArea");
      if (!out) return false;
      var kids = [].slice.call(out.children), moved = 0;
      kids.forEach(function (k) {
        var dec = isDecisionSection(k);
        if ((which === "decision") === dec) { host.appendChild(k); moved++; }
      });
      return moved > 0;
    } catch (e) { return false; }
  }
  // #outputArea itself is never moved (only its children) → nothing to restore.
  function restoreOutputArea() {}

  // ---- tiny DOM helper -----------------------------------------------------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function ms(name) { return '<span class="rds-icon abx-ms" aria-hidden="true">' + name + '</span>'; }

  // ---- shell ---------------------------------------------------------------
  var root = null;
  function build() {
    root = el("div", "abxw", "");
    root.id = "abxWizard";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Antibiotic decision engine");
    root.innerHTML =
      '<div class="abxw-scroll"><div class="abxw-wrap">' +
      '<header class="abxw-head">' +
        '<div class="abxw-brand"><span class="abxw-logo">' + ms("vaccines") + '</span>' +
          '<div><div class="abxw-brandt">Steward<span>MD</span></div><div class="abxw-brands">Antibiotic decision engine</div></div></div>' +
        '<div class="abxw-headr">' +
          '<div class="abxw-seg" role="tablist" aria-label="Mode">' +
            '<button class="abxw-segb" data-mode="simple" role="tab">' + ms("bolt") + 'Simple</button>' +
            '<button class="abxw-segb" data-mode="advanced" role="tab">' + ms("tune") + 'Advanced</button>' +
          '</div>' +
          '<button class="abxw-reset" data-act="reset" aria-label="Reset case">' + ms("restart_alt") + 'Reset</button>' +
          '<button class="abxw-close" data-act="close" aria-label="Close">' + ms("close") + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="abxw-policy">' + ms("policy") +
        '<div class="abxw-policyt"><b>Hospital policy</b> · ICMR (National) · AMRSN 2024 <span class="abxw-rec">· Recommended</span></div>' +
        '<span class="abxw-pill">Educational aid</span></div>' +
      '<nav class="abxw-stepper" role="tablist" aria-label="Progress"></nav>' +
      '<div class="abxw-body"></div>' +
      '</div></div>' +
      '<div class="abxw-nav"><div class="abxw-navin">' +
        '<button class="abxw-back" data-act="back">' + ms("arrow_back") + 'Back</button>' +
        '<div class="abxw-cap"></div>' +
        '<button class="abxw-next" data-act="next"><span class="abxw-nextl"></span>' + ms("arrow_forward") + '</button>' +
      '</div></div>';
    document.body.appendChild(root);

    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
  }

  function onClick(e) {
    var t = e.target.closest("[data-act],[data-mode],[data-group],[data-fkey],[data-lock],[data-radio]");
    if (!t) return;
    if (t.hasAttribute("data-mode")) { W.mode = t.getAttribute("data-mode"); W.open = null; render(); return; }
    var act = t.getAttribute("data-act");
    if (act === "reset") { W.step = 1; W.findings = {}; W.open = null; W.locked = null; render(); return; }
    if (act === "close") { close(); return; }
    if (act === "back") { if (W.step > 1) { W.step--; render(); } else close(); return; }
    if (act === "next") { next(); return; }
    if (act === "stepdot") { var s = +t.getAttribute("data-step"); if (s <= maxStep()) { W.step = s; render(); } return; }
    if (t.hasAttribute("data-group")) { var gn = t.getAttribute("data-group"); W.open = (W.open === gn ? null : gn); render(); return; }
    if (t.hasAttribute("data-fkey")) { var k = t.getAttribute("data-fkey"); if (W.findings[k]) delete W.findings[k]; else W.findings[k] = true; render(); return; }
    if (t.hasAttribute("data-radio")) { W.findings[t.getAttribute("data-radio")] = t.getAttribute("data-val"); render(); return; }
    if (t.hasAttribute("data-lock")) { W.locked = t.getAttribute("data-lock"); W.step = 4; render(); return; }
    if (act === "groupnext") { openNextGroup(); return; }
    if (act === "clearall") { W.findings = {}; W.locked = null; render(); return; }
    if (act === "openref") { try { if (window.DX && DX.openRef) DX.openRef(t.getAttribute("data-ref")); } catch (x) {} return; }
  }
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-num")) {
      var k = t.getAttribute("data-num");
      if (t.value === "" || t.value == null) delete W.findings[k]; else W.findings[k] = t.value;
      // don't full-render (keep focus) — just refresh the live differential if shown
    }
  }

  function openNextGroup() {
    var gs = stepGroups(); var i = gs.map(function (g) { return g.group; }).indexOf(W.open);
    if (i >= 0 && i < gs.length - 1) { W.open = gs[i + 1].group; render(); }
    else { next(); }
  }

  function maxStep() { return W.locked ? 5 : (anyFindings() ? 3 : 2); }
  function nextAllowed() {
    if (W.step === 1) return true;
    if (W.step === 2) return anyFindings();
    if (W.step === 3) return !!W.locked;
    if (W.step === 4) return true;
    return false;
  }
  function next() {
    if (W.step === 2 && !anyFindings()) return;
    if (W.step === 3 && !W.locked) return;
    if (W.step < 5) { W.step++; W.open = null; render(); }
  }

  // ---- renderers -----------------------------------------------------------
  function render() {
    if (!root) return;
    restoreOutputArea(); // reclaim the borrowed #outputArea before we wipe the body
    // segmented + stepper + nav
    root.querySelectorAll(".abxw-segb").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === W.mode); b.setAttribute("aria-selected", b.getAttribute("data-mode") === W.mode); });
    renderStepper();
    var scroller = root.querySelector(".abxw-scroll");
    var prevScroll = scroller ? scroller.scrollTop : 0;
    var sameView = (W.step === W._renderedStep && W.mode === W._renderedMode);
    var body = root.querySelector(".abxw-body");
    body.innerHTML = "";
    if (W.step === 1 || W.step === 2) body.appendChild(renderFindings());
    else if (W.step === 3) body.appendChild(renderDifferential());
    else if (W.step === 4) body.appendChild(renderDecision());
    else body.appendChild(renderPlan());
    // nav
    var back = root.querySelector(".abxw-back"); back.style.opacity = "1";
    root.querySelector(".abxw-cap").textContent = STEP_CAPTION[W.step - 1] || "";
    root.querySelector(".abxw-nextl").textContent = NEXT_LABEL[W.step - 1] || "Done";
    var nx = root.querySelector(".abxw-next"); nx.disabled = !nextAllowed(); nx.style.opacity = nextAllowed() ? "1" : ".4";
    // keep the reader's place on same-step re-renders (e.g. toggling a chip);
    // only jump to top when the step or mode actually changes.
    if (scroller) scroller.scrollTop = sameView ? prevScroll : 0;
    W._renderedStep = W.step; W._renderedMode = W.mode;
  }

  function renderStepper() {
    var nav = root.querySelector(".abxw-stepper"); nav.innerHTML = "";
    var mx = maxStep();
    STEPS.forEach(function (st) {
      var done = st.n < W.step, cur = st.n === W.step, reach = st.n <= Math.max(W.step, mx);
      var b = el("button", "abxw-step" + (cur ? " cur" : "") + (done ? " done" : "") + (reach ? "" : " off"),
        '<span class="abxw-dot">' + ms(done ? "check" : st.icon) + '</span><span class="abxw-steplbl">' + st.label + '</span>');
      b.setAttribute("data-act", "stepdot"); b.setAttribute("data-step", st.n);
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", cur ? "true" : "false");
      nav.appendChild(b);
    });
  }

  function renderFindings() {
    var wrap = el("div", "abxw-step-body");
    var isSimple = W.mode === "simple";
    var h = (W.step === 1) ? (isSimple ? "Key findings" : "Vitals & labs") : "What are you seeing?";
    var sub = (W.step === 1)
      ? (isSimple ? "The common, high-yield findings only. Switch to Advanced for full vitals, labs, risk factors and every symptom." : "Enter any vitals, labs, risk factors and general findings you have. All optional.")
      : (isSimple ? "Tap a system, then check the common symptoms. Switch to Advanced for the complete finding list." : "Tap the systems involved, then check every finding that applies.");
    wrap.appendChild(el("h2", "abxw-h", h));
    wrap.appendChild(el("p", "abxw-sub", sub));

    // selected summary
    var sel = selectedChips();
    if (sel.length) {
      var sc = el("div", "abxw-selcard");
      sc.innerHTML = '<div class="abxw-selhead"><span class="abxw-lbl">Selected findings (' + sel.length + ')</span><button class="abxw-clear" data-act="clearall">Clear all</button></div>';
      var row = el("div", "abxw-selrow");
      sel.forEach(function (s) { var c = el("button", "abxw-selchip", s.label + ms("close")); c.setAttribute("data-fkey", s.key); row.appendChild(c); });
      sc.appendChild(row); wrap.appendChild(sc);
    }

    // system-box grid
    wrap.appendChild(el("div", "abxw-pickttl", W.step === 1 ? "Which details do you have?" : "Which systems are involved?"));
    var grid = el("div", "abxw-sysgrid");
    var gs = stepGroups();
    gs.forEach(function (g) {
      var c = selectedCount(g), active = W.open === g.group;
      var b = el("button", "abxw-sysbox" + (active ? " active" : ""),
        '<span class="abxw-sysic">' + ms(iconFor(g.group)) + '</span><span class="abxw-sysnm">' + g.group + '</span>' +
        '<span class="abxw-syscap">' + (c > 0 ? c + " selected" : "Tap to open") + '</span>');
      b.setAttribute("data-group", g.group); b.setAttribute("aria-pressed", active ? "true" : "false");
      grid.appendChild(b);
    });
    wrap.appendChild(grid);

    // open group panel
    if (W.open) {
      var g = groupByName(W.open);
      if (g) wrap.appendChild(renderGroupPanel(g, gs));
    } else {
      wrap.appendChild(el("div", "abxw-empty", ms("touch_app") + '<p>Choose one or more ' + (W.step === 1 ? "detail groups" : "systems") + ' above to reveal their findings.</p>'));
    }

    // live differential hint
    if (anyFindings()) {
      var a = assess(); var top = a && (a.infectious[0] || a.nonInfectious[0]);
      if (top) wrap.appendChild(el("div", "abxw-livehint", ms("stacked_line_chart") + '<span>Live differential: <b>' + esc(top.name) + '</b> · ' + top.confidence + '%. Continue to review.</span>'));
    }
    return wrap;
  }

  function renderGroupPanel(g, gs) {
    var p = el("div", "abxw-panel");
    var c = selectedCount(g);
    p.appendChild(el("div", "abxw-panelh", ms(iconFor(g.group)) + '<h3>' + g.group + '</h3>' + (c > 0 ? '<span class="abxw-count">' + c + '</span>' : "")));
    var body = el("div", "abxw-panelb");

    // radio fields
    radioFields(g).forEach(function (f) {
      var wrapf = el("div", "abxw-radiowrap");
      wrapf.appendChild(el("div", "abxw-radiolbl", esc(f.label)));
      var rr = el("div", "abxw-radiorow");
      (f.radioOptions || []).forEach(function (o) {
        var on = W.findings[f.key] === o.value;
        var btn = el("button", "abxw-chip" + (on ? " on" : ""), (on ? ms("check") : ms("add")) + esc(o.label));
        btn.setAttribute("data-radio", f.key); btn.setAttribute("data-val", o.value);
        btn.setAttribute("role", "radio"); btn.setAttribute("aria-checked", on ? "true" : "false");
        rr.appendChild(btn);
      });
      wrapf.appendChild(rr); body.appendChild(wrapf);
    });

    // boolean chips
    var bf = boolFields(g);
    if (W.mode === "simple") bf = bf.slice(0, 12); // curated common subset in Simple
    if (bf.length) {
      var chips = el("div", "abxw-chips");
      bf.forEach(function (f) {
        var on = W.findings[f.key] === true;
        var b = el("button", "abxw-chip" + (on ? " on" : ""), (on ? ms("check") : ms("add")) + esc(f.label));
        b.setAttribute("data-fkey", f.key); b.setAttribute("role", "checkbox"); b.setAttribute("aria-checked", on ? "true" : "false");
        chips.appendChild(b);
      });
      body.appendChild(chips);
    }

    // numeric inputs (Advanced only)
    if (W.mode === "advanced") {
      var nf = numFields(g);
      if (nf.length) {
        var ng = el("div", "abxw-numgrid");
        nf.forEach(function (f) {
          var lab = el("label", "abxw-numfield"); lab.appendChild(el("span", null, esc(f.label)));
          var inp;
          if (f.type === "select" && f.options) {
            inp = document.createElement("select"); inp.setAttribute("data-num", f.key);
            inp.appendChild(el("option", null, "Select")); inp.firstChild.value = "";
            f.options.forEach(function (o) { var op = document.createElement("option"); op.value = o.value; op.textContent = o.label; if (W.findings[f.key] === o.value) op.selected = true; inp.appendChild(op); });
          } else {
            inp = document.createElement("input"); inp.type = "number"; inp.setAttribute("inputmode", "decimal");
            inp.setAttribute("data-num", f.key); if (W.findings[f.key] != null) inp.value = W.findings[f.key];
          }
          lab.appendChild(inp); ng.appendChild(lab);
        });
        body.appendChild(ng);
      }
    }

    // group next
    var idx = gs.map(function (x) { return x.group; }).indexOf(g.group);
    var last = idx === gs.length - 1;
    var nb = el("div", "abxw-panelnext");
    var btn = el("button", "abxw-groupnext", (last ? "Continue" : "Next: " + gs[idx + 1].group) + ms("arrow_forward"));
    btn.setAttribute("data-act", "groupnext"); nb.appendChild(btn); body.appendChild(nb);

    p.appendChild(body); return p;
  }

  function selectedChips() {
    var out = [];
    fg().forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        var v = W.findings[f.key];
        if (v === true) out.push({ key: f.key, label: f.label });
        else if (f.type === "radio" && v && v !== "none") { var o = (f.radioOptions || []).filter(function (x) { return x.value === v; })[0]; out.push({ key: f.key, label: (o ? o.label : f.label) }); }
        else if (isNumeric(f) && v != null && v !== "") out.push({ key: f.key, label: f.label.replace(/ \(.*\)/, "") + ": " + v });
      });
    });
    return out;
  }

  function renderDifferential() {
    var wrap = el("div", "abxw-step-body");
    wrap.appendChild(el("h2", "abxw-h", "Which fits best?"));
    wrap.appendChild(el("p", "abxw-sub", "Ranked by a transparent confidence score, not a validated probability. Tap the one that matches your clinical judgement."));
    var a = assess();
    var cands = a ? a.infectious.concat(a.nonInfectious) : [];
    if (!cands.length) {
      wrap.appendChild(el("div", "abxw-empty dash", ms("search_insights") + '<p>Add findings to build a differential.</p>'));
      return wrap;
    }
    cands.sort(function (x, y) { return (y.rank != null ? y.rank : y.confidence) - (x.rank != null ? x.rank : x.confidence); });
    var list = el("div", "abxw-difflist");
    cands.slice(0, 8).forEach(function (c) {
      var sv = sevInfClass(a, c);
      var locked = W.locked === c.id;
      var b = el("button", "abxw-diff sev-" + sv + (locked ? " locked" : ""),
        '<span class="abxw-diffrail"></span>' +
        '<div class="abxw-diffmain"><div class="abxw-diffnm">' + esc(c.name) + (locked ? ms("check_circle") : "") + '</div>' +
        '<div class="abxw-diffsys">' + esc(c.system || "") + '</div>' +
        '<div class="abxw-diffbar"><span style="width:' + Math.max(4, Math.min(100, c.confidence)) + '%"></span></div></div>' +
        '<span class="abxw-diffpct">' + c.confidence + '%</span>');
      b.setAttribute("data-lock", c.id); b.setAttribute("aria-pressed", locked ? "true" : "false");
      list.appendChild(b);
    });
    wrap.appendChild(list);
    return wrap;
  }
  // infectious candidates take the gate severity; non-infective are "green"
  function sevInfClass(a, c) {
    var isInf = a.infectious.some(function (x) { return x.id === c.id; });
    return isInf ? sevOf(a.gate.cls).k : "green";
  }

  // Step 4 — Decision: Quick Decision + Why + Toxicity + Severity + Syndrome + Pathogens
  // (the REAL engine sections, split out of #outputArea; renders it fresh here).
  function renderDecision() {
    var wrap = el("div", "abxw-step-body");
    var a = assess(); var c = lockedCand(a);
    if (!a || !c) { wrap.appendChild(el("div", "abxw-empty dash", ms("rule") + '<p>Lock a diagnosis from the differential to see the decision.</p>')); return wrap; }
    wrap.appendChild(el("h2", "abxw-secttl", ms("gavel") + "Clinical decision"));
    var host = el("div", "abxw-fullout"); wrap.appendChild(host);
    var ok = distributeOutput(host, "decision", true);
    if (!ok) { // fallback: concise card from assess()
      var isInf = a.infectious.some(function (x) { return x.id === c.id; });
      var sv = isInf ? sevOf(a.gate.cls) : SEV.noninfective;
      var card = el("div", "abxw-deccard sev-" + sv.k);
      card.innerHTML = '<div class="abxw-dechead"><span class="abxw-decic">' + ms(sv.icon) + '</span><div><div class="abxw-declbl">' + sv.label + '</div><div class="abxw-decdx">' + esc(c.name) + '</div></div></div>';
      host.appendChild(card);
      host.appendChild(el("div", "abxw-why", '<div class="abxw-lbl">Why</div><p>' + esc(c.reason || "") + '</p>'));
    }
    return wrap;
  }

  // Step 5 — Plan: Regimen + Interactions + Coverage + Stewardship + Investigations
  // + De-escalation + References (the remaining REAL engine sections). #outputArea
  // was already rendered in step 4; reuse it (renderNow=false) and take the rest.
  function renderPlan() {
    var wrap = el("div", "abxw-step-body");
    var a = assess(); var c = lockedCand(a);
    if (!a || !c) { wrap.appendChild(el("div", "abxw-empty dash", ms("rule") + '<p>Lock a diagnosis first to see the plan.</p>')); return wrap; }
    wrap.appendChild(el("h2", "abxw-secttl", ms("verified") + "Regimen & stewardship"));
    var host = el("div", "abxw-fullout"); wrap.appendChild(host);
    // render fresh (in case Decision wasn't visited this session), then take Plan sections
    var ok = distributeOutput(host, "plan", true);
    if (!ok) {
      host.appendChild(el("div", "abxw-why", '<div class="abxw-lbl">Why</div><p>' + esc(c.reason || "") + '</p>'));
      var ref = el("button", "abxw-openref primary", ms("open_in_new") + "Open full treatment reference"); ref.setAttribute("data-act", "openref"); ref.setAttribute("data-ref", c.treatmentRef || c.id);
      host.appendChild(ref);
    }
    return wrap;
  }

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- open / close --------------------------------------------------------
  function open(mode) {
    if (!root) build();
    if (mode) W.mode = mode;
    root.classList.add("on");
    document.documentElement.classList.add("abxw-open");
    render();
  }
  function close() {
    restoreOutputArea(); // give the borrowed #outputArea back to the classic engine
    if (root) root.classList.remove("on");
    document.documentElement.classList.remove("abxw-open");
  }
  window.ABX_WIZARD = { open: open, close: close };

  // OPT-IN only (default OFF). Start Case keeps opening the FULL classic engine
  // (complete stewardship console, weight-band regimen, patient-specific renal/
  // hepatic/cardiac safety, alternatives) — the wizard must render that same real
  // output before it can replace the classic flow. Enable to preview: ?abxwiz=1
  // or localStorage smd_abx_wizard="1".
  var WIZ_ON = /[?&]abxwiz=1\b/.test(location.search || "");
  try { if (localStorage.getItem("smd_abx_wizard") === "1") WIZ_ON = true; } catch (e) {}
  if (WIZ_ON) {
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest('[data-act="startcase"]');
      if (!b) return;
      if (!window.FIELD_GROUPS || !window.SMD_REASON) return; // engine not ready → let the app handle it
      e.preventDefault(); e.stopPropagation();
      open();
    }, true);
  }
})();
