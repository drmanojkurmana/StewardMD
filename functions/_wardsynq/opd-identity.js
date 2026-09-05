/* functions/_wardsynq/opd-identity.js — the ONE mapping from an OPD medical record number to the
 * WardSynQ patient id.
 *
 * Every OPD migration that needs to name a patient (vitals, registration, and whatever comes after)
 * must derive the SAME id from the SAME MRN, or a nurse's vitals and a registration would file under
 * two different "patients" for one real person. Before this file existed, migrate-vitals.js defined
 * the mapping privately; extracted here so registration and vitals are provably the same function,
 * not two copies that happen to agree today.
 */

/** PURE. `null` for an MRN that is empty or absent — never invented. */
function patientIdForMrn(mrn) {
  const m = String(mrn == null ? "" : mrn).trim();
  return m ? `opd-pat-${m.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
}

/** The id a queue ticket's vitals file under. */
function patientIdForTicket(ticket) {
  return patientIdForMrn(ticket && ticket.ghisPatientId);
}

export { patientIdForMrn, patientIdForTicket };
