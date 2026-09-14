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
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate, wDelete } from "./_fbfirestore.js";
import * as M from "./_opd_org.js";
import { appendOrgAudit } from "./_q_audit_chain.js";

const now = () => Date.now();
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const newId = () => crypto.randomUUID().replace(/-/g, "");
const linkId = (groupId, orgId) => sanitize(groupId) + "__" + sanitize(orgId);
const event = (env, hospitalId, actor, action, meta) => ({ ts: now(), hospitalId: String(hospitalId || ""), ticketId: "", actor: String(actor || ""), action, meta: String(meta || "").slice(0, 200) });
/* G3: the audit row is hash-chained under its hospital and rides in the SAME commit as the change
 * (appendOrgAudit), so the guarantee above is unchanged; a refused guard is handed back as before. */
const commitAudited = (env, writes, ev) => appendOrgAudit(env, ev, writes);

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
    createdBy: String(o.createdBy || ""), createdAt: Number(o.createdAt) || 0, policy: policySubset(o.policy), policyVersion: Number(o.policyVersion) || 0, policyUpdatedAt: Number(o.policyUpdatedAt) || 0,
    staleAfterMinutes: Number(o.staleAfterMinutes) || 60 };
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
/* One row per (group, admin) beside the group doc, the way q_members holds one row per
 * (org, identity): Firestore cannot query inside the group's adminUids array, so the array stays
 * the membership truth (isGroupAdmin reads it) and these rows are the by-admin index for listing.
 * Row id mirrors q_members: sanitize(groupId) + "__" + sanitize(uid), written in the SAME commit
 * as the group change so an admin without its row (or a row without its admin) cannot exist. */
const adminRowId = (groupId, uid) => sanitize(groupId) + "__" + sanitize(uid);

export async function createGroup(env, name, actorId) {
  const id = newId();
  const a = String(actorId);
  const g = group({ id, name: String(name || "").trim().slice(0, 120), adminUids: [a], createdBy: a, createdAt: now() });
  await commitAudited(env, [wCreate(env, "q_groups/" + id, g),
    wCreate(env, "q_group_admins/" + adminRowId(id, a), { groupId: id, uid: a, addedBy: a, addedAt: g.createdAt })],
    event(env, "group:" + id, a, "group:create", g.name));
  return g;
}
/* ponytail: the by-admin index above only exists for groups created (or changed) since multi-admin
 * landed. Older groups have no q_group_admins rows, so the creator query stays as a fallback and
 * the two lists are merged, de-duplicated. Every hit is re-checked against the group's own
 * adminUids: a wedged row must never list a group its admin can no longer open. */
export async function listGroupsForAdmin(env, actorId) {
  const uid = String(actorId);
  const seen = new Map();
  const keep = (g) => { if (g && g.id && g.adminUids.includes(uid) && !seen.has(g.id)) seen.set(g.id, g); };
  const indexed = await fsQuery(env, "q_group_admins", { where: { field: "uid", value: uid }, limit: 50 });
  for (const r of indexed) {
    const gid = r.fields && r.fields.groupId;
    if (!gid) continue;
    const d = await fsGet(env, "q_groups/" + sanitize(gid));
    if (d) keep(group({ ...d.fields, id: String(gid) }));
  }
  const legacy = await fsQuery(env, "q_groups", { where: { field: "createdBy", value: uid }, limit: 50 });
  for (const x of legacy) keep(group({ ...x.fields, id: x.id }));
  return [...seen.values()];
}
/* Read the group WITH its updateTime: every admin change below guards its commit on the doc being
 * unchanged since this read, the same compare-and-set transition() uses for membership, so two
 * concurrent changes cannot silently drop an admin. */
