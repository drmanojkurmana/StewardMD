/* functions/_wardsynq/observability.js — the smallest observability layer this architecture needs,
 * and no more.
 *
 * WHAT THIS IS NOT. Not a metrics database, not a dashboard, not an alerting engine, not a second
 * datastore for the clinical record to disagree with. Cloudflare Pages Functions already ships a
 * production-grade capture path for exactly what this file emits - `wrangler tail`, the dashboard's
 * live log view, and Logpush to a hospital's own SIEM if one is configured - and building a
 * replacement for that inside this repository would be reinventing platform infrastructure nobody
 * asked WardSynQ to own. THIS is the boundary: one function that emits one structured, PHI-free
 * line. Retention, alerting rules, dashboards and a SIEM integration are PRODUCTION INFRASTRUCTURE,
 * stated here rather than fabricated - see the file's own STATUS line.
 *
 * WHY IT EXISTS AT ALL. Before this file, functions/_wardsynq/ had ZERO console.* calls anywhere
 * (confirmed by the 2026-09-10 audit) - not because nothing ever fails, but because nothing was
 * ever wired to say so. An unhandled exception in a clinical route returned a JSON error to the
 * caller and left no trace anywhere Ops could find without reproducing the failing request. That is
 * the actual gap the audit named under "observability", and it is the one this file closes.
 *
 * THE ONE RULE: NEVER PHI. Every field this file accepts is enumerated below and nothing free-form
 * is ever appended to a log line - a caller cannot hand this a patient name, an MRN or a chart
 * excerpt even by mistake, because there is no parameter shaped to carry one. `detail` is allow-
 * listed to short, known-safe strings (an error CODE, a route segment, a resource TYPE) - never the
 * error's own message, which can and does echo caller input in this codebase (see the router's own
 * catch block, which already returns `e.message` to the CALLER - a class of problem this file does
 * not attempt to fix, only avoid repeating into a log).
 *
 * STATUS: IMPLEMENTED. NOT wired to a dashboard, an alert, or a SIEM - that is a deployment
 * decision belonging to whichever hospital's Ops team consumes Cloudflare's own log tooling, and is
 * explicitly out of scope for this file to invent on their behalf.
 *
 * node --test test/wardsynq-observability.test.mjs
 */

const KIND = Object.freeze({
  REQUEST_ERROR: "request_error",         // an unhandled exception reached the router's outer catch
  NOTIFY_FAILED: "notify_failed",         // a Dispatcher attempt (critical result, break-glass) delivered nothing
  AI_FAILED: "ai_failed",                 // MaiK refused to route, or a provider call failed
  SECURITY_EVENT: "security_event",       // an injection signal, a withheld output, a source-authorization refusal
  INTEGRATION_FAILED: "integration_failed", // an inbound/outbound FHIR, HL7, DICOM or ABDM call failed
});

const KINDS = new Set(Object.values(KIND));

/** PURE. Strips a value to something safe to log: a short string, or null. Never an object, never
 *  anything long enough to plausibly be a name, a note, or an MRN typed as free text. */
function safe(v) {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, 200) : null;
}

/**
 * Emits ONE structured line. Never throws - a broken observability call must never be the reason a
 * clinical request fails, which is the exact failure mode a try/catch around every call site would
 * otherwise risk forgetting.
 *
 * @param {string} kind         one of KIND's values
 * @param {{route?: string, status?: number, durationMs?: number, code?: string, detail?: string,
 *   tenantId?: string, actorKind?: string}} fields  allow-listed, PHI-free by construction
 * @param {{log?: Function, error?: Function}} [io]  injection seam for tests; defaults to console
 */
function logEvent(kind, fields, io) {
  try {
    if (!KINDS.has(kind)) return;
    const f = fields || {};
    const line = {
      at: new Date().toISOString(),
      kind,
      route: safe(f.route),
      status: Number.isFinite(f.status) ? f.status : null,
      durationMs: Number.isFinite(f.durationMs) ? Math.round(f.durationMs) : null,
      code: safe(f.code),
      detail: safe(f.detail),
      // The TENANT, never the patient: which hospital had the failure is operationally necessary
      // and carries no PHI on its own - a tenant id names an organisation, not a person.
      tenantId: safe(f.tenantId),
      actorKind: safe(f.actorKind),
    };
    const w = io || console;
    const out = kind === KIND.REQUEST_ERROR || kind === KIND.SECURITY_EVENT ? (w.error || w.log) : w.log;
    out(JSON.stringify(line));
  } catch { /* observability must never be why a clinical request fails */ }
}

export { KIND, logEvent };
