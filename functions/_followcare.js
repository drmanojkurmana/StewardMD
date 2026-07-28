/* StewardMD · FollowCare AI — server service layer (Pages Functions, service-account).
 *
 * The ONE place FollowCare episode data is created/read/updated. Everything runs server-side with the
 * Firestore service account (client rules stay deny-all), so every read/write is server-validated and
 * multi-tenant scoped by hospitalId. Patients never authenticate — they reach their episode through an
 * opaque, signed, expiring, revocable link token that carries NO PHI (just an unguessable episode id).
 *
 * Reuse-first: episodes live in Firestore via _fbfirestore (no new binding); the deterministic clinical
 * decision is the SAME FollowCareEngine the client uses (single source of truth — imported here, run
 * authoritatively on the server so a tampered client can never fake a "green"); scheduling is the shared
 * pure FollowCareSchedule; rate-limit KV reuses usageKv. SMS/Queue are the messaging module (Phase 1 later).
 *
 * PHI posture: phone/name/mrn are AES-256-GCM encrypted at rest (FOLLOWCARE_PHI_KEY). Clinical answers
 * (symptoms/vitals) are NOT identifiers and are stored in the clear but access-controlled. No PHI ever
 * appears in a URL, SMS, log line, or the link token. The AI never changes therapy — it only scores.
 *
 * Env required (owner provisions):
 *   FIREBASE_SERVICE_ACCOUNT   — already set (reused)
 *   FOLLOWCARE_TOKEN_SECRET    — HMAC secret for link tokens (>=32 random chars). REQUIRED (fails closed).
 *   FOLLOWCARE_PHI_KEY         — base64 32-byte AES key for PHI-at-rest. REQUIRED to enroll (fails closed).
 *   FOLLOWCARE_LINK_BASE       — optional, default https://stewardmd.in/followcare
 *   FOLLOWCARE_KV              — optional; falls back to usageKv (rate-limits only)
 *
 * Firestore collections (all service-account only):
 *   fc_episodes/{episodeId}    fc_assessments/{episodeId}_{dayOffset}    fc_events/{uuid}    fc_delivery/{uuid}
 */
import { fsGet, fsCommit, fsQuery, wCreate, wUpdate, wDelete } from "./_fbfirestore.js";
import { usageKv } from "./_usage.js";
import Pathways from "../followcare-pathways.js";
import Engine from "../followcare-engine.js";
import Assessment from "../followcare-assessment.js";
import Schedule from "../followcare-schedule.js";
import AI from "../followcare-ai.js";
import I18n from "../followcare-i18n.js";

export function fcKv(env) { return (env && env.FOLLOWCARE_KV) || usageKv(env); }
export function linkBase(env) { return (env && env.FOLLOWCARE_LINK_BASE) || "https://stewardmd.in/followcare"; }

