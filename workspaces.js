/* StewardMD — Specialty Workspaces + Branch Watermarks (PR 1: foundation).
   ---------------------------------------------------------------------------
   Adds a multi-specialty clinical-workspace layer AROUND the app without touching
   the protected Internal Medicine engine (reasoning.js differential/gate, app.js
   runEngine/renderOutput are never called differently or modified here).

   Scope of this module:
     • specialtyRegistry (8 workspaces) + per-user persisted preferences.
     • Sidebar workspace switcher (bottom sheet) — sets the DEFAULT workspace.
     • In-case workspace pill inside the Clinical Reasoning screen (#dxOverlay).
     • Branch watermark (low-opacity, aria-hidden, pointer-events:none) per specialty.
     • Deterministic "auto-select specialty" keyword routing (advisory, override-able).
     • Non-IM specialties open an EARLY-ACCESS framework shell (5-step scaffold only,
       clearly labelled — no diagnoses, no dosing). Internal Medicine keeps its full
       existing engine, untouched.

   FLAG: off by default. Enable with ?workspaces=1 or localStorage.smd_workspaces="1".
   When off this file is a no-op. Privacy: preferences are account-scoped
   (stewardmd_ws_<uid|guest>), never shared across users; no PHI stored. */
(function () {
  "use strict";

  function wsOn() {
    try {
      var q = location.search || "";
      if (/[?&]workspaces=1\b/.test(q)) return true;
      if (/[?&]workspaces=0\b/.test(q)) return false;
      return localStorage.getItem("smd_workspaces") === "1";
    } catch (e) { return false; }
  }
  if (!wsOn()) return; // flag off → do nothing at all

  var IM = "internal_medicine";

  /* ───────────────────────── icons + watermark line-art ─────────────────────────
     Simple single-colour stroke SVGs. Icons render at currentColor; watermarks are
     the same vector at ~5% opacity. No bitmaps, no patient imagery. */
  function ic(paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>'; }
  function wm(paths, vb) { return '<svg viewBox="' + (vb || "0 0 64 64") + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>'; }

  var ICONS = {
    internal_medicine: '<path d="M8 3h8"/><path d="M12 3v6"/><path d="M7 9h10l-1 9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2Z"/><path d="M7.5 14h9"/>',
    surgery: '<path d="M14 4l6 6-9 9-3 1 1-3 5-5"/><path d="M4 20l4-4"/>',
    ent: '<path d="M6 9a6 6 0 1 1 6 6c-2 0-2 2-2 3"/><circle cx="10" cy="9" r="2"/>',
    ophthalmology: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    obstetrics_gynaecology: '<path d="M8 4c0 4 2 6 4 6s4-2 4-6"/><path d="M12 10v7"/><path d="M9 14h6"/><circle cx="12" cy="19" r="1.6"/>',
    urology: '<path d="M6 6c-2 1-3 4-1 6 2 2 4 1 4-2 0-2-1-4-3-4Z"/><path d="M18 6c2 1 3 4 1 6-2 2-4 1-4-2 0-2 1-4 3-4Z"/><path d="M10 12c1 3 3 3 4 0"/>',
    dentistry_omfs: '<path d="M12 3c3 0 5 2 5 5 0 4-1 5-1.5 8-.3 1.7-.7 3-1.5 3s-1-1.5-1-3-1-2-1 0 .2 3-1 3-1.2-1.3-1.5-3C8 13 7 12 7 8c0-3 2-5 5-5Z"/>',
    paediatrics: '<circle cx="12" cy="11" r="5"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="7" r="2"/><path d="M10 11h.01M14 11h.01"/><path d="M10 14c1 1 3 1 4 0"/>'
  };
  var WMARKS = {
    internal_medicine: '<path d="M20 8h12M26 8v10M20 18h20l-2 26a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4Z"/><path d="M22 30h18"/><path d="M4 54h10l4-10 6 18 4-10h32" stroke-width="1.2"/>',
    surgery: '<path d="M40 8l16 16-26 26-8 3 3-8 15-15"/><path d="M8 56l12-12"/><circle cx="14" cy="12" r="6" stroke-width="1.2"/>',
    ent: '<path d="M14 26a16 16 0 1 1 16 16c-5 0-5 6-5 8"/><circle cx="26" cy="26" r="6"/>',
    ophthalmology: '<path d="M4 32s10-16 28-16 28 16 28 16-10 16-28 16S4 32 4 32Z"/><circle cx="32" cy="32" r="7"/>',
    obstetrics_gynaecology: '<path d="M20 10c0 12 6 18 12 18s12-6 12-18"/><path d="M32 28v20"/><path d="M24 38h16"/><circle cx="32" cy="52" r="4"/>',
    urology: '<path d="M16 14c-6 3-8 12-3 18 6 6 12 3 12-6 0-6-3-12-9-12Z"/><path d="M48 14c6 3 8 12 3 18-6 6-12 3-12-6 0-6 3-12 9-12Z"/><path d="M28 34c3 8 8 8 8 0"/>',
    dentistry_omfs: '<path d="M32 8c8 0 14 5 14 14 0 10-3 13-4 21-.8 4.5-2 8-4 8s-2.5-4-2.5-8-2.5-5-2.5 0 .5 8-3 8-3.2-3.5-4-8C22 43 18 40 18 22c0-9 6-14 14-14Z"/>',
    paediatrics: '<circle cx="32" cy="30" r="13"/><circle cx="18" cy="18" r="6"/><circle cx="46" cy="18" r="6"/><path d="M27 30h.01M37 30h.01"/><path d="M27 37c3 3 7 3 10 0"/>'
  };

  /* ───────────────────────────── specialty registry ───────────────────────────── */
  var REG = [
    { id: IM, name: "Internal Medicine", subtitle: "Medical symptoms, diagnostics, ward & ICU reasoning", status: "canonical" },
    { id: "surgery", name: "Surgery", subtitle: "Acute abdomen, wounds, trauma, source control", status: "early_access",
      syndromes: ["Acute abdomen", "Wound / post-op infection", "Cellulitis / soft-tissue infection", "Abscess", "Diabetic foot infection", "Necrotising soft-tissue infection"],
      danger: ["Peritonitis / rigid abdomen", "Crepitus, rapidly spreading erythema (nec-fash)", "Haemodynamic instability / sepsis"] },
    { id: "ent", name: "ENT", subtitle: "Ear, nose, throat, neck infections", status: "early_access",
      syndromes: ["Acute otitis media", "Ear discharge (CSOM)", "Otitis externa", "Acute bacterial sinusitis", "Tonsillitis / peritonsillar abscess"],
      danger: ["Deep neck-space infection", "Mastoiditis", "Epiglottitis / airway compromise"] },
    { id: "ophthalmology", name: "Ophthalmology", subtitle: "Red eye, vision symptoms, orbital infections", status: "early_access",
      syndromes: ["Bacterial conjunctivitis", "Viral / allergic conjunctivitis", "Keratitis / corneal ulcer"],
      danger: ["Orbital cellulitis", "Acute angle-closure glaucoma", "Vision-threatening red eye"] },
    { id: "obstetrics_gynaecology", name: "Obstetrics & Gynaecology", subtitle: "Pregnancy, pelvic pain, vaginal discharge", status: "early_access",
      syndromes: ["Bacterial vaginosis", "Vulvovaginal candidiasis", "Trichomoniasis / cervicitis", "Pelvic inflammatory disease", "Pregnancy UTI / pyelonephritis"],
      danger: ["Postpartum fever / sepsis", "Septic abortion", "Suspected ectopic pregnancy"] },
    { id: "urology", name: "Urology", subtitle: "UTI, obstruction, catheter, urosepsis", status: "early_access",
      syndromes: ["Uncomplicated cystitis", "Pyelonephritis", "Catheter-associated UTI", "Obstructed / infected urinary system"],
      danger: ["Urosepsis", "Renal colic with infection", "Infected hydronephrosis"] },
    { id: "dentistry_omfs", name: "Dentistry / OMFS", subtitle: "Dental pain, abscess, facial swelling", status: "early_access",
      syndromes: ["Dental abscess", "Pericoronitis", "Odontogenic facial swelling"],
      danger: ["Ludwig angina", "Spreading facial-space infection / airway"] },
    { id: "paediatrics", name: "Paediatrics", subtitle: "Child-specific presentations", status: "early_access",
      syndromes: ["Framework only — paediatric-specific validated pathways"],
      danger: ["Never uses adult dosing — routes to paediatric-specific guidance only"] }
  ];
  function meta(id) { for (var i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i]; return REG[0]; }

  var ABX_LADDER = ["Antibiotics not indicated", "Topical / local therapy", "Oral antibiotic", "IV antibiotic / admission", "Urgent drainage / source control", "Emergency referral"];

  /* ───────────────────────────── persistence (account-scoped) ───────────────────────────── */
  function uid() { try { var a = JSON.parse(localStorage.getItem("stewardmd_account") || "null"); return (a && (a.uid || a.email)) || "guest"; } catch (e) { return "guest"; } }
  function pkey() { return "stewardmd_ws_" + uid(); }
  var DEF = { defaultClinicalWorkspace: IM, lastUsedClinicalWorkspace: IM, lastUsedAssessmentMode: "quick", lastWorkspaceChangedAt: 0 };
  function loadPrefs() { try { var p = JSON.parse(localStorage.getItem(pkey()) || "null"); if (!p || typeof p !== "object") return Object.assign({}, DEF); return Object.assign({}, DEF, p); } catch (e) { return Object.assign({}, DEF); } }
  function savePrefs() { try { localStorage.setItem(pkey(), JSON.stringify(prefs)); } catch (e) {} }
  var prefs = loadPrefs();
  var caseWorkspace = null; // per-current-case override (not persisted)

  function activeWorkspace() { return caseWorkspace || prefs.defaultClinicalWorkspace || IM; }
  function setDefault(id) { prefs.defaultClinicalWorkspace = id; prefs.lastUsedClinicalWorkspace = id; prefs.lastWorkspaceChangedAt = 0; savePrefs(); }

  function toast(m) { try { if (window.SB && SB.toast) return SB.toast(m); } catch (e) {} var t = document.getElementById("swToast"); if (!t) { t = document.createElement("div"); t.id = "swToast"; t.className = "sw-toast"; document.body.appendChild(t); } t.textContent = m; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 2400); }

  /* ───────────────────────────── auto-select (deterministic) ───────────────────────────── */
  var ROUTE = [
    { id: "ophthalmology", re: /\b(red eye|eye pain|photophobi|vision|conjunctiv|corneal|keratit|ocular|orbital)\b/i },
    { id: "ent", re: /\b(ear|otitis|otalgia|hearing|sinus|nasal|throat|tonsil|sore throat|neck swelling|otorrhoea|otorrhea)\b/i },
    { id: "obstetrics_gynaecology", re: /\b(vaginal|pelvic|pregnan|postpartum|obstetr|gynae|menstru|cervic|discharge per vagin|pv bleed)\b/i },
    { id: "urology", re: /\b(dysuria|urinary|urine|flank pain|renal colic|hydronephro|catheter|prostat|urosepsis|frequency and urgency)\b/i },
    { id: "dentistry_omfs", re: /\b(tooth|dental|gum|facial swelling|jaw|odontogenic|abscess.*tooth)\b/i },
    { id: "surgery", re: /\b(acute abdomen|wound|post-?op|abscess|cellulitis|diabetic foot|source control|surgical)\b/i }
  ];
  function suggestWorkspace(text) {
    var t = String(text || "");
    for (var i = 0; i < ROUTE.length; i++) if (ROUTE[i].re.test(t)) return ROUTE[i].id;
    return IM; // default → Internal Medicine
  }

  /* ───────────────────────────── CSS ───────────────────────────── */
  function injectCSS() {
    if (document.getElementById("sw-css")) return;
    var s = document.createElement("style"); s.id = "sw-css";
    s.textContent = [
      // sidebar switcher row
      ".sw-sblab{font:800 10px var(--sans,system-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--slate-soft,#5a7184);padding:12px 18px 4px}",
      ".sw-sbsw{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);text-align:left;padding:11px 14px;margin:0 12px 4px;width:calc(100% - 24px);border-radius:12px;cursor:pointer;color:var(--ink,#14202b);font-family:inherit}",
      ".sw-sbsw .ic{width:22px;height:22px;flex:0 0 auto;color:var(--teal,#0e6e63)}.sw-sbsw .ic svg{width:22px;height:22px}",
      ".sw-sbsw .nm{flex:1;min-width:0;font:700 14px var(--sans,system-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sw-sbsw .chev{color:var(--slate-soft,#5a7184);font-size:13px}",
      // bottom sheet / popover
      ".sw-scrim{position:fixed;inset:0;background:rgba(8,16,22,.5);z-index:16040;opacity:0;transition:opacity .2s}.sw-scrim.on{opacity:1}",
      ".sw-sheet{position:fixed;left:0;right:0;bottom:0;z-index:16041;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.24);transform:translateY(100%);transition:transform .26s cubic-bezier(.2,.7,.2,1);max-height:88vh;overflow-y:auto;font-family:var(--sans,system-ui);padding-bottom:calc(14px + env(safe-area-inset-bottom))}.sw-sheet.on{transform:none}",
      ".sw-grab{width:40px;height:5px;border-radius:3px;background:var(--line,#d7dee3);margin:9px auto 2px}",
      ".sw-sheet h3{font:800 17px var(--sans);margin:6px 18px 4px;color:var(--ink)}",
      ".sw-opt{display:flex;align-items:center;gap:13px;width:100%;box-sizing:border-box;border:none;background:none;text-align:left;padding:13px 18px;cursor:pointer;color:var(--ink,#14202b);font-family:inherit;border-top:1px solid var(--line,#eef1f4)}",
      ".sw-opt:hover{background:var(--teal-soft,#e3f1ee)}",
      ".sw-opt .ic{width:26px;height:26px;flex:0 0 auto;color:var(--teal,#0e6e63)}.sw-opt .ic svg{width:26px;height:26px}",
      ".sw-opt .tx{flex:1;min-width:0}.sw-opt .tx .nm{display:block;font:700 15px var(--sans);color:var(--ink)}.sw-opt .tx .sb{display:block;font:500 12px/1.35 var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px}",
      ".sw-opt .ea{font:800 9.5px var(--sans);letter-spacing:.05em;color:var(--amber,#92620a);background:rgba(146,98,10,.12);padding:2px 7px;border-radius:999px;flex:0 0 auto}",
      ".sw-opt .ck{color:var(--teal,#0e6e63);font-size:17px;font-weight:800;flex:0 0 auto}",
      ".sw-auto{margin:12px 18px 6px;padding-top:12px;border-top:1px solid var(--line,#eef1f4)}",
      ".sw-auto .lb{font:800 10px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--slate-soft);margin-bottom:6px}",
      ".sw-auto input{width:100%;box-sizing:border-box;border:1px solid var(--line,#d7dee3);border-radius:11px;padding:11px 12px;font:500 14px var(--sans);color:var(--ink);background:var(--paper,#f6f7f5)}",
      ".sw-auto .sg{margin-top:8px;font:600 13px var(--sans);color:var(--ink);display:none}.sw-auto .sg.on{display:block}.sw-auto .sg b{color:var(--teal)}",
      ".sw-modeseg{display:flex;gap:8px;margin:6px 18px 2px}.sw-modeseg button{flex:1;border:1px solid var(--line);background:var(--paper,#f6f7f5);border-radius:11px;padding:9px;font:700 13px var(--sans);color:var(--slate-soft);cursor:pointer}.sw-modeseg button.on{background:var(--teal,#0e6e63);border-color:var(--teal);color:#fff}",
      ".sw-usefor{margin:8px 18px 2px}.sw-usefor label{display:flex;align-items:center;gap:9px;padding:7px 0;font:600 13.5px var(--sans);color:var(--ink);cursor:pointer}.sw-usefor input{width:18px;height:18px;accent-color:var(--teal,#0e6e63)}",
      // in-case pill (inside #dxOverlay .dx-top)
      ".sw-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);border-radius:999px;padding:5px 11px 5px 9px;font:700 12.5px var(--sans);color:var(--ink,#14202b);cursor:pointer;max-width:46vw}",
      ".sw-pill .ic{width:16px;height:16px;flex:0 0 auto;color:var(--teal,#0e6e63)}.sw-pill .ic svg{width:16px;height:16px}",
      ".sw-pill .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sw-pill .chev{color:var(--slate-soft);font-size:11px}",
      // branch watermark
      ".sw-wm{position:absolute;pointer-events:none;z-index:-1;opacity:.055;color:var(--teal,#0e6e63);width:min(48vw,320px);right:-14px;bottom:9%}.sw-wm svg{width:100%;height:auto;display:block}",
      "body.dark .sw-wm{opacity:.07;color:var(--teal,#3fc7b3)}",
      "@media (prefers-contrast:more){.sw-wm{display:none}}",
      // early-access specialty shell
      ".sw-shell{position:fixed;inset:0;z-index:940;background:var(--paper,#f6f7f5);color:var(--ink,#14202b);font-family:var(--sans,system-ui);display:none;flex-direction:column;overflow:hidden}.sw-shell.on{display:flex}",
      ".sw-shead{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#d7dee3);position:relative;z-index:1}",
      ".sw-shead .bk{border:none;background:none;color:var(--teal,#0e6e63);font:800 22px/1 var(--sans);cursor:pointer;width:36px;height:36px}",
      ".sw-shead .ti{font:800 17px var(--sans);flex:1;min-width:0;display:flex;align-items:center;gap:8px}.sw-shead .ti .ea{font:800 9.5px var(--sans);letter-spacing:.05em;color:var(--amber,#92620a);background:rgba(146,98,10,.12);padding:3px 8px;border-radius:999px}",
      ".sw-sbody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 16px calc(28px + env(safe-area-inset-bottom));position:relative;z-index:1}",
      ".sw-note{font:600 12.5px/1.55 var(--sans);color:var(--amber,#92620a);background:rgba(146,98,10,.10);border:1px solid rgba(146,98,10,.3);border-radius:12px;padding:11px 13px;margin-bottom:14px}",
      ".sw-card{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:14px;padding:13px 15px;margin-bottom:12px}",
      ".sw-card h4{font:800 11px var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--teal,#0e6e63);margin:0 0 9px}",
      ".sw-step{display:flex;gap:11px;padding:7px 0;border-top:1px solid var(--line,#eef1f4)}.sw-step:first-of-type{border-top:none}.sw-step .n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);font:800 12px var(--sans);display:flex;align-items:center;justify-content:center}.sw-step .lb{font:600 13.5px/1.4 var(--sans);color:var(--ink)}",
      ".sw-chips{display:flex;flex-wrap:wrap;gap:7px}.sw-chip{font:600 12.5px var(--sans);border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-radius:999px;padding:6px 11px;color:var(--ink)}",
      ".sw-danger .sw-chip{border-color:var(--red-line,#efa9b1);background:var(--red-bg,#fbe7e9);color:var(--red,#ab1c2c)}",
      ".sw-ladder{display:flex;flex-direction:column;gap:6px}.sw-ladder .r{display:flex;align-items:center;gap:9px;font:600 13px var(--sans);color:var(--ink)}.sw-ladder .r .d{width:9px;height:9px;border-radius:50%;flex:0 0 auto}",
      ".sw-imbtn{display:block;width:100%;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);padding:14px;cursor:pointer;margin-top:6px}",
      // confirm dialog
      ".sw-confirm{position:fixed;inset:0;z-index:16050;background:rgba(8,16,22,.5);display:flex;align-items:center;justify-content:center;padding:20px}",
      ".sw-confirm .box{background:var(--panel,#fff);border-radius:18px;max-width:340px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)}",
      ".sw-confirm h4{font:800 16px var(--sans);color:var(--ink);margin:0 0 8px}.sw-confirm p{font:500 13px/1.55 var(--sans);color:var(--slate,#2d4356);margin:0 0 14px}",
      ".sw-confirm button{display:block;width:100%;border-radius:12px;padding:12px;font:700 14px var(--sans);cursor:pointer;margin-top:8px;border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);color:var(--ink)}",
      ".sw-confirm button.pri{background:var(--teal,#0e6e63);color:#fff;border-color:var(--teal)}",
      ".sw-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%) translateY(8px);background:#0f172a;color:#fff;font:600 13px var(--sans);padding:11px 16px;border-radius:11px;z-index:16060;opacity:0;transition:.2s;pointer-events:none;max-width:88vw;text-align:center}.sw-toast.on{opacity:1;transform:translateX(-50%)}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  /* ───────────────────────────── bottom sheet (choose workspace) ───────────────────────────── */
  var _sheet, _scrim;
  function closeSheet() { if (_sheet) _sheet.classList.remove("on"); if (_scrim) _scrim.classList.remove("on"); }
  // opts.inCase = true → shows "use for" + mode + switch-list for the current case
  function openSheet(opts) {
    injectCSS();
    opts = opts || {};
    if (!_scrim) { _scrim = document.createElement("div"); _scrim.className = "sw-scrim"; document.body.appendChild(_scrim); _scrim.addEventListener("click", closeSheet); }
    if (!_sheet) { _sheet = document.createElement("div"); _sheet.className = "sw-sheet"; document.body.appendChild(_sheet); }
    var cur = opts.inCase ? activeWorkspace() : prefs.defaultClinicalWorkspace;
    var h = '<div class="sw-grab"></div><h3>Choose clinical workspace</h3>';
    if (opts.inCase) {
      h += '<div class="sw-modeseg" id="swMode">' +
        '<button data-mode="quick"' + (prefs.lastUsedAssessmentMode !== "advanced" ? ' class="on"' : '') + '>Quick assessment</button>' +
        '<button data-mode="advanced"' + (prefs.lastUsedAssessmentMode === "advanced" ? ' class="on"' : '') + '>Advanced assessment</button></div>' +
        '<div class="sw-usefor"><label><input type="radio" name="swUse" value="case" checked> Use for this case only</label>' +
        '<label><input type="radio" name="swUse" value="default"> Make my default workspace</label></div>';
    }
    REG.forEach(function (r) {
      h += '<button class="sw-opt" data-ws="' + r.id + '"><span class="ic">' + ic(ICONS[r.id]) + '</span>' +
        '<span class="tx"><span class="nm">' + r.name + '</span><span class="sb">' + r.subtitle + '</span></span>' +
        (r.status === "early_access" ? '<span class="ea">Early access</span>' : '') +
        (r.id === cur ? '<span class="ck">✓</span>' : '') + '</button>';
    });
    h += '<div class="sw-auto"><div class="lb">Auto-select specialty</div>' +
      '<input id="swAuto" placeholder="Describe the presenting complaint…"/>' +
      '<div class="sg" id="swSg"></div></div>';
    _sheet.innerHTML = h;
    // wire mode
    _sheet.querySelectorAll("#swMode button").forEach(function (b) { b.addEventListener("click", function () { _sheet.querySelectorAll("#swMode button").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); prefs.lastUsedAssessmentMode = b.getAttribute("data-mode"); savePrefs(); }); });
    // wire options
    _sheet.querySelectorAll(".sw-opt").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-ws");
        var asDefault = !opts.inCase;
        if (opts.inCase) { var r = _sheet.querySelector('input[name="swUse"]:checked'); asDefault = r && r.value === "default"; }
        chooseWorkspace(id, { asDefault: asDefault, inCase: opts.inCase });
      });
    });
    // wire auto-select (suggestion only)
    var ai = _sheet.querySelector("#swAuto"), sg = _sheet.querySelector("#swSg");
    if (ai) ai.addEventListener("input", function () {
      var v = ai.value.trim(); if (v.length < 3) { sg.classList.remove("on"); return; }
      var id = suggestWorkspace(v); sg.innerHTML = 'Suggested workspace: <b>' + meta(id).name + '</b> — tap it above to use. <span style="color:var(--slate-soft)">(you can override)</span>'; sg.classList.add("on");
    });
    requestAnimationFrame(function () { _scrim.classList.add("on"); _sheet.classList.add("on"); });
  }

  function chooseWorkspace(id, o) {
    o = o || {};
    if (o.asDefault) { setDefault(id); }
    if (o.inCase) { caseWorkspace = id; }
    closeSheet();
    // open the workspace
    if (id === IM) { caseWorkspace = null; try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); } catch (e) {} }
    else { openSpecialtyShell(id); }
    refreshSidebarLabel();
  }

  /* ───────────────────────────── early-access specialty shell ───────────────────────────── */
  var _shell;
  function openSpecialtyShell(id) {
    injectCSS();
    var r = meta(id);
    if (!_shell) { _shell = document.createElement("div"); _shell.className = "sw-shell"; _shell.id = "swShell"; document.body.appendChild(_shell); }
    var steps = [
      "Presenting complaint / syndrome", "Focused specialty questions", "Severity / danger signs",
      "Differential & likely category", "Management: antibiotic need, referral, source-control / procedure"
    ];
    var h = '<div class="sw-shead"><button class="bk" id="swShBack" aria-label="Back">‹</button>' +
      '<div class="ti">' + r.name + '<span class="ea">Early access</span></div>' +
      '<button class="sw-pill" id="swShPill"><span class="ic">' + ic(ICONS[id]) + '</span><span class="nm">' + r.name + '</span><span class="chev">▾</span></button></div>';
    h += '<div class="sw-sbody">';
    h += '<div class="sw-wm">' + wm(WMARKS[id]) + '</div>';
    h += '<div class="sw-note">This specialty pathway is in <b>early access</b> — the framework and safe entry points are shown, but the focused questions and differential are still being validated. It does <b>not</b> produce a diagnosis or drug dosing. Internal Medicine remains the fully-validated engine.</div>';
    h += '<div class="sw-card"><h4>5-step specialty pathway</h4>' + steps.map(function (s, i) { return '<div class="sw-step"><div class="n">' + (i + 1) + '</div><div class="lb">' + s + '</div></div>'; }).join("") + '</div>';
    if (r.syndromes) h += '<div class="sw-card"><h4>Syndrome entry points</h4><div class="sw-chips">' + r.syndromes.map(function (x) { return '<span class="sw-chip">' + x + '</span>'; }).join("") + '</div></div>';
    if (r.danger) h += '<div class="sw-card sw-danger"><h4>Danger signs — escalate</h4><div class="sw-chips">' + r.danger.map(function (x) { return '<span class="sw-chip">' + x + '</span>'; }).join("") + '</div></div>';
    var cols = { 0: "#047857", 1: "#65a30d", 2: "#0e6e63", 3: "#D97706", 4: "#b5460f", 5: "#ab1c2c" };
    h += '<div class="sw-card"><h4>Antibiotic / management ladder</h4><div class="sw-ladder">' + ABX_LADDER.map(function (x, i) { return '<div class="r"><span class="d" style="background:' + cols[i] + '"></span>' + x + '</div>'; }).join("") + '</div></div>';
    h += '<button class="sw-imbtn" id="swToIM">Switch to Internal Medicine (full engine)</button>';
    h += '</div>';
    _shell.innerHTML = h;
    _shell.classList.add("on");
    _shell.querySelector("#swShBack").addEventListener("click", function () { _shell.classList.remove("on"); });
    _shell.querySelector("#swShPill").addEventListener("click", function () { openSheet({ inCase: true }); });
    _shell.querySelector("#swToIM").addEventListener("click", function () { _shell.classList.remove("on"); caseWorkspace = null; try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); } catch (e) {} });
  }

  /* ───────────────────────────── sidebar switcher (wrap SB.open) ───────────────────────────── */
  function refreshSidebarLabel() { var b = document.querySelector("#sbMenu .sw-sbsw .nm"); if (b) b.textContent = meta(prefs.defaultClinicalWorkspace).name; var i2 = document.querySelector("#sbMenu .sw-sbsw .ic"); if (i2) i2.innerHTML = ic(ICONS[prefs.defaultClinicalWorkspace]); }
  function injectSidebarSwitcher() {
    var menu = document.getElementById("sbMenu"); if (!menu || menu.querySelector(".sw-sbsw")) return;
    // find the "Clinical Reasoning" leaf button
    var target = null, btns = menu.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) { if (/clinical reasoning/i.test(btns[i].textContent || "")) { target = btns[i]; break; } }
    var lab = document.createElement("div"); lab.className = "sw-sblab"; lab.textContent = "Clinical workspace";
    var sw = document.createElement("button"); sw.className = "sw-sbsw";
    sw.innerHTML = '<span class="ic">' + ic(ICONS[prefs.defaultClinicalWorkspace]) + '</span><span class="nm">' + meta(prefs.defaultClinicalWorkspace).name + '</span><span class="chev">▾</span>';
    sw.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openSheet({ inCase: false }); });
    if (target && target.parentNode) { target.parentNode.insertBefore(sw, target); target.parentNode.insertBefore(lab, sw); }
    else { menu.insertBefore(sw, menu.firstChild); menu.insertBefore(lab, sw); }
  }
  function wrapSB() {
    if (!window.SB || typeof SB.open !== "function") { return setTimeout(wrapSB, 300); }
    if (SB.open.__swWrapped) return;
    var orig = SB.open;
    SB.open = function () { var r = orig.apply(this, arguments); try { injectSidebarSwitcher(); } catch (e) {} return r; };
    SB.open.__swWrapped = true;
  }

  /* ───────────── in-case pill + branch watermark inside the IM reasoning screen ───────────── */
  function decorateDxOverlay() {
    var ov = document.getElementById("dxOverlay"); if (!ov || !ov.classList.contains("on")) return;
    var id = activeWorkspace();
    // watermark (IM screen only shows IM here; specialty screens use their own shell)
    var w = ov.querySelector(".sw-wm");
    if (!w) { w = document.createElement("div"); w.className = "sw-wm"; ov.insertBefore(w, ov.firstChild); }
    w.innerHTML = wm(WMARKS[IM]);
    // in-case pill in .dx-top
    var top = ov.querySelector(".dx-top");
    if (top && !top.querySelector(".sw-pill")) {
      var pill = document.createElement("button"); pill.className = "sw-pill"; pill.style.marginLeft = "8px";
      pill.innerHTML = '<span class="ic">' + ic(ICONS[IM]) + '</span><span class="nm">' + meta(IM).name + '</span><span class="chev">▾</span>';
      pill.addEventListener("click", function (e) { e.stopPropagation(); openSheet({ inCase: true }); });
      var title = top.querySelector(".dx-title");
      if (title && title.nextSibling) top.insertBefore(pill, title.nextSibling); else top.appendChild(pill);
    }
  }
  function watchDx() {
    // Observe #dxOverlay class toggles to (re)inject the pill + watermark when it opens.
    var attach = function () {
      var ov = document.getElementById("dxOverlay"); if (!ov) return setTimeout(attach, 400);
      try { new MutationObserver(function () { decorateDxOverlay(); }).observe(ov, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
      decorateDxOverlay();
    };
    attach();
  }

  /* ───────────────────────────── boot ───────────────────────────── */
  function boot() { injectCSS(); wrapSB(); watchDx(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.SMD_WS = {
    open: function () { openSheet({ inCase: false }); },
    openInCase: function () { openSheet({ inCase: true }); },
    active: activeWorkspace,
    setDefault: setDefault,
    suggest: suggestWorkspace,
    registry: REG,
    _prefs: function () { return prefs; }
  };
})();
