/* StewardMD — Renal dose tool (renal-dose.js)  ->  window.SMD_RENAL_DOSE
 *
 * Adds a per-drug "Renal dose" button (antibiotics only) to the drug database. Tapping it opens
 * a small tool that takes a CrCl / eGFR — typed directly, computed from Age + Weight + Serum
 * creatinine + sex (Cockcroft-Gault), or AUTOFETCHED from a Ward Sync (GHIS) patient's latest
 * RFT report — then shows the exact renal-adjusted dose to give.
 *
 * ADDITIVE + defensive: it REUSES the app's existing, clinician-reviewed logic and never
 * re-implements clinical data:
 *   - CrCl (Cockcroft-Gault)      : window.calcCockcroftGault   (app.js)
 *   - impairment band + dose      : window.SMD_SAFETY.renalBand / .renalDoseFor  (reasoning.js)
 *       renalDoseFor prefers the verified RENAL_DOSING table (10 drugs, app.js getRenalAdjustment)
 *       and falls back to the DRAFT SMD_RENAL_DOSING table (~22 drugs, flagged "verify locally").
 *   - antibiotic roster           : window.ASP_DRUGS            (app.js)
 *   - Ward Sync (hospital EMR)     : window.GHIS.getPatients / .fetchLabTests  (ghis-ward.js)
 *   - free-text renal prose        : window.MEDAPI.structured gold monograph   (api.js)
 *
 * Scope: ANTIBIOTICS ONLY. Exact per-band doses where structured data exists; otherwise the
 * computed CrCl/eGFR + impairment band + the monograph's renal-guidance text (no invented doses).
 * Decision support — the clinician verifies against the local formulary/label before prescribing.
 */
