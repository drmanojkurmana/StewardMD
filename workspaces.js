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

   FLAG: LIVE — on by default. Kill-switch: ?workspaces=0 or localStorage.smd_workspaces="0"
   instantly disables it (a full, reversible off-switch); ?workspaces=1 forces on.
   When off this file is a no-op. Internal Medicine stays the DEFAULT clinical
   workspace regardless — enabling this only makes the specialty switcher available
   (opt-in; every specialty is clearly labelled "Early access — advisory").
   Privacy: preferences are account-scoped (stewardmd_ws_<uid|guest>), never
   shared across users; no PHI stored. */
(function () {
  "use strict";

  function wsOn() {
    try {
      var q = location.search || "";
      if (/[?&]workspaces=1\b/.test(q)) return true;   // explicit on
      if (/[?&]workspaces=0\b/.test(q)) return false;  // URL kill-switch
      var ls = localStorage.getItem("smd_workspaces");
      return ls === null ? true : ls !== "0";          // default ON; opt out with localStorage "0"
    } catch (e) { return true; }
  }
  if (!wsOn()) return; // disabled → do nothing at all

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
  // Weighted keyword sets — the suggestion scores each specialty by how many of its
  // terms the complaint matches (deterministic, no AI). Order breaks ties.
  var KW = {
    ophthalmology: ["red eye", "eye pain", "painful eye", "photophobi", "blurred vision", "loss of vision", "vision loss", "sudden vision", "vision", "conjunctiv", "corneal", "cornea", "keratit", "dendritic", "herpes eye", "ocular", "orbital", "watering eye", "discharge from eye", "stye", "chalazion", "floaters", "flashes", "curtain", "retinal", "retina", "glaucoma", "angle closure", "haloes", "halos", "uveitis", "iritis", "endophthalmitis", "chemical in eye", "eye injury", "foreign body eye", "corneal abrasion", "hyphaema", "hyphema", "proptosis"],
    ent: ["ear", "otitis", "otalgia", "hearing", "hearing loss", "sudden hearing", "ear discharge", "otorrhoea", "otorrhea", "sinus", "rhinosinus", "nasal", "nose block", "throat", "sore throat", "tonsil", "tonsillectomy", "quinsy", "neck swelling", "hoarse", "epistaxis", "nose bleed", "nosebleed", "vertigo", "dizziness", "mastoid", "stridor", "drooling", "foreign body ear", "foreign body nose", "swallowed", "epiglottitis", "ludwig"],
    obstetrics_gynaecology: ["vaginal", "per vagina", "pv discharge", "pelvic pain", "pregnan", "gravida", "trimester", "postpartum", "post partum", "puerperal", "obstetr", "gynae", "menstru", "amenorrh", "cervic", "pv bleed", "bleeding in pregnancy", "bleeding after delivery", "dysmenorrh", "adnexal", "ovarian torsion", "ectopic", "miscarriage", "abortion", "tubo-ovarian", "bartholin", "eclampsia", "pre-eclampsia", "preeclampsia", "postpartum haemorrhage", "postpartum hemorrhage", "pph", "labour", "in labor", "chorioamnionitis", "endometritis"],
    urology: ["dysuria", "urinary", "urine", "burning micturition", "frequency", "urgency", "flank pain", "loin pain", "renal colic", "ureteric colic", "kidney stone", "ureteric", "calcul", "hydronephro", "catheter", "cauti", "prostat", "urosepsis", "haematuria", "hematuria", "clot retention", "retention", "scrotal", "scrotum", "testic", "testis pain", "torsion of testis", "priapism", "paraphimosis", "fournier", "epididymo", "orchitis", "nephrostomy"],
    dentistry_omfs: ["tooth", "teeth", "toothache", "dental", "dental abscess", "gum", "gingiv", "facial swelling", "jaw", "odontogenic", "pericoronitis", "mandible", "molar", "wisdom tooth", "ludwig", "avulsed", "knocked out tooth", "tooth knocked", "post extraction", "dry socket", "tmj", "jaw dislocation", "trismus"],
    surgery: ["acute abdomen", "abdominal pain", "pain abdomen", "wound", "post-op", "post operative", "surgical site", "abscess", "cellulitis", "soft tissue", "diabetic foot", "source control", "hernia", "incarcerated", "strangulated", "appendic", "cholecyst", "gallbladder", "biliary colic", "obstruction", "bowel obstruction", "perforation", "free air", "peritonitis", "trauma", "gangrene", "necrotis", "necrotiz", "debride", "pilonidal", "perianal", "fistula-in-ano", "mesenteric"],
    paediatrics: ["child", "children", "infant", "baby", "toddler", "neonate", "newborn", "paediatric", "pediatric", "months old", "month old", "weeks old", "days old", "year old", "yr old", "bronchiolitis", "croup", "febrile child", "febrile seizure", "febrile convulsion", "not feeding", "poor feeding", "the kid"]
  };
  // Terms that are highly specific to one specialty count double (a single strong signal
  // shouldn't be out-voted by several vague ones). Kept small + deterministic.
  var KW_STRONG = { ophthalmology: ["endophthalmitis", "angle closure", "dendritic", "hyphaema", "hyphema"], ent: ["epiglottitis", "quinsy", "mastoid", "tonsillectomy"], obstetrics_gynaecology: ["eclampsia", "preeclampsia", "pre-eclampsia", "ovarian torsion", "tubo-ovarian", "ectopic", "chorioamnionitis", "postpartum haemorrhage", "postpartum hemorrhage"], urology: ["torsion of testis", "priapism", "paraphimosis", "fournier", "urosepsis"], dentistry_omfs: ["ludwig", "avulsed", "odontogenic", "pericoronitis"], surgery: ["appendic", "cholecyst", "peritonitis", "pilonidal", "strangulated"], paediatrics: ["bronchiolitis", "croup", "neonate", "newborn", "febrile seizure", "febrile convulsion"] };
  // Shared-condition detectors → the named primary stays in charge, with a consult overlay.
  var SHARED = [
    { test: function (t) { return /cholangitis/.test(t) || (/fever/.test(t) && /(jaundice|icterus|yellow)/.test(t) && /(ruq|right upper|hypochond)/.test(t)); },
      primary: IM, consult: "surgery", label: "Internal Medicine — with Surgery / GI hepatobiliary consult (biliary drainage)" },
    { test: function (t) { return /liver abscess/.test(t); }, primary: IM, consult: "surgery", label: "Internal Medicine — with Surgery / IR consult (drainage)" },
    { test: function (t) { return /colitis/.test(t) && /(toxic|megacolon|perforat|rigid|periton)/.test(t); }, primary: IM, consult: "surgery", label: "Internal Medicine — with Surgery escalation (complications)" },
    { test: function (t) { return /(flank|loin)/.test(t) && /fever/.test(t) && /(hydronephro|obstruct|stone|calcul)/.test(t); }, primary: "urology", consult: IM, label: "Urology — with Internal Medicine sepsis escalation (obstructed infected system)" },
    { test: function (t) { return /orbital/.test(t); }, primary: "ophthalmology", consult: "ent", label: "Ophthalmology — with ENT consult (orbital cellulitis)" },
    { test: function (t) { return /(pelvic|adnexal)/.test(t) && /(abscess|tubo-ovarian)/.test(t); }, primary: "obstetrics_gynaecology", consult: "surgery", label: "Obstetrics & Gynaecology — with Surgery consult (tubo-ovarian abscess)" },
    { test: function (t) { return /fournier/.test(t) || (/(perineal|scrotal|scrotum)/.test(t) && /(necroti|gangrene|crepitus)/.test(t)); }, primary: "urology", consult: "surgery", label: "Urology — with Surgery consult (Fournier's gangrene — emergency debridement)" }
  ];
  // A clearly neonatal / infant complaint should favour Paediatrics even when an organ term also matches.
  var PAEDS_AGE = /\b(neonate|newborn|infant|toddler|\d+[- ]?(day|days|week|weeks|month|months)[- ]?old|baby)\b/;
  function suggestWorkspace(text) {
    var t = String(text || "").toLowerCase();
    if (t.trim().length < 3) return { id: IM, shared: null, score: 0 };
    for (var s = 0; s < SHARED.length; s++) if (SHARED[s].test(t)) return { id: SHARED[s].primary, shared: SHARED[s], score: 2 };
    var scores = {};
    Object.keys(KW).forEach(function (id) {
      var n = 0, strong = KW_STRONG[id] || [];
      KW[id].forEach(function (k) { if (t.indexOf(k) !== -1) n += (strong.indexOf(k) !== -1 ? 2 : 1); });
      scores[id] = n;
    });
    if (PAEDS_AGE.test(t)) scores.paediatrics = (scores.paediatrics || 0) + 2;
    var best = IM, bestScore = 0;
    Object.keys(KW).forEach(function (id) { if (scores[id] > bestScore) { bestScore = scores[id]; best = id; } });
    return { id: bestScore ? best : IM, shared: null, score: bestScore };
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
      ".sw-scrim{position:fixed;inset:0;background:rgba(8,16,22,.5);z-index:16040;opacity:0;pointer-events:none;transition:opacity .2s}.sw-scrim.on{opacity:1;pointer-events:auto}",
      ".sw-sheet{position:fixed;left:0;right:0;bottom:0;z-index:16041;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.24);transform:translateY(100%);transition:transform .26s cubic-bezier(.2,.7,.2,1);max-height:88vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;font-family:var(--sans,system-ui);padding-bottom:calc(14px + env(safe-area-inset-bottom))}.sw-sheet.on{transform:none}",
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
      ".sw-sbody{flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:16px 16px calc(28px + env(safe-area-inset-bottom));position:relative;z-index:1}",
      ".sw-note{font:600 12.5px/1.55 var(--sans);color:var(--amber,#92620a);background:rgba(146,98,10,.10);border:1px solid rgba(146,98,10,.3);border-radius:12px;padding:11px 13px;margin-bottom:14px}",
      ".sw-card{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:14px;padding:13px 15px;margin-bottom:12px}",
      ".sw-card h4{font:800 11px var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--teal,#0e6e63);margin:0 0 9px}",
      ".sw-step{display:flex;gap:11px;padding:7px 0;border-top:1px solid var(--line,#eef1f4)}.sw-step:first-of-type{border-top:none}.sw-step .n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);font:800 12px var(--sans);display:flex;align-items:center;justify-content:center}.sw-step .lb{font:600 13.5px/1.4 var(--sans);color:var(--ink)}",
      ".sw-chips{display:flex;flex-wrap:wrap;gap:7px}.sw-chip{font:600 12.5px var(--sans);border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-radius:999px;padding:6px 11px;color:var(--ink)}",
      ".sw-danger .sw-chip{border-color:var(--red-line,#efa9b1);background:var(--red-bg,#fbe7e9);color:var(--red,#ab1c2c)}",
      // interactive engine: selectable toggle chips + live output
      ".sw-tog{font:600 12.5px var(--sans);border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-radius:999px;padding:7px 12px;color:var(--ink);cursor:pointer;user-select:none}",
      ".sw-tog.on{background:var(--teal,#0e6e63);border-color:var(--teal);color:#fff}",
      ".sw-danger .sw-tog{border-color:var(--red-line,#efa9b1);color:var(--red,#ab1c2c);background:var(--red-bg,#fbe7e9)}.sw-danger .sw-tog.on{background:var(--red,#ab1c2c);border-color:var(--red);color:#fff}",
      ".sw-synbtn{font:700 13px var(--sans);border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-radius:11px;padding:9px 12px;color:var(--ink);cursor:pointer}.sw-synbtn.on{background:var(--teal,#0e6e63);border-color:var(--teal);color:#fff}",
      ".sw-out{border-left:4px solid var(--teal,#0e6e63)}",
      ".sw-out.emerg{border-left-color:var(--red,#ab1c2c)}",
      ".sw-emerg{font:800 13px var(--sans);color:#fff;background:var(--red,#ab1c2c);border-radius:10px;padding:9px 12px;margin-bottom:10px}",
      ".sw-catg{font:800 15px/1.3 var(--sans);color:var(--ink);margin-bottom:8px}",
      ".sw-out .lab{font:800 10px var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--slate-soft);margin:10px 0 4px}",
      ".sw-out p{font:600 13px/1.5 var(--sans);color:var(--ink);margin:2px 0}",
      ".sw-out ul{margin:2px 0;padding-left:18px}.sw-out li{font:500 12.5px/1.5 var(--sans);color:var(--slate,#2d4356);margin:3px 0}",
      ".sw-ladder .r.on{font-weight:800}.sw-ladder .r.on .d{box-shadow:0 0 0 3px rgba(14,110,99,.18)}.sw-ladder .r.dim{opacity:.4}",
      ".sw-shared{font:600 12.5px/1.55 var(--sans);background:var(--teal-soft,#e3f1ee);border:1px solid var(--teal,#0e6e63);border-radius:11px;padding:10px 12px;margin-top:10px;color:var(--ink)}.sw-shared b{color:var(--teal,#0e6e63)}",
      ".sw-openim{display:block;width:100%;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans);padding:12px;cursor:pointer;margin-top:10px}",
      ".sw-ladder{display:flex;flex-direction:column;gap:6px}.sw-ladder .r{display:flex;align-items:center;gap:9px;font:600 13px var(--sans);color:var(--ink)}.sw-ladder .r .d{width:9px;height:9px;border-radius:50%;flex:0 0 auto}",
      ".sw-imbtn{display:block;width:100%;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);padding:14px;cursor:pointer;margin-top:6px}",
      // empiric antibiotics panel
      ".sw-abx{margin-top:12px;border:1px solid var(--teal,#0e6e63);border-radius:12px;padding:11px 13px;background:var(--teal-soft,#e3f1ee)}",
      ".sw-abx .lab{font:800 11px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--teal,#0e6e63);margin:0 0 7px}",
      ".sw-abx .k{font:700 12px var(--sans);color:var(--ink);margin:7px 0 2px}",
      ".sw-abx ul{margin:0;padding-left:18px}.sw-abx li{font:500 13px/1.5 var(--sans);color:var(--ink);margin:2px 0}.sw-abx li b{font-weight:800}",
      ".sw-abx .nt{color:var(--slate-soft,#5a7184);font-weight:500}",
      ".sw-abx .ref{font:500 11px/1.5 var(--sans);color:var(--slate,#2d4356);margin-top:8px;border-top:1px dashed var(--teal,#0e6e63);padding-top:7px}",
      // point-of-care hand-off action bar
      ".sw-poc{margin-top:13px;padding-top:12px;border-top:1px solid var(--line,#d7dee3)}.sw-poc .lab{font:700 11px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--slate-soft,#5a7184);margin-bottom:8px}",
      ".sw-pocrow{display:flex;flex-wrap:wrap;gap:8px}",
      ".sw-pocbtn{border:1px solid var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:999px;font:700 12.5px var(--sans);padding:9px 13px;cursor:pointer}.sw-pocbtn:active{transform:scale(.96)}",
      ".sw-pocbtn.abx{background:var(--teal,#0e6e63);color:#fff}",
      ".sw-pocnote{font:500 11px/1.5 var(--sans);color:var(--slate-soft,#5a7184);margin-top:8px}",
      // early-access feedback control
      ".sw-fb{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;padding-top:11px;border-top:1px dashed var(--line,#d7dee3)}.sw-fb .q{font:600 12.5px var(--sans);color:var(--slate,#2d4356)}.sw-fb .btns{display:flex;gap:7px;margin-left:auto;flex-wrap:wrap}",
      ".sw-fbbtn{border:1px solid var(--line,#d7dee3);background:var(--paper,#f6f7f5);border-radius:999px;font-size:15px;line-height:1;padding:7px 11px;cursor:pointer}.sw-fbbtn:active{transform:scale(.94)}",
      ".sw-fbflag{border:1px solid var(--red-line,#efa9b1);background:var(--red-bg,#fbe7e9);color:var(--red,#ab1c2c);border-radius:999px;font:700 12px var(--sans);padding:7px 11px;cursor:pointer}",
      ".sw-fbflagbox{width:100%}.sw-fbflagbox textarea{width:100%;box-sizing:border-box;border:1px solid var(--line,#d7dee3);border-radius:10px;padding:9px;font:500 13px var(--sans);color:var(--ink);resize:vertical}.sw-fbflagbox .row{display:flex;align-items:center;gap:10px;margin-top:7px}.sw-fbflagbox .warn{font:600 11px var(--sans);color:var(--slate-soft,#5a7184)}",
      ".sw-fbsend{margin-left:auto;border:none;border-radius:10px;background:var(--teal,#0e6e63);color:#fff;font:700 13px var(--sans);padding:8px 16px;cursor:pointer}",
      ".sw-fbthanks{font:700 12.5px var(--sans);color:var(--teal,#0e6e63)}",
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
    if (!_scrim) { _scrim = document.createElement("div"); _scrim.className = "sw-scrim"; _scrim.id = "swScrim"; document.body.appendChild(_scrim); _scrim.addEventListener("click", closeSheet); }
    if (!_sheet) { _sheet = document.createElement("div"); _sheet.className = "sw-sheet"; _sheet.id = "swSheet"; document.body.appendChild(_sheet); }
    var cur = opts.inCase ? activeWorkspace() : prefs.defaultClinicalWorkspace;
    var h = '<div class="sw-grab"></div><h3>Choose clinical workspace</h3>';
    if (opts.inCase) {
      h += '<div class="sw-modeseg" id="swMode">' +
        '<button data-mode="quick"' + (prefs.lastUsedAssessmentMode !== "advanced" ? ' class="on"' : '') + '>Quick assessment</button>' +
        '<button data-mode="advanced"' + (prefs.lastUsedAssessmentMode === "advanced" ? ' class="on"' : '') + '>Advanced assessment</button></div>';
    }
    // "this case / make default" choice. From the SIDEBAR branch selector (!inCase) default to
    // PERSIST ("Make my default") so the chosen branch actually sticks — the old one-shot default
    // ("Use for my next case") was in-memory only, so if it was lost before Start, activeWorkspace()
    // fell back to Internal Medicine and "Start a case" opened the IM/MARINAM engine instead of the
    // selected specialty. In-case switching keeps the one-shot default.
    var persistDefault = !opts.inCase;
    h += '<div class="sw-usefor"><label><input type="radio" name="swUse" value="case"' + (persistDefault ? '' : ' checked') + '> ' + (opts.inCase ? "Use for this case only" : "Use for my next case") + '</label>' +
      '<label><input type="radio" name="swUse" value="default"' + (persistDefault ? ' checked' : '') + '> Make my default workspace</label></div>';
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
        var r = _sheet.querySelector('input[name="swUse"]:checked');
        var asDefault = !!(r && r.value === "default");
        chooseWorkspace(id, { asDefault: asDefault, inCase: opts.inCase, selector: !opts.inCase });
      });
    });
    // wire auto-select (suggestion only)
    var ai = _sheet.querySelector("#swAuto"), sg = _sheet.querySelector("#swSg");
    if (ai) ai.addEventListener("input", function () {
      var v = ai.value.trim(); if (v.length < 3) { sg.classList.remove("on"); return; }
      var r = suggestWorkspace(v);
      var txt = r.shared ? 'Suggested: <b>' + r.shared.label + '</b>' : 'Suggested workspace: <b>' + meta(r.id).name + '</b>';
      if (!r.score && !r.shared) txt = 'No clear specialty match — defaulting to <b>Internal Medicine</b>';
      sg.innerHTML = txt + ' — tap it above to use. <span style="color:var(--slate-soft)">(you can override)</span>';
      sg.classList.add("on");
    });
    requestAnimationFrame(function () { _scrim.classList.add("on"); _sheet.classList.add("on"); });
  }

  function chooseWorkspace(id, o) {
    o = o || {};
    if (o.asDefault) { setDefault(id); caseWorkspace = (id === IM ? null : id); }
    else { caseWorkspace = id; }              // "this case / my next case" override (IM ok too)
    closeSheet();
    refreshSidebarLabel();
    if (o.selector) {
      // Branch selector (home / sidebar): SET the workspace and RETURN HOME — do NOT open the engine.
      // "Start a new case" (Dx My Patient) then routes into this workspace's engine.
      if (_shell) _shell.classList.remove("on");
      try { if (window.SMD_goHome) SMD_goHome(); } catch (e) {}
      toast(meta(id).name + (id === IM ? " selected — tap Start a new case." : (o.asDefault ? " is now your default — tap Start a new case." : " ready — tap Start a new case.")));
      return;
    }
    // In-case switch (mid-case, from the workspace pill): open immediately, then consume the
    // one-shot override so the NEXT case reverts to the default workspace shown in the sidebar.
    if (id === IM) { caseWorkspace = null; if (_shell) _shell.classList.remove("on"); try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); } catch (e) {} }
    else { openSpecialtyShell(id); caseWorkspace = null; refreshSidebarLabel(); }
  }
  // Called by Home's "Start a new case" (Dx My Patient / Start a Case): if a specialty workspace is
  // active, open its engine and return true; if Internal Medicine, return false so Home runs its own
  // IM flow. The "this case" override is ONE-SHOT — consumed here so the next case reverts to default.
  function startActiveCase() { var a = activeWorkspace(); if (a === IM) return false; openSpecialtyShell(a); caseWorkspace = null; refreshSidebarLabel(); return true; }

  /* ───────────────────────────── specialty shell (interactive engine or framework) ───────────────────────────── */
  var _shell, LADCOL = { 0: "#047857", 1: "#65a30d", 2: "#0e6e63", 3: "#D97706", 4: "#b5460f", 5: "#ab1c2c" }, _es = null, _shellWs = null;
  function openSpecialtyShell(id) {
    injectCSS();
    _shellWs = id;
    var r = meta(id), eng = (window.SMD_WS_ENGINES || {})[id];
    if (!_shell) { _shell = document.createElement("div"); _shell.className = "sw-shell"; _shell.id = "swShell"; document.body.appendChild(_shell); }
    _es = null;
    var h = '<div class="sw-shead"><button class="bk" id="swShBack" aria-label="Back">‹</button>' +
      '<div class="ti">' + r.name + '<span class="ea">Early access</span></div>' +
      '<button class="sw-pill" id="swShPill"><span class="ic">' + ic(ICONS[id]) + '</span><span class="nm">' + r.name + '</span><span class="chev">▾</span></button></div>';
    h += '<div class="sw-sbody"><div class="sw-wm">' + wm(WMARKS[id]) + '</div>';
    h += '<div class="sw-note">Early access — advisory decision support, not a diagnosis or drug dose. It flags danger signs, whether antibiotics/source-control are needed, and referral. Verify against local protocol, imaging &amp; the individual patient. Internal Medicine remains the fully-validated engine.</div>';
    if (eng && eng.syndromes) {
      h += '<div class="sw-card"><h4>Step 1 · Choose the presentation</h4><div class="sw-chips" id="swSyn">' +
        eng.syndromes.map(function (s) { return '<button class="sw-synbtn" data-syn="' + s.id + '">' + s.name + '</button>'; }).join("") + '</div></div>';
      h += '<div id="swEngOut"></div>';
    } else {
      var steps = ["Presenting complaint / syndrome", "Focused specialty questions", "Severity / danger signs", "Differential & likely category", "Management: antibiotic need, referral, source-control / procedure"];
      h += '<div class="sw-card"><h4>5-step specialty pathway</h4>' + steps.map(function (s, i) { return '<div class="sw-step"><div class="n">' + (i + 1) + '</div><div class="lb">' + s + '</div></div>'; }).join("") + '</div>';
      if (r.syndromes) h += '<div class="sw-card"><h4>Syndrome entry points</h4><div class="sw-chips">' + r.syndromes.map(function (x) { return '<span class="sw-chip">' + x + '</span>'; }).join("") + '</div></div>';
      if (r.danger) h += '<div class="sw-card sw-danger"><h4>Danger signs — escalate</h4><div class="sw-chips">' + r.danger.map(function (x) { return '<span class="sw-chip">' + x + '</span>'; }).join("") + '</div></div>';
      h += '<div class="sw-card"><h4>Antibiotic / management ladder</h4><div class="sw-ladder">' + ABX_LADDER.map(function (x, i) { return '<div class="r"><span class="d" style="background:' + LADCOL[i] + '"></span>' + x + '</div>'; }).join("") + '</div></div>';
    }
    h += '<button class="sw-imbtn" id="swToIM">Switch to Internal Medicine (full engine)</button></div>';
    _shell.innerHTML = h;
    _shell.classList.add("on");
    _shell.querySelector("#swShBack").addEventListener("click", function () { _shell.classList.remove("on"); });
    _shell.querySelector("#swShPill").addEventListener("click", function () { openSheet({ inCase: true }); });
    _shell.querySelector("#swToIM").addEventListener("click", openIM);
    if (eng && eng.syndromes) {
      _shell.querySelectorAll("#swSyn .sw-synbtn").forEach(function (b) {
        b.addEventListener("click", function () {
          _shell.querySelectorAll("#swSyn .sw-synbtn").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on");
          var syn = null, sid = b.getAttribute("data-syn"); eng.syndromes.forEach(function (s) { if (s.id === sid) syn = s; });
          _es = { syn: syn, sel: {}, has: function (k) { return !!this.sel[k]; }, size: function () { var n = 0; for (var k in this.sel) if (this.sel[k]) n++; return n; } };
          renderSyndrome();
        });
      });
    }
  }
  function openIM() { if (_shell) _shell.classList.remove("on"); caseWorkspace = null; refreshSidebarLabel(); try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); } catch (e) {} }

  function selSet() { var s = new Set(); for (var k in _es.sel) if (_es.sel[k]) s.add(k); return s; }
  function renderSyndrome() {
    var out = document.getElementById("swEngOut"); if (!out || !_es) return;
    var syn = _es.syn, h = "";
    if (syn.q && syn.q.length) h += '<div class="sw-card"><h4>Step 2 · Focused findings</h4><div class="sw-chips">' + syn.q.map(function (q) { return '<button class="sw-tog' + (_es.has(q.id) ? " on" : "") + '" data-f="' + q.id + '">' + q.label + '</button>'; }).join("") + '</div></div>';
    if (syn.danger && syn.danger.length) h += '<div class="sw-card sw-danger"><h4>Step 3 · Danger signs</h4><div class="sw-chips">' + syn.danger.map(function (d) { return '<button class="sw-tog' + (_es.has(d.id) ? " on" : "") + '" data-f="' + d.id + '">' + d.label + '</button>'; }).join("") + '</div></div>';
    h += '<div id="swOut"></div>';
    out.innerHTML = h;
    out.querySelectorAll(".sw-tog").forEach(function (b) { b.addEventListener("click", function () { var f = b.getAttribute("data-f"); _es.sel[f] = !_es.sel[f]; b.classList.toggle("on"); renderOut(); }); });
    renderOut();
  }
  function renderOut() {
    var box = document.getElementById("swOut"); if (!box || !_es) return;
    var res = {}; try { res = _es.syn.assess(selSet()) || {}; } catch (e) { res = {}; }
    var lad = (typeof res.ladder === "number") ? res.ladder : -1;
    var h = '<div class="sw-card sw-out' + (res.emergency ? " emerg" : "") + '">';
    if (res.emergency) h += '<div class="sw-emerg">⚠ Time-critical — escalate now</div>';
    h += '<div class="sw-catg">Step 4 · ' + (res.catg || "Select findings above") + '</div>';
    h += '<div class="lab">Step 5 · Management</div>';
    h += '<div class="sw-ladder">' + ABX_LADDER.map(function (x, i) { return '<div class="r ' + (i === lad ? "on" : (lad >= 0 ? "dim" : "")) + '"><span class="d" style="background:' + LADCOL[i] + '"></span>' + x + '</div>'; }).join("") + '</div>';
    if (res.abx && res.abx.firstLine && res.abx.firstLine.length) {
      var ab = res.abx;
      var fmtAbx = function (x) { return '<b>' + (x.drug || "") + '</b>' + (x.dose ? " " + x.dose : "") + (x.route ? " " + x.route : "") + (x.note ? ' <span class="nt">(' + x.note + ')</span>' : ""); };
      h += '<div class="sw-abx"><div class="lab">Empiric antibiotics — verify locally</div>';
      h += '<div class="k">First-line</div><ul>' + ab.firstLine.map(function (x) { return "<li>" + fmtAbx(x) + "</li>"; }).join("") + "</ul>";
      if (ab.alt && ab.alt.length) h += '<div class="k">Alternatives</div><ul>' + ab.alt.map(function (x) { return "<li>" + fmtAbx(x) + "</li>"; }).join("") + "</ul>";
      h += '<div class="ref">' + (ab.ref ? ab.ref + " · " : "") + (ab.note || "Empiric — adjust to local antibiogram / ICMR, cultures, renal function & allergy.") + "</div></div>";
    }
    if (res.sc) { h += '<div class="lab">Source control / procedure</div><p>' + res.sc + '</p>'; }
    if (res.ref) { h += '<div class="lab">Referral / escalation</div><p>' + res.ref + '</p>'; }
    if (res.mgmt && res.mgmt.length) { h += '<div class="lab">Notes</div><ul>' + res.mgmt.map(function (m) { return '<li>' + m + '</li>'; }).join("") + '</ul>'; }
    if (res.shared || _es.syn.shared) {
      var sh = _es.syn.shared || {};
      h += '<div class="sw-shared"><b>Shared condition.</b> Internal Medicine is <b>primary</b>' + (sh.role ? ' — this workspace is the ' + sh.role.toLowerCase() : '') + '. It does not overwrite the IM assessment. Antibiotic choice + ICMR precedence stay in the IM pathway.</div>';
      h += '<button class="sw-openim" id="swOutIM">Open Internal Medicine pathway (primary)</button>';
    }
    // Point-of-care hand-off: jump into the stewardship / knowledge tools without leaving the flow.
    var poc = '<div class="sw-poc"><div class="lab">Take it further</div><div class="sw-pocrow">';
    if (lad >= 2) {
      poc += '<button class="sw-pocbtn abx" data-poc="abx">💊 Antibiotic choice</button>';
      poc += '<button class="sw-pocbtn" data-poc="ix">⚠ Interactions</button>';
    }
    poc += '<button class="sw-pocbtn" data-poc="maik">✦ Ask MaiK</button>';
    poc += '<button class="sw-pocbtn" data-poc="learn">📖 Learn more</button>';
    poc += '</div><div class="sw-pocnote">Antibiotic choice + dose per local antibiogram / ICMR &amp; the individual patient — these tools help you decide.</div></div>';
    h += poc;
    h += '<div class="sw-fb" id="swFb"><span class="q">Early access — was this helpful?</span>' +
      '<span class="btns"><button class="sw-fbbtn" data-v="up" aria-label="Helpful">👍</button>' +
      '<button class="sw-fbbtn" data-v="down" aria-label="Not helpful">👎</button>' +
      '<button class="sw-fbflag" data-v="flag">⚑ Flag an error</button></span></div>';
    h += '</div>';
    box.innerHTML = h;
    var oi = box.querySelector("#swOutIM"); if (oi) oi.addEventListener("click", openIM);
    box.querySelectorAll(".sw-pocbtn").forEach(function (b) { b.addEventListener("click", function () { pocAction(b.getAttribute("data-poc")); }); });
    var fb = box.querySelector("#swFb");
    if (fb) {
      fb.querySelectorAll(".sw-fbbtn").forEach(function (b) { b.addEventListener("click", function () { submitFeedback({ kind: "rating", helpful: b.getAttribute("data-v") }); }); });
      var flag = fb.querySelector(".sw-fbflag");
      if (flag) flag.addEventListener("click", function () {
        fb.innerHTML = '<div class="sw-fbflagbox"><textarea id="swFbNote" maxlength="500" rows="2" placeholder="What is wrong or unclear? Do NOT include any patient details."></textarea>' +
          '<div class="row"><span class="warn">No patient identifiers, please.</span><button class="sw-fbsend" id="swFbSend">Send</button></div></div>';
        var ta = fb.querySelector("#swFbNote"); if (ta) ta.focus();
        fb.querySelector("#swFbSend").addEventListener("click", function () { submitFeedback({ kind: "flag", helpful: null, note: (ta && ta.value) || "" }); });
      });
    }
  }
  /* ── Point-of-care hand-off: open the app's existing stewardship / knowledge tools,
       carrying the context. Hides the shell first (like openIM) so the tool is on top
       regardless of its z-index; the MaiK question preserves the clinical context. ── */
  function pocAction(kind) {
    var synName = (_es && _es.syn && _es.syn.name) || "", wsName = meta(_shellWs).name;
    if (_shell) _shell.classList.remove("on");
    try {
      if (kind === "abx") {
        if (window.ABG && ABG.open) return ABG.open();
        if (window.MEDDB && MEDDB.openList) return MEDDB.openList();
        return toast("Antibiogram loading…");
      }
      if (kind === "ix") { if (window.MEDDRUGS && MEDDRUGS.openInteractions) return MEDDRUGS.openInteractions(); return toast("Interaction checker loading…"); }
      if (kind === "learn") { if (window.SB && SB.openRef) return SB.openRef("syndromes"); return toast("Knowledge library loading…"); }
      if (kind === "maik") {
        var q = "In the " + wsName + " workspace" + (synName ? ", for " + synName : "") + ": summarise the key management — danger signs, whether antibiotics/source control are needed, referral, and the antibiotic choice if indicated (per ICMR / local antibiogram). Advisory.";
        if (window.SMD_askMaik) return SMD_askMaik(q);
        return toast("Assistant loading…");
      }
    } catch (e) { toast("Could not open — try from the home screen."); }
  }

  /* ── Early-access feedback: anonymous, no PHI. Mirrors locally + best-effort POST. ── */
  function submitFeedback(o) {
    var payload = { ws: _shellWs || "", syn: (_es && _es.syn && _es.syn.id) || "", kind: o.kind, helpful: o.helpful || null,
      findings: (function () { var a = []; if (_es) for (var k in _es.sel) if (_es.sel[k]) a.push(k); return a; })(),
      note: (o.note || "").slice(0, 500) };
    try { var K = "stewardmd_ws_fb_" + uid(), log = JSON.parse(localStorage.getItem(K) || "[]"); log.push(payload); if (log.length > 200) log = log.slice(-200); localStorage.setItem(K, JSON.stringify(log)); } catch (e) {}
    try { fetch("/api/ws-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true, cache: "no-store" }).catch(function () {}); } catch (e) {}
    var fb = document.getElementById("swFb"); if (fb) fb.innerHTML = '<span class="sw-fbthanks">✓ Thanks — your feedback helps improve this.</span>';
  }

  /* ───────────────────────────── sidebar switcher (wrap SB.open) ───────────────────────────── */
  function refreshSidebarLabel() { var w = activeWorkspace(); var b = document.querySelector("#sbMenu .sw-sbsw .nm"); if (b) b.textContent = meta(w).name; var i2 = document.querySelector("#sbMenu .sw-sbsw .ic"); if (i2) i2.innerHTML = ic(ICONS[w]); }
  function injectSidebarSwitcher() {
    var menu = document.getElementById("sbMenu"); if (!menu || menu.querySelector(".sw-sbsw")) return;
    // The redesigned sidebar (sidebar-redesign.js) OWNS #sbMenu and renders its own workspace row
    // (data-sbr-act="workspace") — don't double-inject / flash a legacy row it would just wipe.
    if (menu.getAttribute("data-sbr")) return;
    // find the "Clinical Reasoning" leaf button
    var target = null, btns = menu.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) { if (/clinical reasoning/i.test(btns[i].textContent || "")) { target = btns[i]; break; } }
    var lab = document.createElement("div"); lab.className = "sw-sblab"; lab.textContent = "Clinical workspace";
    var sw = document.createElement("button"); sw.className = "sw-sbsw";
    sw.innerHTML = '<span class="ic">' + ic(ICONS[activeWorkspace()]) + '</span><span class="nm">' + meta(activeWorkspace()).name + '</span><span class="chev">▾</span>';
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
    // NOTE: Clinical Reasoning is Internal-Medicine-only, so we do NOT inject a workspace
    // switcher pill here (it would wrongly imply you can run CR as another specialty).
    // Remove any pill left by an older build.
    var top = ov.querySelector(".dx-top");
    var oldPill = top && top.querySelector(".sw-pill");
    if (oldPill) oldPill.remove();
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
    startActiveCase: startActiveCase,
    setDefault: setDefault,
    suggest: suggestWorkspace,
    registry: REG,
    _prefs: function () { return prefs; }
  };
})();
