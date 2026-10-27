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
      /* iPhone: the first screen is two equal halves, the 3D probe on top
       * and the echo below (--kav is the visible height, set by kardia.js
       * fitProbeFrame). The view toolkit and controls follow below; the
       * Kardia page scrolls to them. No guide text (owner 2026-10-27). */
      "html,body{height:auto!important;overflow:hidden!important}" +
      "main{height:auto!important;max-height:none!important;overflow:visible!important;padding:8px!important}" +
      ".lab{display:flex!important;flex-direction:column!important;height:auto!important;gap:8px!important;padding:0!important;box-sizing:border-box}" +
      ".stage{flex:0 0 auto!important;height:calc(var(--kav,100vh) / 2 - 4px)!important;min-height:0!important}" +
      ".scan-column{display:flex!important;flex-direction:column!important;gap:8px!important;overflow:visible!important;min-height:0!important}" +
      ".monitor{position:relative!important;flex:0 0 auto!important;height:calc(var(--kav,100vh) / 2 - 4px)!important;min-height:0!important;padding:0!important;overflow:hidden!important;display:block!important}" +
      ".monitor-top{position:absolute!important;top:8px;right:8px;z-index:3;margin:0!important;padding:0!important;background:none!important}" +
      "#view-guide{display:none!important}" +
      "#sim-image,#cine{height:100%!important;min-height:0!important;width:100%!important}#slice{height:100%!important;width:100%!important}" +
      ".views{flex:0 0 auto!important;padding:8px!important;gap:8px!important}" +
      ".view-buttons button{min-height:52px!important;padding:8px!important}" +
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
