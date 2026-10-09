/* High-yield emphasis for KB text.
 * Authoring markup: {{hy:text to emphasise}}. Rendered as bold and underlined (not colour alone).
 * Content is escaped first, so the markup cannot inject HTML.
 * HTML: KBHy.html(text) -> escaped string with <strong class="kb-hy">.
 * Plain: KBHy.plain(text) -> the text with markers removed (search, copy, export).
 */
(function (root) {
  "use strict";

  var HY = /\{\{hy:([^{}]+?)\}\}/g;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function html(text) {
    return esc(text).replace(HY, '<strong class="kb-hy">$1</strong>');
  }

  function plain(text) {
    return String(text).replace(HY, "$1");
  }

  var api = { html: html, plain: plain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KBHy = api;
})(typeof window !== "undefined" ? window : globalThis);

/* Reader CSS (add to kb-protocols.css):
 * .kb-hy { font-weight: 700; text-decoration: underline; text-decoration-thickness: 0.12em;
 *          text-underline-offset: 0.18em; }
 */