// ---- byte / base64url helpers ----------------------------------------------------------
const enc = new TextEncoder(), dec = new TextDecoder();
function b64urlFromBytes(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function bytesFromB64url(str) { let s = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function hex(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0"); return s; }

// ---- link token (HMAC, no PHI): base64url(episodeId.exp) . base64url(sig) ---------------
async function hmacKey(secret) { return crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
function tokenSecret(env) { const s = env && env.FOLLOWCARE_TOKEN_SECRET; if (!s || String(s).length < 32) throw Object.assign(new Error("token_secret_missing"), { code: "config", status: 500 }); return s; }
// Whether the two required secrets are present. When false, FollowCare degrades gracefully to a clean
// "being set up" state (no 500s) — the flag can be ON before provisioning without a broken doctor experience.
export function isConfigured(env) {
  return !!(env && env.FOLLOWCARE_TOKEN_SECRET && String(env.FOLLOWCARE_TOKEN_SECRET).length >= 32 && env.FOLLOWCARE_PHI_KEY);
}
export const CONSENT_VERSION = "fc-consent-v1";

// Sign a link token. payload = { episodeId, exp(ms), ver }. ver is the episode's tokenVer (revocation).
export async function signToken(payload, secret) {
  const body = payload.episodeId + "." + payload.exp;
  const k = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body + "." + payload.ver)));
  return b64urlFromBytes(enc.encode(body)) + "." + b64urlFromBytes(sig);
}
// Structural parse of the episode id from a token WITHOUT verifying the signature. Used only to load the
// episode (and its current tokenVer) before the authoritative signed verify. Never grants access by itself.
export function episodeIdFromToken(token) {
  try { const body = dec.decode(bytesFromB64url(String(token).split(".")[0])); const i = body.lastIndexOf("."); return i > 0 ? body.slice(0, i) : ""; }
  catch (e) { return ""; }
}
// Verify + parse a link token against the current tokenVer + expiry. Returns { ok, episodeId, reason }.
export async function verifyToken(token, secret, curVer, nowMs) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed" };
    const body = dec.decode(bytesFromB64url(parts[0]));
    const bi = body.lastIndexOf(".");
    const episodeId = body.slice(0, bi), exp = Number(body.slice(bi + 1));
    if (!episodeId || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
    const k = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", k, bytesFromB64url(parts[1]), enc.encode(body + "." + curVer));
    if (!ok) return { ok: false, reason: "bad_signature" };       // wrong secret OR revoked (ver bumped)
    if (typeof nowMs === "number" && exp < nowMs) return { ok: false, reason: "expired", episodeId };
    return { ok: true, episodeId };
  } catch (e) { return { ok: false, reason: "malformed" }; }
}

// ---- PHI at rest (AES-256-GCM). blob = base64url(iv[12] || ciphertext). Fails closed. ----
async function phiKey(env) {
  const raw = env && env.FOLLOWCARE_PHI_KEY;
  if (!raw) throw Object.assign(new Error("phi_key_missing"), { code: "config", status: 500 });
  const bytes = bytesFromB64url(raw);
  if (bytes.length !== 32) throw Object.assign(new Error("phi_key_bad_length"), { code: "config", status: 500 });
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encPHI(env, plaintext) {
  if (plaintext == null || plaintext === "") return "";
  const key = await phiKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext))));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv, 0); out.set(ct, iv.length);
  return b64urlFromBytes(out);
}
export async function decPHI(env, blob) {
  if (!blob) return "";
  const key = await phiKey(env);
  const all = bytesFromB64url(blob), iv = all.slice(0, 12), ct = all.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}
// Canonical phone for dedupe: digits only, and (India-first) the last 10 digits when a country code is
// present, so "+91 98765 43210", "919876543210" and "9876543210" resolve to the SAME patient. The full
// number (with country code) is still stored encrypted for dialing — only the DEDUPE key is canonicalised.
export function canonPhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
// Non-reversible tenant-scoped patient key for dedupe/lookup (never reveals the phone).
export async function patientKeyHash(hospitalId, phone) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(String(hospitalId || "") + "|" + canonPhone(phone)));
  return hex(new Uint8Array(d));
}

// ---- audit + delivery logs (append-only) ------------------------------------------------
function uuid() { return crypto.randomUUID(); }
export async function audit(env, ev) {
  try {
    await fsCommit(env, [wCreate(env, "fc_events/" + uuid(), {
      ts: (ev && ev.ts) || Date.now(), hospitalId: ev.hospitalId || "", episodeId: ev.episodeId || "",
      actor: ev.actor || "system", action: ev.action || "", meta: ev.meta ? JSON.stringify(ev.meta).slice(0, 900) : "",
    })]);
  } catch (e) { try { console.warn("[followcare] audit failed", String(e && e.code || e)); } catch (x) {} }
}
export async function recordDelivery(env, d) {
  try {
    await fsCommit(env, [wCreate(env, "fc_delivery/" + uuid(), {
      ts: d.ts || Date.now(), episodeId: d.episodeId || "", hospitalId: d.hospitalId || "",
      channel: d.channel || "", toMasked: d.toMasked || "", status: d.status || "", providerId: d.providerId || "", error: d.error || "",
    })]);
  } catch (e) { try { console.warn("[followcare] delivery-log failed", String(e && e.code || e)); } catch (x) {} }
}

