/* functions/_pglog_enrol.js — NMC Logbook · getting people INTO a programme.
 * ===========================================================================
 * Every other screen in this module assumes a resident is already enrolled, with a guide. The
 * usability audit found that was the whole problem: residents called the logbook "a very hard,
 * strict framework" because they were stuck behind steps only an Academic Cell could take, and one
 * of those steps (assigning a guide) could not be taken by anyone at all.
 *
 * ONE enrol path, used by all four ways in:
 *   POST /enrol                      an Academic Cell enrols one person by email
 *   POST /enrol-bulk                 ... up to 100 residents at once
 *   POST /join-requests/:id/approve  the resident asked to join by institution code; staff approve
 *   GET  /me (pending invite)        an email enrolled before that person ever signed in
 * All four reach enrolOne(). A rule added here holds for every one of them.
 *
 * THE INVARIANTS THIS FILE KEEPS (vault/modules/NMC Logbook.md)
 *   - The role is never self-declared. It is written to q_members by someone else: the Academic
 *     Cell (enrol / bulk / invite) or an Academic Cell or HoD approving a request (join, and then
 *     ONLY pg_resident). A join request records a wish; it grants nothing.
 *   - Nobody assigns themselves: not a role (cannot_assign_self), not as a guide
 *     (cannot_assign_self_as_guide). A pending invite is resolved only against a VERIFIED email.
 *   - A guide must be a pg_faculty / pg_hod member of the SAME org, active, whose department scope
 *     covers the resident; otherwise they could not verify a single entry (the verify gate checks
 *     scope) and the resident would be stuck behind a guide who cannot act.
 *
 * FLAGS (env, default ON; "0" turns the feature off and restores the previous behaviour):
 *   PGLOG_INVITES        /enrol for an email with no account records a pending invite instead of
 *                        returning 404 no_such_account.
 *   PGLOG_JOIN_REQUESTS  the join-request routes.
 *
 * TESTABILITY: every function takes a trailing `deps`, same convention as _pglog_store.js.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import { getOrg, resolveOrgId, getMembership, setMembership, listMembers } from "./_opd_org_store.js";
import { lookupUidByEmail } from "./_fbadmin.js";
import { CAPS, can } from "./_queue_roles.js";
import M from "../pglog-model.js";
import * as S from "./_pglog_store.js";

const COL = { invite: "pg_invites", join: "pg_join_requests" };
export const ASSIGNABLE = ["pg_resident", "pg_faculty", "pg_hod", "academic_cell"];
export const GUIDE_ROLES = ["pg_faculty", "pg_hod"];
export const BULK_MAX = 100;
export const MAX_PENDING_JOIN = 3;
const INVITE_DAYS = 60;

const D = (deps) => Object.assign({
  fsGet, fsQuery, fsCommit, wCreate, wUpdate, qAudit, now: Date.now,
  getOrg, resolveOrgId, getMembership, setMembership, listMembers, lookupUidByEmail
}, deps || {});
const sanitize = S.sanitize;
const norm = S.norm;

export function invitesOn(env) { return String((env && env.PGLOG_INVITES) || "") !== "0"; }
export function joinRequestsOn(env) { return String((env && env.PGLOG_JOIN_REQUESTS) || "") !== "0"; }

// Errors carry a plain-language userMessage (no em-dash; this text is shown in the app).
function fail(code, status, userMessage, extra) {
  return Object.assign(new Error(code), { status, userMessage }, extra || {});
}
function clean(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "")); }
function withFb(uid) {
  const s = String(uid || "").trim();
  return /^(fb|ghis|cfa):/i.test(s) ? s : (s ? "fb:" + s : "");
}
async function audit(env, orgId, actor, action, meta, deps) {
  try { await D(deps).qAudit(env, { hospitalId: orgId || "", ticketId: "", actor: actor || "", action, meta: String(meta || "").slice(0, 200) }); } catch (e) {}
}
async function hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/* trainingYear was hard-coded to 1 by the enrol screen, so every resident enrolled mid-course read
 * as a first-year and their weekly cadence was measured from the wrong year. 1..3 (the length of
 * every PG programme PGMER-2023 recognises); absent means "leave it to the model's default". */
