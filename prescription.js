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
      ".rx-scrim{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:16000;opacity:0;transition:opacity .25s ease;pointer-events:none}.rx-scrim.on{opacity:1;pointer-events:auto}" +
      "html.rx-locked,body.rx-locked{overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;position:relative!important;width:100%!important;height:100%!important}" +
      ".rx-sheet{position:fixed;z-index:16001;background:var(--hpanel,#fff);color:var(--hink,#0f172a);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.28);transition:transform .28s cubic-bezier(0.16,1,0.3,1),opacity .2s ease;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',system-ui,sans-serif;-webkit-font-smoothing:antialiased;box-sizing:border-box;max-width:100vw!important}" +
      "@media(max-width:640px){.rx-sheet{left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100vw!important;max-width:100vw!important;height:94vh!important;max-height:94vh!important;border-radius:20px 20px 0 0!important;transform:translateY(100%);opacity:0;pointer-events:none;margin:0!important}.rx-sheet.on{transform:translateY(0)!important;opacity:1!important;pointer-events:auto!important}}" +
      "@media(min-width:641px){.rx-sheet{left:50%!important;top:50%!important;transform:translate(-50%,-46%)!important;width:min(700px,94vw)!important;height:88vh!important;max-height:88vh!important;border-radius:18px!important;opacity:0;pointer-events:none}.rx-sheet.on{transform:translate(-50%,-50%)!important;opacity:1!important;pointer-events:auto!important}}" +
      ".rx-wrap{display:flex;flex-direction:column;height:100%;width:100%;min-height:0;overflow:hidden;box-sizing:border-box}" +
      ".rx-head{flex:none;background:var(--hpanel,#fff);border-bottom:1px solid var(--hbd,#e2e8f0);padding:6px 12px 8px;display:flex;flex-direction:column;gap:4px;position:relative;z-index:2}" +
      ".rx-handle-bar{width:36px;height:4px;background:#cbd5e1;border-radius:999px;margin:2px auto 6px}@media(min-width:641px){.rx-handle-bar{display:none}}" +
      ".rx-head-inner{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}" +
      ".rx-head-title{flex:1;min-width:0;text-align:center}.rx-title-main{font-size:14.5px;font-weight:700;color:var(--hink,#0f172a);display:flex;align-items:center;justify-content:center;gap:6px;line-height:1.2}.rx-title-sub{font-size:11px;font-weight:500;color:var(--hmut,#64748b);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rx-saved-indicator{display:inline-flex;align-items:center;gap:3.5px;font-size:10px;font-weight:600;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:1px 6px;border-radius:999px}" +
      ".rx-saved-dot{width:5px;height:5px;border-radius:50%;background:#10b981;display:inline-block}" +
      ".rx-x{border:0;background:#f1f5f9;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;color:var(--hmut,#475569);flex:none;transition:all .15s ease}.rx-x:hover{background:#e2e8f0;color:#0f172a}" +
      ".rx-top-export{border:0;background:#0e6e63;color:#fff;font-size:11.5px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;flex:none;transition:all .15s ease}.rx-top-export:hover{background:#0b584f}" +
      ".rx-scroll-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden!important;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior-y:contain;padding:12px 14px 24px;box-sizing:border-box;width:100%!important}" +
      ".rx-disc{font:500 11px/1.4 var(--hfont,system-ui);color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:10px;padding:8px 12px;margin-bottom:12px;box-sizing:border-box}" +
      ".rx-pt-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:12px;box-sizing:border-box;width:100%}" +
      ".rx-pt-card-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:8px}" +
      ".rx-pt-row{margin-bottom:7px;width:100%;box-sizing:border-box}.rx-pt-row:last-child{margin-bottom:0}" +
      ".rx-pt-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:6px;width:100%;box-sizing:border-box}.rx-pt-grid input{min-width:0;width:100%;box-sizing:border-box}" +
      ".rx-in{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:8.5px 11px;font:400 13px var(--hfont,system-ui);background:var(--hpanel,#fff);color:var(--hink,#0f172a);transition:border-color .15s,box-shadow .15s;box-sizing:border-box;width:100%}" +
      ".rx-in::placeholder{color:var(--hmut,#94a3b8)}" +
      ".rx-in:focus{outline:none;border-color:var(--teal,#0e6e63);box-shadow:0 0 0 3px color-mix(in srgb, var(--teal,#0e6e63) 18%, transparent)}" +
      ".rx-sec-head{display:flex;align-items:center;gap:8px;margin:14px 0 8px}.rx-symbol{font:800 22px var(--hfont,system-ui);color:#0e6e63;line-height:1}.rx-sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b}" +
      ".rx-line{border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:10px 11px;margin:10px 0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.03);transition:border-color .15s,box-shadow .15s;box-sizing:border-box;width:100%!important;overflow:hidden}" +
      ".rx-line:focus-within{border-color:#cbd5e1;box-shadow:0 3px 10px rgba(0,0,0,.05)}.rx-line.unv{border-color:#f59e0b;background:#fffdfa}.rx-line.adv{background:#f8fafc}" +
      ".rx-line .r1{display:flex;gap:6px;align-items:center;width:100%;box-sizing:border-box}.rx-line .r1 .rx-drug{flex:1.6 1 140px;min-width:0;font-weight:600}.rx-line .r1 .rx-brand{flex:1.4 1 120px;min-width:0}" +
      ".rx-line .r2{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:6px;margin-top:8px;width:100%;box-sizing:border-box}.rx-line .r2 input{min-width:0;width:100%;box-sizing:border-box}" +
      "@media(max-width:500px){.rx-line .r1{display:grid;grid-template-columns:1fr auto;gap:6px}.rx-line .r1 .rx-drug{grid-column:1}.rx-line .r1 .rx-del{grid-column:2;grid-row:1}.rx-line .r1 .rx-brand{grid-column:1/span 2;grid-row:2}}" +
      ".rx-timing-tag{margin-top:6px;display:flex;align-items:center;gap:4px}" +
      ".rx-timing-chip{display:inline-flex;align-items:center;gap:3px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font:600 10px -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 7px;border-radius:5px;letter-spacing:.01em}" +
      ".rx-freq-pills{display:flex;align-items:center;gap:4px;margin-top:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.rx-freq-pills::-webkit-scrollbar{display:none}" +
      ".rx-freq-pill{border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font:600 10px -apple-system,BlinkMacSystemFont,sans-serif;padding:3px 8px;border-radius:6px;cursor:pointer;flex:none;transition:all .15s ease}" +
      ".rx-freq-pill:hover{background:#e2e8f0;color:#0f172a}" +
      ".rx-freq-pill.active{background:#0e6e63;border-color:#0e6e63;color:#fff}" +
      ".rx-switch-row{display:flex;align-items:center;justify-content:space-between;padding:3px 0;cursor:pointer;width:100%}" +
      ".rx-toggle{position:relative;display:inline-block;width:38px;height:22px;flex:none}" +
      ".rx-toggle input{opacity:0;width:0;height:0}" +
      ".rx-slider{position:absolute;cursor:pointer;inset:0;background-color:#cbd5e1;transition:.2s;border-radius:24px}" +
      ".rx-slider:before{position:absolute;content:'';height:16px;width:16px;left:3px;bottom:3px;background-color:#fff;transition:.2s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.2)}" +
      ".rx-toggle input:checked + .rx-slider{background-color:#0e6e63}" +
      ".rx-toggle input:checked + .rx-slider:before{transform:translateX(16px)}" +
      ".rx-toggle input:disabled + .rx-slider{opacity:0.4;cursor:not-allowed}" +
      ".rx-flag{font:700 10.5px var(--hfont);color:#b45309;margin-top:6px}.rx-del{border:0;background:#fee2e2;color:#ef4444;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;transition:all .15s ease}.rx-del:hover{background:#fecaca;color:#dc2626}" +
      ".rx-ac{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;margin-top:6px;background:var(--hpanel,#fff);max-height:240px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      ".rx-ac-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--hbd,#eef1f4);background:none;padding:8px 10px;cursor:pointer;font:500 13px var(--hfont);color:var(--hink,#14202b)}.rx-ac-item:last-child{border-bottom:0}.rx-ac-item:hover,.rx-ac-item.on{background:var(--paper,#f6f7f5)}" +
      ".rx-ac-g{font-weight:800}.rx-ac-b{color:var(--teal,#0e6e63);font-weight:600}.rx-ac-d{display:block;color:var(--hmut,#64748b);font-size:11.5px;margin-top:2px}.rx-ac-empty{padding:8px 10px;color:var(--hmut,#64748b);font:500 12px var(--hfont)}" +
      ".rx-tpl-card{margin:12px 0 6px;padding:9px 11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;box-sizing:border-box}" +
      ".rx-tpl-row{display:flex;gap:8px;align-items:center;width:100%;box-sizing:border-box}" +
      ".rx-tpl-sel{flex:1;min-width:0;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff;color:#0f172a}" +
      ".rx-tpl-btn{flex:none;white-space:nowrap;padding:7px 11px;font-size:11.5px;font-weight:600;border-radius:8px;background:#fff;border:1px solid #cbd5e1;color:#334155;cursor:pointer}.rx-tpl-btn:hover{background:#f1f5f9}" +
      ".rx-sign-bar{margin-top:14px;border-top:1px dashed #e2e8f0;padding-top:10px;display:flex;justify-content:space-between;align-items:baseline;font-size:12px;color:#64748b}.rx-sign-dr{font-weight:600;color:#0f172a}.rx-sign-meta{font-size:11px}" +
      ".rx-dock{flex:none;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;padding-bottom:max(12px,env(safe-area-inset-bottom,12px));background:rgba(255,255,255,.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid var(--hbd,#e2e8f0);box-sizing:border-box;width:100%;position:relative;z-index:2}" +
      ".rx-dock-quick{display:flex;align-items:center;gap:4.5px;flex:1 1 auto;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.rx-dock-quick::-webkit-scrollbar{display:none}" +
      ".rx-btn{border:0;border-radius:999px;padding:6px 9px;font:650 11.5px var(--hfont,system-ui);cursor:pointer;transition:all .15s ease;white-space:nowrap;display:inline-flex;align-items:center;gap:3.5px;flex:none}" +
      ".rx-add{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}.rx-add:hover{background:#e2e8f0}" +
      ".rx-mic{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}.rx-mic:hover{background:#e2e8f0}" +
      ".rx-rxc{background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd}.rx-rxc:hover{background:#bae6fd}" +
      ".rx-hero-export,.rx-print{background:var(--teal,#0e6e63)!important;color:#fff!important;font-size:11.5px!important;font-weight:700!important;padding:7px 11px!important;box-shadow:0 2px 8px rgba(14,110,99,.28)!important;flex:none;border-radius:999px}.rx-hero-export:hover{background:#0b584f!important}" +
      ".rx-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.rx-ico{width:14px;height:14px;vertical-align:-2px;display:inline-block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.rx-x .rx-ico,.rx-del .rx-ico{width:15px;height:15px}.rx-print .rx-ico{margin-right:4px}" +
      ".rx-sign{margin-top:14px;border-top:1px dashed var(--hbd,#e2e8f0);padding-top:10px;font:600 13px var(--hfont);color:var(--hink)}.rx-sign small{color:var(--hmut,#64748b);font-weight:500}" +
      ".rx-gate{font:500 13px var(--hfont);color:var(--hink)}.rx-gate input{margin-top:10px;width:100%}" +
      ".rx-clinic-card{display:flex;align-items:center;gap:10px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:9px 11px;margin-bottom:8px;background:var(--paper,#f8faf9)}.rx-clinic-logo{width:42px;height:42px;object-fit:contain;border-radius:8px;background:#fff}.rx-clinic-meta{flex:1;min-width:0}.rx-clinic-nm{font:800 14px var(--hfont);color:var(--hink)}.rx-clinic-ad{font:500 11.5px var(--hfont);color:var(--hmut,#64748b)}.rx-clinic-edit{border:0;background:transparent;color:var(--teal,#0e6e63);font:700 12px var(--hfont);cursor:pointer}" +
      ".rx-clinic-form{display:flex;flex-direction:column;gap:8px;margin-top:10px}.rx-clinic-form .rx-in{width:100%}.rx-logo-row{display:flex;align-items:center;gap:8px}.rx-logo-prev{width:54px;height:54px;border:1px dashed var(--hbd,#cbd5e1);border-radius:10px;display:flex;align-items:center;justify-content:center;font:600 10px var(--hfont);color:var(--hmut);overflow:hidden;flex:none}.rx-logo-prev img{width:100%;height:100%;object-fit:contain}" +
      ".rx-bp-ov{position:absolute;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;z-index:100;border-radius:16px;box-sizing:border-box;animation:rxFadeIn .18s ease-out}@media(max-width:640px){.rx-bp-ov{border-radius:20px 20px 0 0}}" +
      "@keyframes rxFadeIn{from{opacity:0}to{opacity:1}}" +
      ".rx-bp{background:var(--hpanel,#fff);width:100%;max-height:88%;overflow-y:auto;overflow-x:hidden;border-radius:20px 20px 0 0;padding:18px 20px 26px;box-sizing:border-box;box-shadow:0 -12px 36px rgba(0,0,0,.2)}" +
      ".rx-exp,.rx-sign-sheet{border-radius:20px 20px 0 0}.rx-bp-h{display:flex;align-items:center;justify-content:space-between;font:800 15px var(--hfont);color:var(--hink)}.rx-bp-x{border:0;background:#f1f5f9;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--hmut)}.rx-bp-sub{font:600 10.5px var(--hfont);color:var(--hmut);text-transform:uppercase;letter-spacing:.05em;margin:2px 0 8px}" +
      ".rx-exp-primary-btn{width:100%;padding:13px 18px!important;font-size:14px!important;justify-content:center!important;gap:10px!important;border-radius:12px!important;box-shadow:0 4px 14px rgba(14,110,99,.32)!important}" +
      ".rx-exp-sec-btn{width:100%;padding:11px 16px!important;font-size:13px!important;justify-content:center!important;gap:8px!important;border-radius:12px!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;color:#334155!important}" +
      ".rx-exp-sec-btn:hover{background:#f1f5f9!important;color:#0f172a!important}" +
      ".rx-mono-btn{background:#f0fdf4;border:1px solid #bbf7d0;color:#0e6e63;font:600 9.5px -apple-system,sans-serif;padding:2px 7px;border-radius:5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;transition:all .15s ease}" +
      ".rx-mono-btn:hover{background:#dcfce7;border-color:#86efac;color:#065f46}" +
      ".rx-bp-it{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--hbd,#eef1f4);background:none;padding:9px 4px;cursor:pointer}.rx-bp-nm{font:700 13.5px var(--hfont);color:var(--hink);flex:1 1 44%}.rx-bp-nm em{color:#ef4444;font-weight:600;font-style:normal;font-size:11px}.rx-bp-mf{font:500 11px var(--hfont);color:var(--hmut);flex:1 1 40%}.rx-bp-pr{font:800 13px var(--hfont);color:var(--teal,#0e6e63)}" +
      ".rx-sign-cv{width:100%;height:180px;border:1px dashed var(--hbd,#cbd5e1);border-radius:10px;background:#fff;touch-action:none;margin:6px 0;box-sizing:border-box}.rx-sign-reuse{display:flex;align-items:center;gap:6px;font:600 12.5px var(--hfont);color:var(--hink);margin:4px 0}" +
      ".rx-brands{border:1px solid var(--teal,#0e6e63);background:rgba(14,110,99,.08);color:var(--teal,#0e6e63);border-radius:8px;font:700 10.5px var(--hfont);padding:0 8px;cursor:pointer;white-space:nowrap;flex:none}" +
      ".rxdoc-timing-chip{display:inline-block;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font:600 9.5px -apple-system,BlinkMacSystemFont,sans-serif;padding:1px 6px;border-radius:4px;margin-left:6px;letter-spacing:.02em;vertical-align:middle}" +
      ".rx-doc{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#fff;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}" +
      ".rxdoc-in{padding:30px 42px;box-sizing:border-box}" +
      ".rxdoc-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}" +
      ".rxdoc-hd-left{display:flex;align-items:center;gap:14px;flex:1;min-width:0}" +
      ".rxdoc-logo{width:52px;height:52px;object-fit:contain;border-radius:8px}" +
      ".rxdoc-nm{font:700 17px/1.25 -apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;color:#0f172a;letter-spacing:-.015em}" +
      ".rxdoc-ad{font:500 11.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#475569;margin-top:2px}" +
      ".rxdoc-reg-top{font:600 10.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#0e6e63;margin-top:2px;letter-spacing:.02em}" +
      ".rxdoc-hd-right{text-align:right;flex:none}" +
      ".rxdoc-hd-badge{display:inline-block;font:700 8.5px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0e6e63;background:#f0fdf4;border:1px solid #bbf7d0;padding:2px 7px;border-radius:999px}" +
      ".rxdoc-hd-date{font:600 11px -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b;margin-top:4px}" +
      ".rxdoc-rule{height:1px;background:#e2e8f0;margin:14px 0 16px}" +
      ".rxdoc-meta-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:16px}" +
      ".rxdoc-meta-grid{display:grid;grid-template-columns:1.2fr .8fr 1fr;gap:8px 16px}" +
      ".rxdoc-meta-cell{min-width:0}" +
      ".rxdoc-meta-lbl{font:700 8px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:1.5px}" +
      ".rxdoc-meta-val{font:600 12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a}" +
      ".rxdoc-meta-sub{font-weight:500;color:#475569;font-size:11px;margin-left:4px}" +
      ".rxdoc-pill-dx{display:inline-block;background:#e0f2fe;border:1px solid #bae6fd;padding:1px 7px;border-radius:5px;font:700 10.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#0369a1}" +
      ".rxdoc-meta-divider{height:1px;background:#e2e8f0;margin:8px 0}" +
      ".rxdoc-rx-header{display:flex;align-items:baseline;gap:8px;margin:12px 0 6px}" +
      ".rxdoc-rx-sym{font:800 22px -apple-system,BlinkMacSystemFont,'SF Pro Display',Georgia,serif;color:#0e6e63;line-height:1}" +
      ".rxdoc-rx-title{font:700 10px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#64748b}" +
      ".rxdoc-tbl{width:100%;border-collapse:separate;border-spacing:0;margin-bottom:14px}" +
      ".rxdoc-tbl td{padding:7px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top}" +
      ".rxdoc-tbl tr:last-child td{border-bottom:0}" +
      ".rxdoc-tbl .sn{width:28px;font:700 11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#94a3b8;padding-top:1.5px}" +
      ".rxdoc-tbl .dg{padding-left:4px}" +
      ".rxdoc-drug-nm{font:700 13px/1.3 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;color:#0f172a}" +
      ".rxdoc-tbl .br{color:#0e6e63;font-weight:600;font-size:12px}" +
      ".rxdoc-tbl .dz{color:#475569;font:500 11.5px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;margin-top:2px}" +
      ".rxdoc-adv-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font:500 11.5px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;color:#334155;display:flex;align-items:baseline;gap:8px}" +
      ".rxdoc-adv-lbl{font:700 8px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#0e6e63;background:#ecfdf5;border:1px solid #a7f3d0;padding:1px 5px;border-radius:4px;flex:none}" +
      ".rx-ac-x{color:#ef4444;font-size:10px;font-weight:600}" +
      ".rxcsec{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0}" +
      ".rxcsec thead{display:table-header-group}.rxcsec tfoot{display:table-footer-group}" +
      ".rxcrow,.rxcmed{page-break-inside:avoid;break-inside:avoid}" +
      ".rxccard{border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;margin:6px 0;background:#fff}" +
      ".rxcsec h3{font:700 10.5px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#0f172a;margin:0 0 2px}" +
      ".rxchd{margin-bottom:6px}" +
      ".rxcttl{font:700 11px -apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;letter-spacing:.03em;color:#334155;text-transform:uppercase}" +
      ".rxcsub{font:400 9.5px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b;margin-top:1px}" +
      ".rxctbl,.rxc-tbl{width:100%;border-collapse:separate;border-spacing:0;margin:6px 0;font-size:10px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif}" +
      ".rxctbl th,.rxc-tbl th{padding:6px 8px;font:700 8.5px -apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;background:#f8fafc;vertical-align:top;text-align:left;color:#0f172a}" +
      ".rxctbl th:last-child,.rxc-tbl th:last-child{border-right:0}" +
      ".rxctbl th small,.rxc-tbl th small{font-weight:500;text-transform:none;color:#64748b;display:block;margin-top:1.5px;font-size:8px;letter-spacing:normal}" +
      ".rxctbl th.col-rx,.rxc-tbl th.col-rx{width:25%;border-top:2.5px solid #0f172a}" +
      ".rxctbl th.col-gen,.rxc-tbl th.col-gen{width:18.75%;border-top:2.5px solid #10b981}" +
      ".rxctbl th.col-bal,.rxc-tbl th.col-bal{width:18.75%;border-top:2.5px solid #2563eb}" +
      ".rxctbl th.col-prem,.rxc-tbl th.col-prem{width:18.75%;border-top:2.5px solid #8b5cf6}" +
      ".rxctbl th.col-orig,.rxc-tbl th.col-orig{width:18.75%;border-top:2.5px solid #64748b}" +
      ".rxctbl td,.rxc-tbl td{padding:6px 8px;border-bottom:1px solid #f1f5f9;border-right:1px solid #f1f5f9;vertical-align:top;font-size:10px;line-height:1.3;color:#0f172a;background:#fff}" +
      ".rxctbl tr:last-child td,.rxc-tbl tr:last-child td{border-bottom:0}.rxctbl td:last-child,.rxc-tbl td:last-child{border-right:0}" +
      ".rxctbl td.rxc-rxcol,.rxc-tbl td.rxc-rxcol{background:#fafafa}.rxctbl .rxc-num,.rxc-tbl .rxc-num{font-weight:700;color:#0f172a;font-size:10.5px}.rxctbl .rxc-comp,.rxc-tbl .rxc-comp{color:#64748b;font-size:8.5px;margin-top:1px}.rxctbl .rxc-dose,.rxc-tbl .rxc-dose{color:#64748b;font-size:9px;font-weight:500;margin-top:1px}" +
      ".rxctbl .rxc-brand{font-weight:700;color:#0f172a;font-size:10px;line-height:1.25}" +
      ".rxctbl .rxc-mfr,.rxc-tbl .rxc-mfr{color:#64748b;font-size:8.5px;margin-top:1px}" +
      ".rxctbl .rxc-pack,.rxc-tbl .rxc-pack{color:#64748b;font-size:8px;margin-top:1px}" +
      ".rxctbl .rxc-cost,.rxc-tbl .rxc-cost{font:700 11px -apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a;margin-top:2px}.rxctbl .rxc-cost small,.rxc-tbl .rxc-cost small{font-size:8px;font-weight:400;color:#64748b}" +
      ".rxctbl td.rxc-chosen,.rxc-tbl td.rxc-chosen{background:#f0f9ff!important;border:1.5px solid #0284c7!important}" +
      ".rxctbl td.rxc-chosen .rxc-brand,.rxc-tbl td.rxc-chosen .rxc-brand{color:#0f172a!important}" +
      ".rxctbl td.rxc-chosen .rxc-mfr,.rxc-tbl td.rxc-chosen .rxc-mfr{color:#334155!important}" +
      ".rxctbl td.rxc-chosen .rxc-pack,.rxc-tbl td.rxc-chosen .rxc-pack{color:#475569!important}" +
      ".rxctbl td.rxc-chosen .rxc-cost,.rxc-tbl td.rxc-chosen .rxc-cost{color:#0f172a!important}" +
      ".rxctbl td.rxc-chosen .rxc-cost small,.rxc-tbl td.rxc-chosen .rxc-cost small{color:#475569!important}" +
      ".rxctbl .rxc-tag,.rxc-tbl .rxc-tag{display:inline-block;padding:2px 6px;border-radius:4px;font:700 8px -apple-system,BlinkMacSystemFont,sans-serif;background:#0284c7;color:#fff;margin-bottom:3px;letter-spacing:.04em;text-transform:uppercase}" +
      ".rxctbl td.rxc-empty,.rxc-tbl td.rxc-empty{color:#94a3b8;font-style:italic;font-size:9px;vertical-align:middle}" +
      ".rxctbl .rxc-totrow td,.rxc-tbl .rxc-totrow td{background:#f8fafc;border-top:1px solid #e2e8f0;font-weight:700;padding:6px 8px;color:#0f172a;font-size:10.5px}" +
      ".rxctbl .rxc-totlab,.rxc-tbl .rxc-totlab{font:700 8.5px -apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:#0f172a}" +
      ".rxctbl .rxc-saverow td,.rxc-tbl .rxc-saverow td{background:#f0fdf4;color:#15803d;font:600 10px -apple-system,BlinkMacSystemFont,sans-serif;text-align:right;padding:6px 10px;border-top:1px solid #bbf7d0}" +
      ".rxcline{font-size:11.5px;color:#0f172a;padding:4px 0;border-bottom:1px solid #f1f5f9}.rxccat{font-size:9px;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.04em}" +
      ".rxcnote{margin-top:6px;font:400 8.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b}" +
      ".rxdoc-safety-card{margin:12px 0 10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;padding:10px 12px;page-break-inside:avoid;break-inside:avoid}" +
      ".rxdoc-safety-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}" +
      ".rxdoc-safety-badge{display:inline-flex;align-items:center;gap:4px;font:700 8px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#0e6e63;background:#ecfdf5;border:1px solid #a7f3d0;padding:2px 7px;border-radius:4px}" +
      ".rxdoc-safety-sub{font:500 9px -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b}" +
      ".rxdoc-safety-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}" +
      ".rxdoc-safety-cell{min-width:0;font-size:9.5px;line-height:1.35;color:#334155}" +
      ".rxdoc-safety-drug{font-weight:700;color:#0f172a;margin-bottom:2px}" +
      ".rxdoc-safety-warn{background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:6px 9px;margin-top:6px;font:500 9px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;color:#92400e}" +
      ".rx-safety{margin:10px 0 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.03);overflow:hidden}" +
      ".rx-safety-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}" +
      ".rx-safety-title{display:flex;align-items:center;gap:6px;font:700 12px -apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a}" +
      ".rx-safety-badge{font:700 9.5px -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 7px;border-radius:999px;letter-spacing:.02em}" +
      ".rx-safety-badge.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}" +
      ".rx-safety-badge.warn{background:#fffbeb;color:#92400e;border:1px solid #fef3c7}" +
      ".rx-safety-badge.crit{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}" +
      ".rx-safety-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
      ".rx-safety-row{display:flex;flex-direction:column;gap:3px;padding:7px 10px;border-radius:8px;font-size:12px;line-height:1.4}" +
      ".rx-safety-row.crit{background:#fef2f2;border-left:3.5px solid #dc2626;color:#7f1d1d}" +
      ".rx-safety-row.maj{background:#fffbeb;border-left:3.5px solid #f59e0b;color:#78350f}" +
      ".rx-safety-row.mod{background:#f0f9ff;border-left:3.5px solid #0284c7;color:#0c4a6e}" +
      ".rx-safety-counsel{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}" +
      ".rx-safety-counsel-title{font:700 10.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#334155;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center}" +
      ".rx-safety-counsel-list{font:400 11.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#475569;margin:0;padding-left:14px}" +
      ".rx-safety-counsel-list li{margin-bottom:3px}" +
      ".rx-safety-add-btn{border:1px solid #0e6e63;background:#ecfdf5;color:#065f46;font:700 11px -apple-system,BlinkMacSystemFont,sans-serif;padding:4px 11px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-top:6px;width:fit-content;transition:all .15s}" +
      ".rx-safety-add-btn:hover{background:#0e6e63;color:#fff}" +
      ".rxdoc-ft{margin-top:16px;border-top:1px solid #e2e8f0;padding-top:12px;page-break-inside:avoid;break-inside:avoid}" +
      ".rxdoc-ft-tbl{width:100%;border-collapse:collapse}" +
      ".rxdoc-ft-auth{width:56%;vertical-align:middle;padding:0 14px 0 0}" +
      ".rxdoc-ft-sg{width:44%;vertical-align:bottom;text-align:right;padding:0}" +
      ".rxdoc-sg{display:inline-block;text-align:center;min-width:190px}" +
      ".rxdoc-sgimg{max-height:42px;object-fit:contain;display:block;margin:0 auto 3px}" +
      ".rxdoc-drn{font:700 12.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a;border-top:1px solid #94a3b8;padding-top:3px}" +
      ".rxdoc-reg{font:500 10.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b;margin-top:1.5px}" +
      ".rxdoc-foot{margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;letter-spacing:normal!important;word-spacing:normal!important}" +
      ".rxdoc-brand{display:flex;align-items:center;gap:7px;font:600 10.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#334155;flex-shrink:0}" +
      ".rxdoc-smd-icon{width:16px;height:16px;flex:none;fill:none;stroke:#0e6e63;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
      ".rxdoc-smdlogo{width:16px;height:16px;object-fit:contain}" +
      ".rxdoc-smdwm{font:800 11px -apple-system,BlinkMacSystemFont,sans-serif;color:#0e6e63}" +
      ".rxdoc-smdwm b{color:#0f172a}" +
      ".rxdoc-resp{font:400 8.5px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b;max-width:62%;text-align:right;letter-spacing:normal!important;word-spacing:normal!important}" +
      ".rxc-inline-box{width:100%;order:99}" +
      ".rxc-inline-tray{margin-top:10px;border-top:1px solid rgba(0,0,0,.06);padding-top:10px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display',system-ui,sans-serif}" +
      ".rxc-itray-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}" +
      ".rxc-itray-pill{font:600 10px -apple-system,BlinkMacSystemFont,system-ui;color:#0071e3;background:rgba(0,113,227,.08);padding:2px 8px;border-radius:999px;letter-spacing:.03em;text-transform:uppercase}" +
      ".rxc-itray-sub{font:400 11px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b}" +
      ".rxc-icards{display:grid;gap:8px;grid-template-columns:repeat(4,1fr)}" +
      "@media(max-width:640px){.rxc-icards{grid-template-columns:1fr 1fr;gap:6px}}" +
      ".rxc-icard{border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:10px;background:#fff;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;transition:all .18s cubic-bezier(0.16,1,0.3,1);box-shadow:0 1px 2px rgba(0,0,0,.02)}" +
      ".rxc-icard:hover{border-color:rgba(0,113,227,.3);box-shadow:0 3px 10px rgba(0,0,0,.05);transform:translateY(-1px)}" +
      ".rxc-icard.rec{border:1px solid rgba(0,113,227,.28);background:#fafcff}" +
      ".rxc-icard.sel{border-color:#0071e3!important;box-shadow:0 0 0 1.5px #0071e3,0 3px 12px rgba(0,113,227,.12);background:#fbfdff}" +
      ".rxc-icard.orig{border-style:dashed;border-color:#d1d1d6}" +
      ".rxc-icat-pill{display:flex;align-items:center;gap:5px;font:600 9.5px -apple-system,BlinkMacSystemFont,system-ui;text-transform:uppercase;letter-spacing:.04em;color:#636366}" +
      ".rxc-idot{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}" +
      ".dot-generic{background:#34c759}.dot-balanced{background:#0071e3}.dot-premium{background:#af52de}.dot-prescribed{background:#8e8e93}" +
      ".rxc-icomp{font:400 10px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b;margin-top:3px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rxc-ibrand{font:600 12.5px -apple-system,BlinkMacSystemFont,system-ui;color:#1d1d1f;margin-top:2px;line-height:1.3}" +
      ".rxc-icard.generic .rxc-ibrand{color:#1d1d1f}.rxc-icard.balanced .rxc-ibrand{color:#0071e3}.rxc-icard.premium .rxc-ibrand{color:#1d1d1f}.rxc-icard.prescribed .rxc-ibrand{color:#1d1d1f}" +
      ".rxc-imfg{font:400 10px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b;margin-top:1px;min-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rxc-iprice{font:600 12.5px -apple-system,BlinkMacSystemFont,system-ui;color:#1d1d1f;margin-top:5px}" +
      ".rxc-iprice small{font:400 9.5px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b;margin-left:3px}" +
      ".rxc-ibtn{margin-top:6px;border:1px solid rgba(0,0,0,.04);border-radius:999px;padding:3.5px 8px;font:500 10.5px -apple-system,BlinkMacSystemFont,system-ui;cursor:pointer;text-align:center;background:#f2f2f7;color:#1d1d1f;transition:all .15s ease}" +
      ".rxc-ibtn:hover{background:#e5e5ea}" +
      ".rxc-icard.sel .rxc-ibtn{background:#0071e3;color:#fff;font-weight:600;border-color:transparent;box-shadow:0 1px 3px rgba(0,113,227,.25)}" +
      ".rxc-icard.rec:not(.sel) .rxc-ibtn{background:rgba(0,113,227,.08);color:#0071e3;border-color:transparent}" +
      ".rxc-inote{font:400 11px/1.4 -apple-system,BlinkMacSystemFont,system-ui;color:#636366;background:#f2f2f7;padding:6px 9px;border-radius:8px;margin-top:4px}" +
      "@media print{body>*{display:none!important}body>.rx-scrim,body>.rx-sheet{display:block!important;position:static!important;transform:none!important;box-shadow:none!important;opacity:1!important;max-height:none!important;width:auto!important}.rx-scrim{background:none!important}.rx-x,.rx-del,.rx-add,.rx-print,.rx-row{display:none!important}.rx-in{border:none!important;padding:0!important;background:none!important}.rx-line{border:1px solid #ccc!important;background:none!important}}";
    document.head.appendChild(s);
  }

  var scrim, sheet;
  function ensureEls() {
    injectCSS();
    if (!scrim) {
      scrim = document.createElement("div"); scrim.className = "rx-scrim"; scrim.id = "rxScrim"; document.body.appendChild(scrim);
      scrim.addEventListener("click", function() {
        var d = collectRx();
        if (d && (d.name || d.dx || (d.lines && d.lines.length > 1) || (d.lines && d.lines[0] && d.lines[0].drug))) {
          if (!window.confirm("Discard draft prescription?")) return;
        }
        close();
      });
    }
    if (!sheet) {
      sheet = document.createElement("div"); sheet.className = "rx-sheet"; sheet.id = "rxSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Prescription"); document.body.appendChild(sheet);
    }
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
    try { document.documentElement.classList.add("rx-locked"); document.body.classList.add("rx-locked"); } catch (e) {}
  }
  function close() {
    if (sheet) sheet.classList.remove("on");
    if (scrim) scrim.classList.remove("on");
    try { document.documentElement.classList.remove("rx-locked"); document.body.classList.remove("rx-locked"); } catch (e) {}
  }

  // ---- WebView-safe Print / PDF ----------------------------------------------------------------
  // window.print() is a no-op in the native WKWebView, so we build a self-contained branded Rx
  // document and: print it via a hidden iframe on web, or write it to a file + Share it on native
  // (the OS share sheet offers Print / AirPrint / Save as PDF).
  function rxNative() { try { var C = window.Capacitor; return !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.isNative)); } catch (e) { return false; } }
  function rxPlugins() { try { return (window.Capacitor && window.Capacitor.Plugins) || {}; } catch (e) { return {}; } }
  function collectRx() {
    if (!sheet) return { name: "", age: "", dx: "", complaints: "", vitals: "", allergies: "", lines: [] };
    var name = (sheet.querySelector("#rxPtName") || {}).value || "";
    var age = (sheet.querySelector("#rxPtAge") || {}).value || "";
    var dx = ((sheet.querySelector("#rxDx") || {}).value || "").trim();
    var cc = ((sheet.querySelector("#rxCc") || {}).value || "").trim();
    var vitals = ((sheet.querySelector("#rxVitals") || {}).value || "").trim();
    var allergies = ((sheet.querySelector("#rxAllergies") || {}).value || "").trim();
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
    return { name: name, age: age, dx: dx, complaints: cc, vitals: vitals, allergies: allergies, lines: lines };
  }
  /* The RxChoice section of the printout: a SEPARATE block under the conventional prescription,
   * which is unchanged above it. It lists the four options that were shown and names the product the
   * doctor finally selected, so the pharmacy and the patient can both see what was chosen and what
   * the alternatives were. Empty (and absent from the page) when RxChoice was never opened or the
   * PDF flag is off. */
  function rxcPrintSection() {
    var opts = arguments[0] || {};
    if (opts && opts.includeRxChoice === false) return "";
    var sel = sheet && sheet._rxChoice;
    if (!sel) return "";
    if (opts && opts.includeRxChoice !== true) {
      try { if (!(window.SMD_RXCHOICE_FLAGS && window.SMD_RXCHOICE_FLAGS.bool("smd_rxchoice_pdf"))) return ""; } catch (e) { return ""; }
    }

    // 4-Way Comparison Table when full results are available (Reference Image 3 & Final Plan §3).
    // Built by renderRxChoicePrintTable below so the table has ONE builder for screen, print and
    // tests; this wrapper only decides WHEN the section appears (never above the legal Rx).
    if (sel._allResults && sel._allResults.length) {
      return renderRxChoicePrintTable(sel._allResults, sel._allLines || [], sel._allSelected || [], sel, esc);
    }

    // Fallback simple list (preserves backward-compatibility if only selected single products exist)
    var keys = Object.keys(sel).filter(function (k) { return k && k.charAt(0) !== "_"; });
    if (!keys.length) return "";
    var cost = function (o) { return (o && o.courseCost != null) ? (" &middot; \u20b9" + o.courseCost + " for this course") : ""; };
    var rows = keys.map(function (k) {
      var o = sel[k]; if (!o) return "";
      var cat = !o.category ? "Alternative" : o.category === "prescribed" ? "Doctor Prescribed" : (o.category.charAt(0).toUpperCase() + o.category.slice(1));
      return '<div class="rxcline rxccard rxcmed"><b>' + esc(k) + '</b> &nbsp;<span class="rxccat">' + esc(cat) + '</span><br>' +
        'Prescribed therapy: ' + esc(o.composition || "") + '<br>' +
        'Final selected product: <b>' + esc(o.brand || "") + '</b>' + (o.manufacturer ? ' (' + esc(o.manufacturer) + ')' : '') + cost(o) + '</div>';
    }).join("");
    if (!rows) return "";
    return '<section class="rxcsec"><h3>RxChoice&trade;</h3>' + rows +
      '<div class="rxcnote">The therapy above is the doctor\u2019s. RxChoice lists products from the StewardMD Drug Database carrying that same therapy at different prices. A lower price is not a claim that a product is clinically better. Prices are list MRP for the prescribed course, not a pharmacy quote.</div></section>';
  }
  /* renderRxChoicePrintTable(results, lines, selectedKeys, sel, esc) — the ONE builder for the
   * Phase D 4-way print/PDF table (Final Plan sections 2 and 3). The conventional prescription
   * above it is built elsewhere and is never touched here: no tier names, no marketing, only the
   * doctor's drug + brand + dose/frequency/duration in the first column, then GENERIC, BALANCED,
   * PREMIUM and DOCTOR PRESCRIBED with course costs and unit details (units needed, pack size,
   * packs required). Each medicine is one <tr class="rxcrow"> with its own page-break-inside:avoid,
   * so a long prescription may span pages BETWEEN medicines but never THROUGH one; thead/tfoot
   * repeat via CSS. The chosen cell carries SELECTED/KEPT + rxc-chosen. Garbage in returns "". */
  function renderRxChoicePrintTable(results, lines, selectedKeys, sel, esc) {
    try {
      results = results || []; lines = lines || []; selectedKeys = selectedKeys || []; sel = sel || {};
      if (!Array.isArray(results) || !Array.isArray(lines) || !Array.isArray(selectedKeys)) return "";
      if (typeof esc !== "function") esc = function (s) { return String(s == null ? "" : s); };
      var costStr = function (c) { return (c != null && isFinite(c)) ? ("\u20b9" + (Math.round(c * 100) / 100).toLocaleString("en-IN")) : "—"; };
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
          var tag = isChosen ? ('<span class="rxc-tag">' + (catKey === "prescribed" ? "KEPT" : "SELECTED") + '</span><br>') : "";
          var brandNm = '<div class="rxc-brand"><b>' + esc(opt.brand || "-") + '</b></div>';
          var mfrNm = opt.manufacturer ? ('<div class="rxc-mfr">' + esc(opt.manufacturer) + '</div>') : '';
          var packInfo = (opt.packsRequired != null && opt.requiredUnits != null)
            ? ('<div class="rxc-pack">' + esc(opt.requiredUnits) + '&nbsp;units for this course' +
               (opt.unitsPerPack != null ? '&nbsp;&middot;&nbsp;pack of ' + esc(opt.unitsPerPack) : '') +
               '&nbsp;&middot;&nbsp;' + (opt.packsRequired > 1 ? (esc(opt.packsRequired) + '&nbsp;packs') : '1&nbsp;pack') + '</div>')
            : '';
          var priceVal = opt.courseCost != null ? ('<div class="rxc-cost">' + costStr(opt.courseCost) + '<small>&nbsp;/&nbsp;course</small></div>') : '<div class="rxc-cost">-</div>';
          return '<td class="' + cls + '">' + tag + brandNm + mfrNm + packInfo + priceVal + '</td>';
        };

        tableRows += '<tr class="rxc-tr rxcrow">' +
          '<td class="rxc-td rxc-rxcol rxcmed"><div class="rxc-num">' + (i + 1) + '. ' + drugTitle + '</div>' +
          (activeComp ? ('<div class="rxc-comp">' + activeComp + '</div>') : '') +
          (rxDetails ? ('<div class="rxc-dose">' + rxDetails + '</div>') : '') + '</td>' +
          cell(r.generic, "generic") +
          cell(r.balanced, "balanced") +
          cell(r.premium, "premium") +
          cell(r.prescribed, "prescribed") +
          '</tr>';
      }
      if (!tableRows) return "";

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
        '<div class="rxcttl">RxChoice™ · 4-Way Cost Choice</div>' +
        '<div class="rxcsub">Equivalent options for the prescribed medicine &middot; Same active ingredient &amp; strength</div>' +
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
    } catch (e) { return ""; }
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
    return '<table style="width:100%;border-collapse:collapse;margin-top:' + (bare ? "0" : "2px") +
        ';padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc"><tr>' +
      '<td style="width:78px;padding:6px 10px 6px 6px;vertical-align:middle;text-align:center">' + rxQrSvg(rec, 72) + '</td>' +
      '<td style="padding:6px 6px 6px 0;vertical-align:middle">' +
        '<div style="display:inline-block;padding:2px 7px;border-radius:999px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font:700 9px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.05em;text-transform:uppercase;margin-bottom:3px">' +
          '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:3px"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
          'Digitally Verified' +
        '</div>' +
        '<div style="font:700 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#0f172a;word-break:break-all">' + esc(rec.code) + '</div>' +
        '<div style="font:500 10.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#64748b;margin-top:2px">Scan to verify &middot; <span style="color:#0e6e63;font-weight:600">stewardmd.in/verify</span></div>' +
        (until ? '<div style="font:500 10px -apple-system,BlinkMacSystemFont,sans-serif;color:#94a3b8;margin-top:2px">Valid until ' + esc(until) + '</div>' : '') +
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
    var dn = docName() || "—"; if (dn && !/^dr\.?\s+/i.test(dn) && dn !== "—") dn = "Dr. " + dn;
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
      '.rxcsec{margin-top:20px;padding-top:14px;border-top:1px solid #e5e5ea;break-inside:auto;page-break-inside:auto}' +
      '.rxcsec thead{display:table-header-group}.rxcsec tfoot{display:table-footer-group}' +
      '.rxcrow,.rxcmed{break-inside:avoid;page-break-inside:avoid}' +
      '.rxccard{border:1px solid #e5e5ea;border-radius:8px;padding:6px 10px;margin:6px 0;background:#fff}' +
      '.rxchd{margin-bottom:8px}.rxcttl{font:600 13px -apple-system,BlinkMacSystemFont,\'SF Pro Display\',system-ui;color:#1d1d1f;letter-spacing:.02em;text-transform:uppercase}.rxcsub{font:400 10.5px -apple-system,BlinkMacSystemFont,system-ui;color:#86868b;margin-top:2px}' +
      '.rxctbl{width:100%;border-collapse:separate;border-spacing:0;margin:8px 0;font-size:11px;border:1px solid #e5e5ea;border-radius:8px;overflow:hidden}' +
      '.rxctbl th{padding:6px 8px;font:600 9.5px -apple-system,BlinkMacSystemFont,system-ui;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e5e5ea;border-right:1px solid #e5e5ea;background:#f5f5f7;vertical-align:top;text-align:left;color:#1d1d1f}' +
      '.rxctbl th:last-child{border-right:0}' +
      '.rxctbl th small{font-weight:400;text-transform:none;color:#86868b;display:block;margin-top:1px}' +
      '.rxctbl th.col-rx{width:26%;border-top:2.5px solid #1d1d1f}' +
      '.rxctbl th.col-gen{width:18.5%;border-top:2.5px solid #34c759;background:#fbfdfb}' +
      '.rxctbl th.col-bal{width:18.5%;border-top:2.5px solid #0071e3;background:#fafcff}' +
      '.rxctbl th.col-prem{width:18.5%;border-top:2.5px solid #af52de;background:#fdfbfe}' +
      '.rxctbl th.col-orig{width:18.5%;border-top:2.5px solid #8e8e93;background:#f5f5f7}' +
      '.rxctbl td{padding:6px 8px;border-bottom:1px solid #f2f2f7;border-right:1px solid #f2f2f7;vertical-align:top;font-size:10.5px;line-height:1.35;color:#1d1d1f;background:#fff}' +
      '.rxctbl tr:last-child td{border-bottom:0}.rxctbl td:last-child{border-right:0}' +
      '.rxctbl td.rxc-rxcol{background:#fafafa}.rxctbl .rxc-num{font-weight:600;color:#1d1d1f}.rxctbl .rxc-comp{color:#86868b;font-size:9.5px;margin-top:1px}.rxctbl .rxc-dose{color:#0071e3;font-size:9.5px;font-weight:500;margin-top:2px}' +
      '.rxctbl .rxc-mfr{color:#86868b;font-size:9.5px;margin-top:1px}' +
      '.rxctbl .rxc-pack{color:#86868b;font-size:9px;margin-top:2px}' +
      '.rxctbl .rxc-cost{font:600 11.5px -apple-system,BlinkMacSystemFont,system-ui;color:#1d1d1f;margin-top:3px}.rxctbl .rxc-cost small{font-size:9px;font-weight:400;color:#86868b}' +
      '.rxctbl td.rxc-chosen{background:#f6fbf7!important;box-shadow:inset 0 0 0 1px #34c759}' +
      '.rxctbl .rxc-tag{display:inline-block;padding:1px 6px;border-radius:999px;font:600 8px -apple-system,BlinkMacSystemFont,system-ui;background:#34c759;color:#fff;margin-bottom:3px;letter-spacing:.03em}' +
      '.rxctbl td.rxc-empty{color:#8e8e93;font-style:italic;font-size:9.5px}' +
      '.rxctbl .rxc-totrow td{background:#f5f5f7;border-top:1px solid #e5e5ea;font-weight:600;padding:6px 8px;color:#1d1d1f}' +
      '.rxctbl .rxc-totlab{font:600 10px -apple-system,BlinkMacSystemFont,system-ui;text-transform:uppercase;color:#1d1d1f}' +
      '.rxctbl .rxc-saverow td{background:#f2fbf5;color:#248a3d;font:600 11px -apple-system,BlinkMacSystemFont,system-ui;text-align:right;padding:6px 8px;border-top:1px solid rgba(52,199,89,.25)}' +
      '.rxcline{font-size:12.5px;color:#1d1d1f;padding:5px 0;border-bottom:1px solid #f2f2f7}.rxccat{font-size:10px;font-weight:600;color:#0071e3;text-transform:uppercase}' +
      '.rxcnote{margin-top:7px;font-size:9.5px;color:#86868b;line-height:1.4}' +
      // The verification block sits with the signature: a reader checking authenticity is already
      // looking at who signed it. Kept off the page break so the QR is never split in half.
      '.rxv{display:flex;gap:12px;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;break-inside:avoid;page-break-inside:avoid}' +
      '.rxv svg{width:96px;height:96px;flex:0 0 auto}' +
      '.rxv-c{font:700 14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#0f172a}' +
      '.rxv-l{font-size:11px;color:#64748b;margin-top:2px}.rxv-u{font-size:11px;color:#0e6e63;font-weight:700;margin-top:2px}' +
      '@media print{body{padding:0}@page{margin:16mm}.rxcsec{break-inside:auto;page-break-inside:auto}.rxcrow,.rxcmed{break-inside:avoid;page-break-inside:avoid}.rxctbl thead{display:table-header-group}.rxctbl tfoot{display:table-footer-group}}' +
      '</style></head><body>' +
      '<div class="hd"><span class="logo">Steward<b>MD</b></span><span class="tag">Prescription</span></div>' +
      '<div class="clinic">StewardMD' + (topic ? ' &middot; ' + esc(topic) : '') + '</div>' +
      ((d.name || d.age) ? '<div class="pt">' + esc(d.name) + (d.age ? '  &middot;  ' + esc(d.age) : '') + '</div>' : '') +
      '<div class="rxsym">&#8478;</div><main>' + (rows || '<div class="adv">No items.</div>') + '</main>' +
      rxcPrintSection() +
      '<div class="sign"><div class="nm">' + esc(dn) + '</div><div class="mt">NMC Reg: ' + esc(regNo || "—") + '  &middot;  ' + esc(date) + '</div></div>' +
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
    var timing = getDrugTimingBadge(l.drug, l.freq);
    var timingHtml = timing ? '<div class="rx-timing-tag"><span class="rx-timing-chip">' + esc(timing) + '</span></div>' : '';
    var curFreq = (l.freq || "").toUpperCase().trim();
    var pills = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT"].map(function (p) {
      var act = curFreq === p ? " active" : "";
      return '<button type="button" class="rx-freq-pill' + act + '" data-freq="' + p + '">' + p + '</button>';
    }).join("");
    return '<div class="' + cls + '" data-i="' + i + '">' +
      '<div class="r1"><input class="rx-in rx-drug" data-f="drug" value="' + esc(l.drug) + '" placeholder="Drug (generic)">' +
      '<input class="rx-in rx-brand" data-f="brand" value="' + esc(l.brand || "") + '" placeholder="Brand — tap for brands + prices"><button class="rx-del" title="Remove">'+rxIco("close")+'</button></div>' +
      '<div class="r2"><input class="rx-in rx-dose" data-f="dose" value="' + esc(l.dose || "") + '" placeholder="Dose">' +
      '<input class="rx-in rx-freq" data-f="freq" value="' + esc(l.freq || "") + '" placeholder="Freq">' +
      '<input class="rx-in rx-dur" data-f="duration" value="' + esc(l.duration || "") + '" placeholder="Duration"></div>' +
      '<div class="rx-freq-pills">' + pills + '</div>' +
      timingHtml +
      (l.unverified ? '<div class="rx-flag">'+rxIco("warn")+' Not from the Drug Index — confirm this dose before signing</div>' : "") +
      '</div>';
  }

  function updateLineTiming(line) {
    if (!line || line.classList.contains("adv")) return;
    var d = ((line.querySelector('[data-f="drug"]') || {}).value || "").trim();
    var f = ((line.querySelector('[data-f="freq"]') || {}).value || "").trim();
    var badge = getDrugTimingBadge(d, f);
    var existing = line.querySelector(".rx-timing-tag");
    if (badge) {
      if (existing) {
        existing.innerHTML = '<span class="rx-timing-chip">' + esc(badge) + '</span>';
      } else {
        var anchor = line.querySelector(".rx-freq-pills") || line.querySelector(".r2");
        if (anchor) {
          anchor.insertAdjacentHTML("afterend", '<div class="rx-timing-tag"><span class="rx-timing-chip">' + esc(badge) + '</span></div>');
        }
      }
    } else if (existing) {
      existing.remove();
    }
  }

  // Standard Clinical Regimens for Indian practice (Dose, Frequency, Route, Duration, Timing)
  var STANDARD_REGIMENS = {
    "paracetamol": { dose: "650 mg PO", freq: "TDS", dur: "3 days", timing: "After Food" },
    "pantoprazole": { dose: "40 mg PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "omeprazole": { dose: "20 mg PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "rabeprazole": { dose: "20 mg PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "esomeprazole": { dose: "40 mg PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "amoxicillin": { dose: "500 mg PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "amoxycillin": { dose: "500 mg PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "amoxicillin+clavulanic acid": { dose: "625 mg PO", freq: "BD", dur: "5 days", timing: "Start of Meals" },
    "amoxycillin+clavulanic acid": { dose: "625 mg PO", freq: "BD", dur: "5 days", timing: "Start of Meals" },
    "azithromycin": { dose: "500 mg PO", freq: "OD", dur: "3 days", timing: "1h Before / 2h After Food" },
    "cefixime": { dose: "200 mg PO", freq: "BD", dur: "5 days", timing: "After Food" },
    "ciprofloxacin": { dose: "500 mg PO", freq: "BD", dur: "5 days", timing: "2h After Food" },
    "levofloxacin": { dose: "500 mg PO", freq: "OD", dur: "5 days", timing: "With or Without Food" },
    "ofloxacin": { dose: "200 mg PO", freq: "BD", dur: "5 days", timing: "After Food" },
    "doxycycline": { dose: "100 mg PO", freq: "BD", dur: "7 days", timing: "With Full Glass of Water" },
    "metronidazole": { dose: "400 mg PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "metformin": { dose: "500 mg PO", freq: "BD", dur: "30 days", timing: "With Meals" },
    "glimepiride": { dose: "1 mg PO", freq: "OD", dur: "30 days", timing: "Before Breakfast" },
    "atorvastatin": { dose: "10 mg PO", freq: "HS", dur: "30 days", timing: "At Bedtime" },
    "rosuvastatin": { dose: "10 mg PO", freq: "HS", dur: "30 days", timing: "At Bedtime" },
    "amlodipine": { dose: "5 mg PO", freq: "OD", dur: "30 days", timing: "Morning or Evening" },
    "telmisartan": { dose: "40 mg PO", freq: "OD", dur: "30 days", timing: "Morning" },
    "losartan": { dose: "50 mg PO", freq: "OD", dur: "30 days", timing: "Morning" },
    "aceclofenac+paracetamol": { dose: "1 tab PO", freq: "BD", dur: "3 days", timing: "After Food" },
    "ibuprofen+paracetamol": { dose: "1 tab PO", freq: "TDS", dur: "3 days", timing: "After Food" },
    "domperidone+pantoprazole": { dose: "1 cap PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "domperidone+rabeprazole": { dose: "1 cap PO", freq: "OD", dur: "14 days", timing: "30m Before Breakfast" },
    "levocetirizine+montelukast": { dose: "1 tab PO", freq: "HS", dur: "10 days", timing: "At Bedtime" },
    "cetirizine": { dose: "10 mg PO", freq: "HS", dur: "5 days", timing: "At Bedtime" },
    "levocetirizine": { dose: "5 mg PO", freq: "HS", dur: "5 days", timing: "At Bedtime" },
    "fexofenadine": { dose: "120 mg PO", freq: "OD", dur: "5 days", timing: "Before Food" },
    "ondansetron": { dose: "4 mg PO", freq: "TDS", dur: "3 days", timing: "Before Food" },
    "tramadol+paracetamol": { dose: "1 tab PO", freq: "BD", dur: "3 days", timing: "After Food" },
    "diclofenac": { dose: "50 mg PO", freq: "BD", dur: "3 days", timing: "After Food" },
    "diclofenac+paracetamol": { dose: "1 tab PO", freq: "BD", dur: "3 days", timing: "After Food" },
    "ibuprofen": { dose: "400 mg PO", freq: "TDS", dur: "3 days", timing: "After Food" },
    "ranitidine": { dose: "150 mg PO", freq: "BD", dur: "14 days", timing: "Before Meals" },
    "ofloxacin+ornidazole": { dose: "1 tab PO", freq: "BD", dur: "5 days", timing: "After Food" },
    "cefixime+ofloxacin": { dose: "1 tab PO", freq: "BD", dur: "5 days", timing: "After Food" },
    "thyroxine": { dose: "50 mcg PO", freq: "OD", dur: "30 days", timing: "Empty Stomach Early Morning" },
    "levothyroxine": { dose: "50 mcg PO", freq: "OD", dur: "30 days", timing: "Empty Stomach Early Morning" },
    "ambroxol+guaifenesin": { dose: "10 ml PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "ambroxol+guaifenesin+levosalbutamol": { dose: "10 ml PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "ambroxol+guaifenesin+terbutaline": { dose: "10 ml PO", freq: "TDS", dur: "5 days", timing: "After Food" },
    "dextromethorphan+chlorpheniramine": { dose: "10 ml PO", freq: "TDS", dur: "5 days", timing: "After Food" }
  };

  function resolveStandardRegimen(generic, rawDose, brandName) {
    var bareKey = canonDrugKey(generic).replace(/\s*\+\s*/g, "+");
    var norm = String(generic || "").toLowerCase().replace(/[^a-z0-9.+/ -]+/g, " ").replace(/\s+/g, " ").trim();
    var compKey = norm.indexOf("+") > -1 ? norm.split(/\s*\+\s*/).map(function(s){return s.trim();}).sort().join("+") : norm;
    var std = STANDARD_REGIMENS[bareKey] || STANDARD_REGIMENS[norm] || STANDARD_REGIMENS[compKey];
    if (std) return std;

    var comboText = (String(generic || "") + " " + String(brandName || "") + " " + String(rawDose || "")).toLowerCase();
    var isLiquid = /\b(syrup|suspension|liquid|solution|elixir|cough|oral\s*liquid|oral\s*solution)\b/i.test(comboText);
    var isDrops = /\b(drops?|eye\s*drops?|ear\s*drops?|nasal\s*drops?)\b/i.test(comboText);
    var isTopical = /\b(cream|ointment|gel|lotion|liniment|paste)\b/i.test(comboText);
    var isInhaler = /\b(inhaler|rotacap|respules|puffs?|spray)\b/i.test(comboText);
    var isInjection = /\b(injection|inj|infusion|vial|ampoule)\b/i.test(comboText);

    var doseText = String(rawDose || "");
    var out = { dose: "", freq: "OD", dur: "5 days", timing: "" };

    if (/\b(?:tds|tid|thrice|three\s*times|every\s*8\s*h)\b/i.test(doseText)) out.freq = "TDS";
    else if (/\b(?:bd|bid|twice|every\s*12\s*h)\b/i.test(doseText)) out.freq = "BD";
    else if (/\b(?:qid|four\s*times|every\s*6\s*h)\b/i.test(doseText)) out.freq = "QID";
    else if (/\b(?:hs|bedtime|at\s*night)\b/i.test(doseText)) out.freq = "HS";
    else if (/\b(?:sos|prn|as\s*needed)\b/i.test(doseText)) out.freq = "SOS";
    else if (/\b(?:stat)\b/i.test(doseText)) out.freq = "STAT";
    else if (isLiquid || isDrops) out.freq = "TDS";
    else if (isTopical || isInhaler) out.freq = "BD";
    else out.freq = "OD";

    var mDose = doseText.match(/(\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)(?:\s*[-–]\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu)?)?)/i);
    var route = /\b(?:iv\/po|po\/iv|oral|po)\b/i.test(doseText) ? "PO" : (/\b(?:iv|intravenous)\b/i.test(doseText) ? "IV" : "");
    if (mDose) {
      out.dose = mDose[1].replace(/\s*[-–]\s*\d+.*$/, "") + (route ? (" " + route) : " PO");
    } else if (isLiquid) {
      out.dose = "10 ml PO";
      out.timing = "After Food";
    } else if (isDrops) {
      out.dose = "2 drops";
      out.timing = "As Directed";
    } else if (isTopical) {
      out.dose = "Apply locally";
      out.timing = "As Directed";
    } else if (isInhaler) {
      out.dose = "1-2 puffs";
      out.timing = "As Directed";
    } else if (isInjection) {
      out.dose = "1 vial IV";
      out.timing = "Stat / As Directed";
    } else {
      out.dose = doseText.split(/[.;]/)[0].trim() || (norm.indexOf("+") > -1 ? "1 tab PO" : "1 tab PO");
    }

    if (/antibiotic|penicillin|cephalosporin|fluoroquinolone|macrolide|antifungal|antiviral/i.test(doseText)) out.dur = "5 days";
    else if (/analgesic|nsaid|antipyretic|pain|spasm/i.test(doseText)) out.dur = "3 days";
    else if (/ppi|antacid|ulcer|gerd/i.test(doseText)) out.dur = "14 days";
    else if (/hypertension|diabetes|statin|lipid|cardiac|thyroid/i.test(doseText)) out.dur = "30 days";
    else if (isTopical) out.dur = "7 days";
    else if (isInhaler) out.dur = "30 days";
    else out.dur = "5 days";

    return out;
  }

  function canonDrugKey(name) {
    var s = String(name || "").trim();
    if (!s) return "";
    if (/\s*\+\s*|\s+and\s+/i.test(s)) {
      var parts = s.split(/\s*\+\s*/).map(function (p) {
        return p.replace(/\([^)]*\)/g, "").replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi, "").trim().toLowerCase();
      }).filter(Boolean);
      return parts.sort().join(" + ");
    }
    var clean = s.replace(/\([^)]*\)/g, "")
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)?\b/gi, "")
      .replace(/\b(tablet|tablets|tab|capsule|capsules|cap|injection|inj|syrup|suspension|drops|dt|sr|er|mr)\b/gi, "");
    return clean.replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Live brand/composition search on a drug line, powered by the Drug Index (MEDDRUGS).
  // Typing in the Drug (generic) OR Brand field shows matching medicines; picking one auto-fills
  // the composition (generic), a matching brand, standard dose + route, frequency and duration.
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

      // Auto-populate standard dosing: dose + route, frequency, duration
      var bName = brandIn ? brandIn.value : "";
      var regimen = resolveStandardRegimen(r.generic, r.dose, bName);
      var doseIn = line.querySelector(".rx-dose");
      if (doseIn) {
        if (!doseIn.value.trim() || doseIn.value === "1") {
          doseIn.value = regimen.dose || (r.dose ? r.dose.split(/[.;]/)[0].trim() : "1 tab PO");
        }
      }
      var freqIn = line.querySelector(".rx-freq");
      if (freqIn) {
        if (!freqIn.value.trim()) {
          freqIn.value = regimen.freq || "OD";
        }
        var fVal = freqIn.value.trim().toUpperCase();
        line.querySelectorAll(".rx-freq-pill").forEach(function (pill) {
          pill.classList.toggle("active", (pill.getAttribute("data-freq") || "").toUpperCase() === fVal);
        });
      }
      var durIn = line.querySelector(".rx-dur");
      if (durIn && !durIn.value.trim()) {
        durIn.value = regimen.dur || "5 days";
      }

      line.classList.remove("unv"); var fl = line.querySelector(".rx-flag"); if (fl) fl.remove();  // now DB-sourced
      closeAc();
      try { updateLineTiming(line); } catch (e) {}
      try { refreshSafety(); } catch (e) {}   // re-run allergy + interaction checks with the newly picked drug
      try { showPriceHint(line, r.generic); } catch (e) {}   // lowest-cost brand awareness
      if (freqIn) {
        try { freqIn.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      }
    }
    function paint() { Array.prototype.forEach.call(ac.querySelectorAll(".rx-ac-item"), function (b, i) { b.classList.toggle("on", i === active); }); }

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
      // Deduplicate on canonical generic key, so "Paracetamol" and "Paracetamol 500" merge into one,
      // while keeping distinct combinations intact (e.g. "Paracetamol + Tramadol").
      var seen = {}, merged = [];
      local.forEach(function (r) {
        var k = canonDrugKey(r.generic);
        var rawk = String(r.generic || "").toLowerCase();
        seen[k] = 1; seen[rawk] = 1;
        merged.push(r);
      });
      remoteRows.forEach(function (r) {
        var k = canonDrugKey(r.generic);
        var rawk = String(r.generic || "").toLowerCase();
        if (!k || seen[k] || seen[rawk] || merged.length >= 10) return;
        seen[k] = 1; seen[rawk] = 1;
        // Clean display name for single entities that carry redundant inline strength
        if (r.generic && r.generic.indexOf("+") === -1 && (/\([^)]*\)/.test(r.generic) || /\b\d+\s*mg\b/i.test(r.generic))) {
          var cleanName = r.generic.replace(/\s*\([^)]*\)/g, "").replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi, "").trim();
          if (cleanName) r = Object.assign({}, r, { generic: cleanName });
        }
        merged.push(r);
      });
      rows = merged; active = -1;
      if (!rows.length) { closeAc(); return; }
      if (!ac) { ac = document.createElement("div"); ac.className = "rx-ac"; r1.insertAdjacentElement("afterend", ac); }
      ac.innerHTML = rows.map(function (r, i) {
        var brands = (r.brands || []).slice(0, 3).join(", ");
        if (!brands && r.remote && r.brandCount) brands = r.brandCount + (r.brandCount === 1 ? " brand" : " brands");
        return '<button type="button" class="rx-ac-item" data-i="' + i + '"><span class="rx-ac-g">' + esc(r.generic) + '</span>' + (brands ? ' <span class="rx-ac-b">' + esc(brands) + '</span>' : '') + '<span class="rx-ac-d">' + esc(r.dose || '') + '</span></button>';
      }).join("");
      Array.prototype.forEach.call(ac.querySelectorAll(".rx-ac-item"), function (b) {
        var onSelect = function (e) {
          e.preventDefault();
          e.stopPropagation();
          fill(rows[+b.getAttribute("data-i")], fromBrand ? q : "");
        };
        b.addEventListener("pointerdown", onSelect);
        b.addEventListener("mousedown", onSelect);
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
    drugIn.addEventListener("blur", function () { setTimeout(closeAc, 250); });
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

  // ---- Clinical Safety & Patient Counseling Intelligence Engine ----
  // Analyzes regimen for molecule-specific side effects, red flags, counseling advice, allergies, and drug interactions.
  var RX_CLINICAL_KB = {
    "azithromycin": {
      generic: "Azithromycin",
      cls: "Macrolide Antibiotic",
      tags: ["macrolide", "antibiotic", "qt_prolonging"],
      sideEffects: ["Nausea, abdominal cramps, loose stools", "Headache or mild dizziness"],
      redFlags: ["Palpitations or irregular heart rhythm", "Severe allergic rash or facial swelling", "Persistent watery diarrhea"],
      counseling: "Take 1 hour before or 2 hours after meals (or with light food if stomach upset occurs). Complete the full 3–5 day course.",
      timingBadge: "1h Before / 2h After Food",
      interactions: [
        { withTags: ["qt_prolonging", "ondansetron", "ciprofloxacin", "amiodarone"], sev: "major", text: "Additive QT prolongation risk — monitor cardiac rhythm and electrolytes." },
        { withTags: ["antacids"], sev: "moderate", text: "Aluminum/magnesium antacids reduce peak absorption — separate doses by 2 hours." },
        { withTags: ["warfarin"], sev: "moderate", text: "May enhance anticoagulant effect — monitor INR." }
      ]
    },
    "amoxicillin + clavulanic acid": {
      generic: "Amoxicillin + Clavulanic Acid",
      cls: "Potentiated Penicillin Antibiotic",
      tags: ["penicillin", "beta_lactam", "antibiotic"],
      sideEffects: ["Diarrhea or frequent loose stools, nausea, mild abdominal cramps", "Oral or vaginal candidiasis"],
      redFlags: ["Anaphylaxis (wheezing, hives, lip swelling)", "Cholestatic jaundice / dark urine (rare)", "Severe watery diarrhea (C. diff)"],
      counseling: "Take at the start of a meal to optimize clavulanate absorption and minimize stomach upset. Complete full course.",
      timingBadge: "Start of Meals / With Food",
      interactions: [
        { withTags: ["allopurinol"], sev: "moderate", text: "Increased risk of drug-induced skin rash." },
        { withTags: ["methotrexate"], sev: "major", text: "Reduces renal methotrexate clearance — risk of methotrexate toxicity." },
        { withTags: ["warfarin"], sev: "moderate", text: "May prolong prothrombin time / INR." }
      ]
    },
    "amoxicillin": {
      generic: "Amoxicillin",
      cls: "Aminopenicillin Antibiotic",
      tags: ["penicillin", "beta_lactam", "antibiotic"],
      sideEffects: ["Loose stools, diarrhea, mild nausea", "Mild non-allergic skin rash"],
      redFlags: ["Severe allergic urticaria, facial swelling or wheezing (penicillin allergy)", "Severe watery diarrhea"],
      counseling: "Take at evenly spaced intervals. Finish entire course even if symptoms resolve.",
      timingBadge: "With or Without Food",
      interactions: [
        { withTags: ["allopurinol"], sev: "moderate", text: "Higher incidence of skin rash." },
        { withTags: ["methotrexate"], sev: "major", text: "Decreases renal tubular methotrexate clearance." }
      ]
    },
    "paracetamol": {
      generic: "Paracetamol",
      cls: "Analgesic & Antipyretic",
      tags: ["analgesic", "antipyretic", "acetaminophen"],
      sideEffects: ["Well tolerated at standard therapeutic doses"],
      redFlags: ["Severe nausea, right upper quadrant abdominal pain, jaundice / yellowing of eyes (hepatotoxicity)"],
      counseling: "Do not exceed 4,000 mg in 24 hours (max 3,000 mg/day in elderly/hepatic risk). Check all OTC cough/cold formulations to avoid duplicate paracetamol.",
      timingBadge: "As Needed (Max 4g/day)",
      interactions: [
        { withTags: ["warfarin"], sev: "moderate", text: "Regular daily high doses (>2g/day) may enhance anticoagulant effect." },
        { withTags: ["alcohol"], sev: "major", text: "Chronic alcohol misuse increases risk of hepatotoxicity." }
      ]
    },
    "pantoprazole": {
      generic: "Pantoprazole",
      cls: "Proton Pump Inhibitor (PPI)",
      tags: ["ppi", "acid_reducer"],
      sideEffects: ["Mild headache, loose stools or constipation, flatulence"],
      redFlags: ["Severe persistent watery diarrhea", "Severe abdominal cramping"],
      counseling: "Take once daily in the morning, 30 to 60 minutes before breakfast or first meal.",
      timingBadge: "30m Before Breakfast",
      interactions: [
        { withTags: ["iron"], sev: "moderate", text: "Decreased gastric acidity reduces oral iron absorption." },
        { withTags: ["ketoconazole", "itraconazole"], sev: "major", text: "Markedly reduces antifungal absorption." }
      ]
    },
    "omeprazole": {
      generic: "Omeprazole",
      cls: "Proton Pump Inhibitor (PPI)",
      tags: ["ppi", "acid_reducer"],
      sideEffects: ["Headache, mild diarrhea, abdominal discomfort"],
      redFlags: ["Severe watery diarrhea", "Bone pain or muscle spasms with long-term use"],
      counseling: "Take 30–60 minutes before morning meal. Swallow whole, do not crush or chew capsules.",
      timingBadge: "30m Before Breakfast",
      interactions: [
        { withTags: ["clopidogrel"], sev: "major", text: "CYP2C19 inhibition reduces clopidogrel activation and antiplatelet efficacy." },
        { withTags: ["iron"], sev: "moderate", text: "Reduces oral iron absorption." }
      ]
    },
    "ondansetron": {
      generic: "Ondansetron",
      cls: "5-HT3 Antiemetic",
      tags: ["antiemetic", "qt_prolonging"],
      sideEffects: ["Constipation, mild headache, warm flushing sensation"],
      redFlags: ["Palpitations, dizziness or syncope (QT interval prolongation)"],
      counseling: "Take 30 minutes before meals or as directed for nausea. Drink adequate fluids to prevent constipation.",
      timingBadge: "30m Before Meals",
      interactions: [
        { withTags: ["qt_prolonging", "azithromycin", "ciprofloxacin", "amiodarone"], sev: "major", text: "Additive risk of QT prolongation and cardiac dysrhythmias." },
        { withTags: ["apomorphine"], sev: "critical", text: "Contraindicated: severe profound hypotension and loss of consciousness." }
      ]
    },
    "ciprofloxacin": {
      generic: "Ciprofloxacin",
      cls: "Fluoroquinolone Antibiotic",
      tags: ["fluoroquinolone", "antibiotic", "qt_prolonging"],
      sideEffects: ["Nausea, mild diarrhea, insomnia, lightheadedness"],
      redFlags: ["Tendon pain, swelling or tenderness (especially Achilles tendon) — stop and rest immediately", "Palpitations / irregular heart rhythm", "Burning or tingling nerve pain"],
      counseling: "Drink plenty of water. Do NOT take with milk, dairy, antacids, or iron within 2 hours. Protect skin from direct sunlight.",
      timingBadge: "With Water · Avoid Dairy",
      interactions: [
        { withTags: ["qt_prolonging", "ondansetron", "azithromycin"], sev: "major", text: "Cumulative QT prolongation risk." },
        { withTags: ["theophylline", "tizanidine"], sev: "critical", text: "Severe CYP1A2 inhibition elevates plasma levels to toxic range." },
        { withTags: ["nsaid", "diclofenac", "ibuprofen"], sev: "moderate", text: "Concurrent NSAID use may increase CNS stimulation and seizure risk." }
      ]
    },
    "diclofenac": {
      generic: "Diclofenac",
      cls: "NSAID Analgesic",
      tags: ["nsaid", "analgesic"],
      sideEffects: ["Indigestion, heartburn, epigastric discomfort, nausea"],
      redFlags: ["Black or tarry stools, vomiting blood (GI bleed)", "Swelling of feet/ankles, shortness of breath", "Decreased urine output"],
      counseling: "Take strictly with or after meals. Use for the shortest required duration at the lowest effective dose.",
      timingBadge: "Strictly After Food",
      interactions: [
        { withTags: ["anticoagulant", "antiplatelet", "aspirin", "clopidogrel", "warfarin"], sev: "major", text: "Significant increase in gastrointestinal ulceration and hemorrhage risk." },
        { withTags: ["acei", "arb", "diuretic", "telmisartan"], sev: "major", text: "Triple whammy: risk of acute renal failure and blunted antihypertensive effect." }
      ]
    },
    "ibuprofen": {
      generic: "Ibuprofen",
      cls: "NSAID Analgesic",
      tags: ["nsaid", "analgesic"],
      sideEffects: ["Dyspepsia, heartburn, mild nausea"],
      redFlags: ["Black stools, vomiting blood", "Swelling, sudden elevation of blood pressure"],
      counseling: "Take with food or milk to protect stomach lining. Avoid alcohol while taking NSAIDs.",
      timingBadge: "With or After Food",
      interactions: [
        { withTags: ["anticoagulant", "aspirin", "warfarin"], sev: "major", text: "Additive gastrointestinal mucosal ulceration and bleeding." },
        { withTags: ["acei", "arb", "diuretic"], sev: "major", text: "Risk of decreased renal blood flow and increased BP." }
      ]
    },
    "doxycycline": {
      generic: "Doxycycline",
      cls: "Tetracycline Antibiotic",
      tags: ["tetracycline", "antibiotic"],
      sideEffects: ["Nausea, esophageal irritation, photosensitivity / sun sensitivity"],
      redFlags: ["Severe swallowing pain, severe headache with visual changes (intracranial hypertension)"],
      counseling: "Take with a full glass of water and stay upright for at least 30 minutes. Space 2 hours from antacids, calcium, or iron supplements.",
      timingBadge: "With Water · Stay Upright 30m",
      interactions: [
        { withTags: ["antacids", "iron", "calcium"], sev: "moderate", text: "Divalent cations chelate doxycycline and severely impair absorption." },
        { withTags: ["warfarin"], sev: "moderate", text: "May enhance anticoagulant effect — monitor INR." }
      ]
    },
    "aspirin": {
      generic: "Aspirin",
      cls: "Salicylate Antiplatelet & Analgesic",
      tags: ["nsaid", "salicylate", "antiplatelet", "analgesic"],
      sideEffects: ["Gastric irritation, heartburn, easy bruising"],
      redFlags: ["Black or tarry stools, vomiting coffee-ground material (GI bleed), ringing in ears (tinnitus / toxicity)"],
      counseling: "Take with or immediately after meals. Avoid in children/teens with fever/flu due to Reye’s syndrome risk.",
      timingBadge: "With or After Food",
      interactions: [
        { withTags: ["anticoagulant", "warfarin", "clopidogrel"], sev: "major", text: "Substantial bleeding risk — co-prescribe gastroprotection if indicated." },
        { withTags: ["nsaid", "ibuprofen"], sev: "major", text: "Ibuprofen interferes with irreversible aspirin antiplatelet effect." }
      ]
    },
    "furosemide": {
      generic: "Furosemide",
      cls: "Loop Diuretic",
      tags: ["diuretic", "loop_diuretic", "antihypertensive"],
      sideEffects: ["Increased urination, mild lightheadedness, dry mouth"],
      redFlags: ["Muscle cramps or profound weakness (hypokalemia), severe dehydration, dizziness upon standing"],
      counseling: "Take in the morning to prevent nighttime urination sleep disruption. Maintain adequate hydration.",
      timingBadge: "Morning (Avoid Evening)",
      interactions: [
        { withTags: ["nsaid", "diclofenac", "ibuprofen"], sev: "major", text: "NSAIDs inhibit renal prostaglandins, attenuating diuretic effect and precipitating AKI." },
        { withTags: ["digoxin"], sev: "major", text: "Hypokalemia dramatically potentiates digitalis toxicity." }
      ]
    },
    "hydrochlorothiazide": {
      generic: "Hydrochlorothiazide",
      cls: "Thiazide Diuretic",
      tags: ["diuretic", "thiazide_diuretic", "antihypertensive"],
      sideEffects: ["Frequent urination, mild electrolyte imbalance, increased uric acid"],
      redFlags: ["Severe muscle weakness, confusion, syncope"],
      counseling: "Take once daily in the morning with or without food. Protect skin from prolonged sunlight.",
      timingBadge: "Morning",
      interactions: [
        { withTags: ["nsaid"], sev: "major", text: "Decreased diuretic and antihypertensive efficacy." },
        { withTags: ["lithium"], sev: "major", text: "Reduces renal clearance of lithium, elevating risk of lithium toxicity." }
      ]
    },
    "ramipril": {
      generic: "Ramipril",
      cls: "ACE Inhibitor",
      tags: ["acei", "antihypertensive"],
      sideEffects: ["Persistent dry cough, mild dizziness upon standing"],
      redFlags: ["Facial, lip, or tongue swelling (angioedema) — seek emergency care", "Severe lightheadedness, decreased urination"],
      counseling: "Take once daily at the same time every day. Avoid potassium supplements unless advised by physician.",
      timingBadge: "Morning · Same Time Daily",
      interactions: [
        { withTags: ["nsaid", "diclofenac", "ibuprofen"], sev: "major", text: "May impair renal function and blunt antihypertensive response." },
        { withTags: ["potassium", "spironolactone"], sev: "major", text: "High risk of life-threatening hyperkalemia." }
      ]
    },
    "ambroxol + levosalbutamol": {
      generic: "Ambroxol + Levosalbutamol",
      cls: "Mucolytic & Bronchodilator",
      tags: ["mucolytic", "bronchodilator", "beta_agonist"],
      sideEffects: ["Fine tremors of hands, rapid heartbeat (palpitations), headache", "Mild nausea or dry mouth"],
      redFlags: ["Severe chest tightness, extreme racing pulse (>120 bpm), paradoxical wheezing"],
      counseling: "Take after food. Tremors usually subside as your body adjusts. If breathing worsens, seek immediate medical care.",
      timingBadge: "After Food with Water",
      interactions: [
        { withTags: ["beta_blocker", "propranolol", "metoprolol", "carvedilol"], sev: "major", text: "Beta-blockers can block bronchodilation and precipitate severe bronchospasm." }
      ]
    },
    "levocetirizine + montelukast": {
      generic: "Levocetirizine + Montelukast",
      cls: "Antihistamine + Leukotriene Antagonist",
      tags: ["antihistamine", "leukotriene_antagonist", "allergy"],
      sideEffects: ["Mild drowsiness or fatigue, dry mouth, headache"],
      redFlags: ["Unusual mood or behavioral changes, agitation, sleep disturbances", "Severe allergic skin rash"],
      counseling: "Take once daily in the evening. Avoid driving or alcohol if drowsiness occurs.",
      timingBadge: "At Bedtime (Evening)",
      interactions: [
        { withTags: ["sedative", "alcohol", "benzodiazepine"], sev: "moderate", text: "Additive central nervous system sedation." }
      ]
    },
    "cetirizine": {
      generic: "Cetirizine",
      cls: "Antihistamine",
      tags: ["antihistamine", "allergy"],
      sideEffects: ["Mild drowsiness, dry mouth, fatigue"],
      redFlags: ["Severe allergic reaction", "Urinary retention"],
      counseling: "Best taken at bedtime. Avoid alcohol during treatment.",
      timingBadge: "At Bedtime (Evening)",
      interactions: [
        { withTags: ["sedative", "alcohol"], sev: "moderate", text: "Enhanced CNS depression." }
      ]
    },
    "cefixime": {
      generic: "Cefixime",
      cls: "3rd Gen Cephalosporin Antibiotic",
      tags: ["cephalosporin", "beta_lactam", "antibiotic"],
      sideEffects: ["Loose stools, diarrhea, nausea, dyspepsia"],
      redFlags: ["Severe allergic rash / hives / wheezing", "Severe watery diarrhea (C. diff colitis)"],
      counseling: "May be taken with or without food. Complete the full course as prescribed.",
      timingBadge: "With or Without Food",
      interactions: [
        { withTags: ["warfarin"], sev: "moderate", text: "May enhance anticoagulant effect — monitor INR." }
      ]
    },
    "metronidazole": {
      generic: "Metronidazole",
      cls: "Nitroimidazole Antimicrobial",
      tags: ["antimicrobial", "antibiotic"],
      sideEffects: ["Metallic taste in mouth, mild nausea, dark urine (benign)"],
      redFlags: ["Severe numbness, tingling, peripheral neuropathy", "Seizures or ataxia (rare)"],
      counseling: "STRICTLY avoid alcohol during treatment and for at least 48 hours after finishing (disulfiram-like reaction). Take with food.",
      timingBadge: "With Food · Avoid Alcohol",
      interactions: [
        { withTags: ["alcohol"], sev: "critical", text: "Disulfiram-like reaction with severe vomiting, tachycardia and flushing." },
        { withTags: ["warfarin"], sev: "major", text: "Potentiates warfarin effect via CYP2C9 inhibition — monitor INR." }
      ]
    },
    "metformin": {
      generic: "Metformin",
      cls: "Biguanide Antihyperglycemic",
      tags: ["antidiabetic", "biguanide"],
      sideEffects: ["GI upset: diarrhea, nausea, abdominal fullness, metallic taste"],
      redFlags: ["Lactic acidosis: malaise, severe muscle aches, respiratory distress, hypothermia"],
      counseling: "Take with or immediately after meals to minimize stomach upset. Swallow whole with water.",
      timingBadge: "With Meals",
      interactions: [
        { withTags: ["contrast"], sev: "major", text: "Withhold prior to iodinated contrast procedures to prevent lactic acidosis." },
        { withTags: ["alcohol"], sev: "major", text: "Excessive alcohol potentiates risk of lactic acidosis." }
      ]
    },
    "amlodipine": {
      generic: "Amlodipine",
      cls: "Calcium Channel Blocker (CCB)",
      tags: ["antihypertensive", "ccb"],
      sideEffects: ["Peripheral edema (ankle swelling), headache, flushing, dizziness"],
      redFlags: ["Severe lightheadedness, syncope upon standing, worsening chest pain on initiation"],
      counseling: "Take once daily at the same time each day. Elevate feet if mild ankle swelling occurs.",
      timingBadge: "Once Daily (Morning)",
      interactions: [
        { withTags: ["simvastatin"], sev: "moderate", text: "Increases simvastatin levels — do not exceed simvastatin 20mg daily." }
      ]
    },
    "telmisartan": {
      generic: "Telmisartan",
      cls: "Angiotensin II Receptor Blocker (ARB)",
      tags: ["antihypertensive", "arb"],
      sideEffects: ["Dizziness, mild fatigue, back or leg pain"],
      redFlags: ["Facial/lip swelling (angioedema), lightheadedness, sudden reduction in urination"],
      counseling: "Take with or without food at the same time daily. Avoid potassium supplements without medical advice.",
      timingBadge: "Morning · Same Time Daily",
      interactions: [
        { withTags: ["nsaid", "diclofenac", "ibuprofen"], sev: "major", text: "May reduce antihypertensive efficacy and increase risk of acute renal impairment." },
        { withTags: ["potassium", "spironolactone"], sev: "major", text: "Risk of hyperkalemia." }
      ]
    },
    "atorvastatin": {
      generic: "Atorvastatin",
      cls: "Statin Lipid-Lowering",
      tags: ["statin", "lipid_lowering"],
      sideEffects: ["Mild muscle aches, headache, digestive discomfort"],
      redFlags: ["Unexplained severe muscle pain, tenderness, weakness, dark/tea-colored urine (rhabdomyolysis)"],
      counseling: "Take once daily in the evening or at bedtime. Avoid excessive grapefruit juice.",
      timingBadge: "At Bedtime",
      interactions: [
        { withTags: ["macrolide", "clarithromycin"], sev: "major", text: "CYP3A4 inhibition increases statin concentration and myopathy risk." },
        { withTags: ["gemfibrozil"], sev: "major", text: "Substantially elevates rhabdomyolysis risk." }
      ]
    }
  };

  var BRAND_ALIASES = {
    "azithro": "azithromycin", "azee": "azithromycin", "zithromax": "azithromycin", "zady": "azithromycin", "azithral": "azithromycin",
    "crocin": "paracetamol", "dolo": "paracetamol", "calpol": "paracetamol", "pcm": "paracetamol", "pacimol": "paracetamol", "sumo": "paracetamol",
    "pan": "pantoprazole", "pantop": "pantoprazole", "pantocid": "pantoprazole", "pantodac": "pantoprazole",
    "omez": "omeprazole", "prilosec": "omeprazole",
    "rablet": "rabeprazole", "happi": "rabeprazole",
    "augmentin": "amoxicillin + clavulanic acid", "moxikind-cv": "amoxicillin + clavulanic acid", "clavam": "amoxicillin + clavulanic acid", "clavicid": "amoxicillin + clavulanic acid",
    "amox": "amoxicillin", "mox": "amoxicillin", "novamox": "amoxicillin",
    "ascoril": "ambroxol + levosalbutamol", "ascoril ls": "ambroxol + levosalbutamol", "bro-zedex": "ambroxol + levosalbutamol",
    "emeset": "ondansetron", "ondem": "ondansetron", "vomikind": "ondansetron",
    "voveran": "diclofenac", "voltaren": "diclofenac",
    "brufen": "ibuprofen", "combiflam": "ibuprofen",
    "cifran": "ciprofloxacin", "ciptab": "ciprofloxacin", "cipro": "ciprofloxacin",
    "zifi": "cefixime", "mahacef": "cefixime", "taxim-o": "cefixime",
    "montair-lc": "levocetirizine + montelukast", "telekast-l": "levocetirizine + montelukast", "montek-lc": "levocetirizine + montelukast",
    "cetzine": "cetirizine", "alerid": "cetirizine", "zyrtec": "cetirizine",
    "flagyl": "metronidazole", "metrogyl": "metronidazole",
    "glycomet": "metformin", "glyciphage": "metformin",
    "stamlo": "amlodipine", "amlopres": "amlodipine", "norvasc": "amlodipine",
    "telma": "telmisartan", "telmikind": "telmisartan", "micardis": "telmisartan",
    "atorva": "atorvastatin", "lipitor": "atorvastatin", "atorlip": "atorvastatin",
    "doxy": "doxycycline", "doxy-1": "doxycycline", "doxycycline": "doxycycline",
    "aspirin": "aspirin", "ecosprin": "aspirin", "disprin": "aspirin", "asa": "aspirin",
    "lasix": "furosemide", "furosemide": "furosemide",
    "cardace": "ramipril", "ramipril": "ramipril"
  };

  function normalizeDrugName(raw) {
    if (!raw) return "";
    var s = String(raw).toLowerCase().trim();
    s = s.replace(/\([^)]*\)/g, " ").trim();
    s = s.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|ml|iu|%)\b/g, " ");
    s = s.replace(/\b(?:tablet|tablets|tab|tabs|syrup|syp|capsule|caps|cap|injection|inj|drops|solution|suspension|oral|gel|cream)\b/g, " ");
    s = s.replace(/[^a-z0-9\s\+\-\/]/g, " ").replace(/\s+/g, " ").trim();
    if (BRAND_ALIASES[s]) return BRAND_ALIASES[s];
    for (var b in BRAND_ALIASES) {
      if (s === b || s.indexOf(b + " ") === 0 || s.indexOf(" " + b) > -1) return BRAND_ALIASES[b];
    }
    for (var k in RX_CLINICAL_KB) {
      if (s === k || s.indexOf(k) > -1) return k;
    }
    return s;
  }

  function getDrugTimingBadge(drugName, freq) {
    var norm = normalizeDrugName(drugName);
    var kb = RX_CLINICAL_KB[norm];
    var badge = (kb && kb.timingBadge) || "";
    if (badge) return badge;

    var f = String(freq || "").trim();
    if (!f) return "";
    if (/\b(?:a\.?c\.?|before\s*(?:meals?|food)|empty\s*stomach)\b/i.test(f)) return "Before Food";
    if (/\b(?:p\.?c\.?|after\s*(?:meals?|food)|with\s*food)\b/i.test(f)) return "After Food";
    if (/\b(?:h\.?s\.?|bedtime|night|evening|at\s*night)\b/i.test(f)) return "At Bedtime";
    if (/\b(?:s\.?o\.?s\.?|prn|as\s*needed)\b/i.test(f)) return "As Needed";
    if (/\b(?:stat|immediate(?:ly)?)\b/i.test(f)) return "STAT";
    if (/\b(?:od|once\s*daily)\b/i.test(f)) return "Once Daily";
    if (/\b(?:bd|bid|twice\s*daily)\b/i.test(f)) return "Twice Daily";
    if (/\b(?:tds|tid|thrice\s*daily|three\s*times)\b/i.test(f)) return "Thrice Daily";
    if (/\b(?:qid|four\s*times)\b/i.test(f)) return "4 Times Daily";
    return "";
  }

  function analyzeRegimenSafety(lines, allergiesStr, patientAge) {
    var outFindings = [];
    var meds = (lines || []).filter(function (L) { return !L.advice && (L.drug || L.brand); });

    var alg = String(allergiesStr || "").toLowerCase().split(/[,;]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 2; });
    if (alg.length) {
      meds.forEach(function (m) {
        var raw = m.drug || m.brand || "";
        var norm = normalizeDrugName(raw);
        var info = RX_CLINICAL_KB[norm] || {};
        var tags = (info.tags || []).concat(info.cls ? [String(info.cls).toLowerCase()] : []).concat(info.generic ? [String(info.generic).toLowerCase()] : []);
        var names = [m.drug, m.brand].filter(Boolean).map(function (s) { return String(s).toLowerCase(); }).concat(tags);

        alg.forEach(function (a) {
          var matched = false;
          for (var ni = 0; ni < names.length; ni++) {
            var n = names[ni];
            if (n && (n.indexOf(a) > -1 || a.indexOf(n) > -1)) { matched = true; break; }
          }
          if (!matched) {
            if (/penicillin|amox|ampicil|augmentin|clav/i.test(a) && (tags.indexOf("penicillin") > -1 || tags.indexOf("beta_lactam") > -1 || /amox|ampicil|penicillin/i.test(norm))) matched = true;
            else if (/sulfa|sulfonamide/i.test(a) && (tags.indexOf("sulfa") > -1 || tags.indexOf("sulfonamide") > -1 || /sulfa|cotrimoxazole/i.test(norm))) matched = true;
            else if (/nsaid|aspirin|brufen|ibuprofen|diclofenac/i.test(a) && (tags.indexOf("nsaid") > -1 || /ibuprofen|diclofenac|aceclofenac|naproxen|piroxicam/i.test(norm))) matched = true;
            else if (/cephalosporin|cefixime|ceftriaxone/i.test(a) && (tags.indexOf("cephalosporin") > -1 || /^cef/i.test(norm))) matched = true;
            else if (/macrolide|azithromycin|clarithromycin/i.test(a) && (tags.indexOf("macrolide") > -1 || /azithro|clarithro|erythro/i.test(norm))) matched = true;
            else if (/fluoroquinolone|cipro|oflox/i.test(a) && (tags.indexOf("fluoroquinolone") > -1 || /cipro|oflox|levoflox/i.test(norm))) matched = true;
          }
          if (matched) {
            outFindings.push({
              sev: "critical",
              type: "allergy",
              txt: "Documented Allergy — patient has reported reaction to “" + a + "”; " + (m.drug || m.brand) + " is prescribed"
            });
          }
        });
      });
    }

    // Pediatric & Age-Specific Safety Precautions
    var ageNum = null;
    if (patientAge != null && patientAge !== "") {
      var mAge = String(patientAge).match(/(\d+(?:\.\d+)?)\s*(y(?:ears?|rs?)?|months?|mos?|days?|d)\b/i);
      if (mAge) {
        var val = parseFloat(mAge[1]);
        var unit = (mAge[2] || "y").toLowerCase();
        if (unit.indexOf("mo") === 0) ageNum = val / 12;
        else if (unit.indexOf("d") === 0) ageNum = val / 365;
        else ageNum = val;
      } else {
        var mBare = String(patientAge).match(/^\s*(\d+(?:\.\d+)?)\s*(?:[/\s]*[MFmf])?\s*$/);
        if (mBare) ageNum = parseFloat(mBare[1]);
      }
    }

    if (ageNum !== null) {
      meds.forEach(function (m) {
        var raw = m.drug || m.brand || "";
        var norm = normalizeDrugName(raw);
        var info = RX_CLINICAL_KB[norm] || {};
        var tags = info.tags || [];
        var gen = (info.generic || raw);

        if (ageNum < 18 && (tags.indexOf("fluoroquinolone") > -1 || /cipro|levoflox|oflox|moxiflox|norflox/i.test(norm))) {
          outFindings.push({
            sev: "major",
            type: "pediatric",
            txt: "Pediatric Precaution: " + gen + " (fluoroquinolone) is generally contraindicated in patients < 18y due to risk of cartilage and tendon toxicity."
          });
        }
        if (ageNum < 8 && (tags.indexOf("tetracycline") > -1 || /doxycycl|tetracycl|minocycl/i.test(norm))) {
          outFindings.push({
            sev: "major",
            type: "pediatric",
            txt: "Pediatric Alert: " + gen + " (tetracycline) is contraindicated in children < 8y due to permanent tooth discoloration and enamel hypoplasia."
          });
        }
        if (ageNum < 16 && (tags.indexOf("salicylate") > -1 || /aspirin|acetylsalicylic/i.test(norm))) {
          outFindings.push({
            sev: "critical",
            type: "pediatric",
            txt: "Pediatric Warning: Aspirin / Salicylate in children/teens < 16y with viral illnesses carries severe risk of fatal Reye’s syndrome."
          });
        }
        if (ageNum < 12 && /codeine|tramadol/i.test(norm)) {
          outFindings.push({
            sev: "critical",
            type: "pediatric",
            txt: "Pediatric Contraindication: Codeine/Tramadol contraindicated in children < 12y due to unpredictable metabolism and respiratory depression risk."
          });
        }
      });
    }

    // High-Risk Multi-Drug Combinations:
    // 1. Triple Whammy (NSAID + Diuretic + ACEi/ARB) -> Acute Kidney Injury (AKI)
    var hasNsaid = false, hasDiuretic = false, hasAceiArb = false;
    var nsaidNames = [], diureticNames = [], aceiArbNames = [], ppiNames = [];

    meds.forEach(function (m) {
      var raw = m.drug || m.brand || "";
      var norm = normalizeDrugName(raw);
      var info = RX_CLINICAL_KB[norm] || {};
      var tags = info.tags || [];
      var gen = (info.generic || raw);

      if (tags.indexOf("nsaid") > -1 || /diclofenac|ibuprofen|naproxen|aceclofenac|indomethacin|ketorolac|piroxicam|mefenamic/i.test(norm)) {
        hasNsaid = true;
        if (nsaidNames.indexOf(gen) === -1) nsaidNames.push(gen);
      }
      if (tags.indexOf("diuretic") > -1 || /furosemide|torsemide|hydrochlorothiazide|chlorthalidone|spironolactone|indapamide/i.test(norm)) {
        hasDiuretic = true;
        if (diureticNames.indexOf(gen) === -1) diureticNames.push(gen);
      }
      if (tags.indexOf("acei") > -1 || tags.indexOf("arb") > -1 || /ramipril|enalapril|lisinopril|perindopril|telmisartan|losartan|olmesartan|valsartan|candesartan/i.test(norm)) {
        hasAceiArb = true;
        if (aceiArbNames.indexOf(gen) === -1) aceiArbNames.push(gen);
      }
      if (tags.indexOf("ppi") > -1 || /pantoprazole|omeprazole|rabeprazole|esomeprazole|lansoprazole/i.test(norm)) {
        if (ppiNames.indexOf(gen) === -1) ppiNames.push(gen);
      }
    });

    if (hasNsaid && hasDiuretic && hasAceiArb) {
      outFindings.push({
        sev: "critical",
        type: "high_risk",
        txt: "CRITICAL: High-Risk 'Triple Whammy' — Concurrent NSAID (" + nsaidNames.join("/") + ") + Diuretic (" + diureticNames.join("/") + ") + ACEi/ARB (" + aceiArbNames.join("/") + ") severely impairs renal hemodynamics, precipitating Acute Kidney Injury (AKI)."
      });
    }

    // 2. Duplicate NSAID therapy
    if (nsaidNames.length >= 2) {
      outFindings.push({
        sev: "major",
        type: "duplicate",
        txt: "Duplicate NSAID therapy: " + nsaidNames.join(" + ") + " — concurrent NSAIDs increase gastrointestinal ulceration and hemorrhage risk without added analgesia."
      });
    }

    // 3. Duplicate PPI therapy
    if (ppiNames.length >= 2) {
      outFindings.push({
        sev: "moderate",
        type: "duplicate",
        txt: "Duplicate PPI therapy: " + ppiNames.join(" + ") + " — redundant acid suppression."
      });
    }

    try {
      if (window.INTERACTIONS && window.INTERACTIONS.checkInteractions && meds.length >= 2) {
        var r = window.INTERACTIONS.checkInteractions(meds.map(function (m) { return { generic: m.drug || m.brand }; })) || {};
        ["critical", "major", "moderate"].forEach(function (sev) {
          (r[sev] || []).forEach(function (f) {
            outFindings.push({
              sev: sev,
              type: "ddi",
              txt: (f.drugs || []).join(" + ") + ": " + (f.effect || f.mechanism || "interaction") + (f.action ? " — " + f.action : "")
            });
          });
        });
        (r.duplicates || []).forEach(function (f) {
          var dupTxt = "Duplicate therapy: " + (f.drugs || []).join(" + ");
          if (!outFindings.some(function (x) { return x.type === "duplicate" && x.txt.indexOf(f.drugs[0]) > -1; })) {
            outFindings.push({
              sev: "moderate",
              type: "duplicate",
              txt: dupTxt
            });
          }
        });
      }
    } catch (e) {}

    var resolvedMeds = [];
    var seenKeys = {};
    meds.forEach(function (line) {
      var raw = line.drug || line.brand || "";
      var norm = normalizeDrugName(raw);
      var info = RX_CLINICAL_KB[norm];
      if (!info && window.MEDDRUGS && (window.MEDDRUGS._list || window.MEDDRUGS.all)) {
        var list = window.MEDDRUGS._list || window.MEDDRUGS.all || [];
        var drugMatch = list.filter(function (d) {
          if (!d.generic) return false;
          var dg = d.generic.toLowerCase();
          return dg === norm || norm.indexOf(dg) > -1 || dg.indexOf(norm) > -1;
        })[0];
        if (drugMatch) {
          info = {
            generic: drugMatch.generic,
            cls: drugMatch.cls || drugMatch.cat || "Formulary Drug",
            tags: [(drugMatch.cls || "").toLowerCase(), (drugMatch.cat || "").toLowerCase()],
            sideEffects: [],
            redFlags: drugMatch.notes ? [drugMatch.notes] : [],
            counseling: drugMatch.dose ? ("Dosing guide: " + drugMatch.dose) : "",
            timingBadge: "",
            interactions: []
          };
        }
      }
      if (info && !seenKeys[norm]) {
        seenKeys[norm] = true;
        resolvedMeds.push({
          key: norm,
          prescribed: raw,
          brand: line.brand || "",
          info: info
        });
      }
    });

    for (var i = 0; i < resolvedMeds.length; i++) {
      for (var j = i + 1; j < resolvedMeds.length; j++) {
        var a = resolvedMeds[i], b = resolvedMeds[j];
        var aTags = a.info.tags || [], bTags = b.info.tags || [];
        (a.info.interactions || []).forEach(function (rule) {
          var hit = rule.withTags.some(function (t) {
            return bTags.indexOf(t) > -1 || b.info.generic.toLowerCase().indexOf(t) > -1;
          });
          if (hit) {
            var pairTxt = a.info.generic + " + " + b.info.generic + ": " + rule.text;
            var already = outFindings.some(function (f) { return f.txt.indexOf(a.info.generic) > -1 && f.txt.indexOf(b.info.generic) > -1; });
            if (!already) {
              outFindings.push({
                sev: rule.sev || "major",
                type: "ddi",
                txt: pairTxt
              });
            }
          }
        });
      }
    }

    var rank = { critical: 0, major: 1, moderate: 2 };
    outFindings.sort(function (a, b) { return (rank[a.sev] == null ? 3 : rank[a.sev]) - (rank[b.sev] == null ? 3 : rank[b.sev]); });

    var counselingBullets = [];
    resolvedMeds.forEach(function (rm) {
      if (rm.info.counseling) {
        counselingBullets.push(rm.info.generic + ": " + rm.info.counseling);
      }
    });

    return {
      findings: outFindings,
      medications: resolvedMeds,
      counselingBullets: counselingBullets
    };
  }

  function rxSafetyFindings() {
    var d = collectRx();
    var alg = (((sheet && sheet.querySelector && sheet.querySelector("#rxAllergies")) || {}).value || "");
    var age = (((sheet && sheet.querySelector && sheet.querySelector("#rxPtAge")) || {}).value || "");
    var res = analyzeRegimenSafety(d.lines, alg, age);
    return res.findings;
  }

  function rxSafetyHTML() {
    var d = collectRx();
    var alg = (((sheet && sheet.querySelector && sheet.querySelector("#rxAllergies")) || {}).value || "");
    var age = (((sheet && sheet.querySelector && sheet.querySelector("#rxPtAge")) || {}).value || "");
    var safety = analyzeRegimenSafety(d.lines, alg, age);
    if (!safety.findings.length && !safety.medications.length) return "";

    var col = {
      critical: ["#fef2f2", "#991b1b", "#ef4444"],
      major: ["#fffbeb", "#92400e", "#f59e0b"],
      moderate: ["#f8fafc", "#475569", "#94a3b8"]
    };

    var alertsHtml = "";
    if (safety.findings.length) {
      alertsHtml = '<div style="margin-bottom:10px">' +
        safety.findings.map(function (w) {
          var c = col[w.sev] || col.moderate;
          return '<div style="font:500 12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;padding:7px 10px;border-radius:8px;margin:4px 0;background:' + c[0] + ';color:' + c[1] + ';border-left:3px solid ' + c[2] + '">' +
            '<b>' + (w.sev === "critical" ? "ALLERGY WARNING" : (w.sev === "major" ? "MAJOR INTERACTION" : "PRECAUTION")) + ':</b> ' + esc(w.txt) +
          '</div>';
        }).join("") +
      '</div>';
    }

    var drugsHtml = "";
    if (safety.medications.length) {
      drugsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-bottom:8px">' +
        safety.medications.map(function (m) {
          var se = (m.info.sideEffects || []).join(", ");
          var rf = (m.info.redFlags || []).join("; ");
          return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#334155;line-height:1.4">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">' +
              '<span style="font-weight:700;color:#0f172a;font-size:12px">' + esc(m.info.generic) + '</span>' +
              '<div style="display:flex;align-items:center;gap:5px;flex:none">' +
                '<span style="font:600 9px -apple-system,sans-serif;background:#f1f5f9;color:#475569;padding:1px 5px;border-radius:4px">' + esc(m.info.cls) + '</span>' +
                '<button type="button" class="rx-mono-btn" data-gen="' + esc(m.info.generic) + '" title="View prescribing monograph">Monograph ↗</button>' +
              '</div>' +
            '</div>' +
            (se ? '<div style="margin-bottom:3px"><b>Side effects:</b> ' + esc(se) + '</div>' : '') +
            (rf ? '<div style="color:#b91c1c;margin-bottom:3px"><b>Red flags:</b> ' + esc(rf) + '</div>' : '') +
            (m.info.counseling ? '<div style="color:#0e6e63"><b>Counseling:</b> ' + esc(m.info.counseling) + '</div>' : '') +
          '</div>';
        }).join("") +
      '</div>';
    }

    var addBtnHtml = "";
    if (safety.counselingBullets.length) {
      addBtnHtml = '<div style="display:flex;justify-content:flex-end;margin-top:6px">' +
        '<button type="button" class="rx-safety-add-btn" id="rxAddSafetyToAdvice" style="display:inline-flex;align-items:center;gap:5px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font:600 11px -apple-system,BlinkMacSystemFont,sans-serif;padding:4px 9px;border-radius:6px;cursor:pointer">' +
          '+ Add Safety &amp; Instructions to Advice' +
        '</button>' +
      '</div>';
    }

    var badgeText = safety.findings.length ? (safety.findings.length + ' alert' + (safety.findings.length > 1 ? 's' : '')) : 'Regimen verified';
    var badgeCol = safety.findings.length ? '#b45309' : '#047857';
    var badgeBg = safety.findings.length ? '#fef3c7' : '#d1fae5';

    return '<div style="margin:12px 0 8px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;font:700 12px -apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a">' +
          rxIco("warn") + ' <span>Clinical Safety &amp; Patient Counseling</span>' +
        '</div>' +
        '<span style="font:700 9.5px -apple-system,sans-serif;text-transform:uppercase;letter-spacing:.04em;background:' + badgeBg + ';color:' + badgeCol + ';padding:2px 7px;border-radius:4px">' + badgeText + '</span>' +
      '</div>' +
      alertsHtml +
      drugsHtml +
      addBtnHtml +
    '</div>';
  }

  function refreshSafety() {
    var s = sheet && sheet.querySelector("#rxSafety");
    if (!s) return;
    s.innerHTML = rxSafetyHTML();
    s.querySelectorAll(".rx-mono-btn").forEach(function (b) {
      b.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var g = b.getAttribute("data-gen");
        if (!g) return;
        if (window.MEDDB && typeof window.MEDDB.openComposition === "function") {
          window.MEDDB.openComposition(g);
        } else if (window.MEDAPI && typeof window.MEDAPI.monograph === "function") {
          window.MEDAPI.monograph(g);
        } else {
          try { rxToast("Monograph: " + g); } catch (err) {}
        }
      };
    });
    var addBtn = s.querySelector("#rxAddSafetyToAdvice");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        var d = collectRx();
        var alg = (((sheet && sheet.querySelector("#rxAllergies")) || {}).value || "");
        var age = (((sheet && sheet.querySelector("#rxPtAge")) || {}).value || "");
        var safety = analyzeRegimenSafety(d.lines, alg, age);
        if (!safety.counselingBullets.length) return;
        var advText = safety.counselingBullets.join(" | ");
        var advLine = null;
        sheet.querySelectorAll("#rxLines .rx-line.adv").forEach(function (ln) {
          if (ln.style.display !== "none") advLine = ln;
        });
        if (advLine) {
          var inp = advLine.querySelector('[data-f="drug"]');
          if (inp) {
            var cur = (inp.value || "").trim();
            if (!cur) {
              inp.value = advText;
            } else if (cur.indexOf(safety.counselingBullets[0]) === -1) {
              inp.value = cur + " | " + advText;
            }
          }
        } else {
          var wrap = sheet.querySelector("#rxLines");
          if (wrap) {
            var idx = wrap.children.length;
            wrap.insertAdjacentHTML("beforeend", lineHTML({ drug: advText, isAdvice: true }, idx));
            rxLabelInputs();
            bindDel();
          }
        }
        rxToast("Safety instructions added to Advice");
      });
    }
  }

  function rxDocSafetySection(opts) {
    if (opts && opts.includeSafety === false) return "";
    var d = collectRx();
    var alg = ((sheet && sheet.querySelector && sheet.querySelector("#rxAllergies")) || {}).value || "";
    var safety = analyzeRegimenSafety(d.lines, alg, d.age);
    if (!safety.medications.length && !safety.findings.length) return "";

    var cells = safety.medications.map(function (m) {
      var se = (m.info.sideEffects || []).join(", ");
      var rf = (m.info.redFlags || []).join("; ");
      return '<div class="rxdoc-safety-cell">' +
        '<div class="rxdoc-safety-drug">' + esc(m.info.generic) + ' <span style="font-size:8.5px;font-weight:normal;color:#64748b">(' + esc(m.info.cls) + ')</span></div>' +
        (se ? '<div style="margin-bottom:2px"><b>Common side effects:</b> ' + esc(se) + '</div>' : '') +
        (rf ? '<div style="color:#991b1b;margin-bottom:2px"><b>Alert doctor if:</b> ' + esc(rf) + '</div>' : '') +
        (m.info.counseling ? '<div style="color:#0e6e63"><b>Instructions:</b> ' + esc(m.info.counseling) + '</div>' : '') +
      '</div>';
    }).join("");

    var warnBlock = "";
    if (safety.findings.length) {
      warnBlock = '<div class="rxdoc-safety-warn">' +
        '<b>Clinical Interaction &amp; Allergy Precautions:</b><br>' +
        safety.findings.map(function (f) { return '&bull; ' + esc(f.txt); }).join("<br>") +
      '</div>';
    }

    return '<div class="rxdoc-safety-card">' +
      '<div class="rxdoc-safety-hd">' +
        '<span class="rxdoc-safety-badge">' +
          '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0e6e63" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:3px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>' +
          'Patient Instructions &amp; Safety Notes' +
        '</span>' +
        '<span class="rxdoc-safety-sub">Advisory guidance to support safe medicine use</span>' +
      '</div>' +
      '<div class="rxdoc-safety-grid">' + cells + '</div>' +
      warnBlock +
    '</div>';
  }

  // Price + generic-substitute awareness: when a drug's generic is set, show the lowest-cost brand (and the
  // spread) inline, so the doctor can prescribe the affordable option. Async, fails silently (no API -> no hint).
  function showPriceHint(line, generic) {
    if (!line) return;
    var hint = line.querySelector(".rx-price-hint");
    if (rxcOn()) {
      if (hint) hint.textContent = "";
      return;
    }
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
        // Brand ONLY: drug, dose, frequency and duration stay exactly as the doctor wrote them.
        // The audit record for this decision is written by rxchoice-ui pick(); Doctor Prescribed
        // restores the original brand through the same path (opt IS the original product there).
        if (bi && opt && opt.brand) { bi.value = opt.brand; try { bi.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {} }
        if (!sheet._rxChoice) sheet._rxChoice = {};
        sheet._rxChoice[(rows[i] && rows[i].drug) || ("line" + i)] = opt;
        if (st) {
          // Copies, never aliases: the inline tray writes its own resolutions into
          // sheet._rxChoice._allResults by index as the doctor keeps typing, and an aliased
          // array would let those writes overwrite this panel's live results - so a SELECT
          // followed by KEEP would "restore" the just-selected brand instead of the original.
          sheet._rxChoice._allResults = (st.results || []).slice();
          sheet._rxChoice._allLines = (st.lines || []).slice();
          sheet._rxChoice._allSelected = (st.selected || []).slice();
        }
        try { refreshSafety(); } catch (e) {}   // re-run allergy + interaction checks with the newly selected product
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
          // Brand ONLY: the drug, dose, frequency and duration inputs on this line are never
          // touched. Doctor Prescribed restores the original brand through this same path.
          brandIn.value = opt.brand;
          try { brandIn.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
          try {
            if (window.SMD_RXCHOICE_UI && SMD_RXCHOICE_UI.recordSelection) SMD_RXCHOICE_UI.recordSelection(allRes || res, cat, { prescriptionId: null });
          } catch (e) {}

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

          try { refreshSafety(); } catch (e) {}   // re-run allergy + interaction checks with the newly selected product
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
      '<div class="rx-head">' +
        '<div class="rx-handle-bar"></div>' +
        '<div class="rx-head-inner">' +
          '<button class="rx-x" id="rxX" aria-label="Back">' + '<span class="rx-back-chevron" aria-hidden="true">&#8249;</span> Back</button>' +
          '<div class="rx-head-title">' +
            '<span class="rx-title-main">Prescription <span class="rx-saved-indicator"><span class="rx-saved-dot"></span> Draft saved</span></span>' +
            '<span class="rx-title-sub">Dr. ' + esc(docName() || "—") + '</span>' +
          '</div>' +
          '<button class="rx-top-export rx-print" id="rxTopExport" title="Export prescription">' + rxIco("print") + ' PDF</button>' +
        '</div>' +
      '</div>' +
      '<div class="rx-scroll-body" id="rxScrollBody">' +
        '<div class="rx-disc">Draft prescription — verify every drug, dose, route and interaction against the patient and local protocol. The prescriber is responsible for what they sign.</div>' +
        '<div class="rx-clinic-slot" id="rxClinicSlot">' + clinicSummaryHTML() + '</div>' +
        '<div class="rx-pt-card">' +
          '<div class="rx-pt-card-title">Patient &amp; Clinical Summary</div>' +
          '<div class="rx-pt-row rx-pt-grid">' +
            '<label class="rx-field">Patient name<input class="rx-in" id="rxPtName" placeholder="Patient name" aria-label="Patient name"></label>' +
            '<label class="rx-field">Age / sex<input class="rx-in" id="rxPtAge" placeholder="Age / Sex" aria-label="Age or Sex"></label>' +
          '</div>' +
          '<div class="rx-pt-row">' +
            '<label class="rx-field">Diagnosis<input class="rx-in" id="rxDx" placeholder="Diagnosis (e.g. CAP, HTN)" value="' + esc(topic || "") + '" aria-label="Diagnosis"></label>' +
          '</div>' +
          '<div class="rx-pt-row rx-pt-grid">' +
            '<label class="rx-field">Chief complaints<input class="rx-in" id="rxCc" placeholder="Chief complaints" aria-label="Complaints"></label>' +
            '<label class="rx-field">Vitals<input class="rx-in" id="rxVitals" placeholder="Vitals (BP, HR, SpO₂)" aria-label="Vitals"></label>' +
          '</div>' +
          '<div class="rx-pt-row">' +
            '<label class="rx-field">Drug allergies<input class="rx-in" id="rxAllergies" placeholder="Known drug allergies (optional)" aria-label="Known allergies"></label>' +
          '</div>' +
        '</div>' +
        '<div class="rx-sec-head">' +
          '<span class="rx-symbol">℞</span>' +
          '<span class="rx-sec-title">Prescribed Medications</span>' +
        '</div>' +
        '<div id="rxLines">' + lines.map(lineHTML).join("") + '</div>' +
        '<div class="rx-safety" id="rxSafety"></div>' +
        '<div class="rx-tpl-card">' +
          '<div class="rx-tpl-row">' +
            '<select id="rxTpl" class="rx-tpl-sel">' + tplOptions() + '</select>' +
            '<button class="rx-btn rx-tpl-btn" id="rxTplSave">+ Save Template Set</button>' +
          '</div>' +
        '</div>' +
        '<div class="rx-sign-bar">' +
          '<div class="rx-sign-dr">Dr. ' + esc(docName() || "—") + '</div>' +
          '<div class="rx-sign-meta">Reg. No: ' + esc(regNo || "—") + ' · ' + esc(date) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rx-dock" id="rxDock">' +
        '<div class="rx-dock-quick">' +
          '<button class="rx-btn rx-add" id="rxAdd">+ Drug</button>' +
          '<button class="rx-btn rx-mic" id="rxMic" title="Dictate a drug">' + rxIco("mic") + ' Dictate</button>' +
          (rxcOn() ? '<button class="rx-btn rx-rxc" id="rxcOpen" title="Same prescription, smarter price">RxChoice™</button>' : "") +
        '</div>' +
        '<button class="rx-btn rx-print rx-hero-export" id="rxExport" title="Save and export verified prescription">' + rxIco("print") + ' Save &amp; Export PDF</button>' +
      '</div>';
    show(body);
    sheet.querySelector("#rxX").addEventListener("click", function () {
      var d = collectRx();
      if (d && (d.name || d.dx || (d.lines && d.lines.length > 1) || (d.lines && d.lines[0] && d.lines[0].drug))) {
        if (!window.confirm("Discard draft prescription?")) return;
      }
      close();
    });
    var _topExp = sheet.querySelector("#rxTopExport");
    if (_topExp) _topExp.addEventListener("click", function () { try { signAndExport(topic, regNo); } catch (e) {} });
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
    var _sl = sheet.querySelector("#rxLines");
    if (_sl) {
      _sl.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest && e.target.closest(".rx-freq-pill");
        if (!btn) return;
        e.preventDefault();
        var p = btn.getAttribute("data-freq");
        var ln = btn.closest(".rx-line");
        if (ln && p) {
          var freqInp = ln.querySelector('[data-f="freq"]');
          if (freqInp) {
            freqInp.value = p;
            ln.querySelectorAll(".rx-freq-pill").forEach(function (b) {
              b.classList.toggle("active", b.getAttribute("data-freq") === p);
            });
            updateLineTiming(ln);
            refreshSafety();
            try { freqInp.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
          }
        }
      });
      _sl.addEventListener("input", function (e) {
        if (!e.target || !e.target.getAttribute) return;
        var f = e.target.getAttribute("data-f");
        if (f === "drug" || f === "freq") {
          var ln = e.target.closest(".rx-line");
          if (ln) {
            if (f === "freq") {
              var val = (e.target.value || "").toUpperCase().trim();
              ln.querySelectorAll(".rx-freq-pill").forEach(function (b) {
                b.classList.toggle("active", b.getAttribute("data-freq") === val);
              });
            }
            updateLineTiming(ln);
          }
          if (f === "drug") refreshSafety();
        }
      });
    }
    var _al = sheet.querySelector("#rxAllergies"); if (_al) _al.addEventListener("input", refreshSafety);
    var _ag = sheet.querySelector("#rxPtAge"); if (_ag) _ag.addEventListener("input", refreshSafety);
    // Templates: apply a saved set, or save the current drugs as a named set.
    var _tpl = sheet.querySelector("#rxTpl"); if (_tpl) _tpl.onchange = function () { var i = +this.value; if (i >= 0) { var t = rxTemplates()[i]; if (t) applyTemplate(t.lines); this.value = "-1"; } };
    var _tplS = sheet.querySelector("#rxTplSave"); if (_tplS) _tplS.onclick = function () {
      var ls = (collectRx().lines || []).filter(function (l) { return !l.advice && l.drug; });
      if (!ls.length) { try { window.toast && window.toast("Add drugs first"); } catch (e) {} return; }
      var nm = ""; try { nm = (window.prompt("Name this Rx template set (e.g. URI, UTI, HTN):") || "").trim(); } catch (e) {}
      if (!nm) return;
      var a = rxTemplates(); a.push({ name: nm, lines: ls.map(function (l) { return { drug: l.drug, brand: l.brand, dose: l.dose, freq: l.freq, duration: l.duration }; }) }); saveRxTemplates(a);
      try { window.toast && window.toast("Saved Rx template: " + nm); } catch (e) {}
      var s = sheet.querySelector("#rxTpl"); if (s) s.innerHTML = tplOptions();
    };
    // Voice-to-Rx: dictate a drug line ("amox 500 TDS 5 days"), parse it, add the row.
    var _mic = sheet.querySelector("#rxMic");
    if (_mic) _mic.onclick = function () {
      var V = window.SMD_VOICE;
      if (!(V && V.openDialog)) { rxSay("Voice not available on this device"); return; }
      V.openDialog({
        target: "text",
        onText: function (txt) {
          var p = parseVoiceRx(txt);
          if (p && p.drug) { applyTemplate([p]); rxSay("Added: " + p.drug); return; }
          var heard = String(txt || "").trim();
          rxSay(heard ? ('Could not read a drug from "' + heard.slice(0, 40) + '"') : "Nothing was heard - try again.");
        }
      });
    };
    function bindDel() { sheet.querySelectorAll(".rx-del").forEach(function (b) { b.onclick = function () { var ln = b.closest(".rx-line"); if (ln) { ln.remove(); refreshSafety(); } }; }); }
  }

  function gate() {
    show(
      '<div class="rx-head">' +
        '<div class="rx-handle-bar"></div>' +
        '<div class="rx-head-inner">' +
          '<button class="rx-x" id="rxX" aria-label="Back">' + '<span class="rx-back-chevron" aria-hidden="true">&#8249;</span> Back</button>' +
          '<div class="rx-head-title"><span class="rx-title-main">Prescriber Details</span></div>' +
          '<div style="width:32px"></div>' +
        '</div>' +
      '</div>' +
      '<div class="rx-scroll-body">' +
        '<div class="rx-gate">Enter your <b>NMC registration number</b> to create prescriptions. It is stored on this device and printed on your prescriptions.' +
        '<input class="rx-in" id="rxNmc" placeholder="NMC registration number" inputmode="numeric" style="margin-top:12px"></div>' +
      '</div>' +
      '<div class="rx-dock">' +
        '<button class="rx-btn rx-print rx-hero-export" id="rxSaveNmc" style="width:100%;justify-content:center">Save &amp; continue</button>' +
      '</div>'
    );
    sheet.querySelector("#rxX").addEventListener("click", close);
    sheet.querySelector("#rxSaveNmc").addEventListener("click", function () {
      var v = (sheet.querySelector("#rxNmc").value || "").trim();
      if (!v) { sheet.querySelector("#rxNmc").focus(); return; }
      setNmc(v); close(); setTimeout(function () { if (window.__rxPending) { open(window.__rxPending); window.__rxPending = null; } }, 60);
    });
  }

  // Verified-doctors-only prompt (shown when the gate is present but the user isn't verified).
  function verifyRequired() {
    show(
      '<div class="rx-head">' +
        '<div class="rx-handle-bar"></div>' +
        '<div class="rx-head-inner">' +
          '<button class="rx-x" id="rxX" aria-label="Back">' + '<span class="rx-back-chevron" aria-hidden="true">&#8249;</span> Back</button>' +
          '<div class="rx-head-title"><span class="rx-title-main">Doctor Verification</span></div>' +
          '<div style="width:32px"></div>' +
        '</div>' +
      '</div>' +
      '<div class="rx-scroll-body">' +
        '<div class="rx-gate">Only <b>verified doctors</b> can create prescriptions. Verify your medical registration once — the pad then opens with your <b>registered number</b> printed on every Rx.</div>' +
      '</div>' +
      '<div class="rx-dock">' +
        '<button class="rx-btn rx-print rx-hero-export" id="rxVerify" style="width:100%;justify-content:center">Verify my registration</button>' +
      '</div>'
    );
    sheet.querySelector("#rxX").addEventListener("click", close);
    sheet.querySelector("#rxVerify").addEventListener("click", function () { close(); try { window.SMD_VERIFY.openPanel(); } catch (e) {} });
  }

  function open(ctx) {
    ensureEls();
    try {
      if (typeof smdLazy === "function") {
        smdLazy('/interaction-rules.js?v=gold363').then(function () {
          try { refreshSafety(); } catch (e) {}
        });
      }
    } catch (e) {}
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
    ov.innerHTML='<div class="rx-bp rx-sign-sheet">' +
      '<div class="rx-bp-h"><div><b>Doctor Signature</b><div style="font-size:11px;color:#64748b;font-weight:normal;margin-top:2px">Sign with your finger or upload an image</div></div><button class="rx-bp-x" aria-label="Close">'+rxIco("close")+'</button></div>' +
      '<div style="font-size:12px;color:#475569;margin:8px 0 4px">Draw signature in the box below:</div>' +
      '<canvas class="rx-sign-cv" width="600" height="200"></canvas>' +
      '<label class="rx-sign-reuse" style="margin:8px 0 12px;cursor:pointer"><input type="checkbox" id="rxSignSave" '+(saved?'checked':'')+' style="width:16px;height:16px;accent-color:#0e6e63"><span>Save &amp; reuse signature on this device</span></label>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<button class="rx-btn rx-add" id="rxSignClear" style="flex:1;justify-content:center">Clear</button>' +
        '<label class="rx-btn rx-add" style="flex:1;justify-content:center;cursor:pointer">Upload<input type="file" id="rxSignUp" accept="image/*" style="display:none"></label>' +
        '<button class="rx-btn rx-print rx-hero-export" id="rxSignUse" style="flex:1.5;justify-content:center">Use signature →</button>' +
      '</div></div>';
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
    function cleanupSign() {
      try { window.removeEventListener("mouseup", up); } catch (e) {}
      ov.remove();
    }
    ov.querySelector(".rx-bp-x").addEventListener("click", cleanupSign);
    ov.querySelector("#rxSignClear").addEventListener("click", function(){ ctx.clearRect(0,0,cv.width,cv.height); drew=false; upImg=""; });
    ov.querySelector("#rxSignUp").addEventListener("change", function(){ var f=this.files&&this.files[0]; if(f) rxImgToDataURL(f,600,function(d){ upImg=d; drew=true; var im=new Image(); im.onload=function(){ ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(im,0,0,cv.width,cv.height); }; im.src=d; }); });
    ov.querySelector("#rxSignUse").addEventListener("click", function(){ if(!drew){ rxToast("Please sign or upload first"); return; } var data=upImg||cv.toDataURL("image/png"); setSign(ov.querySelector("#rxSignSave").checked?data:""); cleanupSign(); if(onDone) onDone(data); });
  }
  // StewardMD logo → data-URL once (via Image→canvas, so it renders reliably inside html2canvas,
  // on web AND native, with no image-load timing race). Falls back to a text wordmark until ready.
  var _smdLogoData = "";
  (function preloadSmdLogo(){ try{ var img=new Image(); img.onload=function(){ try{ var c=document.createElement("canvas"); c.width=img.naturalWidth||368; c.height=img.naturalHeight||368; c.getContext("2d").drawImage(img,0,0); _smdLogoData=c.toDataURL("image/png"); }catch(e){} }; img.src="/logo.png"; }catch(e){} })();
  // ---- Professional Rx document + PDF/JPEG export ----
  function rxDoc(topic, regNo, signImg, rxv){
    var opts = arguments[4] || {};
    var d=(opts && opts.rxData) || collectRx(), c=getClinic(), date=""; try{ date=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){}
    var dn = docName() || "—";
    if (dn && !/^dr\.?\s+/i.test(dn) && dn !== "—") dn = "Dr. " + dn;
    var n=0;
    var rows=d.lines.map(function(L){
      if(L.advice) return '<tr class="advr"><td class="sn"></td><td colspan="2" class="dg"><div class="rxdoc-adv-box"><span class="rxdoc-adv-lbl">ADVICE</span> ' + esc(L.text) + '</div></td></tr>';
      n++;
      var sub=[L.dose,L.freq,L.duration].filter(Boolean).join(" · ");
      var numStr = n < 10 ? '0' + n : String(n);
      var timing = getDrugTimingBadge(L.drug, L.freq);
      var timingHtml = timing ? ' <span class="rxdoc-timing-chip">' + esc(timing) + '</span>' : '';
      return '<tr class="rxdoc-row-med"><td class="sn">' + numStr + '</td><td class="dg"><div class="rxdoc-drug-nm"><b>' + esc(L.drug) + '</b>' + (L.brand ? ' <span class="br">(' + esc(L.brand) + ')</span>' : '') + '</div>' + (sub ? '<div class="dz">' + esc(sub) + timingHtml + '</div>' : (timingHtml ? '<div class="dz">' + timingHtml + '</div>' : '')) + '</td></tr>';
    }).join("");
    var node=document.createElement("div"); node.className="rx-doc";
    node.innerHTML='<div class="rxdoc-in">' +
      '<div class="rxdoc-hd">' +
        '<div class="rxdoc-hd-left">' +
          (c.logo ? '<img class="rxdoc-logo" src="' + esc(c.logo) + '">' : '') +
          '<div class="rxdoc-cl">' +
            '<div class="rxdoc-nm">' + esc(c.name || dn || "Prescription") + '</div>' +
            (c.address ? '<div class="rxdoc-ad">' + esc(c.address) + '</div>' : '') +
            '<div class="rxdoc-reg-top">Reg. No: ' + esc(regNo || "—") + '</div>' +
            (c.phone ? '<div class="rxdoc-ad" style="font-size:11px">Ph: ' + esc(c.phone) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="rxdoc-hd-right">' +
          '<div class="rxdoc-hd-badge">Clinical Prescription</div>' +
          '<div class="rxdoc-hd-date">' + esc(date) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rxdoc-rule"></div>' +
      '<div class="rxdoc-meta-card">' +
        '<div class="rxdoc-meta-grid">' +
          '<div class="rxdoc-meta-cell"><div class="rxdoc-meta-lbl">PATIENT</div><div class="rxdoc-meta-val"><b>' + esc(d.name || "—") + '</b>' + (d.age ? '<span class="rxdoc-meta-sub">' + esc(d.age) + '</span>' : '') + '</div></div>' +
          '<div class="rxdoc-meta-cell"><div class="rxdoc-meta-lbl">DATE OF VISIT</div><div class="rxdoc-meta-val">' + esc(date) + '</div></div>' +
          ((d.dx || topic) ? '<div class="rxdoc-meta-cell"><div class="rxdoc-meta-lbl">DIAGNOSIS</div><div class="rxdoc-meta-val"><span class="rxdoc-pill-dx">' + esc(d.dx || topic) + '</span></div></div>' : '<div class="rxdoc-meta-cell"></div>') +
        '</div>' +
        ((d.complaints || d.vitals || d.allergies) ? (
          '<div class="rxdoc-meta-divider"></div><div class="rxdoc-meta-grid">' +
          (d.complaints ? '<div class="rxdoc-meta-cell"><div class="rxdoc-meta-lbl">CHIEF COMPLAINTS</div><div class="rxdoc-meta-val">' + esc(d.complaints) + '</div></div>' : '') +
          (d.vitals ? '<div class="rxdoc-meta-cell"><div class="rxdoc-meta-lbl">VITALS</div><div class="rxdoc-meta-val">' + esc(d.vitals) + '</div></div>' : '') +
          (d.allergies ? '<div class="rxdoc-meta-cell" style="grid-column:span 2"><div class="rxdoc-meta-lbl">KNOWN ALLERGIES</div><div class="rxdoc-meta-val" style="color:#d70015;font-weight:600">' + esc(d.allergies) + '</div></div>' : '') +
          '</div>'
        ) : '') +
      '</div>' +
      '<div class="rxdoc-rx-header"><span class="rxdoc-rx-sym">℞</span><span class="rxdoc-rx-title">PRESCRIPTION</span></div>' +
      '<table class="rxdoc-tbl">' + (rows || '<tr><td colspan="2" class="dz">No items prescribed.</td></tr>') + '</table>' +
      rxcPrintSection(opts) +
      rxDocSafetySection(opts) +
      '<div class="rxdoc-ft">' +
        '<table class="rxdoc-ft-tbl"><tr>' +
          '<td class="rxdoc-ft-auth">' + rxDocQrBlock(rxv) + '</td>' +
          '<td class="rxdoc-ft-sg">' +
            '<div class="rxdoc-sg">' +
              (signImg ? '<img class="rxdoc-sgimg" src="' + esc(signImg) + '">' : '') +
              '<div class="rxdoc-drn">' + esc(dn) + '</div>' +
              '<div class="rxdoc-reg">Reg. No: ' + esc(regNo || "—") + '</div>' +
            '</div>' +
          '</td>' +
        '</tr></table>' +
      '</div>' +
      '<div class="rxdoc-foot">' +
        '<div class="rxdoc-brand">' +
          '<svg class="rxdoc-smd-icon" viewBox="0 0 24 24"><path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3M9 12.5v5a3.5 3.5 0 0 0 7 0v-2M16 15.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/></svg>' +
          '<span>Prescription&nbsp;generated&nbsp;using&nbsp;<b style="color:#0e6e63">StewardMD</b></span>' +
        '</div>' +
        '<div class="rxdoc-resp">Digitally signed &amp; verified by the prescriber named above, who takes complete responsibility for this prescription. Verify every drug, dose, route and interaction against the patient and local protocol before dispensing.</div>' +
      '</div></div>';
    return node;
  }
  function rxSaveOrShare(dataURL, filename){
    if (rxNative()) {
      var P = rxPlugins();
      var b64 = (dataURL.split(",")[1] || "");
      if (P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
        P.Filesystem.writeFile({ path: filename, data: b64, directory: "CACHE" })
          .then(function () {
            if (P.Filesystem.getUri) return P.Filesystem.getUri({ path: filename, directory: "CACHE" });
            return { uri: "" };
          })
          .then(function (res) {
            return P.Share.share({ title: "Prescription", url: (res && res.uri) || "", dialogTitle: "Save or share prescription" });
          })
          .catch(function () { rxToast("Export failed"); });
        return;
      }
    }
    try { var a = document.createElement("a"); a.href = dataURL; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { rxToast("Export failed"); }
  }
  /* Mint BEFORE rendering, exactly as doRxPrint does - html2canvas rasterises whatever the node
   * holds at that instant, so a record arriving later would be a PDF with an empty box where the QR
   * should be. Same fail-open contract: rxIssueVerification never rejects, and an out-of-scope or
   * offline prescription still exports, just without a QR (and rxNoQrWhy says which). */
  function exportRx(kind, topic, regNo, signImg){
    var opts = arguments[4] || {};
    var lazy = window.smdLazy || function () { return Promise.resolve(); };
    var v1 = window.html2canvas ? Promise.resolve() : lazy('/vendor-html2canvas.js?v=1');
    var p = kind === "pdf"
      ? v1.then(function () { return (window.jspdf || window.jsPDF) ? Promise.resolve() : lazy('/vendor-jspdf.js?v=1'); })
      : v1;
    p.then(function() {
      var d=collectRx()||{}, lines=d.lines;
      rxIssueVerification(lines, d.name).then(function(rxv){
        if(!rxv){ var why=rxNoQrWhy(lines); if(why) rxToast(why); }
        exportRxNow(kind, topic, regNo, signImg, rxv, opts);
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
    var opts = arguments[5] || {};
    // JPEG is a single image, so the block sits in the document. A PDF can run to several pages, so
    // it is left OUT of the document and stamped onto every page below.
    var node=rxDoc(topic, regNo, signImg, kind==="pdf" ? null : rxv, opts);
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
    function chooser(sig){
      var hasRxChoice = !!(sheet && sheet._rxChoice && sheet._rxChoice._allResults && sheet._rxChoice._allResults.length);
      var ov=document.createElement("div"); ov.className="rx-bp-ov";
      ov.innerHTML='<div class="rx-bp rx-exp">' +
        '<div class="rx-handle-bar" style="margin:0 auto 10px"></div>' +
        '<div class="rx-bp-h"><div><b style="font-size:16px">Export &amp; Issue Prescription</b><div style="font-size:11px;color:#047857;font-weight:600;margin-top:2px;display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Digitally signed &amp; verified document</div></div><button class="rx-bp-x" aria-label="Close">'+rxIco("close")+'</button></div>' +
        '<div style="margin:14px 0 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:12px">' +
          '<label class="rx-switch-row">' +
            '<div><span style="display:block;font-size:13px;font-weight:600;color:#0f172a">Include RxChoice™ 4-way cost options</span><span style="font-size:11px;color:#64748b;font-weight:normal">Displays generic &amp; alternative pricing table</span></div>' +
            '<span class="rx-toggle"><input type="checkbox" id="rxExpChoice"' + (hasRxChoice ? ' checked' : ' disabled') + '><span class="rx-slider"></span></span>' +
          '</label>' +
          '<label class="rx-switch-row">' +
            '<div><span style="display:block;font-size:13px;font-weight:600;color:#0f172a">Include Patient Safety &amp; Instructions Notes</span><span style="font-size:11px;color:#64748b;font-weight:normal">Adds common side effects, red flags &amp; meal timing</span></div>' +
            '<span class="rx-toggle"><input type="checkbox" id="rxExpSafety" checked><span class="rx-slider"></span></span>' +
          '</label>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">' +
          '<button class="rx-btn rx-print rx-hero-export rx-exp-primary-btn" id="rxExpPdf">' +
            rxIco("print") + '<span>Save as PDF (Recommended)</span>' +
          '</button>' +
          '<button class="rx-btn rx-add rx-exp-sec-btn" id="rxExpJpg">' +
            '<span>Save as JPEG image</span>' +
          '</button>' +
        '</div>' +
        '<div id="rxExpStatus" style="font-size:11.5px;color:#0e6e63;text-align:center;margin-top:10px;display:none;font-weight:600"></div>' +
      '</div>';
      sheet.appendChild(ov);
      ov.querySelector(".rx-bp-x").addEventListener("click", function(){ ov.remove(); });
      ov.querySelector("#rxExpPdf").addEventListener("click", function(){
        var incChoice = ov.querySelector("#rxExpChoice") ? ov.querySelector("#rxExpChoice").checked : false;
        var incSafety = ov.querySelector("#rxExpSafety") ? ov.querySelector("#rxExpSafety").checked : true;
        var btn = this; btn.disabled = true; btn.style.opacity = "0.7";
        rxToast("Generating prescription PDF…");
        setTimeout(function(){
          ov.remove();
          exportRx("pdf", topic, regNo, sig, { includeRxChoice: incChoice, includeSafety: incSafety });
        }, 150);
      });
      ov.querySelector("#rxExpJpg").addEventListener("click", function(){
        var incChoice = ov.querySelector("#rxExpChoice") ? ov.querySelector("#rxExpChoice").checked : false;
        var incSafety = ov.querySelector("#rxExpSafety") ? ov.querySelector("#rxExpSafety").checked : true;
        var btn = this; btn.disabled = true; btn.style.opacity = "0.7";
        rxToast("Generating prescription JPEG…");
        setTimeout(function(){
          ov.remove();
          exportRx("jpeg", topic, regNo, sig, { includeRxChoice: incChoice, includeSafety: incSafety });
        }, 150);
      });
    }
    var existing=getSign(); if(existing) chooser(existing); else openSignPad(function(sig){ chooser(sig); });
  }

  // openVerify is deliberately NOT gated on canPrescribe(): checking someone else's prescription is
  // not prescribing, and the pharmacist doing it may not be a prescriber at all.
  window.SMD_RX = { open: open, openVerify: openVerify, canPrescribe: canPrescribe, verifiedInfo: verifiedInfo, _getNmc: getNmc, _setNmc: setNmc, getClinic: getClinic, _parseVoiceRx: parseVoiceRx, _analyzeRegimenSafety: analyzeRegimenSafety, _getDrugTimingBadge: getDrugTimingBadge, _rxDoc: rxDoc };

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
