/* StewardMD — Government Health Schemes: D1 data access (repository).
 *
 * All SQL for the govschemes module lives here so the route handler stays thin. Binding:
 * env.GOVSCHEMES_DB (Cloudflare D1, "stewardmd-govschemes"). Mirrors functions/_updates_repo.js:
 * every read checks hasDb() first and degrades to an empty result rather than throwing when the
 * binding is absent (route layer adds the {error:"unavailable"} flag — see functions/api/schemes/).
 *
 * Public, non-PHI reference data (govt scheme package masters) — no write path here yet
 * (Phase 1 ingestion writes via scripts/govschemes/*, not this API).
 */
export function hasDb(env) { return !!env.GOVSCHEMES_DB; }
function db(env) { return env.GOVSCHEMES_DB; }

/* ---------------- pure helpers (unit-tested, no D1 involved) ---------------- */

// FTS5 prefix-match string: lowercase [a-z0-9]+ tokens, each "tok*", joined by space.
// Mirrors worker/src/index.js ftsQuery() exactly (same tokenizer contract as drugs_fts).
export function ftsQuery(q) {
  const tokens = (q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!tokens.length) return null;
  return tokens.map(function (t) { return t + "*"; }).join(" ");
}

// A query that looks like a native government code ("S7.1.5.1", "BM001A") rather than a
// free-text procedure name: contains a digit or a dot.
export function isCodeLike(q) {
  const s = String(q || "");
  return /[0-9]/.test(s) || s.indexOf(".") >= 0;
}

// Clamp a limit param to 1..100; unparsable input defaults to 20.
export function clampLimit(n) {
  const v = parseInt(n, 10);
  if (!isFinite(v) || isNaN(v)) return 20;
  return Math.max(1, Math.min(100, v));
}

// Normalise a treatment name for cross-state grouping in /compare (trim, lowercase, collapse spaces).
export function normaliseName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* ---------------- package search ---------------- */

const PKG_COLS =
  "p.id AS package_id, j.name AS state, j.id AS state_id, s.name AS scheme, s.id AS scheme_id, " +
  "sv.version_label AS version_label, p.speciality_code, p.speciality_name, p.package_code, p.package_name, " +
  "p.treatment_code, p.treatment_name, p.treatment_type, p.package_amount, p.rate_tier";

const EXACT_JOIN =
  "packages p JOIN scheme_versions sv ON sv.id = p.scheme_version_id " +
  "JOIN schemes s ON s.id = sv.scheme_id JOIN jurisdictions j ON j.id = s.jurisdiction_id";

const FTS_JOIN =
  "packages_fts f JOIN packages p ON p.rowid = f.rowid " +
  "JOIN scheme_versions sv ON sv.id = p.scheme_version_id " +
  "JOIN schemes s ON s.id = sv.scheme_id JOIN jurisdictions j ON j.id = s.jurisdiction_id";

async function runRows(env, sql, binds) {
  const rs = await db(env).prepare(sql).bind(...binds).all();
  return rs.results || [];
}

// opts = { q, stateId, limit }. Exact treatment_code hits (when q looks like a code) are unioned
// ahead of FTS prefix hits and deduped by package_id — a code lookup should never be shadowed by
// a looser text match.
export async function searchPackages(env, opts) {
  opts = opts || {};
  if (!hasDb(env)) return [];
  const q = String(opts.q || "").trim();
  const stateId = opts.stateId || "";
  const limit = clampLimit(opts.limit);
  const rows = [];
  const seen = {};

  if (isCodeLike(q)) {
    let sql = "SELECT " + PKG_COLS + " FROM " + EXACT_JOIN + " WHERE p.treatment_code = ?";
    const binds = [q];
    if (stateId) { sql += " AND j.id = ?"; binds.push(stateId); }
    sql += " LIMIT ?"; binds.push(limit);
    for (const r of await runRows(env, sql, binds)) {
      if (!seen[r.package_id]) { seen[r.package_id] = 1; rows.push(r); }
    }
  }

  const match = ftsQuery(q);
  if (match && rows.length < limit) {
    let sql = "SELECT " + PKG_COLS + " FROM " + FTS_JOIN + " WHERE packages_fts MATCH ?";
    const binds = [match];
    if (stateId) { sql += " AND j.id = ?"; binds.push(stateId); }
    sql += " ORDER BY rank LIMIT ?"; binds.push(limit);
    for (const r of await runRows(env, sql, binds)) {
      if (!seen[r.package_id]) { seen[r.package_id] = 1; rows.push(r); if (rows.length >= limit) break; }
    }
  }

  return rows.slice(0, limit);
}

// Same match set as searchPackages (no state filter, a higher internal cap), grouped by
// normaliseName(treatment_name) so one procedure shows every state's row side by side.
export async function comparePackages(env, q, cap) {
  const rows = await searchPackages(env, { q, limit: cap || 100 });
  const groups = {}, order = [];
  for (const r of rows) {
    const key = normaliseName(r.treatment_name);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  }
  return order.map(function (key) { return { treatment_name_normalised: key, rows: groups[key] }; });
}

/* ---------------- jurisdictions ---------------- */

export async function listJurisdictions(env) {
  if (!hasDb(env)) return [];
  const sql =
    "SELECT j.id, j.name, j.type, " +
    "(SELECT COUNT(*) FROM schemes s WHERE s.jurisdiction_id = j.id) AS schemes, " +
    "(SELECT COUNT(*) FROM packages p JOIN scheme_versions sv ON sv.id = p.scheme_version_id " +
    "JOIN schemes s2 ON s2.id = sv.scheme_id WHERE s2.jurisdiction_id = j.id) AS packages " +
    "FROM jurisdictions j ORDER BY j.name ASC";
  const rs = await db(env).prepare(sql).all();
  return (rs.results || []).map(function (r) {
    return { id: r.id, name: r.name, type: r.type, schemes: r.schemes || 0, packages: r.packages || 0 };
  });
}

/* ---------------- package detail ---------------- */

// Full package row + its scheme/state context + source provenance. Returns null when the id
// doesn't exist (route layer turns that into 404 — not a DB error, so not fail-safe-degraded).
export async function getPackageById(env, id) {
  if (!hasDb(env)) return null;
  const sql =
    "SELECT p.*, sv.version_label AS version_label, sv.source_id AS source_id, " +
    "s.id AS scheme_id, s.name AS scheme, s.authority AS scheme_authority, " +
    "j.id AS state_id, j.name AS state FROM " + EXACT_JOIN + " WHERE p.id = ?";
  const r = await db(env).prepare(sql).bind(id).first();
  if (!r) return null;
  let source = null;
  if (r.source_id) {
    source = await db(env).prepare(
      "SELECT url, authority, retrieved_ts, verification_status FROM sources WHERE id = ?"
    ).bind(r.source_id).first();
  }
  return { row: r, source: source || null };
}
