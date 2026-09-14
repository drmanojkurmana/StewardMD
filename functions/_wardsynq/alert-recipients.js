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
 * the unit, decided by the named level-2 nurse rule below; a hospital that wants none removes "nurse" here.
 * No responsible-clinician field exists on Encounter, so it is not a source until one does. */
const DEFAULT_LEVELS = Object.freeze({
  approval: Object.freeze({ approvedBy: "Dr Manoj Kurmana", approvedOn: "2026-09-14", decision: "O5" }),
  due: Object.freeze({ orderer: true, roles: Object.freeze(["doctor", "resident"]), contacts: Object.freeze([]) }),
  overdue: Object.freeze({ orderer: true, roles: Object.freeze(["supervisor", "nurse"]), contacts: Object.freeze([]) }),
  escalate: Object.freeze({ orderer: false, roles: Object.freeze([]), contacts: Object.freeze([]) }),
});

const str = (v) => (v == null ? "" : String(v).trim());
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : null);

/* OWNER DECISION 2026-09-14: which nurses the level-2 ("overdue") alert tells, as a named per-hospital rule
 * (wardsynq.criticalEscalation.level2NurseRule; absent = the default). Only one rule exists until a
 * Nurse-in-Charge role or assignment does; that rule is one new entry here and one new case in
 * level2NurseRecipients. A save naming any other rule is refused (level2NurseRuleRefusal). */
const LEVEL2_NURSE_RULES = Object.freeze({
  "all-on-duty-nurses-in-ward": "Every nurse marked on duty in the rota for the patient's ward. Applies until a Nurse-in-Charge role or assignment is implemented.",
});
const LEVEL2_NURSE_DEFAULT = "all-on-duty-nurses-in-ward";

/** PURE. The rule in force. A stored rule this build does not have is never followed silently: the default
 * applies (a critical result must still reach the ward's nurses) and the stored value is named. */
function level2NurseRuleOf(policy) {
  const raw = policy && typeof policy === "object" ? policy.level2NurseRule : undefined;
  const set = raw !== undefined && raw !== null && raw !== "";
  const known = set && Object.prototype.hasOwnProperty.call(LEVEL2_NURSE_RULES, raw);
  const rule = known ? raw : LEVEL2_NURSE_DEFAULT;
  return { rule, source: !set ? "default" : known ? "hospital" : "unrecognised", ...(set && !known ? { configured: str(raw).slice(0, 60) } : {}), note: LEVEL2_NURSE_RULES[rule] };
}

/** PURE. A sentence when a criticalEscalation being saved names a level-2 nurse rule this build does not have, else null. */
function level2NurseRuleRefusal(criticalEscalation) {
  const v = criticalEscalation && typeof criticalEscalation === "object" ? criticalEscalation.level2NurseRule : undefined;
  if (v === undefined || v === null || Object.prototype.hasOwnProperty.call(LEVEL2_NURSE_RULES, v)) return null;
  return `Level 2 nurse rule "${str(v).slice(0, 60)}" was not saved. The only rule built is "${LEVEL2_NURSE_DEFAULT}": every nurse on duty in the patient's ward. It applies until a Nurse-in-Charge role or assignment is implemented.`;
}

/**
 * THE ONE PLACE the level-2 nurses are decided, keyed by rule name.
 * ctx: { unit, active: Map(identity -> role), duty: [{identity, unit}] } where duty is the rota's on-duty list
 * for the unit. Both conditions are checked here, not trusted to the reader: ON DUTY (in the rota's on-duty
 * list) and IN THE AFFECTED WARD (the assignment's own unit is the patient's ward). A patient whose ward is
 * unknown keeps the ladder's hospital-wide rule (resolveRecipients), so no ward test is possible there.
 */
function level2NurseRecipients(rule, ctx) {
  switch (rule) {
    case "all-on-duty-nurses-in-ward":
      return [...new Set((ctx.duty || [])
        .filter((a) => a && ctx.active.get(str(a.identity)) === "nurse" && (!ctx.unit || str(a.unit) === ctx.unit))
        .map((a) => str(a.identity)))];
    default:
      throw new Error(`level-2 nurse rule "${rule}" has no resolver`);
  }
}

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
 * readers: { latest(type, id), members() -> [{identity, role, active}], onDuty(unit) -> {onDuty: [{identity, unit}]} }
 * Returns { recipients, reason?, unit, location: {ward, bed}, sources, nurseRule? }. nurseRule, when the level
 * reaches the level-2 tier and it lists "nurse": { rule, source, configured?, ward, nurses }.
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

  /* "nurse" on the level-2 tier is decided by the hospital's named rule (level2NurseRecipients); every other
   * role on a reached tier is everyone on duty in the unit with that role, as before. */
  const level2Nurses = LEVELS.indexOf(lv) >= 1 && levels.overdue.roles.includes("nurse");
  const roles = new Set(tiers.flatMap((t, i) => (LEVELS[i] === "overdue" && level2Nurses ? t.roles.filter((r) => r !== "nurse") : t.roles)));
  let onDuty = [], nurseRule = null;
  if (roles.size || level2Nurses) {
    const members = await readers.members();
    const active = new Map((members || []).filter((m) => m && m.active !== false).map((m) => [str(m.identity), str(m.role)]));
    const duty = ((await readers.onDuty(unit)) || {}).onDuty || [];
    onDuty = duty.map((a) => str(a.identity)).filter((id) => roles.has(active.get(id)));
    if (level2Nurses) {
      const r = level2NurseRuleOf(policy);
      const nurses = level2NurseRecipients(r.rule, { unit, active, duty });
      nurseRule = { rule: r.rule, source: r.source, ...(r.configured ? { configured: r.configured } : {}), ward: unit || null, nurses: nurses.length };
      onDuty = [...new Set([...onDuty, ...nurses])];
    }
  }
  const contacts = tiers.flatMap((t) => t.contacts);

  const ids = [...new Set([...(orderer ? [orderer] : []), ...onDuty, ...contacts])];
  return {
    recipients: ids.map((id) => `${orgId}~${id}`),
    ...(ids.length ? {} : { reason: "NO_RECIPIENT" }),
    unit: unit || null,
    location: { ward: unit || null, bed: str(encounter && encounter.location && encounter.location.bed) || null },
    sources: { orderer: orderer || null, onDuty: onDuty.length, contacts: contacts.length },
    ...(nurseRule ? { nurseRule } : {}),
  };
}

export { LEVELS, DEFAULT_LEVELS, LEVEL2_NURSE_RULES, levelsFor, nextLevel, level2NurseRuleOf, level2NurseRuleRefusal, level2NurseRecipients, resolveRecipients };
