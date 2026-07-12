/* StewardMD guided tour (onboarding.js) — additive, self-contained.
 *
 * A premium, dismissible, once-per-account interactive tour that drives the REAL home UI
 * (spotlight cut-out + floating coach-mark), plus a few one-time contextual tips. Nothing in
 * app.js / home.js core logic is modified — this module only reads the existing [data-act] DOM
 * and adds an overlay layer. Exposes window.SMD_TOUR.
 *
 * Flag: localStorage "smd_onboarding_tour" (default ON). ?tour=0 disables, ?tour=1 forces.
 * State: per-account under "smd_apptour:<owner>". Replay from More / sidebar Reference & Help.
 * Reversible: flag-gated; ships behind a git recovery tag until approved on-device. */
(function () {
  "use strict";

  var TOUR_VERSION = 1;

  // Home-anchored steps. Each target is a first-present-of list; a step whose target is absent
  // (feature flag off, different markup) auto-skips. Copy avoids em-dashes (app-facing text).
  var TOUR_STEPS = [
    { title: "Welcome to StewardMD",
      text: "StewardMD helps you make faster, evidence-based decisions at the point of care. Here is a quick tour of the essentials." },
    { sel: '[data-act="search"]', title: "Search anything",
      text: "Find diseases, drugs, organisms, guidelines and calculators from one place. Tap here whenever you are looking for something." },
    { sel: '[data-act="askai"]', title: "Ask MaiK",
      text: "Ask clinical questions in plain language, like treatment of CAP or DKA management. MaiK replies with referenced guidance." },
    { sel: '[data-act="startcase"],[data-act="reasoning"]', title: "Start a case",
      text: "Build a structured assessment and get a live differential with next steps. Use it to reason through a real patient." },
    { sel: '[data-act="drugmenu"],[data-act="drugs"]', title: "Drugs",
      text: "Monographs, adult and paediatric dosing, renal adjustment and interaction checks, all in one place." },
    { sel: '[data-act="calculators"]', title: "Calculators",
      text: "Over 50 validated scores such as CURB-65, SOFA and Wells. Long-press a calculator to pin your favourites." },
    { sel: '[data-act="antibiogram"],[data-act="icu"],[data-act="ward"]', title: "Antibiotic stewardship",
      text: "Antibiogram, ICU tools and Ward Sync support empiric choices, de-escalation and your local resistance data." },
    { sel: '[data-act="more"]', title: "Everything else",
      text: "Your account, settings, guidelines and this tour live here. You can replay the tour anytime from Reference and Help." }
  ];

  var TIPS = {
    "maik-natural": { title: "Tip", text: "Ask naturally, like you are speaking to another doctor." },
    "calc-pin": { title: "Tip", text: "Long-press a calculator to pin it for quick access." },
    "interactions-generic": { title: "Tip", text: "You can search by generic or brand name." }
  };

  // ---- identity + persistence -------------------------------------------------------------
  function owner() {
    try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.profile) { var p = SMD_ACCOUNT.profile(); if (p && p.email) return p.email; } } catch (e) {}
    try { var a = JSON.parse(localStorage.getItem("stewardmd_account") || "{}"); if (a && a.email) return a.email; } catch (e) {}
    return "anon";
  }
  function flagOn() {
    try {
      var q = (location.search.match(/[?&]tour=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on";
      var v = localStorage.getItem("smd_onboarding_tour");
      return v !== "0" && v !== "false";   // DEFAULT ON
    } catch (e) { return true; }
  }
  function skey() { return "smd_apptour:" + owner(); }
  function getState() { try { return JSON.parse(localStorage.getItem(skey())) || {}; } catch (e) { return {}; } }
  function setState(s) { try { localStorage.setItem(skey(), JSON.stringify(s)); } catch (e) {} }
  function shouldAuto() {
    if (!flagOn()) return false;
    var s = getState();
    if (s.dontShowAgain) return false;
    if (s.completedVersion === TOUR_VERSION) return false;
    if ((s.skippedCount || 0) >= 2) return false;   // a plain Skip allows one more showing
    return true;
  }
  function emit(phase, step) { try { window.dispatchEvent(new CustomEvent("smd:tour", { detail: { phase: phase, step: step, version: TOUR_VERSION } })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---- CSS (self-contained, light + dark) --------------------------------------------------
  function injectCSS() {
    if (document.getElementById("smdTourCss")) return;
    var st = document.createElement("style"); st.id = "smdTourCss";
    st.textContent = [
      ".smdt-spot{position:fixed;z-index:100040;border-radius:14px;pointer-events:none;box-shadow:0 0 0 9999px rgba(8,12,18,.55),0 0 0 3px #14b8a6,0 0 22px 4px rgba(20,184,166,.55);transition:top .18s,left .18s,width .18s,height .18s}",
      ".smdt-spot.pulse::after{content:'';position:absolute;inset:-3px;border-radius:16px;border:2px solid rgba(20,184,166,.7);animation:smdtPulse 1.6s ease-out infinite}",
      "@keyframes smdtPulse{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.12);opacity:0}}",
      ".smdt-veil{position:fixed;inset:0;z-index:100039;background:rgba(8,12,18,.55)}",   // used only for the no-target welcome step
      ".smdt-card{position:fixed;z-index:100050;width:min(360px,calc(100vw - 28px));background:#fff;color:#0f172a;border:1.5px solid #14b8a6;border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.4);padding:15px 16px 14px;font-family:var(--sans,system-ui,-apple-system,'IBM Plex Sans',sans-serif)}",
      ".smdt-eyebrow{font:800 10.5px/1 inherit;letter-spacing:.06em;text-transform:uppercase;color:#0d9488}",
      ".smdt-title{font:800 17px/1.25 inherit;margin:5px 0 5px}",
      ".smdt-text{font:500 13.5px/1.5 inherit;color:#475569}",
      ".smdt-dots{display:flex;gap:5px;margin:12px 0 2px}.smdt-dots i{width:6px;height:6px;border-radius:50%;background:rgba(100,116,139,.35)}.smdt-dots i.on{background:#0d9488;width:16px;border-radius:4px}",
      ".smdt-chk{display:flex;align-items:center;gap:8px;font:600 12.5px inherit;color:#0f172a;margin-top:10px;cursor:pointer}.smdt-chk input{width:16px;height:16px}",
      ".smdt-btns{display:flex;align-items:center;gap:8px;margin-top:12px}",
      ".smdt-btns .sp{flex:1}",
      ".smdt-b{border:0;border-radius:10px;padding:9px 15px;font:800 13px inherit;cursor:pointer}",
      ".smdt-b.pri{background:#0d9488;color:#fff}.smdt-b.gho{background:transparent;color:#64748b;padding:9px 10px}",
      ".smdt-b:focus-visible{outline:2px solid #0d9488;outline-offset:2px}",
      // one-time contextual tip (lighter, bottom, auto-dismiss)
      ".smdt-tip{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:100060;width:min(380px,calc(100vw - 24px));background:#0f172a;color:#f8fafc;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.4);padding:12px 14px;font-family:var(--sans,system-ui,sans-serif);display:flex;align-items:flex-start;gap:10px;opacity:0;transition:opacity .2s,transform .2s}",
      ".smdt-tip.on{opacity:1}",
      ".smdt-tip .ti{font-size:16px;line-height:1.2}.smdt-tip .tt{font:800 11px/1 inherit;letter-spacing:.05em;text-transform:uppercase;color:#5eead4}.smdt-tip .tx{font:500 13px/1.45 inherit;margin-top:3px}",
      ".smdt-tip .tc{margin-left:auto;background:none;border:0;color:#94a3b8;font-size:17px;cursor:pointer;line-height:1;padding:0 2px}",
      // dark mode
      "body.dark .smdt-card,body.v3-dark .smdt-card{background:#111b2e;color:#e7edf5;border-color:#2dd4bf;box-shadow:0 18px 48px rgba(0,0,0,.55)}",
      "body.dark .smdt-text,body.v3-dark .smdt-text{color:#8fa3ba}",
      "body.dark .smdt-chk,body.v3-dark .smdt-chk{color:#e7edf5}",
      "@media (prefers-reduced-motion:reduce){.smdt-spot,.smdt-tip,.smdt-card{transition:none}.smdt-spot.pulse::after{animation:none}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- element resolution + geometry -------------------------------------------------------
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  function resolve(sel) {
    if (!sel) return null;
    var scope = document.getElementById("homeV2") || document;
    var list = sel.split(",");
    for (var i = 0; i < list.length; i++) {
      var els = scope.querySelectorAll(list[i].trim());
      for (var j = 0; j < els.length; j++) { if (visible(els[j])) return els[j]; }
    }
    return null;
  }
  // Tight highlight rect: union of the element and its visible children. This hugs the real
  // content (icon + label) rather than the full tap cell, and — crucially for the elevated
  // bottom-nav MaiK button — includes children that overflow the button box (its round icon
  // sits above via a negative margin), so the spotlight wraps the whole button, not a clipped
  // white cell. Falls back to the element's own rect when it has no laid-out children.
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    var kids = el.children, any = false;
    var top = r.top, left = r.left, bottom = r.bottom, right = r.right;
    for (var i = 0; kids && i < kids.length; i++) {
      var cs = window.getComputedStyle(kids[i]);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var cr = kids[i].getBoundingClientRect();
      if (cr.width < 1 || cr.height < 1) continue;
      any = true;
      if (cr.top < top) top = cr.top;
      if (cr.left < left) left = cr.left;
      if (cr.bottom > bottom) bottom = cr.bottom;
      if (cr.right > right) right = cr.right;
    }
    if (!any) return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
    return { top: top, left: left, bottom: bottom, right: right, width: right - left, height: bottom - top };
  }

  // ---- engine ------------------------------------------------------------------------------
  var _spot = null, _card = null, _veil = null, _step = 0, _live = [], _sessionShown = false, _onKey = null;

  function ensureEls() {
    injectCSS();
    if (!_spot) { _spot = document.createElement("div"); _spot.className = "smdt-spot"; document.body.appendChild(_spot); }
    if (!_veil) { _veil = document.createElement("div"); _veil.className = "smdt-veil"; document.body.appendChild(_veil); }
    if (!_card) { _card = document.createElement("div"); _card.className = "smdt-card"; _card.setAttribute("role", "dialog"); _card.setAttribute("aria-modal", "false"); _card.setAttribute("aria-label", "StewardMD app tour"); document.body.appendChild(_card); _card.addEventListener("click", onCardClick); }
  }

  // Build the runnable step list for this run (skip steps whose target is missing, keep welcome).
  function buildLive() {
    _live = TOUR_STEPS.filter(function (s) { return !s.sel || resolve(s.sel); });
    if (!_live.length) _live = [TOUR_STEPS[0]];
  }

  // Position the spotlight over the target and return the padded rect it occupies (or null for
  // the no-target welcome step) so the card can be placed clear of it.
  function positionSpot(tgt) {
    if (!tgt) { _spot.style.display = "none"; _veil.style.display = "block"; return null; }
    _veil.style.display = "none";
    var r = rectOf(tgt), pad = 6;
    var top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    var w = r.width + pad * 2, h = r.height + pad * 2;
    _spot.style.display = "block";
    _spot.style.top = top + "px";
    _spot.style.left = left + "px";
    _spot.style.width = w + "px";
    _spot.style.height = h + "px";
    _spot.classList.add("pulse");
    return { top: top, left: left, bottom: top + h, right: left + w, width: w, height: h };
  }
  // Place the card clear of the spotlight: below if it fits, else above, else on the side with
  // more room (clamped into the viewport). Keyed off the padded spotlight rect so the card never
  // covers the button being highlighted.
  function positionCard(spot) {
    var cw = _card.offsetWidth || 340, ch = _card.offsetHeight || 180, vw = window.innerWidth, vh = window.innerHeight, m = 12, gap = 16, top, left;
    if (!spot) { left = (vw - cw) / 2; top = (vh - ch) / 2; }
    else {
      left = Math.min(Math.max(m, spot.left + spot.width / 2 - cw / 2), vw - cw - m);
      var below = spot.bottom + gap, above = spot.top - gap - ch;
      if (below + ch + m <= vh) top = below;
      else if (above >= m) top = above;
      else if ((vh - spot.bottom) >= spot.top) top = Math.min(below, vh - ch - m);
      else top = Math.max(m, above);
    }
    _card.style.left = left + "px"; _card.style.top = Math.max(m, top) + "px";
  }

  function render() {
    var n = _live.length, s = _live[_step], last = _step === n - 1, tgt = s.sel ? resolve(s.sel) : null;
    if (tgt) { try { tgt.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {} }
    ensureEls();
    var dots = ""; for (var i = 0; i < n; i++) dots += '<i class="' + (i === _step ? "on" : "") + '"></i>';
    _card.innerHTML =
      '<div class="smdt-eyebrow">Step ' + (_step + 1) + " of " + n + "</div>" +
      '<div class="smdt-title">' + esc(s.title) + "</div>" +
      '<div class="smdt-text">' + esc(s.text) + "</div>" +
      '<div class="smdt-dots">' + dots + "</div>" +
      (last ? '<label class="smdt-chk"><input type="checkbox" id="smdtDont"> Do not show this again</label>' : "") +
      '<div class="smdt-btns">' +
        (_step > 0 ? '<button class="smdt-b gho" data-t="back">Back</button>' : "") +
        '<button class="smdt-b gho" data-t="skip">Skip</button>' +
        '<span class="sp"></span>' +
        (last ? '<button class="smdt-b pri" data-t="done">Finish</button>' : '<button class="smdt-b pri" data-t="next">Next</button>') +
      "</div>";
    // paint after layout so card size is known for positioning
    var spot = positionSpot(tgt); positionCard(spot);
    requestAnimationFrame(function () { positionCard(positionSpot(tgt)); });
    setTimeout(function () { try { var b = _card.querySelector('[data-t="next"],[data-t="done"]'); if (b) b.focus(); } catch (e) {} }, 40);
    emit("step_view", _step);
  }

  function reflow() { if (!_card || _card.style.display === "none") return; var s = _live[_step]; var tgt = s && s.sel ? resolve(s.sel) : null; positionCard(positionSpot(tgt)); }

  function open() {
    ensureEls(); _step = 0; buildLive();
    _spot.style.display = ""; _card.style.display = "";
    window.addEventListener("resize", reflow); window.addEventListener("scroll", reflow, true);
    _onKey = function (e) { if (e.key === "Escape") skip(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") back(); };
    document.addEventListener("keydown", _onKey);
    render(); emit("started", 0);
  }
  function teardown() {
    if (_spot) _spot.style.display = "none";
    if (_veil) _veil.style.display = "none";
    if (_card) { _card.style.display = "none"; _card.innerHTML = ""; }
    window.removeEventListener("resize", reflow); window.removeEventListener("scroll", reflow, true);
    if (_onKey) { document.removeEventListener("keydown", _onKey); _onKey = null; }
  }
  function next() { if (_step < _live.length - 1) { _step++; render(); } }
  function back() { if (_step > 0) { _step--; render(); } }
  function skip() { var s = getState(); s.skippedVersion = TOUR_VERSION; s.skippedCount = (s.skippedCount || 0) + 1; setState(s); emit("skipped", _step); teardown(); }
  function finish() {
    var s = getState(); s.completedVersion = TOUR_VERSION; s.lastCompletedAt = new Date().toISOString();
    var dont = document.getElementById("smdtDont"); if (dont && dont.checked) s.dontShowAgain = true;
    setState(s); emit("completed", _step); teardown();
  }
  function onCardClick(e) {
    var b = e.target.closest && e.target.closest("[data-t]"); if (!b) return;
    var t = b.getAttribute("data-t");
    if (t === "back") back(); else if (t === "next") next(); else if (t === "skip") skip(); else if (t === "done") finish();
  }

  // ---- contextual tips ---------------------------------------------------------------------
  var _tipEl = null, _tipTimer = null;
  function tipSeen(id) { try { return localStorage.getItem("smd_tip:" + owner() + ":" + id) === "1"; } catch (e) { return false; } }
  function markTip(id) { try { localStorage.setItem("smd_tip:" + owner() + ":" + id, "1"); } catch (e) {} }
  function showTip(id) {
    var t = TIPS[id]; if (!t) return;
    if (tipSeen(id)) return;
    if (_card && _card.style.display !== "none" && _card.innerHTML) return;   // suppressed during the main tour
    markTip(id); injectCSS();
    if (!_tipEl) { _tipEl = document.createElement("div"); _tipEl.className = "smdt-tip"; document.body.appendChild(_tipEl); }
    _tipEl.innerHTML = '<span class="ti">💡</span><div><div class="tt">' + esc(t.title) + '</div><div class="tx">' + esc(t.text) + '</div></div><button class="tc" aria-label="Dismiss">×</button>';
    _tipEl.querySelector(".tc").onclick = hideTip;
    requestAnimationFrame(function () { _tipEl.classList.add("on"); });
    clearTimeout(_tipTimer); _tipTimer = setTimeout(hideTip, 6000);
  }
  function hideTip() { if (_tipEl) { _tipEl.classList.remove("on"); } clearTimeout(_tipTimer); }

  // Fire the relevant one-time tip shortly after the matching feature is opened (delegated,
  // capture-phase so it survives the app's own handlers). No edits to those features.
  function wireTips() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act"), id = null;
      if (a === "askai") id = "maik-natural";
      else if (a === "calculators") id = "calc-pin";
      else if (a === "interactions") id = "interactions-generic";
      if (id) setTimeout(function () { showTip(id); }, 700);
    }, true);
  }

  // ---- auto trigger ------------------------------------------------------------------------
  function homeForeground() {
    var h = document.getElementById("homeV2"); if (!h || !visible(h)) return false;
    var sp = document.getElementById("splash");
    if (sp) { var cs = window.getComputedStyle(sp); if (cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0") return false; }
    return true;
  }
  function maybeAuto() {
    if (_sessionShown) return;
    if (!shouldAuto()) return;
    if (!homeForeground()) return;
    _sessionShown = true;
    var s = getState(); s.launchCount = (s.launchCount || 0) + 1; setState(s);
    setTimeout(function () { try { open(); } catch (e) {} }, 650);
  }
  function watch() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (_sessionShown || !shouldAuto()) { clearInterval(iv); return; }
      if (homeForeground()) { clearInterval(iv); maybeAuto(); }
      if (tries > 80) clearInterval(iv);   // ~40s ceiling
    }, 500);
  }

  // ---- public API --------------------------------------------------------------------------
  window.SMD_TOUR = {
    start: function (opts) { try { open(); } catch (e) {} },   // replay/force (ignores state gate)
    maybeAuto: maybeAuto,
    tip: function (id) { try { showTip(id); } catch (e) {} },
    reset: function () { try { localStorage.removeItem(skey()); } catch (e) {} },
    version: TOUR_VERSION
  };

  function boot() { wireTips(); watch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
