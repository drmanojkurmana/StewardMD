/* rxchoice-autopilot.js — automatic RxChoice population for the prescription pad.
 *
 * Purpose: RxChoice must not depend on the doctor remembering to open a second panel before seeing
 * the four choices. This lightweight adapter watches the existing prescription sheet, asks the
 * StewardMD Drug Database for the prescribed product and its same-composition products, then lets
 * the deterministic RxChoice core populate GENERIC / BALANCED / PREMIUM / DOCTOR PRESCRIBED.
 *
 * SAFETY CONTRACT
 * - MEDAPI is the only product source. No generated brands, prices or manufacturers.
 * - rxchoice-core.js is the only eligibility/ranking authority.
 * - A card can write ONLY the BRAND field. Drug, dose, frequency and duration are untouched.
 * - The core's exact composition + strength + dosage-form + release checks are preserved. In
 *   particular, paracetamol tablet can never become paracetamol syrup.
 * - No automatic substitution is performed. The doctor must tap a product to change the brand.
 *
 * This file is deliberately additive and small. It is loaded by rxchoice-flags.js after the existing
 * RxChoice files are available, so no HTML/build-manifest change is required.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.SMD_RXCHOICE_AUTOPILOT) return;

  var G = window, timer = null, seq = 0, lastSig = "", rowsBusy = false;
  var CSS_ID = "rxcAutoCss";

  function on() {
    try { return !!(G.SMD_RXCHOICE_FLAGS && G.SMD_RXCHOICE_FLAGS.on() && G.SMD_RXCHOICE && G.MEDAPI); }
    catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>\"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]; }); }
  function money(v) { return v == null ? "Price unavailable" : "₹" + (Math.round(Number(v) * 100) / 100).toLocaleString("en-IN"); }
  function core() { return G.SMD_RXCHOICE; }

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement("style"); s.id = CSS_ID;
    s.textContent =
      ".rxc-auto{margin:8px 0 4px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#fbfdff;padding:9px 10px;font:400 11.5px/1.35 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f}" +
      ".rxc-auto-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}" +
      ".rxc-auto-title{font:600 9.5px -apple-system,BlinkMacSystemFont,system-ui;letter-spacing:.04em;text-transform:uppercase;color:#0071e3}" +
      ".rxc-auto-status{font:400 10px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b}" +
      ".rxc-auto-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}" +
      ".rxc-auto-card{min-width:0;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:#fff;padding:7px 8px;cursor:pointer;text-align:left;color:inherit;transition:all .15s ease}" +
      ".rxc-auto-card:hover{border-color:rgba(0,113,227,.35);box-shadow:0 2px 8px rgba(0,0,0,.04)}" +
      ".rxc-auto-card.rec{border:1px solid rgba(0,113,227,.3);background:#fafcff;box-shadow:0 0 0 1px rgba(0,113,227,.15)}" +
      ".rxc-auto-cat{font:600 8.5px -apple-system,BlinkMacSystemFont,system-ui;letter-spacing:.04em;text-transform:uppercase;color:#86868b}" +
      ".rxc-auto-card.rec .rxc-auto-cat{color:#0071e3}" +
      ".rxc-auto-brand{font:600 11.5px/1.25 -apple-system,BlinkMacSystemFont,system-ui;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1d1d1f}" +
      ".rxc-auto-cost{font:600 10.5px -apple-system,BlinkMacSystemFont,system-ui;color:#1d1d1f;margin-top:2px}" +
      ".rxc-auto-note{padding:4px 2px;color:#86868b}" +
      ".rxc-auto-badge{font:600 8px -apple-system,BlinkMacSystemFont,system-ui;color:#0071e3;margin-left:4px;background:rgba(0,113,227,.08);padding:1px 5px;border-radius:999px}";
    document.head.appendChild(s);
  }

  function sheet() { return document.getElementById("rxSheet"); }
  function getRows() {
    var sh = sheet(); if (!sh) return [];
    return Array.from(sh.querySelectorAll("#rxLines .rx-line:not(.adv)")).map(function (line) {
      return {
        line: line,
        drug: String((line.querySelector('[data-f="drug"]') || {}).value || "").trim(),
        brand: String((line.querySelector('[data-f="brand"]') || {}).value || "").trim(),
        dose: String((line.querySelector('[data-f="dose"]') || {}).value || "").trim(),
        freq: String((line.querySelector('[data-f="freq"]') || {}).value || "").trim(),
        duration: String((line.querySelector('[data-f="duration"]') || {}).value || "").trim()
      };
    });
  }

  function signature(rows) {
    return rows.map(function (r) { return [r.drug,r.brand,r.dose,r.freq,r.duration].join("¦"); }).join("§");
  }

  function resolveBrand(row) {
    var brand = typeof row === "string" ? row : (row && row.brand);
    if (!brand) return Promise.resolve(null);
    if (G.SMD_RXCHOICE_UI && G.SMD_RXCHOICE_UI.resolvePrescribed) {
      return G.SMD_RXCHOICE_UI.resolvePrescribed(typeof row === "string" ? { brand: brand } : row).then(function (rec) {
        if (rec && !rec.pack && rec.form) rec.pack = rec.form;
        return rec;
      });
    }
    if (!G.MEDAPI.searchBrands) return Promise.resolve(null);
    return G.MEDAPI.searchBrands(brand, 24).then(function (d) {
      var rows = (d && d.results) || [];
      if (!rows.length) return null;
      var q = brand.toLowerCase();
      rows = rows.filter(function (r) { return r && r.brand; });
      rows.sort(function (a,b) {
        var aa = String(a.brand).toLowerCase(), bb = String(b.brand).toLowerCase();
        function score(x) { return x === q ? 0 : (x.indexOf(q + " ") === 0 || x.indexOf(q) === 0 ? 1 : 2); }
        return score(aa) - score(bb) || String(aa).length - String(bb).length;
      });
      var active = rows.filter(function (r) { return !r.discontinued; });
      var rec = active[0] || rows[0] || null;
      if (rec && !rec.pack && rec.form) rec.pack = rec.form;
      return rec;
    }).catch(function () { return null; });
  }

  function candidates(comp) {
    if (!comp || !G.MEDAPI.composition) return Promise.resolve([]);
    return G.MEDAPI.composition(comp, "price_asc", "all", 300, 0)
      .then(function (d) {
        var list = (d && d.brands) || [];
        var compName = (d && d.composition) || comp;
        return list.map(function (b) {
          return {
            id: b.id,
            brand: b.brand,
            manufacturer: b.manufacturer,
            mrp: b.mrp,
            form: b.form,
            pack: b.pack || b.form,
            composition: b.composition || compName,
            discontinued: b.discontinued
          };
        });
      })
      .catch(function () { return []; });
  }

  function choose(row, prescribed, cands) {
    var rx = {};
    Object.keys(prescribed || {}).forEach(function (k) { rx[k] = prescribed[k]; });
    if (!rx.pack && rx.form) rx.pack = rx.form;
    rx.dose = row.dose; rx.freq = row.freq; rx.duration = row.duration;
    return core().choose(rx, cands);
  }

  function card(category, o) {
    if (!o) return '<div class="rxc-auto-card"><div class="rxc-auto-cat">' + esc(category) + '</div><div class="rxc-auto-note">No validated match</div></div>';
    var isRec = typeof category === "string" && category.indexOf("BALANCED") === 0;
    var label = category === "DOCTOR PRESCRIBED" ? "DOCTOR PRESCRIBED" : category;
    return '<button type="button" class="rxc-auto-card' + (isRec ? " rec" : "") + '" data-rxc-auto="1" data-rxc-cat="' + esc(o.category || category.toLowerCase()) + '">' +
      '<div class="rxc-auto-cat">' + esc(label) + (isRec ? '<span class="rxc-auto-badge">RECOMMENDED VALUE</span>' : '') + '</div>' +
      '<div class="rxc-auto-brand">' + esc(o.brand || "-") + '</div>' +
      '<div class="rxc-auto-cost">' + (o.courseCost != null ? money(o.courseCost) + " / course" : (o.mrp != null ? money(o.mrp) : "Price unavailable")) + '</div></button>';
  }

  function paint(row, result) {
    var old = row.line.querySelector(":scope > .rxc-auto");
    if (old) old.remove();
    // If prescription.js inline container is active on this line, do not double-render
    if (row.line.querySelector(".rxc-inline-box") || row.line.querySelector(".rxc-inline-container")) return;
    var wrap = document.createElement("div"); wrap.className = "rxc-auto";
    if (!result) {
      wrap.innerHTML = '<div class="rxc-auto-head"><span class="rxc-auto-title">RxChoice™</span><span class="rxc-auto-status">No database match</span></div>' +
        '<div class="rxc-auto-note">Pick a database brand first. RxChoice will populate validated alternatives automatically.</div>';
      row.line.appendChild(wrap); return;
    }
    if (result.blocked) {
      wrap.innerHTML = '<div class="rxc-auto-head"><span class="rxc-auto-title">RxChoice™</span><span class="rxc-auto-status">Original prescription retained</span></div>' +
        '<div class="rxc-auto-note">' + esc(result.reason || "This medicine is not offered as a price substitution.") + '</div>' + card("DOCTOR PRESCRIBED", result.prescribed);
      row.line.appendChild(wrap); return;
    }
    wrap.innerHTML = '<div class="rxc-auto-head"><span class="rxc-auto-title">RxChoice™ · Same Prescription. Smarter Price.</span><span class="rxc-auto-status">Validated from Drug Database</span></div>' +
      '<div class="rxc-auto-grid">' +
      card("GENERIC", result.generic) + card("BALANCED", result.balanced) +
      card("PREMIUM", result.premium) + card("DOCTOR PRESCRIBED", result.prescribed) + '</div>';
    row.line.appendChild(wrap);

    Array.from(wrap.querySelectorAll("[data-rxc-auto='1']")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cat = btn.getAttribute("data-rxc-cat");
        var opt = cat === "generic" ? result.generic : cat === "balanced" ? result.balanced : cat === "premium" ? result.premium : result.prescribed;
        if (!opt || !opt.brand) return;
        var bi = row.line.querySelector('[data-f="brand"]');
        if (!bi) return;
        bi.value = opt.brand;
        try { bi.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
        try { bi.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
        var sh = sheet();
        if (sh) {
          if (!sh._rxChoice) sh._rxChoice = {};
          sh._rxChoice[row.drug || ("line" + Date.now())] = opt;
        }
        setTimeout(schedule, 0);
      });
    });
  }

  function run() {
    if (!on() || rowsBusy) return;
    var rows = getRows();
    if (!rows.length) return;
    var sig = signature(rows);
    if (sig === lastSig && rows.every(function (r) { return !!r.line.querySelector(":scope > .rxc-auto"); })) return;
    lastSig = sig; rowsBusy = true; var mySeq = ++seq;
    var work = rows.map(function (r) {
      if (!r.brand) { paint(r, null); return Promise.resolve(); }
      return resolveBrand(r.brand).then(function (prescribed) {
        if (mySeq !== seq) return;
        if (!prescribed) { paint(r, null); return; }
        return candidates(prescribed.composition).then(function (cands) {
          if (mySeq !== seq) return;
          paint(r, choose(r, prescribed, cands));
        });
      }).catch(function () { if (mySeq === seq) paint(r, null); });
    });
    Promise.all(work).finally(function () { if (mySeq === seq) rowsBusy = false; });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(run, 180); }
  function boot() {
    injectCSS();
    var observer = new MutationObserver(function () { schedule(); });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", function (e) {
      if (e.target && e.target.closest && e.target.closest('#rxSheet [data-f]')) schedule();
    }, true);
    document.addEventListener("change", function (e) {
      if (e.target && e.target.closest && e.target.closest('#rxSheet [data-f]')) schedule();
    }, true);
    // The adapter can load before MEDAPI/core because the app boot order is intentionally modular.
    // Polling is only a readiness check; once choices are rendered, run() becomes a no-op until the
    // prescription changes.
    setInterval(schedule, 1000);
    schedule();
  }

  G.SMD_RXCHOICE_AUTOPILOT = { refresh: schedule, _version: 2 };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
