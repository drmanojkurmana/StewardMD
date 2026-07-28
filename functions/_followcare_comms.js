/* FollowCare AI — Doctor Action Center: SERVER layer (Phase-2 enhancement). Does the Firestore/R2/dispatch;
 * the pure model (../followcare-comms.js) owns validation + drafts. Every doctor action and patient response
 * is one entry in fc_comms/{id} (message bodies ENCRYPTED at rest via the existing PHI key) + an immutable
 * fc_events audit row. Notifications reuse the dispatcher; language reuses the i18n registry. No PHI in logs.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { encPHI, decPHI, getEpisode, verifyEpisodeToken, linkFor, audit, isConfigured } from "./_followcare.js";
import { sendPatientMessage } from "./_followcare_dispatch.js";
import Comms from "../followcare-comms.js";
import I18n from "../followcare-i18n.js";

function uuid() { return crypto.randomUUID(); }
function nowMs() { return Date.now(); }
function jparse(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }

function toComm(doc) {
  if (!doc) return null; const f = doc.fields || {};
  return {
    id: doc.id, updateTime: doc.updateTime, episodeId: f.episodeId, hospitalId: f.hospitalId,
    type: f.type, dir: f.dir, priority: f.priority || "normal", requiresResponse: f.requiresResponse || "",
    doctorName: f.doctorName || "", hospitalName: f.hospitalName || "",
    bodyEnc: f.bodyEnc || "", payload: jparse(f.payloadJson, {}), replyTo: f.replyTo || "",
    createdMs: f.createdMs || 0, status: f.status || "sent", readMs: f.readMs || 0, respondedMs: f.respondedMs || 0,
    langAtSend: f.langAtSend || "en",
  };
}

// The i18n notification key for each outbound action (English fallback always exists).
function notifyKey(type) {
  return ({
    emergency: "fc.msg.doctor_emergency", question: "fc.msg.doctor_question", vitals_request: "fc.msg.doctor_vitals",
    photo_request: "fc.msg.doctor_photo", earlier_review: "fc.msg.doctor_review", education: "fc.msg.doctor_education",
    close_episode: "fc.msg.doctor_closed",
  })[type] || "fc.msg.doctor_message";
}

// ---- doctor posts an action -------------------------------------------------------------
// ep = the loaded episode (route already checked tenant ownership). Returns { ok, commId } | { ok:false, error, fields }.
export async function postDoctorAction(env, ep, doctor, type, input) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const def = Comms.typeDef(type);
  if (!def || def.comingSoon) return { ok: false, error: "invalid_action" };
  const v = Comms.validateAction(type, input || {});
  if (!v.ok) return { ok: false, error: "invalid_action", fields: v.errors };

  const commId = uuid();
  const bodyEnc = v.value.body ? await encPHI(env, v.value.body) : "";
  const fields = {
    episodeId: ep.episodeId, hospitalId: ep.hospitalId, doctorUid: (doctor && doctor.uid) || "",
    doctorName: String((doctor && doctor.name) || "").slice(0, 120), hospitalName: String((doctor && doctor.hospitalName) || "").slice(0, 160),
    type: type, dir: "out", bodyEnc: bodyEnc, payloadJson: JSON.stringify(v.value.payload || {}).slice(0, 1500),
    priority: v.value.priority, requiresResponse: v.value.requiresResponse || "",
    createdMs: nowMs(), status: "sent", langAtSend: ep.lang || "en",
  };
  await fsCommit(env, [wCreate(env, "fc_comms/" + commId, fields)]);
  await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: "doctor:" + ((doctor && doctor.uid) || ""), action: "comm_" + type, meta: { commId: commId, priority: v.value.priority, payload: v.value.payload } });

  // Episode side-effect: closing the follow-up sets the episode status (recovered stays distinct).
  if (type === "close_episode") {
    const status = v.value.payload.reason === "recovered" ? "recovered" : "closed";
    try {
      await fsCommit(env, [wUpdate(env, "fc_episodes/" + ep.episodeId, { status: status, closedReason: v.value.payload.reason, closedMs: nowMs() }, ep.updateTime ? { updateTime: ep.updateTime } : { exists: true })]);
    } catch (e) {}
  }

  // Notify the patient (best-effort, PHI-light: a nudge + the opaque portal link; NO clinical body in the SMS).
  try {
    const link = await linkFor(env, ep);
    const body = I18n.t(notifyKey(type), ep.lang || "en", { link: link, hospital: fields.hospitalName });
    const res = await sendPatientMessage(env, ep, body, { link: link });
    const st = res && res.ok ? "delivered" : (res && res.skipped ? "sent" : "sent");
    try { await fsCommit(env, [wUpdate(env, "fc_comms/" + commId, { status: st }, { exists: true })]); } catch (e) {}
  } catch (e) {}

  return { ok: true, commId: commId };
}

// ---- patient responds (token-gated) -----------------------------------------------------
// kind ∈ acknowledge | reply | vitals | review | read | photo. commId links the response to a request.
export async function respondToComm(env, token, commId, kind, input) {
  const g = await verifyEpisodeToken(env, token);
  if (!g.ok) return { ok: false, error: g.error };
  const ep = g.ep;
  const v = Comms.validateResponse(kind, input || {});
  if (!v.ok) return { ok: false, error: "invalid_response", fields: v.errors };

  let ref = null;
  if (commId) {
    ref = toComm(await fsGet(env, "fc_comms/" + commId));
    if (!ref || ref.episodeId !== ep.episodeId) return { ok: false, error: "not_found" };
  }
  const respId = uuid();
  const respEnc = v.value.text ? await encPHI(env, v.value.text) : "";
  const payload = {};
  if (kind === "vitals") payload.vitals = v.value.vitals;
  if (kind === "photo") payload.mediaKeys = v.value.mediaKeys;
  if (kind === "review") payload.accepted = true;

  const writes = [wCreate(env, "fc_comms/" + respId, {
    episodeId: ep.episodeId, hospitalId: ep.hospitalId, type: kind, dir: "in",
    bodyEnc: respEnc, payloadJson: JSON.stringify(payload).slice(0, 1500), replyTo: commId || "",
    createdMs: nowMs(), status: "received", langAtSend: ep.lang || "en",
  })];
  // Mark the originating request as read/replied without regressing its status.
  if (ref) {
    const done = (kind === "acknowledge" || kind === "read") ? "read" : "replied";
    writes.push(wUpdate(env, "fc_comms/" + commId, { status: Comms.advanceStatus(ref.status, done), readMs: ref.readMs || nowMs(), respondedMs: nowMs() }, { exists: true }));
  }
  await fsCommit(env, writes);
  await audit(env, { hospitalId: ep.hospitalId, episodeId: ep.episodeId, actor: "patient", action: "resp_" + kind, meta: { commId: commId || "", kind: kind } });
  return { ok: true, id: respId };
}

// ---- doctor-facing: full communication history (decrypted) ------------------------------
export async function listComms(env, episodeId) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const rows = await fsQuery(env, "fc_comms", { where: { field: "episodeId", value: String(episodeId) }, limit: 500 });
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const c = toComm(rows[i]);
    let body = "";
    if (c.bodyEnc) { try { body = await decPHI(env, c.bodyEnc); } catch (e) { body = ""; } }
    items.push({
      id: c.id, type: c.type, dir: c.dir, body: body, payload: c.payload, priority: c.priority,
      requiresResponse: c.requiresResponse, status: c.status, createdMs: c.createdMs, respondedMs: c.respondedMs,
      doctorName: c.doctorName, hospitalName: c.hospitalName, replyTo: c.replyTo,
    });
  }
  return { ok: true, items: Comms.sortLog(items) };
}

// ---- patient-facing inbox (token-gated): doctor→patient messages, decrypted ------------
export async function patientInbox(env, token) {
  const g = await verifyEpisodeToken(env, token);
  if (!g.ok) return { ok: false, error: g.error };
  const ep = g.ep;
  const rows = await fsQuery(env, "fc_comms", { where: { field: "episodeId", value: ep.episodeId }, limit: 500 });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const c = toComm(rows[i]);
    if (c.dir !== "out") continue;
    let body = "";
    if (c.bodyEnc) { try { body = await decPHI(env, c.bodyEnc); } catch (e) { body = ""; } }
    out.push({
      id: c.id, type: c.type, body: body, payload: c.payload, priority: c.priority,
      requiresResponse: c.requiresResponse, status: c.status, createdMs: c.createdMs,
      doctorName: c.doctorName, hospitalName: c.hospitalName,
    });
  }
  return { ok: true, lang: ep.lang || "en", items: Comms.sortLog(out) };
}

// ---- photo upload (patient token) → Cloudflare R2 (binding FOLLOWCARE_R2) ---------------
// Data-minimisation by design: photos are PHI, so we keep them only as briefly as the treating team needs.
// Each object carries an expiry stamp; it's auto-deleted by an R2 lifecycle rule (owner-set), app-enforced
// on read, purged on episode erasure/closure, and can be made view-once. Direct binding put (no S3 presign).
export function photoTtlDays(env) { var d = parseInt((env && env.FOLLOWCARE_PHOTO_TTL_DAYS) || "7", 10); return (isFinite(d) && d > 0) ? d : 7; }
export async function uploadPhoto(env, token, commId, contentType, byteLength, bodyStream) {
  const g = await verifyEpisodeToken(env, token);
  if (!g.ok) return { ok: false, error: g.error };
  if (!env || !env.FOLLOWCARE_R2) return { ok: false, error: "media_not_configured" };
  const chk = Comms.photoOk(contentType, byteLength);
  if (!chk.ok) return { ok: false, error: chk.reason };
  const key = "followcare/" + g.ep.episodeId + "/" + (commId || "adhoc") + "/" + uuid() + "." + chk.ext;
  const expiresMs = nowMs() + photoTtlDays(env) * 86400000;
  try {
    await env.FOLLOWCARE_R2.put(key, bodyStream, { httpMetadata: { contentType: contentType }, customMetadata: { episodeId: g.ep.episodeId, commId: commId || "", expiresMs: String(expiresMs) } });
  } catch (e) { return { ok: false, error: "upload_failed" }; }
  await audit(env, { hospitalId: g.ep.hospitalId, episodeId: g.ep.episodeId, actor: "patient", action: "photo_upload", meta: { commId: commId || "", expiresMs: expiresMs } });
  return { ok: true, key: key, expiresMs: expiresMs };
}

// ---- doctor fetches an uploaded photo (route enforces tenant auth) ----------------------
// Returns { contentType, body } | null. App-enforces expiry (never serves a photo past its TTL, deleting it)
// as a belt-and-suspenders complement to the R2 lifecycle rule; supports optional view-once deletion.
export async function getMedia(env, key) {
  if (!env || !env.FOLLOWCARE_R2) return null;
  let obj;
  try { obj = await env.FOLLOWCARE_R2.get(String(key)); } catch (e) { return null; }
  if (!obj) return null;
  const meta = obj.customMetadata || {};
  const contentType = (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  const exp = parseInt(meta.expiresMs || "0", 10);
  if (exp && nowMs() > exp) { try { await env.FOLLOWCARE_R2.delete(String(key)); } catch (e) {} return null; }   // expired → purge + gone
  if (String((env && env.FOLLOWCARE_PHOTO_VIEW_ONCE) || "") === "1") {                                          // view-once: serve then delete
    const buf = await obj.arrayBuffer();
    try { await env.FOLLOWCARE_R2.delete(String(key)); } catch (e) {}
    return { contentType: contentType, body: buf };
  }
  return { contentType: contentType, body: obj.body };
}

// Purge every uploaded photo for an episode (right-to-erasure / closure). Returns count. Never throws.
export async function purgeEpisodeMedia(env, episodeId) {
  if (!env || !env.FOLLOWCARE_R2) return 0;
  let n = 0, cursor;
  try {
    do {
      const list = await env.FOLLOWCARE_R2.list({ prefix: "followcare/" + episodeId + "/", cursor: cursor });
      for (const o of (list.objects || [])) { try { await env.FOLLOWCARE_R2.delete(o.key); n++; } catch (e) {} }
      cursor = list.truncated ? list.cursor : null;
    } while (cursor);
  } catch (e) {}
  return n;
}

// ---- AI draft (doctor-side; deterministic template now, Vertex/Gemini seam later) -------
// The doctor ALWAYS reviews/edits/discards — this only produces a suggestion, never sends.
export function draftFor(kind, ctx) { return Comms.draft(kind, ctx || {}); }
