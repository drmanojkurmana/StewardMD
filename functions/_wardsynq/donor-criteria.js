/* functions/_wardsynq/donor-criteria.js - who may give blood today: the donor selection criteria, the deferral table and
 * the per-hospital settings that may only make them stricter. PURE, no I/O. blood-bank.js enforces it at screening and
 * collection; Admin > Hospital edits the settings; both screens show where each value in force comes from.
 *
 * TWO STANDARDS, THE STRICTER ENFORCED (owner decision 2026-09-17, corrected the same day by the legal review, section G
 * of the 2026-09-17 legal opinion):
 *   WHO. Blood donor selection: guidelines on assessing donor suitability for blood donation. Geneva: World Health
 *     Organization; 2012. ISBN 978 92 4 154851 9. Read 2026-09-17 on NCBI Bookshelf (chapter 4 NBK138219, chapter 6
 *     NBK138208, chapter 7 NBK138223); a search that day found no later WHO edition. Cited below as "WHO <section>".
 *   India ("IN"). Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, "H. Criteria for Blood Donation" as substituted
 *     by G.S.R. 166(E) of 11 March 2020 (Gazette of India, Extraordinary, Part II Section 3(i)), read 2026-09-17 from
 *     https://drugscontrol.py.gov.in/sites/default/files/GSR-166-E.pdf. These are licence conditions of a blood centre
 *     (rules 122-P and 122-O). Cited below as "item <serial number>" of that table.
 *   Where WHO sets no yearly maximum, the Council of Europe (EDQM) Guide to the preparation, use and quality assurance of
 *     blood components, 22nd edition (2025), standard 2.4.1.4, is used and named ("CoE").
 * The value in force for each criterion is the stricter of WHO and the law of the hospital's jurisdiction (legalMinimums,
 * chosen by the hospital's region: India unless the region is another country). A hospital may set a stricter value on
 * Admin, never a looser one. Where neither standard sets a value nothing is checked, unless the hospital sets a limit.
 *
 * DAYS. A week is 7 days, a month 30.5 days and a year 365.25 days, each rounded UP, so a deferral or interval in days
 * is never shorter than the calendar period it stands for.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-blood-bank.test.mjs test/org-blood-donor-criteria.test.mjs
 */

import { requirement, citeOf, ENFORCED } from "./legal-requirements.js";

const DAY = 86400000;
const str = (v) => (v == null ? "" : String(v).trim());

const STANDARDS = Object.freeze({
  who: "WHO, Blood donor selection: guidelines on assessing donor suitability for blood donation (2012)",
  coe: "Council of Europe, Guide to the preparation, use and quality assurance of blood components, 22nd edition (2025)",
  IN: citeOf("IN-DCR-XIIB-H"),
});

const DONATION_TYPES = Object.freeze(["whole-blood", "apheresis-platelets", "apheresis-plasma"]);
const HB_METHODS = Object.freeze(["venous-analyser", "capillary-haemoglobinometer", "other-validated"]);

/* Each criterion: the stricter direction, a range that only catches typos, and WHO's value with its section (null when
 * WHO sets none). exclusive: the limit value itself fails ("more than"). decimal: not a whole number. */
