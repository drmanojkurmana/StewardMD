/* functions/_wardsynq/privacy-law.js - which Indian privacy law applies to a hospital on a given day, and the clocks it
 * sets. PURE: no storage, no request.
 *
 * SOURCE. The legal opinion of 17 September 2026 (docs: section A, "Privacy: DPDP Act 2023, DPDP Rules 2025, and the
 * law in force today"). It is research for implementation, not legal advice, and awaits a practising lawyer's sign-off.
 * Each period below carries the citation the opinion gives; where the opinion marks a point unsettled the safest
 * default is used and the hospital may only make it stricter.
 *
 * THE DPDP DUTIES OF A HOSPITAL ARE NOT IN FORCE UNTIL ABOUT 13 MAY 2027.
 *   Act sections: G.S.R. 843(E) of 13 Nov 2025. On publication ss.1(2), 2, 18-26, 35, 38-43, 44(1), 44(3); after 12
 *   months s.6(9) and s.27(1)(d); after 18 months ss.3-17, 27-34, 36, 37 and s.44(2), which omits IT Act s.43A.
 *   Rules: G.S.R. 846(E) of 13 Nov 2025, r.1(2) rules 1, 2, 17-21 on publication; r.1(3) rule 4 (Consent Managers)
 *   one year after; r.1(4) rules 3, 5-16, 22, 23 eighteen months after.
 *   The gazette is dated 13 Nov and was published 14 Nov; the opinion counts from 13 Nov 2025 (the earlier day).
 * UNTIL THEN: IT Act 2000 s.43A with the SPDI Rules 2011, and the CERT-In Directions No. 20(3)/2022-CERT-In of
 * 28 Apr 2022. The stricter of the two regimes is kept by default after commencement (opinion A.4.1).
 */

import { requirement, citeOf } from "./legal-requirements.js";

const DAY = 86400000, HOUR = 3600000;
/* The dates and citations are the legal requirement registry's (legal-requirements.js). */
const PUBLISHED = requirement("IN-DPDP-PUBLISHED").effectiveFrom;
const CONSENT_MANAGER_START = requirement("IN-DPDP-R4-CONSENT-MANAGERS").effectiveFrom;
const DPDP_START = requirement("IN-DPDP-ACT-S3-17").effectiveFrom;
const MAX_DAYS_DPDP = 90;   // DPDP Rules 2025 r.14(3): a published grievance period "not exceeding ninety days"
const MAX_DAYS_SPDI = 30;   // SPDI Rules 2011 r.5(9): grievances redressed "within one month from the date of receipt"
const CERT_IN_HOURS = 6;    // CERT-In Directions 2022 (ii): report "within 6 hours of noticing"
const BOARD_DETAILED_HOURS = 72; // DPDP Rules 2025 r.7(2)(b): "within seventy-two hours of becoming aware of the breach"
const PRINCIPAL_TARGET_HOURS = 72; // r.7(1) says "without delay" with no number: a hospital policy target (opinion A.5)
const LOG_DAYS_CERT_IN = 180;      // CERT-In Directions 2022 (iv): "a rolling period of 180 days ... within the Indian jurisdiction"
const LOG_DAYS_DPDP = 365;         // DPDP Rules 2025 r.6(1)(e), r.8(3): logs kept "for a minimum period of one year"
const MAJORITY_YEARS = 18;         // DPDP Act s.2(f): a child is an individual who has not completed eighteen years

const CITE = Object.freeze(Object.fromEntries(Object.entries({
  dpdpCommencement: "IN-DPDP-ACT-S3-17", spdi: "IN-SPDI-2011", spdiGrievance: "IN-SPDI-R5-9", spdiConsent: "IN-SPDI-R5-1", spdiNotice: "IN-SPDI-R5-3",
  certIn: "IN-CERTIN-2022-II", certInLogs: "IN-CERTIN-2022-IV", dpdpRequests: "IN-DPDP-R14-3", dpdpBoard: "IN-DPDP-R7-2B", dpdpPrincipals: "IN-DPDP-R7-1",
  dpdpLogs: "IN-DPDP-R6-LOGS", dpdpNotice: "IN-DPDP-S5-R3", dpdpContact: "IN-DPDP-R9", children: "IN-DPDP-R10", disability: "IN-DPDP-R11", imcRecords: "IN-IMC-1-3-2",
}).map(([k, id]) => [k, citeOf(id)])));

