/* StewardMD — one calm design for empty and error placeholders (empty-states.js).
 *
 * ~500 places across ~60 modules show "nothing here" / "could not load" with their own classes
 * (w-empty, pn-empty, icu-empty, q-empty, db-empty, ghis-empty, pn-err, ...), each styled differently.
 * This marks the SIMPLE ones with data-smd-empty="empty|error" and refined.css gives them one look: a
 * soft icon circle, centred 14px text, generous air, a gentle fade-in. Part of the Refined clinical look
 * (needs html.smd-refined; inner screens only, never #homeV2).
 *
 * "Simple" = short text (6-160 chars), at most 3 child elements, no inputs/selects, a block wide enough to
 * be a placeholder (>= 180px), not in a table or a horizontal row. Anything with its own buttons or rich
 * structure is left exactly as the module drew it. An element that already has an icon keeps it
 * (data-smd-empty-icon) and only gets the calm typography and spacing.
 * Kill switch: smd_refined=0 (the class), or localStorage smd_empty_states=0. */
(function () {
  "use strict";
  var EMPTY = /(^|[-_])(empty|nodata|no-data|none)\d*$/i, ERR = /(^|[-_])(err|error|failed|offline)\d*$/i;
  // Classify by the element's own classes: "empty" | "error" | null.
  function kindOf(classes) {
    var list = String(classes || "").split(/\s+/), kind = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i]; if (!c) continue;
      if (ERR.test(c)) return "error";
      if (EMPTY.test(c)) kind = "empty";
    }
    return kind;
  }
  function simpleText(t) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length >= 6 && t.length <= 160; }
  var seam = { kindOf: kindOf, simpleText: simpleText };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_empty_states") === "0") return; } catch (e) {}
  window.SMD_EMPTY_SEAM = seam;

  var ICON = "svg,img,.material-symbols-outlined,.rds-icon,[class*='-ic'],[class*='icon']";
  var pending = [], raf = 0;

  function inHome(el) { var h = document.getElementById("homeV2"); return !!(h && h.contains(el)); }
  function mark(el) {
    if (el.hasAttribute("data-smd-empty")) return;
    var kind = kindOf(el.getAttribute("class")); if (!kind) return;
    if (!simpleText(el.textContent) || el.children.length > 3) return;
    if (el.querySelector("input,select,textarea,button,a[href]")) return;
    if (el.closest("table,thead,tbody,tr,td,th,button,a,[role=button],[data-no-empty]") || inHome(el)) return;
    var cs = getComputedStyle(el);
    if (cs.display.indexOf("inline") === 0 || cs.position === "absolute" || cs.position === "fixed") return;
    var r = el.getBoundingClientRect(); if (r.width < 180) return;
    var par = el.parentElement && getComputedStyle(el.parentElement);
    if (par && par.display.indexOf("flex") >= 0 && par.flexDirection.indexOf("row") === 0) return;
    el.setAttribute("data-smd-empty", kind);
    if (el.querySelector(ICON)) el.setAttribute("data-smd-empty-icon", "1");
    if (kind === "error" && !el.hasAttribute("role")) el.setAttribute("role", "alert");
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute("class")) mark(root);
    var c = root.querySelectorAll("[class*='empty'],[class*='-err'],[class*='nodata'],[class*='offline'],[class*='failed']");
    for (var i = 0; i < c.length && i < 120; i++) mark(c[i]);
  }
  function flush() {
    raf = 0;
    if (!document.documentElement.classList.contains("smd-refined")) { pending = []; return; }
    var l = pending; pending = [];
    for (var i = 0; i < l.length; i++) { if (l[i].isConnected) { try { scan(l[i]); } catch (e) {} } }
  }
  function queue(n) { if (n && n.nodeType === 1) pending.push(n); if (!raf) raf = requestAnimationFrame(flush); }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var a = muts[i].addedNodes;
      for (var j = 0; j < a.length; j++) queue(a[j]);
      if (muts[i].type === "characterData" && muts[i].target.parentElement) queue(muts[i].target.parentElement);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Panels that were hidden when their placeholder was inserted (width 0) are picked up here once shown.
  setInterval(function () {
    if (document.visibilityState === "hidden" || !document.documentElement.classList.contains("smd-refined")) return;
    var c = document.querySelectorAll("body > :not(#homeV2) [class*='empty']:not([data-smd-empty]), body > :not(#homeV2) [class*='-err']:not([data-smd-empty])");
    for (var i = 0; i < c.length && i < 60; i++) if (c[i].getClientRects().length) mark(c[i]);
  }, 2500);
  function start() { queue(document.body); }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
