// functions/_connect/abdm/consent-text.js — ABDM's PUBLISHED ABHA-enrolment consent language.
//
// Certification CRT_ABHA_102 is not "show something about consent". It is: display THE ABDM-published
// consent language, and RECORD the beneficiary's agreement. So the text lives here, verbatim, rather
// than being paraphrased in a template where a well-meaning edit would quietly fail the audit.
//
// SOURCE: sandboxcms.abdm.gov.in/uploads/Consent_Language_ABDM_1_25c394153b.png, linked from the
// official "Creation of ABHA Number / Consent Language" page. Transcribed 2026-08-19.
//
// The same page states three binding rules, and all three are implemented below:
//   1. "Private entities must remove the word 'government' from the consent."  StewardMD is a Digital
//      Solution Company, so the private wording is the default and the government wording is opt-in.
//   2. "Ensure that the second point is unchecked when ABHA is being created using Aadhaar."  Clause 2
//      is the create-without-Aadhaar route; in the Aadhaar flow it is an alternative, not an agreement.
//   3. "The beneficiary's name should reflect the patient's name dynamically."  The two attestations
//      interpolate the healthcare worker's and the patient's names.
//
// It also advises a double screen (one facing the patient) and the local language. Both are UI
// decisions, carried here as flags on the returned object so the client cannot forget them.

export const CONSENT_VERSION = "1.4";
export const CONSENT_CODE = "abha-enrollment";

// Each clause carries whether ABDM ticks it by default. `aadhaarUnchecked` marks the one clause the
// published note says must be UNCHECKED in the Aadhaar flow.
const CLAUSES = [
  {
    id: "aadhaar-auth",
    defaultChecked: true,
    text:
      "I am voluntarily sharing my Aadhaar Number / Virtual ID issued by the Unique Identification " +
      "Authority of India (“UIDAI”), and my demographic information for the purpose of creating an " +
      "Ayushman Bharat Health Account number (“ABHA number”) and Ayushman Bharat Health Account " +
      "address (“ABHA Address”). I authorize NHA to use my Aadhaar number / Virtual ID for performing " +
      "Aadhaar based authentication with UIDAI as per the provisions of the Aadhaar (Targeted Delivery of " +
      "Financial and other Subsidies, Benefits and Services) Act, 2016 for the aforesaid purpose. I " +
      "understand that UIDAI will share my e-KYC details, or response of “Yes” with NHA upon " +
      "successful authentication.",
  },
  {
    id: "non-aadhaar-route",
    defaultChecked: false,
    aadhaarUnchecked: true,
    text:
      "I intend to create Ayushman Bharat Health Account Number (“ABHA number”) and Ayushman Bharat " +
      "Health Account address (“ABHA Address”) using document other than Aadhaar. (Click here to " +
      "proceed further)",
  },
  {
    id: "link-records",
    defaultChecked: true,
    // "government" is stripped for a private integrator, per the published note.
    text: "I consent to usage of my ABHA address and ABHA number for linking of my legacy (past) {gov}health " +
      "records and those which will be generated during this encounter.",
  },
  {
    id: "share-records",
    defaultChecked: true,
    text:
      "I authorize the sharing of all my health records with healthcare provider(s) for the purpose of " +
      "providing healthcare services to me during this encounter.",
  },
  {
    id: "anonymised-public-health",
    defaultChecked: true,
    text: "I consent to the anonymization and subsequent use of my {gov}health records for public health purposes.",
  },
];

// The two attestations. Neither is pre-ticked: they are the act of agreeing, and a pre-ticked
// "I have explained this to the patient" is not an attestation, it is a default.
const ATTESTATIONS = [
  {
    id: "worker-explained",
    role: "worker",
    text: "I, {worker}, confirm that I have duly informed and explained the beneficiary of the contents of " +
      "consent for aforementioned purposes.",
  },
  {
    id: "beneficiary-agrees",
    role: "beneficiary",
    text: "I, {patient}, have been explained about the consent as stated above and hereby provide my consent " +
      "for the aforementioned purposes.",
  },
];

const fill = (t, vars) => String(t)
  .replace(/\{gov\}/g, vars.government ? "government " : "")
  .replace(/\{worker\}/g, vars.workerName || "(name of healthcare worker)")
  .replace(/\{patient\}/g, vars.patientName || "(beneficiary name)");

/**
 * The consent screen's content, ready to render.
 *
 * @param opts.flow          "aadhaar" (default) | "other" - selects which clause is pre-unchecked
 * @param opts.government    true only for a government integrator; StewardMD is private, so false
 * @param opts.workerName    the signed-in clinician, for the worker attestation
 * @param opts.patientName   the beneficiary, for their attestation
 */