const CRITERIA = Object.freeze({
  /* WHO 4.1.1 "The usual lower age limit for blood donation is 18 years" (16 or 17 only where national law permits). */
  minAge: { stricter: "higher", range: [16, 30], who: { value: 18, ref: "4.1.1" } },
  /* WHO 4.1.2 "The usual upper age limit for blood donation is 65 years"; "First-time donors older than 60 years and
   * regular donors over the age of 65 may be accepted at the discretion of the responsible physician". Completed years;
   * a donor with no donation recorded here is a first-time donor. */
  maxAge: { stricter: "lower", range: [40, 80], who: { value: 65, ref: "4.1.2" } },
  firstTimeMaxAge: { stricter: "lower", range: [40, 80], who: { value: 60, ref: "4.1.2" } },
  /* WHO 4.10: apheresis donors meet the same medical criteria as whole blood donors, so the same upper age. */
  apheresisMaxAge: { stricter: "lower", range: [40, 80], who: { value: 65, ref: "4.10" } },
  /* WHO 4.4 "at least 45 kg to donate 350 ml +/- 10% and 50 kg to donate 450 ml +/- 10%"; "Prospective donors of
   * apheresis platelet or plasma donations should weigh at least 50 kg". */
  minWeightKg350: { stricter: "higher", range: [40, 100], decimal: true, who: { value: 45, ref: "4.4" } },
  minWeightKg450: { stricter: "higher", range: [40, 100], decimal: true, who: { value: 50, ref: "4.4" } },
  apheresisMinWeightKg: { stricter: "higher", range: [40, 100], decimal: true, who: { value: 50, ref: "4.4" } },
  /* WHO 4.6.1 "not less than 12.0 g/dl for females and not less than 13.0 g/dl for males", measured before each donation
   * "using a validated technique that is subject to quality control" (the method is recorded). */
  minHbFemale: { stricter: "higher", range: [10, 17], decimal: true, who: { value: 12.0, ref: "4.6.1" } },
  minHbMale: { stricter: "higher", range: [10, 17], decimal: true, who: { value: 13.0, ref: "4.6.1" } },
  /* WHO 4.6.2 "The minimum interval between donations of whole blood should be 12 weeks for males and 16 weeks for
   * females". Days since the last whole blood donation. */
  intervalDaysMale: { stricter: "higher", range: [56, 365], who: { value: 84, ref: "4.6.2" } },
  intervalDaysFemale: { stricter: "higher", range: [56, 365], who: { value: 112, ref: "4.6.2" } },
  /* WHO sets no yearly maximum. CoE 2.4.1.4 "A maximum of 6 standard donations of whole blood per year can be taken from
   * male and up to 4 per year from female donors". Whole blood donations in the 365 days up to and including this one. */
  maxPerYearMale: { stricter: "lower", range: [1, 12], who: null, coe: { value: 6, ref: "2.4.1.4" } },
  maxPerYearFemale: { stricter: "lower", range: [1, 12], who: null, coe: { value: 4, ref: "2.4.1.4" } },
  /* WHO 4.6.2 "The minimum interval between donations of platelets should be 4 weeks"; "of plasma should be 2 weeks";
   * "at least 4 weeks following a whole blood donation, an apheresis red cell donation or a failed return of red cells
   * during apheresis". Days since the last apheresis, the last whole blood donation, or an incomplete red cell return. */
  apheresisIntervalDaysPlatelets: { stricter: "higher", range: [2, 365], who: { value: 28, ref: "4.6.2" } },
  apheresisIntervalDaysPlasma: { stricter: "higher", range: [2, 365], who: { value: 14, ref: "4.6.2" } },
  apheresisMaxPer7Days: { stricter: "lower", range: [1, 7], who: null },
  apheresisMaxPerYear: { stricter: "lower", range: [1, 52], who: null },
  apheresisAfterWholeBloodDays: { stricter: "higher", range: [1, 365], who: { value: 28, ref: "4.6.2" } },
  apheresisAfterIncompleteReinfusionDays: { stricter: "higher", range: [1, 365], who: { value: 28, ref: "4.6.2" } },
  wholeBloodAfterApheresisDays: { stricter: "higher", range: [1, 365], who: null },
  wholeBloodAfterIncompleteReinfusionDays: { stricter: "higher", range: [1, 365], who: null },
  /* WHO 4.10 "For apheresis platelet donation the donor's platelet count should be above 150 x 10^9/L. For apheresis
   * plasma donation, the donor's total protein level should be greater than 60 g/L." */
  minPlateletCount: { stricter: "higher", range: [100, 400], who: { value: 150, ref: "4.10", exclusive: true } },
  minTotalProteinGL: { stricter: "higher", range: [50, 90], decimal: true, who: { value: 60, ref: "4.10", exclusive: true } },
  /* WHO 4.5.2: febrile, "a core oral temperature more than 37.6 C", is deferred. */
  maxTemperatureC: { stricter: "lower", range: [35, 40], decimal: true, who: { value: 37.6, ref: "4.5.2" } },
  /* WHO 4.5.3 and 4.5.1 leave blood pressure and pulse to the blood service, suggesting systolic 100-140 and diastolic
   * 60-90 mmHg "If blood pressure is used as a selection criterion", and a normal pulse of 60-100. */
  systolicMin: { stricter: "higher", range: [60, 160], who: null, suggested: { value: 100, ref: "4.5.3" } },
  systolicMax: { stricter: "lower", range: [100, 220], who: null, suggested: { value: 140, ref: "4.5.3" } },
  diastolicMin: { stricter: "higher", range: [30, 100], who: null, suggested: { value: 60, ref: "4.5.3" } },
  diastolicMax: { stricter: "lower", range: [60, 130], who: null, suggested: { value: 90, ref: "4.5.3" } },
  pulseMin: { stricter: "higher", range: [30, 100], who: null, suggested: { value: 60, ref: "4.5.1" } },
  pulseMax: { stricter: "lower", range: [60, 160], who: null, suggested: { value: 100, ref: "4.5.1" } },
});

