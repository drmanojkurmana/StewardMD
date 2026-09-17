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
 * roles: member roles ON DUTY NOW in the patient's unit (the rota, and self-marked duty). contacts: named member
 * identities. There is no nurse-in-charge role in _queue_roles.js: "nurse" on the overdue tier is the ward-team
 * slot, decided by the named level-2 ward rule below; a hospital that wants none removes "nurse" here.
 * Encounter.attendingId (the doctor the patient is admitted under) is a source only for a patient with no ward (noWardCover). */
const DEFAULT_LEVELS = Object.freeze({
  approval: Object.freeze({ approvedBy: "Dr Manoj Kurmana", approvedOn: "2026-09-14", decision: "O5" }),
  due: Object.freeze({ orderer: true, roles: Object.freeze(["doctor", "resident"]), contacts: Object.freeze([]) }),
  overdue: Object.freeze({ orderer: true, roles: Object.freeze(["supervisor", "nurse"]), contacts: Object.freeze([]) }),
  escalate: Object.freeze({ orderer: false, roles: Object.freeze([]), contacts: Object.freeze([]) }),
});

const str = (v) => (v == null ? "" : String(v).trim());
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : null);

/* OWNER DECISION 2026-09-15, replacing the nurse-only default of 2026-09-14: the level-2 ("overdue") alert tells the
 * WARD TEAM ON DUTY NOW in the patient's ward (the nurses, the residents and the consultant there) and nobody who is
 * not on duty. A named per-hospital rule under wardsynq.criticalEscalation.level2WardRule; the earlier key
 * level2NurseRule is still read when the new one is absent, so a hospital that explicitly chose the nurse-only rule
 * keeps it. Absent both = the default. A save naming any other rule is refused (level2WardRuleRefusal).
 *
 * WHO IS WHICH: the groups below, by member role. There is no "consultant" role in _queue_roles.js: a consultant is
 * a doctor (or PG faculty / HoD). Interns are not in the ward team (owner follow-up). */
const WARD_TEAM_ROLES = Object.freeze({
  nurse: Object.freeze(["nurse"]),
  resident: Object.freeze(["resident", "pg_resident"]),
  consultant: Object.freeze(["doctor", "pg_faculty", "pg_hod"]),
});
const WARD_TEAM_GROUPS = Object.freeze(Object.keys(WARD_TEAM_ROLES));
/** PURE. The ward-team group a member role belongs to, or null. */
const wardTeamGroupOf = (role) => WARD_TEAM_GROUPS.find((g) => WARD_TEAM_ROLES[g].includes(str(role))) || null;

const LEVEL2_WARD_RULES = Object.freeze({
  "all-on-duty-ward-team": "Every nurse, resident and consultant on duty now in the patient's ward: on the rota for that ward now, or marked on duty there by themselves, and not marked off duty. Nobody off duty is told.",
  "all-on-duty-nurses-in-ward": "Every nurse on duty now in the patient's ward, and nobody off duty (the earlier nurse-only rule, kept for a hospital that chose it). Applies until a Nurse-in-Charge role or assignment is implemented.",
});
const LEVEL2_WARD_DEFAULT = "all-on-duty-ward-team";
const RULE_KEYS = Object.freeze(["level2WardRule", "level2NurseRule"]);
const isSet = (v) => v !== undefined && v !== null && v !== "";
const knownRule = (v) => typeof v === "string" && Object.prototype.hasOwnProperty.call(LEVEL2_WARD_RULES, v);

/** PURE. The rule in force and where it came from. A stored rule this build does not have is never followed silently:
 * the default applies (a critical result must still reach the ward) and the stored value is named. */
function level2WardRuleOf(policy) {
  const p = policy && typeof policy === "object" ? policy : {};
  const key = RULE_KEYS.find((k) => isSet(p[k])) || null;
  const known = !!key && knownRule(p[key]);
  const rule = known ? p[key] : LEVEL2_WARD_DEFAULT;
  return { rule, source: !key ? "default" : known ? "hospital" : "unrecognised", ...(key ? { key } : {}), ...(key && !known ? { configured: str(p[key]).slice(0, 60) } : {}), note: LEVEL2_WARD_RULES[rule] };
}

