/* functions/api/queue/[[path]].js — Smart OPD Queue router.
 *
 * Three postures: DOCTOR (Firebase auth via identify → owns their session), PATIENT (opaque signed token
 * only, no login, PHI-free), health (/ready). Feature OFF unless env QUEUE_ENABLED === "1". No PHI in any
 * URL/query/log. Every clinical decision is server-side (engine + pure logic), never trusting the client.
 *
 *   GET  /api/queue/ready                                  -> { enabled, configured }
 *   GET  /api/queue/session?date=&department=&hospitalId=  -> { session, tickets }   (get/create today's)
 *   GET  /api/queue/list?sessionId=                        -> { session, tickets }
 *   POST /api/queue/ticket   { sessionId, name, mobile, mrn, visitType, priority } -> { ticket }
 *   POST /api/queue/advance  { sessionId }                 -> { tickets }            (Next Patient)
 *   POST /api/queue/status   { sessionId, ticketId, status } -> { tickets }
 *   POST /api/queue/priority { sessionId, ticketId, priority } -> { tickets }
 *   POST /api/queue/session/status { sessionId, status?, doctorStatus? } -> { session }
 *   GET  /api/queue/link?sessionId=&ticketId=              -> { token, url }         (patient tracking link)
 *   GET  /api/queue/portal?t=<token>                       -> PHI-free live snapshot  (PATIENT, no auth)
 */
import { queueEnabled, isQueueConfigured } from "../../_queue.js";
import { identify } from "../../_usage.js";
import * as Q from "../../_queue_engine.js";
import { importRoster } from "../../_queue_ghis.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || ""; const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }
async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }
function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } }

// A doctor may only touch their OWN session (owner/tenant override is a hardening-phase add).
async function loadOwned(env, sessionId, who) {
  const s = sessionId ? await Q.getSession(env, sessionId) : null;
  if (!s) return { err: json({ ok: false, error: "not_found" }, 404) };
  if (s.doctorUid !== who.id) return { err: json({ ok: false, error: "forbidden" }, 403) };
  return { s };
}
async function ticketView(env, tickets) { return Q.decorateForDoctor(env, tickets); }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\/queue\/?/, "").replace(/\/+$/, "").split("/");
  const seg = parts[0] || "", sub = parts[1] || "";

  if (method === "GET" && seg === "ready") return json({ ok: true, enabled: queueEnabled(env), configured: isQueueConfigured(env) }, 200, request);
  if (!queueEnabled(env)) return json({ ok: false, error: "disabled" }, 404, request);

  try {
    // ---- PATIENT: token only, PHI-free, no auth ----
    if (method === "GET" && seg === "portal") {
      if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
      return json(await Q.portalContext(env, url.searchParams.get("t") || ""), 200, request);
    }

    // ---- DOCTOR: must be signed in ----
    const who = await identify(request, env);
    if (!who || who.guest) return json({ ok: false, error: "unauthorized" }, 401, request);
    if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);

    if (method === "GET" && seg === "session") {
      const s = await Q.getOrCreateSession(env, {
        hospitalId: url.searchParams.get("hospitalId") || "manual", doctorUid: who.id, doctorName: who.email || "",
        department: url.searchParams.get("department") || "", date: url.searchParams.get("date") || today(),
        source: url.searchParams.get("source") || "manual"
      });
      const tickets = await Q.recompute(env, s);
      return json({ ok: true, session: s, tickets: await ticketView(env, tickets) }, 200, request);
    }

    if (method === "GET" && seg === "list") {
      const { s, err } = await loadOwned(env, url.searchParams.get("sessionId"), who); if (err) return err;
      return json({ ok: true, session: s, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request);
    }

    if (method === "GET" && seg === "link") {
      const { s, err } = await loadOwned(env, url.searchParams.get("sessionId"), who); if (err) return err;
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      return json(Object.assign({ ok: true }, await Q.linkFor(env, t)), 200, request);
    }

    if (method === "GET" && seg === "config") return json({ ok: true, config: await Q.getConfig(env, who.id) }, 200, request);
    if (method === "GET" && seg === "analytics") {
      const { s, err } = await loadOwned(env, url.searchParams.get("sessionId"), who); if (err) return err;
      return json({ ok: true, analytics: await Q.analytics(env, s) }, 200, request);
    }

    if (method === "POST") {
      const body = await readBody(request);
      if (seg === "config") return json({ ok: true, config: await Q.saveConfig(env, who.id, body.config || body) }, 200, request);  // per-doctor, no session
      const { s, err } = await loadOwned(env, body.sessionId, who); if (err) return err;
      if (seg === "ticket") { const t = await Q.addTicket(env, s, body, who.id); return json({ ok: true, ticket: (await ticketView(env, [t]))[0] }, 200, request); }
      if (seg === "import") { const r = await importRoster(env, s, body.rows || [], who.id); return json({ ok: true, imported: r.imported, skipped: r.skipped, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request); }
      if (seg === "advance") return json({ ok: true, tickets: await ticketView(env, await Q.advance(env, s, who.id)) }, 200, request);
      if (seg === "status") return json({ ok: true, tickets: await ticketView(env, await Q.setStatus(env, s, body.ticketId, body.status, who.id)) }, 200, request);
      if (seg === "priority") return json({ ok: true, tickets: await ticketView(env, await Q.setPriority(env, s, body.ticketId, body.priority, who.id)) }, 200, request);
      if (seg === "revoke") { await Q.revokeTicket(env, s, body.ticketId, who.id); return json({ ok: true, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request); }
      if (seg === "session" && sub === "status") return json({ ok: true, session: await Q.setSessionStatus(env, s, body, who.id) }, 200, request);
    }

    return json({ ok: false, error: "not_found" }, 404, request);
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "error" }, (e && e.status) || 500, request);
  }
}
