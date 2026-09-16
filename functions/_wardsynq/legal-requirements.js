/* functions/_wardsynq/legal-requirements.js - the legal requirement registry: every legal rule WardSynQ enforces, as a
 * record with its source, jurisdiction, dates and status, and the State/UT configuration layered on it. PURE: no store,
 * no clock of its own (every function takes the date).
 *
 * WHY A REGISTRY (owner's legal guidance of 2026-09-17, binding, "General principle: no binary legal = yes/no").
 * Healthcare compliance in India combines central law, delegated rules, State/UT implementation orders, court decisions
 * and authority procedures, so a requirement is never a bare yes or no: it has a source, a jurisdiction (India or one
 * State/UT), an effective date, maybe an expiry, and a status. UNDER_CHALLENGE is not STAYED: a provision under
 * challenge stays enforced unless a competent court has stayed it. The engine (registers, donor criteria, blood centre,
 * privacy clocks) reads its citations and dates from here, so a change in the law is one record changed by a code
 * release that cites the new source, never a hospital setting.
 *
 * STATE/UT CONFIGURATION. Some central duties are implemented differently by each State/UT (online Form F, MedLEaPR).
 * A State entry is shipped only where the owner's guidance or the legal opinion gives a source, and its values change
 * only by a code release. A value the shipped entry leaves unset (null), and every value for a State/UT with no entry,
 * is hospital-configured on Admin > Legal requirements with a reason, audited. A State/UT with neither says "not
 * configured for your State/UT", never a guessed default.
 *
 * Research for implementation, not legal advice: the opinion's list for a practising lawyer is still open.
 *
 * node --test test/wardsynq-legal-requirements.test.mjs
 */

const str = (v) => (v == null ? "" : String(v).trim());
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => DATE.test(str(s)) && !Number.isNaN(Date.parse(str(s) + "T00:00:00Z"));

const SOURCE_TYPES = Object.freeze(["ACT", "RULE", "REGULATION", "NOTIFICATION", "CIRCULAR", "COURT_ORDER", "OFFICE_MEMORANDUM", "GUIDELINE", "HOSPITAL_POLICY"]);
const STATUSES = Object.freeze(["IN_FORCE", "AMENDED", "STAYED", "STRUCK_DOWN", "UNDER_CHALLENGE", "STATE_SPECIFIC"]);
/* Enforced statuses. AMENDED is in force as amended; STATE_SPECIFIC is in force where its jurisdiction is. */
const ENFORCED = Object.freeze(["IN_FORCE", "AMENDED", "UNDER_CHALLENGE", "STATE_SPECIFIC"]);

/* The States and Union Territories, by ISO 3166-2:IN subdivision code (the 2023 codes: CG, OD, TS, UK), read
 * 2026-09-17 from https://en.wikipedia.org/wiki/ISO_3166-2:IN. 28 States and 8 Union Territories. */
const STATES_UTS = Object.freeze([
  ["AP", "Andhra Pradesh"], ["AR", "Arunachal Pradesh"], ["AS", "Assam"], ["BR", "Bihar"], ["CG", "Chhattisgarh"], ["GA", "Goa"],
  ["GJ", "Gujarat"], ["HR", "Haryana"], ["HP", "Himachal Pradesh"], ["JH", "Jharkhand"], ["KA", "Karnataka"], ["KL", "Kerala"],
  ["MP", "Madhya Pradesh"], ["MH", "Maharashtra"], ["MN", "Manipur"], ["ML", "Meghalaya"], ["MZ", "Mizoram"], ["NL", "Nagaland"],
  ["OD", "Odisha"], ["PB", "Punjab"], ["RJ", "Rajasthan"], ["SK", "Sikkim"], ["TN", "Tamil Nadu"], ["TS", "Telangana"],
  ["TR", "Tripura"], ["UP", "Uttar Pradesh"], ["UK", "Uttarakhand"], ["WB", "West Bengal"],
  ["AN", "Andaman and Nicobar Islands"], ["CH", "Chandigarh"], ["DH", "Dadra and Nagar Haveli and Daman and Diu"], ["DL", "Delhi"],
  ["JK", "Jammu and Kashmir"], ["LA", "Ladakh"], ["LD", "Lakshadweep"], ["PY", "Puducherry"],
].map(([code, name]) => Object.freeze({ code, name, kind: ["AN", "CH", "DH", "DL", "JK", "LA", "LD", "PY"].includes(code) ? "UT" : "State" })));
const STATE_CODES = new Set(STATES_UTS.map((s) => s.code));
const isStateUt = (code) => STATE_CODES.has(str(code).toUpperCase());
const stateName = (code) => (STATES_UTS.find((s) => s.code === str(code).toUpperCase()) || {}).name || null;

