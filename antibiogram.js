/* StewardMD — Antibiogram & Antibiotic-Coverage explorer (standalone full-page module).
   Self-contained overlay; window.ABG.open() / window.ABG.close().
   TWO tabs:
     • Resistance — pick a source (ICMR 2024 national / a local hospital antibiogram) and
       read organism × antibiotic resistance rates as a colour-coded heatmap.
     • Coverage   — an interactive spectrum-of-activity grid (drug class × organism group);
       tap a drug or an organism to see, at a glance, what covers what.

   EDUCATIONAL DECISION SUPPORT ONLY. Coverage is qualitative spectrum of activity.
   Resistance figures are INDICATIVE and MUST be verified against the current ICMR AMRSN
   report and your own local antibiogram before any clinical use. Does not touch clinical
   reasoning, patient storage, secrets or Cloudflare bindings. */
(function () {
  "use strict";

  /* ─────────────────────────  COVERAGE DATA  ─────────────────────────
     Organism columns grouped; coverage is the classic spectrum-of-activity
     (ref: github.com/aetherist/antibiogram, educational). */
  var GROUPS = [
    { id: "gpc", name: "Gram-positive cocci", cols: [
      { id: "mrsa", label: "MRSA" }, { id: "mssa", label: "MSSA" }, { id: "strep", label: "Streptococci" } ] },
    { id: "gnb", name: "Gram-negative bacilli", cols: [
      { id: "ecoli", label: "E. coli" }, { id: "pmir", label: "P. mirabilis" }, { id: "kleb", label: "Klebsiella" },
      { id: "pseud", label: "Pseudomonas" }, { id: "escappm", label: "ESCAPPM" } ] },
    { id: "gnc", name: "Gram-negative cocci", cols: [
      { id: "ngon", label: "N. gonorrhoeae" }, { id: "nmen", label: "N. meningitidis" } ] },
    { id: "ana", name: "Anaerobes", cols: [ { id: "anaer", label: "Anaerobes" } ] },
    { id: "aty", name: "Atypicals", cols: [ { id: "atyp", label: "e.g. Mycoplasma" } ] }
  ];
  var COLS = [];
  GROUPS.forEach(function (g) { g.cols.forEach(function (c) { c.group = g.id; COLS.push(c); }); });

  // Drug rows: class + agent + array of covered organism-column ids.
  var COVERAGE = [
    { cls: "Penicillin", agent: "Penicillin G", cov: ["strep"] },
    { cls: "Anti-staphylococcal penicillins", agent: "Nafcillin / Oxacillin", cov: ["mssa", "strep"] },
    { cls: "Aminopenicillins", agent: "Ampicillin / Amoxicillin", cov: ["strep", "ecoli", "pmir", "nmen"] },
    { cls: "1st-gen cephalosporin", agent: "Cefazolin, cephalexin", cov: ["mssa", "strep", "ecoli", "pmir", "kleb"] },
    { cls: "2nd-gen cephalosporin", agent: "Cefotetan, cefoxitin", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "anaer"] },
    { cls: "3rd-gen cephalosporin", agent: "Ceftriaxone", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "ngon", "nmen"] },
    { cls: "3rd-gen cephalosporin", agent: "Ceftazidime", cov: ["ecoli", "pmir", "kleb", "pseud", "escappm"] },
    { cls: "4th-gen cephalosporin", agent: "Cefepime", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "pseud", "escappm"] },
    { cls: "Aminopenicillin + β-lactamase inhibitor", agent: "Amoxicillin + clavulanate (Augmentin)", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "anaer"] },
    { cls: "Aminopenicillin + β-lactamase inhibitor", agent: "Ampicillin + sulbactam (Unasyn)", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "anaer"] },
    { cls: "Antipseudomonal penicillin + BLI", agent: "Piperacillin + tazobactam (Zosyn)", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "pseud", "escappm", "anaer"] },
    { cls: "Carbapenems", agent: "Ertapenem", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "escappm", "anaer"] },
    { cls: "Carbapenems", agent: "Imipenem, meropenem", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "pseud", "escappm", "anaer"] },
    { cls: "Monobactams", agent: "Aztreonam", cov: ["ecoli", "pmir", "kleb", "pseud", "escappm"] },
    { cls: "Quinolones", agent: "Ciprofloxacin", cov: ["ecoli", "pmir", "kleb", "pseud", "escappm", "ngon", "nmen", "atyp"] },
    { cls: "Quinolones", agent: "Levofloxacin", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "pseud", "escappm", "ngon", "nmen", "atyp"] },
    { cls: "Quinolones", agent: "Moxifloxacin", cov: ["mssa", "strep", "ecoli", "pmir", "kleb", "escappm", "ngon", "nmen", "anaer", "atyp"] },
    { cls: "Aminoglycosides", agent: "Gentamicin / Tobramycin / Amikacin", cov: ["ecoli", "pmir", "kleb", "pseud", "escappm"] },
    { cls: "Lincosamide", agent: "Clindamycin", cov: ["mrsa", "mssa", "strep", "anaer"] },
    { cls: "Macrolides", agent: "Azithromycin", cov: ["mssa", "strep", "ngon", "nmen", "atyp"] },
    { cls: "Tetracyclines", agent: "Doxycycline", cov: ["mrsa", "mssa", "strep", "ecoli", "ngon", "nmen", "atyp"] },
    { cls: "Glycopeptides", agent: "Vancomycin", cov: ["mrsa", "mssa", "strep"] },
    { cls: "Antimetabolite", agent: "TMP/SMX (Bactrim)", cov: ["mrsa", "mssa", "strep", "ecoli", "pmir", "kleb", "escappm", "atyp"] },
    { cls: "Nitroimidazoles", agent: "Metronidazole", cov: ["anaer"] }
  ];

  /* ─────────────────────────  RESISTANCE DATA  ─────────────────────────
     Uses the app's existing, sourced antibiogram (window.ASP_ABG) — the same
     ICMR AMRSN 2024 national + GIMSR hospital dataset shown in the references
     panel. Values are % SUSCEPTIBLE (higher = better); some cells are qualitative
     only. No numbers are invented here — this view just reads that data. */
  function abgData() { return (typeof window !== "undefined" && window.ASP_ABG) ? window.ASP_ABG : null; }

  // Pretty labels for the terse drug keys used in ASP_ABG.
  var DRUG_LABEL = {
    piptazo: "Piperacillin-tazobactam", cefotaxime: "Cefotaxime", ceftazidime: "Ceftazidime",
    ceftriaxone: "Ceftriaxone", cefepime: "Cefepime", cefuroxime: "Cefuroxime", cefoperazone: "Cefoperazone",
    cefixime: "Cefixime", cefazolin: "Cefazolin", ciprofloxacin: "Ciprofloxacin", levofloxacin: "Levofloxacin",
    norfloxacin: "Norfloxacin", imipenem: "Imipenem", meropenem: "Meropenem", ertapenem: "Ertapenem",
    doripenem: "Doripenem", amikacin: "Amikacin", gentamicin: "Gentamicin", colistin: "Colistin",
    nitrofurantoin: "Nitrofurantoin", fosfomycin: "Fosfomycin", minocycline: "Minocycline",
    cotrimoxazole: "Co-trimoxazole", doxycycline: "Doxycycline", cloxacillin: "Cloxacillin",
    clindamycin: "Clindamycin", vancomycin: "Vancomycin", teicoplanin: "Teicoplanin", linezolid: "Linezolid",
    daptomycin: "Daptomycin", amoxicillin: "Amoxicillin", amoxiclav: "Amoxicillin-clavulanate",
    ampicillin: "Ampicillin", azithromycin: "Azithromycin"
  };
  function drugLabel(k) { return DRUG_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }

  /* ───────────────────────────  STATE / DOM  ─────────────────────────── */
  var root = null, tab = "coverage", covSel = null, covSelType = null, srcKey = "national", tEl, tTimer;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function open() {
    if (root) { root.classList.add("on"); document.body.style.overflow = "hidden"; return; }
    injectCSS();
    root = document.createElement("div"); root.className = "abg"; root.id = "abgOverlay";
    root.innerHTML = shell();
    document.body.appendChild(root);
    render();
    bind();
    requestAnimationFrame(function () { root.classList.add("on"); });
    document.body.style.overflow = "hidden";
  }
  function close() { if (root) { root.classList.remove("on"); document.body.style.overflow = ""; } }

  function shell() {
    return '' +
      '<div class="abg-top">' +
        '<button class="abg-back" data-act="close" aria-label="Back">‹ Back</button>' +
        '<div class="abg-ttl">Antibiogram</div>' +
      '</div>' +
      '<div class="abg-tabs" role="tablist">' +
        '<button class="abg-tab" data-tab="coverage" role="tab">Antibiotic coverage</button>' +
        '<button class="abg-tab" data-tab="resistance" role="tab">Resistance rates</button>' +
      '</div>' +
      '<div class="abg-body" id="abgBody"></div>';
  }

  /* ───────────────────────────  RENDER  ─────────────────────────── */
  function render() {
    [].forEach.call(root.querySelectorAll(".abg-tab"), function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    var body = root.querySelector("#abgBody");
    body.innerHTML = tab === "coverage" ? coverageView() : resistanceView();
    body.scrollTop = 0;
  }

  /* Coverage grid + interactive summary */
  function coverageView() {
    var h = '<div class="abg-note">Spectrum of activity — a teaching guide, <b>not</b> a substitute for susceptibility testing or your local antibiogram. Tap a drug or an organism to isolate it.</div>';

    // interactive summary bar
    h += '<div class="abg-sum" id="abgSum">' + coverageSummary() + '</div>';

    // scrollable grid
    h += '<div class="abg-scroll"><table class="abg-grid"><thead>';
    // group header row
    h += '<tr class="abg-grp"><th class="abg-rowh abg-corner" rowspan="2">Antibiotic</th>';
    GROUPS.forEach(function (g) { h += '<th class="abg-gh g-' + g.id + '" colspan="' + g.cols.length + '">' + esc(g.name) + '</th>'; });
    h += '</tr><tr class="abg-orgh">';
    COLS.forEach(function (c) {
      var on = (covSelType === "org" && covSel === c.id) ? " sel" : "";
      h += '<th class="abg-ch g-' + c.group + on + '" data-org="' + c.id + '"><span>' + esc(c.label) + '</span></th>';
    });
    h += '</tr></thead><tbody>';
    var lastCls = null;
    COVERAGE.forEach(function (d, i) {
      var rowOn = (covSelType === "drug" && covSel === i) ? " sel" : "";
      var dim = covSel !== null && !rowOn && covSelType === "drug" ? " dim" : "";
      var newCls = d.cls !== lastCls; lastCls = d.cls;
      h += '<tr class="abg-drow' + rowOn + dim + '" data-drug="' + i + '">';
      h += '<td class="abg-rowh">' + (newCls ? '<span class="abg-cls">' + esc(d.cls) + '</span>' : '') + '<span class="abg-agent">' + esc(d.agent) + '</span></td>';
      COLS.forEach(function (c) {
        var covered = d.cov.indexOf(c.id) !== -1;
        var hl = "";
        if (covSelType === "org" && covSel === c.id) hl = " col";
        if ((covSelType === "org" && covSel === c.id) || (covSelType === "drug" && covSel === i)) hl += " hit";
        h += '<td class="abg-cell ' + (covered ? "on" : "off") + hl + '"><i>' + (covered ? "✓" : "✕") + '</i></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="abg-legend"><span><i class="sw on"></i>Covered</span><span><i class="sw off"></i>Not covered / unreliable</span><span class="abg-src">Ref: aetherist/antibiogram · educational</span></div>';
    return h;
  }

  function coverageSummary() {
    if (covSel === null) return '<span class="abg-hint">Nothing selected — showing the full spectrum grid.</span>';
    if (covSelType === "drug") {
      var d = COVERAGE[covSel];
      var names = d.cov.map(function (id) { return colLabel(id); });
      return '<button class="abg-clear" data-act="clearcov">✕</button><b>' + esc(d.agent) + '</b> covers: ' +
        (names.length ? '<span class="abg-tags">' + names.map(function (n) { return '<em>' + esc(n) + '</em>'; }).join("") + '</span>' : '—');
    }
    // org selected
    var covered = COVERAGE.filter(function (d) { return d.cov.indexOf(covSel) !== -1; }).map(function (d) { return d.agent; });
    return '<button class="abg-clear" data-act="clearcov">✕</button><b>' + esc(colLabel(covSel)) + '</b> is covered by: ' +
      (covered.length ? '<span class="abg-tags">' + covered.map(function (n) { return '<em>' + esc(n) + '</em>'; }).join("") + '</span>' : '—');
  }
  function colLabel(id) { for (var i = 0; i < COLS.length; i++) if (COLS[i].id === id) return COLS[i].label; return id; }

  /* Resistance — % susceptible from window.ASP_ABG (organism cards) */
  function resistanceView() {
    var data = abgData();
    if (!data || (!data.national && !data.hospital))
      return '<div class="abg-empty"><div class="abg-empty-ic">📊</div><b>Antibiogram unavailable</b><p>The susceptibility dataset has not loaded yet. Reopen this screen in a moment.</p></div>';

    if (!data[srcKey]) srcKey = data.national ? "national" : "hospital";
    var src = data[srcKey];

    var h = '<div class="abg-srcbar"><label class="abg-srclab">Source</label>' +
      '<select class="abg-srcsel" id="abgSrc">';
    if (data.national) h += '<option value="national"' + (srcKey === "national" ? " selected" : "") + '>ICMR AMRSN 2024 · National</option>';
    if (data.hospital) h += '<option value="hospital"' + (srcKey === "hospital" ? " selected" : "") + '>Hospital antibiogram</option>';
    h += '</select></div>';

    h += '<div class="abg-warn"><b>' + (src.dated ? "Dated source." : "Reference data.") + '</b> ' + esc(src.source || "") +
      (src.note ? ' — ' + esc(src.note) : '') + '</div>';

    var orgs = src.org || {};
    Object.keys(orgs).forEach(function (name) {
      var o = orgs[name], drugs = o.d || {};
      var meta = [];
      if (o.n != null) meta.push(o.n + " isolates");
      if (o.specimen) meta.push(esc(o.specimen));
      h += '<div class="abg-oc"><div class="abg-oc-h"><span class="abg-oc-n">' + esc(name) + '</span>' +
        (meta.length ? '<span class="abg-oc-m">' + meta.join(" · ") + '</span>' : '') + '</div><div class="abg-oc-rows">';
      Object.keys(drugs).forEach(function (k) {
        var v = drugs[k], s = v.s;
        h += '<div class="abg-dr"><span class="abg-dr-n">' + esc(drugLabel(k)) + '</span>';
        if (s == null) {
          h += '<span class="abg-dr-q">' + esc(v.q || "—") + '</span>';
        } else {
          var pct = (v.approx ? "~" : "") + s + "%";
          h += '<span class="abg-dr-v"><span class="abg-pill ' + suscClass(s) + '">' + pct + ' S' + '</span>' + trendArrow(v.trend) + '</span>';
        }
        h += '</div>';
        if (s != null && v.q) h += '<div class="abg-dr-note">' + esc(v.q) + '</div>';
      });
      h += '</div></div>';
    });

    h += '<div class="abg-legend heat"><span><i class="hs su4"></i>≥90%</span><span><i class="hs su3"></i>75–89%</span><span><i class="hs su2"></i>50–74%</span><span><i class="hs su1"></i>30–49%</span><span><i class="hs su0"></i>&lt;30%</span><span>% susceptible</span></div>';
    return h;
  }
  function suscClass(s) { return s >= 90 ? "su4" : s >= 75 ? "su3" : s >= 50 ? "su2" : s >= 30 ? "su1" : "su0"; }
  function trendArrow(t) {
    if (!t || t.length < 2) return "";
    var d = t[t.length - 1][1] - t[t.length - 2][1];
    if (Math.abs(d) < 0.1) return "";
    var up = d > 0; // susceptibility rising = improving
    return '<span class="abg-trend ' + (up ? "up" : "down") + '" title="' + (up ? "improving" : "worsening") + '">' + (up ? "▲" : "▼") + Math.abs(Math.round(d)) + '</span>';
  }

  /* ───────────────────────────  EVENTS  ─────────────────────────── */
  function bind() {
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-tab],[data-drug],[data-org]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "close") return close();
      if (act === "clearcov") { covSel = null; covSelType = null; return render(); }
      var t = b.getAttribute("data-tab");
      if (t) { tab = t; return render(); }
      if (tab === "coverage") {
        if (b.classList.contains("abg-ch") && b.hasAttribute("data-org")) {
          var oid = b.getAttribute("data-org");
          if (covSelType === "org" && covSel === oid) { covSel = null; covSelType = null; }
          else { covSel = oid; covSelType = "org"; }
          return render();
        }
        var dr = b.closest("[data-drug]");
        if (dr && dr.classList.contains("abg-drow")) {
          var di = +dr.getAttribute("data-drug");
          if (covSelType === "drug" && covSel === di) { covSel = null; covSelType = null; }
          else { covSel = di; covSelType = "drug"; }
          return render();
        }
      }
    });
    root.addEventListener("change", function (e) {
      if (e.target && e.target.id === "abgSrc") { srcKey = e.target.value; render(); }
    });
  }

  function toast(m) {
    if (!tEl) { tEl = document.createElement("div"); tEl.className = "abg-toast"; document.body.appendChild(tEl); }
    tEl.textContent = m; tEl.classList.add("on"); clearTimeout(tTimer);
    tTimer = setTimeout(function () { tEl.classList.remove("on"); }, 2400);
  }

  /* ───────────────────────────  STYLES  ─────────────────────────── */
  function injectCSS() {
    if (document.getElementById("abg-css")) return;
    var s = document.createElement("style"); s.id = "abg-css";
    s.textContent = [
      ".abg{--bg:#F4F6F9;--panel:#fff;--ink:#0F172A;--mut:#64748B;--line:#E2E8F0;--tl:var(--teal,#0F766E);--tls:var(--teal-soft,#CCFBF1);--f:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:950;background:var(--bg);color:var(--ink);font-family:var(--f);display:flex;flex-direction:column;opacity:0;transform:translateY(8px);transition:opacity .22s,transform .22s;pointer-events:none}",
      ".abg.on{opacity:1;transform:none;pointer-events:auto}",
      "body.dark .abg{--bg:#0A0F1A;--panel:#101827;--ink:#E6EAF2;--mut:#8A94A6;--line:#1E2B43;--tls:#0d3b36}",
      ".abg-top{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}",
      ".abg-back{border:none;background:none;color:var(--tl);font:700 15px var(--f);cursor:pointer;padding:6px 6px;border-radius:8px}",
      ".abg-ttl{font:800 18px var(--f);letter-spacing:-.01em}",
      ".abg-tabs{display:flex;gap:4px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:53px;z-index:2}",
      ".abg-tab{flex:1;border:1px solid var(--line);background:var(--bg);color:var(--mut);font:700 13px var(--f);padding:10px 8px;border-radius:11px;cursor:pointer;transition:.15s}",
      ".abg-tab.on{background:var(--tl);color:#fff;border-color:var(--tl)}",
      ".abg-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px calc(28px + env(safe-area-inset-bottom))}",
      ".abg-note{font:500 12.5px/1.5 var(--f);color:var(--mut);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:12px}",
      ".abg-note b{color:var(--ink)}",
      ".abg-sum{font:500 13px/1.6 var(--f);color:var(--ink);background:var(--tls);border:1px solid var(--tl);border-radius:12px;padding:10px 12px;margin-bottom:12px;min-height:20px;position:relative}",
      ".abg-sum .abg-hint{color:var(--mut);font-weight:500}",
      ".abg-sum b{font-weight:800}",
      ".abg-tags{display:inline-flex;flex-wrap:wrap;gap:5px;margin-left:2px;vertical-align:middle}",
      ".abg-tags em{font-style:normal;font:700 11px var(--f);background:var(--panel);border:1px solid var(--tl);color:var(--tl);padding:2px 8px;border-radius:999px}",
      ".abg-clear{position:absolute;top:8px;right:8px;border:none;background:var(--tl);color:#fff;width:22px;height:22px;border-radius:999px;font:700 12px var(--f);cursor:pointer;line-height:1}",
      ".abg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;background:var(--panel)}",
      ".abg-grid{border-collapse:separate;border-spacing:0;font:600 11px var(--f);width:max-content;min-width:100%}",
      ".abg-grid th,.abg-grid td{border-bottom:1px solid var(--line);border-right:1px solid var(--line)}",
      ".abg-rowh{position:sticky;left:0;z-index:1;background:var(--panel);text-align:left;padding:7px 10px;min-width:172px;max-width:172px;vertical-align:middle}",
      ".abg-corner{z-index:3}",
      ".abg-cls{display:block;font:800 9.5px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--tl);margin-bottom:1px}",
      ".abg-agent{display:block;font:600 12px/1.25 var(--f);color:var(--ink)}",
      ".abg-agent.org{font-weight:700;font-style:italic}",
      ".abg-gh{padding:6px 8px;text-align:center;font:800 10px var(--f);text-transform:uppercase;letter-spacing:.04em;color:#fff}",
      ".g-gpc{background:#2563EB}.g-gnb{background:#B91C1C}.g-gnc{background:#7E22CE}.g-ana{background:#92702a}.g-aty{background:#475569}",
      ".abg-orgh th{top:0}",
      ".abg-ch{padding:6px 5px;min-width:56px;max-width:70px;vertical-align:bottom;text-align:center;background:var(--panel)}",
      ".abg-ch span{display:block;font:700 9.5px/1.15 var(--f);color:var(--ink);word-break:break-word}",
      ".abg-ch.g-gpc,.abg-ch.g-gnb,.abg-ch.g-gnc,.abg-ch.g-ana,.abg-ch.g-aty{background:var(--panel)}",
      ".abg-ch.sel{outline:2px solid var(--tl);outline-offset:-2px}",
      ".abg-ch[data-org]{cursor:pointer}",
      ".abg-drow{cursor:pointer}",
      ".abg-drow.sel .abg-rowh{background:var(--tls)}",
      ".abg-drow.dim{opacity:.4}",
      ".abg-cell{width:56px;min-width:56px;height:32px;text-align:center;background:var(--panel)}",
      ".abg-cell i{font-style:normal;font:800 12px var(--f);color:#fff;opacity:.92}",
      ".abg-cell.on{background:#059669}",
      ".abg-cell.off{background:#E15B64}",
      "body.dark .abg-cell.on{background:#0e7a5f}body.dark .abg-cell.off{background:#a83b43}",
      ".abg-cell.hit{outline:2px solid var(--ink);outline-offset:-2px}",
      ".abg-cell.hit i{opacity:1}",
      ".abg-legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:10px;font:600 11px var(--f);color:var(--mut)}",
      ".abg-legend .sw{display:inline-block;width:13px;height:13px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:5px;background:var(--panel)}",
      ".abg-legend .sw.on{background:#059669;border-color:#059669}",
      ".abg-legend .sw.off{background:#E15B64;border-color:#E15B64}",
      ".abg-src{margin-left:auto;font-weight:500;font-size:10px}",
      ".abg-srcbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}",
      ".abg-srclab{font:800 11px var(--f);text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}",
      ".abg-srcsel{flex:1;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:700 13px var(--f);padding:11px 12px;border-radius:11px;-webkit-appearance:none;appearance:none;cursor:pointer}",
      ".abg-warn{font:500 12px/1.5 var(--f);color:var(--ink);background:#FEF3C7;border:1px solid #F59E0B;border-radius:12px;padding:10px 12px;margin-bottom:12px}",
      "body.dark .abg-warn{background:#3a2e0a;border-color:#a3791d;color:#f5e6bd}",
      ".abg-warn b{color:#B45309}body.dark .abg-warn b{color:#fbbf24}",
      ".abg-oc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:12px}",
      ".abg-oc-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-bottom:8px;margin-bottom:6px;border-bottom:1px solid var(--line)}",
      ".abg-oc-n{font:800 15px var(--f);font-style:italic;color:var(--ink)}",
      ".abg-oc-m{font:600 10.5px var(--f);color:var(--mut);white-space:nowrap}",
      ".abg-dr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}",
      ".abg-dr-n{font:600 13px var(--f);color:var(--ink)}",
      ".abg-dr-v{display:inline-flex;align-items:center;gap:7px;flex-shrink:0}",
      ".abg-dr-q{font:600 11.5px var(--f);color:var(--mut);text-align:right;max-width:58%}",
      ".abg-pill{font:800 12px var(--f);color:#fff;padding:3px 9px;border-radius:999px;min-width:52px;text-align:center}",
      ".su4{background:#047857}.su3{background:#65a30d}.su2{background:#D97706}.su1{background:#EA580C}.su0{background:#B91C1C}",
      ".abg-trend{font:800 10px var(--f);padding:1px 4px;border-radius:5px}",
      ".abg-trend.up{color:#047857;background:rgba(4,120,87,.12)}",
      ".abg-trend.down{color:#B91C1C;background:rgba(185,28,28,.12)}",
      ".abg-dr-note{font:500 11px/1.4 var(--f);color:var(--mut);padding:0 0 4px 2px}",
      ".abg-legend.heat .hs{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px}",
      ".abg-empty{text-align:center;padding:40px 20px;color:var(--mut)}",
      ".abg-empty-ic{font-size:38px;margin-bottom:8px}",
      ".abg-empty b{display:block;font:800 16px var(--f);color:var(--ink);margin-bottom:6px}",
      ".abg-empty p{font:500 13px/1.6 var(--f);max-width:320px;margin:0 auto}",
      ".abg-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(10px);background:#0F172A;color:#fff;font:600 13px var(--f);padding:11px 18px;border-radius:12px;z-index:970;opacity:0;transition:.2s;pointer-events:none;max-width:88vw;text-align:center}",
      ".abg-toast.on{opacity:1;transform:translateX(-50%)}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.ABG = { open: open, close: close, _data: { COVERAGE: COVERAGE, COLS: COLS } };
})();
