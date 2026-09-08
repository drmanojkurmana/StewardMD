/* functions/_wardsynq/fhir-route.js - the FHIR read surface, as one dispatcher.
 *
 * Two doors reach the same FHIR read functions: the ward route (a clinician's session, inside the
 * block that assumes an employee) and /api/fhir (a SMART bearer, outside it). Both must answer the
 * same paths the same way, so the path grammar lives here once. This file decides nothing about
 * WHO is asking - it is handed a context that already carries the actor or the deps to resolve one.
 */

import { patientEverything, readResource, capabilityStatement, searchType, historyOf, vread, operationOutcome, provenanceRead, provenanceSearch, validateOperation, validateCodeOperation } from "./fhir.js";

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
 *   Patient/{id}/$everything | Provenance?target= | Provenance/{id} | ?patient= (the old spelling)
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

  if (fType === "metadata") return { obj: capabilityStatement({ date: new Date().toISOString(), version: "wardsynq-1", smart: fctx.smart || null }), status: 200 };
  if (!fType) {
    const r = await patientEverything(request, env, { ...fctx, patientId: url.searchParams.get("patient") || url.searchParams.get("patientId") || "", searchParams: strip(), rawQuery, lenient });
    return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
  }
  if (fType === "Provenance") {
    const r = fId ? await provenanceRead(request, env, { ...fctx, id: fId }) : await provenanceSearch(request, env, { ...fctx, searchParams: strip(), rawQuery });
    return { obj: r.ok ? (r.resource || r.bundle) : r.outcome, status: r.status };
  }
  if (fType === "Patient" && fId && fOp === "$everything") {
    const r = await patientEverything(request, env, { ...fctx, patientId: fId, searchParams: strip(), rawQuery, lenient });
    return { obj: r.ok ? r.bundle : r.outcome, status: r.status };
  }
  if (fType === "CodeSystem" && fId === "$validate-code") {
    const r = await validateCodeOperation(request, env, { ...fctx, searchParams: strip() });
    return { obj: r.ok ? r.parameters : r.outcome, status: r.status };
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

export { fhirResponse, dispatchRead, dispatchOperation };
