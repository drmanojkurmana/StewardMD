/* functions/api/pglog/[[path]].js — NMC Logbook API (Cloudflare Pages Function).
 * ===========================================================================
 * The PG digital logbook required by PGMER-2023 5.2(vi)-(vii). Every route is authenticated with a
 * Firebase ID token and authorized through the EXISTING org-membership RBAC (q_members +
 * _queue_roles caps) — there is no parallel permission system here.
 *
 * THE FOUR RULES THIS ROUTER ENFORCES BEFORE ANYTHING ELSE
 * -------------------------------------------------------
 * 1. The actor is the verified token subject. `actorUid` comes from verifyFirebaseToken() and is
 *    passed to the store; a body field named actor/createdBy/verifiedBy/assessor is IGNORED. This
 *    is what makes pglog-model's self-verify throw real rather than decorative.
 * 2. Timestamps are the server's. The body may only carry occurredAt (when the work happened),
 *    which the model bounds to [programme start, today].
 * 3. Assessment templates are the SERVER's (_pglog_templates.js). A client-supplied template could
 *    inflate a mark, and a mark on a training record is a document PGMER-2023 9.2(c) penalises
 *    falsifying.
 * 4. Cross-resident reads are projected through publicEntry() — a department or institution view
 *    receives counts and categories, never a case reference or a diagnosis.
 *
 * KILL SWITCH: env PGLOG_OFF=1 returns 404 for everything except /ready, and 503 for the public
 * verification endpoint. There is no "enabled by env" gate because the data here is per-user and
 * cap-gated — availability is not the control that protects it, authorization is. The switch is for
 * an incident, so it covers the unauthenticated route too; nothing is revoked by flipping it, and
 * codes verify again when it is flipped back.
 *
 * Routes (all under /api/pglog):
 *   GET    /ready                              -> { ok, enabled, signing }        (unauth probe)
 *   GET    /v/:code                            -> PUBLIC, PHI-free signature verification
 *   GET    /me?orgId=                          -> { role, resident, programme, rotations, caps }
 *   GET    /programmes?orgId=                  POST /programmes            PATCH /programmes/:id
 *                                              DELETE /programmes/:id  (refused while enrolled)
 *   GET    /residents?orgId=&departmentId=...  POST /residents             PATCH /residents/:id
 *   GET    /rotations?residentId=              POST /rotations             PATCH /rotations/:id
 *   GET    /entries?residentId=&kind=&status=  POST /entries
 *   GET    /entries/:id                        PATCH /entries/:id          DELETE /entries/:id
 *   POST   /entries/:id/submit | /withdraw | /verify | /return | /amend
 *   GET    /faculty-roster?orgId=               -> people who can actually verify
 *   GET    /pending?orgId=                     -> the caller's verification queue
 *   GET    /assessments?residentId=            POST /assessments
 *   PATCH  /assessments/:id                    POST /assessments/:id/sign
 *   GET    /attestations?residentId=           POST /attest
 *   GET    /certificates?residentId=           POST /certificates          (open a certification)
 *   GET    /certificates/:id                   POST /certificates/:id/sign | /revoke
 *   GET    /config/:programmeId                PUT  /config/:programmeId
 *   GET    /dashboard/resident?residentId=     -> the aggregate "My NMC Logbook" needs
 *   GET    /dashboard/faculty?orgId=           -> pending, overdue, residents needing attention
 *   GET    /dashboard/dept?orgId=&departmentId= -> HOD / Academic Cell oversight
 *   GET    /notifications                      POST /notifications/:id/read
 *
 * Onboarding (functions/_pglog_enrol.js; every path goes through ONE enrolOne()):
 *   POST   /enrol                              { orgId, email, role, programmeId?, guide?, trainingYear?,
 *                                                startDate?, name? } -> enrolled, or a pending invite
 *   POST   /enrol-bulk                         { orgId, programmeId, rows:[{ email, guide?, trainingYear? }] }
 *   GET    /invites?orgId=                     pending invites (Academic Cell)
 *   POST   /join-request                       { orgCode, programmeHint?, note? }  any signed-in user
 *   GET    /join-request                       the caller's own request
 *   GET    /join-requests?orgId=&status=       academic_cell / pg_hod of that org
 *   POST   /join-requests/:id/approve | /reject
 */
import { verifiedClaimsFor, verifiedEmailOf } from "../../_fbauth.js";
import { CAPS, can } from "../../_queue_roles.js";
import { templateFor } from "../../_pglog_templates.js";
import * as S from "../../_pglog_store.js";
import * as V from "../../_pglog_verify.js";
import * as P from "../../_pglog_public.js";
import M from "../../../pglog-model.js";
import * as ORG from "../../_opd_org_store.js";
import * as E from "../../_pglog_enrol.js";

const json = (obj, status = 200, extra) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extra || {})
});
function enabled(env) { return String((env && env.PGLOG_OFF) || "") !== "1"; }

// Errors carry a {status}; anything else is a 500 with no internals leaked to the client.
function fail(e) {
  const status = (e && e.status) || (e && e.code === "precondition" ? 409 : 0);
  const known = {
    pglog_self_verify_forbidden: [403, "You cannot verify your own logbook entry."],
    pglog_self_assess_forbidden: [403, "You cannot assess yourself."],
    pglog_verified_immutable: [409, "A verified entry cannot be edited or deleted. Use amend, which keeps the original."],
    pglog_return_reason_required: [400, "Say what needs correcting."],
    pglog_amend_reason_required: [400, "An amendment to a verified record needs a reason."],
    pglog_amend_only_verified: [409, "Only a verified entry is amended; edit the draft instead."],
    pglog_delete_reason_required: [400, "A reason is required."],
    pglog_assessment_incomplete: [400, "Score every criterion — a blank is not a zero."],
    pglog_discussed_required: [400, "Record whether this was discussed with the trainee."],
    pglog_action_plan_required: [400, "A remediation outcome needs an action plan."],
    pglog_already_signed: [409, "Already signed."],
    pglog_not_submitted: [409, "This entry is not awaiting verification."],
    pglog_already_verified: [409, "Already verified."],
    pglog_deleted: [410, "This entry was deleted."],
    pglog_actor_required: [401, "Sign in required."],
    pglog_submitted_withdraw_first: [409, "This entry is with your guide for verification. Withdraw it first to correct it."],
    pglog_not_author: [403, "Only the author can withdraw an entry."],
    signer_unverified: [403, "Verify your medical council registration before signing a logbook record."],
    signer_verification_pending: [403, "Your medical registration is still under review."],
    signer_verification_rejected: [403, "Your medical registration was not verified."],
    signer_no_registration_number: [403, "Your verified account carries no registration number."],
    signer_unidentified: [401, "Sign in again before signing a logbook record."],
    signer_check_unavailable: [503, "Your registration could not be checked. Nothing was signed."],
    pglog_cert_already_issued: [409, "This certification is already issued."],
    pglog_cert_already_signed_by_you: [409, "You have already signed this logbook."],
    pglog_cert_registration_required: [403, "A certificate signature needs a verified medical registration number."],
    pglog_self_certify_forbidden: [403, "You cannot certify your own logbook."],
    pglog_cert_revoked: [410, "This certification was revoked."],
    pglog_cert_superseded: [409, "This certification was superseded because the logbook changed."],
    pglog_cert_revoke_reason_required: [400, "A reason is required to revoke a certificate."],
    pglog_cert_nothing_to_certify: [400, "There are no verified entries to certify yet."],
    pglog_cert_content_changed: [409, "The logbook changed after this certification was opened, so it was not issued."],
    hod_required: [403, "Only the head of department can do that."],
    not_the_named_supervisor: [403, "You are not this resident's guide and you are not named on this entry, so you cannot sign it."],
    supervisor_unresolved: [400, "That supervisor is not on your department's faculty list, so nobody would receive this entry to verify."]
  };
  const k = known[e && e.message];
  if (k) return json({ error: e.message, message: k[1] }, k[0]);
  if (status) {
    // `detail` stays in the LOG, never in the response: for an fs_* error it is 300 characters of the
    // Firestore REST body (document paths, the project id), and for e403 it is the capability name,
    // which maps the permission model for free. `errors` is our own validation output and is safe.
    try { if (e && e.detail) console.warn("[pglog]", e.message, String(e.detail).slice(0, 300)); } catch (_) {}
    return json({ error: (e && e.message) || "error", message: e && e.userMessage, errors: e && e.errors,
                  email: e && e.email, role: e && e.role }, status);
  }
  try { console.warn("[pglog]", e && e.message, e && e.stack); } catch (_) {}
  return json({ error: "server_error" }, 500);
}


