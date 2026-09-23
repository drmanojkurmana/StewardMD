/* phi-india.js — window.SMD_PHI_INDIA
 *
 * Indian identifier redaction, applied AFTER reasoning.js redactPHI() on text that is about to leave
 * the phone (AI Vision OCR text, the ICU photo question). Additive only: it redacts more, it never
 * restores anything the base rules removed. Flag `smd_phi_india`, DEFAULT ON, localStorage only;
 * `localStorage.setItem("smd_phi_india","0")` restores the previous output byte-identically.
 *
 * Coverage adapted from OpenMed's `india_health_id` policy (github.com/maziyarpanahi/openmed,
 * Apache-2.0, docs/india-health-id-deidentification.md). Our own implementation, structural only:
 *   - ABHA Address  name@abdm / name@sbx   (the base email rule needs a dotted domain, so these leaked)
 *   - UPI ID        handle@<known PSP>      (same leak; PSP list kept explicit to spare clinical "@")
 *   - PAN           ABCDE1234F              (uppercase shape only)
 *   - Masked Aadhaar  XXXX XXXX 1234
 *   - Indic digits  Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam
 *                   digit runs are folded to ASCII so the base 10+ digit rule sees Aadhaar/ABHA/phone
 *                   numbers written in a regional script. Only digit characters change.
 *   - Labelled IDs  Aadhar (common spelling), Ration Card, Voter ID/EPIC, PMJAY, Policy/Claim/Card No,
 *                   Pincode, plus the Hindi and Telugu "name" labels.
 * As in OpenMed, a match is structural recognition, never proof that an identifier exists.
 * Conservative like the base rules: short clinical values ("Na 138", "pH 7.32") are never touched.
 * ES5, dependency-free, node + browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SMD_PHI_INDIA = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var R = "[redacted]";
  // Zero of each Indic decimal-digit block; the nine digits follow contiguously.
  var ZEROS = [0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66];
  var INDIC_DIGIT = /[\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F]/g;
  // UPI handles from the major PSP apps. Explicit list: a generic "x@y" rule would eat "@ 5 mg/kg".
  var UPI_PSP = "okaxis|oksbi|okhdfcbank|okicici|ybl|ibl|axl|paytm|pthdfc|ptsbi|ptyes|ptaxis|apl|yapl|upi|" +
    "icici|sbi|hdfcbank|axisbank|kotak|axisb|ikwik|freecharge|jupiteraxis|fam|slice|naviaxis|waaxis|wahdfcbank|" +
    "waicici|wasbi|abfspay|airtel|jio|postbank|barodampay|unionbankofindia|pnb|idfcbank|yesbank|federal|indus|rbl";

  function foldDigits(t) {
    return t.replace(INDIC_DIGIT, function (ch) {
      var c = ch.charCodeAt(0);
      for (var i = 0; i < ZEROS.length; i++) if (c >= ZEROS[i] && c <= ZEROS[i] + 9) return String(c - ZEROS[i]);
      return ch;
    });
  }

  function apply(text) {
    var t = String(text == null ? "" : text);
    if (INDIC_DIGIT.test(t)) {
      INDIC_DIGIT.lastIndex = 0;
      t = foldDigits(t);
      t = t.replace(/(\+?\d[\d\s-]{8,}\d)/g, R);                                          // same rule as the base
      t = t.replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, "[date]");
    }
    INDIC_DIGIT.lastIndex = 0;
    t = t.replace(/\b[A-Za-z0-9._-]{2,}@(?:abdm|sbx)\b/gi, R);                             // ABHA Address
    t = t.replace(new RegExp("\\b[A-Za-z0-9._-]{2,}@(?:" + UPI_PSP + ")\\b(?!\\.)", "gi"), R); // UPI ID
    t = t.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, R);                                             // PAN
    t = t.replace(/\b[Xx*]{4}[\s-]?[Xx*]{4}[\s-]?\d{4}\b/g, R);                               // masked Aadhaar
    t = t.replace(/\b(Aadhar|Aadhaar\s?No|ABHA\s?(?:No|Number|Address)|Ration\s?Card(?:\s?No)?|Voter\s?ID|EPIC(?:\s?No)?|PMJAY(?:\s?ID)?|Policy\s?No|Claim\s?No|Card\s?No)\b\s*[:#.]?\s*\S+/gi, "$1: " + R);
    t = t.replace(/\b(Pin\s?code|PIN)\b\s*[:#.]?\s*\d{6}\b/g, "$1: " + R);
    t = t.replace(/(नाम|पूरा नाम|పేరు|రోగి పేరు)\s*[:ः]\s*.+/g, "$1: " + R);                 // Hindi / Telugu "name:"
    return t;
  }

  function enabled() { try { return localStorage.getItem("smd_phi_india") !== "0"; } catch (e) { return true; } }

  return { apply: apply, foldDigits: foldDigits, enabled: enabled };
});
