/* wardsynq/site/i18n.js - the words AROUND a patient's record, in the patient's language. P2.7, D6.
 *
 * Buildless ES5, no dependency. window.WSQI18n, and module.exports for tests.
 *
 * WHAT IS TRANSLATED: labels, headings, instructions and states that this product wrote ("Your
 * medicines", "No allergies are recorded"). WHAT IS NEVER TRANSLATED: anything a clinician or a
 * coding system recorded - drug names, doses, routes, frequencies, diagnosis text and codes, test
 * names, units, results, free-text instructions. Those are shown exactly as recorded, inside
 * translated labels. A machine-translated dose or drug name is a medication error waiting to happen,
 * so there is no function here that takes clinical text at all: t() only looks up keys.
 *
 * FALLBACK IS ENGLISH, PER KEY. A key missing from a language shows the English string, never the
 * key and never a blank. missingKeys(lang) lists them, and test/wardsynq-i18n.test.mjs prints that
 * list, so a gap is visible rather than silent.
 *
 * ONE FILE PER LANGUAGE (D6). This file owns only the engine and the English catalog - English is
 * the source of truth, owned by us. Every other language lives in its own wardsynq/site/i18n/<code>.js
 * (es, te, hi, bn, kn, ta, ml), which does nothing but call register() below; portal.js loads only
 * the visitor's chosen file (plus this one), so translators can never conflict with each other or
 * with this file. See docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md.
 *
 * PLUGGABLE. register(code, nativeName, catalog, {reviewed:false}) adds a language; nothing else
 * changes. A language registered with reviewed:false was written without a native-speaker clinical
 * review and must get one before it is relied on.
 *
 * t() returns PLAIN TEXT. Variables are substituted as given; the caller escapes the result.
 */
