/* StewardMD — Privacy & Data Controls (consent gate + data-subject controls).
 * ---------------------------------------------------------------------------
 * Layer over the minified app.js via the same window.SMD_* seam used elsewhere.
 * NOTHING here changes the clinical engine, scoring, or the AI recommendation.
 *
 * PR-A scope (this file, grows in later PRs):
 *   • SMD_CONSENT — record/read/update a per-user consent record.
 *       signed-in  → Firestore  users/{uid}/consent/current   (rules-enforced)
 *       guest      → localStorage smd_consent_guest            (best-effort)
 *   • Consent gate — a blocking modal with 2 required + 1 optional checkbox,
 *     shown before a user can use AI analysis / upload patient info. Continue
 *     is disabled until BOTH required boxes are ticked. Links to the Privacy
 *     Notice (#privacyModal). Reversible via localStorage smd_privacy_gate=0.
 *   • Defense-in-depth: SMD_AI.* is guarded so AI calls await consent.
 *
 * Versions/contacts come from SMD_PRIVACY (privacy-config.js) — never hardcoded.
 */
(function () {
  "use strict";
  if (!window.SMD_PRIVACY) return;                       // config must load first
  var P = window.SMD_PRIVACY, CFG = P.cfg;
  var GUEST_KEY = "smd_consent_guest";

  function nowISO() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  function auth() { return window.SMD_AUTH || null; }
  function db() { return window.SMD_DB || null; }
  function uid() { try { return (auth() && auth().currentUser && auth().currentUser.uid) || null; } catch (e) { return null; } }
  function isSignedIn() { return !!uid(); }

  // ── consent record ────────────────────────────────────────────────────────
  function consentDocRef() {
    var u = uid(); if (!u || !db()) return null;
    return db().collection("users").doc(u).collection("consent").doc("current");
  }
  function readGuest() { try { return JSON.parse(localStorage.getItem(GUEST_KEY) || "null"); } catch (e) { return null; } }
  function writeGuest(rec) { try { localStorage.setItem(GUEST_KEY, JSON.stringify(rec)); } catch (e) {} }

  // Returns a Promise<record|null>.
  function getConsent() {
    var ref = consentDocRef();
    if (ref) {
      return ref.get().then(function (s) { return s.exists ? s.data() : null; }).catch(function () { return readGuest(); });
    }
    return Promise.resolve(readGuest());
  }

  // Is a record current for the live policy/terms versions?
  function isCurrent(rec) {
    return !!(rec && rec.consentAcceptedAt && rec.clinicalAuthorityConfirmedAt
      && rec.privacyPolicyVersion === CFG.privacyPolicyVersion
      && rec.termsVersion === CFG.termsVersion);
  }

  // Persist a fresh consent record. optionalImprovement = boolean (checkbox C).
  function recordConsent(optionalImprovement) {
    var t = nowISO();
    var rec = {
      userId: uid() || "guest",
      privacyPolicyVersion: CFG.privacyPolicyVersion,
      termsVersion: CFG.termsVersion,
      consentAcceptedAt: t,
      clinicalAuthorityConfirmedAt: t,
      optionalImprovementConsent: !!optionalImprovement,
      optionalImprovementConsentAt: optionalImprovement ? t : null,
      updatedAt: t
    };
    var ref = consentDocRef();
    writeGuest(rec);                                     // always mirror locally
    if (ref) return ref.set(rec, { merge: true }).then(function () { return rec; }).catch(function () { return rec; });
    return Promise.resolve(rec);
  }

  // Update ONLY the optional-improvement consent (Settings toggle / withdrawal).
  function setOptionalConsent(on) {
    var t = nowISO(), patch = { optionalImprovementConsent: !!on, optionalImprovementConsentAt: on ? t : null, updatedAt: t };
    var g = readGuest() || {}; g.optionalImprovementConsent = !!on; g.optionalImprovementConsentAt = on ? t : null; g.updatedAt = t; writeGuest(g);
    var ref = consentDocRef();
    if (ref) return ref.set(patch, { merge: true }).then(function () { return true; }).catch(function () { return false; });
    return Promise.resolve(true);
  }

  window.SMD_CONSENT = {
    get: getConsent, isCurrent: isCurrent, record: recordConsent,
    setOptional: setOptionalConsent, isSignedIn: isSignedIn
  };

  // ── consent gate UI ─────────────────────────────────────────────────────
  var _gateOpen = false, _pending = [];   // callbacks awaiting a resolution (bool)

  function injectCSS() {
    if (document.getElementById("smdPrivacyCSS")) return;
    var s = document.createElement("style"); s.id = "smdPrivacyCSS";
    s.textContent =
      "#smdConsentBackdrop{position:fixed;inset:0;z-index:var(--z-modal,700);background:rgba(6,14,20,.62);display:flex;align-items:center;justify-content:center;padding:16px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom))}" +
      "#smdConsentCard{background:var(--panel,#fff);color:var(--ink,#14202b);border:1px solid var(--line,#d7dee3);border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 18px 60px rgba(0,0,0,.4);font-family:var(--sans)}" +
      "#smdConsentCard .cg-h{padding:18px 20px 8px;font-size:19px;font-weight:700}" +
      "#smdConsentCard .cg-sub{padding:0 20px 12px;color:var(--slate-soft,#5a7184);font-size:13.5px;line-height:1.5}" +
      "#smdConsentCard .cg-list{padding:4px 20px 6px}" +
      "#smdConsentCard label.cg-row{display:flex;gap:11px;align-items:flex-start;padding:12px;border:1px solid var(--line,#d7dee3);border-radius:11px;margin-bottom:10px;cursor:pointer;font-size:14px;line-height:1.5}" +
      "#smdConsentCard label.cg-row.cg-opt{border-style:dashed}" +
      "#smdConsentCard label.cg-row input{margin-top:2px;width:19px;height:19px;flex:0 0 auto;accent-color:var(--teal,#0e6e63)}" +
      "#smdConsentCard .cg-req{color:var(--teal,#0e6e63);font-weight:600;font-size:11.5px;letter-spacing:.03em;text-transform:uppercase}" +
      "#smdConsentCard .cg-opttag{color:var(--slate-soft,#5a7184);font-weight:600;font-size:11.5px;letter-spacing:.03em;text-transform:uppercase}" +
      "#smdConsentCard a.cg-link{color:var(--teal,#0e6e63);text-decoration:underline;cursor:pointer}" +
      "#smdConsentCard .cg-foot{padding:8px 20px 20px;display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap}" +
      "#smdConsentCard .cg-cancel{background:none;border:0;color:var(--slate-soft,#5a7184);font-size:14px;padding:11px 12px;cursor:pointer}" +
      "#smdConsentCard .cg-continue{background:var(--teal,#0e6e63);color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:600;padding:12px 22px;cursor:pointer}" +
      "#smdConsentCard .cg-continue:disabled{opacity:.45;cursor:not-allowed}" +
      "#smdConsentCard .cg-note{padding:0 20px 4px;font-size:11.5px;color:var(--slate-soft,#5a7184)}";
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function resolveAll(v) { var cbs = _pending.slice(); _pending = []; cbs.forEach(function (cb) { try { cb(v); } catch (e) {} }); }

  function closeGate() {
    var ov = document.getElementById("consentOverlay");
    if (ov) { ov.classList.remove("show"); ov.setAttribute("aria-hidden", "true"); }
    _gateOpen = false;
  }

  // UNIFIED SINGLE GATE: there is ONE consent screen — the entry splash
  // (#consentOverlay in index.html), a comprehensive single-tick acknowledgment.
  // This module NEVER renders its own second card anymore; openGate simply shows
  // that splash. Acceptance is handled by the #splashContinueBtn hook in init()
  // (records consent + resolves any pending ensureConsent waiters). The optional
  // de-identified-data consent is NOT on the gate — it's an opt-in in Settings ›
  // Privacy & Data Controls (default off), so consent stays specific + withdrawable.
  function openGate() {
    if (_gateOpen) return;
    var ov = document.getElementById("consentOverlay");
    if (ov) {
      _gateOpen = true;
      if (!ov.classList.contains("show")) {
        ov.setAttribute("aria-hidden", "false");
        ov.classList.add("show");
      }
      return;
    }
    // Splash not in DOM (unexpected) → do not spawn a second UI; don't block.
    resolveAll(true);
  }

  // Promise<boolean> — resolves true when consent is current (showing the gate
  // if needed). If the gate is off (flag) we treat as satisfied (no block).
  function ensureConsent() {
    if (!P.gateOn()) return Promise.resolve(true);
    return getConsent().then(function (rec) {
      if (isCurrent(rec)) return true;
      return new Promise(function (resolve) { _pending.push(resolve); openGate(); });
    });
  }
  window.SMD_CONSENT.ensure = ensureConsent;

  // ── proactive gate after sign-in + defense-in-depth AI guard ──────────────
  function maybePrompt() {
    if (!P.gateOn() || !isSignedIn()) return;
    getConsent().then(function (rec) { if (!isCurrent(rec)) openGate(); });
  }

  function guardAI() {
    var AI = window.SMD_AI; if (!AI || AI.__privacyGuarded) return;
    ["explain", "explainGrounded", "explainGroundedStream", "research", "vision", "visionText"].forEach(function (m) {
      var orig = AI[m]; if (typeof orig !== "function") return;
      AI[m] = function () { var args = arguments, self = this; return ensureConsent().then(function (ok) { if (!ok) return Promise.reject(new Error("Consent required to use AI analysis.")); return orig.apply(self, args); }); };
    });
    AI.__privacyGuarded = true;
  }

  // Populate the Privacy Notice (#privacyModal) from config so versions,
  // contact and the provider list are single-sourced (never hardcoded twice).
  function populateNotice() {
    try {
      var eff = document.getElementById("pnEffective"); if (eff) eff.textContent = CFG.effectiveDate;
      var c = document.getElementById("pnContact"); if (c) { c.textContent = CFG.contactEmail; c.setAttribute("href", "mailto:" + CFG.contactEmail); }
      var ul = document.getElementById("pnProviders");
      if (ul && Array.isArray(CFG.serviceProviders) && CFG.serviceProviders.length) {
        ul.innerHTML = CFG.serviceProviders.map(function (p) { return "<li><strong>" + esc(p.name) + "</strong> — " + esc(p.role) + "</li>"; }).join("");
      }
    } catch (e) {}
  }

  function init() {
    populateNotice();
    guardAI();
    // UNIFIED GATE: the entry splash's single required tick now covers the privacy +
    // clinical-authority consents too. When it's accepted, record a current consent so
    // this separate gate (ensureConsent / maybePrompt) never appears as a 2nd screen.
    // We record the REQUIRED consents only; the OPTIONAL de-identified-data use is NOT
    // bundled into a mandatory tick (kept as an opt-in in Settings › Privacy & Data
    // Controls), so consent stays specific and separately withdrawable.
    try {
      var sb = document.getElementById("splashContinueBtn");
      if (sb && !sb.__consentHooked) {
        sb.__consentHooked = true;
        sb.addEventListener("click", function () {
          try { recordConsent(false); } catch (e) {}   // optional consent → Settings, default off
          closeGate();                                  // hide the splash overlay
          resolveAll(true);                             // release any AI/entry waiters
        });
      }
      // ✕ / dismiss on the splash → treat as declined so waiters don't hang.
      var cx = document.getElementById("consentClose");
      if (cx && !cx.__consentHooked) {
        cx.__consentHooked = true;
        cx.addEventListener("click", function () { closeGate(); resolveAll(false); });
      }
    } catch (e) {}
    // Attach to auth state so the gate appears right after sign-in.
    var tries = 0, t = setInterval(function () {
      guardAI();
      if (auth() && typeof auth().onAuthStateChanged === "function") {
        clearInterval(t);
        try { auth().onAuthStateChanged(function () { maybePrompt(); }); } catch (e) {}
        maybePrompt();
      } else if (++tries > 80) { clearInterval(t); maybePrompt(); }
    }, 250);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
