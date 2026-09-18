/* functions/_wardsynq/payer-contracts.js - who is who on a hospital bill (gst-parties, 2026-09-17). PURE.
 *
 * FIVE PARTIES, NEVER ONE. The owner's binding guidance (2026-09-17, item 6) keeps them apart:
 *   PATIENT        receives the health care.
 *   PAYER          settles the bill: an insurer, a TPA, a government scheme or a corporate. No payer is self-pay.
 *   INSURER        the contractual insurance party.
 *   TPA            handles settlement as the insurer's agent (TTK Healthcare TPA), never a buyer of the care.
 *   GST RECIPIENT  the person liable to pay the consideration (s.2(93) CGST Act), read from the actual contract and
 *                  the nature of the supply, never from who transfers the money.
 *
 * THE RECIPIENT IS DETERMINED ON EACH PAYER CONTRACT. A payer is a connector (payer-connectors.js, Admin > Integrations
 * > Payers) and its contract is part of that record: the payer's kind, legal name and GSTIN, the insurer a TPA acts
 * for, and who the contract makes the GST recipient with the chartered accountant's basis. Choosing the contracting
 * party needs that basis (the opinion reference and date, or the contract clause). Nothing is silently defaulted:
 *   - an insurer or TPA with no determination: the patient, as ordinary cashless treatment (the owner's reading;
 *     Karnataka High Court, Healthcare Global Enterprises Ltd, April 2026), said as a default;
 *   - a government scheme, corporate or other payer with no determination: NOT DETERMINED, treated as the patient
 *     until the hospital chooses, with a warning on every screen that shows it;
 *   - a TPA's contracting party is the insurer it acts for, never the TPA.
 * The old hospital-wide gst.recipientOfCashlessClaims is read only as a migration default for a contract with no
 * determination, and only when it was the non-default "payer" (which needed the CA's opinion); the screens say so.
 * A saved "patient" is indistinguishable from the old default and is not taken as a determination.
 */

import { validateBuyer, isValidGstin, normalizeGstin } from "../_region_in.js";

const str = (v) => (v == null ? "" : String(v)).trim();

const PAYER_KINDS = Object.freeze(["insurer", "tpa", "government_scheme", "corporate", "other"]);
const RECIPIENT_CHOICES = Object.freeze(["patient", "contracting_party"]);
const BASIS_TYPES = Object.freeze(["ca_opinion", "contract_clause"]);

/* The contract as connector settings (connectors.js draws the Admin form from these). An empty select is "not recorded". */
const CONTRACT_FIELDS = Object.freeze([
  { key: "payerKind", label: "Kind of payer", type: "select", options: [["", "Not recorded"], ["insurer", "Insurer"], ["tpa", "TPA (acts for an insurer)"], ["government_scheme", "Government scheme (PM-JAY, State scheme, CGHS, ECHS)"], ["corporate", "Corporate"], ["other", "Other"]] },
  { key: "legalName", label: "Legal name", type: "text" },
  { key: "gstin", label: "GSTIN (if registered)", type: "text" },
  { key: "address1", label: "Registered address", type: "text" },
  { key: "location", label: "Place", type: "text" },
  { key: "pincode", label: "PIN code", type: "text" },
  { key: "stateCode", label: "State code (2 digits)", type: "text" },
  { key: "insurerRef", label: "Insurer this TPA acts for (its payer reference)", type: "text" },
  { key: "gstRecipient", label: "GST recipient under this contract (s.2(93) CGST Act)", type: "select", options: [["", "Not determined"], ["patient", "The patient"], ["contracting_party", "The contracting party (for a TPA, the insurer it acts for)"]] },
  { key: "gstBasisType", label: "Basis for the GST recipient", type: "select", options: [["", "None recorded"], ["ca_opinion", "Chartered accountant's opinion"], ["contract_clause", "Contract clause"]] },
  { key: "gstBasisRef", label: "Opinion reference, or contract and clause", type: "text" },
  { key: "gstBasisDate", label: "Date of the opinion or contract (YYYY-MM-DD)", type: "text" },
]);

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d));

/** PURE. The contract from a payer's settings, every absent or unknown value null. */
function contractOf(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const pick = (k, allowed) => (allowed.includes(str(s[k])) ? str(s[k]) : null);
  const basisType = pick("gstBasisType", BASIS_TYPES);
  return {
    payerKind: pick("payerKind", PAYER_KINDS), legalName: str(s.legalName) || null, gstin: str(s.gstin) ? normalizeGstin(s.gstin) : null,
    address1: str(s.address1) || null, location: str(s.location) || null, pincode: str(s.pincode) || null, stateCode: str(s.stateCode) || null,
    insurerRef: str(s.insurerRef) || null, gstRecipient: pick("gstRecipient", RECIPIENT_CHOICES),
    basis: basisType || str(s.gstBasisRef) ? { type: basisType, ref: str(s.gstBasisRef) || null, date: str(s.gstBasisDate) || null } : null,
  };
}

