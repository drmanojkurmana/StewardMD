/* MaiK AI mark: the icon on every "Ask MaiK" button, chip and entry point. window.SMD_MAIK_MARK. ES5.
   The artwork lives in ONE file, /assets/maik-ai-mark.svg (mkai-full with the teal "AI", mkai-mark without it for
   small sizes, mkai-tile on the dark teal app-icon tile, mkai-tile-mark the tile without "AI"). This helper injects that file once as a
   hidden inline sprite and hands out <svg><use href="#mkai-..."/></svg> markup, so replacing the SVG file replaces the
   icon everywhere. It is NOT used for the MaiK logo inside the main MaiK assistant, nor for the MaiKnowledge footer
   logo; those stay as they are (owner, 2026-10-09). vault/modules/MaiK.md, "MaiK AI mark".

   html(variant, opts) -> markup. variant: "auto" (default: "mark" under 28 px, else "full"), "full", "mark", "tile"
   (under 40 px it becomes "tile-mark", the tile without "AI", which is unreadable that small).
   opts: { size: px (default 20), cls: extra class names, color: CSS colour for the mark (default currentColor),
   title: accessible name (default none: decorative) }.
   The M and the star use currentColor, the "AI" uses --mkai-accent (default #2fb3a6), the tile has fixed colours.

   The "MaiK" wordmark (owner, 2026-10-10): in every "Ask MaiK" label the word MaiK is drawn in the lettering of the
   owner's MaiK AI artwork (symbol mkai-word); "Ask" and the rest stay in the app's font.
   label(text) -> text with each standalone "MaiK" (not "MaiKnowledge") as word(); text must already be HTML-safe.
   The result is one inline span, so a flex button still sees one label. word() -> the wordmark: an svg sized in em
   (cap height 0.71 em, baseline on the text baseline) plus the real text "MaiK", visually hidden once the sprite is
   in, so screen readers, find and copy still get "Ask MaiK". Until the sprite loads (or if it never does) the text
   shows and the svg is hidden: never an empty gap. */
(function (G) {
  "use strict";
  var URL = "/assets/maik-ai-mark.svg?v=mkai4", SPRITE_ID = "mkaiSprite", VARIANTS = { full: 1, mark: 1, tile: 1, "tile-mark": 1 };
  function variantFor(v, size) {
    if (v === "tile" && (size || 20) < 40) return "tile-mark";
    if (VARIANTS[v]) return v;
    return (size || 20) < 28 ? "mark" : "full";
  }
  function escAttr(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function html(variant, opts) {
    opts = opts || {};
    var size = +opts.size || 20, v = variantFor(variant, size), title = opts.title ? escAttr(opts.title) : "";
    return '<svg class="mkai mkai-' + v + (opts.cls ? " " + escAttr(opts.cls) : "") + '" viewBox="0 0 100 100" width="' + size + '" height="' + size + '"' +
      (opts.color ? ' style="color:' + escAttr(opts.color) + '"' : "") +
      (title ? ' role="img" aria-label="' + title + '"' : ' aria-hidden="true"') + ' focusable="false"><use href="#mkai-' + v + '"></use></svg>';
  }
  function word() {
    return '<span class="mkai-w"><svg class="mkai-word" aria-hidden="true" focusable="false"><use href="#mkai-word"></use></svg><span class="mkai-wt">MaiK</span></span>';
  }
  function label(text) {
    return '<span class="mkai-l">' + String(text == null ? "" : text).replace(/(^|[^A-Za-z0-9])MaiK(?![A-Za-z0-9])/g, function (m, pre) { return pre + word(); }) + "</span>";
  }
  var PURE = { html: html, variantFor: variantFor, word: word, label: label, URL: URL };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  var D = G.document, loading = null;
  /* ensure() -> Promise<bool>: the sprite is in the document. Kept off-screen at zero size, never display:none
     (a display:none sprite drops its gradients in Chrome). A failed fetch leaves the icons empty, never broken. */
  function ensure() {
    if (D.getElementById(SPRITE_ID)) { ready(); return Promise.resolve(true); }
    if (loading) return loading;
    if (!G.fetch) return Promise.resolve(false);
    loading = G.fetch(URL).then(function (r) { return r.ok ? r.text() : ""; }).then(function (txt) {
      if (D.getElementById(SPRITE_ID)) { ready(); return true; }
      var m = /<svg[\s\S]*<\/svg>/.exec(txt || "");
      if (!m) { loading = null; return false; }
      var box = D.createElement("div");
      box.innerHTML = m[0];
      var svg = box.querySelector("svg");
      if (!svg) { loading = null; return false; }
      // Only the definitions are needed; the preview <use> at the end of the file is dropped.
      Array.prototype.slice.call(svg.childNodes).forEach(function (n) { if (n.nodeType === 1 && n.tagName.toLowerCase() === "use") svg.removeChild(n); });
      svg.id = SPRITE_ID;
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
      (D.body || D.documentElement).insertBefore(svg, (D.body || D.documentElement).firstChild);
      ready();
      return true;
    }).then(null, function () { loading = null; return false; });
    return loading;
  }
  // The sprite is in: the wordmark shows and its text becomes visually hidden (see word()).
  // The wordmark shows only when the sprite really holds mkai-word; its width follows the symbol's own viewBox.
  function ready() {
    var r = D.documentElement, w = D.getElementById("mkai-word"), vb = w && (w.getAttribute("viewBox") || "").split(/[\s,]+/);
    if (!r || !r.classList) return;
    r.classList.add("mkai-ok");
    if (vb && vb.length === 4 && +vb[2] > 0 && +vb[3] > 0) { r.style.setProperty("--mkai-wr", String(+vb[2] / +vb[3])); r.classList.add("mkai-wok"); }
  }
  // CSS that every variant needs (sizing and the accent token); one small rule set, injected once.
  function css() {
    if (D.getElementById("mkaiCss")) return;
    var s = D.createElement("style"); s.id = "mkaiCss";
    // stroke none: icon rules elsewhere (home badges, search rows) stroke every svg; the mark is filled shapes only.
    s.textContent = ".mkai{display:inline-block;flex:0 0 auto;vertical-align:middle;overflow:visible;stroke:none!important}" +
      ":root{--mkai-accent:#1f9e92}body.dark,body.v3-dark{--mkai-accent:#4fd6c6}" +
      // The wordmark: sized in em with !important, because icon rules elsewhere size every svg inside a button.
      // 0.75 em tall (the symbol's viewBox is fitted to the word, i dot to baseline) puts its cap height near the app
      // font's; the round letters' overshoot sits just under the baseline, hence the small negative vertical-align.
      ".mkai-w{white-space:nowrap}" +
      "svg.mkai-word{display:none;width:calc(.75em * var(--mkai-wr,3.4))!important;height:.75em!important;min-width:0!important;margin:0!important;padding:0!important;vertical-align:-.016em!important;overflow:visible;stroke:none!important;flex:none}" +
      "html.mkai-wok svg.mkai-word{display:inline-block}" +
      "html.mkai-wok .mkai-wt{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}";
    (D.head || D.documentElement).appendChild(s);
  }
  function start() { css(); ensure(); }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();

  G.SMD_MAIK_MARK = { html: html, word: word, label: label, ensure: ensure, variantFor: variantFor, URL: URL };
})(typeof window !== "undefined" ? window : this);
