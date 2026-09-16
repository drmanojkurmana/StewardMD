/* functions/_wardsynq/registers.js - the hospital's statutory registers (India), kept on the server per hospital.
 *
 * WHAT. Six registers an Indian hospital must keep and none of which existed: the controlled-drug (NDPS) count book
 * (controlled-drugs.js computes the ledger itself from the stock records), PCPNDT Form F, medico-legal cases, MTP,
 * births/deaths/still births with the medical certificate of cause of death, and notifiable diseases for IHIP. Each
 * form's fields are the statutory form's own, cited at the schema from the official text that was read; nothing in a
 * schema is a guess, and where an official text could not be read the schema says so.
 *
 * WHERE. The hospital's own append-only record store (repository.js), as INTERNAL types like bug reports and
 * connectors, not RecordService resource types. That is the confidentiality decision (vault/decisions/Decisions.md,
 * 2026-09-16): a type in RESOURCE_TYPES is readable through the raw record door, the chart and the change feed by
 * every role whose read scope is null (every doctor, nurse and receptionist), and a Form F, an MTP case or a
 * medico-legal case must not be. Here nothing reaches a register except its own routes, which the router gates by
 * the register's own capability. RecordService.changes() withholds these types for the same reason.
 *
 * APPEND-ONLY. Every save is a new version landing in the same append as its audit row. A correction is a new
 * version that must name the version it corrects and say why; nothing is edited in place and nothing is deleted.
 * Every read of a register (list, one entry, its history, an export) leaves an audit row too. Audit rows carry the
 * register, the entry id, the version and a patient pseudonym, never a name or a field value.
 *
 * SIGNATURES. A statutory declaration is a typed attestation: the person types their full name and the server stamps
 * who was signed in and when. It is recorded as exactly that, never as a wet or digital signature.
 *
 * NOTHING IS SENT. No authority here has an open API a hospital can post to (CRS, IHIP, the District Appropriate
 * Authority, the CMO). Exports are structured files for a person to submit; every export says submission is manual.
 */

import { VersionConflictError } from "./repository.js";

const PREFIX = "_wardsynq_register_";
const SERIAL_TYPE = "_wardsynq_register_serial";
const MAX_LIST = 1000;
const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------------------------------------------ field helpers */

/** A field: key, the form's own label, type, and options. req: required for the entry to be complete. */
function f(key, label, type, o) { return Object.freeze({ key, label, type, ...(o || {}) }); }
const YN = [["yes", "Yes"], ["no", "No"]];
const YN_NA = [["yes", "Yes"], ["no", "No"], ["not-applicable", "Not applicable"]];

/* ------------------------------------------------------------------------------------------------ the registers */

/* BIRTHS, DEATHS AND STILL BIRTHS.
 * Registration of Births and Deaths Act 1969 as amended by the RBD (Amendment) Act 2023 (No. 20 of 2023, Gazette of
 * India Extraordinary Part II s.1, 11 Aug 2023): s.8 names the in-charge of a medical institution as the informant
 * for a birth or death in it; s.10(2) as substituted requires every medical institution to give the Registrar a
 * certificate of the cause of death signed by the attending practitioner, and a copy to the nearest relative.
 * Model Registration of Births and Deaths Rules 1999 rule 5: Forms 1, 2 and 3, each in a Legal and a Statistical
 * part, "shall be given within twenty one days"; rule 7: Form 4 (institutional) and 4A (non-institutional) for the
 * cause of death. Read from https://dc.crsorgi.gov.in/assets/download/Births_and_Deaths_Rules_1999.pdf and the
 * current forms (post-2023 revision) https://dc.crsorgi.gov.in/assets/download/all_forms_CRS_2019_new.pdf.
 *
 * AADHAAR NUMBERS ARE NOT KEPT HERE. The 2023 forms ask for the parents' and informant's Aadhaar where available.
 * WardSynQ does not store Aadhaar numbers in a register; they are entered on the CRS portal at submission. */
const EDUCATION_NOTE = "As written on the form";
const ATTENTION = [["institutional-government", "Institutional - Government"], ["institutional-private", "Institutional - Private or Non-Government"],
  ["doctor-nurse-midwife", "Doctor, Nurse or Trained Midwife"], ["traditional-birth-attendant", "Traditional Birth Attendant"], ["relatives-others", "Relatives or others"]];
const PLACE = [["hospital", "Hospital or Institution"], ["house", "House"], ["other", "Other place"]];
const SEX_FORM = [["male", "Male"], ["female", "Female"], ["transgender", "Transgender person"]];
const informant = [
  f("informantName", "Informant: name", "text", { req: true, part: "legal" }),
  f("informantMobile", "Informant: mobile number", "text", { part: "legal" }),
  f("informantEmail", "Informant: email", "text", { part: "legal" }),
  f("informantAddress", "Informant: address", "longtext", { req: true, part: "legal" }),
  f("informantDeclaration", "Declaration of the informant (type full name)", "attest", { req: true, part: "legal" }),
];

