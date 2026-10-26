/* kardia-unbrand.js - loaded at the end of kardia/probelab/index.html.
 * Shows only the Probe Lab product inside Kardia: hides the EchoSuite site
 * header (logo, wordmark, site nav, theme and About buttons) and About
 * sheet, and renames any visible "EchoSuite" text to Kardia. The author's
 * credit stays on the Kardia credits screen. */
(function () {
  "use strict";
  var css = ".site-header,.skip-link,#site-info,dialog#site-info,.site-info,[aria-labelledby=site-info-title],noscript{display:none!important}" +
    "main{height:100dvh!important;max-height:100dvh!important}body{margin:0}";
  var st = document.createElement("style"); st.id = "kardiaUnbrand"; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  document.title = "Kardia Probe Lab";
  function fix(node) {
    if (node.nodeType === 3) { if (node.nodeValue.indexOf("EchoSuite") >= 0) node.nodeValue = node.nodeValue.replace(/EchoSuite/g, "Kardia"); return; }
    if (node.nodeType !== 1) return;
    ["aria-label", "title", "alt"].forEach(function (a) { var v = node.getAttribute && node.getAttribute(a); if (v && v.indexOf("EchoSuite") >= 0) node.setAttribute(a, v.replace(/EchoSuite/g, "Kardia")); });
    for (var c = node.firstChild; c; c = c.nextSibling) fix(c);
  }
  fix(document.body);
  new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === "characterData") fix(m.target); else m.addedNodes.forEach(fix); }); })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
})();
