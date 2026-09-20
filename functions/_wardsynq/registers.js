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
import { registerSettings } from "./register-settings.js";
import { formFSubmission, medleaprRequired } from "./legal-requirements.js";

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
 * Registration of Births and Deaths Act 1969 as amended by the RBD (Amendment) Act 2023 (No. 20 of 2023, in force
 * 1 Oct 2023): s.8(1)(b) names "the medical officer in charge or any person authorised by him" as the informant for a
 * birth or death in a hospital; s.10(2) requires every medical institution, free of charge, to give the Registrar a
 * certificate of the cause of death signed by the attending practitioner, and a copy to the nearest relative; s.13 late
 * registration (after 30 days with the District Registrar's permission). Model RBD Rules 1999 r.5(3): reported "within
 * twenty one days". Model RBD (Amendment) Rules 2024, the ORGI template each state notifies
 * (https://dc.crsorgi.gov.in/assets/download/rbd_act_2024.pdf, read 2026-09-17): r.5(4)-(6) names as first, middle and
 * last name without abbreviations, dates dd-mm-yyyy, structured addresses; Forms 1, 2 and 3 with mobile and email; the
 * coded education (22) and occupation (9) lists below are copied from those forms' instructions. r.7: Forms 4 and 4A.
 *
 * AADHAAR NUMBERS ARE NOT STORED. The forms ask for them "if available" (s.8(1)); the number is keyed into the CRS
 * portal at submission. There is no Aadhaar field, an Aadhaar key is refused as an unknown field, and a free-text field
 * holding a twelve-digit number is refused too, so it cannot be kept by accident (legal review E.4.4). */
const ATTENTION = [["institutional-government", "1. Institutional - Government"], ["institutional-private", "2. Institutional - Private or Non-Government"],
  ["doctor-nurse-midwife", "3. Doctor, Nurse or Trained Midwife"], ["traditional-birth-attendant", "4. Traditional Birth Attendant"], ["relatives-others", "5. Relatives or others"]];
const PLACE = [["hospital", "1. Hospital / Institution"], ["house", "2. House"], ["other", "3. Other place"]];
const SEX_FORM = [["male", "Male"], ["female", "Female"], ["transgender", "Transgender person"]];
const EDUCATION = [["1", "1. Pre-Primary"], ["2", "2. Class 1"], ["3", "3. Class 2"], ["4", "4. Class 3"], ["5", "5. Class 4"], ["6", "6. Class 5"], ["7", "7. Class 6"],
  ["8", "8. Class 7"], ["9", "9. Class 8"], ["10", "10. Class 9"], ["11", "11. Class 10"], ["12", "12. Class 11"], ["13", "13. Class 12"], ["14", "14. ITI"],
  ["15", "15. Diploma / Certificate"], ["16", "16. Bachelor / Undergraduate"], ["17", "17. PG Diploma"], ["18", "18. Master / Post graduate"], ["19", "19. M.Phil"],
  ["20", "20. Doctorate & above"], ["21", "21. Literate without formal education"], ["22", "22. Illiterate"]];
const OCCUPATION = [["1", "1. Cultivator"], ["2", "2. Agriculture Labourer"], ["3", "3. Daily Wages Earner(Other than Agriculture Labourer)"], ["4", "4. Single/Family Worker/Self Employed"],
  ["5", "5. Employer"], ["6", "6. Government Employee"], ["7", "7. Private Employee(Other than Domestic Helper)"], ["8", "8. Domestic Helper"], ["9", "9. Non-Worker"]];
const EDUCATION_HINT = "Enter the completed level of education e.g. if studied upto class VII but passed only class VI, write class VI";
const RESIDENCE = ["townVillage", "subDistrict", "district", "state", "pin"];
const RBD_RETENTION = "The Registrar keeps the registers (Model RBD Rules 1999 r.17); no retention period is placed on the hospital. WardSynQ keeps the hospital's copy with the clinical record and never deletes an entry.";
const informant = (n) => [
  f("informantName", `${n}(a). Informant: name`, "name", { req: true, part: "legal" }),
  f("informantMobile", `${n}(c). Informant: mobile number`, "text", { part: "legal", max: 20 }),
  f("informantEmail", `${n}(d). Informant: email`, "text", { part: "legal", max: 120 }),
  f("informantAddress", `${n}(e). Informant: address`, "address", { req: true, part: "legal" }),
  f("informantDeclaration", "Declaration of the informant: I have furnished true information to the best of my knowledge and belief (type full name)", "attest", { req: true, part: "legal" }),
];
const person = (key, n, who, o) => [
  f(`${key}Name`, `${n}(a). ${who}: name`, "name", { part: "legal", ...(o || {}) }),
  f(`${key}Mobile`, `${n}(c). ${who}: mobile number`, "text", { part: "legal", max: 20 }),
  f(`${key}Email`, `${n}(d). ${who}: email`, "text", { part: "legal", max: 120 }),
];
/* s.8(1)(b) and r.5(3): who filed it with the Registrar, when, and the portal's reference. Not part of the form. */
const submission = [
  f("submittedOn", "Submitted to the Registrar on (CRS or state portal)", "date", { part: "submission" }),
  f("crsReference", "CRS or state portal reference", "text", { part: "submission", max: 80 }),
  f("submittedBy", "Submitted by (the medical officer in charge or the person authorised by him, type full name)", "attest", { part: "submission" }),
];
const submissionRule = (v) => (v.crsReference && !v.submittedOn ? ["submittedOn: say when it was submitted"] : []);

const BIRTH = {
  title: "Birth report (Form No. 1)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8 (as amended 2023); Model RBD Rules 1999 r.5 and the 2024 model amendment, Form No. 1",
  patient: "mother", dateField: "dateOfBirth", confidential: [], rbd: true, retention: RBD_RETENTION,
  fields: [
    f("dateOfBirth", "1. Date of birth", "date", { req: true, part: "legal" }),
    f("sex", "2. Sex", "enum", { req: true, options: SEX_FORM, part: "legal" }),
    f("childName", "3(a). Child: name (if named)", "name", { part: "legal" }),
    ...person("father", "4", "Father"),
    ...person("mother", "5", "Mother", { req: true }),
    f("addressAtBirth", "6. Address of parents at the time of birth of the child", "address", { req: true, part: "legal" }),
    f("permanentAddress", "7. Permanent address of parents", "address", { req: true, part: "legal" }),
    f("placeOfBirthType", "8. Place of birth", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfBirthName", "8. Name of the hospital or institution", "text", { part: "legal" }),
    f("placeOfBirthAddress", "8. Address of the hospital, house or other place", "address", { req: true, part: "legal" }),
    ...informant("9"),
    f("residence", "10. Town or village of residence of the mother", "address", { req: true, parts: RESIDENCE, part: "statistical" }),
    f("religionFather", "11(a). Religion of father (Hindu, Muslim, Christian, Sikh, Buddhist, Jain or Other, please specify)", "text", { part: "statistical" }),
    f("religionMother", "11(b). Religion of mother", "text", { part: "statistical" }),
    f("educationFather", "12. Father's level of education", "enum", { options: EDUCATION, part: "statistical", hint: EDUCATION_HINT }),
    f("educationMother", "13. Mother's level of education", "enum", { req: true, options: EDUCATION, part: "statistical", hint: EDUCATION_HINT }),
    f("occupationFather", "14. Father's occupation", "enum", { options: OCCUPATION, part: "statistical" }),
    f("occupationMother", "15. Mother's occupation", "enum", { req: true, options: OCCUPATION, part: "statistical" }),
    f("motherAgeAtMarriage", "16. Age of the mother (in completed years) at the time of marriage (first marriage)", "int", { min: 0, max: 80, part: "statistical" }),
    f("motherAgeAtBirth", "17. Age of the mother (in completed years) at the time of this birth", "int", { req: true, min: 8, max: 80, part: "statistical" }),
    f("childrenBornAlive", "18. Number of children born alive to the mother so far including this child", "int", { req: true, min: 1, max: 30, part: "statistical" }),
    f("attentionAtDelivery", "19. Type of attention at delivery", "enum", { req: true, options: ATTENTION, part: "statistical" }),
    f("methodOfDelivery", "20. Method of delivery", "enum", { req: true, options: [["natural", "1. Natural"], ["caesarean", "2. Caesarean"], ["forceps-vacuum", "3. Forceps/Vacuum"]], part: "statistical" }),
    f("birthWeightKg", "21. Birth weight (in kgs.) (if available)", "number", { min: 0.2, max: 7, part: "statistical" }),
    f("pregnancyWeeks", "22. Duration of pregnancy (in weeks)", "int", { req: true, min: 20, max: 45, part: "statistical" }),
    f("remarks", "Remarks (a separate form for each child of a multiple birth: write 'Twin birth' or 'Triple birth')", "text", { part: "legal" }),
    ...submission,
  ],
  requiredWhen: (v) => (v.placeOfBirthType === "hospital" ? ["placeOfBirthName"] : []),
  rules: submissionRule,
  listColumns: ["dateOfBirth", "sex", "motherName", "methodOfDelivery", "submittedOn"],
};

const DEATH = {
  title: "Death report (Form No. 2)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8 (as amended 2023); Model RBD Rules 1999 r.5 and the 2024 model amendment, Form No. 2",
  patient: "deceased", dateField: "dateOfDeath", confidential: [], rbd: true, retention: RBD_RETENTION,
  fields: [
    f("dateOfDeath", "1. Date of death", "date", { req: true, part: "legal" }),
    f("deceasedName", "2(a). Deceased: name", "name", { req: true, part: "legal" }),
    f("deceasedDob", "2(c). Date of birth (if available)", "date", { part: "legal" }),
    f("deceasedAge", "2(d). Age", "text", { req: true, part: "legal", max: 40 }),
    f("sex", "3. Sex", "enum", { req: true, options: SEX_FORM, part: "legal" }),
    ...person("mother", "4", "Mother"),
    ...person("father", "5", "Father"),
    f("spouseName", "6(a). Spouse (husband / wife): name", "name", { part: "legal" }),
    f("spouseDob", "6(c). Spouse: date of birth (if available)", "date", { part: "legal" }),
    f("spouseAge", "6(d). Spouse: age (in completed years)", "int", { min: 0, max: 130, part: "legal" }),
    f("spouseMobile", "6(e). Spouse: mobile number", "text", { part: "legal", max: 20 }),
    f("spouseEmail", "6(f). Spouse: email", "text", { part: "legal", max: 120 }),
    f("addressAtDeath", "7. Address of the deceased at the time of death", "address", { req: true, part: "legal" }),
    f("permanentAddress", "8. Permanent address of the deceased", "address", { req: true, part: "legal" }),
    f("placeOfDeathType", "9. Place of death", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfDeathName", "9. Name of the hospital or institution", "text", { part: "legal" }),
    f("placeOfDeathAddress", "9. Address of the hospital, house or other place", "address", { req: true, part: "legal" }),
    ...informant("10"),
    f("residence", "11. Town or village of residence of the deceased", "address", { req: true, parts: RESIDENCE, part: "statistical" }),
    f("religion", "12. Religion (Hindu, Muslim, Christian, Sikh, Buddhist, Jain or Other, please specify)", "text", { part: "statistical" }),
    f("occupation", "13. Occupation of the deceased", "enum", { options: OCCUPATION, part: "statistical" }),
    f("medicalAttention", "14. Type of medical attention received before death", "enum", { req: true, options: [["institutional", "1. Institutional"], ["other-medical", "2. Medical attention other than institution"], ["none", "3. No medical attention"]], part: "statistical" }),
    f("medicallyCertified", "15. Was the cause of death medically certified?", "enum", { req: true, options: YN, part: "statistical" }),
    f("diseaseOrCause", "16. Name of disease or actual cause of death", "text", { req: true, part: "statistical" }),
    f("pregnancyRelated", "17. In case this is a female death, did the death occur while pregnant, at the time of delivery or within 6 weeks after the end of pregnancy?", "enum", { options: YN_NA, part: "statistical" }),
    f("smoking", "18. If used to habitually smoke, for how many years?", "int", { min: 0, max: 100, part: "statistical" }),
    f("tobaccoChewing", "19. If used to habitually chew tobacco, for how many years?", "int", { min: 0, max: 100, part: "statistical" }),
    f("arecaNut", "20. If used to habitually chew areca nut (including pan masala), for how many years?", "int", { min: 0, max: 100, part: "statistical" }),
    f("alcohol", "21. If used to habitually drink alcohol, for how many years?", "int", { min: 0, max: 100, part: "statistical" }),
    ...submission,
  ],
  requiredWhen: (v) => (v.placeOfDeathType === "hospital" ? ["placeOfDeathName"] : []),
  rules: (v) => [...(v.sex === "female" && !v.pregnancyRelated ? ["pregnancyRelated: answer question 17 for a female death"] : []), ...submissionRule(v)],
  listColumns: ["dateOfDeath", "deceasedName", "deceasedAge", "sex", "submittedOn"],
};

/* Form No. 3, item 12: "Cause of foetal death (if known) - Write one of following", the eighteen causes as printed on
 * the 2024 form, in its own numbering and spelling (checked against the PDF). */
const FOETAL_DEATH_CAUSES = [["1", "1. Bleeding (Hamorrhage)"], ["2", "2. Problems with Placental"], ["3", "3. Problem with umbilical cord"], ["4", "4. Pre-eclampsia"],
  ["5", "5. Genetic physical defect in the baby"], ["6", "6. Liver disorder in the mother (obstestric cholestas)"], ["7", "7. Diabetes in the mother"],
  ["8", "8. Infection in the mother Coxsackie virus"], ["9", "9. Infection in the mother Herpes simplex"], ["10", "10. Infection in the mother Leptospirosis"],
  ["11", "11. Infection in the mother Lyme disease"], ["12", "12. Infection in the mother Malaria"], ["13", "13. Infection in the mother Parvovirus B19"],
  ["14", "14. Infection in the mother Q fever"], ["15", "15. Infection in the mother Rubella (German measles)"], ["16", "16. Infection in the mother Flu"],
  ["17", "17. Infection in the mother Toxoplamosis"], ["18", "18. Not stated"]];
const STILLBIRTH = {
  title: "Still birth report (Form No. 3)", authority: "Registrar of Births and Deaths (CRS)", citation: "RBD Act 1969 s.8 (as amended 2023); Model RBD Rules 1999 r.5 and the 2024 model amendment, Form No. 3",
  patient: "mother", dateField: "dateOfBirth", confidential: [], rbd: true, retention: RBD_RETENTION,
  fields: [
    f("dateOfBirth", "1. Date of birth", "date", { req: true, part: "legal" }),
    f("sex", "2. Sex", "enum", { options: SEX_FORM, part: "legal" }),
    ...person("father", "3", "Father"),
    ...person("mother", "4", "Mother", { req: true }),
    f("placeOfBirthType", "5. Place of birth", "enum", { req: true, options: PLACE, part: "legal" }),
    f("placeOfBirthName", "5. Name of the hospital or institution", "text", { part: "legal" }),
    f("placeOfBirthAddress", "5. Address of the hospital, house or other place", "address", { req: true, part: "legal" }),
    ...informant("6"),
    f("residence", "7. Town or village of residence of the mother", "address", { req: true, parts: RESIDENCE, part: "statistical" }),
    f("motherAge", "8. Age of the mother (in completed years)", "int", { req: true, min: 8, max: 80, part: "statistical" }),
    f("educationMother", "9. Mother's level of education", "enum", { req: true, options: EDUCATION, part: "statistical", hint: EDUCATION_HINT }),
    f("attentionAtDelivery", "10. Type of attention at delivery", "enum", { req: true, options: ATTENTION, part: "statistical" }),
    f("pregnancyWeeks", "11. Duration of pregnancy (in weeks)", "int", { req: true, min: 20, max: 45, part: "statistical" }),
    f("causeOfFoetalDeath", "12. Cause of foetal death (if known): write one of the following", "enum", { req: true, options: FOETAL_DEATH_CAUSES, part: "statistical", default: "18" }),
    /* The hospital's own clinical note on the cause. Not part of Form No. 3 and never exported with it. */
    f("clinicalNote", "Clinical note on the cause (hospital record only, not submitted)", "longtext", { part: "internal", internal: true }),
    ...submission,
  ],
  requiredWhen: (v) => (v.placeOfBirthType === "hospital" ? ["placeOfBirthName"] : []),
  rules: submissionRule,
  listColumns: ["dateOfBirth", "motherName", "pregnancyWeeks", "causeOfFoetalDeath", "submittedOn"],
};

/* MEDICAL CERTIFICATE OF CAUSE OF DEATH. Form No. 4 (hospital in-patients) and 4A (non-institutional), RBD Rules r.7,
 * read on the 2024 model forms. Form No. 4 carries a Manner of Death and "How did the injury occur?"; Form No. 4A has
 * no Manner of Death field (legal review E.4.6, and the form itself), so it is refused there. Neither form has an
 * ICD-10 field: the code below is the hospital's own coding, optional unless the hospital requires it
 * (registers.mccd.requireIcd10). The certificate is free of charge and a copy goes to the nearest relative (s.10(2)). */
const ICD10 = /^[A-TV-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;
/* Part I is a cause, never a mode of dying (the form's own directions); old age belongs in Part II. A warning, since a
 * doctor may have a reason, and the certificate is still theirs. */
const MODE_OF_DYING = /\b(cardio[- ]?respiratory arrest|cardiac arrest|respiratory arrest|asthenia|old age|senility)\b/i;
const MCCD = {
  title: "Medical certificate of cause of death (Form No. 4 / 4A)", authority: "Registrar of Births and Deaths, with Form No. 2; a copy to the nearest relative, free of charge",
  citation: "RBD Act 1969 s.10(2) as substituted in 2023; Model RBD Rules 1999 r.7, Forms No. 4 and 4A", retention: RBD_RETENTION,
  patient: "deceased", dateField: "dateOfDeath", confidential: [], rbd: true, freeOfCharge: true,
  fields: [
    f("form", "Form", "enum", { req: true, options: [["4", "Form No. 4 (hospital in-patient)"], ["4A", "Form No. 4A (non-institutional death)"]] }),
    f("wardNo", "Ward number (Form No. 4)", "text"),
    f("relationOf", "Son / Wife / Daughter of (Form No. 4A)", "text"),
    f("residentOf", "Resident of (Form No. 4A)", "text"),
    f("attendedFrom", "Under my treatment from (Form No. 4A)", "date"),
    f("attendedTo", "Under my treatment to (Form No. 4A)", "date"),
    f("dateOfDeath", "Date of death", "date", { req: true }),
    f("timeOfDeath", "Time of death (24 hour, HH:MM)", "time"),
    f("deceasedName", "Name of deceased (leave blank for an infant not yet named)", "name"),
    f("sex", "Sex", "enum", { req: true, options: [["male", "1. Male"], ["female", "2. Female"], ["transgender", "3. Transgender person"]] }),
    f("ageValue", "Age at death", "int", { req: true, min: 0, max: 130 }),
    f("ageUnit", "Age at death: unit", "enum", { req: true, options: [["years", "If 1 year or more, age in years"], ["months", "If less than 1 year, age in months"], ["days", "If less than one month, age in days"], ["hours", "If less than one day, age in hours"]] }),
    f("causeIa", "Part I (a) Immediate cause: the disease, injury or complication which caused death, not the mode of dying such as heart failure, asthenia", "text", { req: true }),
    f("intervalIa", "Part I (a) Interval between onset and death (approx.)", "text"),
    f("causeIb", "Part I (b) Antecedent cause: due to (or as a consequence of)", "text"),
    f("intervalIb", "Part I (b) Interval between onset and death (approx.)", "text"),
    f("causeIc", "Part I (c) due to (or as a consequence of), stating underlying conditions last", "text"),
    f("intervalIc", "Part I (c) Interval between onset and death (approx.)", "text"),
    f("causeII", "Part II Other significant conditions contributing to the death but not related to the disease or condition causing it", "longtext"),
    f("mannerOfDeath", "Manner of death (Form No. 4 only)", "enum", { options: [["natural", "1. Natural"], ["accident", "2. Accident"], ["suicide", "3. Suicide"], ["homicide", "4. Homicide"], ["pending-investigation", "5. Pending investigation"]] }),
    f("howInjuryOccurred", "How did the injury occur? (Form No. 4)", "longtext"),
    f("pregnancyAssociated", "If deceased was a female, was pregnancy associated with the death?", "enum", { options: YN_NA }),
    f("deliveryOccurred", "If yes, was there a delivery?", "enum", { options: YN_NA }),
    f("underlyingIcd10", "ICD-10 code of the underlying cause (not on Form No. 4 or 4A; for hospital coding)", "text", { max: 8 }),
    f("certifier", "Name and signature of the medical attendant certifying the cause of death (type full name)", "attest", { req: true }),
    f("verifiedOn", "Date of verification", "date", { req: true }),
    f("copyGivenToName", "Copy of this certificate given to the nearest relative: name (RBD Act s.10(2))", "text", { req: true }),
    f("copyGivenToRelation", "Copy given to: relationship to the deceased", "text", { req: true }),
    f("copyGivenOn", "Copy given on", "date", { req: true }),
  ],
  requiredWhen: (v, o) => [...(v.form === "4" ? ["mannerOfDeath"] : []), ...(v.form === "4A" ? ["attendedFrom", "attendedTo"] : []),
    ...(o && o.settings && o.settings.mccd.requireIcd10 ? ["underlyingIcd10"] : [])],
  rules: (v) => {
    const p = [];
    if (v.underlyingIcd10 && !ICD10.test(String(v.underlyingIcd10).toUpperCase())) p.push("underlyingIcd10: an ICD-10 code such as I21.9 or A15");
    if (v.form === "4A" && v.mannerOfDeath) p.push("mannerOfDeath: Form No. 4A has no manner of death");
    if (v.form === "4A" && v.howInjuryOccurred) p.push("howInjuryOccurred: Form No. 4A has no such field");
    if (v.form === "4" && v.mannerOfDeath && v.mannerOfDeath !== "natural" && !v.howInjuryOccurred) p.push("howInjuryOccurred: required when the manner of death is not natural");
    if (v.sex === "female" && !v.pregnancyAssociated) p.push("pregnancyAssociated: answer for a female death");
    if (v.pregnancyAssociated === "yes" && !v.deliveryOccurred) p.push("deliveryOccurred: answer when pregnancy was associated with the death");
    if (v.attendedFrom && v.attendedTo && v.attendedTo < v.attendedFrom) p.push("attendedTo: cannot be before attendedFrom");
    if (v.copyGivenOn && v.dateOfDeath && v.copyGivenOn < v.dateOfDeath) p.push("copyGivenOn: cannot be before the death");
    return p;
  },
  warnings: (v) => {
    const w = [];
    for (const k of ["causeIa", "causeIb", "causeIc"]) if (v[k] && (MODE_OF_DYING.test(v[k]) || /^\s*(heart|respiratory|cardiac) failure\s*$/i.test(v[k]))) w.push(`${k}: "${v[k]}" reads as a mode of dying, not a cause. Part I names the disease, injury or complication; old age, if contributory, goes in Part II.`);
    return w;
  },
  /* The underlying cause as the form defines it: the last line of Part I that was filled in. */
  derive: (v) => ({ underlyingCause: v.causeIc || v.causeIb || v.causeIa || null, ...(v.underlyingIcd10 ? { underlyingIcd10: String(v.underlyingIcd10).toUpperCase() } : {}) }),
  listColumns: ["dateOfDeath", "deceasedName", "causeIa", "mannerOfDeath", "copyGivenOn"],
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
 * 31st January 2014)", read from the state mirrors https://nhmmeghalaya.nic.in/programmes/pcpndt/form-f.pdf and
 * https://pcpndt.ap.gov.in/forms/FORM%20F.pdf (pndt.mohfw.gov.in and indiacode refused every fetch). The form's own
 * heading is cited rather than a G.S.R. number, which is not confirmed. Sections A (every procedure), B (non-invasive),
 * C (invasive), D (declarations).
 *
 * EVERY FIELD MATTERS. Act s.4(3) proviso: "any deficiency or inaccuracy found therein shall amount to contravention of
 * the provisions of section 5 or section 6 unless contrary is proved"; s.23 punishes it. So an entry is COMPLETE only
 * when Section A, the applicable Section B or C, and Section D are all filled (legal review B.4.1); an incomplete one is
 * a saved draft, counted on the register as a presumed contravention until completed. "None" is an answer where the
 * form asks about something that may not exist (living children, family history, complications, MTP indication).
 *
 * THE DECLARATION COMES FIRST. Rule 10(1A): the woman declares "before undergoing" the procedure, so a declaration
 * dated or timed at or after the start of the procedure is refused, not warned. The doctor's declaration is printed on
 * every obstetric ultrasound report (register-routes.js formFGate), which cannot be finalised without it.
 *
 * NOTHING ABOUT THE SEX OF A FOETUS IS STORED (s.5(2), s.6, r.18(i)). The form has no such field, this schema refuses any
 * unknown field, and every free-text field is refused when it names the sex of a foetus. A refused attempt leaves an
 * audit row (who, when, which field) without the refused text. The sex-linked disease exception is NOT implemented: that
 * is on the list for a practising lawyer. (Section A field 4 asks the ages of the woman's living sons and daughters: that
 * is the form's own question about children already born, and it is kept as the form asks.)
 *
 * MONTHLY REPORT: r.9(8), "by 5th day of the following month" to the Appropriate Authority (register-settings.js).
 * PRINTOUT: r.9(7), an electronic record is printed and "preserved after authentication by a person responsible for
 * such record" (the formfprint register below). RETENTION: r.9(6) and s.29, two years from the procedure, or until legal
 * proceedings end, whichever is later. */
const FOETAL_SEX = /\b(sex|gender)\s+(of\s+(the\s+)?)?(foetus|fetus|baby|child|unborn)\b|\b(foetal|fetal)\s+(sex|gender)\b|\b(male|female)\s+(foetus|fetus|baby|child)\b|\b(it'?s|is)\s+an?\s+(boy|girl)\b/i;
/* Words that make a text obstetric: the Form F gate's test for an imaging request (register-routes.js), and the context an
 * import must carry before FOETAL_SEX refuses it, so a paediatric report on "a female child" is still filed. */
const OBSTETRIC = /\b(obstetric|obstetrical|antenatal|ante-natal|pregnan\w*|foetal|fetal|foetus|fetus|nt[- ]scan|nuchal|anomaly scan|growth scan|dating scan|gestation\w*|biophysical profile|umbilical artery doppler)\b/i;
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
const PCPNDT_RETENTION = "Kept at least two years from the procedure, or until any legal proceeding ends, whichever is later (PC&PNDT Rules r.9(6), Act s.29). WardSynQ never deletes an entry.";
const FORMF_DECLARATION = "I have neither detected nor disclosed the sex of her foetus to anybody in any manner.";
/* The hospital's local calendar day of an ISO time (today when there is none). */
const localDay = (iso, offsetMinutes) => new Date((Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Date.now()) + (Number.isFinite(offsetMinutes) ? offsetMinutes : 330) * 60000).toISOString().slice(0, 10);
/* The State/UT portal fields a Form F needs on its procedure date: the submission date where the State/UT requires portal
 * submission, and the acknowledgement unless its configuration says none is required. */
function formFPortalFields(v, o) {
  const sub = o && o.legal ? formFSubmission(o.legal.stateUt, o.legal.cfg, /^\d{4}-\d{2}-\d{2}$/.test(String(v.procedureDate || "")) ? v.procedureDate : localDay(null, o.offsetMinutes)) : null;
  return !sub || !sub.requiresPortal ? [] : sub.requiresReference ? ["portalSubmittedOn", "portalReference"] : ["portalSubmittedOn"];
}
const FORMF = {
  title: "PCPNDT Form F", authority: "District Appropriate Authority (PC&PNDT Act)", citation: "PC&PNDT Act 1994 s.4(3); PC&PNDT Rules 1996 r.9(1), r.9(4), r.9(7), r.9(8), r.10(1A), Form F (heading: New amended on 4th February, 2014 notified on 31st January 2014)",
  patient: "required", dateField: "procedureDate", confidential: [], serial: "FORMF", retention: PCPNDT_RETENTION,
  fields: [
    f("firstReportedOn", "Rule 9(1). Date on which the woman first reported", "date", { req: true }),
    f("clinicName", "A1. Name and complete address of the Genetic Clinic / Ultrasound Clinic / Imaging Centre", "longtext", { req: true }),
    f("clinicRegistrationNo", "A2. Registration No. (under PC&PNDT Act, 1994)", "text", { req: true }),
    f("patientName", "A3. Patient's name", "text", { req: true }),
    f("patientAge", "A3. Age", "int", { req: true, min: 10, max: 70 }),
    f("livingSons", "A4(a). Living sons, with age of each (write None if none)", "text", { req: true }),
    f("livingDaughters", "A4(b). Living daughters, with age of each (write None if none)", "text", { req: true }),
    f("relativeName", "A5. Husband's / Wife's / Father's / Mother's name", "text", { req: true }),
    f("address", "A6. Full postal address of the patient with contact number", "longtext", { req: true }),
    f("referredBy", "A7(a). Referred by (full name and address of doctor(s) / genetic counselling centre)", "longtext"),
    f("referralSlipKept", "A7(a). The referral slip is preserved with Form F at (file number or document reference)", "text"),
    f("selfReferral", "A7(b). Self-referral by gynaecologist / radiologist / registered medical practitioner (name); this does not mean a client coming to a clinic and requesting for the test", "text"),
    f("lmpOrWeeks", "A8. Last menstrual period or weeks of pregnancy", "text", { req: true }),
    f("procedureKind", "Section B (non-invasive) or Section C (invasive)", "enum", { req: true, options: [["non-invasive", "Section B: non-invasive (ultrasound)"], ["invasive", "Section C: invasive"]] }),
    f("doctorName", "B9 / C17. Name of the doctor(s) performing the procedure", "text", { req: true }),
    f("indications", "B10. Indication(s) for the diagnostic procedure (ultrasound during pregnancy)", "multi", { options: FORMF_INDICATIONS }),
    f("procedureCarriedOut", "B11. Procedure carried out (non-invasive). Ultrasound is not indicated/advised/performed to determine the sex of fetus except for diagnosis of sex-linked diseases", "enum", { options: [["ultrasound", "(i) Ultrasound"], ["other", "(ii) Any other"]] }),
    f("otherProcedure", "B11(ii). Any other (specify)", "text"),
    f("declarationDate", "B12. Date on which the declaration of the pregnant woman was obtained", "date", { req: true }),
    f("declarationTime", "Time the declaration was obtained (HH:MM; before the procedure, rule 10(1A))", "time", { req: true }),
    f("procedureDate", "B13 / C25. Date on which the procedure was carried out", "date", { req: true }),
    f("procedureStartTime", "Time the procedure started (HH:MM)", "time", { req: true }),
    f("resultBrief", "B14 / C24. Result of the procedure (brief)", "longtext", { req: true }),
    f("resultConveyedTo", "B15 / C26. Result conveyed to", "text", { req: true }),
    f("resultConveyedOn", "B15 / C26. Result conveyed on", "date", { req: true }),
    f("mtpIndication", "B16 / C27. Any indication for MTP as per the abnormality detected (write None if none)", "text", { req: true }),
    f("familyHistory", "C18. History of genetic/medical disease in the family (specify; write None if none)", "longtext"),
    f("familyHistoryBasis", "C18. Basis of diagnosis", "enum", { options: [["clinical", "(a) Clinical"], ["bio-chemical", "(b) Bio-chemical"], ["cytogenetic", "(c) Cytogenetic"], ["other", "(d) Other (radiological, ultrasonography etc.)"]] }),
    f("invasiveIndications", "C19. Indication(s) for the diagnosis", "multi", { options: [["a-i", "A(i) Previous child with chromosomal disorders"], ["a-ii", "A(ii) Metabolic disorders"], ["a-iii", "A(iii) Congenital anomaly"], ["a-iv", "A(iv) Mental disability"], ["a-v", "A(v) Haemoglobinopathy"], ["a-vi", "A(vi) Sex linked disorders"], ["a-vii", "A(vii) Single gene disorder"], ["a-viii", "A(viii) Any other"], ["b", "B. Advanced maternal age (35 years)"], ["c", "C. Mother/father/sibling has genetic disease"], ["d", "D. Other"]] }),
    f("formGConsentDate", "C20. Date on which consent of the pregnant woman was obtained in Form G", "date"),
    f("formGLanguage", "C20. Language of the Form G consent (a language the woman understands, rule 10(1))", "text"),
    f("invasiveProcedures", "C21. Invasive procedures carried out", "multi", { options: [["amniocentesis", "(i) Amniocentesis"], ["chorionic-villi", "(ii) Chorionic Villi aspiration"], ["fetal-biopsy", "(iii) Foetal biopsy"], ["cordocentesis", "(iv) Cordocentesis"], ["other", "(v) Any other"]] }),
    f("complications", "C22. Any complication of the invasive procedure (specify; write None if none)", "longtext"),
    f("additionalTests", "C23. Additional tests recommended", "multi", { options: [["chromosomal", "(i) Chromosomal studies"], ["biochemical", "(ii) Biochemical studies"], ["molecular", "(iii) Molecular studies"], ["pre-implantation", "(iv) Pre-implantation gender diagnosis"], ["other", "(v) Any other"]] }),
    f("closingPlace", "Section B / C closing block: place", "text", { req: true }),
    f("sectionDoctorRegistrationNo", "Section B / C closing block: registration number of the doctor", "text", { req: true }),
    f("sealOnPrint", "Seal", "enum", { req: true, options: [["applied-on-print", "The doctor's seal is applied on the signed printout of this Form F"]] }),
    f("womanSignedBy", "D. The pregnant woman signs by", "enum", { req: true, options: [["signature", "Signature"], ["thumb-impression", "Thumb impression"]] }),
    f("womanDeclaration", "D. Declaration of the pregnant woman: I do not want to know the sex of my foetus (type her full name as attested)", "attest", { req: true }),
    f("identifiedByName", "D. Thumb impression identified by: name", "text"),
    f("identifiedByAge", "D. Identified by: age", "int", { min: 18, max: 120 }),
    f("identifiedBySex", "D. Identified by: sex", "enum", { options: [["female", "Female"], ["male", "Male"], ["other", "Other"]] }),
    f("identifiedByRelation", "D. Identified by: relation (if any)", "text"),
    f("identifiedByAddress", "D. Identified by: address", "longtext"),
    f("identifiedByContact", "D. Identified by: contact number", "text", { max: 20 }),
    f("identifiedByAttestation", "D. Signature of the person attesting the thumb impression (type full name)", "attest"),
    f("identifiedOn", "D. Date of the attestation", "date"),
    f("doctorDeclaration", `D. Declaration of the doctor: ${FORMF_DECLARATION} (name in capitals, type full name)`, "attest", { req: true }),
    f("doctorDeclarationRegistrationNo", "D. Registration number of the doctor making the declaration", "text", { req: true }),
    /* Online submission is a State/UT implementation requirement, not national (owner's legal guidance 2026-09-17 item 2):
     * required only where the hospital's State/UT configuration says ONLINE or PORTAL_AND_RECORD (legal-requirements.js). */
    f("portalSubmittedOn", "State/UT Form F portal: date submitted (where the State/UT requires portal submission)", "date"),
    f("portalReference", "State/UT Form F portal: acknowledgement or reference number", "text", { max: 80 }),
  ],
  requiredWhen: (v, o) => [
    ...(v.procedureKind === "invasive" ? ["familyHistory", "familyHistoryBasis", "invasiveIndications", "formGConsentDate", "formGLanguage", "invasiveProcedures", "complications"] : v.procedureKind === "non-invasive" ? ["indications", "procedureCarriedOut"] : []),
    ...(!v.referredBy && !v.selfReferral ? ["referredBy"] : []),
    ...(v.referredBy ? ["referralSlipKept"] : []),
    ...(v.womanSignedBy === "thumb-impression" ? ["identifiedByName", "identifiedByAge", "identifiedBySex", "identifiedByAddress", "identifiedByContact", "identifiedByAttestation", "identifiedOn"] : []),
    ...formFPortalFields(v, o),
  ],
  rules: (v) => {
    const p = [];
    for (const k of Object.keys(v)) if (typeof v[k] === "string" && FOETAL_SEX.test(v[k])) p.push(`${k}: must not state the sex of a foetus. Nothing about it is recorded.`);
    if (v.procedureCarriedOut === "other" && !v.otherProcedure) p.push("otherProcedure: specify the other procedure");
    if (v.resultConveyedOn && v.procedureDate && v.resultConveyedOn < v.procedureDate) p.push("resultConveyedOn: cannot be before the procedure date");
    if (v.declarationDate && v.procedureDate) {
      const decl = `${v.declarationDate}T${v.declarationTime || "00:00"}`, start = `${v.procedureDate}T${v.procedureStartTime || "23:59"}`;
      if (decl >= start) p.push("declarationDate: rule 10(1A): the woman's declaration is obtained before the procedure. A declaration at or after the start is refused.");
    }
    if (v.firstReportedOn && v.procedureDate && v.firstReportedOn > v.procedureDate) p.push("firstReportedOn: cannot be after the procedure");
    if (v.formGConsentDate && v.procedureDate && v.formGConsentDate > v.procedureDate) p.push("formGConsentDate: Form G consent is obtained before the invasive procedure");
    if (v.womanSignedBy === "signature" && (v.identifiedByName || v.identifiedByAttestation)) p.push("identifiedByName: the attester block is for a thumb impression only");
    return p;
  },
  refusalAudit: (problems, raw) => {
    const fields = [...new Set([...problems.filter((x) => /sex of a foetus/.test(x)).map((x) => x.split(":")[0]),
      ...Object.keys(raw && typeof raw === "object" ? raw : {}).filter((k) => /sex|gender/i.test(k) && !/^identifiedBySex$/.test(k))])];
    return fields.length ? { action: "pcpndt.disclosure_refused", fields } : null;
  },
  listColumns: ["procedureDate", "patientName", "procedureKind", "doctorName", "resultConveyedOn"],
};

/** The authenticated printout's fingerprint (r.9(7)): SHA-256 over the entry's id, version, serial and fields. The
 * print shows it, and recording the authentication checks it against the stored version, so a print of an older or
 * altered version cannot be recorded as authenticated. */
async function entryHash(entry) {
  const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => { o[k] = canon(x[k]); return o; }, {}) : x);
  const bytes = new TextEncoder().encode(JSON.stringify(canon({ id: entry.id, version: entry.version, serial: entry.serial || null, fields: entry.fields })));
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const FORMFPRINT = {
  title: "Form F authenticated printout (rule 9(7))", authority: "Kept at the centre with the signed Form F", citation: "PC&PNDT Rules 1996 r.9(7)",
  patient: "optional", dateField: "authenticatedOn", confidential: [], retention: PCPNDT_RETENTION,
  fields: [
    f("formFId", "Form F entry", "text", { req: true, max: 120 }),
    f("formFVersion", "Version printed", "int", { req: true, min: 1, max: 10000 }),
    f("printHash", "SHA-256 fingerprint shown on the printout", "text", { req: true, max: 64 }),
    f("authenticatedBy", "Authenticated by (the person responsible for the record, type full name)", "attest", { req: true }),
    f("authenticatorRegistrationNo", "Registration number of the person authenticating", "text", { req: true }),
    f("authenticatedOn", "Date of authentication", "date", { req: true }),
    f("storageLocation", "Where the signed printout is kept", "text", { req: true }),
  ],
  check: async (v, c) => {
    const rows = await c.repo.history(c.tenantId, PREFIX + "formf", v.formFId);
    const at = (rows || []).find((r) => r.version === v.formFVersion);
    if (!at) return ["formFId: no such Form F version in this register"];
    if (!at.complete) return ["formFVersion: only a complete Form F is printed and authenticated"];
    return (await entryHash(at)) === String(v.printHash).toLowerCase() ? [] : ["printHash: does not match that version of the Form F. Print it again and authenticate the new printout."];
  },
  listColumns: ["authenticatedOn", "formFId", "formFVersion", "storageLocation"],
};

/* A RETURN FILED WITH AN AUTHORITY. One record per return and period, so a second submission is a correction with a
 * reason: the PCPNDT monthly report (r.9(8)), MTP Form II (reg 4(5)), NDPS Form 3J (r.52T) and Form 3-I (r.52R(1)(d)).
 * The routes restrict which returns each register's custodian may record. */
const STATRETURN = {
  title: "Return filed with an authority", authority: "As named for each return", citation: "PC&PNDT Rules r.9(8); MTP Regulations 2003 reg 4(5); NDPS Rules r.52T, r.52R(1)(d)",
  patient: "none", dateField: "submittedOn", confidential: [], internal: true,
  fields: [
    f("returnKind", "Return", "enum", { req: true, options: [["formf-monthly", "PCPNDT monthly report of Form F (rule 9(8))"], ["mtp-form2", "MTP Form II monthly statement (regulation 4(5))"], ["ndps-3j", "NDPS Form 3J annual estimate (rule 52T)"], ["ndps-3i", "NDPS Form 3-I annual return (rule 52R(1)(d))"]] }),
    f("period", "Period (YYYY-MM for a monthly return, YYYY for an annual one)", "text", { req: true, max: 7 }),
    f("submittedOn", "Submitted on", "date", { req: true }),
    f("mode", "How it was submitted", "enum", { req: true, options: [["hand", "By hand"], ["email", "Email"], ["portal", "State portal"], ["post", "Post"]] }),
    f("recipient", "Submitted to", "text", { req: true }),
    f("acknowledgementRef", "Acknowledgement or reference number", "text", { max: 120 }),
    f("submittedBy", "Submitted by (type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const monthly = v.returnKind === "formf-monthly" || v.returnKind === "mtp-form2";
    if (v.period && !(monthly ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/).test(v.period)) return [`period: ${monthly ? "the month as YYYY-MM" : "the year as YYYY"}`];
    return [];
  },
  listColumns: ["returnKind", "period", "submittedOn", "mode", "acknowledgementRef"],
};

/* MTP. Medical Termination of Pregnancy Act 1971 as amended by the MTP (Amendment) Act 2021 (No. 8 of 2021, in force
 * 24 Sep 2021, gazette copy https://prsindia.org/files/bills_acts/acts_parliament/2021/Medical%20Termination%20of%20Pregnancy%20Amendment%20Act%202021.pdf):
 *   s.3(2)  up to 20 weeks one registered medical practitioner (RMP); over 20 and up to 24 weeks "not less than two"
 *           RMPs, only for the women rule 3B lists (Form E, r.4A(2)); s.3(2B) beyond 24 weeks on a Medical Board's
 *           diagnosis of substantial foetal abnormalities (Form D, r.3A), performed by two RMPs (r.4A(3)).
 *   s.3(4)(a) a woman under 18 or a mentally ill woman: consent in writing of her guardian (Form C, r.9).
 *   s.5     one RMP where termination is immediately necessary to save the woman's life: the tiers do not apply.
 *   s.5A    no RMP reveals her name and particulars except to a person authorised by law.
 * MTP Rules 2003 as amended by G.S.R. 730(E) of 12 Oct 2021: r.3A Medical Board opinion in Form D "within three days of
 * receiving the request", termination "within five days"; r.3B the categories below, verbatim; r.4A which RMP (rule 4
 * clause) may terminate at what gestation.
 * MTP Regulations 2003 (https://indiankanoon.org/doc/8267811/): reg 3 Form I, the termination certified "within three
 * hours"; reg 4 forms sealed in an envelope marked "secret" with the serial number and sent to the head of the hospital;
 * reg 4(5) Form II monthly; reg 5 the Admission Register (Form III), serial numbers restarting each year ("5/1972"),
 * kept five years; reg 6 not open to inspection except under the authority of law; reg 7 the woman's name appears in no
 * other case sheet, register or card, which use the serial number instead (register-routes.js mtpNameMask). */
const RULE_3B = [
  ["a", "(a) survivors of sexual assault or rape or incest"], ["b", "(b) minors"], ["c", "(c) change of marital status during the ongoing pregnancy (widowhood and divorce)"],
  ["d", "(d) women with physical disabilities [major disability as per criteria laid down under the Rights of Persons with Disabilities Act, 2016]"],
  ["e", "(e) mentally ill women including mental retardation"],
  ["f", "(f) the foetal malformation that has substantial risk of being incompatible with life or if the child is born it may suffer from such physical or mental abnormalities to be seriously handicapped"],
  ["g", "(g) women with pregnancy in humanitarian settings or disaster or emergency situations as may be declared by the Government"],
];
const RULE_3B_HINT = "Category (c) was read to include unmarried women: X v Principal Secretary, Health and Family Welfare Department, GNCTD (Supreme Court, 29 Sep 2022).";
/* The clause of MTP Rules 2003 rule 4 under which a practitioner is qualified, as the hospital's credential file says. */
const RULE_4 = [["a", "Rule 4(a)"], ["b", "Rule 4(b)"], ["c", "Rule 4(c)"], ["ca", "Rule 4(ca)"], ["d", "Rule 4(d)"]];
/** PURE. Rule 4A: which rule 4 clauses may terminate at this gestation by this method. */
function rule4AAllowed(weeks, method) {
  if (weeks > 12) return ["a", "b", "d"];
  if (method === "medical" && weeks <= 9) return ["a", "b", "c", "ca", "d"];
  return ["a", "b", "c", "d"];
}
const MTP_REASONS = [["danger-to-life", "(a) Danger to life of the pregnant woman"], ["physical-health", "(b) Grave injury to the physical health of the pregnant woman"],
  ["mental-health", "(c) Grave injury to the mental health of the pregnant woman"], ["rape", "(d) Pregnancy caused by rape"],
  ["foetal-abnormality", "(e) Substantial risk that if the child was born, it would suffer from such physical or mental abnormalities as to be seriously handicapped"],
  ["contraceptive-failure", "(f) Failure of any contraceptive device or method"]];
const MTP_RETENTION = "Admission Register and sealed forms: kept until five years after the end of the calendar year, or five years after the last entry, whichever is later (MTP Regulations 2003 reg 5; the start of the period is on the list for a lawyer). Nothing is destroyed automatically; WardSynQ never deletes an entry.";
const localInstant = (date, time, offsetMinutes) => Date.parse(`${date}T${time || "00:00"}:00Z`) - (Number.isFinite(offsetMinutes) ? offsetMinutes : 330) * 60000;
/** An MTP companion record (Form D or E) by entry id or register number, for this patient. */
async function companion(c, kind, ref) {
  const rows = await c.repo.latestByType(c.tenantId, PREFIX + kind, MAX_LIST, { newest: true });
  return (rows || []).find((r) => (r.id === ref || r.serial === ref) && r.patientId === c.patientId) || null;
}
const MTP = {
  title: "MTP Admission Register (Form III)", authority: "Chief Medical Officer (monthly statement in Form II)", citation: "MTP Act 1971 s.3, s.5, s.5A (as amended 2021); MTP Rules 2003 r.3A, r.3B, r.4A, r.9; MTP Regulations 2003 regs 3 to 7, Forms I, II, III",
  patient: "required", dateField: "admissionDate", confidential: ["patientName", "relation", "address", "guardianName"], serial: "MTP", retention: MTP_RETENTION,
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
    f("rule3BCategory", "Rule 3B. Category of woman eligible for termination over 20 and up to 24 weeks", "multi", { options: RULE_3B, hint: RULE_3B_HINT }),
    f("emergencySection5", "Section 5. Emergency", "enum", { options: [["yes", "Termination immediately necessary to save the life of the pregnant woman (the opinion tiers do not apply)"]] }),
    f("emergencyAttestation", "Section 5. I attest that termination was immediately necessary to save the life of the pregnant woman (type full name)", "attest"),
    f("opinionRmp1", "13. Registered medical practitioner forming the opinion (Form I)", "text", { req: true }),
    f("opinionRmp1Clause", "13. Rule 4 clause of that practitioner", "enum", { req: true, options: RULE_4 }),
    f("opinionRmp2", "13. Second registered medical practitioner forming the opinion (over 20 weeks)", "text"),
    f("opinionRmp2Clause", "13. Rule 4 clause of the second practitioner", "enum", { options: RULE_4 }),
    f("formERef", "Form E record of the two practitioners (over 20 and up to 24 weeks): its number", "text", { max: 120 }),
    f("formDRef", "Form D record of the Medical Board (over 24 weeks): its number", "text", { max: 120 }),
    f("method", "Method of termination", "enum", { options: [["medical", "Medical"], ["surgical", "Surgical"]] }),
    f("terminationDate", "10. Date of termination of pregnancy", "date"),
    f("terminationTime", "Time of termination (HH:MM)", "time"),
    f("terminatedBy", "14. Registered medical practitioner by whom pregnancy is terminated", "text"),
    f("terminatedByClause", "14. Rule 4 clause of that practitioner", "enum", { options: RULE_4 }),
    f("terminatedBy2", "14. Second registered medical practitioner terminating (over 24 weeks, rule 4A(3))", "text"),
    f("terminatedBy2Clause", "14. Rule 4 clause of the second practitioner", "enum", { options: RULE_4 }),
    f("terminationCertified", "Form I: termination certified by (type full name); the time of this attestation is the certification time, within three hours of termination (regulation 3)", "attest"),
    f("dischargeDate", "11. Date of discharge of patient", "date"),
    f("resultRemarks", "12. Result and remarks", "longtext"),
    f("contraception", "Form II 5. Termination with acceptance of contraception", "enum", { options: [["none", "None"], ["sterilisation", "(a) Sterilisation"], ["iud", "(b) I.U.D."]] }),
    f("mentallyIll", "The woman is a mentally ill woman (section 3(4)(a))", "enum", { req: true, options: YN }),
    f("consentBy", "Consent (Form C) given by", "enum", { req: true, options: [["woman", "The woman"], ["guardian", "Guardian (a woman under 18 or a mentally ill woman), in writing"]] }),
    f("guardianName", "Guardian's name and relationship (Form C)", "text"),
    f("consentDate", "Date of consent (Form C)", "date", { req: true }),
    f("opinionCertified", "Form I: opinion certified by the practitioner recording this entry (type full name)", "attest", { req: true }),
    f("envelopeSealedBy", "Regulation 4: opinion and consent sealed in an envelope marked secret with the serial number, sealed by (type full name)", "attest"),
    f("envelopeReceivedByHead", "Regulation 4: sealed envelope received in safe custody by the head of the hospital (type full name)", "attest"),
  ],
  requiredWhen: (v) => {
    const w = Number(v.gestationWeeks), emergency = v.emergencySection5 === "yes";
    return [
      ...(v.consentBy === "guardian" ? ["guardianName"] : []),
      ...(v.terminationDate ? ["terminationTime", "terminatedBy", "terminatedByClause", "method", "terminationCertified", "envelopeSealedBy", "envelopeReceivedByHead"] : []),
      ...(v.terminationDate && !emergency && w > 24 ? ["terminatedBy2", "terminatedBy2Clause"] : []),
      ...(emergency ? ["emergencyAttestation"] : []),
    ];
  },
  rules: (v) => {
    const p = [];
    const w = Number(v.gestationWeeks), emergency = v.emergencySection5 === "yes";
    /* THE ACT'S LIMITS ARE A REFUSAL, NOT A WARNING: an entry recording a termination the Act does not permit is not
     * something this register writes silently. Section 5 is the one path around the tiers, and it is attested. */
    if (v.terminationDate && !emergency) {
      if (w > 20 && !v.opinionRmp2) p.push("opinionRmp2: above 20 weeks the Act requires the opinion of not less than two registered medical practitioners (s.3(2)(b))");
      if (w > 20 && w <= 24 && !(v.rule3BCategory || []).length) p.push("rule3BCategory: over 20 and up to 24 weeks, name the rule 3B category of the woman");
      if (w > 20 && w <= 24 && !v.formERef) p.push("formERef: over 20 and up to 24 weeks, the two practitioners' opinion in Form E (rule 4A(2))");
      if (w > 24 && !v.formDRef) p.push("formDRef: above 24 weeks a termination needs the Medical Board's opinion in Form D (s.3(2B), rule 3A)");
    }
    if (emergency && !v.emergencyAttestation) p.push("emergencyAttestation: attest that termination was immediately necessary to save her life (s.5)");
    const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
    if (same(v.opinionRmp1, v.opinionRmp2)) p.push("opinionRmp2: the second opinion must be a different practitioner");
    if (same(v.terminatedBy, v.terminatedBy2)) p.push("terminatedBy2: the second practitioner must be a different person");
    if (v.opinionRmp2 && !v.opinionRmp2Clause) p.push("opinionRmp2Clause: the rule 4 clause of the second practitioner");
    for (const [who, clause] of [["terminatedBy", "terminatedByClause"], ["terminatedBy2", "terminatedBy2Clause"]]) {
      if (v[clause] && v.method && w && !rule4AAllowed(w, v.method).includes(v[clause])) p.push(`${clause}: rule 4A: a practitioner under rule 4(${v[clause]}) may not perform a ${v.method} termination at ${w} weeks`);
    }
    if ((Number(v.age) < 18 || v.mentallyIll === "yes") && v.consentBy === "woman") p.push("consentBy: s.3(4)(a): for a woman under 18 or a mentally ill woman, the guardian consents in writing");
    if (v.terminationDate && v.admissionDate && v.terminationDate < v.admissionDate) p.push("terminationDate: cannot be before admission");
    if (v.dischargeDate && v.terminationDate && v.dischargeDate < v.terminationDate) p.push("dischargeDate: cannot be before termination");
    if (v.consentDate && v.terminationDate && v.consentDate > v.terminationDate) p.push("consentDate: consent is given before the termination");
    return p;
  },
  check: async (v, c) => {
    const p = [];
    if (v.formERef) { const e = await companion(c, "mtpforme", v.formERef); if (!e) p.push("formERef: no Form E with that number for this woman"); else if (!e.complete) p.push("formERef: that Form E is not complete"); }
    if (v.formDRef) {
      const d = await companion(c, "mtpboard", v.formDRef);
      if (!d) p.push("formDRef: no Form D with that number for this woman");
      else if (v.terminationDate && !(d.complete && d.fields.opinion === "allowed" && d.fields.physicallyFit === "yes")) p.push("formDRef: a termination above 24 weeks needs a complete Form D with the opinion allowed and the woman physically fit");
    }
    return p;
  },
  /* A MINOR IS A POCSO REPORTING CASE (legal review C.4.6, D.4.3). Saving an entry for a woman under 18 opens a task on
   * the medico-legal side, in the same append as the entry, so the intimation is kept by the register that tracks police
   * intimations and their clocks rather than as a field nobody chases. The task names no other register (reg 5 to 7);
   * this register finds it by its id. */
  alsoWrite: async (entry, c) => {
    if (!(Number(entry.fields.age) < 18)) return [];
    const id = pocsoTaskIdFor(entry.id);
    if (await c.repo.latest(c.tenantId, PREFIX + "pocsotask", id)) return [];
    return [draftEntry("pocsotask", { id, patientId: entry.patientId, encounterId: entry.encounterId, fields: { reason: "minor-pregnancy", intimation: "pending" }, serverFields: { raisedAt: c.now } }, c)];
  },
  /* Regulation 3: certified within three hours of the termination. Late is FLAGGED, never refused (a late certificate
   * is still a certificate); the certification time is the server's stamp, so it cannot be back-dated. */
  derive: (v, o) => {
    if (!v.terminationDate || !v.terminationTime || !v.terminationCertified || !v.terminationCertified.at) return { formICertifiedLate: null };
    const gap = Date.parse(v.terminationCertified.at) - localInstant(v.terminationDate, v.terminationTime, o && o.offsetMinutes);
    return { formICertifiedLate: gap > 3 * 3600000 };
  },
  listColumns: ["admissionDate", "age", "gestationWeeks", "reasons", "terminationDate"],
};

const MTPBOARD = {
  title: "MTP Medical Board opinion (Form D)", authority: "Medical Board constituted by the State Government (MTP Act s.3(2C), (2D))",
  citation: "MTP Act 1971 s.3(2B) to (2D) (as amended 2021); MTP Rules 2003 r.3A, Form D", retention: MTP_RETENTION,
  patient: "required", dateField: "requestDate", confidential: ["patientName"], serial: "MB",
  fields: [
    f("requestDate", "Date the request reached the Board (the three-day and five-day limits run from it, rule 3A)", "date", { req: true }),
    f("requestTime", "Time the request reached the Board (HH:MM)", "time", { req: true }),
    f("patientName", "1. Name of the woman", "text", { req: true }),
    f("age", "2. Age", "int", { req: true, min: 8, max: 60 }),
    f("caseNumber", "3. Registration or case number", "text", { req: true }),
    f("reports", "4. Reports, with the Board's opinion on each", "longtext", { req: true }),
    f("additionalInvestigations", "5. Additional investigations and findings", "longtext"),
    f("opinion", "6. Opinion of the Board", "enum", { req: true, options: [["allowed", "Termination allowed"], ["denied", "Termination denied"]] }),
    f("jurisdiction", "6. Jurisdiction for the decision", "longtext", { req: true }),
    f("physicallyFit", "7. Physically fit for termination", "enum", { req: true, options: YN }),
    f("members", "Members of the Board (at least a gynaecologist, a paediatrician and a radiologist or sonologist, s.3(2D))", "list", { req: true, row: [
      { key: "role", label: "Member", req: true, type: "enum", options: [["gynaecologist", "Gynaecologist"], ["paediatrician", "Paediatrician"], ["radiologist-sonologist", "Radiologist or sonologist"], ["state-member", "Member notified by the State"]] },
      { key: "name", label: "Name", req: true, max: 120 }, { key: "registrationNo", label: "Registration number", max: 60 },
    ] }),
    f("opinionDate", "Date of the Board's opinion", "date", { req: true }),
    f("opinionTime", "Time of the Board's opinion (HH:MM)", "time", { req: true }),
    f("recordedFor", "Recorded for the Board, members' signatures on the printed Form D (type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const p = [];
    const roles = new Set((v.members || []).map((m) => m.role));
    if ((v.members || []).length && !["gynaecologist", "paediatrician", "radiologist-sonologist"].every((r) => roles.has(r))) p.push("members: the Board includes a gynaecologist, a paediatrician and a radiologist or sonologist (s.3(2D))");
    if (v.opinionDate && v.requestDate && `${v.opinionDate}T${v.opinionTime || "23:59"}` < `${v.requestDate}T${v.requestTime || "00:00"}`) p.push("opinionDate: cannot be before the request");
    return p;
  },
  /* Rule 3A: opinion within three days of the request; termination within five days. Late is flagged, not refused. */
  derive: (v, o) => {
    if (!v.requestDate) return {};
    const req = localInstant(v.requestDate, v.requestTime, o && o.offsetMinutes);
    const out = { opinionDueBy: new Date(req + 3 * 86400000).toISOString(), terminationDueBy: new Date(req + 5 * 86400000).toISOString() };
    if (v.opinionDate) out.opinionLate = localInstant(v.opinionDate, v.opinionTime, o && o.offsetMinutes) > req + 3 * 86400000;
    return out;
  },
  listColumns: ["requestDate", "age", "opinion", "physicallyFit", "opinionDate"],
};

const MTPFORME = {
  title: "MTP opinion of two registered medical practitioners, over 20 and up to 24 weeks (Form E)", authority: "Kept with the MTP Admission Register",
  citation: "MTP Act 1971 s.3(2)(b) (as amended 2021); MTP Rules 2003 r.3B, r.4A(2), Form E", retention: MTP_RETENTION,
  patient: "required", dateField: "signedOn", confidential: ["patientName", "patientAddress"], serial: "E",
  fields: [
    f("rmp1Name", "Name of the first registered medical practitioner", "text", { req: true }),
    f("rmp1Qualification", "Qualification", "text", { req: true }),
    f("rmp1Address", "Address", "longtext", { req: true }),
    f("rmp1Clause", "Rule 4 clause", "enum", { req: true, options: RULE_4 }),
    f("rmp2Name", "Name of the second registered medical practitioner", "text", { req: true }),
    f("rmp2Qualification", "Qualification", "text", { req: true }),
    f("rmp2Address", "Address", "longtext", { req: true }),
    f("rmp2Clause", "Rule 4 clause", "enum", { req: true, options: RULE_4 }),
    f("patientName", "Name of the pregnant woman", "text", { req: true }),
    f("patientAddress", "Address of the pregnant woman", "longtext", { req: true }),
    f("gestationWeeks", "Duration of pregnancy (completed weeks)", "int", { req: true, min: 20, max: 24 }),
    f("circumstances", "Specify the circumstance(s) from (a) to (g)", "multi", { req: true, options: RULE_3B, hint: RULE_3B_HINT }),
    f("admissionSerial", "Intimation of termination: serial number in the Admission Register", "text"),
    f("place", "Place", "text", { req: true }),
    f("signedOn", "Date", "date", { req: true }),
    f("rmp1Attestation", "Signature of the first practitioner (type full name)", "attest", { req: true }),
    f("rmp2Attestation", "Signature of the second practitioner (type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const p = [];
    if (v.rmp1Name && v.rmp2Name && v.rmp1Name.toLowerCase() === v.rmp2Name.toLowerCase()) p.push("rmp2Name: two different practitioners (s.3(2)(b))");
    for (const k of ["rmp1Clause", "rmp2Clause"]) if (v[k] && !["a", "b", "d"].includes(v[k])) p.push(`${k}: over 20 weeks, rule 4A: a practitioner under rule 4(a), (b) or (d)`);
    return p;
  },
  listColumns: ["signedOn", "gestationWeeks", "circumstances", "admissionSerial"],
};

/** PURE. Form II, the monthly statement, counted from the month's entries that record a termination. Columns exactly as
 * the 2003 form; a termination over 20 weeks is not a column of that form and goes in a separately labelled annex when
 * the hospital keeps one (registers.mtp.formIIOver20Annex, default on). */
function mtpFormII(entries, hospital, state, settings) {
  const done = (entries || []).filter((e) => e.fields && e.fields.terminationDate);
  const w = (e) => Number(e.fields.gestationWeeks);
  const form = done.filter((e) => w(e) <= 20), over = done.filter((e) => w(e) > 20);
  const n = (list, pred) => list.filter(pred).length;
  const has = (e, r) => (e.fields.reasons || []).includes(r);
  const statement = {
    "1. Name of the State": state || "", "2. Name of the Hospital/approved place": hospital || "",
    "3(a). Duration of pregnancy: up to 12 weeks": n(form, (e) => w(e) <= 12),
    "3(b). Duration of pregnancy: between 12-20 weeks": n(form, (e) => w(e) > 12),
    "4(a). Hindu": n(form, (e) => e.fields.religion === "hindu"), "4(b). Muslim": n(form, (e) => e.fields.religion === "muslim"),
    "4(c). Christian": n(form, (e) => e.fields.religion === "christian"), "4(d). Others": n(form, (e) => e.fields.religion === "others"), "4(e). Total": form.length,
    "5(a). Sterilisation": n(form, (e) => e.fields.contraception === "sterilisation"), "5(b). I.U.D.": n(form, (e) => e.fields.contraception === "iud"),
    ...Object.fromEntries(MTP_REASONS.map(([k, label]) => [`6${label.slice(0, 3)} ${label.slice(4)}`, n(form, (e) => has(e, k))])),
  };
  const keepAnnex = !settings || settings.mtp.formIIOver20Annex !== false;
  return {
    statement,
    ...(keepAnnex ? { annex: { title: "Annex: terminations over 20 weeks (MTP Amendment Act 2021). Not a column of the 2003 Form II.",
      "Over 20 and up to 24 weeks": n(over, (e) => w(e) <= 24), "Over 24 weeks (Medical Board, Form D)": n(over, (e) => w(e) > 24),
      "Under section 5 (immediately necessary to save life)": n(done, (e) => e.fields.emergencySection5 === "yes"), Total: over.length } }
      : { annexOmitted: over.length ? `${over.length} termination(s) over 20 weeks are not in this statement: the 2003 Form II has no column for them and this hospital keeps no annex.` : null }),
  };
}

/* MEDICO-LEGAL CASES. THESE FIELDS ARE THE HOSPITAL'S RECORD, NOT A STATUTORY FORM, and say so on the screen: no national
 * statutory MLC register form exists. Each category carries the statutory duty it triggers (legal review D, 2026-09-17,
 * statute texts read on Indian Kanoon; BNSS, BNS and BSA in force 1 Jul 2024):
 *   BNSS s.33 (https://indiankanoon.org/doc/145634418/) listed offences: police informed "forthwith".
 *   BNSS s.397 (https://indiankanoon.org/doc/26361776/): every hospital "shall immediately, provide the first-aid or
 *     medical treatment, free of cost" to victims of BNS ss.64-68, 70, 71, 124(1) and POCSO ss.4, 6, 8, 10, "and shall
 *     immediately inform the police"; BNS s.200 punishes the person in charge. Billing is locked for these cases.
 *   BNSS s.184 (rape victim examination): consent first (s.184(7)); the report records the exact start and end times,
 *     material taken for DNA profiling, general mental condition, reasons for each conclusion; s.184(6) forwarded to
 *     the investigating officer "within a period of seven days".
 *   POCSO Act s.19(1), s.27; POCSO Rules 2020 r.6 (https://indiankanoon.org/doc/90952193/): no requisition demanded
 *     (r.6(3)); a girl examined by a woman doctor (s.27(2)); a parent or trusted person present (s.27(3)); "The
 *     registered medical practitioner shall submit the report on the condition of the child within 24 hrs to the SJPU
 *     or Local Police" (r.6(5)).
 *   BNSS ss.194, 196: inquest and Magistrate inquiry (death of a woman within seven years of marriage; custody).
 *   MV Act s.134; CMVR r.168 (G.S.R. 594(E), 29 Sep 2020): a Good Samaritan "shall not be forced to disclose any
 *     personal information ... including for the purpose of the Medico-Legal Case Form", so who brought the patient
 *     is optional. Savelife Foundation v Union of India (SC, 30 Mar 2016).
 *   Treatment never waits: Pt. Parmanand Katara v Union of India, AIR 1989 SC 2039; Clinical Establishments Act s.12(2).
 * The MoHFW 2014 guidelines and State of Jharkhand v Shailendra Kumar Rai (SC 2022): no "two-finger" test, so there is no
 * field for one; a per vaginum examination is recorded only with its clinical reason. */
const MLC_CATEGORIES = [
  ["sexual-assault-adult", "Sexual assault of an adult (BNS ss.64 to 71)"], ["acid-attack", "Acid attack (BNS s.124(1))"],
  ["pocso", "Sexual offence against a child, or its apprehension (POCSO Act)"], ["rta", "Road traffic accident"],
  ["death-in-custody", "Death, disappearance or alleged rape in police or court-authorised custody (BNSS s.196(2))"],
  ["death-woman-married-under-7-years", "Suicide or suspicious death of a woman within seven years of marriage (BNSS s.194(3))"],
  ["bnss33-offence", "Other offence listed in BNSS s.33 (for example murder, attempt to murder, kidnapping for ransom)"],
  ["assault", "Assault with hurt"], ["burns", "Burns"], ["poisoning", "Poisoning"], ["suspected-suicide", "Suspected suicide attempt"],
  ["fall-industrial", "Fall or industrial injury"], ["animal-bite", "Animal bite"], ["brought-dead", "Brought dead"],
  ["unknown-unconscious", "Unknown or unconscious patient"], ["other", "Other (specify in the history)"],
];
const FREE_TREATMENT = ["sexual-assault-adult", "acid-attack", "pocso"];
const STATUTORY_INTIMATION = ["sexual-assault-adult", "acid-attack", "pocso", "death-in-custody", "death-woman-married-under-7-years", "bnss33-offence"];
const EXAMINATION = ["sexual-assault-adult", "pocso"];
const DEATH_INQUEST = ["death-in-custody", "death-woman-married-under-7-years"];
/* BNS s.72 and POCSO Act s.23: the identity of a victim of a sexual offence is not disclosed. These cases open only to the
 * register's keepers, the treating doctors and the people the hospital names (register-routes.js mlcReadable). */
const RESTRICTED_MLC = ["sexual-assault-adult", "pocso"];
const EXAM_FIELDS = ["examStartAt", "examEndAt", "dnaMaterial", "mentalCondition", "conclusionReasons", "pvExamination", "pvReason"];
const MLC_RETENTION = "Medico-legal registers and case sheets: ten years, or until any court case is disposed of (DGHS OM of 28 Oct 2014, guidance). WardSynQ never deletes an entry.";
const MLC = {
  title: "Medico-legal case register", authority: "Police station of jurisdiction (intimation); the hospital keeps the register",
  citation: "Hospital record (no national statutory form). BNSS 2023 ss.33, 184, 194, 196, 397; POCSO Act ss.19, 27 and Rules 2020 r.6; CMVR r.168; Parmanand Katara v Union of India, AIR 1989 SC 2039",
  patient: "required", dateField: "arrivalAt", confidential: ["historyAsGiven", "injuries", "identificationMark1", "identificationMark2", "broughtBy", "dnaMaterial", "conclusionReasons", "mentalCondition", "pvReason", "personPresent"],
  serial: "MLC", statutoryForm: false, retention: MLC_RETENTION,
  notes: ["Treatment is never gated by this record: it may be completed after treatment starts (Parmanand Katara; Clinical Establishments Act s.12(2)).",
    "Police intimation is required for every category by default; the hospital may narrow it to its state medico-legal manual in Settings, except where a statute requires it (BNSS ss.33, 397; POCSO)."],
  fields: [
    f("category", "Category", "enum", { req: true, options: MLC_CATEGORIES }),
    f("status", "Status", "enum", { req: true, options: [["open", "Open"], ["closed", "Closed"], ["withdrawn", "Marked in error (withdrawn)"]] }),
    f("arrivalAt", "Date and time of arrival", "datetime", { req: true }),
    f("goodSamaritan", "Brought in by a Good Samaritan (CMVR r.168)", "enum", { options: YN }),
    f("broughtBy", "Brought by (name, relation or police, contact); optional, and a Good Samaritan need not give any personal information (r.168(4))", "text"),
    f("identificationMark1", "Identification mark 1", "text"),
    f("identificationMark2", "Identification mark 2", "text"),
    f("historyAsGiven", "History and alleged cause, as given, and by whom", "longtext", { req: true }),
    f("requisitionFrom", "Requisition from (police officer or court), if any; none is demanded before treating a child (POCSO Rules r.6(3))", "text"),
    f("requisitionDate", "Date of the requisition", "date"),
    f("crimeNumber", "Crime or FIR number", "text"),
    f("policeStation", "Police station intimated", "text"),
    f("policeOfficer", "Officer informed (name, rank, number)", "text"),
    f("intimationAt", "Date and time of police intimation", "datetime"),
    f("intimationMode", "How the police were informed", "enum", { options: [["telephone", "Telephone"], ["written", "Written intimation"], ["in-person", "In person"]] }),
    f("intimationNumber", "Intimation or daily diary (GD/DD) number given by the police", "text"),
    f("freeTreatment", "BNSS s.397", "enum", { options: [["confirmed", "First aid and medical treatment are given free of cost; charges are refused for this case"]] }),
    f("personSex", "Sex of the person examined", "enum", { options: [["female", "Female"], ["male", "Male"], ["transgender", "Transgender person"]] }),
    f("consentBy", "Consent to examination given by (BNSS s.184(1), (7))", "enum", { options: [["self", "The person examined"], ["guardian", "Guardian or person competent to consent on their behalf"], ["refused", "Consent refused: no examination"]] }),
    f("consentAt", "Date and time of consent", "datetime"),
    f("consentName", "Name and capacity of the person who consented", "text"),
    f("survivorAssent", "A person under 18: their own assent recorded as well", "enum", { options: YN }),
    f("personPresent", "Parent or person the child trusts present at the examination; failing whom a woman nominated by the head of the institution (POCSO s.27(3), (4))", "text"),
    f("examiningDoctorName", "Examining doctor", "text"),
    f("examiningDoctorSex", "Sex of the examining doctor (a girl is examined by a woman doctor, POCSO s.27(2))", "enum", { options: [["female", "Female"], ["male", "Male"], ["other", "Other"]] }),
    f("examStartAt", "Examination commenced at (BNSS s.184(5): the exact time)", "datetime"),
    f("examEndAt", "Examination completed at", "datetime"),
    f("dnaMaterial", "Material taken from the person for DNA profiling", "longtext"),
    f("mentalCondition", "General mental condition", "text"),
    f("pvExamination", "Per vaginum examination", "enum", { options: [["not-done", "Not done"], ["clinically-indicated", "Done only for a clinically indicated gynaecological reason"]] }),
    f("pvReason", "The clinical reason for the per vaginum examination", "longtext"),
    f("conclusionReasons", "Reasons for each conclusion arrived at", "longtext"),
    f("survivorPoliceChoice", "The survivor's choice about the police (treatment continues either way)", "enum", { options: [["engaged", "Wishes to engage with the police"], ["declined", "Does not wish to engage with the police"]] }),
    f("reportForwardedToIoAt", "Examination report forwarded to the investigating officer at (BNSS s.184(6): within seven days)", "datetime"),
    f("pocsoReportAt", "Report on the condition of the child sent to the SJPU or local police at (POCSO Rules r.6(5): within 24 hours)", "datetime"),
    f("pocsoReportTo", "SJPU or police station the report went to", "text"),
    f("injuries", "Injuries", "list", { row: [
      { key: "site", label: "Site", req: true, max: 200 },
      { key: "kind", label: "Kind", req: true, type: "enum", options: [["abrasion", "Abrasion"], ["contusion", "Contusion"], ["laceration", "Laceration"], ["incised", "Incised wound"], ["stab", "Stab wound"], ["firearm", "Firearm injury"], ["fracture", "Fracture"], ["burn", "Burn"], ["other", "Other"]] },
      { key: "size", label: "Size", max: 100 }, { key: "age", label: "Age of injury", max: 100 }, { key: "description", label: "Description (colour, weapon suggested)", max: 500 },
      { key: "nature", label: "Nature", type: "enum", options: [["simple", "Simple"], ["grievous", "Grievous"], ["reserved", "Opinion reserved"]] },
    ] }),
    f("consistentWithHistory", "Opinion: consistent with the alleged history", "enum", { options: [["could-be", "Could be as alleged"], ["could-not-be", "Could not be as alleged"], ["reserved", "Opinion reserved"]] }),
    f("rtaSchemeRef", "Road accident: cashless treatment scheme reference (eDAR or TMS), if any", "text"),
    f("inquestPapersReceived", "Inquest or Magistrate inquiry papers received (BNSS ss.194, 196)", "enum", { options: YN }),
    /* The mortuary releases a body of a custody death, or of a woman within seven years of marriage, only once these
     * are recorded (mortuary.js releaseMissing reads them). */
    f("inquestPapersReference", "Inquest or Magistrate inquiry papers: reference and date received", "text"),
    /* Kerala DHS formats (legal review D.1, D.4.1), when the hospital keeps its register in that state format. */
    f("examinationRequested", "Examination requested (Medico-legal Register, Kerala format)", "text"),
    f("certificateIssuedTo", "Wound certificate issued to (Accident Register cum Wound Certificate, Kerala format)", "text"),
    f("certificateRequestNo", "Wound certificate: request number", "text"),
    f("certificateIssuedOn", "Wound certificate: date issued", "date"),
    f("samplesPreserved", "Samples or articles preserved and handed over (to whom, when)", "longtext"),
    f("medleaprReference", "MedLEaPR reference", "text", { max: 80 }),
    f("medleaprFrozenOn", "MedLEaPR report frozen on", "date"),
    f("outcome", "Outcome", "enum", { options: [["admitted", "Admitted"], ["discharged", "Discharged"], ["referred", "Referred"], ["absconded", "Left against advice or absconded"], ["died", "Died"]] }),
    f("doctor", "Doctor recording this medico-legal case (type full name)", "attest", { req: true }),
  ],
  requiredWhen: (v, o) => {
    const s = (o && o.settings && o.settings.mlc) || { intimationCategories: [] };
    const c = v.category;
    const out = [];
    if (STATUTORY_INTIMATION.includes(c) || (s.intimationCategories || []).includes(c)) out.push("policeStation", "intimationAt", "intimationMode");
    if (FREE_TREATMENT.includes(c)) out.push("freeTreatment");
    if (EXAMINATION.includes(c)) out.push("personSex", "consentBy");
    if (EXAMINATION.includes(c) && v.consentBy && v.consentBy !== "refused") out.push("consentAt", "consentName", "examiningDoctorName", "examiningDoctorSex", "examStartAt", "examEndAt", "conclusionReasons", "pvExamination", "reportForwardedToIoAt");
    if (c === "sexual-assault-adult") out.push("survivorPoliceChoice");
    if (c === "pocso") out.push("pocsoReportAt", "pocsoReportTo", "personPresent");
    if (DEATH_INQUEST.includes(c)) out.push("inquestPapersReceived");
    if (v.inquestPapersReceived === "yes") out.push("inquestPapersReference");
    /* MedLEaPR only where the hospital's State/UT requires it for a medico-legal report on the arrival date (owner's legal
     * guidance 2026-09-17 item 3, legal-requirements.js); otherwise the State-prescribed workflow. */
    if (o && o.legal && medleaprRequired(o.legal.stateUt, o.legal.cfg, "MLR", localDay(v.arrivalAt, o.offsetMinutes)).required) out.push("medleaprReference", "medleaprFrozenOn");
    if (s.stateFormat === "kerala") out.push("examinationRequested", "identificationMark1", "identificationMark2");
    if (v.certificateIssuedTo) out.push("certificateRequestNo", "certificateIssuedOn");
    return out;
  },
  rules: (v) => {
    const p = [];
    if (v.intimationAt && v.arrivalAt && Date.parse(v.intimationAt) + 3600000 < Date.parse(v.arrivalAt)) p.push("intimationAt: more than an hour before the arrival time; check the date");
    /* BNSS s.184(7): no examination without consent. The examination fields stay locked until consent is recorded. */
    if (EXAMINATION.includes(v.category) && (!v.consentBy || v.consentBy === "refused") && EXAM_FIELDS.some((k) => v[k] !== undefined)) p.push("consentBy: BNSS s.184(7): no examination is recorded without consent");
    if (v.pvExamination === "clinically-indicated" && !v.pvReason) p.push("pvReason: a per vaginum examination is recorded only with its clinical reason");
    if (v.category === "pocso" && v.personSex === "female" && v.examiningDoctorSex && v.examiningDoctorSex !== "female") p.push("examiningDoctorSex: POCSO s.27(2): a girl child is examined by a woman doctor");
    if (v.examStartAt && v.examEndAt && Date.parse(v.examEndAt) < Date.parse(v.examStartAt)) p.push("examEndAt: cannot be before the start");
    if (v.consentAt && v.examStartAt && Date.parse(v.examStartAt) < Date.parse(v.consentAt)) p.push("examStartAt: the examination starts after consent (BNSS s.184(7))");
    if (v.reportForwardedToIoAt && v.examEndAt && Date.parse(v.reportForwardedToIoAt) < Date.parse(v.examEndAt)) p.push("reportForwardedToIoAt: cannot be before the examination ended");
    if (v.freeTreatment && !FREE_TREATMENT.includes(v.category)) p.push("freeTreatment: only for a BNSS s.397 case");
    return p;
  },
  listColumns: ["arrivalAt", "category", "policeStation", "intimationAt", "status"],
};

/** PURE. The statutory clocks on an open medico-legal case, for the clock dashboard. now: epoch ms. */
function mlcClocks(entry, now, settings) {
  const v = (entry && entry.fields) || {};
  if (v.status !== "open") return [];
  const out = [];
  const s = (settings && settings.mlc) || { intimationCategories: [] };
  const arrival = Date.parse(v.arrivalAt);
  if ((STATUTORY_INTIMATION.includes(v.category) || (s.intimationCategories || []).includes(v.category)) && !v.intimationAt) out.push({ kind: "police-intimation", state: "pending", rule: v.category === "bnss33-offence" ? "BNSS s.33: forthwith" : FREE_TREATMENT.includes(v.category) ? "BNSS s.397: immediately" : "Police intimation" });
  if (v.category === "pocso" && !v.pocsoReportAt && Number.isFinite(arrival)) { const due = arrival + 24 * 3600000; out.push({ kind: "pocso-report", dueBy: new Date(due).toISOString(), state: now > due ? "overdue" : "due", rule: "POCSO Rules 2020 r.6(5): within 24 hours" }); }
  if (EXAMINATION.includes(v.category) && v.consentBy && v.consentBy !== "refused" && !v.reportForwardedToIoAt) {
    const from = Date.parse(v.examEndAt) || arrival;
    if (Number.isFinite(from)) { const due = from + 7 * 86400000; out.push({ kind: "io-report", dueBy: new Date(due).toISOString(), state: now > due ? "overdue" : "due", rule: "BNSS s.184(6): within seven days" }); }
  }
  if (DEATH_INQUEST.includes(v.category) && v.inquestPapersReceived !== "yes") out.push({ kind: "inquest-papers", state: "pending", rule: "BNSS ss.194, 196: body not released without the police and inquest papers" });
  return out;
}

/* DYING DECLARATION. No statute prescribes a form (BSA 2023 s.26(a); Laxman v State of Maharashtra, (2002) 6 SCC 710,
 * Constitution Bench: "no specified statutory form", the doctor's certification "is essentially a rule of caution"). The
 * fields follow the Kerala DHS proforma for a declaration recorded by a medical practitioner
 * (https://dhs.kerala.gov.in/wp-content/uploads/2020/04/annexure1.pdf). It is never edited after it is saved: a later
 * statement is an addendum, its own entry naming this one. */
const DYINGDECL = {
  title: "Dying declaration", authority: "Kept with the medico-legal case; produced to the police or court on requisition",
  citation: "Hospital record (no statutory form): BSA 2023 s.26(a); Laxman v State of Maharashtra, (2002) 6 SCC 710; Kerala DHS proforma", statutoryForm: false,
  patient: "required", dateField: "startDate", confidential: ["statementVerbatim", "questionsAndAnswers", "witness1Name", "witness2Name"], serial: "DD", immutable: true, retention: MLC_RETENTION,
  fields: [
    f("mlcNumber", "Medico-legal case number", "text"),
    f("addendumTo", "An addendum to the earlier dying declaration numbered", "text"),
    f("fitnessBeforeAt", "Certificate of fitness before the statement: date and time", "datetime", { req: true }),
    f("fitnessBefore", "I certify the declarant is conscious, oriented and fit to make a statement (doctor, type full name)", "attest", { req: true }),
    f("magistrateCalled", "Magistrate called", "enum", { req: true, options: [["yes", "Yes"], ["no", "No"], ["unavailable", "Called, not available in time"]] }),
    f("magistrateName", "Magistrate's name (if present)", "text"),
    f("witness1Name", "Witness 1: name and address", "text", { req: true }),
    f("witness1", "Witness 1: signature (type full name)", "attest", { req: true }),
    f("witness2Name", "Witness 2: name and address", "text", { req: true }),
    f("witness2", "Witness 2: signature (type full name)", "attest", { req: true }),
    f("startDate", "Date the statement began", "date", { req: true }),
    f("startTime", "Time the statement began (HH:MM)", "time", { req: true }),
    f("language", "Language the declarant spoke", "text", { req: true }),
    f("statementVerbatim", "The declaration, word by word, in the declarant's own words", "longtext", { req: true }),
    f("questionsAndAnswers", "Questions asked and answers given, word by word", "longtext"),
    f("translatedBy", "Translated by (if the record is not in the language spoken)", "text"),
    f("readOver", "Read over and explained to the declarant, who admitted it correct", "enum", { req: true, options: [["yes", "Yes"]] }),
    f("declarantMark", "The declarant signed by", "enum", { req: true, options: [["signature", "Signature"], ["thumb-impression", "Thumb impression"], ["unable", "Unable to sign or mark (reason in the next field)"]] }),
    f("declarantMarkRef", "Scanned signature or thumb impression (document reference), or why none", "text", { req: true }),
    f("endTime", "Time the statement ended (HH:MM)", "time", { req: true }),
    f("fitnessAfterAt", "Certificate of fitness after the statement: date and time", "datetime", { req: true }),
    f("fitnessAfter", "I certify the declarant remained fit throughout the statement (doctor, type full name)", "attest", { req: true }),
  ],
  rules: (v) => {
    const p = [];
    if (v.magistrateCalled === "yes" && !v.magistrateName) p.push("magistrateName: name the Magistrate who recorded or attended");
    if (v.witness1Name && v.witness2Name && v.witness1Name.toLowerCase() === v.witness2Name.toLowerCase()) p.push("witness2Name: two different witnesses");
    if (v.startTime && v.endTime && v.endTime < v.startTime) p.push("endTime: before the start (a statement over midnight: record the addendum)");
    if (v.fitnessBeforeAt && v.fitnessAfterAt && Date.parse(v.fitnessAfterAt) < Date.parse(v.fitnessBeforeAt)) p.push("fitnessAfterAt: cannot be before the first certificate");
    return p;
  },
  listColumns: ["startDate", "mlcNumber", "magistrateCalled", "language"],
};

/* POCSO INTIMATION TASK. POCSO Act s.19(1): anyone with knowledge or apprehension of an offence "shall provide such
 * information to (a) the Special Juvenile Police Unit; or (b) the local police"; s.21 punishes failure. A pregnancy of a
 * person under 18 is such a case (legal review C.1 "Link to POCSO", C.4.6). The MTP register opens this task (MTP.alsoWrite)
 * on the medico-legal side, where police intimations and their clocks are kept. It names no other register. The 24-hour
 * clock follows POCSO Rules 2020 r.6(5) (the report on the child's condition), the nearest time the law sets; the
 * identity-withheld path is X v Principal Secretary (SC, 29 Sep 2022) as summarised, on the list for a lawyer. */
const pocsoTaskIdFor = (sourceEntryId) => `reg-pocsotask-${slug(String(sourceEntryId).replace(/^reg-[a-z0-9]+-/, ""))}`;
const POCSOTASK = {
  title: "POCSO intimation task", authority: "Special Juvenile Police Unit or local police (POCSO Act s.19(1))",
  citation: "POCSO Act 2012 s.19(1), s.21; POCSO Rules 2020 r.6(5); X v Principal Secretary, Health and Family Welfare Department, GNCTD (SC, 29 Sep 2022), as summarised",
  patient: "required", dateField: "raisedAt", confidential: ["identityWithheldBasis", "policeReference"], statutoryForm: false, retention: MLC_RETENTION,
  notes: ["Opened by WardSynQ when another register records the care of a person under 18 that must be reported under POCSO Act s.19(1). Close it by recording the intimation."],
  fields: [
    f("reason", "Why the intimation is owed", "enum", { req: true, options: [["minor-pregnancy", "Pregnancy of a person under 18 (POCSO Act s.19(1))"]] }),
    f("raisedAt", "Opened at", "datetime", { server: true }),
    f("intimation", "Intimation", "enum", { req: true, options: [["pending", "Not yet intimated"], ["intimated", "Intimated to the SJPU or local police"], ["identity-withheld", "Intimated, the minor's identity withheld on the request of the minor and guardian"]] }),
    f("intimatedAt", "Intimated at", "datetime", { req: true }),
    f("intimatedTo", "SJPU or police station informed", "text"),
    f("policeReference", "Police or daily diary reference", "text"),
    f("identityWithheldBasis", "Basis for withholding the minor's identity (on the list for a lawyer)", "longtext"),
    f("mlcNumber", "Medico-legal case number, if one is opened", "text"),
    f("recordedBy", "Intimation recorded by (type full name)", "attest"),
  ],
  requiredWhen: (v) => (v.intimation && v.intimation !== "pending" ? ["intimatedTo", "recordedBy", ...(v.intimation === "identity-withheld" ? ["identityWithheldBasis"] : [])] : []),
  rules: (v) => (v.intimation === "pending" && v.intimatedAt ? ["intimation: an intimation time is recorded, so say how the police were informed"] : []),
  listColumns: ["raisedAt", "reason", "intimation", "intimatedAt", "intimatedTo"],
};

/** PURE. The open POCSO intimation task's clock. now: epoch ms. */
function pocsoTaskClock(entry, now) {
  const v = (entry && entry.fields) || {};
  if (!entry || entry.complete || !v.raisedAt) return null;
  const due = Date.parse(v.raisedAt) + 24 * 3600000;
  return { kind: "pocso-intimation", dueBy: new Date(due).toISOString(), state: now > due ? "overdue" : "due", rule: "POCSO Act s.19(1); POCSO Rules 2020 r.6(5): within 24 hours" };
}

const REGISTERS = {
  birth: BIRTH, death: DEATH, stillbirth: STILLBIRTH, mccd: MCCD, ndpscount: NDPSCOUNT, formf: FORMF, formfprint: FORMFPRINT, statreturn: STATRETURN,
  mtp: MTP, mtpboard: MTPBOARD, mtpforme: MTPFORME, mlc: MLC, dyingdecl: DYINGDECL, pocsotask: POCSOTASK,
};

/** Registers added by their own modules (Form F, MLC, MTP, notifications) join the table here. */
function defineRegister(kind, def) {
  if (!/^[a-z][a-z0-9]*$/.test(kind) || REGISTERS[kind]) throw new Error(`register ${kind} is already defined or badly named`);
  REGISTERS[kind] = def;
}

const typeOf = (kind) => PREFIX + kind;

/* ------------------------------------------------------------------------------------------------ validation, PURE */

const LIMIT = { text: 300, longtext: 4000 };
const ADDRESS_PARTS = ["houseNo", "locality", "ward", "townVillage", "subDistrict", "district", "state", "pin"];
/* Which parts of an address complete it. Model RBD (Amendment) Rules 2024 r.5(6): State/UT, District, Sub-district,
 * Town/Village, Ward number (if available), Locality, House number and PIN. The 1999 forms had a free address. */
const ADDRESS_REQUIRED = { "model-2024": ["houseNo", "locality", "townVillage", "subDistrict", "district", "state", "pin"], "model-1999": ["townVillage", "district", "state"] };
/* r.5(4) of the 2024 model rules: names "shall not contain any abbreviations"; a single letter with a full stop is one. */
const ABBREVIATION = /(^|\s)[A-Za-z]\.(\s|$)/;
/* An Aadhaar number is never kept in a birth or death register (legal review E.4.4): twelve digits, spaced or not. */
const AADHAAR_LIKE = /(^|\D)\d{4}\s?\d{4}\s?\d{4}(\D|$)/;
const blankObj = (o, parts) => !o || typeof o !== "object" || parts.every((p) => str(o[p]) === "");

/**
 * PURE. The submitted fields against the register's form. Returns { value, missing, problems, warnings }.
 * Unknown keys are PROBLEMS, never dropped: a field this form does not have is either a mistake or content that must
 * not be stored (Form F refuses anything about the sex of a foetus this way), and silently discarding it would report
 * a save that did not keep what was sent.
 * opts: { settings (register-settings.js registerSettings), offsetMinutes, legal: { stateUt, cfg (wardsynq.legal) } }: what a
 * hospital-editable setting or the hospital's State/UT configuration changes.
 */
function validateFields(kind, input, prior, opts) {
  const def = REGISTERS[kind];
  const o = { settings: registerSettings(null), offsetMinutes: 330, legal: { stateUt: null, cfg: null }, ...(opts || {}) };
  const version = o.settings.rbd.formVersion;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const byKey = new Map(def.fields.map((x) => [x.key, x]));
  const value = {}, missing = [], problems = [];
  for (const k of Object.keys(src)) if (!byKey.has(k)) problems.push(`${k}: not a field of ${def.title}`);
  for (const fd of def.fields) {
    if (fd.server) continue;
    const raw = src[fd.key];
    if (fd.type === "name" || fd.type === "address") {
      /* Structured values: an object of parts. A blank one is missing when required; a partial address is kept and
       * its missing parts listed, so the entry is incomplete rather than refused. */
      const parts = fd.type === "name" ? ["first", "middle", "last"] : (fd.parts || ADDRESS_PARTS);
      if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) { problems.push(`${fd.key}: give the ${fd.type === "name" ? "first, middle and last name" : "address parts"} separately`); continue; }
      if (raw && Object.keys(raw).some((k) => !parts.includes(k))) { problems.push(`${fd.key}: only ${parts.join(", ")}`); continue; }
      if (blankObj(raw, parts)) { if (fd.req) missing.push(fd.key); continue; }
      const out = {};
      for (const p of parts) if (str(raw[p])) out[p] = str(raw[p]).slice(0, 120);
      if (fd.type === "name") {
        if (!out.first) problems.push(`${fd.key}: the first name is mandatory`);
        if (parts.some((p) => out[p] && ABBREVIATION.test(out[p]))) problems.push(`${fd.key}: write the full name, without abbreviations (RBD Rules 2024 r.5(4))`);
        if (!parts.some((p) => (out[p] || "").replace(/[^A-Za-zऀ-෿]/g, "").length >= 2)) problems.push(`${fd.key}: at least two characters in one part of the name`);
      } else {
        if (out.pin && !/^\d{6}$/.test(out.pin)) problems.push(`${fd.key}: PIN code is six digits`);
        const need = (fd.parts ? (version === "model-1999" ? ["townVillage"] : fd.parts.filter((p) => p !== "ward")) : ADDRESS_REQUIRED[version]);
        for (const p of need) if (!out[p]) missing.push(`${fd.key}.${p}`);
      }
      value[fd.key] = out;
      continue;
    }
    const blank = raw === undefined || raw === null || str(raw) === "";
    if (blank) { if (fd.req) missing.push(fd.key); continue; }
    const t = fd.type;
    if (def.rbd && (t === "text" || t === "longtext") && !/Mobile$/.test(fd.key) && AADHAAR_LIKE.test(str(raw))) {
      problems.push(`${fd.key}: looks like an Aadhaar number. Aadhaar numbers are not stored here; they are keyed into the CRS portal at submission.`);
      continue;
    }
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
  if (def.requiredWhen) for (const k of def.requiredWhen(value, o)) if (value[k] === undefined && !missing.includes(k)) missing.push(k);
  if (def.rules) problems.push(...def.rules(value, o));
  return { value, missing, problems, warnings: def.warnings ? def.warnings(value, o) : [] };
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
  /* A record the law treats as fixed once made (a dying declaration) is never corrected: an addendum is a new entry. */
  if (correcting && def.immutable) return { ok: false, status: 409, error: "immutable_entry", message: "This record cannot be changed after it is saved. Record an addendum as a new entry that names it.", written: 0 };
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

  const opts = { settings: registerSettings(ctx.wsqCfg), offsetMinutes: ctx.clock && Number.isFinite(ctx.clock.offsetMinutes) ? ctx.clock.offsetMinutes : 330,
    legal: { stateUt: ctx.stateUt || null, cfg: (ctx.wsqCfg && ctx.wsqCfg.legal) || null } };
  const v = validateFields(kind, ctx.fields, prior && prior.fields, opts);
  /* Checks that read other records (an MTP termination names its Form E; a Form F print names a version). */
  if (!v.problems.length && def.check) {
    try { v.problems.push(...(await def.check(v.value, { repo, tenantId, prior, patientId: correcting ? prior.patientId : str(ctx.patientId), settings: opts.settings, links: ctx.links || {} }))); }
    catch { return { ...READ_FAILED, message: "A record this entry depends on could not be read, so nothing was saved.", written: 0 }; }
  }
  if (v.problems.length) {
    /* A refusal the law wants remembered (PCPNDT: an attempt to record the sex of a foetus) leaves an audit row naming
     * who and which fields, never the refused text. If that row cannot be written the refusal still stands. */
    const flagged = def.refusalAudit ? def.refusalAudit(v.problems, ctx.fields) : null;
    if (flagged) { try { await repo.auditOnly(tenantId, audit(flagged.action, str(who.id), { register: kind, fields: flagged.fields }, await patientHash(ctx, correcting ? prior.patientId : str(ctx.patientId)))); } catch { /* the refusal is the protection */ } }
    return { ok: false, status: 422, error: "invalid_fields", problems: v.problems, message: "Some fields are not valid. Nothing was saved.", written: 0 };
  }
  const now = new Date().toISOString();
  const fields = { ...v.value };
  for (const fd of def.fields) {
    if (fd.type === "attest" && fields[fd.key]) {
      const keep = fields[fd.key].prior;
      fields[fd.key] = keep || { name: fields[fd.key].name, by: str(who.id), at: now };
    }
  }
  /* A server field (worked out by the server when the entry was made) survives a correction that does not recompute it. */
  if (correcting) for (const fd of def.fields) if (fd.server && prior.fields && prior.fields[fd.key] !== undefined) fields[fd.key] = prior.fields[fd.key];
  for (const [k, val] of Object.entries(ctx.serverFields || {})) if (def.fields.some((x) => x.key === k && x.server)) fields[k] = val;
  Object.assign(fields, def.derive ? def.derive(fields, opts) : {});
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
    ...(def.rbd ? { formVersion: opts.settings.rbd.formVersion } : {}),
    recordedBy: prior ? prior.recordedBy : str(who.id), recordedAt: prior ? prior.recordedAt : now,
    ...(correcting ? { correction: { reason, by: str(who.id), at: now, of: prior.version } } : {}),
    writtenBy: { id: str(who.id), role: str(who.role) || null, at: now },
  };
  const hash = await patientHash(ctx, patientId);
  const scope = { register: kind, id, version: entry.version, complete: entry.complete, correction: correcting };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const records = [];
    /* Records this entry opens in another register (MTP.alsoWrite: a POCSO intimation task), in the same append, so the
     * entry is never saved without them. */
    let also = [];
    if (def.alsoWrite) {
      try { also = await def.alsoWrite(entry, { repo, tenantId, now, who, settings: opts.settings, offsetMinutes: opts.offsetMinutes, legal: opts.legal }); }
      catch { return { ...READ_FAILED, message: "A record this entry opens could not be prepared, so nothing was saved.", written: 0 }; }
      scope.also = also.map((x) => ({ register: x.kind, id: x.id }));
    }
    if (def.serial && !entry.serial) {
      const year = (eventDate || now).slice(0, 4);
      let s;
      try { s = await nextSerial(repo, tenantId, kind, year); } catch { return { ...READ_FAILED, written: 0 }; }
      entry.serial = def.serialFormat ? def.serialFormat(s.n, year) : `${def.serial}/${year}/${String(s.n).padStart(5, "0")}`;
      records.push(s.record);
    }
    records.push(entry, ...also);
    try {
      await repo.append(tenantId, records, { audit: audit(correcting ? "register.correct" : "register.write", str(who.id), { ...scope, serial: entry.serial || null }, hash), idempotencyKey: attempt === 0 && ctx.idempotencyKey ? String(ctx.idempotencyKey) : null });
      return { ok: true, written: 1 + also.length, entry, ...(also.length ? { opened: also } : {}), ...(v.warnings.length ? { warnings: v.warnings } : {}) };
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

/** A first version of an entry another entry opens (def.alsoWrite), validated like any save. Throws when invalid, which
 * refuses the save that asked for it. c: { now, who, settings, offsetMinutes } */
function draftEntry(kind, input, c) {
  const def = REGISTERS[kind];
  const v = validateFields(kind, input.fields, null, { settings: c.settings, offsetMinutes: c.offsetMinutes, legal: c.legal });
  if (v.problems.length) throw new Error(`${kind}: ${v.problems.join("; ")}`);
  const fields = { ...v.value };
  for (const [k, val] of Object.entries(input.serverFields || {})) if (def.fields.some((x) => x.key === k && x.server)) fields[k] = val;
  const eventDate = str(fields[def.dateField]).slice(0, 10);
  return { resourceType: typeOf(kind), id: input.id, version: 1, kind, serial: null, patientId: input.patientId || null, encounterId: input.encounterId || null, links: {},
    period: (eventDate || c.now).slice(0, 7), eventDate: eventDate || null, fields, complete: v.missing.length === 0, missing: v.missing,
    recordedBy: str(c.who.id), recordedAt: c.now, writtenBy: { id: str(c.who.id), role: str(c.who.role) || null, at: c.now } };
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
/** PURE. A field's value as the form would print it: a coded option by its label, a name or address by its parts. */
function printValue(fd, v) {
  if (v == null || v === "") return "";
  if (fd.type === "enum") { const o = (fd.options || []).find((x) => x[0] === v); return o ? o[1] : v; }
  if (fd.type === "multi" && Array.isArray(v)) return v.map((k) => { const o = (fd.options || []).find((x) => x[0] === k); return o ? o[1] : k; }).join("; ");
  if (fd.type === "name" && typeof v === "object") return ["first", "middle", "last"].map((p) => v[p]).filter(Boolean).join(" ");
  if (fd.type === "address" && typeof v === "object") return (fd.parts || ADDRESS_PARTS).map((p) => v[p]).filter(Boolean).join(", ");
  return v;
}

function csvFor(kind, entries, opts) {
  /* Confidential fields leave only when a caller explicitly includes them; a hospital-only field (fd.internal, such as
   * the clinical note on a still birth) never leaves in an export. */
  const def = REGISTERS[kind], hide = new Set((opts && opts.includeConfidential) ? [] : def.confidential || []);
  const cols = def.fields.filter((x) => !hide.has(x.key) && !x.internal);
  const head = ["Register number", "Entry id", "Version", "Complete", ...cols.map((x) => x.label), "Recorded by", "Recorded at", "Last correction reason"];
  const lines = [head.map(csvCell).join(",")];
  for (const e of entries || []) {
    lines.push([e.serial || "", e.id, e.version, e.complete ? "yes" : "no", ...cols.map((x) => printValue(x, (e.fields || {})[x.key])), e.recordedBy, e.recordedAt, e.correction ? e.correction.reason : ""].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** PURE. The medico-legal register in the Kerala DHS Medico-legal Register's columns (legal review D.1, "Formats"):
 * ML number, date, name, age, sex, address, crime number and police station, requisition from and date, examination
 * requested, medical officer, signature (left blank for the signed print). people: patientId -> { name, age, sex, address }. */
function keralaMlcCsv(entries, people) {
  const head = ["ML number", "Date", "Name", "Age", "Sex", "Address", "Crime number and police station", "Requisition from and date", "Examination requested", "Medical officer", "Signature"];
  const lines = [head.map(csvCell).join(",")];
  for (const e of entries || []) {
    const v = e.fields || {}, p = (people && people.get(e.patientId)) || {};
    lines.push([e.serial || e.id, str(v.arrivalAt).slice(0, 10), p.name || "", p.age == null ? "" : p.age, p.sex || "", p.address || "",
      [v.crimeNumber, v.policeStation].filter(Boolean).join(", "), [v.requisitionFrom, v.requisitionDate].filter(Boolean).join(", "), v.examinationRequested || "",
      (v.doctor && v.doctor.name) || "", ""].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** The schema a screen renders a form from: labels, types, options. No entry data. */
function schemaOf(kind) {
  const def = REGISTERS[kind];
  if (!def) return null;
  return { kind, title: def.title, authority: def.authority, citation: def.citation, patient: def.patient, dateField: def.dateField, serial: !!def.serial,
    confidential: def.confidential || [], statutoryForm: def.statutoryForm !== false, internal: !!def.internal, fields: def.fields, definitions: def.definitions || null, listColumns: def.listColumns || [], submission: def.submission || "manual",
    retention: def.retention || null, immutable: !!def.immutable, freeOfCharge: !!def.freeOfCharge, notes: def.notes || [] };
}

export {
  PREFIX, SERIAL_TYPE, MAX_LIST, REGISTERS, ICD10, f, YN, YN_NA, SEX_FORM, defineRegister, typeOf,
  FOETAL_SEX, mtpFormII, validateFields, saveEntry, listEntries, entryHistory, csvFor, schemaOf, listView, printValue,
  EDUCATION, OCCUPATION, FOETAL_DEATH_CAUSES, MODE_OF_DYING, FORMF_DECLARATION, entryHash, RULE_3B, rule4AAllowed, MLC_CATEGORIES, FREE_TREATMENT, mlcClocks,
  RESTRICTED_MLC, DEATH_INQUEST, pocsoTaskIdFor, pocsoTaskClock, draftEntry, keralaMlcCsv, csvCell, OBSTETRIC,
};
