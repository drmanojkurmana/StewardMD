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

/**
 * The id ONE ordered test, on ONE encounter, is filed under. Anchored the same way a note is (the
 * GHIS episode when there is one, else the ticket), plus the service actually ordered — so a retried
 * or double-tapped request resolves to the SAME ServiceRequest instead of a second one, and two
 * DIFFERENT tests on one visit stay two separate orders.
 *
 * `null` when there is no anchor or no service id: an order that cannot name what was ordered is not
 * an order, and is never given a generated id to make it look like one.
 */
function serviceRequestIdForTicket(ticket, serviceId) {
  return anchoredOrderId(ticket, "order", serviceId);
}

/**
 * The id ONE prescribed drug, on ONE encounter, is filed under — the same rule as an investigation
 * order, with its own prefix so a drug id and a service id can never collide on one visit. A retried
 * or double-tapped Prescribe resolves to the SAME MedicationOrder; two DIFFERENT drugs on one visit
 * stay two separate orders.
 *
 * `null` when there is no anchor or no drug id, for the same reason: a prescription that cannot name
 * what was prescribed is not a prescription, and is never given a generated id to look like one.
 */
function medicationOrderIdForTicket(ticket, drugId) {
  return anchoredOrderId(ticket, "rx", drugId);
}

/** The shared rule both order ids use: anchor on the encounter, qualify by what was ordered. */
function anchoredOrderId(ticket, prefix, code) {
  const anchor = ticket && (ticket.ghisEpisodeId || ticket.id);
  const c = String(code == null ? "" : code).trim();
  if (!anchor || !c) return null;
  const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `opd-${prefix}-${slug(anchor)}-${slug(c)}`;
}

export { patientIdForMrn, patientIdForTicket, encounterIdForTicket, noteIdForTicket, serviceRequestIdForTicket, medicationOrderIdForTicket };