/* The screening questions. Every yes needs a deferral, recorded against one or more conditions of the table below. */
const QUESTIONS = Object.freeze(["illness", "infection-history", "malaria", "jaundice", "tattoo", "transfusion", "surgery", "pregnancy",
  "high-risk", "chronic-disease", "vaccination", "medication", "harvest", "pre-donation", "foreign-resident"]);

/* THE DEFERRAL TABLE. days: whole days from the date given (recovery, last dose, procedure, delivery, arrival), "permanent",
 * or null when the standard gives no fixed period (until the condition resolves: the blood bank sets the days). */
const DEFERRALS = Object.freeze({
  "minor-illness": { question: "illness", who: { days: 14, ref: "4.3" } },                        // "defer for 14 days following full recovery"
  typhoid: { question: "infection-history", who: { days: 28, ref: "7.5.5" } },                    // salmonella: "28 days following full recovery"
  "dengue-chikungunya": { question: "infection-history", who: { days: 183, ref: "7.3.5" } },      // "6 months following full recovery"
  tuberculosis: { question: "infection-history", who: { days: 731, ref: "7.5.6" } },             // "2 years following confirmation of cure"
  malaria: { question: "malaria", who: { days: 183, ref: "7.4.1" } },                             // endemic areas: "6 months after completion of treatment and full recovery"
  "hepatitis-a-e": { question: "jaundice", who: { days: 366, ref: "7.3.1" } },                   // HAV, HEV, unknown origin: "12 months after full recovery"
  "hepatitis-b-c-unknown": { question: "jaundice", who: { days: 366, ref: "7.3.1" } },           // HBV 12 months with testing; HCV permanent
  tattoo: { question: "tattoo", who: { days: 366, ref: "7.9.5" } },                               // "12 months following the last procedure"
  transfusion: { question: "transfusion", who: { days: 366, ref: "6.3.1" } },                     // "Recipients of blood transfusion: defer for 12 months"
  "major-surgery": { question: "surgery", who: { days: 366, ref: "6.4" } },                       // "Major surgery: defer for 12 months"
  "delivery": { question: "pregnancy", who: { days: 183, ref: "4.8.1" } },                        // "up to 6 months after delivery or termination"
  abortion: { question: "pregnancy", who: { days: 183, ref: "4.8.1" } },
  breastfeeding: { question: "pregnancy", who: { days: null, ref: "4.8.1" } },                    // "during lactation"
  "high-risk-behaviour": { question: "high-risk", who: { days: "permanent", ref: "7.9.1" } },
  "high-risk-contact": { question: "high-risk", who: { days: 366, ref: "7.9.1" } },               // former sexual contacts: 12 months
  "heart-disease": { question: "chronic-disease", who: { days: null, ref: "5.2" } },
  "insulin-diabetes": { question: "chronic-disease", who: { days: null, ref: "5.5" } },
  malignancy: { question: "chronic-disease", who: { days: null, ref: "5.9" } },
  "bleeding-disorder": { question: "chronic-disease", who: { days: null, ref: "5.1" } },
  epilepsy: { question: "chronic-disease", who: { days: null, ref: "5.8" } },
  "transplant-recipient": { question: "chronic-disease", who: { days: "permanent", ref: "6.3.2" } }, // stem cell or organ transplantation
  "vaccine-inactivated": { question: "vaccination", who: { days: null, ref: "6.1.3" } },          // accepted if well, HBV vaccine 14 days
  "vaccine-live": { question: "vaccination", who: { days: 28, ref: "6.1.2" } },
  "rabies-hbig": { question: "vaccination", who: { days: 366, ref: "6.1.1" } },                    // post-exposure prophylaxis: 12 months
  antibiotics: { question: "medication", who: { days: 14, ref: "6.2" } },
  aspirin: { question: "medication", who: { days: 5, ref: "6.2" } },
  isotretinoin: { question: "medication", who: { days: 28, ref: "6.2" } },
  finasteride: { question: "medication", who: { days: 28, ref: "6.2" } },
  dutasteride: { question: "medication", who: { days: 183, ref: "6.2" } },
  "bp-medication-change": { question: "medication", who: null },
  "marrow-harvest": { question: "harvest", who: null },
  "stem-cell-harvest": { question: "harvest", who: null },
  "pre-donation": { question: "pre-donation", who: { days: null, ref: "4.7" } },
  "foreign-resident": { question: "foreign-resident", who: null },
  other: { question: null, who: null },
});