export function parseTrainingYear(v) {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 3) return { ok: false };
  return { ok: true, value: n };
}

/* The guide the enrolment names must be someone who can actually act as one. Returns the canonical
 * membership identity, "" for no guide, or throws. `soft` (pending-invite resolution) returns ""
 * instead of throwing, because an invite made weeks ago must not fail on a guide who has since left. */
export async function validateGuide(env, orgId, guide, opts, deps) {
  opts = opts || {};
  const d = D(deps);
  const raw = String(guide || "").trim();
  if (!raw) return "";
  try {
    const identity = withFb(raw);
    if (opts.residentIdentity && M.sameActor(identity, opts.residentIdentity)) {
      throw fail("guide_is_resident", 400, "A resident cannot be their own guide.");
    }
    const m = await d.getMembership(env, orgId, identity);
    if (!m || m.active === false || GUIDE_ROLES.indexOf(m.role) < 0) {
      throw fail("guide_not_faculty", 400,
        "The guide must be a faculty member or head of department at this institution.");
    }
    const scope = (m.scope && m.scope.departments) || [];
    if (opts.departmentId && scope.length && scope.indexOf(opts.departmentId) < 0) {
      throw fail("guide_out_of_scope", 400,
        "That faculty member is not in this resident's department, so they could not verify the entries. Pick a guide from the department.");
    }
    return m.identity || identity.toLowerCase();
  } catch (e) {
    if (opts.soft) return "";
    throw e;
  }
}

// The name a person carries in their StewardMD profile (users/<uid>/profile/self), when the uid is
// known in its original case. Best-effort; "" when absent.
export async function profileName(env, uid, deps) {
  const d = D(deps);
  const raw = String(uid || "").replace(/^(fb:|ghis:|cfa:)/, "");
  if (!raw) return "";
  try {
    const doc = await d.fsGet(env, "users/" + raw + "/profile/self");
    return S.cleanName(doc && doc.fields && doc.fields.name);
  } catch (e) { return ""; }
}

/* ── THE enrol path ───────────────────────────────────────────────────────────
 * input: {
 *   orgId, actorUid,          the caller, already gated by the router
 *   actorEmail?,              the caller's verified email (refuses self-invites)
 *   row: { identity? | email?, role, programmeId?, guide?, trainingYear?, startDate?, name?,
 *          departmentId?, unit?, rollNo? },
 *   assignable?,              allowlist of roles this entry point may grant (default ASSIGNABLE)
 *   deptScope?,               an HoD's recorded department scope: the programme must fall inside it
 *   protectExisting?,         refuse to re-role someone who already holds another pglog role
 *   allowInvite?,             an unknown email becomes a pending invite rather than a 404
 *   softGuide?,               an invalid guide is dropped instead of refusing (invite resolution)
 *   via?                      "enrol" | "bulk" | "join" | "invite", for the audit row
 * }
 * Returns { ok, identity, role, email, resident, pending?, invite? }.
 */
