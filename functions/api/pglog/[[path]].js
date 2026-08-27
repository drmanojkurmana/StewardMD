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
 */
import { verifyFirebaseToken } from "../../_fbauth.js";
import { CAPS, can } from "../../_queue_roles.js";
import { templateFor } from "../../_pglog_templates.js";
import * as S from "../../_pglog_store.js";
import * as V from "../../_pglog_verify.js";
import * as P from "../../_pglog_public.js";
import M from "../../../pglog-model.js";
import { lookupUidByEmail } from "../../_fbadmin.js";
import * as ORG from "../../_opd_org_store.js";

const json = (obj, status = 200, extra) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extra || {})
});
const bearer = (request) => {
  try { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); } catch (e) { return ""; }
};
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
    return json({ error: (e && e.message) || "error", message: e && e.userMessage, errors: e && e.errors }, status);
  }
  try { console.warn("[pglog]", e && e.message, e && e.stack); } catch (_) {}
  return json({ error: "server_error" }, 500);
}


// Resolve the caller's role in an org once per request.
async function context(request, env, orgId) {
  const uid = await verifyFirebaseToken(bearer(request), env);
  if (!uid) throw Object.assign(new Error("signin_required"), { status: 401 });
  const actorUid = "fb:" + uid;
  if (!orgId) return { uid, actorUid, role: "viewer" };
  const g = await S.gate(env, actorUid, orgId, null);
  return { uid, actorUid, role: g.role, owner: g.owner, org: g.org, member: g.member };
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
      const orgId = q("orgId");
      const ctx = await context(request, env, orgId);
      const resident = orgId ? await S.residentForUid(env, orgId, ctx.actorUid) : null;
      const programme = resident ? await S.getProgramme(env, resident.programmeId) : null;
      const rotations = resident ? await S.listRotations(env, resident.id) : [];
      const caps = Object.keys(CAPS).filter((k) => can(ctx.role, CAPS[k]) && CAPS[k].indexOf("pglog.") === 0).map((k) => CAPS[k]);
      // Whether this person may SIGN, and if not, why — so the UI can explain rather than present a
      // control that fails. Never the gate; the gate is server-side on the write path.
      const signer = can(ctx.role, CAPS.PGLOG_VERIFY) || can(ctx.role, CAPS.PGLOG_ATTEST)
        ? await S.signerStatus(env, ctx.actorUid) : null;
      return json({ ok: true, uid: ctx.uid, role: ctx.role, caps, resident, programme, rotations, signer });
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
      const orgId = String(body.orgId || "");
      const ctx = await context(request, env, orgId);
      await S.gate(env, ctx.actorUid, orgId, CAPS.PGLOG_CONFIGURE);

      const ASSIGNABLE = ["pg_resident", "pg_faculty", "pg_hod", "academic_cell"];
      const role = String(body.role || "");
      if (ASSIGNABLE.indexOf(role) < 0) return json({ error: "role_not_assignable", role }, 400);

      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ error: "email_required" }, 400);
      let uid = null;
      try { uid = await lookupUidByEmail(env, email); } catch (e) { uid = null; }
      // Say WHICH email failed: an Academic Cell typing twenty of them needs to know which one, and
      // "they have not signed in to StewardMD yet" is the usual cause, not a typo.
      if (!uid) return json({ error: "no_such_account", email }, 404);

      const identity = "fb:" + uid;
      await ORG.setMembership(env, orgId, identity, { role: role }, ctx.actorUid);

      // A resident is only usable once they are in a programme, so do both in one call rather than
      // leaving a half-enrolled member who still sees the "not linked yet" screen.
      let resident = null;
      if (role === "pg_resident" && body.programmeId) {
        resident = await S.enrolResident(env, orgId, Object.assign({}, body, { uid: identity }), ctx.actorUid);
      }
      return json({ ok: true, identity, role, email, resident });
    }

    /* ── programmes ─────────────────────────────────────────────────────── */
    if (seg === "programmes") {
      if (method === "GET") {
        const ctx = await context(request, env, q("orgId"));
        if (!can(ctx.role, CAPS.PGLOG_VIEW_DEPT) && !can(ctx.role, CAPS.PGLOG_VIEW_OWN)) return json({ error: "forbidden" }, 403);
        return json({ ok: true, programmes: await S.listProgrammes(env, q("orgId")) });
      }
      if (method === "POST") {
        const ctx = await context(request, env, body.orgId);
        await S.gate(env, ctx.actorUid, body.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, programme: await S.createProgramme(env, body.orgId, body, ctx.actorUid) });
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
        const orgId = q("orgId");
        const ctx = await context(request, env, orgId);
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
        await S.gate(env, ctx.actorUid, body.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, resident: await S.enrolResident(env, body.orgId, body, ctx.actorUid) });
      }
      if (method === "PATCH" && id) {
        const cur = await S.getResident(env, id);
        if (!cur) return json({ error: "not_found" }, 404);
        const ctx = await context(request, env, cur.orgId);
        // A resident may correct their own unit/contact detail; anything structural needs CONFIGURE.
        const own = M.sameActor(ctx.actorUid, cur.uid);
        const structural = ["programmeId", "startDate", "endDate", "trainingYear", "guide", "coGuides", "active", "departmentId"];
        if (!own || structural.some((k) => k in body)) await S.gate(env, ctx.actorUid, cur.orgId, CAPS.PGLOG_CONFIGURE);
        return json({ ok: true, resident: await S.updateResident(env, id, body, ctx.actorUid) });
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
        return json({ ok: true, audience, entry: S.publicEntry(e, audience) });
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
        return json({ ok: true, entry: S.publicEntry(await S.submitEntry(env, id, ctx.actorUid), "self") });
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
      const orgId = q("orgId");
      const ctx = await context(request, env, orgId);
      if (!can(ctx.role, CAPS.PGLOG_VIEW_OWN) && !can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED)) {
        return json({ error: "forbidden" }, 403);
      }
      // identity + role only. No email: a resident picking a supervisor does not need staff contact
      // details, and this list is readable by every resident in the org.
      const roster = await S.facultyRoster(env, orgId);
      return json({ ok: true, faculty: roster.map((m) => ({ identity: m.identity, role: m.role })) });
    }

    /* ── the faculty verification queue ─────────────────────────────────── */
    if (seg === "pending" && method === "GET") {
      const orgId = q("orgId");
      const ctx = await context(request, env, orgId);
      if (!can(ctx.role, CAPS.PGLOG_VERIFY)) return json({ error: "forbidden" }, 403);
      const rows = await S.pendingForFaculty(env, orgId, ctx.actorUid);
      return json({ ok: true, entries: rows.map((e) => S.publicEntry(e, "verifier")) });
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
        const orgId = q("orgId");
        const ctx = await context(request, env, orgId);
        if (!can(ctx.role, CAPS.PGLOG_VERIFY) && !can(ctx.role, CAPS.PGLOG_VIEW_ASSIGNED)) return json({ error: "forbidden" }, 403);
        const pending = await S.pendingForFaculty(env, orgId, ctx.actorUid);
        const residents = await S.listResidents(env, orgId, { guide: ctx.actorUid });
        const today = M.isoDate(Date.now());
        // Per-resident triage, computed here so the faculty list is ordered by who needs a
        // conversation rather than alphabetically.
        const rows = [];
        for (const r of residents.slice(0, 60)) {
          const entries = await S.listEntries(env, r.id, {});
          const atts = await S.listAttestations(env, r.id);
          const weekly = M.weeklyCadence(entries, r.startDate, today);
          const months = M.attestationStatus(r, entries, atts, { today });
          rows.push({
            resident: { id: r.id, name: r.name, smdId: r.smdId, trainingYear: r.trainingYear, unit: r.unit },
            summary: M.summarise(entries), weekly,
            attestationOverdue: months.filter((m) => m.overdue).map((m) => m.period),
            lastEntryAt: entries.length ? entries[0].occurredAt : ""
          });
        }
        rows.sort((a, b) => (a.weekly.pct == null ? 101 : a.weekly.pct) - (b.weekly.pct == null ? 101 : b.weekly.pct));
        return json({
          ok: true, role: ctx.role,
          pending: pending.map((e) => S.publicEntry(e, "verifier")),
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
        const residents = await S.listResidents(env, orgId, { departmentId, programmeId: q("programmeId"), trainingYear: q("trainingYear") });
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
