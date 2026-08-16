/* StewardMD — Privacy & Data-Control configuration (SINGLE SOURCE OF TRUTH).
 * ---------------------------------------------------------------------------
 * All privacy/consent version strings, dates, contacts and tunables live HERE
 * so they are maintained in one place, never hardcoded across components.
 * Bump the version strings when the Privacy Notice or Terms materially change;
 * users whose recorded consent predates the new version are re-prompted.
 *
 * This is product tooling for data control — NOT a legal-compliance claim. The
 * app never states it is "DPDP compliant", "HIPAA compliant", "certified", or
 * "fully secure".
 *
 * Loaded before privacy.js. Pure data + tiny helpers; no DOM, no side effects.
 */
(function () {
  "use strict";
  var CFG = {
    // ---- versions (bump on material change) --------------------------------
    privacyPolicyVersion: "2026-08-16",
    termsVersion: "2026-08-16",
    effectiveDate: "16 August 2026",

    // ---- operator / contact ------------------------------------------------
    operator: "StewardMD",
    contactEmail: "privacy@stewardmd.in",

    // ---- data-control tunables --------------------------------------------
    softDeleteDays: 7,            // recovery window before permanent purge

    // ---- runtime kill-switch (localStorage; default ON) --------------------
    // Set localStorage['smd_privacy_gate'] = "0" to disable the consent gate
    // instantly without a redeploy (reversible-change practice).
    gateFlagKey: "smd_privacy_gate",

    // ---- service providers actually used by this project ------------------
    // Rendered dynamically into the Privacy Notice. Do NOT list providers the
    // app does not use.
    serviceProviders: [
      { name: "Google Firebase Authentication", role: "sign-in / account identity (Google, Apple, and email sign-in)" },
      { name: "Google Cloud Firestore", role: "storage of your account, consent records and your own saved cases (India, Mumbai)" },
      { name: "Cloudflare Pages, Workers & KV", role: "app hosting, backend API routes, per-user case storage, and security" },
      { name: "Google Vertex AI / Gemini", role: "AI features you request: MaiK explanations, structuring text read from a photo, and reading a submitted registration credential to confirm eligibility" },
      { name: "Groq", role: "large-language-model processing for certain AI features you request" },
      { name: "Google Cloud Run (Mumbai)", role: "hosted image-analysis models for the optional imaging modules (ECG / chest X-ray / skin), only when you enable and use them" },
      { name: "Additional AI model providers (as configured)", role: "some AI requests may be routed to other reputable model providers (for example Microsoft Azure OpenAI); the current list is available at privacy@stewardmd.in" }
    ]
  };

  // Is the consent gate active? Default ON; "0" disables.
  function gateOn() {
    try { return localStorage.getItem(CFG.gateFlagKey) !== "0"; } catch (e) { return true; }
  }

  window.SMD_PRIVACY = {
    cfg: CFG,
    gateOn: gateOn,
    // Convenience accessors so components never re-declare version literals.
    privacyPolicyVersion: CFG.privacyPolicyVersion,
    termsVersion: CFG.termsVersion,
    effectiveDate: CFG.effectiveDate,
    contactEmail: CFG.contactEmail,
    softDeleteDays: CFG.softDeleteDays,
    serviceProviders: CFG.serviceProviders.slice()
  };
})();
