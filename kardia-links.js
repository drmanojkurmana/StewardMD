/* Kardia stable deep links: one link per view, calculator, lesson and case.
   ES5 IIFE, no DOM except the clipboard. Content status ai_drafted.
   A link is stewardmd://kardia/<kind>/<id>, for example
   stewardmd://kardia/calc/lv-ef. The app router (native-bridge.js parses
   the URL, home.js SMD_openRoute forwards it, kardia.js openDeep opens it)
   lands on that exact item, with the same Pro lock as a tap.
   Pure helpers are exported under node for tests. */
(function (G) {
  "use strict";
  var KINDS = ["view", "calc", "lesson", "case"];
  var ID_RE = /^[A-Za-z0-9_.\-]{1,64}$/;
  var LINK_RE = /^stewardmd:\/\/kardia\/([A-Za-z]+)\/([A-Za-z0-9_.\-]{1,64})(?:[/?#].*)?$/;

  function isKind(k) { return KINDS.indexOf(k) >= 0; }

  /* Build the stable link for one item. Returns "" for a bad kind or id. */
  function link(kind, id) {
    kind = String(kind == null ? "" : kind).toLowerCase();
    id = String(id == null ? "" : id);
    if (!isKind(kind) || !ID_RE.test(id)) return "";
    return "stewardmd://kardia/" + kind + "/" + id;
  }

  /* Parse a pasted or tapped link. Returns {kind, id} or null. */
  function parse(url) {
    var m = LINK_RE.exec(String(url == null ? "" : url).trim());
    if (!m) return null;
    var kind = m[1].toLowerCase();
    if (!isKind(kind)) return null;
    return { kind: kind, id: m[2] };
  }

  /* Copy text to the clipboard. say(msg) shows the toast. On failure the
     toast carries the link itself, so it can still be copied by hand.
     Follows the caseshare.js copy shape. */
  function copy(text, say) {
    function done(msg) { try { if (say) say(msg); } catch (e) {} }
    text = String(text == null ? "" : text);
    if (!text) { done("Nothing to copy."); return; }
    try {
      var nav = G.navigator || (typeof navigator !== "undefined" ? navigator : null);
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(text).then(function () { done("Link copied."); }, function () { done(text); });
        return;
      }
    } catch (e) {}
    try {
      var ta = (G.document || document).createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      (G.document || document).body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = (G.document || document).execCommand("copy"); } catch (e) { ok = false; }
      try { ta.parentNode.removeChild(ta); } catch (e) {}
      done(ok ? "Link copied." : text);
      return;
    } catch (e) {}
    done(text);
  }

  var API = { KINDS: KINDS, link: link, parse: parse, copy: copy };
  if (G) G.KARDIA_LINKS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