// ---- episode decode + non-PHI summary ---------------------------------------------------
function jparse(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function toEpisode(doc) {
  if (!doc) return null; const f = doc.fields || {};
  return {
    episodeId: doc.id, updateTime: doc.updateTime, hospitalId: f.hospitalId, doctorUid: f.doctorUid, pathwayId: f.pathwayId, disease: f.disease,
    status: f.status, dischargeMs: f.dischargeMs, createdMs: f.createdMs, lang: f.lang || "en", langConfirmed: !!f.langConfirmed, sendHour: f.sendHour, tz: f.tz || "Asia/Kolkata",
    tokenVer: f.tokenVer || 1, schedule: jparse(f.scheduleJson, []), lastDayDone: (f.lastDayDone == null ? -1 : f.lastDayDone),
    nextDueMs: f.nextDueMs || 0, lastEscalation: f.lastEscalation || "", peakEscalation: f.peakEscalation || "", lastScore: (f.lastScore == null ? null : f.lastScore),
    lastConfidence: f.lastConfidence || "", lastRisk: f.lastRisk || "", lastTrend: f.lastTrend || "", needsReview: !!f.needsReview, lastAnswers: jparse(f.lastAnswersJson, null), recoveredMs: f.recoveredMs || 0, ackMs: f.ackMs || 0, patientKeyHash: f.patientKeyHash || "",
    lastSentDay: (f.lastSentDay == null ? -1 : f.lastSentDay), lastSentMs: f.lastSentMs || 0, lastMissedEscalated: (f.lastMissedEscalated == null ? -1 : f.lastMissedEscalated),
    isMinor: !!f.isMinor, consentVersion: f.consentVersion || "",
    _phi: { phoneEnc: f.phoneEnc || "", nameEnc: f.nameEnc || "", guardianEnc: f.guardianEnc || "" },
  };
}
// Escalation ordering. worstEsc keeps the highest-severity level of two (used to keep a prior red visible
// on the clinician board even after a later green check-in, until the clinician acknowledges it).
const ESC_RANK = { red: 3, orange: 2, yellow: 1, green: 0, "": -1 };
export function worstEsc(a, b) { return (ESC_RANK[a] == null ? -1 : ESC_RANK[a]) >= (ESC_RANK[b] == null ? -1 : ESC_RANK[b]) ? (a || "") : (b || ""); }
// A summary safe to send to a clinician dashboard (no phone/name/mrn). `escalation` is the WORST level
// since the last clinician acknowledgement (board ranking + never hides a prior red); `currentEscalation`
// is the latest check-in's level (shown in the detail view).
export function episodeSummary(ep) {
  if (!ep) return null;
  const board = worstEsc(ep.peakEscalation || "", ep.lastEscalation || "");
  return {
    episodeId: ep.episodeId, disease: ep.disease, pathwayId: ep.pathwayId, specialty: (Pathways.get(ep.pathwayId) || {}).specialty || "",
    status: ep.status, dischargeMs: ep.dischargeMs, createdMs: ep.createdMs, lastDayDone: ep.lastDayDone, nextDueMs: ep.nextDueMs,
    escalation: board, currentEscalation: ep.lastEscalation, score: ep.lastScore, confidence: ep.lastConfidence,
    risk: ep.lastRisk, trend: ep.lastTrend, riskPercent: AI.riskPercent({ readmissionRisk: ep.lastRisk, recoveryScore: ep.lastScore, trend: ep.lastTrend, confidence: ep.lastConfidence, escalation: ep.lastEscalation }),
    needsReview: !!ep.needsReview, recoveredMs: ep.recoveredMs,
  };
}
// All episode summaries for a hospital (or the whole tenant set) — feeds the Phase-3 analytics/dashboards.
export async function listAllSummaries(env, hospitalId) {
  const rows = hospitalId
    ? await fsQuery(env, "fc_episodes", { where: { field: "hospitalId", value: hospitalId }, limit: 2000 })
    : await fsQuery(env, "fc_episodes", { limit: 2000 });
  return rows.map(function (d) { return episodeSummary(toEpisode(d)); });
}

// Questions a patient MUST answer for a submit to score (server-enforced, not just in the browser): the
// overall question, every global emergency probe, and every ANSWERABLE (non-numeric) red/orange question.
// Numeric vitals (SpO2/glucose/BP/weight) stay optional but the engine blocks Green when they are missing.
function present(v) { return !(v == null || String(v).trim() === ""); }
function requiredForSubmit(pw) {
  const req = ["overall"];
  (pw.questions || []).forEach(function (q) {
    if ((q.redFlag || q.redFlags) && q.type !== "number") req.push(q.id);
  });
  (Pathways.GLOBAL_RED || []).forEach(function (g) { req.push(g.id); });
  return req;
}
export async function getEpisode(env, episodeId) { return toEpisode(await fsGet(env, "fc_episodes/" + String(episodeId))); }

// ---- enroll -----------------------------------------------------------------------------
// Creates an episode + returns its patient link (token). Requires a valid pathway + future/near discharge.
export async function enrollEpisode(env, p) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const nowMs = Date.now();
  const pw = Pathways.get(p.pathwayId);
  if (!pw) return { ok: false, error: "bad_pathway" };
  if (!p.hospitalId || !p.doctorUid) return { ok: false, error: "missing_tenant" };
  const phoneDigits = String(p.phone || "").replace(/[^\d]/g, "");
  if (phoneDigits.length < 8) return { ok: false, error: "bad_phone" };
  // DPDP: the doctor must attest the patient was given notice + consented before we process/message them.
  if (!p.consentAttested) return { ok: false, error: "consent_required" };
  // DPDP §9: a minor requires a guardian's phone (all messaging goes to the guardian, never the child).
  const isMinor = !!p.isMinor;
  const guardianDigits = String(p.guardianPhone || "").replace(/[^\d]/g, "");
  if (isMinor && guardianDigits.length < 8) return { ok: false, error: "guardian_required" };
  const dischargeMs = Number(p.dischargeMs) || nowMs;
  const sendHour = (typeof p.sendHour === "number") ? p.sendHour : 9;
  const schedule = Schedule.scheduleFor(p.pathwayId, dischargeMs, { pathways: Pathways, sendHour });
  const firstDue = schedule.find(function (s) { return s.dueAtMs >= nowMs; }) || schedule[0] || null;

  const episodeId = uuid();
  const secret = tokenSecret(env);
  // Data minimisation: store only what follow-up needs — encrypted phone + first-name-for-greeting +
  // (if minor) guardian phone. MRN is NOT collected/stored in Phase 1 (no processing purpose for it).
  const [phoneEnc, nameEnc, guardianEnc, pkh] = await Promise.all([
    encPHI(env, phoneDigits), encPHI(env, p.name || ""), encPHI(env, isMinor ? guardianDigits : ""), patientKeyHash(p.hospitalId, phoneDigits),
  ]);
  const fields = {
    hospitalId: p.hospitalId, doctorUid: p.doctorUid, pathwayId: p.pathwayId, disease: pw.name,
    status: "active", dischargeMs, createdMs: nowMs, lang: p.lang || "en", sendHour, tz: p.tz || "Asia/Kolkata",
    tokenVer: 1, scheduleJson: JSON.stringify(schedule), lastDayDone: -1, nextDueMs: firstDue ? firstDue.dueAtMs : 0,
    lastEscalation: "", lastScore: -1, lastConfidence: "", recoveredMs: 0,
    isMinor, consentVersion: CONSENT_VERSION, consentAttestedMs: nowMs, consentBy: "doctor:" + p.doctorUid,
    patientKeyHash: pkh, phoneEnc, nameEnc, guardianEnc,
  };
  await fsCommit(env, [wCreate(env, "fc_episodes/" + episodeId, fields)]);
  const expDays = Number(env.FOLLOWCARE_LINK_TTL_DAYS) || 45;
  const token = await signToken({ episodeId, exp: nowMs + expDays * 86400000, ver: 1 }, secret);
  await audit(env, { hospitalId: p.hospitalId, episodeId, actor: "doctor:" + p.doctorUid, action: "enroll", meta: { pathwayId: p.pathwayId, consentVersion: CONSENT_VERSION, isMinor } });
  return { ok: true, episodeId, link: linkBase(env) + "?t=" + token, token, nextDueMs: fields.nextDueMs, disease: pw.name };
}

