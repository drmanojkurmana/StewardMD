/* ============================================================================
   StewardMD — Features & How-to Guide (sidebar overlay)
   A scannable, mobile-first reference of everything the app can do and how to
   use it. Opened from the sidebar: ✨ Features & How-to Guide.
   ========================================================================== */
(function () {
  "use strict";

  function ftIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  // Built lazily (in build()) so window.ICONS (defined by home.js, which loads
  // after this file) is available when ftIco() resolves the line icons.
  function getSections(){ return [
    { h: ftIco("brain") + " Clinical Reasoning Engine (flagship)", items: [
      { n: "Live differential diagnosis", d: "Open <b>" + ftIco("brain") + " Clinical Reasoning</b> from the sidebar, or tap <b>" + ftIco("brain") + " Reasoning</b> in the header. The differential builds and re-ranks live as you add findings — no page reloads." },
      { n: "Progressive, consultant-style workflow", d: "Add <b>General findings</b> → pick the <b>involved system</b> → choose its <b>common findings</b> → tap <b>▼ Show more</b> for rarer ones. Mirrors bedside history-taking instead of one huge list." },
      { n: "Smart search & next-finding suggestions", d: "Use " + ftIco("search") + " <b>Search findings</b> to jump to any symptom/sign/lab. After each finding, <b>" + ftIco("spark") + " Suggested next findings</b> recommends the highest-yield questions to ask next." },
      { n: "Two-section differential", d: "Diagnoses are split into 🔴 <b>Infectious</b> and 🟢 <b>Non-infectious</b> cards, each with a <b>Clinical Confidence Score (0–100)</b> — a transparent weighted score, not a statistical probability." },
      { n: "Consultant reasoning, not symptom-counting", d: "The engine detects the <b>dominant organ system</b>, weights disease-defining findings (neck stiffness ≫ fever), and uses positive, contradictory and missing evidence to raise or lower confidence." },
      { n: "Every card explains itself", d: "Expand a card for <b>Supporting / Contradictory / Missing</b> findings, <b>Why this</b>, <b>Why not higher</b>, <b>red flags</b>, <b>suggested investigations</b>, and a <b>confidence trail</b> showing how the score moved." },
      { n: "Clinical Information Threshold", d: "To avoid a huge list after one vague symptom, the differential appears only once you have <b>≥3 meaningful findings</b> (or one highly specific finding). Until then it prompts for more information." },
      { n: "Antibiotic gate", d: "Before any antibiotic is suggested, the case is graded <b>Infection very likely → likely → possible → unlikely → non-infectious favoured</b>. Antibiotics surface only when infection genuinely leads (with sepsis & febrile-neutropenia safety rules)." },
      { n: "Related bedside tools", d: "When relevant, a diagnosis shows one-tap tools — e.g. shock → vasopressor + ICU dashboard, GI bleed → PPI infusion, DKA → insulin, stroke → A2DS2 score." },
      { n: "Select this diagnosis", d: "Tap <b>Select this diagnosis</b> on any card to open the full StewardMD management page (you stay in control — the engine supports, never replaces, your judgment)." }
    ]},
    { h: ftIco("reasoning") + " Advanced Reasoning Workspace (sidebar)", items: [
      { n: "Free-text case entry", d: "Open the sidebar <b>" + ftIco("brain") + " Clinical Reasoning</b> and type a plain-language vignette (e.g. “65M fever, neck stiffness, photophobia, drowsy”). Tap <b>" + ftIco("spark") + " Extract findings</b> and the engine builds the differential." },
      { n: "Compare diagnoses side-by-side", d: "Tap the " + ftIco("scales") + " button on up to 3 cards to compare their score, supporting, contradictory and missing findings in one grid." },
      { n: "Confidence timeline", d: "The workspace logs each finding you add and the leading diagnosis's confidence at that step, with ▲/▼ deltas." },
      { n: "Save · Continue · Export · Print", d: "Save a reasoning session to revisit later, reload saved sessions, copy a full summary to the clipboard, or print it." },
      { n: "One synchronised engine", d: "Findings stay in sync between the header wizard and the sidebar workspace — start in one, continue in the other." }
    ]},
    { h: ftIco("pills") + " Antimicrobial Stewardship", items: [
      { n: "Syndrome decision console", d: "From a selected diagnosis (or 'New clinical decision'), get empiric + definitive therapy, likely organisms, a coverage matrix, doses, route, duration, de-escalation and stewardship notes — with guideline references." },
      { n: "Hospital Antimicrobial Policy", d: "Pick your hospital at the top of the reasoning screen. <b>GIMSR</b> policy (HIC-3e 2024) is built in; recommendations show a <b>Recommendation Source</b> badge with the GIMSR logo, plus ICMR/IDSA secondary references." },
      { n: "AWaRe classification", d: "Antibiotics are flagged <b>Watch</b> or <b>Reserve · AMS approval</b> per the WHO/GIMSR AWaRe lists, to support responsible prescribing." },
      { n: "Treatment-failure / escalation wizard", d: "Enter the current drug, dose and duration to get an escalation/de-escalation recommendation based on resistance and guidelines." }
    ]},
    { h: ftIco("heart") + " ICU &amp; Infusion tools", items: [
      { n: "Infusion & Vasopressor calculator", d: "Sidebar → <b>Critical Care (ICU) → Infusion & Vasopressor</b>. Tap any of 24 drugs for a one-tap pump-rate, weight-based dosing, full monograph and <b>Nurse Mode</b> (copy/print-ready)." },
      { n: "Universal infusion calculator", d: "Compute pump rate / concentration / duration for any drug, amount, volume and rate unit." },
      { n: "ICU live-vitals dashboard", d: "Track MAP, lactate, urine output and running infusions with live target flags and an event log; values persist across reloads." },
      { n: "Hospital preparation protocols", d: "Edit and save your unit's standard drug preparations so all calculators use your local concentrations." }
    ]},
    { h: ftIco("calc") + " Calculators", items: [
      { n: "CrCl (Cockcroft-Gault)", d: "Sidebar → Calculators → CrCl. For renal dose adjustment." },
      { n: "MELD score", d: "Liver disease severity / mortality risk." },
      { n: "BMI / IBW", d: "Body-mass index and ideal body weight for weight-based dosing." },
      { n: "A2DS2 stroke score", d: "Stroke-associated pneumonia risk." }
    ]},
    { h: ftIco("folder") + " Cases, search &amp; reference", items: [
      { n: "My Cases", d: "Header " + ftIco("folder") + " <b>My Cases</b> — save a clinical decision and reopen it later with all findings and the full recommendation restored." },
      { n: "Search", d: "Header " + ftIco("search") + " — search across syndromes, drugs and calculators; jump straight to any tool." },
      { n: "Guidelines library", d: "Sidebar → Reference — links to Surviving Sepsis, IDSA, ATS/IDSA, ICMR, WHO, CLSI, GOLD, NICE, AWaRe and more, plus the ICMR 2024 antibiogram." }
    ]},
    { h: ftIco("settings") + " App &amp; display", items: [
      { n: "Dark / light mode", d: "Toggle the sun/moon button in the header (top-right). Your choice is remembered." },
      { n: "Mobile-first & installable", d: "Optimised for bedside phones and tablets; can be added to your home screen as an app (PWA)." }
    ]}
  ]; }

  var SAFETY = "StewardMD is clinical decision support — it supports, but does not replace, your clinical judgment. Nothing it shows is a confirmed diagnosis. Verify every dose, drug and recommendation against your patient and local policy. Medical content is pending clinician sign-off.";

  var root = null;
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}

  function build() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "feaOverlay"; root.className = "fea-overlay";
    var body = getSections().map(function (s) {
      return '<div class="fea-sec"><div class="fea-sec-h">' + s.h + '</div>' +
        s.items.map(function (it) { return '<div class="fea-item"><div class="fea-n">' + esc(it.n) + '</div><div class="fea-d">' + it.d + '</div></div>'; }).join("") +
        '</div>';
    }).join("");
    root.innerHTML =
      '<div class="fea-top"><button class="fea-close" id="feaClose" aria-label="Close">‹ Close</button>' +
        '<div class="fea-title">Features &amp; How-to Guide</div><span style="width:60px"></span></div>' +
      '<div class="fea-body">' +
        '<div class="fea-intro">Everything StewardMD can do, and how to use it. Tap any sidebar item to open the matching tool.</div>' +
        body +
        '<div class="fea-safety">' + esc(SAFETY) + '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("#feaClose").addEventListener("click", close);
    return root;
  }
  function open() { build(); root.classList.add("on"); document.body.classList.add("fea-lock"); }
  function close() { if (root) { root.classList.remove("on"); document.body.classList.remove("fea-lock"); } }

  function injectCSS() {
    var css = [
      ".fea-overlay{position:fixed;inset:0;z-index:840;background:var(--paper);display:none;flex-direction:column;overflow:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}",
      ".fea-overlay.on{display:flex;animation:feaIn .25s ease}",
      "@keyframes feaIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.fea-lock{overflow:hidden}",
      ".fea-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel);border-bottom:1px solid var(--line);z-index:2}",
      ".fea-close{background:transparent;border:1px solid var(--teal);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans);color:var(--teal);cursor:pointer}",
      ".fea-title{flex:1;text-align:center;font:800 16px var(--sans);color:var(--ink)}",
      ".fea-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;max-width:760px;margin:0 auto;width:100%;padding-bottom:calc(48px + env(safe-area-inset-bottom))}",
      ".fea-intro{font:500 13px var(--sans);color:var(--slate-soft);background:var(--teal-soft);border-radius:10px;padding:11px 13px;margin-bottom:16px;line-height:1.5}",
      ".fea-sec{margin-bottom:20px}",
      ".fea-sec-h{font:800 15px var(--sans);color:var(--ink);margin:0 0 10px;padding-bottom:7px;border-bottom:2px solid var(--teal-soft)}",
      ".fea-item{padding:9px 0;border-bottom:1px solid var(--line)}",
      ".fea-item:last-child{border-bottom:none}",
      ".fea-n{font:700 13.5px var(--sans);color:var(--teal)}",
      ".fea-d{font:500 12.5px var(--sans);color:var(--slate);line-height:1.55;margin-top:3px}",
      ".fea-d b{color:var(--ink);font-weight:700}",
      ".fea-safety{font:500 11.5px var(--sans);color:var(--slate-soft);background:var(--panel);border:1px dashed var(--line);border-radius:10px;padding:11px 13px;margin-top:8px;line-height:1.55}"
    ].join("");
    var st = document.createElement("style"); st.id = "fea-styles"; st.textContent = css; document.head.appendChild(st);
  }
  injectCSS();
  window.FEATURES = { open: open, close: close };
})();
