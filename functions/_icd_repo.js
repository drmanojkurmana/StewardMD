/* StewardMD — ICD Search: D1 data access (repository).
 *
 * All SQL for the ICD module lives here so the route handler stays thin. Binding:
 * env.ICD_DB (Cloudflare D1, "stewardmd-icd"). Mirrors functions/_schemes_repo.js exactly -
 * every read checks hasDb() first and degrades to an empty result rather than throwing when the
 * binding is absent (route layer adds the {error:"unavailable"} flag).
 *
 * Public, non-PHI reference data (WHO/CMS disease classification codes) - read-only, no write
 * path here (loaded once via scripts/icd/*, not this API).
 */
export function hasDb(env) { return !!env.ICD_DB; }
function db(env) { return env.ICD_DB; }

/* ---------------- pure helpers (unit-tested, no D1 involved) ---------------- */

// FTS5 prefix-match string, same tokenizer contract as functions/_schemes_repo.js's ftsQuery().
export function ftsQuery(q) {
  const tokens = (q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!tokens.length) return null;
  return tokens.map(function (t) { return t + "*"; }).join(" ");
}

// A query that looks like a native ICD code ("A00.0", "1A03.0", "E11") rather than free text:
// starts with a letter+digit and is short - avoids misreading a one-word diagnosis as a code.
export function isCodeLike(q) {
  const s = String(q || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9.]{1,9}$/.test(s) && /[0-9]/.test(s);
}

export function clampLimit(n) {
  const v = parseInt(n, 10);
  if (!isFinite(v) || isNaN(v)) return 20;
  return Math.max(1, Math.min(100, v));
}

// system filter: '' (both), 'ICD-10', 'ICD-11' - anything else is treated as no filter.
export function normSystem(s) {
  const v = String(s || "").trim().toUpperCase();
  if (v === "ICD-10" || v === "ICD10") return "ICD-10";
  if (v === "ICD-11" || v === "ICD11") return "ICD-11";
  return "";
}

const COLS = "id, system, code, title, chapter, is_leaf";

async function runRows(env, sql, binds) {
  const rs = await db(env).prepare(sql).bind(...binds).all();
  return rs.results || [];
}

// opts = { q, system, limit }. Exact code hits are unioned ahead of FTS prefix-title hits and
// deduped by id - looking up "E11" should never be shadowed by a looser text match, same
// precedence rule as searchPackages() in _schemes_repo.js.
export async function searchCodes(env, opts) {
  opts = opts || {};
  if (!hasDb(env)) return [];
  const q = String(opts.q || "").trim();
  const system = normSystem(opts.system);
  const limit = clampLimit(opts.limit);
  const rows = [];
  const seen = {};

  if (isCodeLike(q)) {
    let sql = "SELECT " + COLS + " FROM icd_codes WHERE code = ?";
    const binds = [q.toUpperCase()];
    if (system) { sql += " AND system = ?"; binds.push(system); }
    sql += " LIMIT ?"; binds.push(limit);
    for (const r of await runRows(env, sql, binds)) {
      if (!seen[r.id]) { seen[r.id] = 1; rows.push(r); }
    }
    // A code prefix ("A00", "1A03") should also surface its children, not just an exact hit.
    if (rows.length < limit) {
      let sql2 = "SELECT " + COLS + " FROM icd_codes WHERE code LIKE ? AND code != ?";
      const binds2 = [q.toUpperCase() + "%", q.toUpperCase()];
      if (system) { sql2 += " AND system = ?"; binds2.push(system); }
      sql2 += " ORDER BY code LIMIT ?"; binds2.push(limit - rows.length);
      for (const r of await runRows(env, sql2, binds2)) {
        if (!seen[r.id]) { seen[r.id] = 1; rows.push(r); }
      }
    }
  }

  const match = ftsQuery(q);
  if (match && rows.length < limit) {
    let sql = "SELECT " + COLS.split(", ").map(function (c) { return "c." + c; }).join(", ") +
      " FROM icd_fts f JOIN icd_codes c ON c.rowid = f.rowid WHERE icd_fts MATCH ?";
    const binds = [match];
    if (system) { sql += " AND c.system = ?"; binds.push(system); }
    sql += " ORDER BY rank LIMIT ?"; binds.push(limit);
    for (const r of await runRows(env, sql, binds)) {
      if (!seen[r.id]) { seen[r.id] = 1; rows.push(r); if (rows.length >= limit) break; }
    }
  }

  return rows.slice(0, limit);
}

export async function getCodeById(env, id) {
  if (!hasDb(env)) return null;
  const r = await db(env).prepare("SELECT " + COLS + " FROM icd_codes WHERE id = ?").bind(id).first();
  return r || null;
}