export async function enrolOne(env, input, deps) {
  const d = D(deps);
  const orgId = String(input.orgId || "");
  const actorUid = String(input.actorUid || "");
  const row = input.row || {};
  const assignable = input.assignable || ASSIGNABLE;
  const via = input.via || "enrol";

  const role = String(row.role || "pg_resident");
  if (assignable.indexOf(role) < 0) throw fail("role_not_assignable", 400, "That role cannot be assigned here.", { role });
  const ty = parseTrainingYear(row.trainingYear);
  if (!ty.ok) throw fail("training_year_invalid", 400, "Training year must be 1, 2 or 3.");

  let prog = null;
  if (row.programmeId) {
    prog = await S.getProgramme(env, row.programmeId, deps);
    if (!prog || prog.orgId !== sanitize(orgId)) throw fail("programme_not_found", 404, "That programme is not part of this institution.");
    const scope = input.deptScope || [];
    if (scope.length && (!prog.departmentId || scope.indexOf(prog.departmentId) < 0)) {
      throw fail("out_of_scope", 403, "That programme is outside your department.");
    }
  } else if (input.requireProgramme) {
    throw fail("programme_required", 400, "Choose the programme to enrol this resident in.");
  }

  // Who is being enrolled.
  let identity = withFb(row.identity);
  let email = String(row.email || "").trim().toLowerCase();
  let found = null;
  if (!identity) {
    if (!email) throw fail("email_required", 400, "Enter the person's email address.");
    if (!isEmail(email)) throw fail("email_invalid", 400, "That does not look like an email address.", { email });
    if (input.actorEmail && email === String(input.actorEmail).toLowerCase()) {
      throw fail("cannot_assign_self", 403, "You cannot change your own role here. Ask the institution's administrator.");
    }
    try { found = await d.lookupUidByEmail(env, email); } catch (e) { found = null; }
    if (!found || !found.uid) {
      if (!input.allowInvite) throw fail("no_such_account", 404, "Nobody has signed in to StewardMD with that email yet.", { email });
      const invite = await createInvite(env, orgId, Object.assign({}, row, { email, role, trainingYear: ty.value }), actorUid, prog, deps);
      return { ok: true, pending: true, identity: "", role, email, resident: null, invite };
    }
    identity = "fb:" + found.uid;
  }
  /* NOBODY RE-ROLES THEMSELVES. setMembership() is an upsert, so an Academic Cell enrolling their
   * own email as pg_hod would walk away holding the sign-off powers _queue_roles.js withholds. */
  if (M.sameActor(identity, actorUid)) {
    throw fail("cannot_assign_self", 403, "You cannot change your own role here. Ask the institution's administrator.");
  }

  const prev = await d.getMembership(env, orgId, identity);
  if (input.protectExisting && prev && prev.active !== false && prev.role &&
      prev.role !== role && prev.role !== "viewer") {
    throw fail("already_member", 409, "This person already holds another role at this institution. Change it from the staff list instead.", { role: prev.role });
  }

  // The existing training record, so a re-run (bulk re-upload, re-approval) never wipes a guide,
  // start date or year that was set since.
  const existing = prog ? await S.getResident(env, S.residentId(prog.id, identity), deps).catch(() => null) : null;
  const departmentId = row.departmentId || (existing && existing.departmentId) || (prog && prog.departmentId) || "";

  let guide = existing ? existing.guide : "";
  if (row.guide) {
    if (M.sameActor(row.guide, actorUid)) {
      if (!input.softGuide) throw fail("cannot_assign_self_as_guide", 403, "You cannot make yourself this resident's guide. Ask the head of department.");
    } else {
      guide = await validateGuide(env, orgId, row.guide, { residentIdentity: identity, departmentId, soft: input.softGuide }, deps) || guide;
    }
  }

  const name = S.cleanName(row.name) || (existing && existing.name) ||
    await profileName(env, identity, deps) || S.cleanName(found && found.name);

  const mem = await d.setMembership(env, orgId, identity, {
    role,
    // Only fill a name the org has not already recorded; the staff registry is theirs to edit.
    displayName: prev && prev.displayName ? undefined : (name || undefined)
  }, actorUid);
  if (mem && mem.ok === false) throw fail(mem.error || "membership_failed", 400, mem.message || "Could not add this person.");

  let resident = null;
  if (role === "pg_resident" && prog) {
    resident = await S.enrolResident(env, orgId, {
      uid: identity, programmeId: prog.id, departmentId,
      name, guide,
      coGuides: existing ? existing.coGuides : undefined,
      trainingYear: ty.value !== undefined ? ty.value : (existing ? existing.trainingYear : undefined),
      startDate: row.startDate || (existing && existing.startDate) || undefined,
      endDate: existing && !row.startDate ? existing.endDate : undefined,
      unit: row.unit !== undefined ? row.unit : (existing && existing.unit),
      smdId: existing && existing.smdId, batch: existing && existing.batch
    }, actorUid, deps);
  }
  // Someone enrolled directly is no longer "waiting to join".
  await closeJoinRequest(env, orgId, identity, actorUid, resident, deps);
  await audit(env, orgId, actorUid, "pglog:enrol:" + via, role + (resident ? " res" : ""), deps);
  return { ok: true, identity, role, email: email || (found && found.email) || "", resident };
}

