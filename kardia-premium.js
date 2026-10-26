/* Kardia premium layer: first-run onboarding, native haptics and the
 * offline banner. ES5, defensive: every host call is guarded so a
 * missing root, storage or plugin leaves Kardia exactly as it was.
 * Design contract: work/review/premium-inventory.md. Copy rules:
 * British spelling and plain app wording throughout. */
(function (G) {
  "use strict";
  var KEY = "smd_kardia_onboarded_v1";
  var CARDS = [
    { title: "Welcome to Kardia", body: "Kardia teaches echocardiography and ECG reading on your phone. You scan a body, find real heart views, and get one clear coaching step at a time." },
    { title: "Move the probe on the body", body: "Drag the round grip to slide the probe along the skin. Drag the marker ring to rotate it, and move the tail to fan and rock the beam. Small movements change the cut a lot." },
    { title: "The real scan and coaching", body: "The monitor shows the ultrasound image and the ECG together. Follow the coaching line, hold still inside the target ranges, and the real patient clip for that view appears. You start at PLAX, parasternal long axis." }
  ];
  var step = 0, overlay = null, rootEl = null;

  function store() { try { return G.localStorage || null; } catch (e) { return null; } }
  function shouldShow() { var s = store(); try { return !s || s.getItem(KEY) !== "1"; } catch (e) { return true; } }
  function remember() { var s = store(); try { if (s) s.setItem(KEY, "1"); } catch (e) {} }

  /* Haptics only through Capacitor Haptics on a native platform.
   * No plugin, no native platform, no call: nothing fires off device. */
  function haptic(kind) {
    try {
      var C = G.Capacitor; if (!C) return false;
      if (typeof C.isNativePlatform === "function" && !C.isNativePlatform()) return false;
      var H = C.Plugins && C.Plugins.Haptics; if (!H) return false;
      if (kind === "success") { if (H.notification) { H.notification({ type: "SUCCESS" }); return true; } if (H.impact) { H.impact({ style: "MEDIUM" }); return true; } return false; }
      if (kind === "selection") {
        if (H.selectionStart) { H.selectionStart(); if (H.selectionChanged) H.selectionChanged(); if (H.selectionEnd) H.selectionEnd(); return true; }
        if (H.impact) { H.impact({ style: "LIGHT" }); return true; } return false;
      }
      if (H.impact) { H.impact({ style: "LIGHT" }); return true; }
      return false;
    } catch (e) { return false; }
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function dismiss(done) { if (done) remember(); if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; }

  function startScanning() {
    dismiss(true);
    try {
      var doc = G.document; if (!doc || !doc.querySelector) return;
      var tabBtn = doc.querySelector('[data-act="ktab"][data-t="echo"]');
      if (tabBtn && tabBtn.click) tabBtn.click();
      var go = function () {
        try {
          var K = G.KARDIA;
          if (K && K._kardia && K._kardia.echoLab && K._kardia.echoLab.setView) K._kardia.echoLab.setView("tte_plax");
        } catch (e) {}
      };
      if (typeof G.setTimeout === "function") G.setTimeout(go, 60); else go();
    } catch (e) {}
  }

  function render() {
    if (!overlay) return;
    var c = CARDS[step], last = step === CARDS.length - 1;
    overlay.innerHTML =
      '<div class="krd-onb-card" role="dialog" aria-modal="false" aria-labelledby="krdOnbTitle">' +
      '<p class="krd-onb-step" role="status">Step ' + (step + 1) + " of " + CARDS.length + "</p>" +
      '<h2 id="krdOnbTitle">' + esc(c.title) + "</h2>" +
      '<p class="krd-onb-body">' + esc(c.body) + "</p>" +
      '<div class="krd-onb-dots" aria-hidden="true">' + CARDS.map(function (_, i) { return '<span class="krd-onb-dot' + (i === step ? " on" : "") + '"></span>'; }).join("") + "</div>" +
      '<div class="krd-onb-row">' +
      '<button type="button" class="sp-btn sec" data-onb="skip">Skip</button>' +
      (step > 0 ? '<button type="button" class="sp-btn sec" data-onb="back">Back</button>' : "") +
      (last ? '<button type="button" class="sp-btn pri" data-onb="start">Start scanning</button>'
            : '<button type="button" class="sp-btn pri" data-onb="next">Next</button>') +
      "</div>" +
      (last ? '<p class="krd-onb-note">You can open the guide again any time from the tutorial button in Scan Lab.</p>' : "") +
      "</div>";
    var btns = overlay.querySelectorAll ? overlay.querySelectorAll("[data-onb]") : [];
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-onb");
        if (a === "skip") dismiss(true);
        else if (a === "start") startScanning();
        else if (a === "back") { if (step > 0) step--; haptic("selection"); render(); }
        else { if (step < CARDS.length - 1) step++; haptic("selection"); render(); }
      });
    });
    var first = overlay.querySelector ? overlay.querySelector('[data-onb="next"], [data-onb="start"]') : null;
    if (first && first.focus) { try { first.focus(); } catch (e) {} }
  }

  function show(root) {
    try {
      var doc = G.document; if (!doc || !doc.createElement) return false;
      if (overlay) return true;
      rootEl = root || doc.querySelector(".krd-root") || doc.getElementById("smdKardia") || doc.body;
      if (!rootEl || !rootEl.appendChild) return false;
      step = 0;
      overlay = doc.createElement("div");
      overlay.className = "krd-onb"; overlay.id = "krdOnboarding";
      rootEl.appendChild(overlay);
      render();
      return true;
    } catch (e) { overlay = null; return false; }
  }

  /* Offline banner: one line, one action. Repaints wipe injected nodes,
   * so onTab re-runs this after every host paint. */
  function refreshOffline(root) {
    try {
      var doc = G.document; if (!doc || !doc.createElement) return;
      var host = root || doc.querySelector(".krd-root"); if (!host) return;
      var off = !!(G.navigator && G.navigator.onLine === false);
      var old = doc.getElementById ? doc.getElementById("krdOffline") : null;
      if (!off) { if (old && old.parentNode) old.parentNode.removeChild(old); return; }
      if (old) return;
      var bar = doc.createElement("div");
      bar.className = "krd-offline"; bar.id = "krdOffline"; bar.setAttribute("role", "alert");
      bar.innerHTML = '<span>You are offline. Saved lessons still open. New clips and atlas pictures need a connection.</span>' +
        '<button type="button" class="sp-btn sec" data-offline-retry>Try again</button>';
      if (host.firstChild) host.insertBefore(bar, host.firstChild); else host.appendChild(bar);
      var b = bar.querySelector ? bar.querySelector("[data-offline-retry]") : null;
      if (b) b.addEventListener("click", function () { refreshOffline(host); });
    } catch (e) {}
  }

  function onTab() { refreshOffline(rootEl); if (shouldShow()) show(rootEl); }

  function init() {
    try {
      var doc = G.document; if (!doc) return;
      if (typeof G.addEventListener === "function") {
        G.addEventListener("offline", function () { refreshOffline(rootEl); });
        G.addEventListener("online", function () { refreshOffline(rootEl); });
      }
      var root = doc.querySelector ? (doc.querySelector(".krd-root") || doc.getElementById("smdKardia")) : null;
      if (root) { rootEl = root; onTab(); return; }
      if (typeof G.MutationObserver === "function" && doc.body) {
        var mo = new G.MutationObserver(function () {
          var r = doc.querySelector ? (doc.querySelector(".krd-root") || doc.getElementById("smdKardia")) : null;
          if (r) { rootEl = r; mo.disconnect(); onTab(); }
        });
        mo.observe(doc.body, { childList: true, subtree: true });
      }
    } catch (e) {}
  }

  G.KARDIA_PREMIUM = {
    KEY: KEY, CARDS: CARDS, shouldShow: shouldShow, remember: remember,
    haptic: haptic, show: show, dismiss: dismiss, startScanning: startScanning,
    refreshOffline: refreshOffline, onTab: onTab,
    get step() { return step; }, get showing() { return !!overlay; }
  };
  if (G.document && (G.document.readyState === "complete" || G.document.readyState === "interactive")) init();
  else if (G.document && G.document.addEventListener) G.document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : this);
