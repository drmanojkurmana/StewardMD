/* wardsynq/site/i18n/mr.js - मराठी catalog for the WardSynQ patient portal. D6.
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
    "lang.label": "भाषा",

    "signout": "साइन आउट",

    "nav.map": "नकाशा",
    "nav.workstation": "वर्कस्टेशन",
    "nav.ward": "वॉर्ड",
    "nav.beds": "बेड बोर्ड",
    "nav.emergency": "आपत्कालीन",
    "nav.criticals": "गंभीर निष्कर्ष",
    "nav.lab": "प्रयोगशाळा",
    "nav.radiology": "रेडिओलॉजी",
    "nav.opd": "OPD डेस्क",
    "nav.patients": "रुग्ण",
    "nav.command": "कमांड",
    "nav.commandCenter": "कमांड सेंटर",
    "nav.twin": "डिजिटल ट्विन",
    "nav.reports": "अहवाल",
    "nav.billing": "बिलिंग",
    "nav.integration": "एकत्रीकरण",
    "nav.administration": "प्रशासन",
    "nav.adminCenter": "प्रशासकीय केंद्र",
    "nav.audit": "लेखापरीक्षण आणि सुरक्षा",
    "nav.security": "साइन-इन सुरक्षा",
    "nav.rota": "कर्मचारी वेळापत्रक",
    "nav.accounts": "खाती"
  };

  if (root && root.WSQI18n) root.WSQI18n.register("mr", "मराठी", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