export function enrolmentConsent(opts = {}) {
  const vars = {
    government: opts.government === true,
    workerName: opts.workerName,
    patientName: opts.patientName,
  };
  const aadhaarFlow = (opts.flow || "aadhaar") === "aadhaar";
  return {
    code: CONSENT_CODE,
    version: CONSENT_VERSION,
    heading: "I hereby declare that:",
    clauses: CLAUSES.map((c) => ({
      id: c.id,
      text: fill(c.text, vars),
      // In the Aadhaar flow the non-Aadhaar route must start unchecked (published note 2).
      defaultChecked: c.aadhaarUnchecked && aadhaarFlow ? false : c.defaultChecked,
    })),
    attestations: ATTESTATIONS.map((a) => ({ id: a.id, role: a.role, text: fill(a.text, vars), defaultChecked: false })),
    // Both advisories from the published page. Carried so the UI cannot silently drop them.
    advice: {
      doubleScreen: "Show this on a screen facing the patient so they can read it themselves.",
      localLanguage: "Offer this in the patient's own language where you can.",
    },
  };
}

/**
 * What must be true before an ABHA may be created. Every clause ABDM ticks by default has to be
 * agreed, and BOTH attestations must be made - the worker's and the beneficiary's.
 *
 * Returns { ok, missing:[ids] }. Fails closed: an unrecognised or absent agreement is not agreement.
 */
export function consentSatisfied(agreed, opts = {}) {
  const consent = enrolmentConsent(opts);
  const given = new Set(Array.isArray(agreed) ? agreed.map(String) : []);
  const required = consent.clauses.filter((c) => c.defaultChecked).map((c) => c.id)
    .concat(consent.attestations.map((a) => a.id));
  const missing = required.filter((id) => !given.has(id));
  return { ok: missing.length === 0, missing };
}

// ── recording the agreement (the second half of CRT_ABHA_102) ───────────────────────────────────────
// Displaying the language is only half the requirement; the agreement must be RECORDED, and the
// "Registration via Aadhaar OTP" page requires it collected BEFORE the Aadhaar OTP is requested. So the
// row is written first and its id gates /enrol/otp: consent that cannot be evidenced is not consent.

export const ENROL_CONSENT_TABLE = "connect_abdm_enrol_consent";

export class ConsentRecordError extends Error {}

/**
 * Record one beneficiary's agreement. Refuses an incomplete agreement rather than storing a half-tick
 * that would read, months later, as if the patient had consented.
 *
 * deps = { db, now }. Returns { id }.
 */
export async function recordEnrolConsent(deps, { tenantId, actor, patientRef, agreed, flow, government } = {}) {
  const { db } = deps || {};
  if (!db) throw new ConsentRecordError("consent store is not bound");
  if (!tenantId || !actor) throw new ConsentRecordError("tenant and actor are both required");
  const check = consentSatisfied(agreed, { flow, government });
  if (!check.ok) throw new ConsentRecordError("consent incomplete: " + check.missing.join(", "));

  const id = crypto.randomUUID();
  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  const res = await db.prepare(
    `INSERT INTO ${ENROL_CONSENT_TABLE} (id,tenant_id,actor,patient_ref,version,agreed,flow,created_at,used_at)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, tenantId, actor, patientRef || null, CONSENT_VERSION,
          JSON.stringify(agreed), flow || "aadhaar", now, null).run();
  if (!res || res.success === false) throw new ConsentRecordError("consent record insert failed");
  return { id };
}

/**
 * Claim a recorded consent for one enrolment. Single-use: a second enrolment must ask again, so one
 * patient's agreement can never be spent on another patient's ABHA.
 *
 * Returns the row. Throws when it does not exist, belongs to another tenant, or was already used.
 */
export async function claimEnrolConsent(deps, { tenantId, consentId } = {}) {
  const { db } = deps || {};
  if (!db) throw new ConsentRecordError("consent store is not bound");
  if (!consentId) throw new ConsentRecordError("consent is required before an Aadhaar OTP is requested");
  const row = await db.prepare(`SELECT * FROM ${ENROL_CONSENT_TABLE} WHERE id=?`).bind(consentId).first();
  if (!row || String(row.tenant_id) !== String(tenantId)) throw new ConsentRecordError("no such consent record");
  if (row.used_at) throw new ConsentRecordError("that consent has already been used; ask the patient again");
  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  const upd = await db.prepare(`UPDATE ${ENROL_CONSENT_TABLE} SET used_at=? WHERE id=? AND used_at IS NULL`)
    .bind(now, consentId).run();
  if (!upd || upd.success === false) throw new ConsentRecordError("consent claim failed");
  // A lost race means another request claimed it first - treat that as already-used, not as success.
  if ((upd.meta && upd.meta.changes) === 0) throw new ConsentRecordError("that consent has already been used; ask the patient again");
  return row;
}