/* LEGAL MINIMUMS, by jurisdiction. Filled from the legal review (2026-09-17, section G) and read against the gazette text
 * the same day; every value carries its item. A later change to the law is a code release citing the amending
 * notification, never a hospital setting. */
const legalMinimums = Object.freeze({
  IN: Object.freeze({
    criteria: Object.freeze({
      minAge: { value: 18, item: "2" },                        // "Minimum age 18 years"
      maxAge: { value: 65, item: "2" },                        // "Maximum age 65 years ... for repeat donor upper limit is 65 years"
      firstTimeMaxAge: { value: 60, item: "2" },               // "First time donor shall not be over 60 years of age"
      apheresisMaxAge: { value: 60, item: "2" },               // "For apheresis donors 18-60 years"
      minWeightKg350: { value: 45, item: "3" },                // "350 ml- 45 kg"
      minWeightKg450: { value: 55, item: "3", exclusive: true }, // "450ml- more than 55 kg"
      apheresisMinWeightKg: { value: 50, item: "3" },          // "Apheresis- 50 kg"
      minHbFemale: { value: 12.5, item: "9" },                 // ">or =12.5g/dL"
      minHbMale: { value: 12.5, item: "9" },
      intervalDaysMale: { value: 90, item: "4" },              // "once in three months (90 days) for males"
      intervalDaysFemale: { value: 120, item: "4" },           // "and four months (120 days) for females"
      apheresisIntervalDaysPlatelets: { value: 2, item: "4" }, // "at least 48 hours interval after platelet/ plasma - apheresis"
      apheresisIntervalDaysPlasma: { value: 2, item: "4" },
      apheresisMaxPer7Days: { value: 2, item: "4" },           // "not more than 2 times a week"
      apheresisMaxPerYear: { value: 24, item: "4" },           // "limited to 24 in one year"
      apheresisAfterWholeBloodDays: { value: 28, item: "4" },  // "After whole blood donation a plateletpheresis donor shall not be accepted before 28 days"
      wholeBloodAfterApheresisDays: { value: 28, item: "4" },  // "not be accepted for whole blood donation before 28 days from the last platelet donation"
      wholeBloodAfterIncompleteReinfusionDays: { value: 90, item: "4" }, // "If the reinfusion of red cells was not complete ... within 90 days"
      systolicMin: { value: 100, item: "5" },                  // "100-140mm Hg systolic 60-90 mm Hg diastolic with or without medications"
      systolicMax: { value: 140, item: "5" },
      diastolicMin: { value: 60, item: "5" },
      diastolicMax: { value: 90, item: "5" },
      pulseMin: { value: 60, item: "6" },                      // "60-100 Regular"
      pulseMax: { value: 100, item: "6" },
    }),
    /* Measured at every screening: blood pressure (item 5), a regular pulse (item 6), temperature "Afebrile" (item 7).
     * Item 7 also prints "37 C/98.4 F", read here as normal body temperature rather than a ceiling, so febrile is WHO
     * 4.5.2's more than 37.6 C; a centre that reads it as a ceiling sets 37.0 on Admin. */
    measure: Object.freeze({ bp: "5", pulse: "6", temperature: "7" }),
    /* No physician's discretion past the age limits: item 2 states them without one. */
    ageDiscretion: false,
    deferrals: Object.freeze({
      "minor-illness": { days: null, item: "19, 20" },         // "until all symptoms subside and donor is afebrile"
      typhoid: { days: 366, item: "59" },                      // "12 Months following full recovery"
      "dengue-chikungunya": { days: 183, item: "60" },         // "6 Months following full recovery"
      tuberculosis: { days: 731, item: "62" },                 // "2 years following confirmation of cure"
      malaria: { days: 92, item: "58" },                       // "3 months following full recovery"
      "hepatitis-a-e": { days: 366, item: "46" },              // "Known hepatitis A or E - Defer for 12 months"
      "hepatitis-b-c-unknown": { days: "permanent", item: "46" }, // "Known Hepatitis B, C - Permanently defer"; "Unknown Hepatitis - Permanently defer"
      tattoo: { days: 366, item: "48" },                       // tattoos, acupuncture, body piercing: "Defer for 12 months"
      transfusion: { days: 366, item: "26" },                  // "Received Blood Transfusion - Defer for 12 months"
      "major-surgery": { days: 366, item: "24" },              // "Defer for 12 months after recovery"
      delivery: { days: 366, item: "15" },                     // "Defer for 12 Months after delivery"
      abortion: { days: 183, item: "16" },                     // "Defer for 6 months after abortion"
      breastfeeding: { days: null, item: "17" },               // "Defer for total period of lactation"
      /* Item 52 is UNDER_CHALLENGE in the registry (Thangjam Santa Singh v Union of India), not stayed, so enforced exactly as
       * the Rule states (owner's legal guidance 2026-09-17 item 5). It drops out only if the registry says STAYED or STRUCK_DOWN. */
      "high-risk-behaviour": { days: "permanent", item: "52", requirement: "IN-DCR-XIIB-H-52" },
      "high-risk-contact": { days: 366, item: "47, 49" },
      "heart-disease": { days: "permanent", item: "31-37" },
      "insulin-diabetes": { days: "permanent", item: "43, 101" },
      malignancy: { days: "permanent", item: "76" },
      "bleeding-disorder": { days: "permanent", item: "75" },
      epilepsy: { days: "permanent", item: "40" },
      "transplant-recipient": { days: "permanent", item: "103" },
      "vaccine-inactivated": { days: 14, item: "79" },
      "vaccine-live": { days: 28, item: "80" },
      "rabies-hbig": { days: 366, item: "82" },                // "Defer for 1 year"
      antibiotics: { days: 14, item: "92" },                   // "Defer for 2 Weeks after last dose"
      aspirin: { days: 3, item: "90" },                        // "Defer for 3 days if blood is to be used for Platelet preparation"
      isotretinoin: { days: 31, item: "95" },                  // "Defer for 1 month after the last dose"
      finasteride: { days: 31, item: "96" },
      dutasteride: { days: 183, item: "98" },                  // "Defer for 6 months after the last dose"
      "bp-medication-change": { days: 28, item: "5" },         // "Neither the drug nor its dosage should have been altered in the last 28 days"
      "marrow-harvest": { days: 366, item: "4" },              // "within 12 months after a bone marrow harvest"
      "stem-cell-harvest": { days: 183, item: "4" },           // "within 6 months after a peripheral stem cell harvest"
      "pre-donation": { days: null, item: "10, 11" },          // meal at least 4 hours before, no alcohol, 24 hours before a duty shift
      "foreign-resident": { days: 1096, item: "104" },         // "Accept only after stay in India for three continuous years", from arrival
    }),
  }),
});

