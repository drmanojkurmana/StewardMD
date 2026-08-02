// functions/_connect/connectors/graphql/connector.js — generic GraphQL lab-results PULL connector.
// KEY REUSE INSIGHT: a hospital whose EMR/LIS exposes a GraphQL API can self-onboard with NO code from us —
// they supply their OWN query (query is THEIR input; we never fabricate a schema), a `patientVar` (the
// query's variable name for the patient id) and a `resultsPath` (where the row array lives in the response's
// `data`). We POST {query, variables:{[patientVar]:patientId}}, take the row array at resultsPath, and the
// resulting flat rows map onto EXISTING SCCM resources (Patient/Observation/DiagnosticReport) EXACTLY as the
// shipped CSV path already does. So this connector is a thin SSRF-safe HTTP-fetch adapter in FRONT of the
// already-tested normalizeCsvLab (../file/normalize.js) — NO new mapping engine, NO new SCCM resource. Auth
// is token/API-key ONLY (no SMART), the SAME token/custom-header idiom as the rest-json connector.
import { normalizeCsvLab } from "../file/normalize.js";
import { inferColumnMap } from "../../onboard/csv-upload.js";
import { UpstreamError } from "../../permission.js";

// Resolve the request headers: the auth header from ctx.secrets("bearer") + an optional custom header name
// (config.headerName), PLUS the fixed JSON content headers every GraphQL POST needs. Mirrors rest-json's
// authHeaderFor (built fresh on every call, never cached on the connector — the connector holds no state).
async function authHeaderFor(ctx) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  const tok = ctx.secrets ? await ctx.secrets("bearer").catch(() => null) : null;
  if (!tok) return headers;
  const name = (ctx.config && ctx.config.headerName) ? String(ctx.config.headerName) : "authorization";
  const value = name.toLowerCase() === "authorization" ? "Bearer " + tok : tok;
  headers[name] = value;
  return headers;
}

function endpointUrl(ctx) {
  const base = ((ctx.config && ctx.config.base_url) || "").replace(/\/$/, "");
  const path = (ctx.config && ctx.config.graphqlPath) || "";
  return base + path;
}

// Walk `resultsPath` (dot-separated simple segments) into `data` and return the array found there, or null.
// NEVER traverses/guesses shape beyond the literal dotted path the hospital configured. If no path is given,
// accept `data` itself being a bare array (mirrors rest-json's bare-array acceptance).
function rowsAt(data, path) {
  if (!path) return Array.isArray(data) ? data : null;
  let cur = data;
  for (const seg of String(path).split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[seg];
  }
  return Array.isArray(cur) ? cur : null;
}

export const graphqlConnector = {
  meta: { id: "graphql", name: "Generic GraphQL lab feed", version: "1.0", profile: "pull", kinds: ["graphql"], sccmVersion: "1.0" },

  authenticate: async () => ({ ok: true }),   // no handshake — the token (if any) is attached per-request below

  capabilities: async () => ({ resources: ["Patient", "Observation", "DiagnosticReport"], operations: ["read"], authKinds: ["token"] }),

  validate: async (ctx) => {
    const checks = [];
    try {
      const header = await authHeaderFor(ctx);
      // redirect:"manual" (mirrors rest-json.validate) — never auto-follow a 3xx to another origin here.
      // A minimal introspection-free probe query ("{ __typename }") never touches patient data.
      const res = await ctx.fetch(endpointUrl(ctx), { method: "POST", headers: header, body: JSON.stringify({ query: "{ __typename }" }), redirect: "manual" });
      const ok = !!(res && res.ok);
      checks.push({ name: "graphql-endpoint", ok });
      return { ok, checks };
    } catch (e) { checks.push({ name: "validate", ok: false, detail: e.message }); return { ok: false, checks }; }
  },

  fetchPatient: async (ctx, patientRef) => {
    const header = await authHeaderFor(ctx);
    const patientVar = (ctx.config && ctx.config.patientVar) || "patientId";
    // The hospital's OWN query text is sent VERBATIM (never rewritten/interpolated); the patient value is
    // carried ONLY as a bound GraphQL variable, never spliced into the query string (no injection surface).
    const body = JSON.stringify({ query: ctx.config && ctx.config.query, variables: { [patientVar]: patientRef } });
    let res;
    try {
      // redirect:"manual" — never auto-follow a 3xx through this authenticated, PHI-bearing read to another
      // origin (the onboard ctx.fetch is additionally redirect-safe; this hardens the engine path too).
      res = await ctx.fetch(endpointUrl(ctx), { method: "POST", headers: header, body, redirect: "manual" });
    } catch (e) {
      // Preserve an already-typed/controlled error (the onboard SSRF guard's OnboardError("ssrf"), ...) so its
      // class is never masked; only a BARE platform rejection is normalized to a typed UpstreamError. Copied
      // verbatim from the rest-json connector's fetchPatient idiom.
      if (e && e.name && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(e.name)) throw e;
      throw new UpstreamError("graphql request failed");
    }
    if (!res.ok) throw new UpstreamError("graphql request HTTP " + res.status);
    let payload;
    try { payload = await res.json(); } catch (e) { throw new UpstreamError("graphql response was not JSON"); }

    // {data, errors} — a GraphQL response can report partial `errors` alongside partial `data`; NEVER echo the
    // server's error text (only a count), and NEVER invent rows when the resultsPath doesn't resolve to an array.
    const warnings = [];
    const gqlErrors = Array.isArray(payload && payload.errors) ? payload.errors : null;
    const resultsPath = ctx.config && ctx.config.resultsPath;
    const extracted = rowsAt(payload && payload.data, resultsPath);
    let rows;
    if (Array.isArray(extracted)) rows = extracted;
    else { rows = []; warnings.push("no array at resultsPath; no rows read"); }
    if (gqlErrors && gqlErrors.length) warnings.push("graphql response reported errors; " + rows.length + " rows read");

    const maxRows = (ctx.budget && ctx.budget.maxRows) || 50000;
    if (rows.length > maxRows) { warnings.push("rows truncated at maxRows (" + maxRows + ")"); rows = rows.slice(0, maxRows); }

    return { rows, warnings };
  },

  // Reuse (NOT fork) the already-tested CSV/lab mapper: once you have header+rows+warnings, a flat GraphQL row
  // is structurally identical to a CSV row, so the SAME columnMap-driven Patient/Observation/DiagnosticReport
  // mapping applies verbatim — the SAME idiom as rest-json.normalize. sourceConnector: "graphql" only relabels
  // bundle.meta + provenance (file/normalize.js's opt-in 3rd param).
  normalize: async (ctx, raw) => {
    const rows = (raw && raw.rows) || [];
    const header = Object.keys(rows[0] || {});
    const explicit = ctx.config && ctx.config.config && ctx.config.config.columnMap;
    const columnMap = (explicit && typeof explicit === "object" && Object.keys(explicit).length) ? explicit : inferColumnMap(header);
    const normCtx = Object.assign({}, ctx, { config: Object.assign({}, ctx.config, { config: { columnMap } }) });
    return normalizeCsvLab(normCtx, { header, rows, warnings: (raw && raw.warnings) || [] }, { sourceConnector: "graphql" });
  },
};
