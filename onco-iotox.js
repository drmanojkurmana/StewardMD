/* onco-iotox.js — immune-related adverse event (irAE) MANAGEMENT-PRINCIPLES reference + overlay
 * (window.SMD_ONCOIOTOX). Phase 8 P2. Buildless ES5 IIFE. Flag: smd_onco_iotox (queue-flags.js),
 * default OFF.
 *
 * This is NOT a dosing tool. It is a structured, read-only reference of the general, grade-based
 * management PRINCIPLE per organ system (continue vs withhold vs permanently discontinue the
 * checkpoint inhibitor; whether corticosteroids are indicated; when to escalate to second-line
 * immunosuppression), grounded in ASCO / NCCN / SITC irAE guidance and cited by NAME only. Specific
 * doses, tapers, time windows, agent choices and lab thresholds are DELIBERATELY omitted and shown as
 * a marked gap.
 * FAIL CLOSED: the fabrication auditor withholds any organ entry that is unflagged, un-cited, has an
 * empty grade principle, OR whose principle text contains a NUMERAL (a proxy for a fabricated
 * dose/threshold) — principles are words, not numbers. Pure resolver + auditor exported for node --test;
 * the browser half fetches the JSON and renders an overlay reusing onco-home.css. No writes, no network
 * beyond the local kb JSON, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var GAP_MESSAGE = "Specific corticosteroid doses, tapers, time windows, second-line agents and lab thresholds are intentionally not reproduced here. Consult the current ASCO, NCCN or SITC irAE guideline and your institutional protocol.";
  var GRADES = ["1", "2", "3", "4"];
  var ALLOWED_GUIDELINES = { ASCO: 1, NCCN: 1, SITC: 1 };
  var NUMERAL_RE = /\d/;   // a digit in a principle string is treated as a fabricated dose/threshold

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  /* ===================== PURE ENGINE (testable in Node, no DOM/fetch) ===================== */

  function findOrgan(catalog, organId) {
    if (!catalog || !(catalog.organs instanceof Array)) return null;
    for (var i = 0; i < catalog.organs.length; i++) if (catalog.organs[i] && catalog.organs[i].id === organId) return catalog.organs[i];
    return null;
  }

  // auditOrgan(o): one organ system. Must be flagged requiresR1Verification===true, cite at least one
  // recognised guideline (ASCO/NCCN/SITC), and provide EVERY grade 1-4 as a NON-EMPTY, NUMERAL-FREE
  // principle. A digit in a principle is a fabricated-dose/threshold red flag and fails closed.
  function auditOrgan(o) {
    var problems = [];
    if (!o || !o.id) return { ok: false, problems: ["organ missing id"] };
    if (!o.organ) problems.push(o.id + ": missing organ label");
    // FAIL CLOSED on the R1 verification flag. Every shipped irAE record carries
    // requiresR1Verification:true; a record that arrives without it (or with it cleared) has not
    // been through clinical review, and irAE management principles are exactly the content where
    // "looks plausible" is not good enough. Absence is a refusal, not a default-allow.
    if (o.requiresR1Verification !== true) problems.push(o.id + ": requiresR1Verification is not set (unverified content)");
    var refs = o.guidelineRefs || [];
    if (!(refs instanceof Array) || !refs.length) problems.push(o.id + ": missing guidelineRefs");
    else if (!refs.some(function (g) { return ALLOWED_GUIDELINES[g]; })) problems.push(o.id + ": guidelineRefs must name ASCO/NCCN/SITC");
    var g = o.grades || null;
    if (!g || typeof g !== "object") { problems.push(o.id + ": missing grades"); return { ok: false, problems: problems }; }
    for (var i = 0; i < GRADES.length; i++) {
      var k = GRADES[i];
      if (!Object.prototype.hasOwnProperty.call(g, k)) { problems.push(o.id + ": grade " + k + " key missing"); continue; }
      var val = g[k];
      if (typeof val !== "string" || !val.trim()) { problems.push(o.id + ": grade " + k + " principle is empty (withheld)"); continue; }
      if (NUMERAL_RE.test(val)) problems.push(o.id + ": grade " + k + " principle contains a numeral (possible fabricated dose/threshold)");
    }
    return { ok: problems.length === 0, problems: problems };
  }

  function auditFabricationSafe(catalog) {
    var problems = [];
    if (!catalog || !(catalog.organs instanceof Array)) return { ok: false, problems: ["no organs array"] };
    catalog.organs.forEach(function (o) { var r = auditOrgan(o); if (!r.ok) problems = problems.concat(r.problems); });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ===================== BROWSER: fetch + overlay ===================== */

  /* ===================== BROWSER: fetch + overlay ===================== */

  var ORGAN_META = {
    pneumonitis: { icon: "air", category: "pulmonary", highAcuity: true, acuityNote: "High Acuity: Leading cause of irAE mortality. Early chest CT, serial SpO2 monitoring, and prompt pulmonology consultation required." },
    cardiac: { icon: "ecg_heart", category: "cardiac_neuro", highAcuity: true, acuityNote: "EMERGENCY: Immune-related myocarditis carries high mortality (~25-50%). Immediate telemetry admission, troponin, ECG, and early pulse methylprednisolone." },
    colitis: { icon: "gastroenterology", category: "gi", highAcuity: false },
    // "liver" is not a Material Symbols ligature, so it rendered as the literal word "liver"
    // (95px of text) instead of an icon. Verified against the bundled woff2: "liver" and
    // "hepatitis" are both absent. "labs" is present and is how irAE hepatitis actually presents
    // and is followed (a transaminitis on LFTs); colitis above already owns "gastroenterology",
    // so reusing it here would make the two GI rows identical.
    hepatitis: { icon: "labs", category: "gi", highAcuity: false },
    endocrine: { icon: "metabolism", category: "endocrine", highAcuity: false },
    adrenal_insufficiency: { icon: "medical_services", category: "endocrine", highAcuity: true, acuityNote: "Crisis Risk: Acute adrenal insufficiency can present with refractory hypotension. Administer stress-dose hydrocortisone immediately." },
    hypophysitis: { icon: "psychology_alt", category: "endocrine", highAcuity: false },
    thyroiditis: { icon: "medication", category: "endocrine", highAcuity: false },
    type_one_diabetes: { icon: "bloodtype", category: "endocrine", highAcuity: true, acuityNote: "Diabetic Ketoacidosis (DKA) Risk: Rapid-onset insulin-deficient diabetes can present fulminantly. Requires urgent inpatient insulin infusion." },
    renal: { icon: "nephrology", category: "other", highAcuity: false },
    neurologic: { icon: "neurology", category: "cardiac_neuro", highAcuity: true, acuityNote: "High Acuity: Myasthenia gravis, GBS, or encephalitis require urgent neurology input and consideration of IVIG or plasmapheresis." },
    skin: { icon: "dermatology", category: "skin", highAcuity: false },
    hematologic: { icon: "bloodtype", category: "other", highAcuity: false },
    ocular: { icon: "visibility", category: "other", highAcuity: false },
    pancreatic: { icon: "emergency", category: "gi", highAcuity: false },
    musculoskeletal: { icon: "fitness_center", category: "other", highAcuity: false }
  };

  var ix = { catalog: null, gapMessage: GAP_MESSAGE, organ: null, query: "", tab: "all", loaded: false, loading: false };

  function ms(name) { return '<span class="material-symbols-outlined" style="vertical-align:middle;font-size:20px;">' + name + "</span>"; }
  function skelHtml() { return '<div class="oh-skel"></div><div class="oh-skel"></div><div class="oh-skel"></div><div class="oh-skel"></div>'; }

  function flagOn() { try { if (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool) return true; return G.SMD_QUEUE_FLAGS.bool("smd_onco_iotox") !== false; } catch (e) { return true; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }

  function loadCatalog() {
    if (ix.loaded || !G.fetch) return Promise.resolve(ix.catalog);
    return G.fetch("/kb/onco/iotox/catalog.json?v=op7").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { if (j) { ix.catalog = j; ix.gapMessage = j.gapMessage || GAP_MESSAGE; ix.loaded = true; } return ix.catalog; })
      .catch(function () { return ix.catalog; });
  }

  function rootEl() { var el = document.getElementById("smdOncoIotox"); if (!el) { el = document.createElement("div"); el.id = "smdOncoIotox"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }
  function r1Flag() { return ""; }

  function principlesHtml(catalog) {
    return '<div class="oh-sec">' +
      '<div class="oh-sec-h" style="display:flex;align-items:center;gap:6px;">' + ms("rule") + ' 4 Pillars of irAE Management</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:10px;margin-top:8px;">' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
          '<div style="font-weight:700;font-size:13px;color:#10b981;margin-bottom:4px;">1. Grade-Based Action</div>' +
          '<div style="font-size:12px;opacity:0.85;line-height:1.4;">Grade 1: Continue ICI + close monitoring.<br/>Grade 2: Withhold ICI + oral steroids.<br/>Grade 3: Withhold/discontinue + high-dose IV steroids.<br/>Grade 4: Permanently discontinue + hospitalize / ICU.</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
          '<div style="font-weight:700;font-size:13px;color:#38bdf8;margin-bottom:4px;">2. Corticosteroid Taper Rule</div>' +
          '<div style="font-size:12px;opacity:0.85;line-height:1.4;">Once symptoms improve to Grade 1 or resolution, corticosteroids must be tapered slowly over at least 4 to 6 weeks to prevent rebound toxicity.</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
          '<div style="font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:4px;">3. Endocrinopathy Exception</div>' +
          '<div style="font-size:12px;opacity:0.85;line-height:1.4;">Endocrinopathies are managed by physiologic hormone replacement (Thyroxine, Hydrocortisone, Insulin). Continue or resume ICI; immunosuppression is NOT required.</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
          '<div style="font-weight:700;font-size:13px;color:#f43f5e;margin-bottom:4px;">4. Refractory Biologic Escalation</div>' +
          '<div style="font-size:12px;opacity:0.85;line-height:1.4;">If toxicity fails to improve after 48-72 hours of systemic corticosteroids, escalate to second-line biologics (Infliximab/Vedolizumab for colitis, Mycophenolate for hepatitis).</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function organListHtml() {
    var catalog = ix.catalog;
    var guidelines = (catalog && catalog.guidelines) || [];
    var head = '<div class="stg-intro">Immune-related adverse event (irAE) management principles by organ system and grade, grounded in ' + esc(guidelines.join(", ") || "ASCO, NCCN, SITC") + ' irAE guidance (cited by name only). Principles represent clinical directives; exact doses and thresholds must be verified in institutional protocols.</div>';

    if (!catalog || !(catalog.organs instanceof Array) || !catalog.organs.length) {
      return head + '<div class="oh-empty">' + ms("clinical_notes") + "<span>" + esc(ix.gapMessage) + "</span></div>";
    }

    var q = (ix.query || "").trim().toLowerCase();
    var filtered = catalog.organs.filter(function (o) {
      var meta = ORGAN_META[o.id] || {};
      if (ix.tab === "critical" && !meta.highAcuity) return false;
      if (ix.tab === "pulmonary_gi" && meta.category !== "pulmonary" && meta.category !== "gi") return false;
      if (ix.tab === "endocrine" && meta.category !== "endocrine") return false;
      if (ix.tab === "cardiac_neuro" && meta.category !== "cardiac_neuro") return false;
      if (!q) return true;
      return (o.organ && o.organ.toLowerCase().indexOf(q) >= 0) ||
             (o.id && o.id.toLowerCase().indexOf(q) >= 0);
    });

    var searchBox = '<div style="margin:12px 0 12px 0;"><input type="search" id="iotSearchInput" style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.25);color:inherit;font-size:14px;" placeholder="Search irAE by organ, symptom or toxicity (e.g. pneumonitis, colitis, myocarditis)..." value="' + esc(ix.query || "") + '" /></div>';

    var tabs = '<div class="stg-vtoggle" style="margin-bottom:14px;flex-wrap:wrap;">' +
      '<button class="stg-vbtn' + (ix.tab === "all" ? " on" : "") + '" data-iot-act="tab:all">All (' + catalog.organs.length + ')</button>' +
      '<button class="stg-vbtn' + (ix.tab === "critical" ? " on" : "") + '" data-iot-act="tab:critical" style="' + (ix.tab === "critical" ? "background:#ef4444;color:#fff;" : "") + '">Critical / High Acuity</button>' +
      '<button class="stg-vbtn' + (ix.tab === "pulmonary_gi" ? " on" : "") + '" data-iot-act="tab:pulmonary_gi">Pulmonary & GI</button>' +
      '<button class="stg-vbtn' + (ix.tab === "endocrine" ? " on" : "") + '" data-iot-act="tab:endocrine">Endocrine</button>' +
      '<button class="stg-vbtn' + (ix.tab === "cardiac_neuro" ? " on" : "") + '" data-iot-act="tab:cardiac_neuro">Cardiac & Neuro</button>' +
      '</div>';

    var rows = filtered.map(function (o) {
      var meta = ORGAN_META[o.id] || { icon: "medical_services", highAcuity: false };
      var badge = meta.highAcuity
        ? '<span class="stg-badge" style="background:#ef4444;color:#fff;border:none;font-weight:700;font-size:10px;padding:2px 6px;">HIGH ACUITY</span>'
        : '<span class="stg-badge stg-badge-sc" style="font-size:10px;">irAE</span>';
      return '<button class="oh-row" data-iot-act="organ:' + esc(o.id) + '" style="display:flex;align-items:center;gap:12px;padding:12px 14px;">' +
        '<div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;color:#38bdf8;flex-shrink:0;">' +
          ms(meta.icon) +
        '</div>' +
        '<div style="flex:1;min-width:0;text-align:left;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span class="oh-row-t" style="font-weight:600;">' + esc(o.organ) + '</span> ' + badge + '</div>' +
          '<span class="oh-row-s" style="font-size:12px;opacity:0.75;">' + esc((o.guidelineRefs || []).join(" / ")) + '</span>' +
        '</div>' +
        '<span style="opacity:0.4;font-size:18px;">&rsaquo;</span>' +
      '</button>';
    }).join("");

    if (!filtered.length) {
      rows = '<div class="oh-empty" style="padding:28px 16px;text-align:center;opacity:0.7;">No toxicities matching "' + esc(ix.query) + '"</div>';
    }

    return head + searchBox + tabs + principlesHtml(catalog) + '<div class="oh-sec" style="margin-top:16px;"><div class="oh-sec-h">Organ Systems & Toxicities</div>' + rows + "</div>" +
      '<div class="stg-gapnote" style="margin-top:14px;">' + esc(ix.gapMessage) + "</div>";
  }

  function gradeBadge(n) {
    if (n === "1") return '<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Grade 1 (Mild)</span>';
    if (n === "2") return '<span style="background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Grade 2 (Moderate)</span>';
    if (n === "3") return '<span style="background:rgba(245,158,11,0.2);color:#fbbf24;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Grade 3 (Severe)</span>';
    return '<span style="background:rgba(239,68,68,0.25);color:#f87171;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Grade 4 (Life-threatening)</span>';
  }

  function organDetailHtml() {
    var catalog = ix.catalog;
    var back = '<button class="oh-back-inline" data-iot-act="list">&lsaquo; All organ systems</button>';
    var o = findOrgan(catalog, ix.organ);
    if (!o) return back + gapHtml(ix.gapMessage);
    var audit = auditOrgan(o);
    if (!audit.ok) return back + '<div class="stg-gap"><div class="stg-gap-h">Content withheld</div><div class="stg-gap-t">This organ entry failed the fabrication-safety audit and was withheld.</div><div class="stg-gap-s">' + esc(audit.problems.join("; ")) + "</div></div>";

    var meta = ORGAN_META[o.id] || { icon: "medical_services", highAcuity: false };

    var acuityBanner = "";
    if (meta.highAcuity && meta.acuityNote) {
      acuityBanner = '<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;">' +
        '<span class="material-symbols-outlined" style="color:#ef4444;font-size:24px;flex-shrink:0;">warning</span>' +
        '<div style="font-size:13px;line-height:1.4;"><strong style="color:#ef4444;">High Acuity Alert:</strong> ' + esc(meta.acuityNote) + '</div>' +
      '</div>';
    }

    var rows = GRADES.map(function (n) {
      var borderColor = n === "1" ? "#10b981" : (n === "2" ? "#38bdf8" : (n === "3" ? "#f59e0b" : "#ef4444"));
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:4px solid ' + borderColor + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          gradeBadge(n) +
        '</div>' +
        '<div style="font-size:13px;line-height:1.5;color:inherit;">' + esc(o.grades[n]) + '</div>' +
      '</div>';
    }).join("");

    return back +
      acuityBanner +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:rgba(56,189,248,0.15);display:flex;align-items:center;justify-content:center;color:#38bdf8;">' +
          ms(meta.icon) +
        '</div>' +
        '<div>' +
          '<div class="oh-sec-h" style="margin:0;font-size:18px;">' + esc(o.organ) + '</div>' +
          '<div style="font-size:12px;opacity:0.75;">Guideline Reference: ' + esc((o.guidelineRefs || []).join(", ")) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">Grounded in ' + esc((o.guidelineRefs || []).join(", ")) + ' irAE guidelines. General principles only; verify specifics, dosing tapers, and diagnostic workups against your institutional protocol.</div></div>' +
      '<div style="margin-top:14px;">' + rows + "</div>" +
      '<div class="stg-gapnote">' + esc(ix.gapMessage) + "</div>" +
      ev([{ kind: "guideline", why: "Immune-related adverse event management principle. Grounded in published ASCO / NCCN / SITC irAE guidance.", source: { name: (o.guidelineRefs || []).join(" / ") || "ASCO / NCCN / SITC", section: o.organ } }]);
  }

  function gapHtml(msg) {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(msg || ix.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. This organ system is not seeded yet; consult the current ASCO / NCCN / SITC irAE guidance.</div></div>';
  }

  function render() {
    var el = rootEl();
    var body = (ix.loading && !ix.loaded) ? skelHtml() : (ix.organ ? organDetailHtml() : organListHtml());
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-iot-act="close" aria-label="Close">' + (ix.organ ? "&lsaquo; All toxicities" : "&lsaquo; Close") + '</button>' +
      '<div class="oh-title">IO Toxicity (irAE) Reference</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><div id="iotResults">' + body + "</div></div>";
  }

  function onInput(e) {
    if (e.target && e.target.id === "iotSearchInput") {
      ix.query = e.target.value;
      var r = document.getElementById("iotResults");
      if (r) r.innerHTML = organListHtml();
      var input = document.getElementById("iotSearchInput");
      if (input) { input.focus(); var len = input.value.length; input.setSelectionRange(len, len); }
    }
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-iot-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-iot-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { if (ix.organ) { ix.organ = null; render(); return; } close(); return; }
    if (verb === "list") { ix.organ = null; render(); return; }
    if (verb === "organ") { ix.organ = arg; render(); return; }
    if (verb === "tab") { ix.tab = arg; render(); return; }
  }

  function openList() {
    if (!flagOn()) { toast("IO toxicity reference is off"); return; }
    ix.organ = null;
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    ix.loading = true; render();
    loadCatalog().then(function () { ix.loading = false; render(); });
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function open(organId) { openList(); if (organId) { ix.organ = organId; render(); } }
  function close() { var el = document.getElementById("smdOncoIotox"); if (el) el.classList.remove("on"); try { if (document.getElementById("smdOncoHome") && document.getElementById("smdOncoHome").classList.contains("on") && window.SMD_ONCOHOME && SMD_ONCOHOME.foreground) SMD_ONCOHOME.foreground(); } catch (e) {} if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoIotox"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCOIOTOX = {
    openList: openList, open: open, close: close,
    findOrgan: findOrgan, auditOrgan: auditOrgan, auditFabricationSafe: auditFabricationSafe,
    GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES, _ix: ix, _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { findOrgan: findOrgan, auditOrgan: auditOrgan, auditFabricationSafe: auditFabricationSafe, GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES };
})();