const BIRTH = {
  title: "Birth report (Form No. 1)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8; Model RBD Rules 1999 r.5, Form No. 1",
  patient: "mother", dateField: "dateOfBirth", confidential: [],
  fields: [
    f("dateOfBirth", "1. Date of birth", "date", { req: true, part: "legal" }),
    f("sex", "2. Sex", "enum", { req: true, options: SEX_FORM, part: "legal" }),
    f("childName", "3(a). Name of the child (if named)", "text", { part: "legal" }),
    f("fatherName", "4(a). Father: name", "text", { part: "legal" }),
    f("fatherMobile", "4(c). Father: mobile number", "text", { part: "legal" }),
    f("fatherEmail", "4(d). Father: email", "text", { part: "legal" }),
    f("motherName", "5(a). Mother: name", "text", { req: true, part: "legal" }),
    f("motherMobile", "5(c). Mother: mobile number", "text", { part: "legal" }),
    f("motherEmail", "5(d). Mother: email", "text", { part: "legal" }),
    f("addressAtBirth", "6. Address of parents at the time of birth", "longtext", { req: true, part: "legal" }),
    f("permanentAddress", "7. Permanent address of parents", "longtext", { req: true, part: "legal" }),
    f("placeOfBirthType", "8. Place of birth", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfBirthName", "8. Name and address of the hospital, house or place", "longtext", { req: true, part: "legal" }),
    ...informant,
    f("residenceTownVillage", "10. Town or village of residence of the mother", "text", { req: true, part: "statistical" }),
    f("religionFather", "11(a). Religion of the father", "text", { part: "statistical" }),
    f("religionMother", "11(b). Religion of the mother", "text", { part: "statistical" }),
    f("educationFather", "12. Father's level of education", "text", { part: "statistical", hint: EDUCATION_NOTE }),
    f("educationMother", "13. Mother's level of education", "text", { part: "statistical", hint: EDUCATION_NOTE }),
    f("occupationFather", "14. Father's occupation", "text", { part: "statistical" }),
    f("occupationMother", "15. Mother's occupation", "text", { part: "statistical" }),
    f("motherAgeAtMarriage", "16. Age of the mother at marriage (years)", "int", { min: 0, max: 80, part: "statistical" }),
    f("motherAgeAtBirth", "17. Age of the mother at this birth (years)", "int", { req: true, min: 8, max: 80, part: "statistical" }),
    f("childrenBornAlive", "18. Number of children born alive to the mother so far", "int", { req: true, min: 1, max: 30, part: "statistical" }),
    f("attentionAtDelivery", "19. Type of attention at delivery", "enum", { req: true, options: ATTENTION, part: "statistical" }),
    f("methodOfDelivery", "20. Method of delivery", "enum", { req: true, options: [["natural", "Natural"], ["caesarean", "Caesarean"], ["forceps-vacuum", "Forceps or Vacuum"]], part: "statistical" }),
    f("birthWeightKg", "21. Birth weight (kg)", "number", { min: 0.2, max: 7, part: "statistical" }),
    f("pregnancyWeeks", "22. Duration of pregnancy (weeks)", "int", { req: true, min: 20, max: 45, part: "statistical" }),
  ],
  listColumns: ["dateOfBirth", "sex", "motherName", "methodOfDelivery", "birthWeightKg"],
};

const DEATH = {
  title: "Death report (Form No. 2)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8; Model RBD Rules 1999 r.5, Form No. 2",
  patient: "deceased", dateField: "dateOfDeath", confidential: [],
  fields: [
    f("dateOfDeath", "1. Date of death", "date", { req: true, part: "legal" }),
    f("deceasedName", "2(a). Name of the deceased", "text", { req: true, part: "legal" }),
    f("deceasedDob", "2(c). Date of birth (if available)", "date", { part: "legal" }),
    f("deceasedAge", "2(d). Age", "text", { req: true, part: "legal" }),
    f("sex", "3. Sex", "enum", { req: true, options: SEX_FORM, part: "legal" }),
    f("motherName", "4. Mother: name", "text", { part: "legal" }),
    f("fatherName", "5. Father: name", "text", { part: "legal" }),
    f("spouseName", "6. Spouse (husband or wife): name", "text", { part: "legal" }),
    f("addressAtDeath", "7. Address of the deceased at the time of death", "longtext", { req: true, part: "legal" }),
    f("permanentAddress", "8. Permanent address of the deceased", "longtext", { req: true, part: "legal" }),
    f("placeOfDeathType", "9. Place of death", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfDeathName", "9. Name and address of the hospital, house or place", "longtext", { req: true, part: "legal" }),
    ...informant,
    f("residenceTownVillage", "11. Town or village of residence of the deceased", "text", { req: true, part: "statistical" }),
    f("religion", "12. Religion", "text", { part: "statistical" }),
    f("occupation", "13. Occupation of the deceased", "text", { part: "statistical" }),
    f("medicalAttention", "14. Type of medical attention received before death", "enum", { req: true, options: [["institutional", "Institutional"], ["other-medical", "Medical attention other than institution"], ["none", "No medical attention"]], part: "statistical" }),
    f("medicallyCertified", "15. Was the cause of death medically certified?", "enum", { req: true, options: YN, part: "statistical" }),
    f("diseaseOrCause", "16. Name of disease or actual cause of death", "text", { req: true, part: "statistical" }),
    f("pregnancyRelated", "17. If a female death: while pregnant, at delivery, or within 6 weeks after the end of pregnancy?", "enum", { options: YN_NA, part: "statistical" }),
    f("smoking", "18. Habitually smoking (years, blank if not)", "int", { min: 0, max: 100, part: "statistical" }),
    f("tobaccoChewing", "19. Habitually chewing tobacco (years, blank if not)", "int", { min: 0, max: 100, part: "statistical" }),
    f("arecaNut", "20. Habitually chewing areca nut or pan masala (years, blank if not)", "int", { min: 0, max: 100, part: "statistical" }),
    f("alcohol", "21. Habitually drinking alcohol (years, blank if not)", "int", { min: 0, max: 100, part: "statistical" }),
  ],
  rules: (v) => (v.sex === "female" && !v.pregnancyRelated ? ["pregnancyRelated: answer question 17 for a female death"] : []),
  listColumns: ["dateOfDeath", "deceasedName", "deceasedAge", "sex", "diseaseOrCause"],
};

const STILLBIRTH = {
  title: "Still birth report (Form No. 3)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8; Model RBD Rules 1999 r.5, Form No. 3",
  patient: "mother", dateField: "dateOfBirth", confidential: [],
  fields: [
    f("dateOfBirth", "1. Date of still birth", "date", { req: true, part: "legal" }),
    f("sex", "2. Sex", "enum", { options: SEX_FORM, part: "legal" }),
    f("fatherName", "Father: name", "text", { part: "legal" }),
    f("motherName", "Mother: name", "text", { req: true, part: "legal" }),
    f("placeOfBirthType", "Place of still birth", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfBirthName", "Name and address of the hospital, house or place", "longtext", { req: true, part: "legal" }),
    ...informant,
    f("residenceTownVillage", "Town or village of residence of the mother", "text", { req: true, part: "statistical" }),
    f("motherAge", "Age of the mother (years)", "int", { req: true, min: 8, max: 80, part: "statistical" }),
    f("educationMother", "Mother's level of education", "text", { part: "statistical", hint: EDUCATION_NOTE }),
    f("attentionAtDelivery", "Type of attention at delivery", "enum", { req: true, options: ATTENTION, part: "statistical" }),
    f("pregnancyWeeks", "Duration of pregnancy (weeks)", "int", { req: true, min: 20, max: 45, part: "statistical" }),
    /* The form numbers its causes of foetal death (bleeding, placental, cord, pre-eclampsia, defects, maternal
     * infections, not stated). The complete numbered list was not legible in the text read, so it is taken as written
     * on the paper form rather than offered as a list that might be short. */
    f("causeOfFoetalDeath", "Cause of foetal death (as numbered on Form No. 3)", "text", { req: true, part: "statistical" }),
  ],
  listColumns: ["dateOfBirth", "motherName", "pregnancyWeeks", "causeOfFoetalDeath"],
};

/* MEDICAL CERTIFICATE OF CAUSE OF DEATH. Form No. 4 (hospital in-patients) and 4A (non-institutional), Model RBD
 * Rules 1999 r.7, current forms read at the CRS URL above. The underlying cause is the condition entered LAST in
 * Part I, never a mode of dying ("heart failure", "asthenia"), and is coded to ICD-10 (Physicians' Manual on MCCD,
 * ORGI, 5th ed. 2012, annexure of ICD-10 three-character categories). */
const ICD10 = /^[A-TV-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;
const MCCD = {
  title: "Medical certificate of cause of death (Form No. 4 / 4A)", authority: "Registrar of Births and Deaths, with Form No. 2; a copy to the nearest relative",
  citation: "RBD Act 1969 s.10(2) and (3) as substituted in 2023; Model RBD Rules 1999 r.7, Forms No. 4 and 4A",
  patient: "deceased", dateField: "dateOfDeath", confidential: [],
  fields: [
    f("form", "Form", "enum", { req: true, options: [["4", "Form No. 4 (hospital in-patient)"], ["4A", "Form No. 4A (not in a medical institution)"]] }),
    f("wardNo", "Ward number (Form No. 4)", "text"),
    f("attendedFrom", "Attended the deceased from (Form No. 4A)", "date"),
    f("attendedTo", "Attended the deceased to (Form No. 4A)", "date"),
    f("dateOfDeath", "Date of death", "date", { req: true }),
    f("timeOfDeath", "Time of death (24 hour, HH:MM)", "time"),
    f("deceasedName", "Name of the deceased", "text", { req: true }),
    f("sex", "Sex", "enum", { req: true, options: SEX_FORM }),
    f("ageValue", "Age at death", "int", { req: true, min: 0, max: 130 }),
    f("ageUnit", "Age at death: unit", "enum", { req: true, options: [["years", "Years (1 year or above)"], ["months", "Months (below 1 year)"], ["days", "Days (below 1 month)"], ["hours", "Hours (below 1 day)"]] }),
    f("causeIa", "Part I (a) Immediate cause: the disease, injury or complication which caused death, not the mode of dying", "text", { req: true }),
    f("intervalIa", "Part I (a) Interval between onset and death (approx.)", "text"),
    f("causeIb", "Part I (b) Antecedent cause: due to (or as a consequence of)", "text"),
    f("intervalIb", "Part I (b) Interval between onset and death (approx.)", "text"),
    f("causeIc", "Part I (c) due to (or as a consequence of), underlying condition stated last", "text"),
    f("intervalIc", "Part I (c) Interval between onset and death (approx.)", "text"),
    f("causeII", "Part II Other significant conditions contributing to the death but not related to the disease or condition causing it", "longtext"),
    f("underlyingIcd10", "ICD-10 code of the underlying cause (the condition entered last in Part I)", "text", { req: true, max: 8 }),
    f("mannerOfDeath", "Manner of death", "enum", { req: true, options: [["natural", "Natural"], ["accident", "Accident"], ["suicide", "Suicide"], ["homicide", "Homicide"], ["pending-investigation", "Pending investigation"]] }),
    f("howInjuryOccurred", "How did the injury occur?", "longtext"),
    f("pregnancyAssociated", "If the deceased was a female, was pregnancy associated with the death?", "enum", { options: YN_NA }),
    f("deliveryOccurred", "If yes, was there a delivery?", "enum", { options: YN_NA }),
    f("certifier", "Name of the medical attendant certifying the cause of death (type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const p = [];
    if (v.underlyingIcd10 && !ICD10.test(String(v.underlyingIcd10).toUpperCase())) p.push("underlyingIcd10: an ICD-10 code such as I21.9 or A15");
    if (v.mannerOfDeath && v.mannerOfDeath !== "natural" && !v.howInjuryOccurred) p.push("howInjuryOccurred: required when the manner of death is not natural");
    if (v.sex === "female" && !v.pregnancyAssociated) p.push("pregnancyAssociated: answer for a female death");
    if (v.pregnancyAssociated === "yes" && !v.deliveryOccurred) p.push("deliveryOccurred: answer when pregnancy was associated with the death");
    if (v.form === "4A" && (!v.attendedFrom || !v.attendedTo)) p.push("attendedFrom and attendedTo: Form No. 4A states the period the practitioner attended");
    if (v.form === "4A" && v.attendedFrom && v.attendedTo && v.attendedTo < v.attendedFrom) p.push("attendedTo: cannot be before attendedFrom");
    return p;
  },
  /* The underlying cause as the form defines it: the last line of Part I that was filled in. */
  derive: (v) => ({ underlyingCause: v.causeIc || v.causeIb || v.causeIa || null, underlyingIcd10: v.underlyingIcd10 ? String(v.underlyingIcd10).toUpperCase() : v.underlyingIcd10 }),
  listColumns: ["dateOfDeath", "deceasedName", "causeIa", "underlyingIcd10", "mannerOfDeath"],
};

/* THE NDPS DAILY OR SHIFT COUNT. Not a statutory form: the entries of the controlled-drug register itself are the
 * stock records (controlled-drugs.js). A count checks the shelf against that ledger and says whether they differ;
 * it never corrects the ledger (that is a reconciliation, with its own reason, on the stock screen). */
const NDPSCOUNT = {
  title: "Controlled drug count", authority: "Hospital (internal check of the NDPS register)", citation: "See controlled-drugs.js",
  patient: "none", dateField: "countedOn", confidential: [], internal: true,
  fields: [
    f("countedOn", "Date of the count", "date", { req: true }),
    f("shift", "Shift", "text"),
    f("code", "Drug code or name", "text", { req: true }),
    f("location", "Location", "text"),
    f("unit", "Unit", "text", { req: true }),
    f("counted", "Quantity counted", "number", { req: true, min: 0, max: 1000000 }),
    f("expected", "Quantity the register holds", "number", { min: -1000000, max: 1000000, server: true }),
    f("variance", "Counted minus register", "number", { min: -1000000, max: 1000000, server: true }),
    f("note", "Note", "longtext"),
  ],
  listColumns: ["countedOn", "shift", "code", "location", "counted", "expected", "variance"],
};

/* PCPNDT FORM F. Pre-Conception and Pre-Natal Diagnostic Techniques (Prohibition of Sex Selection) Act 1994 and Rules
 * 1996, Form F "[See proviso to Section 4(3), rule 9(4) and rule 10(1A)] (New amended on 4th February, 2014 notified on
 * 31st January 2014)", read from the state mirror https://nhmmeghalaya.nic.in/programmes/pcpndt/form-f.pdf (the central
 * gazette and pndt.gov.in refused every fetch). Sections A (every procedure), B (non-invasive), C (invasive), D
 * (declarations). The monthly report of Form F to the Appropriate Authority is required by rule 9; its sub-rule number
 * and due day could not be read from a primary text, so the screen says to file by the date the Authority sets.
 *
 * NOTHING ABOUT THE SEX OF A FOETUS IS STORED. The form has no such field and this schema refuses any unknown field;
 * the free-text fields are also refused when they name the sex of a foetus, so a result cannot carry it by accident.
 * (Section A field 4 asks the number and ages of the woman's living sons and daughters: that is the form's own
 * question about children already born, and it is kept as the form asks.) */
const FOETAL_SEX = /\b(sex|gender)\s+(of\s+(the\s+)?)?(foetus|fetus|baby|child|unborn)\b|\b(foetal|fetal)\s+(sex|gender)\b|\b(male|female)\s+(foetus|fetus|baby|child)\b|\b(it'?s|is)\s+an?\s+(boy|girl)\b/i;
const FORMF_INDICATIONS = [
  ["i", "i. To diagnose intra-uterine and/or ectopic pregnancy and confirm viability"], ["ii", "ii. Estimation of gestational age (dating)"],
  ["iii", "iii. Detection of number of foetuses and their chorionicity"], ["iv", "iv. Suspected pregnancy with IUCD in-situ or suspected pregnancy following contraceptive failure/MTP failure"],
  ["v", "v. Vaginal bleeding/leaking"], ["vi", "vi. Follow-up of cases of abortion"], ["vii", "vii. Assessment of cervical canal and diameter of internal os"],
  ["viii", "viii. Discrepancy between uterine size and period of amenorrhoea"], ["ix", "ix. Any suspected adnexal or uterine pathology/abnormality"],
  ["x", "x. Detection of chromosomal abnormalities, foetal structural defects and other abnormalities and their follow-up"],
  ["xi", "xi. To evaluate foetal presentation and position"], ["xii", "xii. Assessment of liquor amnii"], ["xiii", "xiii. Preterm labour/preterm premature rupture of membranes"],
  ["xiv", "xiv. Evaluation of placental position, thickness, grading and abnormalities"], ["xv", "xv. Evaluation of umbilical cord"],
  ["xvi", "xvi. Evaluation of previous Caesarean Section scars"], ["xvii", "xvii. Evaluation of foetal growth parameters, foetal weight and foetal well being"],
  ["xviii", "xviii. Colour flow mapping and duplex Doppler studies"], ["xix", "xix. Ultrasound guided procedures such as medical termination of pregnancy, external cephalic version etc. and their follow-up"],
  ["xx", "xx. Adjunct to diagnostic and therapeutic invasive interventions"], ["xxi", "xxi. Observation of intra-partum events"],
  ["xxii", "xxii. Medical/surgical conditions complicating pregnancy"], ["xxiii", "xxiii. Research/scientific studies in recognised institutions"],
];
const FORMF = {
  title: "PCPNDT Form F", authority: "District Appropriate Authority (PC&PNDT Act)", citation: "PC&PNDT Act 1994 s.4(3); PC&PNDT Rules 1996 r.9(4), r.10(1A), Form F as amended 2014",
  patient: "required", dateField: "procedureDate", confidential: [],
  fields: [
    f("clinicName", "A1. Name and complete address of the Genetic Clinic / Ultrasound Clinic / Imaging Centre", "longtext", { req: true }),
    f("clinicRegistrationNo", "A2. Registration No. (under PC&PNDT Act, 1994)", "text", { req: true }),
    f("patientName", "A3. Patient's name", "text", { req: true }),
    f("patientAge", "A3. Age", "int", { req: true, min: 10, max: 70 }),
    f("livingSons", "A4(a). Living sons, with age of each", "text"),
    f("livingDaughters", "A4(b). Living daughters, with age of each", "text"),
    f("relativeName", "A5. Husband's / Wife's / Father's / Mother's name", "text", { req: true }),
    f("address", "A6. Full postal address of the patient with contact number", "longtext", { req: true }),
    f("referredBy", "A7(a). Referred by (full name and address of doctor(s) / genetic counselling centre); preserve the referral slip with Form F", "longtext"),
    f("selfReferral", "A7(b). Self-referral by gynaecologist / radiologist / registered medical practitioner (name); not a request by the client or a relative", "text"),
    f("lmpOrWeeks", "A8. Last menstrual period or weeks of pregnancy", "text", { req: true }),
    f("procedureKind", "Section B (non-invasive) or Section C (invasive)", "enum", { req: true, options: [["non-invasive", "Section B: non-invasive (ultrasound)"], ["invasive", "Section C: invasive"]] }),
    f("doctorName", "B9 / C17. Name of the doctor(s) performing the procedure", "text", { req: true }),
    f("indications", "B10. Indication(s) for the diagnostic procedure (ultrasound during pregnancy)", "multi", { options: FORMF_INDICATIONS }),
    f("procedureCarriedOut", "B11. Procedure carried out (non-invasive)", "enum", { options: [["ultrasound", "(i) Ultrasound"], ["other", "(ii) Any other"]] }),
    f("otherProcedure", "B11(ii). Any other (specify)", "text"),
    f("declarationDate", "B12. Date on which the declaration of the pregnant woman was obtained", "date"),
    f("procedureDate", "B13 / C25. Date the procedure was carried out", "date", { req: true }),
    f("resultBrief", "B14 / C24. Result of the procedure (brief)", "longtext", { req: true }),
    f("resultConveyedTo", "B15 / C26. Result conveyed to", "text", { req: true }),
    f("resultConveyedOn", "B15 / C26. Result conveyed on", "date", { req: true }),
    f("mtpIndication", "B16 / C27. Any indication for MTP as per the abnormality detected", "text"),
    f("familyHistory", "C18. History of genetic/medical disease in the family (specify)", "longtext"),
    f("familyHistoryBasis", "C18. Basis of diagnosis", "enum", { options: [["clinical", "(a) Clinical"], ["bio-chemical", "(b) Bio-chemical"], ["cytogenetic", "(c) Cytogenetic"], ["other", "(d) Other (radiological, ultrasonography etc.)"]] }),
    f("invasiveIndications", "C19. Indication(s) for the diagnosis", "multi", { options: [["a-i", "A(i) Previous child with chromosomal disorders"], ["a-ii", "A(ii) Metabolic disorders"], ["a-iii", "A(iii) Congenital anomaly"], ["a-iv", "A(iv) Mental disability"], ["a-v", "A(v) Haemoglobinopathy"], ["a-vi", "A(vi) Sex linked disorders"], ["a-vii", "A(vii) Single gene disorder"], ["a-viii", "A(viii) Any other"], ["b", "B. Advanced maternal age (35 years)"], ["c", "C. Mother/father/sibling has genetic disease"], ["d", "D. Other"]] }),
    f("formGConsentDate", "C20. Date on which consent of the pregnant woman was obtained in Form G", "date"),
    f("invasiveProcedures", "C21. Invasive procedures carried out", "multi", { options: [["amniocentesis", "(i) Amniocentesis"], ["chorionic-villi", "(ii) Chorionic Villi aspiration"], ["fetal-biopsy", "(iii) Foetal biopsy"], ["cordocentesis", "(iv) Cordocentesis"], ["other", "(v) Any other"]] }),
    f("complications", "C22. Any complication of the invasive procedure (specify)", "longtext"),
    f("additionalTests", "C23. Additional tests recommended", "multi", { options: [["chromosomal", "(i) Chromosomal studies"], ["biochemical", "(ii) Biochemical studies"], ["molecular", "(iii) Molecular studies"], ["pre-implantation", "(iv) Pre-implantation gender diagnosis"], ["other", "(v) Any other"]] }),
    f("womanDeclaration", "D. Declaration of the pregnant woman: I do not want to know the sex of my foetus (type her full name as attested)", "attest", { req: true }),
    f("doctorDeclaration", "D. Declaration of the doctor: while conducting the procedure I have neither detected nor disclosed the sex of her foetus to anybody in any manner (type full name)", "attest", { req: true }),
  ],
  requiredWhen: (v) => (v.procedureKind === "invasive" ? ["familyHistoryBasis", "invasiveIndications", "formGConsentDate", "invasiveProcedures"] : v.procedureKind === "non-invasive" ? ["indications", "procedureCarriedOut", "declarationDate"] : []),
  rules: (v) => {
    const p = [];
    for (const k of Object.keys(v)) if (typeof v[k] === "string" && FOETAL_SEX.test(v[k])) p.push(`${k}: must not state the sex of a foetus. Nothing about it is recorded.`);
    if (v.procedureCarriedOut === "other" && !v.otherProcedure) p.push("otherProcedure: specify the other procedure");
    if (v.resultConveyedOn && v.procedureDate && v.resultConveyedOn < v.procedureDate) p.push("resultConveyedOn: cannot be before the procedure date");
    return p;
  },
  listColumns: ["procedureDate", "patientName", "procedureKind", "doctorName", "resultConveyedOn"],
};

/* MTP. Medical Termination of Pregnancy Act 1971 as amended by the MTP (Amendment) Act 2021 (No. 8 of 2021, in force
 * 24 Sep 2021): s.3(2) one registered medical practitioner's opinion up to 20 weeks; not less than two between 20 and
 * 24 weeks for the categories of women the rules prescribe; the length limits do not apply where a Medical Board
 * diagnoses substantial foetal abnormalities; s.5A no practitioner reveals the woman's name except to a person
 * authorised by law (text as quoted in state training material, the gazette itself refused every fetch).
 * MTP Regulations 2003 (13 June 2003), read at https://indiankanoon.org/doc/8267811/:
 *   reg.3  the opinion(s) certified in Form I; the termination certified within three hours.
 *   reg.4  forms kept sealed, marked "secret" with the Admission Register serial number; 4(5) the head of the hospital
 *          sends "to the Chief Medical Officer of the State, in Form II a monthly statement".
 *   reg.5  Admission Register in Form III, kept five years from the end of the calendar year; serial numbers restart
 *          each year and carry it ("5/1972"); a secret document, not disclosed to any person.
 *   reg.6  not open to inspection except under the authority of law.  reg.7  the woman's name appears in no other
 *          register, case sheet or card: the serial number is used instead.
 * The Rule 3B list of women eligible between 20 and 24 weeks was not read verbatim, so it is not offered as a list:
 * the practitioners record the ground in their own words and certify it. */
const MTP_REASONS = [["danger-to-life", "(a) Danger to life of the pregnant woman"], ["physical-health", "(b) Grave injury to the physical health of the pregnant woman"],
  ["mental-health", "(c) Grave injury to the mental health of the pregnant woman"], ["rape", "(d) Pregnancy caused by rape"],
  ["foetal-abnormality", "(e) Substantial risk that if the child was born, it would suffer from such physical or mental abnormalities as to be seriously handicapped"],
  ["contraceptive-failure", "(f) Failure of any contraceptive device or method"]];
const MTP = {
  title: "MTP Admission Register (Form III)", authority: "Chief Medical Officer (monthly statement in Form II)", citation: "MTP Act 1971 s.3, s.5A (as amended 2021); MTP Regulations 2003 regs.3 to 7, Forms I, II, III",
  patient: "required", dateField: "admissionDate", confidential: ["patientName", "relation", "address"], serial: "MTP",
  serialFormat: (n, year) => `${n}/${year}`,
  fields: [
    f("admissionDate", "2. Date of admission", "date", { req: true }),
    f("patientName", "3. Name of the patient", "text", { req: true }),
    f("relation", "4. Wife/Daughter of", "text"),
    f("age", "5. Age", "int", { req: true, min: 8, max: 60 }),
    f("religion", "6. Religion", "enum", { req: true, options: [["hindu", "Hindu"], ["muslim", "Muslim"], ["christian", "Christian"], ["others", "Others"]] }),
    f("address", "7. Address", "longtext", { req: true }),
    f("gestationWeeks", "8. Duration of pregnancy (completed weeks)", "int", { req: true, min: 1, max: 42 }),
    f("reasons", "9. Reasons on which pregnancy is terminated (Form I grounds)", "multi", { req: true, options: MTP_REASONS }),
    f("groundsNote", "Ground in the practitioners' words (for 20 to 24 weeks, the category of woman under the rules)", "longtext"),
    f("terminationDate", "10. Date of termination of pregnancy", "date"),
    f("dischargeDate", "11. Date of discharge of patient", "date"),
    f("resultRemarks", "12. Result and remarks", "longtext"),
    f("opinionRmp1", "13. Registered medical practitioner forming the opinion (Form I)", "text", { req: true }),
    f("opinionRmp2", "13. Second registered medical practitioner forming the opinion (required above 20 weeks)", "text"),
    f("medicalBoard", "Medical Board reference diagnosing substantial foetal abnormalities (required above 24 weeks)", "text"),
    f("terminatedBy", "14. Registered medical practitioner(s) by whom pregnancy is terminated", "text"),
    f("contraception", "Form II 5. Termination with acceptance of contraception", "enum", { options: [["none", "None"], ["sterilisation", "(a) Sterilisation"], ["iud", "(b) I.U.D."]] }),
    f("consentBy", "Consent (Form C) given by", "enum", { req: true, options: [["woman", "The woman"], ["guardian", "Guardian (minor or mentally ill woman)"]] }),
    f("guardianName", "Guardian's name and relationship (Form C)", "text"),
    f("consentDate", "Date of consent (Form C)", "date", { req: true }),
    f("opinionCertified", "Form I certified by the practitioner recording this entry (type full name)", "attest", { req: true }),
  ],
  requiredWhen: (v) => [...(v.consentBy === "guardian" ? ["guardianName"] : []), ...(v.terminationDate ? ["terminatedBy"] : [])],
  rules: (v) => {
    const p = [];
    const w = Number(v.gestationWeeks);
    /* THE ACT'S LIMITS ARE A REFUSAL, NOT A WARNING: an entry recording a termination the Act does not permit is not
     * something this register writes silently. */
    if (v.terminationDate && w > 20 && !v.opinionRmp2) p.push("opinionRmp2: above 20 weeks the Act requires the opinion of not less than two registered medical practitioners");
    if (v.terminationDate && w > 24 && !v.medicalBoard) p.push("medicalBoard: above 24 weeks a termination needs a Medical Board's diagnosis of substantial foetal abnormalities");
    if (v.opinionRmp2 && v.opinionRmp1 && v.opinionRmp2.toLowerCase() === v.opinionRmp1.toLowerCase()) p.push("opinionRmp2: the second opinion must be a different practitioner");
    if (v.terminationDate && v.admissionDate && v.terminationDate < v.admissionDate) p.push("terminationDate: cannot be before admission");
    if (v.dischargeDate && v.terminationDate && v.dischargeDate < v.terminationDate) p.push("dischargeDate: cannot be before termination");
    return p;
  },
  listColumns: ["admissionDate", "age", "gestationWeeks", "reasons", "terminationDate"],
};

/** PURE. Form II, the monthly statement, counted from the month's entries that record a termination. */
function mtpFormII(entries, hospital, state) {
  const done = (entries || []).filter((e) => e.fields && e.fields.terminationDate);
  const n = (pred) => done.filter(pred).length;
  const w = (e) => Number(e.fields.gestationWeeks);
  const has = (e, r) => (e.fields.reasons || []).includes(r);
  return {
    "1. Name of the State": state || "", "2. Name of the Hospital/approved place": hospital || "",
    "3(a). Duration of pregnancy: up to 12 weeks": n((e) => w(e) <= 12),
    "3(b). Duration of pregnancy: between 12-20 weeks": n((e) => w(e) > 12 && w(e) <= 20),
    /* The 2003 form has two bands; terminations above 20 weeks became lawful in 2021 and are counted here so the
     * total is honest. Remove if the Chief Medical Officer's current form differs. */
    "3. Above 20 weeks (MTP Amendment Act 2021; not a column of the 2003 form)": n((e) => w(e) > 20),
    "4(a). Hindu": n((e) => e.fields.religion === "hindu"), "4(b). Muslim": n((e) => e.fields.religion === "muslim"),
    "4(c). Christian": n((e) => e.fields.religion === "christian"), "4(d). Others": n((e) => e.fields.religion === "others"), "4(e). Total": done.length,
    "5(a). Sterilisation": n((e) => e.fields.contraception === "sterilisation"), "5(b). I.U.D.": n((e) => e.fields.contraception === "iud"),
    ...Object.fromEntries(MTP_REASONS.map(([k, label]) => [`6${label.slice(0, 3)} ${label.slice(4)}`, n((e) => has(e, k))])),
  };
}

/* MEDICO-LEGAL CASES. THESE FIELDS ARE THE HOSPITAL'S RECORD, NOT A STATUTORY FORM, and say so on the screen. No
 * single central MLC register form exists to read, and no state medico-legal manual could be fetched to cite, so none
 * is claimed. What is settled law is only that treatment never waits for the police: Pt. Parmanand Katara v Union of
 * India, AIR 1989 SC 2039 ("The treatment of the patient would not wait for the arrival of the Police or completing the
 * legal formalities"), and Savelife Foundation v Union of India (SC, 30 Mar 2016) on Good Samaritans (read at
 * https://indiankanoon.org/doc/498126/ and https://indiankanoon.org/doc/79865001/). The categories and the police
 * intimation fields below are the ones WardSynQ was asked to keep; a hospital whose state manual asks for more records
 * it in the notes until the form is extended. The statutory section for intimating the police under BNSS 2023 could
 * not be verified and is not cited. */
const MLC = {
  title: "Medico-legal case register", authority: "Police station of jurisdiction (intimation); the hospital keeps the register",
  citation: "Hospital record (no central statutory form); treatment first: Pt. Parmanand Katara v Union of India, AIR 1989 SC 2039",
  patient: "required", dateField: "arrivalAt", confidential: ["historyAsGiven", "injuries", "identificationMarks"], serial: "MLC", statutoryForm: false,
  fields: [
    f("category", "Category", "enum", { req: true, options: [["rta", "Road traffic accident"], ["assault", "Assault"], ["burns", "Burns"], ["poisoning", "Poisoning"],
      ["sexual-assault", "Sexual assault"], ["suspected-suicide", "Suspected suicide attempt"], ["suspected-homicide", "Suspected homicide"], ["fall-industrial", "Fall or industrial injury"],
      ["animal-bite", "Animal bite"], ["brought-dead", "Brought dead"], ["unknown-unconscious", "Unknown or unconscious patient"], ["other", "Other (specify in the history)"]] }),
    f("status", "Status", "enum", { req: true, options: [["open", "Open"], ["closed", "Closed"], ["withdrawn", "Marked in error (withdrawn)"]] }),
    f("arrivalAt", "Date and time of arrival", "datetime", { req: true }),
    f("broughtBy", "Brought by (name, relation or police, contact)", "text", { req: true }),
    f("identificationMarks", "Identification marks", "text"),
    f("historyAsGiven", "History as given, and by whom", "longtext", { req: true }),
    f("policeStation", "Police station intimated", "text", { req: true }),
    f("policeOfficer", "Officer informed (name, rank, number)", "text"),
    f("intimationAt", "Date and time of police intimation", "datetime", { req: true }),
    f("intimationMode", "How the police were informed", "enum", { req: true, options: [["telephone", "Telephone"], ["written", "Written intimation"], ["in-person", "In person"]] }),
    f("intimationNumber", "Intimation or daily diary (GD/DD) number given by the police", "text"),
    f("injuries", "Injuries", "list", { row: [
      { key: "site", label: "Site", req: true, max: 200 },
      { key: "kind", label: "Kind", req: true, type: "enum", options: [["abrasion", "Abrasion"], ["contusion", "Contusion"], ["laceration", "Laceration"], ["incised", "Incised wound"], ["stab", "Stab wound"], ["firearm", "Firearm injury"], ["fracture", "Fracture"], ["burn", "Burn"], ["other", "Other"]] },
      { key: "size", label: "Size", max: 100 }, { key: "description", label: "Description (colour, age of injury, weapon suggested)", max: 500 },
      { key: "nature", label: "Nature", type: "enum", options: [["simple", "Simple"], ["grievous", "Grievous"], ["reserved", "Opinion reserved"]] },
    ] }),
    f("samplesPreserved", "Samples or articles preserved and handed over (to whom, when)", "longtext"),
    f("outcome", "Outcome", "enum", { options: [["admitted", "Admitted"], ["discharged", "Discharged"], ["referred", "Referred"], ["absconded", "Left against advice or absconded"], ["died", "Died"]] }),
    f("doctor", "Doctor recording this medico-legal case (type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const p = [];
    if (v.intimationAt && v.arrivalAt && Date.parse(v.intimationAt) + 3600000 < Date.parse(v.arrivalAt)) p.push("intimationAt: more than an hour before the arrival time; check the date");
    return p;
  },
  listColumns: ["arrivalAt", "category", "policeStation", "intimationAt", "status"],
};

const REGISTERS = {
  birth: BIRTH, death: DEATH, stillbirth: STILLBIRTH, mccd: MCCD, ndpscount: NDPSCOUNT, formf: FORMF, mtp: MTP, mlc: MLC,
};

/** Registers added by their own modules (Form F, MLC, MTP, notifications) join the table here. */
function defineRegister(kind, def) {
  if (!/^[a-z]+$/.test(kind) || REGISTERS[kind]) throw new Error(`register ${kind} is already defined or badly named`);
  REGISTERS[kind] = def;
}

const typeOf = (kind) => PREFIX + kind;

/* ------------------------------------------------------------------------------------------------ validation, PURE */

const LIMIT = { text: 300, longtext: 4000 };

/**
 * PURE. The submitted fields against the register's form. Returns { value, missing, problems }.
 * Unknown keys are PROBLEMS, never dropped: a field this form does not have is either a mistake or content that must
 * not be stored (Form F refuses anything about the sex of a foetus this way), and silently discarding it would report
 * a save that did not keep what was sent.
 */
function validateFields(kind, input, prior) {
  const def = REGISTERS[kind];
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const byKey = new Map(def.fields.map((x) => [x.key, x]));
  const value = {}, missing = [], problems = [];
  for (const k of Object.keys(src)) if (!byKey.has(k)) problems.push(`${k}: not a field of ${def.title}`);
  for (const fd of def.fields) {
    if (fd.server) continue;
    const raw = src[fd.key];
    const blank = raw === undefined || raw === null || str(raw) === "";
    if (blank) { if (fd.req) missing.push(fd.key); continue; }
    const t = fd.type;
    if (t === "text" || t === "longtext") {
      const s = str(raw), max = fd.max || LIMIT[t];
      if (s.length > max) problems.push(`${fd.key}: at most ${max} characters`); else value[fd.key] = s;
    } else if (t === "date") {
      const s = str(raw);
      if (!DATE.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) problems.push(`${fd.key}: a date as YYYY-MM-DD`); else value[fd.key] = s;
    } else if (t === "datetime") {
      const s = str(raw);
      if (Number.isNaN(Date.parse(s)) || !/^\d{4}-\d{2}-\d{2}T/.test(s)) problems.push(`${fd.key}: a date and time`); else value[fd.key] = new Date(s).toISOString();
    } else if (t === "time") {
      const s = str(raw);
      if (!TIME.test(s)) problems.push(`${fd.key}: a time as HH:MM`); else value[fd.key] = s;
    } else if (t === "int" || t === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || (t === "int" && !Number.isInteger(n))) problems.push(`${fd.key}: ${t === "int" ? "a whole number" : "a number"}`);
      else if ((fd.min != null && n < fd.min) || (fd.max != null && n > fd.max)) problems.push(`${fd.key}: from ${fd.min} to ${fd.max}`);
      else value[fd.key] = n;
    } else if (t === "enum") {
      const s = str(raw);
      if (!fd.options.some((o) => o[0] === s)) problems.push(`${fd.key}: one of ${fd.options.map((o) => o[0]).join(", ")}`); else value[fd.key] = s;
    } else if (t === "multi") {
      const list = Array.isArray(raw) ? raw.map(str).filter(Boolean) : [];
      const bad = list.filter((s) => !fd.options.some((o) => o[0] === s));
      if (bad.length) problems.push(`${fd.key}: not on the list: ${bad.join(", ")}`);
      else if (list.length) value[fd.key] = [...new Set(list)]; else if (fd.req) missing.push(fd.key);
    } else if (t === "list") {
      /* Rows of sub-fields (injuries on a medico-legal case). Each row is validated against fd.row. */
      const rows = Array.isArray(raw) ? raw : [];
      const out = [];
      rows.slice(0, 50).forEach((r, i) => {
        const row = {};
        for (const sub of fd.row) {
          const v = r && r[sub.key];
          if (v === undefined || v === null || str(v) === "") { if (sub.req) problems.push(`${fd.key}[${i}].${sub.key}: required`); continue; }
          if (sub.type === "enum") { if (!sub.options.some((o) => o[0] === str(v))) problems.push(`${fd.key}[${i}].${sub.key}: one of ${sub.options.map((o) => o[0]).join(", ")}`); else row[sub.key] = str(v); }
          else if (str(v).length > (sub.max || 300)) problems.push(`${fd.key}[${i}].${sub.key}: at most ${sub.max || 300} characters`);
          else row[sub.key] = str(v);
        }
        for (const k of Object.keys(r || {})) if (!fd.row.some((x) => x.key === k)) problems.push(`${fd.key}[${i}].${k}: not a field of this row`);
        if (Object.keys(row).length) out.push(row);
      });
      if (rows.length > 50) problems.push(`${fd.key}: at most 50 rows`);
      if (out.length) value[fd.key] = out; else if (fd.req) missing.push(fd.key);
    } else if (t === "attest") {
      /* A typed attestation. The name typed is kept; who was signed in and when is stamped by save(), never taken
       * from the request. An unchanged name on a correction keeps its original stamp. */
      const name = str(raw && typeof raw === "object" ? raw.name : raw);
      if (name.length < 3 || name.length > 120) problems.push(`${fd.key}: type the full name (3 to 120 characters)`);
      else value[fd.key] = { name, prior: prior && prior[fd.key] && prior[fd.key].name === name ? prior[fd.key] : null };
    }
  }
  if (def.requiredWhen) for (const k of def.requiredWhen(value)) if (value[k] === undefined && !missing.includes(k)) missing.push(k);
  if (def.rules) problems.push(...def.rules(value));
  return { value, missing, problems };
}

/* ------------------------------------------------------------------------------------------------ the store */

const audit = (action, actorId, scope, patientRefHash) => ({ ts: new Date().toISOString(), actor: actorId, connectorId: "wardsynq-registers", action, outcome: "ok", scope, patientRefHash: patientRefHash || null });
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const NOT_HOSPITAL = { ok: false, status: 404, error: "not_a_wardsynq_hospital", message: "Registers are kept for a WardSynQ hospital." };
const READ_FAILED = { ok: false, status: 502, error: "register_read_failed", message: "The register could not be read. Do not read this as empty." };
const writeFailed = (e) => (e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This entry changed at the same moment. Reload it; nothing was saved.", written: 0 }
  : { ok: false, status: 502, error: "register_write_failed", message: "The entry could not be saved, so nothing was recorded.", written: 0 });

async function patientHash(ctx, patientId) {
  if (!patientId || !ctx.recordDeps || typeof ctx.recordDeps.pseudonym !== "function") return null;
  try { return await ctx.recordDeps.pseudonym(patientId); } catch { return null; }
}

/** The next serial for a register in a year, allocated in the same append as the entry (see save). */
async function nextSerial(repo, tenantId, kind, year) {
  const id = `${kind}-${year}`;
  const cur = await repo.latest(tenantId, SERIAL_TYPE, id);
  const n = (cur ? cur.n : 0) + 1;
  return { record: { resourceType: SERIAL_TYPE, id, version: (cur ? cur.version : 0) + 1, kind, year, n }, n };
}

/**
 * Save an entry: a new one, or a correction as the next version.
 * ctx: { migration, recordDeps, actor: {id, role}, kind, id?, entryId? (deterministic id for a new entry),
 *        expectedVersion?, reason?, patientId?, encounterId?, links?: object, fields, serverFields?: object,
 *        idempotencyKey? }
 * Returns { ok, written, entry } or a refusal with nothing written.
 */
async function saveEntry(ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return NOT_HOSPITAL;
  const def = REGISTERS[str(ctx.kind)];
  if (!def) return { ok: false, status: 404, error: "unknown_register", written: 0 };
  const kind = str(ctx.kind), type = typeOf(kind), repo = ctx.recordDeps.repository, tenantId = mig.tenantId;
  const who = ctx.actor || {};
  if (!str(who.id)) return { ok: false, status: 401, error: "auth", written: 0 };

  const correcting = !!str(ctx.id);
  const id = correcting ? str(ctx.id) : (str(ctx.entryId) || `reg-${kind}-${crypto.randomUUID()}`);
  let prior;
  try { prior = await repo.latest(tenantId, type, id); } catch { return { ...READ_FAILED, written: 0 }; }
  if (correcting && !prior) return { ok: false, status: 404, error: "entry_not_found", message: "No such entry in this register.", written: 0 };
  if (!correcting && prior) {
    return { ok: false, status: 409, error: "already_recorded", message: "This is already in the register. Open it and correct it, with a reason.", entry: prior, written: 0 };
  }
  const reason = str(ctx.reason);
  if (correcting) {
    if (ctx.expectedVersion === undefined || ctx.expectedVersion === null || Number(ctx.expectedVersion) !== prior.version) {
      return { ok: false, status: 409, error: "version_conflict", message: "This entry changed since it was opened. Reload it; nothing was saved.", entry: prior, written: 0 };
    }
    if (reason.length < 5) return { ok: false, status: 422, error: "reason_required", message: "A correction says why (at least 5 characters). Nothing was saved.", written: 0 };
  }

  const v = validateFields(kind, ctx.fields, prior && prior.fields);
  if (v.problems.length) return { ok: false, status: 422, error: "invalid_fields", problems: v.problems, message: "Some fields are not valid. Nothing was saved.", written: 0 };
  const now = new Date().toISOString();
  const fields = { ...v.value };
  for (const fd of def.fields) {
    if (fd.type === "attest" && fields[fd.key]) {
      const keep = fields[fd.key].prior;
      fields[fd.key] = keep || { name: fields[fd.key].name, by: str(who.id), at: now };
    }
  }
  for (const [k, val] of Object.entries(ctx.serverFields || {})) if (def.fields.some((x) => x.key === k && x.server)) fields[k] = val;
  Object.assign(fields, def.derive ? def.derive(fields) : {});
  const patientId = correcting ? prior.patientId || null : str(ctx.patientId) || null;
  if (def.patient !== "none" && def.patient !== "optional" && !patientId) return { ok: false, status: 422, error: "patient_required", message: "Name the patient this entry is for.", written: 0 };
  const eventDate = str(fields[def.dateField]).slice(0, 10);
  const entry = {
    resourceType: type, id, version: (prior ? prior.version : 0) + 1, kind,
    serial: prior ? prior.serial || null : null,
    patientId, encounterId: correcting ? prior.encounterId || null : str(ctx.encounterId) || null,
    links: correcting ? prior.links || {} : (ctx.links && typeof ctx.links === "object" ? ctx.links : {}),
    period: eventDate ? eventDate.slice(0, 7) : now.slice(0, 7), eventDate: eventDate || null,
    fields, complete: v.missing.length === 0, missing: v.missing,
    recordedBy: prior ? prior.recordedBy : str(who.id), recordedAt: prior ? prior.recordedAt : now,
    ...(correcting ? { correction: { reason, by: str(who.id), at: now, of: prior.version } } : {}),
    writtenBy: { id: str(who.id), role: str(who.role) || null, at: now },
  };
  const hash = await patientHash(ctx, patientId);
  const scope = { register: kind, id, version: entry.version, complete: entry.complete, correction: correcting };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const records = [];
    if (def.serial && !entry.serial) {
      const year = (eventDate || now).slice(0, 4);
      let s;
      try { s = await nextSerial(repo, tenantId, kind, year); } catch { return { ...READ_FAILED, written: 0 }; }
      entry.serial = def.serialFormat ? def.serialFormat(s.n, year) : `${def.serial}/${year}/${String(s.n).padStart(5, "0")}`;
      records.push(s.record);
    }
    records.push(entry);
    try {
      await repo.append(tenantId, records, { audit: audit(correcting ? "register.correct" : "register.write", str(who.id), { ...scope, serial: entry.serial || null }, hash), idempotencyKey: attempt === 0 && ctx.idempotencyKey ? String(ctx.idempotencyKey) : null });
      return { ok: true, written: 1, entry };
    } catch (e) {
      if (!(e instanceof VersionConflictError)) return writeFailed(e);
      /* Two things can collide: the serial counter (another entry took the number; take the next) or the entry
       * itself (it was saved at the same moment). Only the first is retried. */
      let now2;
      try { now2 = await repo.latest(tenantId, type, id); } catch { return writeFailed(e); }
      if (now2 && now2.version >= entry.version) return { ok: false, status: 409, error: correcting ? "version_conflict" : "already_recorded", message: "This entry was saved by someone else at the same moment. Reload it; nothing was saved.", entry: now2, written: 0 };
      if (!def.serial || prior) return writeFailed(e);
      entry.serial = null;
    }
  }
  return { ok: false, status: 409, error: "serial_busy", message: "The register number could not be allocated. Try again; nothing was saved.", written: 0 };
}

/** What a register list shows: the form's confidential fields removed. The entry itself keeps them. */
function listView(kind, entry) {
  const def = REGISTERS[kind], hide = new Set(def.confidential || []);
  const fields = {};
  for (const [k, val] of Object.entries(entry.fields || {})) if (!hide.has(k)) fields[k] = val;
  return { ...entry, fields };
}

/**
 * One register's entries for a period (YYYY-MM), or between two dates on the event date, newest first.
 * ctx: { migration, recordDeps, actor, kind, period?, from?, to?, patientId?, filter?: (entry) => bool }
 */
async function listEntries(ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return NOT_HOSPITAL;
  const kind = str(ctx.kind), def = REGISTERS[kind];
  if (!def) return { ok: false, status: 404, error: "unknown_register" };
  const period = str(ctx.period), from = str(ctx.from), to = str(ctx.to);
  if (period && !/^\d{4}-\d{2}$/.test(period)) return { ok: false, status: 422, error: "bad_period", message: "Give the month as YYYY-MM." };
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return { ok: false, status: 422, error: "bad_dates", message: "Give dates as YYYY-MM-DD." };
  const repo = ctx.recordDeps.repository;
  let rows;
  try {
    rows = str(ctx.patientId) ? await repo.byPatient(mig.tenantId, typeOf(kind), str(ctx.patientId)) : await repo.latestByType(mig.tenantId, typeOf(kind), MAX_LIST, { newest: true });
  } catch { return READ_FAILED; }
  rows = rows || [];
  const truncated = !str(ctx.patientId) && rows.length >= MAX_LIST;
  const entries = rows
    .filter((e) => (!period || e.period === period) && (!from || str(e.eventDate) >= from) && (!to || str(e.eventDate) < to))
    .filter((e) => (typeof ctx.filter === "function" ? ctx.filter(e) : true))
    .sort((a, b) => str(b.eventDate).localeCompare(str(a.eventDate)) || str(b.recordedAt).localeCompare(str(a.recordedAt)));
  try {
    await repo.auditOnly(mig.tenantId, audit("register.read", str(ctx.actor && ctx.actor.id), { register: kind, period: period || null, from: from || null, to: to || null, byPatient: !!str(ctx.patientId), entries: entries.length }, await patientHash(ctx, str(ctx.patientId))));
  } catch { return { ...READ_FAILED, message: "The register read could not be audited, so it was not shown." }; }
  return {
    ok: true, register: kind, title: def.title, period: period || null, entries: entries.map((e) => listView(kind, e)),
    ...(truncated ? { truncated: true, truncatedWarning: `Only the newest ${MAX_LIST} entries of this register were read, so older entries may be missing from this list.` } : {}),
  };
}

/** One entry, whole, with every version. ctx: { migration, recordDeps, actor, kind, id } */
async function entryHistory(ctx) {
  const mig = ctx.migration;
  if (noStore(mig)) return NOT_HOSPITAL;
  const kind = str(ctx.kind), def = REGISTERS[kind];
  if (!def) return { ok: false, status: 404, error: "unknown_register" };
  let versions;
  try { versions = await ctx.recordDeps.repository.history(mig.tenantId, typeOf(kind), str(ctx.id)); } catch { return READ_FAILED; }
  if (!versions || !versions.length) return { ok: false, status: 404, error: "entry_not_found", message: "No such entry in this register." };
  const last = versions[versions.length - 1];
  try {
    await ctx.recordDeps.repository.auditOnly(mig.tenantId, audit("register.read", str(ctx.actor && ctx.actor.id), { register: kind, id: last.id, versions: versions.length }, await patientHash(ctx, last.patientId)));
  } catch { return { ...READ_FAILED, message: "The register read could not be audited, so it was not shown." }; }
  return { ok: true, register: kind, entry: last, versions };
}

/* ------------------------------------------------------------------------------------------------ export, PURE */

const csvCell = (v) => {
  let s = v == null ? "" : typeof v === "object" ? (v.name != null ? v.name : Array.isArray(v) ? v.map((x) => (typeof x === "object" ? Object.values(x).join(" ") : x)).join("; ") : JSON.stringify(v)) : String(v);
  // A cell a spreadsheet would run as a formula is written as text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** PURE. A register as CSV, columns in the form's own order and with the form's own labels (English, as filed). */
function csvFor(kind, entries, opts) {
  const def = REGISTERS[kind], hide = new Set((opts && opts.includeConfidential) ? [] : def.confidential || []);
  const cols = def.fields.filter((x) => !hide.has(x.key));
  const head = ["Register number", "Entry id", "Version", "Complete", ...cols.map((x) => x.label), "Recorded by", "Recorded at", "Last correction reason"];
  const lines = [head.map(csvCell).join(",")];
  for (const e of entries || []) {
    lines.push([e.serial || "", e.id, e.version, e.complete ? "yes" : "no", ...cols.map((x) => (e.fields || {})[x.key]), e.recordedBy, e.recordedAt, e.correction ? e.correction.reason : ""].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** The schema a screen renders a form from: labels, types, options. No entry data. */
function schemaOf(kind) {
  const def = REGISTERS[kind];
  if (!def) return null;
  return { kind, title: def.title, authority: def.authority, citation: def.citation, patient: def.patient, dateField: def.dateField, serial: !!def.serial,
    confidential: def.confidential || [], statutoryForm: def.statutoryForm !== false, internal: !!def.internal, fields: def.fields, definitions: def.definitions || null, listColumns: def.listColumns || [], submission: def.submission || "manual" };
}

export {
  PREFIX, SERIAL_TYPE, MAX_LIST, REGISTERS, ICD10, f, YN, YN_NA, SEX_FORM, defineRegister, typeOf,
  FOETAL_SEX, mtpFormII, validateFields, saveEntry, listEntries, entryHistory, csvFor, schemaOf, listView,
};
