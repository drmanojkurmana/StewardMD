/* kardia-unbrand.js - loaded at the end of kardia/probelab/index.html.
 * Shows only the Probe Lab product inside Kardia: hides the EchoSuite site
 * header (logo, wordmark, site nav, theme and About buttons) and About
 * sheet, and renames any visible "EchoSuite" text to Kardia. The author's
 * credit stays on the Kardia credits screen. */
(function () {
  "use strict";
  var css = ".site-header,.skip-link,#site-info,dialog#site-info,.site-info,[aria-labelledby=site-info-title],noscript{display:none!important}" +
    "main{height:100dvh!important;max-height:100dvh!important}body{margin:0}" +
    "@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-variable.woff2) format('woff2')}" +
    "@media (max-width:699px){" +
      ".lab{display:grid!important;grid-template-columns:1fr!important;grid-template-rows:minmax(0,1fr) minmax(0,1.15fr)!important;height:100dvh!important;gap:6px!important;padding:6px!important;box-sizing:border-box}" +
      ".stage{height:auto!important;min-height:0!important}" +
      ".scan-column{display:flex!important;flex-direction:column!important;min-height:0!important;gap:6px!important;overflow:hidden}" +
      ".monitor{min-height:0!important;flex:1 1 auto!important;display:flex!important;flex-direction:column!important;padding:8px!important}" +
      ".view-guide{font-size:12.5px!important;line-height:1.3!important;margin:0!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      "#sim-image,#cine{flex:1 1 auto!important;min-height:0!important}#slice{height:100%!important;flex:1 1 auto!important}" +
      ".views{flex:0 0 auto!important;padding:6px 8px!important;gap:6px!important}.views p,.views .view-note{display:none!important}" +
      ".view-buttons button{min-height:44px!important;padding:6px!important}" +
    "}" +
    "*:not(math):not([class*=math]){font-family:'Inter Variable',-apple-system,system-ui,sans-serif!important}";
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