/* ── pending invites ─────────────────────────────────────────────────────────
 * An Academic Cell has a list of emails, and most of the residents on it have never opened
 * StewardMD. Refusing those (no_such_account) made enrolment a chase: "sign in, then tell me, then I
 * will add you". The invite holds the SAME fields /enrol would have written, and is replayed through
 * enrolOne() the first time that person opens the logbook with that email VERIFIED. */
async function createInvite(env, orgId, row, actorUid, prog, deps) {
  const d = D(deps);
  const email = String(row.email || "").trim().toLowerCase();
  // Validate the guide now, so a typo is caught while the Academic Cell is looking at it.
  if (row.guide && M.sameActor(row.guide, actorUid)) {
    throw fail("cannot_assign_self_as_guide", 403, "You cannot make yourself this resident's guide. Ask the head of department.");
  }
  const guide = row.guide
    ? await validateGuide(env, orgId, row.guide, { departmentId: row.departmentId || (prog && prog.departmentId) }, deps)
    : "";
  const id = sanitize(orgId) + "__" + await hex(email);
  const at = d.now();
  const rec = {
    id, orgId: sanitize(orgId), email, role: row.role, programmeId: prog ? prog.id : "",
    guide, trainingYear: row.trainingYear || 0, startDate: M.isoDate(row.startDate) || "",
    name: S.cleanName(row.name), departmentId: clean(row.departmentId, 80), unit: clean(row.unit, 60),
    createdBy: actorUid, createdAt: at, expiresAt: at + INVITE_DAYS * 86400000,
    status: "pending", acceptedAt: 0, acceptedBy: ""
  };
  await d.fsCommit(env, [d.wUpdate(env, COL.invite + "/" + id, rec)]);
  await audit(env, orgId, actorUid, "pglog:invite:create", rec.role, deps);
  return publicInvite(rec);
}
export function publicInvite(r) {
  if (!r) return null;
  return { id: r.id, email: r.email, role: r.role, programmeId: r.programmeId || "", guide: r.guide || "",
           trainingYear: r.trainingYear || null, status: r.status, createdAt: r.createdAt, expiresAt: r.expiresAt };
}
export async function listInvites(env, orgId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.invite, { where: { field: "orgId", value: sanitize(orgId) }, limit: 500 });
  const now = d.now();
  return r.map((x) => x.fields).filter((f) => f.status === "pending" && (f.expiresAt || 0) > now)
    .map(publicInvite).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* Resolve every pending invite for this VERIFIED email. Called from /me. Never throws: a failure
 * here must not stop someone opening their logbook. Returns [{ orgId, role, residentId }]. */
