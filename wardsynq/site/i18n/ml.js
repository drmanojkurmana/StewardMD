/* wardsynq/site/i18n/ml.js - മലയാളം catalog for the WardSynQ patient portal. D6.
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
    "lang.label": "ഭാഷ",

    "signout": "സൈൻ ഔട്ട്",

    "nav.map": "മാപ്പ്",
    "nav.workstation": "വർക്ക്സ്റ്റേഷൻ",
    "nav.ward": "വാർഡ്",
    "nav.beds": "ബെഡ് ബോർഡ്",
    "nav.emergency": "അടിയന്തരം",
    "nav.criticals": "ഗുരുതര ഫലങ്ങൾ",
    "nav.lab": "ലാബ്",
    "nav.radiology": "റേഡിയോളജി",
    "nav.opd": "OPD ഡെസ്ക്",
    "nav.patients": "രോഗികൾ",
    "nav.command": "കമാൻഡ്",
    "nav.commandCenter": "കമാൻഡ് സെന്റർ",
    "nav.twin": "ഡിജിറ്റൽ ട്വിൻ",
    "nav.reports": "റിപ്പോർട്ടുകൾ",
    "nav.billing": "ബില്ലിംഗ്",
    "nav.integration": "ഇന്റഗ്രേഷൻ",
    "nav.administration": "ഭരണം",
    "nav.adminCenter": "അഡ്മിൻ സെന്റർ",
    "nav.audit": "ഓഡിറ്റും സുരക്ഷയും",
    "nav.security": "സൈൻ-ഇൻ സുരക്ഷ",
    "nav.rota": "സ്റ്റാഫ് റോസ്റ്റർ",
    "nav.accounts": "അക്കൗണ്ടുകൾ"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("ml", "മലയാളം", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
