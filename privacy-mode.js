/* privacy-mode.js - B2 "privacy mode": one tap masks patient identifiers ON SCREEN (teaching,
 * screen sharing, rounds in a public corridor). window.SMD_PRIVACY_MODE.
 *
 * MECHANISM (presentation layer only, so it cannot leak into data):
 *  - A renderer wraps each identifier it prints with SMD_PRIVACY_MODE.wrap(kind, raw[, html]), which
 *    returns <span data-phi="R. K."><span>Ravi Kumar</span></span>. The mask is precomputed into
 *    the attribute at render time. The DOM text (textContent) stays exactly the real value, so any
 *    code that reads the DOM to save, print, export or share still reads the real thing.
 *  - While <html class="smd-privacy"> is set, one @media screen rule hides the inner span
 *    (display:none) and draws the mask with ::after { content: attr(data-phi) }. Generated content
 *    is not part of textContent, innerText, selection or copy, and @media print never sees it.
 *  - Inputs that hold an identifier carry data-phi-input (drawn as dots, the value is untouched);
 *    patient photos carry data-phi-img (pixels pushed out of the box, a flat tile left behind).
 *  - Screens that render identifiers this file does not mask are listed in UNMASKED. While one of
 *    them is on screen the persistent indicator says so, instead of implying it is covered.
 *  - Toasts / confirm() text cannot be marked up: callers use screenText(kind, raw), which returns
 *    the mask only while the mode is on. Those strings are never stored or sent.
 *
 * STATE: default off, persists for the session (sessionStorage), never synced, never logged.
 * KILL SWITCH: localStorage smd_privacy_mode_enabled = "0" hides the toggle and forces it off.
 * ES5, no dependencies, safe to load before every module (index.html loads it in <head>, deferred). */
