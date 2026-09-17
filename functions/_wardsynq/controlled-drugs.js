/* functions/_wardsynq/controlled-drugs.js - the NDPS / controlled-drug register, read from the stock ledger.
 *
 * THE LAW, AS READ (not paraphrased from memory). NDPS Rules 1985, Chapter VA/VB inserted by G.S.R. 359(E) of
 * 5 May 2015 (consolidated text, https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1073_00014_00014_1563259383370&type=rule&filename=the_narcotic_drugs_and_psychotropic_substances_rules,_1985_date_14.11.1985.pdf):
 *   r.52R(1)  a recognised medical institution (RMI) shall register the patients to whom essential narcotic drugs are
 *             dispensed; keep a separate record per patient in Form No. 3E; keep all receipts and disbursements in
 *             Form No. 3H (both preserved at least two years from the last entry); and file the calendar-year return
 *             in Form No. 3-I to the Controller of Drugs by 31 March of the following year.
 *   Form 3H   per drug, per day: opening stock; quantity received, received from, consignment note / bill / invoice
 *             number; quantity dispensed with the patient registration number (Form 3E) and quantity to each;
 *             closing stock; signature of the overall in-charge. "Entries shall be completed for each day before the
 *             close of the day."
 *   Form 3E   registration number; date; name; complete postal address with contact number; brief description of
 *             illness; whether registered with any other RMP or RMI; drugs dispensed (date, drug, quantity, remarks).
 *   Form 3-I  per drug: annual estimate, revised estimate, opening stock, procured, disbursed to patients, closing.
 *   r.52V(1)  expired stock "shall be destroyed by the recognised medical institution in the presence of an officer
 *             nominated by the Controller of Drugs".
 * Drugs and Cosmetics Rules 1945 r.65(3)(h) (G.S.R. 588(E), 30 Aug 2013; CDSCO consolidated text
 * https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf):
 * a Schedule H1 supply is recorded with the prescriber's name and address, the patient's name, the drug and the
 * quantity, kept three years.
 *
 * WHAT THE LAW DOES NOT SAY, AND THIS FILE DOES ANYWAY, MARKED AS HOSPITAL POLICY. No rule read requires a second
 * staff witness for a dispense, a dose or ward wastage, and none requires a physical count each shift (only the daily
 * book). WardSynQ requires the witness and offers the count because they are how a hospital finds a diversion, and
 * says on the screen that they are hospital policy, not the statute. The legal review of 2026-09-17 read Chapter VB in
 * full and confirms it (F.1); the hospital may switch the witness off (registers.ndps.requireWitness).
 *
 * ADDED FROM THE LEGAL REVIEW (F.4), cited per rule from the Indian Kanoon mirror https://indiankanoon.org/doc/184182041/
 * and the Forms 3C to 3J reproduction https://palliumindia.org/wp-content/uploads/2020/05/Forms-and-Official-Documents-Relevant-to-ENDs.pdf:
 *   Form 3E  a registration per patient, and the dispensing table's "Signature / Thumb impression of the patient"
 *            column: a typed attestation with who and when stamped by the server, or who signed for the patient and
 *            why (how this is met for in-patient administration is on the list for a lawyer). No Aadhaar is collected.
 *   Form 3J  the annual estimate "by the 30th November of the preceding calendar year", revised "by the 31st August"
 *            (r.52T); Form 3-I the calendar-year return by 31 March (r.52R(1)(d)), with a justification where
 *            disbursement is more than 10 per cent above the estimate.
 *   r.52V(1) expired stock destroyed "in the presence of an officer nominated by the Controller of Drugs": a controlled
 *            wastage of expired stock is refused without the nominee's name, designation and nominating order
 *            (stock.js recordMovement).
 *   r.52-O   recognition (Form 3G) valid up to three years: once it has expired, receipts and dispensing of a
 *            controlled drug are refused unless a renewal application reference is recorded (register-settings.js).
 *
 * ONE LEDGER. Nothing here stores a stock level or a second copy of a movement. Receipts, wastage and adjustments are
 * the StockMovement records stock.js writes; issues and returns are MedicationDispense (pharmacy-dispense.js); doses
 * given are MedicationAdministration (the eMAR). This file reads those and lays them out as the statutory book. The
 * only thing it adds to the store is a COUNT (registers.js, "ndpscount"), which checks the shelf against the book and
 * changes nothing in it.
 *
 * WHICH DRUGS. The hospital's drug master: the controlled-drug list on the Admin clinical settings screen
 * (wardsynq.controlledDrugs), and any formulary entry marked controlled: true. Matched on the whole normalised name or
 * code, never a substring - "morphine" must not catch a different product, the same rule formulary.js keeps.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { norm } from "./formulary.js";
import { quantityOf, levelsFrom } from "./stock.js";
import { f, YN, REGISTERS, defineRegister, saveEntry, listEntries, typeOf } from "./registers.js";
import { registerSettings, rmiStatus, ndpsAnnualClocks, form3hClosureLate } from "./register-settings.js";
import { hospitalToday } from "./expected-discharge.js";

const str = (v) => (v == null ? "" : String(v).trim());
const READ_CAP = 1000;
const POLICY_NOTE = "The second-person witness and the shift count are this hospital's policy, not a rule: no NDPS rule requires them. The NDPS Rules require the daily register (Form 3H), the per-patient record (Form 3E), the annual estimate (Form 3J) and the annual return (Form 3-I); expired stock is destroyed in the presence of an officer nominated by the Controller of Drugs (rule 52V).";
const NDPS_RETENTION = "Kept at least two years from the last entry (NDPS Rules r.52R, r.52X), and with the clinical record, since Form 3E entries are part of the patient's chart. WardSynQ never deletes an entry.";

/* ------------------------------------------------------------------------------------------------ Form 3E, 3J, 3-I */

const FORM3E = {
  title: "NDPS Form 3E: patient registration", authority: "Kept by the recognised medical institution; open to inspection (r.52Y)", citation: "NDPS Rules 1985 r.52R(1)(a), (b), Form No. 3E",
  patient: "required", dateField: "registrationDate", confidential: [], serial: "3E", retention: NDPS_RETENTION,
  fields: [
    f("registrationDate", "Date of registration", "date", { req: true }),
    f("patientName", "Name of the patient", "text", { req: true }),
    f("address", "Complete postal address", "longtext", { req: true }),
    f("contactNumber", "Contact number", "text", { req: true, max: 20 }),
    f("illness", "Brief description of illness", "longtext", { req: true }),
    f("otherRegistration", "Whether registered with any other registered medical practitioner or recognised medical institution", "enum", { req: true, options: YN }),
    f("otherRegistrationDetails", "If yes, with whom", "text"),
  ],
  requiredWhen: (v) => (v.otherRegistration === "yes" ? ["otherRegistrationDetails"] : []),
  listColumns: ["registrationDate", "patientName", "otherRegistration"],
};

const FORM3ESIGN = {
  title: "NDPS Form 3E: patient's signature for a supply", authority: "Kept with the patient's Form 3E", citation: "NDPS Rules 1985 Form No. 3E (dispensing table, signature / thumb impression column)",
  patient: "required", dateField: "date", confidential: ["representativeReason"], retention: NDPS_RETENTION,
  fields: [
    f("form3eId", "Form 3E registration", "text", { req: true, max: 160 }),
    f("dispenseId", "Supply (dispense) record", "text", { req: true, max: 160 }),
    f("date", "Date", "date", { req: true }),
    f("drug", "Drug", "text", { req: true }),
    f("quantity", "Quantity", "text", { req: true, max: 60 }),
    f("signedBy", "Signed by", "enum", { req: true, options: [["patient", "The patient"], ["representative", "Another person, for the patient"]] }),
    f("signature", "Signature / thumb impression of the patient: the person signing types their full name", "attest", { req: true }),
    f("representativeName", "Who signed for the patient (name and relationship)", "text"),
    f("representativeReason", "Why the patient could not sign", "text"),
    f("remarks", "Remarks", "text"),
  ],
  requiredWhen: (v) => (v.signedBy === "representative" ? ["representativeName", "representativeReason"] : []),
  check: async (v, c) => {
    const reg = await c.repo.latest(c.tenantId, "_wardsynq_register_form3e", v.form3eId);
    if (!reg || reg.patientId !== c.patientId) return ["form3eId: no Form 3E registration for this patient"];
    const d = await c.repo.latest(c.tenantId, "MedicationDispense", v.dispenseId);
    if (!d || d.patientId !== c.patientId) return ["dispenseId: no such supply to this patient"];
    return [];
  },
  listColumns: ["date", "drug", "quantity", "signedBy"],
};