// Regenerate the patient link (e.g. resend). Does NOT bump ver — same link stays valid.
export async function linkFor(env, ep) {
  const nowMs = Date.now();
  const expDays = Number(env.FOLLOWCARE_LINK_TTL_DAYS) || 45;
  const token = await signToken({ episodeId: ep.episodeId, exp: nowMs + expDays * 86400000, ver: ep.tokenVer || 1 }, tokenSecret(env));
  return linkBase(env) + "?t=" + token;
}
// Revoke every outstanding link for an episode (bump tokenVer). Old tokens then fail verification.
export async function revokeLinks(env, episodeId, actor) {
  const ep = await getEpisode(env, episodeId); if (!ep) return { ok: false, error: "not_found" };
  await fsCommit(env, [wUpdate(env, "fc_episodes/" + episodeId, { tokenVer: (ep.tokenVer || 1) + 1 }, { exists: true })]);
  await audit(env, { hospitalId: ep.hospitalId, episodeId, actor: actor || "system", action: "revoke_links" });
  return { ok: true };
}

// ---- erasure (DPDP §13 right to be forgotten) ------------------------------------------
// Permanently deletes an episode + all its assessments + delivery-log rows, then writes a minimal NON-PHI
// tombstone to fc_events for accountability. Used by the enrolling clinician, the owner, and (via the portal)
// the patient themselves. Idempotent — a second call on an already-erased episode still succeeds.
export async function eraseEpisode(env, episodeId, actor) {
  const ep = await getEpisode(env, episodeId);
  const hospitalId = ep ? ep.hospitalId : "";
  const writes = [];
  const assessments = await fsQuery(env, "fc_assessments", { where: { field: "episodeId", value: episodeId }, limit: 200 });
  assessments.forEach(function (d) { writes.push(wDelete(env, "fc_assessments/" + d.id)); });
  const deliveries = await fsQuery(env, "fc_delivery", { where: { field: "episodeId", value: episodeId }, limit: 200 });
  deliveries.forEach(function (d) { writes.push(wDelete(env, "fc_delivery/" + d.id)); });
  if (ep) writes.push(wDelete(env, "fc_episodes/" + episodeId));
  if (writes.length) await fsCommit(env, writes);
  // Tombstone carries NO PHI — just that this episode's data was erased, when, and by whom.
  await audit(env, { hospitalId, episodeId, actor: actor || "system", action: "erased", meta: { assessments: assessments.length, deliveries: deliveries.length } });
  return { ok: true, erased: !!ep, assessments: assessments.length };
}
// Patient-initiated erasure from the portal (DPDP §13): verifies the link token, then erases. Lets a
// patient with no account exercise their right to be forgotten (and doubles as the messaging opt-out).
export async function forgetViaToken(env, token) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const episodeId = episodeIdFromToken(token);
  if (!episodeId) return { ok: false, error: "invalid_link" };
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: true, erased: false };
  const v = await verifyToken(token, tokenSecret(env), ep.tokenVer || 1, Date.now());
  if (!v.ok) return { ok: false, error: v.reason === "expired" ? "link_expired" : "invalid_link" };
  return eraseEpisode(env, episodeId, "patient");
}