const REQUEST_KINDS = Object.freeze(["access", "correction", "erasure", "grievance", "nomination"]);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(d + "T00:00:00+05:30");

/** PURE. The DPDP start date to use. A hospital may only bring it EARLIER (stricter), never past 13 May 2027. */
function dpdpStartOf(cfg) {
  const v = cfg && typeof cfg.dpdpStartDate === "string" ? cfg.dpdpStartDate.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(dayMs(v)) && v >= PUBLISHED && v <= DPDP_START) return { date: v, source: v === DPDP_START ? "default" : "hospital" };
  return { date: DPDP_START, source: "default" };
}

/** PURE. The law on a day. cfg: wardsynq.dpdp. The dates are India Standard Time days. */
function lawOn(cfg, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const start = dpdpStartOf(cfg);
  const dpdpInForce = now >= dayMs(start.date);
  const cmInForce = now >= dayMs(CONSENT_MANAGER_START);
  return {
    regime: dpdpInForce ? "dpdp-2025" : "spdi-2011",
    today: isoDay(now),
    published: PUBLISHED, consentManagerStart: CONSENT_MANAGER_START, dpdpStart: start.date, dpdpStartSource: start.source,
    dpdpInForce, consentManagersInForce: cmInForce,
    /* The day is unconfirmed (13 or 14 Nov 2025 publication), so 13 May 2027 is used as the earlier one. */
    dayUnconfirmed: true,
    citations: { commencement: CITE.dpdpCommencement, spdi: CITE.spdi, certIn: CITE.certIn },
  };
}

const intIn = (v, lo, hi) => { const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : null; };

/** PURE. The clocks, with confirmed defaults. A hospital value outside the legal cap is not used; the default is. */
function clocksOf(cfg, nowMs) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const law = lawOn(c, nowMs);
  const responseDays = {}, responseSource = {};
  for (const k of REQUEST_KINDS) {
    const set = intIn(c.responseDays && c.responseDays[k], 1, MAX_DAYS_DPDP);
    responseDays[k] = set != null ? set : 30;
    responseSource[k] = set != null ? "hospital" : "default";
  }
  /* The principal target may go past 72 hours only with a reason the DPO wrote (opinion A.5). */
  const reason = typeof c.breachPrincipalHoursReason === "string" ? c.breachPrincipalHoursReason.trim() : "";
  const ph = intIn(c.breachPrincipalHours, 1, reason.length >= 10 ? 720 : PRINCIPAL_TARGET_HOURS);
  return {
    law, responseDays, responseSource,
    caps: { dpdpDays: MAX_DAYS_DPDP, spdiDays: MAX_DAYS_SPDI, principalHours: PRINCIPAL_TARGET_HOURS },
    spdiDays: Math.min(responseDays.grievance, MAX_DAYS_SPDI),
    breachPrincipalHours: ph != null ? ph : PRINCIPAL_TARGET_HOURS, breachPrincipalSource: ph != null ? "hospital" : "default",
    breachPrincipalHoursReason: ph != null && ph > PRINCIPAL_TARGET_HOURS ? reason : null,
    certInHours: CERT_IN_HOURS, boardDetailedHours: BOARD_DETAILED_HOURS,
    citations: { spdi: CITE.spdiGrievance, dpdp: CITE.dpdpRequests, certIn: CITE.certIn, board: CITE.dpdpBoard, principals: CITE.dpdpPrincipals, contact: CITE.dpdpContact },
    confirmed: true,
  };
}

/** PURE. The answer clock for a request received at receivedAtIso. Before DPDP commencement the SPDI grievance clock
 * (one month, never longer than 30 days) applies to every request; from commencement the DPDP per-kind period. */
