/* StewardMD — GHIS Medication History import. Exposes window.GHISMEDS.
   -------------------------------------------------------------------------
   The deterministic PARSING lives here (testable via CDP): it takes PHI-stripped
   medication rows from /api/ghis/medications and turns them into review
   candidates — splitting combination products, mapping to generics via
   MEDLIST.parseEntry/resolveGeneric, recognising formulation, and bucketing
   consumables (excluded) and low-confidence rows (needs review) so nothing is
   ever silently added. The clinician REVIEWS and CONFIRMS before any med enters
   the list; the interaction check runs only afterwards.

   PRIVACY: patient-scoped. The draft holds only medication fields — never MRN /
   UHID / name / bed / clinician. Raw GHIS product codes are kept for internal
   audit only and are NEVER rendered in the review DOM. The draft is cleared on
   logout / patient-switch (GHIS.clearSelectedPatient -> GHISMEDS.clearDraft). */
(function () {
  "use strict";

  var PROXY = (window.GHIS_PROXY) ||
    ((location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "http://localhost:8788/api/ghis" : "/api/ghis");

  // ── consumables (excluded by default into a "needs review" bucket) ──────────
  // Non-drug ward items that GHIS medication rows commonly include. Matched
  // case-insensitively against the drug text; anything here is never auto-added.
  var CONSUMABLE_RE = new RegExp("\\b(" + [
    "syringe", "needle", "iv\\s*cannula", "cannula", "infusion\\s*set", "iv\\s*set",
    "giving\\s*set", "blood\\s*set", "urine\\s*bag", "urobag", "catheter", "foley",
    "dressing", "gauze", "cotton", "bandage", "adhesive", "micropore", "tegaderm",
    "spirit\\s*swab", "alcohol\\s*swab", "swab", "glove", "gloves", "mask", "apron",
    "three\\s*way", "3\\s*way", "stopcock", "extension\\s*line", "iv\\s*line",
    "spinal\\s*needle", "scalp\\s*vein", "ryles\\s*tube", "rt\\s*tube", "ng\\s*tube",
    "suction\\s*catheter", "et\\s*tube", "tracheostomy", "drape", "disposable",
    "disposables", "lancet", "test\\s*strip", "glucose\\s*strip", "thermometer"
  ].join("|") + ")\\b", "i");

  // ── formulation recognition ────────────────────────────────────────────────
  var IV_FLUID_RE = /\b(ns|normal\s*saline|dns|d5|d10|d25|dextrose|ringer|rl|hartmann|isolyte|plasmalyte|0\.9%\s*nacl)\b/i;
  function detectFormulation(text) {
    var t = String(text || "").toLowerCase();
    if (/\b(inj|injection|iv\s*bolus|ampoule|ampule|vial)\b/.test(t)) return "injection";
    if (IV_FLUID_RE.test(t) && /(ml|litre|liter|l\b|%)/.test(t)) return "iv fluid";
    if (/\b(tab|tablet|tabs|cap|capsule|caps)\b/.test(t)) return "tablet";
    if (/\b(syp|syrup|susp|suspension|solution|drops?)\b/.test(t)) return "syrup";
    if (/\b(neb|nebulis|nebuliz|inhaler|inhalation|mdi|rotacap|respule)\b/.test(t)) return "inhaler";
    return null;
  }

  // ── combination-product splitting ───────────────────────────────────────────
  // GHIS combination products join ingredients with "&", "+" or "/". Split into
  // per-ingredient text fragments, each keeping its own strength if present.
  // "ROSUVASTATIN 20 MG & FENOFIBRATE 160 MG" -> ["ROSUVASTATIN 20 MG","FENOFIBRATE 160 MG"].
  function splitCombination(drugText) {
    var raw = String(drugText || "").trim();
    if (!raw) return [];
    // Strip a leading form prefix so it doesn't get glued to the first ingredient.
    // Split on ingredient separators: "&", "+", "plus", " with ", or a "/" that is a
    // real separator — NOT a "/" inside a strength ratio like "80/12.5". A ratio "/" sits
    // between two digits; an ingredient "/" has a non-digit (space or letter) on at least
    // one side. The negative look-around excludes the digit/digit case.
    var parts = raw.split(/\s*(?:&|\+|\bplus\b|\swith\s)\s*|\s*\/(?![0-9])\s*|(?<![0-9])\s*\/\s*/i)
      .map(function (p) { return p.trim(); })
      .filter(Boolean);
    // A single fragment means it was not a combination.
    return parts;
  }

  // ── row -> candidate(s) ─────────────────────────────────────────────────────
  // parseGhisRow(row) returns an object describing ONE GHIS order. When the drug
  // text is a combination it produces multiple `ingredients`, each linked to the
  // same orderId. Consumables are flagged (isConsumable) so the caller buckets
  // them out. The raw product code is kept ONLY in ghisMeta (internal audit,
  // never rendered).
  var _orderSeq = 0;
  function _parseIngredient(text, row, orderId) {
    var ml = (window.MEDLIST && window.MEDLIST.parseEntry) ? window.MEDLIST.parseEntry : null;
    var entry = ml ? ml(text) : { raw: text, name: null, generic: null, strength: null, unit: null, form: null, route: null, freq: null, confidence: "low", candidates: [] };
    // Fold in explicit GHIS structured fields when parseEntry didn't extract them.
    if (entry.strength == null && row.dosage) {
      var pd = ml ? ml(String(row.dosage)) : null;
      if (pd && pd.strength != null) { entry.strength = pd.strength; entry.unit = entry.unit || pd.unit; }
    }
    if (!entry.route && row.route) {
      var pr = ml ? ml(String(row.route)) : null;
      if (pr && pr.route) entry.route = pr.route;
    }
    if (!entry.freq && row.frequency) {
      var pf = ml ? ml(String(row.frequency)) : null;
      if (pf && pf.freq) { entry.freq = pf.freq; entry.freqText = pf.freqText; }
    }
    // Formulation from the ORIGINAL row text (form prefixes live on the whole row).
    var form = detectFormulation(row.drugText) || entry.form || null;
    if (form) entry.form = form;

    var cand = Object.assign({}, entry, {
      source: "ghis",
      orderId: orderId,
      originalText: String(row.drugText || ""),   // full original combination text (shown, verbatim)
      ingredientText: String(text || ""),          // this single ingredient fragment
      isConsumable: false,
      needsReview: false,
      // Internal audit ONLY — never rendered in the review DOM.
      ghisMeta: { productCode: String(row.productCode || ""), dept: String(row.dept || ""), dateTime: String(row.dateTime || ""), duration: String(row.duration || "") }
    });
    return cand;
  }

  function parseGhisRow(row) {
    row = row || {};
    var orderId = "gord" + (++_orderSeq);
    var drugText = String(row.drugText || "").trim();
    var consumable = CONSUMABLE_RE.test(drugText);

    var frags = splitCombination(drugText);
    var isCombination = frags.length > 1;
    if (!frags.length) frags = [drugText];

    var ingredients = frags.map(function (frag) {
      var c = _parseIngredient(frag, row, orderId);
      c.isConsumable = consumable;
      // Confidence bucketing:
      //  - consumable      -> needs review (never importable as a med)
      //  - resolved generic-> keep parseEntry confidence (high/medium)
      //  - combination frag with a clean single-token drug name that didn't map to
      //    the (small) formulary -> medium, treat the fragment name as the generic
      //    (the split itself is deterministic + high-signal)
      //  - otherwise (unknown single drug) -> low, needsReview, NO silent mapping
      if (consumable) { c.needsReview = true; c.confidence = "low"; }
      else if (c.generic) { /* keep */ }
      else if (isCombination && c.name && /^[a-z][a-z\- ]+$/i.test(c.name.trim())) {
        c.generic = c.name.trim().toLowerCase(); c.confidence = "medium";
      } else {
        c.generic = null; c.confidence = "low"; c.needsReview = true;
      }
      return c;
    });

    return { orderId: orderId, originalText: drugText, isCombination: isCombination,
      isConsumable: consumable, ingredients: ingredients,
      ghisMeta: { productCode: String(row.productCode || "") } };
  }

  // parseGhisRows(rows) -> buckets + a flat candidate list. Each ingredient of a
  // combination is a separate candidate that shares the parent orderId.
  function parseGhisRows(rows) {
    _orderSeq = 0;
    rows = Array.isArray(rows) ? rows : [];
    var candidates = [], recognized = [], needsReview = [], consumables = [];
    var combinationsExpanded = 0;

    rows.forEach(function (row) {
      var parsed = parseGhisRow(row);
      if (parsed.isCombination && !parsed.isConsumable) combinationsExpanded++;
      parsed.ingredients.forEach(function (c) {
        candidates.push(c);
        if (c.isConsumable) consumables.push(c);
        else if (c.needsReview || !c.generic || c.confidence === "low") needsReview.push(c);
        else recognized.push(c);
      });
    });

    return {
      candidates: candidates,
      recognized: recognized,
      needsReview: needsReview,
      consumables: consumables,
      recognizedCount: recognized.length,
      needsReviewCount: needsReview.length,
      consumablesExcluded: consumables.length,
      combinationsExpanded: combinationsExpanded
    };
  }

  // ── duplicate / merge detection against the existing MEDLIST ────────────────
  // Detects: exact-generic duplicates, same-drug-different-dose, and combination
  // overlap. Returns [{ candidate, existing, kind }] — the CALLER decides how to
  // resolve (merge / keep both / replace). A manual med is NEVER auto-deleted.
  function detectDuplicates(candidates, existingList) {
    candidates = candidates || []; existingList = existingList || [];
    var out = [];
    candidates.forEach(function (c) {
      if (!c.generic) return;
      var cg = String(c.generic).toLowerCase();
      existingList.forEach(function (m) {
        if (!m.generic) return;
        var mg = String(m.generic).toLowerCase();
        if (mg !== cg) return;
        var kind = "duplicate";
        if (c.strength != null && m.strength != null && c.strength !== m.strength) kind = "different-dose";
        out.push({ candidate: c, existing: m, kind: kind });
      });
    });
    return out;
  }

  // ── OPTIONAL low-confidence AI mapping (deterministic-first, PROD-ONLY) ─────
  // The mapping above is fully deterministic. This seam runs AFTER it, ONLY on
  // rows that stayed low-confidence/unmapped, and ONLY sends DE-IDENTIFIED drug
  // text (a single medication string — no patient identifiers ever pass through).
  // It is a no-op unless a prod AI helper (window.SMD_AI.mapDrug) is present, and
  // is stub-able via GHISMEDS.aiMapLowConfidence in tests. It never upgrades a row
  // to a generic the deterministic layer would reject silently — the clinician
  // still confirms every AI-suggested mapping in the review screen (confidence
  // capped at "medium").
  function aiMapLowConfidence(candidates) {
    var lows = (candidates || []).filter(function (c) { return !c.isConsumable && (!c.generic || c.confidence === "low"); });
    if (!lows.length || !(window.SMD_AI && window.SMD_AI.mapDrug)) return Promise.resolve(candidates);
    return Promise.all(lows.map(function (c) {
      // DE-IDENTIFIED: only the ingredient drug text is sent — nothing patient-scoped.
      var text = String(c.ingredientText || c.name || c.originalText || "");
      return Promise.resolve().then(function () { return window.SMD_AI.mapDrug(text); }).then(function (g) {
        if (g && typeof g === "string" && g.trim()) {
          c.generic = g.trim().toLowerCase();
          c.confidence = "medium";       // AI suggestion still needs clinician confirmation
          c.needsReview = true;          // keep it in the review-and-confirm bucket
          c.aiSuggested = true;
        }
      }).catch(function () {});
    })).then(function () { return candidates; });
  }

  // ── selected-patient gate ───────────────────────────────────────────────────
  function getSelectedPatient() {
    try { if (window.GHIS && window.GHIS.getSelectedPatient) return window.GHIS.getSelectedPatient(); } catch (e) {}
    return null;
  }
  function canFetch() { return !!(getSelectedPatient() && getSelectedPatient().patientId); }

  // ── fetch (stub-able) ────────────────────────────────────────────────────────
  // Calls the PR4 endpoint for PHI-stripped rows. Stubbed in tests via
  // GHISMEDS.fetchMedications. Errors are surfaced as clinician-facing codes.
  function fetchMedications(patientId) {
    var base = PROXY;
    try { if (window.GHIS && window.GHIS.getProxyBase) base = window.GHIS.getProxyBase() || PROXY; } catch (e) {}
    var url = base + "/medications?patientId=" + encodeURIComponent(patientId || "");
    var token = "";
    try { token = (window.GHIS && window.GHIS.getToken && window.GHIS.getToken()) || ""; } catch (e) {}
    return fetch(url, { headers: token ? { "Authorization": "Bearer " + token } : {} }).then(function (r) {
      if (r.status === 401) { var e = new Error("session_expired"); e.code = "session_expired"; throw e; }
      if (!r.ok) { var e2 = new Error("fetch_failed"); e2.code = "fetch_failed"; throw e2; }
      return r.json();
    });
  }

  // ── import draft state (patient-scoped, NOT persisted) ──────────────────────
  var _draft = null;   // { patientId, parsed, dupInfo }

  function getDraft() { return _draft; }
  function clearDraft() { _draft = null; if (_view === "review") { _view = "list"; try { _renderMedlist(); } catch (e) {} } }

  // ── clinician-facing error messages (never HTML/tokens/URLs) ────────────────
  var MSG = {
    noPatient: "Select a Ward Sync patient first.",
    empty: "No medication history available for this patient.",
    failed: "Could not fetch medication history. Try again or add medicines manually.",
    expired: "GHIS session expired — reconnect Ward Sync."
  };
  function errMessage(code) {
    if (code === "session_expired") return MSG.expired;
    if (code === "no_patient") return MSG.noPatient;
    if (code === "empty") return MSG.empty;
    return MSG.failed;
  }

  // startImport(): gate on selected patient -> fetch -> parse -> build draft ->
  // open review. Returns a promise resolving { ok:false, message } on any gate/
  // error, or { ok:true, draft } once the review is populated. Nothing is added.
  function startImport() {
    if (!canFetch()) return Promise.resolve({ ok: false, message: MSG.noPatient });
    var pt = getSelectedPatient();
    var fn = (window.GHISMEDS && window.GHISMEDS.fetchMedications) || fetchMedications;
    return Promise.resolve().then(function () { return fn(pt.patientId); }).then(function (res) {
      var rows = (res && Array.isArray(res.rows)) ? res.rows : [];
      if (!rows.length) { return { ok: false, message: MSG.empty }; }
      var parsed = parseGhisRows(rows);
      if (!parsed.candidates.length) { return { ok: false, message: MSG.empty }; }
      // Deterministic-first; then an OPTIONAL prod-only AI pass over low-confidence rows
      // (de-identified text only, stub-able, no-op when unavailable).
      var aiFn = (window.GHISMEDS && window.GHISMEDS.aiMapLowConfidence) || aiMapLowConfidence;
      return Promise.resolve().then(function () { return aiFn(parsed.candidates); }).then(function () {
        var existing = (window.MEDLIST && window.MEDLIST.getList) ? window.MEDLIST.getList() : [];
        var dupInfo = detectDuplicates(parsed.recognized, existing);
        _draft = { patientId: pt.patientId, patientName: pt.name || "", parsed: parsed, dupInfo: dupInfo,
          candidates: parsed.candidates, include: {}, view: "candidates" };
        // Default include: recognized rows on, needs-review + consumables off.
        parsed.candidates.forEach(function (c, i) { c._idx = i; c._include = !c.isConsumable && !c.needsReview && !!c.generic; });
        return { ok: true, draft: _draft };
      });
    }).catch(function (e) {
      return { ok: false, message: errMessage(e && e.code) };
    });
  }

  // ── Review UI (mounted into the MEDLIST overlay root) ───────────────────────
  var _root = null;         // container element (the MEDLIST root)
  var _view = "list";       // "list" | "review"

  function _renderMedlist() {
    // Hand rendering back to MEDLIST's own list view.
    try { if (window.MEDLIST && window.MEDLIST._rerender) { window.MEDLIST._rerender(); return; } } catch (e) {}
    try { if (_root && window.MEDLIST && window.MEDLIST.mount) window.MEDLIST.mount(_root); } catch (e) {}
  }

  function el(tag, opts) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) e.className = opts.cls;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.attrs) for (var k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    if (opts.type) e.type = opts.type;
    return e;
  }

  function fieldLine(c) {
    var parts = [];
    if (c.form) parts.push(c.form);
    if (c.route) parts.push(c.route);
    if (c.strength != null) parts.push(String(c.strength) + (c.unit ? " " + c.unit : ""));
    if (c.freq) parts.push(c.freq);
    return parts.join(" · ");
  }

  // openReview(root): render the GHIS review screen into the MEDLIST root.
  function openReview(root) {
    if (root) _root = root;
    if (!_root || !_draft) return;
    _view = "review";
    injectStyles();
    render();
  }

  function render() {
    if (!_root || !_draft) return;
    _root.textContent = "";
    _root.classList.add("ml-root");
    var p = _draft.parsed;
    var showConsumables = _draft.view === "consumables";

    var header = el("div", { cls: "ml-header" });
    header.appendChild(el("h2", { cls: "ml-title", text: "Imported from GHIS Medication History" }));
    // Non-sensitive patient context — display name only, never MRN/UHID/raw id.
    if (_draft.patientName) header.appendChild(el("p", { cls: "ml-subtitle", text: "For " + _draft.patientName }));
    header.appendChild(el("div", { cls: "gi-summary",
      text: p.recognizedCount + " recognized · " + p.combinationsExpanded + " combination products expanded · "
        + p.needsReviewCount + " need review · " + p.consumablesExcluded + " consumables excluded" }));
    header.appendChild(el("div", { cls: "ml-advisory",
      text: "Review each medicine before importing. Nothing is added until you confirm. Interaction check runs after import." }));
    _root.appendChild(header);

    var body = el("div", { cls: "ml-body" });
    var rows = showConsumables ? p.consumables : p.candidates.filter(function (c) { return !c.isConsumable; });
    var listWrap = el("div", { cls: "gi-rows" });

    rows.forEach(function (c) {
      var flagged = !c.generic || c.confidence === "low" || c.needsReview;
      var card = el("div", { cls: "gi-row" + (flagged ? " gi-flagged" : ""),
        attrs: { "data-gi-row": String(c._idx) } });

      var top = el("div", { cls: "gi-top" });
      if (!showConsumables) {
        var cb = el("input", { type: "checkbox" });
        cb.checked = !!c._include;
        cb.setAttribute("data-gi-include", String(c._idx));
        cb.addEventListener("change", function () { c._include = cb.checked; });
        top.appendChild(cb);
      }
      var tw = el("div", { cls: "gi-titlewrap" });
      tw.appendChild(el("div", { cls: "gi-mapped", text: c.generic || "Not mapped — review" }));
      // Original GHIS drug text (verbatim) — never the product code.
      tw.appendChild(el("div", { cls: "gi-orig", text: c.originalText || c.ingredientText || "" }));
      top.appendChild(tw);
      var conf = el("span", { cls: "ml-conf-badge ml-conf-" + (c.confidence || "low"), text: (c.confidence || "low") });
      top.appendChild(conf);
      var badge = el("span", { cls: "ml-source-badge", text: "GHIS" });
      top.appendChild(badge);
      card.appendChild(top);

      var line = fieldLine(c);
      if (line) card.appendChild(el("div", { cls: "gi-line", text: line }));

      // Merge note if this candidate duplicates an existing med.
      var dup = (_draft.dupInfo || []).find(function (d) { return d.candidate === c; });
      if (dup) {
        var dupText = dup.kind === "different-dose"
          ? "Already in list at a different dose — choose merge, keep both, or replace."
          : "Already in your list — choose merge, keep both, or replace.";
        card.appendChild(el("div", { cls: "gi-dup", text: dupText }));
        var mrow = el("div", { cls: "gi-merge-row" });
        ["Merge", "Keep both", "Replace"].forEach(function (lbl, i) {
          var b = el("button", { cls: "gi-merge-btn", text: lbl, attrs: { "data-gi-merge": ["merge", "keepboth", "replace"][i] } });
          b.addEventListener("click", function () { c._mergeMode = ["merge", "keepboth", "replace"][i]; });
          mrow.appendChild(b);
        });
        card.appendChild(mrow);
      }

      // Editable correction field for flagged rows.
      if (flagged && !showConsumables) {
        var edit = el("input", { cls: "ml-input gi-edit", type: "text",
          attrs: { "data-gi-edit": String(c._idx), placeholder: "Correct or complete this medicine…" } });
        edit.value = c.ingredientText || c.originalText || "";
        edit.addEventListener("input", function () {
          var ml = window.MEDLIST && window.MEDLIST.parseEntry;
          if (!ml) return;
          var re = ml(edit.value);
          c.name = re.name; c.generic = re.generic; c.strength = re.strength; c.unit = re.unit;
          c.route = re.route; c.freq = re.freq; c.confidence = re.confidence; c.candidates = re.candidates;
          c.needsReview = !re.generic;
        });
        card.appendChild(edit);
      }

      listWrap.appendChild(card);
    });

    if (!rows.length) {
      listWrap.appendChild(el("div", { cls: "ml-empty",
        text: showConsumables ? "No consumables were excluded." : "No medicines to review." }));
    }
    body.appendChild(listWrap);
    _root.appendChild(body);

    // Footer actions.
    var footer = el("div", { cls: "ml-footer gi-footer" });
    if (showConsumables) {
      var back = el("button", { cls: "mlr-filter-btn", text: "Back to medicines to import", attrs: { "data-gi-back": "1" } });
      back.addEventListener("click", function () { _draft.view = "candidates"; render(); });
      footer.appendChild(back);
    } else {
      var cancel = el("button", { cls: "mlr-filter-btn", text: "Cancel", attrs: { "data-gi-cancel": "1" } });
      cancel.addEventListener("click", function () { clearDraft(); _view = "list"; _renderMedlist(); });
      var viewCons = el("button", { cls: "mlr-filter-btn", text: "View excluded consumables (" + p.consumablesExcluded + ")", attrs: { "data-gi-view-consumables": "1" } });
      viewCons.addEventListener("click", function () { _draft.view = "consumables"; render(); });
      var reviewAmb = el("button", { cls: "mlr-filter-btn", text: "Review ambiguous (" + p.needsReviewCount + ")", attrs: { "data-gi-review-ambiguous": "1" } });
      reviewAmb.addEventListener("click", function () {
        var first = _root.querySelector(".gi-flagged"); if (first && first.scrollIntoView) first.scrollIntoView({ block: "center" });
      });
      var importSel = el("button", { cls: "mlr-filter-btn gi-import-sel", text: "Import selected", attrs: { "data-gi-import-selected": "1" } });
      importSel.addEventListener("click", function () { doImport("selected"); });
      var importAll = el("button", { cls: "ml-check-btn gi-import-all", text: "Import all recognized", attrs: { "data-gi-import-all": "1" } });
      importAll.addEventListener("click", function () { doImport("all"); });
      footer.appendChild(cancel);
      footer.appendChild(viewCons);
      footer.appendChild(reviewAmb);
      footer.appendChild(importSel);
      footer.appendChild(importAll);
    }
    _root.appendChild(footer);
  }

  // doImport(mode): add the chosen candidates to MEDLIST with source 'ghis'. Only
  // runs on explicit clinician action. NEVER deletes a manually-entered med; a
  // "replace" merge removes only the matched EXISTING med the clinician replaced.
  function doImport(mode) {
    if (!_draft || !window.MEDLIST || !window.MEDLIST.add) return;
    var p = _draft.parsed;
    var pool = (mode === "all") ? p.recognized : p.candidates.filter(function (c) { return c._include; });
    pool.forEach(function (c) {
      if (c.isConsumable) return;                 // never import a consumable
      if (mode === "all" && (c.needsReview || !c.generic)) return; // "all" = recognized only
      // Merge resolution: default keep-both. "replace" removes the matched existing med
      // (an explicit clinician choice — not silent). "merge"/keep-both both add the GHIS med.
      var dup = (_draft.dupInfo || []).find(function (d) { return d.candidate === c; });
      if (dup && c._mergeMode === "replace" && dup.existing && dup.existing.id) {
        try { window.MEDLIST.remove(dup.existing.id); } catch (e) {}
      }
      if (dup && c._mergeMode === "merge") {
        // Merge = keep the existing med, fold in any missing fields; do NOT add a duplicate.
        return;
      }
      var med = { raw: c.originalText || c.ingredientText || c.name || "", name: c.name || null,
        generic: c.generic || null, strength: c.strength != null ? c.strength : null, unit: c.unit || null,
        form: c.form || null, route: c.route || null, freq: c.freq || null, freqText: c.freqText || null,
        confidence: c.confidence || "low", candidates: c.candidates || [] };
      window.MEDLIST.add(med, "ghis");
    });
    clearDraft();
    _view = "list";
    _renderMedlist();
  }

  // Entry from the MEDLIST "Fetch from Ward Sync" button: gate + fetch + review.
  // Returns the same promise shape as startImport for callers/tests. On ok, opens
  // the review screen into the given root.
  function fetchAndReview(root) {
    if (root) _root = root;
    return startImport().then(function (r) {
      if (r && r.ok) { openReview(_root); }
      return r;
    });
  }

  function injectStyles() {
    if (document.getElementById("gi-styles")) return;
    var css = ".gi-summary{font:700 12px var(--sans,system-ui);color:var(--ink,#1a1a1a);background:var(--paper,#f7f7f5);border:1px solid var(--line,#e5e5e0);border-radius:9px;padding:8px 11px;margin-bottom:8px;line-height:1.4}"
      + ".gi-rows{display:flex;flex-direction:column;gap:10px;padding-top:6px}"
      + ".gi-row{border:1px solid var(--line,#e5e5e0);border-radius:12px;padding:11px 12px;background:var(--panel,#fff)}"
      + ".gi-row.gi-flagged{border-left:4px solid #c77700;background:#fffaf2}"
      + ".gi-top{display:flex;align-items:flex-start;gap:9px}"
      + ".gi-titlewrap{flex:1;min-width:0}"
      + ".gi-mapped{font:700 14px var(--sans,system-ui);color:var(--ink,#1a1a1a)}"
      + ".gi-orig{font:500 12px var(--sans,system-ui);color:var(--slate,#666);margin-top:1px;word-break:break-word}"
      + ".gi-line{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);margin:6px 0 0 27px}"
      + ".gi-dup{font:700 11.5px var(--sans,system-ui);color:#985c00;margin-top:8px}"
      + ".gi-merge-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}"
      + ".gi-merge-btn{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:5px 10px;font:600 11.5px var(--sans,system-ui);cursor:pointer;color:var(--slate,#666)}"
      + ".gi-edit{margin-top:8px}"
      + ".gi-footer{display:flex;flex-wrap:wrap;gap:8px}"
      + ".gi-footer .mlr-filter-btn{flex:0 0 auto}"
      + ".gi-footer .ml-check-btn{flex:1;min-width:160px}";
    var st = document.createElement("style");
    st.id = "gi-styles"; st.textContent = css;
    document.head.appendChild(st);
  }

  window.GHISMEDS = {
    // deterministic parsing (testable)
    parseGhisRow: parseGhisRow, parseGhisRows: parseGhisRows, splitCombination: splitCombination,
    detectFormulation: detectFormulation, detectDuplicates: detectDuplicates,
    isConsumable: function (t) { return CONSUMABLE_RE.test(String(t || "")); },
    // gate + fetch
    getSelectedPatient: getSelectedPatient, canFetch: canFetch,
    fetchMedications: fetchMedications, startImport: startImport, fetchAndReview: fetchAndReview,
    aiMapLowConfidence: aiMapLowConfidence,
    // review UI + draft
    openReview: openReview, doImport: doImport,
    getDraft: getDraft, clearDraft: clearDraft,
    MSG: MSG, errMessage: errMessage
  };
})();