export async function resolveInvites(env, actorUid, email, deps) {
  const d = D(deps);
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !actorUid) return [];
  let rows = [];
  try { rows = await d.fsQuery(env, COL.invite, { where: { field: "email", value: mail }, limit: 20 }); } catch (e) { return []; }
  const out = [];
  const now = d.now();
  for (const x of rows) {
    const inv = x.fields || {};
    if (inv.status !== "pending") continue;
    const path = COL.invite + "/" + sanitize(inv.id || x.id);
    const mark = async (patch) => { try { await d.fsCommit(env, [d.wUpdate(env, path, patch)]); } catch (e) {} };
    if ((inv.expiresAt || 0) <= now) { await mark({ status: "expired" }); continue; }
    // The authority to enrol is re-checked NOW: an Academic Cell member removed since the invite was
    // made no longer gets to hand out roles through it.
    try { await S.gate(env, inv.createdBy, inv.orgId, CAPS.PGLOG_CONFIGURE, null, deps); }
    catch (e) { if (e && (e.status === 403 || e.status === 404)) await mark({ status: "lapsed" }); continue; }
    try {
      const r = await enrolOne(env, {
        orgId: inv.orgId, actorUid: inv.createdBy,
        row: { identity: actorUid, role: inv.role, programmeId: inv.programmeId, guide: inv.guide,
               trainingYear: inv.trainingYear || undefined, startDate: inv.startDate || undefined,
               name: inv.name, departmentId: inv.departmentId, unit: inv.unit || undefined },
        assignable: ASSIGNABLE, protectExisting: true, softGuide: true, via: "invite"
      }, deps);
      await mark({ status: "accepted", acceptedAt: d.now(), acceptedBy: actorUid });
      out.push({ orgId: inv.orgId, role: inv.role, residentId: r.resident ? r.resident.id : "" });
    } catch (e) {
      // A definite refusal closes the invite; anything else (an outage) leaves it for next time.
      if (e && e.status >= 400 && e.status < 500) await mark({ status: "conflict", error: e.message });
    }
  }
  return out;
}

/* ── join requests ───────────────────────────────────────────────────────────
 * "Request to join" by institution code, so a resident is not stuck until an Academic Cell happens
 * to find them. It records a REQUEST. No membership, no role, no training record: those are written
 * only when an Academic Cell or HoD approves, through enrolOne(), as pg_resident and nothing else.
 * One request per (org, person): the document id is deterministic, so re-asking cannot spam. */
function joinId(orgId, uid) { return sanitize(orgId) + "__" + sanitize(norm(uid)); }
export function publicJoinRequestForStaff(r) {
  if (!r) return null;
  return { id: r.id, orgId: r.orgId, name: r.name || "", email: r.email || "", programmeHint: r.programmeHint || "",
           note: r.note || "", status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt || 0,
           reason: r.reason || "", programmeId: r.programmeId || "", residentId: r.residentId || "" };
}
export function publicJoinRequestForSelf(r) {
  if (!r) return null;
  return { id: r.id, status: r.status, orgName: r.orgName || "", orgCode: r.orgCode || "",
           programmeHint: r.programmeHint || "", createdAt: r.createdAt, decidedAt: r.decidedAt || 0,
           reason: r.status === "rejected" ? (r.reason || "") : "" };
}

export async function createJoinRequest(env, input, deps) {
  const d = D(deps);
  const actorUid = String(input.actorUid || "");
  if (!actorUid) throw fail("signin_required", 401, "Sign in to ask to join.");
  const code = String(input.orgCode || "").trim();
  if (!code) throw fail("org_code_required", 400, "Enter your institution's code (it looks like SMD-XXXXXX).");
  const orgId = await d.resolveOrgId(env, code);
  const org = orgId ? await d.getOrg(env, orgId) : null;
  if (!org) throw fail("org_not_found", 404, "No institution has that code. Check it with your department.");

  const m = await d.getMembership(env, org.id, actorUid);
  if (m && m.active !== false && m.role && m.role !== "viewer") {
    throw fail("already_member", 409, "You are already part of " + (org.name || "this institution") + ". Open the logbook with this institution.");
  }
  const id = joinId(org.id, actorUid);
  const cur = await d.fsGet(env, COL.join + "/" + id);
  if (cur && cur.fields && cur.fields.status === "pending") {
    return { existing: true, joinRequest: Object.assign({ id }, cur.fields) };
  }
  // A person can be waiting on at most MAX_PENDING_JOIN institutions at once.
  const mine = await d.fsQuery(env, COL.join, { where: { field: "requesterKey", value: norm(actorUid) }, limit: 50 });
  if (mine.filter((x) => x.fields && x.fields.status === "pending").length >= MAX_PENDING_JOIN) {
    throw fail("too_many_pending", 409, "You already have " + MAX_PENDING_JOIN + " requests waiting. Wait for one to be answered.");
  }
  const at = d.now();
  const rec = {
    id, orgId: org.id, orgName: clean(org.name, 120), orgCode: clean(org.code, 20),
    requester: actorUid, requesterKey: norm(actorUid),
    email: String(input.email || "").trim().toLowerCase().slice(0, 160),
    name: S.cleanName(input.name),
    programmeHint: clean(input.programmeHint, 120), note: clean(input.note, 300),
    status: "pending", createdAt: at, decidedAt: 0, decidedBy: "", reason: "", programmeId: "", residentId: ""
  };
  await d.fsCommit(env, [d.wUpdate(env, COL.join + "/" + id, rec)]);
  await audit(env, org.id, actorUid, "pglog:join:request", "", deps);
  // Tell the people who can act on it.
  try {
    const members = await d.listMembers(env, org.id);
    const staff = (members || []).filter((x) => x && x.active !== false &&
      (x.role === "academic_cell" || x.role === "pg_hod")).slice(0, 10);
    for (const s of staff) {
      await S.notify(env, { to: s.identity, orgId: org.id, kind: "join_request",
        text: "A resident has asked to join the logbook. Review it in Join requests." }, deps);
    }
  } catch (e) {}
  return { existing: false, joinRequest: rec };
}

