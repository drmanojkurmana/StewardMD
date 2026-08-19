// functions/_connect/abdm/abdm-testkit.js — test-only mock D1 (with UPDATE/meta.changes) + mock R2.
export function makeAbdmDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  const table = (sql) => (sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i) || [])[1];
  const cols = (sql) => (sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1] || "").split(",").map((s) => s.trim());
  function where(sql, binds, rows, bindOffset) {
    // supports: WHERE a=? [AND b<>?] [AND c IS [NOT] NULL]  — our lookups, the CAS guard, and the
    // single-use claim. IS NULL consumes NO bind, so predicates are walked in order and only the
    // ?-bearing ones advance the bind cursor.
    // Scan only the WHERE clause so an UPDATE's `SET col=?` isn't parsed as a guard condition.
    const clause = (sql.match(/\bWHERE\b([\s\S]*)$/i) || [, ""])[1];
    // Fail LOUD on any predicate we don't implement. Silently dropping one (e.g. `expires_at < ?`)
    // would collapse the WHERE to a no-op and match the whole table — a DELETE-everything landmine.
    // Validate per-predicate shape (so the supported `<>` isn't false-flagged by a bare `<` scan).
    const preds = [];
    for (const pred of clause.split(/\bAND\b/i).map((s) => s.trim()).filter(Boolean)) {
      let m = /^\s*(\w+)\s*(=|<>)\s*\?\s*$/.exec(pred);
      if (m) { preds.push({ col: m[1], op: m[2] }); continue; }
      m = /^\s*(\w+)\s+IS\s+(NOT\s+)?NULL\s*$/i.exec(pred);
      if (m) { preds.push({ col: m[1], op: m[2] ? "notnull" : "isnull" }); continue; }
      throw new Error("abdm mock D1: unsupported WHERE (only 'col=?', 'col<>?', 'col IS [NOT] NULL') — filter in JS or extend the mock");
    }
    let cursor = bindOffset;
    const bound = preds.map((p) => (p.op === "isnull" || p.op === "notnull") ? { ...p } : { ...p, at: cursor++ });
    return rows.filter((r) => bound.every((p) => {
      if (p.op === "isnull") return r[p.col] == null;
      if (p.op === "notnull") return r[p.col] != null;
      const v = binds[p.at];
      return p.op === "=" ? String(r[p.col]) === String(v) : String(r[p.col]) !== String(v);
    }));
  }
  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = { bind: (...a) => { binds = a; return stmt; } };
      stmt.first = async () => { const t = table(sql); return where(sql, binds, tables[t] || [], 0)[0] || null; };
      stmt.all = async () => { const t = table(sql); return { results: where(sql, binds, tables[t] || [], 0) }; };
      stmt.run = async () => {
        const t = table(sql); tables[t] = tables[t] || [];
        if (/^\s*INSERT/i.test(sql)) { const c = cols(sql); const row = {}; c.forEach((k, i) => (row[k] = binds[i])); tables[t].push(row); return { success: true, meta: { changes: 1 } }; }
        if (/^\s*UPDATE/i.test(sql)) {
          const set = sql.match(/SET\s+(.+?)\s+WHERE/is)[1].split(",").map((s) => s.trim().replace(/=\?$/, "").trim());
          const nSet = set.length;
          const matched = where(sql, binds, tables[t], nSet);   // WHERE binds come AFTER the SET binds
          let changes = 0;
          for (const r of matched) { set.forEach((col, i) => (r[col] = binds[i])); changes++; }
          return { success: true, meta: { changes } };
        }
        if (/^\s*DELETE/i.test(sql)) { const before = tables[t].length; tables[t] = tables[t].filter((r) => !where(sql, binds, [r], 0).length); return { success: true, meta: { changes: before - tables[t].length } }; }
        return { success: true, meta: { changes: 0 } };
      };
      return stmt;
    },
  };
}

// `pageSize` models real Cloudflare R2 `list` truncation: a single call returns at most `pageSize` keys and,
// when more remain, `{ truncated: true, cursor }` for the next page (default Infinity = one page, the historical
// behavior, so existing callers are unaffected). Set a small pageSize (e.g. 2) to prove cursor-loop pagination.
export function makeR2({ pageSize = Infinity } = {}) {
  const m = new Map();
  return {
    put: async (k, v, opts = {}) => { m.set(k, { body: String(v), customMetadata: opts.customMetadata || {}, uploaded: (opts.customMetadata && opts.customMetadata.ts) || null }); },
    get: async (k) => { const o = m.get(k); return o ? { text: async () => o.body, customMetadata: o.customMetadata } : null; },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "", cursor } = {}) => {
      const all = [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, customMetadata: o.customMetadata }));
      const start = cursor ? Number(cursor) : 0;                       // offset cursor (stable while not mutating mid-list)
      const page = all.slice(start, start + pageSize);
      const nextStart = start + page.length;
      const truncated = nextStart < all.length;
      return { objects: page, truncated, cursor: truncated ? String(nextStart) : undefined };
    },
  };
}
