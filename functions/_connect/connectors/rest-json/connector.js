// functions/_connect/connectors/rest-json/connector.js — generic REST/JSON lab-results PULL connector.
// KEY REUSE INSIGHT: a hospital whose EMR/LIS exposes a plain REST+JSON lab-results API (not FHIR) can
// self-onboard with NO code from us, because a flat JSON array of lab-result rows maps onto EXISTING SCCM
// resources (Patient/Observation/DiagnosticReport) EXACTLY as the shipped CSV path already does. So this
// connector is a thin SSRF-safe HTTP-fetch adapter in FRONT of the already-tested normalizeCsvLab
// (../file/normalize.js) — NO new mapping engine, NO new SCCM resource. Auth is token/API-key ONLY (no
// SMART): a static bearer (or a custom header name) via ctx.secrets("bearer"), same idiom as the fhir-r4
// connector's Phase-0 sandbox bearer path and probe.js's generic token branch.
import { normalizeCsvLab } from "../file/normalize.js";
import { inferColumnMap } from "../../onboard/csv-upload.js";
import { UpstreamError } from "../../permission.js";

// Resolve the auth header from ctx.secrets("bearer") + an optional custom header name (config.headerName).
// Mirrors probe.js's resolveAuth token branch and the fhir-r4 connector's initialAuthHeader (built fresh on
// every call, never cached on the connector — the connector holds no state).
async function authHeaderFor(ctx) {
  const tok = ctx.secrets ? await ctx.secrets("bearer").catch(() => null) : null;
  if (!tok) return {};
  const name = (ctx.config && ctx.config.headerName) ? String(ctx.config.headerName) : "authorization";
  const value = name.toLowerCase() === "authorization" ? "Bearer " + tok : tok;
  return { [name]: value };
}

function resultsUrl(ctx, patientRef) {
  const base = ((ctx.config && ctx.config.base_url) || "").replace(/\/$/, "");
  const path = (ctx.config && ctx.config.resultsPath) || "/results";
  const param = (ctx.config && ctx.config.patientParam) || "patientId";
  return base + path + "?" + param + "=" + encodeURIComponent(patientRef);
}

export const restJsonConnector = {
  meta: { id: "rest-json", name: "Generic REST/JSON lab feed", version: "1.0", profile: "pull", kinds: ["rest-json"], sccmVersion: "1.0" },

  authenticate: async () => ({ ok: true }),   // no handshake — the token (if any) is attached per-request below

  capabilities: async () => ({ resources: ["Patient", "Observation", "DiagnosticReport"], operations: ["read"], authKinds: ["token"] }),

  validate: async (ctx) => {
    const checks = [];
    try {
      const base = ((ctx.config && ctx.config.base_url) || "").replace(/\/$/, "");
      const path = (ctx.config && ctx.config.resultsPath) || "/results";
      const header = await authHeaderFor(ctx);
      // redirect:"manual" (mirrors fhir-r4.validate) — never auto-follow a 3xx to another origin here.
      const res = await ctx.fetch(base + path, { headers: header, redirect: "manual" });
      const ok = !!(res && res.ok);
      checks.push({ name: "results-endpoint", ok });
      return { ok, checks };
    } catch (e) { checks.push({ name: "validate", ok: false, detail: e.message }); return { ok: false, checks }; }
  },

  fetchPatient: async (ctx, patientRef) => {
    const header = await authHeaderFor(ctx);
    let res;
    try {
      // redirect:"manual" — never auto-follow a 3xx through this authenticated, PHI-bearing read to another
      // origin (the onboard ctx.fetch is additionally redirect-safe; this hardens the engine path too).
      res = await ctx.fetch(resultsUrl(ctx, patientRef), { headers: header, redirect: "manual" });
    } catch (e) {
      // Preserve an already-typed/controlled error (the onboard SSRF guard's OnboardError("ssrf"), ...) so its
      // class is never masked; only a BARE platform rejection is normalized to a typed UpstreamError. Copied
      // verbatim from the fhir-r4 connector's readPatient idiom.
      if (e && e.name && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(e.name)) throw e;
      throw new UpstreamError("results read failed");
    }
    if (!res.ok) throw new UpstreamError("results read HTTP " + res.status);
    let data;
    try { data = await res.json(); } catch (e) { throw new UpstreamError("results response was not JSON"); }

    // Accept ONLY a bare array or {results:[...]}; anything else is 0 rows + a warning — NEVER invent rows.
    const warnings = [];
    let rows;
    if (Array.isArray(data)) rows = data;
    else if (data && Array.isArray(data.results)) rows = data.results;
    else { rows = []; warnings.push("unrecognized response shape (expected a bare array or {results:[...]}); no rows read"); }

    const maxRows = (ctx.budget && ctx.budget.maxRows) || 50000;
    if (rows.length > maxRows) { warnings.push("rows truncated at maxRows (" + maxRows + ")"); rows = rows.slice(0, maxRows); }

    return { rows, warnings };
  },

  // Reuse (NOT fork) the already-tested CSV/lab mapper: once you have header+rows+warnings, a flat JSON row is
  // structurally identical to a CSV row, so the SAME columnMap-driven Patient/Observation/DiagnosticReport
  // mapping applies verbatim. normalizeCsvLab requires an EXPLICIT columnMap (map[key] lookup, never an
  // identity fallback) — so when the onboarded connection didn't supply one, fall back to the SAME best-effort
  // inferColumnMap(header) the CSV upload path already uses (csv-upload.js), rather than inventing a new
  // mapping algorithm or silently emitting an empty bundle. sourceConnector: "rest-json" only relabels
  // bundle.meta + provenance (file/normalize.js's opt-in 3rd param).
  normalize: async (ctx, raw) => {
    const rows = (raw && raw.rows) || [];
    const header = Object.keys(rows[0] || {});
    const explicit = ctx.config && ctx.config.config && ctx.config.config.columnMap;
    const columnMap = (explicit && typeof explicit === "object" && Object.keys(explicit).length) ? explicit : inferColumnMap(header);
    const normCtx = Object.assign({}, ctx, { config: Object.assign({}, ctx.config, { config: { columnMap } }) });
    return normalizeCsvLab(normCtx, { header, rows, warnings: (raw && raw.warnings) || [] }, { sourceConnector: "rest-json" });
  },
};
