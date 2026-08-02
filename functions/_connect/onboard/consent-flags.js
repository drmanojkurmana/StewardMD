// functions/_connect/onboard/consent-flags.js — Consent Dashboard flag gate (additive, default OFF;
// Consent Dashboard Increment 1). consentFlagOn requires ALL of: smd_connect (CONNECT_FLAG), smd_connect_onboard
// (CONNECT_ONBOARD_FLAG), AND the new, narrow smd_connect_consent (CONNECT_CONSENT_FLAG) -- any one OFF means
// the /consents surface is a 404 (no existence leak), the SAME three-flag-AND idiom onboardFlagOn/restFlagOn/
// dicomFlagOn/aiMapFlagOn already use. Kept as its OWN flag (rather than just riding onboardFlagOn) because
// listing consents and revoking one is a narrower, newer, more sensitive surface than the rest of onboarding --
// a deployment can run the existing onboard wizard with the Consent Dashboard still dark.
import { onboardFlagOn } from "./flags.js";
export function consentFlagOn(env) { return onboardFlagOn(env) && String(env && env.CONNECT_CONSENT_FLAG) === "1"; } // // VERIFY env name
