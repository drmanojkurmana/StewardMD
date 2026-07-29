/* StewardMD — app-wide selection/copy guard.
 * ---------------------------------------------------------------------------
 * Makes the app feel like a native app, not a web page: users can't manually
 * select text, long-press to copy, drag text out, or right-click the "copy /
 * inspect" menu. This raises the bar for casual copying/scraping of clinical
 * content. (It is NOT real DRM — devtools/view-source still exist; the true
 * anti-copy story is the deferred marketing-only-web split.)
 *
 * Deliberately DOES NOT block the `copy`/`cut` events, so the app's own
 * programmatic "Copy link" buttons (clipboard API / execCommand) keep working —
 * users simply can't originate a manual selection to copy from.
 *
 * Exceptions (stay fully selectable/editable): form fields
 * (input/textarea/select/[contenteditable]) so typing/editing works, plus any
 * element the app explicitly opts in with class="smd-selectable".
 *
 * Loaded very early from index.html so the rule applies before content paints.
 */
(function () {
  "use strict";
  try {
    var css =
      "html{-webkit-touch-callout:none}" +
      "body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}" +
      "input,textarea,select,[contenteditable],[contenteditable] *,.smd-selectable,.smd-selectable *{" +
      "-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;user-select:text;-webkit-touch-callout:default}";
    var s = document.createElement("style");
    s.id = "smd-no-select";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}

  // Belt-and-suspenders: block the gestures/menus that start a selection or expose a copy/inspect
  // menu — but only outside editable/opted-in regions. Capture phase so it wins over page handlers.
  function allowSel(t) {
    try { return !!(t && t.closest && t.closest("input,textarea,select,[contenteditable],.smd-selectable")); }
    catch (e) { return false; }
  }
  ["contextmenu", "selectstart", "dragstart"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (allowSel(e.target)) return;
      try { e.preventDefault(); } catch (x) {}
    }, true);
  });
})();