// ---- patient portal (token-gated, no login) --------------------------------------------
// The episode + the questionnaire for the day that is due now. No PHI beyond first name (for greeting).
export async function portalContext(env, token) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const secret = tokenSecret(env);
  // Structurally parse the episode id (unauthenticated) only to LOAD the episode + its current tokenVer;
  // the real cryptographic verify below is what actually authorises access.
  const episodeId = episodeIdFromToken(token);
  if (!episodeId) return { ok: false, error: "invalid_link" };
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: false, error: "invalid_link" };
  const v = await verifyToken(token, secret, ep.tokenVer || 1, Date.now());
  if (!v.ok) return { ok: false, error: v.reason === "expired" ? "link_expired" : "invalid_link" };
  if (ep.status === "closed") return { ok: false, error: "closed" };

  const day = currentDueDay(ep, Date.now());
  if (day == null) {
    // Nothing is due right now: DO NOT serve a future day's questionnaire (that let a patient fast-forward
    // the whole schedule and prematurely close the episode). Tell the portal when the next check-in opens.
    const nxt = nextScheduled(ep);
    return { ok: true, nothingDue: true, episodeId: ep.episodeId, disease: ep.disease, lang: ep.lang, langConfirmed: ep.langConfirmed, status: ep.status, nextDueMs: nxt ? nxt.dueAtMs : 0, recovered: ep.status === "recovered" };
  }
  const questionnaire = Assessment.buildAssessment(ep.pathwayId, day, { pathways: Pathways });
  return {
    // No PHI in a token-gated reply: the greeting is generic (a stolen link must not reveal the patient's name).
    ok: true, episodeId: ep.episodeId, disease: ep.disease, dayOffset: day, lang: ep.lang, langConfirmed: ep.langConfirmed,
    status: ep.status, questionnaire,
  };
}

