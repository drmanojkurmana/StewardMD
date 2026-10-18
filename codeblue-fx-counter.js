/* Adapted from React Bits (reactbits.dev) by David Haz, MIT + Commons Clause, see docs/codeblue/third-party/react-bits-LICENSE.md */
/* codeblue-fx-counter.js: rolling-digit counter (Counter behaviour, reduced).
 * Odometer digits roll vertically on change, tabular. No React, no motion
 * library. Reduced motion (CodeBluePrefs switch via #cblRoot.cbl-reduced /
 * [data-cb-motion=reduced], or prefers-reduced-motion) swaps instantly.
 * The live screen replaces its clock node on repaint, so the last value is
 * remembered here and a fresh node rolls from it. ES5, global IIFE.
 * API: window.CodeBlueFX.counter.enhance(el), .setValue(el, text), .enhanceAll(root) */
(function () {
  "use strict";
  window.CodeBlueFX = window.CodeBlueFX || {};
  var lastByKey = {};
  function reduced(el) {
    try {
      var r = el && el.closest ? el.closest("#cblRoot") : null;
      if (r && (r.classList.contains("cbl-reduced") || r.getAttribute("data-cb-motion") === "reduced")) return true;
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }
  function keyOf(el) { return el.getAttribute("data-cbfx-key") || "clock"; }
  function stripsOf(el) { return el.querySelectorAll ? el.querySelectorAll(".cbfx-strip") : []; }
  function roll(el, fromText, toText) {
    var strips = stripsOf(el), digits = String(toText).replace(/[^0-9]/g, "");
    var fromDigits = String(fromText || "").replace(/[^0-9]/g, ""), instant = reduced(el);
    for (var i = 0; i < strips.length && i < digits.length; i++) {
      var to = digits.charCodeAt(i) - 48;
      var from = (i < fromDigits.length) ? fromDigits.charCodeAt(i) - 48 : to;
      if (instant || from === to) { strips[i].style.transition = "none"; strips[i].style.transform = "translateY(-" + to + "em)"; }
      else {
        strips[i].style.transition = "none"; strips[i].style.transform = "translateY(-" + from + "em)";
        void strips[i].offsetHeight; strips[i].style.transition = ""; strips[i].style.transform = "translateY(-" + to + "em)";
      }
    }
    el.setAttribute("data-cbfx-value", toText); lastByKey[keyOf(el)] = toText;
  }
  function build(el, text) {
    var prev = lastByKey[keyOf(el)] || text;
    el.innerHTML = ""; el.classList.add("cbfx-counter");
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch >= "0" && ch <= "9") {
        var win = document.createElement("span"); win.className = "cbfx-digit";
        var strip = document.createElement("span"); strip.className = "cbfx-strip";
        for (var d = 0; d <= 9; d++) { var n = document.createElement("span"); n.className = "cbfx-num"; n.textContent = String(d); strip.appendChild(n); }
        strip.style.transform = "translateY(-" + (ch.charCodeAt(0) - 48) + "em)";
        win.appendChild(strip); el.appendChild(win);
      } else { var s = document.createElement("span"); s.className = "cbfx-sep"; s.textContent = ch; el.appendChild(s); }
    }
    el.setAttribute("aria-label", text); el.setAttribute("data-cbfx-value", text);
    if (prev !== text) roll(el, prev, text); else lastByKey[keyOf(el)] = text;
  }
  function enhance(el) {
    if (!el) return;
    var text = (el.getAttribute("data-cbfx-text") || el.textContent || "").replace(/\s+/g, "");
    if (!text) return;
    if (!stripsOf(el).length) { build(el, text); return; }
    if (el.getAttribute("data-cbfx-value") !== text) roll(el, el.getAttribute("data-cbfx-value"), text);
  }
  function setValue(el, text) {
    if (!el) return;
    text = String(text || "");
    if (!stripsOf(el).length) { build(el, text); return; }
    roll(el, el.getAttribute("data-cbfx-value"), text);
    el.setAttribute("aria-label", text);
  }
  function enhanceAll(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll("[data-cbfx-counter]");
    for (var i = 0; i < els.length; i++) enhance(els[i]);
  }
  window.CodeBlueFX.counter = { enhance: enhance, setValue: setValue, enhanceAll: enhanceAll, _reduced: reduced };
})();