/** PURE. The jurisdiction whose law applies: India unless the hospital's region names another country. */
function jurisdictionOf(region) { return !str(region) || str(region).toUpperCase() === "IN" ? "IN" : null; }

/** PURE. The stricter of two limits { value, exclusive }; either may be null. */
function stricterLimit(dir, a, b) {
  if (!a || a.value == null) return b && b.value != null ? b : null;
  if (!b || b.value == null) return a;
  if (a.value !== b.value) return (dir === "higher" ? a.value > b.value : a.value < b.value) ? a : b;
  return a.exclusive || !b.exclusive ? a : b;
}
/** PURE. Whether x meets a limit (null limit: nothing checked). */
function meets(dir, x, lim) {
  if (!lim || lim.value == null) return true;
  if (typeof x !== "number" || Number.isNaN(x)) return false;   // Infinity is "never happened", which meets an interval
  return dir === "higher" ? (lim.exclusive ? x > lim.value : x >= lim.value) : (lim.exclusive ? x < lim.value : x <= lim.value);
}
const longer = (a, b) => (a === "permanent" || b === "permanent" ? "permanent" : a == null ? b : b == null ? a : Math.max(a, b));

function flatSettings(o) {
  const out = {};
  for (const [k, v] of Object.entries(o && typeof o === "object" && !Array.isArray(o) ? o : {})) {
    if (k === "deferrals" && v && typeof v === "object" && !Array.isArray(v)) for (const [c, n] of Object.entries(v)) out[`deferrals.${c}`] = n;
    else out[k] = v;
  }
  return out;
}

/* PURE. A law entry that names a registry requirement carries its status (and any challenge), and is used only while the
 * registry says it is enforced: UNDER_CHALLENGE is, STAYED and STRUCK_DOWN are not. */
function lawEntry(x) {
  if (!x || !x.requirement) return x || null;
  const r = requirement(x.requirement);
  return ENFORCED.includes(r.status) ? { ...x, status: r.status, ...(r.challenge ? { challenge: r.challenge } : {}) } : null;
}

