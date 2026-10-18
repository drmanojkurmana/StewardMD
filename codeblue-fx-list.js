/* Adapted from React Bits (reactbits.dev) by David Haz, MIT + Commons Clause, see docs/codeblue/third-party/react-bits-LICENSE.md */
/* codeblue-fx-list.js: staggered list entry (AnimatedList behaviour, reduced).
 * One short staggered enter for items, newest on top (caller order kept),
 * no scroll hijack, no selection indicator. Reduced motion disables it in CSS.
 * API: window.CodeBlueFX.list.enhance(ul), .enhanceAll(root) */
(function () {
  "use strict";
  window.CodeBlueFX = window.CodeBlueFX || {};
  function enhance(list) {
    if (!list) return;
    list.classList.add("cbfx-list");
    var items = list.children;
    for (var i = 0; i < items.length; i++) items[i].style.setProperty("--cbfx-i", String(Math.min(i, 8)));
  }
  function enhanceAll(root) {
    if (!root || !root.querySelectorAll) return;
    var lists = root.querySelectorAll("[data-cbfx-list]");
    for (var i = 0; i < lists.length; i++) enhance(lists[i]);
  }
  window.CodeBlueFX.list = { enhance: enhance, enhanceAll: enhanceAll };
})();