async function readGroupForAdminChange(env, groupId) {
  const id = sanitize(groupId);
  if (!id) return { id: "", doc: null };
  return { id, doc: await fsGet(env, "q_groups/" + id) };
}
/* Name a second (or third) administrator. Adding someone already named is a no-op success. */
export async function addGroupAdmin(env, groupId, newUid, actorId) {
  const { id, doc } = await readGroupForAdminChange(env, groupId);
  if (!doc) return { ok: false, status: 404, error: "not_found", message: "The group could not be found." };
  const g = group({ ...doc.fields, id });
  const uid = String(newUid || "");
  if (!uid) return { ok: false, status: 422, error: "uid_required", message: "Name the administrator to add." };
  if (g.adminUids.includes(uid)) return { ok: true, group: g, noop: true };
  const next = [...g.adminUids, uid];
  const rowPath = "q_group_admins/" + adminRowId(id, uid);
  const rowDoc = await fsGet(env, rowPath);
  const rowWrite = rowDoc
    ? wUpdate(env, rowPath, { groupId: id, uid, addedBy: actorId, addedAt: now() }, { updateTime: rowDoc.updateTime })
    : wCreate(env, rowPath, { groupId: id, uid, addedBy: actorId, addedAt: now() });
  try {
    await commitAudited(env, [wUpdate(env, "q_groups/" + id, { adminUids: next }, { updateTime: doc.updateTime }),
      rowWrite], event(env, "group:" + id, actorId, "group:admin_add", uid.slice(0, 80)));
  } catch (e) {
    if (e && e.code === "precondition") return { ok: false, status: 409, error: "changed_meanwhile", message: "This group changed while you were looking at it. Nothing was saved. Reload and try again." };
    return { ok: false, status: 502, error: "not_saved", message: "The change could not be saved. Nothing was changed." };
  }
  return { ok: true, group: group({ ...g, adminUids: next }) };
}
/* Un-name an administrator, but never the last one: a group with nobody able to run it is a group
 * nobody can fix. An admin may remove themself while another remains; that is just this function
 * with targetUid === actorId, and needs no special case. */
export async function removeGroupAdmin(env, groupId, targetUid, actorId) {
  const { id, doc } = await readGroupForAdminChange(env, groupId);
  if (!doc) return { ok: false, status: 404, error: "not_found", message: "The group could not be found." };
  const g = group({ ...doc.fields, id });
  const uid = String(targetUid || "");
  if (!uid) return { ok: false, status: 422, error: "uid_required", message: "Name the administrator to remove." };
  if (!g.adminUids.includes(uid)) return { ok: false, status: 404, error: "not_an_admin", message: "That account is not an administrator of this group." };
  if (g.adminUids.length < 2) return { ok: false, status: 409, error: "last_admin", message: "A group always has at least one administrator. Add another administrator before removing this one." };
  const next = g.adminUids.filter((x) => x !== uid);
  const writes = [wUpdate(env, "q_groups/" + id, { adminUids: next }, { updateTime: doc.updateTime })];
  if (await fsGet(env, "q_group_admins/" + adminRowId(id, uid))) writes.push(wDelete(env, "q_group_admins/" + adminRowId(id, uid)));
  try {
    await commitAudited(env, writes, event(env, "group:" + id, actorId, "group:admin_remove", uid.slice(0, 80)));
  } catch (e) {
    if (e && e.code === "precondition") return { ok: false, status: 409, error: "changed_meanwhile", message: "This group changed while you were looking at it. Nothing was saved. Reload and try again." };
    return { ok: false, status: 502, error: "not_saved", message: "The change could not be saved. Nothing was changed." };
  }
  return { ok: true, group: group({ ...g, adminUids: next }) };
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
    await commitAudited(env, [write], event(env, orgId, actorId, "group:" + action, "group " + sanitize(groupId) + (side ? " by " + side : "")));
  } catch (e) {
    if (e && e.code === "precondition") return { ok: false, status: 409, error: "changed_meanwhile", message: "This membership changed while you were looking at it. Nothing was saved. Reload and try again." };
    return { ok: false, status: 502, error: "not_saved", message: "The change could not be saved. Nothing was changed." };
  }
  return { ok: true, link: link({ ...(cur || {}), ...fields }) };
}

