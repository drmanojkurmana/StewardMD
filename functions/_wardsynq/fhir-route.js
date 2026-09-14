/* functions/_wardsynq/fhir-route.js - the FHIR read surface, as one dispatcher.
 *
 * Two doors reach the same FHIR read functions: the ward route (a clinician's session, inside the
 * block that assumes an employee) and /api/fhir (a SMART bearer, outside it). Both must answer the
 * same paths the same way, so the path grammar lives here once. This file decides nothing about
 * WHO is asking - it is handed a context that already carries the actor or the deps to resolve one.
 */

import { patientEverything, readResource, capabilityStatement, searchType, historyOf, vread, operationOutcome, provenanceRead, provenanceSearch, validateOperation } from "./fhir.js";
import { practitionerRead, organizationRead } from "./fhir-identity.js";
import { kickoffExport, exportStatus, cancelExport, exportFile, parametersToExportParams, NDJSON } from "./fhir-bulk.js";
import { groups } from "./fhir-group.js";
import { dispatchTerminology } from "./fhir-terminology.js";
import { patientSummary } from "./fhir-ips.js";
import { auditEvents } from "./fhir-audit.js";
import { subscriptions } from "./fhir-subscription.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** FHIR's media type on every response, an ETag over versionId on a single resource. */
function fhirResponse(obj, status, extraHeaders, cors) {
  const h = Object.assign({ "Content-Type": "application/fhir+json; charset=utf-8", "Cache-Control": "no-store" }, cors || {});
  if (obj && obj.meta && obj.meta.versionId && obj.resourceType !== "Bundle") h.ETag = `W/"${obj.meta.versionId}"`;
  if (obj && obj.meta && obj.meta.lastUpdated && obj.resourceType !== "Bundle") { const d = new Date(obj.meta.lastUpdated); if (!isNaN(d)) h["Last-Modified"] = d.toUTCString(); }
  Object.assign(h, extraHeaders || {});
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

/**
 * Dispatches one GET against the FHIR read grammar.
 *   metadata | {Type} | {Type}/{id} | {Type}/{id}/_history | {Type}/{id}/_history/{vid}
 *   Patient/{id}/$everything | Patient/{id}/$summary | Provenance?target= | Provenance/{id} | ?patient= (the old spelling)
 *   CodeSystem | ValueSet (+ $expand, $validate-code) | AuditEvent | Subscription
 *
 * @param {string[]} parts   path segments AFTER the fhir root
 * @param {URL} url
 * @param {object} fctx      { migration, actorDeps?, actorOverride?, recordDeps, base, smart? }
 * @param {object} lenientHeader  the Prefer header value
 * @returns {Promise<{obj: object, status: number}>}
 */
async function dispatchRead(request, env, parts, url, fctx, prefer) {
  const fType = parts[0] || "", fId = parts[1] || "", fOp = parts[2] || "", fVid = parts[3] || "";
  const strip = () => { const p = new URLSearchParams(url.searchParams); p.delete("orgId"); return p; };
  const rawQuery = url.search.replace(/^\?/, "");

  const lenient = /handling=lenient/i.test(str(prefer));

  if (fType === "metadata") return { obj: capabilityStatement({ date: new Date().toISOString(), version: "wardsynq-1", smart: fctx.smart || null, inbound: fctx.inbound === true }), status: 200 };
  if (!fType) {
    const r = await patientEverything(request, env, { ...fctx, patientId: url.searchParams.get("patient") || url.searchParams.get("patientId") || "", searchParams: strip(), rawQuery, lenient });
    return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
  }
  /* Terminology (CodeSystem, ValueSet, $expand, $validate-code), AuditEvent and $summary: each in its
   * own file, each authorised there or by the door, none a stored canonical type. */
  const tx = await dispatchTerminology(request, env, parts, url, fctx);
  if (tx) return tx;
  if (fType === "AuditEvent") {
    if (fOp) return { obj: operationOutcome("error", "not-supported", "AuditEvent is read and searched only"), status: 404 };
    return auditEvents(request, env, { ...fctx, id: fId }, url);
  }
  if (fType === "Subscription") {
    if (fOp && !(fId && fOp === "$status" && !fVid)) return { obj: operationOutcome("error", "not-supported", "Subscription is read, searched and asked for $status (Subscription/{id}/$status)"), status: 404 };
    return subscriptions(request, env, { ...fctx, id: fId, op: fOp }, url);
  }
  /* G9. Group: the ward census, derived (fhir-group.js). Read and search only; $export is dispatchBulk's. */
  if (fType === "Group") {
    if (fOp) return { obj: operationOutcome("error", "not-supported", "Group is read and searched; Group/{id}/$export starts a bulk export"), status: 404 };
    return groups(request, env, { ...fctx, id: fId }, url);
  }
  if (fType === "Patient" && fId && fOp === "$summary") {
    const r = await patientSummary(request, env, { ...fctx, patientId: fId });
    return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
  }
  if (fType === "Provenance") {
    const r = fId ? await provenanceRead(request, env, { ...fctx, id: fId }) : await provenanceSearch(request, env, { ...fctx, searchParams: strip(), rawQuery });
    return { obj: r.ok ? (r.resource || r.bundle) : r.outcome, status: r.status };
  }
  /* TASK 7.11. Derived identity, served the way Provenance already is: routed before the generic
   * read, because neither type is a stored canonical record. Read only - a search over either would
   * be a directory this server does not have, and a 404 on the type is more honest than an empty
   * Bundle that reads as "nobody works here". */
  if (fType === "Practitioner" || fType === "Organization") {
    if (!fId) return { obj: operationOutcome("error", "not-supported", `${fType} is served by id only: this server holds no ${fType === "Practitioner" ? "practitioner" : "organisation"} directory to search`), status: 404 };
    const r = fType === "Practitioner"
      ? await practitionerRead(request, env, { ...fctx, id: fId })
      : await organizationRead(request, env, { ...fctx, id: fId });
    return { obj: r.ok ? r.resource : r.outcome, status: r.status };
  }
  if (fType === "Patient" && fId && fOp === "$everything") {
    const r = await patientEverything(request, env, { ...fctx, patientId: fId, searchParams: strip(), rawQuery, lenient });
    return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
  }
  if (fId && fOp === "$validate") {
    const r = await validateOperation(request, env, { ...fctx, type: fType, id: fId });
    return { obj: r.outcome, status: r.status };
  }
  if (fId && fOp === "_history" && fVid) { const r = await vread(request, env, { ...fctx, type: fType, id: fId, versionId: fVid }); return { obj: r.ok ? r.resource : r.outcome, status: r.status }; }
  if (fId && fOp === "_history") { const r = await historyOf(request, env, { ...fctx, type: fType, id: fId }); return { obj: r.ok ? r.bundle : r.outcome, status: r.status }; }
  if (fId && fOp) return { obj: operationOutcome("error", "not-found", `no such operation: ${fOp}`), status: 404 };
  if (fId) { const r = await readResource(request, env, { ...fctx, type: fType, id: fId, searchParams: strip() }); return { obj: r.ok ? r.resource : r.outcome, status: r.status }; }
  const r = await searchType(request, env, { ...fctx, type: fType, searchParams: strip(), rawQuery, lenient });
  return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
}

/**
 * Dispatches a POST that is an OPERATION rather than a write: `$validate` and `{Type}/$validate`.
 * Returns null when the path is not an operation, so the caller can go on to its write handling.
 * Validation never writes, so it needs neither the inbound flag nor a write capability.
 */
async function dispatchOperation(request, env, parts, body, fctx) {
  const fType = parts[0] || "", fId = parts[1] || "";
  if (fType === "$validate" && !fId) { const r = await validateOperation(request, env, { ...fctx, body }); return { obj: r.outcome, status: r.status }; }
  if (fType && fId === "$validate" && !parts[2]) { const r = await validateOperation(request, env, { ...fctx, body, type: fType }); return { obj: r.outcome, status: r.status }; }
  return null;
}

/**
 * The Bulk Data paths ($export, Patient/$export, $export-status/{id}, $export-file/{id}/{name}), for
 * both doors. Returns a Response, or null when the path is not one of them. The caller has already
 * decided the door's own gate (a staff.admin session, or a resolved bearer in fctx.actorOverride).
 * fctx: { migration, recordDeps, actorDeps, actorOverride?, store, base }  opts: { cors, suffix, body (a POST kick-off) }
 */
async function dispatchBulk(request, env, parts, url, fctx, opts) {
  const o = opts || {}, cors = o.cors || {}, suffix = o.suffix || "";
  const p0 = parts[0] || "", p1 = parts[1] || "", p2 = parts[2] || "";
  const method = request.method;
  const out = (r) => fhirResponse(r.outcome, r.status, r.retryAfter ? { "Retry-After": String(r.retryAfter) } : null, cors);
  const level = p0 === "$export" && !p1 ? "system" : (p0 === "Patient" && p1 === "$export" && !p2) ? "patient"
    : (p0 === "Group" && p1 && p2 === "$export" && !parts[3]) ? "group" : null;
  if (level) {
    if (method !== "GET" && method !== "POST") return fhirResponse(operationOutcome("error", "not-supported", "$export is GET or POST"), 405, { Allow: "GET, POST" }, cors);
    /* The IG makes the async pattern mandatory; a client that does not ask for it is not a bulk client. */
    if (!/respond-async/i.test(str(request.headers.get("Prefer")))) return fhirResponse(operationOutcome("error", "invalid", "Prefer: respond-async is required for $export"), 400, null, cors);
    /* G9. POST kick-off: the parameters travel in a Parameters body. Both at once is refused, because a
     * client that put _type in the URL and _since in the body would not get the export it believes. */
    let params = url.searchParams;
    if (method === "POST") {
      if ([...url.searchParams.keys()].some((k) => k !== "orgId")) return fhirResponse(operationOutcome("error", "invalid", "a POST $export takes its parameters in the Parameters body, not the URL"), 400, null, cors);
      const pb = parametersToExportParams(o.body);
      if (pb.error) return fhirResponse(operationOutcome("error", "invalid", pb.error), 400, null, cors);
      params = pb.params;
    }
    const r = await kickoffExport(request, env, { ...fctx, level, groupId: level === "group" ? decodeURIComponent(p1) : undefined, params, requestUrl: url.href });
    if (!r.ok) return out(r);
    return fhirResponse(operationOutcome("information", "informational", "export accepted"), 202, { "Content-Location": `${fctx.base}/$export-status/${encodeURIComponent(r.jobId)}${suffix}` }, cors);
  }
  if (p0 === "$export-status" && p1 && !p2) {
    const ctx = { ...fctx, jobId: decodeURIComponent(p1), link: (name) => `${fctx.base}/$export-file/${encodeURIComponent(decodeURIComponent(p1))}/${encodeURIComponent(name)}${suffix}` };
    if (method === "DELETE") {
      const r = await cancelExport(request, env, ctx);
      return r.ok ? fhirResponse(operationOutcome("information", "informational", "export cancelled"), 202, null, cors) : out(r);
    }
    if (method !== "GET") return fhirResponse(operationOutcome("error", "not-supported", "GET or DELETE"), 405, { Allow: "GET, DELETE" }, cors);
    const r = await exportStatus(request, env, ctx);
    if (!r.ok) return out(r);
    if (r.status === 202) return new Response(null, { status: 202, headers: Object.assign({ "X-Progress": r.progress, "Retry-After": "120", "Cache-Control": "no-store" }, cors) });
    return new Response(JSON.stringify(r.manifest), { status: 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, cors) });
  }
  if (p0 === "$export-file" && p1 && p2 && !parts[3]) {
    if (method !== "GET") return fhirResponse(operationOutcome("error", "not-supported", "GET"), 405, { Allow: "GET" }, cors);
    const r = await exportFile(request, env, { ...fctx, jobId: decodeURIComponent(p1), fileName: decodeURIComponent(p2) });
    if (!r.ok) return out(r);
    return new Response(r.bytes, { status: 200, headers: Object.assign({ "Content-Type": NDJSON, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, cors) });
  }
  return null;
}

export { fhirResponse, dispatchRead, dispatchOperation, dispatchBulk };
