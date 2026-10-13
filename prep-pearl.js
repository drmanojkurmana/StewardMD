/* PrepNucleus Pearl cards: Marrow-style layout (style inspiration only), original code.
 * A lesson qualifies automatically when any step has a table or image/figure visual.
 * Pearl ID: PN-xxxx derived deterministically from the lesson share ID (tools/prep-ids.mjs scheme).
 * Browser (window.PREP_PEARL) and Node (module.exports). No dependencies. */
(function (root) {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function hashStr(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
  /* PN-xxxx: stable 4-digit display ID from the lesson key (same key, same Pearl ID everywhere). */
  function pearlId(key) { return "PN-" + String(1000 + (hashStr("pearl:" + key) % 9000)); }
  function isPearl(lesson) {
    if (!lesson || !Array.isArray(lesson.steps)) return false;
    return lesson.steps.some(function (s) { var v = s && s.vis; return !!v && (v.kind === "table" || v.kind === "image" || v.kind === "flow" || v.kind === "figure"); });
  }
  function humanise(id) { return String(id || "").replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function breadcrumb(lesson) {
    return "Pearl #" + pearlId(lesson.module) + " · " + humanise(lesson.subject) + " · " + humanise(lesson.module);
  }
  function attributionLink(vis) {
    if (!vis) return "";
    var label = vis.credit || vis.attribution || "StewardMD illustration";
    return '<button type="button" class="pn-pearl-credit" data-pearl-credit="' + esc(label) + '" aria-label="Image attribution and licence">Image Attribution and License (i)</button>';
  }
  function headerHtml(lesson) {
    return '<header class="pn-pearl-head"><p class="pn-pearl-crumb">' + esc(breadcrumb(lesson)) + '</p><h2 class="pn-pearl-title">' + esc(lesson.title || "") + "</h2></header>";
  }
  function footerHtml(lesson) {
    var id = pearlId(lesson.module);
    return '<footer class="pn-pearl-foot"><span class="pn-pearl-id">Pearl ID: ' + id +
      ' <button type="button" class="pn-pearl-copy" data-pearl-copy="' + id + '" aria-label="Copy Pearl ID">Copy</button></span>' +
      '<span class="pn-pearl-acts"><button type="button" data-pearl-act="report">Report</button>' +
      '<button type="button" data-pearl-act="share">Share</button>' +
      '<button type="button" data-pearl-act="bookmark" aria-pressed="false">Bookmark</button></span></footer>';
  }
  function tableHtml(vis) {
    if (!vis || vis.kind !== "table") return "";
    var head = (vis.cols || []).map(function (c) { return "<th scope=\"col\">" + esc(c) + "</th>"; }).join("");
    var body = (vis.rows || []).map(function (r) { return "<tr>" + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + "</th>" : "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("");
    return '<div class="pn-pearl-tablewrap"><table class="pn-pearl-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function bind(doc) {
    doc.addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest("[data-pearl-copy]");
      if (c) { var t = c.getAttribute("data-pearl-copy"); if (navigator.clipboard) navigator.clipboard.writeText(t); c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1200); return; }
      var b = e.target.closest && e.target.closest("[data-pearl-act]");
      if (b) { var a = b.getAttribute("data-pearl-act"); if (a === "bookmark") b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); doc.dispatchEvent(new CustomEvent("pn-pearl", { detail: { action: a } })); return; }
      var cr = e.target.closest && e.target.closest("[data-pearl-credit]");
      if (cr) doc.dispatchEvent(new CustomEvent("pn-pearl-credit", { detail: { credit: cr.getAttribute("data-pearl-credit") } }));
    });
  }
  if (typeof document !== "undefined") bind(document);
  var api = { pearlId: pearlId, isPearl: isPearl, breadcrumb: breadcrumb, headerHtml: headerHtml, footerHtml: footerHtml, tableHtml: tableHtml, attributionLink: attributionLink, humanise: humanise };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PREP_PEARL = api;
})(typeof window !== "undefined" ? window : globalThis);