(function () {
  "use strict";
  var G = typeof window !== "undefined" ? window : globalThis;
  var D = G.document;
  if (G.SMD_PRIVACY_MODE) return;

  var CLS = "smd-privacy";
  var SS_KEY = "smd_privacy_mode";
  var KILL_KEY = "smd_privacy_mode_enabled";
  var DOTS = "\u2022\u2022\u2022\u2022";

  /* ---------- pure masks (unit-tested in test/privacy-mode.test.mjs) ---------- */
  // Words that are not part of a person's own name: dropped before taking initials, unless the
  // name is nothing but one of them.
  var TITLES = /^(mr|mrs|ms|miss|mx|dr|smt|shri|sri|shrimati|kumari|kum|km|master|mast|baby|late|prof|sh|b\/o|bo|s\/o|d\/o|w\/o|c\/o)$/i;
  // A "letter" for initials: anything that is not whitespace, an ASCII digit, ASCII punctuation or
  // general punctuation. Covers Latin, Indic, Arabic and CJK scripts without Unicode regex flags.
  var LETTER = /[^\s0-9!-\/:-@\[-`{-~\u00a0-\u00bf\u2000-\u206f\u3000-\u303f]/;

  function str(v) { return v == null ? "" : String(v); }

  function firstLetter(word) {
    for (var i = 0; i < word.length; i++) {
      var c = word.charAt(i);
      if (!LETTER.test(c)) continue;
      var code = word.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < word.length) return word.substr(i, 2); // astral char
      return c.toUpperCase();
    }
    return "";
  }

  // "Ravi Kumar" -> "R. K."; one word -> "R."; titles dropped; at most first + last initial so a
  // long name does not spell itself out. Non-empty input with no letters -> dots, never the input.
  function maskName(v) {
    var s = str(v).replace(/^\s+|\s+$/g, "");
    if (!s) return "";
    var parts = s.replace(/\b([bsdwc])\/o\b/gi, "$1o").split(/[\s,._\/\-()\[\]]+/);
    var words = [], i;
    for (i = 0; i < parts.length; i++) if (parts[i] && firstLetter(parts[i])) words.push(parts[i]);
    var named = [];
    for (i = 0; i < words.length; i++) if (!TITLES.test(words[i])) named.push(words[i]);
    if (named.length) words = named;
    if (!words.length) return DOTS;
    var out = [firstLetter(words[0]) + "."];
    if (words.length > 1) out.push(firstLetter(words[words.length - 1]) + ".");
    return out.join(" ");
  }

  // Hospital IDs (UHID / MRN / IP / OP / ABHA): dots plus at most the last 4 characters, fewer as
  // the ID gets shorter, none for very short IDs (showing "the last 4" of a 4-character ID is the ID).
  function maskId(v) {
    var t = str(v).replace(/[\s\-_\/.:#]+/g, "");
    if (!t) return "";
    var keep = t.length >= 10 ? 4 : t.length >= 7 ? 2 : 0;
    if (keep && /[^\x20-\x7e]/.test(t)) keep = 0;            // never split a non-ASCII character
    return keep ? DOTS + " " + t.slice(-keep) : DOTS;
  }

  // Phone numbers: digits only, same rule as IDs (a 10-digit mobile shows "•••• 4821").
  function maskPhone(v) {
    var s = str(v);
    if (!s.replace(/\s+/g, "")) return "";
    var d = s.replace(/\D+/g, "");
    return d ? maskId(d) : DOTS;
  }

  // Addresses and other free identifiers: nothing of the value survives.
  function maskAll(v) { return str(v).replace(/\s+/g, "") ? DOTS : ""; }

  var MASKERS = { name: maskName, id: maskId, phone: maskPhone, address: maskAll, other: maskAll };
  function mask(kind, v) { return (MASKERS[kind] || maskAll)(v); }

  function escHtml(s) {
    return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // The renderer-facing helper. html is the caller's own already-escaped markup for the value (its
  // formatting is kept); without it the raw value is escaped here. An empty value is returned
  // unwrapped: there is nothing to mask, and a placeholder like "Unnamed" is not an identifier.
  function wrap(kind, raw, html) {
    var inner = html == null ? escHtml(raw) : String(html);
    var m = mask(kind, raw);
    if (!m) return inner;
    return '<span data-phi="' + escHtml(m) + '"><span>' + inner + "</span></span>";
  }

  // For a sentence that was built as text ("Bed 4 · Ravi Kumar — Critical"): the whole text escaped,
  // with the first occurrence of the identifier at or after `from` wrapped (pass `from` when a short
  // name could also match the words before it). A text that does not contain it is just escaped.
  function wrapIn(kind, text, raw, from) {
    var t = str(text), r = str(raw), i = r ? t.indexOf(r, from || 0) : -1;
    if (i < 0) return escHtml(t);
    return escHtml(t.slice(0, i)) + wrap(kind, r) + escHtml(t.slice(i + r.length));
  }

  /* ---------- state ---------- */
  function enabled() {
    try { return G.localStorage.getItem(KILL_KEY) !== "0"; } catch (e) { return true; }
  }
  function isOn() {
    if (!enabled()) return false;
    try { return G.sessionStorage.getItem(SS_KEY) === "1"; } catch (e) { return !!(D && D.documentElement.classList.contains(CLS)); }
  }
  // For text that cannot carry markup (toast, confirm): the mask while on, the value while off.
  function screenText(kind, raw) { return isOn() ? (mask(kind, raw) || str(raw)) : str(raw); }

  /* ---------- screens whose identifiers are NOT masked (keep in step with vault/plans/Premium-Feel.md B2) ---------- */
  // [data-phi-unmasked]: any container a module marks (WardSynQ views outside its PHI_VIEWS, the clinical-docs
  // print preview, the logbook report with case references shown). #wDicom: DICOM images can carry burned-in
  // names. #icuImpOv: the ICU report-import review lists raw OCR lines, which can include the report's name/UHID.
  var UNMASKED = ["[data-phi-unmasked]", "#wDicom", "#icuImpOv"];

  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    try { var cs = G.getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none"; } catch (e) { return true; }
  }
  function unmaskedOnScreen() {
    if (!D) return false;
    for (var i = 0; i < UNMASKED.length; i++) {
      var els = D.querySelectorAll(UNMASKED[i]);
      for (var j = 0; j < els.length; j++) if (visible(els[j])) return true;
    }
    return false;
  }

  /* ---------- CSS ---------- */
  var CSS = [
    "@media screen{",
    // the mask itself
    "html." + CLS + " [data-phi]>*{display:none!important}",
    "html." + CLS + " [data-phi]::after{content:attr(data-phi);letter-spacing:.02em}",
    "html." + CLS + " [data-phi-input]{-webkit-text-security:disc}",
    "html." + CLS + " img[data-phi-img]{object-position:-99999px 0!important;background:var(--rds-line,#cbd5e1)}",
    "html." + CLS + " [data-phi-img]:not(img){background-image:none!important}",
    // the persistent indicator is a hairline frame round the viewport (it covers nothing); the label appears only
    // while a screen it cannot mask is open, because that is the one thing a presenter must not miss
    "#smdPrivacyFrame{position:fixed;inset:0;z-index:2147482990;pointer-events:none;box-shadow:inset 0 0 0 2px var(--smd-pv,#6a4cc0);display:none}",
    "#smdPrivacyTag{position:fixed;left:50%;bottom:calc(6px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147482991;pointer-events:none;",
    "display:none;align-items:center;gap:5px;padding:3px 9px 3px 7px;border-radius:999px;background:#b45309;color:#fff;",
    "font:600 12px/16px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.01em;white-space:nowrap;max-width:calc(100vw - 24px);box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,.18)}",
    "#smdPrivacyTag svg{width:13px;height:13px;flex:none}",
    "html." + CLS + " #smdPrivacyFrame{display:block}",
    "html." + CLS + " #smdPrivacyTag.is-gap{display:inline-flex}",
    "}",
    "body.dark{--smd-pv:#b39dfa}",
    // the header toggle: pressed = tinted chip, same footprint as its neighbours
    ".smd-pv-btn[aria-pressed=\"true\"]{background:color-mix(in srgb,var(--smd-pv,#6a4cc0) 16%,transparent)!important;color:var(--smd-pv,#6a4cc0)!important}",
    ".smd-pv-btn[aria-pressed=\"true\"] .rds-icon{font-variation-settings:'opsz' 24,'wght' 500,'GRAD' 0,'FILL' 1}",
    "@media (prefers-reduced-motion:no-preference){.smd-pv-btn{transition:background-color 160ms ease,color 160ms ease,transform 120ms cubic-bezier(.23,1,.32,1)}}",
    // one more header icon: on a 360 px phone with the KU chip showing, the rnav header ran 6 px over, so the icons
    // give up 3 px each there (34 -> 31) rather than the brand or the search gap
    "@media (max-width:370px){#homeV2.rnav .rnav-head.smd-pv-host .rds-icon-btn{width:31px;min-width:31px}}",
    // the classic home header (smd_redesign_nav = "0") has 44 px icons; with one more the wordmark truncated at
    // 390 px, so its icons step down to 38 px (avatar included) while the toggle is there
    "@media (max-width:430px){#homeV2.hv4 .v3-header.smd-pv-host .v3-ic,#homeV2.hv4 .v3-header.smd-pv-host .v3-avatar{width:38px;height:38px}}",
    "@media print{#smdPrivacyFrame,#smdPrivacyTag{display:none!important}}"
  ].join("");

  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.4 3.2"/><path d="M6.6 6.6A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 5.4-1.6"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

  var styled = false, tag = null, frame = null, poll = 0, buttons = [];

  function ensureStyle() {
    if (styled || !D) return;
    var st = D.createElement("style");
    st.id = "smdPrivacyCss";
    st.textContent = CSS;
    (D.head || D.documentElement).appendChild(st);
    styled = true;
  }

  function ensureIndicator() {
    if (!D || !D.body) return;
    if (!frame || !frame.isConnected) {
      frame = D.createElement("div"); frame.id = "smdPrivacyFrame"; frame.setAttribute("aria-hidden", "true");
      D.body.appendChild(frame);
    }
    if (!tag || !tag.isConnected) {
      tag = D.createElement("div"); tag.id = "smdPrivacyTag"; tag.setAttribute("role", "status");
      D.body.appendChild(tag);
    }
  }

  function paintIndicator() {
    if (!tag) return;
    var gap = unmaskedOnScreen();
    if (tag.className === (gap ? "is-gap" : "")) return;
    tag.className = gap ? "is-gap" : "";
    tag.innerHTML = gap ? EYE + "<span>Privacy mode: this screen is not masked</span>" : "";
  }

  function apply(on) {
    if (!D) return;
    ensureStyle();
    D.documentElement.classList.toggle(CLS, !!on);
    for (var i = buttons.length - 1; i >= 0; i--) {
      var b = buttons[i];
      if (!b.isConnected) { buttons.splice(i, 1); continue; }
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Privacy mode is on: patient names, IDs and phone numbers are hidden on screen" : "Privacy mode";
    }
    clearInterval(poll); poll = 0;
    if (on) {
      ensureIndicator(); paintIndicator();
      poll = setInterval(paintIndicator, 800);   // overlays open and close without telling anyone
    }
  }

  function set(on) {
    on = !!on && enabled();
    try { if (on) G.sessionStorage.setItem(SS_KEY, "1"); else G.sessionStorage.removeItem(SS_KEY); } catch (e) {}
    apply(on);
    return on;
  }
  function toggle() {
    var on = set(!isOn());
    var t = G.toast || G.SMD_toast;
    if (typeof t === "function") {
      t(on ? "Privacy mode on. Patient names, IDs, phone numbers and photos are hidden on screen. Free-text notes are not."
           : "Privacy mode off. Patient identifiers are visible.");
    }
    return on;
  }

  // Header control. iconHtml is the host header's own glyph so it matches its neighbours.
  function mountToggle(header, before, iconHtml, className) {
    if (!D || !header || !enabled()) return null;
    var old = header.querySelector(".smd-pv-btn");
    if (old) return old;
    var b = D.createElement("button");
    b.type = "button";
    b.className = (className || "") + " smd-pv-btn";
    b.setAttribute("aria-label", "Privacy mode");
    b.innerHTML = iconHtml || EYE_OFF;
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
    if (before && before.parentNode === header) header.insertBefore(b, before); else header.appendChild(b);
    header.classList.add("smd-pv-host");
    buttons.push(b);
    apply(isOn());
    return b;
  }

  G.SMD_PRIVACY_MODE = {
    maskName: maskName, maskId: maskId, maskPhone: maskPhone, maskAll: maskAll, mask: mask,
    wrap: wrap, wrapIn: wrapIn, screenText: screenText,
    inputAttr: function () { return " data-phi-input"; },
    imgAttr: function () { return " data-phi-img"; },
    enabled: enabled, isOn: isOn, set: set, toggle: toggle, mountToggle: mountToggle,
    unmaskedOnScreen: unmaskedOnScreen, UNMASKED: UNMASKED
  };

  // Restore the session's state before any module renders (this file loads first).
  if (D) {
    ensureStyle();
    if (isOn()) {
      D.documentElement.classList.add(CLS);
      if (D.body) apply(true); else D.addEventListener("DOMContentLoaded", function () { apply(isOn()); });
    }
  }
})();
