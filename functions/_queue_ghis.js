/* functions/_queue_ghis.js — GHIS/EMR roster → queue import adapter (owner-priority source).
 *
 * FLOW: the client already fetches the hospital roster from the existing GHIS proxy `/api/ghis/patients`
 * (per-doctor GHIS session auth, reused as-is) and POSTs the rows to `/api/queue/import`; this maps each
 * row to a ticket and adds the NEW ones (dedup by GHIS episode id). Patient mobile is NOT in the roster —
 * it's fetched lazily via `/api/ghis/demographics` and attached later, so notifications hold until then.
 *
 * [OWNER BLOCKER] GHIS exposes only the IPD worklist today (Type:'IPWorkList'); the OPD worklist Type/
 * endpoint is GITAM-specific and not yet known. Until then the client points this at the IPD worklist as a
 * functional STAND-IN (identical row shape). Swap in the OPD worklist call in ghis-ward.js when available.
 *
 * mapGhisRow / filterNew are PURE (unit-tested); importRoster is thin I/O over the tested engine.
 */
import { addTicket, listTickets, setStatus } from "./_queue_engine.js";
import { resolveOpdSource, opdSupports } from "./_opd_source.js";

// First non-empty value across candidate keys (handles IPD camelCase + OPD .NET PascalCase).
function pick(row, keys) { for (var i = 0; i < keys.length; i++) { var v = row[keys[i]]; if (v != null && String(v).trim() !== "") return String(v).trim(); } return ""; }

// PURE: one GHIS roster row (IPD GetIPWL or OPD DashboardUnit) -> a queue-ticket body. Tolerant of
// field-name variants; mobile is usually absent from the roster (lazy /api/ghis/demographics).
export function mapGhisRow(row) {
  row = row || {};
  var name = pick(row, ["patientFirstName", "PatientName", "patientName", "patient_name", "PatientFullName", "PName", "pname", "name"]);
  var last = pick(row, ["patientLastName", "PatientLastName"]);
  if (last && name.indexOf(last) < 0) name = (name + " " + last).trim();
  var epi = pick(row, ["episodeId", "episode_id", "VisitId", "visitId", "VisitID", "OPVisitId", "OPNo", "VisitNo", "encounterId"]);
  return {
    name: name,
    mobile: pick(row, ["mobile", "phone", "MobileNo", "mobileNo", "PatientMobile", "ContactNo", "Mobile"]),
    mrn: pick(row, ["patientId", "PatientId", "PatientID", "MRNo", "MRNumber", "PatientMRNo", "UHID", "uhid", "mrn"]),
    visitId: pick(row, ["VisitId", "visitId", "VisitID"]) || epi,
    ghisEpisodeId: epi,
    visitType: (function (v) { v = pick(row, ["visitType", "VisitType", "OPType"]).toLowerCase(); return (v === "followup" || /follow/.test(v)) ? "followup" : "new"; })(),
    priority: 0
  };
}

// PURE: map rows, drop empties, dedupe against already-imported episode ids AND within the batch.
export function filterNew(rows, existingEpisodeIds) {
  var seen = {}; (existingEpisodeIds || []).forEach(function (e) { if (e) seen[String(e)] = 1; });
  var local = {}, out = [];
  (rows || []).forEach(function (r) {
    var m = mapGhisRow(r);
    if (!m.name) return;
    var key = m.ghisEpisodeId || (m.mrn + "|" + m.name);
    if (seen[key] || local[key]) return;
    local[key] = 1; out.push(m);
  });
  return out;
}

// PURE: which existing tickets should be dropped because they left the EMR Out-patients list. Only
// auto-imported (has ghisEpisodeId), still-untouched ("registered") tickets whose episode is absent from
// the current NON-EMPTY batch. A doctor-touched (called/consulting/done) or manual (no episode) ticket is
// never dropped, and an empty batch never reconciles (a failed/empty fetch must not clear the queue).
export function staleImportedIds(existing, batchEpisodeIds) {
  if (!batchEpisodeIds || !batchEpisodeIds.length) return [];
  var keep = {}; batchEpisodeIds.forEach(function (e) { if (e) keep[String(e)] = 1; });
  return (existing || []).filter(function (t) {
    return t && t.ghisEpisodeId && t.status === "registered" && !keep[String(t.ghisEpisodeId)];
  }).map(function (t) { return t.id; });
}

// I/O: mirror the EMR Out-patients tab into the session — add new patients AND cancel still-waiting
// imports that dropped off the list. Returns { imported, skipped, removed }.
export async function importRoster(env, session, rows, actor) {
  var current = await listTickets(env, session.id);
  var existing = current.map(function (t) { return t.ghisEpisodeId; }).filter(Boolean);
  var fresh = filterNew(rows, existing);
  var imported = 0;
  for (var i = 0; i < fresh.length; i++) { try { await addTicket(env, session, fresh[i], actor || "import"); imported++; } catch (e) {} }
  var batchEpi = (rows || []).map(function (r) { return mapGhisRow(r).ghisEpisodeId; }).filter(Boolean);
  var stale = staleImportedIds(current, batchEpi);
  var removed = 0;
  for (var k = 0; k < stale.length; k++) { try { await setStatus(env, session, stale[k], "cancelled", actor || "import:reconcile"); removed++; } catch (e) {} }
  return { imported: imported, skipped: (rows || []).length - imported, removed: removed };
}

// OPD-engine → EMR boundary: pull today's worklist through the org's OPD source (connector or native) and
// import it. The engine never touches /api/ghis directly — GHIS is just the connector behind
// resolveOpdSource. Degrades to native (no external import, current queue untouched) when the org is
// native, the connector is absent, or the EMR session/worklist is unavailable (architecture §6/§7).
export async function importFromSource(env, session, org, ctx) {
  ctx = ctx || {};
  var src = resolveOpdSource(env, org);
  if (!opdSupports(src, "getWorklist")) return { source: src.kind, native: true, imported: 0, skipped: 0, removed: 0 };
  var r;
  try { r = await src.getWorklist(ctx, { date: ctx.date || "", cb: ctx.cb || "" }); } catch (e) { r = { error: true }; }
  if (!r || r.unauth || r.error) return { source: src.kind, degraded: true, imported: 0, skipped: 0, removed: 0 };
  return Object.assign({ source: src.kind }, await importRoster(env, session, r.rows || [], ctx.actor || "import"));
}