/* THE STATE/UT CONFIGURATION KINDS. keys: the values a State entry (or the hospital) sets; each check says what may be
 * stored. requirement: the central requirement the configuration implements. */
const FORMF_MODES = Object.freeze(["ONLINE", "OFFLINE", "PORTAL_AND_RECORD"]);
const MEDLEAPR_CASE_TYPES = Object.freeze(["MLR", "PMR", "AGE_DETERMINATION", "OTHER_MEDICO_LEGAL"]);
const httpsUrl = (v) => { try { const u = new URL(str(v)); return u.protocol === "https:" && u.href.length <= 300; } catch { return false; } };
const CONFIG_KINDS = Object.freeze({
  formF: Object.freeze({
    requirement: "IN-PCPNDT-R9-4-FORMF",
    keys: Object.freeze({
      mode: (v) => FORMF_MODES.includes(v),
      deadlineDays: (v) => Number.isInteger(v) && v >= 1 && v <= 31,
      portalUrl: httpsUrl,
      acknowledgementRequired: (v) => v === true || v === false,
    }),
  }),
  medleapr: Object.freeze({
    requirement: "IN-MEDLEAPR-PLATFORM",
    keys: Object.freeze({
      required: (v) => v === true || v === false,
      effectiveFrom: isDate,
      caseTypes: (v) => Array.isArray(v) && v.length > 0 && v.length <= MEDLEAPR_CASE_TYPES.length && v.every((x) => MEDLEAPR_CASE_TYPES.includes(x)) && new Set(v).size === v.length,
    }),
  }),
});

/* One record. ev: [url, kind (PRIMARY, MIRROR, SECONDARY, OFFICIAL_PORTAL), verified (read on 2026-09-17), note]. */
const ev = (url, kind, verified, note) => Object.freeze({ url, kind, verified: verified === true, ...(note ? { note } : {}) });
function req(o) {
  return Object.freeze({
    id: o.id, title: o.title, sourceType: o.sourceType, instrument: o.instrument, provision: o.provision || "", jurisdiction: o.jurisdiction || "IN",
    effectiveFrom: o.effectiveFrom || null, expiresOn: o.expiresOn || null, status: o.status || "IN_FORCE",
    appliesTo: Object.freeze({ facilityTypes: Object.freeze(o.facilityTypes || []), caseTypes: Object.freeze(o.caseTypes || []), roles: Object.freeze(o.roles || []) }),
    mandatory: o.mandatory !== false, evidence: Object.freeze(o.evidence || []), notes: o.notes || "", cite: o.cite || `${o.instrument}${o.provision ? ", " + o.provision : ""}`,
    ...(o.challenge ? { challenge: Object.freeze(o.challenge) } : {}),
    ...(o.config ? { config: Object.freeze({ kind: o.config.kind, values: Object.freeze(o.config.values) }) } : {}),
  });
}

const GSR166 = "https://drugscontrol.py.gov.in/sites/default/files/GSR-166-E.pdf";
const CDSCO = "https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf";
const EGAZETTE = "https://egazette.gov.in";
const PCPNDT_RULES = "https://indiankanoon.org/doc/195755613/";
const MTP_REGS = "https://indiankanoon.org/doc/8267811/";

