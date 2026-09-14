/* functions/_hospital_group_store.js — P2.14 hospital groups: the one entity above a hospital.
 *
 * A group is NOT a bigger org. It holds no staff, no patients and no clinical configuration of its
 * own, and it grants nobody anything inside a member hospital. It is a name, the StewardMD accounts
 * that administer it, and a consented list of hospitals whose AGGREGATE counts it may see side by
 * side (see _wardsynq/hospital-group.js and vault/decisions/Decisions.md for why only counts).
 *
 * STORED THE WAY ORGS ARE: q_groups/<id> beside q_orgs/<id>, and one link row per (group, hospital)
 * in q_group_links, the way q_members holds one row per (org, identity). A link row, not an array on
 * the group, because the hospital side has to find its own invitations by orgId, and Firestore
 * cannot query inside an array.
 *
 * A HOSPITAL IS A MEMBER ONLY WHEN BOTH SIDES SAID SO: the group admin invites ("invited"), and only
 * the hospital's own owner turns that into "member". Either side may end it ("removed"); the hospital
 * may refuse it ("declined"). Every change is committed TOGETHER with its audit event under the
 * hospital (q_events), in one commit, so a membership change without its audit row cannot exist -
 * qAudit's best-effort write is not enough for a change that decides what crosses a boundary. Every
 * change is also guarded on the row being unchanged since it was read.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import * as M from "./_opd_org.js";

const now = () => Date.now();
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const newId = () => crypto.randomUUID().replace(/-/g, "");
const linkId = (groupId, orgId) => sanitize(groupId) + "__" + sanitize(orgId);
const event = (env, hospitalId, actor, action, meta) => wCreate(env, "q_events/" + newId(),
  { ts: now(), hospitalId: String(hospitalId || ""), ticketId: "", actor: String(actor || ""), action, meta: String(meta || "").slice(0, 200) });

export const LINK_STATES = Object.freeze(["invited", "member", "declined", "removed"]);

/* THE ONLY PART OF A HOSPITAL'S CONFIGURATION A GROUP MAY RECOMMEND. Clinical-practice settings a
 * group of hospitals can sensibly share. Deliberately NOT here: anything that names this hospital's
 * own place or people (beds, resources, noteWriterRoles), its legal agreements (maik phiApproved,
 * patientAccess), its money (tariff, payment, payers) or its integrations and credentials (fhir, hl7,
 * dicom, transmitEndpoints, imagingViewer). Anything else a policy carries is dropped, not stored. */
export const POLICY_KEYS = Object.freeze(["criticalLimits", "criticalEscalation", "deltaLimits", "autoVerify", "labVerification",
  "marTimes", "marGraceMinutes", "highAlertDrugs", "orderSets", "noteTemplates", "riskTools", "advisories",
  "formulary", "requireReasonOffFormulary", "antibiotics", "chartCompletion", "edReassessMinutes", "approvalLevels", "approvalPolicy"]);

/** PURE. The recommended subset, or null when nothing recognised was sent. */
export function policySubset(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const out = {};
  for (const k of POLICY_KEYS) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
  return Object.keys(out).length ? out : null;
}

export function group(o = {}) {
  return { id: String(o.id || ""), name: String(o.name || ""), adminUids: Array.isArray(o.adminUids) ? o.adminUids.map(String).filter(Boolean) : [],
    createdBy: String(o.createdBy || ""), createdAt: Number(o.createdAt) || 0, policy: policySubset(o.policy), policyVersion: Number(o.policyVersion) || 0, policyUpdatedAt: Number(o.policyUpdatedAt) || 0 };
}
export function link(o = {}) {
  return { id: String(o.id || ""), groupId: String(o.groupId || ""), orgId: String(o.orgId || ""), state: LINK_STATES.includes(o.state) ? o.state : "removed",
    invitedBy: String(o.invitedBy || ""), invitedAt: Number(o.invitedAt) || 0, decidedBy: String(o.decidedBy || ""), decidedAt: Number(o.decidedAt) || 0 };
}
/** Group administration is for a StewardMD account named on the group. Staff sessions never qualify. */
export function isGroupAdmin(g, actor) { return !!(g && actor && actor.kind === "firebase" && actor.id && g.adminUids.includes(String(actor.id))); }

/** PURE. Which transition this side may make from this state. null = allowed. */
export function transitionProblem(action, state) {
  const allowed = { invite: [null, "declined", "removed"], accept: ["invited"], decline: ["invited"], remove: ["invited", "member"] }[action];
  if (!allowed) return "unknown_action";
  return allowed.includes(state || null) ? null : (action === "invite" ? "already_" + state : "not_" + (action === "remove" ? "invited_or_member" : "invited"));
}

