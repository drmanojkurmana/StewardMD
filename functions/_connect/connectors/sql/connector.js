// functions/_connect/connectors/sql/connector.js — generic SQL/DB lab-results PULL connector (INTERFACE + STUB).
//
// KEY REUSE INSIGHT: a hospital whose lab data lives in a plain SQL database can self-onboard with NO code from
// us, because a flat row from a SELECT maps onto EXISTING SCCM resources (Patient/Observation/DiagnosticReport)
// EXACTLY as the shipped CSV/rest-json path already does. So this connector is a thin adapter in FRONT of the
// already-tested normalizeCsvLab (../file/normalize.js) — NO new mapping engine, NO new SCCM resource. It mirrors
// the rest-json/graphql connector's wiring, but with an injected DRIVER seam (ctx.config.driver) in place of a
// fetch: the driver holds a parameterized query(template, params) the owner wires later.
//
// THE HONEST HARD TRUTH (why this ships as a STUB today): Cloudflare Pages Functions cannot open a raw DB socket
// without Cloudflare Hyperdrive AND a SQL client LIBRARY (a NEW dependency that needs a build step) — both
// forbidden in this buildless app. So TODAY: save/list/validate-config work, and the synthetic-driver mapping
// path is proven by tests; but with NO wired driver, fetchPatient returns ZERO rows + notConfigured (NEVER a
// fabricated row, NEVER a fake empty "success"). pull.js/probe.js turn that into an explicit not-configured.
//
// OWNER // VERIFY — to make this REAL, the owner (not this app) must:
//   (a) `wrangler hyperdrive create` and add the Hyperdrive binding to the Pages project;
//   (b) add a SQL client dependency (e.g. a Postgres driver), which REQUIRES introducing a build step — an owner
//       architectural decision this buildless PWA cannot make on its own;
//   (c) write a driver factory (e.g. connectors/sql/driver-pg.js makePgDriver(binding)) whose
//       query(template, params) uses a PARAMETERIZED bind — NEVER string-concatenate the patient value into the
//       SQL (the SQL-injection invariant: the patient id is ALWAYS a bound parameter, exactly as we pass it);
//   (d) set `sqlDriverFactory` in the router deps (functions/api/connect/onboard/[[path]].js);
//   (e) flip CONNECT_SQL_FLAG on ONLY after a live integration test.
import { normalizeCsvLab } from "../file/normalize.js";
import { inferColumnMap } from "../../onboard/csv-upload.js";
import { UpstreamError } from "../../permission.js";

export const sqlConnector = {
  meta: { id: "sql", name: "Generic SQL/DB lab feed", version: "1.0", profile: "pull", kinds: ["sql"], sccmVersion: "1.0" },

  authenticate: async () => ({ ok: true }),   // no handshake — DB credentials live in the owner's Hyperdrive binding, used by the driver

  capabilities: async () => ({ resources: ["Patient", "Observation", "DiagnosticReport"], operations: ["read"], authKinds: ["binding"] }),

  validate: async (ctx) => {
    // Config-shape check only (no live call): without a wired driver the connection is HONESTLY not-configured.
    const driver = ctx && ctx.config && ctx.config.driver;
    if (!driver) return { ok: false, checks: [{ name: "driver", ok: false, detail: "not-configured" }] };
    return { ok: true, checks: [{ name: "driver", ok: true }] };
  },

  fetchPatient: async (ctx, patientRef) => {
    const driver = ctx && ctx.config && ctx.config.driver;
    // NO driver (the default): ZERO rows + notConfigured. NEVER a fabricated row, NEVER a fake empty success —
    // pull.js turns notConfigured into an explicit not-configured error before it can read as a successful pull.
    if (!driver) {
      return { rows: [], warnings: ["sql driver not configured; connection returns no rows until the owner wires a Hyperdrive-backed driver"], notConfigured: true };
    }
    // Driver present (owner-wired): run the owner's OWN parameterized query. The patient value travels ONLY as a
    // BOUND parameter ({ patientId: patientRef }) — never interpolated into the query text (no injection surface).
    let rows;
    try {
      rows = await driver.query(ctx.config.queryTemplate, { patientId: patientRef });
    } catch (e) {
      // Preserve an already-typed/controlled error so its class is never masked; only a BARE rejection is
      // normalized to a typed UpstreamError. Copied verbatim from the rest-json/graphql connector's idiom.
      if (e && e.name && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(e.name)) throw e;
      throw new UpstreamError("sql query failed");
    }
    const warnings = [];
    // Accept ONLY an array of rows; anything else is 0 rows + a warning — NEVER invent rows.
    if (!Array.isArray(rows)) { rows = []; warnings.push("sql driver returned a non-array result; no rows read"); }
    const maxRows = (ctx.budget && ctx.budget.maxRows) || 50000;
    if (rows.length > maxRows) { warnings.push("rows truncated at maxRows (" + maxRows + ")"); rows = rows.slice(0, maxRows); }
    return { rows, warnings };
  },

  // Reuse (NOT fork) the already-tested CSV/lab mapper: a flat SQL row is structurally identical to a CSV row, so
  // the SAME columnMap-driven Patient/Observation/DiagnosticReport mapping applies verbatim — the SAME idiom as
  // rest-json.normalize / graphql.normalize. sourceConnector: "sql" only relabels bundle.meta + provenance.
  // ZERO rows (the not-configured path) yields a valid patient-only bundle (never an error, never invented data).
  normalize: async (ctx, raw) => {
    const rows = (raw && raw.rows) || [];
    const header = Object.keys(rows[0] || {});
    const explicit = ctx.config && ctx.config.config && ctx.config.config.columnMap;
    const columnMap = (explicit && typeof explicit === "object" && Object.keys(explicit).length) ? explicit : inferColumnMap(header);
    const normCtx = Object.assign({}, ctx, { config: Object.assign({}, ctx.config, { config: { columnMap } }) });
    return normalizeCsvLab(normCtx, { header, rows, warnings: (raw && raw.warnings) || [] }, { sourceConnector: "sql" });
  },
};
