/* StewardMD - one error panel (window.SMD_error), owner-approved look 2026-10-26.
 *
 * For a screen or section that could not load or complete. Left-aligned, no icon, no tint:
 * what failed (title), why or what is still safe (why), then real actions. A technical code sits behind
 * "Details" and is never the headline. Styled by smd-error.css on the app's --rds-* tokens.
 *
 *   host.innerHTML = SMD_error.html({
 *     title: "Couldn't open this X-ray",
 *     why: "It may have been deleted. Your other results are not affected.",
 *     actions: [{ label: "Try again", act: "tx-retry", primary: true }, { label: "Back to list", act: "tx-back" }],
 *     code: "LOCAL_STORE_TIMEOUT"
 *   });
 *
 * Each action renders a <button data-act="..."> so the module's existing click delegation keeps working.
 * Text is escaped. `kind: "block"` is the amber variant for a calculation that cannot proceed (names what to add).
 * Never use this to hide a clinical warning: a dose that cannot be computed shows NO number. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function html(o) {
    o = o || {};
    var cls = "smd-err" + (o.kind === "block" ? " smd-err--block" : "");
    var h = '<div class="' + cls + '" role="alert"><p class="smd-err-title">' + esc(o.title || "Something didn't load") + "</p>";
    if (o.why) h += '<p class="smd-err-why">' + esc(o.why) + "</p>";
    var acts = o.actions || [];
    if (acts.length) {
      h += '<div class="smd-err-row">';
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        if (!a || !a.label) continue;
        h += '<button type="button" class="smd-err-btn' + (a.primary ? " is-primary" : "") + '"' +
             (a.act ? ' data-act="' + esc(a.act) + '"' : "") + ">" + esc(a.label) + "</button>";
      }
      h += "</div>";
    }
    if (o.code) h += '<details class="smd-err-more"><summary>Details</summary><div class="smd-err-code">' + esc(o.code) + "</div></details>";
    return h + "</div>";
  }
  var api = { html: html, esc: esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SMD_error = api;
})();
