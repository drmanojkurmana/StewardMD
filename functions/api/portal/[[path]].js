/* functions/api/portal/[[path]].js - the patient's own door, deliberately not inside the clinical one.
 *
 * Every other WardSynQ route lives under /api/queue and begins by resolving a STAFF actor through
 * authorizeOrg. A patient has no staff account and never will, so these two routes could not live
 * there - and putting them there behind an exception would have been worse than the plumbing this
 * file duplicates: the one place a non-employee can read a chart should not sit inside the block
 * whose every other line assumes an employee, where a later edit widens it by accident.
 *
 * SO THIS FILE IS SMALL ON PURPOSE. It exposes exactly two operations - exchange a code for a
 * session, and read the record that session is for - and it can reach nothing else. There is no
 * write path here of any kind, no patient id is ever accepted from the caller, and no clinical
 * module is imported except the one that assembles the patient's own copy.
 *
 * IT IS OFF UNLESS THE HOSPITAL TURNS IT ON. `wardsynq.patientAccess.enabled` gates both routes, and
 * the modules refuse independently of this file - the check is not in one place.
 *
 * THE ORG IS NAMED IN THE REQUEST AND THAT IS NOT A SECRET. Knowing which hospital a portal belongs
 * to gets an anonymous caller nothing: they still need a grant id and its code, the code is hashed
 * at rest, attempts are capped on the grant itself, and a wrong code and a missing grant return the
 * same answer so this cannot be used to enumerate anything.
 */

import * as ORG from "../../_opd_org_store.js";
import { recordDeps } from "../../_wardsynq/deps.js";
import { redeemCode, portalRead, sessionPatient } from "../../_wardsynq/patient-access.js";
import { sendMessage, requestAppointment } from "../../_wardsynq/portal-requests.js";
import { withdrawOwnConsent, portalDocumentFile, queueStatus } from "../../_wardsynq/portal-view.js";
import { portalPrivacy, portalAcknowledge, portalDataRequest } from "../../_wardsynq/dpdp.js";
import { storeFromEnv as documentStoreFromEnv } from "../../_wardsynq/object-store.js";
import { bookingOptions, bookOnline, cancelOnline, rescheduleOnline } from "../../_wardsynq/online-booking.js";
import { getPreference, setPreference } from "../../_wardsynq/patient-messaging.js";
import { feedbackSettings, openSurvey, submitSurvey, pendingSurveys } from "../../_wardsynq/patient-feedback.js";
import { queueEnabled } from "../../_queue.js";
import { listSessions, listTickets, opdDate } from "../../_queue_engine.js";
import { listDefinitions as listFormDefinitions, publishedVersion as publishedFormVersion } from "../../_forms_store.js";
import { portalIntake, portalSubmitIntake } from "../../_wardsynq/form-response.js";

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)),
  });
}