const REQUIREMENTS = Object.freeze([
  /* ------------------------------------------------------------------------------------------ PCPNDT */
  req({ id: "IN-PCPNDT-R9-4-FORMF", title: "Form F for every pre-natal diagnostic procedure", sourceType: "RULE", instrument: "PC&PNDT Rules 1996", provision: "r.9(4); Act s.4(3) proviso",
    roles: ["radiologist", "obstetrician"], evidence: [ev(PCPNDT_RULES, "MIRROR", true), ev("https://pcpndt.ap.gov.in/forms/FORM%20F.pdf", "MIRROR", true, "the 2014 Form F")],
    notes: "Mandatory everywhere (central). An incomplete Form F is presumed a contravention of s.5 or s.6 unless the contrary is proved. Online submission is a State/UT implementation requirement, not national: see the State/UT entries.",
    cite: "PC&PNDT Rules 1996 r.9(4) and Form F (amended 2014); Act s.4(3) proviso" }),
  req({ id: "IN-PCPNDT-R9-8-MONTHLY", title: "Monthly report of every Form F by the 5th of the following month", sourceType: "RULE", instrument: "PC&PNDT Rules 1996", provision: "r.9(8)",
    effectiveFrom: "2003-02-14", evidence: [ev(PCPNDT_RULES, "MIRROR", true)],
    cite: "PC&PNDT Rules r.9(8): a complete report of the month's procedures by the 5th day of the following month to the Appropriate Authority." }),
  req({ id: "IN-PCPNDT-R9-7-PRINT", title: "Authenticated printout of an electronic Form F", sourceType: "RULE", instrument: "PC&PNDT Rules 1996", provision: "r.9(7)", evidence: [ev(PCPNDT_RULES, "MIRROR", true)] }),
  req({ id: "IN-PCPNDT-R8-13-17-CENTRE", title: "Centre registration renewal, advance intimation of changes, notice and copies on premises", sourceType: "RULE", instrument: "PC&PNDT Rules 1996", provision: "r.8(1), r.13, r.17", evidence: [ev(PCPNDT_RULES, "MIRROR", true)] }),
  req({ id: "MH-PCPNDT-FORMF-ONLINE", title: "Maharashtra: online Form F within five calendar days of the procedure", sourceType: "GUIDELINE", jurisdiction: "MH", status: "STATE_SPECIFIC",
    instrument: "Maharashtra PCPNDT online Form F system (State Family Welfare Bureau)", provision: "Form F online submission",
    evidence: [ev("https://pcpndt.maharashtra.gov.in/", "OFFICIAL_PORTAL", true, "\"Form 'F' can be submitted online up to five calendar days from the date of procedure.\"")],
    notes: "Owner's guidance 2026-09-17. The portal states the five-day rule; the State notification itself was not read. A saved Form F not submitted by the deadline is auto-submitted by the portal.",
    config: { kind: "formF", values: { mode: "ONLINE", deadlineDays: 5, portalUrl: "https://pcpndt.maharashtra.gov.in/", acknowledgementRequired: null } } }),
  req({ id: "DL-PCPNDT-FORMF-ONLINE", title: "Delhi: official online Form F system", sourceType: "GUIDELINE", jurisdiction: "DL", status: "STATE_SPECIFIC",
    instrument: "Delhi PC&PNDT online Form F system (Directorate of Family Welfare, GNCTD)", provision: "Form F online submission",
    evidence: [ev("https://pndt.delhigovt.nic.in/", "OFFICIAL_PORTAL", true, "Login portal for Form F, NIC hosted"), ev("https://pcpndt.delhi.gov.in/", "OFFICIAL_PORTAL", true, "Department of Health and Family Welfare, GNCTD: links to Form F and its user manual")],
    notes: "Owner's guidance 2026-09-17. No per-procedure deadline was found; the portal also asks for photocopies of completed Form F with referral slips at the office of the Chief District Medical Officer by the 5th of the following month.",
    config: { kind: "formF", values: { mode: "ONLINE", deadlineDays: null, portalUrl: "https://pndt.delhigovt.nic.in/", acknowledgementRequired: null } } }),
  req({ id: "RJ-PCPNDT-FORMF-PORTAL", title: "Rajasthan: official PCPNDT portal with Form F entries", sourceType: "GUIDELINE", jurisdiction: "RJ", status: "STATE_SPECIFIC",
    instrument: "Rajasthan PCPNDT portal (PCPNDT Cell, DMHFW, Government of Rajasthan)", provision: "Form F entries",
    evidence: [ev("https://pcpndt.rajasthan.gov.in/", "OFFICIAL_PORTAL", true, "Form F entries counted since 2012; NIC Jaipur")],
    notes: "Owner's guidance 2026-09-17: the portal carries Form F entries; the Form F record is kept as well. No per-procedure deadline was found.",
    config: { kind: "formF", values: { mode: "PORTAL_AND_RECORD", deadlineDays: null, portalUrl: "https://pcpndt.rajasthan.gov.in/", acknowledgementRequired: null } } }),

  /* ------------------------------------------------------------------------------------------ MTP */
  req({ id: "IN-MTP-REG4-5-FORMII", title: "Form II monthly statement to the Chief Medical Officer of the State", sourceType: "REGULATION", instrument: "MTP Regulations 2003", provision: "reg 4(5), Form II",
    effectiveFrom: "2003-06-13", roles: ["head of the hospital", "owner of the approved place"], evidence: [ev(MTP_REGS, "MIRROR", true)],
    notes: "Owner's guidance 2026-09-17: a monthly statutory report from the head of the hospital or owner of the approved place to the Chief Medical Officer of the State. Not patient-facing, not routed through billing or ordinary medical records; kept inside the restricted MTP workflow (reg 5, 6, 7; Act s.5A). No due date is prescribed: the day is hospital policy.",
    cite: "MTP Regulations 2003 reg 4(5): the head of the hospital or owner of the approved place sends the monthly statement in Form II to the Chief Medical Officer of the State." }),
  req({ id: "IN-MTP-REG5-FORMIII", title: "Admission Register (Form III) kept five years, secret", sourceType: "REGULATION", instrument: "MTP Regulations 2003", provision: "reg 5, 6, 7", evidence: [ev(MTP_REGS, "MIRROR", true)] }),

  /* ------------------------------------------------------------------------------------------ medico-legal */
  req({ id: "IN-MEDLEAPR-PLATFORM", title: "MedLEaPR: medico-legal examination and post-mortem reporting platform", sourceType: "GUIDELINE", instrument: "MedLEaPR (National Informatics Centre)", provision: "platform",
    mandatory: false, evidence: [ev("https://informatics.nic.in/files/websites/january-2026/medleapr.php", "PRIMARY", false, "NIC, January 2026: adopted by 26 States and 8 UTs (as cited in the legal opinion)")],
    notes: "A national platform; its existence does not make it mandatory for a private hospital. The obligation comes from a State/UT notification or direction: see the State/UT entries. Otherwise the State-prescribed MLR workflow applies." }),
  req({ id: "RJ-MEDLEAPR-HC-2025", title: "Rajasthan: MLR, PMR and other medico-legal reports through MedLEaPR from 1 February 2026", sourceType: "COURT_ORDER", jurisdiction: "RJ", status: "STATE_SPECIFIC",
    instrument: "Mukesh Kumar @ Mangej v State of Rajasthan, S.B. Criminal Miscellaneous Bail Application No. 173/2025, High Court of Rajasthan at Jodhpur (Ravi Chirania J), order of 17 November 2025",
    provision: "directions on MedLEaPR and CCTNS", effectiveFrom: "2026-02-01", facilityTypes: ["government", "private"], caseTypes: ["MLR", "PMR", "AGE_DETERMINATION", "OTHER_MEDICO_LEGAL"],
    evidence: [ev("https://indiankanoon.org/doc/87407200/", "MIRROR", true, "order text: all MLR, PMR, age determination and other medico-legal reports through MedLEaPR by all doctors of Government and private establishments w.e.f. 01.02.2026; police requests through CCTNS"),
      ev("https://www.livelaw.in/high-court/rajasthan-high-court/illegible-medico-legal-reports-digital-software-mandatory-310566", "SECONDARY", true)],
    notes: "The Court directed the State to notify this within 15 days; that notification was not read. Police requisitions for these reports are generated through CCTNS.",
    config: { kind: "medleapr", values: { required: true, effectiveFrom: "2026-02-01", caseTypes: ["MLR", "PMR", "AGE_DETERMINATION", "OTHER_MEDICO_LEGAL"] } } }),

  /* ------------------------------------------------------------------------------------------ births and deaths, NDPS */
  req({ id: "IN-RBD-R5-3", title: "Birth, death and still birth reported to the Registrar within 21 days", sourceType: "RULE", instrument: "Registration of Births and Deaths Rules (model)", provision: "r.5(3); Act s.13 for late registration",
    notes: "Each State notifies its own rules on the model; the legal opinion section E." }),
  req({ id: "IN-NDPS-R52O-RMI", title: "Recognised Medical Institution (Form 3G) renewal and intimations", sourceType: "RULE", instrument: "NDPS Rules 1985", provision: "r.52-O, r.52Q, r.52R" }),
  req({ id: "IN-NDPS-R52T-3J-3I", title: "Form 3J annual estimate and Form 3-I annual return", sourceType: "RULE", instrument: "NDPS Rules 1985", provision: "r.52T, r.52R(1)(d)" }),

  /* ------------------------------------------------------------------------------------------ blood centres */
  req({ id: "IN-DCR-XIIB-H", title: "Criteria for blood donation", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B, H. Criteria for Blood Donation",
    effectiveFrom: "2020-03-11", evidence: [ev(GSR166, "MIRROR", true, "G.S.R. 166(E), 11 March 2020"), ev(CDSCO, "PRIMARY", true, "r.122-P, r.122-O: licence conditions")],
    cite: "Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, H. Criteria for Blood Donation (G.S.R. 166(E), 11 March 2020)" }),
  req({ id: "IN-DCR-XIIB-H-52", title: "Item 52: permanent deferral of the high-risk groups", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B, H, item 52",
    effectiveFrom: "2020-03-11", status: "UNDER_CHALLENGE",
    challenge: { case: "Thangjam Santa Singh v Union of India", court: "Supreme Court of India", filed: "2021", stayed: false,
      summary: "Pending. On 13 March 2026 the Centre told the Court an expert committee recommended retaining item 52. Not stayed, so enforced exactly as the Rule states." },
    evidence: [ev(GSR166, "MIRROR", true, "the Rule text of item 52"),
      ev("https://www.livelaw.in/top-stories/blood-donation-ban-on-gays-transgender-persons-sex-workers-retained-after-review-centre-tells-supreme-court-526163", "SECONDARY", false, "13 March 2026 report; the outcome after March 2026 is not confirmed")],
    notes: "Owner's guidance 2026-09-17 item 5: UNDER_CHALLENGE is not STAYED. Changes only if a court stays or strikes it down or the Rule is amended, by a code release citing that order or notification." }),
  req({ id: "IN-DCR-XIIB-K", title: "Mandatory testing of every unit before use", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B, heading K", evidence: [ev(CDSCO, "PRIMARY", true)] }),
  req({ id: "IN-DCR-XIIB-K-NOTE-A", title: "Pilot and recipient samples preserved 7 days after issue", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B, heading K Note (a)",
    evidence: [ev(CDSCO, "PRIMARY", true)], cite: "Schedule F Part XII-B, heading K Note (a)" }),
  req({ id: "IN-DCR-XIIB-L", title: "Blood centre records kept five years", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B, heading L NOTE; r.122-P(i)(c)",
    evidence: [ev(CDSCO, "PRIMARY", true)], cite: "Schedule F Part XII-B, heading L NOTE; rule 122-P(i)(c)" }),
  req({ id: "IN-DCR-SCHP-COMPONENTS", title: "Component shelf life and storage", sourceType: "RULE", instrument: "Drugs and Cosmetics Rules 1945", provision: "Schedule F Part XII-B and Schedule P",
    evidence: [ev(CDSCO, "PRIMARY", true)], cite: "Drugs and Cosmetics Rules 1945, Schedule F Part XII-B (G.S.R. 166(E), 2020) and Schedule P" }),

  /* ------------------------------------------------------------------------------------------ privacy */
  req({ id: "IN-DPDP-ACT-S3-17", title: "DPDP Act duties of a Data Fiduciary (ss.3-17)", sourceType: "NOTIFICATION", instrument: "DPDP Act 2023 commencement, G.S.R. 843(E); DPDP Rules 2025 r.1, G.S.R. 846(E)", provision: "eighteen months after publication",
    effectiveFrom: "2027-05-13", evidence: [ev(EGAZETTE, "PRIMARY", true, "read from the gazette PDFs")],
    notes: "Published 13 November 2025 (gazette dated 13, published 14 November); counted from the earlier day. Until then IT Act s.43A and the SPDI Rules 2011 apply.",
    cite: "DPDP Act 2023 commencement: G.S.R. 843(E), 13 Nov 2025; DPDP Rules 2025 r.1, G.S.R. 846(E), 13 Nov 2025" }),
  req({ id: "IN-DPDP-PUBLISHED", title: "DPDP Act and Rules published", sourceType: "NOTIFICATION", instrument: "G.S.R. 843(E) and G.S.R. 846(E)", provision: "publication", effectiveFrom: "2025-11-13", evidence: [ev(EGAZETTE, "PRIMARY", true)] }),
  req({ id: "IN-DPDP-R4-CONSENT-MANAGERS", title: "Consent Managers (DPDP Rules r.4)", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.1(3), r.4", effectiveFrom: "2026-11-13", evidence: [ev(EGAZETTE, "PRIMARY", true)] }),
  req({ id: "IN-SPDI-2011", title: "Sensitive personal data under the IT Act", sourceType: "RULE", instrument: "IT Act 2000 s.43A; SPDI Rules 2011", provision: "", expiresOn: "2027-05-12",
    notes: "DPDP Act s.44(2) omits IT Act s.43A when ss.3-17 commence.", cite: "IT Act 2000 s.43A; SPDI Rules 2011" }),
  req({ id: "IN-SPDI-R5-9", title: "Grievances redressed within one month", sourceType: "RULE", instrument: "SPDI Rules 2011", provision: "r.5(9)", expiresOn: "2027-05-12",
    cite: "SPDI Rules 2011 r.5(9): the Grievance Officer redresses grievances within one month from the date of receipt" }),
  req({ id: "IN-SPDI-R5-1", title: "Written consent before collecting health data", sourceType: "RULE", instrument: "SPDI Rules 2011", provision: "r.5(1)", expiresOn: "2027-05-12",
    cite: "SPDI Rules 2011 r.5(1): consent in writing (letter, fax or email) regarding the purpose, before health data is collected" }),
  req({ id: "IN-SPDI-R5-3", title: "Notice at collection", sourceType: "RULE", instrument: "SPDI Rules 2011", provision: "r.5(3)", expiresOn: "2027-05-12",
    cite: "SPDI Rules 2011 r.5(3): the fact of collection, the purpose, the intended recipients, and the name and address of the collecting agency" }),
  req({ id: "IN-CERTIN-2022-II", title: "Cyber incident reported to CERT-In within 6 hours", sourceType: "NOTIFICATION", instrument: "CERT-In Directions No. 20(3)/2022-CERT-In, 28 Apr 2022", provision: "(ii)",
    cite: "CERT-In Directions No. 20(3)/2022-CERT-In, 28 Apr 2022, (ii): report within 6 hours of noticing" }),
  req({ id: "IN-CERTIN-2022-IV", title: "ICT logs kept 180 days within India", sourceType: "NOTIFICATION", instrument: "CERT-In Directions No. 20(3)/2022-CERT-In, 28 Apr 2022", provision: "(iv)",
    cite: "CERT-In Directions 2022 (iv): logs of all ICT systems kept securely for a rolling 180 days within India" }),
  req({ id: "IN-DPDP-R14-3", title: "Data principal requests answered within the published period (not more than 90 days)", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.14(3)", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.14(3): a published period not exceeding 90 days (the PIB explainer of 17 Nov 2025 reads it as covering access, correction and erasure requests)" }),
  req({ id: "IN-DPDP-R7-2B", title: "Detailed breach report to the Board within 72 hours", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.7(2)(b)", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.7(2)(b): detailed report to the Board within 72 hours of becoming aware, or a longer period the Board allows on a written request" }),
  req({ id: "IN-DPDP-R7-1", title: "Each affected Data Principal told without delay", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.7(1)", effectiveFrom: "2027-05-13",
    notes: "No number in the Rule: the hours are the hospital's policy target.",
    cite: "DPDP Rules 2025 r.7(1): each affected Data Principal told without delay (no number; this is the hospital's policy target)" }),
  req({ id: "IN-DPDP-R6-LOGS", title: "Logs kept at least one year", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.6(1)(e), r.8(3)", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.6(1)(e), r.8(3): logs kept at least one year" }),
  req({ id: "IN-DPDP-S5-R3", title: "Privacy notice", sourceType: "RULE", instrument: "DPDP Act 2023 s.5, DPDP Rules 2025 r.3", effectiveFrom: "2027-05-13", cite: "DPDP Act 2023 s.5, DPDP Rules 2025 r.3" }),
  req({ id: "IN-DPDP-R9", title: "DPO or contact person stated in every response", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.9", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.9: the DPO or contact person is stated in every response" }),
  req({ id: "IN-DPDP-R10", title: "Verifiable parental consent for a child's data", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.10; Fourth Schedule Part A item 1", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.10: verifiable parental consent before processing a child's data; Fourth Schedule Part A item 1: not needed where processing is restricted to providing health services to the child" }),
  req({ id: "IN-DPDP-R11", title: "Guardian of a person with disability verified", sourceType: "RULE", instrument: "DPDP Rules 2025", provision: "r.11", effectiveFrom: "2027-05-13",
    cite: "DPDP Rules 2025 r.11: a guardian's appointment by a court, a designated authority or a local level committee is verified" }),
  req({ id: "IN-IMC-1-3-2", title: "Medical records given within 72 hours of a request", sourceType: "REGULATION", instrument: "IMC (Professional Conduct, Etiquette and Ethics) Regulations 2002", provision: "reg 1.3.2",
    cite: "IMC (Professional Conduct, Etiquette and Ethics) Regulations 2002 reg 1.3.2: documents issued within 72 hours of a request by the patient, an authorised attendant or a legal authority" }),
]);
const BY_ID = new Map(REQUIREMENTS.map((r) => [r.id, r]));

/** PURE. One requirement by id; throws on an unknown id so a typo in the engine fails loudly at load, not silently. */
function requirement(id) {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`legal-requirements: no requirement ${id}`);
  return r;
}
const citeOf = (id) => requirement(id).cite;

/**
 * PURE. Does requirement r apply to this hospital on this date? ctx: { region ("IN" default), stateUt, facilityType,
 * caseType, on: YYYY-MM-DD }. Returns { applies, reason }. UNDER_CHALLENGE is enforced; STAYED, STRUCK_DOWN, not yet
 * effective and expired are not. An appliesTo list the hospital's value is unknown for does not exempt it (safest).
 */
function enforcement(r, ctx) {
  const c = ctx || {};
  const on = str(c.on).slice(0, 10);
  if (!r) return { applies: false, reason: "unknown-requirement" };
  if (c.region && str(c.region).toUpperCase() !== "IN") return { applies: false, reason: "other-country" };
  if (!ENFORCED.includes(r.status)) return { applies: false, reason: r.status === "STAYED" ? "stayed" : r.status === "STRUCK_DOWN" ? "struck-down" : "status" };
  if (r.jurisdiction !== "IN") {
    const st = str(c.stateUt).toUpperCase();
    if (!st) return { applies: false, reason: "state-not-set" };
    if (st !== r.jurisdiction) return { applies: false, reason: "other-state" };
  }
  if (!isDate(on)) return { applies: false, reason: "no-date" };
  if (r.effectiveFrom && on < r.effectiveFrom) return { applies: false, reason: "not-yet-effective" };
  if (r.expiresOn && on > r.expiresOn) return { applies: false, reason: "expired" };
  const ft = r.appliesTo.facilityTypes, ct = r.appliesTo.caseTypes;
  if (ft.length && str(c.facilityType) && !ft.includes(str(c.facilityType))) return { applies: false, reason: "facility-type" };
  if (ct.length && str(c.caseType) && !ct.includes(str(c.caseType))) return { applies: false, reason: "case-type" };
  return { applies: true, reason: r.status === "UNDER_CHALLENGE" ? "under-challenge-not-stayed" : "in-force" };
}
const enforced = (id, ctx) => enforcement(requirement(id), ctx).applies;

/* ------------------------------------------------------------------------------------------ State/UT configuration */

/** PURE. The hospital-configured values stored for a State/UT and kind: wardsynq.legal.stateConfig[STATE][kind]. */
function storedFor(legalCfg, stateUt, kind) {
  const sc = legalCfg && typeof legalCfg === "object" && legalCfg.stateConfig && typeof legalCfg.stateConfig === "object" ? legalCfg.stateConfig : {};
  const s = sc[str(stateUt).toUpperCase()];
  const k = s && typeof s === "object" ? s[kind] : null;
  return k && typeof k === "object" && !Array.isArray(k) ? k : {};
}

/**
 * PURE. The configuration in force for a kind (formF, medleapr) in the hospital's State/UT on a date. The shipped State
 * entry's values win; a key it leaves null (or every key, for a State/UT with no entry) is the hospital's, used only when
 * valid. Returns { kind, stateUt, stateName, configured, requirementId, values, sources: {key: registry|hospital|none},
 * editable: [keys], centralRequirement }.
 */
function stateConfigFor(kind, stateUt, legalCfg, on) {
  const def = CONFIG_KINDS[kind];
  if (!def) throw new Error(`legal-requirements: no config kind ${kind}`);
  const st = str(stateUt).toUpperCase();
  const valid = isStateUt(st) ? st : "";
  const entry = valid ? REQUIREMENTS.find((r) => r.config && r.config.kind === kind && r.jurisdiction === valid && enforcement(r, { stateUt: valid, on }).applies) : null;
  const stored = valid ? storedFor(legalCfg, valid, kind) : {};
  const values = {}, sources = {}, editable = [];
  for (const [k, ok] of Object.entries(def.keys)) {
    const seeded = entry ? entry.config.values[k] : null;
    if (seeded != null) { values[k] = seeded; sources[k] = "registry"; continue; }
    if (valid) editable.push(k);
    if (stored[k] != null && ok(stored[k])) { values[k] = stored[k]; sources[k] = "hospital"; }
    else { values[k] = null; sources[k] = "none"; }
  }
  const lead = kind === "formF" ? "mode" : "required";
  return { kind, stateUt: valid || null, stateName: valid ? stateName(valid) : null, configured: values[lead] != null, requirementId: entry ? entry.id : null,
    values, sources, editable, centralRequirement: def.requirement };
}

/** PURE. Validates a hospital's values for one kind in its State/UT. Only editable keys; null clears a key. { value, problems }. */
function validateStateConfig(kind, stateUt, input, legalCfg, on) {
  const def = CONFIG_KINDS[kind];
  if (!def) return { value: null, problems: [`kind: formF or medleapr`] };
  if (!isStateUt(stateUt)) return { value: null, problems: ["stateUt: record this hospital's State/UT on Admin > Legal requirements first"] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value: null, problems: ["values: send the values as an object"] };
  const cur = stateConfigFor(kind, stateUt, legalCfg, on), problems = [], value = { ...storedFor(legalCfg, stateUt, kind) };
  for (const [k, v] of Object.entries(input)) {
    if (!def.keys[k]) { problems.push(`${k}: not a ${kind} value`); continue; }
    if (!cur.editable.includes(k)) { problems.push(`${k}: set by ${cur.requirementId} for ${cur.stateName}; it changes only with its source`); continue; }
    if (v === null || v === "") { delete value[k]; continue; }
    if (!def.keys[k](v)) problems.push(`${k}: not a valid value`);
    else value[k] = v;
  }
  if (kind === "medleapr" && value.required === true && !(cur.values.effectiveFrom || value.effectiveFrom)) problems.push("effectiveFrom: the date MedLEaPR is required from");
  if (kind === "medleapr" && value.required === true && !(cur.values.caseTypes || value.caseTypes)) problems.push("caseTypes: the reports MedLEaPR is required for");
  return { value, problems };
}

/**
 * PURE. PCPNDT Form F submission in the hospital's State/UT on the procedure date. Form F itself is always mandatory
 * (central). requiresPortal: ONLINE or PORTAL_AND_RECORD; the portal reference is required unless the configuration
 * says no acknowledgement is required (not configured: required, the safest).
 */
function formFSubmission(stateUt, legalCfg, on) {
  const c = stateConfigFor("formF", stateUt, legalCfg, on), v = c.values;
  const requiresPortal = v.mode === "ONLINE" || v.mode === "PORTAL_AND_RECORD";
  return { ...c, mode: v.mode, deadlineDays: v.deadlineDays, portalUrl: v.portalUrl, requiresPortal,
    requiresReference: requiresPortal && v.acknowledgementRequired !== false };
}

/** PURE. The online-submission clock of one Form F: due procedureDate + deadlineDays. null when there is no such clock. */
function formFPortalClock(fields, sub, today) {
  const f = fields || {};
  if (!sub || !sub.requiresPortal || !sub.deadlineDays || !isDate(f.procedureDate)) return null;
  const dueBy = new Date(Date.parse(f.procedureDate + "T00:00:00Z") + sub.deadlineDays * 86400000).toISOString().slice(0, 10);
  if (isDate(f.portalSubmittedOn)) return { dueBy, state: f.portalSubmittedOn > dueBy ? "submitted-late" : "submitted", submittedOn: f.portalSubmittedOn };
  return { dueBy, state: today > dueBy ? "overdue" : "due" };
}

/** PURE. Whether MedLEaPR is required for a case type (MLR, PMR, ...) in the hospital's State/UT on a date. */
function medleaprRequired(stateUt, legalCfg, caseType, on) {
  const c = stateConfigFor("medleapr", stateUt, legalCfg, on), v = c.values;
  const day = str(on).slice(0, 10);
  const required = v.required === true && isDate(v.effectiveFrom) && isDate(day) && day >= v.effectiveFrom && Array.isArray(v.caseTypes) && v.caseTypes.includes(caseType);
  return { required, configured: c.configured, requirementId: c.requirementId, stateUt: c.stateUt };
}

/**
 * PURE. What the Legal requirements screen lists for a hospital: the central requirements and its State/UT's, each with
 * whether it applies today, and the State/UT configuration of each kind (with what is not configured).
 */
function legalView(stateUt, legalCfg, on, region) {
  const st = isStateUt(stateUt) ? str(stateUt).toUpperCase() : null;
  const requirements = REQUIREMENTS.filter((r) => r.jurisdiction === "IN" || r.jurisdiction === st)
    .map((r) => ({ ...r, enforcement: enforcement(r, { region, stateUt: st, on }) }));
  const config = Object.fromEntries(Object.keys(CONFIG_KINDS).map((k) => [k, stateConfigFor(k, st, legalCfg, on)]));
  return { stateUt: st, stateName: st ? stateName(st) : null, on, states: STATES_UTS, requirements, config,
    notConfigured: Object.values(config).filter((c) => !c.configured).map((c) => c.kind),
    modes: FORMF_MODES, caseTypes: MEDLEAPR_CASE_TYPES };
}

export { SOURCE_TYPES, STATUSES, ENFORCED, STATES_UTS, FORMF_MODES, MEDLEAPR_CASE_TYPES, CONFIG_KINDS, REQUIREMENTS, requirement, citeOf, enforcement, enforced,
  isStateUt, stateName, stateConfigFor, validateStateConfig, formFSubmission, formFPortalClock, medleaprRequired, legalView };
