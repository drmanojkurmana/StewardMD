/* StewardMD — mandatory beta notice for the four experimental imaging AI modules.
 * ---------------------------------------------------------------------------
 * ThoreX (chest X-ray), KardiQ X (ECG), SknX (dermatology) and FundX (retina) are clinically
 * UNVALIDATED (docs/fundx/VALIDATION-PROGRAM.md is still open). From 2026-09-18 a paying Physician
 * Pro account reaches them with no access code, and a doctor who paid for early access reads an AI
 * finding far more trustingly than a tester holding a code does. So the warning cannot live only on
 * the access gate: this wraps each module's own open() — the one choke point every entry path goes
 * through (home tile, sidebar row, deep link, access-code gate callback) — and shows a short notice
 * before the module's first screen.
 *
 * NOT DISMISSIBLE FOREVER, ON PURPOSE. `shown` is an in-memory object and is never persisted: the
 * notice returns on the next app launch. A "do not show again" on a validation warning for an
 * unvalidated clinical model defeats the point of the warning.
 *
 * Additive and defensive: if a module is absent the wrap is skipped, and if anything here throws the
 * original open() still runs (the notice must never be the reason a clinician cannot open a tool). */
(function () {
  "use strict";

  var COPY = {
    THOREX: { name: "ThoreX", line: "ThoreX is in beta and under active development. It may not perform to the mark, so check every finding against the image yourself. This is decision support; the clinician decides." },
    KARDIOX: { name: "KardiQ X", line: "KardiQ X is in beta and under active development. It may not perform to the mark, so read the trace yourself before acting. This is decision support; the clinician decides." },
    SKNX: { name: "SknX", line: "SknX is in beta and under active development. It may not perform to the mark and it does not exclude skin cancer. This is decision support; the clinician decides." },
    FUNDX: { name: "FundX", line: "FundX is in beta and under active development. It may not perform to the mark, so confirm every finding on examination. This is decision support; the clinician decides." }
  };

  var shown = {};                     // session only — deliberately NOT localStorage
  var STYLE_ID = "smdBetaNoticeCss";

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".smd-beta-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45)}" +
      ".smd-beta-sh{width:100%;max-width:520px;box-sizing:border-box;background:#fff;color:#111;border-radius:18px 18px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom));font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
      ".smd-beta-chip{display:inline-block;font:800 10px/1 inherit;letter-spacing:.08em;padding:5px 8px;border-radius:999px;background:#ffd27a;color:#7a4a00;margin-bottom:10px}" +
      ".smd-beta-h{font:700 17px/1.3 inherit;margin:0 0 6px}" +
      ".smd-beta-p{margin:0 0 16px;color:#3a3a3a}" +
      ".smd-beta-b{width:100%;padding:13px;border:0;border-radius:12px;background:#111;color:#fff;font:600 15px inherit;cursor:pointer}" +
      "@media (prefers-color-scheme:dark){.smd-beta-sh{background:#161819;color:#f2f2f2}.smd-beta-p{color:#c9c9c9}.smd-beta-b{background:#f2f2f2;color:#111}}";
    document.head.appendChild(s);
  }

  // Shows the notice, then calls `next`. Never blocks: any failure falls through to `next`.
  function notice(key, next) {
    try {
      var c = COPY[key];
      if (!c || shown[key] || !document.body) { next(); return; }
      shown[key] = true;
      injectCss();
      var ov = document.createElement("div");
      ov.className = "smd-beta-ov";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "true");
      ov.setAttribute("aria-label", c.name + " beta notice");
      ov.innerHTML = '<div class="smd-beta-sh">' +
        '<span class="smd-beta-chip">BETA</span>' +
        '<p class="smd-beta-h">' + c.name + ' is in beta</p>' +
        '<p class="smd-beta-p">' + c.line + '</p>' +
        '<button type="button" class="smd-beta-b">I understand, continue</button></div>';
      var go = function () { try { ov.remove(); } catch (e) {} next(); };
      ov.querySelector(".smd-beta-b").addEventListener("click", go);
      document.body.appendChild(ov);
      try { ov.querySelector(".smd-beta-b").focus(); } catch (e) {}
    } catch (e) { try { next(); } catch (e2) {} }
  }

  function wrap(obj, key) {
    if (!obj || typeof obj.open !== "function" || obj.__betaWrapped) return;
    var orig = obj.open;
    obj.open = function () {
      var self = this, args = arguments;
      notice(key, function () { try { orig.apply(self, args); } catch (e) {} });
    };
    obj.__betaWrapped = true;
  }

  // Wrap what already exists; for anything defined later (a lazily loaded module), intercept the
  // assignment so the notice cannot be bypassed by load order.
  Object.keys(COPY).forEach(function (key) {
    if (window[key]) { wrap(window[key], key); return; }
    try {
      var held;
      Object.defineProperty(window, key, {
        configurable: true,
        get: function () { return held; },
        set: function (v) { held = v; wrap(v, key); }
      });
    } catch (e) {}
  });

  window.SMD_BETA_NOTICE = { show: notice, copy: COPY, _shown: shown };
})();