const FORM3J = {
  title: "NDPS Form 3J: annual estimate", authority: "Controller of Drugs", citation: "NDPS Rules 1985 r.52T, r.52U, Form No. 3J",
  patient: "none", dateField: "preparedOn", confidential: [], retention: NDPS_RETENTION, internal: true,
  fields: [
    f("year", "Calendar year the estimate is for", "int", { req: true, min: 2015, max: 2100 }),
    f("estimateKind", "Estimate", "enum", { req: true, options: [["estimate", "Annual estimate (by 30 November of the preceding year)"], ["revised", "Revised estimate (by 31 August)"]] }),
    f("drug", "Essential narcotic drug", "text", { req: true }),
    f("unit", "Unit", "text", { req: true, max: 40 }),
    f("quantity", "Quantity estimated for the year", "number", { req: true, min: 0, max: 100000000 }),
    f("preparedOn", "Prepared on", "date", { req: true }),
    f("preparedBy", "Prepared by the over-all in-charge (type full name)", "attest", { req: true }),
  ],
  listColumns: ["year", "estimateKind", "drug", "unit", "quantity"],
};

const FORM3I = {
  title: "NDPS Form 3-I: annual return", authority: "Controller of Drugs, by 31 March of the following year", citation: "NDPS Rules 1985 r.52R(1)(d), Form No. 3-I",
  patient: "none", dateField: "preparedOn", confidential: [], retention: NDPS_RETENTION, internal: true,
  fields: [
    f("year", "Calendar year", "int", { req: true, min: 2015, max: 2100 }),
    f("drug", "Essential narcotic drug", "text", { req: true }),
    f("unit", "Unit", "text", { req: true, max: 40 }),
    f("estimate", "Annual estimate", "number", { server: true }),
    f("revisedEstimate", "Revised estimate", "number", { server: true }),
    f("openingStock", "Opening stock", "number", { server: true }),
    f("procured", "Quantity procured", "number", { server: true }),
    f("disbursed", "Quantity disbursed to patients", "number", { server: true }),
    f("closingStock", "Closing stock", "number", { server: true }),
    f("justification", "Justification (required where disbursement is more than 10 per cent above the estimate)", "longtext"),
    f("preparedOn", "Prepared on", "date", { req: true }),
    f("preparedBy", "Prepared by the over-all in-charge (type full name)", "attest", { req: true }),
  ],
  listColumns: ["year", "drug", "unit", "disbursed", "closingStock"],
};
/* ---------------------------------------------------------------- the rest of legal review F.4 (2026-09-17, second pass) */

/* FORM 3H DAY CLOSURE (F.4.3). Form 3H: "Entries shall be completed for each day before the close of the day" and "The pages
 * of the register shall be serially numbered", signed by the over-all in-charge. The day's numbers are the ledger's, worked
 * out by the server at closure; the page number is allocated then and never changes. A day closed after local midnight is
 * marked late and keeps the time it was really closed. A correction is a new version with a reason, never an edit. */
const FORM3HCLOSE = {
  title: "NDPS Form 3H: day closed by the over-all in-charge", authority: "Kept by the recognised medical institution; open to inspection (r.52Y)",
  citation: "NDPS Rules 1985 r.52R(1)(c), Form No. 3H", patient: "none", dateField: "day", confidential: [], serial: "3H", retention: NDPS_RETENTION, internal: true,
  fields: [
    f("day", "Day closed", "date", { req: true }),
    f("drug", "Drug (code or name as in the stock register)", "text", { req: true }),
    f("unit", "Unit", "text", { req: true, max: 40 }),
    f("location", "Location (blank for the main store)", "text"),
    f("openingStock", "Opening stock", "number", { server: true }),
    f("received", "Quantity received", "number", { server: true }),
    f("dispensed", "Quantity dispensed", "number", { server: true }),
    f("returned", "Quantity returned", "number", { server: true }),
    f("wasted", "Quantity wasted, destroyed or transferred out", "number", { server: true }),
    f("closingStock", "Closing stock", "number", { server: true }),
    f("closedLate", "Closed after the close of the day", "text", { server: true }),
    f("closedBy", "Signature of the over-all in-charge (type full name)", "attest", { req: true }),
  ],
  check: async (v, c) => {
    const oic = ((c.settings.ndps.rmi || {}).designatedDoctors || []).find((d) => d.overallInCharge);
    if (!oic) return ["closedBy: no over-all in-charge is recorded (Registers, Settings; NDPS Rules r.52Q)"];
    return norm(oic.name) === norm(v.closedBy && v.closedBy.name) ? [] : [`closedBy: Form 3H is signed by the over-all in-charge (${oic.name})`];
  },
  listColumns: ["day", "drug", "unit", "location", "closingStock", "closedLate"],
};

/* QUARANTINE (F.4.5): expired or suspect stock is set aside and is not dispensed. The stock stays in the book (the hospital
 * still holds it); while a quarantine is open for a drug, a supply of it names its batch and may not be the quarantined one
 * (quarantineRefusal, pharmacy-dispense.js). Expired stock leaves quarantine only by destruction before the Controller's
 * nominee (r.52V(1), recorded on the stock register) or a return to the supplier. */
const QUARANTINE = {
  title: "Controlled drug quarantine", authority: "Hospital record of stock set aside (NDPS Rules r.52V; legal review F.4.5)", statutoryForm: false,
  citation: "NDPS Rules 1985 r.52V(1); legal review of the registers F.4.5", patient: "none", dateField: "quarantinedOn", confidential: [], serial: "Q", retention: NDPS_RETENTION, internal: true,
  fields: [
    f("drug", "Drug (code or name as in the stock register)", "text", { req: true }),
    f("unit", "Unit", "text", { req: true, max: 40 }),
    f("batch", "Batch", "text", { req: true, max: 80 }),
    f("location", "Location (blank for the main store)", "text"),
    f("quantity", "Quantity set aside", "number", { req: true, min: 0, max: 1000000 }),
    f("reason", "Why it is set aside", "enum", { req: true, options: [["expired", "Expired"], ["suspect-quality", "Suspect quality, damage or tampering"], ["recalled", "Recalled"], ["count-discrepancy", "Count discrepancy under investigation"], ["other", "Other (say why in the note)"]] }),
    f("quarantinedOn", "Date set aside", "date", { req: true }),
    f("note", "Note", "longtext"),
    f("quarantinedBy", "Set aside by (type full name)", "attest", { req: true }),
    f("status", "Status", "enum", { req: true, options: [["open", "In quarantine: not dispensed"], ["released", "Released back to use"], ["destroyed", "Destroyed (rule 52V(1), recorded on the stock register)"], ["returned-to-supplier", "Returned to the supplier"]] }),
    f("closedOn", "Date it left quarantine", "date"),
    f("closedReason", "How and why it left quarantine", "longtext"),
    f("closedBy", "Closed by (type full name)", "attest"),
  ],
  requiredWhen: (v) => (v.status && v.status !== "open" ? ["closedOn", "closedReason", "closedBy"] : []),
  rules: (v) => [
    ...(v.status === "open" && (v.closedOn || v.closedBy) ? ["status: say how the stock left quarantine"] : []),
    ...(v.reason === "expired" && v.status === "released" ? ["status: expired stock is destroyed before the Controller's nominee (rule 52V(1)) or returned, never released back to use"] : []),
    ...(v.closedOn && v.quarantinedOn && v.closedOn < v.quarantinedOn ? ["closedOn: cannot be before it was set aside"] : []),
  ],
  listColumns: ["quarantinedOn", "drug", "batch", "quantity", "reason", "status"],
};

