/* functions/_wardsynq/alert-recipients.js — who a critical result is pushed to, at each level.
 *
 * S3 P0 (docs/emr-gap-analysis/S3_UNIFIED_WARD_APP_DESIGN.md section 3.3). PURE over injected readers:
 * nothing here knows about Firestore, KV or a push gateway, so the D12 move changes the readers and
 * not this file.
 *
 * THE LADDER IS CUMULATIVE. Each level adds people to the one before it: an overdue result is still
 * the ordering doctor's result, so they are told again with the supervisor, never replaced by them.
 *
 * NOBODY RESOLVED IS LOUD. An empty set comes back with reason NO_RECIPIENT, and the caller records
 * that on the loop instead of "sent". A quiet empty list is the failure this whole path exists to end.
 *
 * THE DEFAULTS ARE SIGNED OFF. The owner, Dr Manoj Kurmana, approved this default ladder on 2026-09-14
 * (owner decision O5, under D10), and the approval is recorded on the defaults themselves so a screen
 * can say who approved what. A hospital that sets its own levels under wardsynq.criticalEscalation.levels
 * owns that choice; the approval covers the defaults only.
 */

const LEVELS = Object.freeze(["due", "overdue", "escalate"]);

/* orderer: the clinician who placed the order the report answers (ServiceRequest.requesterId).
 * roles: member roles ON DUTY NOW in the patient's unit (the rota). contacts: named member identities.
 * There is no nurse-in-charge role in _queue_roles.js, so "nurse in charge" is the nurses on duty in
 * the unit; a hospital that wants it narrower removes "nurse" here. No responsible-clinician field
 * exists on Encounter, so it is not a source until one does. */
const DEFAULT_LEVELS = Object.freeze({
  approval: Object.freeze({ approvedBy: "Dr Manoj Kurmana", approvedOn: "2026-09-14", decision: "O5" }),
  due: Object.freeze({ orderer: true, roles: Object.freeze(["doctor", "resident"]), contacts: Object.freeze([]) }),
  overdue: Object.freeze({ orderer: true, roles: Object.freeze(["supervisor", "nurse"]), contacts: Object.freeze([]) }),
  escalate: Object.freeze({ orderer: false, roles: Object.freeze([]), contacts: Object.freeze([]) }),
});

const str = (v) => (v == null ? "" : String(v).trim());
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : null);

/** PURE. The hospital's levels over the defaults, per level and per field. The approval is never read
 * from the hospital: it describes the defaults, so it is carried only while nothing is overridden. */
function levelsFor(policy) {
  const set = policy && policy.levels && typeof policy.levels === "object" ? policy.levels : {};
  const out = { hospitalSet: false };
  for (const lv of LEVELS) {
    const d = DEFAULT_LEVELS[lv], h = set[lv] && typeof set[lv] === "object" ? set[lv] : null;
    if (h) out.hospitalSet = true;
    out[lv] = {
      orderer: h && typeof h.orderer === "boolean" ? h.orderer : d.orderer,
      roles: (h && list(h.roles)) || [...d.roles],
      contacts: (h && list(h.contacts)) || [...d.contacts],
    };
  }
  out.approval = out.hospitalSet ? null : DEFAULT_LEVELS.approval;
  return out;
}

/** PURE. The next level up, or null at the top. */
function nextLevel(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? "due" : LEVELS[i + 1] || null;
}

/**
 * Member identities, as `orgId~identity`, for a loop at a level.
 *
 * readers: { latest(type, id), members() -> [{identity, role, active}], onDuty(unit) -> {onDuty: [{identity}]} }
 * Returns { recipients, reason?, unit, location: {ward, bed}, sources }.
 */
async function resolveRecipients({ orgId, loop, level, policy }, readers) {
  const lv = LEVELS.includes(level) ? level : "due";
  const levels = levelsFor(policy);
  const tiers = LEVELS.slice(0, LEVELS.indexOf(lv) + 1).map((k) => levels[k]);

  let orderer = "";
  if (tiers.some((t) => t.orderer) && loop && loop.reportId) {
    const report = await readers.latest("DiagnosticReport", loop.reportId);
    const sr = report && report.serviceRequestId ? await readers.latest("ServiceRequest", report.serviceRequestId) : null;
    orderer = str(sr && sr.requesterId);
  }
  const encounter = loop && loop.encounterId ? await readers.latest("Encounter", loop.encounterId) : null;
  // A patient whose ward is unknown is covered by everyone on duty in the hospital, not by nobody.
  const unit = str(encounter && encounter.location && encounter.location.ward);

  const roles = new Set(tiers.flatMap((t) => t.roles));
  let onDuty = [];
  if (roles.size) {
    const members = await readers.members();
    const active = new Map((members || []).filter((m) => m && m.active !== false).map((m) => [str(m.identity), str(m.role)]));
    const duty = await readers.onDuty(unit);
    onDuty = ((duty && duty.onDuty) || []).map((a) => str(a.identity)).filter((id) => roles.has(active.get(id)));
  }
  const contacts = tiers.flatMap((t) => t.contacts);

  const ids = [...new Set([...(orderer ? [orderer] : []), ...onDuty, ...contacts])];
  return {
    recipients: ids.map((id) => `${orgId}~${id}`),
    ...(ids.length ? {} : { reason: "NO_RECIPIENT" }),
    unit: unit || null,
    location: { ward: unit || null, bed: str(encounter && encounter.location && encounter.location.bed) || null },
    sources: { orderer: orderer || null, onDuty: onDuty.length, contacts: contacts.length },
  };
}

export { LEVELS, DEFAULT_LEVELS, levelsFor, nextLevel, resolveRecipients };
