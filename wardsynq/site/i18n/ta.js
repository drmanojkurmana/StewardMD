/* wardsynq/site/i18n/ta.js - தமிழ் catalog for the WardSynQ patient portal. D6.
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
    "lang.label": "மொழி",

    "signout": "வெளியேறு",

    "nav.map": "வரைபடம்",
    "nav.workstation": "பணிநிலையம்",
    "nav.ward": "வார்டு",
    "nav.beds": "படுக்கை பலகை",
    "nav.emergency": "அவசரம்",
    "nav.lab": "ஆய்வகம்",
    "nav.radiology": "கதிரியக்கவியல்",
    "nav.opd": "OPD மேசை",
    "nav.patients": "நோயாளிகள்",
    "nav.command": "கட்டளை",
    "nav.commandCenter": "கட்டளை மையம்",
    "nav.twin": "டிஜிட்டல் இரட்டை",
    "nav.reports": "அறிக்கைகள்",
    "nav.billing": "கட்டணம்",
    "nav.integration": "ஒருங்கிணைப்பு",
    "nav.administration": "நிர்வாகம்",
    "nav.adminCenter": "நிர்வாக மையம்",
    "nav.audit": "தணிக்கை மற்றும் பாதுகாப்பு",
    "nav.security": "உள்நுழைவு பாதுகாப்பு",
    "nav.rota": "பணியாளர் அட்டவணை",
    "nav.accounts": "கணக்குகள்"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("ta", "தமிழ்", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
