/* functions/_queue_engine.js — Smart OPD Queue engine: Firestore orchestration over the pure logic in
 * _queue_eta.js. All writes go through the service account (deny-all client rules). PHI (name/mobile) is
 * encrypted at rest; nothing here puts PHI in a URL, query, or audit row.
 *
 * NOTE: this is the I/O layer — exercised by the API + on-device/integration, not by node --test (which
 * can't reach Firestore). Every DECISION (transitions, ordering, ETA, learning) is delegated to the
 * unit-tested _queue_eta.js, so the untested surface here is thin CRUD.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { encPHI, decPHI, mintTicketToken, verifyTicketToken, ticketIdFromToken } from "./_queue.js";
import { orderQueue, reorderSeq, isQueued, computeEtas, canTransition, isTerminal, updateStats, meanFor, mergeConfig, aggregate, DEFAULT_CONSULT_MIN } from "./_queue_eta.js";
import { runQueueNotifications, notifyTicket } from "./_queue_notify.js";

const now = () => Date.now();
const EMERGENCY_PAD_MIN = 10;
function newId() { return crypto.randomUUID().replace(/-/g, ""); }
function sanitize(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60); }
function sessionId(hospitalId, doctorUid, dept, date) { return [hospitalId, doctorUid, dept, date].map(sanitize).join("__"); }
function endOfDayMs(date) { const t = Date.parse(String(date) + "T23:59:59Z"); return Number.isFinite(t) ? t : now() + 12 * 3600e3; }
function clampPriority(p) { p = Number(p) || 0; return p < 0 ? 0 : p > 2 ? 2 : Math.round(p); }
const withId = (id, f) => Object.assign({ id }, f || {});

// ---- sessions -----------------------------------------------------------------------------
export async function getOrCreateSession(env, p) {
  const id = sessionId(p.hospitalId, p.doctorUid, p.department, p.date);
  const existing = await fsGet(env, "q_sessions/" + id);
  if (existing) return withId(id, existing.fields);
  const f = {
    hospitalId: p.hospitalId || "", doctorUid: p.doctorUid || "", doctorName: p.doctorName || "",
    department: p.department || "", date: p.date, status: "active", doctorStatus: "consulting",
    currentTicketId: "", source: p.source || "manual", createdAt: now(), updatedAt: now(), expiresAt: endOfDayMs(p.date)
  };
  try { await fsCommit(env, [wCreate(env, "q_sessions/" + id, f)]); }
  catch (e) { if (e && e.code === "precondition") { const again = await fsGet(env, "q_sessions/" + id); if (again) return withId(id, again.fields); } throw e; }
  return withId(id, f);
}
export async function getSession(env, id) { const d = await fsGet(env, "q_sessions/" + id); return d ? withId(id, d.fields) : null; }
export async function getTicket(env, id) { const d = await fsGet(env, "q_tickets/" + id); return d ? withId(id, d.fields) : null; }

export async function listTickets(env, sid) {
  const rows = await fsQuery(env, "q_tickets", { where: { field: "sessionId", value: sid }, limit: 500 });
  return rows.map((r) => withId(r.id, r.fields));
}
// Doctor-facing view: decrypt name/mobile (the authed owner may see them). Never sent to a patient page.
export async function decorateForDoctor(env, tickets) {
  return Promise.all(tickets.map(async (t) => Object.assign({}, t, {
    name: await decPHI(env, t.encName), mobile: await decPHI(env, t.encMobile), encName: undefined, encMobile: undefined,
    ghisPatientId: t.ghisPatientId || ""   // full MR# for the View-EMR-profile action (smd_opd_emr)
  })));
}

async function getStats(env, doctorUid) {
  try { const d = await fsGet(env, "q_stats/" + sanitize(doctorUid)); if (d && d.fields && d.fields.data) return JSON.parse(d.fields.data); } catch (e) {}
  return null;
}
export async function getConfig(env, doctorUid) {
  try { const d = await fsGet(env, "q_config/" + sanitize(doctorUid)); if (d && d.fields && d.fields.data) return mergeConfig(JSON.parse(d.fields.data)); } catch (e) {}
  return mergeConfig(null);
}
export async function saveConfig(env, doctorUid, patch) {
  const merged = mergeConfig(Object.assign({}, await getConfig(env, doctorUid), patch || {}));
  await fsCommit(env, [wUpdate(env, "q_config/" + sanitize(doctorUid), { data: JSON.stringify(merged), updatedAt: now() })]);
  return merged;
}
export async function analytics(env, session) { return aggregate(await listTickets(env, session.id), now()); }

// ---- recompute positions + ETAs (delegates to the pure engine); returns the updated tickets ----------
export async function recompute(env, session, tickets) {
  tickets = tickets || await listTickets(env, session.id);
  const cfg = await getConfig(env, session.doctorUid);
  const stats = cfg.etaLearning ? await getStats(env, session.doctorUid) : null;   // learning toggle
  const ordered = orderQueue(tickets);
  const cur = tickets.find((t) => t.id === session.currentTicketId && t.status === "in_consultation");
  let inFlight = 0;
  if (cur) { const mean = meanFor(stats, cur.visitType) || cfg.defaultConsultMin; const elapsed = (now() - (cur.consultStartAt || now())) / 60000; inFlight = Math.max(0, mean - elapsed); }
  const pad = (session.doctorStatus === "emergency" || session.status === "paused") ? EMERGENCY_PAD_MIN : 0;
  const etas = computeEtas(ordered, { nowMs: now(), stats, defaultConsultMin: cfg.defaultConsultMin, inFlightRemainingMin: inFlight, emergencyPadMin: pad });
  const byId = {}; etas.forEach((e) => (byId[e.id] = e));
  const writes = [];
  tickets.forEach((t) => {
    const e = byId[t.id];
    const pos = e ? e.position : 0, es = e ? e.etaStart : 0, ee = e ? e.etaEnd : 0, ec = e ? e.etaConfidence : 0;
    if (t.position !== pos || t.etaStart !== es || t.etaEnd !== ee || t.etaConfidence !== ec) {
      t.position = pos; t.etaStart = es; t.etaEnd = ee; t.etaConfidence = ec; t.updatedAt = now();
      writes.push(wUpdate(env, "q_tickets/" + t.id, { position: pos, etaStart: es, etaEnd: ee, etaConfidence: ec, updatedAt: t.updatedAt }));
    }
  });
  if (writes.length) await fsCommit(env, writes);
  if (cfg.smsEnabled || cfg.waEnabled) { try { await runQueueNotifications(env, session, tickets, { early: cfg.early, prep: cfg.prep }); } catch (e) {} }
  return tickets;
}

// ---- add a ticket (manual or import) ------------------------------------------------------
export async function addTicket(env, session, body, actor) {
  const id = newId();
  const f = {
    sessionId: session.id, hospitalId: session.hospitalId, status: "registered", position: 0,
    visitType: body.visitType === "followup" ? "followup" : "new", priority: clampPriority(body.priority),
    tokenVer: 1, encName: await encPHI(env, body.name), encMobile: await encPHI(env, body.mobile),
    mrnLast4: String(body.mrn || "").replace(/\D/g, "").slice(-4),
    ghisPatientId: String(body.mrn || ""),   // full MR# (for GHIS OPD profile lookups; smd_opd_emr)
    visitId: String(body.visitId || ""), ghisEpisodeId: String(body.ghisEpisodeId || ""),
    lang: String(body.lang || "en"),
    n_stage: 0, n_reg: false, n_complete: false,
    registeredAt: now(), calledAt: 0, consultStartAt: 0, consultEndAt: 0, etaStart: 0, etaEnd: 0, etaConfidence: 0,
    createdAt: now(), updatedAt: now(), expiresAt: session.expiresAt
  };
  await fsCommit(env, [wCreate(env, "q_tickets/" + id, f)]);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId: id, actor, action: "register", meta: f.visitType });
  await recompute(env, session);
  const ticket = withId(id, f);
  try { await notifyTicket(env, session, ticket, "registered", {}); } catch (e) {}   // best-effort SMS/WhatsApp
  return ticket;
}

// ---- explicit status change (call / no_show / cancel / investigation / followup / complete / start) --
export async function setStatus(env, session, ticketId, to, actor) {
  const t = await getTicket(env, ticketId);
  if (!t || t.sessionId !== session.id) throw Object.assign(new Error("not_found"), { status: 404 });
  const from = t.status;
  if (!canTransition(from, to)) throw Object.assign(new Error("bad_transition"), { status: 400, detail: from + "->" + to });
  const patch = { status: to, updatedAt: now() };
  const sessPatch = {};
  if (to === "called" && !t.calledAt) patch.calledAt = now();
  if (to === "in_consultation") { patch.consultStartAt = now(); if (!t.calledAt) patch.calledAt = now(); sessPatch.currentTicketId = ticketId; }
  let learn = null;
  if (from === "in_consultation" && (to === "completed" || to === "investigation" || to === "followup" || to === "cancelled")) {
    patch.consultEndAt = now();
    if (session.currentTicketId === ticketId) sessPatch.currentTicketId = "";
    if (t.consultStartAt) learn = Math.max(0.5, (now() - t.consultStartAt) / 60000);
  }
  // Privacy: at visit end the patient link must die. Bumping tokenVer makes every outstanding token fail
  // verifyTicketToken, so a shared/forwarded link stops resolving the moment the visit closes.
  if (isTerminal(to)) patch.tokenVer = (t.tokenVer || 1) + 1;
  const writes = [wUpdate(env, "q_tickets/" + ticketId, patch)];
  if (Object.keys(sessPatch).length) { sessPatch.updatedAt = now(); writes.push(wUpdate(env, "q_sessions/" + session.id, sessPatch)); Object.assign(session, sessPatch); }
  if (learn != null && (await getConfig(env, session.doctorUid)).etaLearning) { const s2 = updateStats(await getStats(env, session.doctorUid), learn, t.visitType); writes.push(wUpdate(env, "q_stats/" + sanitize(session.doctorUid), { data: JSON.stringify(s2), updatedAt: now() })); }
  await fsCommit(env, writes);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId, actor, action: to, meta: from });
  if (to === "completed") { try { await notifyTicket(env, session, Object.assign({}, t, patch), "complete", {}); } catch (e) {} }
  return recompute(env, session);
}

// DPDP erasure: kill the patient link (bump ver) AND wipe the encrypted name/mobile at rest. Used for an
// explicit "remove/forget" and by discharge. Audit records the action, never the data.
export async function revokeTicket(env, session, ticketId, actor) {
  const t = await getTicket(env, ticketId);
  if (!t || t.sessionId !== session.id) throw Object.assign(new Error("not_found"), { status: 404 });
  await fsCommit(env, [wUpdate(env, "q_tickets/" + ticketId, { tokenVer: (t.tokenVer || 1) + 1, encName: "", encMobile: "", updatedAt: now() })]);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId, actor, action: "revoke", meta: "erase" });
  return { ok: true };
}
export async function setPriority(env, session, ticketId, priority, actor) {
  const t = await getTicket(env, ticketId);
  if (!t || t.sessionId !== session.id) throw Object.assign(new Error("not_found"), { status: 404 });
  await fsCommit(env, [wUpdate(env, "q_tickets/" + ticketId, { priority: clampPriority(priority), updatedAt: now() })]);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId, actor, action: "priority", meta: String(clampPriority(priority)) });
  return recompute(env, session);
}

// ---- staff manual reorder (move up/down/to-#1) with a MANDATORY reason -> full audit trail --------
// Anti-misuse: no reorder without a category or reason, and every move records who/when/from->to/why.
// Only queued (registered/waiting/called) patients can be reordered; the pure reorderSeq keeps
// emergencies on top. `opts` = { toIndex, reason, category }.
export async function moveTicket(env, session, ticketId, opts, actor) {
  opts = opts || {};
  const reason = String(opts.reason || "").slice(0, 180);
  const category = String(opts.category || "").slice(0, 40);
  if (!category && !reason) throw Object.assign(new Error("reason_required"), { status: 400 });
  const t = await getTicket(env, ticketId);
  if (!t || t.sessionId !== session.id) throw Object.assign(new Error("not_found"), { status: 404 });
  if (!isQueued(t.status)) throw Object.assign(new Error("not_queued"), { status: 400, detail: t.status });
  const ordered = orderQueue(await listTickets(env, session.id));
  const fromPos = ordered.findIndex((x) => x.id === ticketId) + 1;
  const toIndex = Math.max(0, Number(opts.toIndex) | 0);
  const r = reorderSeq(ordered, ticketId, toIndex);
  if (!r) return recompute(env, session);   // no-op move (already there / invalid)
  await fsCommit(env, [wUpdate(env, "q_tickets/" + ticketId, { seq: r.seq, updatedAt: now() })]);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId, actor, action: "move",
    meta: JSON.stringify({ from: fromPos, to: toIndex + 1, category: category, reason: reason }) });
  return recompute(env, session);
}

// ---- assign / transfer a patient to (a different) doctor's OPD queue for the same day -------------
// The front desk assigns each auto-fetched / walk-in patient to one of the doctors (by doctorUid). The
// ticket is re-parented to the target doctor's session (same hospital+date), its manual seq reset to
// arrival order, status reset to registered. Both queues reflow. Audited from->to doctor.
export async function assignTicket(env, fromSession, ticketId, toDoctorUid, opts, actor) {
  opts = opts || {};
  const t = await getTicket(env, ticketId);
  if (!t || t.sessionId !== fromSession.id) throw Object.assign(new Error("not_found"), { status: 404 });
  if (!isQueued(t.status)) throw Object.assign(new Error("not_queued"), { status: 400, detail: t.status });
  const target = await getOrCreateSession(env, { hospitalId: fromSession.hospitalId, doctorUid: String(toDoctorUid),
    department: opts.department || fromSession.department, date: fromSession.date, source: "assign" });
  if (target.id === fromSession.id) return recompute(env, fromSession);   // same doctor -> no-op
  await fsCommit(env, [wUpdate(env, "q_tickets/" + ticketId, { sessionId: target.id, seq: (t.registeredAt || now()),
    status: "registered", position: 0, updatedAt: now(), expiresAt: target.expiresAt })]);
  await qAudit(env, { hospitalId: fromSession.hospitalId, ticketId, actor, action: "assign",
    meta: JSON.stringify({ fromDoctor: fromSession.doctorUid, toDoctor: String(toDoctorUid), reason: String(opts.reason || "").slice(0, 120) }) });
  await recompute(env, fromSession);   // reflow the old queue
  return recompute(env, target);       // and the target queue
}

// ---- audit timeline: decode q_events for a session's tickets (newest first). NO PHI (ticketId +
// masked mrnLast4 only). `meta` for move/assign is JSON; left as-is for the client to render. --------
export async function auditTimeline(env, session, limit) {
  const tickets = await listTickets(env, session.id);
  const byId = {}; tickets.forEach((t) => (byId[t.id] = t));
  const ids = new Set(tickets.map((t) => t.id));
  const rows = await fsQuery(env, "q_events", { where: { field: "hospitalId", value: session.hospitalId }, limit: 500 });
  return rows
    .map((r) => withId(r.id, r.fields))
    .filter((e) => e.ticketId && ids.has(e.ticketId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 100)))
    .map((e) => ({ ts: e.ts, actor: e.actor, action: e.action, meta: e.meta,
      mrnLast4: (byId[e.ticketId] && byId[e.ticketId].mrnLast4) || "" }));
}

// "Next Patient": finish the current consult (with learning), start the next ordered ticket. Bespoke
// (compound) op — stamps call+start together, which is how a real OPD "next" works.
export async function advance(env, session, actor) {
  let tickets = await listTickets(env, session.id);
  const cur = tickets.find((t) => t.id === session.currentTicketId && t.status === "in_consultation");
  if (cur) { await setStatus(env, session, cur.id, "completed", actor); tickets = await listTickets(env, session.id); }
  const next = orderQueue(tickets)[0];
  if (next) await setStatus(env, session, next.id, "in_consultation", actor);
  return listTickets(env, session.id);
}

export async function setSessionStatus(env, session, patch, actor) {
  const f = { updatedAt: now() };
  if (patch.status && ["active", "paused", "finished"].indexOf(patch.status) >= 0) f.status = patch.status;
  if (patch.doctorStatus && ["consulting", "break", "emergency", "procedure", "meeting", "finished"].indexOf(patch.doctorStatus) >= 0) f.doctorStatus = patch.doctorStatus;
  await fsCommit(env, [wUpdate(env, "q_sessions/" + session.id, f)]);
  Object.assign(session, f);
  await qAudit(env, { hospitalId: session.hospitalId, ticketId: "", actor, action: "session:" + (f.status || f.doctorStatus || "update"), meta: "" });
  return session;
}

// ---- patient link + PHI-free portal -------------------------------------------------------
export function linkFor(env, ticket) {
  const base = (env && env.QUEUE_LINK_BASE) || "https://stewardmd.in";
  return mintTicketToken(env, ticket.id, ticket.expiresAt || endOfDayMs(ticket.date), ticket.tokenVer || 1)
    .then((tok) => ({ token: tok, url: base.replace(/\/+$/, "") + "/queue?t=" + tok }));
}
// Verify a patient token → PHI-FREE snapshot. Never returns name/MRN/phone.
export async function portalContext(env, token) {
  const id = ticketIdFromToken(token);
  if (!id) return { ok: false, error: "invalid_link" };
  const t = await getTicket(env, id);
  if (!t) return { ok: false, error: "invalid_link" };
  const v = await verifyTicketToken(env, token, t.tokenVer || 1);
  if (!v.ok) return { ok: false, error: v.reason === "expired" ? "link_expired" : "invalid_link" };
  const session = await getSession(env, t.sessionId);
  const tickets = await listTickets(env, t.sessionId);
  const ordered = orderQueue(tickets);
  const idx = ordered.findIndex((x) => x.id === id);
  const ahead = idx < 0 ? 0 : idx;                     // people ahead (0 = you're next / being seen)
  await qAudit(env, { hospitalId: t.hospitalId, ticketId: id, actor: "patient", action: "portal_view", meta: "" });
  return {
    ok: true,
    department: session ? session.department : "", doctorName: session ? session.doctorName : "", doctorStatus: session ? session.doctorStatus : "consulting",
    status: t.status, position: idx < 0 ? 0 : idx + 1, ahead: ahead,
    etaStart: t.etaStart || 0, etaEnd: t.etaEnd || 0, confidence: t.etaConfidence || 0,
    journey: { registeredAt: t.registeredAt || 0, calledAt: t.calledAt || 0, consultStartAt: t.consultStartAt || 0, done: isTerminal(t.status) },
    lastUpdated: now()
  };
}

// ---- append-only audit (PHI-free; fixed field allow-list) ---------------------------------
export async function qAudit(env, ev) {
  const id = newId();
  const f = { ts: now(), hospitalId: ev.hospitalId || "", ticketId: ev.ticketId || "", actor: ev.actor || "", action: ev.action || "", meta: String(ev.meta == null ? "" : ev.meta).slice(0, 200) };
  try { await fsCommit(env, [wCreate(env, "q_events/" + id, f)]); } catch (e) {}   // best-effort; never blocks the action
}
