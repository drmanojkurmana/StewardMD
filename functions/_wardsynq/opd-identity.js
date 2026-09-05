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

/**
 * The encounter reference vitals already carry on their Observations (migrate-vitals.js). Kept
 * exactly as it was before this file existed — no extra sanitisation — so this extraction changes
 * no id any shadow-mode tenant might already have written.
 */
function encounterIdForTicket(ticket) {
  return ticket && ticket.ghisEpisodeId ? `opd-enc-${String(ticket.ghisEpisodeId).toLowerCase()}` : null;
}

/**
 * The id ONE evolving clinical note for one encounter is filed under. Anchored on the GHIS episode
 * when there is one, else the ticket itself, so a native (non-GHIS) visit still gets a stable id.
 * Every save of the SAME encounter's note is a new VERSION of this one id, never a new entity —
 * that is what makes a doctor's repeat save idempotent and what stops a concurrent save from
 * silently overwriting another: the store's own version check does that, on one shared id.
 */
function noteIdForTicket(ticket, kind) {
  const anchor = ticket && (ticket.ghisEpisodeId || ticket.id);
  if (!anchor) return null;
  const slug = String(anchor).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `opd-note-${slug}-${kind || "note"}`;
}

export { patientIdForMrn, patientIdForTicket, encounterIdForTicket, noteIdForTicket };
