/* StewardMD — skeleton loaders and content fade-in (skeletons.js).
 *
 * About 70 screens show a plain "Loading…" line while they fetch. This turns every such placeholder
 * (a block whose whole text is "Loading…", "Loading ward patients…", "Fetching…", "Syncing…") into
 * list-shaped skeleton rows (avatar + two lines) with a soft shimmer, and when the real content
 * replaces it, the content fades up into place instead of popping in.
 *
 * Zero markup change: the skeleton is painted with CSS backgrounds on the placeholder itself and its
 * text is only made transparent, so screen readers still announce "Loading…" and any module code that
 * replaces or reads the element behaves exactly as before. Existing hand-made skeletons (q-skel,
 * oh-skel...) are left alone. Kill switch: localStorage smd_skeletons=0. */
(function () {
  "use strict";
  var RX = /^(loading|fetching|syncing|preparing)\b[^]{0,50}?(…|\.\.\.|\.|&hellip;)?$/i;
  function isPlaceholderText(t) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length >= 7 && t.length <= 60 && RX.test(t); }
  // Wider wording, only ever used for a placeholder alone on its screen. Needs an ellipsis so titles like "Getting started" stay.
  var WIDE = /^(?:(?:building|generating|opening|starting|connecting|getting|analy[sz]ing|creating|setting up|checking|waking|warming)\b[^]{0,50}?(?:…|\.\.\.)|(?:please wait|one moment|just a moment)\b[^]{0,40})$/i;
  function isWideText(t) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length >= 7 && t.length <= 60 && WIDE.test(t); }
  var seam = { isPlaceholderText: isPlaceholderText, isWideText: isWideText };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_skeletons") === "0") return; } catch (e) {}
  window.SMD_SKEL_SEAM = seam;

  var HOST = "smd-skel-host", LD_SRC = "smd-ld-src";
  var css =
    "." + HOST + "{--sk:rgba(120,130,140,.16);--sh:rgba(255,255,255,.55);color:transparent!important;text-shadow:none!important;" +
    "min-height:144px;border-radius:12px;position:relative;overflow:hidden;" +
    "background:" +
    "linear-gradient(100deg,transparent 20%,var(--sh) 50%,transparent 80%) -150% 0/50% 100% no-repeat," +
    "radial-gradient(circle 18px at 18px 18px,var(--sk) 97%,transparent 100%) 4px 14px/40px 72px repeat-y," +
    "linear-gradient(var(--sk) 0 11px,transparent 11px) 56px 18px/58% 72px repeat-y," +
    "linear-gradient(var(--sk) 0 9px,transparent 9px) 56px 38px/34% 72px repeat-y!important;" +
    "animation:smdSkel 1.3s cubic-bezier(.4,0,.2,1) infinite}" +
    "." + HOST + " *{visibility:hidden}" +
    "body.dark ." + HOST + ",body.v3-dark ." + HOST + "{--sk:rgba(255,255,255,.08);--sh:rgba(255,255,255,.07)}" +
    "@media (prefers-color-scheme:dark){html:not([data-theme=light]) body:not(.light) ." + HOST + "{--sk:rgba(255,255,255,.08);--sh:rgba(255,255,255,.07)}}" +
    "@keyframes smdSkel{to{background-position:250% 0,4px 14px,56px 18px,56px 38px}}" +
    "." + LD_SRC + "{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)}" +
    "@media (prefers-reduced-motion:reduce){." + HOST + "{animation:none}}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var hosts = [];
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function eligible(el) {
    if (!el || el.nodeType !== 1 || el.classList.contains(HOST) || el.closest("." + LD_SRC)) return false;
    if (el.closest("button,a,option,select,label,input,textarea,[role=button],[class*='skel'],[data-no-skel]")) return false;
    var wide = !isPlaceholderText(el.textContent);
    if (el.children.length > 2 || (wide && !isWideText(el.textContent))) return false;
    var cs = getComputedStyle(el);
    if (cs.display.indexOf("inline") === 0 || cs.position === "fixed") return false;
    // A value beside its label in a row ("Hospital  Loading…" on the Profile page) is a field, not a placeholder
    // block: no skeleton rows and no loader there (owner 2026-11-11: hearts appeared inside Settings > Profile).
    if (isFieldValue(el)) return false;
    if (el.getBoundingClientRect().width < 160) return false;
    return !wide || (!!window.SMD_LOADER && aloneOnScreen(el));
  }
  function isFieldValue(el) {
    var par = el.parentElement; if (!par) return false;
    var pcs = getComputedStyle(par);
    if (pcs.display.indexOf("flex") < 0 && pcs.display.indexOf("grid") < 0) return false;
    if (pcs.display.indexOf("flex") >= 0 && pcs.flexDirection.indexOf("column") === 0) return false;
    return par.textContent.replace(/\s+/g, "").length - el.textContent.replace(/\s+/g, "").length > 0;
  }
  // A placeholder alone on its screen gets the full-screen loader and a fact instead of rows; everything else keeps
  // the rows. A screen holding SEVERAL placeholders is a form still filling in (Profile, a settings page), never an
  // empty screen, so it never gets the loader.
  function aloneOnScreen(el) {
    var own = el.textContent.replace(/\s+/g, "").length, r = el, p;
    while ((p = r.parentElement) && p !== document.body) {
      var t = p.textContent;
      if (t.length > 3000 || t.replace(/\s+/g, "").length - own > 160) break;
      r = p;
    }
    if (r !== el && morePlaceholders(r, el)) return false;
    return r.getBoundingClientRect().height >= 280;
  }
  function morePlaceholders(root, el) {
    var all = root.getElementsByTagName("*"), n = 0;
    for (var i = 0; i < all.length && i < 300; i++) {
      var x = all[i]; if (x === el || x.contains(el) || el.contains(x) || x.children.length) continue;
      if (isPlaceholderText(x.textContent) && ++n >= 1) return true;
    }
    return false;
  }
  function mark(el) {
    var ld = null;
    if (window.SMD_LOADER && aloneOnScreen(el)) {
      ld = addLoader(el);
    }
    el.classList.add(ld ? LD_SRC : HOST); el.setAttribute("aria-busy", "true");
    hosts.push({ el: el, parent: el.parentElement, ld: ld });
  }
  function addLoader(el) {
    var box = document.createElement("div"); box.innerHTML = window.SMD_LOADER.html();
    return el.parentNode.insertBefore(box.firstChild, el.nextSibling);
  }
  // Hand-built skeletons and bare spinners that are alone on their screen get the loader too.
  var BUSY = '[class*="skel"],[class*="shimmer"],[class*="-spin"],[class*="spinner"],[class*="-loading"],.oph-load,.ex-load,.kel-load';
  var REAL = "img,video,canvas,input,textarea,select,button,a,iframe,[role=button]";
  function quiet(el) {
    var t = el.textContent;
    if (t.length > 600 || el.querySelector(REAL) || el.matches(REAL)) return false;
    return !t.trim() || isPlaceholderText(t) || isWideText(t);
  }
  function floating(el) { var p = getComputedStyle(el).position; return p === "fixed" || p === "absolute"; }
  function scanBusy(root) {
    if (!window.SMD_LOADER || (root.textContent || "").length > 1200) return;
    var list = root.querySelectorAll(BUSY), all = root.matches(BUSY) ? [root] : [], i;
    for (i = 0; i < list.length && i < 60; i++) all.push(list[i]);
    for (i = 0; i < all.length; i++) {
      var b = all[i], p;
      if (!b.isConnected || !b.getClientRects().length || !quiet(b) || b.closest("[data-no-skel],.smd-ld-cover,#smdBootSplash,." + LD_SRC + ",." + HOST)) continue;
      while ((p = b.parentElement) && p !== document.body && quiet(p) && !floating(p)) b = p;
      if (floating(b) || getComputedStyle(b).display.indexOf("inline") === 0 || b.getBoundingClientRect().width < 160 || !aloneOnScreen(b)) continue;
      var ld = addLoader(b);
      b.classList.add(LD_SRC); b.setAttribute("aria-busy", "true");
      hosts.push({ el: b, parent: b.parentElement, ld: ld, busy: true });
    }
  }
  function dropLoader(h) { if (h.ld && h.ld.parentNode) h.ld.parentNode.removeChild(h.ld); }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    scanBusy(root);
    var tc = root.textContent; if (!tc || tc.length > 4000 || !/load|fetch|sync|prepar|build|generat|open|start|connect|get|analy|creat|setting|check|wak|warm|wait|moment/i.test(tc)) return;
    if (eligible(root)) { mark(root); return; }
    var all = root.getElementsByTagName("*");
    for (var i = 0; i < all.length && i < 400; i++) if (eligible(all[i])) mark(all[i]);
  }
  function fadeIn(el) {
    if (reduced() || !el.animate || el.nodeType !== 1) return;
    try { el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(0,0,.2,1)" }); } catch (e) {}
  }

  var mo = new MutationObserver(function (muts) {
    var touched = [];
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
      if (m.type === "characterData" && m.target.parentElement) scan(m.target.parentElement);
    }
    // Resolve hosts: gone (replaced) -> fade in whatever now fills its parent; text changed in place
    // -> unmark and fade the element itself.
    for (var k = hosts.length - 1; k >= 0; k--) {
      var h = hosts[k];
      if (!h.el.isConnected) {
        hosts.splice(k, 1);
        dropLoader(h);
        if (h.parent && h.parent.isConnected && touched.indexOf(h.parent) < 0) touched.push(h.parent);
      } else if (h.busy ? (!h.el.getClientRects().length || !(h.el.matches(BUSY) || h.el.querySelector(BUSY))) : !(isPlaceholderText(h.el.textContent) || isWideText(h.el.textContent))) {
        hosts.splice(k, 1);
        dropLoader(h);
        h.el.classList.remove(HOST, LD_SRC); h.el.removeAttribute("aria-busy");
        fadeIn(h.el);
      }
    }
    for (var t = 0; t < touched.length; t++) {
      var kids = touched[t].children;
      for (var c = 0; c < kids.length && c < 30; c++) fadeIn(kids[c]);
    }
  });
  function start() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