function requestClock(kind, receivedAtIso, clocks) {
  const at = Date.parse(receivedAtIso);
  const dpdp = at >= dayMs(clocks.law.dpdpStart);
  if (dpdp) {
    const days = clocks.responseDays[kind];
    return { dueBy: new Date(at + days * DAY).toISOString(), clock: { days, regime: "dpdp-2025", source: clocks.responseSource[kind], citation: CITE.dpdpRequests, cap: MAX_DAYS_DPDP } };
  }
  const days = clocks.spdiDays;
  const month = new Date(at); month.setUTCMonth(month.getUTCMonth() + 1);
  const due = Math.min(at + days * DAY, month.getTime());
  return { dueBy: new Date(due).toISOString(), clock: { days, regime: "spdi-2011", source: clocks.responseSource.grievance, citation: CITE.spdiGrievance, cap: MAX_DAYS_SPDI, dpdpFrom: clocks.law.dpdpStart } };
}

/** PURE. Age in whole years at a moment, or null when the date of birth is not recorded. */
function ageAt(dob, atMs) {
  const b = Date.parse(String(dob || ""));
  if (!Number.isFinite(b)) return null;
  const d = new Date(b), n = new Date(atMs);
  let age = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

/* What is processing for the child's health (Fourth Schedule Part A items 1 and 2) and what is not. */
const CARE_PURPOSES = Object.freeze(["treatment", "blood-products", "procedure", "share-external", "photography", "teleconsult"]);
const PARENT_VERIFY = Object.freeze(["id-held", "digilocker-token"]);
const GUARDIAN_SOURCES = Object.freeze(["court", "designated-authority", "local-level-committee"]);

/**
 * PURE. Whether a purpose needs verifiable parental consent (r.10) for this patient, and whether `verification`
 * satisfies it. Never required before DPDP commencement or for care. An unrecorded date of birth fails closed for a
 * non-care purpose: the record cannot show the patient is an adult.
 * verification: { method: id-held|digilocker-token, reference, parentName }
 */
function childGate({ dob, purpose, atMs, law, givenBy, verification }) {
  const age = ageAt(dob, atMs);
  const minor = age == null ? null : age < MAJORITY_YEARS;
  if (!law.dpdpInForce) return { required: false, minor, reason: "not-in-force", citation: CITE.children, from: law.dpdpStart };
  if (CARE_PURPOSES.includes(purpose)) return { required: false, minor, reason: "health-services-exempt", citation: CITE.children };
  if (minor === false) return { required: false, minor, reason: "adult", citation: CITE.children };
  const v = verification || {};
  const ok = (givenBy === "parent" || givenBy === "legal-guardian") && PARENT_VERIFY.includes(v.method) && String(v.reference || "").trim().length >= 3 && String(v.parentName || "").trim().length >= 2;
  return { required: true, minor, satisfied: ok, reason: minor == null ? "date-of-birth-not-recorded" : "minor", citation: CITE.children };
}

/** PURE. r.11: a guardian consenting for an adult names who appointed them. Only from commencement. */
function guardianGate({ givenBy, appointment, law, minor }) {
  if (!law.dpdpInForce || givenBy !== "legal-guardian" || minor === true) return { required: false };
  const a = appointment || {};
  return { required: true, satisfied: GUARDIAN_SOURCES.includes(a.source) && String(a.orderRef || "").trim().length >= 3, citation: CITE.disability };
}

export {
  DAY, HOUR, PUBLISHED, CONSENT_MANAGER_START, DPDP_START, MAX_DAYS_DPDP, MAX_DAYS_SPDI, CERT_IN_HOURS, BOARD_DETAILED_HOURS,
  PRINCIPAL_TARGET_HOURS, LOG_DAYS_CERT_IN, LOG_DAYS_DPDP, MAJORITY_YEARS, CITE, REQUEST_KINDS, CARE_PURPOSES, PARENT_VERIFY, GUARDIAN_SOURCES,
  dpdpStartOf, lawOn, clocksOf, requestClock, ageAt, childGate, guardianGate, dayMs,
};