// Patient sets their preferred portal language (token-gated, no login). Persists lang + marks it confirmed so
// the first-run prompt is never shown again. `lang` is validated against the i18n catalogue; unknown → English.
export async function setPortalLanguage(env, token, lang) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const episodeId = episodeIdFromToken(token);
  if (!episodeId) return { ok: false, error: "invalid_link" };
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: false, error: "invalid_link" };
  const v = await verifyToken(token, tokenSecret(env), ep.tokenVer || 1, Date.now());
  if (!v.ok) return { ok: false, error: v.reason === "expired" ? "link_expired" : "invalid_link" };
  const code = (I18n && I18n.isSupported && I18n.isSupported(lang)) ? lang : "en";
  await fsCommit(env, [wUpdate(env, "fc_episodes/" + episodeId, { lang: code, langConfirmed: true }, ep.updateTime ? { updateTime: ep.updateTime } : { exists: true })]);
  return { ok: true, lang: code };
}

// The dayOffset the patient may answer NOW: the earliest scheduled day that is BOTH due (dueAtMs <= now)
// AND not yet answered (dayOffset > lastDayDone). Returns null when nothing is currently due — the portal
// must never advance the schedule to a day whose dueAtMs is still in the future.
export function currentDueDay(ep, nowMs) {
  const done = ep.lastDayDone == null ? -1 : ep.lastDayDone;
  const due = (ep.schedule || []).filter(function (s) { return s.dueAtMs <= nowMs && s.dayOffset > done; });
  return due.length ? due[0].dayOffset : null;
}
// The next not-yet-answered scheduled entry (regardless of due time) — for "your next check-in opens on …".
export function nextScheduled(ep) {
  const done = ep.lastDayDone == null ? -1 : ep.lastDayDone;
  return (ep.schedule || []).find(function (s) { return s.dayOffset > done; }) || null;
}

