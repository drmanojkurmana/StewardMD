/* StewardMD — Medication list builder. Exposes window.MEDLIST.
   Deterministic parsing only (no AI). Keeps original text until the clinician
   confirms an uncertain drug mapping. */
(function () {
  "use strict";
  var FORM_PREFIX = { t: "tablet", tab: "tablet", tabs: "tablet", cap: "capsule", caps: "capsule",
    inj: "injection", syp: "syrup", syr: "syrup", susp: "suspension", drop: "drops", oint: "ointment",
    neb: "nebulisation", inh: "inhaler" };
  // Full formulation words that hospital feeds (e.g. GHIS) append/prepend — stripped
  // from the drug name wherever they appear so "PARACETAMOL-650MG TABLET" resolves to
  // "paracetamol". (inh/neb are also routes and handled there first.)
  var FORM_WORD = { tablet: "tablet", tablets: "tablet", tab: "tablet", tabs: "tablet",
    capsule: "capsule", capsules: "capsule", cap: "capsule", caps: "capsule",
    injection: "injection", injections: "injection", inj: "injection", vial: "injection",
    vials: "injection", ampoule: "injection", ampule: "injection", amp: "injection", infusion: "injection",
    syrup: "syrup", syp: "syrup", syr: "syrup", suspension: "suspension", susp: "suspension",
    solution: "solution", soln: "solution", elixir: "syrup", drop: "drops", drops: "drops",
    ointment: "ointment", oint: "ointment", cream: "cream", gel: "gel", lotion: "lotion",
    nebulisation: "nebulisation", nebuliser: "nebulisation", respule: "nebulisation",
    inhaler: "inhaler", rotacap: "inhaler", rotacaps: "inhaler", mdi: "inhaler",
    sachet: "sachet", powder: "powder", granules: "powder", suppository: "suppository", pessary: "pessary" };
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
    // interaction pipeline brand/synonym map (INTERACTION_RULES.brands: brand -> generic),
    // e.g. viagra->sildenafil, gtn/ntg->nitroglycerin, adalat->nifedipine.
    try {
      var br = window.INTERACTION_RULES && window.INTERACTION_RULES.brands;
      if (br && Object.prototype.hasOwnProperty.call(br, n)) out.push({ brand: name, generic: String(br[n]).toLowerCase() });
    } catch (_) {}
    // dedupe by generic
    var seen = {}; return out.filter(function (c) { if (seen[c.generic]) return false; seen[c.generic] = 1; return true; });
  }
  function isKnownGeneric(n) {
    n = (n || "").toLowerCase();
    // Known = the non-antibiotic formulary (MEDDRUGS._list) UNION every generic the
    // interaction engine understands (INTERACTION_RULES.drugClasses). The union matters:
    // antibiotics such as levofloxacin live only in the ruleset, so without this they'd
    // stay unresolved and be silently skipped by the interaction checker.
    try { if (((window.MEDDRUGS && window.MEDDRUGS._list) || []).some(function (d) { return d.generic.toLowerCase() === n; })) return true; } catch (_) {}
    try { var dc = window.INTERACTION_RULES && window.INTERACTION_RULES.drugClasses;
      if (dc && Object.prototype.hasOwnProperty.call(dc, n)) return true; } catch (_) {}
    // Full generic vocabulary emitted by the interaction pipeline (INTERACTION_RULES.generics)
    // — includes drugs auto-classified from RxClass (e.g. sildenafil, nitrates, dihydropyridines)
    // not present in the dose formularies. Without this they'd stay unresolved and be skipped.
    try { var gl = window.INTERACTION_RULES && window.INTERACTION_RULES.generics;
      if (gl && gl.indexOf && gl.indexOf(n) !== -1) return true; } catch (_) {}
    // Antibiotic stewardship formulary (amoxicillin, ceftriaxone, meropenem, …) lives in
    // ASP_DRUGS, keyed by generic — include it so ward antibiotics are recognised too.
    try { if (window.ASP_DRUGS && Object.prototype.hasOwnProperty.call(window.ASP_DRUGS, n)) return true; } catch (_) {}
    return false;
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
    // Un-glue hospital-feed formats: "PARACETAMOL-650MG" / "AMOXICILLIN-500" -> separate
    // the name from its strength (leave name-name hyphens like "co-trimoxazole" intact).
    var norm = raw.replace(/([a-z])-(?=\d)/gi, "$1 ");
    var toks = tokens(norm), rest = [];
    // form prefix (first token)
    if (toks.length && FORM_PREFIX[toks[0]]) { out.form = FORM_PREFIX[toks[0]]; toks = toks.slice(1); }
    // strength (with unit if present; falls back to a bare number, e.g. "metformin 500 bd")
    var m = norm.match(UNIT_RE);
    if (m) { out.strength = parseFloat(m[1]); out.unit = m[2].toLowerCase().replace(/s$/, ""); }
    else { var bm = norm.match(BARE_NUM_RE); if (bm) out.strength = parseFloat(bm[1]); }
    // route + freq + form words + strip numerics/units; remaining tokens = drug name
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (ROUTES[tk]) { out.route = ROUTES[tk]; continue; }
      if (FREQ[tk]) { out.freq = FREQ[tk]; out.freqText = tk; continue; }
      if (FORM_WORD[tk]) { out.form = out.form || FORM_WORD[tk]; continue; }
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
  // Reduce ONE active-ingredient token to its bare name so product/composition
  // strings from the Drug Index (e.g. "Sildenafil (50mg)", "Sildenafil 20 mg tablet")
  // collapse to the same clinical ingredient ("sildenafil"). Strips parenthetical
  // groups, strength+unit tokens, and standalone formulation words. Salt forms
  // (e.g. "sildenafil citrate") are intentionally left intact.
  function normIngredient(token) {
    var s = String(token || "").toLowerCase();
    s = s.replace(/\([^)]*\)/g, " ");                                                      // "(50mg)", "(30 mg)"
    s = s.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|kg|ml|l|iu|units?|meq|mmol|%)\b/g, " "); // "50mg", "20 mg", "5 %"
    var words = s.split(/[^a-z0-9'.-]+/).filter(function (w) { return w && !FORM_WORD[w]; });
    return words.join(" ").replace(/\s+/g, " ").trim();
  }
  function getIngredients(genericStr) {
    if (!genericStr || typeof genericStr !== "string") return [];
    return genericStr.split("+").map(normIngredient).filter(Boolean);
  }
  // Canonical clinical generic for storage/display: the normalised active
  // ingredient(s), joined in composition order. Returns null when nothing survives
  // (so the caller can fall back to the raw label rather than store an empty string).
  function cleanGeneric(genericStr) {
    var ings = getIngredients(genericStr);
    return ings.length ? ings.join(" + ") : null;
  }
  function getClinicalKey(genericStr) {
    var ingredients = getIngredients(genericStr);
    if (ingredients.length === 0) return "";
    return ingredients.slice().sort().join("|");
  }
  function getClinicalList(list) {
    var grouped = {};
    var orderedKeys = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var key = m.generic ? getClinicalKey(m.generic) : m.id;
      if (!grouped[key]) {
        grouped[key] = {
          clinicalKey: key,
          generic: m.generic || null,
          name: m.name || null,
          raw: m.raw || null,
          source: m.source || "manual",
          confidence: m.confidence || null,
          products: []
        };
        orderedKeys.push(key);
      }
      grouped[key].products.push(m);
    }
    return orderedKeys.map(function (k) { return grouped[k]; });
  }
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
      // Downscale hard: OCR of prescriptions/reports stays reliable at ~1024px long edge
      // (verified against the live vision model down to ~860px), and a smaller image means
      // far fewer vision tiles -> fewer AI tokens. Dense reports can still use hi-quality.
      var maxEdge = 900, w = img.width, h = img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
      var q = 0.6, out = cv.toDataURL("image/jpeg", q), guard = 0;
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

  // Lazy-load pdf.js only when a PDF is scanned; render capped pages to compressed
  // images. The whole PDF is NEVER sent — only rendered page images.
  // BUG #12: local bundled copy first (offline / native), CDN only as fallback.
  var _pdfjs = null;
  var PDFJS_LOCAL = "/vendor/pdfjs/pdf.min.js", PDFJS_LOCAL_W = "/vendor/pdfjs/pdf.worker.min.js";
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", PDFJS_CDN_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function loadPdfJs() {
    if (_pdfjs) return Promise.resolve(_pdfjs);
    if (window.pdfjsLib) { _pdfjs = window.pdfjsLib; try { _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_LOCAL_W; } catch (e) {} return Promise.resolve(_pdfjs); }
    return new Promise(function (res, rej) {
      function load(src, worker, next) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { try { _pdfjs = window.pdfjsLib; _pdfjs.GlobalWorkerOptions.workerSrc = worker; res(_pdfjs); } catch (e) { if (next) next(); else rej(e); } };
        s.onerror = function () { if (next) next(); else rej(new Error("pdf-load")); };
        document.head.appendChild(s);
      }
      load(PDFJS_LOCAL, PDFJS_LOCAL_W, function () { load(PDFJS_CDN, PDFJS_CDN_W, null); });
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
    // On-device-first: OCR on device (image never leaves); AI structures the scrubbed text
    // when on+online, else each recognized line becomes an editable candidate row.
    if (!(window.SMD_AI && window.SMD_AI.readImage)) return Promise.reject(new Error("ai-unavailable"));
    return window.SMD_AI.readImage(imageDataUrl, "medication_list").then(function (r) {
      if (!r) throw new Error("ocr-failed");
      if (r.mode === "fields") {
        var src = (r.fields && typeof r.fields === "object") ? r.fields : r;
        var meds = (src && Array.isArray(src.medications)) ? src.medications : (Array.isArray(src) ? src : []);
        return meds.map(normalizeScanRow).filter(Boolean);
      }
      // fallback (quota/offline/AI-off): recognized lines → editable candidate rows.
      return (r.lines || []).map(function (ln) { return normalizeScanRow({ detected_text: ln }); }).filter(Boolean);
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
    // AI-assisted mapping: when the deterministic parse didn't resolve a generic, adopt the
    // model's standardised generic (brand->generic, Latin->INN, OCR-typo corrected). Prefer a
    // formulary/brand match; otherwise accept the model's generic at MEDIUM (the clinician
    // still reviews and confirms every row before anything is added). Combinations stay for
    // explicit review.
    if (!parsed.generic) {
      var aiG = String(m.drug || m.generic || "").toLowerCase().trim().replace(/\s+/g, " ");
      var isCombo = aiG.indexOf(" + ") !== -1 || aiG.indexOf("+") !== -1;
      if (aiG && !isCombo && /^[a-z][a-z0-9'.\- ]+$/.test(aiG)) {
        if (isKnownGeneric(aiG)) { parsed.generic = aiG; parsed.name = parsed.name || aiG; }
        else {
          var bc = brandCandidates(aiG);
          if (bc.length === 1 && bc[0].generic.indexOf(" + ") === -1) { parsed.generic = bc[0].generic; parsed.name = parsed.name || aiG; }
          // AI-only mapping (drug not in local formulary): always adopt the model's generic so
          // nothing it identified shows as "Not mapped". Cap at MEDIUM; if the row's OCR was
          // low-confidence (garbled dose/freq) keep it low so it still flags for dose review.
          else { parsed.generic = aiG; parsed.name = parsed.name || aiG; parsed.aiMapped = true; if (conf === "high") conf = "medium"; }
        }
      }
    }
    // A deterministic/formulary map on a low-confidence OCR line is safe to un-flag; an AI-only
    // low-confidence map keeps the review flag (the drug name still shows, dose needs checking).
    if (parsed.generic && !parsed.aiMapped && conf === "low") conf = "medium";
    if (!parsed.generic && conf === "high") conf = "medium";  // no silent high on an unmapped drug
    parsed.confidence = conf;
    parsed.detected_text = text;
    return parsed;
  }

  // explainInteraction(finding): OPTIONAL MaiK "explain this interaction" layer.
  // Turns an ALREADY-detected deterministic finding into a plain-language
  // explanation for the clinician. The deterministic engine remains the single
  // source of truth: this returns DISPLAY-ONLY text and CANNOT change severity,
  // add/remove findings, or alter counts.
  //
  // De-identification: we send ONLY the finding's drug names + mechanism/effect +
  // severity LABEL — never any patient data. The payload is a compact string the
  // existing /api/ai/explain endpoint already understands (via window.SMD_AI.explain),
  // so no raw JSON, ids, provider or model names transit or return to the DOM.
  // Called via window.MEDLIST.explainInteraction at click time so tests can stub it.
  function explainInteraction(finding) {
    if (!(window.SMD_AI && window.SMD_AI.explain)) return Promise.reject(new Error("ai-unavailable"));
    finding = finding || {};
    var sevBucket = SEVERITY_BUCKET_CLASS[finding.severity] || "monitor";
    var sevLabel = SEVERITY_LABEL[sevBucket] || "Caution";
    var drugs = (finding.drugs || []).join(" + ");
    var mech = [finding.mechanism, finding.effect].filter(Boolean).join(" ");
    // De-identified finding only — NO patient context of any kind.
    var summary = "A drug-interaction check flagged this deterministic finding. "
      + "Explain in plain language, for a clinician, why it matters and what to watch for. "
      + "Do NOT change or dispute the severity. "
      + "Drugs: " + (drugs || "medicines") + ". "
      + "Severity: " + sevLabel + ". "
      + (mech ? "Mechanism/effect: " + mech + "." : "");
    try { if (window.SMD_AI.setFlag) window.SMD_AI.setFlag(true); } catch (e) {}
    return window.SMD_AI.explain(summary).then(function (r) {
      if (!r || r.error || typeof r.text !== "string" || !r.text.trim()) {
        throw new Error((r && r.error) || "explain-failed");
      }
      return r.text.trim();
    });
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
    if (opts.html != null) e.innerHTML = opts.html;
    if (opts.attrs) for (var k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    if (opts.disabled) e.disabled = true;
    if (opts.type) e.type = opts.type;
    if (opts.placeholder) e.placeholder = opts.placeholder;
    return e;
  }

  // Shared line-icon accessor (window.ICONS catalog); guarded for load order, empty fallback.
  function mlIco(name, cls) { return (window.ICONS && ICONS.get) ? ICONS.get(name, cls || "ml-ico") : ""; }

  function fieldLine(med) {
    var parts = [];
    if (med.form) parts.push(med.form);
    if (med.route) parts.push(med.route);
    if (med.strength != null) parts.push(String(med.strength) + (med.unit ? " " + med.unit : ""));
    if (med.freq) parts.push(med.freq);
    return parts.join(" · ");
  }

  function clearUndoTimer() { if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; } }

  /* ---- small helpers for the rebuilt workspace ---- */
  function cap(s){ s=String(s||""); return s.charAt(0).toUpperCase()+s.slice(1); }
  function ptInitials(name){ name=String(name||"").trim(); if(!name) return "PT";
    return name.split(/\s+/).map(function(p){return p.charAt(0).toUpperCase();}).join("").slice(0,3) || "PT"; }
  function escHtml(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  // Escape then wrap the first case-insensitive match of q in <mark>. Data is our own
  // curated formulary, but we escape anyway so nothing can inject markup.
  function highlight(text, q){
    text=String(text||""); var e=escHtml(text);
    q=String(q||"").trim(); if(!q) return e;
    var i=text.toLowerCase().indexOf(q.toLowerCase());
    if(i<0) return e;
    return escHtml(text.slice(0,i))+"<mark>"+escHtml(text.slice(i,i+q.length))+"</mark>"+escHtml(text.slice(i+q.length));
  }
  function hasGeneric(g){ g=(g||"").toLowerCase().trim(); if(!g) return false;
    return getList().some(function(m){ return (m.generic||"").toLowerCase()===g; }); }
  function toast(msg){ if(!_root) return; var t=el("div",{cls:"ml-toast",text:msg}); _root.appendChild(t);
    setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 2600); }
  function getRecents(){ try{ return JSON.parse(sessionStorage.getItem("smd_ml_recents")||"[]")||[]; }catch(_){ return []; } }
  function pushRecent(gen){ gen=String(gen||"").trim(); if(!gen) return;
    try{ var r=getRecents().filter(function(x){return x.toLowerCase()!==gen.toLowerCase();}); r.unshift(gen);
      sessionStorage.setItem("smd_ml_recents", JSON.stringify(r.slice(0,8))); }catch(_){} }
  var COMMON_MEDS = ["Pantoprazole","Metformin","Atorvastatin","Aspirin","Amlodipine",
    "Furosemide","Metoprolol","Clopidogrel","Ondansetron","Enoxaparin"];
  // Build a search-row object for a known generic (via the on-device formulary).
  function genToRow(gen){
    var d=(window.MEDDRUGS&&window.MEDDRUGS.findByName)?window.MEDDRUGS.findByName(gen):null;
    if(d){ var rows=(window.MEDDRUGS.searchIndex?window.MEDDRUGS.searchIndex(d.generic.toLowerCase()):[]);
      for(var i=0;i<rows.length;i++) if(rows[i].generic===d.generic) return rows[i];
      return { generic:d.generic, cls:d.cls, brands:(d.brands||[]).slice(0,4), form:"" }; }
    return { generic:gen, cls:"", brands:[], form:"" };
  }
  function checkAndPromptDuplicate(entry) {
    var g = (entry.generic || "").toLowerCase().trim();
    if (!g) return { action: "add" };
    var list = getList();

    // 1. Check for exact duplicate: same clinical ingredient + same strength/unit + same route + same form
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var mg = (m.generic || "").toLowerCase().trim();
      if (mg === g && m.strength === entry.strength && m.unit === entry.unit && m.route === entry.route && m.form === entry.form) {
        var drugLabel = cap(entry.brand || entry.name || entry.generic);
        var update = window.confirm(drugLabel + " is already in the medication list. Update dose instead?");
        if (update) {
          return { action: "update", id: m.id, entry: entry };
        } else {
          return { action: "cancel" };
        }
      }
    }

    // 2. Check for different strength/dose: same clinical ingredient, but different strength or route/form
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var mg = (m.generic || "").toLowerCase().trim();
      if (mg === g) {
        var drugLabel = cap(entry.brand || entry.name || entry.generic);
        var update = window.confirm(drugLabel + " is already in the list at a different dose. Update the existing dose? (Select Cancel to allow a separate dose entry)");
        if (update) {
          return { action: "update", id: m.id, entry: entry };
        } else {
          return { action: "add" };
        }
      }
    }

    return { action: "add" };
  }

  function updateMed(id, newEntry) {
    var i = _list.findIndex(function (m) { return m.id === id; });
    if (i >= 0) {
      _list[i] = Object.assign({}, _list[i], {
        brand: newEntry.brand || _list[i].brand,
        generic: newEntry.generic || _list[i].generic,
        strength: newEntry.strength != null ? newEntry.strength : _list[i].strength,
        unit: newEntry.unit || _list[i].unit,
        form: newEntry.form || _list[i].form,
        route: newEntry.route || _list[i].route,
        freq: newEntry.freq || _list[i].freq,
        freqText: newEntry.freqText || _list[i].freqText,
        confidence: newEntry.confidence || _list[i].confidence,
        candidates: newEntry.candidates || _list[i].candidates
      });
      _persist();
    }
  }

  // Central add path for interactive single-add: prevents exact-generic duplicates
  // (a warning, per spec) and records a recent. Bulk imports (paste/scan/ward) use add() directly.
  function uiAdd(entry, source){
    var res = checkAndPromptDuplicate(entry);
    if (res.action === "cancel") {
      return false;
    }
    if (res.action === "update") {
      updateMed(res.id, entry);
      if (entry.generic) pushRecent(entry.generic);
      return true;
    }
    // res.action === "add"
    add(entry, source);
    if (entry.generic) pushRecent(entry.generic);
    return true;
  }

  function fieldSummary(med){ return fieldLine(med); }

  function renderProductCard(med, isSub) {
    // compact ROW (not a large card): title · dose/route/freq · source badge · edit/remove
    var row = el("div", { cls: isSub ? "ml-sub-row" : "ml-row", attrs: { "data-ml-card": med.id } });

    if (_undoingId === med.id) {
      row.className = isSub ? "ml-sub-row-removed" : "ml-card-removed";
      var urow = el("div", { cls: "ml-undo-row" });
      urow.appendChild(el("span", { text: (med.generic || med.raw || "Medicine") + " removed" }));
      var undoBtn = el("button", { cls: "ml-undo-btn", text: "Undo", attrs: { "data-ml-undo": med.id, type: "button" } });
      undoBtn.addEventListener("click", function () { clearUndoTimer(); _undoingId = null; undoRemove(); render(); });
      urow.appendChild(undoBtn);
      row.appendChild(urow);
      return row;
    }

    var main = el("div", { cls: "ml-row-main" });
    if (!isSub) {
      var title = el("div", { cls: "ml-row-title" + (med.generic ? "" : " ml-row-unmapped"),
        text: med.generic ? cap(med.generic) : (med.raw || "Needs review") });
      main.appendChild(title);
    }
    var line = fieldSummary(med);
    if (isSub) {
      var subTitle = el("div", { cls: "ml-sub-row-title", text: line || "Unspecified dose" });
      main.appendChild(subTitle);
    } else {
      if (line) main.appendChild(el("div", { cls: "ml-row-line", text: line }));
    }
    var badges = el("div", { cls: "ml-row-badges" });
    var src = med.source || "manual";
    var srcLabel = { index: "Drug Index", ghis: "Ward Sync", wardsync: "Ward Sync", scan: "Scan", paste: "Manual", manual: "Manual" }[src] || cap(src);
    badges.appendChild(el("span", { cls: "ml-source-badge ml-source-" + src, text: srcLabel }));
    if (med.source === "scan" && med.confidence) badges.appendChild(el("span", { cls: "ml-conf-badge ml-conf-" + med.confidence, text: med.confidence }));
    if (!med.generic) badges.appendChild(el("span", { cls: "ml-conf-badge ml-conf-low", text: "unmapped" }));
    main.appendChild(badges);
    row.appendChild(main);

    var acts = el("div", { cls: "ml-row-acts" });
    var editBtn = el("button", { cls: "ml-icon-btn", html: mlIco("edit"), attrs: { "data-ml-edit": med.id, "aria-label": "Edit", title: "Edit", type: "button" } });
    editBtn.addEventListener("click", function () {
      clearUndoTimer(); _undoingId = null;
      _manualState.value = med.raw || med.generic || "";
      _manualState.parsed = parseEntry(_manualState.value);
      remove(med.id); _openAdd = "manual"; render();
    });
    var removeBtn = el("button", { cls: "ml-icon-btn ml-remove-btn", html: mlIco("trash"), attrs: { "data-ml-remove": med.id, "aria-label": "Remove", title: "Remove", type: "button" } });
    removeBtn.addEventListener("click", function () {
      remove(med.id); _undoingId = med.id; render();
      clearUndoTimer();
      _undoTimer = setTimeout(function () { if (_undoingId === med.id) _undoingId = null; _undoTimer = null; render(); }, 5000);
    });
    acts.appendChild(editBtn); acts.appendChild(removeBtn);
    row.appendChild(acts);
    return row;
  }

  function renderClinicalMedCard(clinicalMed) {
    if (clinicalMed.products.length === 1) {
      return renderProductCard(clinicalMed.products[0], false);
    }

    var card = el("div", { cls: "ml-row ml-row-grouped" });

    // Group header
    var header = el("div", { cls: "ml-row-group-header" });
    header.appendChild(el("div", { cls: "ml-row-title", text: clinicalMed.generic ? cap(clinicalMed.generic) : "Needs review" }));
    card.appendChild(header);

    // Group body / sub-rows
    var sublist = el("div", { cls: "ml-row-group-sublist" });
    for (var i = 0; i < clinicalMed.products.length; i++) {
      var prod = clinicalMed.products[i];
      sublist.appendChild(renderProductCard(prod, true));
    }
    card.appendChild(sublist);
    return card;
  }

  function renderMedCard(med) {
    return renderProductCard(med, false);
  }

  function renderCandidateChips(container, candidates, onPick) {
    var wrap = el("div", { cls: "ml-dym" });
    wrap.appendChild(el("div", { cls: "ml-dym-label", text: "Did you mean?" }));
    var chips = el("div", { cls: "ml-dym-chips" });
    candidates.forEach(function (c) {
      var chip = el("button", { cls: "ml-chip", text: cap(c.generic), attrs: { type: "button" } });
      chip.addEventListener("click", function () { onPick(c); });
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    container.appendChild(wrap);
  }

  // Empty-state action grid: Search Drug Index / Type · Paste / Scan / Ward Sync.
  // No raw input is shown until an action is tapped.
  function renderActionGrid(container) {
    var grid = el("div", { cls: "ml-action-grid" });
    function card(cls, ic, t, d, attrs, onClick) {
      var c = el("button", { cls: "ml-action-card " + cls, attrs: Object.assign({ type: "button" }, attrs || {}) });
      c.appendChild(el("span", { cls: "ml-action-ic", html: ic }));
      c.appendChild(el("span", { cls: "ml-action-t", text: t }));
      c.appendChild(el("span", { cls: "ml-action-d", text: d }));
      c.addEventListener("click", onClick);
      grid.appendChild(c);
      return c;
    }
    card("ml-action-primary", mlIco("search"), "Search Drug Index", "Find generic or brand medicines",
      { "data-ml-open": "index" }, function () { _openAdd = "index"; render(); });
    card("", mlIco("edit"), "Type / Paste list", "e.g. metformin 500 mg BD",
      { "data-ml-open": "paste" }, function () { _openAdd = "paste"; render(); });
    // Scan = on-device-first AI Vision (native ML Kit OCR) — hide on web.
    if (window.SMD_IS_NATIVE) card("", mlIco("camera"), "Scan prescription", "Prescription, OPD ticket, case sheet, PDF",
      { "data-ml-scan": "1" }, function () { startScan(); });
    card("", mlIco("hospital"), "Ward Sync", "Import current medication chart",
      { "data-ml-wardsync-card": "1" }, function () { wardPrimaryAction(); });
    container.appendChild(grid);

    // quick single-medicine typing entry (keeps a data-ml-open='manual' hook)
    var typeLink = el("button", { cls: "ml-mini-btn", html: mlIco("plus") + " Type one medicine",
      attrs: { "data-ml-open": "manual", type: "button" }, });
    typeLink.style.marginTop = "10px";
    typeLink.addEventListener("click", function () { _openAdd = "manual"; render(); });
    container.appendChild(typeLink);

    renderWardCard(container);
  }

  function wardReadyState() {
    var ready = false, pt = null;
    try { ready = !!(window.GHISMEDS && window.GHISMEDS.canFetch && window.GHISMEDS.canFetch()); } catch (e) {}
    try { pt = window.GHISMEDS && window.GHISMEDS.getSelectedPatient && window.GHISMEDS.getSelectedPatient(); } catch (e) {}
    return { ready: ready && !!pt, pt: pt };
  }
  function wardPrimaryAction() {
    var w = wardReadyState();
    if (w.ready) {
      if (window.GHISMEDS && window.GHISMEDS.fetchAndReview) {
        window.GHISMEDS.fetchAndReview(_root).then(function (r) { if (r && !r.ok) toast(r.message || "Could not fetch medication history."); });
      }
    } else {
      try { if (window.openGHIS) { window.openGHIS(); return; } } catch (e) {}
      toast("Open Ward Sync from the menu to pick a patient.");
    }
  }
  function renderWardCard(container) {
    var w = wardReadyState();
    var card = el("div", { cls: "ml-ward-card" });
    card.appendChild(el("div", { cls: "ml-ward-ic", html: mlIco("hospital") }));
    var body = el("div", { cls: "ml-ward-body" });
    if (w.ready) {
      body.appendChild(el("div", { cls: "ml-ward-t", text: "Ward Sync — " + ptInitials(w.pt.name) }));
      body.appendChild(el("div", { cls: "ml-ward-d", text: "Last sync: not fetched" }));
    } else {
      body.appendChild(el("div", { cls: "ml-ward-t", text: "Ward Sync" }));
      body.appendChild(el("div", { cls: "ml-ward-d", text: "Select a patient to import current medicines" }));
    }
    card.appendChild(body);
    var btn = el("button", { cls: "ml-ward-btn", attrs: { "data-ml-wardsync": "1", type: "button" },
      text: w.ready ? "Fetch medication history" : "Select patient" });
    btn.addEventListener("click", wardPrimaryAction);
    card.appendChild(btn);
    container.appendChild(card);
  }

  /* ---- bottom-sheet primitive (rendered inside _root so it sits over the workspace) ---- */
  function buildSheet(opts) {
    opts = opts || {};
    var scrim = el("div", { cls: "ml-scrim" });
    var sheet = el("div", { cls: "ml-sheet" });
    var wrap = el("div", { cls: "ml-sheet-wrap" });
    wrap.appendChild(el("div", { cls: "ml-sheet-grip" }));
    var head = el("div", { cls: "ml-sheet-head" });
    var titles = el("div");
    titles.appendChild(el("div", { cls: "ml-sheet-title", text: opts.title || "" }));
    if (opts.sub) titles.appendChild(el("div", { cls: "ml-sheet-sub", text: opts.sub }));
    head.appendChild(titles);
    var closeBtn = el("button", { cls: "ml-sheet-close", html: mlIco("close"), attrs: { "aria-label": "Close", type: "button" } });
    head.appendChild(closeBtn);
    wrap.appendChild(head);
    var body = el("div", { cls: "ml-sheet-body" });
    wrap.appendChild(body);
    var foot = el("div", { cls: "ml-sheet-foot" });
    sheet.appendChild(wrap);
    function close() { _openAdd = null; _indexState = { value: "", results: [], reqSeq: _indexState.reqSeq }; render(); }
    closeBtn.addEventListener("click", close);
    scrim.addEventListener("click", close);
    return { scrim: scrim, sheet: sheet, wrap: wrap, head: head, body: body, foot: foot, close: close };
  }
  function mountSheet(s) { if (!_root) return; _root.appendChild(s.scrim); _root.appendChild(s.sheet); }

  // Append the open add-sheet (index / manual / paste) to _root.
  function mountOpenSheet() {
    if (_openAdd === "index") mountSheet(buildIndexSheet());
    else if (_openAdd === "manual") mountSheet(buildManualSheet());
    else if (_openAdd === "paste") mountSheet(buildPasteSheet());
  }

  function resultRow(r, q) {
    var row = el("div", { cls: "ml-index-result" });
    var info = el("button", { cls: "ml-index-info", attrs: { type: "button" } });
    var gen = el("div", { cls: "ml-index-generic" }); gen.innerHTML = highlight(cap(r.generic), q); info.appendChild(gen);
    var meta = [r.cls, r.form].filter(function (x) { return x && x !== "—"; }).join(" · ");
    if (meta) info.appendChild(el("div", { cls: "ml-index-meta", text: meta }));
    if (r.brands && r.brands.length) {
      var b = el("div", { cls: "ml-index-brands" });
      b.innerHTML = "Brands: " + r.brands.slice(0, 4).map(function (x) { return highlight(cap(x), q); }).join(", ");
      info.appendChild(b);
    }
    info.addEventListener("click", function () { openDoseSheet(r); });
    row.appendChild(info);
    var addBtn = el("button", { cls: "ml-index-add", html: mlIco("plus") + " Add", attrs: { type: "button", "data-ml-index-result": "1" } });
    addBtn.addEventListener("click", function () { addFromResult(r); });
    row.appendChild(addBtn);
    return row;
  }
  function addFromResult(r) {
    var parsed = parseEntry(r.generic || r.brand || "");
    // Drug-Index compositions carry the strength inline ("Sildenafil (50mg)"). Store
    // the NORMALISED active ingredient as the clinical generic so product variants of
    // the same drug group + screen as one medicine (strength stays on the product row).
    if (r.generic) { parsed.generic = cleanGeneric(r.generic) || String(r.generic).toLowerCase(); parsed.confidence = "high"; }
    if (r.brand) parsed.brand = r.brand;
    if (uiAdd(parsed, "index")) toast("Added " + cap(r.generic || r.brand || "medicine"));
  }
  // Merge worker brand hits into the local list, deduped by resolved generic.
  function mergeWorker(local, workerRows) {
    var out = local.slice();
    var seen = {}; out.forEach(function (r) { seen[(r.generic || "").toLowerCase()] = 1; });
    (workerRows || []).forEach(function (w) {
      var gen = (w.generic || "").toLowerCase();
      if (!gen || seen[gen]) return;
      seen[gen] = 1;
      out.push({ generic: gen, cls: "", brands: w.brand ? [w.brand] : [], form: w.form || "" });
    });
    return out;
  }

  function buildIndexSheet() {
    var s = buildSheet({ title: "Search Drug Index", sub: "On-device formulary — instant, works offline" });
    s.sheet.classList.add("ml-sheet-tall");                 // tall surface: scrollable typeahead
    // Fixed search bar (stays put); the suggestion list below it scrolls.
    var bar = el("div", { cls: "ml-searchbar" });
    var input = el("input", { cls: "ml-search-input", type: "text",
      placeholder: "Search generic, brand, or class…", attrs: { "data-ml-index-input": "1", autocomplete: "off", autocapitalize: "none", spellcheck: "false" } });
    input.value = _indexState.value || "";
    bar.appendChild(input);
    s.wrap.insertBefore(bar, s.body);
    var out = el("div"); s.body.appendChild(out);

    function drawState(node, kind) {
      var box = el("div", { cls: "ml-state" + (kind === "offline" ? " ml-state-offline" : "") });
      if (kind === "loading") { box.innerHTML = '<span class="ml-spin" aria-hidden="true"></span>'; box.appendChild(el("span", { text: " Searching…" })); }
      else if (kind === "offline") { box.appendChild(el("span", { text: "Search unavailable — showing offline formulary." })); box.appendChild(el("span", { cls: "ml-state-sub", text: "Type the medicine name manually if it isn't listed." })); }
      else { box.appendChild(el("span", { text: "No medicines found." })); box.appendChild(el("span", { cls: "ml-state-sub", text: "Check spelling, or add it via Type / Paste." })); }
      node.appendChild(box);
    }
    function drawRows(rows, q, offline) {
      out.textContent = "";
      if (!q) {
        var rec = getRecents();
        if (rec.length) { out.appendChild(el("div", { cls: "ml-search-label", text: "Recent" }));
          var rw = el("div", { cls: "ml-index-results" }); rec.forEach(function (g) { rw.appendChild(resultRow(genToRow(g), "")); }); out.appendChild(rw); }
        out.appendChild(el("div", { cls: "ml-search-label", text: "Common medicines" }));
        var cw = el("div", { cls: "ml-index-results" }); COMMON_MEDS.forEach(function (g) { cw.appendChild(resultRow(genToRow(g), "")); }); out.appendChild(cw);
        return;
      }
      if (!rows.length) {
        drawState(out, offline ? "offline" : "empty");
        // typo suggestion via the parser's candidate resolver
        var cand = parseEntry(q).candidates || [];
        if (cand.length) renderCandidateChips(out, cand.slice(0, 4), function (c) { addFromResult({ generic: c.generic, brands: [] }); });
        return;
      }
      var wrap = el("div", { cls: "ml-index-results" });
      rows.forEach(function (r) { wrap.appendChild(resultRow(r, q)); });
      out.appendChild(wrap);
      if (offline) { var note = el("div", { cls: "ml-state ml-state-offline" }); note.appendChild(el("span", { cls: "ml-state-sub", text: "Online brand search unavailable — showing on-device matches." })); out.appendChild(note); }
    }
    function run() {
      var q = input.value.trim();
      _indexState.value = input.value;
      if (!q) { drawRows([], ""); return; }
      var local = (window.MEDDRUGS && window.MEDDRUGS.searchIndex) ? window.MEDDRUGS.searchIndex(q) : [];
      drawRows(local, q, false);                       // instant local
      var seq = ++_indexState.reqSeq;
      var p; try { p = window.MEDLIST.brandSearch(q); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (res) {
        if (seq !== _indexState.reqSeq) return;
        drawRows(mergeWorker(local, res || []), q, false);
      }).catch(function () {
        if (seq !== _indexState.reqSeq) return;
        drawRows(local, q, true);                       // honest offline fallback
      });
    }
    input.addEventListener("input", run);
    run();
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 60);
    return s;
  }

  // Compact dose sheet — refine formulation/strength/route/frequency before adding.
  // No field is required (spec): tapping Add uses whatever is set.
  var ROUTE_OPTS = ["PO", "IV", "IM", "SC", "SL", "Neb", "PR", "Topical"];
  var FREQ_OPTS = ["OD", "BD", "TDS", "QID", "HS", "STAT", "PRN"];
  function openDoseSheet(r) {
    if (!_root) return;
    var seed = parseEntry(r.generic || r.brand || "");
    // Normalise the composition to its bare active ingredient (see addFromResult).
    if (r.generic) { seed.generic = cleanGeneric(r.generic) || String(r.generic).toLowerCase(); seed.confidence = "high"; }
    if (r.brand) seed.brand = r.brand;
    var draft = { strength: seed.strength || "", unit: seed.unit || "mg", route: seed.route || "", freq: seed.freq || "", indication: "" };
    var s = buildSheet({ title: cap(r.generic || r.brand || "Medicine"), sub: [r.cls, (r.brands || []).slice(0, 3).map(cap).join(", ")].filter(Boolean).join(" · ") });
    var grid = el("div", { cls: "ml-dose-grid" });
    function field(label, node, full) { var f = el("div", { cls: "ml-field" + (full ? " ml-field-full" : "") }); f.appendChild(el("div", { cls: "ml-field-label", text: label })); f.appendChild(node); return f; }
    var strengthInp = el("input", { cls: "ml-input", type: "text", placeholder: "e.g. 40", attrs: { inputmode: "decimal" } });
    strengthInp.value = draft.strength; strengthInp.addEventListener("input", function () { draft.strength = strengthInp.value; });
    grid.appendChild(field("Strength", strengthInp));
    var unitInp = el("input", { cls: "ml-input", type: "text", placeholder: "mg / g / mL" });
    unitInp.value = draft.unit; unitInp.addEventListener("input", function () { draft.unit = unitInp.value; });
    grid.appendChild(field("Unit", unitInp));
    var routeRow = el("div", { cls: "ml-chip-row" });
    ROUTE_OPTS.forEach(function (rt) { var c = el("button", { cls: "ml-chip" + (draft.route === rt ? " on" : ""), text: rt, attrs: { type: "button" } });
      c.addEventListener("click", function () { draft.route = draft.route === rt ? "" : rt; routeRow.querySelectorAll(".ml-chip").forEach(function (x) { x.classList.toggle("on", x.textContent === draft.route); }); }); routeRow.appendChild(c); });
    grid.appendChild(field("Route", routeRow, true));
    var freqRow = el("div", { cls: "ml-chip-row" });
    FREQ_OPTS.forEach(function (fq) { var c = el("button", { cls: "ml-chip" + (draft.freq === fq ? " on" : ""), text: fq, attrs: { type: "button" } });
      c.addEventListener("click", function () { draft.freq = draft.freq === fq ? "" : fq; freqRow.querySelectorAll(".ml-chip").forEach(function (x) { x.classList.toggle("on", x.textContent === draft.freq); }); }); freqRow.appendChild(c); });
    grid.appendChild(field("Frequency", freqRow, true));
    var indInp = el("input", { cls: "ml-input", type: "text", placeholder: "Optional — why it's prescribed" });
    indInp.addEventListener("input", function () { draft.indication = indInp.value; });
    grid.appendChild(field("Indication (optional)", indInp, true));
    s.body.appendChild(grid);
    var addBtn = el("button", { cls: "ml-check-btn", text: "Add medicine", attrs: { type: "button" } });
    addBtn.addEventListener("click", function () {
      var entry = Object.assign({}, seed);
      if (draft.strength !== "") { var n = parseFloat(draft.strength); if (!isNaN(n)) { entry.strength = n; entry.unit = draft.unit || entry.unit; } }
      if (draft.route) entry.route = draft.route;
      if (draft.freq) entry.freq = draft.freq;
      if (draft.indication) entry.indication = draft.indication;
      if (uiAdd(entry, "index")) { toast("Added " + cap(r.generic || r.brand || "medicine")); s.scrim.remove(); s.sheet.remove(); }
    });
    s.foot.appendChild(el("button", { cls: "ml-sheet-cancel", text: "Cancel", attrs: { type: "button" } })).addEventListener("click", function () { s.scrim.remove(); s.sheet.remove(); });
    s.foot.appendChild(addBtn);
    s.wrap.appendChild(s.foot);
    // dose sheet layers over the search sheet; closing it just removes it (keeps search open)
    s.close = function () { s.scrim.remove(); s.sheet.remove(); };
    s.scrim.addEventListener("click", s.close);
    mountSheet(s);
  }

  function buildManualSheet() {
    var s = buildSheet({ title: "Type a medicine", sub: "One medicine — we parse dose, route and frequency" });
    var input = el("input", { cls: "ml-input", type: "text", placeholder: "e.g. metformin 500 mg BD",
      attrs: { "data-ml-manual-input": "1", autocomplete: "off" } });
    input.value = _manualState.value || "";
    s.body.appendChild(input);
    var preview = el("div"); s.body.appendChild(preview);
    function drawPreview() {
      preview.textContent = "";
      var parsed = _manualState.parsed;
      if (!parsed) return;
      var pv = el("div", { cls: "ml-paste-item" });
      pv.appendChild(el("span", { text: parsed.generic ? cap(parsed.generic) : (parsed.raw || "…") }));
      var line = fieldSummary(parsed); if (line) { var sub = el("span", { cls: "ml-paste-item-sub", text: line }); pv.appendChild(sub); }
      preview.appendChild(pv);
      if (!parsed.generic && parsed.candidates && parsed.candidates.length) {
        renderCandidateChips(preview, parsed.candidates, function (c) {
          var p = Object.assign({}, parsed, { generic: c.generic, confidence: "high" });
          if (uiAdd(p, "manual")) s.close();
        });
      }
    }
    input.addEventListener("input", function () { _manualState.value = input.value; _manualState.parsed = input.value.trim() ? parseEntry(input.value) : null; drawPreview(); });
    drawPreview();
    var addBtn = el("button", { cls: "ml-check-btn", text: "Add medicine", attrs: { "data-ml-manual-add": "1", type: "button" } });
    addBtn.addEventListener("click", function () {
      var v = _manualState.value.trim(); if (!v) return;
      if (uiAdd(parseEntry(v), "manual")) { _manualState = { value: "", parsed: null }; s.close(); }
    });
    s.foot.appendChild(el("button", { cls: "ml-sheet-cancel", text: "Cancel", attrs: { type: "button" } })).addEventListener("click", s.close);
    s.foot.appendChild(addBtn);
    s.wrap.appendChild(s.foot);
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 60);
    return s;
  }

  function buildPasteSheet() {
    var s = buildSheet({ title: "Add medicines", sub: "Paste or type one medicine per line" });
    var ta = el("textarea", { cls: "ml-textarea", attrs: { "data-ml-paste-input": "1", spellcheck: "false" },
      placeholder: "metformin 500 mg BD\ntelmisartan 40 mg OD\ninj ceftriaxone 1 g IV BD" });
    ta.value = _pasteState.value || "";
    s.body.appendChild(ta);
    var reviewWrap = el("div"); s.body.appendChild(reviewWrap);
    function drawReview() {
      reviewWrap.textContent = "";
      if (!_pasteState.rows.length) return;
      reviewWrap.appendChild(el("div", { cls: "ml-search-label", text: _pasteState.rows.length + " detected" }));
      var list = el("div", { cls: "ml-paste-list" });
      _pasteState.rows.forEach(function (row, idx) {
        var item = el("label", { cls: "ml-paste-item", attrs: { "data-ml-paste-item": String(idx) } });
        var cb = el("input", { type: "checkbox" }); cb.checked = row.include;
        cb.addEventListener("change", function () { row.include = cb.checked; });
        item.appendChild(cb);
        var txt = el("div");
        txt.appendChild(el("span", { text: row.entry.generic ? cap(row.entry.generic) : (row.entry.raw || "Unnamed") }));
        var line = fieldSummary(row.entry); if (line) txt.appendChild(el("div", { cls: "ml-paste-item-sub", text: line }));
        if (!row.entry.generic) txt.appendChild(el("div", { cls: "ml-paste-item-sub", text: "needs review" }));
        item.appendChild(txt);
        list.appendChild(item);
      });
      reviewWrap.appendChild(list);
    }
    ta.addEventListener("input", function () {
      _pasteState.value = ta.value;
      var parsedList = _pasteState.value.trim() ? parsePasted(_pasteState.value) : [];
      _pasteState.rows = parsedList.map(function (entry) { return { entry: entry, include: true }; });
      drawReview();
    });
    drawReview();
    var addBtn = el("button", { cls: "ml-check-btn", text: "Add medicines", attrs: { "data-ml-paste-add": "1", type: "button" } });
    addBtn.addEventListener("click", function () {
      var added = 0;
      _pasteState.rows.forEach(function (row) { if (row.include) { add(row.entry, "paste"); if (row.entry.generic) pushRecent(row.entry.generic); added++; } });
      _pasteState = { value: "", rows: [] };
      s.close();
      if (added) toast("Added " + added + " medicine" + (added > 1 ? "s" : ""));
    });
    s.foot.appendChild(el("button", { cls: "ml-sheet-cancel", text: "Cancel", attrs: { type: "button" } })).addEventListener("click", s.close);
    s.foot.appendChild(addBtn);
    s.wrap.appendChild(s.foot);
    setTimeout(function () { try { ta.focus(); } catch (_) {} }, 60);
    return s;
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
      box.appendChild(el("div", { cls: "ml-scan-spin", attrs: { "aria-hidden": "true" } }));
      box.appendChild(el("div", { text: msg }));
    }
    ov.appendChild(box);
  }
  function scanProgressDone() { if (_root) { var ov = _root.querySelector(".ml-scan-ov"); if (ov) ov.remove(); } }

  // Open the OS file/camera picker (image or PDF). Camera capture on mobile.
  function startScan() {
    // Native: <input type=file>.click() opens no picker in WKWebView — use the Camera
    // plugin (Camera/Photos action sheet) and feed the dataUrl into the SAME OCR path.
    // NOTE: Camera returns IMAGES only — PDF scan stays web-only.
    if (window.SMD_IS_NATIVE && window.SMD_NATIVE) {
      window.SMD_NATIVE.pickImage({ prompt: true }).then(function (dataUrl) {
        scanProgress("Compressing image…");
        _compressImage(dataUrl, function (d) {
          if (!d) return scanProgress("Could not read this image.", true);
          runScanOcr(d);
        });
      }).catch(function () {});
      return;
    }
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
    // Absolute backstop: on native, a stalled on-device OCR / vision call can otherwise leave
    // this spinner up forever (seen on some iPhones where Apple Vision OCR never returned).
    // The native plugin now self-times-out too, but race here as well so the UI ALWAYS recovers
    // with a clear next step even if the bridge never settles. (CapacitorHttp ignores
    // AbortController, so a plain setTimeout race is the reliable guard — see reasoning.js.)
    var settled = false;
    var _t0 = Date.now();
    // Diagnostics: append a compact trace (elapsed + last scan stage) to any error/timeout so a
    // device that struggles can be pinpointed even without a tethered Mac. window.__SMD_SCAN_DIAG
    // is set by SMD_AI.readImage; also mirrored to the console with the [SMD-SCAN] prefix.
    function diagLine() {
      var d = window.__SMD_SCAN_DIAG;
      var secs = ((Date.now() - _t0) / 1000).toFixed(1);
      var extra = d ? (" · " + (d.stage || "?") + (d.lines != null ? " · " + d.lines + " lines" : "") + (d.ocrMs != null ? " · ocr " + d.ocrMs + "ms" : "")) : "";
      return " (" + secs + "s" + extra + ")";
    }
    function done(msg, err) { scanProgressDone(); scanProgress(msg + diagLine(), err); try { console.info("[SMD-SCAN] result", msg, window.__SMD_SCAN_DIAG || {}); } catch (e) {} }
    var timer = setTimeout(function () {
      if (settled) return; settled = true;
      done("Reading the image timed out. Try a clearer, well-lit photo, or enter medicines manually.", true);
    }, 45000);
    Promise.resolve().then(function () { return fn(dataUrl); }).then(function (rows) {
      if (settled) return; settled = true; clearTimeout(timer);
      scanProgressDone();
      if (!rows || !rows.length) { done("No medicines could be read confidently. Please enter them manually.", true); return; }
      _openScanReview(rows, dataUrl);
    }).catch(function () {
      if (settled) return; settled = true; clearTimeout(timer);
      done("Could not read the image. Enter medicines manually.", true);
    });
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
        var flag = el("div", { cls: "ml-scan-flag", html: mlIco("warn") + " Review manually — not confidently mapped" });
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

  // Transient hint shown when the Ward-Sync fetch is unavailable / errored.
  function wardHint(msg) {
    if (!_root) return;
    var existing = _root.querySelector(".ml-ward-hint");
    if (existing) { existing.textContent = msg; return; }
    var body = _root.querySelector(".ml-body") || _root;
    body.appendChild(el("div", { cls: "ml-ward-hint", text: msg }));
  }

  function hasResolvedGeneric() {
    return getList().some(function (m) { return m.generic && typeof m.generic === "string" && m.generic.trim(); });
  }

  var REVIEW_DIMENSIONS = ["Drug–drug interactions", "Duplicate therapy", "Bleeding risk",
    "QT prolongation", "Renal risk", "Hyperkalaemia", "CNS depression"];

  function renderReviewAside(container) {
    var card = el("div", { cls: "ml-aside-card" });
    card.appendChild(el("div", { cls: "ml-aside-title", text: "Interaction check reviews" }));
    var list = el("div", { cls: "ml-review-list" });
    REVIEW_DIMENSIONS.forEach(function (d) { list.appendChild(el("div", { cls: "ml-review-chip", text: d })); });
    card.appendChild(list);
    card.appendChild(el("div", { cls: "ml-aside-note",
      text: "Medication-based. Add renal function, QTc or electrolytes in the case for more tailored cautions." }));
    container.appendChild(card);
  }

  function render() {
    if (!_root) return;
    if (_view === "results") { renderResults(); return; }
    if (_view === "scan") { renderScan(); return; }
    _root.textContent = "";
    _root.classList.add("ml-root");

    var list = getList();
    var showUndoRow = _undoingId && _lastRemoved && _lastRemoved.med && _lastRemoved.med.id === _undoingId;
    
    // Group selected medications into clinical medications
    var clinicalList = getClinicalList(list);
    var resolved = clinicalList.filter(function (m) { return m.generic && String(m.generic).trim(); }).length;
    var present = clinicalList.filter(function (m) {
      return (m.generic && String(m.generic).trim()) || (m.name && String(m.name).trim()) || (m.raw && String(m.raw).trim());
    }).length;

    var work = el("div", { cls: "ml-work" });
    var main = el("div", { cls: "ml-main" });
    var aside = el("div", { cls: "ml-aside" });

    if (!list.length && !showUndoRow) {
      // ---- empty state: heading + action grid (no raw input shown yet) ----
      var head = el("div", { cls: "ml-empty-head" });
      head.appendChild(el("div", { cls: "ml-empty-title", text: "Medication list" }));
      head.appendChild(el("div", { cls: "ml-empty-sub",
        text: "Add medicines from Drug Index, type a prescription, scan a case sheet, or import from Ward Sync." }));
      main.appendChild(head);
      renderActionGrid(main);
    } else {
      // ---- populated list ----
      var lh = el("div", { cls: "ml-list-head" });
      var countText = present + " medicine" + (present !== 1 ? "s" : "") + " selected";
      lh.appendChild(el("div", { cls: "ml-list-count", text: resolved || clinicalList.length ? countText : "Medication list" }));
      lh.appendChild(el("div", { cls: "ml-list-updated", text: "Last updated just now" }));
      main.appendChild(lh);

      var actions = el("div", { cls: "ml-list-actions" });
      var addMore = el("button", { cls: "ml-mini-btn ml-mini-btn-primary", html: mlIco("plus") + " Add medicine", attrs: { type: "button", "data-ml-add-more": "1" } });
      addMore.addEventListener("click", function () { _openAdd = "index"; render(); });
      var clearBtn = el("button", { cls: "ml-mini-btn", text: "Clear all", attrs: { type: "button" } });
      clearBtn.addEventListener("click", function () { clearAll(); _openAdd = null; render(); });
      var saveBtn = el("button", { cls: "ml-mini-btn", text: "Save draft", attrs: { type: "button" } });
      saveBtn.addEventListener("click", function () { try { localStorage.setItem("smd_medlist_draft", JSON.stringify(getList())); } catch (_) {} toast("Draft saved"); });
      actions.appendChild(addMore); actions.appendChild(clearBtn); actions.appendChild(saveBtn);
      main.appendChild(actions);

      var rows = el("div", { cls: "ml-rows", attrs: { id: "ml-cards" } });
      if (showUndoRow) rows.appendChild(renderMedCard(_lastRemoved.med));
      clinicalList.forEach(function (clinicalMed) { rows.appendChild(renderClinicalMedCard(clinicalMed)); });
      main.appendChild(rows);

      // "Import more" surfaces the action grid again beneath the list.
      var moreLabel = el("div", { cls: "ml-search-label", text: "Add more" });
      main.appendChild(moreLabel);
      renderActionGrid(main);
    }

    renderReviewAside(aside);
    work.appendChild(main); work.appendChild(aside);
    _root.appendChild(work);

    // ---- sticky CTA (always visible, count-aware) ----
    var footer = el("div", { cls: "ml-footer" });
    var inner = el("div", { cls: "ml-footer-inner" });
    var canCheck = present >= 2;
    var checkBtn = el("button", { cls: "ml-check-btn",
      text: present > 0 ? ("Check " + present + " medicine" + (present !== 1 ? "s" : "")) : "Check interactions",
      attrs: { id: "ml-check", type: "button" } });
    if (!canCheck) checkBtn.disabled = true;
    checkBtn.addEventListener("click", function () { if (!checkBtn.disabled) runCheck(); });
    inner.appendChild(checkBtn);
    if (!canCheck) inner.appendChild(el("div", { cls: "ml-footer-hint", text: "Add at least 2 medicines to check interactions." }));
    footer.appendChild(inner);
    _root.appendChild(footer);

    mountOpenSheet();
  }

  // Last-chance brand resolution: for any medicine we could NOT map to a generic
  // locally (typed or pasted brand not in the seed/formulary/pipeline maps), ask
  // the drug-catalogue API to map brand -> composition. Auto-adopt ONLY when the
  // API is unambiguous (one distinct single-ingredient composition); anything
  // ambiguous is left unresolved and surfaced in the coverage warning.
  function apiResolveBrand(name) {
    if (!name) return Promise.resolve(null);
    // Call the public brandSearch (same fn) at call-time so tests can stub it.
    var fn = (window.MEDLIST && typeof window.MEDLIST.brandSearch === "function") ? window.MEDLIST.brandSearch : brandSearch;
    var p; try { p = fn(name); } catch (e) { p = Promise.resolve([]); }
    return Promise.resolve(p).then(function (cands) {
      var comps = {};
      (cands || []).forEach(function (c) {
        var g = (c.generic || "").toLowerCase().trim();
        if (g) comps[g] = (comps[g] || 0) + 1;
      });
      var keys = Object.keys(comps);
      if (keys.length === 1 && keys[0].indexOf(" + ") === -1) return keys[0];
      return null;
    }).catch(function () { return null; });
  }
  function resolveUnresolvedViaApi() {
    var pending = getList().filter(function (m) {
      return (!m.generic || !String(m.generic).trim()) && (m.name || m.raw);
    });
    if (!pending.length) return Promise.resolve(0);
    return Promise.all(pending.map(function (m) {
      return apiResolveBrand(m.name || m.raw).then(function (g) {
        if (g) { m.generic = g; m.confidence = "high"; m.apiResolved = true; return 1; }
        return 0;
      });
    })).then(function (rs) { return rs.reduce(function (a, b) { return a + b; }, 0); });
  }

  function runCheck() {
    if (!window.INTERACTIONS || typeof window.INTERACTIONS.checkInteractions !== "function") return;
    // Resolve any locally-unmapped brand via the catalogue API, THEN screen.
    resolveUnresolvedViaApi().then(function () {
      _results = window.INTERACTIONS.checkInteractions(getList());
      _view = "results";
      _hideMinor = true;
      render();
    });
  }

  // After an in-results edit (e.g. "What now? → Remove X"), re-run the check if 2+
  // medicines remain, else drop back to the list.
  function recheckAfterEdit() {
    var resolved = getList().filter(function (m) { return m.generic && String(m.generic).trim(); });
    if (resolved.length >= 2 && window.INTERACTIONS && window.INTERACTIONS.checkInteractions) {
      _results = window.INTERACTIONS.checkInteractions(getList());
      _view = "results"; render();
    } else {
      _view = "list"; render();
      toast("Fewer than 2 medicines left — add more to re-check.");
    }
  }
  function removeGenericAndRecheck(generic) {
    generic = (generic || "").toLowerCase();
    getList().forEach(function (m) { if ((m.generic || "").toLowerCase() === generic) remove(m.id); });
    toast("Removed " + cap(generic));
    recheckAfterEdit();
  }

  // --- Results screen -------------------------------------------------------
  var SEVERITY_LABEL = {
    critical: "Critical",
    major: "Major",
    moderate: "Moderate",
    minor: "Minor",
    monitor: "Monitor"
  };
  function findingCard(finding) {
    // Severity is conveyed by the TEXT label (Critical / Major / … — color-independent),
    // not by a standalone symbol glyph.
    var bucket = SEVERITY_BUCKET_CLASS[finding.severity] || "monitor";
    var card = el("div", { cls: "mlr-card mlr-card-" + bucket });

    var head = el("div", { cls: "mlr-card-head" });
    head.appendChild(el("div", { cls: "mlr-card-pair", text: (finding.drugs || []).join(" + ") || "Medicine" }));
    var sevLabel = SEVERITY_LABEL[bucket] || "Caution";
    var badge = el("span", { cls: "mlr-sev mlr-sev-" + bucket });
    badge.appendChild(el("span", { cls: "mlr-sev-text", text: sevLabel }));
    head.appendChild(badge);
    card.appendChild(head);

    // one-line consequence, then the action line
    var consequence = finding.effect || finding.mechanism || "";
    if (consequence) card.appendChild(el("div", { cls: "mlr-consequence", text: consequence }));
    if (finding.action) card.appendChild(detailRow("Action", finding.action));

    // "Why?" expand — mechanism / monitoring / source disclosure + optional MaiK explain.
    var why = el("div", { cls: "mlr-why" });
    var whyBtn = el("button", { cls: "mlr-explain-btn", text: "Why? · details", attrs: { type: "button", "aria-expanded": "false" } });
    var whyBody = el("div", { attrs: { hidden: "hidden" } });
    if (finding.mechanism && finding.mechanism !== consequence) whyBody.appendChild(detailRow("Mechanism", finding.mechanism));
    if (finding.monitoring) whyBody.appendChild(detailRow("Monitoring", finding.monitoring));
    if (finding.source) whyBody.appendChild(detailRow("Source", finding.source));

    // Optional MaiK "explain this interaction" — DISPLAY-ONLY; can never change the
    // severity/marker above, add/remove findings, or alter the summary counts.
    var explainWrap = el("div", { cls: "mlr-explain-wrap" });
    var explainBtn = el("button", { cls: "mlr-explain-btn", text: "Explain in plain language",
      attrs: { type: "button", "aria-label": "Explain this interaction" } });
    var explainOut = el("div", { cls: "mlr-explain-out", attrs: { hidden: "hidden" } });
    explainBtn.addEventListener("click", function () {
      if (explainBtn.disabled) return;
      explainBtn.disabled = true;
      explainBtn.textContent = "Loading explanation…";
      var p;
      try { p = window.MEDLIST.explainInteraction(finding); }
      catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (text) {
        renderExplanation(explainOut, String(text || ""));
        explainBtn.textContent = "Explanation shown";
      }).catch(function () {
        renderExplanation(explainOut, "Couldn't load explanation — the interaction result stands.", true);
        explainBtn.disabled = false;
        explainBtn.textContent = "Explain in plain language";
      });
    });
    explainWrap.appendChild(explainBtn); explainWrap.appendChild(explainOut);
    whyBody.appendChild(explainWrap);

    whyBtn.addEventListener("click", function () {
      var closed = whyBody.hasAttribute("hidden");
      if (closed) { whyBody.removeAttribute("hidden"); whyBtn.setAttribute("aria-expanded", "true"); whyBtn.textContent = "Hide details"; }
      else { whyBody.setAttribute("hidden", "hidden"); whyBtn.setAttribute("aria-expanded", "false"); whyBtn.textContent = "Why? · details"; }
    });
    why.appendChild(whyBody);

    // "What now?" — the concrete next step: remove (or plan to replace) an implicated
    // drug, then re-check. Turns the finding into a decision, not just a warning.
    var whatBtn = el("button", { cls: "mlr-whatnow-btn", text: "What now?", attrs: { type: "button", "aria-expanded": "false" } });
    var whatBody = el("div", { cls: "mlr-whatnow", attrs: { hidden: "hidden" } });
    whatBody.appendChild(el("div", { cls: "mlr-whatnow-lead",
      text: finding.action || "Review whether all these medicines are needed; stop or replace the least essential, or apply the monitoring above." }));
    var inList = (finding.drugs || []).filter(function (g) { return hasGeneric(g); });
    if (inList.length) {
      whatBody.appendChild(el("div", { cls: "mlr-whatnow-label", text: "Remove a medicine and re-check:" }));
      var acts = el("div", { cls: "mlr-whatnow-actions" });
      inList.forEach(function (g) {
        var b = el("button", { cls: "mlr-remove-drug", text: "× Remove " + cap(g), attrs: { type: "button" } });
        b.addEventListener("click", function () { removeGenericAndRecheck(g); });
        acts.appendChild(b);
      });
      whatBody.appendChild(acts);
    }
    whatBody.appendChild(el("div", { cls: "mlr-whatnow-note",
      text: "Or keep them with a clear indication and add the monitoring above. To swap a drug, remove it here then add the alternative. Always confirm against local protocol." }));
    whatBtn.addEventListener("click", function () {
      var closed = whatBody.hasAttribute("hidden");
      if (closed) { whatBody.removeAttribute("hidden"); whatBtn.setAttribute("aria-expanded", "true"); }
      else { whatBody.setAttribute("hidden", "hidden"); whatBtn.setAttribute("aria-expanded", "false"); }
    });

    var controls = el("div", { cls: "mlr-controls" });
    controls.appendChild(whatBtn); controls.appendChild(whyBtn);
    card.appendChild(controls);
    card.appendChild(whatBody);
    card.appendChild(why);
    return card;
  }

  // Render the AI explanation as a clearly-labelled, display-only secondary block.
  // Text is set via textContent only (never innerHTML) so nothing from the AI can
  // inject markup, and no raw JSON/ids/provider strings leak into the DOM.
  function renderExplanation(container, text, isError) {
    container.textContent = "";
    container.removeAttribute("hidden");
    container.classList.toggle("mlr-explain-err", !!isError);
    if (!isError) {
      container.appendChild(el("div", { cls: "mlr-explain-label", text: "Explanation" }));
      container.appendChild(el("div", { cls: "mlr-explain-note",
        text: "AI explanation of this rule — the interaction finding above is unchanged." }));
    }
    container.appendChild(el("div", { cls: "mlr-explain-body", text: text }));
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

  function summaryChip(container, cls, label, count) {
    var c = el("div", { cls: "mlr-chip mlr-chip-" + cls + (count ? "" : " mlr-chip-zero") });
    c.appendChild(el("span", { cls: "mlr-chip-num", text: String(count) }));
    c.appendChild(el("span", { text: label }));
    container.appendChild(c);
  }
  function notDuplicate(f) { return !/duplicate/.test(f.ruleType || ""); }

  function renderResults() {
    _root.textContent = "";
    _root.classList.add("ml-root");
    var res = _results || { critical: [], major: [], moderate: [], minor: [], monitor: [], duplicates: [], combinations: [], reviewedCount: 0 };
    var cov = res.coverage || { submittedCount: res.reviewedCount, reviewedCount: res.reviewedCount, classifiedCount: res.reviewedCount, unclassified: [], unchecked: [], datasetVersion: "" };

    var work = el("div", { cls: "ml-work" });
    work.style.gridTemplateColumns = "1fr";              // results are single-column
    var main = el("div", { cls: "ml-main" });

    // ---- strong summary panel: title + reviewed count + severity count chips ----
    var panel = el("div", { cls: "mlr-summary-panel" });
    panel.appendChild(el("div", { cls: "mlr-summary-title", text: "Medication Safety Summary" }));
    var checkedN = cov.reviewedCount, submittedN = cov.submittedCount || res.reviewedCount;
    panel.appendChild(el("div", { cls: "mlr-summary-sub",
      text: checkedN + " of " + submittedN + " medicine" + (submittedN !== 1 ? "s" : "") + " checked" }));
    var monitorCount = res.monitor.filter(notDuplicate).length + res.moderate.filter(notDuplicate).length;
    var chips = el("div", { cls: "mlr-chips" });
    summaryChip(chips, "critical", "Critical", res.critical.length);
    summaryChip(chips, "major", "Major", res.major.length);
    summaryChip(chips, "monitor", "Monitoring", monitorCount);
    summaryChip(chips, "duplicate", "Duplicate", (res.duplicates || []).length);
    panel.appendChild(chips);
    panel.appendChild(el("div", { cls: "ml-aside-note",
      text: "Interaction check is medication-based. Add renal function, electrolytes, QTc, or patient context for more tailored cautions." }));
    if (cov.datasetVersion) panel.appendChild(el("div", { cls: "mlr-dataset-note",
      text: "Interaction dataset " + cov.datasetVersion }));
    main.appendChild(panel);

    // ---- coverage warning: any medicine NOT screened must be shown, never hidden ----
    var unchecked = (cov.unchecked || []), unclassified = (cov.unclassified || []);
    if (unchecked.length || unclassified.length) {
      var warn = el("div", { cls: "mlr-coverage-warn" });
      warn.appendChild(el("div", { cls: "mlr-coverage-warn-title", html: mlIco("warn") + " Not fully checked" }));
      if (unchecked.length) warn.appendChild(el("div", { cls: "mlr-coverage-warn-line",
        text: "Not recognised — NOT checked for any interaction: " + unchecked.join(", ") + ". Verify the name/spelling or check these manually." }));
      if (unclassified.length) warn.appendChild(el("div", { cls: "mlr-coverage-warn-line",
        text: "Recognised but not classified — only duplicate checks applied: " + unclassified.map(cap).join(", ") + "." }));
      main.appendChild(warn);
    }

    // ---- controls ----
    var filters = el("div", { cls: "mlr-filters" });
    var backBtn = el("button", { cls: "mlr-filter-btn mlr-back-btn", text: "‹ Back to medicines", attrs: { id: "mlr-back", type: "button" } });
    backBtn.addEventListener("click", function () { _view = "list"; render(); });
    var toggle = el("button", { cls: "mlr-filter-btn", attrs: { id: "mlr-toggle-minor", type: "button" },
      text: _hideMinor ? "Show all" : "Hide minor" });
    toggle.addEventListener("click", function () { _hideMinor = !_hideMinor; render(); });
    filters.appendChild(backBtn); filters.appendChild(toggle);
    main.appendChild(filters);

    // ---- grouped sections (duplicates shown once, in their own section) ----
    var minorFindings = _hideMinor ? [] : res.minor.filter(notDuplicate);
    var monitoring = res.monitor.filter(notDuplicate).concat(res.moderate.filter(notDuplicate), minorFindings);
    resultsSection(main, "Critical — act now", res.critical);
    resultsSection(main, "Major — review before prescribing", res.major);
    resultsSection(main, "Monitoring required", monitoring);
    resultsSection(main, "Duplicate therapy", (res.duplicates || []).slice());

    var anyShown = res.critical.length || res.major.length || monitoring.length || (res.duplicates || []).length;
    if (!anyShown) {
      // NEVER show a reassuring "all clear" — absence of a rule is not proof of safety,
      // and it must read differently when some medicines could not be screened.
      var incomplete = unchecked.length || unclassified.length;
      var none = el("div", { cls: "mlr-none" + (incomplete ? " mlr-none-partial" : "") });
      none.appendChild(el("div", { cls: "mlr-none-head",
        text: incomplete
          ? "No interaction found among the medicines that could be checked"
          : "No interaction found in this dataset" }));
      none.appendChild(el("div", { cls: "mlr-none-sub",
        text: "This is a screen against an open, non-exhaustive dataset — it does NOT confirm the combination is safe. Absence of a finding is not clearance. Verify important decisions against the drug label, a pharmacist, or local protocol." }));
      main.appendChild(none);
    }

    work.appendChild(main);
    _root.appendChild(work);

    // ---- sticky footer: return to the list ----
    var footer = el("div", { cls: "ml-footer" });
    var inner = el("div", { cls: "ml-footer-inner" });
    var back = el("button", { cls: "ml-check-btn", text: "Back to medication list", attrs: { type: "button" } });
    back.addEventListener("click", function () { _view = "list"; render(); });
    inner.appendChild(back); footer.appendChild(inner);
    _root.appendChild(footer);
  }

  function injectStyles() {
    if (document.getElementById("ml-styles")) return;
    var css = [
".ml-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;font-family:var(--sans,system-ui);color:var(--ink,#14202b)}",
/* ---- shell header (markup in drugs.js) ---- */
".ddi-overlay{background:var(--paper,#f6f7f5)}",
".ddi-head{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:12px;padding:calc(10px + env(safe-area-inset-top)) 16px 10px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#d7dee3)}",
".ddi-back{flex:0 0 auto;width:38px;height:38px;border-radius:11px;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);color:var(--teal,#0e6e63);font:700 22px/1 var(--sans);cursor:pointer;display:flex;align-items:center;justify-content:center}",
".ddi-back:active{transform:scale(.94)}",
".ddi-head-titles{flex:1;min-width:0}",
".ddi-head-title{font:800 17px var(--sans);color:var(--ink,#14202b);letter-spacing:-.01em}",
".ddi-head-sub{font:600 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:1px}",
".ddi-patient{flex:0 0 auto;max-width:42%;font:700 12px var(--sans);color:var(--slate,#2d4356);background:var(--paper,#f6f7f5);border:1px solid var(--line,#d7dee3);border-radius:999px;padding:6px 11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
".ddi-patient-on{color:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}",
"@media(max-width:560px){.ddi-head-title{font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ddi-patient{max-width:40%;font-size:11px;padding:5px 9px}}",
".ddi-advisory{padding:7px 16px;font:600 11.5px var(--sans);color:var(--slate,#2d4356);background:var(--paper,#f6f7f5);border-bottom:1px solid var(--line,#d7dee3)}",
".ddi-body{flex:1;min-height:0}",
/* ---- workspace layout ---- */
".ml-work{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;max-width:1240px;margin:0 auto;width:100%;box-sizing:border-box;padding:14px 16px 18px;display:grid;grid-template-columns:1fr;gap:14px;align-content:start}",
"@media(min-width:900px){.ml-work{grid-template-columns:63fr 37fr;gap:20px;padding:18px 22px 0}}",
".ml-main{min-width:0}.ml-aside{min-width:0}",
"@media(max-width:899px){.ml-aside{order:2}}",
/* ---- empty state ---- */
".ml-empty-head{margin:2px 0 12px}",
".ml-empty-title{font:800 18px var(--sans);color:var(--ink,#14202b)}",
".ml-empty-sub{font:500 13px var(--sans);color:var(--slate,#2d4356);margin-top:3px;line-height:1.45}",
".ml-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
".ml-action-card{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:14px;padding:14px;cursor:pointer;transition:border-color .12s,box-shadow .12s;min-height:88px}",
".ml-action-card:hover{border-color:var(--teal,#0e6e63);box-shadow:0 2px 10px rgba(14,110,99,.08)}",
".ml-action-card:active{transform:scale(.99)}",
".ml-action-ic{font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center}",
".ml-ico{width:16px;height:16px;vertical-align:-3px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
".ml-action-ic svg{width:26px;height:26px;color:var(--teal,#0a9396)}",
".ml-ward-ic svg{width:24px;height:24px;color:var(--teal,#0a9396)}",
".ml-icon-btn svg{width:17px;height:17px}",
".ml-sheet-close svg{width:16px;height:16px}",
".ml-scan-flag svg,.mlr-coverage-warn-title svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px}",
".ml-action-t{font:700 14px var(--sans);color:var(--ink,#14202b)}",
".ml-action-d{font:500 11.5px var(--sans);color:var(--slate-soft,#5a7184);line-height:1.35}",
".ml-action-primary{border-color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}",
".ml-action-card-disabled{opacity:1}",
/* ward sync active card */
".ml-ward-card{margin-top:10px;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px}",
".ml-ward-ic{font-size:22px}",
".ml-ward-body{flex:1;min-width:0}",
".ml-ward-t{font:700 14px var(--sans);color:var(--ink,#14202b)}",
".ml-ward-d{font:500 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px}",
".ml-ward-btn{flex:0 0 auto;background:var(--teal,#0e6e63);color:#fff;border:none;border-radius:10px;padding:9px 14px;font:700 12.5px var(--sans);cursor:pointer;min-height:40px}",
".ml-ward-btn:active{transform:scale(.97)}",
".ml-ward-hint{margin-top:8px;font:600 11.5px var(--sans);color:var(--amber,#92620a)}",
/* ---- med list ---- */
".ml-list-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:2px 0 10px}",
".ml-list-count{font:800 16px var(--sans);color:var(--ink,#14202b)}",
".ml-list-updated{font:500 11.5px var(--sans);color:var(--slate-soft,#5a7184)}",
".ml-list-actions{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 12px}",
".ml-mini-btn{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:9px;padding:7px 11px;font:600 12px var(--sans);color:var(--slate,#2d4356);cursor:pointer;min-height:36px}",
".ml-mini-btn:hover{border-color:var(--teal,#0e6e63);color:var(--teal,#0e6e63)}",
".ml-mini-btn-primary{color:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}",
".ml-rows{display:flex;flex-direction:column;gap:8px}",
".ml-row{display:flex;align-items:center;gap:10px;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:11px;padding:10px 12px}",
".ml-row-main{flex:1;min-width:0}",
".ml-row-title{font:700 14.5px var(--sans);color:var(--ink,#14202b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
".ml-row-unmapped{color:var(--amber,#92620a)}",
".ml-row-line{font:500 12px var(--mono,monospace);color:var(--slate,#2d4356);margin-top:2px}",
".ml-row-badges{display:flex;align-items:center;gap:6px;margin-top:5px}",
".ml-source-badge{font:700 9.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;border-radius:6px;padding:2px 7px;border:1px solid var(--line,#d7dee3);color:var(--slate,#2d4356);background:var(--paper,#f6f7f5)}",
".ml-source-index{color:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}",
".ml-source-ghis,.ml-source-wardsync{color:#3457b2;border-color:#b9c8ee;background:#eef2fc}",
".ml-source-scan{color:var(--amber,#92620a);border-color:#f0d49b;background:#fdf2de}",
".ml-conf-badge{font:700 9.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;border-radius:6px;padding:2px 7px;border:1px solid #f0d49b;background:#fdf2de;color:var(--amber,#92620a)}",
".ml-conf-badge.ml-conf-high{background:var(--green-bg,#e7f5ec);border-color:var(--green-line,#aedcc1);color:var(--green,#1c7a4a)}",
".ml-conf-badge.ml-conf-low{background:var(--red-bg,#fbe7e9);border-color:var(--red-line,#efa9b1);color:var(--red,#ab1c2c)}",
".ml-row-acts{display:flex;gap:4px;flex:0 0 auto}",
".ml-icon-btn{min-width:40px;min-height:40px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--line,#d7dee3);border-radius:9px;font-size:15px;cursor:pointer;color:var(--slate,#2d4356)}",
".ml-icon-btn:hover{border-color:var(--teal,#0e6e63)}",
".ml-remove-btn{color:var(--red,#ab1c2c)}.ml-remove-btn:hover{border-color:var(--red-line,#efa9b1)}",
".ml-card-removed{display:flex}",
".ml-undo-row{display:flex;justify-content:space-between;align-items:center;width:100%;font:600 13px var(--sans);color:var(--slate,#2d4356);background:var(--panel,#fff);border:1px dashed var(--line,#d7dee3);border-radius:11px;padding:11px 13px}",
".ml-undo-btn{background:transparent;border:none;color:var(--teal,#0e6e63);font:800 13px var(--sans);cursor:pointer}",
".ml-row-grouped{display:flex;flex-direction:column;align-items:stretch;gap:0;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:11px;padding:0}",
".ml-row-group-header{padding:10px 12px 6px;border-bottom:1px dashed var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-top-left-radius:10px;border-top-right-radius:10px}",
".ml-row-group-sublist{display:flex;flex-direction:column;gap:0}",
".ml-sub-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line-soft,#ebf0f3)}",
".ml-sub-row:last-child{border-bottom:none;border-bottom-left-radius:10px;border-bottom-right-radius:10px}",
".ml-sub-row-title{font:500 13px var(--mono,monospace);color:var(--ink,#14202b);flex:1;min-width:0}",
".ml-sub-row-removed{display:flex;padding:8px 12px;background:var(--panel,#fff)}",
/* ---- right aside (summary / pre-run) ---- */
".ml-aside-card{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:14px;padding:14px 15px}",
".ml-aside-title{font:800 12px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate,#2d4356);margin-bottom:9px}",
".ml-review-list{display:flex;flex-wrap:wrap;gap:6px}",
".ml-review-chip{font:600 11.5px var(--sans);color:var(--slate,#2d4356);background:var(--paper,#f6f7f5);border:1px solid var(--line,#d7dee3);border-radius:999px;padding:5px 10px}",
".ml-aside-note{font:500 11.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:10px;line-height:1.45}",
/* ---- sticky footer CTA ---- */
".ml-footer{flex:0 0 auto;z-index:6;padding:12px 16px calc(14px + env(safe-area-inset-bottom));background:var(--panel,#fff);border-top:1px solid var(--line,#d7dee3);box-shadow:0 -4px 16px rgba(8,18,26,.06)}",
".ml-footer-inner{max-width:1240px;margin:0 auto}",
".ml-check-btn{width:100%;min-height:52px;background:var(--teal,#0e6e63);color:#fff;border:none;border-radius:13px;padding:14px;font:800 15px var(--sans);cursor:pointer;box-sizing:border-box;letter-spacing:.01em}",
".ml-check-btn:active{transform:scale(.995)}",
".ml-check-btn:disabled{background:#c3d3ce;color:#eef4f2;cursor:not-allowed}",
".ml-footer-hint{text-align:center;font:600 11.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:7px}",
/* ---- bottom sheets ---- */
".ml-scrim{position:fixed;inset:0;z-index:40;background:rgba(8,18,26,.42);opacity:0;animation:mlfade .18s ease forwards}",
"@keyframes mlfade{to{opacity:1}}",
".ml-sheet{position:fixed;left:0;right:0;bottom:0;z-index:41;background:var(--panel,#fff);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.22);max-height:90vh;display:flex;flex-direction:column;transform:translateY(100%);animation:mlup .26s cubic-bezier(.2,.7,.2,1) forwards}",
"@keyframes mlup{to{transform:none}}",
"@media(min-width:900px){.ml-sheet{left:50%;right:auto;bottom:auto;top:8vh;transform:translate(-50%,20px);width:min(560px,92vw);border-radius:18px;max-height:84vh;animation:mlpop .2s ease forwards}@keyframes mlpop{to{transform:translate(-50%,0)}}}",
".ml-sheet-wrap{display:flex;flex-direction:column;min-height:0;flex:1}",
".ml-sheet-grip{width:38px;height:4px;border-radius:2px;background:var(--line,#d7dee3);margin:8px auto 2px}",
"@media(min-width:900px){.ml-sheet-grip{display:none}}",
".ml-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px 8px}",
".ml-sheet-title{font:800 16px var(--sans);color:var(--ink,#14202b)}",
".ml-sheet-sub{font:500 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:1px}",
".ml-sheet-close{width:34px;height:34px;border-radius:9px;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);font-size:16px;color:var(--slate,#2d4356);cursor:pointer;flex:0 0 auto}",
".ml-sheet-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px 14px;min-height:0}",
// tall search surface so suggestions read as a full, scrollable typeahead list
".ml-sheet-tall{height:88vh;max-height:88vh}",
"@media(min-width:900px){.ml-sheet-tall{height:78vh;max-height:78vh}}",
// fixed search bar (input stays put while the suggestion list below it scrolls)
".ml-searchbar{flex:0 0 auto;padding:2px 16px 12px;border-bottom:1px solid var(--line,#d7dee3)}",
".ml-search-hint{font:600 11px var(--sans);color:var(--slate-soft,#5a7184);margin:9px 2px 2px}",
".ml-sheet-foot{padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line,#d7dee3);display:flex;gap:10px}",
".ml-sheet-foot .ml-check-btn{min-height:48px;font-size:14px}",
".ml-sheet-cancel{flex:0 0 auto;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:13px;padding:0 18px;font:700 14px var(--sans);color:var(--slate,#2d4356);cursor:pointer}",
/* search sheet */
".ml-search-input,.ml-input,.ml-textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#d7dee3);border-radius:11px;padding:12px 13px;font:500 14.5px var(--sans);color:var(--ink,#14202b);background:var(--panel,#fff)}",
".ml-search-input:focus,.ml-input:focus,.ml-textarea:focus{outline:none;border-color:var(--teal,#0e6e63)}",
".ml-textarea{min-height:120px;resize:vertical;font-family:var(--mono,monospace);font-size:13px;line-height:1.6}",
".ml-search-label{font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#5a7184);margin:14px 2px 7px}",
".ml-index-results{display:flex;flex-direction:column;gap:7px}",
".ml-index-result{display:flex;align-items:center;gap:10px;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:11px;padding:9px 11px;text-align:left;width:100%;cursor:pointer}",
".ml-index-result:hover{border-color:var(--teal,#0e6e63)}",
".ml-index-info{flex:1;min-width:0;background:transparent;border:none;text-align:left;cursor:pointer;padding:0;font:inherit}",
".ml-index-generic{font:700 14px var(--sans);color:var(--ink,#14202b)}",
".ml-index-generic mark{background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:3px;padding:0 1px}",
".ml-index-meta{font:500 11.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px}",
".ml-index-brands{font:500 11.5px var(--sans);color:var(--slate,#2d4356);margin-top:1px}",
".ml-index-brands mark{background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:3px;padding:0 1px}",
".ml-index-add{flex:0 0 auto;background:var(--teal,#0e6e63);color:#fff;border:none;border-radius:9px;padding:8px 12px;font:800 12.5px var(--sans);cursor:pointer;min-height:38px}",
".ml-index-add:active{transform:scale(.96)}",
".ml-state{padding:22px 12px;text-align:center;font:600 13px var(--sans);color:var(--slate,#2d4356)}",
".ml-state-sub{display:block;font:500 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:5px}",
".ml-state-offline{color:var(--amber,#92620a)}",
".ml-spin{display:inline-block;width:14px;height:14px;box-sizing:border-box;border:2px solid var(--line,#d7dee3);border-top-color:var(--teal,#0e6e63);border-radius:50%;vertical-align:-2px;animation:mlspin 1s linear infinite}@keyframes mlspin{to{transform:rotate(360deg)}}",
/* dose sheet */
".ml-dose-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}",
".ml-field{display:flex;flex-direction:column;gap:5px}",
".ml-field-full{grid-column:1/-1}",
".ml-field-label{font:700 10.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#5a7184)}",
".ml-chip-row{display:flex;flex-wrap:wrap;gap:6px}",
".ml-chip{background:var(--paper,#f6f7f5);color:var(--slate,#2d4356);border:1px solid var(--line,#d7dee3);border-radius:999px;padding:7px 12px;font:600 12.5px var(--sans);cursor:pointer;min-height:34px}",
".ml-chip.on{background:var(--teal,#0e6e63);color:#fff;border-color:var(--teal,#0e6e63)}",
/* did-you-mean / paste */
".ml-dym{margin-top:12px}.ml-dym-label{font:700 11.5px var(--sans);color:var(--slate,#2d4356);margin-bottom:6px}",
".ml-dym-chips{display:flex;flex-wrap:wrap;gap:7px}",
".ml-paste-ex{font:500 12px var(--mono,monospace);color:var(--slate-soft,#5a7184);background:var(--paper,#f6f7f5);border:1px dashed var(--line,#d7dee3);border-radius:9px;padding:9px 11px;margin-top:9px;line-height:1.6;white-space:pre-wrap}",
".ml-paste-list{display:flex;flex-direction:column;gap:7px;margin-top:12px}",
".ml-paste-item{display:flex;align-items:center;gap:10px;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:10px;padding:9px 11px;font:600 13px var(--sans);color:var(--ink,#14202b)}",
".ml-paste-item input{width:18px;height:18px;flex:0 0 auto}",
".ml-paste-item-sub{font:500 11.5px var(--mono,monospace);color:var(--slate-soft,#5a7184);margin-top:1px}",
/* toast */
".ml-toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:60;background:var(--ink,#14202b);color:#fff;font:700 12.5px var(--sans);padding:10px 16px;border-radius:11px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;animation:mltoast 2.6s ease forwards}",
"@keyframes mltoast{8%{opacity:.97}84%{opacity:.97}100%{opacity:0}}",
/* ---- results screen ---- */
".mlr-summary-panel{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:16px;padding:15px 16px;margin-bottom:14px}",
".mlr-summary-title{font:800 16px var(--sans);color:var(--ink,#14202b)}",
".mlr-summary-sub{font:600 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px}",
".mlr-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
".mlr-chip{display:inline-flex;align-items:baseline;gap:6px;border-radius:10px;padding:7px 11px;font:700 12px var(--sans);border:1px solid}",
".mlr-chip-num{font:800 15px var(--sans)}",
".mlr-chip-critical{background:var(--red-bg,#fbe7e9);color:var(--red,#ab1c2c);border-color:var(--red-line,#efa9b1)}",
".mlr-chip-major{background:var(--orange-bg,#fdebe1);color:var(--orange,#b5460f);border-color:var(--orange-line,#f3b88e)}",
".mlr-chip-monitor{background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-color:#a6d9d8}",
".mlr-chip-duplicate{background:var(--yellow-bg,#fdf2de);color:var(--yellow,#92620a);border-color:var(--yellow-line,#f0d49b)}",
".mlr-chip-zero{opacity:.5}",
".mlr-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}",
".mlr-filter-btn{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:999px;padding:8px 15px;font:700 12.5px var(--sans);cursor:pointer;color:var(--slate,#2d4356);min-height:42px}",
".mlr-back-btn{color:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63)}",
".mlr-section{margin-bottom:16px}",
".mlr-section-h{display:flex;align-items:center;gap:8px;margin-bottom:9px}",
".mlr-section-title{font:800 12px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate,#2d4356)}",
".mlr-section-count{font:800 11px var(--sans);background:var(--paper,#f6f7f5);border:1px solid var(--line,#d7dee3);border-radius:999px;padding:1px 8px;color:var(--slate,#2d4356)}",
".mlr-card{border:1px solid var(--line,#d7dee3);border-left-width:4px;border-radius:12px;padding:12px 14px;background:var(--panel,#fff);margin-bottom:9px}",
".mlr-card-critical{border-left-color:var(--red,#ab1c2c)}.mlr-card-major{border-left-color:var(--orange,#b5460f)}",
".mlr-card-moderate{border-left-color:var(--yellow,#92620a)}.mlr-card-monitor{border-left-color:var(--teal,#0e6e63)}.mlr-card-minor{border-left-color:var(--slate-soft,#5a7184)}",
".mlr-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:7px}",
".mlr-card-pair{font:800 14.5px var(--sans);color:var(--ink,#14202b)}",
".mlr-sev{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:3px 9px;font:800 10.5px var(--sans);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}",
".mlr-sev-critical{background:var(--red-bg,#fbe7e9);color:var(--red,#ab1c2c);border:1px solid var(--red-line,#efa9b1)}",
".mlr-sev-major{background:var(--orange-bg,#fdebe1);color:var(--orange,#b5460f);border:1px solid var(--orange-line,#f3b88e)}",
".mlr-sev-moderate{background:var(--yellow-bg,#fdf2de);color:var(--yellow,#92620a);border:1px solid var(--yellow-line,#f0d49b)}",
".mlr-sev-monitor{background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border:1px solid #a6d9d8}",
".mlr-sev-minor{background:var(--paper,#f6f7f5);color:var(--slate,#2d4356);border:1px solid var(--line,#d7dee3)}",
".mlr-consequence{font:600 13px var(--sans);color:var(--ink,#14202b);line-height:1.45}",
".mlr-detail{display:flex;flex-direction:column;gap:1px;margin-top:7px}",
".mlr-detail-label{font:800 10px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#5a7184)}",
".mlr-detail-val{font:500 12.5px var(--sans);color:var(--ink,#14202b);line-height:1.45}",
/* Neutral (NOT green): 'no finding' is a screen result, not a safety clearance. */
".mlr-none{padding:18px 14px;text-align:left;border:1px solid var(--line,#d7e0ea);border-radius:12px;background:var(--panel-2,#f4f7fb)}",
".mlr-none-partial{border-color:var(--amber-line,#e6cf9a);background:var(--amber-bg,#fdf6e7)}",
".mlr-none-head{font:800 14px var(--sans);color:var(--ink,#1f2d3d)}",
".mlr-none-sub{font:500 12px var(--sans);color:var(--slate-soft,#5a7184);margin-top:6px;line-height:1.5}",
".mlr-dataset-note{font:600 10.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:8px;opacity:.85}",
".mlr-coverage-warn{margin-top:12px;padding:12px 14px;border:1px solid var(--amber-line,#e6cf9a);background:var(--amber-bg,#fdf6e7);border-radius:12px}",
".mlr-coverage-warn-title{font:800 12.5px var(--sans);color:var(--amber-ink,#8a5a12)}",
".mlr-coverage-warn-line{font:600 12px var(--sans);color:var(--slate,#3d4f61);margin-top:5px;line-height:1.5}",
".mlr-why{margin-top:9px}",
".mlr-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
".mlr-whatnow-btn{background:var(--teal,#0e6e63);color:#fff;border:none;border-radius:9px;padding:8px 14px;font:800 12.5px var(--sans);cursor:pointer;min-height:40px}",
".mlr-whatnow-btn:active{transform:scale(.97)}",
".mlr-whatnow{margin-top:10px;border:1px solid var(--teal,#0e6e63);border-radius:11px;padding:12px 13px;background:var(--teal-soft,#e3f1ee)}",
".mlr-whatnow-lead{font:700 13px var(--sans);color:var(--ink,#14202b);line-height:1.45}",
".mlr-whatnow-label{font:800 10.5px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate,#2d4356);margin:11px 0 7px}",
".mlr-whatnow-actions{display:flex;flex-wrap:wrap;gap:8px}",
".mlr-remove-drug{background:var(--panel,#fff);color:var(--red,#ab1c2c);border:1px solid var(--red-line,#efa9b1);border-radius:9px;padding:8px 13px;font:800 12.5px var(--sans);cursor:pointer;min-height:40px}",
".mlr-remove-drug:active{transform:scale(.97)}",
".mlr-whatnow-note{font:500 11.5px var(--sans);color:var(--slate,#2d4356);line-height:1.45;margin-top:10px}",
".mlr-explain-wrap{margin-top:9px}",
".mlr-explain-btn{background:transparent;border:1px solid var(--line,#d7dee3);border-radius:9px;padding:7px 12px;font:800 11.5px var(--sans);cursor:pointer;color:var(--teal,#0e6e63);min-height:38px}",
".mlr-explain-btn:disabled{opacity:.7;cursor:default}",
".mlr-explain-out{margin-top:8px;border-left:3px solid #a6d9d8;background:var(--teal-soft,#e3f1ee);border-radius:8px;padding:9px 11px}",
".mlr-explain-out.mlr-explain-err{border-left-color:var(--red-line,#efa9b1);background:var(--red-bg,#fbe7e9)}",
".mlr-explain-label{font:800 10px var(--sans);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#5a7184)}",
".mlr-explain-note{font:500 10.5px var(--sans);color:var(--slate,#2d4356);margin:1px 0 5px;font-style:italic}",
".mlr-explain-body{font:500 12.5px var(--sans);color:var(--ink,#14202b);line-height:1.5;white-space:pre-wrap}",
/* ---- scan review ---- */
".ml-scan-ov{position:fixed;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:rgba(8,18,26,.5);padding:16px}",
".ml-scan-box{background:var(--panel,#fff);border-radius:16px;padding:22px;text-align:center;color:var(--ink,#14202b);font:600 13.5px var(--sans);max-width:320px}",
".ml-scan-spin{width:26px;height:26px;box-sizing:border-box;border:3px solid var(--line,#d7dee3);border-top-color:var(--teal,#0e6e63);border-radius:50%;margin:0 auto 8px;animation:mlspin 1s linear infinite}",
".ml-scan-err{color:var(--red,#ab1c2c);font:600 13.5px/1.5 var(--sans);margin-bottom:12px}",
".ml-scan-rows{display:flex;flex-direction:column;gap:10px}",
".ml-scan-row{border:1px solid var(--line,#d7dee3);border-radius:12px;padding:11px 12px;background:var(--panel,#fff)}",
".ml-scan-row.ml-scan-flagged{border-left:4px solid var(--amber,#92620a);background:#fdf9f0}",
".ml-scan-top{display:flex;align-items:flex-start;gap:9px}",
".ml-scan-top input{width:18px;height:18px;margin-top:2px;flex:0 0 auto}",
".ml-scan-titlewrap{flex:1;min-width:0}",
".ml-scan-mapped{font:700 14px var(--sans);color:var(--ink,#14202b)}",
".ml-scan-detected{font:500 12px var(--sans);color:var(--slate,#2d4356);margin-top:1px;word-break:break-word}",
".ml-scan-line{font:500 12px var(--mono,monospace);color:var(--slate-soft,#5a7184);margin:6px 0 0 27px}",
".ml-scan-edit{margin-top:8px}",
".ml-scan-flag{font:800 11.5px var(--sans);color:var(--amber,#92620a);margin-top:7px}",
".ml-scan-footer{display:flex;gap:10px}.ml-scan-footer .ml-sheet-cancel{min-height:48px}.ml-scan-footer .ml-check-btn{flex:1;min-height:48px}",
/* headings kept for scan/list titles */
".ml-header{flex:0 0 auto;padding:14px 16px 6px}.ml-title{margin:0;font:800 17px var(--sans)}.ml-subtitle{margin:2px 0 0;font:500 12.5px var(--sans);color:var(--slate,#2d4356)}.ml-advisory{font:600 11.5px var(--sans);color:var(--slate,#2d4356);margin-top:8px}",
".ml-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px}"
].join("");
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
    getClinicalList: getClinicalList, getClinicalKey: getClinicalKey,
    mount: mount, brandSearch: brandSearch,
    // Re-render the current list view (used by GHISMEDS to return from its review screen).
    _rerender: function () { _view = "list"; render(); },
    scanExtract: scanExtract, _compressImage: _compressImage, _openScanReview: _openScanReview,
    explainInteraction: explainInteraction };
})();
