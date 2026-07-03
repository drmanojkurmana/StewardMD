/* StewardMD — Medication list builder. Exposes window.MEDLIST.
   Deterministic parsing only (no AI). Keeps original text until the clinician
   confirms an uncertain drug mapping. */
(function () {
  "use strict";
  var FORM_PREFIX = { t: "tablet", tab: "tablet", tabs: "tablet", cap: "capsule", caps: "capsule",
    inj: "injection", syp: "syrup", syr: "syrup", susp: "suspension", drop: "drops", oint: "ointment",
    neb: "nebulisation", inh: "inhaler" };
  var ROUTES = { iv: "IV", po: "PO", oral: "PO", im: "IM", sc: "SC", sl: "SL", pr: "PR",
    inh: "INH", neb: "NEB", top: "TOP", topical: "TOP", ng: "NG" };
  var FREQ = { od: "OD", bd: "BD", bid: "BD", tds: "TDS", tid: "TDS", qid: "QID", qds: "QID",
    hs: "HS", sos: "SOS", stat: "STAT", "q6h": "Q6H", "q8h": "Q8H", "q12h": "Q12H", qd: "OD",
    morning: "OD", night: "HS", "once daily": "OD", "twice daily": "BD" };
  var UNIT_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?|%)(?![a-z])/i;
  var BARE_NUM_RE = /\b(\d+(?:\.\d+)?)\b/;

  // High-confidence deterministic brand->generic seeds (extend as needed).
  var BRAND_SEED = {
    ecosprin: "aspirin", pan: "pantoprazole", augmentin: "amoxicillin + clavulanate",
    clopilet: "clopidogrel", lasix: "furosemide", piptaz: "piperacillin + tazobactam",
    "pan-d": "pantoprazole + domperidone", monocef: "ceftriaxone"
  };
  function brandCandidates(name) {
    if (!name) return [];
    var n = name.toLowerCase().trim(), out = [];
    // BRAND_SEED is checked/listed before formulary hits intentionally — seed precedence
    // is deliberate (fast, hand-curated matches take priority), not a bug.
    if (BRAND_SEED[n]) out.push({ brand: name, generic: BRAND_SEED[n] });
    // formulary aliases (window.MEDDRUGS: {generic, brands:[...]})
    try {
      // MEDDRUGS is a facade object ({match, findByName, ..., _list}), not an array —
      // the actual drug array lives at MEDDRUGS._list.
      ((window.MEDDRUGS && window.MEDDRUGS._list) || []).forEach(function (d) {
        if ((d.brands || []).some(function (b) { return b.toLowerCase() === n; }))
          out.push({ brand: name, generic: d.generic.toLowerCase() });
      });
    } catch (_) {}
    // dedupe by generic
    var seen = {}; return out.filter(function (c) { if (seen[c.generic]) return false; seen[c.generic] = 1; return true; });
  }
  function isKnownGeneric(n) {
    n = (n || "").toLowerCase();
    // MEDDRUGS is a facade object, not an array — the actual drug array lives at MEDDRUGS._list.
    try { return ((window.MEDDRUGS && window.MEDDRUGS._list) || []).some(function (d) { return d.generic.toLowerCase() === n; }); } catch (_) { return false; }
  }
  function resolveGeneric(out) {
    var n = out.name;
    if (!n) { out.confidence = "low"; return out; }
    if (isKnownGeneric(n)) { out.generic = n.toLowerCase(); out.confidence = "high"; return out; }
    var cands = brandCandidates(n);
    if (cands.length === 1) {
      // Combination products must require clinician confirmation, not auto-map.
      if (cands[0].generic.indexOf(" + ") !== -1) {
        out.generic = null; out.confidence = "medium"; out.candidates = cands; return out;
      }
      out.generic = cands[0].generic; out.confidence = "high"; out.candidates = cands; return out;
    }
    if (cands.length > 1) { out.generic = null; out.confidence = "medium"; out.candidates = cands; return out; }
    // unknown: keep raw, low confidence, no silent mapping
    out.generic = null; out.confidence = "low"; out.candidates = [];
    return out;
  }

  function tokens(s) { return s.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean); }

  function parseEntry(text) {
    var raw = (text || "").trim();
    var out = { raw: raw, name: null, generic: null, strength: null, unit: null, form: null,
      route: null, freq: null, freqText: null, confidence: "low", candidates: [] };
    if (!raw) return out;
    var toks = tokens(raw), rest = [];
    // form prefix (first token)
    if (toks.length && FORM_PREFIX[toks[0]]) { out.form = FORM_PREFIX[toks[0]]; toks = toks.slice(1); }
    // strength (with unit if present; falls back to a bare number, e.g. "metformin 500 bd")
    var m = raw.match(UNIT_RE);
    if (m) { out.strength = parseFloat(m[1]); out.unit = m[2].toLowerCase().replace(/s$/, ""); }
    else { var bm = raw.match(BARE_NUM_RE); if (bm) out.strength = parseFloat(bm[1]); }
    // route + freq + strip numerics/units; remaining tokens = drug name
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (ROUTES[tk]) { out.route = ROUTES[tk]; continue; }
      if (FREQ[tk]) { out.freq = FREQ[tk]; out.freqText = tk; continue; }
      if (/^\d/.test(tk) || /^(mg|mcg|g|ml|iu|units?|%)$/.test(tk)) continue;
      rest.push(tk);
    }
    out.name = rest.join(" ").trim() || null;
    // form from injection route default
    if (!out.form && out.route === "IV") out.form = "injection";
    resolveGeneric(out);
    return out;
  }

  function parsePasted(text) {
    return (text || "").split(/\r?\n/)
      .map(function (l) { return l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim(); })
      .filter(Boolean)
      .map(parseEntry);
  }

  // --- Medication list state (add/remove/undo/clear), session-scoped. ---
  var _list = [], _lastRemoved = null, _seq = 1;
  function _persist() { try { sessionStorage.setItem("smd_medlist", JSON.stringify(_list)); } catch (_) {} }
  function _load() { try { _list = JSON.parse(sessionStorage.getItem("smd_medlist") || "[]") || []; } catch (_) { _list = []; } }
  function add(entry, source) {
    var id = "m" + (_seq++) + "_" + Date.now();
    var med = Object.assign({ id: id, brand: null, indication: null, startDate: null, source: source || "manual" }, entry);
    _list.push(med); _persist(); return id;
  }
  function remove(id) { var i = _list.findIndex(function (m) { return m.id === id; }); if (i >= 0) { _lastRemoved = { med: _list[i], i: i }; _list.splice(i, 1); _persist(); } }
  function undoRemove() { if (_lastRemoved) { _list.splice(_lastRemoved.i, 0, _lastRemoved.med); _lastRemoved = null; _persist(); } }
  function clearAll() { _list = []; _lastRemoved = null; _persist(); }
  function getList() { return _list.slice(); }
  _load();

  // --- Drug Index search (worker API) ---
  function brandSearch(q) {
    return fetch("https://api.stewardmd.in/brand-search?q=" + encodeURIComponent(q) + "&limit=10")
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j.results || []).map(function (r) {
        return { brand: r.brand, generic: (r.composition || "").toLowerCase(), form: r.form }; }); })
      .catch(function () { return []; });
  }

  // --- UI: mount(containerEl) renders the medication-list-builder screen. ---
  var _root = null;             // mounted container element
  var _openAdd = null;          // which add-option panel is open: null|'index'|'manual'|'paste'
  var _undoTimer = null;        // pending inline-undo timer id
  var _undoingId = null;        // id currently showing an inline Undo row
  var _manualState = { value: "", parsed: null };
  var _indexState = { value: "", results: [], reqSeq: 0 };
  var _pasteState = { value: "", rows: [] }; // rows: [{entry, include}]

  function el(tag, opts) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) e.className = opts.cls;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.attrs) for (var k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    if (opts.disabled) e.disabled = true;
    if (opts.type) e.type = opts.type;
    if (opts.placeholder) e.placeholder = opts.placeholder;
    return e;
  }

  function fieldLine(med) {
    var parts = [];
    if (med.form) parts.push(med.form);
    if (med.route) parts.push(med.route);
    if (med.strength != null) parts.push(String(med.strength) + (med.unit ? " " + med.unit : ""));
    if (med.freq) parts.push(med.freq);
    return parts.join(" · ");
  }

  function clearUndoTimer() { if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; } }

  function renderMedCard(med) {
    var card = el("div", { cls: "ml-card", attrs: { "data-ml-card": med.id } });

    if (_undoingId === med.id) {
      card.classList.add("ml-card-removed");
      var row = el("div", { cls: "ml-undo-row" });
      row.appendChild(el("span", { text: (med.generic || med.raw || "Medicine") + " removed" }));
      var undoBtn = el("button", { cls: "ml-undo-btn", text: "Undo", attrs: { "data-ml-undo": med.id } });
      undoBtn.addEventListener("click", function () {
        clearUndoTimer(); _undoingId = null; undoRemove(); render();
      });
      row.appendChild(undoBtn);
      card.appendChild(row);
      return card;
    }

    var main = el("div", { cls: "ml-card-main" });
    var title = el("div", { cls: "ml-card-title", text: med.generic || med.raw || "Unnamed" });
    main.appendChild(title);
    if (med.brand) main.appendChild(el("div", { cls: "ml-card-brand", text: med.brand }));
    var line = fieldLine(med);
    if (line) main.appendChild(el("div", { cls: "ml-card-line", text: line }));
    var meta = el("div", { cls: "ml-card-meta" });
    meta.appendChild(el("span", { cls: "ml-source-badge", text: (med.source || "manual") }));
    if (med.source === "scan" && med.confidence) meta.appendChild(el("span", { cls: "ml-conf-badge", text: med.confidence }));
    main.appendChild(meta);
    card.appendChild(main);

    var actions = el("div", { cls: "ml-card-actions" });
    var editBtn = el("button", { cls: "ml-icon-btn", text: "Edit", attrs: { "data-ml-edit": med.id } });
    editBtn.addEventListener("click", function () {
      _openAdd = "manual"; _manualState.value = med.raw || med.generic || "";
      _manualState.parsed = parseEntry(_manualState.value);
      remove(med.id); render();
    });
    var removeBtn = el("button", { cls: "ml-icon-btn ml-remove-btn", text: "Remove", attrs: { "data-ml-remove": med.id } });
    removeBtn.addEventListener("click", function () {
      remove(med.id); _undoingId = med.id; render();
      clearUndoTimer();
      _undoTimer = setTimeout(function () { if (_undoingId === med.id) _undoingId = null; _undoTimer = null; render(); }, 5000);
    });
    actions.appendChild(editBtn); actions.appendChild(removeBtn);
    card.appendChild(actions);
    return card;
  }

  function renderCandidateChips(container, candidates, onPick) {
    var wrap = el("div", { cls: "ml-dym" });
    wrap.appendChild(el("div", { cls: "ml-dym-label", text: "Did you mean?" }));
    var chips = el("div", { cls: "ml-dym-chips" });
    candidates.forEach(function (c) {
      var chip = el("button", { cls: "ml-chip", text: c.generic });
      chip.addEventListener("click", function () { onPick(c); });
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    container.appendChild(wrap);
  }

  function renderAddOptions(container) {
    var row = el("div", { cls: "ml-add-row" });
    var btnIndex = el("button", { cls: "ml-add-btn", text: "Search Drug Index", attrs: { "data-ml-open": "index" } });
    var btnManual = el("button", { cls: "ml-add-btn", text: "Type manually", attrs: { "data-ml-open": "manual" } });
    var btnPaste = el("button", { cls: "ml-add-btn", text: "Paste list", attrs: { "data-ml-open": "paste" } });
    var btnScan = el("button", { cls: "ml-add-btn ml-add-btn-disabled", text: "Scan (Coming soon)", disabled: true, attrs: { "data-ml-scan": "1" } });
    var btnWard = el("button", { cls: "ml-add-btn ml-add-btn-disabled", text: "Fetch from Ward Sync (Coming soon)", disabled: true, attrs: { "data-ml-wardsync": "1" } });
    [btnIndex, btnManual, btnPaste].forEach(function (b) {
      b.addEventListener("click", function () {
        var which = b.getAttribute("data-ml-open");
        _openAdd = (_openAdd === which) ? null : which;
        render();
      });
    });
    row.appendChild(btnIndex); row.appendChild(btnManual); row.appendChild(btnPaste);
    row.appendChild(btnScan); row.appendChild(btnWard);
    container.appendChild(row);

    if (_openAdd === "index") container.appendChild(renderIndexPanel());
    else if (_openAdd === "manual") container.appendChild(renderManualPanel());
    else if (_openAdd === "paste") container.appendChild(renderPastePanel());
  }

  function renderIndexPanel() {
    var panel = el("div", { cls: "ml-panel" });
    var input = el("input", { cls: "ml-input", type: "text", placeholder: "Search brand or generic…",
      attrs: { "data-ml-index-input": "1" } });
    input.value = _indexState.value;
    input.addEventListener("input", function () {
      _indexState.value = input.value;
      var q = input.value.trim();
      var seq = ++_indexState.reqSeq;
      if (!q) { _indexState.results = []; render(); return; }
      window.MEDLIST.brandSearch(q).then(function (res) {
        if (seq !== _indexState.reqSeq) return; // stale response
        _indexState.results = res || [];
        render();
      });
    });
    panel.appendChild(input);
    var results = el("div", { cls: "ml-index-results" });
    _indexState.results.forEach(function (r) {
      var item = el("button", { cls: "ml-index-result", attrs: { "data-ml-index-result": "1" } });
      item.appendChild(el("span", { cls: "ml-index-result-brand", text: r.brand || "" }));
      if (r.generic) item.appendChild(el("span", { cls: "ml-index-result-generic", text: r.generic }));
      item.addEventListener("click", function () {
        var parsed = parseEntry(r.generic || r.brand || "");
        parsed.brand = r.brand || null;
        if (r.form) parsed.form = r.form;
        if (r.generic) { parsed.generic = r.generic; parsed.confidence = "high"; }
        add(parsed, "index");
        _indexState = { value: "", results: [], reqSeq: _indexState.reqSeq };
        _openAdd = null;
        render();
      });
      results.appendChild(item);
    });
    panel.appendChild(results);
    return panel;
  }

  function renderManualPanel() {
    var panel = el("div", { cls: "ml-panel" });
    var input = el("input", { cls: "ml-input", type: "text", placeholder: "e.g. metformin 500 bd",
      attrs: { "data-ml-manual-input": "1" } });
    input.value = _manualState.value;
    input.addEventListener("input", function () {
      _manualState.value = input.value;
      _manualState.parsed = input.value.trim() ? parseEntry(input.value) : null;
      render();
    });
    panel.appendChild(input);

    var addBtn = el("button", { cls: "ml-panel-add-btn", text: "Add", attrs: { "data-ml-manual-add": "1" } });
    addBtn.addEventListener("click", function () {
      var v = _manualState.value.trim();
      if (!v) return;
      add(parseEntry(v), "manual");
      _manualState = { value: "", parsed: null };
      _openAdd = null;
      render();
    });
    panel.appendChild(addBtn);

    var parsed = _manualState.parsed;
    if (parsed && parsed.confidence !== "high" && parsed.candidates && parsed.candidates.length) {
      renderCandidateChips(panel, parsed.candidates, function (c) {
        var p = Object.assign({}, parsed, { generic: c.generic, confidence: "high" });
        add(p, "manual");
        _manualState = { value: "", parsed: null };
        _openAdd = null;
        render();
      });
    }
    return panel;
  }

  function renderPastePanel() {
    var panel = el("div", { cls: "ml-panel" });
    var textarea = el("textarea", { cls: "ml-textarea", placeholder: "Paste a medication list, one per line…",
      attrs: { "data-ml-paste-input": "1" } });
    textarea.value = _pasteState.value;
    textarea.addEventListener("input", function () {
      _pasteState.value = textarea.value;
      var parsedList = _pasteState.value.trim() ? parsePasted(_pasteState.value) : [];
      _pasteState.rows = parsedList.map(function (entry) { return { entry: entry, include: true }; });
      render();
    });
    panel.appendChild(textarea);

    if (_pasteState.rows.length) {
      var list = el("div", { cls: "ml-paste-list" });
      _pasteState.rows.forEach(function (row, idx) {
        var item = el("label", { cls: "ml-paste-item", attrs: { "data-ml-paste-item": String(idx) } });
        var cb = el("input", { type: "checkbox" });
        cb.checked = row.include;
        cb.addEventListener("change", function () { row.include = cb.checked; });
        item.appendChild(cb);
        item.appendChild(el("span", { text: row.entry.generic || row.entry.raw || "Unnamed" }));
        list.appendChild(item);
      });
      panel.appendChild(list);

      var addBtn = el("button", { cls: "ml-panel-add-btn", text: "Add selected", attrs: { "data-ml-paste-add": "1" } });
      addBtn.addEventListener("click", function () {
        _pasteState.rows.forEach(function (row) { if (row.include) add(row.entry, "paste"); });
        _pasteState = { value: "", rows: [] };
        _openAdd = null;
        render();
      });
      panel.appendChild(addBtn);
    }
    return panel;
  }

  function render() {
    if (!_root) return;
    _root.textContent = "";
    _root.classList.add("ml-root");

    var header = el("div", { cls: "ml-header" });
    header.appendChild(el("h2", { cls: "ml-title", text: "Drug Interactions" }));
    header.appendChild(el("p", { cls: "ml-subtitle", text: "Check medicines, duplicates, and high-risk combinations" }));
    header.appendChild(el("div", { cls: "ml-advisory",
      text: "Clinical decision support — verify with current local protocol and pharmacist where needed" }));
    _root.appendChild(header);

    var body = el("div", { cls: "ml-body" });
    var cards = el("div", { cls: "ml-cards", attrs: { id: "ml-cards" } });
    var list = getList();
    var showUndoRow = _undoingId && _lastRemoved && _lastRemoved.med && _lastRemoved.med.id === _undoingId;
    if (!list.length && !showUndoRow) {
      cards.appendChild(el("div", { cls: "ml-empty", text: "Add medicines to check interactions" }));
    } else {
      if (showUndoRow) cards.appendChild(renderMedCard(_lastRemoved.med));
      list.forEach(function (med) { cards.appendChild(renderMedCard(med)); });
    }
    body.appendChild(cards);
    renderAddOptions(body);
    _root.appendChild(body);

    var footer = el("div", { cls: "ml-footer" });
    var checkBtn = el("button", { cls: "ml-check-btn", text: "Check interactions", disabled: true, attrs: { id: "ml-check" } });
    footer.appendChild(checkBtn);
    _root.appendChild(footer);
  }

  function injectStyles() {
    if (document.getElementById("ml-styles")) return;
    var css = ".ml-root{display:flex;flex-direction:column;height:100%;font-family:var(--sans,system-ui);color:var(--ink,#1a1a1a)}"
      + ".ml-header{padding:16px 18px 10px}.ml-title{margin:0 0 2px;font:800 19px var(--sans,system-ui)}"
      + ".ml-subtitle{margin:0 0 10px;font:500 13px var(--sans,system-ui);color:var(--slate,#666)}"
      + ".ml-advisory{font:600 11.5px var(--sans,system-ui);background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:9px;padding:8px 11px;line-height:1.4}"
      + ".ml-body{flex:1;overflow-y:auto;padding:0 18px 18px}"
      + ".ml-empty{padding:26px 10px;text-align:center;color:var(--slate-soft,#888);font:500 13px var(--sans,system-ui)}"
      + ".ml-cards{display:flex;flex-direction:column;gap:9px;margin-bottom:14px}"
      + ".ml-card{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--line,#e5e5e0);border-radius:12px;padding:11px 13px;background:var(--panel,#fff)}"
      + ".ml-card-removed{align-items:center}"
      + ".ml-undo-row{display:flex;justify-content:space-between;align-items:center;width:100%;font:500 13px var(--sans,system-ui);color:var(--slate,#666)}"
      + ".ml-undo-btn{background:transparent;border:none;color:var(--teal,#0a9396);font:700 13px var(--sans,system-ui);cursor:pointer}"
      + ".ml-card-title{font:700 14px var(--sans,system-ui)}.ml-card-brand{font:500 12px var(--sans,system-ui);color:var(--slate,#666)}"
      + ".ml-card-line{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:2px}"
      + ".ml-card-meta{display:flex;gap:6px;margin-top:6px}"
      + ".ml-source-badge{font:600 10px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;background:var(--paper,#f7f7f5);border:1px solid var(--line,#e5e5e0);border-radius:7px;padding:2px 7px;color:var(--slate,#666)}"
      + ".ml-conf-badge{font:600 10px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;background:#fff4e0;border:1px solid #f0c675;border-radius:7px;padding:2px 7px;color:#8a5a00}"
      + ".ml-card-actions{display:flex;flex-direction:column;gap:6px}"
      + ".ml-icon-btn{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:5px 10px;font:600 11.5px var(--sans,system-ui);cursor:pointer;color:var(--slate,#666)}"
      + ".ml-remove-btn{color:#b3261e;border-color:#f2c9c5}"
      + ".ml-add-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}"
      + ".ml-add-btn{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:10px;padding:9px 13px;font:600 12.5px var(--sans,system-ui);cursor:pointer;color:var(--ink,#1a1a1a)}"
      + ".ml-add-btn-disabled{opacity:.55;cursor:not-allowed}"
      + ".ml-panel{margin-top:10px;border:1px dashed var(--line,#e5e5e0);border-radius:11px;padding:12px}"
      + ".ml-input,.ml-textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:9px;padding:9px 11px;font:500 13px var(--sans,system-ui)}"
      + ".ml-textarea{min-height:80px;resize:vertical}"
      + ".ml-panel-add-btn{margin-top:9px;background:var(--teal,#0a9396);color:#fff;border:none;border-radius:9px;padding:8px 14px;font:700 12.5px var(--sans,system-ui);cursor:pointer}"
      + ".ml-index-results{display:flex;flex-direction:column;gap:6px;margin-top:8px}"
      + ".ml-index-result{display:flex;justify-content:space-between;gap:8px;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:8px 10px;font:500 12.5px var(--sans,system-ui);cursor:pointer;text-align:left}"
      + ".ml-index-result-generic{color:var(--slate-soft,#888)}"
      + ".ml-dym{margin-top:9px}.ml-dym-label{font:600 11.5px var(--sans,system-ui);color:var(--slate,#666);margin-bottom:5px}"
      + ".ml-dym-chips{display:flex;flex-wrap:wrap;gap:6px}"
      + ".ml-chip{background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border:1px solid var(--teal,#0a9396);border-radius:20px;padding:5px 11px;font:600 12px var(--sans,system-ui);cursor:pointer}"
      + ".ml-paste-list{display:flex;flex-direction:column;gap:5px;margin-top:9px;max-height:180px;overflow-y:auto}"
      + ".ml-paste-item{display:flex;align-items:center;gap:8px;font:500 12.5px var(--sans,system-ui)}"
      + ".ml-footer{position:sticky;bottom:0;padding:12px 18px;background:var(--panel,#fff);border-top:1px solid var(--line,#e5e5e0)}"
      + ".ml-check-btn{width:100%;background:var(--teal,#0a9396);color:#fff;border:none;border-radius:11px;padding:12px;font:700 14px var(--sans,system-ui);cursor:pointer}"
      + ".ml-check-btn:disabled{opacity:.5;cursor:not-allowed}";
    var st = document.createElement("style");
    st.id = "ml-styles"; st.textContent = css;
    document.head.appendChild(st);
  }

  function mount(containerEl) {
    if (!containerEl) return;
    injectStyles();
    _root = containerEl;
    _openAdd = null; _undoingId = null; clearUndoTimer();
    _manualState = { value: "", parsed: null };
    _indexState = { value: "", results: [], reqSeq: 0 };
    _pasteState = { value: "", rows: [] };
    render();
  }

  window.MEDLIST = { parseEntry: parseEntry, brandCandidates: brandCandidates, parsePasted: parsePasted,
    add: add, remove: remove, undoRemove: undoRemove, clearAll: clearAll, getList: getList,
    mount: mount, brandSearch: brandSearch };
})();
