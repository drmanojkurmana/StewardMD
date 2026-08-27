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
 * KILL SWITCH: env PGLOG_OFF=1 returns 404 for everything except /ready. There is no "enabled by
 * env" gate because the data here is per-user and cap-gated — availability is not the control that
 * protects it, authorization is.
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
import M from "../../../pglog-model.js";

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
    supervisor_unresolved: [400, "That supervisor is not on your department's faculty list, so nobody would receive this entry to verify."]
  };
  const k = known[e && e.message];
  if (k) return json({ error: e.message, message: k[1] }, k[0]);
  if (status) return json({ error: (e && e.message) || "error", message: e && e.userMessage, detail: e && e.detail, errors: e && e.errors }, status);
  try { console.warn("[pglog]", e && e.message, e && e.stack); } catch (_) {}
  return json({ error: "server_error" }, 500);
}

/* A small fixed-window rate limiter over the KV binding the rest of the app already uses. Fails
 * OPEN on a KV error: a verification lookup is read-only and PHI-free, so refusing every examiner
 * because a cache is down is the worse failure. (The WRITE paths fail closed; this one does not,
 * and the asymmetry is deliberate.) */
async function rateLimit(env, request, bucket, limit, windowSec) {
  const store = env.CASES_KV || env.GHIS_KV || null;
  if (!store) return { ok: true };
  try {
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anon";
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = "pglog:rl:" + bucket + ":" + win + ":" + ip;
    const cur = Number(await store.get(key)) || 0;
    if (cur >= limit) return { ok: false, retryAfter: windowSec };
    await store.put(key, String(cur + 1), { expirationTtl: windowSec * 2 });
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

/* Build the PUBLIC answer for a verification code. Every field here was chosen by asking: is this
 * already on the document the examiner is holding? If not, it does not appear. */
async function describeVerification(env, rec, code) {
  const out = {
    ok: true, code,
    kind: rec.kind,
    issuedAt: rec.issuedAt,
    disclaimer: "StewardMD attests to what it recorded and to the signer's registration as verified " +
      "against the Indian Medical Register at the time of signing. It does not certify the clinical " +
      "content, and it is not a determination by the NMC or by any University."
  };
  if (rec.revoked) {
    out.status = "superseded";
    out.message = "This record was amended after it was signed, so this signature no longer stands. " +
      "The corrected record carries its own code, and the original is retained in the audit trail.";
    return out;
  }

  // Re-derive the digest from the LIVE record. If it no longer matches, the stored document has
  // changed underneath the signature and we say so plainly.
  let live = null, payload = null;
  try {
    if (rec.kind === "entry") {
      live = await S.getEntry(env, rec.refId);
      if (live) payload = { id: live.id, residentId: live.residentId, orgId: live.orgId, kind: live.kind,
        occurredAt: live.occurredAt, role: live.role, verifiedBy: live.verifiedBy,
        verifiedByReg: live.verifiedReg, verifiedAt: live.verifiedAt,
        revisionCount: (live.revisions || []).length };
    } else if (rec.kind === "assessment") {
      live = await S.getAssessment(env, rec.refId);
      if (live) payload = { id: live.id, residentId: live.residentId, orgId: live.orgId,
        templateId: live.templateId, outcome: live.outcome, total: live.total, maxTotal: live.maxTotal,
        assessor: live.assessor, assessorReg: live.assessorReg, assessedAt: live.assessedAt };
    } else if (rec.kind === "attestation") {
      live = await S.getAttestation(env, rec.refId);
      if (live) payload = { id: live.id, residentId: live.residentId, orgId: live.orgId,
        attKind: live.kind, period: live.period, counts: live.counts,
        attestedBy: live.attestedBy, attestedByReg: live.attestedReg, attestedAt: live.attestedAt };
    }
  } catch (e) { live = null; }

  if (!live || !payload) {
    out.status = "unavailable";
    out.message = "The record behind this code could not be read just now. Nothing is implied about " +
      "its validity — try again shortly.";
    return out;
  }

  let expect = "";
  try { expect = await V.digestFor(env, rec.kind, payload); } catch (e) { expect = ""; }
  if (!expect || !V.digestEqual(expect, rec.digest)) {
    out.status = "tampered";
    out.message = "This record does not match what was signed. Do not rely on it. Report it to the " +
      "institution's Academic Cell.";
    return out;
  }

  out.status = "valid";
  const res = await S.getResident(env, live.residentId).catch(() => null);
  const prog = res ? await S.getProgramme(env, res.programmeId).catch(() => null) : null;
  out.resident = res ? { name: res.name, smdId: res.smdId, trainingYear: res.trainingYear } : null;
  out.programme = prog ? { degree: prog.degree, specialty: prog.specialtyId, name: prog.name } : null;
  if (rec.kind === "entry") {
    out.record = { type: "Logbook entry", activity: live.kind, setting: live.setting || "",
                   role: live.role || "", date: live.occurredAt, amendments: (live.revisions || []).length };
    out.signedBy = { name: live.verifiedName || "", registrationNo: live.verifiedReg || "",
                     council: live.verifiedCouncil || "", at: live.verifiedAt,
                     role: "Verifying faculty (PGMER-2023 §5.2(vii))" };
  } else if (rec.kind === "assessment") {
    out.record = { type: "Formative assessment", template: live.templateId, outcome: live.outcome,
                   score: live.maxTotal ? live.total + " / " + live.maxTotal : "—" };
    out.signedBy = { name: live.assessorName || "", registrationNo: live.assessorReg || "",
                     council: live.assessorCouncil || "", at: live.assessedAt, role: "Assessor" };
  } else {
    out.record = { type: live.kind === "monthly" ? "Monthly authentication" : "Head of Department certification",
                   period: live.period || "", entries: (live.counts || {}).total || 0,
                   verifiedEntries: (live.counts || {}).verified || 0 };
    out.signedBy = { name: live.attestedName || "", registrationNo: live.attestedReg || "",
                     council: live.attestedCouncil || "", at: live.attestedAt,
                     role: "Postgraduate guide (PGMER-2023 §5.2(vii))" };
  }
  return out;
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

/* Read guard for one resident's logbook. Returns the AUDIENCE, which decides how much of each entry
 * publicEntry() will hand over — "self" / "verifier" / "hod" see clinical detail, "aggregate" sees
 * counts and categories only.
 *
 * ASSIGNED MEANS ASSIGNED. The first version of this function had both branches return "verifier",
 * so any faculty member anywhere in the institution could read any resident's case references,
 * diagnoses, remarks and reflections (R1, finding C5). It now falls through to "aggregate", and an
 * entry-scoped read separately upgrades a supervisor who is actually named on THAT entry. */
async function canReadResident(env, ctx, resident, entry) {
  if (!resident) throw Object.assign(new Error("not_found"), { status: 404 });
  if (M.sameActor(ctx.actorUid, resident.uid)) return "self";
  const role = ctx.role;
  const mine = S.norm(ctx.actorUid);
  // A department head sees their own department, not the whole institution.
  if (can(role, CAPS.PGLOG_VIEW_DEPT)) {
    if (!resident.departmentId || !ctx.member || !ctx.member.scope ||
        !(ctx.member.scope.departments || []).length ||
        (ctx.member.scope.departments || []).indexOf(resident.departmentId) > -1) return "hod";
    return "aggregate";
  }
  if (can(role, CAPS.PGLOG_VIEW_ASSIGNED)) {
    // Their guide or co-guide: the person §5.2(vii) names as responsible for this logbook.
    if (S.norm(resident.guide) === mine || (resident.coGuides || []).some((g) => S.norm(g) === mine)) return "verifier";
    // Or the supervisor named on the specific entry being opened — they were asked to verify it.
    if (entry && S.norm(entry.supervisor) === mine) return "verifier";
    return "aggregate";
  }
  // Institution-wide oversight (Academic Cell, §5.2(iv) "ensure and monitor") is a completeness
  // question, so it is deliberately the LAST and narrowest grant.
  if (can(role, CAPS.PGLOG_VIEW_INSTITUTION)) return "aggregate";
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
   * unauthenticated endpoint is a free amplifier regardless. */
  if (method === "GET" && seg === "v" && id) {
    const rl = await rateLimit(env, request, "verify", 30, 60);
    if (!rl.ok) return json({ error: "rate_limited", message: "Too many lookups. Try again in a minute." }, 429,
      { "Retry-After": String(rl.retryAfter) });
    const code = V.normalizeCode(id);
    if (!code) return json({ ok: false, status: "malformed", message: "That is not a StewardMD verification code." }, 400);
    let rec = null;
    try { rec = await V.lookup(env, code); } catch (e) { rec = null; }
    // A miss and a malformed code answer identically slowly and identically vaguely — there is
    // nothing to learn from probing.
    if (!rec) return json({ ok: false, status: "not_found", message: "No signed record carries that code." }, 404);
    return json(await describeVerification(env, rec, code));
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
        return json({ ok: true, residents: await S.listResidents(env, orgId, opts) });
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
        await canReadResident(env, ctx, res);
        return json({ ok: true, rotations: await S.listRotations(env, res.id) });
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
        await canReadResident(env, ctx, res);
        return json({ ok: true, assessments: await S.listAssessments(env, res.id) });
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
      await canReadResident(env, ctx, res);
      const [entries, atts] = await Promise.all([S.listEntries(env, res.id, {}), S.listAttestations(env, res.id)]);
      const prog = await S.getProgramme(env, res.programmeId);
      const months = M.attestationStatus(res, entries, atts, {
        today: M.isoDate(Date.now()),
        attestationGraceDays: (prog && prog.config && prog.config.attestationGraceDays) || 7
      });
      return json({ ok: true, attestations: atts, months });
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
          ok: true, audience, resident: res, programme: prog,
          summary: M.summarise(entries),
          weekly: M.weeklyCadence(entries, res.startDate, today),
          attendance,
          months: M.attestationStatus(res, entries, atts, { today, attestationGraceDays: cfg.attestationGraceDays }),
          rotations, assessments,
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
        const residents = await S.listResidents(env, orgId, { departmentId, programmeId: q("programmeId"), trainingYear: q("trainingYear") });
        const today = M.isoDate(Date.now());
        // The Academic Cell's audience is aggregate: counts and completeness, never clinical detail.
        const audience = can(ctx.role, CAPS.PGLOG_VIEW_DEPT) ? "hod" : "aggregate";
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