/* HOME CARE (F.4.5, r.52W): an issue for home care records who carried it and the unused quantity brought back; the unused
 * quantity is a receipt (r.52V(2)), written to the stock ledger by the route and named here. The supply out is the dispense. */
const HOMECARE = {
  title: "Controlled drug taken out for home care (rule 52W)", authority: "Kept with Forms 3E and 3H; open to inspection (r.52Y)",
  citation: "NDPS Rules 1985 r.52W, r.52V(2)", patient: "required", dateField: "issuedOn", confidential: [], serial: "HC", retention: NDPS_RETENTION,
  fields: [
    f("dispenseId", "Supply (dispense) record", "text", { req: true, max: 160 }),
    f("drug", "Drug", "text", { server: true }),
    f("unit", "Unit", "text", { server: true }),
    f("quantityOut", "Quantity taken out", "number", { server: true }),
    f("issuedOn", "Date taken out", "date", { req: true }),
    f("carrierName", "Carried by: name", "text", { req: true }),
    f("carrierRole", "Carried by: role, or relationship to the patient", "text", { req: true }),
    f("visitNote", "The home visit (who visited, when)", "longtext"),
    f("returnedOn", "Date the unused quantity came back", "date", { req: true }),
    f("quantityReturned", "Unused quantity brought back (0 if none)", "number", { req: true, min: 0, max: 1000000 }),
    f("returnMovementId", "Stock receipt of the unused quantity (rule 52V(2))", "text", { server: true }),
    f("returnReceivedBy", "Unused quantity received back by (type full name)", "attest", { req: true }),
  ],
  rules: (v) => (v.returnedOn && v.issuedOn && v.returnedOn < v.issuedOn ? ["returnedOn: cannot be before it was taken out"] : []),
  check: async (v, c) => {
    const d = await c.repo.latest(c.tenantId, "MedicationDispense", v.dispenseId);
    return d && d.patientId === c.patientId ? [] : ["dispenseId: no such supply to this patient"];
  },
  listColumns: ["issuedOn", "drug", "quantityOut", "carrierName", "returnedOn", "quantityReturned"],
};

/* SCHEDULE X SUPPLY PARTICULARS (F.4.9; Drugs and Cosmetics Rules r.65(21)(b), r.65(9)(a)). The register's other fields come
 * from the ledger; what the ledger does not hold for a supply is recorded here once, with the supervising person's
 * attestation. The serial is the register's immutable entry number. */
const SCHEDXSUPPLY = {
  title: "Schedule X register: supply particulars", authority: "Drugs Control (licensing authority); kept two years (r.65(7))",
  citation: "Drugs and Cosmetics Rules 1945 r.65(9)(a), r.65(10), r.65(21)(b)", patient: "required", dateField: "date", confidential: ["patientAddress"], serial: "X",
  retention: "Kept at least two years from the last entry, with the duplicate prescription (Drugs and Cosmetics Rules r.65(7), r.65(9)(a)). WardSynQ never deletes an entry.",
  fields: [
    f("dispenseId", "Supply (dispense) record", "text", { req: true, max: 160 }),
    f("date", "(i) Date", "date", { req: true }),
    f("patientAddress", "(vii) Address of the patient", "longtext", { req: true }),
    f("manufacturer", "(v) Name of the manufacturer", "text", { req: true }),
    f("prescriptionRef", "(viii) Prescription reference number", "text", { req: true }),
    f("prescriptionCopyRef", "Duplicate copy of the prescription kept at (scan or file reference, r.65(9)(a))", "text", { req: true }),
    f("billNo", "(ix) Bill number", "text", { req: true }),
    f("billDate", "(ix) Bill date", "date", { req: true }),
    f("supervisedBy", "(x) Signature of the person under whose supervision the drug was supplied (type full name)", "attest", { req: true }),
  ],
  check: async (v, c) => {
    const d = await c.repo.latest(c.tenantId, "MedicationDispense", v.dispenseId);
    return d && d.patientId === c.patientId ? [] : ["dispenseId: no such supply to this patient"];
  },
  listColumns: ["date", "prescriptionRef", "billNo", "manufacturer"],
};

if (!REGISTERS.form3e) {
  defineRegister("form3e", FORM3E); defineRegister("form3esign", FORM3ESIGN); defineRegister("form3j", FORM3J); defineRegister("form3i", FORM3I);
  defineRegister("form3hclose", FORM3HCLOSE); defineRegister("quarantine", QUARANTINE); defineRegister("homecare", HOMECARE); defineRegister("schedxsupply", SCHEDXSUPPLY);
}

/* WHICH LAW A DRUG'S RECORDS FOLLOW (F.5, registers.ndps.drugRegimes). A drug on the controlled list without a regime is an
 * essential narcotic drug under Chapter VB, the safest default. */
const NDPS_REGIMES = ["end-chapter-vb", "state-ndps", "psychotropic"];
const FORM3E_REGIMES = ["end-chapter-vb", "state-ndps"];
/** PURE. The regime of a drug, or null when no register law applies to it here. */
function regimeOf(settings, set, drug, code) {
  const list = (settings && settings.ndps && settings.ndps.drugRegimes) || [];
  const hit = list.find((x) => x.regime && norm(x.drug) && (norm(x.drug) === norm(code) || norm(x.drug) === norm(drug)));
  if (hit) return hit.regime;
  return isControlledDrug(null, drug, code, set) ? "end-chapter-vb" : null;
}

/** An open quarantine blocks a supply (legal review F.4.5): the batch must be named and must not be one set aside.
 * Returns null, or the refusal. Read straight from the store: a check, not somebody reading the register. */
async function quarantineRefusal(ctx, drug, code, batch) {
  let rows;
  try { rows = await ctx.recordDeps.repository.latestByType(ctx.migration.tenantId, typeOf("quarantine"), 1000, { newest: true }); }
  catch { return { ok: false, status: 502, error: "quarantine_unreadable", detail: "Whether this drug is in quarantine could not be checked, so nothing was dispensed." }; }
  const open = (rows || []).filter((q) => q.fields && q.fields.status === "open" && (norm(q.fields.drug) === norm(code) || norm(q.fields.drug) === norm(drug)));
  if (!open.length) return null;
  if (!str(batch)) return { ok: false, status: 422, error: "quarantine_batch_required", detail: "Some stock of this drug is in quarantine. Name the batch you are supplying from." };
  const hit = open.find((q) => norm(q.fields.batch) === norm(batch));
  return hit ? { ok: false, status: 409, error: "batch_quarantined", serial: hit.serial, detail: `Batch ${hit.fields.batch} of this drug is in quarantine (${hit.serial}) and is not dispensed.` } : null;
}

/** NDPS Rules r.52U: the hospital holds no more than its Form 3J estimate (revised, when one is recorded) for the year
 * (legal review F.4.4). Returns null to go ahead, { warning } when the check could not be made, or the refusal. A receipt
 * over the estimate goes ahead only with the reference of the revised estimate filed with the Controller. */
