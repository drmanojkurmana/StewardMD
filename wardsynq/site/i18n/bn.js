/* wardsynq/site/i18n/bn.js - বাংলা catalog for the WardSynQ patient portal. D6.
 *
 * Owned by Antigravity: see docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md before editing.
 * reviewed:false - NOT yet checked by a native speaker with clinical context. English (i18n.js) is
 * the fallback for any key not yet here, so an empty or partial file is always safe to ship.
 *
 * First pass imported from Antigravity's branch feat/wardsynq-multilingual-emr (363117f5), checked for
 * clinical meaning (negation, numbers, placeholders) but not by a native speaker.
 *
 * This file does ONE thing: register this catalog with the engine (window.WSQI18n, loaded first).
 * module.exports = the catalog, for tests. No other logic belongs here.
 */
(function (root) {
  "use strict";

  var catalog = {
    "lang.label": "ভাষা",

    "signout": "সাইন আউট",

    "nav.map": "মানচিত্র",
    "nav.workstation": "ওয়ার্কস্টেশন",
    "nav.ward": "ওয়ার্ড",
    "nav.beds": "বেড বোর্ড",
    "nav.emergency": "জরুরি",
    "nav.criticals": "গুরুতর ফলাফল",
    "nav.lab": "পরীক্ষাগার",
    "nav.radiology": "রেডিওলজি",
    "nav.opd": "OPD ডেস্ক",
    "nav.patients": "রোগী",
    "nav.command": "কমান্ড",
    "nav.commandCenter": "কমান্ড সেন্টার",
    "nav.twin": "ডিজিটাল টুইন",
    "nav.reports": "প্রতিবেদন",
    "nav.billing": "বিলিং",
    "nav.integration": "ইন্টিগ্রেশন",
    "nav.administration": "প্রশাসন",
    "nav.adminCenter": "প্রশাসনিক কেন্দ্র",
    "nav.audit": "নিরীক্ষা ও নিরাপত্তা",
    "nav.security": "সাইন-ইন নিরাপত্তা",
    "nav.rota": "কর্মী তালিকা"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("bn", "বাংলা", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