// Resolve the caller's role in an org once per request.
async function context(request, env, orgId) {
  // verifiedClaimsFor() is the same verification verifyFirebaseToken() runs, memoised per request, so
  // a route that also needs the verified email (/me, /enrol, /join-request) verifies the token once.
  const claims = await verifiedClaimsFor(request, env);
  const uid = claims && claims.sub;
  if (!uid) throw Object.assign(new Error("signin_required"), { status: 401 });
  const actorUid = "fb:" + uid;
  if (!orgId) return { uid, actorUid, orgId: "", role: "viewer" };
  /* Accept EITHER the SMD-XXXXXX institution code a human was handed, or the internal org id.
   * These were never reconciled: screenSetup() asks for "Institution code (SMD-XXXXXX)" and stores
   * it as orgId, while every store call keys on the internal id and getOrg() is a direct document
   * fetch. So a resident who typed exactly what their department told them got org_not_found, and
   * the whole enrolment path was unreachable. resolveOrgId() passes a real id straight through, so
   * this is a no-op for callers that already had one. */
  const canonical = (await ORG.resolveOrgId(env, orgId)) || orgId;
  const g = await S.gate(env, actorUid, canonical, null);
  return { uid, actorUid, orgId: canonical, role: g.role, owner: g.owner, org: g.org, member: g.member };
}

/* Read guard for one resident's logbook. Returns the AUDIENCE, which decides how much of each record
 * publicEntry()/publicAssessment() will hand over — "self" / "verifier" / "hod" see clinical detail,
 * "aggregate" sees counts and categories only.
 *
 * ORDERED BY NAMED RESPONSIBILITY, NOT BY CAPABILITY BREADTH. That distinction is the whole guard,
 * and it has now been got wrong twice:
 *
 *   - The first version had both faculty branches return "verifier", so any faculty member anywhere
 *     in the institution could read any resident's case references, diagnoses, remarks and
 *     reflections (R1, finding C5).
 *   - The fix then tested PGLOG_VIEW_DEPT FIRST. But `academic_cell` and `admin` also hold
 *     PGLOG_VIEW_DEPT, so they entered the department branch and never reached the
 *     PGLOG_VIEW_INSTITUTION -> "aggregate" line below it, which was dead code. Institution-wide
 *     oversight read every trainee's clinical detail, and the role comment in _queue_roles.js
 *     promising otherwise was simply false.
 *
 * So: ask who this person IS to this resident, in order of narrowness, and let breadth of capability
 * decide only whether they may look at all.
 */
export async function canReadResident(env, ctx, resident, entry) {
  if (!resident) throw Object.assign(new Error("not_found"), { status: 404 });
  if (M.sameActor(ctx.actorUid, resident.uid)) return "self";
  const role = ctx.role;
  const mine = S.norm(ctx.actorUid);

  // 1. NAMED for this resident: their guide or co-guide (the person 5.2(vii) makes responsible for
  //    this logbook), or the supervisor named on the specific entry being opened.
  if (can(role, CAPS.PGLOG_VIEW_ASSIGNED)) {
    if (S.norm(resident.guide) === mine || (resident.coGuides || []).some((g) => S.norm(g) === mine)) return "verifier";
    if (entry && S.norm(entry.supervisor) === mine) return "verifier";
  }

  // 2. Head of THIS resident's department. An institution-wide role does not become a department
  //    head by also holding the department cap, so this requires the resident to actually be IN a
  //    department and the caller's role to be the departmental one.
  if (role === "pg_hod" && can(role, CAPS.PGLOG_VIEW_DEPT) && resident.departmentId) {
    const scope = (ctx.member && ctx.member.scope && ctx.member.scope.departments) || [];
    // An empty scope means whole-org membership throughout this app (_opd_org.js), so it is honoured
    // here too — but only for the departmental role, never as a side door for admin or the cell.
    if (!scope.length || scope.indexOf(resident.departmentId) > -1) return "hod";
    return "aggregate";
  }

  // 3. Everyone else who may look at all — Academic Cell institution-wide oversight (5.2(iv) "ensure
  //    and monitor"), a technical admin, a faculty member who is not this resident's guide. Whether
  //    training is being DELIVERED is a completeness question, and completeness is answered by counts.
  if (can(role, CAPS.PGLOG_VIEW_INSTITUTION) || can(role, CAPS.PGLOG_VIEW_DEPT) ||
      can(role, CAPS.PGLOG_VIEW_ASSIGNED)) return "aggregate";

  throw Object.assign(new Error("forbidden"), { status: 403, detail: "read_resident" });
}

/* The caller's verification queue: entries naming them (or routed to them as the guide), plus, for a
 * head of department, the entries nobody is named on in their department(s). */