async function estimateRefusal(request, env, ctx, move) {
  const year = Number(str(move.at || new Date().toISOString()).slice(0, 4));
  let estimates;
  try { estimates = await ctx.recordDeps.repository.latestByType(ctx.migration.tenantId, typeOf("form3j"), 1000, { newest: true }); }
  catch { return { refuse: { ok: false, status: 502, error: "estimate_unreadable", detail: "The Form 3J estimate could not be read, so the receipt was not recorded." } }; }
  const mine = (estimates || []).filter((e) => e.fields && Number(e.fields.year) === year && norm(e.fields.unit) === norm(move.unit) && (norm(e.fields.drug) === norm(move.code) || norm(e.fields.drug) === norm(move.display)));
  const pick = (k) => mine.find((e) => e.fields.estimateKind === k);
  const est = pick("revised") || pick("estimate");
  if (!est) return { warning: `No Form 3J estimate for ${year} is recorded for this drug (NDPS Rules r.52T, r.52U). File one.` };
  const ledger = await readLedger(request, env, ctx);
  if (ledger.error) return { refuse: { ...ledger.error, detail: "The stock held could not be read, so the receipt was not checked against the estimate and was not recorded." } };
  /* ponytail: the ledger read is capped (READ_CAP); a hospital past it gets a warning, not a refusal, because refusing a
   * morphine delivery on a count this file cannot make is a patient harm. A per-drug index when that cap is reached. */
  if (ledger.truncated) return { warning: "Too many stock records to work out the stock held, so this receipt was not checked against the Form 3J estimate." };
  const held = levelsFrom(ledger.movements, ledger.dispenses).levels.filter((l) => norm(l.code) === norm(move.code) && norm(l.unit) === norm(move.unit)).reduce((n, l) => n + l.level, 0);
  const limit = Number(est.fields.quantity);
  if (held + Number(move.value) <= limit) return null;
  if (str(move.revisedEstimateRef).length >= 3) return { over: { held, limit, estimate: est.fields.estimateKind } };
  return { refuse: { ok: false, status: 409, error: "above_form3j_estimate", held, limit, estimate: est.fields.estimateKind,
    detail: `This receipt would take the stock held to ${held + Number(move.value)} ${move.unit}, above the ${est.fields.estimateKind === "revised" ? "revised " : ""}Form 3J estimate of ${limit} for ${year} (NDPS Rules r.52U). Record the reference of the revised estimate filed with the Controller of Drugs, or do not receive it.` } };
}

/** PURE. Form 3-I for one drug and unit from the year's ledger rows (book items at every location) and the estimates. */
function form3iFrom(year, drug, unit, items, estimates) {
  const mine = (items || []).filter((it) => norm(it.code) === norm(drug) && norm(it.unit) === norm(unit));
  const est = (estimates || []).filter((e) => e.fields && Number(e.fields.year) === Number(year) && norm(e.fields.drug) === norm(drug) && norm(e.fields.unit) === norm(unit));
  const pick = (k) => { const e = est.find((x) => x.fields.estimateKind === k); return e ? Number(e.fields.quantity) : null; };
  const sum = (fn) => mine.reduce((n, it) => n + it.form3h.reduce((m, d) => m + fn(d), 0), 0);
  const out = { estimate: pick("estimate"), revisedEstimate: pick("revised"), openingStock: mine.reduce((n, it) => n + it.opening, 0),
    procured: sum((d) => d.received), disbursed: sum((d) => d.dispensed - d.returned), closingStock: mine.reduce((n, it) => n + it.closing, 0) };
  const base = out.revisedEstimate != null ? out.revisedEstimate : out.estimate;
  out.overEstimate = base != null && out.disbursed > base * 1.1;
  out.noEstimate = base == null;
  return out;
}

/** PURE. The normalised names and codes this hospital flags as controlled. */
function controlledSet(cfg) {
  const w = cfg && typeof cfg === "object" ? cfg : {};
  const out = new Set();
  for (const n of Array.isArray(w.controlledDrugs) ? w.controlledDrugs : []) if (norm(n)) out.add(norm(n));
  for (const e of Array.isArray(w.formulary) ? w.formulary : []) {
    if (!e || e.controlled !== true) continue;
    for (const n of [e.drug, e.code, ...(Array.isArray(e.aliases) ? e.aliases : [])]) if (norm(n)) out.add(norm(n));
  }
  return out;
}

/** PURE. Is this drug (by name or code) on the hospital's controlled list? Whole-name match only. */
function isControlledDrug(cfg, drug, code, set) {
  const s = set || controlledSet(cfg);
  return !!((norm(code) && s.has(norm(code))) || (norm(drug) && s.has(norm(drug))));
}

/**
 * The second person, or the refusal. ctx.witnessId is who the recorder named; ctx.witnessCheck(id) answers whether that
 * id is an active member of this hospital allowed to witness (the route owns the membership lookup). Shared by stock
 * wastage, dispensing and the eMAR so the three cannot disagree about what a witness is.
 */
async function witnessOrRefusal(ctx, actorId) {
  const witnessId = str(ctx.witnessId);
  /* Hospital policy, not law: with registers.ndps.requireWitness off, no witness is asked for; one named is still checked. */
  if (!witnessId && !registerSettings(ctx.wsqCfg).ndps.requireWitness) return { witnessId: null, policyOff: true };
  if (!witnessId) return { error: { ok: false, status: 422, error: "witness_required", detail: "This is a controlled drug. Name the second person who witnessed it." } };
  if (witnessId.toLowerCase() === str(actorId).toLowerCase()) return { error: { ok: false, status: 422, error: "witness_not_independent", detail: "The witness must be a different person from the one recording." } };
  if (typeof ctx.witnessCheck !== "function") return { error: { ok: false, status: 502, error: "witness_check_unavailable", detail: "The witness could not be checked, so nothing was recorded." } };
  let ok = false;
  try { ok = (await ctx.witnessCheck(witnessId)) === true; } catch { return { error: { ok: false, status: 502, error: "witness_check_failed", detail: "The witness could not be checked, so nothing was recorded." } }; }
  if (!ok) return { error: { ok: false, status: 422, error: "witness_not_staff", detail: "The witness is not an active member of this hospital who may witness a controlled drug." } };
  return { witnessId };
}

const dayOf = (iso) => str(iso).slice(0, 10);
const k3 = (code, location, unit) => `${norm(code)}|${norm(location)}|${norm(unit)}`;

/**
 * PURE. The register book: per controlled item (code, location, unit), every event in time order with the running
 * balance, the Form 3H day rows, and what is wrong (unwitnessed, negative, count discrepancies). The balance rules are
 * levelsFrom()'s own: an issue leaves the one store the item was received into, a returned issue is not an issue,
 * and a count or a dose given on the ward changes nothing in the book. The closing balance is cross-checked against
 * levelsFrom() itself, and a disagreement is reported rather than one of them trusted.
 */