/** PURE. A sentence when a criticalEscalation being saved names a level-2 ward rule this build does not have, else null. */
function level2WardRuleRefusal(criticalEscalation) {
  const ce = criticalEscalation && typeof criticalEscalation === "object" ? criticalEscalation : {};
  const bad = RULE_KEYS.find((k) => ce[k] !== undefined && ce[k] !== null && !knownRule(ce[k]));
  if (!bad) return null;
  return `Level 2 ward rule "${str(ce[bad]).slice(0, 60)}" was not saved. The rules built are "all-on-duty-ward-team" (the default: every nurse, resident and consultant on duty in the patient's ward) and "all-on-duty-nurses-in-ward" (nurses only).`;
}

/**
 * PURE. Who is ON DUTY NOW: the one definition every recipient path uses.
 * ctx: { unit, duty: [{identity, unit}] (the rota's on-duty list), statuses: [{identity, status, unit, expiresAt}]
 * (people marking themselves on or off duty; expiresAt in ms), nowMs } -> [{identity, unit, via: "rota"|"self"}]
 *   DUTY: on the rota now, or an unexpired "on" the person set; an unexpired "off" overrides both.
 *   WARD: when the patient's ward is known, the rota assignment's own ward, or the ward the person chose, is it.
 */
function onDutyNow(ctx) {
  const now = Number(ctx.nowMs) || Date.now();
  const live = (ctx.statuses || []).filter((s) => s && Number(s.expiresAt) > now);
  const off = new Set(live.filter((s) => s.status === "off").map((s) => str(s.identity)));
  const out = new Map();
  const add = (identity, unit, via) => {
    const id = str(identity);
    if (!id || off.has(id)) return;
    if (ctx.unit && str(unit) !== ctx.unit) return;
    if (!out.has(id)) out.set(id, { identity: id, unit: str(unit), via });
  };
  for (const a of ctx.duty || []) if (a) add(a.identity, a.unit, "rota");
  for (const s of live) if (s.status === "on") add(s.identity, s.unit, "self");
  return [...out.values()];
}

/**
 * THE ONE PLACE the level-2 ward recipients are decided, keyed by rule name.
 * ctx: onDutyNow's ctx plus active: Map(identity -> role). Every condition is checked here, none trusted to a reader:
 * ROLE (an active member in one of the rule's groups), DUTY and WARD (onDutyNow). A patient whose ward is unknown
 * has no ward to test: NO_WARD_RULE (noWardCover) decides them instead.
 * -> [{identity, group, unit, via}]
 */
function level2WardRecipients(rule, ctx) {
  const team = (groups) => onDutyNow(ctx)
    .map((a) => ({ ...a, group: wardTeamGroupOf(ctx.active.get(a.identity)) }))
    .filter((a) => groups.includes(a.group));
  switch (rule) {
    case "all-on-duty-ward-team": return team(WARD_TEAM_GROUPS);
    case "all-on-duty-nurses-in-ward": return team(["nurse"]);
    case NO_WARD_RULE: return noWardCover(ctx).people;
    default: throw new Error(`level-2 ward rule "${rule}" has no resolver`);
  }
}

/* OWNER DECISION 2026-09-15, replacing hospital-wide on-duty cover for a patient with NO WARD recorded: "No ward: alert
 * the doctor the patient is admitted under, and the resident on duty." Not a hospital choice (never saveable as a ward
 * rule); it applies at every level wherever the ladder would have asked who is on duty. Nobody else on duty is told:
 * no nurse, no supervisor, no consultant other than the admitting doctor. The ordering clinician and named contacts are
 * told by name as on any result. */
const NO_WARD_RULE = "no-ward-admitting-doctor-and-residents";
const residentRole = (role) => WARD_TEAM_ROLES.resident.includes(str(role));

/**
 * PURE. Who covers a patient with no ward. ctx: onDutyNow's ctx plus active: Map(identity -> role), members: [{identity,
 * role, active, scope: {departments}}], admittingId (Encounter.attendingId), wards: [{name, departmentId}].
 *   ADMITTING DOCTOR: told unless an unexpired "off" says off duty (or they are no longer an active member); skipped is recorded with why.
 *   RESIDENTS (resident, pg_resident) ON DUTY NOW: when the admitting doctor's department is known (their membership scope),
 *   only those in it, by their own membership scope or by the ward they are on duty in; otherwise anywhere in the hospital.
 * -> { people: [{identity, group: "admitting"|"resident"}], cover: {admittingDoctor, admittingSkipped, residentScope, residents} }
 */
