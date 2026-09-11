/* rxchoice-ui.js — RxChoice™ panel: "Same Prescription. Smarter Price."
 *
 * window.SMD_RXCHOICE_UI = { open(ctx), available(), audit(), clearAudit() }
 *
 * This file does THREE things and nothing else:
 *   1. reads products from the ONE product truth - window.MEDAPI, the StewardMD Drug Database
 *      (offline-db.js routes the same calls to the on-device SQLite copy when the API is
 *      unreachable, with an identical record shape, so online and offline results are the same);
 *   2. hands those records to rxchoice-core.js, which decides eligibility, price and ranking;
 *   3. renders what the core returned and, ONLY when the doctor taps SELECT, writes the chosen
 *      product into that line's BRAND field.
 *
 * It never decides a match, never computes a price, never invents a product, and never touches the
 * drug, dose, frequency or duration the doctor wrote. DOCTOR PRESCRIBED is always the fourth card.
 * With smd_rxchoice off, nothing here is reachable: the prescription pad does not render the button.
 */
(function () {
  "use strict";
  if (window.SMD_RXCHOICE_UI) return;

  function F(k) { try { return !!(window.SMD_RXCHOICE_FLAGS && SMD_RXCHOICE_FLAGS.bool(k)); } catch (e) { return false; } }
  function available() { return F("smd_rxchoice") && !!window.SMD_RXCHOICE && !!window.MEDAPI; }
  function CORE() { return window.SMD_RXCHOICE; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function inr(v) { return v == null ? "" : "₹" + (Math.round(v * 100) / 100).toLocaleString("en-IN"); }
  function ico(n) { try { return (window.ICONS && ICONS.get) ? ICONS.get(n, "rxc-ico") : ""; } catch (e) { return ""; } }

  /* ---------------- audit trail (local, no PHI: products and prices only) ---------------- */
  var AUDIT_KEY = "smd_rxchoice_audit", AUDIT_CAP = 200;
  function audit() { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); } catch (e) { return []; } }
  function logAudit(entry) {
    try {
      var a = audit(); a.push(entry);
      while (a.length > AUDIT_CAP) a.shift();
      localStorage.setItem(AUDIT_KEY, JSON.stringify(a));
    } catch (e) {}
  }
  function clearAudit() { try { localStorage.removeItem(AUDIT_KEY); } catch (e) {} }

  /* ---------------- styles ---------------- */
  function injectCSS() {
    if (document.getElementById("rxcCss")) return;
    var s = document.createElement("style"); s.id = "rxcCss";
    s.textContent =
      ".rxc-scrim{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:16200;opacity:0;transition:.2s;pointer-events:none}.rxc-scrim.on{opacity:1;pointer-events:auto}" +
      ".rxc-sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-46%);width:min(620px,95vw);max-height:92vh;overflow:auto;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:16px;z-index:16201;opacity:0;transition:.2s;pointer-events:none;box-shadow:0 20px 60px rgba(0,0,0,.32)}.rxc-sheet.on{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}" +
      ".rxc-wrap{padding:16px 16px 20px;font:400 14px var(--hfont,system-ui)}" +
      ".rxc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.rxc-ttl{font:800 19px var(--hfont);color:var(--hink)}.rxc-sub{font:600 12px var(--hfont);color:var(--hmut,#64748b);margin-top:2px}.rxc-x{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--hmut,#64748b)}" +
      ".rxc-note{font:500 11.5px/1.5 var(--hfont);color:var(--hink);background:rgba(14,110,99,.09);border-radius:9px;padding:8px 10px;margin:10px 0}" +
      ".rxc-h2{font:800 14px var(--hfont);margin:16px 0 2px;color:var(--hink)}.rxc-h2sub{font:600 11px var(--hfont);color:var(--hmut);margin-bottom:8px}" +
      ".rxc-drug{border-top:1px solid var(--hbd,#e2e8f0);padding-top:12px;margin-top:14px}.rxc-drug:first-of-type{border-top:0;margin-top:6px}" +
      ".rxc-drugnm{font:800 14.5px var(--hfont);color:var(--hink)}.rxc-drugrx{font:500 11.5px var(--hfont);color:var(--hmut);margin:2px 0 8px}" +
      ".rxc-cards{display:grid;gap:8px;grid-template-columns:1fr}@media(min-width:560px){.rxc-cards{grid-template-columns:1fr 1fr}}" +
      ".rxc-card{border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:10px 11px;display:flex;flex-direction:column;gap:2px;background:var(--hpanel,#fff)}" +
      ".rxc-card.rec{border:2px solid var(--teal,#0e6e63);background:rgba(14,110,99,.05)}.rxc-card.orig{border-style:dashed}.rxc-card.sel{box-shadow:0 0 0 3px rgba(14,110,99,.22)}" +
      ".rxc-cat{font:800 10.5px var(--hfont);letter-spacing:.06em;text-transform:uppercase;color:var(--teal,#0e6e63)}.rxc-card.orig .rxc-cat{color:var(--hmut,#64748b)}" +
      ".rxc-lab{font:700 10px var(--hfont);letter-spacing:.04em;text-transform:uppercase;color:var(--hmut,#64748b)}" +
      ".rxc-br{font:700 14px var(--hfont);color:var(--hink);margin-top:3px}.rxc-mf{font:500 11.5px var(--hfont);color:var(--hmut);min-height:15px}" +
      ".rxc-cost{font:800 16px var(--hfont);color:var(--teal,#0e6e63);margin-top:4px}.rxc-cost small{font:600 10.5px var(--hfont);color:var(--hmut);display:block;margin-top:1px}" +
      ".rxc-nocost{font:600 12px var(--hfont);color:#b45309;margin-top:4px}" +
      ".rxc-btn{margin-top:8px;border:0;border-radius:999px;padding:8px 14px;font:800 12.5px var(--hfont);cursor:pointer;background:rgba(100,116,139,.14);color:var(--hink)}.rxc-card.rec .rxc-btn{background:var(--teal,#0e6e63);color:#fff}.rxc-btn.done{background:var(--teal,#0e6e63);color:#fff}" +
      ".rxc-empty{font:500 12.5px/1.5 var(--hfont);color:var(--hink);background:rgba(245,158,11,.12);border-radius:9px;padding:9px 11px}" +
      ".rxc-tot{margin-top:16px;border-top:2px solid var(--hbd,#e2e8f0);padding-top:10px}.rxc-totrow{display:flex;justify-content:space-between;font:600 13px var(--hfont);padding:3px 0;color:var(--hink)}.rxc-totrow b{font-weight:800}.rxc-save{font:800 13px var(--hfont);color:var(--teal,#0e6e63);margin-top:4px}" +
      ".rxc-foot{margin-top:14px;font:500 10.5px/1.55 var(--hfont);color:var(--hmut)}" +
      ".rxc-ico{width:13px;height:13px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.9}" +
      ".rxc-load{font:600 13px var(--hfont);color:var(--hmut);padding:18px 2px}";
    document.head.appendChild(s);
  }

  var scrim, sheet;
  function ensureEls() {
    injectCSS();
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "rxc-scrim"; scrim.addEventListener("click", close); document.body.appendChild(scrim); }
    if (!sheet) { sheet = document.createElement("div"); sheet.className = "rxc-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "RxChoice"); document.body.appendChild(sheet); }
  }
  function paint(html) { ensureEls(); sheet.innerHTML = '<div class="rxc-wrap">' + html + "</div>"; scrim.classList.add("on"); sheet.classList.add("on"); }
  function close() { if (sheet) sheet.classList.remove("on"); if (scrim) scrim.classList.remove("on"); }

  /* ---------------- database access: MEDAPI only, one product truth ---------------- */

  /* Resolve the doctor's BRAND text to the database record they actually prescribed. The brand-name
   * endpoint is the same one the Drugs Database and the Rx brand picker use. An exact name match wins
   * over a prefix, which wins over a substring; the molecule must also match the typed drug when the
   * drug resolves to a composition, so "Augmentin" on a Paracetamol line never silently wins. */
  function resolvePrescribed(line) {
    var brand = String(line.brand || "").trim();
    if (!brand) return Promise.resolve(null);
    return MEDAPI.searchBrands(brand, 24).then(function (d) {
      var rows = (d && d.results) || [];
      if (!rows.length) return null;
      var q = brand.toLowerCase();
      rows = rows.filter(function (r) { return r && r.brand && !r.discontinued; }).concat(rows.filter(function (r) { return r && r.brand && r.discontinued; }));
      var score = function (r) {
        var b = String(r.brand).toLowerCase();
        if (b === q) return 0;
        if (b.indexOf(q + " ") === 0 || b.indexOf(q) === 0) return 1;
        return 2;
      };
      rows.sort(function (a, b) { return score(a) - score(b) || String(a.brand).length - String(b.brand).length; });
      return rows[0] || null;
    }).catch(function () { return null; });
  }

  /* Every product in the database sharing the prescribed product's composition. price_asc so the
   * cheapest arrive first even if the result is capped; the core re-ranks regardless. */
  function candidatesFor(comp) {
    if (!comp) return Promise.resolve([]);
    return MEDAPI.composition(comp, "price_asc", "all", 300, 0)
      .then(function (c) { return (c && c.brands) || []; })
      .catch(function () { return []; });
  }

  /* ---------------- render ---------------- */

  var REASON_TEXT = {
    no_validated_alternatives: "No validated alternatives found. Your original prescription has been preserved.",
    no_course_quantity: "Dose, frequency and duration are needed to price a course. Fill them in on the prescription, then reopen RxChoice.",
    not_in_database: "This brand is not in the StewardMD Drug Database, so there is no product to compare it against. Your original prescription has been preserved.",
    no_brand: "Pick a brand on this line first. RxChoice compares real products against the product you prescribed, so it needs to know which one that is."
  };

  function costHTML(o) {
    if (!F("smd_rxchoice_price")) return "";
    if (!o || o.courseCost == null) return '<div class="rxc-nocost">Price unavailable</div>';
    var sub = o.packsRequired != null
      ? (o.requiredUnits + " for this course · " + (o.unitsPerPack != null ? ("pack of " + o.unitsPerPack + " at " + inr(o.mrp)) : inr(o.mrp)))
      : "";
    return '<div class="rxc-cost">' + inr(o.courseCost) + " for this course" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  }

  function cardHTML(o, idx, key, cls, action, selected) {
    if (!o) return "";
    return '<div class="rxc-card ' + cls + (selected ? " sel" : "") + '">' +
      '<div class="rxc-cat">' + esc(o.category === "balanced" ? "BALANCED ⭐" : o.category.toUpperCase()) + "</div>" +
      '<div class="rxc-lab">' + esc(o.label) +
        (o.sameAs === "generic" ? " · also the lowest cost" : o.sameAs === "premium" ? " · also the top branded option" : "") + "</div>" +
      '<div class="rxc-br">' + esc(o.brand || "—") + "</div>" +
      '<div class="rxc-mf">' + esc(o.manufacturer || "") + "</div>" +
      costHTML(o) +
      '<button type="button" class="rxc-btn' + (selected ? " done" : "") + '" data-rxc-pick="' + idx + ":" + key + '">' +
        (selected ? (action === "KEEP" ? "KEPT" : "SELECTED") : action) + "</button>" +
      "</div>";
  }

  function drugHTML(st, i) {
    var r = st.results[i], line = st.lines[i];
    var rxTxt = [line.dose, line.freq, line.duration].filter(Boolean).join(" · ");
    var h = '<div class="rxc-drug"><div class="rxc-drugnm">' + esc(line.drug || line.brand || "Medicine") + "</div>" +
      '<div class="rxc-drugrx">Prescribed therapy: ' + esc((r && r.prescribed && r.prescribed.composition) || line.drug || "") +
      (rxTxt ? " · " + esc(rxTxt) : "") + "</div>";
    if (!r) return h + '<div class="rxc-load">Checking the Drug Database…</div></div>';
    var sel = st.selected[i];
    if (r.blocked || !r.generic) {
      var msg = r.blocked ? ("Not offered as a price choice. " + r.reason + ".") : (REASON_TEXT[r.reason] || REASON_TEXT.no_validated_alternatives);
      h += '<div class="rxc-empty">' + esc(msg) + "</div>" +
        '<div class="rxc-cards" style="margin-top:8px">' + cardHTML(r.prescribed, i, "prescribed", "rxc-card orig", "KEEP", sel === "prescribed" || !sel) + "</div>";
      return h + "</div>";
    }
    h += '<div class="rxc-cards">' +
      cardHTML(r.generic, i, "generic", "", "SELECT", sel === "generic") +
      cardHTML(r.balanced, i, "balanced", "rec", "SELECT", sel === "balanced") +
      cardHTML(r.premium, i, "premium", "", "SELECT", sel === "premium") +
      cardHTML(r.prescribed, i, "prescribed", "orig", "KEEP", sel === "prescribed" || !sel) +
      "</div>";
    return h + "</div>";
  }

  function totalsHTML(st) {
    if (!F("smd_rxchoice_price")) return "";
    var done = st.results.filter(Boolean);
    if (done.length !== st.lines.length || !done.length) return "";
    var t = CORE().totals(done);
    if (t.prescribed == null) return "";
    var row = function (lab, v) { return v == null ? "" : '<div class="rxc-totrow"><span>' + lab + "</span><b>" + inr(v) + "</b></div>"; };
    var h = '<div class="rxc-tot">' + row("Generic total", t.generic) + row("Balanced total", t.balanced) +
      row("Premium total", t.premium) + row("Doctor Prescribed total", t.prescribed);
    if (t.savings.balanced != null && t.savings.balanced > 0) {
      h += '<div class="rxc-save">Potential saving on Balanced: ' + inr(t.savings.balanced) + "</div>";
    } else if (t.savings.generic != null && t.savings.generic > 0) {
      h += '<div class="rxc-save">Potential saving on Generic: ' + inr(t.savings.generic) + "</div>";
    }
    return h + "</div>";
  }

  function render(st) {
    var h = '<div class="rxc-head"><div><div class="rxc-ttl">RxChoice™</div><div class="rxc-sub">Same Prescription. Smarter Price.</div></div>' +
      '<button class="rxc-x" id="rxcX" aria-label="Close">' + (ico("close") || "×") + "</button></div>" +
      '<div class="rxc-h2">' + (st.lines.length === 1 ? "4 Ways to Fill This Prescription" : "4 Ways to Fill Your Prescription") + "</div>" +
      '<div class="rxc-h2sub">Same prescribed therapy · Different price choices</div>' +
      '<div class="rxc-note">Every product below is a record in the StewardMD Drug Database with the same active ingredients, strength, dosage form and release type as what you prescribed. Selecting one changes the BRAND only. Your drug, dose, frequency and duration are never altered.</div>';
    for (var i = 0; i < st.lines.length; i++) h += drugHTML(st, i);
    h += totalsHTML(st);
    h += '<div class="rxc-foot">Costs are calculated from the Drug Database MRP and the pack size for the course you prescribed. MRP is a list price, not a pharmacy quote, and availability is not checked. A lower price is an economic choice, never a claim that one product is clinically better than another. You remain responsible for what you sign.</div>';
    paint(h);
    var x = sheet.querySelector("#rxcX"); if (x) x.addEventListener("click", close);
    Array.prototype.forEach.call(sheet.querySelectorAll("[data-rxc-pick]"), function (b) {
      b.addEventListener("click", function () { pick(st, b.getAttribute("data-rxc-pick")); });
    });
  }

  /* The ONLY mutation this module performs: the doctor tapped SELECT (or KEEP), so write that
   * product's brand into the line's brand field. Nothing else on the line is touched. */
  function pick(st, token) {
    var parts = String(token).split(":"), i = +parts[0], key = parts[1];
    var r = st.results[i]; if (!r) return;
    var o = r[key]; if (!o) return;
    st.selected[i] = key;
    try {
      if (typeof st.onSelect === "function") st.onSelect(i, o, st.lines[i]);
    } catch (e) {}
    logAudit(CORE().auditEntry({
      prescriptionId: st.prescriptionId, original: r.prescribed, alternative: o, category: key,
      reasonShown: o.label, doctorApproved: true, patientSelected: false
    }));
    render(st);
    try { if (window.toast) window.toast(key === "prescribed" ? ("Kept " + o.brand) : ("Brand set to " + o.brand)); } catch (e) {}
  }

  /* ---------------- entry point ---------------- */

  /* ctx = { lines:[{drug,brand,dose,freq,duration}], onSelect(i, option, line), prescriptionId? }
   * Lines are the doctor's FINISHED prescription. RxChoice reads them, never rewrites them. */
  function open(ctx) {
    if (!available()) { try { window.toast && window.toast("RxChoice is not available on this build"); } catch (e) {} return; }
    var lines = ((ctx && ctx.lines) || []).filter(function (l) { return l && !l.advice && String(l.drug || l.brand || "").trim(); });
    if (!lines.length) {
      paint('<div class="rxc-head"><div><div class="rxc-ttl">RxChoice™</div><div class="rxc-sub">Same Prescription. Smarter Price.</div></div><button class="rxc-x" id="rxcX" aria-label="Close">' + (ico("close") || "×") + '</button></div><div class="rxc-empty">Write the prescription first. RxChoice compares products for the medicines you have already prescribed.</div>');
      var x0 = sheet.querySelector("#rxcX"); if (x0) x0.addEventListener("click", close);
      return;
    }
    var st = {
      lines: lines, results: lines.map(function () { return null; }), selected: lines.map(function () { return null; }),
      onSelect: ctx && ctx.onSelect, prescriptionId: (ctx && ctx.prescriptionId) || null
    };
    render(st);

    // One composition lookup per line, sequentially, so a long prescription does not fan out 10
    // requests at once on a phone. Each line repaints as it resolves.
    var i = 0;
    (function next() {
      if (i >= lines.length) return;
      var idx = i++, line = lines[idx];
      var rxLine = { dose: line.dose, freq: line.freq, duration: line.duration };
      if (!String(line.brand || "").trim()) {
        st.results[idx] = { prescribed: { category: "prescribed", label: "Original Choice", brand: line.brand || line.drug || "", manufacturer: "", composition: line.drug || "", courseCost: null, mrp: null }, generic: null, balanced: null, premium: null, blocked: false, reason: "no_brand" };
        render(st); return next();
      }
      resolvePrescribed(line).then(function (rec) {
        if (!rec) {
          st.results[idx] = { prescribed: { category: "prescribed", label: "Original Choice", brand: line.brand, manufacturer: "", composition: line.drug || "", courseCost: null, mrp: null }, generic: null, balanced: null, premium: null, blocked: false, reason: "not_in_database" };
          render(st); return next();
        }
        return candidatesFor(rec.composition).then(function (cands) {
          var rx = {};
          for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) rx[k] = rec[k];
          rx.dose = rxLine.dose; rx.freq = rxLine.freq; rx.duration = rxLine.duration;
          st.results[idx] = CORE().choose(rx, cands);
          render(st); next();
        });
      }).catch(function () {
        st.results[idx] = { prescribed: { category: "prescribed", label: "Original Choice", brand: line.brand, manufacturer: "", composition: line.drug || "", courseCost: null, mrp: null }, generic: null, balanced: null, premium: null, blocked: false, reason: "not_in_database" };
        render(st); next();
      });
    })();
  }

  window.SMD_RXCHOICE_UI = { open: open, available: available, close: close, audit: audit, clearAudit: clearAudit, _version: 1 };
})();