export async function myJoinRequest(env, actorUid, deps) {
  const d = D(deps);
  if (!actorUid) return null;
  let r = [];
  try { r = await d.fsQuery(env, COL.join, { where: { field: "requesterKey", value: norm(actorUid) }, limit: 50 }); } catch (e) { return null; }
  const rows = r.map((x) => Object.assign({ id: x.id }, x.fields)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // A pending request is the one to show; otherwise the most recent answer.
  return rows.find((x) => x.status === "pending") || rows[0] || null;
}

export async function listJoinRequests(env, orgId, status, deps) {
  const d = D(deps);
  const want = status || "pending";
  const r = await d.fsQuery(env, COL.join, { where: { field: "orgId", value: sanitize(orgId) }, limit: 500 });
  return r.map((x) => Object.assign({ id: x.id }, x.fields))
    .filter((x) => want === "all" || x.status === want)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function getJoinRequest(env, id, deps) {
  const doc = await D(deps).fsGet(env, COL.join + "/" + sanitize(id));
  return doc && doc.fields ? Object.assign({ id: sanitize(id) }, doc.fields) : null;
}
async function loadJoin(env, id, orgId, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.join + "/" + sanitize(id));
  if (!doc || !doc.fields || doc.fields.orgId !== sanitize(orgId)) throw fail("not_found", 404, "That request no longer exists.");
  const jr = Object.assign({ id: sanitize(id) }, doc.fields);
  if (jr.status !== "pending") throw fail("join_request_not_pending", 409, "That request has already been answered.");
  return jr;
}

/* Approve: enrol the requester as pg_resident, through enrolOne(), exactly as /enrol would. The
 * approver's own gate is the router's; `deptScope` confines an HoD to their department's programmes. */
export async function approveJoinRequest(env, input, deps) {
  const d = D(deps);
  const jr = await loadJoin(env, input.id, input.orgId, deps);
  if (M.sameActor(jr.requester, input.actorUid)) throw fail("cannot_assign_self", 403, "You cannot approve your own request.");
  const body = input.body || {};
  const r = await enrolOne(env, {
    orgId: input.orgId, actorUid: input.actorUid,
    row: { identity: jr.requester, role: "pg_resident", programmeId: body.programmeId, guide: body.guide,
           trainingYear: body.trainingYear, startDate: body.startDate, name: body.name || jr.name,
           departmentId: body.departmentId, unit: body.unit },
    assignable: ["pg_resident"], requireProgramme: true, protectExisting: true,
    deptScope: input.deptScope, via: "join"
  }, deps);
  const at = d.now();
  const patch = { status: "approved", decidedAt: at, decidedBy: input.actorUid, reason: "",
                  programmeId: r.resident ? r.resident.programmeId : "", residentId: r.resident ? r.resident.id : "" };
  await d.fsCommit(env, [d.wUpdate(env, COL.join + "/" + jr.id, patch)]);
  await S.notify(env, { to: jr.requester, orgId: input.orgId, kind: "join_approved",
    text: "Your request to join " + (jr.orgName || "the institution") + " was approved. Open the logbook to start." }, deps);
  return Object.assign(r, { joinRequest: Object.assign({}, jr, patch) });
}

export async function rejectJoinRequest(env, input, deps) {
  const d = D(deps);
  const reason = clean(input.reason, 200);
  if (reason.length < 3) throw fail("reason_required", 400, "Say why, so the resident knows what to do next.");
  const jr = await loadJoin(env, input.id, input.orgId, deps);
  const patch = { status: "rejected", decidedAt: d.now(), decidedBy: input.actorUid, reason };
  await d.fsCommit(env, [d.wUpdate(env, COL.join + "/" + jr.id, patch)]);
  await audit(env, input.orgId, input.actorUid, "pglog:join:reject", "", deps);
  await S.notify(env, { to: jr.requester, orgId: input.orgId, kind: "join_rejected",
    text: "Your request to join " + (jr.orgName || "the institution") + " was not approved: " + reason }, deps);
  return Object.assign({}, jr, patch);
}

// Enrolled some other way: the request is answered, not left pending forever.
async function closeJoinRequest(env, orgId, identity, actorUid, resident, deps) {
  const d = D(deps);
  try {
    const id = joinId(orgId, identity);
    const doc = await d.fsGet(env, COL.join + "/" + id);
    if (!doc || !doc.fields || doc.fields.status !== "pending") return;
    await d.fsCommit(env, [d.wUpdate(env, COL.join + "/" + id, {
      status: "approved", decidedAt: d.now(), decidedBy: actorUid,
      programmeId: resident ? resident.programmeId : "", residentId: resident ? resident.id : "" })]);
  } catch (e) {}
}

/* ── bulk enrol ───────────────────────────────────────────────────────────── */
export async function enrolBulk(env, input, deps) {
  const rows = Array.isArray(input.rows) ? input.rows : null;
  if (!rows || !rows.length) throw fail("rows_required", 400, "Add at least one email.");
  if (rows.length > BULK_MAX) throw fail("too_many_rows", 400, "Up to " + BULK_MAX + " people at a time.");
  if (!input.programmeId) throw fail("programme_required", 400, "Choose the programme to enrol these residents in.");
  const seen = {};
  const results = [];
  for (const raw of rows) {
    const row = raw || {};
    const email = String(row.email || "").trim().toLowerCase();
    if (email && seen[email]) { results.push({ email, ok: false, status: "error", error: "duplicate_row", message: "This email appears twice in the list." }); continue; }
    if (email) seen[email] = 1;
    try {
      const r = await enrolOne(env, {
        orgId: input.orgId, actorUid: input.actorUid, actorEmail: input.actorEmail,
        row: { email, role: row.role || "pg_resident", programmeId: input.programmeId, guide: row.guide,
               trainingYear: row.trainingYear, startDate: row.startDate || input.startDate, name: row.name },
        assignable: ASSIGNABLE, allowInvite: invitesOn(env), via: "bulk"
      }, deps);
      results.push({ email, ok: true, status: r.pending ? "invited" : "enrolled", identity: r.identity || "",
                     residentId: r.resident ? r.resident.id : "", invite: r.invite || null });
    } catch (e) {
      if (!e || !e.status || e.status >= 500) {
        results.push({ email, ok: false, status: "error", error: "server_error", message: "Could not enrol this person right now. Try again." });
      } else {
        results.push({ email, ok: false, status: "error", error: e.message, message: e.userMessage || "" });
      }
    }
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return { ok: true, results, enrolled: count("enrolled"), invited: count("invited"), failed: count("error") };
}

export { COL as ENROL_COL, can };