const str = (v) => (v == null ? "" : String(v).trim());

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const sub = parts[0] || "";
  /* POST only, both routes. A session token in a query string ends up in every access log and
   * proxy on the way, and a GET is the request a browser will happily repeat. */
  if (request.method !== "POST") return json({ ok: false, error: "not_found" }, 404, request);

  let body = {};
  try { body = await request.json(); } catch (_) { body = {}; }

  const orgId = str(body.orgId);
  if (!orgId) return json({ ok: false, error: "org_required" }, 400, request);

  const org = await ORG.getOrg(env, orgId);
  /* A hospital not running WardSynQ natively has no record here to open, and saying anything more
   * specific than "not found" tells an anonymous caller which orgs exist. */
  if (!org || org.mode !== "wardsynq" || !org.connectTenantId) return json({ ok: false, error: "not_found" }, 404, request);

  const cfg = (org && org.wardsynq) || null;
  const migration = { mode: "authoritative", tenantId: String(org.connectTenantId) };
  /* No actorDeps. There is no staff identity to resolve and nothing here asks for one: the modules
   * that need a clinician (enrol, revoke) are NOT imported by this file and are unreachable from it. */
  const deps = { migration, recordDeps: recordDeps(env, migration.tenantId), config: cfg && cfg.patientAccess };

  if (sub === "redeem") {
    const r = await redeemCode(request, env, { ...deps, grantId: body.grantId, code: body.code });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  if (sub === "record") {
    const r = await portalRead(request, env, {
      ...deps, grantId: body.grantId, token: body.token,
      /* The hospital's own withholding list, exactly as the clinician's handout uses it. */
      neverRelease: (cfg && cfg.neverRelease) || null,
    });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  /* P2 gaps: the two further session reads. Each checks the session and the grant's section first,
   * then takes the patient from the grant, exactly like the record read. */
  if (sub === "queue" || sub === "document") {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);
    if (sub === "queue") {
      const r = await queueStatus({ ...deps, queue: {
        enabled: queueEnabled(env), date: opdDate(),
        listSessions: (date) => listSessions(env, org.id, date), listTickets: (sid) => listTickets(env, sid), listRooms: () => ORG.listRooms(env, org.id),
      } }, session);
      return json(r, r.ok ? 200 : (r.status || 502), request);
    }
    const r = await portalDocumentFile({ ...deps, env, store: documentStoreFromEnv(env), documentId: body.documentId, version: body.version }, session);
    if (!r.ok) return json(r, r.status || 502, request);
    /* The bytes themselves, through this response. No object-store key or address ever leaves the server. */
    return new Response(r.bytes, { status: 200, headers: Object.assign({
      "Content-Type": r.contentType || "application/octet-stream", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${r.filename}"`, "X-Content-Type-Options": "nosniff",
    }, corsHeaders(request)) });
  }
  /* DPDP Act 2023: the hospital's privacy notice in the patient's language, their acknowledgement of it, and their own
   * access / correction / erasure / grievance / nomination request. Session first, patient from the grant, as below;
   * a proxy may read the notice and never acknowledges or requests on the patient's behalf (dpdp.js refuses it). */
  if (sub === "privacy" || sub === "privacy-acknowledge" || sub === "data-request") {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);
    const dctx = { ...deps, language: body.language, kind: body.kind, detail: body.detail, nominee: body.nominee, dpdp: (cfg && cfg.dpdp) || null };
    const r = sub === "privacy" ? await portalPrivacy(dctx, session) : sub === "privacy-acknowledge" ? await portalAcknowledge(dctx, session) : await portalDataRequest(dctx, session);
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  /* The two write routes. Both check the session FIRST and then take the patient id from the grant -
   * a caller cannot name whose record it writes onto, exactly as on the read side. */
  if (sub === "message" || sub === "appointment-request" || sub === "consent-withdraw") {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);
    /* P2.9: a proxy writes only within its grant, and never withdraws the patient's consent. */
    const needs = sub === "message" ? "messages" : sub === "appointment-request" ? "appointments" : null;
    if (needs && !session.sections.includes(needs)) return json({ ok: false, error: "not_in_grant", detail: "This access does not include that." }, 403, request);
    if (sub === "consent-withdraw") {
      const r = await withdrawOwnConsent({ ...deps, consentId: body.consentId, reason: body.reason }, session);
      return json(r, r.ok ? 200 : (r.status || 502), request);
    }

    if (sub === "message") {
      const r = await sendMessage(request, env, { ...deps, patientId: session.patientId, actorId: session.readerId, subject: body.subject, body: body.body });
      return json(r, r.ok ? 200 : (r.status || 502), request);
    }
    const r = await requestAppointment(request, env, { ...deps, patientId: session.patientId, actorId: session.readerId, reason: body.reason, preference: body.preference });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }

  /* PRE-ADMISSION INTAKE (form-response.js). Session first, patient from the grant, the grant's "forms" section. Only a
   * published form marked for patients, only for the patient's own planned admission; what is sent stays labelled as
   * the patient's until a clinician reviews it, and nothing is copied into the chart. */
  if (sub === "intake-forms" || sub === "intake-submit") {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);
    let r;
    if (sub === "intake-forms") {
      let published = null;
      try { published = (await listFormDefinitions(env, org.id)).published; } catch (_) { published = null; }
      r = await portalIntake({ ...deps, published, intake: cfg && cfg.intake }, session);
    } else {
      let definition = null;
      try { definition = str(body.formKey) && Number.isInteger(Number(body.formVersion)) ? await publishedFormVersion(env, org.id, str(body.formKey), Number(body.formVersion)) : null; }
      catch (_) { return json({ ok: false, error: "forms_read_failed", written: 0 }, 502, request); }
      r = await portalSubmitIntake({ ...deps, definition, requestId: body.requestId, appointmentId: body.appointmentId, answers: body.answers, intake: cfg && cfg.intake }, session);
    }
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }

  /* SURVEY BY LINK (patient-feedback.js). No session: the random token in the link opens that one survey and
   * nothing else, and a wrong token and a missing one answer alike. Off unless the hospital turned feedback on. */
  if (sub === "feedback-open" || (sub === "feedback-submit" && str(body.surveyToken))) {
    if (!feedbackSettings(cfg && cfg.feedback).enabled) return json({ ok: false, error: "not_found" }, 404, request);
    const fctx = { repository: deps.recordDeps.repository, tenantId: migration.tenantId, token: body.surveyToken, feedbackCfg: cfg && cfg.feedback };
    if (sub === "feedback-open") {
      const r = await openSurvey(fctx);
      // The invitation stays on the server: the page gets the state and the questions, never the patient.
      return json(r.ok ? { ok: true, state: r.state, survey: r.survey || null, hospital: org.name || null } : r, r.ok ? 200 : (r.status || 502), request);
    }
    const r = await submitSurvey({ ...fctx, answers: body.answers });
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }
  /* BOOKING, MESSAGE PREFERENCES AND SURVEYS WITHIN A SESSION. The session is checked first and the patient comes
   * from the grant. Booking needs the grant's appointments section. Consent to be messaged, and answering a survey,
   * are the patient's own: a proxy may see them and may not change or answer them. */
  const ENGAGE = new Set(["booking-options", "booking-book", "booking-cancel", "booking-reschedule", "comm-preferences", "comm-preference-set", "feedback-pending", "feedback-submit"]);
  if (ENGAGE.has(sub)) {
    const session = await sessionPatient({ ...deps, grantId: body.grantId, token: body.token });
    if (!session.ok) return json({ ok: false, error: session.error, detail: session.detail || null }, session.status || 401, request);
    const repo = { repository: deps.recordDeps.repository, tenantId: migration.tenantId };
    let r;
    if (sub.startsWith("booking-")) {
      if (!session.sections.includes("appointments")) return json({ ok: false, error: "not_in_grant", detail: "This access does not include that." }, 403, request);
      const bctx = { ...deps, wsqCfg: cfg, clinicianId: body.clinicianId, startAt: body.startAt, reason: body.reason, appointmentId: body.appointmentId };
      r = sub === "booking-options" ? await bookingOptions(bctx, session) : sub === "booking-book" ? await bookOnline(bctx, session)
        : sub === "booking-cancel" ? await cancelOnline(bctx, session) : await rescheduleOnline(bctx, session);
    } else if (sub === "comm-preferences") {
      r = await getPreference({ ...repo, patientId: session.patientId });
      if (r.ok) r.canChange = !session.proxy;
    } else if (sub === "comm-preference-set") {
      if (session.proxy) return json({ ok: false, error: "patient_only", detail: "Only the patient can change how the hospital contacts them." }, 403, request);
      r = await setPreference({ ...repo, dpdp: cfg && cfg.dpdp, patientId: session.patientId, channel: body.channel, optedIn: body.optedIn === true, mobile: body.mobile, source: "portal", by: session.readerId || `patient:${session.patientId}` });
    } else if (sub === "feedback-pending") {
      r = feedbackSettings(cfg && cfg.feedback).enabled ? await pendingSurveys({ ...repo, patientId: session.patientId }) : { ok: true, surveys: [] };
      if (r.ok) r.canAnswer = !session.proxy;
    } else {
      if (session.proxy) return json({ ok: false, error: "patient_only", detail: "Only the patient can answer their survey." }, 403, request);
      if (!feedbackSettings(cfg && cfg.feedback).enabled) return json({ ok: false, error: "not_found" }, 404, request);
      r = await submitSurvey({ ...repo, feedbackCfg: cfg && cfg.feedback, inviteId: body.inviteId, sessionPatientId: session.patientId, answers: body.answers });
    }
    return json(r, r.ok ? 200 : (r.status || 502), request);
  }

  return json({ ok: false, error: "not_found" }, 404, request);
}