// Submit answers for the due day. Runs the deterministic engine AUTHORITATIVELY (client score is ignored),
// persists the assessment, advances the episode, and returns the safe patient message + clinician-notify plan.
export async function submitPortalAssessment(env, token, answers) {
  if (!isConfigured(env)) return { ok: false, error: "not_configured" };
  const secret = tokenSecret(env);
  const episodeId = episodeIdFromToken(token);
  if (!episodeId) return { ok: false, error: "invalid_link" };
  const ep = await getEpisode(env, episodeId);
  if (!ep) return { ok: false, error: "invalid_link" };
  const v = await verifyToken(token, secret, ep.tokenVer || 1, Date.now());
  if (!v.ok) return { ok: false, error: v.reason === "expired" ? "link_expired" : "invalid_link" };
  if (ep.status === "closed") return { ok: false, error: "closed" };

  // Pin the target day to the CURRENTLY-due one (never a future day). If nothing is due, refuse — this is
  // what stops a patient (or anyone with the link) from answering ahead and fast-forwarding the schedule.
  const day = currentDueDay(ep, Date.now());
  if (day == null) return { ok: false, error: "nothing_due" };
  answers = answers || {};

  // Server-side completeness gate (never trust the browser): the emergency probes + answerable red-flag
  // questions MUST be answered before we score, so a scripted/partial submit can't skip the red flags.
  const pw = Pathways.get(ep.pathwayId);
  if (!pw) return { ok: false, error: "bad_pathway" };
  const missingReq = requiredForSubmit(pw).filter(function (id) { return !present(answers[id]); });
  if (missingReq.length) return { ok: false, error: "incomplete", missing: missingReq };

  const prev = (ep.lastScore != null && ep.lastScore >= 0) ? ep.lastScore : undefined;
  const scored = Assessment.scoreAssessment(ep.pathwayId, answers, {
    engine: Engine, pathways: Pathways, dayOffset: day, previousScore: prev, previousAnswers: ep.lastAnswers || undefined, answers: answers,
  });
  if (!scored) return { ok: false, error: "score_failed" };
  const r = scored.result, nowMs = Date.now();

  // Keep the worst unacknowledged escalation on the board so a later green never hides an earlier red.
  const peak = worstEsc(ep.peakEscalation || "", r.escalation);
  const peakSevere = peak === "red" || peak === "orange";
  const nextStatus = (scored.recovered && !peakSevere) ? "recovered"
    : (r.escalation === "red" || r.escalation === "orange" || peakSevere) ? "escalated"
    : "active";

  // Phase 2 — the AI decides WHEN to check in next (sooner when deteriorating, spaced out when improving).
  const ai = AI.nextInterval(r, pw, day);
  const adaptiveNextMs = (r.escalation === "red") ? 0
    : (ai.deltaHours ? nowMs + ai.deltaHours * 3600000
      : (ai.dayOffset != null ? nextDueMsFor(ep, ai.dayOffset)
        : (scored.nextDay != null ? nextDueMsFor(ep, scored.nextDay) : 0)));

  // Persist the assessment (clinical answers are not identifiers). Two preconditions make a retry safe:
  //  • fc_assessments create with exists:false → the SAME day can't be written twice (exactly-once).
  //  • the episode update is guarded on the doc being UNCHANGED since we read it (updateTime) → a racing
  //    or retried request that already advanced the episode fails the precondition instead of double-applying.
  const aId = "fc_assessments/" + episodeId + "_" + day;
  const writes = [
    wCreate(env, aId, {
      episodeId, hospitalId: ep.hospitalId, dayOffset: day, submittedMs: nowMs,
      answersJson: JSON.stringify(answers || {}).slice(0, 4000), score: r.recoveryScore, escalation: r.escalation,
      confidence: r.confidence, trend: r.trend, readmissionRisk: r.readmissionRisk,
      redFlagsJson: JSON.stringify(r.redFlags || []).slice(0, 2000), reasonsJson: JSON.stringify(r.reasons || []).slice(0, 2000),
    }),
    wUpdate(env, "fc_episodes/" + episodeId, {
      lastDayDone: day, lastEscalation: r.escalation, peakEscalation: peak, lastScore: r.recoveryScore, lastConfidence: r.confidence,
      lastRisk: r.readmissionRisk, lastTrend: r.trend, needsReview: !!r.needsReview, lastAnswersJson: JSON.stringify(answers).slice(0, 4000),
      nextDueMs: adaptiveNextMs,
      status: nextStatus, recoveredMs: (scored.recovered && !peakSevere) ? nowMs : (ep.recoveredMs || 0),
    }, ep.updateTime ? { updateTime: ep.updateTime } : { exists: true }),
  ];
  try { await fsCommit(env, writes); }
  catch (e) { if (e && e.code === "precondition") return { ok: false, error: "already_submitted" }; throw e; }

  await audit(env, { hospitalId: ep.hospitalId, episodeId, actor: "patient", action: "assessment", meta: { day, escalation: r.escalation, score: r.recoveryScore } });
  const route = Schedule.escalationToNotify(r.escalation);
  return {
    ok: true, escalation: r.escalation, patientMessage: scored.patientMessage, recovered: scored.recovered,
    notify: route.notify, notifyPlan: route, result: episodeSummaryFromResult(ep, r), dayOffset: day,
  };
}
function nextDueMsFor(ep, nextDay) {
  const s = (ep.schedule || []).find(function (x) { return x.dayOffset === nextDay; });
  return s ? s.dueAtMs : 0;
}
function episodeSummaryFromResult(ep, r) {
  return { episodeId: ep.episodeId, disease: ep.disease, escalation: r.escalation, score: r.recoveryScore, confidence: r.confidence, redFlags: r.redFlags };
}