/** PURE. The standards' value in force for one criterion or deferral before any hospital setting, with its source. */
function standardFor(key, jurisdiction, legal = legalMinimums) {
  const law = jurisdiction && legal[jurisdiction];
  if (key.startsWith("deferrals.")) {
    const c = key.slice(10), d = DEFERRALS[c];
    if (!d) return null;
    const le = lawEntry(law && law.deferrals && law.deferrals[c]);
    const w = d.who ? d.who.days : null, l = le ? le.days : null;
    const days = longer(w, l);
    return { days, source: days == null ? "none" : w === l ? "both" : days === l ? "law" : "who",
      who: d.who || null, law: le };
  }
  const d = CRITERIA[key];
  if (!d) return null;
  const who = d.who ? { value: d.who.value, exclusive: !!d.who.exclusive } : d.coe ? { value: d.coe.value, exclusive: false } : null;
  const l = law && law.criteria[key] ? { value: law.criteria[key].value, exclusive: !!law.criteria[key].exclusive } : null;
  const lim = stricterLimit(d.stricter, who, l);
  const same = who && l && who.value === l.value && who.exclusive === l.exclusive;
  return { limit: lim, source: !lim ? "none" : same ? "both" : lim === l ? "law" : d.who ? "who" : "coe",
    who: d.who || null, coe: d.coe || null, law: law && law.criteria[key] ? law.criteria[key] : null };
}

/** PURE. Why a hospital value may not be saved, or "" when it may: only as strict or stricter than the standards. */
function settingRefusal(key, raw, jurisdiction, legal = legalMinimums) {
  const v = Number(raw), std = standardFor(key, jurisdiction, legal);
  if (!std) return `${key} is not a donor criterion.`;
  if (key.startsWith("deferrals.")) {
    if (std.days === "permanent") return `${key} is already a permanent deferral.`;
    if (!Number.isInteger(v) || v < 1 || v > 3650) return `${key} must be a whole number of days from 1 to 3650, or blank for the standard.`;
    if (std.days != null && v < std.days) return `${key} can only be made stricter: at least ${std.days} days.`;
    return "";
  }
  const d = CRITERIA[key];
  if (!Number.isFinite(v) || v < d.range[0] || v > d.range[1] || (!d.decimal && !Number.isInteger(v))) {
    return `${key} must be ${d.decimal ? "a number" : "a whole number"} from ${d.range[0]} to ${d.range[1]}, or blank for the standard.`;
  }
  const lim = std.limit;
  const asStrict = !lim || (v === lim.value ? !lim.exclusive : d.stricter === "higher" ? v > lim.value : v < lim.value);
  if (!asStrict) {
    const bound = d.stricter === "higher" ? (lim.exclusive ? `more than ${lim.value}` : `at least ${lim.value}`) : (lim.exclusive ? `less than ${lim.value}` : `at most ${lim.value}`);
    return `${key} can only be made stricter than ${std.source === "law" || std.source === "both" ? "the law" : "the standard"}: ${bound}.`;
  }
  return "";
}

/**
 * PURE. The criteria in force for a hospital. region: the hospital's region (its jurisdiction); wsqCfg.bloodDonorCriteria
 * holds its settings, each used only when it is allowed. Returns { jurisdiction, values, limits, sources, deferrals,
 * questions, measure, ageDiscretion, standards }.
 */
function donorCriteriaFor(wsqCfg, region, legal = legalMinimums) {
  const jurisdiction = jurisdictionOf(region), law = jurisdiction && legal[jurisdiction];
  const saved = flatSettings(wsqCfg && wsqCfg.bloodDonorCriteria);
  const own = (k) => (saved[k] == null || saved[k] === "" || settingRefusal(k, saved[k], jurisdiction, legal) ? null : Number(saved[k]));
  const values = {}, limits = {}, sources = {};
  for (const key of Object.keys(CRITERIA)) {
    const d = CRITERIA[key], std = standardFor(key, jurisdiction, legal), mine = own(key);
    const hosp = mine != null && !(std.limit && mine === std.limit.value && !std.limit.exclusive) ? { value: mine, exclusive: false } : null;
    limits[key] = hosp || std.limit;
    values[key] = limits[key] ? limits[key].value : null;
    sources[key] = { source: hosp ? "hospital" : std.source, exclusive: !!(limits[key] && limits[key].exclusive), who: std.who, coe: std.coe, law: std.law,
      standard: std.limit, ...(d.suggested ? { suggested: d.suggested } : {}) };
  }
  const deferrals = {};
  for (const c of Object.keys(DEFERRALS)) {
    if (c === "foreign-resident" && !(law && law.deferrals[c])) continue;
    const std = standardFor(`deferrals.${c}`, jurisdiction, legal), mine = own(`deferrals.${c}`);
    const hosp = mine != null && mine !== std.days ? mine : null;
    deferrals[c] = { question: DEFERRALS[c].question, days: hosp != null ? hosp : std.days, source: hosp != null ? "hospital" : std.source, who: std.who, law: std.law, standard: std.days };
  }
  const questions = QUESTIONS.filter((q) => Object.values(deferrals).some((d) => d.question === q));
  return { jurisdiction, values, limits, sources, deferrals, questions, measure: (law && law.measure) || {},
    ageDiscretion: !(law && law.ageDiscretion === false), standards: STANDARDS };
}

