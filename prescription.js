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

  // Regimen from the grounded package: advice + de-duped drug names (doses filled by the core).
  function regimenFromCtx(ctx) {
    var reg = [{ name: "Lifestyle & general measures", isAdvice: true }];
    var drugs = [], t = ctx && ctx.pkg && ctx.pkg.treatment;
    if (t && t.default && t.default.drugRefs) drugs = drugs.concat(t.default.drugRefs);
    (t && t.alternatives || []).forEach(function (a) { drugs = drugs.concat(a.drugRefs || []); });
    if (ctx && ctx.pkg && ctx.pkg.refs && ctx.pkg.refs.drug) drugs = drugs.concat(ctx.pkg.refs.drug);
    var seen = {};
    drugs.forEach(function (d) {
      var nm = String(d || "").split(/[—,;(]/)[0].trim(); if (!nm) return;
      var k = nm.toLowerCase(); if (seen[k]) return; seen[k] = 1; reg.push({ name: nm });
    });
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
    });
    sheet.querySelector("#rxPrint").addEventListener("click", function () { try { window.print(); } catch (e) {} });
    bindDel();
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