function registerBook(input) {
  const i = input || {};
  /* Form 3H is kept by the hospital's own day (legal review F.4.3: closed "before local midnight"), so a movement belongs
   * to the local date it happened on; offsetMinutes is the hospital's clock (0, UTC, when a caller gives none). */
  const off = Number.isFinite(i.offsetMinutes) ? i.offsetMinutes : 0;
  const dayOf = (iso) => { const t = Date.parse(str(iso)); return Number.isFinite(t) ? new Date(t + off * 60000).toISOString().slice(0, 10) : str(iso).slice(0, 10); };
  const set = i.set || controlledSet(i.cfg);
  const from = str(i.from), to = str(i.to);
  const movements = (i.movements || []).filter((m) => m && isControlledDrug(null, m.display, m.code, set));
  const dispenses = (i.dispenses || []).filter((d) => d && isControlledDrug(null, d.drug, d.drugCode, set));
  const orders = new Map((i.orders || []).filter(Boolean).map((o) => [o.id, o]));
  const policyWitness = i.requireWitness !== false;
  const events = [];
  const receivedAt = new Map();
  for (const m of movements) {
    const q = quantityOf(m.quantity);
    if (q && (m.kind === "receipt" || m.kind === "transfer-in")) {
      const k = `${norm(m.code)}|${norm(q.unit)}`;
      const s = receivedAt.get(k) || new Set(); s.add(str(m.location) || null); receivedAt.set(k, s);
    }
  }
  /* A return to the supplier (stock.js returnToSupplier) leaves the book like a transfer out, witnessed like a wastage. */
  const SIGN = { receipt: 1, "transfer-in": 1, adjustment: 1, wastage: -1, "transfer-out": -1, "supplier-return": -1 };
  for (const m of movements) {
    const q = quantityOf(m.quantity);
    if (!q || SIGN[m.kind] === undefined) continue;
    events.push({ at: str(m.at), kind: m.kind, code: str(m.code), display: str(m.display) || str(m.code), location: str(m.location) || null, unit: q.unit,
      delta: q.value * SIGN[m.kind], quantity: q.value, ref: { movementId: m.id }, by: m.by || null, witnessedBy: m.witnessedBy || null,
      reason: m.reason || null, batch: m.batch || null, receivedFrom: m.receivedFrom || null, documentNo: m.documentNo || null,
      ...(m.destruction ? { destruction: m.destruction } : {}),
      ...(m.kind === "supplier-return" ? { supplier: m.supplier || null, controllerApprovalRef: m.controllerApprovalRef || null } : {}),
      needsWitness: policyWitness && (m.kind === "wastage" || m.kind === "adjustment" || m.kind === "supplier-return") });
  }
  for (const d of dispenses) {
    const q = quantityOf(d.quantity);
    if (!q) continue;
    const code = str(d.drugCode) || str(d.drug);
    const src = receivedAt.get(`${norm(code)}|${norm(q.unit)}`);
    const location = src && src.size === 1 ? [...src][0] : null;
    const base = { code, display: str(d.drug) || code, location, unit: q.unit, quantity: q.value, patientId: d.patientId || null, orderId: d.orderId || null, ref: { dispenseId: d.id }, batch: d.batch || null };
    /* Form 3H names the patient's Form 3E registration number against each quantity dispensed. */
    const form3eSerial = i.form3e ? (i.form3e.get(d.patientId) || null) : undefined;
    events.push({ ...base, at: str(d.dispensedAt), kind: "issue", delta: -q.value, by: d.dispensedBy || null, witnessedBy: d.witnessedBy || null, destination: d.destination || null, needsWitness: policyWitness,
      ...(form3eSerial !== undefined ? { form3eSerial } : {}) });
    if (d.state === "returned") events.push({ ...base, at: str(d.returnedAt), kind: "return", delta: q.value, by: d.returnedBy || null, reason: d.returnReason || null, needsWitness: false });
  }
  /* A dose given on the ward: already issued, so the book does not move. Shown so every issue can be followed to the
   * patient it reached, and so an issue with no dose recorded against it stands out. */
  for (const a of i.administrations || []) {
    if (!a || a.status !== "administered") continue;
    const o = orders.get(a.orderId);
    if (!o || !isControlledDrug(null, o.drug, o.drugCode, set)) continue;
    const code = str(o.drugCode) || str(o.drug);
    events.push({ at: str(a.administeredAt), kind: "administered", code, display: str(o.drug) || code, location: null, unit: null, delta: 0, quantity: null,
      dose: o.dose || null, patientId: a.patientId || o.patientId || null, orderId: o.id, ref: { administrationId: a.id }, by: a.administeredBy || null, witnessedBy: a.witnessedBy || null, needsWitness: policyWitness });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  const items = new Map();
  const itemFor = (e) => {
    const k = e.unit ? k3(e.code, e.location, e.unit) : null;
    if (!k) return null;
    if (!items.has(k)) items.set(k, { code: e.code, display: e.display, location: e.location, unit: e.unit, opening: 0, balance: 0, lines: [], days: new Map(), problems: [] });
    return items.get(k);
  };
  const doses = [];
  for (const e of events) {
    if (e.kind === "administered") { doses.push(e); continue; }
    const it = itemFor(e);
    if (!it) continue;
    const inPeriod = (!from || dayOf(e.at) >= from) && (!to || dayOf(e.at) < to);
    if (!inPeriod && (!from || dayOf(e.at) < from)) { it.opening += e.delta; it.balance += e.delta; continue; }
    if (!inPeriod) continue;
    it.balance += e.delta;
    const line = { ...e, balanceAfter: it.balance, unwitnessed: e.needsWitness && !e.witnessedBy };
    it.lines.push(line);
    if (line.unwitnessed) it.problems.push({ kind: "unwitnessed", at: e.at, ref: e.ref });
    if (e.kind === "issue" && e.form3eSerial === null && (typeof i.regimeFor !== "function" || FORM3E_REGIMES.includes(i.regimeFor(e.display, e.code)))) it.problems.push({ kind: "no_form3e", at: e.at, ref: e.ref, patientId: e.patientId });
    if (it.balance < 0) it.problems.push({ kind: "negative_balance", at: e.at, balance: it.balance, ref: e.ref });
    const day = dayOf(e.at);
    const row = it.days.get(day) || { date: day, opening: it.balance - e.delta, received: 0, receivedFrom: [], documents: [], dispensed: 0, toPatients: [], wasted: 0, adjusted: 0, returned: 0, returnedToSupplier: 0, closing: 0 };
    if (e.kind === "receipt" || e.kind === "transfer-in") { row.received += e.quantity; if (e.receivedFrom) row.receivedFrom.push(e.receivedFrom); if (e.documentNo) row.documents.push(e.documentNo); }
    else if (e.kind === "issue") { row.dispensed += e.quantity; row.toPatients.push({ patientId: e.patientId, quantity: e.quantity, form3e: e.form3eSerial || null }); }
    else if (e.kind === "return") row.returned += e.quantity;
    /* Every disbursement other than to a patient is in `wasted`, as the transfer out always was, so opening + received -
     * dispensed + returned - wasted still closes; the part that went back to a supplier is also named on its own. */
    else if (e.kind === "wastage" || e.kind === "transfer-out" || e.kind === "supplier-return") { row.wasted += e.quantity; if (e.kind === "supplier-return") row.returnedToSupplier += e.quantity; }
    else if (e.kind === "adjustment") row.adjusted += e.delta;
    row.closing = it.balance;
    it.days.set(day, row);
  }
  for (const d of doses) {
    if ((from && dayOf(d.at) < from) || (to && dayOf(d.at) >= to)) continue;
    if (!d.witnessedBy && d.needsWitness) d.unwitnessed = true;
  }
  /* The cross-check. Two computations of the same book that disagree are a defect to see, not a number to pick. */
  const reference = levelsFrom(movements, dispenses).levels;
  const out = [...items.values()].map((it) => {
    const ref = reference.find((r) => k3(r.code, r.location, r.unit) === k3(it.code, it.location, it.unit));
    const mismatch = !to && ref && Math.abs(ref.level - it.balance) > 1e-9;
    return { code: it.code, display: it.display, location: it.location, unit: it.unit, opening: it.opening, closing: it.balance, lines: it.lines,
      ...(typeof i.regimeFor === "function" ? { regime: i.regimeFor(it.display, it.code) } : {}),
      form3h: [...it.days.values()], problems: it.problems, ...(mismatch ? { ledgerMismatch: { register: it.balance, stock: ref.level } } : {}) };
  }).sort((a, b) => a.display.localeCompare(b.display) || str(a.location).localeCompare(str(b.location)));
  return { items: out, doses: doses.filter((d) => (!from || dayOf(d.at) >= from) && (!to || dayOf(d.at) < to)) };
}

async function openRead(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }), resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * The register for a period. ctx: { migration, actorDeps, recordDeps, cfg, actor, from?, to? (YYYY-MM-DD, to exclusive) }.
 * Reads the stock ledger as the signed-in person (pharmacist or ward in-charge), so the record's own read scope applies.
 */
