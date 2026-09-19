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
 * The encounter reference vitals already carry on their Observations (migrate-vitals.js).
 *
 * WIDENED 2026-09-06 (the Encounter migration), two ways:
 *  1. A ticket with no GHIS episode — a native, non-GHIS visit — now falls back to the TICKET's own
 *     id, the same fallback `anchoredOrderId` below already uses for every order, prescription and
 *     result id. Before this, a native visit's encounterId was always null on every one of the five
 *     resource types that reference it, and an Encounter cannot be created for a null anchor — this
 *     is what lets a native visit get a real one too.
 *  2. The episode-id branch now runs through the SAME slug (`[^a-z0-9]+` -> "-") every sibling
 *     helper in this file already uses (`noteIdForTicket`, `anchoredOrderId`), rather than a plain
 *     lowercase with no character replacement. The two produce identical output for every episode id
 *     these functions have ever actually been called with in a test (letters, digits and hyphens
 *     only) and no tenant has ever run this in production to have written under the old spelling —
 *     unifying it removes a needless third convention rather than changing any real id.
 */
function encounterIdForTicket(ticket) {
  const anchor = ticket && (ticket.ghisEpisodeId || ticket.id);
  return anchor ? `opd-enc-${String(anchor).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
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

/**
 * The id ONE result — one lab render, one radiology study — on ONE encounter, is filed under.
 * `sourceKind` ("lab" | "rad") keeps the two apart the way "order"/"rx" already are; `sourceKey` is
 * GHIS's OWN stable key for that one result (a lab render id, a radiology resultid) — never a
 * timestamp, so a re-fetch of the SAME result resolves to the SAME DiagnosticReport and a change is
 * a new VERSION, not a new entity. `null` when there is no anchor or no source key: a result that
 * cannot name what it is a result OF is not a result.
 */
function diagnosticReportIdForTicket(ticket, sourceKind, sourceKey) {
  return anchoredOrderId(ticket, `dr-${sourceKind}`, sourceKey);
}

/** The shared rule every order/result id uses: anchor on the encounter, qualify by what it is. */
function anchoredOrderId(ticket, prefix, code) {
  const anchor = ticket && (ticket.ghisEpisodeId || ticket.id);
  const c = String(code == null ? "" : code).trim();
  if (!anchor || !c) return null;
  const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `opd-${prefix}-${slug(anchor)}-${slug(c)}`;
}

/* ---- inpatient ---------------------------------------------------------------------------------
 *
 * An ADMISSION is a different visit from an OPD ticket, so it gets its own encounter id rather than
 * reusing `opd-enc-`: reading `opd-enc-...` on a ward chart would be a lie about where the record
 * came from, and the two must never collide for the same patient.
 *
 * The id is derived from the MRN and the admission instant, so re-POSTing the same admission is
 * idempotent (the record service sees the same id and, with unchanged content, writes no new
 * version), while a genuine re-admission of the same patient is a DIFFERENT visit with its own id
 * and its own history. That is the same reasoning patientIdForMrn uses for identity.
 */
function admissionIdFor(mrn, admittedAt) {
  const m = slug(mrn);
  const at = slug(admittedAt);
  return m && at ? `wsq-adm-${m}-${at}` : null;
}

/**
 * One administration record per (order, scheduled dose time). Deterministic on purpose: it is what
 * makes a retried "administer" land on the SAME MedicationAdministration - which the state machine
 * then refuses, because ADMINISTERED has no legal transition out. A duplicate dose is prevented by
 * identity plus the state machine, not by a separate guard that could drift from either.
 */
function medicationAdministrationIdFor(orderId, dueAt) {
  const o = slug(orderId);
  const d = slug(dueAt);
  return o && d ? `wsq-mar-${o}-${d}` : null;
}

function slug(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export { patientIdForMrn, patientIdForTicket, encounterIdForTicket, noteIdForTicket, serviceRequestIdForTicket, medicationOrderIdForTicket, diagnosticReportIdForTicket, admissionIdFor, medicationAdministrationIdFor };
