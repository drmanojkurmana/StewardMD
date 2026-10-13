/* PrepNucleus Pearl cards: Marrow-style teaching layout (style inspiration only; original code and text).
 * A lesson qualifies automatically when any step carries a table, compare, flow or image/figure visual,
 * so bundled lessons convert with no content rewrite. Pearl ID: PN-xxxx, the first four Crockford
 * characters of the lesson's share ID (prep-ids.js: L-XXXX-XXXX-X from SHA-256("prepnucleus:l:"+key)),
 * so a Pearl ID always resolves to the same lesson as its L-ID. Without PREP_IDS, a deterministic
 * Crockford fallback from the lesson key keeps the ID stable offline.
 * Figure credit opens a licence sheet (credit text + link to Menu > Image credits, which lists
 * prep image-credits.json). Footer: Report / Share / Bookmark. Share reuses the PREP_IDS sheet
 * (data-act="id-share"); Bookmark and Report persist through the lesson store bridge in prep-lessons.js.
 * Browser (window.PREP_PEARL) and Node (module.exports). No dependencies. */
(function (root) {
  "use strict";
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (prep-ids.js)
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function hashStr(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  /* PN-XXXX from the lesson share ID when known ("L-4FDN-0V2R-A" -> "PN-4FDN"); else stable fallback. */
  function pearlId(key, shareId) {
    var body = String(shareId || "").replace(/^L-/, "").replace(/-/g, "").toUpperCase();
    if (/^[0-9A-HJKMNP-TV-Z]{4,}$/.test(body)) return "PN-" + body.slice(0, 4);
    var h = hashStr("prepnucleus:l:" + String(key || "")), out = "";
    for (var i = 0; i < 4; i++) { out += ALPHA.charAt(h % 32); h = (h * 33 + 17) >>> 0; }
    return "PN-" + out;
  }
  function isPearl(lesson) {
    if (!lesson || !Array.isArray(lesson.steps)) return false;
    return lesson.steps.some(function (s) { var v = s && s.vis; return !!v && (v.kind === "table" || v.kind === "image" || v.kind === "flow" || v.kind === "compare" || v.kind === "figure"); });
  }
  function humanise(id) { return String(id || "").replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function breadcrumb(lesson, shareId) {
    var topic = humanise(lesson.module || lesson.title || "");
    var subj = humanise(lesson.subject || "");
    return "Pearl #" + pearlId(lesson.module, shareId) + " · " + subj + (topic && topic !== subj ? " · " + topic : "");
  }
  function creditOf(vis) {
    if (!vis) return "StewardMD illustration";
    return vis.credit || vis.attribution || (vis.src && /pearl-/.test(vis.src) ? "StewardMD illustration" : "StewardMD illustration");
  }
  function attributionLink(vis) {
    if (!vis || vis.kind !== "image") return "";
    var label = creditOf(vis);
    return '<button type="button" class="pn-pearl-credit" data-pearl-credit="' + esc(label) + '" data-pearl-src="' + esc(vis.src || "") + '" aria-haspopup="dialog" aria-label="Image attribution and licence">Image Attribution and License (i)</button>';
  }
  function sheetHtml(credit, src) {
    return '<div class="pn-pearl-sheet" role="dialog" aria-modal="true" aria-label="Image attribution and licence">' +
      '<div class="pn-pearl-sheet-c"><h3>Image Attribution and License</h3>' +
      '<p class="pn-pearl-cred">' + esc(credit) + "</p>" +
      (src ? '<p class="pn-pearl-src">' + esc(src) + "</p>" : "") +
      '<p class="pn-pearl-note">Full credits for openly licensed images are listed under Menu &gt; Image credits.</p>' +
      '<div class="pn-pearl-sheet-b"><button type="button" class="pn-btn" data-act="img-credits">All image credits</button>' +
      '<button type="button" class="pn-btn pri" data-pearl-close>Close</button></div></div></div>';
  }
  function headerHtml(lesson, shareId) {
    return '<header class="pn-pearl-head"><p class="pn-pearl-crumb">' + esc(breadcrumb(lesson, shareId)) + '</p><h2 class="pn-pearl-title">' + esc(lesson.title || "") + "</h2></header>";
  }
  function footerHtml(lesson, shareId, bookmarked) {
    var id = pearlId(lesson.module, shareId);
    var share = shareId ? '<button type="button" data-act="id-share" data-v="' + esc(shareId) + '" aria-label="Share this Pearl">Share</button>' : '<button type="button" data-pearl-act="share">Share</button>';
    return '<footer class="pn-pearl-foot"><span class="pn-pearl-id">Pearl ID: ' + id +
      ' <button type="button" class="pn-pearl-copy" data-pearl-copy="' + id + '" aria-label="Copy Pearl ID ' + id + '">Copy</button></span>' +
      '<span class="pn-pearl-acts"><button type="button" data-pearl-act="report">Report</button>' + share +
      '<button type="button" data-pearl-act="bookmark" aria-pressed="' + (bookmarked ? "true" : "false") + '">Bookmark</button></span></footer>';
  }
  function tableHtml(vis) {
    if (!vis || vis.kind !== "table") return "";
    var head = (vis.cols || []).map(function (c) { return "<th scope=\"col\">" + esc(c) + "</th>"; }).join("");
    var body = (vis.rows || []).map(function (r) { return "<tr>" + (r || []).map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + "</th>" : "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("");
    return '<div class="pn-pearl-tablewrap"><table class="pn-pearl-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  var lastTrigger = null;
  function openSheet(doc, credit, src) {
    lastTrigger = doc.activeElement || null;
    closeSheet(doc);
    var w = doc.createElement("div"); w.innerHTML = sheetHtml(credit, src);
    var el = w.firstChild; doc.body.appendChild(el);
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll("button, a[href]"), list = [];
      for (var i = 0; i < f.length; i++) if (!f[i].disabled) list.push(f[i]);
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    var c = el.querySelector("[data-pearl-close]"); if (c && c.focus) c.focus();
    return el;
  }
  function closeSheet(doc) { var old = doc.querySelector(".pn-pearl-sheet"); if (old && old.parentNode) old.parentNode.removeChild(old); if (lastTrigger && lastTrigger.focus) { try { lastTrigger.focus(); } catch (e) {} } lastTrigger = null; }
  function bind(doc) {
    doc.addEventListener("click", function (e) {
      var t = e.target;
      var c = t.closest && t.closest("[data-pearl-copy]");
      if (c) { var txt = c.getAttribute("data-pearl-copy"); if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(txt); c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1200); return; }
      var cl = t.closest && t.closest("[data-pearl-close]");
      if (cl) { closeSheet(doc); return; }
      var cr = t.closest && t.closest("[data-pearl-credit]");
      if (cr) { openSheet(doc, cr.getAttribute("data-pearl-credit"), cr.getAttribute("data-pearl-src")); doc.dispatchEvent(new CustomEvent("pn-pearl-credit", { detail: { credit: cr.getAttribute("data-pearl-credit") } })); return; }
      var b = t.closest && t.closest("[data-pearl-act]");
      if (b) { var a = b.getAttribute("data-pearl-act"); if (a === "bookmark") b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); doc.dispatchEvent(new CustomEvent("pn-pearl", { detail: { action: a } })); }
    });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(doc); });
  }
  if (typeof document !== "undefined") bind(document);
  var api = { pearlId: pearlId, isPearl: isPearl, breadcrumb: breadcrumb, creditOf: creditOf, attributionLink: attributionLink, sheetHtml: sheetHtml, openSheet: openSheet, closeSheet: closeSheet, headerHtml: headerHtml, footerHtml: footerHtml, tableHtml: tableHtml, humanise: humanise };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PREP_PEARL = api;
})(typeof window !== "undefined" ? window : globalThis);
