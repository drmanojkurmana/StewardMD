/* StewardMD — premium home (v2), flag-gated.
   Activates only at ?home=v2 (or localStorage smd_home_v2="1") so the live
   default homepage is untouched. Presentation layer only: every control
   delegates to the existing global functions. Nothing is removed. */
(function () {
  "use strict";
  function flagged() {
    try {
      if (/[?&]home=v2\b/.test(location.search)) { localStorage.setItem("smd_home_v2", "1"); return true; }
      if (/[?&]home=classic\b/.test(location.search)) { localStorage.removeItem("smd_home_v2"); return false; }
      return localStorage.getItem("smd_home_v2") === "1";
    } catch (e) { return /[?&]home=v2\b/.test(location.search); }
  }
  var IS_V2 = flagged();

  // Add an "Interface: Advanced UI (by MaiK) / Classic UI" switch into the existing
  // sidebar settings — in BOTH modes — so users can switch either way from Settings.
  function setupSidebarToggle(isV2) {
    function inject() {
      var menu = document.getElementById("sbMenu");
      if (!menu || menu.querySelector("[data-smd-ui]")) return;
      var bs = "display:block;width:100%;text-align:left;margin:6px 0 0;padding:11px 12px;border:1px solid var(--line,#d7dee3);border-radius:10px;background:var(--paper,#f6f7f5);color:var(--ink,#14202b);font:600 13px var(--sans,system-ui);cursor:pointer";
      var w = document.createElement("div"); w.setAttribute("data-smd-ui", "1");
      w.style.cssText = "padding:12px 14px;border-top:1px solid var(--line,#d7dee3);margin-top:8px";
      w.innerHTML = '<div style="font:700 11px/1.4 var(--sans,system-ui);text-transform:uppercase;letter-spacing:.05em;color:var(--slate-soft,#5a7184);margin-bottom:6px">Interface</div>' +
        '<button id="smdUiV2" style="' + bs + (isV2 ? ';border-color:var(--teal,#0e6e63);color:var(--teal,#0e6e63)' : '') + '">Advanced UI — by MaiK' + (isV2 ? '  &#10003;' : '') + '</button>' +
        '<button id="smdUiCl" style="' + bs + (!isV2 ? ';border-color:var(--teal,#0e6e63);color:var(--teal,#0e6e63)' : '') + '">Classic UI — previous' + (!isV2 ? '  &#10003;' : '') + '</button>';
      menu.appendChild(w);
      w.querySelector("#smdUiV2").onclick = function () { if (window.SMD_setUI) SMD_setUI(true); try { if (window.SB && SB.close) SB.close(); } catch (e) {} };
      w.querySelector("#smdUiCl").onclick = function () { if (window.SMD_setUI) SMD_setUI(false); try { if (window.SB && SB.close) SB.close(); } catch (e) {} };
    }
    try { if (window.SB && typeof SB.open === "function") { var orig = SB.open; SB.open = function () { var r = orig.apply(this, arguments); setTimeout(inject, 40); return r; }; } } catch (e) {}
    setTimeout(inject, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setupSidebarToggle(IS_V2); }); else setupSidebarToggle(IS_V2);

  var ICON = {
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
    shieldPlus: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>',
    stcase: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    framework: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    reasoning: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
    folder: '<path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    book: '<path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="12" y1="11" x2="12.01" y2="11"/><line x1="16" y1="11" x2="16.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pills: '<path d="M10.5 13.5 3 21M2 18a4 4 0 0 0 6 3l9-9a4 4 0 0 0-6-6L2 14a4 4 0 0 0 0 4Z"/>',
    home: '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 5 7 7-7 7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1Z"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'
  };
  function svg(name, cls) { return '<svg viewBox="0 0 24 24" class="' + (cls || "") + '">' + (ICON[name] || "") + '</svg>'; }
  function call(fn) { try { fn(); } catch (e) { console.warn("home action failed", e); } }
  function has(path) { try { return !!path(); } catch (e) { return false; } }

  var root, fab;
  function hideV2() { if (root) root.classList.remove("on"); if (fab) fab.classList.add("on"); }
  function showV2() { if (root) root.classList.add("on"); if (fab) fab.classList.remove("on"); var m = root && root.querySelector(".v3-main"); if (m) m.scrollTop = 0; }
  // Start a Case -> new-design Simple/Advanced chooser (rendered inside the v2 home), wired to the real cards.
  function openCaseChooser() {
    if (!root) build();
    root.classList.add("on"); if (fab) fab.classList.remove("on");
    var p = root.querySelector("#hvCase");
    if (!p) {
      p = document.createElement("div"); p.id = "hvCase"; p.className = "hv-casepanel";
      p.innerHTML =
        '<header class="hv-hdr"><button class="hv-ib" data-cx="back" aria-label="Back">' + svg("chev") + '</button><div class="hv-bz"><div><div class="hv-tt">Start a Case</div><div class="hv-ts">Choose how to enter findings</div></div></div></header>' +
        '<div class="hv-main"><div class="hv-stack">' +
          '<button class="hv-primary" data-m="simple"><div class="hv-pic">' + svg("reasoning") + '</div><div class="hv-pb"><div class="hv-ptit">Simple</div><div class="hv-psub">Guided, step-by-step — pick the problem, answer a few questions</div></div><div class="hv-parr">' + svg("arrow") + '</div></button>' +
          '<button class="hv-sec" data-m="advanced"><div class="hv-sic">' + svg("sliders") + '</div><div class="hv-pb"><div class="hv-stit">Advanced</div><div class="hv-ssub">Full clinical form — all findings, vitals, labs &amp; risk at once</div></div><div class="hv-sarr">' + svg("chev") + '</div></button>' +
          '<div class="hv-info">You can switch modes anytime from the header.</div>' +
        '</div></div>';
      root.appendChild(p);
      p.addEventListener("click", function (e) {
        if (e.target.closest('[data-cx="back"]')) { p.classList.remove("on"); return; }
        var b = e.target.closest("[data-m]"); if (!b) return;
        var m = b.getAttribute("data-m");
        p.classList.remove("on"); hideV2();
        var card = document.getElementById(m === "advanced" ? "modeAdvancedCard" : "modeSimpleCard");
        if (card) card.click(); else { var ms = document.getElementById("modeSelect"); if (ms) ms.classList.remove("hidden"); }
      });
    }
    p.classList.add("on");
  }
  // --- action delegates. Overlay screens (drawer/search/calculators/drugs/guidelines/about) layer OVER the v2 home
  //     (higher z-index) and return to it when closed — so we DON'T hide the home for them. Only in-shell flows hide it. ---
  var ACT = {
    startcase: function () { hideV2(); var ms = document.getElementById("modeSelect"), sh = document.querySelector(".shell"); if (ms) ms.classList.remove("hidden"); if (sh) sh.classList.remove("visible"); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) {} },
    reasoning: function () { hideV2(); if (window.DX && DX.openWorkspace) DX.openWorkspace(); else toast("Clinical Reasoning is loading…"); },
    search: function () { if (typeof openSearch === "function") openSearch(); else if (window.MEDDB) MEDDB.openList(); },
    cases: function () { if (typeof openMyCases === "function") openMyCases(); else toast("My Cases unavailable"); },
    calculators: function () { if (window.MEDCALC && MEDCALC.openList) MEDCALC.openList(); else toast("Calculators loading…"); },
    guidelines: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Guidelines loading…"); },
    drugs: function () { if (window.MEDDB && MEDDB.openList) MEDDB.openList(); else toast("Drugs database loading…"); },
    framework: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Framework"); },
    theme: function () { if (window.SB && SB.toggleTheme) SB.toggleTheme(); else document.body.classList.toggle("dark"); },
    menu: function () { if (window.SB && SB.open) SB.open(); },
    about: function () { if (window.SB && SB.modal) SB.modal("aboutModal"); else if (typeof openModal === "function") openModal("aboutModal"); },
    account: function () { if (window.SB && SB.open) SB.open(); },
    recent: function () { if (typeof openMyCases === "function") openMyCases(); }
  };
  function injectCSS() {
    if (document.getElementById("smd-home-css")) return;
    var st = document.createElement("style"); st.id = "smd-home-css";
    st.textContent = [
      "#homeV2{--hp:#0F766E;--hp2:#115E59;--hps:#CCFBF1;--hbg:#F8FAFC;--hpanel:#fff;--hbd:#E2E8F0;--hink:#0F172A;--hmut:#64748B;--hsh:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06);--hslg:0 8px 30px rgba(15,118,110,.22);--hfont:'Inter',-apple-system,'SF Pro Display','Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:120;background:var(--hbg);color:var(--hink);font-family:var(--hfont);overflow:hidden;display:none;flex-direction:column}",
      "#homeV2.on{display:flex}",
      "body.dark #homeV2{--hbg:#0B1220;--hpanel:#111B2E;--hbd:#1E2B43;--hink:#E7EDF5;--hmut:#8597AD;--hps:#0c2e2a;--hsh:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35)}",
      "#homeV2 svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}",
      "#homeV2 button{font-family:inherit;-webkit-tap-highlight-color:transparent}",
      ".hv-hdr{height:72px;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--hpanel);border-bottom:1px solid var(--hbd);padding-top:env(safe-area-inset-top);flex:0 0 auto}",
      ".hv-ib{width:42px;height:42px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--hink);border-radius:12px;cursor:pointer;transition:background .18s}.hv-ib:active{transform:scale(.94)}.hv-ib:hover{background:var(--hbg)}",
      ".hv-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--hp),var(--hp2));display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-mark svg{width:19px;height:19px;stroke:#fff}",
      ".hv-bz{display:flex;align-items:center;gap:10px;min-width:0}.hv-tt{font:800 16px/1.1 var(--hfont);letter-spacing:-.01em}.hv-ts{font:500 11.5px/1.2 var(--hfont);color:var(--hmut);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".hv-sp{flex:1}",
      ".hv-av{width:34px;height:34px;border-radius:50%;background:var(--hps);color:var(--hp);display:flex;align-items:center;justify-content:center;font:700 13px var(--hfont);border:1px solid var(--hbd);cursor:pointer}",
      ".hv-dot{position:relative}.hv-dot:after{content:'';position:absolute;top:9px;right:10px;width:7px;height:7px;border-radius:50%;background:#ef4444;border:2px solid var(--hpanel)}",
      ".hv-main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 16px 96px}.hv-stack{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:16px}",
      ".hv-hero{background:var(--hpanel);border:1px solid var(--hbd);border-radius:16px;box-shadow:var(--hsh);padding:20px;display:flex;align-items:center;gap:14px}",
      ".hv-hero h1{font:800 28px/1.05 var(--hfont);letter-spacing:-.02em;margin:0}.hv-tag{display:inline-block;margin-top:10px;font:700 11px var(--hfont);text-transform:uppercase;letter-spacing:.06em;color:var(--hp);background:var(--hps);padding:4px 10px;border-radius:999px}.hv-hero p{font:500 14px/1.45 var(--hfont);color:var(--hmut);margin:10px 0 0}",
      ".hv-shield{width:74px;height:74px;border-radius:20px;background:linear-gradient(135deg,var(--hp),var(--hp2));display:flex;align-items:center;justify-content:center;flex:0 0 auto;box-shadow:var(--hslg)}.hv-shield svg{width:38px;height:38px;stroke:#fff}",
      ".hv-qrow{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}",
      ".hv-qc{height:62px;background:var(--hpanel);border:1px solid var(--hbd);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;color:var(--hink);transition:transform .15s,box-shadow .18s}.hv-qc:active{transform:scale(.96)}.hv-qc:hover{box-shadow:var(--hsh)}.hv-qc svg{width:19px;height:19px;color:var(--hp)}.hv-qc span{font:600 11px var(--hfont);color:var(--hmut)}",
      ".hv-primary{display:flex;align-items:center;gap:15px;padding:20px;border:none;border-radius:18px;background:linear-gradient(135deg,#14B8A6,var(--hp) 55%,var(--hp2));color:#fff;box-shadow:var(--hslg);cursor:pointer;width:100%;text-align:left;transition:transform .15s,filter .18s}.hv-primary:active{transform:scale(.985)}.hv-primary:hover{filter:brightness(1.04)}",
      ".hv-pic{width:52px;height:52px;border-radius:15px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-pic svg{width:27px;height:27px;stroke:#fff}",
      ".hv-pb{flex:1;min-width:0}.hv-ptit{font:800 19px/1.1 var(--hfont);letter-spacing:-.01em}.hv-psub{font:500 13px/1.35 var(--hfont);color:rgba(255,255,255,.88);margin-top:3px}.hv-parr svg{stroke:#fff;opacity:.9}",
      ".hv-sec{display:flex;align-items:center;gap:15px;padding:18px 20px;border:1px solid var(--hbd);border-radius:18px;background:var(--hpanel);color:var(--hink);box-shadow:var(--hsh);cursor:pointer;width:100%;text-align:left;transition:transform .15s,box-shadow .18s}.hv-sec:active{transform:scale(.985)}",
      ".hv-sic{width:52px;height:52px;border-radius:15px;background:var(--hps);display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-sic svg{stroke:var(--hp);width:26px;height:26px}.hv-stit{font:700 17px/1.1 var(--hfont)}.hv-ssub{font:500 13px/1.35 var(--hfont);color:var(--hmut);margin-top:3px}.hv-sarr svg{stroke:var(--hmut)}",
      ".hv-lbl{font:700 12px var(--hfont);text-transform:uppercase;letter-spacing:.06em;color:var(--hmut);margin:2px 2px -4px}",
      ".hv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".hv-tile{background:var(--hpanel);border:1px solid var(--hbd);border-radius:16px;box-shadow:var(--hsh);padding:16px;display:flex;align-items:center;gap:12px;cursor:pointer;color:var(--hink);transition:transform .15s,box-shadow .18s}.hv-tile:active{transform:scale(.97)}",
      ".hv-tic{width:42px;height:42px;border-radius:12px;background:var(--hbg);display:flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid var(--hbd)}.hv-tic svg{width:21px;height:21px;color:var(--hp)}.hv-tl{font:600 14px var(--hfont)}.hv-tc{font:500 11.5px var(--hfont);color:var(--hmut);margin-top:1px}",
      ".hv-info{font:500 12px/1.6 var(--hfont);color:var(--hmut);text-align:center;padding:4px 8px}.hv-info b{color:var(--hink)}",
      ".hv-tab{position:absolute;left:0;right:0;bottom:0;background:var(--hpanel);border-top:1px solid var(--hbd);display:flex;justify-content:space-around;padding:6px 6px calc(6px + env(safe-area-inset-bottom));flex:0 0 auto}.hv-t{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0;border:none;background:transparent;color:var(--hmut);cursor:pointer;border-radius:12px}.hv-t svg{width:22px;height:22px}.hv-t span{font:600 10.5px var(--hfont)}.hv-t.active{color:var(--hp)}.hv-t:active{transform:scale(.93)}",
      // sheet (More / Display)
      ".hv-scrim{position:fixed;inset:0;background:rgba(8,18,26,.5);opacity:0;pointer-events:none;transition:opacity .2s;z-index:130}.hv-scrim.on{opacity:1;pointer-events:auto}",
      ".hv-sheet{position:fixed;left:0;right:0;bottom:0;z-index:131;background:var(--hpanel,#fff);color:var(--hink,#0F172A);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.22);transform:translateY(100%);transition:transform .26s cubic-bezier(.2,.7,.2,1);max-height:86vh;overflow-y:auto;font-family:var(--hfont)}.hv-sheet.on{transform:none}.hv-sheet-wrap{max-width:480px;margin:0 auto;padding:8px 18px calc(22px + env(safe-area-inset-bottom))}",
      ".hv-grab{width:38px;height:4px;border-radius:2px;background:var(--hbd);margin:8px auto 12px}",
      ".hv-sh-t{font:800 17px var(--hfont);margin:2px 0 12px}",
      ".hv-mi{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:transparent;border:none;border-radius:12px;padding:13px 8px;cursor:pointer;color:var(--hink)}.hv-mi:hover{background:var(--hbg)}.hv-mi:active{transform:scale(.99)}.hv-mi svg{width:21px;height:21px;color:var(--hp)}.hv-mi .ml{flex:1;font:600 14.5px var(--hfont)}.hv-mi .mc{font:500 12px var(--hfont);color:var(--hmut);margin-top:1px}.hv-mi .marr svg{stroke:var(--hmut);width:18px;height:18px}",
      ".hv-mi+.hv-mi{border-top:1px solid var(--hbd)}",
      // display engine controls
      ".hv-d-sec{margin:6px 0 16px}.hv-d-sec h4{font:800 11px var(--hfont);text-transform:uppercase;letter-spacing:.05em;color:var(--hmut);margin:0 0 9px}",
      ".hv-d-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}.hv-d-val{font:800 14px var(--hfont);color:var(--hp)}",
      "#homeV2 input[type=range],.hv-sheet input[type=range]{width:100%;accent-color:var(--hp);height:30px}",
      ".hv-seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.hv-seg button,.hv-pre button{background:var(--hbg);border:1.5px solid var(--hbd);border-radius:10px;padding:9px 6px;font:700 12px var(--hfont);color:var(--hmut);cursor:pointer}.hv-seg button.on{background:var(--hp);border-color:var(--hp);color:#fff}",
      ".hv-pre{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.hv-pre button{padding:12px 8px}",
      ".hv-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--hbg);border:1px solid var(--hbd);border-radius:12px;padding:11px 13px;margin-top:6px}.hv-sw .lab{font:700 13px var(--hfont)}.hv-sw .sub{font:500 11px var(--hfont);color:var(--hmut);margin-top:2px}.hv-tg{position:relative;width:48px;height:28px;flex:0 0 auto;border-radius:999px;background:var(--hbd);border:none;cursor:pointer;transition:.18s}.hv-tg.on{background:var(--hp)}.hv-tg:after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.18s}.hv-tg.on:after{left:23px}",
      ".hv-reset{width:100%;background:#fbe7e9;color:#ab1c2c;border:1px solid #efa9b1;border-radius:11px;padding:12px;font:700 13px var(--hfont);cursor:pointer;margin-top:6px}",
      ".hv-back{display:block;width:100%;text-align:center;color:var(--hmut);background:transparent;border:none;font:600 12px var(--hfont);padding:10px;cursor:pointer;margin-top:4px}",
      ".hv-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#0F172A;color:#fff;font:600 13px var(--hfont);padding:10px 16px;border-radius:11px;z-index:200;opacity:0;transition:opacity .2s;pointer-events:none}.hv-toast.on{opacity:.96}",
      ".hv-fab{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:125;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;box-shadow:0 8px 24px rgba(15,118,110,.42);align-items:center;justify-content:center;cursor:pointer;display:none}.hv-fab.on{display:flex}.hv-fab svg{stroke:#fff;width:24px;height:24px}.hv-fab:active{transform:scale(.92)}",
      // density (spacing) — independent of font zoom
      "body.smd-dens-compact #homeV2 .hv-stack{gap:11px}body.smd-dens-comfortable #homeV2 .hv-stack{gap:20px}body.smd-dens-large #homeV2 .hv-stack{gap:26px}",
      "body.smd-dens-compact #homeV2 .hv-hero{padding:14px}body.smd-dens-comfortable #homeV2 .hv-hero{padding:24px}body.smd-dens-large #homeV2 .hv-hero{padding:28px}",
      "body.smd-dens-compact #homeV2 .hv-tile,body.smd-dens-compact #homeV2 .hv-primary,body.smd-dens-compact #homeV2 .hv-sec{padding:13px}body.smd-dens-large #homeV2 .hv-tile{padding:20px}",
      // ===== Advanced UI theme — restyles the WHOLE app by overriding its design tokens (active only with body.ui-v2) =====
      "body.ui-v2{--teal:#0F766E;--teal-soft:#CCFBF1;--paper:#F8FAFC;--panel:#FFFFFF;--line:#E2E8F0;--ink:#0F172A;--slate:#334155;--slate-soft:#64748B;--sans:'Inter',-apple-system,'SF Pro Display','Segoe UI',Roboto,system-ui,sans-serif}",
      "body.ui-v2.dark{--paper:#0B1220;--panel:#111B2E;--line:#1E2B43;--ink:#E7EDF5;--slate:#9FB2C6;--slate-soft:#7E92A8;--teal:#2DD4BF;--teal-soft:#0C2E2A}",
      "body.ui-v2{font-family:var(--sans)}",
      "body.ui-v2 .card,body.ui-v2 .score-card,body.ui-v2 .quick-answer-card,body.ui-v2 .simple-candidates-card,body.ui-v2 .drug-card,body.ui-v2 .sp-card,body.ui-v2 .scm-card,body.ui-v2 .demo-card,body.ui-v2 .mcp-case-card,body.ui-v2 .aware-card,body.ui-v2 .no-match-card{border-radius:16px!important;border:1px solid var(--line)!important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06)!important}",
      "body.ui-v2 .mode-select-inner{max-width:480px;margin:0 auto}body.ui-v2 .mode-card{border-radius:16px!important;padding:18px!important;border:1px solid var(--line)!important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06)!important;transition:transform .15s,box-shadow .18s}body.ui-v2 .mode-card:active{transform:scale(.985)}",
      "body.ui-v2 .group-tab,body.ui-v2 .asp-tab,body.ui-v2 .inf-tab,body.ui-v2 .sbref-tab{border-radius:999px!important;padding:8px 15px!important;font-weight:600}",
      "body.ui-v2 .radio-opt,body.ui-v2 .scm-opt,body.ui-v2 .finding-item,body.ui-v2 .asp-opt,body.ui-v2 .simple-chip{border-radius:12px!important;min-height:44px}",
      "body.ui-v2 .numeric-field input,body.ui-v2 .numeric-field select,body.ui-v2 .sp-input,body.ui-v2 .inf-input,body.ui-v2 .calc-input,body.ui-v2 .scp-input,body.ui-v2 .tester-input{border-radius:12px!important;min-height:46px}",
      "body.ui-v2 .run-btn,body.ui-v2 .asp-launch-btn,body.ui-v2 .calc-btn,body.ui-v2 .scp-save-btn,body.ui-v2 .unlock-btn,body.ui-v2 .none-above-btn{border-radius:14px!important;min-height:52px!important;font-weight:700!important;letter-spacing:.01em}",
      "body.ui-v2 .step-nav-btn{border-radius:12px!important;min-height:48px!important;font-weight:600}body.ui-v2 .step-progress-fill{background:var(--teal)!important}",
      "body.ui-v2 .my-cases-btn,body.ui-v2 .smd-search-btn,body.ui-v2 .system-picker-btn,body.ui-v2 .asp-mini-btn,body.ui-v2 .inf-minibtn{border-radius:12px!important}",
      "body.ui-v2 .app-head{border-bottom:1px solid var(--line)}body.ui-v2 .brand{letter-spacing:-.01em}",
      "body.ui-v2 .score-chip,body.ui-v2 .sp-chip,body.ui-v2 .dash-chip,body.ui-v2 .factor-chip,body.ui-v2 .ref-chip,body.ui-v2 .evidence-pill,body.ui-v2 .simple-chip{border-radius:999px!important}",
      // in-form screens: system tabs, symptom/finding pickers, framework steps, score/results
      "body.ui-v2 .num{background:var(--teal)!important;color:#fff!important;border-radius:8px!important}",
      "body.ui-v2 .group-tabs{gap:8px}body.ui-v2 .group-tab.active{background:var(--teal)!important;color:#fff!important;border-color:var(--teal)!important}",
      "body.ui-v2 .finding-section{border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px;background:var(--panel)}",
      "body.ui-v2 .finding-item,body.ui-v2 .radio-opt,body.ui-v2 .scm-opt{padding:11px 12px;border:1px solid var(--line)!important}",
      "body.ui-v2 .radio-opt.selected,body.ui-v2 .finding-item.selected,body.ui-v2 .scm-opt.selected,body.ui-v2 .simple-chip.selected,body.ui-v2 .asp-opt.selected{background:var(--teal-soft)!important;border-color:var(--teal)!important;color:var(--teal)!important}",
      "body.ui-v2 .simple-section-label,body.ui-v2 .sp-section-label,body.ui-v2 .tier-label,body.ui-v2 .radio-field-label{font-weight:700;letter-spacing:.02em}",
      "body.ui-v2 .simple-chip-grid,body.ui-v2 .finding-grid{gap:8px}body.ui-v2 .simple-chip{padding:9px 13px;border:1px solid var(--line)!important}",
      "body.ui-v2 .step-progress-bar{border-radius:999px;overflow:hidden;background:var(--line)}body.ui-v2 .step-progress-fill{background:var(--teal)}body.ui-v2 .step-progress-label{font-weight:700}",
      "body.ui-v2 .findings-count{font-weight:600;color:var(--slate-soft)}",
      "body.ui-v2 .score-card-head,body.ui-v2 .qa-header,body.ui-v2 .sp-header,body.ui-v2 .mcp-header,body.ui-v2 .scm-opt-title{font-weight:800;letter-spacing:-.01em}",
      "body.ui-v2 .score-recommendation,body.ui-v2 .pregnancy-recommendation,body.ui-v2 .antibiogram-recommendation,body.ui-v2 .quick-answer-card{border-radius:14px!important;border:1px solid var(--line)!important}",
      "body.ui-v2 .coverage-table-wrap{border-radius:12px;overflow:auto;border:1px solid var(--line)}",
      "body.ui-v2 .system-picker-btn{border:1px solid var(--line)!important;border-radius:12px!important;min-height:48px}",
      "body.ui-v2 .pathogen-tier,body.ui-v2 .tier-very-likely,body.ui-v2 .tier-likely,body.ui-v2 .tier-possible{border-radius:12px!important}",
      "body.ui-v2 .sb-drawer{border-right:1px solid var(--line)}body.ui-v2 .sb-head{border-bottom:1px solid var(--line)}body.ui-v2 #sbMenu>div,body.ui-v2 #sbMenu>button{border-radius:12px}",
      "#homeV2 .hv-casepanel{position:absolute;inset:0;z-index:6;background:var(--hbg);display:none;flex-direction:column}#homeV2 .hv-casepanel.on{display:flex;animation:cfade .2s ease}@keyframes cfade{from{opacity:0}to{opacity:1}}",
      "@media(prefers-reduced-motion:reduce){#homeV2 *{transition:none!important;animation:none!important}}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    injectCSS(); injectV3CSS();
    root = document.createElement("div"); root.id = "homeV2"; root.className = "v3";
    root.innerHTML =
      '<header class="v3-header">' +
        '<button class="v3-ic" data-act="menu" aria-label="Menu">' + svg("menu") + '</button>' +
        '<div class="v3-brand"><div class="v3-mark">' + svg("shield") + '</div><div style="min-width:0"><div class="v3-brand-tt">StewardMD</div><div class="v3-brand-sub">Antibiotic Stewardship</div></div></div>' +
        '<div class="v3-spacer"></div>' +
        '<button class="v3-ic" data-act="theme" aria-label="Theme">' + svg("moon") + '</button>' +
        '<button class="v3-ic v3-dotbadge" data-act="more" aria-label="Notifications">' + svg("bell") + '</button>' +
        '<button class="v3-avatar" data-act="more" aria-label="Account">G</button>' +
      '</header>' +
      '<main class="v3-main"><div class="v3-stack">' +
        '<section class="v3-card v3-hero"><div style="flex:1;min-width:0"><h1 class="v3-h-hero">StewardMD</h1><span class="v3-tag">Antibiotic Decision Engine</span><p>Evidence-based antimicrobial recommendations at the point of care.</p></div><div class="v3-shield">' + svg("shieldPlus") + '</div></section>' +
        '<div class="v3-qrow">' +
          '<button class="v3-qc" data-act="more">' + svg("user") + '<span>Account</span></button>' +
          '<button class="v3-qc" data-act="search">' + svg("search") + '<span>Search</span></button>' +
          '<button class="v3-qc" data-act="framework">' + svg("framework") + '<span>Framework</span></button>' +
          '<button class="v3-qc" data-act="theme">' + svg("sun") + '<span>Theme</span></button>' +
        '</div>' +
        '<button class="v3-primary" data-act="startcase"><div class="ic">' + svg("stcase") + '</div><div style="flex:1;min-width:0"><div class="tt">Start a Case</div><div class="sub">New clinical decision — choose Simple or Advanced</div></div><div class="arr">' + svg("arrow") + '</div></button>' +
        '<button class="v3-secondary" data-act="reasoning"><div class="ic">' + svg("reasoning") + '</div><div style="flex:1;min-width:0"><div class="tt">Clinical Reasoning <span style="color:var(--v3-primary);font-size:12px;font-weight:700">(Beta)</span></div><div class="sub">Experimental step-by-step reasoning workspace</div></div><div class="arr">' + svg("chev") + '</div></button>' +
        '<div class="v3-sec-label">Quick access</div>' +
        '<div class="v3-grid">' +
          '<button class="v3-tile" data-act="cases"><div class="ic">' + svg("folder") + '</div><div style="min-width:0"><div class="tt">My Cases</div><div class="sub">Saved assessments</div></div></button>' +
          '<button class="v3-tile" data-act="guidelines"><div class="ic">' + svg("book") + '</div><div style="min-width:0"><div class="tt">Guidelines</div><div class="sub">IDSA · WHO · ICMR</div></div></button>' +
          '<button class="v3-tile" data-act="calculators"><div class="ic">' + svg("calc") + '</div><div style="min-width:0"><div class="tt">Calculators</div><div class="sub">50+ clinical tools</div></div></button>' +
          '<button class="v3-tile" data-act="drugs"><div class="ic">' + svg("pills") + '</div><div style="min-width:0"><div class="tt">Drugs DB</div><div class="sub">Brands · doses · price</div></div></button>' +
        '</div>' +
        '<div class="v3-foot">For qualified clinicians · <b>AI-summarised, verify doses</b></div>' +
      '</div></main>' +
      '<nav class="v3-tabbar">' +
        '<button class="v3-tab active" data-act="home">' + svg("home") + '<span>Home</span></button>' +
        '<button class="v3-tab" data-act="search">' + svg("search") + '<span>Search</span></button>' +
        '<button class="v3-tab" data-act="cases">' + svg("folder") + '<span>Cases</span></button>' +
        '<button class="v3-tab" data-act="guidelines">' + svg("book") + '<span>Guides</span></button>' +
        '<button class="v3-tab" data-act="more">' + svg("more") + '<span>More</span></button>' +
      '</nav>';
    document.body.appendChild(root);

    var scrim = document.createElement("div"); scrim.className = "hv-scrim"; scrim.id = "hvScrim"; document.body.appendChild(scrim);
    var sheet = document.createElement("div"); sheet.className = "hv-sheet"; sheet.id = "hvSheet"; document.body.appendChild(sheet);
    scrim.addEventListener("click", closeSheet);
    fab = document.createElement("button"); fab.className = "hv-fab"; fab.id = "hvFab"; fab.setAttribute("aria-label", "StewardMD home"); fab.innerHTML = svg("home"); document.body.appendChild(fab);
    fab.addEventListener("click", showV2);

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "more") return openMore();
      if (a === "home") { window.scrollTo(0, 0); var m = root.querySelector(".v3-main"); if (m) m.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (ACT[a]) ACT[a]();
    });
  }

  // ---- More sheet ----
  function sheetEl() { return document.getElementById("hvSheet"); }
  function openSheet(html) { var s = sheetEl(); s.innerHTML = '<div class="hv-sheet-wrap"><div class="hv-grab"></div>' + html + '</div>'; document.getElementById("hvScrim").classList.add("on"); s.classList.add("on"); }
  function closeSheet() { var s = sheetEl(); s.classList.remove("on"); document.getElementById("hvScrim").classList.remove("on"); }
  function mi(icon, label, cap, act) { return '<button class="hv-mi" data-mi="' + act + '">' + svg(icon) + '<div class="ml">' + label + (cap ? '<div class="mc">' + cap + '</div>' : '') + '</div><span class="marr">' + svg("chev") + '</span></button>'; }
  function openMore() {
    openSheet(
      '<div class="hv-sh-t">More</div>' +
      '<div class="hv-d-sec"><h4>Interface</h4><div class="hv-seg" id="hvUi" style="grid-template-columns:1fr 1fr">' +
        '<button data-ui="v2" class="on">Advanced UI<br><span style="font-weight:600;opacity:.85;font-size:10px">by MaiK</span></button>' +
        '<button data-ui="classic">Classic UI<br><span style="font-weight:600;opacity:.85;font-size:10px">previous</span></button>' +
      '</div></div>' +
      mi("info", "About StewardMD", "Version, credits, disclaimer", "about") +
      mi("user", "Account &amp; sign-in", "Google sign-in, guest session", "menu") +
      mi("spark", "Subscription", "Plans &amp; billing", "subscription") +
      mi("settings", "Display &amp; Accessibility", "Font size, density, auto-fit", "display") +
      mi("book", "Guidelines &amp; References", "IDSA · WHO · ICMR", "guidelines") +
      mi("calc", "Calculators", "50+ clinical tools", "calculators")
    );
    var s = sheetEl();
    s.querySelectorAll("[data-ui]").forEach(function (b) {
      b.addEventListener("click", function () { if (window.SMD_setUI) SMD_setUI(b.getAttribute("data-ui") === "v2"); });
    });
    s.querySelectorAll("[data-mi]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-mi");
        if (a === "display") return openDisplay();
        if (a === "subscription") return openSubscription();
        closeSheet();
        if (ACT[a]) ACT[a]();
      });
    });
  }
  function openSubscription() {
    openSheet('<div class="hv-sh-t">Subscription</div>' +
      '<p style="font:500 14px/1.6 var(--hfont);color:var(--hmut)">StewardMD is currently <b style="color:var(--hink)">free</b> for qualified clinicians. Premium plans (team workspaces, offline mode, institutional antibiograms) are coming soon.</p>' +
      '<button class="hv-reset" style="background:var(--hps);color:var(--hp);border-color:var(--hp)" data-close="1">Got it</button>');
    sheetEl().querySelector("[data-close]").addEventListener("click", closeSheet);
  }

  // ---- Display & Accessibility engine ----
  var DKEY = "smd_display_v1", DENS = { compact: 0.86, default: 1, comfortable: 1.18, large: 1.4 }, DDEF = { fontScale: 1, density: "default", autoFit: false };
  var ds = loadD();
  function loadD() { try { var o = JSON.parse(localStorage.getItem(DKEY)); if (o && o.density in DENS) return { fontScale: Math.min(1.5, Math.max(.8, +o.fontScale || 1)), density: o.density, autoFit: !!o.autoFit }; } catch (e) {} return Object.assign({}, DDEF); }
  function saveD() { try { localStorage.setItem(DKEY, JSON.stringify(ds)); } catch (e) {} }
  function applyD() {
    try { document.documentElement.style.zoom = ds.fontScale; } catch (e) {}
    document.body.classList.remove("smd-dens-compact", "smd-dens-comfortable", "smd-dens-large");
    if (ds.density !== "default") document.body.classList.add("smd-dens-" + ds.density);
    saveD();
  }
  function autoFitD() {
    var w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1, fs, d;
    if (w < 340) { fs = .9; d = "compact"; } else if (w < 400) { fs = .95; d = "compact"; } else if (w < 600) { fs = 1.0; d = "default"; } else if (w < 900) { fs = 1.08; d = "comfortable"; } else { fs = 1.15; d = "comfortable"; }
    if (w > h && h < 500) d = "compact";
    if (dpr >= 3 && w >= 400) fs = Math.min(1.2, fs + .05);
    ds.fontScale = fs; ds.density = d; applyD(); refreshD();
  }
  var DPRE = { default: { fontScale: 1, density: "default" }, small: { fontScale: .9, density: "compact" }, large: { fontScale: 1.15, density: "comfortable" }, senior: { fontScale: 1.4, density: "large" } };
  function openDisplay() {
    openSheet('<div class="hv-sh-t">Display &amp; Accessibility</div>' +
      '<div class="hv-d-sec"><div class="hv-d-row"><h4 style="margin:0">Font size</h4><span class="hv-d-val" id="hvFsv">100%</span></div><input type="range" id="hvFs" min="80" max="150" step="5" value="100"></div>' +
      '<div class="hv-d-sec"><h4>Display density</h4><div class="hv-seg" id="hvDens"><button data-d="compact">Compact</button><button data-d="default">Default</button><button data-d="comfortable">Comfort</button><button data-d="large">Large</button></div></div>' +
      '<div class="hv-d-sec"><h4>Quick presets</h4><div class="hv-pre" id="hvPre"><button data-p="default">Default</button><button data-p="small">Small screen</button><button data-p="large">Large screen</button><button data-p="senior">Senior friendly</button></div></div>' +
      '<div class="hv-d-sec"><h4>Auto fit</h4><div class="hv-sw"><div><div class="lab">Optimise for this device</div><div class="sub" id="hvDet"></div></div><button class="hv-tg" id="hvAuto"></button></div></div>' +
      '<button class="hv-reset" id="hvReset">Reset to defaults</button>' +
      '<div class="hv-info" style="margin-top:12px">Changes readability &amp; spacing only — never medical content. Saved on this device.</div>');
    var s = sheetEl();
    s.querySelector("#hvFs").addEventListener("input", function () { ds.autoFit = false; ds.fontScale = (+this.value) / 100; applyD(); refreshD(); });
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.addEventListener("click", function () { ds.autoFit = false; ds.density = b.getAttribute("data-d"); applyD(); refreshD(); }); });
    s.querySelectorAll("#hvPre button").forEach(function (b) { b.addEventListener("click", function () { var p = DPRE[b.getAttribute("data-p")]; ds.autoFit = false; ds.fontScale = p.fontScale; ds.density = p.density; applyD(); refreshD(); }); });
    s.querySelector("#hvAuto").addEventListener("click", function () { ds.autoFit = !ds.autoFit; if (ds.autoFit) autoFitD(); else { applyD(); refreshD(); } });
    s.querySelector("#hvReset").addEventListener("click", function () { ds = Object.assign({}, DDEF); applyD(); refreshD(); });
    refreshD();
  }
  function refreshD() {
    var s = sheetEl(); if (!s) return;
    var fs = s.querySelector("#hvFs"); if (fs) fs.value = Math.round(ds.fontScale * 100);
    var v = s.querySelector("#hvFsv"); if (v) v.textContent = Math.round(ds.fontScale * 100) + "%";
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-d") === ds.density); });
    var a = s.querySelector("#hvAuto"); if (a) a.classList.toggle("on", ds.autoFit);
    var d = s.querySelector("#hvDet"); if (d) d.textContent = window.innerWidth + "×" + window.innerHeight + " · DPR " + (window.devicePixelRatio || 1).toFixed(2);
  }

  // ---- toast ----
  var tEl, tTimer;
  function toast(msg) { if (!tEl) { tEl = document.createElement("div"); tEl.className = "hv-toast"; document.body.appendChild(tEl); } tEl.textContent = msg; tEl.classList.add("on"); clearTimeout(tTimer); tTimer = setTimeout(function () { tEl.classList.remove("on"); }, 1800); }

  // ---- show after entry (when the shell becomes visible) ----
  function shellVisible() { var sh = document.querySelector(".shell"); return sh && sh.offsetParent !== null; }
  function injectFont() {
    if (document.getElementById("smd-inter")) return;
    var l = document.createElement("link"); l.id = "smd-inter"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }
  function injectV3CSS() {
    if (document.getElementById("smd-uiv3")) return;
    var l = document.createElement("link"); l.id = "smd-uiv3"; l.rel = "stylesheet"; l.href = "/ui-v3.css?v=s2";
    document.head.appendChild(l);
  }
  // Live, in-place UI switch — NO page reload, NO re-splash / re-consent / re-login.
  function setUI(on) {
    try { if (on) localStorage.setItem("smd_home_v2", "1"); else localStorage.removeItem("smd_home_v2"); } catch (e) {}
    document.body.classList.toggle("ui-v2", on);
    if (on) { build(); showV2(); } else { if (root) root.classList.remove("on"); if (fab) fab.classList.remove("on"); }
    try { closeSheet(); } catch (e) {}
  }
  window.SMD_setUI = setUI;
  function start() {
    injectFont(); build(); applyD(); if (ds.autoFit) autoFitD();
    if (IS_V2) {
      // show the new home as soon as the user is past splash/login, COVERING the app's own
      // Simple/Advanced screen so it isn't seen twice. Theme applies then (never on splash/consent).
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var ms = document.getElementById("modeSelect"), sh = document.querySelector(".shell");
        var entered = (ms && !ms.classList.contains("hidden")) || (sh && sh.offsetParent !== null);
        if (entered || tries > 60) { clearInterval(iv); document.body.classList.add("ui-v2"); showV2(); }
      }, 120);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