/** PURE. The settings a hospital sent from Admin: { value, errors }. Blank means the standard and is not stored. */
function validateDonorCriteria(input, region, legal = legalMinimums) {
  const errors = {}, flat = {}, jurisdiction = jurisdictionOf(region);
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value: {}, errors: { criteria: "Send the criteria as an object." } };
  for (const [key, raw] of Object.entries(flatSettings(input))) {
    if (raw === null || raw === "") { if (!standardFor(key, jurisdiction, legal)) errors[key] = `${key} is not a donor criterion.`; continue; }
    const why = settingRefusal(key, raw, jurisdiction, legal);
    if (why) errors[key] = why; else flat[key] = Number(raw);
  }
  const eff = (k) => (flat[k] != null ? flat[k] : (standardFor(k, jurisdiction, legal).limit || {}).value);
  for (const [lo, hi] of [["minAge", "maxAge"], ["systolicMin", "systolicMax"], ["diastolicMin", "diastolicMax"], ["pulseMin", "pulseMax"]]) {
    if (!errors[hi] && eff(lo) != null && eff(hi) != null && eff(lo) >= eff(hi)) errors[hi] = `${hi} must be above ${lo}.`;
  }
  const value = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith("deferrals.")) (value.deferrals = value.deferrals || {})[k.slice(10)] = v; else value[k] = v;
  }
  return { value, errors };
}