async function ndpsRegister(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };
  const from = str(ctx.from), to = str(ctx.to);
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return { ...base, ok: false, status: 422, error: "bad_dates", message: "Give dates as YYYY-MM-DD." };
  const settings = registerSettings(ctx.wsqCfg || ctx.cfg);
  const today = hospitalToday(Date.now(), ctx.clock);
  const rmi = rmiStatus(settings, today);
  const set = controlledSet(ctx.cfg);
  if (!set.size) return { ...base, ok: true, configured: false, items: [], doses: [], counts: [], rmi, message: "No drug is flagged as controlled. The pharmacy flags them on the Admin clinical settings screen (Controlled drugs).", policy: POLICY_NOTE };
  const ledger = await readLedger(request, env, ctx);
  if (ledger.error) return { ...base, ...ledger.error, items: [] };
  const { movements, dispenses, administrations, orders } = ledger;
  const [counts, reg3e, closures] = await Promise.all([listEntries({ ...ctx, kind: "ndpscount", from: from || undefined, to: to || undefined }), listEntries({ ...ctx, kind: "form3e" }),
    listEntries({ ...ctx, kind: "form3hclose", from: from || undefined, to: to || undefined })]);
  if (!counts.ok) return { ...base, ...counts, items: [] };
  if (!reg3e.ok) return { ...base, ...reg3e, items: [] };
  if (!closures.ok) return { ...base, ...closures, items: [] };
  const form3e = new Map(reg3e.entries.map((e) => [e.patientId, e.serial]));
  const regimeFor = (drug, code) => regimeOf(settings, set, drug, code);
  const offsetMinutes = ctx.clock && Number.isFinite(ctx.clock.offsetMinutes) ? ctx.clock.offsetMinutes : 330;
  const book = registerBook({ set, movements, dispenses, administrations, orders, from, to, form3e, requireWitness: settings.ndps.requireWitness, regimeFor, offsetMinutes });
  /* Form 3H day closure (F.4.3): each day row says whether the over-all in-charge closed it, on which page, late or not,
   * and whether the ledger moved after it was closed. A past day nobody closed is late. */
  const closedAt = new Map(closures.entries.map((e) => [k3(e.fields.drug, e.fields.location, e.fields.unit) + "|" + e.fields.day, e]));
  let daysUnclosed = 0;
  for (const it of book.items) for (const d of it.form3h) {
    const c = closedAt.get(k3(it.code, it.location, it.unit) + "|" + d.date);
    if (c) d.closure = { id: c.id, page: c.serial, late: c.fields.closedLate === "yes", changedSince: Number(c.fields.closingStock) !== d.closing };
    else { d.closure = null; if (d.date < today) { d.unclosedLate = true; daysUnclosed++; } }
  }
  const truncated = ledger.truncated || reg3e.truncated;
  return {
    ...base, ok: true, configured: true, from: from || null, to: to || null, items: book.items, doses: book.doses, rmi,
    counts: counts.entries, discrepancies: counts.entries.filter((c) => c.fields && Number(c.fields.variance) !== 0).length,
    unwitnessed: book.items.reduce((n, it) => n + it.problems.filter((p) => p.kind === "unwitnessed").length, 0) + book.doses.filter((d) => d.unwitnessed).length,
    withoutForm3e: book.items.reduce((n, it) => n + it.problems.filter((p) => p.kind === "no_form3e").length, 0),
    requireWitness: settings.ndps.requireWitness, daysUnclosed,
    ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} records of one kind exist; only the newest were read, so this register may be incomplete and must not be filed as it stands.` } : {}),
    policy: POLICY_NOTE,
    retention: NDPS_RETENTION,
  };
}

/** The stock ledger, read as the signed-in person. { movements, dispenses, administrations, orders, truncated } or { error }. */
async function readLedger(request, env, ctx) {
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return { error };
  try {
    const [movements, dispenses, administrations, orders] = await Promise.all([
      svc.list("StockMovement", READ_CAP), svc.list("MedicationDispense", READ_CAP),
      svc.list("MedicationAdministration", READ_CAP), svc.list("MedicationOrder", READ_CAP),
    ]);
    return { movements, dispenses, administrations, orders, truncated: [movements, dispenses, administrations, orders].some((x) => (x || []).length >= READ_CAP) };
  } catch (e) {
    if (e instanceof GovernanceError) return { error: { ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) } };
    return { error: { ok: false, status: 502, error: "record_read_failed", message: "The stock ledger could not be read. Do not read this as an empty register." } };
  }
}

/**
 * The annual NDPS returns for a calendar year: the Form 3J estimates recorded, a Form 3-I computed per controlled drug
 * from the year's ledger, the 3-I entries prepared, the returns filed and their due dates.
 * ctx: { migration, actorDeps, recordDeps, cfg, wsqCfg, clock, actor, year }
 */
async function ndpsAnnual(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off" };
  const year = Number(ctx.year);
  if (!Number.isInteger(year) || year < 2015 || year > 2100) return { ok: false, status: 422, error: "bad_year", message: "Give the calendar year as YYYY." };
  const settings = registerSettings(ctx.wsqCfg || ctx.cfg);
  const today = hospitalToday(Date.now(), ctx.clock);
  const set = controlledSet(ctx.cfg);
  const [estimates, returns3i, filed] = await Promise.all(["form3j", "form3i", "statreturn"].map((kind) => listEntries({ ...ctx, kind })));
  for (const r of [estimates, returns3i, filed]) if (!r.ok) return r;
  const filedOn = {};
  for (const e of filed.entries) if (e.fields && /^ndps-3[ij]$/.test(e.fields.returnKind)) filedOn[`${e.fields.returnKind === "ndps-3j" ? "form3j" : "form3i"}-${e.fields.period}`] = e.fields.submittedOn;
  const clocks = ndpsAnnualClocks(today, filedOn);
  let computed = [];
  if (set.size) {
    const ledger = await readLedger(request, env, ctx);
    if (ledger.error) return ledger.error;
    if (ledger.truncated) return { ok: false, status: 409, error: "too_many_records", message: `More than ${READ_CAP} stock records exist, so the year's return cannot be worked out safely. Nothing is shown rather than a short return.` };
    const book = registerBook({ set, movements: ledger.movements, dispenses: ledger.dispenses, administrations: [], orders: [], from: `${year}-01-01`, to: `${year + 1}-01-01`, requireWitness: settings.ndps.requireWitness, offsetMinutes: ctx.clock && Number.isFinite(ctx.clock.offsetMinutes) ? ctx.clock.offsetMinutes : 330 });
    const pairs = new Map();
    for (const it of book.items) pairs.set(`${norm(it.code)}|${norm(it.unit)}`, { drug: it.code, unit: it.unit });
    for (const e of estimates.entries) if (Number(e.fields.year) === year) pairs.set(`${norm(e.fields.drug)}|${norm(e.fields.unit)}`, pairs.get(`${norm(e.fields.drug)}|${norm(e.fields.unit)}`) || { drug: e.fields.drug, unit: e.fields.unit });
    computed = [...pairs.values()].map((p) => ({ ...p, ...form3iFrom(year, p.drug, p.unit, book.items, estimates.entries) }));
  }
  return {
    ok: true, year, clocks, rmi: rmiStatus(settings, today), configured: set.size > 0,
    estimates: estimates.entries.filter((e) => Number(e.fields.year) === year || Number(e.fields.year) === year + 1),
    form3i: computed, prepared: returns3i.entries.filter((e) => Number(e.fields.year) === year),
    filed: filed.entries.filter((e) => e.fields && /^ndps-3[ij]$/.test(e.fields.returnKind)),
    submission: "Manual. The Controller of Drugs has no API here: file the return, then record the date and acknowledgement.",
  };
}

/**
 * One patient's Form 3E: the registration, and the dispensing table read from the ledger (every supply of a controlled
 * drug to the patient) with the signature recorded against each. ctx: { ..., patientId }
 */