/** PURE. What is wrong with a contract as entered, as one sentence, or null. `ref` is the payer's own reference. */
function contractProblem(settings, ref) {
  const s = settings || {};
  const c = contractOf(s);
  if (str(s.gstin) && !isValidGstin(c.gstin)) return "The payer's GSTIN is not valid.";
  if (str(s.gstBasisDate) && !isDate(str(s.gstBasisDate))) return "The date of the opinion or contract is a date (YYYY-MM-DD).";
  if (c.payerKind === "tpa" && !c.insurerRef) return "A TPA acts for an insurer: give that insurer's payer reference.";
  if (c.insurerRef && str(c.insurerRef) === str(ref)) return "A TPA cannot act for itself.";
  if (c.gstRecipient !== "contracting_party") return null;
  if (!c.payerKind) return "Record the kind of payer before choosing the contracting party as the GST recipient.";
  if (!(c.basis && c.basis.type && c.basis.ref) || (c.basis.type === "ca_opinion" && !c.basis.date)) {
    return "Choosing the contracting party as the GST recipient needs its basis: your chartered accountant's opinion reference and date, or the contract and clause.";
  }
  if (c.payerKind === "tpa") return null;   // the insurer's own contract carries the recipient's details
  if (!c.legalName) return "The contracting party is the GST recipient, so its legal name is needed.";
  if (c.gstin) { const v = validateBuyer(buyerFields(c)); if (v.errors) return `The GST recipient's details: ${Object.values(v.errors).join(" ")}`; }
  return null;
}

const buyerFields = (c) => ({ gstin: c.gstin, kind: "payer", legalName: c.legalName, address1: c.address1, location: c.location, pincode: c.pincode, stateCode: c.stateCode });

const PATIENT_DEFAULT_BASIS = "Ordinary cashless treatment is a supply of health care to the patient; the insurer or TPA settles as payer.";

/**
 * PURE. The parties for a bill, a stay, a claim or a pre-authorisation settled by `payerRef`.
 * payers: the registry (payer-connectors.js payersFromConnectors, each with `contract`). gst: readGstSettings() output.
 * Returns { selfPay, payer, insurer, tpa, gstRecipient } where gstRecipient is
 *   { party: "patient" | "payer" | "insurer", ref?, name?, legalName?, gstin?, determined, source, basis, warning, buyer }
 * source: self_pay | contract | default_cashless | legacy_global | not_determined. buyer: the invoice buyer when the
 * recipient is the contracting party (null for the patient). warning: a code the screens translate, or null.
 */
function resolveParties({ payerRef, payers, gst }) {
  const ref = str(payerRef);
  const patient = (source, warning, basis) => ({ party: "patient", determined: source !== "not_determined", source, basis: basis || null, warning: warning || null, buyer: null });
  if (!ref) return { selfPay: true, payer: null, insurer: null, tpa: null, gstRecipient: patient("self_pay") };
  const list = Array.isArray(payers) ? payers : [];
  const find = (r) => list.find((p) => p && str(p.id) === str(r)) || null;
  const party = (p) => { const c = p.contract || contractOf(null); return { ref: str(p.id), name: str(p.name) || str(p.id), legalName: c.legalName, gstin: c.gstin, kind: c.payerKind }; };
  const p = find(ref);
  if (!p) return { selfPay: false, payer: { ref, name: null, legalName: null, gstin: null, kind: null, found: false }, insurer: null, tpa: null, gstRecipient: patient("not_determined", "payer_not_found") };
  const c = p.contract || contractOf(null);
  const kind = c.payerKind;
  const insurerRec = kind === "tpa" && c.insurerRef ? find(c.insurerRef) : null;
  const insurerOk = !!(insurerRec && insurerRec.contract && insurerRec.contract.payerKind === "insurer");
  const out = { selfPay: false, payer: party(p), insurer: kind === "insurer" ? party(p) : insurerOk ? party(insurerRec) : null, tpa: kind === "tpa" ? party(p) : null,
    ...(kind === "tpa" && !insurerOk ? { partiesWarning: "tpa_insurer_not_found" } : {}) };

  let choice = c.gstRecipient, source = "contract", basis = c.basis;
  if (!choice && gst && gst.recipientOfCashlessClaims === "payer") {
    choice = "contracting_party"; source = "legacy_global"; basis = { type: "ca_opinion", ref: gst.caOpinionRef || null, date: gst.caOpinionDate || null };
  }
  if (!choice && (kind === "insurer" || kind === "tpa")) { choice = "patient"; source = "default_cashless"; basis = { type: "default", ref: PATIENT_DEFAULT_BASIS, date: null }; }
  if (!choice) return { ...out, gstRecipient: patient("not_determined", kind ? "recipient_not_determined" : "payer_kind_not_recorded") };
  if (choice === "patient") return { ...out, gstRecipient: patient(source, null, basis) };

  /* The contracting party. For a TPA that is the insurer it acts for, never the TPA itself. */
  const who = kind === "tpa" ? (insurerOk ? insurerRec : null) : p;
  if (!who) return { ...out, gstRecipient: patient("not_determined", "tpa_insurer_not_found") };
  const wc = who.contract || contractOf(null);
  const legalName = wc.legalName || str(who.name) || str(who.id);
  let buyer = { gstin: "", kind: "payer", legalName, payerRef: str(who.id) };
  let warning = null;
  if (wc.gstin) {
    const v = validateBuyer({ ...buyerFields(wc), legalName });
    if (v.errors) warning = "recipient_details_incomplete";
    else buyer = { ...v.buyer, payerRef: str(who.id) };
  }
  return { ...out, gstRecipient: { party: kind === "tpa" ? "insurer" : "payer", ref: str(who.id), name: str(who.name) || str(who.id), legalName, gstin: wc.gstin || null,
    determined: true, source, basis, warning, buyer: warning ? null : buyer } };
}

/** PURE. The parties as a record keeps them: no buyer (the invoice holds that), stamped with when they were resolved. */
function partiesRecord(resolved, at) {
  const { buyer, ...recipient } = resolved.gstRecipient;
  return { ...resolved, gstRecipient: recipient, resolvedAt: at || null };
}

export { PAYER_KINDS, RECIPIENT_CHOICES, BASIS_TYPES, CONTRACT_FIELDS, contractOf, contractProblem, resolveParties, partiesRecord };
