/* StewardMD — Prescription generator (client controller + editable Rx + print).
 *
 * window.SMD_RX = { open(ctx), canPrescribe() }
 *  - Doses/brands come DB-FIRST from the Drug Index (window.MEDDRUGS._list) via the
 *    pure rx-build.mjs core; gaps are flagged "⚠ confirm", never silently invented.
 *  - Gated by the Doctor Verification system (verify.js / window.SMD_VERIFY): ONLY doctors
 *    verified against the National Medical Register may prescribe, and the Rx carries their
 *    VERIFIED registration number. Unverified → routed to the verification panel. (Manual
 *    NMC entry remains only as a fallback when the gate isn't present, e.g. local dev.)
 *  - Output: an editable on-screen Rx + print/PDF (window.print) with a signature block.
 *  - A DRAFT the prescriber reviews, edits and signs — the doctor is responsible.
 * Patient name/age are optional and NEVER persisted (typed onto the printout only).
 */
(function () {
  "use strict";
  if (window.SMD_RX) return;

  function uid() { try { return (window.SMD_ACCOUNT && SMD_ACCOUNT.uid && SMD_ACCOUNT.uid()) || "guest"; } catch (e) { return "guest"; } }
  function docName() {
    try { var p = window.SMD_ACCOUNT && SMD_ACCOUNT.profile && SMD_ACCOUNT.profile(); if (p && (p.name || p.displayName)) return p.name || p.displayName; } catch (e) {}
    try { var a = JSON.parse(localStorage.getItem("stewardmd_account") || "null"); if (a && (a.name || a.displayName)) return a.name || a.displayName; } catch (e) {}
    return "";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ── Doctor Verification gate (verify.js → window.SMD_VERIFY) is the source of truth ──
  // Only doctors VERIFIED against the National Medical Register may prescribe, and the Rx
  // carries their VERIFIED registration number (minted into the Firebase claim {verified,
  // regNo}), never a self-typed one. If the gate isn't present on this build (e.g. local
  // dev before verify.js ships), we fall back to a manual NMC entry so the pad still works.
  function fbUser() { try { return (window.firebase && firebase.auth && firebase.auth().currentUser) || null; } catch (e) { return null; } }
  var _vcache = null;   // last known { verified, regNo }
  function verifiedInfo() {
    if (!window.SMD_VERIFY || !window.SMD_VERIFY.isVerified) return Promise.resolve(null);   // gate absent → caller falls back
    return window.SMD_VERIFY.isVerified().then(function (v) {
      if (!v) return (_vcache = { verified: false, regNo: "" });
      var u = fbUser();
      if (!(u && u.getIdTokenResult)) return (_vcache = { verified: true, regNo: "" });
      return u.getIdTokenResult().then(function (r) {
        var rn = (r && r.claims && r.claims.regNo) || "";
        if (rn) return (_vcache = { verified: true, regNo: rn });
        // team-allowlist or claim without regNo → ask the gate's status endpoint
        return u.getIdToken().then(function (tok) {
          return fetch("/api/verify-doctor", { headers: { "Authorization": "Bearer " + tok } }).then(function (x) { return x.json(); })
            .then(function (d) { return (_vcache = { verified: true, regNo: (d && d.regNo) || "" }); });
        }).catch(function () { return (_vcache = { verified: true, regNo: "" }); });
      }).catch(function () { return (_vcache = { verified: true, regNo: "" }); });
    }).catch(function () { return { verified: false, regNo: "" }; });
  }
  // Manual-entry fallback (only used when the verification gate is not on this build).
  function nmcKey() { return "stewardmd_nmc_reg_" + uid(); }
  function getNmc() { try { return (localStorage.getItem(nmcKey()) || "").trim(); } catch (e) { return ""; } }
  function setNmc(v) { try { localStorage.setItem(nmcKey(), String(v || "").trim()); } catch (e) {} }
  function canPrescribe() { return window.SMD_VERIFY ? !!(_vcache && _vcache.verified) : !!getNmc(); }

  function injectCSS() {
    if (document.getElementById("rxCss")) return;
    var s = document.createElement("style"); s.id = "rxCss";
    s.textContent =
      ".rx-scrim{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:16000;opacity:0;transition:.2s;pointer-events:none}.rx-scrim.on{opacity:1;pointer-events:auto}" +
      ".rx-sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-48%);width:min(680px,94vw);max-height:92vh;overflow:auto;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:16px;z-index:16001;opacity:0;transition:.2s;pointer-events:none;box-shadow:0 20px 60px rgba(0,0,0,.3)}.rx-sheet.on{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}" +
      ".rx-wrap{padding:18px 18px 22px;font:400 14px var(--hfont,system-ui)}" +
      ".rx-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}.rx-title{font:800 18px var(--hfont,system-ui)}.rx-x{border:0;background:transparent;font-size:20px;cursor:pointer;color:var(--hmut,#64748b)}" +
      ".rx-clinic{font:700 15px var(--hfont);color:var(--hink)}.rx-disc{font:500 11px var(--hfont);color:var(--hmut,#64748b);background:rgba(245,158,11,.1);border-radius:8px;padding:6px 9px;margin:8px 0}" +
      ".rx-pt{display:flex;gap:8px;margin:8px 0}.rx-pt input{flex:1;min-width:0}" +
      ".rx-in{border:1px solid var(--hbd,#e2e8f0);border-radius:8px;padding:7px 9px;font:400 13px var(--hfont);background:var(--hpanel,#fff);color:var(--hink)}" +
      ".rx-symbol{font:800 22px var(--hfont);margin:6px 0 2px}" +
      ".rx-line{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:9px;margin:8px 0}.rx-line.unv{border-color:#f59e0b;background:rgba(245,158,11,.06)}.rx-line.adv{background:rgba(100,116,139,.06)}" +
      ".rx-line .r1{display:flex;gap:6px;flex-wrap:wrap}.rx-line .r1 input{}.rx-drug{flex:2 1 160px}.rx-brand{flex:1 1 110px}.rx-line .r2{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.rx-dose{flex:2 1 160px}.rx-freq{flex:1 1 90px}.rx-dur{flex:1 1 90px}" +
      ".rx-flag{font:700 10.5px var(--hfont);color:#b45309;margin-top:5px}.rx-del{border:0;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;align-self:center}" +
      ".rx-ac{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;margin-top:6px;background:var(--hpanel,#fff);max-height:240px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      ".rx-ac-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--hbd,#eef1f4);background:none;padding:8px 10px;cursor:pointer;font:500 13px var(--hfont);color:var(--hink,#14202b)}.rx-ac-item:last-child{border-bottom:0}.rx-ac-item:hover,.rx-ac-item.on{background:var(--paper,#f6f7f5)}" +
      ".rx-ac-g{font-weight:800}.rx-ac-b{color:var(--teal,#0e6e63);font-weight:600}.rx-ac-d{display:block;color:var(--hmut,#64748b);font-size:11.5px;margin-top:2px}.rx-ac-empty{padding:8px 10px;color:var(--hmut,#64748b);font:500 12px var(--hfont)}" +
      ".rx-btn{border:0;border-radius:999px;padding:9px 16px;font:800 13px var(--hfont);cursor:pointer}.rx-add{background:rgba(100,116,139,.12);color:var(--hink)}.rx-print{background:#2563eb;color:#fff}.rx-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}" +
      ".rx-sign{margin-top:14px;border-top:1px dashed var(--hbd,#e2e8f0);padding-top:10px;font:600 13px var(--hfont);color:var(--hink)}.rx-sign small{color:var(--hmut,#64748b);font-weight:500}" +
      ".rx-gate{font:500 13px var(--hfont);color:var(--hink)}.rx-gate input{margin-top:10px;width:100%}" +
      "@media print{body>*{display:none!important}body>.rx-scrim,body>.rx-sheet{display:block!important;position:static!important;transform:none!important;box-shadow:none!important;opacity:1!important;max-height:none!important;width:auto!important}.rx-scrim{background:none!important}.rx-x,.rx-del,.rx-add,.rx-print,.rx-row{display:none!important}.rx-in{border:none!important;padding:0!important;background:none!important}.rx-line{border:1px solid #ccc!important;background:none!important}}";
    document.head.appendChild(s);
  }

  var scrim, sheet;
  function ensureEls() {
    injectCSS();
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "rx-scrim"; scrim.id = "rxScrim"; document.body.appendChild(scrim); scrim.addEventListener("click", close); }
    if (!sheet) { sheet = document.createElement("div"); sheet.className = "rx-sheet"; sheet.id = "rxSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Prescription"); document.body.appendChild(sheet); }
  }
  function show(html) { ensureEls(); sheet.innerHTML = '<div class="rx-wrap">' + html + '</div>'; scrim.classList.add("on"); sheet.classList.add("on"); }
  function close() { if (sheet) sheet.classList.remove("on"); if (scrim) scrim.classList.remove("on"); }

  // ---- WebView-safe Print / PDF ----------------------------------------------------------------
  // window.print() is a no-op in the native WKWebView, so we build a self-contained branded Rx
  // document and: print it via a hidden iframe on web, or write it to a file + Share it on native
  // (the OS share sheet offers Print / AirPrint / Save as PDF).
  function rxNative() { try { var C = window.Capacitor; return !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.isNative)); } catch (e) { return false; } }
  function rxPlugins() { try { return (window.Capacitor && window.Capacitor.Plugins) || {}; } catch (e) { return {}; } }
  function collectRx() {
    var name = (sheet.querySelector("#rxPtName") || {}).value || "";
    var age = (sheet.querySelector("#rxPtAge") || {}).value || "";
    var lines = [];
    sheet.querySelectorAll("#rxLines .rx-line").forEach(function (ln) {
      if (ln.style.display === "none") return;
      var g = ((ln.querySelector('[data-f="drug"]') || {}).value || "").trim();
      if (ln.classList.contains("adv")) { if (g) lines.push({ advice: true, text: g }); return; }
      if (!g) return;
      lines.push({
        drug: g,
        brand: ((ln.querySelector('[data-f="brand"]') || {}).value || "").trim(),
        dose: ((ln.querySelector('[data-f="dose"]') || {}).value || "").trim(),
        freq: ((ln.querySelector('[data-f="freq"]') || {}).value || "").trim(),
        duration: ((ln.querySelector('[data-f="duration"]') || {}).value || "").trim()
      });
    });
    return { name: name, age: age, lines: lines };
  }
  function rxPrintHTML(topic, regNo) {
    var d = collectRx(), date = ""; try { date = new Date().toISOString().slice(0, 10); } catch (e) {}
    var n = 0;
    var rows = d.lines.map(function (L) {
      if (L.advice) return '<div class="adv">&bull; ' + esc(L.text) + '</div>';
      n++;
      var sub = [L.dose, L.freq, L.duration].filter(Boolean).join(" &middot; ");
      return '<div class="rx"><div class="rxn">' + n + '.</div><div class="rxd"><b>' + esc(L.drug) + '</b>' +
        (L.brand ? ' <span class="br">(' + esc(L.brand) + ')</span>' : '') +
        (sub ? '<div class="dz">' + sub + '</div>' : '') + '</div></div>';
    }).join("");
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>StewardMD Prescription</title><style>' +
      '*{box-sizing:border-box}html,body{margin:0;padding:0}' +
      'body{font:15px/1.55 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:26px}' +
      '.hd{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #0e6e63;padding-bottom:10px}' +
      '.logo{font:800 22px/1 Georgia,serif;color:#0e6e63}.logo b{color:#0f172a}.tag{font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.06em}' +
      '.clinic{font-weight:700;margin:12px 0 2px}.pt{color:#334155;font-size:14px;margin:8px 0 4px}' +
      '.rxsym{font:800 26px Georgia,serif;margin:12px 0 6px}' +
      '.rx{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #eef2f1}.rxn{color:#64748b;font-weight:700;min-width:20px}.br{color:#0e6e63;font-weight:600}.dz{color:#475569;font-size:13px;margin-top:2px}' +
      '.adv{padding:6px 0;color:#475569;font-size:13px}' +
      '.sign{margin-top:34px;text-align:right}.sign .nm{font-weight:700}.sign .mt{color:#64748b;font-size:12px}' +
      '.disc{margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5}' +
      '@media print{body{padding:0}@page{margin:16mm}}' +
      '</style></head><body>' +
      '<div class="hd"><span class="logo">Steward<b>MD</b></span><span class="tag">Prescription</span></div>' +
      '<div class="clinic">StewardMD' + (topic ? ' &middot; ' + esc(topic) : '') + '</div>' +
      ((d.name || d.age) ? '<div class="pt">' + esc(d.name) + (d.age ? '  &middot;  ' + esc(d.age) : '') + '</div>' : '') +
      '<div class="rxsym">&#8478;</div><main>' + (rows || '<div class="adv">No items.</div>') + '</main>' +
      '<div class="sign"><div class="nm">Dr. ' + esc(docName() || "—") + '</div><div class="mt">NMC Reg: ' + esc(regNo || "—") + '  &middot;  ' + esc(date) + '</div></div>' +
      '<div class="disc">Draft prescription generated with StewardMD. Verify every drug, dose, route and interaction against the patient and local protocol. The prescriber is responsible for what they sign.</div>' +
      '</body></html>';
  }
  function rxWebPrint(html) {
    try {
      var f = document.createElement("iframe");
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(f);
      var doc = f.contentWindow.document; doc.open(); doc.write(html); doc.close();
      f.contentWindow.focus();
      setTimeout(function () { try { f.contentWindow.print(); } catch (e) {} setTimeout(function () { try { f.remove(); } catch (e) {} }, 1500); }, 350);
      return true;
    } catch (e) { return false; }
  }
  function rxNativePrint(html) {
    var P = rxPlugins();
    if (P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
      P.Filesystem.writeFile({ path: "stewardmd-prescription.html", data: html, directory: "CACHE", encoding: "utf8" })
        .then(function (res) { return P.Share.share({ title: "StewardMD Prescription", url: res.uri, dialogTitle: "Print or share prescription" }); })
        .catch(function () { try { if (P.Share && P.Share.share) P.Share.share({ title: "StewardMD Prescription", text: (sheet && sheet.innerText) || "" }); } catch (e) {} });
      return true;
    }
    try { if (navigator.share) { navigator.share({ title: "StewardMD Prescription", text: (sheet && sheet.innerText) || "" }); return true; } } catch (e) {}
    return false;
  }
  function doRxPrint(topic, regNo) {
    var html = rxPrintHTML(topic, regNo);
    if (rxNative()) { if (!rxNativePrint(html)) rxWebPrint(html); return; }
    if (!rxWebPrint(html)) rxNativePrint(html);
  }

  // Drug dictionary for text extraction — the interaction engine (~3k generics, incl. specialty
  // drugs like antiretrovirals) plus the Drug Index. Built once, cached. Multi-word generics also
  // index their first word (e.g. "tenofovir" from "tenofovir anhydrous").
  var _rxDictCache = null;
  var _RX_STOP = { alcohol: 1, oxygen: 1, water: 1, glucose: 1, dextrose: 1, saline: 1, sodium: 1, potassium: 1, calcium: 1, magnesium: 1, chloride: 1, protein: 1, albumin: 1, fluid: 1, fluids: 1 };
  function rxDrugDict() {
    if (_rxDictCache) return _rxDictCache;
    var set = {};
    function add(n) {
      if (!n) return; var s = String(n).toLowerCase().trim();
      if (s.length >= 5 && !_RX_STOP[s]) set[s] = 1;
      var first = s.split(/[\s/,+()\-]/)[0];   // single-word variant of a multi-word generic
      if (first && first.length >= 6 && !_RX_STOP[first]) set[first] = 1;
    }
    try { var IR = window.INTERACTION_RULES; if (IR) { if (Array.isArray(IR.generics)) IR.generics.forEach(add); if (IR.drugClasses) Object.keys(IR.drugClasses).forEach(add); } } catch (e) {}
    try { ((window.MEDDRUGS && MEDDRUGS._list) || []).forEach(function (d) { if (d && d.generic) add(d.generic); }); } catch (e) {}
    _rxDictCache = Object.keys(set);
    return _rxDictCache;
  }
  // Pull the real drugs a free-text answer names — only names that exist in the dictionaries, in
  // order of first appearance. Returned title-cased; buildRxLines flags them unverified (no dose).
  function drugsFromText(text) {
    var dict = rxDrugDict(); if (!dict.length || !text) return [];
    var hay = " " + String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ") + " ";
    var hits = [];
    for (var i = 0; i < dict.length; i++) { var nm = dict[i]; var idx = hay.indexOf(" " + nm + " "); if (idx >= 0) hits.push([idx, nm]); }
    hits.sort(function (a, b) { return a[0] - b[0]; });
    var seen = {}, out = [];
    for (var j = 0; j < hits.length && out.length < 15; j++) {
      var g = hits[j][1]; if (seen[g]) continue; seen[g] = 1;
      out.push(g.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }));
    }
    return out;
  }

  // Regimen from the grounded package: advice + de-duped drugs. PREFER the structured `dosing`
  // (indication-specific dose/route/freq/duration the answer used) so "(pre-fill from this)" fills
  // the REAL dose — not a generic Drug-Index default or a blank ⚠ line. Falls back to name-only
  // drugRefs for drugs without structured dosing (the core then backfills / flags them).
  function regimenFromCtx(ctx) {
    var reg = [{ name: "Lifestyle & general measures", isAdvice: true }];
    var t = ctx && ctx.pkg && ctx.pkg.treatment;
    var seen = {}, added = 0;
    var dosing = [];
    if (t && t.default && t.default.dosing) dosing = dosing.concat(t.default.dosing);
    (t && t.alternatives || []).forEach(function (a) { dosing = dosing.concat(a.dosing || []); });
    dosing.forEach(function (d) {
      var nm = String((d && d.drug) || "").split(/[—,;(]/)[0].trim(); if (!nm) return;
      var k = nm.toLowerCase(); if (seen[k]) return; seen[k] = 1;
      var dose = (d.dose || "").trim();
      if (dose && d.route && dose.toLowerCase().indexOf(String(d.route).toLowerCase()) < 0) dose += " " + d.route;
      // source:"kb" → the safety core trusts this authored dose (not flagged unverified).
      reg.push({ name: nm, dose: dose || null, freq: d.freq || null, duration: d.duration || null, source: dose ? "kb" : undefined });
      added++;
    });
    var drugs = [];
    if (t && t.default && t.default.drugRefs) drugs = drugs.concat(t.default.drugRefs);
    (t && t.alternatives || []).forEach(function (a) { drugs = drugs.concat(a.drugRefs || []); });
    if (ctx && ctx.pkg && ctx.pkg.refs && ctx.pkg.refs.drug) drugs = drugs.concat(ctx.pkg.refs.drug);
    drugs.forEach(function (d) {
      var nm = String(d || "").split(/[—,;(]/)[0].trim(); if (!nm) return;
      var k = nm.toLowerCase(); if (seen[k]) return; seen[k] = 1; reg.push({ name: nm }); added++;
    });
    // FALLBACK: the grounded package carried no structured drugs (e.g. HIV/AIDS), but the answer
    // text named real regimens. Extract the drugs it mentioned (validated against the dictionaries)
    // so the pad still pre-fills them — each lands as an unverified line for the clinician to confirm.
    if (!added && ctx && ctx.answerText) {
      drugsFromText(ctx.answerText).forEach(function (nm) {
        var k = nm.toLowerCase(); if (seen[k]) return; seen[k] = 1; reg.push({ name: nm });
      });
    }
    return reg;
  }

  function lineHTML(l, i) {
    var cls = "rx-line" + (l.isAdvice ? " adv" : "") + (l.unverified ? " unv" : "");
    if (l.isAdvice) {
      return '<div class="' + cls + '" data-i="' + i + '"><div class="r1"><input class="rx-in rx-drug" data-f="drug" value="' + esc(l.drug) + '" style="flex:1" placeholder="Advice / non-drug measure"><button class="rx-del" title="Remove">✕</button></div></div>';
    }
    return '<div class="' + cls + '" data-i="' + i + '">' +
      '<div class="r1"><input class="rx-in rx-drug" data-f="drug" value="' + esc(l.drug) + '" placeholder="Drug (generic)">' +
      '<input class="rx-in rx-brand" data-f="brand" value="' + esc(l.brand || "") + '" placeholder="Brand"><button class="rx-del" title="Remove">✕</button></div>' +
      '<div class="r2"><input class="rx-in rx-dose" data-f="dose" value="' + esc(l.dose || "") + '" placeholder="Dose">' +
      '<input class="rx-in rx-freq" data-f="freq" value="' + esc(l.freq || "") + '" placeholder="Freq">' +
      '<input class="rx-in rx-dur" data-f="duration" value="' + esc(l.duration || "") + '" placeholder="Duration"></div>' +
      (l.unverified ? '<div class="rx-flag">⚠ Not from the Drug Index — confirm this dose before signing</div>' : "") +
      '</div>';
  }

  // Live brand/composition search on a drug line, powered by the Drug Index (MEDDRUGS).
  // Typing in the Drug (generic) OR Brand field shows matching medicines; picking one auto-fills
  // the composition (generic), a matching brand and the DB dose — the "auto-add once composition
  // is selected" path, for a doctor-typed line or an AI-suggested one being edited.
  function acAttach(line) {
    if (!line || line.classList.contains("adv") || line._acWired) return;
    line._acWired = true;
    var r1 = line.querySelector(".r1");
    var drugIn = line.querySelector(".rx-drug"), brandIn = line.querySelector(".rx-brand");
    if (!r1 || !drugIn) return;
    var ac = null, rows = [], active = -1;
    function closeAc() { if (ac) { ac.remove(); ac = null; } rows = []; active = -1; }
    function fill(r, typedBrand) {
      drugIn.value = r.generic;
      if (brandIn) {
        var b = "";
        if (typedBrand) { var q = typedBrand.toLowerCase(); b = (r.brands || []).filter(function (x) { return x.toLowerCase().indexOf(q) >= 0; })[0] || ""; }
        brandIn.value = b || (r.brands || [])[0] || brandIn.value || "";
      }
      var doseIn = line.querySelector(".rx-dose"); if (doseIn && r.dose) doseIn.value = r.dose;
      line.classList.remove("unv"); var fl = line.querySelector(".rx-flag"); if (fl) fl.remove();  // now DB-sourced
      closeAc();
    }
    function paint() { Array.prototype.forEach.call(ac.querySelectorAll(".rx-ac-item"), function (b, i) { b.classList.toggle("on", i === active); }); }
    function search(q, fromBrand) {
      q = (q || "").trim();
      if (!window.MEDDRUGS || !MEDDRUGS.searchIndex || q.length < 2) { closeAc(); return; }
      rows = MEDDRUGS.searchIndex(q).slice(0, 8); active = -1;
      if (!rows.length) { closeAc(); return; }
      if (!ac) { ac = document.createElement("div"); ac.className = "rx-ac"; r1.insertAdjacentElement("afterend", ac); }
      ac.innerHTML = rows.map(function (r, i) {
        var brands = (r.brands || []).slice(0, 3).join(", ");
        return '<button type="button" class="rx-ac-item" data-i="' + i + '"><span class="rx-ac-g">' + esc(r.generic) + '</span>' + (brands ? ' <span class="rx-ac-b">' + esc(brands) + '</span>' : '') + '<span class="rx-ac-d">' + esc(r.dose || '') + '</span></button>';
      }).join("");
      Array.prototype.forEach.call(ac.querySelectorAll(".rx-ac-item"), function (b) {
        b.addEventListener("mousedown", function (e) { e.preventDefault(); fill(rows[+b.getAttribute("data-i")], fromBrand ? q : ""); });
      });
    }
    function onKey(e, fromBrand, val) {
      if (!ac || !rows.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); fill(rows[active], fromBrand ? val : ""); }
      else if (e.key === "Escape") { closeAc(); }
    }
    drugIn.addEventListener("input", function () { search(drugIn.value, false); });
    drugIn.addEventListener("keydown", function (e) { onKey(e, false, drugIn.value); });
    drugIn.addEventListener("blur", function () { setTimeout(closeAc, 150); });
    if (brandIn) {
      brandIn.addEventListener("input", function () { search(brandIn.value, true); });
      brandIn.addEventListener("keydown", function (e) { onKey(e, true, brandIn.value); });
      brandIn.addEventListener("blur", function () { setTimeout(closeAc, 150); });
    }
  }

  function renderRx(topic, lines, regNo) {
    var now = new Date();
    var date = now.toISOString().slice(0, 10);
    var body =
      '<div class="rx-head"><div class="rx-title">Prescription</div><button class="rx-x" id="rxX" aria-label="Close">✕</button></div>' +
      '<div class="rx-clinic">StewardMD' + (topic ? ' · ' + esc(topic) : '') + '</div>' +
      '<div class="rx-disc">Draft prescription — verify every drug, dose, route and interaction against the patient and local protocol. The prescriber is responsible for what they sign.</div>' +
      '<div class="rx-pt"><input class="rx-in" id="rxPtName" placeholder="Patient name (optional, not saved)"><input class="rx-in" id="rxPtAge" placeholder="Age/Sex" style="flex:0 0 110px"></div>' +
      '<div class="rx-symbol">℞</div>' +
      '<div id="rxLines">' + lines.map(lineHTML).join("") + '</div>' +
      '<div class="rx-row"><button class="rx-btn rx-add" id="rxAdd">+ Add drug</button><button class="rx-btn rx-print" id="rxPrint">🖨 Print / PDF</button></div>' +
      '<div class="rx-sign">Dr. ' + esc(docName() || "—") + '<br><small>NMC Reg: ' + esc(regNo || "—") + ' · ' + esc(date) + '</small></div>';
    show(body);
    sheet.querySelector("#rxX").addEventListener("click", close);
    sheet.querySelector("#rxAdd").addEventListener("click", function () {
      var wrap = sheet.querySelector("#rxLines"); var i = wrap.children.length;
      wrap.insertAdjacentHTML("beforeend", lineHTML({ drug: "", brand: "", dose: "", freq: "", duration: "", unverified: false, isAdvice: false }, i));
      bindDel();
      acAttach(wrap.lastElementChild);   // brand/composition search on the new line
    });
    sheet.querySelector("#rxPrint").addEventListener("click", function () { try { doRxPrint(topic, regNo); } catch (e) {} });
    bindDel();
    // Brand/composition search + auto-fill on every drug line (skips advice lines).
    sheet.querySelectorAll("#rxLines .rx-line").forEach(acAttach);
    function bindDel() { sheet.querySelectorAll(".rx-del").forEach(function (b) { b.onclick = function () { var ln = b.closest(".rx-line"); if (ln) ln.remove(); }; }); }
  }

  function gate() {
    show('<div class="rx-head"><div class="rx-title">Prescriber details</div><button class="rx-x" id="rxX" aria-label="Close">✕</button></div>' +
      '<div class="rx-gate">Enter your <b>NMC registration number</b> to create prescriptions. It is stored on this device and printed on your prescriptions.' +
      '<input class="rx-in" id="rxNmc" placeholder="NMC registration number" inputmode="numeric"></div>' +
      '<div class="rx-row"><button class="rx-btn rx-print" id="rxSaveNmc">Save & continue</button></div>');
    sheet.querySelector("#rxX").addEventListener("click", close);
    sheet.querySelector("#rxSaveNmc").addEventListener("click", function () {
      var v = (sheet.querySelector("#rxNmc").value || "").trim();
      if (!v) { sheet.querySelector("#rxNmc").focus(); return; }
      setNmc(v); close(); setTimeout(function () { if (window.__rxPending) { open(window.__rxPending); window.__rxPending = null; } }, 60);
    });
  }

  // Verified-doctors-only prompt (shown when the gate is present but the user isn't verified).
  function verifyRequired() {
    show('<div class="rx-head"><div class="rx-title">Prescription</div><button class="rx-x" id="rxX" aria-label="Close">✕</button></div>' +
      '<div class="rx-gate">Only <b>verified doctors</b> can create prescriptions. Verify your medical registration once — the pad then opens with your <b>registered number</b> printed on every Rx.</div>' +
      '<div class="rx-row"><button class="rx-btn rx-print" id="rxVerify">Verify my registration</button></div>');
    sheet.querySelector("#rxX").addEventListener("click", close);
    sheet.querySelector("#rxVerify").addEventListener("click", function () { close(); try { window.SMD_VERIFY.openPanel(); } catch (e) {} });
  }

  function open(ctx) {
    ensureEls();
    var reg = (ctx && ctx.regimen) || regimenFromCtx(ctx);
    var drugList = (window.MEDDRUGS && window.MEDDRUGS._list) || [];
    function build(regNo) {
      import("/rx-build.mjs?v=gold321").then(function (m) {
        renderRx(ctx && ctx.topic, m.buildRxLines(reg, drugList), regNo);
      }).catch(function () {
        renderRx(ctx && ctx.topic, reg.map(function (r) { return { drug: r.name, brand: null, dose: r.dose || null, freq: null, duration: null, unverified: !r.isAdvice, isAdvice: !!r.isAdvice }; }), regNo);
      });
    }
    // PRIMARY: gate on the Doctor Verification system; Rx carries the VERIFIED reg number.
    if (window.SMD_VERIFY) {
      verifiedInfo().then(function (info) {
        if (!info || !info.verified) { verifyRequired(); return; }
        build(info.regNo || "");
      }).catch(function () { verifyRequired(); });
      return;
    }
    // FALLBACK: gate not on this build → manual NMC entry (dev/rollout only).
    if (!canPrescribe()) { window.__rxPending = ctx || {}; gate(); return; }
    build(getNmc());
  }

  window.SMD_RX = { open: open, canPrescribe: canPrescribe, verifiedInfo: verifiedInfo, _getNmc: getNmc, _setNmc: setNmc };
})();