async function form3eView(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off" };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ok: false, status: 422, error: "patient_required" };
  const [reg, signs] = await Promise.all([listEntries({ ...ctx, kind: "form3e", patientId }), listEntries({ ...ctx, kind: "form3esign", patientId })]);
  if (!reg.ok) return reg;
  if (!signs.ok) return signs;
  const set = controlledSet(ctx.cfg);
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return error;
  let dispenses;
  try { dispenses = await svc.byPatient("MedicationDispense", patientId); }
  catch (e) { return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", message: "The supplies could not be read. Do not read this as none." }; }
  const signed = new Map(signs.entries.filter((s) => s.complete).map((s) => [s.fields.dispenseId, s]));
  const rows = (dispenses || []).filter((d) => d && isControlledDrug(null, d.drug, d.drugCode, set)).map((d) => {
    const q = quantityOf(d.quantity);
    const s = signed.get(d.id);
    return { dispenseId: d.id, date: str(d.dispensedAt).slice(0, 10), drug: str(d.drug) || str(d.drugCode), quantity: q ? `${q.value} ${q.unit}` : "", returned: d.state === "returned",
      signature: s ? { signedBy: s.fields.signedBy, name: s.fields.signature && s.fields.signature.name, at: s.fields.signature && s.fields.signature.at, by: s.fields.signature && s.fields.signature.by, representativeName: s.fields.representativeName || null } : null };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, patientId, registration: reg.entries[0] || null, rows, unsigned: rows.filter((r) => !r.signature && !r.returned).length };
}

/**
 * Form 3H numbers for one drug, unit and location on one day, worked out from the ledger for a day closure (F.4.3).
 * ctx: { ...route ctx, cfg }; q: { day, drug, unit, location }. Returns { numbers } or { error }.
 */
async function form3hDayNumbers(request, env, ctx, q) {
  const day = str(q.day);
  const next = new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  const ledger = await readLedger(request, env, ctx);
  if (ledger.error) return { error: ledger.error };
  if (ledger.truncated) return { error: { ok: false, status: 409, error: "too_many_records", message: `More than ${READ_CAP} stock records exist, so the day's numbers cannot be worked out safely. The day was not closed.` } };
  const settings = registerSettings(ctx.wsqCfg || ctx.cfg);
  const book = registerBook({ set: controlledSet(ctx.cfg), movements: ledger.movements, dispenses: ledger.dispenses, administrations: [], orders: [], from: day, to: next, requireWitness: settings.ndps.requireWitness, offsetMinutes: ctx.clock && Number.isFinite(ctx.clock.offsetMinutes) ? ctx.clock.offsetMinutes : 330 });
  const it = book.items.find((x) => k3(x.code, x.location, x.unit) === k3(q.drug, q.location, q.unit));
  if (!it) return { error: { ok: false, status: 422, error: "no_such_item", message: "No controlled drug with that name, unit and location is in the register.", written: 0 } };
  const row = it.form3h.find((d) => d.date === day);
  return { numbers: row ? { openingStock: row.opening, received: row.received, dispensed: row.dispensed, returned: row.returned, wasted: row.wasted, closingStock: row.closing }
    : { openingStock: it.closing, received: 0, dispensed: 0, returned: 0, wasted: 0, closingStock: it.closing } };
}

/**
 * The Drugs and Cosmetics Rules r.65 registers (F.4.8, F.4.9), read from the ledger for drugs whose regime is schedule-h1 or
 * schedule-x. which: "h1" | "schedx". ctx: { ...route ctx, cfg, wsqCfg, orgName, staffNames?(ids) -> Map id -> name }.
 *   H1 (r.65(3)(1)(h), three years): per supply, the prescriber's name and address, the patient's name, the drug and quantity.
 *   X (r.65(21)(b), two years): a page per drug: receipts with the supplier's name, address and licence number, the
 *   manufacturer and batch; supplies with the patient's name and address, the prescription reference, the bill, and the
 *   supervising person's attestation (schedxsupply); whether each receipt went to a lock-and-key location (r.65(12)).
 */
async function rule65Register(request, env, ctx, which) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off" };
  const from = str(ctx.from), to = str(ctx.to);
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return { ok: false, status: 422, error: "bad_dates", message: "Give dates as YYYY-MM-DD." };
  const settings = registerSettings(ctx.wsqCfg || ctx.cfg), set = controlledSet(ctx.cfg);
  const regime = which === "h1" ? "schedule-h1" : "schedule-x";
  const drugs = settings.ndps.drugRegimes.filter((x) => x.regime === regime);
  const base = { ok: true, register: which, rule65InpatientRegisters: settings.ndps.rule65InpatientRegisters,
    retention: which === "h1" ? "Kept three years (Drugs and Cosmetics Rules r.65(3)(1)(h)). WardSynQ never deletes an entry." : "Kept at least two years from the last entry, with the duplicate prescriptions (r.65(7), r.65(9)(a)). WardSynQ never deletes an entry." };
  if (!drugs.length) return { ...base, configured: false, message: `No drug is marked ${which === "h1" ? "Schedule H1" : "Schedule X"} (Registers, Settings, drug regimes).` };
  const ledger = await readLedger(request, env, ctx);
  if (ledger.error) return ledger.error;
  const inPeriod = (at) => (!from || str(at).slice(0, 10) >= from) && (!to || str(at).slice(0, 10) < to);
  const mineDrug = (drug, code) => regimeOf(settings, set, drug, code) === regime;
  const supplies = ledger.dispenses.filter((d) => d && mineDrug(d.drug, d.drugCode) && inPeriod(d.dispensedAt) && (settings.ndps.rule65InpatientRegisters || !str(d.destination)));
  const repo = ctx.recordDeps.repository, tenantId = mig.tenantId;
  const people = new Map();
  let particulars;
  try {
    for (const pid of new Set(supplies.map((d) => d.patientId).filter(Boolean))) { const p = await repo.latest(tenantId, "Patient", pid); people.set(pid, p ? p.name || null : null); }
    particulars = which === "schedx" ? await repo.latestByType(tenantId, typeOf("schedxsupply"), 1000, { newest: true }) : [];
    await repo.auditOnly(tenantId, { ts: new Date().toISOString(), actor: str(ctx.actor && ctx.actor.id), connectorId: "wardsynq-registers", action: "register.read", outcome: "ok",
      scope: { register: which === "h1" ? "schedule-h1" : "schedule-x", from: from || null, to: to || null, rows: supplies.length }, patientRefHash: null });
  } catch { return { ok: false, status: 502, error: "register_read_failed", message: "The register could not be read. Do not read this as empty." }; }
  const orders = new Map((ledger.orders || []).map((o) => [o.id, o]));
  let names = new Map();
  if (which === "h1" && typeof ctx.staffNames === "function") { try { names = await ctx.staffNames([...new Set(supplies.map((d) => (orders.get(d.orderId) || {}).prescriberId).filter(Boolean))]); } catch { names = new Map(); } }
  const qty = (q) => { const x = quantityOf(q); return x ? `${x.value} ${x.unit}` : ""; };
  const truncated = ledger.truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} records of one kind exist; only the newest were read, so this register may be incomplete and must not be relied on as it stands.` } : {};
  if (which === "h1") {
    return { ...base, ...truncated, configured: true, rows: supplies.sort((a, b) => str(a.dispensedAt).localeCompare(str(b.dispensedAt))).map((d) => {
      const o = orders.get(d.orderId) || {};
      return { date: str(d.dispensedAt).slice(0, 10), prescriberId: o.prescriberId || null, prescriberName: names.get(o.prescriberId) || null, prescriberAddress: str(ctx.orgName) || null,
        patientId: d.patientId, patientName: people.get(d.patientId) || null, drug: str(d.drug) || str(d.drugCode), quantity: qty(d.quantity), returned: d.state === "returned", dispenseId: d.id };
    }) };
  }
  const done = new Map((particulars || []).filter((e) => e.complete).map((e) => [e.fields.dispenseId, e]));
  const lockAndKey = settings.ndps.scheduleXLocations;
  const pages = drugs.map((dr) => {
    const hit = (drug, code) => norm(dr.drug) === norm(code) || norm(dr.drug) === norm(drug);
    const receipts = ledger.movements.filter((m) => m && (m.kind === "receipt" || m.kind === "transfer-in") && hit(m.display, m.code) && inPeriod(m.at)).map((m) => ({
      date: str(m.at).slice(0, 10), quantity: qty(m.quantity), supplierName: m.receivedFrom || null, supplierAddress: m.supplierAddress || null, supplierLicenceNo: m.supplierLicenceNo || null,
      manufacturer: m.manufacturer || null, batch: m.batch || null, documentNo: m.documentNo || null, location: m.location || null, lockAndKey: lockAndKey.includes(str(m.location)),
      missing: ["receivedFrom", "supplierAddress", "supplierLicenceNo", "manufacturer", "batch"].filter((k) => !str(m[k])) }));
    const out = supplies.filter((d) => hit(d.drug, d.drugCode)).map((d) => {
      const p = done.get(d.id);
      return { date: str(d.dispensedAt).slice(0, 10), quantity: qty(d.quantity), batch: d.batch || null, patientId: d.patientId, patientName: people.get(d.patientId) || null, dispenseId: d.id, returned: d.state === "returned",
        particulars: p ? { serial: p.serial, patientAddress: p.fields.patientAddress, manufacturer: p.fields.manufacturer, prescriptionRef: p.fields.prescriptionRef, prescriptionCopyRef: p.fields.prescriptionCopyRef,
          billNo: p.fields.billNo, billDate: p.fields.billDate, supervisedBy: p.fields.supervisedBy && p.fields.supervisedBy.name } : null };
    });
    return { drug: dr.drug, receipts, supplies: out.sort((a, b) => a.date.localeCompare(b.date)) };
  });
  return { ...base, ...truncated, configured: true, lockAndKeyLocations: lockAndKey, pages,
    withoutParticulars: pages.reduce((n, p) => n + p.supplies.filter((s) => !s.particulars && !s.returned).length, 0),
    receiptsOutsideLockAndKey: pages.reduce((n, p) => n + p.receipts.filter((r) => !r.lockAndKey).length, 0) };
}

/**
 * One patient's controlled-drug rows, read-only, for the nurse caring for them (F.4.10: "Nursing can read only the patient's
 * own rows"): the supplies to the patient and the doses given, read as the signed-in person. ctx: { ..., patientId }
 */
async function ndpsPatientView(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off" };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ok: false, status: 422, error: "patient_required" };
  const set = controlledSet(ctx.cfg);
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return error;
  let dispenses, administrations, orders;
  try { [dispenses, administrations, orders] = await Promise.all([svc.byPatient("MedicationDispense", patientId), svc.byPatient("MedicationAdministration", patientId), svc.byPatient("MedicationOrder", patientId)]); }
  catch (e) { return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", message: "This patient's controlled drugs could not be read. Do not read this as none." }; }
  try {
    await ctx.recordDeps.repository.auditOnly(mig.tenantId, { ts: new Date().toISOString(), actor: str(ctx.actor && ctx.actor.id), connectorId: "wardsynq-registers", action: "register.read", outcome: "ok",
      scope: { register: "ndps", view: "patient", byPatient: true }, patientRefHash: ctx.recordDeps.pseudonym ? await ctx.recordDeps.pseudonym(patientId) : null });
  } catch { return { ok: false, status: 502, error: "register_read_failed", message: "The register read could not be audited, so it was not shown." }; }
  const byOrder = new Map((orders || []).map((o) => [o.id, o]));
  const qty = (q) => { const x = quantityOf(q); return x ? `${x.value} ${x.unit}` : ""; };
  return { ok: true, patientId, readOnly: true,
    supplies: (dispenses || []).filter((d) => d && isControlledDrug(null, d.drug, d.drugCode, set)).map((d) => ({ at: d.dispensedAt, drug: str(d.drug) || str(d.drugCode), quantity: qty(d.quantity), state: d.state, destination: d.destination || null }))
      .sort((a, b) => str(a.at).localeCompare(str(b.at))),
    doses: (administrations || []).filter((a) => a && a.status === "administered" && byOrder.get(a.orderId) && isControlledDrug(null, byOrder.get(a.orderId).drug, byOrder.get(a.orderId).drugCode, set))
      .map((a) => ({ at: a.administeredAt, drug: byOrder.get(a.orderId).drug, dose: byOrder.get(a.orderId).dose || null, by: a.administeredBy || null, witnessedBy: a.witnessedBy || null }))
      .sort((a, b) => str(a.at).localeCompare(str(b.at))) };
}

/**
 * A shift count. The expected quantity is the book's, computed now by the server; the entry records the variance
 * and flags a discrepancy. It never adjusts stock. ctx: { migration, actorDeps, recordDeps, cfg, actor, code, location?,
 * unit, counted, shift?, note?, countedOn?, witnessId?, witnessCheck, idempotencyKey? }
 */
async function recordNdpsCount(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const code = str(ctx.code), unit = str(ctx.unit), counted = Number(ctx.counted);
  if (!code || !unit) return { ...base, ok: false, status: 422, error: "code_and_unit_required", written: 0 };
  if (str(ctx.counted) === "" || !Number.isFinite(counted) || counted < 0) return { ...base, ok: false, status: 422, error: "counted_required", message: "Give the number actually counted.", written: 0 };
  if (!isControlledDrug(ctx.cfg, code, code)) return { ...base, ok: false, status: 422, error: "not_controlled", message: "This drug is not on the hospital's controlled-drug list.", written: 0 };
  const w = await witnessOrRefusal(ctx, ctx.actor && ctx.actor.id);
  if (w.error) return { ...base, ...w.error, written: 0 };
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return { ...base, ...error, written: 0 };
  let movements, dispenses;
  try { [movements, dispenses] = await Promise.all([svc.list("StockMovement", READ_CAP), svc.list("MedicationDispense", READ_CAP)]); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  if (movements.length >= READ_CAP || dispenses.length >= READ_CAP) return { ...base, ok: false, status: 409, error: "too_many_records", message: `More than ${READ_CAP} stock records exist, so the register quantity cannot be worked out safely. Nothing was recorded.`, written: 0 };
  const level = levelsFrom(movements, dispenses).levels.find((r) => k3(r.code, r.location, r.unit) === k3(code, ctx.location, unit));
  const expected = level ? level.level : 0;
  const r = await saveEntry({
    ...ctx, kind: "ndpscount", idempotencyKey: ctx.idempotencyKey,
    fields: { countedOn: str(ctx.countedOn) || new Date().toISOString().slice(0, 10), shift: ctx.shift, code, location: ctx.location, unit, counted, note: ctx.note },
    serverFields: { expected, variance: counted - expected },
    links: { witnessedBy: w.witnessId },
  });
  if (!r.ok) return { ...base, ...r };
  return { ...base, ok: true, written: 1, entry: r.entry, expected, counted, variance: counted - expected, discrepancy: counted !== expected,
    note: counted !== expected ? "The shelf and the register disagree. Nothing was adjusted: the pharmacist investigates and reconciles with a reason." : "The shelf matches the register." };
}

export { POLICY_NOTE, controlledSet, isControlledDrug, witnessOrRefusal, registerBook, ndpsRegister, recordNdpsCount, ndpsAnnual, form3eView, form3iFrom,
  NDPS_REGIMES, FORM3E_REGIMES, regimeOf, quarantineRefusal, estimateRefusal, form3hDayNumbers, rule65Register, ndpsPatientView };
