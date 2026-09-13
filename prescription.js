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
      /* Fields were 7px-tall hairline boxes with no focus state - the sheet read as a grey stack and nothing told you where the caret was. Taller touch target, softer radius, and a real focus ring so the active field is unmistakable on a phone held one-handed at the bedside. */
      ".rx-in{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:10px 12px;font:400 13.5px var(--hfont);background:var(--hpanel,#fff);color:var(--hink);transition:border-color .15s,box-shadow .15s}" +
      ".rx-in::placeholder{color:var(--hmut,#94a3b8)}" +
      ".rx-in:focus{outline:none;border-color:var(--teal,#0e6e63);box-shadow:0 0 0 3px color-mix(in srgb, var(--teal,#0e6e63) 18%, transparent)}" +
      ".rx-symbol{font:800 22px var(--hfont);margin:6px 0 2px}" +
      ".rx-line{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:9px;margin:8px 0}.rx-line.unv{border-color:#f59e0b;background:rgba(245,158,11,.06)}.rx-line.adv{background:rgba(100,116,139,.06)}" +
      ".rx-line .r1{display:flex;gap:6px;flex-wrap:wrap}.rx-line .r1 input{}.rx-drug{flex:2 1 160px}.rx-brand{flex:1 1 110px}.rx-line .r2{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.rx-dose{flex:2 1 160px}.rx-freq{flex:1 1 90px}.rx-dur{flex:1 1 90px}" +
      ".rx-flag{font:700 10.5px var(--hfont);color:#b45309;margin-top:5px}.rx-del{border:0;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;align-self:center}" +
      ".rx-ac{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;margin-top:6px;background:var(--hpanel,#fff);max-height:240px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      ".rx-ac-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--hbd,#eef1f4);background:none;padding:8px 10px;cursor:pointer;font:500 13px var(--hfont);color:var(--hink,#14202b)}.rx-ac-item:last-child{border-bottom:0}.rx-ac-item:hover,.rx-ac-item.on{background:var(--paper,#f6f7f5)}" +
      ".rx-ac-g{font-weight:800}.rx-ac-b{color:var(--teal,#0e6e63);font-weight:600}.rx-ac-d{display:block;color:var(--hmut,#64748b);font-size:11.5px;margin-top:2px}.rx-ac-empty{padding:8px 10px;color:var(--hmut,#64748b);font:500 12px var(--hfont)}" +
      ".rx-btn{border:0;border-radius:999px;padding:9px 16px;font:800 13px var(--hfont);cursor:pointer}.rx-add{background:rgba(100,116,139,.12);color:var(--hink)}.rx-print{background:var(--teal,#0e6e63);color:#fff}.rx-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.rx-ico{width:14px;height:14px;vertical-align:-2px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.rx-x .rx-ico,.rx-del .rx-ico{width:16px;height:16px}.rx-print .rx-ico{margin-right:5px}" +
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
      ".rxcsec{margin-top:22px;padding-top:14px;border-top:2px solid #0e6e63;page-break-inside:avoid;break-inside:avoid}" +
      ".rxcsec h3{font:800 13px system-ui,Georgia,serif;letter-spacing:.08em;text-transform:uppercase;color:#0e6e63;margin:0 0 3px}" +
      ".rxcttl{font:700 15px Georgia,serif;color:#0f172a;margin-bottom:2px}.rxcsub{font:500 11px system-ui,sans-serif;color:#64748b;margin-bottom:10px}" +
      ".rxc-tbl{width:100%;border-collapse:collapse;margin-top:10px;font-family:system-ui,-apple-system,sans-serif;page-break-inside:avoid;break-inside:avoid}" +
      ".rxc-tbl th{background:#f8fafc;padding:7px 8px;font:700 11px system-ui;text-transform:uppercase;letter-spacing:.05em;border:1px solid #cbd5e1;text-align:left;vertical-align:bottom}" +
      ".rxc-th-gen{border-top:3px solid #16a34a!important}.rxc-th-bal{border-top:3px solid #0052cc!important;background:#f0f7ff!important}.rxc-th-prem{border-top:3px solid #7e22ce!important}.rxc-th-orig{border-top:3px solid #475569!important}" +
      ".rxc-tbl td{padding:8px;border:1px solid #e2e8f0;vertical-align:top;font-size:12px;background:#fff}.rxc-td-bal{background:#fbfdff!important}" +
      ".rxc-chosen{box-shadow:inset 0 0 0 1.5px #16a34a;background:#f0fdf4!important}.rxc-badge-chosen{display:inline-block;padding:1px 5px;border-radius:4px;font:800 9px system-ui;background:#16a34a;color:#fff;margin-bottom:3px;letter-spacing:.04em}" +
      ".rxc-tbl-cost{font:800 13px system-ui;color:#0e6e63;margin-top:4px}.rxc-tbl-mfg{color:#64748b;font-size:10.5px}.rxc-tbl-rx{color:#64748b;font-size:11px;margin-top:2px}" +
      ".rxc-tot-val{font:800 13px system-ui;color:#0f172a}.rxc-banner-save{margin-top:8px;padding:8px 12px;border-radius:6px;background:rgba(22,163,74,.1);border-left:3px solid #16a34a;font:700 12px system-ui;color:#15803d}" +
      ".rxcnote{margin-top:10px;font:500 10.5px/1.45 system-ui,Georgia,serif;color:#64748b}" +
      ".rxc-inline-box{width:100%;order:99}" +
      ".rxc-inline-tray{margin-top:8px;border-top:1px dashed var(--hbd,#e2e8f0);padding-top:8px;width:100%;font-family:var(--hfont,system-ui)}" +
      ".rxc-itray-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}" +
      ".rxc-itray-pill{font:800 10.5px var(--hfont);color:var(--teal,#0e6e63);background:rgba(14,110,99,.09);padding:2px 8px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase}" +
      ".rxc-itray-sub{font:500 11px var(--hfont);color:var(--hmut,#64748b)}" +
      ".rxc-icards{display:grid;gap:6px;grid-template-columns:repeat(4,1fr)}" +
      "@media(max-width:640px){.rxc-icards{grid-template-columns:1fr 1fr}}" +
      ".rxc-icard{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:8px;background:var(--hpanel,#fff);display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;transition:all .15s ease}" +
      ".rxc-icard:hover{border-color:var(--teal,#0e6e63);box-shadow:0 2px 8px rgba(14,110,99,.08)}" +
      ".rxc-icard.rec{border:1.5px solid #0052cc;background:rgba(0,82,204,.03)}" +
      ".rxc-icard.sel{border-color:var(--teal,#0e6e63);box-shadow:0 0 0 2px rgba(14,110,99,.25);background:rgba(14,110,99,.04)}" +
      ".rxc-icard.orig{border-style:dashed}" +
      ".rxc-icat-pill{display:flex;align-items:center;gap:4px;font:800 9.5px var(--hfont);text-transform:uppercase;letter-spacing:.04em;color:#334155}" +
      ".rxc-idot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0}" +
      ".dot-generic{background:#16a34a}.dot-balanced{background:#0052cc}.dot-premium{background:#7e22ce}.dot-prescribed{background:#475569}" +
      ".rxc-icomp{font:500 10px var(--hfont);color:var(--hmut,#64748b);margin-top:3px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rxc-ibrand{font:700 12px var(--hfont);margin-top:2px;line-height:1.25}" +
      ".rxc-icard.generic .rxc-ibrand{color:#16a34a}.rxc-icard.balanced .rxc-ibrand{color:#0052cc}.rxc-icard.premium .rxc-ibrand{color:#7e22ce}.rxc-icard.prescribed .rxc-ibrand{color:var(--hink,#0f172a)}" +
      ".rxc-imfg{font:500 10px var(--hfont);color:var(--hmut,#64748b);margin-top:1px;min-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rxc-iprice{font:800 12.5px var(--hfont);color:var(--teal,#0e6e63);margin-top:4px}" +
      ".rxc-iprice small{font:500 9.5px var(--hfont);color:var(--hmut,#64748b);margin-left:2px;font-weight:normal}" +
      ".rxc-ibtn{margin-top:6px;border:0;border-radius:6px;padding:4px 6px;font:700 10.5px var(--hfont);cursor:pointer;text-align:center;background:rgba(100,116,139,.12);color:var(--hink,#0f172a);transition:background .15s}" +
      ".rxc-icard.sel .rxc-ibtn{background:var(--teal,#0e6e63);color:#fff}" +
      ".rxc-icard.rec:not(.sel) .rxc-ibtn{background:rgba(0,82,204,.1);color:#0052cc}" +
      ".rxc-inote{font:500 11px/1.4 var(--hfont);color:var(--hmut,#64748b);background:rgba(245,158,11,.1);padding:6px 8px;border-radius:8px;margin-top:4px}" +
      "@media print{body>*{display:none!important}body>.rx-scrim,body>.rx-sheet{display:block!important;position:static!important;transform:none!important;box-shadow:none!important;opacity:1!important;max-height:none!important;width:auto!important}.rx-scrim{background:none!important}.rx-x,.rx-del,.rx-add,.rx-print,.rx-row{display:none!important}.rx-in{border:none!important;padding:0!important;background:none!important}.rx-line{border:1px solid #ccc!important;background:none!important}}";
    document.head.appendChild(s);
  }

  var scrim, sheet;
  function ensureEls() {
    injectCSS();
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "rx-scrim"; scrim.id = "rxScrim"; document.body.appendChild(scrim); scrim.addEventListener("click", close); }
    if (!sheet) { sheet = document.createElement("div"); sheet.className = "rx-sheet"; sheet.id = "rxSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Prescription"); document.body.appendChild(sheet); }
  }
  /* Every field on this sheet is placeholder-only - no <label>, no aria-label. A placeholder
   * disappears the moment you type, so once the pad is half filled the doctor is looking at
   * unlabelled grey boxes, and a screen reader has nothing dependable to announce. Mirroring the
   * placeholder into aria-label closes that hole without adding visible chrome nobody asked for.
   * Done HERE because show() is the one funnel every screen of the pad renders through - drug rows,
   * the clinic form, the registration gate - so no field can be missed or later forgotten. The
   * trailing hint is trimmed: "Brand - tap for brands + prices" is a prompt; the label is "Brand". */
  function rxLabelInputs() {
    try {
      var els = sheet.querySelectorAll("input[placeholder]:not([aria-label])");
      for (var i = 0; i < els.length; i++) {
        var p = String(els[i].getAttribute("placeholder") || "");
        var lab = p.split(/\s+[—–-]\s+/)[0].split(" (")[0].trim();
        if (lab) els[i].setAttribute("aria-label", lab);
      }
    } catch (e) {}
  }
  function show(html) {
    ensureEls();
    sheet.innerHTML = '<div class="rx-wrap">' + html + '</div>';
    rxLabelInputs();
    scrim.classList.add("on"); sheet.classList.add("on");
  }
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
  /* The RxChoice section of the printout: a SEPARATE block under the conventional prescription,
   * which is unchanged above it. It lists the four options that were shown and names the product the
   * doctor finally selected, so the pharmacy and the patient can both see what was chosen and what
   * the alternatives were. Empty (and absent from the page) when RxChoice was never opened or the
   * PDF flag is off. */
  function rxcPrintSection() {
    var sel = sheet && sheet._rxChoice;
    if (!sel) return "";
    try { if (!(window.SMD_RXCHOICE_FLAGS && window.SMD_RXCHOICE_FLAGS.bool("smd_rxchoice_pdf"))) return ""; } catch (e) { return ""; }
    var costStr = function (c) { return (c != null && isFinite(c)) ? ("\u20b9" + (Math.round(c * 100) / 100).toLocaleString("en-IN")) : "—"; };

    // 4-Way Comparison Table when full results are available (Reference Image 3 & Final Plan §3)
    if (sel._allResults && sel._allResults.length) {
      var results = sel._allResults, lines = sel._allLines || [], selectedKeys = sel._allSelected || [];
      var tableRows = "";
      for (var i = 0; i < results.length; i++) {
        var r = results[i], line = lines[i] || {};
        if (!r) continue;
        var drugTitle = esc(line.drug || line.brand || ("Medicine " + (i + 1)));
        var rxDetails = [line.dose, line.freq, line.duration].filter(Boolean).map(esc).join(" &middot; ");
        var activeComp = (r.prescribed && r.prescribed.composition) ? esc(r.prescribed.composition) : "";
        var currentSelKey = selectedKeys[i] || "prescribed";

        var cell = function (opt, catKey) {
          if (!opt) {
            var msg = r.blocked ? ("Blocked: " + esc(r.reason || "NTI / device restriction")) : "No validated alternative";
            return '<td class="rxc-td rxc-empty">' + msg + '</td>';
          }
          var isChosen = (currentSelKey === catKey) || (sel[line.drug] && sel[line.drug].brand === opt.brand);
          var cls = "rxc-td" + (isChosen ? " rxc-chosen" : "");
          var tag = isChosen ? ('<div class="rxc-tag">' + (catKey === "prescribed" ? "KEPT" : "SELECTED") + '</div>') : "";
          var brandNm = '<b>' + esc(opt.brand || "—") + '</b>';
          var mfrNm = opt.manufacturer ? ('<div class="rxc-mfr">' + esc(opt.manufacturer) + '</div>') : '';
          var packInfo = (opt.packsRequired != null && opt.requiredUnits != null)
            ? ('<div class="rxc-pack">' + esc(opt.requiredUnits) + ' needed (' + (opt.packsRequired > 1 ? (opt.packsRequired + ' packs') : '1 pack') + ')</div>')
            : '';
          var priceVal = opt.courseCost != null ? ('<div class="rxc-cost">' + costStr(opt.courseCost) + '<small>/course</small></div>') : '<div class="rxc-cost">—</div>';
          return '<td class="' + cls + '">' + tag + brandNm + mfrNm + packInfo + priceVal + '</td>';
        };

        tableRows += '<tr class="rxc-tr">' +
          '<td class="rxc-td rxc-rxcol"><div class="rxc-num">' + (i + 1) + '. ' + drugTitle + '</div>' +
          (activeComp ? ('<div class="rxc-comp">' + activeComp + '</div>') : '') +
          (rxDetails ? ('<div class="rxc-dose">' + rxDetails + '</div>') : '') + '</td>' +
          cell(r.generic, "generic") +
          cell(r.balanced, "balanced") +
          cell(r.premium, "premium") +
          cell(r.prescribed, "prescribed") +
          '</tr>';
      }

      var totalsFoot = "";
      if (window.SMD_RXCHOICE && SMD_RXCHOICE.totals) {
        try {
          var validResults = results.filter(Boolean);
          var t = SMD_RXCHOICE.totals(validResults);
          if (t && t.prescribed != null) {
            totalsFoot = '<tr class="rxc-totrow">' +
              '<td class="rxc-totlab"><b>Estimated Total</b></td>' +
              '<td><b>' + costStr(t.generic) + '</b></td>' +
              '<td><b>' + costStr(t.balanced) + '</b></td>' +
              '<td><b>' + costStr(t.premium) + '</b></td>' +
              '<td><b>' + costStr(t.prescribed) + '</b></td>' +
              '</tr>';
            if (t.savings) {
              var sBal = t.savings.balanced, sGen = t.savings.generic;
              if (sBal != null && sBal > 0) {
                var pctB = Math.round((sBal / t.prescribed) * 100);
                totalsFoot += '<tr class="rxc-saverow"><td colspan="5"><b>Potential saving on Balanced: ' + costStr(sBal) + ' (' + pctB + '% less than original)</b></td></tr>';
              } else if (sGen != null && sGen > 0) {
                var pctG = Math.round((sGen / t.prescribed) * 100);
                totalsFoot += '<tr class="rxc-saverow"><td colspan="5"><b>Potential saving on Generic: ' + costStr(sGen) + ' (' + pctG + '% less than original)</b></td></tr>';
              }
            }
          }
        } catch (e) {}
      }

      return '<section class="rxcsec">' +
        '<div class="rxchd">' +
        '<div class="rxcttl">RxChoice™ — 4-Way Cost Choice</div>' +
        '<div class="rxcsub">Validated alternatives from the StewardMD Drug Database &middot; Same active ingredient &amp; strength</div>' +
        '</div>' +
        '<table class="rxctbl">' +
        '<thead><tr>' +
        '<th class="col-rx">Prescribed Medicine</th>' +
        '<th class="col-gen">GENERIC<br><small>Lowest Cost</small></th>' +
        '<th class="col-bal">BALANCED<br><small>Recommended Value</small></th>' +
        '<th class="col-prem">PREMIUM<br><small>Top Branded</small></th>' +
        '<th class="col-orig">DOCTOR PRESCRIBED<br><small>Original Choice</small></th>' +
        '</tr></thead>' +
        '<tbody>' + tableRows + '</tbody>' +
        (totalsFoot ? ('<tfoot>' + totalsFoot + '</tfoot>') : '') +
        '</table>' +
        '<div class="rxcnote">Costs are calculated from the Drug Database MRP and the pack size for the course you prescribed. MRP is a list price, not a pharmacy quote, and availability is not checked. A lower price is an economic choice, never a claim that one product is clinically better than another. Final product selection remains the prescriber\u2019s responsibility.</div>' +
        '</section>';
    }

    // Fallback simple list (preserves backward-compatibility if only selected single products exist)
    var keys = Object.keys(sel).filter(function (k) { return k && k.charAt(0) !== "_"; });
    if (!keys.length) return "";
    var cost = function (o) { return (o && o.courseCost != null) ? (" &middot; \u20b9" + o.courseCost + " for this course") : ""; };
    var rows = keys.map(function (k) {
      var o = sel[k]; if (!o) return "";
      var cat = o.category === "prescribed" ? "Doctor Prescribed" : (o.category.charAt(0).toUpperCase() + o.category.slice(1));
      return '<div class="rxcline"><b>' + esc(k) + '</b> &nbsp;<span class="rxccat">' + esc(cat) + '</span><br>' +
        'Prescribed therapy: ' + esc(o.composition || "") + '<br>' +
        'Final selected product: <b>' + esc(o.brand || "") + '</b>' + (o.manufacturer ? ' (' + esc(o.manufacturer) + ')' : '') + cost(o) + '</div>';
    }).join("");
    if (!rows) return "";
    return '<section class="rxcsec"><h3>RxChoice&trade;</h3>' + rows +
      '<div class="rxcnote">The therapy above is the doctor\u2019s. RxChoice lists products from the StewardMD Drug Database carrying that same therapy at different prices. A lower price is not a claim that a product is clinically better. Prices are list MRP for the prescribed course, not a pharmacy quote.</div></section>';
  }
  /* ---- Verifiable prescriptions (habit-forming drugs + antibiotics) --------------------------
   * A printed prescription is trivially forged: a name, a registration number and a drug list on
   * paper. For the two classes where that does the most harm, the sheet now carries an opaque code
   * and a QR pointing at stewardmd.in/verify/<code>, and the server holds the authoritative record
   * of WHO wrote WHICH drugs and until when.
   *
   * The record is minted server-side from the signed-in doctor's own verified token claims, never
   * from anything this file sends (functions/_rx_store.js), and it holds no patient data at all -
   * which is what lets the verify page be public. Note what is NOT posted below: no name, no age.
   *
   * FAIL-OPEN, DELIBERATELY. If the app is offline or the issue call fails, the prescription still
   * prints, just without a QR. A doctor at a bedside must never be unable to print because a network
   * is down, and an unverifiable prescription is exactly what exists today - so this can only ever
   * add assurance, never withhold a prescription.
   */
  function rxvOn() { try { return !!(window.SMD_RX_VALIDITY && window.SMD_PGLOG_QR); } catch (e) { return false; } }
  function rxIdToken() {
    try {
      var u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
      if (u && u.getIdToken) return u.getIdToken();
    } catch (e) {}
    return Promise.resolve("");
  }
  // Resolves to a record {code, validUntil, ...} when this prescription is in scope, else null.
  // Never rejects: every failure path prints an ordinary prescription.
  /* "Manoj Kumar" -> "M*** K***". Computed HERE, on the device, and only the mask is ever sent: the
   * server never receives the patient's name, so there is no name in transit and none at rest to
   * leak. A fixed three stars, never the real length - keeping the length (or alternate letters,
   * M*N*JK*M*R) hands back a skeleton a human reconstructs on sight, which is not a mask at all.
   *
   * What it is FOR: the pharmacist compares the initials against the ID in front of them, so a
   * stolen PDF presented by someone with different initials is refused. What it is NOT: proof of
   * identity. Initials collide constantly, so this catches the opportunistic case, not a targeted
   * one. It is also still personal data - pseudonymised, not anonymous - see the verify page.
   */
  function rxMaskName(name) {
    var parts = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean).slice(0, 4);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var first = parts[i].charAt(0);
      if (/[A-Za-z]/.test(first)) out.push(first.toUpperCase() + "***");
    }
    return out.join(" ");
  }

  function rxIssueVerification(lines, patientName) {
    if (!rxvOn()) return Promise.resolve(null);
    var drugs = (lines || []).filter(function (L) { return !L.advice && L.drug; }).map(function (L) {
      return { name: L.drug, dose: L.dose || "", freq: L.freq || "", duration: L.duration || "" };
    });
    var mask = rxMaskName(patientName);
    // No scope gate and no minimum drug count: EVERY prescription this app prints carries an ID and
    // a QR, a blank sheet included. The rules module still decides how LONG a prescription is valid
    // and still explains why one is worth checking - it just no longer decides whether a sheet gets
    // a code at all. A sheet with no code cannot be checked by anyone holding it.
    return rxIdToken().then(function (tok) {
      if (!tok) return null;                       // not signed in: print without a QR
      return fetch("/api/rx/issue", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ drugs: drugs, country: "IN", patientMask: mask })
      }).then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (d) { return (d && d.ok && d.issued) ? d : null; }).catch(function () { return null; });
  }
  // Why this sheet printed without a QR. rxIssueVerification collapses every failure to null, which
  // is right for printing but leaves the prescriber holding a sheet with no code and no reason - the
  // one case that reads as a bug when it is usually the scope rule working correctly. Names which it
  // was, and never blocks the print.
  function rxNoQrWhy() {
    if (!rxvOn()) return "";
    // Scope is no longer a reason - every prescription gets a code now - so the only two ways to
    // reach a bare sheet are being signed out or being unable to reach the server. Both are
    // actionable by the prescriber, which is the point of saying which one it was.
    try {
      var u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
      if (!u) return "Printed without a QR - sign in to give prescriptions a verification code.";
    } catch (e) {}
    return "Printed without a QR - the verification service could not be reached. The prescription is still valid.";
  }

  // The block printed on the sheet. No network at print time: the SVG is generated on device by the
  // same encoder the PG logbook prints with (pglog-qr.js), so this works on a ward with no signal.
  // The URL a phone camera opens. Absolute on purpose: a relative path resolves against nothing once
  // the sheet is paper. Shared, so the printed sheet and the exported PDF can never encode
  // different URLs for the same prescription.
  function rxVerifyUrl(code) { return "https://stewardmd.in/verify/" + String(code || "").replace(/[^0-9A-Za-z-]/g, ""); }
  /* The encoder sizes the SVG from its module count - a longer URL means more modules means a wider
   * drawing - and it ignores whatever box we put it in. At scale 3 it came out roughly twice the
   * 96px slot, overflowed, and painted straight over the code, the verify URL and the validity line
   * printed beside it. Pin the element to the box, stripping the encoder's own width/height so ours
   * is the only one, and keep the viewBox so it scales instead of cropping. */
  function rxQrSvg(rec, px) {
    var size = px || 96;
    try {
      var s = SMD_PGLOG_QR.toSvg(rxVerifyUrl(rec.code), { scale: 3, label: "Verify prescription " + rec.code });
      return s.replace(/^<svg([^>]*)>/, function (m, attrs) {
        return '<svg' + String(attrs).replace(/\s(width|height)\s*=\s*"[^"]*"/g, "") +
          ' width="' + size + '" height="' + size + '"' +
          ' style="display:block;width:' + size + 'px;height:' + size + 'px">';
      });
    } catch (e) { return ""; }
  }
  function rxValidUntil(rec) {
    try { return rec.validUntil ? new Date(rec.validUntil).toISOString().slice(0, 10) : ""; } catch (e) { return ""; }
  }

  /* The same block for the EXPORTED sheet (Save as PDF / JPEG), which is a DIFFERENT document from
   * the printed one: rxDoc builds a DOM node that html2canvas rasterises, so it inherits none of
   * rxPrintHTML's <style> and every rule must be inline or it renders unstyled. Without this the
   * PDF carried no QR and no code at all, while its own footer still said "signed & verified".
   */
  /* Laid out as a TABLE, not flex. html2canvas rasterises this, and a flex row let the QR spill out
   * of its track and sit on top of the code and the URL. Two table cells cannot overlap: the text
   * column starts where the QR column ends, whatever the QR's natural size turns out to be.
   * `border-top:0` on the block is set by the caller when it is stamped on its own. */
  function rxDocQrBlock(rec, bare) {
    if (!rec || !rec.code) return "";
    var until = rxValidUntil(rec);
    return '<table style="width:100%;border-collapse:collapse;margin-top:' + (bare ? "0" : "14px") +
        ';padding-top:12px;border-top:' + (bare ? "0" : "1px solid #e2e8f0") + '"><tr>' +
      '<td style="width:104px;padding:8px 12px 0 0;vertical-align:top">' + rxQrSvg(rec, 96) + '</td>' +
      '<td style="padding:8px 0 0 0;vertical-align:top">' +
        '<div style="font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#0f172a;word-break:break-all">' + esc(rec.code) + '</div>' +
        '<div style="font-size:10.5px;color:#64748b;margin-top:3px">Scan to verify this prescription</div>' +
        '<div style="font-size:10.5px;color:#0e6e63;font-weight:700;margin-top:2px">stewardmd.in/verify</div>' +
        (until ? '<div style="font-size:10.5px;color:#64748b;margin-top:2px">Valid until ' + esc(until) + '</div>' : '') +
      '</td></tr></table>';
  }

  function rxQrBlock(rec) {
    if (!rec || !rec.code) return "";
    var svg = rxQrSvg(rec);
    var until = rxValidUntil(rec);
    return '<div class="rxv">' + svg +
      '<div class="rxv-m"><div class="rxv-c">' + esc(rec.code) + '</div>' +
      '<div class="rxv-l">Scan to verify this prescription</div>' +
      '<div class="rxv-u">stewardmd.in/verify</div>' +
      (until ? '<div class="rxv-l">Valid until ' + esc(until) + '</div>' : '') + '</div></div>';
  }

  /* ---- Verify a prescription, inside the app ------------------------------------------------
   * The QR on a printed sheet is scanned with an ordinary phone camera, which opens
   * stewardmd.in/verify/<code> — that path needs nothing from us. This is the other half: a doctor
   * or pharmacist ALREADY IN the app who has a code in front of them and wants to check it without
   * leaving for a browser.
   *
   * Reads the same public endpoint the web page does (/api/rx/v/<code>), so the two can never give
   * different answers. No sign-in: verification is public by design (functions/_rx_public.js), and
   * requiring a login here would make the in-app check useless to the pharmacist it is for. */
  function injectVerifyCSS() {
    if (document.getElementById("rxvCss")) return;
    var s = document.createElement("style"); s.id = "rxvCss";
    s.textContent =
      ".rxv-ov{position:fixed;inset:0;z-index:16200;background:rgba(15,23,42,.5);display:flex;align-items:flex-end;justify-content:center}" +
      ".rxv-sh{background:var(--hpanel,#fff);color:var(--hink,#0f172a);width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px 26px}" +
      ".rxv-h{display:flex;align-items:center;justify-content:space-between;font:800 16px var(--hfont);margin-bottom:2px}" +
      ".rxv-x{border:0;background:transparent;cursor:pointer;color:var(--hmut,#64748b);font-size:20px;line-height:1;padding:4px 6px}" +
      ".rxv-sub{font:600 12.5px var(--hfont);color:var(--hmut,#64748b);margin:0 0 12px}" +
      ".rxv-in{display:flex;gap:8px}" +
      ".rxv-in input{flex:1;min-width:0;padding:13px 13px;font:700 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;border:1px solid var(--hline,#e2e8f0);border-radius:12px;background:var(--hbg,#fff);color:inherit}" +
      ".rxv-go{padding:13px 18px;border:0;border-radius:12px;background:#0e6e63;color:#fff;font:800 14px var(--hfont);cursor:pointer}" +
      // Scan is the primary way in on a phone, so it is full-width and above the typed field.
      ".rxv-scan{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin:0 0 10px;padding:13px;border:0;border-radius:12px;background:#0e6e63;color:#fff;font:800 14.5px var(--hfont);cursor:pointer;transition:transform .12s}" +
      ".rxv-scan:active{transform:scale(.98)}.rxv-scan svg{width:19px;height:19px;stroke:currentColor;fill:none}" +
      ".rxv-scan:disabled{opacity:.6}" +
      ".rxv-go:disabled{opacity:.55}" +
      ".rxv-badge{border-radius:13px;padding:14px 15px;color:#fff;margin:14px 0 4px}" +
      ".rxv-badge b{display:block;font:800 17px var(--hfont)}.rxv-badge p{margin:6px 0 0;font:600 12.5px var(--hfont);opacity:.95}" +
      ".rxv-card{border:1px solid var(--hline,#e2e8f0);border-radius:13px;padding:2px 14px;margin-top:10px}" +
      ".rxv-r{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--hline,#eef2f1)}.rxv-r:last-child{border-bottom:0}" +
      ".rxv-k{flex:0 0 42%;font:600 12.5px var(--hfont);color:var(--hmut,#64748b)}.rxv-v{flex:1;font:700 13.5px var(--hfont);word-break:break-word}" +
      ".rxv-ok{color:#0f7a4a}.rxv-no{color:#9b1c1c}" +
      ".rxv-d{padding:10px 0;border-bottom:1px solid var(--hline,#eef2f1)}.rxv-d:last-child{border-bottom:0}" +
      ".rxv-d b{font:800 14px var(--hfont)}.rxv-d span{display:block;font:600 12px var(--hfont);color:var(--hmut,#64748b)}" +
      ".rxv-note{font:600 11.5px var(--hfont);color:var(--hmut,#64748b);margin-top:12px;line-height:1.5}";
    document.head.appendChild(s);
  }
  var RXV_TONE = {
    ACTIVE:   { bg: "#0f7a4a", t: "Valid prescription", s: "Issued by the prescriber below and still within its validity period." },
    EXPIRED:  { bg: "#8a5a00", t: "Expired", s: "Genuine, but past its validity date. Do not dispense against it." },
    REVOKED:  { bg: "#9b1c1c", t: "Withdrawn by the prescriber", s: "The prescriber withdrew this prescription. Do not dispense against it." },
    ARCHIVED: { bg: "#4a5568", t: "Archived", s: "Beyond its retention window and no longer active." },
    not_found:{ bg: "#4a5568", t: "Not found", s: "No prescription carries that code. Check the code, or treat the document as unverified." },
    malformed:{ bg: "#4a5568", t: "Not a valid code", s: "That is not a StewardMD prescription code." },
    rate_limited: { bg: "#4a5568", t: "Too many lookups", s: "Try again in a minute." },
    error:    { bg: "#4a5568", t: "Could not check", s: "No connection to the verification service. Try again when you are online." }
  };
  /* ---- Native QR scan (@capacitor/barcode-scanner) -------------------------------------------
   * The phone's own scanner UI: Google Play Services' code scanner on Android, the native
   * AVFoundation scanner on iOS. We deliberately do NOT ship a camera view of our own — the system
   * one is faster, already localised, already accessible, and on Android it needs no camera
   * permission at all because the scanning happens inside Play Services.
   *
   * Called through Capacitor.Plugins rather than an import: this app is buildless ES5, so the
   * package's ESM wrapper is not reachable. That wrapper is also where the option defaults are
   * applied, so every option it would have filled in is passed explicitly below — omitting them
   * sends undefined straight to the native layer.
   *
   * NATIVE-ONLY on purpose. The package's web fallback is a lazily-imported ESM module (html5-qrcode)
   * that cannot load in this context, so the button is hidden off-device and the typed code remains
   * the way in. Better a missing button than one that does nothing.
   */
  var RXV_HINT_QR = 0;        // Html5QrcodeSupportedFormats.QR_CODE
  var RXV_CAM_BACK = 1;       // CapacitorBarcodeScannerCameraDirection.BACK
  var RXV_ORIENT_ADAPTIVE = 3; // CapacitorBarcodeScannerScanOrientation.ADAPTIVE
  function rxvScanner() {
    try {
      var C = window.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      return (C.Plugins && C.Plugins.CapacitorBarcodeScanner) || null;
    } catch (e) { return null; }
  }
  function rxvScan() {
    var P = rxvScanner();
    if (!P || !P.scanBarcode) return Promise.reject(new Error("unavailable"));
    return P.scanBarcode({
      hint: RXV_HINT_QR,
      scanInstructions: "Point the camera at the QR on the prescription",
      scanButton: false,
      scanText: " ",
      cameraDirection: RXV_CAM_BACK,
      scanOrientation: RXV_ORIENT_ADAPTIVE,
      cancelButtonAccessibilityLabel: "Cancel scanning",
      torchButtonOnAccessibilityLabel: "Turn the torch off",
      torchButtonOffAccessibilityLabel: "Turn the torch on"
    }).then(function (r) { return (r && r.ScanResult) || ""; });
  }
  // A scanned QR carries the full verify URL; a human might paste just the code. Accept both, and
  // ignore anything after the code (a query string, a trailing slash) rather than failing the lookup.
  function rxvCodeFrom(text) {
    var t = String(text || "").trim();
    var m = t.match(/\/verify\/([^/?#\s]+)/i);
    return m ? m[1] : t;
  }
  function rxvDay(ms) { try { return ms ? new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""; } catch (e) { return ""; } }
  function rxvRow(k, v) { return v || v === 0 ? '<div class="rxv-r"><div class="rxv-k">' + esc(k) + '</div><div class="rxv-v">' + esc(v) + "</div></div>" : ""; }
  function rxvResultHTML(d) {
    var tone = RXV_TONE[(d && d.status) || "error"] || RXV_TONE.error;
    var out = '<div class="rxv-badge" style="background:' + tone.bg + '"><b>' + esc(tone.t) + "</b><p>" +
      esc(d && d.revokedReason ? tone.s + " Reason: " + d.revokedReason : tone.s) + "</p></div>";
    if (!d || !d.ok) return out;
    var doc = d.doctor || {};
    out += '<div class="rxv-card">' + rxvRow("Code", d.code) + rxvRow("Issued", rxvDay(d.issuedAt)) +
      rxvRow("Valid until", rxvDay(d.validUntil)) + rxvRow("Schedule", d.schedule) +
      (d.refillsAllowed != null ? rxvRow("Refills allowed", String(d.refillsAllowed)) : "") + "</div>";
    out += '<div class="rxv-card">' + rxvRow("Prescriber", doc.name || "(not recorded)") +
      rxvRow("Registration no.", doc.regNo || "(not recorded)") +
      '<div class="rxv-r"><div class="rxv-k">Registration verified</div><div class="rxv-v ' +
      (doc.verified ? "rxv-ok" : "rxv-no") + '">' + (doc.verified ? "Verified by StewardMD" : "NOT verified") + "</div></div></div>";
    var drugs = [].concat(d.drugs || []);
    out += '<div class="rxv-card">' + drugs.map(function (x) {
      var sub = [x.dose, x.freq, x.duration].filter(Boolean).join(" · ");
      return '<div class="rxv-d"><b>' + esc(x.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>";
    }).join("") + "</div>";
    out += '<p class="rxv-note">Compare this list against the paper in your hand. If they differ, the document has been altered. No patient information is stored on a verification record.</p>';
    return out;
  }
  function openVerify(prefill) {
    injectCSS(); injectVerifyCSS();
    var ov = document.createElement("div"); ov.className = "rxv-ov";
    ov.innerHTML = '<div class="rxv-sh" role="dialog" aria-modal="true" aria-label="Verify a prescription">' +
      '<div class="rxv-h"><span>Verify a prescription</span><button class="rxv-x" aria-label="Close">&times;</button></div>' +
      '<p class="rxv-sub">' + (rxvScanner() ? "Scan the QR on the prescription, or type the code printed beside it." : "Type the code printed on the prescription.") + "</p>" +
      (rxvScanner() ? '<button class="rxv-scan" id="rxvScan">' + rxIco("camera") + " Scan QR code</button>" : "") +
      '<div class="rxv-in"><input id="rxvCode" inputmode="latin" autocapitalize="characters" spellcheck="false" ' +
        'placeholder="XXXX-XXXX-XXXX-XXXX" aria-label="Prescription code" value="' + esc(prefill || "") + '">' +
      '<button class="rxv-go" id="rxvGo">Check</button></div>' +
      '<div id="rxvOut"></div>' +
      '<p class="rxv-note">Only prescriptions containing a habit-forming drug or an antibiotic carry a code.</p></div>';
    document.body.appendChild(ov);
    var close = function () { try { ov.remove(); } catch (e) {} };
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector(".rxv-x").addEventListener("click", close);
    var inp = ov.querySelector("#rxvCode"), go = ov.querySelector("#rxvGo"), out = ov.querySelector("#rxvOut");
    function run() {
      var raw = (inp.value || "").trim();
      var code = window.SMD_RX_VALIDITY ? SMD_RX_VALIDITY.normalizeCode(raw) : raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      if (!code || code.length < 12) { out.innerHTML = rxvResultHTML({ status: "malformed" }); return; }
      go.disabled = true; out.innerHTML = '<p class="rxv-note">Checking…</p>';
      fetch("/api/rx/v/" + encodeURIComponent(code))
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) { out.innerHTML = rxvResultHTML(d); })
        .catch(function () { out.innerHTML = rxvResultHTML({ status: "error" }); })
        .then(function () { go.disabled = false; });
    }
    go.addEventListener("click", run);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
    var scanBtn = ov.querySelector("#rxvScan");
    if (scanBtn) scanBtn.addEventListener("click", function () {
      scanBtn.disabled = true;
      rxvScan().then(function (text) {
        var code = rxvCodeFrom(text);
        if (!code) return;
        inp.value = code;
        run();                                   // scanned = checked; no second tap to confirm
      }, function () {
        /* Cancelling is the common case and must not look like a failure, but a denied camera would
         * otherwise be silent - so one neutral line covers both and points at the way that works. */
        out.innerHTML = '<p class="rxv-note">Scan cancelled, or the camera is unavailable. Type the code printed on the prescription instead.</p>';
      }).then(function () { scanBtn.disabled = false; });
    });
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    if (prefill) run();
  }

  function rxPrintHTML(topic, regNo, rxv) {
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
      '.rxcsec{margin-top:22px;padding-top:14px;border-top:2px solid #0e6e63;page-break-inside:avoid;break-inside:avoid}' +
      '.rxchd{margin-bottom:8px}.rxcttl{font:800 14px Manrope,Inter,system-ui;color:#0e6e63;letter-spacing:.02em;text-transform:uppercase}.rxcsub{font:500 10.5px system-ui;color:#64748b;margin-top:2px}' +
      '.rxctbl{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}' +
      '.rxctbl th{padding:6px 7px;font:700 10px Inter,system-ui;text-transform:uppercase;letter-spacing:.04em;border:1px solid #e2e8f0;background:#f8fafc;vertical-align:top;text-align:left}' +
      '.rxctbl th small{font-weight:500;text-transform:none;opacity:.8;display:block}' +
      '.rxctbl th.col-rx{width:26%;border-top:3px solid #0f172a}' +
      '.rxctbl th.col-gen{width:18.5%;color:#16a34a;border-top:3px solid #16a34a;background:#f0fdf4}' +
      '.rxctbl th.col-bal{width:18.5%;color:#0052cc;border-top:3px solid #0052cc;background:#f0f7ff}' +
      '.rxctbl th.col-prem{width:18.5%;color:#7e22ce;border-top:3px solid #7e22ce;background:#faf5ff}' +
      '.rxctbl th.col-orig{width:18.5%;color:#475569;border-top:3px solid #475569;background:#f8fafc}' +
      '.rxctbl td{padding:5px 7px;border:1px solid #e2e8f0;vertical-align:top;font-size:10.5px;line-height:1.35}' +
      '.rxctbl td.rxc-rxcol{background:#fafaf9}.rxctbl .rxc-num{font-weight:700;color:#0f172a}.rxctbl .rxc-comp{color:#64748b;font-size:9.5px;margin-top:1px}.rxctbl .rxc-dose{color:#0e6e63;font-size:9.5px;font-weight:600;margin-top:2px}' +
      '.rxctbl .rxc-mfr{color:#64748b;font-size:9.5px;margin-top:1px}' +
      '.rxctbl .rxc-pack{color:#475569;font-size:9px;margin-top:2px}' +
      '.rxctbl .rxc-cost{font:800 11.5px Inter,system-ui;color:#0e6e63;margin-top:3px}.rxctbl .rxc-cost small{font-size:9px;font-weight:600;color:#64748b}' +
      '.rxctbl td.rxc-chosen{background:#ecfdf5;box-shadow:inset 0 0 0 1.5px #10b981}' +
      '.rxctbl .rxc-tag{display:inline-block;padding:1px 4px;border-radius:3px;font:800 8px Inter,system-ui;background:#10b981;color:#fff;margin-bottom:3px;letter-spacing:.02em}' +
      '.rxctbl td.rxc-empty{color:#94a3b8;font-style:italic;font-size:9.5px}' +
      '.rxctbl .rxc-totrow td{background:#f8fafc;border-top:2px solid #cbd5e1;font-weight:700;padding:6px 7px}' +
      '.rxctbl .rxc-totlab{font:800 10.5px Inter,system-ui;text-transform:uppercase;color:#0f172a}' +
      '.rxctbl .rxc-saverow td{background:#f0fdf4;color:#16a34a;font:800 11px Inter,system-ui;text-align:right;padding:6px 8px;border-top:1px solid #bbf7d0}' +
      '.rxcline{font-size:12.5px;color:#334155;padding:5px 0;border-bottom:1px solid #f1f5f4}.rxccat{font-size:10.5px;font-weight:700;color:#0e6e63;text-transform:uppercase}' +
      '.rxcnote{margin-top:7px;font-size:10px;color:#64748b;line-height:1.4}' +
      // The verification block sits with the signature: a reader checking authenticity is already
      // looking at who signed it. Kept off the page break so the QR is never split in half.
      '.rxv{display:flex;gap:12px;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;break-inside:avoid;page-break-inside:avoid}' +
      '.rxv svg{width:96px;height:96px;flex:0 0 auto}' +
      '.rxv-c{font:700 14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#0f172a}' +
      '.rxv-l{font-size:11px;color:#64748b;margin-top:2px}.rxv-u{font-size:11px;color:#0e6e63;font-weight:700;margin-top:2px}' +
      '@media print{body{padding:0}@page{margin:16mm}}' +
      '</style></head><body>' +
      '<div class="hd"><span class="logo">Steward<b>MD</b></span><span class="tag">Prescription</span></div>' +
      '<div class="clinic">StewardMD' + (topic ? ' &middot; ' + esc(topic) : '') + '</div>' +
      ((d.name || d.age) ? '<div class="pt">' + esc(d.name) + (d.age ? '  &middot;  ' + esc(d.age) : '') + '</div>' : '') +
      '<div class="rxsym">&#8478;</div><main>' + (rows || '<div class="adv">No items.</div>') + '</main>' +
      rxcPrintSection() +
      '<div class="sign"><div class="nm">Dr. ' + esc(docName() || "—") + '</div><div class="mt">NMC Reg: ' + esc(regNo || "—") + '  &middot;  ' + esc(date) + '</div></div>' +
      rxQrBlock(rxv) +
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
    // Mint the verification record BEFORE rendering, so the code and its QR are on the sheet that
    // gets printed. rxIssueVerification never rejects and resolves to null when the prescription is
    // out of scope, when the doctor is not signed in, or when the network is down - in every one of
    // those cases the prescription still prints, just without a QR (see rxIssueVerification).
    var d = collectRx();
    rxIssueVerification(d && d.lines, d && d.name).then(function (rxv) {
      if (!rxv) { var why = rxNoQrWhy(d && d.lines); if (why) rxToast(why); }
      var html = rxPrintHTML(topic, regNo, rxv);
      if (rxNative()) { if (!rxNativePrint(html)) rxWebPrint(html); return; }
      if (!rxWebPrint(html)) rxNativePrint(html);
    });
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
    /* THE SAME DRUG DATABASE THE ICU TREATMENT SEARCH USES.
     *
     * This searched MEDDRUGS.searchIndex alone - the on-device ward formulary, ~70 drugs - so most
     * molecules simply "were not in the database" when typed here, while ICU's Add Treatment search
     * found them at once. Two search bars over two different datasets, inside one app.
     *
     * Same arrangement as icu.js txRemoteSearch, deliberately: the local formulary answers instantly
     * and is the only thing that works with no signal, and the server's hits (MEDAPI, the full
     * composition index) merge in when they arrive. Debounced, and a reply for a query the doctor
     * has already typed past is dropped rather than painted over what they are reading.
     */
    var remoteRows = [], remoteQ = "", remoteT = null;
    function remoteSearch(q, fromBrand) {
      if (q.length < 2 || !window.MEDAPI || !MEDAPI.searchCompositions) return;
      if (q === remoteQ) return;                        // already fetched or in flight for this query
      remoteQ = q;
      if (remoteT) { try { clearTimeout(remoteT); } catch (e) {} }
      remoteT = setTimeout(function () {
        remoteT = null;
        try {
          MEDAPI.searchCompositions(q, 8).then(function (d) {
            if (q !== remoteQ) return;                  // newer query typed - discard this reply
            remoteRows = ((d && d.results) || []).map(function (x) {
              // `brands` from the API is a COUNT, not a list, so it is kept as one and never handed
              // to fill() as though it were an array of brand names.
              return { generic: x.composition, brands: [], dose: "", cls: x["class"] || "",
                       brandCount: Number(x.brands) || 0, remote: true };
            });
            paintList(q, fromBrand);
          }, function () {});
        } catch (e) {}
      }, 220);
    }

    function search(q, fromBrand) {
      q = (q || "").trim();
      if (q.length < 2) { remoteRows = []; remoteQ = ""; closeAc(); return; }
      remoteSearch(q, fromBrand);
      paintList(q, fromBrand);
    }

    function paintList(q, fromBrand) {
      var local = (window.MEDDRUGS && MEDDRUGS.searchIndex) ? MEDDRUGS.searchIndex(q).slice(0, 8) : [];
      // Local first - it carries doses and real brand names - then server molecules the formulary
      // does not have. Deduped on the generic, so a drug never appears twice.
      var seen = {}, merged = [];
      local.forEach(function (r) { seen[String(r.generic || "").toLowerCase()] = 1; merged.push(r); });
      remoteRows.forEach(function (r) {
        var k = String(r.generic || "").toLowerCase();
        if (!k || seen[k] || merged.length >= 10) return;
        seen[k] = 1; merged.push(r);
      });
      rows = merged; active = -1;
      if (!rows.length) { closeAc(); return; }
      if (!ac) { ac = document.createElement("div"); ac.className = "rx-ac"; r1.insertAdjacentElement("afterend", ac); }
      ac.innerHTML = rows.map(function (r, i) {
        // A local row lists real brand names; a server row has only a count, so it says how many
        // rather than pretending to name them.
        var brands = (r.brands || []).slice(0, 3).join(", ");
        if (!brands && r.remote && r.brandCount) brands = r.brandCount + (r.brandCount === 1 ? " brand" : " brands");
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
    var typed = [], typedFor = "", typing = false, _deb = null;      // direct brand-name hits
    function closeB() { if (box) { box.remove(); box = null; } }
    function rowsHTML(list) {
      return list.slice(0, 50).map(function (b, i) { var meta = [b.manufacturer, b.form].filter(Boolean).join(" · "); return '<button type="button" class="rx-ac-item" data-i="' + i + '"><span class="rx-ac-g">' + esc(b.brand) + '</span>' + (b.mrp != null ? ' <span class="rx-ac-b">₹' + b.mrp + '</span>' : '') + (b.discontinued ? ' <span class="rx-ac-x">disc.</span>' : '') + (meta ? '<span class="rx-ac-d">' + esc(meta) + '</span>' : '') + '</button>'; }).join("");
    }
    function draw(msg) {
      if (!box) { box = document.createElement("div"); box.className = "rx-ac"; r1.insertAdjacentElement("afterend", box); }
      if (msg) { box.innerHTML = '<div class="rx-ac-empty">' + esc(msg) + '</div>'; return; }
      var q = (brandIn.value || "").trim().toLowerCase();
      /* Merge in brands matched BY NAME (rx-brand-match.js owns the rules, and is unit-tested).
       * Without this the field could only ever show brands of the molecule the drug field resolved
       * to, so typing a brand the clinician actually knows found nothing whenever the drug field
       * held a shorthand the composition index does not carry ("Amoxiclav" for Amoxycillin +
       * Clavulanic Acid) - while the Drugs Database, which queries BOTH endpoints, listed those same
       * brands instantly. Same backend, one missing query. */
      var B = window.SMD_RX_BRANDS;
      var merged = B ? B.merge(brands, typed, q) : brands;
      if (!merged.length) {
        var why = B ? B.emptyMessage(drugIn.value, q, loading || typing)
          : "Type the drug first, then tap here for brands";
        box.innerHTML = '<div class="rx-ac-empty">' + esc(why) + "</div>"; return;
      }
      box.innerHTML = rowsHTML(merged);
      Array.prototype.forEach.call(box.querySelectorAll(".rx-ac-item"), function (btn) { btn.addEventListener("mousedown", function (e) { e.preventDefault(); brandIn.value = merged[+btn.getAttribute("data-i")].brand; closeB(); }); });
    }
    /* Brand-name search, the same endpoint the Drugs Database pairs with the composition lookup. */
    function loadTyped(q) {
      q = String(q || "").trim();
      var B0 = window.SMD_RX_BRANDS;
      if (!(B0 ? B0.shouldSearchBrands(q) : q.length >= 3) || !window.MEDAPI || !MEDAPI.searchBrands) {
        // Clearing the field must clear the suggestions too, and REDRAW: without the redraw the
        // previous brand's hits stayed on screen under a drug they have nothing to do with.
        var had = typed.length; typed = []; typedFor = q; typing = false;
        if (had) draw();
        return;
      }
      if (q === typedFor) return;
      typing = true; typedFor = q;
      MEDAPI.searchBrands(q, 20).then(function (d) {
        if (String(brandIn.value || "").trim() !== q) return;    // a later keystroke superseded this
        typed = ((d && d.results) || []).filter(Boolean);
        typing = false; draw();
      }).catch(function () { typing = false; typed = []; draw(); });
    }
    /* `if (loading) return` used to DROP a newer drug while an older lookup was still in flight, and
     * loadedFor kept the stale value, so the field could sit on the wrong molecule's brands forever.
     * Requests now supersede: the newest drug wins and late replies for a drug the user has already
     * moved off are discarded. */
    function load(drug) {
      drug = (drug || "").trim(); if (!drug || !window.MEDAPI || !MEDAPI.searchCompositions) { draw(); return; }
      if (drug === loadedFor) { draw(); return; }
      var want = drug; loading = true; draw();
      var current = function () { return want === String(drugIn.value || "").trim(); };
      MEDAPI.searchCompositions(want, 6).then(function (d) {
        if (!current()) { loading = false; return; }
        var comp = ((d && d.results) || []).map(function (r) { return r.composition; }).filter(Boolean)[0];
        // No composition is NOT a dead end any more: the brand-name search can still answer.
        if (!comp) { loading = false; brands = []; loadedFor = want; draw(); return; }
        return MEDAPI.composition(comp, "price", "all", 60, 0).then(function (c) {
          if (!current()) { loading = false; return; }
          brands = (c && c.brands) || []; loadedFor = want; loading = false; draw();
        });
      }).catch(function () { loading = false; if (current()) { brands = []; loadedFor = want; draw(); } });
    }
    brandIn.addEventListener("focus", function () { load(drugIn.value); loadTyped(brandIn.value); });
    brandIn.addEventListener("input", function () {
      if ((drugIn.value || "").trim() !== loadedFor) load(drugIn.value);
      draw();
      clearTimeout(_deb); _deb = setTimeout(function () { loadTyped(brandIn.value); }, 220);
    });
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

  /* ── RxChoice™ (rxchoice-ui.js, flag smd_rxchoice) ───────────────────────────────────────────────
   * An opt-in layer ON TOP of this pad, opened only from the button below and only once the doctor
   * has written the prescription. It reads the finished lines, asks the StewardMD Drug Database for
   * products carrying the SAME therapy, and shows four ways to fill it (Generic / Balanced /
   * Premium / Doctor Prescribed). Selecting one writes the BRAND field of that line and nothing
   * else - the drug, dose, frequency and duration stay exactly as written, and the doctor's own
   * product is always on screen. With the flag off this whole block is inert: no button renders and
   * the pad behaves precisely as it did before RxChoice existed. */
  function rxcOn() { try { return !!(window.SMD_RXCHOICE_FLAGS && SMD_RXCHOICE_FLAGS.on() && window.SMD_RXCHOICE_UI && SMD_RXCHOICE_UI.available()); } catch (e) { return false; } }
  function openRxChoice() {
    if (!rxcOn()) return;
    var d = collectRx();
    var rows = [], map = [];
    var els = sheet ? sheet.querySelectorAll("#rxLines .rx-line") : [];
    Array.prototype.forEach.call(els, function (ln) {
      if (ln.style.display === "none" || ln.classList.contains("adv")) return;
      var g = ((ln.querySelector('[data-f="drug"]') || {}).value || "").trim();
      if (!g) return;
      rows.push({
        drug: g,
        brand: ((ln.querySelector('[data-f="brand"]') || {}).value || "").trim(),
        dose: ((ln.querySelector('[data-f="dose"]') || {}).value || "").trim(),
        freq: ((ln.querySelector('[data-f="freq"]') || {}).value || "").trim(),
        duration: ((ln.querySelector('[data-f="duration"]') || {}).value || "").trim()
      });
      map.push(ln);
    });
    SMD_RXCHOICE_UI.open({
      lines: rows,
      // The doctor tapped SELECT / KEEP. Write the brand field of THAT line, record the choice for
      // the printout, and leave everything else alone.
      onSelect: function (i, opt, line, res, st) {
        var ln = map[i]; if (!ln) return;
        var bi = ln.querySelector('[data-f="brand"]');
        if (bi && opt && opt.brand) { bi.value = opt.brand; try { bi.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {} }
        if (!sheet._rxChoice) sheet._rxChoice = {};
        sheet._rxChoice[(rows[i] && rows[i].drug) || ("line" + i)] = opt;
        if (st) {
          sheet._rxChoice._allResults = st.results;
          sheet._rxChoice._allLines = st.lines;
          sheet._rxChoice._allSelected = st.selected;
        }
      }
    });
  }

  function rxcInlineOn() {
    try {
      return rxcOn() && !!(window.SMD_RXCHOICE_FLAGS && SMD_RXCHOICE_FLAGS.bool("smd_rxchoice_inline"));
    } catch (e) {
      return false;
    }
  }

  function syncRxChoiceState() {
    if (!sheet) return;
    var els = sheet.querySelectorAll("#rxLines .rx-line:not(.adv)");
    var rows = [];
    Array.prototype.forEach.call(els, function (ln) {
      if (ln.style.display === "none") return;
      var g = ((ln.querySelector('[data-f="drug"]') || {}).value || "").trim();
      if (!g) return;
      rows.push({
        drug: g,
        brand: ((ln.querySelector('[data-f="brand"]') || {}).value || "").trim(),
        dose: ((ln.querySelector('[data-f="dose"]') || {}).value || "").trim(),
        freq: ((ln.querySelector('[data-f="freq"]') || {}).value || "").trim(),
        duration: ((ln.querySelector('[data-f="duration"]') || {}).value || "").trim()
      });
    });
    if (!sheet._rxChoice) sheet._rxChoice = {};
    sheet._rxChoice._allLines = rows;
    if (!sheet._rxChoice._allResults) sheet._rxChoice._allResults = [];
    if (!sheet._rxChoice._allSelected) sheet._rxChoice._allSelected = [];
  }

  function rxChoiceInline(line) {
    if (!line || line.classList.contains("adv") || line._rxcInlineWired) return;
    line._rxcInlineWired = true;
    if (!rxcInlineOn()) return;

    var debTimer = null;
    var box = null;

    function ensureBox() {
      if (!box) {
        box = line.querySelector(".rxc-inline-box");
        if (!box) {
          box = document.createElement("div");
          box.className = "rxc-inline-box";
          line.appendChild(box);
        }
      }
      return box;
    }

    function refresh() {
      if (!rxcInlineOn()) {
        if (box) { box.innerHTML = ""; }
        return;
      }
      var drugIn = line.querySelector('[data-f="drug"]'), brandIn = line.querySelector('[data-f="brand"]');
      var doseIn = line.querySelector('[data-f="dose"]'), freqIn = line.querySelector('[data-f="freq"]'), durIn = line.querySelector('[data-f="duration"]');
      var drug = String((drugIn && drugIn.value) || "").trim();
      var brand = String((brandIn && brandIn.value) || "").trim();
      var dose = String((doseIn && doseIn.value) || "").trim();
      var freq = String((freqIn && freqIn.value) || "").trim();
      var duration = String((durIn && durIn.value) || "").trim();

      if (!drug && !brand) {
        if (box) { box.innerHTML = ""; }
        return;
      }

      var b = ensureBox();
      var lineObj = { drug: drug, brand: brand, dose: dose, freq: freq, duration: duration };

      SMD_RXCHOICE_UI.resolveLine(lineObj).then(function (res) {
        if (!res) { if (b) b.innerHTML = ""; return; }
        var curDrug = String((drugIn && drugIn.value) || "").trim();
        var curBrand = String((brandIn && brandIn.value) || "").trim();
        if (curDrug !== drug || curBrand !== brand) return;

        function onPick(cat, opt, allRes) {
          if (!opt || !brandIn) return;
          brandIn.value = opt.brand;
          try { brandIn.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}

          if (!sheet._rxChoice) sheet._rxChoice = {};
          var lineKey = drug || ("line" + (line.getAttribute("data-i") || "0"));
          sheet._rxChoice[lineKey] = opt;

          SMD_RXCHOICE_UI.renderInlineTray(b, res, opt.brand, onPick);

          syncRxChoiceState();
          var lineIdx = 0;
          var els = sheet.querySelectorAll("#rxLines .rx-line:not(.adv)");
          for (var k = 0; k < els.length; k++) {
            if (els[k] === line) { lineIdx = k; break; }
          }
          sheet._rxChoice._allResults[lineIdx] = allRes;
          sheet._rxChoice._allSelected[lineIdx] = cat;

          try {
            if (window.toast) window.toast(cat === "prescribed" ? ("Kept " + opt.brand) : ("Brand set to " + opt.brand));
          } catch (e) {}
        }

        SMD_RXCHOICE_UI.renderInlineTray(b, res, curBrand, onPick);

        if (!sheet._rxChoice) sheet._rxChoice = {};
        var lineKey = drug || ("line" + (line.getAttribute("data-i") || "0"));
        if (!sheet._rxChoice[lineKey] && res.prescribed) {
          sheet._rxChoice[lineKey] = res.prescribed;
        }
        syncRxChoiceState();
        var lineIdx = 0;
        var els = sheet.querySelectorAll("#rxLines .rx-line:not(.adv)");
        for (var k = 0; k < els.length; k++) {
          if (els[k] === line) { lineIdx = k; break; }
        }
        sheet._rxChoice._allResults[lineIdx] = res;
        if (!sheet._rxChoice._allSelected[lineIdx]) {
          sheet._rxChoice._allSelected[lineIdx] = "prescribed";
        }
      }).catch(function () {
        if (b) b.innerHTML = "";
      });
    }

    line.addEventListener("input", function () {
      clearTimeout(debTimer);
      debTimer = setTimeout(refresh, 350);
    });

    var d0 = String(((line.querySelector('[data-f="drug"]') || {}).value) || "").trim();
    var b0 = String(((line.querySelector('[data-f="brand"]') || {}).value) || "").trim();
    if (d0 || b0) {
      setTimeout(refresh, 100);
    }
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
      rxLabelInputs();   // rows added after show() need labelling too
      var ln = wrap.lastElementChild; acAttach(ln); rxBrandAC(ln); rxChoiceInline(ln);
      var del = ln.querySelector(".rx-del"); if (del) del.onclick = function () { ln.remove(); refreshSafety(); };
    });
    refreshSafety();
  }

  // ---- Voice-to-Rx: parse a spoken line like "amox 500 TDS 5 days" into a drug row. Brand->generic via
  // the Drug Index; frequency abbreviations + duration recognized. Best-effort; the doctor edits after. ----
  var RX_FREQ = { od: "OD", "once daily": "OD", "once a day": "OD", bd: "BD", "twice daily": "BD", "twice a day": "BD", "two times": "BD", tds: "TDS", tid: "TDS", "thrice": "TDS", "three times": "TDS", qid: "QID", "four times": "QID", hs: "HS", "at night": "HS", "bed time": "HS", bedtime: "HS", sos: "SOS", "as needed": "SOS", prn: "SOS", stat: "STAT" };
  // Dictation error copy used to live here, for a bespoke SMD_VOICE.listen() path that reported
  // itself through a `title` tooltip nothing on a phone could show. That path is gone: Dictate now
  // opens the shared SMD_VOICE.openDialog sheet, which already carries the permission/model/engine
  // messages (and keeps them in ONE place instead of two drifting copies). See the #rxMic handler.
  function rxSay(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

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
    /* Opened with no regimen (the Hospital hub's Prescription tile, or any answer that carried no
     * drugs) the pad rendered no DRUG row at all, so the first thing a doctor had to do was hunt for
     * "+ Add drug" before they could type anything. Note the test is "no drug row", not "no rows":
     * regimenFromCtx() always seeds a "Lifestyle & general measures" ADVICE row, which has no drug or
     * brand input, so a length check alone never fires. An empty row collects as nothing until a drug
     * is typed, so Sign & Export still refuses an empty prescription. */
    lines = lines || [];
    var _hasDrugRow = false;
    for (var _li = 0; _li < lines.length; _li++) if (lines[_li] && !lines[_li].isAdvice) { _hasDrugRow = true; break; }
    if (!_hasDrugRow) lines = lines.concat([{ drug: "", brand: "", dose: "", freq: "", duration: "", unverified: false, isAdvice: false }]);
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
      '<div class="rx-row"><button class="rx-btn rx-add" id="rxAdd">+ Add drug</button><button class="rx-btn" id="rxMic" title="Dictate a drug, e.g. amox 500 TDS 5 days">'+rxIco("mic")+' Dictate</button><button class="rx-btn rx-print" id="rxExport">'+rxIco("print")+' Sign &amp; Export</button>' +
      (rxcOn() ? '<button class="rx-btn" id="rxcOpen" style="background:rgba(14,110,99,.12);color:var(--teal,#0e6e63)" title="Same prescription, smarter price">RxChoice™</button>' : "") + '</div>' +
      '<div class="rx-sign">Dr. ' + esc(docName() || "—") + '<br><small>Reg. No: ' + esc(regNo || "—") + ' · ' + esc(date) + '</small></div>';
    show(body);
    sheet.querySelector("#rxX").addEventListener("click", close);
    function wireClinic() { var a = sheet.querySelector("#rxClinicAdd"); if (a) a.onclick = function () { openClinicEditor(refreshClinic); }; var e = sheet.querySelector("#rxClinicEdit"); if (e) e.onclick = function () { openClinicEditor(refreshClinic); }; }
    function refreshClinic() { var s = sheet.querySelector("#rxClinicSlot"); if (s) { s.innerHTML = clinicSummaryHTML(); wireClinic(); } }
    wireClinic();
    sheet.querySelector("#rxAdd").addEventListener("click", function () {
      var wrap = sheet.querySelector("#rxLines"); var i = wrap.children.length;
      wrap.insertAdjacentHTML("beforeend", lineHTML({ drug: "", brand: "", dose: "", freq: "", duration: "", unverified: false, isAdvice: false }, i));
      rxLabelInputs();   // rows added after show() need labelling too
      bindDel();
      acAttach(wrap.lastElementChild); rxBrandAC(wrap.lastElementChild); rxChoiceInline(wrap.lastElementChild);   // drug AC + live brand picker + RxChoice inline
      refreshSafety();
    });
    sheet.querySelector("#rxExport").addEventListener("click", function () { try { signAndExport(topic, regNo); } catch (e) {} });
    var _rxc = sheet.querySelector("#rxcOpen"); if (_rxc) _rxc.addEventListener("click", function () { try { openRxChoice(); } catch (e) {} });
    bindDel();
    // Drug autocomplete (generic + DB dose, local) AND the live brand picker (MEDAPI brands + prices).
    sheet.querySelectorAll("#rxLines .rx-line").forEach(function (ln) { acAttach(ln); rxBrandAC(ln); rxChoiceInline(ln); });
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
    /* Dictate opens the SHARED dictation sheet (SMD_VOICE.openDialog) - the same one ICU, MaiK and
     * ThoreX already use. The old path called SMD_VOICE.listen() directly and reported progress by
     * writing to the button's `title`: a hover tooltip, invisible on a phone. `.rx-btn.on` had no CSS
     * rule at all, so the "on" class did nothing either. A doctor tapping Dictate therefore saw
     * NOTHING - no listening state, no transcript, no error. It could not have worked as written:
     * on native the clinical Whisper engine never fires onPartial (WhisperEngine.swift declares the
     * callback and never calls it), so the "live feedback" line was dead code.
     *
     * The shared sheet brings the recording animation, the elapsed timer and the model/permission
     * error copy, and - the part that matters most for a PRESCRIPTION - it shows the transcript and
     * lets the doctor CORRECT it before it is parsed into a drug row. */
    var _mic = sheet.querySelector("#rxMic");
    if (_mic) _mic.onclick = function () {
      var V = window.SMD_VOICE;
      if (!(V && V.openDialog)) { rxSay("Voice not available on this device"); return; }
      V.openDialog({
        target: "text",
        onText: function (txt) {
          var p = parseVoiceRx(txt);
          if (p && p.drug) { applyTemplate([p]); rxSay("Added: " + p.drug); return; }
          // Silence here was indistinguishable from a broken button. Say what was heard.
          var heard = String(txt || "").trim();
          rxSay(heard ? ('Could not read a drug from "' + heard.slice(0, 40) + '"') : "Nothing was heard - try again.");
        }
      });
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
  function rxDoc(topic, regNo, signImg, rxv){
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
      rxDocQrBlock(rxv) +
      rxcPrintSection() +
      '<div class="rxdoc-foot"><div class="rxdoc-brand">'+(_smdLogoData?'<img class="rxdoc-smdlogo" src="'+_smdLogoData+'">':'<span class="rxdoc-smdwm">Steward<b>MD</b></span>')+'<span>Prescription generated using <b>StewardMD</b></span></div>'+
      '<div class="rxdoc-resp">Digitally <b>signed &amp; verified</b> by the prescriber named above, who takes <b>complete responsibility</b> for this prescription. Verify every drug, dose, route and interaction against the patient and local protocol before dispensing.</div></div></div>';
    return node;
  }
  function rxSaveOrShare(dataURL, filename){
    if(rxNative()){ var P=rxPlugins(); var b64=(dataURL.split(",")[1]||""); if(P.Filesystem&&P.Filesystem.writeFile&&P.Share&&P.Share.share){ P.Filesystem.writeFile({ path:filename, data:b64, directory:"CACHE" }).then(function(res){ return P.Share.share({ title:"Prescription", url:res.uri, dialogTitle:"Save or share prescription" }); }).catch(function(){ rxToast("Export failed"); }); return; } }
    try{ var a=document.createElement("a"); a.href=dataURL; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); }catch(e){ rxToast("Export failed"); }
  }
  /* Mint BEFORE rendering, exactly as doRxPrint does - html2canvas rasterises whatever the node
   * holds at that instant, so a record arriving later would be a PDF with an empty box where the QR
   * should be. Same fail-open contract: rxIssueVerification never rejects, and an out-of-scope or
   * offline prescription still exports, just without a QR (and rxNoQrWhy says which). */
  function exportRx(kind, topic, regNo, signImg){
    var v1 = smdLazy('/vendor-html2canvas.js?v=1');
    var p = kind === "pdf" ? v1.then(function(){ return smdLazy('/vendor-jspdf.js?v=1'); }) : v1;
    p.then(function() {
      var d=collectRx()||{}, lines=d.lines;
      rxIssueVerification(lines, d.name).then(function(rxv){
        if(!rxv){ var why=rxNoQrWhy(lines); if(why) rxToast(why); }
        exportRxNow(kind, topic, regNo, signImg, rxv);
      });
    }).catch(function(){ rxToast("Export engine failed to load"); });
  }
  /* The QR block rasterised on its own, so it can be stamped in PDF units instead of being baked
   * into the page image. Two reasons, both of which bit a long prescription: a page break sliced
   * straight through the QR and left half of one on each page, and only the LAST page carried it at
   * all - so page 1 of a two-page prescription was unverifiable paper. */
  function rxQrStamp(rec){
    if(!rec || !rec.code || !window.html2canvas) return Promise.resolve(null);
    var n=document.createElement("div");
    n.style.cssText="position:fixed;left:-9999px;top:0;width:700px;background:#fff;z-index:-1";
    n.innerHTML=rxDocQrBlock(rec, true);
    document.body.appendChild(n);
    return window.html2canvas(n, { scale:2, backgroundColor:"#ffffff", useCORS:true }).then(function(c){
      n.remove();
      return { data:c.toDataURL("image/jpeg",0.95), ratio:(c.height/c.width) };
    }).catch(function(){ try{ n.remove(); }catch(e){} return null; });
  }

  function exportRxNow(kind, topic, regNo, signImg, rxv){
    // JPEG is a single image, so the block sits in the document. A PDF can run to several pages, so
    // it is left OUT of the document and stamped onto every page below.
    var node=rxDoc(topic, regNo, signImg, kind==="pdf" ? null : rxv);
    node.style.cssText="position:fixed;left:-9999px;top:0;width:794px;background:#fff;z-index:-1"; document.body.appendChild(node);
    window.html2canvas(node, { scale:2, backgroundColor:"#ffffff", useCORS:true }).then(function(canvas){
      node.remove();
      if(kind==="jpeg"){ rxSaveOrShare(canvas.toDataURL("image/jpeg",0.95), "prescription.jpg"); return; }
      var JS=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF; if(!JS){ rxToast("PDF engine unavailable"); return; }
      return rxQrStamp(rxv).then(function(stamp){
        var pdf=new JS({ unit:"pt", format:"a4" }), pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
        var imgW=pw, imgH=canvas.height*(pw/canvas.width), img=canvas.toDataURL("image/jpeg",0.95);
        var mg=24, stampW=stamp? (pw-mg*2) : 0, stampH=stamp? (stampW*stamp.ratio) : 0;
        // Content is paged against the height LEFT OVER once the footer band is reserved, so the
        // stamp never lands on top of a drug line.
        var band=stamp? (stampH+mg) : 0, usable=Math.max(120, ph-band), y=0, guard=0;
        while(guard++ < 60){
          pdf.addImage(img,"JPEG",0,-y,imgW,imgH);
          if(stamp){
            pdf.setFillColor(255,255,255);
            pdf.rect(0, ph-band, pw, band, "F");     // clear the band: the tall image paints through it
            pdf.addImage(stamp.data,"JPEG", mg, ph-stampH-(mg/2), stampW, stampH);
          }
          y+=usable;
          if(y >= imgH-1) break;
          pdf.addPage();
        }
        rxSaveOrShare(pdf.output("datauristring"), "prescription.pdf");
      });
    }).catch(function(){ try{ node.remove(); }catch(e){} rxToast("Couldn’t render the prescription"); });
  }
  function signAndExport(topic, regNo){
    function chooser(sig){ var ov=document.createElement("div"); ov.className="rx-bp-ov"; ov.innerHTML='<div class="rx-bp rx-exp"><div class="rx-bp-h"><b>Export prescription</b><button class="rx-bp-x">'+rxIco("close")+'</button></div><div class="rx-row" style="justify-content:center;margin-top:6px"><button class="rx-btn rx-print" id="rxExpPdf">'+rxIco("print")+' Save as PDF</button><button class="rx-btn rx-add" id="rxExpJpg">Save as JPEG</button></div></div>'; sheet.appendChild(ov); ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); }); ov.querySelector("#rxExpPdf").addEventListener("click", function(){ ov.remove(); exportRx("pdf",topic,regNo,sig); }); ov.querySelector("#rxExpJpg").addEventListener("click", function(){ ov.remove(); exportRx("jpeg",topic,regNo,sig); }); }
    var existing=getSign(); if(existing) chooser(existing); else openSignPad(function(sig){ chooser(sig); });
  }

  // openVerify is deliberately NOT gated on canPrescribe(): checking someone else's prescription is
  // not prescribing, and the pharmacist doing it may not be a prescriber at all.
  window.SMD_RX = { open: open, openVerify: openVerify, canPrescribe: canPrescribe, verifiedInfo: verifiedInfo, _getNmc: getNmc, _setNmc: setNmc, getClinic: getClinic, _parseVoiceRx: parseVoiceRx };

  /* Prime the verification cache at boot.
   * canPrescribe() is a SYNCHRONOUS read of _vcache, but ONLY verifiedInfo() fills it — and that
   * used to run just when the Rx pad opened. So any consumer asking earlier got a false negative
   * on a fully verified account: SURGX Notes' gate (surgx-entitlement.js notesAccess()) returned
   * "verify_required" and re-demanded verification from a doctor who was already verified
   * (user report + device-confirmed 2026-08-24: claim verified:true, /api/verify-doctor
   * "verified", yet canPrescribe() === false). Fixing it here rather than in each caller keeps
   * one source of truth. Fire-and-forget; failures leave the cache as-is (fail-closed). */
  (function primeVerified(n) {
    function prime() { try { verifiedInfo(); } catch (e) {} }
    var a = null;
    try { a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth()); } catch (e) {}
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(prime); }
    else if (n < 80) { setTimeout(function () { primeVerified(n + 1); }, 250); return; }
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) window.SMD_ACCOUNT.onChange(prime); } catch (e) {}
    prime();
  })(0);
})();
