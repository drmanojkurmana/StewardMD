/* wardsynq/site/i18n/kn.js - ಕನ್ನಡ catalog for the WardSynQ patient portal. D6.
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
    "lang.label": "ಭಾಷೆ",

    "signout": "ಸೈನ್ ಔಟ್",

    "nav.map": "ನಕ್ಷೆ",
    "nav.workstation": "ಕಾರ್ಯಸ್ಥಳ",
    "nav.ward": "ವಾರ್ಡ್",
    "nav.beds": "ಹಾಸಿಗೆ ಫಲಕ",
    "nav.emergency": "ತುರ್ತು",
    "nav.criticals": "ನಿರ್ಣಾಯಕ ಫಲಿತಾಂಶಗಳು",
    "nav.lab": "ಪ್ರಯೋಗಾಲಯ",
    "nav.radiology": "ವಿಕಿರಣಶಾಸ್ತ್ರ",
    "nav.opd": "OPD ಡೆಸ್ಕ್",
    "nav.patients": "ರೋಗಿಗಳು",
    "nav.command": "ಕಮಾಂಡ್",
    "nav.commandCenter": "ಕಮಾಂಡ್ ಕೇಂದ್ರ",
    "nav.twin": "ಡಿಜಿಟಲ್ ಟ್ವಿನ್",
    "nav.reports": "ವರದಿಗಳು",
    "nav.billing": "ಬಿಲ್ಲಿಂಗ್",
    "nav.integration": "ಏಕೀಕರಣ",
    "nav.administration": "ಆಡಳಿತ",
    "nav.adminCenter": "ಆಡಳಿತ ಕೇಂದ್ರ",
    "nav.audit": "ಲೆಕ್ಕಪರಿಶೋಧನೆ ಮತ್ತು ಭದ್ರತೆ",
    "nav.security": "ಸೈನ್-ಇನ್ ಭದ್ರತೆ",
    "nav.rota": "ಸಿಬ್ಬಂದಿ ವೇಳಾಪಟ್ಟಿ",
    "nav.accounts": "ಖಾತೆಗಳು"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("kn", "ಕನ್ನಡ", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