async function pendingQueue(env, ctx) {
  const rows = await S.pendingForFaculty(env, ctx.orgId, ctx.actorUid);
  if (ctx.role !== "pg_hod") return rows;
  const seen = {};
  rows.forEach((e) => { seen[e.id] = 1; });
  const extra = (await S.pendingUnassigned(env, ctx.orgId, scopeOf(ctx))).filter((e) => !seen[e.id]);
  return rows.concat(extra).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
}
// The departments a membership is confined to; [] means whole-org, as everywhere in this app.
function scopeOf(ctx) { return (ctx && ctx.member && ctx.member.scope && ctx.member.scope.departments) || []; }
// Who may answer a join request: an Academic Cell (CONFIGURE, institution-wide) or an HoD (confined
// to the programmes of their own department scope by enrolOne's deptScope).
function mayDecideJoin(ctx) { return can(ctx.role, CAPS.PGLOG_CONFIGURE) || ctx.role === "pg_hod"; }
function joinScope(ctx) { return can(ctx.role, CAPS.PGLOG_CONFIGURE) ? [] : scopeOf(ctx); }
async function callerEmail(request, env) {
  try { return verifiedEmailOf(await verifiedClaimsFor(request, env)) || ""; } catch (e) { return ""; }
}
async function callerName(request, env, uid) {
  const fromProfile = await E.profileName(env, uid);
  if (fromProfile) return fromProfile;
  try { return S.cleanName(((await verifiedClaimsFor(request, env)) || {}).name); } catch (e) { return ""; }
}