export async function getGroup(env, groupId) {
  const id = sanitize(groupId); if (!id) return null;
  const d = await fsGet(env, "q_groups/" + id);
  return d ? group({ ...d.fields, id }) : null;
}
export async function createGroup(env, name, actorId) {
  const id = newId();
  const g = group({ id, name: String(name || "").trim().slice(0, 120), adminUids: [actorId], createdBy: actorId, createdAt: now() });
  await fsCommit(env, [wCreate(env, "q_groups/" + id, g), event(env, "group:" + id, actorId, "group:create", g.name)]);
  return g;
}
/* ponytail: lists by creator; adminUids can hold more than one account but no route adds a second
 * admin yet. Add a q_group_admins row per admin when one does, so this can query by admin. */
export async function listGroupsForAdmin(env, actorId) {
  const r = await fsQuery(env, "q_groups", { where: { field: "createdBy", value: String(actorId) }, limit: 50 });
  return r.map((x) => group({ ...x.fields, id: x.id })).filter((g) => g.adminUids.includes(String(actorId)));
}
export async function linksForGroup(env, groupId) {
  const r = await fsQuery(env, "q_group_links", { where: { field: "groupId", value: sanitize(groupId) }, limit: 200 });
  return r.map((x) => link({ ...x.fields, id: x.id }));
}
export async function linksForOrg(env, orgId) {
  const r = await fsQuery(env, "q_group_links", { where: { field: "orgId", value: sanitize(orgId) }, limit: 50 });
  return r.map((x) => link({ ...x.fields, id: x.id }));
}
export async function getLink(env, groupId, orgId) {
  const d = await fsGet(env, "q_group_links/" + linkId(groupId, orgId));
  return d ? { link: link({ ...d.fields, id: linkId(groupId, orgId) }), updateTime: d.updateTime } : { link: null, updateTime: null };
}

/**
 * One membership transition, with its audit row, in one guarded commit. The caller has already
 * decided WHO may make it (group admin or hospital owner); this decides whether the STATE allows it.
 */
export async function transition(env, action, groupId, orgId, actorId, side) {
  const { link: cur, updateTime } = await getLink(env, groupId, orgId);
  const problem = transitionProblem(action, cur && cur.state);
  if (problem) return { ok: false, status: 409, error: problem };
  const next = { invite: "invited", accept: "member", decline: "declined", remove: "removed" }[action];
  const t = now();
  const fields = action === "invite"
    ? { id: linkId(groupId, orgId), groupId: sanitize(groupId), orgId: sanitize(orgId), state: next, invitedBy: actorId, invitedAt: t, decidedBy: "", decidedAt: 0 }
    : { state: next, decidedBy: actorId, decidedAt: t };
  const path = "q_group_links/" + linkId(groupId, orgId);
  const write = cur ? wUpdate(env, path, fields, { updateTime }) : wCreate(env, path, fields);
  try {
    await fsCommit(env, [write, event(env, orgId, actorId, "group:" + action, "group " + sanitize(groupId) + (side ? " by " + side : ""))]);
  } catch (e) {
    if (e && e.code === "precondition") return { ok: false, status: 409, error: "changed_meanwhile", message: "This membership changed while you were looking at it. Nothing was saved. Reload and try again." };
    return { ok: false, status: 502, error: "not_saved", message: "The change could not be saved. Nothing was changed." };
  }
  return { ok: true, link: link({ ...(cur || {}), ...fields }) };
}

export async function setPolicy(env, g, policy, actorId) {
  const subset = policySubset(policy);
  const fields = { policy: subset, policyVersion: g.policyVersion + 1, policyUpdatedAt: now() };
  await fsCommit(env, [wUpdate(env, "q_groups/" + sanitize(g.id), fields, { exists: true }),
    event(env, "group:" + g.id, actorId, "group:policy", "version " + fields.policyVersion + " keys " + (subset ? Object.keys(subset).join(",") : "none"))]);
  return group({ ...g, ...fields });
}

/**
 * A member hospital adopting the group's recommendation: a COPY into its own configuration, merged one
 * level into org.wardsynq exactly as updateOrg merges, with the audit row under the hospital in the
 * same commit. Nothing is linked: a later policy change reaches no hospital until it adopts again.
 */
export async function adoptPolicy(env, orgDoc, g, actorId) {
  if (!g.policy) return { ok: false, status: 409, error: "no_policy", message: "This group has not published a recommended configuration." };
  const merged = M.org({ ...orgDoc, wardsynq: { ...(orgDoc.wardsynq || {}), ...g.policy } });
  await fsCommit(env, [wUpdate(env, "q_orgs/" + sanitize(orgDoc.id), { wardsynq: merged.wardsynq }),
    event(env, orgDoc.id, actorId, "group:policy_adopted", "group " + g.id + " version " + g.policyVersion + " keys " + Object.keys(g.policy).join(","))]);
  return { ok: true, org: merged, adopted: Object.keys(g.policy), policyVersion: g.policyVersion };
}

/** The audit row for a group admin reading a hospital's counts, written BEFORE the counts are read. */
export async function auditSummaryRead(env, orgId, groupId, actorId) {
  await fsCommit(env, [event(env, orgId, actorId, "group:summary_read", "group " + sanitize(groupId))]);
}
