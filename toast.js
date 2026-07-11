/* StewardMD — global toast shim (SMD_toast / toast).
 *
 * WHY THIS EXISTS: a number of modules show their user feedback through window.toast(...)
 * (icu.js, account.js, ghis-ward.js, voice.js, image-engine.js, offline-db.js) or through
 * window.SMD_toast(...) (watch-lab.js, native-push.js) — but NEITHER global was ever defined.
 * Every such message (e.g. Lab Watch 24/7's "Sign in with your Google/Apple account…", "Lab
 * Watch on ✅", "Couldn't load…") was silently swallowed, so buttons that only give toast
 * feedback looked completely dead. This defines ONE self-contained, theme-invariant toast and
 * aliases both names to it.
 *
 * Self-contained by design (inline styles, no CSS dependency, lazy DOM) so it works on the
 * native WebView and before any stylesheet loads. Loaded early + idempotent: if some other
 * script has already provided window.toast, we defer to it and only fill the missing alias. */
(function () {
  "use strict";
  // Respect an existing implementation (don't clobber module-local globals if one appears).
  if (typeof window.toast === "function") {
    if (typeof window.SMD_toast !== "function") window.SMD_toast = window.toast;
    return;
  }

  var el = null, timer = null;
  function ensureEl() {
    if (el && el.isConnected) return el;
    el = document.createElement("div");
    el.id = "smdToast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:calc(24px + env(safe-area-inset-bottom,0px))",
      "transform:translateX(-50%) translateY(12px)",
      "z-index:2147483000",                        // above every sheet/modal in the app
      "max-width:min(92vw,440px)",
      "box-sizing:border-box",
      "padding:12px 16px",
      "border-radius:12px",
      "background:rgba(17,24,39,.96)",              // fixed dark chip — readable in light & dark themes
      "color:#fff",
      "font:600 13.5px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      "box-shadow:0 10px 34px rgba(0,0,0,.30)",
      "text-align:center",
      "white-space:pre-line",
      "opacity:0",
      "pointer-events:none",
      "transition:opacity .18s ease, transform .18s ease"
    ].join(";");
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function show(msg) {
    if (msg == null || msg === "") return;
    try {
      var t = ensureEl();
      t.textContent = String(msg);
      void t.offsetWidth;                            // reflow so the transition runs
      t.style.opacity = "1";
      t.style.transform = "translateX(-50%) translateY(0)";
      clearTimeout(timer);
      var ms = Math.min(6500, Math.max(2400, String(msg).length * 55));
      timer = setTimeout(function () {
        if (!el) return;
        el.style.opacity = "0";
        el.style.transform = "translateX(-50%) translateY(12px)";
      }, ms);
    } catch (e) {
      try { console.log("[toast]", msg); } catch (x) {}
    }
  }

  window.toast = show;
  window.SMD_toast = show;
})();
