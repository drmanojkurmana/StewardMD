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
  var W = { mode: "advanced", step: 1, findings: {}, open: null, locked: null, query: "" };
  function fg() { return (window.FIELD_GROUPS || []); }
  function groupByName(name) { return fg().filter(function (g) { return g.group === name; })[0]; }
  function isNumeric(f) { return f.type === "number"; }
  // Select fields (Sex, Ascites grade, Encephalopathy grade) render as tappable option CHIPS —
  // NOT the numeric keypad they used to fall through to (BUG-01 Sex, BUG-04 graded parameters).
  function selectFields(g) { return (g.fields || []).filter(function (f) { return f.type === "select"; }); }
  function boolFields(g) { return (g.fields || []).filter(function (f) { return f.type !== "number" && f.type !== "radio" && f.type !== "select"; }); }
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

  // Expand radio findings into the boolean keys the engine scores on (mirrors
  // app.js applyCoughDerivedState). Pure: returns a NEW object, drops the raw
  // radio key (so a "none" answer can't alias to cough via the infectious layer).
  function deriveRadios(src) {
    var f = {}; for (var k in src) f[k] = src[k];
    var c = f.coughRadio; delete f.coughRadio;
    if (c === "dry" || c === "productive") { f.cough = true; f.productiveCough = (c === "productive"); f.dryCough = (c === "dry"); }
    return f;
  }

  // ---- findings search index (boolean fields of FIELD_GROUPS) --------------
  var _findIdx = null;
  function findIndex() {
    if (_findIdx && _findIdx.length) return _findIdx;
    var out = [], seen = {};
    fg().forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        if (f.type === "radio" || f.type === "number" || f.type === "select") return; // boolean-only (tap sets true)
        if (seen[f.key]) return; seen[f.key] = 1;
        out.push({ key: f.key, label: f.label, group: g.group });
      });
    });
    _findIdx = out; return out;
  }
  function findSearch(q) {
    q = (q || "").toLowerCase().trim(); if (q.length < 2) return [];
    return findIndex().filter(function (f) {
      return f.label.toLowerCase().indexOf(q) >= 0 || f.key.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var an = a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1, bn = b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return an - bn || (a.label < b.label ? -1 : 1);
    }).slice(0, 24);
  }
  function findResultsHTML() {
    var q = W.query || ""; if (q.trim().length < 2) return "";
    var hits = findSearch(q);
    if (!hits.length) return '<div class="abxw-find-empty">No matching finding</div>';
    return hits.map(function (f) {
      var on = W.findings[f.key] === true;
      return '<button type="button" class="abxw-chip abxw-find-hit' + (on ? " on" : "") + '" data-fkey="' + esc(f.key) + '">' +
        (on ? ms("check") : ms("add")) + '<span class="nm">' + esc(f.label) + '</span><span class="grp">' + esc(f.group) + '</span></button>';
    }).join("");
  }
  function renderFindSearch() {
    var box = el("div", "abxw-find");
    var inp = el("input", "abxw-find-input"); inp.type = "search"; inp.setAttribute("autocomplete", "off");
    inp.setAttribute("data-search", "1"); inp.setAttribute("aria-label", "Search findings");
    inp.placeholder = "Search findings… cough, rash, altered sensorium"; inp.value = W.query || "";
    box.appendChild(inp);
    var res = el("div", "abxw-find-results"); res.id = "abxwFindResults"; res.innerHTML = findResultsHTML();
    box.appendChild(res);
    return box;
  }

  // ---- suggested-next-findings (assess().suggestions = plain finding keys) --
  function labelFor(key) {
    var gs = fg();
    for (var i = 0; i < gs.length; i++) { var fl = gs[i].fields || []; for (var j = 0; j < fl.length; j++) if (fl[j].key === key) return fl[j].label; }
    return String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, function (ch) { return ch.toUpperCase(); });
  }
  function renderSuggestChips(a, wrap) {
    // Only offer suggestions that are real boolean FIELD_GROUPS findings — engine
    // suggestions can include EXTRA_GROUPS-only keys (dyspnea, chestPain…) that
    // the wizard can't render/remove and that classicPayload would DROP, diverging
    // the Step 4/5 output from the differential. Intersect with the search index.
    var idx = {}; findIndex().forEach(function (f) { idx[f.key] = 1; });
    var keys = ((a && a.suggestions) || []).filter(function (k) { return idx[k] && !W.findings[k]; }).slice(0, 6);
    if (!keys.length) return;
    var box = el("div", "abxw-suggest");
    box.appendChild(el("div", "abxw-suggttl", ms("lightbulb") + "Suggested next findings"));
    var row = el("div", "abxw-chips");
    keys.forEach(function (k) { var b = el("button", "abxw-chip sug", ms("add") + esc(labelFor(k))); b.setAttribute("data-fkey", k); b.setAttribute("role", "button"); row.appendChild(b); });
    box.appendChild(row); wrap.appendChild(box);
  }

  // ---- confidence consistency: overwrite the classic quick-answer-card % with
  // the locked candidate's SMD_REASON score (the exact number Step 3 shows) ----
  function syncQuickCardConfidence() {
    try {
      var c = lockedCand(assess()); if (!c || c.confidence == null) return;
      var out = document.getElementById("outputArea"); if (!out) return;
      var items = out.querySelectorAll(".quick-answer-card .qa-item");
      for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector(".qa-label"), val = items[i].querySelector(".qa-value");
        if (lbl && val && /confidence/i.test(lbl.textContent)) { val.textContent = c.confidence + "%"; return; }
      }
      var grid = out.querySelector(".quick-answer-card .qa-grid"); // non-infective card has no Confidence row → add one
      if (grid) { var d = document.createElement("div"); d.className = "qa-item"; d.innerHTML = '<span class="qa-label">Confidence</span><span class="qa-value">' + c.confidence + '%</span>'; grid.appendChild(d); }
    } catch (e) {}
  }

  // ---- pinned red-flag emergency alert (time-critical syndromes) -----------
  function renderEmergency(wrap, host, c, isInf) {
    var lines = [];
    var sb = (host && host.querySelector(".safety-warning-banner")) || document.querySelector("#outputArea .safety-warning-banner");
    if (sb) { var t = (sb.textContent || "").replace(/^\s*[⚠️\s]*/, "").trim(); /* @emoji-ok strips a leading warning glyph from scraped text, not display */ if (t) lines.push(t); if (host && sb.parentNode && host.contains(sb)) sb.parentNode.removeChild(sb); }
    // Only infectious candidates carry TRUE emergency redFlags (decision.status==="red").
    // Non-infective candidates' redFlags are calm "when to worry" cautions (shown in
    // their own Red-flags card) — do NOT escalate them to a pulsing time-critical banner.
    if (isInf) ((c && c.redFlags) || []).forEach(function (r) { r = String(r || "").trim(); if (r && lines.indexOf(r) < 0) lines.push(r); });
    if (!lines.length) return;
    var box = el("div", "abxw-emergency"); box.setAttribute("role", "alert"); box.setAttribute("aria-live", "assertive");
    box.innerHTML = '<div class="abxw-emerg-hd">' + ms("emergency") + '<span class="abxw-emerg-ttl">Time-critical · act now</span><span class="abxw-emerg-dx">' + esc(c.name) + '</span></div>' +
      '<ul class="abxw-emerg-list">' + lines.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + '</ul>';
    wrap.insertBefore(box, wrap.firstChild);
  }

  // ---- text-size (A-/A+) via CSS zoom on the content wrappers, persisted ----
  var TS_KEY = "smd_abx_textscale", TS = [0.9, 1, 1.1, 1.2, 1.3, 1.4], tsIx = 1;
  function loadTS() { try { var i = TS.indexOf(parseFloat(localStorage.getItem(TS_KEY))); if (i >= 0) tsIx = i; } catch (e) {} }
  function applyTS() { if (!root) return; root.style.setProperty("--abxw-zoom", TS[tsIx]); var sl = root.querySelector(".abxw-tsrange"); if (sl && String(tsIx) !== sl.value) sl.value = String(tsIx); var pc = root.querySelector(".abxw-tspct"); if (pc) pc.textContent = Math.round(TS[tsIx] * 100) + "%"; }
  function saveTS() { try { localStorage.setItem(TS_KEY, String(TS[tsIx])); } catch (e) {} }

  // ---- resume (persist/restore wizard state, 12h TTL, ask-don't-force) ------
  var WSTATE_KEY = "smd_abx_wizard_state", WSTATE_TTL = 12 * 3600 * 1000, _resumeOffered = false, _pendingResume = null;
  function progress() { return anyFindings() || !!W.locked || W.step > 1; }
  function persistW() { try { if (!progress()) { localStorage.removeItem(WSTATE_KEY); return; } localStorage.setItem(WSTATE_KEY, JSON.stringify({ mode: W.mode, step: W.step, findings: W.findings, open: W.open, locked: W.locked, at: Date.now() })); } catch (e) {} }
  function loadW() { try { var d = JSON.parse(localStorage.getItem(WSTATE_KEY) || "null"); if (!d || !d.at || (Date.now() - d.at) > WSTATE_TTL) return null; return d; } catch (e) { return null; } }
  function clearW() { try { localStorage.removeItem(WSTATE_KEY); } catch (e) {} }

  function assess() {
    try { return (window.SMD_REASON && SMD_REASON.assess) ? SMD_REASON.assess(deriveRadios(W.findings)) : null; } catch (e) { return null; }
  }
  function lockedCand(a) {
    if (!W.locked || !a) return null;
    return a.infectious.concat(a.nonInfectious).filter(function (c) { return c.id === W.locked; })[0] || null;
  }

  // Split the wizard's findings into the classic engine's shape: boolean/radio/select
  // findings vs numeric vitals — so SMD_restoreCase renders the REAL full output.
  function classicPayload() {
    var src = deriveRadios(W.findings), f = {}, v = {};
    fg().forEach(function (g) {
      (g.fields || []).forEach(function (fl) {
        if (fl.type === "radio") return; // already expanded into booleans by deriveRadios
        var val = src[fl.key];
        if (val == null || val === "" || val === "none") return;
        if (fl.type === "number") v[fl.key] = val;
        else if (fl.type === "select") f[fl.key] = val;
        else f[fl.key] = true;
      });
    });
    // carry the derived cough booleans (not declared as bool fields in FIELD_GROUPS)
    if (src.cough) f.cough = true;
    if (src.productiveCough) f.productiveCough = true;
    if (src.dryCough) f.dryCough = true;
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
      if (renderNow && window.SMD_restoreCase) { var pay = classicPayload(); window.SMD_restoreCase(pay.f, W.locked, pay.v); syncQuickCardConfidence(); }
      var out = document.getElementById("outputArea");
      if (!out) return false;
      var kids = [].slice.call(out.children), moved = 0;
      kids.forEach(function (k) {
        var dec = isDecisionSection(k);
        if ((which === "decision") === dec) { host.appendChild(k); moved++; }
      });
      // BUG-03: the "Save this case?" box (#saveCasePrompt) is a SIBLING of #outputArea, so the
      // child-move above leaves it behind in the hidden classic layer under the wizard (z 12000) —
      // the confirm box renders but is invisible. Pull it into the Plan step so Save is reachable.
      if (which === "plan") {
        var scp = document.getElementById("saveCasePrompt");
        if (scp) { host.appendChild(scp); moved++; }
      }
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
        '<div class="abxw-brand"><span class="abxw-logo"><span class="abxw-logo-mark" aria-hidden="true"></span></span>' +
          '<div><div class="abxw-brandt">Steward<span>MD</span></div><div class="abxw-brands">Antibiotic decision engine · MARINAM UI</div></div></div>' +
        '<div class="abxw-headr">' +
          // BUG-08: removed the "MARINAM UI ⇄ Classic" toggle — MARINAM is the only UI now.
          '<div class="abxw-seg" role="tablist" aria-label="Mode">' +
            '<button class="abxw-segb" data-mode="simple" role="tab">' + ms("bolt") + 'Simple</button>' +
            '<button class="abxw-segb" data-mode="advanced" role="tab">' + ms("tune") + 'Advanced</button>' +
          '</div>' +
          '<div class="abxw-tswrap">' +
            '<button type="button" class="abxw-tsbtn" data-act="tstoggle" aria-label="Text size" aria-expanded="false">' + ms("format_size") + '</button>' +
            '<div class="abxw-tspop" hidden role="group" aria-label="Text size">' +
              '<span class="abxw-tspop-a abxw-tspop-sm" aria-hidden="true">A</span>' +
              '<input type="range" class="abxw-tsrange" min="0" max="5" step="1" value="1" data-ts-slider aria-label="Text size">' +
              '<span class="abxw-tspop-a abxw-tspop-lg" aria-hidden="true">A</span>' +
              '<span class="abxw-tspct">100%</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<nav class="abxw-stepper" role="tablist" aria-label="Progress"></nav>' +
      '<div class="abxw-body"></div>' +
      '<div class="abxw-policy abxw-policy-foot">' + ms("policy") +
        '<div class="abxw-policyt"><b>Hospital policy</b> · ICMR (National) · AMRSN 2024 <span class="abxw-rec">· Recommended</span></div>' +
        '<span class="abxw-pill">Educational aid</span></div>' +
      '</div></div>' +
      '<div class="abxw-nav"><div class="abxw-navin">' +
        '<button class="abxw-back" data-act="back">' + ms("arrow_back") + 'Back</button>' +
        '<button class="abxw-resetb" data-act="reset" aria-label="Reset case">' + ms("restart_alt") + '<span class="abxw-resetb-t">Reset</span></button>' +
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
    // any interaction outside the text-size control closes its slider popover
    var _pop = root.querySelector(".abxw-tspop");
    if (_pop && !_pop.hasAttribute("hidden") && !(t.closest && t.closest(".abxw-tswrap"))) {
      _pop.setAttribute("hidden", ""); var _tb = root.querySelector(".abxw-tsbtn"); if (_tb) _tb.setAttribute("aria-expanded", "false");
    }
    if (t.hasAttribute("data-mode")) { W.mode = t.getAttribute("data-mode"); W.open = null; render(); return; }
    var act = t.getAttribute("data-act");
    if (act === "reset") { W.step = 1; W.findings = {}; W.open = null; W.locked = null; W.query = ""; _pendingResume = null; _resumeOffered = true; clearW(); render(); return; }
    if (act === "close") { close(); return; }
    if (act === "toclassic") { // switch to CLASSIC UI: set pref, close, reopen Start Case (now not intercepted)
      try { localStorage.setItem("smd_abx_wizard", "0"); } catch (x) {}
      close();
      setTimeout(function () { var sc = document.querySelector('[data-act="startcase"]'); if (sc) sc.click(); }, 60);
      return;
    }
    if (act === "tstoggle") { // compact font button → reveals a small size slider
      var pop = root.querySelector(".abxw-tspop");
      if (pop) { var willOpen = pop.hasAttribute("hidden");
        if (willOpen) { pop.removeAttribute("hidden"); applyTS(); } else pop.setAttribute("hidden", "");
        t.setAttribute("aria-expanded", willOpen ? "true" : "false"); }
      return; }
    if (act === "resumeyes") { var s = loadW(); if (s) { W.mode = s.mode; W.step = s.step; W.findings = s.findings || {}; W.open = s.open; W.locked = s.locked; } _resumeOffered = true; _pendingResume = null; render(); return; }
    if (act === "resumeno") { clearW(); _resumeOffered = true; _pendingResume = null; W.step = 1; W.findings = {}; W.open = null; W.locked = null; W.query = ""; render(); return; }
    // any real work below means the user chose to continue, not resume → dismiss
    // the pending offer so persistW() starts saving the CURRENT case again.
    if (_pendingResume) { _pendingResume = null; _resumeOffered = true; }
    if (act === "back") { if (W.step > 1) { W.step--; render(); } else close(); return; }
    if (act === "next") { next(); return; }
    if (act === "stepdot") { var s = +t.getAttribute("data-step"); if (s <= maxStep()) { W.step = s; render(); } return; }
    if (t.hasAttribute("data-group")) { var gn = t.getAttribute("data-group"); W.open = (W.open === gn ? null : gn); render();
      // BUG-05: drill straight into the tapped system's findings — scroll the opened panel into
      // view (it renders below a tall system grid, so without this it looked like nothing happened).
      if (W.open) { setTimeout(function () { try { var pnl = root.querySelector(".abxw-panel"); if (pnl && pnl.scrollIntoView) pnl.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} }, 40); }
      return; }
    if (t.hasAttribute("data-fkey")) { var k = t.getAttribute("data-fkey"); var kon; if (W.findings[k]) { delete W.findings[k]; kon = false; } else { W.findings[k] = true; kon = true; }
      // BUG-01: in-place update — toggle the tapped chip + refresh dependent fragments (no .abxw-body wipe → no flicker)
      toggleChipVisual(t, kon); syncFindingsFragments(); return; }
    if (t.hasAttribute("data-radio")) { var rk = t.getAttribute("data-radio"); W.findings[rk] = t.getAttribute("data-val");
      // BUG-01: in-place update — pick this option, deselect siblings, refresh dependent fragments
      updateRadioGroup(rk); syncFindingsFragments(); return; }
    if (t.hasAttribute("data-lock")) { W.locked = t.getAttribute("data-lock"); W.step = 4; render(); return; }
    if (act === "groupnext") { openNextGroup(); return; }
    if (act === "clearall") { W.findings = {}; W.locked = null; render(); return; }
    if (act === "openref") { try { if (window.DX && DX.openRef) DX.openRef(t.getAttribute("data-ref")); } catch (x) {} return; }
    if (act === "openreasoning") { close(); setTimeout(function () { try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); } catch (x) {} }, 60); return; }  // close the wizard first so reasoning (z-index 850) isn't hidden behind the overlay (z 12000)
  }
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-ts-slider")) { tsIx = Math.max(0, Math.min(TS.length - 1, parseInt(t.value, 10) || 0)); applyTS(); saveTS(); return; }
    if (t.hasAttribute && (t.hasAttribute("data-search") || t.hasAttribute("data-num")) && _pendingResume) { _pendingResume = null; _resumeOffered = true; }
    if (t.hasAttribute && t.hasAttribute("data-search")) { // live-filter WITHOUT a full render (keeps focus)
      W.query = t.value;
      var res = document.getElementById("abxwFindResults");
      if (res) res.innerHTML = findResultsHTML();
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-num")) {
      var k = t.getAttribute("data-num");
      var val = t.value;
      // BUG-03: hard-limit GCS to 3–15 (reject out-of-range, e.g. 20 → 15).
      if (k === "gcs" && val !== "" && val != null) {
        var gv = parseInt(val, 10);
        if (!isNaN(gv)) {
          if (gv > 15) gv = 15;
          if (gv < 3 && String(val).length >= 2) gv = 3;   // allow single-digit typing toward 15
          if (String(gv) !== String(val)) { val = String(gv); t.value = val; }
        }
      }
      if (val === "" || val == null) delete W.findings[k]; else W.findings[k] = val;
      if (k === "map") W._mapEdited = (val !== "" && val != null);   // manual override wins
      // BUG-02: auto-populate MAP = DBP + (SBP − DBP)/3 once both BP values exist (still editable).
      if ((k === "sbp" || k === "dbp") && !W._mapEdited) {
        var _s = parseFloat(W.findings.sbp), _d = parseFloat(W.findings.dbp);
        if (!isNaN(_s) && !isNaN(_d) && _s >= _d) {
          var _m = Math.round(_d + (_s - _d) / 3);
          W.findings.map = String(_m);
          try { var mi = root.querySelector('[data-num="map"]'); if (mi) mi.value = _m; } catch (e) {}
        }
      }
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
    // was the search box focused before we rebuild? only then do we restore focus,
    // so tapping an unrelated chip / hitting Back doesn't yank the keyboard open.
    var ae = document.activeElement;
    var searchWasActive = !!(ae && ae.classList && ae.classList.contains("abxw-find-input"));
    var body = root.querySelector(".abxw-body");
    // RESCUE the persistent #saveCasePrompt node before wiping the body. Once the Plan step has
    // moved it INTO the body, `body.innerHTML=""` on any re-render (navigate away+back, chip toggle)
    // would destroy it permanently and the Save box would never return. Park it back on #outputArea
    // (its natural home, hidden behind the wizard) so it survives; renderPlan re-homes + re-shows it.
    try { var _scp = document.getElementById("saveCasePrompt"); if (_scp && body.contains(_scp)) { var _oa = document.getElementById("outputArea"); if (_oa) _oa.appendChild(_scp); } } catch (e) {}
    body.innerHTML = "";
    if (_pendingResume && !_resumeOffered) body.appendChild(resumeBar());
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
    // keep focus in the search box across the click-driven re-render — only if the
    // user was actually typing there (not on an unrelated tap / Back navigation).
    if (searchWasActive && W.query && (W.step === 1 || W.step === 2)) {
      var si = root.querySelector(".abxw-find-input");
      if (si && document.activeElement !== si) setTimeout(function () { try { si.focus(); var n = si.value.length; si.setSelectionRange(n, n); } catch (e) {} }, 0);
    }
    if (!_pendingResume) persistW(); // don't clobber the saved case while a resume offer is pending
  }
  function resumeBar() {
    var s = _pendingResume || {};
    var bar = el("div", "abxw-resume");
    bar.innerHTML = '<span class="rds-icon abx-ms" aria-hidden="true">history</span>' +
      '<div class="abxw-resume-txt">Resume your previous case? <span>step ' + (s.step || 1) + (s.locked ? ' · diagnosis locked' : '') + '</span></div>' +
      '<button class="abxw-resume-yes" data-act="resumeyes">Resume</button>' +
      '<button class="abxw-resume-no" data-act="resumeno">Start fresh</button>';
    return bar;
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

  // ---- in-place fragment builders + no-flicker update path (BUG-01) --------
  // Tapping a finding chip used to call render(), which wipes .abxw-body and
  // rebuilds the whole step (search box + system grid + panel + hints) on every
  // tap → a full-screen "refresh" flicker. Instead we toggle the tapped control
  // in place and refresh ONLY the fragments that depend on the selected set,
  // mirroring the existing no-full-render pattern used by the search box and the
  // numeric inputs. render() stays unchanged for step/mode changes.
  function buildSelCard() {
    var sel = selectedChips();
    if (!sel.length) return null;
    var sc = el("div", "abxw-selcard");
    sc.innerHTML = '<div class="abxw-selhead"><span class="abxw-lbl">Selected findings (' + sel.length + ')</span><button class="abxw-clear" data-act="clearall">Clear all</button></div>';
    var row = el("div", "abxw-selrow");
    sel.forEach(function (s) { var c = el("button", "abxw-selchip", s.label + ms("close")); c.setAttribute("data-fkey", s.key); row.appendChild(c); });
    sc.appendChild(row);
    return sc;
  }
  function buildLiveHint(a) {
    var top = a && (a.infectious[0] || a.nonInfectious[0]);
    if (!top) return null;
    return el("div", "abxw-livehint", ms("stacked_line_chart") + '<span>Live differential: <b>' + esc(top.name) + '</b> · ' + top.confidence + '%. Continue to review.</span>');
  }
  // Flip one toggle-chip's visual state (leading check/add icon + on class +
  // aria) with no re-render. Guarded to real chips — the summary "remove"
  // selchips (trailing "close" icon) are excluded and get rebuilt via buildSelCard.
  function toggleChipVisual(btn, on) {
    if (!btn || !btn.classList || !btn.classList.contains("abxw-chip")) return;
    btn.classList.toggle("on", on);
    var ic = btn.querySelector(".abx-ms"); if (ic) ic.textContent = on ? "check" : "add";
    if (btn.getAttribute("role") === "checkbox") btn.setAttribute("aria-checked", on ? "true" : "false");
  }
  // Radio/select option chosen: mark the picked option on, its siblings off.
  function updateRadioGroup(key) {
    var wrap = root.querySelector(".abxw-step-body"); if (!wrap) return;
    var chosen = W.findings[key];
    wrap.querySelectorAll("[data-radio]").forEach(function (o) {
      if (o.getAttribute("data-radio") !== key) return;
      var on = o.getAttribute("data-val") === chosen;
      o.classList.toggle("on", on);
      var ic = o.querySelector(".abx-ms"); if (ic) ic.textContent = on ? "check" : "add";
      o.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  // Update only the stepper's reachable ("off") state — no innerHTML rebuild.
  function syncStepperReach() {
    var mx = maxStep();
    root.querySelectorAll(".abxw-step").forEach(function (b) {
      var n = +b.getAttribute("data-step");
      b.classList.toggle("off", !(n <= Math.max(W.step, mx)));
    });
  }
  // Refresh every findings-view fragment that depends on the selected set,
  // WITHOUT tearing down .abxw-body. If the step body is somehow absent, fall
  // back to a full render rather than leaving stale UI.
  function syncFindingsFragments() {
    var wrap = root.querySelector(".abxw-step-body");
    if (!wrap) { render(); return; }
    // a stale resume offer is dismissed the moment the user edits findings
    var rb = root.querySelector(".abxw-resume"); if (rb && !_pendingResume && rb.parentNode) rb.parentNode.removeChild(rb);
    // selected-findings summary card (insert / replace / remove before pick title)
    var oldSel = wrap.querySelector(".abxw-selcard");
    var newSel = buildSelCard();
    if (oldSel) { if (newSel) oldSel.parentNode.replaceChild(newSel, oldSel); else oldSel.parentNode.removeChild(oldSel); }
    else if (newSel) { var pickttl = wrap.querySelector(".abxw-pickttl"); if (pickttl) pickttl.parentNode.insertBefore(newSel, pickttl); else wrap.appendChild(newSel); }
    // system-grid "N selected" captions + active state (all boxes, so cross-group
    // toggles from search/suggestion chips stay in sync too)
    wrap.querySelectorAll(".abxw-sysbox").forEach(function (box) {
      var gn = box.getAttribute("data-group"), g = groupByName(gn), c = g ? selectedCount(g) : 0;
      var cap = box.querySelector(".abxw-syscap"); if (cap) cap.textContent = c > 0 ? c + " selected" : "Tap to open";
      var active = W.open === gn; box.classList.toggle("active", active); box.setAttribute("aria-pressed", active ? "true" : "false");
    });
    // open panel header count
    if (W.open) {
      var g2 = groupByName(W.open), panelh = wrap.querySelector(".abxw-panel .abxw-panelh");
      if (g2 && panelh) { var c2 = selectedCount(g2); panelh.innerHTML = ms(iconFor(g2.group)) + '<h3>' + g2.group + '</h3>' + (c2 > 0 ? '<span class="abxw-count">' + c2 + '</span>' : ""); }
    }
    // findings-search results on/off (only when a query is active)
    var res = document.getElementById("abxwFindResults");
    if (res && (W.query || "").trim().length >= 2) res.innerHTML = findResultsHTML();
    // footer: live differential hint + suggested-next-findings (rebuild in order)
    var oldLh = wrap.querySelector(".abxw-livehint"); if (oldLh && oldLh.parentNode) oldLh.parentNode.removeChild(oldLh);
    var oldSug = wrap.querySelector(".abxw-suggest"); if (oldSug && oldSug.parentNode) oldSug.parentNode.removeChild(oldSug);
    if (anyFindings()) { var a = assess(); var lh = buildLiveHint(a); if (lh) wrap.appendChild(lh); renderSuggestChips(a, wrap); }
    // nav "next" enabled state + stepper reachability + persist (as render() does)
    var nx = root.querySelector(".abxw-next"); if (nx) { nx.disabled = !nextAllowed(); nx.style.opacity = nextAllowed() ? "1" : ".4"; }
    syncStepperReach();
    if (!_pendingResume) persistW();
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

    // Advanced is the default (full detail). Gently point new users to the shorter,
    // guided Simple mode — tapping the chip flips the mode (data-mode handled in onClick).
    if (!isSimple) {
      var hint = el("div", "abxw-modehint");
      hint.innerHTML = ms("lightbulb") +
        '<span class="abxw-modehint-t">Advanced shows <b>every</b> finding. New here, or want a faster guided path?</span>' +
        '<button type="button" class="abxw-modehint-b" data-mode="simple">' + ms("bolt") + 'Switch to Simple</button>';
      wrap.appendChild(hint);
    }

    // fast findings search (typeahead over the full ontology — reaches curated-hidden findings too)
    wrap.appendChild(renderFindSearch());

    // selected summary
    var scEl = buildSelCard();
    if (scEl) wrap.appendChild(scEl);

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

    // live differential hint + suggested-next-findings
    if (anyFindings()) {
      var a = assess();
      var lh = buildLiveHint(a); if (lh) wrap.appendChild(lh);
      renderSuggestChips(a, wrap);
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

    // select fields (Sex, grades) → tappable option chips (BUG-01 / BUG-04). Reuse the radio
    // click path (data-radio/data-val → onClick stores W.findings[key]=val). Shown in every mode.
    selectFields(g).forEach(function (f) {
      var wrapf = el("div", "abxw-radiowrap");
      wrapf.appendChild(el("div", "abxw-radiolbl", esc(f.label)));
      var rr = el("div", "abxw-radiorow");
      (f.selectOptions || f.options || []).forEach(function (o) {
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
            if (f.key === "gcs") { inp.min = 3; inp.max = 15; inp.step = 1; }   // BUG-03: clamp GCS 3–15
            if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max;
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

  // AI / clinician-responsibility notice — shown on Decision + Plan so the treating clinician stays
  // accountable for the final call. Rule-assisted engine; app-facing copy (no em-dash).
  function aiDisclaimer() {
    var d = el("div", "abxw-aidisc",
      '<span class="rds-icon abx-ms" aria-hidden="true" style="flex:0 0 auto;font-size:19px;color:var(--amber,#92620a);margin-top:1px">smart_toy</span>' +
      '<div><b>AI-assisted decision support, not a diagnosis.</b> The treating clinician is responsible for the final ' +
      'diagnosis, drug choice, dose, and monitoring. Verify against the local antibiogram, allergies, renal and hepatic ' +
      'function, weight, and interactions before prescribing.</div>');
    d.style.cssText = "display:flex;gap:9px;align-items:flex-start;margin:0 0 14px;padding:11px 13px;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);border-radius:12px;font:500 12.5px var(--font,system-ui);color:var(--slate,#2d4356);line-height:1.45";
    return d;
  }

  // Step 4 — Decision: Quick Decision + Why + Toxicity + Severity + Syndrome + Pathogens
  // (the REAL engine sections, split out of #outputArea; renders it fresh here).
  function renderDecision() {
    var wrap = el("div", "abxw-step-body");
    var a = assess(); var c = lockedCand(a);
    if (!a || !c) { wrap.appendChild(el("div", "abxw-empty dash", ms("rule") + '<p>Lock a diagnosis from the differential to see the decision.</p>')); return wrap; }
    wrap.appendChild(el("h2", "abxw-secttl", ms("gavel") + "Clinical decision"));
    wrap.appendChild(aiDisclaimer());
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
    renderEmergency(wrap, host, c, a.infectious.some(function (x) { return x.id === c.id; })); // pin time-critical red-flags
    // BUG-08: Clinical Reasoning is now reachable from MARINAM (previously only in the old UI).
    var crBtn = el("button", "abxw-crbtn", ms("neurology") + "Open Clinical Reasoning");
    crBtn.setAttribute("data-act", "openreasoning");
    crBtn.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:14px;padding:13px 14px;border:1.5px solid var(--primary,#0e6e63);background:var(--primary-soft,#e3f1ee);color:var(--primary,#0e6e63);border-radius:12px;font:700 14px var(--font,system-ui);cursor:pointer";
    wrap.appendChild(crBtn);
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
    wrap.appendChild(aiDisclaimer());
    var host = el("div", "abxw-fullout"); wrap.appendChild(host);
    // render fresh (in case Decision wasn't visited this session), then take Plan sections
    var ok = distributeOutput(host, "plan", true);
    if (!ok) {
      host.appendChild(el("div", "abxw-why", '<div class="abxw-lbl">Why</div><p>' + esc(c.reason || "") + '</p>'));
      var ref = el("button", "abxw-openref primary", ms("open_in_new") + "Open full treatment reference"); ref.setAttribute("data-act", "openref"); ref.setAttribute("data-ref", c.treatmentRef || c.id);
      host.appendChild(ref);
    }
    renderEmergency(wrap, host, c, a.infectious.some(function (x) { return x.id === c.id; })); // keep the alert on Plan too
    return wrap;
  }

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- open / close --------------------------------------------------------
  function open(mode) {
    if (!root) build();
    loadTS(); applyTS();
    // offer to resume a recent in-progress case (ask, don't force) — only when
    // this is a fresh session (no findings entered yet).
    var saved = loadW();
    _pendingResume = (saved && !progress()) ? saved : null;
    _resumeOffered = false;
    if (mode && !_pendingResume) W.mode = mode;
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

  // DEFAULT ON (MARINAM wizard). Start Case opens the MARINAM wizard unless the
  // user has explicitly opted into the FULL classic engine (complete stewardship
  // console, weight-band regimen, patient-specific renal/hepatic/cardiac safety,
  // alternatives). Opt OUT of the wizard: ?abxwiz=0 or localStorage
  // smd_abx_wizard="0" (the in-UI MARINAM⇄CLASSIC toggle is the source of truth).
  // UI preference (checked at CLICK time so the MARINAM⇄CLASSIC toggle takes
  // effect immediately, no reload): MARINAM (wizard) by default — CLASSIC (the
  // app's own engine) only when ?abxwiz=0 or localStorage smd_abx_wizard==="0".
  // ?abxwiz=1/0 SEEDS the persistent pref once (so the in-UI toggle, which writes
  // localStorage, is the source of truth thereafter and works both ways).
  try {
    if (/[?&]abxwiz=1\b/.test(location.search || "")) localStorage.setItem("smd_abx_wizard", "1");
    else if (/[?&]abxwiz=0\b/.test(location.search || "")) localStorage.setItem("smd_abx_wizard", "0");
  } catch (e) {}
  function wizPrefOn() {
    // BUG-08: MARINAM is now the ONLY UI — the Classic toggle was removed, so Start Case always
    // opens the MARINAM wizard (ignore any legacy "smd_abx_wizard=0" a tester may have set).
    return true;
  }
  window.ABX_WIZARD.setUI = function (which) { try { localStorage.setItem("smd_abx_wizard", which === "marinam" ? "1" : "0"); } catch (e) {} };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-act="startcase"]');
    if (!b) return;
    if (!wizPrefOn()) return;                                 // CLASSIC UI → let the app handle Start Case
    if (!window.FIELD_GROUPS || !window.SMD_REASON) return;   // engine not ready → let the app handle it
    e.preventDefault(); e.stopPropagation();
    open();
  }, true);
})();