// ---- clinician queries (tenant-scoped) --------------------------------------------------
// Episodes a doctor enrolled (single-field index on doctorUid; beta volumes tiny). Non-PHI summaries.
export async function listEpisodesForDoctor(env, doctorUid, opts) {
  const rows = await fsQuery(env, "fc_episodes", { where: { field: "doctorUid", value: doctorUid }, limit: (opts && opts.limit) || 200 });
  return rows.map(function (d) { return episodeSummary(toEpisode(d)); })
    .sort(function (a, b) { return (rank(b.escalation) - rank(a.escalation)) || (b.nextDueMs - a.nextDueMs); });
}
function rank(e) { return e === "red" ? 3 : e === "orange" ? 2 : e === "yellow" ? 1 : 0; }

// ---- doctor → hospital binding (tenant authority) ---------------------------------------
// The enrolling doctor's hospital is resolved SERVER-SIDE from this uid-keyed binding, never trusted from
// the request body — otherwise a doctor could enroll patients under (and pollute the stats of) any hospital
// id they typed. P1: the doctor sets their own affiliation (self-service). P2 hardening: gate this behind an
// approved hospital-membership (tie into /api/hospital-request approval) before it counts as authoritative.
export async function resolveDoctorHospital(env, uid) {
  const d = await fsGet(env, "fc_doctors/" + String(uid));
  if (!d || !d.fields || !d.fields.hospitalId) return null;
  return { hospitalId: d.fields.hospitalId, hospitalName: d.fields.hospitalName || "" };
}
export async function setDoctorHospital(env, uid, info) {
  const hospitalId = String((info && info.hospitalId) || "").trim();
  if (!hospitalId) return { ok: false, error: "missing_hospitalId" };
  await fsCommit(env, [wUpdate(env, "fc_doctors/" + String(uid), { hospitalId, hospitalName: (info.hospitalName || "").slice(0, 160), updatedMs: Date.now() })]);
  await audit(env, { hospitalId, actor: "doctor:" + uid, action: "set_hospital" });
  return { ok: true, hospitalId, hospitalName: info.hospitalName || "" };
}

// Clinician acknowledges an episode: clears the peak escalation back to the current level and un-sticks the
// status, so an escalated episode can leave the "needs review" list only by a deliberate clinician action.
export async function acknowledgeEpisode(env, episodeId, actor) {
  const ep = await getEpisode(env, episodeId); if (!ep) return { ok: false, error: "not_found" };
  const cur = ep.lastEscalation || "";
  const status = ep.recoveredMs ? "recovered" : (cur === "red" || cur === "orange") ? "escalated" : "active";
  await fsCommit(env, [wUpdate(env, "fc_episodes/" + episodeId, { peakEscalation: cur, ackMs: Date.now(), status }, ep.updateTime ? { updateTime: ep.updateTime } : { exists: true })]);
  await audit(env, { hospitalId: ep.hospitalId, episodeId, actor: actor || "system", action: "acknowledge" });
  return { ok: true, status };
}

// The assessment history for one episode (clinician view).
export async function episodeTimeline(env, episodeId) {
  const rows = await fsQuery(env, "fc_assessments", { where: { field: "episodeId", value: episodeId }, limit: 60 });
  return rows.map(function (d) {
    const f = d.fields || {};
    return { dayOffset: f.dayOffset, submittedMs: f.submittedMs, score: f.score, escalation: f.escalation, confidence: f.confidence, trend: f.trend, redFlags: jparse(f.redFlagsJson, []), reasons: jparse(f.reasonsJson, []) };
  }).sort(function (a, b) { return a.dayOffset - b.dayOffset; });
}