(function (root) {
  "use strict";

  var EN = {
    "lang.label": "Language",
    "lang.codedNote": "Medicine names, doses, test names, results and diagnoses are shown exactly as your care team recorded them. They are not translated.",

    "portal.title.yours": "Your record",
    "portal.title.proxy": "Record of {name}",
    "portal.thePatient": "the patient",
    "portal.proxyNote": "You are viewing as {relationship}, with the patient's agreement. You can see only what they agreed to share.",
    "portal.familyMember": "a family member",
    "section.failed": "We could not load this part of your record. This does not mean there is nothing here. Try again later.",

    "appt.title": "Appointments",
    "appt.tbc": "Time to be confirmed",
    "appt.with": "with {who}",
    "appt.empty": "No appointments are booked.",
    "appt.ask": "Ask for an appointment",
    "appt.askNote": "This sends a request. Nothing is booked until the hospital contacts you.",
    "appt.reason": "What is it for?",
    "appt.pref": "Days or times that suit you (optional)",
    "appt.send": "Send request",
    "appt.sent": "Request sent.",

    "meds.title": "Prescriptions and medicines",
    "meds.empty": "No current medicines are listed.",
    "results.title": "Lab and radiology results",
    "results.empty": "No results have been shared with you yet.",
    "dx.title": "Diagnoses",
    "dx.empty": "No diagnoses are listed.",
    "allergy.title": "Allergies",
    "allergy.empty": "No allergies are recorded.",

    "dc.title": "Discharge summaries and care instructions",
    "dc.stay": "Your stay",
    "dc.meds": "Medicines",
    "dc.care": "Care instructions",
    "dc.empty": "No discharge summary has been shared with you.",

    "bills.title": "Bills and payments",
    "bills.cancelled": "Cancelled",
    "bills.paid": "Paid",
    "bills.due": "Balance due {amount}",
    "bills.summary": "Charged {charged}, paid {paid}",
    "bills.empty": "You have no bills.",

    "consents.title": "Consents",
    "consents.withdraw": "Withdraw this consent",
    "consents.speak": "To withdraw this, speak to your care team.",
    "consents.empty": "No consents are recorded.",
    "consents.confirm": "Withdraw this consent from now? Your care team will see this.",

    "msg.title": "Messages to your care team",
    "msg.notEmergency": "This is not a way to get urgent help.",
    "msg.label": "Your message",
    "msg.send": "Send message",
    "msg.sent": "Sent.",
    "msg.reply": "Reply {when}:",
    "msg.unanswered": "Not answered yet.",
    "msg.empty": "You have not sent any messages.",
    "msg.writeFirst": "Write a message first.",

    "phase.loading": "Loading your record...",
    "phase.failed": "We could not load your record. This is a connection or server problem, not an empty record.",
    "phase.retry": "Try again",
    "phase.ended": "Your session has ended.",
    "phase.newCode": "Ask your care team for a new code.",
    "phase.startAgain": "Start again",
    "signout": "Sign out",

    "signin.title": "Sign in to your record",
    "signin.intro": "Use the access ID and code your care team gave you in person. The code works once.",
    "signin.hospital": "Hospital ID",
    "signin.access": "Access ID",
    "signin.code": "Code",
    "signin.submit": "Sign in",
    "signin.checking": "Checking...",
    "signin.invalid": "That code is not valid.",
    "signin.unreachable": "We could not reach the hospital. Check your connection and try again.",

    "action.failed": "That did not go through. Nothing was sent.",
    "action.failedShort": "That did not go through.",

    "status.title": "Your place in the OPD queue today",
    "status.loading": "Checking the queue...",
    "status.failed": "We could not load your queue status. This does not mean you are not in the queue. Please ask at the desk.",
    "status.off": "This hospital does not show queue status here. Please ask at the desk.",
    "status.ambiguous": "We cannot be sure which queue entry is yours, so none is shown. Please ask at the desk.",
    "status.empty": "You are not in the OPD queue today.",
    "status.where": "Where: {place}",
    "status.desk": "Registration desk, not yet sent to a room",
    "status.opd": "OPD",
    "status.state.waiting": "Waiting",
    "status.state.called": "You have been called. Please go in now.",
    "status.state.in-consultation": "With the doctor",
    "status.state.investigation": "Away for tests",
    "status.state.done": "Finished",
    "status.state.cancelled": "Cancelled",
    "status.state.missed": "Your turn was missed. Please ask at the desk.",
    "status.token": "Your token: {token}",
    "status.aheadNone": "You are next",
    "status.aheadOne": "1 person ahead of you",
    "status.ahead": "{n} people ahead of you",
    "status.eta": "Expected time: {time}",
    "status.noEta": "No estimate of the time",
    "status.refresh": "Check again",

    "docs.title": "Documents from your care team",
    "docs.empty": "No documents have been shared with you.",
    "docs.version": "version {n}",
    "docs.download": "Download",
    "docs.downloading": "Downloading...",
    "docs.failed": "This document could not be downloaded. Try again later.",
    "docs.withdrawn": "A document was withdrawn by the hospital.",
    "docs.unavailable": "A document is no longer available.",
    "docs.type.consent": "Consent form",
    "docs.type.referral-letter": "Referral letter",
    "docs.type.outside-report": "Report from another hospital",
    "docs.type.outside-imaging": "Scan from another hospital",
    "docs.type.id-proof": "ID proof",
    "docs.type.insurance": "Insurance",
    "docs.type.prescription-outside": "Prescription from another doctor",
    "docs.type.other": "Other document",

    "dc.full": "Full discharge summary",
    "dc.print": "Print this summary",
    "dc.withheld": "Withheld until your care team discusses it with you.",
    "dc.section.admission": "Your stay",
    "dc.section.diagnoses": "Diagnoses",
    "dc.section.allergies": "Allergies",
    "dc.section.vitals": "Observations",
    "dc.section.investigations": "Tests",
    "dc.section.medications": "Medicines in hospital",
    "dc.section.homeMedicines": "Medicines from before your stay",
    "dc.section.assessment": "Doctor's assessment",
    "dc.section.plan": "Care plan",

    "pcopy.noAllergies": "No allergies are recorded for you. Tell your care team if you know of any.",
    "pcopy.dx": "Your diagnoses",
    "pcopy.dxEmpty": "No diagnoses are recorded.",
    "pcopy.meds": "Your medicines",
    "pcopy.medsEmpty": "No medicines are recorded.",
    "pcopy.results": "Your results",
    "pcopy.resultsEmpty": "No results are ready to be given to you yet.",
    "pcopy.withheld": "Not included here",
    "pcopy.appts": "Next appointments",
    "pcopy.apptsEmpty": "No appointment is booked.",
    "pcopy.print": "Print",

    "nav.map": "Map",
    "nav.workstation": "Workstation",
    "nav.ward": "Ward",
    "nav.beds": "Bed board",
    "nav.emergency": "Emergency",
    "nav.criticals": "Critical results",
    "nav.lab": "Laboratory",
    "nav.radiology": "Radiology",
    "nav.opd": "OPD desk",
    "nav.patients": "Patients",
    "nav.command": "Command",
    "nav.commandCenter": "Command center",
    "nav.twin": "Digital twin",
    "nav.reports": "Reports",
    "nav.billing": "Billing",
    "nav.integration": "Integration",
    "nav.maik": "MaiK",
    "nav.administration": "Administration",
    "nav.adminCenter": "Admin Center",
    "nav.audit": "Audit and security",
    "nav.security": "Sign-in security",
    "nav.rota": "Staff rota",
    "nav.accounts": "Accounts"
  };

  var CATALOGS = { en: EN };
  var LANGS = [{ code: "en", name: "English", reviewed: true }];
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  /** A supported language code, or "en". */
  function normalize(code) { var c = String(code || "").toLowerCase().split("-")[0]; return has(CATALOGS, c) ? c : "en"; }

  /** PURE. The string for key in lang, English when that language lacks it, the key itself only when
   *  English lacks it too (a programming error, which the test catches). {name} placeholders filled. */
  function t(key, vars, lang) {
    var cat = CATALOGS[normalize(lang)];
    var s = has(cat, key) ? cat[key] : has(EN, key) ? EN[key] : key;
    return vars ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return has(vars, k) && vars[k] != null ? String(vars[k]) : m; }) : String(s);
  }

  /** PURE. English keys this language does not have, sorted. */
  function missingKeys(lang) {
    var cat = CATALOGS[normalize(lang)];
    return Object.keys(EN).filter(function (k) { return !has(cat, k); }).sort();
  }

  /** Adds or replaces a language. Keys not in English are ignored by t(), so a typo cannot hide.
   *  opts is {reviewed:false} (a bare boolean is accepted too, for old callers). */
  function register(code, name, catalog, opts) {
    var c = String(code || "").toLowerCase();
    if (!/^[a-z]{2,3}$/.test(c) || !catalog || typeof catalog !== "object") return false;
    var reviewed = opts && typeof opts === "object" ? opts.reviewed === true : opts === true;
    CATALOGS[c] = catalog;
    LANGS = LANGS.filter(function (l) { return l.code !== c; }).concat([{ code: c, name: String(name || c), reviewed: reviewed }]);
    return true;
  }

  function languages() { return LANGS.slice(); }

  var api = { t: t, normalize: normalize, missingKeys: missingKeys, register: register, languages: languages, _catalogs: CATALOGS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WSQI18n = api;
})(typeof window !== "undefined" ? window : null);
