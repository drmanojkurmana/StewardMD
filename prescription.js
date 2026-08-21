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
  function rxIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n, "rx-ico") : ""; }

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
      ".rx-btn{border:0;border-radius:999px;padding:9px 16px;font:800 13px var(--hfont);cursor:pointer}.rx-add{background:rgba(100,116,139,.12);color:var(--hink)}.rx-print{background:#2563eb;color:#fff}.rx-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.rx-ico{width:14px;height:14px;vertical-align:-2px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.rx-x .rx-ico,.rx-del .rx-ico{width:16px;height:16px}.rx-print .rx-ico{margin-right:5px}" +
      ".rx-sign{margin-top:14px;border-top:1px dashed var(--hbd,#e2e8f0);padding-top:10px;font:600 13px var(--hfont);color:var(--hink)}.rx-sign small{color:var(--hmut,#64748b);font-weight:500}" +
      ".rx-gate{font:500 13px var(--hfont);color:var(--hink)}.rx-gate input{margin-top:10px;width:100%}" +
      ".rx-clinic-card{display:flex;align-items:center;gap:10px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:9px 11px;margin-bottom:6px;background:var(--paper,#f8faf9)}.rx-clinic-logo{width:42px;height:42px;object-fit:contain;border-radius:8px;background:#fff}.rx-clinic-meta{flex:1;min-width:0}.rx-clinic-nm{font:800 14px var(--hfont);color:var(--hink)}.rx-clinic-ad{font:500 11.5px var(--hfont);color:var(--hmut,#64748b)}.rx-clinic-edit{border:0;background:transparent;color:var(--teal,#0e6e63);font:700 12px var(--hfont);cursor:pointer}" +
      ".rx-clinic-form{display:flex;flex-direction:column;gap:8px;margin-top:10px}.rx-clinic-form .rx-in{width:100%}.rx-logo-row{display:flex;align-items:center;gap:8px}.rx-logo-prev{width:54px;height:54px;border:1px dashed var(--hbd,#cbd5e1);border-radius:10px;display:flex;align-items:center;justify-content:center;font:600 10px var(--hfont);color:var(--hmut);overflow:hidden;flex:none}.rx-logo-prev img{width:100%;height:100%;object-fit:contain}" +
      ".rx-bp-ov{position:absolute;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:flex-end;justify-content:center;z-index:6;border-radius:16px}.rx-bp{background:var(--hpanel,#fff);width:100%;max-height:82%;overflow:auto;border-radius:16px 16px 0 0;padding:14px}.rx-exp,.rx-sign-sheet{border-radius:16px}.rx-bp-h{display:flex;align-items:center;justify-content:space-between;font:800 15px var(--hfont);color:var(--hink)}.rx-bp-x{border:0;background:transparent;cursor:pointer;color:var(--hmut)}.rx-bp-sub{font:600 10.5px var(--hfont);color:var(--hmut);text-transform:uppercase;letter-spacing:.05em;margin:2px 0 8px}" +
      ".rx-bp-it{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--hbd,#eef1f4);background:none;padding:9px 4px;cursor:pointer}.rx-bp-nm{font:700 13.5px var(--hfont);color:var(--hink);flex:1 1 44%}.rx-bp-nm em{color:#ef4444;font-weight:600;font-style:normal;font-size:11px}.rx-bp-mf{font:500 11px var(--hfont);color:var(--hmut);flex:1 1 40%}.rx-bp-pr{font:800 13px var(--hfont);color:var(--teal,#0e6e63)}" +
      ".rx-sign-cv{width:100%;height:180px;border:1px dashed var(--hbd,#cbd5e1);border-radius:10px;background:#fff;touch-action:none;margin:6px 0}.rx-sign-reuse{display:flex;align-items:center;gap:6px;font:600 12.5px var(--hfont);color:var(--hink);margin:4px 0}" +
      ".rx-brands{border:1px solid var(--teal,#0e6e63);background:rgba(14,110,99,.08);color:var(--teal,#0e6e63);border-radius:8px;font:700 10.5px var(--hfont);padding:0 8px;cursor:pointer;white-space:nowrap;flex:none}" +
      ".rx-doc{font-family:Georgia,'Times New Roman',serif;color:#111;background:#fff}.rxdoc-in{padding:40px 44px;word-spacing:1px}.rxdoc-hd{display:flex;align-items:center;gap:16px}.rxdoc-logo{width:64px;height:64px;object-fit:contain}.rxdoc-nm{font:800 22px Georgia,serif;color:#0e6e63}.rxdoc-ad{font:400 12.5px Georgia,serif;color:#444;margin-top:2px}.rxdoc-rule{height:3px;background:#0e6e63;margin-top:12px}.rxdoc-pt{display:flex;justify-content:space-between;align-items:baseline;font:400 14px Georgia,serif;color:#222;margin:12px 0 2px;border-bottom:1px solid #ddd;padding-bottom:6px}.rxdoc-dt{color:#555;font-size:12.5px}.rxdoc-topic{font:italic 400 12.5px Georgia,serif;color:#555;margin-top:4px}.rxdoc-rx{font:800 30px Georgia,serif;color:#0e6e63;margin:10px 0 2px}" +
      ".rxdoc-tbl{width:100%;border-collapse:collapse}.rxdoc-tbl td{padding:7px 4px;border-bottom:1px solid #eee;vertical-align:top;font:400 14px Georgia,serif}.rxdoc-tbl .sn{width:24px;color:#888}.rxdoc-tbl .br{color:#0e6e63;font-weight:600}.rxdoc-tbl .dz{color:#444;font-size:12.5px;white-space:nowrap}.rxdoc-tbl .advr td{color:#555;font-style:italic;border-bottom:0}.rxdoc-ft{margin-top:40px;display:flex;justify-content:flex-end}.rxdoc-sg{text-align:center;min-width:210px}.rxdoc-sgimg{height:54px;object-fit:contain;display:block;margin:0 auto 2px}.rxdoc-drn{font-weight:700;border-top:1px solid #333;padding-top:4px;font-size:14px}.rxdoc-reg{font-size:11.5px;color:#555}.rxdoc-dis{margin-top:26px;border-top:1px solid #ddd;padding-top:10px;font:400 10px Georgia,serif;color:#777;line-height:1.5}.rxdoc-foot{margin-top:22px;border-top:1px solid #ddd;padding-top:10px}.rxdoc-brand{font:400 12px Georgia,serif;color:#0e6e63}.rxdoc-smdlogo{width:20px;height:20px;object-fit:contain;vertical-align:-5px;margin-right:6px;display:inline-block}.rxdoc-smdwm{font:800 13px Georgia,serif;color:#0e6e63}.rxdoc-smdwm b{color:#111}.rxdoc-resp{margin-top:8px;font:400 11px Georgia,serif;color:#555;line-height:1.6}.rxdoc-line{font:400 12.5px Georgia,serif;color:#333;margin:3px 0}.rxdoc-line b{color:#111}.rx-ac-x{color:#ef4444;font-size:10px;font-weight:600}" +
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
    var dx = ((sheet.querySelector("#rxDx") || {}).value || "").trim();
    var cc = ((sheet.querySelector("#rxCc") || {}).value || "").trim();
    var vitals = ((sheet.querySelector("#rxVitals") || {}).value || "").trim();
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
    return { name: name, age: age, dx: dx, complaints: cc, vitals: vitals, lines: lines };
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
      return '<div class="' + cls + '" data-i="' + i + '"><div class="r1"><input class="rx-in rx-drug" data-f="drug" value="' + esc(l.drug) + '" style="flex:1" placeholder="Advice / non-drug measure"><button class="rx-del" title="Remove">'+rxIco("close")+'</button></div></div>';
    }
    return '<div class="' + cls + '" data-i="' + i + '">' +
      '<div class="r1"><input class="rx-in rx-drug" data-f="drug" value="' + esc(l.drug) + '" placeholder="Drug (generic)">' +
      '<input class="rx-in rx-brand" data-f="brand" value="' + esc(l.brand || "") + '" placeholder="Brand — tap for brands + prices"><button class="rx-del" title="Remove">'+rxIco("close")+'</button></div>' +
      '<div class="r2"><input class="rx-in rx-dose" data-f="dose" value="' + esc(l.dose || "") + '" placeholder="Dose">' +
      '<input class="rx-in rx-freq" data-f="freq" value="' + esc(l.freq || "") + '" placeholder="Freq">' +
      '<input class="rx-in rx-dur" data-f="duration" value="' + esc(l.duration || "") + '" placeholder="Duration"></div>' +
      (l.unverified ? '<div class="rx-flag">'+rxIco("warn")+' Not from the Drug Index — confirm this dose before signing</div>' : "") +
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
      try { refreshSafety(); } catch (e) {}   // re-run allergy + interaction checks with the newly picked drug
      try { showPriceHint(line, r.generic); } catch (e) {}   // lowest-cost brand awareness
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
    // The Brand field is handled by rxBrandAC() — a live MEDAPI lookup of real brands + prices for the
    // drug on this line (resolves the molecule fuzzily, so spelling slips still find brands). Wired in renderRx.
  }
  // Live brand picker on the Brand field: resolve the drug → its composition (fuzzy via MEDAPI search,
  // so "amoxcillin" still finds amoxicillin), then list every brand cheapest-first with ₹price; type to
  // filter, tap to fill. Replaces the old "₹ brands" button and the local-only brand search.
  function rxBrandAC(line) {
    if (!line || line.classList.contains("adv") || line._brandWired) return;
    var drugIn = line.querySelector('[data-f="drug"]'), brandIn = line.querySelector('[data-f="brand"]'), r1 = line.querySelector(".r1");
    if (!drugIn || !brandIn || !r1) return; line._brandWired = true;
    var box = null, brands = [], loadedFor = "", loading = false;
    function closeB() { if (box) { box.remove(); box = null; } }
    function draw(msg) {
      if (!box) { box = document.createElement("div"); box.className = "rx-ac"; r1.insertAdjacentElement("afterend", box); }
      if (msg) { box.innerHTML = '<div class="rx-ac-empty">' + esc(msg) + '</div>'; return; }
      var q = (brandIn.value || "").trim().toLowerCase();
      var list = q ? brands.filter(function (b) { return String(b.brand || "").toLowerCase().indexOf(q) >= 0; }) : brands;
      if (!list.length) { box.innerHTML = '<div class="rx-ac-empty">' + (brands.length ? "No matching brand" : "Type the drug first, then tap here for brands") + '</div>'; return; }
      box.innerHTML = list.slice(0, 50).map(function (b, i) { var meta = [b.manufacturer, b.form].filter(Boolean).join(" · "); return '<button type="button" class="rx-ac-item" data-i="' + i + '"><span class="rx-ac-g">' + esc(b.brand) + '</span>' + (b.mrp != null ? ' <span class="rx-ac-b">₹' + b.mrp + '</span>' : '') + (b.discontinued ? ' <span class="rx-ac-x">disc.</span>' : '') + (meta ? '<span class="rx-ac-d">' + esc(meta) + '</span>' : '') + '</button>'; }).join("");
      Array.prototype.forEach.call(box.querySelectorAll(".rx-ac-item"), function (btn) { btn.addEventListener("mousedown", function (e) { e.preventDefault(); brandIn.value = list[+btn.getAttribute("data-i")].brand; closeB(); }); });
    }
    function load(drug) {
      drug = (drug || "").trim(); if (!drug || !window.MEDAPI || !MEDAPI.searchCompositions) { draw("Type the drug first, then tap here for brands"); return; }
      if (drug === loadedFor) { draw(); return; }
      if (loading) return; loading = true; draw("Loading brands for " + drug + "…");
      MEDAPI.searchCompositions(drug, 6).then(function (d) {
        var comp = ((d && d.results) || []).map(function (r) { return r.composition; }).filter(Boolean)[0];
        if (!comp) { loading = false; brands = []; loadedFor = drug; draw("No match for “" + drug + "” — check the spelling"); return; }
        return MEDAPI.composition(comp, "price", "all", 60, 0).then(function (c) { brands = (c && c.brands) || []; loadedFor = drug; loading = false; draw(); });
      }).catch(function () { loading = false; brands = []; loadedFor = drug; draw("Couldn’t load brands — check connection"); });
    }
    brandIn.addEventListener("focus", function () { load(drugIn.value); });
    brandIn.addEventListener("input", function () { if ((drugIn.value || "").trim() === loadedFor) draw(); else load(drugIn.value); });
    brandIn.addEventListener("blur", function () { setTimeout(closeB, 200); });
  }

  // ---- Smart Rx pad safety: live allergy + drug-interaction checks under the drug list. Reuses the
  // on-device INTERACTIONS engine; fails safe (absent engine / <2 drugs => no panel). Advisory, never blocks. ----
  function rxSafetyFindings() {
    var d = collectRx();
    var meds = d.lines.filter(function (L) { return !L.advice && L.drug; }).map(function (L) { return { generic: L.drug }; });
    var out = [];
    var alg = (((sheet && sheet.querySelector("#rxAllergies")) || {}).value || "").toLowerCase().split(/[,;]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 2; });
    if (alg.length) meds.forEach(function (m) { var g = String(m.generic).toLowerCase(); alg.forEach(function (a) { if (g.indexOf(a) > -1) out.push({ sev: "critical", txt: "Allergy — patient reacts to “" + a + "”; " + m.generic + " prescribed" }); }); });
    try {
      if (window.INTERACTIONS && window.INTERACTIONS.checkInteractions && meds.length >= 2) {
        var r = window.INTERACTIONS.checkInteractions(meds) || {};
        ["critical", "major", "moderate"].forEach(function (sev) { (r[sev] || []).forEach(function (f) { out.push({ sev: sev, txt: (f.drugs || []).join(" + ") + ": " + (f.effect || f.mechanism || "interaction") + (f.action ? " — " + f.action : "") }); }); });
        (r.duplicates || []).forEach(function (f) { out.push({ sev: "moderate", txt: "Duplicate therapy: " + (f.drugs || []).join(" + ") }); });
      }
    } catch (e) {}
    var rank = { critical: 0, major: 1, moderate: 2 };
    out.sort(function (a, b) { return (rank[a.sev] == null ? 3 : rank[a.sev]) - (rank[b.sev] == null ? 3 : rank[b.sev]); });
    return out;
  }
  function rxSafetyHTML() {
    var out = rxSafetyFindings(); if (!out.length) return "";
    var col = { critical: ["#fdecea", "#8a1520", "#d3302f"], major: ["#fff4e5", "#8a4b00", "#f59e0b"], moderate: ["#fffbea", "#7a5b00", "#eab308"] };
    return '<div style="font:700 12px/1.4 system-ui;color:#ab1c2c;margin:10px 0 6px;display:flex;align-items:center;gap:6px">' + rxIco("warning") + " Safety checks (" + out.length + ")</div>" +
      out.map(function (w) { var c = col[w.sev] || col.moderate; return '<div style="font:500 12.5px/1.45 system-ui;padding:8px 10px;border-radius:8px;margin:4px 0;background:' + c[0] + ";color:" + c[1] + ";border-left:3px solid " + c[2] + '">' + esc(w.txt) + "</div>"; }).join("");
  }
  function refreshSafety() { var s = sheet && sheet.querySelector("#rxSafety"); if (s) s.innerHTML = rxSafetyHTML(); }

  // Price + generic-substitute awareness: when a drug's generic is set, show the lowest-cost brand (and the
  // spread) inline, so the doctor can prescribe the affordable option. Async, fails silently (no API -> no hint).
  function showPriceHint(line, generic) {
    if (!line) return;
    var hint = line.querySelector(".rx-price-hint");
    if (!hint) { hint = document.createElement("div"); hint.className = "rx-price-hint"; hint.style.cssText = "flex-basis:100%;width:100%;order:99;font-size:11.5px;color:#0e6e63;margin:3px 0 0"; line.appendChild(hint); }
    if (!generic || !window.MEDAPI || !MEDAPI.searchCompositions) { hint.textContent = ""; return; }
    hint.textContent = "checking brand prices…";
    MEDAPI.searchCompositions(generic).then(function (d) {
      var comp = ((d && d.results) || []).map(function (r) { return r.composition; }).filter(Boolean)[0];
      if (!comp) { hint.textContent = ""; return; }
      return MEDAPI.composition(comp, "price", "all", 60, 0).then(function (c) {
        var brands = ((c && c.brands) || []).filter(function (b) { return b.mrp != null && !b.discontinued; });
        if (!brands.length) { hint.textContent = ""; return; }
        var cheap = brands[0], costly = brands[brands.length - 1];
        var txt = "₹ lowest brand: " + cheap.brand + " ₹" + cheap.mrp + (costly && costly.mrp > cheap.mrp ? " (vs ₹" + costly.mrp + " — same molecule)" : "") + " · tap the brand field to switch";
        hint.textContent = txt;
      });
    }).catch(function () { hint.textContent = ""; });
  }

  // ---- Rx templates / favourites: save the current drug set under a name (e.g. "URI", "UTI") and re-apply
  // it in one tap. Local to this device (localStorage). Doctors prescribe the same handful of sets daily. ----
  function rxTemplates() { try { return JSON.parse(localStorage.getItem("smd_rx_templates") || "[]"); } catch (e) { return []; } }
  function saveRxTemplates(a) { try { localStorage.setItem("smd_rx_templates", JSON.stringify(a || [])); } catch (e) {} }
  function tplOptions() {
    return '<option value="-1">＋ Apply a saved Rx set…</option>' + rxTemplates().map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + " (" + ((t.lines || []).length) + ")</option>"; }).join("");
  }
  function applyTemplate(lines) {
    var wrap = sheet && sheet.querySelector("#rxLines"); if (!wrap) return;
    (lines || []).forEach(function (l) {
      var i = wrap.children.length;
      wrap.insertAdjacentHTML("beforeend", lineHTML({ drug: l.drug || "", brand: l.brand || "", dose: l.dose || "", freq: l.freq || "", duration: l.duration || "", unverified: false, isAdvice: false }, i));
      var ln = wrap.lastElementChild; acAttach(ln); rxBrandAC(ln);
      var del = ln.querySelector(".rx-del"); if (del) del.onclick = function () { ln.remove(); refreshSafety(); };
    });
    refreshSafety();
  }

  // ---- Voice-to-Rx: parse a spoken line like "amox 500 TDS 5 days" into a drug row. Brand->generic via
  // the Drug Index; frequency abbreviations + duration recognized. Best-effort; the doctor edits after. ----
  var RX_FREQ = { od: "OD", "once daily": "OD", "once a day": "OD", bd: "BD", "twice daily": "BD", "twice a day": "BD", "two times": "BD", tds: "TDS", tid: "TDS", "thrice": "TDS", "three times": "TDS", qid: "QID", "four times": "QID", hs: "HS", "at night": "HS", "bed time": "HS", bedtime: "HS", sos: "SOS", "as needed": "SOS", prn: "SOS", stat: "STAT" };
  function parseVoiceRx(text) {
    var t = String(text || "").trim(); if (!t) return null;
    var lower = t.toLowerCase();
    var freq = ""; Object.keys(RX_FREQ).forEach(function (k) { if (!freq && new RegExp("\\b" + k.replace(/ /g, "\\s+") + "\\b", "i").test(lower)) freq = RX_FREQ[k]; });
    var dm = lower.match(/(\d+)\s*(days?|weeks?|months?)/); var duration = dm ? (dm[1] + " " + dm[2]) : "";
    var doseM = t.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)?/i); var dose = doseM ? (doseM[1] + (doseM[2] ? (" " + doseM[2]) : "")) : "";
    var drugM = t.match(/^([a-z][a-z\s\-]*?)(?=\s*\d|\s+(?:od|bd|tds|tid|qid|hs|sos|prn|stat)\b|$)/i);
    var drugRaw = (drugM ? drugM[1] : t.split(/\s+/)[0] || "").trim();
    var generic = drugRaw;
    try { if (window.MEDDRUGS) { var f = MEDDRUGS.findByName && MEDDRUGS.findByName(drugRaw); if (f && f.generic) generic = f.generic; else { var s = MEDDRUGS.searchIndex && MEDDRUGS.searchIndex(drugRaw); if (s && s[0] && s[0].generic) generic = s[0].generic; } } } catch (e) {}
    return { drug: generic || drugRaw, dose: dose, freq: freq, duration: duration };
  }

  function renderRx(topic, lines, regNo) {
    var now = new Date();
    var date = now.toISOString().slice(0, 10);
    var body =
      '<div class="rx-head"><div class="rx-title">Prescription</div><button class="rx-x" id="rxX" aria-label="Close">'+rxIco("close")+'</button></div>' +
      '<div class="rx-disc">Draft prescription — verify every drug, dose, route and interaction against the patient and local protocol. The prescriber is responsible for what they sign.</div>' +
      '<div class="rx-clinic-slot" id="rxClinicSlot">' + clinicSummaryHTML() + '</div>' +
      '<div class="rx-pt"><input class="rx-in" id="rxPtName" placeholder="Patient name (optional, not saved)"><input class="rx-in" id="rxPtAge" placeholder="Age/Sex" style="flex:0 0 110px"></div>' +
      '<div class="rx-pt"><input class="rx-in" id="rxDx" placeholder="Diagnosis" value="' + esc(topic || "") + '" style="flex:1"></div>' +
      '<div class="rx-pt"><input class="rx-in" id="rxCc" placeholder="Complaints (optional)"><input class="rx-in" id="rxVitals" placeholder="Vitals — BP/HR/T/SpO₂ (optional)"></div>' +
      '<div class="rx-pt"><input class="rx-in" id="rxAllergies" placeholder="Known allergies (optional) — checked against each drug" style="flex:1"></div>' +
      '<div class="rx-symbol">℞</div>' +
      '<div id="rxLines">' + lines.map(lineHTML).join("") + '</div>' +
      '<div class="rx-safety" id="rxSafety"></div>' +
      '<div style="display:flex;gap:8px;margin:6px 0 2px"><select id="rxTpl" style="flex:1;padding:9px 10px;border:1px solid #d7dee3;border-radius:9px;font-size:13px;background:#fff;color:#14202b">' + tplOptions() + '</select><button class="rx-btn" id="rxTplSave" style="width:auto;margin:0;white-space:nowrap;padding:9px 12px;font-size:13px">Save set</button></div>' +
      '<div class="rx-row"><button class="rx-btn rx-add" id="rxAdd">+ Add drug</button><button class="rx-btn" id="rxMic" title="Dictate a drug, e.g. amox 500 TDS 5 days">'+rxIco("mic")+' Dictate</button><button class="rx-btn rx-print" id="rxExport">'+rxIco("print")+' Sign &amp; Export</button></div>' +
      '<div class="rx-sign">Dr. ' + esc(docName() || "—") + '<br><small>Reg. No: ' + esc(regNo || "—") + ' · ' + esc(date) + '</small></div>';
    show(body);
    sheet.querySelector("#rxX").addEventListener("click", close);
    function wireClinic() { var a = sheet.querySelector("#rxClinicAdd"); if (a) a.onclick = function () { openClinicEditor(refreshClinic); }; var e = sheet.querySelector("#rxClinicEdit"); if (e) e.onclick = function () { openClinicEditor(refreshClinic); }; }
    function refreshClinic() { var s = sheet.querySelector("#rxClinicSlot"); if (s) { s.innerHTML = clinicSummaryHTML(); wireClinic(); } }
    wireClinic();
    sheet.querySelector("#rxAdd").addEventListener("click", function () {
      var wrap = sheet.querySelector("#rxLines"); var i = wrap.children.length;
      wrap.insertAdjacentHTML("beforeend", lineHTML({ drug: "", brand: "", dose: "", freq: "", duration: "", unverified: false, isAdvice: false }, i));
      bindDel();
      acAttach(wrap.lastElementChild); rxBrandAC(wrap.lastElementChild);   // drug AC + live brand picker
      refreshSafety();
    });
    sheet.querySelector("#rxExport").addEventListener("click", function () { try { signAndExport(topic, regNo); } catch (e) {} });
    bindDel();
    // Drug autocomplete (generic + DB dose, local) AND the live brand picker (MEDAPI brands + prices).
    sheet.querySelectorAll("#rxLines .rx-line").forEach(function (ln) { acAttach(ln); rxBrandAC(ln); });
    // live safety panel: recheck allergies + interactions as drug names / allergies change
    refreshSafety();
    var _sl = sheet.querySelector("#rxLines"); if (_sl) _sl.addEventListener("input", function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute("data-f") === "drug") refreshSafety(); });
    var _al = sheet.querySelector("#rxAllergies"); if (_al) _al.addEventListener("input", refreshSafety);
    // Templates: apply a saved set, or save the current drugs as a named set.
    var _tpl = sheet.querySelector("#rxTpl"); if (_tpl) _tpl.onchange = function () { var i = +this.value; if (i >= 0) { var t = rxTemplates()[i]; if (t) applyTemplate(t.lines); this.value = "-1"; } };
    var _tplS = sheet.querySelector("#rxTplSave"); if (_tplS) _tplS.onclick = function () {
      var ls = (collectRx().lines || []).filter(function (l) { return !l.advice && l.drug; });
      if (!ls.length) { try { window.toast && window.toast("Add drugs first"); } catch (e) {} return; }
      var nm = ""; try { nm = (window.prompt("Name this Rx set (e.g. URI, UTI, HTN):") || "").trim(); } catch (e) {}
      if (!nm) return;
      var a = rxTemplates(); a.push({ name: nm, lines: ls.map(function (l) { return { drug: l.drug, brand: l.brand, dose: l.dose, freq: l.freq, duration: l.duration }; }) }); saveRxTemplates(a);
      try { window.toast && window.toast("Saved Rx set: " + nm); } catch (e) {}
      var s = sheet.querySelector("#rxTpl"); if (s) s.innerHTML = tplOptions();
    };
    // Voice-to-Rx: dictate a drug line ("amox 500 TDS 5 days"), parse it, add the row.
    var _mic = sheet.querySelector("#rxMic");
    if (_mic) _mic.onclick = function () {
      if (!(window.SMD_VOICE && SMD_VOICE.listen)) { try { window.toast && window.toast("Voice not available on this device"); } catch (e) {} return; }
      if (_mic._sess) { try { _mic._sess.stop(); } catch (e) {} _mic._sess = null; _mic.classList.remove("on"); return; }
      _mic.classList.add("on");
      var stop = function () { _mic.classList.remove("on"); _mic._sess = null; };
      try {
        _mic._sess = SMD_VOICE.listen({ onFinal: function (txt) { var p = parseVoiceRx(txt); if (p && p.drug) applyTemplate([p]); }, onError: stop, onEnd: stop });
        if (!_mic._sess) { stop(); try { window.toast && window.toast("Could not start voice"); } catch (e) {} }
      } catch (e) { stop(); }
    };
    function bindDel() { sheet.querySelectorAll(".rx-del").forEach(function (b) { b.onclick = function () { var ln = b.closest(".rx-line"); if (ln) { ln.remove(); refreshSafety(); } }; }); }
  }

  function gate() {
    show('<div class="rx-head"><div class="rx-title">Prescriber details</div><button class="rx-x" id="rxX" aria-label="Close">'+rxIco("close")+'</button></div>' +
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
    show('<div class="rx-head"><div class="rx-title">Prescription</div><button class="rx-x" id="rxX" aria-label="Close">'+rxIco("close")+'</button></div>' +
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

  // ================= Rx v2: clinic letterhead · brand-by-price · signature · PDF/JPEG =================
  function rxToast(m){ try{ (window.SMD_toast||window.toast||function(){})(m); }catch(e){} }
  function rxImgToDataURL(file, maxW, cb){
    try{ var r=new FileReader(); r.onload=function(){ var img=new Image(); img.onload=function(){ var sc=Math.min(1, maxW/img.width); var cv=document.createElement("canvas"); cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc); cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height); try{ cb(cv.toDataURL("image/png")); }catch(e){ cb(r.result); } }; img.onerror=function(){ cb(r.result); }; img.src=r.result; }; r.readAsDataURL(file); }catch(e){}
  }
  // ---- Clinic letterhead (stored on THIS device, reused on every Rx) ----
  function clinicKey(){ return "smd_rx_clinic_" + uid(); }
  function getClinic(){ try{ return JSON.parse(localStorage.getItem(clinicKey())||"null")||{}; }catch(e){ return {}; } }
  function setClinic(o){ try{ localStorage.setItem(clinicKey(), JSON.stringify(o||{})); }catch(e){} }
  function clinicSummaryHTML(){
    var c=getClinic(); if(!(c&&(c.name||c.address||c.phone||c.logo))) return '<button class="rx-btn rx-add" id="rxClinicAdd" style="width:100%">+ Add clinic name, address, phone & logo</button>';
    return '<div class="rx-clinic-card">'+(c.logo?'<img class="rx-clinic-logo" src="'+esc(c.logo)+'" alt="">':'')+
      '<div class="rx-clinic-meta"><div class="rx-clinic-nm">'+esc(c.name||"—")+'</div>'+
      (c.address?'<div class="rx-clinic-ad">'+esc(c.address)+'</div>':'')+(c.phone?'<div class="rx-clinic-ad">'+esc(c.phone)+'</div>':'')+'</div>'+
      '<button class="rx-clinic-edit" id="rxClinicEdit">Edit</button></div>';
  }
  function openClinicEditor(onSaved){
    var c=getClinic(), logoData=c.logo||"";
    var ov=document.createElement("div"); ov.className="rx-bp-ov";
    ov.innerHTML='<div class="rx-bp rx-exp"><div class="rx-bp-h"><b>Clinic details</b><button class="rx-bp-x">'+rxIco("close")+'</button></div>'+
      '<div class="rx-bp-sub">your letterhead · stored only on this device</div>'+
      '<div class="rx-clinic-form"><input class="rx-in" id="rxCName" placeholder="Clinic / hospital name" value="'+esc(c.name||"")+'"><textarea class="rx-in" id="rxCAddr" placeholder="Address" rows="2">'+esc(c.address||"")+'</textarea><input class="rx-in" id="rxCPhone" placeholder="Phone / contact" value="'+esc(c.phone||"")+'">'+
      '<div class="rx-logo-row"><div class="rx-logo-prev" id="rxLogoPrev">'+(c.logo?'<img src="'+esc(c.logo)+'">':'Logo')+'</div><label class="rx-btn rx-add" style="cursor:pointer">Upload logo<input type="file" id="rxLogoIn" accept="image/*" style="display:none"></label><button class="rx-btn rx-add" id="rxLogoClr">Remove</button></div></div>'+
      '<div class="rx-row"><button class="rx-btn rx-print" id="rxCSave" style="width:100%">Save clinic details</button></div></div>';
    sheet.appendChild(ov);
    ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); });
    var li=ov.querySelector("#rxLogoIn"); if(li) li.addEventListener("change", function(){ var f=li.files&&li.files[0]; if(f) rxImgToDataURL(f,320,function(d){ logoData=d; var p=ov.querySelector("#rxLogoPrev"); if(p)p.innerHTML='<img src="'+esc(d)+'">'; }); });
    var lc=ov.querySelector("#rxLogoClr"); if(lc) lc.addEventListener("click", function(){ logoData=""; var p=ov.querySelector("#rxLogoPrev"); if(p)p.textContent="Logo"; });
    ov.querySelector("#rxCSave").addEventListener("click", function(){ setClinic({ name:(ov.querySelector("#rxCName").value||"").trim(), address:(ov.querySelector("#rxCAddr").value||"").trim(), phone:(ov.querySelector("#rxCPhone").value||"").trim(), logo:logoData }); ov.remove(); if(onSaved) onSaved(); });
  }
  // ---- Brand-by-price picker (MEDAPI: every Indian brand for the molecule, cheapest first) ----
  function openBrandPicker(line){
    var drugIn=line.querySelector('[data-f="drug"]'), brandIn=line.querySelector('[data-f="brand"]');
    var drug=((drugIn||{}).value||"").trim();
    if(!drug){ rxToast("Type the drug first"); if(drugIn)drugIn.focus(); return; }
    if(!(window.MEDAPI&&MEDAPI.composition)){ rxToast("Brand database needs a connection"); return; }
    var ov=document.createElement("div"); ov.className="rx-bp-ov";
    ov.innerHTML='<div class="rx-bp"><div class="rx-bp-h"><b>Brands · '+esc(drug)+'</b><button class="rx-bp-x">'+rxIco("close")+'</button></div><div class="rx-bp-sub">cheapest first · tap to use</div><div class="rx-bp-list">Loading…</div></div>';
    sheet.appendChild(ov);
    ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); });
    ov.addEventListener("click", function(e){ if(e.target===ov) ov.remove(); });
    MEDAPI.composition(drug, "price", "all", 40, 0).then(function(d){
      var list=ov.querySelector(".rx-bp-list"), arr=(d&&d.brands)||[];
      if(!arr.length){ list.innerHTML='<div class="rx-ac-empty">No brands found — try the exact molecule name.</div>'; return; }
      list.innerHTML=arr.map(function(b,i){ var meta=[b.manufacturer,b.form].filter(Boolean).join(" · ");
        return '<button class="rx-bp-it" data-i="'+i+'"><span class="rx-bp-nm">'+esc(b.brand)+(b.discontinued?' <em>(discontinued)</em>':'')+'</span>'+(meta?'<span class="rx-bp-mf">'+esc(meta)+'</span>':'')+'<span class="rx-bp-pr">'+(b.mrp!=null?'₹'+b.mrp:'')+'</span></button>'; }).join("");
      Array.prototype.forEach.call(list.querySelectorAll(".rx-bp-it"), function(btn){ btn.addEventListener("click", function(){ var b=arr[+btn.getAttribute("data-i")]; if(brandIn) brandIn.value=b.brand; ov.remove(); }); });
    }).catch(function(){ var l=ov.querySelector(".rx-bp-list"); if(l) l.innerHTML='<div class="rx-ac-empty">Couldn’t load brands — check connection.</div>'; });
  }
  // ---- Signature: draw or upload, optional save & reuse on this device ----
  function signKey(){ return "smd_rx_sign_" + uid(); }
  function getSign(){ try{ return localStorage.getItem(signKey())||""; }catch(e){ return ""; } }
  function setSign(d){ try{ if(d) localStorage.setItem(signKey(), d); else localStorage.removeItem(signKey()); }catch(e){} }
  function openSignPad(onDone){
    var saved=getSign();
    var ov=document.createElement("div"); ov.className="rx-bp-ov";
    ov.innerHTML='<div class="rx-bp rx-sign-sheet"><div class="rx-bp-h"><b>Sign the prescription</b><button class="rx-bp-x">'+rxIco("close")+'</button></div><div class="rx-bp-sub">Sign with your finger, or upload your signature image.</div><canvas class="rx-sign-cv" width="600" height="200"></canvas><label class="rx-sign-reuse"><input type="checkbox" id="rxSignSave" '+(saved?'checked':'')+'> Save &amp; reuse on this device</label><div class="rx-row"><button class="rx-btn rx-add" id="rxSignClear">Clear</button><label class="rx-btn rx-add" style="cursor:pointer">Upload<input type="file" id="rxSignUp" accept="image/*" style="display:none"></label><button class="rx-btn rx-print" id="rxSignUse">Use signature →</button></div></div>';
    sheet.appendChild(ov);
    var cv=ov.querySelector(".rx-sign-cv"), ctx=cv.getContext("2d"); ctx.lineWidth=2.4; ctx.lineCap="round"; ctx.strokeStyle="#0f172a";
    var upImg="", drew=false, drawing=false, px=0, py=0;
    if(saved){ var im0=new Image(); im0.onload=function(){ try{ ctx.drawImage(im0,0,0,cv.width,cv.height); }catch(e){} }; im0.src=saved; drew=true; }
    function pos(e){ var r=cv.getBoundingClientRect(), t=(e.touches&&e.touches[0])||e; return { x:(t.clientX-r.left)*(cv.width/r.width), y:(t.clientY-r.top)*(cv.height/r.height) }; }
    function down(e){ e.preventDefault(); drawing=true; drew=true; upImg=""; var p=pos(e); px=p.x; py=p.y; }
    function move(e){ if(!drawing)return; e.preventDefault(); var p=pos(e); ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(p.x,p.y); ctx.stroke(); px=p.x; py=p.y; }
    function up(){ drawing=false; }
    cv.addEventListener("mousedown",down); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
    cv.addEventListener("touchstart",down,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",up);
    ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); });
    ov.querySelector("#rxSignClear").addEventListener("click", function(){ ctx.clearRect(0,0,cv.width,cv.height); drew=false; upImg=""; });
    ov.querySelector("#rxSignUp").addEventListener("change", function(){ var f=this.files&&this.files[0]; if(f) rxImgToDataURL(f,600,function(d){ upImg=d; drew=true; var im=new Image(); im.onload=function(){ ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(im,0,0,cv.width,cv.height); }; im.src=d; }); });
    ov.querySelector("#rxSignUse").addEventListener("click", function(){ if(!drew){ rxToast("Please sign or upload first"); return; } var data=upImg||cv.toDataURL("image/png"); setSign(ov.querySelector("#rxSignSave").checked?data:""); ov.remove(); if(onDone) onDone(data); });
  }
  // StewardMD logo → data-URL once (via Image→canvas, so it renders reliably inside html2canvas,
  // on web AND native, with no image-load timing race). Falls back to a text wordmark until ready.
  var _smdLogoData = "";
  (function preloadSmdLogo(){ try{ var img=new Image(); img.onload=function(){ try{ var c=document.createElement("canvas"); c.width=img.naturalWidth||368; c.height=img.naturalHeight||368; c.getContext("2d").drawImage(img,0,0); _smdLogoData=c.toDataURL("image/png"); }catch(e){} }; img.src="/logo.png"; }catch(e){} })();
  // ---- Professional Rx document + PDF/JPEG export ----
  function rxDoc(topic, regNo, signImg){
    var d=collectRx(), c=getClinic(), date=""; try{ date=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){}
    var n=0;
    var rows=d.lines.map(function(L){ if(L.advice) return '<tr class="advr"><td></td><td colspan="2">• '+esc(L.text)+'</td></tr>'; n++; var sub=[L.dose,L.freq,L.duration].filter(Boolean).join(" · "); return '<tr><td class="sn">'+n+'</td><td class="dg"><b>'+esc(L.drug)+'</b>'+(L.brand?' <span class="br">('+esc(L.brand)+')</span>':'')+'</td><td class="dz">'+esc(sub)+'</td></tr>'; }).join("");
    var node=document.createElement("div"); node.className="rx-doc";
    node.innerHTML='<div class="rxdoc-in"><div class="rxdoc-hd">'+(c.logo?'<img class="rxdoc-logo" src="'+esc(c.logo)+'">':'')+
      '<div class="rxdoc-cl"><div class="rxdoc-nm">'+esc(c.name||docName()||"Prescription")+'</div>'+(c.address?'<div class="rxdoc-ad">'+esc(c.address)+'</div>':'')+(c.phone?'<div class="rxdoc-ad">Ph: '+esc(c.phone)+'</div>':'')+'</div></div>'+
      '<div class="rxdoc-rule"></div><div class="rxdoc-pt"><span>'+(d.name?'<b>'+esc(d.name)+'</b>':'')+(d.age?' &nbsp; '+esc(d.age):'')+'</span><span class="rxdoc-dt">'+esc(date)+'</span></div>'+
      (d.complaints?'<div class="rxdoc-line"><b>Complaints:</b> '+esc(d.complaints)+'</div>':'')+
      (d.vitals?'<div class="rxdoc-line"><b>Vitals:</b> '+esc(d.vitals)+'</div>':'')+
      ((d.dx||topic)?'<div class="rxdoc-line"><b>Diagnosis:</b> '+esc(d.dx||topic)+'</div>':'')+
      '<div class="rxdoc-rx">℞</div>'+
      '<table class="rxdoc-tbl">'+(rows||'<tr><td colspan="3">No items.</td></tr>')+'</table>'+
      '<div class="rxdoc-ft"><div class="rxdoc-sg">'+(signImg?'<img class="rxdoc-sgimg" src="'+esc(signImg)+'">':'')+'<div class="rxdoc-drn">Dr. '+esc(docName()||"—")+'</div><div class="rxdoc-reg">Reg. No: '+esc(regNo||"—")+'</div></div></div>'+
      '<div class="rxdoc-foot"><div class="rxdoc-brand">'+(_smdLogoData?'<img class="rxdoc-smdlogo" src="'+_smdLogoData+'">':'<span class="rxdoc-smdwm">Steward<b>MD</b></span>')+'<span>Prescription generated using <b>StewardMD</b></span></div>'+
      '<div class="rxdoc-resp">Digitally <b>signed &amp; verified</b> by the prescriber named above, who takes <b>complete responsibility</b> for this prescription. Verify every drug, dose, route and interaction against the patient and local protocol before dispensing.</div></div></div>';
    return node;
  }
  function rxSaveOrShare(dataURL, filename){
    if(rxNative()){ var P=rxPlugins(); var b64=(dataURL.split(",")[1]||""); if(P.Filesystem&&P.Filesystem.writeFile&&P.Share&&P.Share.share){ P.Filesystem.writeFile({ path:filename, data:b64, directory:"CACHE" }).then(function(res){ return P.Share.share({ title:"Prescription", url:res.uri, dialogTitle:"Save or share prescription" }); }).catch(function(){ rxToast("Export failed"); }); return; } }
    try{ var a=document.createElement("a"); a.href=dataURL; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); }catch(e){ rxToast("Export failed"); }
  }
  function exportRx(kind, topic, regNo, signImg){
    if(!window.html2canvas){ rxToast("Export engine still loading — try again"); return; }
    var node=rxDoc(topic, regNo, signImg); node.style.cssText="position:fixed;left:-9999px;top:0;width:794px;background:#fff;z-index:-1"; document.body.appendChild(node);
    window.html2canvas(node, { scale:2, backgroundColor:"#ffffff", useCORS:true }).then(function(canvas){
      node.remove();
      if(kind==="jpeg"){ rxSaveOrShare(canvas.toDataURL("image/jpeg",0.95), "prescription.jpg"); return; }
      var JS=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF; if(!JS){ rxToast("PDF engine unavailable"); return; }
      var pdf=new JS({ unit:"pt", format:"a4" }), pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
      var imgW=pw, imgH=canvas.height*(pw/canvas.width), img=canvas.toDataURL("image/jpeg",0.95);
      if(imgH<=ph){ pdf.addImage(img,"JPEG",0,0,imgW,imgH); } else { var y=0; while(y<imgH-1){ pdf.addImage(img,"JPEG",0,-y,imgW,imgH); y+=ph; if(y<imgH-1) pdf.addPage(); } }
      rxSaveOrShare(pdf.output("datauristring"), "prescription.pdf");
    }).catch(function(){ try{ node.remove(); }catch(e){} rxToast("Couldn’t render the prescription"); });
  }
  function signAndExport(topic, regNo){
    function chooser(sig){ var ov=document.createElement("div"); ov.className="rx-bp-ov"; ov.innerHTML='<div class="rx-bp rx-exp"><div class="rx-bp-h"><b>Export prescription</b><button class="rx-bp-x">'+rxIco("close")+'</button></div><div class="rx-row" style="justify-content:center;margin-top:6px"><button class="rx-btn rx-print" id="rxExpPdf">'+rxIco("print")+' Save as PDF</button><button class="rx-btn rx-add" id="rxExpJpg">Save as JPEG</button></div></div>'; sheet.appendChild(ov); ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); }); ov.querySelector("#rxExpPdf").addEventListener("click", function(){ ov.remove(); exportRx("pdf",topic,regNo,sig); }); ov.querySelector("#rxExpJpg").addEventListener("click", function(){ ov.remove(); exportRx("jpeg",topic,regNo,sig); }); }
    var existing=getSign(); if(existing) chooser(existing); else openSignPad(function(sig){ chooser(sig); });
  }

  window.SMD_RX = { open: open, canPrescribe: canPrescribe, verifiedInfo: verifiedInfo, _getNmc: getNmc, _setNmc: setNmc, getClinic: getClinic, _parseVoiceRx: parseVoiceRx };
})();