export async function setPolicy(env, g, policy, actorId) {
  const subset = policySubset(policy);
  const fields = { policy: subset, policyVersion: g.policyVersion + 1, policyUpdatedAt: now() };
  await commitAudited(env, [wUpdate(env, "q_groups/" + sanitize(g.id), fields, { exists: true })],
    event(env, "group:" + g.id, actorId, "group:policy", "version " + fields.policyVersion + " keys " + (subset ? Object.keys(subset).join(",") : "none")));
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
  await commitAudited(env, [wUpdate(env, "q_orgs/" + sanitize(orgDoc.id), { wardsynq: merged.wardsynq })],
    event(env, orgDoc.id, actorId, "group:policy_adopted", "group " + g.id + " version " + g.policyVersion + " keys " + Object.keys(g.policy).join(",")));
  return { ok: true, org: merged, adopted: Object.keys(g.policy), policyVersion: g.policyVersion };
}

/* ---- D4 B (owner, 2026-09-14): a hospital PUBLISHES its counts; a group reads the published snapshot --------
 * WardSynQ is deployed per hospital, so a group overview cannot rely on reading every member's record live.
 * Each hospital's own admin publishes a snapshot of the same counts (hospital-group.js hospitalCounts, read in
 * that hospital's own tenant), stored as q_group_snapshots/<orgId> with who published it and when. The group
 * reads only that document. The snapshot write and its audit row under the hospital are one commit. */
export const STALE_DEFAULT_MIN = 60;
export function snapshotOf(orgId, d) {
  if (!d || !d.fields) return null;
  const f = d.fields;
  return { orgId: String(orgId), status: String(f.status || "unreadable"), counts: f.counts || {}, reasons: f.reasons || {}, capped: !!f.capped, why: f.why || null,
    publishedBy: String(f.publishedBy || ""), publishedAt: Number(f.publishedAt) || 0 };
}
export async function getSnapshot(env, orgId) {
  return snapshotOf(orgId, await fsGet(env, "q_group_snapshots/" + sanitize(orgId)));
}
export async function publishSnapshot(env, orgId, counts, actorId) {
  const t = now();
  const fields = { orgId: sanitize(orgId), status: counts.status, counts: counts.counts, reasons: counts.reasons || {}, capped: !!counts.capped, why: counts.why || null, publishedBy: String(actorId || ""), publishedAt: t };
  try {
    await fsCommit(env, [wUpdate(env, "q_group_snapshots/" + sanitize(orgId), fields), event(env, orgId, actorId, "group:snapshot_published", "status " + fields.status)]);
  } catch (e) {
    return { ok: false, status: 502, error: "not_saved", message: "The counts were not published. The groups still see the previous snapshot, with its own time." };
  }
  return { ok: true, snapshot: snapshotOf(orgId, { fields }) };
}
/** PURE. A snapshot older than the group's configured age is stale; none at all is "not published", never zero. */
export function snapshotView(snap, staleAfterMinutes, nowMs) {
  if (!snap) return { status: "not_published", counts: null, reasons: null, publishedAt: null, publishedBy: null, stale: false };
  const ageMinutes = Math.max(0, Math.floor((nowMs - snap.publishedAt) / 60000));
  return { status: snap.status, counts: snap.counts, reasons: snap.reasons, capped: snap.capped, why: snap.why, publishedAt: snap.publishedAt, publishedBy: snap.publishedBy,
    ageMinutes, stale: ageMinutes > (Number(staleAfterMinutes) || STALE_DEFAULT_MIN) };
}
export async function setStaleAfter(env, g, minutes, actorId) {
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 5 || n > 10080) return { ok: false, status: 422, error: "invalid_minutes", message: "Stale after must be a whole number of minutes from 5 to 10080." };
  try {
    await fsCommit(env, [wUpdate(env, "q_groups/" + sanitize(g.id), { staleAfterMinutes: n }, { exists: true }), event(env, "group:" + g.id, actorId, "group:stale_after", String(n))]);
  } catch (e) {
    return { ok: false, status: 502, error: "not_saved", message: "The setting was not saved." };
  }
  return { ok: true, group: group({ ...g, staleAfterMinutes: n }) };
}

/** The audit row for a group admin reading a hospital's counts, written BEFORE the counts are read. */
export async function auditSummaryRead(env, orgId, groupId, actorId) {
  await commitAudited(env, [], event(env, orgId, actorId, "group:summary_read", "group " + sanitize(groupId)));
}
