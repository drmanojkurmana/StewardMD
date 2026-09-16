/* wardsynq/site/print-lang.js - the patient's prescription and discharge summary on paper, with an optional
 * second language. Owner decision 2026-09-15: "ENGLISH MAIN, other languages OPTIONAL, English must stay
 * whatever as safety".
 *
 * Buildless ES5, no dependency. window.WSQPrint, and module.exports for tests. Needs i18n.js loaded first.
 *
 * THE ENGLISH PRINT IS NEVER TOUCHED. ward.js (Patient copy) and discharge.js (the summary's printable) draw
 * their English document exactly as they always did; when a language is picked they add aside() blocks
 * between its sections and nothing else. Remove every <aside class="p-tr"> and the English is byte for byte
 * the print without the option (test/wardsynq-print-lang.test.mjs). An aside never contains another aside.
 *
 * WHAT AN ASIDE MAY SAY: catalog strings only (headings, labels, the fixed authority line, and the patient
 * instructions a prescriber picked from the closed list), looked up with an explicit language, never a
 * global one. Drug names, doses, numbers, units, routes, frequencies, diagnoses, results and free text are
 * not translated or transliterated anywhere here: there is no function that takes clinical text. A key a
 * language lacks prints in English, never blank.
 *
 * DATES ARE WRITTEN "15 Sep 2026, 09:05" in the hospital's clock. Only ISO strings are read; "03/04/2026"
 * prints as it was stored, because reading it would be a guess between March and April.
 */
(function (root) {
  "use strict";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The same cache token portal.js uses for wardsynq/site/i18n/<code>.js; the test pins the two equal.
  var LANG_FILES_V = 21;
  var INSTR = "rx.instr.";

  function I() { return (root && root.WSQI18n) || null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function t(key, lang, vars) { var e = I(); return e ? e.t(key, vars || null, lang || "en") : key; }

  /** PURE. "15 Sep 2026" (date-only ISO, no clock applied) or "15 Sep 2026, 09:05" in clock
   *  {timeZone?, utcOffsetMinutes?}. Anything that is not ISO comes back unchanged. */
  function date(iso, clock, withTime) {
    if (iso == null || iso === "") return "";
    var s = String(iso), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return m[3] + " " + (MON[Number(m[2]) - 1] || m[2]) + " " + m[1];
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    var ms = Date.parse(s);
    if (!isFinite(ms)) return s;
    var y, mo, d, h, mi, suffix = "";
    var zone = clock && clock.timeZone;
    if (zone) {
      try {
        var parts = {};
        new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
          .formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
        y = parts.year; mo = Number(parts.month); d = Number(parts.day); h = Number(parts.hour) % 24; mi = Number(parts.minute);
      } catch (e) { zone = null; }   // an unknown zone name falls back to the offset, never to the browser's own clock
    }
    if (!zone) {
      var off = clock && typeof clock.utcOffsetMinutes === "number" && isFinite(clock.utcOffsetMinutes) ? clock.utcOffsetMinutes : null;
      if (off === null) suffix = " UTC";
      var x = new Date(ms + (off || 0) * 60000);
      y = x.getUTCFullYear(); mo = x.getUTCMonth() + 1; d = x.getUTCDate(); h = x.getUTCHours(); mi = x.getUTCMinutes();
    }
    return pad(d) + " " + MON[mo - 1] + " " + y + (withTime === false ? "" : ", " + pad(h) + ":" + pad(mi) + suffix);
  }

  /** True only when the hospital turned the option on (the server's print.languagesEnabled). */
  function enabled(print) { return !!(print && print.languagesEnabled === true); }
  /** A second language that may be printed: offered by the portal, and not English. */
  function valid(code) { var e = I(); return !!(e && code && code !== "en" && e.offered(code)); }
  function nameOf(code) { var e = I(), l = e ? e.languages().filter(function (x) { return x.code === code; })[0] : null; return l ? l.name : code; }

  /** The picker, "English only" first. The caller shows it only when enabled(). */
  function picker(id, cur) {
    var e = I(), langs = e ? e.languages().filter(function (l) { return l.code !== "en"; }) : [];
    return '<select id="' + esc(id) + '"><option value="">English only</option>' + langs.map(function (l) {
      return '<option value="' + esc(l.code) + '"' + (l.code === cur ? " selected" : "") + ">English and " + esc(l.name) + "</option>";
    }).join("") + "</select>";
  }

  /** The closed list's codes, in catalog order (which is the order they print). */
  function instructionCodes() {
    var e = I(), en = e ? e._catalogs.en : {};
    return Object.keys(en).filter(function (k) { return k.indexOf(INSTR) === 0; }).map(function (k) { return k.slice(INSTR.length); });
  }
  /** A picked instruction in lang, from the catalog. A code the catalog does not know prints as the code. */
  function instruction(code, lang) {
    var e = I();
    return e && Object.prototype.hasOwnProperty.call(e._catalogs.en, INSTR + code) ? t(INSTR + code, lang) : String(code);
  }

  /** One translated block. bodyHtml is built by the caller from esc(tr(...)) and nothing else. */
  function aside(lang, bodyHtml) {
    var en = t("print.tr.label", "en"), tl = t("print.tr.label", lang);
    return '<aside class="p-tr" lang="' + esc(lang) + '" data-print-lang="' + esc(lang) + '">' +
      '<small class="p-tr-l">' + esc(en) + (tl !== en ? " / " + esc(tl) : "") + " (" + esc(nameOf(lang)) + ")</small>" + bodyHtml + "</aside>";
  }
  /** The line at the top of the translated part, in English and in lang (once, while lang still falls back
   *  to English for it). kind: "rx" | "dc". */
  function authority(kind, lang) {
    var k = "print.tr.authority." + (kind === "dc" ? "dc" : "rx"), en = t(k, "en"), tl = t(k, lang);
    return '<p class="p-tr-auth" lang="en">' + esc(en) + "</p>" + (tl !== en ? '<p class="p-tr-auth">' + esc(tl) + "</p>" : "");
  }

  var loaded = { en: true };
  /** Loads wardsynq/site/i18n/<code>.js once, then cb. Only an offered language names a file. */
  function ensureLoaded(code, cb) {
    cb = cb || function () {};
    if (!code || loaded[code] || !valid(code) || typeof document === "undefined") return cb();
    var el = document.createElement("script");
    el.src = "/wardsynq/site/i18n/" + code + ".js?v=" + LANG_FILES_V;
    el.onload = el.onerror = function () { loaded[code] = true; cb(); };
    document.head.appendChild(el);
  }

  var api = { date: date, enabled: enabled, valid: valid, nameOf: nameOf, picker: picker, instructionCodes: instructionCodes,
    instruction: instruction, t: t, esc: esc, aside: aside, authority: authority, ensureLoaded: ensureLoaded, LANG_FILES_V: LANG_FILES_V };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WSQPrint = api;
})(typeof window !== "undefined" ? window : null);
