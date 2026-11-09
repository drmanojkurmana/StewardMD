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
  var seam = { isPlaceholderText: isPlaceholderText };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_skeletons") === "0") return; } catch (e) {}
  window.SMD_SKEL_SEAM = seam;

  var HOST = "smd-skel-host", LD_SRC = "smd-skel-ldsrc";
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
    if (!el || el.nodeType !== 1 || el.classList.contains(HOST) || el.classList.contains(LD_SRC)) return false;
    if (el.closest("button,a,option,select,label,input,textarea,[role=button],[class*='skel'],[data-no-skel]")) return false;
    if (el.children.length > 2 || !isPlaceholderText(el.textContent)) return false;
    var cs = getComputedStyle(el);
    if (cs.display.indexOf("inline") === 0 || cs.position === "fixed") return false;
    return el.getBoundingClientRect().width >= 160;
  }
  // A placeholder alone on its screen gets the 3D loader and a fact instead of rows; everything else keeps the rows.
  function aloneOnScreen(el) {
    var own = el.textContent.replace(/\s+/g, "").length, r = el, p;
    while ((p = r.parentElement) && p !== document.body) {
      var t = p.textContent;
      if (t.length > 3000 || t.replace(/\s+/g, "").length - own > 160) break;
      r = p;
    }
    return r.getBoundingClientRect().height >= 280;
  }
  function mark(el) {
    var ld = null;
    if (window.SMD_LOADER && aloneOnScreen(el)) {
      var box = document.createElement("div"); box.innerHTML = window.SMD_LOADER.html();
      ld = el.parentNode.insertBefore(box.firstChild, el.nextSibling);
    }
    el.classList.add(ld ? LD_SRC : HOST); el.setAttribute("aria-busy", "true");
    hosts.push({ el: el, parent: el.parentElement, ld: ld });
  }
  function dropLoader(h) { if (h.ld && h.ld.parentNode) h.ld.parentNode.removeChild(h.ld); }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    var tc = root.textContent; if (!tc || tc.length > 4000 || !/load|fetch|sync|prepar/i.test(tc)) return;
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
      } else if (!isPlaceholderText(h.el.textContent)) {
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
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