export async function onRequest(context_) {
  const { request, env } = context_;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/pglog\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const seg = parts[0] || "", id = parts[1] || "", action = parts[2] || "";
  const method = request.method.toUpperCase();
  const q = (k) => url.searchParams.get(k) || "";

  if (method === "GET" && seg === "ready") {
    return json({ ok: true, enabled: enabled(env), v: M.VERSION, signing: V.signingConfigured(env) });
  }

  /* ── PUBLIC verification: GET /api/pglog/v/<code> ─────────────────────────────
   * UNAUTHENTICATED BY DESIGN. An examiner holding a printed logbook has no StewardMD account, and
   * requiring one would make the QR useless for the only person it exists for.
   *
   * What that means for what it may return: NOTHING that is not already on the paper in their hand.
   * The resident's name and StewardMD ID, the programme, the KIND of activity and its date, the
   * signer's name and registration number, and whether the record still stands. No case reference,
   * no diagnosis, no remarks, no reflection, no uid, no email, no entry ids.
   *
   * Rate-limited per IP: the code space is 80 bits, so enumeration is hopeless, but an unlimited
   * unauthenticated endpoint is a free amplifier regardless.
   *
   * INSIDE the kill switch. The header above promises PGLOG_OFF=1 takes the module down, and an
   * operator flipping it is usually responding to an incident — a kill switch that leaves the one
   * unauthenticated endpoint serving would be a lie at the worst possible moment. Codes verify again
   * when the module is re-enabled; nothing is revoked by the switch. */
  if (method === "GET" && seg === "v" && id) {
    if (!enabled(env)) return json({ ok: false, status: "unavailable",
      message: "Verification is temporarily unavailable. Nothing is implied about this record." }, 503);
    const r = await P.resolve(env, request, id);
    return json(r.body, r.status, r.retryAfter ? { "Retry-After": String(r.retryAfter) } : null);
  }
  if (!enabled(env)) return json({ error: "disabled" }, 404);
  if (method === "OPTIONS") return new Response(null, { status: 204 });

  let body = {};
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  try {
    /* ── who am I ───────────────────────────────────────────────────────── */
    if (seg === "me") {
      let orgId = q("orgId");
      const who = await context(request, env, "");
      /* A PENDING INVITE (an Academic Cell enrolled this email before the person had an account) is
       * resolved here, on their first visit, against the token's VERIFIED email only. The role and
       * the programme are the inviter's, replayed through enrolOne(); nothing is self-declared. */
      let invited = [];
      if (E.invitesOn(env)) {
        const email = await callerEmail(request, env);
        if (email) invited = await E.resolveInvites(env, who.actorUid, email);
      }
      const jr = E.joinRequestsOn(env) ? await E.myJoinRequest(env, who.actorUid).catch(() => null) : null;
      const joinRequest = E.publicJoinRequestForSelf(jr);
      // No institution on this device yet: open the one they were just admitted to, if any.
      if (!orgId) {
        if (invited.length) orgId = invited[0].orgId;
        else if (jr && jr.status === "approved" && jr.orgId) orgId = jr.orgId;
      }
      let ctx;
      try { ctx = await context(request, env, orgId); }
      catch (e) {
        // Not a member (yet): say so, and carry the join request so the screen can show "waiting for
        // <institution>" instead of a dead end. Nothing about the org itself is disclosed.
        if (e && (e.status === 403 || e.status === 404)) {
          return json({ error: "forbidden", message: "You are not part of this institution yet.", joinRequest }, 403);
        }
        throw e;
      }
      const resident = ctx.orgId ? await S.residentForUid(env, ctx.orgId, ctx.actorUid) : null;
      const programme = resident ? await S.getProgramme(env, resident.programmeId) : null;
      const rotations = resident ? await S.listRotations(env, resident.id) : [];
      const caps = Object.keys(CAPS).filter((k) => can(ctx.role, CAPS[k]) && CAPS[k].indexOf("pglog.") === 0).map((k) => CAPS[k]);
      // Whether this person may SIGN, and if not, why — so the UI can explain rather than present a
      // control that fails. Never the gate; the gate is server-side on the write path.
      const signer = can(ctx.role, CAPS.PGLOG_VERIFY) || can(ctx.role, CAPS.PGLOG_ATTEST)
        ? await S.signerStatus(env, ctx.actorUid) : null;
      // Remember a faculty member's display name for the roster picker (see S.rememberName: the
      // roster's lower-cased identities cannot reach the case-sensitive profile path themselves).
      if (signer && !(ctx.member && S.cleanName(ctx.member.displayName))) {
        try { await S.rememberName(env, ctx.actorUid, await callerName(request, env, ctx.uid)); } catch (e) {}
      }
      return json({ ok: true, uid: ctx.uid, orgId: ctx.orgId, orgCode: (ctx.org && ctx.org.code) || "",
                    orgName: (ctx.org && ctx.org.name) || "", orgKind: (ctx.org && ctx.org.kind) || "",
                    role: ctx.role, caps, resident, programme, rotations, signer, joinRequest,
                    invitesResolved: invited.length });
    }

    /* ── enrol: add a person to this institution ────────────────────────────
     * PGMER-2023 5.2(iv) makes the Academic Cell responsible for the programme, and every screen in
     * this module assumed that enrolment had already happened — but nothing could perform it. There
     * was no create-institution, no create-programme and no enrol path in the client at all, so every
     * user sat forever on "Your training record is not linked yet". This is that missing step.
     *
     * An Academic Cell holds a list of EMAILS, not Firebase uids, so the resolve happens here rather
     * than asking a human to copy uids around. Two deliberate limits:
     *   - CONFIGURE-gated, so only an Academic Cell (or org owner/admin) can call it.
     *   - ASSIGNABLE is an allowlist of pg_* roles ONLY. An Academic Cell can enrol trainees and
     *     faculty; it can NEVER mint an org admin or owner. Granting membership is real authority,
     *     so widening it is a deliberate act, not a missing check.
     */
    if (seg === "enrol" && method === "POST") {
      // ctx.orgId, not the raw body value: context() accepts an SMD-XXXXXX code, and every write below
      // must land on the internal id it resolves to.
      const ctx = await context(request, env, String(body.orgId || ""));
      await S.gate(env, ctx.actorUid, ctx.orgId, CAPS.PGLOG_CONFIGURE);

      // ASSIGNABLE (pg_* + academic_cell) is enforced again inside enrolOne(); checked here too so a
      // bad role is refused before any lookup.
      const role = String(body.role || "");
      if (E.ASSIGNABLE.indexOf(role) < 0) return json({ error: "role_not_assignable", role }, 400);
      if (!String(body.email || "").trim()) return json({ error: "email_required" }, 400);
      /* ONE path (_pglog_enrol.enrolOne): resolves the email, refuses to re-role the caller
       * (cannot_assign_self, BEFORE any membership write), validates the guide, writes q_members, and
       * enrols the resident in the same call. An email with no account yet becomes a PENDING INVITE
       * (PGLOG_INVITES, default on) instead of no_such_account. */
      const r = await E.enrolOne(env, {
        orgId: ctx.orgId, actorUid: ctx.actorUid, actorEmail: await callerEmail(request, env),
        row: { email: body.email, role, programmeId: body.programmeId, guide: body.guide,
               trainingYear: body.trainingYear, startDate: body.startDate, name: body.name,
               departmentId: body.departmentId, unit: body.unit },
        allowInvite: E.invitesOn(env), via: "enrol"
      });
      return json(r);
    }

    /* ── bulk enrol: up to 100 residents into one programme, per-row results ── */
    if (seg === "enrol-bulk" && method === "POST") {
      const ctx = await context(request, env, String(body.orgId || ""));
      await S.gate(env, ctx.actorUid, ctx.orgId, CAPS.PGLOG_CONFIGURE);
      const rl = await P.rateLimit(env, request, "bulk:" + ctx.uid, 5, 60);
      if (!rl.ok) return json({ error: "rate_limited", message: "Wait a minute before the next batch." }, 429, { "Retry-After": String(rl.retryAfter) });
      return json(await E.enrolBulk(env, {
        orgId: ctx.orgId, actorUid: ctx.actorUid, actorEmail: await callerEmail(request, env),
        programmeId: body.programmeId, startDate: body.startDate, rows: body.rows
      }));
    }

    /* ── pending invites (enrolled by email, not signed in yet) ─────────── */
    if (seg === "invites" && method === "GET") {
      const ctx = await context(request, env, q("orgId"));
      await S.gate(env, ctx.actorUid, ctx.orgId, CAPS.PGLOG_CONFIGURE);
      return json({ ok: true, invites: await E.listInvites(env, ctx.orgId) });
    }

    /* ── "request to join" by institution code ──────────────────────────────
     * Any signed-in user may ASK. The request grants nothing: no membership, no role. It becomes a
     * pg_resident membership only when an Academic Cell or HoD approves it through enrolOne(). */
    if (seg === "join-request") {
      if (!E.joinRequestsOn(env)) return json({ error: "disabled" }, 404);
      const who = await context(request, env, "");
      if (method === "GET") {
        return json({ ok: true, joinRequest: E.publicJoinRequestForSelf(await E.myJoinRequest(env, who.actorUid)) });
      }
      if (method === "POST") {
        const rl = await P.rateLimit(env, request, "join:" + who.uid, 5, 3600);
        if (!rl.ok) return json({ error: "rate_limited", message: "Too many requests. Try again later." }, 429, { "Retry-After": String(rl.retryAfter) });
        const r = await E.createJoinRequest(env, {
          actorUid: who.actorUid, email: await callerEmail(request, env), name: await callerName(request, env, who.uid),
          orgCode: body.orgCode, programmeHint: body.programmeHint, note: body.note
        });
        return json({ ok: true, existing: r.existing, joinRequest: E.publicJoinRequestForSelf(r.joinRequest) });
      }
    }
    if (seg === "join-requests") {
      if (!E.joinRequestsOn(env)) return json({ error: "disabled" }, 404);
      if (method === "GET" && !id) {
        const ctx = await context(request, env, q("orgId"));
        if (!mayDecideJoin(ctx)) return json({ error: "forbidden" }, 403);
        const list = await E.listJoinRequests(env, ctx.orgId, q("status") || "pending");
        return json({ ok: true, joinRequests: list.map(E.publicJoinRequestForStaff) });
      }
      if (method === "POST" && id && (action === "approve" || action === "reject")) {
        const jr = await E.getJoinRequest(env, id);
        if (!jr) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, jr.orgId);
        if (!mayDecideJoin(ctx)) return json({ error: "forbidden" }, 403);
        if (action === "reject") {
          const out = await E.rejectJoinRequest(env, { id, orgId: ctx.orgId, actorUid: ctx.actorUid, reason: body.reason });
          return json({ ok: true, joinRequest: E.publicJoinRequestForStaff(out) });
        }
        const r = await E.approveJoinRequest(env, { id, orgId: ctx.orgId, actorUid: ctx.actorUid, body, deptScope: joinScope(ctx) });
        return json({ ok: true, joinRequest: E.publicJoinRequestForStaff(r.joinRequest), identity: r.identity,
                      role: r.role, resident: S.publicResident(r.resident, "roster") });
      }
    }

    /* ── programmes ─────────────────────────────────────────────────────── */
    if (seg === "programmes") {
      if (method === "GET") {
        const ctx = await context(request, env, q("orgId"));
        if (!can(ctx.role, CAPS.PGLOG_VIEW_DEPT) && !can(ctx.role, CAPS.PGLOG_VIEW_OWN)) return json({ error: "forbidden" }, 403);
        // ctx.orgId, not the raw parameter: context() resolves an SMD-XXXXXX code to the internal id,
        // so querying the raw value authorised correctly and then returned an empty list.
        return json({ ok: true, programmes: await S.listProgrammes(env, ctx.orgId) });
      }
      if (method === "POST") {
        const ctx = await context(request, env, body.orgId);
        await S.gate(env, ctx.actorUid, body.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, programme: await S.createProgramme(env, body.orgId, body, ctx.actorUid) });
      }
      /* Remove a programme created by mistake. Gated on CONFIGURE like every other structural change
       * here, and gated AGAIN by the store, which refuses while anyone is enrolled - deleting a
       * programme out from under a signed training record is the failure this is guarding. */
      if (method === "DELETE" && id) {
        const prog = await S.getProgramme(env, id);
        if (!prog) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, prog.orgId);
        await S.gate(env, ctx.actorUid, prog.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, ...(await S.deleteProgramme(env, id, ctx.actorUid)) });
      }
      if (method === "PATCH" && id) {
        const cur = await S.getProgramme(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, programme: await S.updateProgramme(env, id, body, ctx.actorUid) });
      }
    }

    /* ── residents ──────────────────────────────────────────────────────── */
    if (seg === "residents") {
      if (method === "GET") {
        // Resolve first, then query on the resolved id: context() accepts an SMD-XXXXXX code, and
        // querying the raw parameter authorised fine and then returned nothing.
        const ctx = await context(request, env, q("orgId"));
        const orgId = ctx.orgId;
        if (!can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED) && !can(ctx.role, CAPS.PGLOG_VIEW_DEPT) && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION)) {
          return json({ error: "forbidden" }, 403);
        }
        const opts = { departmentId: q("departmentId"), programmeId: q("programmeId"), trainingYear: q("trainingYear") };
        // Faculty (not HOD / Academic Cell) see only the residents assigned to them.
        if (!can(ctx.role, CAPS.PGLOG_VIEW_DEPT) && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION)) opts.guide = ctx.actorUid;
        // A departmental membership is a departmental membership. The query parameter chose the
        // department with nothing checking it against the caller's recorded scope, so an HoD scoped
        // to one department could list every resident in the institution by asking for them.
        const scope = (ctx.member && ctx.member.scope && ctx.member.scope.departments) || [];
        if (scope.length && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION)) {
          if (opts.departmentId && scope.indexOf(opts.departmentId) < 0) return json({ error: "forbidden" }, 403);
        }
        let list = await S.listResidents(env, orgId, opts);
        if (scope.length && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION) && !opts.departmentId) {
          list = list.filter((r) => !r.departmentId || scope.indexOf(r.departmentId) > -1);
        }
        // A roster is a roster: names, ids and postings. The Firebase uid is an internal handle.
        return json({ ok: true, residents: list.map((r) => S.publicResident(r, "roster")) });
      }
      if (method === "POST") {
        const ctx = await context(request, env, body.orgId);
        await S.gate(env, ctx.actorUid, ctx.orgId, CAPS.PGLOG_CONFIGURE);
        // Same guide and training-year rules as /enrol, so this older route is not a way around them.
        const rb = Object.assign({}, body);
        if (rb.guide) {
          if (M.sameActor(ctx.actorUid, rb.guide)) return json({ error: "cannot_assign_self_as_guide",
            message: "You cannot make yourself this resident's guide. Ask the head of department." }, 403);
          rb.guide = await E.validateGuide(env, ctx.orgId, rb.guide, { residentIdentity: rb.uid, departmentId: rb.departmentId });
        }
        const ty = E.parseTrainingYear(rb.trainingYear);
        if (!ty.ok) return json({ error: "training_year_invalid", message: "Training year must be 1, 2 or 3." }, 400);
        return json({ ok: true, resident: await S.enrolResident(env, ctx.orgId, rb, ctx.actorUid) });
      }
      if (method === "PATCH" && id) {
        const cur = await S.getResident(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        // A resident may correct their own unit/contact detail; anything structural needs CONFIGURE.
        const own = M.sameActor(ctx.actorUid, cur.uid);
        /* `name` and `smdId` are STRUCTURAL, not contact detail. Both are printed by the public
         * verification page (_pglog_public.js), and M.certificateContent digests residentId /
         * programmeId / orgId - never the name. A resident could therefore rename themselves after
         * their entries were signed and the QR would still report "valid" beside the new name and
         * the signer's registration number. */
        const structural = ["programmeId", "startDate", "endDate", "trainingYear", "guide", "coGuides",
                            "active", "departmentId", "name", "smdId", "batch"];
        /* ASSIGNING A GUIDE. Nothing could, so the monthly authentication PGMER-2023 5.2(vii) asks
         * of "the Post-graduate guide" was unreachable for every resident. An Academic Cell does it
         * through CONFIGURE; a head of department may do it for a resident of THEIR department (and
         * change nothing else in the same call). The self-appointment refusal below still applies. */
        const onlyGuideKeys = Object.keys(body).length > 0 &&
          Object.keys(body).every((k) => k === "guide" || k === "coGuides");
        const hodScope = scopeOf(ctx);
        const hodAssigns = ctx.role === "pg_hod" && onlyGuideKeys &&
          (!hodScope.length || hodScope.indexOf(cur.departmentId) > -1);
        if ((!own || structural.some((k) => k in body)) && !hodAssigns) {
          await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_CONFIGURE);
        }
        /* YOU MAY NOT NAME YOURSELF THIS RESIDENT'S GUIDE. Assigning the guide is CONFIGURE-gated,
         * and academic_cell and admin both hold CONFIGURE - while canReadResident() grants a guide
         * the "verifier" audience, which releases caseRef, diagnosis, remarks and reflection bodies.
         * So the role documented as seeing aggregate only could hand itself full clinical detail on
         * any trainee with a single PATCH. Someone else appoints a guide; that is what makes it an
         * appointment. A head of department already reads that detail through their own role, so
         * this costs them nothing. */
        const namesSelf = M.sameActor(ctx.actorUid, body.guide) ||
          (Array.isArray(body.coGuides) && body.coGuides.some((x) => M.sameActor(ctx.actorUid, x)));
        if (namesSelf) {
          return json({ error: "cannot_assign_self_as_guide",
            message: "You cannot make yourself this resident's guide. Ask the head of department." }, 403);
        }
        // A guide must be someone who can actually verify this resident's entries.
        const patch = Object.assign({}, body);
        if (patch.guide) {
          patch.guide = await E.validateGuide(env, cur.orgId, patch.guide, { residentIdentity: cur.uid, departmentId: patch.departmentId || cur.departmentId });
        }
        if (Array.isArray(patch.coGuides)) {
          const out = [];
          for (const g of patch.coGuides) if (g) out.push(await E.validateGuide(env, cur.orgId, g, { residentIdentity: cur.uid, departmentId: patch.departmentId || cur.departmentId }));
          patch.coGuides = out;
        }
        if ("trainingYear" in patch) {
          const ty = E.parseTrainingYear(patch.trainingYear);
          if (!ty.ok || ty.value === undefined) return json({ error: "training_year_invalid", message: "Training year must be 1, 2 or 3." }, 400);
          patch.trainingYear = ty.value;
        }
        const updated = await S.updateResident(env, id, patch, ctx.actorUid);
        return json({ ok: true, resident: own ? updated : S.publicResident(updated, ctx.role === "pg_hod" ? "hod" : "roster") });
      }
    }

    /* ── rotations ──────────────────────────────────────────────────────── */
    if (seg === "rotations") {
      if (method === "GET") {
        const res = await S.getResident(env, q("residentId"));
        const ctx = await context(request, env, res && res.orgId);
        const audience = await canReadResident(env, ctx, res);
        return json({ ok: true, audience, rotations: await S.listRotations(env, res.id) });
      }
      if (method === "POST") {
        const res = await S.getResident(env, body.residentId);
        if (!res) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, res.orgId);
        await S.gate(env, ctx.actorUid, res.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, rotation: await S.createRotation(env, res.orgId, body, ctx.actorUid) });
      }
      if (method === "PATCH" && id) {
        // Gate on the ROTATION'S OWN org, loaded from the document — never on an org the caller
        // supplies. The first version gated on body.orgId while updateRotation() wrote to cur.orgId,
        // so an Academic Cell in one institution could flip another institution's DRP rotation to
        // "completed" — an exam pre-requisite under §5.2(xv)VIII(c). (R1, finding C6.)
        const cur = await S.getRotation(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, rotation: await S.updateRotation(env, id, body, ctx.actorUid) });
      }
    }

    /* ── entries ────────────────────────────────────────────────────────── */
    if (seg === "entries") {
      if (method === "GET" && !id) {
        const res = await S.getResident(env, q("residentId"));
        const ctx = await context(request, env, res && res.orgId);
        const audience = await canReadResident(env, ctx, res);
        const rows = await S.listEntries(env, res.id, {
          kind: q("kind"), status: q("status"), from: q("from"), to: q("to"),
          includeDeleted: q("includeDeleted") === "1" && can(ctx.role, CAPS.PGLOG_AUDIT)
        });
        return json({ ok: true, audience, entries: rows.map((e) => S.publicEntry(e, audience)) });
      }
      if (method === "GET" && id) {
        const e = await S.getEntry(env, id);
        if (!e) return json({ error: "not_found" }, 404);
        const res = await S.getResident(env, e.residentId);
        const ctx = await context(request, env, e.orgId);
        const audience = await canReadResident(env, ctx, res, e);
        return json({ ok: true, audience, entry: Object.assign(S.publicEntry(e, audience), { residentName: S.cleanName(res && res.name) }) });
      }
      if (method === "POST" && !id) {
        const res = await S.getResident(env, body.residentId);
        if (!res) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, res.orgId);
        await S.gate(env, ctx.actorUid, res.orgId, CAPS.PGLOG_LOG_OWN);
        const e = await S.createEntry(env, res.orgId, body, ctx.actorUid);
        return json({ ok: true, entry: S.publicEntry(e, "self") });
      }
      if (id && action === "submit" && method === "POST") {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_SUBMIT_OWN);
        const out = await S.submitEntry(env, id, ctx.actorUid);
        // routing: "supervisor" (named on the entry) | "guide" (defaulted to the resident's guide) |
        // "unassigned" (no guide yet: waiting for one, or for an HoD).
        return json({ ok: true, entry: S.publicEntry(out, "self"), routing: out.routing || "supervisor" });
      }
      if (id && action === "withdraw" && method === "POST") {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_LOG_OWN);
        return json({ ok: true, entry: S.publicEntry(await S.withdrawEntry(env, id, ctx.actorUid, body.reason), "self") });
      }
      if (id && action === "verify" && method === "POST") {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        return json({ ok: true, entry: S.publicEntry(await S.verifyEntry(env, id, ctx.actorUid, body.note), "verifier") });
      }
      if (id && action === "return" && method === "POST") {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        return json({ ok: true, entry: S.publicEntry(await S.returnEntry(env, id, ctx.actorUid, body.reason), "verifier") });
      }
      if (id && action === "amend" && method === "POST") {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        return json({ ok: true, entry: S.publicEntry(await S.amendEntry(env, id, body.patch || {}, ctx.actorUid, body.reason), "self") });
      }
      if (method === "PATCH" && id) {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_LOG_OWN);
        return json({ ok: true, entry: S.publicEntry(await S.editEntry(env, id, body, ctx.actorUid), "self") });
      }
      if (method === "DELETE" && id) {
        const cur = await S.getEntry(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        const reason = q("reason") || "";
        return json({ ok: true, entry: S.publicEntry(await S.deleteEntry(env, id, ctx.actorUid, reason), "self") });
      }
    }

    /* ── the faculty roster (so a resident picks a real person, not free text) ── */
    if (seg === "faculty-roster" && method === "GET") {
      const ctx = await context(request, env, q("orgId"));
      if (!can(ctx.role, CAPS.PGLOG_VIEW_OWN) && !can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED)) {
        return json({ error: "forbidden" }, 403);
      }
      // identity + role + display NAME (+ department scope, for a guide picker). Never email or
      // phone: a resident picking a supervisor does not need staff contact details, and this list is
      // readable by every resident in the org. ctx.orgId: the resolved id, not an SMD code.
      const roster = await S.facultyRosterNamed(env, ctx.orgId);
      return json({ ok: true, faculty: roster.map((m) => ({ identity: m.identity, role: m.role, name: m.name, departments: m.departments })) });
    }

    /* ── the faculty verification queue ─────────────────────────────────── */
    if (seg === "pending" && method === "GET") {
      const ctx = await context(request, env, q("orgId"));
      if (!can(ctx.role, CAPS.PGLOG_VERIFY)) return json({ error: "forbidden" }, 403);
      const rows = await pendingQueue(env, ctx);
      const names = await S.residentNames(env, rows.map((e) => e.residentId));
      return json({ ok: true, entries: rows.map((e) => Object.assign(S.publicEntry(e, "verifier"),
        { residentName: names[e.residentId] || "", unassigned: !e.supervisor })) });
    }

    /* ── assessments ────────────────────────────────────────────────────── */
    if (seg === "assessments") {
      if (method === "GET") {
        const res = await S.getResident(env, q("residentId"));
        const ctx = await context(request, env, res && res.orgId);
        // The audience is not decoration: an assessment carries 3000 characters of feedback about a
        // named trainee and their remediation plan. It was being serialised raw to every caller that
        // got past the gate, including the ones deliberately downgraded to "aggregate".
        const audience = await canReadResident(env, ctx, res);
        const list = await S.listAssessments(env, res.id);
        return json({ ok: true, audience, assessments: list.map((a) => S.publicAssessment(a, audience)) });
      }
      if (method === "POST" && !id) {
        const res = await S.getResident(env, body.residentId);
        if (!res) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, res.orgId);
        return json({ ok: true, assessment: await S.createAssessment(env, res.orgId, Object.assign({}, body, { programmeId: res.programmeId }), ctx.actorUid) });
      }
      if (method === "PATCH" && id) {
        const cur = await S.getAssessment(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        // RULE 3: the template is the SERVER's, never the client's.
        const tpl = templateFor(body.templateId || cur.templateId);
        if (!tpl) return json({ error: "unknown_template" }, 400);
        return json({ ok: true, assessment: await S.completeAssessment(env, id, body, tpl, ctx.actorUid) });
      }
      if (method === "POST" && id && action === "sign") {
        const cur = await S.getAssessment(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        return json({ ok: true, assessment: await S.signAssessment(env, id, ctx.actorUid) });
      }
    }

    /* ── attestation — PGMER-2023 5.2(vii) ───────────────────────────────── */
    if (seg === "attest" && method === "POST") {
      const res = await S.getResident(env, body.residentId);
      if (!res) return json({ error: "not_found" }, 404);
      if (body.kind && M.ATTESTATION_KINDS.indexOf(String(body.kind)) < 0) return json({ error: "unknown_attestation_kind" }, 400);
      const ctx = await context(request, env, res.orgId);
      return json({ ok: true, attestation: await S.attest(env, body, ctx.actorUid) });
    }
    if (seg === "attestations" && method === "GET") {
      const res = await S.getResident(env, q("residentId"));
      const ctx = await context(request, env, res && res.orgId);
      const audience = await canReadResident(env, ctx, res);
      const [entries, atts] = await Promise.all([S.listEntries(env, res.id, {}), S.listAttestations(env, res.id)]);
      const prog = await S.getProgramme(env, res.programmeId);
      const months = M.attestationStatus(res, entries, atts, {
        today: M.isoDate(Date.now()),
        attestationGraceDays: (prog && prog.config && prog.config.attestationGraceDays) || 7
      });
      return json({ ok: true, audience, attestations: atts.map((a) => S.publicAttestation(a, audience)), months });
    }

    /* ── curriculum configuration (Academic Cell) ───────────────────────── */
    if (seg === "config") {
      if (method === "GET" && id) {
        const prog = await S.getProgramme(env, id);
        if (!prog) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, prog.orgId);
        // Curriculum overrides are what a resident's targets are measured against, so a resident may
        // read them; but a bare org member with no pglog role may not.
        if (!can(ctx.role, CAPS.PGLOG_VIEW_OWN) && !can(ctx.role, CAPS.PGLOG_CONFIGURE) &&
            !can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED)) return json({ error: "forbidden" }, 403);
        return json({ ok: true, config: await S.getConfig(env, id) });
      }
      if ((method === "PUT" || method === "POST") && id) {
        const prog = await S.getProgramme(env, id);
        if (!prog) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, prog.orgId);
        return json({ ok: true, config: await S.setConfig(env, id, body, ctx.actorUid) });
      }
    }

    /* ── dashboards ─────────────────────────────────────────────────────────
     * These return AGGREGATES computed by the pure model, not raw tables. The resident dashboard is
     * the one place progress is calculated server-side as well as client-side — deliberately the
     * same functions, so a phone that computed it offline and the server agree. */
    if (seg === "dashboard") {
      if (id === "resident" && method === "GET") {
        const res = await S.getResident(env, q("residentId"));
        const ctx = await context(request, env, res && res.orgId);
        const audience = await canReadResident(env, ctx, res);
        const prog = await S.getProgramme(env, res.programmeId);
        const [entries, rotations, assessments, atts] = await Promise.all([
          S.listEntries(env, res.id, {}), S.listRotations(env, res.id),
          S.listAssessments(env, res.id), S.listAttestations(env, res.id)
        ]);
        const today = M.isoDate(Date.now());
        const cfg = (prog && prog.config) || {};
        const attendance = M.attendanceSummary(entries, {
          programmeStart: res.startDate, today,
          attendancePct: cfg.attendancePct, courseDays: cfg.attendanceDays,
          attendanceDaysSource: cfg.attendanceDaysSource
        });
        return json({
          ok: true, audience, resident: S.publicResident(res, audience), programme: prog,
          summary: M.summarise(entries),
          weekly: M.weeklyCadence(entries, res.startDate, today),
          attendance,
          months: M.attestationStatus(res, entries, atts, { today, attestationGraceDays: cfg.attestationGraceDays }),
          rotations, assessments: assessments.map((a) => S.publicAssessment(a, audience)),
          // The requirement list itself lives in the curriculum packs, which are static client-side
          // assets — the client resolves progress against them with the SAME pure functions. The
          // server sends the verified entry set so both arrive at the same numbers.
          entries: entries.map((e) => S.publicEntry(e, audience)),
          trainingYear: M.trainingYearOn(res, prog, today),
          semester: M.semesterOn(res, today)
        });
      }
      if (id === "faculty" && method === "GET") {
        const ctx = await context(request, env, q("orgId"));
        const orgId = ctx.orgId;
        if (!can(ctx.role, CAPS.PGLOG_VERIFY) && !can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED)) return json({ error: "forbidden" }, 403);
        /* A head of department sees EVERY resident of their department(s), not only the ones they
         * guide: PGMER-2023 lets the HoD authenticate for a guide who has left, and an HoD who could
         * not see a guideless resident could never assign them one either. Faculty still see only
         * their own trainees. Rate-limited like the dept view: this is two reads per resident. */
        const isHod = ctx.role === "pg_hod";
        if (isHod) {
          const fl = await P.rateLimit(env, request, "fac:" + ctx.uid, 10, 60);
          if (!fl.ok) return json({ error: "rate_limited", message: "That view is still loading. Try again in a moment." }, 429, { "Retry-After": String(fl.retryAfter) });
        }
        const pending = await pendingQueue(env, ctx);
        let residents;
        if (isHod) {
          const hs = scopeOf(ctx);
          residents = (await S.listResidents(env, orgId, {})).filter((r) => !hs.length || !r.departmentId || hs.indexOf(r.departmentId) > -1);
        } else {
          residents = await S.listResidents(env, orgId, { guide: ctx.actorUid });
        }
        const today = M.isoDate(Date.now());
        const pendingNames = await S.residentNames(env, pending.map((e) => e.residentId));
        // Per-resident triage, computed here so the faculty list is ordered by who needs a
        // conversation rather than alphabetically.
        const rows = [];
        for (const r of residents.slice(0, isHod ? 150 : 60)) {
          const entries = await S.listEntries(env, r.id, {});
          const atts = await S.listAttestations(env, r.id);
          const weekly = M.weeklyCadence(entries, r.startDate, today);
          const months = M.attestationStatus(r, entries, atts, { today });
          rows.push({
            resident: { id: r.id, name: r.name, smdId: r.smdId, trainingYear: r.trainingYear, unit: r.unit,
                        programmeId: r.programmeId, departmentId: r.departmentId, guide: r.guide || "",
                        needsGuide: !r.guide, isMine: S.norm(r.guide) === S.norm(ctx.actorUid) },
            summary: M.summarise(entries), weekly,
            attestationOverdue: months.filter((m) => m.overdue).map((m) => m.period),
            lastEntryAt: entries.length ? entries[0].occurredAt : ""
          });
        }
        rows.sort((a, b) => (a.weekly.pct == null ? 101 : a.weekly.pct) - (b.weekly.pct == null ? 101 : b.weekly.pct));
        return json({
          ok: true, role: ctx.role,
          pending: pending.map((e) => Object.assign(S.publicEntry(e, "verifier"),
            { residentName: pendingNames[e.residentId] || "", unassigned: !e.supervisor })),
          overdue: M.overdueVerifications(pending, { today, verifySlaDays: 7 }),
          residents: rows
        });
      }
      if (id === "dept" && method === "GET") {
        const orgId = q("orgId"), departmentId = q("departmentId");
        const ctx = await context(request, env, orgId);
        if (!can(ctx.role, CAPS.PGLOG_VIEW_DEPT) && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION)) return json({ error: "forbidden" }, 403);
        // THE MOST EXPENSIVE ROUTE IN THE MODULE: three Firestore queries per resident, so one call
        // is ~600 reads. It is authenticated, but an authenticated amplifier is still an amplifier
        // and this one is a single GET. Keyed on the caller, not the IP — a department shares an
        // institution's network. The page is oversight, not a live feed; a handful a minute is ample.
        const dl = await P.rateLimit(env, request, "dept:" + ctx.uid, 6, 60);
        if (!dl.ok) return json({ error: "rate_limited", message: "That view is still loading. Try again in a moment." },
          429, { "Retry-After": String(dl.retryAfter) });
        /* Apply the caller's RECORDED department scope, exactly as /residents does. This route was
         * the outlier: an HoD scoped to one department could ask for another (or omit departmentId
         * entirely) and receive every resident in the institution - names, smdIds, guides, activity
         * counts and overdue authentications. Same bypass the /residents comment says was fixed. */
        const deptScope = (ctx.member && ctx.member.scope && ctx.member.scope.departments) || [];
        let scopedDept = departmentId;
        if (deptScope.length && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION)) {
          if (departmentId && deptScope.indexOf(departmentId) < 0) return json({ error: "forbidden" }, 403);
          if (!departmentId && deptScope.length === 1) scopedDept = deptScope[0];
        }
        let residents = await S.listResidents(env, orgId, { departmentId: scopedDept, programmeId: q("programmeId"), trainingYear: q("trainingYear") });
        if (deptScope.length && !can(ctx.role, CAPS.PGLOG_VIEW_INSTITUTION) && !scopedDept) {
          residents = residents.filter((r) => !r.departmentId || deptScope.indexOf(r.departmentId) > -1);
        }
        const today = M.isoDate(Date.now());
        // The Academic Cell's audience is aggregate: counts and completeness, never clinical detail.
        // Only the DEPARTMENTAL role gets the department view — `academic_cell` and `admin` hold the
        // department cap as well, which is how this same test let institution-wide roles through the
        // per-resident read guard.
        const audience = ctx.role === "pg_hod" ? "hod" : "aggregate";
        const rows = [];
        for (const r of residents.slice(0, 200)) {
          const entries = await S.listEntries(env, r.id, {});
          const atts = await S.listAttestations(env, r.id);
          const rots = await S.listRotations(env, r.id);
          const weekly = M.weeklyCadence(entries, r.startDate, today);
          const months = M.attestationStatus(r, entries, atts, { today });
          rows.push({
            resident: { id: r.id, name: r.name, smdId: r.smdId, trainingYear: r.trainingYear,
                        unit: r.unit, programmeId: r.programmeId, departmentId: r.departmentId, guide: r.guide },
            summary: M.summarise(entries), weekly,
            attendance: M.attendanceSummary(entries, { programmeStart: r.startDate, today }),
            attestationOverdue: months.filter((m) => m.overdue).length,
            overdueVerifications: M.overdueVerifications(entries, { today, verifySlaDays: 7 }).length,
            drpMonths: M.drpMonths(rots),
            rotations: rots.length,
            lastEntryAt: entries.length ? entries[0].occurredAt : ""
          });
        }
        return json({ ok: true, role: ctx.role, audience, residents: rows });
      }
    }


    /* ── certificates: the signed, frozen document a college or University is handed ───────── */
    if (seg === "certificates") {
      if (method === "GET" && !id) {
        const res = await S.getResident(env, q("residentId"));
        const ctx = await context(request, env, res && res.orgId);
        const audience = await canReadResident(env, ctx, res);
        const certs = await S.listCertificates(env, res.id);
        return json({ ok: true, audience, certificates: certs.map((c) => S.publicCertificate(c, audience)) });
      }
      if (method === "GET" && id) {
        const cert = await S.getCertificate(env, id);
        if (!cert) return json({ error: "not_found" }, 404);
        const res = await S.getResident(env, cert.residentId);
        const ctx = await context(request, env, cert.orgId);
        const audience = await canReadResident(env, ctx, res);
        // The integrity check is what the EXPORT decides on, so it is computed server-side and not
        // left to the client to infer from a status string.
        const integrity = await S.certificateIntegrity(env, cert);
        return json({ ok: true, audience, certificate: S.publicCertificate(cert, audience),
                      quorum: M.quorumState(cert, cert.quorum, res), integrity,
                      verifyUrl: cert.verifyCode ? V.verifyUrl(env, cert.verifyCode) : "" });
      }
      if (method === "POST" && !id) {
        const res = await S.getResident(env, body.residentId);
        if (!res) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, res.orgId);
        return json({ ok: true, certificate: await S.requestCertificate(env, body, ctx.actorUid) });
      }
      if (method === "POST" && id && action === "sign") {
        const cert = await S.getCertificate(env, id);
        if (!cert) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cert.orgId);
        const out = await S.signCertificate(env, id, ctx.actorUid, body);
        const res = await S.getResident(env, out.residentId);
        return json({ ok: true, certificate: S.publicCertificate(out, "verifier"),
                      quorum: M.quorumState(out, out.quorum, res),
                      verifyUrl: out.verifyCode ? V.verifyUrl(env, out.verifyCode) : "" });
      }
      if (method === "POST" && id && action === "revoke") {
        const cert = await S.getCertificate(env, id);
        if (!cert) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cert.orgId);
        return json({ ok: true, certificate: S.publicCertificate(
          await S.revokeCertificate(env, id, ctx.actorUid, body.reason), "verifier") });
      }
    }

    /* ── notifications ──────────────────────────────────────────────────── */
    if (seg === "notifications") {
      const ctx = await context(request, env, "");
      if (method === "GET") return json({ ok: true, notifications: await S.listNotifications(env, ctx.actorUid) });
      if (method === "POST" && id && action === "read") return json(await S.markNotificationRead(env, id, ctx.actorUid));
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    return fail(e);
  }
}
