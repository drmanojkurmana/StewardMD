/* kardia-embed.js - loaded before the AngioLAB bundle inside Kardia.
 * Root asset paths are rewritten to this folder before the module runs.
 * Touch rules keep the page from feeling like a site dropped in a frame:
 * no tap flash, no pull-to-refresh, controls are not selectable, and the
 * home indicator does not cover the last row. The top inset stays with
 * the Kardia shell, which already clears the notch. */
(function () {
  "use strict";
  var css = "html{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}" +
    "html,body{overscroll-behavior:none;background:#0b0c0d}" +
    "a{touch-action:manipulation}" +
    "button,[role=button],.ctl-btn,.preset,.seg>button,.hit-area{touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
    "input,textarea,select{font-size:16px}" +
    ".hit-area{min-height:44px;display:inline-flex;align-items:center}" +
    ".app{padding-bottom:env(safe-area-inset-bottom,0px)}";
  var st = document.createElement("style");
  st.id = "kardiaAngioEmbed";
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  if (window.parent !== window) document.documentElement.classList.add("angio-framed");
  function local(url) {
    if (typeof url !== "string" || url.charAt(0) !== "/") return url;
    if (url.indexOf("/anatomy/") === 0) return "anatomy/" + url.slice("/anatomy/".length);
    if (url === "/app-store-badge.svg") return "app-store-badge.svg";
    if (url.indexOf("/_vercel/") === 0) return "vercel-noop.js";
    return url;
  }
  var orig = window.fetch;
  if (typeof orig === "function") {
    window.fetch = function (input, init) {
      if (typeof input === "string") input = local(input);
      return orig.call(this, input, init);
    };
  }
})();
