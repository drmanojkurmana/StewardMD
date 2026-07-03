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

  /* ================= PRESCRIPTION / CASE-SHEET SCAN (photo / PDF) ============
   * Pipeline (MIRRORS icu.js report-import): file/camera image or PDF →
   * CLIENT-SIDE compress/resize to a JPEG under a byte cap (never send a raw
   * multi-MB file; canvas re-encode also strips EXIF) → scanExtract() POSTs the
   * compressed image to /api/ai/vision {kind:"medication_list"} → candidate rows
   * → clinician REVIEW (editable, confidence-flagged, include/exclude) → confirm
   * → add to MEDLIST with source "scan". OCR is CANDIDATE extraction only; the
   * clinician confirms each row. Nothing is auto-added; the raw image is dropped
   * once the review closes. The live vision call is PROD-ONLY (tests stub it). */
  var MAX_UPLOAD_BYTES = 1.6 * 1024 * 1024;   // target ≤ ~1.6 MB to the OCR

  // Compress an image File/blob/data-URL to a JPEG data-URL under the byte cap.
  // Canvas re-encode also strips EXIF/metadata. Iterates quality (then downscales)
  // to fit, so a raw multi-MB photo is never what reaches the vision endpoint.
  function _compressImage(fileOrDataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var maxEdge = 1600, w = img.width, h = img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
      var q = 0.72, out = cv.toDataURL("image/jpeg", q), guard = 0;
      function bytes(u) { return Math.ceil((u.length - (u.indexOf(",") + 1)) * 3 / 4); }
      while (bytes(out) > MAX_UPLOAD_BYTES && guard++ < 6) {
        q -= 0.12; if (q < 0.4) { cw = Math.round(cw * 0.85); ch = Math.round(ch * 0.85); cv.width = cw; cv.height = ch; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch); q = 0.6; }
        out = cv.toDataURL("image/jpeg", Math.max(0.35, q));
      }
      cb(out, { w: cw, h: ch, kb: Math.round(bytes(out) / 1024) });
    };
    img.onerror = function () { cb(null); };
    img.src = (typeof fileOrDataUrl === "string") ? fileOrDataUrl : URL.createObjectURL(fileOrDataUrl);
  }

  // Lazy-load pdf.js (CDN) only when a PDF is scanned; render capped pages to
  // compressed images. The whole PDF is NEVER sent — only rendered page images.
  var _pdfjs = null;
  function loadPdfJs() {
    if (_pdfjs) return Promise.resolve(_pdfjs);
    if (window.pdfjsLib) { _pdfjs = window.pdfjsLib; return Promise.resolve(_pdfjs); }
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function () { try { _pdfjs = window.pdfjsLib; _pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(_pdfjs); } catch (e) { rej(e); } };
      s.onerror = function () { rej(new Error("pdf-load")); };
      document.head.appendChild(s);
    });
  }
  function renderPdfPageToImage(pdf, pageNum, cb) {
    pdf.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: 2 });
      var cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise.then(function () {
        _compressImage(cv.toDataURL("image/jpeg", 0.85), function (out) { cb(out); });
      });
    }).catch(function () { cb(null); });
  }

  // scanExtract(imageDataUrl): POST the COMPRESSED image to the vision OCR with
  // kind:"medication_list" → normalised candidate rows. Only structured VALUES
  // flow onward; the raw image never persists. Called via window.MEDLIST at call
  // time so tests can stub it. The live vision call is PROD-ONLY.
  function scanExtract(imageDataUrl) {
    if (!(window.SMD_AI && window.SMD_AI.vision)) return Promise.reject(new Error("ai-unavailable"));
    try { if (window.SMD_AI.setFlag) window.SMD_AI.setFlag(true); } catch (e) {}
    return window.SMD_AI.vision(imageDataUrl, "medication_list").then(function (r) {
      if (!r || r.error) throw new Error((r && r.error) || "ocr-failed");
      var src = (r.fields && typeof r.fields === "object") ? r.fields : r;
      var meds = (src && Array.isArray(src.medications)) ? src.medications : (Array.isArray(src) ? src : []);
      return meds.map(normalizeScanRow).filter(Boolean);
    });
  }
  // Normalise a raw OCR med row into a candidate the review screen understands.
  // Runs the detected text through parseEntry/resolveGeneric to map + get
  // candidates. NEVER trusts an OCR-supplied generic that isn't a known generic.
  function normalizeScanRow(m) {
    m = m || {};
    var text = String(m.detected_text || m.text || "").trim();
    if (!text && !m.drug) return null;
    var parsed = parseEntry(text || String(m.drug || ""));
    // OCR may fill strength/route/frequency separately — prefer parsed, else OCR text.
    if (parsed.strength == null && m.strength) { var pm = parseEntry(String(m.strength)); if (pm.strength != null) { parsed.strength = pm.strength; parsed.unit = parsed.unit || pm.unit; } }
    if (!parsed.route && m.route) { var rt = String(m.route).toLowerCase(); if (ROUTES[rt]) parsed.route = ROUTES[rt]; }
    if (!parsed.freq && m.frequency) { var fr = String(m.frequency).toLowerCase(); if (FREQ[fr]) { parsed.freq = FREQ[fr]; parsed.freqText = fr; } }
    // Confidence: honour OCR's low/medium/high but never upgrade an unmapped row to high.
    var conf = String(m.confidence || "").toLowerCase();
    if (conf !== "high" && conf !== "medium" && conf !== "low") conf = parsed.confidence || "low";
    if (!parsed.generic && conf === "high") conf = "medium";  // no silent high on an unmapped drug
    parsed.confidence = conf;
    parsed.detected_text = text;
    return parsed;
  }

  // --- UI: mount(containerEl) renders the medication-list-builder screen. ---
  var _root = null;             // mounted container element
  var _openAdd = null;          // which add-option panel is open: null|'index'|'manual'|'paste'
  var _undoTimer = null;        // pending inline-undo timer id
  var _undoingId = null;        // id currently showing an inline Undo row
  var _manualState = { value: "", parsed: null };
  var _indexState = { value: "", results: [], reqSeq: 0 };
  var _pasteState = { value: "", rows: [] }; // rows: [{entry, include}]
  var _scanState = { rows: [] };             // rows: [{entry, include, editText}] — candidate scan review
  var _view = "list";                        // "list" | "results" | "scan"
  var _results = null;                        // last checkInteractions() result
  var _hideMinor = true;                      // results filter: hide minor findings by default

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
      // Finalize any pending inline-undo first, so editing this med can't
      // orphan a different med whose Undo row is still showing.
      clearUndoTimer(); _undoingId = null;
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
    var btnScan = el("button", { cls: "ml-add-btn", text: "Scan prescription / case sheet", attrs: { "data-ml-scan": "1" } });
    var btnWard = el("button", { cls: "ml-add-btn ml-add-btn-disabled", text: "Fetch from Ward Sync (Coming soon)", disabled: true, attrs: { "data-ml-wardsync": "1" } });
    [btnIndex, btnManual, btnPaste].forEach(function (b) {
      b.addEventListener("click", function () {
        var which = b.getAttribute("data-ml-open");
        _openAdd = (_openAdd === which) ? null : which;
        render();
      });
    });
    btnScan.addEventListener("click", function () { startScan(); });
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

  // --- Scan pipeline: file/camera/PDF → compress → scanExtract → review -----
  function scanProgress(msg, err) {
    if (!_root) return;
    var ov = _root.querySelector(".ml-scan-ov");
    if (!ov) { ov = el("div", { cls: "ml-scan-ov" }); _root.appendChild(ov); }
    ov.textContent = "";
    var box = el("div", { cls: "ml-scan-box" });
    if (err) {
      box.appendChild(el("div", { cls: "ml-scan-err", text: msg }));
      var close = el("button", { cls: "ml-panel-add-btn", text: "Close" });
      close.addEventListener("click", function () { ov.remove(); });
      box.appendChild(close);
    } else {
      box.appendChild(el("div", { cls: "ml-scan-spin", text: "◐" }));
      box.appendChild(el("div", { text: msg }));
    }
    ov.appendChild(box);
  }
  function scanProgressDone() { if (_root) { var ov = _root.querySelector(".ml-scan-ov"); if (ov) ov.remove(); } }

  // Open the OS file/camera picker (image or PDF). Camera capture on mobile.
  function startScan() {
    var inp = document.createElement("input"); inp.type = "file";
    inp.accept = "image/*,application/pdf";
    inp.setAttribute("capture", "environment");   // rear camera on mobile; ignored on desktop
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (f) handleScanFile(f); inp.remove(); });
    inp.click();
  }
  function handleScanFile(file) {
    if (file.type === "application/pdf") {
      scanProgress("Reading PDF…");
      loadPdfJs().then(function (pdfjs) {
        var fr = new FileReader();
        fr.onload = function () {
          pdfjs.getDocument({ data: new Uint8Array(fr.result) }).promise.then(function (pdf) {
            var pages = Math.min(pdf.numPages, 3);   // cap pages sent to OCR
            scanProgress("Rendering " + pages + " of " + pdf.numPages + " page(s)…");
            renderPdfPageToImage(pdf, 1, function (img) {
              if (!img) return scanProgress("Could not read this PDF. Try a photo instead.", true);
              runScanOcr(img);
            });
          }).catch(function () { scanProgress("Could not open this PDF.", true); });
        };
        fr.readAsArrayBuffer(file);
      }).catch(function () { scanProgress("PDF support unavailable offline — try a photo.", true); });
      return;
    }
    // image: compress client-side BEFORE any AI call (raw file never sent)
    scanProgress("Compressing image…");
    _compressImage(file, function (dataUrl) {
      if (!dataUrl) return scanProgress("Could not read this image.", true);
      runScanOcr(dataUrl);
    });
  }
  function runScanOcr(dataUrl) {
    scanProgress("Reading medicines from image…");
    // Call via window.MEDLIST so tests can stub scanExtract.
    var fn = (window.MEDLIST && window.MEDLIST.scanExtract) || scanExtract;
    Promise.resolve().then(function () { return fn(dataUrl); }).then(function (rows) {
      scanProgressDone();
      if (!rows || !rows.length) { scanProgress("No medicines could be read confidently. Please enter them manually.", true); return; }
      _openScanReview(rows, dataUrl);
    }).catch(function () { scanProgressDone(); scanProgress("Could not read the image. Enter medicines manually.", true); });
  }
  // Clinician REVIEW — nothing is added until "Add selected". rows are candidate
  // parse results (or raw OCR rows, which are normalised here).
  function _openScanReview(rows, dataUrl) {
    scanProgressDone();
    var norm = (rows || []).map(function (r) {
      // A parseEntry() result carries a `raw` string + `candidates` array. A raw OCR
      // row does not — normalise it (maps generic, sets confidence, never silently maps).
      var entry = (r && typeof r.raw === "string" && Array.isArray(r.candidates)) ? r : normalizeScanRow(r);
      if (!entry) return null;
      return { entry: entry, include: true, editText: entry.detected_text || entry.raw || "" };
    }).filter(Boolean);
    _scanState = { rows: norm };
    _view = "scan";
    dataUrl = null;   // drop the raw image reference immediately after extraction
    render();
  }

  function renderScan() {
    _root.textContent = "";
    _root.classList.add("ml-root");

    var header = el("div", { cls: "ml-header" });
    header.appendChild(el("h2", { cls: "ml-title", text: "Review scanned medicines" }));
    header.appendChild(el("p", { cls: "ml-subtitle", text: "Verify each row against the source. Nothing is added until you confirm." }));
    header.appendChild(el("div", { cls: "ml-advisory",
      text: "Extracted for review only — confirm every medicine, strength, route, and frequency. Illegible or unmapped rows need manual review." }));
    _root.appendChild(header);

    var body = el("div", { cls: "ml-body" });
    var listWrap = el("div", { cls: "ml-scan-rows" });

    _scanState.rows.forEach(function (row, idx) {
      var entry = row.entry;
      var flagged = !entry.generic || entry.confidence === "low";
      var card = el("div", { cls: "ml-scan-row" + (flagged ? " ml-scan-flagged" : ""),
        attrs: Object.assign({ "data-ml-scan-row": String(idx) }, flagged ? { "data-ml-flagged": "1" } : {}) });

      var top = el("div", { cls: "ml-scan-top" });
      var cb = el("input", { type: "checkbox" });
      cb.checked = row.include;
      cb.addEventListener("change", function () { row.include = cb.checked; });
      top.appendChild(cb);

      var titleWrap = el("div", { cls: "ml-scan-titlewrap" });
      titleWrap.appendChild(el("div", { cls: "ml-scan-mapped", text: entry.generic || "Not mapped" }));
      // detected_text preserved verbatim (textContent — never innerHTML)
      titleWrap.appendChild(el("div", { cls: "ml-scan-detected", text: entry.detected_text || entry.raw || "" }));
      top.appendChild(titleWrap);

      var confBadge = el("span", { cls: "ml-conf-badge ml-conf-" + (entry.confidence || "low"), text: (entry.confidence || "low") });
      top.appendChild(confBadge);
      card.appendChild(top);

      var line = fieldLine(entry);
      if (line) card.appendChild(el("div", { cls: "ml-scan-line", text: line }));

      // editable field — clinician can correct the detected text before adding
      var edit = el("input", { cls: "ml-input ml-scan-edit", type: "text",
        attrs: { "data-ml-scan-edit": String(idx), placeholder: "Correct or complete this medicine…" } });
      edit.value = row.editText;
      edit.addEventListener("input", function () {
        row.editText = edit.value;
        row.entry = normalizeScanRow({ detected_text: edit.value, confidence: entry.confidence });
        // re-render only this card's mapped label + flag lazily on next full render
      });
      card.appendChild(edit);

      if (flagged) {
        var flag = el("div", { cls: "ml-scan-flag", text: "⚠ Review manually — not confidently mapped" });
        card.appendChild(flag);
        if (entry.candidates && entry.candidates.length) {
          renderCandidateChips(card, entry.candidates, function (c) {
            row.entry = Object.assign({}, row.entry, { generic: c.generic, confidence: "high" });
            render();
          });
        }
      }
      listWrap.appendChild(card);
    });

    body.appendChild(listWrap);
    _root.appendChild(body);

    var footer = el("div", { cls: "ml-footer ml-scan-footer" });
    var cancel = el("button", { cls: "mlr-filter-btn", text: "Cancel", attrs: { "data-ml-scan-cancel": "1" } });
    cancel.addEventListener("click", function () { _scanState = { rows: [] }; _view = "list"; render(); });
    var addBtn = el("button", { cls: "ml-check-btn", text: "Add selected", attrs: { "data-ml-scan-add": "1" } });
    addBtn.addEventListener("click", function () {
      _scanState.rows.forEach(function (row) {
        if (!row.include) return;
        // Re-normalise from the (possibly edited) text so a corrected row maps fresh;
        // an unconfirmed row stays unmapped (generic:null) — never silently mapped.
        var entry = row.entry;
        add(Object.assign({}, entry, { confidence: entry.confidence }), "scan");
      });
      _scanState = { rows: [] };
      _view = "list";
      render();
    });
    footer.appendChild(cancel);
    footer.appendChild(addBtn);
    _root.appendChild(footer);
  }

  function hasResolvedGeneric() {
    return getList().some(function (m) { return m.generic && typeof m.generic === "string" && m.generic.trim(); });
  }

  function render() {
    if (!_root) return;
    if (_view === "results") { renderResults(); return; }
    if (_view === "scan") { renderScan(); return; }
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
    var canCheck = hasResolvedGeneric();
    var checkBtn = el("button", { cls: "ml-check-btn", text: "Check interactions", attrs: { id: "ml-check" } });
    if (!canCheck) checkBtn.disabled = true;
    checkBtn.addEventListener("click", function () {
      if (checkBtn.disabled) return;
      runCheck();
    });
    footer.appendChild(checkBtn);
    _root.appendChild(footer);
  }

  function runCheck() {
    if (!window.INTERACTIONS || typeof window.INTERACTIONS.checkInteractions !== "function") return;
    _results = window.INTERACTIONS.checkInteractions(getList());
    _view = "results";
    _hideMinor = true;
    render();
  }

  // --- Results screen -------------------------------------------------------
  var SEVERITY_LABEL = {
    critical: "Critical",
    major: "Major",
    moderate: "Moderate",
    minor: "Minor",
    monitor: "Monitor"
  };
  // Color-INDEPENDENT text markers so severity never relies on color alone.
  var SEVERITY_MARK = {
    critical: "!!!",
    major: "!!",
    moderate: "!",
    minor: "•",
    monitor: "◆"
  };

  function findingCard(finding) {
    var card = el("div", { cls: "mlr-card mlr-card-" + (SEVERITY_BUCKET_CLASS[finding.severity] || "monitor") });

    var head = el("div", { cls: "mlr-card-head" });
    var pair = el("div", { cls: "mlr-card-pair", text: (finding.drugs || []).join(" + ") || "Medicine" });
    head.appendChild(pair);
    // finding.severity is the RAW rule severity (e.g. "contraindicated"); map it to the
    // display bucket first so the highest-severity findings show the correct text/marker
    // (severity conveyed by text, never by color alone).
    var sevBucket = SEVERITY_BUCKET_CLASS[finding.severity] || "monitor";
    var sevLabel = SEVERITY_LABEL[sevBucket] || "Caution";
    var sevMark = SEVERITY_MARK[sevBucket] || "◆";
    var badge = el("span", { cls: "mlr-sev mlr-sev-" + (SEVERITY_BUCKET_CLASS[finding.severity] || "monitor") });
    badge.appendChild(el("span", { cls: "mlr-sev-mark", text: sevMark, attrs: { "aria-hidden": "true" } }));
    badge.appendChild(el("span", { cls: "mlr-sev-text", text: sevLabel }));
    head.appendChild(badge);
    card.appendChild(head);

    var whyText = [finding.mechanism, finding.effect].filter(Boolean).join(" ");
    if (whyText) card.appendChild(detailRow("Why it matters", whyText));
    if (finding.action) card.appendChild(detailRow("Action", finding.action));
    if (finding.monitoring) card.appendChild(detailRow("Monitoring", finding.monitoring));
    if (finding.source) card.appendChild(detailRow("Source", finding.source));
    return card;
  }

  var SEVERITY_BUCKET_CLASS = {
    contraindicated: "critical",
    major: "major",
    moderate: "moderate",
    minor: "minor",
    monitor: "monitor"
  };

  function detailRow(label, value) {
    var row = el("div", { cls: "mlr-detail" });
    row.appendChild(el("span", { cls: "mlr-detail-label", text: label }));
    row.appendChild(el("span", { cls: "mlr-detail-val", text: value }));
    return row;
  }

  function resultsSection(container, title, findings) {
    if (!findings || !findings.length) return;
    var sec = el("div", { cls: "mlr-section" });
    var h = el("div", { cls: "mlr-section-h" });
    h.appendChild(el("span", { cls: "mlr-section-title", text: title }));
    h.appendChild(el("span", { cls: "mlr-section-count", text: String(findings.length) }));
    sec.appendChild(h);
    findings.forEach(function (f) { sec.appendChild(findingCard(f)); });
    container.appendChild(sec);
  }

  function summaryStat(container, label, count) {
    var stat = el("div", { cls: "mlr-stat" });
    stat.appendChild(el("span", { cls: "mlr-stat-num", text: String(count) }));
    stat.appendChild(el("span", { cls: "mlr-stat-label", text: label }));
    container.appendChild(stat);
  }

  function renderResults() {
    _root.textContent = "";
    _root.classList.add("ml-root");
    var res = _results || { critical: [], major: [], moderate: [], minor: [], monitor: [], duplicates: [], combinations: [], reviewedCount: 0 };

    var header = el("div", { cls: "ml-header" });
    header.appendChild(el("h2", { cls: "ml-title", text: "Interaction Summary" }));
    header.appendChild(el("p", { cls: "ml-subtitle", text: "Review each finding with current local protocol and pharmacist where needed" }));
    _root.appendChild(header);

    var body = el("div", { cls: "ml-body" });

    // Summary counts (color-independent, plain text labels).
    var criticalCount = res.critical.length;
    var majorCount = res.major.length;
    var monitorCount = res.monitor.length;
    var dupCount = (res.duplicates || []).length;
    var summary = el("div", { cls: "mlr-summary" });
    summaryStat(summary, "Critical alerts", criticalCount);
    summaryStat(summary, "Major interactions", majorCount);
    summaryStat(summary, "Monitoring cautions", monitorCount);
    summaryStat(summary, "Duplicate therapies", dupCount);
    summaryStat(summary, "Medicines reviewed", res.reviewedCount);
    body.appendChild(summary);

    // Advisory / context note.
    body.appendChild(el("div", { cls: "ml-advisory mlr-advisory",
      text: "Interaction check is medication-based. Add renal function, electrolytes, QTc, or patient context for more tailored cautions." }));

    // Filters row.
    var filters = el("div", { cls: "mlr-filters" });
    var toggle = el("button", { cls: "mlr-filter-btn", attrs: { id: "mlr-toggle-minor" },
      text: _hideMinor ? "Show all" : "Hide minor" });
    toggle.addEventListener("click", function () { _hideMinor = !_hideMinor; render(); });
    filters.appendChild(toggle);
    var backBtn = el("button", { cls: "mlr-filter-btn mlr-back-btn", text: "Back to medicines", attrs: { id: "mlr-back" } });
    backBtn.addEventListener("click", function () { _view = "list"; render(); });
    filters.appendChild(backBtn);
    body.appendChild(filters);

    // Sections in priority order.
    var monitorFindings = res.monitor.slice();
    var moderateFindings = res.moderate.slice();
    var minorFindings = _hideMinor ? [] : res.minor.slice();
    var dupFindings = (res.duplicates || []).slice();

    resultsSection(body, "Critical alerts", res.critical);
    resultsSection(body, "Major interactions", res.major);
    resultsSection(body, "Monitoring cautions", monitorFindings.concat(moderateFindings, minorFindings));
    resultsSection(body, "Duplicate therapy", dupFindings);

    var anyShown = res.critical.length || res.major.length || monitorFindings.length ||
      moderateFindings.length || minorFindings.length || dupFindings.length;
    if (!anyShown) {
      body.appendChild(el("div", { cls: "mlr-none", text: "No issues detected" }));
    }

    _root.appendChild(body);
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
      + ".ml-footer{position:sticky;bottom:0;padding:12px 18px calc(12px + env(safe-area-inset-bottom));background:var(--panel,#fff);border-top:1px solid var(--line,#e5e5e0)}"
      + ".ml-check-btn{width:100%;min-height:44px;background:var(--teal,#0a9396);color:#fff;border:none;border-radius:11px;padding:12px;font:700 14px var(--sans,system-ui);cursor:pointer;box-sizing:border-box}"
      + ".ml-check-btn:disabled{opacity:.5;cursor:not-allowed}"
      + ".ml-icon-btn{min-height:44px}"
      // --- Results screen ---
      + ".mlr-advisory{margin-bottom:12px}"
      + ".mlr-summary{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:6px 0 12px}"
      + "@media(min-width:520px){.mlr-summary{grid-template-columns:repeat(3,1fr)}}"
      + ".mlr-stat{border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:10px 12px;background:var(--panel,#fff);display:flex;flex-direction:column;gap:2px}"
      + ".mlr-stat-num{font:800 20px var(--sans,system-ui);color:var(--ink,#1a1a1a)}"
      + ".mlr-stat-label{font:600 11px var(--sans,system-ui);color:var(--slate,#666)}"
      + ".mlr-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}"
      + ".mlr-filter-btn{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:20px;padding:8px 14px;font:600 12.5px var(--sans,system-ui);cursor:pointer;color:var(--ink,#1a1a1a);min-height:40px}"
      + ".mlr-back-btn{color:var(--teal,#0a9396);border-color:var(--teal,#0a9396)}"
      + ".mlr-section{margin-bottom:16px}"
      + ".mlr-section-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}"
      + ".mlr-section-title{font:800 13px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;color:var(--slate,#666)}"
      + ".mlr-section-count{font:700 11px var(--sans,system-ui);background:var(--paper,#f7f7f5);border:1px solid var(--line,#e5e5e0);border-radius:10px;padding:1px 8px;color:var(--slate,#666)}"
      + ".mlr-card{border:1px solid var(--line,#e5e5e0);border-left-width:4px;border-radius:12px;padding:12px 13px;background:var(--panel,#fff);margin-bottom:9px}"
      + ".mlr-card-critical{border-left-color:#b3261e}.mlr-card-major{border-left-color:#c77700}"
      + ".mlr-card-moderate{border-left-color:#8a5a00}.mlr-card-monitor{border-left-color:#0a9396}.mlr-card-minor{border-left-color:#888}"
      + ".mlr-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px}"
      + ".mlr-card-pair{font:700 14px var(--sans,system-ui);color:var(--ink,#1a1a1a)}"
      + ".mlr-sev{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:3px 8px;font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}"
      + ".mlr-sev-critical{background:#fbe6e4;color:#b3261e;border:1px solid #f2c9c5}"
      + ".mlr-sev-major{background:#fdf0dc;color:#985c00;border:1px solid #f0c675}"
      + ".mlr-sev-moderate{background:#fdf0dc;color:#8a5a00;border:1px solid #f0c675}"
      + ".mlr-sev-monitor{background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border:1px solid #a6d9d8}"
      + ".mlr-sev-minor{background:var(--paper,#f7f7f5);color:#666;border:1px solid var(--line,#e5e5e0)}"
      + ".mlr-sev-mark{font-weight:900}"
      + ".mlr-detail{display:flex;flex-direction:column;gap:1px;margin-top:6px}"
      + ".mlr-detail-label{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;color:var(--slate-soft,#888)}"
      + ".mlr-detail-val{font:500 12.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.4}"
      + ".mlr-none{padding:26px 10px;text-align:center;color:var(--teal,#0a9396);font:700 14px var(--sans,system-ui);border:1px dashed #a6d9d8;border-radius:12px;background:var(--teal-soft,#e0f2f1)}"
      // --- Scan review screen ---
      + ".ml-scan-ov{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.5);padding:16px}"
      + ".ml-scan-box{background:var(--panel,#fff);border-radius:14px;padding:20px 22px;text-align:center;color:var(--ink,#1a1a1a);font:600 13.5px var(--sans,system-ui);max-width:300px}"
      + ".ml-scan-spin{font-size:26px;animation:mlspin 1s linear infinite;margin-bottom:8px}@keyframes mlspin{to{transform:rotate(360deg)}}"
      + ".ml-scan-err{color:#b3261e;font:600 13.5px/1.5 var(--sans,system-ui);margin-bottom:12px}"
      + ".ml-scan-rows{display:flex;flex-direction:column;gap:10px;padding-top:8px}"
      + ".ml-scan-row{border:1px solid var(--line,#e5e5e0);border-radius:12px;padding:11px 12px;background:var(--panel,#fff)}"
      + ".ml-scan-row.ml-scan-flagged{border-left:4px solid #c77700;background:#fffaf2}"
      + ".ml-scan-top{display:flex;align-items:flex-start;gap:9px}"
      + ".ml-scan-titlewrap{flex:1;min-width:0}"
      + ".ml-scan-mapped{font:700 14px var(--sans,system-ui);color:var(--ink,#1a1a1a)}"
      + ".ml-scan-detected{font:500 12px var(--sans,system-ui);color:var(--slate,#666);margin-top:1px;word-break:break-word}"
      + ".ml-scan-line{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);margin:6px 0 0 27px}"
      + ".ml-scan-edit{margin-top:8px}"
      + ".ml-scan-flag{font:700 11.5px var(--sans,system-ui);color:#985c00;margin-top:7px}"
      + ".ml-scan-footer{display:flex;gap:10px}.ml-scan-footer .mlr-filter-btn{flex:0 0 auto}.ml-scan-footer .ml-check-btn{flex:1}"
      + ".ml-conf-badge.ml-conf-high{background:#e0f2f1;border-color:#a6d9d8;color:#0a7d76}"
      + ".ml-conf-badge.ml-conf-low{background:#fbe6e4;border-color:#f2c9c5;color:#b3261e}";
    var st = document.createElement("style");
    st.id = "ml-styles"; st.textContent = css;
    document.head.appendChild(st);
  }

  function mount(containerEl) {
    if (!containerEl) return;
    injectStyles();
    _root = containerEl;
    _view = "list"; _results = null; _hideMinor = true;
    _openAdd = null; _undoingId = null; clearUndoTimer();
    _manualState = { value: "", parsed: null };
    _indexState = { value: "", results: [], reqSeq: 0 };
    _pasteState = { value: "", rows: [] };
    _scanState = { rows: [] };
    render();
  }

  window.MEDLIST = { parseEntry: parseEntry, brandCandidates: brandCandidates, parsePasted: parsePasted,
    add: add, remove: remove, undoRemove: undoRemove, clearAll: clearAll, getList: getList,
    mount: mount, brandSearch: brandSearch,
    scanExtract: scanExtract, _compressImage: _compressImage, _openScanReview: _openScanReview };
})();