function ageOn(dob, iso) {
  const b = new Date(dob + "T00:00:00Z"), n = new Date(iso);
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/**
 * PURE. Why a donor may not donate now. [] = no reason.
 * donor: { sex, dateOfBirth }; s: { donationType, weightKg, hbGdl, answers, temperatureC?, systolic?, diastolic?, pulse?,
 * pulseRegular?, plateletCount?, totalProteinGL? }; history: earlier donations here [{ at, type, reinfusionComplete }];
 * criteria: donorCriteriaFor(). A sex other than male or female is held to the stricter of the two.
 */
function screeningFailures(donor, s, history, nowIso, criteria) {
  const cr = criteria || donorCriteriaFor(null, null), L = cr.limits, dir = (k) => CRITERIA[k].stricter, out = [];
  const ok = (k, x) => meets(dir(k), x, L[k]);
  const bySex = (m, f) => (donor.sex === "male" ? L[m] : donor.sex === "female" ? L[f] : stricterLimit(dir(m), L[m], L[f]));
  const now = Date.parse(nowIso), type = DONATION_TYPES.includes(s.donationType) ? s.donationType : "whole-blood", apheresis = type !== "whole-blood";
  const past = (history || []).map((h) => ({ t: Date.parse(h.at), type: DONATION_TYPES.includes(h.type) ? h.type : "whole-blood", incomplete: h.reinfusionComplete === false }))
    .filter((h) => Number.isFinite(h.t) && h.t <= now);
  const daysSince = (list) => (list.length ? (now - Math.max(...list.map((h) => h.t))) / DAY : Infinity);
  const whole = past.filter((h) => h.type === "whole-blood"), aph = past.filter((h) => h.type !== "whole-blood");
  const age = ageOn(donor.dateOfBirth, nowIso);
  if (!ok("minAge", age)) out.push("age");
  else if (!ok("maxAge", age)) out.push("age-over-limit");
  else if (!past.length && !ok("firstTimeMaxAge", age)) out.push("first-time-age");
  else if (apheresis && !ok("apheresisMaxAge", age)) out.push("apheresis-age");
  if (!ok(apheresis ? "apheresisMinWeightKg" : "minWeightKg350", Number(s.weightKg))) out.push("weight");
  if (!meets("higher", Number(s.hbGdl), bySex("minHbMale", "minHbFemale"))) out.push("haemoglobin");
  if (cr.questions.some((q) => s.answers && s.answers[q] === true)) out.push("questionnaire");
  if (!apheresis) {
    if (!meets("higher", daysSince(whole), bySex("intervalDaysMale", "intervalDaysFemale"))) out.push("interval");
    if (whole.length && !meets("lower", whole.filter((h) => h.t > now - 365 * DAY).length + 1, bySex("maxPerYearMale", "maxPerYearFemale"))) out.push("annual-limit");
    if (!ok("wholeBloodAfterApheresisDays", daysSince(aph)) || !ok("wholeBloodAfterIncompleteReinfusionDays", daysSince(aph.filter((h) => h.incomplete)))) out.push("after-apheresis");
  } else {
    if (!ok(type === "apheresis-platelets" ? "apheresisIntervalDaysPlatelets" : "apheresisIntervalDaysPlasma", daysSince(aph))) out.push("apheresis-interval");
    if (!ok("apheresisMaxPer7Days", aph.filter((h) => h.t > now - 7 * DAY).length + 1)) out.push("apheresis-weekly-limit");
    if (!ok("apheresisMaxPerYear", aph.filter((h) => h.t > now - 365 * DAY).length + 1)) out.push("apheresis-annual-limit");
    if (!ok("apheresisAfterWholeBloodDays", daysSince(whole))) out.push("after-whole-blood");
    if (!ok("apheresisAfterIncompleteReinfusionDays", daysSince(aph.filter((h) => h.incomplete)))) out.push("after-incomplete-reinfusion");
    if (type === "apheresis-platelets" && !ok("minPlateletCount", Number(s.plateletCount))) out.push("platelet-count");
    if (type === "apheresis-plasma" && !ok("minTotalProteinGL", Number(s.totalProteinGL))) out.push("total-protein");
  }
  if (s.temperatureC != null && !ok("maxTemperatureC", s.temperatureC)) out.push("temperature");
  if ((s.systolic != null && (!ok("systolicMin", s.systolic) || !ok("systolicMax", s.systolic))) || (s.diastolic != null && (!ok("diastolicMin", s.diastolic) || !ok("diastolicMax", s.diastolic)))) out.push("blood-pressure");
  if ((s.pulse != null && (!ok("pulseMin", s.pulse) || !ok("pulseMax", s.pulse))) || s.pulseRegular === false) out.push("pulse");
  return out;
}

/** PURE. Failures a responsible physician may accept: the WHO age limits, only where no law states the limit without one. */
function discretionary(criteria) {
  return criteria && criteria.ageDiscretion ? ["age-over-limit", "first-time-age"] : [];
}

/**
 * PURE. The deferral the recorded conditions require. conditions: [{ condition, since: "YYYY-MM-DD" }]. Returns
 * { ok, permanent, until (ISO or null), undated: [conditions with no fixed period], applied: [...] } or { ok:false, error, detail }.
 */
function deferralFor(conditions, criteria, nowIso) {
  const now = Date.parse(nowIso), list = Array.isArray(conditions) ? conditions : [];
  let permanent = false, until = null;
  const undated = [], applied = [];
  for (const [i, x] of list.entries()) {
    const c = str(x && x.condition), d = criteria.deferrals[c];
    if (!d) return { ok: false, error: "deferral_condition_invalid", line: i, detail: `${c || "(blank)"} is not a condition in the deferral table.` };
    if (d.days === "permanent") { permanent = true; applied.push({ condition: c, days: "permanent" }); continue; }
    if (d.days == null) { undated.push(c); applied.push({ condition: c, days: null }); continue; }
    const since = str(x.since);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since)) || Date.parse(since) > now) {
      return { ok: false, error: "deferral_date_required", line: i, condition: c, detail: `${c} needs the date it counts from (recovery, last dose, procedure, delivery or arrival), not in the future.` };
    }
    const end = Date.parse(since) + d.days * DAY;
    applied.push({ condition: c, days: d.days, since, until: new Date(end).toISOString() });
    if (end > now && (until == null || end > Date.parse(until))) until = new Date(end).toISOString();
  }
  return { ok: true, permanent, until, undated, applied };
}

export {
  STANDARDS, DONATION_TYPES, HB_METHODS, CRITERIA, QUESTIONS, DEFERRALS, legalMinimums,
  jurisdictionOf, stricterLimit, meets, standardFor, settingRefusal, donorCriteriaFor, validateDonorCriteria,
  ageOn, screeningFailures, discretionary, deferralFor,
};