(function () {
  "use strict";

  // ── small utils ────────────────────────────────────────────────────────────────────────────
  function norm(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function escH(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  // en/em dash -> hyphen so a label like "Piperacillin–tazobactam" substring-matches the verified
  // RENAL_DOSING keys ("Piperacillin-Tazobactam") that findRenalDosingEntry() compares against.
  function dashFix(s) { return String(s || "").replace(/[‒–—−]/g, "-"); }

  // ── antibiotic reconciliation: drug-DB composition -> {slug,label} used by the renal tables ──
  // Built live from window.ASP_DRUGS (so it stays in sync), plus curated aliases for combo/salt
  // names the drug database spells differently from the ASP roster.
  var COMBO_ALIASES = {
    piperacillintazobactam: "piptazo", piptazo: "piptazo",
    amoxicillinclavulanicacid: "amoxiclav", amoxicillinclavulanate: "amoxiclav", coamoxiclav: "amoxiclav", amoxycillinclavulanicacid: "amoxiclav",
    cefoperazonesulbactam: "cefoperazone", sulbactamcefoperazone: "cefoperazone",
    ceftazidimeavibactam: "cefta_avi",
    trimethoprimsulfamethoxazole: "cotrimoxazole", sulfamethoxazoletrimethoprim: "cotrimoxazole", trimethoprimandsulfamethoxazole: "cotrimoxazole",
    colistimethatesodium: "colistin", colistimethate: "colistin", colistinsulphate: "colistin", polymyxine: "colistin"
  };
  var _abxIdx = null;   // { normalizedKey: {slug,label} }
  function abxIndex() {
    if (_abxIdx) return _abxIdx;
    var idx = {}, A = (window.ASP_DRUGS && typeof window.ASP_DRUGS === "object") ? window.ASP_DRUGS : null;
    if (!A) return idx;   // not loaded yet — try again next call (don't cache an empty index)
    Object.keys(A).forEach(function (slug) {
      var label = (A[slug] && A[slug].label) || slug;
      idx[norm(slug)] = { slug: slug, label: label };
      idx[norm(label)] = { slug: slug, label: label };
    });
    Object.keys(COMBO_ALIASES).forEach(function (alias) {
      var slug = COMBO_ALIASES[alias];
      if (A[slug]) idx[alias] = { slug: slug, label: (A[slug] && A[slug].label) || slug };
    });
    _abxIdx = idx;
    return idx;
  }
  // Return {slug,label} if this drug-DB composition is a known antibiotic, else null.
  function isAntibiotic(composition) {
    var idx = abxIndex(), n = norm(composition);
    if (!n) return null;
    if (idx[n]) return idx[n];
    // light containment fallback (handles "Meropenem Trihydrate" etc.) — require ≥5 chars to avoid noise
    var keys = Object.keys(idx), i, k;
    for (i = 0; i < keys.length; i++) { k = keys[i]; if (k.length >= 5 && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) return idx[k]; }
    return null;
  }

  // ── reused engine calls (all guarded) ───────────────────────────────────────────────────────
  function computeCrCl(age, weightKg, scrMgDl, female) {
    if (typeof window.calcCockcroftGault !== "function") return null;
    var r = window.calcCockcroftGault({ age: age, weight: weightKg, creatinine: scrMgDl, sex: female ? "female" : "male" });
    return (r && r.applicable) ? r.value : null;
  }
  function bandFor(v) {
    try { if (window.SMD_SAFETY && SMD_SAFETY.renalBand) return SMD_SAFETY.renalBand(v); } catch (e) {}
    // local fallback mirrors renalFunctionBand cutoffs
    if (v == null) return null;
    return v >= 90 ? "Normal" : v >= 60 ? "Mild impairment" : v >= 30 ? "Moderate impairment" : v >= 15 ? "Severe impairment" : "Kidney failure / ESRD";
  }
  function doseFor(slug, label, v) {
    try { if (window.SMD_SAFETY && SMD_SAFETY.renalDoseFor) return SMD_SAFETY.renalDoseFor(slug, dashFix(label), v); } catch (e) {}
    // fallback: verified table only
    try { if (typeof window.getRenalAdjustment === "function") { var a = window.getRenalAdjustment(dashFix(label), bandFor(v)); if (a) return a.needed ? { dose: a.adjusted, note: a.note, draft: false } : { noChange: true, draft: false }; } } catch (e) {}
    return null;
  }

  // ── Ward Sync (GHIS) autofetch ───────────────────────────────────────────────────────────────
  function ghis() { try { return window.GHIS && window.GHIS.isConnected && window.GHIS.isConnected() ? window.GHIS : null; } catch (e) { return null; } }

  /* Patient-picker filtering. Field mapping is copied from ghis-ward.js ghisApplyFilters on purpose
   * (branch = deptDescription, doctor = employeeFirstName) so this list and the Ward panel can
   * never disagree about which ward or consultant a patient belongs to. */
  var _rdPats = [];
  function rdDistinct(vals) {
    var seen = {}, out = [];
    (vals || []).forEach(function (v) {
      var s = String(v == null ? "" : v).trim();
      if (!s || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function rdPatientOptions(pats, branch, doctor) {
    var list = (pats || []).filter(function (p) {
      if (branch && String(p.deptDescription || "") !== branch) return false;
      if (doctor && String(p.employeeFirstName || "") !== doctor) return false;
      return true;
    });
    // Say so rather than showing an empty box the doctor cannot explain.
    if (!list.length) return '<option value="">No patient matches these filters</option>';
    return '<option value="">Select a patient…</option>' + list.map(function (p) {
      var lbl = (p.patientFirstName || p.patientId || "Patient") + (p.bedName ? " · " + p.bedName : "");
      return '<option value="' + escH(p.patientId) + '">' + escH(lbl) + '</option>';
    }).join("");
  }
  // Parse a GHIS lab date to a sortable timestamp: ISO first, then "04-JUN-2026" style. 0 if unknown.
  function labTs(s) {
    if (!s) return 0;
    var t = Date.parse(s); if (!isNaN(t)) return t;
    var m = String(s).match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
    if (m) { var mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()]; if (mo) { t = Date.parse(m[3] + "-" + ("0" + mo).slice(-2) + "-" + ("0" + m[1]).slice(-2) + "T00:00:00"); if (!isNaN(t)) return t; } }
    return 0;
  }
  // Pull the LATEST eGFR (preferred, from the RFT report) + creatinine + demographics for a patient.
  // Real GHIS RFT rows are e.g. test "eGFR" (mL/min/1.73m²) and "Creatinine" (mg/dL); "Blood Urea
  // Nitrogen (BUN)"/"Urea" are correctly ignored, and urine creatinine / clearance / ratio excluded.
  // A patient can have serial RFTs, so keep the row with the newest date (first-seen wins on ties).
  function fetchPatientRenal(patientId, patient) {
    var G = ghis();
    if (!G || !G.fetchLabTests) return Promise.resolve(null);
    return G.fetchLabTests(patientId).then(function (rows) {
      rows = rows || [];
      var egfr = null, egfrTs = -1, creat = null, creatTs = -1;
      rows.forEach(function (r) {
        var t = String(r.test || "").toLowerCase(), res = num(r.result), u = String(r.units || "").toLowerCase(), ts = labTs(r.date);
        if (res == null) return;
        if ((/e?gfr/.test(t) || /glomerular filtrat/.test(t)) && ts > egfrTs) { egfr = res; egfrTs = ts; }            // reported eGFR (mL/min/1.73m²)
        else if (/creatinin/.test(t) && !/urin|clearance|ratio/.test(t) && ts > creatTs) { creat = /mol/.test(u) ? res / 88.4 : res; creatTs = ts; }   // µmol/L -> mg/dL
      });
      var age = patient ? num(patient.dob) : null;               // GHIS 'dob' is an age integer
      var g = patient ? String(patient.gender || "").toLowerCase() : "";
      return { egfr: egfr, creat: creat, age: age, female: g.charAt(0) === "f" };
    }).catch(function () { return null; });
  }

  // ── monograph renal prose (fallback for antibiotics without a structured band) ────────────────
  function fetchRenalProse(composition) {
    try {
      if (!window.MEDAPI || !MEDAPI.structured) return Promise.resolve("");
      return MEDAPI.structured(composition).then(function (resp) {
        try { var g = resp && resp.data && resp.data.gold ? JSON.parse(resp.data.gold) : null; return (g && g.renal) ? String(g.renal) : ""; }
        catch (e) { return ""; }
      }).catch(function () { return ""; });
    } catch (e) { return Promise.resolve(""); }
  }

  // ── one-time CSS ──────────────────────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("smd-rd-css")) return;
    var css = [
      ".db-renal-btn{display:inline-flex;align-items:center;gap:7px;margin:12px 0 2px;border:none;background:var(--teal,#0e6e63);color:#fff;font:800 13px/1 var(--sans,system-ui);letter-spacing:.01em;border-radius:11px;padding:10px 15px;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 1px 2px rgba(14,110,99,.28);animation:rdAttn 2.4s ease-in-out infinite}",
      ".db-renal-btn:hover{background:var(--teal-dk,#0b5b52)}",
      ".db-renal-btn:active{transform:translateY(1px)}",
      ".db-renal-btn:focus-visible{outline:2px solid var(--teal,#0e6e63);outline-offset:2px}",
      ".db-renal-ic{flex:0 0 auto;display:block}",
      "@keyframes rdAttn{0%,100%{box-shadow:0 1px 2px rgba(14,110,99,.28),0 0 0 0 rgba(14,110,99,.42)}50%{box-shadow:0 1px 2px rgba(14,110,99,.28),0 0 0 7px rgba(14,110,99,0)}}",
      "@media(prefers-reduced-motion:reduce){.db-renal-btn{animation:none}}",
      "body.dark .db-renal-btn{background:var(--teal,#0e857a);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.4)}",
      "body.dark .db-renal-btn:hover{background:var(--teal-dk,#0aa090)}",
      ".rd-scrim{position:fixed;inset:0;z-index:2147482000;background:rgba(8,12,18,.55);display:flex;align-items:flex-end;justify-content:center;animation:rdFade .18s ease}",
      "@media(min-width:560px){.rd-scrim{align-items:center}}",
      "@keyframes rdFade{from{opacity:0}to{opacity:1}}",
      ".rd-sheet{background:var(--panel,#fff);color:var(--ink,#14202b);width:100%;max-width:520px;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:18px 18px 0 0;padding:18px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.3);animation:rdUp .24s cubic-bezier(.22,1,.36,1)}",
      "@media(min-width:560px){.rd-sheet{border-radius:18px}}",
      "@keyframes rdUp{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}",
      ".rd-h{display:flex;align-items:flex-start;gap:10px;margin-bottom:4px}",
      ".rd-h h3{flex:1;font:800 17px var(--sans,system-ui);margin:0;line-height:1.25}",
      ".rd-x{flex:0 0 auto;border:none;background:transparent;font-size:22px;line-height:1;color:var(--slate-soft,#889);cursor:pointer;padding:0 4px}",
      ".rd-sub{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#889);margin-bottom:12px}",
      ".rd-tabs{display:flex;gap:6px;margin-bottom:12px}",
      ".rd-tab{flex:1;border:1px solid var(--line,#d7dee3);background:transparent;border-radius:10px;padding:9px 6px;font:700 12px var(--sans,system-ui);color:var(--slate,#2d4356);cursor:pointer}",
      ".rd-tab.on{background:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);color:#fff}",
      ".rd-body{display:flex;flex-direction:column;gap:10px}",
      // Two filters side by side above the picker; they wrap on a narrow phone rather than squash.
      ".rd-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}",
      ".rd-filters select{flex:1 1 45%;min-width:0;border:1px solid var(--line,#d7dee3);border-radius:9px;padding:9px 10px;font:600 13px var(--sans,system-ui);background:var(--card,#fff);color:var(--slate,#2d4356)}",
      ".rd-field{display:flex;flex-direction:column;gap:4px}",
      ".rd-field label{font:600 12px var(--sans,system-ui);color:var(--slate,#2d4356)}",
      ".rd-field input,.rd-field select{border:1px solid var(--line,#d7dee3);border-radius:9px;padding:10px 11px;font:600 14px var(--sans,system-ui);background:var(--paper,#fff);color:var(--ink,#14202b);width:100%;box-sizing:border-box}",
      ".rd-row{display:flex;gap:10px}.rd-row .rd-field{flex:1}",
      ".rd-scr{display:flex;gap:8px}.rd-scr input{flex:1}.rd-scr select{flex:0 0 108px}",
      ".rd-check{display:flex;align-items:center;gap:9px;font:600 13.5px var(--sans,system-ui);color:var(--ink,#14202b);cursor:pointer;padding:2px 0}",
      ".rd-check input{width:20px;height:20px;accent-color:var(--teal,#0e6e63)}",
      ".rd-patients{display:flex;flex-direction:column;gap:8px}",
      ".rd-note{font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#889);line-height:1.45}",
      ".rd-result{margin-top:6px;border:1px solid var(--line,#d7dee3);border-radius:13px;padding:13px 14px;background:var(--paper,#f6f7f5)}",
      "body.dark .rd-result{background:var(--paper,#0d1b26)}",
      ".rd-crcl{font:800 15px var(--sans,system-ui);color:var(--ink,#14202b)}",
      ".rd-crcl small{font-weight:600;color:var(--slate-soft,#889)}",
      ".rd-band{display:inline-block;margin-top:3px;font:700 11px var(--sans,system-ui);border-radius:6px;padding:2px 8px}",
      ".rd-band.b-normal{background:#e7f5ec;color:#1c7a4a}.rd-band.b-mild{background:#e7f5ec;color:#1c7a4a}",
      ".rd-band.b-mod{background:#fdf2de;color:#92620a}.rd-band.b-sev{background:#fdebe1;color:#b5460f}.rd-band.b-esrd{background:#fbe7e9;color:#ab1c2c}",
      ".rd-dose{margin-top:11px}",
      ".rd-dose .lbl{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#889)}",
      ".rd-give{font:800 16px var(--sans,system-ui);color:var(--teal,#0e6e63);margin-top:2px;line-height:1.3}",
      "body.dark .rd-give{color:var(--teal,#3fc7b3)}",
      ".rd-std{font:500 12.5px var(--sans,system-ui);color:var(--slate,#2d4356);margin-top:3px}",
      ".rd-dnote{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#889);margin-top:5px;line-height:1.45}",
      ".rd-draft{display:inline-block;margin-left:6px;font:700 9.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;color:#b45309;background:#fef3c7;border-radius:5px;padding:2px 6px}",
      ".rd-prose{font:500 13px var(--sans,system-ui);color:var(--slate,#2d4356);line-height:1.55;margin-top:8px;white-space:pre-wrap}",
      ".rd-src{font:600 11px var(--sans,system-ui);color:var(--slate-soft,#889);margin-top:8px}",
      ".rd-foot{margin-top:14px;font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#889);line-height:1.5;border-top:1px solid var(--line,#d7dee3);padding-top:10px}"
    ].join("");
    var st = document.createElement("style"); st.id = "smd-rd-css"; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ── the modal ──────────────────────────────────────────────────────────────────────────────
  var _el = null, _esc = null;
  function close() {
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
    if (_esc) { document.removeEventListener("keydown", _esc, true); _esc = null; }
    try { document.body.classList.remove("rd-open"); } catch (e) {}
  }

  function bandClass(band) {
    return band === "Normal" ? "b-normal" : band === "Mild impairment" ? "b-mild"
      : band === "Moderate impairment" ? "b-mod" : band === "Severe impairment" ? "b-sev" : "b-esrd";
  }

  function open(composition) {
    var abx = isAntibiotic(composition);
    if (!abx) return;   // antibiotics only
    injectCSS();
    close();

    var connected = !!ghis();
    var tabs = [{ k: "labs", t: "From labs" }, { k: "crcl", t: "Enter CrCl / eGFR" }];
    if (connected) tabs.push({ k: "ward", t: "Ward Sync" });

    _el = document.createElement("div");
    _el.className = "rd-scrim";
    _el.setAttribute("role", "dialog");
    _el.setAttribute("aria-label", "Renal dose — " + abx.label);
    _el.innerHTML =
      '<div class="rd-sheet" role="document">' +
        '<div class="rd-h"><h3>🫘 Renal dose · ' + escH(abx.label) + '</h3><button type="button" class="rd-x" aria-label="Close">×</button></div>' +
        '<div class="rd-sub">Renal-adjusted dosing from CrCl (Cockcroft-Gault) or a reported eGFR.</div>' +
        '<div class="rd-tabs">' + tabs.map(function (x, i) { return '<button type="button" class="rd-tab' + (i === 0 ? " on" : "") + '" data-rd-tab="' + x.k + '">' + escH(x.t) + '</button>'; }).join("") + '</div>' +
        '<div class="rd-body" id="rdInputs"></div>' +
        '<div class="rd-result" id="rdResult" style="display:none"></div>' +
        '<div class="rd-foot">Decision support only — always verify against the local formulary and the product label before prescribing. Cockcroft-Gault estimates absolute CrCl; a reported eGFR is normalised to 1.73 m².</div>' +
      '</div>';
    document.body.appendChild(_el);
    try { document.body.classList.add("rd-open"); } catch (e) {}

    var sheet = _el.querySelector(".rd-sheet");
    var inputs = _el.querySelector("#rdInputs");
    var result = _el.querySelector("#rdResult");
    var mode = "labs";
    var fetched = null;   // last Ward Sync fetch {egfr,creat,age,female}
    var prose = null;     // cached monograph renal text (lazy)

    // close interactions
    _el.querySelector(".rd-x").addEventListener("click", close);
    _el.addEventListener("click", function (e) { if (e.target === _el) close(); });   // scrim tap
    _esc = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", _esc, true);

    function inputsHTML() {
      if (mode === "crcl") {
        return '<div class="rd-field"><label for="rdVal">CrCl or eGFR (mL/min)</label><input id="rdVal" type="number" inputmode="decimal" min="0" step="1" placeholder="e.g. 25"></div>';
      }
      if (mode === "ward") {
        var pats = [];
        try { pats = (window.GHIS && GHIS.getPatients) ? GHIS.getPatients() : []; } catch (e) {}
        /* Branch + doctor filters, because a whole ward list is unusable in a <select>: on a busy
         * unit that is a hundred names in bed order, scrolled one-handed at the bedside.
         *
         * Same two fields, and the same mapping, that the Ward panel already filters by
         * (ghis-ward.js ghisApplyFilters): branch is deptDescription, doctor is employeeFirstName.
         * Reusing that mapping matters - if this invented its own, the two lists would disagree
         * about which ward a patient is on. The filters only narrow what is listed; the selected
         * patient and the lookup below are untouched. */
        _rdPats = pats;
        var branches = rdDistinct(pats.map(function (p) { return p.deptDescription; }));
        var doctors = rdDistinct(pats.map(function (p) { return p.employeeFirstName; }));
        var opts = rdPatientOptions(pats, "", "");
        return '<div class="rd-patients">' +
          (pats.length > 6 ?
            '<div class="rd-filters">' +
              '<select id="rdFBranch" aria-label="Filter by branch"><option value="">All branches</option>' +
                branches.map(function (b) { return '<option value="' + escH(b) + '">' + escH(b) + '</option>'; }).join("") +
              '</select>' +
              '<select id="rdFDoctor" aria-label="Filter by doctor"><option value="">All doctors</option>' +
                doctors.map(function (d) { return '<option value="' + escH(d) + '">' + escH(d) + '</option>'; }).join("") +
              '</select>' +
            '</div>' : '') +
          '<div class="rd-field"><label for="rdPt">Ward Sync patient</label><select id="rdPt">' + opts + '</select></div>' +
          '<div class="rd-note" id="rdWardNote">Pulls the latest eGFR / creatinine from the patient’s report. Weight isn’t on the EMR — enter it below only if no eGFR is reported.</div>' +
          '<div class="rd-field"><label for="rdWt2">Weight (kg) — for CrCl if no eGFR</label><input id="rdWt2" type="number" inputmode="decimal" min="0" step="0.5" placeholder="optional"></div>' +
          '</div>';
      }
      // labs (default)
      return '<div class="rd-row">' +
          '<div class="rd-field"><label for="rdAge">Age (yrs)</label><input id="rdAge" type="number" inputmode="numeric" min="1" max="120" placeholder="e.g. 70"></div>' +
          '<div class="rd-field"><label for="rdWt">Weight (kg)</label><input id="rdWt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="e.g. 60"></div>' +
        '</div>' +
        '<div class="rd-field"><label for="rdScr">Serum creatinine</label><div class="rd-scr"><input id="rdScr" type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 2.0"><select id="rdScrU"><option value="mgdl">mg/dL</option><option value="umol">µmol/L</option></select></div></div>' +
        '<label class="rd-check"><input id="rdFemale" type="checkbox"> Female (×0.85)</label>';
    }

    function renderResult(v, sourceLabel) {
      if (v == null || !(v >= 0)) { result.style.display = "none"; return; }
      var band = bandFor(v), d = doseFor(abx.slug, abx.label, v);
      var html = '<div class="rd-crcl">' + Math.round(v) + ' <small>mL/min</small></div>' +
        '<span class="rd-band ' + bandClass(band) + '">' + escH(band) + '</span>';
      if (sourceLabel) html += '<div class="rd-src">Source: ' + escH(sourceLabel) + '</div>';
      html += '<div class="rd-dose">';
      if (d && d.dose) {
        html += '<div class="lbl">Give at this renal function</div><div class="rd-give">' + escH(d.dose) + (d.draft ? '<span class="rd-draft">draft · verify locally</span>' : '') + '</div>';
        if (d.note) html += '<div class="rd-dnote">' + escH(d.note) + '</div>';
      } else if (d && d.noChange) {
        html += '<div class="lbl">Adjusted dose</div><div class="rd-give">Usual dose — no reduction at this level' + (d.draft ? '<span class="rd-draft">draft · verify locally</span>' : '') + '</div>';
      } else {
        // no structured band for this antibiotic → show the monograph's renal guidance text
        html += '<div class="lbl">Renal guidance (monograph)</div>';
        if (prose == null) {
          html += '<div class="rd-prose" id="rdProse">Loading renal guidance…</div>';
          fetchRenalProse(composition).then(function (txt) { prose = txt || ""; var el = document.getElementById("rdProse"); if (el) el.textContent = prose || "No structured renal adjustment for this drug — see the product label."; });
        } else {
          html += '<div class="rd-prose">' + escH(prose || "No structured renal adjustment for this drug — see the product label.") + '</div>';
        }
      }
      html += '</div>';
      result.innerHTML = html;
      result.style.display = "";
    }

    function recompute() {
      var v = null, src = "";
      if (mode === "crcl") {
        v = num(_el.querySelector("#rdVal") && _el.querySelector("#rdVal").value);
        src = "entered value";
      } else if (mode === "ward") {
        if (fetched) {
          if (fetched.egfr != null) { v = fetched.egfr; src = "eGFR from RFT report"; }
          else if (fetched.creat != null) {
            var wt2 = num(_el.querySelector("#rdWt2") && _el.querySelector("#rdWt2").value);
            v = (wt2 != null && fetched.age != null) ? computeCrCl(fetched.age, wt2, fetched.creat, fetched.female) : null;
            src = (v != null) ? "CrCl from report creatinine" : "";
          }
        }
      } else {
        var age = num(_el.querySelector("#rdAge") && _el.querySelector("#rdAge").value);
        var wt = num(_el.querySelector("#rdWt") && _el.querySelector("#rdWt").value);
        var scr = num(_el.querySelector("#rdScr") && _el.querySelector("#rdScr").value);
        var uSel = _el.querySelector("#rdScrU"); if (uSel && uSel.value === "umol" && scr != null) scr = scr / 88.4;
        var female = !!(_el.querySelector("#rdFemale") && _el.querySelector("#rdFemale").checked);
        v = computeCrCl(age, wt, scr, female);
        src = "Cockcroft-Gault";
      }
      renderResult(v, v != null ? src : "");
    }

    function wireInputs() {
      inputs.innerHTML = inputsHTML();
      // recompute on any input; fetch on patient select
      [].forEach.call(inputs.querySelectorAll("input,select"), function (el) {
        el.addEventListener("input", recompute);
        el.addEventListener("change", recompute);
      });
      /* Re-list on a filter change. Clears any selection, because leaving a patient chosen who is
       * no longer in the visible list is how the wrong patient's eGFR ends up on screen. */
      var fBr = inputs.querySelector("#rdFBranch"), fDr = inputs.querySelector("#rdFDoctor");
      function rdRefilter() {
        var sel = inputs.querySelector("#rdPt");
        if (!sel) return;
        sel.innerHTML = rdPatientOptions(_rdPats, fBr ? fBr.value : "", fDr ? fDr.value : "");
        sel.value = "";
        fetched = null;
        var note = inputs.querySelector("#rdWardNote");
        if (note) note.textContent = "Pulls the latest eGFR / creatinine from the patient’s report.";
        recompute();
      }
      if (fBr) fBr.addEventListener("change", rdRefilter);
      if (fDr) fDr.addEventListener("change", rdRefilter);

      var pt = inputs.querySelector("#rdPt");
      if (pt) pt.addEventListener("change", function () {
        var id = pt.value; fetched = null; recompute();
        if (!id) return;
        var patObj = null; try { patObj = (GHIS.getPatients() || []).filter(function (p) { return String(p.patientId) === String(id); })[0]; } catch (e) {}
        var note = inputs.querySelector("#rdWardNote"); if (note) note.textContent = "Fetching latest report…";
        fetchPatientRenal(id, patObj).then(function (f) {
          fetched = f;
          if (note) {
            if (!f) note.textContent = "Couldn’t fetch this patient’s labs.";
            else if (f.egfr != null) note.textContent = "Using reported eGFR — no weight needed.";
            else if (f.creat != null) note.textContent = "No eGFR in report — enter weight to compute CrCl from creatinine (" + f.creat.toFixed(2) + " mg/dL).";
            else note.textContent = "No eGFR or creatinine found in this patient’s report.";
          }
          recompute();
        });
      });
      result.style.display = "none";
    }

    // tab switching
    [].forEach.call(_el.querySelectorAll(".rd-tab"), function (tab) {
      tab.addEventListener("click", function () {
        [].forEach.call(_el.querySelectorAll(".rd-tab"), function (t) { t.classList.remove("on"); });
        tab.classList.add("on");
        mode = tab.getAttribute("data-rd-tab");
        wireInputs();
      });
    });

    wireInputs();
  }

  // ── button HTML for the drug-DB detail (antibiotics only) ─────────────────────────────────────
  function buttonHTML(composition) {
    if (!isAntibiotic(composition)) return "";
    try { injectCSS(); } catch (e) {}   // ensure the button is styled the instant it renders (not only after a popup opens)
    return '<button type="button" class="db-renal-btn" data-renal-comp="' + escH(composition) + '">'
      + '<svg class="db-renal-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M12 3C8 3 5.5 6 5.5 9.7c0 2 .9 3.2.9 4.8 0 1.9-1.3 3-2.9 3"/>'
      + '<path d="M12 3c4 0 6.5 3 6.5 6.7 0 2-.9 3.2-.9 4.8 0 1.9 1.3 3 2.9 3"/>'
      + '<path d="M12 3v8"/>'
      + '</svg><span>Renal dose</span></button>';
  }

  // delegated click → open the tool (works wherever the button is rendered)
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-renal-comp]") : null;
    if (!b) return;
    e.preventDefault();
    open(b.getAttribute("data-renal-comp"));
  }, false);

  // ── public API ────────────────────────────────────────────────────────────────────────────────
  window.SMD_RENAL_DOSE = { open: open, isAntibiotic: isAntibiotic, buttonHTML: buttonHTML };
})();
