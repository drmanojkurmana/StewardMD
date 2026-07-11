/* StewardMD - Copy / Print augmentation for the infusion (INF) calculator.
 * ---------------------------------------------------------------------------
 * The pump sheet's Copy + Print live in the FROZEN app.js:
 *   Copy  → INF._copy(this, json) → navigator.clipboard.writeText(...)  - clipboard API is
 *           unavailable inside the iOS Capacitor WKWebView, so the `&&` short-circuits (no-op).
 *   Print → window.print()                                             - a no-op in the WKWebView.
 * We don't edit app.js; we AUGMENT:
 *   • replace INF._copy with a WebView-safe copy (clipboard → execCommand → Capacitor Share);
 *   • intercept any window.print() button (capture phase) and render a branded StewardMD print
 *     sheet - printed directly on web, or written to a file and shared (AirPrint / Save PDF) on
 *     native, so the logo + footer are preserved.
 * Pure additive; safe on web (native APIs simply absent → the web paths run). */
(function () {
  "use strict";

  function isNative() {
    try {
      var C = window.Capacitor;
      return !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));
    } catch (e) { return false; }
  }
  function plugins() { try { return (window.Capacitor && window.Capacitor.Plugins) || {}; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ── robust copy: Clipboard API → execCommand → Capacitor Clipboard → Share ─────────────────
  function smdCopy(text) {
    return new Promise(function (resolve) {
      text = String(text == null ? "" : text);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { execCopy(); });
          return;
        }
      } catch (e) {}
      execCopy();
      function execCopy() {
        try {
          var ta = document.createElement("textarea");
          ta.value = text; ta.setAttribute("readonly", "");
          ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
          document.body.appendChild(ta); ta.focus(); ta.select();
          try { ta.setSelectionRange(0, text.length); } catch (e) {}
          var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
          ta.remove();
          if (ok) { resolve(true); return; }
        } catch (e) {}
        var P = plugins();
        try {
          if (P.Clipboard && P.Clipboard.write) { P.Clipboard.write({ string: text }).then(function () { resolve(true); }, function () { shareText(); }); return; }
        } catch (e) {}
        shareText();
      }
      function shareText() {
        var P = plugins();
        try { if (P.Share && P.Share.share) { P.Share.share({ text: text }).then(function () { resolve(true); }, function () { resolve(false); }); return; } } catch (e) {}
        try { if (navigator.share) { navigator.share({ text: text }).then(function () { resolve(true); }, function () { resolve(false); }); return; } } catch (e) {}
        resolve(false);
      }
    });
  }

  // ── override INF._copy (poll until the frozen INF module is present) ───────────────────────
  function patchCopy() {
    if (!window.INF || window.INF.__smdCopyPatched) return !!(window.INF && window.INF.__smdCopyPatched);
    window.INF._copy = function (e, i) {
      var text; try { text = JSON.parse(i); } catch (_) { text = i; }
      smdCopy(text).then(function (ok) {
        if (e) { var o = e.textContent; e.textContent = ok ? "✓ Copied" : "Copy - long-press to select"; setTimeout(function () { e.textContent = o; }, 1600); }
      });
    };
    window.INF.__smdCopyPatched = true;
    return true;
  }
  (function waitForINF(n) { if (patchCopy()) return; if (n > 80) return; setTimeout(function () { waitForINF(n + 1); }, 250); })(0);

  // ── branded print sheet ────────────────────────────────────────────────────────────────────
  // Pull the on-screen clinical lines from the current sheet, dropping the action buttons and
  // the reference monograph (everything after "MONOGRAPH").
  function buildSheet(scope) {
    var out = { title: "Infusion preparation", lines: [] };
    if (!scope) return out;
    var raw = "";
    try { raw = scope.innerText || scope.textContent || ""; } catch (e) {}
    var lines = raw.split("\n").map(function (s) { return s.replace(/\s+$/, "").replace(/^\s+/, ""); }).filter(Boolean);
    var drop = /^(copy|print|✓ copied|add to icu dashboard|close|back|×|✕|⌫)$/i;
    var first = true, collected = [];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (/^monograph$/i.test(L)) break;         // stop before the reference text
      if (drop.test(L)) continue;
      if (first) { out.title = L; first = false; continue; }
      collected.push(L);
    }
    out.lines = collected;
    return out;
  }

  function brandedHTML(sheet) {
    var when = "";
    try { when = new Date().toLocaleString(); } catch (e) {}
    var body = sheet.lines.map(function (L) {
      var strong = /^(prepare:|set pump:|nurse mode)/i.test(L);
      return '<div class="row' + (strong ? " k" : "") + '">' + esc(L) + "</div>";
    }).join("");
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>StewardMD - " + esc(sheet.title) + "</title><style>" +
      "*{box-sizing:border-box}html,body{margin:0;padding:0}" +
      "body{font:15px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:24px}" +
      ".hd{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #0e6e63;padding-bottom:10px;margin-bottom:16px}" +
      ".logo{font:800 22px/1 Georgia,serif;color:#0e6e63;letter-spacing:.5px}.logo b{color:#0f172a}" +
      ".hd .tag{font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em}" +
      "h1{font-size:19px;margin:0 0 14px}" +
      ".row{padding:6px 0;border-bottom:1px solid #eef2f1}.row.k{font-weight:700;font-size:16px;color:#0e6e63;border-bottom:2px solid #cfe6e2}" +
      "footer{margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5}" +
      "footer b{color:#0e6e63}" +
      "@media print{body{padding:0}@page{margin:14mm}}" +
      "</style></head><body>" +
      '<div class="hd"><span class="logo">Steward<b>MD</b></span><span class="tag">Infusion preparation</span></div>' +
      "<h1>" + esc(sheet.title) + "</h1><main>" + body + "</main>" +
      "<footer><b>Generated by StewardMD</b>" + (when ? " · " + esc(when) : "") +
      "<br>Decision support only - verify every dose, concentration and pump rate before administration. Not a substitute for clinical judgement.</footer>" +
      "</body></html>";
  }

  function plainText(sheet) {
    var when = ""; try { when = new Date().toLocaleString(); } catch (e) {}
    return "StewardMD - " + sheet.title + "\n\n" + sheet.lines.join("\n") +
      "\n\nGenerated by StewardMD" + (when ? " · " + when : "") +
      "\nVerify every value before administration. Decision support only.";
  }

  function webPrint(html) {
    try {
      var f = document.createElement("iframe");
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(f);
      var d = f.contentWindow.document; d.open(); d.write(html); d.close();
      f.contentWindow.focus();
      setTimeout(function () {
        try { f.contentWindow.print(); } catch (e) {}
        setTimeout(function () { try { f.remove(); } catch (e) {} }, 1500);
      }, 350);
      return true;
    } catch (e) { return false; }
  }

  function nativePrintShare(html, sheet) {
    var P = plugins();
    // Best: write a branded HTML file and share it → iOS share sheet offers Print (AirPrint) / Save PDF.
    if (P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
      P.Filesystem.writeFile({ path: "stewardmd-infusion.html", data: html, directory: "CACHE", encoding: "utf8" })
        .then(function (res) { return P.Share.share({ title: "StewardMD - " + sheet.title, url: res.uri, dialogTitle: "Print or share" }); })
        .catch(function () { shareTextOnly(); });
      return;
    }
    shareTextOnly();
    function shareTextOnly() {
      try { if (P.Share && P.Share.share) { P.Share.share({ title: "StewardMD - " + sheet.title, text: plainText(sheet) }); return; } } catch (e) {}
      try { if (navigator.share) { navigator.share({ text: plainText(sheet) }); } } catch (e) {}
    }
  }

  function doPrint(scope) {
    var sheet = buildSheet(scope);
    var html = brandedHTML(sheet);
    if (isNative()) { nativePrintShare(html, sheet); return; }
    if (!webPrint(html)) nativePrintShare(html, sheet);   // web fallback if iframe print blocked
  }

  // Intercept window.print() buttons BEFORE their inline handler runs (capture phase), since
  // window.print() is a no-op in the WKWebView. Scoped to the closest overlay/sheet the button
  // sits in (infusion sheet, ICU snapshot, etc.), else the whole document.
  document.addEventListener("click", function (ev) {
    var el = ev.target;
    var btn = el && el.closest ? el.closest("button,a,[onclick]") : null;
    if (!btn || !btn.getAttribute) return;
    var oc = btn.getAttribute("onclick") || "";
    if (oc.indexOf("window.print") < 0 && oc.indexOf(".print()") < 0) return;
    ev.preventDefault();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    var scope = btn.closest("#infOverlay") || btn.closest("[class*=overlay]") || btn.closest("[class*=sheet]") || btn.closest("[class*=modal]") || document.body;
    doPrint(scope);
  }, true);
})();