function noWardCover(ctx) {
  const now = Number(ctx.nowMs) || Date.now();
  const admitting = str(ctx.admittingId) || null;
  const rows = new Map((ctx.members || []).filter(Boolean).map((m) => [str(m.identity), m]));
  const deptsOf = (id) => (rows.get(id) && rows.get(id).scope && list(rows.get(id).scope.departments)) || [];
  let skipped = null;
  if (admitting) {
    const off = (ctx.statuses || []).find((s) => s && str(s.identity) === admitting && s.status === "off" && Number(s.expiresAt) > now);
    if (off) skipped = `marked off duty until ${new Date(Number(off.expiresAt)).toISOString()}`;
    else if (rows.has(admitting) && !ctx.active.has(admitting)) skipped = "not an active member of this hospital";
  }
  const depts = admitting ? deptsOf(admitting) : [];
  const wardDept = new Map((ctx.wards || []).filter(Boolean).map((w) => [str(w.name), str(w.departmentId)]));
  const inDept = (a) => deptsOf(a.identity).some((d) => depts.includes(d)) || depts.includes(wardDept.get(str(a.unit)));
  const residents = onDutyNow({ ...ctx, unit: "" })
    .filter((a) => residentRole(ctx.active.get(a.identity)) && (!depts.length || inDept(a)) && a.identity !== admitting);
  const people = [...(admitting && !skipped ? [{ identity: admitting, group: "admitting" }] : []), ...residents.map((a) => ({ identity: a.identity, group: "resident" }))];
  return { people, cover: { admittingDoctor: admitting, admittingSkipped: skipped, residentScope: depts.length ? "department" : "hospital", residents: residents.length } };
}

/** PURE. The sentence NO_RECIPIENT carries for a no-ward patient: which of the two owner-named sources were missing. */
function noWardWhy(c) {
  return `no ward, ${!c.admittingDoctor ? "no admitting doctor" : `admitting doctor ${c.admittingSkipped || "not reached"}`}, no resident on duty${c.residentScope === "department" ? " in the admitting doctor's department" : ""}`;
}

/** PURE. People per group, every group of the rule named (a zero is shown, not left out). */
function countsByGroup(rule, people) {
  const c = {};
  for (const g of rule === "all-on-duty-nurses-in-ward" ? ["nurse"] : WARD_TEAM_GROUPS) c[g] = 0;
  for (const p of people) if (p.group in c) c[p.group] += 1;
  return c;
}

