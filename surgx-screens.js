/* surgx-screens.js — SURGX · router + the five sections.
 * ===========================================================================
 * Sibling of clinix-screens.js / thorex-screens.js. Scoped to #surgxRoot / #surgxScroll / .sgx-*.
 *
 * All data-act values are prefixed sgx- so they cannot collide with home.js's ACT map.
 * Back and close controls use .sgx-back / .sgx-close, which swipe-back.js's BACK_SEL already
 * matches via its [class*="-back"] / [class*="-close"] patterns - no wiring needed there.
 *
 * Routes are plain strings on a stack: "home", "protocols", "protocol/<id>", "procedures",
 * "procedure/<id>", "evidence", "evidence/<id>", "cases", "case/<id>", "notes", "note/<id>".
 * There is no framework router in this app and this does not introduce one.
 *
 * Three things this file is deliberately NOT:
 *   - it is not a chatbot. There is no free-text AI surface anywhere in SURGX.
 *   - it does not own clinical logic. Protocol decisions come from ws-surgery.js via
 *     surgx-content.js; note validity comes from surgx-model.js. This renders.
 *   - it does not gamify. No streaks, no badges, no celebration. A surgical reference does not
 *     congratulate you.
 */
(function () {
  "use strict";

  /* ── shorthands ──────────────────────────────────────────────────────────── */

  function C() { try { return window.SMD_SURGX_CONTENT || null; } catch (e) { return null; } }
  function M() { try { return window.SMD_SURGX_MODEL || null; } catch (e) { return null; } }
  function ST() { try { return window.SMD_SURGX_STORE || null; } catch (e) { return null; } }
  function DEST() { try { return window.SMD_SURGX_DEST || null; } catch (e) { return null; } }
  function PT() { try { return window.SMD_SURGX_PATIENT || null; } catch (e) { return null; } }
  function EV() { try { return window.SMD_SURGX_EVIDENCE || null; } catch (e) { return null; } }
  function NS() { try { return window.SMD_SURGX_NOTE_SCHEMA || null; } catch (e) { return null; } }
  function ENT() { try { return window.SMD_SURGX_ENTITLEMENT || null; } catch (e) { return null; } }
  function DIA() { try { return window.SMD_SURGX_DIAGRAMS || null; } catch (e) { return null; } }
  function flag(k) { try { return !!(window.SMD_SURGX_FLAGS && SMD_SURGX_FLAGS.bool(k)); } catch (e) { return false; } }

  function ic(n) { return '<span class="material-symbols-rounded" aria-hidden="true">' + n + "</span>"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function attr(s) { return esc(s).replace(/\s/g, " "); }
  function haptic(k) {
    try {
      if (flag("smd_surgx_haptics") && window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k]();
    } catch (e) {}
  }
  function toast(m) {
    try { if (window.toast) return window.toast(m); } catch (e) {}
    try { if (window.SB && SB.toast) return SB.toast(m); } catch (e) {}
  }
  function todayISO() {
    try {
      var d = new Date();
      return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    } catch (e) { return ""; }
  }

  /* ── state ───────────────────────────────────────────────────────────────── */

  var state = {
    root: null, host: null,
    stack: ["home"],
    // protocols
    protoIndex: null, proto: null, protoSel: null, protoCat: "",
    // procedures
    procList: null, proc: null, procTab: "indications",
    // evidence
    evList: null, evQuery: "",
    // cases
    caseList: null, kase: null, caseAnswers: null, caseIdx: 0, caseLevel: "",
    // notes
    noteIndex: null, note: null, noteSchema: null, noteType: "", noteTemplate: ""
  };

  function route() { return state.stack[state.stack.length - 1] || "home"; }
  function routeHead() { return String(route()).split("/")[0]; }
  function routeArg() { var p = String(route()).split("/"); return p.slice(1).join("/"); }

  function go(r) {
    state.stack.push(r);
    render();
    try { state.host.scrollTop = 0; } catch (e) {}
  }
  function back() {
    if (state.stack.length > 1) { state.stack.pop(); render(); try { state.host.scrollTop = 0; } catch (e) {} }
    else if (window.SURGX) window.SURGX.close();
  }
  function replace(r) { state.stack[state.stack.length - 1] = r; render(); }

  /* ── chrome ──────────────────────────────────────────────────────────────── */

  function head(title, sub, opts) {
    opts = opts || {};
    var isHome = route() === "home";
    var lead = isHome
      ? '<button class="sgx-hbtn sgx-close" data-sgx="close" aria-label="Close SURGX">' + ic("close") + "</button>"
      : '<button class="sgx-hbtn sgx-back" data-sgx="back" aria-label="Back">' + ic("arrow_back") + "</button>";
    var right = opts.right || "";
    // The eyebrow must not simply repeat the title. "Acute abdomen / Acute abdomen" is what
    // category-as-subtitle produces for a protocol whose name IS its category.
    if (sub && String(sub).toLowerCase() === String(title).toLowerCase()) sub = "";
    // titleless: the screen below already carries the wordmark. On HOME the hero sits directly under
    // this bar, so printing SURGX in both stacked the same title twice (reported from internal
    // testing: "Remove this....keep it as clinix"). The bar is kept for its close button; the overlay
    // and that button both still name SURGX for screen readers.
    return '<div class="sgx-head' + (opts.titleless ? " sgx-head-bare" : "") + '">' + lead +
      (opts.titleless ? '<div class="sgx-htitle"></div>' :
      '<div class="sgx-htitle">' + (sub ? '<span class="sgx-hsub">' + esc(sub) + "</span>" : "") +
      (opts.rawTitle || esc(title)) + "</div>") +
      right +
      (isHome ? "" : '<button class="sgx-hbtn sgx-close" data-sgx="close" aria-label="Close SURGX">' + ic("close") + "</button>") +
      "</div>";
  }
  function wrap(inner) { return '<div class="sgx-wrap">' + inner + "</div>"; }
  function loading() { return '<div class="sgx-skel"><i></i><i></i><i></i></div>'; }
  function emptyState(icon, title, sub, action) {
    return '<div class="sgx-state"><div class="ic">' + ic(icon) + "</div>" +
      '<div class="t">' + esc(title) + "</div>" +
      '<div class="s">' + esc(sub) + "</div>" + (action || "") + "</div>";
  }
  function errorState(msg, retryRoute) {
    return emptyState("cloud_off", "Could not load this", msg,
      '<button class="sgx-btn" data-sgx="retry" data-r="' + attr(retryRoute || route()) + '">Try again</button>');
  }

  function paint(html) {
    if (!state.host) return;
    state.host.innerHTML = html;
  }

  /* ── calculator deep links (reuse, never duplicate) ──────────────────────── */

  /* SURGX has no calculators of its own, by product decision. Where a surgical score matters it
   * deep-links into the existing Calculators module. MEDCALC.get() is checked first so a link to a
   * calculator this build does not have simply is not rendered - the same fail-soft behaviour
   * calc-links.js's filterExisting() already relies on. */
  function calcChips(ids) {
    if (!ids || !ids.length) return "";
    var out = [], i, c;
    for (i = 0; i < ids.length; i++) {
      try { c = (window.MEDCALC && MEDCALC.get) ? MEDCALC.get(ids[i]) : null; } catch (e) { c = null; }
      if (!c) continue;
      out.push('<button class="sgx-chip calc" data-sgx="calc" data-id="' + attr(ids[i]) + '">' +
        esc(c.title || ids[i]) + "</button>");
      if (out.length >= 8) break;
    }
    if (!out.length) return "";
    return '<div class="sgx-card"><h4>Scores and calculators</h4><div class="sgx-chips">' + out.join("") +
      '</div><div class="sgx-disclaim" style="margin-top:10px;border:none;padding:6px 0 0">Opens the StewardMD Calculators module. SURGX keeps no calculators of its own.</div></div>';
  }
  function openCalc(id) {
    try {
      if (window.MEDCALC && MEDCALC.open) { MEDCALC.open(id); return; }
    } catch (e) {}
    toast("Calculators are still loading");
  }

  /* ── media (licence gate applied by surgx-content.js) ────────────────────── */

  function mediaBlock(registry, id) {
    var cc = C(); if (!cc) return "";
    var m = cc.media(registry, id);
    if (!m) return "";
    if (!m.renderable) {
      return '<div class="sgx-media pending">' + ic("image_not_supported") +
        " <b>" + esc(m.title || "Visual pending") + "</b><div style=\"margin-top:6px\">" + esc(m.caption) + "</div>" +
        '<div style="margin-top:6px;opacity:.8">' + esc(m.pendingNote) + "</div></div>";
    }
    var body = "";
    if (m.inline && DIA()) body = DIA().get(m.diagramId) || "";
    else if (m.src) body = '<img src="' + attr(m.src) + '" alt="' + attr(m.caption) + '" loading="lazy">';
    if (!body) return "";
    return '<div class="sgx-media">' + body +
      '<div class="cap">' + esc(m.caption) + "</div>" +
      '<div class="attr">' + esc(m.attribution) + (m.licence ? " · " + esc(m.licence) : "") + "</div></div>";
  }

  /* ── citations ───────────────────────────────────────────────────────────── */

  function citeLine(src) {
    var ev = EV(); if (!src || !ev) return "";
    var txt = ev.citation(src);
    if (!txt) return "";
    var url = src.url && /^https?:\/\//i.test(src.url) ? src.url : "";
    return '<span class="cite">' + ic("menu_book") + " <b>Source:</b> " +
      (url ? '<a href="' + attr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + "</a>" : esc(txt)) +
      "</span>";
  }
  /* ONE meta strip instead of three stacked banners.
   *
   * Draft state, source currency and the educational framing all have to be on the screen, but
   * three full-width banners above every protocol pushed the RED FLAGS band below the fold on a
   * 390px phone - which defeats the entire point of the seven-band spine. They are compressed into
   * a row of small pills, and only a genuinely urgent fact (overdue review) is promoted back to a
   * full banner. Nothing is dropped; it is only made proportionate. */
  function metaStrip(compiled, extra) {
    var ev = EV();
    var pills = [], promoted = "";
    var status = compiled.review;

    if (status !== "approved" && status !== "published") {
      pills.push('<span class="sgx-pill warn" title="Every recommendation here carries its source. Verify before acting.">' +
        ic("edit_note") + " Draft, pending clinician review</span>");
    }
    if (extra) pills.push(extra);

    if (ev) {
      var c = ev.currency(compiled, todayISO());
      if (c.count) {
        var yrs = c.oldest === c.newest ? String(c.oldest) : (c.oldest + " to " + c.newest);
        pills.push('<span class="sgx-pill">' + ic("verified") + " Sources " + esc(yrs) + "</span>");
      }
      if (c.overdue) {
        // The one fact that earns a full banner: a guideline reference past its own review date is
        // a clinical hazard, and it should not be a pill someone scrolls past.
        promoted = '<div class="sgx-banner warn">' + ic("history") + " Review overdue" +
          (c.due ? " (due " + esc(c.due) + ")" : "") +
          ". Confirm against the current edition before relying on this.</div>";
      } else if (c.due) {
        pills.push('<span class="sgx-pill">' + ic("event") + " Next review " + esc(c.due) + "</span>");
      }
    }
    return (pills.length ? '<div class="sgx-meta">' + pills.join("") + "</div>" : "") + promoted;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     HOME
     ═══════════════════════════════════════════════════════════════════════ */

  var SECTIONS = [
    { n: "01", id: "notes", act: "notes", tt: "Notes", sb: "Operative, pre-op, post-op, progress and discharge documentation", icon: "clinical_notes" },
    { n: "02", id: "protocols", act: "protocols", tt: "Protocols", sb: "Trauma, surgical emergencies and peri-operative pathways", icon: "emergency" },
    { n: "03", id: "procedures", act: "procedures", tt: "Procedures", sb: "Step-by-step operative reference and structures at risk", icon: "content_cut" },
    { n: "04", id: "evidence", act: "evidence", tt: "Evidence", sb: "Guidelines, sources and the reasoning behind them", icon: "menu_book" },
    { n: "05", id: "cases", act: "cases", tt: "Cases", sb: "Interactive surgical reasoning with a senior surgeon's questions", icon: "psychology" }
  ];

  function screenHome() {
    var st = ST();
    var notesAccess = ENT() ? ENT().notesAccess() : "off";
    var rows = SECTIONS.map(function (s) {
      var locked = "";
      var disabled = "";
      if (s.id === "notes") {
        if (notesAccess === "off") return "";
        if (notesAccess === "verify_required") locked = '<span class="lock">Verify</span>';
      }
      return '<button class="sgx-sec" data-sgx="go" data-r="' + attr(s.act) + '"' + disabled + '>' +
        '<span class="n">' + s.n + "</span>" +
        '<span class="tx"><span class="tt">' + esc(s.tt) + '</span><span class="sb">' + esc(s.sb) + "</span></span>" +
        locked +
        '<span class="go">' + ic("chevron_right") + "</span></button>";
    }).join("");

    var recents = st ? st.recents() : [];
    var recentHTML = "";
    if (recents.length) {
      recentHTML = '<div class="sgx-seclabel">Recent</div>' + recents.map(function (r) {
        return '<button class="sgx-row" data-sgx="go" data-r="' + attr(r.kind + "/" + r.id) + '">' +
          '<span class="tx"><span class="tt">' + esc(r.title) + '</span><span class="sb">' + esc(r.kind) + "</span></span>" +
          '<span class="go">' + ic("chevron_right") + "</span></button>";
      }).join("");
    }

    return head("SURGX", "", { titleless: true }) +
      '<div class="sgx-hero">' +
      // The owner-supplied monogram, forced white against the hero gradient (the PNG is
      // alpha-masked, so brightness(0) invert(1) yields clean white). The wordmark below stays LIVE
      // TEXT rather than part of the image, so it scales with Dynamic Type and stays selectable -
      // mark over wordmark is the supplied lockup either way.
      '<img class="sgx-hero-logo" src="/surgx-logo.png" alt="" aria-hidden="true">' +
      '<div class="sgx-hero-mark">SURG<sup>x</sup></div>' +
      '<div class="sgx-hero-tag">Surgical Intelligence</div>' +
      '<div class="sgx-hero-note">Decision support for clinicians. Educational content is reference material, ' +
      "not patient-specific advice. Everything here carries its source.</div></div>" +
      wrap('<div class="sgx-seclabel">Sections</div>' + rows + recentHTML +
        '<div class="sgx-disclaim">Calculators, drug data, the antibiogram and MaiK are the app\'s own; SURGX links ' +
        "into them rather than keeping copies. Surgical protocol logic is shared with the Surgery workspace, so " +
        "there is exactly one version of it.</div>");
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     02 PROTOCOLS
     ═══════════════════════════════════════════════════════════════════════ */

  var CAT_TITLES = {
    trauma: "Trauma", resuscitation: "Shock and resuscitation", abdomen: "Acute abdomen",
    infection: "Surgical infection", perioperative: "Peri-operative", surgical_emergency: "Surgical emergency"
  };

  function screenProtocols() {
    if (state.protoIndex === null) {
      var cc = C();
      if (!cc) return head("Protocols") + errorState("The protocol engine is not loaded.");
      cc.protocolIndex().then(function (list) {
        state.protoIndex = list || [];
        if (routeHead() === "protocols") render();
      });
      return head("Protocols", "02") + loading();
    }
    if (!state.protoIndex.length) {
      return head("Protocols", "02") +
        emptyState("emergency", "No protocols available", "Content is awaiting clinical review, or the surgical engine did not load.");
    }
    var groups = {}, order = [];
    state.protoIndex.forEach(function (p) {
      var c = p.category || "surgical_emergency";
      if (!groups[c]) { groups[c] = []; order.push(c); }
      groups[c].push(p);
    });
    var html = order.map(function (c) {
      return '<div class="sgx-seclabel">' + esc(CAT_TITLES[c] || c) + "</div>" +
        groups[c].map(function (p) {
          return '<button class="sgx-row" data-sgx="go" data-r="protocol/' + attr(p.id) + '">' +
            '<span class="tx"><span class="tt">' + esc(p.title) + "</span>" +
            (p.subtitle ? '<span class="sb">' + esc(p.subtitle) + "</span>" : "") + "</span>" +
            '<span class="go">' + ic("chevron_right") + "</span></button>";
        }).join("");
    }).join("");
    return head("Protocols", "02") + wrap(
      '<div class="sgx-banner info">' + ic("bolt") +
      " Red flags and immediate actions are always at the top. Interactive protocols recalculate as you tick findings.</div>" +
      html);
  }

  function screenProtocol() {
    var id = routeArg(), cc = C(), mm = M();
    if (!cc || !mm) return head("Protocol") + errorState("SURGX did not finish loading.");
    if (!state.proto || state.proto.id !== id) {
      if (state.proto && state.proto.__loadingFor === id) return head("Protocol", "02") + loading();
      state.proto = { id: null, __loadingFor: id };
      state.protoSel = null;
      cc.loadProtocol(id, null).then(function (p) {
        if (!p) { state.proto = { id: id, __failed: true }; render(); return; }
        state.proto = p;
        try { ST() && ST().touch("protocol", id, p.title); } catch (e) {}
        render();
      });
      return head("Protocol", "02") + loading();
    }
    if (state.proto.__failed) {
      return head("Protocol", "02") + emptyState("block", "Not available",
        "This protocol is either awaiting clinical review or its source engine is not loaded on this build.");
    }
    return renderProtocol(state.proto);
  }

  // The engine's assess() takes anything with .has(id) - a real Set in ws-surgery.js's own caller,
  // this adapter here. Keeping the shape rather than the type means SURGX never has to copy the
  // workspace's selection handling.
  function selSet() {
    var picked = state.protoSel || {};
    return { has: function (k) { return !!picked[k]; } };
  }

  function renderProtocol(p) {
    var bands = p.bands || [];
    var body = "";

    if (p.headline) {
      body += '<div class="sgx-headline' + (p.emergency ? " emerg" : "") + '">' +
        (p.emergency ? ic("warning") + " " : "") + esc(p.headline) + "</div>";
    }
    body += metaStrip(p, p.interactive
      ? '<span class="sgx-pill live">' + ic("touch_app") + " Live: tick your findings</span>"
      : "");

    bands.forEach(function (b) {
      var crit = b.band === "red_flags" || b.band === "do_now";
      var filled = b.items.length > 0;
      // The interactive explanation lives where it applies rather than as a banner at the top.
      var hint = (p.interactive && b.band === "assess")
        ? ". Ticking a finding re-runs the app's surgical decision engine, the same one the Surgery workspace uses."
        : "";
      body += '<div class="sgx-band' + (filled ? " filled" : "") + (crit && filled ? " crit" : "") + '">' +
        '<span class="dot"></span>' +
        '<div class="bt">' + esc(b.title) + "</div>" +
        '<div class="bb">' + esc(b.blurb + hint) + "</div>" +
        '<div class="body">' + bandBody(p, b) + "</div></div>";
    });

    if (p.notes && p.notes.length) {
      body += '<div class="sgx-card"><h4>Clinical notes</h4>' +
        p.notes.map(function (n) { return '<div class="sgx-item"><span class="txt">' + esc(n) + "</span></div>"; }).join("") +
        "</div>";
    }
    if (p.interactive && p.ladder != null && M()) {
      body += '<div class="sgx-card"><h4>Antimicrobial and management ladder</h4><div class="sgx-ladder">' +
        M().LADDER.map(function (r, i) {
          return '<div class="r' + (i === p.ladder ? " on" : "") + '"><span class="d"></span>' + esc(r) + "</div>";
        }).join("") + "</div></div>";
    }

    body += calcChips(p.calcs);
    body += sourcesCard(p.sources);
    body += '<div class="sgx-btnrow">' +
      '<button class="sgx-btn" data-sgx="go" data-r="evidence">' + ic("menu_book") + " Evidence</button>" +
      '<button class="sgx-btn" data-sgx="ask" data-q="' + attr(p.title) + '">' + ic("auto_awesome") + " Ask MaiK</button>" +
      "</div>";
    body += '<div class="sgx-disclaim">' + esc(p.disclaimer) + "</div>";

    return head(p.title, "02 · " + (CAT_TITLES[p.category] || "Protocol")) + wrap(body);
  }

  function bandBody(p, b) {
    if (!b.items.length) {
      var msg = b.band === "investigate"
        ? "No investigation set is carried for this protocol. The engine models the decision, not the work-up; an authored, separately reviewed set has not been added yet."
        : "Nothing recorded for this band.";
      return '<div class="sgx-empty">' + esc(msg) + "</div>";
    }
    return b.items.map(function (it) {
      // A selectable item is a live control: ticking it re-runs the engine.
      if (it.selectable) {
        var on = state.protoSel && state.protoSel[it.id];
        return '<button class="sgx-chip' + (b.band === "red_flags" ? " danger" : "") + (on ? " on" : "") +
          '" data-sgx="toggle" data-id="' + attr(it.id) + '" style="margin:0 6px 6px 0">' + esc(it.text) + "</button>";
      }
      var h = '<div class="sgx-item' + (it.timeCritical ? " tc" : "") + '">';
      if (it.timeCritical) h += "<span>" + ic("bolt") + "</span>";
      h += '<span class="txt">' + esc(it.text);
      if (it.abx) h += abxBlock(it.abx);
      if (it.calcs && it.calcs.length) {
        var chips = it.calcs.map(function (cid) {
          var c = null;
          try { c = (window.MEDCALC && MEDCALC.get) ? MEDCALC.get(cid) : null; } catch (e) {}
          return c ? '<button class="sgx-chip calc" data-sgx="calc" data-id="' + attr(cid) + '">' + esc(c.title) + "</button>" : "";
        }).join("");
        if (chips) h += '<div class="sgx-chips" style="margin-top:8px">' + chips + "</div>";
      }
      if (it.evidence) h += citeLine(it.evidence);
      h += "</span></div>";
      return h;
    }).join("");
  }

  /* The empiric regimens are the engine's own, rendered without alteration. Dose selection remains
   * a local antibiogram decision; SURGX shows what ws-surgery.js already carries and says so. */
  function abxBlock(ab) {
    function line(x) {
      return "<li><b>" + esc(x.drug || "") + "</b>" + (x.dose ? " " + esc(x.dose) : "") +
        (x.route ? " " + esc(x.route) : "") + (x.note ? ' <span class="nt">(' + esc(x.note) + ")</span>" : "") + "</li>";
    }
    var h = '<div class="sgx-abx">';
    if (ab.firstLine && ab.firstLine.length) h += '<div class="k">First line</div><ul>' + ab.firstLine.map(line).join("") + "</ul>";
    if (ab.alt && ab.alt.length) h += '<div class="k">Alternatives</div><ul>' + ab.alt.map(line).join("") + "</ul>";
    h += '<div class="ref">' + (ab.ref ? esc(ab.ref) + " · " : "") +
      esc(ab.note || "Empiric. Adjust to local antibiogram, cultures, renal function and allergy.") + "</div>";
    h += '<div class="sgx-chips" style="margin-top:8px">' +
      '<button class="sgx-chip" data-sgx="abg">' + ic("biotech") + " Local antibiogram</button>" +
      '<button class="sgx-chip" data-sgx="drugs">' + ic("medication") + " Drug index</button></div>";
    return h + "</div>";
  }

  function sourcesCard(sources) {
    if (!sources || !sources.length) return "";
    var ev = EV();
    return '<div class="sgx-card"><h4>Sources</h4>' + sources.map(function (s) {
      var txt = ev ? ev.citation(s) : (s.org + " · " + s.title);
      var url = s.url && /^https?:\/\//i.test(s.url) ? s.url : "";
      return '<div class="sgx-item"><span class="txt">' +
        (url ? '<a href="' + attr(url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--sgx-steel)">' + esc(txt) + "</a>" : esc(txt)) +
        "</span></div>";
    }).join("") + "</div>";
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     03 PROCEDURES
     ═══════════════════════════════════════════════════════════════════════ */

  function screenProcedures() {
    var cc = C();
    if (!cc) return head("Procedures", "03") + errorState("SURGX did not finish loading.");
    if (!state.procList) {
      cc.loadCatalog().then(function (cat) {
        var mm = M(), opts = cc.gateOpts();
        state.procList = (cat.procedures || []).filter(function (p) {
          return mm.isRenderable({ review: { status: p.review } }, opts);
        });
        if (routeHead() === "procedures") render();
      });
      return head("Procedures", "03") + loading();
    }
    if (!state.procList.length) {
      return head("Procedures", "03") +
        emptyState("surgical", "No procedures available", "Content is awaiting clinical review.");
    }
    var rows = state.procList.map(function (p) {
      return '<button class="sgx-row" data-sgx="go" data-r="procedure/' + attr(p.id) + '">' +
        '<span class="tx"><span class="tt">' + esc(p.title) + "</span>" +
        '<span class="sb">' + esc(p.subtitle || p.system || "") + (p.estMinutes ? " · about " + p.estMinutes + " min" : "") + "</span></span>" +
        '<span class="go">' + ic("chevron_right") + "</span></button>";
    }).join("");
    return head("Procedures", "03") + wrap(
      '<div class="sgx-banner info">' + ic("school") +
      " Educational reference. These pages describe operations; they do not make decisions about a particular patient.</div>" +
      rows);
  }

  function screenProcedure() {
    var id = routeArg(), cc = C();
    if (!cc) return head("Procedure", "03") + errorState("SURGX did not finish loading.");
    if (!state.proc || state.proc.id !== id) {
      if (state.proc && state.proc.__loadingFor === id) return head("Procedure", "03") + loading();
      state.proc = { id: null, __loadingFor: id };
      state.procTab = "indications";
      cc.loadProcedure(id).then(function (built) {
        if (!built) { state.proc = { id: id, __failed: true }; render(); return; }
        var compiled = cc.compiledProcedure(built);
        if (!compiled) { state.proc = { id: id, __failed: true }; render(); return; }
        compiled.__built = built;
        compiled.__avail = cc.availability(built);
        state.proc = compiled;
        try { ST() && ST().touch("procedure", id, compiled.title); } catch (e) {}
        render();
      });
      return head("Procedure", "03") + loading();
    }
    if (state.proc.__failed) {
      return head("Procedure", "03") + emptyState("block", "Not available",
        "This procedure is awaiting clinical review.");
    }
    return renderProcedure(state.proc);
  }

  function renderProcedure(p) {
    var tabs = p.chapters.filter(function (c) {
      return c.lines.length || c.steps.length || c.media.length;
    });
    if (!tabs.length) {
      return head(p.title, "03") + emptyState("hourglass_empty", "Nothing cleared yet",
        "Every chapter of this procedure is awaiting clinical review.");
    }
    var active = null;
    tabs.forEach(function (c) { if (c.id === state.procTab) active = c; });
    if (!active) { active = tabs[0]; state.procTab = active.id; }

    var tabBar = '<div class="sgx-tabs">' + tabs.map(function (c) {
      return '<button class="sgx-tab' + (c.id === active.id ? " on" : "") + '" data-sgx="tab" data-id="' + attr(c.id) + '">' +
        esc(c.title) + "</button>";
    }).join("") + "</div>";

    var body = "";
    body += metaStrip(p, '<span class="sgx-pill">' + ic("school") + " Educational reference</span>");
    if (p.pendingSteps) {
      // Hidden content IS promoted to a banner: a procedure that is quietly short is a lie about
      // the operation.
      body += '<div class="sgx-banner warn">' + ic("hourglass_empty") + " " + p.pendingSteps +
        " step" + (p.pendingSteps === 1 ? " is" : "s are") + " awaiting clinical sign-off and are not shown.</div>";
    }

    if (active.id === "steps") {
      body += '<div class="sgx-card">' + (active.steps.length
        ? active.steps.map(renderStep).join("")
        : '<div class="sgx-empty">No steps are cleared for display yet.</div>') + "</div>";
    } else {
      body += '<div class="sgx-card"><h4>' + esc(active.title) + "</h4>" +
        (active.lines.length
          ? active.lines.map(function (l) {
              return '<div class="sgx-item"><span class="txt">' + esc(l.text) +
                (l.fromStep ? '<span class="cite">from: ' + esc(l.fromStep) + "</span>" : "") + "</span></div>";
            }).join("")
          : '<div class="sgx-empty">Nothing recorded for this chapter yet.</div>') + "</div>";
    }
    active.media.forEach(function (mid) {
      body += mediaBlock(p.__built ? p.__built.media : null, mid);
    });

    body += calcChips(p.calcs);
    body += sourcesCard(p.sources);
    body += '<div class="sgx-disclaim">' + esc(p.disclaimer) + "</div>";

    return head(p.title, "03 · " + esc(p.system || "Procedure")) + tabBar + wrap(body);
  }

  function renderStep(s) {
    var h = '<div class="sgx-step' + (s.critical ? " crit" : "") + '"><div class="n">' + s.n + "</div><div class=\"b\">" +
      '<div class="t">' + esc(s.title) + (s.critical ? " " + ic("priority_high") : "") + "</div>" +
      '<div class="w">' + esc(s.why) + "</div>";
    if (s.how.length) h += "<ul>" + s.how.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
    if (s.emphasis) h += '<div class="w" style="margin-top:7px;font-weight:600">' + esc(s.emphasis) + "</div>";
    if (s.structuresAtRisk.length) h += '<div class="risk">' + ic("warning") + " At risk: " + esc(s.structuresAtRisk.join(" · ")) + "</div>";
    if (s.pitfalls.length) h += '<div class="pit">' + ic("error") + " " + esc(s.pitfalls.join(" · ")) + "</div>";
    return h + "</div></div>";
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     04 EVIDENCE
     ═══════════════════════════════════════════════════════════════════════ */

  function screenEvidence() {
    var ev = EV();
    if (!ev) return head("Evidence", "04") + errorState("SURGX did not finish loading.");
    if (state.evList === null) {
      ev.loadIndex().then(function (list) {
        state.evList = list || [];
        if (routeHead() === "evidence") render();
      });
      return head("Evidence", "04") + loading();
    }
    var q = state.evQuery.trim().toLowerCase();
    var list = state.evList;
    if (q.length >= 2) {
      list = list.filter(function (r) {
        var hay = [r.title, r.originalSummary, (r.source && r.source.org) || "", (r.topics || []).join(" ")].join(" ").toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    var search = '<input class="sgx-search" id="sgxEvQ" type="search" placeholder="Search evidence" value="' + attr(state.evQuery) + '">';
    if (!state.evList.length) {
      return head("Evidence", "04") + wrap(search +
        emptyState("menu_book", "No evidence records", "The evidence index did not load."));
    }
    var rows = list.length ? list.map(function (r) {
      return '<button class="sgx-row" data-sgx="go" data-r="evidence/' + attr(r.id) + '">' +
        '<span class="tx"><span class="tt">' + esc(r.title) + "</span>" +
        '<span class="sb">' + esc((r.source && r.source.org) || "") + (r.source && r.source.year ? " · " + r.source.year : "") + "</span></span>" +
        '<span class="go">' + ic("chevron_right") + "</span></button>";
    }).join("") : '<div class="sgx-empty">Nothing matches that. Try a broader term, or use Ask MaiK for a live literature review.</div>';

    return head("Evidence", "04") + wrap(search +
      '<div class="sgx-banner info">' + ic("edit_note") +
      " Every entry is our own explanation of what a source says and why it matters, with a pointer to the " +
      "authoritative document. We do not reproduce guideline text, tables or figures.</div>" + rows);
  }

  function screenEvidenceItem() {
    var id = routeArg(), ev = EV();
    if (!ev || state.evList === null) { go("evidence"); return ""; }
    var rec = null;
    state.evList.forEach(function (r) { if (r.id === id) rec = r; });
    if (!rec) return head("Evidence", "04") + emptyState("block", "Not found", "That evidence record is not in this build.");

    var src = rec.source || {};
    var url = src.url && /^https?:\/\//i.test(src.url) ? src.url : "";
    var body = '<div class="sgx-ev"><div class="t">' + esc(rec.title) + "</div>" +
      '<div class="s">' + esc(rec.originalSummary) + "</div>" +
      '<div class="src">' + ic("menu_book") + " " +
      (url ? '<a href="' + attr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(ev.citation(src)) + "</a>" : esc(ev.citation(src))) +
      "</div>" +
      '<div class="own">StewardMD summary · not reproduced guideline text</div></div>';

    var links = "";
    (rec.protocolRefs || []).forEach(function (pid) {
      links += '<button class="sgx-chip" data-sgx="go" data-r="protocol/' + attr(pid) + '">' + ic("emergency") + " " + esc(pid) + "</button>";
    });
    (rec.procedureRefs || []).forEach(function (pid) {
      links += '<button class="sgx-chip" data-sgx="go" data-r="procedure/' + attr(pid) + '">' + ic("content_cut") + " " + esc(pid) + "</button>";
    });
    if (links) body += '<div class="sgx-card"><h4>Used by</h4><div class="sgx-chips">' + links + "</div></div>";

    body += '<div class="sgx-card"><h4>Go further</h4>' +
      '<div class="sgx-disclaim" style="border:none;margin:0;padding:0 0 10px">A live literature review uses one of your two ' +
      "daily MaiK Evidence Review credits and returns cited sources. It is never run automatically.</div>" +
      '<button class="sgx-btn wide" data-sgx="lit" data-q="' + attr(rec.title) + '">' + ic("search") +
      " Review current literature</button><div id=\"sgxLit\"></div></div>";

    body += '<div class="sgx-disclaim">Evidence changes. Check the date on the source before relying on it, and prefer ' +
      "your local policy where one exists.</div>";

    return head(rec.title, "04 · Evidence") + wrap(body);
  }

  /* The evidence review comes back as MARKDOWN from the model ("*   **A - Airway:** Ensure ...").
   * It used to be dropped into .sgx-pre - a monospace, pre-wrap block - so every asterisk was shown
   * literally and a clinical summary read like a code dump. Render the small subset the model
   * actually emits: headings, bullets and bold.
   * SAFETY: each fragment is esc()'d FIRST and the markdown pass only ever runs on already-inert
   * text, so no HTML in a model response can survive into the DOM. */
  function mdLite(src) {
    var lines = String(src == null ? "" : src).replace(/\r/g, "").split("\n");
    var out = [], inList = false, i, ln, h, b;
    function closeList() { if (inList) { out.push("</ul>"); inList = false; } }
    function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
    for (i = 0; i < lines.length; i++) {
      ln = lines[i].trim();
      if (!ln) { closeList(); continue; }
      h = ln.match(/^#{1,6}\s*(.+)$/);
      if (h) { closeList(); out.push('<h5 class="sgx-md-h">' + inline(h[1].replace(/:$/, "")) + "</h5>"); continue; }
      // A bullet marker must be followed by whitespace, so a line that merely OPENS with bold
      // ("**A - Airway:** ...") is a paragraph, not a list item.
      b = ln.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (b) { if (!inList) { out.push('<ul class="sgx-md-ul">'); inList = true; } out.push("<li>" + inline(b[1]) + "</li>"); continue; }
      closeList(); out.push("<p>" + inline(ln) + "</p>");
    }
    closeList();
    return out.join("");
  }

  function runLitReview(q, hostEl) {
    var ev = EV(); if (!ev || !hostEl) return;
    hostEl.innerHTML = '<div class="sgx-skel"><i></i></div>';
    ev.reviewLiterature("Surgical evidence summary: " + q).then(function (r) {
      if (!r.ok) {
        var msg = r.reason === "quota"
          ? (r.message || "You have used today's evidence reviews. This resets at midnight.")
          : "Literature review is unavailable right now. The sources above still apply.";
        hostEl.innerHTML = '<div class="sgx-banner warn">' + ic("info") + " " + esc(msg) + "</div>";
        return;
      }
      var srcs = (r.sources || []).map(function (s) {
        var u = s && s.url && /^https?:\/\//i.test(s.url) ? s.url : "";
        var lbl = esc((s && (s.title || s.site || s.url)) || "source");
        return "<li>" + (u ? '<a href="' + attr(u) + '" target="_blank" rel="noopener noreferrer" style="color:var(--sgx-steel)">' + lbl + "</a>" : lbl) + "</li>";
      }).join("");
      hostEl.innerHTML = '<div class="sgx-banner info">' + ic("auto_awesome") +
        " MaiK Evidence Review · trusted literature, verify independently" + (r.cached ? " · cached" : "") + "</div>" +
        '<div class="sgx-md">' + mdLite(r.text) + "</div>" +
        (srcs ? '<div class="sgx-card" style="margin-top:10px"><h4>Sources</h4><ol style="margin:0;padding-left:18px;font:500 12.5px/1.6 var(--sgx-sans)">' + srcs + "</ol></div>" : "");
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     05 CASES
     ═══════════════════════════════════════════════════════════════════════ */

  function caseLevel() {
    if (state.caseLevel) return state.caseLevel;
    state.caseLevel = ENT() ? ENT().defaultCaseLevel() : "resident";
    return state.caseLevel;
  }

  function screenCases() {
    var cc = C();
    if (!cc) return head("Cases", "05") + errorState("SURGX did not finish loading.");
    if (state.caseList === null) {
      cc.caseIndex().then(function (list) {
        state.caseList = list || [];
        if (routeHead() === "cases") render();
      });
      return head("Cases", "05") + loading();
    }
    if (!state.caseList.length) {
      return head("Cases", "05") + emptyState("psychology", "No cases available", "Content is awaiting clinical review.");
    }
    var lv = caseLevel();
    if (!M()) return head("Cases", "05") + errorState("SURGX did not finish loading.");
    var levelChips = M().CASE_LEVELS.map(function (l) {
      return '<button class="sgx-chip' + (l === lv ? " on" : "") + '" data-sgx="level" data-id="' + l + '">' +
        esc(l.charAt(0).toUpperCase() + l.slice(1)) + "</button>";
    }).join("");

    var st = ST();
    var rows = state.caseList.filter(function (c) {
      return !c.levels || c.levels.indexOf(lv) >= 0;
    }).map(function (c) {
      var prev = st ? st.caseResult(c.id) : null;
      return '<button class="sgx-row" data-sgx="go" data-r="case/' + attr(c.id) + '">' +
        '<span class="tx"><span class="tt">' + esc(c.title) + "</span>" +
        '<span class="sb">' + esc(c.subtitle || "") + (prev ? " · attempted" : "") + "</span></span>" +
        '<span class="go">' + ic("chevron_right") + "</span></button>";
    }).join("");

    return head("Cases", "05") + wrap(
      '<div class="sgx-banner sim">' + ic("science") + " Simulation. Not real patients.</div>" +
      '<div class="sgx-card"><h4>Your level</h4><div class="sgx-chips">' + levelChips + "</div>" +
      '<div class="sgx-disclaim" style="border:none;margin:6px 0 0;padding:0">The level changes how much is revealed ' +
      "before you commit, and which decision points appear.</div></div>" +
      (rows || '<div class="sgx-empty">No cases are written for this level yet.</div>'));
  }

  function screenCase() {
    var id = routeArg(), cc = C();
    if (!cc) return head("Case", "05") + errorState("SURGX did not finish loading.");
    if (!state.kase || state.kase.id !== id || state.kase.level !== caseLevel()) {
      if (state.kase && state.kase.__loadingFor === id) return head("Case", "05") + loading();
      state.kase = { id: null, __loadingFor: id };
      state.caseAnswers = {};
      state.caseIdx = 0;
      cc.loadCase(id, caseLevel()).then(function (k) {
        if (!k) { state.kase = { id: id, __failed: true }; render(); return; }
        state.kase = k;
        try { ST() && ST().touch("case", id, k.title); } catch (e) {}
        render();
      });
      return head("Case", "05") + loading();
    }
    if (state.kase.__failed) {
      return head("Case", "05") + emptyState("block", "Not available", "This case is awaiting clinical review.");
    }
    return renderCase(state.kase);
  }

  /* One mentor turn. The prompt carries the case stem, what the trainee has answered so far and their
   * question; mode "surgx-mentor" selects the persona (SURG_SYS on device; the surgx_case quota bucket
   * on the cloud). Mirrors clinix-tutor.js: a grounded package when StewardRAG is present, a plain
   * explain() otherwise, and { error } rendered as text, never swallowed. */
  function askMentor() {
    var k = state.kase; if (!k) return;
    var ta = document.getElementById("sgxMentorQ");
    var q = String((ta && ta.value) || "").trim().slice(0, 600);
    state.mentor = { q: q, a: (state.mentor || {}).a, busy: false, err: "" };
    if (!q) { toast("Type your question first."); return; }
    var AI = window.SMD_AI;
    if (!(AI && (AI.explainGrounded || AI.explain))) { state.mentor.err = "MaiK is not available on this build."; render(); return; }
    var answered = (k.decisionPoints || []).filter(function (d) { return state.caseAnswers && state.caseAnswers[d.id]; }).map(function (d) {
      var o = (d.options || []).filter(function (x) { return x.id === state.caseAnswers[d.id]; })[0];
      return d.phase + ": asked '" + d.prompt + "', trainee chose '" + (o ? o.text : state.caseAnswers[d.id]) + "'" + (o && o.correct === false ? " (not the preferred option)" : "");
    });
    var prompt = "SURGICAL TEACHING CASE (simulated, not a real patient).\nLevel: " + String(k.level || "") + "\nStem: " + String(k.stem || "") +
      (answered.length ? "\nDecisions so far:\n- " + answered.join("\n- ") : "") + "\n\nTrainee's question: " + q;
    state.mentor.busy = true; render();
    var me = state.mentor;
    var call;
    try {
      if (window.StewardRAG && window.StewardRAG.buildPackage && AI.explainGrounded) {
        call = Promise.resolve(window.StewardRAG.buildPackage({ infectious: [], nonInfectious: [] }, { question: prompt })).then(function (pkg) {
          if (!pkg) return { error: "no-package" };
          pkg.question = prompt;
          return AI.explainGrounded(pkg, { depth: "concise", mode: "surgx-mentor" });
        });
      } else {
        call = AI.explain(prompt, q);
      }
    } catch (e) { call = Promise.resolve({ error: "server" }); }
    call.then(function (r) {
      if (state.mentor !== me) return;
      me.busy = false;
      if (!r || r.error) { me.err = (r && r.message) || (r && r.error === "quota" ? "MaiK limit reached for today." : "The senior surgeon is unavailable right now."); }
      else { me.a = String(r.text || "").trim(); me.err = ""; }
      render();
    }, function () { if (state.mentor === me) { me.busy = false; me.err = "The senior surgeon is unavailable right now."; render(); } });
  }

  function renderCase(k) {
    var dps = k.decisionPoints || [];
    if (!dps.length) {
      return head(k.title, "05") + emptyState("psychology", "Nothing to run", "This case has no decision points for your level.");
    }
    var answered = 0;
    dps.forEach(function (d) { if (state.caseAnswers[d.id]) answered++; });
    var done = answered === dps.length;

    var body = '<div class="sgx-banner sim">' + ic("science") + " Simulated encounter. Not a real patient.</div>";
    body += metaStrip(k, '<span class="sgx-pill">' + ic("person") + " " + esc(k.level) + " level</span>");
    body += '<div class="sgx-stem">' + esc(k.stem);
    if (k.vitals) {
      var vs = "";
      for (var key in k.vitals) if (Object.prototype.hasOwnProperty.call(k.vitals, key)) {
        vs += '<span class="sgx-vital">' + esc(key) + " " + esc(k.vitals[key]) + "</span>";
      }
      if (vs) body += '<div class="sgx-vitals">' + vs + "</div>";
    }
    body += "</div>";

    body += '<div class="sgx-progress">' + dps.map(function (d) {
      return "<i" + (state.caseAnswers[d.id] ? ' class="on"' : "") + "></i>";
    }).join("") + "</div>";

    // Reveal decision points progressively: the next unanswered one is the live question, and
    // everything before it stays visible with its teaching. A senior surgeon asks one question at
    // a time and does not let you read ahead.
    var stop = false;
    dps.forEach(function (d, i) {
      if (stop) return;
      var picked = state.caseAnswers[d.id];
      body += renderDecision(d, picked, k);
      if (!picked) stop = true;
    });

    if (done) body += renderCaseResult(k, dps);

    // Senior Surgeon Mode (2026-09-11): the "surgx-mentor" persona existed as a quota bucket and,
    // since the hard Local policy, as an on-device system prompt, but had no screen. One question at
    // a time, about THIS case, through the same SMD_AI transport as CliniX's tutor, so the answer
    // engine chooser (Cloud / Local / KB-only) governs it like everything else.
    var mt = state.mentor || {};
    body += '<div class="sgx-card"><h4>' + ic("psychology") + " Ask the senior surgeon</h4>" +
      '<div class="n">Challenge your plan on this case. Teaching and decision support only: no doses, no advice about a real patient.</div>' +
      '<textarea id="sgxMentorQ" rows="2" placeholder="e.g. Would you convert to open here, and what would make you decide?">' + esc(mt.q || "") + "</textarea>" +
      '<div class="sgx-btnrow"><button class="sgx-btn" data-sgx="mentor"' + (mt.busy ? " disabled" : "") + ">" + ic("auto_awesome") + (mt.busy ? " Thinking…" : " Ask") + "</button></div>" +
      (mt.a ? '<div class="sgx-why"><div class="h">Senior surgeon</div>' + esc(mt.a).replace(/\n/g, "<br>") + "</div>" : "") +
      (mt.err ? '<div class="n">' + esc(mt.err) + "</div>" : "") +
      "</div>";

    body += '<div class="sgx-btnrow">' +
      '<button class="sgx-btn" data-sgx="caseReset">' + ic("restart_alt") + " Start again</button>" +
      (k.protocolRef ? '<button class="sgx-btn" data-sgx="go" data-r="protocol/' + attr(k.protocolRef) + '">' + ic("emergency") + " Protocol</button>" : "") +
      (k.procedureRef ? '<button class="sgx-btn" data-sgx="go" data-r="procedure/' + attr(k.procedureRef) + '">' + ic("content_cut") + " Procedure</button>" : "") +
      "</div>";
    body += '<div class="sgx-disclaim">' + esc(k.disclaimer) + "</div>";

    return head(k.title, "05 · Case") + wrap(body);
  }

  function renderDecision(d, picked, k) {
    var h = '<div class="sgx-card"><h4>' + esc(d.phase) + " · question " + d.n + "</h4>" +
      '<div style="font:650 14.5px/1.5 var(--sgx-sans);margin-bottom:10px">' + esc(d.prompt) + "</div>";
    if (!picked && d.hint) {
      h += '<div class="sgx-banner info" style="margin-bottom:10px">' + ic("lightbulb") + " " + esc(d.hint) + "</div>";
    }
    d.options.forEach(function (o) {
      var cls = "";
      if (picked) {
        if (o.id === picked) cls = o.correct ? " right" : " wrong";
        else if (o.correct) cls = " right";
      }
      h += '<button class="sgx-opt' + cls + '"' + (picked ? " disabled" : "") +
        ' data-sgx="answer" data-dp="' + attr(d.id) + '" data-opt="' + attr(o.id) + '">' + esc(o.text) +
        (picked && o.id === picked && o.feedback ? '<div style="margin-top:7px;font-weight:600">' + esc(o.feedback) + "</div>" : "") +
        "</button>";
    });
    if (picked) {
      h += '<div class="sgx-why"><div class="h">Why</div>' + esc(d.why);
      if (d.missedRedFlags && d.missedRedFlags.length) {
        h += '<div class="miss">' + ic("flag") + " Commonly missed here: " + esc(d.missedRedFlags.join(" · ")) + "</div>";
      }
      if (d.alternatives && d.alternatives.length) {
        h += '<div class="alt">' + ic("alt_route") + " Reasonable alternatives: " + esc(d.alternatives.join(" ")) + "</div>";
      }
      h += "</div>";
      // Only offer the jump when there is somewhere real to jump to; "procedure/" with no id would
      // route to a dead screen.
      if (d.stepRef && k.procedureRef) {
        h += '<div class="sgx-chips" style="margin-top:10px"><button class="sgx-chip" data-sgx="go" data-r="procedure/' +
          attr(k.procedureRef) + '">' + ic("content_cut") + " See the step</button></div>";
      }
    }
    return h + "</div>";
  }

  /* The result is deliberately NOT a single percentage. A trainee who reaches the right answer
   * having missed every red flag got the answer right and the encounter wrong, and a blended mark
   * hides exactly that. (The CliniX rule, applied to surgery.) */
  function renderCaseResult(k, dps) {
    var mm = M();
    var res = mm.scoreCase(k, state.caseAnswers);
    try { ST() && ST().saveCaseResult(k.id, res); } catch (e) {}
    var verdictText = {
      "good": "Sound throughout. You caught the red flags and the sequencing was right.",
      "sound-with-gaps": "Broadly sound, with gaps. Read the explanations on the questions you got wrong; none of them were safety failures.",
      "unsafe-reasoning": "Right in places, but at least one answer would have missed a red flag. That is the part to go back over.",
      "incomplete": "Not finished."
    }[res.verdict] || "";
    var h = '<div class="sgx-card"><h4>How that went</h4>' +
      '<div class="sgx-item"><span class="txt"><b>Decisions correct:</b> ' + res.correct + " of " + res.total + "</span></div>" +
      '<div class="sgx-item' + (res.safetyMisses ? " tc" : "") + '"><span class="txt"><b>Safety-critical misses:</b> ' +
      res.safetyMisses + "</span></div>";
    if (res.redFlagsMissed.length) {
      h += '<div class="sgx-item tc"><span class="txt">' + ic("flag") + " " + esc(res.redFlagsMissed.join(" · ")) + "</span></div>";
    }
    h += '<div style="margin-top:10px;font:600 13px/1.6 var(--sgx-sans);color:var(--sgx-muted)">' + esc(verdictText) + "</div>";
    h += '<div class="sgx-disclaim" style="border:none;margin:8px 0 0;padding:0">Two numbers, not one. A correct final ' +
      "answer reached past a missed red flag is not the same encounter as a correct one.</div>";
    return h + "</div>";
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     01 NOTES
     ═══════════════════════════════════════════════════════════════════════ */

  function screenNotes() {
    var access = ENT() ? ENT().notesAccess() : "off";
    if (access === "off") { back(); return ""; }
    if (access === "verify_required") {
      return head("Notes", "01") + wrap(
        emptyState("verified_user", "Verify to use Notes",
          "Surgical notes are a clinical-action feature. StewardMD unlocks them for clinicians whose medical " +
          "registration is verified, the same gate the prescription generator uses. Protocols, Procedures, " +
          "Evidence and Cases stay open to you.",
          '<button class="sgx-btn pri" data-sgx="verify">Verify my registration</button>'));
    }

    var st = ST();
    if (!st) return head("Notes", "01") + errorState("SURGX did not finish loading.");
    if (!st.cryptoAvailable()) {
      return head("Notes", "01") + wrap(emptyState("lock", "Secure storage unavailable",
        "Notes are encrypted on this device before they are saved, and this browser does not provide the " +
        "cryptography needed. Rather than store clinical notes unencrypted, SURGX refuses to save them here. " +
        "Use the native app."));
    }

    var list = st.listNotes();
    var types = NS().typeList();
    var newRows = types.map(function (t) {
      return '<button class="sgx-row" data-sgx="newnote" data-id="' + attr(t.id) + '">' +
        '<span class="tx"><span class="tt">' + esc(t.title) + "</span></span>" +
        '<span class="go">' + ic("add") + "</span></button>";
    }).join("");

    var listHTML = list.length ? list.map(function (n) {
      var t = NS().SCHEMAS[n.type];
      return '<button class="sgx-row" data-sgx="go" data-r="note/' + attr(n.id) + '">' +
        '<span class="tx"><span class="tt">' + esc(n.label || (t ? t.title : "Note")) + "</span>" +
        '<span class="sb">' + esc(t ? t.title : n.type) + " · " + (n.finalized ? "finalised" : "draft") + "</span></span>" +
        '<span class="go">' + ic("chevron_right") + "</span></button>";
    }).join("") : '<div class="sgx-empty">No notes on this device yet.</div>';

    /* Backup to the doctor's OWN Drive. Offered here rather than buried in settings because the
     * loss it prevents happens at reinstall time, when the surgeon is already looking at an empty
     * Notes list and it is too late. Both directions are explicit taps - there is still no silent
     * upload path (see surgx-backup.js). */
    var bk = (typeof window !== "undefined" && window.SMD_SURGX_BACKUP) || null;
    var bkAvail = bk ? bk.available() : { ok: false, reason: "Unavailable." };
    var backupHTML = bk ? ('<div class="sgx-seclabel">Backup</div>' +
      '<div class="sgx-card"><div class="sgx-bk-h">Your own Google Drive</div>' +
      '<div class="sgx-bk-s">Notes live only on this device, so reinstalling the app destroys them. ' +
      'A backup encrypts them <b>on this device</b> with a password only you know, then writes them to ' +
      'a folder in <b>your</b> Drive. Google stores ciphertext; nothing but this app, with your ' +
      'password, can open it. Nothing is sent unless you tap.</div>' +
      (bkAvail.ok
        ? '<div class="sgx-bk-row">' +
            '<button class="sgx-btn pri" data-sgx="bkup" ' + (list.length ? "" : "disabled ") + '>Back up ' + list.length + ' note' + (list.length === 1 ? "" : "s") + '</button>' +
            '<button class="sgx-btn" data-sgx="bkrestore">Restore from Drive</button>' +
          "</div>"
        : '<div class="sgx-bk-off">' + esc(bkAvail.reason) + "</div>") +
      '<div class="sgx-bk-msg" id="sgxBkMsg" role="status" aria-live="polite"></div></div>') : "";

    return head("Notes", "01") + wrap(
      notesBanner() +
      '<div class="sgx-seclabel">New note</div>' + newRows +
      '<div class="sgx-seclabel">On this device</div>' + listHTML +
      backupHTML);
  }

  /* The encrypted Drive backup lives in surgx-backup.js (the SMD_SURGX_BACKUP global), built in
   * parallel by another session and kept because its crypto and PHI handling are stricter: its own
   * password with double confirmation, an explicit no-escrow warning, only the KDF parameters and a
   * timestamp outside the ciphertext, and plaintext backups refused on read. A duplicate
   * surgx-sync.js of mine was removed rather than ship two backup systems.
   *
   * That module is NOT in main yet (PR #760). Until it lands this banner states the unconditional
   * truth, and deliberately does not reach for a global nothing defines - test/surgx-deeplinks
   * catches exactly that, and caught this. When surgx-backup.js merges it makes the wording
   * conditional on whether a backup actually exists. */
  /* Three different true statements, and which one is true depends on the device. Written as a
   * ladder rather than one line because the harsh version, shown to a surgeon who HAS set up a
   * backup, just teaches them to ignore the banner - and the reassuring version, shown to one who
   * has not, is a lie that costs notes. FAILS TOWARDS THE HARDER WARNING: anything unproven reads
   * as "permanent". */
  function notesBanner() {
    var B = (typeof window !== "undefined" && window.SMD_SURGX_BACKUP) || null;
    var st = null;
    try { if (B && B.status) st = B.status(); } catch (e) { st = null; }
    if (st && st.hasBackup) {
      return '<div class="sgx-banner info">' + ic("lock") +
        " Encrypted on this device, and backed up to your own Google Drive" +
        (st.lastBackupAtText ? " (" + esc(st.lastBackupAtText) + ")" : "") +
        ". Signing out or reinstalling removes them from this device; your backup password restores " +
        "them.</div>";
    }
    if (B) {
      return '<div class="sgx-banner warn">' + ic("lock") +
        " Encrypted on this device and never uploaded. There is no SURGX note server, by design - so " +
        "signing out or reinstalling the app DELETES these notes permanently. Back them up below.</div>";
    }
    return '<div class="sgx-banner warn">' + ic("lock") +
      " Encrypted on this device and never uploaded. There is no SURGX note server, by design - so " +
      "signing out or reinstalling the app DELETES these notes permanently.</div>";
  }

  /* Create a blank note of a type, optionally from a procedure template. */
  function startNote(typeId) {
    var templates = NS().templateList(typeId);
    if (!templates.length) { createNote(typeId, ""); return; }
    // Template choice is a small decision, so it is a screen rather than a modal: one tap, no
    // dialog stack, and the back button does the obvious thing.
    state.noteType = typeId;
    go("notetemplate");
  }

  function screenNoteTemplate() {
    var typeId = state.noteType;
    var templates = NS().templateList(typeId);
    var base = NS().SCHEMAS[typeId];
    var rows = '<button class="sgx-row" data-sgx="mknote" data-t="' + attr(typeId) + '" data-tpl="">' +
      '<span class="tx"><span class="tt">General ' + esc(base ? base.title.toLowerCase() : "note") + "</span>" +
      '<span class="sb">No procedure-specific fields</span></span>' +
      '<span class="go">' + ic("chevron_right") + "</span></button>" +
      templates.map(function (t) {
        return '<button class="sgx-row" data-sgx="mknote" data-t="' + attr(typeId) + '" data-tpl="' + attr(t.id) + '">' +
          '<span class="tx"><span class="tt">' + esc(t.title) + "</span>" +
          '<span class="sb">Adds procedure-specific fields</span></span>' +
          '<span class="go">' + ic("chevron_right") + "</span></button>";
      }).join("");
    return head("Choose a template", "01 · " + esc(base ? base.title : "")) + wrap(
      '<div class="sgx-banner info">' + ic("description") +
      " A template only ADDS fields to the standard note. It never replaces it, so every note of a type reads the same.</div>" +
      rows);
  }

  /* A linked patient already IS the patient reference. Re-typing the UHID you just selected from
   * the ward list is pure friction, and because patientRef is required on every note type it was
   * blocking Finalise - which blocks the EMR write, which is the whole point of linking them.
   *
   * Only fills an EMPTY field: whatever the surgeon typed always wins. Marked "auto" rather than
   * "clinician" so the provenance trail still distinguishes what a person actually wrote. */
  function applyPatientToFields(link) {
    if (!state.note || !link) return;
    state.note.values = state.note.values || {};
    state.note.provenance = state.note.provenance || {};
    if (!String(state.note.values.patientRef || "").trim()) {
      var ref = String(link.patientId || "").trim();
      var nm = String(link.name || "").trim();
      state.note.values.patientRef = ref && nm ? (nm + " (" + ref + ")") : (ref || nm);
      state.note.provenance.patientRef = "auto";
    }
    if (!String(state.note.values.date || "").trim()) {
      state.note.values.date = todayISO();
      state.note.provenance.date = "auto";
    }
  }

  /* Dictation -> fields, through SMD_AI.extract("surgx-note"). The answer-engine chooser decides
   * local or cloud (or refuses with a named reason). applyExtraction() in surgx-model.js is the
   * ONLY path from a model's output into a note: schema, never-AI-fillable, confirmed-field and
   * numeric guards, in that order. Everything that survives is amber until the surgeon confirms it. */
  function structureNote() {
    var n = state.note, schema = state.noteSchema, mm = M();
    if (!n || !schema || !mm || !mm.applyExtraction) return;
    var ta = document.getElementById("sgxDictation");
    var text = String((ta && ta.value) || "").trim();
    n.dictation = text;
    if (!text) { toast("Type or paste what you did first."); return; }
    var AI = window.SMD_AI;
    if (!(AI && AI.extract)) { toast("MaiK is not available on this build."); return; }
    var allowed = [];
    (schema.sections || []).forEach(function (sec) { (sec.fields || []).forEach(function (f) { if (f && f.k && f.aiFillable !== false) allowed.push({ k: f.k, label: f.label || f.k }); }); });
    n.structureNote = "Structuring your dictation…"; render();
    AI.extract(text, "surgx-note", { allowedFields: allowed, noteType: schema.typeId || schema.title || "operative" }).then(function (r) {
      if (state.note !== n) return;
      if (!r || r.error) {
        n.structureNote = (r && r.message) || (r && r.error === "quota" ? "MaiK limit reached for today." : "Could not structure this dictation.");
        render(); return;
      }
      var res = mm.applyExtraction(schema.sections, n.values, n.provenance, r.fields || {}, text, "ai");
      n.values = res.values; n.provenance = res.provenance;
      n.audit = n.audit || []; n.audit.push({ a: "structure", applied: res.applied.map(function (x) { return x.k; }), rejected: res.rejected.length, engine: r.engine || "cloud" });
      var parts = [res.applied.length + " field" + (res.applied.length === 1 ? "" : "s") + " filled from your dictation, amber until you confirm each"];
      if (res.fabricated.length) parts.push(res.fabricated.length + " dropped for a number you did not say");
      if ((r.dropped || []).length) parts.push(r.dropped.length + " not allowed for AI");
      n.structureNote = parts.join(". ") + ".";
      haptic("light"); render();
    }, function () { if (state.note === n) { n.structureNote = "Could not structure this dictation."; render(); } });
  }

  function createNote(typeId, templateId) {
    var schema = NS().schemaFor(typeId, templateId);
    if (!schema) { toast("Unknown note type"); return; }
    var values = {}, prov = {};
    for (var k in schema.prefill) if (Object.prototype.hasOwnProperty.call(schema.prefill, k)) {
      values[k] = schema.prefill[k];
      prov[k] = "ai";      // prefilled boilerplate is NOT the clinician's words until they confirm it
    }
    /* `date` is required on EVERY note type and is always today. Making a surgeon type it is
     * friction with no safety value - the note carries createdAt regardless - and it is one of the
     * "required fields missing" that blocks Finalise, which in turn blocks the EMR write. */
    if (!values.date) { values.date = todayISO(); prov.date = "auto"; }
    state.noteSchema = schema;
    state.note = {
      id: null, type: typeId, templateId: templateId || "",
      label: "", values: values, provenance: prov,
      finalized: false, finalizedBy: "", finalizedAt: "", audit: []
    };
    // Replace rather than push, so Back from the editor lands on the Notes list, not the picker.
    state.stack[state.stack.length - 1] = "note/new";
    render();
  }

  function screenNote() {
    var id = routeArg();
    if (id === "new") {
      if (!state.note) { replace("notes"); return ""; }
      return renderNoteEditor();
    }
    if (!state.note || state.note.id !== id) {
      if (state.note && state.note.__loadingFor === id) return head("Note", "01") + loading();
      state.note = { id: null, __loadingFor: id };
      ST().loadNote(id).then(function (n) {
        if (!n) { state.note = { id: id, __failed: true }; render(); return; }
        state.noteSchema = NS().schemaFor(n.type, n.templateId);
        state.note = n;
        render();
      });
      return head("Note", "01") + loading();
    }
    if (state.note.__failed) {
      return head("Note", "01") + emptyState("lock", "Could not open this note",
        "It could not be decrypted on this device. That happens if it was written under a different account, " +
        "or if the device key was cleared.");
    }
    if (!state.noteSchema) state.noteSchema = NS().schemaFor(state.note.type, state.note.templateId);
    return renderNoteEditor();
  }

  /* ── who the note is about ────────────────────────────────────────────────
   * Two routes, because there are two kinds of surgeon using this: one attached to a hospital EMR,
   * and one working alone. The hospital list puts GHIS and every Connect tenant side by side, the
   * same way connect-patient.js's admit chooser does - no special case for the doctor to learn.
   * Only a hospital link carries the ids an EMR write needs, so the card states the writability
   * up front rather than letting them discover it at the end. */
  function patientCard(n) {
    var P = PT(); if (!P) return "";
    var link = n.patient || null;
    var w = P.writability(link);
    var body = '<div class="sgx-row" style="cursor:default">' +
      '<span class="tx"><span class="tt">' + esc(P.describe(link)) + "</span>" +
      '<span class="sb">' + esc(w.canWrite
        ? (w.willCreate ? w.note : "Can be written to the hospital record.")
        : w.reason) + "</span></span></div>";

    if (state.ptPick === "sources") {
      body += '<div class="sgx-btnrow" style="flex-wrap:wrap">' +
        (state.ptSources || []).map(function (s) {
          return '<button class="sgx-btn" data-sgx="ptsrc" data-id="' + attr(s.id) + '" data-kind="' + attr(s.kind) + '">' +
            ic("local_hospital") + " " + esc(s.name) + (s.needsSignIn ? " · sign in" : "") + "</button>";
        }).join("") +
        (!(state.ptSources || []).length
          ? '<div class="sgx-disclaim" style="border:none">No hospital is connected. Sign in to Ward Sync, or connect a hospital under Connect EMR, or enter the patient manually.</div>'
          : "") +
        '<button class="sgx-btn" data-sgx="ptcancel">Cancel</button></div>';
    } else if (state.ptPick === "connect") {
      body += '<div class="sgx-fld"><label for="sgxPtQuery">Search ' + esc(state.ptTenantName || "hospital") + '</label>' +
        '<input id="sgxPtQuery" type="text" data-sgx-ptquery value="' + attr(state.ptQuery || "") + '" placeholder="Name or hospital number"></div>' +
        '<div class="sgx-btnrow"><button class="sgx-btn pri" data-sgx="ptsearch">' + ic("search") + " Search</button>" +
        '<button class="sgx-btn" data-sgx="ptcancel">Cancel</button></div>';
      if (state.ptBusy) body += '<div class="sgx-disclaim" style="border:none">Searching…</div>';
      else if (state.ptResults) {
        body += state.ptResults.length
          ? state.ptResults.map(function (p, i) {
              return '<button class="sgx-row" data-sgx="ptpick" data-idx="' + i + '"><span class="tx">' +
                '<span class="tt">' + esc(PT().patientLabel(p)) + "</span>" +
                '<span class="sb">' + esc(PT().patientMrn(p) || "no hospital number") + "</span></span>" +
                '<span class="go">' + ic("chevron_right") + "</span></button>";
            }).join("")
          : '<div class="sgx-disclaim" style="border:none">' + esc(state.ptError || "No patient matched.") + "</div>";
      }
    } else if (state.ptPick === "manual") {
      body += '<div class="sgx-fld"><label for="sgxPtManual">Patient reference (initials or hospital number)</label>' +
        '<input id="sgxPtManual" type="text" data-sgx-ptmanual value="' + attr((link && link.source === "manual" && link.name) || "") + '" placeholder="e.g. R.K. / 4471"></div>' +
        '<div class="sgx-btnrow"><button class="sgx-btn pri" data-sgx="ptmanualsave">Use this patient</button>' +
        '<button class="sgx-btn" data-sgx="ptcancel">Cancel</button></div>';
    } else {
      body += '<div class="sgx-btnrow">' +
        '<button class="sgx-btn" data-sgx="ptfromemr">' + ic("local_hospital") + " From a hospital EMR</button>" +
        '<button class="sgx-btn" data-sgx="ptmanual">' + ic("edit") + " Enter manually</button></div>";
    }
    return '<div class="sgx-card"><h4>Patient</h4>' + body + "</div>";
  }

  /* ── save destinations (local / Drive / hospital EMR) ─────────────────────
   * The device is the system of record and is written FIRST on every one of these; Drive and the
   * EMR are exports layered on a successful local save, never alternatives to it. An unavailable
   * destination is shown greyed WITH its reason rather than hidden - a row that silently vanishes
   * is the most confusing thing you can do to someone looking for it mid-list.
   * Export needs a finalised note: a draft is explicitly not a record. */
  /* ── armed confirmations live in STATE, never on the DOM node ──────────────
   *
   * They used to be a `data-armed` attribute on the button. Any repaint - the assessment probe
   * resolving, a status refresh, a save completing - replaces that element and takes the attribute
   * with it, so the SECOND tap re-arms instead of acting and the surgeon loops forever believing
   * they confirmed. Measured on a Pixel 9 on 2026-08-26: tap, tap, and the toast "Tap once more to
   * sign and send" fired TWICE with the note still unsigned. It is very likely the original cause
   * of a note that was finalised and never sent.
   *
   * Keyed by action+target so arming one row cannot arm another, and time-boxed so a stale arm from
   * five minutes ago cannot be completed by an unrelated tap. */
  var ARM_MS = 15000;
  function armKey(act, id) { return String(act) + ":" + String(id == null ? "" : id); }
  function isArmed(act, id) {
    var a = state.armed;
    return !!(a && a.key === armKey(act, id) && a.until > Date.now());
  }
  function arm(act, id) {
    state.armed = { key: armKey(act, id), until: Date.now() + ARM_MS };
    if (state.armTimer) { try { clearTimeout(state.armTimer); } catch (e) {} }
    state.armTimer = setTimeout(function () {
      state.armTimer = null;
      if (state.armed && state.armed.until <= Date.now()) { state.armed = null; render(); }
    }, ARM_MS);
  }
  function disarm() {
    state.armed = null;
    if (state.armTimer) { try { clearTimeout(state.armTimer); } catch (e) {} state.armTimer = null; }
  }

  /* Complete AND confirmed - the same gate the Finalise button uses, asked without a DOM. */
  function readyToFinalize(n) {
    try {
      var sc = state.noteSchema || NS().schemaFor(n.type, n.templateId);
      return M().noteCompleteness(sc.sections, n.values, n.provenance).canFinalize === true;
    } catch (e) { return false; }
  }

  function destinationCard(n) {
    var D = DEST();
    if (!D || !D.availability) return "";
    // The EMR row answers to the LINKED PATIENT, not just to the flags: a manual or Connect
    // patient has no writable hospital record, and saying so here beats failing at the end.
    var P = PT(), w = P ? P.writability(n.patient || null) : { canWrite: false, reason: "" };
    var rows = D.availability(), out = "", i, d;
    for (i = 0; i < rows.length; i++) {
      d = rows[i];
      var blocked = !d.available || (d.id !== "local" && !n.finalized);
      var why = d.reason;
      var act = "notedest", label = d.label;
      if (d.id === "emr" && !w.canWrite) { blocked = true; why = w.reason || why; }
      // Writable, but this note will CREATE the Initial Assessment rather than append to one.
      // Not a warning - a description, so the surgeon knows what they are about to start.
      else if (d.id === "emr" && w.willCreate && n.finalized) why = w.note;

      /* ONE action for the overwhelmingly common intent.
       *
       * A note that is complete and has a writable patient was being told "Finalise the note before
       * sending it anywhere" - and finalising is its OWN armed double-tap, so filing one note took
       * FOUR deliberate taps across two separate gates. The owner lost an hour to exactly that on
       * 2026-08-26: finalised, confirmed, and reasonably believed it had sent.
       *
       * So when the note is ready but not yet finalised, this row becomes "Finalise and write...".
       * It still arms and still carries the PHI disclosure - one confirmation before patient data
       * leaves the device is the safety feature. Two in a row is theatre that teaches people to tap
       * through, which is worse than one they actually read. */
      if (d.id !== "local" && !n.finalized && d.available && (d.id !== "emr" || w.canWrite) && readyToFinalize(n)) {
        blocked = false;
        act = "notefinalsend";
        label = d.id === "drive" ? "Finalise and send to Drive" : "Finalise and write to the hospital record";
        why = d.id === "emr" && w.willCreate ? w.note : "Signs the note, then sends it. Confirmed once.";
      } else if (!why && d.id !== "local" && !n.finalized) {
        why = "Finalise the note before sending it anywhere.";
      }
      /* Armed appearance comes FROM STATE, so a repaint mid-confirmation redraws the armed row
       * instead of silently resetting it to "tap me" while the user believes it is still armed. */
      var isArm = isArmed(act, d.id);
      if (isArm) {
        label = act === "notefinalsend"
          ? (d.id === "drive" ? "Tap again to sign and send to Drive" : "Tap again to sign and write to the record")
          : (d.id === "drive" ? "Tap again to send to Drive" : "Tap again to write to the hospital record");
        why = act === "notefinalsend"
          ? "Signs the note as final and sends it. Contains patient identifiers."
          : "Contains patient identifiers.";
      }
      out += '<button class="sgx-row' + (isArm ? " danger" : "") + '" data-sgx="' + act + '" data-id="' + attr(d.id) + '"' +
        (blocked ? " disabled" : "") + '><span class="tx">' +
        '<span class="tt">' + esc(label) + "</span>" +
        '<span class="sb">' + esc(why || d.sub) + "</span></span>" +
        '<span class="go">' + ic(blocked ? "block" : "chevron_right") + "</span></button>";
    }
    return '<div class="sgx-card"><h4>Save to</h4>' + out +
      '<div class="sgx-disclaim" style="margin-top:8px;border:none;padding:6px 0 0">' +
      "This note contains patient identifiers. Sending it to Drive or the hospital record is a " +
      "disclosure and is confirmed each time. The encrypted copy on this device is kept either way." +
      "</div></div>";
  }

  /* Transport errors say what the clinician should DO. The one case that must never read like a
   * transient glitch is the EMR route: it is not implemented and no amount of retrying will change
   * that, so it says so plainly and reminds them the device copy is safe. */
  function destError(dest, r) {
    var e = (r && r.error) || "failed";
    if (e === "no_drive_account") return "No Google account for Drive on this device";
    if (e === "ghis_signed_out") return "Sign in to GHIS first (Ward Sync)";
    if (e === "no_patient_selected") return "Select the patient in Ward Sync first";
    if (e === "no_episode") return "Open the patient from the ward list first (no visit selected)";
    if (e === "source_not_writable") return "This patient is not from GHIS, so there is no hospital record to write to.";
    if (e === "emr_write_disabled") return "Hospital record writing is switched off on the server. The note is saved on this device.";
    // The server's own refusals are specific and worth showing: they mean the write was correctly
    // REFUSED, not that it silently failed.
    if (e === "patient_mismatch" || /patient_mismatch/.test(String(r && r.resp))) {
      return "Refused: the hospital form did not match this patient. Nothing was written.";
    }
    if (e === "no_active_assessment" || /no_active_assessment/.test(String(r && r.resp))) {
      return "No active visit assessment for this patient. Open their visit in GHIS first.";
    }
    /* The server says login_required when the stored GHIS session has timed out - GHIS expires in
     * about 30 minutes, so this is the NORMAL state for a note written an hour after Ward Sync was
     * last opened. It was falling through to the generic "could not reach the hospital record",
     * which sent the owner hunting a network fault for an expired sign-in. Only the clinician can
     * fix it (it needs their credentials), so say exactly that. */
    if (e === "login_required" || e === "ghis_session_expired") {
      return "Your GHIS sign-in has expired. Open Ward Sync, sign in again, then send the note.";
    }
    if (e.indexOf("http_401") === 0 || e.indexOf("http_403") === 0) return "Access refused. Sign in again.";
    if (e.indexOf("http_") === 0) return (dest === "drive" ? "Drive" : "The hospital record") + " refused the save (" + e.replace("http_", "") + ")";
    return (dest === "drive" ? "Could not reach Drive" : "Could not reach the hospital record") + ". The note is saved on this device.";
  }

  function renderNoteEditor() {
    var mm = M(), n = state.note, schema = state.noteSchema;
    if (!schema) return head("Note", "01") + errorState("Unknown note type.");
    var comp = mm.noteCompleteness(schema.sections, n.values, n.provenance);

    var body = "";
    if (n.finalized) {
      body += '<div class="sgx-banner info">' + ic("verified") + " Finalised" +
        (n.finalizedAt ? " on " + esc(n.finalizedAt) : "") + ". Editing reopens it as a draft.</div>";
    } else {
      body += '<div class="sgx-banner warn">' + ic("edit_note") +
        " DRAFT. Nothing here is a record until you confirm every required field and finalise it.</div>";
    }
    body += '<div class="sgx-banner info">' + ic("palette") +
      " Green is yours. Amber is generated structure you have not confirmed. Red is required and missing.</div>";

    body += '<div class="sgx-fld"><label for="sgxNoteLabel">Note label (no patient identifiers)</label>' +
      '<input id="sgxNoteLabel" type="text" data-sgx-label value="' + attr(n.label) + '" placeholder="e.g. Bed 12 lap chole"></div>';

    schema.sections.forEach(function (sec) {
      body += '<div class="sgx-notesec"><div class="h">' + esc(sec.title) + "</div>" +
        (sec.note ? '<div class="n">' + esc(sec.note) + "</div>" : "");
      sec.fields.forEach(function (f) {
        body += renderField(f, n);
      });
      body += "</div>";
    });

    if (!n.finalized) {
      // Dictation -> fields (2026-09-11). Until now the server's "surgx-note" structuring had no
      // client caller at all. The text is kept on the note so a re-render does not lose it.
      body += '<div class="sgx-card"><h4>Dictation</h4>' +
        '<div class="n">Type or paste what you did. MaiK only decides which field each thing you said belongs in. It never adds a fact, ' +
        'and a field with a number you did not say is dropped, not corrected.</div>' +
        '<textarea id="sgxDictation" rows="4" placeholder="e.g. Under GA, supine, right subcostal incision. Findings: ...">' + esc(n.dictation || "") + '</textarea>' +
        '<div class="sgx-btnrow"><button class="sgx-btn" data-sgx="notestructure">' + ic("auto_awesome") + " Structure with MaiK</button></div>" +
        (n.structureNote ? '<div class="n">' + esc(n.structureNote) + "</div>" : "") +
        "</div>";
    }
    body += '<div class="sgx-card"><h4>Preview</h4><pre class="sgx-pre" id="sgxNotePreview">' +
      esc(mm.renderNoteText(schema.sections, n.values, n.provenance, {
        title: schema.title, finalized: n.finalized, finalizedBy: n.finalizedBy, finalizedAt: n.finalizedAt
      })) + "</pre>" +
      '<div class="sgx-btnrow">' +
      '<button class="sgx-btn" data-sgx="notecopy">' + ic("content_copy") + " Copy</button>" +
      '<button class="sgx-btn" data-sgx="noteshare">' + ic("ios_share") + " Share</button>" +
      "</div></div>";

    body += patientCard(n);
    body += destinationCard(n);

    if (n.id) {
      body += '<div class="sgx-btnrow"><button class="sgx-btn danger" data-sgx="notedelete">' + ic("delete") + " Delete note</button></div>";
    }
    body += '<div class="sgx-disclaim">SURGX assists with structure and completeness. It never supplies a clinical ' +
      "fact you did not record. Counts, specimens, implants, consent and medication lists are never AI-fillable at all.</div>";

    // The sticky bar carries the ONE number that matters and the finalise gate.
    var stat, cls = "";
    if (comp.missing.length) stat = "<b>" + comp.missing.length + " required field" + (comp.missing.length === 1 ? "" : "s") + " missing</b>";
    else if (comp.unconfirmed.length) stat = "<b>" + comp.unconfirmed.length + " field" + (comp.unconfirmed.length === 1 ? "" : "s") + " to confirm</b>";
    else { stat = "<b>Ready to finalise</b>"; cls = " ok"; }
    /* The count alone is a dead end on a twenty-field form: "6 required fields missing" does not say
     * which, and they are above the preview while the sticky bar sits at the bottom, so the surgeon
     * is told they are blocked and left to hunt (owner, 2026-08-26). Make the number the way there:
     * tap it and it scrolls to the first blocking field and focuses it. */
    var jumpTo = (comp.missing[0] || comp.unconfirmed[0] || {}).k || "";
    var sticky = '<div class="sgx-sticky"><div class="stat' + cls + '"' +
      (jumpTo ? ' data-sgx="notejump" data-k="' + attr(jumpTo) + '" role="button" tabindex="0" style="cursor:pointer;text-decoration:underline"' : "") +
      ">" + stat + " · " + comp.filled + " of " + comp.total + " filled</div>" +
      '<button class="sgx-btn" data-sgx="notesave">' + ic("save") + " Save</button>" +
      (n.finalized
        ? '<button class="sgx-btn" data-sgx="noteunfinal">Reopen</button>'
        : '<button class="sgx-btn pri' + (isArmed("notefinal", "") ? " danger" : "") + '" data-sgx="notefinal"' +
          (comp.canFinalize ? "" : " disabled") + '>' +
          (isArmed("notefinal", "") ? ic("warning") + " Tap again to finalise" : "Finalise") + "</button>") +
      "</div>";

    return head(schema.title, "01 · " + (n.finalized ? "Finalised" : "Draft")) + wrap(body) + sticky;
  }

  function renderField(f, n) {
    var v = n.values[f.k] == null ? "" : String(n.values[f.k]);
    var p = n.provenance[f.k];
    var missing = f.required && !v.trim();
    var pv = missing ? "missing" : (p || (v ? "clinician" : ""));
    var cls = pv ? " is-" + pv : "";
    var provLabel = { clinician: "yours", voice: "dictated", ai: "generated", missing: "missing" }[pv] || "";

    var h = '<div class="sgx-fld' + cls + '" data-fk="' + attr(f.k) + '">' +
      '<label for="sgxF-' + attr(f.k) + '">' + esc(f.label) +
      (f.required ? ' <span class="req" title="Required">*</span>' : "") +
      (f.aiFillable === false ? " " + ic("lock") : "") +
      (provLabel ? '<span class="sgx-prov ' + pv + '">' + provLabel + "</span>" : "") +
      "</label>";
    if (f.help) h += '<div class="help">' + esc(f.help) + "</div>";
    if (f.type === "text") {
      h += '<input id="sgxF-' + attr(f.k) + '" type="text" data-sgx-field="' + attr(f.k) + '" value="' + attr(v) +
        '" placeholder="' + attr(f.ph) + '">';
    } else {
      h += '<textarea id="sgxF-' + attr(f.k) + '" rows="' + (f.rows || 2) + '" data-sgx-field="' + attr(f.k) +
        '" placeholder="' + attr(f.ph) + '">' + esc(v) + "</textarea>";
    }
    // Confirmation is an explicit act. A dictated or generated field that reads correctly is still
    // not a field the surgeon has put their name to, and an operative note is signed.
    if (v.trim() && pv !== "clinician") {
      h += '<button class="sgx-confirm" data-sgx="confirm" data-k="' + attr(f.k) + '">' + ic("check") + " Confirm as mine</button>";
    } else if (v.trim() && pv === "clinician") {
      h += '<button class="sgx-confirm done" data-sgx="confirm" data-k="' + attr(f.k) + '" disabled>' + ic("check_circle") + " Confirmed</button>";
    }
    return h + "</div>";
  }

  function noteText() {
    var mm = M(), n = state.note, s = state.noteSchema;
    if (!mm || !n || !s) return "";
    return mm.renderNoteText(s.sections, n.values, n.provenance, {
      title: s.title, finalized: n.finalized, finalizedBy: n.finalizedBy, finalizedAt: n.finalizedAt
    });
  }

  function saveNote(silent) {
    var st = ST(), n = state.note;
    if (!st || !n) return Promise.resolve(false);
    return st.saveNote(n).then(function (r) {
      if (!r.ok) {
        toast(r.reason === "no-crypto" ? "Cannot save: secure storage unavailable" : "Could not save this note");
        return false;
      }
      n.id = r.id;
      if (route() === "note/new") state.stack[state.stack.length - 1] = "note/" + r.id;
      if (!silent) toast("Saved on this device");
      return true;
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     render + events
     ═══════════════════════════════════════════════════════════════════════ */

  function render() {
    var r = routeHead();
    var html;
    switch (r) {
      case "home": html = screenHome(); break;
      case "protocols": html = screenProtocols(); break;
      case "protocol": html = screenProtocol(); break;
      case "procedures": html = screenProcedures(); break;
      case "procedure": html = screenProcedure(); break;
      case "evidence": html = routeArg() ? screenEvidenceItem() : screenEvidence(); break;
      case "cases": html = screenCases(); break;
      case "case": html = screenCase(); break;
      case "notes": html = screenNotes(); break;
      case "notetemplate": html = screenNoteTemplate(); break;
      case "note": html = screenNote(); break;
      default: html = screenHome();
    }
    if (html) paint(html);
    try { if (ST()) ST().setLastSection(r); } catch (e) {}
  }

  /* Live field editing without a re-render: repainting the whole screen on every keystroke would
   * lose focus and the caret. Only the provenance chrome and the sticky bar need updating, and
   * they are updated in place. */
  function onFieldInput(el) {
    var n = state.note; if (!n) return;
    var k = el.getAttribute("data-sgx-field");
    if (!k) return;
    n.values[k] = el.value;
    n.provenance[k] = el.value.trim() ? "clinician" : "missing";
    var fld = el.closest ? el.closest(".sgx-fld") : null;
    if (fld) {
      fld.className = "sgx-fld is-" + (el.value.trim() ? "clinician" : "missing");
      var chip = fld.querySelector(".sgx-prov");
      if (chip) { chip.className = "sgx-prov " + (el.value.trim() ? "clinician" : "missing"); chip.textContent = el.value.trim() ? "yours" : "missing"; }
      var btn = fld.querySelector(".sgx-confirm");
      if (btn) { btn.className = "sgx-confirm done"; btn.disabled = true; btn.innerHTML = ic("check_circle") + " Confirmed"; }
    }
    refreshNoteStatus();
  }
  function refreshNoteStatus() {
    var mm = M(), n = state.note, s = state.noteSchema;
    if (!mm || !n || !s) return;
    var comp = mm.noteCompleteness(s.sections, n.values, n.provenance);
    var bar = state.root && state.root.querySelector(".sgx-sticky .stat");
    if (bar) {
      var txt, ok = false;
      if (comp.missing.length) txt = "<b>" + comp.missing.length + " required field" + (comp.missing.length === 1 ? "" : "s") + " missing</b>";
      else if (comp.unconfirmed.length) txt = "<b>" + comp.unconfirmed.length + " field" + (comp.unconfirmed.length === 1 ? "" : "s") + " to confirm</b>";
      else { txt = "<b>Ready to finalise</b>"; ok = true; }
      bar.className = "stat" + (ok ? " ok" : "");
      bar.innerHTML = txt + " · " + comp.filled + " of " + comp.total + " filled";
    }
    var fin = state.root && state.root.querySelector('[data-sgx="notefinal"]');
    if (fin) fin.disabled = !comp.canFinalize;
    var pv = state.root && state.root.querySelector("#sgxNotePreview");
    if (pv) pv.textContent = noteText();
  }

  function wire(rootEl) {
    rootEl.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-sgx]") : null;
      if (!t) return;
      var act = t.getAttribute("data-sgx");

      if (act === "close") { haptic("light"); if (window.SURGX) window.SURGX.close(); return; }
      if (act === "back") { haptic("light"); back(); return; }
      if (act === "go") { haptic("light"); go(t.getAttribute("data-r")); return; }
      if (act === "retry") { state.protoIndex = null; state.procList = null; state.evList = null; state.caseList = null; render(); return; }

      if (act === "calc") { openCalc(t.getAttribute("data-id")); return; }

      /* Notes backup / restore. DOUBLE PRESS, the armSignOff() discipline used elsewhere for actions
       * that move patient data: the first tap arms and says what will happen, the second performs it.
       * That is the "second in-UI tap" the PHI posture requires, and it also means a mis-tap on
       * Restore cannot overwrite anything. */
      /* Notes backup / restore. Tapping a button does NOT send: it opens the password form, which
       * is the deliberate second step (and carries the warning that a lost password is final).
       * The notes are encrypted on THIS device before anything reaches Google. */
      if (act === "bkup" || act === "bkrestore") {
        var BK = window.SMD_SURGX_BACKUP;
        var msg = rootEl.querySelector("#sgxBkMsg");
        if (!BK) { if (msg) msg.textContent = "Backup did not finish loading."; return; }
        var restoring = act === "bkrestore";
        var row = rootEl.querySelector(".sgx-bk-row");
        if (!row) return;
        if (msg) msg.textContent = "";
        haptic("light");
        row.innerHTML =
          '<div class="sgx-bk-form" data-mode="' + (restoring ? "restore" : "backup") + '">' +
            '<label class="sgx-bk-l" for="sgxBkPw">' + (restoring ? "Backup password" : "Set a backup password") + "</label>" +
            '<input class="sgx-bk-in" id="sgxBkPw" type="password" autocomplete="off" autocapitalize="off" ' +
              'autocorrect="off" spellcheck="false" placeholder="' + (restoring ? "The password you used" : "At least 8 characters") + '">' +
            (restoring ? "" :
              '<input class="sgx-bk-in" id="sgxBkPw2" type="password" autocomplete="off" autocapitalize="off" ' +
              'autocorrect="off" spellcheck="false" placeholder="Type it again">') +
            '<div class="sgx-bk-warn">' + ic("lock") +
              (restoring
                ? " Your notes were encrypted on your device before they were uploaded. Only this password can open them."
                : " Your notes are encrypted on this device first, so Google stores only ciphertext. <b>If you lose this password nobody can open the backup - not you, not StewardMD. There is no reset.</b>") +
            "</div>" +
            '<div class="sgx-bk-actions">' +
              '<button class="sgx-btn" data-sgx="bkcancel" type="button">Cancel</button>' +
              '<button class="sgx-btn pri" data-sgx="bkgo" data-mode="' + (restoring ? "restore" : "backup") + '" type="button">' +
                (restoring ? "Unlock and restore" : "Encrypt and back up") + "</button>" +
            "</div>" +
          "</div>";
        var f = row.querySelector("#sgxBkPw"); if (f) { try { f.focus(); } catch (e) {} }
        return;
      }
      if (act === "bkcancel") { render(); return; }
      if (act === "bkgo") {
        var BK2 = window.SMD_SURGX_BACKUP;
        var msg2 = rootEl.querySelector("#sgxBkMsg");
        if (!BK2) { if (msg2) msg2.textContent = "Backup did not finish loading."; return; }
        var isRestore = t.getAttribute("data-mode") === "restore";
        var p1 = rootEl.querySelector("#sgxBkPw"), p2 = rootEl.querySelector("#sgxBkPw2");
        var pw = p1 ? String(p1.value || "") : "";
        // A typo in a password nobody can reset is a permanent loss, so it is caught HERE, before
        // anything is written, rather than months later at restore time.
        if (!isRestore) {
          var chk = BK2.checkPassword(pw);
          if (!chk.ok) { if (msg2) msg2.textContent = BK2.describe({ error: chk.error }); return; }
          if (!p2 || String(p2.value || "") !== pw) {
            if (msg2) msg2.textContent = "The two passwords do not match.";
            return;
          }
        } else if (!pw) { if (msg2) msg2.textContent = BK2.describe({ error: "password_required" }); return; }

        t.disabled = true;
        t.textContent = isRestore ? "Unlocking…" : "Encrypting…";
        if (msg2) msg2.textContent = "";
        (isRestore ? BK2.restoreNow({ confirmed: true, password: pw })
                   : BK2.backupNow({ confirmed: true, password: pw })).then(function (res) {
          // Do not leave the password sitting in a DOM node once it has been used.
          try { if (p1) p1.value = ""; if (p2) p2.value = ""; } catch (e) {}
          var text = BK2.describe(res);
          if (res && res.ok) {
            render();
            var m2 = rootEl.querySelector("#sgxBkMsg"); if (m2) m2.textContent = text;
            return;
          }
          t.disabled = false;
          t.textContent = isRestore ? "Unlock and restore" : "Encrypt and back up";
          if (msg2) msg2.textContent = text;
        });
        return;
      }
      /* MEDDB.openList() is the app's own Drugs Database entry point (api.js; the same call
       * home.js's `drugs` action makes). MEDDRUGS is a DIFFERENT module - home.js uses it only for
       * openInteractions - so do not "correct" this to that one.
       * These buttons appeared dead not because of the globals but because their overlays
       * (.db-overlay 880, .abg 950) sit below the SURGX overlay's 1255 and opened behind it. The
       * lift lives in surgx.css. */
      if (act === "abg") {
        try { if (window.ABG && ABG.open) return ABG.open(); } catch (er) {}
        toast("Antibiogram is still loading"); return;
      }
      if (act === "drugs") {
        try { if (window.MEDDB && MEDDB.openList) return MEDDB.openList(); } catch (er) {}
        toast("Drug index is still loading"); return;
      }
      if (act === "ask") {
        // window.SMD_askMaik(q) is the app's own seam (home.js:5224) and it CARRIES the question.
        // The [data-act="askai"] fallback opens the sheet empty, so it is a last resort only.
        var q = t.getAttribute("data-q") || "";
        if (window.SURGX) window.SURGX.close();
        try {
          if (typeof window.SMD_askMaik === "function") return window.SMD_askMaik(q);
          var b = document.querySelector('[data-act="askai"]');
          if (b) { b.click(); return; }
        } catch (er) {}
        toast("Open Ask MaiK from the home screen");
        return;
      }
      if (act === "verify") {
        if (window.SURGX) window.SURGX.close();
        try { if (window.SMD_VERIFY && SMD_VERIFY.openPanel) return SMD_VERIFY.openPanel(); } catch (er) {}
        toast("Verification is available from your account menu");
        return;
      }
      if (act === "lit") {
        var host = rootEl.querySelector("#sgxLit");
        runLitReview(t.getAttribute("data-q") || "", host);
        return;
      }

      // protocols
      if (act === "toggle") {
        var id = t.getAttribute("data-id");
        if (!state.protoSel) state.protoSel = {};
        state.protoSel[id] = !state.protoSel[id];
        haptic("light");
        var cc = C();
        var next = cc ? cc.recompileProtocol(state.proto.id, selSet()) : null;
        if (next) { state.proto = next; render(); }
        return;
      }

      // procedures
      if (act === "tab") { state.procTab = t.getAttribute("data-id"); render(); try { state.host.scrollTop = 0; } catch (er) {} return; }

      // cases
      if (act === "level") { state.caseLevel = t.getAttribute("data-id"); state.kase = null; render(); return; }
      if (act === "answer") {
        var dp = t.getAttribute("data-dp"), opt = t.getAttribute("data-opt");
        if (!state.caseAnswers) state.caseAnswers = {};
        if (state.caseAnswers[dp]) return;
        state.caseAnswers[dp] = opt;
        haptic("light");
        render();
        return;
      }
      if (act === "caseReset") { state.caseAnswers = {}; state.mentor = null; render(); try { state.host.scrollTop = 0; } catch (er) {} return; }
      if (act === "mentor") { askMentor(); return; }

      // notes
      if (act === "newnote") { startNote(t.getAttribute("data-id")); return; }
      if (act === "notejump") {
        var fk = t.getAttribute("data-k");
        var el = fk && document.getElementById("sgxF-" + fk);
        if (!el) return;
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { try { el.scrollIntoView(); } catch (er) {} }
        // Focus AFTER the scroll settles, or the keyboard opening fights the animation.
        setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (er) {} } }, 320);
        haptic("tap");
        return;
      }
      if (act === "mknote") { createNote(t.getAttribute("data-t"), t.getAttribute("data-tpl")); return; }
      if (act === "notestructure") { structureNote(); return; }
      if (act === "confirm") {
        var fk = t.getAttribute("data-k");
        if (!state.note) return;
        state.note.provenance[fk] = "clinician";
        state.note.audit.push({ a: "confirm", k: fk });
        haptic("light");
        render();
        return;
      }
      if (act === "ptfromemr") {
        state.ptPick = "sources"; state.ptSources = null; render();
        PT().sources().then(function (list) { state.ptSources = list || []; render(); });
        return;
      }
      if (act === "ptmanual") { state.ptPick = "manual"; render(); return; }
      if (act === "ptcancel") { state.ptPick = null; state.ptResults = null; state.ptError = ""; render(); return; }
      if (act === "ptsrc") {
        var kind = t.getAttribute("data-kind"), sid = t.getAttribute("data-id");
        if (kind === "ghis") {
          /* Hand the choice to Ward Sync and come straight back.
           *
           * Ward Sync already owns the ward roster, its search and filters, the sign-in prompt and
           * the session handling - and a real list is HUNDREDS of patients (705 on the test
           * account), so a second list inside SURGX would duplicate all of that and then drift
           * from it. GHIS.pickPatient() opens that roster in one-shot pick mode; the next patient
           * tap fires our callback and we reopen the note with them linked.
           *
           * The note is saved BEFORE leaving: SURGX closes for the handoff, and an unsaved draft
           * must not depend on the surgeon coming back. */
          if (!(window.GHIS && GHIS.pickPatient)) { toast("Ward Sync is not loaded"); return; }
          var noteId = state.note && state.note.id;
          saveNote(true).then(function () {
            var backTo = (state.note && state.note.id) || noteId;
            state.ptPick = null;
            if (window.SURGX) SURGX.close();
            GHIS.pickPatient(function (sel) {
              var picked = PT().linkFromGhis(sel);
              // Reopen the note either way, so backing out never strands the surgeon somewhere else.
              try { if (window.SURGX && backTo) SURGX.open("note/" + backTo); } catch (er) {}
              if (!picked) { toast("Could not read that patient"); return; }
              setTimeout(function () {
                if (!state.note || state.note.id !== backTo) return;   // they navigated away; don't overwrite
                state.note.patient = picked;
                applyPatientToFields(picked);
                saveNote(true).then(function () {
                  toast(picked.episodeId ? "Patient linked" : "Linked, but this patient has no open visit");
                  render();
                  /* Ask NOW whether this patient actually has an Initial Assessment to file into.
                   * An open visit is not one, and without it the server refuses the write - which
                   * would otherwise only surface after the note is finalised and sent. */
                  PT().assessmentStatus(picked).then(function (a) {
                    if (!state.note || state.note.id !== backTo || !state.note.patient) return;
                    state.note.patient.assessment = a.state;
                    saveNote(true).then(function () { render(); });
                  });
                });
              }, 260);
            });
          });
          return;
        }
        state.ptPick = "connect"; state.ptTenant = sid;
        state.ptTenantName = (state.ptSources || []).filter(function (s) { return s.id === sid; }).map(function (s) { return s.name; })[0] || "";
        state.ptResults = null; state.ptError = ""; render();
        return;
      }
      if (act === "ptsearch") {
        var qEl = rootEl.querySelector("[data-sgx-ptquery]");
        state.ptQuery = qEl ? qEl.value : "";
        if (!state.ptQuery) { toast("Type a name or hospital number"); return; }
        state.ptBusy = true; state.ptResults = null; render();
        PT().searchConnect(state.ptTenant, state.ptQuery).then(function (r) {
          state.ptBusy = false;
          state.ptResults = r.patients || [];
          /* Say what to DO. "permission" from /api/connect/patients/search almost always means the
           * tenant has no connector configured (engine.js: loadConnectorConfig -> PermissionError),
           * not that the doctor lacks rights - they are usually an admin of the hospital they just
           * picked. A generic "search failed" sent this exact case looking for a network fault
           * (device-diagnosed 2026-08-25). */
          state.ptError = r.ok ? "" :
            (r.error === "permission"
              ? "This hospital has no EMR connector set up yet. Configure it under Connect EMR, then search again."
              : r.error === "not_found"
                ? "This hospital's connector type is switched off for this build."
                : r.error === "connect_unavailable"
                  ? "Connect is not available in this build."
                  : "Could not reach the hospital. Check the connection and try again.");
          render();
        });
        return;
      }
      if (act === "ptpick") {
        var p = (state.ptResults || [])[+t.getAttribute("data-idx")];
        var cl = PT().linkFromConnect(state.ptTenant, p);
        if (!cl) { toast("Could not read that patient"); return; }
        state.note.patient = cl; applyPatientToFields(cl); state.ptPick = null; state.ptResults = null;
        saveNote(true).then(function () { toast("Patient linked"); render(); });
        return;
      }
      if (act === "ptmanualsave") {
        var mEl = rootEl.querySelector("[data-sgx-ptmanual]");
        var ml = PT().linkManual(mEl ? mEl.value : "");
        if (!ml) { toast("Enter a patient reference"); return; }
        state.note.patient = ml; applyPatientToFields(ml); state.ptPick = null;
        saveNote(true).then(function () { toast("Patient set"); render(); });
        return;
      }
      if (act === "notesave") { saveNote(false); return; }
      /* Finalise AND send, behind ONE armed confirmation.
       *
       * Deliberately not two gates in a row. Finalising is a clinical act and sending PHI off-device
       * is a disclosure, but a surgeon who has just filled a complete note and tapped "Finalise and
       * write to the hospital record" has stated both intentions in one gesture. Asking twice does
       * not make them think twice; it teaches them to tap through, and it is how a note ended up
       * finalised-but-never-sent while its author believed otherwise. */
      if (act === "notefinalsend") {
        var fsDest = t.getAttribute("data-id");
        var fsNote = state.note;
        if (!fsNote) return;
        var fsComp = M().noteCompleteness(state.noteSchema.sections, fsNote.values, fsNote.provenance);
        if (!fsComp.canFinalize) { toast("Complete and confirm every required field first"); return; }
        /* A DIALOG, not a second tap.
         *
         * The two-tap gate failed for the owner over and over on a real phone: the first tap armed
         * visibly, the second did nothing they could see. Whether that was the 15s window expiring
         * while they read the disclosure, or a repaint, the mechanism itself is the problem - it is
         * invisible state with a clock on it, and when it goes wrong there is no feedback at all.
         *
         * A confirm() is unmissable, has no timer, survives any repaint, cannot be half-completed,
         * and is a STRONGER confirmation than tapping the same spot twice. Same pattern the sign-out
         * and restore paths already use. */
        var fsMsg = fsDest === "drive"
          ? "Sign this note as final and send it to your Google Drive?\n\nIt contains patient identifiers."
          : "Sign this note as final and write it into the patient's hospital record?\n\nIt contains patient identifiers. It is added to the Management plan of their Initial Assessment, below whatever is already there.";
        var goFs = true;
        try { goFs = window.confirm(fsMsg); } catch (e) { goFs = true; }
        if (!goFs) return;

        fsNote.finalized = true;
        fsNote.finalizedAt = todayISO();
        fsNote.finalizedBy = "clinician";
        fsNote.audit.push({ a: "finalize" });
        haptic("medium");
        toast(fsDest === "drive" ? "Signing and sending to Drive..." : "Signing and writing to the hospital record...");
        saveNote(true).then(function (okLocal) {
          if (okLocal === false) { toast("Could not save on this device - nothing was sent"); render(); return; }
          var D = DEST(); if (!D) { toast("Destinations unavailable"); render(); return; }
          var mm = M(), sc = state.noteSchema;
          var text = mm.renderNoteText(sc.sections, fsNote.values, fsNote.provenance, {
            title: sc.title, finalized: fsNote.finalized,
            finalizedBy: fsNote.finalizedBy, finalizedAt: fsNote.finalizedAt
          });
          D.send(fsDest, fsNote, text, { confirmed: true }).then(function (r) {
            if (r && r.ok) {
              fsNote.audit.push({ a: "sent", to: fsDest });
              saveNote(true);
              try { window.alert(fsDest === "drive" ? "Saved to your Drive."
                : "Written into the hospital record.\n\nOpen the patient's Initial Assessment in GHIS and scroll to Management plan."); } catch (e) {}
            } else {
              /* Never let a failed write be silent. The note IS signed; say so, and say why the send
               * failed, in a dialog they cannot miss. */
              var whyFs = destError(fsDest, r);
              try { window.alert("The note is SIGNED and saved on this phone, but it was NOT written to the hospital record.\n\nReason: " + whyFs + "\n\nThe note is safe - nothing is lost."); } catch (e) {}
              // An expired sign-in is the one failure the clinician can fix right now, so take them there.
              if (/sign-in has expired/i.test(whyFs)) { try { window.openGHIS && window.openGHIS(); } catch (e) {} }
            }
            render();
          });
        });
        return;
      }

      if (act === "notedest") {
        var dest = t.getAttribute("data-id");
        // ALWAYS write the device copy first, whatever the destination. If the export then fails
        // the note is already safe, and "local" is simply this step on its own.
        saveNote(true).then(function (okLocal) {
          if (okLocal === false) { toast("Could not save on this device"); return; }
          if (dest === "local") { toast("Saved on this device"); render(); return; }
          if (!state.note.finalized) { toast("Finalise the note before sending it anywhere"); return; }
          var D = DEST(); if (!D) { toast("Destinations unavailable"); return; }
          // Second tap confirms: this puts patient-identifying text outside the device.
          /* Dialog, not a second tap - same reasoning as notefinalsend above. */
          var dMsg = dest === "drive"
            ? "Send this note to your Google Drive?\n\nIt contains patient identifiers."
            : "Write this note into the patient's hospital record?\n\nIt contains patient identifiers. It is added to the Management plan of their Initial Assessment, below whatever is already there.";
          var goD = true;
          try { goD = window.confirm(dMsg); } catch (e) { goD = true; }
          if (!goD) return;
          var mm = M(), sc = state.noteSchema;
          var text = mm.renderNoteText(sc.sections, state.note.values, state.note.provenance, {
            title: sc.title, finalized: state.note.finalized,
            finalizedBy: state.note.finalizedBy, finalizedAt: state.note.finalizedAt
          });
          toast(dest === "drive" ? "Sending to Drive…" : "Writing to the hospital record…");
          D.send(dest, state.note, text, { confirmed: true }).then(function (r) {
            /* A toast is missable, and a write into a patient's chart that silently did not happen
             * is the worst outcome this screen has. Both results are a dialog. */
            if (r && r.ok) {
              try { window.alert(dest === "drive" ? "Saved to your Drive."
                : "Written into the hospital record.\n\nOpen the patient's Initial Assessment in GHIS and scroll to Management plan."); } catch (e) {}
            } else {
              var whyD = destError(dest, r);
              try { window.alert("NOT written to the hospital record.\n\nReason: " + whyD + "\n\nThe note is safe on this phone."); } catch (e) {}
              if (/sign-in has expired/i.test(whyD)) { try { window.openGHIS && window.openGHIS(); } catch (e) {} }
            }
            render();
          });
        });
        return;
      }
      if (act === "notefinal") {
        var mm = M();
        var comp = mm.noteCompleteness(state.noteSchema.sections, state.note.values, state.note.provenance);
        if (!comp.canFinalize) { toast("Complete and confirm every required field first"); return; }
        /* FINALISING DOES NOT SEND, and that caught the owner out at 00:50 on 2026-08-27: they
         * tapped the big green Finalise button, saw "Finalised", and reasonably believed the note
         * had gone to GHIS. It had not - the chart still showed the previous write. Worse, signing
         * REMOVES the "Finalise and write to the hospital record" row (that row only exists on a
         * draft) and replaces it with a plain destination that needs a separate action. So the most
         * obvious button on the screen quietly took the send AWAY.
         *
         * Signing is still its own act - a surgeon may well sign now and file later. But the moment
         * it is signed, if there is a writable hospital record waiting, ASK. */
        var writable = false;
        try { var wf = PT().writability(state.note.patient || null); writable = !!(wf && wf.canWrite); } catch (e) {}
        var goSign = true;
        try {
          goSign = window.confirm(writable
            ? "Sign this note as final?\n\nYou will be asked next whether to write it into the patient's hospital record."
            : "Sign this note as final?\n\nIt can still be reopened afterwards.");
        } catch (e) {}
        if (!goSign) return;
        disarm();
        state.note.finalized = true;
        state.note.finalizedAt = todayISO();
        state.note.finalizedBy = "clinician";
        state.note.audit.push({ a: "finalize" });
        haptic("medium");
        saveNote(true).then(function () {
          render();
          if (!writable) { toast("Finalised"); return; }
          var sendNow = false;
          try {
            sendNow = window.confirm("Note signed.\n\nWrite it into the patient's hospital record now?\n\nIt goes into the Management plan of their Initial Assessment. Contains patient identifiers.");
          } catch (e) {}
          if (!sendNow) { toast("Signed. Not sent - use Hospital EMR when you are ready."); return; }
          var D = DEST(); if (!D) { toast("Destinations unavailable"); return; }
          var sc = state.noteSchema, nn = state.note;
          var text = mm.renderNoteText(sc.sections, nn.values, nn.provenance, {
            title: sc.title, finalized: nn.finalized, finalizedBy: nn.finalizedBy, finalizedAt: nn.finalizedAt
          });
          toast("Writing to the hospital record...");
          D.send("emr", nn, text, { confirmed: true }).then(function (r) {
            if (r && r.ok) {
              nn.audit.push({ a: "sent", to: "emr" });
              saveNote(true);
              try { window.alert("Written into the hospital record.\n\nOpen the patient's Initial Assessment in GHIS and scroll to Management plan."); } catch (e) {}
            } else {
              var whyN = destError("emr", r);
              try { window.alert("The note is SIGNED and saved on this phone, but it was NOT written to the hospital record.\n\nReason: " + whyN + "\n\nThe note is safe - nothing is lost."); } catch (e) {}
              if (/sign-in has expired/i.test(whyN)) { try { window.openGHIS && window.openGHIS(); } catch (e) {} }
            }
            render();
          });
        });
        return;
      }
      if (act === "noteunfinal") {
        state.note.finalized = false;
        state.note.audit.push({ a: "reopen" });
        saveNote(true).then(function () { render(); });
        return;
      }
      if (act === "notecopy") {
        var txt = noteText();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { toast("Copied"); }, function () { toast("Could not copy"); });
            return;
          }
        } catch (er) {}
        toast("Copy is unavailable on this device");
        return;
      }
      if (act === "noteshare") {
        var txt2 = noteText();
        if (!state.note.finalized) { toast("Finalise the note before sharing it"); return; }
        try {
          if (navigator.share) { navigator.share({ text: txt2 }); return; }
        } catch (er) {}
        toast("Sharing is unavailable on this device");
        return;
      }
      if (act === "notedelete") {
        /* State-backed like the others. A repaint disarming a DELETE is fail-safe rather than
         * dangerous, but it produces the same unwinnable loop for the surgeon. */
        if (!isArmed("notedelete", "")) {
          arm("notedelete", "");
          toast("Tap Delete once more to remove this note");
          render();
          return;
        }
        disarm();
        try { ST().deleteNote(state.note.id); } catch (er) {}
        state.note = null;
        toast("Deleted");
        replace("notes");
        return;
      }
    });

    rootEl.addEventListener("input", function (e) {
      var el = e.target;
      if (el && el.getAttribute && el.getAttribute("data-sgx-field") != null) { onFieldInput(el); return; }
      if (el && el.hasAttribute && el.hasAttribute("data-sgx-label")) { if (state.note) state.note.label = el.value; return; }
      if (el && el.id === "sgxEvQ") {
        state.evQuery = el.value;
        clearTimeout(rootEl.__evT);
        rootEl.__evT = setTimeout(function () {
          var pos = el.selectionStart;
          render();
          var again = state.root.querySelector("#sgxEvQ");
          if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (er) {} }
        }, 220);
      }
    });
  }

  /* ── mount ───────────────────────────────────────────────────────────────── */

  var _wired = false;

  function mount(rootEl, deepRoute) {
    if (!rootEl) return;
    state.root = rootEl;
    state.host = rootEl.querySelector("#surgxScroll");
    if (!state.host) {
      rootEl.innerHTML = '<div class="sgx-scroll" id="surgxScroll"></div>';
      state.host = rootEl.querySelector("#surgxScroll");
    }
    if (!_wired) { wire(rootEl); _wired = true; }
    state.stack = ["home"];
    if (deepRoute && /^[a-z]+(\/[A-Za-z0-9_.-]+)?$/.test(deepRoute)) state.stack.push(deepRoute);
    render();
  }

  function onClose() { /* state is intentionally retained so reopening returns you to context */ }

  // _mdLite is exposed for the same reason _state is: the evidence-review renderer is a small parser
  // and needs a runnable check (test/run-surgx-md-ui.mjs). It is pure and reads no state.
  var API = { mount: mount, onClose: onClose, go: go, _state: function () { return state; }, _mdLite: mdLite };
  if (typeof window !== "undefined") window.SMD_SURGX_SCREENS = API;
})();