/** PURE. Who the level-2 rule would tell NOW in `unit`, as counts: the ward board shows this before an alert happens. */
function wardAlertCover({ policy, members, duty, statuses, unit, nowMs }) {
  const r = level2WardRuleOf(policy);
  const active = new Map((members || []).filter((m) => m && m.active !== false).map((m) => [str(m.identity), str(m.role)]));
  const people = level2WardRecipients(r.rule, { unit: str(unit), active, duty, statuses, nowMs });
  return { rule: r.rule, source: r.source, ward: str(unit) || null, counts: countsByGroup(r.rule, people), total: people.length };
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
 * readers: { latest(type, id), members() -> [{identity, role, active}], onDuty(unit) -> {onDuty: [{identity, unit}]},
 * dutyStatuses?() -> {statuses: [{identity, status, unit, expiresAt}]}, wards?() -> [{name, departmentId}] }. Returns
 * { recipients, reason?, why?, unit, location: {ward, bed}, sources, wardRule? }. wardRule, when the level reaches the
 * level-2 tier and it lists "nurse" (the ward-team slot): { rule, source, key?, configured?, ward, counts: {group: n} };
 * for a patient with no ward, at any level that asks who is on duty: { rule: NO_WARD_RULE, ward: null, noWardCover }.
 */
async function resolveRecipients({ orgId, loop, level, policy, nowMs }, readers) {
  const lv = LEVELS.includes(level) ? level : "due";
  const levels = levelsFor(policy);
  const tiers = LEVELS.slice(0, LEVELS.indexOf(lv) + 1).map((k) => levels[k]);
  const now = Number(nowMs) || Date.now();

  let orderer = "";
  if (tiers.some((t) => t.orderer) && loop && loop.reportId) {
    const report = await readers.latest("DiagnosticReport", loop.reportId);
    const sr = report && report.serviceRequestId ? await readers.latest("ServiceRequest", report.serviceRequestId) : null;
    orderer = str(sr && sr.requesterId);
  }
  const encounter = loop && loop.encounterId ? await readers.latest("Encounter", loop.encounterId) : null;
  // A patient whose ward is unknown is covered by the admitting doctor and the residents on duty (noWardCover), not by nobody.
  const unit = str(encounter && encounter.location && encounter.location.ward);

  /* "nurse" on the level-2 tier is the ward-team slot, decided by the hospital's named rule (level2WardRecipients);
   * every other role on a reached tier is everyone on duty now in the unit with that role. */
  const level2 = LEVELS.indexOf(lv) >= 1 && levels.overdue.roles.includes("nurse");
  const roles = new Set(tiers.flatMap((t, i) => (LEVELS[i] === "overdue" && level2 ? t.roles.filter((r) => r !== "nurse") : t.roles)));
  let onDuty = [], wardRule = null, statuses = [];
  if ((roles.size || level2 || orderer) && readers.dutyStatuses) statuses = ((await readers.dutyStatuses()) || {}).statuses || [];
  if (roles.size || level2) {
    const members = await readers.members();
    const active = new Map((members || []).filter((m) => m && m.active !== false).map((m) => [str(m.identity), str(m.role)]));
    const duty = ((await readers.onDuty(unit)) || {}).onDuty || [];
    const ctx = { unit, active, duty, statuses, nowMs: now };
    if (!unit) {
      // No ward recorded (owner 2026-09-15): the admitting doctor and the residents on duty, and nobody else on duty.
      const admittingId = str(encounter && encounter.attendingId);
      const scoped = (members || []).some((m) => m && str(m.identity) === admittingId && m.scope && (list(m.scope.departments) || []).length);
      const nw = noWardCover({ ...ctx, members, admittingId, wards: scoped && readers.wards ? (await readers.wards()) || [] : [] });
      onDuty = nw.people.map((p) => p.identity);
      wardRule = { rule: NO_WARD_RULE, ward: null, noWardCover: nw.cover };
    } else {
      onDuty = onDutyNow(ctx).map((a) => a.identity).filter((id) => roles.has(active.get(id)));
      if (level2) {
        const r = level2WardRuleOf(policy);
        const team = level2WardRecipients(r.rule, ctx);
        wardRule = { rule: r.rule, source: r.source, ...(r.key ? { key: r.key } : {}), ...(r.configured ? { configured: r.configured } : {}), ward: unit, counts: countsByGroup(r.rule, team) };
        onDuty = [...new Set([...onDuty, ...team.map((a) => a.identity)])];
      }
    }
  }
  // The ordering clinician is told by name, but not while they have marked themselves off duty (owner 2026-09-15).
  if (orderer && statuses.some((s) => s && str(s.identity) === orderer && s.status === "off" && Number(s.expiresAt) > now)) orderer = "";
  const contacts = tiers.flatMap((t) => t.contacts);

  const ids = [...new Set([...(orderer ? [orderer] : []), ...onDuty, ...contacts])];
  return {
    recipients: ids.map((id) => `${orgId}~${id}`),
    ...(ids.length ? {} : { reason: "NO_RECIPIENT", ...(wardRule && wardRule.noWardCover ? { why: noWardWhy(wardRule.noWardCover) } : {}) }),
    unit: unit || null,
    location: { ward: unit || null, bed: str(encounter && encounter.location && encounter.location.bed) || null },
    sources: { orderer: orderer || null, onDuty: onDuty.length, contacts: contacts.length },
    ...(wardRule ? { wardRule } : {}),
  };
}

export { LEVELS, DEFAULT_LEVELS, LEVEL2_WARD_RULES, NO_WARD_RULE, noWardCover, noWardWhy, WARD_TEAM_ROLES, WARD_TEAM_GROUPS, wardTeamGroupOf, levelsFor, nextLevel, level2WardRuleOf, level2WardRuleRefusal, onDutyNow, level2WardRecipients, countsByGroup, wardAlertCover, resolveRecipients };
